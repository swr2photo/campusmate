import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import ProfilePhotoThumbnail from './ProfilePhotoThumbnail';
import { PhotoPoseScene } from './illustrations';
import { useTheme } from '../theme';

const GAP = 10;
const TILE_RATIO = 1.25;

// Slot rectangles for a 3-column bento: the main photo spans 2 × 2 at the
// top left, two tiles stack beside it, the rest flow in rows of three.
function layout(slots, width) {
  const cell = Math.max(1, (width - GAP * 2) / 3);
  const cellH = Math.round(cell * TILE_RATIO);
  const rects = [];
  for (let index = 0; index < slots; index += 1) {
    if (index === 0) rects.push({ x: 0, y: 0, w: cell * 2 + GAP, h: cellH * 2 + GAP });
    else if (index < 3) rects.push({ x: cell * 2 + GAP * 2, y: (index - 1) * (cellH + GAP), w: cell, h: cellH });
    else {
      const row = Math.floor((index - 3) / 3);
      const column = (index - 3) % 3;
      rects.push({ x: column * (cell + GAP), y: (cellH + GAP) * (2 + row), w: cell, h: cellH });
    }
  }
  const rows = Math.max(0, Math.ceil((slots - 3) / 3));
  return { rects, height: cellH * 2 + GAP + rows * (cellH + GAP) };
}

/**
 * @param {object} props
 * @param {Array<string|null>} props.photos index 0 is the main photo, the rest are gallery photos.
 * @param {number} [props.slots]
 * @param {(index: number, uri: string|null) => void} props.onPressSlot
 * @param {(index: number) => void} [props.onRemove] shows a remove button on filled gallery tiles
 *   (the main photo is replaced, never removed, because it carries face verification).
 * @param {number|null} [props.busyIndex] tile that is uploading.
 */
export default function BentoPhotoGrid({ photos = [], slots = 6, onPressSlot, onRemove, busyIndex = null, busyUris = [], disabled = false, identityPrefix = 'bento', avatarRevision }) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const width = measured || Math.max(0, Math.min(windowWidth, 640) - 40);
  const { rects, height } = layout(slots, width);

  return (
    <View
      onLayout={({ nativeEvent }) => {
        const next = nativeEvent.layout.width;
        setMeasured((current) => (Math.abs(current - next) > 0.5 ? next : current));
      }}
      style={{ width: '100%', height }}
    >
      {rects.map((rect, index) => {
        const uri = photos[index] || null;
        const main = index === 0;
        const busy = busyIndex === index || busyUris.includes(uri);
        return (
          <Animated.View key={index} entering={FadeIn.delay(index * 35).duration(220)} style={[styles.tile, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={main
                ? (uri ? 'จัดการรูปหลัก' : 'เพิ่มรูปหลัก')
                : (uri ? `จัดการรูปที่ ${index + 1}` : `เพิ่มรูปที่ ${index + 1}`)}
              accessibilityState={{ disabled: disabled || busy, busy }}
              disabled={disabled || busy}
              onPress={() => onPressSlot?.(index, uri)}
              style={({ pressed }) => [
                styles.fill,
                { borderRadius: main ? 24 : 16 },
                uri ? { backgroundColor: colors.surfaceRaised } : main
                  ? { backgroundColor: colors.primarySoft }
                  : { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outlineVariant || colors.line },
                pressed && styles.pressed,
              ]}
            >
              {uri ? (
                <ProfilePhotoThumbnail uri={uri} revision={main ? avatarRevision : undefined} identity={`${identityPrefix}:${index}`} />
              ) : main ? (
                <View style={styles.mainEmpty}>
                  <PhotoPoseScene size={Math.min(rect.w * 0.62, rect.h * 0.5)} />
                  <Text style={[styles.mainEmptyTitle, { color: colors.ink }]}>เพิ่มรูปหลัก</Text>
                  <Text numberOfLines={2} style={[styles.mainEmptyHint, { color: colors.inkMuted }]}>รูปที่เห็นหน้าชัด ยิ้มสบาย ๆ</Text>
                </View>
              ) : (
                <FeatureIcon name="plus" size={22} color={colors.inkSoft} />
              )}
              {main && uri ? (
                <View style={[styles.mainBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.mainBadgeText}>รูปหลัก</Text>
                </View>
              ) : null}
              {busy ? (
                <View style={styles.busy} accessibilityLiveRegion="polite"><ActivityIndicator color="#FFFFFF" accessibilityLabel="กำลังอัปโหลดรูป" /><Text style={{ color: '#FFF', fontSize: 12, marginTop: 6 }}>กำลังเตรียมและอัปโหลด…</Text></View>
              ) : null}
            </Pressable>
            {uri && !main && onRemove && !busy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`ลบรูปที่ ${index + 1}`}
                hitSlop={10}
                onPress={() => onRemove(index)}
                style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              >
                <FeatureIcon name="xmark" size={13} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { position: 'absolute' },
  fill: { flex: 1, overflow: 'hidden', borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.78 },
  mainEmpty: { alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 12 },
  mainEmptyTitle: { fontSize: 15, lineHeight: 22, fontWeight: '800', marginTop: 4 },
  mainEmptyHint: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  mainBadge: { position: 'absolute', left: 10, bottom: 10, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  mainBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' },
  remove: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
});
