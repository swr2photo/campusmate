import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import PlacePhoto from '../components/PlacePhoto';
import PlacePreviewCard from '../components/PlacePreviewCard';
import PlaceDetailSheet from '../components/PlaceDetailSheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, TouchableWithoutFeedback, useWindowDimensions, View } from 'react-native';
import Image from '../components/CachedImage';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { project, rubberband } from '../utils/motion';
import { LinearGradient } from 'expo-linear-gradient';
import { DatePickerDialog, Host, TimePickerDialog } from '../components/Pickers';
import { useRouter } from 'expo-router';
import { useAppActions, useAppFeed, useAppProfile } from '../context/AppContext';
import PartyFinderSection, { sortAndRefitMeetups } from '../components/PartyFinderSection';
import PartyFinderEntry from '../components/PartyFinderEntry';
import usePartyFeed from '../hooks/usePartyFeed';
import { approvePartyRequest, cancelParty, createParty, rejectPartyRequest, requestJoinParty, withdrawPartyRequest } from '../services/partyService';
import { preparePartyApproval } from '../services/groupChatEncryption';
import { useConfirm } from '../context/ConfirmContext';
import CampusMapView from '../components/CampusMapView';
import AppointmentPlacePicker from '../components/AppointmentPlacePicker';
import {
  IosLikeCard,
  IosLikePill,
  IosLikeScreen,
  IosLikeSectionTitle,
  IconButton,
} from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';
import { TourTarget } from '../context/AppTourContext';

const SPOT_CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', icon: 'square.grid.2x2.fill', color: '#5B5CE2' },
  { id: 'sports', label: 'สนามกีฬา', icon: 'sportscourt.fill', color: '#FF9F43' },
  { id: 'chill', label: 'โซนนั่งเล่น', icon: 'leaf.fill', color: '#18A878' },
  { id: 'cafe', label: 'คาเฟ่', icon: 'cup.and.saucer.fill', color: '#F47C6B' },
  { id: 'study', label: 'โซนอ่านหนังสือ', icon: 'book.closed.fill', color: '#3986E8' },
  { id: 'running', label: 'วิ่งออกกำลัง', icon: 'figure.run', color: '#FF7A6B' },
  { id: 'gym', label: 'ยิม/ฟิตเนส', icon: 'dumbbell.fill', color: '#9A8CFF' },
];

function formatLocalDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateValueToDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (year && month && day) return new Date(year, month - 1, day, 12, 0, 0, 0);
  const fallback = new Date();
  fallback.setHours(12, 0, 0, 0);
  return fallback;
}

function dateTimeValueToDate(dateValue, timeValue) {
  const date = dateValueToDate(dateValue);
  const [hour, minute] = String(timeValue || '').split(':').map(Number);
  date.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
  return date;
}

function formatTimeValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function timeValueToMinutes(value) {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function minutesToTimeValue(minutes) {
  const safeMinutes = Math.max(0, Math.min(minutes, (24 * 60) - 1));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, '0')}:${String(safeMinutes % 60).padStart(2, '0')}`;
}

const CAMPUS_PHOTOS = [
  require('../assets/images/campus/DSC_5070.jpg'),
  require('../assets/images/campus/DSC_3614.jpg'),
  require('../assets/images/campus/DSC_5071.jpg'),
  require('../assets/images/campus/DSC_8697.jpg'),
];


function getNextDays(count = 7) {
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const result = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < count; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const iso = formatLocalDateValue(date);
    const label = i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
    result.push({ value: iso, label });
  }
  return result;
}

function matchesSpotQuery(spot, query) {
  if (!query) return true;
  return [spot.name, spot.description, spot.categoryLabel, spot.group]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export default function MeetupScreen({ onToast, partyOnly = false, targetPartyId = null }) {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { confirm } = useConfirm();
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
  const [searchQuery, setSearchQuery] = useState('');
  const [detailSpot, setDetailSpot] = useState(null);
  const [mapTargetSpot, setMapTargetSpot] = useState(null);
  const [mapModal, setMapModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const scheduleSubmitLock = useRef(false);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [placePickerVisible, setPlacePickerVisible] = useState(false);
  const [pendingSpot, setPendingSpot] = useState(null);
  const [schedDate, setSchedDate] = useState(null);
  const [schedStart, setSchedStart] = useState('14:00');
  const [schedEnd, setSchedEnd] = useState('16:00');
  const [maxPeople, setMaxPeople] = useState('2');
  const [message, setMessage] = useState('');

  const nextDays = useMemo(() => getNextDays(7), []);
  const selectedSpot = useMemo(() => {
    if (!selectedMeetup) return null;
    return {
      ...selectedMeetup,
      ...campusSpots.find((spot) => spot.id === selectedMeetup.id),
      schedule: selectedMeetup.schedule,
      scheduledAt: selectedMeetup.scheduledAt,
    };
  }, [campusSpots, selectedMeetup]);
  const placeDetailSpot = useMemo(() => (
    detailSpot && selectedSpot?.id === detailSpot.id
      ? { ...detailSpot, ...selectedSpot }
      : detailSpot
  ), [detailSpot, selectedSpot]);

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
    } catch (error) {
      onToast?.(error?.message || 'อนุมัติไม่สำเร็จ กรุณาลองอีกครั้ง', 'info');
    } finally { setBusyPartyId(null); }
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
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return campusSpots.filter((spot) => (
      (selectedCategory === 'all' || spot.category === selectedCategory)
      && matchesSpotQuery(spot, normalizedQuery)
    ));
  }, [campusSpots, searchQuery, selectedCategory]);

  const openMapForSpot = useCallback((spot) => {
    setMapTargetSpot(spot || selectedMeetup || visibleSpots[0] || null);
    setMapModal(true);
  }, [selectedMeetup, visibleSpots]);

  const openScheduleFor = useCallback((spot) => {
    if (scheduleSubmitLock.current) return;
    const savedDate = spot?.schedule?.date || selectedMeetup?.schedule?.date;
    setPendingSpot(spot);
    setSchedDate(nextDays.some((day) => day.value === savedDate) ? savedDate : nextDays[0].value);
    setSchedStart(spot?.schedule?.startTime || selectedMeetup?.schedule?.startTime || '14:00');
    setSchedEnd(spot?.schedule?.endTime || selectedMeetup?.schedule?.endTime || '16:00');
    setMaxPeople(String(spot?.schedule?.maxPeople || selectedMeetup?.schedule?.maxPeople || 2));
    setMessage(spot?.schedule?.message || selectedMeetup?.schedule?.message || '');
    setScheduleModal(true);
  }, [nextDays, selectedMeetup]);

  const confirmSchedule = async () => {
    if (scheduleSubmitLock.current) return;
    console.log('[MeetupScreen] confirmSchedule called', { pendingSpotName: pendingSpot?.name, schedDate, schedStart, schedEnd, maxPeople });
    if (!pendingSpot || !schedDate) {
      console.warn('[MeetupScreen] confirmSchedule missing pendingSpot or schedDate', { pendingSpot, schedDate });
      return;
    }
    if (timeValueToMinutes(schedEnd) <= timeValueToMinutes(schedStart)) {
      onToast?.('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'info');
      return;
    }
    const schedule = {
      date: schedDate,
      startTime: schedStart,
      endTime: schedEnd,
      maxPeople: parseInt(maxPeople, 10) || 2,
      message: message.trim(),
    };
    scheduleSubmitLock.current = true;
    setScheduleSubmitting(true);
    try {
      const location = pendingSpot?.location?.kind === 'google'
        ? { kind: 'google', placeId: pendingSpot.location.placeId }
        : { kind: 'pin', latitude: Number(pendingSpot.latitude), longitude: Number(pendingSpot.longitude), name: pendingSpot.name };
      console.log('[MeetupScreen] calling createParty with:', { location, schedule, maxPeople: schedule.maxPeople });
      const res = await createParty({ location, schedule, maxPeople: schedule.maxPeople });
      console.log('[MeetupScreen] createParty success:', res);
      const successMessage = `สร้างตี้ที่ ${pendingSpot.name} แล้ว`;
      setScheduleModal(false);
      setPendingSpot(null);
      setTimeout(() => onToast?.(successMessage), 350);
    } catch (error) {
      console.error('[MeetupScreen] createParty error:', error);
      onToast?.(error?.message || 'สร้างตี้ไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      scheduleSubmitLock.current = false;
      setScheduleSubmitting(false);
    }
  };

  const handleQuickChoose = useCallback(async (spot) => {
    try {
      await chooseMeetup(spot);
      onToast?.(`เลือก ${spot.name} เป็นจุดนัดหมายแล้ว`);
    } catch (error) {
      onToast?.('เลือกจุดนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
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
      console.error('[Meetup] clearMeetup error:', error);
      onToast?.('ยกเลิกจุดนัดหมายไม่สำเร็จ', 'info');
    }
  };

  const renderSpot = useCallback(({ item }) => (
    <PlacePreviewCard
      onPress={setDetailSpot}
      selected={selectedMeetup?.id === item.id}
      spot={item}
    />
  ), [selectedMeetup?.id]);

  // Lets the first-run tour scroll the hero / party finder into view.
  const listRef = useRef(null);
  const tourScrollRef = useRef({
    scrollTo: ({ y = 0, animated = true } = {}) => listRef.current?.scrollToOffset?.({ animated, offset: y }),
  });

  const header = (
    <View>
      <TourTarget id="meetup.party" scrollRef={tourScrollRef} scrollOffset={24}>
        <PartyFinderEntry />
      </TourTarget>
      {selectedSpot ? <SelectedMeetup meetup={selectedSpot} onClear={handleClear} onPress={() => setDetailSpot(selectedSpot)} /> : null}

      <TourTarget id="meetup.spots" scrollRef={tourScrollRef} scrollOffset={30}>
        <IosLikeSectionTitle subtitle="สถานที่จริงใน มอ. เรียงจากใกล้ไปไกล" title="เลือกกิจกรรมที่สนใจ" />
      </TourTarget>
      <ScrollView contentContainerStyle={styles.categoryRow} horizontal showsHorizontalScrollIndicator={false}>
        {SPOT_CATEGORIES.map((category) => (
          <IosLikePill
            active={selectedCategory === category.id}
            color={category.color}
            icon={category.icon}
            key={category.id}
            onPress={() => setSelectedCategory(category.id)}
          >
            {category.label}
          </IosLikePill>
        ))}
      </ScrollView>
      <View style={styles.resultMeta}>
        <Text style={[styles.resultTitle, { color: colors.ink }]}>จุดนัดพบแนะนำ</Text>
        <Text style={[styles.resultCount, { color: colors.coral }]}>{visibleSpots.length} แห่ง · ใกล้สุดก่อน</Text>
      </View>
    </View>
  );

  return (
    <IosLikeScreen>
      {!partyOnly && <View style={[styles.searchSticky, { backgroundColor: colors.canvas, borderBottomColor: colors.line }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card }]}>
          <FeatureIcon color={colors.inkSoft} name="magnifyingglass" size={18} />
          <TextInput
            accessibilityLabel="ค้นหาสถานที่หรือกิจกรรม"
            autoCapitalize="none"
            keyboardAppearance={isDark ? 'dark' : 'light'}
            cursorColor={colors.primary}
            selectionColor={colors.primary}
            onChangeText={setSearchQuery}
            placeholder="ค้นหาสถานที่หรือกิจกรรม"
            placeholderTextColor={colors.inkSoft}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.ink }]}
            value={searchQuery}
          />
          {searchQuery ? <IconButton accessibilityLabel="ล้างคำค้นหา" icon="xmark.circle.fill" onPress={() => setSearchQuery('')} size={18} style={styles.clearButton} tintColor={colors.inkSoft} /> : null}
        </View>
      </View>}
      {partyOnly ? (
        <TourTarget id="party-finder.list" style={{ flex: 1 }}>
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
        </TourTarget>
      ) : <FlatList
        ref={listRef}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={visibleSpots}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={SpotSeparator}
        ListEmptyComponent={<EmptySpots query={searchQuery} />}
        ListHeaderComponent={header}
        initialNumToRender={6}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={renderSpot}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />}

      <PlaceDetailSheet
        onChoose={handleQuickChoose}
        onClose={() => setDetailSpot(null)}
        onOpenMap={openMapForSpot}
        onSchedule={openScheduleFor}
        selected={Boolean(detailSpot && selectedMeetup?.id === detailSpot.id)}
        spot={placeDetailSpot}
        visible={Boolean(detailSpot)}
      />

      <MapModal
        mapTargetSpot={mapTargetSpot}
        onClose={() => setMapModal(false)}
        onQuickChoose={(spot) => {
          void handleQuickChoose(spot);
          setMapModal(false);
        }}
        onSchedule={(spot) => {
          setMapModal(false);
          openScheduleFor(spot);
        }}
        selectedMeetup={selectedMeetup}
        spots={visibleSpots.length ? visibleSpots : campusSpots}
        visible={mapModal}
      />

      <ScheduleModal
        submitting={scheduleSubmitting}
        maxPeople={maxPeople}
        message={message}
        nextDays={nextDays}
        onClose={() => setScheduleModal(false)}
        onConfirm={() => void confirmSchedule()}
        onDate={setSchedDate}
        onEnd={(value) => setSchedEnd(value)}
        onMaxPeople={setMaxPeople}
        onMessage={setMessage}
        onStart={(value) => {
          setSchedStart(value);
          const startMinutes = timeValueToMinutes(value);
          if (startMinutes >= timeValueToMinutes(schedEnd)) {
            setSchedEnd(minutesToTimeValue(startMinutes + 60));
          }
        }}
        onSelectSpot={setPendingSpot}
        onPickPlace={() => { setScheduleModal(false); setPlacePickerVisible(true); }}
        pendingSpot={pendingSpot}
        schedDate={schedDate}
        schedEnd={schedEnd}
        schedStart={schedStart}
        spots={campusSpots}
        visible={scheduleModal}
      />
      <AppointmentPlacePicker
        visible={placePickerVisible}
        spots={campusSpots}
        initialSpot={pendingSpot}
        onClose={() => { setPlacePickerVisible(false); setScheduleModal(true); }}
        onSelect={(spot) => { setPendingSpot(spot); setPlacePickerVisible(false); setScheduleModal(true); }}
      />
    </IosLikeScreen>
  );
}

function CampusHero({ onOpenMap, selectedMeetup }) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isIPad = Platform.OS === 'ios' && Platform.isPad && windowWidth > 430;
  const layoutWidth = isIPad ? 390 : windowWidth;
  const isTablet = !isIPad && windowWidth >= 700;
  const maxContentWidth = isTablet ? Math.min(windowWidth - 64, 620) : layoutWidth;
  const heroWidth = maxContentWidth - (spacing.lg * 2);
  const heroHeight = Math.round(heroWidth * 9 / 16);


  
  return (
    <View style={[styles.hero, { backgroundColor: colors.card, width: heroWidth, height: heroHeight, alignSelf: 'center' }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: heroWidth, height: heroHeight }}
      >
        {CAMPUS_PHOTOS.map((photo, index) => (
          <View key={String(index)} style={{ width: heroWidth, height: heroHeight }}>
            <Image source={photo} style={{ width: heroWidth, height: heroHeight }} contentFit="cover" />
          </View>
        ))}
      </ScrollView>
      <LinearGradient colors={['transparent', 'rgba(8,16,30,0.55)']} style={[styles.heroGradient, { height: Math.min(90, heroHeight * 0.45) }]} />
      <View style={styles.heroCopy}>
        <View style={styles.heroTopRow}>
          <View style={[styles.heroPin, { backgroundColor: colors.coral }]}><FeatureIcon color="#FFFFFF" name="mappin.and.ellipse" size={18} /></View>
          <Pressable accessibilityRole="button" onPress={onOpenMap} style={({ pressed }) => [styles.heroMapButton, { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.24)' }, pressed && styles.pressed]}>
            <FeatureIcon color="#FFFFFF" name="map.fill" size={14} />
            <Text style={styles.heroMapText}>เปิดแผนที่</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.heroTitle}>{selectedMeetup?.name || 'มหาวิทยาลัยสงขลานครินทร์'}</Text>
        <Text numberOfLines={2} style={styles.heroSubtitle}>{selectedMeetup ? 'จุดนัดหมายล่าสุดของคุณ · แตะเพื่อดูตำแหน่งบนแผนที่' : 'ดูพิกัดจริงและสถานที่รอบตัวบนแผนที่ ม.อ.'}</Text>
      </View>
    </View>
  );
}

function SelectedMeetup({ meetup, onClear, onPress }) {
  const { colors, isDark } = useTheme();

  return (
    <IosLikeCard
      style={[
        styles.selectedCard,
        {
          backgroundColor: isDark ? 'rgba(32, 201, 151, 0.14)' : colors.mintSoft,
          borderColor: isDark ? 'rgba(32, 201, 151, 0.32)' : 'rgba(32, 201, 151, 0.28)',
        },
      ]}
    >
      <View style={styles.selectedHeader}>
        <Text style={[styles.selectedEyebrow, { color: colors.mint }]}>จุดนัดหมายของคุณ</Text>
        <IconButton
          accessibilityLabel="ยกเลิกจุดนัดหมาย"
          icon="xmark"
          onPress={onClear}
          size={14}
          style={styles.smallIconButton}
          tintColor={colors.inkMuted}
        />
      </View>
      <Pressable
        accessibilityLabel={`ดูรายละเอียด ${meetup.name}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.selectedMainRow, pressed && styles.pressed]}
      >
        <View style={[styles.selectedPhotoWrap, { backgroundColor: colors.surfaceRaised }]}>
          <PlacePhoto
            contentFit="cover"
            recyclingKey={`selected-${meetup.id}`}
            spot={meetup}
            style={StyleSheet.absoluteFill}
            transition={0}
          />
          <View style={[styles.selectedCheckBadge, { backgroundColor: colors.mint }]}>
            <FeatureIcon color="#FFFFFF" name="checkmark" size={11} />
          </View>
        </View>

        <View style={styles.selectedCopy}>
          <Text numberOfLines={2} style={[styles.selectedTitle, { color: colors.ink }]}>{meetup.name}</Text>
          <View style={styles.selectedMetaRow}>
            {meetup.distance ? (
              <View style={styles.selectedMetaChip}>
                <FeatureIcon color={colors.coral} name="location.fill" size={11} />
                <Text style={[styles.selectedMetaText, { color: colors.coral }]}>{meetup.distance}</Text>
              </View>
            ) : null}
            {meetup.scheduledAt ? (
              <View style={styles.selectedMetaChip}>
                <FeatureIcon color={colors.inkMuted} name="clock.fill" size={11} />
                <Text numberOfLines={1} style={[styles.selectedMetaText, { color: colors.inkMuted }]}>{meetup.scheduledAt}</Text>
              </View>
            ) : null}
          </View>
          {meetup.schedule?.date ? (
            <View style={styles.selectedScheduleRow}>
              <Tag icon="calendar" text={meetup.schedule.date} />
              <Tag icon="clock.fill" text={`${meetup.schedule.startTime}–${meetup.schedule.endTime}`} />
            </View>
          ) : null}
          <View style={styles.selectedDetailsHint}>
            <Text style={[styles.selectedMetaText, { color: colors.primary }]}>ดูรายละเอียดสถานที่</Text>
            <FeatureIcon color={colors.primary} name="chevron.right" size={12} />
          </View>
        </View>
      </Pressable>
    </IosLikeCard>
  );
}

