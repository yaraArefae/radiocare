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

WRIST_PEDIATRIC_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "wrist_pediatric_findings"
    / "wrist_pediatric_findings_model.keras"
)

WRIST_PEDIATRIC_THRESHOLDS_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "wrist_pediatric_findings"
    / "wrist_pediatric_findings_thresholds.json"
)

WRIST_PEDIATRIC_LABEL_INFO = {
    "fracture_visible": {
        "name": "Possible Fracture",
        "code": "POSSIBLE_FRACTURE",
        "clinicalPriority": 1,
    },
    "osteopenia": {
        "name": "Possible Osteopenia",
        "code": "POSSIBLE_OSTEOPENIA",
        "clinicalPriority": 2,
    },
    "metal": {
        "name": "Metal or Fixation Hardware",
        "code": "METAL_DETECTED",
        "clinicalPriority": 3,
    },
    "cast": {
        "name": "Cast Detected",
        "code": "CAST_DETECTED",
        "clinicalPriority": 4,
    },
}

"""
Hand and wrist share one upper limb pathway in the application, so they
also share one prediction endpoint.

The pediatric wrist findings model is the engine that is available today.
Dropping a dedicated hand and wrist model into

    models/hand_wrist_findings/hand_wrist_findings_model.keras
    models/hand_wrist_findings/hand_wrist_findings_thresholds.json

switches the endpoint over to it automatically, without a code change.
The thresholds file uses the same shape as the wrist one:

    {"labels": ["fracture_visible", ...],
     "thresholds": {"fracture_visible": 0.31, ...}}
"""

HAND_WRIST_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_wrist_findings"
    / "hand_wrist_findings_model.keras"
)

HAND_WRIST_THRESHOLDS_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_wrist_findings"
    / "hand_wrist_findings_thresholds.json"
)

"""
Display names for the labels a hand or wrist model may produce. Labels
that are not listed still work: the endpoint builds a readable name from
the label itself and places it after the known findings.
"""
HAND_WRIST_LABEL_INFO = {
    **WRIST_PEDIATRIC_LABEL_INFO,
    "soft_tissue_swelling": {
        "name": "Soft Tissue Swelling",
        "code": "SOFT_TISSUE_SWELLING",
        "clinicalPriority": 3,
    },
    "bone_lesion": {
        "name": "Possible Bone Lesion",
        "code": "POSSIBLE_BONE_LESION",
        "clinicalPriority": 1,
    },
    "joint_space_narrowing": {
        "name": "Joint Space Narrowing",
        "code": "JOINT_SPACE_NARROWING",
        "clinicalPriority": 2,
    },
    "erosion": {
        "name": "Possible Bone Erosion",
        "code": "POSSIBLE_EROSION",
        "clinicalPriority": 2,
    },
    "dislocation": {
        "name": "Possible Dislocation",
        "code": "POSSIBLE_DISLOCATION",
        "clinicalPriority": 1,
    },
}

URGENT_UPPER_LIMB_CODES = {
    "POSSIBLE_FRACTURE",
    "POSSIBLE_DISLOCATION",
    "POSSIBLE_BONE_LESION",
}

"""
Registry of the remaining body regions.

Every region is reachable from the application today through
/predict/region/{region}. A region without a trained model returns a
NOT_ANALYZED result, which sends the image straight to the specialist
doctor instead of showing an invented AI finding.

Installing a model activates the AI for that region without a code
change. Drop the two files into the folder of the region:

    models/<folder>/<folder>_model.keras
    models/<folder>/<folder>_thresholds.json

and the thresholds file follows the same shape as the wrist one:

    {"labels": ["fracture_visible", ...],
     "thresholds": {"fracture_visible": 0.31, ...}}
"""
REGION_MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    "head": {
        "displayName": "Head & Skull",
        "bodyRegion": "HEAD_SKULL",
        "clinic": "neuro",
        "folder": "head_skull_findings",
    },
    "spine": {
        "displayName": "Spine",
        "bodyRegion": "SPINE",
        "clinic": "spine",
        "folder": "spine_findings",
    },
    "pelvis": {
        "displayName": "Pelvis & Hip",
        "bodyRegion": "PELVIS_HIP",
        "clinic": "orthopedic",
        "folder": "pelvis_hip_findings",
    },
    "lower-limb": {
        "displayName": "Lower Limb",
        "bodyRegion": "LOWER_LIMB",
        "clinic": "orthopedic",
        "folder": "lower_limb_findings",
    },
    # Not a body region of its own: the shared fracture model is reached
    # through this entry so it uses the same loading and caching path.
    "fracture": {
        "displayName": "Fracture",
        "bodyRegion": "FRACTURE",
        "clinic": "orthopedic",
        "folder": "fracture_findings",
    },
}

"""
Display names for labels the regional models may produce. Any label that
is not listed still works and gets a readable name automatically.
"""
REGION_LABEL_INFO = {
    **HAND_WRIST_LABEL_INFO,
    "degenerative_changes": {
        "name": "Degenerative Changes",
        "code": "DEGENERATIVE_CHANGES",
        "clinicalPriority": 3,
    },
    "scoliosis": {
        "name": "Possible Scoliosis",
        "code": "POSSIBLE_SCOLIOSIS",
        "clinicalPriority": 2,
    },
    "loss_of_lordosis": {
        "name": "Loss of Cervical Lordosis",
        "code": "LOSS_OF_LORDOSIS",
        "clinicalPriority": 3,
    },
    "sigmoid_curvature": {
        "name": "Sigmoid Cervical Curvature",
        "code": "SIGMOID_CURVATURE",
        "clinicalPriority": 3,
    },
    "cervical_kyphosis": {
        "name": "Cervical Kyphosis",
        "code": "CERVICAL_KYPHOSIS",
        "clinicalPriority": 2,
    },
    "vertebral_compression": {
        "name": "Possible Vertebral Compression",
        "code": "POSSIBLE_VERTEBRAL_COMPRESSION",
        "clinicalPriority": 1,
    },
    "skull_fracture": {
        "name": "Possible Skull Fracture",
        "code": "POSSIBLE_FRACTURE",
        "clinicalPriority": 1,
    },
    "effusion": {
        "name": "Joint Effusion",
        "code": "JOINT_EFFUSION",
        "clinicalPriority": 2,
    },
    "benign_lesion": {
        "name": "Likely Benign Bone Lesion",
        "code": "BENIGN_BONE_LESION",
        "clinicalPriority": 3,
    },
    "malignant_lesion": {
        "name": "Suspicious for Malignant Bone Lesion",
        "code": "MALIGNANT_BONE_LESION",
        "clinicalPriority": 1,
    },
}

