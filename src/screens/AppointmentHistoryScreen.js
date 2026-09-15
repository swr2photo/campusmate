import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  IosLikeAvatar,
  IosLikeCard,
  IosLikeHeader,
  IosLikeSectionTitle,
} from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { formatReadableDate } from '../utils/formatters';
import { canCancelMeetup, isMeetupExpired } from '../utils/meetupTime';
import { radius, spacing, type, useTheme } from '../theme';

const WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function dateKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateFromKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    try {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') {
    const date = new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?._seconds === 'number') {
    const date = new Date(value._seconds * 1000 + (value._nanoseconds || 0) / 1e6);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'number') {
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function todayKey() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return dateKeyFromDate(today);
}

function appointmentDateKey(appointment) {
  const schedule = appointment?.meetup?.schedule || appointment?.schedule || {};
  const scheduleDate = String(schedule.date || '').trim();
  if (dateFromKey(scheduleDate)) return scheduleDate;
  return dateKeyFromDate(toDate(appointment?.scheduledFor || schedule.scheduledFor));
}

function monthTitle(date) {
  return `${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
}

function monthCells(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstDay.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 12, 0, 0, 0));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function compareAppointments(first, second, nowKey) {
  const firstUpcoming = (first.status === 'active' || first.status === 'pending') && first.dateKey >= nowKey;
  const secondUpcoming = (second.status === 'active' || second.status === 'pending') && second.dateKey >= nowKey;
  if (firstUpcoming !== secondUpcoming) return firstUpcoming ? -1 : 1;
  const firstTime = dateFromKey(first.dateKey)?.getTime() || 0;
  const secondTime = dateFromKey(second.dateKey)?.getTime() || 0;
  return firstUpcoming ? firstTime - secondTime : secondTime - firstTime;
}

export default function AppointmentHistoryScreen() {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const {
    allConversations = [],
    appointments = [],
    availableProfiles = [],
    cancelAppointment,
    profile,
    toggleMeetupAcceptanceInChat,
  } = useApp();
  const currentUserId = profile?.id;
  const currentDateKey = todayKey();
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState(currentDateKey);
  const hasInitializedSelection = useRef(false);

  const peopleById = useMemo(() => {
    const map = new Map();
    if (profile?.id) map.set(profile.id, profile);
    availableProfiles.forEach((item) => {
      if (item?.id) map.set(item.id, item);
    });
    allConversations.forEach((conversation) => {
      Object.entries(conversation.participantProfiles || {}).forEach(([userId, participant]) => {
        if (userId && participant) map.set(userId, { ...(map.get(userId) || {}), ...participant, id: userId });
      });
    });
    return map;
  }, [allConversations, availableProfiles, profile]);

  const history = useMemo(() => {
    return appointments
      .map((appointment) => {
        const meetup = appointment.meetup || {};
        const schedule = meetup.schedule || appointment.schedule || {};
        const dateKey = appointmentDateKey(appointment);
        const scheduledAt = toDate(appointment.scheduledFor || schedule.scheduledFor);
        const isHost = appointment.hostId === currentUserId;
        const otherUserId = isHost
          ? appointment.guestId
          : appointment.hostId;
        const person = peopleById.get(otherUserId) || {};
        const status = appointment.status || 'active';
        const cancelCheck = canCancelMeetup(meetup || appointment);
        const isExpired = isMeetupExpired(meetup || appointment);
        return {
          ...appointment,
          dateKey,
          meetup,
          schedule,
          otherUserId,
          person,
          status,
          isHost,
          scheduledAt,
          isExpired,
          canCancel: status === 'active' && cancelCheck.allowed,
          cancelReason: cancelCheck.reason,
        };
      })
      .filter((appointment) => {
        if (!appointment.dateKey) return false;
        return true;
      })
      .sort((first, second) => compareAppointments(first, second, currentDateKey));
  }, [appointments, currentDateKey, currentUserId, peopleById]);

  const appointmentsByDate = useMemo(() => {
    const grouped = new Map();
    history.forEach((appointment) => {
      const current = grouped.get(appointment.dateKey) || [];
      current.push(appointment);
      grouped.set(appointment.dateKey, current);
    });
    return grouped;
  }, [history]);

  useEffect(() => {
    if (hasInitializedSelection.current || !history.length) return;
    const firstUpcoming = history.find((appointment) => (appointment.status === 'active' || appointment.status === 'pending') && appointment.dateKey >= currentDateKey);
    const firstAppointment = firstUpcoming || history[0];
    const date = dateFromKey(firstAppointment.dateKey);
    if (!date) return;
    hasInitializedSelection.current = true;
    setSelectedDateKey(firstAppointment.dateKey);
    setMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [currentDateKey, history]);

  const selectedAppointments = appointmentsByDate.get(selectedDateKey) || [];
  const otherAppointments = history.filter((appointment) => appointment.dateKey !== selectedDateKey);
  const activeCount = history.filter((appointment) => (appointment.status === 'active' || appointment.status === 'pending') && appointment.dateKey >= currentDateKey).length;
  const cells = useMemo(() => monthCells(monthDate), [monthDate]);

  const selectDate = (date) => {
    const nextDateKey = dateKeyFromDate(date);
    if (!nextDateKey) return;
    hasInitializedSelection.current = true;
    setSelectedDateKey(nextDateKey);
  };

  const changeMonth = (offset) => {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleOpenChat = (appointment) => {
    if (appointment?.conversationId) {
      router.push({ pathname: '/chat-room', params: { chatId: appointment.conversationId } });
    }
  };

  const handleAccept = async (appointment) => {
    if (!appointment?.conversationId || !appointment?.hostId) return;
    if (appointment.isExpired || isMeetupExpired(appointment.meetup || appointment)) {
      Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้');
      return;
    }
    try {
      if (toggleMeetupAcceptanceInChat) {
        await toggleMeetupAcceptanceInChat(
          appointment.conversationId,
          appointment.hostId,
          appointment.meetup?.name || 'จุดนัดพบ',
          appointment.meetup
        );
      }
      showToast('ตอบรับการนัดหมายแล้ว', 'info');
    } catch (error) {
      showToast(error?.message || 'ตอบรับการนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    }
  };

  const handleCancel = (appointment) => {
    const cancelCheck = canCancelMeetup(appointment.meetup || appointment);
    if (!cancelCheck.allowed) {
      Alert.alert('ไม่สามารถยกเลิกได้', cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน (ต้องยกเลิกล่วงหน้าอย่างน้อย 24 ชั่วโมง)');
      return;
    }
    const personName = appointment.person?.name || appointment.person?.nickname || 'เพื่อน';
    Alert.alert(
      'ยกเลิกการนัดหมาย?',
      `นัดหมายกับ ${personName} ในวันที่ ${formatReadableDate(appointment.dateKey)} จะถูกยกเลิก`,
      [
        { text: 'กลับไป', style: 'cancel' },
        {
          text: 'ยกเลิกนัดหมาย',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await cancelAppointment(appointment);
              if (result === false) {
                showToast('นัดหมายนี้ถูกเปลี่ยนแปลงแล้ว', 'info');
                return;
              }
              showToast('ยกเลิกการนัดหมายแล้ว', 'info');
            } catch (error) {
              showToast(error?.message || 'ยกเลิกการนัดหมายไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
            }
          },
        },
      ],
    );
  };

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <IosLikeHeader
        leftIcon="chevron.left"
        onLeftPress={onBack}
        subtitle={activeCount ? `${activeCount} นัดหมายที่กำลังจะมาถึง` : 'ดูวันนัดและรายละเอียดของคุณ'}
        title="ประวัติการนัดหมาย"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <IosLikeSectionTitle
          subtitle="แตะวันที่มีจุดสีเพื่อดูรายละเอียดการนัดหมาย"
          title="ปฏิทินนัดหมาย"
        />
        <IosLikeCard style={styles.calendarCard}>
          <View style={styles.monthToolbar}>
            <Pressable
              accessibilityLabel="เดือนก่อนหน้า"
              accessibilityRole="button"
              onPress={() => changeMonth(-1)}
              style={({ pressed }) => [styles.monthButton, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }, pressed && styles.pressed]}
            >
              <FeatureIcon color={colors.ink} name="chevron.left" size={18} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: colors.ink }]}>{monthTitle(monthDate)}</Text>
            <Pressable
              accessibilityLabel="เดือนถัดไป"
              accessibilityRole="button"
              onPress={() => changeMonth(1)}
              style={({ pressed }) => [styles.monthButton, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }, pressed && styles.pressed]}
            >
              <FeatureIcon color={colors.ink} name="chevron.right" size={18} />
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((day) => <Text key={day} style={[styles.weekday, { color: colors.inkMuted }]}>{day}</Text>)}
          </View>
          <View style={styles.calendarGrid}>
            {cells.map((date, index) => {
              if (!date) return <View key={`empty-${index}`} style={styles.dayCell} />;
              const dateKey = dateKeyFromDate(date);
              const dayAppointments = appointmentsByDate.get(dateKey) || [];
              return (
                <CalendarDay
                  appointments={dayAppointments}
                  colors={colors}
                  date={date}
                  isSelected={dateKey === selectedDateKey}
                  isToday={dateKey === currentDateKey}
                  key={dateKey}
                  onPress={() => selectDate(date)}
                />
              );
            })}
          </View>
          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.primary }]} /><Text style={[styles.legendText, { color: colors.inkMuted }]}>ยืนยันแล้ว</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#FF9500' }]} /><Text style={[styles.legendText, { color: colors.inkMuted }]}>รอตอบรับ</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.danger }]} /><Text style={[styles.legendText, { color: colors.inkMuted }]}>ยกเลิกแล้ว</Text></View>
          </View>
        </IosLikeCard>

        <IosLikeSectionTitle
          subtitle={selectedAppointments.length ? `${selectedAppointments.length} รายการในวันนี้` : 'ยังไม่มีรายการในวันที่เลือก'}
          title={dateFromKey(selectedDateKey) ? formatReadableDate(selectedDateKey) : 'รายละเอียดการนัดหมาย'}
        />
        {selectedAppointments.length ? selectedAppointments.map((appointment) => (
          <AppointmentCard
            appointment={appointment}
            colors={colors}
            key={appointment.id}
            onAccept={() => handleAccept(appointment)}
            onCancel={() => handleCancel(appointment)}
            onOpenChat={() => handleOpenChat(appointment)}
          />
        )) : (
          <EmptyDay colors={colors} hasHistory={history.length > 0} />
        )}

        {otherAppointments.length ? (
          <>
            <IosLikeSectionTitle
              subtitle={`${history.length} รายการทั้งหมด`}
              title="ประวัติทั้งหมด"
            />
            {otherAppointments.map((appointment) => (
              <AppointmentCard
                appointment={appointment}
                colors={colors}
                key={appointment.id}
                onAccept={() => handleAccept(appointment)}
                onCancel={() => handleCancel(appointment)}
                onOpenChat={() => handleOpenChat(appointment)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CalendarDay({ appointments, colors, date, isSelected, isToday, onPress }) {
  const hasActive = appointments.some((appointment) => appointment.status === 'active');
  const hasPending = appointments.some((appointment) => appointment.status === 'pending');
  const hasCancelled = appointments.some((appointment) => appointment.status === 'cancelled');
  return (
    <Pressable
      accessibilityLabel={`${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${appointments.length ? `มีนัดหมาย ${appointments.length} รายการ` : ''}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dayCell,
        isToday && { borderColor: colors.primary, borderWidth: 1 },
        isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.dayNumber, { color: isSelected ? colors.card : colors.ink }]}>{date.getDate()}</Text>
      <View style={styles.dayDots}>
        {hasActive ? <View style={[styles.dayDot, { backgroundColor: isSelected ? colors.card : colors.primary }]} /> : null}
        {hasPending && !hasActive ? <View style={[styles.dayDot, { backgroundColor: isSelected ? colors.card : '#FF9500' }]} /> : null}
        {hasCancelled ? <View style={[styles.dayDot, { backgroundColor: isSelected ? colors.card : colors.danger }]} /> : null}
      </View>
    </Pressable>
  );
}

