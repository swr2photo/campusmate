import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Host, HStack, Image, TextField, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, autocorrectionDisabled, buttonStyle, frame, foregroundStyle, labelStyle, onSubmit, padding, submitLabel, textFieldStyle, textInputAutocapitalization, tint } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../theme';

const SearchField = forwardRef(function SearchField({ value = '', onChangeText,
  placeholder = 'ค้นหาสถานที่หรือกิจกรรม', onClear, style, autoCapitalize = 'none', showCancelButton = true }, ref) {
  const { colors, isDark } = useTheme();
  const inputRef = useRef(null);
  const text = useNativeState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (text.get() !== value) text.set(value); }, [text, value]);
  const clear = () => { text.set(''); onChangeText?.(''); onClear?.(); };
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), blur: () => inputRef.current?.blur(), clear }));
  return <View style={[{ minHeight: 48, width: '100%' }, style]}>
    <Host colorScheme={isDark ? 'dark' : 'light'} matchContents={{ vertical: true }} style={{ minHeight: 48, width: '100%' }}>
      <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 48 })]}>
        <Image systemName="magnifyingglass" size={19} color={colors.inkMuted} />
        <TextField ref={inputRef} text={text} placeholder={placeholder} onTextChange={onChangeText}
          onFocusChange={setFocused} modifiers={[textFieldStyle('roundedBorder'), frame({ maxWidth: Infinity, minHeight: 44 }),
            autocorrectionDisabled(), textInputAutocapitalization(autoCapitalize === 'none' ? 'never' : autoCapitalize),
            submitLabel('search'), onSubmit(() => inputRef.current?.blur()), accessibilityLabel(placeholder), foregroundStyle(colors.ink)]} />
        {value ? <Button label="ล้างคำค้นหา" systemImage="xmark.circle.fill" onPress={clear}
          modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), frame({ width: 44, height: 44 }), tint(colors.inkMuted)]} /> : null}
        {showCancelButton && focused ? <Button label="ยกเลิก" onPress={() => { clear(); void inputRef.current?.blur(); }}
          modifiers={[buttonStyle('plain'), frame({ minWidth: 44, minHeight: 44 }), padding({ horizontal: 4 }), tint(colors.primary)]} /> : null}
      </HStack>
    </Host>
  </View>;
});
export default SearchField;
