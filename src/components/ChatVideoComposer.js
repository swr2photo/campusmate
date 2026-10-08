import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VIDEO_MODES } from '../utils/chatVideoPolicy';
import { scheduleIdleTask } from '../utils/scheduleIdleTask';
import { initialVideoRange, moveVideoHandle, videoTime } from '../utils/videoEdit';
import { showAlert } from '../utils/appAlert';

function moveHandleWorklet(startMs, endMs, handle, value, duration) {
  'worklet';
  const maxDuration = 60000;
  const minimum = Math.min(1000, duration);
  const position = Math.round(Math.max(0, Math.min(duration, value)));
  if (handle === 'start') {
    const nextStart = Math.min(position, endMs - minimum);
    return { startMs: nextStart, endMs: Math.min(endMs, nextStart + maxDuration) };
  }
  const nextEnd = Math.max(position, startMs + minimum);
  return { startMs: Math.max(startMs, nextEnd - maxDuration), endMs: nextEnd };
}

function Handle({ side, startMsSV, endMsSV, durationSV, widthSV, onCommit, disabled, range, duration }) {
  const originStart = useSharedValue(0);
  const originEnd = useSharedValue(0);
  const position = range[side === 'start' ? 'startMs' : 'endMs'];
  const pan = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onStart(() => {
      originStart.set(startMsSV.get());
      originEnd.set(endMsSV.get());
    })
    .onUpdate((event) => {
      const trackWidth = widthSV.get();
      const trackDuration = durationSV.get();
      if (!trackWidth || !trackDuration) return;
      const origin = side === 'start' ? originStart.get() : originEnd.get();
      const value = origin + (event.translationX / trackWidth) * trackDuration;
      const next = moveHandleWorklet(originStart.get(), originEnd.get(), side, value, trackDuration);
      startMsSV.set(next.startMs);
      endMsSV.set(next.endMs);
    })
    .onEnd(() => {
      scheduleOnRN(onCommit, startMsSV.get(), endMsSV.get());
    }), [disabled, durationSV, endMsSV, onCommit, originEnd, originStart, side, startMsSV, widthSV]);
  const handleStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    const ms = side === 'start' ? startMsSV.get() : endMsSV.get();
    return { transform: [{ translateX: (ms / trackDuration) * trackWidth - 14 }] };
  });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={side === 'start' ? 'จุดเริ่มวิดีโอ' : 'จุดจบวิดีโอ'}
        accessibilityValue={{ text: videoTime(position) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (disabled) return;
          const next = moveVideoHandle(
            range,
            side,
            position + (nativeEvent.actionName === 'increment' ? 1000 : -1000),
            duration
          );
          onCommit(next.startMs, next.endMs);
        }}
        style={[styles.handle, handleStyle]}
      >
        <View style={styles.grip} />
      </Animated.View>
    </GestureDetector>
  );
}

