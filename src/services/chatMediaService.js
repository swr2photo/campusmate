import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { compressUploadImage } from '../utils/compressImage';
import { getMediaCacheKey, isEncryptedMediaUrl } from '../utils/imagePolicy';
import { validateChatVideo } from '../utils/chatVideoPolicy';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage';
import { requireFirebase } from './dbService';
import { verifyImageSafety } from './imageModerationService';
import {
  encryptMediaBytes,
  decryptMediaBytes,
  bytesToBase64,
  base64ToBytes,
} from './chatEncryptionService';

const memoryMediaCache = new Map();
const MAX_MEDIA_CACHE_SIZE = 200;
const pendingMediaLoads = new Map();
const R2_RETRY_DELAY_MS = 350;
const FIREBASE_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

function logUploadStage(stage, startedAt, status, extra) {
  console.info('[ChatMediaUpload]', {
    stage,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(extra && typeof extra === 'object' ? extra : (extra ? { attempt: extra } : {})),
  });
}

function isTransientR2Status(status) {
  return status === 429 || status >= 500;
}

function isTransientR2NetworkError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOTFOUND)$/.test(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return /network|timed? ?out|timeout|connection|socket|failed to fetch|unable to resolve host/.test(message);
}

function shouldRefreshSignedUrl(status) {
  return status === 400 || status === 403;
}

function waitBeforeR2Retry() {
  return new Promise((resolve) => setTimeout(resolve, R2_RETRY_DELAY_MS));
}

async function requestR2UploadUrl({ app, conversationId, mediaType, extension, contentType }) {
  const functions = getFunctions(app, 'asia-southeast1');
  const getR2UploadUrlFn = httpsCallable(functions, 'getR2ChatUploadUrl', { timeout: 20000 });
  const r2Result = await getR2UploadUrlFn({
    conversationId,
    mediaType,
    extension,
    contentType,
    uploadProtocolVersion: 2,
  });
  return r2Result.data || {};
}

async function putFileToR2(uploadUrl, uploadUri, headers, fileBlobRef) {
  if (uploadUri.startsWith('file://') || uploadUri.startsWith('content://')) {
    const uploadRes = await FileSystem.uploadAsync(uploadUrl, uploadUri, {
      httpMethod: 'PUT',
      headers,
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    });
    return uploadRes.status;
  }

  if (!fileBlobRef.current) {
    fileBlobRef.current = await (await fetch(uploadUri)).blob();
  }
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: fileBlobRef.current,
  });
  return putRes.status;
}

function readMemoryMediaCache(mediaUrl) {
  if (!memoryMediaCache.has(mediaUrl)) return null;
  const cached = memoryMediaCache.get(mediaUrl);
  memoryMediaCache.delete(mediaUrl);
  memoryMediaCache.set(mediaUrl, cached);
  return cached;
}

function writeMemoryMediaCache(mediaUrl, localUri) {
  memoryMediaCache.delete(mediaUrl);
  if (memoryMediaCache.size >= MAX_MEDIA_CACHE_SIZE) {
    const firstKey = memoryMediaCache.keys().next().value;
    if (firstKey) memoryMediaCache.delete(firstKey);
  }
  memoryMediaCache.set(mediaUrl, localUri);
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export { verifyImageSafety };

export async function pickChatImages(options = {}) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: options.selectionLimit || 10,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  // Process sequentially so a selection of ten high resolution photos does
  // not hold ten decoded bitmaps in memory at once.
  const processed = [];
  for (const asset of result.assets) {
    const manipulated = await compressUploadImage(asset.uri, { width: asset.width, height: asset.height });
    processed.push({ uri: manipulated.uri, width: manipulated.width, height: manipulated.height });
  }

  return processed;
}

export async function pickChatImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const manipulated = await compressUploadImage(asset.uri, { width: asset.width, height: asset.height });

  return {
    uri: manipulated.uri,
    width: manipulated.width,
    height: manipulated.height,
  };
}

export async function takeChatPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('กรุณาอนุญาตการเข้าถึงกล้องเพื่อถ่ายรูป');
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const manipulated = await compressUploadImage(asset.uri, { width: asset.width, height: asset.height });

  return {
    uri: manipulated.uri,
    width: manipulated.width,
    height: manipulated.height,
  };
}