"""
Findings that must reach the doctor as an urgent case.
"""
URGENT_REGION_CODES = URGENT_UPPER_LIMB_CODES | {
    "MALIGNANT_BONE_LESION",
}

"""
The shared fracture model.

A region model is trained on one kind of finding: bone tumours for the
lower limb, curvature for the spine. A fracture is the finding a doctor
must never miss, so every bone region runs this model as well and its
result is merged into the same findings list.
"""
SHARED_FRACTURE_REGIONS = {
    "pelvis",
    "lower-limb",
}

"""
Loaded regional models, filled on the first request of each region.
"""
region_model_cache: dict[str, dict[str, Any]] = {}

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
    version="3.1.0",
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
wrist_pediatric_model = None

chest_model_loading_error = None
chest_findings_model_loading_error = None
shoulder_model_loading_error = None
shoulder_fracture_model_loading_error = None
wrist_pediatric_model_loading_error = None

chest_findings_labels: list[str] = []
chest_findings_thresholds: dict[str, float] = {}
wrist_pediatric_labels: list[str] = []
wrist_pediatric_thresholds: dict[str, float] = {}

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


def load_wrist_pediatric_metadata() -> tuple[
    list[str],
    dict[str, float],
]:
    metadata = read_json_file(
        WRIST_PEDIATRIC_THRESHOLDS_PATH
    )

    raw_labels = metadata.get("labels")
    raw_thresholds = metadata.get("thresholds")

    if not isinstance(raw_labels, list) or not raw_labels:
        raise ValueError(
            "Pediatric wrist labels are missing or invalid."
        )

    if not isinstance(raw_thresholds, dict):
        raise ValueError(
            "Pediatric wrist thresholds are missing or invalid."
        )

    clean_labels = [str(label) for label in raw_labels]
    clean_thresholds: dict[str, float] = {}

    for label in clean_labels:
        if label not in WRIST_PEDIATRIC_LABEL_INFO:
            raise ValueError(
                "Unsupported pediatric wrist label: "
                f"{label}"
            )

        threshold = float(
            raw_thresholds.get(
                label,
                DEFAULT_FINDING_THRESHOLD,
            )
        )

        if not 0.0 < threshold < 1.0:
            threshold = DEFAULT_FINDING_THRESHOLD

        clean_thresholds[label] = threshold

    return clean_labels, clean_thresholds


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


try:
    if not WRIST_PEDIATRIC_MODEL_PATH.exists():
        raise FileNotFoundError(
            "Pediatric wrist findings model was not found at: "
            f"{WRIST_PEDIATRIC_MODEL_PATH}"
        )

    if not WRIST_PEDIATRIC_THRESHOLDS_PATH.exists():
        raise FileNotFoundError(
            "Pediatric wrist thresholds file was not found at: "
            f"{WRIST_PEDIATRIC_THRESHOLDS_PATH}"
        )

    print(
        "Loading pediatric wrist findings model from:\n"
        f"{WRIST_PEDIATRIC_MODEL_PATH}"
    )

    wrist_pediatric_model = tf.keras.models.load_model(
        WRIST_PEDIATRIC_MODEL_PATH,
        compile=False,
    )

    (
        wrist_pediatric_labels,
        wrist_pediatric_thresholds,
    ) = load_wrist_pediatric_metadata()

    wrist_output_size = int(
        wrist_pediatric_model.output_shape[-1]
    )

    if wrist_output_size != len(wrist_pediatric_labels):
        raise ValueError(
            "Pediatric wrist model output size does not match "
            "the thresholds file. "
            f"Model outputs: {wrist_output_size}, "
            f"labels: {len(wrist_pediatric_labels)}"
        )

    print("Pediatric wrist findings model loaded successfully.")
    print(
        "Pediatric wrist labels: "
        f"{', '.join(wrist_pediatric_labels)}"
    )

except Exception as error:
    wrist_pediatric_model_loading_error = str(error)
    wrist_pediatric_model = None
    wrist_pediatric_labels = []
    wrist_pediatric_thresholds = {}

    print("Failed to load pediatric wrist findings model.")
    print(
        "Pediatric wrist model error: "
        f"{wrist_pediatric_model_loading_error}"
    )


"""
The dedicated hand and wrist model is optional. When it is missing the
upper limb endpoint keeps working with the pediatric wrist model.
"""
hand_wrist_model = None
hand_wrist_labels: list[str] = []
hand_wrist_thresholds: dict[str, float] = {}
hand_wrist_model_loading_error = ""

try:
    if (
        HAND_WRIST_MODEL_PATH.exists()
        and HAND_WRIST_THRESHOLDS_PATH.exists()
    ):
        print(
            "Loading hand and wrist findings model from:\n"
            f"{HAND_WRIST_MODEL_PATH}"
        )

        hand_wrist_model = tf.keras.models.load_model(
            HAND_WRIST_MODEL_PATH,
            compile=False,
        )

        hand_wrist_metadata = read_json_file(
            HAND_WRIST_THRESHOLDS_PATH
        )

        raw_hand_labels = hand_wrist_metadata.get("labels")
        raw_hand_thresholds = hand_wrist_metadata.get(
            "thresholds",
            {},
        )

        if (
            not isinstance(raw_hand_labels, list)
            or not raw_hand_labels
        ):
            raise ValueError(
                "Hand and wrist labels are missing or invalid."
            )

        hand_wrist_labels = [
            str(label) for label in raw_hand_labels
        ]

        for label in hand_wrist_labels:
            threshold = float(
                raw_hand_thresholds.get(
                    label,
                    DEFAULT_FINDING_THRESHOLD,
                )
                if isinstance(raw_hand_thresholds, dict)
                else DEFAULT_FINDING_THRESHOLD
            )

            if not 0.0 < threshold < 1.0:
                threshold = DEFAULT_FINDING_THRESHOLD

            hand_wrist_thresholds[label] = threshold

        hand_output_size = int(
            hand_wrist_model.output_shape[-1]
        )

        if hand_output_size != len(hand_wrist_labels):
            raise ValueError(
                "Hand and wrist model output size does not "
                "match the thresholds file. "
                f"Model outputs: {hand_output_size}, "
                f"labels: {len(hand_wrist_labels)}"
            )

        print(
            "Hand and wrist findings model loaded successfully."
        )
        print(
            "Hand and wrist labels: "
            f"{', '.join(hand_wrist_labels)}"
        )
    else:
        print(
            "No dedicated hand and wrist model found. The upper "
            "limb endpoint uses the pediatric wrist model."
        )

