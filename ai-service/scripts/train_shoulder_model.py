from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
)


SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
HEAD_EPOCHS = 8
FINE_TUNE_EPOCHS = 12
FINE_TUNE_LAYERS = 35
MINIMUM_SENSITIVITY = 0.80

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "shoulder" / "processed"

TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"
TEST_DIR = DATA_DIR / "test"

MODEL_DIR = BASE_DIR / "models" / "shoulder"
MODEL_PATH = MODEL_DIR / "shoulder_model.keras"
HEAD_MODEL_PATH = MODEL_DIR / "shoulder_head_best.keras"
FINE_TUNED_MODEL_PATH = MODEL_DIR / "shoulder_finetuned_best.keras"
THRESHOLD_PATH = MODEL_DIR / "shoulder_threshold.json"
CLASS_NAMES_PATH = MODEL_DIR / "class_names.json"
REPORT_PATH = MODEL_DIR / "classification_report.txt"
CONFUSION_MATRIX_PATH = MODEL_DIR / "confusion_matrix.png"
TRAINING_HISTORY_PATH = MODEL_DIR / "training_history.png"

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


def verify_dataset() -> None:
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
                f"Required folder was not found: {folder}"
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

    return dataset.prefetch(tf.data.AUTOTUNE)


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    data_augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(0.03),
            tf.keras.layers.RandomZoom(0.08),
            tf.keras.layers.RandomTranslation(
                height_factor=0.03,
                width_factor=0.03,
            ),
            tf.keras.layers.RandomContrast(0.10),
        ],
        name="shoulder_augmentation",
    )

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
        include_top=False,
        weights="imagenet",
    )
    base_model.trainable = False

    inputs = tf.keras.Input(
        shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
        name="shoulder_image",
    )

    x = data_augmentation(inputs)
    x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
    x = base_model(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.BatchNormalization()(x)
    x = tf.keras.layers.Dropout(0.40)(x)

    outputs = tf.keras.layers.Dense(
        1,
        activation="sigmoid",
        name="abnormal_probability",
    )(x)

    model = tf.keras.Model(
        inputs,
        outputs,
        name="shoulder_xray_classifier",
    )

    return model, base_model


def compile_model(
    model: tf.keras.Model,
    learning_rate: float,
) -> None:
    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=learning_rate
        ),
        loss=tf.keras.losses.BinaryCrossentropy(),
        metrics=[
            tf.keras.metrics.BinaryAccuracy(name="accuracy"),
            tf.keras.metrics.AUC(name="auc", curve="ROC"),
            tf.keras.metrics.AUC(name="pr_auc", curve="PR"),
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )


def make_callbacks(
    checkpoint_path: Path,
    patience: int,
) -> list[tf.keras.callbacks.Callback]:
    return [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(checkpoint_path),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_auc",
            mode="max",
            patience=patience,
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            mode="min",
            factor=0.5,
            patience=2,
            min_lr=1e-7,
            verbose=1,
        ),
    ]


def collect_labels_and_probabilities(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
) -> tuple[np.ndarray, np.ndarray]:
    labels: list[int] = []
    probabilities: list[float] = []

    for images, batch_labels in dataset:
        batch_probabilities = model.predict(
            images,
            verbose=0,
        ).reshape(-1)

        probabilities.extend(batch_probabilities.tolist())
        labels.extend(
            batch_labels.numpy().reshape(-1).astype(int).tolist()
        )

    return (
        np.asarray(labels, dtype=np.int32),
        np.asarray(probabilities, dtype=np.float32),
    )


