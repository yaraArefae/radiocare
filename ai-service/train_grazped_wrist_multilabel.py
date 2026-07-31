from __future__ import annotations

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

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data" / "wrist" / "processed" / "grazped_multilabel"
TRAIN_CSV = DATA_DIR / "train.csv"
VAL_CSV = DATA_DIR / "val.csv"
TEST_CSV = DATA_DIR / "test.csv"

MODEL_DIR = PROJECT_ROOT / "models" / "wrist_pediatric_findings"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

STAGE1_WEIGHTS = MODEL_DIR / "best_stage1.weights.h5"
STAGE2_WEIGHTS = MODEL_DIR / "best_finetune.weights.h5"
FINAL_MODEL_PATH = MODEL_DIR / "wrist_pediatric_findings_model.keras"
THRESHOLDS_PATH = MODEL_DIR / "wrist_pediatric_findings_thresholds.json"
REPORT_PATH = MODEL_DIR / "test_report.txt"
METRICS_PATH = MODEL_DIR / "test_metrics.json"
HISTORY_PATH = MODEL_DIR / "training_history.json"

LABELS = ["fracture_visible", "osteopenia", "metal", "cast"]
IMAGE_SIZE = (224, 224)
AUTOTUNE = tf.data.AUTOTUNE

gpu_devices = tf.config.list_physical_devices("GPU")
BATCH_SIZE = 32 if gpu_devices else 16
STAGE1_EPOCHS = 8
STAGE2_EPOCHS = 5

for gpu in gpu_devices:
    try:
        tf.config.experimental.set_memory_growth(gpu, True)
    except Exception:
        pass

if gpu_devices:
    try:
        tf.keras.mixed_precision.set_global_policy("mixed_float16")
    except Exception:
        pass

print("TensorFlow:", tf.__version__)
print("GPU devices:", gpu_devices)
print("Batch size:", BATCH_SIZE)


def load_split(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"CSV file was not found: {path}")

    df = pd.read_csv(path)
    required = {"image_path", *LABELS}
    missing = required - set(df.columns)

    if missing:
        raise ValueError(f"Missing columns in {path.name}: {sorted(missing)}")

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

    missing_files = [
        image_path
        for image_path in df["image_path"]
        if not Path(image_path).exists()
    ]

    if missing_files:
        raise FileNotFoundError(
            "Some images listed in the CSV do not exist. "
            f"First missing image: {missing_files[0]}"
        )

    return df.reset_index(drop=True)


train_df = load_split(TRAIN_CSV)
val_df = load_split(VAL_CSV)
test_df = load_split(TEST_CSV)

print("\nSplit sizes:")
print("Train:", len(train_df))
print("Validation:", len(val_df))
print("Test:", len(test_df))

print("\nTrain label counts:")
print(train_df[LABELS].sum().astype(int).to_string())


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
    labels = tf.cast(labels, tf.float32)
    return image, labels


