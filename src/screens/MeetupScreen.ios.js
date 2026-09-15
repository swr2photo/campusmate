import { Alert, Keyboard, Modal, Platform, Pressable, Text as RNText, useColorScheme, View, Dimensions, Image as RNImage, Animated, ScrollView as RNScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useMemo, useState, useRef } from 'react';
import CampusMapView from '../components/CampusMapView';
import { Stack } from 'expo-router';
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
  RNHostView,
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
  const { width: windowWidth } = useWindowDimensions();
  // IPadAspectFrame in app/_layout.js clamps the screen layout canvas to 390pt on iPad
  const isIPadFrame = Platform.OS === 'ios' && Platform.isPad && windowWidth > 430;
  const layoutWidth = isIPadFrame ? 390 : windowWidth;
  const bannerWidth = layoutWidth - 40;
  const { campusSpots, chooseMeetup, updateMeetupSchedule, clearMeetup, selectedMeetup } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [query, setQuery] = useState('');

  // Schedule BottomSheet state
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [isMapMounted, setIsMapMounted] = useState(false);
  const [pendingSpot, setPendingSpot] = useState(null);
  const [mapTargetSpot, setMapTargetSpot] = useState(null);
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

  const openMapForSpot = useCallback((spot) => {
    setMapTargetSpot(spot || selectedMeetup || visibleSpots[0]);
    setIsMapMounted(true);
    setShowMapModal(true);
  }, [selectedMeetup, visibleSpots]);

  const openScheduleFor = useCallback((spot) => {
    setPendingSpot(spot);
    setSchedDate(new Date());
    const start = new Date(); start.setHours(14, 0, 0, 0);
    const end = new Date(); end.setHours(16, 0, 0, 0);
    setSchedStart(start);
    setSchedEnd(end);
    maxPeopleState.set('2');
    messageState.set('');
    setShowSchedule(true);
  }, [maxPeopleState, messageState]);

  const confirmSchedule = async () => {
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
    try {
      if (selectedMeetup?.id === pendingSpot.id && updateMeetupSchedule) {
        await updateMeetupSchedule(schedule);
      } else {
        await chooseMeetup(pendingSpot, schedule);
      }
      const successMessage = `ปักหมุด ${pendingSpot.name} แล้ว`;
      setShowSchedule(false);
      setPendingSpot(null);
      setTimeout(() => onToast?.(successMessage), 350);
    } catch (error) {
      console.error('confirmSchedule error:', error);
      onToast?.('บันทึกเวลานัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    }
  };

  const handleQuickChoose = useCallback(async (spot, deferToast = false) => {
    try {
      await chooseMeetup(spot);
      const successMessage = `เลือก ${spot.name} เป็นจุดนัดหมายแล้ว`;
      if (deferToast) setTimeout(() => onToast?.(successMessage), 350);
      else onToast?.(successMessage);
    } catch (error) {
      console.error('handleQuickChoose error:', error);
      if (deferToast) setTimeout(() => onToast?.('เลือกจุดนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info'), 350);
      else onToast?.('เลือกจุดนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    }
  }, [chooseMeetup, onToast]);

  const handleClear = () => {
    const spotName = selectedMeetup?.name ? ` "${selectedMeetup.name}"` : '';
    Alert.alert(
      'ยืนยันยกเลิกจุดนัดหมาย',
      `คุณต้องการยกเลิกจุดนัดหมาย${spotName} ใช่หรือไม่?`,
      [
        {
          text: 'ไม่ยกเลิก',
          style: 'cancel',
        },
        {
          text: 'ยืนยันยกเลิก',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearMeetup();
              onToast?.('ยกเลิกจุดนัดหมายแล้ว', 'info');
            } catch (error) {
              console.error('[Meetup.ios] handleClear error:', error);
              onToast?.('ยกเลิกจุดนัดหมายไม่สำเร็จ', 'info');
            }
          },
        },
      ]
    );
  };

  const scrollY = useRef(new Animated.Value(0)).current;

  const largeHeaderOpacity = scrollY.interpolate({
    inputRange: [0, 40],
    outputRange: [1, 0],
    extrapolate: 'clamp'
  });
  
  const largeHeaderTranslateY = scrollY.interpolate({
    inputRange: [0, 40],
    outputRange: [0, -20],
    extrapolate: 'clamp'
  });

  const smallHeaderOpacity = scrollY.interpolate({
    inputRange: [30, 60],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  });

  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 105, zIndex: 10 }}
        pointerEvents="none"
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>

      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, opacity: largeHeaderOpacity, transform: [{ translateY: largeHeaderTranslateY }] }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ width: '100%', height: 105 }}>
          <VStack modifiers={[padding({ top: 45, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <HStack modifiers={[frame({ maxWidth: Infinity })]}>
              <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
                  กิจกรรม
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
      </Animated.View>

      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 95, zIndex: 21, opacity: smallHeaderOpacity, paddingTop: 45, paddingHorizontal: 20 }} pointerEvents="box-none">
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: -20 }}>
          <MaskedView style={{ flex: 1 }} maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF00']} locations={[0.6, 1]} style={{ flex: 1 }} />}>
            <BlurView intensity={100} tint="prominent" style={{ flex: 1 }} />
          </MaskedView>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <RNText style={{ fontSize: 17, fontWeight: '600', color: colorScheme === 'dark' ? '#fff' : '#000', position: 'absolute' }}>
            กิจกรรม
          </RNText>
          <View style={{ flex: 1 }} />
          <Pressable style={{ width: 32, height: 32, backgroundColor: palette.coralSoft, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="figure.2.and.child.holdinghands" size={18} tintColor={palette.coral} />
          </Pressable>
        </View>
      </Animated.View>

      <Animated.ScrollView
        style={{ flex: 1, width: '100%' }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <Host colorScheme={colorScheme} seedColor={palette.coral} matchContents={{ vertical: true }} style={{ width: '100%' }}>
          <VStack
            alignment="leading"
            spacing={16}
            modifiers={[
              padding({ top: 140, bottom: 38, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >

          <CampusHero
            bannerHeight={180}
            bannerWidth={bannerWidth}
            onOpenMap={() => openMapForSpot(selectedMeetup || visibleSpots[0])}
            selectedMeetup={selectedMeetup}
          />

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
              onOpenMap={() => openMapForSpot(selectedMeetup)}
            />
          )}

          <VStack alignment="leading" spacing={5}>
              <HStack spacing={6} alignment="center">
                <Image systemName="mappin.and.ellipse" color={palette.coral} />
                <Text modifiers={[font({ textStyle: 'headline', weight: 'semibold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
                  เลือกกิจกรรมที่สนใจ
                </Text>
              </HStack>
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
              onChoose={handleQuickChoose}
              onOpenMap={openMapForSpot}
              onSchedule={openScheduleFor}
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
        </Host>
      </Animated.ScrollView>

      {/* Map Modal — uses RN Modal (UIKit) so WebView touch works */}
      <Modal
        animationType="slide"
        visible={showMapModal}
        onDismiss={() => setIsMapMounted(false)}
        onRequestClose={() => setShowMapModal(false)}
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colorScheme === 'dark' ? '#14171B' : '#F6F8FC' }}>
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 2 }}>
            <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.18)' }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 }}>
            <SymbolView name="map.fill" size={20} tintColor={palette.coral} style={{ marginRight: 8 }} />
            <RNText style={{ fontSize: 17, fontWeight: '800', color: colorScheme === 'dark' ? '#F7F8FA' : '#10203A', letterSpacing: -0.3, textAlign: 'center' }}>
              แผนที่วิทยาเขต ม.อ. หาดใหญ่
            </RNText>
          </View>
          <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
            <View style={{ flex: 1, borderRadius: 22, overflow: 'hidden' }}>
              {isMapMounted ? (
                <CampusMapView
                  spots={campusSpots}
                  selectedSpot={mapTargetSpot || selectedMeetup}
                  onSelectSpot={(spot) => {
                    handleQuickChoose(spot, true);
                    setShowMapModal(false);
                  }}
                  onScheduleSpot={(spot) => {
                    setShowMapModal(false);
                    openScheduleFor(spot);
                  }}
                  height="100%"
                />
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Schedule BottomSheet — keep inside Host for SwiftUI-native forms */}
      <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ position: 'absolute', width: 0, height: 0 }}>
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
            <HStack spacing={4} alignment="center" modifiers={[padding({ bottom: 5 }), frame({ maxWidth: Infinity, alignment: 'center' })]}>
              <Image systemName="mappin.and.ellipse" color={palette.coral} />
              <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.coral)]}>
                {pendingSpot.name}
              </Text>
            </HStack>
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
              controlSize('large'),
              tint(palette.coral),
              padding({ horizontal: 20, bottom: 24 }),
              frame({ maxWidth: Infinity }),
            ]}
          />
        </VStack>
      </BottomSheet>

      </Host>
    </View>
  );
}

