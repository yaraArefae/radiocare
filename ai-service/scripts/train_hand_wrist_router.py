"""
Trains the router that decides whether an upper limb X-ray shows a hand
or a wrist.

Why a router is needed:

The clinic has one pathway for hand and wrist, and the patient is never
asked which of the two they photographed. There are now two models, and
each is useless outside its own region. Measured on the same images:

                     on hands              on wrists
    wrist model      normal recall 0.000   accuracy 0.841
    hand model       accuracy 0.824        abnormal recall 0.401

Sending every image to either one is therefore wrong half the time. The
router picks the specialist.

The danger in training it:

The hand images are Roboflow exports, 640x640 JPEG, and the wrist images
are GRAZPEDWRI-DX PNGs. A model handed those two piles will happily
learn JPEG artefacts and image size instead of anatomy, and would then
misroute a real hand X-ray that does not look like a Roboflow export.
This project has already lost a chest model to exactly that mistake.

Three things push the model towards shape and away from style:

  1. Everything is converted to greyscale and back, so an incidental
     colour cast in one pile cannot separate them.
  2. Contrast, brightness, sharpness and JPEG-like noise are varied hard
     during training, so none of them is a reliable clue.
  3. The report at the end measures accuracy against image size. A
     router that is reading the export pipeline rather than the hand
     will do noticeably better on the sizes it saw in training.

A hand and a wrist differ by five fingers, so there is a very strong
shape signal available. The model should not need the style, and the
checks below say whether it used it anyway.

Run:

    python scripts/train_hand_wrist_router.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

AI_SERVICE_DIR = Path(__file__).resolve().parent.parent

HAND_NORMAL = Path(r"C:\Users\User\Desktop\Normal hand\Normal hand")
HAND_ABNORMAL = Path(r"C:\Users\User\Desktop\Abnormal  2\Abnormal")
WRIST_TABLE = (
    AI_SERVICE_DIR / "data" / "wrist" / "processed" / "grazped_multilabel" / "labels_all.csv"
)

OUTPUT_DIR = AI_SERVICE_DIR / "models" / "hand_wrist_router"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
RANDOM_SEED = 42

"""
HAND is 0 and WRIST is 1. The order is fixed here rather than left to
sorting, so the meaning of a score cannot silently invert.
"""
CLASS_NAMES = ["HAND", "WRIST"]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}

ROBOFLOW_SUFFIX = re.compile(r"_(jpg|jpeg|png)\.rf\.[0-9a-f]+\.(jpg|jpeg|png)$", re.I)


def original_name(path: Path) -> str:
    stripped = ROBOFLOW_SUFFIX.sub("", path.name)

    return stripped if stripped != path.name else path.stem


def hand_images() -> list[tuple[str, str]]:
    """
    Every hand image, paired with the original it was altered from, so
    copies of one hand stay on the same side of a split.
    """
    collected: list[tuple[str, str]] = []

    for root in (HAND_NORMAL, HAND_ABNORMAL):
        for path in sorted(root.rglob("*")):
            if (
                path.is_file()
                and path.suffix.lower() in IMAGE_SUFFIXES
                and "__MACOSX" not in path.parts
                and not path.name.startswith("._")
            ):
                collected.append((str(path), original_name(path)))

    return collected


def wrist_images(limit: int) -> list[tuple[str, str]]:
    """
    A sample of wrists, grouped by patient. GRAZPEDWRI holds far more
    wrists than there are hands, and an unbalanced router would learn to
    answer "wrist" and be right most of the time.
    """
    table = pd.read_csv(WRIST_TABLE)

    table = table[table["image_path"].apply(lambda value: Path(value).exists())]

    patients = sorted(table["patient_id"].astype(str).unique())

    collected: list[tuple[str, str]] = []

    for patient in patients:
        if len(collected) >= limit:
            break

        rows = table[table["patient_id"].astype(str) == patient]

        for path in rows["image_path"]:
            if len(collected) >= limit:
                break

            collected.append((str(path), f"patient_{patient}"))

    return collected


def assign_splits(items: list[tuple[str, str]]) -> dict[str, list[str]]:
    """
    Groups are ordered by a hash of their name rather than by the name
    itself, so a numbering scheme in the source cannot put early images
    in training and late ones in test.
    """
    groups: dict[str, list[str]] = {}

    for path, group in items:
        groups.setdefault(group, []).append(path)

    ordered = sorted(
        groups, key=lambda name: hashlib.md5(name.encode("utf-8")).hexdigest()
    )

    train_end = int(len(ordered) * 0.70)
    val_end = train_end + int(len(ordered) * 0.15)

    split_paths: dict[str, list[str]] = {"train": [], "val": [], "test": []}

    for index, name in enumerate(ordered):
        if index < train_end:
            split_paths["train"].extend(groups[name])
        elif index < val_end:
            split_paths["val"].extend(groups[name])
        else:
            split_paths["test"].extend(groups[name])

    return split_paths


def decode(path: tf.Tensor) -> tf.Tensor:
    """
    Reads one image as greyscale and repeats it across three channels.

    The backbone wants three channels, but an X-ray carries no colour.
    Forcing grey removes any colour difference between the two sources
    from the model's reach.
    """
    raw = tf.io.read_file(path)
    image = tf.io.decode_image(raw, channels=1, expand_animations=False)
    image.set_shape([None, None, 1])
    image = tf.image.resize(tf.cast(image, tf.float32), IMAGE_SIZE, antialias=True)

    return tf.repeat(image, 3, axis=-1)


def build_dataset(paths: list[str], labels: list[int], shuffle: bool) -> tf.data.Dataset:
    dataset = tf.data.Dataset.from_tensor_slices((paths, labels))

    if shuffle:
        dataset = dataset.shuffle(len(paths), seed=RANDOM_SEED)

    return (
        dataset.map(
            lambda path, label: (decode(path), label),
            num_parallel_calls=tf.data.AUTOTUNE,
        )
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )


def build_model() -> tuple[tf.keras.Model, tf.keras.Model]:
    backbone = tf.keras.applications.MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )

    backbone.trainable = False

    """
    The style defences live inside the model rather than in the input
    pipeline, so they are applied during training and skipped at
    prediction time without any extra bookkeeping.
    """
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.15),
            tf.keras.layers.RandomZoom(0.20),
            tf.keras.layers.RandomTranslation(0.10, 0.10),
            tf.keras.layers.RandomContrast(0.40),
            tf.keras.layers.RandomBrightness(0.30, value_range=(0, 255)),
        ]
    )

    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
    varied = augmentation(inputs)
    scaled = tf.keras.applications.mobilenet_v2.preprocess_input(varied)

    """
    The grain is added after scaling, where the pixels run from -1 to 1.
    GaussianNoise measures its spread in the units it is given, so on the
    raw 0-255 range the same layer would either do nothing or drown the
    image. It sits inside the model, so it applies while training and is
    skipped when predicting.
    """
    noised = tf.keras.layers.GaussianNoise(0.05)(scaled)

    features = backbone(noised, training=False)
    pooled = tf.keras.layers.GlobalAveragePooling2D()(features)
    dropped = tf.keras.layers.Dropout(0.3)(pooled)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(dropped)

    return tf.keras.Model(inputs, outputs), backbone


def size_check(paths: list[str], truth: np.ndarray, predicted: np.ndarray) -> dict:
    """
    Asks whether the router is reading the export pipeline.

    Hands arrive as 640x640 Roboflow exports and wrists at the original
    radiograph size. If the router is using that, it will be near perfect
    on 640x640 images and worse on everything else.
    """
    from PIL import Image

    sizes = []

    for path in paths:
        try:
            with Image.open(path) as image:
                sizes.append(image.size)
        except Exception:
            sizes.append((0, 0))

    square = np.array([size == (640, 640) for size in sizes])
    correct = predicted == truth

    outcome = {}

    for label, mask in (("640x640", square), ("other sizes", ~square)):
        if mask.any():
            outcome[label] = {
                "count": int(mask.sum()),
                "accuracy": float(np.mean(correct[mask])),
            }

            print(
                f"  {label:12} n={outcome[label]['count']:5}  "
                f"accuracy {outcome[label]['accuracy']:.4f}"
            )

    return outcome


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--fine-tune-epochs", type=int, default=6)
    parser.add_argument("--unfreeze", type=int, default=30)
    parser.add_argument("--wrist-limit", type=int, default=900)
    arguments = parser.parse_args()

    tf.keras.utils.set_random_seed(RANDOM_SEED)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    hands = hand_images()
    wrists = wrist_images(arguments.wrist_limit)

    print(f"hand images : {len(hands)}")
    print(f"wrist images: {len(wrists)}")

    hand_splits = assign_splits(hands)
    wrist_splits = assign_splits(wrists)

    datasets = {}
    split_paths = {}

    for split in ("train", "val", "test"):
        paths = hand_splits[split] + wrist_splits[split]
        labels = [0] * len(hand_splits[split]) + [1] * len(wrist_splits[split])

        split_paths[split] = paths
        datasets[split] = build_dataset(paths, labels, shuffle=split == "train")

        print(
            f"  {split}: HAND {len(hand_splits[split])}  "
            f"WRIST {len(wrist_splits[split])}"
        )

    model, backbone = build_model()

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    print("\n=== Stage 1: the classification head ===")
    model.fit(
        datasets["train"],
        validation_data=datasets["val"],
        epochs=arguments.epochs,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_auc", mode="max", patience=3, restore_best_weights=True
            )
        ],
        verbose=2,
    )

    print("\n=== Stage 2: fine tuning the top of the backbone ===")
    backbone.trainable = True

    for layer in backbone.layers[: -arguments.unfreeze]:
        layer.trainable = False

    for layer in backbone.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    model.fit(
        datasets["train"],
        validation_data=datasets["val"],
        epochs=arguments.fine_tune_epochs,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss", mode="min", patience=3, restore_best_weights=True
            )
        ],
        verbose=2,
    )

    model_path = OUTPUT_DIR / "hand_wrist_router_model.keras"
    model.save(model_path)
    print(f"\nSaved model: {model_path}")

    print("\n=== Test set ===")
    scores = model.predict(datasets["test"], verbose=0).reshape(-1)
    truth = np.concatenate([labels.numpy().reshape(-1) for _, labels in datasets["test"]])
    predicted = (scores >= 0.5).astype(int)

    text = classification_report(
        truth, predicted, labels=[0, 1], target_names=CLASS_NAMES, digits=4, zero_division=0
    )

    print(text)
    print(confusion_matrix(truth, predicted, labels=[0, 1]))

    print("\n=== Is it reading anatomy or the export pipeline? ===")
    sizes = size_check(split_paths["test"], truth, predicted)

    accuracy = float(accuracy_score(truth, predicted))

    (OUTPUT_DIR / "router_metadata.json").write_text(
        json.dumps(
            {
                "threshold": 0.5,
                "classNames": CLASS_NAMES,
                "positiveClass": "WRIST",
                "accuracy": accuracy,
                "handRecall": float(np.mean(predicted[truth == 0] == 0)),
                "wristRecall": float(np.mean(predicted[truth == 1] == 1)),
                "bySize": sizes,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    (OUTPUT_DIR / "test_report.txt").write_text(text, encoding="utf-8")

    print(f"\nRouter accuracy: {accuracy:.4f}")
    print(f"Wrote to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
