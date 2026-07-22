import json
import os
from pathlib import Path

# تقليل رسائل TensorFlow غير المهمة
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay,
)
from tensorflow import keras
from tensorflow.keras import layers


# =========================================================
# Paths
# =========================================================

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]

DATA_DIR = (
    AI_SERVICE_DIR
    / "data"
    / "chest"
    / "processed"
)

TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"
TEST_DIR = DATA_DIR / "test"

MODEL_DIR = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
)

MODEL_DIR.mkdir(parents=True, exist_ok=True)

BEST_MODEL_PATH = MODEL_DIR / "chest_model.keras"
CLASS_NAMES_PATH = MODEL_DIR / "class_names.json"
REPORT_PATH = MODEL_DIR / "classification_report.txt"
HISTORY_PLOT_PATH = MODEL_DIR / "training_history.png"
CONFUSION_MATRIX_PATH = MODEL_DIR / "confusion_matrix.png"


# =========================================================
# Training settings
# =========================================================

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
EPOCHS = 8
RANDOM_SEED = 42

# مهم: Normal = 0 وAbnormal = 1
CLASS_NAMES = ["NORMAL", "ABNORMAL"]

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
}


def count_images(folder: Path) -> int:
    """Count valid image files inside a folder."""

    if not folder.exists():
        return 0

    return sum(
        1
        for file in folder.rglob("*")
        if file.is_file()
        and file.suffix.lower() in IMAGE_EXTENSIONS
    )


def validate_dataset() -> None:
    """Check that all required folders contain images."""

    required_folders = [
        TRAIN_DIR / "NORMAL",
        TRAIN_DIR / "ABNORMAL",
        VAL_DIR / "NORMAL",
        VAL_DIR / "ABNORMAL",
        TEST_DIR / "NORMAL",
        TEST_DIR / "ABNORMAL",
    ]

    missing_folders = [
        folder
        for folder in required_folders
        if not folder.exists()
    ]

    if missing_folders:
        print("ERROR: Some dataset folders are missing:")

        for folder in missing_folders:
            print(f" - {folder}")

        raise FileNotFoundError(
            "The processed dataset is incomplete."
        )

    empty_folders = [
        folder
        for folder in required_folders
        if count_images(folder) == 0
    ]

    if empty_folders:
        print("ERROR: Some dataset folders are empty:")

        for folder in empty_folders:
            print(f" - {folder}")

        raise ValueError(
            "One or more dataset folders contain no images."
        )


def print_dataset_summary() -> None:
    """Print the number of images in each split."""

    print("\nDataset summary")
    print("=" * 60)

    for split_name, split_dir in [
        ("TRAIN", TRAIN_DIR),
        ("VALIDATION", VAL_DIR),
        ("TEST", TEST_DIR),
    ]:
        normal_count = count_images(
            split_dir / "NORMAL"
        )

        abnormal_count = count_images(
            split_dir / "ABNORMAL"
        )

        total = normal_count + abnormal_count

        print(f"\n[{split_name}]")
        print(f"NORMAL   : {normal_count}")
        print(f"ABNORMAL : {abnormal_count}")
        print(f"TOTAL    : {total}")

    print("\n" + "=" * 60)


def create_datasets():
    """Load train, validation, and test datasets."""

    train_dataset = (
        tf.keras.utils.image_dataset_from_directory(
            TRAIN_DIR,
            class_names=CLASS_NAMES,
            label_mode="binary",
            image_size=IMAGE_SIZE,
            batch_size=BATCH_SIZE,
            shuffle=True,
            seed=RANDOM_SEED,
        )
    )

    validation_dataset = (
        tf.keras.utils.image_dataset_from_directory(
            VAL_DIR,
            class_names=CLASS_NAMES,
            label_mode="binary",
            image_size=IMAGE_SIZE,
            batch_size=BATCH_SIZE,
            shuffle=False,
        )
    )

    test_dataset = (
        tf.keras.utils.image_dataset_from_directory(
            TEST_DIR,
            class_names=CLASS_NAMES,
            label_mode="binary",
            image_size=IMAGE_SIZE,
            batch_size=BATCH_SIZE,
            shuffle=False,
        )
    )

    autotune = tf.data.AUTOTUNE

    train_dataset = train_dataset.prefetch(
        buffer_size=autotune
    )

    validation_dataset = validation_dataset.prefetch(
        buffer_size=autotune
    )

    test_dataset = test_dataset.prefetch(
        buffer_size=autotune
    )

    return (
        train_dataset,
        validation_dataset,
        test_dataset,
    )


