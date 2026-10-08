const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  "import { useToast } from '../context/ToastContext';",
  "import { useToast } from '../context/ToastContext';\nimport { getStyles as getDiscoverStyles, ProfileCardView } from './DiscoverProfileScreen';"
);
fs.writeFileSync(file, c);
