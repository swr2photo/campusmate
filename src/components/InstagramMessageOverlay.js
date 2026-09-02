import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Clipboard,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import FeatureIcon from './FeatureIcon';
import { IOS_EMOJI_CATEGORIES } from '../data/iosEmojiCategories';
import { useRemoteImage } from '../utils/useRemoteImage';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😆', '👍'];
const MORE_REACTIONS = ['🔥', '🎉', '👏', '😍', '🙏', '💯', '🤝', '😡'];
export const DEFAULT_MESSAGE_REACTION = QUICK_REACTIONS[0];

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp?.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp?.seconds === 'number') return new Date(timestamp.seconds * 1000);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(item) {
  const date = toDate(item?.createdAt || item?.time);
  return date?.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  }) || '';
}

function MenuRow({ destructive = false, icon, label, onPress, trailing }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
    >
      <View style={styles.menuRowCopy}>
        <FeatureIcon color={destructive ? '#FF5A5F' : '#FFFFFF'} name={icon} size={18} />
        <Text numberOfLines={1} style={[styles.menuLabel, destructive && styles.destructiveLabel]}>{label}</Text>
      </View>
      {trailing ? <FeatureIcon color="rgba(255,255,255,0.42)" name="chevron.right" size={12} /> : null}
    </Pressable>
  );
}

function ForwardAvatar({ conversation, fallbackColor }) {
  const avatarUri = [conversation?.avatarUri, conversation?.photoURL, conversation?.avatarUrl]
    .find((value) => typeof value === 'string' && (
      value.startsWith('http://')
      || value.startsWith('https://')
      || value.startsWith('file://')
      || value.startsWith('data:image/')
    ));
  const cachedAvatarUri = useRemoteImage(avatarUri || null);
  // Render the remote URI immediately while the cache warms up, then switch
  // to the local cached file when it is ready.
  const imageUri = cachedAvatarUri || avatarUri;
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = conversation?.avatar || (conversation?.name || '?').slice(0, 1);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUri, cachedAvatarUri]);

  return (
    <View style={[styles.forwardAvatar, { backgroundColor: conversation?.avatarColor || fallbackColor }]}>
      {imageUri && !imageFailed ? (
        <Image
          accessibilityLabel={`รูปโปรไฟล์ ${conversation?.name || 'ผู้ใช้'}`}
          onError={() => setImageFailed(true)}
          source={{ uri: imageUri }}
          style={styles.forwardAvatarImage}
        />
      ) : (
        <Text style={styles.forwardAvatarText}>{fallback}</Text>
      )}
    </View>
  );
}

function GlassSurface({ children, intensity = 72, style }) {
  const surfaceStyle = [styles.glassSurface, style];
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={intensity} tint="dark" style={surfaceStyle}>
        {children}
      </BlurView>
    );
  }
  return <View style={[...surfaceStyle, styles.glassSurfaceFallback]}>{children}</View>;
}