export async function ensureLocalFileUri(uri) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('ph://')) {
    return uri;
  }

  if (Platform.OS === 'ios') {
    // 1. Try MediaLibrary.getAssetInfoAsync if available
    try {
      const MediaLibrary = require('expo-media-library/legacy');
      const assetId = uri.replace('ph://', '');
      const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: true });
      if (info?.localUri && info.localUri.startsWith('file://')) {
        return info.localUri;
      }
    } catch {
      // Fall through to copyAsync
    }

    // 2. Native FileSystem.copyAsync supports ph:// directly on iOS
    try {
      const destPath = `${FileSystem.cacheDirectory}ph_asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: destPath });
      return destPath;
    } catch (copyErr) {
      console.warn('[ensureLocalFileUri] Failed to copy ph:// asset to cache:', copyErr?.message || copyErr);
    }
  }

  return uri;
}

export async function uploadChatMedia(localUri, { conversationId, mediaType = 'image', extension, conversationKey, videoDuration }) {
  if (!localUri || !conversationId) {
    throw new Error('Missing file URI or conversation ID');
  }
  if (!(conversationKey instanceof Uint8Array) || conversationKey.length !== 32) {
    throw new Error('ไม่พบกุญแจเข้ารหัสสื่อ กรุณาลองใหม่อีกครั้ง');
  }

  const uploadStartedAt = Date.now();
  const fileUri = await ensureLocalFileUri(localUri);

  if (mediaType === 'video') {
    const info = await FileSystem.getInfoAsync(fileUri);
    validateChatVideo({ uri: fileUri, duration: videoDuration, fileSize: info.size });
    if (!conversationKey) throw new Error('ไม่พบกุญแจเข้ารหัสวิดีโอ');
  }

  // Start the fail-closed image check while the signed upload URL loads. Handle both
  // outcomes immediately so a rejection cannot become an unhandled promise.
  const moderationStartedAt = Date.now();
  const moderationResult = mediaType === 'image'
    ? verifyImageSafety(fileUri).then(
      () => {
        logUploadStage('moderation', moderationStartedAt, 'success');
        return { ok: true };
      },
      (error) => {
        logUploadStage('moderation', moderationStartedAt, 'failed');
        return { ok: false, error };
      }
    )
    : null;

  const { app } = requireFirebase();
  let uploadUri = fileUri;
  let ext = extension || (mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'm4a' : 'jpg'));
  let contentType = mediaType === 'video' ? 'video/mp4' : (mediaType === 'audio' ? 'audio/mp4' : 'image/jpeg');
  let tempEncUri = null;

  // Ask R2 for a signed URL while encryption/moderation run — the cold-start
  // cost overlaps local work instead of stacking after it.
  let signerPromise = null;
  const startSigner = (nextExt, nextContentType) => {
    const signerStartedAt = Date.now();
    signerPromise = requestR2UploadUrl({
      app,
      conversationId,
      mediaType,
      extension: nextExt,
      contentType: nextContentType,
    }).then(
      (data) => {
        logUploadStage(
          'signer',
          signerStartedAt,
          data.success && data.uploadUrl && data.downloadUrl ? 'success' : 'unavailable',
          { provider: data.provider || null },
        );
        return data;
      },
      (error) => {
        logUploadStage('signer', signerStartedAt, 'failed');
        return { success: false };
      },
    );
    return signerPromise;
  };

  // Encrypt binary bytes on-device with TweetNaCl (secretbox).
  if (conversationKey) {
    // Prefetch the .enc signed URL while checking safety and encrypting.
    startSigner('enc', 'application/octet-stream');
    if (moderationResult) {
      const result = await moderationResult;
      if (!result.ok) throw result.error;
    }
    const encryptionStartedAt = Date.now();
    try {
      const rawBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const rawBytes = base64ToBytes(rawBase64);
      const encryptedBytes = encryptMediaBytes(rawBytes, conversationKey);
      const encryptedBase64 = bytesToBase64(encryptedBytes);

      tempEncUri = `${FileSystem.cacheDirectory}enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.enc`;
      await FileSystem.writeAsStringAsync(tempEncUri, encryptedBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uploadUri = tempEncUri;
      ext = 'enc';
      contentType = 'application/octet-stream';
      logUploadStage('encryption', encryptionStartedAt, 'success');
    } catch (encryptErr) {
      logUploadStage('encryption', encryptionStartedAt, 'failed');
      if (tempEncUri) await FileSystem.deleteAsync(tempEncUri, { idempotent: true }).catch(() => {});
      throw encryptErr;
    }
  }

  try {
    let fallbackReason = 'r2_unavailable';
    try {
      let data = await signerPromise;
      if (data?.success && data.uploadUrl && data.downloadUrl) {
        const fileBlobRef = { current: null };

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const putStartedAt = Date.now();
          let shouldRetry = false;
          let refreshUrl = false;
          try {
            const headers = data.uploadHeaders || { 'Content-Type': data.contentType || contentType };
            const status = await putFileToR2(data.uploadUrl, uploadUri, headers, fileBlobRef);
            logUploadStage('r2_put', putStartedAt, status, { attempt });
            if (status >= 200 && status < 300) {
              preCacheDecryptedMedia(data.downloadUrl, fileUri, { conversationKey, mediaType });
              logUploadStage('total', uploadStartedAt, 'r2');
              return data.downloadUrl;
            }
            shouldRetry = isTransientR2Status(status);
            refreshUrl = shouldRefreshSignedUrl(status);
            fallbackReason = `r2_status_${status}`;
          } catch (error) {
            shouldRetry = isTransientR2NetworkError(error);
            logUploadStage('r2_put', putStartedAt, shouldRetry ? 'network_error' : 'failed', { attempt });
            fallbackReason = shouldRetry ? 'r2_network_error' : 'r2_put_failed';
          }

          if ((!shouldRetry && !refreshUrl) || attempt === 3) break;

          if (refreshUrl || attempt === 2) {
            // 403/400 often mean a mismatched signed header set — mint a fresh URL.
            try {
              data = await startSigner(ext, contentType);
            } catch {
              break;
            }
            if (!(data?.success && data.uploadUrl && data.downloadUrl)) break;
          } else {
            await waitBeforeR2Retry();
          }
        }
      } else {
        fallbackReason = 'signer_unavailable';
      }
    } catch {
      fallbackReason = 'signer_failed';
    }

    // Avoid re-uploading large encrypted videos through Firebase when R2 failed —
    // that path is the multi-second/minute hang users hit.
    if (mediaType === 'video') {
      logUploadStage('firebase_fallback', Date.now(), 'skipped', { reason: fallbackReason });
      logUploadStage('total', uploadStartedAt, 'failed');
      throw new Error('อัปโหลดวิดีโอไปยังพื้นที่จัดเก็บไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }

    let uploadBytesEstimate = null;
    try {
      const info = await FileSystem.getInfoAsync(uploadUri);
      uploadBytesEstimate = Number(info?.size) || null;
    } catch {
      uploadBytesEstimate = null;
    }
    if (uploadBytesEstimate != null && uploadBytesEstimate > FIREBASE_FALLBACK_MAX_BYTES) {
      logUploadStage('firebase_fallback', Date.now(), 'skipped', {
        reason: fallbackReason,
        bytes: uploadBytesEstimate,
      });
      logUploadStage('total', uploadStartedAt, 'failed');
      throw new Error('อัปโหลดสื่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }

    // 2. Fallback to Firebase Storage (file is still encrypted .enc if conversationKey was provided!)
    const fallbackStartedAt = Date.now();
    const storage = getStorage(app, 'campusmate-7f1ab.firebasestorage.app');
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const storageRef = ref(storage, `chat_media/${conversationId}/${fileName}`);

    try {
      let blob;
      let useBase64 = false;
      try {
        const response = await fetch(uploadUri);
        blob = await response.blob();
      } catch {
        useBase64 = true;
      }

      if (useBase64) {
        const base64 = await FileSystem.readAsStringAsync(uploadUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await uploadString(storageRef, base64, 'base64', { contentType });
      } else {
        await uploadBytes(storageRef, blob, { contentType });
      }
      const downloadUrl = await getDownloadURL(storageRef);
      preCacheDecryptedMedia(downloadUrl, fileUri, { conversationKey, mediaType });
      logUploadStage('firebase_fallback', fallbackStartedAt, 'success', { reason: fallbackReason });
      logUploadStage('total', uploadStartedAt, 'firebase');
      return downloadUrl;
    } catch (error) {
      logUploadStage('firebase_fallback', fallbackStartedAt, 'failed', { reason: fallbackReason });
      logUploadStage('total', uploadStartedAt, 'failed');
      throw error;
    }
  } finally {
    if (tempEncUri) {
      FileSystem.deleteAsync(tempEncUri, { idempotent: true }).catch(() => {});
    }
  }
}

/**
 * Returns a local URI for displaying or playing media.
 * - If local, returns localUri directly.
 * - If legacy unencrypted (.jpg, .m4a, etc.), returns mediaUrl directly.
 * - If encrypted (.enc), checks disk cache -> if missing, downloads, decrypts with conversationKey, caches, and returns cached file URI.
 */
export async function getDecryptedMediaUri(mediaUrl, { conversationKey, mediaType = 'image' } = {}) {
  if (!mediaUrl) return null;
  const loadKey = getMediaCacheKey(mediaUrl, mediaType, conversationKey);
  if (!loadKey) {
    if (mediaType === 'video') throw new Error('ยังโหลดกุญแจวิดีโอไม่ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง');
    return null;
  }
  if (pendingMediaLoads.has(loadKey)) return pendingMediaLoads.get(loadKey);
  const loading = loadDecryptedMediaUri(mediaUrl, { conversationKey, mediaType });
  pendingMediaLoads.set(loadKey, loading);
  try { return await loading; }
  finally { if (pendingMediaLoads.get(loadKey) === loading) pendingMediaLoads.delete(loadKey); }
}

async function loadDecryptedMediaUri(mediaUrl, { conversationKey, mediaType = 'image' } = {}) {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('file://') || mediaUrl.startsWith('content://') || mediaUrl.startsWith('data:')) {
    return mediaUrl;
  }

  const cacheKey = getMediaCacheKey(mediaUrl, mediaType, conversationKey);
  if (!cacheKey) return null;
  const cached = readMemoryMediaCache(cacheKey);
  if (cached) {
    if (cached.startsWith('file://')) {
      const info = await FileSystem.getInfoAsync(cached).catch(() => null);
      if (info?.exists) return cached;
      memoryMediaCache.delete(cacheKey);
    } else {
      return cached;
    }
  }

  const [urlHash, keyHash] = await Promise.all([
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, mediaUrl),
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, cacheKey),
  ]);
  const targetExt = mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'm4a' : 'jpg');
  const cacheDir = `${FileSystem.cacheDirectory}decrypted_media/`;
  const cachedFileUri = `${cacheDir}${urlHash}-${keyHash}.${targetExt}`;

  // Ensure cache directory exists
  const dirInfo = await FileSystem.getInfoAsync(cacheDir).catch(() => null);
  if (!dirInfo?.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
  }

  // Check if disk cache already exists
  const fileInfo = await FileSystem.getInfoAsync(cachedFileUri).catch(() => null);
  if (fileInfo?.exists && fileInfo.size > 0) {
    writeMemoryMediaCache(cacheKey, cachedFileUri);
    return cachedFileUri;
  }

  // If not encrypted (.enc), download to local cache so that native components (e.g. iOS SwiftUI Image) can display it directly
  const isEncrypted = isEncryptedMediaUrl(mediaUrl);
  if (!isEncrypted) {
    const temp = `${cachedFileUri}.${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
    try {
      const downloadRes = await FileSystem.downloadAsync(mediaUrl, temp);
      if (downloadRes.status >= 200 && downloadRes.status < 300) {
        await FileSystem.moveAsync({ from: temp, to: cachedFileUri });
        writeMemoryMediaCache(cacheKey, cachedFileUri);
        return cachedFileUri;
      }
      if (mediaType === 'video') throw new Error(`ดาวน์โหลดวิดีโอไม่สำเร็จ (HTTP ${downloadRes.status})`);
      return null;
    } catch (error) {
      if (mediaType === 'video') throw error;
      return null;
    } finally {
      await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
    }
  }

  if (!conversationKey) {
    if (mediaType === 'video') throw new Error('ยังโหลดกุญแจวิดีโอไม่ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง');
    console.warn('[ChatMedia] Cannot decrypt media: conversationKey not available');
    return null;
  }

  // Download encrypted file and decrypt locally
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempEncPath = `${cacheDir}tmp_${urlHash}_${suffix}.enc`;
  const tempPlainPath = `${cacheDir}tmp_${urlHash}_${suffix}.${targetExt}`;
  try {
    const downloadRes = await FileSystem.downloadAsync(mediaUrl, tempEncPath);
    if (downloadRes.status < 200 || downloadRes.status >= 300) {
      throw new Error(`Failed to download encrypted media (HTTP ${downloadRes.status})`);
    }

    const encBase64 = await FileSystem.readAsStringAsync(tempEncPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const encBytes = base64ToBytes(encBase64);
    const decryptedBytes = decryptMediaBytes(encBytes, conversationKey);
    const decryptedBase64 = bytesToBase64(decryptedBytes);

    await FileSystem.writeAsStringAsync(tempPlainPath, decryptedBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.moveAsync({ from: tempPlainPath, to: cachedFileUri });

    writeMemoryMediaCache(cacheKey, cachedFileUri);
    return cachedFileUri;
  } catch (decryptErr) {
    console.warn('[ChatMedia] Decrypt media failed:', decryptErr?.message || decryptErr);
    if (mediaType === 'video') throw decryptErr;
    return null;
  } finally {
    FileSystem.deleteAsync(tempEncPath, { idempotent: true }).catch(() => {});
    FileSystem.deleteAsync(tempPlainPath, { idempotent: true }).catch(() => {});
  }
}

export function getSyncCachedMediaUri(mediaUrl, mediaType = 'image', conversationKey) {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('file://') || mediaUrl.startsWith('content://') || mediaUrl.startsWith('data:')) {
    return mediaUrl;
  }
  const cacheKey = getMediaCacheKey(mediaUrl, mediaType, conversationKey);
  if (!cacheKey) return null;
  const cached = readMemoryMediaCache(cacheKey);
  if (cached) {
    return cached;
  }
  // On React Native (Android / web): unencrypted image URLs are loaded natively by <Image>
  if (mediaType === 'image' && !isEncryptedMediaUrl(mediaUrl)) {
    return mediaUrl;
  }
  return null;
}

export function preCacheDecryptedMedia(mediaUrl, localUri, { conversationKey, mediaType = 'image' } = {}) {
  if (!mediaUrl || !localUri) return;
  const cacheKey = getMediaCacheKey(mediaUrl, mediaType, conversationKey);
  if (cacheKey) writeMemoryMediaCache(cacheKey, localUri);
}

export function formatAudioDuration(seconds = 0) {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function meteringToLevel(metering) {
  if (metering === undefined || metering === null || isNaN(metering)) return 0.2;
  // Metering in dB typically ranges from -160 to 0 dB (-55 to -5 dB for speech).
  const minDb = -52;
  const maxDb = -4;
  const clamped = Math.max(minDb, Math.min(maxDb, metering));
  const normalized = (clamped - minDb) / (maxDb - minDb);
  return Math.max(0.12, Math.min(1.0, normalized));
}

let currentRecorder = null;

export async function startAudioRecording() {
  const { AudioModule, RecordingPresets } = require('expo-audio');
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) {
    throw new Error('กรุณาอนุญาตการเข้าถึงไมโครโฟนเพื่อบันทึกเสียง');
  }

  await AudioModule.setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    playsInSilentModeIOS: true,
  });

  if (currentRecorder) {
    try {
      await currentRecorder.stop();
    } catch {}
    currentRecorder = null;
  }

  const recordingConfig = {
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  };

  const recorder = new AudioModule.AudioRecorder(recordingConfig);
  await recorder.prepareToRecordAsync(recordingConfig);
  recorder.record();
  currentRecorder = recorder;
  return recorder;
}

