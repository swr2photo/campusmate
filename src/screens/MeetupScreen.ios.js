import { Pressable } from '../components/NativePressable';
import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import RNText from '../components/AppText';
import PlacePreviewCard from '../components/PlacePreviewCard';
import PlaceDetailSheet from '../components/PlaceDetailSheet';
import ActivityCategoryChips from '../components/activities/ActivityCategoryChips';
import ActivitiesEmptyState from '../components/activities/ActivitiesEmptyState';
import ActivitySectionTitle from '../components/activities/ActivitySectionTitle';
import NearbySpotsCarousel from '../components/activities/NearbySpotsCarousel';
import { SPOT_CATEGORIES, countByCategory } from '../components/activities/categories';
import { StaggerIn } from '../components/activities/motion';
import { Keyboard, Modal, Platform, useColorScheme, View, ScrollView as RNScrollView, useWindowDimensions, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import CampusMapView from '../components/CampusMapView';
import AppointmentPlacePicker from '../components/AppointmentPlacePicker';
import { Stack, useRouter } from 'expo-router';
import { BottomSheet, ContentUnavailableView, DatePicker, Form, Group, Host, HStack, Image, Picker, ScrollView, RNHostView, Section, Spacer, TextField, useNativeState, VStack, ZStack } from '@expo/ui/swift-ui';
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
import { buildPartySchedule, defaultScheduleWindow } from '../utils/partySchedule';
import { useIsTabPreview } from '../context/TabPreviewContext';

// The first few spots get large carousel cards when there are enough to browse.
const FEATURED_MIN = 4;
const FEATURED_COUNT = 5;

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


export default function MeetupScreen({ onToast, partyOnly = false, targetPartyId = null }) {
  const router = useRouter();
  const isTabPreview = useIsTabPreview();
  const tourScrollRef = useRef(null);
  const palette = usePalette();
  const { confirm } = useConfirm();
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = (Platform.OS === 'ios' && Boolean(Platform.isPad)) || windowWidth >= 700;
  const [measuredWidth, setMeasuredWidth] = useState(null);
  const layoutWidth = Math.min(measuredWidth || windowWidth, windowWidth, isTablet ? 1040 : 920);
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
  const filteredParties = useMemo(() => {
    if (!query.trim()) return parties;
    const q = query.trim().toLowerCase();
    return parties.filter((p) => {
      const locationName = p.location?.name || '';
      const creatorName = p.creator?.name || '';
      const note = p.schedule?.note || '';
      return (
        locationName.toLowerCase().includes(q) ||
        creatorName.toLowerCase().includes(q) ||
        note.toLowerCase().includes(q)
      );
    });
  }, [parties, query]);
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
  const initialWindow = useMemo(() => defaultScheduleWindow(), []);
  const [schedDate, setSchedDate] = useState(() => initialWindow.date);
  const [schedStart, setSchedStart] = useState(() => initialWindow.start);
  const [schedEnd, setSchedEnd] = useState(() => initialWindow.end);
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

  const contentPadding = isTablet ? 24 : 20;
  const categoryCounts = useMemo(() => countByCategory(campusSpots), [campusSpots]);
  // Distances exist only when the profile has a location; without them the
  // carousel must not claim to show what is nearest.
  const hasDistance = visibleSpots.some((spot) => Number.isFinite(spot.distanceKm));
  const featuredSpots = !query.trim() && visibleSpots.length >= FEATURED_MIN ? visibleSpots.slice(0, FEATURED_COUNT) : [];
  const listSpots = featuredSpots.length ? visibleSpots.slice(featuredSpots.length) : visibleSpots;

  const openMapForSpot = useCallback((spot) => {
    setMapTargetSpot(spot || selectedMeetup || visibleSpots[0]);
    setIsMapMounted(true);
    setShowMapModal(true);
  }, [selectedMeetup, visibleSpots]);

  const openScheduleFor = useCallback((spot) => {
    if (scheduleSubmitLock.current) return;
    setPendingSpot(spot);
    const win = defaultScheduleWindow();
    setSchedDate(win.date);
    setSchedStart(win.start);
    setSchedEnd(win.end);
    maxPeopleState.set('2');
    messageState.set('');
    setShowSchedule(true);
  }, [maxPeopleState, messageState]);

  const confirmSchedule = async () => {
    if (!pendingSpot || scheduleSubmitLock.current) return;
    const scheduleValidation = buildPartySchedule({
      day: schedDate,
      start: schedStart,
      end: schedEnd,
    });
    if (!scheduleValidation.ok) {
      onToast?.(scheduleValidation.message, 'info');
      return;
    }
    
    const schedule = { 
      ...scheduleValidation.schedule,
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
      {/* Native UISearchController + bar button (system Liquid Glass on iOS 26+).
          Skipped when this screen is a neighbour-tab preview inside Messages or
          Profile: there they attached to that tab's navigation bar (the stray
          search field and map button). The map stays reachable from the map
          card, place details and party cards. */}
      {isTabPreview ? null : (
        <>
          <Stack.SearchBar
            autoCapitalize="none"
            cancelButtonText="ยกเลิก"
            hideWhenScrolling
            onCancelButtonPress={() => setQuery('')}
            onChangeText={(event) => setQuery(event.nativeEvent.text)}
            placeholder={partyOnly ? 'ค้นหากิจกรรมหรือสถานที่ตี้' : 'ค้นหาสถานที่หรือกิจกรรม'}
            placement="stacked"
            textColor={palette.text}
            tintColor={palette.accent}
          />
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button accessibilityLabel="สร้างกิจกรรม" icon="plus" onPress={() => openScheduleFor(visibleSpots[0] || campusSpots[0])} />
          </Stack.Toolbar>
        </>
      )}
      {partyOnly ? <TourTarget id="party-finder.list" style={{ flex: 1 }}>
        <PartyFinderSection
          targetPartyId={targetPartyId}
          onLoadMore={loadMoreParties}
          onLoadMoreRequests={loadMoreRequests}
          hasMore={hasMoreParties}
          loadingMore={loadingMoreParties}
          onRetry={retryParties}
          parties={filteredParties}
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
          contentContainerStyle={{ paddingTop: 12 }}
        />
      </TourTarget> : <RNScrollView
        ref={tourScrollRef}
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={{
          alignSelf: 'center',
          maxWidth: isTablet ? 1040 : undefined,
          paddingBottom: 80,
          paddingHorizontal: contentPadding,
          paddingTop: 12,
          width: '100%',
        }}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
      >
        {!partyOnly && (
          <View style={{ gap: 18 }}>
            <StaggerIn index={0}>
              <TourTarget id="meetup.party" scrollRef={tourScrollRef} scrollOffset={16}>
                <PartyFinderEntry onCreateParty={() => openScheduleFor(visibleSpots[0] || campusSpots[0])} />
              </TourTarget>
            </StaggerIn>

            {selectedMeetup && (
              <StaggerIn index={1}>
                <SelectedMeetup
                  meetup={{ ...selectedMeetup, ...campusSpots.find((spot) => spot.id === selectedMeetup.id) }}
                  onClear={handleClear}
                  onPress={setDetailSpot}
                />
              </StaggerIn>
            )}

            <View style={{ gap: 12 }}>
              <TourTarget id="meetup.spots">
                <ActivitySectionTitle
                  icon="mappin.and.ellipse"
                  iconColor={palette.coral}
                  subtitle={hasDistance ? 'สถานที่จริงใน ม.อ. เรียงจากใกล้ไปไกล' : 'สถานที่จริงใน ม.อ.'}
                  title="เลือกกิจกรรมที่สนใจ"
                />
              </TourTarget>
              <ActivityCategoryChips
                bleed={contentPadding}
                categories={SPOT_CATEGORIES}
                counts={categoryCounts}
                onSelect={setSelectedCategory}
                selected={selectedCategory}
              />
            </View>

            {featuredSpots.length ? (
              <View style={{ gap: 12 }}>
                <ActivitySectionTitle
                  icon={hasDistance ? 'location.fill' : 'sparkles'}
                  iconColor={palette.coral}
                  title={hasDistance ? 'ใกล้คุณที่สุด' : 'สถานที่แนะนำ'}
                  trailing={`${featuredSpots.length} แห่ง`}
                />
                <NearbySpotsCarousel
                  bleed={contentPadding}
                  key={selectedCategory}
                  onPress={setDetailSpot}
                  selectedId={selectedMeetup?.id}
                  spots={featuredSpots}
                  width={layoutWidth}
                />
              </View>
            ) : null}

            {listSpots.length ? (
              <View style={{ gap: 12 }}>
                <ActivitySectionTitle
                  title={featuredSpots.length ? 'สถานที่อื่น ๆ' : 'จุดนัดพบแนะนำ'}
                  trailing={`${listSpots.length} แห่ง${hasDistance ? ' · ใกล้สุดก่อน' : ''}`}
                />
                <View style={[
                  { gap: 12 },
                  isTablet && { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
                ]}>
                  {listSpots.map((spot, index) => (
                    <StaggerIn index={index} key={`${selectedCategory}:${spot.id}`} style={isTablet ? { width: '48.8%' } : { width: '100%' }}>
                      <PlacePreviewCard
                        spot={spot}
                        selected={selectedMeetup?.id === spot.id}
                        onPress={setDetailSpot}
                      />
                    </StaggerIn>
                  ))}
                </View>
              </View>
            ) : null}

            {!visibleSpots.length ? (
              <ActivitiesEmptyState
                onShowAll={selectedCategory !== 'all' ? () => setSelectedCategory('all') : null}
                searching={Boolean(query.trim())}
              />
            ) : null}
          </View>
        )}
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
      >
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
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
        </Group>
      </BottomSheet>

      </Host>
    </View>
  );
}

function SelectedMeetup({ meetup, onClear, onPress }) {
  const palette = usePalette();
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1 }}>
        <ActivitySectionTitle icon="checkmark.circle.fill" iconColor={palette.mint} title="จุดนัดหมายของคุณ" />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกจุดนัดหมาย" onPress={onClear} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.chip }}>
          <SymbolView name="xmark" size={13} tintColor={palette.secondary} />
        </View>
      </Pressable>
    </View>
    <PlacePreviewCard spot={meetup} selected onPress={onPress} />
  </View>;
}