except Exception as error:
    hand_wrist_model_loading_error = str(error)
    hand_wrist_model = None
    hand_wrist_labels = []
    hand_wrist_thresholds = {}

    print("Failed to load the hand and wrist findings model.")
    print(
        "Hand and wrist model error: "
        f"{hand_wrist_model_loading_error}"
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


def predict_wrist_pediatric_probabilities(
    image_array: np.ndarray,
) -> np.ndarray:
    if wrist_pediatric_model is None:
        raise RuntimeError(
            "Pediatric wrist findings model is not loaded."
        )

    wrist_image_array = np.array(
        image_array,
        dtype=np.float32,
        copy=True,
    )

    wrist_image_array = (
        tf.keras.applications.mobilenet_v2.preprocess_input(
            wrist_image_array
        )
    )

    prediction = wrist_pediatric_model.predict(
        wrist_image_array,
        verbose=0,
    )

    probabilities = np.asarray(
        prediction,
        dtype=np.float32,
    ).reshape(-1)

    if len(probabilities) != len(wrist_pediatric_labels):
        raise ValueError(
            "Unexpected pediatric wrist findings output size."
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


def build_wrist_pediatric_response(
    image: UploadFile,
    width: int,
    height: int,
    probabilities: np.ndarray,
) -> dict[str, Any]:
    all_findings: list[dict[str, Any]] = []
    detected_findings: list[dict[str, Any]] = []
    near_threshold = False

    for label, raw_probability in zip(
        wrist_pediatric_labels,
        probabilities,
    ):
        probability = float(raw_probability)
        threshold = float(
            wrist_pediatric_thresholds.get(
                label,
                DEFAULT_FINDING_THRESHOLD,
            )
        )

        detected = probability >= threshold

        if (
            not detected
            and abs(probability - threshold)
            <= FINDING_UNCERTAINTY_MARGIN
        ):
            near_threshold = True

        label_info = WRIST_PEDIATRIC_LABEL_INFO[label]

        item = {
            "name": str(label_info["name"]),
            "code": str(label_info["code"]),
            "label": label,
            "probability": round(probability * 100, 2),
            "probabilityRaw": round(probability, 6),
            "threshold": round(threshold * 100, 2),
            "thresholdRaw": round(threshold, 6),
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
        key=lambda item: (
            WRIST_PEDIATRIC_LABEL_INFO[
                str(item["label"])
            ]["clinicalPriority"],
            -float(item["probability"]),
        )
    )

    detected_codes = {
        str(item["code"])
        for item in detected_findings
    }

    if detected_findings:
        result = "ABNORMAL"
        primary_finding = detected_findings[0]["name"]
        confidence = float(
            detected_findings[0]["probability"]
        )
        needs_doctor_review = True

        if "POSSIBLE_FRACTURE" in detected_codes:
            priority = "URGENT"
            message = (
                "A possible pediatric wrist fracture was detected. "
                "Orthopedic doctor review is required."
            )
        elif "POSSIBLE_OSTEOPENIA" in detected_codes:
            priority = "NEEDS_REVIEW"
            message = (
                "Possible osteopenia-related changes were detected "
                "in the pediatric wrist X-ray. Doctor review is "
                "required."
            )
        else:
            priority = "NEEDS_REVIEW"
            message = (
                "One or more supported pediatric wrist findings "
                "were detected. Doctor review is required."
            )

    elif near_threshold:
        result = "UNCERTAIN"
        primary_finding = None
        confidence = float(
            all_findings[0]["probability"]
            if all_findings
            else 0.0
        )
        needs_doctor_review = True
        priority = "NEEDS_REVIEW"
        message = (
            "No pediatric wrist finding clearly exceeded its "
            "decision threshold, but at least one result was close. "
            "Doctor review is required."
        )

    else:
        result = "NORMAL"
        primary_finding = None
        highest_probability = float(
            all_findings[0]["probability"]
            if all_findings
            else 0.0
        )
        confidence = max(0.0, 100.0 - highest_probability)
        needs_doctor_review = False
        priority = "ROUTINE"
        message = (
            "No supported pediatric wrist finding exceeded its "
            "decision threshold in this preliminary analysis."
        )

    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": "WRIST",
        "ageGroup": "PEDIATRIC",
        "result": result,
        "triageResult": result,
        "confidence": round(confidence, 2),
        "primaryFinding": primary_finding,
        "possibleFindings": detected_findings,
        "allFindings": all_findings,
        "noSupportedFindingDetected": not detected_findings,
        "priority": priority,
        "detectedClinic": "orthopedic",
        "needsDoctorReview": needs_doctor_review,
        "message": message,
        "modelName": WRIST_PEDIATRIC_MODEL_PATH.name,
        "modelVersion": "1.0",
        "supportedLabels": wrist_pediatric_labels,
        "disclaimer": (
            "These are preliminary AI findings for pediatric wrist "
            "radiographs and a limited supported label set. They do "
            "not replace a radiologist's interpretation or a "
            "doctor's final diagnosis."
        ),
    }


def describe_upper_limb_label(label: str) -> dict[str, Any]:
    """
    Returns the display information of a hand or wrist label. Labels the
    application does not know yet still get a readable name, so a newly
    trained model works without editing this file.
    """
    known = HAND_WRIST_LABEL_INFO.get(label)

    if known:
        return dict(known)

    return {
        "name": label.replace("_", " ").title(),
        "code": label.upper(),
        "clinicalPriority": 5,
    }


def build_upper_limb_response(
    image: UploadFile,
    width: int,
    height: int,
    probabilities: np.ndarray,
    labels: list[str],
    thresholds: dict[str, float],
    model_name: str,
    model_scope: str,
) -> dict[str, Any]:
    """
    Shared response builder for the hand and wrist pathway. It keeps the
    same payload shape the chest and shoulder endpoints return, so the
    application does not need a special case per body region.
    """
    all_findings: list[dict[str, Any]] = []
    detected_findings: list[dict[str, Any]] = []
    near_threshold = False

    for label, raw_probability in zip(labels, probabilities):
        probability = float(raw_probability)
        threshold = float(
            thresholds.get(label, DEFAULT_FINDING_THRESHOLD)
        )

        detected = probability >= threshold

        if (
            not detected
            and abs(probability - threshold)
            <= FINDING_UNCERTAINTY_MARGIN
        ):
            near_threshold = True

        label_info = describe_upper_limb_label(label)

        item = {
            "name": str(label_info["name"]),
            "code": str(label_info["code"]),
            "label": label,
            "probability": round(probability * 100, 2),
            "probabilityRaw": round(probability, 6),
            "threshold": round(threshold * 100, 2),
            "thresholdRaw": round(threshold, 6),
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
        key=lambda item: (
            describe_upper_limb_label(str(item["label"]))[
                "clinicalPriority"
            ],
            -float(item["probability"]),
        )
    )

    detected_codes = {
        str(item["code"]) for item in detected_findings
    }

    if detected_findings:
        result = "ABNORMAL"
        primary_finding = detected_findings[0]["name"]
        confidence = float(detected_findings[0]["probability"])
        needs_doctor_review = True

        if detected_codes & URGENT_UPPER_LIMB_CODES:
            priority = "URGENT"
            message = (
                f"{primary_finding} was detected in the hand or "
                "wrist X-ray. Orthopedic doctor review is required."
            )
        else:
            priority = "NEEDS_REVIEW"
            message = (
                f"{primary_finding} was detected in the hand or "
                "wrist X-ray. Doctor review is required."
            )

    elif near_threshold:
        result = "UNCERTAIN"
        primary_finding = None
        confidence = float(
            all_findings[0]["probability"] if all_findings else 0.0
        )
        needs_doctor_review = True
        priority = "NEEDS_REVIEW"
        message = (
            "No hand or wrist finding clearly exceeded its decision "
            "threshold, but at least one result was close. Doctor "
            "review is required."
        )

    else:
        result = "NORMAL"
        primary_finding = None
        highest_probability = float(
            all_findings[0]["probability"] if all_findings else 0.0
        )
        confidence = max(0.0, 100.0 - highest_probability)
        needs_doctor_review = False
        priority = "ROUTINE"
        message = (
            "No supported hand or wrist finding exceeded its "
            "decision threshold in this preliminary analysis."
        )

    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": "HAND_WRIST",
        "result": result,
        "triageResult": result,
        "confidence": round(confidence, 2),
        "primaryFinding": primary_finding,
        "possibleFindings": detected_findings,
        "allFindings": all_findings,
        "noSupportedFindingDetected": not detected_findings,
        "priority": priority,
        "detectedClinic": "orthopedic",
        "needsDoctorReview": needs_doctor_review,
        "message": message,
        "modelName": model_name,
        "modelVersion": "1.0",
        "modelScope": model_scope,
        "supportedLabels": labels,
        "disclaimer": (
            "These are preliminary AI findings for hand and wrist "
            "radiographs with a limited supported label set. They do "
            "not replace a radiologist's interpretation or a "
            "doctor's final diagnosis."
        ),
    }