function IOSReactionPicker({ accent, height, onClose, onSelect, selectedReaction }) {
  const [categoryId, setCategoryId] = useState(IOS_EMOJI_CATEGORIES[0].id);
  const category = IOS_EMOJI_CATEGORIES.find((entry) => entry.id === categoryId) || IOS_EMOJI_CATEGORIES[0];

  return (
    <GlassSurface intensity={78} style={[styles.iosReactionPopup, { height }]}>
      <View style={styles.iosPopupHeader}>
        <View>
          <Text style={styles.iosPopupTitle}>อิโมจิ</Text>
          <Text style={styles.iosPopupSubtitle}>เลือกอิโมจิจากหมวดหมู่</Text>
        </View>
        <Pressable
          accessibilityLabel="ปิดตัวเลือกอิโมจิ"
          onPress={onClose}
          style={({ pressed }) => [styles.closePanelButton, pressed && styles.menuRowPressed]}
        >
          <FeatureIcon color="#FFFFFF" name="xmark" size={13} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.iosCategoryList}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.iosCategoryScroll}
      >
        {IOS_EMOJI_CATEGORIES.map((entry) => {
          const isSelected = entry.id === category.id;
          return (
            <Pressable
              accessibilityLabel={`หมวดอิโมจิ ${entry.label}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              key={entry.id}
              onPress={() => setCategoryId(entry.id)}
              style={({ pressed }) => [
                styles.iosCategoryTab,
                isSelected && { backgroundColor: accent },
                pressed && styles.menuRowPressed,
              ]}
            >
              <Text style={styles.iosCategoryIcon}>{entry.icon}</Text>
              <Text numberOfLines={1} style={[styles.iosCategoryLabel, isSelected && styles.iosCategoryLabelSelected]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.iosEmojiGrid}
        showsVerticalScrollIndicator={false}
        style={styles.iosEmojiScroll}
      >
        {category.emojis.map((emoji, index) => (
          <Pressable
            accessibilityLabel={`แสดงความรู้สึก ${emoji}`}
            accessibilityState={{ selected: selectedReaction === emoji }}
            key={`${category.id}-${emoji}-${index}`}
            onPress={() => onSelect(emoji)}
            style={({ pressed }) => [
              styles.iosEmojiCell,
              selectedReaction === emoji && styles.iosEmojiCellSelected,
              pressed && styles.reactionButtonPressed,
            ]}
          >
            <Text style={styles.iosEmoji}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </GlassSurface>
  );
}

export default function InstagramMessageOverlay({
  conversations = [],
  currentConversationId,
  currentUserId,
  isOpen,
  item,
  onClose,
  onDelete,
  onForward,
  onReact,
  onReply,
  onUnsend,
  palette,
}) {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [panel, setPanel] = useState('actions');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (!isOpen) return;
    setPanel('actions');
    fadeAnim.setValue(0);
    liftAnim.setValue(0);
    scaleAnim.setValue(0.94);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        duration: 160,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(liftAnim, {
        damping: 18,
        mass: 0.8,
        stiffness: 210,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        damping: 16,
        mass: 0.7,
        stiffness: 230,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, isOpen, liftAnim, scaleAnim]);

  if (!item || !isOpen) return null;

  const mine = item.sender === 'me';
  const layout = item.layout;
  const hasLayout = Boolean(layout && typeof layout.y === 'number' && layout.width > 0);
  const bubbleWidth = hasLayout ? Math.min(layout.width, screenWidth - 40) : undefined;
  const iosReactionPanelHeight = Math.min(490, Math.max(390, screenHeight * 0.58));
  const panelHeight = panel === 'actions'
    ? (mine ? 340 : 292)
    : panel === 'reactions' && Platform.OS === 'ios'
      ? iosReactionPanelHeight
      : 250;
  const bubbleHeight = hasLayout ? layout.height : 44;
  const desiredTop = hasLayout ? layout.y - 62 : screenHeight * 0.22;
  const targetTop = Math.max(76, Math.min(desiredTop, screenHeight - panelHeight - bubbleHeight - 92));
  const translateY = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [44, 0] });
  const accent = palette?.accent || '#EE6B5D';
  const selectedReaction = currentUserId ? item.reactions?.[currentUserId] : null;
  const otherConversations = conversations.filter((conversation) => conversation.id !== currentConversationId);

  const animateClose = (callback) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { duration: 120, toValue: 0, useNativeDriver: true }),
      Animated.timing(liftAnim, { duration: 120, toValue: 0, useNativeDriver: true }),
      Animated.timing(scaleAnim, { duration: 120, toValue: 0.96, useNativeDriver: true }),
    ]).start(() => callback?.());
  };

  const chooseReaction = (emoji) => animateClose(() => onReact?.(item, emoji));
  const copyMessage = () => {
    Clipboard.setString(item.text || '');
    animateClose(onClose);
  };
  const shareMessage = () => {
    animateClose(async () => {
      onClose?.();
      await Share.share({ message: item.text || '' });
    });
  };

  return (
    <Modal animationType="none" onRequestClose={() => animateClose(onClose)} transparent visible={isOpen}>
      <Pressable accessibilityLabel="ปิดเมนูข้อความ" onPress={() => animateClose(onClose)} style={styles.backdrop}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
          <BlurView intensity={74} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.backdropShade]} />
        </Animated.View>

        <Pressable
          onPress={(event) => event.stopPropagation()}
          pointerEvents="box-none"
          style={[styles.stackContainer, { alignItems: mine ? 'flex-end' : 'flex-start', top: targetTop }]}
        >
          <Animated.View
            style={[
              styles.animatedGroup,
              {
                alignItems: mine ? 'flex-end' : 'flex-start',
                opacity: fadeAnim,
                transform: [{ translateY }, { scale: scaleAnim }],
              },
            ]}
          >
            <GlassSurface intensity={70} style={styles.reactionPill}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  accessibilityLabel={`แสดงความรู้สึก ${emoji}`}
                  accessibilityState={{ selected: selectedReaction === emoji }}
                  key={emoji}
                  onPress={() => chooseReaction(emoji)}
                  style={({ pressed }) => [
                    styles.reactionButton,
                    selectedReaction === emoji && styles.reactionButtonSelected,
                    pressed && styles.reactionButtonPressed,
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="แสดงความรู้สึกเพิ่มเติม"
                onPress={() => setPanel(panel === 'reactions' ? 'actions' : 'reactions')}
                style={({ pressed }) => [styles.reactionButton, pressed && styles.reactionButtonPressed]}
              >
                <FeatureIcon color="rgba(255,255,255,0.82)" name={panel === 'reactions' ? 'xmark' : 'plus'} size={16} />
              </Pressable>
            </GlassSurface>

            <View style={[styles.messageBubble, mine ? [styles.myBubble, { backgroundColor: accent }] : styles.theirBubble, bubbleWidth ? { width: bubbleWidth } : null]}>
              {item.forwarded ? <Text style={styles.forwardedLabel}>ส่งต่อ</Text> : null}
              {item.replyTo ? (
                <View style={styles.replyQuote}>
                  <Text numberOfLines={1} style={styles.replyQuoteText}>{item.replyTo.text}</Text>
                </View>
              ) : null}
              <Text style={styles.messageText}>{item.text}</Text>
            </View>

            {panel === 'actions' ? (
              <GlassSurface intensity={74} style={styles.actionCard}>
                <Text style={styles.timestamp}>{formatTime(item)}</Text>
                <MenuRow icon="arrowshape.turn.up.left" label="ตอบกลับ" onPress={() => animateClose(() => onReply?.(item))} />
                <MenuRow icon="doc.on.doc" label="คัดลอกข้อความ" onPress={copyMessage} />
                <MenuRow icon="paperplane" label="ส่งต่อ" onPress={() => setPanel('forward')} trailing />
                <MenuRow icon="trash" label="ลบสำหรับคุณ" onPress={() => animateClose(() => onDelete?.(item))} />
                {mine ? <MenuRow destructive icon="arrow.uturn.backward.circle" label="ยกเลิกการส่ง" onPress={() => animateClose(() => onUnsend?.(item))} /> : null}
                <MenuRow icon="ellipsis" label="เพิ่มเติม" onPress={() => setPanel('more')} trailing />
               </GlassSurface>
             ) : null}

            {panel === 'reactions' ? (
              Platform.OS === 'ios' ? (
                <IOSReactionPicker
                  accent={accent}
                  height={iosReactionPanelHeight}
                  onClose={() => setPanel('actions')}
                  onSelect={chooseReaction}
                  selectedReaction={selectedReaction}
                />
              ) : (
                <GlassSurface intensity={74} style={styles.secondaryCard}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>เลือกความรู้สึก</Text>
                    <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                      <FeatureIcon color="#FFFFFF" name="xmark" size={13} />
                    </Pressable>
                  </View>
                  <View style={styles.reactionGrid}>
                    {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                      <Pressable
                        accessibilityLabel={`แสดงความรู้สึก ${emoji}`}
                        accessibilityState={{ selected: selectedReaction === emoji }}
                        key={emoji}
                        onPress={() => chooseReaction(emoji)}
                        style={({ pressed }) => [
                          styles.gridReaction,
                          selectedReaction === emoji && styles.gridReactionSelected,
                          pressed && styles.reactionButtonPressed,
                        ]}
                      >
                        <Text style={styles.gridReactionEmoji}>{emoji}</Text>
                      </Pressable>
                    ))}
                   </View>
                 </GlassSurface>
               )
            ) : null}

            {panel === 'forward' ? (
              <GlassSurface intensity={74} style={styles.secondaryCard}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>ส่งต่อไปยัง</Text>
                  <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                    <FeatureIcon color="#FFFFFF" name="chevron.left" size={14} />
                  </Pressable>
                </View>
                {otherConversations.length ? (
                  <ScrollView contentContainerStyle={styles.forwardList} showsVerticalScrollIndicator={false} style={styles.forwardScroll}>
                    {otherConversations.map((conversation) => (
                      <Pressable
                        key={conversation.id}
                        onPress={() => animateClose(() => onForward?.(item, conversation.id))}
                        style={({ pressed }) => [styles.forwardRow, pressed && styles.menuRowPressed]}
                      >
                        <ForwardAvatar conversation={conversation} fallbackColor={accent} />
                        <Text numberOfLines={1} style={styles.forwardName}>{conversation.name || 'ห้องสนทนา'}</Text>
                        <FeatureIcon color={accent} name="paperplane.fill" size={15} />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.emptyForward}>ยังไม่มีห้องสนทนาอื่นสำหรับส่งต่อ</Text>
                )}
              </GlassSurface>
            ) : null}

            {panel === 'more' ? (
              <GlassSurface intensity={74} style={styles.secondaryCard}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>เพิ่มเติม</Text>
                  <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                    <FeatureIcon color="#FFFFFF" name="chevron.left" size={14} />
                  </Pressable>
                </View>
                <MenuRow icon="doc.on.doc" label="คัดลอกข้อความ" onPress={copyMessage} />
                <MenuRow icon="square.and.arrow.up" label="แชร์ไปยังแอปอื่น" onPress={shareMessage} />
              </GlassSurface>
            ) : null}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  glassSurface: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  glassSurfaceFallback: { backgroundColor: 'rgba(35,38,45,0.97)' },
  actionCard: {
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    width: 252,
  },
  animatedGroup: { gap: 9, maxWidth: 320, width: '100%' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.34)', flex: 1 },
  backdropShade: { backgroundColor: 'rgba(7,9,12,0.30)' },
  closePanelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  destructiveLabel: { color: '#FF5A5F' },
  emptyForward: { color: 'rgba(255,255,255,0.58)', fontSize: 13, lineHeight: 19, paddingVertical: 18, textAlign: 'center' },
  forwardAvatar: { alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  forwardAvatarImage: { borderRadius: 17, height: 34, width: 34 },
  forwardAvatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  forwardedLabel: { color: 'rgba(255,255,255,0.68)', fontSize: 10.5, fontWeight: '700', marginBottom: 3 },
  forwardList: { gap: 2 },
  forwardName: { color: '#FFFFFF', flex: 1, fontSize: 14, fontWeight: '600' },
  forwardRow: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 7 },
  forwardScroll: { maxHeight: 230 },
  gridReaction: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: '25%' },
  gridReactionSelected: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.88)', borderWidth: 1 },
  gridReactionEmoji: { fontSize: 25 },
  iosCategoryIcon: { fontSize: 19, lineHeight: 23 },
  iosCategoryLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: '600', marginTop: 1 },
  iosCategoryLabelSelected: { color: '#FFFFFF' },
  iosCategoryList: { gap: 6, paddingHorizontal: 1 },
  iosCategoryScroll: { flexGrow: 0, marginBottom: 9 },
  iosCategoryTab: { alignItems: 'center', borderRadius: 13, justifyContent: 'center', minWidth: 52, paddingHorizontal: 7, paddingVertical: 5 },
  iosEmoji: { fontSize: 25, lineHeight: 31 },
  // Seven emoji cells per row, matching the compact iOS picker layout.
  iosEmojiCell: { alignItems: 'center', borderRadius: 11, height: 42, justifyContent: 'center', width: '14.2857%' },
  iosEmojiCellSelected: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.88)', borderWidth: 1 },
  // Keep the full iOS emoji catalogue in a compact, scrollable grid. Without
  // an explicit row direction, ScrollView lays each cell out as one vertical
  // column even though the cells have a percentage width.
  iosEmojiGrid: {
    alignContent: 'flex-start',
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 4,
    paddingHorizontal: 2,
    paddingTop: 2,
    width: '100%',
  },
  iosEmojiScroll: { flex: 1 },
  iosPopupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  iosPopupSubtitle: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 1 },
  iosPopupTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  iosReactionPopup: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    width: '100%',
  },
  menuLabel: { color: '#FFFFFF', flexShrink: 1, fontSize: 14.5, fontWeight: '500' },
  menuRow: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', justifyContent: 'space-between', minHeight: 43, paddingHorizontal: 6 },
  menuRowCopy: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 13 },
  menuRowPressed: { backgroundColor: 'rgba(255,255,255,0.09)' },
  messageBubble: {
    borderRadius: 18,
    maxWidth: 280,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: '#000000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
  },
  messageText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '500', lineHeight: 20 },
  myBubble: { borderBottomRightRadius: 5 },
  panelHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  panelTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  reactionButton: { alignItems: 'center', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  reactionButtonSelected: { backgroundColor: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.88)', borderWidth: 1 },
  reactionButtonPressed: { backgroundColor: 'rgba(255,255,255,0.15)', transform: [{ scale: 1.14 }] },
  reactionEmoji: { fontSize: 22 },
  reactionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  reactionPill: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 5,
    paddingVertical: 4,
    shadowColor: '#000000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 16,
  },
  replyQuote: { borderLeftColor: 'rgba(255,255,255,0.65)', borderLeftWidth: 2, marginBottom: 5, paddingLeft: 7 },
  replyQuoteText: { color: 'rgba(255,255,255,0.74)', fontSize: 11.5 },
  secondaryCard: {
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    width: 270,
  },
  stackContainer: { left: 0, paddingHorizontal: 16, position: 'absolute', right: 0 },
  theirBubble: { backgroundColor: 'rgba(45,48,56,0.98)', borderBottomLeftRadius: 5 },
  timestamp: { color: 'rgba(255,255,255,0.45)', fontSize: 11.5, fontWeight: '500', marginBottom: 5, paddingHorizontal: 5 },
});
