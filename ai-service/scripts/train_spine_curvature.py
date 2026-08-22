"""
Trains the cervical spine model as what the atlas actually is: one
curvature grade per radiograph.

The multi label recipe asks three independent yes or no questions of the
same film - has it lost its lordosis, is it sigmoid, is it kyphotic -
even though the Cervical Spine X-ray Atlas gives every image exactly one
grade, and the three answers are nested inside each other:

    lordotic   -> nothing is wrong
    straight   -> the lordosis is lost
    sigmoid    -> the lordosis is lost, in an S shape
    kyphotic   -> the lordosis is lost, and reversed

Treating them as independent costs accuracy twice. The rare kyphotic
grade gets a positive weight of 8.9 in the loss so it is not ignored,
which teaches the model to shout it; and nothing stops the model from
being sure of two grades at once. Measured on the served model, that
showed up as a kyphosis label whose alarms were wrong more often than
right.

Here the network chooses one grade out of four with a softmax, so the
grades compete for the same probability mass, and the class weights stay
between 0.7 and 2.5 instead of reaching 8.9.

The three findings the application knows are then a fixed sum of those
four probabilities:

    loss_of_lordosis  = straight + sigmoid + kyphotic
    sigmoid_curvature = sigmoid
    cervical_kyphosis = kyphotic

That sum is a Dense layer with a constant, untrainable kernel, so the
saved model still returns the same three numbers in the same order as
before and the AI service loads it without a single change.

    python scripts/train_spine_curvature.py

The grades are derived from the existing split files rather than from
the atlas sheet, so this model is measured on exactly the same test
images as the model it is meant to replace.
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
DATA_DIR = PROJECT_ROOT / "data" / "spine" / "processed" / "csxa_multilabel"

"""
The grades, in the order the softmax reports them.
"""
GRADES = ["lordotic", "straight", "sigmoid", "kyphotic"]

"""
The findings the application asks for, in the order the thresholds file
and the AI service expect them.
"""
LABELS = ["loss_of_lordosis", "sigmoid_curvature", "cervical_kyphosis"]

"""
Which grades make up each finding. This is the whole mapping, and it is
also the kernel of the layer that produces the findings.
"""
FINDING_GRADES = {
    "loss_of_lordosis": ["straight", "sigmoid", "kyphotic"],
    "sigmoid_curvature": ["sigmoid"],
    "cervical_kyphosis": ["kyphotic"],
}

IMAGE_SIZE = (224, 224)
AUTOTUNE = tf.data.AUTOTUNE

gpu_devices = tf.config.list_physical_devices("GPU")
BATCH_SIZE = 32 if gpu_devices else 16


def load_split(name: str) -> pd.DataFrame:
    """
    Reads one split and recovers the single grade behind its three
    label columns. Sigmoid1 and Sigmoid2 were already merged when the
    splits were built, which is why there are four grades and not five.
    """
    path = DATA_DIR / f"{name}.csv"

    if not path.exists():
        raise FileNotFoundError(
            f"CSV file was not found: {path}\n"
            "Run scripts/prepare_csxa_spine_data.py first."
        )

    df = pd.read_csv(path)

    grade = np.where(
        df["cervical_kyphosis"] > 0,
        GRADES.index("kyphotic"),
        np.where(
            df["sigmoid_curvature"] > 0,
            GRADES.index("sigmoid"),
            np.where(
                df["loss_of_lordosis"] > 0,
                GRADES.index("straight"),
                GRADES.index("lordotic"),
            ),
        ),
    )

    df = df.copy()
    df["grade"] = grade.astype(np.int32)
    df["image_path"] = df["image_path"].map(
        lambda value: str((PROJECT_ROOT / str(value)).resolve())
    )

    return df


def decode_and_resize(image_path, grade):
    """
    The same reading the other models were trained with, so a model
    trained here behaves the same way when the service serves it.
    """
    image = tf.io.decode_image(
        tf.io.read_file(image_path),
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
    return image, tf.one_hot(grade, len(GRADES))


def make_dataset(df: pd.DataFrame, training: bool):
    dataset = tf.data.Dataset.from_tensor_slices(
        (
            df["image_path"].astype(str).to_numpy(),
            df["grade"].to_numpy(dtype=np.int32),
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


def findings_kernel() -> np.ndarray:
    """
    The constant matrix that turns four grade probabilities into the
    three findings the application reports.
    """
    kernel = np.zeros((len(GRADES), len(LABELS)), dtype=np.float32)

    for column, label in enumerate(LABELS):
        for grade in FINDING_GRADES[label]:
            kernel[GRADES.index(grade), column] = 1.0

    return kernel


def build_model() -> tuple[tf.keras.Model, tf.keras.Model, tf.keras.Model]:
    """
    Returns the model that is trained on the grades, the model that is
    saved for the service, and the backbone whose layers are unfrozen in
    the second stage.

    Both models share every weight: the saved one only adds the fixed
    sum on top, so nothing is retrained or copied when it is written.
    """
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

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(IMAGE_SIZE[0], IMAGE_SIZE[1], 3),
        include_top=False,
        weights="imagenet",
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
    grades = tf.keras.layers.Dense(
        len(GRADES),
        activation="softmax",
        dtype="float32",
        name="curvature_grade",
    )(x)

    findings = tf.keras.layers.Dense(
        len(LABELS),
        use_bias=False,
        activation=None,
        dtype="float32",
        name="findings",
        trainable=False,
    )(grades)

    grade_model = tf.keras.Model(inputs=inputs, outputs=grades)
    service_model = tf.keras.Model(inputs=inputs, outputs=findings)

    service_model.get_layer("findings").set_weights([findings_kernel()])

    return grade_model, service_model, base_model


def tune_thresholds(
    truth: np.ndarray,
    scores: np.ndarray,
    min_precision: float | None,
) -> dict[str, float]:
    """
    The same rule the region models use: the best F1 among the cut offs
    that reach the precision floor on the validation split.
    """
    thresholds: dict[str, float] = {}

    for index, label in enumerate(LABELS):
        column = truth[:, index]
        score = scores[:, index]

        if column.sum() == 0:
            thresholds[label] = 0.5
            continue

        precision, recall, cut_offs = precision_recall_curve(column, score)
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

        best = int(np.nanargmax(candidates))
        thresholds[label] = float(min(0.95, max(0.05, float(cut_offs[best]))))

        print(
            f"{label}: threshold {thresholds[label]:.4f} "
            f"(validation precision {precision[best]:.2f}, "
            f"recall {recall[best]:.2f})"
        )

    return thresholds


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train the cervical spine model on curvature grades."
    )
    parser.add_argument("--output-name", default="spine_findings_v3")
    parser.add_argument("--stage1-epochs", type=int, default=25)
    parser.add_argument("--stage2-epochs", type=int, default=20)
    parser.add_argument("--min-precision", type=float, default=0.70)
    arguments = parser.parse_args()

    model_dir = PROJECT_ROOT / "models" / arguments.output_name
    model_dir.mkdir(parents=True, exist_ok=True)

    print("TensorFlow:", tf.__version__)
    print("GPU devices:", gpu_devices)

    train_df = load_split("train")
    val_df = load_split("val")
    test_df = load_split("test")

    print("\nGrades per split:")
    for name, split in (("train", train_df), ("val", val_df), ("test", test_df)):
        counts = split["grade"].value_counts().sort_index()
        readable = ", ".join(
            f"{GRADES[grade]} {int(count)}" for grade, count in counts.items()
        )
        print(f"  {name}: {len(split)}  ({readable})")

    train_ds = make_dataset(train_df, training=True)
    val_ds = make_dataset(val_df, training=False)
    test_ds = make_dataset(test_df, training=False)

    """
    Balanced class weights. With one grade per image these stay mild,
    which is the point of the change: no grade is shouted.
    """
    counts = train_df["grade"].value_counts().sort_index().to_numpy()
    weights = len(train_df) / (len(GRADES) * np.maximum(counts, 1))
    class_weight = {index: float(value) for index, value in enumerate(weights)}

    print("\nClass weights:")
    for index, grade in enumerate(GRADES):
        print(f"  {grade}: {class_weight[index]:.4f}")

    grade_model, service_model, base_model = build_model()

    stage1_weights = model_dir / "best_stage1.weights.h5"
    stage2_weights = model_dir / "best_finetune.weights.h5"

    def callbacks(path):
        return [
            tf.keras.callbacks.ModelCheckpoint(
                path,
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
        ]

    grade_model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="categorical_crossentropy",
        metrics=[tf.keras.metrics.AUC(name="auc", multi_label=True)],
    )

    print("\n=== Stage 1: training the head ===")
    history_stage1 = grade_model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=arguments.stage1_epochs,
        class_weight=class_weight,
        callbacks=callbacks(stage1_weights),
    )

    print("\n=== Stage 2: fine tuning the backbone ===")
    base_model.trainable = True

    for layer in base_model.layers[:-40]:
        layer.trainable = False

    grade_model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
        loss="categorical_crossentropy",
        metrics=[tf.keras.metrics.AUC(name="auc", multi_label=True)],
    )

    history_stage2 = grade_model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=arguments.stage2_epochs,
        class_weight=class_weight,
        callbacks=callbacks(stage2_weights),
    )

    """
    The findings model shares the trained weights, so it is ready the
    moment training stops. It is written first: a failure while writing
    a report must not throw away an hour of training.
    """
    final_model_path = model_dir / f"{arguments.output_name}_model.keras"
    service_model.save(final_model_path)

    print("\n=== Tuning the thresholds on the validation split ===")
    val_scores = service_model.predict(val_ds, verbose=0)
    val_truth = val_df[LABELS].to_numpy(dtype=np.float32)
    thresholds = tune_thresholds(
        val_truth,
        val_scores,
        arguments.min_precision,
    )

    print("\n=== Test results ===")
    test_scores = service_model.predict(test_ds, verbose=0)
    test_truth = test_df[LABELS].to_numpy(dtype=np.float32)

    metrics: dict[str, dict[str, float]] = {}

    for index, label in enumerate(LABELS):
        column = test_truth[:, index]
        score = test_scores[:, index]
        predicted = score >= thresholds[label]

        true_positive = int((predicted & (column > 0)).sum())
        false_positive = int((predicted & (column == 0)).sum())
        false_negative = int((~predicted & (column > 0)).sum())

        metrics[label] = {
            "threshold": round(float(thresholds[label]), 6),
            "roc_auc": round(float(roc_auc_score(column, score)), 4),
            "average_precision": round(
                float(average_precision_score(column, score)), 4
            ),
            "precision": round(
                true_positive / max(1, true_positive + false_positive), 4
            ),
            "recall": round(
                true_positive / max(1, true_positive + false_negative), 4
            ),
            "false_positive_count": false_positive,
            "test_positive_count": int(column.sum()),
        }

        print(
            f"{label:<20} auc={metrics[label]['roc_auc']} "
            f"ap={metrics[label]['average_precision']} "
            f"precision={metrics[label]['precision']} "
            f"recall={metrics[label]['recall']} "
            f"false alarms={false_positive}"
        )

    """
    The grade the network chose, which the multi label model could not
    report at all: it says how often the four grades are confused with
    each other, and confusion between them is what the findings inherit.
    """
    grade_scores = grade_model.predict(test_ds, verbose=0)
    print("\n=== Grade classification ===")
    print(
        classification_report(
            test_df["grade"].to_numpy(),
            grade_scores.argmax(axis=1),
            labels=list(range(len(GRADES))),
            target_names=GRADES,
            zero_division=0,
            digits=2,
        )
    )

    (model_dir / f"{arguments.output_name}_thresholds.json").write_text(
        json.dumps(
            {
                "labels": LABELS,
                "thresholds": {
                    label: float(thresholds[label]) for label in LABELS
                },
                "grades": GRADES,
                "thresholdRule": (
                    "Best F1 on the validation split among the cut offs "
                    f"whose precision reaches {arguments.min_precision:.2f}."
                ),
            },
            indent=2,
        )
    )

    (model_dir / "test_metrics.json").write_text(json.dumps(metrics, indent=2))

    predictions = np.stack(
        [
            (test_scores[:, index] >= thresholds[label]).astype(np.float32)
            for index, label in enumerate(LABELS)
        ],
        axis=1,
    )

    (model_dir / "test_report.txt").write_text(
        classification_report(
            test_truth,
            predictions,
            target_names=LABELS,
            zero_division=0,
            digits=2,
        )
    )

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
        )
    )

    print(f"\nModel saved to: {final_model_path}")


if __name__ == "__main__":
    main()
