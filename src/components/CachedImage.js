import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { clearRemoteImageReferences } from '../utils/useRemoteImage';

const lastLoadedSources = new Map();
let cacheGeneration = 0;
export async function clearPrivateImageCaches() {
  cacheGeneration += 1;
  lastLoadedSources.clear();
  await clearRemoteImageReferences();
  await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
}

// One native cache for avatars, profile cards and bundled place photos.
// Remount only on an actual failure; source identity resets retry state and
// prevents a late failure from the previous recycled row hiding the new photo.
export default function CachedImage(props) {
  const sourceId = JSON.stringify(props.source);
  const identity = props.imageIdentity || props.recyclingKey;
  return <CachedImageSource key={sourceId} {...props} sourceId={sourceId} imageIdentity={identity} />;
}

function CachedImageSource({ sourceId, imageIdentity, onError, onLoad, ...props }) {
  const generation = useRef(cacheGeneration);
  const [attempt, setAttempt] = useState(0);
  const failed = useRef(false);
  const timer = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && failed.current) {
        clearTimeout(timer.current);
        failed.current = false;
        setAttempt((value) => value + 1);
      }
    });
    return () => { mounted.current = false; clearTimeout(timer.current); subscription.remove(); };
  }, []);
  return (
    <Image
      cachePolicy="memory-disk"
      transition={0}
      recyclingKey={sourceId}
      placeholder={imageIdentity ? lastLoadedSources.get(imageIdentity) : undefined}
      {...props}
      key={attempt}
      onLoad={(event) => {
        if (!mounted.current) return;
        failed.current = false; clearTimeout(timer.current);
        if (Constants.expoConfig?.extra?.imageCacheDiagnostics === true) {
          // QA evidence only: never log personal URLs or profile/user identifiers.
          const kind = typeof imageIdentity === 'string' && imageIdentity.startsWith('place:') ? imageIdentity : 'image';
          const cache = ['none', 'disk', 'memory'].includes(event?.cacheType) ? event.cacheType : 'unknown';
          console.info(`[ImageCache] ${kind} cache=${cache}`);
        }
        if (imageIdentity && generation.current === cacheGeneration) {
          lastLoadedSources.delete(imageIdentity); lastLoadedSources.set(imageIdentity, props.source);
          while (lastLoadedSources.size > 300) lastLoadedSources.delete(lastLoadedSources.keys().next().value);
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        if (!mounted.current) return;
        failed.current = true;
        if (attempt < 2) {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setAttempt((value) => value + 1), 600 * (attempt + 1));
        }
        onError?.(event);
      }}
    />
  );
}
