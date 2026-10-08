/**
 * spotifyAuthService.js
 * ─────────────────────
 * Handles Spotify OAuth PKCE flow for user authentication.
 * After login, checks if the user has a Premium subscription.
 * Stores tokens in SecureStore for persistence.
 */
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';

// ── Spotify App Credentials ──────────────────────────────────────
// Register your app at https://developer.spotify.com/dashboard
// Set redirect URI to: campusmate://spotify-callback
const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || 'f01e2ee8fca44ce5a87bcf2a71c8d039';
const REDIRECT_URI = 'campusmate://spotify-callback';
const SCOPES = [
  'streaming',                // Required for Web Playback SDK
  'user-read-email',          // To identify the user
  'user-read-private',        // To check Premium status
  'user-modify-playback-state', // To control playback
  'user-read-playback-state',   // To read playback state
  'user-read-currently-playing', // To see current playing song
  'user-top-read',             // To get top artists & tracks for taste match
].join(' ');

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const ME_URL = 'https://api.spotify.com/v1/me';

const STORE_KEY_ACCESS = 'spotify_access_token';
const STORE_KEY_REFRESH = 'spotify_refresh_token';
const STORE_KEY_EXPIRES = 'spotify_token_expires';
const STORE_KEY_PREMIUM = 'spotify_is_premium';
const STORE_KEY_USER = 'spotify_user_display';

// ── PKCE Helpers ─────────────────────────────────────────────────
function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

import * as Crypto from 'expo-crypto';

async function generateCodeChallenge(codeVerifier) {
  const base64Hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return base64Hash
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Token Storage ────────────────────────────────────────────────
async function saveTokens(accessToken, refreshToken, expiresIn) {
  const expiresAt = String(Date.now() + (expiresIn * 1000));
  await Promise.all([
    SecureStore.setItemAsync(STORE_KEY_ACCESS, accessToken),
    refreshToken ? SecureStore.setItemAsync(STORE_KEY_REFRESH, refreshToken) : Promise.resolve(),
    SecureStore.setItemAsync(STORE_KEY_EXPIRES, expiresAt),
  ]);
}

async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(STORE_KEY_ACCESS).catch(() => {}),
    SecureStore.deleteItemAsync(STORE_KEY_REFRESH).catch(() => {}),
    SecureStore.deleteItemAsync(STORE_KEY_EXPIRES).catch(() => {}),
    SecureStore.deleteItemAsync(STORE_KEY_PREMIUM).catch(() => {}),
    SecureStore.deleteItemAsync(STORE_KEY_USER).catch(() => {}),
  ]);
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Check if user is currently authenticated with Spotify.
 * Returns { connected, isPremium, displayName, accessToken } or { connected: false }.
 */
export async function getSpotifyConnectionStatus() {
  try {
    const accessToken = await SecureStore.getItemAsync(STORE_KEY_ACCESS);
    const expiresAt = await SecureStore.getItemAsync(STORE_KEY_EXPIRES);
    const isPremium = await SecureStore.getItemAsync(STORE_KEY_PREMIUM);
    const displayName = await SecureStore.getItemAsync(STORE_KEY_USER);

    if (!accessToken) return { connected: false };

    const expired = expiresAt && Date.now() > Number(expiresAt);
    if (expired) {
      // Try refresh
      const refreshToken = await SecureStore.getItemAsync(STORE_KEY_REFRESH);
      if (refreshToken) {
        try {
          const newToken = await refreshAccessToken(refreshToken);
          if (newToken) {
            return {
              connected: true,
              isPremium: isPremium === 'true',
              displayName: displayName || 'Spotify User',
              accessToken: newToken,
            };
          }
        } catch (_) {}
      }
      await clearTokens();
      return { connected: false };
    }

    return {
      connected: true,
      isPremium: isPremium === 'true',
      displayName: displayName || 'Spotify User',
      accessToken,
    };
  } catch (_) {
    return { connected: false };
  }
}

/**
 * Get a valid access token (refreshing if needed).
 */
export async function getValidAccessToken() {
  const status = await getSpotifyConnectionStatus();
  return status.connected ? status.accessToken : null;
}

/**
 * Start Spotify OAuth login flow.
 * Opens a browser for the user to log in.
 * Returns { success, isPremium, displayName } on success.
 */
