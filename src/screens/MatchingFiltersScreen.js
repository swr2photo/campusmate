import Text from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, Stack, useNavigation } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { project, rubberband } from '../utils/motion';
import { FACULTIES } from '../data/faculties';
import {
  MATCHING_ACTIVITY_OPTIONS, MATCHING_AGE_MAX, MATCHING_AGE_MIN,
  MATCHING_AVAILABILITY_OPTIONS, MATCHING_DEFAULT_AGE_MAX, MATCHING_GENDER_OPTIONS,
  MATCHING_PACE_OPTIONS, MATCHING_UNLIMITED_DISTANCE, MATCHING_WEEKDAY_OPTIONS,
  MATCHING_YEAR_OPTIONS, clearActivityDetailFilter, createMatchingOptionState,
  getActivityDetailFilterOptions, getSelectedMatchingValues, normalizeMatchingAge,
  pruneActivityDetailFilters, toggleMatchingOption,
} from '../data/matchingFilters';
import { useAppActions, useAppProfile } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import { FilterSlider, FilterSwitch } from '../components/filter-controls';
import AgeRangeSlider from '../components/age-range-slider';
import { useEntitlement } from '../context/MembershipContext';
import { FEATURE_ADVANCED_FILTERS } from '../data/plans';
import { spacing, useTheme } from '../theme';

function optionSummary(options, state, allLabel = 'ทั้งหมด') {
  const selected = getSelectedMatchingValues(options, state);
  if (!selected.length) return allLabel;
  const labels = options.filter(option => selected.includes(option.value)).map(option => option.longLabel || option.label);
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
}

