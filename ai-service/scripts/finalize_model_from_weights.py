"""
Rebuilds a finished model from the checkpoint weights of a training run.

The trainer used to save the model only after printing its report, so a
formatting error at the very end threw away a completed run. The weights
themselves survive in best_finetune.weights.h5, and this script turns
them back into the model, the thresholds, and the metrics the AI service
expects, without training again.

    python scripts/finalize_model_from_weights.py fracture \\
        --dataset fracatlas --output-name fracture_findings

The trainer no longer loses a run this way, so this script is only for
recovering the runs that were affected.
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
    roc_auc_score,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from train_btxrd_region_multilabel import (  # noqa: E402
    DATASET_PRESETS,
    build_model,
    load_split,
    make_dataset,
    tune_thresholds,
)
import train_btxrd_region_multilabel as trainer  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Finalize a model from its checkpoint weights."
    )
    parser.add_argument("region")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output-name", required=True)
    arguments = parser.parse_args()

    trainer.LABELS = DATASET_PRESETS[arguments.dataset]
    labels = trainer.LABELS

    data_dir = (
        PROJECT_ROOT
        / "data"
        / arguments.region
        / "processed"
        / arguments.dataset
    )
    model_dir = PROJECT_ROOT / "models" / arguments.output_name

    weights_path = model_dir / "best_finetune.weights.h5"

    if not weights_path.exists():
        weights_path = model_dir / "best_stage1.weights.h5"

    if not weights_path.exists():
        raise FileNotFoundError(
            f"No checkpoint weights were found in {model_dir}"
        )

    print(f"Rebuilding from: {weights_path}")

    val_df = load_split(data_dir / "val.csv")
    test_df = load_split(data_dir / "test.csv")

    model, base_model = build_model(np.ones(len(labels), dtype=np.float32))

    """
    The fine tuning checkpoint was written while part of the backbone was
    trainable, so the same layers are unfrozen before loading.
    """
    base_model.trainable = True
    for layer in base_model.layers[:-40]:
        layer.trainable = False

    model.load_weights(weights_path)

    val_scores = model.predict(make_dataset(val_df, training=False), verbose=0)
    thresholds = tune_thresholds(
        val_df[labels].to_numpy(dtype=np.float32),
        val_scores,
    )

    test_scores = model.predict(
        make_dataset(test_df, training=False),
        verbose=0,
    )
    test_truth = test_df[labels].to_numpy(dtype=np.float32)

    metrics: dict[str, dict[str, object]] = {}
    predictions = np.zeros_like(test_scores)

    for index, label in enumerate(labels):
        threshold = thresholds[label]
        predictions[:, index] = (
            test_scores[:, index] >= threshold
        ).astype(np.float32)

        truth = test_truth[:, index]
        score = test_scores[:, index]

        metrics[label] = {
            "threshold": round(float(threshold), 6),
            "roc_auc": round(float(roc_auc_score(truth, score)), 4),
            "average_precision": round(
                float(average_precision_score(truth, score)), 4
            ),
            "test_positive_count": int(truth.sum()),
        }

        print(
            f"{label:18s} auc={metrics[label]['roc_auc']} "
            f"ap={metrics[label]['average_precision']} "
            f"threshold={threshold:.4f}"
        )

    model.save(model_dir / f"{arguments.output_name}_model.keras")

    (model_dir / f"{arguments.output_name}_thresholds.json").write_text(
        json.dumps({"labels": labels, "thresholds": thresholds}, indent=2),
        encoding="utf-8",
    )

    (model_dir / "test_metrics.json").write_text(
        json.dumps(metrics, indent=2),
        encoding="utf-8",
    )

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

    print("\n" + report)
    (model_dir / "test_report.txt").write_text(report, encoding="utf-8")

    print(f"Model written to: {model_dir}")


if __name__ == "__main__":
    main()
