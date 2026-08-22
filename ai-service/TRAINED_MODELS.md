# RadioCare — the trained models

Eighteen models were trained and measured. Every number below is the
model's **weakest finding**, measured on a **test split** that was never
used to tune it.

The weakest finding is the number that matters, because a doctor meets
the weakest one as often as the best one. The service applies the same
rule when it decides how to present a result.

| # | Model | Type | Diagnoses | Score | Verdict |
|---|---|---|---|---|---|
| 1 | Head MRI | MRI | Enhancing brain tumour | 0.986 | Reliable |
| 2 | Chest CT — Lung Tumour | CT | Lung tumour | 0.979 | Reliable |
| 3 | Chest X-ray — Triage | X-ray | Normal / abnormal | 0.965 | Reliable |
| 4 | Head MRA | MRA | Intracranial aneurysm | 0.946 | Reliable |
| 5 | Colon CT | CT | Colon tumour | 0.914 | Reliable |
| 6 | Chest CT — Nodule | CT | Malignant nodule | 0.908 | Reliable |
| 7 | Hand & Wrist X-ray | X-ray | Fracture, osteopenia, cast, metal | 0.904 | Reliable |
| 8 | Kidney CT | CT | Kidney tumour | 0.891 | Reliable |
| 9 | Abdomen CT — Adrenal | CT | Adrenal mass | 0.888 | Reliable |
| 10 | Leg & Foot X-ray | X-ray | Benign / malignant bone lesion | 0.858 | Reliable |
| 11 | Shoulder X-ray | X-ray | Shoulder abnormality | 0.777 | Confirm each finding |
| 12 | Chest CT — COVID | CT | Lung involvement | 0.756 | Confirm each finding |
| 13 | Pelvis & Hip X-ray | X-ray | Bone lesion | 0.686 | Too weak |
| 14 | Rib CT | CT | Rib fracture, three types | 0.696 | Too weak |
| 15 | Chest X-ray — Findings | X-ray | Eight chest findings | 0.678 | Too weak |
| 16 | Spine X-ray | X-ray | Cervical curvature, three types | 0.676 | Too weak |
| 17 | Shoulder Fracture X-ray | X-ray | Shoulder fracture | 0.664 | **Disabled in code** |
| 18 | Liver CT | CT | Liver tumour | 0.609 | Too weak |

**Reliable 10 · Confirm each finding 2 · Too weak 6**

---

## Why the weak ones are weak

| Model | Cause |
|---|---|
| Liver CT 0.609 | Trained on twenty studies. The test split is about four patients wide. |
| Pelvis & Hip 0.686 | The clinic is read by the all-regions model, and this is that model measured on the pelvis split: thirty seven images, six of them malignant. A number resting on six cases carries a wide margin. |
| Rib CT 0.696 | The non-displaced fracture is the hard type. The displaced one reads 0.862 in the same model. |
| Spine X-ray 0.676 | Only `sigmoid_curvature` is weak. The other two findings read 0.925 and 0.945. |
| Chest Findings 0.678 | Pneumonia. Only 3.4% of the training images carry a usable pneumonia label — the radiologist who labelled the dataset marked the rest uncertain, and those are excluded from the loss. Pneumonia is a clinical diagnosis rather than a radiological one: the same consolidation can be pneumonia, oedema, tumour or aspiration, and the X-ray alone cannot tell them apart. The same model reads **consolidation** — the visible sign — at 0.868. |
| Shoulder Fracture 0.664 | Trained, measured, and switched off (`SHOULDER_FRACTURE_MODEL_ENABLED = False`). Showing a coin toss to a doctor is worse than showing nothing. |

---

## Not in the table

**Still training:** `Pancreas CT` and `Liver Vessels CT` are registered
and answer `NOT_ANALYZED` until their models land.

**Never trained — no public labelled data exists:** `Spine CT`,
`Pelvis & Hip CT`, `Lower Limb CT`, `Shoulder CT`. They are registered
and answer `NOT_ANALYZED` on purpose. An unregistered region gives the
doctor an error; a registered one that says NOT_ANALYZED tells them the
AI examined nothing and their own reading is the only one.

**Superseded versions kept in the repository:** `spine_findings` v1 and
v2, `chest_triage_v4`, `shoulder_triage_v2`, `hand_triage_v1`,
`chest_3d_fracture3d` at 28³, and everything under `_experimental/`.
They are the evidence that the served version is the better one, and
none of them runs in the application.

---

## One caution before quoting any of these

**AUCs from different models are not comparable.** Each was measured on
its own test set, from its own dataset, at its own difficulty. A 0.91 on
a hard dataset can be a better result than a 0.97 on an easy one.

A comparison is only valid when both models were measured on the **same
split**. `lower_limb_v2` reads 0.918 against the served model's 0.891
and looks better; measured on one split, the ranking inverts.
