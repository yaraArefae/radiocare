import json
import os
from io import BytesIO
from pathlib import Path
from typing import Any

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

CHEST_MODEL_PATH = (
    AI_SERVICE_DIR / "models" / "chest" / "chest_model.keras"
)

CHEST_FINDINGS_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
    / "chest_findings_model_v2.keras"
)

CHEST_FINDINGS_LABELS_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
    / "chest_findings_labels_v2.json"
)

CHEST_FINDINGS_THRESHOLDS_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest"
    / "chest_findings_thresholds_v2.json"
)

SHOULDER_FINE_TUNED_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder"
    / "shoulder_model_finetuned.keras"
)

SHOULDER_ORIGINAL_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder"
    / "shoulder_model.keras"
)

SHOULDER_THRESHOLD_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder"
    / "shoulder_threshold.json"
)

IMAGE_SIZE = (224, 224)

CHEST_NORMAL_THRESHOLD = 0.40
CHEST_ABNORMAL_THRESHOLD = 0.60

DEFAULT_SHOULDER_THRESHOLD = 0.50
SHOULDER_UNCERTAINTY_MARGIN = 0.08

SHOULDER_FRACTURE_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder_fracture"
    / "shoulder_fracture_model.keras"
)

SHOULDER_FRACTURE_THRESHOLD_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder_fracture"
    / "shoulder_fracture_threshold.json"
)

DEFAULT_SHOULDER_FRACTURE_THRESHOLD = 0.145
SHOULDER_FRACTURE_HIGH_THRESHOLD = 0.80
DEFAULT_FINDING_THRESHOLD = 0.50
FINDING_UNCERTAINTY_MARGIN = 0.10
ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}

MAX_FILE_SIZE = 20 * 1024 * 1024

EMERGENCY_CHEST_FINDINGS = {
    "Pneumothorax",
}

URGENT_CHEST_FINDINGS = {
    "Edema",
    "Consolidation",
    "Pneumonia",
    "Pleural Effusion",
}


# =========================================================
# FastAPI application
# =========================================================

