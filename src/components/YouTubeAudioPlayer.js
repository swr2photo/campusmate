import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const DEFAULT_PLACEHOLDER_VIDEO_ID = 'M7lc1UVf-VE';

function buildPlayerHtml(videoId = '', initialSeconds = 0) {
  const isPlaceholder = !videoId;
  const targetId = videoId || DEFAULT_PLACEHOLDER_VIDEO_ID;
  const startSec = Math.floor(initialSeconds || 0);
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
    #player { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    var player = null;
    var timer = null;
    var isReady = false;
    var pendingCommands = [];
    var isCurrentPlaceholder = ${isPlaceholder ? 'true' : 'false'};

    function post(type, data) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type }, data || {})));
      }
    }

    function exec(cmd) {
      if (!player) return;
      try {
        if (cmd.action === 'play') {
          if (typeof player.playVideo === 'function') player.playVideo();
        } else if (cmd.action === 'pause') {
          if (typeof player.pauseVideo === 'function') player.pauseVideo();
        } else if (cmd.action === 'seek') {
          if (typeof player.seekTo === 'function') player.seekTo(Number(cmd.seconds) || 0, true);
        } else if (cmd.action === 'load') {
          isCurrentPlaceholder = false;
          if (typeof player.loadVideoById === 'function') {
            player.loadVideoById({
              videoId: cmd.videoId,
              startSeconds: Number(cmd.startSeconds) || 0
            });
          }
        }
      } catch (err) {
        post('EXEC_ERROR', { error: err.message });
      }
    }

    function onYouTubeIframeAPIReady() {
      try {
        player = new YT.Player('player', {
          height: '100%',
          width: '100%',
          videoId: '${targetId}',
          playerVars: {
            enablejsapi: 1,
            autoplay: 0,
            playsinline: 1,
            controls: 0,
            origin: 'https://getcampusmate.app',
            widget_referrer: 'https://getcampusmate.app',
            start: ${startSec}
          },
          events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange,
            onError: onPlayerError
          }
        });
      } catch (e) {
        post('INIT_ERROR', { error: e.message });
      }
    }

    function onPlayerReady(event) {
      isReady = true;
      var dur = (player && player.getDuration) ? player.getDuration() : 0;
      if (!isCurrentPlaceholder) {
        post('READY', { duration: dur });
      }
      while (pendingCommands.length > 0) {
        var cmd = pendingCommands.shift();
        exec(cmd);
      }
    }

    function onPlayerStateChange(event) {
      if (isCurrentPlaceholder) return;
      var stateMap = {
        '-1': 'UNSTARTED',
        '0': 'ENDED',
        '1': 'PLAYING',
        '2': 'PAUSED',
        '3': 'BUFFERING',
        '5': 'CUED'
      };
      var state = stateMap[event.data] || 'UNKNOWN';
      var dur = (player && player.getDuration) ? player.getDuration() : 0;
      var cur = (player && player.getCurrentTime) ? player.getCurrentTime() : 0;
      post('STATE_CHANGE', { state: state, currentTime: cur, duration: dur });

      if (event.data === 1) { // PLAYING
        startTracking();
      } else {
        stopTracking();
      }
    }

    function onPlayerError(event) {
      if (isCurrentPlaceholder) return;
      post('ERROR', { code: event.data });
    }

    function startTracking() {
      stopTracking();
      timer = setInterval(function() {
        if (player && player.getCurrentTime) {
          post('TIME_UPDATE', {
            currentTime: player.getCurrentTime(),
            duration: player.getDuration() || 0
          });
        }
      }, 100);
    }

    function stopTracking() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    window.execCommand = function(cmd) {
      if (!isReady || !player) {
        pendingCommands.push(cmd);
        return;
      }
      exec(cmd);
    };

    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  </script>
</body>
</html>`;
}

const YouTubeAudioPlayer = forwardRef(function YouTubeAudioPlayer({
  candidates = [],
  initialSeconds = 0,
  onError,
  onReady,
  onStateChange,
  onTimeUpdate,
  videoId,
}, ref) {
  const webViewRef = useRef(null);
  const isReadyRef = useRef(false);
  const currentVideoIdRef = useRef(videoId);
  const candidateIndexRef = useRef(0);

  // Compute HTML once on initial mount so WebView doesn't tear down and reload on video switch!
  const initialHtml = useMemo(
    () => buildPlayerHtml(videoId || (candidates?.[0] || ''), initialSeconds),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sendCommand = useCallback((cmd) => {
    if (!webViewRef.current) return;
    const js = `window.execCommand && window.execCommand(${JSON.stringify(cmd)}); true;`;
    webViewRef.current.injectJavaScript(js);
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => sendCommand({ action: 'play' }),
    pause: () => sendCommand({ action: 'pause' }),
    seekTo: (seconds) => sendCommand({ action: 'seek', seconds }),
    loadVideo: (newVideoId, startSeconds = 0) => {
      currentVideoIdRef.current = newVideoId;
      sendCommand({ action: 'load', videoId: newVideoId, startSeconds });
    },
  }), [sendCommand]);

  // When videoId or candidates change after mount, load via player.loadVideoById without rebuilding WebView
  useEffect(() => {
    const targetId = videoId || (Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null);
    if (!targetId || targetId === currentVideoIdRef.current) return;
    currentVideoIdRef.current = targetId;
    candidateIndexRef.current = 0;
    sendCommand({ action: 'load', videoId: targetId, startSeconds: initialSeconds });
  }, [candidates, initialSeconds, sendCommand, videoId]);

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event?.nativeEvent?.data);
      if (!data?.type) return;

      if (data.type === 'READY') {
        isReadyRef.current = true;
        onReady?.(data);
      } else if (data.type === 'TIME_UPDATE') {
        onTimeUpdate?.({
          currentTime: Number(data.currentTime) || 0,
          duration: Number(data.duration) || 0,
        });
      } else if (data.type === 'STATE_CHANGE') {
        onStateChange?.(data.state, {
          currentTime: Number(data.currentTime) || 0,
          duration: Number(data.duration) || 0,
        });
      } else if (data.type === 'ERROR') {
        // Error 101 or 150: video owner disabled embedding. Try next candidate if available.
        if (Array.isArray(candidates) && candidateIndexRef.current + 1 < candidates.length) {
          candidateIndexRef.current += 1;
          const nextCandidate = candidates[candidateIndexRef.current];
          currentVideoIdRef.current = nextCandidate;
          sendCommand({ action: 'load', videoId: nextCandidate, startSeconds: initialSeconds });
        } else {
          onError?.(data.code);
        }
      }
    } catch (_) {}
  }, [candidates, initialSeconds, onError, onReady, onStateChange, onTimeUpdate, sendCommand]);

  return (
    <View pointerEvents="none" style={styles.container}>
      <WebView
        ref={webViewRef}
        allowsInlineMediaPlayback
        domStorageEnabled
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
        originWhitelist={['*']}
        scrollEnabled={false}
        source={{
          html: initialHtml,
          baseUrl: 'https://getcampusmate.app',
        }}
        style={styles.webView}
        userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
      />
    </View>
  );
});

export default React.memo(YouTubeAudioPlayer);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: -50,
    left: -50,
    width: 24,
    height: 24,
    opacity: 0.01,
  },
  webView: {
    width: 24,
    height: 24,
    backgroundColor: '#000000',
  },
});
