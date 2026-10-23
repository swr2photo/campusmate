import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDecay, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Pressable } from '../components/NativePressable';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { GlassBackground, GlassIconButton, useLiquidGlass, withAlpha } from '../components/LiquidGlassSurface';
import AnimatedPin, { PIN_KINDS } from '../components/map/AnimatedPin';
import WeatherBackdrop from '../components/weather/WeatherBackdrop';
import CampusMascotWidget from '../components/weather/CampusMascotWidget';
import { CAMPUS_SPOTS } from '../data/campusSpots';
import { useAppAppointments, useAppConversations, useAppProfile } from '../context/AppContext';
import { useCampusWeather } from '../context/WeatherContext';
import { useResponsiveSize } from '../hooks/useResponsiveSize';
import { isMeetupExpired } from '../utils/meetupTime';
import { motion, useTheme } from '../theme';

// Illustrated 2.5D map of PSU Hat Yai. Positions come from the real spot
// coordinates in campusSpots; buildings are drawn as extruded blocks so the
// map reads in depth without a map SDK, works offline and follows the weather.

const PAD = 70;
const SPOT_BY_ID = Object.fromEntries(CAMPUS_SPOTS.map((spot) => [spot.id, spot]));
const LATS = CAMPUS_SPOTS.map((spot) => spot.latitude).filter(Number.isFinite);
const LONS = CAMPUS_SPOTS.map((spot) => spot.longitude).filter(Number.isFinite);
const BOUNDS = { minLat: Math.min(...LATS), maxLat: Math.max(...LATS), minLon: Math.min(...LONS), maxLon: Math.max(...LONS) };

// Landmarks drawn on the map. Only places with verified coordinates in the
// app's data are shown.
const LANDMARKS = [
  { spotId: 'spot-reservoir-heart', kind: 'water', label: 'อ่างเก็บน้ำ ม.อ.', w: 150, h: 92 },
  { spotId: 'spot-psu-stadium', kind: 'track', label: 'สนามกีฬากลาง', w: 120, h: 74 },
  { spotId: 'spot-rong-chang', label: 'โรงช้าง', w: 74, h: 44, color: '#FFB86B' },
  { spotId: 'spot-econ-cafe', label: 'คณะเศรษฐศาสตร์', w: 62, h: 40, color: '#C9A2FF' },
  { spotId: 'spot-fms-coworking', label: 'คณะวิทยาการจัดการ', w: 66, h: 40, color: '#8FD3C1' },
  { spotId: 'spot-gym-complex', label: 'ยิมใหญ่ ม.อ.', w: 76, h: 46, color: '#7EE0B5' },
  { spotId: 'spot-plaza-dorm', label: 'โซนหอพัก', w: 70, h: 44, color: '#FFC2A8' },
  { spotId: 'spot-eng-plaza', label: 'คณะวิศวกรรมศาสตร์', w: 82, h: 48, color: '#FFD36B' },
  { spotId: 'spot-lib-the-forest-24h', label: 'หอสมุดคุณหญิงหลง', w: 72, h: 46, color: '#FF9FB0' },
  { spotId: 'spot-lan-sai-sci', label: 'คณะวิทยาศาสตร์', w: 78, h: 46, color: '#7FB3FF' },
  { spotId: 'spot-black-canyon-hospital', label: 'โรงพยาบาลสงขลานครินทร์', w: 84, h: 50, color: '#A9D8FF' },
  { spotId: 'spot-icc-hatyai', label: 'ICC Hat Yai', w: 70, h: 42, color: '#B8C4FF' },
].filter((item) => SPOT_BY_ID[item.spotId]);