app = FastAPI(
    title="RadioCare AI Service",
    version="3.0.0",
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
# Model variables
# =========================================================

chest_model = None
chest_findings_model = None
shoulder_model = None
shoulder_fracture_model = None

chest_model_loading_error = None
chest_findings_model_loading_error = None
shoulder_model_loading_error = None
shoulder_fracture_model_loading_error = None

chest_findings_labels: list[str] = []
chest_findings_thresholds: dict[str, float] = {}

shoulder_threshold = DEFAULT_SHOULDER_THRESHOLD
shoulder_model_file_name = None
shoulder_fracture_threshold = DEFAULT_SHOULDER_FRACTURE_THRESHOLD


# =========================================================
# JSON helpers
# =========================================================

def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(
            f"JSON file was not found: {path}"
        )

    data = json.loads(
        path.read_text(encoding="utf-8")
    )

    if not isinstance(data, dict):
        raise ValueError(
            f"JSON root must be an object: {path}"
        )

    return data


def load_chest_findings_metadata() -> tuple[
    list[str],
    dict[str, float],
]:
    labels_data = read_json_file(
        CHEST_FINDINGS_LABELS_PATH
    )

    thresholds_data = read_json_file(
        CHEST_FINDINGS_THRESHOLDS_PATH
    )

    labels = labels_data.get("labels")

    if not isinstance(labels, list) or not labels:
        raise ValueError(
            "Chest findings labels are missing or invalid."
        )

    clean_labels = [str(label) for label in labels]

    raw_thresholds = thresholds_data.get(
        "thresholds"
    )

    if not isinstance(raw_thresholds, dict):
        raise ValueError(
            "Chest findings thresholds are missing or invalid."
        )

    clean_thresholds: dict[str, float] = {}

    for label in clean_labels:
        value = float(
            raw_thresholds.get(
                label,
                DEFAULT_FINDING_THRESHOLD,
            )
        )

        if not 0.0 < value < 1.0:
            value = DEFAULT_FINDING_THRESHOLD

        clean_thresholds[label] = value

    return clean_labels, clean_thresholds


def load_shoulder_threshold() -> float:
    if not SHOULDER_THRESHOLD_PATH.exists():
        print(
            "Shoulder threshold file was not found. "
            "Using the default threshold."
        )
        return DEFAULT_SHOULDER_THRESHOLD

    try:
        threshold_data = read_json_file(
            SHOULDER_THRESHOLD_PATH
        )

        threshold_value = float(
            threshold_data.get(
                "threshold",
                DEFAULT_SHOULDER_THRESHOLD,
            )
        )

        if not 0 < threshold_value < 1:
            raise ValueError(
                "Shoulder threshold must be between 0 and 1."
            )

        print(
            "Shoulder threshold loaded successfully: "
            f"{threshold_value:.2f}"
        )

        return threshold_value

    except Exception as error:
        print(
            "Failed to load shoulder threshold. "
            "Using the default threshold."
        )
        print(f"Threshold error: {error}")

        return DEFAULT_SHOULDER_THRESHOLD


def load_shoulder_fracture_threshold() -> float:
    if not SHOULDER_FRACTURE_THRESHOLD_PATH.exists():
        print(
            "Shoulder fracture threshold file was not found. "
            "Using the default threshold."
        )
        return DEFAULT_SHOULDER_FRACTURE_THRESHOLD

    try:
        threshold_data = read_json_file(
            SHOULDER_FRACTURE_THRESHOLD_PATH
        )

        threshold_value = float(
            threshold_data.get(
                "threshold",
                DEFAULT_SHOULDER_FRACTURE_THRESHOLD,
            )
        )

        if not 0 < threshold_value < 1:
            raise ValueError(
                "Shoulder fracture threshold must be between 0 and 1."
            )

        print(
            "Shoulder fracture threshold loaded successfully: "
            f"{threshold_value:.3f}"
        )

        return threshold_value

    except Exception as error:
        print(
            "Failed to load shoulder fracture threshold. "
            "Using the default threshold."
        )
        print(f"Shoulder fracture threshold error: {error}")

        return DEFAULT_SHOULDER_FRACTURE_THRESHOLD


# =========================================================
# Load trained models
# =========================================================

try:
    if not CHEST_MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Chest model was not found at: {CHEST_MODEL_PATH}"
        )

    print("Loading chest X-ray triage model...")

    chest_model = tf.keras.models.load_model(
        CHEST_MODEL_PATH,
        compile=False,
    )

    print("Chest X-ray triage model loaded successfully.")

except Exception as error:
    chest_model_loading_error = str(error)

    print("Failed to load chest X-ray triage model.")
    print(
        "Chest triage model error: "
        f"{chest_model_loading_error}"
    )


try:
    if not CHEST_FINDINGS_MODEL_PATH.exists():
        raise FileNotFoundError(
            "Chest findings model was not found at: "
            f"{CHEST_FINDINGS_MODEL_PATH}"
        )

    print("Loading chest findings V2 model...")

    chest_findings_model = tf.keras.models.load_model(
        CHEST_FINDINGS_MODEL_PATH,
        compile=False,
    )

    (
        chest_findings_labels,
        chest_findings_thresholds,
    ) = load_chest_findings_metadata()

    model_output_size = int(
        chest_findings_model.output_shape[-1]
    )

    if model_output_size != len(chest_findings_labels):
        raise ValueError(
            "Chest findings output size does not match "
            "the labels file. "
            f"Model outputs: {model_output_size}, "
            f"labels: {len(chest_findings_labels)}"
        )

    print("Chest findings V2 model loaded successfully.")
    print(
        "Chest findings labels: "
        f"{', '.join(chest_findings_labels)}"
    )

except Exception as error:
    chest_findings_model_loading_error = str(error)

    chest_findings_model = None
    chest_findings_labels = []
    chest_findings_thresholds = {}

    print("Failed to load chest findings V2 model.")
    print(
        "Chest findings model error: "
        f"{chest_findings_model_loading_error}"
    )


