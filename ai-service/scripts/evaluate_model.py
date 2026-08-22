"""
Scores a trained model on a test split and writes the result where the
report reads it.

Some models here were trained by scripts that never wrote a
test_metrics.json, so they serve patients with no recorded accuracy at
all. That is the worst kind of gap: the model looks finished, and
nobody can answer what it is worth. This script closes it without
retraining anything.

    python scripts/evaluate_model.py chest/chest_findings_model_v2 \\
        --test data/chest_findings/processed/test.csv \\
        --labels "Cardiomegaly" "Lung Opacity"

    python scripts/evaluate_model.py shoulder_fracture \\
        --test data/fracture/processed/fracatlas/test.csv \\
        --labels fracture_visible

The output is the same file a training run writes, so the model joins
the report next to the ones that were measured all along.

A note on the mask columns
--------------------------

A chest set built from CheXpert marks each finding with a second column
saying whether that finding was actually assessed on that film. A row
where the radiologist never commented is not a negative, and scoring it
as one punishes the model for a label nobody wrote. Where a column
named "<label>_mask" exists, only the rows it marks are scored, and how
many were used is reported.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_batch(paths: list[str], size: int, preprocess: str) -> np.ndarray:
    import tensorflow as tf

    images = []

    for path in paths:
        raw = tf.io.read_file(path)
        image = tf.io.decode_image(raw, channels=3, expand_animations=False)
        image = tf.image.resize(
            tf.cast(image, tf.float32),
            (size, size),
            antialias=True,
        )

        if preprocess == "mobilenet":
            image = tf.keras.applications.mobilenet_v2.preprocess_input(image)
        else:
            image = image / 255.0

        images.append(image.numpy())

    return np.stack(images)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score a model on a test split."
    )
    parser.add_argument(
        "model",
        help=(
            "Folder under models/, or folder/file when the folder holds "
            "more than one model."
        ),
    )
    parser.add_argument("--test", required=True, type=Path)
    parser.add_argument("--labels", nargs="+", required=True)
    parser.add_argument(
        "--preprocess",
        default="mobilenet",
        choices=["mobilenet", "rescale"],
        help="How the training run fed pixels to the model.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Score only this many rows. The whole split by default.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
    )
    arguments = parser.parse_args()

    import tensorflow as tf
    from sklearn.metrics import average_precision_score, roc_auc_score

    """
    A folder can hold several models, and the one being served is not
    always the one whose name matches the folder.
    """
    if "/" in arguments.model:
        folder_name, file_stem = arguments.model.split("/", 1)
        model_dir = PROJECT_ROOT / "models" / folder_name
        model_path = model_dir / f"{file_stem}.keras"
    else:
        model_dir = PROJECT_ROOT / "models" / arguments.model
        model_path = model_dir / f"{arguments.model}_model.keras"

    if not model_path.exists():
        raise SystemExit(f"No model at {model_path}")

    test_path = arguments.test

    if not test_path.is_absolute():
        test_path = PROJECT_ROOT / test_path

    frame = pd.read_csv(test_path)

    if arguments.limit:
        frame = frame.head(arguments.limit)

    missing = set(arguments.labels) - set(frame.columns)

    if missing:
        raise SystemExit(f"Missing label columns: {sorted(missing)}")

    model = tf.keras.models.load_model(model_path, compile=False)
    size = int(model.input_shape[1] or 224)
    outputs = int(model.output_shape[-1])

    if outputs != len(arguments.labels):
        raise SystemExit(
            f"The model has {outputs} outputs and {len(arguments.labels)} "
            "labels were given. They have to line up, in the order the "
            "model was trained on."
        )

    paths = [
        str((PROJECT_ROOT / str(value)).resolve())
        for value in frame["image_path"]
    ]

    print(f"Scoring {len(paths)} rows from {test_path.name}")

    scores = np.zeros((len(paths), outputs), dtype=np.float32)

    for start in range(0, len(paths), arguments.batch_size):
        chunk = paths[start:start + arguments.batch_size]
        batch = load_batch(chunk, size, arguments.preprocess)
        scores[start:start + len(chunk)] = model.predict(batch, verbose=0)

        if start and start % (arguments.batch_size * 20) == 0:
            print(f"  {start} / {len(paths)}")

    metrics: dict[str, dict] = {}

    for index, label in enumerate(arguments.labels):
        truth = pd.to_numeric(frame[label], errors="coerce").fillna(0)
        score = scores[:, index]

        """
        Only the rows the set says were assessed for this finding.
        """
        mask_column = f"{label}_mask"

        if mask_column in frame.columns:
            keep = pd.to_numeric(
                frame[mask_column], errors="coerce"
            ).fillna(0) > 0
        else:
            keep = pd.Series(True, index=frame.index)

        truth_kept = truth[keep].to_numpy(dtype=np.float32)
        score_kept = score[keep.to_numpy()]
        positives = int(truth_kept.sum())

        usable = 0 < positives < len(truth_kept)

        metrics[label] = {
            "threshold": 0.5,
            "roc_auc": (
                round(float(roc_auc_score(truth_kept, score_kept)), 4)
                if usable
                else None
            ),
            "average_precision": (
                round(
                    float(average_precision_score(truth_kept, score_kept)), 4
                )
                if positives > 0
                else None
            ),
            "test_positive_count": positives,
            "scored_rows": int(len(truth_kept)),
        }

        print(
            f"{label:22s} auc={metrics[label]['roc_auc']} "
            f"ap={metrics[label]['average_precision']} "
            f"positives={positives} of {len(truth_kept)} scored"
        )

    output = model_dir / "test_metrics.json"

    """
    A file written by a training run is not overwritten here. That file
    records the split the model was actually trained against, and
    replacing it with a score from a different split would quietly
    rewrite history.
    """
    if output.exists():
        output = model_dir / "test_metrics_evaluated.json"
        print(f"\nA test_metrics.json already exists, writing {output.name}")

    output.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"\nWritten to {output}")


if __name__ == "__main__":
    main()
