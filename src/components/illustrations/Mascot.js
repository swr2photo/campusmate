import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import FeatureIcon from '../FeatureIcon';

// The CampusMate mascot (see assets/mascot/*.png), drawn with plain Views so
// it scales to any size, themes cleanly and needs no extra native module.
// Poses double as instructions on the face-verification camera, so with
// Reduce Motion each pose holds its key frame instead of looping.

export const MASCOT_COLORS = {
  outline: '#1C1C22',
  blue: '#5AAEFF',
  dark: '#3B3B42',
  blush: '#FF9F7A',
  tuft: '#FFA866',
  cap: '#2E3440',
  raincoat: '#FFD23F',
  umbrella: '#FF7A6B',
  book: '#5B8DEF',
  white: '#FFFFFF',
};

const LOOK = { 'look-left': -1, 'look-right': 1 };
const BOBBING = ['idle', 'wave', 'center', 'think', 'scan', 'pose', 'read'];
const inOut = Easing.inOut(Easing.cubic);

function Mouth({ mood, W, lineWidth }) {
  const color = MASCOT_COLORS.outline;
  if (mood === 'wow') {
    return <View style={{ width: W * 0.09, height: W * 0.11, borderRadius: W * 0.05, backgroundColor: color }} />;
  }
  const d = mood === 'calm' ? W * 0.13 : W * 0.17;
  // Half of an outlined circle: the lower half smiles, the upper half frowns.
  return (
    <View style={{ width: d, height: d / 2, overflow: 'hidden' }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: lineWidth, borderColor: color, marginTop: mood === 'sad' ? 0 : -d / 2 }} />
    </View>
  );
}

function Eye({ W, lineWidth, pupilStyle, lookUp, lookDown }) {
  const white = W * 0.17;
  const pupil = W * 0.1;
  return (
    <View style={{ width: white, height: white, borderRadius: white / 2, backgroundColor: MASCOT_COLORS.white, borderWidth: lineWidth * 0.8, borderColor: MASCOT_COLORS.outline, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ width: pupil, height: pupil, borderRadius: pupil / 2, backgroundColor: MASCOT_COLORS.outline, marginTop: lookUp ? -W * 0.04 : lookDown ? W * 0.04 : 0 }, pupilStyle]}>
        <View style={{ position: 'absolute', top: pupil * 0.16, right: pupil * 0.14, width: pupil * 0.34, height: pupil * 0.34, borderRadius: pupil, backgroundColor: MASCOT_COLORS.white }} />
      </Animated.View>
    </View>
  );
}

/**
 * @param {object} props
 * @param {number} [props.size] body width in dp; the drawing is about 1.6× wide and tall.
 * @param {'blue'|'dark'} [props.variant]
 * @param {'happy'|'calm'|'sad'|'wow'} [props.mood]
 * @param {'idle'|'center'|'wave'|'pose'|'look-left'|'look-right'|'nod'|'blink'|'scan'|'think'|'jump'|'sway'} [props.pose]
 * @param {'heart'|'cap'|'none'} [props.accessory]
 * @param {'none'|'sun'|'rain'|'study'} [props.outfit] weather/time outfit: sunglasses,
 *   raincoat + umbrella, or coffee + book for late-night study.
 */
