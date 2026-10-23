import { Pressable } from './NativePressable';
import React, { useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import FeatureIcon from './FeatureIcon';
import ReportModal from './ReportModal';
import { useAppActions } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../theme';

export default function ProfileSafetyActions({ profile, onBlocked, renderTrigger }) {
  const { blockUser, reportContent } = useAppActions();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const name = profile?.nickname || profile?.name || 'ผู้ใช้นี้';

  const block = async () => {
    if (lock.current || !profile?.id) return;
    lock.current = true;
    try {
      const accepted = await confirm({ title: `บล็อก ${name}?`, body: 'คุณจะไม่เห็นโปรไฟล์นี้ในการค้นหา และไม่สามารถสนทนากันได้ คุณจัดการรายชื่อที่บล็อกได้ในการตั้งค่า', confirmLabel: 'บล็อกผู้ใช้', icon: 'person.fill.xmark' });
      if (!accepted) return;
      setBusy(true);
      await blockUser(profile.id);
      showToast('บล็อกผู้ใช้แล้ว', 'success');
      onBlocked?.();
    } catch (error) {
      showToast(error?.message || 'บล็อกไม่สำเร็จ กรุณาลองใหม่', 'info');
    } finally { lock.current = false; setBusy(false); }
  };
  const openMenu = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: name, options: ['ยกเลิก', 'รายงานโปรไฟล์', 'บล็อกผู้ใช้'], cancelButtonIndex: 0, destructiveButtonIndex: 2 }, index => {
        if (index === 1) setReportOpen(true);
        if (index === 2) void block();
      });
    } else {
      Alert.alert(name, 'จัดการโปรไฟล์นี้', [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'รายงานโปรไฟล์', onPress: () => setReportOpen(true) },
        { text: 'บล็อกผู้ใช้', style: 'destructive', onPress: () => void block() },
      ]);
    }
  };
  return <>
    {renderTrigger ? renderTrigger({ label: `รายงานหรือบล็อก ${name}`, disabled: busy || !profile?.id, onPress: openMenu }) : <Pressable accessibilityRole="button" accessibilityLabel={`รายงานหรือบล็อก ${name}`} accessibilityState={{ disabled: busy, busy }} disabled={busy || !profile?.id} onPress={openMenu} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, opacity: pressed || busy ? 0.65 : 1 })}><FeatureIcon name="ellipsis" color={colors.ink} size={23} /></Pressable>}
    <ReportModal key={profile?.id} isOpen={reportOpen} onClose={() => setReportOpen(false)} targetName={name} colors={colors} onSubmit={({ reason, details }) => reportContent({ reportedUserId: profile.id, reason, details })} />
  </>;
}