export async function loginWithSpotify() {
  try {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);

    const authUrl = `${AUTH_URL}?` + [
      `client_id=${SPOTIFY_CLIENT_ID}`,
      `response_type=code`,
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      `scope=${encodeURIComponent(SCOPES)}`,
      `state=${state}`,
      `code_challenge_method=S256`,
      `code_challenge=${codeChallenge}`,
    ].join('&');

    const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

    if (result.type !== 'success' || !result.url) {
      return { success: false, error: 'ผู้ใช้ยกเลิกการเข้าสู่ระบบ' };
    }

    // Extract code from redirect URL
    const url = new URL(result.url);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return { success: false, error: `Spotify error: ${error}` };
    }

    if (!code || returnedState !== state) {
      return { success: false, error: 'การยืนยันตัวตนล้มเหลว' };
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: [
        `grant_type=authorization_code`,
        `code=${code}`,
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        `client_id=${SPOTIFY_CLIENT_ID}`,
        `code_verifier=${codeVerifier}`,
      ].join('&'),
    });

    if (!tokenResponse.ok) {
      return { success: false, error: 'แลกเปลี่ยนโทเค็นล้มเหลว' };
    }

    const tokenData = await tokenResponse.json();
    await saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);

    // Check premium status
    const meResponse = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let isPremium = false;
    let displayName = 'Spotify User';

    if (meResponse.ok) {
      const meData = await meResponse.json();
      const product = meData.product || 'free';
      isPremium = product !== 'free' && product !== 'open';
      displayName = meData.display_name || meData.email || 'Spotify User';
      await SecureStore.setItemAsync(STORE_KEY_PREMIUM, String(isPremium));
      await SecureStore.setItemAsync(STORE_KEY_USER, displayName);
    }

    return { success: true, isPremium, displayName };
  } catch (err) {
    return { success: false, error: String(err?.message || 'เกิดข้อผิดพลาด') };
  }
}

/**
 * Refresh an expired access token.
 */
async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: [
      `grant_type=refresh_token`,
      `refresh_token=${refreshToken}`,
      `client_id=${SPOTIFY_CLIENT_ID}`,
    ].join('&'),
  });

  if (!response.ok) return null;

  const data = await response.json();
  await saveTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in || 3600);
  return data.access_token;
}

/**
 * Disconnect Spotify account.
 */
export async function disconnectSpotify() {
  await clearTokens();
}

/**
 * Play a track on the Web Playback SDK device.
 * @param {string} accessToken
 * @param {string} deviceId - from the Web Playback SDK
 * @param {string} spotifyUri - e.g. 'spotify:track:xxxxx'
 * @param {number} positionMs - start position in ms
 */
export async function playTrackOnDevice(accessToken, deviceId, spotifyUri, positionMs = 0) {
  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uris: [spotifyUri],
      position_ms: positionMs,
    }),
  });

  return response.ok;
}

/**
 * Pause playback on the device.
 */
