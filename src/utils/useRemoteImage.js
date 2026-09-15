import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

// In-memory caches to survive across re-renders and components
const versionCache = new Map(); // exact cacheKey -> localUri
const urlCache = new Map();     // cleanUrl -> last known localUri
const scopeCache = new Map();   // scope -> last known localUri
const inflightDownloads = new Map(); // targetFileUri -> Promise<string | null>

function cleanUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/([?&])cmv=[^&]+(&|$)/, (_, prefix, suffix) => {
    return suffix === '&' ? prefix : '';
  }).replace(/[?&]$/, '');
}

function normalizeVersion(version) {
  if (version === null || version === undefined || version === '') return '';
  if (typeof version?.toMillis === 'function') return String(version.toMillis());
  if (version instanceof Date) return String(version.getTime());
  if (typeof version === 'object' && Number.isFinite(version.seconds)) {
    return `${version.seconds}.${version.nanoseconds || 0}`;
  }
  return String(version);
}

function addCacheVersion(url, version) {
  if (!version) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}cmv=${encodeURIComponent(version)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function getSynchronousCachedUri(cacheKey, clean, scope) {
  if (cacheKey && versionCache.has(cacheKey)) {
    return versionCache.get(cacheKey);
  }
  if (clean && urlCache.has(clean)) {
    return urlCache.get(clean);
  }
  if (scope && scopeCache.has(scope)) {
    return scopeCache.get(scope);
  }
  return null;
}

export function useRemoteImage(url, version, cacheScope) {
  const isLocalOrData = Boolean(
    url && typeof url === 'string' && (url.startsWith('file://') || url.startsWith('data:'))
  );

  const normalizedVersion = normalizeVersion(version);
  const normalizedScope = cacheScope === null || cacheScope === undefined ? '' : String(cacheScope);
  const clean = !isLocalOrData ? cleanUrl(url) : '';
  const remoteUrl = !isLocalOrData && clean
    ? (normalizedVersion ? addCacheVersion(clean, normalizedVersion) : clean)
    : '';
  const cacheKey = remoteUrl
    ? (normalizedScope ? `${normalizedScope}:${remoteUrl}` : remoteUrl)
    : '';

  const syncUri = isLocalOrData
    ? url
    : (cacheKey ? getSynchronousCachedUri(cacheKey, clean, normalizedScope) : (clean && urlCache.has(clean) ? urlCache.get(clean) : null));

  const [localUri, setLocalUri] = useState(syncUri);
  const [prevKey, setPrevKey] = useState(cacheKey);
  const prevScopeRef = useRef(normalizedScope);

  // Synchronously update state on key change during render to prevent 1-render blank flash
  if (prevKey !== cacheKey) {
    setPrevKey(cacheKey);
    const isNewScopeWithoutCache = normalizedScope && prevScopeRef.current !== normalizedScope && !syncUri;
    prevScopeRef.current = normalizedScope;
    if (isNewScopeWithoutCache) {
      setLocalUri(null);
    } else if (syncUri) {
      setLocalUri(syncUri);
    }
  }

  useEffect(() => {
    if (!remoteUrl || isLocalOrData) return undefined;

    let cancelled = false;
    let retryTimer = null;
    const targetFileUri = `${FileSystem.cacheDirectory}campusmate-avatar-${hashString(cacheKey)}.jpg`;

    async function checkDiskAndDownload(retryCount = 0) {
      try {
        if (versionCache.has(cacheKey)) {
          const cached = versionCache.get(cacheKey);
          if (!cancelled) setLocalUri(cached);
          return;
        }

        // Check if file already exists on disk
        const fileInfo = await FileSystem.getInfoAsync(targetFileUri).catch(() => null);
        if (fileInfo && fileInfo.exists && fileInfo.size > 500) {
          versionCache.set(cacheKey, targetFileUri);
          urlCache.set(clean, targetFileUri);
          if (normalizedScope) scopeCache.set(normalizedScope, targetFileUri);
          if (!cancelled) setLocalUri(targetFileUri);
          return;
        }

        // Deduplicate concurrent downloads to the same file
        let dlPromise = inflightDownloads.get(targetFileUri);
        if (!dlPromise) {
          dlPromise = (async () => {
            try {
              const res = await FileSystem.downloadAsync(remoteUrl, targetFileUri);
              if (res && res.status === 200) {
                return res.uri;
              }
              await FileSystem.deleteAsync(targetFileUri, { idempotent: true }).catch(() => {});
              return null;
            } catch {
              await FileSystem.deleteAsync(targetFileUri, { idempotent: true }).catch(() => {});
              return null;
            } finally {
              inflightDownloads.delete(targetFileUri);
            }
          })();
          inflightDownloads.set(targetFileUri, dlPromise);
        }

        const resultUri = await dlPromise;
        if (cancelled) return;

        if (resultUri) {
          versionCache.set(cacheKey, resultUri);
          urlCache.set(clean, resultUri);
          if (normalizedScope) scopeCache.set(normalizedScope, resultUri);
          setLocalUri(resultUri);
        } else if (retryCount < 2) {
          const delay = Math.min(1000 * (2 ** retryCount), 4000);
          retryTimer = setTimeout(() => {
            if (!cancelled) void checkDiskAndDownload(retryCount + 1);
          }, delay);
        }
      } catch {
        if (!cancelled && retryCount < 2) {
          const delay = Math.min(1000 * (2 ** retryCount), 4000);
          retryTimer = setTimeout(() => {
            if (!cancelled) void checkDiskAndDownload(retryCount + 1);
          }, delay);
        }
      }
    }

    void checkDiskAndDownload();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [cacheKey, remoteUrl, clean, normalizedScope, isLocalOrData]);

  if (isLocalOrData) return url;
  if (!remoteUrl) return null;
  return localUri || syncUri || null;
}
