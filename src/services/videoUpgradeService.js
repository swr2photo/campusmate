import * as FileSystem from 'expo-file-system/legacy';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, setDoc, Timestamp } from 'firebase/firestore';
import { requireFirebase } from './dbService';
import { exportChatVideo, discardVideoExport } from './videoProcessingService';
import { uploadChatMedia } from './chatMediaService';
import { encryptMessageRecord, decryptMessageRecord, getOrFetchConversationKey } from './chatEncryptionService';

const root = () => `${FileSystem.documentDirectory}video-upgrades/`;
const safeId = value => encodeURIComponent(value);
const jobDirectory = (userId, messageId) => `${root()}${safeId(userId)}/${safeId(messageId)}/`;
let running = false;
const isCurrentUser = userId => getAuth(requireFirebase().app).currentUser?.uid === userId;

// The source stays inside the app's private storage; no key or clear media URL
// is persisted in the job manifest. A fresh key is obtained for each attempt.
export async function stageVideoUpgrade({ userId, conversationId, messageId, asset, edit, mode }) {
  const directory = jobDirectory(userId, messageId);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  try {
    const uri = `${directory}source.mp4`;
    await FileSystem.copyAsync({ from: asset.uri, to: uri });
    await FileSystem.writeAsStringAsync(`${directory}job.json`, JSON.stringify({
      userId, conversationId, messageId, asset: { uri, duration: asset.duration }, edit, mode, stage: 0, createdAt: Date.now(),
    }));
  } catch (error) { await cancelVideoUpgrade(userId, messageId); throw error; }
}

export async function cancelVideoUpgrade(userId, messageId) {
  await FileSystem.deleteAsync(jobDirectory(userId, messageId), { idempotent: true }).catch(() => {});
}

export async function resumeVideoUpgrades(userId) {
  if (!userId || running || !isCurrentUser(userId)) return;
  running = true;
  try {
    const directory = `${root()}${safeId(userId)}/`;
    if (!(await FileSystem.getInfoAsync(directory)).exists) return;
    for (const name of await FileSystem.readDirectoryAsync(directory)) {
      if (!isCurrentUser(userId)) break;
      const manifest = `${directory}${name}/job.json`;
      let exported;
      try {
        const job = JSON.parse(await FileSystem.readAsStringAsync(manifest));
        if (job.userId !== userId) continue;
        const { db } = requireFirebase();
        const messageRef = doc(db, 'conversations', job.conversationId, 'messages', job.messageId);
        const parent = await getDoc(messageRef);
        if (!parent.exists()) {
          // Queued/offline sends may not have reached Firestore yet.
          if (Date.now() - job.createdAt > 7 * 86400000) await cancelVideoUpgrade(userId, job.messageId);
          continue;
        }
        if (parent.data().senderId !== userId) { await cancelVideoUpgrade(userId, job.messageId); continue; }
        const key = await getOrFetchConversationKey(job.conversationId, userId);
        const renditionRef = doc(messageRef, 'videoRenditions', 'high');
        if (!(await getDoc(renditionRef)).exists()) {
          if (!isCurrentUser(userId)) return;
          exported = await exportChatVideo(job.asset, job.edit, 'high');
          if (!isCurrentUser(userId)) return;
          const mediaUrl = await uploadChatMedia(exported.uri, {
            conversationId: job.conversationId, mediaType: 'video', conversationKey: key, videoDuration: exported.duration,
          });
          if (!isCurrentUser(userId)) return;
          const time = Timestamp.now();
          await setDoc(renditionRef, encryptMessageRecord({
            id: job.messageId, senderId: userId, createdAt: time, time,
            text: '', mediaType: 'video', mediaUrl, videoMode: job.mode, videoDuration: exported.duration,
          }, key));
          await discardVideoExport(exported); exported = null;
        }
        await cancelVideoUpgrade(userId, job.messageId);
      } catch (error) {
        // Keep the durable job for a later network/foreground retry.
        console.warn('[VideoUpgrade] Will retry:', error?.code || error?.message);
      } finally { await discardVideoExport(exported); }
    }
  } finally { running = false; }
}

export async function getBestVideoUrl(conversationId, item, key) {
  try {
    const { db } = requireFirebase();
    const snapshot = await getDocs(collection(db, 'conversations', conversationId, 'messages', item.id, 'videoRenditions'));
    for (const quality of ['high', 'medium']) {
      const rendition = snapshot.docs.find(entry => entry.id === quality);
      if (!rendition) continue;
      const data = rendition.data();
      if (data.senderId !== item.senderId || data.id !== item.id) continue;
      const decoded = decryptMessageRecord(data, key);
      if (decoded.mediaType === 'video' && decoded.mediaUrl) return decoded.mediaUrl;
    }
  } catch { /* Preview remains usable offline or before rules are deployed. */ }
  return item.mediaUrl;
}
