from pathlib import Path
import shutil

# مكان الداتا التي تم تنزيلها
DATASET_DIR = Path(
    r"C:\Users\User\Desktop\archive (2)\YOLODataSet"
)

# مجلد المشروع
AI_SERVICE_DIR = Path(__file__).resolve().parent.parent

OUTPUT_DIR = (
    AI_SERVICE_DIR
    / "data"
    / "shoulder"
    / "raw"
)

# أرقام التصنيفات حسب ملف xr_bones.yaml
SHOULDER_POSITIVE_CLASS = 4
SHOULDER_NEGATIVE_CLASS = 9

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}


def prepare_output_folder(folder: Path) -> None:
    """
    حذف الملف أو المجلد القديم، ثم إنشاء مجلد جديد.
    """
    if folder.exists():
        if folder.is_file():
            folder.unlink()
        else:
            shutil.rmtree(folder)

    folder.mkdir(parents=True, exist_ok=True)


def find_image(images_folder: Path, stem: str) -> Path | None:
    """
    البحث عن صورة لها نفس اسم ملف الـ label.
    """
    for extension in IMAGE_EXTENSIONS:
        image_path = images_folder / f"{stem}{extension}"

        if image_path.exists():
            return image_path

        uppercase_path = images_folder / f"{stem}{extension.upper()}"

        if uppercase_path.exists():
            return uppercase_path

    return None


def read_class_ids(label_path: Path) -> set[int]:
    """
    قراءة أرقام التصنيفات الموجودة داخل ملف YOLO.
    """
    class_ids: set[int] = set()

    try:
        lines = label_path.read_text(
            encoding="utf-8"
        ).splitlines()
    except UnicodeDecodeError:
        lines = label_path.read_text(
            encoding="latin-1"
        ).splitlines()

    for line in lines:
        parts = line.strip().split()

        if not parts:
            continue

        try:
            class_id = int(float(parts[0]))
            class_ids.add(class_id)
        except ValueError:
            continue

    return class_ids


def main() -> None:
    normal_folder = OUTPUT_DIR / "NORMAL"
    abnormal_folder = OUTPUT_DIR / "ABNORMAL"

    prepare_output_folder(normal_folder)
    prepare_output_folder(abnormal_folder)

    normal_count = 0
    abnormal_count = 0
    missing_images = 0

    # الداتا الموجودة عندك فيها train و val
    for split_name in ["train", "val"]:
        images_folder = (
            DATASET_DIR
            / "images"
            / split_name
        )

        labels_folder = (
            DATASET_DIR
            / "labels"
            / split_name
        )

        if not images_folder.exists():
            print(
                f"Images folder was not found: "
                f"{images_folder}"
            )
            continue

        if not labels_folder.exists():
            print(
                f"Labels folder was not found: "
                f"{labels_folder}"
            )
            continue

        label_files = list(
            labels_folder.glob("*.txt")
        )

        print(
            f"\nReading {split_name}: "
            f"{len(label_files)} label files"
        )

        for label_path in label_files:
            class_ids = read_class_ids(label_path)

            is_positive = (
                SHOULDER_POSITIVE_CLASS in class_ids
            )

            is_negative = (
                SHOULDER_NEGATIVE_CLASS in class_ids
            )

            if not is_positive and not is_negative:
                continue

            image_path = find_image(
                images_folder,
                label_path.stem,
            )

            if image_path is None:
                missing_images += 1
                continue

            new_filename = (
                f"{split_name}_{image_path.name}"
            )

            if is_positive:
                destination = (
                    abnormal_folder
                    / new_filename
                )

                shutil.copy2(
                    image_path,
                    destination,
                )

                abnormal_count += 1

            elif is_negative:
                destination = (
                    normal_folder
                    / new_filename
                )

                shutil.copy2(
                    image_path,
                    destination,
                )

                normal_count += 1

    print("\nShoulder images extracted successfully.")
    print(f"NORMAL: {normal_count}")
    print(f"ABNORMAL: {abnormal_count}")
    print(f"Missing images: {missing_images}")
    print(f"Output folder: {OUTPUT_DIR}")

    if normal_count == 0 or abnormal_count == 0:
        print(
            "\nWarning: One of the classes is empty. "
            "Check the dataset path and label structure."
        )


if __name__ == "__main__":
    main()