const CAMPUS_PHOTOS = [
  require('../assets/images/campus/DSC_3614.jpg'),
  require('../assets/images/campus/DSC_5070.jpg'),
  require('../assets/images/campus/DSC_5071.jpg'),
  require('../assets/images/campus/DSC_8697.jpg'),
];

function CampusHero({ bannerHeight = 180, bannerWidth, onOpenMap, selectedMeetup }) {
  const palette = usePalette();
  const { width: windowWidth } = useWindowDimensions();
  const isIPadFrame = Platform.OS === 'ios' && Platform.isPad && windowWidth > 430;
  const layoutWidth = isIPadFrame ? 390 : windowWidth;
  const width = Math.min(bannerWidth || (layoutWidth - 40), layoutWidth - 40);
  const height = bannerHeight || 180;
  
  return (
    <VStack modifiers={[frame({ width: width, height: height, alignment: 'center' }), padding({ bottom: 10 })]}>
      <ZStack
        alignment="bottomLeading"
        modifiers={[
          frame({ width: width, height: height }),
          background(palette.surface, cardShape),
          shadow({ radius: 18, y: 7, color: 'rgba(0,0,0,0.18)' }),
        ]}
      >
        <RNHostView matchContents={false} style={{ width: width, height: height }}>
          <View style={{ width: width, height: height, borderRadius: 24, overflow: 'hidden' }}>
            <RNScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: width, height: height }}>
              {CAMPUS_PHOTOS.map((photo, index) => (
                <View key={index} style={{ width: width, height: height }}>
                  <RNImage source={photo} style={{ width: width, height: height }} resizeMode="cover" />
                </View>
              ))}
            </RNScrollView>
            
            <MaskedView
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.min(110, height * 0.6) }}
              maskElement={
                <LinearGradient colors={['#FFFFFF00', '#FFFFFFFF']} style={{ flex: 1 }} />
              }
            >
              <BlurView intensity={80} tint="dark" style={{ flex: 1 }} />
            </MaskedView>
          </View>
        </RNHostView>
        
        <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 14 }), frame({ maxWidth: Infinity, alignment: 'bottomLeading' })]}>
          <HStack spacing={8} alignment="center">
            <Image
              color={palette.text}
              size={18}
              systemName="mappin.and.ellipse"
              modifiers={[frame({ width: 36, height: 36 }), background(palette.coral, shapes.circle())]}
            />
            <Button
              label="แตะเพื่อเปิดแผนที่"
              onPress={onOpenMap}
              systemImage="map.fill"
              modifiers={[
                buttonStyle('glass'),
                buttonBorderShape('capsule'),
                controlSize('small'),
                tint(palette.coral),
                font({ textStyle: 'caption2', weight: 'bold' })
              ]}
            />
          </HStack>
          <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(1)]}>
              {selectedMeetup?.name || 'มหาวิทยาลัยสงขลานครินทร์'}
            </Text>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle('#E2E8F0'), lineLimit(2)]}>
              {selectedMeetup ? 'จุดนัดหมายล่าสุดของคุณ · แตะเพื่อดูตำแหน่งบนแผนที่' : 'ดูพิกัดจริงและสถานที่รอบตัวบนแผนที่ดาวเทียม / แผนที่ ม.อ.'}
            </Text>
          </VStack>
        </VStack>
      </ZStack>
    </VStack>
  );
}

