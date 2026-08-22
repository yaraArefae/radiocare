"""
Builds one bone lesion dataset out of every region of BTXRD.

A lesion in a hip looks like a lesion in a femur: the finding is the
same disease, and only the bone around it changes. The application
trains one model per region anyway, which leaves the pelvis with 158
training images while the leg has 1726 - and 158 images cannot carry a
model anybody should trust. This dataset puts all 3746 images together
so the pelvis is read by a model that learned the finding from every
bone in the set, not only from its own.

Two properties make the result comparable with what is already there:

  * Any image that a region dataset already placed in a split keeps that
    split here. The pelvis test images stay test images, so the new
    model can be measured against the pelvis model on exactly the same
    radiographs.

  * The split is decided once per image, not once per region. The region
    datasets were each split on their own, and because a BTXRD row can
    carry two region flags at once - a hip joint that is also a femur -
    nine of the 37 pelvis test images sit inside the training set of the
    lower limb model. Splitting per image is what stops a combined model
    from being measured on radiographs it was trained on.

    python scripts/prepare_btxrd_all_regions.py
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

OUTPUT_DIR = (
    PROJECT_ROOT / "data" / "btxrd_all" / "processed" / "btxrd_multilabel"
)

"""
The region datasets whose split assignments are inherited, so a model
trained here can be compared with the models trained on them.
"""
EXISTING_SPLITS = [
    PROJECT_ROOT / "data" / "pelvis_hip" / "processed" / "btxrd_multilabel",
    PROJECT_ROOT / "data" / "lower_limb" / "processed" / "btxrd_multilabel",
]

LABEL_SOURCES = {
    "bone_lesion": "tumor",
    "benign_lesion": "benign",
    "malignant_lesion": "malignant",
}

LABELS = list(LABEL_SOURCES)

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15


def read_existing_assignments() -> dict[str, str]:
    """
    Which split each already prepared image belongs to.

    The pelvis is read first and is never overruled: it is the region
    this dataset exists for, so its test images must stay test images.
    An image the two regions disagree about - one calls it training, the
    other test - is given to the stricter of the two, which is test,
    because training on it would quietly invalidate the comparison.
    """
    assignments: dict[str, str] = {}
    rank = {"train": 0, "val": 1, "test": 2}

    for directory in EXISTING_SPLITS:
        for split in ("train", "val", "test"):
            path = directory / f"{split}.csv"

            if not path.exists():
                continue

            for image_path in pd.read_csv(path)["image_path"]:
                current = assignments.get(str(image_path))

                if current is None or rank[split] > rank[current]:
                    assignments[str(image_path)] = split

    return assignments


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

    exists = result["image_path"].map(
        lambda value: (PROJECT_ROOT / value).exists()
    )

    missing = int((~exists).sum())

    if missing:
        print(f"Skipping {missing} images that are not on disk.")

    return result[exists].drop_duplicates(
        subset="image_path"
    ).reset_index(drop=True)


def split_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """
    Keeps every inherited assignment and splits the rest by the label
    combination, so the rare malignant cases reach all three splits.
    """
    inherited = read_existing_assignments()

    df = df.copy()
    df["split"] = df["image_path"].map(inherited)

    print(
        f"Inherited from the region datasets: "
        f"{int(df['split'].notna().sum())} images"
    )

    remaining = df[df["split"].isna()].copy()
    remaining["stratum"] = (
        remaining[LABELS].astype(int).astype(str).agg("".join, axis=1)
    )

    assigned = []

    for _, group in remaining.groupby("stratum"):
        group = group.sample(frac=1.0, random_state=SEED).reset_index(
            drop=True
        )

        train_end = max(1, int(len(group) * TRAIN_RATIO))
        val_end = train_end + max(
            1 if len(group) > 2 else 0,
            int(len(group) * VAL_RATIO),
        )

        group.loc[: train_end - 1, "split"] = "train"
        group.loc[train_end : val_end - 1, "split"] = "val"
        group.loc[val_end:, "split"] = "test"
        assigned.append(group.drop(columns=["stratum"]))

    return pd.concat(
        [df[df["split"].notna()], *assigned],
        ignore_index=True,
    )


def main() -> None:
    if not DATASET_FILE.exists():
        raise FileNotFoundError(
            f"The BTXRD dataset file was not found: {DATASET_FILE}"
        )

    dataset = pd.read_excel(DATASET_FILE, sheet_name="Sheet1")
    print(f"Rows in BTXRD: {len(dataset)}")

    labelled = build_labels(dataset)
    print(f"Usable images: {len(labelled)}")

    combined = split_dataset(labelled)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for split in ("train", "val", "test"):
        part = combined[combined["split"] == split].drop(columns=["split"])
        part = part.sample(frac=1.0, random_state=SEED).reset_index(drop=True)
        path = OUTPUT_DIR / f"{split}.csv"
        part.to_csv(path, index=False)

        counts = part[LABELS].sum().astype(int).to_dict()
        print(f"{split}: {len(part)} images {counts} -> {path}")

    """
    The whole point of the exercise is that no image is measured on
    after being trained on, so it is checked rather than assumed.
    """
    paths = {
        split: set(
            combined[combined["split"] == split]["image_path"]
        )
        for split in ("train", "val", "test")
    }

    print(
        "\nOverlap train/test:",
        len(paths["train"] & paths["test"]),
        "| train/val:",
        len(paths["train"] & paths["val"]),
        "| val/test:",
        len(paths["val"] & paths["test"]),
    )

    pelvis_test = set(
        pd.read_csv(
            PROJECT_ROOT
            / "data"
            / "pelvis_hip"
            / "processed"
            / "btxrd_multilabel"
            / "test.csv"
        )["image_path"]
    )

    print(
        f"Pelvis test images kept in test: "
        f"{len(pelvis_test & paths['test'])} of {len(pelvis_test)}"
    )
    print(
        f"Pelvis test images that leaked into training: "
        f"{len(pelvis_test & paths['train'])}"
    )


if __name__ == "__main__":
    main()
