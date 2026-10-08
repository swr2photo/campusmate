import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import { imageResizeActions } from './imagePolicy';

export const MAX_PROFILE_IMAGE_SIZE_MB = 30;
export const MAX_PROFILE_IMAGE_SIZE_BYTES = MAX_PROFILE_IMAGE_SIZE_MB * 1024 * 1024;

/**
 * Validates that an image does not exceed the maximum allowed size (default 30 MB).
 * Works with file://, content://, local path, and data: URIs.
 *
 * @param {string} uri - Image URI
 * @param {number|null} knownSizeBytes - Pre-computed or ImagePicker asset.fileSize if available
 * @param {number} maxMb - Max size in MB (default 30)
 * @returns {Promise<{ valid: boolean, sizeBytes: number, sizeMb: number, error?: string }>}
 */
export async function validateImageSize(uri, knownSizeBytes = null, maxMb = MAX_PROFILE_IMAGE_SIZE_MB) {
  const maxBytes = maxMb * 1024 * 1024;

  if (!uri || typeof uri !== 'string') {
    return { valid: false, sizeBytes: 0, sizeMb: 0, error: 'ไม่พบไฟล์รูปภาพที่เลือก' };
  }

  let sizeBytes = typeof knownSizeBytes === 'number' && knownSizeBytes > 0 ? knownSizeBytes : null;

  // If size was not provided by ImagePicker, read from file system or data URI
  if (sizeBytes === null) {
    if (uri.startsWith('data:')) {
      const base64Data = uri.split(',')[1] || uri;
      sizeBytes = Math.floor((base64Data.length * 3) / 4);
    } else {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && typeof info.size === 'number') {
          sizeBytes = info.size;
        }
      } catch (err) {
        console.warn('[validateImageSize] Failed to read file info:', err);
      }
    }
  }

  if (typeof sizeBytes === 'number' && sizeBytes > maxBytes) {
    const sizeMb = Number((sizeBytes / (1024 * 1024)).toFixed(1));
    return {
      valid: false,
      sizeBytes,
      sizeMb,
      error: `รูปภาพมีขนาดใหญ่เกินไป (${sizeMb} MB) กรุณาเลือกรูปภาพที่มีขนาดไม่เกิน ${maxMb} MB`,
    };
  }

  const currentMb = sizeBytes ? Number((sizeBytes / (1024 * 1024)).toFixed(2)) : 0;
  return { valid: true, sizeBytes: sizeBytes || 0, sizeMb: currentMb };
}

/**
 * Compresses a profile image to JPEG with a longest side of at most 1024px.
 * Checks size before manipulation to prevent freezing or OOM crashes on huge files.
 *
 * @param {string} uri - Local image file URI
 * @returns {Promise<string>} - Compressed image file URI
 */
export async function compressProfileImage(uri) {
  if (!uri || typeof uri !== 'string') return uri;

  // Guard against files exceeding max size before manipulation
  const validation = await validateImageSize(uri);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const result = await compressUploadImage(uri, { maxDimension: 1024, quality: 0.7, targetBytes: 350 * 1024 });
  return result.uri;
}

export async function compressUploadImage(uri, {
  width, height, maxDimension = 1440, quality = 0.72, targetBytes = 600 * 1024,
} = {}) {
  const validation = await validateImageSize(uri);
  if (!validation.valid) throw new Error(validation.error);
  if (!width || !height) {
    const dimensions = await new Promise((resolve, reject) => Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject));
    width = dimensions.width;
    height = dimensions.height;
  }
  const actions = imageResizeActions(width, height, maxDimension);
  let result = await manipulateAsync(uri, actions, { compress: quality, format: SaveFormat.JPEG });
  const info = await FileSystem.getInfoAsync(result.uri).catch(() => null);
  if (info?.size > targetBytes) {
    result = await manipulateAsync(result.uri, [], { compress: 0.55, format: SaveFormat.JPEG });
  }
  return result;
}

