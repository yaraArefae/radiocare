from pathlib import Path

import numpy as np
import pandas as pd

dataset_path = Path(
    r"data\bone_tumor\sources\btxrd\extracted\BTXRD\dataset.xlsx"
)

df = pd.read_excel(
    dataset_path,
    sheet_name="Sheet1",
)

df["age"] = pd.to_numeric(
    df["age"],
    errors="coerce",
)

adult = df[df["age"] >= 18].copy()

strict = adult[
    (adult["hand"] == 1)
    | (adult["wrist-joint"] == 1)
].copy()

expanded = adult[
    (adult["hand"] == 1)
    | (adult["wrist-joint"] == 1)
    | (adult["radius"] == 1)
    | (adult["ulna"] == 1)
].copy()


def add_class(data):
    data = data.copy()

    data["class"] = np.select(
        [
            data["malignant"].eq(1),
            data["benign"].eq(1),
            data["tumor"].eq(0),
        ],
        [
            "MALIGNANT",
            "BENIGN",
            "NORMAL",
        ],
        default="UNSPECIFIED",
    )

    return data


strict = add_class(strict)
expanded = add_class(expanded)

print("\nALL DATA:", len(df))
print("ALL ADULTS:", len(adult))

print("\nSTRICT HAND + WRIST:", len(strict))
print(strict["class"].value_counts().to_string())

print("\nEXPANDED HAND + WRIST + RADIUS + ULNA:", len(expanded))
print(expanded["class"].value_counts().to_string())

subtypes = [
    "osteochondroma",
    "multiple osteochondromas",
    "simple bone cyst",
    "giant cell tumor",
    "osteofibroma",
    "synovial osteochondroma",
    "other bt",
    "osteosarcoma",
    "other mt",
]

print("\nTUMOR SUBTYPES IN STRICT HAND/WRIST:")

for column in subtypes:
    if column in strict.columns:
        count = int(strict[column].fillna(0).sum())

        if count > 0:
            print(f"{column}: {count}")
