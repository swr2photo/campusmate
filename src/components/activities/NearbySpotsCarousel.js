import { Pressable } from '../NativePressable';
import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, FadeInRight, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import PlacePhoto from '../PlacePhoto';
import { PressScale } from './motion';
import { categoryMeta } from './categories';
import { motion, radius, useTheme } from '../../theme';

const GAP = 12;
// How far the photo drifts against the scroll, for a sense of depth.
const PARALLAX = 18;
// Badge fills dark enough for 12pt white text (at least 4.5:1).
const SELECTED_GREEN = '#0B7A55';
const NEAREST_AMBER = '#9A5B00';

/** Large photo cards for the first few spots, snapping one card at a time. */
export default function NearbySpotsCarousel({ spots, width, bleed = 0, selectedId, onPress }) {
  const reduceMotion = useReducedMotion();
  const { fontScale = 1 } = useWindowDimensions();
  const cardWidth = Math.round(Math.min(Math.max(width * 0.76, 236), 340));
  // Taller with larger text so the overlaid name never runs into the badges.
  const cardHeight = Math.round(cardWidth * 0.78 * Math.min(Math.max(fontScale, 1), 1.5));
  const interval = cardWidth + GAP;
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (event) => { scrollX.set(event.contentOffset.x); } });
  if (!spots.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Animated.ScrollView
        contentContainerStyle={{ gap: GAP, paddingHorizontal: bleed }}
        decelerationRate="fast"
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        style={bleed ? { marginHorizontal: -bleed } : null}
      >
        {spots.map((spot, index) => (
          <Animated.View
            entering={reduceMotion ? undefined : FadeInRight.delay(Math.min(index, 4) * 70).duration(motion.duration.slow)}
            key={spot.id}
          >
            <NearbyCard
              first={index === 0}
              height={cardHeight}
              index={index}
              interval={interval}
              onPress={onPress}
              reduceMotion={reduceMotion}
              scrollX={scrollX}
              selected={spot.id === selectedId}
              spot={spot}
              width={cardWidth}
            />
          </Animated.View>
        ))}
      </Animated.ScrollView>
      {spots.length > 1 ? <PageDots count={spots.length} interval={interval} scrollX={scrollX} /> : null}
    </View>
  );
}

function NearbyCard({ spot, index, interval, scrollX, width, height, first, selected, reduceMotion, onPress }) {
  const { colors } = useTheme();
  const meta = categoryMeta(spot.category);
  const position = index * interval;
  const cardStyle = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    const scale = interpolate(scrollX.get(), [position - interval, position, position + interval], [0.94, 1, 0.94], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });
  const photoStyle = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    const shift = interpolate(scrollX.get(), [position - interval, position + interval], [-PARALLAX, PARALLAX], Extrapolation.CLAMP);
    return { transform: [{ translateX: shift }] };
  });
  const credit = spot.placePhoto?.credit;
  return (
    <Animated.View style={cardStyle}>
      <PressScale>
        <Pressable
          accessibilityHint="เปิดข้อมูลสถานที่ นัดหมาย ปักหมุด และแผนที่"
          accessibilityLabel={`ดูรายละเอียด ${spot.name}${spot.distance ? ` ห่าง ${spot.distance}` : ''}${selected ? ' จุดนัดหมายของคุณ' : ''}`}
          accessibilityRole="button"
          onPress={() => onPress?.(spot)}
          style={[styles.card, { width, height, backgroundColor: colors.surfaceRaised }]}
        >
          <Animated.View style={[styles.photo, photoStyle]}>
            <PlacePhoto showCredit={false} spot={spot} style={StyleSheet.absoluteFill} />
          </Animated.View>
          <LinearGradient
            colors={['rgba(8,12,20,0.38)', 'rgba(8,12,20,0)', 'rgba(8,12,20,0.18)', 'rgba(8,12,20,0.86)']}
            locations={[0, 0.28, 0.5, 1]}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.topRow}>
            <View style={styles.glassPill}>
              <FeatureIcon color="#FFFFFF" name={meta.icon} size={12} />
              <Text numberOfLines={1} style={styles.pillText}>{spot.categoryLabel || 'สถานที่ใน ม.อ.'}</Text>
            </View>
            {selected ? (
              <View style={[styles.statusPill, { backgroundColor: SELECTED_GREEN }]}>
                <FeatureIcon color="#FFFFFF" name="checkmark" size={11} />
                <Text style={styles.pillText}>จุดนัดของคุณ</Text>
              </View>
            ) : first && spot.distance ? (
              <View style={[styles.statusPill, { backgroundColor: NEAREST_AMBER }]}>
                <FeatureIcon color="#FFFFFF" name="sparkles" size={11} />
                <Text style={styles.pillText}>ใกล้สุด</Text>
              </View>
            ) : null}
          </View>
          <View pointerEvents="none" style={styles.copy}>
            <Text numberOfLines={2} style={styles.name}>{spot.name}</Text>
            <View style={styles.metaRow}>
              {spot.distance ? (
                <View style={styles.metaItem}>
                  <FeatureIcon color="#FFFFFF" name="location.fill" size={11} />
                  <Text style={styles.metaText}>{spot.distance}</Text>
                </View>
              ) : null}
              {spot.busyTime ? (
                <View style={[styles.metaItem, styles.metaShrink]}>
                  <FeatureIcon color="rgba(255,255,255,0.85)" name="clock.fill" size={11} />
                  <Text numberOfLines={1} style={[styles.metaText, styles.metaSoft]}>{spot.busyTime}</Text>
                </View>
              ) : null}
            </View>
            {credit ? <Text numberOfLines={1} style={styles.credit}>ภาพ: {credit}</Text> : null}
          </View>
        </Pressable>
      </PressScale>
    </Animated.View>
  );
}

function PageDots({ count, interval, scrollX }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
      {Array.from({ length: count }, (_, index) => <Dot index={index} interval={interval} key={index} scrollX={scrollX} />)}
    </View>
  );
}

function Dot({ index, interval, scrollX }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(scrollX.get() / interval - index);
    return {
      width: interpolate(distance, [0, 1], [18, 6], Extrapolation.CLAMP),
      opacity: interpolate(distance, [0, 1], [1, 0.35], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: colors.primary }, style]} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xxl, borderCurve: 'continuous', overflow: 'hidden' },
  // Wider than the card so the drifting photo never shows an edge.
  photo: { position: 'absolute', top: 0, bottom: 0, left: -PARALLAX, right: -PARALLAX },
  topRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  glassPill: {
    alignItems: 'center', backgroundColor: 'rgba(8,12,20,0.72)', borderRadius: radius.pill, flexDirection: 'row',
    flexShrink: 1, gap: 5, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusPill: { alignItems: 'center', borderRadius: radius.pill, flexDirection: 'row', gap: 4, paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', flexShrink: 1 },
  copy: { position: 'absolute', left: 16, right: 16, bottom: 14, gap: 6 },
  name: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', lineHeight: 25, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaShrink: { flexShrink: 1 },
  metaText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  metaSoft: { color: 'rgba(255,255,255,0.88)', fontWeight: '600' },
  credit: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3 },
});
