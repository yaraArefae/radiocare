from pathlib import Path
import csv

BASE_DIR = Path(__file__).resolve().parent.parent
SOURCE_DIR = BASE_DIR / "data" / "shoulder" / "processed"
OUTPUT_DIR = BASE_DIR / "data" / "shoulder_findings"
OUTPUT_PATH = OUTPUT_DIR / "labels_to_review.csv"

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}

FINDING_COLUMNS = [
    "fracture",
    "dislocation",
    "osteoarthritis",
    "calcific_tendinopathy",
    "avascular_necrosis",
    "cuff_arthropathy",
    "hardware",
    "other_abnormality",
]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    rows = []

    for split in ("train", "val", "test"):
        for class_name in ("NORMAL", "ABNORMAL"):
            class_dir = SOURCE_DIR / split / class_name

            if not class_dir.exists():
                print(f"Skipping missing folder: {class_dir}")
                continue

            for image_path in sorted(class_dir.rglob("*")):
                if (
                    not image_path.is_file()
                    or image_path.suffix.lower() not in SUPPORTED_EXTENSIONS
                ):
                    continue

                relative_path = Path(
                    __import__("os").path.relpath(
                        image_path,
                        OUTPUT_DIR,
                    )
                ).as_posix()

                row = {
                    "image_path": relative_path,
                    "split": split,
                    "source_class": class_name,
                    "normal": 1 if class_name == "NORMAL" else 0,
                    "review_status": (
                        "READY"
                        if class_name == "NORMAL"
                        else "NEEDS_DISEASE_LABEL"
                    ),
                }

                for column in FINDING_COLUMNS:
                    row[column] = 0 if class_name == "NORMAL" else ""

                rows.append(row)

    fieldnames = [
        "image_path",
        "split",
        "source_class",
        "normal",
        *FINDING_COLUMNS,
        "review_status",
    ]

    with OUTPUT_PATH.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )
        writer.writeheader()
        writer.writerows(rows)

    normal_count = sum(
        1 for row in rows
        if row["source_class"] == "NORMAL"
    )
    abnormal_count = sum(
        1 for row in rows
        if row["source_class"] == "ABNORMAL"
    )

    print("\nLabeling sheet created successfully.")
    print(f"Total rows: {len(rows)}")
    print(f"NORMAL rows ready: {normal_count}")
    print(f"ABNORMAL rows needing disease labels: {abnormal_count}")
    print(f"File saved at:\n{OUTPUT_PATH}")
    print(
        "\nOpen the CSV in Excel and enter 1 for every confirmed "
        "finding in each ABNORMAL image, then change review_status "
        "to READY."
    )


if __name__ == "__main__":
    main()