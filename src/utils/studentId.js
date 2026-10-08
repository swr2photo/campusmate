import {
  getCampusFromStudentId,
  getFacultyCodeFromStudentId,
  getFacultyFromStudentId,
} from '../data/faculties.js';

export {
  getCampusFromStudentId,
  getFacultyCodeFromStudentId,
  getFacultyFromStudentId,
};

export const STUDENT_ID_LENGTH = 10;
export const STUDENT_ID_PATTERN = /^\d{10}$/;
export const STUDENT_ID_REQUIRED_MESSAGE =
  'อีเมลมหาวิทยาลัยต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th';
export const STUDENT_YEAR_UNAVAILABLE_MESSAGE =
  'ไม่พบข้อมูลชั้นปี กรุณาตรวจสอบอีเมลมหาวิทยาลัย';
export const STUDENT_FACULTY_UNAVAILABLE_MESSAGE =
  'ไม่พบข้อมูลคณะ กรุณาตรวจสอบอีเมลมหาวิทยาลัย';

// The first two digits are the Buddhist academic admission year. During
// academic year 2569, 69 is year 1, 68 is year 2, 67 is year 3, and 66 is
// year 4. Keeping this calculation date-based means next year's cohort rolls
// forward automatically without letting users edit the result themselves.
export function getCurrentAcademicYearCode(date = new Date()) {
  const buddhistYear = date.getFullYear() + 543;
  return buddhistYear % 100;
}

export function normalizeStudentId(value) {
  return String(value || '').trim();
}

export function isValidStudentId(value) {
  return STUDENT_ID_PATTERN.test(normalizeStudentId(value));
}

export function getStudentIdFromEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const [localPart, domain] = normalized.split('@');
  if (domain !== 'psu.ac.th' || !isValidStudentId(localPart)) return '';
  return localPart;
}

export function getStudentIdFromProfile(profile = {}) {
  return getStudentIdFromEmail(profile.campusEmail)
    || getStudentIdFromEmail(profile.email);
}

export function getAcademicYearFromStudentId(studentId, date = new Date()) {
  const normalized = normalizeStudentId(studentId);
  if (!isValidStudentId(normalized)) return '';

  const admissionYearCode = Number(normalized.slice(0, 2));
  const currentYearCode = getCurrentAcademicYearCode(date);
  const yearsSinceAdmission = currentYearCode - admissionYearCode;
  if (yearsSinceAdmission < 0 || yearsSinceAdmission > 3) return '';
  return `ชั้นปีที่ ${yearsSinceAdmission + 1}`;
}

export const ACADEMIC_YEARS = [
  'ชั้นปีที่ 1',
  'ชั้นปีที่ 2',
  'ชั้นปีที่ 3',
  'ชั้นปีที่ 4',
  'ชั้นปีที่ 5',
  'ชั้นปีที่ 6',
  'ปริญญาโท',
  'ปริญญาเอก',
];

export function getStudentAcademicProfile(profile = {}, date = new Date()) {
  const studentId = getStudentIdFromProfile(profile);
  const derivedYear = getAcademicYearFromStudentId(studentId, date);
  const derivedFaculty = getFacultyFromStudentId(studentId);
  return {
    studentId,
    year: profile.year || derivedYear || '',
    faculty: profile.faculty || derivedFaculty || '',
    facultyCode: getFacultyCodeFromStudentId(studentId) || profile.facultyCode || '',
    campus: getCampusFromStudentId(studentId) || profile.campus || '',
  };
}

