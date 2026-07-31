from pathlib import Path
import re

import numpy as np
import pandas as pd


SEED = 42

VALIDATION_PATIENT_RATIO = 0.10
INTERNAL_TEST_PATIENT_RATIO = 0.10

DATASET_DIR = Path(
    r"D:\AI-Datasets\CheXpert\extracted"
)

BASE_DIR = Path(__file__).resolve().parent.parent

OUTPUT_DIR = (
    BASE_DIR
    / "data"
    / "chest_findings"
    / "processed"
)

SOURCE_TRAIN_CSV = DATASET_DIR / "train.csv"
SOURCE_OFFICIAL_TEST_CSV = DATASET_DIR / "valid.csv"

OUTPUT_TRAIN_CSV = OUTPUT_DIR / "train.csv"
OUTPUT_VALIDATION_CSV = OUTPUT_DIR / "val.csv"
OUTPUT_INTERNAL_TEST_CSV = OUTPUT_DIR / "test.csv"
OUTPUT_OFFICIAL_TEST_CSV = OUTPUT_DIR / "official_test.csv"

TARGET_LABELS = [
    "Cardiomegaly",
    "Lung Opacity",
    "Edema",
    "Consolidation",
    "Pneumonia",
    "Atelectasis",
    "Pneumothorax",
    "Pleural Effusion",
]


def resolve_image_path(csv_path: str) -> Path:
    normalized_path = str(csv_path).replace(
        "\\",
        "/",
    )

    parts = Path(normalized_path).parts

    if (
        parts
        and parts[0]
        .lower()
        .startswith("chexpert")
    ):
        parts = parts[1:]

    return DATASET_DIR.joinpath(*parts)


def extract_patient_id(csv_path: str) -> str:
    match = re.search(
        r"patient(\d+)",
        str(csv_path),
        flags=re.IGNORECASE,
    )

    if not match:
        raise ValueError(
            f"Patient ID was not found in: {csv_path}"
        )

    return match.group(1)


def prepare_source_dataframe(
    dataframe: pd.DataFrame,
) -> pd.DataFrame:
    required_columns = [
        "Path",
        "Frontal/Lateral",
        *TARGET_LABELS,
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in dataframe.columns
    ]

    if missing_columns:
        raise ValueError(
            f"Missing columns: {missing_columns}"
        )

    # نستخدم صور الصدر الأمامية فقط.
    dataframe = dataframe[
        dataframe["Frontal/Lateral"]
        .astype(str)
        .str.upper()
        .eq("FRONTAL")
    ].copy()

    dataframe["image_path"] = (
        dataframe["Path"]
        .map(resolve_image_path)
        .map(str)
    )

    dataframe["patient_id"] = (
        dataframe["Path"]
        .map(extract_patient_id)
    )

    return dataframe


def encode_labels(
    dataframe: pd.DataFrame,
) -> pd.DataFrame:
    result = dataframe[
        [
            "image_path",
            "patient_id",
        ]
    ].copy()

    for label in TARGET_LABELS:
        values = pd.to_numeric(
            dataframe[label],
            errors="coerce",
        )

        # نعتبر فقط 0 و1 تصنيفات مؤكدة.
        # -1 والحقل الفارغ يتم تجاهلهما في Loss.
        known_mask = values.isin([0, 1])

        result[label] = (
            values
            .where(known_mask, 0)
            .astype(np.float32)
        )

        result[f"{label}_mask"] = (
            known_mask.astype(np.float32)
        )

    return result


def split_by_patient(
    dataframe: pd.DataFrame,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
]:
    patient_ids = (
        dataframe["patient_id"]
        .drop_duplicates()
        .to_numpy()
    )

    random_generator = np.random.default_rng(
        SEED
    )

    random_generator.shuffle(patient_ids)

    internal_test_count = max(
        1,
        int(
            len(patient_ids)
            * INTERNAL_TEST_PATIENT_RATIO
        ),
    )

    validation_count = max(
        1,
        int(
            len(patient_ids)
            * VALIDATION_PATIENT_RATIO
        ),
    )

    internal_test_ids = set(
        patient_ids[:internal_test_count]
    )

    validation_start = internal_test_count
    validation_end = (
        validation_start + validation_count
    )

    validation_ids = set(
        patient_ids[
            validation_start:validation_end
        ]
    )

    internal_test_dataframe = dataframe[
        dataframe["patient_id"].isin(
            internal_test_ids
        )
    ].copy()

    validation_dataframe = dataframe[
        dataframe["patient_id"].isin(
            validation_ids
        )
    ].copy()

    training_dataframe = dataframe[
        ~dataframe["patient_id"].isin(
            internal_test_ids | validation_ids
        )
    ].copy()

    return (
        training_dataframe.reset_index(drop=True),
        validation_dataframe.reset_index(drop=True),
        internal_test_dataframe.reset_index(drop=True),
    )