// A loose ring road through the landmarks, plus the branch to ICC.
const ROADS = [
  ['spot-psu-stadium', 'spot-econ-cafe'], ['spot-econ-cafe', 'spot-rong-chang'], ['spot-rong-chang', 'spot-gym-complex'],
  ['spot-gym-complex', 'spot-plaza-dorm'], ['spot-gym-complex', 'spot-eng-plaza'], ['spot-eng-plaza', 'spot-lib-the-forest-24h'],
  ['spot-lib-the-forest-24h', 'spot-lan-sai-sci'], ['spot-lan-sai-sci', 'spot-black-canyon-hospital'],
  ['spot-black-canyon-hospital', 'spot-psu-stadium'], ['spot-eng-plaza', 'spot-icc-hatyai'], ['spot-rong-chang', 'spot-lib-the-forest-24h'],
];

const FILTERS = [
  { id: 'all', label: 'ทั้งหมด', icon: 'map.fill' },
  { id: 'cafe', label: 'คาเฟ่', icon: 'cup.and.saucer.fill' },
  { id: 'study', label: 'อ่านหนังสือ', icon: 'book.fill' },
  { id: 'sports', label: 'กีฬา', icon: 'basketball.fill' },
  { id: 'chill', label: 'พักผ่อน', icon: 'leaf.fill' },
  { id: 'appointment', label: 'นัดของฉัน', icon: 'calendar' },
];

const GROUND = {
  sunny: { grass: '#CDE8B0', water: '#79C3FF', road: '#F6EEDF', top: '#FFFFFF', tree: '#6FBF73' },
  cloudy: { grass: '#D6E8D0', water: '#8CC6F2', road: '#F2EEE6', top: '#FFFFFF', tree: '#78B88A' },
  rainy: { grass: '#B4CBB6', water: '#6C9CC6', road: '#DCE1E4', top: '#EEF2F6', tree: '#5E9A72' },
  night: { grass: '#1C2A2C', water: '#22405D', road: '#334043', top: '#2C3446', tree: '#244A36' },
};

function pinKind(category) {
  if (category === 'cafe' || category === 'study' || category === 'running' || category === 'gym') return category;
  if (category === 'sports') return 'sports';
  return 'chill';
}

function seeded(index, salt) {
  const x = Math.sin(index * 91.7 + salt * 47.3) * 9631.17;
  return x - Math.floor(x);
}

