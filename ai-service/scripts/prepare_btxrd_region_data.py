"""
Builds the train / validation / test splits for the body regions that
come from the BTXRD bone tumour X-ray dataset.

The dataset marks every image with the bones and joints it shows, so one
source produces a separate multi label set per region:

    python scripts/prepare_btxrd_region_data.py lower_limb
    python scripts/prepare_btxrd_region_data.py pelvis_hip

Output, next to the other prepared datasets:

    data/<region>/processed/btxrd_multilabel/{train,val,test}.csv
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BTXRD_DIR = (
    PROJECT_ROOT
    / "data"
    / "bone_tumor"
    / "sources"
    / "btxrd"
    / "extracted"
    / "BTXRD"
)
DATASET_FILE = BTXRD_DIR / "dataset.xlsx"
IMAGES_DIR = BTXRD_DIR / "images"

"""
Which BTXRD columns belong to which region of the application.
"""
REGION_COLUMNS = {
    "lower_limb": [
        "foot",
        "tibia",
        "fibula",
        "femur",
        "ankle-joint",
        "knee-joint",
        "lower limb",
    ],
    "pelvis_hip": [
        "hip bone",
        "hip-joint",
        "pelvis",
    ],
    "upper_limb": [
        "hand",
        "ulna",
        "radius",
        "humerus",
        "wrist-joint",
        "elbow-joint",
        "shoulder-joint",
        "upper limb",
    ],
}

"""
The findings the model learns. They match the label names the AI service
already knows, so no extra mapping is needed at prediction time.
"""
LABEL_SOURCES = {
    "bone_lesion": "tumor",
    "benign_lesion": "benign",
    "malignant_lesion": "malignant",
}

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15


def read_dataset() -> pd.DataFrame:
    if not DATASET_FILE.exists():
        raise FileNotFoundError(
            f"The BTXRD dataset file was not found: {DATASET_FILE}"
        )

    return pd.read_excel(DATASET_FILE, sheet_name="Sheet1")


def select_region(df: pd.DataFrame, region: str) -> pd.DataFrame:
    columns = [
        column
        for column in REGION_COLUMNS[region]
        if column in df.columns
    ]

    if not columns:
        raise ValueError(
            f"None of the columns of the region {region} exist in the "
            "dataset file."
        )

    region_flags = df[columns].fillna(0).astype(float).sum(axis=1)

    return df[region_flags > 0].copy()


def build_labels(df: pd.DataFrame) -> pd.DataFrame:
    result = pd.DataFrame()
    result["image_path"] = df["image_id"].map(
        lambda name: str(
            (IMAGES_DIR / str(name)).relative_to(PROJECT_ROOT)
        ).replace("\\", "/")
    )

    for label, source_column in LABEL_SOURCES.items():
        result[label] = (
            pd.to_numeric(df[source_column], errors="coerce")
            .fillna(0)
            .astype(np.float32)
            .clip(0, 1)
            .to_numpy()
        )

    """
    Images that the dataset lists but that are not on disk would break
    the training run, so they are removed here.
    """
    exists = result["image_path"].map(
        lambda value: (PROJECT_ROOT / value).exists()
    )

    missing_count = int((~exists).sum())

    if missing_count:
        print(f"Skipping {missing_count} images that are not on disk.")

    return result[exists].reset_index(drop=True)


def split_dataset(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Splits on a stratification key built from the label combination, so
    the rare malignant cases appear in every split.
    """
    labels = list(LABEL_SOURCES)
    df = df.copy()
    df["stratum"] = df[labels].astype(int).astype(str).agg("".join, axis=1)

    train_parts = []
    val_parts = []
    test_parts = []

    for _, group in df.groupby("stratum"):
        group = group.sample(frac=1.0, random_state=SEED).reset_index(
            drop=True
        )

        train_end = max(1, int(len(group) * TRAIN_RATIO))
        val_end = train_end + max(
            1 if len(group) > 2 else 0,
            int(len(group) * VAL_RATIO),
        )

        train_parts.append(group.iloc[:train_end])
        val_parts.append(group.iloc[train_end:val_end])
        test_parts.append(group.iloc[val_end:])

    def finish(parts):
        combined = pd.concat(parts, ignore_index=True)
        combined = combined.sample(
            frac=1.0, random_state=SEED
        ).reset_index(drop=True)
        return combined.drop(columns=["stratum"])

    return finish(train_parts), finish(val_parts), finish(test_parts)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a BTXRD region dataset."
    )
    parser.add_argument(
        "region",
        choices=sorted(REGION_COLUMNS),
        help="The body region to prepare.",
    )
    arguments = parser.parse_args()
    region = arguments.region

    dataset = read_dataset()
    region_rows = select_region(dataset, region)

    print(f"Region: {region}")
    print(f"Images in the region: {len(region_rows)}")

    labelled = build_labels(region_rows)
    train_df, val_df, test_df = split_dataset(labelled)

    output_dir = (
        PROJECT_ROOT
        / "data"
        / region
        / "processed"
        / "btxrd_multilabel"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    for name, split in (
        ("train", train_df),
        ("val", val_df),
        ("test", test_df),
    ):
        path = output_dir / f"{name}.csv"
        split.to_csv(path, index=False)

        counts = split[list(LABEL_SOURCES)].sum().astype(int)
        print(f"\n{name}: {len(split)} images -> {path}")
        print(counts.to_string())


if __name__ == "__main__":
    main()
