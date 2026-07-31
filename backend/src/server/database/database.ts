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

/*
  MySQL does not support "ADD COLUMN IF NOT EXISTS", so we look the
  column up first and only run the ALTER statement when it is missing.
*/
async function addColumnWhenMissing(
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const [columns] = await sql.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName],
  );

  if ((columns as unknown[]).length > 0) return;

  await sql.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`,
  );
}

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
      symptoms TEXT NULL, medical_history TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS patient_application (
      id VARCHAR(64) PRIMARY KEY, full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE, phone VARCHAR(100) NULL,
      age INT NOT NULL, gender VARCHAR(20) NOT NULL,
      national_id VARCHAR(100) NULL, symptoms TEXT NULL, medical_history TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Pending', admin_notes TEXT NULL,
      rejection_reason TEXT NULL, reviewed_by VARCHAR(64) NULL, reviewed_at DATETIME(3) NULL,
      approved_user_id VARCHAR(64) NULL, login_email VARCHAR(255) NULL,
      temporary_password_issued_at DATETIME(3) NULL, temporary_password_expires_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_patient_application_status (status, created_at)
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
      ai_agreement VARCHAR(30) NULL, final_finding VARCHAR(255) NULL,
      severity VARCHAR(30) NULL, follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
      additional_tests TEXT NULL, doctor_notes TEXT NULL,
      approved_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `ALTER TABLE study ADD COLUMN IF NOT EXISTS clinic_key VARCHAR(20) NOT NULL DEFAULT 'general'`,
    `CREATE TABLE IF NOT EXISTS appointment (
      id VARCHAR(64) PRIMARY KEY, study_id VARCHAR(64) NOT NULL,
      patient_id VARCHAR(64) NOT NULL, doctor_id VARCHAR(64) NOT NULL,
      scheduled_at DATETIME(3) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      notes TEXT NULL, duration_minutes INT NOT NULL DEFAULT 30,
      patient_response_note TEXT NULL, patient_responded_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_appointment_doctor (doctor_id), INDEX idx_appointment_study (study_id),
      INDEX idx_appointment_patient_time (patient_id, scheduled_at),
      CONSTRAINT fk_appointment_study FOREIGN KEY (study_id) REFERENCES study(id),
      CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES patient(id),
      CONSTRAINT fk_appointment_doctor FOREIGN KEY (doctor_id) REFERENCES user(id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS case_message (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      study_id VARCHAR(64) NOT NULL,
      sender_id VARCHAR(64) NOT NULL,
      sender_role VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_case_message_study (study_id, created_at),
      CONSTRAINT fk_case_message_study FOREIGN KEY (study_id) REFERENCES study(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS notification (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      user_role VARCHAR(30) NOT NULL DEFAULT 'patient',
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NULL,
      link VARCHAR(255) NULL,
      appointment_id VARCHAR(64) NULL,
      study_id VARCHAR(64) NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_notification_user (user_id, is_read, created_at),
      CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
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

  /*
    Older databases already have an appointment table without the
    calendar columns, so we add them one by one when they are missing.
  */
  await addColumnWhenMissing(
    "appointment",
    "duration_minutes",
    "INT NOT NULL DEFAULT 30",
  );

  /*
    Clinical intake written by the patient, and the fields the doctor
    fills when they take the final decision on a study.
  */
  await addColumnWhenMissing("patient", "symptoms", "TEXT NULL");
  await addColumnWhenMissing("patient", "medical_history", "TEXT NULL");
  await addColumnWhenMissing("study", "symptoms", "TEXT NULL");
  await addColumnWhenMissing("study", "medical_history", "TEXT NULL");
  await addColumnWhenMissing("report", "ai_agreement", "VARCHAR(30) NULL");
  await addColumnWhenMissing("report", "final_finding", "VARCHAR(255) NULL");
  await addColumnWhenMissing("report", "severity", "VARCHAR(30) NULL");
  await addColumnWhenMissing(
    "report",
    "follow_up_required",
    "BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await addColumnWhenMissing("report", "additional_tests", "TEXT NULL");
  await addColumnWhenMissing("report", "doctor_notes", "TEXT NULL");
  await addColumnWhenMissing(
    "doctor_profile",
    "availability",
    "JSON NULL",
  );
  await addColumnWhenMissing(
    "appointment",
    "patient_response_note",
    "TEXT NULL",
  );
  await addColumnWhenMissing(
    "appointment",
    "patient_responded_at",
    "DATETIME(3) NULL",
  );

  /*
    The old flow created appointments as "Scheduled" without asking the
    patient. They now start as "Pending" until the patient approves them.
  */
  await sql.query(
    "ALTER TABLE appointment ALTER COLUMN status SET DEFAULT 'Pending'",
  );

  await sql.execute(
    "UPDATE appointment SET status = 'Pending' WHERE status = 'Scheduled'",
  );

  const seedUsers = [
    { name: "RadioCare Admin", email: "admin@radiocare.com", role: "admin" },
    { name: "RadioCare Doctor", email: "doctor@radiocare.com", role: "doctor" },
    /*
      A second demo doctor covers the orthopedic clinic. Without one, any
      bone, hand, wrist, or limb case has no doctor to reach.
    */
    {
      name: "RadioCare Orthopedic Doctor",
      email: "doctor.ortho@radiocare.com",
      role: "doctor",
    },
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

  /*
    A doctor account without a doctor_profile cannot open any clinic
    screen: the review queue, the calendar, and the case messages all
    look the doctor up by their specialty. The demo doctor therefore
    also gets a profile, so the account works right after the seed.
  */
  const demoDoctorProfiles = [
    {
      email: "doctor@radiocare.com",
      fullName: "RadioCare Chest Doctor",
      specialty: "Chest Radiology",
    },
    {
      email: "doctor.ortho@radiocare.com",
      fullName: "RadioCare Orthopedic Doctor",
      specialty: "Orthopedics / Bone Imaging",
    },
  ];

  for (const demoDoctor of demoDoctorProfiles) {
    const [userRows] = await sql.execute(
      "SELECT id FROM `user` WHERE email = ? LIMIT 1",
      [demoDoctor.email],
    );

    const doctorUserId = (userRows as { id: string }[])[0]?.id;

    if (!doctorUserId) continue;

    const [profileRows] = await sql.execute(
      "SELECT id FROM doctor_profile WHERE user_id = ? LIMIT 1",
      [doctorUserId],
    );

    if ((profileRows as unknown[]).length > 0) continue;

    await sql.execute(
      `INSERT INTO doctor_profile
       (id, user_id, full_name, phone, specialty, subspecialty,
        license_number, licensing_authority, license_expiry_date,
        years_of_experience, current_workplace,
        supported_imaging_types, supported_body_regions, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'Active')`,
      [
        `DOC-${crypto.randomUUID()}`,
        doctorUserId,
        demoDoctor.fullName,
        "0000000000",
        demoDoctor.specialty,
        null,
        `LIC-DEMO-${doctorUserId.slice(0, 8)}`,
        "RadioCare Demo Authority",
        "2030-01-01",
        5,
        "RadioCare Clinic",
        JSON.stringify([]),
        JSON.stringify([]),
      ],
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

