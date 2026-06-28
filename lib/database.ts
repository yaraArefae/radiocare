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
    success INTEGER NOT NULL DEFAULT 0,
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

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.radiologyDatabase = db;
}
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS patient (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER NOT NULL CHECK(age >= 0 AND age <= 120),
    gender TEXT NOT NULL CHECK(gender IN ('Male', 'Female')),
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
    confidence REAL CHECK(confidence >= 0 AND confidence <= 100),
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