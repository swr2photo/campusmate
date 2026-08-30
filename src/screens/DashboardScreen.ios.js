import React from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { useColorScheme } from 'react-native';
import {
  Button,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  padding,
  scrollIndicators,
  shadow,
  shapes,
  tint, resizable, aspectRatio, clipped, clipShape,
} from '@expo/ui/swift-ui/modifiers';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { useApp } from '../context/AppContext';

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

const cardShape = shapes.roundedRectangle({
  cornerRadius: 24,
  roundedCornerStyle: 'continuous',
});

export default function DashboardScreen({ onNavigate, onOpenProfile }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { conversations, pendingIncomingLikes, profile } = useApp();
  const unreadCount = conversations.reduce((sum, item) => sum + (item.unread || 0), 0);
  const displayName = profile?.name || profile?.nickname || 'เพื่อน';
  const remoteAvatar = useRemoteImage(profile?.avatarUri);
  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 90, zIndex: 10 }}
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ width: '100%', height: 90 }}>
          <VStack modifiers={[padding({ top: 35, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <Header avatarUri={remoteAvatar} displayName={displayName} onOpenProfile={onOpenProfile} />
          </VStack>
        </Host>
      </View>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.coral}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsIndicators={false}
          modifiers={[scrollIndicators('never', 'vertical')]}
        >
          <VStack
            alignment="leading"
            spacing={22}
            modifiers={[
              padding({ top: 115, bottom: 40, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >

            <VStack alignment="leading" spacing={5}>
              <Text
                modifiers={[
                  font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }),
                  foregroundStyle(palette.text),
                ]}
              >
                เมนูทางลัด
              </Text>
              <Text
                modifiers={[
                  font({ textStyle: 'subheadline', weight: 'medium' }),
                  foregroundStyle(palette.secondary),
                ]}
              >
                เลือกสิ่งที่คุณอยากทำต่อ
              </Text>
            </VStack>

            <VStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
              <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                <ShortcutCard
                  accent={palette.coral}
                  accentSoft={palette.coralSoft}
                  badge={pendingIncomingLikes.length}
                  hint="ดูว่าใครสนใจคุณ แล้วเลือกรับหรือปฏิเสธ"
                  onPress={() => onNavigate('likes')}
                  systemImage="heart.fill"
                  title="ถูกใจคุณ"
                />
                <ShortcutCard
                  accent={palette.violet}
                  accentSoft={palette.violetSoft}
                  hint="ค้นหาคนที่ชอบกิจกรรมเหมือนกัน"
                  onPress={() => onNavigate('discover')}
                  systemImage="person.2.fill"
                  title="ค้นหาเพื่อน"
                />
              </HStack>

              <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                <ShortcutCard
                  accent={palette.blue}
                  accentSoft={palette.blueSoft}
                  badge={unreadCount}
                  hint="กลับไปคุยกับเพื่อนที่จับคู่แล้ว"
                  onPress={() => onNavigate('chat')}
                  systemImage="message.fill"
                  title="แชตของฉัน"
                />
                <ShortcutCard
                  accent={palette.mint}
                  accentSoft={palette.mintSoft}
                  hint="เลือกจุดนัดพบที่สะดวกและปลอดภัย"
                  onPress={() => onNavigate('meetup')}
                  systemImage="mappin.and.ellipse"
                  title="จุดนัดหมาย"
                />
              </HStack>
            </VStack>
          </VStack>
        </ScrollView>
      </Host>
    </View>
  );
}

function Header({ avatarUri, displayName, onOpenProfile }) {
  const palette = usePalette();
  return (
    <HStack alignment="top" spacing={14} modifiers={[frame({ maxWidth: Infinity })]}>
      <VStack alignment="leading" spacing={5}>
        
        <Text
          modifiers={[
            font({ textStyle: 'largeTitle', weight: 'bold', design: 'rounded' }),
            foregroundStyle(palette.text),
            lineLimit(2),
          ]}
        >
          สวัสดี {displayName}
        </Text>
      </VStack>
      <Spacer />
      {avatarUri ? (
        <Image
          uiImage={avatarUri}
          onPress={onOpenProfile}
          modifiers={[
            resizable(),
            aspectRatio({ contentMode: 'fill' }),
            frame({ width: 44, height: 44 }),
            clipped(),
            clipShape('circle'),
          ]}
        />
      ) : (
        <Button
          label="เปิดโปรไฟล์"
          onPress={onOpenProfile}
          systemImage="person.crop.circle.fill"
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('large'),
            labelStyle('iconOnly'),
            tint(palette.coral),
          ]}
        />
      )}
    </HStack>
  );
}

function ShortcutCard({ accent, accentSoft, badge = 0, hint, onPress, systemImage, title }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity }),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={11}
        modifiers={[
          padding({ all: 16 }),
          frame({ minHeight: 164, maxWidth: Infinity, alignment: 'topLeading' }),
          background(palette.surface, cardShape),
          shadow({ radius: 18, y: 8, color: 'rgba(0,0,0,0.22)' }),
        ]}
      >
        <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
          <Image
            color={accent}
            size={24}
            systemName={systemImage}
            modifiers={[
              frame({ width: 48, height: 48 }),
              background(accentSoft, shapes.circle()),
            ]}
          />
          <Spacer />
          {badge > 0 && (
            <Text
              modifiers={[
                padding({ horizontal: 9, vertical: 5 }),
                background(accentSoft, shapes.capsule()),
                font({ textStyle: 'caption2', weight: 'bold' }),
                foregroundStyle(accent),
              ]}
            >
              {badge > 99 ? '99+' : badge}
            </Text>
          )}
        </HStack>
        <Spacer minLength={3} />
        <Text
          modifiers={[
            font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }),
            foregroundStyle(palette.text),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'medium' }),
            foregroundStyle(palette.secondary),
            lineLimit(2),
          ]}
        >
          {hint}
        </Text>
      </VStack>
    </Button>
  );
}
