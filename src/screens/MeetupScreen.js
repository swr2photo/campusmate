import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { DatePickerDialog, Host, TimePickerDialog } from '../components/Pickers';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import CampusMapView from '../components/CampusMapView';
import {
  IosLikeCard,
  IosLikeHeader,
  IosLikePill,
  IosLikeScreen,
  IosLikeSectionTitle,
  IconButton,
} from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';

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
  require('../assets/images/campus/DSC_3614.jpg'),
  require('../assets/images/campus/DSC_5070.jpg'),
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
  return [spot.name, spot.description, spot.categoryLabel, spot.busyTime, spot.group]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
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

function activityColor(category, colors) {
  if (category === 'running') return { color: colors.coral, soft: colors.coralSoft };
  if (category === 'study') return { color: colors.blue, soft: colors.blueSoft };
  if (category === 'gym') return { color: colors.violet, soft: colors.violetSoft };
  if (category === 'sports') return { color: colors.amber, soft: colors.amberSoft };
  if (category === 'cafe' || category === 'chill') return { color: colors.green, soft: colors.greenSoft };
  return { color: colors.primary, soft: colors.primarySoft };
}

export default function MeetupScreen({ onToast }) {
  const { colors } = useTheme();
  const { campusSpots = [], chooseMeetup, updateMeetupSchedule, clearMeetup, selectedMeetup } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mapTargetSpot, setMapTargetSpot] = useState(null);
  const [mapModal, setMapModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [pendingSpot, setPendingSpot] = useState(null);
  const [schedDate, setSchedDate] = useState(null);
  const [schedStart, setSchedStart] = useState('14:00');
  const [schedEnd, setSchedEnd] = useState('16:00');
  const [maxPeople, setMaxPeople] = useState('2');
  const [message, setMessage] = useState('');

  const nextDays = useMemo(() => getNextDays(7), []);
  const visibleSpots = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return campusSpots.filter((spot) => (
      (selectedCategory === 'all' || spot.category === selectedCategory)
      && matchesSpotQuery(spot, normalizedQuery)
    ));
  }, [campusSpots, searchQuery, selectedCategory]);

  const openMapForSpot = (spot) => {
    setMapTargetSpot(spot || selectedMeetup || visibleSpots[0] || null);
    setMapModal(true);
  };

  const openScheduleFor = (spot) => {
    const savedDate = spot?.schedule?.date || selectedMeetup?.schedule?.date;
    setPendingSpot(spot);
    setSchedDate(nextDays.some((day) => day.value === savedDate) ? savedDate : nextDays[0].value);
    setSchedStart(spot?.schedule?.startTime || selectedMeetup?.schedule?.startTime || '14:00');
    setSchedEnd(spot?.schedule?.endTime || selectedMeetup?.schedule?.endTime || '16:00');
    setMaxPeople(String(spot?.schedule?.maxPeople || selectedMeetup?.schedule?.maxPeople || 2));
    setMessage(spot?.schedule?.message || selectedMeetup?.schedule?.message || '');
    setScheduleModal(true);
  };

  const confirmSchedule = async () => {
    if (!pendingSpot || !schedDate) return;
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
    try {
      if (selectedMeetup?.id === pendingSpot.id && updateMeetupSchedule) {
        await updateMeetupSchedule(schedule);
      } else {
        await chooseMeetup(pendingSpot, schedule);
      }
      const successMessage = `ปักหมุด ${pendingSpot.name} แล้ว`;
      setScheduleModal(false);
      setPendingSpot(null);
      setTimeout(() => onToast?.(successMessage), 350);
    } catch (error) {
      onToast?.('บันทึกเวลานัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    }
  };

  const handleQuickChoose = async (spot) => {
    try {
      await chooseMeetup(spot);
      onToast?.(`เลือก ${spot.name} เป็นจุดนัดหมายแล้ว`);
    } catch (error) {
      onToast?.('เลือกจุดนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    }
  };

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
              console.error('[Meetup] clearMeetup error:', error);
              onToast?.('ยกเลิกจุดนัดหมายไม่สำเร็จ', 'info');
            }
          },
        },
      ]
    );
  };

  const header = (
    <View>
      <CampusHero onOpenMap={() => openMapForSpot(selectedMeetup || visibleSpots[0])} selectedMeetup={selectedMeetup} />

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <FeatureIcon color={colors.inkSoft} name="magnifyingglass" size={18} />
        <TextInput
          accessibilityLabel="ค้นหาสถานที่หรือกิจกรรม"
          autoCapitalize="none"
          onChangeText={setSearchQuery}
          placeholder="ค้นหาสถานที่หรือกิจกรรม"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.ink }]}
          value={searchQuery}
        />
        {searchQuery ? <IconButton accessibilityLabel="ล้างคำค้นหา" icon="xmark.circle.fill" onPress={() => setSearchQuery('')} size={18} style={styles.clearButton} tintColor={colors.inkSoft} /> : null}
      </View>

      {selectedMeetup ? <SelectedMeetup meetup={selectedMeetup} onChangeTime={() => openScheduleFor(selectedMeetup)} onClear={handleClear} onOpenMap={() => openMapForSpot(selectedMeetup)} /> : null}

      <IosLikeSectionTitle subtitle="สถานที่จริงใน มอ. เรียงจากใกล้ไปไกล" title="เลือกกิจกรรมที่สนใจ" />
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
      <IosLikeHeader
        onRightPress={() => openMapForSpot(selectedMeetup || visibleSpots[0])}
        rightIcon="map.fill"
        subtitle="เลือกสถานที่และนัดหมายกับเพื่อน"
        title="กิจกรรม"
      />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={visibleSpots}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<EmptySpots query={searchQuery} />}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <SpotCard
            onChoose={() => void handleQuickChoose(item)}
            onOpenMap={() => openMapForSpot(item)}
            onSchedule={() => openScheduleFor(item)}
            selected={selectedMeetup?.id === item.id}
            spot={item}
          />
        )}
        showsVerticalScrollIndicator={false}
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
        pendingSpot={pendingSpot}
        schedDate={schedDate}
        schedEnd={schedEnd}
        schedStart={schedStart}
        visible={scheduleModal}
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
  const heroHeight = Platform.OS === 'android' && windowWidth < 600 ? 156 : 200;
  
  return (
    <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.line, width: heroWidth, height: heroHeight, alignSelf: 'center' }]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: heroWidth, height: heroHeight }}>
        {CAMPUS_PHOTOS.map((photo, index) => <Image key={String(index)} source={photo} style={{ width: heroWidth, height: heroHeight }} resizeMode="cover" />)}
      </ScrollView>
      <LinearGradient colors={['transparent', 'rgba(8,16,30,0.86)']} style={[styles.heroGradient, { height: Math.min(130, heroHeight * 0.6) }]} />
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