@app.post("/predict/hand-wrist")
async def predict_hand_wrist(
    image: UploadFile = File(...),
):
    """
    One endpoint for the whole hand and wrist pathway. It uses the
    dedicated hand and wrist model when it is installed, and otherwise
    falls back to the pediatric wrist findings model.
    """
    use_hand_model = hand_wrist_model is not None

    active_model = (
        hand_wrist_model if use_hand_model else wrist_pediatric_model
    )

    if active_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "No hand or wrist model is available. "
                f"{wrist_pediatric_model_loading_error or ''} "
                f"{hand_wrist_model_loading_error or ''}"
            ).strip(),
        )

    labels = (
        hand_wrist_labels if use_hand_model else wrist_pediatric_labels
    )

    thresholds = (
        hand_wrist_thresholds
        if use_hand_model
        else wrist_pediatric_thresholds
    )

    model_name = (
        HAND_WRIST_MODEL_PATH.name
        if use_hand_model
        else WRIST_PEDIATRIC_MODEL_PATH.name
    )

    model_scope = (
        "HAND_AND_WRIST"
        if use_hand_model
        else "PEDIATRIC_WRIST"
    )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(image_bytes)

        model_input = np.array(
            image_array,
            dtype=np.float32,
            copy=True,
        )

        model_input = (
            tf.keras.applications.mobilenet_v2.preprocess_input(
                model_input
            )
        )

        prediction = active_model.predict(
            model_input,
            verbose=0,
        )

        probabilities = np.array(prediction[0], dtype=np.float32)

        return build_upper_limb_response(
            image=image,
            width=width,
            height=height,
            probabilities=probabilities,
            labels=labels,
            thresholds=thresholds,
            model_name=model_name,
            model_scope=model_scope,
        )

    except HTTPException:
        raise

    except Exception as error:
        print(f"Hand and wrist prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail="The hand and wrist X-ray analysis failed.",
        ) from error


