import { useWindowDimensions } from 'react-native';
import { getSizeClass } from '../theme';

// Phone size classes: Small < 375, Standard 375–412, Large > 412 (dp/pt).
// Component sizes are fixed per class so cards, art and chat media never
// overflow narrow phones or look lost on large ones.
const BY_CLASS = {
  small: {
    factor: 0.88, gutter: 16, hero: 128, compact: 68, display: 24, title: 19, body: 15, caption: 12, cardPadding: 14, cardRadius: 20,
    banner: 76, mascot: 140, chatImageMax: 180, musicCard: 210, inputMinHeight: 42, mapRatio: 0.6,
  },
  standard: {
    factor: 1, gutter: 20, hero: 152, compact: 80, display: 27, title: 21, body: 16, caption: 13, cardPadding: 16, cardRadius: 24,
    banner: 88, mascot: 180, chatImageMax: 210, musicCard: 240, inputMinHeight: 46, mapRatio: 0.65,
  },
  large: {
    factor: 1.08, gutter: 24, hero: 176, compact: 92, display: 29, title: 22, body: 17, caption: 13, cardPadding: 18, cardRadius: 26,
    banner: 96, mascot: 220, chatImageMax: 230, musicCard: 260, inputMinHeight: 48, mapRatio: 0.68,
  },
};

export function getResponsiveTokens(width) {
  return BY_CLASS[getSizeClass(width)];
}

/**
 * Width-class sizing for phones (Small < 375, Standard 375–412, Large > 412).
 * Font sizes are base sizes: Dynamic Type / Android font scale still applies
 * on top, so text never gets clamped to fit. Illustrations shrink instead.
 */
export function useResponsiveSize() {
  const { width, height, fontScale = 1 } = useWindowDimensions();
  const sizeClass = getSizeClass(width);
  const tokens = BY_CLASS[sizeClass];
  // Large text needs the room more than the artwork does.
  const artFactor = fontScale > 1.3 ? 0.8 : 1;
  const shortScreen = height < 700;
  return {
    sizeClass,
    isSmall: sizeClass === 'small',
    isLarge: sizeClass === 'large',
    width,
    height,
    fontScale,
    scale: (value) => Math.round(value * tokens.factor),
    gutter: tokens.gutter,
    illustration: {
      hero: Math.round(tokens.hero * artFactor * (shortScreen ? 0.85 : 1)),
      compact: Math.round(tokens.compact * artFactor),
      mascot: Math.round(tokens.mascot * artFactor),
    },
    font: { display: tokens.display, title: tokens.title, body: tokens.body, caption: tokens.caption },
    card: { padding: tokens.cardPadding, radius: tokens.cardRadius },
    bannerHeight: tokens.banner,
    // Chat media never exceeds these, whatever the source dimensions.
    chat: {
      imageMax: Math.min(tokens.chatImageMax, Math.round(width * 0.55)),
      musicCardWidth: Math.min(tokens.musicCard, Math.round(width * 0.68)),
      inputMinHeight: tokens.inputMinHeight,
    },
    mapHeight: Math.round(height * tokens.mapRatio),
  };
}

export default useResponsiveSize;