function SelectedMeetup({ meetup, onChangeTime, onClear, onOpenMap }) {
  const { colors } = useTheme();
  return (
    <IosLikeCard style={[styles.selectedCard, { backgroundColor: colors.mintSoft, borderColor: colors.mintSoft }]}>
      <View style={styles.selectedHeader}>
        <View style={styles.selectedIdentity}>
          <FeatureIcon color={colors.mint} name="checkmark.circle.fill" size={19} />
          <View style={styles.selectedCopy}>
            <Text style={[styles.selectedEyebrow, { color: colors.mint }]}>เลือกไว้แล้ว</Text>
            <Text numberOfLines={1} style={[styles.selectedTitle, { color: colors.ink }]}>{meetup.name}</Text>
          </View>
        </View>
        <IconButton accessibilityLabel="ยกเลิกจุดนัดหมาย" icon="xmark" onPress={onClear} size={16} style={styles.smallIconButton} tintColor={colors.inkMuted} />
      </View>
      <View style={styles.metaRow}>
        <Meta icon="location.fill" text={meetup.distance} />
        <Meta icon="clock.fill" text={meetup.scheduledAt} />
      </View>
      {meetup.schedule?.date ? <View style={styles.scheduleRow}><Tag icon="calendar" text={meetup.schedule.date} /><Tag icon="clock.fill" text={`${meetup.schedule.startTime}–${meetup.schedule.endTime}`} /></View> : null}
      <View style={styles.selectedActions}>
        <ActionButton icon="calendar.badge.clock" label="เปลี่ยนเวลา" onPress={onChangeTime} tintColor={colors.mint} />
        <ActionButton icon="map.fill" label="ดูแผนที่" onPress={onOpenMap} tintColor={colors.blue} />
      </View>
    </IosLikeCard>
  );
}

