import { useColorScheme } from 'react-native';

export const lightColors = {
  ink: '#10203A',
  inkMuted: '#60708A',
  inkSoft: '#8B98AC',
  canvas: '#F6F8FC',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#F6F8FC',
  glass: 'rgba(255,255,255,0.88)',
  glassBorder: 'rgba(255,255,255,0.96)',
  line: '#E7EBF2',
  primary: '#5B5CE2',
  primaryDark: '#4546B8',
  primarySoft: '#EEF0FF',
  coral: '#F47C6B',
  coralSoft: '#FFF0ED',
  violet: '#9A8CFF',
  violetSoft: '#EEF0FF',
  green: '#18A878',
  greenSoft: '#E8F8F1',
  mint: '#18A878',
  mintSoft: '#E8F8F1',
  blue: '#3986E8',
  blueSoft: '#EAF3FF',
  amber: '#D8901B',
  amberSoft: '#FFF6DF',
  danger: '#D65454',
  dangerSoft: '#FFF0F0',
};

export const darkColors = {
  ink: '#F7F8FA',
  inkMuted: '#B6BDC8',
  inkSoft: '#7F8896',
  canvas: '#14171B',
  card: '#20242A',
  surface: '#20242A',
  surfaceRaised: '#292E35',
  glass: 'rgba(32,36,42,0.88)',
  glassBorder: 'rgba(255,255,255,0.1)',
  line: '#292E35',
  primary: '#9A8CFF',
  primaryDark: '#7966FF',
  primarySoft: 'rgba(154,140,255,0.16)',
  coral: '#FF7A6B',
  coralSoft: 'rgba(255,122,107,0.16)',
  violet: '#9A8CFF',
  violetSoft: 'rgba(154,140,255,0.16)',
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

export const useTheme = () => {
  const scheme = useColorScheme();
  return {
    colors: scheme === 'dark' ? darkColors : lightColors,
    isDark: scheme === 'dark'
  };
};

export const colors = lightColors;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 36 };
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const shadow = { card: { shadowColor: '#1D2942', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3 } };
export const type = {
  display: 28,
  title: 22,
  title1: 28,
  title2: 22,
  h1: 28,
  h2: 22,
  h3: 17,
  section: 17,
  headline: 16,
  body: 14,
  bodySmall: 13,
  subheadline: 14,
  caption: 12,
  caption2: 11,
  micro: 11,
};
