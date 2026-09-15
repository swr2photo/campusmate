export const MAX_VIDEO_DURATION_MS = 60000;
// Leave room for the encryption envelope under the storage fallback's 25 MiB limit.
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
export const VIDEO_MODES = { once: 'ดูครั้งเดียว', replay: 'ดูซ้ำ', chat: 'เก็บไว้ในแชต' };

export function validateChatVideo(asset, mode = 'chat') {
  if (!Object.hasOwn(VIDEO_MODES, mode)) throw new Error('รูปแบบการส่งวิดีโอไม่ถูกต้อง');
  if (!asset?.uri || !Number.isFinite(asset.duration) || asset.duration <= 0) {
    throw new Error('ไม่สามารถตรวจสอบความยาววิดีโอได้ กรุณาเลือกไฟล์อื่น');
  }
  if (asset.duration > MAX_VIDEO_DURATION_MS) throw new Error('ส่งวิดีโอได้ไม่เกิน 60 วินาที');
  if (!Number.isFinite(asset.fileSize) || asset.fileSize <= 0 || asset.fileSize > MAX_VIDEO_BYTES) {
    throw new Error('กรุณาเลือกวิดีโอขนาดไม่เกิน 24 MB');
  }
  return asset;
}
