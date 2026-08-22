"""
Cuts many labelled sub volumes out of a few whole scans.

This is the answer to the shortage that limits every 3D model in this
project. A collection of 484 annotated brain studies is a small training
set, and no larger one is published; but each of those studies is a
whole head, and a lesion occupies a small part of it. Cutting a patch
around the lesion, and other patches away from it, turns one study into
many training examples without inventing a single voxel.

It is how the small public sets this project already uses were built:
the 1633 lung nodule volumes came from about a thousand scans, one crop
per annotated nodule.

    python scripts/extract_3d_patches.py liver
    python scripts/extract_3d_patches.py brain_tumour --per-study 12

The trap this script exists to avoid
------------------------------------

Patches from one patient look alike. Split them at random and the same
patient lands on both sides of the split, the model recognises the
patient rather than the disease, and the test score comes out high and
means nothing.

Every patch here carries the study it was cut from, and the split is
drawn over studies, never over patches. A patient is on exactly one
side. The score that comes out the other end is one you can quote.

Output, in the layout the training script already reads:

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
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from prepare_msd_data import (  # noqa: E402
    MSD_TASKS,
    list_cases,
    task_folder,
)
from prepare_3d_data import PROJECT_ROOT  # noqa: E402

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

"""
A patch has to hold enough of the lesion to be worth calling positive.
A single voxel clipped by the corner of the box teaches the model that
almost nothing is a tumour.
"""
MINIMUM_LESION_VOXELS = 30


def to_display_range(
    volume: np.ndarray,
    window: tuple[float, float] | None,
) -> np.ndarray:
    """
    Clips a CT to the window its region is read in, and stretches an MRI
    between its own extremes because it carries no such scale.
    """
    volume = volume.astype(np.float32)

    if window is not None:
        low, high = window
    else:
        low = float(volume.min())
        high = float(volume.max())

    volume = np.clip(volume, low, high)
    volume = (volume - low) / max(high - low, 1e-6)
    return np.clip(volume * 255.0, 0, 255).astype(np.uint8)


def cut_patch(
    volume: np.ndarray,
    centre: tuple[int, int, int],
    size: tuple[int, int, int],
) -> np.ndarray:
    """
    Takes a box out of the volume around a point, padding with the
    darkest value where the box runs past the edge of the scan.
    """
    patch = np.zeros(size, dtype=volume.dtype)

    for_start = []
    for_end = []
    put_start = []

    for axis in range(3):
        half = size[axis] // 2
        start = centre[axis] - half
        end = start + size[axis]

        source_start = max(0, start)
        source_end = min(volume.shape[axis], end)

        for_start.append(source_start)
        for_end.append(source_end)
        put_start.append(source_start - start)

    patch[
        put_start[0]:put_start[0] + (for_end[0] - for_start[0]),
        put_start[1]:put_start[1] + (for_end[1] - for_start[1]),
        put_start[2]:put_start[2] + (for_end[2] - for_start[2]),
    ] = volume[
        for_start[0]:for_end[0],
        for_start[1]:for_end[1],
        for_start[2]:for_end[2],
    ]

    return patch


def sample_positive_centres(
    mask: np.ndarray,
    value: int,
    count: int,
    jitter: int,
    rng: random.Random,
) -> list[tuple[int, int, int]]:
    """
    Picks points inside the lesion to cut around.

    The centre is nudged off the lesion by a few voxels on purpose. A
    lesion sitting dead centre in every positive patch is a pattern the
    model can learn instead of the lesion itself, and it would then fail
    on any real scan where nobody centred it first.
    """
    positions = np.argwhere(mask == value)

    if len(positions) < MINIMUM_LESION_VOXELS:
        return []

    centres: list[tuple[int, int, int]] = []

    for _ in range(count):
        index = rng.randrange(len(positions))
        point = positions[index]
        centres.append(
            tuple(
                int(point[axis]) + rng.randint(-jitter, jitter)
                for axis in range(3)
            )
        )

    return centres


def sample_negative_centres(
    mask: np.ndarray,
    volume: np.ndarray,
    value: int,
    size: tuple[int, int, int],
    count: int,
    rng: random.Random,
) -> list[tuple[int, int, int]]:
    """
    Picks points with no lesion anywhere in the box around them.

    The points are drawn from inside the body rather than from anywhere
    in the array. Most of a CT is air, and a model trained to tell a
    tumour from empty space has learned nothing a doctor needs.
    """
    inside = np.argwhere(volume > np.percentile(volume, 40))

    if len(inside) == 0:
        return []

    centres: list[tuple[int, int, int]] = []
    attempts = 0

    while len(centres) < count and attempts < count * 20:
        attempts += 1
        point = inside[rng.randrange(len(inside))]
        centre = tuple(int(point[axis]) for axis in range(3))

        if (cut_patch(mask, centre, size) == value).sum() > 0:
            continue

        centres.append(centre)

    return centres


def split_by_study(frame: pd.DataFrame, label: str) -> list[str]:
    """
    Draws the split over studies, so every patch of one patient stays on
    one side of it.

    The studies are dealt out in order of how much of the finding they
    carry, seven to training and one to validation for every two to
    test. Dealing them in that order is what stratifies the split: a
    run of studies with no finding at all is spread across the three
    sides instead of landing on one, which is what a shuffle would
    happily do and what would leave the test set unscoreable.
    """
    per_study = frame.groupby("patient")[label].mean().sort_values()
    assignment: dict[str, str] = {}

    for order, study in enumerate(per_study.index):
        remainder = order % 10

        if remainder < 7:
            assignment[study] = "train"
        elif remainder < 8:
            assignment[study] = "val"
        else:
            assignment[study] = "test"

    return [assignment[study] for study in frame["patient"]]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cut labelled patches out of whole scans."
    )
    parser.add_argument(
        "task",
        choices=sorted(
            key
            for key, value in MSD_TASKS.items()
            if value["finding"] is not None
        ),
        help="Which collection to cut patches from.",
    )
    parser.add_argument(
        "--patch-size",
        type=int,
        nargs=3,
        metavar=("DEPTH", "HEIGHT", "WIDTH"),
        default=[64, 64, 64],
        help="Size of every patch, in voxels of the original scan.",
    )
    parser.add_argument(
        "--per-study",
        type=int,
        default=8,
        help="Patches per study, split evenly between with and without.",
    )
    parser.add_argument(
        "--jitter",
        type=int,
        default=8,
        help="How far the lesion may sit off the centre of a patch.",
    )
    parser.add_argument(
        "--limit-studies",
        type=int,
        default=None,
        help="Read only this many studies. Useful for a quick trial.",
    )
    parser.add_argument(
        "--cleanup-source",
        action="store_true",
        help=(
            "Delete the downloaded archive and its unpacked folder once "
            "the patches are cut. The patches are a hundredth of the "
            "size, so this is what lets several collections be worked "
            "through on a disk that could not hold two of them at once."
        ),
    )
    arguments = parser.parse_args()

    import nibabel

    definition = MSD_TASKS[arguments.task]
    finding = definition["finding"]
    label = finding["label"]
    patch_size = (
        arguments.patch_size[0],
        arguments.patch_size[1],
        arguments.patch_size[2],
    )

    folder = task_folder(arguments.task)
    cases = list_cases(folder)

    if arguments.limit_studies:
        cases = cases[: arguments.limit_studies]

    name = f"patches_{arguments.task}"
    output_dir = (
        PROJECT_ROOT
        / "data"
        / definition["region"]
        / "processed"
        / name
    )
    volumes_dir = output_dir / "volumes"

    if volumes_dir.exists():
        shutil.rmtree(volumes_dir)

    volumes_dir.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    rows: list[dict] = []
    written = 0
    wanted_each = max(1, arguments.per_study // 2)

    print(f"{len(cases)} studies, up to {arguments.per_study} patches each")

    for study_index, (image_path, mask_path) in enumerate(cases):
        try:
            image = nibabel.load(str(image_path))
            data = np.asarray(image.dataobj, dtype=np.float32)

            if data.ndim == 4:
                data = data[..., min(definition["channel"], data.shape[3] - 1)]

            volume = to_display_range(data, definition["window"])
            mask = np.asarray(
                nibabel.load(str(mask_path)).dataobj
            ).astype(np.int16)
        except Exception as error:
            print(f"Could not read {image_path.name}: {error}")
            continue

        study_id = image_path.name.replace(".nii.gz", "")

        centres = [
            (centre, 1.0)
            for centre in sample_positive_centres(
                mask,
                finding["mask_value"],
                wanted_each,
                arguments.jitter,
                rng,
            )
        ]

        centres += [
            (centre, 0.0)
            for centre in sample_negative_centres(
                mask,
                volume,
                finding["mask_value"],
                patch_size,
                wanted_each,
                rng,
            )
        ]

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

        if (study_index + 1) % 20 == 0:
            print(
                f"  {study_index + 1} / {len(cases)} studies, "
                f"{written} patches"
            )

    if not rows:
        raise SystemExit("No patch could be cut.")

    frame = pd.DataFrame(rows)
    positives = int(frame[label].sum())

    if positives in (0, len(frame)):
        raise SystemExit(
            f"Every patch got the same answer for {label}, so there is "
            "nothing to learn. Check the mask value in MSD_TASKS."
        )

    frame["split"] = split_by_study(frame, label)

    for split in ("train", "val", "test"):
        part = frame[frame["split"] == split]
        part[["volume_path", label]].to_csv(
            output_dir / f"{split}.csv",
            index=False,
        )
        print(
            f"{split}: {len(part)} patches from "
            f"{part['patient'].nunique()} studies "
            f"({int(part[label].sum())} with the finding)"
        )

    """
    The study each patch came from is written out beside the splits. It
    is what lets anyone check later that no patient crossed the split,
    which is the one claim this whole script rests on.
    """
    frame[["volume_path", "patient", label, "split"]].to_csv(
        output_dir / "patches_by_study.csv",
        index=False,
    )

    (output_dir / "dataset.json").write_text(
        json.dumps(
            {
                "dataset": name,
                "source": f"MSD {definition['task']}",
                "about": (
                    f"{finding['about']} Cut into patches of "
                    f"{list(patch_size)} voxels, split by study so no "
                    "patient appears on two sides."
                ),
                "region": definition["region"],
                "modality": definition["modality"],
                "labels": [label],
                "volume_shape": list(patch_size),
                "value_range": [0, 255],
                "studies": int(frame["patient"].nunique()),
                **(
                    {"hu_window": list(definition["window"])}
                    if definition["window"]
                    else {}
                ),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"\n{written} patches from {frame['patient'].nunique()} studies "
        f"({positives} with the finding)"
    )

    """
    The source is removed only after every patch and every split file is
    on disk. Deleting it earlier would turn a crash halfway through into
    a re-download of tens of gigabytes.
    """
    if arguments.cleanup_source:
        import shutil as source_shutil

        from prepare_3d_data import SOURCE_CACHE

        task_name = definition["task"]

        for path in (
            SOURCE_CACHE / "msd" / (task_name + ".tar"),
            SOURCE_CACHE / "msd" / task_name,
        ):
            if not path.exists():
                continue

            if path.is_file():
                size = path.stat().st_size
                path.unlink()
            else:
                size = sum(
                    item.stat().st_size
                    for item in path.rglob("*")
                    if item.is_file()
                )
                source_shutil.rmtree(path)

            print(f"Removed {path.name}, freeing {size / 1e9:.1f} GB")
    print(f"Prepared: {output_dir}")
    print(
        f"\nNext:\n    python scripts/train_region_3d.py "
        f"{definition['region']} --dataset {name}"
    )


if __name__ == "__main__":
    main()
