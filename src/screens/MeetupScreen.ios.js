import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import RNText from '../components/AppText';
import PlacePhoto from '../components/PlacePhoto';
import { Keyboard, Modal, Platform, Pressable, useColorScheme, View, Dimensions, Animated, ScrollView as RNScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import ExpoImage from '../components/CachedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import CampusMapView from '../components/CampusMapView';
import AppointmentPlacePicker from '../components/AppointmentPlacePicker';
import { Stack, useRouter } from 'expo-router';
import { BottomSheet, ContentUnavailableView, DatePicker, Form, Host, HStack, Image, Picker, ScrollView, RNHostView, Section, Spacer, TextField, useNativeState, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, controlSize, datePickerStyle, foregroundStyle, frame, labelStyle, lineLimit, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollDismissesKeyboard, scrollIndicators, shadow, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppFeed, useAppProfile } from '../context/AppContext';
import PartyFinderSection, { sortAndRefitMeetups } from '../components/PartyFinderSection';
import PartyFinderEntry from '../components/PartyFinderEntry';
import usePartyFeed from '../hooks/usePartyFeed';
import { approvePartyRequest, cancelParty, createParty, rejectPartyRequest, requestJoinParty, withdrawPartyRequest } from '../services/partyService';
import { preparePartyApproval } from '../services/groupChatEncryption';
import { useConfirm } from '../context/ConfirmContext';

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

const usePalette = useNativePalette;

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });
const insetShape = shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' });

