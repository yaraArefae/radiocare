# RadioCare

## متطلبات التشغيل لأول مرة

ثبّت البرامج التالية:

- Node.js 20 أو أحدث
- Python 3.12
- Docker Desktop

بعد فك ضغط المشروع، افتح PowerShell داخل مجلد `GP2` ونفّذ:

```powershell
npm install
py -3.12 -m venv ai-service\.venv
ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
npm run dev:all
```

الأمر الأخير ينشئ ويشغّل MariaDB وphpMyAdmin من `compose.yaml` تلقائيًا، ثم يشغّل Frontend وBackend وخدمة AI.

## روابط المشروع

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- AI service: http://127.0.0.1:8001
- phpMyAdmin: http://localhost:8081

## قاعدة البيانات

Docker ينشئ قاعدة `radiocare` والجداول وحسابات Seed تلقائيًا. بيانات phpMyAdmin:

```text
Username: root
Password: (اتركها فارغة)
Database: radiocare
```

بيانات الاتصال المستخدمة محليًا:

```env
DATABASE_URL=mysql://root@127.0.0.1:3307/radiocare
```

تبقى البيانات محفوظة داخل Docker Volume حتى بعد إيقاف الحاويات. لتشغيل قاعدة البيانات وphpMyAdmin فقط:

```powershell
npm run db:up
```

## حسابات الدخول

كلمة المرور لجميع الحسابات: `RadioCare@2026`

| Role | Email |
|---|---|
| Admin | `admin@radiocare.com` |
| Doctor | `doctor@radiocare.com` |
| Patient | `patient@radiocare.com` |

## بنية المشروع

```text
GP2/
├── frontend/       Next.js UI (port 3000)
├── backend/        API and Better Auth (port 4000)
├── ai-service/     FastAPI AI service (port 8001)
├── scripts/        Unified setup and run scripts
└── compose.yaml    MariaDB and phpMyAdmin
```

## النماذج الحجمية (3D)

كل النماذج السابقة تقرأ صورة أشعة واحدة. النماذج الحجمية تقرأ مقطعية (CT/MRI) كاملة: كومة شرائح تُقرأ ككتلة واحدة، فيظهر فيها ما لا يظهر على شريحة مفردة.

تحضير الداتا ثم التدريب:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\prepare_3d_data.py chest --dataset nodule3d
ai-service\.venv\Scripts\python.exe ai-service\scripts\train_region_3d.py chest --dataset nodule3d
```

الداتاسِتات التي تُنزَّل تلقائيًا (لا تحتاج حسابًا ولا تحميلًا يدويًا، وتتدرّب على المعالج بدون كرت شاشة):

| `--dataset` | المنطقة | ما يقرأه النموذج |
|---|---|---|
| `nodule3d` | `chest` | عقيدة رئوية: حميدة أم خبيثة |
| `fracture3d` | `chest` | نوع كسر الضلع |
| `adrenal3d` | `abdomen` | كتلة في الغدة الكظرية |
| `vessel3d` | `head` | تمدد وعائي في شرايين الدماغ |
| `organ3d` | `abdomen` | تمييز 11 عضوًا (تسمية عضو، وليس تشخيصًا) |

لأي داتا CT حقيقية بصيغة NIfTI، مهما كانت المنطقة، لا حاجة لتعديل الكود؛ يكفي مجلد ملفات و`labels.csv` فيه عمود `volume` وأعمدة النتائج:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\prepare_3d_data.py spine --dataset nifti `
  --source-dir data/spine/sources/verse/volumes `
  --labels-csv data/spine/sources/verse/labels.csv `
  --hu-window -200 1500
```

`--hu-window` هي نافذة الهاونسفيلد التي تُقصّ عليها المقطعية قبل القراءة، تمامًا كما يضبط أخصائي الأشعة النافذة على الشاشة: للرئة والأنسجة الرخوة `-1000 400`، وللعظم `-200 1500`.

لتجربة النماذج على حالات معروفة الإجابة مسبقًا، هذا الأمر يستخرج عيّنات من مجموعة الاختبار (لم يرها النموذج أثناء التدريب) واسم الملف هو التشخيص الحقيقي:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\export_3d_samples.py
```

تُكتب في `ai-service/data/_samples_3d/` بصيغتَي `.npy` و`.nii.gz` معًا.

المقاطع الحجمية لا يفتحها Windows، فهذا الأمر يحوّل كل عيّنة إلى صورة PNG (كل الشرائح في شبكة) وصورة GIF متحركة تُفتحان بدبل كليك:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\preview_3d_samples.py
```

ولمقارنة جواب الـ AI بالتشخيص الحقيقي على كل العيّنات دفعة واحدة، بعد تشغيل خدمة الـ AI:

```powershell
ai-service\.venv\Scripts\python.exe ai-service\scripts\check_3d_samples.py
```

الخدمة تستقبل الدراسات الحجمية على `POST /predict/volume/{region}` (صيغ `.nii` و`.nii.gz` و`.npy`)، و`GET /volumes` يعرض المناطق المتاحة وأيّها لديه نموذج مدرَّب. المنطقة بلا نموذج تُرجع `NOT_ANALYZED` وتذهب مباشرة للطبيب المختص بدل اختراع نتيجة، ووضع النموذج في `ai-service/models/` يُفعّلها بدون تعديل كود.

## ملاحظات

- يجب أن يكون Docker Desktop مفتوحًا قبل `npm run dev:all`.
- أوقف المشروع باستخدام `Ctrl+C` قبل ضغط المجلد.
- لا حاجة لإرسال `node_modules` أو مجلدات `.next` أو `ai-service/.venv`؛ تُعاد إنشاؤها بأوامر التثبيت أعلاه.
- إذا كان أمر `py` غير متوفر استخدم `python` بدل `py -3.12`.
