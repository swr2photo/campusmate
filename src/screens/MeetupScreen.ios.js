import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import RNText from '../components/AppText';
import PlacePhoto from '../components/PlacePhoto';
import PlacePreviewCard from '../components/PlacePreviewCard';
import PlaceDetailSheet from '../components/PlaceDetailSheet';
import { Keyboard, Modal, Pressable, useColorScheme, View, ScrollView as RNScrollView, useWindowDimensions, StyleSheet } from 'react-native';
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
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, controlSize, datePickerStyle, disabled, foregroundStyle, frame, fixedSize, labelStyle, lineLimit, multilineTextAlignment, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollDismissesKeyboard, scrollIndicators, shadow, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppFeed, useAppProfile } from '../context/AppContext';
import PartyFinderSection, { sortAndRefitMeetups } from '../components/PartyFinderSection';
import PartyFinderEntry from '../components/PartyFinderEntry';
import NativeTourTarget from '../components/NativeTourTarget.ios';
import { TourTarget } from '../context/AppTourContext';
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
  const tourScrollRef = useRef(null);
  const palette = usePalette();
  const { confirm } = useConfirm();
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(null);
  const layoutWidth = Math.min(measuredWidth || windowWidth, windowWidth, 760);
  const bannerWidth = layoutWidth - 40;
  const { campusSpots = [], selectedMeetup } = useAppFeed();
  const { profile: myProfile } = useAppProfile();
  const { chooseMeetup, clearMeetup } = useAppActions();
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
  const [detailSpot, setDetailSpot] = useState(null);
  const resolvedDetailSpot = detailSpot ? {
    ...detailSpot,
    ...(selectedMeetup?.id === detailSpot.id ? selectedMeetup : {}),
    ...campusSpots.find((spot) => spot.id === detailSpot.id),
    ...(selectedMeetup?.id === detailSpot.id ? { schedule: selectedMeetup.schedule, scheduledAt: selectedMeetup.scheduledAt } : {}),
  } : null;

  // Schedule BottomSheet state
  const [showSchedule, setShowSchedule] = useState(false);
  const scheduleSubmitLock = useRef(false);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
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
    if (scheduleSubmitLock.current) return;
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
    if (!pendingSpot || scheduleSubmitLock.current) return;
    if (schedEnd.getTime() <= schedStart.getTime()) {
      onToast?.('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'info');
      return;
    }
    
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
    scheduleSubmitLock.current = true;
    setScheduleSubmitting(true);
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
    } finally {
      scheduleSubmitLock.current = false;
      setScheduleSubmitting(false);
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

  return (
    <View onLayout={({ nativeEvent }) => {
      const nextWidth = nativeEvent.layout.width;
      if (nextWidth > 0) setMeasuredWidth(current => current != null && Math.abs(current - nextWidth) < 1 ? current : nextWidth);
    }} style={{ flex: 1, backgroundColor: palette.background }}>
      {!partyOnly && <>
      <View style={{ backgroundColor: palette.background, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <Host ignoreSafeArea="container" colorScheme={colorScheme} seedColor={palette.coral} matchContents={{ vertical: true }} style={{ width: '100%' }}>
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
      {partyOnly ? <TourTarget id="party-finder.list" style={{ flex: 1 }}>
        <PartyFinderSection
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
        />
      </TourTarget> : <RNScrollView
        ref={tourScrollRef}
        style={{ flex: 1, width: '100%' }}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <Host ignoreSafeArea="container" colorScheme={colorScheme} seedColor={palette.coral} matchContents={{ vertical: true }} style={{ width: '100%' }}>
          <VStack
            alignment="leading"
            spacing={16}
            modifiers={[
              padding({ top: 8, bottom: 38, horizontal: 20 }),
              frame({ width: layoutWidth, alignment: 'topLeading' }),
            ]}
          >



          {!partyOnly && <>
          <RNHostView matchContents>
            <View style={{ width: bannerWidth }}>
              <TourTarget id="meetup.party" scrollRef={tourScrollRef} scrollOffset={16}>
                <PartyFinderEntry />
              </TourTarget>
            </View>
          </RNHostView>
          {selectedMeetup && (
            <RNHostView matchContents>
              <View style={{ width: bannerWidth }}>
                <SelectedMeetup
                  meetup={{ ...selectedMeetup, ...campusSpots.find((spot) => spot.id === selectedMeetup.id) }}
                  onClear={handleClear}
                  onPress={setDetailSpot}
                />
              </View>
            </RNHostView>
          )}

          <NativeTourTarget id="meetup.spots">
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
          </NativeTourTarget>

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
            <RNHostView key={spot.id} matchContents>
              <View style={{ width: bannerWidth, alignItems: 'center' }}>
                <PlacePreviewCard spot={spot} selected={selectedMeetup?.id === spot.id} onPress={setDetailSpot} />
              </View>
            </RNHostView>
          )) : (
            <VStack
              alignment="center"
              spacing={12}
              modifiers={[
                padding({ vertical: 36, horizontal: 20 }),
                frame({ maxWidth: Infinity }),
                background(palette.surface, cardShape),
              ]}
            >
              <Image
                color={palette.secondary}
                size={42}
                systemName="mappin.slash.circle.fill"
              />
              <Text
                modifiers={[
                  font({ size: 18, weight: 'bold' }),
                  foregroundStyle(palette.text),
                  multilineTextAlignment('center'),
                ]}
              >
                ยังไม่มีสถานที่ในหมวดนี้
              </Text>
              <Text
                modifiers={[
                  font({ size: 14, weight: 'regular' }),
                  foregroundStyle(palette.secondary),
                  multilineTextAlignment('center'),
                ]}
              >
                ลองเลือกหมวดกิจกรรมอื่นเพื่อดูสถานที่เพิ่มเติม
              </Text>
            </VStack>
          )}

          </>}
        </VStack>
        </Host>
      </RNScrollView>}

      <PlaceDetailSheet
        spot={resolvedDetailSpot}
        visible={Boolean(detailSpot)}
        selected={Boolean(detailSpot && selectedMeetup?.id === detailSpot.id)}
        onClose={() => setDetailSpot(null)}
        onSchedule={openScheduleFor}
        onChoose={handleQuickChoose}
        onOpenMap={openMapForSpot}
      />

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
          <Form modifiers={[disabled(scheduleSubmitting)]}>
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
              <TextField text={messageState} placeholder="ประกาศ เช่น หาเพื่อนไปวิ่งครับ" axis="vertical" modifiers={[lineLimit(3), fixedSize({ horizontal: false, vertical: true })]} />
            </Section>
          </Form>
          <Button
            label={scheduleSubmitting ? 'กำลังสร้างกิจกรรม…' : 'ยืนยันนัดหมาย'}
            onPress={confirmSchedule}
            systemImage="checkmark.circle.fill"
            modifiers={[
              disabled(scheduleSubmitting || !pendingSpot || schedEnd.getTime() <= schedStart.getTime()),
              buttonStyle('glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
              tint(palette.primary),
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


function CampusHero({ bannerHeight, bannerWidth, onOpenMap, selectedMeetup }) {
  const palette = usePalette();
  const { width: windowWidth } = useWindowDimensions();
  const maxWidth = Math.max(0, Math.min(windowWidth, 760) - 40);
  const width = Math.min(bannerWidth || maxWidth, maxWidth);
  const height = bannerHeight || Math.round(width * 9 / 16);


  
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

function SelectedMeetup({ meetup, onClear, onPress }) {
  const palette = usePalette();
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <RNText style={{ color: palette.mint, fontSize: 13, fontWeight: '600' }}>จุดนัดหมายของคุณ</RNText>
      <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกจุดนัดหมาย" onPress={onClear} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <SymbolView name="xmark" size={16} tintColor={palette.secondary} />
      </Pressable>
    </View>
    <PlacePreviewCard spot={meetup} selected onPress={onPress} />
  </View>;
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
