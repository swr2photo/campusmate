import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import Text, { AppTextInput as TextInput } from '../components/AppText';
import { SettingsDescription, SettingsFrame, SettingsGroup, SettingsRow, SettingsSection, SettingsToggle, useSettingsPalette } from '../components/settings-primitives';
import { usePreferences } from '../context/PreferencesContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { LEGAL_CONTACT } from '../content/legalDocuments';
import { getPushPermissionStatusAsync, registerForPushNotificationsAsync, unregisterPushNotificationsAsync } from '../services/notificationService';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAppTour } from '../context/AppTourContext';
import { useMembership } from '../context/MembershipContext';
import { FEATURE_INCOGNITO } from '../data/plans';
import { requireFirebase } from '../services/dbService';
import { RUST_BACKEND, rpc } from '../services/rust/backend';
import { liveQuery } from '../services/rust/events';
import { secureDiscoveryCall, secureDiscoveryConfigured } from '../services/secureDiscoveryService';

const titles = { activity: 'สถานะการใช้งาน', autoplay: 'เล่นวิดีโออัตโนมัติ', username: 'ชื่อผู้ใช้',
  email: 'การแจ้งเตือนทางอีเมล', push: 'การแจ้งเตือนแบบ Push', sms: 'การแจ้งเตือนทาง SMS',
  team: 'Team CampusMate', 'safety-tips': 'เคล็ดลับความปลอดภัย', safety: 'ศูนย์ความปลอดภัย', cookies: 'ข้อมูลบนอุปกรณ์',
  discovery: 'การมองเห็นและการแนะนำ', notifications: 'การแจ้งเตือน', appearance: 'ธีมและการแสดงผล', privacy: 'ความเป็นส่วนตัว', about: 'ช่วยเหลือและเกี่ยวกับแอป' };
const detail = (section) => router.push({ pathname: '/settings-detail', params: { section } });

