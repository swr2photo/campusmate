import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { requireFirebase } from './dbService';
import { validateChatVideo } from '../utils/chatVideoPolicy';

export async function prepareRecordedVideo(uri, durationMs = 60000) {
  const info = await FileSystem.getInfoAsync(uri);
  return { uri, duration: durationMs, fileSize: info.size };
}

export async function pickChatVideo() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'], allowsMultipleSelection: false,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!Number.isFinite(asset.duration) || asset.duration <= 0) throw new Error('ไม่สามารถตรวจสอบความยาววิดีโอได้');
  return { ...asset, fileSize: info.size || asset.fileSize };
}

// A transaction requires an online server response and only one device can win.
// Receipts cannot be modified or deleted by clients (see firestore.rules).
export async function claimOnceVideo(conversationId, messageId, userId) {
  const { db } = requireFirebase();
  const messageRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  const receiptRef = doc(messageRef, 'videoViews', userId);
  await runTransaction(db, async (transaction) => {
    const message = await transaction.get(messageRef);
    const receipt = await transaction.get(receiptRef);
    const data = message.exists() ? message.data() : {};
    if (!message.exists() || (data.videoMode !== 'once' && data.viewMode !== 'once')) throw new Error('สื่อนี้ไม่พร้อมใช้งาน');
    if (receipt.exists()) throw new Error('วิดีโอนี้ถูกเปิดดูแล้ว');
    transaction.set(receiptRef, { viewedAt: serverTimestamp() });
  });
}

export function watchOnceVideo(conversationId, messageId, userId, onViewed) {
  const { db } = requireFirebase();
  return onSnapshot(doc(db, 'conversations', conversationId, 'messages', messageId, 'videoViews', userId),
    snapshot => { if (snapshot.exists()) onViewed(); },
    () => {}); // Opening still requires a successful online transaction.
}
