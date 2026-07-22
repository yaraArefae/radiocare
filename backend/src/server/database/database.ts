import { MysqlDialect } from "kysely";
import mysqlCallback from "mysql2";
import mysql from "mysql2/promise";
import { hashPassword } from "better-auth/crypto";
import * as crypto from "node:crypto";

const databaseUrl = new URL(
  process.env.DATABASE_URL ?? "mysql://root@127.0.0.1:3307/radiocare",
);
const databaseName = databaseUrl.pathname.slice(1) || "radiocare";
const connection = {
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username || "root"),
  password: decodeURIComponent(databaseUrl.password),
};

const globalDatabase = globalThis as typeof globalThis & {
  radiocareSqlPool?: mysql.Pool;
  radiocareAuthPool?: mysqlCallback.Pool;
  radiocareDatabaseReady?: Promise<void>; 
};

export const sql = globalDatabase.radiocareSqlPool ?? mysql.createPool({
  ...connection,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "Z",
});

const authPool = globalDatabase.radiocareAuthPool ?? mysqlCallback.createPool({
  ...connection,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "Z",
});

export const authDatabase = {
  dialect: new MysqlDialect({ pool: authPool }),
  type: "mysql" as const,
};

async function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS user (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE, emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT NULL, createdAt DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL,
      role VARCHAR(64) DEFAULT 'patient', banned BOOLEAN DEFAULT FALSE,
      banReason TEXT NULL, banExpires DATETIME(3) NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS session (
      id VARCHAR(64) PRIMARY KEY, expiresAt DATETIME(3) NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE, createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL, ipAddress VARCHAR(255) NULL,
      userAgent TEXT NULL, userId VARCHAR(64) NOT NULL, impersonatedBy VARCHAR(64) NULL,
      INDEX idx_session_user (userId), CONSTRAINT fk_session_user FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS account (
      id VARCHAR(64) PRIMARY KEY, accountId VARCHAR(255) NOT NULL,
      providerId VARCHAR(100) NOT NULL, userId VARCHAR(64) NOT NULL,
      accessToken TEXT NULL, refreshToken TEXT NULL, idToken TEXT NULL,
      accessTokenExpiresAt DATETIME(3) NULL, refreshTokenExpiresAt DATETIME(3) NULL,
      scope TEXT NULL, password TEXT NULL, createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL, INDEX idx_account_user (userId),
      CONSTRAINT fk_account_user FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS verification (
      id VARCHAR(64) PRIMARY KEY, identifier VARCHAR(255) NOT NULL,
      value TEXT NOT NULL, expiresAt DATETIME(3) NOT NULL,
      createdAt DATETIME(3) NULL, updatedAt DATETIME(3) NULL,
      INDEX idx_verification_identifier (identifier)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS login_attempt (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL,
      success BOOLEAN NOT NULL DEFAULT FALSE, ip_address VARCHAR(255) NULL,
      user_agent TEXT NULL, failure_reason TEXT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_login_email (email), INDEX idx_login_created (created_at)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS doctor_application (
      id VARCHAR(64) PRIMARY KEY, full_name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(100) NOT NULL, date_of_birth VARCHAR(20) NOT NULL, national_id VARCHAR(100) NOT NULL UNIQUE,
      specialty VARCHAR(255) NOT NULL, subspecialty VARCHAR(255) NULL, license_number VARCHAR(100) NOT NULL UNIQUE,
      licensing_authority VARCHAR(255) NOT NULL, license_country VARCHAR(100) NULL,
      license_issue_date VARCHAR(20) NOT NULL, license_expiry_date VARCHAR(20) NOT NULL,
      years_of_experience INT NOT NULL DEFAULT 0, current_workplace VARCHAR(255) NOT NULL,
      medical_degree VARCHAR(255) NOT NULL, university VARCHAR(255) NOT NULL, graduation_year INT NOT NULL,
      supported_imaging_types JSON NOT NULL, supported_body_regions JSON NOT NULL,
      id_document_path TEXT NOT NULL, medical_license_path TEXT NOT NULL, specialty_certificate_path TEXT NOT NULL,
      cv_path TEXT NOT NULL, additional_documents JSON NOT NULL, declaration_accepted BOOLEAN NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Pending', admin_notes TEXT NULL, requested_more_info TEXT NULL,
      rejection_reason TEXT NULL, reviewed_by VARCHAR(64) NULL, reviewed_at DATETIME(3) NULL,
      approved_user_id VARCHAR(64) NULL, login_email VARCHAR(255) NULL, must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      temporary_password_issued_at DATETIME(3) NULL, temporary_password_expires_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_doctor_status_created (status, created_at)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS doctor_profile (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL UNIQUE, application_id VARCHAR(64) NULL UNIQUE,
      full_name VARCHAR(255) NOT NULL, phone VARCHAR(100) NOT NULL, specialty VARCHAR(255) NOT NULL,
      subspecialty VARCHAR(255) NULL, license_number VARCHAR(100) NOT NULL UNIQUE,
      licensing_authority VARCHAR(255) NOT NULL, license_expiry_date VARCHAR(20) NOT NULL,
      years_of_experience INT NOT NULL, current_workplace VARCHAR(255) NOT NULL,
      supported_imaging_types JSON NOT NULL, supported_body_regions JSON NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS patient (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, age INT NOT NULL,
      gender VARCHAR(20) NOT NULL, phone VARCHAR(100) NULL, email VARCHAR(255) NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS study (
      id VARCHAR(64) PRIMARY KEY, patient_id VARCHAR(64) NOT NULL, body_region VARCHAR(100) NOT NULL,
      imaging_view VARCHAR(100) NOT NULL, priority VARCHAR(20) NOT NULL, clinical_notes TEXT NULL,
      image_path TEXT NOT NULL, original_file_name VARCHAR(255) NOT NULL, file_type VARCHAR(100) NULL,
      file_size BIGINT NULL, status VARCHAR(30) NOT NULL, uploaded_by VARCHAR(64) NULL,
      clinic_key VARCHAR(20) NOT NULL DEFAULT 'general',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_study_patient (patient_id), INDEX idx_study_clinic (clinic_key), INDEX idx_study_status_created (status, created_at),
      CONSTRAINT fk_study_patient FOREIGN KEY (patient_id) REFERENCES patient(id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_result (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, study_id VARCHAR(64) NOT NULL UNIQUE,
      predicted_finding VARCHAR(255) NULL, confidence DOUBLE NULL, model_name VARCHAR(255) NULL,
      model_version VARCHAR(100) NULL, explanation TEXT NULL, heatmap_path TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS report (
      id VARCHAR(64) PRIMARY KEY, study_id VARCHAR(64) NOT NULL UNIQUE, radiologist_id VARCHAR(64) NULL,
      findings TEXT NULL, impression TEXT NULL, recommendations TEXT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Draft',
      approved_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `ALTER TABLE study ADD COLUMN IF NOT EXISTS clinic_key VARCHAR(20) NOT NULL DEFAULT 'general'`,
    `CREATE TABLE IF NOT EXISTS appointment (
      id VARCHAR(64) PRIMARY KEY, study_id VARCHAR(64) NOT NULL,
      patient_id VARCHAR(64) NOT NULL, doctor_id VARCHAR(64) NOT NULL,
      scheduled_at DATETIME(3) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Scheduled',
      notes TEXT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_appointment_doctor (doctor_id), INDEX idx_appointment_study (study_id),
      CONSTRAINT fk_appointment_study FOREIGN KEY (study_id) REFERENCES study(id),
      CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES patient(id),
      CONSTRAINT fk_appointment_doctor FOREIGN KEY (doctor_id) REFERENCES user(id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS chat_message (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      appointment_id VARCHAR(64) NOT NULL,
      sender_id VARCHAR(64) NOT NULL,
      sender_role VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_chat_appointment (appointment_id),
      CONSTRAINT fk_chat_appointment FOREIGN KEY (appointment_id) REFERENCES appointment(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  ];

  for (const statement of statements) await sql.query(statement);

  const [clinicKeyColumns] = await sql.execute(
    "SHOW COLUMNS FROM study LIKE 'clinic_key'",
  );

  if ((clinicKeyColumns as any[]).length === 0) {
    await sql.execute(
      `ALTER TABLE study ADD COLUMN clinic_key VARCHAR(20) NOT NULL DEFAULT 'general'`,
    );
  }

  const seedUsers = [
    { name: "RadioCare Admin", email: "admin@radiocare.com", role: "admin" },
    { name: "RadioCare Doctor", email: "doctor@radiocare.com", role: "doctor" },
    { name: "RadioCare Patient", email: "patient@radiocare.com", role: "patient" },
  ];
  const password = await hashPassword("RadioCare@2026");

  for (const seed of seedUsers) {
    const [existing] = await sql.execute("SELECT id FROM `user` WHERE email=? LIMIT 1", [seed.email]);
    if ((existing as unknown[]).length > 0) continue;

const userId = crypto.randomUUID();    const now = new Date();
    await sql.execute(
      `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role,banned)
       VALUES (?,?,?,TRUE,?,?,?,FALSE)`,
      [userId, seed.name, seed.email, now, now, seed.role],
    );
    await sql.execute(
      `INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt)
       VALUES (?,?, 'credential', ?,?,?,?)`,
      [crypto.randomUUID(), userId, userId, password, now, now],
    );
  }
}

export const databaseReady =
  globalDatabase.radiocareDatabaseReady ?? initializeDatabase();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.radiocareSqlPool = sql;
  globalDatabase.radiocareAuthPool = authPool;
  globalDatabase.radiocareDatabaseReady = databaseReady;
}

