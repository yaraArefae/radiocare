from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd
from PIL import Image, ImageFile, UnidentifiedImageError


ImageFile.LOAD_TRUNCATED_IMAGES = True

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "shoulder_findings"

SOURCE_CSV = DATA_DIR / "labels_available.csv"
SOURCE_IMAGES = DATA_DIR / "images"

CLEAN_IMAGES = DATA_DIR / "images_clean"
CLEAN_CSV = DATA_DIR / "labels_available_clean.csv"
BAD_CSV = DATA_DIR / "bad_images.csv"

JPEG_QUALITY = 95


def resolve_source_path(value: str) -> Path:
    raw = Path(str(value).strip())
    return raw if raw.is_absolute() else DATA_DIR / raw


def main() -> None:
    if not SOURCE_CSV.is_file():
        raise FileNotFoundError(
            f"Labels file was not found:\n{SOURCE_CSV}"
        )

    dataframe = pd.read_csv(SOURCE_CSV)

    if "image_path" not in dataframe.columns:
        raise ValueError(
            "labels_available.csv must contain an image_path column."
        )

    if CLEAN_IMAGES.exists():
        shutil.rmtree(CLEAN_IMAGES)

    CLEAN_IMAGES.mkdir(parents=True, exist_ok=True)

    clean_rows: list[dict[str, object]] = []
    bad_rows: list[dict[str, object]] = []

    total = len(dataframe)

    for index, row in dataframe.iterrows():
        source_path = resolve_source_path(row["image_path"])

        try:
            if not source_path.is_file():
                raise FileNotFoundError("File does not exist.")

            with Image.open(source_path) as image:
                image.load()
                clean_image = image.convert("RGB")

                clean_name = f"clean_{index + 1:05d}.jpg"
                clean_path = CLEAN_IMAGES / clean_name

                clean_image.save(
                    clean_path,
                    format="JPEG",
                    quality=JPEG_QUALITY,
                    optimize=True,
                )

            clean_row = row.to_dict()
            clean_row["image_path"] = f"images_clean/{clean_name}"
            clean_rows.append(clean_row)

        except (
            OSError,
            ValueError,
            FileNotFoundError,
            UnidentifiedImageError,
        ) as error:
            bad_row = row.to_dict()
            bad_row["error"] = str(error)
            bad_rows.append(bad_row)
            print(
                f"Skipped [{index + 1}/{total}] "
                f"{source_path.name}: {error}"
            )

        if (index + 1) % 100 == 0 or index + 1 == total:
            print(
                f"Processed {index + 1}/{total} | "
                f"clean={len(clean_rows)} | bad={len(bad_rows)}"
            )

    pd.DataFrame(clean_rows).to_csv(
        CLEAN_CSV,
        index=False,
        encoding="utf-8-sig",
    )

    if bad_rows:
        pd.DataFrame(bad_rows).to_csv(
            BAD_CSV,
            index=False,
            encoding="utf-8-sig",
        )
    elif BAD_CSV.exists():
        BAD_CSV.unlink()

    print("\nImage cleaning completed.")
    print(f"Original rows: {total}")
    print(f"Clean images: {len(clean_rows)}")
    print(f"Skipped images: {len(bad_rows)}")
    print(f"\nClean labels:\n{CLEAN_CSV}")
    print(f"\nClean images:\n{CLEAN_IMAGES}")

    if bad_rows:
        print(f"\nSkipped-image report:\n{BAD_CSV}")


if __name__ == "__main__":
    main()