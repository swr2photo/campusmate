import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { FACULTIES } from '../data/faculties';
import { useAssets } from 'expo-asset';
import { router } from 'expo-router';
import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  Image,
  BottomSheet,
  Form,
  Section,
  Slider,
  Picker,
  DisclosureGroup,
  Label,
  Menu,
  Toggle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  contentShape,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  onTapGesture,
  padding,
  presentationDetents,
  presentationDragIndicator,
  pickerStyle,
  resizable,
  scrollIndicators,
  shadow,
  shapes,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useApp } from '../context/AppContext';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { View, useColorScheme } from 'react-native';

const profilePhoto = require('../../assets/friend-profile-card.png');

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

const cardShape = shapes.roundedRectangle({
  cornerRadius: 24,
  roundedCornerStyle: 'continuous',
});
const panelShape = shapes.roundedRectangle({
  cornerRadius: 18,
  roundedCornerStyle: 'continuous',
});

function getRemainingTimeUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const diff = Math.max(0, tomorrow.getTime() - now.getTime());
  const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
  const minutes = Math.floor((diff / (1000 * 60)) % 60).toString().padStart(2, '0');
  const seconds = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getDailySeed() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function pseudoRandom(seedStr) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
  }
  return function() {
    hash = (hash ^ (hash << 13)) | 0;
    hash = (hash ^ (hash >>> 17)) | 0;
    hash = (hash ^ (hash << 5)) | 0;
    return (Math.abs(hash) % 10000) / 10000;
  };
}

