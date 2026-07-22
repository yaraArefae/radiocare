import argparse
from pathlib import Path

import numpy as np
import tensorflow as tf


AI_SERVICE_DIR = Path(__file__).resolve().parents[1]

MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
    / "chest_model.keras"
)

IMAGE_SIZE = (224, 224)
THRESHOLD = 0.5


def predict_image(image_path: Path) -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model was not found:\n{MODEL_PATH}"
        )

    if not image_path.exists():
        raise FileNotFoundError(
            f"Image was not found:\n{image_path}"
        )

    print("Loading chest model...")

    model = tf.keras.models.load_model(
        MODEL_PATH,
        compile=False,
    )

    image = tf.keras.utils.load_img(
        image_path,
        target_size=IMAGE_SIZE,
        color_mode="rgb",
    )

    image_array = tf.keras.utils.img_to_array(image)

    image_array = np.expand_dims(
        image_array,
        axis=0,
    )

    abnormal_probability = float(
        model.predict(
            image_array,
            verbose=0,
        )[0][0]
    )

    if abnormal_probability >= 0.60:
        result = "ABNORMAL"
        confidence = abnormal_probability

    elif abnormal_probability <= 0.40:
        result = "NORMAL"
        confidence = 1 - abnormal_probability

    else:
        result = "UNCERTAIN"
        confidence = max(
            abnormal_probability,
            1 - abnormal_probability,
        )

    print("\n" + "=" * 50)
    print("Chest X-ray AI Preliminary Result")
    print("=" * 50)
    print(f"Image: {image_path.name}")
    print(f"Result: {result}")
    print(f"Confidence: {confidence * 100:.2f}%")
    print(
        f"Abnormal probability: "
        f"{abnormal_probability * 100:.2f}%"
    )
    print("=" * 50)
    print(
        "This is an AI preliminary result and must be "
        "reviewed by a doctor."
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Predict whether a chest X-ray is "
            "NORMAL or ABNORMAL."
        )
    )

    parser.add_argument(
        "image",
        help="Path to the chest X-ray image.",
    )

    args = parser.parse_args()

    image_path = Path(args.image)

    if not image_path.is_absolute():
        image_path = (
            Path.cwd()
            / image_path
        ).resolve()

    try:
        predict_image(image_path)

    except Exception as error:
        print("\nPrediction failed.")
        print(f"Error: {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()