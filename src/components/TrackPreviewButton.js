import { Pressable } from './NativePressable';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import FeatureIcon from './FeatureIcon';
import { resolvePlayablePreview } from '../services/previewAudioService';
import { ensureAudioPlaybackMode } from '../services/chatMediaService';
import { getPlaybackRange, isReliablePreviewUrl } from '../utils/trackPlayback';

// Claim ownership before any request or seek, including a player still loading.
let stopCurrentPreview = null;

function NativePreview({ track, onStop, onReady, onFail }) {
  const source = useRef({ uri: track.previewUrl });
  const player = useAudioPlayer(source.current, { updateInterval: 100, preferredForwardBufferDuration: 1 });
  const status = useAudioPlayerStatus(player);
  const started = useRef(false);
  const cancelled = useRef(false);
  const heard = useRef(false);
  const failed = useRef(false);
  const fail = useCallback((message) => {
    if (failed.current || cancelled.current) return;
    failed.current = true;
    // Once audio was heard there is nothing to retry silently: say it stopped.
    if (heard.current) onStop('เสียงเพลงขาดหาย แตะเพื่อลองอีกครั้ง');
    else if (onFail) onFail();
    else onStop(message);
  }, [onFail, onStop]);
  useEffect(() => () => { cancelled.current = true; try { player.pause(); } catch {} }, [player]);
  useEffect(() => {
    if (!status?.isLoaded || started.current) return;
    started.current = true;
    const range = getPlaybackRange(track.previewStartMs, track.previewEndMs, status.duration);
    if (!range) { fail('ท่อนเพลงนี้อยู่นอกตัวอย่างเสียง กรุณาเลือกท่อนใหม่'); return; }
    void (async () => {
      try {
        await ensureAudioPlaybackMode();
        if (cancelled.current) return;
        // A fresh file is already at 0; skipping that seek saves a round trip.
        if (range.start > 0) {
          await player.seekTo(range.start);
          if (cancelled.current) return;
        }
        player.play();
      } catch { fail('เล่นเพลงไม่สำเร็จ แตะเพื่อลองอีกครั้ง'); }
    })();
  }, [fail, player, status?.duration, status?.isLoaded, track]);
  useEffect(() => {
    if (status?.error) { fail('โหลดเสียงไม่สำเร็จ แตะเพื่อลองอีกครั้ง'); return; }
    if (status?.didJustFinish) { onStop(); return; }
    if (!status?.playing) return;
    heard.current = true;
    onReady();
    const range = getPlaybackRange(track.previewStartMs, track.previewEndMs, status.duration);
    if (range?.end != null && status.currentTime >= range.end - 0.04) onStop();
  }, [fail, onReady, onStop, status?.currentTime, status?.didJustFinish, status?.duration, status?.error, status?.playing, track]);
  return null;
}

export default function TrackPreviewButton(props) {
  const source = props.track || {};
  const track = {
    ...source,
    name: props.trackName || source.name || '',
    artists: props.trackArtists || source.artists || '',
    previewUrl: props.previewUrl ?? source.previewUrl,
    previewStartMs: props.previewStartMs ?? source.previewStartMs,
    previewEndMs: props.previewEndMs ?? source.previewEndMs,
    youtubeVideoId: props.youtubeVideoId || source.youtubeVideoId,
  };
  // A recycled row must discard its old resolved video and pending requests.
  const identity = JSON.stringify([track.id, track.name, track.artists, track.previewUrl, track.youtubeVideoId, track.previewStartMs, track.previewEndMs]);
  return <PreviewButton key={identity} {...props} track={track} />;
}

