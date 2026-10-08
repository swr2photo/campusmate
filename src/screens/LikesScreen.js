import Text from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useAppActions, useAppFeed } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import { Card, OutlineButton, PrimaryButton } from '../components/ui';
import { IosLikeAvatar, IosLikeScreen } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { useEntitlement } from '../context/MembershipContext';
import { TourTarget } from '../context/AppTourContext';
import { FEATURE_INCOMING_LIKE_PROFILES } from '../data/plans';
import { LikesSkeletonList } from '../components/LikesSkeleton';
import StorysetStateView from '../components/StorysetStateView';
import { getDisplayImageUri, useRemoteImage } from '../utils/useRemoteImage';
import { radius, spacing, type, useTheme } from '../theme';
import { formatAvailabilitySlots } from '../utils/formatters';

const TABS = [
  { id: 'pending', label: 'ถูกใจคุณ' },
  { id: 'accepted', label: 'จับคู่แล้ว' },
];

export default function LikesScreen({ onClose, onOpenChat, onToast }) {
  const { colors } = useTheme();
  // "ดูว่าใครกดถูกใจคุณ" is CampusMate Plus. While the plan is loading show the skeleton, not the paywall.
  const likesEntitlement = useEntitlement(FEATURE_INCOMING_LIKE_PROFILES);
  const locked = likesEntitlement.locked;
  const { confirm } = useConfirm();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const {
    acceptedIncomingLikes = [],
    pendingIncomingLikes = [],
    pendingIncomingLikeCount,
    hasMorePendingLikes,
    isLoadingMorePendingLikes,
    isLikesLoading = false,
    likesError = null,
  } = useAppFeed();
  const incomingCount = pendingIncomingLikeCount ?? pendingIncomingLikes.length;
  const { ensureConversation, respondToLike, syncNow, loadMoreIncomingLikes } = useAppActions();
  const [activeTab, setActiveTab] = useState('pending');
  const [processingId, setProcessingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);

  // If loading takes > 8 seconds without any cached likes, trigger the Freepik Storyset error state
  useEffect(() => {
    if (!isLikesLoading) {
      setHasTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      if (isLikesLoading && !pendingIncomingLikes.length && !acceptedIncomingLikes.length) {
        setHasTimedOut(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLikesLoading, pendingIncomingLikes.length, acceptedIncomingLikes.length]);

  const visibleLikes = activeTab === 'pending'
    ? pendingIncomingLikes
    : acceptedIncomingLikes;

  const hasCachedLikes = pendingIncomingLikes.length > 0 || acceptedIncomingLikes.length > 0;
  const showError = (hasTimedOut || Boolean(likesError)) && !hasCachedLikes;
  const showSkeleton = ((isLikesLoading && !hasCachedLikes) || (likesEntitlement.loading && activeTab === 'pending')) && !showError;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setHasTimedOut(false);
    try {
      if (typeof syncNow === 'function') await syncNow();
    } catch (_) {}
    finally {
      setRefreshing(false);
    }
  }, [syncNow]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setHasTimedOut(false);
    try {
      if (typeof syncNow === 'function') await syncNow();
    } catch (_) {}
    finally {
      setIsRetrying(false);
    }
  }, [syncNow]);

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

  const handleOpenChat = useCallback(async (like) => {
    if (processingId) return;
    setProcessingId(like.id);
    try {
      const conversationId = await ensureConversation(like);
      onOpenChat?.(conversationId);
    } catch (error) {
      console.error('[LikesScreen] handleOpenChat error:', error);
      onToast?.('ยังเปิดห้องแชตไม่ได้ กรุณาลองใหม่อีกครั้ง', 'info');
    } finally {
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
      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}><FeatureIcon color={colors.coral} name="heart.circle.fill" size={26} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>
            {activeTab === 'pending'
              ? (incomingCount ? `มี ${incomingCount} คนกดใจคุณ` : 'ไม่มีคำขอใหม่ในตอนนี้')
              : (acceptedIncomingLikes.length ? `จับคู่สำเร็จแล้ว ${acceptedIncomingLikes.length} คน` : 'ยังไม่มีคู่ที่จับคู่แล้ว')}
          </Text>
          <Text style={styles.summaryText}>
            {activeTab === 'pending'
              ? (locked ? 'CampusMate Plus ดูว่าใครกดใจคุณได้' : 'คุณเลือกได้อย่างสบายใจ การปฏิเสธจะไม่แจ้งเตือนอีกฝ่าย')
              : 'เริ่มส่งข้อความหรือชวนไปทำกิจกรรมร่วมกันได้เลย'}
          </Text>
        </View>
      </View>

      <TourTarget id="likes.tabs" style={styles.tabs}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = tab.id === 'pending'
            ? incomingCount
            : acceptedIncomingLikes.length;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
              {count > 0 && <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}><Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>{count}</Text></View>}
            </Pressable>
          );
        })}
      </TourTarget>
    </View>
  );

  const renderItem = useCallback(({ item }) => (
    <LikeCard
      accepted={activeTab === 'accepted'}
      like={item}
      onAccept={handleAccept}
      onOpenChat={handleOpenChat}
      onRemove={handleRemoveMatch}
      onReject={handleReject}
      processing={processingId === item.id}
      styles={styles}
    />
  ), [activeTab, handleAccept, handleOpenChat, handleReject, handleRemoveMatch, processingId, styles]);

  return (
    <IosLikeScreen>
      <FlatList
        data={showSkeleton || showError ? [] : visibleLikes}
        keyExtractor={(item) => item.id}
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
          locked && activeTab === 'pending' && !showSkeleton && !showError ? (
            <StorysetStateView type="empty" title={`มี ${incomingCount} คนกดใจคุณ`}
              description="CampusMate Plus ดูรายชื่อและรูปของคนที่กดใจคุณได้ การจับคู่และแชตที่ยอมรับแล้วใช้งานต่อได้"
              actionLabel="ดู CampusMate Plus" actionIcon="lock.fill" onAction={() => router.push('/membership')} />
          ) : showSkeleton ? (
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
              {activeTab === 'pending' && !locked && hasMorePendingLikes ? <OutlineButton disabled={isLoadingMorePendingLikes}
                label={isLoadingMorePendingLikes ? 'กำลังโหลด…' : 'ดูคนที่กดใจเพิ่มเติม'} onPress={loadMoreIncomingLikes} /> : null}
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

const LikeCard = React.memo(function LikeCard({ accepted, like, onAccept, onOpenChat, onReject, onRemove, processing, styles }) {
  const { colors } = useTheme();
  const cardStyles = styles || getStyles(colors);
  const imageUri = getDisplayImageUri(
    useRemoteImage(like.avatarUri, like.avatarRevision, like.id),
    like.avatarUri
  );
  const handleAcceptPress = () => onAccept?.(like);
  const handleRejectPress = () => onReject?.(like);
  const handleRemovePress = () => onRemove?.(like);
  const handleOpenChatPress = () => onOpenChat?.(like);
  return (
    <Card style={cardStyles.likeCard}>
      <View style={[cardStyles.likeHero, { backgroundColor: like.avatarColor || colors.primarySoft }]}>
        {imageUri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={like.id} source={{ uri: imageUri }} style={StyleSheet.absoluteFill} transition={0} /> : <IosLikeAvatar color={like.avatarColor} emoji={like.avatar} size={92} />}
      </View>
      <View style={cardStyles.likeHeroCopy}>
        <Text numberOfLines={1} style={[cardStyles.heroName, { color: colors.ink }]}>{like.name}{like.age ? `, ${like.age}` : ''}</Text>
        <Text numberOfLines={1} style={[cardStyles.heroFaculty, { color: colors.inkMuted }]}>{like.faculty || like.nickname}</Text>
      </View>

      <View style={cardStyles.likeBody}>
        <View style={cardStyles.likeMessageRow}>
          <FeatureIcon color={colors.coral} name="quote.bubble.fill" size={17} />
          <Text style={cardStyles.message}>{like.likeMessage || 'สนใจอยากทำความรู้จัก'}</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
          <View style={cardStyles.metaChips}>
            {like.year ? <MetaChip icon="graduationcap.fill" label={like.year} styles={cardStyles} /> : null}
            {like.activityLabel ? <MetaChip icon="figure.run" label={like.activityLabel} styles={cardStyles} /> : null}
            {like.location ? <MetaChip icon="mappin.and.ellipse" label={like.location} styles={cardStyles} /> : null}
            {(like.availabilitySlots && like.availabilitySlots.length > 0) ? (
              <MetaChip icon="clock.fill" label={formatAvailabilitySlots(like.availabilitySlots, { compact: true })} styles={cardStyles} />
            ) : like.availability ? (
              <MetaChip icon="clock.fill" label={like.availability} styles={cardStyles} />
            ) : null}
          </View>
        </ScrollView>

        {accepted ? (
          <View style={cardStyles.actionRow}>
            <OutlineButton disabled={processing} danger iconName="person.2.slash" label="ยกเลิกจับคู่" onPress={handleRemovePress} style={cardStyles.rejectButton} />
            <PrimaryButton disabled={processing} iconName="message.fill" label="เปิดห้องแชต" onPress={handleOpenChatPress} style={cardStyles.acceptButton} />
          </View>
        ) : (
          <View style={cardStyles.actionRow}>
            <OutlineButton disabled={processing} danger iconName="xmark.circle.fill" label="ไม่รับตอนนี้" onPress={handleRejectPress} style={cardStyles.rejectButton} />
            <PrimaryButton disabled={processing} iconName="person.badge.plus" label="รับเป็นเพื่อน" loading={processing} onPress={handleAcceptPress} style={cardStyles.acceptButton} />
          </View>
        )}
      </View>
    </Card>
  );
});

function MetaChip({ icon, label, styles: cardStyles }) {
  const { colors } = useTheme();
  return (
    <View style={[cardStyles.metaChip, { backgroundColor: colors.surfaceRaised }]}>
      <FeatureIcon color={colors.inkSoft} name={icon} size={12} />
      <Text numberOfLines={1} style={[cardStyles.metaChipText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  summaryCard: { alignItems: 'center', backgroundColor: colors.coralSoft, borderCurve: 'continuous', borderRadius: radius.lg, flexDirection: 'row', marginBottom: spacing.lg, padding: spacing.md },
  summaryIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 22, height: 44, justifyContent: 'center', marginRight: spacing.md, width: 44 },
  summaryIconText: { color: colors.coral, fontSize: 23, fontWeight: '900' },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  summaryText: { color: colors.inkMuted, fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  tabs: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.lg, padding: 4 },
  tab: { alignItems: 'center', borderRadius: radius.pill, flex: 1, flexDirection: 'row', justifyContent: 'center', minHeight: 40, paddingHorizontal: spacing.sm },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '900' },
  tabTextActive: { color: colors.onPrimary },
  tabBadge: { alignItems: 'center', backgroundColor: colors.coralSoft, borderRadius: 10, marginLeft: 5, minWidth: 20, paddingHorizontal: 5, paddingVertical: 2 },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabBadgeText: { color: colors.coral, fontSize: 10, fontWeight: '900' },
  tabBadgeTextActive: { color: colors.onPrimary },
  likeCard: { marginBottom: spacing.md, overflow: 'hidden', padding: 0 },
  likeHero: { height: 180, overflow: 'hidden' },
  likeHeroCopy: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  heroName: { fontSize: type.title, fontWeight: '600' },
  heroFaculty: { fontSize: type.caption, fontWeight: '400', marginTop: 3 },
  likeBody: { padding: spacing.lg },
  likeMessageRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  metaChips: { flexDirection: 'row', gap: spacing.sm, paddingBottom: 2 },
  metaChip: { alignItems: 'center', borderRadius: radius.pill, flexDirection: 'row', gap: 4, minHeight: 31, paddingHorizontal: 9 },
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
  actionRow: { flexDirection: 'row', marginTop: spacing.md },
  rejectButton: { flex: 1.15, minHeight: 46, paddingHorizontal: 8 },
  acceptButton: { flex: 1.05, marginLeft: spacing.sm, minHeight: 46, paddingHorizontal: spacing.sm },
  chatButton: { marginTop: spacing.md, minHeight: 46 },
  emptyCard: { alignItems: 'center', marginTop: spacing.sm, padding: spacing.xxl },
  emptyEmoji: { fontSize: 28, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  privacyRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  privacyNote: { color: colors.inkSoft, flexShrink: 1, fontSize: type.micro, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
