import { useState, useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * ดาวน์โหลดรูปจาก URL ลง local cache แล้ว return local URI
 * - ถ้า URL เปลี่ยน → ดาวน์โหลดใหม่ แต่แสดงรูปเก่าไปก่อน (ไม่กระพริบ)
 * - retry สูงสุด 3 ครั้งด้วย exponential backoff
 * - invalidate cache ถ้า URL มี query param (cache-buster) ต่างจากที่ cache ไว้
 */
const memoryCache = new Map();

export function useRemoteImage(url) {
  // Initialize with memory cache if available to prevent flash
  const [localUri, setLocalUri] = useState(() => {
    if (!url) return null;
    if (url.startsWith('file://') || url.startsWith('data:')) return url;
    return memoryCache.get(url) || null;
  });
  const previousUrlRef = useRef(url);

  useEffect(() => {
    if (!url) {
      setLocalUri(null);
      previousUrlRef.current = null;
      return;
    }

    if (url.startsWith('file://') || url.startsWith('data:')) {
      setLocalUri(url);
      previousUrlRef.current = url;
      return;
    }

    let cancelled = false;

    async function downloadImage(retryCount = 0) {
      try {
        const baseUrl = url.split('?')[0];
        const hash = baseUrl.replace(/[^a-zA-Z0-9]/g, '');
        const fileUri = `${FileSystem.cacheDirectory}${hash}.jpg`;

        const urlVersion = (() => {
          try {
            const params = new URL(url).searchParams;
            return params.get('v') || '';
          } catch {
            return '';
          }
        })();

        const metaUri = `${FileSystem.cacheDirectory}${hash}.meta`;
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        
        if (fileInfo.exists && fileInfo.size > 1000) {
          let cachedVersion = '';
          try {
            cachedVersion = await FileSystem.readAsStringAsync(metaUri);
          } catch {}

          if (!urlVersion || cachedVersion === urlVersion) {
            if (!cancelled) {
              setLocalUri(fileUri);
              memoryCache.set(url, fileUri);
            }
            previousUrlRef.current = url;
            return;
          }

          if (!cancelled) {
            setLocalUri(fileUri); // show old while downloading
            memoryCache.set(url, fileUri);
          }
        }

        const downloadResult = await FileSystem.downloadAsync(url, fileUri);
        if (cancelled) return;

        if (downloadResult.status !== 200) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
          if (retryCount < 10) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 8000);
            setTimeout(() => {
              if (!cancelled) downloadImage(retryCount + 1);
            }, delay);
          }
          return;
        }

        if (!cancelled) {
          setLocalUri(downloadResult.uri);
          memoryCache.set(url, downloadResult.uri);
          previousUrlRef.current = url;
        }

        if (urlVersion) {
          try {
            await FileSystem.writeAsStringAsync(metaUri, urlVersion);
          } catch {}
        }
      } catch (error) {
        // error handling
      }
    }

    downloadImage();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return localUri;
}