export default function MatchingFiltersScreen() {
  const { colors } = useTheme();
  const { profile } = useAppProfile();
  const { saveMatchingPreferences } = useAppActions();
  const navigation = useNavigation();
  const advancedFilters = useEntitlement(FEATURE_ADVANCED_FILTERS);
  const canAdvanced = advancedFilters.allowed;
  const insets = useSafeAreaInsets();
  const dirty = useRef(false);
  const hydratedProfileId = useRef(null);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const lastDistance = useRef(25);
  const distanceSliderMax = useRef(100);
  const [faculty, setFaculty] = useState('all');
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [distance, setDistance] = useState(MATCHING_UNLIMITED_DISTANCE);
  const [ageMin, setAgeMin] = useState(MATCHING_AGE_MIN);
  const [ageMax, setAgeMax] = useState(MATCHING_DEFAULT_AGE_MAX);
  const [years, setYears] = useState(() => createMatchingOptionState(MATCHING_YEAR_OPTIONS));
  const [genders, setGenders] = useState(() => createMatchingOptionState(MATCHING_GENDER_OPTIONS));
  const [activities, setActivities] = useState(() => createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
  const [paces, setPaces] = useState(() => createMatchingOptionState(MATCHING_PACE_OPTIONS));
  const [availabilityPeriods, setAvailabilityPeriods] = useState(() => createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
  const [weekdays, setWeekdays] = useState(() => createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS));
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [requireAvailability, setRequireAvailability] = useState(false);
  const [detailFilters, setDetailFilters] = useState({});
  const [popup, setPopup] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // An optimistic profile update or entitlement refresh must not overwrite
    // an edited draft, especially while a failed save is waiting for a retry.
    if (hydratedProfileId.current === profile?.id && dirty.current) return;
    hydratedProfileId.current = profile?.id;
    dirty.current = false;
    // Keep stored Plus values in the draft even while entitlement is loading.
    // Paid controls and AppContext's save action enforce the current entitlement.
    const preferences = profile?.matchingPreferences || {};
    const selectedActivities = preferences.activities || [];
    const min = normalizeMatchingAge(preferences.ageMin, MATCHING_AGE_MIN);
    const max = Math.max(min, normalizeMatchingAge(preferences.ageMax, MATCHING_DEFAULT_AGE_MAX));
    const nextDistance = Number.isFinite(Number(preferences.maxDistance)) ? Math.max(0, Number(preferences.maxDistance)) : MATCHING_UNLIMITED_DISTANCE;
    if (nextDistance > 0) lastDistance.current = nextDistance;
    distanceSliderMax.current = Math.max(100, nextDistance);
    setFaculty(preferences.faculty || 'all');
    setSameFacultyOnly(preferences.sameFacultyOnly === true);
    setDistance(nextDistance);
    setAgeMin(min);
    setAgeMax(max);
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, selectedActivities));
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS, preferences.years || []));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS, preferences.genders || []));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS, preferences.paces || []));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS, preferences.availabilityPeriods || []));
    setWeekdays(createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS, preferences.weekdays || []));
    setRequirePhoto(preferences.requirePhoto === true);
    setRequireAvailability(preferences.requireAvailability === true);
    setDetailFilters(pruneActivityDetailFilters(preferences.activityDetails, selectedActivities));
    setSaveError(null);
  }, [profile?.id, profile?.matchingPreferences]);

  const change = setter => value => {
    if (submitLock.current) return;
    dirty.current = true;
    setSaveError(null);
    setter(value);
  };
  const paidChange = setter => value => {
    if (advancedFilters.guard()) change(setter)(value);
  };
  const selectedActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
  const showPace = !selectedActivities.length || selectedActivities.includes('running');
  const detailSections = selectedActivities.map(getActivityDetailFilterOptions).filter(Boolean);
  const activeDetailFilters = pruneActivityDetailFilters(detailFilters, selectedActivities);
  const resetFilters = () => {
    if (submitLock.current) return;
    dirty.current = true;
    setSaveError(null);
    setFaculty('all'); setSameFacultyOnly(false); setDistance(25); lastDistance.current = 25; distanceSliderMax.current = 100;
    setAgeMin(MATCHING_AGE_MIN); setAgeMax(MATCHING_DEFAULT_AGE_MAX);
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS));
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
    setWeekdays(createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS));
    setRequirePhoto(false); setRequireAvailability(false); setDetailFilters({});
  };
  const closeSheet = () => {
    if (submitLock.current) return;
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };
  const saveSearchSettings = async () => {
    if (submitLock.current || !mounted.current) return;
    submitLock.current = true;
    setSaving(true); setSaveError(null);
    try {
      const nextActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
      const min = normalizeMatchingAge(Math.round(ageMin), MATCHING_AGE_MIN);
      const max = Math.max(min, normalizeMatchingAge(Math.round(ageMax), MATCHING_DEFAULT_AGE_MAX));
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        activities: nextActivities,
        activityDetails: pruneActivityDetailFilters(detailFilters, nextActivities),
        ageMin: min, ageMax: max,
        availabilityPeriods: getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods),
        faculty: sameFacultyOnly ? 'all' : faculty,
        genders: getSelectedMatchingValues(MATCHING_GENDER_OPTIONS, genders),
        maxDistance: Math.round(distance),
        paces: showPace ? getSelectedMatchingValues(MATCHING_PACE_OPTIONS, paces) : [],
        requireAvailability, requirePhoto, sameFacultyOnly,
        weekdays: getSelectedMatchingValues(MATCHING_WEEKDAY_OPTIONS, weekdays),
        years: getSelectedMatchingValues(MATCHING_YEAR_OPTIONS, years),
      });
      if (!mounted.current || !navigation.isFocused()) return;
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (error) {
      if (mounted.current) setSaveError(error?.message || 'บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง');
    } finally {
      submitLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const openPopup = (key, paid = false) => {
    if (submitLock.current || (paid && !advancedFilters.guard())) return;
    setPopup(key);
  };
  const popupOptions = {
    gender: { title: 'คนที่คุณสนใจ', options: MATCHING_GENDER_OPTIONS, state: genders, onChange: change(setGenders) },
    activities: { title: 'กิจกรรมที่สนใจ', options: MATCHING_ACTIVITY_OPTIONS, state: activities, onChange: change(setActivities) },
    faculty: { title: 'คณะ', options: [{ value: 'all', label: 'ทุกคณะ' }, ...FACULTIES.map(item => ({ value: item, label: item }))], value: faculty, single: true, onChange: paidChange(value => { setFaculty(value); setSameFacultyOnly(false); }) },
    years: { title: 'ชั้นปี', options: MATCHING_YEAR_OPTIONS, state: years, onChange: paidChange(setYears) },
    paces: { title: 'เพซวิ่ง', options: MATCHING_PACE_OPTIONS, state: paces, onChange: paidChange(setPaces) },
    weekdays: { title: 'วันที่สะดวก', options: MATCHING_WEEKDAY_OPTIONS, state: weekdays, onChange: paidChange(setWeekdays) },
    availability: { title: 'ช่วงเวลาที่สะดวก', options: MATCHING_AVAILABILITY_OPTIONS, state: availabilityPeriods, onChange: paidChange(setAvailabilityPeriods) },
  };
  detailSections.forEach(section => section.fields.forEach(field => {
    const selected = activeDetailFilters[section.id]?.[field.key] || [];
    popupOptions[`detail:${section.id}:${field.key}`] = {
      title: field.label, options: field.options,
      state: createMatchingOptionState(field.options, selected),
      onChange: change(next => {
        const values = getSelectedMatchingValues(field.options, next);
        setDetailFilters(current => values.length
          ? { ...current, [section.id]: { ...(current[section.id] || {}), [field.key]: values } }
          : clearActivityDetailFilter(current, section.id, field.key));
      }),
    };
  }));
  const header = <SheetHeader colors={colors} saving={saving} onClose={closeSheet} onSave={saveSearchSettings} />;
  const body = <>
    <View style={styles.body} pointerEvents={saving ? 'none' : 'auto'}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: Math.max(32, insets.bottom + 24) }]}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <Text style={[styles.intro, { color: colors.inkMuted }]}>เลือกคนที่คุณอยากเจอ และกิจกรรมที่อยากทำด้วยกัน</Text>
        <SectionLabel label="การค้นหาพื้นฐาน" colors={colors} />
        <SettingsCard colors={colors}>
          <View style={[styles.sliderSection, { borderBottomColor: colors.line }]}>
            <View style={styles.labelValue}><Text style={[styles.rowLabel, { color: colors.ink }]}>ระยะห่างสูงสุด</Text><Text style={[styles.rowValue, { color: colors.primary }]}>{distance === MATCHING_UNLIMITED_DISTANCE ? 'ไม่จำกัด' : `${Math.round(distance)} กม.`}</Text></View>
            <FilterSlider label="ระยะห่างสูงสุด" value={distance || lastDistance.current} min={1} max={distanceSliderMax.current} onValueChange={change(value => { const next = Math.round(value); lastDistance.current = next; setDistance(next); })} />
            <View style={styles.sliderLimits}><Text style={[styles.helper, { color: colors.inkMuted }]}>1 กม.</Text><Text style={[styles.helper, { color: colors.inkMuted }]}>{distanceSliderMax.current} กม.</Text></View>
            <ToggleRow label="ไม่จำกัดระยะทาง" value={distance === MATCHING_UNLIMITED_DISTANCE} onValueChange={change(value => setDistance(value ? MATCHING_UNLIMITED_DISTANCE : lastDistance.current))} colors={colors} inset={false} />
          </View>
          <SelectionRow label="คนที่สนใจ" value={optionSummary(MATCHING_GENDER_OPTIONS, genders)} onPress={() => openPopup('gender')} colors={colors} />
          <View style={[styles.sliderSection, { borderBottomColor: colors.line }]}>
            <View style={styles.labelValue}><Text style={[styles.rowLabel, { color: colors.ink }]}>ช่วงอายุ</Text><Text style={[styles.rowValue, { color: colors.primary }]}>{ageMin}–{ageMax} ปี</Text></View>
            <AgeRangeSlider min={MATCHING_AGE_MIN} max={MATCHING_AGE_MAX} minValue={ageMin} maxValue={ageMax}
              onChangeMin={change(value => { const next = normalizeMatchingAge(value, ageMin); setAgeMin(next); if (next > ageMax) setAgeMax(next); })}
              onChangeMax={change(value => { const next = normalizeMatchingAge(value, ageMax); setAgeMax(next); if (next < ageMin) setAgeMin(next); })} />
          </View>
          <ToggleRow label="ต้องมีรูปโปรไฟล์" value={requirePhoto} onValueChange={change(setRequirePhoto)} colors={colors} last />
        </SettingsCard>
        <Text style={[styles.note, { color: colors.inkMuted }]}>แสดงระยะใกล้กว่า 700 ม. เป็น 700 ม. เพื่อรักษาความเป็นส่วนตัว</Text>

        <SectionLabel label="กิจกรรมที่อยากทำ" colors={colors} />
        <SettingsCard colors={colors}>
          <SelectionRow label="กิจกรรม" value={optionSummary(MATCHING_ACTIVITY_OPTIONS, activities)} onPress={() => openPopup('activities')} colors={colors} last />
        </SettingsCard>
        {detailSections.map(section => <View key={section.id} style={styles.detailSection}>
          <SectionLabel label={`รายละเอียด${section.label}`} colors={colors} />
          <SettingsCard colors={colors}>{section.fields.map((field, index) => <SelectionRow key={field.key} label={field.label}
            value={optionSummary(field.options, createMatchingOptionState(field.options, activeDetailFilters[section.id]?.[field.key] || []))}
            onPress={() => openPopup(`detail:${section.id}:${field.key}`)} colors={colors} last={index === section.fields.length - 1} />)}</SettingsCard>
        </View>)}
        {!selectedActivities.length ? <Text style={[styles.note, { color: colors.inkMuted }]}>เลือกกิจกรรมเพื่อระบุรายละเอียด เช่น ชนิดกีฬา วิชาที่ติว หรือแนวเพลง</Text> : null}

        <View style={styles.plusHeading}><SectionLabel label="ตัวกรองเพิ่มเติม" colors={colors} /><View style={[styles.plusBadge, { backgroundColor: colors.primarySoft }]}><FeatureIcon name="sparkles" size={12} color={colors.primary} /><Text style={[styles.plusBadgeText, { color: colors.primary }]}>CampusMate Plus</Text></View></View>
        <SettingsCard colors={colors}>
          <SelectionRow label="คณะ" value={sameFacultyOnly ? 'คณะเดียวกับฉัน' : faculty === 'all' ? 'ทุกคณะ' : faculty} onPress={() => openPopup('faculty', true)} colors={colors} locked={!canAdvanced} />
          <ToggleRow label="เฉพาะคณะเดียวกับฉัน" value={sameFacultyOnly} onValueChange={paidChange(value => { setSameFacultyOnly(value); if (value) setFaculty('all'); })} colors={colors} locked={!canAdvanced} />
          <SelectionRow label="ชั้นปี" value={optionSummary(MATCHING_YEAR_OPTIONS, years)} onPress={() => openPopup('years', true)} colors={colors} locked={!canAdvanced} />
          {showPace ? <SelectionRow label="เพซวิ่ง" value={optionSummary(MATCHING_PACE_OPTIONS, paces)} onPress={() => openPopup('paces', true)} colors={colors} locked={!canAdvanced} /> : null}
          <SelectionRow label="วันที่สะดวก" value={optionSummary(MATCHING_WEEKDAY_OPTIONS, weekdays)} onPress={() => openPopup('weekdays', true)} colors={colors} locked={!canAdvanced} />
          <SelectionRow label="ช่วงเวลาที่สะดวก" value={optionSummary(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods)} onPress={() => openPopup('availability', true)} colors={colors} locked={!canAdvanced} />
          <ToggleRow label="ต้องระบุเวลาว่าง" value={requireAvailability} onValueChange={paidChange(setRequireAvailability)} colors={colors} locked={!canAdvanced} last />
        </SettingsCard>
        {!canAdvanced ? <Text style={[styles.note, { color: colors.inkMuted }]}>{advancedFilters.loading ? 'กำลังตรวจสอบสถานะ CampusMate Plus…' : 'ตัวกรองเพิ่มเติมจะทำงานเมื่อใช้ CampusMate Plus'}</Text> : null}
        <Pressable accessibilityRole="button" onPress={resetFilters} style={[styles.resetButton, { backgroundColor: colors.card }]}><Text style={[styles.resetText, { color: colors.primary }]}>รีเซ็ตตัวกรอง</Text></Pressable>
        <Text style={[styles.note, { color: colors.inkMuted, textAlign: 'center' }]}>แตะ ✓ เพื่อบันทึก · ปิดหน้าต่างเพื่อยกเลิกการเปลี่ยนแปลง</Text>
      </ScrollView>
    </View>
    {saveError ? <View accessibilityRole="alert" style={[styles.errorBar, { backgroundColor: colors.card, borderTopColor: colors.line }]}><Text style={[styles.errorText, { color: colors.danger }]}>{saveError}</Text><Pressable accessibilityRole="button" onPress={saveSearchSettings} style={styles.retry}><Text style={[styles.retryText, { color: colors.primary }]}>ลองบันทึกอีกครั้ง</Text></Pressable></View> : null}
    <SelectionPopup config={popupOptions[popup]} onClose={() => setPopup(null)} />
  </>;
  return <>
    <Stack.Screen options={{ gestureEnabled: Platform.OS === 'ios' && !saving }} />
    {Platform.OS === 'ios'
      ? <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{header}{body}</View>
      : <DismissibleSheet colors={colors} onClose={closeSheet} dismissDisabled={saving} header={header}>{body}</DismissibleSheet>}
  </>;
}

