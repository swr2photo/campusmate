/**
 * SpotifyPremiumPlayer.js
 * ───────────────────────
 * Hidden WebView that loads the Spotify Web Playback SDK.
 * Acts as a "virtual speaker" device that Spotify can stream to.
 * Only works for Spotify Premium users.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const SpotifyPremiumPlayer = forwardRef(function SpotifyPremiumPlayer(
  { accessToken, onReady, onStateChange, onError, onTimeUpdate },
  ref,
) {
  const webViewRef = useRef(null);
  const [deviceId, setDeviceId] = useState(null);
  const readyRef = useRef(false);

  // Build the HTML that loads the Spotify Web Playback SDK
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://sdk.scdn.co/spotify-player.js"></script>
</head>
<body style="margin:0;padding:0;background:#000;">
<script>
  let player = null;
  let currentPosition = 0;
  let currentDuration = 0;
  let isPlaying = false;
  let positionInterval = null;

  function post(type, data) {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...data }));
  }

  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new Spotify.Player({
      name: 'CampusMate Player',
      getOAuthToken: cb => { cb('${accessToken}'); },
      volume: 1.0,
    });

    player.addListener('ready', ({ device_id }) => {
      post('ready', { deviceId: device_id });
    });

    player.addListener('not_ready', ({ device_id }) => {
      post('not_ready', { deviceId: device_id });
    });

    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      
      const track = state.track_window?.current_track;
      currentPosition = state.position || 0;
      currentDuration = state.duration || 0;
      isPlaying = !state.paused;

      post('state_changed', {
        paused: state.paused,
        position: currentPosition,
        duration: currentDuration,
        trackName: track?.name || '',
        trackUri: track?.uri || '',
      });
    });

    player.addListener('initialization_error', ({ message }) => {
      post('error', { code: 'init', message });
    });

    player.addListener('authentication_error', ({ message }) => {
      post('error', { code: 'auth', message });
    });

    player.addListener('account_error', ({ message }) => {
      post('error', { code: 'account', message: message || 'Spotify Premium required' });
    });

    player.addListener('playback_error', ({ message }) => {
      post('error', { code: 'playback', message });
    });

    player.connect();

    // Position polling
    positionInterval = setInterval(() => {
      if (player && isPlaying) {
        player.getCurrentState().then(state => {
          if (state) {
            currentPosition = state.position;
            currentDuration = state.duration;
            post('time_update', { 
              position: currentPosition, 
              duration: currentDuration,
              paused: state.paused,
            });
          }
        });
      }
    }, 200);
  };

  // Commands from React Native
  window.executeCommand = (cmd, args) => {
    if (!player) return;
    switch (cmd) {
      case 'resume':
        player.resume();
        break;
      case 'pause':
        player.pause();
        break;
      case 'seek':
        player.seek(args.position || 0);
        break;
      case 'setVolume':
        player.setVolume(args.volume || 1.0);
        break;
      case 'disconnect':
        if (positionInterval) clearInterval(positionInterval);
        player.disconnect();
        break;
    }
  };
</script>
</body>
</html>
`;

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'ready':
          readyRef.current = true;
          setDeviceId(data.deviceId);
          onReady?.({ deviceId: data.deviceId });
          break;
        case 'not_ready':
          readyRef.current = false;
          break;
        case 'state_changed':
          onStateChange?.({
            paused: data.paused,
            position: data.position,
            duration: data.duration,
            trackName: data.trackName,
          });
          break;
        case 'time_update':
          onTimeUpdate?.({
            currentTime: data.position / 1000,
            duration: data.duration / 1000,
            paused: data.paused,
          });
          break;
        case 'error':
          onError?.(data.code, data.message);
          break;
      }
    } catch (_) {}
  }, [onReady, onStateChange, onError, onTimeUpdate]);

  const sendCommand = useCallback((cmd, args = {}) => {
    webViewRef.current?.injectJavaScript(
      `window.executeCommand('${cmd}', ${JSON.stringify(args)}); true;`
    );
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => sendCommand('resume'),
    pause: () => sendCommand('pause'),
    seekTo: (seconds) => sendCommand('seek', { position: Math.round(seconds * 1000) }),
    setVolume: (vol) => sendCommand('setVolume', { volume: vol }),
    disconnect: () => sendCommand('disconnect'),
    getDeviceId: () => deviceId,
    isReady: () => readyRef.current,
  }), [deviceId, sendCommand]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sendCommand('disconnect');
    };
  }, [sendCommand]);

  if (!accessToken) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <WebView
        ref={webViewRef}
        allowsInlineMediaPlayback
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    width: 0,
  },
  webview: {
    height: 1,
    width: 1,
  },
});

export default SpotifyPremiumPlayer;
