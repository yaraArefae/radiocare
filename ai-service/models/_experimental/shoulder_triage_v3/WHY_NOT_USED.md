# Superseded by shoulder_triage_v4

Same data, same recipe, a MobileNetV2 backbone instead of an
EfficientNetB0. Measured on the same 762 image test set:

|                       | v3 (this) | v4 (in use) |
|-----------------------|-----------|-------------|
| normal read correctly | 60.5%     | 69.4%       |
| abnormal found        | 76.9%     | 70.7%       |
| false alarms          | 243/615   | 188/615     |
| fractures missed      | 34/147    | 43/147      |
| ROC AUC               | 0.7650    | 0.7766      |

v4 sends 55 fewer healthy shoulders to a doctor and misses 9 more
fractures. It was chosen because a queue that is wrong two times in five
stops being read, and because its ROC AUC is higher, meaning it
separates the two classes better rather than merely sitting at a
different point on the same curve.

Both models remain moderate. A shoulder result assists a doctor; it does
not stand on its own.
