import React from 'react';
import { Host, Image } from '@expo/ui/swift-ui';

export default function FeatureIcon({ color, name, size = 22 }) {
  return (
    <Host matchContents pointerEvents="none">
      <Image color={color} size={size} systemName={name} />
    </Host>
  );
}
