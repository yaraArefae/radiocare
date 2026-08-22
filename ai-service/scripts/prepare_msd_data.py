"""
Prepares the Medical Segmentation Decathlon for this project.

The Decathlon is ten collections of whole volumes covering ten organs
across CT and MRI, published openly and downloadable without an account
or an agreement. It is the widest free source of volumetric data there
is, and it is what lets this project reach past the chest.

It ships segmentation masks rather than diagnoses, so a mask has to be
turned into an answer a classifier can be trained on. There are only two
honest ways to do that, and this script does both and nothing else.

    router     Which organ, and from which kind of scan. Built by
               taking several collections at once and labelling every
               volume with the collection it came from. Not a diagnosis:
               it is the front door of a system that reads many organs,
               and it is the only thing the organ only collections can
               truthfully teach.

    finding    Whether a named structure appears in the mask at all.
               This is a real reading, and it works only for the
               collections whose masks mark a lesion apart from the
               organ around it: a liver mask that marks the tumour
               separately can answer whether there is a tumour, while a
               heart mask that marks only the atrium cannot.

    python scripts/prepare_msd_data.py router --tasks heart hippocampus prostate
    python scripts/prepare_msd_data.py finding --task liver

Output, in the layout every other dataset here uses, so
scripts/train_region_3d.py reads it without knowing where it came from:

    data/<region>/processed/<name>/{train,val,test}.csv
    data/<region>/processed/<name>/volumes/*.npy
    data/<region>/processed/<name>/dataset.json
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import tarfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from prepare_3d_data import (  # noqa: E402
    PROJECT_ROOT,
    SOURCE_CACHE,
    download_if_missing,
    load_nifti_volume,
)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

MSD_BUCKET = "https://msd-for-monai.s3-us-west-2.amazonaws.com"

"""
The ten collections.

`channel` picks one image out of the several a study can hold: a brain
MRI in this collection carries four sequences stacked together, and a
network fed all four at once would be reading a different thing from the
one a radiologist looks at. The post contrast sequence is the one that
shows enhancement, so that is the one taken.

`finding` names the value the mask uses for the lesion, and is absent
for the collections that mark only anatomy. Those can be used to teach
the router and nothing more, which is stated rather than worked around.

