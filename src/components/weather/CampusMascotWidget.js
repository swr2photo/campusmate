import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable } from '../NativePressable';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { Mascot } from '../illustrations';
import { CAMPUS_SPOTS } from '../../data/campusSpots';
import { useCampusWeather } from '../../context/WeatherContext';
import { motion } from '../../theme';

// Spots that suit each kind of weather: indoors when it rains, outdoors when
// it is fine, 24-hour study corners and cafes at night.
const SUITED = {
  sunny: ['chill', 'sports', 'running'],
  cloudy: ['chill', 'running', 'sports', 'cafe'],
  rainy: ['cafe', 'study', 'gym'],
  night: ['study', 'cafe'],
};

const GREETING = {
  sunny: 'แดดดีแบบนี้ ออกไปเดินเล่นกันไหม?',
  cloudy: 'ลมเย็นสบาย เหมาะกับนัดเพื่อนเลย',
  rainy: 'ฝนตกอยู่ หาที่นั่งในร่มกันนะ',
  night: 'ดึกแล้ว อ่านหนังสือกับเพื่อนสักหน่อยไหม?',
};

/** Outfit and pose for the weather; evenings turn into study time. */
export function mascotLookFor(condition, date = new Date()) {
  if (condition === 'rainy') return { outfit: 'rain', pose: 'idle', mood: 'calm' };
  if (condition === 'night' || date.getHours() >= 19) return { outfit: 'study', pose: 'read', mood: 'calm' };
  if (condition === 'sunny') return { outfit: 'sun', pose: 'wave', mood: 'happy' };
  return { outfit: 'none', pose: 'idle', mood: 'happy' };
}

function pickSpot(condition, previousId) {
  const kinds = SUITED[condition] || SUITED.sunny;
  const pool = CAMPUS_SPOTS.filter((spot) => kinds.includes(spot.category) && spot.id !== previousId);
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

/**
 * The campus mascot, dressed for the live weather, with a speech bubble.
 * Tapping the bubble suggests a popular meetup spot that suits the weather.
 */
export default function CampusMascotWidget({ size = 72, showBubble = true, bubbleTone = 'light', onShowSpot, style }) {
  const { condition, theme } = useCampusWeather();
  const reduceMotion = useReducedMotion();
  const look = useMemo(() => mascotLookFor(condition), [condition]);
  const [spot, setSpot] = useState(null);
  const pop = useSharedValue(1);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  const suggest = () => {
    Haptics.selectionAsync().catch(() => {});
    setSpot((current) => pickSpot(condition, current?.id));
    if (!reduceMotion) pop.set(withSequence(withTiming(0.92, { duration: 80 }), withSpring(1, motion.spring.bouncy)));
  };

  const dark = bubbleTone === 'dark';
  const text = spot ? `ลอง “${spot.name}” ไหม?` : GREETING[condition];
  return (
    <View style={[styles.row, style]}>
      <Mascot size={size} outfit={look.outfit} pose={look.pose} mood={look.mood} accessory={look.outfit === 'rain' ? 'none' : undefined} />
      {showBubble ? (
        <Animated.View style={[styles.bubbleWrap, bubbleStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${text} แตะเพื่อสุ่มจุดนัดหมายยอดฮิต`}
            onPress={suggest}
            style={({ pressed }) => [styles.bubble, { backgroundColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.86)' }, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.tail, { borderRightColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.86)' }]} />
            <Text numberOfLines={3} style={[styles.bubbleText, { color: dark ? '#FFFFFF' : theme.ink }]}>{text}</Text>
            <View style={styles.bubbleFooter}>
              <FeatureIcon name="sparkles" size={12} color={theme.accent} />
              <Text style={[styles.bubbleHint, { color: dark ? 'rgba(255,255,255,0.75)' : theme.accent }]}>{spot ? 'แตะเพื่อสุ่มที่ใหม่' : 'แตะให้ช่วยหาที่นัด'}</Text>
            </View>
          </Pressable>
          {spot ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`ดู ${spot.name} บนแผนที่ ม.อ.`} hitSlop={6}
              onPress={() => (onShowSpot ? onShowSpot(spot) : router.push({ pathname: '/campus-map', params: { spot: spot.id } }))} style={styles.mapLink}>
              <FeatureIcon name="map.fill" size={13} color={dark ? '#FFFFFF' : theme.accent} />
              <Text style={[styles.mapLinkText, { color: dark ? '#FFFFFF' : theme.accent }]}>ดูบนแผนที่</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleWrap: { flex: 1, minWidth: 0 },
  bubble: { borderRadius: 16, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, justifyContent: 'center' },
  tail: { position: 'absolute', left: -7, top: 16, width: 0, height: 0, borderTopWidth: 6, borderBottomWidth: 6, borderRightWidth: 8, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  bubbleText: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  bubbleHint: { fontSize: 11, fontWeight: '600' },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 4, alignSelf: 'flex-start' },
  mapLinkText: { fontSize: 12, fontWeight: '700' },
});
