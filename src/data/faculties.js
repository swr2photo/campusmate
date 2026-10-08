// PSU faculty codes are assigned in the historical order supplied by the
// university context. Keep the code separate from the persisted display name
// so existing profiles and matching filters remain backward compatible.
export const FACULTY_DIRECTORY = [
  {
    code: '01',
    name: 'คณะวิศวกรรมศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2510,
  },
  {
    code: '02',
    name: 'คณะวิทยาศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2510,
  },
  {
    code: '03',
    name: 'คณะศึกษาศาสตร์',
    campus: 'ปัตตานี',
    establishedYear: 2511,
  },
  {
    code: '04',
    name: 'คณะแพทยศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2515,
  },
  {
    code: '05',
    name: 'คณะพยาบาลศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2515,
  },
  {
    code: '06',
    name: 'คณะวิทยาการจัดการ',
    campus: 'หาดใหญ่',
    establishedYear: 2518,
  },
  {
    code: '07',
    name: 'คณะทรัพยากรธรรมชาติ',
    campus: 'หาดใหญ่',
    establishedYear: 2518,
  },
  {
    code: '08',
    name: 'คณะทันตแพทยศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2526,
  },
  {
    code: '09',
    name: 'คณะเภสัชศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2528,
  },
  {
    code: '10',
    name: 'คณะอุตสาหกรรมเกษตร',
    campus: 'หาดใหญ่',
    establishedYear: 2529,
  },
  {
    code: '11',
    name: 'คณะศิลปศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: 2531,
  },
  {
    code: '12',
    name: 'คณะมนุษยศาสตร์และสังคมศาสตร์',
    campus: 'ปัตตานี',
    establishedYear: 2517,
  },
  // These existing choices are kept after the supplied 01–12 directory until
  // their official PSU faculty codes are confirmed.
  {
    code: null,
    name: 'คณะเทคนิคการแพทย์',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะการแพทย์แผนไทย',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะสัตวแพทยศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะการจัดการสิ่งแวดล้อม',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะนิติศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะเศรษฐศาสตร์',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะการสื่อสารมวลชน',
    campus: 'หาดใหญ่',
    establishedYear: null,
  },
  {
    code: null,
    name: 'คณะอื่น ๆ',
    campus: null,
    establishedYear: null,
  },
];

export const FACULTIES = FACULTY_DIRECTORY.map((faculty) => faculty.name);

export const FACULTY_CODE_BY_NAME = Object.fromEntries(
  FACULTY_DIRECTORY
    .filter((faculty) => faculty.code)
    .map((faculty) => [faculty.name, faculty.code])
);

export const FACULTY_BY_CODE = Object.fromEntries(
  FACULTY_DIRECTORY
    .filter((faculty) => faculty.code)
    .map((faculty) => [faculty.code, faculty])
);

export const PSU_CAMPUS_BY_CODE = {
  '1': 'วิทยาเขตหาดใหญ่',
  '2': 'วิทยาเขตปัตตานี',
  '3': 'วิทยาเขตภูเก็ต',
  '4': 'วิทยาเขตสุราษฎร์ธานี',
  '5': 'วิทยาเขตตรัง',
};

export function getFacultyFromStudentId(studentId) {
  const normalized = String(studentId || '').trim();
  if (!/^\d{10}$/.test(normalized)) return '';
  return FACULTY_BY_CODE[normalized.slice(3, 5)]?.name || '';
}

export function getFacultyCodeFromStudentId(studentId) {
  const normalized = String(studentId || '').trim();
  if (!/^\d{10}$/.test(normalized)) return '';
  return normalized.slice(3, 5).match(/^\d{2}$/)?.[0] || '';
}

export function getCampusFromStudentId(studentId) {
  const normalized = String(studentId || '').trim();
  if (!/^\d{10}$/.test(normalized)) return '';
  return PSU_CAMPUS_BY_CODE[normalized.slice(2, 3)] || '';
}

export const FACULTIES_BY_GROUP = [
  {
    group: 'เรียงตามรหัสคณะและลำดับการก่อตั้ง',
    faculties: FACULTIES,
  },
];
