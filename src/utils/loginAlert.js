import { Alert, Platform } from 'react-native';

export function showLoginAlert(message, title = 'เกิดข้อผิดพลาด') {
  if (!message) return;

  if (Platform.OS === 'web') {
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(`${title}\n\n${message}`);
    }
    return;
  }

  Alert.alert(title, message);
}
