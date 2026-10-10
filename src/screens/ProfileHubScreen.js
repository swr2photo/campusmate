import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import CachedImage from '../components/CachedImage';
import FeatureIcon from '../components/FeatureIcon';
import FaceVerificationModal from '../components/FaceVerificationModal';
import { useAppActions, useAppBadges, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { TourTarget, useAppTour } from '../context/AppTourContext';
import { useMembership } from '../context/MembershipContext';
import { getActivityCategory } from '../data/activityCategories';
import { FEATURE_UNLIMITED_REWIND } from '../data/plans';
import { MAX_PROFILE_PHOTOS } from '../data/profilePhotos';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import { getImageRequestUri } from '../utils/useRemoteImage';
import { useTheme } from '../theme';

const PHOTO_PREVIEW_SLOTS = 6;
const RECOMMENDED_PHOTOS = 3;

function ProfilePhoto({ uri, profile, index, style }) {
  const { colors } = useTheme();
  const [failedSource, setFailedSource] = useState(null);
  const source = getImageRequestUri(uri, profile?.avatarRevision);

  return (
    <View style={[styles.photo, { backgroundColor: colors.surfaceRaised }, style]}>
      {source && failedSource !== source ? (
        <CachedImage
          contentFit="cover"
          imageIdentity={`profile-hub:${profile?.id || 'me'}:${index}`}
          onError={() => setFailedSource(source)}
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <FeatureIcon color={colors.inkMuted} name={uri ? 'photo' : 'person.fill'} size={24} />
      )}
    </View>
  );
}

function RoundButton({ label, icon, onPress, palette, size = 44 }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.roundButton, {
        backgroundColor: palette.raised,
        borderColor: palette.line,
        height: size,
        width: size,
      }, pressed && styles.pressed]}
    >
      <FeatureIcon color={palette.text} name={icon} size={23} />
    </Pressable>
  );
}