function Block({ x, y, w, h, color, night, label }) {
  const depth = Math.round(h * 0.38);
  return (
    <View pointerEvents="none" style={[styles.abs, { left: x - w / 2, top: y - h / 2 }]}>
      <View style={[styles.blockShadow, { width: w * 1.05, height: h * 0.5, top: h * 0.7 + depth * 0.6, left: w * 0.06 }]} />
      <View style={{ width: w, height: h, borderRadius: 10, backgroundColor: night ? '#2C3446' : color, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.12)' }}>
        <View style={[styles.roofLine, { backgroundColor: night ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)' }]} />
      </View>
      {/* Front face: a darker band below the roof gives the block its height. */}
      <View style={{ width: w, height: depth, marginTop: -8, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: night ? '#1A2030' : withAlpha(color, 1), opacity: night ? 1 : 0.62, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 5, paddingTop: 10, overflow: 'hidden' }}>
        {Array.from({ length: Math.max(3, Math.round(w / 14)) }, (_, index) => (
          <View key={index} style={{ width: 6, height: 5, borderRadius: 1, backgroundColor: night ? (seeded(index, w) > 0.35 ? '#FFD66B' : '#3B4458') : 'rgba(255,255,255,0.7)' }} />
        ))}
      </View>
      <Text numberOfLines={1} style={[styles.blockLabel, { color: night ? '#E8ECF8' : '#1F2A37', maxWidth: w + 40, left: -20, width: w + 40 }]}>{label}</Text>
    </View>
  );
}

export default function PSUCampusMapScreen() {
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const glass = useLiquidGlass();
  const { width, height, mapHeight, gutter } = useResponsiveSize();
  const { condition, theme, temperature } = useCampusWeather();
  const { appointments = [] } = useAppAppointments();
  const { conversations = [] } = useAppConversations();
  const { profile } = useAppProfile();
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(typeof params.spot === 'string' ? params.spot : null);
  const night = condition === 'night';
  const ground = GROUND[condition] || GROUND.sunny;

  const contentW = Math.round(width * 1.9);
  const contentH = Math.round(mapHeight * 1.7);
  const project = useCallback((latitude, longitude) => ({
    x: PAD + ((longitude - BOUNDS.minLon) / Math.max(BOUNDS.maxLon - BOUNDS.minLon, 1e-6)) * (contentW - PAD * 2),
    y: PAD + ((BOUNDS.maxLat - latitude) / Math.max(BOUNDS.maxLat - BOUNDS.minLat, 1e-6)) * (contentH - PAD * 2),
  }), [contentH, contentW]);

  // One pin per location; spots sharing a building collapse into a counted pin.
  const spotPins = useMemo(() => {
    const groups = new Map();
    CAMPUS_SPOTS.forEach((spot) => {
      if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) return;
      const key = `${spot.latitude.toFixed(4)},${spot.longitude.toFixed(4)}`;
      const group = groups.get(key);
      if (group) group.spots.push(spot);
      else groups.set(key, { id: spot.id, spots: [spot], ...project(spot.latitude, spot.longitude) });
    });
    return [...groups.values()].map((group) => ({ ...group, kind: pinKind(group.spots[0].category), label: group.spots[0].name, count: group.spots.length }));
  }, [project]);

  // Upcoming meetups that have a real place on campus, with the other person's photo.
  const appointmentPins = useMemo(() => {
    const people = new Map();
    conversations.forEach((conversation) => {
      Object.entries(conversation.participantProfiles || {}).forEach(([id, person]) => { if (person) people.set(id, person); });
    });
    return appointments
      .filter((item) => (item.status || 'active') === 'active' && !isMeetupExpired(item.meetup || item))
      .filter((item) => Number.isFinite(item.meetup?.latitude) && Number.isFinite(item.meetup?.longitude))
      .map((item) => {
        const otherId = item.hostId === profile?.id ? item.guestId : item.hostId;
        const person = people.get(otherId) || {};
        return {
          id: `appointment-${item.id}`,
          kind: 'appointment',
          label: `${item.meetup.name || 'จุดนัด'} · ${person.name || 'เพื่อน'}`,
          avatarUri: person.avatarUri || person.photoURL || null,
          count: 1,
          spots: [],
          ...project(item.meetup.latitude, item.meetup.longitude),
        };
      });
  }, [appointments, conversations, profile?.id, project]);

  const visiblePins = useMemo(() => {
    if (filter === 'appointment') return appointmentPins;
    const pins = filter === 'all' ? spotPins : spotPins.filter((pin) => pin.kind === filter || (filter === 'sports' && ['sports', 'gym', 'running'].includes(pin.kind)));
    return [...pins, ...(filter === 'all' ? appointmentPins : [])];
  }, [appointmentPins, filter, spotPins]);

  // ---- Map panning -------------------------------------------------------
  const minX = width - contentW;
  const minY = mapHeight - contentH;
  const clampX = (value) => Math.min(0, Math.max(minX, value));
  const clampY = (value) => Math.min(0, Math.max(minY, value));
  const tx = useSharedValue(clampX(width / 2 - contentW / 2));
  const ty = useSharedValue(clampY(mapHeight / 2 - contentH / 2));
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const centerOn = useCallback((pin) => {
    if (!pin) return;
    tx.set(withSpring(Math.min(0, Math.max(width - contentW, width / 2 - pin.x)), motion.spring.gentle));
    ty.set(withSpring(Math.min(0, Math.max(mapHeight - contentH, mapHeight * 0.45 - pin.y)), motion.spring.gentle));
  }, [contentH, contentW, mapHeight, tx, ty, width]);

  const pan = useMemo(() => Gesture.Pan()
    .onStart(() => { startX.set(tx.get()); startY.set(ty.get()); })
    .onUpdate((event) => {
      tx.set(Math.min(0, Math.max(minX, startX.get() + event.translationX)));
      ty.set(Math.min(0, Math.max(minY, startY.get() + event.translationY)));
    })
    .onEnd((event) => {
      tx.set(withDecay({ velocity: event.velocityX, clamp: [minX, 0] }));
      ty.set(withDecay({ velocity: event.velocityY, clamp: [minY, 0] }));
    }), [minX, minY, startX, startY, tx, ty]);
  const mapStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }] }));

  const allPins = useMemo(() => [...spotPins, ...appointmentPins], [appointmentPins, spotPins]);
  useEffect(() => {
    if (!selectedId) return;
    centerOn(allPins.find((pin) => pin.id === selectedId || pin.spots.some((spot) => spot.id === selectedId)));
    // Center only when the selection changes, not when pins are recomputed.
  }, [selectedId]);

  const select = (id) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedId((current) => (current === id ? null : id));
  };

  // ---- Bottom panel ------------------------------------------------------
  const collapsedTop = mapHeight - 28;
  const expandedTop = Math.max(insets.top + 72, height * 0.2);
  const panelTop = useSharedValue(collapsedTop);
  const panelStart = useSharedValue(collapsedTop);
  useEffect(() => { panelTop.set(collapsedTop); }, [collapsedTop, panelTop]);
  const panelPan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => { panelStart.set(panelTop.get()); })
    .onUpdate((event) => { panelTop.set(Math.min(collapsedTop + 40, Math.max(expandedTop, panelStart.get() + event.translationY))); })
    .onEnd((event) => {
      const goUp = event.velocityY < -400 || (event.velocityY < 400 && panelTop.get() < (collapsedTop + expandedTop) / 2);
      panelTop.set(withSpring(goUp ? expandedTop : collapsedTop, { damping: 20, stiffness: 180 }));
    }), [collapsedTop, expandedTop, panelStart, panelTop]);
  const panelStyle = useAnimatedStyle(() => ({ top: panelTop.get() }));

  const listItems = useMemo(() => {
    if (filter === 'appointment') return appointmentPins.map((pin) => ({ id: pin.id, pinId: pin.id, title: pin.label, subtitle: 'นัดที่กำลังจะถึง', kind: 'appointment' }));
    const spots = CAMPUS_SPOTS.filter((spot) => filter === 'all' || pinKind(spot.category) === filter || (filter === 'sports' && ['sports', 'gym', 'running'].includes(spot.category)));
    return spots.map((spot) => ({ id: spot.id, pinId: spotPins.find((pin) => pin.spots.some((item) => item.id === spot.id))?.id, title: spot.name, subtitle: [spot.categoryLabel, spot.busyTime].filter(Boolean).join(' · '), kind: pinKind(spot.category), rating: spot.rating }));
  }, [appointmentPins, filter, spotPins]);

  const surface = isDark ? colors.surfaceContainerHigh : colors.card;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {/* ---- Map ---- */}
      <View style={[styles.mapViewport, { height: mapHeight + 30 }]}>
        <WeatherBackdrop condition={condition} dark={isDark} density="map" />
        <GestureDetector gesture={pan}>
          <Animated.View style={[{ width: contentW, height: contentH }, mapStyle]}>
            <View style={[styles.ground, { backgroundColor: ground.grass }]} />
            {ROADS.map(([fromId, toId]) => {
              const from = project(SPOT_BY_ID[fromId]?.latitude, SPOT_BY_ID[fromId]?.longitude);
              const to = project(SPOT_BY_ID[toId]?.latitude, SPOT_BY_ID[toId]?.longitude);
              if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
              const length = Math.hypot(to.x - from.x, to.y - from.y);
              const angle = Math.atan2(to.y - from.y, to.x - from.x);
              return <View key={`${fromId}-${toId}`} style={[styles.road, { backgroundColor: ground.road, left: (from.x + to.x) / 2 - length / 2, top: (from.y + to.y) / 2 - 7, width: length, transform: [{ rotate: `${angle}rad` }] }]} />;
            })}
            {Array.from({ length: 46 }, (_, index) => (
              <View key={`tree-${index}`} style={[styles.tree, { left: seeded(index, 1) * contentW, top: seeded(index, 2) * contentH, backgroundColor: ground.tree, transform: [{ scale: 0.7 + seeded(index, 3) * 0.6 }] }]} />
            ))}
            {LANDMARKS.map((landmark) => {
              const spot = SPOT_BY_ID[landmark.spotId];
              const { x, y } = project(spot.latitude, spot.longitude);
              if (landmark.kind === 'water') {
                return (
                  <View key={landmark.spotId} style={[styles.abs, { left: x - landmark.w / 2, top: y - landmark.h / 2 }]}>
                    <View style={{ width: landmark.w, height: landmark.h, borderRadius: landmark.h, backgroundColor: ground.water, borderWidth: 3, borderColor: withAlpha('#FFFFFF', night ? 0.15 : 0.6) }}>
                      <View style={[styles.wave, { top: '30%', left: '22%' }]} />
                      <View style={[styles.wave, { top: '55%', left: '45%' }]} />
                    </View>
                    <Text style={[styles.blockLabel, { color: night ? '#E8ECF8' : '#1F3B5A', width: landmark.w }]}>{landmark.label}</Text>
                  </View>
                );
              }
              if (landmark.kind === 'track') {
                return (
                  <View key={landmark.spotId} style={[styles.abs, { left: x - landmark.w / 2, top: y - landmark.h / 2 }]}>
                    <View style={{ width: landmark.w, height: landmark.h, borderRadius: landmark.h, backgroundColor: night ? '#5A2E2A' : '#E7806B', padding: 9 }}>
                      <View style={{ flex: 1, borderRadius: landmark.h, backgroundColor: night ? '#24402B' : '#8FD18F' }} />
                    </View>
                    <Text style={[styles.blockLabel, { color: night ? '#E8ECF8' : '#1F2A37', width: landmark.w }]}>{landmark.label}</Text>
                  </View>
                );
              }
              return <Block key={landmark.spotId} x={x} y={y} w={landmark.w} h={landmark.h} color={landmark.color} night={night} label={landmark.label} />;
            })}
            {visiblePins.map((pin) => (
              <AnimatedPin
                key={pin.id}
                x={pin.x}
                y={pin.y}
                kind={pin.kind}
                label={pin.label}
                count={pin.count}
                avatarUri={pin.avatarUri}
                dark={night}
                selected={selectedId === pin.id || pin.spots.some((spot) => spot.id === selectedId)}
                onPress={() => select(pin.id)}
              />
            ))}
          </Animated.View>
        </GestureDetector>
        {/* Rain, leaves and stars drift over the map too. */}
        {condition !== 'sunny' ? <WeatherBackdrop condition={condition} style={styles.overlay} transparent /> : null}

        <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top + 8, paddingHorizontal: gutter }]}>
          <GlassIconButton accessibilityLabel="ย้อนกลับ" icon="chevron.left" iconColor={colors.ink} iconSize={18} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} size={44} fallbackBackgroundColor={surface} />
          <View style={[styles.titlePill, { backgroundColor: glass ? 'transparent' : surface }]}>
            <GlassBackground style={{ borderRadius: 22 }} />
            <Text style={[styles.title, { color: colors.ink }]}>แผนที่ ม.อ.</Text>
            <View style={[styles.weatherChip, { backgroundColor: withAlpha(theme.accent, 0.18) }]}>
              <FeatureIcon name={theme.icon} size={13} color={theme.accent} />
              <Text style={[styles.weatherText, { color: colors.ink }]}>{theme.label}{temperature != null ? ` ${temperature}°` : ''}</Text>
            </View>
          </View>
          <GlassIconButton accessibilityLabel="กลับไปกลางแผนที่" icon="scope" iconColor={colors.ink} iconSize={18} onPress={() => centerOn({ x: contentW / 2, y: contentH / 2 })} size={44} fallbackBackgroundColor={surface} />
        </View>
      </View>

      {/* ---- Bottom cards panel (drag the handle to expand) ---- */}
      <Animated.View style={[styles.panel, { backgroundColor: surface, paddingBottom: insets.bottom }, panelStyle]}>
        <GestureDetector gesture={panelPan}>
          <View>
            <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.outlineVariant || colors.line }]} /></View>
            <View style={[styles.panelHeader, { paddingHorizontal: gutter }]}>
              <CampusMascotWidget size={46} bubbleTone={isDark ? 'dark' : 'light'} onShowSpot={(spot) => { setFilter('all'); setSelectedId(spot.id); }} />
            </View>
          </View>
        </GestureDetector>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filters, { paddingHorizontal: gutter }]}>
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setFilter(item.id)}
                style={[styles.filterChip, { backgroundColor: active ? colors.primary : colors.chipIdle }]}>
                <FeatureIcon name={item.icon} size={14} color={active ? '#FFFFFF' : colors.inkMuted} />
                <Text numberOfLines={1} style={[styles.filterText, { color: active ? '#FFFFFF' : colors.inkMuted }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 24, gap: 8 }}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.inkMuted }]}>{filter === 'appointment' ? 'ยังไม่มีนัดที่ระบุจุดบนแผนที่' : 'ไม่พบสถานที่ในหมวดนี้'}</Text>}
          renderItem={({ item }) => {
            const meta = PIN_KINDS[item.kind] || PIN_KINDS.chill;
            const active = selectedId === item.pinId || selectedId === item.id;
            return (
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${item.subtitle}`} onPress={() => { if (item.pinId) select(item.pinId); }}
                style={({ pressed }) => [styles.card, { backgroundColor: active ? withAlpha(meta.color, 0.14) : colors.canvas, borderColor: active ? meta.color : 'transparent' }, pressed && { opacity: 0.8 }]}>
                <View style={[styles.cardIcon, { backgroundColor: withAlpha(meta.color, 0.16) }]}><FeatureIcon name={meta.icon} size={18} color={meta.color} /></View>
                <View style={styles.cardCopy}>
                  <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.ink }]}>{item.title}</Text>
                  {item.subtitle ? <Text numberOfLines={1} style={[styles.cardSubtitle, { color: colors.inkMuted }]}>{item.subtitle}</Text> : null}
                </View>
                {item.rating ? <View style={styles.rating}><FeatureIcon name="star.fill" size={11} color="#F5B301" /><Text style={[styles.ratingText, { color: colors.ink }]}>{item.rating}</Text></View> : null}
              </Pressable>
            );
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  abs: { position: 'absolute' },
  mapViewport: { width: '100%', overflow: 'hidden' },
  ground: { ...StyleSheet.absoluteFillObject, margin: 24, borderRadius: 48 },
  overlay: { zIndex: 1 },
  road: { position: 'absolute', height: 14, borderRadius: 7 },
  tree: { position: 'absolute', width: 14, height: 14, borderRadius: 7, opacity: 0.9 },
  wave: { position: 'absolute', width: 26, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  blockShadow: { position: 'absolute', borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.16)' },
  roofLine: { position: 'absolute', top: 5, left: 6, right: 6, height: 3, borderRadius: 2 },
  blockLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800', textAlign: 'center', marginTop: 3 },
  topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5 },
  titlePill: { flex: 1, minHeight: 44, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, overflow: 'hidden' },
  title: { fontSize: 16, fontWeight: '800' },
  weatherChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 1 },
  weatherText: { fontSize: 12, fontWeight: '700' },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: 'continuous',
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 16, zIndex: 10,
  },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  panelHeader: { paddingBottom: 8 },
  filters: { gap: 8, paddingBottom: 10 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19 },
  filterText: { fontSize: 13, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, borderCurve: 'continuous', borderWidth: 1.5 },
  cardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardSubtitle: { fontSize: 12, marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 12, fontWeight: '700' },
  empty: { textAlign: 'center', paddingVertical: 24, fontSize: 14 },
});
