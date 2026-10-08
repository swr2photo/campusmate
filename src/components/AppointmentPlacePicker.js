import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
let MapView = null;
let Circle = null;
let Marker = null;
let PROVIDER_GOOGLE = null;
let isMapsSupported = false;

try {
  const Maps = require('react-native-maps');
  MapView = Maps.default || Maps;
  Circle = Maps.Circle;
  Marker = Maps.Marker;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
  isMapsSupported = Boolean(MapView);
} catch {
  isMapsSupported = false;
}

import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { resolveCampusPlace, searchCampusPlaces } from '../services/partyService';
import { isWithinPartyRadius, PARTY_RADIUS_METERS, PSU_HAT_YAI } from '../utils/campusRadius';
import { externalMapUrl, getSpotCoordinates } from '../utils/mapCoordinates';
import { radius, spacing, useTheme } from '../theme';

const pointOf = getSpotCoordinates;

export default function AppointmentPlacePicker({ visible, spots = [], initialSpot, onSelect, onClose }) {
  const { colors, isDark } = useTheme();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapRetry, setMapRetry] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setSelection(initialSpot && pointOf(initialSpot) ? initialSpot : null);
    setQuery('');
    setRemote([]);
    setError('');
    setMapLoaded(false);
    setMapError('');
  }, [visible, initialSpot?.id]);

  useEffect(() => {
    if (!visible || query.trim().length < 2) { setRemote([]); return undefined; }
    let active = true;
    const timeout = setTimeout(async () => {
      try {
        const results = await searchCampusPlaces(query.trim());
        if (active) { setRemote(results); setError(''); }
      } catch {
        if (active) { setRemote([]); setError('ค้นหา Google Places ไม่ได้ เลือกสถานที่ ม.อ. หรือปักหมุดได้'); }
      }
    }, 350);
    return () => { active = false; clearTimeout(timeout); };
  }, [query, visible]);

  const local = useMemo(() => spots.filter((spot) => {
    const point = pointOf(spot);
    return point && isWithinPartyRadius(point)
      && (!query.trim() || String(spot.name || '').toLowerCase().includes(query.trim().toLowerCase()));
  }).slice(0, 8), [spots, query]);
  const selectedPoint = pointOf(selection);
  const mapsAvailable = Boolean(isMapsSupported && (Platform.OS === 'ios'
    ? Constants.expoConfig?.extra?.iosMapsConfigured
    : Constants.expoConfig?.extra?.androidMapsConfigured));
  useEffect(() => {
    if (!visible || !mapsAvailable || mapLoaded) return undefined;
    const timeout = setTimeout(() => setMapError('โหลดแผนที่ไม่สำเร็จ'), 15000);
    return () => clearTimeout(timeout);
  }, [visible, mapsAvailable, mapLoaded, mapRetry]);

  const selectRemote = async (item) => {
    setBusy(true);
    try {
      const result = await resolveCampusPlace(item.placeId);
      if (!isWithinPartyRadius(result)) throw new Error('สถานที่อยู่นอกรัศมี 3 กม.');
      setSelection({
        id: `google-${item.placeId}`, name: result.name,
        latitude: result.latitude, longitude: result.longitude,
        location: { kind: 'google', placeId: item.placeId },
      });
      setError('');
    } catch (reason) { setError(reason?.message || 'เลือกสถานที่ไม่ได้'); }
    finally { setBusy(false); }
  };

  const selectPin = ({ nativeEvent }) => {
    const point = nativeEvent.coordinate;
    if (!isWithinPartyRadius(point)) {
      setError('จุดที่ปักต้องอยู่ภายใน 3 กม. จาก ม.อ. หาดใหญ่');
      return;
    }
    setSelection({
      id: `pin-${point.latitude.toFixed(6)}-${point.longitude.toFixed(6)}`,
      name: 'จุดที่ปักหมุด', ...point,
      location: { kind: 'pin', ...point, name: 'จุดที่ปักหมุด' },
    });
    setError('');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.page, { backgroundColor: colors.canvas }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="ย้อนกลับ" onPress={onClose} style={styles.headerButton}>
            <FeatureIcon name="chevron.left" size={22} color={colors.ink} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>เลือกสถานที่นัดหมาย</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <FeatureIcon name="magnifyingglass" size={18} color={colors.inkMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="ค้นหาสถานที่ในและรอบ ม.อ." placeholderTextColor={colors.inkSoft}
            style={[styles.input, { color: colors.ink }]} keyboardAppearance={isDark ? 'dark' : 'light'} accessibilityLabel="ค้นหาสถานที่" />
        </View>
        <View style={styles.mapWrap}>
          {mapsAvailable && visible ? <MapView key={mapRetry}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={{ ...PSU_HAT_YAI, latitudeDelta: 0.055, longitudeDelta: 0.055 }}
            onPress={selectPin}
            onMapLoaded={() => { setMapLoaded(true); setMapError(''); }}
          >
            <Circle center={PSU_HAT_YAI} radius={PARTY_RADIUS_METERS} strokeColor={colors.primary} fillColor="rgba(35,123,231,0.08)" />
            {selectedPoint ? <Marker coordinate={selectedPoint} title={selection.name} /> : null}
          </MapView> : <View style={[styles.mapUnavailable, { backgroundColor: colors.surfaceRaised }]}>
            <FeatureIcon name="map.fill" size={26} color={colors.inkMuted} />
            <Text style={[styles.mapUnavailableText, { color: colors.inkMuted }]}>แผนที่ยังไม่พร้อมในบิลด์นี้ เลือกสถานที่จากรายการได้</Text>
          </View>}
          {mapsAvailable ? <View pointerEvents="none" style={[styles.mapHint, { backgroundColor: colors.card }]}>
            <FeatureIcon name="mappin.circle.fill" size={15} color={colors.primary} />
            <Text style={[styles.mapHintText, { color: colors.ink }]}>แตะแผนที่เพื่อปักหมุด ภายใน 3 กม.</Text>
          </View> : null}
          {mapError ? <View style={[styles.mapNotice, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.ink }}>{mapError}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setMapLoaded(false); setMapError(''); setMapRetry((value) => value + 1); }}>
              <Text style={{ color: colors.primary }}>ลองอีกครั้ง</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => Linking.openURL(externalMapUrl(selection)).catch(() => setError('เปิดแผนที่ไม่ได้'))}>
              <Text style={{ color: colors.primary }}>เปิด Google Maps</Text>
            </Pressable>
          </View> : null}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.results} contentContainerStyle={styles.resultsContent}>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          {local.length ? <Text style={[styles.sectionTitle, { color: colors.inkMuted }]}>สถานที่ ม.อ.</Text> : null}
          {local.map((spot) => (
            <Pressable key={spot.id} onPress={() => { setSelection(spot); setError(''); }} style={[styles.result, { borderBottomColor: colors.line }]}>
              <View style={styles.resultPhotoWrap}>
                <PlacePhoto spot={spot} style={StyleSheet.absoluteFill} />
              </View>
              <Text style={[styles.resultText, { color: colors.ink }]} numberOfLines={2}>{spot.name}</Text>
            </Pressable>
          ))}
          {remote.length ? <Text style={[styles.sectionTitle, { color: colors.inkMuted }]}>ผลค้นหาจาก Google Maps</Text> : null}
          {remote.map((place) => (
            <Pressable key={place.placeId} onPress={() => selectRemote(place)} style={[styles.result, { borderBottomColor: colors.line }]}>
              <FeatureIcon name="magnifyingglass" size={18} color={colors.primary} />
              <Text style={[styles.resultText, { color: colors.ink }]} numberOfLines={2}>{place.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[styles.bottom, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
          <View style={styles.selectedRow}>
            {selection ? (
              <View style={styles.selectedPhotoWrap}>
                <PlacePhoto spot={selection} style={StyleSheet.absoluteFill} />
              </View>
            ) : null}
            <Text style={[styles.selectedLabel, { color: colors.ink }]} numberOfLines={1}>{selection?.name || 'ยังไม่ได้เลือกสถานที่'}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={!selectedPoint || busy} onPress={() => onSelect?.(selection)}
            style={[styles.confirm, { backgroundColor: colors.primary, opacity: !selectedPoint || busy ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={[styles.confirmText, { color: colors.onPrimary }]}>ใช้สถานที่นี้</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: 9, paddingHorizontal: 12, height: 46 },
  input: { flex: 1, fontSize: 15 },
  mapWrap: { height: '38%', overflow: 'hidden' },
  mapUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 9 },
  mapUnavailableText: { fontSize: 13, textAlign: 'center' },
  mapHint: { position: 'absolute', top: 11, alignSelf: 'center', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapHintText: { fontSize: 12, fontWeight: '700' },
  mapNotice: { position: 'absolute', top: 52, left: 12, right: 12, padding: 14, borderRadius: radius.lg, gap: 8 },
  results: { flex: 1 },
  resultsContent: { paddingHorizontal: spacing.lg, paddingBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 3 },
  result: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 52, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  resultPhotoWrap: { width: 38, height: 38, borderRadius: 8, overflow: 'hidden' },
  resultText: { flex: 1, fontSize: 14 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  bottom: { borderTopWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: 11, gap: 8 },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedPhotoWrap: { width: 34, height: 34, borderRadius: 8, overflow: 'hidden' },
  selectedLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  confirm: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, minHeight: 46 },
  confirmText: { fontSize: 15, fontWeight: '800' },
});
