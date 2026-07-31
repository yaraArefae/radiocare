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
FINE_TUNE_EPOCHS = 10
MIN_IMAGES_PER_FINDING = 10

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "shoulder_findings"
CSV_PATH = DATA_DIR / "labels.csv"

MODEL_DIR = BASE_DIR / "models" / "shoulder_findings"
MODEL_PATH = MODEL_DIR / "shoulder_findings_model.keras"
LABELS_PATH = MODEL_DIR / "shoulder_findings_labels.json"
THRESHOLDS_PATH = MODEL_DIR / "shoulder_findings_thresholds.json"
REPORT_PATH = MODEL_DIR / "classification_report.txt"

TARGET_LABELS = [
    "fracture",
    "dislocation",
    "osteoarthritis",
    "calcific_tendinopathy",
    "avascular_necrosis",
    "cuff_arthropathy",
    "hardware",
    "other_abnormality",
]

REQUIRED_COLUMNS = ["image_path", "normal", *TARGET_LABELS]


def resolve_image_path(value: str) -> str:
    raw = Path(str(value).strip())
    path = raw if raw.is_absolute() else DATA_DIR / raw
    return str(path.resolve())


def load_and_validate_dataframe() -> pd.DataFrame:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"labels.csv was not found at:\n{CSV_PATH}")

    dataframe = pd.read_csv(CSV_PATH)

    missing_columns = [
        column for column in REQUIRED_COLUMNS
        if column not in dataframe.columns
    ]
    if missing_columns:
        raise ValueError(
            "Missing columns in labels.csv: " + ", ".join(missing_columns)
        )

    dataframe = dataframe[REQUIRED_COLUMNS].copy()
    dataframe["image_path"] = dataframe["image_path"].map(resolve_image_path)

    for column in ["normal", *TARGET_LABELS]:
        dataframe[column] = pd.to_numeric(dataframe[column], errors="coerce")

    if dataframe[["normal", *TARGET_LABELS]].isna().any().any():
        raise ValueError("All label cells must contain only 0 or 1.")

    invalid_values = ~dataframe[["normal", *TARGET_LABELS]].isin([0, 1])
    if invalid_values.any().any():
        raise ValueError("All label cells must contain only 0 or 1.")

    dataframe[["normal", *TARGET_LABELS]] = dataframe[
        ["normal", *TARGET_LABELS]
    ].astype(np.float32)

    missing_files = [
        path for path in dataframe["image_path"]
        if not Path(path).is_file()
    ]
    if missing_files:
        preview = "\n".join(missing_files[:10])
        raise FileNotFoundError(
            f"{len(missing_files)} image files were not found.\n"
            f"First missing paths:\n{preview}"
        )

    abnormal_sum = dataframe[TARGET_LABELS].sum(axis=1)

    contradictory = dataframe[
        (dataframe["normal"] == 1) & (abnormal_sum > 0)
    ]
    if not contradictory.empty:
        raise ValueError(
            "A row cannot be NORMAL and have an abnormal finding "
            f"at the same time. Contradictory rows: {len(contradictory)}"
        )

    unlabeled = dataframe[
        (dataframe["normal"] == 0) & (abnormal_sum == 0)
    ]
    if not unlabeled.empty:
        raise ValueError(
            "Every non-normal image must have at least one finding. "
            f"Unlabeled abnormal rows: {len(unlabeled)}"
        )

    duplicate_paths = dataframe["image_path"].duplicated().sum()
    if duplicate_paths:
        raise ValueError(
            f"Duplicate image paths found in labels.csv: {duplicate_paths}"
        )

    finding_counts = dataframe[TARGET_LABELS].sum().astype(int)

    print("\nShoulder findings dataset")
    print(f"Total images: {len(dataframe)}")
    print(f"NORMAL: {int(dataframe['normal'].sum())}")
    print("\nFinding counts:")
    print(finding_counts.to_string())

    unavailable = finding_counts[finding_counts < MIN_IMAGES_PER_FINDING]
    if not unavailable.empty:
        details = ", ".join(
            f"{name}={count}" for name, count in unavailable.items()
        )
        raise ValueError(
            "There are not enough positive images for a complete "
            "multi-finding model. Each finding needs at least "
            f"{MIN_IMAGES_PER_FINDING} images. Current counts: {details}"
        )

    return dataframe


