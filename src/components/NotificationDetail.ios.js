import React, { useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { Host, BottomSheet, HStack, VStack, Spacer, Image, ScrollView } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonStyle, controlSize, fixedSize, foregroundStyle, frame, labelStyle, padding, presentationDragIndicator, shapes, textSelection, tint } from '@expo/ui/swift-ui/modifiers';
import { Button, Text } from './NativeTypography';
import { font } from './brandFont';
import { useTheme } from '../theme';
import { timestampMillis } from '../services/notificationInboxService';

export default function NotificationDetail({ notification, onClose, actionLabel, onAction }) {
  const pendingAction = useRef(null);
  const { width, height } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const timestamp = timestampMillis(notification?.createdAt);
  const body = notification?.body || '';
  const charsPerLine = Math.max(20, Math.floor((Math.min(width, 760) - 64) / 7));
  const lines = body.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  const bodyHeight = Math.min(height * 0.4, Math.max(40, lines * 28));
  return <Host colorScheme={isDark ? 'dark' : 'light'} style={{ position: 'absolute', width: 0, height: 0 }}>
    <BottomSheet isPresented={Boolean(notification)} onIsPresentedChange={(presented) => { if (!presented) onClose(); }} onDismiss={() => { const action = pendingAction.current; pendingAction.current = null; action?.(); }} fitToContents modifiers={[presentationDragIndicator('visible')]}>
      <VStack alignment="leading" spacing={18} modifiers={[padding({ horizontal: 24, top: 24, bottom: 28 }), frame({ maxWidth: Infinity, alignment: 'leading' }), background(colors.card)]}>
        <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
          <Image systemName="bell" color={colors.primary} size={22} modifiers={[frame({ width: 44, height: 44 }), background(colors.primarySoft, shapes.roundedRectangle({ cornerRadius: 14 }))]} />
          <VStack alignment="leading" spacing={4}>
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(colors.inkMuted)]}>รายละเอียดแจ้งเตือน</Text>
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(colors.inkMuted)]}>{timestamp ? new Date(timestamp).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'แจ้งเตือนใหม่'}</Text>
          </VStack>
          <Spacer />
          <Button label="ปิดรายละเอียดแจ้งเตือน" systemImage="xmark" onPress={onClose} modifiers={[buttonStyle('bordered'), labelStyle('iconOnly'), accessibilityLabel('ปิดรายละเอียดแจ้งเตือน'), tint(colors.ink)]} />
        </HStack>
        <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(colors.ink), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{notification?.title || ''}</Text>
        <ScrollView modifiers={[frame({ height: bodyHeight, maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(colors.inkMuted), frame({ maxWidth: Infinity, alignment: 'leading' }), fixedSize({ horizontal: false, vertical: true }), textSelection(true)]}>{body}</Text>
        </ScrollView>
        {actionLabel ? <Button label={actionLabel} onPress={() => { pendingAction.current = onAction; onClose(); }} modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary), frame({ maxWidth: Infinity })]} /> : null}
        <Button label="อ่านแล้ว · ปิด" onPress={onClose} modifiers={[buttonStyle('bordered'), controlSize('large'), tint(colors.ink), frame({ maxWidth: Infinity })]} />
      </VStack>
    </BottomSheet>
  </Host>;
}
