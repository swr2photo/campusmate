const { withAppDelegate } = require('expo/config-plugins');

// RNFirebase's plugin still anchors initialization to startReactNative, which
// moved to SceneDelegate in Expo 58. Initialize before the scene is connected.
module.exports = (config) => withAppDelegate(config, (result) => {
  if (result.modResults.language !== 'swift') return result;
  const source = result.modResults.contents;
  if (source.includes('FirebaseApp.configure()')) return result;
  const anchor = '    let delegate = ReactNativeDelegate()';
  if (!source.includes(anchor)) {
    throw new Error('Cannot locate Firebase initialization point in AppDelegate.swift');
  }
  result.modResults.contents = source.replace(
    anchor,
    `    if FirebaseApp.app() == nil { FirebaseApp.configure() }\n${anchor}`,
  );
  return result;
});
