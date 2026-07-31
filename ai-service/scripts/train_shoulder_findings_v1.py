from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import classification_report, precision_recall_curve
from sklearn.model_selection import train_test_split


SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 24
HEAD_EPOCHS = 12
FINE_TUNE_EPOCHS = 8

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "shoulder_findings"
CSV_PATH = DATA_DIR / "labels_available_clean.csv"

MODEL_DIR = BASE_DIR / "models" / "shoulder_findings_v1"
MODEL_PATH = MODEL_DIR / "shoulder_findings_v1.keras"
LABELS_PATH = MODEL_DIR / "shoulder_findings_v1_labels.json"
THRESHOLDS_PATH = MODEL_DIR / "shoulder_findings_v1_thresholds.json"
REPORT_PATH = MODEL_DIR / "classification_report.txt"

# V1 uses only labels that currently have real positive examples.
TARGET_LABELS = ["fracture", "hardware"]
REQUIRED_COLUMNS = ["image_path", "normal", *TARGET_LABELS]


def resolve_image_path(value: str) -> str:
    raw = Path(str(value).strip())
    path = raw if raw.is_absolute() else DATA_DIR / raw
    return str(path.resolve())


def load_dataframe() -> pd.DataFrame:
    if not CSV_PATH.is_file():
        raise FileNotFoundError(
            f"labels_available.csv was not found at:\n{CSV_PATH}"
        )

    dataframe = pd.read_csv(CSV_PATH)

    missing = [
        column
        for column in REQUIRED_COLUMNS
        if column not in dataframe.columns
    ]
    if missing:
        raise ValueError(
            "Missing required columns: " + ", ".join(missing)
        )

    dataframe = dataframe.copy()
    dataframe["image_path"] = dataframe["image_path"].map(
        resolve_image_path
    )

    for column in ["normal", *TARGET_LABELS]:
        dataframe[column] = pd.to_numeric(
            dataframe[column],
            errors="coerce",
        )

    if dataframe[["normal", *TARGET_LABELS]].isna().any().any():
        raise ValueError(
            "Label columns must contain only 0 or 1."
        )

    invalid = ~dataframe[
        ["normal", *TARGET_LABELS]
    ].isin([0, 1])

    if invalid.any().any():
        raise ValueError(
            "Label columns must contain only 0 or 1."
        )

    dataframe[
        ["normal", *TARGET_LABELS]
    ] = dataframe[
        ["normal", *TARGET_LABELS]
    ].astype(np.float32)

    missing_files = [
        path
        for path in dataframe["image_path"]
        if not Path(path).is_file()
    ]

    if missing_files:
        preview = "\n".join(missing_files[:10])
        raise FileNotFoundError(
            f"{len(missing_files)} images were not found.\n"
            f"First missing paths:\n{preview}"
        )

    contradictory = dataframe[
        (dataframe["normal"] == 1)
        & (dataframe[TARGET_LABELS].sum(axis=1) > 0)
    ]

    if not contradictory.empty:
        raise ValueError(
            "A NORMAL row cannot also contain FRACTURE or HARDWARE. "
            f"Contradictory rows: {len(contradictory)}"
        )

    print("\nShoulder Findings V1 dataset")
    print(f"Total images: {len(dataframe)}")
    print(f"NORMAL: {int(dataframe['normal'].sum())}")

    for label in TARGET_LABELS:
        print(
            f"{label.upper()}: "
            f"{int(dataframe[label].sum())}"
        )

    for label in TARGET_LABELS:
        positives = int(dataframe[label].sum())
        negatives = len(dataframe) - positives

        if positives < 10 or negatives < 10:
            raise ValueError(
                f"{label} needs at least 10 positive and "
                f"10 negative images. Found positives={positives}, "
                f"negatives={negatives}."
            )

    return dataframe


