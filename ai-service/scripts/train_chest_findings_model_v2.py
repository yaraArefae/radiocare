from pathlib import Path
import json
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import pandas as pd
import tensorflow as tf


# =========================================================
# Settings
# =========================================================

SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
EPOCHS = 10



# للتجربة الأولى نستخدم عينة مناسبة لجهازك.
# بعد نجاح المودل يمكن تغييرها إلى None لاستخدام كل الداتا.
MAX_TRAIN_ROWS = 80000
MAX_VALIDATION_ROWS = 10000

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

MODEL_DIR = BASE_DIR / "models" / "chest"

MODEL_PATH = (
    MODEL_DIR
    / "chest_findings_model_v2.keras"
)

LABELS_PATH = (
    MODEL_DIR
    / "chest_findings_labels_v2.json"
)

THRESHOLDS_PATH = (
    MODEL_DIR
    / "chest_findings_thresholds_v2.json"
)


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

NUMBER_OF_LABELS = len(TARGET_LABELS)


# =========================================================
# Read and sample data
# =========================================================

def read_dataframe(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(
            f"CSV file was not found:\n{csv_path}"
        )

    dataframe = pd.read_csv(csv_path)

    required_columns = [
        "image_path",
        *TARGET_LABELS,
        *[
            f"{label}_mask"
            for label in TARGET_LABELS
        ],
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in dataframe.columns
    ]

    if missing_columns:
        raise ValueError(
            f"Missing columns in {csv_path.name}: "
            f"{missing_columns}"
        )

    return dataframe


def create_balanced_subset(
    dataframe: pd.DataFrame,
    maximum_rows: int | None,
) -> pd.DataFrame:
    if (
        maximum_rows is None
        or len(dataframe) <= maximum_rows
    ):
        return dataframe.sample(
            frac=1,
            random_state=SEED,
        ).reset_index(drop=True)

    selected_indices: set[int] = set()

    # المحافظة على عدد مناسب من الحالات الموجبة
    # لكل finding، خصوصًا الأمراض النادرة.
    positive_target_per_label = max(
        500,
        maximum_rows
        // (NUMBER_OF_LABELS * 3),
    )

    for label in TARGET_LABELS:
        positive_rows = dataframe[
            (dataframe[label] == 1)
            & (dataframe[f"{label}_mask"] == 1)
        ]

        sample_size = min(
            len(positive_rows),
            positive_target_per_label,
        )

        if sample_size > 0:
            sampled = positive_rows.sample(
                n=sample_size,
                random_state=(
                    SEED
                    + TARGET_LABELS.index(label)
                ),
            )

            selected_indices.update(
                sampled.index.tolist()
            )

    remaining_rows = (
        maximum_rows
        - len(selected_indices)
    )

    if remaining_rows > 0:
        remaining_dataframe = dataframe.drop(
            index=list(selected_indices),
            errors="ignore",
        )

        remaining_sample = (
            remaining_dataframe.sample(
                n=min(
                    remaining_rows,
                    len(remaining_dataframe),
                ),
                random_state=SEED,
            )
        )

        selected_indices.update(
            remaining_sample.index.tolist()
        )

    subset = dataframe.loc[
        list(selected_indices)
    ].copy()

    return subset.sample(
        frac=1,
        random_state=SEED,
    ).reset_index(drop=True)


# =========================================================
# TensorFlow datasets
# =========================================================

def load_image(
    image_path: tf.Tensor,
    packed_targets: tf.Tensor,
) -> tuple[tf.Tensor, tf.Tensor]:
    image_bytes = tf.io.read_file(
        image_path
    )

    image = tf.io.decode_image(
        image_bytes,
        channels=3,
        expand_animations=False,
    )

    image.set_shape(
        [None, None, 3]
    )

    image = tf.image.resize(
        image,
        IMAGE_SIZE,
    )

    image = tf.cast(
        image,
        tf.float32,
    )

    return image, packed_targets


def create_dataset(
    dataframe: pd.DataFrame,
    shuffle: bool,
) -> tf.data.Dataset:
    image_paths = (
        dataframe["image_path"]
        .astype(str)
        .to_numpy()
    )

    labels = (
        dataframe[TARGET_LABELS]
        .astype(np.float32)
        .to_numpy()
    )

    mask_columns = [
        f"{label}_mask"
        for label in TARGET_LABELS
    ]

    masks = (
        dataframe[mask_columns]
        .astype(np.float32)
        .to_numpy()
    )

    # أول 8 قيم هي التصنيفات،
    # وآخر 8 قيم هي الـmask.
    packed_targets = np.concatenate(
        [labels, masks],
        axis=1,
    ).astype(np.float32)

    dataset = tf.data.Dataset.from_tensor_slices(
        (
            image_paths,
            packed_targets,
        )
    )

    if shuffle:
        dataset = dataset.shuffle(
            buffer_size=min(
                len(dataframe),
                10000,
            ),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    dataset = dataset.map(
        load_image,
        num_parallel_calls=tf.data.AUTOTUNE,
    )

    dataset = dataset.batch(
        BATCH_SIZE
    )

    return dataset.prefetch(
        tf.data.AUTOTUNE
    )


# =========================================================
# Masked weighted loss
# =========================================================

def calculate_positive_weights(
    dataframe: pd.DataFrame,
) -> np.ndarray:
    weights = []

    for label in TARGET_LABELS:
        mask = (
            dataframe[f"{label}_mask"]
            == 1
        )

        positive = int(
            (
                mask
                & (dataframe[label] == 1)
            ).sum()
        )

        negative = int(
            (
                mask
                & (dataframe[label] == 0)
            ).sum()
        )

        weight = (
            negative / max(positive, 1)
        )

        # منع الأوزان العالية جدًا من جعل
        # التدريب غير مستقر.
        weight = float(
            np.clip(
                weight,
                1.0,
                10.0,
            )
        )

        weights.append(weight)

    return np.array(
        weights,
        dtype=np.float32,
    )


def create_masked_weighted_loss(
    positive_weights: np.ndarray,
):
    positive_weights_tensor = tf.constant(
        positive_weights,
        dtype=tf.float32,
    )

    def masked_weighted_binary_crossentropy(
        packed_targets: tf.Tensor,
        predictions: tf.Tensor,
    ) -> tf.Tensor:
        labels = packed_targets[
            :,
            :NUMBER_OF_LABELS
        ]

        masks = packed_targets[
            :,
            NUMBER_OF_LABELS:
        ]

        predictions_clipped = tf.clip_by_value(
            predictions,
            tf.keras.backend.epsilon(),
            1.0 - tf.keras.backend.epsilon(),
        )

        positive_loss = (
            -labels
            * tf.math.log(predictions_clipped)
            * positive_weights_tensor
        )

        negative_loss = (
            -(1.0 - labels)
            * tf.math.log(
                1.0 - predictions_clipped
            )
        )

        masked_loss = (
            positive_loss + negative_loss
        ) * masks

        loss_per_image = (
            tf.reduce_sum(
                masked_loss,
                axis=1,
            )
            / (
                tf.reduce_sum(
                    masks,
                    axis=1,
                )
                + tf.keras.backend.epsilon()
            )
        )

        return loss_per_image

    return masked_weighted_binary_crossentropy


def masked_binary_accuracy(
    packed_targets: tf.Tensor,
    predictions: tf.Tensor,
) -> tf.Tensor:
    labels = packed_targets[
        :,
        :NUMBER_OF_LABELS
    ]

    masks = packed_targets[
        :,
        NUMBER_OF_LABELS:
    ]

    predicted_labels = tf.cast(
        predictions >= 0.5,
        tf.float32,
    )

    correct = tf.cast(
        tf.equal(
            labels,
            predicted_labels,
        ),
        tf.float32,
    )

    return (
        tf.reduce_sum(
            correct * masks
        )
        / (
            tf.reduce_sum(masks)
            + tf.keras.backend.epsilon()
        )
    )


# =========================================================
# Model
# =========================================================

def build_model() -> tf.keras.Model:
    data_augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(
                0.025
            ),
            tf.keras.layers.RandomZoom(
                0.05
            ),
            tf.keras.layers.RandomTranslation(
                height_factor=0.03,
                width_factor=0.03,
            ),
            tf.keras.layers.RandomContrast(
                0.10
            ),
        ],
        name="chest_augmentation",
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

    base_model.trainable = False

    inputs = tf.keras.Input(
        shape=(
            IMAGE_SIZE[0],
            IMAGE_SIZE[1],
            3,
        ),
        name="chest_xray",
    )

    x = data_augmentation(
        inputs
    )

    x = base_model(
        x,
        training=False,
    )

    x = tf.keras.layers.GlobalAveragePooling2D()(
        x
    )

    x = tf.keras.layers.Dropout(
        0.35
    )(x)

    x = tf.keras.layers.Dense(
        256,
        activation="relu",
    )(x)

    x = tf.keras.layers.Dropout(
        0.25
    )(x)

    outputs = tf.keras.layers.Dense(
        NUMBER_OF_LABELS,
        activation="sigmoid",
        name="possible_findings",
    )(x)

    return tf.keras.Model(
        inputs=inputs,
        outputs=outputs,
        name="chest_findings_classifier",
    )


# =========================================================
# Evaluation
# =========================================================

def collect_predictions(
    model: tf.keras.Model,
    dataset: tf.data.Dataset,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    all_labels = []
    all_masks = []
    all_predictions = []

    for images, packed_targets in dataset:
        predictions = model.predict(
            images,
            verbose=0,
        )

        packed_numpy = (
            packed_targets.numpy()
        )

        all_labels.append(
            packed_numpy[
                :,
                :NUMBER_OF_LABELS
            ]
        )

        all_masks.append(
            packed_numpy[
                :,
                NUMBER_OF_LABELS:
            ]
        )

        all_predictions.append(
            predictions
        )

    return (
        np.concatenate(
            all_labels,
            axis=0,
        ),
        np.concatenate(
            all_masks,
            axis=0,
        ),
        np.concatenate(
            all_predictions,
            axis=0,
        ),
    )


def calculate_auc(
    labels: np.ndarray,
    predictions: np.ndarray,
) -> float:
    if len(np.unique(labels)) < 2:
        return 0.0

    metric = tf.keras.metrics.AUC()

    metric.update_state(
        labels,
        predictions,
    )

    return float(
        metric.result().numpy()
    )


def calculate_threshold_results(
    labels: np.ndarray,
    predictions: np.ndarray,
    threshold: float,
) -> dict:
    predicted_labels = (
        predictions >= threshold
    ).astype(np.int32)

    labels = labels.astype(
        np.int32
    )

    true_positive = int(
        np.sum(
            (labels == 1)
            & (predicted_labels == 1)
        )
    )

    true_negative = int(
        np.sum(
            (labels == 0)
            & (predicted_labels == 0)
        )
    )

    false_positive = int(
        np.sum(
            (labels == 0)
            & (predicted_labels == 1)
        )
    )

    false_negative = int(
        np.sum(
            (labels == 1)
            & (predicted_labels == 0)
        )
    )

    sensitivity = (
        true_positive
        / max(
            true_positive + false_negative,
            1,
        )
    )

    specificity = (
        true_negative
        / max(
            true_negative + false_positive,
            1,
        )
    )

    precision = (
        true_positive
        / max(
            true_positive + false_positive,
            1,
        )
    )

    f1_score = (
        2
        * precision
        * sensitivity
        / max(
            precision + sensitivity,
            1e-8,
        )
    )

    balanced_accuracy = (
        sensitivity + specificity
    ) / 2

    return {
        "threshold": float(threshold),
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "precision": float(precision),
        "f1_score": float(f1_score),
        "balanced_accuracy": float(
            balanced_accuracy
        ),
        "confusion_matrix": [
            [true_negative, false_positive],
            [false_negative, true_positive],
        ],
    }


def find_best_threshold(
    labels: np.ndarray,
    predictions: np.ndarray,
) -> dict:
    best_result = None

    for threshold in np.arange(
        0.10,
        0.91,
        0.01,
    ):
        result = calculate_threshold_results(
            labels,
            predictions,
            float(threshold),
        )

        if (
            best_result is None
            or result["balanced_accuracy"]
            > best_result[
                "balanced_accuracy"
            ]
        ):
            best_result = result

    return best_result


# =========================================================
# Main
# =========================================================

def main() -> None:
    tf.keras.utils.set_random_seed(
        SEED
    )

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("Reading prepared CheXpert data...")

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

    validation_dataframe = (
        create_balanced_subset(
            validation_dataframe,
            MAX_VALIDATION_ROWS,
        )
    )

    print(
        f"\nTraining images: "
        f"{len(train_dataframe)}"
    )

    print(
        f"Validation images: "
        f"{len(validation_dataframe)}"
    )

    print(
        f"Internal test images: "
        f"{len(test_dataframe)}"
    )

    positive_weights = (
        calculate_positive_weights(
            train_dataframe
        )
    )

    print("\nPositive weights:")

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

    model = build_model()

    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=0.001
        ),
        loss=create_masked_weighted_loss(
            positive_weights
        ),
        metrics=[
            masked_binary_accuracy
        ],
    )

    model.summary()

    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(MODEL_PATH),
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
            min_lr=0.000001,
            verbose=1,
        ),
    ]

    print(
        "\nStarting chest findings training..."
    )

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=EPOCHS,
        callbacks=callbacks,
    )

    print(
        "\nLoading best chest findings model..."
    )

    best_model = tf.keras.models.load_model(
        MODEL_PATH,
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

    thresholds_data = {}

    print(
        "\nSelecting thresholds "
        "using validation data..."
    )

    for index, label in enumerate(
        TARGET_LABELS
    ):
        known = (
            validation_masks[:, index]
            == 1
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

        best_result = find_best_threshold(
            label_values,
            probabilities,
        )

        thresholds_data[label] = (
            best_result["threshold"]
        )

        print(
            f"{label:25} "
            f"threshold="
            f"{best_result['threshold']:.2f} "
            f"balanced_accuracy="
            f"{best_result['balanced_accuracy'] * 100:.2f}%"
        )

    (
        test_labels,
        test_masks,
        test_predictions,
    ) = collect_predictions(
        best_model,
        test_dataset,
    )

    test_results = {}

    print(
        "\nChest findings official test results"
    )

    print(
        f"\n{'Finding':25}"
        f"{'AUC':>8}"
        f"{'Sens':>9}"
        f"{'Spec':>9}"
        f"{'F1':>9}"
    )

    print("-" * 60)

    for index, label in enumerate(
        TARGET_LABELS
    ):
        known = (
            test_masks[:, index]
            == 1
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

        threshold = float(
            thresholds_data[label]
        )

        result = calculate_threshold_results(
            label_values,
            probabilities,
            threshold,
        )

        auc_value = calculate_auc(
            label_values,
            probabilities,
        )

        result["auc"] = auc_value

        test_results[label] = result

        print(
            f"{label:25}"
            f"{auc_value * 100:>7.2f}%"
            f"{result['sensitivity'] * 100:>8.2f}%"
            f"{result['specificity'] * 100:>8.2f}%"
            f"{result['f1_score'] * 100:>8.2f}%"
        )

    LABELS_PATH.write_text(
        json.dumps(
            {
                "labels": TARGET_LABELS,
                "model": MODEL_PATH.name,
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
                "model": MODEL_PATH.name,
                "thresholds": thresholds_data,
                "testResults": test_results,
            },
            indent=4,
        ),
        encoding="utf-8",
    )

    print(
        "\nChest findings model saved at:\n"
        f"{MODEL_PATH}"
    )

    print(
        "\nThresholds saved at:\n"
        f"{THRESHOLDS_PATH}"
    )


if __name__ == "__main__":
    main()