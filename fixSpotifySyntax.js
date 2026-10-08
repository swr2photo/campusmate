const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

// Normalize line endings for replacement
content = content.replace(/\r\n/g, '\n');

const target = `            )}
          </View>
        </Card>

        <Card style={styles.formCard}>
          <SectionToggleHeader`;

const replacement = `            )}
          </View>
        </>) : null}
        </Card>

        <Card style={styles.formCard}>
          <SectionToggleHeader`;

content = content.replace(target, replacement);

fs.writeFileSync(file, content, 'utf8');
console.log('Restored spotify fragment close properly');
