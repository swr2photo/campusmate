import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { mergeGroupMessages, messageMillis, receiveGroupWindow } from '../utils/groupChatTimeline';
import { getOfflineQueue, getFailedOfflineOperations, subscribeOfflineQueueChanges } from '../services/offlineStorage';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppProfile } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, useTheme } from '../theme';
import {
  leaveParty, loadOlderGroupMessages, rotatePartyKey, sendGroupImage, sendGroupText,
  subscribeGroupChat, subscribeGroupEpochs, subscribeGroupMessages,
  markGroupRead, subscribeGroupReadReceipts,
  retryGroupMessage,
} from '../services/partyService';
import { decryptGroupMessage, getGroupKeys, preparePartyRotation } from '../services/groupChatEncryption';
import { pickAndUploadGroupImage } from '../services/groupChatMedia';
import { getDecryptedMediaUri } from '../services/chatMediaService';
import { getPublicProfilesByIds } from '../services/firestoreService';

function GroupImage({ url, keyBytes, colors }) {
  const [uri, setUri] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUri(null);
    setFailed(false);
    if (!url || !keyBytes) { setFailed(true); return undefined; }
    getDecryptedMediaUri(url, { conversationKey: keyBytes, mediaType: 'image' })
      .then((nextUri) => { if (active) { setUri(nextUri); setFailed(!nextUri); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url, keyBytes]);
  if (failed) return <Text style={{ color: colors.danger }}>เปิดรูปภาพนี้ไม่ได้</Text>;
  if (!uri) return <ActivityIndicator color={colors.primary} />;
  return <Image source={{ uri }} style={styles.image} contentFit="cover" />;
}

export default function GroupChatRoomScreen() {
  const params = useLocalSearchParams();
  const partyId = Array.isArray(params.partyId) ? params.partyId[0] : params.partyId;
  const { colors, isDark } = useTheme();
  const { confirm } = useConfirm();
  const { profile } = useAppProfile();
  const userId = profile?.id;
  const [chat, setChat] = useState(null);
  const [epochs, setEpochs] = useState([]);
  const [keys, setKeys] = useState({});
  const [history, setHistory] = useState({ recent: [], older: [], cursor: null, hasMore: false, loadedOlder: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [memberNames, setMemberNames] = useState({});
  const [membersOpen, setMembersOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState({ chat: false, messages: false, keys: false });
  const [outbox, setOutbox] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [retry, setRetry] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const sessionRef = useRef('');
  sessionRef.current = `${userId}:${partyId}:${retry}`;
  const listRef = useRef(null);
  const initialScrollDone = useRef(false);
  const nearLatest = useRef(true);
  const [isListAnchored, setIsListAnchored] = useState(false);

  useEffect(() => {
    if (!partyId || !userId) return undefined;
    let active = true;
    initialScrollDone.current = false;
    nearLatest.current = true;
    setIsListAnchored(false);
    setHistory({ recent: [], older: [], cursor: null, hasMore: false, loadedOlder: false });
    setChat(null); setEpochs([]); setKeys({}); setError(''); setReceipts({}); setMemberNames({});
    setReady({ chat: false, messages: false, keys: false });
    const onError = (reason) => {
      if (!active) return;
      setError(reason?.message || 'โหลดแชตกลุ่มไม่ได้');
      if (String(reason?.code).includes('permission-denied')) {
        setChat(null); setKeys({}); setEpochs([]);
        setReady({ chat: true, messages: true, keys: true });
      }
    };
    const offChat = subscribeGroupChat(partyId, (value) => {
      if (!active) return;
      setChat(value); setReady((old) => ({ ...old, chat: true }));
      if (!value) setError('ไม่พบแชตกลุ่มนี้');
    }, onError);
    const offEpochs = subscribeGroupEpochs(partyId, (value) => { if (active) setEpochs(value); }, onError);
    const offMessages = subscribeGroupMessages(partyId, (recent, cursor, hasMore) => {
      if (!active) return;
      setHistory((old) => receiveGroupWindow(old, recent, cursor, hasMore));
      setReady((old) => ({ ...old, messages: true }));
    }, onError);
    const offReads = subscribeGroupReadReceipts(partyId, (value) => { if (active) setReceipts(value); }, onError);
    const timer = setTimeout(() => {
      if (!initialScrollDone.current) {
        listRef.current?.scrollToEnd({ animated: false });
        initialScrollDone.current = true;
      }
      setIsListAnchored(true);
    }, 120);
    return () => { clearTimeout(timer); active = false; offChat(); offEpochs(); offMessages(); offReads(); };
  }, [partyId, userId, retry]);

  useEffect(() => {
    let active = true;
    setOutbox([]);
    const load = async (changedUserId = userId) => {
      if (changedUserId !== userId || !userId) return;
      const [pending, failed] = await Promise.all([getOfflineQueue(userId), getFailedOfflineOperations(userId)]);
      if (!active) return;
      setOutbox([...failed, ...pending].filter((item) => item.type === 'sendGroupMessage' && item.payload.partyId === partyId)
        .map((item) => ({ ...item.payload.record, id: item.payload.id, clientSentAt: item.payload.clientSentAt,
          operationId: item.id, pendingSync: true, sendStatus: item.failedAt ? 'failed' : 'queued' })));
    };
    const off = subscribeOfflineQueueChanges((id) => { void load(id).catch(() => {}); });
    void load().catch(() => setError('อ่านคิวส่งข้อความไม่ได้'));
    return () => { active = false; off(); };
  }, [userId, partyId]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!epochs.length || !partyId || !userId) return;
    let active = true;
    getGroupKeys(partyId, userId, epochs).then((loaded) => {
      if (active) { setKeys(loaded); setReady((old) => ({ ...old, keys: true })); }
    }).catch((reason) => { if (active) setError(reason?.message || 'อ่านกุญแจแชตไม่ได้'); });
    return () => { active = false; };
  }, [epochs, partyId, userId]);

  useEffect(() => {
    if (!chat?.memberIds?.length) return;
    let active = true;
    getPublicProfilesByIds(chat.memberIds).then((profiles) => {
      if (active) setMemberNames(Object.fromEntries(profiles.map((profile) => [profile.id, profile.nickname || profile.name || 'สมาชิกในตี้'])));
    })
      .catch(() => { if (active) setMemberNames({}); });
    return () => { active = false; };
  }, [chat?.memberIds?.join('|')]);

  const visibleMessages = useMemo(() => {
    return mergeGroupMessages(outbox, history.older, history.recent).map((item) => keys[item.epoch]
      ? decryptGroupMessage(item, keys) : { ...item, text: 'กำลังโหลดกุญแจข้อความ', keyPending: true });
  }, [history.recent, history.older, keys, outbox]);
  const lastReadable = [...visibleMessages].reverse().find((message) => !message.pendingSync && !message.keyPending && !message.decryptionFailed && message.createdAt?.toMillis);
  useEffect(() => {
    if (!focused || !foreground || !atBottom || !lastReadable || !chat?.memberIds?.includes(userId)) return undefined;
    if ((receipts[userId]?.lastReadMessageAt?.toMillis?.() || 0) >= messageMillis(lastReadable)) return undefined;
    const timer = setTimeout(() => { void markGroupRead(partyId, userId, lastReadable).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [focused, foreground, atBottom, lastReadable?.id, receipts, chat, partyId, userId]);
  const latestMessageId = history.recent[0]?.id;
  useEffect(() => {
    if (!latestMessageId || !initialScrollDone.current || !nearLatest.current) return undefined;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [latestMessageId]);
  useEffect(() => {
    if (!Object.keys(keys).length) return;
    const failures = visibleMessages.filter((item) => item.decryptionFailed).length;
    if (failures) console.warn('[GroupChat] message_decryption_failed', { partyId, failures });
  }, [visibleMessages, keys, partyId]);
  const currentKey = keys[chat?.currentEpoch];
  const canSend = Boolean(chat && !chat.rekeyRequired && currentKey && chat.memberIds?.includes(userId));

  const loadHistory = async () => {
    if (!history.hasMore || !history.cursor || loadingOlder) return;
    setLoadingOlder(true);
    const session = sessionRef.current;
    try {
      const page = await loadOlderGroupMessages(partyId, history.cursor);
      if (sessionRef.current !== session) return;
      setHistory((old) => ({
        ...old, older: mergeGroupMessages(old.older, page.messages), cursor: page.cursor,
        hasMore: page.hasMore, loadedOlder: true,
      }));
    } catch (reason) { setError(reason?.message || 'โหลดข้อความเก่าไม่ได้'); }
    finally { if (sessionRef.current === session) setLoadingOlder(false); }
  };

  const sendText = async () => {
    if (!canSend || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const message = await sendGroupText(partyId, userId, chat.currentEpoch, draft, currentKey);
      setOutbox((old) => mergeGroupMessages(old, [message]));
      setDraft('');
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งข้อความไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const sendImage = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    try {
      const url = await pickAndUploadGroupImage(partyId, currentKey);
      if (url) {
        const message = await sendGroupImage(partyId, userId, chat.currentEpoch, url, currentKey);
        setOutbox((old) => mergeGroupMessages(old, [message]));
      }
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งรูปภาพไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const rotate = async () => {
    if (!chat?.rekeyRequired || busy) return;
    setBusy(true);
    try {
      const grants = await preparePartyRotation(partyId, chat.memberIds, userId);
      await rotatePartyKey(partyId, grants);
      setError('');
    } catch (reason) { setError(reason?.message || 'เปลี่ยนกุญแจกลุ่มไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    const approved = await confirm({
      title: 'ออกจากตี้', body: 'เมื่อออกแล้ว คุณจะไม่สามารถอ่านหรือส่งข้อความใหม่ในแชตกลุ่มนี้',
      cancelLabel: 'อยู่ต่อ', confirmLabel: 'ออกจากตี้', icon: 'person.fill.xmark',
    });
    if (!approved) return;
    setBusy(true);
    try { await leaveParty(partyId); router.back(); }
    catch (reason) { setError(reason?.message || 'ออกจากตี้ไม่สำเร็จ'); setBusy(false); }
  };

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line, backgroundColor: colors.card }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="กลับ" onPress={() => router.back()} style={styles.headerButton}>
          <FeatureIcon name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="ดูรายชื่อสมาชิก" onPress={() => setMembersOpen(true)} style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.ink }]} numberOfLines={1}>{chat?.title || 'แชตกลุ่มของตี้'}</Text>
          <Text style={[styles.headerSub, { color: colors.inkMuted }]}>{chat?.memberCount || 0} สมาชิก · เข้ารหัส</Text>
        </Pressable>
        {chat?.hostId !== userId ? <Pressable accessibilityRole="button" accessibilityLabel="ออกจากตี้" onPress={leave} style={styles.headerButton}>
          <FeatureIcon name="rectangle.portrait.and.arrow.right" size={20} color={colors.inkMuted} />
        </Pressable> : <View style={styles.headerButton} />}
      </View>
      {chat?.rekeyRequired ? <View style={[styles.banner, { backgroundColor: colors.amberSoft }]}>
        <Text style={[styles.bannerText, { color: colors.ink }]}>สมาชิกออกจากตี้ กรุณาเปลี่ยนกุญแจก่อนส่งข้อความใหม่</Text>
        <Pressable onPress={rotate} disabled={busy} accessibilityRole="button"><Text style={{ color: colors.primary, fontWeight: '800' }}>เปลี่ยนกุญแจ</Text></Pressable>
      </View> : null}
      {error ? <View style={styles.banner}><Text style={[styles.error, { color: colors.danger, flex: 1 }]}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRetry((old) => old + 1)}><Text style={{ color: colors.primary }}>ลองใหม่</Text></Pressable></View> : null}
      <FlatList
        ref={listRef}
        data={ready.keys ? visibleMessages : []}
        keyExtractor={(item) => item.id}
        style={{ flex: 1, opacity: isListAnchored || visibleMessages.length === 0 ? 1 : 0 }}
        contentContainerStyle={styles.messages}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={() => {
          if (!initialScrollDone.current && visibleMessages.length) {
            listRef.current?.scrollToEnd({ animated: false });
            initialScrollDone.current = true;
            setIsListAnchored(true);
          }
        }}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          nearLatest.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 90;
          setAtBottom(nearLatest.current);
        }}
        scrollEventThrottle={100}
        ListHeaderComponent={history.hasMore ? <Pressable accessibilityRole="button" disabled={loadingOlder} onPress={loadHistory} style={styles.moreHistory}>
          {loadingOlder ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '800' }}>โหลดข้อความก่อนหน้า</Text>}
        </Pressable> : null}
        renderItem={({ item }) => {
          const mine = item.senderId === userId;
          return <View style={[styles.bubble, { alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? colors.primarySoft : colors.card, borderColor: colors.line }]}>
            {!mine ? <Text style={[styles.sender, { color: colors.primary }]}>{memberNames[item.senderId] || 'สมาชิกในตี้'}</Text> : null}
            {item.mediaType === 'image' && !item.decryptionFailed
              ? <GroupImage url={item.mediaUrl} keyBytes={keys[item.epoch]} colors={colors} />
              : <Text style={[styles.body, { color: colors.ink }]}>{item.text || (item.decryptionFailed ? 'ไม่สามารถถอดรหัสข้อความนี้ได้' : '')}</Text>}
            <Text style={{ color: colors.inkMuted, fontSize: 11, marginTop: 4 }}>
              {item.sendStatus === 'failed' ? 'ส่งไม่สำเร็จ' : item.pendingSync ? 'รอส่ง' :
                `${new Date(messageMillis(item)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}${mine ? ` · อ่านแล้ว ${Object.entries(receipts).filter(([id, receipt]) => id !== userId && chat?.memberIds?.includes(id) && (receipt.lastReadMessageAt?.toMillis?.() || 0) >= messageMillis(item)).length} คน` : ''}`}
            </Text>
            {mine && item.sendStatus === 'failed' ? <Pressable accessibilityRole="button" onPress={() => {
              if (!canSend) { setError('กรุณารอเตรียมกุญแจกลุ่มก่อนส่งใหม่'); return; }
              void retryGroupMessage(partyId, userId, chat.currentEpoch, item, currentKey).catch((reason) => setError(reason.message));
            }}><Text style={{ color: colors.primary }}>ลองส่งใหม่</Text></Pressable> : null}
          </View>;
        }}
        ListEmptyComponent={<View style={styles.empty}>{!ready.chat || !ready.messages || !ready.keys ? <ActivityIndicator color={colors.primary} /> : <FeatureIcon name="bubble.left.and.bubble.right.fill" size={30} color={colors.inkMuted} />}<Text style={{ color: colors.inkMuted }}>{error ? 'โหลดแชตไม่สำเร็จ' : !ready.chat || !ready.messages || !ready.keys ? 'กำลังโหลดแชตและกุญแจ' : 'เริ่มสนทนากับสมาชิกในตี้'}</Text></View>}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.composer, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="ส่งรูปภาพ" disabled={!canSend || busy} onPress={sendImage} style={styles.iconButton}>
            <FeatureIcon name="photo.fill" size={22} color={canSend ? colors.primary : colors.inkSoft} />
          </Pressable>
          <TextInput value={draft} onChangeText={setDraft} placeholder={canSend ? 'พิมพ์ข้อความ' : 'กำลังเตรียมกุญแจแชต'} placeholderTextColor={colors.inkSoft}
            keyboardAppearance={isDark ? 'dark' : 'light'} multiline editable={canSend && !busy}
            style={[styles.input, { backgroundColor: colors.surfaceRaised, color: colors.ink }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="ส่งข้อความ" disabled={!canSend || busy || !draft.trim()} onPress={sendText} style={styles.iconButton}>
            <FeatureIcon name="arrow.up.circle.fill" size={27} color={canSend && draft.trim() ? colors.primary : colors.inkSoft} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <Modal transparent visible={membersOpen} animationType="fade" onRequestClose={() => setMembersOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.membersPanel, { backgroundColor: colors.card }]}>
            <Text style={[styles.membersTitle, { color: colors.ink }]}>สมาชิกในตี้</Text>
            <ScrollView>
              {(chat?.memberIds || []).map((id) => <View key={id} style={[styles.memberRow, { borderBottomColor: colors.line }]}>
                <FeatureIcon name="person.crop.circle.fill" size={20} color={colors.primary} />
                <Text style={[styles.memberName, { color: colors.ink }]}>{memberNames[id] || 'สมาชิกในตี้'}{id === chat?.hostId ? ' · เจ้าของตี้' : ''}</Text>
              </View>)}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={() => setMembersOpen(false)} style={[styles.membersClose, { backgroundColor: colors.primarySoft }]}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, minHeight: 58, paddingHorizontal: 8 },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 2 },
  banner: { padding: 12, flexDirection: 'row', gap: 9, alignItems: 'center' },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
  error: { fontSize: 12, paddingHorizontal: 15, paddingVertical: 7 },
  messages: { padding: spacing.md, flexGrow: 1, gap: 8 },
  moreHistory: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  bubble: { borderWidth: 1, borderRadius: radius.lg, maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 9 },
  sender: { fontSize: 11, fontWeight: '800', marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 20 },
  image: { width: 220, height: 220, borderRadius: radius.md },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 160, gap: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 8, gap: 6 },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 38, maxHeight: 110, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 25 },
  membersPanel: { borderRadius: radius.xl, padding: 17, maxHeight: '70%' },
  membersTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  memberName: { flex: 1, fontSize: 14 },
  membersClose: { marginTop: 12, borderRadius: radius.lg, alignItems: 'center', padding: 11 },
});
