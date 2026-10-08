import Text from '../components/AppText';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useAppActions, useAppProfile } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import IncognitoVisibility from '../components/IncognitoVisibility';
import { radius, spacing, type, useTheme } from '../theme';

export default function ProfileVisibilityScreen() {
  const { colors } = useTheme();
  const { profile } = useAppProfile();
  const { saveProfile } = useAppActions();
  const [discoverable, setDiscoverable] = useState(profile?.isDiscoverable ?? true);
  const [locationEnabled, setLocationEnabled] = useState(profile?.locationEnabled !== false);
  const [privacy, setPrivacy] = useState(profile?.privacy || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saving) return;
    setDiscoverable(profile?.isDiscoverable ?? true);
    setLocationEnabled(profile?.locationEnabled !== false);
    setPrivacy(profile?.privacy || {});
  }, [profile?.id, profile?.isDiscoverable, profile?.locationEnabled, profile?.privacy, saving]);

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

  const updateLocationEnabled = async (value) => {
    setLocationEnabled(value);
    setSaving(true);
    try {
      await saveProfile({ locationEnabled: value });
    } catch (error) {
      setLocationEnabled(!value);
      console.error('[ProfileVisibility] Failed to save location sharing:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.container, { backgroundColor: colors.canvas }]}
    >
      <Text style={[styles.intro, { color: colors.inkMuted }]}>
        ตาม PDPA คุณกำหนดได้ว่าข้อมูลใดจะถูกเปิดเผยต่อผู้ใช้อื่น การปิดการแสดงโปรไฟล์ในการค้นหาจะไม่ลบบัญชี
        เพียงซ่อนคุณจากการค้นหาเพื่อน พิกัด GPS จริงไม่ถูกใส่ในโปรไฟล์สาธารณะ ระยะห่างที่แสดงใกล้สุดคือ 700 เมตร
      </Text>
        <IncognitoVisibility />
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <VisibilityRow colors={colors} label="แสดงโปรไฟล์ในการค้นหา" value={discoverable} onChange={updateDiscoverability} icon="eye.fill" />
          <VisibilityRow colors={colors} label="เปิดตำแหน่งขณะใช้แอป" value={locationEnabled} onChange={updateLocationEnabled} icon="location.fill" last />
        </View>
        <Text style={[styles.helper, { color: colors.inkMuted }]}>
          อัปเดตตำแหน่งเฉพาะตอนเปิดแอป ไม่ติดตามตอนปิดแอป ผู้อื่นเห็นระยะห่างจริงเป็นเมตรหรือกิโลเมตร แต่จะไม่เห็นตำแหน่งของคุณ
        </Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <VisibilityRow colors={colors} label="แสดงอายุ" value={privacy.showAge ?? true} onChange={(value) => updateSetting('showAge', value)} icon="calendar" />
          <VisibilityRow colors={colors} label="แสดงเพศ" value={privacy.showGender ?? true} onChange={(value) => updateSetting('showGender', value)} icon="person.2.fill" />
          <VisibilityRow colors={colors} label="แสดงคณะและชั้นปี" value={privacy.showFaculty ?? true} onChange={(value) => updateSetting('showFaculty', value)} icon="graduationcap.fill" />
          <VisibilityRow colors={colors} label="แสดงกิจกรรม" value={privacy.showActivity ?? true} onChange={(value) => updateSetting('showActivity', value)} icon="figure.run" />
          <VisibilityRow colors={colors} label="แสดงเวลาที่สะดวก" value={privacy.showAvailability ?? true} onChange={(value) => updateSetting('showAvailability', value)} icon="clock.fill" last />
        </View>
        {saving ? <Text style={[styles.saving, { color: colors.inkMuted }]}>กำลังบันทึก...</Text> : null}
    </ScrollView>
  );
}

function VisibilityRow({ colors, icon, label, last, onChange, value }) {
  return (
    <View style={[styles.row, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <FeatureIcon color={colors.primary} name={icon} size={18} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Switch
        ios_backgroundColor={colors.line}
        onValueChange={onChange}
        thumbColor={colors.onPrimary}
        trackColor={{ false: colors.line, true: colors.primary }}
        value={value}
      />
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
  helper: { fontSize: type.caption, lineHeight: 20, marginBottom: spacing.lg, marginTop: spacing.sm },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: spacing.lg },
  label: { flex: 1, fontSize: type.body, fontWeight: '700', marginHorizontal: spacing.md },
  saving: { fontSize: type.caption, marginTop: spacing.md, textAlign: 'center' },
});
