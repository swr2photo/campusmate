const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  "import { getStyles as getDiscoverStyles, ProfileCardView } from './DiscoverProfileScreen';",
  "import * as Discover from './DiscoverProfileScreen';"
);
c = c.replace(
  "getDiscoverStyles(colors, isDark)",
  "Discover.getStyles(colors, isDark)"
);
c = c.replace(
  "<ProfileCardView",
  "<Discover.ProfileCardView"
);
fs.writeFileSync(file, c);
