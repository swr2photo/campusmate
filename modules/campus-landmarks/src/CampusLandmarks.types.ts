import type { CommonViewModifierProps } from '@expo/ui/swift-ui';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

export type CampusLandmarkSelection = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type CampusLandmarksLibraryChange = {
  favoriteCount: number;
  collectionCount: number;
};

export interface CampusLandmarksViewProps extends CommonViewModifierProps {
  title?: string;
  /** Stable namespace for local archives and backend credentials. Change it on sign-in changes. */
  storageScope: string;
  /** Optional HTTPS origin of the Landmarks Rust API. */
  backendURL?: string;
  /** Enable sync only after a backend origin has been configured. */
  syncEnabled?: boolean;
  colorScheme?: 'light' | 'dark';
  tintColor?: ColorValue;
  style?: StyleProp<ViewStyle>;
  onClose?: () => void;
  onSelectPlace?: (place: CampusLandmarkSelection) => void;
  onLibraryChange?: (library: CampusLandmarksLibraryChange) => void;
}
