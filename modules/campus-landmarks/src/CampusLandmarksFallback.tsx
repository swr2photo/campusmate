import * as React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CampusLandmarksViewProps } from './CampusLandmarks.types';

export default function CampusLandmarksFallback({
  title = 'สถานที่และคอลเลกชัน',
  colorScheme,
  tintColor,
  style,
  onClose,
  testID,
}: CampusLandmarksViewProps) {
  const systemScheme = useColorScheme();
  const dark = (colorScheme ?? systemScheme) === 'dark';
  const foreground = dark ? '#F7F8FA' : '#25272B';
  const secondary = dark ? '#B6BDC8' : '#6B7078';
  const primary = tintColor ?? (dark ? '#62A8FF' : '#2869C7');

  return (
    <SafeAreaView style={[styles.container, style]} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.message}>
          <Text accessibilityRole="header" style={[styles.title, { color: foreground }]}>{title}</Text>
          <Text style={[styles.body, { color: secondary }]}>
            {Platform.OS === 'ios'
              ? 'เปิดหน้านี้ใน CampusMate รุ่นที่ติดตั้งส่วนสถานที่แล้ว เพื่อสำรวจสถานที่ บันทึกรายการโปรด และจัดคอลเลกชัน'
              : 'สถานที่และคอลเลกชันพร้อมใช้งานใน CampusMate บน iOS'}
          </Text>
          {onClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="กลับไปหน้ากิจกรรม"
              onPress={onClose}
              style={({ pressed }) => [styles.backButton, { borderColor: primary, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.backLabel, { color: primary }]}>กลับไปหน้ากิจกรรม</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  message: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 27 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  backLabel: { fontSize: 17, fontWeight: '600' },
});
