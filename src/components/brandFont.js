import { font as nativeFont } from '@expo/ui/swift-ui/modifiers';
const weights = { bold: 'Bold', heavy: 'Bold', black: 'Bold', semibold: 'SemiBold', medium: 'Medium' };
// Custom families retain SwiftUI's textStyle scaling rather than fixing Dynamic Type.
export function font(options = {}) {
  const { weight, design, ...rest } = options;
  const sizes = { largeTitle: 28, title1: 24, title: 24, title2: 22, title3: 19, headline: 17, subheadline: 15, body: 15, callout: 15, footnote: 13, caption: 12, caption1: 12, caption2: 11 };
  return nativeFont({ ...rest, family: options.family || `NotoSansThai-${weights[weight] || 'Regular'}`, size: options.size || sizes[options.textStyle] || 15, textStyle: options.textStyle || 'body' });
}
