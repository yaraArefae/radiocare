from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.utils import resample

SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 24
HEAD_EPOCHS = 12
FINE_TUNE_EPOCHS = 10
MIN_VALIDATION_RECALL = 0.80

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "shoulder_findings"
CSV_PATH = DATA_DIR / "labels_available_clean.csv"

MODEL_DIR = BASE_DIR / "models" / "shoulder_fracture"
MODEL_PATH = MODEL_DIR / "shoulder_fracture_model.keras"
BEST_PATH = MODEL_DIR / "shoulder_fracture_best.keras"
THRESHOLD_PATH = MODEL_DIR / "shoulder_fracture_threshold.json"
REPORT_PATH = MODEL_DIR / "classification_report.txt"
CONFUSION_PATH = MODEL_DIR / "confusion_matrix.png"


def resolve_image_path(value: str) -> str:
    raw = Path(str(value).strip())
    path = raw if raw.is_absolute() else DATA_DIR / raw
    return str(path.resolve())


def load_dataframe() -> pd.DataFrame:
    if not CSV_PATH.is_file():
        raise FileNotFoundError(
            f"Clean labels file was not found:\n{CSV_PATH}\n"
            "Run clean_shoulder_findings_images.py first."
        )

    df = pd.read_csv(CSV_PATH)
    required = {"image_path", "fracture", "source"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError("Missing columns: " + ", ".join(sorted(missing)))

    # Use FracAtlas only so the model cannot learn the source/style of
    # the implant dataset instead of learning fractures.
    df = df[
        df["source"].astype(str).str.strip().str.casefold().eq("fracatlas")
    ].copy()

    if df.empty:
        raise ValueError("No FracAtlas rows were found.")

    df["fracture"] = pd.to_numeric(df["fracture"], errors="coerce")
    if df["fracture"].isna().any() or not df["fracture"].isin([0, 1]).all():
        raise ValueError("fracture must contain only 0 or 1.")

    df["fracture"] = df["fracture"].astype(int)
    df["image_path"] = df["image_path"].map(resolve_image_path)
    df = df.drop_duplicates(subset=["image_path"]).reset_index(drop=True)

    missing_files = [p for p in df["image_path"] if not Path(p).is_file()]
    if missing_files:
        raise FileNotFoundError(
            f"{len(missing_files)} images were not found.\n"
            + "\n".join(missing_files[:10])
        )

    positives = int(df["fracture"].sum())
    negatives = len(df) - positives
    print("\nShoulder fracture dataset")
    print(f"Total: {len(df)}")
    print(f"FRACTURE: {positives}")
    print(f"NO FRACTURE: {negatives}")

    if positives < 30:
        raise ValueError("Too few fracture images for training.")

    return df[["image_path", "fracture"]]


def split_dataframe(df: pd.DataFrame):
    train_df, temp_df = train_test_split(
        df,
        test_size=0.30,
        random_state=SEED,
        stratify=df["fracture"],
    )
    val_df, test_df = train_test_split(
        temp_df,
        test_size=0.50,
        random_state=SEED,
        stratify=temp_df["fracture"],
    )
    return (
        train_df.reset_index(drop=True),
        val_df.reset_index(drop=True),
        test_df.reset_index(drop=True),
    )


def balance_training_frame(train_df: pd.DataFrame) -> pd.DataFrame:
    positive = train_df[train_df["fracture"] == 1]
    negative = train_df[train_df["fracture"] == 0]
    positive_up = resample(
        positive,
        replace=True,
        n_samples=len(negative),
        random_state=SEED,
    )
    balanced = pd.concat([negative, positive_up], ignore_index=True)
    return balanced.sample(frac=1, random_state=SEED).reset_index(drop=True)


def decode_image(path: tf.Tensor, label: tf.Tensor):
    image = tf.io.decode_jpeg(tf.io.read_file(path), channels=3)
    image = tf.image.resize(image, IMAGE_SIZE, antialias=True)
    return tf.cast(image, tf.float32), tf.cast(label, tf.float32)


def make_dataset(df: pd.DataFrame, training: bool):
    ds = tf.data.Dataset.from_tensor_slices(
        (
            df["image_path"].to_numpy(),
            df["fracture"].to_numpy(dtype=np.float32),
        )
    )
    if training:
        ds = ds.shuffle(len(df), seed=SEED, reshuffle_each_iteration=True)
    ds = ds.map(decode_image, num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def build_model():
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(0.05),
            tf.keras.layers.RandomZoom(0.10),
            tf.keras.layers.RandomTranslation(0.05, 0.05),
            tf.keras.layers.RandomContrast(0.12),
        ],
        name="fracture_augmentation",
    )

    base = tf.keras.applications.EfficientNetB0(
        include_top=False,
        weights="imagenet",
        input_shape=(*IMAGE_SIZE, 3),
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
    x = augmentation(inputs)
    x = tf.keras.applications.efficientnet.preprocess_input(x)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.40)(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.25)(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(x)

    return tf.keras.Model(inputs, outputs), base


def compile_model(model: tf.keras.Model, learning_rate: float):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate),
        loss=tf.keras.losses.BinaryCrossentropy(label_smoothing=0.02),
        metrics=[
            tf.keras.metrics.BinaryAccuracy(name="accuracy"),
            tf.keras.metrics.AUC(name="roc_auc", curve="ROC"),
            tf.keras.metrics.AUC(name="pr_auc", curve="PR"),
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )


