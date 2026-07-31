import hashlib
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path.cwd()

SOURCE_ROOT = (
    PROJECT_ROOT
    / "data"
    / "wrist"
    / "sources"
    / "grazpedwri_dx"
)

CSV_PATH = SOURCE_ROOT / "dataset.csv"
IMAGE_ROOT = SOURCE_ROOT / "extracted"

OUTPUT_DIR = (
    PROJECT_ROOT
    / "data"
    / "wrist"
    / "processed"
    / "grazped_multilabel"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
}

TARGET_COLUMNS = [
    "fracture_visible",
    "osteopenia",
    "metal",
    "cast",
]


def clean_column_name(name):
    return str(name).replace("\ufeff", "").strip()


def normalize_stem(value):
    return Path(str(value).strip()).stem.lower()


def assign_split(patient_id):
    value = str(patient_id).strip()

    digest = hashlib.sha256(
        value.encode("utf-8")
    ).hexdigest()

    number = int(digest[:8], 16) % 100

    if number < 70:
        return "train"

    if number < 85:
        return "val"

    return "test"


print("Reading dataset.csv...")

df = pd.read_csv(
    CSV_PATH,
    encoding="utf-8-sig",
)

df.columns = [
    clean_column_name(column)
    for column in df.columns
]

required_columns = {
    "filestem",
    "patient_id",
    "diagnosis_uncertain",
    *TARGET_COLUMNS,
}

missing_columns = (
    required_columns
    - set(df.columns)
)

if missing_columns:
    raise ValueError(
        "Missing columns: "
        + ", ".join(sorted(missing_columns))
    )

print("Indexing images...")

image_map = {}

for path in IMAGE_ROOT.rglob("*"):
    if (
        path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
    ):
        key = path.stem.lower()

        if key not in image_map:
            image_map[key] = path

print(
    "Images indexed:",
    len(image_map),
)

df["_image_key"] = df["filestem"].map(
    normalize_stem
)

df["image_path"] = df["_image_key"].map(
    lambda key: image_map.get(key)
)

missing_images = df[
    df["image_path"].isna()
].copy()

if not missing_images.empty:
    missing_images[
        ["filestem", "patient_id"]
    ].to_csv(
        OUTPUT_DIR / "missing_images.csv",
        index=False,
    )

print(
    "Missing images:",
    len(missing_images),
)

df = df[
    df["image_path"].notna()
].copy()

numeric_columns = [
    "diagnosis_uncertain",
    *TARGET_COLUMNS,
]

for column in numeric_columns:
    df[column] = (
        pd.to_numeric(
            df[column],
            errors="coerce",
        )
        .fillna(0)
        .astype(int)
        .clip(0, 1)
    )

uncertain_count = int(
    df["diagnosis_uncertain"].sum()
)

print(
    "Uncertain rows excluded:",
    uncertain_count,
)

df = df[
    df["diagnosis_uncertain"] == 0
].copy()

df["no_supported_finding"] = (
    df[TARGET_COLUMNS].sum(axis=1) == 0
).astype(int)

df["split"] = df["patient_id"].map(
    assign_split
)

df["image_path"] = df["image_path"].map(
    lambda path: path
    .relative_to(PROJECT_ROOT)
    .as_posix()
)

output_columns = [
    "filestem",
    "image_path",
    "patient_id",
    "study_number",
    "age",
    "gender",
    "laterality",
    "projection",
    "fracture_visible",
    "osteopenia",
    "metal",
    "cast",
    "no_supported_finding",
    "ao_classification",
    "split",
]

output_columns = [
    column
    for column in output_columns
    if column in df.columns
]

df[output_columns].to_csv(
    OUTPUT_DIR / "labels_all.csv",
    index=False,
)

for split_name in [
    "train",
    "val",
    "test",
]:
    split_df = df[
        df["split"] == split_name
    ]

    split_df[output_columns].to_csv(
        OUTPUT_DIR / f"{split_name}.csv",
        index=False,
    )

print("\nTOTAL USABLE:", len(df))

print("\nSPLIT COUNTS:")
print(
    df["split"]
    .value_counts()
    .to_string()
)

print("\nPATIENT COUNTS:")
print(
    df.groupby("split")["patient_id"]
    .nunique()
    .to_string()
)

summary_columns = [
    *TARGET_COLUMNS,
    "no_supported_finding",
]

print("\nLABEL COUNTS BY SPLIT:")

summary = df.groupby("split")[
    summary_columns
].sum()

print(
    summary.to_string()
)

print("\nOUTPUT DIRECTORY:")
print(OUTPUT_DIR)