function dailyShuffle(array, seedStr) {
  const rng = pseudoRandom(seedStr);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function HomeScreen({ onOpenLikes }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const {
    availableProfiles,
    conversations,
    getMeetupStats,
    matchedProfileIds,
    pendingIncomingLikes,
    profile,
    recycleSkippedProfiles,
    saveMatchingPreferences,
    selectedMeetup,
  } = useApp();
  const [assets] = useAssets([profilePhoto]);
  const myMeetupStats = useMemo(() => (profile ? getMeetupStats(profile) : null), [profile, getMeetupStats]);
  const matchedCount = Math.max(matchedProfileIds?.length || 0, conversations?.length || 0);
  const [timeLeft, setTimeLeft] = useState(getRemainingTimeUntilMidnight());
  const autoRefreshLock = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(getRemainingTimeUntilMidnight());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Settings BottomSheet State
  const [showSettings, setShowSettings] = useState(false);
  const [distance, setDistance] = useState(15);
  const [years, setYears] = useState({ 1: true, 2: true, 3: true, 4: true });
  const [genders, setGenders] = useState({ male: true, female: true, other: true });
  const [activities, setActivities] = useState({ exerciseExpanded: false, running: true, gym: true, sports: true, study: true, chill: true });
  const [faculty, setFaculty] = useState('all');
  
  const [showFilters, setShowFilters] = useState(false);
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [eveningOnly, setEveningOnly] = useState(false);

  
  React.useEffect(() => {
    if (!profile) return;
    const preferences = profile.matchingPreferences || {};
    const selectedActivities = preferences.activities || [];
    const selectedYears = preferences.years || [];
    const selectedGenders = preferences.genders || [];
    setActivities({
      exerciseExpanded: false,
      running: selectedActivities.length === 0 || selectedActivities.includes('running'),
      gym: selectedActivities.length === 0 || selectedActivities.includes('gym'),
      sports: selectedActivities.length === 0 || selectedActivities.includes('sports'),
      study: selectedActivities.length === 0 || selectedActivities.includes('study'),
      chill: selectedActivities.length === 0 || selectedActivities.includes('chill'),
    });
    setFaculty(preferences.faculty || 'all');
    setYears({
      1: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 1'),
      2: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 2'),
      3: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 3'),
      4: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 4'),
    });
    setGenders({
      male: selectedGenders.length === 0 || selectedGenders.includes('male'),
      female: selectedGenders.length === 0 || selectedGenders.includes('female'),
      other: selectedGenders.length === 0 || selectedGenders.includes('nonbinary'),
    });
    setDistance(preferences.maxDistance ?? 25);
    setSameFacultyOnly(preferences.sameFacultyOnly ?? false);
  }, [
    profile?.id,
    profile?.matchingPreferences?.activities,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.genders,
    profile?.matchingPreferences?.maxDistance,
    profile?.matchingPreferences?.sameFacultyOnly,
    profile?.matchingPreferences?.years,
  ]);

  const handleFacultySelection = (nextFaculty) => {
    setFaculty(nextFaculty);
    if (nextFaculty !== 'all') setSameFacultyOnly(false);
  };

  const handleSameFacultySelection = (enabled) => {
    setSameFacultyOnly(enabled);
    if (enabled) setFaculty('all');
  };

  const saveSearchSettings = async () => {
    const selectedActivities = ['running', 'gym', 'sports', 'study', 'chill'].filter((key) => activities[key]);
    const selectedYears = [1, 2, 3, 4].filter((key) => years[key]).map((key) => `ชั้นปีที่ ${key}`);
    const selectedGenders = [
      genders.male && 'male',
      genders.female && 'female',
      genders.other && 'nonbinary',
    ].filter(Boolean);
    await saveMatchingPreferences({
      ...(profile.matchingPreferences || {}),
      activities: selectedActivities.length === 5 ? [] : selectedActivities,
      faculty: sameFacultyOnly ? 'all' : faculty,
      genders: selectedGenders.length === 3 ? [] : selectedGenders,
      maxDistance: Math.round(distance),
      sameFacultyOnly,
      years: selectedYears.length === 4 ? [] : selectedYears,
    });
    setShowSettings(false);
  };

  const activeFacultyFilter = sameFacultyOnly
    ? (profile?.faculty || 'all')
    : (faculty || 'all');

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (activeFacultyFilter !== 'all' && candidate.faculty !== activeFacultyFilter) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      if (eveningOnly && !candidate.availability?.includes('17:') && !candidate.availability?.includes('18:')) return false;
      return true;
    });
    return dailyShuffle(filtered, getDailySeed() + (profile?.id || ''));
  }, [activeFacultyFilter, availableProfiles, eveningOnly, profile?.faculty, profile?.id, sameFacultyOnly]);

  const currentProfile = filteredProfiles[0] || null;
  const remoteAvatar = useRemoteImage(currentProfile?.avatarUri);
  const imageUri = remoteAvatar || assets?.[0]?.localUri || assets?.[0]?.uri;

  useEffect(() => {
    if (currentProfile) {
      autoRefreshLock.current = false;
      return;
    }
    if (!availableProfiles?.length || filteredProfiles.length > 0) return;
    if (autoRefreshLock.current) return;

    autoRefreshLock.current = true;
    const timer = setTimeout(() => {
      recycleSkippedProfiles();
      setEveningOnly(false);
    }, 1200);

    return () => clearTimeout(timer);
  }, [availableProfiles, currentProfile, filteredProfiles, recycleSkippedProfiles]);

  const persistFacultyMatching = async (nextFaculty, nextSameFacultyOnly) => {
    const previousFaculty = faculty;
    const previousSameFacultyOnly = sameFacultyOnly;
    const normalizedSameFacultyOnly = nextSameFacultyOnly === true && Boolean(profile?.faculty);
    const normalizedFaculty = normalizedSameFacultyOnly ? 'all' : (nextFaculty || 'all');

    setFaculty(normalizedFaculty);
    setSameFacultyOnly(normalizedSameFacultyOnly);
    try {
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        faculty: normalizedFaculty,
        sameFacultyOnly: normalizedSameFacultyOnly,
      });
    } catch (error) {
      setFaculty(previousFaculty);
      setSameFacultyOnly(previousSameFacultyOnly);
      console.error('[HomeScreen] Failed to save faculty matching:', error);
    }
  };

  const handleReset = () => {
    recycleSkippedProfiles();
    setEveningOnly(false);
    void persistFacultyMatching('all', false);
  };



  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 85, zIndex: 10 }}
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={{ width: '100%', height: 85 }}>
          <VStack modifiers={[padding({ top: 35, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <Header onSettings={() => setShowSettings(true)} />
          </VStack>
        </Host>
      </View>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.purple}
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
              padding({ top: 60, bottom: 36, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
            {selectedMeetup && (
              <HStack
                alignment="center"
                spacing={10}
                modifiers={[
                  padding({ horizontal: 12, vertical: 9 }),
                  frame({ maxWidth: Infinity }),
                  background(palette.mintSoft, shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' })),
                  shadow({ color: 'rgba(23, 128, 90, 0.08)', opacity: 0.8, radius: 8, x: 0, y: 2 }),
                ]}
              >
                <Button
                  onPress={() => router.push('/meetup')}
                  modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
                >
                  <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                    <VStack
                      alignment="center"
                      modifiers={[
                        frame({ width: 32, height: 32 }),
                        background('#1FA778', shapes.circle()),
                        shadow({ color: 'rgba(31, 167, 120, 0.2)', opacity: 1, radius: 6, x: 0, y: 2 }),
                      ]}
                    >
                      <Image color="#FFFFFF" size={13} systemName="mappin.and.ellipse" />
                    </VStack>
                    <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                      <HStack spacing={6} alignment="center">
                        <Text modifiers={[font({ weight: 'bold', size: 11 }), foregroundStyle(palette.text), lineLimit(1)]}>
                          จุดนัดพบ
                        </Text>
                        <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle(myMeetupStats?.isFull ? '#FF453A' : '#1FA778')]}>
                          {myMeetupStats ? `${myMeetupStats.isFull ? 'เต็มแล้ว' : `ร่วม ${myMeetupStats.acceptedCount}/${myMeetupStats.maxPeople}`}` : 'พร้อม'}
                        </Text>
                      </HStack>
                      <Text modifiers={[font({ size: 13.5, weight: 'bold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                        {selectedMeetup.name}
                      </Text>
                      {selectedMeetup.schedule?.date ? (
                        <Text modifiers={[font({ size: 10.5, weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
                          {formatReadableDate(selectedMeetup.schedule.date)}
                          {selectedMeetup.schedule?.startTime && selectedMeetup.schedule?.endTime ? ` · ${selectedMeetup.schedule.startTime}–${selectedMeetup.schedule.endTime}` : ''}
                        </Text>
                      ) : (
                        <Text modifiers={[font({ size: 10.5, weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                          แตะเพื่อจัดการจุดนัดพบ
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                </Button>
                <Button
                  label="จัดการ"
                  onPress={() => router.push('/meetup')}
                  modifiers={[
                    buttonStyle('glassProminent'),
                    buttonBorderShape('capsule'),
                    controlSize('small'),
                    tint('#1FA778'),
                  ]}
                />
              </HStack>
            )}
            <FilterChips
              likesCount={pendingIncomingLikes.length}
              onAll={handleReset}
              onLikes={onOpenLikes}
            />

            {showFilters && (
              <SmartFilters
                eveningOnly={eveningOnly}
                onEvening={() => setEveningOnly((current) => !current)}
                onSameFaculty={() => persistFacultyMatching('all', !sameFacultyOnly)}
                sameFacultyOnly={sameFacultyOnly}
              />
            )}

            {currentProfile ? (
              <>
                <ProfileCard
                  candidate={currentProfile}
                  imageUri={imageUri}
                  onPress={() => router.push({
                    pathname: '/discover-profile',
                    params: { profileId: currentProfile.id },
                  })}
                />
                <DiscoveryShortcuts
                  matchedCount={matchedCount}
                  timeLeft={timeLeft}
                />
              </>
            ) : (
              <VStack
                spacing={18}
                modifiers={[
                  padding({ vertical: 36, horizontal: 22 }),
                  frame({ maxWidth: Infinity }),
                  background(palette.card, cardShape),
                ]}
              >
                <ContentUnavailableView
                  description="ระบบจะค้นหาโปรไฟล์ใหม่โดยอัตโนมัติ หากตัวกรองไม่มีคนที่ตรงกัน"
                  systemImage="person.2.slash"
                  title="ยังไม่มีโปรไฟล์ที่ตรงกัน"
                />
                <Button
                  label="เริ่มใหม่"
                  onPress={handleReset}
                  systemImage="arrow.triangle.2.circlepath"
                  modifiers={[
                    buttonStyle('glassProminent'),
                    buttonBorderShape('capsule'),
                    controlSize('large'),
                    tint(palette.purple),
                    frame({ maxWidth: Infinity }),
                  ]}
                />
              </VStack>
            )}
          </VStack>
        </ScrollView>
      
      <BottomSheet
        isPresented={showSettings}
        onIsPresentedChange={setShowSettings}
        modifiers={[
          presentationDetents(['large']),
          presentationDragIndicator('visible')
        ]}
      >
        <VStack style={{ flex: 1 }}>
          <Text
            modifiers={[
              font({ textStyle: 'headline', weight: 'bold' }),
              padding({ top: 20, bottom: 5 }),
              frame({ maxWidth: Infinity, alignment: 'center' })
            ]}
          >
            ตั้งค่าการจับคู่
          </Text>
          <Form>
            <Section header={<Text>ระยะห่างจากคุณ</Text>} footer={<Text>ค้นหาเพื่อนในรัศมี {Math.round(distance)} กิโลเมตร</Text>}>
              <Slider
                value={distance}
                onValueChange={setDistance}
                min={1}
                max={50}
                step={1}
              />
            </Section>
            <Section header={<Text>กิจกรรมที่สนใจ</Text>}>
              <DisclosureGroup 
                isExpanded={activities.exerciseExpanded} 
                onIsExpandedChange={(val) => setActivities(a => ({ ...a, exerciseExpanded: val }))}
              >
                <DisclosureGroup.Label>
                  <Label title="ออกกำลังกาย / กีฬา" systemImage="figure.run" />
                </DisclosureGroup.Label>
                <Toggle isOn={activities.running} onIsOnChange={(val) => setActivities(a => ({ ...a, running: val }))} label="วิ่ง" systemImage="figure.run" />
                <Toggle isOn={activities.gym} onIsOnChange={(val) => setActivities(a => ({ ...a, gym: val }))} label="เข้ายิม / ฟิตเนส" systemImage="dumbbell.fill" />
                <Toggle isOn={activities.sports} onIsOnChange={(val) => setActivities(a => ({ ...a, sports: val }))} label="กีฬาอื่น ๆ (เช่น แบด, บาส)" systemImage="sportscourt.fill" />
              </DisclosureGroup>
              <Toggle isOn={activities.study} onIsOnChange={(val) => setActivities(a => ({ ...a, study: val }))} label="ทบทวนบทเรียน / ติวสอบ" systemImage="book.closed.fill" />
              <Toggle isOn={activities.chill} onIsOnChange={(val) => setActivities(a => ({ ...a, chill: val }))} label="คุยเล่น / คาเฟ่" systemImage="cup.and.saucer.fill" />
            </Section>
            <Section header={<Text>ช่วงชั้นปี (เลือกได้หลายข้อ)</Text>}>
              <Toggle isOn={years[1]} onIsOnChange={(val) => setYears(y => ({ ...y, 1: val }))} label="ปี 1" />
              <Toggle isOn={years[2]} onIsOnChange={(val) => setYears(y => ({ ...y, 2: val }))} label="ปี 2" />
              <Toggle isOn={years[3]} onIsOnChange={(val) => setYears(y => ({ ...y, 3: val }))} label="ปี 3" />
              <Toggle isOn={years[4]} onIsOnChange={(val) => setYears(y => ({ ...y, 4: val }))} label="ปี 4 ขึ้นไป" />
            </Section>
            <Section header={<Text>คณะ</Text>}>
              <Picker label="เลือกคณะ" selection={faculty} onSelectionChange={handleFacultySelection} modifiers={[pickerStyle('menu')]}>
                <Text modifiers={[tag('all')]}>ทุกคณะ</Text>
                {FACULTIES.map((fac) => (
                  <Text key={fac} modifiers={[tag(fac)]}>{fac}</Text>
                ))}
              </Picker>
              <Toggle isOn={sameFacultyOnly} onIsOnChange={handleSameFacultySelection} label="เฉพาะคณะเดียวกับฉัน" systemImage="building.columns.fill" />
            </Section>
            <Section header={<Text>เพศ (เลือกได้หลายข้อ)</Text>}>
              <Toggle isOn={genders.male} onIsOnChange={(val) => setGenders(g => ({ ...g, male: val }))} label="ชาย" />
              <Toggle isOn={genders.female} onIsOnChange={(val) => setGenders(g => ({ ...g, female: val }))} label="หญิง" />
              <Toggle isOn={genders.other} onIsOnChange={(val) => setGenders(g => ({ ...g, other: val }))} label="อื่นๆ" />
            </Section>
          </Form>
          <Button
            label="บันทึกตัวกรอง"
            onPress={saveSearchSettings}
            systemImage="checkmark.circle.fill"
            modifiers={[
              buttonStyle('glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
              tint(palette.purple),
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

function Header({ onSettings }) {
  const palette = usePalette();
  return (
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <Text
        modifiers={[
          font({ textStyle: 'title1', weight: 'bold', design: 'rounded' }),
          foregroundStyle(palette.text),
        ]}
      >
        หาเพื่อน
      </Text>
      <Spacer />
      <Button
        label="ตั้งค่า"
        onPress={onSettings}
        systemImage="gearshape.fill"
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          labelStyle('iconOnly'),
          tint(palette.text),
        ]}
      />
    </HStack>
  );
}

function FilterChips({ likesCount, onAll, onLikes }) {
  const palette = usePalette();
  return (
    <ScrollView
      axes="horizontal"
      showsIndicators={false}
      modifiers={[scrollIndicators('never', 'horizontal')]}
    >
      <HStack spacing={8}>
        <FilterChip dot={likesCount > 0} label="ถูกใจคุณ" onPress={onLikes} />
        <FilterChip label="เริ่มใหม่" onPress={onAll} />
      </HStack>
    </ScrollView>
  );
}

function FilterChip({ dot = false, label, onPress }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(label),
      ]}
    >
      <HStack
        alignment="center"
        spacing={5}
        modifiers={[
          padding({ horizontal: 12, vertical: 7 }),
          background(palette.chip, shapes.capsule()),
        ]}
      >
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: 'semibold', design: 'rounded' }),
            foregroundStyle(palette.text),
          ]}
        >
          {label}
        </Text>
        {dot && <Image color={palette.purple} size={6} systemName="circle.fill" />}
      </HStack>
    </Button>
  );
}

function SmartFilters({ eveningOnly, onEvening, onSameFaculty, sameFacultyOnly }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={9}
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity }),
        background(palette.card, panelShape),
      ]}
    >
      <CompactFilter
        active={sameFacultyOnly}
        label="คณะเดียวกัน"
        onPress={onSameFaculty}
        systemImage="building.columns.fill"
      />
      <CompactFilter
        active={eveningOnly}
        label="ว่างช่วงเย็น"
        onPress={onEvening}
        systemImage="sunset.fill"
      />
    </HStack>
  );
}

function CompactFilter({ active, label, onPress, systemImage }) {
  const palette = usePalette();
  return (
    <Button
      label={label}
      onPress={onPress}
      systemImage={systemImage}
      modifiers={[
        buttonStyle(active ? 'glassProminent' : 'glass'),
        buttonBorderShape('capsule'),
        controlSize('regular'),
        tint(active ? palette.purple : palette.chip),
        frame({ maxWidth: Infinity }),
      ]}
    />
  );
}

function ProfileCard({ candidate, imageUri, onPress }) {
  const palette = usePalette();
  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ maxWidth: Infinity }),
        background(palette.card, cardShape),
        clipShape('roundedRectangle', 24),
        shadow({ radius: 22, y: 10, color: 'rgba(0,0,0,0.28)' }),
        contentShape(shapes.rectangle()),
        onTapGesture(onPress),
        accessibilityLabel(`${candidate.name}${candidate.age ? `, ${candidate.age}` : ''}`),
        accessibilityHint('แตะเพื่อดูรายละเอียดโปรไฟล์'),
      ]}
    >
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
        {imageUri ? (
          <Image
            uiImage={imageUri}
            modifiers={[
              resizable(),
              aspectRatio({ ratio: 0.82, contentMode: 'fill' }),
              frame({ height: 340, maxWidth: Infinity }),
              clipped(),
            ]}
          />
        ) : (
          <Image
            color={palette.secondary}
            size={84}
            systemName="person.crop.square.fill"
            modifiers={[
              frame({ height: 340, maxWidth: Infinity }),
              background(candidate.avatarColor || palette.chip),
            ]}
          />
        )}
        <VStack
          alignment="leading"
          spacing={6}
          modifiers={[
            padding({ top: 35, bottom: 22, horizontal: 18 }),
            frame({ minHeight: 122, maxWidth: Infinity, alignment: 'leading' }),
            background(palette.card),
          ]}
        >
          {candidate.isMatched && (
            <HStack
              alignment="center"
              spacing={4}
              modifiers={[
                padding({ horizontal: 8, vertical: 4 }),
                background(palette.purpleSoft, shapes.capsule()),
              ]}
            >
              <Image color={palette.purple} size={11} systemName="person.2.fill" />
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(palette.purple)]}>
                เพื่อนที่คุณแมตช์แล้ว 💬
              </Text>
            </HStack>
          )}
          <Text
            modifiers={[
              font({ textStyle: 'title', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.text),
              lineLimit(1),
            ]}
          >
            {candidate.name}{candidate.age ? `, ${candidate.age}` : ''}
          </Text>
          <Text
            modifiers={[
              font({ textStyle: 'subheadline', weight: 'medium' }),
              foregroundStyle(palette.secondary),
              lineLimit(1),
            ]}
          >
            {[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), candidate.faculty].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}
          </Text>
        </VStack>
      </VStack>

    </ZStack>
  );
}

