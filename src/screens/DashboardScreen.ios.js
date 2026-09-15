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
  RNHostView,
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
import { Text as RNText, View } from 'react-native';
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
  const { appointments, conversations, matchedProfileIds, pendingIncomingLikes, profile } = useApp();
  const safeConversations = conversations || [];
  const safePendingLikes = pendingIncomingLikes || [];
  const safeAppointments = appointments || [];
  const matchedCount = Math.max(matchedProfileIds?.length || 0, safeConversations.length);
  const activeUserId = profile?.id;
  const unreadCount = safeConversations.reduce(
    (sum, item) => sum + (item.unreadCounts?.[activeUserId] || item.unread || 0),
    0
  );
  const activeAppointmentCount = safeAppointments.filter((appointment) => appointment.status === 'active').length;
  const displayName = profile?.name || profile?.nickname || 'เพื่อน';
  const remoteAvatar = useRemoteImage(profile?.avatarUri, profile?.updatedAt, profile?.id);
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
            <Header avatarUri={remoteAvatar} displayName={displayName} onNavigate={onNavigate} onOpenProfile={onOpenProfile} unreadCount={unreadCount} />
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
                  badge={safePendingLikes.length}
                  hint="ดูคนที่ถูกใจคุณ คำขอที่ส่งไป และคู่ที่จับคู่แล้ว"
                  onPress={() => onNavigate('likes')}
                  systemImage="heart.fill"
                  title="ถูกใจ & จับคู่"
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

              <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                <ShortcutCard
                  accent={palette.coral}
                  accentSoft={palette.coralSoft}
                  badge={activeAppointmentCount}
                  hint="ดูวันเวลาและรายละเอียดนัดหมายกับแต่ละคน"
                  onPress={() => onNavigate('appointments')}
                  systemImage="calendar.badge.clock"
                  title="ประวัติการนัด"
                />
                <VStack modifiers={[frame({ maxWidth: Infinity })]} />
              </HStack>
            </VStack>

            <MatchStatsCard
              conversationsCount={safeConversations.length}
              matchedCount={matchedCount}
              pendingCount={safePendingLikes.length}
              unreadCount={unreadCount}
            />
          </VStack>
        </ScrollView>
      </Host>
    </View>
  );
}

function Header({ avatarUri, displayName, onNavigate, onOpenProfile, unreadCount = 0 }) {
  const palette = usePalette();
  return (
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
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

function MatchStatsCard({ conversationsCount, matchedCount, pendingCount, unreadCount }) {
  const palette = usePalette();
  const activeRate = matchedCount > 0
    ? Math.min(100, Math.round((conversationsCount / matchedCount) * 100))
    : 0;
  const waitingCount = Math.max(0, matchedCount - conversationsCount);
  const insight = matchedCount === 0
    ? 'เริ่มค้นหาเพื่อนเพื่อสร้างแมตช์แรกของคุณ'
    : activeRate >= 75
      ? 'แมตช์ส่วนใหญ่เริ่มบทสนทนาแล้ว'
      : `ยังมี ${waitingCount} แมตช์ที่รอเริ่มบทสนทนา`;
  return (
    <VStack
      alignment="leading"
      spacing={12}
      modifiers={[
        padding({ all: 16 }),
        frame({ maxWidth: Infinity, alignment: 'topLeading' }),
        background(palette.surface, cardShape),
        shadow({ radius: 18, y: 8, color: 'rgba(0,0,0,0.18)' }),
      ]}
    >
      <HStack alignment="top" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text
            modifiers={[
              font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.text),
            ]}
          >
            สถิติแมตช์
          </Text>
        </VStack>
        <VStack alignment="trailing" spacing={1}>
          <Text
            modifiers={[
              font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.violet),
            ]}
          >
            {matchedCount}
          </Text>
          <Text
            modifiers={[
              font({ textStyle: 'caption2', weight: 'semibold' }),
              foregroundStyle(palette.secondary),
            ]}
          >
            แมตช์แล้ว
          </Text>
        </VStack>
      </HStack>

      <HStack
        alignment="center"
        spacing={0}
        modifiers={[frame({ maxWidth: Infinity })]}
      >
        <Spacer />
        <RNHostView matchContents={true} style={{ height: 156, width: 220 }}>
          <HalfDonutChart activeRate={activeRate} palette={palette} />
        </RNHostView>
        <Spacer />
      </HStack>

      <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
          <StatLegend accent={palette.violet} label="แมตช์" value={matchedCount} />
          <StatLegend accent={palette.coral} label="รอรับ" value={pendingCount} />
        </HStack>
        <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
          <StatLegend accent={palette.blue} label="ห้องแชต" value={conversationsCount} />
          <StatLegend accent={palette.mint} label="ยังไม่อ่าน" value={unreadCount} />
        </HStack>
      </VStack>

      <HStack
        alignment="center"
        spacing={8}
        modifiers={[
          padding({ horizontal: 10, vertical: 9 }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 12, roundedCornerStyle: 'continuous' })),
        ]}
      >
        <Image color={palette.violet} size={15} systemName="sparkles" />
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'medium' }),
            foregroundStyle(palette.secondary),
            lineLimit(2),
          ]}
        >
          {insight} · อัตราเริ่มแชต {activeRate}%
        </Text>
      </HStack>
    </VStack>
  );
}

