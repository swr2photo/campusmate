const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove the prepended ProfilePreview
const topPreviewStart = 'function ProfilePreview({';
const firstImport = "import { useToast } from '../context/ToastContext';";
const firstImportIndex = content.indexOf(firstImport);
content = content.substring(firstImportIndex); // Keeps everything from the first import onwards

// 2. Find the correct ProfilePreview and replace it
const actualPreviewStart = 'function ProfilePreview({';
const actualPreviewEndMarker = '  // One block per selected activity';
const previewStartIndex = content.indexOf(actualPreviewStart);
const previewEndIndex = content.indexOf(actualPreviewEndMarker);

const newPreview = `function ProfilePreview({ avatarUri, gallery, name, age, gender, faculty, year, bio, activities, activityDetails, skill, availabilitySlots, availability, favoriteTracks, colors, styles }) {
  const { isDark } = useTheme();
  const discoverStyles = React.useMemo(() => getDiscoverStyles(colors, isDark), [colors, isDark]);
  const insets = useSafeAreaInsets();
  const { profile: myProfile } = useAppProfile();
  const { getMeetupStats } = useAppActions();

  const candidate = React.useMemo(() => {
    return {
      id: myProfile?.id || 'preview',
      avatarUri,
      gallery,
      name,
      age,
      gender,
      faculty,
      year,
      bio,
      activities, 
      activityDetails,
      skill,
      availabilitySlots,
      availability,
      favoriteTracks,
    };
  }, [avatarUri, gallery, name, age, gender, faculty, year, bio, activities, activityDetails, skill, availabilitySlots, availability, favoriteTracks, myProfile]);

  return (
    <View style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 16, backgroundColor: colors.canvas, height: 650, borderColor: colors.line, borderWidth: 1 }}>
      <ProfileCardView
        candidate={candidate}
        colors={colors}
        insets={{...insets, top: 0, bottom: 0}}
        isDark={isDark}
        isViewOnly={true}
        myProfile={myProfile}
        styles={discoverStyles}
        getMeetupStats={getMeetupStats}
      />
    </View>
  );
}

`;

content = content.substring(0, previewStartIndex) + newPreview + content.substring(previewEndIndex);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed ProfileScreen syntax error');