try:
    # shoulder_model.keras is the selected final model produced by
    # the latest training run. Keep the old fine-tuned file only as
    # a fallback for backward compatibility.
    if SHOULDER_ORIGINAL_MODEL_PATH.exists():
        selected_shoulder_model_path = (
            SHOULDER_ORIGINAL_MODEL_PATH
        )

    elif SHOULDER_FINE_TUNED_MODEL_PATH.exists():
        selected_shoulder_model_path = (
            SHOULDER_FINE_TUNED_MODEL_PATH
        )

    else:
        raise FileNotFoundError(
            "No shoulder model was found. Checked:\n"
            f"{SHOULDER_FINE_TUNED_MODEL_PATH}\n"
            f"{SHOULDER_ORIGINAL_MODEL_PATH}"
        )

    print(
        "Loading shoulder X-ray model from:\n"
        f"{selected_shoulder_model_path}"
    )

    shoulder_model = tf.keras.models.load_model(
        selected_shoulder_model_path,
        compile=False,
    )

    shoulder_model_file_name = selected_shoulder_model_path.name
    shoulder_threshold = load_shoulder_threshold()

    print("Shoulder X-ray model loaded successfully.")
    

except Exception as error:
    shoulder_model_loading_error = str(error)

    print("Failed to load shoulder X-ray model.")
    print(
        f"Shoulder model error: {shoulder_model_loading_error}"
    )


try:
    if not SHOULDER_FRACTURE_MODEL_PATH.exists():
        raise FileNotFoundError(
            "Shoulder fracture model was not found at: "
            f"{SHOULDER_FRACTURE_MODEL_PATH}"
        )

    print(
        "Loading shoulder fracture model from:\n"
        f"{SHOULDER_FRACTURE_MODEL_PATH}"
    )

    shoulder_fracture_model = tf.keras.models.load_model(
        SHOULDER_FRACTURE_MODEL_PATH,
        compile=False,
    )

    shoulder_fracture_threshold = (
        load_shoulder_fracture_threshold()
    )

    print("Shoulder fracture model loaded successfully.")

except Exception as error:
    shoulder_fracture_model_loading_error = str(error)
    shoulder_fracture_model = None

    print("Failed to load shoulder fracture model.")
    print(
        "Shoulder fracture model error: "
        f"{shoulder_fracture_model_loading_error}"
    )


# =========================================================
# Image helpers
# =========================================================

async def validate_and_read_image(
    image: UploadFile,
) -> bytes:
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

    return image_bytes


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

    resized_image = pil_image.resize(IMAGE_SIZE)

    image_array = np.asarray(
        resized_image,
        dtype=np.float32,
    )

    image_array = np.expand_dims(
        image_array,
        axis=0,
    )

    return image_array, width, height


def predict_single_probability(
    model: tf.keras.Model,
    image_array: np.ndarray,
) -> float:
    prediction = model.predict(
        image_array,
        verbose=0,
    )

    probability = float(
        np.asarray(prediction).reshape(-1)[0]
    )

    return float(np.clip(probability, 0.0, 1.0))


def predict_findings_probabilities(
    image_array: np.ndarray,
) -> np.ndarray:
    if chest_findings_model is None:
        raise RuntimeError(
            "Chest findings model is not loaded."
        )

    prediction = chest_findings_model.predict(
        image_array,
        verbose=0,
    )

    probabilities = np.asarray(
        prediction,
        dtype=np.float32,
    ).reshape(-1)

    if len(probabilities) != len(chest_findings_labels):
        raise ValueError(
            "Unexpected chest findings output size."
        )

    return np.clip(probabilities, 0.0, 1.0)


# =========================================================
# Result helpers
# =========================================================

def get_chest_prediction_result(
    abnormal_probability: float,
) -> tuple[str, float, bool]:
    if abnormal_probability >= CHEST_ABNORMAL_THRESHOLD:
        return "ABNORMAL", abnormal_probability, True

    if abnormal_probability <= CHEST_NORMAL_THRESHOLD:
        return "NORMAL", 1 - abnormal_probability, False

    return (
        "UNCERTAIN",
        max(abnormal_probability, 1 - abnormal_probability),
        True,
    )


