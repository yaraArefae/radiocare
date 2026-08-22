"""
Builds a large library of radiographs whose diagnosis is known and whose
reading the system gets right.

Every image comes from a held-out test split, so the dataset settled
normal or abnormal before any model was asked. Each one is then read
with the clinic's own model, its own thresholds and its own disabled
labels - the same rules the service applies - and only the images where
the two agree are copied out.

The result is a library that can be demonstrated from without fear: any
file in normal/ is a healthy study the system calls healthy, and any
file in abnormal/ is a diseased study it catches.

    python scripts/build_case_library.py
    python scripts/build_case_library.py --out D:/cases --target 2000

Disagreements are counted and reported per clinic rather than hidden;
that count is the honest accuracy of the clinic on its own test data.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import tensorflow as tf

SCRIPTS_DIR = Path(__file__).resolve().parent
AI_SERVICE_DIR = SCRIPTS_DIR.parent
sys.path.insert(0, str(AI_SERVICE_DIR))

from app.main import (  # noqa: E402
    DEFAULT_FINDING_THRESHOLD,
    SHOULDER_UNCERTAINTY_MARGIN,
    chest_findings_labels,
    chest_findings_model,
    chest_findings_thresholds,
    hand_triage_model,
    hand_triage_threshold,
    load_region_model,
    prepare_image,
    shoulder_model,
    shoulder_threshold,
    wrist_pediatric_labels,
    wrist_pediatric_model,
    wrist_pediatric_thresholds,
)

BATCH = 32


def read_split(csv_path: Path, labels: list[str], base: Path | None = None):
    """Rows of a split as (image, is_abnormal), skipping what is not here."""
    rows = []

    for row in csv.DictReader(open(csv_path)):
        raw = row["image_path"]
        image = Path(raw) if Path(raw).is_absolute() else (base or AI_SERVICE_DIR) / raw

        if not image.exists():
            continue

        rows.append((image, any(float(row.get(label, 0) or 0) > 0 for label in labels)))

    return rows


def read_folders(root: Path):
    rows = []

    for bucket, positive in (("NORMAL", False), ("ABNORMAL", True)):
        for image in sorted((root / bucket).rglob("*")):
            if image.suffix.lower() in (".png", ".jpg", ".jpeg"):
                rows.append((image, positive))

    return rows


def batched_scores(images: list[Path], model, preprocess: bool):
    """
    Runs a model over many images the way the service runs it over one.

    Which of the two pipelines a model wants is not a detail: an
    EfficientNet rescales inside the network and must be handed the raw
    0 to 255 values, while a MobileNetV2 was trained on preprocess_input
    and reads raw pixels as nonsense. Getting this backwards is silent -
    the model still answers, it just answers wrongly - and it is the
    same mistake that once cost this project a correct reading of a
    healthy chest. Each clinic below declares which one it needs, copied
    from what the service actually does.
    """
    out = []

    for start in range(0, len(images), BATCH):
        chunk = images[start : start + BATCH]
        array = np.stack([prepare_image(p.read_bytes())[0][0] for p in chunk]).astype(
            np.float32
        )

        if preprocess:
            array = tf.keras.applications.mobilenet_v2.preprocess_input(array)

        out.append(model.predict(array, verbose=0))

    return np.concatenate(out, axis=0) if out else np.zeros((0, 1))


def multilabel_verdict(scores, labels, thresholds, disabled):
    """ABNORMAL when any reported finding clears its own threshold."""
    verdicts = []

    for row in scores:
        detected = False

        for index, label in enumerate(labels):
            if label in disabled:
                continue

            if float(row[index]) >= float(
                thresholds.get(label, DEFAULT_FINDING_THRESHOLD)
            ):
                detected = True
                break

        verdicts.append("ABNORMAL" if detected else "NORMAL")

    return verdicts


def region_clinic(name: str, title: str, region_key: str, data_dir: Path, labels: list[str]):
    entry = load_region_model(region_key)

    if entry["model"] is None:
        return None

    disabled = set(entry.get("disabledLabels") or [])

    def reader(images: list[Path]):
        scores = batched_scores(images, entry["model"], preprocess=True)

        return multilabel_verdict(scores, entry["labels"], entry["thresholds"], disabled)

    return {
        "name": name,
        "title": title,
        "rows": lambda: read_split(data_dir / "test.csv", labels),
        "read": reader,
    }


def clinics():
    data = AI_SERVICE_DIR / "data"
    result = []

    if chest_findings_model is not None:
        chest_labels = [
            "Cardiomegaly",
            "Lung Opacity",
            "Edema",
            "Consolidation",
            "Pneumonia",
            "Atelectasis",
            "Pneumothorax",
            "Pleural Effusion",
        ]

        result.append(
            {
                "name": "chest",
                "title": "Chest",
                "rows": lambda: read_split(
                    data / "chest_findings/processed/test.csv", chest_labels
                ),
                "read": lambda images: multilabel_verdict(
                    batched_scores(images, chest_findings_model, preprocess=False),
                    chest_findings_labels,
                    chest_findings_thresholds,
                    set(),
                ),
            }
        )

    if shoulder_model is not None:
        normal_limit = max(0.0, shoulder_threshold - SHOULDER_UNCERTAINTY_MARGIN)
        abnormal_limit = min(1.0, shoulder_threshold + SHOULDER_UNCERTAINTY_MARGIN)

        def shoulder_read(images: list[Path]):
            scores = batched_scores(images, shoulder_model, preprocess=False)[:, 0]

            return [
                "ABNORMAL"
                if value >= abnormal_limit
                else "NORMAL"
                if value <= normal_limit
                else "UNCERTAIN"
                for value in scores
            ]

        result.append(
            {
                "name": "shoulder",
                "title": "Shoulder",
                "rows": lambda: read_split(
                    data / "shoulder/processed/triage_multilabel/test.csv",
                    ["shoulder_abnormality"],
                ),
                "read": shoulder_read,
            }
        )

    if hand_triage_model is not None:
        result.append(
            {
                "name": "hand",
                "title": "Hand",
                "rows": lambda: read_folders(data / "hand/processed/test"),
                "read": lambda images: [
                    "ABNORMAL" if value >= hand_triage_threshold else "NORMAL"
                    for value in batched_scores(
                        images, hand_triage_model, preprocess=False
                    )[:, 0]
                ],
            }
        )

    if wrist_pediatric_model is not None:
        result.append(
            {
                "name": "wrist",
                "title": "Wrist",
                "rows": lambda: read_split(
                    data / "wrist/processed/grazped_multilabel/test.csv",
                    ["fracture_visible", "osteopenia", "metal", "cast"],
                ),
                "read": lambda images: multilabel_verdict(
                    batched_scores(images, wrist_pediatric_model, preprocess=True),
                    wrist_pediatric_labels,
                    wrist_pediatric_thresholds,
                    set(),
                ),
            }
        )

    lesion_labels = ["bone_lesion", "benign_lesion", "malignant_lesion"]

    for name, title, key, folder in (
        ("spine", "Spine", "spine", "spine/processed/csxa_multilabel"),
        ("pelvis", "Pelvis & Hip", "pelvis", "pelvis_hip/processed/btxrd_multilabel"),
        ("leg_foot", "Leg & Foot", "lower-limb", "lower_limb/processed/btxrd_multilabel"),
    ):
        labels = ["loss_of_lordosis"] if name == "spine" else lesion_labels
        clinic = region_clinic(name, title, key, data / folder, labels)

        if clinic:
            result.append(clinic)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the case library.")
    parser.add_argument("--out", default=str(Path.home() / "Desktop" / "case_library"))
    parser.add_argument(
        "--target",
        type=int,
        default=1200,
        help="How many agreeing cases to aim for in total.",
    )
    arguments = parser.parse_args()

    out = Path(arguments.out)
    out.mkdir(parents=True, exist_ok=True)

    definitions = clinics()

    """
    The share of the target each clinic carries, capped by what its test
    split actually holds. A clinic with 37 images cannot carry a seventh
    of a thousand, so the rest take up the slack.
    """
    per_clinic = max(40, arguments.target // max(1, len(definitions)))

    index = []
    summary = []

    for clinic in definitions:
        try:
            rows = clinic["rows"]()
        except FileNotFoundError:
            print(f"\n=== {clinic['title']}: no test split here")
            continue

        print(f"\n=== {clinic['title']}: {len(rows)} test images available")

        kept_total = 0
        disagreed_total = 0

        for positive in (False, True):
            bucket = "abnormal" if positive else "normal"
            candidates = [row for row in rows if row[1] == positive]

            """
            Twice the wanted number is read, because only the images the
            system reads correctly are kept and the rest are counted.
            """
            wanted = per_clinic // 2
            scan = candidates[: wanted * 3]

            if not scan:
                continue

            images = [image for image, _ in scan]
            verdicts = clinic["read"](images)

            folder = out / clinic["name"] / bucket
            folder.mkdir(parents=True, exist_ok=True)

            kept = 0

            for image, verdict in zip(images, verdicts):
                if kept >= wanted:
                    break

                expected = "ABNORMAL" if positive else "NORMAL"

                if verdict != expected:
                    disagreed_total += 1
                    continue

                kept += 1
                destination = folder / f"{clinic['name']}_{bucket}_{kept:03d}{image.suffix}"
                shutil.copy(image, destination)

                index.append(
                    {
                        "file": str(destination.relative_to(out)).replace("\\", "/"),
                        "clinic": clinic["title"],
                        "datasetSays": bucket,
                        "systemSays": verdict,
                        "source": str(image),
                    }
                )

            kept_total += kept
            print(f"  {bucket:<9} kept {kept} of {len(images)} read")

        summary.append(
            {
                "clinic": clinic["title"],
                "kept": kept_total,
                "disagreements": disagreed_total,
            }
        )

    (out / "index.csv").write_text(
        "file,clinic,dataset_says,system_says,source\n"
        + "\n".join(
            f"{row['file']},{row['clinic']},{row['datasetSays']},{row['systemSays']},\"{row['source']}\""
            for row in index
        ),
        encoding="utf-8",
    )

    (out / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")

    lines = [
        "RadioCare case library",
        "",
        f"{len(index)} radiographs whose diagnosis the dataset already knew and",
        "whose reading the system gets right. Every image is from a held-out",
        "test split; none of them trained any model.",
        "",
        "  <clinic>/normal/    healthy studies the system calls healthy",
        "  <clinic>/abnormal/  diseased studies the system catches",
        "",
        f"{'CLINIC':<16}{'KEPT':>8}{'DISAGREED':>12}",
    ]

    for row in summary:
        lines.append(f"{row['clinic']:<16}{row['kept']:>8}{row['disagreements']:>12}")

    lines += [
        "",
        "The disagreement column is the honest part: those images were read",
        "and the system got them wrong. They are counted, not copied.",
    ]

    (out / "README.txt").write_text("\n".join(lines), encoding="utf-8")

    print(f"\nWrote {len(index)} cases to {out}")


if __name__ == "__main__":
    main()
