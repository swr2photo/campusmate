import { requireOptionalNativeModule } from 'expo';
import * as FileSystem from 'expo-file-system/legacy';
import { validateChatVideo } from '../utils/chatVideoPolicy';
import { validateVideoEdit } from '../utils/videoEdit';

export async function exportChatVideo(asset, edit, quality = 'preview') {
  validateVideoEdit(asset.duration, edit);
  const processor = requireOptionalNativeModule('ChatVideoProcessor');
  if (!processor) throw new Error('กรุณาอัปเดตแอปเป็นรุ่นที่รองรับการตัดวิดีโอ');
  const result = await processor.exportVideo(asset.uri, edit.startMs, edit.endMs, edit.muted === true, quality);
  try {
    const info = await FileSystem.getInfoAsync(result.uri);
    return validateChatVideo({ ...result, fileSize: info.size, type: 'video' });
  } catch (error) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw error;
  }
}

export async function discardVideoExport(asset) {
  if (asset?.uri) await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
}