def split_dataframe(
    dataframe: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train_frame, temporary_frame = train_test_split(
        dataframe,
        test_size=0.30,
        random_state=SEED,
        stratify=dataframe["normal"],
    )

    validation_frame, test_frame = train_test_split(
        temporary_frame,
        test_size=0.50,
        random_state=SEED,
        stratify=temporary_frame["normal"],
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
    labels = dataframe[TARGET_LABELS].to_numpy(dtype=np.float32)

    dataset = tf.data.Dataset.from_tensor_slices((image_paths, labels))

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
    dataset = dataset.prefetch(tf.data.AUTOTUNE)
    return dataset


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(0.04),
            tf.keras.layers.RandomZoom(0.08),
            tf.keras.layers.RandomTranslation(0.04, 0.04),
            tf.keras.layers.RandomContrast(0.10),
        ],
        name="shoulder_findings_augmentation",
    )

    base_model = tf.keras.applications.EfficientNetB0(
        include_top=False,
        weights="imagenet",
        input_shape=(*IMAGE_SIZE, 3),
    )
    base_model.trainable = False

    inputs = tf.keras.Input(
        shape=(*IMAGE_SIZE, 3),
        name="shoulder_xray",
    )
    x = augmentation(inputs)
    x = tf.keras.applications.efficientnet.preprocess_input(x)
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
        name="shoulder_findings_classifier",
    )
    return model, base_model


def compile_model(model: tf.keras.Model, learning_rate: float) -> None:
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=learning_rate),
        loss=tf.keras.losses.BinaryFocalCrossentropy(
            apply_class_balancing=True,
            gamma=2.0,
        ),
        metrics=[
            tf.keras.metrics.BinaryAccuracy(name="binary_accuracy"),
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
    probabilities = model.predict(dataset, verbose=1)
    true_batches = [labels.numpy() for _, labels in dataset]
    true_labels = np.concatenate(true_batches, axis=0)
    return true_labels, probabilities


def choose_thresholds(
    true_labels: np.ndarray,
    probabilities: np.ndarray,
) -> dict[str, float]:
    thresholds: dict[str, float] = {}

    for index, label in enumerate(TARGET_LABELS):
        precision, recall, candidates = precision_recall_curve(
            true_labels[:, index],
            probabilities[:, index],
        )

        if len(candidates) == 0:
            thresholds[label] = 0.50
            continue

        f1 = (
            2 * precision[:-1] * recall[:-1]
            / np.maximum(precision[:-1] + recall[:-1], 1e-8)
        )
        best_index = int(np.nanargmax(f1))
        thresholds[label] = float(
            np.clip(candidates[best_index], 0.10, 0.90)
        )

    return thresholds


def apply_thresholds(
    probabilities: np.ndarray,
    thresholds: dict[str, float],
) -> np.ndarray:
    threshold_array = np.array(
        [thresholds[label] for label in TARGET_LABELS],
        dtype=np.float32,
    )
    return (probabilities >= threshold_array).astype(int)


def save_report(
    true_labels: np.ndarray,
    predicted_labels: np.ndarray,
    thresholds: dict[str, float],
) -> None:
    report = classification_report(
        true_labels,
        predicted_labels,
        target_names=TARGET_LABELS,
        zero_division=0,
    )

    REPORT_PATH.write_text(
        "Shoulder Findings Model\n\n"
        f"Decision thresholds:\n{json.dumps(thresholds, indent=2)}\n\n"
        f"Classification report:\n{report}",
        encoding="utf-8",
    )

    print("\nShoulder findings test report")
    print(report)


def main() -> None:
    tf.keras.utils.set_random_seed(SEED)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    dataframe = load_and_validate_dataframe()
    train_frame, validation_frame, test_frame = split_dataframe(dataframe)

    print(
        "\nData split:"
        f"\nTrain: {len(train_frame)}"
        f"\nValidation: {len(validation_frame)}"
        f"\nTest: {len(test_frame)}"
    )

    train_dataset = create_dataset(train_frame, training=True)
    validation_dataset = create_dataset(validation_frame, training=False)
    test_dataset = create_dataset(test_frame, training=False)

    model, base_model = build_model()
    compile_model(model, learning_rate=1e-3)

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

    print("\nStage 2: fine-tuning EfficientNetB0...")
    base_model.trainable = True
    for layer in base_model.layers[:-35]:
        layer.trainable = False

    compile_model(model, learning_rate=1e-5)

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=FINE_TUNE_EPOCHS,
        callbacks=callbacks,
    )

    true_validation, validation_probabilities = collect_predictions(
        model,
        validation_dataset,
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

    model.save(MODEL_PATH)

    LABELS_PATH.write_text(
        json.dumps(
            {
                "labels": TARGET_LABELS,
                "normal_rule": (
                    "NORMAL when no supported finding exceeds "
                    "its decision threshold."
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

    save_report(
        true_test,
        predicted_test,
        thresholds,
    )

    print("\nTraining completed successfully.")
    print(f"Model: {MODEL_PATH}")
    print(f"Labels: {LABELS_PATH}")
    print(f"Thresholds: {THRESHOLDS_PATH}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
