import Text from './AppText';
import React, { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useMembership } from '../context/MembershipContext';
import { FEATURE_INCOGNITO } from '../data/plans';
import { requireFirebase } from '../services/dbService';
import { secureDiscoveryCall, secureDiscoveryConfigured } from '../services/secureDiscoveryService';
import { useTheme } from '../theme';

export default function IncognitoVisibility() {
  const { user } = useAuth(), membership = useMembership(), { colors } = useTheme();
  const [mode, setMode] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const enabled = secureDiscoveryConfigured(), uid = user?.id;
  useEffect(() => {
    setMode(null); setError(''); setBusy(false);
    if (!uid || !enabled) return undefined;
    let live = true;
    const { db } = requireFirebase();
    const off = onSnapshot(doc(db, 'profileVisibility', uid), (snapshot) => {
      if (live) setMode(snapshot.exists() ? snapshot.data().mode : 'public');
    }, () => { if (live) { setMode(null); setError('ตรวจการแสดงโปรไฟล์ไม่ได้ กรุณาลองใหม่'); } });
    return () => { live = false; off(); };
  }, [uid, enabled]);
  const change = async (value) => {
    if (value && !membership.can(FEATURE_INCOGNITO)) { if (membership.ready) router.push('/membership'); return; }
    if (busy) return;
    const previousMode = mode;
    const nextMode = value ? 'incognito' : 'public';
    setMode(nextMode);
    setBusy(true); setError('');
    try { await secureDiscoveryCall('setProfileVisibility', { mode: nextMode }); }
    catch (reason) {
      setMode(previousMode);
      setError(reason.message || 'บันทึกไม่ได้ กรุณาลองอีกครั้ง');
    }
    finally { setBusy(false); }
  };
  return <View style={{ marginBottom: 18, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, gap: 10 }}>
    <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>Incognito · CampusMate Plus</Text>
    <Text style={{ color: colors.inkMuted, lineHeight: 21 }}>ให้คนที่คุณกดใจและคนที่จับคู่แล้วเห็นโปรไฟล์ของคุณ</Text>
    {enabled ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' }}>เปิด Incognito</Text>
        <Switch
          value={mode === 'incognito'}
          disabled={busy || mode == null}
          onValueChange={change}
          thumbColor={colors.onPrimary}
          trackColor={{ false: colors.line, true: colors.primary }}
          ios_backgroundColor={colors.line}
        />
      </View>
    ) : <Text style={{ color: colors.inkMuted }}>Incognito ยังไม่เปิดให้ใช้งาน</Text>}
    {mode === 'incognito' && membership.ready && !membership.can(FEATURE_INCOGNITO) ? <Text style={{ color: colors.ink, lineHeight: 21 }}>สมาชิกหมดอายุแล้ว โปรไฟล์ยังคงส่วนตัว คนที่จับคู่แล้วแชตได้ต่อ ปิด Incognito หากต้องการแสดงในหน้าค้นหาอีกครั้ง</Text> : null}
    {membership.ready && !membership.can(FEATURE_INCOGNITO) ? <Pressable accessibilityRole="button" onPress={() => router.push('/membership')}><Text style={{ color: colors.primary }}>ดู CampusMate Plus</Text></Pressable> : null}
    {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
  </View>;
}
