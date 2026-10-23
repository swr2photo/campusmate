// Raw image uploads to the native backend. The server re-encodes the image,
// strips EXIF/GPS, runs moderation and stores it; no client URL is trusted.
import * as FileSystem from 'expo-file-system/legacy';
import { rustAccessToken, rustOrigin } from './backend';
import { compressUploadImage } from '../../utils/compressImage';

function moderationError(body) {
  const error = new Error(body?.error?.message || 'อัปโหลดรูปภาพไม่สำเร็จ');
  error.code = `functions/${body?.error?.code || 'internal'}`;
  error.details = body?.error?.details;
  if (error.details?.moderationStatus === 'blocked') {
    error.isModerationViolation = true;
    error.reason = error.details.reason;
  } else if (error.details?.moderationStatus === 'unavailable') {
    error.isModerationUnavailable = true;
  }
  return error;
}

async function localFile(uri) {
  if (uri.startsWith('file://')) return { path: uri, temporary: false };
  if (uri.startsWith('data:')) {
    const path = `${FileSystem.cacheDirectory}rust_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.writeAsStringAsync(path, uri.split(',')[1] || '', { encoding: FileSystem.EncodingType.Base64 });
    return { path, temporary: true };
  }
  if (uri.startsWith('ph://') || uri.startsWith('content://')) {
    const path = `${FileSystem.cacheDirectory}rust_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: path });
    return { path, temporary: true };
  }
  throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
}

/** `kind`: `avatar` | `gallery` | `moderate`. Returns the parsed JSON body. */
export async function uploadRawImage(kind, uri, contentType = 'image/jpeg', onProgress) {
  const route = { avatar: ['PUT', 'avatar'], gallery: ['PUT', 'gallery'], moderate: ['POST', 'moderate'] }[kind];
  if (!route) throw new Error('ประเภทการอัปโหลดไม่ถูกต้อง');
  const { token } = await rustAccessToken();
  const file = await localFile(uri);
  try {
    const prepared = kind === 'moderate' ? { uri: file.path } : await compressUploadImage(file.path);
    const options = {
      httpMethod: route[0],
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': kind === 'moderate' ? contentType : 'image/jpeg', Accept: 'application/json' },
    };
    const url = `${rustOrigin()}/v1/media/${route[1]}`;
    const task = typeof FileSystem.createUploadTask === 'function' ? FileSystem.createUploadTask(url, prepared.uri, options, event => {
      try { onProgress?.(event.totalBytesExpectedToSend > 0 ? event.totalBytesSent / event.totalBytesExpectedToSend : null); } catch { /* UI feedback cannot fail uploads. */ }
    }) : null;
    let timeout;
    let result;
    try {
      result = await Promise.race([
        task ? task.uploadAsync() : FileSystem.uploadAsync(url, prepared.uri, options),
        new Promise((_, reject) => { timeout = setTimeout(() => { void task?.cancelAsync().catch(() => {}); reject(new Error('อัปโหลดรูปนานเกินไป กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง')); }, 45000); }),
      ]);
    } finally { clearTimeout(timeout); }
    if (!result) throw new Error('การอัปโหลดถูกขัดจังหวะ กรุณาลองอีกครั้ง');
    let body = null;
    try { body = JSON.parse(result.body); } catch { /* handled below */ }
    if (result.status < 200 || result.status >= 300) throw moderationError(body);
    return body;
  } finally {
    if (file.temporary) await FileSystem.deleteAsync(file.path, { idempotent: true }).catch(() => {});
  }
}