def make_dataset(df: pd.DataFrame, training: bool):
    image_paths = df["image_path"].astype(str).to_numpy()
    labels = df[LABELS].to_numpy(dtype=np.float32)

    dataset = tf.data.Dataset.from_tensor_slices((image_paths, labels))

    if training:
        dataset = dataset.shuffle(
            buffer_size=min(len(df), 10000),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    dataset = dataset.map(
        decode_and_resize,
        num_parallel_calls=AUTOTUNE,
    )
    dataset = dataset.batch(BATCH_SIZE, drop_remainder=False)
    dataset = dataset.prefetch(AUTOTUNE)
    return dataset


train_ds = make_dataset(train_df, training=True)
val_ds = make_dataset(val_df, training=False)
test_ds = make_dataset(test_df, training=False)

positive_counts = train_df[LABELS].sum(axis=0).to_numpy(dtype=np.float32)
negative_counts = (len(train_df) - positive_counts).astype(np.float32)
positive_weights = negative_counts / np.maximum(positive_counts, 1.0)
positive_weights = np.clip(positive_weights, 0.5, 10.0).astype(np.float32)

print("\nPositive weights:")
for label, weight in zip(LABELS, positive_weights):
    print(f"{label}: {weight:.4f}")


@tf.keras.utils.register_keras_serializable(package="RadioCare")
class WeightedBinaryCrossentropy(tf.keras.losses.Loss):
    def __init__(self, positive_weights, name="weighted_binary_crossentropy", **kwargs):
        super().__init__(name=name, **kwargs)
        self.positive_weights_list = [float(value) for value in positive_weights]
        self.positive_weights = tf.constant(
            self.positive_weights_list,
            dtype=tf.float32,
        )

    def call(self, y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.cast(y_pred, tf.float32)
        y_pred = tf.clip_by_value(
            y_pred,
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


loss_function = WeightedBinaryCrossentropy(positive_weights=positive_weights)

augmentation = tf.keras.Sequential(
    [
        tf.keras.layers.RandomFlip(mode="horizontal", seed=SEED),
        tf.keras.layers.RandomRotation(
            factor=0.03,
            fill_mode="nearest",
            seed=SEED,
        ),
        tf.keras.layers.RandomZoom(
            height_factor=(-0.05, 0.05),
            width_factor=(-0.05, 0.05),
            fill_mode="nearest",
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
    print("\nLoaded ImageNet weights.")
except Exception as error:
    print("\nCould not load ImageNet weights; using random initialization.")
    print("Weights error:", error)
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

model = tf.keras.Model(
    inputs=inputs,
    outputs=outputs,
    name="wrist_pediatric_findings",
)


def compile_model(learning_rate: float):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=learning_rate),
        loss=loss_function,
        metrics=[
            tf.keras.metrics.BinaryAccuracy(
                name="binary_accuracy",
                threshold=0.5,
            ),
            tf.keras.metrics.AUC(
                name="roc_auc",
                multi_label=True,
                num_labels=len(LABELS),
                curve="ROC",
            ),
            tf.keras.metrics.AUC(
                name="pr_auc",
                multi_label=True,
                num_labels=len(LABELS),
                curve="PR",
            ),
        ],
    )


compile_model(learning_rate=1e-3)
model.summary()


def make_callbacks(weights_path: Path):
    return [
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(weights_path),
            monitor="val_loss",
            mode="min",
            save_best_only=True,
            save_weights_only=True,
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
            factor=0.3,
            patience=2,
            min_lr=1e-7,
            verbose=1,
        ),
        tf.keras.callbacks.TerminateOnNaN(),
    ]


print("\nStarting stage 1...")
history_stage1 = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=STAGE1_EPOCHS,
    callbacks=make_callbacks(STAGE1_WEIGHTS),
)
model.load_weights(STAGE1_WEIGHTS)

print("\nStarting fine-tuning...")
base_model.trainable = True

for layer in base_model.layers[:-35]:
    layer.trainable = False

for layer in base_model.layers[-35:]:
    if isinstance(layer, tf.keras.layers.BatchNormalization):
        layer.trainable = False

compile_model(learning_rate=1e-5)

history_stage2 = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=STAGE2_EPOCHS,
    callbacks=make_callbacks(STAGE2_WEIGHTS),
)
model.load_weights(STAGE2_WEIGHTS)

model.save(FINAL_MODEL_PATH, include_optimizer=False)

print("\nSaved final model:")
print(FINAL_MODEL_PATH)

val_probabilities = model.predict(val_ds, verbose=1)
val_true = val_df[LABELS].to_numpy(dtype=np.int32)
thresholds = {}

for index, label in enumerate(LABELS):
    precision, recall, values = precision_recall_curve(
        val_true[:, index],
        val_probabilities[:, index],
    )

    if len(values) == 0:
        best_threshold = 0.5
    else:
        f1_scores = (
            2.0
            * precision[:-1]
            * recall[:-1]
            / np.maximum(precision[:-1] + recall[:-1], 1e-8)
        )
        best_index = int(np.nanargmax(f1_scores))
        best_threshold = float(values[best_index])

    best_threshold = float(np.clip(best_threshold, 0.05, 0.95))
    thresholds[label] = round(best_threshold, 6)

THRESHOLDS_PATH.write_text(
    json.dumps(
        {
            "labels": LABELS,
            "thresholds": thresholds,
            "no_supported_finding_rule": (
                "All supported finding probabilities are below "
                "their individual thresholds."
            ),
        },
        indent=2,
    ),
    encoding="utf-8",
)

print("\nSelected thresholds:")
print(json.dumps(thresholds, indent=2))

test_probabilities = model.predict(test_ds, verbose=1)
test_true = test_df[LABELS].to_numpy(dtype=np.int32)
threshold_array = np.asarray(
    [thresholds[label] for label in LABELS],
    dtype=np.float32,
)
test_predicted = (test_probabilities >= threshold_array).astype(np.int32)

report_lines = []
metrics_output = {}

for index, label in enumerate(LABELS):
    report = classification_report(
        test_true[:, index],
        test_predicted[:, index],
        target_names=[
            f"NO_{label.upper()}",
            label.upper(),
        ],
        digits=4,
        zero_division=0,
    )

    try:
        roc_auc = float(
            roc_auc_score(
                test_true[:, index],
                test_probabilities[:, index],
            )
        )
    except ValueError:
        roc_auc = None

    try:
        average_precision = float(
            average_precision_score(
                test_true[:, index],
                test_probabilities[:, index],
            )
        )
    except ValueError:
        average_precision = None

    metrics_output[label] = {
        "threshold": thresholds[label],
        "roc_auc": roc_auc,
        "average_precision": average_precision,
        "test_positive_count": int(test_true[:, index].sum()),
    }

    report_lines.extend(
        [
            "=" * 70,
            label.upper(),
            "=" * 70,
            report,
            f"ROC AUC: {roc_auc}",
            f"Average precision: {average_precision}",
            "",
        ]
    )

REPORT_PATH.write_text("\n".join(report_lines), encoding="utf-8")
METRICS_PATH.write_text(
    json.dumps(metrics_output, indent=2),
    encoding="utf-8",
)

history_output = {
    "stage1": {
        key: [float(value) for value in values]
        for key, values in history_stage1.history.items()
    },
    "stage2": {
        key: [float(value) for value in values]
        for key, values in history_stage2.history.items()
    },
}

HISTORY_PATH.write_text(
    json.dumps(history_output, indent=2),
    encoding="utf-8",
)

print("\nTest report:")
print(REPORT_PATH.read_text(encoding="utf-8"))

print("\nGenerated files:")
for path in [
    FINAL_MODEL_PATH,
    THRESHOLDS_PATH,
    REPORT_PATH,
    METRICS_PATH,
    HISTORY_PATH,
]:
    print(path)