def calculate_class_weights() -> dict[int, float]:
    """Balance NORMAL and ABNORMAL classes."""

    normal_count = count_images(
        TRAIN_DIR / "NORMAL"
    )

    abnormal_count = count_images(
        TRAIN_DIR / "ABNORMAL"
    )

    total_count = normal_count + abnormal_count

    normal_weight = total_count / (
        2 * normal_count
    )

    abnormal_weight = total_count / (
        2 * abnormal_count
    )

    class_weights = {
        0: normal_weight,
        1: abnormal_weight,
    }

    print("\nClass weights")
    print("=" * 60)
    print(f"NORMAL weight   : {normal_weight:.4f}")
    print(f"ABNORMAL weight : {abnormal_weight:.4f}")
    print("=" * 60)

    return class_weights


def create_model() -> keras.Model:
    """Create an EfficientNetB0 transfer-learning model."""

    data_augmentation = keras.Sequential(
        [
            layers.RandomRotation(0.03),
            layers.RandomZoom(0.08),
            layers.RandomTranslation(
                height_factor=0.04,
                width_factor=0.04,
            ),
            layers.RandomContrast(0.08),
        ],
        name="data_augmentation",
    )

    base_model = (
        tf.keras.applications.EfficientNetB0(
            include_top=False,
            weights="imagenet",
            input_shape=(
                IMAGE_SIZE[0],
                IMAGE_SIZE[1],
                3,
            ),
        )
    )

    # في أول تدريب نجمد النموذج الأساسي
    base_model.trainable = False

    inputs = keras.Input(
        shape=(
            IMAGE_SIZE[0],
            IMAGE_SIZE[1],
            3,
        ),
        name="xray_image",
    )

    x = data_augmentation(inputs)

    x = base_model(
        x,
        training=False,
    )

    x = layers.GlobalAveragePooling2D()(x)

    x = layers.Dropout(0.35)(x)

    outputs = layers.Dense(
        1,
        activation="sigmoid",
        name="abnormal_probability",
    )(x)

    model = keras.Model(
        inputs=inputs,
        outputs=outputs,
        name="chest_xray_classifier",
    )

    model.compile(
        optimizer=keras.optimizers.Adam(
            learning_rate=0.001
        ),
        loss="binary_crossentropy",
        metrics=[
            keras.metrics.BinaryAccuracy(
                name="accuracy"
            ),
            keras.metrics.Precision(
                name="precision"
            ),
            keras.metrics.Recall(
                name="recall"
            ),
            keras.metrics.AUC(
                name="auc"
            ),
        ],
    )

    return model


def create_callbacks():
    """Create callbacks to save and control training."""

    return [
        keras.callbacks.ModelCheckpoint(
            filepath=BEST_MODEL_PATH,
            monitor="val_loss",
            save_best_only=True,
            verbose=1,
        ),

        keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=3,
            restore_best_weights=True,
            verbose=1,
        ),

        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.3,
            patience=2,
            min_lr=0.000001,
            verbose=1,
        ),
    ]


def save_training_history(
    history: keras.callbacks.History,
) -> None:
    """Save accuracy and loss charts."""

    epochs = range(
        1,
        len(history.history["loss"]) + 1,
    )

    plt.figure(figsize=(8, 5))

    plt.plot(
        epochs,
        history.history["accuracy"],
        label="Training Accuracy",
    )

    plt.plot(
        epochs,
        history.history["val_accuracy"],
        label="Validation Accuracy",
    )

    plt.xlabel("Epoch")
    plt.ylabel("Accuracy")
    plt.title("Chest Model Accuracy")
    plt.legend()
    plt.tight_layout()

    plt.savefig(
        HISTORY_PLOT_PATH,
        dpi=160,
    )

    plt.close()


