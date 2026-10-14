import { readFileSync } from 'node:fs';

const code = readFileSync('src/screens/ProfileSetupScreen.js', 'utf8');

const match = code.match(/function getStepError[\s\S]*?^}/m);
if (match) {
  console.log('Found getStepError function:');
  const getStepError = new Function('values', 'stepId', 'STUDENT_ID_REQUIRED_MESSAGE', 'STUDENT_FACULTY_UNAVAILABLE_MESSAGE', 'STUDENT_YEAR_UNAVAILABLE_MESSAGE', `
    ${match[0].slice(match[0].indexOf('{') + 1, match[0].lastIndexOf('}'))}
  `);

  const initialValues = {
    age: '20',
    avatarUri: 'https://example.com/avatar.jpg',
    bio: 'Hello world',
    faculty: 'วิทยาศาสตร์',
    gender: 'male',
    interests: [],
    name: 'Test Student',
    pace: '',
    studentId: '6510110001',
    year: 'ปี 3',
    availabilitySlots: [],
  };

  console.log('Step basic error:', getStepError(initialValues, 'basic', 'err1', 'err2', 'err3'));
  console.log('Step photo error:', getStepError(initialValues, 'photo', 'err1', 'err2', 'err3'));
  console.log('Step interests error (empty):', getStepError(initialValues, 'interests', 'err1', 'err2', 'err3'));

  initialValues.interests = ['running'];
  console.log('Step interests error (running without pace):', getStepError(initialValues, 'interests', 'err1', 'err2', 'err3'));

  initialValues.pace = 'Pace 6:00 - 7:00 นาที/กม.';
  console.log('Step interests error (running with pace):', getStepError(initialValues, 'interests', 'err1', 'err2', 'err3'));
  
  initialValues.interests = ['study'];
  console.log('Step interests error (study):', getStepError(initialValues, 'interests', 'err1', 'err2', 'err3'));
}
