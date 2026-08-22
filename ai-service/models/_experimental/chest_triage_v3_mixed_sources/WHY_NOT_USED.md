# Why this model is not served

It was trained on a set balanced by adding 2,690 frontal images marked
"No Finding" from CheXpert to the existing pneumonia set, so that normal
and abnormal images were equal in number.

On its own test set it looked better than the model in use. On the
original test set, the one both models can be compared on, it was worse:

|                        | in use (v2) | this one (v3) |
|------------------------|-------------|---------------|
| ROC AUC                | 0.9653      | 0.9529        |
| normal read correctly  | 73.9%       | 68.4%         |
| abnormal read correctly| 96.7%       | 98.5%         |
| accuracy               | 88.1%       | 87.2%         |

The reason is in how the set was built. The normal images came from
CheXpert and the abnormal ones from the pneumonia set, so the two classes
differed by source as well as by pathology. A model can separate them by
reading the source — the scanner, the processing, the framing — which
costs it nothing during training and fails on a normal chest that came
from the other source. That is what the numbers above show.

Adding data only helps when both classes come from the same place. The
correct next attempt is a set drawn entirely from CheXpert: it holds
16,974 frontal images marked "No Finding" and 123,813 with a finding, so
both classes can come from one source.

Kept for the record, and because its training data is still on disk at
ai-service/data/chest_balanced.
