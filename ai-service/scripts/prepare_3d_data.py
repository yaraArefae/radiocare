"""
Builds the train / validation / test splits for the volumetric models.

Every other dataset in this project is a single X ray film: one image,
one reading. A CT or an MRI is a stack of slices, and a finding that is
invisible on any one slice can be obvious once the slices are read
together. That is what the 3D models are for, and this script prepares
their input.

Three sources are supported.

    medmnist3d   Small public volumes that download themselves. Nothing
                 has to be requested, registered for or unpacked by
                 hand, and a 28 cubed volume trains on a laptop CPU, so
                 a region can go from nothing to a measured 3D model in
                 one afternoon.

    real         A whole clinical collection, downloaded the same way:
                 full sized scans of whole patients rather than crops
                 around a finding somebody else already found. Harder,
                 slower, and much closer to what the clinic sends.

    nifti        A folder of .nii / .nii.gz volumes with a labels file.
                 This is the path for real clinical CT, whatever the
                 body region: the volumes are windowed, resampled to one
                 shape and written out in the same layout, so the
                 training script cannot tell the two sources apart.

Examples:

    python scripts/prepare_3d_data.py chest --dataset nodule3d
    python scripts/prepare_3d_data.py chest --dataset fracture3d
    python scripts/prepare_3d_data.py abdomen --dataset organ3d --size 64
    python scripts/prepare_3d_data.py chest --dataset mosmed         --target-shape 64 64 64

    python scripts/prepare_3d_data.py spine --dataset nifti \
        --source-dir data/spine/sources/verse/volumes \
        --labels-csv data/spine/sources/verse/labels.csv \
        --hu-window -200 1500

Output, next to the prepared 2D datasets:

    data/<region>/processed/<dataset>/{train,val,test}.csv
    data/<region>/processed/<dataset>/volumes/*.npy
    data/<region>/processed/<dataset>/dataset.json
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_CACHE = PROJECT_ROOT / "data" / "_sources_3d"

"""
The MedMNIST v2 volumes, served from their Zenodo record.

Only the radiological sets are listed. MedMNIST also publishes an
electron microscopy set of synapses, which has nothing to do with a
radiology clinic and would only invite a meaningless model.

