"""
Trains the hand triage model: is this hand X-ray normal or not.

The hand has been answered by the wrist model until now. Over 400 real
hand images that model called 311 abnormal and returned a median 0.576
for "metal is present" on ordinary hands, because a whole hand is not a
shape it was ever trained on. This model is trained on hands.

The set is small: 604 original images, and Roboflow copies push the file
count to 898. Three things follow from that size:

  1. Splits are made on the original image, not the file, which the
     preparation script already does. Two altered copies of one hand are
     not two independent examples.

  2. Augmentation is heavier than in the chest run. With 207 original
     training hands the model will otherwise memorise them.

  3. The cut point is chosen on the validation set, not fixed at 0.5.
     Abnormal images outnumber normal ones 2.6 to 1, so a model scored
     at 0.5 leans abnormal, which is exactly the failure the wrist model
     showed on hands.

The last block measures something a plain accuracy hides. Most normal
images in this set are screenshots and most abnormal ones are not, so a
model could reach a good score by learning what a screenshot looks like
instead of what a broken bone looks like. Accuracy is therefore reported
separately for screenshot and non-screenshot images. If the two differ
sharply, the number at the top of the report is not measuring anatomy.

Run:

    python scripts/train_hand_model.py
    python scripts/train_hand_model.py --epochs 20 --fine-tune-epochs 12
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

DATA_DIR = AI_SERVICE_DIR / "data" / "hand" / "processed"
TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"
TEST_DIR = DATA_DIR / "test"

OUTPUT_DIR = AI_SERVICE_DIR / "models" / "hand_triage_v1"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
RANDOM_SEED = 42

"""
NORMAL is 0 and ABNORMAL is 1, so a higher score always means "more
likely to need a doctor". Letting Keras sort the folder names would put
ABNORMAL first and quietly invert every score.
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
    training images so 207 original hands do not get memorised.

    The horizontal flip is deliberate here: a left hand and a right hand
    are mirror images of one another and both are normal, so flipping
    teaches the model to ignore the side rather than to learn it.
    """
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.10),
            tf.keras.layers.RandomZoom(0.15),
            tf.keras.layers.RandomTranslation(0.10, 0.10),
            tf.keras.layers.RandomContrast(0.20),
            tf.keras.layers.RandomBrightness(0.15, value_range=(0, 255)),
        ]
    )

    def scale(images, labels):
        return tf.keras.applications.mobilenet_v2.preprocess_input(images), labels

    if augment:
        dataset = dataset.map(
            lambda images, labels: (augmentation(images, training=True), labels),
            num_parallel_calls=tf.data.AUTOTUNE,
        )

    return dataset.map(scale, num_parallel_calls=tf.data.AUTOTUNE).prefetch(
        tf.data.AUTOTUNE
    )


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    backbone = tf.keras.applications.MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )

    backbone.trainable = False

    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
    features = backbone(inputs, training=False)
    pooled = tf.keras.layers.GlobalAveragePooling2D()(features)
    dropped = tf.keras.layers.Dropout(0.4)(pooled)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(dropped)

    return tf.keras.Model(inputs, outputs), backbone


def class_weights(directory: Path) -> dict[int, float]:
    """
    Counters the 2.6 to 1 imbalance. Without this the model can reach 72%
    accuracy by calling every hand abnormal, which is the behaviour that
    made the wrist model useless on hands.
    """
    counts = [
        sum(1 for path in (directory / name).rglob("*") if path.is_file())
        for name in CLASS_NAMES
    ]

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
    Picks the cut point on the validation set, scoring by the mean of the
    two recalls. Plain accuracy would be maximised by leaning abnormal,
    since abnormal images outnumber normal ones; balancing the recalls
    asks the model to be right about healthy hands as often as it is
    about broken ones.
    """
    best_threshold = 0.5
    best_score = -1.0

    for cut in np.arange(0.05, 0.96, 0.01):
        predicted = (scores >= cut).astype(int)

        normal_recall = float(np.mean(predicted[truth == 0] == 0)) if np.any(truth == 0) else 0.0
        abnormal_recall = float(np.mean(predicted[truth == 1] == 1)) if np.any(truth == 1) else 0.0

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


