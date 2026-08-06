"""
Builds the splits for the shared fracture model from FracAtlas.

FracAtlas covers hand, leg, hip, and shoulder radiographs and marks every
image as fractured or not. Trained per region the positives are far too
few, above all for the hip with 63 of them, so one model is trained on
all regions together: a fracture looks similar wherever the bone sits,
and the union gives 719 positives instead of a handful.

Every bone clinic then runs this model next to its own region model, so
a fracture is never missed only because the region model was trained on
something else, such as bone tumours.

    python scripts/prepare_fracatlas_fracture_data.py

Output:

    data/fracture/processed/fracatlas/{train,val,test}.csv
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = (
    PROJECT_ROOT
    / "data"
    / "shoulder_diseases"
    / "sources"
    / "fracatlas"
    / "extracted"
    / "FracAtlas"
)
DATASET_FILE = SOURCE_DIR / "dataset.csv"
IMAGES_DIR = SOURCE_DIR / "images"
OUTPUT_DIR = PROJECT_ROOT / "data" / "fracture" / "processed" / "fracatlas"

REGION_COLUMNS = ["hand", "leg", "hip", "shoulder"]

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15


def resolve_image(image_id: str, is_fractured: bool) -> str:
    """
    The images live in a Fractured and a Non_fractured folder. The label
    column decides which one to look in, and the other folder is checked
    as a fallback so a mislabelled path does not drop the row.
    """
    folders = (
        ["Fractured", "Non_fractured"]
        if is_fractured
        else ["Non_fractured", "Fractured"]
    )

    for folder in folders:
        candidate = IMAGES_DIR / folder / image_id

        if candidate.exists():
            return str(candidate.relative_to(PROJECT_ROOT)).replace(
                "\\", "/"
            )

    return ""


def build_labels(df: pd.DataFrame) -> pd.DataFrame:
    fractured = (
        pd.to_numeric(df["fractured"], errors="coerce")
        .fillna(0)
        .astype(int)
    )

    result = pd.DataFrame()
    result["image_path"] = [
        resolve_image(str(image_id), bool(flag))
        for image_id, flag in zip(df["image_id"], fractured)
    ]
    result["fracture_visible"] = fractured.astype(np.float32).to_numpy()

    """
    The region is kept only to balance the splits, so every clinic is
    represented in the test numbers as well.
    """
    regions = []

    for _, row in df.iterrows():
        present = [
            column
            for column in REGION_COLUMNS
            if column in df.columns and int(row.get(column, 0) or 0) == 1
        ]
        regions.append(present[0] if present else "other")

    result["region"] = regions

    missing = result["image_path"] == ""

    if missing.any():
        print(f"Skipping {int(missing.sum())} rows without an image.")

    result = result[~missing].reset_index(drop=True)

    """
    FracAtlas contains a few truncated JPEG files. They abort the whole
    training run when the reader hits them, so every image is decoded
    once here and the broken ones are dropped.
    """
    readable = []

    for image_path in result["image_path"]:
        try:
            with Image.open(PROJECT_ROOT / image_path) as image:
                image.convert("RGB").load()
            readable.append(True)
        except Exception as error:
            print(f"Skipping unreadable image {image_path}: {error}")
            readable.append(False)

    broken = len(readable) - sum(readable)

    if broken:
        print(f"Skipping {broken} unreadable images in total.")

    return result[pd.Series(readable)].reset_index(drop=True)


def split_dataset(df: pd.DataFrame):
    train_parts, val_parts, test_parts = [], [], []

    for _, group in df.groupby(["region", "fracture_visible"]):
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
        return combined.sample(
            frac=1.0, random_state=SEED
        ).reset_index(drop=True)

    return finish(train_parts), finish(val_parts), finish(test_parts)


def main() -> None:
    if not DATASET_FILE.exists():
        raise FileNotFoundError(
            f"The FracAtlas label file was not found: {DATASET_FILE}"
        )

    df = pd.read_csv(DATASET_FILE)
    print(f"Rows in FracAtlas: {len(df)}")

    labelled = build_labels(df)
    train_df, val_df, test_df = split_dataset(labelled)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, split in (
        ("train", train_df),
        ("val", val_df),
        ("test", test_df),
    ):
        path = OUTPUT_DIR / f"{name}.csv"
        split.drop(columns=["region"]).to_csv(path, index=False)

        positives = int(split["fracture_visible"].sum())
        print(f"\n{name}: {len(split)} images -> {path}")
        print(f"  fractured: {positives}")
        print(
            "  per region: "
            + ", ".join(
                f"{region} {int(part['fracture_visible'].sum())}/{len(part)}"
                for region, part in split.groupby("region")
            )
        )


if __name__ == "__main__":
    main()
