from pathlib import Path
import json
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import pandas as pd
import tensorflow as tf

# نستخدم دوال تجهيز الداتا والتقييم
# الموجودة في ملف التدريب السابق.
from train_chest_findings_model import (
    SEED,
    IMAGE_SIZE,
    TARGET_LABELS,
    NUMBER_OF_LABELS,
    read_dataframe,
    create_balanced_subset,
    create_dataset,
    create_masked_weighted_loss,
    masked_binary_accuracy,
    collect_predictions,
    calculate_auc,
    calculate_threshold_results,
)


# =========================================================
# Fine-tuning settings
# =========================================================

EPOCHS = 8

# زيادة العينة عن التدريب الأول.
MAX_TRAIN_ROWS = 50000
MAX_VALIDATION_ROWS = 8000

# فتح آخر طبقات من EfficientNetB0.
UNFREEZE_LAST_LAYERS = 70

LEARNING_RATE = 0.00001

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = (
    BASE_DIR
    / "data"
    / "chest_findings"
    / "processed"
)

TRAIN_CSV = DATA_DIR / "train.csv"
VAL_CSV = DATA_DIR / "val.csv"
TEST_CSV = DATA_DIR / "test.csv"

MODEL_DIR = (
    BASE_DIR
    / "models"
    / "chest"
)

ORIGINAL_MODEL_PATH = (
    MODEL_DIR
    / "chest_findings_model.keras"
)

FINE_TUNED_MODEL_PATH = (
    MODEL_DIR
    / "chest_findings_model_finetuned.keras"
)

LABELS_PATH = (
    MODEL_DIR
    / "chest_findings_finetuned_labels.json"
)

THRESHOLDS_PATH = (
    MODEL_DIR
    / "chest_findings_finetuned_thresholds.json"
)


# =========================================================
# Dataset balancing
# =========================================================

