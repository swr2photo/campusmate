import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Button, Host, Image, Menu, RNHostView } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  frame,
  menuIndicator,
  menuStyle,
} from '@expo/ui/swift-ui/modifiers';

// Isolate the system menu's presentation/layout from the host containing the
// focused TextField. The RN bridge is required for a Host within SwiftUI content.
export default function ChatAttachmentMenu({ color, colorScheme, onPhotos, onCamera, onGif, onMusic }) {
  const menuModifiers = useMemo(() => [
    menuStyle('button'),
    buttonStyle('plain'),
    menuIndicator('hidden'),
    frame({ width: 36, height: 36 }),
    accessibilityLabel('เพิ่มไฟล์แนบ'),
  ], []);

  return (
    <RNHostView matchContents>
      <View collapsable={false} style={{ width: 36, height: 36 }}>
        <Host colorScheme={colorScheme} ignoreSafeArea="all" style={{ width: 36, height: 36 }}>
          <Menu
            label={<Image color={color} size={20} systemName="plus" />}
            modifiers={menuModifiers}
          >
            <Button label="รูปภาพและวิดีโอ" systemImage="photo.on.rectangle" onPress={onPhotos} />
            <Button label="กล้อง" systemImage="camera" onPress={onCamera} />
            <Button label="GIF" systemImage="play.rectangle" onPress={onGif} />
            {onMusic ? <Button label="เพลง" systemImage="music.note" onPress={onMusic} /> : null}
          </Menu>
        </Host>
      </View>
    </RNHostView>
  );
}