function DetailChip({ label, icon, filled, palette, onPress }) {
  return (
    <Pressable
      accessibilityLabel={`${filled ? 'แก้ไข' : 'เพิ่ม'}${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.detailChip, {
        backgroundColor: filled ? palette.card : palette.empty,
      }, pressed && styles.pressed]}
    >
      <FeatureIcon color={palette.muted} name={icon} size={17} />
      <Text numberOfLines={1} style={[styles.chipLabel, { color: palette.text }]}>{label}</Text>
      {!filled ? <FeatureIcon color={palette.muted} name="plus" size={18} /> : null}
    </Pressable>
  );
}

function SectionHeading({ title, incomplete, palette, action }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {incomplete ? <FeatureIcon color={palette.coral} name="exclamationmark.circle.fill" size={19} /> : null}
      {action}
    </View>
  );
}

export default function ProfileHubScreen({ onToast }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profile, profileLoading } = useAppProfile();
  const { user } = useAuth();
  const { saveProfile, markFaceVerified } = useAppActions();
  const { pendingLikeCount = 0, matchedCount = 0 } = useAppBadges();
  const membership = useMembership();
  const { startTour } = useAppTour();
  const scrollRef = useRef(null);
  const [showFaceModal, setShowFaceModal] = useState(false);
  const palette = {
    canvas: isDark ? '#15120F' : colors.canvas,
    card: isDark ? '#26221E' : colors.card,
    raised: isDark ? '#2E2B27' : colors.surfaceRaised,
    empty: isDark ? '#080706' : colors.surfaceRaised,
    line: isDark ? '#423D37' : colors.line,
    text: colors.ink,
    muted: isDark ? '#B8B3AD' : colors.inkMuted,
    coral: isDark ? '#FF686E' : colors.danger,
  };

  if (!profile) {
    return (
      <View style={[styles.loading, { backgroundColor: palette.canvas }]}>
        {profileLoading ? <ActivityIndicator color={palette.text} /> : null}
        <Text style={{ color: palette.muted }}>{profileLoading ? 'กำลังโหลดโปรไฟล์…' : 'ยังไม่มีข้อมูลโปรไฟล์'}</Text>
        {!profileLoading ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/profile?tab=edit')} style={styles.emptyAction}>
            <Text style={{ color: colors.primary }}>เพิ่มข้อมูลโปรไฟล์</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const photos = [profile.avatarUri, ...(Array.isArray(profile.gallery) ? profile.gallery : [])]
    .filter((uri) => typeof uri === 'string' && uri.trim())
    .slice(0, MAX_PROFILE_PHOTOS);
  const interests = [profile.interests, profile.activities].find((value) => Array.isArray(value) && value.length)
    || (profile.activity ? [profile.activity] : []);
  const hasAvailability = Boolean(profile.availability?.trim()) || Boolean(profile.availabilitySlots?.length);
  const hasBio = Boolean(profile.bio?.trim());
  const checklist = [
    profile.name || profile.nickname,
    photos.length >= RECOMMENDED_PHOTOS,
    profile.faculty,
    profile.year,
    profile.age,
    profile.gender,
    interests.length,
    hasAvailability,
    hasBio,
  ];
  const completion = Math.round(checklist.filter(Boolean).length / checklist.length * 100);
  const isFaceVerified = profile.isFaceVerified === true;
  const isAdmin = profile.isAdmin === true || profile.role === 'admin';
  const remainingRecommended = Math.max(RECOMMENDED_PHOTOS - photos.length, 0);
  const canUseSpotify = isSpotifyFeatureAllowed(user, profile);
  const activityLabel = interests.map((id) => getActivityCategory(id)?.shortLabel).filter(Boolean).slice(0, 2).join(' · ');
  const editSection = (section) => router.push({ pathname: '/profile', params: { tab: 'edit', section } });
  const verifyFace = () => {
    if (isFaceVerified) {
      onToast?.(`ยืนยันใบหน้าจริงแล้ว${profile.faceMatchScore ? ` (${profile.faceMatchScore}%)` : ''}`, 'success');
      return;
    }
    if (!profile.avatarUri) {
      onToast?.('กรุณาเพิ่มรูปโปรไฟล์หลักก่อนยืนยันใบหน้า', 'info');
      router.push('/profile-photos');
      return;
    }
    setShowFaceModal(true);
  };
  const detailRows = [
    [
      { label: 'คณะ', icon: 'building.columns.fill', filled: Boolean(profile.faculty), section: 'basic' },
      { label: profile.year ? `ชั้นปี ${profile.year}` : 'ชั้นปี', icon: 'graduationcap.fill', filled: Boolean(profile.year), section: 'basic' },
      { label: 'เวลาว่าง', icon: 'clock', filled: hasAvailability, section: 'basic' },
    ],
    [
      { label: 'ข้อมูลพื้นฐาน', icon: 'person.text.rectangle.fill', filled: Boolean(profile.age && profile.gender), section: 'basic' },
      { label: activityLabel || 'ไลฟ์สไตล์', icon: 'figure.run', filled: Boolean(interests.length), section: 'activities' },
      ...(canUseSpotify ? [{ label: 'เพลงโปรด', icon: 'music.note', filled: Boolean(profile.favoriteTracks?.length), section: 'music' }] : []),
    ],
  ];

  return (
    <View style={[styles.screen, { backgroundColor: palette.canvas }]}>
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, {
          paddingTop: insets.top + 18,
          paddingBottom: Math.max(insets.bottom + 32, 52),
        }]}
        showsVerticalScrollIndicator={false}
      >
        <TourTarget id="me.profile" scrollRef={scrollRef}>
          <View style={styles.profileHeader}>
            <Pressable
              accessibilityLabel="แก้ไขโปรไฟล์ของฉัน"
              accessibilityRole="button"
              onPress={() => router.push('/profile')}
              style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
            >
              <View style={styles.avatarStack}>
                <ProfilePhoto uri={photos[1] || photos[0]} profile={profile} index={1} style={styles.avatarBehind} />
                <ProfilePhoto uri={photos[0]} profile={profile} index={0} style={styles.avatarFront} />
              </View>
              <View style={styles.identityCopy}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={[styles.name, { color: palette.text, fontSize: width < 360 ? 22 : 26 }]}>
                    {profile.name || profile.nickname || user?.displayName || 'โปรไฟล์ของฉัน'}
                  </Text>
                  {isFaceVerified ? (
                    <FeatureIcon color="#3B82F6" name="checkmark.seal.fill" size={20} />
                  ) : null}
                </View>
              </View>
            </Pressable>
            <View style={styles.headerActions}>
              <RoundButton label="ดูคนที่ถูกใจและเพื่อนที่จับคู่" icon="person.2.fill" onPress={() => router.push('/likes')} palette={palette} size={width < 360 ? 40 : 44} />
              <RoundButton label="เมนูการตั้งค่า" icon="gearshape.fill" onPress={() => router.push('/profile-settings')} palette={palette} size={width < 360 ? 40 : 44} />
            </View>
          </View>
          {(!isFaceVerified || isAdmin) ? (
            <View style={styles.identityBadges}>
              {!isFaceVerified ? (
                <Pressable accessibilityRole="button" accessibilityLabel="ยืนยันตัวตน" onPress={verifyFace} style={styles.verificationBadge}>
                  <FeatureIcon color={palette.muted} name="person.crop.circle.badge.checkmark" size={16} />
                  <Text style={{ color: palette.muted, fontSize: 12 }}>ยืนยันตัวตน</Text>
                </Pressable>
              ) : null}
              {isAdmin ? <Text style={{ color: colors.amber, fontSize: 11, fontWeight: '700' }}>ADMIN</Text> : null}
            </View>
          ) : null}
        </TourTarget>

        <Pressable
          accessibilityLabel={`โปรไฟล์สมบูรณ์ ${completion} เปอร์เซ็นต์ แตะเพื่อแก้ไขข้อมูล`}
          accessibilityRole="button"
          onPress={() => editSection('basic')}
          style={({ pressed }) => [styles.completenessBanner, { backgroundColor: palette.card }, pressed && styles.pressed]}
        >
          <FeatureIcon color={completion === 100 ? colors.green : palette.coral} name={completion === 100 ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'} size={19} />
          <Text style={[styles.completenessText, { color: palette.text }]}>{completion === 100 ? 'โปรไฟล์พร้อมให้เพื่อนรู้จักแล้ว' : 'เพิ่มข้อมูลบนโปรไฟล์ให้ครบ'}</Text>
          <Text style={{ color: palette.muted, fontSize: 12 }}>{completion}%</Text>
        </Pressable>

        <View style={styles.detailRows}>
          {detailRows.map((row, index) => (
            <ScrollView horizontal key={index} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detailRow}>
              {row.map((detail) => <DetailChip key={detail.label} {...detail} palette={palette} onPress={() => editSection(detail.section)} />)}
            </ScrollView>
          ))}
        </View>

        <View style={styles.section}>
          <SectionHeading title="รูปภาพของฉัน" incomplete={remainingRecommended > 0} palette={palette} />
          <Text style={[styles.sectionHint, { color: remainingRecommended ? palette.coral : palette.muted }]}>
            {remainingRecommended ? `เพิ่มอีก ${remainingRecommended} รูป เพื่อให้เพื่อนรู้จักคุณมากขึ้น` : `${photos.length}/${MAX_PROFILE_PHOTOS} รูป · เติมเรื่องราวในแบบของคุณ`}
          </Text>
          <View style={[styles.photoCard, { backgroundColor: palette.card }]}>
            <View style={styles.photoStrip}>
              {Array.from({ length: PHOTO_PREVIEW_SLOTS }, (_, index) => (
                <Pressable
                  key={index}
                  accessibilityLabel={photos[index] ? `แก้ไขรูปภาพที่ ${index + 1}` : `เพิ่มรูปภาพที่ ${index + 1}`}
                  accessibilityRole="button"
                  onPress={() => router.push('/profile-photos')}
                  style={({ pressed }) => [styles.photoSlot, { backgroundColor: palette.empty, borderColor: palette.card }, pressed && styles.pressed]}
                >
                  {photos[index] ? <ProfilePhoto uri={photos[index]} profile={profile} index={index} style={StyleSheet.absoluteFill} /> : <FeatureIcon color={palette.text} name="plus" size={23} />}
                  {index === PHOTO_PREVIEW_SLOTS - 1 && photos.length > PHOTO_PREVIEW_SLOTS ? (
                    <View style={styles.morePhotos}><Text style={styles.morePhotosText}>+{photos.length - PHOTO_PREVIEW_SLOTS}</Text></View>
                  ) : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.photoCardFooter}>
              <Text style={[styles.photoCardCopy, { color: palette.text }]}>เล่าเรื่องของคุณผ่านรูปภาพ{ '\n' }เพิ่มได้สูงสุด {MAX_PROFILE_PHOTOS} รูป</Text>
              <Pressable
                accessibilityLabel="แก้ไขรูปภาพของฉัน"
                accessibilityRole="button"
                onPress={() => router.push('/profile-photos')}
                style={({ pressed }) => [styles.editPhotosButton, { backgroundColor: palette.text }, pressed && styles.pressed]}
              >
                <Text style={{ color: palette.canvas, fontSize: 16, fontWeight: '600' }}>แก้ไข</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading title="ประโยคชวนรู้จักของฉัน" incomplete={!hasBio} palette={palette} />
          <Pressable
            accessibilityLabel="แก้ไขคำแนะนำตัวของฉัน"
            accessibilityRole="button"
            onPress={() => editSection('basic')}
            style={({ pressed }) => [styles.bioCard, { backgroundColor: palette.card }, pressed && styles.pressed]}
          >
            <View style={styles.bioCardHeader}>
              <FeatureIcon color={palette.muted} name="quote.bubble.fill" size={25} />
              <FeatureIcon color={palette.text} name={hasBio ? 'pencil' : 'plus'} size={22} />
            </View>
            <Text numberOfLines={4} style={[styles.bioText, { color: hasBio ? palette.text : palette.muted }]}>
              {hasBio ? profile.bio : 'กิจกรรมที่ชอบ เรื่องที่คุยได้ทั้งวัน หรือเพื่อนแบบที่อยากเจอ…'}
            </Text>
            <Text style={{ color: palette.muted, fontSize: 12 }}>{hasBio ? 'แตะเพื่อแก้ไขคำแนะนำตัว' : 'เพิ่มประโยคแรก แล้วให้เพื่อนทักมารู้จักคุณ'}</Text>
          </Pressable>
        </View>

        {!isFaceVerified ? (
          <TourTarget id="me.face" scrollRef={scrollRef}>
            <Pressable accessibilityLabel="เริ่มยืนยันใบหน้า" accessibilityRole="button" onPress={verifyFace} style={({ pressed }) => [styles.faceCard, { backgroundColor: palette.card }, pressed && styles.pressed]}>
              <FeatureIcon color={palette.coral} name="checkmark.seal.fill" size={27} />
              <View style={styles.faceCopy}>
                <Text style={{ color: palette.text, fontSize: 17, fontWeight: '600' }}>เป็นตัวเองอย่างมั่นใจ</Text>
                <Text style={{ color: palette.muted, fontSize: 13 }}>ยืนยันใบหน้าเพื่อให้เพื่อนรู้ว่าเป็นคุณจริง ๆ</Text>
              </View>
              <FeatureIcon color={palette.text} name="chevron.right" size={18} />
            </Pressable>
          </TourTarget>
        ) : null}

        <TourTarget id="me.plus" scrollRef={scrollRef}>
          <View style={styles.membershipSection}>
            <Pressable accessibilityLabel="ดูแพลน CampusMate Plus" accessibilityRole="button" onPress={() => router.push('/membership')} style={({ pressed }) => pressed && styles.pressed}>
              <LinearGradient colors={['#A97A00', '#825D00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.membershipBanner}>
                <View style={styles.membershipCopy}>
                  <View style={styles.membershipBrand}>
                    <Text style={styles.membershipName}>CAMPUSMATE</Text>
                    <View style={styles.plusPill}><Text style={styles.plusPillText}>PLUS</Text></View>
                  </View>
                  <Text style={styles.membershipSubtitle}>{membership.loading ? 'กำลังตรวจสอบสถานะสมาชิก…' : membership.plus ? 'สิทธิ์ Plus ของคุณพร้อมใช้งาน' : 'ดูว่าใครถูกใจ แล้วเริ่มรู้จักกันเร็วขึ้น'}</Text>
                </View>
                <FeatureIcon color="#FFFFFF" name="arrow.right" size={30} />
              </LinearGradient>
            </Pressable>
            <View style={[styles.statsCard, { backgroundColor: palette.card, borderColor: palette.line }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`มีคนถูกใจคุณ ${pendingLikeCount} คน`} onPress={() => router.push('/likes')} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
                <FeatureIcon color="#8BB2E9" name="heart.fill" size={22} />
                <Text style={[styles.statValue, { color: palette.text }]}>{pendingLikeCount}</Text>
                <Text style={[styles.statLabel, { color: palette.muted }]}>ถูกใจคุณ</Text>
              </Pressable>
              <View style={[styles.statDivider, { backgroundColor: palette.line }]} />
              <Pressable accessibilityRole="button" accessibilityLabel={`จับคู่แล้ว ${matchedCount} คน`} onPress={() => router.push('/chat')} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
                <FeatureIcon color="#D995CD" name="person.2.fill" size={22} />
                <Text style={[styles.statValue, { color: palette.text }]}>{matchedCount}</Text>
                <Text style={[styles.statLabel, { color: palette.muted }]}>จับคู่แล้ว</Text>
              </Pressable>
              <View style={[styles.statDivider, { backgroundColor: palette.line }]} />
              <Pressable accessibilityRole="button" accessibilityLabel="ดูสิทธิ์ย้อนกลับรายการ" onPress={() => router.push('/membership')} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
                <FeatureIcon color="#EDBC53" name="arrow.uturn.backward" size={22} />
                <Text style={[styles.statValue, { color: palette.text }]}>{membership.loading ? '…' : membership.can(FEATURE_UNLIMITED_REWIND) ? 'ไม่จำกัด' : 'Plus'}</Text>
                <Text style={[styles.statLabel, { color: palette.muted }]}>ย้อนกลับ</Text>
              </Pressable>
            </View>
          </View>
        </TourTarget>

        <TourTarget id="me.replay" scrollRef={scrollRef}>
          <Pressable accessibilityRole="button" onPress={() => startTour({ replay: true })} style={({ pressed }) => [styles.replayButton, pressed && styles.pressed]}>
            <FeatureIcon color={palette.muted} name="hand.wave.fill" size={16} />
            <Text style={{ color: palette.muted, fontSize: 13 }}>ดูการแนะนำแอปอีกครั้ง</Text>
          </Pressable>
        </TourTarget>
      </ScrollView>
      <FaceVerificationModal
        avatarUri={profile.avatarUri}
        visible={showFaceModal}
        onClose={() => setShowFaceModal(false)}
        onSuccess={async (result) => {
          markFaceVerified?.(result.similarity);
          try {
            await saveProfile({ isFaceVerified: true, faceMatchScore: result.similarity, faceVerificationStatus: 'verified' });
            onToast?.('ยืนยันใบหน้าสำเร็จแล้ว', 'success');
          } catch (error) {
            onToast?.(error?.message || 'ซิงก์สถานะยืนยันใบหน้าไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
          }
          setShowFaceModal(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, width: '100%', maxWidth: 640, alignSelf: 'center', gap: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyAction: { padding: 14 },
  pressed: { opacity: 0.72 },
  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 88 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  identityCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontWeight: '500', lineHeight: 34 },
  avatarStack: { width: 79, height: 82 },
  photo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarBehind: { position: 'absolute', width: 56, height: 70, borderRadius: 9, right: 2, top: 7, transform: [{ rotate: '10deg' }] },
  avatarFront: { position: 'absolute', width: 58, height: 76, borderRadius: 9, left: 3, top: 1, transform: [{ rotate: '-5deg' }] },
  headerActions: { flexDirection: 'row', gap: 8, paddingTop: 1 },
  roundButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 99, borderWidth: StyleSheet.hairlineWidth },
  identityBadges: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  verificationBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  completenessBanner: { borderRadius: 99, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 9, minHeight: 49 },
  completenessText: { fontSize: 16, flexShrink: 1 },
  detailRows: { gap: 9, marginTop: -7 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 4 },
  detailChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 10, minHeight: 42 },
  chipLabel: { fontSize: 15, maxWidth: 180 },
  section: { gap: 10 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 23, fontWeight: '500', flexShrink: 1 },
  sectionHint: { fontSize: 14, marginTop: -5 },
  photoCard: { borderRadius: 26, borderCurve: 'continuous', padding: 8, gap: 12 },
  photoStrip: { borderRadius: 19, borderCurve: 'continuous', overflow: 'hidden', flexDirection: 'row', height: 86 },
  photoSlot: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, minWidth: 0 },
  morePhotos: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.48)' },
  morePhotosText: { color: '#FFFFFF', fontSize: 23, fontWeight: '600' },
  photoCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 5, paddingBottom: 8 },
  photoCardCopy: { flex: 1, fontSize: 14 },
  editPhotosButton: { minWidth: 83, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 99, paddingHorizontal: 18, paddingVertical: 7 },
  bioCard: { borderRadius: 26, borderCurve: 'continuous', padding: 19, gap: 15, minHeight: 155 },
  bioCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bioText: { fontSize: 18 },
  faceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 25, borderCurve: 'continuous', padding: 18 },
  faceCopy: { flex: 1, gap: 3 },
  membershipSection: { gap: 9 },
  membershipBanner: { borderRadius: 99, paddingHorizontal: 21, paddingVertical: 19, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 88 },
  membershipCopy: { flex: 1, gap: 3 },
  membershipBrand: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  membershipName: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  plusPill: { backgroundColor: '#FFCF26', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 1 },
  plusPillText: { color: '#312400', fontSize: 11, fontWeight: '700' },
  membershipSubtitle: { color: '#FFFFFF', fontSize: 13 },
  statsCard: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 27, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 91, paddingHorizontal: 3, paddingVertical: 4 },
  statValue: { fontSize: 18, fontWeight: '500' },
  statLabel: { fontSize: 12, textAlign: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 13 },
  replayButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: 10 },
});
