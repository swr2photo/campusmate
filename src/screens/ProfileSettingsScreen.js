import React, { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { SettingsDescription, SettingsFrame, SettingsGroup, SettingsRow, SettingsSection, SettingsToggle, SETTINGS_RED, useSettingsPalette } from '../components/settings-primitives';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { usePreferences } from '../context/PreferencesContext';
import { useMembership } from '../context/MembershipContext';
import { useAppTour } from '../context/AppTourContext';
import { FEATURE_INCOGNITO } from '../data/plans';
import { requireFirebase } from '../services/dbService';
import { secureDiscoveryCall, secureDiscoveryConfigured } from '../services/secureDiscoveryService';

const detail = (section) => router.push({ pathname: '/settings-detail', params: { section } });

export default function ProfileSettingsScreen({ onLogout, onToast }) {
  const palette = useSettingsPalette();
  const { profile } = useAppProfile();
  const { saveProfile, switchAdminRole } = useAppActions();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const { startTour } = useAppTour();
  const membership = useMembership();
  const { preferences, updatePreferences, ready } = usePreferences();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [discoverable, setDiscoverable] = useState(profile?.isDiscoverable !== false);
  const visibilityEnabled = secureDiscoveryConfigured();
  const [visibilityMode, setVisibilityMode] = useState(visibilityEnabled ? null : 'public');
  const busyRef = useRef(false);
  const currentAdmin = profile?.isAdmin === true || profile?.role === 'admin';
  const superAdmin = (user?.email || profile?.email || '').toLowerCase().trim() === '6710210317@psu.ac.th';
  const version = Constants.expoConfig?.version || '1.0.0';

  useEffect(() => { setDiscoverable(profile?.isDiscoverable !== false); }, [profile?.id, profile?.isDiscoverable]);
  useEffect(() => {
    setVisibilityMode(visibilityEnabled ? null : 'public');
    if (!visibilityEnabled || !user?.id) return undefined;
    try {
      const { db } = requireFirebase();
      return onSnapshot(doc(db, 'profileVisibility', user.id), (snapshot) => {
        setVisibilityMode(snapshot.exists() ? snapshot.data().mode || 'public' : 'public');
      }, () => { setVisibilityMode(null); setError('โหลดการมองเห็นโปรไฟล์ไม่สำเร็จ กรุณาเปิดหน้านี้อีกครั้ง'); });
    } catch (reason) {
      setError(reason?.message || 'โหลดการมองเห็นโปรไฟล์ไม่สำเร็จ');
      return undefined;
    }
  }, [user?.id, visibilityEnabled]);

  const runSave = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError('');
    try { await action(); }
    catch (reason) { setError(reason?.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const changePreference = (key, value) => runSave(key, () => updatePreferences({ [key]: value }));
  const changeDiscoverable = (value) => runSave('discovery', async () => {
    const previous = discoverable;
    setDiscoverable(value);
    try { await saveProfile({ isDiscoverable: value }); }
    catch (reason) { setDiscoverable(previous); throw reason; }
  });
  const changeVisibility = (mode) => {
    if (!visibilityEnabled || visibilityMode == null) return;
    if (mode === 'incognito' && !membership.can(FEATURE_INCOGNITO)) {
      if (membership.ready) router.push('/membership');
      return;
    }
    return runSave('visibility', async () => {
      await secureDiscoveryCall('setProfileVisibility', { mode });
      setVisibilityMode(mode);
    });
  };
  const requestLogout = () => confirm({
    icon: 'rectangle.portrait.and.arrow.right',
    title: 'ออกจากระบบ?',
    body: 'คุณจะต้องเข้าสู่ระบบอีกครั้งเพื่อใช้ CampusMate บนอุปกรณ์นี้',
    confirmLabel: 'ยืนยันออกจากระบบ',
    destructive: true,
    onConfirm: async () => {
      try { await onLogout?.(); }
      catch (reason) { setError(reason?.message || 'ออกจากระบบไม่สำเร็จ'); throw reason; }
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
  const locked = Boolean(busy) || !ready;

  return (
    <SettingsFrame title="เมนูการตั้งค่า" busy={Boolean(busy)} error={error}>
      <SettingsSection title="บัญชีและความปลอดภัย">
        <SettingsGroup>
          <SettingsRow label="จัดการบัญชีและความปลอดภัย" onPress={() => router.push('/account-security')} />
          <SettingsRow label="ตั้งค่าการจับคู่" onPress={() => router.push('/matching-filters')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ควบคุมว่าคุณอยากเห็นใครบ้าง">
        <SettingsGroup>
          <SettingsRow label="การแนะนำแบบบาลานซ์" description={'เห็นคนที่เหมาะกับคุณมากที่สุดก่อน\n(การตั้งค่าเริ่มต้น)'} selected={preferences.recommendation === 'balanced'} disabled={locked} busy={busy === 'recommendation' && preferences.recommendation === 'balanced'} onPress={() => changePreference('recommendation', 'balanced')} />
          <SettingsRow label="เพิ่งแอ็กทีฟไปไม่นานนี้" description="เรียงตามการอัปเดตโปรไฟล์ล่าสุด" selected={preferences.recommendation === 'recent'} disabled={locked} onPress={() => changePreference('recommendation', 'recent')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ควบคุมการมองเห็น">
        <SettingsGroup>
          <SettingsRow label="มาตรฐาน" description="คนอื่นจะเห็นคุณบนหน้าค้นหา" selected={visibilityMode === 'public'} disabled={Boolean(busy) || !visibilityEnabled || visibilityMode == null} onPress={() => changeVisibility('public')} />
          <SettingsRow label="ซ่อนแอบ" badge="PLUS" description="เฉพาะคนที่คุณ Like และคนที่จับคู่แล้วจะเห็นคุณได้" selected={visibilityMode === 'incognito'} disabled={Boolean(busy) || !visibilityEnabled || visibilityMode == null || !membership.ready} onPress={() => changeVisibility('incognito')} last />
        </SettingsGroup>
        {!visibilityEnabled ? <SettingsDescription>โหมดซ่อนแอบยังไม่เปิดให้ใช้งานในขณะนี้</SettingsDescription> : null}
        {visibilityEnabled && visibilityMode == null ? <SettingsDescription>กำลังตรวจสอบการมองเห็นโปรไฟล์…</SettingsDescription> : null}
        {visibilityMode === 'incognito' && membership.ready && !membership.can(FEATURE_INCOGNITO) ? <SettingsDescription>สมาชิกหมดอายุแล้ว โปรไฟล์ยังคงส่วนตัว คนที่จับคู่แล้วแชตได้ต่อ เลือกมาตรฐานเพื่อแสดงในหน้าค้นหาอีกครั้ง</SettingsDescription> : null}
      </SettingsSection>

      <SettingsSection title="เปิดใช้งานการค้นหา">
        <SettingsGroup><SettingsToggle label="เปิดใช้งานการค้นหา" value={discoverable} disabled={Boolean(busy)} busy={busy === 'discovery'} onValueChange={changeDiscoverable} /></SettingsGroup>
        <SettingsDescription>หากปิดใช้งาน โปรไฟล์ของคุณจะถูกซ่อนจากหน้าค้นหา ส่วนคนที่จับคู่กับคุณแล้วจะยังคุยกับคุณได้</SettingsDescription>
      </SettingsSection>

      <SettingsSection title="สถานะและสื่อ">
        <SettingsGroup>
          <SettingsRow label="แอ็กทีฟ" onPress={() => detail('activity')} />
          <SettingsRow label="เล่นวิดีโออัตโนมัติ" onPress={() => detail('autoplay')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection>
        <SettingsGroup><SettingsRow label="ชื่อผู้ใช้" value={preferences.publicUsername || 'ใส่ชื่อผู้ใช้ของคุณเลย'} onPress={() => detail('username')} last /></SettingsGroup>
        <SettingsDescription>ตั้งชื่อที่ใช้เรียกคุณในแอปบนอุปกรณ์นี้</SettingsDescription>
      </SettingsSection>

      <SettingsSection title="การแจ้งเตือน">
        <SettingsGroup>
          <SettingsRow label="อีเมล" onPress={() => detail('email')} />
          <SettingsRow label="การแจ้งเตือนแบบ Push" onPress={() => detail('push')} />
          <SettingsRow label="SMS" onPress={() => detail('sms')} />
          <SettingsRow label="Team CampusMate" onPress={() => detail('team')} last />
        </SettingsGroup>
        <SettingsDescription>เลือกการแจ้งเตือนที่ต้องการรับและดูช่องทางที่เปิดให้ใช้งาน</SettingsDescription>
      </SettingsSection>

      <SettingsSection title="โหมดกลางคืน">
        <SettingsGroup>
          <SettingsRow label="ใช้ตามการตั้งค่าของระบบ" selected={preferences.theme === 'system'} disabled={locked} onPress={() => changePreference('theme', 'system')} />
          <SettingsRow label="โหมดสว่าง" selected={preferences.theme === 'light'} disabled={locked} onPress={() => changePreference('theme', 'light')} />
          <SettingsRow label="โหมดกลางคืน" selected={preferences.theme === 'dark'} disabled={locked} onPress={() => changePreference('theme', 'dark')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ชุมชน">
        <SettingsGroup>
          <SettingsRow label="หลักปฏิบัติของชุมชน" onPress={() => router.push('/community-guidelines')} />
          <SettingsRow label="เคล็ดลับด้านความปลอดภัย" onPress={() => detail('safety-tips')} />
          <SettingsRow label="ศูนย์กำกับดูแลความปลอดภัย" onPress={() => detail('safety')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ความเป็นส่วนตัว">
        <SettingsGroup>
          <SettingsRow label="นโยบายเกี่ยวกับคุกกี้" onPress={() => detail('cookies')} />
          <SettingsRow label="นโยบายความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} />
          <SettingsRow label="รูปแบบความเป็นส่วนตัว" onPress={() => router.push('/profile-visibility')} />
          <SettingsRow label="โดย CampusMate" onPress={() => router.push('/about')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="ข้อมูลทางกฎหมาย">
        <SettingsGroup>
          <SettingsRow label="ไลเซนส์" onPress={() => router.push('/legal-notice')} />
          <SettingsRow label="ข้อกำหนดการบริการ" onPress={() => router.push('/terms')} last />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="เกี่ยวกับแอป">
        <SettingsGroup>
          <SettingsRow label="ดูหน้าแนะนำอีกครั้ง" onPress={() => router.push('/onboarding')} />
          <SettingsRow label="ดูการแนะนำแอปอีกครั้ง" onPress={() => { router.back(); startTour({ replay: true }); }} last />
        </SettingsGroup>
      </SettingsSection>

      {superAdmin || currentAdmin ? <SettingsSection title="ผู้ดูแลระบบ">
        <SettingsGroup>
          <SettingsRow label={currentAdmin ? 'สลับเป็นผู้ใช้ทั่วไป' : 'สลับเป็นผู้ดูแลระบบ'} onPress={changeAdmin} />
          <SettingsRow label="เปิด Web Admin Console" onPress={() => Linking.openURL('https://campusmate-7f1ab.web.app/admin.html').catch(() => setError('ไม่สามารถเปิดเบราว์เซอร์ได้'))} last />
        </SettingsGroup>
      </SettingsSection> : null}

      <SettingsGroup><SettingsRow label="ออกจากระบบ" centered onPress={requestLogout} last /></SettingsGroup>
      <View style={{ alignItems: 'center', gap: 5, paddingVertical: 1 }}>
        <FeatureIcon name="flame.fill" size={26} color={SETTINGS_RED} />
        <Text style={{ color: palette.muted, fontSize: 18 }}>เวอร์ชัน {version}</Text>
      </View>
      <SettingsGroup><SettingsRow label="ลบบัญชี" centered onPress={() => router.push('/account-security')} last /></SettingsGroup>
    </SettingsFrame>
  );
}
