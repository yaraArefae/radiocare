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