"""
Which clinic of the application each model belongs to, and where its
measured quality comes from.

The readiness of a clinic is never written by hand: it is derived from
the test metrics the training run produced. A clinic whose model is
missing, or whose measured quality is too low to show to a patient,
stays a doctor only clinic.
"""
CLINIC_CAPABILITIES: list[dict[str, Any]] = [
    {
        "slug": "chest",
        "name": "Chest Clinic",
        "regions": ["Chest"],
        "metricsFile": "chest/chest_findings_thresholds_v2.json",
        "metricsFormat": "chest",
        "modelFile": "chest/chest_findings_model_v2.keras",
        "dataset": "CheXpert derived chest set",
        "trainingImages": 624,
    },
    {
        "slug": "shoulder",
        "name": "Shoulder Clinic",
        "regions": ["Shoulder"],
        "metricsFile": "shoulder/shoulder_threshold.json",
        "metricsFormat": "shoulder",
        "modelFile": "shoulder/shoulder_model_finetuned.keras",
        "dataset": "Shoulder X-ray triage set",
        "trainingImages": 8379,
    },
    {
        "slug": "hand-wrist",
        "name": "Hand & Wrist Clinic",
        "regions": ["Hand & Wrist"],
        "metricsFile": "wrist_pediatric_findings/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "wrist_pediatric_findings/wrist_pediatric_findings_model.keras",
        "dataset": "GRAZPEDWRI-DX pediatric wrist",
        "trainingImages": 14000,
    },
    {
        "slug": "lower-limb",
        "name": "Leg, Knee & Foot Clinic",
        "regions": ["Leg, Knee & Foot"],
        "metricsFile": "lower_limb_findings/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "lower_limb_findings/lower_limb_findings_model.keras",
        "dataset": "BTXRD lower limb subset",
        "trainingImages": 2467,
    },
    {
        "slug": "spine",
        "name": "Spine Clinic",
        "regions": ["Spine"],
        "metricsFile": "spine_findings/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "spine_findings/spine_findings_model.keras",
        "dataset": "Cervical Spine X-ray Atlas",
        "trainingImages": 4963,
    },
    {
        "slug": "pelvis",
        "name": "Pelvis & Hip Clinic",
        "regions": ["Pelvis & Hip"],
        "metricsFile": (
            "_experimental/pelvis_hip_findings/test_metrics.json"
        ),
        "metricsFormat": "auc",
        "modelFile": None,
        "dataset": "BTXRD pelvis subset",
        "trainingImages": 228,
    },
    {
        "slug": "head",
        "name": "Head & Skull Clinic",
        "regions": ["Head & Skull"],
        "metricsFile": None,
        "metricsFormat": None,
        "modelFile": None,
        "dataset": None,
        "trainingImages": 0,
    },
]

"""
The quality tiers. A model has to clear the bar on its weakest finding,
because a doctor meets the weakest one just as often as the best one.
"""
QUALITY_TIERS = [
    (0.85, "high", "Reliable as a triage assistant."),
    (0.75, "moderate", "Useful, but confirm every finding."),
    (0.0, "limited", "Too weak to show findings to a patient."),
]


def read_model_quality(capability: dict[str, Any]) -> dict[str, Any]:
    """
    Reads the measured metrics of one clinic model. Returns the weakest
    and the strongest finding, since those two decide how much a doctor
    can lean on the model.
    """
    metrics_file = capability.get("metricsFile")

    if not metrics_file:
        return {"available": False, "findings": []}

    path = AI_SERVICE_DIR / "models" / str(metrics_file)

    if not path.exists():
        return {"available": False, "findings": []}

    try:
        raw = read_json_file(path)
    except Exception as error:
        print(f"Unable to read {path}: {error}")
        return {"available": False, "findings": []}

    """
    Findings the model produces but that are not served are left out of
    the quality summary, so a clinic is judged on what a doctor actually
    sees.
    """
    disabled: set[str] = set()
    thresholds_path = path.parent / (
        path.parent.name + "_thresholds.json"
    )

    if thresholds_path.exists():
        try:
            disabled = set(
                read_json_file(thresholds_path).get("disabledLabels")
                or []
            )
        except Exception:
            disabled = set()

    findings: list[dict[str, Any]] = []

    if capability.get("metricsFormat") == "shoulder":
        """
        The shoulder model stores one number for the whole decision, and
        it is a validation AUC rather than a held out test AUC. It is
        reported as it was measured, without dressing it up.
        """
        auc = raw.get("validation_auc")

        if auc is not None:
            findings.append(
                {
                    "name": "Shoulder abnormality",
                    "score": float(auc),
                    "scoreLabel": "Validation AUC",
                }
            )
    elif capability.get("metricsFormat") == "chest":
        for name, values in (raw.get("testResults") or {}).items():
            if not isinstance(values, dict):
                continue

            findings.append(
                {
                    "name": name,
                    "score": float(values.get("f1_score") or 0.0),
                    "scoreLabel": "F1",
                    "sensitivity": values.get("sensitivity"),
                    "specificity": values.get("specificity"),
                }
            )
    else:
        for name, values in raw.items():
            if not isinstance(values, dict) or name in disabled:
                continue

            auc = values.get("roc_auc")

            if auc is None:
                continue

            findings.append(
                {
                    "name": name,
                    "score": float(auc),
                    "scoreLabel": "ROC AUC",
                    "testPositives": values.get("test_positive_count"),
                }
            )

    if not findings:
        return {"available": False, "findings": []}

    findings.sort(key=lambda item: item["score"])

    return {
        "available": True,
        "findings": findings,
        "weakest": findings[0],
        "strongest": findings[-1],
    }


@app.get("/clinics")
def clinic_capabilities():
    """
    Reports, per clinic, whether an AI model backs it and how good that
    model measured. The doctor application uses this to order and label
    the clinics instead of presenting them all as equal.
    """
    results = []

    for capability in CLINIC_CAPABILITIES:
        quality = read_model_quality(capability)

        """
        Whether the clinic actually runs a model is a question about the
        model file. How much the doctor can lean on it is a separate
        question, answered by the measured metrics.
        """
        model_file = capability.get("modelFile")
        is_served = bool(
            model_file
            and (AI_SERVICE_DIR / "models" / str(model_file)).exists()
        )

        if not quality["available"]:
            tier = "none"
            tier_note = (
                "No AI model yet. Every image goes straight to the "
                "specialist doctor."
            )
        else:
            weakest_score = float(quality["weakest"]["score"])
            tier, tier_note = next(
                (name, note)
                for bar, name, note in QUALITY_TIERS
                if weakest_score >= bar
            )

            if not is_served:
                tier_note = (
                    "A model was trained but is not served, so the "
                    "clinic stays doctor only until it improves."
                )
            elif tier == "limited":
                tier_note = (
                    f"The AI runs, but {quality['weakest']['name']} "
                    "is unreliable. Read every result with care."
                )

        results.append(
            {
                "slug": capability["slug"],
                "name": capability["name"],
                "regions": capability["regions"],
                "dataset": capability["dataset"],
                "trainingImages": capability["trainingImages"],
                "aiServed": is_served,
                "tier": tier,
                "note": tier_note,
                "weakestFinding": quality.get("weakest"),
                "strongestFinding": quality.get("strongest"),
                "findings": quality.get("findings", []),
            }
        )

    """
    The clinics a doctor can rely on come first, the ones with no model
    at all come last.
    """
    order = {"high": 0, "moderate": 1, "limited": 2, "none": 3}
    results.sort(
        key=lambda item: (
            0 if item["aiServed"] else 1,
            order.get(item["tier"], 9),
            -(item["weakestFinding"] or {}).get("score", 0),
        )
    )

    return {"success": True, "clinics": results}


