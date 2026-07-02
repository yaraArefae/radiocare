import Database from "better-sqlite3";

type SQLiteDatabase = InstanceType<typeof Database>;

const globalForDatabase = globalThis as unknown as {
  radiologyDatabase?: SQLiteDatabase;
};

export const db =
  globalForDatabase.radiologyDatabase ??
  new Database(
    process.env.AUTH_DATABASE_PATH || "radiology-auth.db"
  );

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/*
  جدول لتسجيل محاولات الدخول الناجحة والفاشلة.
  لا يتم حفظ كلمة المرور داخل هذا الجدول.
*/
db.exec(`
  CREATE TABLE IF NOT EXISTS login_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0
      CHECK(success IN (0, 1)),
    ip_address TEXT,
    user_agent TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_login_attempt_email
  ON login_attempt(email);

  CREATE INDEX IF NOT EXISTS idx_login_attempt_created_at
  ON login_attempt(created_at);
`);

/*
  طلبات انضمام الأطباء.

  ملاحظة أمنية:
  لا نخزن كلمة المرور المؤقتة هنا كنص صريح.
  عند موافقة الأدمن، ننشئ الحساب بواسطة Better Auth
  ثم نخزن approved_user_id و login_email فقط.
*/
db.exec(`
  CREATE TABLE IF NOT EXISTS doctor_application (
    id TEXT PRIMARY KEY,

    full_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    national_id TEXT NOT NULL UNIQUE,

    specialty TEXT NOT NULL,
    subspecialty TEXT,

    license_number TEXT NOT NULL UNIQUE,
    licensing_authority TEXT NOT NULL,
    license_country TEXT,
    license_issue_date TEXT NOT NULL,
    license_expiry_date TEXT NOT NULL,

    years_of_experience INTEGER NOT NULL DEFAULT 0
      CHECK(years_of_experience >= 0 AND years_of_experience <= 80),

    current_workplace TEXT NOT NULL,
    medical_degree TEXT NOT NULL,
    university TEXT NOT NULL,

    graduation_year INTEGER NOT NULL
      CHECK(graduation_year >= 1950 AND graduation_year <= 2100),

    /*
      نخزن القيم المتعددة بصيغة JSON، مثل:
      ["X-ray", "CT", "MRI"]
      ["Chest", "Brain", "Bone"]
    */
    supported_imaging_types TEXT NOT NULL DEFAULT '[]',
    supported_body_regions TEXT NOT NULL DEFAULT '[]',

    id_document_path TEXT NOT NULL,
    medical_license_path TEXT NOT NULL,
    specialty_certificate_path TEXT NOT NULL,
    cv_path TEXT NOT NULL,
    additional_documents TEXT NOT NULL DEFAULT '[]',

    declaration_accepted INTEGER NOT NULL DEFAULT 0
      CHECK(declaration_accepted IN (0, 1)),

    status TEXT NOT NULL DEFAULT 'Pending'
      CHECK(
        status IN (
          'Pending',
          'Under Review',
          'Needs More Information',
          'Approved',
          'Rejected',
          'Suspended'
        )
      ),

    admin_notes TEXT,
    requested_more_info TEXT,
    rejection_reason TEXT,

    reviewed_by TEXT,
    reviewed_at TEXT,

    /*
      يتم تعبئة هذه الحقول بعد الموافقة وإنشاء حساب الطبيب.
    */
    approved_user_id TEXT,
    login_email TEXT COLLATE NOCASE,
    must_change_password INTEGER NOT NULL DEFAULT 1
      CHECK(must_change_password IN (0, 1)),

    temporary_password_issued_at TEXT,
    temporary_password_expires_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_doctor_application_status
  ON doctor_application(status);

  CREATE INDEX IF NOT EXISTS idx_doctor_application_created_at
  ON doctor_application(created_at);

  CREATE INDEX IF NOT EXISTS idx_doctor_application_specialty
  ON doctor_application(specialty);

  CREATE INDEX IF NOT EXISTS idx_doctor_application_email
  ON doctor_application(email);

  CREATE INDEX IF NOT EXISTS idx_doctor_application_license
  ON doctor_application(license_number);
`);


