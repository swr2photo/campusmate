import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore only allows alphanumeric, '.', '-', and '_'
// Firebase keys usually look like "firebase:authUser:..." so we replace colons
const sanitizeKey = (key) => key.replace(/[^a-zA-Z0-9.\-_]/g, '_');

export const Storage = {
  getItem: async (key) => {
    if (Platform.OS === 'web') {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    }
    return await SecureStore.getItemAsync(sanitizeKey(key));
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {}
      return;
    }
    await SecureStore.setItemAsync(sanitizeKey(key), value);
  },
  removeItem: async (key) => {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
      } catch (e) {}
      return;
    }
    await SecureStore.deleteItemAsync(sanitizeKey(key));
  }
};
