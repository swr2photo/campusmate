import { Keyboard, Pressable, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  BottomSheet,
  Button,
  ContentUnavailableView,
  DatePicker,
  Form,
  Host,
  HStack,
  Image,
  Picker,
  ScrollView,
  Section,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  datePickerStyle,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  padding,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  scrollDismissesKeyboard,
  scrollIndicators,
  shadow,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useApp } from '../context/AppContext';

const CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', symbol: 'square.grid.2x2.fill' },
  { id: 'sports', label: 'สนามกีฬา', symbol: 'sportscourt.fill' },
  { id: 'chill', label: 'โซนนั่งเล่น', symbol: 'leaf.fill' },
  { id: 'cafe', label: 'คาเฟ่', symbol: 'cup.and.saucer.fill' },
  { id: 'study', label: 'โซนอ่านหนังสือ', symbol: 'book.closed.fill' },
  { id: 'running', label: 'วิ่งออกกำลัง', symbol: 'figure.run' },
  { id: 'gym', label: 'ยิม/ฟิตเนส', symbol: 'dumbbell.fill' },
];

/** สร้างรายการ 7 วันถัดไป สำหรับ picker */
function getNextDays(count = 7) {
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const result = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    result.push({ value: iso, label });
  }
  return result;
}

const TIME_OPTIONS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
];

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });
const insetShape = shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' });

