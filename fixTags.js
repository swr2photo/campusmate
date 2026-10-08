const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

const targetLogic = `  const activityDisplay = getActivityLabel(
    Array.isArray(activities) ? activities?.join(', ') : '',
    '',
    activities
  );
  const activityDetailRows = describeActivityDetails(activityDetails, activities);`;

const replacementLogic = `  const activityDisplay = getActivityLabel(
    Array.isArray(activities) ? activities?.join(', ') : '',
    '',
    activities
  );
  const activityDetailRows = describeActivityDetails(activityDetails, activities);

  const activityTags = React.useMemo(() => {
    const tags = [];
    if (activityDisplay) {
      tags.push(...activityDisplay.split(',').map(s => s.trim()).filter(Boolean));
    }
    if (Array.isArray(activityDetailRows)) {
      activityDetailRows.forEach(row => {
        if (!tags.includes(row.label)) tags.push(row.label);
        if (Array.isArray(row.lines)) {
          row.lines.forEach(line => {
            if (!tags.includes(line)) tags.push(line);
          });
        }
      });
    }
    if (skill && !tags.includes(skill)) tags.push(\`ระดับ: \${skill}\`);
    return Array.from(new Set(tags));
  }, [activityDisplay, activityDetailRows, skill]);`;

content = content.replace(targetLogic, replacementLogic);

const renderTarget = `        {/* Activities as tags */}
        {Array.isArray(activities) && activities.length > 0 ? (
          <View style={{ marginTop: 8, marginBottom: 12 }}>
            <Text style={{ color: colors.inkSoft, fontSize: 13, fontWeight: '800', marginBottom: 8 }}>กิจกรรมที่ชอบ</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {activities.map((tag, idx) => (
                <View key={idx} style={{ backgroundColor: colors.surfaceRaised || '#f0f0f0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}`;

const renderReplacement = `        {/* Activities as tags */}
        {activityTags.length > 0 ? (
          <View style={{ marginTop: 8, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <FeatureIcon name="figure.run" size={16} color={colors.inkSoft || '#60708A'} />
              <Text style={{ color: colors.inkSoft || '#60708A', fontSize: 13, fontWeight: '800' }}>กิจกรรมที่ชอบ</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {activityTags.map((tag, idx) => (
                <View key={idx} style={{ backgroundColor: colors.surfaceRaised || '#f0f0f0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}`;

content = content.replace(renderTarget, renderReplacement);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed tags rendering in ProfilePreview');