def collect_predictions(model, dataset):
    probabilities = model.predict(dataset, verbose=1).reshape(-1)
    true_labels = np.concatenate(
        [labels.numpy().reshape(-1) for _, labels in dataset]
    ).astype(int)
    return true_labels, probabilities


def metrics_at_threshold(y_true, probabilities, threshold):
    y_pred = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = matrix.ravel()
    sensitivity = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    f1 = (
        2 * precision * sensitivity / (precision + sensitivity)
        if precision + sensitivity
        else 0.0
    )
    accuracy = (tp + tn) / matrix.sum() if matrix.sum() else 0.0
    balanced_accuracy = (sensitivity + specificity) / 2
    return {
        "threshold": float(threshold),
        "accuracy": accuracy,
        "balanced_accuracy": balanced_accuracy,
        "sensitivity": sensitivity,
        "specificity": specificity,
        "precision": precision,
        "f1": f1,
        "matrix": matrix,
    }


def choose_threshold(y_true, probabilities):
    candidates = [
        metrics_at_threshold(y_true, probabilities, t)
        for t in np.linspace(0.05, 0.95, 181)
    ]
    eligible = [
        item
        for item in candidates
        if item["sensitivity"] >= MIN_VALIDATION_RECALL
    ]
    pool = eligible or candidates
    return max(
        pool,
        key=lambda item: (
            item["balanced_accuracy"],
            item["f1"],
            item["specificity"],
        ),
    )


