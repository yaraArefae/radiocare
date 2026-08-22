"""
Trains the shoulder triage model: is this shoulder X-ray normal or not.

The model in service is unusable. Measured on its own test set it calls
every single image normal:

    normal read correctly    100%   (0 wrong out of 615)
    abnormal read correctly    0%   (147 missed out of 147)
    ROC AUC                 0.5577  (0.5 is a coin toss)

Its 80.7% accuracy is an illusion: 80% of that test set is normal, so a
model that answers "normal" every time scores 80.7% while finding
nothing. In a triage screen that is the worst possible failure, because
the case it is meant to raise is the one it never raises.

The set leans the same way, 2870 normal against 681 abnormal in
training, which is what taught it that answering "normal" always is a
winning strategy. This run counters that with class weights, fine tunes
the top of the backbone, and chooses the cut point on the validation set
by balancing the two recalls rather than by accuracy.

Both classes come from the same source, and no image from another
dataset is mixed in. An earlier chest experiment added images of one
class from a second dataset and the model learned to tell the datasets
apart instead of the pathology.

Run:

    python scripts/train_shoulder_triage_v3.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    roc_auc_score,
)

AI_SERVICE_DIR = Path(__file__).resolve().parent.parent

"""
Which prepared set to learn from. Both classes are drawn from CheXpert, so the only thing separating them
is what is in the chest. Mixing sources let an earlier model separate the
classes by reading the source instead of the pathology.
"""
DATA_DIR = AI_SERVICE_DIR / "data" / "shoulder" / "processed"
TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"
TEST_DIR = DATA_DIR / "test"

OUTPUT_DIR = AI_SERVICE_DIR / "models" / "shoulder_triage_v4"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
RANDOM_SEED = 42

"""
NORMAL is 0 and ABNORMAL is 1, so a higher score always means "more
likely to need a doctor". The folder order below fixes that mapping;
letting Keras sort the folder names would put ABNORMAL first and quietly
invert every score.
"""
CLASS_NAMES = ["NORMAL", "ABNORMAL"]


def build_dataset(directory: Path, shuffle: bool) -> tf.data.Dataset:
    return tf.keras.utils.image_dataset_from_directory(
        directory,
        labels="inferred",
        label_mode="binary",
        class_names=CLASS_NAMES,
        image_size=IMAGE_SIZE,
        batch_size=BATCH_SIZE,
        shuffle=shuffle,
        seed=RANDOM_SEED,
    )


def prepare(dataset: tf.data.Dataset, augment: bool) -> tf.data.Dataset:
    """
    Scales the pixels the way MobileNetV2 expects, and varies the
    training images slightly so the model does not memorise them.
    """
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.05),
            tf.keras.layers.RandomZoom(0.10),
            tf.keras.layers.RandomContrast(0.10),
        ]
    )

    def scale(images, labels):
        """EfficientNet rescales inside itself, so nothing is done here."""
        return images, labels

    if augment:
        dataset = dataset.map(
            lambda images, labels: (augmentation(images, training=True), labels),
            num_parallel_calls=tf.data.AUTOTUNE,
        )

    return dataset.map(scale, num_parallel_calls=tf.data.AUTOTUNE).prefetch(
        tf.data.AUTOTUNE
    )


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    """
    EfficientNetB0 rather than MobileNetV2.

    MobileNetV2 reached 0.765 on this set and the threshold curve shows
    what that ceiling costs: reading 96% of normal shoulders correctly
    would mean missing 114 fractures out of 145. A model that separates
    the two classes better is the only way to raise one number without
    ruining the other.

    EfficientNetB0 carries its own rescaling, so images reach it as raw
    0 to 255 values.
    """
    backbone = tf.keras.applications.EfficientNetB0(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )

    backbone.trainable = False

    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
    features = backbone(inputs, training=False)
    pooled = tf.keras.layers.GlobalAveragePooling2D()(features)
    dropped = tf.keras.layers.Dropout(0.3)(pooled)
    hidden = tf.keras.layers.Dense(128, activation="relu")(dropped)
    hidden = tf.keras.layers.Dropout(0.3)(hidden)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(hidden)

    return tf.keras.Model(inputs, outputs), backbone


def class_weights(train_dataset_dir: Path) -> dict[int, float]:
    """
    Counters the imbalance in the folders. Without this the model can
    reach a good looking accuracy by calling almost everything abnormal.
    """
    counts = []

    for name in CLASS_NAMES:
        folder = train_dataset_dir / name
        counts.append(sum(1 for path in folder.rglob("*") if path.is_file()))

    total = sum(counts)

    weights = {
        index: total / (len(CLASS_NAMES) * max(count, 1))
        for index, count in enumerate(counts)
    }

    print(f"  train images: {dict(zip(CLASS_NAMES, counts))}")
    print(f"  class weights: {weights}")

    return weights


def collect_scores(model: tf.keras.Model, dataset: tf.data.Dataset):
    scores = model.predict(dataset, verbose=0).reshape(-1)

    truth = np.concatenate([labels.numpy().reshape(-1) for _, labels in dataset])

    return truth, scores


def choose_threshold(truth: np.ndarray, scores: np.ndarray) -> float:
    """
    Picks the cut point on the validation set.

    The score used is the mean of the two recalls. Plain accuracy would
    be maximised by leaning towards abnormal, since abnormal images
    outnumber normal ones; balancing the two recalls asks the model to be
    right about normal chests as often as it is about abnormal ones,
    which is what the triage screen needs.
    """
    best_threshold = 0.5
    best_score = -1.0

    for cut in np.arange(0.05, 0.96, 0.01):
        predicted = (scores >= cut).astype(int)

        normal_recall = float(
            np.mean(predicted[truth == 0] == 0) if np.any(truth == 0) else 0.0
        )
        abnormal_recall = float(
            np.mean(predicted[truth == 1] == 1) if np.any(truth == 1) else 0.0
        )

        balanced = (normal_recall + abnormal_recall) / 2

        if balanced > best_score:
            best_score = balanced
            best_threshold = float(cut)

    return round(best_threshold, 3)


def report(truth: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    predicted = (scores >= threshold).astype(int)

    matrix = confusion_matrix(truth, predicted, labels=[0, 1])

    text = classification_report(
        truth,
        predicted,
        labels=[0, 1],
        target_names=CLASS_NAMES,
        digits=4,
        zero_division=0,
    )

    print(text)
    print(f"  confusion matrix (rows: true, columns: predicted)\n{matrix}")

    return {
        "threshold": threshold,
        "accuracy": float(accuracy_score(truth, predicted)),
        "rocAuc": float(roc_auc_score(truth, scores)),
        "normalRecall": float(np.mean(predicted[truth == 0] == 0)),
        "abnormalRecall": float(np.mean(predicted[truth == 1] == 1)),
        "confusionMatrix": matrix.tolist(),
        "report": text,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--fine-tune-epochs", type=int, default=5)
    parser.add_argument("--unfreeze", type=int, default=60)
    arguments = parser.parse_args()

    tf.keras.utils.set_random_seed(RANDOM_SEED)

    for folder in (TRAIN_DIR, VAL_DIR, TEST_DIR):
        if not folder.exists():
            raise SystemExit(f"Missing folder: {folder}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    raw_train = build_dataset(TRAIN_DIR, shuffle=True)
    raw_val = build_dataset(VAL_DIR, shuffle=False)
    raw_test = build_dataset(TEST_DIR, shuffle=False)

    train_dataset = prepare(raw_train, augment=True)
    val_dataset = prepare(raw_val, augment=False)
    test_dataset = prepare(raw_test, augment=False)

    model, backbone = build_model()

    weights = class_weights(TRAIN_DIR)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    stop_early = tf.keras.callbacks.EarlyStopping(
        monitor="val_auc",
        mode="max",
        patience=3,
        restore_best_weights=True,
    )

    print("\n=== Stage 1: the classification head ===")
    model.fit(
        train_dataset,
        validation_data=val_dataset,
        epochs=arguments.epochs,
        class_weight=weights,
        callbacks=[stop_early],
        verbose=2,
    )

    print("\n=== Stage 2: fine tuning the top of the backbone ===")
    backbone.trainable = True

    for layer in backbone.layers[: -arguments.unfreeze]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    model.fit(
        train_dataset,
        validation_data=val_dataset,
        epochs=arguments.fine_tune_epochs,
        class_weight=weights,
        callbacks=[stop_early],
        verbose=2,
    )

    """
    The model is saved before anything is measured. An earlier run in
    this project computed its metrics first and crashed on the report,
    losing a finished model, so the order here is deliberate.
    """
    model_path = OUTPUT_DIR / "shoulder_triage_v4_model.keras"
    model.save(model_path)
    print(f"\nSaved model: {model_path}")

    print("\n=== Choosing the cut point on the validation set ===")
    val_truth, val_scores = collect_scores(model, val_dataset)
    threshold = choose_threshold(val_truth, val_scores)
    print(f"  threshold: {threshold}")

    print("\n=== Test set at the chosen threshold ===")
    test_truth, test_scores = collect_scores(model, test_dataset)
    tuned = report(test_truth, test_scores, threshold)

    print("\n=== Test set at a fixed 0.5, for comparison ===")
    baseline = report(test_truth, test_scores, 0.5)

    (OUTPUT_DIR / "shoulder_triage_v4_thresholds.json").write_text(
        json.dumps(
            {
                "threshold": threshold,
                "positiveClass": "ABNORMAL",
                "classNames": CLASS_NAMES,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    (OUTPUT_DIR / "test_metrics.json").write_text(
        json.dumps(
            {
                "shoulder_abnormality": {
                    "threshold": threshold,
                    "roc_auc": tuned["rocAuc"],
                    "accuracy": tuned["accuracy"],
                    "normal_recall": tuned["normalRecall"],
                    "abnormal_recall": tuned["abnormalRecall"],
                    "test_positive_count": int(np.sum(test_truth == 1)),
                },
                "atFixedHalf": {
                    "accuracy": baseline["accuracy"],
                    "normal_recall": baseline["normalRecall"],
                    "abnormal_recall": baseline["abnormalRecall"],
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    (OUTPUT_DIR / "test_report.txt").write_text(
        f"Threshold {threshold}\n\n{tuned['report']}\n\n"
        f"At a fixed 0.5\n\n{baseline['report']}\n",
        encoding="utf-8",
    )

    print(f"\nWrote metrics and thresholds to {OUTPUT_DIR}")
    print(
        f"  normal recall {tuned['normalRecall']:.4f} "
        f"(was {baseline['normalRecall']:.4f} at 0.5)"
    )


if __name__ == "__main__":
    main()
