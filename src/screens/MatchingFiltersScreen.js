import Text from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { project, rubberband } from '../utils/motion';
import { FACULTIES } from '../data/faculties';
import {
  MATCHING_ACTIVITY_OPTIONS,
  MATCHING_AGE_MAX,
  MATCHING_AGE_MIN,
  MATCHING_AGE_VALUES,
  MATCHING_AVAILABILITY_OPTIONS,
  MATCHING_DEFAULT_AGE_MAX,
  MATCHING_DISTANCE_PRESETS,
  MATCHING_GENDER_OPTIONS,
  MATCHING_MORE_ACTIVITY_OPTIONS,
  MATCHING_MORE_GENDER_OPTIONS,
  MATCHING_PACE_OPTIONS,
  MATCHING_PRIMARY_ACTIVITY_OPTIONS,
  MATCHING_PRIMARY_GENDER_OPTIONS,
  MATCHING_UNLIMITED_DISTANCE,
  MATCHING_WEEKDAY_OPTIONS,
  MATCHING_YEAR_OPTIONS,
  clearActivityDetailFilter,
  createMatchingOptionState,
  getActivityDetailFilterOptions,
  getSelectedMatchingValues,
  hasActivityDetailFilters,
  isMatchingOptionUnrestricted,
  normalizeMatchingAge,
  pruneActivityDetailFilters,
  sanitizeActivityDetailFilters,
  toggleActivityDetailFilter,
  toggleMatchingOption,
} from '../data/matchingFilters';
import { useAppActions, useAppProfile } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import { useEntitlement } from '../context/MembershipContext';
import { FEATURE_ADVANCED_FILTERS } from '../data/plans';
import { allowedMatchingPreferences } from '../services/secureDiscoveryService';
import { radius, spacing, type, useTheme } from '../theme';

