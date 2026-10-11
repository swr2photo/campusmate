import { useNetInfo } from '@react-native-community/netinfo';
import { usePreferences } from '../context/PreferencesContext';
import { canAutoplay } from '../utils/appPreferences';

export default function useAutoplayPreference() {
  const { preferences, ready } = usePreferences();
  const network = useNetInfo();
  return ready && canAutoplay(preferences.autoplay, network);
}
