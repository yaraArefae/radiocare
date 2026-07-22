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

## ملاحظات

- يجب أن يكون Docker Desktop مفتوحًا قبل `npm run dev:all`.
- أوقف المشروع باستخدام `Ctrl+C` قبل ضغط المجلد.
- لا حاجة لإرسال `node_modules` أو مجلدات `.next` أو `ai-service/.venv`؛ تُعاد إنشاؤها بأوامر التثبيت أعلاه.
- إذا كان أمر `py` غير متوفر استخدم `python` بدل `py -3.12`.
