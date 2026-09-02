import React, { useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton } from '../components/ui';
import { IosLikeAvatar, IosLikeScreen } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { useRemoteImage } from '../utils/useRemoteImage';
import { radius, spacing, type, useTheme } from '../theme';

const TABS = [
  { id: 'pending', label: 'ถูกใจคุณ' },
  { id: 'accepted', label: 'จับคู่แล้ว' },
];

export default function LikesScreen({ onClose, onOpenChat, onToast }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const {
    acceptedIncomingLikes,
    ensureConversation,
    pendingIncomingLikes,
    respondToLike,
  } = useApp();
  const [activeTab, setActiveTab] = useState('pending');
  const [processingId, setProcessingId] = useState(null);

  const visibleLikes = activeTab === 'pending' ? pendingIncomingLikes : acceptedIncomingLikes;

  const handleResponse = async (like, response) => {
    if (processingId) return;

    setProcessingId(like.id);
    try {
      await respondToLike(like, response);
      if (response === 'accept') {
        const conversationId = await ensureConversation(like);
        onToast?.(`จับคู่กับ ${like.name} แล้ว เริ่มแชตได้เลย`, 'success');
        onOpenChat?.(conversationId);
      } else {
        onToast?.('นำคำขอนี้ออกจากรายการแล้ว', 'info');
      }
    } catch (error) {
      onToast?.('ยังดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setProcessingId(null);
    }
  };

  const handleOpenChat = async (like) => {
    if (processingId) return;
    setProcessingId(like.id);
    try {
      const conversationId = await ensureConversation(like);
      onOpenChat?.(conversationId);
    } catch (error) {
      onToast?.('ยังเปิดห้องแชตไม่ได้ กรุณาลองใหม่อีกครั้ง', 'info');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemoveMatch = async (like) => {
    if (processingId) return;
    setProcessingId(like.id);
    try {
      await respondToLike(like, 'reject');
      onToast?.(`ลบ ${like.name} ออกจากรายการจับคู่แล้ว`, 'info');
    } catch (error) {
      onToast?.('ยังดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setProcessingId(null);
    }
  };

  const header = (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="ย้อนกลับ"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>คนที่สนใจคุณ</Text>
        </View>
        <View style={styles.headerHeart}><FeatureIcon color={colors.coral} name="heart.fill" size={22} /></View>
      </View>

      <Text style={styles.subtitle}>เลือกคนที่อยากรู้จัก แล้วเริ่มเป็นเพื่อนกันได้เลย</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}><FeatureIcon color={colors.coral} name="heart.circle.fill" size={26} /></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>
            {pendingIncomingLikes.length ? `มี ${pendingIncomingLikes.length} คนรอคำตอบจากคุณ` : 'ไม่มีคำขอใหม่ในตอนนี้'}
          </Text>
          <Text style={styles.summaryText}>คุณเลือกได้อย่างสบายใจ การปฏิเสธจะไม่แจ้งเตือนอีกฝ่าย</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = tab.id === 'pending' ? pendingIncomingLikes.length : acceptedIncomingLikes.length;
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
      </View>
    </View>
  );

  return (
    <IosLikeScreen>
      <FlatList
        data={visibleLikes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <Card style={styles.emptyCard}>
            <FeatureIcon color={colors.coral} name={activeTab === 'pending' ? 'heart.slash' : 'person.2.fill'} size={42} />
            <Text style={styles.emptyTitle}>{activeTab === 'pending' ? 'ยังไม่มีคนกดใจใหม่' : 'ยังไม่มีคู่ที่จับคู่แล้ว'}</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'pending' ? 'เมื่อมีคนสนใจกิจกรรมเดียวกับคุณ รายการจะแสดงที่นี่' : 'คนที่คุณรับเป็นเพื่อนแล้วจะแสดงในรายการนี้'}
            </Text>
          </Card>
        )}
        ListFooterComponent={<View style={styles.privacyRow}><FeatureIcon color={colors.inkSoft} name="lock.shield.fill" size={14} /><Text style={styles.privacyNote}>ข้อมูลของคุณได้รับการเข้ารหัสความปลอดภัย</Text></View>}
        renderItem={({ item }) => (
          <LikeCard
            accepted={activeTab === 'accepted'}
            like={item}
            onAccept={() => handleResponse(item, 'accept')}
            onOpenChat={() => handleOpenChat(item)}
            onRemove={() => handleRemoveMatch(item)}
            onReject={() => handleResponse(item, 'reject')}
            processing={processingId === item.id}
            styles={styles}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    </IosLikeScreen>
  );
}

function LikeCard({ accepted, like, onAccept, onOpenChat, onReject, onRemove, processing, styles }) {
  const { colors } = useTheme();
  const cardStyles = styles || getStyles(colors);
  const imageUri = useRemoteImage(like.avatarUri);
  return (
    <Card style={cardStyles.likeCard}>
      <View style={[cardStyles.likeHero, { backgroundColor: like.avatarColor || colors.primarySoft }]}>
        {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} /> : <IosLikeAvatar color={like.avatarColor} emoji={like.avatar} size={92} />}
        <LinearGradient colors={['transparent', 'rgba(8,16,30,0.9)']} style={cardStyles.likeHeroGradient} />
        <View style={cardStyles.likeHeroCopy}>
          <Text numberOfLines={1} style={cardStyles.heroName}>{like.name}{like.age ? `, ${like.age}` : ''}</Text>
          <Text numberOfLines={1} style={cardStyles.heroFaculty}>{like.faculty || like.nickname}</Text>
        </View>
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
            {like.availability ? <MetaChip icon="clock.fill" label={like.availability} styles={cardStyles} /> : null}
          </View>
        </ScrollView>

        {accepted ? (
          <View style={cardStyles.actionRow}>
            <OutlineButton disabled={processing} danger icon="×" label="ลบ" onPress={onRemove} style={cardStyles.rejectButton} />
            <PrimaryButton disabled={processing} icon="→" label="เปิดห้องแชต" onPress={onOpenChat} style={cardStyles.acceptButton} />
          </View>
        ) : (
          <View style={cardStyles.actionRow}>
            <OutlineButton disabled={processing} danger icon="×" label="ไม่รับตอนนี้" onPress={onReject} style={cardStyles.rejectButton} />
            <PrimaryButton disabled={processing} icon="♥" label="รับเป็นเพื่อน" loading={processing} onPress={onAccept} style={cardStyles.acceptButton} />
          </View>
        )}
      </View>
    </Card>
  );
}

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
  header: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.sm },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: spacing.sm, width: 34 },
  backIcon: { color: colors.ink, fontSize: 38, fontWeight: '300', lineHeight: 38 },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.3, marginBottom: 3 },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '900' },
  headerHeart: { alignItems: 'center', backgroundColor: colors.coralSoft, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  headerHeartText: { color: colors.coral, fontSize: 23, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginBottom: spacing.lg },
  summaryCard: { alignItems: 'center', backgroundColor: colors.coralSoft, borderColor: colors.coralSoft, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.lg, padding: spacing.md },
  summaryIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 22, height: 44, justifyContent: 'center', marginRight: spacing.md, width: 44 },
  summaryIconText: { color: colors.coral, fontSize: 23, fontWeight: '900' },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  summaryText: { color: colors.inkMuted, fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  tabs: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.lg, padding: 4 },
  tab: { alignItems: 'center', borderRadius: radius.pill, flex: 1, flexDirection: 'row', justifyContent: 'center', minHeight: 40, paddingHorizontal: spacing.sm },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '900' },
  tabTextActive: { color: colors.card },
  tabBadge: { alignItems: 'center', backgroundColor: colors.coralSoft, borderRadius: 10, marginLeft: 5, minWidth: 20, paddingHorizontal: 5, paddingVertical: 2 },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabBadgeText: { color: colors.coral, fontSize: 10, fontWeight: '900' },
  tabBadgeTextActive: { color: colors.card },
  likeCard: { marginBottom: spacing.md, overflow: 'hidden', padding: 0 },
  likeHero: { height: 250, justifyContent: 'flex-end', overflow: 'hidden', position: 'relative' },
  likeHeroGradient: { bottom: 0, height: 130, left: 0, position: 'absolute', right: 0 },
  likeHeroCopy: { bottom: spacing.lg, left: spacing.lg, position: 'absolute', right: spacing.lg },
  heroName: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  heroFaculty: { color: 'rgba(255,255,255,0.86)', fontSize: type.caption, fontWeight: '700', marginTop: 3 },
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
  message: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 18 },
  actionRow: { flexDirection: 'row', marginTop: spacing.md },
  rejectButton: { flex: 0.95, minHeight: 46, paddingHorizontal: spacing.sm },
  acceptButton: { flex: 1.2, marginLeft: spacing.sm, minHeight: 46, paddingHorizontal: spacing.sm },
  chatButton: { marginTop: spacing.md, minHeight: 46 },
  emptyCard: { alignItems: 'center', marginTop: spacing.sm, padding: spacing.xxl },
  emptyEmoji: { fontSize: 42, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  privacyRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  privacyNote: { color: colors.inkSoft, flexShrink: 1, fontSize: type.micro, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
