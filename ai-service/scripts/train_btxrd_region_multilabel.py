"""
Trains a multi label findings model for one body region of the BTXRD
dataset, using the same recipe as the pediatric wrist model:

    MobileNetV2 backbone -> frozen head training -> fine tuning
    weighted binary cross entropy for the rare findings
    per label thresholds tuned on the validation split

    python scripts/train_btxrd_region_multilabel.py lower_limb

The result is written where the AI service looks for it, so the region
starts using AI as soon as the run finishes:

    models/<region>_findings/<region>_findings_model.keras
    models/<region>_findings/<region>_findings_thresholds.json
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    precision_recall_curve,
    roc_auc_score,
)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
tf.random.set_seed(SEED)

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATASET_PRESETS = {
    "btxrd_multilabel": [
        "bone_lesion",
        "benign_lesion",
        "malignant_lesion",
    ],
    "csxa_multilabel": [
        "loss_of_lordosis",
        "sigmoid_curvature",
        "cervical_kyphosis",
    ],
    "triage_multilabel": [
        "shoulder_abnormality",
    ],
}

LABELS: list[str] = []
IMAGE_SIZE = (224, 224)
AUTOTUNE = tf.data.AUTOTUNE

gpu_devices = tf.config.list_physical_devices("GPU")
BATCH_SIZE = 32 if gpu_devices else 16

for gpu in gpu_devices:
    try:
        tf.config.experimental.set_memory_growth(gpu, True)
    except Exception:
        pass


def load_split(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"CSV file was not found: {path}\n"
            "Run scripts/prepare_btxrd_region_data.py first."
        )

    df = pd.read_csv(path)
    missing = {"image_path", *LABELS} - set(df.columns)

    if missing:
        raise ValueError(
            f"Missing columns in {path.name}: {sorted(missing)}"
        )

    df = df.copy()
    df["image_path"] = df["image_path"].map(
        lambda value: str((PROJECT_ROOT / str(value)).resolve())
    )

    for label in LABELS:
        df[label] = (
            pd.to_numeric(df[label], errors="coerce")
            .fillna(0)
            .astype(np.float32)
            .clip(0, 1)
        )

    return df.reset_index(drop=True)


def decode_and_resize(image_path, labels):
    image_bytes = tf.io.read_file(image_path)
    image = tf.io.decode_image(
        image_bytes,
        channels=3,
        expand_animations=False,
    )
    image.set_shape([None, None, 3])
    image = tf.image.resize(
        image,
        IMAGE_SIZE,
        method="bilinear",
        antialias=True,
    )
    image = tf.cast(image, tf.float32)
    image = tf.keras.applications.mobilenet_v2.preprocess_input(image)
    return image, tf.cast(labels, tf.float32)


def make_dataset(df: pd.DataFrame, training: bool):
    dataset = tf.data.Dataset.from_tensor_slices(
        (
            df["image_path"].astype(str).to_numpy(),
            df[LABELS].to_numpy(dtype=np.float32),
        )
    )

    if training:
        dataset = dataset.shuffle(
            buffer_size=min(len(df), 10000),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    dataset = dataset.map(decode_and_resize, num_parallel_calls=AUTOTUNE)
    dataset = dataset.batch(BATCH_SIZE, drop_remainder=False)
    return dataset.prefetch(AUTOTUNE)


@tf.keras.utils.register_keras_serializable(package="RadioCare")
class WeightedBinaryCrossentropy(tf.keras.losses.Loss):
    """
    Gives the rare findings, above all the malignant ones, a larger share
    of the loss so they are not ignored by the model.
    """

    def __init__(
        self,
        positive_weights,
        name="weighted_binary_crossentropy",
        **kwargs,
    ):
        super().__init__(name=name, **kwargs)
        self.positive_weights_list = [
            float(value) for value in positive_weights
        ]
        self.positive_weights = tf.constant(
            self.positive_weights_list,
            dtype=tf.float32,
        )

    def call(self, y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.clip_by_value(
            tf.cast(y_pred, tf.float32),
            tf.keras.backend.epsilon(),
            1.0 - tf.keras.backend.epsilon(),
        )
        positive_loss = (
            -y_true * tf.math.log(y_pred) * self.positive_weights
        )
        negative_loss = -(1.0 - y_true) * tf.math.log(1.0 - y_pred)
        return tf.reduce_mean(positive_loss + negative_loss)

    def get_config(self):
        config = super().get_config()
        config.update(
            {"positive_weights": self.positive_weights_list}
        )
        return config


def build_model(positive_weights) -> tuple[tf.keras.Model, tf.keras.Model]:
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip(mode="horizontal", seed=SEED),
            tf.keras.layers.RandomRotation(
                factor=0.05,
                fill_mode="nearest",
                seed=SEED,
            ),
            tf.keras.layers.RandomZoom(
                height_factor=(-0.08, 0.08),
                width_factor=(-0.08, 0.08),
                fill_mode="nearest",
                seed=SEED,
            ),
            tf.keras.layers.RandomBrightness(
                factor=0.10,
                value_range=(-1.0, 1.0),
                seed=SEED,
            ),
        ],
        name="augmentation",
    )

    try:
        base_model = tf.keras.applications.MobileNetV2(
            input_shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
            include_top=False,
            weights="imagenet",
        )
        print("Loaded ImageNet weights.")
    except Exception as error:
        print("Could not load ImageNet weights:", error)
        base_model = tf.keras.applications.MobileNetV2(
            input_shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
            include_top=False,
            weights=None,
        )

    base_model.trainable = False

    inputs = tf.keras.Input(
        shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
        name="image",
    )
    x = augmentation(inputs)
    x = base_model(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    x = tf.keras.layers.Dense(256, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.25)(x)
    outputs = tf.keras.layers.Dense(
        len(LABELS),
        activation="sigmoid",
        dtype="float32",
        name="findings",
    )(x)

    model = tf.keras.Model(inputs=inputs, outputs=outputs)
    return model, base_model


def tune_thresholds(
    y_true: np.ndarray,
    y_score: np.ndarray,
) -> dict[str, float]:
    """
    Picks the threshold with the best F1 score per label, which suits an
    imbalanced medical dataset better than a fixed 0.5.
    """
    thresholds: dict[str, float] = {}

    for index, label in enumerate(LABELS):
        truth = y_true[:, index]
        score = y_score[:, index]

        if truth.sum() == 0:
            thresholds[label] = 0.5
            continue

        precision, recall, cut_offs = precision_recall_curve(
            truth, score
        )
        f1_scores = np.divide(
            2 * precision * recall,
            np.maximum(precision + recall, 1e-9),
        )

        best_index = int(np.nanargmax(f1_scores[:-1]))
        best_threshold = float(cut_offs[best_index])
        thresholds[label] = float(
            min(0.95, max(0.05, best_threshold))
        )

    return thresholds


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a BTXRD region model."
    )
    parser.add_argument("region")
    parser.add_argument(
        "--dataset",
        default="btxrd_multilabel",
        choices=sorted(DATASET_PRESETS),
        help="Which prepared dataset folder to train on.",
    )
    parser.add_argument(
        "--output-name",
        default=None,
        help=(
            "Folder under models/ to write to. Defaults to "
            "<region>_findings."
        ),
    )
    parser.add_argument("--stage1-epochs", type=int, default=8)
    parser.add_argument("--stage2-epochs", type=int, default=5)
    arguments = parser.parse_args()

    global LABELS
    LABELS = DATASET_PRESETS[arguments.dataset]

    region = arguments.region
    data_dir = (
        PROJECT_ROOT
        / "data"
        / region
        / "processed"
        / arguments.dataset
    )

    output_name = arguments.output_name or f"{region}_findings"
    model_dir = PROJECT_ROOT / "models" / output_name
    model_dir.mkdir(parents=True, exist_ok=True)

    final_model_path = model_dir / f"{output_name}_model.keras"
    thresholds_path = model_dir / f"{output_name}_thresholds.json"
    metrics_path = model_dir / "test_metrics.json"
    report_path = model_dir / "test_report.txt"

    print("TensorFlow:", tf.__version__)
    print("GPU devices:", gpu_devices)
    print("Batch size:", BATCH_SIZE)

    train_df = load_split(data_dir / "train.csv")
    val_df = load_split(data_dir / "val.csv")
    test_df = load_split(data_dir / "test.csv")

    print("\nSplit sizes:")
    print("Train:", len(train_df))
    print("Validation:", len(val_df))
    print("Test:", len(test_df))
    print("\nTrain label counts:")
    print(train_df[LABELS].sum().astype(int).to_string())

    train_ds = make_dataset(train_df, training=True)
    val_ds = make_dataset(val_df, training=False)
    test_ds = make_dataset(test_df, training=False)

    positive_counts = train_df[LABELS].sum(axis=0).to_numpy(
        dtype=np.float32
    )
    negative_counts = (len(train_df) - positive_counts).astype(
        np.float32
    )
    positive_weights = np.clip(
        negative_counts / np.maximum(positive_counts, 1.0),
        0.5,
        10.0,
    ).astype(np.float32)

    print("\nPositive weights:")
    for label, weight in zip(LABELS, positive_weights):
        print(f"{label}: {weight:.4f}")

    model, base_model = build_model(positive_weights)
    loss_function = WeightedBinaryCrossentropy(
        positive_weights=positive_weights
    )

    stage1_weights = model_dir / "best_stage1.weights.h5"
    stage2_weights = model_dir / "best_finetune.weights.h5"

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss=loss_function,
        metrics=[tf.keras.metrics.AUC(name="auc", multi_label=True)],
    )

    print("\n=== Stage 1: training the head ===")
    history_stage1 = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=arguments.stage1_epochs,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(
                stage1_weights,
                monitor="val_auc",
                mode="max",
                save_best_only=True,
                save_weights_only=True,
            ),
            tf.keras.callbacks.EarlyStopping(
                monitor="val_auc",
                mode="max",
                patience=3,
                restore_best_weights=True,
            ),
        ],
    )

    print("\n=== Stage 2: fine tuning the backbone ===")
    base_model.trainable = True

    for layer in base_model.layers[:-40]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
        loss=loss_function,
        metrics=[tf.keras.metrics.AUC(name="auc", multi_label=True)],
    )

    history_stage2 = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=arguments.stage2_epochs,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(
                stage2_weights,
                monitor="val_auc",
                mode="max",
                save_best_only=True,
                save_weights_only=True,
            ),
            tf.keras.callbacks.EarlyStopping(
                monitor="val_auc",
                mode="max",
                patience=3,
                restore_best_weights=True,
            ),
        ],
    )

    print("\n=== Tuning the thresholds on the validation split ===")
    val_scores = model.predict(val_ds, verbose=0)
    val_truth = val_df[LABELS].to_numpy(dtype=np.float32)
    thresholds = tune_thresholds(val_truth, val_scores)

    print("\n=== Test results ===")
    test_scores = model.predict(test_ds, verbose=0)
    test_truth = test_df[LABELS].to_numpy(dtype=np.float32)

    metrics: dict[str, dict[str, float]] = {}
    predictions = np.zeros_like(test_scores)

    for index, label in enumerate(LABELS):
        threshold = thresholds[label]
        predictions[:, index] = (
            test_scores[:, index] >= threshold
        ).astype(np.float32)

        truth = test_truth[:, index]
        score = test_scores[:, index]

        metrics[label] = {
            "threshold": round(float(threshold), 6),
            "roc_auc": (
                round(float(roc_auc_score(truth, score)), 4)
                if truth.sum() > 0
                else None
            ),
            "average_precision": (
                round(float(average_precision_score(truth, score)), 4)
                if truth.sum() > 0
                else None
            ),
            "test_positive_count": int(truth.sum()),
        }

        print(
            f"{label:18s} auc={metrics[label]['roc_auc']} "
            f"ap={metrics[label]['average_precision']} "
            f"threshold={threshold:.4f} "
            f"positives={int(truth.sum())}"
        )

    report = classification_report(
        test_truth,
        predictions,
        target_names=LABELS,
        zero_division=0,
    )
    print("\n" + report)

    model.save(final_model_path)

    thresholds_path.write_text(
        json.dumps(
            {"labels": LABELS, "thresholds": thresholds},
            indent=2,
        ),
        encoding="utf-8",
    )

    metrics_path.write_text(
        json.dumps(metrics, indent=2),
        encoding="utf-8",
    )

    report_path.write_text(report, encoding="utf-8")

    (model_dir / "training_history.json").write_text(
        json.dumps(
            {
                "stage1": {
                    key: [float(value) for value in values]
                    for key, values in history_stage1.history.items()
                },
                "stage2": {
                    key: [float(value) for value in values]
                    for key, values in history_stage2.history.items()
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nModel saved to: {final_model_path}")
    print(f"Thresholds saved to: {thresholds_path}")


if __name__ == "__main__":
    main()