export default function SettingsDetailScreen() {
  const { section = 'activity' } = useLocalSearchParams();
  const sectionKey = String(section);
  const { user } = useAuth();
  const { preferences, updatePreferences, ready, serverReady, capabilities, syncError, retry } = usePreferences();
  const { confirm } = useConfirm();
  const { startTour } = useAppTour();
  const palette = useSettingsPalette();
  const [username, setUsername] = useState(preferences.publicUsername || '');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [permission, setPermission] = useState('loading');
  const busyRef = useRef(false), usernameEdited = useRef(false);
  const locked = !ready || !serverReady || !!busy;
  useEffect(() => { usernameEdited.current = false; setUsername(preferences.publicUsername || ''); }, [user?.id]);
  useEffect(() => { if (!usernameEdited.current) setUsername(preferences.publicUsername || ''); }, [preferences.publicUsername]);
  useEffect(() => {
    if (sectionKey !== 'push') return;
    let active = true;
    const refresh = () => { void getPushPermissionStatusAsync().then(value => { if (active) setPermission(value); }).catch(() => { if (active) setPermission('error'); }); };
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; subscription.remove(); };
  }, [sectionKey]);
  const run = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setError('');
    try { await action(); }
    catch (reason) { setError(reason?.message || 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const save = patch => run('save', () => updatePreferences(patch));
  const openSystemSettings = () => run('system', () => Linking.openSettings());
  const changePush = enabled => run('push', async () => {
    if (enabled) {
      const registration = await registerForPushNotificationsAsync(user?.id);
      const status = await getPushPermissionStatusAsync(); setPermission(status);
      if (!registration || status !== 'granted') throw new Error('กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าของอุปกรณ์ก่อน');
    }
    await updatePreferences({ notifications: { push: enabled } });
    if (!enabled) await unregisterPushNotificationsAsync(user?.id).catch(() => {});
  });
  const clearImages = async () => {
    const accepted = await confirm({ title: 'ล้างแคชรูปภาพ?', body: 'รูปที่เคยเปิดอาจต้องดาวน์โหลดใหม่ ข้อความ รูปที่กำลังส่ง และข้อมูลบัญชียังคงอยู่', confirmLabel: 'ล้างแคช', icon: 'photo' });
    if (accepted) await run('cache', async () => {
      const results = await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
      if (results.some(value => value === false)) throw new Error('ล้างแคชบางส่วนไม่ได้ กรุณาลองใหม่');
    });
  };
  const help = <SettingsGroup>
    <SettingsRow label="เคล็ดลับนัดพบอย่างปลอดภัย" onPress={() => detail('safety-tips')} />
    <SettingsRow label="หลักปฏิบัติของชุมชน" onPress={() => router.push('/community-guidelines')} />
    <SettingsRow label="จัดการบัญชีที่บล็อก" onPress={() => router.push('/blocked-users')} />
    <SettingsRow label="ติดต่อทีมงาน" description="เปิดแอปอีเมลเพื่อเขียนข้อความถึงทีมงาน" onPress={() => run('contact', () => Linking.openURL(`mailto:${LEGAL_CONTACT.supportEmail}`))} last />
  </SettingsGroup>;
  const content = () => {
    switch (sectionKey) {
      case 'discovery': return <DiscoverySettings onError={setError} />;
      case 'notifications': return <SettingsSection><SettingsGroup>
        <SettingsRow label="การแจ้งเตือนบนเครื่อง" value={preferences.notifications.push ? 'เปิด' : 'ปิด'} onPress={() => detail('push')} />
        <SettingsRow label="ประกาศจาก CampusMate" value={preferences.notifications.team ? 'เปิด' : 'ปิด'} onPress={() => detail('team')} last />
      </SettingsGroup><SettingsDescription>เลือกได้ว่าอยากรู้เรื่องอะไรบ้าง ข้อความในแชตยังเปิดอ่านในแอปได้เสมอ</SettingsDescription></SettingsSection>;
      case 'appearance': return <>
        <SettingsSection title="ธีม"><SettingsGroup>
          {[['system', 'ตามการตั้งค่าของเครื่อง'], ['light', 'โหมดสว่าง'], ['dark', 'โหมดมืด']].map(([value, label], index) =>
            <SettingsRow key={value} label={label} selected={preferences.theme === value} disabled={locked} onPress={() => save({ theme: value })} last={index === 2} />)}
        </SettingsGroup></SettingsSection>
        <SettingsSection title="สถานะและวิดีโอ"><SettingsGroup>
          <SettingsRow label="สถานะออนไลน์" value={preferences.showOnlineStatus ? 'แสดง' : 'ซ่อน'} onPress={() => detail('activity')} />
          <SettingsRow label="เล่นวิดีโออัตโนมัติ" onPress={() => detail('autoplay')} last />
        </SettingsGroup></SettingsSection>
      </>;
      case 'privacy': return <SettingsSection><SettingsGroup>
        <SettingsRow label="ข้อมูลที่เพื่อนมองเห็น" onPress={() => router.push('/profile-visibility')} />
        <SettingsRow label="บัญชีที่บล็อกไว้" onPress={() => router.push('/blocked-users')} />
        <SettingsRow label="ข้อมูลบนอุปกรณ์" onPress={() => detail('cookies')} />
        <SettingsRow label="นโยบายความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} last />
      </SettingsGroup></SettingsSection>;
      case 'about': return <>
        <SettingsSection title="เริ่มต้นใช้งาน"><SettingsGroup>
          <SettingsRow label="ดูหน้าต้อนรับอีกครั้ง" onPress={() => router.push('/onboarding')} />
          <SettingsRow label="ดูการแนะนำแอปอีกครั้ง" onPress={() => { router.navigate('/home'); startTour({ replay: true }); }} last />
        </SettingsGroup></SettingsSection>
        <SettingsSection title="ติดต่อและข้อมูล"><SettingsGroup>
          <SettingsRow label="ติดต่อทีมงาน" onPress={() => run('contact', () => Linking.openURL(`mailto:${LEGAL_CONTACT.supportEmail}`))} />
          <SettingsRow label="หลักปฏิบัติของชุมชน" onPress={() => router.push('/community-guidelines')} />
          <SettingsRow label="ข้อกำหนดการให้บริการ" onPress={() => router.push('/terms')} />
          <SettingsRow label="ไลเซนส์" onPress={() => router.push('/legal-notice')} />
          <SettingsRow label="เกี่ยวกับ CampusMate" onPress={() => router.push('/about')} last />
        </SettingsGroup></SettingsSection>
      </>;
      case 'activity': return <SettingsSection title="การแสดงสถานะ"><SettingsGroup>
        <SettingsToggle label="แสดงสถานะออนไลน์" value={preferences.showOnlineStatus} disabled={locked || !capabilities.presence}
          busy={busy === 'save'} onValueChange={showOnlineStatus => save({ showOnlineStatus })} />
      </SettingsGroup><SettingsDescription>{capabilities.presence ? 'เปิดไว้ เพื่อนในแชตจะเห็นว่าคุณออนไลน์อยู่ ปิดไว้ก็จะไม่เห็นของกันและกัน ส่วนการอ่านข้อความยังเป็นปกติ' : 'ตอนนี้ยังเปลี่ยนส่วนนี้ไม่ได้ ลองใหม่อีกครั้งในภายหลังนะ'}</SettingsDescription></SettingsSection>;
      case 'autoplay': return <SettingsSection title="การเล่นวิดีโอตัวอย่าง"><SettingsGroup>
        {[['always','เล่นอัตโนมัติ'],['wifi','เล่นเมื่อใช้ Wi-Fi เท่านั้น'],['never','ไม่เล่นอัตโนมัติ']].map(([value,label]) =>
          <SettingsRow key={value} label={label} selected={preferences.autoplay === value} disabled={locked} onPress={() => save({ autoplay: value })} />)}
        <SettingsToggle label="ปิดเสียงวิดีโออัตโนมัติ" value={preferences.muteAutoplayVideo} disabled={locked} onValueChange={muteAutoplayVideo => save({ muteAutoplayVideo })} />
      </SettingsGroup><SettingsDescription>ใช้กับวิดีโอตัวอย่างในแอป วิดีโอที่แตะเปิดเพื่อรับชมยังควบคุมการเล่นได้ตามปกติ</SettingsDescription></SettingsSection>;
      case 'username': return <SettingsSection title="ชื่อผู้ใช้บัญชี"><SettingsGroup>
        <View style={styles.inputContainer}><TextInput accessibilityLabel="ชื่อผู้ใช้บัญชี" value={username} editable={!locked}
          onChangeText={value => { usernameEdited.current = true; setUsername(value); }} maxLength={30} autoCapitalize="none" autoCorrect={false}
          placeholder="เช่น somchai_psu" placeholderTextColor={palette.muted} style={[styles.input,{color:palette.text}]} /></View>
        <SettingsRow label="บันทึกชื่อผู้ใช้" busy={busy === 'username'} disabled={locked || !capabilities.publicUsername}
          onPress={() => run('username', async () => { const saved = await updatePreferences({ publicUsername: username.trim().toLowerCase() }); usernameEdited.current = false; setUsername(saved.publicUsername || ''); })} last />
      </SettingsGroup><SettingsDescription>ใช้ a–z, 0–9, จุด หรือขีดล่าง 3–30 ตัวอักษร ชื่อไม่ซ้ำกับบัญชีอื่นและบันทึกไว้กับบัญชีของคุณ ลบข้อความแล้วบันทึกเพื่อยกเลิกชื่อผู้ใช้</SettingsDescription></SettingsSection>;
      case 'push': return <SettingsSection title="แจ้งเตือนบนอุปกรณ์"><SettingsGroup>
        <SettingsToggle label="รับการแจ้งเตือนแบบ Push" value={preferences.notifications.push} disabled={locked || !capabilities.push || permission === 'unavailable' || permission === 'loading'} busy={busy === 'push'} onValueChange={changePush} />
        <SettingsRow label="สิทธิ์การแจ้งเตือนของอุปกรณ์" value={{loading:'กำลังตรวจสอบ',granted:'อนุญาตแล้ว',denied:'ไม่อนุญาต',undetermined:'ยังไม่ได้อนุญาต',unavailable:'ยังไม่รองรับบนเครื่องนี้',error:'ตรวจสอบไม่ได้'}[permission]} />
        <SettingsRow label="เปิดการตั้งค่าอุปกรณ์" onPress={openSystemSettings} last />
      </SettingsGroup><SettingsDescription>ปิดไว้ก็ยังอ่านข้อความและดูการแจ้งเตือนย้อนหลังในแอปได้ตามปกติ เพียงแต่จะไม่มีการแจ้งเตือนเด้งขึ้นบนเครื่องของคุณ</SettingsDescription></SettingsSection>;
      case 'team': return <SettingsSection title="ประกาศในแอป"><SettingsGroup>
        <SettingsToggle label="แจ้งเตือนประกาศจาก CampusMate" value={preferences.notifications.team} disabled={locked || !capabilities.team}
          busy={busy === 'save'} onValueChange={team => save({ notifications: { team } })} />
      </SettingsGroup><SettingsDescription>ควบคุมการแจ้งเตือนประกาศจากทีมงาน การแจ้งเตือนข้อความและสายเรียกเข้าใช้การตั้งค่า Push แยกกัน</SettingsDescription></SettingsSection>;
      case 'email': return <SettingsSection title="ช่องทางอีเมล"><SettingsGroup>
        <SettingsRow label="อีเมลที่ผูกกับบัญชี" value={user?.email || 'ดูในหน้าบัญชี'} />
        <SettingsRow label="จัดการบัญชีและการยืนยันอีเมล" onPress={() => router.push('/account-security')} />
        <SettingsRow label="ข่าวสารและสรุปรายสัปดาห์" value="ยังไม่เปิดให้บริการ" last />
      </SettingsGroup><SettingsDescription>ระบบยังไม่มีบริการส่งอีเมลข่าวสาร ส่วนอีเมลยืนยันบัญชีและกู้คืนรหัสผ่านใช้ขั้นตอนความปลอดภัยของบัญชีตามปกติ</SettingsDescription></SettingsSection>;
      case 'sms': return <SettingsSection title="SMS"><SettingsGroup><SettingsRow label="การแจ้งเตือนทาง SMS" value="ยังไม่เปิดให้บริการ" last /></SettingsGroup>
        <SettingsDescription>ยังไม่ได้เชื่อมผู้ให้บริการ SMS จึงไม่มีการสมัครรับหรือคิดค่าบริการ SMS จากเมนูนี้</SettingsDescription></SettingsSection>;
      case 'safety-tips': return <><SettingsSection title="นัดพบอย่างปลอดภัย"><SettingsGroup>
        <SettingsRow label="นัดพบในที่สาธารณะ" description="เลือกสถานที่ที่มีคนอยู่ เช่น โรงอาหารหรือห้องสมุด" />
        <SettingsRow label="แจ้งคนที่ไว้ใจ" description="บอกสถานที่และเวลาก่อนนัดพบเพื่อนใหม่" />
        <SettingsRow label="บล็อกและรายงานได้จากห้องแชต" description="เปิดเมนูของคู่สนทนาเพื่อบล็อกหรือส่งรายงานให้ทีมงาน" last />
      </SettingsGroup></SettingsSection><SettingsSection title="ความช่วยเหลือ">{help}</SettingsSection></>;
      case 'safety': return <SettingsSection title="จัดการความปลอดภัย">{help}<SettingsDescription>หากพบพฤติกรรมไม่เหมาะสม ให้รายงานจากเมนูของโปรไฟล์หรือห้องแชต ข้อความติดต่อทีมงานจะเปิดในแอปอีเมลให้คุณตรวจและกดส่งด้วยตนเอง</SettingsDescription></SettingsSection>;
      case 'cookies': return <SettingsSection title="การจัดเก็บบนอุปกรณ์"><SettingsGroup>
        <SettingsRow label="ข้อมูลการตั้งค่า" description="จำการตั้งค่าของคุณไว้ เปลี่ยนเครื่องก็ใช้ค่าเดิมได้ทันที" />
        <SettingsRow label="แคชรูปภาพ" description="ช่วยให้รูปที่เคยเปิดโหลดได้เร็วขึ้น" />
        <SettingsRow label="ล้างแคชรูปภาพ" disabled={!!busy} busy={busy === 'cache'} onPress={clearImages} />
        <SettingsRow label="อ่านนโยบายความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} last />
      </SettingsGroup></SettingsSection>;
      default: return <SettingsSection title="ไม่พบการตั้งค่า"><SettingsGroup><SettingsRow label="กลับไปหน้าตั้งค่า" onPress={() => router.back()} last /></SettingsGroup></SettingsSection>;
    }
  };
  return <SettingsFrame title={titles[sectionKey] || 'การตั้งค่า'} detail onClose={() => router.back()} busy={!!busy} error={error || syncError}>
    {syncError ? <SettingsGroup><SettingsRow label="โหลดการตั้งค่าอีกครั้ง" onPress={retry} last /></SettingsGroup> : null}
    {content()}
  </SettingsFrame>;
}

const styles = StyleSheet.create({ inputContainer: { paddingVertical: 14 }, input: { fontSize: 17, paddingVertical: 8, minHeight: 48 } });

// Who can see you and in what order; moved here so the main page stays short.
function DiscoverySettings({ onError }) {
  const { profile } = useAppProfile();
  const { saveProfile } = useAppActions();
  const { user } = useAuth();
  const membership = useMembership();
  const { preferences, updatePreferences, ready, serverReady } = usePreferences();
  const [busy, setBusy] = useState('');
  const [discoverable, setDiscoverable] = useState(profile?.isDiscoverable !== false);
  const visibilityEnabled = secureDiscoveryConfigured();
  const [visibilityMode, setVisibilityMode] = useState(visibilityEnabled ? null : 'public');
  const busyRef = useRef(false);

  useEffect(() => { setDiscoverable(profile?.isDiscoverable !== false); }, [profile?.id, profile?.isDiscoverable]);
  useEffect(() => {
    setVisibilityMode(visibilityEnabled ? null : 'public');
    if (!visibilityEnabled || !user?.id) return undefined;
    const failed = () => { setVisibilityMode(null); onError?.('ยังโหลดการมองเห็นโปรไฟล์ไม่ได้ ลองเปิดหน้านี้อีกครั้งนะ'); };
    if (RUST_BACKEND) return liveQuery('profile', () => rpc('getVisibilityState'), (state) => setVisibilityMode(state?.mode || 'public'), failed);
    try {
      const { db } = requireFirebase();
      return onSnapshot(doc(db, 'profileVisibility', user.id), (snapshot) => {
        setVisibilityMode(snapshot.exists() ? snapshot.data().mode || 'public' : 'public');
      }, failed);
    } catch (reason) {
      onError?.(reason?.message || 'ยังโหลดการมองเห็นโปรไฟล์ไม่ได้');
      return undefined;
    }
  }, [onError, user?.id, visibilityEnabled]);

  const runSave = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    onError?.('');
    try { await action(); }
    catch (reason) { onError?.(reason?.message || 'บันทึกไม่สำเร็จ ลองอีกครั้งนะ'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const locked = Boolean(busy) || !ready || !serverReady;
  const changeVisibility = (mode) => {
    if (!visibilityEnabled || visibilityMode == null) return undefined;
    if (mode === 'incognito' && !membership.can(FEATURE_INCOGNITO)) {
      if (membership.ready) router.push('/membership');
      return undefined;
    }
    return runSave('visibility', async () => {
      await secureDiscoveryCall('setProfileVisibility', { mode });
      setVisibilityMode(mode);
    });
  };
  const changeDiscoverable = (value) => runSave('discovery', async () => {
    const previous = discoverable;
    setDiscoverable(value);
    try { await saveProfile({ isDiscoverable: value }); }
    catch (reason) { setDiscoverable(previous); throw reason; }
  });

  return <>
    <SettingsSection title="ให้คนอื่นเจอคุณ">
      <SettingsGroup><SettingsToggle label="แสดงโปรไฟล์ในหน้าค้นหา" value={discoverable} disabled={Boolean(busy)} busy={busy === 'discovery'} onValueChange={changeDiscoverable} /></SettingsGroup>
      <SettingsDescription>ปิดไว้ก็ยังคุยกับเพื่อนที่จับคู่แล้วได้ตามปกติ</SettingsDescription>
    </SettingsSection>
    <SettingsSection title="ใครเห็นคุณได้บ้าง">
      <SettingsGroup>
        <SettingsRow label="ทุกคน" description="เพื่อนใหม่จะเห็นคุณบนหน้าค้นหา" selected={visibilityMode === 'public'} disabled={Boolean(busy) || !visibilityEnabled || visibilityMode == null} onPress={() => changeVisibility('public')} />
        <SettingsRow label="โหมดซ่อนตัว" badge="PLUS" description="เห็นได้เฉพาะคนที่คุณกดถูกใจและเพื่อนที่จับคู่แล้ว" selected={visibilityMode === 'incognito'} disabled={Boolean(busy) || !visibilityEnabled || visibilityMode == null || !membership.ready} onPress={() => changeVisibility('incognito')} last />
      </SettingsGroup>
      {!visibilityEnabled ? <SettingsDescription>โหมดซ่อนตัวยังไม่เปิดให้ใช้งานในตอนนี้</SettingsDescription> : null}
      {visibilityEnabled && visibilityMode == null ? <SettingsDescription>กำลังโหลด…</SettingsDescription> : null}
      {visibilityMode === 'incognito' && membership.ready && !membership.can(FEATURE_INCOGNITO) ? <SettingsDescription>สมาชิก Plus หมดอายุแล้ว โปรไฟล์ยังซ่อนอยู่ เลือก “ทุกคน” เพื่อกลับมาแสดงในหน้าค้นหา</SettingsDescription> : null}
    </SettingsSection>
    <SettingsSection title="ลำดับคนที่คุณเห็น">
      <SettingsGroup>
        <SettingsRow label="แนะนำแบบสมดุล" description="เห็นคนที่น่าจะเข้ากับคุณก่อน (แนะนำ)" selected={preferences.recommendation === 'balanced'} disabled={locked} onPress={() => runSave('recommendation', () => updatePreferences({ recommendation: 'balanced' }))} />
        <SettingsRow label="อัปเดตล่าสุดก่อน" description="เรียงตามคนที่เพิ่งอัปเดตโปรไฟล์" selected={preferences.recommendation === 'recent'} disabled={locked} onPress={() => runSave('recommendation', () => updatePreferences({ recommendation: 'recent' }))} last />
      </SettingsGroup>
    </SettingsSection>
  </>;
}