def calculate_binary_metrics(
    true_labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> dict[str, float | np.ndarray]:
    predicted_labels = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(
        true_labels,
        predicted_labels,
        labels=[0, 1],
    )

    true_normal, false_abnormal, false_normal, true_abnormal = (
        matrix.ravel()
    )

    sensitivity = (
        true_abnormal / (true_abnormal + false_normal)
        if true_abnormal + false_normal > 0
        else 0.0
    )
    specificity = (
        true_normal / (true_normal + false_abnormal)
        if true_normal + false_abnormal > 0
        else 0.0
    )
    precision = (
        true_abnormal / (true_abnormal + false_abnormal)
        if true_abnormal + false_abnormal > 0
        else 0.0
    )
    accuracy = float(np.mean(predicted_labels == true_labels))
    f1_score = (
        2 * precision * sensitivity / (precision + sensitivity)
        if precision + sensitivity > 0
        else 0.0
    )
    balanced_accuracy = (sensitivity + specificity) / 2

    return {
        "accuracy": accuracy,
        "sensitivity": sensitivity,
        "specificity": specificity,
        "precision": precision,
        "f1_score": f1_score,
        "balanced_accuracy": balanced_accuracy,
        "confusion_matrix": matrix,
    }


def choose_threshold(
    true_labels: np.ndarray,
    probabilities: np.ndarray,
) -> tuple[float, dict[str, float | np.ndarray]]:
    candidates: list[
        tuple[float, dict[str, float | np.ndarray]]
    ] = []

    for threshold in np.arange(0.10, 0.901, 0.005):
        metrics = calculate_binary_metrics(
            true_labels,
            probabilities,
            float(threshold),
        )

        if metrics["sensitivity"] >= MINIMUM_SENSITIVITY:
            candidates.append((float(threshold), metrics))

    if candidates:
        # Keep sensitivity suitable for triage, then reduce false alarms.
        return max(
            candidates,
            key=lambda item: (
                item[1]["specificity"],
                item[1]["balanced_accuracy"],
                item[0],
            ),
        )

    fallback_candidates = []
    for threshold in np.arange(0.10, 0.901, 0.005):
        metrics = calculate_binary_metrics(
            true_labels,
            probabilities,
            float(threshold),
        )
        fallback_candidates.append((float(threshold), metrics))

    return max(
        fallback_candidates,
        key=lambda item: item[1]["balanced_accuracy"],
    )


def validation_auc(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
) -> float:
    labels, probabilities = collect_labels_and_probabilities(
        model,
        dataset,
    )
    return float(roc_auc_score(labels, probabilities))


def save_confusion_matrix(
    matrix: np.ndarray,
) -> None:
    figure, axis = plt.subplots(figsize=(7, 6))
    image = axis.imshow(matrix)
    figure.colorbar(image, ax=axis)

    axis.set_title("Shoulder Model Confusion Matrix")
    axis.set_xlabel("Predicted label")
    axis.set_ylabel("True label")
    axis.set_xticks([0, 1], CLASS_NAMES)
    axis.set_yticks([0, 1], CLASS_NAMES)

    for row in range(2):
        for column in range(2):
            axis.text(
                column,
                row,
                str(matrix[row, column]),
                ha="center",
                va="center",
            )

    figure.tight_layout()
    figure.savefig(CONFUSION_MATRIX_PATH, dpi=160)
    plt.close(figure)


def save_training_history(
    head_history: tf.keras.callbacks.History,
    fine_tune_history: tf.keras.callbacks.History,
) -> None:
    head_epochs = range(1, len(head_history.history["loss"]) + 1)
    fine_epochs = range(
        len(head_history.history["loss"]) + 1,
        len(head_history.history["loss"])
        + len(fine_tune_history.history["loss"])
        + 1,
    )

    figure, axis = plt.subplots(figsize=(9, 6))
    axis.plot(
        head_epochs,
        head_history.history["auc"],
        label="Head training AUC",
    )
    axis.plot(
        head_epochs,
        head_history.history["val_auc"],
        label="Head validation AUC",
    )
    axis.plot(
        fine_epochs,
        fine_tune_history.history["auc"],
        label="Fine-tuning AUC",
    )
    axis.plot(
        fine_epochs,
        fine_tune_history.history["val_auc"],
        label="Fine-tuning validation AUC",
    )
    axis.axvline(
        x=len(head_history.history["loss"]) + 0.5,
        linestyle="--",
        label="Fine-tuning started",
    )
    axis.set_title("Shoulder Model Training History")
    axis.set_xlabel("Epoch")
    axis.set_ylabel("AUC")
    axis.legend()
    axis.grid(alpha=0.25)

    figure.tight_layout()
    figure.savefig(TRAINING_HISTORY_PATH, dpi=160)
    plt.close(figure)


def main() -> None:
    tf.keras.utils.set_random_seed(SEED)
    verify_dataset()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    normal_count = count_images(TRAIN_DIR / "NORMAL")
    abnormal_count = count_images(TRAIN_DIR / "ABNORMAL")
    total_count = normal_count + abnormal_count

    if normal_count == 0 or abnormal_count == 0:
        raise ValueError(
            "NORMAL or ABNORMAL training folder is empty."
        )

    print("\nShoulder training dataset")
    print(f"NORMAL: {normal_count}")
    print(f"ABNORMAL: {abnormal_count}")
    print(f"Total: {total_count}")

    # Tempered weights reduce imbalance without pushing the model toward
    # excessive ABNORMAL predictions as strongly as full inverse weights.
    raw_normal_weight = total_count / (2 * normal_count)
    raw_abnormal_weight = total_count / (2 * abnormal_count)
    class_weights = {
        0: float(np.sqrt(raw_normal_weight)),
        1: float(np.sqrt(raw_abnormal_weight)),
    }

    print(f"Tempered class weights: {class_weights}")

    train_dataset = create_dataset(TRAIN_DIR, shuffle=True)
    validation_dataset = create_dataset(VAL_DIR, shuffle=False)
    test_dataset = create_dataset(TEST_DIR, shuffle=False)

    model, base_model = build_model()
    compile_model(model, learning_rate=1e-3)
    model.summary()

    print("\nStage 1: training the classification head...")
    head_history = model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=HEAD_EPOCHS,
        class_weight=class_weights,
        callbacks=make_callbacks(
            HEAD_MODEL_PATH,
            patience=4,
        ),
    )

    print("\nStage 2: fine-tuning the last MobileNetV2 layers...")
    base_model.trainable = True

    for layer in base_model.layers[:-FINE_TUNE_LAYERS]:
        layer.trainable = False

    for layer in base_model.layers[-FINE_TUNE_LAYERS:]:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
        else:
            layer.trainable = True

    compile_model(model, learning_rate=1e-5)

    fine_tune_history = model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=FINE_TUNE_EPOCHS,
        class_weight=class_weights,
        callbacks=make_callbacks(
            FINE_TUNED_MODEL_PATH,
            patience=5,
        ),
    )

    print("\nSelecting the model with the best validation AUC...")
    head_model = tf.keras.models.load_model(HEAD_MODEL_PATH)
    fine_tuned_model = tf.keras.models.load_model(
        FINE_TUNED_MODEL_PATH
    )

    head_auc = validation_auc(head_model, validation_dataset)
    fine_tuned_auc = validation_auc(
        fine_tuned_model,
        validation_dataset,
    )

    if fine_tuned_auc >= head_auc:
        best_model = fine_tuned_model
        selected_model_name = FINE_TUNED_MODEL_PATH.name
        selected_validation_auc = fine_tuned_auc
    else:
        best_model = head_model
        selected_model_name = HEAD_MODEL_PATH.name
        selected_validation_auc = head_auc

    best_model.save(MODEL_PATH)

    print(
        f"Selected {selected_model_name} "
        f"with validation AUC {selected_validation_auc:.4f}."
    )

    validation_labels, validation_probabilities = (
        collect_labels_and_probabilities(
            best_model,
            validation_dataset,
        )
    )

    threshold, validation_metrics = choose_threshold(
        validation_labels,
        validation_probabilities,
    )

    print("\nSelected decision threshold")
    print(f"Threshold: {threshold:.3f}")
    print(
        "Validation sensitivity: "
        f"{validation_metrics['sensitivity'] * 100:.2f}%"
    )
    print(
        "Validation specificity: "
        f"{validation_metrics['specificity'] * 100:.2f}%"
    )

    test_labels, test_probabilities = (
        collect_labels_and_probabilities(
            best_model,
            test_dataset,
        )
    )

    test_metrics = calculate_binary_metrics(
        test_labels,
        test_probabilities,
        threshold,
    )
    test_auc = float(roc_auc_score(test_labels, test_probabilities))
    test_predictions = (
        test_probabilities >= threshold
    ).astype(int)

    report = classification_report(
        test_labels,
        test_predictions,
        target_names=CLASS_NAMES,
        digits=4,
        zero_division=0,
    )

    REPORT_PATH.write_text(report, encoding="utf-8")
    CLASS_NAMES_PATH.write_text(
        json.dumps(
            {"0": "NORMAL", "1": "ABNORMAL"},
            indent=2,
        ),
        encoding="utf-8",
    )
    THRESHOLD_PATH.write_text(
        json.dumps(
            {
                "threshold": round(threshold, 6),
                "positive_class": "ABNORMAL",
                "minimum_validation_sensitivity": (
                    MINIMUM_SENSITIVITY
                ),
                "selected_model": selected_model_name,
                "validation_auc": round(
                    selected_validation_auc,
                    6,
                ),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    save_confusion_matrix(test_metrics["confusion_matrix"])
    save_training_history(head_history, fine_tune_history)

    print("\nShoulder model test results")
    print(f"Threshold: {threshold:.3f}")
    print(f"Accuracy: {test_metrics['accuracy'] * 100:.2f}%")
    print(f"AUC: {test_auc * 100:.2f}%")
    print(
        "Balanced accuracy: "
        f"{test_metrics['balanced_accuracy'] * 100:.2f}%"
    )
    print(
        "Sensitivity: "
        f"{test_metrics['sensitivity'] * 100:.2f}%"
    )
    print(
        "Specificity: "
        f"{test_metrics['specificity'] * 100:.2f}%"
    )
    print(
        "ABNORMAL precision: "
        f"{test_metrics['precision'] * 100:.2f}%"
    )
    print(f"F1-score: {test_metrics['f1_score'] * 100:.2f}%")

    print("\nConfusion matrix:")
    print(test_metrics["confusion_matrix"])

    print("\nClassification report:")
    print(report)

    print(f"\nFinal model saved at:\n{MODEL_PATH}")
    print(f"Threshold saved at:\n{THRESHOLD_PATH}")
    print(f"Report saved at:\n{REPORT_PATH}")


if __name__ == "__main__":
    main()