function PreviewButton({ backgroundColor = '#2869C7', color = '#FFFFFF', fill = false, size = 48, track, onStatusChange, nativeGestureSurface = false }) {
  // No sound within this window means the file host is stalling; switch source.
  const NATIVE_START_TIMEOUT_MS = 6000;
  const LOADING_TIMEOUT_MS = 15000;
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Apple preview found ahead of time (or by a tap). Never swapped into a clip
  // that is already playing; it is only read when a play starts.
  const [resolvedUri, setResolvedUri] = useState('');
  // The one file chosen for the current play. NativePreview mounts only after
  // this is decided, so a late lookup cannot restart audio with another clip.
  const [playUri, setPlayUri] = useState('');
  const request = useRef(0);
  const mounted = useRef(true);
  const nativeFailures = useRef(0);
  const heard = useRef(false);
  const failNativeRef = useRef(null);
  const resolvedRef = useRef('');
  resolvedRef.current = resolvedUri;
  const playUriRef = useRef('');
  playUriRef.current = playUri;
  const canResolve = typeof resolvePlayablePreview === 'function';
  const spotifyUri = typeof track.previewUrl === 'string' && /^https?:\/\//i.test(track.previewUrl.trim()) ? track.previewUrl.trim() : '';

  const stop = useCallback((message = '') => {
    request.current += 1;
    if (stopCurrentPreview === stop) stopCurrentPreview = null;
    setActive(false); setLoading(false); setError(message); setPlayUri('');
    if (message && !onStatusChange) Alert.alert('เล่นเพลงไม่สำเร็จ', message);
  }, [onStatusChange]);
  const ready = useCallback(() => { heard.current = true; setLoading(false); }, []);

  // Native file failed or stayed silent: try the other source once, then stop
  // right away with a visible error instead of waiting out the loading timer.
  const failNative = useCallback(() => {
    if (!mounted.current || heard.current) return;
    if (nativeFailures.current >= 1) { stop('โหลดเสียงไม่สำเร็จ แตะเพื่อลองอีกครั้ง'); return; }
    nativeFailures.current += 1;
    const token = request.current;
    const failedUri = playUriRef.current;
    setAttempt((value) => value + 1);
    void (async () => {
      let next = resolvedRef.current && resolvedRef.current !== failedUri ? resolvedRef.current : '';
      if (!next && canResolve) {
        try {
          const hit = await resolvePlayablePreview({ ...track, previewUrl: '' });
          if (!mounted.current || request.current !== token) return;
          if (hit?.previewUrl) {
            setResolvedUri(hit.previewUrl);
            if (hit.previewUrl !== failedUri) next = hit.previewUrl;
          }
        } catch {}
      }
      if (!mounted.current || request.current !== token) return;
      if (!next && spotifyUri && spotifyUri !== failedUri) next = spotifyUri;
      if (next) { setPlayUri(next); return; }
      stop('โหลดเสียงไม่สำเร็จ แตะเพื่อลองอีกครั้ง');
    })();
  }, [canResolve, spotifyUri, stop, track]);
  useEffect(() => { onStatusChange?.({ active, loading, error }); }, [active, loading, error, onStatusChange]);

  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') stop(); });
    return () => {
      mounted.current = false; request.current += 1; sub.remove();
      if (stopCurrentPreview === stop) stopCurrentPreview = null;
    };
  }, [stop]);
  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => stop('เชื่อมต่อเพลงใช้เวลานาน แตะเพื่อลองอีกครั้ง'), LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [attempt, loading, stop]);
  failNativeRef.current = failNative;
  useEffect(() => {
    if (!active || !playUri) return undefined;
    const timer = setTimeout(() => failNativeRef.current(), NATIVE_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active, playUri]);
  // Warm the Apple preview while the row is on screen so a tap starts at once.
  useEffect(() => {
    if (isReliablePreviewUrl(track.previewUrl) || !canResolve) return undefined;
    let cancelled = false;
    resolvePlayablePreview({ ...track, previewUrl: '' }, { priority: 'background' })
      .then((hit) => { if (!cancelled && hit?.previewUrl) setResolvedUri(hit.previewUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [track.artists, track.durationMs, track.name, track.previewUrl]);

  const play = async () => {
    if (active) { stop(); return; }
    stopCurrentPreview?.();
    stopCurrentPreview = stop;
    const token = ++request.current;
    nativeFailures.current = 0;
    heard.current = false;
    setError(''); setPlayUri('');
    setLoading(true); setActive(true);
    void ensureAudioPlaybackMode();
    // Prefer Apple's file (one quick request); Spotify's preview host is the
    // fallback because it often answers slowly or refuses the file.
    const immediate = resolvedRef.current || (isReliablePreviewUrl(track.previewUrl) ? track.previewUrl.trim() : '');
    if (immediate) { setPlayUri(immediate); return; }
    let hit = null;
    try {
      hit = canResolve ? await resolvePlayablePreview({ ...track, previewUrl: '' }) : null;
    } catch {}
    if (!mounted.current || request.current !== token) return;
    if (hit?.previewUrl) { setResolvedUri(hit.previewUrl); setPlayUri(hit.previewUrl); return; }
    if (spotifyUri) { setPlayUri(spotifyUri); return; }
    stop('ไม่พบเสียงตัวอย่างของเพลงนี้');
  };

  if (!track.previewUrl && !track.youtubeVideoId && !track.name && !track.externalUrl) return null;
  return <>
    <Pressable
      nativeGestureSurface={nativeGestureSurface}
      accessibilityRole="button"
      accessibilityLabel={error ? `${track.name}: ${error} แตะเพื่อลองอีกครั้ง` : `${active ? (loading ? 'กำลังเชื่อมต่อ แตะเพื่อยกเลิก' : 'หยุดฟังตัวอย่างเพลง') : 'ฟังตัวอย่างเพลง'} ${track.name}`}
      accessibilityState={{ busy: loading }}
      hitSlop={6}
      onPress={event => { event?.stopPropagation?.(); void play(); }}
      style={[styles.button, fill ? styles.fill : { backgroundColor, height: size, width: size, minWidth: size, minHeight: size, maxWidth: size, maxHeight: size }]}
    >
      {loading ? <ActivityIndicator color={color} size="small" /> : <FeatureIcon color={color} name={error ? 'exclamationmark.triangle.fill' : active ? 'stop.fill' : 'play.fill'} size={18} />}
    </Pressable>
    {/* Previews are 30 s excerpts, not the song's opening, so the saved
        passage cannot be located in them: always play the excerpt from 0. */}
    {active && playUri ? <NativePreview key={playUri} track={{ ...track, previewUrl: playUri, previewStartMs: 0, previewEndMs: 0 }} onStop={stop} onReady={ready} onFail={failNative} /> : null}
  </>;
}
const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: 999, flexShrink: 0, justifyContent: 'center' },
  fill: { height: '100%', width: '100%', backgroundColor: 'transparent' },
});