function SelectedMeetup({ meetup, onChangeTime, onClear, onOpenMap }) {
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
      <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
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
        {onOpenMap && (
          <Button
            label="ดูพิกัดบนแผนที่"
            onPress={onOpenMap}
            systemImage="map.fill"
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(palette.blue),
              font({ textStyle: 'caption2', weight: 'semibold' }),
              padding({ horizontal: 6, vertical: 2 }),
            ]}
          />
        )}
      </HStack>
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

const SpotCard = React.memo(function SpotCard({ onChoose, onOpenMap, onSchedule, selected, spot }) {
  const palette = usePalette();
  const accent = activityColor(spot.category);
  const handleChoose = useCallback(() => onChoose?.(spot), [onChoose, spot]);
  const handleOpenMap = useCallback(() => onOpenMap?.(spot), [onOpenMap, spot]);
  const handleSchedule = useCallback(() => onSchedule?.(spot), [onSchedule, spot]);
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

      <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' })]}>
        <Button
          label="นัดหมาย"
          onPress={handleSchedule}
          systemImage="calendar.badge.clock"
          modifiers={[
            buttonStyle('glassProminent'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            tint(palette.coral),
            font({ textStyle: 'caption2', weight: 'semibold' }),
            padding({ horizontal: 6, vertical: 2 }),
          ]}
        />
        <Button
          label={selected ? 'เลือกแล้ว' : 'ปักหมุด'}
          onPress={handleChoose}
          systemImage={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            tint(selected ? palette.mint : palette.secondary),
            font({ textStyle: 'caption2', weight: 'semibold' }),
            padding({ horizontal: 6, vertical: 2 }),
          ]}
        />
        {onOpenMap && (
          <Button
            label="แผนที่"
            onPress={handleOpenMap}
            systemImage="map.fill"
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(palette.blue),
              font({ textStyle: 'caption2', weight: 'semibold' }),
              padding({ horizontal: 3, vertical: 2 }),
            ]}
          />
        )}
      </HStack>
    </VStack>
  );
});

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
