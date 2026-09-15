import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { useRemoteImage } from '../utils/useRemoteImage';
import FeatureIcon from './FeatureIcon';
import { radius, shadow, spacing, type, useTheme } from '../theme';

export function IosLikeScreen({ children, style }) {
  const { colors } = useTheme();
  return <View style={[styles.screen, { backgroundColor: colors.canvas }, style]}>{children}</View>;
}

export function IosLikeHeader({ title, subtitle, rightIcon, onRightPress, leftIcon, onLeftPress }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={styles.headerShell}>
      <BlurView intensity={isDark ? 34 : 48} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={styles.headerContent}>
        {leftIcon ? (
          <IconButton icon={leftIcon} onPress={onLeftPress} tintColor={colors.ink} style={styles.headerSideButton} />
        ) : null}
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.ink }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={[styles.headerSubtitle, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
        </View>
        {rightIcon ? (
          <IconButton icon={rightIcon} onPress={onRightPress} tintColor={colors.primary} style={styles.headerSideButton} />
        ) : null}
      </View>
    </View>
  );
}

export function IconButton({ icon, onPress, tintColor, accessibilityLabel, style, size = 20 }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel || icon}
      accessibilityRole="button"
      disabled={!onPress}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.card, borderColor: colors.line }, style, pressed && styles.pressed]}
    >
      <FeatureIcon color={tintColor || colors.ink} name={icon} size={size} />
    </Pressable>
  );
}

export function IosLikeCard({ children, style, accent, onPress }) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }, accent && { borderTopColor: accent, borderTopWidth: 2 }, style]}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>{content}</Pressable>;
}

