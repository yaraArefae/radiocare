"""
Builds one folder that exercises every path through this project.

Everything here comes from a test split, so no model was trained on any
of it, and the true finding is written into every file name. That is
what makes the folder worth having: an examiner can upload a file, read
the answer, and check it against the name without taking anybody's word
for it.

    python scripts/export_test_kit.py
    python scripts/export_test_kit.py --out "C:/Users/User/Desktop/RadioCare-Test-Kit"

The folders are numbered in the order of the upload list on the patient
page, so picking the right option is not a guessing game.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent

"""
One entry per option a patient can choose, in the order they appear.

`labels` are the columns of the test split that name a finding. A row
where all of them are zero is a healthy case, and healthy cases are
exported too: a model that answers the same thing every time still looks
convincing when it is only ever shown the sick.
"""
KIT: list[dict] = [
    {
        "folder": "01 - Chest X-ray",
        "kind": "2D",
        "csv": "data/chest_findings/processed/test.csv",
        "labels": [
            "Cardiomegaly",
            "Lung Opacity",
            "Edema",
            "Consolidation",
            "Pneumonia",
            "Atelectasis",
            "Pneumothorax",
            "Pleural Effusion",
        ],
        "option": "Chest",
    },
    {
        "folder": "02 - Shoulder X-ray",
        "kind": "2D",
        "csv": "data/shoulder/processed/triage_multilabel/test.csv",
        "labels": ["shoulder_abnormality"],
        "option": "Shoulder",
    },
    {
        "folder": "03 - Hand and Wrist X-ray",
        "kind": "2D",
        "csv": "data/wrist/processed/grazped_multilabel/test.csv",
        "labels": ["fracture_visible", "osteopenia", "metal", "cast"],
        "option": "Hand & Wrist",
    },
    {
        "folder": "04 - Spine X-ray",
        "kind": "2D",
        "csv": "data/spine/processed/csxa_multilabel/test.csv",
        "labels": [
            "loss_of_lordosis",
            "sigmoid_curvature",
            "cervical_kyphosis",
        ],
        "option": "Spine",
    },
    {
        "folder": "05 - Pelvis and Hip X-ray",
        "kind": "2D",
        "csv": "data/pelvis_hip/processed/btxrd_multilabel/test.csv",
        "labels": ["bone_lesion", "benign_lesion", "malignant_lesion"],
        "option": "Pelvis & Hip",
    },
    {
        "folder": "06 - Leg and Foot X-ray",
        "kind": "2D",
        "csv": "data/lower_limb/processed/btxrd_multilabel/test.csv",
        "labels": ["bone_lesion", "benign_lesion", "malignant_lesion"],
        "option": "Leg & Foot",
    },
    {
        "folder": "07 - Chest CT (Lung Nodule)",
        "kind": "3D",
        "csv": "data/chest/processed/nodule3d/test.csv",
        "labels": ["malignant_nodule"],
        "option": "Chest CT - Lung Nodule",
    },
    {
        "folder": "08 - Rib CT (Fracture Type)",
        "kind": "3D",
        # The 64 voxel split, because that is what the served model
        # was trained on. Exporting the 28 voxel version left the
        # service upsampling every sample before reading it, which
        # invents detail the scan never held and is not what the model
        # saw in training. A kit whose files do not match the model is
        # measuring the resampler.
        "csv": "data/chest/processed/fracture3d_64/test.csv",
        "labels": [
            "buckle_rib_fracture",
            "nondisplaced_rib_fracture",
            "displaced_rib_fracture",
        ],
        "option": "Rib CT - Fracture Type",
    },
    {
        "folder": "09 - Chest CT (Whole Scan)",
        "kind": "3D",
        "csv": "data/chest/processed/mosmed/test.csv",
        "labels": ["lung_involvement"],
        "option": "Chest CT (Lungs)",
    },
    {
        "folder": "11 - Lung CT (Tumour)",
        "kind": "3D",
        "csv": "data/chest/processed/patches_lung/test.csv",
        "labels": ["lung_tumour"],
        "option": "Lung CT - Tumour",
    },
    {
        "folder": "12 - Colon CT (Cancer)",
        "kind": "3D",
        "csv": "data/abdomen/processed/patches_colon/test.csv",
        "labels": ["colon_tumour"],
        "option": "Colon CT - Cancer",
    },
    {
        "folder": "13 - Liver Vessels CT (Tumour)",
        "kind": "3D",
        "csv": "data/abdomen/processed/patches_hepatic_vessel/test.csv",
        "labels": ["hepatic_vessel_tumour"],
        "option": "Liver Vessels CT - Tumour",
    },
    {
        "folder": "14 - Pancreas CT (Tumour)",
        "kind": "3D",
        "csv": "data/abdomen/processed/patches_pancreas/test.csv",
        "labels": ["pancreas_tumour"],
        "option": "Pancreas CT - Tumour",
    },
    {
        "folder": "15 - Kidney CT (Tumour)",
        "kind": "3D",
        "csv": "data/abdomen/processed/m3d_0005_kidney_tumour/test.csv",
        "labels": ["kidney_tumour"],
        "option": "Kidney CT - Tumour",
    },
    {
        "folder": "16 - Liver CT (Tumour)",
        "kind": "3D",
        "csv": "data/abdomen/processed/m3d_0009_liver_tumour/test.csv",
        "labels": ["liver_tumour"],
        "option": "Liver CT - Tumour",
    },
    {
        "folder": "10 - Head MRI (Brain Tumour)",
        "kind": "3D",
        "csv": "data/head/processed/patches_brain_tumour/test.csv",
        "labels": ["enhancing_brain_tumour"],
        "option": "Head MRI - Brain Tumour",
    },
]


def truth_name(row: pd.Series, labels: list[str]) -> str:
    """
    Names the file after what the case actually is. A row with nothing
    marked is healthy, and says so, which is the case a demonstration
    most often forgets to include.
    """
    present = [label for label in labels if float(row.get(label, 0)) >= 1]

    if not present:
        return "no_finding"

    return "__".join(present)[:70]


def export_entry(
    entry: dict,
    out_root: Path,
    per_kind: int,
    max_groups: int,
    split: str,
    prefix: str = "",
) -> int:
    csv_path = PROJECT_ROOT / entry["csv"]

    if split != "test":
        csv_path = csv_path.with_name(f"{split}.csv")

    if not csv_path.exists():
        print(f"skipped {entry['folder']}: no {entry['csv']}")
        return 0

    frame = pd.read_csv(csv_path)
    column = "volume_path" if entry["kind"] == "3D" else "image_path"

    if column not in frame.columns:
        print(f"skipped {entry['folder']}: no {column} column")
        return 0

    labels = [label for label in entry["labels"] if label in frame.columns]

    if not labels:
        print(f"skipped {entry['folder']}: none of its labels are present")
        return 0

    folder = out_root / entry["folder"]
    folder.mkdir(parents=True, exist_ok=True)

    """
    Take a few of each distinct answer rather than the first rows of the
    file, which in a sorted split are all the same case.
    """
    frame = frame.copy()
    frame["_truth"] = frame.apply(lambda row: truth_name(row, labels), axis=1)

    written = 0
    counts: dict[str, int] = {}

    """
    A set with eight findings has dozens of combinations, and exporting
    two of each buries the folder in files nobody will open. The
    healthy case is always kept, and the commonest combinations after it,
    which is what a person testing by hand can actually get through.
    """
    frequencies = frame["_truth"].value_counts()
    keep = ["no_finding"] if "no_finding" in frequencies.index else []
    keep += [
        name
        for name in frequencies.index
        if name != "no_finding"
    ][:max_groups]

    frame = frame[frame["_truth"].isin(keep)]

    for truth, group in frame.groupby("_truth"):
        for _, row in group.head(per_kind).iterrows():
            source = PROJECT_ROOT / str(row[column])

            if not source.exists():
                continue

            counts[truth] = counts.get(truth, 0) + 1
            """
            The prefix lets one folder hold more than one split.

            Two organs have too few test cases to try properly on their
            own - the pelvis has 37 and the MosMed chest set has 30 -
            so the kit is built from the test split and then topped up
            from validation. Without a prefix the second run would
            overwrite the first: both name their files no_finding_01
            upward.

            It also keeps the two apart on sight, which matters. Only
            the test split is an honest score, because the thresholds
            were tuned on validation.
            """
            stem = f"{prefix}{truth}_{counts[truth]:02d}"

            if entry["kind"] == "3D":
                volume = np.load(source)
                np.save(folder / f"{stem}.npy", volume)

                try:
                    import nibabel

                    nibabel.save(
                        nibabel.Nifti1Image(
                            volume.astype(np.float32), np.eye(4)
                        ),
                        str(folder / f"{stem}.nii.gz"),
                    )
                except ImportError:
                    pass
            else:
                shutil.copy2(source, folder / f"{stem}{source.suffix}")

            written += 1

    (folder / "_what to pick.txt").write_text(
        "\n".join(
            [
                f"Upload page option:  {entry['option']}",
                f"Split:               {split}",
                f"Study type:          "
                f"{'CT / MRI (3D volume)' if entry['kind'] == '3D' else 'X-ray (single image)'}",
                "",
                "The file name is the true finding.",
                "A file named no_finding should come back NORMAL.",
                "",
                "Cases exported:",
                *[f"    {name}: {count}" for name, count in sorted(counts.items())],
            ]
        ),
        encoding="utf-8",
    )

    print(f"{entry['folder']}: {written} files")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a folder that tests every path."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path.home() / "Desktop" / "RadioCare-Test-Kit",
    )
    parser.add_argument(
        "--per-kind",
        type=int,
        default=2,
        help="How many files per distinct answer.",
    )
    parser.add_argument(
        "--max-groups",
        type=int,
        default=6,
        help=(
            "How many distinct findings to cover, besides the healthy "
            "case, which is always kept."
        ),
    )
    parser.add_argument(
        "--prefix",
        default="",
        help=(
            "Put this in front of every file name, so a second split "
            "can be written into the same folders without overwriting "
            "the first."
        ),
    )
    parser.add_argument(
        "--split",
        default="test",
        choices=["test", "val", "train"],
        help=(
            "Which split to take from. Only the test split is an honest "
            "score: the thresholds were tuned on the validation split."
        ),
    )
    arguments = parser.parse_args()

    out_root = arguments.out

    """
    A fresh kit replaces whatever was there, so a rerun after a model
    changes cannot leave last week's cases behind pretending to be this
    week's.

    A prefixed run is the exception. That is the second split being
    added to a kit the first one just built, and wiping the folder would
    throw away the very files it is meant to sit beside.
    """
    if out_root.exists() and not arguments.prefix:
        shutil.rmtree(out_root)

    out_root.mkdir(parents=True, exist_ok=True)

    total = 0

    for entry in KIT:
        total += export_entry(
            entry,
            out_root,
            arguments.per_kind,
            arguments.max_groups,
            arguments.split,
            arguments.prefix,
        )

    print(f"\n{total} files written to {out_root}")


if __name__ == "__main__":
    main()
