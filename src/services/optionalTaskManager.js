import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Importing expo-task-manager throws immediately when its native module is
// absent. Check the runtime before loading the package, including at startup.
export function getTaskManager() {
  if (Platform.OS === 'web'
    || Constants.appOwnership === 'expo'
    || Constants.executionEnvironment === 'storeClient'
    || !requireOptionalNativeModule('ExpoTaskManager')) return null;

  return require('expo-task-manager');
}
