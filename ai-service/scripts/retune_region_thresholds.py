"""
Re-picks the decision thresholds of a trained region model, without
retraining it.

A threshold is not part of what the network learned: it is the point at
which its score becomes a finding shown to a doctor, and it can be moved
whenever the clinic decides it is answering too loudly or too quietly.
Retraining an hour long run to move a number is waste, so this script
loads a finished model, tunes its thresholds on the validation split
under a precision floor, and rewrites the thresholds file, the test
metrics and the test report so all three keep telling the same story.

    python scripts/retune_region_thresholds.py spine_findings_v2 \
        --region spine --dataset csxa_multilabel --min-precision 0.70

The validation split decides the threshold and the test split only
measures it, exactly as in training: choosing a cut point by looking at
the test numbers would make those numbers meaningless.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    precision_recall_curve,
    roc_auc_score,
)

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import train_btxrd_region_multilabel as trainer  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent


def describe(
    truth: np.ndarray,
    scores: np.ndarray,
    thresholds: dict[str, float],
    labels: list[str],
) -> dict[str, dict[str, float]]:
    """
    The measured behaviour of one set of thresholds on one split.
    """
    summary: dict[str, dict[str, float]] = {}

    for index, label in enumerate(labels):
        column = truth[:, index]
        score = scores[:, index]
        predicted = score >= thresholds[label]

        true_positive = int((predicted & (column > 0)).sum())
        false_positive = int((predicted & (column == 0)).sum())
        false_negative = int((~predicted & (column > 0)).sum())

        summary[label] = {
            "threshold": round(float(thresholds[label]), 6),
            "roc_auc": (
                round(float(roc_auc_score(column, score)), 4)
                if column.sum() > 0
                else None
            ),
            "average_precision": (
                round(float(average_precision_score(column, score)), 4)
                if column.sum() > 0
                else None
            ),
            "precision": round(
                true_positive / max(1, true_positive + false_positive), 4
            ),
            "recall": round(
                true_positive / max(1, true_positive + false_negative), 4
            ),
            "false_positive_count": false_positive,
            "test_positive_count": int(column.sum()),
        }

    return summary


def tune_for_recall(
    truth: np.ndarray,
    scores: np.ndarray,
    label: str,
    min_recall: float,
) -> float:
    """
    The most precise cut off that still finds the share of cases the
    clinic refuses to miss.

    This is the rule a malignant lesion is chosen by. Asking for the
    best F1 there would trade away the cases that matter most for a
    tidier score; asking for a precision floor would let the model go
    quiet on them. The clinic names the recall, and the false alarms
    are what that costs.
    """
    precision, recall, cut_offs = precision_recall_curve(truth, scores)

    reachable = recall[:-1] >= min_recall

    if not reachable.any():
        print(
            f"{label}: no cut off reaches recall {min_recall:.2f}, "
            "taking the highest recall available."
        )
        best = int(np.argmax(recall[:-1]))
    else:
        candidates = np.where(reachable, precision[:-1], -1.0)
        best = int(np.argmax(candidates))

    threshold = float(min(0.95, max(0.05, float(cut_offs[best]))))

    print(
        f"{label}: threshold {threshold:.4f} "
        f"(validation precision {precision[best]:.2f}, "
        f"recall {recall[best]:.2f})"
    )

    return threshold


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-tune the thresholds of a trained region model."
    )
    parser.add_argument(
        "model_folder",
        help="Folder under models/, such as spine_findings_v2.",
    )
    parser.add_argument(
        "--region",
        required=True,
        help="Folder under data/, such as spine.",
    )
    parser.add_argument(
        "--dataset",
        required=True,
        choices=sorted(trainer.DATASET_PRESETS),
    )
    parser.add_argument(
        "--min-precision",
        default=None,
        help=(
            "One number for every label, or per label pairs such as "
            "loss_of_lordosis=0.85,cervical_kyphosis=0.70. A label that "
            "carries a different clinical cost deserves a different "
            "floor: missing a reversed curvature matters more than "
            "missing a straightened one."
        ),
    )
    parser.add_argument(
        "--min-recall",
        default=None,
        help=(
            "Lowest recall a threshold may have on the validation "
            "split, as one number or as per label pairs. Among the cut "
            "offs that clear it, the most precise one is taken. This is "
            "the knob a finding such as a malignant lesion needs: the "
            "clinic decides how many cases it refuses to miss, and the "
            "false alarms are what that costs. A label may carry this "
            "or a precision floor, not both."
        ),
    )
    arguments = parser.parse_args()

    trainer.LABELS = trainer.DATASET_PRESETS[arguments.dataset]
    labels = trainer.LABELS

    model_dir = PROJECT_ROOT / "models" / arguments.model_folder
    model_path = model_dir / f"{arguments.model_folder}_model.keras"
    thresholds_path = (
        model_dir / f"{arguments.model_folder}_thresholds.json"
    )

    if not model_path.exists():
        raise FileNotFoundError(f"No model at: {model_path}")

    data_dir = (
        PROJECT_ROOT
        / "data"
        / arguments.region
        / "processed"
        / arguments.dataset
    )

    val_df = trainer.load_split(data_dir / "val.csv")
    test_df = trainer.load_split(data_dir / "test.csv")

    model = tf.keras.models.load_model(model_path, compile=False)

    val_scores = model.predict(
        trainer.make_dataset(val_df, training=False), verbose=0
    )
    test_scores = model.predict(
        trainer.make_dataset(test_df, training=False), verbose=0
    )

    val_truth = val_df[labels].to_numpy(dtype=np.float32)
    test_truth = test_df[labels].to_numpy(dtype=np.float32)

    """
    The thresholds the model shipped with, kept so the change is
    reported as a before and after rather than as a bare new number.
    """
    previous = {}

    if thresholds_path.exists():
        previous = json.loads(thresholds_path.read_text()).get(
            "thresholds", {}
        )

    """
    One floor for everything, or one per label. Tuning runs per label
    anyway, so a per label floor is the same call repeated with the
    column of that label.
    """
    def parse_floors(value) -> dict[str, float | None]:
        parsed: dict[str, float | None] = {label: None for label in labels}

        if not value:
            return parsed

        if "=" in str(value):
            for pair in str(value).split(","):
                name, _, number = pair.partition("=")
                name = name.strip()

                if name not in parsed:
                    raise ValueError(
                        f"Unknown label: {name}. Labels: {labels}"
                    )

                parsed[name] = float(number)
        else:
            shared = float(value)
            parsed = {label: shared for label in labels}

        return parsed

    floors = parse_floors(arguments.min_precision)
    recall_floors = parse_floors(arguments.min_recall)

    print("=== Tuning on the validation split ===")
    thresholds: dict[str, float] = {}
    all_labels = labels

    for index, label in enumerate(all_labels):
        if recall_floors[label] is not None:
            if floors[label] is not None:
                raise ValueError(
                    f"{label} was given both a precision and a recall "
                    "floor. Pick the one the clinic actually decides on."
                )

            thresholds[label] = tune_for_recall(
                val_truth[:, index],
                val_scores[:, index],
                label,
                float(recall_floors[label]),
            )
            continue

        trainer.LABELS = [label]
        thresholds.update(
            trainer.tune_thresholds(
                val_truth[:, index : index + 1],
                val_scores[:, index : index + 1],
                min_precision=floors[label],
            )
        )

    trainer.LABELS = all_labels

    if previous:
        print("\n=== Test split, before ===")
        for label, values in describe(
            test_truth, test_scores, previous, labels
        ).items():
            print(
                f"{label:<20} threshold {values['threshold']:.4f}  "
                f"precision {values['precision']:.2f}  "
                f"recall {values['recall']:.2f}  "
                f"false alarms {values['false_positive_count']}"
            )

    print("\n=== Test split, after ===")
    metrics = describe(test_truth, test_scores, thresholds, labels)

    for label, values in metrics.items():
        print(
            f"{label:<20} threshold {values['threshold']:.4f}  "
            f"precision {values['precision']:.2f}  "
            f"recall {values['recall']:.2f}  "
            f"false alarms {values['false_positive_count']}"
        )

    """
    Everything the model already carried, such as the labels it was
    told not to report, is kept: only the thresholds are replaced.
    """
    payload: dict[str, object] = {}

    if thresholds_path.exists():
        payload = json.loads(thresholds_path.read_text())

    payload["labels"] = labels
    payload["thresholds"] = {
        label: float(thresholds[label]) for label in labels
    }

    if arguments.min_precision is not None:
        payload["thresholdRule"] = (
            "Best F1 on the validation split among the cut offs that "
            "reach the precision floor of the label."
        )
        payload["precisionFloor"] = {
            label: floor
            for label, floor in floors.items()
            if floor is not None
        }

    thresholds_path.write_text(json.dumps(payload, indent=2))

    (model_dir / "test_metrics.json").write_text(
        json.dumps(metrics, indent=2)
    )

    predictions = np.stack(
        [
            (test_scores[:, index] >= thresholds[label]).astype(
                np.float32
            )
            for index, label in enumerate(labels)
        ],
        axis=1,
    )

    (model_dir / "test_report.txt").write_text(
        classification_report(
            test_truth,
            predictions,
            target_names=labels,
            zero_division=0,
            digits=2,
        )
    )

    print(f"\nWrote {thresholds_path}")


if __name__ == "__main__":
    main()
