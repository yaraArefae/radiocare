from pathlib import Path
import random
import shutil

RANDOM_SEED = 42

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}

BASE_DIR = Path(__file__).resolve().parent.parent

RAW_DIR = BASE_DIR / "data" / "shoulder" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "shoulder" / "processed"

CLASSES = ["NORMAL", "ABNORMAL"]


def get_images(folder: Path) -> list[Path]:
    """قراءة جميع الصور داخل المجلد والمجلدات الفرعية."""
    return [
        file
        for file in folder.rglob("*")
        if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS
    ]


def copy_images(
    images: list[Path],
    split_name: str,
    class_name: str,
) -> None:
    destination = PROCESSED_DIR / split_name / class_name
    destination.mkdir(parents=True, exist_ok=True)

    for index, image_path in enumerate(images, start=1):
        new_filename = (
            f"{class_name.lower()}_{index:05d}{image_path.suffix.lower()}"
        )

        shutil.copy2(
            image_path,
            destination / new_filename,
        )


def main() -> None:
    random.seed(RANDOM_SEED)

    if not RAW_DIR.exists():
        raise FileNotFoundError(
            f"Raw dataset folder was not found: {RAW_DIR}"
        )

    # حذف التقسيم القديم عند إعادة تشغيل السكربت
    if PROCESSED_DIR.exists():
        shutil.rmtree(PROCESSED_DIR)

    for class_name in CLASSES:
        class_folder = RAW_DIR / class_name

        if not class_folder.exists():
            raise FileNotFoundError(
                f"Class folder was not found: {class_folder}"
            )

        images = get_images(class_folder)

        if len(images) < 10:
            raise ValueError(
                f"Not enough images in {class_name}. "
                f"Found only {len(images)} images."
            )

        random.shuffle(images)

        total = len(images)
        train_end = int(total * TRAIN_RATIO)
        val_end = train_end + int(total * VAL_RATIO)

        train_images = images[:train_end]
        val_images = images[train_end:val_end]
        test_images = images[val_end:]

        copy_images(train_images, "train", class_name)
        copy_images(val_images, "val", class_name)
        copy_images(test_images, "test", class_name)

        print(f"\n{class_name}")
        print(f"Total: {total}")
        print(f"Train: {len(train_images)}")
        print(f"Validation: {len(val_images)}")
        print(f"Test: {len(test_images)}")

    print("\nShoulder dataset was prepared successfully.")
    print(f"Output folder: {PROCESSED_DIR}")


if __name__ == "__main__":
    main()