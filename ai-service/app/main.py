import json
import os
from io import BytesIO
from pathlib import Path
from typing import Any

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import tensorflow as tf
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError


# =========================================================
# Paths and settings
# =========================================================

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]

CHEST_MODEL_PATH = (
    AI_SERVICE_DIR / "models" / "chest" / "chest_model.keras"
)

"""
The chest triage model: is this chest normal or not.

The normal or abnormal decision used to be read out of the multi label
findings model, by asking whether any of its eight findings crossed a
threshold. That went wrong on normal chests: the findings model returns
84% for Atelectasis on a clear image, so the thresholds had to be raised
to 90 and anything near one of them was reported as uncertain.

This model answers the triage question directly. Measured on the same
624 image test set, it reads a normal chest correctly 74% of the time
against 69% for the old arrangement, and its accuracy is 88% against 85%.
"""
CHEST_TRIAGE_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest_triage_v2"
    / "chest_triage_v2_model.keras"
)

CHEST_TRIAGE_THRESHOLD_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "chest_triage_v2"
    / "chest_triage_v2_thresholds.json"
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

"""
The shoulder triage model.

The model served before this one answered "normal" to every image. On
its own test set it read all 615 normal shoulders correctly and missed
all 147 abnormal ones, for a ROC AUC of 0.5577, which is a coin toss.
Its 80.7% accuracy came from the set being 80% normal, not from finding
anything.

It learned that from the data: 2870 normal against 681 abnormal in
training makes "always normal" a winning answer. The replacement was
trained with class weights against that lean, and its cut point was
chosen on the validation set.

Measured on the same 762 image test set:

    abnormal found   0%  ->  76.9%   (missed 147 of 147  ->  34 of 147)
    normal correct 100%  ->  60.5%
    ROC AUC     0.5577   ->  0.7650

Accuracy falls from 80.7% to 63.6% and that is the improvement, not a
regression: the earlier number measured a model that found nothing.

0.765 is still only moderate. The shoulder result assists a doctor, it
does not stand on its own.
"""
SHOULDER_TRIAGE_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder_triage_v4"
    / "shoulder_triage_v4_model.keras"
)

SHOULDER_TRIAGE_THRESHOLD_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "shoulder_triage_v4"
    / "shoulder_triage_v4_thresholds.json"
)

"""
This backbone is an EfficientNet, which rescales inside itself and takes
the raw 0 to 255 pixels. The model it replaced was a MobileNetV2 and
needed preprocess_input first. Sending either the wrong input returns a
confident number that means nothing.
"""
SHOULDER_TRIAGE_NEEDS_RAW_PIXELS = True

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
"""
How close to the threshold a shoulder score must be before the image is
called uncertain rather than decided.

At 0.08 the band ran from 0.49 to 0.65 and swallowed 19% of the normal
shoulders in the test set, 117 of 615. A normal shoulder scoring 0.54
against a threshold of 0.57 was reported as uncertain, which tells the
patient nothing and sends the doctor a case the model had in fact
decided.

At 0.03 the band holds 7.6% of normal shoulders, and those are the ones
genuinely sitting on the line.
"""
SHOULDER_UNCERTAINTY_MARGIN = 0.03

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
    "spine": {
        "displayName": "Spine",
        "bodyRegion": "SPINE",
        "clinic": "spine",
        # v3 learns the atlas the way the atlas is written: one
        # curvature grade per film, chosen by a softmax, with the three
        # findings summed out of the four grades by a fixed layer. The
        # grades compete for one probability instead of being three
        # independent questions, which is what let the old model be sure
        # of two contradictory shapes at once. Measured on the same test
        # split as its predecessors:
        #
        #                        v1      v2      v3
        #   curvature AUC       0.853   0.909   0.926
        #   kyphosis precision  0.47    0.70    0.74
        #   kyphosis alarms     66      19      17
        #   healthy sent on     44.7%   40.2%   36.7%
        #
        # The earlier models stay in models/spine_findings and
        # models/spine_findings_v2 so the three can be compared again.
        "folder": "spine_findings_v3",
        # The spine clinic accepts cervical, thoracic and lumbar films,
        # but this model was trained on the Cervical Spine X-ray Atlas
        # and knows one thing only: the shape of the cervical curvature.
        # On a lumbar film it still returns a number, and that number
        # means nothing. The scope is written into every answer, so a
        # doctor reading a thoracic or lumbar study is never left to
        # assume the AI examined it.
        "scopeNote": (
            "This model reads the curvature of the cervical spine "
            "only. On a thoracic or lumbar film its result carries no "
            "meaning and the doctor's reading is the only one."
        ),
    },
    "pelvis": {
        "displayName": "Pelvis & Hip",
        "bodyRegion": "PELVIS_HIP",
        "clinic": "orthopedic",
        # The same argument that moved the lower limb onto the all
        # region model applies here, and more sharply: BTXRD holds only
        # 228 pelvis films, against 3746 once every region is counted.
        # Measured on the pelvis test split, pelvis only against all
        # regions:
        #
        #                        pelvis only   all regions
        #   bone lesion AUC         0.731         0.851
        #   malignant AUC           0.758         0.844
        #   benign AUC              0.708         0.686
        #
        # The two labels a doctor cannot afford to miss both improve,
        # and benign gives up almost nothing. The split is 37 films, so
        # these numbers are noisy on their own; what makes them
        # convincing is that they point the same way as the lower limb
        # measurement, which was taken on far more cases.
        #
        # The pelvis only model stays in models/pelvis_hip_findings so
        # the two can be compared again.
        "folder": "btxrd_lesion_all",
    },
    "lower-limb": {
        "displayName": "Lower Limb",
        "bodyRegion": "LOWER_LIMB",
        "clinic": "orthopedic",
        # A lesion in a hip looks like a lesion in a femur, so this
        # model was trained on every BTXRD region at once rather than on
        # the leg alone: 2604 images instead of 1726. Measured on the
        # leg's own test split, against the model trained only on legs:
        #
        #                          leg only   all regions
        #   bone lesion AUC          0.880      0.897
        #   malignant AUC            0.849      0.909
        #   malignant false alarms   61         20
        #   malignant cases that
        #     reach nobody            4          2
        #
        # The last row is the one that decided it. The malignant label
        # alone finds fewer cases, but the lesion labels around it catch
        # what it drops, so half as many malignant films end up with no
        # finding at all.
        "folder": "btxrd_lesion_all",
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
    # The findings the volumetric models produce. They share this table
    # with the X-ray models so one label always gets one name, whichever
    # kind of study it was read from.
    "malignant_nodule": {
        "name": "Suspicious for Malignant Lung Nodule",
        "code": "MALIGNANT_LUNG_NODULE",
        "clinicalPriority": 1,
    },
    "buckle_rib_fracture": {
        "name": "Buckle Rib Fracture",
        "code": "BUCKLE_RIB_FRACTURE",
        "clinicalPriority": 3,
    },
    "nondisplaced_rib_fracture": {
        "name": "Nondisplaced Rib Fracture",
        "code": "NONDISPLACED_RIB_FRACTURE",
        "clinicalPriority": 2,
    },
    "displaced_rib_fracture": {
        "name": "Displaced Rib Fracture",
        "code": "DISPLACED_RIB_FRACTURE",
        "clinicalPriority": 1,
    },
    "adrenal_mass": {
        "name": "Adrenal Gland Mass",
        "code": "ADRENAL_MASS",
        "clinicalPriority": 2,
    },
    "intracranial_aneurysm": {
        "name": "Possible Intracranial Aneurysm",
        "code": "INTRACRANIAL_ANEURYSM",
        "clinicalPriority": 1,
    },
    "lung_involvement": {
        "name": "Lung Involvement",
        "code": "LUNG_INVOLVEMENT",
        "clinicalPriority": 2,
    },
    "lung_tumour": {
        "name": "Lung Tumour",
        "code": "LUNG_TUMOUR",
        "clinicalPriority": 1,
    },
    "colon_tumour": {
        "name": "Colorectal Tumour",
        "code": "COLON_TUMOUR",
        "clinicalPriority": 1,
    },
    "hepatic_vessel_tumour": {
        "name": "Liver Vessel Tumour",
        "code": "HEPATIC_VESSEL_TUMOUR",
        "clinicalPriority": 1,
    },
    "pancreas_tumour": {
        "name": "Pancreatic Tumour",
        "code": "PANCREAS_TUMOUR",
        "clinicalPriority": 1,
    },
    "kidney_tumour": {
        "name": "Kidney Tumour",
        "code": "KIDNEY_TUMOUR",
        "clinicalPriority": 1,
    },
    "liver_tumour": {
        "name": "Liver Tumour",
        "code": "LIVER_TUMOUR",
        "clinicalPriority": 1,
    },
    "enhancing_brain_tumour": {
        "name": "Enhancing Brain Tumour",
        "code": "ENHANCING_BRAIN_TUMOUR",
        "clinicalPriority": 1,
    },
}