`window` is the Hounsfield range for a CT. MRI carries no such scale, so
it is None and the volume is stretched between its own extremes.
"""
MSD_TASKS: dict[str, dict] = {
    "brain_tumour": {
        "task": "Task01_BrainTumour",
        "region": "head",
        "modality": "MRI",
        "organ": "brain",
        "channel": 2,
        "window": None,
        "size_gb": 7.6,
        "finding": {
            "label": "enhancing_brain_tumour",
            "mask_value": 3,
            "about": (
                "Every study in this collection holds a glioma, so the "
                "reading is not whether a tumour is there. It is "
                "whether the tumour takes up contrast, which is what "
                "separates a high grade glioma from a low grade one."
            ),
        },
    },
    "heart": {
        "task": "Task02_Heart",
        "region": "heart",
        "modality": "MRI",
        "organ": "heart",
        "channel": 0,
        "window": None,
        "size_gb": 0.46,
        "finding": None,
    },
    "liver": {
        "task": "Task03_Liver",
        "region": "abdomen",
        "modality": "CT",
        "organ": "liver",
        "channel": 0,
        "window": (-150.0, 250.0),
        "size_gb": 28.9,
        "finding": {
            "label": "liver_tumour",
            "mask_value": 2,
            "about": "The mask marks the tumour apart from the liver.",
        },
    },
    "hippocampus": {
        "task": "Task04_Hippocampus",
        "region": "head",
        "modality": "MRI",
        "organ": "hippocampus",
        "channel": 0,
        "window": None,
        "size_gb": 0.03,
        "finding": None,
    },
    "prostate": {
        "task": "Task05_Prostate",
        "region": "pelvis",
        "modality": "MRI",
        "organ": "prostate",
        "channel": 0,
        "window": None,
        "size_gb": 0.24,
        "finding": None,
    },
    "lung": {
        "task": "Task06_Lung",
        "region": "chest",
        "modality": "CT",
        "organ": "lung",
        "channel": 0,
        "window": (-1000.0, 400.0),
        "size_gb": 9.2,
        "finding": {
            "label": "lung_tumour",
            "mask_value": 1,
            "about": "The mask marks the tumour only.",
        },
    },
    "pancreas": {
        "task": "Task07_Pancreas",
        "region": "abdomen",
        "modality": "CT",
        "organ": "pancreas",
        "channel": 0,
        "window": (-150.0, 250.0),
        "size_gb": 12.3,
        "finding": {
            "label": "pancreas_tumour",
            "mask_value": 2,
            "about": "The mask marks the tumour apart from the organ.",
        },
    },
    "hepatic_vessel": {
        "task": "Task08_HepaticVessel",
        "region": "abdomen",
        "modality": "CT",
        "organ": "hepatic_vessel",
        "channel": 0,
        "window": (-150.0, 250.0),
        "size_gb": 9.4,
        "finding": {
            "label": "hepatic_vessel_tumour",
            "mask_value": 2,
            "about": "The mask marks the tumour apart from the vessel.",
        },
    },
    "spleen": {
        "task": "Task09_Spleen",
        "region": "abdomen",
        "modality": "CT",
        "organ": "spleen",
        "channel": 0,
        "window": (-150.0, 250.0),
        "size_gb": 1.6,
        "finding": None,
    },
    "colon": {
        "task": "Task10_Colon",
        "region": "abdomen",
        "modality": "CT",
        "organ": "colon",
        "channel": 0,
        "window": (-150.0, 250.0),
        "size_gb": 6.2,
        "finding": {
            "label": "colon_tumour",
            "mask_value": 1,
            "about": "The mask marks the cancer only.",
        },
    },
}


def extract_tar(archive: Path, destination: Path) -> Path:
    """
    Unpacks one collection once. The marker file is what makes a rerun
    cheap: checking that the folder merely exists would call a run that
    died halfway through complete.
    """
    marker = destination / ".extracted"

    if marker.exists():
        print(f"Already extracted: {archive.name}")
        return destination

    destination.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {archive.name}, this takes a while")

    with tarfile.open(archive) as bundle:
        bundle.extractall(destination, filter="data")

    marker.write_text("ok", encoding="utf-8")
    return destination


def task_folder(key: str) -> Path:
    """
    Downloads and unpacks one collection, and returns the folder holding
    its images and masks.
    """
    definition = MSD_TASKS[key]
    name = definition["task"]

    archive = download_if_missing(
        f"{MSD_BUCKET}/{name}.tar",
        SOURCE_CACHE / "msd" / f"{name}.tar",
    )
    root = extract_tar(archive, SOURCE_CACHE / "msd" / name)

    inner = root / name

    return inner if inner.exists() else root


def list_cases(folder: Path) -> list[tuple[Path, Path]]:
    """
    Pairs every image with its mask.

    The archives were built on a Mac and carry a shadow file beside each
    real one, starting with "._". Those are not volumes, and reading one
    fails in a way that looks like a corrupt download, so they are
    dropped here where the reason is obvious.
    """
    images_dir = folder / "imagesTr"
    labels_dir = folder / "labelsTr"

    if not images_dir.exists():
        raise FileNotFoundError(f"No imagesTr folder in {folder}")

    cases: list[tuple[Path, Path]] = []

    for image_path in sorted(images_dir.glob("*.nii.gz")):
        if image_path.name.startswith("._"):
            continue

        mask_path = labels_dir / image_path.name

        if not mask_path.exists():
            continue

        cases.append((image_path, mask_path))

    return cases


def read_channel(
    path: Path,
    channel: int,
    target_shape: tuple[int, int, int],
    window: tuple[float, float] | None,
) -> np.ndarray:
    """
    Reads one sequence out of a study that may hold several.

    load_nifti_volume takes the first channel of a 4D volume, which is
    the right default but not always the right choice, so a study with
    more than one sequence is opened here and the wanted one is written
    out on its own first.
    """
    import nibabel

    image = nibabel.load(str(path))

    if len(image.shape) == 4 and channel > 0:
        data = np.asarray(
            image.dataobj[..., min(channel, image.shape[3] - 1)],
            dtype=np.float32,
        )
        temporary = nibabel.Nifti1Image(data, image.affine)
        scratch = path.parent / f"_channel_{channel}_{path.name}"
        nibabel.save(temporary, str(scratch))

        try:
            return load_nifti_volume(scratch, target_shape, window or (0.0, 1.0))
        finally:
            scratch.unlink(missing_ok=True)

    return load_nifti_volume(path, target_shape, window or (0.0, 1.0))


def mask_has_value(path: Path, value: int) -> bool:
    """
    Answers whether the mask marks the structure anywhere in the study.

    A handful of stray voxels is a labelling slip rather than a lesion,
    so a floor is applied. Without it a study is called positive because
    of noise, and the model is taught to find noise.
    """
    import nibabel

    mask = np.asarray(nibabel.load(str(path)).dataobj)
    return int((mask == value).sum()) >= 50


def stratified_split(frame: pd.DataFrame, labels: list[str]) -> list[str]:
    """
    Draws the split so every label lands on all three sides.

    The Decathlon ships no split of its own, and drawing one at random
    can leave a rare finding entirely inside the training set, which
    makes the test score unmeasurable rather than merely noisy.
    """
    rng = random.Random(SEED)
    assignments = [""] * len(frame)
    key = frame[labels].astype(int).astype(str).agg("".join, axis=1)

    for group in sorted(key.unique()):
        positions = frame.index[key == group].tolist()
        rng.shuffle(positions)

        train_cut = max(1, int(len(positions) * 0.70))
        val_cut = max(train_cut + 1, int(len(positions) * 0.85))

        for order, index in enumerate(positions):
            if order < train_cut:
                assignments[index] = "train"
            elif order < val_cut:
                assignments[index] = "val"
            else:
                assignments[index] = "test"

    return assignments


def write_dataset(
    rows: list[dict],
    labels: list[str],
    output_dir: Path,
    descriptor: dict,
) -> None:
    frame = pd.DataFrame(rows)
    frame["split"] = stratified_split(frame, labels)

    for split in ("train", "val", "test"):
        part = frame[frame["split"] == split]
        part[["volume_path", *labels]].to_csv(
            output_dir / f"{split}.csv",
            index=False,
        )
        counts = ", ".join(
            f"{label}={int(part[label].sum())}" for label in labels
        )
        print(f"{split}: {len(part)} volumes  ({counts})")

    (output_dir / "dataset.json").write_text(
        json.dumps(descriptor, indent=2),
        encoding="utf-8",
    )


def prepare_router(
    keys: list[str],
    target_shape: tuple[int, int, int],
    output_dir: Path,
) -> None:
    """
    Builds one dataset out of several collections, labelled by which
    organ and which kind of scan each volume came from.
    """
    labels = [f"organ_{MSD_TASKS[key]['organ']}" for key in keys]
    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    position = 0

    for key in keys:
        definition = MSD_TASKS[key]
        folder = task_folder(key)
        cases = list_cases(folder)
        print(f"\n{key}: {len(cases)} studies")

        for image_path, _ in cases:
            try:
                volume = read_channel(
                    image_path,
                    definition["channel"],
                    target_shape,
                    definition["window"],
                )
            except Exception as error:
                print(f"Could not read {image_path.name}: {error}")
                continue

            file_path = volumes_dir / f"{position:05d}.npy"
            np.save(file_path, volume)

            row = {
                "volume_path": str(
                    file_path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/")
            }

            for label in labels:
                row[label] = 0.0

            row[f"organ_{definition['organ']}"] = 1.0
            rows.append(row)
            position += 1

            if position % 25 == 0:
                print(f"  read {position} studies so far")

    if not rows:
        raise RuntimeError("No study could be read.")

    write_dataset(
        rows,
        labels,
        output_dir,
        {
            "dataset": "msd_router",
            "source": MSD_BUCKET,
            "about": (
                "Which organ and which kind of scan a volume is. Built "
                "from "
                + ", ".join(MSD_TASKS[key]["task"] for key in keys)
                + ". This names the study, it does not read it."
            ),
            "region": "multi_organ",
            "labels": labels,
            "modalities": sorted(
                {MSD_TASKS[key]["modality"] for key in keys}
            ),
            "volume_shape": list(target_shape),
            "value_range": [0, 255],
        },
    )


def prepare_finding(
    key: str,
    target_shape: tuple[int, int, int],
    output_dir: Path,
) -> None:
    """
    Builds a dataset that answers whether the marked lesion is present.
    """
    definition = MSD_TASKS[key]
    finding = definition["finding"]

    if finding is None:
        raise SystemExit(
            f"{key} marks only anatomy, so it cannot teach a finding. "
            "Use it with the router instead."
        )

    labels = [finding["label"]]
    folder = task_folder(key)
    cases = list_cases(folder)
    print(f"\n{key}: {len(cases)} studies")

    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []

    for position, (image_path, mask_path) in enumerate(cases):
        try:
            present = mask_has_value(mask_path, finding["mask_value"])
            volume = read_channel(
                image_path,
                definition["channel"],
                target_shape,
                definition["window"],
            )
        except Exception as error:
            print(f"Could not read {image_path.name}: {error}")
            continue

        file_path = volumes_dir / f"{position:05d}.npy"
        np.save(file_path, volume)

        rows.append(
            {
                "volume_path": str(
                    file_path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/"),
                labels[0]: 1.0 if present else 0.0,
            }
        )

        if (position + 1) % 25 == 0:
            print(f"  read {position + 1} / {len(cases)} studies")

    if not rows:
        raise RuntimeError("No study could be read.")

    positives = int(sum(row[labels[0]] for row in rows))

    """
    A collection where nearly every study carries the finding cannot
    teach a model to tell it apart from its absence.

    This check first asked only whether the answers were all identical,
    and the brain tumour collection walked straight through it at 96 per
    cent positive. A model trained on that scores 96 per cent by
    answering yes to everything, which reads as success and is worth
    nothing. One case in twenty is not a minority class, it is noise, so
    the bar is a share rather than a count.

    A collection that fails here is not useless. Cutting patches out of
    the same studies, around the lesion and away from it, produces a
    balanced set from exactly this data, which is what
    scripts/extract_3d_patches.py is for.
    """
    share = positives / len(rows)

    if not 0.05 <= share <= 0.95:
        raise SystemExit(
            f"{positives} of {len(rows)} studies carry {labels[0]}, "
            f"which is {share:.0%}. A model would reach that score by "
            "answering the same thing every time, so there is nothing "
            "to learn here. "
            "Cut patches from these studies instead: "
            f"    python scripts/extract_3d_patches.py {key}"
        )

    write_dataset(
        rows,
        labels,
        output_dir,
        {
            "dataset": f"msd_{key}",
            "source": f"{MSD_BUCKET}/{definition['task']}.tar",
            "about": finding["about"],
            "region": definition["region"],
            "modality": definition["modality"],
            "labels": labels,
            "volume_shape": list(target_shape),
            "value_range": [0, 255],
            **(
                {"hu_window": list(definition["window"])}
                if definition["window"]
                else {}
            ),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare the Medical Segmentation Decathlon."
    )
    parser.add_argument("mode", choices=["router", "finding", "list"])
    parser.add_argument(
        "--tasks",
        nargs="+",
        default=["heart", "hippocampus", "prostate"],
        choices=sorted(MSD_TASKS),
        help="Collections to build the router from.",
    )
    parser.add_argument(
        "--task",
        default="liver",
        choices=sorted(MSD_TASKS),
        help="Collection to read a finding from.",
    )
    parser.add_argument(
        "--region",
        default=None,
        help="Folder under data/ to write to. Defaults per mode.",
    )
    parser.add_argument(
        "--target-shape",
        type=int,
        nargs=3,
        metavar=("DEPTH", "HEIGHT", "WIDTH"),
        default=[64, 64, 64],
        help="Shape every volume is resampled to.",
    )
    arguments = parser.parse_args()

    if arguments.mode == "list":
        print(
            f"{'key':16s} {'collection':22s} {'scan':5s} "
            f"{'size':>7s}  can teach"
        )
        print("-" * 74)

        for key, definition in MSD_TASKS.items():
            teaches = (
                definition["finding"]["label"]
                if definition["finding"]
                else "the router only"
            )
            print(
                f"{key:16s} {definition['task']:22s} "
                f"{definition['modality']:5s} "
                f"{definition['size_gb']:6.1f}G  {teaches}"
            )

        return

    target_shape = (
        arguments.target_shape[0],
        arguments.target_shape[1],
        arguments.target_shape[2],
    )

    if arguments.mode == "router":
        region = arguments.region or "multi_organ"
        name = "msd_router"
    else:
        region = arguments.region or MSD_TASKS[arguments.task]["region"]
        name = f"msd_{arguments.task}"

    output_dir = PROJECT_ROOT / "data" / region / "processed" / name
    output_dir.mkdir(parents=True, exist_ok=True)

    if arguments.mode == "router":
        prepare_router(arguments.tasks, target_shape, output_dir)
    else:
        prepare_finding(arguments.task, target_shape, output_dir)

    print(f"\nPrepared: {output_dir}")
    print(
        f"\nNext:\n    python scripts/train_region_3d.py {region} "
        f"--dataset {name}"
    )


if __name__ == "__main__":
    main()
