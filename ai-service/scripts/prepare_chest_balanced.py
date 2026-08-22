"""
Builds a balanced normal/abnormal chest set.

The triage model reads a normal chest correctly 74% of the time. The
reason is in the data it learned from, not in the training run:

    train: 3301 abnormal against 1147 normal, so 2.9 to 1

A model shown three sick chests for every healthy one leans towards
calling a chest sick. Class weights push back on that, but they cannot
invent the variety of healthy chests the model never saw.

CheXpert is already on this machine and holds 16,974 frontal images
marked "No Finding". This script copies enough of them to balance the
two classes, keeping the existing pneumonia set as the abnormal side.

Patients are never split across train, validation and test: two images
of the same chest are not two independent examples, and letting them
straddle a split makes the test score look better than the model is.

Run:

    python scripts/prepare_chest_balanced.py
    python scripts/prepare_chest_balanced.py --chexpert "D:/AI-Datasets/CheXpert/extracted"
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import pandas as pd
from PIL import Image

AI_SERVICE_DIR = Path(__file__).resolve().parent.parent

SOURCE_DIR = AI_SERVICE_DIR / "data" / "chest" / "processed"
OUTPUT_DIR = AI_SERVICE_DIR / "data" / "chest_balanced" / "processed"

SPLITS = ("train", "val", "test")
CLASSES = ("NORMAL", "ABNORMAL")


def count_images(folder: Path) -> int:
    if not folder.exists():
        return 0

    return sum(1 for path in folder.rglob("*") if path.is_file())


def copy_existing() -> dict[str, dict[str, int]]:
    """
    Carries the current set over untouched. The abnormal side and the
    normal images already in place stay exactly as they are, so the only
    change measured later is the normal images that were added.
    """
    counts: dict[str, dict[str, int]] = {}

    for split in SPLITS:
        counts[split] = {}

        for name in CLASSES:
            source = SOURCE_DIR / split / name
            target = OUTPUT_DIR / split / name

            target.mkdir(parents=True, exist_ok=True)

            copied = 0

            for path in sorted(source.rglob("*")):
                if not path.is_file():
                    continue

                destination = target / f"orig_{path.name}"

                if not destination.exists():
                    shutil.copy2(path, destination)

                copied += 1

            counts[split][name] = copied

    return counts


def readable(path: Path) -> bool:
    """
    A file that cannot be decoded stops a training run in its tracks, so
    each image is opened once here instead.
    """
    try:
        with Image.open(path) as image:
            image.verify()

        return True
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chexpert",
        default=r"D:/AI-Datasets/CheXpert/extracted",
        help="Folder holding train.csv and the patient folders.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Cap on the normal images added; 0 means as many as needed.",
    )
    arguments = parser.parse_args()

    chexpert_root = Path(arguments.chexpert)
    table_path = chexpert_root / "train.csv"

    if not table_path.exists():
        raise SystemExit(f"CheXpert train.csv not found at {table_path}")

    print("Copying the existing set...")
    counts = copy_existing()

    for split in SPLITS:
        print(f"  {split}: {counts[split]}")

    """
    How many normal images each split needs so that the two classes
    match. The abnormal side is left alone: throwing away sick images to
    reach a balance would lose the findings the model has to recognise.
    """
    needed = {
        split: max(0, counts[split]["ABNORMAL"] - counts[split]["NORMAL"])
        for split in SPLITS
    }

    total_needed = sum(needed.values())

    print(f"\nNormal images needed: {needed} (total {total_needed})")

    if total_needed == 0:
        print("The set is already balanced.")
        return

    print("\nReading the CheXpert table...")
    table = pd.read_csv(table_path)

    frontal = table[table["Frontal/Lateral"] == "Frontal"]
    normal = frontal[frontal["No Finding"] == 1.0].copy()

    """
    The path in the table starts with the dataset name, which is the
    folder it was zipped in rather than a folder on disk here.
    """
    normal["relative"] = normal["Path"].str.replace(
        "CheXpert-v1.0-small/",
        "",
        regex=False,
    )

    normal["patient"] = normal["relative"].str.split("/").str[1]

    patients = sorted(normal["patient"].unique())

    print(f"  frontal images marked No Finding: {len(normal)}")
    print(f"  patients: {len(patients)}")

    if arguments.limit:
        total_needed = min(total_needed, arguments.limit)

    """
    Splits are filled patient by patient, in the order train, val, test,
    so every image of one patient lands in a single split.
    """
    order = ["train", "val", "test"]
    remaining = dict(needed)

    added = {split: 0 for split in SPLITS}
    skipped_unreadable = 0
    skipped_missing = 0

    patient_groups = normal.groupby("patient")

    for patient in patients:
        target_split = next(
            (split for split in order if remaining.get(split, 0) > 0),
            None,
        )

        if target_split is None:
            break

        destination_folder = OUTPUT_DIR / target_split / "NORMAL"

        for relative in patient_groups.get_group(patient)["relative"]:
            if remaining[target_split] <= 0:
                break

            source = chexpert_root / relative

            if not source.exists():
                skipped_missing += 1
                continue

            if not readable(source):
                skipped_unreadable += 1
                continue

            name = "chex_" + relative.replace("/", "_")

            destination = destination_folder / name

            if not destination.exists():
                shutil.copy2(source, destination)

            added[target_split] += 1
            remaining[target_split] -= 1

    print("\nAdded normal images:")

    for split in SPLITS:
        print(f"  {split}: {added[split]}")

    if skipped_missing:
        print(f"  missing on disk: {skipped_missing}")

    if skipped_unreadable:
        print(f"  unreadable: {skipped_unreadable}")

    print("\nFinal counts:")

    for split in SPLITS:
        line = {
            name: count_images(OUTPUT_DIR / split / name) for name in CLASSES
        }

        print(f"  {split}: {line}")

    print(f"\nWritten to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