def get_shoulder_prediction_result(
    abnormal_probability: float,
) -> tuple[str, float, bool, float, float]:
    normal_limit = max(
        0.0,
        shoulder_threshold - SHOULDER_UNCERTAINTY_MARGIN,
    )

    abnormal_limit = min(
        1.0,
        shoulder_threshold + SHOULDER_UNCERTAINTY_MARGIN,
    )

    if abnormal_probability >= abnormal_limit:
        result = "ABNORMAL"
        confidence = abnormal_probability
        needs_doctor_review = True

    elif abnormal_probability <= normal_limit:
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

    return (
        result,
        confidence,
        needs_doctor_review,
        normal_limit,
        abnormal_limit,
    )


def get_shoulder_fracture_result(
    fracture_probability: float,
) -> tuple[str, bool]:
    if fracture_probability >= SHOULDER_FRACTURE_HIGH_THRESHOLD:
        return "POSSIBLE_FRACTURE", True

    if fracture_probability >= shoulder_fracture_threshold:
        return "UNCERTAIN_FRACTURE", True

    return "NO_FRACTURE_DETECTED", False


def create_result_message(
    result: str,
    body_region: str,
) -> str:
    region_name = (
        "chest" if body_region == "CHEST" else "shoulder"
    )

    if result == "UNCERTAIN":
        return (
            f"The AI result for the {region_name} X-ray "
            "is uncertain. Doctor review is required."
        )

    if result == "ABNORMAL":
        return (
            f"The {region_name} X-ray may contain "
            "an abnormal finding. Doctor review is required."
        )

    return (
        f"The {region_name} X-ray appears normal "
        "according to the preliminary AI analysis."
    )


def create_common_response(
    image: UploadFile,
    width: int,
    height: int,
    body_region: str,
    result: str,
    confidence: float,
    abnormal_probability: float,
    needs_doctor_review: bool,
) -> dict[str, Any]:
    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": body_region,
        "result": result,
        "confidence": round(confidence * 100, 2),
        "normalProbability": round(
            (1 - abnormal_probability) * 100,
            2,
        ),
        "abnormalProbability": round(
            abnormal_probability * 100,
            2,
        ),
        "needsDoctorReview": needs_doctor_review,
        "message": create_result_message(
            result,
            body_region,
        ),
        "disclaimer": (
            "This is an AI preliminary result and "
            "does not replace diagnosis by a doctor."
        ),
    }


def determine_chest_priority(
    detected_names: set[str],
) -> str:
    if detected_names & EMERGENCY_CHEST_FINDINGS:
        return "EMERGENCY"

    if detected_names & URGENT_CHEST_FINDINGS:
        return "URGENT"

    return "ROUTINE"


