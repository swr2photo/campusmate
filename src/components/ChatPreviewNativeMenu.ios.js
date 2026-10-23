import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Host, Menu, Button, HStack, Image, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  menuIndicator,
  menuStyle,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';

export default function ChatPreviewNativeMenu({
  accentColor = '#3B5AFE',
  conversation,
  isDark = false,
  onClose,
  onDelete,
  onMarkUnread,
  onOpenChat,
  onTogglePin,
  pinned = false,
  variant = 'bar',
}) {
  const isIcon = variant === 'icon';

  const menuModifiers = useMemo(() => [
    menuStyle('button'),
    buttonStyle(isIcon ? 'plain' : 'glass'),
    buttonBorderShape(isIcon ? 'circle' : 'capsule'),
    controlSize(isIcon ? 'small' : 'regular'),
    menuIndicator('hidden'),
    frame(isIcon ? { width: 36, height: 36 } : { maxWidth: Infinity, minHeight: 44 }),
    accessibilityLabel('เมนูจัดการแชต'),
    tint(accentColor),
  ], [accentColor, isIcon]);

  const handleAction = (callback) => {
    onClose?.();
    if (callback) {
      requestAnimationFrame(() => callback(conversation));
    }
  };

  return (
    <View style={isIcon ? styles.iconContainer : styles.barContainer}>
      <Host colorScheme={isDark ? 'dark' : 'light'} style={isIcon ? styles.iconHost : styles.barHost}>
        <Menu
          label={
            isIcon ? (
              <Image color={accentColor} size={20} systemName="ellipsis.circle.fill" />
            ) : (
              <HStack spacing={8} alignment="center" modifiers={[padding({ horizontal: 14, vertical: 8 }), frame({ maxWidth: Infinity, minHeight: 40 })]}>
                <Image color={accentColor} size={18} systemName="ellipsis.circle.fill" />
                <Text modifiers={[foregroundStyle(accentColor), font({ size: 14, weight: 'semibold' })]}>
                  เมนูจัดการแชต
                </Text>
              </HStack>
            )
          }
          modifiers={menuModifiers}
        >
          {onOpenChat ? (
            <Button
              label="เปิดห้องแชต"
              systemImage="bubble.left.and.bubble.right.fill"
              onPress={() => handleAction(onOpenChat)}
            />
          ) : null}
          {onMarkUnread ? (
            <Button
              label="ทำเครื่องหมายว่ายังไม่อ่าน"
              systemImage="envelope.badge"
              onPress={() => handleAction(onMarkUnread)}
            />
          ) : null}
          {onTogglePin ? (
            <Button
              label={pinned ? 'เลิกปักหมุดแชต' : 'ปักหมุดแชต'}
              systemImage={pinned ? 'pin.slash.fill' : 'pin.fill'}
              onPress={() => handleAction(onTogglePin)}
            />
          ) : null}
          {onDelete ? (
            <Button
              label="ลบแชต"
              role="destructive"
              systemImage="trash"
              onPress={() => handleAction(onDelete)}
            />
          ) : null}
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  barContainer: {
    width: '100%',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  barHost: {
    width: '100%',
    minHeight: 44,
  },
  iconContainer: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconHost: {
    width: 36,
    height: 36,
  },
});
