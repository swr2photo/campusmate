import React, { useRef } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BottomSheet, Host, HStack, Image, RNHostView, ScrollView, Spacer, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonStyle, controlSize, disabled, fixedSize, foregroundStyle, frame, labelStyle, padding, presentationDetents, presentationDragIndicator, textSelection, tint } from '@expo/ui/swift-ui/modifiers';
import { Button, Text } from './NativeTypography';
import { font } from './brandFont';
import PlacePhoto from './PlacePhoto';
import { DetailAction } from './PlaceDetailContent';
import { StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { placeDetailRows } from '../utils/placeDetails';

export default function PlaceDetailSheet({ spot, visible, onClose, onSchedule, onChoose, onOpenMap, selected }) {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const lastSpot = useRef(spot);
  const pendingAction = useRef(null);
  if (spot) lastSpot.current = spot;
  const current = spot || lastSpot.current;
  // Open the next native presentation only after this sheet has fully dismissed.
  const runAction = (callback) => {
    if (pendingAction.current || !callback) return;
    pendingAction.current = () => callback(current);
    onClose();
  };
  return <Host colorScheme={isDark ? 'dark' : 'light'} style={{ position: 'absolute', width: 0, height: 0 }}>
    <BottomSheet isPresented={Boolean(visible && current)} onIsPresentedChange={(presented) => { if (!presented) onClose(); }}
      onDismiss={() => { const action = pendingAction.current; pendingAction.current = null; action?.(); }}>
      {/* Presentation modifiers only take effect on the sheet's content, not on BottomSheet. */}
      <VStack spacing={0} modifiers={[background(colors.card), frame({ maxWidth: Infinity, maxHeight: Infinity }), presentationDetents(['large']), presentationDragIndicator('visible')]}>
        <HStack modifiers={[padding({ horizontal: 20, top: 16, bottom: 10 }), frame({ maxWidth: Infinity })]}>
          <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(colors.ink)]}>รายละเอียดสถานที่</Text>
          <Spacer />
          <Button label="ปิดรายละเอียดสถานที่" systemImage="xmark" onPress={onClose}
            modifiers={[buttonStyle('bordered'), labelStyle('iconOnly'), accessibilityLabel('ปิดรายละเอียดสถานที่'), tint(colors.ink)]} />
        </HStack>
        <ScrollView>
          <VStack alignment="leading" spacing={20} modifiers={[padding({ horizontal: 20, bottom: 24 }), frame({ maxWidth: 600, alignment: 'leading' })]}>
            {/* Fixed-height SwiftUI frame: with matchContents the sheet laid out the description and
                detail card before the photo's RN size arrived, so they covered half the photo.
                Width and height are separate frames because frame() ignores maxWidth once height is set. */}
            <ZStack modifiers={[frame({ maxWidth: Infinity }), frame({ height: 210 })]}>
              <RNHostView matchContents={false}><View style={{ flex: 1, borderRadius: 20, overflow: 'hidden' }}><PlacePhoto spot={current} style={StyleSheet.absoluteFill} /></View></RNHostView>
            </ZStack>
            <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(colors.ink), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{current?.name || 'สถานที่นัดหมาย'}</Text>
            {selected ? <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(colors.mint)]}>✓ จุดนัดหมายที่เลือกไว้</Text> : null}
            {current?.description ? <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(colors.inkMuted), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{current.description}</Text> : null}
            <VStack alignment="leading" spacing={18} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              {placeDetailRows(current).map((row) => <HStack key={row.label} alignment="top" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Image systemName={row.icon} size={17} color={colors.primary} modifiers={[frame({ width: 24, height: 26 })]} />
                <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(colors.inkMuted)]}>{row.label}</Text>
                  <Text modifiers={[font({ textStyle: 'body', weight: 'medium' }), foregroundStyle(colors.ink), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{String(row.value)}</Text>
                </VStack>
              </HStack>)}
            </VStack>
          </VStack>
        </ScrollView>
        <RNHostView matchContents>
          <View style={{ width: width, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, backgroundColor: colors.card, gap: 8 }}>
            <DetailAction icon="calendar.badge.clock" label="นัดหมายที่นี่" primary onPress={() => runAction(onSchedule)} colors={colors} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DetailAction disabled={selected} icon={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'} label={selected ? 'ปักหมุดแล้ว' : 'ปักหมุดสถานที่'} onPress={() => { if (!selected) runAction(onChoose); }} colors={colors} />
              <DetailAction icon="map.fill" label="เปิดแผนที่" onPress={() => runAction(onOpenMap)} colors={colors} />
            </View>
          </View>
        </RNHostView>
      </VStack>
    </BottomSheet>
  </Host>;
}
