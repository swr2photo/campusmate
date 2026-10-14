import { useEffect, useState } from 'react';
import { getTrackLyrics } from '../services/musicLyricsService';

// Playback ticks and trim handles must not reset an already loaded lyric view.
// Fetch only when song metadata changes or the listener explicitly retries.
export function useTrackLyrics(track, retry = 0) {
  const id = track?.id, name = track?.name, artists = track?.artists;
  const albumName = track?.albumName, durationMs = track?.durationMs;
  const key = JSON.stringify([id, name, artists, albumName, durationMs, retry]);
  const [snapshot, setSnapshot] = useState({ key: null, result: { status: 'loading' } });
  useEffect(() => {
    let active = true;
    setSnapshot({ key, result: { status: 'loading' } });
    getTrackLyrics({ track: { id, name, artists, albumName, durationMs } })
      .then(value => { if (active) setSnapshot({ key, result: value }); })
      .catch(() => { if (active) setSnapshot({ key, result: { status: 'error' } }); });
    return () => { active = false; };
  }, [albumName, artists, durationMs, id, key, name, retry]);
  return snapshot.key === key ? snapshot.result : { status: 'loading' };
}
