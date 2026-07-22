import os
from io import BytesIO
from pathlib import Path

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import tensorflow as tf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError


# =========================================================
# Paths and settings
# =========================================================

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]

MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
    / "chest_model.keras"
)

IMAGE_SIZE = (224, 224)

# Decision limits:
# 60% or more: ABNORMAL
# 40% or less: NORMAL
# Between them: UNCERTAIN
NORMAL_THRESHOLD = 0.40
ABNORMAL_THRESHOLD = 0.60

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}

MAX_FILE_SIZE = 20 * 1024 * 1024


# =========================================================
# FastAPI application
# =========================================================

app = FastAPI(
    title="RadioCare AI Service",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Load the trained model
# =========================================================

chest_model = None
model_loading_error = None

try:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Chest model was not found at: {MODEL_PATH}"
        )

    print("Loading chest X-ray model...")

    chest_model = tf.keras.models.load_model(
        MODEL_PATH,
        compile=False,
    )

    print("Chest X-ray model loaded successfully.")

except Exception as error:
    model_loading_error = str(error)

    print("Failed to load chest X-ray model.")
    print(f"Error: {model_loading_error}")


# =========================================================
# Helper functions
# =========================================================

def prepare_image(
    image_bytes: bytes,
) -> tuple[np.ndarray, int, int]:
    try:
        pil_image = Image.open(
            BytesIO(image_bytes)
        ).convert("RGB")

    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        ) from error

    width, height = pil_image.size

    resized_image = pil_image.resize(
        IMAGE_SIZE
    )

    image_array = np.asarray(
        resized_image,
        dtype=np.float32,
    )

    image_array = np.expand_dims(
        image_array,
        axis=0,
    )

    return image_array, width, height


def get_prediction_result(
    abnormal_probability: float,
) -> tuple[str, float, bool]:
    if abnormal_probability >= ABNORMAL_THRESHOLD:
        result = "ABNORMAL"
        confidence = abnormal_probability
        needs_doctor_review = True

    elif abnormal_probability <= NORMAL_THRESHOLD:
        result = "NORMAL"
        confidence = 1 - abnormal_probability
        needs_doctor_review = False

    else:
        result = "UNCERTAIN"
        confidence = max(
            abnormal_probability,
            1 - abnormal_probability,
        )
        needs_doctor_review = True

    return result, confidence, needs_doctor_review


# =========================================================
# Routes
# =========================================================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "RadioCare AI service is running.",
        "modelLoaded": chest_model is not None,
    }


@app.get("/health")
def health_check():
    return {
        "success": chest_model is not None,
        "status": (
            "healthy"
            if chest_model is not None
            else "model-not-loaded"
        ),
        "service": "radiocare-ai-service",
        "model": "chest-xray-normal-abnormal",
        "modelLoaded": chest_model is not None,
        "modelError": model_loading_error,
    }


@app.post("/classify")
async def classify_image(
    image: UploadFile = File(...),
):
    if chest_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "The chest X-ray model is not available. "
                f"{model_loading_error or ''}"
            ),
        )

    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only JPG, JPEG, PNG and WEBP "
                "images are supported."
            ),
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty.",
        )

    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="The image must be smaller than 20 MB.",
        )

    try:
        image_array, width, height = prepare_image(
            image_bytes
        )

        prediction = chest_model.predict(
            image_array,
            verbose=0,
        )

        abnormal_probability = float(
            prediction[0][0]
        )

        (
            result,
            confidence,
            needs_doctor_review,
        ) = get_prediction_result(
            abnormal_probability
        )

        confidence_percent = round(
            confidence * 100,
            2,
        )

        abnormal_percent = round(
            abnormal_probability * 100,
            2,
        )

        normal_percent = round(
            (1 - abnormal_probability) * 100,
            2,
        )

        if result == "UNCERTAIN":
            message = (
                "The AI result is uncertain. "
                "Doctor review is required."
            )

        elif result == "ABNORMAL":
            message = (
                "The image may contain an abnormal finding. "
                "Doctor review is required."
            )

        else:
            message = (
                "The image appears normal according to "
                "the preliminary AI analysis."
            )

        return {
            "success": True,
            "fileName": image.filename,
            "contentType": image.content_type,
            "width": width,
            "height": height,
            "bodyRegion": "CHEST",
            "result": result,
            "confidence": confidence_percent,
            "normalProbability": normal_percent,
            "abnormalProbability": abnormal_percent,
            "needsDoctorReview": needs_doctor_review,
            "message": message,
            "disclaimer": (
                "This is an AI preliminary result and "
                "does not replace diagnosis by a doctor."
            ),
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"Prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail="The chest X-ray analysis failed.",
        ) from error


# Optional second path for direct chest prediction
@app.post("/predict/chest")
async def predict_chest(
    image: UploadFile = File(...),
):
    return await classify_image(image)