function AppointmentCard({ appointment, colors, onAccept, onCancel, onOpenChat }) {
  const person = appointment.person || {};
  const personName = person.name || person.nickname || 'เพื่อนใน CampusMate';
  const isCancelled = appointment.status === 'cancelled';
  const isPending = appointment.status === 'pending';
  const isPast = !isCancelled && !isPending && appointment.dateKey < todayKey();
  const statusLabel = isCancelled
    ? 'ยกเลิกแล้ว'
    : isPending
      ? 'รอการตอบรับ'
      : isPast
        ? 'ผ่านแล้ว'
        : 'ยืนยันแล้ว';
  const statusColor = isCancelled || isPast
    ? colors.inkMuted
    : isPending
      ? '#FF9500'
      : colors.green;
  const isHost = Boolean(appointment.isHost);
  const roleLabel = isHost
    ? 'นัดหมายที่คุณสร้าง'
    : `นัดหมายของ ${personName}`;
  const schedule = appointment.schedule || {};
  const placeName = appointment.meetup?.name || 'ยังไม่ได้ระบุจุดนัดพบ';
  const hasTime = schedule.startTime || schedule.endTime;

  const dateBadgeBg = isCancelled
    ? colors.dangerSoft
    : isPending
      ? 'rgba(255, 149, 0, 0.15)'
      : colors.primarySoft;
  const dateBadgeColor = isCancelled
    ? colors.danger
    : isPending
      ? '#FF9500'
      : colors.primary;

  return (
    <IosLikeCard style={[styles.appointmentCard, isCancelled && styles.cancelledCard]}>
      <View style={styles.appointmentHeader}>
        <IosLikeAvatar
          cacheScope={person.id || appointment.otherUserId}
          cacheVersion={person.updatedAt}
          color={person.avatarColor || colors.primarySoft}
          emoji={person.avatar}
          size={52}
          uri={person.avatarUri || person.photoURL}
        />
        <View style={styles.personCopy}>
          <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>{personName}</Text>
          <Text numberOfLines={1} style={[styles.roleSubtitle, { color: isHost ? colors.primary : colors.inkSoft }]}>
            {roleLabel}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        <View style={[styles.dateBadge, { backgroundColor: dateBadgeBg }]}>
          <FeatureIcon color={dateBadgeColor} name="calendar" size={15} />
          <Text style={[styles.dateBadgeText, { color: dateBadgeColor }]}>{dateFromKey(appointment.dateKey)?.getDate()}</Text>
        </View>
      </View>

      <View style={[styles.details, { borderTopColor: colors.line }]}>
        <DetailRow colors={colors} icon="calendar" label="วันนัด" value={formatReadableDate(appointment.dateKey)} />
        {hasTime ? <DetailRow colors={colors} icon="clock.fill" label="เวลา" value={`${schedule.startTime || ''}${schedule.startTime && schedule.endTime ? '–' : ''}${schedule.endTime || ''} น.`} /> : null}
        <DetailRow colors={colors} icon="mappin.and.ellipse" label="สถานที่" value={placeName} />
        {appointment.meetup?.categoryLabel ? <DetailRow colors={colors} icon="sparkles" label="กิจกรรม" value={appointment.meetup.categoryLabel} /> : null}
      </View>

      {schedule.message ? (
        <View style={[styles.note, { backgroundColor: colors.surfaceRaised }]}>
          <FeatureIcon color={colors.inkSoft} name="text.bubble.fill" size={15} />
          <Text style={[styles.noteText, { color: colors.inkMuted }]}>{schedule.message}</Text>
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {isPending && !isHost && onAccept ? (
          <Pressable
            accessibilityLabel={`ตอบรับนัดหมายของ ${personName}`}
            accessibilityRole="button"
            disabled={appointment.isExpired}
            onPress={appointment.isExpired ? () => Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้') : onAccept}
            style={({ pressed }) => [
              styles.actionButton,
              styles.acceptButton,
              { backgroundColor: appointment.isExpired ? colors.inkMuted : colors.primary, opacity: appointment.isExpired ? 0.65 : 1 },
              pressed && !appointment.isExpired && styles.pressed,
            ]}
          >
            <FeatureIcon color="#FFFFFF" name={appointment.isExpired ? 'clock.badge.xmark' : 'checkmark.circle.fill'} size={15} />
            <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>
              {appointment.isExpired ? 'เลยกำหนดแล้ว' : 'ตอบรับนัดหมาย'}
            </Text>
          </Pressable>
        ) : null}

        {appointment.conversationId && onOpenChat ? (
          <Pressable
            accessibilityLabel={`คุยกับ ${personName} ในห้องแชท`}
            accessibilityRole="button"
            onPress={onOpenChat}
            style={({ pressed }) => [
              styles.actionButton,
              styles.chatButton,
              { borderColor: colors.line, backgroundColor: colors.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            <FeatureIcon color={colors.primary} name="bubble.left.and.bubble.right.fill" size={15} />
            <Text style={[styles.actionButtonText, { color: colors.ink }]}>ไปที่ห้องแชท</Text>
          </Pressable>
        ) : null}

        {appointment.canCancel ? (
          <Pressable
            accessibilityLabel={`ยกเลิกการนัดหมายกับ ${personName}`}
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [
              styles.actionButton,
              styles.cancelButton,
              { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
              pressed && styles.pressed,
            ]}
          >
            <FeatureIcon color={colors.danger} name="xmark.circle" size={15} />
            <Text style={[styles.actionButtonText, { color: colors.danger }]}>ยกเลิกนัดหมาย</Text>
          </Pressable>
        ) : (
          appointment.status === 'active' && !isPast ? (
            <View style={[styles.lockedCancelNotice, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
              <FeatureIcon color={colors.inkMuted} name="lock.fill" size={12} />
              <Text style={[styles.lockedCancelNoticeText, { color: colors.inkMuted }]}>
                ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน
              </Text>
            </View>
          ) : null
        )}
      </View>
    </IosLikeCard>
  );
}

function DetailRow({ colors, icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <FeatureIcon color={colors.primary} name={icon} size={16} />
      <Text style={[styles.detailLabel, { color: colors.inkMuted }]}>{label}</Text>
      <Text numberOfLines={2} style={[styles.detailValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

function EmptyDay({ colors, hasHistory }) {
  return (
    <IosLikeCard style={styles.emptyCard}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <FeatureIcon color={colors.primary} name={hasHistory ? 'calendar' : 'calendar.badge.clock'} size={27} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{hasHistory ? 'วันนี้ยังไม่มีนัดหมาย' : 'ยังไม่มีประวัติการนัดหมาย'}</Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>{hasHistory ? 'เลือกวันที่มีจุดสีบนปฏิทินเพื่อดูรายละเอียด' : 'เมื่อคุณหรือเพื่อนตอบรับนัดหมาย รายการจะแสดงที่นี่'}</Text>
    </IosLikeCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg },
  calendarCard: { padding: spacing.md },
  monthToolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  monthButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  monthTitle: { fontSize: type.headline, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekday: { flex: 1, fontSize: type.caption2, fontWeight: '700', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', height: 49, justifyContent: 'center', marginBottom: spacing.xs, width: '14.2857%' },
  dayNumber: { fontSize: type.bodySmall, fontWeight: '700' },
  dayDots: { alignItems: 'center', flexDirection: 'row', gap: 3, height: 8, marginTop: 2 },
  dayDot: { borderRadius: 3, height: 6, width: 6 },
  calendarLegend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  legendDot: { borderRadius: 4, height: 8, width: 8 },
  legendText: { fontSize: type.caption2, fontWeight: '600' },
  appointmentCard: { padding: spacing.lg },
  cancelledCard: { opacity: 0.78 },
  appointmentHeader: { alignItems: 'center', flexDirection: 'row' },
  personCopy: { flex: 1, marginLeft: spacing.md, minWidth: 0 },
  personName: { fontSize: type.headline, fontWeight: '800' },
  roleSubtitle: { fontSize: type.caption, fontWeight: '600', marginTop: 2 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: 5 },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  statusText: { fontSize: type.caption, fontWeight: '700' },
  dateBadge: { alignItems: 'center', borderRadius: radius.md, gap: 2, justifyContent: 'center', minWidth: 44, paddingVertical: spacing.sm },
  dateBadgeText: { fontSize: type.headline, fontWeight: '800' },
  details: { borderTopWidth: 1, gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, minHeight: 20 },
  detailLabel: { fontSize: type.caption, fontWeight: '700', width: 48 },
  detailValue: { flex: 1, fontSize: type.bodySmall, fontWeight: '700', lineHeight: 18 },
  note: { alignItems: 'flex-start', borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md },
  noteText: { flex: 1, fontSize: type.caption, lineHeight: 18 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionButton: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 40, paddingHorizontal: spacing.md, flex: 1, minWidth: 110 },
  acceptButton: { borderWidth: 0 },
  chatButton: { borderWidth: 1 },
  cancelButton: { borderWidth: 1 },
  actionButtonText: { fontSize: type.caption, fontWeight: '800' },
  lockedCancelNotice: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  lockedCancelNoticeText: { fontSize: type.caption2, fontWeight: '600' },
  emptyCard: { alignItems: 'center', padding: spacing.xl },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 58, justifyContent: 'center', width: 58 },
  emptyTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md, textAlign: 'center' },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.xs, textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
