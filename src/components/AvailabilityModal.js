import Text from './AppText';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, Pressable, TouchableOpacity, ScrollView, Platform } from 'react-native';
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
import FeatureIcon from './FeatureIcon';
import AvailabilityCalendar from './AvailabilityCalendar';
import { nextAvailabilityDays, availabilitySlotKey, removeAvailabilitySlot } from '../utils/availabilityCalendar';
import { timeToMinutes } from '../data/matchingFilters';
import { useTheme, spacing, type } from '../theme';

// Generate next 14 days
const generateDays = () => {
  return nextAvailabilityDays();
};

const formatDayStr = (date) => {
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
};

const formatIsoDate = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const TIME_OPTIONS = Array.from({ length: 49 }, (_, index) => {
  const minutes = index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});
const DEFAULT_START_TIME = '18:00';
const DEFAULT_END_TIME = '20:00';

const parseLocalIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
};

const normalizeAvailabilitySlot = (slot) => {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return null;
  const date = typeof slot.date === 'string' ? slot.date.trim().slice(0, 32) : '';
  const day = typeof slot.day === 'string' ? slot.day.trim().slice(0, 32) : '';
  const label = typeof slot.label === 'string' ? slot.label.trim().slice(0, 64) : '';
  const start = typeof slot.start === 'string' ? slot.start.trim() : (typeof slot.startTime === 'string' ? slot.startTime.trim() : '');
  const end = typeof slot.end === 'string' ? slot.end.trim() : (typeof slot.endTime === 'string' ? slot.endTime.trim() : '');
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if ((!date && !day && !label) || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  const res = { start, end };
  if (date) res.date = date;
  if (day) res.day = day;
  if (label) res.label = label;
  return res;
};

const normalizeAvailabilitySlots = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(normalizeAvailabilitySlot)
    .filter((slot) => {
      if (!slot) return false;
      const key = `${slot.date || slot.day || ''}|${slot.start}|${slot.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
};

const sortAvailabilitySlots = (value) => (
  [...value].sort((left, right) => (
    `${left.date || left.day || ''}|${left.start}`.localeCompare(`${right.date || right.day || ''}|${right.start}`)
  ))
);

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAlert } from '../utils/appAlert';

export default function AvailabilityModal({ visible, onClose, availabilitySlots, onSave }) {
  const { colors: themeColors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(themeColors, insets);
  
  // Local state for editing
  const [slots, setSlots] = useState([]);
  const [days, setDays] = useState(() => generateDays());
  
  // New slot states
  const [selectedDate, setSelectedDate] = useState(formatIsoDate(new Date()));
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [showTimePicker, setShowTimePicker] = useState(null); // 'start' or 'end'
  const translateY = useSharedValue(600);
  const fadeAnim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isClosingRef = React.useRef(false);
  const wasVisibleRef = React.useRef(false);

  const unlockClose = React.useCallback(() => {
    isClosingRef.current = false;
  }, []);

  const finishClose = React.useCallback(() => {
    onClose();
    isClosingRef.current = false;
  }, [onClose]);

  const closeWithAnimation = React.useCallback(() => {
    if (!visible || isClosingRef.current) return;
    isClosingRef.current = true;
    translateY.set(withSpring(700, { duration: 300, dampingRatio: 0.8 }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
      else scheduleOnRN(unlockClose);
    }));
    fadeAnim.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, finishClose, translateY, unlockClose, visible]);

  const panGesture = React.useMemo(() => Gesture.Pan()
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

  useEffect(() => {
    const justOpened = visible && !wasVisibleRef.current;
    if (justOpened) {
      isClosingRef.current = false;
      translateY.set(600);
      fadeAnim.set(0);
      translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      const nextDays = generateDays();
      setDays(nextDays);
      setSelectedDate(formatIsoDate(nextDays[0]));
      setStartTime(DEFAULT_START_TIME);
      setEndTime(DEFAULT_END_TIME);
      setShowTimePicker(null);
      setSlots(sortAvailabilitySlots(normalizeAvailabilitySlots(availabilitySlots)));
    }
    if (!visible) {
      cancelAnimation(translateY);
      isClosingRef.current = false;
      setShowTimePicker(null);
    }
    wasVisibleRef.current = visible;
  }, [availabilitySlots, fadeAnim, translateY, visible]);

  const handleAddSlot = () => {
    if (!days.some((day) => formatIsoDate(day) === selectedDate)) {
      showAlert('เลือกวันใหม่', 'กรุณาเลือกวันภายใน 14 วันจากปฏิทิน', { tone: 'warning' });
      return;
    }
    if (slots.length >= 50) {
      showAlert('เลือกครบแล้ว', 'เพิ่มได้สูงสุด 50 ช่วงเวลา กรุณาลบบางช่วงก่อนเพิ่มใหม่', { tone: 'warning' });
      return;
    }
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      showAlert('เวลาไม่ถูกต้อง', 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น', { tone: 'warning' });
      return;
    }
    const dateObj = parseLocalIsoDate(selectedDate);
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const newSlot = {
      date: selectedDate,
      day: dateObj ? dayNames[dateObj.getDay()] : '',
      label: dateObj ? formatDayStr(dateObj) : selectedDate,
      start: startTime,
      end: endTime,
    };
    setSlots((currentSlots) => {
      if (currentSlots.some((slot) => (
        (slot.date || slot.day) === (newSlot.date || newSlot.day)
        && slot.start === newSlot.start
        && slot.end === newSlot.end
      ))) {
        return currentSlots;
      }
      return sortAvailabilitySlots([...currentSlots, newSlot]);
    });
  };

  const handleRemoveSlot = (key) => {
    setSlots((currentSlots) => removeAvailabilitySlot(currentSlots, key));
  };

  const handleSave = () => {
    onSave(sortAvailabilitySlots(normalizeAvailabilitySlots(slots)));
    closeWithAnimation();
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      onRequestClose={closeWithAnimation}
      statusBarTranslucent={Platform.OS === 'android'}
      transparent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }, fadeStyle]}>
          <Pressable onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.container, sheetStyle]}>
          <GestureDetector gesture={panGesture}>
          <View accessibilityHint="ลากลงเพื่อปิด" style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>เลือกเวลาที่สะดวก</Text>
          </View>
          </GestureDetector>
          
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            overScrollMode="always"
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <AvailabilityCalendar days={days} selectedDate={selectedDate} onSelect={setSelectedDate} slots={slots} />
            {/* Added Slots */}
            {slots.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>เวลาที่เลือกไว้ ({slots.length})</Text>
                {slots.map((slot) => {
                  const dateObj = parseLocalIsoDate(slot.date);
                  const displayDate = dateObj ? formatDayStr(dateObj) : slot.date;
                  return (
                    <View key={availabilitySlotKey(slot)} style={styles.slotItem}>
                      <View style={styles.slotCopy}>
                        <Text style={styles.slotDate}>{displayDate}</Text>
                        <Text style={styles.slotTime}>{slot.start} - {slot.end}</Text>
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel={`ลบช่วงเวลา ${displayDate} ${slot.start} ถึง ${slot.end}`}
                        onPress={() => handleRemoveSlot(availabilitySlotKey(slot))}
                        style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.65 }]}>
                        <FeatureIcon name="trash" size={18} color={themeColors.danger} />
                        <Text style={styles.removeText}>ลบ</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.divider} />

            {/* Add New Slot */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>เพิ่มช่วงเวลาใหม่</Text>
              
              <Text style={styles.selectedDay}>{formatDayStr(parseLocalIsoDate(selectedDate) || days[0])}</Text>

              <View style={styles.timeRow}>
                <View style={styles.timeCol}>
                  <Text style={styles.label}>เวลาเริ่มต้น</Text>
                  <TouchableOpacity style={styles.timeSelector} onPress={() => setShowTimePicker(showTimePicker === 'start' ? null : 'start')}>
                    <Text style={styles.timeSelectorText}>{startTime}</Text>
                    <FeatureIcon name="clock" size={18} color={themeColors.inkSoft} />
                  </TouchableOpacity>
                </View>
                <View style={styles.timeCol}>
                  <Text style={styles.label}>เวลาสิ้นสุด</Text>
                  <TouchableOpacity style={styles.timeSelector} onPress={() => setShowTimePicker(showTimePicker === 'end' ? null : 'end')}>
                    <Text style={styles.timeSelectorText}>{endTime}</Text>
                    <FeatureIcon name="clock" size={18} color={themeColors.inkSoft} />
                  </TouchableOpacity>
                </View>
              </View>

              {showTimePicker && (
                <View style={styles.timeOptionsContainer}>
                  <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
                    {TIME_OPTIONS
                      .filter((time) => {
                        const minutes = timeToMinutes(time);
                        if (minutes == null) return false;
                        if (showTimePicker === 'start') {
                          const endMinutes = timeToMinutes(endTime);
                          return minutes < 24 * 60 && (endMinutes == null || minutes < endMinutes);
                        }
                        const startMinutes = timeToMinutes(startTime);
                        return startMinutes == null || minutes > startMinutes;
                      })
                      .map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={styles.timeOptionBadge}
                          onPress={() => {
                            if (showTimePicker === 'start') setStartTime(t);
                            else setEndTime(t);
                            setShowTimePicker(null);
                          }}
                        >
                          <Text style={styles.timeOptionText}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}

              <TouchableOpacity style={styles.addButton} onPress={handleAddSlot}>
                <FeatureIcon name="plus" size={18} color={themeColors.onPrimary} />
                <Text style={styles.addButtonText}>เพิ่มช่วงเวลานี้</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>ยืนยันเวลา ({slots.length} ช่วง)</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const getStyles = (themeColors, insets) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: themeColors.canvas,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '92%',
    maxHeight: '92%',
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? 0 : 0, // Insets handled in footer
  },
  // ... (keep the rest the same until footer)
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: themeColors.line || 'rgba(0,0,0,0.18)',
    opacity: 0.5,
    marginBottom: spacing.xs,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  title: {
    fontSize: type.h3,
    fontWeight: '700',
    color: themeColors.ink,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: spacing.md,
  },
  contentContainer: {
    paddingBottom: spacing.sm,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: type.body,
    fontWeight: '600',
    color: themeColors.ink,
    marginBottom: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: themeColors.line,
    marginVertical: spacing.md,
  },
  slotItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: themeColors.surface,
    padding: spacing.sm,
    borderRadius: 12,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  slotDate: {
    fontSize: type.body,
    fontWeight: '600',
    color: themeColors.ink,
  },
  slotCopy: { flex: 1, minWidth: 0, marginRight: 12 },
  selectedDay: { fontSize: type.body, color: themeColors.primary, fontWeight: '700', marginBottom: 12 },
  slotTime: {
    fontSize: type.caption,
    color: themeColors.primary,
    marginTop: 2,
  },
  removeBtn: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: themeColors.dangerSoft,
    borderRadius: 12,
  },
  removeText: { color: themeColors.danger, fontSize: 14, fontWeight: '700' },
  label: {
    fontSize: type.caption,
    color: themeColors.inkMuted,
    marginBottom: spacing.xs,
  },
  daysScroll: {
    marginBottom: spacing.md,
  },
  dayBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginRight: spacing.sm,
  },
  dayBadgeSelected: {
    backgroundColor: themeColors.primaryDark,
    borderColor: themeColors.primaryDark,
  },
  dayText: {
    color: themeColors.ink,
    fontSize: type.caption,
  },
  dayTextSelected: {
    color: themeColors.onPrimary,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  timeCol: {
    flex: 1,
    marginHorizontal: 4,
  },
  timeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: themeColors.surface,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  timeSelectorText: {
    fontSize: type.body,
    color: themeColors.ink,
    fontWeight: '500',
  },
  timeOptionsContainer: {
    backgroundColor: themeColors.surfaceRaised,
    padding: spacing.sm,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  timeOptionBadge: {
    backgroundColor: themeColors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  timeOptionText: {
    color: themeColors.ink,
  },
  addButton: {
    backgroundColor: themeColors.primaryDark,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 12,
    marginTop: spacing.sm,
  },
  addButtonText: {
    color: themeColors.onPrimary,
    fontWeight: '600',
    marginLeft: 8,
  },
  footer: {
    padding: spacing.md,
    paddingBottom: spacing.md + Math.max(insets?.bottom || (Platform.OS === 'ios' ? 34 : 0), 0),
    borderTopWidth: 1,
    borderTopColor: themeColors.line,
  },
  saveButton: {
    backgroundColor: themeColors.primaryDark,
    padding: spacing.md,
    borderRadius: 100,
    alignItems: 'center',
  },
  saveButtonText: {
    color: themeColors.onPrimary,
    fontSize: type.body,
    fontWeight: 'bold',
  },
});
