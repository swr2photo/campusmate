import React from 'react';
import { Text as SwiftText, Button as SwiftButton } from '@expo/ui/swift-ui';
import { font } from './brandFont';
import { frame } from '@expo/ui/swift-ui/modifiers';

export function Text({ modifiers = [], ...props }) {
  return <SwiftText {...props} modifiers={[font({}), ...modifiers]} />;
}
export function Button({ modifiers = [], ...props }) {
  return <SwiftButton {...props} modifiers={[font({ weight: 'semibold' }), ...modifiers, frame({ minHeight: 44, minWidth: 44 })]} />;
}
