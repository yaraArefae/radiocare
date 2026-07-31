from __future__ import annotations

import csv
import shutil
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent.parent

FRACATLAS_ROOT = (
    BASE_DIR
    / "data"
    / "shoulder_diseases"
    / "prepared"
    / "fracatlas_shoulder"
)

FRACATLAS_CSV = (
    FRACATLAS_ROOT
    / "fracatlas_shoulder_labels.csv"
)

IMPLANT_ROOT = (
    BASE_DIR
    / "data"
    / "shoulder_diseases"
    / "prepared"
    / "implant"
)

IMPLANT_CSV = (
    IMPLANT_ROOT
    / "implant_labels.csv"
)

OUTPUT_ROOT = (
    BASE_DIR
    / "data"
    / "shoulder_findings"
)

OUTPUT_IMAGES = OUTPUT_ROOT / "images"
OUTPUT_CSV = OUTPUT_ROOT / "labels_available.csv"

LABEL_COLUMNS = [
    "image_path",
    "normal",
    "fracture",
    "dislocation",
    "osteoarthritis",
    "calcific_tendinopathy",
    "avascular_necrosis",
    "cuff_arthropathy",
    "hardware",
    "other_abnormality",
    "source",
]


def copy_image(
    source_root: Path,
    relative_path: str,
    prefix: str,
    index: int,
) -> str:
    source_path = source_root / relative_path
    if not source_path.is_file():
        raise FileNotFoundError(
            f"Image was not found:\n{source_path}"
        )

    extension = source_path.suffix.lower()
    new_name = f"{prefix}_{index:05d}{extension}"
    destination = OUTPUT_IMAGES / new_name

    shutil.copy2(source_path, destination)

    return f"images/{new_name}"


def normalize_binary(value: object) -> int:
    try:
        return 1 if int(float(value)) == 1 else 0
    except (TypeError, ValueError):
        return 0


def main() -> None:
    if not FRACATLAS_CSV.is_file():
        raise FileNotFoundError(
            f"FracAtlas CSV not found:\n{FRACATLAS_CSV}"
        )

    if not IMPLANT_CSV.is_file():
        raise FileNotFoundError(
            f"Implant CSV not found:\n{IMPLANT_CSV}"
        )

    OUTPUT_IMAGES.mkdir(
        parents=True,
        exist_ok=True,
    )

    # Clean only previously merged images.
    for image in OUTPUT_IMAGES.glob(
        "fracatlas_merged_*"
    ):
        image.unlink()

    for image in OUTPUT_IMAGES.glob(
        "implant_merged_*"
    ):
        image.unlink()

    output_rows: list[dict[str, object]] = []

    fracatlas = pd.read_csv(FRACATLAS_CSV)

    for index, row in fracatlas.iterrows():
        merged_path = copy_image(
            FRACATLAS_ROOT,
            str(row["image_path"]),
            "fracatlas_merged",
            index + 1,
        )

        output_rows.append(
            {
                "image_path": merged_path,
                "normal": normalize_binary(
                    row.get("normal", 0)
                ),
                "fracture": normalize_binary(
                    row.get("fracture", 0)
                ),
                "dislocation": 0,
                "osteoarthritis": 0,
                "calcific_tendinopathy": 0,
                "avascular_necrosis": 0,
                "cuff_arthropathy": 0,
                "hardware": normalize_binary(
                    row.get("hardware", 0)
                ),
                "other_abnormality": 0,
                "source": "FracAtlas",
            }
        )

    implant = pd.read_csv(IMPLANT_CSV)

    for index, row in implant.iterrows():
        merged_path = copy_image(
            IMPLANT_ROOT,
            str(row["image_path"]),
            "implant_merged",
            index + 1,
        )

        output_rows.append(
            {
                "image_path": merged_path,
                "normal": 0,
                "fracture": 0,
                "dislocation": 0,
                "osteoarthritis": 0,
                "calcific_tendinopathy": 0,
                "avascular_necrosis": 0,
                "cuff_arthropathy": 0,
                "hardware": 1,
                "other_abnormality": 0,
                "source": "Shoulder Implant X-Ray",
            }
        )

    with OUTPUT_CSV.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=LABEL_COLUMNS,
        )
        writer.writeheader()
        writer.writerows(output_rows)

    counts = {
        column: sum(
            int(row[column])
            for row in output_rows
        )
        for column in LABEL_COLUMNS[1:10]
    }

    print("\nShoulder sources merged successfully.")
    print(f"Total images: {len(output_rows)}")
    for name, count in counts.items():
        print(f"{name}: {count}")

    print(f"\nImages folder:\n{OUTPUT_IMAGES}")
    print(f"\nLabels CSV:\n{OUTPUT_CSV}")
    print(
        "\nDo not rename labels_available.csv to labels.csv yet. "
        "The full model still needs labeled images for dislocation, "
        "osteoarthritis, calcific tendinopathy, avascular necrosis, "
        "and cuff arthropathy."
    )


if __name__ == "__main__":
    main()