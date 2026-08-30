import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { useApp } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import { Chip } from '../components/ui';
import { formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';
import { radius, spacing, type, useTheme } from '../theme';

const profilePhoto = require('../../assets/friend-profile-card.png');
const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const actionButtonWidth = 136;
const actionSideInset = 20;

export default function DiscoverProfileScreen({ isViewOnlyParam, profileId, onClose, onToast }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { availableProfiles, conversations, dismissProfile, getMeetupStats, matchProfile, pendingIncomingLikes, sendActivityInvite } = useApp();
  const [processing, setProcessing] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  const [directProfile, setDirectProfile] = useState(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const decisionStarted = useRef(false);

  useEffect(() => {
    if (!profileId) {
      setDirectProfile(null);
      return;
    }
    try {
      const { db } = requireFirebase();
      const unsub = onSnapshot(doc(db, 'profiles', profileId), (snap) => {
        if (snap.exists()) {
          setDirectProfile({ id: snap.id, ...snap.data() });
        }
      });
      return () => unsub();
    } catch (e) {
      console.warn('Realtime profile lookup error:', e);
    }
  }, [profileId]);

  const isViewOnly = Boolean(isViewOnlyParam);

  const candidate = useMemo(() => {
    if (isViewOnly) {
      if (directProfile && directProfile.id === profileId) return directProfile;
      const matchedConvo = conversations?.find((c) => c.profileId === profileId || c.participants?.includes(profileId));
      if (matchedConvo?.participantProfiles?.[profileId]) {
        return { id: profileId, ...matchedConvo.participantProfiles[profileId] };
      }
      const fromAvailable = [...availableProfiles, ...pendingIncomingLikes].find((item) => item.id === profileId);
      if (fromAvailable) return fromAvailable;
      if (directProfile) return directProfile;
      return null;
    }

    const unexcluded = [...availableProfiles, ...pendingIncomingLikes]
      .filter((item, index, self) => (
        !sessionExcludedIds.includes(item.id)
        && self.findIndex((c) => c.id === item.id) === index
      ));

    if (profileId && unexcluded.some((c) => c.id === profileId)) {
      return unexcluded.find((c) => c.id === profileId);
    }

    return unexcluded[0] || null;
  }, [isViewOnly, directProfile, conversations, availableProfiles, pendingIncomingLikes, profileId, sessionExcludedIds]);

  const isCandidateMatched = useMemo(() => {
    if (!candidate) return false;
    return Boolean(
      candidate.isMatched ||
      conversations?.some((c) => c.profileId === candidate.id || c.participants?.includes(candidate.id))
    );
  }, [candidate, conversations]);

  const meetupStats = useMemo(
    () => (candidate ? getMeetupStats(candidate) : null),
    [candidate, getMeetupStats]
  );

  const allTags = useMemo(() => {
    if (!candidate) return [];
    return Array.from(new Set([...(candidate.tags || []), ...(candidate.interests || [])]));
  }, [candidate]);

  const activityDisplay = useMemo(() => {
    if (!candidate) return '';
    return getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities);
  }, [candidate]);

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [onClose]);

  const handleDecision = useCallback(async (decision) => {
    if (!candidate || processing) return;

    const candidateId = candidate.id;
    setProcessing(true);
    setSessionExcludedIds((current) => [...current, candidateId]);
    decisionStarted.current = false;
    translateX.setValue(0);
    translateY.setValue(0);
    cardScale.setValue(1);
    cardOpacity.setValue(1);
    try {
      if (decision === 'like') {
        if (isCandidateMatched) {
          const conversationId = await sendActivityInvite(candidate);
          onToast?.(`ส่งคำขอร่วมกิจกรรมถึง ${candidate.name} แล้ว! กำลังเปิดห้องแชต...`, 'success');
          router.replace({ pathname: '/chat-room', params: { chatId: conversationId } });
        } else {
          const result = await matchProfile(candidate);
          if (result.matched && result.conversationId) {
            onToast?.(`คุณและ ${candidate.name} แมตช์กันแล้ว! กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: result.conversationId } });
          } else {
            onToast?.(`ส่งถูกใจให้ ${candidate.name} แล้ว รออีกฝ่ายกดถูกใจกลับ`, 'info');
          }
        }
      } else {
        await dismissProfile(candidate.id);
        onToast?.('ไม่เลือกโปรไฟล์นี้แล้ว กำลังหาเพื่อนคนถัดไป', 'info');
      }
    } catch (error) {
      setSessionExcludedIds((current) => current.filter((id) => id !== candidateId));
      onToast?.(`Error: ${error.message}`, 'info');
    } finally {
      setProcessing(false);
    }
  }, [candidate, cardOpacity, cardScale, dismissProfile, isCandidateMatched, matchProfile, onToast, processing, sendActivityInvite, translateX, translateY]);

  const finishSwipe = useCallback((decision) => {
    if (processing || decisionStarted.current) return;
    decisionStarted.current = true;
    const buttonCenterOffset = (screenWidth / 2) - actionSideInset - (actionButtonWidth / 2);
    const targetX = decision === 'like' ? buttonCenterOffset : -buttonCenterOffset;
    const targetY = (screenHeight / 2) - 58;

    Animated.parallel([
      Animated.timing(translateX, {
        duration: 280,
        toValue: targetX,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        duration: 280,
        toValue: targetY,
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        duration: 280,
        toValue: 0.08,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        delay: 110,
        duration: 170,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      void handleDecision(decision);
    });
  }, [cardOpacity, cardScale, handleDecision, processing, translateX, translateY]);

  const resetSwipe = useCallback(() => {
    decisionStarted.current = false;
    Animated.parallel([
      Animated.spring(translateX, {
        friction: 7,
        tension: 70,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        friction: 7,
        tension: 70,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        friction: 7,
        tension: 70,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        duration: 120,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardScale, translateX, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      !decisionStarted.current
      && Math.abs(gestureState.dx) > 18
      && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) + 8
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      !decisionStarted.current
      && Math.abs(gestureState.dx) > 18
      && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) + 8
    ),
    onPanResponderGrant: () => {
      decisionStarted.current = false;
    },
    onPanResponderMove: (_, gestureState) => {
      if (!decisionStarted.current) translateX.setValue(gestureState.dx);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx > 110 || gestureState.vx > 0.75) {
        finishSwipe('like');
      } else if (gestureState.dx < -110 || gestureState.vx < -0.75) {
        finishSwipe('skip');
      } else {
        resetSwipe();
      }
    },
    onPanResponderTerminate: resetSwipe,
    onPanResponderTerminationRequest: () => false,
  }), [finishSwipe, resetSwipe, translateX]);

  const rotate = translateX.interpolate({
    inputRange: [-screenWidth, 0, screenWidth],
    outputRange: ['-8deg', '0deg', '8deg'],
  });
  const skipActionScale = translateX.interpolate({
    inputRange: [-120, 0, 120],
    outputRange: [1.12, 1, 0.94],
    extrapolate: 'clamp',
  });
  const likeActionScale = translateX.interpolate({
    inputRange: [-120, 0, 120],
    outputRange: [0.94, 1, 1.12],
    extrapolate: 'clamp',
  });
  const skipBadgeOpacity = translateX.interpolate({
    inputRange: [-110, -24, 0],
    outputRange: [1, 0.25, 0],
    extrapolate: 'clamp',
  });
  const likeBadgeOpacity = translateX.interpolate({
    inputRange: [0, 24, 110],
    outputRange: [0, 0.25, 1],
    extrapolate: 'clamp',
  });


  if (!candidate) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <FeatureIcon color={colors.inkMuted} name="person.crop.circle.badge.questionmark" size={54} />
          <Text style={styles.emptyTitle}>ไม่พบโปรไฟล์นี้แล้ว</Text>
          <Pressable onPress={close} style={styles.backButton}>
            <FeatureIcon color={colors.primary} name="chevron.left" size={18} />
            <Text style={styles.backButtonText}>กลับไปค้นหาเพื่อน</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.fixedHeader}>
        <Pressable accessibilityLabel="ย้อนกลับ" onPress={close} style={styles.headerBackButton}>
          <FeatureIcon color={colors.ink} name="chevron.left" size={22} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>
            {isViewOnly ? (candidate?.name ? `โปรไฟล์ ${candidate.name}` : 'ข้อมูลโปรไฟล์') : 'ค้นหาเพื่อน'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isViewOnly ? (candidate?.faculty || candidate?.activityLabel || 'เพื่อนใน CampusMate') : 'ปัดเพื่อดูคนถัดไป'}
          </Text>
        </View>
      </View>

      <Animated.View
        {...(isViewOnly ? {} : panResponder.panHandlers)}
        style={[
          styles.animatedContent,
          {
            opacity: isViewOnly ? 1 : cardOpacity,
            transform: isViewOnly ? [] : [{ translateX }, { translateY }, { rotate }, { scale: cardScale }],
          },
        ]}
      >
        {!isViewOnly ? (
          <>
            <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.skipBadge, { opacity: skipBadgeOpacity }]}>
              <Text style={styles.skipBadgeText}>ไม่เลือก</Text>
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.likeBadge, { opacity: likeBadgeOpacity }]}>
              <Text style={styles.likeBadgeText}>{isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}</Text>
            </Animated.View>
          </>
        ) : null}
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isViewOnly && { paddingBottom: spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Image source={profilePhoto} style={styles.heroImage} />
            <View style={styles.heroOverlay} />
            <View style={styles.heroCopy}>
              <Text style={styles.heroName}>{candidate.name}{candidate.age ? `, ${candidate.age}` : ''}</Text>
              {candidate.activityLabel ? <Text style={styles.heroActivity}>{candidate.activityLabel}</Text> : null}
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.identityRow}>
              <View style={styles.identityCopy}>
                <Text style={styles.title}>เกี่ยวกับ {candidate.nickname || candidate.name}</Text>
                <Text style={styles.subtitle}>ข้อมูลที่เจ้าของโปรไฟล์เลือกแสดง</Text>
              </View>
              {candidate.compatibility ? <View style={styles.compatibility}>
                <Text style={styles.compatibilityValue}>{candidate.compatibility}%</Text>
                <Text style={styles.compatibilityLabel}>เข้ากันได้</Text>
              </View> : null}
            </View>

            {candidate.age ? <InfoRow icon="calendar" label="อายุ" value={`${candidate.age} ปี`} colors={colors} styles={styles} /> : null}
            {candidate.gender ? <InfoRow icon="person.2.fill" label="เพศ" value={genderLabel(candidate.gender)} colors={colors} styles={styles} /> : null}
            {candidate.faculty ? <InfoRow icon="building.columns.fill" label="คณะ" value={candidate.faculty} colors={colors} styles={styles} /> : null}
            {candidate.year ? <InfoRow icon="graduationcap.fill" label="ชั้นปี" value={candidate.year} colors={colors} styles={styles} /> : null}
            {activityDisplay ? <InfoRow icon="figure.run" label="กิจกรรมที่ชอบ" value={activityDisplay} colors={colors} styles={styles} /> : null}
            {candidate.skill ? <InfoRow icon="star.fill" label="ระดับ / ทักษะ" value={candidate.skill} colors={colors} styles={styles} /> : null}
            {candidate.pace ? <InfoRow icon="speedometer" label="สไตล์ / เพซ" value={candidate.pace} colors={colors} styles={styles} /> : null}
            {candidate.availability ? <InfoRow icon="clock.fill" label="เวลาที่สะดวก" value={candidate.availability} colors={colors} styles={styles} /> : null}
            {candidate.distance != null ? <InfoRow icon="location.circle.fill" label="ระยะห่างจากคุณ" value={formatDistance(candidate.distance)} colors={colors} styles={styles} /> : null}

            {candidate.meetup && (
              <View style={styles.meetupCard}>
                <View style={styles.meetupHeader}>
                  <View style={styles.meetupTitleRow}>
                    <FeatureIcon color={colors.primary} name="mappin.and.ellipse" size={19} />
                    <Text style={styles.meetupSectionTitle}>จุดนัดหมาย</Text>
                  </View>
                  {meetupStats?.isFull ? (
                    <View style={[styles.meetupTag, { backgroundColor: 'rgba(255,100,100,0.18)' }]}>
                      <Text style={[styles.meetupTagText, { color: '#FF453A' }]}>นัดหมายเต็มแล้ว ({meetupStats.maxPeople}/{meetupStats.maxPeople})</Text>
                    </View>
                  ) : (
                    <View style={styles.meetupTag}>
                      <Text style={styles.meetupTagText}>{meetupStats ? `รับสมัคร (ว่างอีก ${meetupStats.remaining} ที่)` : 'นัดพบกันที่นี่'}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.meetupItemRow}>
                  <FeatureIcon color={colors.inkSoft} name="location.fill" size={16} />
                  <Text style={styles.meetupName}>{candidate.meetup.name}</Text>
                </View>

                {candidate.meetup.schedule?.date && (
                  <View style={styles.meetupItemRow}>
                    <FeatureIcon color={colors.inkSoft} name="calendar" size={16} />
                    <Text style={styles.meetupTime}>
                      {formatReadableDate(candidate.meetup.schedule.date)}
                      {candidate.meetup.schedule?.startTime && candidate.meetup.schedule?.endTime ? ` · ${candidate.meetup.schedule.startTime}–${candidate.meetup.schedule.endTime}` : ''}
                    </Text>
                  </View>
                )}

                {candidate.meetup.schedule?.maxPeople ? (
                  <View style={styles.meetupItemRow}>
                    <FeatureIcon color={colors.inkSoft} name="person.2.fill" size={16} />
                    <Text style={styles.meetupPeople}>
                      {meetupStats
                        ? `ผู้เข้าร่วม ${meetupStats.acceptedCount}/${meetupStats.maxPeople} คน (รวมเจ้าของโพสต์)`
                        : `จำนวน ${candidate.meetup.schedule.maxPeople} คน`}
                    </Text>
                  </View>
                ) : null}

                {candidate.meetup.schedule?.message ? (
                  <View style={[styles.meetupItemRow, styles.meetupMsgRow]}>
                    <FeatureIcon color={colors.primary} name="text.bubble.fill" size={16} />
                    <Text style={styles.meetupMsg}>{candidate.meetup.schedule.message}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.bioSection}>
              <View style={styles.bioTitleRow}>
                <FeatureIcon color={colors.primary} name="text.quote" size={17} />
                <Text style={styles.sectionTitle}>แนะนำตัว</Text>
              </View>
              <Text style={styles.bio}>{candidate.bio || 'ยังไม่ได้เขียนคำแนะนำตัว'}</Text>
            </View>

            {allTags.length ? (
              <View>
                <Text style={styles.tagsTitle}>ความสนใจ</Text>
                <View style={styles.tagRow}>
                  {allTags.map((tag) => <Chip key={tag} label={tag} />)}
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </Animated.View>

      {!isViewOnly ? (
        <>
          <View pointerEvents="box-none" style={styles.floatingActions}>
            <Animated.View style={{ transform: [{ scale: skipActionScale }] }}>
              <Pressable
                accessibilityLabel="ไม่เลือก"
                disabled={processing}
                onPress={() => finishSwipe('skip')}
                style={({ pressed }) => [styles.actionButton, styles.skipButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <View style={[styles.actionIcon, styles.skipIcon]}>
                  <Text style={styles.skipIconText}>×</Text>
                </View>
                <Text style={styles.skipButtonText}>ไม่เลือก</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={{ transform: [{ scale: likeActionScale }] }}>
              <Pressable
                accessibilityLabel={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
                disabled={processing}
                onPress={() => finishSwipe('like')}
                style={({ pressed }) => [styles.actionButton, styles.likeButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <View style={[styles.actionIcon, styles.likeIcon]}>
                  <FeatureIcon color="#FFFFFF" name={isCandidateMatched ? 'message.fill' : 'heart.fill'} size={23} />
                </View>
                <Text style={styles.likeButtonText}>{isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}</Text>
              </Pressable>
            </Animated.View>
          </View>
          <Text pointerEvents="none" style={styles.swipeHint}>
            {isCandidateMatched ? 'ปัดซ้ายเพื่อข้าม · ปัดขวาเพื่อไปห้องแชต' : 'ปัดซ้ายเพื่อไม่เลือก · ปัดขวาเพื่อถูกใจ'}
          </Text>
        </>
      ) : null}
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, colors, styles }) {
  return (
    <View style={styles.infoRow}>
      <FeatureIcon color={colors.primary} name={icon} size={20} />
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || 'ไม่ระบุ'}</Text>
      </View>
    </View>
  );
}



const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  animatedContent: { flex: 1 },
  decisionBadge: { borderRadius: radius.pill, borderWidth: 2, paddingHorizontal: 16, paddingVertical: 9, position: 'absolute', top: 92, zIndex: 12 },
  skipBadge: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: colors.primary, left: 20, transform: [{ rotate: '-8deg' }] },
  likeBadge: { backgroundColor: colors.primary, borderColor: '#FFFFFF', right: 20, transform: [{ rotate: '8deg' }] },
  skipBadgeText: { color: colors.primary, fontSize: type.body, fontWeight: '900' },
  likeBadgeText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '900' },
  fixedHeader: { alignItems: 'center', backgroundColor: colors.glass, borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', height: 68, left: 0, paddingHorizontal: spacing.lg, position: 'absolute', right: 0, top: 0, zIndex: 20 },
  headerBackButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { marginLeft: spacing.md },
  headerTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  headerSubtitle: { color: colors.inkMuted, fontSize: type.micro, fontWeight: '600', marginTop: 2 },
  scrollContent: { paddingBottom: 132, paddingTop: 68 },
  hero: { height: 420, overflow: 'hidden', position: 'relative' },
  heroImage: { height: '100%', width: '100%' },
  heroOverlay: { backgroundColor: 'rgba(0,0,0,0.24)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroCopy: { bottom: spacing.xl, left: spacing.xl, position: 'absolute', right: spacing.xl },
  heroName: { color: colors.card, fontSize: 34, fontWeight: '900' },
  heroActivity: { color: colors.card, fontSize: type.body, fontWeight: '700', marginTop: 5 },
  body: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -24, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  identityRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xl },
  identityCopy: { flex: 1, paddingRight: spacing.md },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 4 },
  compatibility: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, minWidth: 72, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  compatibilityValue: { color: colors.primary, fontSize: 17, fontWeight: '900' },
  compatibilityLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '700', marginTop: 1 },
  infoRow: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: 9, padding: spacing.md },
  infoCopy: { flex: 1, marginLeft: spacing.md },
  infoLabel: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '700' },
  infoValue: { color: colors.ink, fontSize: type.body, fontWeight: '800', marginTop: 2 },
  meetupCard: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.md, padding: spacing.lg },
  meetupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  meetupTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  meetupSectionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  meetupTag: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  meetupTagText: { color: colors.primary, fontSize: type.micro, fontWeight: '800' },
  meetupItemRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  meetupMsgRow: { alignItems: 'flex-start', marginTop: spacing.sm },
  meetupName: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  meetupTime: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '600' },
  meetupPeople: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '600' },
  meetupMsg: { color: colors.ink, flex: 1, fontSize: type.body, lineHeight: 20 },
  bioSection: { backgroundColor: colors.primarySoft, borderRadius: radius.md, marginTop: spacing.md, padding: spacing.lg },
  bioTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  bio: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm },
  tagsTitle: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '800', marginTop: spacing.lg },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  floatingActions: { alignItems: 'center', bottom: 24, flexDirection: 'row', justifyContent: 'space-between', left: actionSideInset, position: 'absolute', right: actionSideInset, zIndex: 30 },
  swipeHint: { bottom: 6, color: colors.inkSoft, fontSize: type.micro, left: 0, position: 'absolute', right: 0, textAlign: 'center', zIndex: 29 },
  actionButton: { alignItems: 'center', borderRadius: 34, flexDirection: 'row', height: 68, justifyContent: 'center', shadowColor: '#000000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 12, width: actionButtonWidth },
  actionIcon: { alignItems: 'center', borderRadius: 21, height: 42, justifyContent: 'center', marginRight: 9, width: 42 },
  skipButton: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1 },
  skipIcon: { backgroundColor: colors.primarySoft },
  skipIconText: { color: colors.primary, fontSize: 31, fontWeight: '500', lineHeight: 34, marginTop: -2 },
  skipButtonText: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  likeButton: { backgroundColor: colors.primary },
  likeIcon: { backgroundColor: 'rgba(255,255,255,0.18)' },
  likeButtonText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '900' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', marginTop: spacing.lg },
  backButton: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.lg, padding: spacing.md },
  backButtonText: { color: colors.primary, fontSize: type.body, fontWeight: '800', marginLeft: spacing.xs },
});
