"""
Lists the public datasets this project can be trained on, what each one
actually diagnoses, what it costs in disk, and what it takes to get it.

The point of this file is to keep one honest answer to a question that
comes up constantly: can we cover this body region too? A dataset that
needs a signed agreement is not the same as one that downloads itself,
and a 350 GB collection is not an option on a laptop with 24 GB free.
Writing all three facts down next to each other is what turns that
question into a decision instead of an afternoon of searching.

    python scripts/dataset_catalogue.py
    python scripts/dataset_catalogue.py --fits
    python scripts/dataset_catalogue.py --check --dimension 3D

A size of "?" means it was never measured from here, which is the case
for every dataset that sits behind a login.
"""

from __future__ import annotations

import argparse
import shutil
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DIRECT = "downloads itself"
KAGGLE = "free Kaggle account"
AGREEMENT = "signed access agreement"
LOCAL = "already downloaded here"

"""
Every entry answers the same four questions: what does it diagnose, how
big is it, what does it take to get it, and can this project prepare it
today.

`prepare` is the command that turns the raw download into training data.
An entry without one is a dataset the project can hold but cannot yet
read, and saying so plainly is more useful than leaving it off the list.
"""
CATALOGUE: list[dict] = [
    {
        "key": "mosmed",
        "dimension": "3D",
        "region": "chest",
        "modality": "CT",
        "diagnoses": "COVID lung involvement, none against severe",
        "size_gb": 2.1,
        "access": DIRECT,
        "url": (
            "https://github.com/hasibzunair/"
            "3D-image-classification-tutorial/releases/tag/v0.2"
        ),
        "prepare": (
            "python scripts/prepare_3d_data.py chest --dataset mosmed "
            "--target-shape 64 64 64"
        ),
        "note": (
            "Whole chest scans at the size a hospital stores them, not "
            "crops around a finding somebody already found. The most "
            "realistic 3D set here."
        ),
    },
    {
        "key": "nodule3d",
        "dimension": "3D",
        "region": "chest",
        "modality": "CT",
        "diagnoses": "lung nodule, benign against malignant",
        "size_gb": 0.03,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": (
            "python scripts/prepare_3d_data.py chest --dataset nodule3d"
        ),
        "note": "A 28 voxel crop around one nodule. Trains on a CPU.",
    },
    {
        "key": "fracture3d",
        "dimension": "3D",
        "region": "chest",
        "modality": "CT",
        "diagnoses": "rib fracture type, three kinds",
        "size_gb": 0.003,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": (
            "python scripts/prepare_3d_data.py chest --dataset fracture3d"
        ),
        "note": "Holds no intact rib, so it cannot rule a fracture out.",
    },
    {
        "key": "adrenal3d",
        "dimension": "3D",
        "region": "abdomen",
        "modality": "CT",
        "diagnoses": "adrenal gland mass",
        "size_gb": 0.02,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": (
            "python scripts/prepare_3d_data.py abdomen --dataset adrenal3d"
        ),
        "note": "",
    },
    {
        "key": "vessel3d",
        "dimension": "3D",
        "region": "head",
        "modality": "MRA",
        "diagnoses": "intracranial aneurysm",
        "size_gb": 0.02,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": (
            "python scripts/prepare_3d_data.py head --dataset vessel3d"
        ),
        "note": "",
    },
    {
        "key": "organ3d",
        "dimension": "3D",
        "region": "abdomen",
        "modality": "CT",
        "diagnoses": "names 11 organs, not a finding",
        "size_gb": 0.03,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": (
            "python scripts/prepare_3d_data.py abdomen --dataset organ3d"
        ),
        "note": "Routing only. Kept out of the doctor's report.",
    },
    {
        "key": "totalsegmentator_small",
        "dimension": "3D",
        "region": "whole body",
        "modality": "CT",
        "diagnoses": "anatomy of 117 structures, no disease labels",
        "size_gb": 3.2,
        "access": DIRECT,
        "url": "https://zenodo.org/records/10047263",
        "prepare": "",
        "note": (
            "102 whole body scans covering every region this project "
            "has a clinic for. Masks of anatomy, not diagnoses, so it "
            "can teach a 3D region router but never a finding."
        ),
    },
    {
        "key": "totalsegmentator_full",
        "dimension": "3D",
        "region": "whole body",
        "modality": "CT",
        "diagnoses": "anatomy of 117 structures, no disease labels",
        "size_gb": 23.6,
        "access": DIRECT,
        "url": "https://zenodo.org/records/10047292",
        "prepare": "",
        "note": "1228 scans. Unpacking it needs the same space again.",
    },
    {
        "key": "rsna_cervical_spine",
        "dimension": "3D",
        "region": "spine",
        "modality": "CT",
        "diagnoses": "cervical vertebra fracture, per vertebra",
        "size_gb": None,
        "access": KAGGLE,
        "url": (
            "https://kaggle.com/competitions/"
            "rsna-2022-cervical-spine-fracture-detection"
        ),
        "prepare": "",
        "note": (
            "Hundreds of gigabytes. Belongs on Kaggle's own machines, "
            "not on this one."
        ),
    },
    {
        "key": "rsna_brain_tumour",
        "dimension": "3D",
        "region": "head",
        "modality": "MRI",
        "diagnoses": "glioblastoma MGMT methylation status",
        "size_gb": None,
        "access": KAGGLE,
        "url": (
            "https://kaggle.com/competitions/"
            "rsna-miccai-brain-tumor-radiogenomic-classification"
        ),
        "prepare": "",
        "note": "",
    },
    {
        "key": "mrnet_knee",
        "dimension": "3D",
        "region": "lower limb",
        "modality": "MRI",
        "diagnoses": "knee ACL tear, meniscal tear, abnormality",
        "size_gb": None,
        "access": AGREEMENT,
        "url": "https://stanfordmlgroup.github.io/competitions/mrnet",
        "prepare": "",
        "note": "The nearest thing to a 3D knee diagnosis set.",
    },
    {
        "key": "chestmnist",
        "dimension": "2D",
        "region": "chest",
        "modality": "X-ray",
        "diagnoses": "14 chest findings, from NIH ChestX-ray14",
        "size_gb": 3.9,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": "",
        "note": (
            "112120 films at 224 pixels, the whole NIH collection in "
            "one download. Needs a 2D adapter written for it."
        ),
    },
    {
        "key": "pneumoniamnist",
        "dimension": "2D",
        "region": "chest",
        "modality": "X-ray",
        "diagnoses": "paediatric pneumonia",
        "size_gb": 0.21,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": "",
        "note": "",
    },
    {
        "key": "breastmnist",
        "dimension": "2D",
        "region": "breast",
        "modality": "ultrasound",
        "diagnoses": "breast mass, benign against malignant",
        "size_gb": 0.03,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": "",
        "note": "A modality this project has no clinic for yet.",
    },
    {
        "key": "retinamnist",
        "dimension": "2D",
        "region": "eye",
        "modality": "fundus photo",
        "diagnoses": "diabetic retinopathy grade",
        "size_gb": 0.13,
        "access": DIRECT,
        "url": "https://medmnist.com",
        "prepare": "",
        "note": "A modality this project has no clinic for yet.",
    },
    {
        "key": "btxrd",
        "dimension": "2D",
        "region": "pelvis, lower limb",
        "modality": "X-ray",
        "diagnoses": "bone lesion, benign against malignant",
        "size_gb": None,
        "access": LOCAL,
        "url": "",
        "prepare": (
            "python scripts/prepare_btxrd_region_data.py lower_limb"
        ),
        "note": "",
    },
    {
        "key": "fracatlas",
        "dimension": "2D",
        "region": "several",
        "modality": "X-ray",
        "diagnoses": "fracture visible",
        "size_gb": None,
        "access": LOCAL,
        "url": "",
        "prepare": "python scripts/prepare_fracatlas_fracture_data.py",
        "note": "Feeds the shared fracture model every bone region runs.",
    },
    {
        "key": "mura",
        "dimension": "2D",
        "region": "elbow, forearm, humerus",
        "modality": "X-ray",
        "diagnoses": "abnormality, per study",
        "size_gb": None,
        "access": AGREEMENT,
        "url": "https://stanfordmlgroup.github.io/competitions/mura",
        "prepare": "",
        "note": (
            "The gap in the upper limb: this project reads a hand and a "
            "shoulder, and nothing between them."
        ),
    },
]


