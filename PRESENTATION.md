# RadioCare — Defense Presentation

Slide-by-slide content and what to say out loud. Every number here was
re-measured on held-out test data; none of it is copied from a training log.

By **Yara Refae** and **Mohammad Maradwe**, supervised by **Alaa Masri** and
**Sameer Arandi** — An-Najah National University.

Target length: 15 minutes of talking, 5 minutes of demo, then questions.

---

## 1. Title

**On the slide:** RadioCare — an X-ray triage system that gives every case a
preliminary AI reading, routes it to the right clinic, and tells the doctor how
much that reading can be trusted.

**Say:** Introduce the two of you and read the one sentence above. Do not
explain anything yet. Decide in advance who presents which half — a natural
split is Yara on the system and the clinical flow (slides 1–6), Mohammad on the
models, the measurements and the failures (slides 7–16), and whoever knows the
screens best driving the demo.

---

## 2. The problem (1 min)

**On the slide:** 6 clinics · 9 models · 3 roles · 28,000+ training images.

**Say:** The bottleneck in radiology is the reading, not the imaging. Every
image sits in one queue and nothing in that queue says which case to open
first. Most AI demos answer "what is in this image". We built the system around
a second question that the first one is useless without: *how much is this
answer worth?*

---

## 3. What the system does (1 min)

**On the slide:** the six-step flow, and the three roles.

**Say:** Walk the flow once, quickly — upload, AI reading, routing, doctor
queue, report, follow-up. Point out that routing is exact: a case is filed to
one clinic, never to a general pile, because a clinic with no owner is a case
nobody is told about.

---

## 4. Architecture (1.5 min)

**On the slide:** frontend → backend API → database, and the AI service beside
it holding the models.

**Say:** Three services. The AI service is deliberately separate and holds no
session and no patient record — it takes an image and returns findings. A model
can be replaced, or fail, without the clinical application going down. Adding a
model file activates a clinic with no code change; that is how the spine clinic
was upgraded twice during development.

---

## 5. The six clinics (1.5 min)

**On the slide:** the clinic table with grades.

| Clinic | Training images | Grade |
|---|---|---|
| Spine | 4,963 | High |
| Hand & Wrist | 14,000 | High |
| Leg & Foot | 2,604 | High |
| Shoulder | 3,551 | Moderate |
| Chest | 624 | Limited |
| Pelvis & Hip | 228 | Limited |

**Say:** The grade in the last column is not written by hand. The service reads
the metrics file the training run produced and grades each clinic on its
*weakest* finding, because a doctor meets the weakest one as often as the best
one. Nobody can promote a clinic by editing a label — you would have to improve
the model.

---

## 6. Principle: the system never invents a finding (1 min)

**Say:** A region with no model returns NOT_ANALYZED and goes straight to the
specialist. The same rule runs one level down: a model can ship with a finding
switched off. The cervical *sigmoid curvature* label measured AUC 0.68 — close
enough to chance that showing it would be noise wearing a percentage sign. It
is disabled, with the measured reason recorded beside it in the thresholds file.

---

## 7. Principle: serving must equal training (1.5 min)

**Say:** A model is only as good as the pixels it is handed. Earlier in the
project a healthy chest reached the network as a near-white rectangle, because
16-bit radiographs were being clipped instead of rescaled. So we stopped
assuming the two paths match and measured it: the spine model was re-scored on
its own 749 test images through both the training pipeline and the live serving
pipeline. The difference was **±0.004 AUC**.

**If asked why that matters:** it is the difference between reporting a model's
laboratory score and reporting what the doctor actually gets.

---

## 8. Case study — Spine (2 min)

**On the slide:** the v1 / v2 / v3 table.

| Measured on the same 749 test images | v1 | v2 | v3 |
|---|---|---|---|
| Curvature AUC | 0.853 | 0.909 | **0.926** |
| Kyphosis precision | 0.47 | 0.70 | **0.74** |
| Kyphosis false alarms | 66 | 19 | **17** |
| Abnormal reaching a doctor | 90.7% | 93.6% | **94.0%** |
| Healthy sent anyway | 44.7% | 40.2% | **36.7%** |

**Say:** The atlas gives every film exactly one curvature grade, and our three
findings are nested inside each other. Version 1 asked them as three
independent yes/no questions — so the model could be certain of two
contradictory shapes at once — and gave the rare kyphotic grade a loss weight of
8.9, which taught it to shout. Version 3 predicts one grade out of four with a
softmax, and a fixed, untrainable layer sums those back into the three findings
the application expects, so the service loads it unchanged.

**The honest half:** version 2 was trained longer, which alone moved AUC from
0.853 to 0.909. The redesign is the last step, not the whole gain.

---

## 9. Case study — Hand & Wrist router (1.5 min)

**Say:** One clinic, two anatomies, and neither model could read the other: the
wrist model found 0% of healthy hands. So a router decides the region first, at
98.2% accuracy. Its two mistakes do not cost the same — a wrist sent to the hand
model loses fractures, while a hand sent to the wrist model raises a false alarm
a doctor dismisses — so the hand path is only taken when the router is clearly
sure, and everything in between is reported as *a hand together with the wrist*.

**The check worth mentioning:** hands arrive as 640×640 exports and wrists at
original size, so a router could score highly by learning the export pipeline
instead of the anatomy. Accuracy was 0.9861 on 640×640 and 0.9805 on every other
size — half a point apart, where a router reading the pipeline would show a
chasm.

---

## 10. Case study — Leg & Foot (1.5 min)

| Leg test split · 372 images | Per-region | All regions |
|---|---|---|
| Bone lesion AUC | 0.880 | **0.897** |
| Malignant AUC | 0.849 | **0.909** |
| Malignant false alarms | 61 | **20** |
| Malignant cases reaching nobody | 4 | **2** |

