import React from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme';
import PlaceDetailContent from './PlaceDetailContent';

// Web fallback; native platforms use their own native bottom sheets.
export default function PlaceDetailSheet({ spot, visible, onClose, onSchedule, onChoose, onOpenMap, selected }) {
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const runAction = (action) => { onClose(); action?.(spot); };
  return <Modal visible={Boolean(visible && spot)} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="ปิดรายละเอียดสถานที่" onPress={onClose} style={{ position: 'absolute', inset: 0 }} />
      <View style={{ width: '100%', maxWidth: 600, height: height * 0.9, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: colors.card }}>
        {spot ? <PlaceDetailContent spot={spot} selected={selected} onClose={onClose} onSchedule={() => runAction(onSchedule)} onChoose={() => runAction(onChoose)} onOpenMap={() => runAction(onOpenMap)} /> : null}
      </View>
    </View>
  </Modal>;
}