export function IosLikeSectionTitle({ title, subtitle, action, onAction }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCopy}>
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
      </View>
      {action ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [pressed && styles.pressed]}><Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function IosLikePill({ children, active = false, color, onPress, style, icon }) {
  const { colors } = useTheme();
  const backgroundColor = active ? (color || colors.primary) : colors.surfaceRaised || colors.line;
  const iconIsEmoji = icon && /[^\x00-\x7F]/.test(icon) && !icon.includes('.');
  const content = (
    <View style={[styles.pill, { backgroundColor, borderColor: active ? backgroundColor : colors.line }, style]}>
      {iconIsEmoji ? <Text style={[styles.pillIconText, { color: active ? colors.card : colors.inkMuted }]}>{icon}</Text> : icon ? <FeatureIcon color={active ? colors.card : colors.inkMuted} name={icon} size={15} style={styles.pillIcon} /> : null}
      <Text style={[styles.pillText, { color: active ? colors.card : colors.inkMuted }]}>{children}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>{content}</Pressable> : content;
}

export function IosLikeAvatar({ uri, emoji, color, size = 56, online = false, cacheScope, cacheVersion }) {
  const { colors } = useTheme();
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));
  const remoteUri = useRemoteImage(isUrl ? uri : null, cacheVersion, cacheScope);
  const displayUri = remoteUri || (isUrl ? uri : null);
  const backgroundColor = color || colors.primarySoft;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor }]}>
      {displayUri ? (
        <ExpoImage
          source={{ uri: displayUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : emoji ? (
        <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
      ) : (
        <FeatureIcon color={colors.inkSoft} name="person.fill" size={size * 0.46} />
      )}
      {online ? <View style={[styles.onlineDot, { backgroundColor: colors.green, borderColor: colors.card }]} /> : null}
    </View>
  );
}

export function getAndroidSymbol(name) {
  const symbolMap = {
    'arrow.left': 'arrow_back',
    'arrow.right': 'arrow_forward',
    'apps': 'apps',
    'building.columns.fill': 'account_balance',
    'book.closed.fill': 'menu_book',
    'calendar': 'calendar_month',
    'calendar.badge.clock': 'event_available',
    'camera.fill': 'photo_camera',
    'checkmark': 'check',
    'checkmark.circle.fill': 'check_circle',
    'chevron.down': 'expand_more',
    'chevron.left': 'chevron_left',
    'chevron.right': 'chevron_right',
    'chevron.up': 'expand_less',
    'clock.arrow.2.circlepath': 'history',
    'clock': 'schedule',
    'clock.fill': 'schedule',
    'ellipsis': 'more_horiz',
    'exclamationmark.triangle.fill': 'warning',
    'figure.run': 'directions_run',
    'figure.2.and.child.holdinghands': 'groups',
    'flame.fill': 'local_fire_department',
    'gearshape.fill': 'settings',
    'graduationcap.fill': 'school',
    'heart.fill': 'favorite',
    'heart.circle.fill': 'favorite',
    'heart.slash': 'heart_broken',
    'info.circle.fill': 'info',
    'wifi.slash': 'wifi_off',
    'arrow.triangle.2.circlepath': 'sync',
    'leaf.fill': 'park',
    'lock.shield.fill': 'verified_user',
    'map.fill': 'map',
    'magnifyingglass': 'search',
    'line.3.horizontal': 'menu',
    'location.circle.fill': 'location_on',
    'location.fill': 'location_on',
    'mappin.and.ellipse': 'location_on',
    'mappin.circle.fill': 'location_on',
    'mappin.slash.circle.fill': 'location_off',
    'message.fill': 'chat_bubble',
    'person.2.slash': 'group_off',
    'bubble.left.and.bubble.right': 'forum',
    'paperplane.fill': 'send',
    'person.2.fill': 'group',
    'person.badge.plus': 'person_add',
    'person.crop.circle.fill': 'account_circle',
    'person.crop.square.fill': 'account_box',
    'person.fill': 'person',
    'person.fill.xmark': 'person_off',
    'plus': 'add',
    'search': 'search',
    'slider.horizontal.3': 'tune',
    'sparkles': 'auto_awesome',
    'square.and.pencil': 'edit',
    'star.fill': 'star',
    'sportscourt.fill': 'sports_basketball',
    'sunset.fill': 'wb_twilight',
    'tray.full.fill': 'inbox',
    'circle.fill': 'circle',
    'text.bubble.fill': 'chat',
    'text.quote': 'format_quote',
    'quote.bubble.fill': 'format_quote',
    'hand.wave.fill': 'waving_hand',
    'arrow.up': 'arrow_upward',
    'lock.fill': 'lock',
    'list': 'list',
    'tune': 'tune',
    'trash.fill': 'delete',
    'dumbbell.fill': 'fitness_center',
    'speedometer': 'speed',
    'favorite': 'favorite',
    'xmark': 'close',
    'xmark.circle': 'cancel',
    'xmark.circle.fill': 'cancel',
  };
  return symbolMap[name] || name;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerShell: { minHeight: 106, overflow: 'hidden', paddingTop: 38 },
  headerContent: { alignItems: 'center', flexDirection: 'row', minHeight: 68, paddingHorizontal: spacing.lg },
  headerSideButton: { height: 42, width: 42 },
  headerCopy: { alignItems: 'flex-start', flex: 1, paddingHorizontal: spacing.sm },
  headerTitle: { fontSize: type.title1, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: type.micro, fontWeight: '600', marginTop: 3 },
  iconButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, height: 46, justifyContent: 'center', width: 46, ...shadow.card },
  card: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden', padding: spacing.lg, ...shadow.card },
  sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  sectionCopy: { flex: 1, paddingRight: spacing.sm },
  sectionTitle: { fontSize: type.section, fontWeight: '800' },
  sectionSubtitle: { fontSize: type.caption, lineHeight: 18, marginTop: 3 },
  sectionAction: { fontSize: type.caption, fontWeight: '800', marginTop: 2 },
  pill: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', minHeight: 36, paddingHorizontal: spacing.md },
  pillIcon: { height: 15, marginRight: 5, width: 15 },
  pillIconText: { fontSize: 15, marginRight: 5 },
  pillText: { fontSize: type.caption, fontWeight: '700' },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'visible', position: 'relative' },
  onlineDot: { borderRadius: 7, borderWidth: 2, bottom: -1, height: 14, position: 'absolute', right: -1, width: 14 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
