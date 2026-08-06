"""
Builds the lower limb dataset from two sources instead of one.

The model trained on BTXRD alone could not tell a healthy leg from a
diseased one, and the reason is in the data: every BTXRD image comes
from a patient who was already being investigated for a bone tumour.
Even its negatives are films of symptomatic patients, so the model never
saw what an ordinary limb radiograph looks like and answered anything
around 40% when it met one.

FracAtlas provides that missing half: 2010 leg radiographs without a
fracture, taken in an ordinary emergency setting. They are added as
lesion negatives. Bone tumours are rare, so a handful of them may hide
in there, but the label noise is small next to the gain of teaching the
model what normal anatomy looks like.

    python scripts/prepare_lower_limb_combined.py

Output:

    data/lower_limb/processed/combined/{train,val,test}.csv
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

BTXRD_DIR = (
    PROJECT_ROOT
    / "data"
    / "bone_tumor"
    / "sources"
    / "btxrd"
    / "extracted"
    / "BTXRD"
)

FRACATLAS_DIR = (
    PROJECT_ROOT
    / "data"
    / "shoulder_diseases"
    / "sources"
    / "fracatlas"
    / "extracted"
    / "FracAtlas"
)

OUTPUT_DIR = (
    PROJECT_ROOT / "data" / "lower_limb" / "processed" / "combined"
)

LABELS = ["bone_lesion", "benign_lesion", "malignant_lesion"]

BTXRD_REGION_COLUMNS = [
    "foot",
    "tibia",
    "fibula",
    "femur",
    "ankle-joint",
    "knee-joint",
    "lower limb",
]

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15


def is_readable(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.convert("RGB").load()
        return True
    except Exception:
        return False


def load_btxrd() -> pd.DataFrame:
    df = pd.read_excel(BTXRD_DIR / "dataset.xlsx", sheet_name="Sheet1")

    columns = [c for c in BTXRD_REGION_COLUMNS if c in df.columns]
    region = df[df[columns].fillna(0).astype(float).sum(axis=1) > 0]

    rows = []

    for _, row in region.iterrows():
        path = BTXRD_DIR / "images" / str(row["image_id"])

        if not path.exists() or not is_readable(path):
            continue

        rows.append(
            {
                "image_path": str(
                    path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/"),
                "bone_lesion": float(row.get("tumor") or 0),
                "benign_lesion": float(row.get("benign") or 0),
                "malignant_lesion": float(row.get("malignant") or 0),
                "source": "btxrd",
            }
        )

    return pd.DataFrame(rows)


def load_fracatlas_normals() -> pd.DataFrame:
    df = pd.read_csv(FRACATLAS_DIR / "dataset.csv")
    legs = df[(df["leg"] == 1) & (df["fractured"] == 0)]

    rows = []

    for image_id in legs["image_id"]:
        path = FRACATLAS_DIR / "images" / "Non_fractured" / str(image_id)

        if not path.exists():
            path = FRACATLAS_DIR / "images" / "Fractured" / str(image_id)

        if not path.exists() or not is_readable(path):
            continue

        rows.append(
            {
                "image_path": str(
                    path.relative_to(PROJECT_ROOT)
                ).replace("\\", "/"),
                "bone_lesion": 0.0,
                "benign_lesion": 0.0,
                "malignant_lesion": 0.0,
                "source": "fracatlas_normal",
            }
        )

    return pd.DataFrame(rows)


def split_dataset(df: pd.DataFrame):
    """
    Splits inside every combination of source and label, so the normal
    images and the rare malignant ones are spread over all three splits.
    """
    df = df.copy()
    df["stratum"] = (
        df["source"]
        + "-"
        + df[LABELS].astype(int).astype(str).agg("".join, axis=1)
    )

    train_parts, val_parts, test_parts = [], [], []

    for _, group in df.groupby("stratum"):
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
    btxrd = load_btxrd()
    print(f"BTXRD lower limb images: {len(btxrd)}")

    normals = load_fracatlas_normals()
    print(f"FracAtlas normal leg images: {len(normals)}")

    combined = pd.concat([btxrd, normals], ignore_index=True)
    train_df, val_df, test_df = split_dataset(combined)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, split in (
        ("train", train_df),
        ("val", val_df),
        ("test", test_df),
    ):
        path = OUTPUT_DIR / f"{name}.csv"
        split.drop(columns=["stratum"]).to_csv(path, index=False)

        clean = int((split[LABELS].sum(axis=1) == 0).sum())

        print(f"\n{name}: {len(split)} images -> {path}")
        print(split[LABELS].sum().astype(int).to_string())
        print(f"  images with no lesion at all: {clean}")
        print(
            "  by source: "
            + ", ".join(
                f"{source} {len(part)}"
                for source, part in split.groupby("source")
            )
        )


if __name__ == "__main__":
    main()
