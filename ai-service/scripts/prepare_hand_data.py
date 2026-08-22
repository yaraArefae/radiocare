"""
Builds a normal/abnormal hand set from the two folders on the desktop.

Why a hand model is needed at all:

The clinic answers hand studies with the wrist model, because that is the
only model the hand ever had. Run over 400 real hand images, that model
called 311 of them abnormal, and returned a median of 0.576 for "metal is
present" on ordinary hands. It was never shown a whole hand in training,
so it invents findings when it sees one. A hand needs its own model.

Two things about this data decide how it is split:

  1. The images come from Roboflow, which writes several altered copies
     of one original: "105_jpg.rf.<hash>.jpg" and "105_jpg.rf.<other>.jpg"
     are the same hand. There are 898 files but only 604 originals.
     Copies of one original must never straddle a split, or the test set
     is scoring images the model already trained on and the result looks
     better than the model is. Splitting is therefore done on the
     original name, not on the file.

  2. Five original names appear in both folders. They are bare numbers
     ("1", "10", "30"), so they are almost certainly different images
     that happened to be numbered alike in two source sets rather than a
     real contradiction, but a name that claims to be both normal and
     abnormal cannot teach anything either way. They are left out.

The abnormal side includes the Dislocation and Equipment subfolders. A
dislocated joint and surgical hardware are both things the clinic must
not call normal.

Run:

    python scripts/prepare_hand_data.py
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import re
import shutil
from pathlib import Path

from PIL import Image

AI_SERVICE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = AI_SERVICE_DIR / "data" / "hand" / "processed"

NORMAL_SOURCE = Path(r"C:\Users\User\Desktop\Normal hand\Normal hand")
ABNORMAL_SOURCE = Path(r"C:\Users\User\Desktop\Abnormal  2\Abnormal")

SPLIT_SHARES = {"train": 0.70, "val": 0.15, "test": 0.15}
CLASSES = ("NORMAL", "ABNORMAL")

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}

"""
Roboflow appends the original extension and a hash of the altered copy.
Stripping both leaves the name of the image the copy was made from.
"""
ROBOFLOW_SUFFIX = re.compile(r"_(jpg|jpeg|png)\.rf\.[0-9a-f]+\.(jpg|jpeg|png)$", re.I)


def original_name(path: Path) -> str:
    stripped = ROBOFLOW_SUFFIX.sub("", path.name)

    return stripped if stripped != path.name else path.stem


def image_files(root: Path) -> list[Path]:
    """
    __MACOSX holds the resource forks a Mac adds when zipping. They carry
    image extensions but are not images, and decoding one stops a run.
    """
    return [
        path
        for path in sorted(root.rglob("*"))
        if path.is_file()
        and path.suffix.lower() in IMAGE_SUFFIXES
        and "__MACOSX" not in path.parts
        and not path.name.startswith("._")
    ]


def readable(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()

        return True
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--normal", default=str(NORMAL_SOURCE))
    parser.add_argument("--abnormal", default=str(ABNORMAL_SOURCE))
    arguments = parser.parse_args()

    normal_root = Path(arguments.normal)
    abnormal_root = Path(arguments.abnormal)

    for root in (normal_root, abnormal_root):
        if not root.exists():
            raise SystemExit(f"Missing source folder: {root}")

    normal_files = image_files(normal_root)
    abnormal_files = image_files(abnormal_root)

    print(f"Found: NORMAL {len(normal_files)}  ABNORMAL {len(abnormal_files)}")

    by_class: dict[str, dict[str, list[Path]]] = {}

    for label, paths in (("NORMAL", normal_files), ("ABNORMAL", abnormal_files)):
        grouped: dict[str, list[Path]] = collections.defaultdict(list)

        for path in paths:
            grouped[original_name(path)].append(path)

        by_class[label] = grouped

        print(f"  {label}: {len(paths)} files from {len(grouped)} originals")

    contested = set(by_class["NORMAL"]) & set(by_class["ABNORMAL"])

    if contested:
        print(f"\nDropping {len(contested)} originals claimed by both classes:")

        for name in sorted(contested):
            print(f"    {name}")

        for label in CLASSES:
            for name in contested:
                by_class[label].pop(name, None)

    """
    An identical file copied into both folders would be the same leak as a
    contested name, and would not be caught above if the two copies were
    renamed. The content is hashed to be sure.
    """
    digests: dict[str, set[str]] = {}

    for label in CLASSES:
        seen = set()

        for paths in by_class[label].values():
            for path in paths:
                seen.add(hashlib.md5(path.read_bytes()).hexdigest())

        digests[label] = seen

    shared_bytes = digests["NORMAL"] & digests["ABNORMAL"]

    print(f"\nByte-identical files in both classes: {len(shared_bytes)}")

    for split in SPLIT_SHARES:
        for label in CLASSES:
            folder = OUTPUT_DIR / split / label
            folder.mkdir(parents=True, exist_ok=True)

            for stale in folder.iterdir():
                if stale.is_file():
                    stale.unlink()

    written: dict[str, dict[str, int]] = {
        split: {label: 0 for label in CLASSES} for split in SPLIT_SHARES
    }
    unreadable = 0

    for label in CLASSES:
        grouped = by_class[label]

        """
        Originals are ordered by a hash of the name rather than by the
        name itself. The names carry the source set ("Screenshot ...",
        "12-Male-A-View-", a bare number), so ordering by name would put
        one source in train and another in test, and the test score would
        then measure how well the model travels between sources instead
        of how well it reads a hand.
        """
        originals = sorted(
            grouped,
            key=lambda name: hashlib.md5(name.encode("utf-8")).hexdigest(),
        )

        total = len(originals)
        train_end = int(total * SPLIT_SHARES["train"])
        val_end = train_end + int(total * SPLIT_SHARES["val"])

        assignment = {}

        for index, name in enumerate(originals):
            if index < train_end:
                assignment[name] = "train"
            elif index < val_end:
                assignment[name] = "val"
            else:
                assignment[name] = "test"

        for name, split in assignment.items():
            for path in grouped[name]:
                if not readable(path):
                    unreadable += 1
                    continue

                destination = OUTPUT_DIR / split / label / path.name

                shutil.copy2(path, destination)
                written[split][label] += 1

    if unreadable:
        print(f"\nSkipped unreadable files: {unreadable}")

    print("\nFinal counts:")

    for split in SPLIT_SHARES:
        line = written[split]
        ratio = line["ABNORMAL"] / max(line["NORMAL"], 1)

        print(f"  {split}: {line}  (abnormal:normal = {ratio:.2f})")

    print(f"\nWritten to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
