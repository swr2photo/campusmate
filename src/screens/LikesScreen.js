import { Pressable } from '../components/NativePressable';
import NativeCard from '../components/NativeCard';
import Text from '../components/AppText';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { project, rubberband } from '../utils/motion';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withTimeout } from '../utils/withTimeout';
import { FlatList, Platform, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useAppActions, useAppFeed, useAppProfile } from '../context/AppContext';
import * as Haptics from 'expo-haptics';
import LikesHeroBanner from '../components/likes/LikesHeroBanner';
import CompatibilityRing from '../components/status/CompatibilityRing';
import { chemistryFor, hasChemistry } from '../utils/chemistry';
import { useConfirm } from '../context/ConfirmContext';
import LiquidGlassSegmentedControl from '../components/LiquidGlassSegmentedControl';
import { Card, OutlineButton, PrimaryButton } from '../components/ui';
import { IosLikeAvatar, IosLikeScreen } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { useEntitlement, useMembership } from '../context/MembershipContext';
import { TourTarget } from '../context/AppTourContext';
import { FEATURE_INCOMING_LIKE_PROFILES } from '../data/plans';
import { LikesSkeletonList } from '../components/LikesSkeleton';
import StorysetStateView from '../components/StorysetStateView';
import TabPageHeader, { StatusBarScrim } from '../components/TabPageHeader';
import { getDisplayImageUri, useRemoteImage } from '../utils/useRemoteImage';
import { motion, radius, spacing, type, useTheme } from '../theme';
import { formatStudyYearLabel } from '../utils/studentId';

// Matched card layout: card is 4:1 (width:height), profile photo is 4:3 with a
// progressive blur toward the right. Actions are revealed by swiping the card left.
const MATCHED_CARD_ASPECT = 4;
const MATCHED_PHOTO_ASPECT = 4 / 3;
const MATCHED_ACTION_WIDTH = 84;
const MATCHED_ACTIONS_WIDTH = MATCHED_ACTION_WIDTH * 2;
const MATCHED_SPRING = { duration: 400, dampingRatio: 0.8, overshootClamping: true };
// Share of the card width taken by the 4:3 photo (card 4:1 → photo ≈ 1/3).
const MATCHED_PHOTO_FRACTION = MATCHED_PHOTO_ASPECT / MATCHED_CARD_ASPECT;
const IS_IOS = Platform.OS === 'ios';

// Quick filters. "เพิ่งกดใจ" uses the time of the like: people who have not
// matched with you do not share their online status, so it cannot be shown.
const LIKE_FILTERS = [
  { id: 'all', label: 'ทั้งหมด', icon: 'sparkles' },
  { id: 'chemistry', label: 'เคมีตรงกัน', icon: 'heart.fill' },
  { id: 'faculty', label: 'คณะเดียวกัน', icon: 'building.columns.fill' },
  { id: 'recent', label: 'เพิ่งกดใจ', icon: 'clock.fill' },
];
const RECENT_MS = 24 * 60 * 60 * 1000;

function likeMillis(like) {
  const value = like?.createdAt;
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Filter chip whose icon pops when selected. */
function LikeFilterChip({ item, active, onPress, colors }) {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (active) pop.set(withSpring(1, motion.spring.bouncy));
  }, [active, pop]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        pop.set(0.6);
        onPress(item.id);
      }}
      style={[likeFilterStyles.chip, { backgroundColor: active ? colors.primary : colors.chipIdle }]}
    >
      <Animated.View style={iconStyle}>
        <FeatureIcon name={item.icon} size={14} color={active ? '#FFFFFF' : colors.inkMuted} />
      </Animated.View>
      <Text numberOfLines={1} style={[likeFilterStyles.text, { color: active ? '#FFFFFF' : colors.inkMuted }]}>{item.label}</Text>
    </Pressable>
  );
}

const likeFilterStyles = StyleSheet.create({
  row: { gap: 8, paddingBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19 },
  text: { fontSize: 13, fontWeight: '700' },
});

const TABS = [
  { id: 'pending', label: 'ถูกใจคุณ' },
  { id: 'accepted', label: 'จับคู่แล้ว' },
];

