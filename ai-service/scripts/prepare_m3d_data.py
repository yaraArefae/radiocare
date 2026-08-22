"""
Cuts labelled patches out of the M3D-Seg collections.

M3D-Seg is published in twenty six independent archives, each one a
separate segmentation collection with its own organs. That is what makes
it usable here: the whole thing is 240 GB, and a single archive holding
a whole organ with its tumours is under a gigabyte, so a region can be
added for the cost of a short download instead of an afternoon.

    python scripts/prepare_m3d_data.py list
    python scripts/prepare_m3d_data.py 0005 --finding Tumor --region abdomen

The format, which is why this script exists rather than reusing the
NIfTI path:

    0005/0005.json              the organ names, one per mask channel
    0005/15/image.npy           (1, D, H, W) float32, already normalised
    0005/15/mask_(4,D,H,W).npz  a scipy sparse matrix, one row per organ

The masks are stored sparse because an organ occupies a fraction of a
scan, and the images arrive already standardised rather than in
Hounsfield units, so no window is applied to them.

Patches are cut the same way scripts/extract_3d_patches.py cuts them
from the Decathlon, and split by study for the same reason: patches from
one patient look alike, and a split drawn over patches lets the model
recognise the patient instead of the disease.
"""

from __future__ import annotations

import argparse
import io
import json
import random
import re
import shutil
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_3d_patches import (  # noqa: E402
    MINIMUM_LESION_VOXELS,
    cut_patch,
    sample_negative_centres,
    sample_positive_centres,
    split_by_study,
)
from prepare_3d_data import PROJECT_ROOT, SOURCE_CACHE  # noqa: E402

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

M3D_BASE = (
    "https://huggingface.co/datasets/GoodBaiBai88/M3D-Seg/"
    "resolve/main/M3D_Seg/"
)

"""
Anything whose name reads as a lesion rather than an organ. A collection
with none of these can only teach where an organ is, which is a router
and not a diagnosis, and the script says so instead of training one.
"""
LESION_PATTERN = re.compile(
    r"tumor|tumour|cancer|lesion|nodule|metasta|stone|cyst",
    re.IGNORECASE,
)


def archive_for(part: str) -> Path:
    return SOURCE_CACHE / "m3d" / f"{part}.zip"


def read_descriptor(archive: Path) -> tuple[dict, str]:
    """
    Reads the collection's own description, which names every mask
    channel. The channel order is the label order minus the background,
    and that mapping is the only thing standing between "channel 3" and
    "this is the tumour".
    """
    with zipfile.ZipFile(archive) as bundle:
        name = next(
            item for item in bundle.namelist() if item.endswith(".json")
        )
        return json.loads(bundle.read(name).decode("utf-8")), name


def lesion_labels(descriptor: dict) -> list[tuple[int, str]]:
    """
    The mask channels that hold a lesion, as (channel, name).

    Channel numbering starts at zero for label 1, because label 0 is the
    background and has no channel of its own.
    """
    found: list[tuple[int, str]] = []

    for key, name in descriptor.get("labels", {}).items():
        index = int(key)

        if index == 0:
            continue

        if LESION_PATTERN.search(str(name)):
            found.append((index - 1, str(name)))

    return found


def load_case(
    bundle: zipfile.ZipFile,
    image_path: str,
    mask_path: str,
) -> tuple[np.ndarray, np.ndarray]:
    from scipy import sparse

    image = np.load(io.BytesIO(bundle.read(image_path)))

    if image.ndim == 4:
        image = image[0]

    """
    The shape the sparse mask has to be folded back into is written into
    its own file name, which is the only place it is recorded.
    """
    shape = tuple(
        int(value)
        for value in re.findall(r"\d+", mask_path.rsplit("/", 1)[-1])
    )

    matrix = sparse.load_npz(io.BytesIO(bundle.read(mask_path)))
    mask = np.asarray(matrix.todense()).reshape(shape)

    return image.astype(np.float32), mask.astype(np.uint8)


