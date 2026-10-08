import { NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold } from '@expo-google-fonts/noto-sans-thai';
import { Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';

const ICON_FONTS = Platform.OS === 'android' ? Ionicons.font : {};

export function useIconFontsReady() {
  const [loaded, error] = useFonts({ ...ICON_FONTS, NotoSansThai_400Regular, NotoSansThai_500Medium, NotoSansThai_600SemiBold, NotoSansThai_700Bold });
  return loaded || !!error;
}