export default function MatchingFiltersScreen() {
  const { colors } = useTheme();
  const { profile } = useAppProfile();
  // Faculty, year, availability and pace filters are CampusMate Plus (src/data/plans.js).
  const advancedFilters = useEntitlement(FEATURE_ADVANCED_FILTERS);
  const canAdvanced = advancedFilters.allowed;
  const paidChange = (setter) => (value) => { if (advancedFilters.guard()) setter(value); };
  const { saveMatchingPreferences } = useAppActions();
  const [faculty, setFaculty] = useState('all');
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [distance, setDistance] = useState(MATCHING_UNLIMITED_DISTANCE);
  const [ageMin, setAgeMin] = useState(MATCHING_AGE_MIN);
  const [ageMax, setAgeMax] = useState(MATCHING_DEFAULT_AGE_MAX);
  const [years, setYears] = useState(() => createMatchingOptionState(MATCHING_YEAR_OPTIONS));
  const [genders, setGenders] = useState(() => createMatchingOptionState(MATCHING_GENDER_OPTIONS));
  const [activities, setActivities] = useState(() => createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
  const [paces, setPaces] = useState(() => createMatchingOptionState(MATCHING_PACE_OPTIONS));
  const [availabilityPeriods, setAvailabilityPeriods] = useState(() => (
    createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS)
  ));
  const [weekdays, setWeekdays] = useState(() => createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS));
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [requireAvailability, setRequireAvailability] = useState(false);
  const [showMoreGenders, setShowMoreGenders] = useState(false);
  const [showMoreActivities, setShowMoreActivities] = useState(false);
  const [detailFilters, setDetailFilters] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const preferences = allowedMatchingPreferences(profile?.matchingPreferences, canAdvanced);
    const selectedActivities = preferences.activities || [];
    const selectedYears = preferences.years || [];
    const selectedGenders = preferences.genders || [];
    const selectedPaces = preferences.paces || [];
    const selectedAvailabilityPeriods = preferences.availabilityPeriods || [];
    const selectedWeekdays = preferences.weekdays || [];
    const normalizedAgeMin = normalizeMatchingAge(preferences.ageMin, MATCHING_AGE_MIN);
    const normalizedAgeMax = Math.max(
      normalizedAgeMin,
      normalizeMatchingAge(preferences.ageMax, MATCHING_DEFAULT_AGE_MAX)
    );
    setFaculty(preferences.faculty || 'all');
    setSameFacultyOnly(preferences.sameFacultyOnly === true);
    setDistance(Number.isFinite(Number(preferences.maxDistance)) ? Number(preferences.maxDistance) : MATCHING_UNLIMITED_DISTANCE);
    setAgeMin(normalizedAgeMin);
    setAgeMax(normalizedAgeMax);
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, selectedActivities));
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS, selectedYears));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS, selectedGenders));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS, selectedPaces));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS, selectedAvailabilityPeriods));
    setWeekdays(createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS, selectedWeekdays));
    setRequirePhoto(preferences.requirePhoto === true);
    setRequireAvailability(preferences.requireAvailability === true);
    setShowMoreGenders(MATCHING_MORE_GENDER_OPTIONS.some((option) => selectedGenders.includes(option.value)));
    setShowMoreActivities(MATCHING_MORE_ACTIVITY_OPTIONS.some((option) => selectedActivities.includes(option.value)));
    setDetailFilters(pruneActivityDetailFilters(preferences.activityDetails, selectedActivities));
  }, [profile?.id, profile?.matchingPreferences, canAdvanced]);

  const selectedActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
  const showPace = selectedActivities.length === 0 || selectedActivities.includes('running');
  // Detail filters only make sense for a specific activity, so they appear
  // once the user narrows the activity chips down.
  const detailFilterSections = useMemo(
    () => selectedActivities.map(getActivityDetailFilterOptions).filter(Boolean),
    [selectedActivities]
  );
  const activeDetailFilters = useMemo(
    () => pruneActivityDetailFilters(detailFilters, selectedActivities),
    [detailFilters, selectedActivities]
  );
  const moreGenderActive = MATCHING_MORE_GENDER_OPTIONS.some((option) => genders[option.value]);
  const moreActivityActive = MATCHING_MORE_ACTIVITY_OPTIONS.some((option) => activities[option.value]);

  const hasActiveFilters = useMemo(() => (
    ageMin !== MATCHING_AGE_MIN
    || ageMax !== MATCHING_DEFAULT_AGE_MAX
    || distance !== 25
    || sameFacultyOnly
    || (faculty !== 'all' && !sameFacultyOnly)
    || requirePhoto
    || requireAvailability
    || !isMatchingOptionUnrestricted(MATCHING_YEAR_OPTIONS, years)
    || !isMatchingOptionUnrestricted(MATCHING_GENDER_OPTIONS, genders)
    || !isMatchingOptionUnrestricted(MATCHING_ACTIVITY_OPTIONS, activities)
    || !isMatchingOptionUnrestricted(MATCHING_PACE_OPTIONS, paces)
    || !isMatchingOptionUnrestricted(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods)
    || !isMatchingOptionUnrestricted(MATCHING_WEEKDAY_OPTIONS, weekdays)
    || hasActivityDetailFilters(activeDetailFilters)
  ), [
    activeDetailFilters,
    activities,
    ageMax,
    ageMin,
    availabilityPeriods,
    distance,
    faculty,
    genders,
    paces,
    requireAvailability,
    requirePhoto,
    sameFacultyOnly,
    weekdays,
    years,
  ]);

  const resetFilters = () => {
    setFaculty('all');
    setSameFacultyOnly(false);
    setDistance(25);
    setAgeMin(MATCHING_AGE_MIN);
    setAgeMax(MATCHING_DEFAULT_AGE_MAX);
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS));
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
    setWeekdays(createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS));
    setRequirePhoto(false);
    setRequireAvailability(false);
    setShowMoreGenders(false);
    setShowMoreActivities(false);
    setDetailFilters({});
  };

  const saveSearchSettings = async () => {
    setSaving(true);
    try {
      const nextActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
      const nextYears = getSelectedMatchingValues(MATCHING_YEAR_OPTIONS, years);
      const nextGenders = getSelectedMatchingValues(MATCHING_GENDER_OPTIONS, genders);
      const nextPaces = showPace ? getSelectedMatchingValues(MATCHING_PACE_OPTIONS, paces) : [];
      const nextAvailabilityPeriods = getSelectedMatchingValues(
        MATCHING_AVAILABILITY_OPTIONS,
        availabilityPeriods
      );
      const nextWeekdays = getSelectedMatchingValues(MATCHING_WEEKDAY_OPTIONS, weekdays);
      const normalizedAgeMin = Math.min(
        MATCHING_AGE_MAX,
        Math.max(MATCHING_AGE_MIN, Math.round(ageMin))
      );
      const normalizedAgeMax = Math.max(
        normalizedAgeMin,
        Math.min(MATCHING_AGE_MAX, Math.max(MATCHING_AGE_MIN, Math.round(ageMax)))
      );
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        activities: nextActivities,
        activityDetails: pruneActivityDetailFilters(detailFilters, nextActivities),
        ageMin: normalizedAgeMin,
        ageMax: normalizedAgeMax,
        availabilityPeriods: nextAvailabilityPeriods,
        faculty: sameFacultyOnly ? 'all' : faculty,
        genders: nextGenders,
        maxDistance: Math.round(distance),
        paces: nextPaces,
        requireAvailability,
        requirePhoto,
        sameFacultyOnly,
        weekdays: nextWeekdays,
        years: nextYears,
      });
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (error) {
      console.error('[MatchingFilters] Failed to save search settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const closeSheet = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  const body = (
    <>
      <ScrollView
        contentContainerStyle={styles.settingsContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.settingsScroll}
      >
        <View style={styles.introRow}>
          <Text style={[styles.filterHelper, styles.introText, { color: colors.inkMuted }]}>
            เลือกเฉพาะสิ่งที่ต้องการ กรองว่าง = แสดงทุกคน
          </Text>
          {hasActiveFilters ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={resetFilters}>
              <Text style={[styles.resetText, { color: colors.primary }]}>ล้างทั้งหมด</Text>
            </Pressable>
          ) : null}
        </View>

        <FilterSectionLabel label="เพศ" />
        <ChipGrid count={4}>
          <FilterChip
            active={isMatchingOptionUnrestricted(MATCHING_GENDER_OPTIONS, genders)}
            label="ทั้งหมด"
            onPress={() => setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS))}
            quiet
          />
          {MATCHING_PRIMARY_GENDER_OPTIONS.map(({ label, value }) => (
            <FilterChip
              active={!!genders[value]}
              key={value}
              label={label}
              onPress={() => setGenders((current) => toggleMatchingOption(MATCHING_GENDER_OPTIONS, current, value))}
            />
          ))}
          <FilterChip
            active={moreGenderActive}
            label="เพิ่มเติม"
            onPress={() => setShowMoreGenders((current) => !current)}
          />
        </ChipGrid>
        {showMoreGenders || moreGenderActive ? (
          <ChipGrid count={MATCHING_MORE_GENDER_OPTIONS.length}>
            {MATCHING_MORE_GENDER_OPTIONS.map(({ label, value }) => (
              <FilterChip
                active={!!genders[value]}
                key={value}
                label={label}
                onPress={() => setGenders((current) => toggleMatchingOption(MATCHING_GENDER_OPTIONS, current, value))}
              />
            ))}
          </ChipGrid>
        ) : null}

        <FilterSectionLabel label="ช่วงอายุ" />
        <View style={styles.agePickerRow}>
          <AgePicker
            label="อายุต่ำสุด"
            onValueChange={(value) => {
              const nextMin = normalizeMatchingAge(value, ageMin);
              setAgeMin(nextMin);
              if (nextMin > ageMax) setAgeMax(nextMin);
            }}
            value={ageMin}
          />
          <AgePicker
            label="อายุสูงสุด"
            onValueChange={(value) => {
              const nextMax = normalizeMatchingAge(value, ageMax);
              setAgeMax(nextMax);
              if (nextMax < ageMin) setAgeMin(nextMax);
            }}
            value={ageMax}
          />
        </View>
        <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>
          แสดงคนอายุ {ageMin}–{ageMax} ปี
        </Text>

        <FilterSectionLabel label="ระยะห่างจากคุณ" />
        <View style={[styles.distanceCard, { backgroundColor: colors.surfaceRaised }]}>
          <Text style={[styles.distanceValue, { color: colors.primary }]}>
            {distance === MATCHING_UNLIMITED_DISTANCE ? 'ไม่จำกัดระยะ' : `${Math.round(distance)} กม.`}
          </Text>
          <ChipGrid count={MATCHING_DISTANCE_PRESETS.length + 1}>
            {MATCHING_DISTANCE_PRESETS.map((value) => (
              <FilterChip
                active={Math.round(distance) === value}
                key={value}
                label={`${value} กม.`}
                onPress={() => setDistance(value)}
              />
            ))}
            <FilterChip
              active={distance === MATCHING_UNLIMITED_DISTANCE}
              label="ไม่จำกัด"
              onPress={() => setDistance(MATCHING_UNLIMITED_DISTANCE)}
            />
          </ChipGrid>
        </View>
        <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>
          ระยะใกล้กว่า 700 ม. แสดงเป็น 700 ม. และไม่เปิดเผยพิกัด
        </Text>

        <FilterSectionLabel label="คณะ" />
        {advancedFilters.locked ? <Pressable accessibilityRole="button" onPress={() => router.push('/membership')}>
          <Text style={[styles.filterHelper, { color: colors.primary }]}>CampusMate Plus: คณะ ชั้นปี เวลาว่างและเพซ — ดูแพ็กเกจ</Text>
        </Pressable> : null}
        <ThemedSelect
          enabled={canAdvanced && !sameFacultyOnly}
          onValueChange={(value) => {
            setFaculty(value);
            setSameFacultyOnly(false);
          }}
          options={[{ value: 'all', label: 'ทุกคณะ' }, ...FACULTIES.map((item) => ({ value: item, label: item }))]}
          value={sameFacultyOnly ? 'all' : faculty}
        />
        <SwitchRow
          label="เฉพาะคณะเดียวกับฉัน"
          onValueChange={(value) => {
            if (!advancedFilters.guard()) return;
            setSameFacultyOnly(value);
            if (value) setFaculty('all');
          }}
          value={sameFacultyOnly}
        />

        <FilterSectionLabel label="ชั้นปี" />
        <FilterChipGroup onChange={paidChange(setYears)} options={MATCHING_YEAR_OPTIONS} state={years} />

        <FilterSectionLabel label="กิจกรรม" />
        <ChipGrid count={MATCHING_PRIMARY_ACTIVITY_OPTIONS.length + 2}>
          <FilterChip
            active={isMatchingOptionUnrestricted(MATCHING_ACTIVITY_OPTIONS, activities)}
            label="ทั้งหมด"
            onPress={() => setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS))}
            quiet
          />
          {MATCHING_PRIMARY_ACTIVITY_OPTIONS.map(({ label, value }) => (
            <FilterChip
              active={!!activities[value]}
              key={value}
              label={label}
              onPress={() => setActivities((current) => toggleMatchingOption(MATCHING_ACTIVITY_OPTIONS, current, value))}
            />
          ))}
          <FilterChip
            active={moreActivityActive}
            label="เพิ่มเติม"
            onPress={() => setShowMoreActivities((current) => !current)}
          />
        </ChipGrid>
        {showMoreActivities || moreActivityActive ? (
          <ChipGrid count={MATCHING_MORE_ACTIVITY_OPTIONS.length}>
            {MATCHING_MORE_ACTIVITY_OPTIONS.map(({ label, value }) => (
              <FilterChip
                active={!!activities[value]}
                key={value}
                label={label}
                onPress={() => setActivities((current) => toggleMatchingOption(MATCHING_ACTIVITY_OPTIONS, current, value))}
              />
            ))}
          </ChipGrid>
        ) : null}

        {showPace ? (
          <>
            <FilterSectionLabel label="เพซวิ่ง" />
            <FilterChipGroup onChange={paidChange(setPaces)} options={MATCHING_PACE_OPTIONS} state={paces} />
          </>
        ) : null}

        {detailFilterSections.map((section) => (
          <ActivityDetailFilterCard
            filters={activeDetailFilters[section.id] || {}}
            key={section.id}
            onClear={(fieldKey) => setDetailFilters((current) => clearActivityDetailFilter(current, section.id, fieldKey))}
            onToggle={(fieldKey, option) => setDetailFilters((current) => (
              toggleActivityDetailFilter(current, section.id, fieldKey, option)
            ))}
            section={section}
          />
        ))}
        {selectedActivities.length === 0 ? (
          <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>
            เลือกกิจกรรมเฉพาะเจาะจงเพื่อกรองรายละเอียด เช่น ชนิดกีฬา วิชาที่ติว หรือแนวเพลง
          </Text>
        ) : null}

        <FilterSectionLabel label="วันที่สะดวก" />
        <FilterChipGroup onChange={paidChange(setWeekdays)} options={MATCHING_WEEKDAY_OPTIONS} state={weekdays} />

        <FilterSectionLabel label="ช่วงเวลา" />
        <FilterChipGroup
          onChange={paidChange(setAvailabilityPeriods)}
          options={MATCHING_AVAILABILITY_OPTIONS}
          state={availabilityPeriods}
        />

        <FilterSectionLabel label="เงื่อนไขเพิ่มเติม" />
        <View style={[styles.switchCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <SwitchRow
            label="ต้องมีรูปโปรไฟล์"
            onValueChange={setRequirePhoto}
            value={requirePhoto}
          />
          <SwitchRow
            last
            label="ต้องระบุเวลาว่าง"
            onValueChange={paidChange(setRequireAvailability)}
            value={requireAvailability}
          />
        </View>
      </ScrollView>
      <View style={[styles.settingsFooter, { borderTopColor: colors.line, backgroundColor: colors.canvas }]}>
        {saving ? <Text style={[styles.savingText, { color: colors.primary }]}>กำลังบันทึกการตั้งค่า…</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={saveSearchSettings}
          style={({ pressed }) => [
            styles.doneButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
            saving && styles.disabled,
          ]}
        >
          <Text style={[styles.doneButtonText, { color: colors.onPrimary }]}>{saving ? 'กำลังบันทึก…' : 'บันทึกตัวกรอง'}</Text>
        </Pressable>
      </View>
    </>
  );

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <SheetHeader colors={colors} showGrabber={false} />
        {body}
      </View>
    );
  }

  return (
    <DismissibleSheet colors={colors} onClose={closeSheet}>
      {body}
    </DismissibleSheet>
  );
}

