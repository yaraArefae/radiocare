from pathlib import Path
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import tensorflow as tf

from train_chest_findings_model import (
    TARGET_LABELS,
    read_dataframe,
    create_balanced_subset,
    create_dataset,
    collect_predictions,
    calculate_auc,
)


BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = (
    BASE_DIR
    / "data"
    / "chest_findings"
    / "processed"
)

VALIDATION_CSV = DATA_DIR / "val.csv"
TEST_CSV = DATA_DIR / "test.csv"

MODEL_PATH = (
    BASE_DIR
    / "models"
    / "chest"
    / "chest_findings_model_finetuned.keras"
)

MAX_VALIDATION_ROWS = 8000


def inspect_split(
    model: tf.keras.Model,
    csv_path: Path,
    split_name: str,
    maximum_rows: int | None,
) -> None:
    dataframe = read_dataframe(csv_path)

    if maximum_rows is not None:
        dataframe = create_balanced_subset(
            dataframe,
            maximum_rows,
        )

    dataset = create_dataset(
        dataframe,
        shuffle=False,
    )

    labels, masks, predictions = collect_predictions(
        model,
        dataset,
    )

    print(f"\n{'=' * 95}")
    print(split_name)
    print(f"Images: {len(dataframe)}")
    print(f"{'=' * 95}")

    print(
        f"{'Finding':24}"
        f"{'Positive':>10}"
        f"{'Negative':>10}"
        f"{'AUC':>10}"
        f"{'Inverse AUC':>14}"
        f"{'Pos Mean':>12}"
        f"{'Neg Mean':>12}"
        f"{'Status':>13}"
    )

    print("-" * 105)

    for index, label in enumerate(TARGET_LABELS):
        known = masks[:, index] == 1

        label_values = labels[
            known,
            index,
        ]

        probabilities = predictions[
            known,
            index,
        ]

        positive_count = int(
            np.sum(label_values == 1)
        )

        negative_count = int(
            np.sum(label_values == 0)
        )

        original_auc = calculate_auc(
            label_values,
            probabilities,
        )

        inverse_auc = calculate_auc(
            label_values,
            1.0 - probabilities,
        )

        positive_mean = (
            float(
                np.mean(
                    probabilities[
                        label_values == 1
                    ]
                )
            )
            if positive_count > 0
            else 0.0
        )

        negative_mean = (
            float(
                np.mean(
                    probabilities[
                        label_values == 0
                    ]
                )
            )
            if negative_count > 0
            else 0.0
        )

        status = (
            "POSSIBLY REVERSED"
            if inverse_auc > original_auc
            else "NORMAL ORDER"
        )

        print(
            f"{label:24}"
            f"{positive_count:>10}"
            f"{negative_count:>10}"
            f"{original_auc * 100:>9.2f}%"
            f"{inverse_auc * 100:>13.2f}%"
            f"{positive_mean * 100:>11.2f}%"
            f"{negative_mean * 100:>11.2f}%"
            f"{status:>13}"
        )


def main() -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Fine-tuned model was not found:\n"
            f"{MODEL_PATH}"
        )

    print("Loading fine-tuned chest findings model...")

    model = tf.keras.models.load_model(
        MODEL_PATH,
        compile=False,
    )

    inspect_split(
        model=model,
        csv_path=VALIDATION_CSV,
        split_name="VALIDATION RESULTS",
        maximum_rows=MAX_VALIDATION_ROWS,
    )

    inspect_split(
        model=model,
        csv_path=TEST_CSV,
        split_name="OFFICIAL TEST RESULTS",
        maximum_rows=None,
    )


if __name__ == "__main__":
    main()