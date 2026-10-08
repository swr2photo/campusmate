const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  "import { useApp } from '../context/AppContext';",
  "import { useApp, useAppProfile, useAppActions } from '../context/AppContext';"
);
fs.writeFileSync(file, c);
