import Text from '../components/AppText';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { TourTarget, useAppTour } from '../context/AppTourContext';
import FeatureIcon from '../components/FeatureIcon';
import FaceVerificationBanner, { useFaceVerificationRequired } from '../components/FaceVerificationPrompt';
import { IosLikeAvatar } from '../components/iosLike';
import { radius, shadow, spacing, type, useTheme } from '../theme';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';

const CONFIRM_ACTIONS = {
  logout: {
    icon: 'rectangle.portrait.and.arrow.right',
    title: 'ออกจากระบบ?',
    body: 'คุณจะต้องเข้าสู่ระบบอีกครั้งเพื่อใช้ CampusMate บนอุปกรณ์นี้',
    confirmLabel: 'ยืนยันออกจากระบบ',
  },
  delete: {
    icon: 'trash.fill',
    title: 'ลบบัญชีอย่างถาวร?',
    body: 'โปรไฟล์ ข้อความแชท และการจับคู่จะถูกลบและกู้คืนไม่ได้',
    confirmLabel: 'ยืนยันลบบัญชี',
  },
};

export default function ProfileSettingsScreen({ onLogout, onToast }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { confirm } = useConfirm();
  const { profile } = useAppProfile();
  const { user } = useAuth();
  const canUseSpotify = isSpotifyFeatureAllowed(user, profile);
  const { deleteAccount, saveProfile, switchAdminRole } = useAppActions();
  const [switchingAdminRole, setSwitchingAdminRole] = useState(false);

  const userEmail = (user?.email || profile?.email || '').toLowerCase().trim();
  const isSuperAdmin = userEmail === '6710210317@psu.ac.th';
  const isCurrentlyAdmin = profile?.isAdmin === true || profile?.role === 'admin';
  const showAdminSection = isSuperAdmin || isCurrentlyAdmin;

  const handleToggleAdminMode = async () => {
    const nextAdmin = !isCurrentlyAdmin;
    const actionLabel = nextAdmin ? 'สลับเป็นโหมดผู้ดูแลระบบ' : 'สลับเป็นโหมดผู้ใช้ทั่วไป';

    await confirm({
      icon: nextAdmin ? 'crown.fill' : 'person.fill',
      title: `${actionLabel}?`,
      body: nextAdmin
        ? 'คุณจะได้รับสิทธิ์ผู้ดูแลระบบ (Admin) เพื่อจัดการระบบและเข้าถึงเครื่องมือแอดมิน'
        : 'คุณจะใช้งานด้วยสิทธิ์ผู้ใช้ทั่วไป (Normal User) เพื่อทดสอบประสบการณ์การใช้งานจริง',
      confirmLabel: 'ยืนยัน',
      cancelLabel: 'ยกเลิก',
      onConfirm: async () => {
        setSwitchingAdminRole(true);
        try {
          await switchAdminRole(nextAdmin);
          onToast?.(
            nextAdmin
              ? '👑 สลับเป็นโหมดผู้ดูแลระบบแล้ว'
              : '👤 สลับเป็นโหมดผู้ใช้ทั่วไปแล้ว',
            'success'
          );
        } catch (error) {
          onToast?.(error?.message || 'สลับสิทธิ์ไม่สำเร็จ', 'error');
        } finally {
          setSwitchingAdminRole(false);
        }
      },
    });
  };

  const [notifications, setNotifications] = useState(profile?.notificationsEnabled ?? true);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const { startTour } = useAppTour();
  const scrollRef = useRef(null);
  const faceVerificationRequired = useFaceVerificationRequired();
  const version = `v${Constants.expoConfig?.version || '1.0.0'}`;

  useEffect(() => {
    setNotifications(profile?.notificationsEnabled ?? true);
  }, [profile?.id, profile?.notificationsEnabled]);

  const updateNotifications = async (value) => {
    setNotifications(value);
    setSavingNotifications(true);
    try {
      await saveProfile({ notificationsEnabled: value });
    } catch (error) {
      setNotifications(!value);
      onToast?.(error?.message || 'บันทึกการแจ้งเตือนไม่สำเร็จ', 'info');
    } finally {
      setSavingNotifications(false);
    }
  };

  const requestConfirm = async (action) => {
    const copy = CONFIRM_ACTIONS[action];
    await confirm({
      ...copy,
      destructive: true,
      onConfirm: async () => {
        try {
          if (action === 'logout') {
            await onLogout?.();
            return;
          }
          onToast?.('กำลังลบบัญชี...', 'info');
          await deleteAccount();
        } catch (error) {
          onToast?.(error?.message || (action === 'logout' ? 'ออกจากระบบไม่สำเร็จ' : 'ลบบัญชีไม่สำเร็จ'), 'info');
          throw error;
        }
      },
    });
  };

  const formattedYear = profile?.year
    ? (/^\d+$/.test(String(profile.year)) ? `ชั้นปี ${profile.year}` : String(profile.year))
    : null;

  const metaText = [
    profile?.faculty,
    formattedYear,
  ].filter(Boolean).join(' · ') || 'แก้ไขชื่อ รูป และข้อมูลที่ใช้จับคู่';

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 40, spacing.xxxl) }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={styles.container}
      >
        <TourTarget id="me.profile" scrollRef={scrollRef}>
        <Pressable
          accessibilityLabel="แก้ไขโปรไฟล์"
          accessibilityRole="button"
          onPress={() => router.push('/profile')}
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: colors.card, borderColor: colors.line },
            pressed && styles.pressed,
          ]}
        >
          <IosLikeAvatar
            cacheScope={profile?.id}
            cacheVersion={profile?.avatarRevision}
            color={profile?.avatarColor}
            emoji={profile?.avatar}
            size={64}
            uri={profile?.avatarUri}
          />
          <View style={styles.profileCopy}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.profileName, { color: colors.ink }]}>
                {profile?.name || profile?.nickname || 'โปรไฟล์ของฉัน'}
              </Text>
              {isCurrentlyAdmin ? (
                <View style={[styles.badgePill, { backgroundColor: colors.primarySoft }]}>
                  <Text style={[styles.badgePillText, { color: colors.primary }]}>
                    {isSuperAdmin ? '👑 SUPER ADMIN' : '👑 ADMIN'}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.profileMeta, { color: colors.inkMuted }]}>
              {metaText}
            </Text>
            {profile?.email ? (
              <View style={styles.verifiedRow}>
                <FeatureIcon color={user?.emailVerified ? colors.green : colors.inkSoft} name={user?.emailVerified ? 'checkmark.seal.fill' : 'envelope.fill'} size={13} />
                <Text style={[styles.profileEmail, { color: colors.inkSoft }]}>
                  {profile.email}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.profileAction, { color: colors.primary }]}>แก้ไขโปรไฟล์</Text>
          </View>
          <FeatureIcon color={colors.inkSoft} name="chevron.right" size={18} />
        </Pressable>
        </TourTarget>

        {(
          <TourTarget id="me.face" scrollRef={scrollRef}>
            <FaceVerificationBanner style={styles.faceBanner} />
          </TourTarget>
        )}

        {showAdminSection ? (
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelFirst, { color: colors.inkMuted }]}>
              ผู้ดูแลระบบ (Admin Controls)
            </Text>
            <View style={[styles.list, { backgroundColor: colors.card, borderColor: isCurrentlyAdmin ? colors.primary : colors.line }]}>
              <View style={[styles.adminBanner, { backgroundColor: isCurrentlyAdmin ? colors.primarySoft : colors.surfaceRaised }]}>
                <View style={[styles.iconWrap, { backgroundColor: isCurrentlyAdmin ? `${colors.primary}25` : colors.line }]}>
                  <FeatureIcon
                    color={isCurrentlyAdmin ? colors.primary : colors.inkMuted}
                    name={isCurrentlyAdmin ? 'crown.fill' : 'person.fill'}
                    size={20}
                  />
                </View>
                <View style={styles.rowCopy}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.label, { color: colors.ink }]}>
                      {isCurrentlyAdmin ? 'โหมดผู้ดูแลระบบ' : 'โหมดผู้ใช้ทั่วไป'}
                    </Text>
                    <View style={[styles.badgePill, { backgroundColor: isCurrentlyAdmin ? `${colors.primary}22` : `${colors.inkMuted}20` }]}>
                      <Text style={[styles.badgePillText, { color: isCurrentlyAdmin ? colors.primary : colors.inkMuted }]}>
                        {isCurrentlyAdmin ? (isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN') : 'NORMAL USER'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                    {isCurrentlyAdmin
                      ? 'มีสิทธิ์จัดการระบบและเข้าถึงเครื่องมือแอดมิน'
                      : 'กำลังทดสอบระบบด้วยสิทธิ์ผู้ใช้ปกติ'}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="สลับสิทธิ์ผู้ดูแลระบบ"
                  accessibilityRole="button"
                  disabled={switchingAdminRole}
                  onPress={handleToggleAdminMode}
                  style={({ pressed }) => [
                    styles.switchRoleBtn,
                    { backgroundColor: isCurrentlyAdmin ? colors.surface : colors.primary },
                    pressed && styles.pressed,
                    switchingAdminRole && { opacity: 0.6 },
                  ]}
                >
                  {switchingAdminRole ? (
                    <ActivityIndicator color={isCurrentlyAdmin ? colors.primary : colors.onPrimary} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.switchRoleBtnText,
                        { color: isCurrentlyAdmin ? colors.primary : colors.onPrimary },
                      ]}
                    >
                      {isCurrentlyAdmin ? 'สลับเป็นผู้ใช้' : 'สลับเป็นแอดมิน'}
                    </Text>
                  )}
                </Pressable>
              </View>

              {isSuperAdmin ? (
                <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.greenSoft }]}>
                    <FeatureIcon color={colors.green} name="checkmark.seal.fill" size={18} />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.label, { color: colors.ink }]}>การยืนยันใบหน้าอัตโนมัติ</Text>
                      <View style={[styles.badgePill, { backgroundColor: colors.greenSoft }]}>
                        <Text style={[styles.badgePillText, { color: colors.green }]}>100% ผ่าน</Text>
                      </View>
                    </View>
                    <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                      Super Admin ได้รับการยืนยันตัวตนอัตโนมัติ ไม่ต้องสแกนใบหน้าสด
                    </Text>
                  </View>
                </View>
              ) : null}

              <SettingsRow
                colors={colors}
                icon="globe"
                label="เปิด Web Admin Console"
                subtitle="จัดการผู้ใช้ อนุมัติใบหน้า และดูรายงานผ่านเว็บ"
                last
                onPress={() => {
                  Linking.openURL('https://campusmate-7f1ab.web.app/admin.html').catch(() => {
                    onToast?.('ไม่สามารถเปิดเบราว์เซอร์ได้', 'error');
                  });
                }}
              />
            </View>
          </>
        ) : null}

        <Text style={[styles.sectionLabel, !showAdminSection && styles.sectionLabelFirst, { color: colors.inkMuted }]}>การค้นหา</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <TourTarget id="me.plus" scrollRef={scrollRef}>
            <SettingsRow colors={colors} icon="sparkles" label="CampusMate Plus"
              subtitle="ไม่มีโฆษณา ตัวกรองเพิ่มเติมและการแสดงโปรไฟล์"
              onPress={() => router.push('/membership')} />
          </TourTarget>
          <SettingsRow
            colors={colors}
            icon="slider.horizontal.3"
            label="ตั้งค่าการจับคู่"
            subtitle="เลือกคนที่อยากพบ"
            onPress={() => router.push('/matching-filters')}
          />
          <SettingsRow
            colors={colors}
            icon="eye.fill"
            label="การแสดงโปรไฟล์"
            subtitle={profile?.isDiscoverable === false ? 'ซ่อนจากการค้นหา' : 'แสดงในการค้นหา'}
            last
            onPress={() => router.push('/profile-visibility')}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>กิจกรรม</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <SettingsRow
            colors={colors}
            icon="calendar.badge.clock"
            label="ประวัติการนัดหมาย"
            subtitle="ดูการนัดหมายที่ผ่านมา"
            last
            onPress={() => router.push('/appointments')}
          />
        </View>

        {canUseSpotify ? <>
        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>เพลงและดนตรี</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <SettingsRow
            colors={colors}
            icon="music.note"
            label="การตั้งค่าเพลงโปรด"
            subtitle={Array.isArray(profile?.favoriteTracks) && profile.favoriteTracks.length > 0 ? `เลือกไว้ ${profile.favoriteTracks.length} เพลง` : 'เลือกเพลงที่อยากแสดงในโปรไฟล์'}
            last
            onPress={() => router.push({ pathname: '/profile', params: { section: 'music' } })}
          />
        </View>
        </> : null}

        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>การแจ้งเตือน</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
              <FeatureIcon color={colors.primary} name="bell.fill" size={18} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>การแจ้งเตือน</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>รับการแจ้งเตือนจาก CampusMate</Text>
            </View>
            <Switch
              accessibilityLabel="เปิดการแจ้งเตือน"
              accessibilityState={{ busy: savingNotifications }}
              disabled={savingNotifications}
              ios_backgroundColor={colors.line}
              onValueChange={updateNotifications}
              thumbColor={colors.onPrimary}
              trackColor={{ false: colors.line, true: colors.primary }}
              value={notifications}
            />
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>เกี่ยวกับแอป</Text>
        <TourTarget id="me.replay" scrollRef={scrollRef} scrollOffset={220}>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <SettingsRow colors={colors} icon="book.fill" label="ดูหน้าแนะนำอีกครั้ง"
            subtitle="วิธีค้นหาเพื่อน นัดกิจกรรม และเริ่มแชต" onPress={() => router.push('/onboarding')} />
          <SettingsRow colors={colors} icon="hand.wave.fill" label="ดูการแนะนำแอปอีกครั้ง"
            subtitle="พาชมฟีเจอร์หลักในแต่ละหน้าแบบสั้นๆ" onPress={() => startTour({ replay: true })} />
          <SettingsRow
            colors={colors}
            icon="info.circle.fill"
            label="เกี่ยวกับ CampusMate"
            subtitle="ข้อมูลแอปและเอกสารทางกฎหมาย"
            last
            onPress={() => router.push('/about')}
            value={version}
          />
        </View>
        </TourTarget>

        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>บัญชี</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <SettingsRow
            colors={colors}
            danger
            icon="rectangle.portrait.and.arrow.right"
            label="ออกจากระบบ"
            showChevron={false}
            onPress={() => requestConfirm('logout')}
          />
          <SettingsRow
            colors={colors}
            danger
            icon="trash.fill"
            label="ลบบัญชีอย่างถาวร"
            last
            showChevron={false}
            onPress={() => requestConfirm('delete')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsRow({ colors, danger = false, icon, label, last = false, onPress, showChevron = true, subtitle, value }) {
  const accent = danger ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
        <FeatureIcon color={accent} name={icon} size={18} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.label, { color: danger ? colors.danger : colors.ink }]}>{label}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[styles.value, { color: colors.inkMuted }]}>{value}</Text> : null}
      {showChevron ? <FeatureIcon color={colors.inkSoft} name="chevron.right" size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  faceBanner: { marginTop: spacing.md },
  profileCard: {
    ...shadow.card,
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { fontSize: type.headline, fontWeight: '800' },
  profileMeta: { fontSize: type.caption, marginTop: 2 },
  verifiedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  profileEmail: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  profileAction: { fontSize: type.caption, fontWeight: '700', marginTop: 6 },
  sectionLabel: {
    fontSize: type.caption,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  sectionLabelFirst: { marginTop: 0 },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowCopy: { flex: 1, minWidth: 0, marginHorizontal: spacing.md },
  iconWrap: { alignItems: 'center', borderRadius: radius.md, height: 36, justifyContent: 'center', width: 36 },
  label: { fontSize: type.body, fontWeight: '700' },
  subtitle: { fontSize: type.caption, lineHeight: 18, marginTop: 2 },
  value: { fontSize: type.caption, fontWeight: '600', marginRight: spacing.sm },
  pressed: { opacity: 0.72 },
  adminBanner: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  badgePill: {
    borderRadius: radius.sm || 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgePillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  switchRoleBtn: {
    borderRadius: radius.md || 10,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 38,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  switchRoleBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
