from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None


BASE_DIR = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "chest"
    / "raw"
    / "chest_xray"
)

SPLITS = ["train", "val", "test"]
CLASSES = ["NORMAL", "PNEUMONIA"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def get_image_files(folder: Path) -> list[Path]:
    if not folder.exists():
        return []

    return [
        file
        for file in folder.rglob("*")
        if file.is_file() and file.suffix.lower() in IMAGE_EXTENSIONS
    ]


def check_corrupted_images(files: list[Path]) -> list[Path]:
    if Image is None:
        return []

    corrupted_files = []

    for file in files:
        try:
            with Image.open(file) as image:
                image.verify()
        except Exception:
            corrupted_files.append(file)

    return corrupted_files


def main() -> None:
    print("=" * 60)
    print("Chest X-ray Dataset Inspection")
    print("=" * 60)
    print(f"Dataset path: {BASE_DIR}\n")

    if not BASE_DIR.exists():
        print("ERROR: Dataset folder was not found.")
        print("Expected path:")
        print(BASE_DIR)
        return

    total_images = 0
    all_images: list[Path] = []

    for split in SPLITS:
        split_path = BASE_DIR / split

        print(f"\n[{split.upper()}]")

        if not split_path.exists():
            print(f"  Missing folder: {split_path}")
            continue

        split_total = 0

        for class_name in CLASSES:
            class_path = split_path / class_name
            files = get_image_files(class_path)

            print(f"  {class_name:<10}: {len(files)} images")

            split_total += len(files)
            all_images.extend(files)

        total_images += split_total
        print(f"  Split total: {split_total}")

    print("\n" + "=" * 60)
    print(f"Total images: {total_images}")

    if Image is None:
        print("\nPillow is not installed.")
        print("Image corruption checking was skipped.")
        print("Install it using:")
        print(r".\.venv\Scripts\python.exe -m pip install pillow")
        return

    print("\nChecking for corrupted images...")
    corrupted_files = check_corrupted_images(all_images)

    if corrupted_files:
        print(f"Found {len(corrupted_files)} corrupted images:")

        for file in corrupted_files:
            print(f"  - {file}")
    else:
        print("No corrupted images were found.")

    print("=" * 60)


if __name__ == "__main__":
    main()