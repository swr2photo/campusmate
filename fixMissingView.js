const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/\r\n/g, '\n');

const target = `          </View>
        </>) : null}
        </Card>

        <Card style={styles.formCard}>
          <SectionToggleHeader`;

const replacement = `          </View>
        </>) : null}
        </View>
        </Card>

        <Card style={styles.formCard}>
          <SectionToggleHeader`;

content = content.replace(target, replacement);
fs.writeFileSync(file, content, 'utf8');
console.log('Added missing </View>');
