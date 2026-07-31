"""
Rebuilds the shoulder splits as CSV files, so the shoulder model can be
retrained with the same recipe as the wrist and lower limb models.

The existing shoulder model reaches 62% accuracy and only 32% precision
on the abnormal class, because a plain loss on a 4:1 imbalanced dataset
pushes the model towards always answering "normal". The shared trainer
uses a weighted loss and tunes the decision threshold, which is what the
other regions needed too.

    python scripts/prepare_shoulder_triage_data.py

Output:

    data/shoulder/processed/triage_multilabel/{train,val,test}.csv
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = PROJECT_ROOT / "data" / "shoulder" / "processed"
OUTPUT_DIR = SOURCE_DIR / "triage_multilabel"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

"""
The folder that holds the abnormal images in every split. Everything in
the other folders counts as normal.
"""
ABNORMAL_FOLDER_NAMES = {"abnormal", "positive", "1"}


def collect_split(split_dir: Path) -> pd.DataFrame:
    rows: list[dict[str, object]] = []

    for image_path in split_dir.rglob("*"):
        if image_path.suffix.lower() not in IMAGE_SUFFIXES:
            continue

        parent = image_path.parent.name.strip().lower()
        is_abnormal = parent in ABNORMAL_FOLDER_NAMES

        rows.append(
            {
                "image_path": str(
                    image_path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/"),
                "shoulder_abnormality": float(is_abnormal),
            }
        )

    frame = pd.DataFrame(rows)

    if frame.empty:
        return frame

    return frame.sample(frac=1.0, random_state=SEED).reset_index(
        drop=True
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for split_name in ("train", "val", "test"):
        split_dir = SOURCE_DIR / split_name

        if not split_dir.exists():
            raise FileNotFoundError(
                f"The shoulder split folder is missing: {split_dir}"
            )

        frame = collect_split(split_dir)

        if frame.empty:
            raise ValueError(f"No images were found in {split_dir}")

        path = OUTPUT_DIR / f"{split_name}.csv"
        frame.to_csv(path, index=False)

        positives = int(frame["shoulder_abnormality"].sum())
        print(
            f"{split_name}: {len(frame)} images "
            f"({positives} abnormal, {len(frame) - positives} normal) "
            f"-> {path}"
        )


if __name__ == "__main__":
    main()