export default function MeetupScreen({ onToast, partyOnly = false, targetPartyId = null }) {
  const router = useRouter();
  const palette = usePalette();
  const { confirm } = useConfirm();
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  // IPadAspectFrame in app/_layout.js clamps the screen layout canvas to 390pt on iPad
  const isIPadFrame = Platform.OS === 'ios' && Platform.isPad && windowWidth > 430;
  const layoutWidth = isIPadFrame ? 390 : windowWidth;
  const bannerWidth = layoutWidth - 40;
  const { campusSpots = [], selectedMeetup } = useAppFeed();
  const { profile: myProfile } = useAppProfile();
  const { chooseMeetup, updateMeetupSchedule, clearMeetup } = useAppActions();
  const { parties: feedParties, loading: partiesLoading, error: partiesError, retryLegacyActivation, loadMore: loadMoreParties, loadMoreRequests, hasMore: hasMoreParties, loadingMore: loadingMoreParties, retry: retryParties } = usePartyFeed(partyOnly ? myProfile : null, campusSpots, null, targetPartyId);
  const [partyClock, setPartyClock] = useState(Date.now());
  useEffect(() => {
    if (!partyOnly) return undefined;
    const timer = setInterval(() => setPartyClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [partyOnly]);
  const parties = useMemo(() => sortAndRefitMeetups(feedParties || [], new Date(partyClock)), [feedParties, partyClock]);
  const [busyPartyId, setBusyPartyId] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [query, setQuery] = useState('');

  // Schedule BottomSheet state
  const [showSchedule, setShowSchedule] = useState(false);
  const [placePickerVisible, setPlacePickerVisible] = useState(false);
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

  const handleJoinParty = useCallback(async (party) => {
    if (!party) return;
    setBusyPartyId(party.id);
    try {
      await requestJoinParty(party.id);
      onToast?.('ส่งคำขอเข้าร่วมแล้ว รอเจ้าของตี้อนุมัติ');
    } catch (err) {
      onToast?.('ส่งคำขอเข้าร่วมตี้ไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setBusyPartyId(null);
    }
  }, [onToast]);

  const handleApprove = useCallback(async (party, entry) => {
    setBusyPartyId(party.id);
    try {
      const grants = await preparePartyApproval(party, entry.requesterId);
      await approvePartyRequest(party.id, entry.requesterId, grants);
      onToast?.('อนุมัติแล้ว แชตกลุ่มพร้อมใช้งาน');
    } catch (error) { onToast?.(error?.message || 'อนุมัติไม่สำเร็จ', 'info'); }
    finally { setBusyPartyId(null); }
  }, [onToast]);

  const handleReject = useCallback(async (party, entry) => {
    setBusyPartyId(party.id);
    try { await rejectPartyRequest(party.id, entry.requesterId); }
    catch { onToast?.('ปฏิเสธคำขอไม่สำเร็จ', 'info'); }
    finally { setBusyPartyId(null); }
  }, [onToast]);

  const handleWithdraw = useCallback(async (party) => {
    setBusyPartyId(party.id);
    try { await withdrawPartyRequest(party.id); }
    catch { onToast?.('ถอนคำขอไม่สำเร็จ', 'info'); }
    finally { setBusyPartyId(null); }
  }, [onToast]);

  const handleCancelParty = useCallback(async (party) => {
    const accepted = await confirm({
      title: 'ยกเลิกตี้', body: 'สมาชิกจะไม่สามารถส่งคำขอเข้าร่วมตี้นี้ได้อีก',
      cancelLabel: 'กลับ', confirmLabel: 'ยกเลิกตี้', icon: 'xmark.circle.fill',
    });
    if (!accepted) return;
    setBusyPartyId(party.id);
    try { await cancelParty(party.id); onToast?.('ยกเลิกตี้แล้ว'); }
    catch (reason) { onToast?.(reason?.message || 'ยกเลิกตี้ไม่สำเร็จ', 'info'); }
    finally { setBusyPartyId(null); }
  }, [confirm, onToast]);

  const visibleSpots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return campusSpots.filter((spot) => {
      if (selectedCategory !== 'all' && spot.category !== selectedCategory) return false;
      if (!normalizedQuery) return true;
      return [spot.name, spot.description, spot.categoryLabel, spot.group]
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
      const location = pendingSpot?.location?.kind === 'google'
        ? { kind: 'google', placeId: pendingSpot.location.placeId }
        : { kind: 'pin', latitude: Number(pendingSpot.latitude), longitude: Number(pendingSpot.longitude), name: pendingSpot.name };
      await createParty({ location, schedule, maxPeople: schedule.maxPeople });
      const successMessage = `สร้างตี้ที่ ${pendingSpot.name} แล้ว`;
      setShowSchedule(false);
      setPendingSpot(null);
      setTimeout(() => onToast?.(successMessage), 350);
    } catch (error) {
      console.error('confirmSchedule error:', error);
      onToast?.(error?.message || 'สร้างตี้ไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
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

  const handleClear = async () => {
    const spotName = selectedMeetup?.name ? ` "${selectedMeetup.name}"` : '';
    const ok = await confirm({
      title: 'ยืนยันยกเลิกจุดนัดหมาย',
      body: `คุณต้องการยกเลิกจุดนัดหมาย${spotName} ใช่หรือไม่?`,
      cancelLabel: 'ไม่ยกเลิก',
      confirmLabel: 'ยืนยันยกเลิก',
      icon: 'mappin.slash.circle.fill',
    });
    if (!ok) return;
    try {
      await clearMeetup();
      onToast?.('ยกเลิกจุดนัดหมายแล้ว', 'info');
    } catch (error) {
      console.error('[Meetup.ios] handleClear error:', error);
      onToast?.('ยกเลิกจุดนัดหมายไม่สำเร็จ', 'info');
    }
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
      {!partyOnly && <>
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

      <View style={{ zIndex: 22, backgroundColor: palette.background, marginTop: 105, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Host colorScheme={colorScheme} seedColor={palette.coral} matchContents={{ vertical: true }} style={{ width: '100%' }}>
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
        </Host>
      </View>

      </>}
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
              padding({ top: 8, bottom: 38, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >

          {!partyOnly && <CampusHero
            bannerHeight={180}
            bannerWidth={bannerWidth}
            onOpenMap={() => openMapForSpot(selectedMeetup || visibleSpots[0])}
            selectedMeetup={selectedMeetup}
          />}

          <RNHostView matchContents={true} style={{ width: layoutWidth, marginLeft: -20, marginRight: -20 }}>
            {partyOnly ? <PartyFinderSection
        targetPartyId={targetPartyId}
        onLoadMore={loadMoreParties}
        onLoadMoreRequests={loadMoreRequests}
        hasMore={hasMoreParties}
        loadingMore={loadingMoreParties}
        onRetry={retryParties}
              parties={parties}
              loading={partiesLoading && !parties?.length}
              error={partiesError}
              busyPartyId={busyPartyId}
              onCreateParty={() => openScheduleFor(visibleSpots[0] || campusSpots[0])}
              onJoinParty={handleJoinParty}
              onWithdrawRequest={handleWithdraw}
              onApproveRequest={handleApprove}
              onRejectRequest={handleReject}
              onCancelParty={handleCancelParty}
              onRetryActivation={(party) => retryLegacyActivation(party.id)}
              onOpenChat={(party) => router.push({ pathname: '/group-chat', params: { partyId: party.id } })}
              onOpenMap={openMapForSpot}
            /> : <PartyFinderEntry />}
          </RNHostView>

          {!partyOnly && <>
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

          </>}
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
        <SafeAreaView style={{ flex: 1, backgroundColor: colorScheme === 'dark' ? '#14171B' : '#F7F7F8' }}>
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 2 }}>
            <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.18)' }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 }}>
            <SymbolView name="map.fill" size={20} tintColor={palette.coral} style={{ marginRight: 8 }} />
            <RNText style={{ fontSize: 17, fontWeight: '800', color: colorScheme === 'dark' ? '#F7F8FA' : '#25272B', letterSpacing: -0.3, textAlign: 'center' }}>
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

      <AppointmentPlacePicker
        visible={placePickerVisible}
        spots={campusSpots}
        initialSpot={pendingSpot}
        onClose={() => { setPlacePickerVisible(false); setShowSchedule(true); }}
        onSelect={(spot) => { setPendingSpot(spot); setPlacePickerVisible(false); setShowSchedule(true); }}
      />

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
            <Section header={<Text>สถานที่นัดหมาย</Text>}>
              <Button
                label={pendingSpot?.name || 'ค้นหาหรือปักหมุดบนแผนที่'}
                systemImage="mappin.and.ellipse"
                onPress={() => { setShowSchedule(false); setTimeout(() => setPlacePickerVisible(true), 250); }}
              />
            </Section>
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
  require('../assets/images/campus/DSC_5070.jpg'),
  require('../assets/images/campus/DSC_3614.jpg'),
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
            <RNScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ width: width, height: height }}
            >
              {CAMPUS_PHOTOS.map((photo, index) => (
                <View key={index} style={{ width: width, height: height }}>
                  <ExpoImage source={photo} style={{ width: width, height: height }} contentFit="cover" />
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
      spacing={10}
      modifiers={[
        padding({ all: 13 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.mintSoft, cardShape),
        shadow({ radius: 14, y: 5, color: 'rgba(0,0,0,0.1)' }),
      ]}
    >
      <HStack spacing={12} alignment="top" modifiers={[frame({ maxWidth: Infinity })]}>
        {/* รูปสถานที่ทางซ้าย */}
        <RNHostView matchContents={false} style={{ width: 94, height: 104, borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ width: 94, height: 104, position: 'relative', backgroundColor: 'rgba(0,0,0,0.06)' }}>
            <PlacePhoto
              contentFit="cover"
              recyclingKey={`selected-${meetup.id}`}
              spot={meetup}
              style={StyleSheet.absoluteFill}
              transition={0}
            />
            <View style={{ position: 'absolute', top: 5, left: 5, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.mint, alignItems: 'center', justifyContent: 'center' }}>
              <SymbolView name="checkmark" size={10} tintColor="#FFFFFF" />
            </View>
          </View>
        </RNHostView>

        {/* รายละเอียดทางขวา */}
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.mint)]}>จุดนัดหมายของคุณ</Text>
            <Spacer />
            <Button
              label="ยกเลิกจุดนัดหมาย"
              onPress={onClear}
              role="destructive"
              systemImage="xmark"
              modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('small'), labelStyle('iconOnly')]}
            />
          </HStack>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>{meetup.name}</Text>
          <HStack spacing={8}>
            {meetup.distance ? <Meta icon="location.fill" text={meetup.distance} /> : null}
            {meetup.scheduledAt ? <Meta icon="clock.fill" text={meetup.scheduledAt} /> : null}
          </HStack>
          {meetup.schedule?.date ? (
            <HStack spacing={6} modifiers={[padding({ top: 2 })]}>
              <Tag icon="calendar" text={meetup.schedule.date} />
              <Tag icon="clock.fill" text={`${meetup.schedule.startTime}–${meetup.schedule.endTime}`} />
            </HStack>
          ) : null}
        </VStack>
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
      spacing={11}
      modifiers={[
        padding({ all: 13 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(selected ? palette.mintSoft : palette.surface, cardShape),
        shadow({ radius: 14, y: 5, color: 'rgba(0,0,0,0.12)' }),
      ]}
    >
      {/* รูปสถานที่ทางซ้าย + รายละเอียดทางขวา */}
      <HStack spacing={12} alignment="top" modifiers={[frame({ maxWidth: Infinity })]}>
        {/* ทางซ้าย: รูปสถานที่ */}
        <RNHostView matchContents={false} style={{ width: 104, height: 118, borderRadius: 14, overflow: 'hidden' }}>
          <View style={{ width: 104, height: 118, position: 'relative', backgroundColor: 'rgba(0,0,0,0.06)' }}>
            <PlacePhoto
              contentFit="cover"
              recyclingKey={spot.id}
              spot={spot}
              style={StyleSheet.absoluteFill}
              transition={0}
            />
            {/* Category icon badge */}
            <View style={{ position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: accent.color, alignItems: 'center', justifyContent: 'center' }}>
              <SymbolView name={activitySymbol(spot.category)} size={11} tintColor="#FFFFFF" />
            </View>
          </View>
        </RNHostView>

        {/* ทางขวา: รายละเอียดสถานที่ */}
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
            <Text
              modifiers={[
                font({ textStyle: 'caption2', weight: 'bold' }),
                foregroundStyle(accent.color),
                padding({ horizontal: 8, vertical: 3 }),
                background(accent.soft, shapes.capsule()),
                lineLimit(1),
              ]}
            >
              {spot.categoryLabel}
            </Text>
            <Spacer />
            {spot.distance ? (
              <HStack spacing={3} alignment="center">
                <Image color={palette.coral} size={11} systemName="location.fill" />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.coral), lineLimit(1)]}>
                  {spot.distance}
                </Text>
              </HStack>
            ) : null}
          </HStack>

          <Text
            modifiers={[
              font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.text),
              lineLimit(2),
            ]}
          >
            {spot.name}
          </Text>

          {spot.description ? (
            <Text
              modifiers={[
                font({ textStyle: 'caption2', weight: 'regular' }),
                foregroundStyle(palette.secondary),
                lineLimit(2),
              ]}
            >
              {spot.description}
            </Text>
          ) : null}

        </VStack>
      </HStack>

      {/* ปุ่มกดดำเนินการด้านล่าง */}
      <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ top: 4 })]}>
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
              padding({ horizontal: 4, vertical: 2 }),
            ]}
          />
        )}
      </HStack>
    </VStack>
  );
});

function Tag({ icon, text }) {
  const palette = usePalette();
  return (
    <HStack spacing={5} modifiers={[padding({ horizontal: 9, vertical: 4 }), background(palette.blueSoft, shapes.capsule())]}>
      <Image color={palette.blue} size={11} systemName={icon} />
      <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.blue), lineLimit(1)]}>
        {text}
      </Text>
    </HStack>
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
