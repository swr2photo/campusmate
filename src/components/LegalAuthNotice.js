import Text from './AppText';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { spacing, type, useTheme } from '../theme';

export default function LegalAuthNotice({ style, compact = false }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.wrap, style]}>
      <Text style={[styles.copy, compact && styles.compactCopy, { color: colors.inkSoft }]}> 
        {compact ? 'การสมัครหรือเข้าสู่ระบบหมายถึงยอมรับ ' : 'สมัครใหม่ได้เฉพาะอีเมล @psu.ac.th การสมัครหรือเข้าสู่ระบบ หมายความว่าคุณมีอายุอย่างน้อย 18 ปี และยอมรับ '}
        <Text
          accessibilityRole="link"
          onPress={() => router.push('/terms')}
          style={[styles.link, { color: colors.primary }]}
        >
          เงื่อนไขการให้บริการ
        </Text>
        {' '}และ{' '}
        <Text
          accessibilityRole="link"
          onPress={() => router.push('/privacy-policy')}
          style={[styles.link, { color: colors.primary }]}
        >
          นโยบายความเป็นส่วนตัว
        </Text>
        {compact ? null : ' ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  copy: {
    fontSize: type.micro,
    lineHeight: 18,
    textAlign: 'center',
  },
  compactCopy: {
    fontSize: type.caption2,
    lineHeight: 16,
  },
  link: {
    fontWeight: '800',
  },
});
