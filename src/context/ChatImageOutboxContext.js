import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from './AuthContext';
import { useAppActions, useAppSync } from './AppContext';
import { getEncryptedItem, setEncryptedItem } from '../utils/encryptedStorage';
import { compressUploadImage } from '../utils/compressImage';
import { createImageOutbox } from '../services/imageOutbox';
import { ensureLocalFileUri, preCacheDecryptedMedia, uploadChatMedia } from '../services/chatMediaService';
import { encryptMessageRecord, getOrFetchConversationKey } from '../services/chatEncryptionService';
import { RUST_BACKEND, rpc, rustUid, waitForRustSession } from '../services/rust/backend';
import { getGroupKeys } from '../services/groupChatEncryption';
import { sendGroupImage } from '../services/partyService';

const Context = createContext(null);
const validId = id => /^img-[0-9a-f-]{36}$/.test(String(id));

export function ChatImageOutboxProvider({ children }) {
  const { user } = useAuth();
  const { sendMessage } = useAppActions();
  const { isOnline } = useAppSync();
  const uid = user?.id;
  const ownerRef = useRef(uid), sendRef = useRef(sendMessage), engineRef = useRef(null);
  ownerRef.current = uid; sendRef.current = sendMessage;
  const [state, setState] = useState({ uid: null, tasks: [], ready: false, error: '' });

  useEffect(() => {
    let active = true, engine, unsubscribe;
    setState({ uid, tasks: [], ready: false, error: '' });
    if (!uid) return () => { active = false; };
    const owner = uid, key = `campusmate_image_outbox_v1:${owner}`;
    const current = () => active && ownerRef.current === owner && (!RUST_BACKEND || rustUid() === owner);
    const directory = `${FileSystem.documentDirectory}chat-image-outbox/${encodeURIComponent(owner)}/`;
    const keys = new Map();
    const groupState = async conversationId => {
      const [rooms, page] = await Promise.all([rpc('listGroupChats', { partyId: conversationId }), rpc('groupMessages', { partyId: conversationId })]);
      if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
      const room = rooms?.chats?.[0];
      if (!room?.memberIds?.includes(owner) || room.rekeyRequired) throw new Error('ยังส่งรูปในกลุ่มนี้ไม่ได้ กรุณารอเตรียมกุญแจกลุ่ม');
      const groupKeys = await getGroupKeys(conversationId, owner, page.epochs);
      const keyBytes = groupKeys[room.currentEpoch];
      if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) throw new Error('ยังไม่พบกุญแจกลุ่ม กรุณาลองอีกครั้ง');
      return { epoch: room.currentEpoch, keyBytes };
    };
    const prepare = async task => {
      if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
      const local = await ensureLocalFileUri(task.uri);
      const prepared = await compressUploadImage(local);
      if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const uri = `${directory}${task.id}.jpg`;
      await FileSystem.copyAsync({ from: prepared.uri, to: uri });
      return { uri, prepared: true, width: prepared.width, height: prepared.height };
    };
    const upload = async (task, onProgress) => {
      if (task.roomKind === 'group') {
        const group = await groupState(task.conversationId);
        if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
        keys.set(task.id, group.keyBytes);
        const downloadUrl = await uploadChatMedia(task.uri, { conversationId: task.conversationId, groupChatId: task.conversationId,
          mediaType: 'image', extension: 'jpg', conversationKey: group.keyBytes, preparedImage: true, onProgress });
        return { downloadUrl, mediaEpoch: group.epoch };
      }
      const conversationKey = await getOrFetchConversationKey(task.conversationId, owner);
      if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
      if (!(conversationKey instanceof Uint8Array) || conversationKey.length !== 32) throw new Error('ยังเชื่อมต่อห้องแชตไม่ได้ กรุณาลองส่งอีกครั้ง');
      keys.set(task.id, conversationKey);
      return uploadChatMedia(task.uri, { conversationId: task.conversationId, mediaType: 'image', extension: 'jpg',
        conversationKey, preparedImage: true, onProgress });
    };
    const cleanup = async task => {
      if (!task.prepared || !validId(task.id) || task.uri !== `${directory}${task.id}.jpg`) return;
      const keyBytes = keys.get(task.id);
      if (task.downloadUrl && keyBytes) {
        const cacheDirectory = `${FileSystem.cacheDirectory}sent-chat-images/`;
        await FileSystem.makeDirectoryAsync(cacheDirectory, { intermediates: true });
        const cached = `${cacheDirectory}${task.id}.jpg`;
        await FileSystem.copyAsync({ from: task.uri, to: cached });
        preCacheDecryptedMedia(task.downloadUrl, cached, { conversationKey: keyBytes });
      }
      await FileSystem.deleteAsync(task.uri, { idempotent: true }).catch(() => {});
      keys.delete(task.id);
    };
    void (async () => {
      if (RUST_BACKEND) {
        try { await waitForRustSession(); }
        catch { if (active) setState({ uid: owner, tasks: [], ready: false, error: 'เชื่อมต่อบัญชีไม่ได้ กรุณาเปิดแอปอีกครั้ง' }); return; }
      }
      let initial;
      try { initial = JSON.parse(await getEncryptedItem(key) || '[]'); }
      catch { if (active) setState({ uid: owner, tasks: [], ready: false, error: 'โหลดรูปที่รอส่งไม่ได้ กรุณาเปิดแอปอีกครั้ง' }); return; }
      if (!current()) return;
      engine = createImageOutbox({
        initial: Array.isArray(initial) ? initial.filter(task => validId(task.id) && typeof task.conversationId === 'string' && typeof task.uri === 'string') : [],
        prepare, upload, isCurrent: current,
        persist: tasks => setEncryptedItem(key, JSON.stringify(tasks)),
        prepareSend: async task => {
          if (task.roomKind !== 'group') {
            if (!RUST_BACKEND) return null;
            const keyBytes = keys.get(task.id) || await getOrFetchConversationKey(task.conversationId, owner);
            if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
            keys.set(task.id, keyBytes);
            return { directEncrypted: task.directEncrypted || encryptMessageRecord({ id: task.id, senderId: owner,
              text: task.caption || '[รูปภาพ]', mediaType: 'image', mediaUrl: task.downloadUrl, viewMode: task.viewMode,
              replyTo: task.replyTo, createdAt: task.createdAt, time: task.createdAt }, keyBytes) };
          }
          const group = await groupState(task.conversationId);
          if (group.epoch !== task.mediaEpoch) throw Object.assign(new Error('กุญแจกลุ่มเปลี่ยนแล้ว กรุณากดลองส่งใหม่'), { resetUpload: true });
          keys.set(task.id, group.keyBytes);
          // Persist the exact nonce/ciphertext before queuing: an unknown
          // acknowledgement must retry the same encrypted record and ID.
          return { groupEncrypted: task.groupEncrypted || encryptMessageRecord({ text: task.caption || '[รูปภาพ]',
            mediaType: 'image', mediaUrl: task.downloadUrl, ...(task.viewMode !== 'chat' ? { viewMode: task.viewMode } : {}) }, group.keyBytes) };
        },
        send: async task => {
          if (!current()) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'ACCOUNT_CHANGED' });
          if (task.roomKind === 'group') {
            return !!(await sendGroupImage(task.conversationId, owner, task.mediaEpoch, task.downloadUrl, keys.get(task.id),
              { caption: task.caption, viewMode: task.viewMode, clientMessageId: task.id, clientSentAt: task.createdAt, encryptedRecord: task.groupEncrypted }));
          }
          return sendRef.current(task.conversationId, task.caption || '[รูปภาพ]', { mediaType: 'image', viewMode: task.viewMode,
            mediaUrl: task.downloadUrl, clientMessageId: task.id, clientSentAt: task.createdAt, replyTo: task.replyTo,
            ...(task.directEncrypted ? { encryptedRecord: task.directEncrypted } : {}) });
        },
        onComplete: task => cleanup(task).catch(() => {}),
      });
      engineRef.current = { owner, engine, cleanup };
      unsubscribe = engine.subscribe(tasks => { if (current()) setState({ uid: owner, tasks, ready: true, error: '' }); });
      engine.setOnline(isOnline !== false);
    })();
    return () => { active = false; unsubscribe?.(); engine?.dispose(); if (engineRef.current?.owner === owner) engineRef.current = null; };
    // Network changes resume the existing queue instead of replacing it.
  }, [uid]);

  useEffect(() => {
    const scoped = engineRef.current;
    // During auth restore both owner and uid can be undefined; equality
    // alone does not mean an engine exists.
    if (!uid || !scoped || scoped.owner !== uid) return;
    scoped.engine.setOnline(isOnline !== false);
  }, [isOnline, uid, state.ready]);
  const requireEngine = useCallback(() => {
    const scoped = engineRef.current;
    if (!uid || scoped?.owner !== uid) throw new Error(state.error || 'กำลังเตรียมการส่งรูป กรุณาลองอีกครั้ง');
    return scoped;
  }, [uid, state.error]);
  const enqueue = useCallback((conversationId, uris, caption, viewMode = 'chat', replyTo, roomKind = 'direct') => {
    const scoped = requireEngine();
    if (!conversationId || !['direct', 'group'].includes(roomKind) || !['chat', 'once', 'replay'].includes(viewMode)) throw new Error('ห้องแชตหรือวิธีการดูรูปภาพไม่ถูกต้อง');
    const text = String(caption || '').trim();
    const captionLimit = roomKind === 'group' ? 500 : 1000;
    if (text.length > captionLimit) throw new Error(`คำบรรยายยาวเกินไป กรุณาใช้ไม่เกิน ${captionLimit} ตัวอักษร`);
    const sources = (Array.isArray(uris) ? uris : [uris]).filter(uri => typeof uri === 'string' && /^(file:|content:|ph:|data:)/.test(uri)).slice(0, 10);
    if (!sources.length) throw new Error('ไม่พบรูปภาพที่เลือก');
    const stamp = Date.now();
    scoped.engine.enqueue(sources.map((uri, index) => ({ id: `img-${Crypto.randomUUID()}`, conversationId, roomKind, uri,
      caption: index === 0 ? text : '', viewMode, createdAt: stamp + index, replyTo: index === 0 ? replyTo : undefined })));
  }, [requireEngine]);
  const retry = useCallback(id => requireEngine().engine.retry(id), [requireEngine]);
  const remove = useCallback(async id => { const scoped = requireEngine(); const task = await scoped.engine.remove(id); if (task) await scoped.cleanup(task).catch(() => {}); }, [requireEngine]);
  const value = useMemo(() => ({ uid, tasks: state.uid === uid ? state.tasks : [], ready: state.uid === uid && state.ready, error: state.error,
    enqueue, retry, remove }), [state, uid, enqueue, retry, remove]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatImageOutbox(conversationId, roomKind = 'direct') {
  const context = useContext(Context);
  const tasks = context?.tasks || [];
  const messages = useMemo(() => tasks.filter(task => task.conversationId === conversationId && (task.roomKind || 'direct') === roomKind).map(task => ({ ...task,
    imageOutbox: true, sender: 'me', senderId: context?.uid, text: task.caption || '[รูปภาพ]', time: task.createdAt, clientSentAt: task.createdAt,
    mediaType: 'image', mediaUrl: task.uri, sendStatus: task.status === 'failed' ? 'failed' : 'pending',
    pendingSync: true, isUploading: task.status !== 'failed' })), [tasks, conversationId, roomKind, context?.uid]);
  return { ...context, messages };
}