**Say:** A lesion in a hip looks like a lesion in a femur, so we trained one
lesion model across every region instead of one per region. Read one label at a
time, the new model looks worse on malignant recall. Read as a system, half as
many malignant films end up with no finding at all — because the lesion labels
around it catch what the malignant label drops. Reading a single label in
isolation would have rejected the better model.

---

## 11. Thresholds are clinical decisions (1.5 min)

**Say:** Best-F1 is the wrong objective in a clinic. On the cervical spine it
picked a cut point with 66 false alarms against 58 true ones — F1 was happy to
buy recall with noise. Every threshold is now tuned on the validation split and
measured on test, under a rule stated in advance: a **precision floor** for
findings whose false alarms cost a doctor's time, a **recall floor** for
findings nobody may miss.

**The verification:** raising the kyphosis threshold means that label misses 33
of 77 cases. All 33 are still flagged by the parent curvature label — zero cases
reach nobody. The trade was acceptable because it was measured, not assumed.

---

## 12. What we refuse to claim (1.5 min)

**Say:** The pelvis model trained on the only pelvic images the source holds:
228. Its test split carries six malignant cases. An AUC printed from six cases
is not a measurement, so we bootstrapped it: malignant AUC 0.753, 95% range
**0.475 – 0.971**. That interval contains 0.5 — at this sample size the result
cannot be told apart from a coin toss. The clinic is graded *limited* in the
doctor's interface for exactly that reason.

**Say this before anyone asks it.** Volunteering it is the difference between a
limitation and a hole.

---

## 13. Limitations

Six honest ones, on the slide. The three that get asked about most:

- **36.7% of healthy cervical spines still reach a doctor.** It is a triage
  assistant, not a filter, and it is tuned to fail toward the doctor.
- **Academic data, clinical reality.** Everything is measured on public research
  sets; images from other sources are measurably harder.
- **The region is trusted, not verified,** everywhere except hand and wrist.

---

## 14. Engineering decisions

Five, on the slide. Lead with the two that are hardest to argue with:

- Quality is derived from metrics files, never declared.
- Every split was checked for leakage — and a nine-image contamination between
  two region datasets was found and fixed by splitting once per image rather
  than once per region.

---

## 15–16. Cases, right and wrong (2 min)

**Prepared in** `C:\Users\User\Desktop\demo_cases\` — three healthy and three
diseased cases per clinic, all from held-out test splits, with the service's
answers recorded in `cases.json`.

**Say:** These are not screenshots we liked. The dataset knew the answer before
the model was asked.

Then show the two failures:

- A leg film scored **92.78%** for a malignant lesion against a threshold of
  **92.86%** — missed by 0.08 of a point. The lesion labels beside it fired, so
  the case still reached a doctor.
- A diseased leg film scored 11% and was cleared as normal. Nothing rescued it.
  This is the failure that matters, and it is why the system is a triage
  assistant and not a diagnosis.

---

## 17. Demo (5 min)

Order:

1. Patient uploads a spine X-ray → reading, findings with thresholds, scope note.
2. A healthy film → cleared, filed, no doctor time spent.
3. Doctor opens the clinic → queue, clinic AI grade, case detail.
4. Report and appointment → patient notified.
5. Administrator → accounts, clinic assignment, booked appointments, messages.

**Before you start:** sign in as patient, doctor and administrator in three
browser profiles. Start the AI service and let it finish loading the models —
the first request after boot is slow because nine models load lazily.

---

## 18. Close

**Say:** A medical AI system is trustworthy when it can say how much it should
be trusted — per finding, per clinic, in numbers a doctor can check. Every
clinic here carries its measured grade, every finding carries the threshold it
had to clear, and the claims that could not be defended were switched off rather
than dressed up.

---

# Questions you will be asked

**"Your interface showed 55% suspicion of a malignant lesion and called the case
NORMAL. Why?"**
Because the decision threshold for that finding is 87.5%, chosen on the
validation split to hold precision. A probability is not a diagnosis; the
threshold is where the clinic decided to act. The number is still shown to the
doctor, and the case would have been raised if any label had crossed its own
line.

**"Why does a NORMAL result show 44% confidence?"**
Confidence there is reported as the distance from the strongest finding, so a
finding at 55% leaves 45%. It is a display choice, and a fair criticism: for a
cleared case the more meaningful number is the margin below the threshold.

**"How do you know you have no data leakage?"**
Split membership is checked, not assumed: zero overlap between train,
validation and test in every dataset. We also found a real contamination — nine
images sat in one region's test split and another region's training set — and
fixed it by splitting once per image instead of once per region.

**"How many images did the pelvis model train on?"**
158, from a source that contains only 228 pelvic images in total. That is why it
is graded limited, and why its malignant AUC has a confidence interval that
includes chance.

**"Is this ready for a hospital?"**
No. There has been no reader study against radiologist ground truth on local
films, and every number here is measured on public research data. It is a triage
assistant with a measured reliability grade, presented as such.

**"What happens if the AI service is down?"**
The clinical application keeps working. Studies are created, routed and reviewed
by doctors; the reading is simply reported as not analysed.

**"Why is a finding switched off instead of just having a high threshold?"**
Because no threshold rescues a label that cannot rank cases. Sigmoid curvature
measured AUC 0.68 — the ordering itself is close to random, so any cut point
along it is arbitrary.

**"What would you do with three more months?"**
Region verification across all clinics on the pattern the hand and wrist router
already proves; external pelvic data, which is the one ceiling no recipe change
can lift; and a reader study on local films.
