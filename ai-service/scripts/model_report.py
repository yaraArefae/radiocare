"""
Prints what every trained model reads, how well it reads it, and how
much data it was taught on.

There is one of these tables in every conversation about this project,
and it has been rebuilt by hand each time. Written down as a script it
stays true: it reads the metrics each training run wrote and the splits
each preparation run wrote, so it cannot drift away from what is
actually on disk the way a table in a document does.

    python scripts/model_report.py
    python scripts/model_report.py --live
    python scripts/model_report.py --csv report.csv

`--live` also asks the service which of these models it actually serves.
A model can sit in models/ and reach no patient, either because no
region points at it or because it fails to load, and that gap is worth
seeing next to its score.

One warning about reading the table
-----------------------------------

Each score here was measured on the test split of the dataset that
model was trained on, and those splits are not the same. Two rows are
comparable only when both models were measured on one split.

This is not a footnote. The lower limb models looked, in this very
table, as though lower_limb_v2 at 0.934 beat the model actually in
service, btxrd_lesion_all at 0.901. Scored on one split they invert:

                        lower limb   pelvis   all regions
    btxrd_lesion_all       0.901      0.851      0.872
    lower_limb_v2          0.824      0.637      0.754

The higher number belonged to an easier split, not a better model. To
choose between two models, load both and score them on the same test
split. Never on this table alone.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def model_rows() -> list[dict]:
    """
    One row per label of every model that recorded a test score.

    A model without test_metrics.json is listed with no score rather
    than left out: a model nobody measured is a fact about this project,
    and hiding it would make the table look better than the work is.
    """
    rows: list[dict] = []

    for folder in sorted(MODELS_DIR.iterdir()):
        if not folder.is_dir():
            continue

        model_file = next(folder.glob("*_model.keras"), None)

        if model_file is None:
            continue

        name = folder.name
        thresholds = read_json(folder / f"{name}_thresholds.json")
        metrics = read_json(folder / "test_metrics.json")

        kind = (
            "3D"
            if thresholds.get("inputKind") == "volume"
            or thresholds.get("volumeShape")
            else "2D"
        )

        shape = thresholds.get("volumeShape") or [224, 224]
        dataset = thresholds.get("dataset", "")

        if not metrics:
            rows.append(
                {
                    "model": name,
                    "kind": kind,
                    "input": "x".join(str(v) for v in shape),
                    "label": "(never measured)",
                    "auc": None,
                    "ap": None,
                    "test_positives": None,
                    "dataset": dataset,
                }
            )
            continue

        for label, values in metrics.items():
            if not isinstance(values, dict):
                continue

            rows.append(
                {
                    "model": name,
                    "kind": kind,
                    "input": "x".join(str(v) for v in shape),
                    "label": label,
                    "auc": values.get("roc_auc"),
                    "ap": values.get("average_precision"),
                    "test_positives": values.get("test_positive_count"),
                    "dataset": dataset,
                }
            )

    return rows


def dataset_rows() -> list[dict]:
    """
    One row per prepared dataset: which region, how many images or
    volumes, and how many distinct patients behind them where that was
    recorded.

    The patient count is the number that matters for a patch dataset.
    Five thousand patches cut from two hundred scans is five thousand
    training examples and two hundred patients, and only the second
    number tells you how much the score can be trusted.
    """
    rows: list[dict] = []

    for split_file in sorted(DATA_DIR.glob("*/processed/*/train.csv")):
        folder = split_file.parent
        descriptor = read_json(folder / "dataset.json")

        total = 0
        patients: set[str] = set()
        labels: list[str] = []
        kind = "2D"

        for split in ("train", "val", "test"):
            path = folder / f"{split}.csv"

            if not path.exists():
                continue

            try:
                frame = pd.read_csv(path)
            except Exception:
                continue

            total += len(frame)

            if "volume_path" in frame.columns:
                kind = "3D"

            if "patient" in frame.columns:
                patients.update(frame["patient"].astype(str))

            if not labels:
                labels = [
                    column
                    for column in frame.columns
                    if column
                    not in ("image_path", "volume_path", "split", "patient")
                ]

        rows.append(
            {
                "region": folder.parts[-3],
                "dataset": folder.name,
                "kind": kind,
                "count": total,
                "patients": len(patients) or None,
                "labels": len(labels),
                "modality": descriptor.get(
                    "modality",
                    "CT" if kind == "3D" else "X-ray",
                ),
            }
        )

    return rows


def live_regions() -> dict[str, str]:
    """
    Asks the service which model each region actually serves.

    Importing it loads every model, which is slow, and is the point: a
    model that cannot be loaded is reported here rather than discovered
    by a patient waiting for a result.
    """
    import sys

    sys.path.insert(0, str(PROJECT_ROOT))

    from app.main import (  # noqa: E402
        REGION_MODEL_REGISTRY,
        VOLUME_MODEL_REGISTRY,
    )

    serving: dict[str, str] = {}

    for key, definition in REGION_MODEL_REGISTRY.items():
        serving.setdefault(str(definition["folder"]), "")
        serving[str(definition["folder"])] += f"{key} "

    for key, definition in VOLUME_MODEL_REGISTRY.items():
        serving.setdefault(str(definition["folder"]), "")
        serving[str(definition["folder"])] += f"{key} "

    return serving


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Report every model's accuracy and its data."
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Also show which region of the service serves each model.",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Write the model table to a CSV file as well.",
    )
    arguments = parser.parse_args()

    models = model_rows()
    datasets = dataset_rows()
    serving = live_regions() if arguments.live else {}

    for kind in ("3D", "2D"):
        rows = [row for row in models if row["kind"] == kind]

        if not rows:
            continue

        print(f"\n=== {kind} models " + "=" * 58)
        header = (
            f"{'model':30s} {'input':11s} {'reads':28s} "
            f"{'AUC':>6s} {'AP':>6s} {'pos':>5s}"
        )

        if arguments.live:
            header += "  served as"

        print(header)
        print("-" * (len(header) + 4))

        last_model = ""

        for row in rows:
            auc = f"{row['auc']:.3f}" if row["auc"] is not None else "  -  "
            ap = f"{row['ap']:.3f}" if row["ap"] is not None else "  -  "
            positives = (
                str(row["test_positives"])
                if row["test_positives"] is not None
                else "-"
            )

            shown = row["model"] if row["model"] != last_model else ""
            last_model = row["model"]

            line = (
                f"{shown:30s} {row['input']:11s} "
                f"{row['label'][:28]:28s} {auc:>6s} {ap:>6s} "
                f"{positives:>5s}"
            )

            if arguments.live:
                line += f"  {serving.get(row['model'], '').strip() or '-'}"

            print(line)

    for kind in ("3D", "2D"):
        rows = [row for row in datasets if row["kind"] == kind]

        if not rows:
            continue

        rows.sort(key=lambda row: (row["region"], -row["count"]))
        total = sum(row["count"] for row in rows)

        print(f"\n=== {kind} data " + "=" * 60)
        print(
            f"{'region':16s} {'dataset':24s} {'scan':7s} "
            f"{'count':>7s} {'patients':>9s} {'labels':>7s}"
        )
        print("-" * 76)

        for row in rows:
            print(
                f"{row['region']:16s} {row['dataset'][:24]:24s} "
                f"{str(row['modality'])[:7]:7s} {row['count']:7d} "
                f"{str(row['patients'] or '-'):>9s} {row['labels']:7d}"
            )

        print(f"{'':16s} {'TOTAL':24s} {'':7s} {total:7d}")

    if arguments.csv:
        with arguments.csv.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(models[0]))
            writer.writeheader()
            writer.writerows(models)

        print(f"\nWritten to {arguments.csv}")

    unmeasured = [
        row["model"] for row in models if row["label"] == "(never measured)"
    ]

    if unmeasured:
        print(
            "\nNo test score was recorded for: "
            + ", ".join(sorted(set(unmeasured)))
        )

    print(
        "",
    )
    print(
        "Every score above comes from that model's own test split, and "
        "the splits differ."
    )
    print(
        "Two models are comparable only when both were scored on the "
        "same one."
    )


if __name__ == "__main__":
    main()
