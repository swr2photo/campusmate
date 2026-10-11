import { Host } from '@expo/ui';
import { createViewModifierEventListener } from '@expo/ui/swift-ui/modifiers';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import * as React from 'react';
import { StyleSheet } from 'react-native';

import type {
  CampusLandmarkSelection,
  CampusLandmarksLibraryChange,
  CampusLandmarksViewProps,
} from './CampusLandmarks.types';
import CampusLandmarksFallback from './CampusLandmarksFallback';

type NativeEvent<T> = { nativeEvent: T };
type NativeProps = Omit<CampusLandmarksViewProps,
  'onClose' | 'onSelectPlace' | 'onLibraryChange' | 'style' | 'colorScheme' | 'tintColor'
> & {
  onClose?: (event: NativeEvent<Record<string, never>>) => void;
  onSelectPlace?: (event: NativeEvent<CampusLandmarkSelection>) => void;
  onLibraryChange?: (event: NativeEvent<CampusLandmarksLibraryChange>) => void;
};

// Expo Go and older development builds can open this route safely before a native rebuild.
function loadNativeView(): React.ComponentType<NativeProps> | null {
  const module = requireOptionalNativeModule<{ isSupported(): boolean }>('CampusLandmarks');
  try {
    return module?.isSupported()
      ? requireNativeView<NativeProps>('CampusLandmarks', 'CampusLandmarksView')
      : null;
  } catch {
    return null;
  }
}

const NativeCampusLandmarksView = loadNativeView();

export function isCampusLandmarksAvailable(): boolean {
  return NativeCampusLandmarksView !== null;
}

export default function CampusLandmarksView(props: CampusLandmarksViewProps) {
  if (!NativeCampusLandmarksView) return <CampusLandmarksFallback {...props} />;

  const {
    style,
    colorScheme,
    tintColor,
    modifiers,
    onClose,
    onSelectPlace,
    onLibraryChange,
    ...nativeProps
  } = props;

  return (
    <Host style={[styles.host, style]} colorScheme={colorScheme} seedColor={tintColor} useViewportSizeMeasurement>
      <NativeCampusLandmarksView
        {...nativeProps}
        modifiers={modifiers}
        {...(modifiers ? createViewModifierEventListener(modifiers) : undefined)}
        onClose={onClose ? () => onClose() : undefined}
        onSelectPlace={onSelectPlace ? ({ nativeEvent }: NativeEvent<CampusLandmarkSelection>) => onSelectPlace(nativeEvent) : undefined}
        onLibraryChange={onLibraryChange ? ({ nativeEvent }: NativeEvent<CampusLandmarksLibraryChange>) => onLibraryChange(nativeEvent) : undefined}
      />
    </Host>
  );
}

const styles = StyleSheet.create({ host: { flex: 1 } });
