import { useColorScheme } from 'react-native';

export const lightColors = {
  ink: '#25272B',
  inkMuted: '#6B7078',
  inkSoft: '#8B98AC',
  canvas: '#F7F7F8',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#F0F1F3',
  glass: 'rgba(255,255,255,0.88)',
  glassBorder: 'rgba(255,255,255,0.96)',
  line: '#E4E5E8',
  onPrimary: '#FFFFFF',
  primary: '#2869C7',
  primaryDark: '#2259A6',
  primarySoft: '#EEF2F7',
  coral: '#F47C6B',
  coralSoft: '#FFF0ED',
  violet: '#6B7078',
  violetSoft: '#F0F1F3',
  green: '#18A878',
  greenSoft: '#E8F8F1',
  mint: '#18A878',
  mintSoft: '#E8F8F1',
  blue: '#3986E8',
  blueSoft: '#F0F1F3',
  amber: '#D8901B',
  amberSoft: '#FFF6DF',
  danger: '#D65454',
  dangerSoft: '#FFF0F0',
};

export const darkColors = {
  ink: '#F7F8FA',
  inkMuted: '#B6BDC8',
  inkSoft: '#7F8896',
  canvas: '#16171A',
  card: '#202226',
  surface: '#202226',
  surfaceRaised: '#2B2D32',
  glass: 'rgba(32,36,42,0.88)',
  glassBorder: 'rgba(255,255,255,0.1)',
  line: '#393C43',
  onPrimary: '#FFFFFF',
  primary: '#2C68C2',
  primaryDark: '#3995F1',
  primarySoft: 'rgba(112,178,255,0.18)',
  coral: '#FF7A6B',
  coralSoft: 'rgba(255,122,107,0.16)',
  violet: '#ACB3BE',
  violetSoft: 'rgba(148,196,255,0.16)',
  green: '#45D1A1',
  greenSoft: 'rgba(69,209,161,0.16)',
  mint: '#45D1A1',
  mintSoft: 'rgba(69,209,161,0.16)',
  blue: '#62A8FF',
  blueSoft: 'rgba(98,168,255,0.16)',
  amber: '#FFC859',
  amberSoft: 'rgba(255,200,89,0.16)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255,107,107,0.16)',
};

const darkTheme = { colors: darkColors, isDark: true };
const lightTheme = { colors: lightColors, isDark: false };

export const useTheme = () => {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
};

export const createNavigationTheme = (baseTheme, palette) => ({
  ...baseTheme,
  colors: {
    ...baseTheme.colors,
    background: palette.canvas,
    border: palette.line,
    card: palette.canvas,
    notification: palette.coral,
    primary: palette.primary,
    text: palette.ink,
  },
});

/** Static fallback for module-scope styles. Prefer `useTheme()` in components. */
export const colors = lightColors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 36 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const shadow = {
  card: {
    shadowColor: '#1D2942',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
};
export const type = {
  display: 28,
  title: 22,
  title1: 28,
  title2: 22,
  h1: 28,
  h2: 22,
  h3: 17,
  section: 17,
  headline: 17,
  body: 17,
  bodySmall: 15,
  subheadline: 15,
  caption: 13,
  caption2: 12,
  micro: 12,
  lg: 17,
};

// Compatibility adapter for native SwiftUI screens; values come from the shared theme.
export function useNativePalette() {
  const { colors: c } = useTheme();
  return { ...c, background: c.canvas, text: c.ink, secondary: c.inkMuted, tertiary: c.inkFaint || c.inkMuted,
    purple: c.primary, violet: c.primary, blue: c.primary, accent: c.primary, coralSoft: c.surfaceRaised, violetSoft: c.surfaceRaised, card: c.card,
    white: c.onPrimary, chip: c.surfaceRaised, circle: c.surfaceRaised, surface: c.card };
}
