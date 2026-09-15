import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';

export default function ProfileVisibilityScreen() {
  const { colors } = useTheme();
  const { profile, saveProfile } = useApp();
  const [discoverable, setDiscoverable] = useState(profile?.isDiscoverable ?? true);
  const [privacy, setPrivacy] = useState(profile?.privacy || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDiscoverable(profile?.isDiscoverable ?? true);
    setPrivacy(profile?.privacy || {});
  }, [profile?.id, profile?.isDiscoverable, profile?.privacy]);

  const updateSetting = async (key, value) => {
    const nextPrivacy = { ...privacy, [key]: value };
    setPrivacy(nextPrivacy);
    setSaving(true);
    try {
      await saveProfile({ privacy: nextPrivacy });
    } catch (error) {
      setPrivacy(privacy);
      console.error('[ProfileVisibility] Failed to save visibility setting:', error);
    } finally {
      setSaving(false);
    }
  };

  const updateDiscoverability = async (value) => {
    setDiscoverable(value);
    setSaving(true);
    try {
      await saveProfile({ isDiscoverable: value });
    } catch (error) {
      setDiscoverable(!value);
      console.error('[ProfileVisibility] Failed to save discoverability:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton}><FeatureIcon color={colors.ink} name="chevron.left" size={24} /></Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>การแสดงโปรไฟล์</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.inkMuted }]}>เลือกข้อมูลที่ผู้ใช้อื่นจะเห็นบนโปรไฟล์ของคุณ</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <VisibilityRow colors={colors} label="แสดงโปรไฟล์ในการค้นหา" value={discoverable} onChange={updateDiscoverability} icon="eye.fill" />
          <VisibilityRow colors={colors} label="แสดงอายุ" value={privacy.showAge ?? true} onChange={(value) => updateSetting('showAge', value)} icon="calendar" />
          <VisibilityRow colors={colors} label="แสดงเพศ" value={privacy.showGender ?? true} onChange={(value) => updateSetting('showGender', value)} icon="person.2.fill" />
          <VisibilityRow colors={colors} label="แสดงคณะและชั้นปี" value={privacy.showFaculty ?? true} onChange={(value) => updateSetting('showFaculty', value)} icon="graduationcap.fill" />
          <VisibilityRow colors={colors} label="แสดงกิจกรรม" value={privacy.showActivity ?? true} onChange={(value) => updateSetting('showActivity', value)} icon="figure.run" />
          <VisibilityRow colors={colors} label="แสดงเวลาที่สะดวก" value={privacy.showAvailability ?? true} onChange={(value) => updateSetting('showAvailability', value)} icon="clock.fill" last />
        </View>
        {saving ? <Text style={[styles.saving, { color: colors.inkMuted }]}>กำลังบันทึก...</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function VisibilityRow({ colors, icon, label, last, onChange, value }) {
  return (
    <View style={[styles.row, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <FeatureIcon color={colors.primary} name={icon} size={18} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Switch onValueChange={onChange} trackColor={{ false: colors.line, true: colors.primary }} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  headerButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  title: { fontSize: type.lg, fontWeight: '900' },
  content: { padding: spacing.lg },
  intro: { fontSize: type.body, lineHeight: 22, marginBottom: spacing.lg },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: spacing.lg },
  label: { flex: 1, fontSize: type.body, fontWeight: '700', marginHorizontal: spacing.md },
  saving: { fontSize: type.caption, marginTop: spacing.md, textAlign: 'center' },
});