function SheetHeader({ colors, showGrabber }) {
  return (
    <View
      accessibilityHint="ลากลงเพื่อปิดแผง"
      accessibilityLabel="แถบลากปิด"
      collapsable={false}
      style={styles.sheetHeader}
    >
      {showGrabber ? (
        <View style={styles.grabberHit}>
          <View style={[styles.grabber, { backgroundColor: colors.inkSoft }]} />
        </View>
      ) : <View style={styles.iosGrabberSpacer} />}
      <Text style={[styles.sheetTitle, { color: colors.ink }]}>ตั้งค่าการจับคู่</Text>
    </View>
  );
}

function DismissibleSheet({ children, colors, onClose }) {
  const insets = useSafeAreaInsets();
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
    isClosingRef.current = false;
    translateY.set(600);
    fadeAnim.set(0);
    translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
    fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, translateY]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeWithAnimation();
      return true;
    });
    return () => sub.remove();
  }, [closeWithAnimation]);

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

  const fadeStyle = useAnimatedStyle(() => {
    const dragged = translateY.get();
    const dragFade = dragged > 0 ? Math.max(0.2, 1 - dragged / 420) : 1;
    return { opacity: fadeAnim.get() * dragFade };
  });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  return (
    <View style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,24,40,0.42)' }, fadeStyle]}>
        <Pressable accessibilityLabel="ปิดแผง" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={[
          styles.jsSheet,
          { backgroundColor: colors.canvas, paddingBottom: Math.max(insets.bottom, spacing.sm) },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <SheetHeader colors={colors} showGrabber />
        </GestureDetector>
        {children}
      </Animated.View>
    </View>
  );
}

