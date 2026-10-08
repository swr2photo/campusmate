import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACULTIES,
  FACULTY_CODE_BY_NAME,
  FACULTY_DIRECTORY,
  getCampusFromStudentId,
  getFacultyCodeFromStudentId,
  getFacultyFromStudentId,
} from './faculties.js';

test('PSU faculties are listed in the supplied 01-12 historical code order', () => {
  assert.deepEqual(
    FACULTY_DIRECTORY.slice(0, 12).map((faculty) => faculty.code),
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  );
  assert.equal(FACULTIES[0], 'คณะวิศวกรรมศาสตร์');
  assert.equal(FACULTIES[11], 'คณะมนุษยศาสตร์และสังคมศาสตร์');
});

test('faculty codes are metadata and do not replace persisted faculty names', () => {
  assert.equal(FACULTY_CODE_BY_NAME['คณะวิศวกรรมศาสตร์'], '01');
  assert.equal(FACULTY_CODE_BY_NAME['คณะมนุษยศาสตร์และสังคมศาสตร์'], '12');
  assert.equal(FACULTY_CODE_BY_NAME['คณะอื่น ๆ'], undefined);
});

test('student ID positions decode the campus and faculty', () => {
  assert.equal(getCampusFromStudentId('6710210317'), 'วิทยาเขตหาดใหญ่');
  assert.equal(getFacultyCodeFromStudentId('6710210317'), '02');
  assert.equal(getFacultyFromStudentId('6710210317'), 'คณะวิทยาศาสตร์');
  assert.equal(getFacultyFromStudentId('6711999999'), '');
});
