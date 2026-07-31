"""
Builds the train / validation / test splits for the spine model from the
Cervical Spine X-ray Atlas (CSXA).

The atlas grades the cervical curvature of every radiograph, which is the
finding a doctor looks for first on a cervical spine film:

    1 Lordotic  -> normal curvature
    2 Straight  -> the lordosis is lost
    3 Sigmoid 1 -> S shaped curvature
    4 Sigmoid 2 -> reverse S shaped curvature
    5 Kyphotic  -> the curvature is reversed

The disease column of the atlas is not used: it holds 4818 spondylosis
against 181 healthy images, which is far too unbalanced to learn from.

    python scripts/prepare_csxa_spine_data.py
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
SOURCE_DIR = PROJECT_ROOT / "data" / "spine" / "sources" / "csxa"
DATASET_FILE = SOURCE_DIR / "datasets.xlsx"
IMAGES_DIR = SOURCE_DIR / "datasets-PNG"
OUTPUT_DIR = (
    PROJECT_ROOT / "data" / "spine" / "processed" / "csxa_multilabel"
)

CURVATURE_COLUMN = (
    "Curvature: 1.Lordotic, 2.Straight, 3.Sigmoid1, 4.Sigmoid2, 5.Kyphotic"
)

LABELS = [
    "loss_of_lordosis",
    "sigmoid_curvature",
    "cervical_kyphosis",
]

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15


def build_labels(df: pd.DataFrame) -> pd.DataFrame:
    curvature = pd.to_numeric(df[CURVATURE_COLUMN], errors="coerce")

    """
    A file is named with the four digit case number followed by the age.
    The age written in the file name does not always match the age in the
    sheet, so the case number alone links a row to its image.
    """
    images_by_number = {
        path.stem[:4]: path for path in IMAGES_DIR.glob("*.png")
    }

    result = pd.DataFrame()
    result["image_path"] = [
        (
            str(
                images_by_number[f"{int(number):04d}"].relative_to(
                    PROJECT_ROOT
                )
            ).replace("\\", "/")
            if f"{int(number):04d}" in images_by_number
            else ""
        )
        for number in df["Number"]
    ]

    """
    Any curvature other than lordotic means the normal cervical lordosis
    is not there. The two more specific shapes keep their own label so
    the doctor sees which one the model reacted to.
    """
    result["loss_of_lordosis"] = (
        curvature.isin([2, 3, 4, 5]).astype(np.float32).to_numpy()
    )
    result["sigmoid_curvature"] = (
        curvature.isin([3, 4]).astype(np.float32).to_numpy()
    )
    result["cervical_kyphosis"] = (
        curvature.eq(5).astype(np.float32).to_numpy()
    )
    result["curvature"] = curvature.to_numpy()

    exists = result["image_path"].map(
        lambda value: bool(value) and (PROJECT_ROOT / value).exists()
    )

    missing = int((~exists).sum())

    if missing:
        print(f"Skipping {missing} rows without an image on disk.")

    return result[exists & curvature.notna()].reset_index(drop=True)


def split_dataset(df: pd.DataFrame):
    """
    Splits inside every curvature grade, so each split keeps the same mix
    of normal and abnormal shapes.
    """
    train_parts, val_parts, test_parts = [], [], []

    for _, group in df.groupby("curvature"):
        group = group.sample(frac=1.0, random_state=SEED).reset_index(
            drop=True
        )

        train_end = max(1, int(len(group) * TRAIN_RATIO))
        val_end = train_end + max(1, int(len(group) * VAL_RATIO))

        train_parts.append(group.iloc[:train_end])
        val_parts.append(group.iloc[train_end:val_end])
        test_parts.append(group.iloc[val_end:])

    def finish(parts):
        combined = pd.concat(parts, ignore_index=True)
        combined = combined.sample(
            frac=1.0, random_state=SEED
        ).reset_index(drop=True)
        return combined.drop(columns=["curvature"])

    return finish(train_parts), finish(val_parts), finish(test_parts)


def main() -> None:
    if not DATASET_FILE.exists():
        raise FileNotFoundError(
            f"The CSXA label file was not found: {DATASET_FILE}"
        )

    df = pd.read_excel(DATASET_FILE, sheet_name="Sheet1", header=1)
    print(f"Rows in the atlas: {len(df)}")

    labelled = build_labels(df)
    print(f"Usable images: {len(labelled)}")

    train_df, val_df, test_df = split_dataset(labelled)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, split in (
        ("train", train_df),
        ("val", val_df),
        ("test", test_df),
    ):
        path = OUTPUT_DIR / f"{name}.csv"
        split.to_csv(path, index=False)

        print(f"\n{name}: {len(split)} images -> {path}")
        print(split[LABELS].sum().astype(int).to_string())


if __name__ == "__main__":
    main()
