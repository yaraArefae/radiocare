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
  Radiologist:
  يستطيع قراءة الدراسات ومراجعتها واعتمادها،
  وإنشاء التقارير واعتمادها.
*/
export const radiologistRole = ac.newRole({
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
  Technician:
  يستطيع إدخال بيانات المرضى ورفع الدراسات،
  لكنه لا يستطيع اعتماد نتائج الأشعة.
*/
export const technicianRole = ac.newRole({
  study: [
    "create",
    "read",
  ],

  report: ["read"],

  patient: [
    "create",
    "read",
    "update",
  ],

  audit: [],
});

/*
  Patient:
  يطّلع على البيانات الخاصة به فقط ويقدر يشوف سجلاته
  ونتائج الفحوصات المرتبطة به.
*/
export const patientRole = ac.newRole({
  study: ["read"],

  report: ["read"],

  patient: ["read", "update"],

  audit: [],
});

export const roles = {
  admin: adminRole,
  doctor: radiologistRole,
  radiologist: radiologistRole,
  technician: technicianRole,
  patient: patientRole,
};

export type AppRole = keyof typeof roles;