"""
Findings that must reach the doctor as an urgent case.
"""
URGENT_REGION_CODES = URGENT_UPPER_LIMB_CODES | {
    "MALIGNANT_BONE_LESION",
    "MALIGNANT_LUNG_NODULE",
    "DISPLACED_RIB_FRACTURE",
    "INTRACRANIAL_ANEURYSM",
    "ENHANCING_BRAIN_TUMOUR",
    "LUNG_TUMOUR",
    "COLON_TUMOUR",
    "HEPATIC_VESSEL_TUMOUR",
    "PANCREAS_TUMOUR",
    "LIVER_TUMOUR",
    "KIDNEY_TUMOUR",
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
"""
How close to its threshold a finding must be before the image is called
uncertain rather than normal.

At ten points this swallowed most normal images: with eight findings,
one of them nearly always lands within ten points of its threshold, so
two thirds of the chest images that carried no detected finding were
reported as uncertain. Measured over the images in hand, ten points gave
4 normal and 8 uncertain; three points gives 10 normal and 2 uncertain,
and those two are genuinely on the line.
"""
FINDING_UNCERTAINTY_MARGIN = 0.03
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

"""
Who may ask this service to read an image.

The website is served from 3000 and the backend from 4000. The mobile
application is a third caller: on a laptop it is a browser page served
by Expo on 8090, and on a phone it is a native application, which sends
no origin at all and so never reaches this check.

The regular expression covers the phone's own address on the local
network, which changes with the network and cannot be listed in
advance. It is deliberately narrow: only private address ranges, only
the ports this project runs on.
"""
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4000",
        "http://localhost:8081",
        "http://localhost:8082",
        "http://localhost:8090",
        "http://127.0.0.1:8090",
    ],
    allow_origin_regex=r"http://(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.[\d.]+:(3000|8081|8082|8090)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Model variables
# =========================================================

chest_model = None
chest_findings_model = None
chest_triage_model = None
chest_triage_threshold = 0.92
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
    """
    The cut point has to come from the same run as the model that is
    loaded. The old file holds 0.31, which belongs to the model that
    answered "normal" to everything; applying it to the retrained model
    would score every image against a number tuned for a different one.
    """
    if SHOULDER_TRIAGE_MODEL_PATH.exists() and (
        SHOULDER_TRIAGE_THRESHOLD_PATH.exists()
    ):
        try:
            return float(
                read_json_file(SHOULDER_TRIAGE_THRESHOLD_PATH)["threshold"]
            )
        except Exception as error:
            print(f"Unable to read the shoulder triage threshold: {error}")

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

    """
    The triage model is optional. Without it the findings model decides
    normal or abnormal on its own, which is how the service behaved
    before, so a missing file degrades the result rather than breaking
    the clinic.
    """
    if CHEST_TRIAGE_MODEL_PATH.exists():
        print("Loading chest triage model...")

        chest_triage_model = tf.keras.models.load_model(
            CHEST_TRIAGE_MODEL_PATH,
            compile=False,
        )

        if CHEST_TRIAGE_THRESHOLD_PATH.exists():
            chest_triage_threshold = float(
                read_json_file(CHEST_TRIAGE_THRESHOLD_PATH).get(
                    "threshold",
                    chest_triage_threshold,
                )
            )

        print(
            "Chest triage model ready, threshold "
            f"{chest_triage_threshold}"
        )
    else:
        print(
            "Chest triage model not found; the findings model decides "
            "normal or abnormal on its own."
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
    if SHOULDER_TRIAGE_MODEL_PATH.exists():
        selected_shoulder_model_path = SHOULDER_TRIAGE_MODEL_PATH

    elif SHOULDER_ORIGINAL_MODEL_PATH.exists():
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


"""
The shoulder fracture model is not loaded.

It was measured on its own held out split, the one its training run set
aside, reproduced from the same seed. On 142 films holding 9 fractures:

    ROC AUC              0.664
    average precision    0.141

An AUC of 0.664 is close to a coin toss, and an average precision of
0.141 says most of what it flags is not a fracture. A detector like that
does not help a doctor, it buries them: the alarms that matter arrive
mixed into a pile of alarms that do not, and after a week nobody reads
any of them. Missing the finding is at least honest about itself.

The general fracture model was tried in its place, trained on four times
the films, and scored 0.692 on the same split. Better, and still not
usable. The shortage is not the number of films but the number of
fractures: about sixty in the whole collection, nine in the test split,
which is too few to learn from and too few to measure with.

The shoulder path keeps its triage model, which was measured at 0.792 on
147 cases and says whether the shoulder looks abnormal at all. An
abnormal shoulder reaches a doctor either way; what is lost is the word
"fracture" on the way there.

The model and its threshold stay on disk, and models/shoulder_fracture/
test_metrics.json holds the measurement above, so this decision can be
revisited the day there is a shoulder fracture collection worth
retraining on.
"""
SHOULDER_FRACTURE_MODEL_ENABLED = False

try:
    if not SHOULDER_FRACTURE_MODEL_ENABLED:
        raise RuntimeError(
            "The shoulder fracture model is switched off: it scored "
            "0.664 ROC AUC and 0.141 average precision on its own test "
            "split, so most of what it flagged was not a fracture."
        )

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


"""
The router and the hand triage model.

The upper limb pathway covers hands and wrists together, because the
patient is never asked which of the two they photographed. Until now the
pediatric wrist model answered both, and it cannot read a hand: over the
hand test set it called all 35 healthy hands abnormal, and over 400 real
hand images it returned a median 0.576 for "metal is present". A whole
hand is not a shape it was ever shown.

Measured on the same images, the two models are specialists and neither
covers the other's region:

                     on hands              on wrists
    wrist model      normal recall 0.000   accuracy 0.841
    hand triage      accuracy 0.824        abnormal recall 0.401

So the region is decided first, by a router that separates hands from
wrists at 98.2% on held out images, and the image then goes to whichever
model was trained on it.

The router was checked for the mistake that cost this project a chest
model. Hands arrive as 640x640 Roboflow exports and wrists at the
original radiograph size, so a router could reach a high score by
reading the export pipeline instead of the anatomy. Accuracy was 0.9861
on 640x640 images and 0.9805 on every other size: a gap of half a point,
where a router reading the pipeline would show a large one.

    models/hand_wrist_router/hand_wrist_router_model.keras
    models/hand_triage_v2/hand_triage_v2_model.keras

Both are optional. If either is missing the endpoint falls back to what
it did before, which is the wrist model for everything.
"""
HAND_WRIST_ROUTER_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_wrist_router"
    / "hand_wrist_router_model.keras"
)

HAND_WRIST_ROUTER_METADATA_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_wrist_router"
    / "router_metadata.json"
)

HAND_TRIAGE_MODEL_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_triage_v2"
    / "hand_triage_v2_model.keras"
)

HAND_TRIAGE_THRESHOLDS_PATH = (
    AI_SERVICE_DIR
    / "models"
    / "hand_triage_v2"
    / "hand_triage_v2_thresholds.json"
)

hand_wrist_router_model = None
hand_wrist_router_threshold = 0.5
hand_wrist_router_error = ""

hand_triage_model = None
hand_triage_threshold = 0.475
hand_triage_error = ""

try:
    if HAND_WRIST_ROUTER_MODEL_PATH.exists():
        print(
            "Loading the hand and wrist router from:\n"
            f"{HAND_WRIST_ROUTER_MODEL_PATH}"
        )

        hand_wrist_router_model = tf.keras.models.load_model(
            HAND_WRIST_ROUTER_MODEL_PATH,
            compile=False,
        )

        if HAND_WRIST_ROUTER_METADATA_PATH.exists():
            router_metadata = read_json_file(
                HAND_WRIST_ROUTER_METADATA_PATH
            )

            hand_wrist_router_threshold = float(
                router_metadata.get("threshold", 0.5)
            )

        print("Hand and wrist router loaded successfully.")
    else:
        print(
            "No hand and wrist router found. Every upper limb image "
            "goes to the wrist model."
        )

