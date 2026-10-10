import React, { useRef } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Host, ModalBottomSheet, RNHostView } from '@expo/ui/jetpack-compose';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import PlaceDetailContent from './PlaceDetailContent';

export default function PlaceDetailSheet({ spot, visible, onClose, onSchedule, onChoose, onOpenMap, selected }) {
  const sheetRef = useRef(null);
  const closing = useRef(false);
  const { width, height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!visible || !spot) return null;
  const dismiss = async (action) => {
    if (closing.current) return;
    closing.current = true;
    try {
      // The universal sheet has no dismissal-completion callback for controlled
      // Android closes. Await the native animation before opening map/schedule.
      await sheetRef.current?.hide();
      onClose();
      action?.(spot);
    } finally { closing.current = false; }
  };
  return <Host style={{ position: 'absolute' }}>
    <ModalBottomSheet ref={sheetRef} skipPartiallyExpanded containerColor={colors.card} onDismissRequest={onClose}>
      <RNHostView matchContents><View style={{ width: Math.min(width, 600), height: height * 0.82 }}>
        <PlaceDetailContent spot={spot} selected={selected} bottomInset={Math.max(bottom, 16)} onClose={() => void dismiss()}
          onSchedule={() => void dismiss(onSchedule)} onChoose={() => void dismiss(onChoose)} onOpenMap={() => void dismiss(onOpenMap)} />
      </View></RNHostView>
    </ModalBottomSheet>
  </Host>;
}