def build_chest_findings_response(
    image: UploadFile,
    width: int,
    height: int,
    probabilities: np.ndarray,
) -> dict[str, Any]:
    all_findings: list[dict[str, Any]] = []
    detected_findings: list[dict[str, Any]] = []
    near_threshold = False

    for label, raw_probability in zip(
        chest_findings_labels,
        probabilities,
    ):
        probability = float(raw_probability)
        threshold = float(
            chest_findings_thresholds.get(
                label,
                DEFAULT_FINDING_THRESHOLD,
            )
        )

        detected = probability >= threshold

        if abs(probability - threshold) <= FINDING_UNCERTAINTY_MARGIN:
            near_threshold = True

        item = {
            "name": label,
            "probability": round(probability * 100, 2),
            "threshold": round(threshold * 100, 2),
            "detected": detected,
        }

        all_findings.append(item)

        if detected:
            detected_findings.append(item)

    all_findings.sort(
        key=lambda item: item["probability"],
        reverse=True,
    )

    detected_findings.sort(
        key=lambda item: item["probability"],
        reverse=True,
    )

    if detected_findings:
        triage_result = "ABNORMAL"
        primary_finding = detected_findings[0]["name"]
        confidence = float(
            detected_findings[0]["probability"]
        )
        needs_doctor_review = True

    elif near_threshold:
        triage_result = "UNCERTAIN"
        primary_finding = None
        confidence = float(
            all_findings[0]["probability"]
            if all_findings
            else 0.0
        )
        needs_doctor_review = True

    else:
        triage_result = "NORMAL"
        primary_finding = None

        highest_abnormal_probability = float(
            all_findings[0]["probability"]
            if all_findings
            else 0.0
        )

        confidence = max(
            0.0,
            100.0 - highest_abnormal_probability,
        )
        needs_doctor_review = False

    detected_names = {
        str(item["name"])
        for item in detected_findings
    }

    priority = determine_chest_priority(
        detected_names
    )

    if triage_result == "ABNORMAL":
        message = (
            "The AI detected one or more possible chest "
            "findings. Doctor review is required."
        )

    elif triage_result == "UNCERTAIN":
        message = (
            "No finding clearly exceeded its decision "
            "threshold, but one or more results were close. "
            "Doctor review is required."
        )

    else:
        message = (
            "No supported chest finding exceeded its "
            "decision threshold in this preliminary analysis."
        )

    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": "CHEST",
        "result": triage_result,
        "triageResult": triage_result,
        "confidence": round(confidence, 2),
        "primaryFinding": primary_finding,
        "possibleFindings": detected_findings,
        "allFindings": all_findings,
        "priority": priority,
        "detectedClinic": "chest",
        "needsDoctorReview": needs_doctor_review,
        "message": message,
        "modelName": CHEST_FINDINGS_MODEL_PATH.name,
        "modelVersion": "2.0",
        "disclaimer": (
            "These are preliminary AI findings from a "
            "limited supported label set. They do not replace "
            "a radiologist's interpretation or a doctor's "
            "final diagnosis."
        ),
    }


# =========================================================
# General routes
# =========================================================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "RadioCare AI service is running.",
        "version": "3.0.0",
        "models": {
            "chestTriage": {
                "loaded": chest_model is not None,
                "file": CHEST_MODEL_PATH.name,
            },
            "chestFindings": {
                "loaded": chest_findings_model is not None,
                "file": CHEST_FINDINGS_MODEL_PATH.name,
                "labels": chest_findings_labels,
            },
            "shoulder": {
                "loaded": shoulder_model is not None,
                "file": shoulder_model_file_name,
                "threshold": shoulder_threshold,
            },
            "shoulderFracture": {
                "loaded": shoulder_fracture_model is not None,
                "file": SHOULDER_FRACTURE_MODEL_PATH.name,
                "threshold": shoulder_fracture_threshold,
                "highThreshold": SHOULDER_FRACTURE_HIGH_THRESHOLD,
            },
        },
    }


@app.get("/health")
def health_check():
    model_states = {
        "chestTriage": chest_model is not None,
        "chestFindings": chest_findings_model is not None,
        "shoulder": shoulder_model is not None,
        "shoulderFracture": shoulder_fracture_model is not None,
    }

    loaded_count = sum(
        1
        for loaded in model_states.values()
        if loaded
    )

    if loaded_count == len(model_states):
        status = "healthy"
    elif loaded_count > 0:
        status = "degraded"
    else:
        status = "model-not-loaded"

    return {
        "success": loaded_count > 0,
        "status": status,
        "service": "radiocare-ai-service",
        "models": {
            "chestTriage": {
                "loaded": model_states["chestTriage"],
                "error": chest_model_loading_error,
                "normalThreshold": CHEST_NORMAL_THRESHOLD,
                "abnormalThreshold": CHEST_ABNORMAL_THRESHOLD,
            },
            "chestFindings": {
                "loaded": model_states["chestFindings"],
                "error": chest_findings_model_loading_error,
                "file": CHEST_FINDINGS_MODEL_PATH.name,
                "labels": chest_findings_labels,
                "thresholds": chest_findings_thresholds,
            },
            "shoulder": {
                "loaded": model_states["shoulder"],
                "error": shoulder_model_loading_error,
                "file": shoulder_model_file_name,
                "threshold": shoulder_threshold,
            },
            "shoulderFracture": {
                "loaded": model_states["shoulderFracture"],
                "error": shoulder_fracture_model_loading_error,
                "file": SHOULDER_FRACTURE_MODEL_PATH.name,
                "threshold": shoulder_fracture_threshold,
                "highThreshold": SHOULDER_FRACTURE_HIGH_THRESHOLD,
            },
        },
    }


