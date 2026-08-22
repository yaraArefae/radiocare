# RadioCare — what the models actually score

Every number here was measured on a **test split**, never on validation.
The thresholds were tuned on validation, so a validation number would be
the model marking its own homework.

Read the **weakest finding**, not the average. A doctor meets the weakest
one as often as the best one, and the service uses the same rule to
decide whether a model is shown to a patient at all:

| Weakest finding | Tier | What the service says |
|---|---|---|
| ≥ 0.85 | high | Reliable as a triage assistant |
| 0.75 – 0.85 | moderate | Useful, but confirm every finding |
| < 0.75 | limited | Too weak to show findings to a patient |

**AUCs are not comparable between models.** Each was measured on its own
test set, from its own dataset, with its own difficulty. A 0.91 on one
dataset can be a harder result than a 0.97 on another. Comparing two
models is only valid when both were measured on the *same* split — which
is why the superseded versions are kept in the repository.

---

## 1. X-ray clinics — what is served

### Chest Clinic — findings
CheXpert derived set. Eight findings, read at once.

| Finding | AUC | Sensitivity | Precision |
|---|---|---|---|
| Consolidation | 0.868 | 0.76 | 0.74 |
| Pleural Effusion | 0.868 | 0.86 | 0.90 |
| Edema | 0.830 | 0.81 | 0.89 |
| Cardiomegaly | 0.809 | 0.77 | 0.88 |
| Lung Opacity | 0.796 | 0.93 | 0.96 |
| Pneumothorax | 0.709 | 0.61 | 0.42 |
| Atelectasis | 0.707 | 0.93 | 0.98 |
| **Pneumonia** | **0.678** | 0.74 | 0.81 |

**Weakest: 0.678 — limited tier.**

Be ready for this question: pneumothorax has 0.42 precision, meaning
more than half of its alarms are false. It is kept because a missed
pneumothorax is an emergency and a false alarm is a second look. That is
a deliberate trade, not an oversight.

### Chest Clinic — triage
`chest_triage_v2`, normal against abnormal: **0.965**

There is also a `chest_triage_v4` at 0.886, which is **not** the served
model. v2 is.

### Hand & Wrist Clinic
GRAZPEDWRI-DX, 14,000 pediatric wrists.

| Finding | AUC |
|---|---|
| cast | 0.999 |
| metal | 0.993 |
| osteopenia | 0.964 |
| fracture_visible | 0.904 |

**Weakest: 0.904 — high tier. The strongest clinic in the project.**

This clinic runs **two** models with a router in front, because a hand
and a wrist are different examinations and one model was covering both
badly. The router is correct on **98.2%** of held out images. Hands go
to a separate model trained on 604 images that answers normal or
abnormal only.

### Spine Clinic
Cervical Spine X-ray Atlas, 4,963 images. `spine_findings_v3`.

| Finding | AUC |
|---|---|
| cervical_kyphosis | 0.945 |
| loss_of_lordosis | 0.925 |
| **sigmoid_curvature** | **0.676** |

**Weakest: 0.676 — limited tier.**

v3 is worth explaining, because it is the clearest design decision in
the 2D half. Measured on the *same* split:

| | v1 | v2 | v3 |
|---|---|---|---|
| curvature AUC | 0.853 | 0.909 | 0.926 |
| kyphosis precision | 0.47 | 0.70 | 0.74 |
| false alarms | 66 | 19 | 17 |

v1 and v2 asked three independent yes/no questions, so the model could
be confident of two contradictory spine shapes at once. v3 predicts one
curvature grade with a softmax and sums the findings out of the grades,
so the grades compete for a single probability.

**Scope limit to state out loud:** this model was trained on cervical
films only. On a thoracic or lumbar film it still returns a number and
that number is meaningless. The service says so in every answer.

### Leg & Foot Clinic
BTXRD, 2,604 images, all regions.

| Finding | AUC |
|---|---|
| malignant_lesion | 0.913 |
| bone_lesion | 0.901 |
| benign_lesion | 0.858 |

**Weakest: 0.858 — high tier.**

### Pelvis & Hip Clinic
Read by `btxrd_lesion_all`, the model trained on all 2,604 BTXRD
images, measured here on the pelvis test split alone.

| Finding | AUC |
|---|---|
| bone_lesion | 0.851 |
| malignant_lesion | 0.844 |
| benign_lesion | 0.686 |

**Weakest: 0.686 — limited tier.**

Two things to say about this number rather than defend it. The split is
**thirty seven images with six malignant lesions**, so the margin is
wide. And until this was checked, the clinic was showing the scores of
`pelvis_hip_findings`, a different and smaller model that is not the one
answering: a doctor was reading one model's score for another model's
reading.

### Shoulder Clinic
Shoulder triage set, 3,551 images. `shoulder_triage_v4`.

`shoulder_abnormality`: **0.777 — moderate tier.**

There is a shoulder **fracture** model in the repository that is
**switched off in code** (`SHOULDER_FRACTURE_MODEL_ENABLED = False`)
because it measured 0.664. Leaving it on would have put a coin toss in
front of a doctor. If asked why a trained model is not used, this is the
answer.

---

## 2. CT and MRI — what is served

Trained from scratch as Conv3D stacks. No pretrained 3D backbone exists
to fine tune, which is the single most important difference from the 2D
half of the project.