A binary set keeps class 1 as the finding, so a healthy volume is an all
zero row, exactly like the 2D findings sets. A multi class set becomes
one column per class: the training script uses a sigmoid per label, and
one hot rows train it into the same answer a softmax would give while
keeping a single code path for both kinds of set.
"""
MEDMNIST_RECORD = "https://zenodo.org/records/10519652/files"

MEDMNIST_SOURCES: dict[str, dict] = {
    "nodule3d": {
        "file": "nodulemnist3d",
        "kind": "binary",
        "labels": ["malignant_nodule"],
        "region": "chest",
        "about": (
            "Lung nodules cut out of the LIDC-IDRI chest CT collection, "
            "benign against malignant."
        ),
    },
    "fracture3d": {
        "file": "fracturemnist3d",
        "kind": "multiclass",
        "labels": [
            "buckle_rib_fracture",
            "nondisplaced_rib_fracture",
            "displaced_rib_fracture",
        ],
        "region": "chest",
        "about": (
            "Rib fractures from the RibFrac chest CT challenge. Every "
            "volume holds a fracture, so the model reads which kind it "
            "is, not whether one is there."
        ),
    },
    "adrenal3d": {
        "file": "adrenalmnist3d",
        "kind": "binary",
        "labels": ["adrenal_mass"],
        "region": "abdomen",
        "about": (
            "Adrenal gland volumes from abdominal CT, normal against "
            "hyperplasia."
        ),
    },
    "vessel3d": {
        "file": "vesselmnist3d",
        "kind": "binary",
        "labels": ["intracranial_aneurysm"],
        "region": "head",
        "about": (
            "Brain vessel segments from MRA, healthy vessel against "
            "aneurysm."
        ),
    },
    "organ3d": {
        "file": "organmnist3d",
        "kind": "multiclass",
        "labels": [
            "organ_liver",
            "organ_kidney_right",
            "organ_kidney_left",
            "organ_femur_right",
            "organ_femur_left",
            "organ_bladder",
            "organ_heart",
            "organ_lung_right",
            "organ_lung_left",
            "organ_spleen",
            "organ_pancreas",
        ],
        "region": "abdomen",
        "about": (
            "Eleven organs cut out of abdominal CT. This one names the "
            "body part rather than a finding, so it belongs in front of "
            "the other models, not in a doctor's report."
        ),
    },
}

MEDMNIST_SPLIT_KEYS = {
    "train": ("train_images", "train_labels"),
    "val": ("val_images", "val_labels"),
    "test": ("test_images", "test_labels"),
}


def download_if_missing(
    url: str,
    destination: Path,
    attempts: int = 12,
) -> Path:
    """
    Downloads a source archive once, resuming where it left off.

    The collections here run to thirty gigabytes, and a connection that
    holds for the ten minutes a small file needs will not hold for the
    two hours a large one does. Starting again from zero after each drop
    is not slow, it is unable to finish: the pancreas archive failed
    twice at seven and five gigabytes of twelve, and a third attempt from
    zero would have been a third coin toss.

    So the partial file is kept and the next attempt asks the server for
    the rest of it with a Range header. Every attempt now moves the
    download forward, and a link that drops every few gigabytes finishes
    in several passes instead of never.

    The size is still checked before the file is accepted. A dropped
    connection ends a read loop exactly like a finished download does,
    and without the check a truncated archive is cached as complete and
    the failure surfaces later as an unreadable file, far from the thing
    that actually went wrong.
    """
    if destination.exists() and destination.stat().st_size > 0:
        print(f"Already downloaded: {destination.name}")
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")

    print(f"Downloading {url}")

    total = 0
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        have = partial.stat().st_size if partial.exists() else 0

        if total and have >= total:
            break

        headers = {"User-Agent": "radiocare-3d-prepare"}

        if have:
            headers["Range"] = f"bytes={have}-"
            print(f"Resuming at {have / 1e9:.2f} GB (attempt {attempt})")

        try:
            request = urllib.request.Request(url, headers=headers)

            with urllib.request.urlopen(request, timeout=120) as response:
                """
                206 means the server honoured the range and is sending
                the rest. 200 means it ignored it and is sending the
                whole file, so whatever was already written has to go or
                the two copies would be concatenated into nonsense.
                """
                resumed = response.status == 206

                if have and not resumed:
                    print("The server ignored the resume, starting again.")
                    have = 0

                length = int(response.headers.get("Content-Length") or 0)
                total = total or (have + length)

                mode = "ab" if (have and resumed) else "wb"
                written = have

                with partial.open(mode) as handle:
                    while True:
                        chunk = response.read(1 << 20)

                        if not chunk:
                            break

                        handle.write(chunk)
                        written += len(chunk)

                        if total:
                            print(
                                f"\r{written / 1e9:6.2f} GB / "
                                f"{total / 1e9:.2f} GB",
                                end="",
                            )

            print()

            if not total or written >= total:
                break

            print(
                f"Connection dropped at {written / 1e9:.2f} GB of "
                f"{total / 1e9:.2f} GB, continuing."
            )

        except Exception as error:
            last_error = error
            print(f"\nAttempt {attempt} failed: {str(error)[:80]}")

    have = partial.stat().st_size if partial.exists() else 0

    if not total or have < total:
        raise RuntimeError(
            f"{destination.name} stopped at {have} bytes of {total} "
            f"after {attempts} attempts. The partial file is kept, so "
            f"running this again continues from there. "
            f"Last error: {last_error}"
        )

    partial.replace(destination)
    return destination


def write_volumes(
    volumes: np.ndarray,
    split: str,
    volumes_dir: Path,
) -> list[str]:
    """
    Writes one .npy per volume and returns the paths, relative to the
    ai-service folder so the CSV files stay portable between machines,
    the same way the 2D image paths are stored.
    """
    volumes_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []

    for index, volume in enumerate(volumes):
        file_path = volumes_dir / f"{split}_{index:05d}.npy"
        np.save(file_path, np.ascontiguousarray(volume, dtype=np.uint8))
        paths.append(str(file_path.relative_to(PROJECT_ROOT)).replace("\\", "/"))

    return paths


def prepare_medmnist(
    dataset_key: str,
    region: str,
    size: int,
    output_dir: Path,
) -> dict:
    source = MEDMNIST_SOURCES[dataset_key]
    labels = list(source["labels"])

    file_name = source["file"]

    if size != 28:
        file_name = f"{file_name}_{size}"

    archive = download_if_missing(
        f"{MEDMNIST_RECORD}/{file_name}.npz?download=1",
        SOURCE_CACHE / f"{file_name}.npz",
    )

    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volume_shape: list[int] = []

    with np.load(archive) as data:
        for split, (image_key, label_key) in MEDMNIST_SPLIT_KEYS.items():
            images = np.asarray(data[image_key])
            raw_labels = np.asarray(data[label_key]).reshape(len(images), -1)

            if not volume_shape:
                volume_shape = [int(value) for value in images.shape[1:4]]

            frame = pd.DataFrame(
                {"volume_path": write_volumes(images, split, volumes_dir)}
            )

            """
            Binary sets carry the finding in class 1. Multi class sets
            become one column per class, which is the shape the training
            script already knows how to weight and threshold.
            """
            if source["kind"] == "binary":
                frame[labels[0]] = raw_labels[:, 0].astype(np.float32)
            else:
                class_index = raw_labels[:, 0].astype(int)

                for position, label in enumerate(labels):
                    frame[label] = (class_index == position).astype(np.float32)

            frame.to_csv(output_dir / f"{split}.csv", index=False)
            print(f"{split}: {len(frame)} volumes")

    return {
        "dataset": dataset_key,
        "source": f"medmnist3d/{file_name}",
        "about": source["about"],
        "region": region,
        "labels": labels,
        "volume_shape": volume_shape,
        "value_range": [0, 255],
    }


def load_nifti_volume(
    path: Path,
    target_shape: tuple[int, int, int],
    hu_window: tuple[float, float],
) -> np.ndarray:
    """
    Reads one clinical volume and reduces it to the same shape and value
    range as the small public sets.

    A CT is stored in Hounsfield units, a scale that runs from air at
    -1000 well past dense bone. Feeding that range to a network raw lets
    the metal of an implant dominate every filter, so the volume is
    clipped to the window the region is read in first, exactly as a
    radiologist sets the window before looking.
    """
    import nibabel

    image = nibabel.load(str(path))
    volume = np.asarray(image.dataobj, dtype=np.float32)

    if volume.ndim == 4:
        volume = volume[..., 0]

    if volume.ndim != 3:
        raise ValueError(
            f"{path.name}: expected a 3D volume, got shape {volume.shape}."
        )

    low, high = hu_window
    volume = np.clip(volume, low, high)
    volume = (volume - low) / max(high - low, 1e-6)

    from scipy import ndimage

    factors = [
        target / max(current, 1)
        for target, current in zip(target_shape, volume.shape)
    ]
    volume = ndimage.zoom(volume, factors, order=1)

    """
    Rounding inside zoom can leave a voxel of slack, so the result is
    trimmed or padded to the exact shape the model expects.
    """
    fixed = np.zeros(target_shape, dtype=np.float32)
    cut = tuple(
        slice(0, min(target, current))
        for target, current in zip(target_shape, volume.shape)
    )
    fixed[cut] = volume[cut]

    return np.clip(fixed * 255.0, 0, 255).astype(np.uint8)


"""
The real clinical collections that can be downloaded without an account
and without an access agreement.