def describe_region_label(label: str) -> dict[str, Any]:
    known = REGION_LABEL_INFO.get(label)

    if known:
        return dict(known)

    return {
        "name": label.replace("_", " ").title(),
        "code": label.upper(),
        "clinicalPriority": 5,
    }


def load_region_model(region_key: str) -> dict[str, Any]:
    """
    Loads the model of one region on first use and remembers the result,
    so a missing model is not looked up again on every request.
    """
    cached = region_model_cache.get(region_key)

    if cached is not None and cached["model"] is not None:
        return cached

    definition = REGION_MODEL_REGISTRY[region_key]
    folder = str(definition["folder"])

    model_path = (
        AI_SERVICE_DIR / "models" / folder / f"{folder}_model.keras"
    )

    thresholds_path = (
        AI_SERVICE_DIR / "models" / folder / f"{folder}_thresholds.json"
    )

    entry: dict[str, Any] = {
        "model": None,
        "labels": [],
        "thresholds": {},
        "disabledLabels": [],
        "modelPath": model_path,
        "error": "",
    }

    """
    A missing model is not cached as a final answer: a newly trained
    model must be picked up without restarting the service. Only the
    file timestamp is remembered, so a failing load is not retried on
    every single request.
    """
    if not model_path.exists() or not thresholds_path.exists():
        region_model_cache[region_key] = entry
        return entry

    if (
        cached is not None
        and cached.get("failedAt") == model_path.stat().st_mtime
    ):
        return cached

    try:
        print(
            f"Loading {definition['displayName']} model from:\n"
            f"{model_path}"
        )

        model = tf.keras.models.load_model(model_path, compile=False)
        metadata = read_json_file(thresholds_path)

        raw_labels = metadata.get("labels")
        raw_thresholds = metadata.get("thresholds", {})

        if not isinstance(raw_labels, list) or not raw_labels:
            raise ValueError(
                f"{definition['displayName']} labels are missing."
            )

        labels = [str(label) for label in raw_labels]
        thresholds: dict[str, float] = {}

        for label in labels:
            threshold = float(
                raw_thresholds.get(label, DEFAULT_FINDING_THRESHOLD)
                if isinstance(raw_thresholds, dict)
                else DEFAULT_FINDING_THRESHOLD
            )

            if not 0.0 < threshold < 1.0:
                threshold = DEFAULT_FINDING_THRESHOLD

            thresholds[label] = threshold

        output_size = int(model.output_shape[-1])

        if output_size != len(labels):
            raise ValueError(
                f"{definition['displayName']} model output size does "
                "not match the thresholds file. "
                f"Model outputs: {output_size}, "
                f"labels: {len(labels)}"
            )

        """
        A finding the training run measured as unreliable is kept out of
        the response. The model still produces it, so the label list
        stays complete for the output size check above.
        """
        disabled = metadata.get("disabledLabels")
        entry["disabledLabels"] = (
            [str(name) for name in disabled]
            if isinstance(disabled, list)
            else []
        )

        entry["model"] = model
        entry["labels"] = labels
        entry["thresholds"] = thresholds

        print(
            f"{definition['displayName']} model loaded successfully."
        )

    except Exception as error:
        entry["error"] = str(error)
        entry["failedAt"] = model_path.stat().st_mtime
        print(
            f"Failed to load the {definition['displayName']} model: "
            f"{error}"
        )

    region_model_cache[region_key] = entry
    return entry


def build_region_response(
    image: UploadFile,
    width: int,
    height: int,
    definition: dict[str, Any],
    probabilities: np.ndarray | None,
    labels: list[str],
    thresholds: dict[str, float],
    model_name: str | None,
    disabled_labels: list[str] | None = None,
) -> dict[str, Any]:
    """
    Builds the same payload shape the other endpoints return. When no
    model is installed the region reports NOT_ANALYZED and asks for a
    doctor review, instead of guessing a finding.
    """
    skipped = set(disabled_labels or [])
    display_name = str(definition["displayName"])

    base = {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": str(definition["bodyRegion"]),
        "detectedClinic": str(definition["clinic"]),
        "modelVersion": "1.0",
    }

    if probabilities is None:
        return {
            **base,
            "result": "NOT_ANALYZED",
            "triageResult": "NOT_ANALYZED",
            "confidence": 0.0,
            "primaryFinding": None,
            "possibleFindings": [],
            "allFindings": [],
            "noSupportedFindingDetected": True,
            "priority": "NEEDS_REVIEW",
            "needsDoctorReview": True,
            "modelAvailable": False,
            "modelName": None,
            "supportedLabels": [],
            "message": (
                f"No AI model is installed for {display_name} X-rays "
                "yet, so the image was sent directly to the specialist "
                "doctor for review."
            ),
            "disclaimer": (
                "This image was not analysed by AI. The diagnosis "
                "comes from the reviewing doctor."
            ),
        }

    all_findings: list[dict[str, Any]] = []
    detected_findings: list[dict[str, Any]] = []
    near_threshold = False

    for label, raw_probability in zip(labels, probabilities):
        if label in skipped:
            continue

        probability = float(raw_probability)
        threshold = float(
            thresholds.get(label, DEFAULT_FINDING_THRESHOLD)
        )

        detected = probability >= threshold

        if (
            not detected
            and abs(probability - threshold)
            <= FINDING_UNCERTAINTY_MARGIN
        ):
            near_threshold = True

        label_info = describe_region_label(label)

        item = {
            "name": str(label_info["name"]),
            "code": str(label_info["code"]),
            "label": label,
            "probability": round(probability * 100, 2),
            "probabilityRaw": round(probability, 6),
            "threshold": round(threshold * 100, 2),
            "thresholdRaw": round(threshold, 6),
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
        key=lambda item: (
            describe_region_label(str(item["label"]))[
                "clinicalPriority"
            ],
            -float(item["probability"]),
        )
    )

    detected_codes = {
        str(item["code"]) for item in detected_findings
    }

    if detected_findings:
        result = "ABNORMAL"
        primary_finding = detected_findings[0]["name"]
        confidence = float(detected_findings[0]["probability"])
        needs_doctor_review = True
        priority = (
            "URGENT"
            if detected_codes & URGENT_REGION_CODES
            else "NEEDS_REVIEW"
        )
        message = (
            f"{primary_finding} was detected in the {display_name} "
            "X-ray. Doctor review is required."
        )

    elif near_threshold:
        result = "UNCERTAIN"
        primary_finding = None
        confidence = float(
            all_findings[0]["probability"] if all_findings else 0.0
        )
        needs_doctor_review = True
        priority = "NEEDS_REVIEW"
        message = (
            f"No {display_name} finding clearly exceeded its decision "
            "threshold, but at least one result was close. Doctor "
            "review is required."
        )

    else:
        result = "NORMAL"
        primary_finding = None
        highest_probability = float(
            all_findings[0]["probability"] if all_findings else 0.0
        )
        confidence = max(0.0, 100.0 - highest_probability)
        needs_doctor_review = False
        priority = "ROUTINE"
        message = (
            f"No supported {display_name} finding exceeded its "
            "decision threshold in this preliminary analysis."
        )

    return {
        **base,
        "result": result,
        "triageResult": result,
        "confidence": round(confidence, 2),
        "primaryFinding": primary_finding,
        "possibleFindings": detected_findings,
        "allFindings": all_findings,
        "noSupportedFindingDetected": not detected_findings,
        "priority": priority,
        "needsDoctorReview": needs_doctor_review,
        "modelAvailable": True,
        "modelName": model_name,
        "supportedLabels": [
            label for label in labels if label not in skipped
        ],
        "message": message,
        "disclaimer": (
            f"These are preliminary AI findings for {display_name} "
            "radiographs with a limited supported label set. They do "
            "not replace a radiologist's interpretation or a doctor's "
            "final diagnosis."
        ),
    }