/*
  ترقية قواعد البيانات الموجودة مسبقًا.
  CREATE TABLE IF NOT EXISTS لا يضيف أعمدة جديدة إلى جدول قائم،
  لذلك نتحقق من الأعمدة ونضيفها عند الحاجة.
*/
function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string
) {
  const columns = db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all() as Array<{ name: string }>;

  const exists = columns.some(
    (column) => column.name === columnName
  );

  if (!exists) {
    db.exec(
      `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`
    );
  }
}

ensureColumn(
  "doctor_application",
  "temporary_password_issued_at",
  "TEXT"
);

ensureColumn(
  "doctor_application",
  "temporary_password_expires_at",
  "TEXT"
);

/*
  الملف المهني للطبيب بعد قبول طلبه.
  يتم إنشاء سجل هنا عند موافقة الأدمن.
*/
db.exec(`
  CREATE TABLE IF NOT EXISTS doctor_profile (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    application_id TEXT UNIQUE,

    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,

    specialty TEXT NOT NULL,
    subspecialty TEXT,

    license_number TEXT NOT NULL UNIQUE,
    licensing_authority TEXT NOT NULL,
    license_expiry_date TEXT NOT NULL,

    years_of_experience INTEGER NOT NULL DEFAULT 0
      CHECK(years_of_experience >= 0 AND years_of_experience <= 80),

    current_workplace TEXT NOT NULL,

    supported_imaging_types TEXT NOT NULL DEFAULT '[]',
    supported_body_regions TEXT NOT NULL DEFAULT '[]',

    status TEXT NOT NULL DEFAULT 'Active'
      CHECK(status IN ('Active', 'Suspended', 'Inactive')),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (application_id)
      REFERENCES doctor_application(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_doctor_profile_specialty
  ON doctor_profile(specialty);

  CREATE INDEX IF NOT EXISTS idx_doctor_profile_status
  ON doctor_profile(status);
`);

/*
  بيانات المرضى والدراسات ونتائج الذكاء الاصطناعي والتقارير.
*/
db.exec(`
  CREATE TABLE IF NOT EXISTS patient (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER NOT NULL
      CHECK(age >= 0 AND age <= 120),
    gender TEXT NOT NULL
      CHECK(gender IN ('Male', 'Female')),
    phone TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'Active'
      CHECK(status IN ('Active', 'Follow-up', 'Inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS study (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    body_region TEXT NOT NULL,
    imaging_view TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'Normal'
      CHECK(priority IN ('Normal', 'Urgent')),
    clinical_notes TEXT,
    image_path TEXT NOT NULL,
    original_file_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    status TEXT NOT NULL DEFAULT 'Waiting'
      CHECK(status IN ('Waiting', 'Urgent', 'Reviewed', 'Approved')),
    uploaded_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id)
      REFERENCES patient(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS ai_result (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id TEXT NOT NULL UNIQUE,
    predicted_finding TEXT,
    confidence REAL
      CHECK(confidence >= 0 AND confidence <= 100),
    model_name TEXT,
    model_version TEXT,
    explanation TEXT,
    heatmap_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (study_id)
      REFERENCES study(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS report (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL UNIQUE,
    radiologist_id TEXT,
    findings TEXT,
    impression TEXT,
    recommendations TEXT,
    status TEXT NOT NULL DEFAULT 'Draft'
      CHECK(status IN ('Draft', 'Ready', 'Approved')),
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (study_id)
      REFERENCES study(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_study_patient
  ON study(patient_id);

  CREATE INDEX IF NOT EXISTS idx_study_status
  ON study(status);

  CREATE INDEX IF NOT EXISTS idx_study_created_at
  ON study(created_at);

  CREATE INDEX IF NOT EXISTS idx_report_status
  ON report(status);
`);

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.radiologyDatabase = db;
}