export default function ChatVideoComposer({ asset, recipientName, recipientAvatar, onSend, onClose }) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState(() => initialVideoRange(asset.duration));
  const [duration, setDuration] = useState(asset.duration);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState(asset.mode || 'chat');
  const [modesOpen, setModesOpen] = useState(false);
  const [caption, setCaption] = useState(asset.caption || '');
  const [showCaption, setShowCaption] = useState(Boolean(asset.caption));
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [frames, setFrames] = useState([]);
  const [width, setWidth] = useState(0);
  const busy = useRef(false);
  const thumbnailsRequested = useRef(false);
  const selection = useRef(range);
  selection.current = range;
  const startMsSV = useSharedValue(range.startMs);
  const endMsSV = useSharedValue(range.endMs);
  const durationSV = useSharedValue(duration);
  const widthSV = useSharedValue(width);
  const player = useVideoPlayer(asset.uri, p => { p.timeUpdateEventInterval = 0.1; p.staysActiveInBackground = false; });
  useEffect(() => {
    startMsSV.set(range.startMs);
    endMsSV.set(range.endMs);
  }, [endMsSV, range.endMs, range.startMs, startMsSV]);
  useEffect(() => {
    durationSV.set(duration);
  }, [duration, durationSV]);
  useEffect(() => {
    widthSV.set(width);
  }, [width, widthSV]);
  useEffect(() => {
    let active = true;
    let thumbnailTask = null;
    const status = ({ status: value }) => {
      if (!active) return;
      setReady(value === 'readyToPlay');
      if (value !== 'readyToPlay') return;
      const actual = Math.round(player.duration * 1000);
      if (actual > 0) {
        setDuration(actual);
        setRange(old => ({ startMs: Math.min(old.startMs, Math.max(0, actual - 1000)), endMs: Math.min(old.endMs, actual) }));
      }
      if (!thumbnailsRequested.current) {
        thumbnailsRequested.current = true;
        thumbnailTask = scheduleIdleTask(async () => {
          thumbnailTask = null;
          if (!active) return;
          try {
            const thumbs = await player.generateThumbnailsAsync(
              Array.from({ length: 6 }, (_, i) => i * player.duration / 6),
              { maxWidth: 84, maxHeight: 64 },
            );
            if (active) setFrames(thumbs);
          } catch { /* Scrubbing remains available without thumbnails. */ }
        });
      }
    };
    const subs = [player.addListener('statusChange', status),
      player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying)),
      player.addListener('timeUpdate', ({ currentTime }) => {
        setPosition(currentTime * 1000);
        if (currentTime * 1000 >= selection.current.endMs) { player.pause(); player.currentTime = selection.current.startMs / 1000; }
      })];
    const background = AppState.addEventListener('change', value => { if (value !== 'active') player.pause(); });
    status({ status: player.status });
    return () => { active = false; thumbnailTask?.cancel?.(); subs.forEach(sub => sub.remove()); background.remove(); };
  }, [player]);
  const select = useCallback((next) => {
    setRange(next);
    player.pause();
    player.currentTime = next.startMs / 1000;
    setPosition(next.startMs);
  }, [player]);
  const commitRange = useCallback((startMs, endMs) => {
    select({ startMs, endMs });
  }, [select]);
  const startShadeStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    return { width: (startMsSV.get() / trackDuration) * trackWidth };
  });
  const endShadeStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    return { width: ((trackDuration - endMsSV.get()) / trackDuration) * trackWidth };
  });
  const selectionStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    const start = startMsSV.get();
    const end = endMsSV.get();
    return {
      transform: [{ translateX: (start / trackDuration) * trackWidth }],
      width: ((end - start) / trackDuration) * trackWidth,
    };
  });
  const send = () => {
    if (busy.current || !ready) return;
    busy.current = true;
    player.pause();
    const edit = { ...range, muted };
    const payload = {
      ...asset,
      duration,
      caption: caption.trim(),
      upgradeSource: { ...asset, duration },
      videoEdit: edit,
      needsExport: true,
    };
    onClose();
    void Promise.resolve(onSend(payload, mode, caption.trim())).catch((error) => {
      showAlert('ส่งวิดีโอไม่สำเร็จ', error.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    });
  };
  const icon = (name, label, action, disabled = sending, color = '#fff') => <Pressable style={styles.button} accessibilityLabel={label} disabled={disabled} onPress={action}><Ionicons name={name} size={25} color={color} /></Pressable>;
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (!busy.current) onClose(); }}>
    <GestureHandlerRootView style={styles.screen}>
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(12, insets.bottom) }]}>
      <View style={styles.header}>{icon('close', 'ปิดวิดีโอ', onClose)}<Text style={styles.recipient} numberOfLines={1}>ส่งถึง {recipientName || 'เพื่อน'}</Text>
        <Pressable style={styles.button} disabled={sending} accessibilityLabel="เพิ่มคำบรรยาย" onPress={() => setShowCaption(!showCaption)}><Text style={styles.aa}>Aa</Text></Pressable></View>
      <View style={styles.preview}><VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" allowsVideoFrameAnalysis={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />{!ready && <ActivityIndicator color="#fff" />}</View>
      <View style={styles.controls}>
        {icon(playing ? 'pause' : 'play', playing ? 'หยุดชั่วคราว' : 'เล่นช่วงที่เลือก', () => {
          if (playing) player.pause(); else { if (position < range.startMs || position >= range.endMs) player.currentTime = range.startMs / 1000; player.play(); }
        }, !ready || sending)}
        <Text style={styles.time}>{videoTime(position)} / {videoTime(duration)}</Text>
        {icon(muted ? 'volume-mute' : 'volume-high', muted ? 'เปิดเสียงวิดีโอที่ส่ง' : 'ปิดเสียงวิดีโอที่ส่ง', () => { player.muted = !muted; setMuted(!muted); }, sending, muted ? '#fcd34d' : '#fff')}
      </View>
      <View style={styles.timelineArea}><Text style={styles.hint}>{duration > 60000 ? 'วิดีโอยาวเกิน 60 วินาที · ลากขอบเพื่อเลือกช่วง' : 'ลากขอบเพื่อตัด · แตะภาพเพื่อเลื่อนเวลา'}</Text>
        <View style={styles.timeline} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
          <Pressable disabled={!ready || sending} style={styles.frames} accessibilityLabel="เลื่อนไทม์ไลน์วิดีโอ" onPress={event => {
            if (!width) return;
            const target = Math.max(range.startMs, Math.min(range.endMs, event.nativeEvent.locationX / width * duration));
            player.currentTime = target / 1000; setPosition(target);
          }}>{frames.map((frame, index) => <Image key={index} pointerEvents="none" source={frame} style={{ flex: 1, height: 56 }} contentFit="cover" />)}</Pressable>
          <Animated.View pointerEvents="none" style={[styles.shade, styles.shadeStart, startShadeStyle]} />
          <Animated.View pointerEvents="none" style={[styles.shade, styles.shadeEnd, endShadeStyle]} />
          <Animated.View pointerEvents="none" style={[styles.selection, selectionStyle]} />
          <View pointerEvents="none" style={[styles.cursor, { left: `${Math.max(0, Math.min(100, position / duration * 100))}%` }]} />
          <Handle side="start" startMsSV={startMsSV} endMsSV={endMsSV} durationSV={durationSV} widthSV={widthSV} range={range} duration={duration} onCommit={commitRange} disabled={!ready || sending} />
          <Handle side="end" startMsSV={startMsSV} endMsSV={endMsSV} durationSV={durationSV} widthSV={widthSV} range={range} duration={duration} onCommit={commitRange} disabled={!ready || sending} />
        </View>
        <View style={styles.labels}><Text style={styles.hint}>{videoTime(range.startMs)} — {videoTime(range.endMs)}</Text><Text style={styles.hint}>{((range.endMs - range.startMs) / 1000).toFixed(1)} / 60 วินาที{muted ? ' · ไม่มีเสียง' : ''}</Text></View>
      </View>
      {showCaption && <TextInput value={caption} onChangeText={setCaption} editable={!sending} placeholder="เพิ่มคำบรรยาย…" placeholderTextColor="#999" accessibilityLabel="คำบรรยายวิดีโอ" style={styles.caption} />}
      {modesOpen && <View style={styles.modes}>{Object.entries(VIDEO_MODES).map(([value, label]) => <Pressable key={value} disabled={sending} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} style={styles.modeRow} onPress={() => { setMode(value); setModesOpen(false); }}><Text style={styles.white}>{label}</Text><Ionicons name={mode === value ? 'checkmark-circle' : 'ellipse-outline'} size={24} color="#fff" /></Pressable>)}</View>}
      <View style={styles.footer}><Pressable disabled={sending} style={styles.modeButton} onPress={() => setModesOpen(!modesOpen)}><Ionicons name="radio-button-on-outline" size={26} color="#fff" /><Text style={styles.white}>{VIDEO_MODES[mode]}</Text><Ionicons name="chevron-down" size={16} color="#aaa" /></Pressable>
        <Pressable accessibilityLabel="ส่งวิดีโอ" disabled={!ready || sending} onPress={send} style={[styles.send, (!ready || sending) && { opacity: 0.5 }]}>{recipientAvatar && <Image source={{ uri: recipientAvatar }} style={styles.avatar} />}<Text style={styles.sendText}>ส่ง</Text></Pressable></View>
      <Text style={styles.note}>{mode !== 'chat' ? 'ป้องกันแคปหน้าจอ · ' : ''}ส่งฉบับเล็กก่อน แล้วเพิ่มความชัดภายหลัง</Text>
    </View>
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080808' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }, recipient: { flex: 1, color: '#ddd', textAlign: 'center', fontSize: 13 }, button: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#242424', justifyContent: 'center', alignItems: 'center' }, aa: { color: '#fff', fontSize: 24 },
  preview: { flex: 1, minHeight: 100, justifyContent: 'center' }, controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8, gap: 12 }, time: { color: '#fff', flex: 1, fontVariant: ['tabular-nums'] },
  timelineArea: { paddingHorizontal: 28, paddingTop: 8 }, timeline: { height: 56, marginTop: 12, marginBottom: 10, backgroundColor: '#292929' }, frames: { flex: 1, flexDirection: 'row' }, shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#0009' }, shadeStart: { left: 0 }, shadeEnd: { right: 0 }, selection: { position: 'absolute', top: 0, bottom: 0, left: 0, borderTopWidth: 3, borderBottomWidth: 3, borderColor: '#fcd34d' }, cursor: { position: 'absolute', width: 2, top: 0, bottom: 0, backgroundColor: '#fff' }, handle: { position: 'absolute', top: -5, bottom: -5, left: 0, width: 28, alignItems: 'center', justifyContent: 'center' }, grip: { height: 56, width: 12, borderRadius: 4, backgroundColor: '#fcd34d' }, labels: { flexDirection: 'row', justifyContent: 'space-between' }, hint: { color: '#c5c5c5', fontSize: 11 },
  caption: { marginHorizontal: 20, marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: '#222', color: '#fff' }, modes: { backgroundColor: '#222', borderRadius: 18, margin: 16, paddingHorizontal: 16 }, modeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 }, modeButton: { flexDirection: 'row', alignItems: 'center', gap: 8 }, footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 }, send: { backgroundColor: '#fff', borderRadius: 28, paddingHorizontal: 22, height: 52, flexDirection: 'row', alignItems: 'center', gap: 8 }, avatar: { width: 28, height: 28, borderRadius: 14 }, sendText: { color: '#111', fontWeight: '700', fontSize: 17 }, white: { color: '#fff', fontSize: 14 }, note: { color: '#888', fontSize: 11, textAlign: 'center' }, busy: { ...StyleSheet.absoluteFill, backgroundColor: '#000c', alignItems: 'center', justifyContent: 'center', gap: 16 },
});
