import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDecay, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
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
// Top bar: 44 pt controls this far below the status bar.
const TOP_BAR_HEIGHT = 44;
const TOP_BAR_GAP = 12;
// How much of the map the collapsed bottom panel covers.
const PANEL_OVERLAP = 28;
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
// The same weather in the app's dark theme: a dim campus that still shows
// whether it is sunny or raining.
const GROUND_DARK = {
  sunny: { grass: '#182A20', water: '#1E3D59', road: '#30363B', top: '#283040', tree: '#23452F' },
  cloudy: { grass: '#1B2824', water: '#213C53', road: '#31373B', top: '#283040', tree: '#284637' },
  rainy: { grass: '#16221F', water: '#1A3248', road: '#2B3135', top: '#262D3A', tree: '#1F3C2E' },
  night: GROUND.night,
};

// Name tags: at most two lines this wide, never stacked on one another.
const LABEL_MAX = 132;
const LABEL_GAP = 4;
// Pins closer than this would cover each other's icons.
const PIN_GAP = 50;

/** `hex` mixed toward the dark ground by `amount` (0..1). */
function shade(hex, amount) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const mix = (channel, target) => Math.round(channel + (target - channel) * amount);
  const r = mix((value >> 16) & 255, 0x1A);
  const g = mix((value >> 8) & 255, 0x20);
  const b = mix(value & 255, 0x2E);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Rough tag size; Thai combining marks make this an overestimate, which is safe. */
function labelSize(label) {
  const natural = 18 + label.length * 6.4;
  return { width: Math.min(LABEL_MAX, natural), height: natural > LABEL_MAX ? 40 : 24 };
}

/** Places each tag below its landmark, moving it down past any tag already placed. */
function placeLabels(items) {
  const placed = [];
  return items.map((item) => {
    const { width, height } = labelSize(item.label);
    let top = item.y;
    for (let moved = true; moved;) {
      moved = false;
      for (const other of placed) {
        const overlaps = item.x - width / 2 < other.right && other.left < item.x + width / 2 && top < other.bottom && other.top < top + height;
        if (overlaps) { top = other.bottom + LABEL_GAP; moved = true; }
      }
    }
    const rect = { left: item.x - width / 2, right: item.x + width / 2, top, bottom: top + height };
    placed.push(rect);
    return { ...item, top };
  });
}

/** Nudges pins apart until none covers another, keeping each near its place. */
function spreadPins(pins) {
  const out = pins.map((pin) => ({ ...pin }));
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const distance = Math.hypot(dx, dy);
        if (distance >= PIN_GAP) continue;
        // Coincident pins separate sideways.
        const [ux, uy] = distance ? [dx / distance, dy / distance] : [1, 0];
        const push = (PIN_GAP - distance) / 2;
        out[i].x -= ux * push; out[i].y -= uy * push;
        out[j].x += ux * push; out[j].y += uy * push;
      }
    }
  }
  return out;
}

function pinKind(category) {
  if (category === 'cafe' || category === 'study' || category === 'running' || category === 'gym') return category;
  if (category === 'sports') return 'sports';
  return 'chill';
}

function seeded(index, salt) {
  const x = Math.sin(index * 91.7 + salt * 47.3) * 9631.17;
  return x - Math.floor(x);
}

/** Block height below the roof, shared with the tag placement. */
const blockDepth = (h) => Math.round(h * 0.38);

