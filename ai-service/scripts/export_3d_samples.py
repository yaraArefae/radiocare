"""
Picks a handful of volumes out of the prepared test splits and writes
them somewhere a person can find them, named after what they actually
are.

A model is easy to believe until it is fed a case whose answer is
already known. These samples come from the test split, which the model
never trained on, and the true finding is written into every file name,
so an upload can be checked against the truth in one glance instead of
being taken on trust.

Each sample is written twice: as the .npy the training pipeline
produces, and as the .nii.gz a hospital would actually send, so both
upload paths of the service can be tried.

    python scripts/export_3d_samples.py
    python scripts/export_3d_samples.py --split val --per-label 5

Output:

    data/_samples_3d/<region>_<dataset>/<label>_<number>.npy
    data/_samples_3d/<region>_<dataset>/<label>_<number>.nii.gz

and for any split other than the test one, in a folder of its own:

    data/_samples_3d_val/<region>_<dataset>/...
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = PROJECT_ROOT / "data" / "_samples_3d"

"""
Every prepared 3D dataset is looked for in the place the preparation
script writes it. A region that has not been prepared yet is skipped
rather than reported as an error: not every clinic has a volumetric
dataset, and that is the normal state of things.
"""
KNOWN_SETS = [
    ("chest", "nodule3d"),
    ("chest", "fracture3d"),
    ("abdomen", "adrenal3d"),
    ("abdomen", "organ3d"),
    ("head", "vessel3d"),
]


def samples_root(split: str) -> Path:
    """
    The test split keeps the plain folder name it has always had, and
    any other split gets its own root next to it, so the two never
    overwrite each other and the folder a person is looking at always
    says which split it came from.
    """
    if split == "test":
        return SAMPLES_DIR

    return SAMPLES_DIR.with_name(f"{SAMPLES_DIR.name}_{split}")


def export_dataset(
    region: str,
    dataset: str,
    per_label: int,
    split: str,
) -> int:
    data_dir = PROJECT_ROOT / "data" / region / "processed" / dataset
    split_csv = data_dir / f"{split}.csv"
    descriptor_path = data_dir / "dataset.json"

    if not split_csv.exists() or not descriptor_path.exists():
        return 0

    descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    labels = [str(label) for label in descriptor["labels"]]

    frame = pd.read_csv(split_csv)
    output_dir = samples_root(split) / f"{region}_{dataset}"
    output_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    notes: list[str] = []

    """
    A healthy case matters as much as a sick one. A model that answers
    every study with the same finding still looks convincing when it is
    only ever shown positives, so the negatives are exported too.
    """
    selections: list[tuple[str, pd.DataFrame]] = []

    for label in labels:
        selections.append(
            (label, frame[frame[label] == 1].head(per_label))
        )

    healthy = frame[frame[labels].sum(axis=1) == 0].head(per_label)

    if not healthy.empty:
        selections.append(("no_finding", healthy))

    for name, rows in selections:
        for position, (_, row) in enumerate(rows.iterrows(), start=1):
            source = PROJECT_ROOT / str(row["volume_path"])

            if not source.exists():
                continue

            volume = np.load(source)
            stem = f"{name}_{position:02d}"

            np.save(output_dir / f"{stem}.npy", volume)

            try:
                import nibabel

                nibabel.save(
                    nibabel.Nifti1Image(
                        volume.astype(np.float32),
                        np.eye(4),
                    ),
                    str(output_dir / f"{stem}.nii.gz"),
                )
            except ImportError:
                pass

            written += 1

        notes.append(f"{name}: {len(rows)}")

    """
    The validation split decided the decision thresholds of the model,
    so its answers here are flattered by that. It is worth trying, but
    only the test split is an honest score, and anyone reading these
    files has to be told which of the two they are holding.
    """
    split_note = (
        "The model never saw these volumes during training, and they "
        "played no part in choosing its thresholds either. This is the "
        "split its published scores were measured on."
        if split == "test"
        else "The model never trained on these volumes, but its "
        "decision thresholds were tuned on this split, so it does "
        "slightly better here than it would on unseen cases. The test "
        "split is the honest score."
    )

    (output_dir / "README.txt").write_text(
        "\n".join(
            [
                f"Samples from the {split} split of {region}/{dataset}.",
                split_note,
                "",
                "The file name is the true finding:",
                *[f"    {note}" for note in notes],
                "",
                "Send one to the service with:",
                "",
                f"    POST /predict/volume/<region>",
                "    field name: study",
                "",
            ]
        ),
        encoding="utf-8",
    )

    print(f"{region}/{dataset}: {written} samples -> {output_dir}")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export test volumes to try the service with."
    )
    parser.add_argument(
        "--per-label",
        type=int,
        default=3,
        help="How many volumes to export per finding.",
    )
    parser.add_argument(
        "--split",
        default="test",
        choices=["test", "val", "train"],
        help=(
            "Which split to take the samples from. Only the test split "
            "is an honest score: the thresholds were tuned on the "
            "validation split, and the model was trained on the rest."
        ),
    )
    arguments = parser.parse_args()

    total = 0

    for region, dataset in KNOWN_SETS:
        total += export_dataset(
            region,
            dataset,
            arguments.per_label,
            arguments.split,
        )

    if total == 0:
        print(
            "Nothing to export yet. Prepare a dataset first, for example:\n"
            "    python scripts/prepare_3d_data.py chest --dataset nodule3d"
        )
        return

    print(
        f"\n{total} samples written to: "
        f"{samples_root(arguments.split)}"
    )


if __name__ == "__main__":
    main()
