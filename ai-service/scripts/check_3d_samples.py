"""
Sends every exported sample to the running service and prints what the
AI answered next to what the case actually is.

The samples come from the test split and carry their true finding in
their file name, so the two columns can be compared without a doctor
and without trusting the model's own confidence. That is the whole
point: a model is easy to believe until it is scored on cases whose
answers were decided before it ever saw them.

Start the service first, then:

    python scripts/check_3d_samples.py
    python scripts/check_3d_samples.py --url http://127.0.0.1:8001

A wrong answer here is not a fault. The accuracy of these models is
printed with their scores when they are trained, and a model with an
AUC of 0.9 is expected to miss cases. What would be a fault is a model
that answers the same thing for every case, and this table shows that
immediately.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import urllib.error
import urllib.request
import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = PROJECT_ROOT / "data" / "_samples_3d"

"""
Which endpoint reads which sample folder. The organ folder is absent on
purpose: that model names a body part rather than a finding, so it is
not served to the clinics and there is nothing here to check it against.
"""
FOLDER_ENDPOINTS = {
    "chest_nodule3d": "chest-ct",
    "chest_fracture3d": "chest-ct-ribs",
    "abdomen_adrenal3d": "abdomen-ct",
    "head_vessel3d": "head-mra",
}

NO_FINDING = "no_finding"


def truth_from_name(file_name: str) -> str:
    """
    The exporter names a file after the finding it holds followed by a
    number, so "malignant_nodule_02.nii.gz" is a malignant nodule.
    """
    stem = file_name.split(".")[0]
    parts = stem.rsplit("_", 1)

    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]

    return stem


def post_volume(url: str, path: Path) -> dict:
    """
    Uploads one volume as multipart form data, the same way the browser
    does, using only the standard library.
    """
    boundary = uuid.uuid4().hex
    content_type = (
        mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )

    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            (
                'Content-Disposition: form-data; name="study"; '
                f'filename="{path.name}"\r\n'
            ).encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )

    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": (
                f"multipart/form-data; boundary={boundary}"
            )
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def check_folder(
    base_url: str,
    folder: Path,
    region: str,
) -> tuple[int, int]:
    volumes = sorted(folder.glob("*.nii.gz"))

    if not volumes:
        return 0, 0

    """
    Two kinds of set need two different questions asked of them.

    A set that contains healthy cases is a set of yes or no questions:
    the model is right when it detected the finding that is there, and
    right about a healthy case when it detected nothing. A set where
    every case carries exactly one of several findings, the rib
    fractures being the one here, is a single choice: asking only
    whether the true type was among those detected would score the
    model correct while it ranked a different type above it.
    """
    has_healthy_cases = any(
        path.name.startswith(NO_FINDING) for path in volumes
    )

    print(f"\n=== {folder.name}  ->  /predict/volume/{region}")
    print(
        "Scored on whether the finding was detected."
        if has_healthy_cases
        else "Every case here carries one finding, so this is scored on "
        "the highest ranked one."
    )
    print(
        f"{'true finding':28s} {'AI answered':30s} "
        f"{'highest score':>26s}   ok"
    )
    print("-" * 100)

    correct = 0

    for path in volumes:
        truth = truth_from_name(path.name)

        try:
            answer = post_volume(
                f"{base_url}/predict/volume/{region}",
                path,
            )
        except urllib.error.URLError as error:
            print(f"{truth:28s} could not reach the service: {error}")
            continue

        findings = answer.get("allFindings") or []
        detected = {
            str(item["label"])
            for item in findings
            if item.get("detected")
        }

        """
        The service returns the findings sorted by probability, so the
        first one is the model's strongest answer whether or not it
        cleared its threshold.
        """
        top = findings[0] if findings else {}

        if has_healthy_cases:
            is_correct = (
                not detected
                if truth == NO_FINDING
                else truth in detected
            )
        else:
            is_correct = str(top.get("label", "")) == truth

        correct += int(is_correct)

        """
        Two answers are printed, because they are not always the same
        one. "AI answered" is what the application shows a doctor, and
        that is the detected finding of highest clinical priority, so a
        rarely serious finding outranks a likelier harmless one on
        purpose. The highest score is the model's own ranking.
        """
        answered = (
            answer.get("primaryFinding")
            or answer.get("result")
            or "?"
        )

        print(
            f"{truth:28s} {str(answered)[:30]:30s} "
            f"{str(top.get('label', '-'))[:19]:>19s} "
            f"{float(top.get('probability', 0.0)):5.1f}%   "
            f"{'OK' if is_correct else 'X'}"
        )

    print(
        f"\n{correct} of {len(volumes)} sample answers matched the truth."
    )
    return correct, len(volumes)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare the AI answers with the true findings."
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8001",
        help="Where the AI service is running.",
    )
    parser.add_argument(
        "--samples",
        type=Path,
        default=SAMPLES_DIR,
        help="Folder holding the exported samples.",
    )
    arguments = parser.parse_args()

    base_url = arguments.url.rstrip("/")

    if not arguments.samples.exists():
        print(
            f"No samples were found in {arguments.samples}.\n"
            "Run scripts/export_3d_samples.py first."
        )
        return

    total_correct = 0
    total_seen = 0

    for folder_name, region in FOLDER_ENDPOINTS.items():
        folder = arguments.samples / folder_name

        if not folder.exists():
            continue

        correct, seen = check_folder(base_url, folder, region)
        total_correct += correct
        total_seen += seen

    if total_seen == 0:
        print(
            "Nothing was checked. Is the service running, and were the "
            "samples exported?"
        )
        return

    print("\n" + "=" * 82)
    print(
        f"Overall: {total_correct} of {total_seen} "
        f"({total_correct / total_seen * 100:.0f}%) matched the truth."
    )
    print(
        "Every one of these is a preliminary result that a doctor still "
        "reads."
    )


if __name__ == "__main__":
    main()