// Names are drawn separately (MapLabel) so they can wrap and avoid each other.
function Block({ x, y, w, h, color, dark, lit }) {
  const depth = blockDepth(h);
  const roof = dark ? shade(color, 0.62) : color;
  // Lit windows are a night detail; the dark theme by day keeps them dim.
  const windowColor = (index) => (lit ? (seeded(index, w) > 0.35 ? '#FFD66B' : '#3B4458') : dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)');
  return (
    <View pointerEvents="none" style={[styles.abs, { left: x - w / 2, top: y - h / 2 }]}>
      <View style={[styles.blockShadow, { width: w * 1.05, height: h * 0.5, top: h * 0.7 + depth * 0.6, left: w * 0.06 }]} />
      <View style={{ width: w, height: h, borderRadius: 10, backgroundColor: roof, borderWidth: 1.5, borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)' }}>
        <View style={[styles.roofLine, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.55)' }]} />
      </View>
      {/* Front face: a darker band below the roof gives the block its height. */}
      <View style={{ width: w, height: depth, marginTop: -8, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: dark ? shade(color, 0.8) : withAlpha(color, 1), opacity: dark ? 1 : 0.62, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 5, paddingTop: 10, overflow: 'hidden' }}>
        {Array.from({ length: Math.max(3, Math.round(w / 14)) }, (_, index) => (
          <View key={index} style={{ width: 6, height: 5, borderRadius: 1, backgroundColor: windowColor(index) }} />
        ))}
      </View>
    </View>
  );
}

/** A landmark's name on its own backing, readable over grass, roads and trees. */
function MapLabel({ x, top, label, dark }) {
  return (
    <View pointerEvents="none" style={[styles.labelAnchor, { left: x - LABEL_MAX / 2, top }]}>
      <View style={[styles.labelPill, dark ? styles.labelPillDark : styles.labelPillLight]}>
        <Text numberOfLines={2} style={[styles.labelText, { color: dark ? '#EEF2FA' : '#1F2A37' }]}>{label}</Text>
      </View>
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
  // The map follows the app's dark theme as well as the weather's night.
  const dark = isDark || night;
  const sky = (isDark ? theme.gradientDark : theme.gradient)[0];
  const ground = (isDark ? GROUND_DARK : GROUND)[condition] || (isDark ? GROUND_DARK.sunny : GROUND.sunny);

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

  // Every pin's on-map position, spread so neighbours never cover each other.
  const placedPins = useMemo(() => spreadPins([...spotPins, ...appointmentPins]), [appointmentPins, spotPins]);
  const placedById = useMemo(() => new Map(placedPins.map((pin) => [pin.id, pin])), [placedPins]);

  const visiblePins = useMemo(() => {
    const pins = filter === 'appointment' ? appointmentPins
      : [...(filter === 'all' ? spotPins : spotPins.filter((pin) => pin.kind === filter || (filter === 'sports' && ['sports', 'gym', 'running'].includes(pin.kind)))),
        ...(filter === 'all' ? appointmentPins : [])];
    return pins.map((pin) => placedById.get(pin.id) || pin);
  }, [appointmentPins, filter, placedById, spotPins]);

  // Landmark names sit under their building or ground shape.
  const labels = useMemo(() => placeLabels(LANDMARKS.map((landmark) => {
    const spot = SPOT_BY_ID[landmark.spotId];
    const { x, y } = project(spot.latitude, spot.longitude);
    const bottom = landmark.kind ? landmark.h / 2 : landmark.h / 2 + blockDepth(landmark.h) - 8;
    return { id: landmark.spotId, label: landmark.label, x, y: y + bottom + 6 };
  })), [project]);

  // ---- Map panning -------------------------------------------------------
  // The top bar and the bottom panel float over the map; the map can be
  // dragged until its edges clear them, so no pin is stuck underneath.
  const topReserve = insets.top + TOP_BAR_GAP + TOP_BAR_HEIGHT + 8;
  const visibleBottom = mapHeight - PANEL_OVERLAP;
  const minX = width - contentW;
  const minY = visibleBottom - contentH;
  const maxY = topReserve;
  const clampX = (value) => Math.min(0, Math.max(minX, value));
  const clampY = (value) => Math.min(maxY, Math.max(minY, value));
  const tx = useSharedValue(clampX(width / 2 - contentW / 2));
  const ty = useSharedValue(clampY(mapHeight / 2 - contentH / 2));
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const centerOn = useCallback((pin) => {
    if (!pin) return;
    tx.set(withSpring(Math.min(0, Math.max(width - contentW, width / 2 - pin.x)), motion.spring.gentle));
    ty.set(withSpring(Math.min(maxY, Math.max(minY, (topReserve + visibleBottom) / 2 - pin.y)), motion.spring.gentle));
  }, [contentW, maxY, minY, topReserve, tx, ty, visibleBottom, width]);

  const pan = useMemo(() => Gesture.Pan()
    .onStart(() => { startX.set(tx.get()); startY.set(ty.get()); })
    .onUpdate((event) => {
      tx.set(Math.min(0, Math.max(minX, startX.get() + event.translationX)));
      ty.set(Math.min(maxY, Math.max(minY, startY.get() + event.translationY)));
    })
    .onEnd((event) => {
      tx.set(withDecay({ velocity: event.velocityX, clamp: [minX, 0] }));
      ty.set(withDecay({ velocity: event.velocityY, clamp: [minY, maxY] }));
    }), [maxY, minX, minY, startX, startY, tx, ty]);
  const mapStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }] }));

  useEffect(() => {
    if (!selectedId) return;
    centerOn(placedPins.find((pin) => pin.id === selectedId || pin.spots.some((spot) => spot.id === selectedId)));
    // Center only when the selection changes, not when pins are recomputed.
  }, [selectedId]);

  const select = (id) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedId((current) => (current === id ? null : id));
  };

  // ---- Bottom panel ------------------------------------------------------
  const collapsedTop = mapHeight - PANEL_OVERLAP;
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
      {/* Light icons over a night or dark-theme sky, dark ones over a bright sky. */}
      <StatusBar style={dark ? 'light' : 'dark'} />
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
                  <View key={landmark.spotId} pointerEvents="none" style={[styles.abs, { left: x - landmark.w / 2, top: y - landmark.h / 2 }]}>
                    <View style={{ width: landmark.w, height: landmark.h, borderRadius: landmark.h, backgroundColor: ground.water, borderWidth: 3, borderColor: withAlpha('#FFFFFF', dark ? 0.15 : 0.6) }}>
                      <View style={[styles.wave, { top: '30%', left: '22%' }, dark && styles.waveDark]} />
                      <View style={[styles.wave, { top: '55%', left: '45%' }, dark && styles.waveDark]} />
                    </View>
                  </View>
                );
              }
              if (landmark.kind === 'track') {
                return (
                  <View key={landmark.spotId} pointerEvents="none" style={[styles.abs, { left: x - landmark.w / 2, top: y - landmark.h / 2 }]}>
                    <View style={{ width: landmark.w, height: landmark.h, borderRadius: landmark.h, backgroundColor: dark ? '#5A2E2A' : '#E7806B', padding: 9 }}>
                      <View style={{ flex: 1, borderRadius: landmark.h, backgroundColor: dark ? '#24402B' : '#8FD18F' }} />
                    </View>
                  </View>
                );
              }
              return <Block key={landmark.spotId} x={x} y={y} w={landmark.w} h={landmark.h} color={landmark.color} dark={dark} lit={night} />;
            })}
            {labels.map((item) => <MapLabel key={`label-${item.id}`} x={item.x} top={item.top} label={item.label} dark={dark} />)}
            {visiblePins.map((pin) => (
              <AnimatedPin
                key={pin.id}
                x={pin.x}
                y={pin.y}
                kind={pin.kind}
                label={pin.label}
                count={pin.count}
                avatarUri={pin.avatarUri}
                dark={dark}
                selected={selectedId === pin.id || pin.spots.some((spot) => spot.id === selectedId)}
                onPress={() => select(pin.id)}
              />
            ))}
          </Animated.View>
        </GestureDetector>
        {/* Rain, leaves and stars drift over the map too. */}
        {condition !== 'sunny' ? <WeatherBackdrop condition={condition} style={styles.overlay} transparent /> : null}

        {/* The status bar and top bar sit on the sky colour, not on the map. */}
        <LinearGradient pointerEvents="none" colors={[withAlpha(sky, 0.96), withAlpha(sky, 0.7), withAlpha(sky, 0)]} locations={[0, 0.6, 1]}
          style={[styles.topScrim, { height: topReserve + 28 }]} />
        <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top + TOP_BAR_GAP, paddingHorizontal: gutter }]}>
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
  ground: { ...StyleSheet.absoluteFill, margin: 24, borderRadius: 48 },
  overlay: { zIndex: 1 },
  road: { position: 'absolute', height: 14, borderRadius: 7 },
  tree: { position: 'absolute', width: 14, height: 14, borderRadius: 7, opacity: 0.9 },
  wave: { position: 'absolute', width: 26, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  waveDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  blockShadow: { position: 'absolute', borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.16)' },
  roofLine: { position: 'absolute', top: 5, left: 6, right: 6, height: 3, borderRadius: 2 },
  labelAnchor: { position: 'absolute', width: LABEL_MAX, alignItems: 'center' },
  labelPill: {
    maxWidth: LABEL_MAX, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 2,
  },
  labelPillLight: { backgroundColor: 'rgba(255,255,255,0.94)', borderColor: 'rgba(0,0,0,0.06)', shadowOpacity: 0.12 },
  labelPillDark: { backgroundColor: 'rgba(20,24,36,0.9)', borderColor: 'rgba(255,255,255,0.1)', shadowOpacity: 0.3 },
  labelText: { fontSize: 11.5, fontWeight: '800', textAlign: 'center' },
  topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5 },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4 },
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
