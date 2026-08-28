import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { Avatar, Card, SectionTitle } from '../components/ui';
import { colors, radius, spacing, type } from '../theme';

export default function ChatScreen() {
  const { conversations, sendMessage } = useApp();
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [inputText, setInputText] = useState('');
  const activeChat = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedChatId) || null,
    [conversations, selectedChatId]
  );

  const handleSendMessage = () => {
    if (!activeChat || !sendMessage(activeChat.id, inputText)) return;
    setInputText('');
  };

  if (activeChat) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.roomContainer}
      >
        <View style={styles.roomHeader}>
          <Pressable accessibilityRole="button" onPress={() => setSelectedChatId(null)} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
            <Text style={styles.backText}>แชททั้งหมด</Text>
          </Pressable>
          <View style={styles.roomPartner}>
            <Avatar color={activeChat.avatarColor} emoji={activeChat.avatar} online={activeChat.online} size={40} />
            <View style={styles.roomPartnerCopy}>
              <Text style={styles.roomName}>{activeChat.name}</Text>
              <Text style={styles.roomSubtitle}>{activeChat.online ? 'กำลังใช้งาน' : activeChat.subtitle}</Text>
            </View>
          </View>
          <View style={styles.privateIcon}><Text style={styles.privateIconText}>🔒</Text></View>
        </View>

        <FlatList
          data={activeChat.messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={<Text style={styles.emptyConversation}>เริ่มทักทายเพื่อนใหม่ได้เลย 👋</Text>}
          renderItem={({ item }) => {
            const isMe = item.sender === 'me';
            return (
              <View style={[styles.messageGroup, isMe ? styles.messageGroupMe : styles.messageGroupThem]}>
                <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, isMe ? styles.myBubbleText : styles.theirBubbleText]}>{item.text}</Text>
                </View>
                <Text style={[styles.messageTime, isMe && styles.messageTimeMe]}>{item.time}</Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />

        <View style={styles.composer}>
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setInputText}
            onSubmitEditing={handleSendMessage}
            placeholder="พิมพ์ข้อความนัดหมาย..."
            placeholderTextColor={colors.inkSoft}
            returnKeyType="send"
            style={styles.textInput}
            value={inputText}
          />
          <Pressable accessibilityRole="button" onPress={handleSendMessage} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={(
          <View style={styles.pageHeader}>
            <Text style={styles.eyebrow}>CampusMate / MESSAGES</Text>
            <SectionTitle title="ห้องสนทนา" subtitle="คุยกับเพื่อนที่จับคู่สำเร็จอย่างเป็นส่วนตัว" />
            <View style={styles.securityBanner}>
              <Text style={styles.securityIcon}>🔒</Text>
              <View style={styles.securityCopy}>
                <Text style={styles.securityTitle}>พื้นที่คุยที่ปลอดภัย</Text>
                <Text style={styles.securityText}>เริ่มส่งข้อความได้เมื่อคุณและเพื่อนสนใจกันทั้งคู่</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyTitle}>ยังไม่มีห้องสนทนา</Text>
            <Text style={styles.emptyText}>ลองกดสนใจโปรไฟล์ในหน้าจับคู่ เพื่อเริ่มสร้างบทสนทนา</Text>
          </Card>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelectedChatId(item.id)} style={({ pressed }) => [styles.chatCard, pressed && styles.pressed]}>
            <Avatar color={item.avatarColor} emoji={item.avatar} online={item.online} size={54} />
            <View style={styles.chatCopy}>
              <View style={styles.chatTitleRow}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={styles.chatTime}>{item.updatedAt}</Text>
              </View>
              <Text style={styles.chatSubtitle}>{item.subtitle}</Text>
              <Text numberOfLines={1} style={styles.lastMessage}>{item.lastMessage}</Text>
            </View>
            {item.unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{item.unread}</Text></View>}
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  pageHeader: { marginBottom: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.3, marginBottom: spacing.sm },
  securityBanner: { alignItems: 'center', backgroundColor: colors.greenSoft, borderColor: '#CDEFE0', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.lg, padding: spacing.md },
  securityIcon: { fontSize: 22, marginRight: spacing.md },
  securityCopy: { flex: 1 },
  securityTitle: { color: colors.green, fontSize: type.caption, fontWeight: '900' },
  securityText: { color: '#4B806D', fontSize: type.micro, lineHeight: 16, marginTop: 2 },
  chatCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.sm, padding: spacing.md },
  chatCopy: { flex: 1, marginLeft: spacing.md },
  chatTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  chatName: { color: colors.ink, flex: 1, fontSize: type.body, fontWeight: '900' },
  chatTime: { color: colors.inkSoft, fontSize: type.micro, marginLeft: spacing.sm },
  chatSubtitle: { color: colors.primary, fontSize: type.micro, fontWeight: '700', marginTop: 3 },
  lastMessage: { color: colors.inkMuted, fontSize: type.caption, marginTop: 6 },
  unread: { alignItems: 'center', backgroundColor: colors.coral, borderRadius: 11, height: 22, justifyContent: 'center', marginLeft: spacing.sm, minWidth: 22, paddingHorizontal: 4 },
  unreadText: { color: colors.card, fontSize: 10, fontWeight: '900' },
  emptyCard: { alignItems: 'center', marginTop: spacing.lg, padding: spacing.xxl },
  emptyEmoji: { fontSize: 42, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  roomContainer: { backgroundColor: colors.canvas, flex: 1 },
  roomHeader: { alignItems: 'center', backgroundColor: colors.card, borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', minHeight: 72, paddingHorizontal: spacing.md },
  backButton: { alignItems: 'center', flexDirection: 'row', marginRight: spacing.sm, paddingVertical: spacing.sm },
  backIcon: { color: colors.primary, fontSize: 32, fontWeight: '300', lineHeight: 28 },
  backText: { color: colors.primary, fontSize: type.micro, fontWeight: '800', marginLeft: 2 },
  roomPartner: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  roomPartnerCopy: { flex: 1, marginLeft: spacing.sm },
  roomName: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  roomSubtitle: { color: colors.green, fontSize: type.micro, marginTop: 2 },
  privateIcon: { alignItems: 'center', backgroundColor: colors.canvas, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  privateIconText: { fontSize: 15 },
  messageList: { padding: spacing.lg, paddingBottom: spacing.xl },
  messageGroup: { marginBottom: spacing.md, maxWidth: '82%' },
  messageGroupMe: { alignSelf: 'flex-end' },
  messageGroupThem: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: spacing.md, paddingVertical: 11 },
  theirBubble: { backgroundColor: colors.card, borderColor: colors.line, borderTopLeftRadius: 5, borderWidth: 1 },
  myBubble: { backgroundColor: colors.primary, borderTopRightRadius: 5 },
  bubbleText: { fontSize: type.body, lineHeight: 20 },
  theirBubbleText: { color: colors.ink },
  myBubbleText: { color: colors.card },
  messageTime: { color: colors.inkSoft, fontSize: 10, marginTop: 4 },
  messageTimeMe: { textAlign: 'right' },
  emptyConversation: { color: colors.inkMuted, fontSize: type.caption, marginTop: spacing.xxxl, textAlign: 'center' },
  composer: { alignItems: 'center', backgroundColor: colors.card, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', padding: spacing.md },
  textInput: { backgroundColor: colors.canvas, borderRadius: radius.pill, color: colors.ink, flex: 1, fontSize: type.body, minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  sendButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 22, height: 44, justifyContent: 'center', marginLeft: spacing.sm, width: 44 },
  sendIcon: { color: colors.card, fontSize: 22, fontWeight: '900' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

