import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Pressable } from '../NativePressable';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { Mascot } from '../illustrations';
import WeatherBackdrop from '../weather/WeatherBackdrop';
import { mascotLookFor } from '../weather/CampusMascotWidget';
import { useCampusWeather } from '../../context/WeatherContext';
import { useResponsiveSize } from '../../hooks/useResponsiveSize';
import { useTheme } from '../../theme';

/**
 * Top banner of "หาเพื่อน": live campus weather behind the mascot, how many
 * people are open to meeting up right now, and a shortcut to the campus map.
 * The count is the number of discoverable profiles actually loaded.
 */
export default function CampusVibeBanner({ count = 0, hasMore = false, style }) {
  const { isDark } = useTheme();
  const { condition, theme, temperature } = useCampusWeather();
  const { bannerHeight } = useResponsiveSize();
  const look = mascotLookFor(condition);
  const ink = isDark || condition === 'night' ? theme.inkDark : theme.ink;
  const mascotSize = Math.round(bannerHeight * 0.5);
  const people = count > 0 ? `${count}${hasMore ? '+' : ''} คน` : '';
  return (
    <View style={[styles.banner, { minHeight: bannerHeight }, style]}>
      <WeatherBackdrop condition={condition} dark={isDark} />
      <View style={styles.mascot}>
        <Mascot size={mascotSize} outfit={look.outfit} pose={look.pose} mood={look.mood} accessory={look.outfit === 'rain' ? 'none' : undefined} />
      </View>
      <View style={styles.copy}>
        <View style={styles.weatherRow}>
          <FeatureIcon name={theme.icon} size={13} color={ink} />
          <Text numberOfLines={1} style={[styles.weather, { color: ink }]}>{theme.label}ที่ ม.อ.{temperature != null ? ` · ${temperature}°` : ''}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.title, { color: ink }]}>
          {people ? `มีเพื่อน ${people} พร้อมหาเพื่อนทำกิจกรรม` : 'มาดูกันว่าวันนี้ใครว่างบ้าง'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="เปิดแผนที่ ม.อ."
        hitSlop={6}
        onPress={() => router.push('/campus-map')}
        style={({ pressed }) => [styles.mapButton, { backgroundColor: isDark || condition === 'night' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.78)' }, pressed && { opacity: 0.75 }]}
      >
        <FeatureIcon name="map.fill" size={16} color={theme.accent} />
        <Text style={[styles.mapText, { color: ink }]}>แผนที่</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden', paddingLeft: 4, paddingRight: 12, paddingVertical: 6 },
  mascot: { marginBottom: -6 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weather: { fontSize: 12, fontWeight: '700', opacity: 0.9 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  mapButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, minWidth: 48, paddingHorizontal: 12, borderRadius: 20 },
  mapText: { fontSize: 13, fontWeight: '800' },
});
