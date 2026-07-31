from pathlib import Path
import re

import numpy as np
import pandas as pd


SEED = 42
VALIDATION_PATIENT_RATIO = 0.10

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
SOURCE_VALID_CSV = DATASET_DIR / "valid.csv"

OUTPUT_TRAIN_CSV = OUTPUT_DIR / "train.csv"
OUTPUT_VALID_CSV = OUTPUT_DIR / "val.csv"
OUTPUT_TEST_CSV = OUTPUT_DIR / "test.csv"

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

# وفق المعالجة المبسطة المستخدمة مع CheXpert:
# الحالات غير المؤكدة لهذين التصنيفين تعامل كموجبة.
UNCERTAIN_AS_POSITIVE = {
    "Atelectasis",
    "Edema",
}


def resolve_image_path(
    csv_path: str,
) -> Path:
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


def extract_patient_id(
    csv_path: str,
) -> str:
    match = re.search(
        r"patient(\d+)",
        str(csv_path),
        flags=re.IGNORECASE,
    )

    if match:
        return match.group(1)

    raise ValueError(
        f"Patient ID could not be extracted from: "
        f"{csv_path}"
    )


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
            "Missing required columns: "
            f"{missing_columns}"
        )

    # نستخدم صور الأشعة الأمامية فقط.
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

        # القيم المفقودة لا نعتبرها سالبة.
        # سننشئ mask حتى يتجاهلها Loss أثناء التدريب.
        known_mask = values.notna()

        if label in UNCERTAIN_AS_POSITIVE:
            values = values.replace(
                -1,
                1,
            )
        else:
            values = values.replace(
                -1,
                0,
            )

        result[label] = (
            values
            .fillna(0)
            .astype(np.float32)
        )

        result[f"{label}_mask"] = (
            known_mask.astype(np.float32)
        )

    return result


def filter_missing_images(
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


def split_training_patients(
    dataframe: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    patient_ids = (
        dataframe["patient_id"]
        .drop_duplicates()
        .to_numpy()
    )

    random_generator = (
        np.random.default_rng(SEED)
    )

    random_generator.shuffle(
        patient_ids
    )

    validation_count = max(
        1,
        int(
            len(patient_ids)
            * VALIDATION_PATIENT_RATIO
        ),
    )

    validation_patient_ids = set(
        patient_ids[:validation_count]
    )

    validation_dataframe = dataframe[
        dataframe["patient_id"].isin(
            validation_patient_ids
        )
    ].copy()

    training_dataframe = dataframe[
        ~dataframe["patient_id"].isin(
            validation_patient_ids
        )
    ].copy()

    return (
        training_dataframe.reset_index(
            drop=True
        ),
        validation_dataframe.reset_index(
            drop=True
        ),
    )


def print_summary(
    dataframe: pd.DataFrame,
    split_name: str,
) -> None:
    print(f"\n{'=' * 72}")
    print(split_name)
    print(f"{'=' * 72}")
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
        mask_column = f"{label}_mask"

        known_mask = (
            dataframe[mask_column] == 1
        )

        positive = int(
            (
                known_mask
                & (dataframe[label] == 1)
            ).sum()
        )

        negative = int(
            (
                known_mask
                & (dataframe[label] == 0)
            ).sum()
        )

        ignored = int(
            (~known_mask).sum()
        )

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

    if not SOURCE_VALID_CSV.exists():
        raise FileNotFoundError(
            f"valid.csv was not found:\n"
            f"{SOURCE_VALID_CSV}"
        )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("Reading CheXpert files...")

    source_train = pd.read_csv(
        SOURCE_TRAIN_CSV
    )

    source_test = pd.read_csv(
        SOURCE_VALID_CSV
    )

    source_train = (
        prepare_source_dataframe(
            source_train
        )
    )

    source_test = (
        prepare_source_dataframe(
            source_test
        )
    )

    encoded_train = encode_labels(
        source_train
    )

    encoded_test = encode_labels(
        source_test
    )

    (
        training_dataframe,
        validation_dataframe,
    ) = split_training_patients(
        encoded_train
    )

    training_dataframe = (
        filter_missing_images(
            training_dataframe,
            "Training",
        )
    )

    validation_dataframe = (
        filter_missing_images(
            validation_dataframe,
            "Validation",
        )
    )

    test_dataframe = filter_missing_images(
        encoded_test,
        "Official test",
    )

    training_dataframe.to_csv(
        OUTPUT_TRAIN_CSV,
        index=False,
    )

    validation_dataframe.to_csv(
        OUTPUT_VALID_CSV,
        index=False,
    )

    test_dataframe.to_csv(
        OUTPUT_TEST_CSV,
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
        test_dataframe,
        "OFFICIAL TEST DATA",
    )

    print(
        "\nCheXpert data prepared successfully."
    )

    print(
        f"\nTraining CSV:\n"
        f"{OUTPUT_TRAIN_CSV}"
    )

    print(
        f"\nValidation CSV:\n"
        f"{OUTPUT_VALID_CSV}"
    )

    print(
        f"\nTest CSV:\n"
        f"{OUTPUT_TEST_CSV}"
    )


if __name__ == "__main__":
    main()