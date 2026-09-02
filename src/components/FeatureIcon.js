import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';

const ANDROID_ICON_MAP = {
  'arrow.left': 'arrow-back',
  'arrow.right': 'arrow-forward',
  'arrow.right.circle.fill': 'arrow-forward-circle',
  'arrow.up': 'arrow-up',
  'arrow.uturn.backward.circle': 'arrow-undo-circle',
  'arrowshape.turn.up.left': 'return-up-back',
  apps: 'apps',
  'building.columns.fill': 'business',
  'book.closed.fill': 'book',
  'book.fill': 'book',
  calendar: 'calendar',
  'calendar.badge.clock': 'calendar',
  'camera.fill': 'camera',
  checkmark: 'checkmark',
  'checkmark.circle.fill': 'checkmark-circle',
  'chevron.down': 'chevron-down',
  'chevron.left': 'chevron-back',
  'chevron.right': 'chevron-forward',
  'chevron.up': 'chevron-up',
  'circle.fill': 'ellipse',
  clock: 'time',
  'clock.fill': 'time',
  'clock.arrow.2.circlepath': 'refresh-circle',
  'cup.and.saucer.fill': 'cafe',
  'doc.on.doc': 'copy',
  'dumbbell.fill': 'barbell',
  ellipsis: 'ellipsis-horizontal',
  'envelope.fill': 'mail',
  'exclamationmark.triangle.fill': 'warning',
  'figure.2.and.child.holdinghands': 'people',
  'figure.run': 'walk',
  'flame.fill': 'flame',
  'gearshape.fill': 'settings',
  'graduationcap.fill': 'school',
  'hand.wave.fill': 'hand-left',
  'heart.circle.fill': 'heart-circle',
  'heart.fill': 'heart',
  'heart.slash': 'heart-dislike',
  'info.circle.fill': 'information-circle',
  'leaf.fill': 'leaf',
  'line.3.horizontal': 'menu',
  list: 'list',
  'location.circle.fill': 'location',
  'location.fill': 'location',
  'lock.fill': 'lock-closed',
  'lock.shield.fill': 'shield-checkmark',
  'map.fill': 'map',
  magnifyingglass: 'search',
  'mappin.and.ellipse': 'location',
  'mappin.circle.fill': 'location',
  'mappin.slash.circle.fill': 'location-outline',
  'message.fill': 'chatbubble',
  'bubble.left.and.bubble.right': 'chatbubbles',
  paperplane: 'send',
  'paperplane.fill': 'send',
  'person.2.circle': 'people-circle',
  'person.2.fill': 'people',
  'person.2.slash': 'person-remove',
  'person.badge.plus': 'person-add',
  'person.badge.key.fill': 'key',
  'person.crop.circle.badge.checkmark': 'person-circle',
  'person.crop.circle.badge.questionmark': 'help-circle',
  'person.crop.circle.fill': 'person-circle',
  'person.crop.square.fill': 'person',
  'person.fill': 'person',
  'person.fill.xmark': 'person-remove',
  plus: 'add',
  'quote.bubble.fill': 'chatbox-ellipses',
  search: 'search',
  'slider.horizontal.3': 'options',
  sparkles: 'sparkles',
  speedometer: 'speedometer',
  'sportscourt.fill': 'basketball',
  'square.and.arrow.up': 'share',
  'square.and.pencil': 'create',
  'square.grid.2x2.fill': 'grid',
  'star.fill': 'star',
  'sunset.fill': 'sunny',
  'text.bubble.fill': 'chatbox',
  'text.quote': 'chatbox-ellipses',
  trash: 'trash',
  'trash.fill': 'trash',
  'tray.full.fill': 'file-tray-full',
  tune: 'options',
  xmark: 'close',
  'xmark.circle': 'close-circle',
  'xmark.circle.fill': 'close-circle',

  // Names previously produced by getAndroidSymbol().
  account_balance: 'business',
  account_box: 'person',
  account_circle: 'person-circle',
  add: 'add',
  arrow_back: 'arrow-back',
  arrow_forward: 'arrow-forward',
  arrow_upward: 'arrow-up',
  auto_awesome: 'sparkles',
  cancel: 'close-circle',
  chat: 'chatbox',
  chat_bubble: 'chatbubble',
  check: 'checkmark',
  check_circle: 'checkmark-circle',
  chevron_left: 'chevron-back',
  chevron_right: 'chevron-forward',
  close: 'close',
  directions_run: 'walk',
  event: 'calendar',
  event_available: 'calendar',
  expand_less: 'chevron-up',
  expand_more: 'chevron-down',
  favorite: 'heart',
  fitness_center: 'barbell',
  format_quote: 'chatbox-ellipses',
  forum: 'chatbubbles',
  group: 'people',
  groups: 'people',
  history: 'refresh-circle',
  home: 'home',
  inbox: 'file-tray-full',
  info: 'information-circle',
  local_fire_department: 'flame',
  location_off: 'location-outline',
  location_on: 'location',
  lock: 'lock-closed',
  map: 'map',
  menu: 'menu',
  menu_book: 'book',
  more_horiz: 'ellipsis-horizontal',
  park: 'leaf',
  person: 'person',
  person_add: 'person-add',
  person_off: 'person-remove',
  photo_camera: 'camera',
  schedule: 'time',
  school: 'school',
  search: 'search',
  send: 'send',
  settings: 'settings',
  sports_basketball: 'basketball',
  star: 'star',
  tune: 'options',
  verified_user: 'shield-checkmark',
  warning: 'warning',
  waving_hand: 'hand-left',
};

function isEmoji(value) {
  return typeof value === 'string' && /[^\x00-\x7F]/.test(value) && !value.includes('.');
}

export function getAndroidIconName(name) {
  return ANDROID_ICON_MAP[name] || 'help-circle-outline';
}

export default function FeatureIcon({ color, name, size = 22, style }) {
  const resolvedName = typeof name === 'object'
    ? (name[Platform.OS] || name.android || name.ios || name.web)
    : name;

  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={resolvedName}
        size={size}
        style={[{ height: size, width: size }, style]}
        tintColor={color}
      />
    );
  }

  if (isEmoji(resolvedName)) {
    return <Text style={[styles.emoji, { color, fontSize: size, lineHeight: size + 2 }, style]}>{resolvedName}</Text>;
  }

  return (
    <Ionicons
      color={color}
      name={getAndroidIconName(resolvedName)}
      size={size}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  emoji: { includeFontPadding: false, textAlign: 'center' },
});
