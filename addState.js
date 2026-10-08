const fs = require('fs');
let c = fs.readFileSync('src/screens/ProfileScreen.js', 'utf8');

c = c.replace(
  /const \[interests, setInterests\] = useState\(\(\) => getInitialInterests\(safeProfile\)\);/,
  `const [interests, setInterests] = useState(() => getInitialInterests(safeProfile));
  const [activityDetails, setActivityDetails] = useState(
    safeProfile.activityDetails && typeof safeProfile.activityDetails === 'object'
      ? safeProfile.activityDetails
      : {}
  );`
);

// Also remove `pace: isRunningSelected && pace !== DEFAULT_PACE ? pace : '',` if it exists since pace is missing
c = c.replace(/pace: isRunningSelected && pace !== DEFAULT_PACE \? pace : '',/, '');

fs.writeFileSync('src/screens/ProfileScreen.js', c);
console.log('Added activityDetails state!');
