import { Image, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const aspectRatioCache = new Map();
const MAX_ASPECT_RATIO_CACHE_SIZE = 1000;
let globalHasSeenFlipHint = null;

function readAspectRatioCache(key) {
  if (!aspectRatioCache.has(key)) return null;
  const cached = aspectRatioCache.get(key);
  aspectRatioCache.delete(key);
  aspectRatioCache.set(key, cached);
  return cached;
}

function writeAspectRatioCache(key, ratio) {
  aspectRatioCache.delete(key);
  if (aspectRatioCache.size >= MAX_ASPECT_RATIO_CACHE_SIZE) {
    const firstKey = aspectRatioCache.keys().next().value;
    if (firstKey) aspectRatioCache.delete(firstKey);
  }
  aspectRatioCache.set(key, ratio);
}

/**
 * Checks if the user has already seen the "แตะเพื่อเลื่อน" flip hint.
 * Results are cached in memory for zero-latency lookups.
 */
export async function hasSeenStackFlipHint() {
  if (globalHasSeenFlipHint !== null) return globalHasSeenFlipHint;
  try {
    const val = await AsyncStorage.getItem('@campusmate_has_seen_flip_hint_v1');
    globalHasSeenFlipHint = val === 'true';
    return globalHasSeenFlipHint;
  } catch {
    return false;
  }
}

/**
 * Marks the "แตะเพื่อเลื่อน" flip hint as seen permanently.
 */
export async function setStackFlipHintSeen() {
  globalHasSeenFlipHint = true;
  try {
    await AsyncStorage.setItem('@campusmate_has_seen_flip_hint_v1', 'true');
  } catch {}
}

/**
 * Calculates optimal chat bubble dimensions based on image aspect ratio (width / height).
 * Respects portrait (รูปตั้ง), landscape (แนวนอน), and square (จัตุรัส).
 *
 * @param {number|null} aspectRatio - width / height of the image
 * @returns {{ width: number, height: number, orientation: 'portrait'|'landscape'|'square' }}
 */
export function getChatImageBubbleSize(aspectRatio) {
  if (!aspectRatio || typeof aspectRatio !== 'number' || isNaN(aspectRatio) || aspectRatio <= 0) {
    return { width: 230, height: 180, orientation: 'landscape' };
  }

  // Portrait (รูปตั้ง - เช่น 9:16, 3:4, 4:5)
  if (aspectRatio < 0.85) {
    const width = 208;
    const clampedRatio = Math.max(aspectRatio, 0.65);
    const height = Math.min(Math.round(width / clampedRatio), 285);
    return { width, height, orientation: 'portrait' };
  }

  // Landscape (แนวนอน - เช่น 16:9, 4:3)
  if (aspectRatio > 1.15) {
    const width = 246;
    const clampedRatio = Math.min(aspectRatio, 1.85);
    const height = Math.max(Math.round(width / clampedRatio), 140);
    return { width, height, orientation: 'landscape' };
  }

  // Square (สี่เหลี่ยมจัตุรัส - 1:1)
  return { width: 210, height: 210, orientation: 'square' };
}

/**
 * Retrieves or measures natural aspect ratio of an image URI.
 * Caches results in memory for instant reuse.
 *
 * @param {string} uri - image URI (local file://, data:, or http)
 * @param {function} callback - called with (aspectRatio, size)
 */
export function measureImageAspectRatio(uri, callback) {
  if (!uri || typeof uri !== 'string') return;

  const cached = readAspectRatioCache(uri);
  if (cached) {
    callback?.(cached, getChatImageBubbleSize(cached));
    return;
  }

  Image.getSize(
    uri,
    (width, height) => {
      if (width && height && height > 0) {
        const ratio = width / height;
        writeAspectRatioCache(uri, ratio);
        callback?.(ratio, getChatImageBubbleSize(ratio));
      }
    },
    () => {
      // On error, fallback to null
    }
  );
}

/**
 * Explicitly caches an aspect ratio for an image URI or media key.
 *
 * @param {string} key
 * @param {number} ratio
 */
export function cacheAspectRatio(key, ratio) {
  if (key && typeof key === 'string' && ratio && typeof ratio === 'number' && ratio > 0) {
    writeAspectRatioCache(key, ratio);
  }
}

/**
 * Synchronously gets cached aspect ratio if already measured.
 */
export function getCachedAspectRatio(uri) {
  return uri ? readAspectRatioCache(uri) : null;
}

/**
 * Detects if a given string or URL points to an image.
 * Supports standard image extensions, query-based image parameters, and image CDNs.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('data:image/')) {
    return false;
  }
  if (clean.startsWith('data:image/')) return true;

  try {
    const parsed = new URL(clean);
    const pathname = parsed.pathname.toLowerCase();
    // Common image extensions
    if (/\.(jpeg|jpg|png|gif|webp|bmp|svg|tiff|avif|heic)$/i.test(pathname)) {
      return true;
    }
    // Query parameter indicators (Unsplash, Cloudinary, Imgur, Supabase, Firebase, etc.)
    const search = parsed.search.toLowerCase();
    if (search.includes('format=jpg') || search.includes('format=jpeg') || search.includes('format=png') || search.includes('format=webp')) {
      return true;
    }
    if (pathname.includes('/images/') || pathname.includes('/photo/') || pathname.includes('/photos/') || pathname.includes('/img/')) {
      return true;
    }
    // Known image hosting domains
    const host = parsed.hostname.toLowerCase();
    if (
      host.includes('images.unsplash.com') ||
      host.includes('i.imgur.com') ||
      host.includes('cdn.pixabay.com') ||
      host.includes('i.ibb.co') ||
      host.includes('res.cloudinary.com') ||
      host.includes('media.giphy.com') ||
      host.includes('c.tenor.com')
    ) {
      return true;
    }
  } catch {
    // Regex fallback if URL parsing fails
    if (/\.(jpeg|jpg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(clean)) return true;
  }

  return false;
}

/**
 * Extracts the first image URL from a text message.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractFirstImageUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const urls = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
  if (!urls || urls.length === 0) return null;
  for (const url of urls) {
    if (isImageUrl(url)) {
      return url;
    }
  }
  return null;
}

/**
 * Copies an image (local file or remote URL) to the system clipboard.
 *
 * @param {string} imageUri
 * @returns {Promise<boolean>}
 */
export async function copyImageToClipboard(imageUri) {
  if (!imageUri) return false;
  let tempPath;
  try {
    let base64Data;
    if (imageUri.startsWith('data:image/')) {
      base64Data = imageUri.split(',')[1];
    } else {
      let localUri = imageUri;
      if (/^https?:/.test(imageUri)) {
        tempPath = `${FileSystem.cacheDirectory}clip_${Date.now()}.jpg`;
        const result = await FileSystem.downloadAsync(imageUri, tempPath);
        if (result.status !== 200) return false;
        localUri = result.uri;
      }
      base64Data = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 || 'base64' });
    }
    if (!base64Data) return false;
    const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').replace(/\s+/g, '');
    await Clipboard.setImageAsync(cleanBase64);
    return true;
  } catch (err) {
    console.warn('[chatImageUtils] copyImageToClipboard failed:', err);
    return false;
  } finally {
    if (tempPath) await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
  }
}