export default function MeetupScreen({ onToast }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { campusSpots, chooseMeetup, updateMeetupSchedule, clearMeetup, selectedMeetup } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [query, setQuery] = useState('');

  // Schedule BottomSheet state
  const [showSchedule, setShowSchedule] = useState(false);
  const [pendingSpot, setPendingSpot] = useState(null);
  const [schedDate, setSchedDate] = useState(new Date());
  const [schedStart, setSchedStart] = useState(() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; });
  const [schedEnd, setSchedEnd] = useState(() => { const d = new Date(); d.setHours(16, 0, 0, 0); return d; });
  const maxPeopleState = useNativeState('2');
  const messageState = useNativeState('');
  const searchState = useNativeState('');

  const nextDays = useMemo(() => getNextDays(7), []);

  const visibleSpots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return campusSpots.filter((spot) => {
      if (selectedCategory !== 'all' && spot.category !== selectedCategory) return false;
      if (!normalizedQuery) return true;
      return [spot.name, spot.description, spot.categoryLabel, spot.busyTime, spot.group]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [campusSpots, query, selectedCategory]);

  const openScheduleFor = (spot) => {
    setPendingSpot(spot);
    setSchedDate(new Date());
    const start = new Date(); start.setHours(14, 0, 0, 0);
    const end = new Date(); end.setHours(16, 0, 0, 0);
    setSchedStart(start);
    setSchedEnd(end);
    maxPeopleState.set('2');
    messageState.set('');
    setShowSchedule(true);
  };

  const confirmSchedule = () => {
    if (!pendingSpot) return;
    
    const year = schedDate.getFullYear();
    const month = String(schedDate.getMonth() + 1).padStart(2, '0');
    const day = String(schedDate.getDate()).padStart(2, '0');
    const isoDate = `${year}-${month}-${day}`;
    
    const formatTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const schedule = { 
      date: isoDate, 
      startTime: formatTime(schedStart), 
      endTime: formatTime(schedEnd),
      maxPeople: parseInt(maxPeopleState.get(), 10) || 2,
      message: messageState.get().trim()
    };
    chooseMeetup(pendingSpot, schedule);
    setShowSchedule(false);
    setPendingSpot(null);
    onToast?.(`ปักหมุด ${pendingSpot.name} แล้ว`);
  };

  const handleQuickChoose = (spot) => {
    chooseMeetup(spot);
    onToast?.(`เลือก ${spot.name} เป็นจุดนัดหมายแล้ว`);
  };

  const handleClear = () => {
    clearMeetup();
    onToast?.('ยกเลิกจุดนัดหมายแล้ว', 'info');
  };

  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <Pressable onPress={Keyboard.dismiss} style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 105, zIndex: 10 }}
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ width: '100%', height: 105 }}>
          <VStack modifiers={[padding({ top: 35, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <HStack modifiers={[frame({ maxWidth: Infinity })]}>
            <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <Text modifiers={[font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
                กิจกรรม
              </Text>
              <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(2)]}>
                สถานที่จริงพร้อมระยะห่างจาก GPS ของคุณ
              </Text>
            </VStack>
            <Spacer />
            <Image
              color={palette.coral}
              size={24}
              systemName="figure.2.and.child.holdinghands"
              modifiers={[frame({ width: 44, height: 44 }), background(palette.coralSoft, shapes.circle())]}
            />
                      </HStack>
          </VStack>
        </Host>
      </View>
      <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ flex: 1 }}>
        <ScrollView showsIndicators={false} modifiers={[scrollIndicators('never', 'vertical'), scrollDismissesKeyboard('immediately')]}>
          <VStack
            alignment="leading"
            spacing={16}
            modifiers={[
              padding({ top: 65, bottom: 38, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
          <CampusHero selectedMeetup={selectedMeetup} />

          <HStack spacing={8} modifiers={[
            padding({ horizontal: 13, vertical: 8 }),
            frame({ maxWidth: Infinity, minHeight: 44 }),
            background(palette.surface, insetShape),
          ]}>
            <Image color={palette.tertiary} size={16} systemName="magnifyingglass" />
            <TextField
              onTextChange={setQuery}
              placeholder="ค้นหาสถานที่หรือกิจกรรม"
              text={searchState}
              modifiers={[textFieldStyle('plain'), font({ textStyle: 'subheadline' }), frame({ maxWidth: Infinity })]}
            />
            {query ? (
              <Button
                onPress={() => {
                  setQuery('');
                  searchState.set('');
                }}
                modifiers={[buttonStyle('plain'), frame({ width: 24, height: 24 }), accessibilityLabel('ลบการค้นหา')]}
              >
                <Image color={palette.tertiary} size={16} systemName="xmark.circle.fill" />
              </Button>
            ) : null}
          </HStack>

          {selectedMeetup && (
            <SelectedMeetup
              meetup={selectedMeetup}
              onClear={handleClear}
              onChangeTime={() => openScheduleFor(selectedMeetup)}
            />
          )}

          <VStack alignment="leading" spacing={5}>
              <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(2)]}>
              เลือกกิจกรรมที่สนใจ
            </Text>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(2)]}>
              สถานที่จริงใน มอ. เรียงจากใกล้ไปไกล
            </Text>
          </VStack>

          <ScrollView axes="horizontal" showsIndicators={false} modifiers={[scrollIndicators('never', 'horizontal')]}>
            <HStack spacing={9}>
              {CATEGORIES.map((category) => (
                <CategoryChip
                  active={selectedCategory === category.id}
                  category={category}
                  key={category.id}
                  onPress={() => setSelectedCategory(category.id)}
                />
              ))}
            </HStack>
          </ScrollView>

          <HStack modifiers={[frame({ maxWidth: Infinity })]}>
            <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(2)]}>
              จุดนัดพบแนะนำ
            </Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.coral), lineLimit(1)]}>
              {visibleSpots.length} แห่ง · ใกล้สุดก่อน
            </Text>
          </HStack>

          {visibleSpots.length ? visibleSpots.map((spot) => (
            <SpotCard
              key={spot.id}
              onChoose={() => handleQuickChoose(spot)}
              onSchedule={() => openScheduleFor(spot)}
              selected={selectedMeetup?.id === spot.id}
              spot={spot}
            />
          )) : (
            <ContentUnavailableView
              description="ลองเลือกหมวดกิจกรรมอื่นเพื่อดูสถานที่เพิ่มเติม"
              systemImage="mappin.slash.circle.fill"
              title="ยังไม่มีสถานที่ในหมวดนี้"
              modifiers={[
                padding({ vertical: 42, horizontal: 20 }),
                frame({ maxWidth: Infinity }),
                background(palette.surface, cardShape),
              ]}
            />
          )}
        </VStack>
      </ScrollView>

      {/* Schedule BottomSheet */}
      <BottomSheet
        isPresented={showSchedule}
        onIsPresentedChange={setShowSchedule}
        modifiers={[
          presentationDetents(['large']),
          presentationDragIndicator('visible'),
        ]}
      >
        <VStack style={{ flex: 1 }}>
          <Text
            modifiers={[
              font({ textStyle: 'headline', weight: 'bold' }),
              padding({ top: 20, bottom: 5 }),
              frame({ maxWidth: Infinity, alignment: 'center' }),
            ]}
          >
            ตั้งวันเวลานัดหมาย
          </Text>
          {pendingSpot && (
            <Text
              modifiers={[
                font({ textStyle: 'subheadline', weight: 'semibold' }),
                foregroundStyle(palette.coral),
                padding({ bottom: 5 }),
                frame({ maxWidth: Infinity, alignment: 'center' }),
              ]}
            >
              📍 {pendingSpot.name}
            </Text>
          )}
          <Form>
            <Section header={<Text>เลือกวัน</Text>}>
              <DatePicker
                title="วันที่"
                selection={schedDate}
                onDateChange={setSchedDate}
                displayedComponents={['date']}
                modifiers={[datePickerStyle('compact')]}
              />
            </Section>
            <Section header={<Text>เลือกเวลา</Text>}>
              <DatePicker
                title="เวลาเริ่ม"
                selection={schedStart}
                onDateChange={setSchedStart}
                displayedComponents={['hourAndMinute']}
                modifiers={[datePickerStyle('compact')]}
              />
              <DatePicker
                title="เวลาสิ้นสุด"
                selection={schedEnd}
                onDateChange={setSchedEnd}
                displayedComponents={['hourAndMinute']}
                modifiers={[datePickerStyle('compact')]}
              />
            </Section>
            <Section header={<Text>รายละเอียด (ไม่บังคับ)</Text>}>
              <TextField text={maxPeopleState} placeholder="จำนวนคน (รวมตัวเอง) เช่น 2, 4" />
              <TextField text={messageState} placeholder="ประกาศ เช่น หาเพื่อนไปวิ่งครับ" axis="vertical" modifiers={[lineLimit(3)]} />
            </Section>
          </Form>
          <Button
            label="ยืนยันนัดหมาย"
            onPress={confirmSchedule}
            systemImage="checkmark.circle.fill"
            modifiers={[
              buttonStyle('glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(palette.coral),
              padding({ horizontal: 20, bottom: 24 }),
              frame({ maxWidth: Infinity }),
            ]}
          />
        </VStack>
      </BottomSheet>

      </Host>
    </Pressable>
  );
}

