import { Pressable } from './NativePressable';
import React, { useRef, useState } from 'react';
import { ActionSheetIOS, Platform, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import Image from './CachedImage';
import ReportModal from './ReportModal';
import Text from './AppText';
import SlideUpSheet from './sheets/SlideUpSheet';
import { useAppActions } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../theme';
import { getImageRequestUri } from '../utils/useRemoteImage';

export default function ProfileSafetyActions({ profile, onBlocked, renderTrigger }) {
  const { blockUser, reportContent } = useAppActions();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const [reportOpen, setReportOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // The action picked in the Android sheet runs once the sheet is gone.
  const picked = useRef(null);
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
  const run = (action) => {
    if (action === 'report') setReportOpen(true);
    if (action === 'block') void block();
  };
  const openMenu = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: name, options: ['ยกเลิก', 'รายงานโปรไฟล์', 'บล็อกผู้ใช้'], cancelButtonIndex: 0, destructiveButtonIndex: 2 }, index => {
        run(index === 1 ? 'report' : index === 2 ? 'block' : null);
      });
    } else {
      picked.current = null;
      setSheetOpen(true);
    }
  };
  const choose = (action) => { picked.current = action; setSheetOpen(false); };
  const afterSheet = () => { const action = picked.current; picked.current = null; run(action); };
  return <>
    {renderTrigger ? renderTrigger({ label: `รายงานหรือบล็อก ${name}`, disabled: busy || !profile?.id, onPress: openMenu }) : <Pressable accessibilityRole="button" accessibilityLabel={`รายงานหรือบล็อก ${name}`} accessibilityState={{ disabled: busy, busy }} disabled={busy || !profile?.id} onPress={openMenu} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, opacity: pressed || busy ? 0.65 : 1 })}><FeatureIcon name="ellipsis" color={colors.ink} size={23} /></Pressable>}
    {Platform.OS !== 'ios' ? <SlideUpSheet accessibilityLabel={`จัดการโปรไฟล์ ${name}`} onClose={() => setSheetOpen(false)} onDismissed={afterSheet} visible={sheetOpen}>
      <ProfileActionsSheet colors={colors} name={name} onChoose={choose} onCancel={() => setSheetOpen(false)} profile={profile} />
    </SlideUpSheet> : null}
    <ReportModal key={profile?.id} isOpen={reportOpen} onClose={() => setReportOpen(false)} targetName={name} colors={colors} onSubmit={({ reason, details }) => reportContent({ reportedUserId: profile.id, reason, details })} />
  </>;
}

// Android: Material 3 modal bottom sheet with a two-line list. Block is the
// destructive item, so it alone takes the error colour; it still asks to
// confirm before anything happens.
function ProfileActionsSheet({ colors, name, profile, onChoose, onCancel }) {
  const avatar = getImageRequestUri(profile?.avatarUri, profile?.avatarRevision);
  const avatarColor = typeof profile?.avatarColor === 'string' && profile.avatarColor.trim() ? profile.avatarColor : null;
  const ripple = { color: colors.outlineVariant || colors.line };
  const items = [
    { key: 'report', icon: 'flag', title: 'รายงานโปรไฟล์', body: 'แจ้งทีมงานเมื่อพบเนื้อหาไม่เหมาะสม หรือรู้สึกไม่ปลอดภัย', tone: colors.ink, tint: colors.surfaceContainerHighest || colors.surfaceRaised },
    { key: 'block', icon: 'person-remove', title: 'บล็อกผู้ใช้', body: 'ซ่อนโปรไฟล์นี้จากการค้นหาและหยุดการสนทนาระหว่างกัน', tone: colors.danger, tint: `${colors.danger}1F` },
  ];
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: avatarColor || colors.surfaceContainerHighest || colors.surfaceRaised }]}>
          {avatar
            ? <Image accessibilityIgnoresInvertColors contentFit="cover" source={{ uri: avatar }} style={StyleSheet.absoluteFill} />
            : <Text style={[styles.initial, { color: colors.ink }]}>{name.slice(0, 1)}</Text>}
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>{name}</Text>
          <Text numberOfLines={2} style={[styles.subtitle, { color: colors.inkSoft }]}>จัดการโปรไฟล์นี้</Text>
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.outlineVariant || colors.line }]} />
      {items.map((item) => (
        <Pressable
          accessibilityHint={item.body}
          accessibilityLabel={item.title}
          accessibilityRole="button"
          android_ripple={ripple}
          key={item.key}
          onPress={() => onChoose(item.key)}
          style={styles.item}
        >
          <View style={[styles.itemIcon, { backgroundColor: item.tint }]}>
            <FeatureIcon color={item.tone} name={item.icon} size={22} />
          </View>
          <View style={styles.itemText}>
            <Text style={[styles.itemTitle, { color: item.tone }]}>{item.title}</Text>
            <Text style={[styles.itemBody, { color: colors.inkSoft }]}>{item.body}</Text>
          </View>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        android_ripple={ripple}
        onPress={onCancel}
        style={[styles.cancel, { borderColor: colors.outlineVariant || colors.line }]}
      >
        <Text style={[styles.cancelText, { color: colors.ink }]}>ยกเลิก</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 20, fontWeight: '700' },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontSize: 18, fontWeight: '700', lineHeight: 26 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 24, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72, paddingHorizontal: 24, paddingVertical: 12 },
  itemIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  itemBody: { fontSize: 14, lineHeight: 20 },
  cancel: { minHeight: 48, marginHorizontal: 24, marginTop: 12, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cancelText: { fontSize: 15, fontWeight: '600' },
});
