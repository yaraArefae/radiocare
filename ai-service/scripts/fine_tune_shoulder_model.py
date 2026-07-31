from pathlib import Path
import json

import numpy as np
import tensorflow as tf


SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
EPOCHS = 12
UNFREEZE_LAST_LAYERS = 40

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = BASE_DIR / "data" / "shoulder" / "processed"
TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"
TEST_DIR = DATA_DIR / "test"

MODEL_DIR = BASE_DIR / "models" / "shoulder"

ORIGINAL_MODEL_PATH = (
    MODEL_DIR / "shoulder_model.keras"
)

FINE_TUNED_MODEL_PATH = (
    MODEL_DIR / "shoulder_model_finetuned.keras"
)

THRESHOLD_PATH = (
    MODEL_DIR / "shoulder_threshold.json"
)

CLASS_NAMES = ["NORMAL", "ABNORMAL"]

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}


def count_images(folder: Path) -> int:
    return sum(
        1
        for file in folder.rglob("*")
        if file.is_file()
        and file.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def verify_files() -> None:
    if not ORIGINAL_MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Original model was not found:\n"
            f"{ORIGINAL_MODEL_PATH}"
        )

    required_folders = [
        TRAIN_DIR / "NORMAL",
        TRAIN_DIR / "ABNORMAL",
        VAL_DIR / "NORMAL",
        VAL_DIR / "ABNORMAL",
        TEST_DIR / "NORMAL",
        TEST_DIR / "ABNORMAL",
    ]

    for folder in required_folders:
        if not folder.exists():
            raise FileNotFoundError(
                f"Required dataset folder was not found:\n"
                f"{folder}"
            )


def create_dataset(
    directory: Path,
    shuffle: bool,
) -> tf.data.Dataset:
    dataset = tf.keras.utils.image_dataset_from_directory(
        directory,
        labels="inferred",
        label_mode="binary",
        class_names=CLASS_NAMES,
        image_size=IMAGE_SIZE,
        batch_size=BATCH_SIZE,
        shuffle=shuffle,
        seed=SEED,
    )

    return dataset.prefetch(
        tf.data.AUTOTUNE
    )


def find_mobilenet_backbone(
    model: tf.keras.Model,
) -> tf.keras.Model:
    for layer in model.layers:
        if (
            isinstance(layer, tf.keras.Model)
            and "mobilenetv2" in layer.name.lower()
        ):
            return layer

    raise ValueError(
        "MobileNetV2 backbone was not found "
        "inside the shoulder model."
    )


def configure_fine_tuning(
    backbone: tf.keras.Model,
) -> None:
    backbone.trainable = True

    freeze_until = max(
        0,
        len(backbone.layers)
        - UNFREEZE_LAST_LAYERS,
    )

    for index, layer in enumerate(backbone.layers):
        if index < freeze_until:
            layer.trainable = False

        elif isinstance(
            layer,
            tf.keras.layers.BatchNormalization,
        ):
            # تثبيت BatchNormalization يمنع عدم استقرار التدريب
            layer.trainable = False

        else:
            layer.trainable = True


def collect_predictions(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
) -> tuple[np.ndarray, np.ndarray]:
    labels_list = []
    probabilities_list = []

    for images, labels in dataset:
        probabilities = model.predict(
            images,
            verbose=0,
        ).reshape(-1)

        probabilities_list.extend(
            probabilities.tolist()
        )

        labels_list.extend(
            labels.numpy()
            .reshape(-1)
            .astype(int)
            .tolist()
        )

    return (
        np.array(labels_list),
        np.array(probabilities_list),
    )


def calculate_results(
    labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> dict:
    predictions = (
        probabilities >= threshold
    ).astype(int)

    true_normal = int(
        np.sum(
            (labels == 0)
            & (predictions == 0)
        )
    )

    false_abnormal = int(
        np.sum(
            (labels == 0)
            & (predictions == 1)
        )
    )

    false_normal = int(
        np.sum(
            (labels == 1)
            & (predictions == 0)
        )
    )

    true_abnormal = int(
        np.sum(
            (labels == 1)
            & (predictions == 1)
        )
    )

    sensitivity_denominator = (
        true_abnormal + false_normal
    )

    specificity_denominator = (
        true_normal + false_abnormal
    )

    sensitivity = (
        true_abnormal
        / sensitivity_denominator
        if sensitivity_denominator > 0
        else 0.0
    )

    specificity = (
        true_normal
        / specificity_denominator
        if specificity_denominator > 0
        else 0.0
    )

    accuracy = (
        true_normal + true_abnormal
    ) / max(1, len(labels))

    balanced_accuracy = (
        sensitivity + specificity
    ) / 2

    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "balanced_accuracy": float(
            balanced_accuracy
        ),
        "confusion_matrix": [
            [true_normal, false_abnormal],
            [false_normal, true_abnormal],
        ],
    }