function CampusHero({ selectedMeetup }) {
  const palette = usePalette();
  return (
    <ZStack
      alignment="bottomLeading"
      modifiers={[
        frame({ height: 150, maxWidth: Infinity }),
        background(palette.blueSoft, cardShape),
        shadow({ radius: 18, y: 7, color: 'rgba(0,0,0,0.18)' }),
      ]}
    >
      <Image
        color="rgba(98,168,255,0.24)"
        size={152}
        systemName="map.fill"
        modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}
      />
      <VStack alignment="leading" spacing={5} modifiers={[padding({ all: 14 }), frame({ maxWidth: Infinity, alignment: 'bottomLeading' })]}>
        <Image
          color={palette.text}
          size={20}
          systemName="mappin.and.ellipse"
          modifiers={[frame({ width: 40, height: 40 }), background(palette.coral, shapes.circle())]}
        />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
          {selectedMeetup?.name || 'มหาวิทยาลัยสงขลานครินทร์'}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(2)]}>
          {selectedMeetup ? 'จุดนัดหมายล่าสุดของคุณ' : 'ค้นหาจุดนัดพบที่สะดวกและปลอดภัย'}
        </Text>
      </VStack>
    </ZStack>
  );
}

function SelectedMeetup({ meetup, onClear, onChangeTime }) {
  const palette = usePalette();
  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        padding({ all: 14 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.mintSoft, cardShape),
      ]}
    >
      <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        <Image color={palette.mint} size={18} systemName="checkmark.circle.fill" />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.mint)]}>เลือกไว้แล้ว</Text>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>{meetup.name}</Text>
        </VStack>
        <Spacer />
        <Button
          label="ยกเลิกจุดนัดหมาย"
          onPress={onClear}
          role="destructive"
          systemImage="xmark"
           modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('small'), labelStyle('iconOnly')]}
        />
      </HStack>
      <HStack spacing={8}>
        <Meta icon="location.fill" text={meetup.distance} />
        <Meta icon="clock.fill" text={meetup.scheduledAt} />
      </HStack>
      <Button
        label="เปลี่ยนวัน-เวลา"
        onPress={onChangeTime}
        systemImage="calendar.badge.clock"
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            tint(palette.mint),
            font({ textStyle: 'caption2', weight: 'semibold' }),
            padding({ horizontal: 6, vertical: 2 }),
          ]}
      />
    </VStack>
  );
}