// `tabTitle` is set only when this screen is the Likes tab on iOS, where the
// title scrolls with the list instead of sitting in a native navigation bar.
export default function LikesScreen({ onClose, onOpenChat, onToast, tabTitle }) {
  const { colors, isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = (Platform.OS === 'ios' && Boolean(Platform.isPad)) || windowWidth >= 700;
  // "ดูว่าใครกดถูกใจคุณ" is CampusMate Plus. While the plan is loading show the skeleton, not the paywall.
  const likesEntitlement = useEntitlement(FEATURE_INCOMING_LIKE_PROFILES);
  const locked = likesEntitlement.locked;
  const { confirm } = useConfirm();
  const styles = useMemo(() => getStyles(colors, isDark, isTablet), [colors, isDark, isTablet]);

  const {
    acceptedIncomingLikes = [],
    pendingIncomingLikes = [],
    pendingIncomingLikeCount,
    hasMorePendingLikes,
    isLoadingMorePendingLikes,
    isLikesLoading = false,
    likesError = null,
  } = useAppFeed();
  const incomingCount = locked
    ? (pendingIncomingLikeCount || 0)
    : pendingIncomingLikes.length;
  const { ensureConversation, respondToLike, syncNow, loadMoreIncomingLikes, refreshLikes } = useAppActions();
  const { profile: me } = useAppProfile();
  const [activeTab, setActiveTab] = useState('pending');
  const [likeFilter, setLikeFilter] = useState('all');
  const chemistryById = useMemo(() => {
    const map = new Map();
    [...pendingIncomingLikes, ...acceptedIncomingLikes].forEach((like) => { if (like?.id) map.set(like.id, chemistryFor(me, like)); });
    return map;
  }, [acceptedIncomingLikes, me, pendingIncomingLikes]);
  const chemistryCount = useMemo(
    () => pendingIncomingLikes.filter((like) => hasChemistry(chemistryById.get(like.id))).length,
    [chemistryById, pendingIncomingLikes],
  );
  const tabConfigs = useMemo(() => [
    { id: 'pending', label: 'ถูกใจคุณ', badgeCount: incomingCount },
    { id: 'accepted', label: 'จับคู่แล้ว', badgeCount: acceptedIncomingLikes.length },
  ], [incomingCount, acceptedIncomingLikes.length]);
  const [processingId, setProcessingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);

  // If loading takes > 15 seconds without any cached likes, trigger the Freepik Storyset error state
  useEffect(() => {
    if (!isLikesLoading) {
      setHasTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      if (isLikesLoading && !pendingIncomingLikes.length && !acceptedIncomingLikes.length) {
        setHasTimedOut(true);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [isLikesLoading, pendingIncomingLikes.length, acceptedIncomingLikes.length]);

  const placeholderLockedLikes = useMemo(() => {
    if (!locked || activeTab !== 'pending' || !incomingCount) return [];
    const count = Math.min(Math.max(incomingCount, 1), 6);
    return Array.from({ length: count }, (_, index) => ({
      id: `locked_like_${index}`,
      isLockedPreview: true,
      index,
    }));
  }, [locked, activeTab, incomingCount]);

  const visibleLikes = useMemo(() => {
    if (activeTab === 'pending' && locked) return placeholderLockedLikes;
    const list = activeTab === 'pending' ? pendingIncomingLikes : acceptedIncomingLikes;
    if (likeFilter === 'chemistry') return list.filter((like) => hasChemistry(chemistryById.get(like.id)));
    if (likeFilter === 'faculty') return me?.faculty ? list.filter((like) => like.faculty === me.faculty) : list;
    if (likeFilter === 'recent') return list.filter((like) => Date.now() - likeMillis(like) < RECENT_MS);
    return list;
  }, [activeTab, locked, placeholderLockedLikes, pendingIncomingLikes, acceptedIncomingLikes, likeFilter, chemistryById, me?.faculty]);

  const hasCachedLikes = activeTab === 'pending'
    ? (locked ? incomingCount > 0 : pendingIncomingLikes.length > 0)
    : acceptedIncomingLikes.length > 0;
  const showError = (hasTimedOut || Boolean(likesError)) && !hasCachedLikes;
  const showSkeleton = ((isLikesLoading && !hasCachedLikes) || (likesEntitlement.loading && activeTab === 'pending')) && !showError;

  const membership = useMembership();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setHasTimedOut(false);
    try {
      if (typeof membership?.refresh === 'function') await membership.refresh().catch(() => {});
      if (typeof refreshLikes === 'function') await refreshLikes();
      if (typeof syncNow === 'function') await syncNow();
    } catch (err) {
      console.warn('[LikesScreen] handleRefresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [membership, refreshLikes, syncNow]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setHasTimedOut(false);
    try {
      if (typeof membership?.refresh === 'function') await membership.refresh().catch(() => {});
      if (typeof refreshLikes === 'function') await refreshLikes();
      if (typeof syncNow === 'function') await syncNow();
    } catch (err) {
      console.warn('[LikesScreen] handleRetry error:', err);
    } finally {
      setIsRetrying(false);
    }
  }, [membership, refreshLikes, syncNow]);

  const handleResponse = useCallback(async (like, response) => {
    if (processingId) return;

    setProcessingId(like.id);
    try {
      const conversationId = await respondToLike(like, response);
      if (response === 'accept') {
        const targetConversationId = typeof conversationId === 'string'
          ? conversationId
          : await ensureConversation(like);
        onToast?.(`จับคู่กับ ${like.name} แล้ว เริ่มแชตได้เลย`, 'success');
        onOpenChat?.(targetConversationId);
      } else {
        onToast?.('นำคำขอนี้ออกจากรายการแล้ว', 'info');
      }
    } catch (error) {
      console.error('[LikesScreen] handleResponse error:', error);
      onToast?.('ยังดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setProcessingId(null);
    }
  }, [ensureConversation, onOpenChat, onToast, processingId, respondToLike]);

  const handleAccept = useCallback((like) => handleResponse(like, 'accept'), [handleResponse]);
  const handleReject = useCallback((like) => handleResponse(like, 'reject'), [handleResponse]);

  const openingChatRef = useRef(false);
  const handleOpenChat = useCallback(async (like) => {
    if (processingId || openingChatRef.current) return;
    openingChatRef.current = true;
    setProcessingId(like.id);
    try {
      const conversationId = await withTimeout(() => ensureConversation(like), 15000, 'เปิดห้องแชตใช้เวลานาน กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
      onOpenChat?.(conversationId);
    } catch (error) {
      console.error('[LikesScreen] handleOpenChat error:', error);
      onToast?.(error?.code === 'operation-timeout' ? error.message : 'ยังเปิดห้องแชตไม่ได้ กรุณาลองใหม่อีกครั้ง', 'info');
    } finally {
      openingChatRef.current = false;
      setProcessingId(null);
    }
  }, [ensureConversation, onOpenChat, onToast, processingId]);

  const handleRemoveMatch = useCallback(async (like) => {
    if (processingId) return;
    const ok = await confirm({
      title: 'ยืนยันการยกเลิกจับคู่',
      body: `ต้องการยกเลิกการจับคู่กับ ${like.name} หรือไม่?`,
      cancelLabel: 'ไม่ยกเลิก',
      confirmLabel: 'ยืนยัน',
      icon: 'heart.slash',
    });
    if (!ok) return;
    setProcessingId(like.id);
    try {
      await respondToLike(like, 'reject');
      onToast?.(`ยกเลิกการจับคู่กับ ${like.name} แล้ว`, 'info');
    } catch (error) {
      console.error('[LikesScreen] handleRemoveMatch error:', error);
      onToast?.('ยังยกเลิกไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setProcessingId(null);
    }
  }, [confirm, onToast, processingId, respondToLike]);

  const header = (
    <View>
      {tabTitle ? <TabPageHeader title={tabTitle} style={styles.tabTitle} /> : null}
      {locked && activeTab === 'pending' && incomingCount > 0 ? (
        <Pressable
          accessibilityLabel="ปลดล็อก CampusMate Plus ดูว่าใครกดใจคุณ"
          accessibilityRole="button"
          onPress={() => router.push('/membership')}
          style={({ pressed }) => [styles.plusPromoBanner, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={isDark ? ['#2D1F08', '#1F1404'] : ['#FFF8E7', '#FEEDCB']}
            end={{ x: 1, y: 0 }}
            start={{ x: 0, y: 0 }}
            style={styles.plusPromoGradient}
          >
            <View style={styles.plusPromoIcon}>
              <FeatureIcon color="#F59E0B" name="crown.fill" size={20} />
            </View>
            <View style={styles.plusPromoCopy}>
              <Text style={[styles.plusPromoTitle, { color: isDark ? '#FBBF24' : '#B45309' }]}>
                ปลดล็อกดูว่าใครกดใจคุณ
              </Text>
              <Text style={[styles.plusPromoSub, { color: isDark ? '#FDE68A' : '#92400E' }]}>
                ดูรูปภาพ คณะ และข้อความทักทายของทุกคนที่กดใจคุณได้ไม่จำกัด
              </Text>
            </View>
            <FeatureIcon color={isDark ? '#FBBF24' : '#B45309'} name="chevron.right" size={16} />
          </LinearGradient>
        </Pressable>
      ) : null}

      <LikesHeroBanner likedCount={incomingCount} chemistryCount={chemistryCount} locked={locked} />

      <TourTarget id="likes.tabs" style={styles.tabsContainer}>
        <LiquidGlassSegmentedControl
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          tabs={tabConfigs}
        />
      </TourTarget>

      {!(locked && activeTab === 'pending') ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={likeFilterStyles.row}>
          {LIKE_FILTERS.map((item) => (
            <LikeFilterChip key={item.id} item={item} active={likeFilter === item.id} onPress={setLikeFilter} colors={colors} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  const renderItem = useCallback(({ item }) => {
    if (item.isLockedPreview) {
      return (
        <LockedBlurredLikeCard
          index={item.index}
          onUnlock={() => router.push('/membership')}
          styles={styles}
        />
      );
    }
    return (
      <LikeCard
        accepted={activeTab === 'accepted'}
        chemistry={chemistryById.get(item.id)}
        like={item}
        onAccept={handleAccept}
        onOpenChat={handleOpenChat}
        onRemove={handleRemoveMatch}
        onReject={handleReject}
        processing={processingId === item.id}
        styles={styles}
      />
    );
  }, [activeTab, chemistryById, handleAccept, handleOpenChat, handleReject, handleRemoveMatch, processingId, styles]);

  return (
    <IosLikeScreen>
      {tabTitle ? <StatusBarScrim /> : null}
      <FlatList
        key={isTablet ? 'tablet-likes-grid' : 'phone-likes-list'}
        data={showSkeleton || showError ? [] : visibleLikes}
        keyExtractor={(item) => item.id}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? styles.columnWrapper : undefined}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          showSkeleton ? (
            <LikesSkeletonList count={3} />
          ) : showError ? (
            <StorysetStateView
              type="error"
              title="โหลดข้อมูลไม่สำเร็จ"
              description="การเชื่อมต่อเครือข่ายขัดข้อง หรือใช้เวลานานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง"
              actionLabel="ลองใหม่อีกครั้ง"
              actionIcon="arrow.clockwise"
              actionLoading={isRetrying}
              onAction={handleRetry}
            />
          ) : (
            <StorysetStateView
              type="empty"
              image={activeTab === 'accepted' ? require('../../assets/mascot/likes-matched.png') : undefined}
              title={activeTab === 'pending' ? 'ยังไม่มีคนกดใจใหม่' : 'ยังไม่มีคู่ที่จับคู่แล้ว'}
              description={
                activeTab === 'pending'
                  ? 'เมื่อมีเพื่อนในมหาวิทยาลัยสนใจกิจกรรมเดียวกับคุณ รายการจะแสดงที่นี่'
                  : 'คนที่คุณรับเป็นเพื่อนแล้วจะแสดงในรายการนี้ เริ่มส่งข้อความทักทายได้เลย'
              }
              actionLabel={activeTab === 'pending' ? 'ค้นหาเพื่อนใหม่' : 'ดูคนที่กดใจคุณ'}
              actionIcon={activeTab === 'pending' ? 'sparkles' : 'heart.fill'}
              onAction={
                activeTab === 'pending'
                  ? () => {
                      if (onClose) {
                        onClose();
                      } else {
                        router.navigate('/home');
                      }
                    }
                  : () => setActiveTab('pending')
              }
            />
          )
        }
        ListFooterComponent={
          !showSkeleton && !showError ? (
            <View>
              {activeTab === 'pending' && !locked && hasMorePendingLikes ? (
                <OutlineButton disabled={isLoadingMorePendingLikes}
                  label={isLoadingMorePendingLikes ? 'กำลังโหลด…' : 'ดูคนที่กดใจเพิ่มเติม'} onPress={loadMoreIncomingLikes} />
              ) : null}
              {activeTab === 'pending' && locked && incomingCount > 0 ? (
                <NativeCard style={styles.lockedFooterCard}>
                  <PrimaryButton
                    iconName="sparkles"
                    label="ดูแพ็กเกจ CampusMate Plus ทั้งหมด"
                    onPress={() => router.push('/membership')}
                  />
                </NativeCard>
              ) : null}
              <View style={styles.privacyRow}>
                <FeatureIcon color={colors.inkSoft} name="lock.shield.fill" size={14} />
                <Text style={styles.privacyNote}>ข้อมูลของคุณได้รับการเข้ารหัสความปลอดภัย</Text>
              </View>
            </View>
          ) : null
        }
        initialNumToRender={6}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
    </IosLikeScreen>
  );
}

const LOCKED_CARD_GRADIENTS = [
  ['#FF7E67', '#6C5CE7', '#74B9FF'],
  ['#FD79A8', '#A29BFE', '#6C5CE7'],
  ['#FFA07A', '#E84393', '#F368E0'],
  ['#00B894', '#0984E3', '#6C5CE7'],
];

const LockedBlurredLikeCard = React.memo(function LockedBlurredLikeCard({ index = 0, onUnlock, styles }) {
  const { colors, isDark } = useTheme();
  const cardStyles = styles || getStyles(colors, isDark);
  const gradient = LOCKED_CARD_GRADIENTS[index % LOCKED_CARD_GRADIENTS.length];

  return (
    <Card style={cardStyles.likeCard}>
      <Pressable
        accessibilityLabel="ปลดล็อกโปรไฟล์คนที่กดถูกใจคุณด้วย CampusMate Plus"
        accessibilityRole="button"
        onPress={onUnlock}
        style={({ pressed }) => [pressed && cardStyles.pressed]}
      >
        <View style={cardStyles.likeHero}>
          <LinearGradient
            colors={gradient}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: 0.32 }]}>
            <FeatureIcon color="#FFFFFF" name="person.crop.circle.fill" size={110} />
          </View>
          <BlurView
            intensity={Platform.OS === 'ios' ? 85 : 95}
            style={StyleSheet.absoluteFill}
            tint={isDark ? 'dark' : 'light'}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.42)' : 'rgba(255, 255, 255, 0.32)' },
            ]}
          />

          <View style={cardStyles.lockedBadgeContainer}>
            <View style={cardStyles.lockedBadgePill}>
              <View style={cardStyles.lockedBadgeIconWrap}>
                <FeatureIcon color="#F59E0B" name="lock.fill" size={15} />
              </View>
              <Text style={cardStyles.lockedBadgeText}>มีคนกดใจคุณ • ปลดล็อกดูโปรไฟล์</Text>
            </View>
          </View>

          <LinearGradient
            colors={['rgba(0,0,0,0.38)', 'transparent', 'rgba(0,0,0,0.84)']}
            locations={[0, 0.45, 1]}
            style={cardStyles.heroGradientOverlay}
          >
            <View style={cardStyles.heroTopBadges}>
              <View style={cardStyles.heroLikeBadge}>
                <FeatureIcon color="#FFFFFF" name="heart.fill" size={12} />
                <Text style={cardStyles.heroLikeBadgeText}>ถูกใจคุณ</Text>
              </View>
              <View style={cardStyles.lockedSecretPill}>
                <FeatureIcon color={colors.coral} name="sparkles" size={11} />
                <Text style={cardStyles.lockedSecretText}>ลับเฉพาะ</Text>
              </View>
            </View>

            <View style={cardStyles.heroBottomCopy}>
              <View style={cardStyles.heroNameRow}>
                <Text numberOfLines={1} style={cardStyles.heroNameText}>
                  ใครบางคนใน ม.อ.
                </Text>
              </View>
              <Text numberOfLines={1} style={cardStyles.heroFacultyText}>
                นักศึกษามหาวิทยาลัยสงขลานครินทร์ • ซ่อนชื่อและคณะ
              </Text>
            </View>
          </LinearGradient>
        </View>

        <View style={cardStyles.likeBody}>
          <View style={cardStyles.likeMessageRow}>
            <FeatureIcon color={colors.coral} name="quote.bubble.fill" size={16} />
            <Text style={[cardStyles.messageText, { color: colors.inkMuted }]}>
              🔒 ข้อความทักทายถูกซ่อนไว้ • ปลดล็อกเพื่ออ่าน
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={cardStyles.metaChips}>
              <MetaChip icon="graduationcap.fill" label="•• ชั้นปี" styles={cardStyles} />
              <MetaChip icon="figure.run" label="กิจกรรมที่สนใจตรงกัน" styles={cardStyles} />
              <MetaChip icon="mappin.and.ellipse" label="วิทยาเขตหาดใหญ่" styles={cardStyles} />
              <MetaChip icon="clock.fill" label="เมื่อเร็วๆ นี้" styles={cardStyles} />
            </View>
          </ScrollView>

          <View style={cardStyles.actionRow}>
            <PrimaryButton
              iconName="sparkles"
              label="ปลดล็อกดูว่าใครกดใจคุณ"
              onPress={onUnlock}
              style={{ flex: 1, minHeight: 46, borderRadius: 23 }}
            />
          </View>
        </View>
      </Pressable>
    </Card>
  );
});

const LikeCard = React.memo(function LikeCard({ accepted, chemistry, like, onAccept, onOpenChat, onReject, onRemove, processing, styles }) {
  const { colors, isDark } = useTheme();
  const cardStyles = styles || getStyles(colors, isDark);
  const imageUri = getDisplayImageUri(
    useRemoteImage(like.avatarUri, like.avatarRevision, like.id),
    like.avatarUri
  );
  const handleAcceptPress = () => onAccept?.(like);
  const handleRejectPress = () => onReject?.(like);
  const handleRemovePress = () => onRemove?.(like);
  const handleOpenChatPress = () => onOpenChat?.(like);

  const isVerified = like.isFaceVerified === true || like.isAdmin === true || like.faceVerificationStatus === 'verified';
  const yearLabel = formatStudyYearLabel(like.year);
  const subtitle = [like.faculty, yearLabel].filter(Boolean).join(' • ') || like.nickname || 'นักศึกษามหาวิทยาลัยสงขลานครินทร์';

  if (accepted) {
    return (
      <Card style={cardStyles.likeCard}>
        <MatchedSwipeCard
          imageUri={imageUri}
          isVerified={isVerified}
          like={like}
          onOpenChat={handleOpenChatPress}
          onRemove={handleRemovePress}
          processing={processing}
          styles={cardStyles}
          subtitle={subtitle}
        />
      </Card>
    );
  }

  return (
    <Card style={cardStyles.likeCard}>
      <View style={[cardStyles.likeHero, { backgroundColor: like.avatarColor || colors.primarySoft }]}>
        {imageUri ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={like.id}
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            transition={150}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <IosLikeAvatar color={like.avatarColor} emoji={like.avatar} size={110} />
          </View>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.42)', 'transparent', 'rgba(0,0,0,0.86)']}
          locations={[0, 0.45, 1]}
          style={cardStyles.heroGradientOverlay}
        >
          <View style={cardStyles.heroTopBadges}>
            {accepted ? (
              <View style={[cardStyles.heroLikeBadge, { backgroundColor: 'rgba(16, 185, 129, 0.94)' }]}>
                <FeatureIcon color="#FFFFFF" name="checkmark.circle.fill" size={12} />
                <Text style={cardStyles.heroLikeBadgeText}>จับคู่แล้ว</Text>
              </View>
            ) : (
              <View style={cardStyles.heroLikeBadge}>
                <FeatureIcon color="#FFFFFF" name="heart.fill" size={12} />
                <Text style={cardStyles.heroLikeBadgeText}>ถูกใจคุณ</Text>
              </View>
            )}

            {chemistry?.score != null ? (
              <CompatibilityRing score={chemistry.score} size={58} label={chemistry.source === 'server' ? 'เข้ากัน' : 'ชอบเหมือนกัน'} />
            ) : isVerified ? (
              <View style={cardStyles.heroVerifiedPill}>
                <FeatureIcon color={isDark ? '#38BDF8' : '#0284C7'} name="checkmark.seal.fill" size={12} />
                <Text style={cardStyles.heroVerifiedText}>ยืนยันแล้ว</Text>
              </View>
            ) : null}
          </View>

          <View style={cardStyles.heroBottomCopy}>
            <View style={cardStyles.heroNameRow}>
              <Text numberOfLines={1} style={cardStyles.heroNameText}>
                {like.name}{like.age ? `, ${like.age}` : ''}
              </Text>
              {isVerified ? (
                <FeatureIcon color="#38BDF8" name="checkmark.seal.fill" size={18} />
              ) : null}
            </View>
            <Text numberOfLines={1} style={cardStyles.heroFacultyText}>
              {subtitle}
            </Text>
          </View>
        </LinearGradient>
      </View>

      <View style={cardStyles.likeBody}>
        <View style={cardStyles.likeMessageRow}>
          <FeatureIcon color={colors.coral} name="quote.bubble.fill" size={16} />
          <Text numberOfLines={2} style={[cardStyles.messageText, { color: colors.ink }]}>
            {like.likeMessage || 'สนใจอยากทำความรู้จัก และหากิจกรรมทำร่วมกันใน ม.อ.'}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={cardStyles.metaChips}>
            {yearLabel ? <MetaChip icon="graduationcap.fill" label={yearLabel} styles={cardStyles} /> : null}
            {like.activityLabel ? <MetaChip icon="figure.run" label={like.activityLabel} styles={cardStyles} /> : null}
            {like.location ? <MetaChip icon="mappin.and.ellipse" label={like.location} styles={cardStyles} /> : null}
          </View>
        </ScrollView>

        {accepted ? (
          <View style={cardStyles.actionRow}>
            <OutlineButton
              danger
              disabled={processing}
              iconName="person.2.slash"
              label="ยกเลิกจับคู่"
              onPress={handleRemovePress}
              style={cardStyles.rejectButton}
            />
            <PrimaryButton
              disabled={processing}
              iconName="bubble.left.and.bubble.right.fill"
              label="เปิดห้องแชต"
              onPress={handleOpenChatPress}
              style={cardStyles.acceptButton}
            />
          </View>
        ) : (
          <View style={cardStyles.actionRow}>
            <OutlineButton
              danger
              disabled={processing}
              iconName="xmark.circle.fill"
              label="ไม่รับตอนนี้"
              onPress={handleRejectPress}
              style={cardStyles.rejectButton}
            />
            <PrimaryButton
              disabled={processing}
              iconName="person.badge.plus"
              label="รับเป็นเพื่อน"
              loading={processing}
              onPress={handleAcceptPress}
              style={cardStyles.acceptButton}
            />
          </View>
        )}
      </View>
    </Card>
  );
});

function MatchedSwipeCard({ imageUri, isVerified, like, onOpenChat, onRemove, processing, styles: cardStyles, subtitle }) {
  const { colors } = useTheme();
  const translateX = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const settle = useCallback((open) => {
    translateX.set(withSpring(open ? -MATCHED_ACTIONS_WIDTH : 0, MATCHED_SPRING));
  }, [translateX]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(translateX.get());
    })
    .onUpdate((e) => {
      const next = dragStart.get() + e.translationX;
      if (next > 0) {
        translateX.set(rubberband(next, MATCHED_ACTIONS_WIDTH) * 0.35);
      } else if (next < -MATCHED_ACTIONS_WIDTH) {
        translateX.set(-MATCHED_ACTIONS_WIDTH + rubberband(next + MATCHED_ACTIONS_WIDTH, MATCHED_ACTIONS_WIDTH));
      } else {
        translateX.set(next);
      }
    })
    .onEnd((e, success) => {
      const projected = success ? translateX.get() + project(e.velocityX) : translateX.get();
      const shouldOpen = projected < -(MATCHED_ACTIONS_WIDTH * 0.45);
      translateX.set(withSpring(shouldOpen ? -MATCHED_ACTIONS_WIDTH : 0, {
        ...MATCHED_SPRING,
        velocity: success ? e.velocityX : 0,
      }));
    }), [dragStart, translateX]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const actionsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [-MATCHED_ACTIONS_WIDTH, -16, 0], [1, 0.5, 0], Extrapolation.CLAMP),
  }));

  // Tapping the card toggles the swipe actions so they are discoverable without a gesture.
  const handleCardPress = () => {
    settle(translateX.get() > -(MATCHED_ACTIONS_WIDTH / 2));
  };
  const handleChatAction = () => {
    settle(false);
    onOpenChat?.();
  };
  const handleRemoveAction = () => {
    settle(false);
    onRemove?.();
  };

  const name = `${like.name || ''}${like.age ? `, ${like.age}` : ''}`;

  return (
    <View style={cardStyles.matchedSwipe}>
      <Animated.View style={[cardStyles.matchedActions, actionsStyle]}>
        <Pressable
          accessibilityLabel={`เปิดห้องแชตกับ ${like.name || 'คนนี้'}`}
          accessibilityRole="button"
          disabled={processing}
          onPress={handleChatAction}
          style={({ pressed }) => [cardStyles.matchedAction, { backgroundColor: colors.primary }, pressed && cardStyles.matchedActionPressed]}
        >
          <FeatureIcon color="#FFFFFF" name="bubble.left.and.bubble.right.fill" size={20} />
          <Text numberOfLines={1} style={cardStyles.matchedActionText}>เปิดห้องแชต</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`ยกเลิกการจับคู่กับ ${like.name || 'คนนี้'}`}
          accessibilityRole="button"
          disabled={processing}
          onPress={handleRemoveAction}
          style={({ pressed }) => [cardStyles.matchedAction, { backgroundColor: colors.danger }, pressed && cardStyles.matchedActionPressed]}
        >
          <FeatureIcon color="#FFFFFF" name="person.2.slash" size={20} />
          <Text numberOfLines={1} style={cardStyles.matchedActionText}>ยกเลิกจับคู่</Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[cardStyles.matchedContent, contentStyle]}>
          <Pressable
            accessibilityActions={[
              { name: 'activate', label: 'เปิดห้องแชต' },
              { name: 'unmatch', label: 'ยกเลิกจับคู่' },
            ]}
            accessibilityHint="ปัดไปทางซ้ายเพื่อเปิดห้องแชตหรือยกเลิกจับคู่"
            accessibilityLabel={`${name} จับคู่แล้ว ${subtitle}`}
            accessibilityRole="button"
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'unmatch') onRemove?.();
              else onOpenChat?.();
            }}
            onPress={handleCardPress}
            style={cardStyles.matchedRow}
          >
            {/* Banner backdrop: Crisp photo fading seamlessly into dark card */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {imageUri ? (
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  recyclingKey={`${like.id}-backdrop`}
                  source={{ uri: imageUri }}
                  style={[StyleSheet.absoluteFill, { width: '56%' }]}
                />
              ) : (
                <LinearGradient
                  colors={[like.avatarColor || colors.primary, '#14161C']}
                  end={{ x: 1, y: 0.5 }}
                  start={{ x: 0, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <LinearGradient
                colors={[
                  'rgba(20, 22, 28, 0)',
                  'rgba(20, 22, 28, 0.42)',
                  'rgba(20, 22, 28, 0.90)',
                  '#14161C',
                ]}
                end={{ x: 0.65, y: 0.5 }}
                locations={[0.15, 0.35, 0.52, 0.70]}
                start={{ x: 0, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </View>

            {/* Left area: Avatar fallback if no image */}
            <View style={[cardStyles.matchedPhoto, !imageUri && { backgroundColor: like.avatarColor || colors.primarySoft }]}>
              {!imageUri ? (
                <View style={[StyleSheet.absoluteFill, cardStyles.matchedPhotoFallback]}>
                  <IosLikeAvatar color={like.avatarColor} emoji={like.avatar} size={52} />
                </View>
              ) : null}
            </View>

            <View style={cardStyles.matchedCopy}>
              <View style={cardStyles.matchedNameRow}>
                <Text numberOfLines={1} style={[cardStyles.matchedName, cardStyles.matchedOnBanner]}>{name}</Text>
                {isVerified ? <FeatureIcon color="#7CB8FF" name="checkmark.seal.fill" size={15} /> : null}
              </View>
              <Text numberOfLines={1} style={[cardStyles.matchedMeta, cardStyles.matchedOnBanner, { color: '#E2E8F0' }]}>{subtitle}</Text>
              <View style={cardStyles.matchedStatus}>
                <FeatureIcon color="#6EE7B7" name="checkmark.circle.fill" size={12} />
                <Text style={[cardStyles.matchedStatusText, { color: '#6EE7B7' }]}>จับคู่แล้ว</Text>
              </View>
            </View>

            <View style={cardStyles.matchedSwipeHint}>
              <FeatureIcon color="rgba(255,255,255,0.8)" name="chevron.left" size={14} />
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function MetaChip({ icon, label, styles: cardStyles }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[cardStyles.metaChip, { backgroundColor: colors.surfaceRaised }]}>
      <FeatureIcon color={colors.inkSoft} name={icon} size={12} />
      <Text numberOfLines={1} style={[cardStyles.metaChipText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const getStyles = (colors, isDark, isTablet) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  tabTitle: {
    marginBottom: spacing.sm,
  },
  listContent: {
    alignSelf: 'center',
    maxWidth: isTablet ? 1040 : '100%',
    padding: isTablet ? 24 : spacing.lg,
    paddingBottom: spacing.xxxl,
    width: '100%',
  },
  columnWrapper: {
    gap: isTablet ? 20 : spacing.md,
  },
  tabsContainer: { marginBottom: spacing.md },
  likeCard: {
    flex: isTablet ? 1 : undefined,
    width: isTablet ? undefined : '100%',
    maxWidth: isTablet ? '49.5%' : '100%',
    marginBottom: isTablet ? 20 : spacing.md,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    backgroundColor: colors.card,
    overflow: 'hidden',
    padding: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: isDark ? 0.35 : 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  // Matched card: 4:1 card, 4:3 photo on the left, actions behind the content.
  matchedSwipe: { aspectRatio: MATCHED_CARD_ASPECT, minHeight: 84, overflow: 'hidden', position: 'relative', width: '100%' },
  matchedActions: { bottom: 0, flexDirection: 'row', position: 'absolute', right: 0, top: 0, width: MATCHED_ACTIONS_WIDTH },
  matchedAction: { alignItems: 'center', gap: 4, justifyContent: 'center', paddingHorizontal: 4, width: MATCHED_ACTION_WIDTH },
  matchedActionPressed: { opacity: 0.75 },
  matchedActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  matchedContent: { ...StyleSheet.absoluteFill, backgroundColor: '#14161C' },
  matchedRow: { alignItems: 'stretch', flex: 1, flexDirection: 'row' },
  matchedPhoto: { aspectRatio: MATCHED_PHOTO_ASPECT, height: '100%' },
  matchedPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  matchedCopy: { flex: 1, justifyContent: 'center', minWidth: 0, paddingLeft: 16, paddingRight: 4, paddingVertical: 8 },
  matchedStatus: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.pill, flexDirection: 'row', gap: 3, marginTop: 6, paddingHorizontal: 7, paddingVertical: 2 },
  matchedOnBanner: { color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  matchedStatusText: { fontSize: 11, fontWeight: '800' },
  matchedNameRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  matchedName: { flexShrink: 1, fontSize: 17, fontWeight: '800' },
  matchedMeta: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  matchedSwipeHint: { alignItems: 'center', justifyContent: 'center', opacity: 0.6, paddingHorizontal: 10 },
  likeHero: {
    height: isTablet ? 300 : 260,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surfaceRaised,
  },
  heroGradientOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    padding: 14,
  },
  heroTopBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    zIndex: 3,
  },
  heroLikeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 75, 110, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  heroLikeBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  heroCompatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  heroCompatBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  heroVerifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.88)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  heroVerifiedText: {
    color: isDark ? '#38BDF8' : '#0284C7',
    fontSize: 11,
    fontWeight: '800',
  },
  heroBottomCopy: {
    gap: 3,
    zIndex: 3,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroNameText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroFacultyText: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 13,
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  likeHeroCopy: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  heroName: { fontSize: type.title, fontWeight: '600' },
  heroFaculty: { fontSize: type.caption, fontWeight: '400', marginTop: 3 },
  likeBody: { padding: 14, gap: 12 },
  likeMessageRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  messageText: {
    flex: 1,
    fontSize: type.caption,
    lineHeight: 18,
    fontWeight: '500',
  },
  metaChips: { flexDirection: 'row', gap: spacing.sm, paddingBottom: 2 },
  metaChip: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  metaChipText: { fontSize: type.caption2, fontWeight: '700' },
  cardTopRow: { alignItems: 'flex-start', flexDirection: 'row' },
  identityCopy: { flex: 1, marginLeft: spacing.md, paddingRight: spacing.sm },
  name: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  age: { color: colors.inkMuted, fontSize: 15, fontWeight: '700' },
  nickname: { color: colors.inkMuted, fontSize: type.micro, marginTop: 4 },
  compatibility: { alignSelf: 'flex-start', backgroundColor: colors.greenSoft, borderRadius: radius.pill, marginTop: 7, paddingHorizontal: 8, paddingVertical: 4 },
  compatibilityText: { color: colors.green, fontSize: 10, fontWeight: '900' },
  cardHeart: { color: colors.coral, fontSize: 20, fontWeight: '900' },
  metaRow: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.md },
  activityChip: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft, flexShrink: 1, minHeight: 32, paddingHorizontal: 9 },
  likedAt: { color: colors.inkSoft, flexShrink: 0, fontSize: 10, marginLeft: spacing.sm },
  outgoingBadge: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: 6, marginTop: spacing.sm, paddingHorizontal: 10, paddingVertical: 6 },
  outgoingBadgeText: { fontSize: type.caption2, fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  rejectButton: { flex: 1, minHeight: 46, borderRadius: 23, paddingHorizontal: 8 },
  acceptButton: { flex: 1.15, minHeight: 46, borderRadius: 23, paddingHorizontal: spacing.sm },
  chatButton: { marginTop: spacing.md, minHeight: 46 },
  emptyCard: { alignItems: 'center', marginTop: spacing.sm, padding: spacing.xxl },
  emptyEmoji: { fontSize: 28, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  privacyRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  privacyNote: { color: colors.inkSoft, flexShrink: 1, fontSize: type.micro, lineHeight: 16, textAlign: 'center' },
  lockedBadgeContainer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  lockedBadgePill: {
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.72)' : 'rgba(255, 255, 255, 0.92)',
    borderCurve: 'continuous',
    borderColor: isDark ? 'rgba(245, 158, 11, 0.45)' : 'rgba(245, 158, 11, 0.35)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    elevation: 4,
  },
  lockedBadgeIconWrap: {
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.22)' : 'rgba(254, 243, 199, 1)',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  lockedBadgeText: {
    color: isDark ? '#FBBF24' : '#B45309',
    fontSize: type.caption,
    fontWeight: '800',
  },
  lockedSecretPill: {
    alignItems: 'center',
    backgroundColor: colors.coralSoft,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockedSecretText: {
    color: colors.coral,
    fontSize: 10,
    fontWeight: '800',
  },
  lockedMessageRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderCurve: 'continuous',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  lockedMessageText: {
    color: colors.inkSoft,
    flex: 1,
    fontSize: type.caption,
    fontWeight: '600',
  },
  plusPromoBanner: {
    borderRadius: 18,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.2)',
  },
  plusPromoGradient: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: spacing.md,
  },
  plusPromoIcon: {
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FFFFFF',
    borderRadius: 16,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  plusPromoCopy: {
    flex: 1,
  },
  plusPromoTitle: {
    fontSize: type.body,
    fontWeight: '800',
  },
  plusPromoSub: {
    fontSize: type.micro,
    lineHeight: 16,
    marginTop: 2,
  },
  lockedFooterCard: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
