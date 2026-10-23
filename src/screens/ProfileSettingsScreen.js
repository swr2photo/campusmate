import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { SettingsFrame, SettingsGroup, SettingsRow, SettingsSection, SETTINGS_RED, useSettingsPalette } from '../components/settings-primitives';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { usePreferences } from '../context/PreferencesContext';
import { getCurrentAppVersion, getCurrentAppBuild } from '../services/versionCheckService';

const detail = (section) => router.push({ pathname: '/settings-detail', params: { section } });
const THEME_LABELS = { system: 'ตามระบบ', light: 'สว่าง', dark: 'มืด' };

// Icon colours follow iOS Settings conventions; Android shows them as tonal circles.
const ICON = {
  account: '#2869C7',
  username: '#5B5CE2',
  matching: '#F47C6B',
  visibility: '#18A878',
  notifications: '#E5484D',
  appearance: '#6C63FF',
  safety: '#18A878',
  privacy: '#3986E8',
  help: '#D8901B',
  admin: '#A97A00',
};

// Top level shows only the main topics; every detail lives on its own page.
export default function ProfileSettingsScreen({ onLogout, onToast }) {
  const palette = useSettingsPalette();
  const { profile } = useAppProfile();
  const { switchAdminRole } = useAppActions();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const { preferences, syncError, retry } = usePreferences();
  const [error, setError] = useState('');
  const currentAdmin = profile?.isAdmin === true || profile?.role === 'admin';
  const superAdmin = (user?.email || profile?.email || '').toLowerCase().trim() === '6710210317@psu.ac.th';
  const appBuild = getCurrentAppBuild();
  const rawAppVersion = getCurrentAppVersion() || Constants.expoConfig?.version || '3.1.8';
  const version = appBuild ? `${rawAppVersion} (${appBuild})` : rawAppVersion;

  const requestLogout = () => confirm({
    icon: 'rectangle.portrait.and.arrow.right',
    title: 'ออกจากระบบ?',
    body: 'คุณจะต้องเข้าสู่ระบบอีกครั้งเพื่อใช้ CampusMate บนอุปกรณ์นี้',
    confirmLabel: 'ยืนยันออกจากระบบ',
    destructive: true,
    onConfirm: async () => {
      try { await onLogout?.(); }
      catch (reason) { setError(reason?.message || 'ออกจากระบบไม่สำเร็จ ลองอีกครั้งนะ'); throw reason; }
    },
  });
  const changeAdmin = () => confirm({
    icon: currentAdmin ? 'person.fill' : 'crown.fill',
    title: currentAdmin ? 'สลับเป็นผู้ใช้ทั่วไป?' : 'สลับเป็นผู้ดูแลระบบ?',
    body: 'เปลี่ยนโหมดสิทธิ์เพื่อเข้าถึงเครื่องมือที่เหมาะกับการใช้งาน',
    confirmLabel: 'ยืนยัน',
    destructive: false,
    onConfirm: async () => {
      try { await switchAdminRole(!currentAdmin); }
      catch (reason) { onToast?.(reason?.message || 'สลับสิทธิ์ไม่สำเร็จ', 'error'); throw reason; }
    },
  });

  return (
    <SettingsFrame title="การตั้งค่า" error={error || syncError}>
      {syncError ? <SettingsGroup><SettingsRow icon="arrow.clockwise" iconColor={ICON.account} label="โหลดการตั้งค่าอีกครั้ง" onPress={retry} last /></SettingsGroup> : null}

      <SettingsSection title="บัญชีของฉัน">
        <SettingsGroup>
          <SettingsRow icon="person.crop.circle.fill" iconColor={ICON.account} label="บัญชีและความปลอดภัย" onPress={() => router.push('/account-security')} />
          <SettingsRow icon="at" iconColor={ICON.username} label="ชื่อผู้ใช้" value={preferences.publicUsername || 'ยังไม่ได้ตั้ง'} onPress={() => detail('username')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="การหาเพื่อน">
        <SettingsGroup>
          <SettingsRow icon="slider.horizontal.3" iconColor={ICON.matching} label="ตั้งค่าการจับคู่" onPress={() => router.push('/matching-filters')} />
          <SettingsRow icon="eye.fill" iconColor={ICON.visibility} label="การมองเห็นและการแนะนำ" onPress={() => detail('discovery')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="แอปของฉัน">
        <SettingsGroup>
          <SettingsRow icon="bell.fill" iconColor={ICON.notifications} label="การแจ้งเตือน" onPress={() => detail('notifications')} />
          <SettingsRow icon="circle.lefthalf.filled" iconColor={ICON.appearance} label="ธีมและการแสดงผล" value={THEME_LABELS[preferences.theme]} onPress={() => detail('appearance')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ความปลอดภัยและความเป็นส่วนตัว">
        <SettingsGroup>
          <SettingsRow icon="checkmark.shield.fill" iconColor={ICON.safety} label="ศูนย์ความปลอดภัย" onPress={() => detail('safety')} />
          <SettingsRow icon="hand.raised.fill" iconColor={ICON.privacy} label="ความเป็นส่วนตัว" onPress={() => detail('privacy')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ช่วยเหลือ">
        <SettingsGroup>
          <SettingsRow icon="questionmark.circle.fill" iconColor={ICON.help} label="ช่วยเหลือและเกี่ยวกับแอป" onPress={() => detail('about')} last />
        </SettingsGroup>
      </SettingsSection>

      {superAdmin || currentAdmin ? (
        <SettingsSection title="ผู้ดูแลระบบ">
          <SettingsGroup>
            <SettingsRow icon="crown.fill" iconColor={ICON.admin} label={currentAdmin ? 'สลับเป็นผู้ใช้ทั่วไป' : 'สลับเป็นผู้ดูแลระบบ'} onPress={changeAdmin} />
            <SettingsRow icon="arrow.up.right.square" iconColor={ICON.admin} label="เปิดหน้าจัดการระบบ" onPress={() => Linking.openURL('https://campusmate-7f1ab.web.app/admin.html').catch(() => setError('เปิดเบราว์เซอร์ไม่ได้ ลองอีกครั้งนะ'))} last />
          </SettingsGroup>
        </SettingsSection>
      ) : null}

      <SettingsGroup><SettingsRow label="ออกจากระบบ" centered onPress={requestLogout} last /></SettingsGroup>
      <View style={styles.version}>
        <FeatureIcon name="flame.fill" size={22} color={SETTINGS_RED} />
        <Text style={[styles.versionText, { color: palette.muted }]}>CampusMate เวอร์ชัน {version}</Text>
      </View>
      <SettingsGroup><SettingsRow label="ลบบัญชี" danger centered onPress={() => router.push('/account-security')} last /></SettingsGroup>
    </SettingsFrame>
  );
}

const styles = StyleSheet.create({
  version: { alignItems: 'center', gap: 4, paddingVertical: 2 },
  versionText: { fontSize: 14 },
});
