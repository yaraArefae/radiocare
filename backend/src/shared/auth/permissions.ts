import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
} from "better-auth/plugins/admin/access";

/*
  جميع أنواع الصلاحيات الموجودة في النظام.
*/
const statement = {
  /*
    نحتفظ بصلاحيات Better Auth الأساسية،
    مثل إدارة المستخدمين والجلسات.
  */
  ...defaultStatements,

  study: [
    "create",
    "read",
    "review",
    "approve",
    "delete",
  ],

  report: [
    "create",
    "read",
    "approve",
    "delete",
  ],

  patient: [
    "create",
    "read",
    "update",
    "delete",
  ],

  audit: ["read"],
} as const;

/*
  إنشاء نظام التحكم بالصلاحيات.
*/
export const ac = createAccessControl(statement);

/*
  Admin:
  يمتلك صلاحيات إدارة المستخدمين والجلسات،
  بالإضافة إلى جميع صلاحيات النظام.
*/
export const adminRole = ac.newRole({
  ...adminAc.statements,

  study: [
    "create",
    "read",
    "review",
    "approve",
    "delete",
  ],

  report: [
    "create",
    "read",
    "approve",
    "delete",
  ],

  patient: [
    "create",
    "read",
    "update",
    "delete",
  ],

  audit: ["read"],
});

/*
  Doctor:
  يستطيع قراءة الدراسات ومراجعتها واعتمادها،
  وإنشاء التقارير واعتمادها.
*/
export const doctorRole = ac.newRole({
  study: [
    "read",
    "review",
    "approve",
  ],

  report: [
    "create",
    "read",
    "approve",
  ],

  patient: ["read"],

  audit: [],
});

/*
  Removed legacy role:
  يستطيع إدخال بيانات المرضى ورفع الدراسات،
  لكنه لا يستطيع اعتماد نتائج الأشعة.
*/
/*
  Patient:
  يطّلع على البيانات الخاصة به فقط ويقدر يشوف سجلاته
  ونتائج الفحوصات المرتبطة به.
*/
export const patientRole = ac.newRole({
  study: ["create", "read"],

  report: ["read"],

  patient: ["read", "update"],

  audit: [],
});

/*
  Secretary:
  works for exactly one doctor and manages that doctor's calendar.

  The permissions are deliberately narrow. A secretary books, moves and
  cancels appointments, and to do that they need the patient's name and
  a telephone number, which is what "patient: read" covers. They are
  given nothing on study or report: the X-ray, the AI finding and the
  doctor's written report are the patient's medical record, and booking
  a visit never requires reading one.

  Which doctor they act for is not in this table. It is a row in
  secretary_profile, because a permission says what someone may do and
  this says whose calendar they may do it to.
*/
export const secretaryRole = ac.newRole({
  study: [],

  report: [],

  patient: ["read"],

  audit: [],
});

export const roles = {
  admin: adminRole,
  doctor: doctorRole,
  patient: patientRole,
  secretary: secretaryRole,
};

export type AppRole = keyof typeof roles;