function DiscoveryShortcuts({ matchedCount = 0, timeLeft = '24:00:00' }) {
  const palette = usePalette();
  return (
    <HStack spacing={10} alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <HStack
        spacing={6}
        alignment="center"
        modifiers={[
          padding({ horizontal: 11, vertical: 7 }),
          background(palette.surfaceRaised, shapes.capsule()),
          shadow({ color: 'black', opacity: 0.03, radius: 4, x: 0, y: 1 }),
        ]}
      >
        <Image color={palette.purple} size={12} systemName="clock.arrow.2.circlepath" />
        <Text
          modifiers={[
            font({ textStyle: 'caption2', weight: 'bold' }),
            foregroundStyle(palette.text),
          ]}
        >
          รีเซ็ตใน {timeLeft}
        </Text>
      </HStack>

      <ShortcutCircle
        label="สถิติแมตช์"
        onPress={() => router.push('/(tabs)/dashboard')}
        systemImage="flame.fill"
        value={`${matchedCount}`}
      />
    </HStack>
  );
}

function ShortcutCircle({ label, onPress, systemImage, value = '' }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(label),
      ]}
    >
      <HStack
        alignment="center"
        spacing={6}
        modifiers={[
          padding({ horizontal: 11, vertical: 7 }),
          background(palette.circle, shapes.capsule()),
        ]}
      >
        <Image color={palette.coral} size={12} systemName={systemImage} />
        <Text
          modifiers={[
            font({ textStyle: 'caption2', weight: 'semibold' }),
            foregroundStyle(palette.text),
          ]}
        >
          {label}
        </Text>
        {value ? (
          <Text
            modifiers={[
              font({ textStyle: 'caption2', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.coral),
            ]}
          >
            {value}
          </Text>
        ) : null}
      </HStack>
    </Button>
  );
}
