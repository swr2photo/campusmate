import './src/services/notificationBackgroundTask';
import { LogBox, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
if (Platform.OS === 'android') {
  Font.loadAsync(Ionicons.font).catch(() => {});
}

// Ignore non-fatal development warnings from displaying intrusive banners over UI
LogBox.ignoreLogs([
  '[Firestore] E2EE unavailable',
  'Due to changes in Androids permission',
  'Could not reach Cloud Firestore backend',
  '@firebase/firestore',
  'WebChannelConnection RPC',
  '[chatEncryptionService]',
  'client is offline',
  'Cannot connect to Expo CLI',
]);

if (__DEV__) {
  const originalWarn = console.warn;
  const originalError = console.error;
  const shouldFilter = (arg) => (
    typeof arg === 'string' && (
      arg.includes('@firebase/firestore') ||
      arg.includes('WebChannelConnection RPC') ||
      arg.includes('Could not reach Cloud Firestore backend') ||
      arg.includes('[chatEncryptionService]') ||
      arg.includes('client is offline') ||
      arg.includes('Cannot connect to Expo CLI')
    )
  );

  console.warn = (...args) => {
    if (args.some(shouldFilter)) return;
    originalWarn(...args);
  };

  console.error = (...args) => {
    if (args.some(shouldFilter)) return;
    originalError(...args);
  };
}

// LiveKit's WebRTC globals are registered lazily by CallContext when the first
// call starts; doing it here would parse the A/V stack on every cold start.

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
import 'expo-router/entry';
