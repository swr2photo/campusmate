import React, { useRef } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BottomSheet, Button as SwiftButton, Divider, Group, Host, HStack, Image, RNHostView, ScrollView, Spacer, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, controlSize, disabled, fixedSize, foregroundStyle, frame, labelStyle, lineLimit, padding, presentationDetents, presentationDragIndicator, shapes, textSelection, tint } from '@expo/ui/swift-ui/modifiers';
import { Button, Text } from './NativeTypography';
import { font } from './brandFont';
import PlacePhoto from './PlacePhoto';
import { canUseLiquidGlass } from './LiquidGlassView';
import { useTheme } from '../theme';
import { placeDetailRows } from '../utils/placeDetails';

// Category and distance already appear under the title, so the detail list skips them.
const HEADER_ROW_ICONS = new Set(['tag.fill', 'location.fill']);

function SheetAction({ label, icon, onPress, prominent = false, isDisabled = false, glass, colors }) {
  const style = prominent ? (glass ? 'glassProminent' : 'borderedProminent') : (glass ? 'glass' : 'bordered');
  const contentColor = prominent ? colors.onPrimary : colors.primary;
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle(style),
        buttonBorderShape('capsule'),
        controlSize('large'),
        tint(colors.primary),
        disabled(isDisabled),
        accessibilityLabel(label),
      ]}
    >
      <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
        <Image systemName={icon} size={16} color={contentColor} />
        <Text modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(contentColor), lineLimit(1)]}>{label}</Text>
      </HStack>
    </Button>
  );
}

export default function PlaceDetailSheet({ spot, visible, onClose, onSchedule, onChoose, onOpenMap, selected }) {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const lastSpot = useRef(spot);
  const pendingAction = useRef(null);
  if (spot) lastSpot.current = spot;
  const current = spot || lastSpot.current;
  const glass = canUseLiquidGlass();
  const photoWidth = Math.min(width, 600) - 40;
  const subtitle = [current?.categoryLabel, current?.distance].filter(Boolean).join(' · ');
  const rows = placeDetailRows(current).filter((row) => !HEADER_ROW_ICONS.has(row.icon));

  // Open the next native presentation only after this sheet has fully dismissed.
  const runAction = (callback) => {
    if (pendingAction.current || !callback) return;
    pendingAction.current = () => callback(current);
    onClose();
  };

  return <Host colorScheme={isDark ? 'dark' : 'light'} style={{ position: 'absolute', width: 0, height: 0 }}>
    <BottomSheet
      isPresented={Boolean(visible && current)}
      onIsPresentedChange={(presented) => { if (!presented) onClose(); }}
      onDismiss={() => { const action = pendingAction.current; pendingAction.current = null; action?.(); }}
    >
      {/* Presentation modifiers must sit on the sheet content; on BottomSheet itself they only reach the hidden anchor. */}
      <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
        <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' })]}>
          <HStack alignment="center" spacing={12} modifiers={[padding({ horizontal: 20, top: 22, bottom: 12 }), frame({ maxWidth: Infinity })]}>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ textStyle: 'title3', weight: 'bold' }), foregroundStyle(colors.ink), lineLimit(2), textSelection(true)]}>{current?.name || 'สถานที่นัดหมาย'}</Text>
              {subtitle ? <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(colors.inkMuted), lineLimit(1)]}>{subtitle}</Text> : null}
            </VStack>
            <Spacer />
            {glass ? (
              <SwiftButton role="close" onPress={onClose} modifiers={[accessibilityLabel('ปิดรายละเอียดสถานที่')]} />
            ) : (
              <Button label="ปิดรายละเอียดสถานที่" systemImage="xmark" onPress={onClose}
                modifiers={[buttonStyle('bordered'), buttonBorderShape('circle'), labelStyle('iconOnly'), accessibilityLabel('ปิดรายละเอียดสถานที่'), tint(colors.ink)]} />
            )}
          </HStack>

          <ScrollView>
            <VStack alignment="leading" spacing={16} modifiers={[padding({ horizontal: 20, bottom: 20 }), frame({ maxWidth: 600, alignment: 'leading' })]}>
              <RNHostView matchContents>
                <View style={{ width: photoWidth, height: 200, borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surfaceRaised }}>
                  <PlacePhoto spot={current} style={{ width: '100%', height: '100%' }} />
                </View>
              </RNHostView>

              {selected ? (
                <HStack spacing={6} modifiers={[padding({ horizontal: 12, vertical: 6 }), background(colors.greenSoft, shapes.capsule())]}>
                  <Image systemName="checkmark.circle.fill" size={14} color={colors.green} />
                  <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(colors.green)]}>จุดนัดหมายที่เลือกไว้</Text>
                </HStack>
              ) : null}

              {current?.description ? (
                <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(colors.inkMuted), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{current.description}</Text>
              ) : null}

              {rows.length ? (
                <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), background(colors.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 20 }))]}>
                  {rows.map((row, index) => (
                    <VStack key={row.label} alignment="leading" spacing={0}>
                      {index > 0 ? <Divider modifiers={[padding({ leading: 58 })]} /> : null}
                      <HStack alignment="top" spacing={12} modifiers={[padding({ horizontal: 14, vertical: 12 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                        <Image systemName={row.icon} size={15} color={colors.primary}
                          modifiers={[frame({ width: 32, height: 32 }), background(colors.primarySoft, shapes.circle())]} />
                        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                          <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(colors.inkMuted)]}>{row.label}</Text>
                          <Text modifiers={[font({ textStyle: 'body', weight: 'medium' }), foregroundStyle(colors.ink), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{String(row.value)}</Text>
                        </VStack>
                      </HStack>
                    </VStack>
                  ))}
                </VStack>
              ) : null}
            </VStack>
          </ScrollView>

          <VStack spacing={10} modifiers={[padding({ horizontal: 20, top: 12, bottom: 8 }), frame({ maxWidth: 600 })]}>
            <SheetAction colors={colors} glass={glass} icon="calendar.badge.clock" label="นัดหมายที่นี่" prominent onPress={() => runAction(onSchedule)} />
            <HStack spacing={10}>
              <SheetAction colors={colors} glass={glass} icon={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'} isDisabled={selected}
                label={selected ? 'ปักหมุดแล้ว' : 'ปักหมุด'} onPress={() => { if (!selected) runAction(onChoose); }} />
              <SheetAction colors={colors} glass={glass} icon="map.fill" label="เปิดแผนที่" onPress={() => runAction(onOpenMap)} />
            </HStack>
          </VStack>
        </VStack>
      </Group>
    </BottomSheet>
  </Host>;
}