function HalfDonutChart({ activeRate, palette }) {
  const segmentCount = 25;
  const activeSegments = Math.round((activeRate / 100) * segmentCount);
  const chartWidth = 220;
  const chartHeight = 156;
  const centerX = chartWidth / 2;
  const baselineY = 118;
  const radiusValue = 86;
  const segmentWidth = 11;
  const segmentHeight = 18;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const angle = 180 - (index * 180) / (segmentCount - 1);
    const radians = (angle * Math.PI) / 180;
    return {
      angle,
      index,
      left: centerX + radiusValue * Math.cos(radians) - segmentWidth / 2,
      top: baselineY - radiusValue * Math.sin(radians) - segmentHeight / 2,
    };
  });

  return (
    <View
      accessibilityLabel={`อัตราเริ่มแชต ${activeRate}%`}
      style={{ alignSelf: 'center', height: chartHeight, position: 'relative', width: chartWidth }}
    >
      {segments.map((segment) => (
        <View
          key={segment.index}
          style={{
            backgroundColor: segment.index < activeSegments ? palette.violet : palette.surfaceRaised,
            borderRadius: 6,
            height: segmentHeight,
            left: segment.left,
            position: 'absolute',
            top: segment.top,
            transform: [{ rotate: `${90 - segment.angle}deg` }],
            width: segmentWidth,
          }}
        />
      ))}
      <View style={{ alignItems: 'center', left: 38, position: 'absolute', right: 38, top: 62 }}>
        <RNText style={{ color: palette.text, fontSize: 24, fontWeight: '800' }}>{activeRate}%</RNText>
        <RNText style={{ color: palette.secondary, fontSize: 12, fontWeight: '600', marginTop: 1 }}>เริ่มแชตแล้ว</RNText>
      </View>
    </View>
  );
}

function StatLegend({ accent, label, value }) {
  const palette = usePalette();
  return (
    <HStack
      alignment="center"
      spacing={6}
      modifiers={[
        padding({ horizontal: 9, vertical: 8 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 11, roundedCornerStyle: 'continuous' })),
      ]}
    >
      <Image color={accent} size={9} systemName="circle.fill" />
      <Text
        modifiers={[
          font({ textStyle: 'caption2', weight: 'semibold' }),
          foregroundStyle(palette.secondary),
          lineLimit(1),
        ]}
      >
        {label}
      </Text>
      <Spacer />
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'bold', design: 'rounded' }),
          foregroundStyle(palette.text),
        ]}
      >
        {value}
      </Text>
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
