import { MysqlDialect } from "kysely";
import mysqlCallback from "mysql2";
import mysql from "mysql2/promise";
import { hashPassword } from "better-auth/crypto";
import * as crypto from "node:crypto";
import {
  CLINIC_KEYS,
  clinicKeysFromProfile,
  replacementClinics,
  resolveClinicKey,
} from "@/server/clinics/clinic-key";

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

/*
  The same problem for indexes: MySQL has no "CREATE INDEX IF NOT
  EXISTS" either, so the index is looked up before it is created.
*/
async function addIndexWhenMissing(
  tableName: string,
  indexName: string,
  columns: string,
) {
  const [rows] = await sql.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
    [indexName],
  );

  if ((rows as unknown[]).length > 0) return;

  await sql.query(
    `CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columns})`,
  );
}

/*
  Moves the records that were written while every bone case shared one
  "bone" clinic over to the clinic of their own body region, and gives
  the doctors approved back then the clinics of their specialty.

  Without this, cases uploaded before the split would stay in a clinic
  that no doctor is a member of any more, so nobody would ever see them.
*/
async function migrateClinicKeys() {
  const [studyRows] = await sql.execute(
    `SELECT id, body_region AS bodyRegion, clinic_key AS clinicKey
     FROM study
     WHERE clinic_key IS NULL OR clinic_key NOT IN (${CLINIC_KEYS.map(
       () => "?",
     ).join(", ")})`,
    CLINIC_KEYS,
  );

  for (const study of studyRows as any[]) {
    const clinicKey = resolveClinicKey(
      study.bodyRegion,
      undefined,
      study.clinicKey,
    );

    await sql.execute("UPDATE study SET clinic_key = ? WHERE id = ?", [
      clinicKey,
      study.id,
    ]);
  }

  if ((studyRows as unknown[]).length > 0) {
    console.log(
      `Moved ${(studyRows as unknown[]).length} case(s) to the clinic of their body region.`,
    );
  }

  const [doctorRows] = await sql.execute(
    `SELECT user_id AS userId, specialty, subspecialty, clinics,
       supported_body_regions AS supportedBodyRegions
     FROM doctor_profile`,
  );

  for (const doctor of doctorRows as any[]) {
    const stored = String(doctor.clinics ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter(Boolean);

    const valid = stored.filter((key: string) =>
      (CLINIC_KEYS as string[]).includes(key),
    );

    /* Nothing to do for a doctor whose clinics all still exist. */
    if (stored.length > 0 && valid.length === stored.length) continue;

    /*
      A retired key such as the old "upper-limb" is replaced by the
      clinics that took its place, so a doctor is never left with fewer
      clinics than they had.
    */
    const replaced = new Set<string>(valid);

    for (const key of stored) {
      if ((CLINIC_KEYS as string[]).includes(key)) continue;

      replacementClinics(key).forEach((clinic) => replaced.add(clinic));
    }

    const clinics =
      replaced.size > 0
        ? [...replaced]
        : clinicKeysFromProfile(
            doctor.specialty,
            doctor.subspecialty,
            doctor.supportedBodyRegions,
          );

    await sql.execute(
      "UPDATE doctor_profile SET clinics = ? WHERE user_id = ?",
      [clinics.join(","), doctor.userId],
    );
  }
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
    /*
      What a patient thought of the doctor who read their study.

      The rating shown on a doctor card is the average of these rows and
      nothing else. A number typed in by an administrator would look the
      same to a patient choosing who to trust with an X-ray, and would
      mean nothing, so there is no column anywhere to type one into.

      One review per study: a patient rates the reading they received,
      not the doctor in general, and cannot rate the same reading twice.
    */
    `CREATE TABLE IF NOT EXISTS doctor_review (
      id VARCHAR(64) PRIMARY KEY, doctor_id VARCHAR(64) NOT NULL,
      patient_id VARCHAR(64) NOT NULL, study_id VARCHAR(64) NOT NULL UNIQUE,
      rating TINYINT NOT NULL, comment TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_review_doctor (doctor_id),
      CONSTRAINT fk_review_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profile(id),
      CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5)
    ) ENGINE=InnoDB`,
    /*
      A secretary, and the one doctor they work for.

      The link is a column rather than a join table because the
      relationship is deliberately one to one: a secretary who could be
      attached to several doctors would be able to move appointments
      between them, and neither doctor would know whose secretary made
      the change.

      user_id is unique for the same reason. Two rows for one login
      would make "which doctor does this person act for" a question with
      two answers, and every appointment they touched ambiguous.
    */
    `CREATE TABLE IF NOT EXISTS secretary_profile (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL UNIQUE,
      doctor_user_id VARCHAR(64) NOT NULL,
      full_name VARCHAR(255) NOT NULL, phone VARCHAR(100) NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Active',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_secretary_doctor (doctor_user_id),
      CONSTRAINT fk_secretary_user FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
      CONSTRAINT fk_secretary_doctor FOREIGN KEY (doctor_user_id) REFERENCES user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    /*
      A secretary applying for a job, before there is an account.

      Secretaries used to appear only when an administrator typed one in,
      which meant the person hired had never sent anything: no papers, no
      qualification, nothing to check. This is the same road a doctor
      takes, cut to what a secretary is actually asked for. There is no
      medical licence here and no specialty, because a secretary does not
      read studies; what is verified is who they are and that they were
      trained for the desk.

      The doctor they end up working for is decided at approval, not
      here. The form never asks: staffing a clinic is not the
      applicant's call, and a field that only ever gets ignored is worse
      than no field at all.
    */
    `CREATE TABLE IF NOT EXISTS secretary_application (
      id VARCHAR(64) PRIMARY KEY, full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE, phone VARCHAR(100) NOT NULL,
      date_of_birth VARCHAR(20) NULL, national_id VARCHAR(100) NOT NULL UNIQUE,
      qualification VARCHAR(255) NOT NULL, institute VARCHAR(255) NOT NULL,
      graduation_year INT NULL, years_of_experience INT NOT NULL DEFAULT 0,
      current_workplace VARCHAR(255) NULL, languages JSON NOT NULL,
      about TEXT NULL,
      id_document_path TEXT NOT NULL, qualification_certificate_path TEXT NOT NULL,
      experience_certificate_path TEXT NULL, cv_path TEXT NULL, photo_path TEXT NULL,
      declaration_accepted BOOLEAN NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Pending', admin_notes TEXT NULL,
      requested_more_info TEXT NULL, rejection_reason TEXT NULL,
      reviewed_by VARCHAR(64) NULL, reviewed_at DATETIME(3) NULL,
      assigned_doctor_user_id VARCHAR(64) NULL, approved_user_id VARCHAR(64) NULL,
      login_email VARCHAR(255) NULL, must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      temporary_password_issued_at DATETIME(3) NULL,
      temporary_password_expires_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_secretary_app_status_created (status, created_at)
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
    `CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      admin_id VARCHAR(64) NULL,
      admin_email VARCHAR(255) NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40) NULL,
      target_id VARCHAR(64) NULL,
      target_label VARCHAR(255) NULL,
      details TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_admin_audit_created (created_at),
      INDEX idx_admin_audit_admin (admin_id, created_at)
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
    /*
      The line between a doctor or a patient and the administration.

      The two chats the application already had hang off something: a
      study or an appointment. This one cannot, because the reasons to
      write to an administrator - a wrong clinic on a profile, an
      account that will not open, a question about a request - exist
      before any case does.

      There is one thread per person, not one per pair of people:
      user_id names whose thread it is and is never an administrator.
      Any administrator can answer in it, because the administration is
      a desk rather than a person, and a doctor waiting on an answer
      should not be waiting on one particular employee.
    */
    `CREATE TABLE IF NOT EXISTS support_message (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      sender_id VARCHAR(64) NOT NULL,
      sender_role VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_support_user (user_id, created_at),
      CONSTRAINT fk_support_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
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
  /*
    The patient's age and gender as they were when this study was taken.

    They used to live only on the patient row, which every upload
    overwrote. A patient who was 66 for one scan and typed 55 for the
    next had both scans reading 55 afterwards, including the one a
    doctor had already reported on. Age at the time of imaging is part
    of the reading, not a current fact about the person: a fracture
    pattern means something different in a child than in an adult.

    The patient row still holds the latest, which is what an address
    book is for. The study holds what was true when it was taken.
  */
  await addColumnWhenMissing("study", "patient_age", "INT NULL");
  await addColumnWhenMissing(
    "study",
    "patient_gender",
    "VARCHAR(20) NULL",
  );

  await addColumnWhenMissing("study", "symptoms", "TEXT NULL");
  await addColumnWhenMissing("study", "medical_history", "TEXT NULL");

  /*
    Whether a study is a single film or a stack of slices.

    A CT cannot be shown in an image tag and is not read the way a
    radiograph is, so the pages that display a study have to know which
    of the two they were handed. Every record written before volumetric
    studies existed is a film, which is what the default says.
  */
  await addColumnWhenMissing(
    "study",
    "study_kind",
    "VARCHAR(20) NOT NULL DEFAULT 'IMAGE'",
  );

  /*
    What a patient needs to choose between two doctors of one clinic.
    None of these are required: a doctor who filled nothing in still
    appears, with their specialty, licence and years of experience,
    which the application has always held.
  */
  /*
    The doctor's own photograph.

    It is stored apart from their licence and identity papers on
    purpose. Those are private and reachable only through a route that
    checks for an administrator; this one is shown to every patient
    browsing a clinic. Keeping them in one place would mean one wrong
    permission check exposes a passport scan.
  */
  await addColumnWhenMissing("doctor_profile", "photo_path", "TEXT NULL");
  await addColumnWhenMissing(
    "doctor_application",
    "photo_path",
    "TEXT NULL",
  );

  /*
    What an approved secretary brought with them from their application.

    A secretary hired before there was an application has none of this,
    so every column is nullable: the older rows stay valid and simply
    have nothing to show.
  */
  await addColumnWhenMissing(
    "secretary_profile",
    "application_id",
    "VARCHAR(64) NULL",
  );
  await addColumnWhenMissing("secretary_profile", "photo_path", "TEXT NULL");
  await addColumnWhenMissing(
    "secretary_profile",
    "national_id",
    "VARCHAR(100) NULL",
  );
  await addColumnWhenMissing(
    "secretary_profile",
    "qualification",
    "VARCHAR(255) NULL",
  );
  await addColumnWhenMissing(
    "secretary_profile",
    "years_of_experience",
    "INT NULL",
  );
  await addColumnWhenMissing("secretary_profile", "languages", "JSON NULL");
  await addIndexWhenMissing(
    "secretary_profile",
    "idx_secretary_application",
    "application_id",
  );

  await addColumnWhenMissing("doctor_profile", "bio", "TEXT NULL");
  await addColumnWhenMissing("doctor_profile", "languages", "JSON NULL");
  await addColumnWhenMissing(
    "doctor_profile",
    "consultation_price",
    "DECIMAL(10,2) NULL",
  );

  /*
    The doctor a study was sent to.

    Until now a study reached a clinic and whoever opened that clinic
    read it. A patient who picked a doctor is owed that doctor, so the
    choice is recorded here. It stays nullable: every study uploaded
    before this existed went to a clinic rather than a person, and a
    patient may still leave the choice to the clinic.
  */
  await addColumnWhenMissing(
    "study",
    "doctor_id",
    "VARCHAR(64) NULL",
  );

  await addIndexWhenMissing("study", "idx_study_doctor", "doctor_id");
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
  /*
    A temporary password handed out by an administrator has to be
    replaced on the first sign in, so the flag lives on the account
    itself and not only on the application record.
  */
  await addColumnWhenMissing(
    "user",
    "mustChangePassword",
    "BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await addColumnWhenMissing(
    "user",
    "passwordExpiresAt",
    "DATETIME(3) NULL",
  );

  await addColumnWhenMissing(
    "doctor_profile",
    "availability",
    "JSON NULL",
  );

  /*
    The clinics a doctor works in, as a comma separated list of clinic
    keys. One doctor can cover several: an orthopedic doctor reads the
    spine, pelvis, upper limb and lower limb clinics. It stays empty
    until an admin assigns it, and the clinics are then read from the
    specialty the doctor registered with.
  */
  await addColumnWhenMissing(
    "doctor_profile",
    "clinics",
    "VARCHAR(255) NULL",
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

  await migrateClinicKeys();

  const seedUsers = [
    { name: "RadioCare Admin", email: "admin@radiocare.com", role: "admin" },
    { name: "RadioCare Patient", email: "patient@radiocare.com", role: "patient" },
    /*
      One doctor per clinic. A clinic without a doctor is a dead end: the
      patient can upload to it, but nobody is ever told about the case.
    */
    { name: "Chest", email: "chest@radiocare.com", role: "doctor" },
    { name: "Shoulder", email: "shoulder@radiocare.com", role: "doctor" },
    { name: "Hand.Wrist", email: "hand.wrist@radiocare.com", role: "doctor" },
    { name: "Spine", email: "spine@radiocare.com", role: "doctor" },
    { name: "Pelvis.Hip", email: "pelvis.hip@radiocare.com", role: "doctor" },
    { name: "Leg.Foot", email: "leg.knee.foot@radiocare.com", role: "doctor" },
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
      email: "chest@radiocare.com",
      fullName: "Chest",
      specialty: "Chest Radiology",
      clinics: "chest",
    },
    {
      email: "shoulder@radiocare.com",
      fullName: "Shoulder",
      specialty: "Shoulder Imaging",
      clinics: "shoulder",
    },
    {
      email: "hand.wrist@radiocare.com",
      fullName: "Hand.Wrist",
      specialty: "Hand & Wrist Imaging",
      clinics: "hand-wrist",
    },
    {
      email: "spine@radiocare.com",
      fullName: "Spine",
      specialty: "Spine Imaging",
      clinics: "spine",
    },
    {
      email: "pelvis.hip@radiocare.com",
      fullName: "Pelvis.Hip",
      specialty: "Pelvis & Hip Imaging",
      clinics: "pelvis",
    },
    {
      email: "leg.knee.foot@radiocare.com",
      /*
        The address is the account's identity and stays as it was, so a
        database seeded before the knee left keeps one doctor for this
        clinic instead of gaining a second one.
      */
      fullName: "Leg.Foot",
      specialty: "Lower Limb Imaging",
      clinics: "lower-limb",
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
      "SELECT id, clinics FROM doctor_profile WHERE user_id = ? LIMIT 1",
      [doctorUserId],
    );

    /*
      A demo profile that exists already is only corrected when it still
      holds the clinics it was seeded with before the split. Clinics an
      administrator chose by hand are never overwritten.
    */
    const existingProfile = (profileRows as any[])[0];

    if (existingProfile) {
      /*
        The values this account was seeded with before every body region
        became its own clinic, including the one the migration above
        rewrites them to. Clinics an administrator chose are not in this
        list and are therefore never overwritten.
      */
      const legacyClinics = [
        "spine,pelvis,upper-limb,lower-limb",
        "spine,pelvis,lower-limb,shoulder,hand-wrist",
        "",
        null,
      ];

      if (legacyClinics.includes(existingProfile.clinics)) {
        await sql.execute(
          `UPDATE doctor_profile
           SET clinics = ?, full_name = ?, specialty = ?
           WHERE user_id = ?`,
          [
            demoDoctor.clinics,
            demoDoctor.fullName,
            demoDoctor.specialty,
            doctorUserId,
          ],
        );
      }

      continue;
    }

    await sql.execute(
      `INSERT INTO doctor_profile
       (id, user_id, full_name, phone, specialty, subspecialty,
        license_number, licensing_authority, license_expiry_date,
        years_of_experience, current_workplace,
        supported_imaging_types, supported_body_regions, clinics, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Active')`,
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
        demoDoctor.clinics,
      ],
    );
  }

  await warnAboutEmptyClinics();
}

/*
  Points out any clinic that has no active doctor. A patient can upload
  to every clinic, so one without a doctor accepts cases that nobody is
  ever notified about.
*/
async function warnAboutEmptyClinics() {
  const [doctorRows] = await sql.execute(
    `SELECT specialty, subspecialty, clinics,
       supported_body_regions AS supportedBodyRegions
     FROM doctor_profile
     WHERE status = 'Active'`,
  );

  const covered = new Set<string>();

  for (const doctor of doctorRows as any[]) {
    const assigned = String(doctor.clinics ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const clinics =
      assigned.length > 0
        ? assigned
        : clinicKeysFromProfile(
            doctor.specialty,
            doctor.subspecialty,
            doctor.supportedBodyRegions,
          );

    clinics.forEach((clinic) => covered.add(clinic));
  }

  const empty = CLINIC_KEYS.filter(
    (key) => key !== "general" && !covered.has(key),
  );

  if (empty.length > 0) {
    console.warn(
      `Clinics with no active doctor: ${empty.join(", ")}. Cases sent there will wait until a doctor is assigned to them.`,
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