export async function pausePlayback(accessToken, deviceId) {
  await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

/**
 * Seek to position on the device.
 */
export async function seekPlayback(accessToken, deviceId, positionMs) {
  await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}&device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

export async function fetchSpotifyTopTracks(accessToken, limit = 20) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=${limit}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.items || []).map((t) => {
      if (!t) return null;
      return {
        id: t.id,
        title: t.name,
        artist: (t.artists || []).map((a) => a.name).join(', '),
        coverUrl: t.album?.images?.[0]?.url || '',
        durationMs: t.duration_ms || 0,
        previewUrl: t.preview_url || '',
        source: 'spotify',
      };
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Fetch user's top artists from Spotify.
 */
export async function fetchSpotifyTopArtists(accessToken, limit = 5) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me/top/artists?time_range=medium_term&limit=${limit}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.items || []).map((a) => {
      if (!a) return null;
      return {
        id: a.id,
        name: a.name,
        genres: a.genres || [],
        imageUrl: a.images?.[0]?.url || '',
      };
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Fetch the user's currently playing track on Spotify.
 */
export async function fetchSpotifyCurrentlyPlaying(accessToken) {
  if (!accessToken) return { isPlaying: false, track: null };
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204 || !response.ok) {
      return { isPlaying: false, track: null };
    }
    const data = await response.json();
    if (!data?.item) {
      return { isPlaying: false, track: null };
    }
    return {
      isPlaying: Boolean(data.is_playing),
      progressMs: data.progress_ms || 0,
      track: {
        id: data.item.id,
        name: data.item.name,
        artists: (data.item.artists || []).map((a) => a.name).join(', '),
        albumArt: data.item.album?.images?.[0]?.url || '',
        uri: data.item.uri,
        durationMs: data.item.duration_ms || 0,
        externalUrl: data.item.external_urls?.spotify || `https://open.spotify.com/track/${data.item.id}`,
      },
    };
  } catch (err) {
    return { isPlaying: false, track: null };
  }
}

/**
 * Play a track on user's active Spotify device.
 */
export async function playSpotifyTrack(accessToken, trackUriOrId, positionMs = 0) {
  if (!accessToken) return { success: false, error: 'No access token' };
  const uri = String(trackUriOrId || '').startsWith('spotify:track:')
    ? trackUriOrId
    : `spotify:track:${trackUriOrId}`;
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uris: [uri],
        position_ms: Math.max(0, Math.round(positionMs)),
      }),
    });
    if (response.ok) {
      return { success: true };
    }
    const errorData = await response.json().catch(() => null);
    const reason = errorData?.error?.reason;
    if (response.status === 404 || reason === 'NO_ACTIVE_DEVICE') {
      return { success: false, noActiveDevice: true };
    }
    return { success: false, error: errorData?.error?.message || 'Playback failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Open a track in the native Spotify app or Spotify web player.
 */
export async function openInSpotify(trackOrId) {
  const id = typeof trackOrId === 'string'
    ? trackOrId.replace('spotify:track:', '')
    : (trackOrId?.id || '');
  if (!id) return;
  const nativeUri = `spotify:track:${id}`;
  const webUrl = (typeof trackOrId === 'object' && trackOrId?.externalUrl)
    ? trackOrId.externalUrl
    : `https://open.spotify.com/track/${id}`;
  try {
    const canOpen = await Linking.canOpenURL(nativeUri);
    if (canOpen) {
      await Linking.openURL(nativeUri);
      return;
    }
  } catch (_) {}
  Linking.openURL(webUrl).catch(() => {});
}

/**
 * Calculate music taste match percentage between two profiles.
 * Compares favorite tracks, top artists, and top genres.
 * Returns { score: number, commonArtists: string[], commonGenres: string[], commonTracks: object[], hasMatch: boolean }
 */
export function calculateMusicTasteMatch(myProfile = {}, peerProfile = {}) {
  const myTracks = Array.isArray(myProfile?.favoriteTracks) ? myProfile.favoriteTracks : [];
  const peerTracks = Array.isArray(peerProfile?.favoriteTracks) ? peerProfile.favoriteTracks : [];

  const myArtistsList = [
    ...(Array.isArray(myProfile?.spotifyTopArtists) ? myProfile.spotifyTopArtists.map((a) => a?.name) : []),
    ...myTracks.flatMap((t) => String(t?.artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i).map((s) => s.trim())),
  ].filter(Boolean);

  const peerArtistsList = [
    ...(Array.isArray(peerProfile?.spotifyTopArtists) ? peerProfile.spotifyTopArtists.map((a) => a?.name) : []),
    ...peerTracks.flatMap((t) => String(t?.artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i).map((s) => s.trim())),
  ].filter(Boolean);

  const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').trim();

  const peerArtistNormMap = new Map();
  peerArtistsList.forEach((name) => {
    const k = normalize(name);
    if (k) peerArtistNormMap.set(k, name);
  });

  const commonArtistsSet = new Set();
  myArtistsList.forEach((name) => {
    const k = normalize(name);
    if (k && peerArtistNormMap.has(k)) {
      commonArtistsSet.add(peerArtistNormMap.get(k));
    }
  });

  // Common Tracks
  const myTrackIds = new Set(myTracks.map((t) => t?.id).filter(Boolean));
  const commonTracks = peerTracks.filter((t) => t?.id && myTrackIds.has(t.id));

  // Common Genres
  const myGenres = new Set(
    (Array.isArray(myProfile?.spotifyTopArtists) ? myProfile.spotifyTopArtists.flatMap((a) => a?.genres || []) : [])
      .concat(Array.isArray(myProfile?.spotifyTopGenres) ? myProfile.spotifyTopGenres : [])
      .map(normalize)
      .filter(Boolean)
  );

  const peerGenresList = (Array.isArray(peerProfile?.spotifyTopArtists) ? peerProfile.spotifyTopArtists.flatMap((a) => a?.genres || []) : [])
    .concat(Array.isArray(peerProfile?.spotifyTopGenres) ? peerProfile.spotifyTopGenres : []);

  const commonGenresSet = new Set();
  peerGenresList.forEach((g) => {
    const norm = normalize(g);
    if (norm && myGenres.has(norm)) {
      commonGenresSet.add(g);
    }
  });

  const commonArtists = Array.from(commonArtistsSet);
  const commonGenres = Array.from(commonGenresSet);

  // Calculate score (50% to 99%)
  let score = 50;
  score += commonTracks.length * 15;
  score += commonArtists.length * 12;
  score += commonGenres.length * 6;

  // Realistic baseline if both have tracks but no direct intersection
  if (commonTracks.length === 0 && commonArtists.length === 0 && (myTracks.length > 0 && peerTracks.length > 0)) {
    score = Math.max(54, 62 + ((myTracks.length + peerTracks.length) % 9));
  }

  score = Math.max(40, Math.min(99, score));

  return {
    score,
    commonArtists,
    commonGenres,
    commonTracks,
    hasMatch: commonArtists.length > 0 || commonTracks.length > 0 || commonGenres.length > 0,
  };
}