def run_region_model(entry: dict[str, Any], image_array: np.ndarray):
    """
    Runs one loaded region model and returns its raw probabilities.
    """
    model_input = np.array(image_array, dtype=np.float32, copy=True)
    model_input = (
        tf.keras.applications.mobilenet_v2.preprocess_input(model_input)
    )

    prediction = entry["model"].predict(model_input, verbose=0)
    return np.array(prediction[0], dtype=np.float32)


def collect_shared_fracture_findings(
    image_array: np.ndarray,
) -> tuple[list[dict[str, Any]], str | None]:
    """
    Runs the shared fracture model and returns its findings, so a bone
    region reports a fracture even when its own model was trained on a
    different kind of finding.
    """
    entry = load_region_model("fracture")

    if entry["model"] is None:
        return [], None

    probabilities = run_region_model(entry, image_array)
    findings: list[dict[str, Any]] = []

    for label, raw_probability in zip(entry["labels"], probabilities):
        if label in set(entry.get("disabledLabels") or []):
            continue

        probability = float(raw_probability)
        threshold = float(
            entry["thresholds"].get(label, DEFAULT_FINDING_THRESHOLD)
        )
        label_info = describe_region_label(label)

        findings.append(
            {
                "name": str(label_info["name"]),
                "code": str(label_info["code"]),
                "label": label,
                "probability": round(probability * 100, 2),
                "probabilityRaw": round(probability, 6),
                "threshold": round(threshold * 100, 2),
                "thresholdRaw": round(threshold, 6),
                "detected": probability >= threshold,
                "model": entry["modelPath"].name,
            }
        )

    return findings, entry["modelPath"].name


def merge_fracture_into_response(
    response: dict[str, Any],
    fracture_findings: list[dict[str, Any]],
    fracture_model_name: str | None,
) -> dict[str, Any]:
    """
    Folds the fracture result into a region response. A detected fracture
    always becomes the primary finding and raises the case to urgent,
    because it is the finding that changes the treatment first.
    """
    if not fracture_findings:
        return response

    existing_codes = {
        str(item.get("code"))
        for item in response.get("allFindings", [])
    }

    added = [
        finding
        for finding in fracture_findings
        if str(finding["code"]) not in existing_codes
    ]

    if not added:
        return response

    all_findings = [*response.get("allFindings", []), *added]
    all_findings.sort(
        key=lambda item: item["probability"],
        reverse=True,
    )

    detected = [item for item in all_findings if item["detected"]]

    response["allFindings"] = all_findings
    response["possibleFindings"] = detected
    response["noSupportedFindingDetected"] = not detected
    response["fractureModel"] = fracture_model_name
    response["supportedLabels"] = [
        *response.get("supportedLabels", []),
        *[finding["label"] for finding in added],
    ]

    fracture_detected = any(
        item["detected"] and item["code"] == "POSSIBLE_FRACTURE"
        for item in added
    )

    if fracture_detected:
        response["result"] = "ABNORMAL"
        response["triageResult"] = "ABNORMAL"
        response["primaryFinding"] = "Possible Fracture"
        response["priority"] = "URGENT"
        response["needsDoctorReview"] = True
        response["modelAvailable"] = True
        response["confidence"] = next(
            item["probability"]
            for item in added
            if item["code"] == "POSSIBLE_FRACTURE"
        )
        response["message"] = (
            "A possible fracture was detected. Orthopedic doctor "
            "review is required."
        )
    elif response.get("result") == "NOT_ANALYZED":
        """
        Only the fracture check ran, and it found nothing. The result
        stays NOT_ANALYZED on purpose: calling it NORMAL would drop the
        case out of the review queue, while everything except a fracture
        is still unchecked for this region.
        """
        response["modelAvailable"] = True
        response["needsDoctorReview"] = True
        response["priority"] = "NEEDS_REVIEW"
        response["message"] = (
            "No fracture was detected. Every other finding of this "
            "region is not covered by a model yet, so the image goes to "
            "the specialist doctor."
        )

    return response