function SheetHeader({ colors, saving, onClose, onSave }) {
  return <View style={[styles.header, { backgroundColor: colors.canvas, borderBottomColor: colors.line }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="ปิดโดยไม่บันทึก" disabled={saving} onPress={onClose} style={styles.headerButton}><FeatureIcon name="xmark" size={21} color={colors.inkMuted} /></Pressable>
    <Text style={[styles.headerTitle, { color: colors.ink }]}>ตั้งค่าการค้นหา</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="บันทึกการตั้งค่าค้นหา" accessibilityState={{ busy: saving }} disabled={saving} onPress={onSave} style={[styles.headerButton, styles.confirmButton, { backgroundColor: colors.primary }]}>{saving ? <ActivityIndicator color={colors.onPrimary} /> : <FeatureIcon name="checkmark" size={24} color={colors.onPrimary} />}</Pressable>
  </View>;
}

function SettingsCard({ colors, children }) {
  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}
function SectionLabel({ label, colors }) { return <Text style={[styles.sectionLabel, { color: colors.ink }]}>{label}</Text>; }
function SelectionRow({ label, value, onPress, colors, locked, last }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}${locked ? ' CampusMate Plus' : ''}`} onPress={onPress}
    style={({ pressed }) => [styles.selectionRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed && styles.pressed]}>
    <Text style={[styles.rowLabel, { color: colors.ink }]}>{label}</Text>
    <View style={styles.rowTrailing}><Text numberOfLines={1} style={[styles.selectionValue, { color: colors.inkMuted }]}>{value}</Text><FeatureIcon name={locked ? 'lock.fill' : 'chevron.right'} size={locked ? 13 : 14} color={colors.inkMuted} /></View>
  </Pressable>;
}
function ToggleRow({ label, value, onValueChange, colors, locked, last, inset = true }) {
  const Container = locked ? Pressable : View;
  return <Container accessibilityRole={locked ? 'button' : undefined} accessibilityLabel={locked ? `${label}: CampusMate Plus` : undefined} onPress={locked ? () => onValueChange(!value) : undefined}
    style={[styles.toggleRow, !inset && styles.noInset, !last && inset && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
    <View style={styles.toggleLabel}><Text style={[styles.rowLabel, { color: colors.ink }]}>{label}</Text>{locked ? <FeatureIcon name="lock.fill" size={12} color={colors.inkMuted} /> : null}</View>
    <View pointerEvents={locked ? 'none' : 'auto'} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}><FilterSwitch label={label} value={value} onValueChange={onValueChange} disabled={locked} /></View>
  </Container>;
}

function SelectionPopup({ config, onClose }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const lastConfig = useRef(config);
  if (config) lastConfig.current = config;
  const current = config || lastConfig.current;
  const options = current?.options || [];
  const selected = current?.single ? [current.value] : getSelectedMatchingValues(options, current?.state || {});
  const all = !current?.single && !selected.length;
  const choose = option => {
    if (current.single) { current.onChange(option.value); onClose(); }
    else current.onChange(toggleMatchingOption(options, current.state, option.value));
  };
  return <Modal visible={Boolean(config)} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.popupOverlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="ปิดตัวเลือก" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[styles.popup, { backgroundColor: colors.card, maxHeight: height * 0.78, paddingBottom: Math.max(12, insets.bottom + 8) }]}>
        <View style={[styles.popupHeader, { borderBottomColor: colors.line }]}><Text style={[styles.popupTitle, { color: colors.ink }]}>{current?.title || 'เลือกตัวกรอง'}</Text><Pressable accessibilityRole="button" accessibilityLabel="เสร็จสิ้นการเลือก" onPress={onClose} style={styles.headerButton}><FeatureIcon name="checkmark" size={22} color={colors.primary} /></Pressable></View>
        {!current?.single ? <Text style={[styles.popupHelper, { color: colors.inkMuted }]}>เลือกได้มากกว่าหนึ่งรายการ · ทั้งหมดหมายถึงไม่จำกัด</Text> : null}
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.popupList}>
          {!current?.single ? <PopupOption label="ทั้งหมด" active={all} colors={colors} onPress={() => current.onChange(createMatchingOptionState(options))} /> : null}
          {options.map(option => <PopupOption key={String(option.value)} label={option.longLabel || option.label} active={current?.single ? selected.includes(option.value) : !all && !!current?.state?.[option.value]} single={current?.single} colors={colors} onPress={() => choose(option)} />)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
function PopupOption({ label, active, colors, onPress, single }) {
  return <Pressable accessibilityRole={single ? 'radio' : 'checkbox'} accessibilityState={{ checked: active }} onPress={onPress} style={({ pressed }) => [styles.popupOption, { borderBottomColor: colors.line, backgroundColor: active ? colors.primarySoft : colors.card }, pressed && styles.pressed]}><Text style={[styles.popupOptionText, { color: active ? colors.primary : colors.ink }]}>{label}</Text>{active ? <FeatureIcon name="checkmark" size={18} color={colors.primary} /> : <View style={{ width: 18 }} />}</Pressable>;
}
function DismissibleSheet({ children, colors, onClose, dismissDisabled = false, header }) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(600);
  const fadeAnim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const disabledRef = useRef(dismissDisabled);
  disabledRef.current = dismissDisabled;

  const unlockClose = useCallback(() => {
    isClosingRef.current = false;
  }, []);

  const finishClose = useCallback(() => {
    closeRef.current?.();
    isClosingRef.current = false;
  }, []);

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current || disabledRef.current) return;
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
    .enabled(!dismissDisabled)
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
    }), [closeWithAnimation, dismissDisabled, dragStartY, fadeAnim, translateY, unlockClose]);

  const fadeStyle = useAnimatedStyle(() => {
    const dragged = translateY.get();
    const dragFade = dragged > 0 ? Math.max(0.2, 1 - dragged / 420) : 1;
    return { opacity: fadeAnim.get() * dragFade };
  });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  return (
    <View style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,24,40,0.42)' }, fadeStyle]}>
        <Pressable accessibilityLabel="ปิดแผง" disabled={dismissDisabled} onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={[
          styles.jsSheet,
          { backgroundColor: colors.canvas, paddingBottom: Math.max(insets.bottom, spacing.sm) },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.grabberHit}><View style={[styles.grabber, { backgroundColor: colors.inkMuted }]} /></View>
        </GestureDetector>
        {header}
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  body: { flex: 1 },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  confirmButton: { borderRadius: 22 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  intro: { fontSize: 13, lineHeight: 22, paddingHorizontal: 2, marginBottom: 4 },
  sectionLabel: { fontSize: 16, fontWeight: '700', paddingHorizontal: 3, paddingTop: 8 },
  card: { borderRadius: 26, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 0 },
  sliderSection: { paddingHorizontal: 16, paddingTop: 17, paddingBottom: 11, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  labelValue: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  rowLabel: { fontSize: 14, lineHeight: 23, fontWeight: '500', flexShrink: 1 },
  rowValue: { fontSize: 14, lineHeight: 23, fontWeight: '600' },
  selectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 58, paddingHorizontal: 16, paddingVertical: 14 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, maxWidth: '56%', flexShrink: 1 },
  selectionValue: { fontSize: 14, lineHeight: 22, flexShrink: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 10 },
  noInset: { paddingHorizontal: 0, paddingVertical: 0, minHeight: 44 },
  toggleLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  sliderLimits: { flexDirection: 'row', justifyContent: 'space-between' },
  helper: { fontSize: 11, lineHeight: 18 },
  note: { fontSize: 12, lineHeight: 20, paddingHorizontal: 4, marginBottom: 4 },
  detailSection: { gap: 12 },
  plusHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  plusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  plusBadgeText: { fontSize: 10, fontWeight: '600' },
  resetButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 0, marginTop: 8 },
  resetText: { fontSize: 14, fontWeight: '600' },
  errorBar: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, gap: 4 },
  errorText: { fontSize: 13, lineHeight: 21 },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.72 },
  popupOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(16,24,40,0.42)' },
  popup: { width: '100%', maxWidth: 600, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  popupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 20, paddingRight: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  popupTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  popupHelper: { paddingHorizontal: 20, paddingVertical: 12, fontSize: 12, lineHeight: 20 },
  popupList: { flexShrink: 1 },
  popupOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  popupOptionText: { flex: 1, fontSize: 15, lineHeight: 24 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  jsSheet: { width: '100%', height: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  grabberHit: { alignItems: 'center', justifyContent: 'center', minHeight: 24, paddingTop: 10, paddingBottom: 6 },
  grabber: { width: 38, height: 4, borderRadius: 2 },
});