def to_bytes(volume: np.ndarray) -> np.ndarray:
    """
    Stretches a standardised volume into the byte range every other
    dataset here is stored in, so one training script reads them all.
    """
    low = float(np.percentile(volume, 1))
    high = float(np.percentile(volume, 99))

    if high - low < 1e-6:
        low, high = float(volume.min()), float(volume.max())

    scaled = np.clip((volume - low) / max(high - low, 1e-6), 0.0, 1.0)
    return (scaled * 255.0).astype(np.uint8)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cut patches out of an M3D-Seg collection."
    )
    parser.add_argument(
        "part",
        help="Archive number, such as 0005, or 'list' to describe them all.",
    )
    parser.add_argument(
        "--finding",
        default=None,
        help=(
            "Which mask channels to read as the finding, as a pattern "
            "matched against their names. Every channel that matches is "
            "merged into one, which is the only correct reading of a "
            "collection that numbers each tumour separately: IRCAD "
            "writes a patient's seven liver tumours as livertumor01 to "
            "livertumor07, and taking one channel would label the other "
            "six as healthy tissue."
        ),
    )
    parser.add_argument("--region", default="abdomen")
    parser.add_argument("--label", default=None, help="Column name to write.")
    parser.add_argument(
        "--patch-size",
        type=int,
        nargs=3,
        metavar=("DEPTH", "HEIGHT", "WIDTH"),
        default=[64, 64, 64],
    )
    parser.add_argument("--per-study", type=int, default=16)
    parser.add_argument("--jitter", type=int, default=8)
    arguments = parser.parse_args()

    if arguments.part == "list":
        for archive in sorted((SOURCE_CACHE / "m3d").glob("*.zip")):
            descriptor, _ = read_descriptor(archive)
            lesions = lesion_labels(descriptor)
            organs = list(descriptor.get("labels", {}).values())[1:]

            print(
                f"{archive.stem}  "
                f"{(descriptor.get('numTrain') or 0) + (descriptor.get('numTest') or 0):>4} cases  "
                f"{', '.join(organs)[:60]}"
            )
            print(
                "      "
                + (
                    "lesions: " + ", ".join(name for _, name in lesions)
                    if lesions
                    else "anatomy only, no finding to train on"
                )
            )

        return

    archive = archive_for(arguments.part)

    if not archive.exists():
        raise SystemExit(
            f"{archive} is not downloaded. Fetch it from\n"
            f"    {M3D_BASE}{arguments.part}.zip"
        )

    descriptor, _ = read_descriptor(archive)
    lesions = lesion_labels(descriptor)

    if not lesions:
        raise SystemExit(
            f"{arguments.part} marks only anatomy, so it can teach where "
            "an organ is and not whether it is diseased. Nothing to train."
        )

    if arguments.finding:
        pattern = re.compile(arguments.finding, re.IGNORECASE)
        chosen = [item for item in lesions if pattern.search(item[1])]

        if not chosen:
            raise SystemExit(
                f"{arguments.finding!r} matches no lesion in this "
                "collection. It holds: "
                + ", ".join(name for _, name in lesions)
            )
    else:
        chosen = [lesions[0]]

    channels = [index for index, _ in chosen]
    finding_name = ", ".join(name for _, name in chosen)

    print(f"Reading {len(channels)} channel(s) as the finding: {finding_name}")

    label = arguments.label or (
        re.sub(r"[^a-z0-9]+", "_", chosen[0][1].lower()).strip("_")
    )

    patch_size = (
        arguments.patch_size[0],
        arguments.patch_size[1],
        arguments.patch_size[2],
    )

    name = f"m3d_{arguments.part}_{label}"
    output_dir = (
        PROJECT_ROOT / "data" / arguments.region / "processed" / name
    )
    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    rows: list[dict] = []
    written = 0
    wanted_each = max(1, arguments.per_study // 2)

    with zipfile.ZipFile(archive) as bundle:
        masks = sorted(
            item for item in bundle.namelist() if item.endswith(".npz")
        )

        print(
            f"{arguments.part}: {len(masks)} cases, "
            f"{len(channels)} channel(s) merged into {label}"
        )

        for position, mask_path in enumerate(masks):
            folder = mask_path.rsplit("/", 1)[0]
            image_path = f"{folder}/image.npy"

            try:
                image, mask = load_case(bundle, image_path, mask_path)
            except Exception as error:
                print(f"Could not read {folder}: {str(error)[:60]}")
                continue

            usable = [c for c in channels if c < mask.shape[0]]

            if not usable:
                continue

            volume = to_bytes(image)

            """
            Every matching channel folded into one mask. A collection
            that numbers each tumour separately would otherwise have all
            but the first counted as healthy tissue, and the model would
            be taught that a tumour is not one.
            """
            lesion = np.zeros(mask.shape[1:], dtype=np.uint8)

            for c in usable:
                lesion |= (mask[c] > 0).astype(np.uint8)

            if int(lesion.sum()) < MINIMUM_LESION_VOXELS:
                """
                A case where this organ has no lesion still teaches the
                model what healthy tissue looks like, so its patches are
                kept as negatives instead of the case being skipped.
                """
                centres = [
                    (centre, 0.0)
                    for centre in sample_negative_centres(
                        lesion,
                        volume,
                        1,
                        patch_size,
                        wanted_each,
                        rng,
                    )
                ]
            else:
                centres = [
                    (centre, 1.0)
                    for centre in sample_positive_centres(
                        lesion,
                        1,
                        wanted_each,
                        arguments.jitter,
                        rng,
                    )
                ]
                centres += [
                    (centre, 0.0)
                    for centre in sample_negative_centres(
                        lesion,
                        volume,
                        1,
                        patch_size,
                        wanted_each,
                        rng,
                    )
                ]

            study_id = f"{arguments.part}_{folder.rsplit('/', 1)[-1]}"

            for centre, value in centres:
                patch = cut_patch(volume, centre, patch_size)
                file_path = volumes_dir / f"{written:06d}.npy"
                np.save(file_path, patch)

                rows.append(
                    {
                        "volume_path": str(
                            file_path.relative_to(PROJECT_ROOT)
                        ).replace("\\", "/"),
                        "patient": study_id,
                        label: value,
                    }
                )
                written += 1

            if (position + 1) % 10 == 0:
                print(f"  {position + 1} / {len(masks)} cases, {written} patches")

    if not rows:
        raise SystemExit("No patch could be cut.")

    frame = pd.DataFrame(rows)
    positives = int(frame[label].sum())

    if not 0.05 <= positives / len(frame) <= 0.95:
        raise SystemExit(
            f"{positives} of {len(frame)} patches carry {label}. A model "
            "would reach that score by answering the same thing every "
            "time, so there is nothing to learn here."
        )

    frame["split"] = split_by_study(frame, label)

    for split in ("train", "val", "test"):
        part_frame = frame[frame["split"] == split]
        part_frame[["volume_path", label]].to_csv(
            output_dir / f"{split}.csv",
            index=False,
        )
        print(
            f"{split}: {len(part_frame)} patches from "
            f"{part_frame['patient'].nunique()} cases "
            f"({int(part_frame[label].sum())} with the finding)"
        )

    frame[["volume_path", "patient", label, "split"]].to_csv(
        output_dir / "patches_by_study.csv",
        index=False,
    )

    (output_dir / "dataset.json").write_text(
        json.dumps(
            {
                "dataset": name,
                "source": f"M3D-Seg {arguments.part}",
                "about": (
                    f"{finding_name} in {descriptor.get('name', arguments.part)}, "
                    f"cut into patches of {list(patch_size)} voxels and "
                    "split by case so no patient appears on two sides."
                ),
                "region": arguments.region,
                "modality": list(
                    descriptor.get("modality", {"0": "CT"}).values()
                )[0],
                "labels": [label],
                "volume_shape": list(patch_size),
                "value_range": [0, 255],
                "cases": int(frame["patient"].nunique()),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\n{written} patches from {frame['patient'].nunique()} cases")
    print(f"Prepared: {output_dir}")
    print(
        f"\nNext:\n    python scripts/train_region_3d.py "
        f"{arguments.region} --dataset {name}"
    )


if __name__ == "__main__":
    main()