@app.post("/predict/region/{region_key}")
async def predict_region(
    region_key: str,
    image: UploadFile = File(...),
):
    """
    One endpoint for every remaining body region. The region decides
    which model runs and which clinic receives the case.
    """
    definition = REGION_MODEL_REGISTRY.get(region_key)

    if definition is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown body region: {region_key}. Supported "
                f"regions: {', '.join(REGION_MODEL_REGISTRY)}"
            ),
        )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(image_bytes)
        entry = load_region_model(region_key)
        model = entry["model"]

        """
        Bone regions always get the shared fracture check, whether or not
        they have a model of their own.
        """
        fracture_findings: list[dict[str, Any]] = []
        fracture_model_name = None

        if region_key in SHARED_FRACTURE_REGIONS:
            (
                fracture_findings,
                fracture_model_name,
            ) = collect_shared_fracture_findings(image_array)

        if model is None:
            response = build_region_response(
                image=image,
                width=width,
                height=height,
                definition=definition,
                probabilities=None,
                labels=[],
                thresholds={},
                model_name=None,
            )

            return merge_fracture_into_response(
                response,
                fracture_findings,
                fracture_model_name,
            )

        response = build_region_response(
            image=image,
            width=width,
            height=height,
            definition=definition,
            probabilities=run_region_model(entry, image_array),
            labels=entry["labels"],
            thresholds=entry["thresholds"],
            model_name=entry["modelPath"].name,
            disabled_labels=entry.get("disabledLabels"),
        )

        return merge_fracture_into_response(
            response,
            fracture_findings,
            fracture_model_name,
        )

    except HTTPException:
        raise

    except Exception as error:
        print(f"{region_key} prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail=(
                f"The {definition['displayName']} X-ray analysis failed."
            ),
        ) from error


@app.get("/regions")
def list_regions():
    """
    Tells the application which body regions exist and which of them
    already have a trained model behind them.
    """
    regions = []

    for region_key, definition in REGION_MODEL_REGISTRY.items():
        if region_key == "fracture":
            continue

        entry = load_region_model(region_key)

        regions.append(
            {
                "region": region_key,
                "displayName": definition["displayName"],
                "bodyRegion": definition["bodyRegion"],
                "clinic": definition["clinic"],
                "endpoint": f"/predict/region/{region_key}",
                "modelAvailable": entry["model"] is not None,
                "labels": entry["labels"],
                "error": entry["error"],
            }
        )

    """
    The regions that already have their own dedicated endpoint.
    """
    regions.extend(
        [
            {
                "region": "chest",
                "displayName": "Chest",
                "bodyRegion": "CHEST",
                "clinic": "chest",
                "endpoint": "/predict/chest/findings",
                "modelAvailable": chest_findings_model is not None,
                "labels": chest_findings_labels,
                "error": chest_findings_model_loading_error,
            },
            {
                "region": "shoulder",
                "displayName": "Shoulder",
                "bodyRegion": "SHOULDER",
                "clinic": "orthopedic",
                "endpoint": "/predict/shoulder",
                "modelAvailable": shoulder_model is not None,
                "labels": [],
                "error": shoulder_model_loading_error,
            },
            {
                "region": "hand-wrist",
                "displayName": "Hand & Wrist",
                "bodyRegion": "HAND_WRIST",
                "clinic": "orthopedic",
                "endpoint": "/predict/hand-wrist",
                "modelAvailable": (
                    hand_wrist_model is not None
                    or wrist_pediatric_model is not None
                ),
                "labels": (
                    hand_wrist_labels
                    if hand_wrist_model is not None
                    else wrist_pediatric_labels
                ),
                "error": hand_wrist_model_loading_error,
            },
        ]
    )

    return {"success": True, "regions": regions}


# =========================================================
# General routes
# =========================================================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "RadioCare AI service is running.",
        "version": "3.1.0",
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
            "wristPediatricFindings": {
                "loaded": wrist_pediatric_model is not None,
                "file": WRIST_PEDIATRIC_MODEL_PATH.name,
                "labels": wrist_pediatric_labels,
                "thresholds": wrist_pediatric_thresholds,
            },
            "handWristFindings": {
                "loaded": (
                    hand_wrist_model is not None
                    or wrist_pediatric_model is not None
                ),
                "dedicatedModelLoaded": (
                    hand_wrist_model is not None
                ),
                "file": HAND_WRIST_MODEL_PATH.name,
                "labels": (
                    hand_wrist_labels
                    if hand_wrist_model is not None
                    else wrist_pediatric_labels
                ),
                "activeModel": (
                    HAND_WRIST_MODEL_PATH.name
                    if hand_wrist_model is not None
                    else WRIST_PEDIATRIC_MODEL_PATH.name
                ),
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
        "wristPediatricFindings": wrist_pediatric_model is not None,
        "handWristFindings": (
            hand_wrist_model is not None
            or wrist_pediatric_model is not None
        ),
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
            "wristPediatricFindings": {
                "loaded": model_states["wristPediatricFindings"],
                "error": wrist_pediatric_model_loading_error,
                "file": WRIST_PEDIATRIC_MODEL_PATH.name,
                "labels": wrist_pediatric_labels,
                "thresholds": wrist_pediatric_thresholds,
            },
            "handWristFindings": {
                "loaded": model_states["handWristFindings"],
                "error": hand_wrist_model_loading_error,
                "file": HAND_WRIST_MODEL_PATH.name,
                "labels": (
                    hand_wrist_labels
                    if hand_wrist_model is not None
                    else wrist_pediatric_labels
                ),
                "usingFallbackModel": hand_wrist_model is None,
                "activeModel": (
                    HAND_WRIST_MODEL_PATH.name
                    if hand_wrist_model is not None
                    else WRIST_PEDIATRIC_MODEL_PATH.name
                ),
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

# =========================================================
# Pediatric wrist findings prediction
# =========================================================

@app.post("/predict/wrist/pediatric")
async def predict_wrist_pediatric(
    image: UploadFile = File(...),
):
    if wrist_pediatric_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "The pediatric wrist findings model is not "
                "available. "
                f"{wrist_pediatric_model_loading_error or ''}"
            ),
        )

    image_bytes = await validate_and_read_image(image)

    try:
        image_array, width, height = prepare_image(
            image_bytes
        )

        probabilities = (
            predict_wrist_pediatric_probabilities(
                image_array
            )
        )

        return build_wrist_pediatric_response(
            image=image,
            width=width,
            height=height,
            probabilities=probabilities,
        )

    except HTTPException:
        raise

    except Exception as error:
        print(
            "Pediatric wrist findings prediction error: "
            f"{error}"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "The pediatric wrist X-ray analysis failed."
            ),
        ) from error