const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add missing imports
const newImports = `
import { Dimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { formatAvailabilitySlots } from '../utils/formatters';
import { describeActivityDetails, getActivityLabel } from '../utils/activityConfig';
import { useRemoteImage } from '../utils/useRemoteImage';
import { getDisplayImageUri } from '../utils/imageHelpers';
`;

content = content.replace(
  "import { useSafeAreaInsets } from 'react-native-safe-area-context';",
  `${newImports}\nimport { useSafeAreaInsets } from 'react-native-safe-area-context';`
);

// 2. Remove requires from ProfilePreview and update Image to ExpoImage
const oldRequires = `  const { formatAvailabilitySlots } = require('../utils/formatters');
  const { describeActivityDetails, getActivityLabel } = require('../utils/activityConfig');
  const { useRemoteImage } = require('../utils/useRemoteImage');
  const { getDisplayImageUri } = require('../utils/imageHelpers');
  const { Image } = require('expo-image');
  const { LinearGradient } = require('expo-linear-gradient');`;

content = content.replace(oldRequires, '');
content = content.replace(/<Image\n/g, '<ExpoImage\n');
content = content.replace(/<\/Image>/g, '</ExpoImage>');

// Also update the single-line Image tags in ProfilePreview to ExpoImage
content = content.replace(
  /<Image source=\{\{ uri \}\}/g,
  '<ExpoImage source={{ uri }}'
);
content = content.replace(
  /<Image source=\{\{ uri: track\.albumArt \}\}/g,
  '<ExpoImage source={{ uri: track.albumArt }}'
);

fs.writeFileSync(file, content, 'utf8');
