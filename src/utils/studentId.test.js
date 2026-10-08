import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAcademicYearFromStudentId,
  getCurrentAcademicYearCode,
  getFacultyFromStudentId,
  getStudentAcademicProfile,
  getStudentIdFromEmail,
  isValidStudentId,
} from './studentId.js';

const currentAcademicDate = new Date(2026, 8, 22);

test('student IDs must be exactly ten digits', () => {
  assert.equal(isValidStudentId('6912345678'), true);
  assert.equal(isValidStudentId('691234567'), false);
  assert.equal(isValidStudentId('69123456789'), false);
  assert.equal(isValidStudentId('69ABC45678'), false);
});

test('student ID is derived from the local part of a PSU email', () => {
  assert.equal(getStudentIdFromEmail('6710210317@psu.ac.th'), '6710210317');
  assert.equal(getStudentIdFromEmail('person@gmail.com'), '');
  assert.equal(getStudentIdFromEmail('student@psu.ac.th'), '');
});

test('current academic year maps 69 to year 1 and 66 to year 4', () => {
  assert.equal(getCurrentAcademicYearCode(currentAcademicDate), 69);
  assert.equal(getAcademicYearFromStudentId('6912345678', currentAcademicDate), 'ชั้นปีที่ 1');
  assert.equal(getAcademicYearFromStudentId('6812345678', currentAcademicDate), 'ชั้นปีที่ 2');
  assert.equal(getAcademicYearFromStudentId('6712345678', currentAcademicDate), 'ชั้นปีที่ 3');
  assert.equal(getAcademicYearFromStudentId('6612345678', currentAcademicDate), 'ชั้นปีที่ 4');
  assert.equal(getAcademicYearFromStudentId('6512345678', currentAcademicDate), '');
});

test('profile identity prefers the campus email and derives the year', () => {
  assert.deepEqual(
    getStudentAcademicProfile({
      email: 'legacy@gmail.com',
      campusEmail: '6810210317@psu.ac.th',
      studentId: '6912345678',
    }, currentAcademicDate),
    {
      studentId: '6810210317',
      year: 'ชั้นปีที่ 2',
      faculty: 'คณะวิทยาศาสตร์',
      facultyCode: '02',
      campus: 'วิทยาเขตหาดใหญ่',
    }
  );
});

test('does not trust a stored student id when the profile has no valid campus email', () => {
  assert.deepEqual(
    getStudentAcademicProfile({ studentId: '6912345678' }, currentAcademicDate),
    {
      studentId: '',
      year: '',
      faculty: '',
      facultyCode: '',
      campus: '',
    }
  );
});

test('persisted faculty and year from initial setup take precedence', () => {
  assert.deepEqual(
    getStudentAcademicProfile({
      email: 'user@psu.ac.th',
      campusEmail: '6810210317@psu.ac.th',
      faculty: 'คณะวิศวกรรมศาสตร์',
      year: 'ชั้นปีที่ 3',
    }, currentAcademicDate),
    {
      studentId: '6810210317',
      year: 'ชั้นปีที่ 3',
      faculty: 'คณะวิศวกรรมศาสตร์',
      facultyCode: '02',
      campus: 'วิทยาเขตหาดใหญ่',
    }
  );
});

test('automatically derives initial faculty and academic year from student email on first setup', () => {
  const profile = { email: '6810210317@psu.ac.th' };
  const academic = getStudentAcademicProfile(profile, currentAcademicDate);

  assert.equal(academic.studentId, '6810210317');
  assert.equal(academic.faculty, 'คณะวิทยาศาสตร์');
  assert.equal(academic.year, 'ชั้นปีที่ 2');
  assert.equal(getFacultyFromStudentId(academic.studentId), 'คณะวิทยาศาสตร์');
  assert.equal(getAcademicYearFromStudentId(academic.studentId, currentAcademicDate), 'ชั้นปีที่ 2');
});

test('leaves faculty and year empty on first setup when email has no student id', () => {
  const profile = { email: 'somchai.s@psu.ac.th' };
  const academic = getStudentAcademicProfile(profile, currentAcademicDate);

  assert.equal(academic.studentId, '');
  assert.equal(academic.faculty, '');
  assert.equal(academic.year, '');
});