def find_best_threshold(
    labels: np.ndarray,
    probabilities: np.ndarray,
) -> dict:
    best_result = None

    # رفع الحد يساعد على تقليل اعتبار الصور
    # السليمة مصابة بشكل خاطئ.
    thresholds = np.arange(
        0.30,
        0.91,
        0.01,
    )

    for threshold in thresholds:
        result = calculate_results(
            labels,
            probabilities,
            float(threshold),
        )

        # المحافظة على حساسية لا تقل عن 70%
        if result["sensitivity"] < 0.70:
            continue

        if (
            best_result is None
            or result["balanced_accuracy"]
            > best_result["balanced_accuracy"]
        ):
            best_result = result

    if best_result is None:
        best_result = calculate_results(
            labels,
            probabilities,
            0.50,
        )

    return best_result


def print_results(
    title: str,
    results: dict,
) -> None:
    print(f"\n{title}")
    print(
        f"Threshold: "
        f"{results['threshold']:.2f}"
    )
    print(
        f"Accuracy: "
        f"{results['accuracy'] * 100:.2f}%"
    )
    print(
        f"Sensitivity: "
        f"{results['sensitivity'] * 100:.2f}%"
    )
    print(
        f"Specificity: "
        f"{results['specificity'] * 100:.2f}%"
    )
    print(
        f"Balanced accuracy: "
        f"{results['balanced_accuracy'] * 100:.2f}%"
    )
    print("Confusion matrix:")
    print(
        np.array(
            results["confusion_matrix"]
        )
    )


def main() -> None:
    tf.keras.utils.set_random_seed(SEED)

    verify_files()

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    train_normal = count_images(
        TRAIN_DIR / "NORMAL"
    )

    train_abnormal = count_images(
        TRAIN_DIR / "ABNORMAL"
    )

    total_train = (
        train_normal + train_abnormal
    )

    print("\nFine-tuning shoulder model")
    print(f"Train NORMAL: {train_normal}")
    print(f"Train ABNORMAL: {train_abnormal}")
    print(f"Train total: {total_train}")

    if train_normal == 0 or train_abnormal == 0:
        raise ValueError(
            "One of the training classes is empty."
        )

    train_dataset = create_dataset(
        TRAIN_DIR,
        shuffle=True,
    )

    validation_dataset = create_dataset(
        VAL_DIR,
        shuffle=False,
    )

    test_dataset = create_dataset(
        TEST_DIR,
        shuffle=False,
    )

    print("\nLoading original shoulder model...")

    model = tf.keras.models.load_model(
        ORIGINAL_MODEL_PATH,
        compile=False,
    )

    backbone = find_mobilenet_backbone(
        model
    )

    configure_fine_tuning(
        backbone
    )

    trainable_layers = sum(
        1
        for layer in backbone.layers
        if layer.trainable
    )

    print(
        f"MobileNetV2 layers: "
        f"{len(backbone.layers)}"
    )

    print(
        f"Trainable backbone layers: "
        f"{trainable_layers}"
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=0.00001
        ),
        loss="binary_crossentropy",
        metrics=[
            tf.keras.metrics.BinaryAccuracy(
                name="accuracy"
            ),
            tf.keras.metrics.AUC(
                name="auc"
            ),
            tf.keras.metrics.Precision(
                name="precision"
            ),
            tf.keras.metrics.Recall(
                name="recall"
            ),
        ],
    )

    # موازنة أخف من التدريب الأول حتى نقلل
    # الإنذارات الخاطئة للصور السليمة.
    normal_weight = np.sqrt(
        total_train
        / (2 * train_normal)
    )

    abnormal_weight = np.sqrt(
        total_train
        / (2 * train_abnormal)
    )

    class_weights = {
        0: float(normal_weight),
        1: float(abnormal_weight),
    }

    print(
        f"Fine-tuning class weights: "
        f"{class_weights}"
    )

    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(
                FINE_TUNED_MODEL_PATH
            ),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_auc",
            mode="max",
            patience=4,
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

    print("\nStarting fine-tuning...")

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=EPOCHS,
        class_weight=class_weights,
        callbacks=callbacks,
    )

    print(
        "\nLoading best fine-tuned model..."
    )

    best_model = tf.keras.models.load_model(
        FINE_TUNED_MODEL_PATH,
        compile=False,
    )

    validation_labels, validation_probabilities = (
        collect_predictions(
            best_model,
            validation_dataset,
        )
    )

    best_threshold_result = (
        find_best_threshold(
            validation_labels,
            validation_probabilities,
        )
    )

    best_threshold = (
        best_threshold_result["threshold"]
    )

    print_results(
        "Best validation results",
        best_threshold_result,
    )

    test_labels, test_probabilities = (
        collect_predictions(
            best_model,
            test_dataset,
        )
    )

    test_results = calculate_results(
        test_labels,
        test_probabilities,
        best_threshold,
    )

    print_results(
        "Fine-tuned model test results",
        test_results,
    )

    threshold_data = {
        "body_part": "shoulder",
        "model": (
            "shoulder_model_finetuned.keras"
        ),
        "threshold": float(
            best_threshold
        ),
        "validation_results": (
            best_threshold_result
        ),
        "test_results": test_results,
    }

    THRESHOLD_PATH.write_text(
        json.dumps(
            threshold_data,
            indent=4,
        ),
        encoding="utf-8",
    )

    print(
        "\nFine-tuned model saved at:\n"
        f"{FINE_TUNED_MODEL_PATH}"
    )

    print(
        "\nThreshold information saved at:\n"
        f"{THRESHOLD_PATH}"
    )


if __name__ == "__main__":
    main()