function Meta({ accent = false, icon, text }) {
  const { colors } = useTheme();
  return (
    <View style={styles.metaItem}>
      <FeatureIcon color={accent ? colors.coral : colors.inkSoft} name={icon} size={13} />
      <Text numberOfLines={2} style={[styles.metaText, { color: accent ? colors.coral : colors.inkMuted }]}>{text || '—'}</Text>
    </View>
  );
}

function Tag({ icon, text }) {
  const { colors } = useTheme();
  return <View style={[styles.tag, { backgroundColor: colors.primarySoft }]}><FeatureIcon color={colors.primary} name={icon} size={12} /><Text numberOfLines={1} style={[styles.tagText, { color: colors.primary }]}>{text}</Text></View>;
}

function ActionButton({ disabled = false, emphasized = false, icon, label, onPress, tintColor }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, { backgroundColor: emphasized ? tintColor : colors.surfaceRaised, borderColor: emphasized ? tintColor : colors.line }, pressed && styles.pressed, disabled && styles.disabled]}>
      <FeatureIcon color={emphasized ? '#FFFFFF' : tintColor} name={icon} size={14} />
      <Text style={[styles.actionText, { color: emphasized ? '#FFFFFF' : tintColor }]}>{label}</Text>
    </Pressable>
  );
}