| Region | Modality | Finding | AUC | Tier |
|---|---|---|---|---|
| Head MRI | MRI | enhancing_brain_tumour | **0.986** | high |
| Lung Tumour CT | CT | lung_tumour | **0.979** | high |
| Head MRA | MRA | intracranial_aneurysm | **0.946** | high |
| Colon CT | CT | colon_tumour | **0.914** | high |
| Chest CT | CT | malignant_nodule | **0.908** | high |
| Kidney CT | CT | kidney_tumour | **0.891** | high |
| Abdomen CT | CT | adrenal_mass | **0.888** | high |
| Chest CT (Lungs) | CT | lung_involvement (COVID) | **0.756** | moderate |
| Liver CT | CT | liver_tumour | **0.609** | limited |

### Rib CT — three findings, quote all three

| Finding | AUC |
|---|---|
| displaced_rib_fracture | 0.862 |
| buckle_rib_fracture | 0.722 |
| **nondisplaced_rib_fracture** | **0.696** |

**Weakest: 0.696.** Quoting 0.862 alone would be quoting the best third
of the model.

The 64³ version is the served one. Its 28³ predecessor scores 0.724 on
average against 0.760, which is the evidence that resolution mattered
here.

### Liver CT — the honest weak point

**0.609 is close to a coin toss (0.5).** It learned from twenty studies,
which is far too few, and the test split is about four patients wide.

It is registered anyway, with a scope note that states the number and
tells the doctor to look themselves. The fix is a larger dataset (MSD
Task03_Liver, 131 annotated livers against the current 20), which is
28.9 GB and was deferred for disk space.

If the panel asks about the weakest part of the project, this is it, and
"the data was too small and the model says so in its own output" is a
stronger answer than avoiding the question.

### Four regions with no model at all

`Spine CT`, `Pelvis & Hip CT`, `Lower Limb CT`, `Shoulder CT` have **no
public labelled 3D data**. They are registered and answer
`NOT_ANALYZED`.

This is a design decision worth defending: an unregistered region gives
a doctor an error, while a registered one that answers NOT_ANALYZED
tells them the AI examined nothing and their own reading is the only
one. Silence and "I did not look" are different messages.

---

## 3. What NOT to study

These are in the repository on purpose — as the evidence that the served
model is the better one — but none of them runs in the application.

| Model | Score | Why it is not served |
|---|---|---|
| `chest_triage_v4` | 0.886 | v2 scores 0.965 |
| `shoulder_triage_v2` | 0.792 | superseded by v4 |
| `shoulder_fracture` | 0.664 | too weak, switched off in code |
| `hand_triage_v1` | 0.849 | superseded by v2 (0.895) |
| `spine_findings` | 0.796 | superseded by v3 |
| `spine_findings_v2` | 0.832 | superseded by v3 |
| `lower_limb_findings` | 0.858 | replaced by `btxrd_lesion_all` |
| `lower_limb_v2` | 0.918 | **see the warning below** |
| `chest_3d_fracture3d` (28³) | 0.724 | superseded by the 64³ version |
| `abdomen_3d_organ3d` | 0.997 | an organ router, not a diagnosis |
| everything in `_experimental/` | — | kept for comparison only |

### The lower_limb_v2 trap

`lower_limb_v2` reads 0.918 and the served model reads 0.891, so it
looks better. **It is not.** The two were measured on different test
splits. Measured on one split, the ranking inverts.

This is the single easiest way to be caught out in a defence: two
numbers from two different test sets are not a comparison. The warning
is written into `scripts/model_report.py` for the same reason.

---

## 4. Still training

Six models are still running and will change these tables:

| Model | Note |
|---|---|
| `abdomen_3d_pancreas_tumour` | 4,496 patches, MSD Task07 |
| `abdomen_3d_hepatic_vessel_tumour` | 4,848 patches, MSD Task08 |
| `abdomen_3d_adrenal3d_64` | 64³, against the 28³ at 0.888 |
| `chest_3d_nodule3d_64` | 64³, against the 28³ at 0.908 |
| `head_3d_vessel3d_64` | 64³, against the 28³ at 0.946 |
| `abdomen_3d_organ3d_64`, `multi_organ_3d_router` | organ routing |

Pancreas CT and Liver Vessels CT are registered and answer
`NOT_ANALYZED` until their models land.

---

## 5. The five things to be able to explain

1. **Why the 3D models were trained from scratch.** No pretrained 3D
   backbone exists. The 2D models fine tune an ImageNet backbone; the 3D
   ones cannot, which is why they need patch extraction and weighted
   loss to work at all.

2. **Patch extraction and splitting by study.** A brain tumour set was
   96% positive, so a model answering "tumour" every time would score
   96%. Cutting patches around the segmentation mask brought it to 49%
   positive and the model reached 0.986. The split is made **by
   study**, never by patch: two patches of the same patient on opposite
   sides of the split is the classic leak, and it inflates every number.

3. **Thresholds are tuned on validation, scored on test.** Tuning and
   scoring on the same split is how a model marks its own homework.

4. **Weighted binary cross-entropy.** Rare findings are given a larger
   share of the loss, otherwise the model ignores them and still scores
   well on accuracy.

5. **Hounsfield windowing, and why MRI is different.** CT has an
   absolute scale, so a window can be fixed per organ and it travels
   with the model in its thresholds file. MRI has no such scale, so each
   volume is stretched between its own extremes instead.
