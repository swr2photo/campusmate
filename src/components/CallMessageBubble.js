import Text from './AppText';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { formatCallDuration } from '../services/callSignalingService';
import { useTheme } from '../theme';

export default function CallMessageBubble({
  item,
  mine,
  colors: propColors,
  isDark: propIsDark,
  onCallPress,
}) {
  const theme = useTheme();
  const colors = propColors || theme?.colors;
  const isDark = propIsDark !== undefined ? propIsDark : Boolean(theme?.isDark);
  const isVideo = item?.callType === 'video' || item?.text?.includes('วิดีโอคอล');
  const isMissed = item?.callStatus === 'missed' || item?.text?.includes('ไม่ได้รับสาย');
  const isRejected = item?.callStatus === 'rejected' || item?.text?.includes('สายถูกปฏิเสธ');
  const isBusy = item?.callStatus === 'busy' || item?.text?.includes('สายไม่ว่าง');
  const isCanceled = item?.callStatus === 'canceled' || item?.text?.includes('ยกเลิก');
  const duration = typeof item?.callDuration === 'number' ? item.callDuration : 0;

  // Format time of the call in Thailand timezone (UTC+7)
  const timeLabel = (() => {
    const rawTime = item?.createdAt || item?.time;
    if (rawTime) {
      const date = typeof rawTime === 'number'
        ? new Date(rawTime)
        : (rawTime.toDate ? rawTime.toDate() : new Date(rawTime));
      if (!isNaN(date.getTime())) {
        const thaiMillis = date.getTime() + 7 * 60 * 60 * 1000;
        const thaiDate = new Date(thaiMillis);
        return `${String(thaiDate.getUTCHours()).padStart(2, '0')}:${String(thaiDate.getUTCMinutes()).padStart(2, '0')}`;
      }
    }
    return item?.callTime || '';
  })();

  // Display title based on status
  let title = isVideo ? 'วิดีโอคอล' : 'การโทรด้วยเสียง';
  if (isMissed) {
    title = isVideo ? 'ไม่ได้รับสาย (วิดีโอคอล)' : 'ไม่ได้รับสาย';
  } else if (isRejected) {
    title = isVideo ? 'สายถูกปฏิเสธ (วิดีโอคอล)' : 'สายถูกปฏิเสธ';
  } else if (isBusy) {
    title = isVideo ? 'สายไม่ว่าง (วิดีโอคอล)' : 'สายไม่ว่าง';
  } else if (isCanceled) {
    title = isVideo ? 'ยกเลิกการโทร (วิดีโอคอล)' : 'ยกเลิกการโทร';
  } else if (duration > 0 || item?.text?.includes('สิ้นสุด')) {
    title = isVideo ? 'วิดีโอคอลสิ้นสุดลงแล้ว' : 'การโทรด้วยเสียงสิ้นสุดลงแล้ว';
  }

  // Display duration or end time
  let subtitle = timeLabel;
  if (duration > 0) {
    subtitle = timeLabel ? `${timeLabel} • ${formatCallDuration(duration)}` : formatCallDuration(duration);
  }

  const iconName = isMissed || isRejected || isBusy || isCanceled
    ? 'phone.down.fill'
    : (isVideo ? 'video.fill' : 'phone.fill');

  const iconBg = isCanceled
    ? (isDark ? '#6B7280' : '#9CA3AF')
    : (isMissed || isRejected || isBusy)
      ? (isDark ? '#EF4444' : '#E53935')
      : (isDark ? '#10B981' : '#00BA51');

  // Dynamic label: "เข้าร่วม" only when call is actively ongoing, "โทรกลับ" when ended/missed
  const isOngoing = item?.callStatus === 'calling' || item?.callStatus === 'ringing' || item?.callStatus === 'connected';
  const buttonLabel = isOngoing ? 'เข้าร่วม' : 'โทรกลับ';

  // Dynamic light / dark theme styling
  const cardBg = isDark ? '#20242A' : '#FFFFFF';
  const cardBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : (colors?.line || '#E8ECF2');
  const titleColor = isDark ? '#F7F8FA' : (colors?.ink || '#25272B');
  const timeColor = isDark ? '#7F8896' : (colors?.inkSoft || '#8B98AC');
  const btnBg = isDark ? '#2A2F37' : (colors?.surfaceRaised || '#F2F4F7');
  const btnBorder = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)';
  const btnTextColor = isDark ? '#F7F8FA' : (colors?.ink || '#25272B');
  const btnPressedBg = isDark ? '#353B45' : '#E4E7EC';
  const shadowColor = isDark ? '#000000' : '#25272B';
  const shadowOpacity = isDark ? 0.3 : 0.07;

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: cardBg,
          borderColor: cardBorder,
          shadowColor,
          shadowOpacity,
        },
      ]}
    >
      <View style={styles.contentRow}>
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <FeatureIcon color="#FFFFFF" name={iconName} size={18} />
        </View>
        <View style={styles.infoCol}>
          <Text numberOfLines={1} style={[styles.titleText, { color: titleColor }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.timeText, { color: timeColor }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Join / Call Back Button */}
      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityRole="button"
        onPress={() => onCallPress?.(isVideo ? 'video' : 'voice')}
        style={({ pressed }) => [
          styles.actionButton,
          {
            backgroundColor: pressed ? btnPressedBg : btnBg,
            borderColor: btnBorder,
          },
          pressed && styles.actionButtonPressed,
        ]}
      >
        <FeatureIcon color={btnTextColor} name={isVideo ? 'video.fill' : 'phone.fill'} size={13} />
        <Text style={[styles.actionButtonText, { color: btnTextColor }]}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: 265,
    maxWidth: '100%',
    marginVertical: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 7.5,
    paddingHorizontal: 12,
    gap: 6,
  },
  actionButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
