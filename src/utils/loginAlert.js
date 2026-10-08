import { Platform } from 'react-native';
import { showAlert } from './appAlert';

export function showLoginAlert(message, title = 'เกิดข้อผิดพลาด') {
  if (!message) return;

  if (Platform.OS === 'web') {
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(`${title}\n\n${message}`);
    }
    return;
  }

  showAlert(title, message, { tone: title === 'เกิดข้อผิดพลาด' ? 'danger' : 'warning' });
}