def source_check(truth: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    """
    Asks whether the model is reading the picture or the pathology.

    Screenshots make up most of the normal side and little of the
    abnormal side. If the model has learned that shortcut it will be
    close to perfect on screenshots and poor on everything else, and the
    overall accuracy will hide it.
    """
    names = sorted(
        path.name
        for label in CLASS_NAMES
        for path in (TEST_DIR / label).iterdir()
        if path.is_file()
    )

    ordered = [
        path.name
        for label in CLASS_NAMES
        for path in sorted((TEST_DIR / label).iterdir())
        if path.is_file()
    ]

    if len(ordered) != len(truth):
        print("  (skipped: file order could not be matched to the scores)")
        return {}

    is_screenshot = np.array(
        [name.lower().startswith("screenshot") for name in ordered]
    )

    predicted = (scores >= threshold).astype(int)

    outcome = {}

    for label, mask in (
        ("screenshot", is_screenshot),
        ("other", ~is_screenshot),
    ):
        if not mask.any():
            continue

        outcome[label] = {
            "count": int(mask.sum()),
            "accuracy": float(np.mean(predicted[mask] == truth[mask])),
        }

        print(
            f"  {label:11} n={outcome[label]['count']:4}  "
            f"accuracy {outcome[label]['accuracy']:.4f}"
        )

    if len(outcome) == 2:
        gap = abs(outcome["screenshot"]["accuracy"] - outcome["other"]["accuracy"])
        outcome["gap"] = float(gap)

        print(f"  gap: {gap:.4f}")

        if gap > 0.20:
            print(
                "  WARNING: the model performs very differently on the two "
                "styles. It may be reading the source of the image rather "
                "than the hand in it."
            )

    return outcome


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--fine-tune-epochs", type=int, default=12)
    parser.add_argument("--unfreeze", type=int, default=40)
    arguments = parser.parse_args()

    tf.keras.utils.set_random_seed(RANDOM_SEED)

    for folder in (TRAIN_DIR, VAL_DIR, TEST_DIR):
        if not folder.exists():
            raise SystemExit(f"Missing folder: {folder}. Run prepare_hand_data.py first.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    train_dataset = prepare(build_dataset(TRAIN_DIR, shuffle=True), augment=True)
    val_dataset = prepare(build_dataset(VAL_DIR, shuffle=False), augment=False)
    test_dataset = prepare(build_dataset(TEST_DIR, shuffle=False), augment=False)

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
        patience=5,
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
    The model is saved before anything is measured. An earlier run in this
    project computed its metrics first and crashed on the report, losing a
    finished model, so the order here is deliberate.
    """
    model_path = OUTPUT_DIR / "hand_triage_v1_model.keras"
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

    print("\n=== Is it reading the hand or the picture style? ===")
    styles = source_check(test_truth, test_scores, threshold)

    (OUTPUT_DIR / "hand_triage_v1_thresholds.json").write_text(
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
                "hand_abnormality": {
                    "threshold": threshold,
                    "roc_auc": tuned["rocAuc"],
                    "accuracy": tuned["accuracy"],
                    "normal_recall": tuned["normalRecall"],
                    "abnormal_recall": tuned["abnormalRecall"],
                    "test_positive_count": int(np.sum(test_truth == 1)),
                    "test_negative_count": int(np.sum(test_truth == 0)),
                },
                "atFixedHalf": {
                    "accuracy": baseline["accuracy"],
                    "normal_recall": baseline["normalRecall"],
                    "abnormal_recall": baseline["abnormalRecall"],
                },
                "byPictureStyle": styles,
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
        f"  AUC {tuned['rocAuc']:.4f}  accuracy {tuned['accuracy']:.4f}  "
        f"normal recall {tuned['normalRecall']:.4f}  "
        f"abnormal recall {tuned['abnormalRecall']:.4f}"
    )


if __name__ == "__main__":
    main()
