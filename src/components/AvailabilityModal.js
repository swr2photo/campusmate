import React, { useState, useEffect } from 'react';
import {
  Animated,
  Alert,
  PanResponder,
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { timeToMinutes } from '../data/matchingFilters';
import { useTheme, colors, spacing, type } from '../theme';

// Generate next 14 days
const generateDays = () => {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
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
  const start = typeof slot.start === 'string' ? slot.start.trim() : '';
  const end = typeof slot.end === 'string' ? slot.end.trim() : '';
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (!date || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  return { date, start, end };
};

const normalizeAvailabilitySlots = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(normalizeAvailabilitySlot)
    .filter((slot) => {
      if (!slot) return false;
      const key = `${slot.date}|${slot.start}|${slot.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
};

const sortAvailabilitySlots = (value) => (
  [...value].sort((left, right) => (
    `${left.date}|${left.start}`.localeCompare(`${right.date}|${right.start}`)
  ))
);

export default function AvailabilityModal({ visible, onClose, availabilitySlots, onSave }) {
  const { colors: themeColors } = useTheme();
  const styles = getStyles(themeColors);
  
  // Local state for editing
  const [slots, setSlots] = useState([]);
  const [days, setDays] = useState(() => generateDays());
  
  // New slot states
  const [selectedDate, setSelectedDate] = useState(formatIsoDate(new Date()));
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [showTimePicker, setShowTimePicker] = useState(null); // 'start' or 'end'
  const translateY = React.useRef(new Animated.Value(600)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const isClosingRef = React.useRef(false);
  const wasVisibleRef = React.useRef(false);

  const closeWithAnimation = React.useCallback(() => {
    if (!visible || isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        duration: 220,
        toValue: 700,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        duration: 200,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onClose();
      isClosingRef.current = false;
    });
  }, [onClose, translateY, fadeAnim, visible]);

  const panResponder = React.useMemo(() => PanResponder.create({
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

  useEffect(() => {
    const justOpened = visible && !wasVisibleRef.current;
    if (justOpened) {
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
      const nextDays = generateDays();
      setDays(nextDays);
      setSelectedDate(formatIsoDate(nextDays[0]));
      setStartTime(DEFAULT_START_TIME);
      setEndTime(DEFAULT_END_TIME);
      setShowTimePicker(null);
      setSlots(sortAvailabilitySlots(normalizeAvailabilitySlots(availabilitySlots)));
    }
    if (!visible) {
      translateY.stopAnimation();
      isClosingRef.current = false;
      setShowTimePicker(null);
    }
    wasVisibleRef.current = visible;
  }, [availabilitySlots, fadeAnim, translateY, visible]);

  const handleAddSlot = () => {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      Alert.alert('เวลาไม่ถูกต้อง', 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น');
      return;
    }
    const newSlot = { date: selectedDate, start: startTime, end: endTime };
    setSlots((currentSlots) => {
      if (currentSlots.some((slot) => (
        slot.date === newSlot.date
        && slot.start === newSlot.start
        && slot.end === newSlot.end
      ))) {
        return currentSlots;
      }
      return sortAvailabilitySlots([...currentSlots, newSlot]);
    });
  };

  const handleRemoveSlot = (index) => {
    setSlots((currentSlots) => currentSlots.filter((_, currentIndex) => currentIndex !== index));
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
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: fadeAnim }]}>
          <Pressable onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} accessibilityHint="ลากลงเพื่อปิด" style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>เลือกเวลาที่สะดวก</Text>
          </View>
          
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            overScrollMode="always"
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Added Slots */}
            {slots.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>เวลาที่เลือกไว้ ({slots.length})</Text>
                {slots.map((slot, index) => {
                  const dateObj = parseLocalIsoDate(slot.date);
                  const displayDate = dateObj ? formatDayStr(dateObj) : slot.date;
                  return (
                    <View key={`${slot.date}-${slot.start}-${slot.end}-${index}`} style={styles.slotItem}>
                      <View>
                        <Text style={styles.slotDate}>{displayDate}</Text>
                        <Text style={styles.slotTime}>{slot.start} - {slot.end}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleRemoveSlot(index)} style={styles.removeBtn}>
                        <Feather name="trash-2" size={18} color={colors.red} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.divider} />

            {/* Add New Slot */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>เพิ่มช่วงเวลาใหม่</Text>
              
              <Text style={styles.label}>เลือกวัน (14 วันล่วงหน้า)</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={styles.daysScroll}>
                {days.map((d) => {
                  const iso = formatIsoDate(d);
                  const isSelected = selectedDate === iso;
                  return (
                    <TouchableOpacity
                      key={iso}
                      style={[styles.dayBadge, isSelected && styles.dayBadgeSelected]}
                      onPress={() => setSelectedDate(iso)}
                    >
                      <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>
                        {formatDayStr(d)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.timeRow}>
                <View style={styles.timeCol}>
                  <Text style={styles.label}>เวลาเริ่มต้น</Text>
                  <TouchableOpacity style={styles.timeSelector} onPress={() => setShowTimePicker(showTimePicker === 'start' ? null : 'start')}>
                    <Text style={styles.timeSelectorText}>{startTime}</Text>
                    <Feather name="clock" size={16} color={themeColors.inkSoft} />
                  </TouchableOpacity>
                </View>
                <View style={styles.timeCol}>
                  <Text style={styles.label}>เวลาสิ้นสุด</Text>
                  <TouchableOpacity style={styles.timeSelector} onPress={() => setShowTimePicker(showTimePicker === 'end' ? null : 'end')}>
                    <Text style={styles.timeSelectorText}>{endTime}</Text>
                    <Feather name="clock" size={16} color={themeColors.inkSoft} />
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
                <Feather name="plus" size={18} color="#fff" />
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
    </Modal>
  );
}

const getStyles = (themeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: themeColors.canvas,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '80%',
    maxHeight: '80%',
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
  },
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
    borderBottomColor: themeColors.surfaceRaised,
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
    backgroundColor: themeColors.surfaceRaised,
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
    borderColor: themeColors.surfaceRaised,
  },
  slotDate: {
    fontSize: type.body,
    fontWeight: '600',
    color: themeColors.ink,
  },
  slotTime: {
    fontSize: type.caption,
    color: themeColors.primary,
    marginTop: 2,
  },
  removeBtn: {
    padding: spacing.sm,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 8,
  },
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
    borderColor: themeColors.surfaceRaised,
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
    color: '#fff',
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
    borderColor: themeColors.surfaceRaised,
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
    color: '#fff',
    fontWeight: '600',
    marginLeft: 8,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: themeColors.surfaceRaised,
  },
  saveButton: {
    backgroundColor: themeColors.primaryDark,
    padding: spacing.md,
    borderRadius: 100,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: type.body,
    fontWeight: 'bold',
  },
});