def split_dataframe(
    dataframe: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train_frame, temporary_frame = train_test_split(
        dataframe,
        test_size=0.30,
        random_state=SEED,
        shuffle=True,
    )

    validation_frame, test_frame = train_test_split(
        temporary_frame,
        test_size=0.50,
        random_state=SEED,
        shuffle=True,
    )

    return (
        train_frame.reset_index(drop=True),
        validation_frame.reset_index(drop=True),
        test_frame.reset_index(drop=True),
    )


def decode_image(
    image_path: tf.Tensor,
    labels: tf.Tensor,
) -> tuple[tf.Tensor, tf.Tensor]:
    image_bytes = tf.io.read_file(image_path)
    image = tf.io.decode_image(
        image_bytes,
        channels=3,
        expand_animations=False,
    )
    image.set_shape([None, None, 3])
    image = tf.image.resize(image, IMAGE_SIZE)
    image = tf.cast(image, tf.float32)
    return image, labels


def create_dataset(
    dataframe: pd.DataFrame,
    *,
    training: bool,
) -> tf.data.Dataset:
    image_paths = dataframe["image_path"].to_numpy()
    labels = dataframe[TARGET_LABELS].to_numpy(
        dtype=np.float32
    )

    dataset = tf.data.Dataset.from_tensor_slices(
        (image_paths, labels)
    )

    if training:
        dataset = dataset.shuffle(
            buffer_size=len(dataframe),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    dataset = dataset.map(
        decode_image,
        num_parallel_calls=tf.data.AUTOTUNE,
    )
    dataset = dataset.batch(BATCH_SIZE)
    return dataset.prefetch(tf.data.AUTOTUNE)


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(0.04),
            tf.keras.layers.RandomZoom(0.08),
            tf.keras.layers.RandomTranslation(0.04, 0.04),
            tf.keras.layers.RandomContrast(0.10),
        ],
        name="shoulder_findings_v1_augmentation",
    )

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    base_model.trainable = False

    inputs = tf.keras.Input(
        shape=(*IMAGE_SIZE, 3),
        name="shoulder_xray",
    )
    x = augmentation(inputs)
    x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
    x = base_model(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    outputs = tf.keras.layers.Dense(
        len(TARGET_LABELS),
        activation="sigmoid",
        name="finding_probabilities",
    )(x)

    model = tf.keras.Model(
        inputs,
        outputs,
        name="shoulder_findings_v1",
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
        loss=tf.keras.losses.BinaryFocalCrossentropy(
            apply_class_balancing=True,
            gamma=2.0,
        ),
        metrics=[
            tf.keras.metrics.BinaryAccuracy(
                name="binary_accuracy"
            ),
            tf.keras.metrics.AUC(
                name="auc",
                multi_label=True,
                num_labels=len(TARGET_LABELS),
            ),
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )


def collect_predictions(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
) -> tuple[np.ndarray, np.ndarray]:
    probabilities = model.predict(
        dataset,
        verbose=1,
    )

    true_labels = np.concatenate(
        [
            labels.numpy()
            for _, labels in dataset
        ],
        axis=0,
    )

    return true_labels, probabilities


def choose_thresholds(
    true_labels: np.ndarray,
    probabilities: np.ndarray,
) -> dict[str, float]:
    thresholds: dict[str, float] = {}

    for index, label in enumerate(TARGET_LABELS):
        precision, recall, candidates = (
            precision_recall_curve(
                true_labels[:, index],
                probabilities[:, index],
            )
        )

        if len(candidates) == 0:
            thresholds[label] = 0.50
            continue

        f1 = (
            2 * precision[:-1] * recall[:-1]
            / np.maximum(
                precision[:-1] + recall[:-1],
                1e-8,
            )
        )

        best_index = int(np.nanargmax(f1))

        thresholds[label] = float(
            np.clip(
                candidates[best_index],
                0.10,
                0.90,
            )
        )

    return thresholds


def apply_thresholds(
    probabilities: np.ndarray,
    thresholds: dict[str, float],
) -> np.ndarray:
    threshold_array = np.array(
        [
            thresholds[label]
            for label in TARGET_LABELS
        ],
        dtype=np.float32,
    )

    return (
        probabilities >= threshold_array
    ).astype(int)


def main() -> None:
    tf.keras.utils.set_random_seed(SEED)
    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    dataframe = load_dataframe()
    train_frame, validation_frame, test_frame = (
        split_dataframe(dataframe)
    )

    print(
        "\nData split:"
        f"\nTrain: {len(train_frame)}"
        f"\nValidation: {len(validation_frame)}"
        f"\nTest: {len(test_frame)}"
    )

    train_dataset = create_dataset(
        train_frame,
        training=True,
    )
    validation_dataset = create_dataset(
        validation_frame,
        training=False,
    )
    test_dataset = create_dataset(
        test_frame,
        training=False,
    )

    model, base_model = build_model()
    compile_model(
        model,
        learning_rate=1e-3,
    )

    callbacks = [
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
            factor=0.4,
            patience=2,
            min_lr=1e-7,
            verbose=1,
        ),
    ]

    print("\nStage 1: training classification head...")
    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=HEAD_EPOCHS,
        callbacks=callbacks,
    )

    print("\nStage 2: fine-tuning MobileNetV2...")
    base_model.trainable = True

    for layer in base_model.layers[:-35]:
        layer.trainable = False

    compile_model(
        model,
        learning_rate=1e-5,
    )

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=FINE_TUNE_EPOCHS,
        callbacks=callbacks,
    )

    true_validation, validation_probabilities = (
        collect_predictions(
            model,
            validation_dataset,
        )
    )

    thresholds = choose_thresholds(
        true_validation,
        validation_probabilities,
    )

    true_test, test_probabilities = collect_predictions(
        model,
        test_dataset,
    )

    predicted_test = apply_thresholds(
        test_probabilities,
        thresholds,
    )

    report = classification_report(
        true_test,
        predicted_test,
        target_names=TARGET_LABELS,
        zero_division=0,
    )

    model.save(MODEL_PATH)

    LABELS_PATH.write_text(
        json.dumps(
            {
                "labels": TARGET_LABELS,
                "normal_rule": (
                    "NORMAL when neither supported finding "
                    "exceeds its threshold."
                ),
                "model": MODEL_PATH.name,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    THRESHOLDS_PATH.write_text(
        json.dumps(
            {
                "thresholds": thresholds,
                "model": MODEL_PATH.name,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    REPORT_PATH.write_text(
        "Shoulder Findings V1\n\n"
        f"Thresholds:\n"
        f"{json.dumps(thresholds, indent=2)}\n\n"
        f"Classification report:\n{report}",
        encoding="utf-8",
    )

    print("\nShoulder Findings V1 test report")
    print(report)

    print("\nTraining completed successfully.")
    print(f"Model: {MODEL_PATH}")
    print(f"Labels: {LABELS_PATH}")
    print(f"Thresholds: {THRESHOLDS_PATH}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()