function pickChipColumns(count) {
  if (count <= 5) return count;
  if (count === 6) return 3;
  if (count % 4 !== 1) return 4;
  if (count % 3 !== 1) return 3;
  return 5;
}

function ChipGrid({ children, count }) {
  const columns = pickChipColumns(count ?? React.Children.count(children));
  return (
    <View style={styles.chipGrid}>
      {React.Children.map(children, (child) => (
        <View style={[styles.chipCell, { width: `${100 / columns}%` }]}>{child}</View>
      ))}
    </View>
  );
}

function FilterChipGroup({ allLabel = 'ทั้งหมด', onChange, options, state }) {
  const unrestricted = isMatchingOptionUnrestricted(options, state);
  return (
    <ChipGrid count={options.length + 1}>
      <FilterChip
        active={unrestricted}
        label={allLabel}
        onPress={() => onChange(createMatchingOptionState(options))}
        quiet
      />
      {options.map(({ label, value }) => (
        <FilterChip
          active={!unrestricted && !!state[value]}
          key={value}
          label={label}
          onPress={() => onChange(toggleMatchingOption(options, state, value))}
        />
      ))}
    </ChipGrid>
  );
}

function FilterChip({ active, label, onPress, quiet = false }) {
  const { colors } = useTheme();
  const filled = active && !quiet;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: filled ? colors.primary : colors.card,
          borderColor: active ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.filterChipText, { color: filled ? colors.onPrimary : active ? colors.primary : colors.inkMuted }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AgePicker({ label, onValueChange, value }) {
  return (
    <View style={styles.agePickerColumn}>
      <ThemedSelect
        label={label}
        onValueChange={onValueChange}
        options={MATCHING_AGE_VALUES.map((age) => ({ value: age, label: `${age} ปี` }))}
        value={value}
      />
    </View>
  );
}

function ThemedSelect({ enabled = true, label, onValueChange, options, value }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={!enabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.selectField,
          { backgroundColor: colors.card, borderColor: colors.line },
          !enabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.selectCopy}>
          {label ? <Text style={[styles.agePickerLabel, { color: colors.inkMuted }]}>{label}</Text> : null}
          <Text numberOfLines={1} style={[styles.selectValue, { color: colors.ink }]}>
            {selected?.label || 'เลือก'}
          </Text>
        </View>
        <FeatureIcon color={colors.inkMuted} name="chevron.down" size={16} />
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.selectOverlay}>
          <Pressable onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={[styles.selectSheet, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <Text style={[styles.selectSheetTitle, { color: colors.ink }]}>{label || 'เลือก'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.selectList}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={String(option.value)}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.selectOption,
                      { backgroundColor: active ? colors.primarySoft : 'transparent' },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.selectOptionText, { color: active ? colors.primary : colors.ink }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function FilterSectionLabel({ label }) {
  const { colors } = useTheme();
  return <Text style={[styles.settingLabel, { color: colors.inkMuted }]}>{label}</Text>;
}

// Detail filters for one selected activity (e.g. sports type, study subject).
// Each field is a multi-select chip group; no selection means "any".
function ActivityDetailFilterCard({ filters, onClear, onToggle, section }) {
  const { colors } = useTheme();
  const hasSelection = Object.keys(sanitizeActivityDetailFilters({ [section.id]: filters })).length > 0;
  return (
    <View style={[styles.detailFilterCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <View style={styles.detailFilterHeader}>
        <FeatureIcon color={colors.primary} name={section.symbol} size={16} />
        <Text style={[styles.detailFilterTitle, { color: colors.ink }]}>รายละเอียด{section.label}</Text>
        {hasSelection ? (
          <Pressable accessibilityRole="button" onPress={() => onClear()}>
            <Text style={[styles.resetText, { color: colors.primary }]}>ล้าง</Text>
          </Pressable>
        ) : null}
      </View>
      {section.fields.map((field) => {
        const selected = filters[field.key] || [];
        return (
          <View key={field.key}>
            <Text style={[styles.detailFilterLabel, { color: colors.inkMuted }]}>{field.label}</Text>
            <ChipGrid count={field.options.length + 1}>
              <FilterChip
                active={selected.length === 0}
                label="ทั้งหมด"
                onPress={() => onClear(field.key)}
                quiet
              />
              {field.options.map(({ label, value }) => (
                <FilterChip
                  active={selected.includes(value)}
                  key={value}
                  label={label}
                  onPress={() => onToggle(field.key, value)}
                />
              ))}
            </ChipGrid>
          </View>
        );
      })}
    </View>
  );
}

function SwitchRow({ last = false, label, onValueChange, value }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[styles.switchRow, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.switchLabel, { color: colors.ink }]}>{label}</Text>
      <Switch
        ios_backgroundColor={isDark ? colors.line : colors.surfaceRaised}
        onValueChange={onValueChange}
        thumbColor={colors.onPrimary}
        trackColor={{ false: colors.line, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  jsSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '92%',
    overflow: 'hidden',
    width: '100%',
  },
  screen: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flex: 1,
    overflow: 'hidden',
  },
  settingsScroll: { flex: 1 },
  sheetHeader: { alignItems: 'center', paddingBottom: spacing.sm, paddingTop: spacing.xs },
  grabberHit: { alignItems: 'center', justifyContent: 'center', minHeight: 28, paddingVertical: 12, width: '100%' },
  iosGrabberSpacer: { height: spacing.sm },
  grabber: { borderRadius: 2, height: 5, width: 40 },
  sheetTitle: { fontSize: type.headline, fontWeight: '700' },
  settingsFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  settingsContent: { gap: spacing.sm, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  introRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  introText: { flex: 1 },
  resetText: { fontSize: type.caption, fontWeight: '700' },
  settingLabel: { fontSize: type.caption, fontWeight: '600', marginTop: spacing.sm },
  filterHelper: { fontSize: type.caption2, lineHeight: 18 },
  detailFilterCard: { borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs, marginTop: spacing.sm, padding: spacing.md, paddingBottom: spacing.xs },
  detailFilterHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  detailFilterTitle: { flex: 1, fontSize: type.caption, fontWeight: '800' },
  detailFilterLabel: { fontSize: type.caption2, fontWeight: '600', marginBottom: spacing.xs, marginTop: spacing.xs },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  chipCell: { paddingBottom: 8, paddingHorizontal: 4 },
  filterChip: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 6,
    width: '100%',
  },
  filterChipText: { fontSize: type.caption2, fontWeight: '700' },
  agePickerRow: { flexDirection: 'row', gap: spacing.sm },
  agePickerColumn: { flex: 1, gap: spacing.xs },
  agePickerLabel: { fontSize: type.caption2, fontWeight: '600' },
  selectField: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  selectCopy: { flex: 1, gap: 2, paddingRight: spacing.sm },
  selectValue: { fontSize: type.body, fontWeight: '600' },
  selectOverlay: { alignItems: 'center', backgroundColor: 'rgba(16,24,40,0.45)', flex: 1, justifyContent: 'center', padding: spacing.lg },
  selectSheet: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, maxHeight: '70%', overflow: 'hidden', width: '100%' },
  selectSheetTitle: { fontSize: type.headline, fontWeight: '700', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  selectList: { maxHeight: 360, marginTop: spacing.sm },
  selectOption: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.lg },
  selectOptionText: { fontSize: type.body, fontWeight: '600' },
  distanceCard: { borderRadius: radius.lg, gap: spacing.md, padding: spacing.md },
  distanceValue: { fontSize: type.title, fontWeight: '600' },
  switchCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  switchRow: { alignItems: 'center', flexDirection: 'row', minHeight: 52, paddingHorizontal: spacing.md },
  switchLabel: { flex: 1, fontSize: type.body, fontWeight: '600' },
  savingText: { fontSize: type.caption, fontWeight: '600' },
  doneButton: { alignItems: 'center', borderCurve: 'continuous', borderRadius: radius.md, justifyContent: 'center', minHeight: 48 },
  doneButtonText: { fontSize: type.body, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
});