# =========================================================
# Old chest triage prediction
# =========================================================

@app.post("/predict/chest")
async def predict_chest(
    image: UploadFile = File(...),
):
    if chest_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "The chest X-ray triage model is not available. "
                f"{chest_model_loading_error or ''}"
            ),
        )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(
            image_bytes
        )

        abnormal_probability = predict_single_probability(
            chest_model,
            image_array,
        )

        (
            result,
            confidence,
            needs_doctor_review,
        ) = get_chest_prediction_result(
            abnormal_probability
        )

        response = create_common_response(
            image=image,
            width=width,
            height=height,
            body_region="CHEST",
            result=result,
            confidence=confidence,
            abnormal_probability=abnormal_probability,
            needs_doctor_review=needs_doctor_review,
        )

        response["modelName"] = CHEST_MODEL_PATH.name
        response["normalDecisionLimit"] = CHEST_NORMAL_THRESHOLD
        response["abnormalDecisionLimit"] = CHEST_ABNORMAL_THRESHOLD

        return response

    except HTTPException:
        raise

    except Exception as error:
        print(f"Chest triage prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail="The chest X-ray triage analysis failed.",
        ) from error


@app.post("/classify")
async def classify_image(
    image: UploadFile = File(...),
):
    return await predict_chest(image)


# =========================================================
# New multi-label chest findings prediction
# =========================================================

@app.post("/predict/chest/findings")
async def predict_chest_findings(
    image: UploadFile = File(...),
):
    if chest_findings_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "The chest findings model is not available. "
                f"{chest_findings_model_loading_error or ''}"
            ),
        )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(
            image_bytes
        )

        probabilities = predict_findings_probabilities(
            image_array
        )

        return build_chest_findings_response(
            image=image,
            width=width,
            height=height,
            probabilities=probabilities,
        )

    except HTTPException:
        raise

    except Exception as error:
        print(
            "Chest findings prediction error: "
            f"{error}"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "The multi-label chest X-ray analysis failed."
            ),
        ) from error


# =========================================================
# Shoulder prediction
# =========================================================

