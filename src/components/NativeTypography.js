import React from 'react';
import { Text as SwiftText, Button as SwiftButton } from '@expo/ui/swift-ui';
import { font } from './brandFont';
import { frame } from '@expo/ui/swift-ui/modifiers';

export function Text({ modifiers = [], ...props }) {
  const defaultFont = modifiers.some((modifier) => modifier?.$type === 'font') ? [] : [font({})];
  return <SwiftText {...props} modifiers={[...defaultFont, ...modifiers]} />;
}
export function Button({ modifiers = [], ...props }) {
  const defaultFont = modifiers.some((modifier) => modifier?.$type === 'font') ? [] : [font({ weight: 'semibold' })];
  return <SwiftButton {...props} modifiers={[...defaultFont, ...modifiers, frame({ minHeight: 44, minWidth: 44 })]} />;
}
