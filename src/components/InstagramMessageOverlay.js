import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Clipboard,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😆', '👍'];
const MORE_REACTIONS = ['🔥', '🎉', '👏', '😍', '🙏', '💯', '🤝', '😡'];

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
        <SymbolView name={icon} size={18} tintColor={destructive ? '#FF5A5F' : '#FFFFFF'} />
        <Text numberOfLines={1} style={[styles.menuLabel, destructive && styles.destructiveLabel]}>{label}</Text>
      </View>
      {trailing ? <SymbolView name="chevron.right" size={12} tintColor="rgba(255,255,255,0.42)" /> : null}
    </Pressable>
  );
}

export default function InstagramMessageOverlay({
  conversations = [],
  currentConversationId,
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
  const panelHeight = panel === 'actions' ? (mine ? 340 : 292) : 250;
  const bubbleHeight = hasLayout ? layout.height : 44;
  const desiredTop = hasLayout ? layout.y - 62 : screenHeight * 0.22;
  const targetTop = Math.max(76, Math.min(desiredTop, screenHeight - panelHeight - bubbleHeight - 92));
  const translateY = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [44, 0] });
  const accent = palette?.accent || '#EE6B5D';
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
            <View style={styles.reactionPill}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  accessibilityLabel={`แสดงความรู้สึก ${emoji}`}
                  key={emoji}
                  onPress={() => chooseReaction(emoji)}
                  style={({ pressed }) => [styles.reactionButton, pressed && styles.reactionButtonPressed]}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="แสดงความรู้สึกเพิ่มเติม"
                onPress={() => setPanel(panel === 'reactions' ? 'actions' : 'reactions')}
                style={({ pressed }) => [styles.reactionButton, pressed && styles.reactionButtonPressed]}
              >
                <SymbolView name={panel === 'reactions' ? 'xmark' : 'plus'} size={16} tintColor="rgba(255,255,255,0.82)" />
              </Pressable>
            </View>

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
              <View style={styles.actionCard}>
                <Text style={styles.timestamp}>{formatTime(item)}</Text>
                <MenuRow icon="arrowshape.turn.up.left" label="ตอบกลับ" onPress={() => animateClose(() => onReply?.(item))} />
                <MenuRow icon="doc.on.doc" label="คัดลอกข้อความ" onPress={copyMessage} />
                <MenuRow icon="paperplane" label="ส่งต่อ" onPress={() => setPanel('forward')} trailing />
                <MenuRow icon="trash" label="ลบสำหรับคุณ" onPress={() => animateClose(() => onDelete?.(item))} />
                {mine ? <MenuRow destructive icon="arrow.uturn.backward.circle" label="ยกเลิกการส่ง" onPress={() => animateClose(() => onUnsend?.(item))} /> : null}
                <MenuRow icon="ellipsis" label="เพิ่มเติม" onPress={() => setPanel('more')} trailing />
              </View>
            ) : null}

            {panel === 'reactions' ? (
              <View style={styles.secondaryCard}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>เลือกความรู้สึก</Text>
                  <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                    <SymbolView name="xmark" size={13} tintColor="#FFFFFF" />
                  </Pressable>
                </View>
                <View style={styles.reactionGrid}>
                  {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                    <Pressable key={emoji} onPress={() => chooseReaction(emoji)} style={({ pressed }) => [styles.gridReaction, pressed && styles.reactionButtonPressed]}>
                      <Text style={styles.gridReactionEmoji}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {panel === 'forward' ? (
              <View style={styles.secondaryCard}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>ส่งต่อไปยัง</Text>
                  <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                    <SymbolView name="chevron.left" size={14} tintColor="#FFFFFF" />
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
                        <View style={[styles.forwardAvatar, { backgroundColor: conversation.avatarColor || accent }]}>
                          <Text style={styles.forwardAvatarText}>{conversation.avatar || (conversation.name || '?').slice(0, 1)}</Text>
                        </View>
                        <Text numberOfLines={1} style={styles.forwardName}>{conversation.name || 'ห้องสนทนา'}</Text>
                        <SymbolView name="paperplane.fill" size={15} tintColor={accent} />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.emptyForward}>ยังไม่มีห้องสนทนาอื่นสำหรับส่งต่อ</Text>
                )}
              </View>
            ) : null}

            {panel === 'more' ? (
              <View style={styles.secondaryCard}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>เพิ่มเติม</Text>
                  <Pressable onPress={() => setPanel('actions')} style={styles.closePanelButton}>
                    <SymbolView name="chevron.left" size={14} tintColor="#FFFFFF" />
                  </Pressable>
                </View>
                <MenuRow icon="doc.on.doc" label="คัดลอกข้อความ" onPress={copyMessage} />
                <MenuRow icon="square.and.arrow.up" label="แชร์ไปยังแอปอื่น" onPress={shareMessage} />
              </View>
            ) : null}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    backgroundColor: 'rgba(35,38,45,0.96)',
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
  forwardAvatar: { alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', width: 34 },
  forwardAvatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  forwardedLabel: { color: 'rgba(255,255,255,0.68)', fontSize: 10.5, fontWeight: '700', marginBottom: 3 },
  forwardList: { gap: 2 },
  forwardName: { color: '#FFFFFF', flex: 1, fontSize: 14, fontWeight: '600' },
  forwardRow: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 7 },
  forwardScroll: { maxHeight: 230 },
  gridReaction: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: '25%' },
  gridReactionEmoji: { fontSize: 25 },
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
  reactionButtonPressed: { backgroundColor: 'rgba(255,255,255,0.15)', transform: [{ scale: 1.14 }] },
  reactionEmoji: { fontSize: 22 },
  reactionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  reactionPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(30,33,39,0.97)',
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
    backgroundColor: 'rgba(35,38,45,0.97)',
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
