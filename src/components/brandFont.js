import { font as nativeFont } from '@expo/ui/swift-ui/modifiers';

function resolveWeight(w) {
  if (Number(w) >= 700 || w === 'bold' || w === 'heavy' || w === 'black') return 'Bold';
  if (Number(w) >= 600 || w === 'semibold') return 'SemiBold';
  if (Number(w) >= 500 || w === 'medium') return 'Medium';
  return 'Regular';
}

const sizes = {
  largeTitle: 28,
  title1: 24,
  title: 24,
  title2: 22,
  title3: 19,
  headline: 17,
  subheadline: 15,
  body: 15,
  callout: 15,
  footnote: 13,
  caption: 12,
  caption1: 12,
  caption2: 11,
};

// Custom families retain SwiftUI's textStyle scaling rather than fixing Dynamic Type.
export function font(options = {}) {
  const { weight, design, ...rest } = options;
  const familyName = options.family || `NotoSansThai-${resolveWeight(weight)}`;
  return nativeFont({
    ...rest,
    family: familyName,
    size: options.size || sizes[options.textStyle] || 15,
    textStyle: options.textStyle || 'body',
  });
}