/**
 * Saves an image (remote URL, local file://, or base64 data URI) to device Photo Library / Gallery.
 * Requests necessary permissions if not already granted.
 *
 * @param {string} imageUri
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function saveImageToGallery(imageUri) {
  if (!imageUri || typeof imageUri !== 'string') {
    return { success: false, error: 'invalid_uri' };
  }

  let MediaLibraryModule = null;
  try {
    MediaLibraryModule = require('expo-media-library/legacy');
  } catch {
    try {
      MediaLibraryModule = require('expo-media-library');
    } catch {}
  }

  if (!MediaLibraryModule) {
    return { success: false, error: 'no_media_library' };
  }

  try {
    // 1. Saving is write-only on Android. This avoids requesting broad
    // READ_MEDIA_IMAGES access; Android's system picker handles reads.
    const writeOnly = Platform.OS === 'android';
    let perm = null;
    if (typeof MediaLibraryModule.getPermissionsAsync === 'function') {
      perm = await MediaLibraryModule.getPermissionsAsync(writeOnly).catch(() => null);
    }
    if (!perm || perm.status !== 'granted') {
      if (typeof MediaLibraryModule.requestPermissionsAsync === 'function') {
        perm = await MediaLibraryModule.requestPermissionsAsync(writeOnly, writeOnly ? undefined : ['photo']).catch(() => null);
      }
    }

    if (perm && perm.status !== 'granted' && !perm.canAskAgain && Platform.OS === 'ios') {
      return { success: false, error: 'permission_blocked' };
    }
    if (perm && perm.status !== 'granted') {
      return { success: false, error: 'permission_denied' };
    }

    // 2. Resolve local file path
    let localUri = imageUri;
    let tempPath = null;

    try {
      if (imageUri.startsWith('data:image')) {
        const ext = imageUri.includes('png') ? 'png' : 'jpg';
        tempPath = `${FileSystem.cacheDirectory || ''}saved_${Date.now()}.${ext}`;
        const cleanBase64 = imageUri.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').replace(/\s+/g, '');
        await FileSystem.writeAsStringAsync(tempPath, cleanBase64, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });
        localUri = tempPath;
      } else if (/^https?:/.test(imageUri)) {
        const isPng = imageUri.toLowerCase().includes('.png');
        tempPath = `${FileSystem.cacheDirectory || ''}saved_${Date.now()}.${isPng ? 'png' : 'jpg'}`;
        const dlResult = await FileSystem.downloadAsync(imageUri, tempPath);
        if (dlResult.status !== 200) {
          return { success: false, error: 'download_failed' };
        }
        localUri = dlResult.uri;
      }

      // 3. Save to device library
      if (typeof MediaLibraryModule.saveToLibraryAsync === 'function') {
        await MediaLibraryModule.saveToLibraryAsync(localUri);
      } else if (typeof MediaLibraryModule.createAssetAsync === 'function') {
        await MediaLibraryModule.createAssetAsync(localUri);
      } else {
        return { success: false, error: 'save_not_supported' };
      }

      return { success: true };
    } finally {
      if (tempPath) {
        await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[chatImageUtils] saveImageToGallery error:', err);
    return { success: false, error: err?.message || 'unknown_error' };
  }
}

/**
 * Checks if the system clipboard has an image (or an image URL).
 *
 * @returns {Promise<{ hasImage: boolean, isUrl: boolean, previewText?: string }>}
 */
