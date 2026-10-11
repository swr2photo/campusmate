import React, { useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Text, { AppTextInput } from '../components/AppText';
import {
  SettingsDescription, SettingsFrame, SettingsGroup, SettingsRow,
  SettingsSection, SettingsToggle, SETTINGS_RED, useSettingsPalette,
} from '../components/settings-primitives';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { usePreferences } from '../context/PreferencesContext';
import { COMMUNITY_SECTIONS, LEGAL_CONTACT } from '../content/legalDocuments';

const TITLES = {
  activity: 'แอ็กทีฟ', autoplay: 'เล่นวิดีโออัตโนมัติ', username: 'ชื่อผู้ใช้',
  email: 'อีเมล', push: 'การแจ้งเตือนแบบ Push', sms: 'SMS', team: 'Team CampusMate',
  'safety-tips': 'เคล็ดลับด้านความปลอดภัย', safety: 'ศูนย์กำกับดูแลความปลอดภัย',
  cookies: 'นโยบายเกี่ยวกับคุกกี้',
};

export default function SettingsDetailScreen({ section }) {
  const palette = useSettingsPalette();
  const { profile } = useAppProfile();
  const { saveProfile } = useAppActions();
  const { preferences, updatePreferences, ready } = usePreferences();
  const [username, setUsername] = useState(preferences.publicUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const save = async (action) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); return true; }
    catch (reason) { setError(reason?.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  const saveUsername = async () => {
    const trimmed = username.trim();
    if (trimmed && !/^[\p{L}\p{N}_.-]{2,30}$/u.test(trimmed)) {
      setError('ใช้ตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง 2–30 ตัว โดยไม่เว้นวรรค');
      return;
    }
    if (await save(() => updatePreferences({ publicUsername: trimmed }))) {
      Keyboard.dismiss();
      if (router.canGoBack()) router.back();
      else router.replace('/profile-settings');
    }
  };
  const locked = busy || !ready;
  let content;

  if (section === 'activity') {
    const items = [
      ['showActiveStatus', 'แสดงสถานะแอ็กทีฟ', 'อนุญาตให้แสดงสถานะเมื่อคุณใช้งานแอปในช่วง 2 ชั่วโมงที่ผ่านมา'],
      ['showRecentlyActiveStatus', 'แสดงสถานะแอ็กทีฟเมื่อไม่นานมานี้', 'อนุญาตให้แสดงสถานะเมื่อคุณใช้งานแอปในช่วง 24 ชั่วโมงที่ผ่านมา'],
    ];
    content = <>
      {items.map(([key, label, description]) => <SettingsSection key={key}>
        <SettingsGroup><SettingsToggle label={label} value={profile?.privacy?.[key] !== false}
          disabled={busy || !profile} busy={busy}
          onValueChange={(value) => save(() => saveProfile({ privacy: { ...profile?.privacy, [key]: value } }))} /></SettingsGroup>
        <SettingsDescription>{description}</SettingsDescription>
      </SettingsSection>)}
      <SettingsDescription>บันทึกการอนุญาตนี้ไว้ในโปรไฟล์ ระบบแสดงสถานะการใช้งานยังไม่เปิดให้ใช้งานในขณะนี้</SettingsDescription>
    </>;
  } else if (section === 'autoplay') {
    content = <>
      <SettingsDescription>การเล่นวิดีโอใช้ข้อมูลอินเทอร์เน็ตมากกว่าการดูรูปภาพ เลือกเวลาที่ต้องการให้วิดีโอตัวอย่างเล่นอัตโนมัติได้ที่นี่</SettingsDescription>
      <SettingsSection title="ตัวเลือกในการเล่นอัตโนมัติ">
        <SettingsGroup>
          {[
            ['always', 'เมื่อใช้งานอินเทอร์เน็ตมือถือและ Wi-Fi'],
            ['wifi', 'เมื่อใช้งาน Wi-Fi เท่านั้น'],
            ['never', 'ไม่เล่นวิดีโออัตโนมัติ'],
          ].map(([value, label], index) => <SettingsRow key={value} label={label}
            selected={preferences.autoplay === value} disabled={locked} last={index === 2}
            onPress={() => save(() => updatePreferences({ autoplay: value }))} />)}
        </SettingsGroup>
      </SettingsSection>
      <SettingsDescription>ใช้กับวิดีโอตัวอย่างก่อนส่งในแชต คุณยังกดเล่นวิดีโอเองได้เสมอ</SettingsDescription>
    </>;
  } else if (section === 'username') {
    content = <>
      <SettingsDescription>ชื่อที่ใช้เรียกคุณบนอุปกรณ์นี้ บันทึกแยกจากชื่อโปรไฟล์สาธารณะ และยังไม่ใช้สำหรับค้นหาหรือแชร์โปรไฟล์</SettingsDescription>
      <SettingsGroup>
        <AppTextInput accessibilityLabel="ชื่อผู้ใช้" value={username} onChangeText={setUsername}
          maxLength={30} autoCapitalize="none" autoCorrect={false} editable={!locked}
          placeholder="ใส่ชื่อผู้ใช้ของคุณเลย" placeholderTextColor={palette.muted}
          returnKeyType="done" onSubmitEditing={saveUsername}
          style={{ color: palette.text, paddingVertical: 20, fontSize: 19 }} />
      </SettingsGroup>
      <SettingsDescription>ใช้ตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง 2–30 ตัว</SettingsDescription>
      <Pressable accessibilityRole="button" disabled={locked} onPress={saveUsername}
        style={({ pressed }) => ({ backgroundColor: SETTINGS_RED, borderRadius: 28, padding: 16, alignItems: 'center', opacity: locked || pressed ? 0.55 : 1 })}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</Text>
      </Pressable>
    </>;
  } else if (['email', 'push', 'sms', 'team'].includes(section)) {
    const unavailable = section === 'email' || section === 'sms';
    const value = section === 'push' ? profile?.notificationsEnabled !== false : preferences.notifications.team;
    content = <SettingsSection>
      <SettingsGroup><SettingsToggle label={section === 'team' ? 'แสดงประกาศจาก Team CampusMate' : `รับการแจ้งเตือน${section === 'push' ? 'แบบ Push' : section === 'email' ? 'ทางอีเมล' : 'ทาง SMS'}`}
        value={unavailable ? false : value} disabled={locked || unavailable || (section === 'push' && !profile)} busy={busy}
        onValueChange={(next) => save(() => section === 'push'
          ? saveProfile({ notificationsEnabled: next })
          : updatePreferences({ notifications: { team: next } }))} /></SettingsGroup>
      <SettingsDescription>{unavailable
        ? `ช่องทาง${section === 'email' ? 'อีเมล' : ' SMS'}ยังไม่เปิดให้ใช้งาน การตั้งค่านี้ไม่กระทบข้อความยืนยันบัญชีหรือรีเซ็ตรหัสผ่าน`
        : section === 'team'
          ? 'แสดงแบนเนอร์ประกาศจากทีมขณะเปิดแอป การตั้งค่านี้บันทึกเฉพาะอุปกรณ์นี้ และไม่ปิดประกาศในกล่องแจ้งเตือนหรือ Push เบื้องหลัง'
          : 'เปิดหรือปิดการแจ้งเตือน Push ของบัญชีนี้ หากเปิดแล้วยังไม่ได้รับ ให้ตรวจสิทธิ์แจ้งเตือนในการตั้งค่าของอุปกรณ์'}</SettingsDescription>
      {section === 'push' ? <SettingsGroup><SettingsRow label="เปิดการตั้งค่าของอุปกรณ์" last onPress={() => {
        Linking.openSettings().catch(() => setError('ไม่สามารถเปิดการตั้งค่าของอุปกรณ์ได้'));
      }} /></SettingsGroup> : null}
    </SettingsSection>;
  } else if (section === 'safety-tips') {
    content = <>
      {COMMUNITY_SECTIONS.filter((item) => item.title.startsWith('3.')).map((item) => <SettingsSection key={item.title} title={item.title}>
        <SettingsDescription>{item.content}</SettingsDescription>
      </SettingsSection>)}
      <SettingsGroup><SettingsRow label="อ่านหลักปฏิบัติของชุมชน" onPress={() => router.push('/community-guidelines')} last /></SettingsGroup>
    </>;
  } else if (section === 'safety') {
    content = <>
      <SettingsDescription>จัดการบัญชี ความเป็นส่วนตัว และดูวิธีรายงานพฤติกรรมที่ไม่เหมาะสมได้จากเมนูด้านล่าง</SettingsDescription>
      <SettingsGroup>
        <SettingsRow label="บัญชีและความปลอดภัย" onPress={() => router.push('/account-security')} />
        <SettingsRow label="การแสดงโปรไฟล์" onPress={() => router.push('/profile-visibility')} />
        <SettingsRow label="หลักปฏิบัติและการรายงาน" onPress={() => router.push('/community-guidelines')} last />
      </SettingsGroup>
      <SettingsDescription>ติดต่อทีมดูแล: {LEGAL_CONTACT.supportEmail}</SettingsDescription>
    </>;
  } else if (section === 'cookies') {
    content = <>
      <SettingsDescription>แอปบันทึกข้อมูลการเข้าสู่ระบบและค่าตั้งค่าบางส่วนไว้บนอุปกรณ์ เพื่อให้ใช้งานต่อได้เมื่อเปิดแอปครั้งถัดไป อ่านรายละเอียดการเก็บและใช้ข้อมูลจากนโยบายความเป็นส่วนตัวของ CampusMate</SettingsDescription>
      <SettingsGroup><SettingsRow label="นโยบายความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} last /></SettingsGroup>
    </>;
  } else {
    content = <SettingsGroup><SettingsRow label="กลับไปเมนูการตั้งค่า" onPress={() => router.replace('/profile-settings')} last /></SettingsGroup>;
  }

  return <SettingsFrame title={TITLES[section] || 'การตั้งค่า'} detail busy={busy} error={error}>{content}</SettingsFrame>;
}