export default function Mascot({
  size = 120,
  variant = 'blue',
  mood = 'happy',
  pose = 'idle',
  accessory,
  outfit = 'none',
  animate = true,
  accessibilityLabel,
  style,
}) {
  const reduceMotion = useReducedMotion();
  const still = !animate || reduceMotion;
  const W = size;
  const H = W * 1.1;
  const lineWidth = Math.max(2, Math.round(W * 0.035));
  const CW = W * 1.6;
  const CH = W * 1.62;
  const bodyLeft = (CW - W) / 2;
  const bodyTop = W * 0.32;
  const bodyColor = variant === 'dark' ? MASCOT_COLORS.dark : MASCOT_COLORS.blue;
  const rain = outfit === 'rain';
  const extra = rain ? 'none' : accessory ?? (variant === 'blue' ? 'heart' : 'none');
  const raisedArm = pose === 'wave' || pose === 'pose' || rain;
  const waving = pose === 'wave' || pose === 'pose';
  const armBase = rain ? -14 : -34;

  const bob = useSharedValue(0);
  const faceX = useSharedValue(0);
  const faceY = useSharedValue(0);
  const tilt = useSharedValue(0);
  const blink = useSharedValue(1);
  const wave = useSharedValue(0);
  const steam = useSharedValue(0);

  useEffect(() => {
    const values = [bob, faceX, faceY, tilt, blink, wave, steam];
    values.forEach((value) => cancelAnimation(value));
    const look = LOOK[pose] || 0;
    // Key frame for each pose: also the whole drawing under Reduce Motion.
    bob.set(0);
    faceX.set(look * W * 0.11);
    faceY.set(pose === 'nod' ? W * 0.075 : pose === 'read' ? W * 0.03 : 0);
    tilt.set(look * 7 + (pose === 'think' ? 5 : 0) + (pose === 'pose' ? -6 : 0));
    blink.set(pose === 'blink' ? 0.12 : 1);
    wave.set(0);
    steam.set(0.4);
    if (still) return undefined;

    if (outfit === 'study') {
      steam.set(withRepeat(withSequence(withTiming(0, { duration: 1 }), withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) })), -1));
    }
    if (BOBBING.includes(pose)) {
      bob.set(withRepeat(withSequence(
        withTiming(-W * 0.035, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ), -1));
    }
    if (pose === 'jump') {
      bob.set(withRepeat(withSequence(
        withTiming(-W * 0.14, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }),
        withDelay(520, withTiming(0, { duration: 1 })),
      ), -1));
    }
    if (look) {
      // Turn, hold, come back: the same rhythm the camera expects.
      faceX.set(withRepeat(withSequence(
        withTiming(0, { duration: 1 }),
        withTiming(look * W * 0.12, { duration: 520, easing: inOut }),
        withDelay(520, withTiming(0, { duration: 460, easing: inOut })),
        withDelay(380, withTiming(0, { duration: 1 })),
      ), -1));
      tilt.set(withRepeat(withSequence(
        withTiming(0, { duration: 1 }),
        withTiming(look * 7, { duration: 520, easing: inOut }),
        withDelay(520, withTiming(0, { duration: 460, easing: inOut })),
        withDelay(380, withTiming(0, { duration: 1 })),
      ), -1));
    }
    if (pose === 'nod') {
      faceY.set(withRepeat(withSequence(
        withTiming(0, { duration: 1 }),
        withTiming(W * 0.085, { duration: 480, easing: inOut }),
        withDelay(420, withTiming(0, { duration: 420, easing: inOut })),
        withDelay(360, withTiming(0, { duration: 1 })),
      ), -1));
    }
    if (pose === 'scan') {
      faceX.set(withRepeat(withSequence(
        withTiming(-W * 0.08, { duration: 900, easing: inOut }),
        withTiming(W * 0.08, { duration: 1300, easing: inOut }),
        withTiming(0, { duration: 700, easing: inOut }),
      ), -1));
    }
    if (pose === 'sway') {
      tilt.set(withRepeat(withSequence(
        withTiming(-3, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(3, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ), -1, true));
    }
    blink.set(pose === 'blink'
      ? withRepeat(withSequence(
        withTiming(1, { duration: 1 }),
        withDelay(500, withTiming(0.1, { duration: 130 })),
        withTiming(1, { duration: 170 }),
        withDelay(500, withTiming(1, { duration: 1 })),
      ), -1)
      : withRepeat(withSequence(
        withDelay(2700, withTiming(0.1, { duration: 90 })),
        withTiming(1, { duration: 120 }),
      ), -1));
    if (waving) {
      wave.set(withRepeat(withSequence(
        withTiming(-16, { duration: 280, easing: Easing.inOut(Easing.quad) }),
        withTiming(12, { duration: 280, easing: Easing.inOut(Easing.quad) }),
      ), pose === 'wave' ? -1 : 2, true));
    }
    return () => values.forEach((value) => cancelAnimation(value));
  }, [W, blink, bob, faceX, faceY, outfit, pose, steam, still, tilt, wave, waving]);

  const figureStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.get() }, { rotate: `${tilt.get()}deg` }],
  }));
  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: faceX.get() }, { translateY: faceY.get() }],
  }));
  const pupilStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: faceX.get() * 0.3 }, { translateY: faceY.get() * 0.25 }],
  }));
  const eyesStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.get() }] }));
  const armStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${armBase + wave.get()}deg` }] }));
  const steamStyle = useAnimatedStyle(() => ({
    opacity: 1 - steam.get(),
    transform: [{ translateY: -W * 0.14 * steam.get() }, { scaleX: 1 + steam.get() * 0.3 }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.7, 1 + bob.get() / (W * 0.6)) }],
    opacity: Math.max(0.4, 1 + bob.get() / (W * 0.4)),
  }));

  const outline = { borderWidth: lineWidth, borderColor: MASCOT_COLORS.outline };
  const armW = W * 0.2;
  const armH = W * 0.32;
  const footW = W * 0.27;
  const footH = W * 0.15;

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none"
      style={[{ width: CW, height: CH }, style]}
    >
      <Animated.View style={[styles.shadow, { left: CW / 2 - W * 0.46, top: bodyTop + H + W * 0.02, width: W * 0.92, height: W * 0.1, borderRadius: W * 0.05 }, shadowStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: `50% ${((bodyTop + H) / CH) * 100}%` }, figureStyle]}>
        {/* Limbs sit behind the body so its outline overlaps them. */}
        <View style={[styles.part, outline, { backgroundColor: bodyColor, left: CW / 2 - W * 0.3, top: bodyTop + H - W * 0.1, width: footW, height: footH, borderRadius: footH / 2 }]} />
        <View style={[styles.part, outline, { backgroundColor: bodyColor, left: CW / 2 + W * 0.03, top: bodyTop + H - W * 0.1, width: footW, height: footH, borderRadius: footH / 2 }]} />
        <View style={[styles.part, outline, { backgroundColor: bodyColor, left: bodyLeft - armW * 0.45, top: bodyTop + H * 0.46, width: armW, height: armH, borderRadius: armW / 2, transform: [{ rotate: '28deg' }] }]} />
        {raisedArm ? (
          <Animated.View style={[styles.part, outline, { backgroundColor: bodyColor, left: bodyLeft + W - armW * 0.35, top: bodyTop + H * 0.06, width: armW, height: armH, borderRadius: armW / 2, transformOrigin: '50% 100%' }, armStyle]} />
        ) : (
          <View style={[styles.part, outline, { backgroundColor: bodyColor, left: bodyLeft + W - armW * 0.55, top: bodyTop + H * 0.46, width: armW, height: armH, borderRadius: armW / 2, transform: [{ rotate: '-28deg' }] }]} />
        )}

        <View style={[styles.part, outline, {
          backgroundColor: bodyColor,
          left: bodyLeft,
          top: bodyTop,
          width: W,
          height: H,
          borderTopLeftRadius: W / 2,
          borderTopRightRadius: W / 2,
          borderBottomLeftRadius: W * 0.44,
          borderBottomRightRadius: W * 0.44,
        }]}>
          <Animated.View style={[StyleSheet.absoluteFill, faceStyle]}>
            <Animated.View style={[styles.eyes, { top: H * 0.27, left: W * 0.21, right: W * 0.21 }, eyesStyle]}>
              <Eye W={W} lineWidth={lineWidth} pupilStyle={pupilStyle} lookUp={pose === 'think'} lookDown={pose === 'read'} />
              <Eye W={W} lineWidth={lineWidth} pupilStyle={pupilStyle} lookUp={pose === 'think'} lookDown={pose === 'read'} />
            </Animated.View>
            {outfit === 'sun' ? (
              <View style={[styles.part, styles.shades, { top: H * 0.255, left: W * 0.15, right: W * 0.15 }]}>
                <View style={[styles.lens, { width: W * 0.25, height: W * 0.17, borderRadius: W * 0.07 }]}>
                  <View style={[styles.glint, { width: W * 0.06, height: W * 0.025 }]} />
                </View>
                <View style={{ width: W * 0.07, height: lineWidth, backgroundColor: MASCOT_COLORS.outline }} />
                <View style={[styles.lens, { width: W * 0.25, height: W * 0.17, borderRadius: W * 0.07 }]}>
                  <View style={[styles.glint, { width: W * 0.06, height: W * 0.025 }]} />
                </View>
              </View>
            ) : null}
            {mood === 'sad' ? (
              <>
                <View style={[styles.part, { backgroundColor: MASCOT_COLORS.outline, top: H * 0.2, left: W * 0.22, width: W * 0.12, height: lineWidth, borderRadius: lineWidth, transform: [{ rotate: '-16deg' }] }]} />
                <View style={[styles.part, { backgroundColor: MASCOT_COLORS.outline, top: H * 0.2, right: W * 0.22, width: W * 0.12, height: lineWidth, borderRadius: lineWidth, transform: [{ rotate: '16deg' }] }]} />
              </>
            ) : null}
            <View style={[styles.part, styles.blush, { top: H * 0.47, left: W * 0.12, width: W * 0.12, height: W * 0.07, borderRadius: W * 0.035 }]} />
            <View style={[styles.part, styles.blush, { top: H * 0.47, right: W * 0.12, width: W * 0.12, height: W * 0.07, borderRadius: W * 0.035 }]} />
            <View style={[styles.part, { top: H * (mood === 'sad' ? 0.5 : 0.45), left: 0, right: 0, alignItems: 'center' }]}>
              <Mouth mood={mood} W={W} lineWidth={Math.max(1.5, lineWidth * 0.85)} />
            </View>
          </Animated.View>
        </View>

        {rain ? (
          <>
            {/* Raincoat hood over the top of the head. */}
            <View style={[styles.part, outline, { backgroundColor: MASCOT_COLORS.raincoat, left: bodyLeft, top: bodyTop, width: W, height: H * 0.22, borderTopLeftRadius: W / 2, borderTopRightRadius: W / 2, borderBottomLeftRadius: W * 0.08, borderBottomRightRadius: W * 0.08 }]} />
            {/* Umbrella held in the raised hand, leaning over the head. */}
            <View style={[styles.part, { left: CW / 2 + W * 0.42 - W * 0.6, top: bodyTop + H * 0.06 - W * 1.15, width: W * 1.2, height: W * 1.15, alignItems: 'center', transformOrigin: '50% 100%', transform: [{ rotate: '-18deg' }] }]}>
              <View style={{ width: W * 1.2, height: W * 0.6, overflow: 'hidden' }}>
                <View style={[outline, { width: W * 1.2, height: W * 1.2, borderRadius: W * 0.6, backgroundColor: MASCOT_COLORS.umbrella }]} />
              </View>
              <View style={{ width: lineWidth, flex: 1, backgroundColor: MASCOT_COLORS.outline }} />
            </View>
          </>
        ) : null}
        {outfit === 'study' ? (
          <>
            <View style={[styles.part, outline, styles.book, { left: CW / 2 - W * 0.3, top: bodyTop + H * 0.6, width: W * 0.6, height: W * 0.3, borderRadius: W * 0.04 }]}>
              <View style={[styles.page, { borderRightWidth: lineWidth * 0.6, borderColor: MASCOT_COLORS.outline }]} />
              <View style={styles.page} />
            </View>
            <View style={[styles.part, { left: bodyLeft + W - W * 0.06, top: bodyTop + H * 0.46, alignItems: 'center' }]}>
              <Animated.View style={[styles.steamRow, { gap: W * 0.04, marginBottom: W * 0.02 }, steamStyle]}>
                <View style={[styles.steam, { width: lineWidth, height: W * 0.1 }]} />
                <View style={[styles.steam, { width: lineWidth, height: W * 0.14 }]} />
              </Animated.View>
              <View style={[outline, { width: W * 0.22, height: W * 0.24, borderBottomLeftRadius: W * 0.06, borderBottomRightRadius: W * 0.06, borderTopLeftRadius: W * 0.02, borderTopRightRadius: W * 0.02, backgroundColor: MASCOT_COLORS.white }]}>
                <View style={{ marginTop: W * 0.06, height: W * 0.06, backgroundColor: MASCOT_COLORS.tuft }} />
              </View>
            </View>
          </>
        ) : null}
        {extra === 'heart' ? (
          <View style={[styles.part, { left: bodyLeft + W * 0.6, top: bodyTop - W * 0.2, transform: [{ rotate: '18deg' }] }]}>
            <FeatureIcon name="heart.fill" size={Math.round(W * 0.34)} color={MASCOT_COLORS.tuft} />
          </View>
        ) : null}
        {extra === 'cap' ? (
          <>
            <View style={[styles.part, outline, { backgroundColor: MASCOT_COLORS.cap, left: CW / 2 - W * 0.23, top: bodyTop - W * 0.02, width: W * 0.46, height: W * 0.15, borderBottomLeftRadius: W * 0.08, borderBottomRightRadius: W * 0.08 }]} />
            <View style={[styles.part, outline, { backgroundColor: MASCOT_COLORS.cap, left: CW / 2 - W * 0.4, top: bodyTop - W * 0.1, width: W * 0.8, height: W * 0.13, borderRadius: W * 0.03, transform: [{ rotate: '-5deg' }] }]} />
            <View style={[styles.part, { backgroundColor: MASCOT_COLORS.tuft, left: CW / 2 + W * 0.3, top: bodyTop - W * 0.06, width: lineWidth, height: W * 0.22, borderRadius: lineWidth }]} />
            <View style={[styles.part, outline, { backgroundColor: MASCOT_COLORS.tuft, left: CW / 2 + W * 0.3 - W * 0.045 + lineWidth / 2, top: bodyTop + W * 0.14, width: W * 0.09, height: W * 0.09, borderRadius: W * 0.045 }]} />
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  part: { position: 'absolute' },
  shadow: { position: 'absolute', backgroundColor: 'rgba(15,20,30,0.12)' },
  eyes: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  blush: { backgroundColor: MASCOT_COLORS.blush, opacity: 0.9 },
  shades: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  lens: { backgroundColor: MASCOT_COLORS.outline, overflow: 'hidden' },
  glint: { position: 'absolute', top: '22%', left: '18%', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '-20deg' }] },
  book: { flexDirection: 'row', overflow: 'hidden', backgroundColor: MASCOT_COLORS.book, padding: 2 },
  page: { flex: 1, backgroundColor: MASCOT_COLORS.white },
  steamRow: { flexDirection: 'row', alignItems: 'flex-end' },
  steam: { borderRadius: 4, backgroundColor: 'rgba(160,170,190,0.85)' },
});
