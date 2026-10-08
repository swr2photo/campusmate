import React from 'react';
import { Text as SwiftText, Button as SwiftButton } from '@expo/ui/swift-ui';
import { font } from './brandFont';

export function Text({ modifiers = [], ...props }) {
  return <SwiftText {...props} modifiers={[font({}), ...modifiers]} />;
}
export function Button({ modifiers = [], ...props }) {
  return <SwiftButton {...props} modifiers={[font({ weight: 'semibold' }), ...modifiers]} />;
}
