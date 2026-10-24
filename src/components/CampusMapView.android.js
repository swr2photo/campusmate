import { Pressable } from './NativePressable';
import Text from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { PIN_KINDS } from './map/AnimatedPin';
import { CAMPUS_CENTER, externalMapUrl, getSpotCoordinates } from '../utils/mapCoordinates';
import { useTheme } from '../theme';

// Android campus map (Material 3). Google Maps draws the tiles; when it
// cannot (no API key in this build, a key not authorised for this signature,
// no Play services, or no network) the sheet stays useful: the place cards
// keep working and the in-app campus map and Google Maps are one tap away.

// Android reports onMapLoaded only once tiles have rendered. An auth failure
// never gets there and leaves a blank grey map, so this long without it
// means the map is not coming.
const TILE_TIMEOUT_MS = 10000;
// Custom markers are bitmaps on Android; let them redraw briefly after a change.
const MARKER_REDRAW_MS = 600;
const CARD_GAP = 12;
const SIDE = 16;

export function openInExternalMaps(spot) {
  return Linking.openURL(externalMapUrl(spot)).catch(() => {});
}

const kindOf = (spot) => PIN_KINDS[spot?.category] || PIN_KINDS.chill;

export default function CampusMapView({ spots = [], selectedSpot, onSelectSpot, onScheduleSpot, onOpenCampusMap, style, height = 360 }) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReducedMotion();
  const map = useRef(null);
  const list = useRef(null);
  const configured = Boolean(Constants.expoConfig?.extra?.androidMapsConfigured);
  const [status, setStatus] = useState(configured ? 'loading' : 'unavailable');
  const [mapReady, setMapReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(selectedSpot?.id || null);
  const [redraw, setRedraw] = useState(true);
  const [width, setWidth] = useState(0);
  const [locating, setLocating] = useState(false);
  const [myLocation, setMyLocation] = useState(null);
  const [notice, setNotice] = useState('');

  const pins = useMemo(() => spots.filter((spot) => getSpotCoordinates(spot)), [spots]);
  const categories = useMemo(() => {
    const counts = new Map();
    for (const spot of pins) counts.set(spot.category, (counts.get(spot.category) || 0) + 1);
    return [...counts.entries()].filter(([id]) => PIN_KINDS[id]).map(([id, count]) => ({ id, count, ...PIN_KINDS[id] }));
  }, [pins]);
  const shown = useMemo(() => (filter === 'all' ? pins : pins.filter((spot) => spot.category === filter)), [filter, pins]);
  const selectedIndex = Math.max(0, shown.findIndex((spot) => spot.id === selectedId));
  const selected = shown[selectedIndex] || null;
  const cardWidth = Math.max(0, width - SIDE * 2);
  const duration = reduceMotion ? 0 : 400;

  // Tiles: wait for onMapLoaded, give up after the timeout, recover if it
  // arrives late.
  useEffect(() => {
    if (!configured) return undefined;
    setStatus('loading');
    const timer = setTimeout(() => setStatus((now) => (now === 'loading' ? 'failed' : now)), TILE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [configured, retry]);
  useEffect(() => { if (selectedSpot?.id) setSelectedId(selectedSpot.id); }, [selectedSpot?.id]);
  // A target hidden by the filter brings every place back.
  useEffect(() => {
    if (selectedSpot?.id && filter !== 'all' && selectedSpot.category !== filter) setFilter('all');
  }, [selectedSpot?.id]);
  useEffect(() => {
    setRedraw(true);
    const timer = setTimeout(() => setRedraw(false), MARKER_REDRAW_MS);
    return () => clearTimeout(timer);
  }, [selectedId, filter, isDark, mapReady]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const focus = useCallback((spot) => {
    const point = getSpotCoordinates(spot);
    if (mapReady && point) map.current?.animateToRegion({ ...point, latitudeDelta: 0.005, longitudeDelta: 0.005 }, duration);
  }, [duration, mapReady]);
  useEffect(() => { if (selected) focus(selected); }, [selected?.id, mapReady]);

  const select = (spot, { scroll = true } = {}) => {
    setSelectedId(spot.id);
    const index = shown.findIndex((item) => item.id === spot.id);
    if (scroll && index >= 0 && cardWidth) list.current?.scrollToIndex({ index, animated: !reduceMotion });
  };
  const showAll = () => {
    const points = shown.map(getSpotCoordinates).filter(Boolean);
    if (!mapReady || !points.length) return;
    map.current?.fitToCoordinates(points, { edgePadding: { top: 120, right: 72, bottom: 220, left: 48 }, animated: !reduceMotion });
  };
  const recenter = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('อนุญาตตำแหน่งเพื่อดูว่าคุณอยู่ตรงไหน');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMyLocation(position.coords);
      map.current?.animateToRegion({ latitude: position.coords.latitude, longitude: position.coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, duration);
    } catch (reason) { setNotice(reason?.message || 'หาตำแหน่งไม่ได้'); }
    finally { setLocating(false); }
  };
  const changeFilter = (id) => {
    setFilter(id);
    const first = id === 'all' ? pins[0] : pins.find((spot) => spot.category === id);
    if (first) setSelectedId(first.id);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const mapUsable = configured && status !== 'failed';
  const initial = getSpotCoordinates(selectedSpot) || CAMPUS_CENTER;

  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.container, { height, backgroundColor: colors.surfaceContainerLow || colors.canvas }, style]}>
    {configured ? <MapView key={retry} ref={map} style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      initialRegion={{ ...initial, latitudeDelta: 0.012, longitudeDelta: 0.012 }} userInterfaceStyle={isDark ? 'dark' : 'light'}
      onMapReady={() => setMapReady(true)}
      onMapLoaded={() => setStatus('ready')}
      mapPadding={{ top: 64, right: 0, bottom: 200, left: 0 }}
      showsMyLocationButton={false} toolbarEnabled={false} showsCompass={false}>
      {shown.map((spot) => {
        const kind = kindOf(spot);
        const active = spot.id === selectedId;
        return <Marker key={spot.id} coordinate={getSpotCoordinates(spot)} onPress={() => select(spot)}
          anchor={{ x: 0.5, y: 1 }} tracksViewChanges={redraw} zIndex={active ? 2 : 1}
          accessibilityLabel={`${spot.name} ${kind.label}`}>
          <View style={styles.markerWrap}>
            <View style={[styles.marker, active && styles.markerActive, { backgroundColor: kind.color, borderColor: active ? colors.primary : '#FFFFFF' }]}>
              <FeatureIcon color="#FFFFFF" name={kind.icon} size={active ? 20 : 15} />
            </View>
            <View style={[styles.markerTail, { borderTopColor: active ? colors.primary : '#FFFFFF' }]} />
          </View>
        </Marker>;
      })}
      {myLocation ? <Marker coordinate={myLocation} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={redraw} accessibilityLabel="ตำแหน่งของคุณ">
        <View style={styles.me}><View style={[styles.meDot, { backgroundColor: colors.primary }]} /></View>
      </Marker> : null}
    </MapView> : null}

    {/* Filters */}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chips}>
      {[{ id: 'all', label: 'ทั้งหมด', icon: 'map.fill', count: pins.length }, ...categories].map((chip) => {
        const on = chip.id === filter;
        return <Pressable key={chip.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${chip.label} ${chip.count} แห่ง`}
          android_ripple={{ color: colors.outlineVariant || colors.line }} onPress={() => changeFilter(chip.id)}
          style={[styles.chip, { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.outlineVariant || colors.line }]}>
          <FeatureIcon color={on ? colors.onPrimary : chip.color || colors.primary} name={chip.icon} size={16} />
          <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.ink }]}>{chip.label}</Text>
          <Text style={[styles.chipCount, { color: on ? colors.onPrimary : colors.inkMuted }]}>{chip.count}</Text>
        </Pressable>;
      })}
    </ScrollView>

    {/* Map controls */}
    {mapUsable ? <View style={styles.fabs}>
      <Pressable accessibilityRole="button" accessibilityLabel="ดูทั้งวิทยาเขต" disabled={!mapReady} android_ripple={{ color: colors.outlineVariant || colors.line, borderless: true }}
        onPress={showAll} style={[styles.fab, { backgroundColor: colors.card }]}>
        <FeatureIcon color={colors.ink} name="scan-outline" size={22} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="ไปยังตำแหน่งของฉัน" disabled={locating || !mapReady} android_ripple={{ color: colors.outlineVariant || colors.line, borderless: true }}
        onPress={recenter} style={[styles.fab, { backgroundColor: colors.card }]}>
        {locating ? <ActivityIndicator color={colors.primary} /> : <FeatureIcon color={colors.primary} name="locate" size={22} />}
      </Pressable>
      {/* Some GPUs (emulators such as Nox) load the map but cannot draw it,
          which no callback reports; the illustrated map is always one tap away. */}
      {onOpenCampusMap ? <Pressable accessibilityRole="button" accessibilityLabel="ดูแผนผังวิทยาเขตในแอป" android_ripple={{ color: colors.outlineVariant || colors.line, borderless: true }}
        onPress={() => onOpenCampusMap(selected)} style={[styles.fab, { backgroundColor: colors.card }]}>
        <FeatureIcon color={colors.ink} name="layers-outline" size={22} />
      </Pressable> : null}
    </View> : null}

    {configured && status === 'loading' && !mapReady ? <View pointerEvents="none" style={[styles.loading, { backgroundColor: colors.card }]}>
      <ActivityIndicator color={colors.primary} size="small" /><Text style={[styles.loadingText, { color: colors.ink }]}>กำลังโหลดแผนที่</Text>
    </View> : null}

    {notice ? <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: colors.ink }]}>
      <Text style={[styles.noticeText, { color: colors.card }]}>{notice}</Text>
    </View> : null}

    {!mapUsable ? <MapUnavailable colors={colors} configured={configured}
      onCampusMap={onOpenCampusMap ? () => onOpenCampusMap(selected) : null}
      onExternal={() => openInExternalMaps(selected || selectedSpot)}
      onRetry={configured ? () => { setMapReady(false); setRetry((value) => value + 1); } : null} /> : null}

    {/* Places */}
    {cardWidth ? <FlatList ref={list} horizontal data={shown} keyExtractor={(spot) => spot.id}
      style={styles.cards} contentContainerStyle={{ paddingHorizontal: SIDE, gap: CARD_GAP }}
      showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + CARD_GAP} decelerationRate="fast" disableIntervalMomentum
      getItemLayout={(_, index) => ({ length: cardWidth + CARD_GAP, offset: (cardWidth + CARD_GAP) * index, index })}
      initialScrollIndex={selectedIndex} onScrollToIndexFailed={() => {}}
      onMomentumScrollEnd={(event) => {
        const index = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
        if (shown[index] && shown[index].id !== selectedId) select(shown[index], { scroll: false });
      }}
      renderItem={({ item }) => <PlaceCard colors={colors} spot={item} width={cardWidth} active={item.id === selectedId}
        onSelect={onSelectSpot} onSchedule={onScheduleSpot} />} /> : null}
  </View>;
}

function PlaceCard({ spot, width, active, colors, onSelect, onSchedule }) {
  const kind = kindOf(spot);
  const ripple = { color: colors.outlineVariant || colors.line };
  return <View style={[styles.card, { width, backgroundColor: colors.card, borderColor: active ? colors.primary : colors.outlineVariant || colors.line }]}>
    <View style={styles.cardTop}>
      <View style={styles.photo}><PlacePhoto spot={spot} style={StyleSheet.absoluteFill} /></View>
      <View style={styles.cardText}>
        <Text numberOfLines={1} style={[styles.cardName, { color: colors.ink }]}>{spot.name}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.kindPill, { backgroundColor: `${kind.color}22` }]}>
            <FeatureIcon color={kind.color} name={kind.icon} size={12} />
            <Text numberOfLines={1} style={[styles.kindText, { color: colors.ink }]}>{spot.categoryLabel || kind.label}</Text>
          </View>
          {spot.distance ? <Text style={[styles.meta, { color: colors.inkMuted }]}>{spot.distance}</Text> : null}
        </View>
        {spot.description ? <Text numberOfLines={1} style={[styles.meta, { color: colors.inkMuted }]}>{spot.description}</Text> : null}
      </View>
    </View>
    <View style={styles.cardActions}>
      {onSelect ? <Pressable accessibilityRole="button" accessibilityLabel={`เลือก ${spot.name}`} android_ripple={ripple} onPress={() => onSelect(spot)}
        style={[styles.action, styles.actionGrow, { backgroundColor: colors.primary }]}>
        <FeatureIcon color={colors.onPrimary} name="checkmark.circle.fill" size={18} />
        <Text style={[styles.actionText, { color: colors.onPrimary }]}>เลือกสถานที่</Text>
      </Pressable> : null}
      {onSchedule ? <Pressable accessibilityRole="button" accessibilityLabel={`นัดหมายที่ ${spot.name}`} android_ripple={ripple} onPress={() => onSchedule(spot)}
        style={[styles.action, styles.actionGrow, { backgroundColor: colors.surfaceContainerHigh || colors.surfaceRaised }]}>
        <FeatureIcon color={colors.primary} name="calendar" size={18} />
        <Text style={[styles.actionText, { color: colors.primary }]}>นัดหมาย</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`เส้นทางไป ${spot.name}`} android_ripple={{ ...ripple, borderless: true }} onPress={() => openInExternalMaps(spot)}
        style={[styles.iconAction, { borderColor: colors.outlineVariant || colors.line }]}>
        <FeatureIcon color={colors.primary} name="navigate" size={20} />
      </Pressable>
    </View>
  </View>;
}

function MapUnavailable({ colors, configured, onCampusMap, onExternal, onRetry }) {
  return <View style={styles.unavailableWrap} pointerEvents="box-none">
    <View accessibilityLiveRegion="polite" style={[styles.unavailable, { backgroundColor: colors.card, borderColor: colors.outlineVariant || colors.line }]}>
      <View style={[styles.unavailableIcon, { backgroundColor: colors.surfaceContainerHigh || colors.surfaceRaised }]}>
        <FeatureIcon color={colors.primary} name="map.fill" size={26} />
      </View>
      <Text style={[styles.unavailableTitle, { color: colors.ink }]}>{configured ? 'แผนที่ Google แสดงไม่ได้ในตอนนี้' : 'แผนที่ Google ไม่พร้อมในแอปเวอร์ชันนี้'}</Text>
      <Text style={[styles.unavailableBody, { color: colors.inkMuted }]}>เลือกสถานที่จากการ์ดด้านล่างได้ตามปกติ หรือดูแผนผังวิทยาเขตในแอปแทน</Text>
      {onCampusMap ? <Pressable accessibilityRole="button" onPress={onCampusMap} style={[styles.unavailableButton, { backgroundColor: colors.primary }]}>
        <FeatureIcon color={colors.onPrimary} name="map" size={18} />
        <Text style={[styles.actionText, { color: colors.onPrimary }]}>ดูแผนผังวิทยาเขต</Text>
      </Pressable> : null}
      <View style={styles.unavailableRow}>
        <Pressable accessibilityRole="button" onPress={onExternal} style={styles.textButton}>
          <Text style={[styles.actionText, { color: colors.primary }]}>เปิด Google Maps</Text>
        </Pressable>
        {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={styles.textButton}>
          <Text style={[styles.actionText, { color: colors.primary }]}>ลองอีกครั้ง</Text>
        </Pressable> : null}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 20 },
  chipsBar: { position: 'absolute', top: 12, left: 0, right: 0, flexGrow: 0 },
  chips: { gap: 8, paddingHorizontal: SIDE },
  chip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, overflow: 'hidden', elevation: 2 },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipCount: { fontSize: 13, fontWeight: '600' },
  fabs: { position: 'absolute', right: SIDE, top: 64, gap: 10 },
  fab: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  loading: { position: 'absolute', top: 64, left: SIDE, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, elevation: 2 },
  loadingText: { fontSize: 14, fontWeight: '600' },
  notice: { position: 'absolute', top: 64, left: SIDE, right: 76, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, elevation: 4 },
  noticeText: { fontSize: 14 },
  markerWrap: { alignItems: 'center' },
  marker: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  markerActive: { width: 42, height: 42, borderRadius: 21, borderWidth: 3 },
  markerTail: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -1 },
  me: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(40,105,199,0.22)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF' },
  unavailableWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 190 },
  unavailable: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 8, padding: 20, borderRadius: 24, borderWidth: 1, elevation: 2 },
  unavailableIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  unavailableTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  unavailableBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  unavailableButton: { minHeight: 48, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, marginTop: 8 },
  unavailableRow: { flexDirection: 'row', gap: 8 },
  textButton: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  cards: { position: 'absolute', left: 0, right: 0, bottom: 12, flexGrow: 0 },
  card: { borderRadius: 20, borderWidth: 1, padding: 12, gap: 12, elevation: 4 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 64, height: 64, borderRadius: 14, overflow: 'hidden' },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  cardName: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  kindPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, maxWidth: '70%' },
  kindText: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 24, overflow: 'hidden' },
  actionGrow: { flex: 1 },
  actionText: { fontSize: 15, fontWeight: '600' },
  iconAction: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
