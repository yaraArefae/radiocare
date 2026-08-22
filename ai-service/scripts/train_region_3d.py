"""
Trains a volumetric (3D) findings model for one body region.

The 2D models in this project all start from a MobileNetV2 that was
trained on ImageNet, because a million photographs teach edges and
textures that transfer to an X ray film. No such pretrained backbone
exists for volumes, so this model is built and trained from scratch:
a small Conv3D stack, deliberately small, because the public volumetric
sets hold about fifteen hundred cases where the X ray sets hold tens of
thousands, and a large network on that little data only memorises it.

Everything around the network is the recipe the region models already
use, so the two kinds of model stay comparable and interchangeable:

    weighted binary cross entropy for the rare findings
    per label thresholds tuned on the validation split
    the same metrics, report and files on disk

    python scripts/prepare_3d_data.py chest --dataset nodule3d
    python scripts/train_region_3d.py chest --dataset nodule3d

The result is written where the AI service looks for it:

    models/<name>/<name>_model.keras
    models/<name>/<name>_thresholds.json
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

LABELS: list[str] = []
VOLUME_SHAPE: tuple[int, int, int] = (28, 28, 28)
AUTOTUNE = tf.data.AUTOTUNE

gpu_devices = tf.config.list_physical_devices("GPU")

"""
A volume of 64 cubed is roughly a hundred times the numbers of a 28
cubed one, so the batch has to shrink with the machine or a laptop runs
out of memory in the first epoch.
"""
BATCH_SIZE = 16 if gpu_devices else 8

for gpu in gpu_devices:
    try:
        tf.config.experimental.set_memory_growth(gpu, True)
    except Exception:
        pass


def load_descriptor(data_dir: Path) -> dict:
    descriptor_path = data_dir / "dataset.json"

    if not descriptor_path.exists():
        raise FileNotFoundError(
            f"Dataset description was not found: {descriptor_path}\n"
            "Run scripts/prepare_3d_data.py first."
        )

    return json.loads(descriptor_path.read_text(encoding="utf-8"))


def load_split(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"CSV file was not found: {path}\n"
            "Run scripts/prepare_3d_data.py first."
        )

    frame = pd.read_csv(path)
    missing = {"volume_path", *LABELS} - set(frame.columns)

    if missing:
        raise ValueError(f"Missing columns in {path.name}: {sorted(missing)}")

    frame = frame.copy()
    frame["volume_path"] = frame["volume_path"].map(
        lambda value: str((PROJECT_ROOT / str(value)).resolve())
    )

    for label in LABELS:
        frame[label] = (
            pd.to_numeric(frame[label], errors="coerce")
            .fillna(0)
            .astype(np.float32)
            .clip(0, 1)
        )

    return frame.reset_index(drop=True)


def read_volume(path: bytes) -> np.ndarray:
    """
    Reads one prepared volume from disk. The files hold whole volumes
    rather than slices, so a case is never split across two reads and
    the model always sees the stack the way it was prepared.
    """
    volume = np.load(path.decode("utf-8"))
    return volume.astype(np.float32)


def augment_volume(volume: np.ndarray) -> np.ndarray:
    """
    Mirrors the volume and turns it a little.

    A finding does not change when the patient is scanned a few degrees
    off, so these turns are free extra cases. The rotation stays inside
    a few degrees and only around the head to foot axis: rolling a chest
    CT onto its side would produce an anatomy that never reaches a
    radiologist, and the model would spend its capacity on it.
    """
    from scipy import ndimage

    if random.random() < 0.5:
        volume = volume[:, ::-1, :]

    if random.random() < 0.5:
        volume = volume[:, :, ::-1]

    if random.random() < 0.5:
        angle = random.uniform(-8.0, 8.0)
        volume = ndimage.rotate(
            volume,
            angle,
            axes=(1, 2),
            reshape=False,
            order=1,
            mode="nearest",
        )

    if random.random() < 0.5:
        volume = volume * random.uniform(0.90, 1.10)

    return np.ascontiguousarray(
        np.clip(volume, 0.0, 255.0),
        dtype=np.float32,
    )


def make_dataset(frame: pd.DataFrame, training: bool, augment: bool):
    paths = frame["volume_path"].astype(str).to_numpy()
    targets = frame[LABELS].to_numpy(dtype=np.float32)

    dataset = tf.data.Dataset.from_tensor_slices((paths, targets))

    if training:
        dataset = dataset.shuffle(
            buffer_size=min(len(frame), 4096),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    def load(path, labels):
        volume = tf.numpy_function(read_volume, [path], tf.float32)

        if training and augment:
            volume = tf.numpy_function(augment_volume, [volume], tf.float32)

        volume.set_shape(VOLUME_SHAPE)
        volume = tf.expand_dims(volume, axis=-1)
        return volume, tf.cast(labels, tf.float32)

    dataset = dataset.map(load, num_parallel_calls=AUTOTUNE)
    dataset = dataset.batch(BATCH_SIZE, drop_remainder=False)
    return dataset.prefetch(AUTOTUNE)


@tf.keras.utils.register_keras_serializable(package="RadioCare3D")
class WeightedBinaryCrossentropy3D(tf.keras.losses.Loss):
    """
    Gives the rare findings a larger share of the loss so they are not
    ignored by the model, the same way the 2D findings models do it.
    """

    def __init__(
        self,
        positive_weights,
        name="weighted_binary_crossentropy_3d",
        **kwargs,
    ):
        super().__init__(name=name, **kwargs)
        self.positive_weights_list = [float(value) for value in positive_weights]
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
        positive_loss = -y_true * tf.math.log(y_pred) * self.positive_weights
        negative_loss = -(1.0 - y_true) * tf.math.log(1.0 - y_pred)
        return tf.reduce_mean(positive_loss + negative_loss)

    def get_config(self):
        config = super().get_config()
        config.update({"positive_weights": self.positive_weights_list})
        return config


def build_model(width: int) -> tf.keras.Model:
    """
    A Conv3D stack whose depth follows the size of the volume.

    Each block halves every side, so a 28 cubed volume takes three
    blocks before there is nothing left to halve, while a 64 cubed one
    takes four and learns a level of detail the small volume never had.
    Fixing the depth instead would either waste the large volumes or
    pool the small ones down to a single number.
    """
    inputs = tf.keras.Input(shape=(*VOLUME_SHAPE, 1), name="volume")

    """
    The prepared volumes are stored as bytes, and the scaling lives in
    the model rather than in the pipeline, so the service feeds it the
    same numbers this script trained on without repeating the recipe.
    """
    x = tf.keras.layers.Rescaling(1.0 / 255.0)(inputs)

    filters = [32, 64, 128, 256]
    current = width

    for count in filters:
        x = tf.keras.layers.Conv3D(
            count,
            kernel_size=3,
            padding="same",
            activation="relu",
        )(x)
        x = tf.keras.layers.BatchNormalization()(x)

        if current // 2 < 3:
            break

        x = tf.keras.layers.MaxPool3D(pool_size=2)(x)
        current = current // 2

    x = tf.keras.layers.GlobalAveragePooling3D()(x)
    x = tf.keras.layers.Dropout(0.40)(x)
    x = tf.keras.layers.Dense(256, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.30)(x)
    outputs = tf.keras.layers.Dense(
        len(LABELS),
        activation="sigmoid",
        dtype="float32",
        name="findings",
    )(x)

    return tf.keras.Model(inputs=inputs, outputs=outputs)


def tune_thresholds(
    y_true: np.ndarray,
    y_score: np.ndarray,
    min_precision: float | None = None,
) -> dict[str, float]:
    """
    Picks the threshold with the best F1 score per label, which suits an
    imbalanced medical dataset better than a fixed 0.5. When a minimum
    precision is asked for, only the cut points that reach it on the
    validation split are considered, so a finding cannot ship with an
    operating point where most of its alarms are false.
    """
    thresholds: dict[str, float] = {}

    for index, label in enumerate(LABELS):
        truth = y_true[:, index]
        score = y_score[:, index]

        if truth.sum() == 0:
            thresholds[label] = 0.5
            continue

        precision, recall, cut_offs = precision_recall_curve(truth, score)
        f1_scores = np.divide(
            2 * precision * recall,
            np.maximum(precision + recall, 1e-9),
        )

        candidates = f1_scores[:-1]

        if min_precision is not None:
            reachable = precision[:-1] >= min_precision

            if reachable.any():
                candidates = np.where(reachable, candidates, np.nan)
            else:
                print(
                    f"{label}: no cut off reaches precision "
                    f"{min_precision:.2f}, keeping the best F1 point."
                )

        best_index = int(np.nanargmax(candidates))
        best_threshold = float(cut_offs[best_index])
        thresholds[label] = float(min(0.95, max(0.05, best_threshold)))

        print(
            f"{label}: threshold {thresholds[label]:.4f} "
            f"(validation precision {precision[best_index]:.2f}, "
            f"recall {recall[best_index]:.2f})"
        )

    return thresholds


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a volumetric model for one body region."
    )
    parser.add_argument("region")
    parser.add_argument(
        "--dataset",
        default="nodule3d",
        help="Prepared dataset folder under data/<region>/processed/.",
    )
    parser.add_argument(
        "--output-name",
        default=None,
        help=(
            "Folder under models/ to write to. Defaults to "
            "<region>_3d_<dataset>."
        ),
    )
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Carry on from best.weights.h5 when one is already there.",
    )
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument(
        "--no-augment",
        action="store_true",
        help="Turn off the mirroring and the small rotations.",
    )
    parser.add_argument(
        "--min-precision",
        type=float,
        default=None,
        help=(
            "Lowest precision a threshold may have on the validation "
            "split. Without it the best F1 point is taken."
        ),
    )
    arguments = parser.parse_args()

    data_dir = (
        PROJECT_ROOT
        / "data"
        / arguments.region
        / "processed"
        / arguments.dataset
    )

    descriptor = load_descriptor(data_dir)

    global LABELS, VOLUME_SHAPE
    LABELS = [str(label) for label in descriptor["labels"]]
    VOLUME_SHAPE = tuple(int(value) for value in descriptor["volume_shape"])

    output_name = (
        arguments.output_name
        or f"{arguments.region}_3d_{arguments.dataset}"
    )
    model_dir = PROJECT_ROOT / "models" / output_name
    model_dir.mkdir(parents=True, exist_ok=True)

    final_model_path = model_dir / f"{output_name}_model.keras"
    thresholds_path = model_dir / f"{output_name}_thresholds.json"
    metrics_path = model_dir / "test_metrics.json"
    report_path = model_dir / "test_report.txt"

    print("TensorFlow:", tf.__version__)
    print("GPU devices:", gpu_devices)
    print("Batch size:", BATCH_SIZE)
    print("Volume shape:", VOLUME_SHAPE)
    print("Labels:", ", ".join(LABELS))

    train_df = load_split(data_dir / "train.csv")
    val_df = load_split(data_dir / "val.csv")
    test_df = load_split(data_dir / "test.csv")

    print("\nSplit sizes:")
    print("Train:", len(train_df))
    print("Validation:", len(val_df))
    print("Test:", len(test_df))
    print("\nTrain label counts:")
    print(train_df[LABELS].sum().astype(int).to_string())

    augment = not arguments.no_augment
    train_ds = make_dataset(train_df, training=True, augment=augment)
    val_ds = make_dataset(val_df, training=False, augment=False)
    test_ds = make_dataset(test_df, training=False, augment=False)

    positive_counts = train_df[LABELS].sum(axis=0).to_numpy(dtype=np.float32)
    negative_counts = (len(train_df) - positive_counts).astype(np.float32)
    positive_weights = np.clip(
        negative_counts / np.maximum(positive_counts, 1.0),
        0.5,
        10.0,
    ).astype(np.float32)

    print("\nPositive weights:")
    for label, weight in zip(LABELS, positive_weights):
        print(f"{label}: {weight:.4f}")

    model = build_model(width=min(VOLUME_SHAPE))
    model.summary()

    loss_function = WeightedBinaryCrossentropy3D(
        positive_weights=positive_weights
    )
    best_weights = model_dir / "best.weights.h5"

    """
    Picks up a run that was cut off.

    A checkpoint is written every time the validation AUC improves, so a
    training killed halfway leaves the best weights it had reached. The
    optimizer state is not in that file and is lost, which costs a few
    epochs of momentum -- far less than the hours that starting from
    random weights would cost.
    """
    if arguments.resume and best_weights.exists():
        model.load_weights(best_weights)
        print("")
        print(f"Resumed from {best_weights}")

    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=arguments.learning_rate
        ),
        loss=loss_function,
        metrics=[tf.keras.metrics.AUC(name="auc", multi_label=True)],
    )

    print("\n=== Training ===")
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=arguments.epochs,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(
                best_weights,
                monitor="val_auc",
                mode="max",
                save_best_only=True,
                save_weights_only=True,
            ),
            tf.keras.callbacks.EarlyStopping(
                monitor="val_auc",
                mode="max",
                patience=arguments.patience,
                restore_best_weights=True,
            ),
            tf.keras.callbacks.ReduceLROnPlateau(
                monitor="val_auc",
                mode="max",
                factor=0.5,
                patience=max(2, arguments.patience // 3),
                min_lr=1e-6,
            ),
        ],
    )

    print("\n=== Tuning the thresholds on the validation split ===")
    val_scores = model.predict(val_ds, verbose=0)
    val_truth = val_df[LABELS].to_numpy(dtype=np.float32)
    thresholds = tune_thresholds(
        val_truth,
        val_scores,
        min_precision=arguments.min_precision,
    )

    print("\n=== Test results ===")
    test_scores = model.predict(test_ds, verbose=0)
    test_truth = test_df[LABELS].to_numpy(dtype=np.float32)

    metrics: dict[str, dict] = {}
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
                if 0 < truth.sum() < len(truth)
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
            f"{label:26s} auc={metrics[label]['roc_auc']} "
            f"ap={metrics[label]['average_precision']} "
            f"threshold={threshold:.4f} "
            f"positives={int(truth.sum())}"
        )

    """
    The trained model is written before anything else. A failure while
    formatting a report must never throw away a run that took an hour.
    """
    model.save(final_model_path)

    if len(LABELS) == 1:
        report = classification_report(
            test_truth[:, 0],
            predictions[:, 0],
            labels=[0, 1],
            target_names=[f"no {LABELS[0]}", LABELS[0]],
            zero_division=0,
        )
    else:
        report = classification_report(
            test_truth,
            predictions,
            target_names=LABELS,
            zero_division=0,
        )

    print("\n" + report)

    """
    The Hounsfield window the training volumes were clipped to travels
    with the model.

    A model trained on a bone window and then served a lung window sees
    numbers it has never met and answers confidently about nothing. The
    service reads the window from here rather than from its own table,
    so the two cannot drift apart.
    """
    metadata = {
        "labels": LABELS,
        "thresholds": thresholds,
        "inputKind": "volume",
        "volumeShape": list(VOLUME_SHAPE),
        "valueRange": [0, 255],
        "dataset": descriptor.get("source", arguments.dataset),
    }

    recorded_window = descriptor.get("hu_window")

    if isinstance(recorded_window, list) and len(recorded_window) == 2:
        metadata["huWindow"] = [float(value) for value in recorded_window]

    thresholds_path.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    report_path.write_text(report, encoding="utf-8")

    (model_dir / "training_history.json").write_text(
        json.dumps(
            {
                key: [float(value) for value in values]
                for key, values in history.history.items()
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nModel saved to: {final_model_path}")
    print(f"Thresholds saved to: {thresholds_path}")


if __name__ == "__main__":
    main()