export async function checkClipboardForImage() {
  try {
    if (!Clipboard) {
      return { hasImage: false, isUrl: false };
    }
    if (typeof Clipboard.hasImageAsync === 'function') {
      const hasImage = await Clipboard.hasImageAsync().catch(() => false);
      if (hasImage) {
        return { hasImage: true, isUrl: false };
      }
    }

    if (typeof Clipboard.getStringAsync === 'function') {
      const text = await Clipboard.getStringAsync().catch(() => null);
      if (text) {
        const trimmed = text.trim();
        if (trimmed.startsWith('data:image/') || isImageUrl(trimmed)) {
          return { hasImage: true, isUrl: true, previewText: trimmed };
        }
      }
    }

    return { hasImage: false, isUrl: false };
  } catch (err) {
    return { hasImage: false, isUrl: false };
  }
}

/**
 * Retrieves the image from the system clipboard and saves it to a local temporary file.
 * If clipboard contains an image URL, downloads it to local file.
 *
 * @returns {Promise<string|null>} - Local file URI ready for sending/editing
 */
export async function getPastedImageFromClipboard() {
  try {
    if (Clipboard && typeof Clipboard.getImageAsync === 'function') {
      let clipImg = null;
      try {
        clipImg = await Clipboard.getImageAsync({ format: 'png' });
      } catch (_) {}

      if (clipImg?.data) {
        const rawData = clipImg.data;
        try {
          const cleanBase64 = rawData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').replace(/\s+/g, '');
          const cacheDir = FileSystem?.cacheDirectory || FileSystem?.documentDirectory;
          if (cacheDir && typeof FileSystem?.writeAsStringAsync === 'function') {
            const targetUri = `${cacheDir}pasted_img_${Date.now()}.png`;
            await FileSystem.writeAsStringAsync(targetUri, cleanBase64, {
              encoding: FileSystem?.EncodingType?.Base64 || 'base64',
            });
            return targetUri;
          }
        } catch (fileErr) {
          console.warn('[chatImageUtils] failed to save to file, fallback to data URI:', fileErr);
        }
        // Direct fallback to data URI - ensures pasted image ALWAYS shows up
        return rawData.startsWith('data:image') ? rawData : `data:image/png;base64,${rawData}`;
      }
    }

    // Check if text in clipboard is an image URL or data URI
    if (Clipboard && typeof Clipboard.getStringAsync === 'function') {
      const text = await Clipboard.getStringAsync().catch(() => null);
      if (text) {
        const trimmed = text.trim();
        if (trimmed.startsWith('data:image/')) {
          try {
            const cleanBase64 = trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').replace(/\s+/g, '');
            const cacheDir = FileSystem?.cacheDirectory || FileSystem?.documentDirectory;
            if (cacheDir && typeof FileSystem?.writeAsStringAsync === 'function') {
              const targetUri = `${cacheDir}pasted_img_${Date.now()}.png`;
              await FileSystem.writeAsStringAsync(targetUri, cleanBase64, {
                encoding: FileSystem?.EncodingType?.Base64 || 'base64',
              });
              return targetUri;
            }
          } catch (fileErr) {
            console.warn('[chatImageUtils] failed to save data url to file:', fileErr);
          }
          return trimmed;
        } else if (isImageUrl(trimmed)) {
          try {
            const cacheDir = FileSystem?.cacheDirectory || FileSystem?.documentDirectory;
            if (cacheDir && typeof FileSystem?.downloadAsync === 'function') {
              const targetUri = `${cacheDir}pasted_url_${Date.now()}.jpg`;
              const res = await FileSystem.downloadAsync(trimmed, targetUri);
              return res.uri;
            }
          } catch (dlErr) {
            console.warn('[chatImageUtils] failed to download image URL:', dlErr);
          }
          return trimmed;
        }
      }
    }

    return null;
  } catch (err) {
    console.warn('[chatImageUtils] getPastedImageFromClipboard failed:', err);
    return null;
  }
}
