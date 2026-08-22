"""
Second hand model. Two faults in the first run are addressed here.

Fault one: the cut point did not survive the move from validation to
test. Validation holds 33 normal hands, and a threshold picked by
balanced recall on 33 images moves a long way when a handful of them
land differently. The first run chose 0.011 on validation, which read
94% of broken hands correctly but only 46% of healthy ones on test,
while 0.05 would have given 83% and 65%. The threshold, not the model,
was the unstable part.

    The fix is to resample validation many times and keep the threshold
    that is good on average rather than the one that is best on the exact
    33 images that happened to be there. A cut point that only wins on
    one draw of the data will not win on most draws.

Fault two: fine tuning improved separation while ruining calibration.
Validation AUC rose to 0.8856 but validation loss climbed to 1.69 and
scores bunched up near zero, which is why a sensible threshold ended up
at 0.011. Training now stops on validation loss during the second stage,
so the model keeps the calibration it had when it stopped improving.

The backbone is EfficientNetB0 rather than MobileNetV2. It is the
stronger of the two on this size of image and takes raw 0-255 pixels,
which it rescales internally: passing it preprocessed input, as
MobileNetV2 needs, would feed it the wrong range entirely.

Run:

    python scripts/train_hand_model_v2.py
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

OUTPUT_DIR = AI_SERVICE_DIR / "models" / "hand_triage_v2"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 16
RANDOM_SEED = 42

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
    EfficientNet rescales inside the network, so the pixels are handed
    over as they are. The augmentation runs on the same 0-255 range.
    """
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.10),
            tf.keras.layers.RandomZoom(0.15),
            tf.keras.layers.RandomTranslation(0.10, 0.10),
            tf.keras.layers.RandomContrast(0.20),
        ]
    )

    if augment:
        dataset = dataset.map(
            lambda images, labels: (augmentation(images, training=True), labels),
            num_parallel_calls=tf.data.AUTOTUNE,
        )

    return dataset.prefetch(tf.data.AUTOTUNE)


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    backbone = tf.keras.applications.EfficientNetB0(
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


def balanced_recall(truth: np.ndarray, scores: np.ndarray, cut: float) -> float:
    predicted = (scores >= cut).astype(int)

    normal = truth == 0
    abnormal = truth == 1

    if not normal.any() or not abnormal.any():
        return 0.0

    return float(
        (np.mean(predicted[normal] == 0) + np.mean(predicted[abnormal] == 1)) / 2
    )


def choose_threshold(truth: np.ndarray, scores: np.ndarray, draws: int = 400) -> float:
    """
    Picks the cut point that holds up across resamples of the validation
    set rather than the one that happens to win on it.

    Validation is drawn with replacement `draws` times, keeping the two
    classes at their real sizes, and every candidate cut is scored on
    each draw. The cut with the best average is returned. On a set this
    small the single best cut is often a spike that one or two images
    created; an average over many draws ignores those spikes.
    """
    generator = np.random.default_rng(RANDOM_SEED)

    normal_index = np.flatnonzero(truth == 0)
    abnormal_index = np.flatnonzero(truth == 1)

    candidates = np.arange(0.01, 0.99, 0.005)
    totals = np.zeros_like(candidates)

    for _ in range(draws):
        sample = np.concatenate(
            [
                generator.choice(normal_index, size=normal_index.size, replace=True),
                generator.choice(abnormal_index, size=abnormal_index.size, replace=True),
            ]
        )

        drawn_truth = truth[sample]
        drawn_scores = scores[sample]

        for position, cut in enumerate(candidates):
            totals[position] += balanced_recall(drawn_truth, drawn_scores, cut)

    averages = totals / draws
    best = int(np.argmax(averages))

    print(f"  bootstrap over {draws} draws")
    print(f"  best average balanced recall: {averages[best]:.4f}")
    print(f"  single-draw best would be:    {max(balanced_recall(truth, scores, c) for c in candidates):.4f}")

    return round(float(candidates[best]), 3)


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
    Most normal images here are screenshots and most abnormal ones are
    not, so a model could score well by learning the picture style. The
    two styles are measured apart to catch that.
    """
    ordered = [
        path.name
        for label in CLASS_NAMES
        for path in sorted((TEST_DIR / label).iterdir())
        if path.is_file()
    ]

    if len(ordered) != len(truth):
        return {}

    is_screenshot = np.array([name.lower().startswith("screenshot") for name in ordered])
    predicted = (scores >= threshold).astype(int)

    outcome = {}

    for label, mask in (("screenshot", is_screenshot), ("other", ~is_screenshot)):
        if mask.any():
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
            print("  WARNING: the model may be reading the picture style, not the hand.")

    return outcome


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--fine-tune-epochs", type=int, default=15)
    parser.add_argument("--unfreeze", type=int, default=30)
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

    print("\n=== Stage 1: the classification head ===")
    model.fit(
        train_dataset,
        validation_data=val_dataset,
        epochs=arguments.epochs,
        class_weight=weights,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_auc", mode="max", patience=5, restore_best_weights=True
            )
        ],
        verbose=2,
    )

    print("\n=== Stage 2: fine tuning the top of the backbone ===")
    backbone.trainable = True

    for layer in backbone.layers[: -arguments.unfreeze]:
        layer.trainable = False

    """
    Batch normalisation keeps running averages of the activations it saw
    in training. On a set this small those averages move a long way from
    the ImageNet ones they started at, and the model then behaves
    differently at prediction time than it did while training. Leaving
    them frozen is standard for fine tuning a small set.
    """
    for layer in backbone.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    """
    Stopping on loss rather than AUC. The first run watched AUC, which
    kept creeping up while the loss tripled: the model was ordering the
    images better and scoring them worse, and the scores are what the
    threshold is applied to.
    """
    model.fit(
        train_dataset,
        validation_data=val_dataset,
        epochs=arguments.fine_tune_epochs,
        class_weight=weights,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss", mode="min", patience=4, restore_best_weights=True
            )
        ],
        verbose=2,
    )

    model_path = OUTPUT_DIR / "hand_triage_v2_model.keras"
    model.save(model_path)
    print(f"\nSaved model: {model_path}")

    print("\n=== Choosing the cut point on the validation set ===")
    val_truth, val_scores = collect_scores(model, val_dataset)
    threshold = choose_threshold(val_truth, val_scores)

    print(f"  threshold: {threshold}")
    print(
        f"  validation scores: normals median {np.median(val_scores[val_truth == 0]):.4f}, "
        f"abnormals median {np.median(val_scores[val_truth == 1]):.4f}"
    )

    print("\n=== Test set at the chosen threshold ===")
    test_truth, test_scores = collect_scores(model, test_dataset)
    tuned = report(test_truth, test_scores, threshold)

    print("\n=== Test set at a fixed 0.5, for comparison ===")
    baseline = report(test_truth, test_scores, 0.5)

    print("\n=== Is it reading the hand or the picture style? ===")
    styles = source_check(test_truth, test_scores, threshold)

    (OUTPUT_DIR / "hand_triage_v2_thresholds.json").write_text(
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
