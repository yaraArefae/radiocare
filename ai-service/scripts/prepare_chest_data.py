from pathlib import Path
import random
import shutil


# مكان الداتا الأصلية
RAW_DATA_DIR = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "chest"
    / "raw"
    / "chest_xray"
)

# مكان النسخة المرتبة التي سيستخدمها التدريب
PROCESSED_DATA_DIR = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "chest"
    / "processed"
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}

# نسبة الصور التي سنأخذها من train لتصبح validation
VALIDATION_RATIO = 0.15

# حتى يعطينا نفس التقسيم كل مرة
RANDOM_SEED = 42

CLASS_MAPPING = {
    "NORMAL": "NORMAL",
    "PNEUMONIA": "ABNORMAL",
}


def get_images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []

    return [
        file
        for file in folder.rglob("*")
        if file.is_file() and file.suffix.lower() in IMAGE_EXTENSIONS
    ]


def copy_images(
    images: list[Path],
    destination: Path,
    source_name: str,
) -> None:
    destination.mkdir(parents=True, exist_ok=True)

    for index, image_path in enumerate(images):
        new_name = f"{source_name}_{index:05d}_{image_path.name}"
        target_path = destination / new_name
        shutil.copy2(image_path, target_path)


def prepare_train_and_validation() -> None:
    random.seed(RANDOM_SEED)

    for original_class, new_class in CLASS_MAPPING.items():
        train_images = get_images(
            RAW_DATA_DIR / "train" / original_class
        )

        original_validation_images = get_images(
            RAW_DATA_DIR / "val" / original_class
        )

        # نجمع train وval الأصليين، لأن val الأصلي صغير جدًا
        all_images = train_images + original_validation_images

        if not all_images:
            raise FileNotFoundError(
                f"No images found for class: {original_class}"
            )

        random.shuffle(all_images)

        validation_count = round(
            len(all_images) * VALIDATION_RATIO
        )

        validation_images = all_images[:validation_count]
        training_images = all_images[validation_count:]

        copy_images(
            training_images,
            PROCESSED_DATA_DIR / "train" / new_class,
            f"train_{original_class.lower()}",
        )

        copy_images(
            validation_images,
            PROCESSED_DATA_DIR / "val" / new_class,
            f"val_{original_class.lower()}",
        )

        print(
            f"{new_class}: "
            f"train={len(training_images)}, "
            f"val={len(validation_images)}"
        )


def prepare_test() -> None:
    for original_class, new_class in CLASS_MAPPING.items():
        test_images = get_images(
            RAW_DATA_DIR / "test" / original_class
        )

        if not test_images:
            raise FileNotFoundError(
                f"No test images found for class: {original_class}"
            )

        copy_images(
            test_images,
            PROCESSED_DATA_DIR / "test" / new_class,
            f"test_{original_class.lower()}",
        )

        print(f"{new_class}: test={len(test_images)}")


def count_processed_images() -> None:
    print("\nProcessed dataset summary")
    print("=" * 50)

    total = 0

    for split in ["train", "val", "test"]:
        print(f"\n[{split.upper()}]")

        split_total = 0

        for class_name in ["NORMAL", "ABNORMAL"]:
            images = get_images(
                PROCESSED_DATA_DIR / split / class_name
            )

            print(f"{class_name:<10}: {len(images)} images")

            split_total += len(images)

        total += split_total
        print(f"Split total: {split_total}")

    print("\n" + "=" * 50)
    print(f"Total processed images: {total}")


def main() -> None:
    print("Preparing Chest X-ray Dataset")
    print("=" * 50)
    print(f"Raw data: {RAW_DATA_DIR}")
    print(f"Processed data: {PROCESSED_DATA_DIR}\n")

    if not RAW_DATA_DIR.exists():
        print("ERROR: Raw dataset folder was not found.")
        print("Expected location:")
        print(RAW_DATA_DIR)
        return

    # يحذف النسخة المجهزة القديمة فقط، ولا يمس الداتا الأصلية
    if PROCESSED_DATA_DIR.exists():
        shutil.rmtree(PROCESSED_DATA_DIR)

    print("Preparing train and validation data...")
    prepare_train_and_validation()

    print("\nPreparing test data...")
    prepare_test()

    count_processed_images()

    print("\nDataset preparation completed successfully.")


if __name__ == "__main__":
    main()