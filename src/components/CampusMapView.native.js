import Text from './AppText';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { CAMPUS_CENTER, externalMapUrl, getSpotCoordinates } from '../utils/mapCoordinates';
import { useTheme } from '../theme';

export function openInExternalMaps(spot) {
  return Linking.openURL(externalMapUrl(spot)).catch(() => {});
}

export default function CampusMapView({ spots = [], selectedSpot, onSelectSpot, onScheduleSpot, style, height = 360 }) {
  const { colors, isDark } = useTheme();
  const map = useRef(null);
  const [selectedId, setSelectedId] = useState(selectedSpot?.id || null);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [myLocation, setMyLocation] = useState(null);
  const configured = Platform.OS === 'android'
    ? Constants.expoConfig?.extra?.androidMapsConfigured : Constants.expoConfig?.extra?.iosMapsConfigured;
  const pins = useMemo(() => spots.filter((spot) => getSpotCoordinates(spot)), [spots]);
  const selected = pins.find((spot) => spot.id === selectedId) || (selectedSpot?.id === selectedId ? selectedSpot : null);
  const initial = getSpotCoordinates(selectedSpot) || CAMPUS_CENTER;
  useEffect(() => {
    if (!configured || loaded) return undefined;
    const timeout = setTimeout(() => setError('โหลดแผนที่ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง'), 15000);
    return () => clearTimeout(timeout);
  }, [configured, loaded, retry]);
  useEffect(() => { setSelectedId(selectedSpot?.id || null); }, [selectedSpot?.id]);
  useEffect(() => {
    const point = getSpotCoordinates(selected);
    if (ready && point) map.current?.animateToRegion({ ...point, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 400);
  }, [ready, selected?.id, selected?.latitude, selected?.longitude, selected?.lat, selected?.lng]);

  const recenter = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('อนุญาตตำแหน่งเพื่อเลื่อนไปยังตำแหน่งของคุณ');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMyLocation(position.coords);
      map.current?.animateToRegion({ ...position.coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
      setError('');
    } catch (reason) { setError(reason.message || 'หาตำแหน่งไม่ได้'); }
    finally { setLocating(false); }
  };
  return <View style={[styles.container, { height, backgroundColor: colors.canvas }, style]}>
    {configured ? <MapView key={retry} ref={map} style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE}
      initialRegion={{ ...initial, latitudeDelta: 0.016, longitudeDelta: 0.016 }} userInterfaceStyle={isDark ? 'dark' : 'light'}
      onMapReady={() => setReady(true)} onMapLoaded={() => { setLoaded(true); setError(''); }}
      showsMyLocationButton={false} toolbarEnabled={false}>
      {pins.map((spot) => <Marker key={spot.id} coordinate={getSpotCoordinates(spot)} title={spot.name}
        pinColor={selectedId === spot.id ? colors.primary : '#F47C6B'} onPress={() => setSelectedId(spot.id)} />)}
      {myLocation ? <Marker coordinate={myLocation} title="ตำแหน่งของคุณ" pinColor="#247CF0" /> : null}
    </MapView> : <View style={styles.fallback}>
      <FeatureIcon name="map.fill" size={32} color={colors.inkMuted} />
      <Text style={{ color: colors.ink, textAlign: 'center' }}>แผนที่ยังไม่พร้อมในแอปเวอร์ชันนี้</Text>
      <Text style={{ color: colors.inkMuted, textAlign: 'center' }}>เลือกสถานที่จากรายการ หรือเปิดใน Google Maps ได้</Text>
      <Pressable accessibilityRole="button" onPress={() => openInExternalMaps(selectedSpot)} style={[styles.button, { backgroundColor: colors.primary }]}>
        <Text style={{ color: colors.onPrimary }}>เปิด Google Maps</Text>
      </Pressable>
    </View>}
    {configured && !loaded && !error ? <View pointerEvents="none" style={[styles.loading, { backgroundColor: colors.card }]}>
      <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.ink }}>กำลังโหลดแผนที่...</Text>
    </View> : null}
    {configured ? <Pressable accessibilityRole="button" accessibilityLabel="ไปยังตำแหน่งของฉัน" disabled={locating}
      onPress={recenter} style={[styles.recenter, { backgroundColor: colors.card }]}>
      {locating ? <ActivityIndicator color={colors.primary} /> : <FeatureIcon name="location.fill" color={colors.primary} size={22} />}
    </Pressable> : null}
    {error ? <View style={[styles.notice, { backgroundColor: colors.card }]}>
      <Text style={{ color: colors.ink }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setError(''); setLoaded(false); setReady(false); setRetry((value) => value + 1); }}>
        <Text style={{ color: colors.primary }}>ลองอีกครั้ง</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => openInExternalMaps(selected || selectedSpot)}>
        <Text style={{ color: colors.primary }}>เปิดแผนที่ภายนอก</Text>
      </Pressable>
    </View> : null}
    {selected ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardPhotoWrap}>
          <PlacePhoto spot={selected} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.cardDetails}>
          <Text style={[styles.cardName, { color: colors.ink }]} numberOfLines={1}>{selected.name}</Text>
          <Text numberOfLines={2} style={[styles.cardDesc, { color: colors.inkMuted }]}>{selected.description || selected.categoryLabel}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {onSelectSpot ? <Pressable accessibilityRole="button" onPress={() => onSelectSpot(selected)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={{ color: colors.onPrimary }}>เลือกสถานที่</Text></Pressable> : null}
        {onScheduleSpot ? <Pressable accessibilityRole="button" onPress={() => onScheduleSpot(selected)} style={styles.button}><Text style={{ color: colors.primary }}>นัดหมาย</Text></Pressable> : null}
        <Pressable accessibilityRole="button" onPress={() => openInExternalMaps(selected)} style={styles.button}><Text style={{ color: colors.primary }}>เส้นทาง</Text></Pressable>
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 18 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loading: { position: 'absolute', top: 12, left: 12, padding: 12, flexDirection: 'row', gap: 8, borderRadius: 12 },
  recenter: { position: 'absolute', right: 12, top: 12, padding: 12, borderRadius: 24 },
  notice: { position: 'absolute', top: 66, left: 12, right: 12, padding: 14, gap: 8, borderRadius: 14 },
  card: { position: 'absolute', bottom: 16, left: 12, right: 12, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  cardHeaderRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardPhotoWrap: { width: 62, height: 62, borderRadius: 12, overflow: 'hidden' },
  cardDetails: { flex: 1, gap: 3 },
  cardName: { fontWeight: '700', fontSize: 15 },
  cardDesc: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
});
