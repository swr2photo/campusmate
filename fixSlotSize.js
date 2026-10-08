const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add screenWidth and slot calculations to ProfileScreen
const hookTarget = `  const isFirstSetup = Boolean(overrideSave);`;
const hookReplacement = `  const isFirstSetup = Boolean(overrideSave);
  const { width: screenWidth } = useWindowDimensions();
  const slotWidth = (screenWidth - 84) / 3;
  const slotHeight = slotWidth * 1.5;`;

content = content.replace(hookTarget, hookReplacement);

// 2. Add slotWidth and slotHeight to photoSlot and photoSlotEmpty styles inline
const photoSlotTarget = `                      <View key={i} style={styles.photoSlot}>`;
const photoSlotReplacement = `                      <View key={i} style={[styles.photoSlot, { width: slotWidth, height: slotHeight }]}>`;
content = content.replace(photoSlotTarget, photoSlotReplacement);

const emptySlotTarget = `                      <Pressable
                        key={i}
                        onPress={pickGalleryImage}
                        style={styles.photoSlotEmpty}
                      >`;
const emptySlotReplacement = `                      <Pressable
                        key={i}
                        onPress={pickGalleryImage}
                        style={[styles.photoSlotEmpty, { width: slotWidth, height: slotHeight }]}
                      >`;
content = content.replace(emptySlotTarget, emptySlotReplacement);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed slot sizing inline');