def save_confusion_matrix(matrix: np.ndarray):
    fig, ax = plt.subplots(figsize=(6, 5))
    image = ax.imshow(matrix)
    fig.colorbar(image, ax=ax)
    ax.set_title("Shoulder Fracture Confusion Matrix")
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_xticks([0, 1], ["NO FRACTURE", "FRACTURE"])
    ax.set_yticks([0, 1], ["NO FRACTURE", "FRACTURE"])
    for row in range(2):
        for col in range(2):
            ax.text(col, row, str(matrix[row, col]), ha="center", va="center")
    fig.tight_layout()
    fig.savefig(CONFUSION_PATH, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main():
    tf.keras.utils.set_random_seed(SEED)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    df = load_dataframe()
    train_df, val_df, test_df = split_dataframe(df)
    balanced_train = balance_training_frame(train_df)

    print("\nNatural split")
    print(f"Train: {len(train_df)} | fractures: {int(train_df['fracture'].sum())}")
    print(f"Validation: {len(val_df)} | fractures: {int(val_df['fracture'].sum())}")
    print(f"Test: {len(test_df)} | fractures: {int(test_df['fracture'].sum())}")
    print("\nBalanced training counts")
    print(balanced_train["fracture"].value_counts().sort_index().to_string())

    train_ds = make_dataset(balanced_train, training=True)
    val_ds = make_dataset(val_df, training=False)
    test_ds = make_dataset(test_df, training=False)

    model, base = build_model()
    compile_model(model, 1e-3)

    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(
            str(BEST_PATH),
            monitor="val_pr_auc",
            mode="max",
            save_best_only=True,
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_pr_auc",
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
        train_ds,
        validation_data=val_ds,
        epochs=HEAD_EPOCHS,
        callbacks=callbacks,
    )

    print("\nStage 2: fine-tuning EfficientNetB0...")
    base.trainable = True
    for layer in base.layers[:-40]:
        layer.trainable = False
    for layer in base.layers[-40:]:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False

    compile_model(model, 1e-5)
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=FINE_TUNE_EPOCHS,
        callbacks=callbacks,
    )

    best_model = tf.keras.models.load_model(BEST_PATH)

    y_val, val_prob = collect_predictions(best_model, val_ds)
    selected = choose_threshold(y_val, val_prob)
    threshold = selected["threshold"]

    y_test, test_prob = collect_predictions(best_model, test_ds)
    test_metrics = metrics_at_threshold(y_test, test_prob, threshold)
    y_pred = (test_prob >= threshold).astype(int)

    try:
        auc = roc_auc_score(y_test, test_prob)
    except ValueError:
        auc = 0.0

    report = classification_report(
        y_test,
        y_pred,
        target_names=["NO_FRACTURE", "FRACTURE"],
        zero_division=0,
    )

    best_model.save(MODEL_PATH)
    save_confusion_matrix(test_metrics["matrix"])

    threshold_payload = {
        "threshold": threshold,
        "positive_class": "FRACTURE",
        "minimum_validation_sensitivity": MIN_VALIDATION_RECALL,
        "validation_metrics": {
            key: selected[key]
            for key in (
                "accuracy",
                "balanced_accuracy",
                "sensitivity",
                "specificity",
                "precision",
                "f1",
            )
        },
        "test_metrics": {
            key: test_metrics[key]
            for key in (
                "accuracy",
                "balanced_accuracy",
                "sensitivity",
                "specificity",
                "precision",
                "f1",
            )
        }
        | {"roc_auc": auc},
        "model": MODEL_PATH.name,
    }

    THRESHOLD_PATH.write_text(
        json.dumps(threshold_payload, indent=2),
        encoding="utf-8",
    )

    REPORT_PATH.write_text(
        "Shoulder Fracture Model\n\n"
        f"Threshold: {threshold:.3f}\n"
        f"ROC-AUC: {auc:.4f}\n"
        f"Accuracy: {test_metrics['accuracy']:.4f}\n"
        f"Balanced accuracy: {test_metrics['balanced_accuracy']:.4f}\n"
        f"Sensitivity: {test_metrics['sensitivity']:.4f}\n"
        f"Specificity: {test_metrics['specificity']:.4f}\n"
        f"Precision: {test_metrics['precision']:.4f}\n"
        f"F1-score: {test_metrics['f1']:.4f}\n\n"
        f"Confusion matrix:\n{test_metrics['matrix']}\n\n"
        f"Classification report:\n{report}",
        encoding="utf-8",
    )

    print("\nShoulder fracture test results")
    print(f"Threshold: {threshold:.3f}")
    print(f"Accuracy: {test_metrics['accuracy'] * 100:.2f}%")
    print(f"Balanced accuracy: {test_metrics['balanced_accuracy'] * 100:.2f}%")
    print(f"Sensitivity: {test_metrics['sensitivity'] * 100:.2f}%")
    print(f"Specificity: {test_metrics['specificity'] * 100:.2f}%")
    print(f"Precision: {test_metrics['precision'] * 100:.2f}%")
    print(f"F1-score: {test_metrics['f1'] * 100:.2f}%")
    print(f"ROC-AUC: {auc * 100:.2f}%")
    print("\nConfusion matrix:")
    print(test_metrics["matrix"])
    print("\nClassification report:")
    print(report)
    print("\nFiles saved")
    print(f"Model: {MODEL_PATH}")
    print(f"Threshold: {THRESHOLD_PATH}")
    print(f"Report: {REPORT_PATH}")
    print(f"Confusion matrix: {CONFUSION_PATH}")


if __name__ == "__main__":
    main()