# Experimental models

Models that were trained successfully but whose measured quality is not
good enough to show findings to a patient. The regions they belong to
keep sending their images straight to the specialist doctor.

## pelvis_hip_findings

Trained on the pelvis and hip subset of BTXRD: 158 training images, 37
test images. Test results:

| finding          | ROC AUC | precision | recall |
|------------------|---------|-----------|--------|
| bone_lesion      | 0.73    | 0.68      | 0.79   |
| benign_lesion    | 0.71    | 0.50      | 0.69   |
| malignant_lesion | 0.76    | 0.43      | 0.50   |

The precision is too low to be trusted as a preliminary result: it would
raise a false alarm in roughly one of every two flagged cases. More
pelvis images are needed before this model is used.

To activate it anyway:

    mv models/_experimental/pelvis_hip_findings models/pelvis_hip_findings

The AI service picks it up on the next request, without a restart.
