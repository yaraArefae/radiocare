"""
Re-picks the decision thresholds of a trained volumetric model, without
retraining it.

This is the volumetric twin of scripts/retune_region_thresholds.py, and
it exists for the same reason: a threshold is not something the network
learned. It is the point where a score becomes a finding a doctor sees,
and moving it is a clinical decision, not a training one. Rerunning an
hour of training to change one number is waste.

The rule that matters here is the recall floor. Training picks the cut
point with the best F1, which is a reasonable default and a poor one for
a small set: the chest CT model came out of training with a threshold of
0.667, tuned on thirty validation volumes, and at that point it missed
seven of the fifteen ill patients in the test split. Best F1 was doing
its job; the job was the wrong one. A triage system that sends every
study to a doctor anyway can afford a false alarm far more easily than
a patient sent home labelled normal.

    python scripts/retune_3d_thresholds.py chest_3d_mosmed \\
        --region chest --dataset mosmed --min-recall 0.80

The validation split decides the threshold and the test split only
measures it, exactly as in training. Choosing a cut point by looking at
the test numbers would make those numbers meaningless.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import classification_report

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from retune_region_thresholds import (  # noqa: E402
    describe,
    tune_for_recall,
)

PROJECT_ROOT = SCRIPTS_DIR.parent


def parse_per_label(raw: str | None, labels: list[str]) -> dict[str, float]:
    """
    Reads either one number for every label, or per label pairs.

    A finding that costs more to miss deserves its own floor: a
    malignant nodule and a healed rib are not owed the same caution.
    """
    if raw is None:
        return {}

    if "=" not in raw:
        return {label: float(raw) for label in labels}

    values: dict[str, float] = {}

    for pair in raw.split(","):
        name, _, number = pair.partition("=")
        name = name.strip()

        if name not in labels:
            raise SystemExit(
                f"Unknown label {name!r}. This model reads: "
                + ", ".join(labels)
            )

        values[name] = float(number)

    return values


def load_split(path: Path, labels: list[str]) -> tuple[np.ndarray, np.ndarray]:
    frame = pd.read_csv(path)
    volumes = np.stack(
        [np.load(PROJECT_ROOT / str(value)) for value in frame["volume_path"]]
    )
    volumes = volumes[..., np.newaxis].astype(np.float32)
    truth = frame[labels].to_numpy(dtype=np.float32)
    return volumes, truth


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-tune the thresholds of a trained 3D model."
    )
    parser.add_argument(
        "model_folder",
        help="Folder under models/, such as chest_3d_mosmed.",
    )
    parser.add_argument("--region", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument(
        "--min-recall",
        default=None,
        help=(
            "Lowest recall a threshold may have on the validation "
            "split, as one number or as per label pairs such as "
            "malignant_nodule=0.85. Among the cut offs that clear it, "
            "the most precise one is taken."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change and write nothing.",
    )
    arguments = parser.parse_args()

    model_dir = PROJECT_ROOT / "models" / arguments.model_folder
    model_path = model_dir / f"{arguments.model_folder}_model.keras"
    thresholds_path = (
        model_dir / f"{arguments.model_folder}_thresholds.json"
    )

    if not model_path.exists():
        raise SystemExit(f"No model at {model_path}")

    metadata = json.loads(thresholds_path.read_text(encoding="utf-8"))
    labels = [str(label) for label in metadata["labels"]]
    old_thresholds = dict(metadata.get("thresholds", {}))

    data_dir = (
        PROJECT_ROOT
        / "data"
        / arguments.region
        / "processed"
        / arguments.dataset
    )

    recall_floors = parse_per_label(arguments.min_recall, labels)

    if not recall_floors:
        raise SystemExit(
            "Nothing to do: pass --min-recall. Without a floor this "
            "would only repeat the best F1 choice training already made."
        )

    model = tf.keras.models.load_model(model_path, compile=False)

    print("Reading the validation split")
    val_volumes, val_truth = load_split(data_dir / "val.csv", labels)
    val_scores = model.predict(val_volumes, verbose=0, batch_size=8)

    print("Reading the test split")
    test_volumes, test_truth = load_split(data_dir / "test.csv", labels)
    test_scores = model.predict(test_volumes, verbose=0, batch_size=8)

    print("\n=== Choosing thresholds on the validation split ===")
    new_thresholds: dict[str, float] = {}

    for index, label in enumerate(labels):
        if label not in recall_floors:
            new_thresholds[label] = float(old_thresholds.get(label, 0.5))
            print(f"{label}: left at {new_thresholds[label]:.4f}")
            continue

        new_thresholds[label] = tune_for_recall(
            val_truth[:, index],
            val_scores[:, index],
            label,
            recall_floors[label],
        )

    before = describe(test_truth, test_scores, old_thresholds, labels)
    after = describe(test_truth, test_scores, new_thresholds, labels)

    print("\n=== What changes on the test split ===")
    print(
        f"{'finding':26s} {'threshold':>18s} {'missed':>12s} "
        f"{'false alarms':>14s}"
    )
    print("-" * 74)

    for label in labels:
        missed_before = (
            before[label]["test_positive_count"]
            - round(
                before[label]["recall"]
                * before[label]["test_positive_count"]
            )
        )
        missed_after = (
            after[label]["test_positive_count"]
            - round(
                after[label]["recall"] * after[label]["test_positive_count"]
            )
        )

        print(
            f"{label[:26]:26s} "
            f"{old_thresholds.get(label, 0.5):8.3f} -> {new_thresholds[label]:6.3f} "
            f"{missed_before:5d} -> {missed_after:3d} "
            f"{before[label]['false_positive_count']:7d} -> "
            f"{after[label]['false_positive_count']:3d}"
        )

    if arguments.dry_run:
        print("\nDry run: nothing was written.")
        return

    metadata["thresholds"] = new_thresholds
    metadata["thresholdRule"] = {
        "chosenBy": "minimum recall on the validation split",
        "minRecall": recall_floors,
        "replaces": "best F1, which training picks by default",
    }
    thresholds_path.write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    (model_dir / "test_metrics.json").write_text(
        json.dumps(after, indent=2), encoding="utf-8"
    )

    predictions = np.zeros_like(test_scores)

    for index, label in enumerate(labels):
        predictions[:, index] = (
            test_scores[:, index] >= new_thresholds[label]
        ).astype(np.float32)

    if len(labels) == 1:
        report = classification_report(
            test_truth[:, 0],
            predictions[:, 0],
            labels=[0, 1],
            target_names=[f"no {labels[0]}", labels[0]],
            zero_division=0,
        )
    else:
        report = classification_report(
            test_truth,
            predictions,
            target_names=labels,
            zero_division=0,
        )

    (model_dir / "test_report.txt").write_text(report, encoding="utf-8")

    print("\n" + report)
    print(f"Written to {thresholds_path.name}, test_metrics.json and "
          "test_report.txt")


if __name__ == "__main__":
    main()