def filter_existing_images(
    dataframe: pd.DataFrame,
    split_name: str,
) -> pd.DataFrame:
    exists_mask = dataframe[
        "image_path"
    ].map(
        lambda path: Path(path).exists()
    )

    missing_count = int(
        (~exists_mask).sum()
    )

    print(
        f"{split_name} missing images: "
        f"{missing_count}"
    )

    return dataframe[
        exists_mask
    ].reset_index(drop=True)


def print_summary(
    dataframe: pd.DataFrame,
    split_name: str,
) -> None:
    print(f"\n{'=' * 74}")
    print(split_name)
    print(f"{'=' * 74}")

    print(f"Images: {len(dataframe)}")
    print(
        f"Patients: "
        f"{dataframe['patient_id'].nunique()}"
    )

    print(
        f"\n{'Finding':25}"
        f"{'Positive':>12}"
        f"{'Negative':>12}"
        f"{'Ignored':>12}"
    )

    print("-" * 62)

    for label in TARGET_LABELS:
        known = (
            dataframe[f"{label}_mask"] == 1
        )

        positive = int(
            (
                known
                & (dataframe[label] == 1)
            ).sum()
        )

        negative = int(
            (
                known
                & (dataframe[label] == 0)
            ).sum()
        )

        ignored = int((~known).sum())

        print(
            f"{label:25}"
            f"{positive:>12}"
            f"{negative:>12}"
            f"{ignored:>12}"
        )


def main() -> None:
    if not SOURCE_TRAIN_CSV.exists():
        raise FileNotFoundError(
            f"train.csv was not found:\n"
            f"{SOURCE_TRAIN_CSV}"
        )

    if not SOURCE_OFFICIAL_TEST_CSV.exists():
        raise FileNotFoundError(
            f"valid.csv was not found:\n"
            f"{SOURCE_OFFICIAL_TEST_CSV}"
        )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("Reading CheXpert data...")

    source_train = pd.read_csv(
        SOURCE_TRAIN_CSV
    )

    source_official_test = pd.read_csv(
        SOURCE_OFFICIAL_TEST_CSV
    )

    source_train = prepare_source_dataframe(
        source_train
    )

    source_official_test = (
        prepare_source_dataframe(
            source_official_test
        )
    )

    encoded_train = encode_labels(
        source_train
    )

    encoded_official_test = encode_labels(
        source_official_test
    )

    (
        training_dataframe,
        validation_dataframe,
        internal_test_dataframe,
    ) = split_by_patient(encoded_train)

    training_dataframe = filter_existing_images(
        training_dataframe,
        "Training",
    )

    validation_dataframe = filter_existing_images(
        validation_dataframe,
        "Validation",
    )

    internal_test_dataframe = (
        filter_existing_images(
            internal_test_dataframe,
            "Internal test",
        )
    )

    official_test_dataframe = (
        filter_existing_images(
            encoded_official_test,
            "Official test",
        )
    )

    training_dataframe.to_csv(
        OUTPUT_TRAIN_CSV,
        index=False,
    )

    validation_dataframe.to_csv(
        OUTPUT_VALIDATION_CSV,
        index=False,
    )

    internal_test_dataframe.to_csv(
        OUTPUT_INTERNAL_TEST_CSV,
        index=False,
    )

    official_test_dataframe.to_csv(
        OUTPUT_OFFICIAL_TEST_CSV,
        index=False,
    )

    print_summary(
        training_dataframe,
        "TRAINING DATA",
    )

    print_summary(
        validation_dataframe,
        "VALIDATION DATA",
    )

    print_summary(
        internal_test_dataframe,
        "INTERNAL TEST DATA",
    )

    print_summary(
        official_test_dataframe,
        "OFFICIAL TEST DATA",
    )

    print(
        "\nCheXpert V2 data was prepared successfully."
    )

    print(f"\nTrain:\n{OUTPUT_TRAIN_CSV}")
    print(
        f"\nValidation:\n"
        f"{OUTPUT_VALIDATION_CSV}"
    )
    print(
        f"\nInternal test:\n"
        f"{OUTPUT_INTERNAL_TEST_CSV}"
    )
    print(
        f"\nOfficial test:\n"
        f"{OUTPUT_OFFICIAL_TEST_CSV}"
    )


if __name__ == "__main__":
    main()