MedMNIST above is a teaching set: its volumes are 28 voxel crops around
a finding somebody else already located. What follows is a whole scan
of a whole patient, at the size a hospital stores it, with the finding
still hidden somewhere inside it. That is a harder problem and a more
honest one, and it is what these sources are here for.
"""
REAL_SOURCES: dict[str, dict] = {
    "mosmed": {
        "region": "chest",
        "labels": ["lung_involvement"],
        "about": (
            "Chest CT from the MosMed COVID-19 collection. CT-0 is a "
            "lung with no involvement, CT-3 is a lung with severe "
            "involvement, and the model reads which of the two it is "
            "looking at."
        ),
        "window": (-1000.0, 400.0),
        "files": [
            {
                "url": (
                    "https://github.com/hasibzunair/"
                    "3D-image-classification-tutorial/releases/"
                    "download/v0.2/CT-0.zip"
                ),
                "name": "CT-0.zip",
                "label": 0.0,
            },
            {
                "url": (
                    "https://github.com/hasibzunair/"
                    "3D-image-classification-tutorial/releases/"
                    "download/v0.2/CT-23.zip"
                ),
                "name": "CT-23.zip",
                "label": 1.0,
            },
        ],
    },
}


def extract_archive(archive: Path, destination: Path) -> Path:
    """
    Unpacks a downloaded archive once. The marker file is what makes a
    rerun cheap: checking that the folder merely exists would call a run
    that died halfway through complete.
    """
    marker = destination / ".extracted"

    if marker.exists():
        print(f"Already extracted: {archive.name}")
        return destination

    destination.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {archive.name}")

    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(destination)

    marker.write_text("ok", encoding="utf-8")
    return destination


def prepare_real_source(
    dataset_key: str,
    region: str,
    target_shape: tuple[int, int, int],
    output_dir: Path,
) -> dict:
    """
    Downloads a real clinical collection, reads every scan in it, and
    writes it out in the same layout as everything else here, so the
    training script cannot tell it apart from the teaching sets.
    """
    source = REAL_SOURCES[dataset_key]
    labels = list(source["labels"])
    window = source["window"]

    cases: list[tuple[Path, float]] = []

    for entry in source["files"]:
        archive = download_if_missing(
            entry["url"],
            SOURCE_CACHE / dataset_key / entry["name"],
        )
        folder = extract_archive(
            archive,
            SOURCE_CACHE / dataset_key / Path(entry["name"]).stem,
        )

        found = sorted(folder.rglob("*.nii.gz")) + sorted(
            folder.rglob("*.nii")
        )

        if not found:
            raise RuntimeError(
                f"No volume was found inside {entry['name']}."
            )

        cases.extend((path, float(entry["label"])) for path in found)

    print()
    print(f"{len(cases)} scans found. Reading them now.")

    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []

    for position, (source_path, label) in enumerate(cases):
        try:
            volume = load_nifti_volume(source_path, target_shape, window)
        except Exception as error:
            print(f"Could not read {source_path.name}: {error}")
            continue

        file_path = volumes_dir / f"{position:05d}.npy"
        np.save(file_path, volume)

        rows.append(
            {
                "volume_path": str(
                    file_path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/"),
                labels[0]: label,
            }
        )

        if (position + 1) % 25 == 0:
            print(f"Read {position + 1} / {len(cases)} scans")

    if not rows:
        raise RuntimeError("No scan could be read.")

    frame = pd.DataFrame(rows)

    """
    The split is drawn here rather than taken from the collection,
    which ships no split of its own. It is stratified by the label so
    the rarer class cannot land entirely on one side and leave a split
    that cannot be scored.
    """
    rng = random.Random(SEED)
    assignments: list[str] = [""] * len(frame)

    for label_value in sorted(frame[labels[0]].unique()):
        positions = frame.index[
            frame[labels[0]] == label_value
        ].tolist()
        rng.shuffle(positions)

        train_cut = int(len(positions) * 0.70)
        val_cut = int(len(positions) * 0.85)

        for order, index in enumerate(positions):
            if order < train_cut:
                assignments[index] = "train"
            elif order < val_cut:
                assignments[index] = "val"
            else:
                assignments[index] = "test"

    frame["split"] = assignments

    for split in ("train", "val", "test"):
        part = frame[frame["split"] == split]
        part[["volume_path", *labels]].to_csv(
            output_dir / f"{split}.csv",
            index=False,
        )
        print(
            f"{split}: {len(part)} volumes "
            f"({int(part[labels[0]].sum())} positive)"
        )

    return {
        "dataset": dataset_key,
        "source": source["files"][0]["url"],
        "about": source["about"],
        "region": region,
        "labels": labels,
        "volume_shape": list(target_shape),
        "value_range": [0, 255],
        "hu_window": list(window),
    }


def prepare_nifti(
    region: str,
    source_dir: Path,
    labels_csv: Path,
    target_shape: tuple[int, int, int],
    hu_window: tuple[float, float],
    output_dir: Path,
) -> dict:
    """
    Prepares a real clinical collection: a folder of volumes plus a CSV
    that names each volume and marks its findings.

        volume,fracture_visible
        sub-verse004_ct.nii.gz,1
        sub-verse011_ct.nii.gz,0

    An optional `split` column decides the three sets. Without it the
    split is drawn here, by patient when a `patient` column is present,
    so slices of one patient never sit on both sides of the split and
    flatter the test score.
    """
    if not labels_csv.exists():
        raise FileNotFoundError(f"Labels file was not found: {labels_csv}")

    frame = pd.read_csv(labels_csv)

    if "volume" not in frame.columns:
        raise ValueError(
            f"{labels_csv.name} must have a 'volume' column naming each file."
        )

    reserved = {"volume", "split", "patient"}
    labels = [column for column in frame.columns if column not in reserved]

    if not labels:
        raise ValueError(
            f"{labels_csv.name} has no label columns next to 'volume'."
        )

    for label in labels:
        frame[label] = (
            pd.to_numeric(frame[label], errors="coerce")
            .fillna(0)
            .astype(np.float32)
            .clip(0, 1)
        )

    if "split" not in frame.columns:
        group_key = "patient" if "patient" in frame.columns else "volume"
        groups = frame[group_key].astype(str).unique().tolist()
        rng = random.Random(SEED)
        rng.shuffle(groups)

        train_cut = int(len(groups) * 0.70)
        val_cut = int(len(groups) * 0.85)

        assignment = {}

        for position, group in enumerate(groups):
            if position < train_cut:
                assignment[group] = "train"
            elif position < val_cut:
                assignment[group] = "val"
            else:
                assignment[group] = "test"

        frame["split"] = frame[group_key].astype(str).map(assignment)

    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    prepared_paths: list[str | None] = []

    for position, name in enumerate(frame["volume"].astype(str)):
        source_path = source_dir / name

        if not source_path.exists():
            print(f"Missing volume, skipped: {source_path}")
            prepared_paths.append(None)
            continue

        try:
            volume = load_nifti_volume(source_path, target_shape, hu_window)
        except Exception as error:
            print(f"Could not read {name}: {error}")
            prepared_paths.append(None)
            continue

        file_path = volumes_dir / f"{position:05d}.npy"
        np.save(file_path, volume)
        prepared_paths.append(
            str(file_path.relative_to(PROJECT_ROOT)).replace("\\", "/")
        )

        if (position + 1) % 25 == 0:
            print(f"Prepared {position + 1} / {len(frame)} volumes")

    frame["volume_path"] = prepared_paths
    frame = frame[frame["volume_path"].notna()].reset_index(drop=True)

    if frame.empty:
        raise RuntimeError(
            "No volume could be read. Check --source-dir and the file names "
            "in the labels file."
        )

    for split in ("train", "val", "test"):
        part = frame[frame["split"] == split]
        columns = ["volume_path", *labels]
        part[columns].to_csv(output_dir / f"{split}.csv", index=False)
        print(f"{split}: {len(part)} volumes")

    return {
        "dataset": "nifti",
        "source": str(source_dir),
        "about": "Clinical volumes prepared from NIfTI files.",
        "region": region,
        "labels": labels,
        "volume_shape": list(target_shape),
        "value_range": [0, 255],
        "hu_window": list(hu_window),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a volumetric dataset for one body region."
    )
    parser.add_argument(
        "region",
        help="Folder under data/ the prepared set is written to.",
    )
    parser.add_argument(
        "--dataset",
        default="nodule3d",
        choices=[
            *sorted(MEDMNIST_SOURCES),
            *sorted(REAL_SOURCES),
            "nifti",
        ],
        help="Which source to prepare.",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=28,
        choices=[28, 64],
        help=(
            "Edge length of the MedMNIST volumes. 28 trains on a CPU, 64 "
            "holds far more detail and wants a GPU."
        ),
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=None,
        help="Folder of .nii / .nii.gz files, for --dataset nifti.",
    )
    parser.add_argument(
        "--labels-csv",
        type=Path,
        default=None,
        help="CSV naming each volume and its findings, for --dataset nifti.",
    )
    """
    The shape and the window are read as separate numbers rather than as
    one comma separated string, because a Hounsfield window starts below
    zero and a lone -1000 on the command line would be taken for the
    name of an option.
    """
    parser.add_argument(
        "--target-shape",
        type=int,
        nargs=3,
        metavar=("DEPTH", "HEIGHT", "WIDTH"),
        default=[64, 64, 64],
        help="Shape every clinical volume is resampled to.",
    )
    parser.add_argument(
        "--hu-window",
        type=float,
        nargs=2,
        metavar=("LOW", "HIGH"),
        default=[-1000.0, 400.0],
        help=(
            "Hounsfield window the CT is clipped to before training. "
            "Soft tissue and lung sit in -1000 400; for bone use "
            "-200 1500."
        ),
    )
    arguments = parser.parse_args()

    target_shape = (
        int(arguments.target_shape[0]),
        int(arguments.target_shape[1]),
        int(arguments.target_shape[2]),
    )
    hu_window = (
        float(arguments.hu_window[0]),
        float(arguments.hu_window[1]),
    )

    if hu_window[0] >= hu_window[1]:
        parser.error("--hu-window needs a low value below the high one.")

    if min(target_shape) < 8:
        parser.error("--target-shape needs at least 8 voxels per side.")

    """
    The edge length goes into the folder name, so preparing a set at 64
    voxels does not overwrite the same set at 28.

    Those are two different datasets: they train two different models,
    and a model whose training data was silently replaced can no longer
    be reproduced or compared against its successor. The default size
    keeps the plain name it has always had, so nothing already prepared
    moves.
    """
    dataset_folder = arguments.dataset

    if arguments.dataset in MEDMNIST_SOURCES and arguments.size != 28:
        dataset_folder = f"{arguments.dataset}_{arguments.size}"

    output_dir = (
        PROJECT_ROOT
        / "data"
        / arguments.region
        / "processed"
        / dataset_folder
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    if arguments.dataset == "nifti":
        if arguments.source_dir is None or arguments.labels_csv is None:
            parser.error(
                "--dataset nifti needs --source-dir and --labels-csv."
            )

        source_dir = arguments.source_dir

        if not source_dir.is_absolute():
            source_dir = (PROJECT_ROOT / source_dir).resolve()

        labels_csv = arguments.labels_csv

        if not labels_csv.is_absolute():
            labels_csv = (PROJECT_ROOT / labels_csv).resolve()

        descriptor = prepare_nifti(
            region=arguments.region,
            source_dir=source_dir,
            labels_csv=labels_csv,
            target_shape=target_shape,
            hu_window=hu_window,
            output_dir=output_dir,
        )
    elif arguments.dataset in REAL_SOURCES:
        descriptor = prepare_real_source(
            dataset_key=arguments.dataset,
            region=arguments.region,
            target_shape=target_shape,
            output_dir=output_dir,
        )
    else:
        descriptor = prepare_medmnist(
            dataset_key=arguments.dataset,
            region=arguments.region,
            size=arguments.size,
            output_dir=output_dir,
        )

    (output_dir / "dataset.json").write_text(
        json.dumps(descriptor, indent=2),
        encoding="utf-8",
    )

    print(f"\nPrepared: {output_dir}")
    print("Labels:", ", ".join(descriptor["labels"]))
    print("Volume shape:", descriptor["volume_shape"])
    print(
        "\nNext:\n"
        f"    python scripts/train_region_3d.py {arguments.region} "
        f"--dataset {dataset_folder}"
    )


if __name__ == "__main__":
    main()