def free_disk_gb() -> float:
    return shutil.disk_usage(PROJECT_ROOT).free / 1e9


def check_url(url: str) -> str:
    """
    Asks the server whether the dataset is still where it was. A link
    that rotted silently is worse than no link, because it is only
    discovered halfway through a training run.
    """
    if not url:
        return "-"

    try:
        request = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": "radiocare-catalogue"},
        )

        with urllib.request.urlopen(request, timeout=30) as response:
            return str(response.status)
    except Exception as error:
        return str(error)[:30]


def format_size(size_gb: float | None) -> str:
    if size_gb is None:
        return "?"

    if size_gb < 1:
        return f"{size_gb * 1000:.0f} MB"

    return f"{size_gb:.1f} GB"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List the datasets this project can train on."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Ask every server whether its dataset is still there.",
    )
    parser.add_argument(
        "--fits",
        action="store_true",
        help="Show only what fits in the free disk space left.",
    )
    parser.add_argument(
        "--dimension",
        choices=["2D", "3D"],
        default=None,
        help="Show one kind only.",
    )
    arguments = parser.parse_args()

    free = free_disk_gb()
    print(f"Free disk: {free:.1f} GB")

    for dimension in ("3D", "2D"):
        if arguments.dimension and arguments.dimension != dimension:
            continue

        entries = [
            entry for entry in CATALOGUE if entry["dimension"] == dimension
        ]

        if arguments.fits:
            """
            An archive has to be unpacked, so a dataset needs roughly
            twice its download size before it is usable. Listing a row
            that fits by download size alone would be a promise this
            machine cannot keep.
            """
            entries = [
                entry
                for entry in entries
                if entry["size_gb"] is not None
                and entry["size_gb"] * 2 < free
            ]

        if not entries:
            continue

        print(f"\n=== {dimension} " + "=" * 60)

        for entry in entries:
            ready = "ready" if entry["prepare"] else "needs an adapter"

            print(
                f"\n{entry['key']}  [{entry['region']}, "
                f"{entry['modality']}]  {format_size(entry['size_gb'])}"
            )
            print(f"    reads:  {entry['diagnoses']}")
            print(f"    access: {entry['access']}  ({ready})")

            if entry["note"]:
                print(f"    note:   {entry['note']}")

            if entry["prepare"]:
                print(f"    run:    {entry['prepare']}")

            if arguments.check and entry["url"]:
                print(
                    f"    url:    [{check_url(entry['url'])}] "
                    f"{entry['url']}"
                )

    print(
        "\n'ready' means this project turns the download into training "
        "data today.\nThe rest can be downloaded but still need an "
        "adapter written for them."
    )


if __name__ == "__main__":
    main()
