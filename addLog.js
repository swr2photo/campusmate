const fs = require('fs');
let content = fs.readFileSync('src/screens/ProfileScreen.js', 'utf8');
content = content.replace(
  /\} catch \(error\) \{\s+if \(error\.isModerationViolation/,
  `} catch (error) {\n      console.error('[ProfileScreen handleSave error]', error?.message || error, error?.code, error?.stack);\n      if (error.isModerationViolation`
);
fs.writeFileSync('src/screens/ProfileScreen.js', content, 'utf8');
console.log('Added log:', content.includes('[ProfileScreen handleSave error]'));
