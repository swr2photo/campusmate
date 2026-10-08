import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { getRemoteImageRequestUrl, isLocalImageUri, isRemoteImageUrl, rewriteProfileImageUrl } from './imagePolicy';

const cachedPaths = new Map();
const pendingImages = new Map();
const cacheListeners = new Set();
let cacheGeneration = 0;
const MAX_IMAGE_CACHE_SIZE = 300;

export async function clearRemoteImageReferences() {
  cacheGeneration += 1;
  cachedPaths.clear();
  const pending = [...pendingImages.values()];
  pendingImages.clear();
  cacheListeners.forEach((listener) => listener(cacheGeneration));
  // Finish requests from the previous access scope before clearing the native
  // cache, so their late completions cannot put private photos back on disk.
  await Promise.allSettled(pending);
}

// expo-image can display the request immediately; SwiftUI's uiImage needs a
// local file. Keep those paths separate so native images never switch sources
// halfway through a download or request an unversioned fallback first.
export function getImageRequestUri(url, version) {
  if (isLocalImageUri(url)) return url;
  return getRemoteImageRequestUrl(rewriteProfileImageUrl(url, process.env.EXPO_PUBLIC_PROFILE_CDN_DOMAIN), version);
}

export function useProfileImagePrefetch(profiles, limit = 3) {
  const urls = [...new Set((profiles || []).slice(0, limit)
    .map((profile) => getImageRequestUri(profile?.avatarUri || profile?.photoURL, profile?.avatarRevision))
    .filter(isRemoteImageUrl))];
  const identity = JSON.stringify(urls);
  useEffect(() => {
    let active = true;
    // Only a small lookahead, two requests at a time. Stop scheduling when the
    // deck changes so old cards cannot starve the current image on slow links.
    const queue = JSON.parse(identity);
    async function warm() {
      while (active && queue.length) {
        const url = queue.shift();
        try { await prefetchRemoteImage(url); } catch { /* The visible image retries. */ }
      }
    }
    void warm();
    void warm();
    return () => { active = false; };
  }, [identity]);
}

function rememberPath(url, uri) {
  cachedPaths.delete(url);
  cachedPaths.set(url, uri);
  while (cachedPaths.size > MAX_IMAGE_CACHE_SIZE) cachedPaths.delete(cachedPaths.keys().next().value);
}

function asFileUri(path) {
  return path && !path.startsWith('file://') ? `file://${path}` : path;
}

// SwiftUI images need a file URI. Reuse expo-image's persistent native cache
// rather than downloading another copy into our own avatar directory.
export async function prefetchRemoteImage(url, version) {
  const requestUrl = getImageRequestUri(url, version);
  if (!requestUrl) return null;
  if (pendingImages.has(requestUrl)) return pendingImages.get(requestUrl);
  const generation = cacheGeneration;
  const pending = (async () => {
    let path = await Image.getCachePathAsync(requestUrl).catch(() => null);
    if (path) {
      const info = await FileSystem.getInfoAsync(asFileUri(path)).catch(() => null);
      if (!info?.exists) path = null;
    }
    if (!path) {
      cachedPaths.delete(requestUrl);
      const downloaded = await Image.prefetch(requestUrl, 'memory-disk');
      if (!downloaded) return null;
      path = await Image.getCachePathAsync(requestUrl);
    }
    const uri = asFileUri(path);
    if (generation !== cacheGeneration) return null;
    if (uri) rememberPath(requestUrl, uri);
    return uri;
  })();
  pendingImages.set(requestUrl, pending);
  try { return await pending; }
  finally { if (pendingImages.get(requestUrl) === pending) pendingImages.delete(requestUrl); }
}

export { isRemoteImageUrl } from './imagePolicy';

export function getDisplayImageUri(cachedUri, originalUrl) {
  return cachedUri || (isLocalImageUri(originalUrl) || isRemoteImageUrl(originalUrl) ? originalUrl : null);
}

export function useRemoteImage(url, version, cacheScope) {
  const [generation, setGeneration] = useState(cacheGeneration);
  const local = isLocalImageUri(url);
  const requestUrl = getRemoteImageRequestUrl(rewriteProfileImageUrl(url, process.env.EXPO_PUBLIC_PROFILE_CDN_DOMAIN), version);
  const [resolved, setResolved] = useState(() => ({ url: requestUrl, scope: cacheScope, generation, uri: cachedPaths.get(requestUrl) || null }));
  useEffect(() => {
    cacheListeners.add(setGeneration);
    return () => cacheListeners.delete(setGeneration);
  }, []);

  useEffect(() => {
    if (local || !requestUrl || Platform.OS !== 'ios') return undefined;
    let active = true;
    let retryTimer;
    async function resolve(retries = 0) {
      try {
        const uri = await prefetchRemoteImage(requestUrl);
        if (active && uri && generation === cacheGeneration) setResolved({ url: requestUrl, scope: cacheScope, generation, uri });
        if (active && !uri && retries < 2) retryTimer = setTimeout(() => resolve(retries + 1), 1000 * (2 ** retries));
      } catch {
        if (active && retries < 2) retryTimer = setTimeout(() => resolve(retries + 1), 1000 * (2 ** retries));
      }
    }
    void resolve();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [local, requestUrl, cacheScope, generation]);

  if (local) return url;
  if (!requestUrl) return null;
  // Android/web components load this URL through their native image cache.
  // Starting a FileSystem download here used to fetch every image twice.
  if (Platform.OS !== 'ios') return requestUrl;
  return cachedPaths.get(requestUrl) || (resolved.generation === cacheGeneration && (resolved.url === requestUrl
    || (cacheScope && resolved.scope === cacheScope)) ? resolved.uri : null) || null;
}