except Exception as error:
    hand_wrist_router_error = str(error)
    hand_wrist_router_model = None

    print(f"Failed to load the hand and wrist router: {error}")

try:
    if HAND_TRIAGE_MODEL_PATH.exists():
        print(
            "Loading the hand triage model from:\n"
            f"{HAND_TRIAGE_MODEL_PATH}"
        )

        hand_triage_model = tf.keras.models.load_model(
            HAND_TRIAGE_MODEL_PATH,
            compile=False,
        )

        if HAND_TRIAGE_THRESHOLDS_PATH.exists():
            triage_metadata = read_json_file(
                HAND_TRIAGE_THRESHOLDS_PATH
            )

            hand_triage_threshold = float(
                triage_metadata.get("threshold", 0.475)
            )

        print(
            "Hand triage model loaded successfully. Threshold: "
            f"{hand_triage_threshold}"
        )
    else:
        print(
            "No hand triage model found. Hand images go to the wrist "
            "model, which cannot read them."
        )

except Exception as error:
    hand_triage_error = str(error)
    hand_triage_model = None

    print(f"Failed to load the hand triage model: {error}")


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
        pil_image = Image.open(BytesIO(image_bytes))

    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        ) from error

    """
    Sixteen bit images are brought down to eight bits by scale, not by
    clipping.

    A radiograph exported from DICOM usually carries sixteen bits per
    pixel, and Pillow reads it as mode "I;16". Asking Pillow to convert
    that to RGB does not rescale it: every value above 255 is clipped to
    255, and since most of a radiograph sits far above 255 the image
    arrives at the model as a near white rectangle. Measured on the
    wrist set, a file whose pixels average 59.8 out of 255 was reaching
    the models as 244.7 out of 255.

    Dividing by 257 maps 0-65535 onto 0-255 and matches what
    tf.io.decode_image does, which is how every training set in this
    project was read.
    """
    if pil_image.mode in ("I;16", "I;16B", "I;16L", "I;16N", "I"):
        sixteen_bit = np.asarray(pil_image, dtype=np.float32)

        if sixteen_bit.max() > 255:
            sixteen_bit = sixteen_bit / 257.0

        pil_image = Image.fromarray(
            np.clip(sixteen_bit, 0, 255).astype(np.uint8),
            mode="L",
        )

    pil_image = pil_image.convert("RGB")

    width, height = pil_image.size

    """
    Resized the way every training script resizes: bilinear with
    antialiasing, matching tf.image.resize(..., antialias=True).

    Pillow's default resize uses no antialiasing, and that difference
    alone is enough to undo a model. Measured on the 3,075 image wrist
    test set, the served model scores 0.9037 ROC AUC on fractures when
    the image is resized the way it was trained and 0.48, a coin toss,
    when it is not. The pixels look the same to a person; they are not
    the same to the network.
    """
    resized_image = pil_image.resize(
        IMAGE_SIZE,
        resample=Image.BILINEAR,
        reducing_gap=None,
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
    triage_score: float | None = None,
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

    """
    The triage model answers "normal or not" directly, so when it is
    loaded it decides. The findings below still say what was seen and
    still raise an abnormal result on their own, because a finding that
    clears its own threshold is evidence the triage model should not be
    allowed to overrule.
    """
    triage_says_normal = (
        triage_score is not None
        and triage_score < chest_triage_threshold
    )

    if triage_says_normal and not detected_findings:
        triage_result = "NORMAL"
        primary_finding = None
        confidence = round((1.0 - triage_score) * 100, 2)
        needs_doctor_review = False

    elif detected_findings:
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
    detected_region: str = "WRIST",
    region_note: str = "",
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

    """
    What the router saw is written into the message the doctor reads.
    An image that shows the hand together with the wrist is answered by
    the wrist model, and saying so is the difference between a reading
    that looks unexplained and one the doctor can judge.
    """
    if region_note:
        message = f"{message} {region_note}"

    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": "HAND_WRIST",
        "detectedRegion": detected_region,
        "regionNote": region_note or None,
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


"""
How close to the cut point counts as undecided for the hand.

The hand triage model separates the two classes cleanly on validation,
where healthy hands sit around 0.24 and injured ones around 0.77, so a
narrow band is enough. Widening it would only move confident answers
into "uncertain", which is the fault the chest clinic already had: ten
points there swallowed eight of twelve healthy chests.
"""
HAND_TRIAGE_UNCERTAINTY_MARGIN = 0.05

"""
How sure the router has to be before a hand goes to the hand model.

The router is right 98.2% of the time, and the cost of its two mistakes
is not the same. A wrist sent to the hand model loses 60% of fractures;
a hand sent to the wrist model is called abnormal and reaches a doctor,
which is a false alarm rather than a miss. So the hand pathway is only
taken when the router is clearly sure, and anything in between falls
through to the wrist model.
"""
HAND_ROUTING_CONFIDENCE = 0.75

"""
Where the router stops calling an image a wrist.

Between this point and the hand cut point the router leans towards a
hand without being sure of it, and that is what a radiograph showing the
hand together with the wrist looks like to a model that was trained to
pick one of the two. Such an image still goes to the wrist model, which
is the safer of the two readings, but it is reported as a hand with the
wrist rather than as a plain wrist, so nobody has to guess why the wrist
model read an image with fingers in it.
"""
HAND_WITH_WRIST_LOWER_BOUND = 0.5

"""
What the doctor is told about the region the router decided on, for the
images the wrist model answers. A plain wrist needs no note.
"""
UPPER_LIMB_REGION_NOTES = {
    "HAND_WITH_WRIST": (
        "The X-ray shows a hand together with the wrist, so it was "
        "read by the wrist model."
    ),
    "HAND": (
        "The X-ray was read as a hand, but no hand model is loaded, "
        "so the wrist model read it instead."
    ),
}


def run_hand_triage(
    image: UploadFile,
    image_array: np.ndarray,
    width: int,
    height: int,
    router_score: float,
) -> dict[str, Any]:
    """
    Answers a hand X-ray with the model trained on hands.

    EfficientNet rescales pixels inside the network, so the array is
    handed over as it is. Passing it through MobileNetV2's
    preprocess_input, as the wrist model needs, would feed it a range it
    never saw: the same mistake cost the chest clinic a correct reading
    of a healthy chest until it was found.
    """
    model_input = np.array(image_array, dtype=np.float32, copy=True)

    probability = float(
        hand_triage_model.predict(model_input, verbose=0)[0][0]
    )

    distance = probability - hand_triage_threshold

    if distance >= 0:
        result = "ABNORMAL"
        confidence = probability * 100
        needs_doctor_review = True
        priority = "NEEDS_REVIEW"
        message = (
            "This hand X-ray was read as abnormal in the preliminary "
            "analysis. Doctor review is required."
        )

    elif abs(distance) <= HAND_TRIAGE_UNCERTAINTY_MARGIN:
        result = "UNCERTAIN"
        confidence = probability * 100
        needs_doctor_review = True
        priority = "NEEDS_REVIEW"
        message = (
            "This hand X-ray was too close to the decision threshold to "
            "be called either way. Doctor review is required."
        )

    else:
        result = "NORMAL"
        confidence = (1.0 - probability) * 100
        needs_doctor_review = False
        priority = "ROUTINE"
        message = (
            "No abnormality was found in this hand X-ray in the "
            "preliminary analysis."
        )

    return {
        "success": True,
        "fileName": image.filename,
        "contentType": image.content_type,
        "width": width,
        "height": height,
        "bodyRegion": "HAND_WRIST",
        "detectedRegion": "HAND",
        "regionNote": None,
        "result": result,
        "triageResult": result,
        "confidence": round(confidence, 2),
        "primaryFinding": None,
        "possibleFindings": [],
        "allFindings": [],
        "noSupportedFindingDetected": result == "NORMAL",
        "priority": priority,
        "detectedClinic": "orthopedic",
        "needsDoctorReview": needs_doctor_review,
        "message": message,
        "modelName": HAND_TRIAGE_MODEL_PATH.name,
        "modelVersion": "2.0",
        "modelScope": "HAND",
        "abnormalityProbability": round(probability * 100, 2),
        "decisionThreshold": round(hand_triage_threshold * 100, 2),
        "routerConfidence": round(router_score * 100, 2),
        "supportedLabels": [],
        "disclaimer": (
            "This is a preliminary AI reading of a hand radiograph. It "
            "says whether the hand looks normal, not which injury is "
            "present, and does not replace a radiologist's "
            "interpretation or a doctor's final diagnosis."
        ),
    }


def classify_upper_limb_region(
    image_bytes: bytes,
) -> dict[str, Any]:
    """
    Reads which region the image shows, in three answers: a hand, a hand
    together with the wrist, or a wrist. The prepared image is returned
    with the decision, because whichever model answers needs the same
    array and an upload can only be read once.

    The router reads greyscale, because that is what it was trained on:
    an X-ray carries no colour, and training it on grey kept it from
    separating the two sources by an incidental colour cast.
    """
    image_array, width, height = prepare_image(image_bytes)

    grey = np.mean(image_array, axis=-1, keepdims=True)
    router_input = np.repeat(grey, 3, axis=-1).astype(np.float32)

    wrist_score = float(
        hand_wrist_router_model.predict(router_input, verbose=0)[0][0]
    )

    hand_score = 1.0 - wrist_score

    if hand_score >= HAND_ROUTING_CONFIDENCE:
        region = "HAND"

    elif hand_score >= HAND_WITH_WRIST_LOWER_BOUND:
        region = "HAND_WITH_WRIST"

    else:
        region = "WRIST"

    return {
        "region": region,
        "handScore": hand_score,
        "imageArray": image_array,
        "width": width,
        "height": height,
    }


@app.post("/predict/hand-wrist")
async def predict_hand_wrist(
    image: UploadFile = File(...),
):
    """
    One endpoint for the whole hand and wrist pathway.

    The image is sent to the model that was trained on the region it
    shows. The router decides the region; if the router says hand and a
    hand triage model is loaded, that model answers, and everything else
    goes down the wrist pathway as before.
    """
    image_bytes = await validate_and_read_image(image)

    routing: dict[str, Any] | None = None

    if hand_wrist_router_model is not None:
        try:
            routing = classify_upper_limb_region(image_bytes)

        except HTTPException:
            raise

        except Exception as error:
            """
            A failure in the router must not take the endpoint down with
            it. The wrist pathway below still answers, which is what the
            clinic had before either model existed.
            """
            print(f"Upper limb routing failed, using the wrist model: {error}")

            routing = None

    if (
        routing is not None
        and routing["region"] == "HAND"
        and hand_triage_model is not None
    ):
        return run_hand_triage(
            image=image,
            image_array=routing["imageArray"],
            width=routing["width"],
            height=routing["height"],
            router_score=float(routing["handScore"]),
        )

    """
    Everything else is read by the wrist model, and carries the region
    the router decided on so that the reading explains itself.
    """
    detected_region = (
        str(routing["region"]) if routing is not None else "WRIST"
    )

    use_hand_model = hand_wrist_model is not None

    """
    A dedicated hand and wrist model covers both regions, so a hand it
    reads needs no apology. The note about a missing hand model belongs
    only to the pediatric wrist model, which was never trained on hands.
    """
    region_note = (
        ""
        if use_hand_model and detected_region == "HAND"
        else UPPER_LIMB_REGION_NOTES.get(detected_region, "")
    )

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

    """
    The bytes were read once at the top of the endpoint. An upload can
    only be read once, so reading again here would hand the model an
    empty file. When the router already prepared the image, that array
    is reused rather than decoded a second time.
    """
    try:
        if routing is not None:
            image_array = routing["imageArray"]
            width = int(routing["width"])
            height = int(routing["height"])
        else:
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
            detected_region=detected_region,
            region_note=region_note,
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
        "metricsFile": "shoulder_triage_v4/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "shoulder_triage_v4/shoulder_triage_v4_model.keras",
        "dataset": "Shoulder X-ray triage set",
        "trainingImages": 3551,
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
        # This clinic runs two models, because one could not cover both
        # regions. The note is shown to doctors so that nobody has to
        # guess which model read a given study.
        "modelNote": (
            "Wrist images are read by a model trained on 14,000 "
            "pediatric wrists (GRAZPEDWRI-DX), which reports individual "
            "findings. Hand images are read by a separate model trained "
            "on 604 hand radiographs, which reports normal or abnormal "
            "only. A router decides which of the two the image shows, "
            "and is correct on 98.2% of held out images."
        ),
    },
    {
        "slug": "lower-limb",
        "name": "Leg & Foot Clinic",
        "regions": ["Leg & Foot"],
        # The metrics are the ones measured on the leg test split, not
        # on the whole BTXRD test split the model was also scored on:
        # what the doctor is told has to describe the images this
        # clinic actually sends it. The wider numbers are kept beside
        # them in test_metrics_all_regions.json.
        "metricsFile": "btxrd_lesion_all/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "btxrd_lesion_all/btxrd_lesion_all_model.keras",
        "dataset": "BTXRD, every region",
        "trainingImages": 2604,
    },
    {
        "slug": "spine",
        "name": "Spine Clinic",
        "regions": ["Spine"],
        "metricsFile": "spine_findings_v3/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": "spine_findings_v3/spine_findings_v3_model.keras",
        "dataset": "Cervical Spine X-ray Atlas",
        "trainingImages": 4963,
    },
    {
        "slug": "pelvis",
        "name": "Pelvis & Hip Clinic",
        "regions": ["Pelvis & Hip"],
        "metricsFile": "pelvis_hip_findings/test_metrics.json",
        "metricsFormat": "auc",
        "modelFile": (
            "pelvis_hip_findings/pelvis_hip_findings_model.keras"
        ),
        "dataset": "BTXRD pelvis subset",
        "trainingImages": 228,
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


def assemble_findings(
    labels: list[str],
    probabilities: np.ndarray,
    thresholds: dict[str, float],
    skipped: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """
    Turns the raw probabilities of a model into the findings list the
    application reads, and reports whether anything landed just under
    its threshold.

    The X-ray models and the volumetric ones share this step, so a
    finding is described the same way whichever kind of study produced
    it and only the wording around it differs.
    """
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

    return all_findings, detected_findings, near_threshold


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
            "scopeNote": None,
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

    all_findings, detected_findings, near_threshold = assemble_findings(
        labels=labels,
        probabilities=probabilities,
        thresholds=thresholds,
        skipped=skipped,
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

    """
    A model that covers less than the clinic it serves says so in every
    answer it gives, whatever the result was.
    """
    scope_note = str(definition.get("scopeNote") or "")

    if scope_note:
        message = f"{message} {scope_note}"

    return {
        **base,
        "scopeNote": scope_note or None,
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
# Volumetric studies
# =========================================================

"""
Registry of the volumetric models.

Everything above this line reads a single film. A CT or an MRI is a
stack of slices, and a finding that hides between two of them is only
visible when the stack is read as one body, which is what these models
do.

The contract is the one the X-ray regions already follow: a region
listed here is reachable from the application today, and a region
without a trained model answers NOT_ANALYZED and sends the study
straight to the specialist rather than inventing a finding. Training a
model activates it without a code change:

    models/<folder>/<folder>_model.keras
    models/<folder>/<folder>_thresholds.json

The thresholds file is the one scripts/train_region_3d.py writes, and
its volumeShape decides what every upload is resampled to, so a model
trained on 64 cubed volumes starts reading them at 64 cubed the moment
it is dropped in.

`window` is the Hounsfield range a CT is clipped to before it is read,
the same range a radiologist sets on the screen: air and lung sit low,
bone sits high, and a single range for both would flatten one of them.

`acceptsRawScan` is False for a model that was trained on shapes rather
than on images: the adrenal and the vessel sets hold segmentation masks,
two values and nothing between them, so a scan straight from a scanner
is unlike anything those models have seen. They still answer, and the
answer is confident and meaningless, which is the worst way for a model
to fail. They stay reachable for demonstration and are kept out of the
patient upload list, because a patient cannot produce a segmentation.

One trained model is deliberately absent from this table. The organ
model in models/abdomen_3d_organ3d names the body part in a volume, it
does not read a finding, and every answer it gives would arrive here as
an abnormality called "Organ Liver". It stays available for training and
for routing work, and out of the doctor's report.
"""
VOLUME_MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    "chest-ct-lungs": {
        "displayName": "Chest CT (Lungs)",
        "bodyRegion": "CHEST",
        "clinic": "chest",
        "modality": "CT",
        "folder": "chest_3d_mosmed",
        "window": (-1000.0, 400.0),
        # Kept out of the patient upload list.
        #
        # Measured on its own test split it reaches 0.756 ROC AUC, and
        # on four samples with known answers it missed both ill patients
        # and raised one false alarm. The cause is not the threshold,
        # which has already been retuned for recall: it is that the
        # model was trained on 200 volumes, and 200 whole chest scans
        # are not enough to learn what involvement looks like.
        #
        # A model that sends half of the ill home reading NORMAL is
        # worse for them than no model, because the answer arrives with
        # a number beside it and reads like an examination. The chest is
        # covered by the nodule model at 0.908 and by the X-ray models
        # at 0.88 to 0.90, so nothing is lost by leaving it here for
        # demonstration and out of the list a patient chooses from.
        "acceptsRawScan": False,
        # The one model here that reads a whole study. It was trained on
        # entire chest scans from the MosMed collection rather than on a
        # crop somebody had already centred on the finding, so unlike
        # its neighbours below it can be handed a scan as it arrives.
        "scopeNote": (
            "This model reads a whole chest CT and answers how much of "
            "the lung is involved. It was trained on COVID era scans, "
            "so it reports involvement rather than naming its cause."
        ),
    },
    "chest-ct": {
        "displayName": "Chest CT",
        "bodyRegion": "CHEST",
        "clinic": "chest",
        "modality": "CT",
        "folder": "chest_3d_nodule3d",
        "window": (-1000.0, 400.0),
        # Trained on nodule volumes cut out of LIDC-IDRI chest CT, so it
        # reads one nodule at a time. A whole chest scan resampled down
        # to the model's size loses the nodule entirely, which is why
        # this is stated in every answer rather than left to be assumed.
        "scopeNote": (
            "This model reads a volume cropped around a single lung "
            "nodule and answers whether that nodule looks malignant. It "
            "does not search a whole chest scan for nodules."
        ),
    },
    "chest-ct-ribs": {
        "displayName": "Rib CT",
        "bodyRegion": "CHEST",
        "clinic": "chest",
        "modality": "CT",
        # The 64 voxel model, not the 28 voxel one it replaced. Trained
        # on the same studies at four times the resolution per side,
        # and measured on the same test split:
        #
        #                        28 cubed   64 cubed
        #   displaced fracture     0.821      0.862
        #   buckle fracture        0.694      0.722
        #   nondisplaced           0.658      0.696
        #
        # Every type improved, and the largest gain went to the type
        # that matters most. A rib fracture is a few voxels wide, which
        # is why resolution buys more here than anywhere else in the
        # project. The 28 voxel model stays in models/chest_3d_fracture3d
        # so the two can be compared again.
        "folder": "chest_3d_fracture3d_64",
        "window": (-200.0, 1500.0),
        # Every volume in the training set held a fracture, so the model
        # was never shown an intact rib and cannot say that one is
        # intact. It sorts a fracture that is already known to be there.
        "scopeNote": (
            "This model reads a volume cropped around a known rib "
            "fracture and sorts which kind it is. It cannot tell an "
            "intact rib from a broken one."
        ),
    },
    "abdomen-ct": {
        "displayName": "Abdomen CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_adrenal3d",
        "acceptsRawScan": False,
        "window": (-150.0, 250.0),
        # Checked against the prepared volumes: they hold two values,
        # nothing and something. This model was trained on the shape of
        # an adrenal gland cut out of a CT, not on the greyscale of the
        # CT itself, so a scan handed to it straight from a scanner is
        # nothing like what it has seen. It needs a segmentation of the
        # gland as its input, which is why that is said here rather
        # than left for a doctor to discover from a wrong answer.
        "scopeNote": (
            "This model reads the shape of an already segmented adrenal "
            "gland, not a CT scan itself, and answers whether that "
            "gland carries a mass. Handing it a scan straight from the "
            "scanner gives an answer that means nothing."
        ),
    },
    "head-mri": {
        "displayName": "Head MRI",
        "bodyRegion": "HEAD",
        "clinic": "head",
        "modality": "MRI",
        "folder": "head_3d_brain_tumour",
        # Magnetic resonance carries no Hounsfield scale, so the range
        # is taken from the study itself rather than from a fixed pair
        # of numbers.
        "window": None,
        # Every study this was trained on held a glioma, so it is not
        # answering whether there is a tumour. It answers whether the
        # tumour takes up contrast, which is what separates a high
        # grade glioma from a low grade one, and it is the reason the
        # finding is treated as urgent.
        "scopeNote": (
            "This model reads a post contrast brain MRI of a known "
            "tumour and answers whether the tumour enhances. It cannot "
            "tell a brain with a tumour from one without."
        ),
    },
    "head-mra": {
        "displayName": "Head MRA",
        "bodyRegion": "HEAD",
        "clinic": "head",
        "modality": "MRA",
        "folder": "head_3d_vessel3d",
        "acceptsRawScan": False,
        # Magnetic resonance carries no Hounsfield scale, so the window
        # is taken from the volume itself rather than from a fixed pair
        # of numbers.
        "window": None,
        # The same holds here, and more strongly: these volumes are
        # vessel surfaces reconstructed from MRA and then voxelised, so
        # the model reads a shape and has never seen magnetic resonance
        # greyscale at all.
        "scopeNote": (
            "This model reads the reconstructed shape of a single brain "
            "vessel, not an MRA scan itself, and answers whether that "
            "vessel carries an aneurysm. Handing it a scan straight "
            "from the scanner gives an answer that means nothing."
        ),
    },
    # The remaining regions have no public volumetric dataset small
    # enough to train from here yet, so they are registered without a
    # model: the application can already send them, and each answers
    # NOT_ANALYZED until scripts/prepare_3d_data.py --dataset nifti is
    # pointed at a clinical collection and the model is trained.
    # The tumour models built from the Medical Segmentation Decathlon.
    # Each reads a volume cut around one organ and answers whether a
    # tumour is in it. They are registered before they are trained: a
    # region without a model answers NOT_ANALYZED and sends the study
    # to the specialist, and starts reading the day the model lands in
    # its folder.
    "chest-ct-tumour": {
        "displayName": "Lung Tumour CT",
        "bodyRegion": "CHEST",
        "clinic": "chest",
        "modality": "CT",
        "folder": "chest_3d_lung_tumour",
        "window": (-1000.0, 400.0),
        "scopeNote": (
            "This model reads a volume cut around part of a lung and "
            "answers whether a tumour is inside it."
        ),
    },
    "abdomen-ct-colon": {
        "displayName": "Colon CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_colon_tumour",
        "window": (-150.0, 250.0),
        "scopeNote": (
            "This model reads a volume cut around part of the colon and "
            "answers whether a cancer is inside it."
        ),
    },
    "abdomen-ct-liver-vessels": {
        "displayName": "Liver Vessels CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_hepatic_vessel_tumour",
        "window": (-150.0, 250.0),
        "scopeNote": (
            "This model reads a volume cut around the vessels of the "
            "liver and answers whether a tumour is inside it."
        ),
    },
    "abdomen-ct-pancreas": {
        "displayName": "Pancreas CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_pancreas_tumour",
        "window": (-150.0, 250.0),
        "scopeNote": (
            "This model reads a volume cut around the pancreas and "
            "answers whether a tumour is inside it."
        ),
    },
    "abdomen-ct-liver": {
        "displayName": "Liver CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_liver_tumour",
        "window": (-150.0, 250.0),
        "scopeNote": (
            "This model reads a volume cut around the liver and answers "
            "whether a tumour is inside it. It learned from twenty "
            "studies and scores 0.61 on its own test split, which is "
            "close to a coin toss. Read it as a reason to look at the "
            "liver yourself, never as a finding: it misses tumours "
            "about as often as it catches them."
        ),
    },
    # Added from the M3D-Seg collections, which publish each organ as
    # its own small archive. A kidney with its tumours cost under a
    # gigabyte where the Decathlon wanted twenty nine for the liver.
    "abdomen-ct-kidney": {
        "displayName": "Kidney CT",
        "bodyRegion": "ABDOMEN",
        "clinic": "general",
        "modality": "CT",
        "folder": "abdomen_3d_kidney_tumour",
        "window": (-150.0, 250.0),
        "scopeNote": (
            "This model reads a volume cut around a kidney and answers "
            "whether a tumour is inside it."
        ),
    },
    "spine-ct": {
        "displayName": "Spine CT",
        "bodyRegion": "SPINE",
        "clinic": "spine",
        "modality": "CT",
        "folder": "spine_3d_nifti",
        "window": (-200.0, 1500.0),
    },
    "pelvis-ct": {
        "displayName": "Pelvis & Hip CT",
        "bodyRegion": "PELVIS_HIP",
        "clinic": "orthopedic",
        "modality": "CT",
        "folder": "pelvis_3d_nifti",
        "window": (-200.0, 1500.0),
    },
    "lower-limb-ct": {
        "displayName": "Lower Limb CT",
        "bodyRegion": "LOWER_LIMB",
        "clinic": "orthopedic",
        "modality": "CT",
        "folder": "lower_limb_3d_nifti",
        "window": (-200.0, 1500.0),
    },
    "shoulder-ct": {
        "displayName": "Shoulder CT",
        "bodyRegion": "SHOULDER",
        "clinic": "orthopedic",
        "modality": "CT",
        "folder": "shoulder_3d_nifti",
        "window": (-200.0, 1500.0),
    },
}

"""
Loaded volumetric models, filled on the first request of each region.
"""
volume_model_cache: dict[str, dict[str, Any]] = {}

DEFAULT_VOLUME_SHAPE = (28, 28, 28)

"""
A volume is a stack of hundreds of slices, so the twenty megabyte limit
of a single film would reject nearly every real study.
"""
MAX_VOLUME_FILE_SIZE = 300 * 1024 * 1024

"""
What a volumetric study may arrive as.

The first three are research formats, and they are what every dataset
this project trains on is written in. The last two are what a hospital
actually sends: a DICOM file per slice, and a folder of them zipped up.
A system that reads only the research formats can be trained but never
installed.
"""
ALLOWED_VOLUME_SUFFIXES = (
    ".nii",
    ".nii.gz",
    ".npy",
    ".dcm",
    ".zip",
)


def load_volume_model(region_key: str) -> dict[str, Any]:
    """
    Loads the volumetric model of one region on first use and remembers
    the result, the same way the X-ray regions are loaded.
    """
    cached = volume_model_cache.get(region_key)

    definition = VOLUME_MODEL_REGISTRY[region_key]
    folder = str(definition["folder"])

    model_path = (
        AI_SERVICE_DIR / "models" / folder / f"{folder}_model.keras"
    )

    thresholds_path = (
        AI_SERVICE_DIR / "models" / folder / f"{folder}_thresholds.json"
    )

    """
    A cached model is kept only while its thresholds file is unchanged.

    A threshold is the one part of a model that is meant to move without
    retraining: scripts/retune_3d_thresholds.py exists to move it when a
    clinic decides the model is answering too loudly or too quietly.
    Caching the model and its thresholds together, and never looking at
    the file again, meant a retuned threshold reached nobody until
    somebody remembered to restart the service. Comparing the timestamp
    costs one stat call per request and makes the file the truth.
    """
    if cached is not None and cached["model"] is not None:
        try:
            unchanged = (
                cached.get("thresholdsAt")
                == thresholds_path.stat().st_mtime
            )
        except OSError:
            unchanged = False

        if unchanged:
            return cached

        print(
            f"{definition['displayName']} thresholds changed on disk, "
            "reading them again."
        )

    entry: dict[str, Any] = {
        "model": None,
        "labels": [],
        "thresholds": {},
        "disabledLabels": [],
        "volumeShape": DEFAULT_VOLUME_SHAPE,
        "window": None,
        "modelPath": model_path,
        "error": "",
    }

    """
    A missing model is not cached as a final answer: a newly trained
    model must be picked up without restarting the service.
    """
    if not model_path.exists() or not thresholds_path.exists():
        volume_model_cache[region_key] = entry
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
        The shape the uploaded study is resampled to is read from the
        model itself, so the two can never drift apart. The thresholds
        file records it as well, and is used when a saved model does not
        carry a fixed input shape.
        """
        input_shape = model.input_shape

        if isinstance(input_shape, list):
            input_shape = input_shape[0]

        shape_from_model = [
            int(value) for value in input_shape[1:4] if value
        ]

        if len(shape_from_model) == 3:
            volume_shape = tuple(shape_from_model)
        else:
            recorded = metadata.get("volumeShape")
            volume_shape = (
                tuple(int(value) for value in recorded)
                if isinstance(recorded, list) and len(recorded) == 3
                else DEFAULT_VOLUME_SHAPE
            )

        """
        The training run records the Hounsfield window its volumes were
        clipped to. A model served a different window than it was
        trained on sees numbers it has never met, so the recorded window
        wins over the one in the registry above.
        """
        recorded_window = metadata.get("huWindow")

        if isinstance(recorded_window, list) and len(recorded_window) == 2:
            low, high = (float(value) for value in recorded_window)

            if low < high:
                entry["window"] = (low, high)

        disabled = metadata.get("disabledLabels")
        entry["disabledLabels"] = (
            [str(name) for name in disabled]
            if isinstance(disabled, list)
            else []
        )

        entry["model"] = model
        entry["labels"] = labels
        entry["thresholds"] = thresholds
        entry["volumeShape"] = volume_shape
        entry["thresholdsAt"] = thresholds_path.stat().st_mtime

        print(
            f"{definition['displayName']} model loaded successfully. "
            f"Volume shape: {volume_shape}"
        )

    except Exception as error:
        entry["error"] = str(error)
        entry["failedAt"] = model_path.stat().st_mtime
        print(
            f"Failed to load the {definition['displayName']} model: "
            f"{error}"
        )

    volume_model_cache[region_key] = entry
    return entry


async def validate_and_read_volume(study: UploadFile) -> bytes:
    """
    A volume arrives as a file rather than as a picture, so it is
    checked by its name: browsers report no useful content type for a
    NIfTI upload.
    """
    file_name = (study.filename or "").lower()

    if not file_name.endswith(ALLOWED_VOLUME_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=(
                "Only NIfTI volumes (.nii, .nii.gz) and prepared .npy "
                "volumes are supported."
            ),
        )

    payload = await study.read()

    if not payload:
        raise HTTPException(
            status_code=400,
            detail="The uploaded study is empty.",
        )

    if len(payload) > MAX_VOLUME_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="The study must be smaller than 300 MB.",
        )

    return payload


def resample_volume(
    volume: np.ndarray,
    target_shape: tuple[int, int, int],
) -> np.ndarray:
    """
    Brings a study of any slice count down to the one shape the model
    was trained on.
    """
    if tuple(volume.shape) == tuple(target_shape):
        return volume

    try:
        from scipy import ndimage
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Volumetric studies need SciPy. Install it with "
                "pip install scipy."
            ),
        ) from error

    factors = [
        target / max(current, 1)
        for target, current in zip(target_shape, volume.shape)
    ]
    resized = ndimage.zoom(volume, factors, order=1)

    """
    Rounding inside the resampling can leave a voxel of slack, so the
    result is trimmed or padded to the exact shape the model expects.
    """
    fixed = np.zeros(target_shape, dtype=np.float32)
    cut = tuple(
        slice(0, min(target, current))
        for target, current in zip(target_shape, resized.shape)
    )
    fixed[cut] = resized[cut]
    return fixed


def read_dicom_series(payload: bytes, is_zip: bool) -> np.ndarray:
    """
    Rebuilds a volume out of what a hospital sends.

    A CT does not leave a scanner as one file. It leaves as one DICOM
    per slice, each carrying where in the patient it was taken, and the
    volume only exists once they are stacked back in that order. Three
    things have to go right for the result to mean anything.

    The slices are ordered by their position in the patient rather than
    by file name or by instance number. Exported folders arrive sorted
    by neither, and a stack assembled in the wrong order is anatomy that
    never existed.

    Only one series is kept. A single study routinely holds a scan
    before contrast and after it, a scout view, and a screenshot of the
    radiologist's measurements, all in one folder. Stacking them
    together would interleave different scans into one volume, so the
    longest series wins and the rest are left alone.

    The stored numbers are turned into Hounsfield units. DICOM keeps
    pixels as small integers and carries the slope and intercept needed
    to recover the real scale, and without applying them a window meant
    for bone lands somewhere meaningless.
    """
    try:
        import pydicom
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "DICOM studies need pydicom. Install it with "
                "pip install pydicom."
            ),
        ) from error

    datasets = []

    if is_zip:
        import zipfile

        try:
            with zipfile.ZipFile(BytesIO(payload)) as bundle:
                names = [
                    name
                    for name in bundle.namelist()
                    if not name.endswith("/")
                    and not name.split("/")[-1].startswith(".")
                ]

                for name in names:
                    try:
                        datasets.append(
                            pydicom.dcmread(
                                BytesIO(bundle.read(name)),
                                force=True,
                            )
                        )
                    except Exception:
                        """
                        A zip of a study carries readme files and
                        viewer settings beside the slices. Anything
                        that is not a DICOM is skipped rather than
                        failing the upload.
                        """
                        continue
        except zipfile.BadZipFile as error:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a readable zip archive.",
            ) from error
    else:
        try:
            datasets.append(
                pydicom.dcmread(BytesIO(payload), force=True)
            )
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a readable DICOM file.",
            ) from error

    datasets = [
        dataset
        for dataset in datasets
        if hasattr(dataset, "pixel_array") or "PixelData" in dataset
    ]

    if not datasets:
        raise HTTPException(
            status_code=400,
            detail=(
                "No image was found in the upload. A DICOM study needs "
                "the slice files themselves, not only a report."
            ),
        )

    """
    A study holds several series, and only one of them is the scan the
    model should read.
    """
    by_series: dict[str, list] = {}

    for dataset in datasets:
        key = str(getattr(dataset, "SeriesInstanceUID", "unknown"))
        by_series.setdefault(key, []).append(dataset)

    chosen = max(by_series.values(), key=len)

    def slice_position(dataset) -> float:
        """
        Where in the patient this slice was taken.

        The patient position is the truthful answer and is used when it
        is there. Instance number is a fallback: it usually agrees, and
        when it does not the scan was exported in a way this cannot
        rescue anyway.
        """
        position = getattr(dataset, "ImagePositionPatient", None)

        if position is not None and len(position) == 3:
            return float(position[2])

        return float(getattr(dataset, "InstanceNumber", 0) or 0)

    chosen.sort(key=slice_position)

    slices = []

    for dataset in chosen:
        try:
            pixels = dataset.pixel_array.astype(np.float32)
        except Exception:
            continue

        """
        A single file can hold the whole scan rather than one slice,
        which is how an ultrasound loop and some MRI exports arrive.
        """
        if pixels.ndim == 3:
            slices.extend(list(pixels))
            continue

        if pixels.ndim != 2:
            continue

        slope = float(getattr(dataset, "RescaleSlope", 1) or 1)
        intercept = float(getattr(dataset, "RescaleIntercept", 0) or 0)
        slices.append(pixels * slope + intercept)

    if not slices:
        raise HTTPException(
            status_code=400,
            detail="The DICOM files carried no readable image data.",
        )

    """
    Slices of one series share a size. A study that mixes sizes was
    assembled from more than one scan, and the majority size is kept so
    a stray screenshot cannot decide the shape of the volume.
    """
    shapes = [item.shape for item in slices]
    common = max(set(shapes), key=shapes.count)
    slices = [item for item in slices if item.shape == common]

    return np.stack(slices).astype(np.float32)


def prepare_volume(
    file_name: str,
    payload: bytes,
    target_shape: tuple[int, int, int],
    window: tuple[float, float] | None,
) -> tuple[np.ndarray, dict[str, Any]]:
    """
    Reads an uploaded study and returns it in the shape and the value
    range scripts/prepare_3d_data.py produced for training.

    A CT is stored in Hounsfield units, a scale that runs from air at
    -1000 past dense bone, and a raw scale like that lets the metal of
    an implant dominate every filter. The volume is therefore clipped to
    the window of its region first, exactly as a radiologist sets the
    window before looking. A study that carries no such scale, an MRI
    above all, is stretched between its own darkest and brightest voxel
    instead.
    """
    lowered = file_name.lower()

    if lowered.endswith((".dcm", ".zip")):
        volume = read_dicom_series(
            payload,
            is_zip=lowered.endswith(".zip"),
        )
    elif lowered.endswith(".npy"):
        try:
            volume = np.load(BytesIO(payload), allow_pickle=False)
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail="The uploaded .npy file could not be read.",
            ) from error
    else:
        try:
            import nibabel
        except ImportError as error:
            raise HTTPException(
                status_code=503,
                detail=(
                    "NIfTI studies need nibabel. Install it with "
                    "pip install nibabel."
                ),
            ) from error

        import tempfile

        suffix = ".nii.gz" if lowered.endswith(".nii.gz") else ".nii"

        """
        nibabel reads from a path, and the suffix is what tells it
        whether the bytes are compressed, so the upload is written out
        under its own suffix and removed again.
        """
        with tempfile.NamedTemporaryFile(
            suffix=suffix,
            delete=False,
        ) as handle:
            handle.write(payload)
            temporary_path = handle.name

        try:
            image = nibabel.load(temporary_path)
            volume = np.asarray(image.dataobj, dtype=np.float32)
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a readable NIfTI volume.",
            ) from error
        finally:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass

    volume = np.asarray(volume, dtype=np.float32)

    if volume.ndim == 4:
        volume = volume[..., 0]

    if volume.ndim != 3:
        raise HTTPException(
            status_code=400,
            detail=(
                "The uploaded study is not a 3D volume. Its shape is "
                f"{tuple(int(value) for value in volume.shape)}."
            ),
        )

    original_shape = tuple(int(value) for value in volume.shape)

    """
    A prepared volume already carries the eight bit range the training
    set used, so it is passed through untouched. Anything else is
    windowed here.
    """
    already_prepared = (
        float(volume.min()) >= 0.0 and float(volume.max()) <= 255.0
    )

    if not already_prepared:
        if window is not None:
            low, high = window
        else:
            low = float(volume.min())
            high = float(volume.max())

        volume = np.clip(volume, low, high)
        volume = (volume - low) / max(high - low, 1e-6)
        volume = volume * 255.0

    volume = resample_volume(volume, target_shape)
    volume = np.clip(volume, 0.0, 255.0).astype(np.float32)

    metadata = {
        "originalShape": list(original_shape),
        "sliceCount": original_shape[0],
        "analysedShape": [int(value) for value in target_shape],
        "windowed": not already_prepared,
    }

    return volume, metadata


def run_volume_model(
    entry: dict[str, Any],
    volume: np.ndarray,
) -> np.ndarray:
    """
    Runs one loaded volumetric model and returns its raw probabilities.
    The scaling to zero and one lives inside the saved model, so the
    volume is handed over in the same byte range it was trained on.
    """
    model_input = volume[np.newaxis, ..., np.newaxis]
    prediction = entry["model"].predict(model_input, verbose=0)
    return np.array(prediction[0], dtype=np.float32)


def build_volume_response(
    study: UploadFile,
    definition: dict[str, Any],
    probabilities: np.ndarray | None,
    labels: list[str],
    thresholds: dict[str, float],
    model_name: str | None,
    volume_metadata: dict[str, Any] | None = None,
    disabled_labels: list[str] | None = None,
) -> dict[str, Any]:
    """
    Builds the payload shape every other endpoint returns, so a
    volumetric study travels through the application on the same rails
    as a radiograph and nothing downstream has to learn a second format.
    """
    skipped = set(disabled_labels or [])
    display_name = str(definition["displayName"])
    modality = str(definition.get("modality") or "CT")

    base = {
        "success": True,
        "fileName": study.filename,
        "contentType": study.content_type,
        "bodyRegion": str(definition["bodyRegion"]),
        "detectedClinic": str(definition["clinic"]),
        "studyKind": "VOLUME",
        "modality": modality,
        "modelVersion": "1.0",
        **(volume_metadata or {}),
    }

    if probabilities is None:
        return {
            **base,
            "scopeNote": None,
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
                f"No AI model is installed for {display_name} studies "
                "yet, so the study was sent directly to the specialist "
                "doctor for review."
            ),
            "disclaimer": (
                "This study was not analysed by AI. The diagnosis "
                "comes from the reviewing doctor."
            ),
        }

    all_findings, detected_findings, near_threshold = assemble_findings(
        labels=labels,
        probabilities=probabilities,
        thresholds=thresholds,
        skipped=skipped,
    )

    detected_codes = {str(item["code"]) for item in detected_findings}

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
            "study. Doctor review is required."
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

    """
    A model that covers less than the study it was handed says so in
    every answer it gives. It matters more here than on a single film:
    these models read a cropped part of a scan, and a doctor who assumed
    the whole scan had been searched would be trusting an answer that
    was never given.
    """
    scope_note = str(definition.get("scopeNote") or "")

    if scope_note:
        message = f"{message} {scope_note}"

    return {
        **base,
        "scopeNote": scope_note or None,
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
            "studies with a limited supported label set. They do not "
            "replace a radiologist's interpretation or a doctor's final "
            "diagnosis."
        ),
    }


@app.post("/predict/volume/{region_key}")
async def predict_volume(
    region_key: str,
    study: UploadFile = File(...),
):
    """
    One endpoint for every volumetric study. The region decides which
    model runs and which clinic receives the case.
    """
    definition = VOLUME_MODEL_REGISTRY.get(region_key)

    if definition is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown volumetric region: {region_key}. Supported "
                f"regions: {', '.join(VOLUME_MODEL_REGISTRY)}"
            ),
        )

    payload = await validate_and_read_volume(study)

    try:
        entry = load_volume_model(region_key)

        if entry["model"] is None:
            return build_volume_response(
                study=study,
                definition=definition,
                probabilities=None,
                labels=[],
                thresholds={},
                model_name=None,
            )

        volume, volume_metadata = prepare_volume(
            file_name=study.filename or "",
            payload=payload,
            target_shape=entry["volumeShape"],
            window=entry.get("window") or definition.get("window"),
        )

        return build_volume_response(
            study=study,
            definition=definition,
            probabilities=run_volume_model(entry, volume),
            labels=entry["labels"],
            thresholds=entry["thresholds"],
            model_name=entry["modelPath"].name,
            volume_metadata=volume_metadata,
            disabled_labels=entry.get("disabledLabels"),
        )

    except HTTPException:
        raise

    except Exception as error:
        print(f"{region_key} volume prediction error: {error}")

        raise HTTPException(
            status_code=500,
            detail=(
                f"The {definition['displayName']} analysis failed."
            ),
        ) from error


@app.post("/render/volume")
async def render_volume(study: UploadFile = File(...)):
    """
    Turns an uploaded volume into something a browser can show.

    A doctor handed a .nii.gz has a file they cannot open: no browser
    draws a stack of slices, and asking a radiologist to install a
    viewer to read a case is asking them not to read it. The service
    already knows how to read every format the clinic sends, so it does
    the drawing here and returns one PNG holding every slice in a grid.

    One image rather than one request per slice, because a chest CT is
    hundreds of slices and a page that fetches them one at a time spends
    its first ten seconds on network round trips. The grid is drawn once
    and the viewer cuts it up on a canvas, which is instant.

    The volume is NOT resampled to a model's input size here. This is
    what the scan looks like, not what a model was fed, and shrinking it
    to 64 voxels would show the doctor a blur the patient never had.
    """
    payload = await validate_and_read_volume(study)
    file_name = (study.filename or "").lower()

    try:
        if file_name.endswith((".dcm", ".zip")):
            volume = read_dicom_series(
                payload,
                is_zip=file_name.endswith(".zip"),
            )
        elif file_name.endswith(".npy"):
            volume = np.load(BytesIO(payload), allow_pickle=False)
        else:
            import tempfile

            import nibabel

            suffix = ".nii.gz" if file_name.endswith(".nii.gz") else ".nii"

            with tempfile.NamedTemporaryFile(
                suffix=suffix,
                delete=False,
            ) as handle:
                handle.write(payload)
                temporary_path = handle.name

            try:
                image = nibabel.load(temporary_path)
                volume = np.asarray(image.dataobj, dtype=np.float32)
            finally:
                try:
                    os.unlink(temporary_path)
                except OSError:
                    pass

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail="This study could not be read for viewing.",
        ) from error

    volume = np.asarray(volume, dtype=np.float32)

    if volume.ndim == 4:
        volume = volume[..., 0]

    if volume.ndim != 3:
        raise HTTPException(
            status_code=400,
            detail="This file is not a 3D volume.",
        )

    """
    Stretched between its own darkest and brightest voxel, which is what
    a radiologist does with the window control before reading. A CT left
    on its raw Hounsfield range comes out as a flat grey rectangle.
    """
    low = float(np.percentile(volume, 1))
    high = float(np.percentile(volume, 99))

    if high - low < 1e-6:
        low, high = float(volume.min()), float(volume.max())

    scaled = np.clip((volume - low) / max(high - low, 1e-6), 0.0, 1.0)
    scaled = (scaled * 255.0).astype(np.uint8)

    depth, height, width = scaled.shape

    """
    A tall stack is thinned rather than drawn whole. Six hundred slices
    at full size is a sixty megabyte image, and a doctor scrolling
    through it cannot see the difference between slice 300 and 301
    anyway. Every slice is kept up to the cap; past it they are sampled
    evenly so the first and last are always among them.
    """
    maximum_slices = 160
    if depth > maximum_slices:
        indices = np.linspace(0, depth - 1, maximum_slices).astype(int)
    else:
        indices = np.arange(depth)

    """
    Long thin slices are shrunk so the grid stays inside what a browser
    will hold as one texture.
    """
    tile = 256
    scale = min(1.0, tile / max(height, width))
    tile_height = max(1, int(round(height * scale)))
    tile_width = max(1, int(round(width * scale)))

    columns = int(np.ceil(np.sqrt(len(indices))))
    rows = int(np.ceil(len(indices) / columns))

    sheet = Image.new(
        "L",
        (columns * tile_width, rows * tile_height),
        color=0,
    )

    for position, index in enumerate(indices):
        frame = Image.fromarray(scaled[int(index)], mode="L")

        if (tile_width, tile_height) != (width, height):
            frame = frame.resize(
                (tile_width, tile_height),
                Image.BILINEAR,
            )

        sheet.paste(
            frame,
            (
                (position % columns) * tile_width,
                (position // columns) * tile_height,
            ),
        )

    buffer = BytesIO()
    sheet.save(buffer, format="PNG", optimize=True)

    """
    The layout travels in the headers rather than in a second request,
    so the viewer knows how to cut the sheet up the moment the image
    arrives.
    """
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={
            "X-Slice-Count": str(len(indices)),
            "X-Slice-Columns": str(columns),
            "X-Slice-Rows": str(rows),
            "X-Tile-Width": str(tile_width),
            "X-Tile-Height": str(tile_height),
            "X-Original-Depth": str(depth),
        },
    )


@app.get("/volumes")
def list_volume_regions():
    """
    Tells the application which volumetric studies can be sent and which
    of them already have a trained model behind them.
    """
    volumes = []

    for region_key, definition in VOLUME_MODEL_REGISTRY.items():
        entry = load_volume_model(region_key)

        volumes.append(
            {
                "region": region_key,
                "displayName": definition["displayName"],
                "bodyRegion": definition["bodyRegion"],
                "clinic": definition["clinic"],
                "modality": definition.get("modality"),
                "endpoint": f"/predict/volume/{region_key}",
                "accepts": list(ALLOWED_VOLUME_SUFFIXES),
                "modelAvailable": entry["model"] is not None,
                "acceptsRawScan": bool(
                    definition.get("acceptsRawScan", True)
                ),
                "labels": entry["labels"],
                "volumeShape": list(entry["volumeShape"]),
                "window": list(
                    entry.get("window") or definition.get("window") or []
                ),
                "scopeNote": definition.get("scopeNote"),
                "error": entry["error"],
            }
        )

    return {"success": True, "volumes": volumes}


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

        triage_score = None

        if chest_triage_model is not None:
            """
            The two chest models want different input. The findings model
            is an EfficientNet, which carries its own rescaling and takes
            the raw 0 to 255 values prepare_image returns. The triage
            model is a MobileNetV2 and was trained on preprocess_input
            output, so it is scaled here. Feeding it the raw array
            returns a confident answer that means nothing.
            """
            triage_input = tf.keras.applications.mobilenet_v2.preprocess_input(
                image_array.copy()
            )

            triage_score = float(
                chest_triage_model.predict(
                    triage_input,
                    verbose=0,
                )[0][0]
            )

        return build_chest_findings_response(
            image=image,
            width=width,
            height=height,
            probabilities=probabilities,
            triage_score=triage_score,
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
                """
                The fracture model is reported, never allowed to
                overturn the triage decision.

                Its middle band runs from 0.145 to 0.80, and measured
                over the 762 image test set every single image fell
                inside it, including all 615 normal shoulders. Nothing
                scored above 0.80 and nothing below 0.145. A band that
                catches everything says nothing, so a normal shoulder
                was reported as uncertain every time.

                The triage model is the one trained and measured for
                this question, so it keeps the decision. The fracture
                probability still travels in the response for the doctor
                to see.
                """
                response["primaryFinding"] = (
                    "Uncertain fracture finding"
                )

                response["triageResult"] = response["result"]

                """
                The confidence and the message follow the triage
                decision, not the fracture model. Reporting the fracture
                probability as the confidence of a normal result told
                the patient a number that answers a different question.
                """
                response["priority"] = (
                    "NEEDS_REVIEW"
                    if response["needsDoctorReview"]
                    else "ROUTINE"
                )
                response["message"] = create_result_message(
                    response["result"],
                    "SHOULDER",
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