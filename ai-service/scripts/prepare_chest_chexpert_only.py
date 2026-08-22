"""
Builds a normal/abnormal chest set drawn entirely from CheXpert.

The previous attempt took normal images from CheXpert and abnormal ones
from the pneumonia set. The two classes then differed by source as well
as by pathology, and the model separated them by reading the source: it
scored well on CheXpert normals and worse than the model it replaced on
normals from the other set.

Here both classes come from one place, so the only thing that separates
them is what is in the chest.

Two rules matter for the labels:

  normal    "No Finding" is 1
  abnormal  at least one of the eight findings the clinic reports is 1

CheXpert also marks findings as uncertain, written as -1. Those images
are left out of both classes: a label the dataset itself is unsure of
teaches the model nothing reliable.

Patients never span two splits. Several images of one chest are not
independent examples, and letting them straddle a split makes the test
score look better than the model is.

Run:

    python scripts/prepare_chest_chexpert_only.py
    python scripts/prepare_chest_chexpert_only.py --per-class 5000
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import pandas as pd
from PIL import Image

AI_SERVICE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = AI_SERVICE_DIR / "data" / "chest_chexpert" / "processed"

"""
The findings the chest clinic reports. An image counts as abnormal when
the dataset is certain about at least one of them.
"""
FINDINGS = [
    "Cardiomegaly",
    "Lung Opacity",
    "Edema",
    "Consolidation",
    "Pneumonia",
    "Atelectasis",
    "Pneumothorax",
    "Pleural Effusion",
]

SPLIT_SHARES = {"train": 0.70, "val": 0.15, "test": 0.15}


def readable(path: Path) -> bool:
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
    )
    parser.add_argument(
        "--per-class",
        type=int,
        default=6000,
        help="How many images to take for each class, across all splits.",
    )
    arguments = parser.parse_args()

    root = Path(arguments.chexpert)
    table_path = root / "train.csv"

    if not table_path.exists():
        raise SystemExit(f"CheXpert train.csv not found at {table_path}")

    print("Reading the table...")
    table = pd.read_csv(table_path)

    frontal = table[table["Frontal/Lateral"] == "Frontal"].copy()

    frontal["relative"] = frontal["Path"].str.replace(
        "CheXpert-v1.0-small/", "", regex=False
    )
    frontal["patient"] = frontal["relative"].str.split("/").str[1]

    findings = [name for name in FINDINGS if name in frontal.columns]

    filled = frontal[findings].fillna(0.0)

    is_normal = frontal["No Finding"] == 1.0

    """
    Certain about at least one finding, and never marked uncertain on any
    of them, so the two classes cannot overlap.
    """
    has_finding = (filled == 1.0).any(axis=1)
    has_uncertain = (filled == -1.0).any(axis=1)

    normal = frontal[is_normal & ~has_uncertain]
    abnormal = frontal[has_finding & ~is_normal & ~has_uncertain]

    print(f"  frontal images   : {len(frontal)}")
    print(f"  normal available : {len(normal)}")
    print(f"  abnormal available: {len(abnormal)}")

    """
    Patients are assigned to a split before any image is copied, and a
    patient that appears in both classes is dropped: the same chest on
    both sides of the question would teach the model nothing.
    """
    normal_patients = set(normal["patient"])
    abnormal_patients = set(abnormal["patient"])
    shared = normal_patients & abnormal_patients

    print(f"  patients in both classes, dropped: {len(shared)}")

    normal = normal[~normal["patient"].isin(shared)]
    abnormal = abnormal[~abnormal["patient"].isin(shared)]

    counts = {
        split: int(arguments.per_class * share)
        for split, share in SPLIT_SHARES.items()
    }

    print(f"  target per class : {counts}")

    for split in SPLIT_SHARES:
        for name in ("NORMAL", "ABNORMAL"):
            (OUTPUT_DIR / split / name).mkdir(parents=True, exist_ok=True)

    for label, frame in (("NORMAL", normal), ("ABNORMAL", abnormal)):
        patients = sorted(frame["patient"].unique())
        groups = frame.groupby("patient")

        remaining = dict(counts)
        order = ["train", "val", "test"]
        copied = {split: 0 for split in order}
        skipped = 0

        for patient in patients:
            split = next(
                (name for name in order if remaining.get(name, 0) > 0),
                None,
            )

            if split is None:
                break

            folder = OUTPUT_DIR / split / label

            for relative in groups.get_group(patient)["relative"]:
                if remaining[split] <= 0:
                    break

                source = root / relative

                if not source.exists() or not readable(source):
                    skipped += 1
                    continue

                destination = folder / relative.replace("/", "_")

                if not destination.exists():
                    shutil.copy2(source, destination)

                copied[split] += 1
                remaining[split] -= 1

        print(f"\n{label}: {copied}")

        if skipped:
            print(f"  skipped unreadable or missing: {skipped}")

    print("\nFinal counts:")

    for split in SPLIT_SHARES:
        line = {
            name: sum(
                1
                for path in (OUTPUT_DIR / split / name).rglob("*")
                if path.is_file()
            )
            for name in ("NORMAL", "ABNORMAL")
        }

        print(f"  {split}: {line}")

    print(f"\nWritten to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