@app.post("/predict/shoulder")
async def predict_shoulder(
    image: UploadFile = File(...),
):
    if shoulder_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "The shoulder X-ray model is not available. "
                f"{shoulder_model_loading_error or ''}"
            ),
        )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(
            image_bytes
        )

        abnormal_probability = predict_single_probability(
            shoulder_model,
            image_array,
        )

        (
            result,
            confidence,
            needs_doctor_review,
            normal_limit,
            abnormal_limit,
        ) = get_shoulder_prediction_result(
            abnormal_probability
        )

        response = create_common_response(
            image=image,
            width=width,
            height=height,
            body_region="SHOULDER",
            result=result,
            confidence=confidence,
            abnormal_probability=abnormal_probability,
            needs_doctor_review=needs_doctor_review,
        )

        response["modelName"] = shoulder_model_file_name
        response["decisionThreshold"] = round(
            shoulder_threshold,
            4,
        )
        response["normalDecisionLimit"] = round(
            normal_limit,
            4,
        )
        response["abnormalDecisionLimit"] = round(
            abnormal_limit,
            4,
        )

        # Run the specialized fracture model as an additional,
        # preliminary shoulder finding. It never represents a final
        # diagnosis; positive results always require doctor review.
        if shoulder_fracture_model is not None:
            fracture_probability = predict_single_probability(
                shoulder_fracture_model,
                image_array,
            )

            (
                fracture_finding,
                fracture_needs_review,
            ) = get_shoulder_fracture_result(
                fracture_probability
            )

            possible_fracture = (
                fracture_finding == "POSSIBLE_FRACTURE"
            )
            uncertain_fracture = (
                fracture_finding == "UNCERTAIN_FRACTURE"
            )

            if possible_fracture:
                finding_name = "Possible Shoulder Fracture"
            elif uncertain_fracture:
                finding_name = "Uncertain Shoulder Fracture Finding"
            else:
                finding_name = "No Shoulder Fracture Detected"

            fracture_item = {
                "name": finding_name,
                "code": fracture_finding,
                "probability": round(
                    fracture_probability * 100,
                    2,
                ),
                "threshold": round(
                    shoulder_fracture_threshold * 100,
                    2,
                ),
                "highThreshold": round(
                    SHOULDER_FRACTURE_HIGH_THRESHOLD * 100,
                    2,
                ),
                "detected": possible_fracture,
                "needsReview": fracture_needs_review,
            }

            response["fractureModelAvailable"] = True
            response["fractureModelName"] = (
                SHOULDER_FRACTURE_MODEL_PATH.name
            )
            response["fractureFinding"] = fracture_finding
            response["fractureProbability"] = round(
                fracture_probability * 100,
                2,
            )
            response["fractureProbabilityRaw"] = round(
                fracture_probability,
                4,
            )
            response["fractureThreshold"] = round(
                shoulder_fracture_threshold * 100,
                2,
            )
            response["fractureThresholdRaw"] = round(
                shoulder_fracture_threshold,
                4,
            )
            response["fractureHighThreshold"] = round(
                SHOULDER_FRACTURE_HIGH_THRESHOLD * 100,
                2,
            )
            response["fractureHighThresholdRaw"] = round(
                SHOULDER_FRACTURE_HIGH_THRESHOLD,
                4,
            )
            response["possibleFindings"] = (
                [fracture_item]
                if fracture_needs_review
                else []
            )
            response["allFindings"] = [fracture_item]

            if possible_fracture:
                response["primaryFinding"] = (
                    "Possible shoulder fracture"
                )
                response["needsDoctorReview"] = True
                response["priority"] = "NEEDS_REVIEW"
                response["detectedClinic"] = "orthopedic"

                # A high fracture probability is still preliminary, so
                # never present it as a confirmed diagnosis.
                response["result"] = "UNCERTAIN"
                response["triageResult"] = "UNCERTAIN"
                response["confidence"] = round(
                    fracture_probability * 100,
                    2,
                )
                response["message"] = (
                    "A possible shoulder fracture was detected by "
                    "the preliminary AI model. Doctor review is "
                    "required."
                )

            elif uncertain_fracture:
                response["primaryFinding"] = (
                    "Uncertain fracture finding"
                )
                response["needsDoctorReview"] = True
                response["priority"] = "NEEDS_REVIEW"
                response["detectedClinic"] = "orthopedic"

                if response.get("result") == "NORMAL":
                    response["result"] = "UNCERTAIN"

                response["triageResult"] = response["result"]
                response["confidence"] = round(
                    fracture_probability * 100,
                    2,
                )
                response["message"] = (
                    "The fracture result is uncertain. "
                    "Doctor review is required."
                )

            else:
                response["primaryFinding"] = None
                response["priority"] = (
                    "NEEDS_REVIEW"
                    if response["needsDoctorReview"]
                    else "ROUTINE"
                )
                response["detectedClinic"] = "orthopedic"
                response["triageResult"] = response["result"]

        else:
            response["fractureModelAvailable"] = False
            response["fractureFinding"] = "MODEL_NOT_AVAILABLE"
            response["fractureModelError"] = (
                shoulder_fracture_model_loading_error
            )
            response["priority"] = (
                "NEEDS_REVIEW"
                if response["needsDoctorReview"]
                else "ROUTINE"
            )
            response["detectedClinic"] = "orthopedic"

        return response

    except HTTPException:
        raise

    except Exception as error:
        print(f"Shoulder prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail="The shoulder X-ray analysis failed.",
        ) from error