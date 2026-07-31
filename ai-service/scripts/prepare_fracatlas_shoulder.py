from __future__ import annotations

import csv
import shutil
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent.parent

SOURCE_ROOT = (
    BASE_DIR
    / "data"
    / "shoulder_diseases"
    / "sources"
    / "fracatlas"
    / "extracted"
)

OUTPUT_ROOT = (
    BASE_DIR
    / "data"
    / "shoulder_diseases"
    / "prepared"
    / "fracatlas_shoulder"
)

OUTPUT_IMAGES = OUTPUT_ROOT / "images"
OUTPUT_CSV = OUTPUT_ROOT / "fracatlas_shoulder_labels.csv"


def find_one(root: Path, name: str) -> Path:
    matches = list(root.rglob(name))

    if not matches:
        raise FileNotFoundError(
            f"Could not find {name!r} anywhere under:\n{root}"
        )

    if len(matches) > 1:
        print(
            f"Warning: found {len(matches)} copies of {name}; "
            f"using:\n{matches[0]}"
        )

    return matches[0]


def find_image(
    images_root: Path,
    image_id: str,
    fractured: int,
) -> Path:
    expected_folder = (
        "Fractured"
        if fractured == 1
        else "Non_fractured"
    )

    candidate = images_root / expected_folder / image_id

    if candidate.is_file():
        return candidate

    matches = list(images_root.rglob(image_id))

    if not matches:
        raise FileNotFoundError(
            f"Image not found for image_id={image_id}"
        )

    return matches[0]


def main() -> None:
    dataset_csv = find_one(
        SOURCE_ROOT,
        "dataset.csv",
    )

    fracatlas_root = dataset_csv.parent
    images_root = fracatlas_root / "images"

    if not images_root.exists():
        images_root = find_one(
            fracatlas_root,
            "images",
        )

    dataframe = pd.read_csv(dataset_csv)

    required_columns = {
        "image_id",
        "shoulder",
        "hardware",
        "fractured",
    }

    missing = required_columns.difference(
        dataframe.columns
    )

    if missing:
        raise ValueError(
            "dataset.csv is missing required columns: "
            + ", ".join(sorted(missing))
        )

    shoulder_rows = dataframe[
        dataframe["shoulder"].astype(int) == 1
    ].copy()

    if shoulder_rows.empty:
        raise ValueError(
            "No shoulder rows were found in dataset.csv."
        )

    OUTPUT_IMAGES.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_rows: list[dict[str, object]] = []
    skipped = 0

    for _, row in shoulder_rows.iterrows():
        image_id = str(row["image_id"]).strip()
        fractured = int(row["fractured"])
        hardware = int(row["hardware"])

        try:
            source_image = find_image(
                images_root,
                image_id,
                fractured,
            )
        except FileNotFoundError as error:
            print(f"Skipping {image_id}: {error}")
            skipped += 1
            continue

        destination = OUTPUT_IMAGES / image_id

        shutil.copy2(
            source_image,
            destination,
        )

        normal = int(
            fractured == 0
            and hardware == 0
        )

        output_rows.append(
            {
                "image_path": (
                    destination
                    .relative_to(OUTPUT_ROOT)
                    .as_posix()
                ),
                "normal": normal,
                "fracture": fractured,
                "hardware": hardware,
                "mixed": int(
                    row.get("mixed", 0)
                ),
                "multiscan": int(
                    row.get("multiscan", 0)
                ),
                "frontal": int(
                    row.get("frontal", 0)
                ),
                "lateral": int(
                    row.get("lateral", 0)
                ),
                "oblique": int(
                    row.get("oblique", 0)
                ),
                "fracture_count": int(
                    row.get("fracture_count", 0)
                ),
                "source": "FracAtlas",
                "original_image_id": image_id,
            }
        )

    fieldnames = [
        "image_path",
        "normal",
        "fracture",
        "hardware",
        "mixed",
        "multiscan",
        "frontal",
        "lateral",
        "oblique",
        "fracture_count",
        "source",
        "original_image_id",
    ]

    with OUTPUT_CSV.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )
        writer.writeheader()
        writer.writerows(output_rows)

    total = len(output_rows)
    normal_count = sum(
        int(row["normal"])
        for row in output_rows
    )
    fracture_count = sum(
        int(row["fracture"])
        for row in output_rows
    )
    hardware_count = sum(
        int(row["hardware"])
        for row in output_rows
    )
    fracture_with_hardware = sum(
        int(row["fracture"] == 1 and row["hardware"] == 1)
        for row in output_rows
    )

    print("\nFracAtlas shoulder extraction completed.")
    print(f"Shoulder images copied: {total}")
    print(f"NORMAL: {normal_count}")
    print(f"FRACTURE: {fracture_count}")
    print(f"HARDWARE: {hardware_count}")
    print(
        "FRACTURE + HARDWARE: "
        f"{fracture_with_hardware}"
    )
    print(f"Skipped missing images: {skipped}")
    print(f"\nImages folder:\n{OUTPUT_IMAGES}")
    print(f"\nLabels CSV:\n{OUTPUT_CSV}")


if __name__ == "__main__":
    main()