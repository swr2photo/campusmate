const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  "track.artists?.map(a => a.name).join(', ')",
  "Array.isArray(track.artists) ? track.artists.map(a => a.name).join(', ') : (typeof track.artists === 'string' ? track.artists : (track.artist || 'Unknown'))"
);
fs.writeFileSync(file, c);
