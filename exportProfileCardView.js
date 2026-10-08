const fs = require('fs');
const file = 'src/screens/DiscoverProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace('function ProfileCardView({', 'export function ProfileCardView({');

fs.writeFileSync(file, content, 'utf8');
console.log('Exported ProfileCardView');