def calculate_fine_tuning_weights(
    dataframe: pd.DataFrame,
) -> np.ndarray:
    """
    استخدام أوزان أخف من التدريب الأول لتقليل
    الإنذارات الخاطئة، خاصة في Atelectasis.
    """
    weights: list[float] = []

    for label in TARGET_LABELS:
        known_mask = (
            dataframe[f"{label}_mask"] == 1
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

        ratio = (
            negative
            / max(positive, 1)
        )

        # الجذر التربيعي يعطي موازنة أقل حدة
        # من negative / positive مباشرة.
        weight = float(
            np.sqrt(ratio)
        )

        # دعم بسيط للحالات النادرة.
        if label in {
            "Pneumonia",
            "Pneumothorax",
        }:
            weight *= 1.20

        weight = float(
            np.clip(
                weight,
                1.0,
                6.0,
            )
        )

        weights.append(weight)

    return np.array(
        weights,
        dtype=np.float32,
    )


# =========================================================
# EfficientNet fine-tuning
# =========================================================

def find_efficientnet_backbone(
    model: tf.keras.Model,
) -> tf.keras.Model:
    for layer in model.layers:
        if (
            isinstance(layer, tf.keras.Model)
            and "efficientnet" in layer.name.lower()
        ):
            return layer

    raise ValueError(
        "EfficientNet backbone was not found "
        "inside the chest findings model."
    )


def configure_backbone(
    backbone: tf.keras.Model,
) -> None:
    backbone.trainable = True

    freeze_until = max(
        0,
        len(backbone.layers)
        - UNFREEZE_LAST_LAYERS,
    )

    for index, layer in enumerate(
        backbone.layers
    ):
        if index < freeze_until:
            layer.trainable = False

        elif isinstance(
            layer,
            tf.keras.layers.BatchNormalization,
        ):
            # تثبيت BatchNormalization يساعد على
            # استقرار التدريب مع Learning Rate صغير.
            layer.trainable = False

        else:
            layer.trainable = True


# =========================================================
# Threshold selection
# =========================================================

def find_safer_threshold(
    labels: np.ndarray,
    probabilities: np.ndarray,
) -> dict:
    """
    اختيار Threshold يوازن بين الحساسية والنوعية،
    مع تجنب نتيجة 100% حساسية و0% نوعية.
    """
    valid_results: list[dict] = []
    all_results: list[dict] = []

    for threshold in np.arange(
        0.05,
        0.96,
        0.01,
    ):
        result = calculate_threshold_results(
            labels,
            probabilities,
            float(threshold),
        )

        all_results.append(result)

        if (
            result["sensitivity"] >= 0.35
            and result["specificity"] >= 0.35
        ):
            valid_results.append(result)

    candidates = (
        valid_results
        if valid_results
        else all_results
    )

    return max(
        candidates,
        key=lambda result: (
            result["balanced_accuracy"],
            result["f1_score"],
        ),
    )


def print_result(
    label: str,
    auc_value: float,
    result: dict,
) -> None:
    print(
        f"{label:25}"
        f"{auc_value * 100:>8.2f}%"
        f"{result['sensitivity'] * 100:>9.2f}%"
        f"{result['specificity'] * 100:>9.2f}%"
        f"{result['f1_score'] * 100:>9.2f}%"
        f"{result['threshold']:>10.2f}"
    )


# =========================================================
# Main
# =========================================================

def main() -> None:
    tf.keras.utils.set_random_seed(
        SEED
    )

    if not ORIGINAL_MODEL_PATH.exists():
        raise FileNotFoundError(
            "The original chest findings model "
            f"was not found:\n{ORIGINAL_MODEL_PATH}"
        )

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(
        "Reading prepared CheXpert data..."
    )

    train_dataframe = read_dataframe(
        TRAIN_CSV
    )

    validation_dataframe = read_dataframe(
        VAL_CSV
    )

    test_dataframe = read_dataframe(
        TEST_CSV
    )

    train_dataframe = create_balanced_subset(
        train_dataframe,
        MAX_TRAIN_ROWS,
    )

    validation_dataframe = create_balanced_subset(
        validation_dataframe,
        MAX_VALIDATION_ROWS,
    )

    print(
        f"\nFine-tuning images: "
        f"{len(train_dataframe)}"
    )

    print(
        f"Validation images: "
        f"{len(validation_dataframe)}"
    )

    print(
        f"Official test images: "
        f"{len(test_dataframe)}"
    )

    positive_weights = (
        calculate_fine_tuning_weights(
            train_dataframe
        )
    )

    print(
        "\nFine-tuning positive weights:"
    )

    for label, weight in zip(
        TARGET_LABELS,
        positive_weights,
    ):
        print(
            f"{label:25} {weight:.3f}"
        )

    train_dataset = create_dataset(
        train_dataframe,
        shuffle=True,
    )

    validation_dataset = create_dataset(
        validation_dataframe,
        shuffle=False,
    )

    test_dataset = create_dataset(
        test_dataframe,
        shuffle=False,
    )

    print(
        "\nLoading the original model..."
    )

    model = tf.keras.models.load_model(
        ORIGINAL_MODEL_PATH,
        compile=False,
    )

    backbone = find_efficientnet_backbone(
        model
    )

    configure_backbone(
        backbone
    )

    trainable_backbone_layers = sum(
        1
        for layer in backbone.layers
        if layer.trainable
    )

    print(
        f"EfficientNet total layers: "
        f"{len(backbone.layers)}"
    )

    print(
        f"Trainable backbone layers: "
        f"{trainable_backbone_layers}"
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=LEARNING_RATE
        ),
        loss=create_masked_weighted_loss(
            positive_weights
        ),
        metrics=[
            masked_binary_accuracy
        ],
    )

    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(
                FINE_TUNED_MODEL_PATH
            ),
            monitor="val_loss",
            mode="min",
            save_best_only=True,
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            mode="min",
            patience=3,
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            mode="min",
            factor=0.5,
            patience=2,
            min_lr=0.0000001,
            verbose=1,
        ),
    ]

    print(
        "\nStarting chest findings fine-tuning..."
    )

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=EPOCHS,
        callbacks=callbacks,
    )

    print(
        "\nLoading the best fine-tuned model..."
    )

    best_model = tf.keras.models.load_model(
        FINE_TUNED_MODEL_PATH,
        compile=False,
    )

    (
        validation_labels,
        validation_masks,
        validation_predictions,
    ) = collect_predictions(
        best_model,
        validation_dataset,
    )

    thresholds: dict[str, float] = {}
    validation_results: dict[str, dict] = {}

    print(
        "\nSelecting safer thresholds..."
    )

    for index, label in enumerate(
        TARGET_LABELS
    ):
        known = (
            validation_masks[:, index] == 1
        )

        label_values = (
            validation_labels[
                known,
                index,
            ]
        )

        probabilities = (
            validation_predictions[
                known,
                index,
            ]
        )

        best_result = find_safer_threshold(
            label_values,
            probabilities,
        )

        thresholds[label] = float(
            best_result["threshold"]
        )

        validation_results[label] = (
            best_result
        )

        print(
            f"{label:25} "
            f"threshold="
            f"{best_result['threshold']:.2f} "
            f"sensitivity="
            f"{best_result['sensitivity'] * 100:.2f}% "
            f"specificity="
            f"{best_result['specificity'] * 100:.2f}%"
        )

    (
        test_labels,
        test_masks,
        test_predictions,
    ) = collect_predictions(
        best_model,
        test_dataset,
    )

    test_results: dict[str, dict] = {}

    print(
        "\nFine-tuned chest findings test results"
    )

    print(
        f"\n{'Finding':25}"
        f"{'AUC':>9}"
        f"{'Sens':>10}"
        f"{'Spec':>10}"
        f"{'F1':>10}"
        f"{'Threshold':>11}"
    )

    print("-" * 76)

    for index, label in enumerate(
        TARGET_LABELS
    ):
        known = (
            test_masks[:, index] == 1
        )

        label_values = (
            test_labels[
                known,
                index,
            ]
        )

        probabilities = (
            test_predictions[
                known,
                index,
            ]
        )

        threshold = thresholds[label]

        result = calculate_threshold_results(
            label_values,
            probabilities,
            threshold,
        )

        auc_value = calculate_auc(
            label_values,
            probabilities,
        )

        result["auc"] = float(
            auc_value
        )

        test_results[label] = result

        print_result(
            label,
            auc_value,
            result,
        )

    LABELS_PATH.write_text(
        json.dumps(
            {
                "labels": TARGET_LABELS,
                "model": (
                    FINE_TUNED_MODEL_PATH.name
                ),
                "imageSize": list(
                    IMAGE_SIZE
                ),
            },
            indent=4,
        ),
        encoding="utf-8",
    )

    THRESHOLDS_PATH.write_text(
        json.dumps(
            {
                "model": (
                    FINE_TUNED_MODEL_PATH.name
                ),
                "thresholds": thresholds,
                "validationResults": (
                    validation_results
                ),
                "testResults": test_results,
            },
            indent=4,
        ),
        encoding="utf-8",
    )

    print(
        "\nFine-tuned model saved at:\n"
        f"{FINE_TUNED_MODEL_PATH}"
    )

    print(
        "\nFine-tuned thresholds saved at:\n"
        f"{THRESHOLDS_PATH}"
    )


if __name__ == "__main__":
    main() 