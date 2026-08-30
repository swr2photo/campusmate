import React from 'react';
import { SymbolView } from 'expo-symbols';

const FALLBACK_SYMBOLS = {
  'heart.fill': { ios: 'heart.fill', android: 'favorite', web: 'favorite' },
  'chevron.right': { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
};

export default function FeatureIcon({ color, name, size = 22 }) {
  return (
    <SymbolView
      name={FALLBACK_SYMBOLS[name] || FALLBACK_SYMBOLS['heart.fill']}
      size={size}
      style={{ height: size, width: size }}
      tintColor={color}
    />
  );
}