function CategoryChip({ active, category, onPress }) {
  const palette = usePalette();
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(category.label)]}>
      <HStack
        spacing={5}
        modifiers={[
          padding({ horizontal: 10, vertical: 7 }),
          background(active ? palette.coralSoft : palette.surface, shapes.capsule()),
        ]}
      >
        <Image color={active ? palette.coral : palette.tertiary} size={12} systemName={category.symbol} />
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(active ? palette.coral : palette.text), lineLimit(1)]}>
          {category.label}
        </Text>
      </HStack>
    </Button>
  );
}

function SpotCard({ onChoose, onSchedule, selected, spot }) {
  const palette = usePalette();
  const accent = activityColor(spot.category);
  return (
    <VStack
      alignment="leading"
      spacing={9}
      modifiers={[
        padding({ all: 14 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surface, cardShape),
        shadow({ radius: 16, y: 6, color: 'rgba(0,0,0,0.18)' }),
      ]}
    >
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Image
          color={accent.color}
          size={20}
          systemName={activitySymbol(spot.category)}
           modifiers={[frame({ width: 42, height: 42 }), background(accent.soft, shapes.circle())]}
        />
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(2)]}>{spot.name}</Text>
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(accent.color), lineLimit(1)]}>{spot.categoryLabel}</Text>
        </VStack>
        <Spacer />
      </HStack>

      <VStack
        alignment="leading"
        spacing={5}
        modifiers={[
          padding({ all: 10 }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          background(palette.surfaceRaised, insetShape),
        ]}
      >
        <Meta icon="info.circle.fill" text={spot.description} />
        <Meta icon="person.2.fill" text={spot.busyTime} />
        <Meta icon="location.fill" text={spot.distance} accent />
      </VStack>

      <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button
          label="ปักหมุด + ตั้งเวลา"
          onPress={onSchedule}
          systemImage="calendar.badge.clock"
          modifiers={[
            buttonStyle('glassProminent'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            tint(palette.coral),
            font({ textStyle: 'caption2', weight: 'semibold' }),
            padding({ horizontal: 3, vertical: 2 }),
            frame({ maxWidth: Infinity }),
          ]}
        />
        <Button
          label={selected ? 'เลือกแล้ว' : 'ปักหมุดเลย'}
          onPress={onChoose}
          systemImage={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            tint(selected ? palette.mint : palette.secondary),
            font({ textStyle: 'caption2', weight: 'semibold' }),
            padding({ horizontal: 3, vertical: 2 }),
            frame({ maxWidth: Infinity }),
          ]}
        />
      </HStack>
    </VStack>
  );
}

function Meta({ accent = false, icon, text }) {
  const palette = usePalette();
  return (
    <HStack alignment="top" spacing={7}>
      <Image color={accent ? palette.coral : palette.tertiary} size={12} systemName={icon} />
      <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(accent ? palette.coral : palette.secondary), lineLimit(2), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {text}
      </Text>
    </HStack>
  );
}

function activitySymbol(category) {
  if (category === 'running') return 'figure.run';
  if (category === 'study') return 'book.closed.fill';
  if (category === 'gym') return 'dumbbell.fill';
  if (category === 'sports') return 'sportscourt.fill';
  if (category === 'cafe') return 'cup.and.saucer.fill';
  if (category === 'chill') return 'leaf.fill';
  return 'mappin.circle.fill';
}

function activityColor(category) {
  const palette = usePalette();
  if (category === 'running') return { color: palette.coral, soft: palette.coralSoft };
  if (category === 'study') return { color: palette.blue, soft: palette.blueSoft };
  if (category === 'gym') return { color: palette.violet, soft: palette.violetSoft };
  if (category === 'sports') return { color: '#FF9F43', soft: 'rgba(255,159,67,0.16)' };
  if (category === 'cafe') return { color: palette.coral, soft: palette.coralSoft };
  return { color: palette.mint, soft: palette.mintSoft };
}