function SpotCard({ onChoose, onOpenMap, onSchedule, selected, spot }) {
  const { colors } = useTheme();
  const accent = activityColor(spot.category, colors);
  return (
    <IosLikeCard style={styles.spotCard}>
      <View style={styles.spotTopRow}>
        <View style={[styles.spotIcon, { backgroundColor: accent.soft }]}><FeatureIcon color={accent.color} name={activitySymbol(spot.category)} size={21} /></View>
        <View style={styles.spotCopy}>
          <Text numberOfLines={2} style={[styles.spotName, { color: colors.ink }]}>{spot.name}</Text>
          <Text numberOfLines={1} style={[styles.spotCategory, { color: accent.color }]}>{spot.categoryLabel}</Text>
        </View>
        <View style={[styles.rating, { backgroundColor: colors.amberSoft }]}><FeatureIcon color={colors.amber} name="star.fill" size={12} /><Text style={[styles.ratingText, { color: colors.amber }]}>{spot.rating}</Text></View>
      </View>
      <View style={[styles.spotDetails, { backgroundColor: colors.surfaceRaised }]}>
        <Meta icon="info.circle.fill" text={spot.description} />
        <Meta icon="person.2.fill" text={spot.busyTime} />
        <Meta accent icon="location.fill" text={spot.distance} />
      </View>
      <View style={styles.spotButtonRow}>
        <ActionButton emphasized icon="calendar.badge.clock" label="นัดหมาย" onPress={onSchedule} tintColor={colors.coral} />
        <ActionButton icon={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'} label={selected ? 'เลือกแล้ว' : 'ปักหมุด'} onPress={onChoose} tintColor={selected ? colors.mint : colors.inkMuted} />
        <ActionButton icon="map.fill" label="แผนที่" onPress={onOpenMap} tintColor={colors.blue} />
      </View>
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
      <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[styles.actionText, { color: emphasized ? '#FFFFFF' : tintColor }]}>{label}</Text>
    </Pressable>
  );
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
  const translateY = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 700,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closeRef.current?.();
      isClosingRef.current = false;
    });
  }, [translateY, fadeAnim]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.setValue(600);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, fadeAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
      } else {
        translateY.setValue(gestureState.dy * 0.15);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 70 || gestureState.vy > 0.5) {
        closeWithAnimation();
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      Animated.spring(translateY, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }).start();
    },
  }), [closeWithAnimation, translateY]);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={closeWithAnimation}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]}>
          <Pressable accessibilityLabel="ปิดแผนที่" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={[
            styles.mapModalContent,
            {
              backgroundColor: colors.card,
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            {...panResponder.panHandlers}
            accessibilityHint="ลากลงเพื่อปิดแผนที่"
            style={styles.sheetHeaderDraggable}
          >
            <View style={[styles.modalHandle, { backgroundColor: colors.line }]} />
            <View style={styles.modalHeader}>
              <FeatureIcon color={colors.coral} name="map.fill" size={19} />
              <Text numberOfLines={1} style={[styles.modalTitle, { color: colors.ink }]}>แผนที่วิทยาเขต ม.อ. หาดใหญ่</Text>
            </View>
          </View>
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
    </Modal>
  );
}

function ScheduleModal({ maxPeople, message, nextDays, onClose, onConfirm, onDate, onEnd, onMaxPeople, onMessage, onStart, pendingSpot, schedDate, schedEnd, schedStart, visible }) {
  const { colors } = useTheme();
  const [activePicker, setActivePicker] = useState(null);
  const selectedDay = nextDays.find((day) => day.value === schedDate);
  const validTimeRange = timeValueToMinutes(schedEnd) > timeValueToMinutes(schedStart);
  const selectableDates = {
    start: dateValueToDate(nextDays[0]?.value),
    end: dateValueToDate(nextDays[nextDays.length - 1]?.value),
  };

  const translateY = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setActivePicker(null);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 700,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closeRef.current?.();
      isClosingRef.current = false;
    });
  }, [translateY, fadeAnim]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      translateY.setValue(600);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, fadeAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
      } else {
        translateY.setValue(gestureState.dy * 0.15);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 70 || gestureState.vy > 0.5) {
        closeWithAnimation();
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      Animated.spring(translateY, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }).start();
    },
  }), [closeWithAnimation, translateY]);

  return (
    <Modal animationType="none" statusBarTranslucent transparent visible={visible} onRequestClose={closeWithAnimation}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]}>
          <Pressable accessibilityLabel="ปิดหน้าต่างนัดหมาย" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <KeyboardAvoidingView
          behavior="height"
          keyboardVerticalOffset={0}
          style={styles.scheduleKeyboardAvoiding}
        >
          <Animated.View
            style={[
              styles.scheduleModalContent,
              {
                backgroundColor: colors.card,
                transform: [{ translateY }],
              },
            ]}
          >
            <View
              {...panResponder.panHandlers}
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
            <ScrollView
              contentContainerStyle={styles.scheduleScroll}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <PickerLabel icon="calendar" label="เลือกวัน" />
              <PickerField icon="calendar" label="วันที่นัดหมาย" onPress={() => setActivePicker('date')} value={selectedDay?.label || schedDate || 'เลือกวัน'} />

              <PickerLabel icon="clock.fill" label="เลือกเวลา" />
              <View style={styles.timePickerRow}>
                <PickerField compact icon="clock.fill" label="เวลาเริ่ม" onPress={() => setActivePicker('start')} value={schedStart} />
                <PickerField compact icon="clock.fill" label="เวลาสิ้นสุด" onPress={() => setActivePicker('end')} value={schedEnd} />
              </View>
              {!validTimeRange ? <View style={[styles.timeError, { backgroundColor: colors.dangerSoft }]}><FeatureIcon color={colors.danger} name="exclamationmark.circle.fill" size={14} /><Text style={[styles.timeErrorText, { color: colors.danger }]}>เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม</Text></View> : null}

              <PickerLabel icon="person.2.fill" label="จำนวนคน (รวมตัวเอง)" />
              <TextInput keyboardType="number-pad" onChangeText={onMaxPeople} placeholder="เช่น 2, 4" placeholderTextColor={colors.inkSoft} style={[styles.textInput, { backgroundColor: colors.surfaceRaised, borderColor: colors.line, color: colors.ink }]} value={maxPeople} />
              <PickerLabel icon="text.bubble.fill" label="ประกาศ/รายละเอียด" />
              <TextInput multiline numberOfLines={3} onChangeText={onMessage} placeholder="เช่น หาเพื่อนไปวิ่งครับ" placeholderTextColor={colors.inkSoft} style={[styles.textInput, styles.textArea, { backgroundColor: colors.surfaceRaised, borderColor: colors.line, color: colors.ink }]} textAlignVertical="top" value={message} />
              <View style={[styles.summaryBox, { backgroundColor: validTimeRange ? colors.coralSoft : colors.dangerSoft }]}><Text style={[styles.summaryText, { color: validTimeRange ? colors.coral : colors.danger }]}>{selectedDay?.label || '—'} · {schedStart}–{schedEnd}</Text></View>
            </ScrollView>
            <View style={styles.modalActions}>
              <ActionButton disabled={!validTimeRange} emphasized icon="checkmark.circle.fill" label="ยืนยันนัดหมาย" onPress={onConfirm} tintColor={colors.coral} />
              <Pressable accessibilityRole="button" onPress={closeWithAnimation} style={({ pressed }) => [styles.cancelModalButton, { borderColor: colors.line }, pressed && styles.pressed]}>
                <Text style={[styles.cancelModalText, { color: colors.inkMuted }]}>ยกเลิก</Text>
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
      {visible && activePicker === 'date' ? (
        <Host>
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
        <Host>
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
        <Host>
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
      style={({ pressed }) => [styles.pickerField, compact && styles.pickerFieldCompact, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }, pressed && styles.pressed]}
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
  listContent: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 620, alignSelf: 'center' },
  hero: { borderRadius: radius.xl, borderWidth: 1, height: 156, marginBottom: spacing.md, overflow: 'hidden', position: 'relative' },
  heroImage: { height: 156 },
  heroGradient: { bottom: 0, height: 130, left: 0, position: 'absolute', right: 0 },
  heroCopy: { bottom: spacing.md, left: spacing.md, position: 'absolute', right: spacing.md },
  heroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  heroPin: { alignItems: 'center', borderRadius: radius.pill, height: 36, justifyContent: 'center', width: 36 },
  heroMapButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 7 },
  heroMapText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '800' },
  heroTitle: { color: '#FFFFFF', fontSize: type.headline, fontWeight: '900' },
  heroSubtitle: { color: 'rgba(255,255,255,0.86)', fontSize: type.caption2, lineHeight: 16, marginTop: 3 },
  searchBar: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, minHeight: 50, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: type.body, minWidth: 0, paddingVertical: 0 },
  clearButton: { elevation: 0, height: 30, shadowOpacity: 0, width: 30 },
  selectedCard: { marginBottom: spacing.lg, marginTop: 0, padding: spacing.md },
  selectedHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  selectedIdentity: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  selectedCopy: { flex: 1 },
  selectedEyebrow: { fontSize: type.caption2, fontWeight: '800' },
  selectedTitle: { fontSize: type.body, fontWeight: '900', marginTop: 2 },
  smallIconButton: { elevation: 0, height: 34, shadowOpacity: 0, width: 34 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaItem: { alignItems: 'flex-start', flexDirection: 'row', flexShrink: 1, gap: 6, maxWidth: '100%' },
  metaText: { flexShrink: 1, fontSize: type.caption2, lineHeight: 17 },
  scheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tag: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 5, maxWidth: '100%', paddingHorizontal: 9, paddingVertical: 5 },
  tagText: { flexShrink: 1, fontSize: type.caption2, fontWeight: '800' },
  selectedActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  categoryRow: { gap: spacing.sm, paddingBottom: spacing.lg, paddingTop: spacing.sm, paddingRight: spacing.md },
  resultMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md, marginTop: spacing.xs },
  resultTitle: { fontSize: type.headline, fontWeight: '900' },
  resultCount: { flexShrink: 1, fontSize: type.caption2, fontWeight: '800', marginLeft: spacing.sm, textAlign: 'right' },
  spotCard: { marginBottom: spacing.md, padding: spacing.md },
  spotTopRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  spotIcon: { alignItems: 'center', borderRadius: radius.lg, height: 44, justifyContent: 'center', width: 44 },
  spotCopy: { flex: 1, minWidth: 0 },
  spotName: { fontSize: type.body, fontWeight: '900', lineHeight: 18 },
  spotCategory: { fontSize: type.caption2, fontWeight: '700', marginTop: 3 },
  rating: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 3, paddingHorizontal: 6, paddingVertical: 5 },
  ratingText: { fontSize: type.caption2, fontWeight: '900' },
  spotDetails: { borderRadius: radius.md, gap: 6, marginTop: spacing.sm, padding: spacing.md },
  spotButtonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.sm },
  actionText: { fontSize: type.caption2, fontWeight: '800' },
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
  scheduleScroll: { paddingBottom: spacing.md },
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