export function getRecordingStatus() {
  if (!currentRecorder) return null;
  try {
    return currentRecorder.getStatus ? currentRecorder.getStatus() : null;
  } catch {
    return null;
  }
}

export async function ensureAudioPlaybackMode() {
  try {
    const { AudioModule } = require('expo-audio');
    await AudioModule.setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      playsInSilentModeIOS: true,
    });
  } catch (err) {
    console.warn('[ChatMedia] ensureAudioPlaybackMode failed:', err?.message || err);
  }
}

export async function stopAudioRecording() {
  if (!currentRecorder) return null;
  const recorder = currentRecorder;
  currentRecorder = null;
  await recorder.stop();
  const uri = recorder.uri;
  const duration = Math.max(1, Math.round(recorder.currentTime || 0));
  await ensureAudioPlaybackMode();
  return { uri, duration };
}

export async function cancelAudioRecording() {
  if (!currentRecorder) return;
  const recorder = currentRecorder;
  currentRecorder = null;
  try {
    await recorder.stop();
  } catch {}
  await ensureAudioPlaybackMode();
}


export async function purgeDecryptedVideo(mediaUrl) {
  for (const cacheKey of memoryMediaCache.keys()) {
    if (cacheKey === `video:${mediaUrl}` || cacheKey.startsWith(`video:${mediaUrl}:`)) memoryMediaCache.delete(cacheKey);
  }
  const cacheDir = `${FileSystem.cacheDirectory}decrypted_media/`;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, mediaUrl);
  const files = await FileSystem.readDirectoryAsync(cacheDir).catch(() => []);
  const legacyName = `${hashString(mediaUrl)}.mp4`;
  await Promise.all(files.filter((name) => name === legacyName || (name.startsWith(`${digest}-`) && name.endsWith('.mp4')))
    .map((name) => FileSystem.deleteAsync(`${cacheDir}${name}`, { idempotent: true }).catch(() => {})));
}
