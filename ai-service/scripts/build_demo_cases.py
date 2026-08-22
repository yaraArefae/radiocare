"""
Builds the demonstration pack: real radiographs whose diagnosis is
already known, answered by the live service exactly as the browser would
receive it.

Every image comes from a held-out test split, so the dataset settled the
answer before the model was asked. That is the whole point of the pack:
a screenshot of a case that merely looks abnormal proves nothing, while
a case the data already labelled proves what the system does with it.

Cases where the service agrees with the dataset are copied out for the
demonstration. Cases where it disagrees are copied out too, into a
"failures" folder, because a defence that cannot show a failure has not
looked for one.

    python scripts/build_demo_cases.py
    python scripts/build_demo_cases.py --out "C:/Users/me/Desktop/demo"
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
AI_SERVICE_DIR = SCRIPTS_DIR.parent
sys.path.insert(0, str(AI_SERVICE_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def read_rows(csv_path: Path, labels: list[str], base: Path | None = None):
    """
    Every row of a split as (image, is_abnormal). A row whose image is
    not on this machine is skipped rather than guessed at.
    """
    rows = []

    for row in csv.DictReader(open(csv_path)):
        raw = row["image_path"]
        image = Path(raw) if Path(raw).is_absolute() else (base or AI_SERVICE_DIR) / raw

        if not image.exists():
            continue

        positive = any(float(row.get(label, 0) or 0) > 0 for label in labels)
        rows.append((image, positive))

    return rows


def read_folders(root: Path):
    """A split stored as NORMAL and ABNORMAL folders rather than a CSV."""
    rows = []

    for bucket, positive in (("NORMAL", False), ("ABNORMAL", True)):
        for image in sorted((root / bucket).rglob("*")):
            if image.suffix.lower() in (".png", ".jpg", ".jpeg"):
                rows.append((image, positive))

    return rows


CHEST_FINDINGS = [
    "Cardiomegaly",
    "Lung Opacity",
    "Edema",
    "Consolidation",
    "Pneumonia",
    "Atelectasis",
    "Pneumothorax",
    "Pleural Effusion",
]

WRIST_FINDINGS = ["fracture_visible", "osteopenia", "metal", "cast"]

LESION_FINDINGS = ["bone_lesion", "benign_lesion", "malignant_lesion"]


def clinic_definitions():
    data = AI_SERVICE_DIR / "data"

    return [
        {
            "name": "chest",
            "title": "Chest",
            "endpoint": "/predict/chest/findings",
            "truth": "chest findings",
            "rows": lambda: read_rows(
                data / "chest_findings/processed/test.csv", CHEST_FINDINGS
            ),
        },
        {
            "name": "shoulder",
            "title": "Shoulder",
            "endpoint": "/predict/shoulder",
            "truth": "shoulder abnormality",
            "rows": lambda: read_rows(
                data / "shoulder/processed/triage_multilabel/test.csv",
                ["shoulder_abnormality"],
            ),
        },
        {
            "name": "hand",
            "title": "Hand",
            "endpoint": "/predict/hand-wrist",
            "truth": "hand abnormality",
            "rows": lambda: read_folders(data / "hand/processed/test"),
        },
        {
            "name": "wrist",
            "title": "Wrist",
            "endpoint": "/predict/hand-wrist",
            "truth": "wrist findings",
            "rows": lambda: read_rows(
                data / "wrist/processed/grazped_multilabel/test.csv",
                WRIST_FINDINGS,
            ),
        },
        {
            "name": "spine",
            "title": "Spine",
            "endpoint": "/predict/region/spine",
            "truth": "cervical curvature",
            "rows": lambda: read_rows(
                data / "spine/processed/csxa_multilabel/test.csv",
                ["loss_of_lordosis"],
            ),
        },
        {
            "name": "pelvis",
            "title": "Pelvis & Hip",
            "endpoint": "/predict/region/pelvis",
            "truth": "bone lesion",
            "rows": lambda: read_rows(
                data / "pelvis_hip/processed/btxrd_multilabel/test.csv",
                LESION_FINDINGS,
            ),
        },
        {
            "name": "leg_foot",
            "title": "Leg & Foot",
            "endpoint": "/predict/region/lower-limb",
            "truth": "bone lesion",
            "rows": lambda: read_rows(
                data / "lower_limb/processed/btxrd_multilabel/test.csv",
                LESION_FINDINGS,
            ),
        },
    ]


def ask(endpoint: str, image: Path):
    mime = "image/png" if image.suffix.lower() == ".png" else "image/jpeg"

    with open(image, "rb") as handle:
        response = client.post(
            endpoint, files={"image": (image.name, handle, mime)}
        )

    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the demonstration pack."
    )
    parser.add_argument(
        "--out",
        default=str(Path.home() / "Desktop" / "demo_cases"),
    )
    parser.add_argument("--per-bucket", type=int, default=3)
    parser.add_argument(
        "--scan",
        type=int,
        default=60,
        help="How many images of each bucket to try before giving up.",
    )
    arguments = parser.parse_args()

    out = Path(arguments.out)
    failures = out / "failures"
    out.mkdir(parents=True, exist_ok=True)
    failures.mkdir(exist_ok=True)

    records = []

    for clinic in clinic_definitions():
        try:
            rows = clinic["rows"]()
        except FileNotFoundError:
            print(f"\n=== {clinic['title']}: no test split on this machine")
            continue

        print(f"\n=== {clinic['title']}: {len(rows)} test images available")

        for positive in (False, True):
            bucket = "abnormal" if positive else "normal"
            kept = 0
            missed = 0

            candidates = [row for row in rows if row[1] == positive]

            for image, _ in candidates[: arguments.scan]:
                if kept >= arguments.per_bucket:
                    break

                answer = ask(clinic["endpoint"], image)
                result = str(answer.get("result", ""))
                agrees = (
                    result == "ABNORMAL" if positive else result == "NORMAL"
                )

                record = {
                    "clinic": clinic["title"],
                    "datasetSays": bucket,
                    "truthOf": clinic["truth"],
                    "systemSays": result,
                    "primaryFinding": answer.get("primaryFinding"),
                    "confidence": answer.get("confidence"),
                    "agrees": agrees,
                    "source": str(image),
                }

                if agrees:
                    kept += 1
                    name = f"{clinic['name']}_{bucket}_{kept}{image.suffix}"
                    shutil.copy(image, out / name)
                    record["file"] = name
                    records.append(record)
                    print(
                        f"  [{bucket} {kept}] {name}: {result} "
                        f"({answer.get('primaryFinding') or 'no named finding'})"
                    )
                elif missed < 2:
                    missed += 1
                    name = f"{clinic['name']}_{bucket}_missed_{missed}{image.suffix}"
                    shutil.copy(image, failures / name)
                    record["file"] = f"failures/{name}"
                    records.append(record)

            if kept < arguments.per_bucket:
                print(
                    f"  only {kept} {bucket} case(s) where the system and "
                    f"the dataset agree, out of {min(len(candidates), arguments.scan)} tried"
                )

    (out / "cases.json").write_text(json.dumps(records, indent=2))

    lines = [
        "RadioCare demonstration pack",
        "",
        "Every image is from a held-out test split, so the dataset knew the",
        "answer before the model was asked. The files in this folder are the",
        "cases the system reads correctly; failures/ holds the ones it does",
        "not, which are worth showing too.",
        "",
        f"{'FILE':<34}{'CLINIC':<14}{'DATASET':<10}{'SYSTEM':<14}FINDING",
    ]

    for record in records:
        lines.append(
            f"{str(record.get('file', '')):<34}"
            f"{record['clinic']:<14}"
            f"{record['datasetSays']:<10}"
            f"{record['systemSays']:<14}"
            f"{record.get('primaryFinding') or ''}"
        )

    correct = sum(1 for record in records if record["agrees"])
    lines += [
        "",
        f"{correct} agreeing cases, {len(records) - correct} disagreements.",
    ]

    (out / "README.txt").write_text("\n".join(lines), encoding="utf-8")

    print(f"\nWrote {len(records)} cases to {out}")


if __name__ == "__main__":
    main()
