import React, { useState } from 'react';
import { router } from 'expo-router';
import { SettingsDescription, SettingsFrame, SettingsGroup, SettingsRow, SettingsSection } from '../components/settings-primitives';
import { useAppActions, useAppConversations, useAppFeed } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';

export default function BlockedUsersScreen() {
  const { blockedUserIds = [] } = useAppFeed();
  const { allConversations = [] } = useAppConversations();
  const { unblockUser } = useAppActions();
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const unblock = async (id, name) => {
    if (busy) return;
    const accepted = await confirm({ title: `เลิกบล็อก ${name}?`, body: 'เมื่อเลิกบล็อก การมองเห็นและการติดต่อจะเป็นไปตามการตั้งค่าความเป็นส่วนตัวของทั้งสองฝ่าย', confirmLabel: 'เลิกบล็อก', icon: 'person.crop.circle.badge.checkmark' });
    if (!accepted) return;
    setBusy(id); setError('');
    try { await unblockUser(id); } catch (reason) { setError(reason?.message || 'เลิกบล็อกไม่ได้ กรุณาลองอีกครั้ง'); }
    finally { setBusy(''); }
  };
  return <SettingsFrame title="บัญชีที่บล็อก" detail onClose={() => router.back()} busy={!!busy} error={error}>
    <SettingsSection title={`${blockedUserIds.length} บัญชี`}><SettingsGroup>
      {blockedUserIds.length ? blockedUserIds.map((id, index) => {
        const room = allConversations.find(entry => entry.profileId === id || entry.participants?.includes(id));
        const name = room?.participantProfiles?.[id]?.name || (room?.profileId === id ? room.name : '') || `บัญชีที่บล็อก ${index + 1}`;
        return <SettingsRow key={`${user?.id}:${id}`} label={name} value="เลิกบล็อก" busy={busy === id} disabled={!!busy} onPress={() => unblock(id, name)} last={index === blockedUserIds.length - 1} />;
      }) : <SettingsRow label="ยังไม่มีบัญชีที่บล็อก" last />}
    </SettingsGroup><SettingsDescription>เลือกบัญชีที่ต้องการเลิกบล็อก คุณบล็อกอีกครั้งได้จากโปรไฟล์หรือห้องแชต</SettingsDescription></SettingsSection>
  </SettingsFrame>;
}
