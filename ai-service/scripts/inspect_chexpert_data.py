from pathlib import Path

import pandas as pd


DATASET_DIR = Path(
    r"D:\AI-Datasets\CheXpert\extracted"
)

TRAIN_CSV = DATASET_DIR / "train.csv"
VALID_CSV = DATASET_DIR / "valid.csv"

LABELS = [
    "No Finding",
    "Enlarged Cardiomediastinum",
    "Cardiomegaly",
    "Lung Opacity",
    "Lung Lesion",
    "Edema",
    "Consolidation",
    "Pneumonia",
    "Atelectasis",
    "Pneumothorax",
    "Pleural Effusion",
    "Pleural Other",
    "Fracture",
    "Support Devices",
]


def resolve_image_path(
    csv_path: str,
) -> Path:
    normalized_path = csv_path.replace("\\", "/")
    parts = Path(normalized_path).parts

    # بعض نسخ CheXpert تضع اسم المجلد الرئيسي
    # في بداية مسار الصورة داخل CSV.
    if parts and parts[0].lower().startswith("chexpert"):
        parts = parts[1:]

    return DATASET_DIR.joinpath(*parts)


def print_label_summary(
    dataframe: pd.DataFrame,
    title: str,
) -> None:
    print(f"\n{'=' * 75}")
    print(title)
    print(f"{'=' * 75}")

    print(f"Total rows: {len(dataframe)}")

    if "Frontal/Lateral" in dataframe.columns:
        print("\nImage views:")
        print(
            dataframe["Frontal/Lateral"]
            .value_counts(dropna=False)
        )

    frontal_dataframe = dataframe[
        dataframe["Frontal/Lateral"]
        .astype(str)
        .str.upper()
        .eq("FRONTAL")
    ].copy()

    print(
        f"\nFrontal images: "
        f"{len(frontal_dataframe)}"
    )

    print("\nLabel distribution:")
    print(
        f"{'Label':32}"
        f"{'Positive':>11}"
        f"{'Negative':>11}"
        f"{'Uncertain':>12}"
        f"{'Missing':>10}"
    )

    print("-" * 76)

    for label in LABELS:
        if label not in frontal_dataframe.columns:
            print(f"{label:32} COLUMN NOT FOUND")
            continue

        values = pd.to_numeric(
            frontal_dataframe[label],
            errors="coerce",
        )

        positive = int((values == 1).sum())
        negative = int((values == 0).sum())
        uncertain = int((values == -1).sum())
        missing = int(values.isna().sum())

        print(
            f"{label:32}"
            f"{positive:>11}"
            f"{negative:>11}"
            f"{uncertain:>12}"
            f"{missing:>10}"
        )


def check_image_paths(
    dataframe: pd.DataFrame,
    sample_size: int = 1000,
) -> None:
    print("\nChecking image paths...")

    checked = 0
    found = 0
    missing_examples: list[Path] = []

    for csv_path in dataframe["Path"].head(
        sample_size
    ):
        image_path = resolve_image_path(
            str(csv_path)
        )

        checked += 1

        if image_path.exists():
            found += 1
        elif len(missing_examples) < 5:
            missing_examples.append(image_path)

    print(f"Checked paths: {checked}")
    print(f"Existing images: {found}")
    print(f"Missing images: {checked - found}")

    if missing_examples:
        print("\nExamples of missing paths:")

        for image_path in missing_examples:
            print(image_path)


def main() -> None:
    if not TRAIN_CSV.exists():
        raise FileNotFoundError(
            f"train.csv was not found:\n"
            f"{TRAIN_CSV}"
        )

    if not VALID_CSV.exists():
        raise FileNotFoundError(
            f"valid.csv was not found:\n"
            f"{VALID_CSV}"
        )

    print("Reading CheXpert CSV files...")

    train_dataframe = pd.read_csv(
        TRAIN_CSV
    )

    valid_dataframe = pd.read_csv(
        VALID_CSV
    )

    print_label_summary(
        train_dataframe,
        "CheXpert Training Dataset",
    )

    print_label_summary(
        valid_dataframe,
        "CheXpert Official Validation Dataset",
    )

    check_image_paths(
        train_dataframe
    )


if __name__ == "__main__":
    main()