function SpotSeparator() {
  return <View style={{ height: spacing.md }} />;
}

function EmptySpots({ query }) {
  const { colors } = useTheme();
  return (
    <IosLikeCard style={styles.emptySpots}>
      <FeatureIcon color={colors.coral} name="mappin.slash.circle.fill" size={42} />
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{query ? 'ไม่พบสถานที่ที่ค้นหา' : 'ยังไม่มีสถานที่ในหมวดนี้'}</Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>ลองเปลี่ยนคำค้นหาหรือเลือกหมวดกิจกรรมอื่น</Text>
    </IosLikeCard>
  );
}

function MapModal({ mapTargetSpot, onClose, onQuickChoose, onSchedule, selectedMeetup, spots, visible }) {
  const { colors } = useTheme();
  const translateY = useSharedValue(600);
  const fadeAnim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const unlockClose = useCallback(() => {
    isClosingRef.current = false;
  }, []);

  const finishClose = useCallback(() => {
    closeRef.current?.();
    isClosingRef.current = false;
  }, []);

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    translateY.set(withSpring(700, { duration: 300, dampingRatio: 0.8 }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
      else scheduleOnRN(unlockClose);
    }));
    fadeAnim.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, finishClose, translateY, unlockClose]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.set(600);
      fadeAnim.set(0);
      translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    }
  }, [fadeAnim, translateY, visible]);

  const panGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      cancelAnimation(translateY);
      dragStartY.set(translateY.get());
      scheduleOnRN(unlockClose);
    })
    .onUpdate((event) => {
      const next = dragStartY.get() + event.translationY;
      if (next > 0) translateY.set(next);
      else translateY.set(rubberband(next, 600));
    })
    .onEnd((event) => {
      const projected = translateY.get() + project(event.velocityY);
      if (projected > 70 || event.velocityY > 500) {
        scheduleOnRN(closeWithAnimation);
      } else {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: event.velocityY }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    })
    .onFinalize((_, success) => {
      if (!success) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    }), [closeWithAnimation, dragStartY, fadeAnim, translateY, unlockClose]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  // RN Modal keeps its children mounted while hidden, which would leave the
  // map WebView running in the background.
  if (!visible) return null;

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={closeWithAnimation}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, fadeStyle]}>
          <Pressable accessibilityLabel="ปิดแผนที่" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={[
            styles.mapModalContent,
            {
              backgroundColor: colors.card,
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={panGesture}>
          <View
            accessibilityHint="ลากลงเพื่อปิดแผนที่"
            style={styles.sheetHeaderDraggable}
          >
            <View style={[styles.modalHandle, { backgroundColor: colors.line }]} />
            <View style={styles.modalHeader}>
              <FeatureIcon color={colors.coral} name="map.fill" size={19} />
              <Text numberOfLines={1} style={[styles.modalTitle, { color: colors.ink }]}>แผนที่วิทยาเขต ม.อ. หาดใหญ่</Text>
            </View>
          </View>
          </GestureDetector>
          <View style={styles.mapFrame}>
            <CampusMapView
              spots={spots}
              selectedSpot={mapTargetSpot || selectedMeetup}
              onSelectSpot={onQuickChoose}
              onScheduleSpot={onSchedule}
              height="100%"
            />
          </View>
        </Animated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ScheduleModal({ submitting = false, maxPeople, message, nextDays, onClose, onConfirm, onDate, onEnd, onMaxPeople, onMessage, onPickPlace, onSelectSpot, onStart, pendingSpot, schedDate, schedEnd, schedStart, spots = [], visible }) {
  const { colors, isDark } = useTheme();
  const [activePicker, setActivePicker] = useState(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const selectedDay = nextDays.find((day) => day.value === schedDate);
  const validTimeRange = timeValueToMinutes(schedEnd) > timeValueToMinutes(schedStart);
  const selectableDates = {
    start: dateValueToDate(nextDays[0]?.value),
    end: dateValueToDate(nextDays[nextDays.length - 1]?.value),
  };

  const translateY = useSharedValue(600);
  const fadeAnim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const unlockClose = useCallback(() => {
    isClosingRef.current = false;
  }, []);

  const finishClose = useCallback(() => {
    closeRef.current?.();
    isClosingRef.current = false;
  }, []);

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setActivePicker(null);
    Keyboard.dismiss();
    translateY.set(withSpring(700, { duration: 300, dampingRatio: 0.8 }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
      else scheduleOnRN(unlockClose);
    }));
    fadeAnim.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, finishClose, translateY, unlockClose]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.set(600);
      fadeAnim.set(0);
      translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    } else {
      setKeyboardOffset(0);
    }
  }, [fadeAnim, translateY, visible]);

  // Lift the sheet with keyboard height instead of shrinking the container
  // (KeyboardAvoidingView behavior="height" made the top edge slide down).
  useEffect(() => {
    if (!visible) return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardOffset(Math.max(0, event?.endCoordinates?.height || 0));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(keyboardOffset <= 0 && !submitting)
    .onStart(() => {
      cancelAnimation(translateY);
      dragStartY.set(translateY.get());
      scheduleOnRN(unlockClose);
    })
    .onUpdate((event) => {
      const next = dragStartY.get() + event.translationY;
      if (next > 0) translateY.set(next);
      else translateY.set(rubberband(next, 600));
    })
    .onEnd((event) => {
      const projected = translateY.get() + project(event.velocityY);
      if (projected > 70 || event.velocityY > 500) {
        scheduleOnRN(closeWithAnimation);
      } else {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: event.velocityY }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    })
    .onFinalize((_, success) => {
      if (!success) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    }), [closeWithAnimation, dragStartY, fadeAnim, keyboardOffset, submitting, translateY, unlockClose]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={submitting ? () => {} : closeWithAnimation}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, fadeStyle]}>
          <Pressable disabled={submitting} accessibilityLabel="ปิดหน้าต่างนัดหมาย" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <View style={[styles.scheduleKeyboardAvoiding, { paddingBottom: keyboardOffset }]}>
          <Animated.View
            style={[
              styles.scheduleModalContent,
              {
                backgroundColor: colors.card,
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={panGesture}>
            <View
              accessibilityHint="ลากลงเพื่อปิดหน้านัดหมาย"
              style={styles.sheetHeaderDraggable}
            >
              <View style={[styles.modalHandle, { backgroundColor: colors.line }]} />
              <Text numberOfLines={1} style={[styles.modalTitle, { color: colors.ink }]}>ตั้งวันเวลานัดหมาย</Text>
              {pendingSpot ? (
                <View style={styles.modalSpot}>
                  <FeatureIcon color={colors.coral} name="mappin.and.ellipse" size={15} />
                  <Text numberOfLines={1} style={[styles.modalSpotName, { color: colors.coral }]}>{pendingSpot.name}</Text>
                </View>
              ) : null}
            </View>
            </GestureDetector>
            <ScrollView
              pointerEvents={submitting ? 'none' : 'auto'}
              contentContainerStyle={styles.scheduleScroll}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <PickerLabel icon="mappin.and.ellipse" label="สถานที่นัดหมาย" />
              <PickerField icon="map.fill" label="ค้นหาหรือปักหมุดบนแผนที่" onPress={onPickPlace} value={pendingSpot?.name || 'เลือกสถานที่'} />
              {spots && spots.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalSpotSelectorScroll}>
                  {spots.slice(0, 10).map((spot) => {
                    const isSelected = pendingSpot?.id === spot.id;
                    return (
                      <Pressable
                        key={spot.id}
                        onPress={() => onSelectSpot?.(spot)}
                        style={[
                          styles.modalSpotChip,
                          {
                            backgroundColor: isSelected ? colors.primarySoft : colors.surfaceRaised,
                            borderColor: isSelected ? colors.primary : colors.line,
                          },
                        ]}
                      >
                        <FeatureIcon name="mappin.circle.fill" size={13} color={isSelected ? colors.primary : colors.inkMuted} />
                        <Text style={[styles.modalSpotChipText, { color: isSelected ? colors.primary : colors.ink }]} numberOfLines={1}>
                          {spot.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <PickerLabel icon="calendar" label="เลือกวัน" />
              <PickerField icon="calendar" label="วันที่นัดหมาย" onPress={() => setActivePicker('date')} value={selectedDay?.label || schedDate || 'เลือกวัน'} />

              <PickerLabel icon="clock.fill" label="เลือกเวลา" />
              <View style={styles.timePickerRow}>
                <PickerField compact icon="clock.fill" label="เวลาเริ่ม" onPress={() => setActivePicker('start')} value={schedStart} />
                <PickerField compact icon="clock.fill" label="เวลาสิ้นสุด" onPress={() => setActivePicker('end')} value={schedEnd} />
              </View>
              {!validTimeRange ? <View style={[styles.timeError, { backgroundColor: colors.dangerSoft }]}><FeatureIcon color={colors.danger} name="exclamationmark.circle.fill" size={14} /><Text style={[styles.timeErrorText, { color: colors.danger }]}>เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม</Text></View> : null}

              <PickerLabel icon="person.2.fill" label="จำนวนคน (รวมตัวเอง)" />
              <TextInput keyboardAppearance={isDark ? 'dark' : 'light'} cursorColor={colors.primary} selectionColor={colors.primary} keyboardType="number-pad" onChangeText={onMaxPeople} placeholder="เช่น 2, 4" placeholderTextColor={colors.inkSoft} style={[styles.textInput, { backgroundColor: colors.surfaceRaised, color: colors.ink }]} value={maxPeople} />
              <PickerLabel icon="text.bubble.fill" label="ประกาศ/รายละเอียด" />
              <TextInput keyboardAppearance={isDark ? 'dark' : 'light'} cursorColor={colors.primary} selectionColor={colors.primary} multiline numberOfLines={3} onChangeText={onMessage} placeholder="เช่น หาเพื่อนไปวิ่งครับ" placeholderTextColor={colors.inkSoft} style={[styles.textInput, styles.textArea, { backgroundColor: colors.surfaceRaised, color: colors.ink }]} textAlignVertical="top" value={message} />
              <View style={[styles.summaryBox, { backgroundColor: validTimeRange ? colors.coralSoft : colors.dangerSoft }]}><Text style={[styles.summaryText, { color: validTimeRange ? colors.coral : colors.danger }]}>{selectedDay?.label || '—'} · {schedStart}–{schedEnd}</Text></View>
            </ScrollView>
            <View style={styles.modalActions}>
              <ActionButton disabled={submitting || !pendingSpot || !validTimeRange} emphasized icon="checkmark.circle.fill" label={submitting ? 'กำลังสร้างกิจกรรม…' : 'ยืนยันนัดหมาย'} onPress={onConfirm} tintColor={colors.primary} />
              <Pressable disabled={submitting} accessibilityRole="button" accessibilityState={{ disabled: submitting }} onPress={closeWithAnimation} style={({ pressed }) => [styles.cancelModalButton, { borderColor: colors.line }, pressed && styles.pressed, submitting && styles.disabled]}>
                <Text style={[styles.cancelModalText, { color: colors.inkMuted }]}>ยกเลิก</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </View>
      {visible && activePicker === 'date' ? (
        <Host colorScheme={isDark ? 'dark' : 'light'}>
          <DatePickerDialog
            color={colors.coral}
            confirmButtonLabel="ตกลง"
            dismissButtonLabel="ยกเลิก"
            initialDate={dateValueToDate(schedDate).toISOString()}
            onDateSelected={(date) => {
              onDate(formatLocalDateValue(date));
              setActivePicker(null);
            }}
            onDismissRequest={() => setActivePicker(null)}
            selectableDates={selectableDates}
            showVariantToggle={false}
            variant="picker"
          />
        </Host>
      ) : null}
      {visible && activePicker === 'start' ? (
        <Host colorScheme={isDark ? 'dark' : 'light'}>
          <TimePickerDialog
            color={colors.coral}
            confirmButtonLabel="ตกลง"
            dismissButtonLabel="ยกเลิก"
            initialDate={dateTimeValueToDate(schedDate, schedStart).toISOString()}
            is24Hour
            onDateSelected={(date) => {
              onStart(formatTimeValue(date));
              setActivePicker(null);
            }}
            onDismissRequest={() => setActivePicker(null)}
          />
        </Host>
      ) : null}
      {visible && activePicker === 'end' ? (
        <Host colorScheme={isDark ? 'dark' : 'light'}>
          <TimePickerDialog
            color={colors.coral}
            confirmButtonLabel="ตกลง"
            dismissButtonLabel="ยกเลิก"
            initialDate={dateTimeValueToDate(schedDate, schedEnd).toISOString()}
            is24Hour
            onDateSelected={(date) => {
              onEnd(formatTimeValue(date));
              setActivePicker(null);
            }}
            onDismissRequest={() => setActivePicker(null)}
          />
        </Host>
      ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function PickerField({ compact = false, icon, label, onPress, value }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${label} ${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.pickerField, compact && styles.pickerFieldCompact, { backgroundColor: colors.surfaceRaised }, pressed && styles.pressed]}
    >
      <View style={[styles.pickerFieldIcon, { backgroundColor: colors.coralSoft }]}><FeatureIcon color={colors.coral} name={icon} size={17} /></View>
      <View style={styles.pickerFieldCopy}><Text style={[styles.pickerFieldLabel, { color: colors.inkMuted }]}>{label}</Text><Text numberOfLines={1} style={[styles.pickerFieldValue, { color: colors.ink }]}>{value}</Text></View>
      <FeatureIcon color={colors.inkSoft} name="chevron.right" size={14} />
    </Pressable>
  );
}

function PickerLabel({ icon, label }) {
  const { colors } = useTheme();
  return <View style={styles.pickerLabel}><FeatureIcon color={colors.coral} name={icon} size={14} /><Text style={{ color: colors.ink, fontSize: type.body, fontWeight: '800' }}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, width: '100%', maxWidth: 620, alignSelf: 'center' },
  hero: { borderRadius: 26, borderCurve: 'continuous', borderWidth: 0, height: 156, marginBottom: spacing.md, overflow: 'hidden', position: 'relative' },
  heroImage: { height: 156 },
  heroGradient: { bottom: 0, height: 130, left: 0, position: 'absolute', right: 0 },
  heroCopy: { bottom: spacing.md, left: spacing.md, position: 'absolute', right: spacing.md },
  heroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  heroPin: { alignItems: 'center', borderRadius: radius.pill, height: 36, justifyContent: 'center', width: 36 },
  heroMapButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 7 },
  heroMapText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '800' },
  heroTitle: { color: '#FFFFFF', fontSize: type.headline, fontWeight: '900' },
  heroSubtitle: { color: 'rgba(255,255,255,0.86)', fontSize: type.caption2, lineHeight: 16, marginTop: 3 },
  searchSticky: { alignSelf: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, width: '100%', maxWidth: 620, zIndex: 2 },
  searchBar: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: type.body, minWidth: 0, paddingVertical: 0 },
  clearButton: { elevation: 0, height: 30, shadowOpacity: 0, width: 30 },
  selectedCard: { marginBottom: spacing.lg, marginTop: 0, padding: spacing.md },
  selectedMainRow: { alignItems: 'stretch', flexDirection: 'row', gap: 12 },
  selectedPhotoWrap: { borderRadius: radius.md, height: 104, overflow: 'hidden', position: 'relative', width: 94 },
  selectedCheckBadge: { alignItems: 'center', borderRadius: radius.pill, height: 20, justifyContent: 'center', left: 6, position: 'absolute', top: 6, width: 20 },
  selectedHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  selectedCopy: { flex: 1, justifyContent: 'space-between', minWidth: 0 },
  selectedEyebrow: { fontSize: type.caption2, fontWeight: '800' },
  selectedTitle: { fontSize: type.body, fontWeight: '900', marginTop: 1 },
  selectedMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  selectedMetaChip: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  selectedMetaText: { fontSize: type.caption2, fontWeight: '700' },
  selectedScheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  selectedDetailsHint: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  smallIconButton: { elevation: 0, height: 28, shadowOpacity: 0, width: 28 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaItem: { alignItems: 'flex-start', flexDirection: 'row', flexShrink: 1, gap: 6, maxWidth: '100%' },
  metaText: { flexShrink: 1, fontSize: type.caption2, lineHeight: 17 },
  scheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tag: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 5, maxWidth: '100%', paddingHorizontal: 9, paddingVertical: 5 },
  tagText: { flexShrink: 1, fontSize: type.caption2, fontWeight: '800' },
  categoryRow: { gap: spacing.sm, paddingBottom: spacing.lg, paddingTop: spacing.sm, paddingRight: spacing.md },
  resultMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md, marginTop: spacing.xs },
  resultTitle: { fontSize: type.headline, fontWeight: '900' },
  resultCount: { flexShrink: 1, fontSize: type.caption2, fontWeight: '800', marginLeft: spacing.sm, textAlign: 'right' },
  actionButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.sm, paddingVertical: 10 },
  actionText: { fontSize: type.caption2, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  emptySpots: { alignItems: 'center', marginTop: spacing.sm, padding: spacing.xxl },
  emptyTitle: { fontSize: type.headline, fontWeight: '900', marginTop: spacing.md, textAlign: 'center' },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  mapModalContent: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, height: '84%', padding: spacing.lg },
  scheduleKeyboardAvoiding: { flex: 1, justifyContent: 'flex-end', width: '100%' },
  scheduleModalContent: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '92%', padding: spacing.lg },
  modalHandle: { alignSelf: 'center', borderRadius: radius.pill, height: 5, marginBottom: spacing.sm, opacity: 0.5, width: 44 },
  sheetHeaderDraggable: { alignSelf: 'stretch', paddingBottom: spacing.xs },
  modalHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: type.headline, fontWeight: '900', textAlign: 'center' },
  mapFrame: { borderRadius: radius.lg, flex: 1, overflow: 'hidden' },
  modalSpot: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center', marginBottom: spacing.sm },
  modalSpotName: { flexShrink: 1, fontSize: type.caption, fontWeight: '800' },
  modalSpotSelectorScroll: { gap: 8, paddingVertical: 4, paddingBottom: 8 },
  modalSpotChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  modalSpotChipText: { fontSize: 12, fontWeight: '700' },
  pickerLabel: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.md },
  pickerField: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 62, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pickerFieldCompact: { flex: 1, minWidth: 0 },
  pickerFieldIcon: { alignItems: 'center', borderRadius: radius.sm, height: 36, justifyContent: 'center', width: 36 },
  pickerFieldCopy: { flex: 1, minWidth: 0 },
  pickerFieldLabel: { fontSize: type.caption2, fontWeight: '700' },
  pickerFieldValue: { fontSize: type.body, fontWeight: '900', marginTop: 2 },
  timePickerRow: { flexDirection: 'row', gap: spacing.sm },
  timeError: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  timeErrorText: { flex: 1, fontSize: type.caption2, fontWeight: '800' },
  textInput: { borderRadius: radius.md, borderWidth: 1, fontSize: type.body, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: 9 },
  textArea: { minHeight: 76 },
  summaryBox: { borderRadius: radius.md, marginTop: spacing.md, padding: spacing.md },
  summaryText: { fontSize: type.caption, fontWeight: '900', textAlign: 'center' },
  modalActions: { gap: spacing.sm, marginTop: spacing.sm },
  cancelModalButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  cancelModalText: { fontSize: type.caption, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