def evaluate_model(
    model: keras.Model,
    test_dataset,
) -> None:
    """Evaluate the model on unseen test images."""

    print("\nEvaluating model on test data...")
    print("=" * 60)

    results = model.evaluate(
        test_dataset,
        verbose=1,
        return_dict=True,
    )

    for metric_name, value in results.items():
        print(
            f"{metric_name}: {value:.4f}"
        )

    true_labels = []
    predicted_labels = []

    for images, labels in test_dataset:
        predictions = model.predict(
            images,
            verbose=0,
        )

        binary_predictions = (
            predictions.reshape(-1) >= 0.5
        ).astype(int)

        true_labels.extend(
            labels.numpy()
            .reshape(-1)
            .astype(int)
            .tolist()
        )

        predicted_labels.extend(
            binary_predictions.tolist()
        )

    report = classification_report(
        true_labels,
        predicted_labels,
        target_names=CLASS_NAMES,
        digits=4,
        zero_division=0,
    )

    print("\nClassification report")
    print("=" * 60)
    print(report)

    REPORT_PATH.write_text(
        report,
        encoding="utf-8",
    )

    matrix = confusion_matrix(
        true_labels,
        predicted_labels,
    )

    true_normal = matrix[0][0]
    false_abnormal = matrix[0][1]
    false_normal = matrix[1][0]
    true_abnormal = matrix[1][1]

    sensitivity = (
        true_abnormal
        / (true_abnormal + false_normal)
        if true_abnormal + false_normal > 0
        else 0
    )

    specificity = (
        true_normal
        / (true_normal + false_abnormal)
        if true_normal + false_abnormal > 0
        else 0
    )

    print(f"Sensitivity: {sensitivity:.4f}")
    print(f"Specificity: {specificity:.4f}")

    display = ConfusionMatrixDisplay(
        confusion_matrix=matrix,
        display_labels=CLASS_NAMES,
    )

    display.plot(
        values_format="d",
    )

    plt.title("Chest Model Confusion Matrix")
    plt.tight_layout()

    plt.savefig(
        CONFUSION_MATRIX_PATH,
        dpi=160,
    )

    plt.close()


def main() -> None:
    print("=" * 60)
    print("Chest X-ray Model Training")
    print("Classification: NORMAL / ABNORMAL")
    print("=" * 60)

    tf.random.set_seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    validate_dataset()
    print_dataset_summary()

    (
        train_dataset,
        validation_dataset,
        test_dataset,
    ) = create_datasets()

    class_weights = calculate_class_weights()

    model = create_model()

    print("\nModel summary")
    print("=" * 60)
    model.summary()

    callbacks = create_callbacks()

    print("\nStarting training...")
    print("=" * 60)

    history = model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=EPOCHS,
        class_weight=class_weights,
        callbacks=callbacks,
    )

    save_training_history(history)

    print("\nLoading best saved model...")

    best_model = keras.models.load_model(
        BEST_MODEL_PATH
    )

    evaluate_model(
        best_model,
        test_dataset,
    )

    CLASS_NAMES_PATH.write_text(
        json.dumps(
            {
                "0": "NORMAL",
                "1": "ABNORMAL",
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\n" + "=" * 60)
    print("Training completed successfully.")
    print(f"Model saved to: {BEST_MODEL_PATH}")
    print(f"Report saved to: {REPORT_PATH}")
    print(
        "Confusion matrix saved to: "
        f"{CONFUSION_MATRIX_PATH}"
    )
    print(
        "Training chart saved to: "
        f"{HISTORY_PLOT_PATH}"
    )
    print("=" * 60)


if __name__ == "__main__":
    main()