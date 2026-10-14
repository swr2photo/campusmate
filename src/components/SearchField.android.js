import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

const SearchField = forwardRef(function SearchField({ value = '', onChangeText,
  placeholder = 'ค้นหาสถานที่หรือกิจกรรม', onClear, style, autoCapitalize = 'none', showCancelButton = true }, ref) {
  const { colors } = useTheme();
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  const clear = () => { onChangeText?.(''); onClear?.(); };
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur(), clear }));
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.field, { backgroundColor: colors.surfaceRaised, borderColor: focused ? colors.primary : colors.line }]}>
        <FeatureIcon name="magnifyingglass" size={20} color={colors.inkMuted} />
        <TextInput ref={input} value={value} onChangeText={onChangeText} placeholder={placeholder}
          accessibilityLabel={placeholder} placeholderTextColor={colors.inkMuted} autoCapitalize={autoCapitalize}
          autoCorrect={false} returnKeyType="search" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={[styles.input, { color: colors.ink }]} />
        {value.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="ล้างคำค้นหา" onPress={clear} style={styles.action}>
          <FeatureIcon name="xmark.circle.fill" size={20} color={colors.inkMuted} />
        </Pressable> : null}
      </View>
      {showCancelButton && focused ? <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกการค้นหา"
        onPress={() => { input.current?.blur(); Keyboard.dismiss(); setFocused(false); clear(); }} style={styles.cancel}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>ยกเลิก</Text>
      </Pressable> : null}
    </View>
  );
});
export default SearchField;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: 16, paddingRight: 4, borderRadius: 24, borderWidth: 1, gap: 8 },
  input: { flex: 1, minWidth: 0, fontSize: 16, minHeight: 48, paddingVertical: 8 },
  action: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' },
});
