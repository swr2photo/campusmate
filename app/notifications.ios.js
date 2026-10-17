import React from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import { Stack } from 'expo-router';
import { BottomSheet, Host, HStack, Image, List, Picker, ProgressView, ScrollView, Section, Spacer, SwipeActions, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, contentShape, controlSize, foregroundStyle, frame, lineLimit, listRowBackground, listStyle, multilineTextAlignment, onAppear, padding, pickerStyle, presentationDetents, presentationDragIndicator, scrollContentBackground, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers';
import AppText from '../src/components/AppText';
import { Button, Text } from '../src/components/NativeTypography';
import { font } from '../src/components/brandFont';
import useNotificationsPage from '../src/hooks/useNotificationsPage';
import { timestampMillis } from '../src/services/notificationInboxService';
import { ANNOUNCEMENT_ROUTES, fullDateLabel, kindFor, timeLabel, TODO_SECTION, withAlpha } from '../src/utils/notificationDisplay';
import { useTheme } from '../src/theme';

const OFFLINE_TEXT = 'กำลังแสดงข้อมูลที่บันทึกไว้ เชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดต';

export default function NotificationsRoute() {
  const colorScheme = useColorScheme();
  const { colors: c } = useTheme();
  const page = useNotificationsPage();
  const { inbox, now, sections, unreadOnly, detail } = page;
  const lastRowId = sections.at(-1)?.data.at(-1)?.id;
  const unreadLabel = inbox.count ? `ยังไม่อ่าน (${inbox.count > 99 ? '99+' : inbox.count})` : 'ยังไม่อ่าน';

  return <View style={{ flex: 1, backgroundColor: c.canvas }}>
    <Stack.Screen options={{ headerShown: true, title: 'แจ้งเตือน', headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว" disabled={!inbox.count} onPress={page.allRead} hitSlop={8} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
      <AppText style={{ color: inbox.count ? c.primary : c.inkSoft, fontSize: 15, fontWeight: '600' }}>อ่านทั้งหมด</AppText>
    </Pressable> }} />

    <Host colorScheme={colorScheme} seedColor={c.primary} style={{ width: '100%', height: 52 }}>
      <Picker selection={unreadOnly ? 'unread' : 'all'} onSelectionChange={value => page.setUnreadOnly(value === 'unread')} modifiers={[pickerStyle('segmented'), padding({ horizontal: 16, vertical: 8 })]}>
        <Text modifiers={[tag('all')]}>ทั้งหมด</Text>
        <Text modifiers={[tag('unread')]}>{unreadLabel}</Text>
      </Picker>
    </Host>

    <Host colorScheme={colorScheme} seedColor={c.primary} style={{ flex: 1 }}>
      {sections.length ? <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(c.canvas)]}>
        {inbox.offline || inbox.error ? <Section>
          {inbox.offline ? <StatusRow c={c} color={c.amber} icon="wifi.slash" text={OFFLINE_TEXT} /> : null}
          {inbox.error ? <Button onPress={inbox.retry} modifiers={[buttonStyle('plain'), listRowBackground(c.card)]}>
            <StatusRow c={c} color={c.danger} icon="exclamationmark.triangle.fill" text="อัปเดตไม่สำเร็จ" action="ลองอีกครั้ง" />
          </Button> : null}
        </Section> : null}
        {sections.map(section => <Section key={section.key}
          header={<Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(section.title === TODO_SECTION ? c.primary : c.inkMuted)]}>{section.title}</Text>}
          footer={section.data.at(-1)?.id === lastRowId ? <ListFooter c={c} inbox={inbox} onLoadMore={page.loadMore} /> : undefined}>
          {section.data.map(row => section.title === TODO_SECTION
            ? <TodoRow key={row.id} c={c} row={row} canStart={page.canStartFace(row)} onOpen={page.open} onStart={() => page.startFace(row)} />
            : <InboxRow key={row.id} c={c} row={row} now={now} onOpen={page.open} onMarkRead={page.markRead} onLast={row.id === lastRowId ? page.loadMore : undefined} />)}
        </Section>)}
      </List> : <EmptyState c={c} inbox={inbox} unreadOnly={unreadOnly} onShowAll={() => page.setUnreadOnly(false)} onLoadMore={page.loadMore} />}
    </Host>

    <Host colorScheme={colorScheme} seedColor={c.primary} style={{ position: 'absolute', width: 0, height: 0 }}>
      {/* Presentation modifiers only work on the sheet's content, not on BottomSheet itself. */}
      <BottomSheet isPresented={page.detailOpen} onIsPresentedChange={presented => { if (!presented) page.closeDetail(); }} onDismiss={page.flushPending}>
        {detail ? <DetailSheet c={c} row={detail} page={page} /> : null}
      </BottomSheet>
    </Host>
    {page.face.modal}
  </View>;
}

function IconBadge({ color, fill, icon, size = 40, iconColor }) {
  return <Image systemName={icon} size={Math.round(size * 0.42)} color={iconColor || color}
    modifiers={[frame({ width: size, height: size }), background(fill || withAlpha(color, 0.14), shapes.circle())]} />;
}

// Plain-style buttons only hit-test drawn content, so rows fill their width and
// declare a rectangular content shape to make the whole row tappable.
const fullRowTap = [frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())];

function InboxRow({ c, row, now, onOpen, onMarkRead, onLast }) {
  const kind = kindFor(row.type), color = c[kind.tint], unread = !row.readAt, time = timeLabel(timestampMillis(row.createdAt), now);
  const label = [unread ? 'ยังไม่อ่าน' : '', kind.label, row.title, row.body, time, row.status === 'completed' ? 'สำเร็จแล้ว' : ''].filter(Boolean).join(' ');
  return <SwipeActions modifiers={[listRowBackground(c.card), ...(onLast ? [onAppear(onLast)] : [])]}>
    <Button onPress={() => onOpen(row)} modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}>
      <HStack spacing={12} alignment="top" modifiers={[padding({ vertical: 4 }), ...fullRowTap]}>
        <IconBadge color={color} icon={kind.icon} />
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack spacing={6}>
            <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(color), lineLimit(1)]}>{kind.label}</Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(c.inkSoft)]}>{time}</Text>
            {unread ? <Image systemName="circle.fill" size={8} color={c.primary} /> : null}
          </HStack>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: unread ? 'bold' : 'medium' }), foregroundStyle(c.ink), lineLimit(2)]}>{row.title}</Text>
          {row.body ? <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(c.inkMuted), lineLimit(2)]}>{row.body}</Text> : null}
          {row.status === 'completed' ? <HStack spacing={4} modifiers={[padding({ horizontal: 8, vertical: 2 }), background(withAlpha(c.green, 0.14), shapes.capsule())]}>
            <Image systemName="checkmark.circle.fill" size={11} color={c.green} />
            <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(c.green)]}>สำเร็จแล้ว</Text>
          </HStack> : null}
        </VStack>
      </HStack>
    </Button>
    {unread ? <SwipeActions.Actions edge="leading">
      <Button label="อ่านแล้ว" systemImage="envelope.open.fill" onPress={() => onMarkRead(row)} modifiers={[tint(c.primary)]} />
    </SwipeActions.Actions> : null}
  </SwipeActions>;
}

// The summary opens the detail (and marks it read); the bordered CTA is a separate
// target, since explicitly styled buttons in a List row only fire within their bounds.
function TodoRow({ c, row, canStart, onOpen, onStart }) {
  const kind = kindFor(row.type);
  return <VStack alignment="leading" spacing={12} modifiers={[padding({ vertical: 6 }), listRowBackground(c.card)]}>
    <Button onPress={() => onOpen(row)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${row.readAt ? '' : 'ยังไม่อ่าน '}${row.title} ${row.body || ''}`)]}>
      <HStack spacing={12} alignment="top" modifiers={fullRowTap}>
        <IconBadge color={c.primary} fill={c.primary} iconColor={c.onPrimary} icon={kind.icon} size={44} />
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(c.ink), lineLimit(2)]}>{row.title}</Text>
          <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(c.inkMuted), lineLimit(3)]}>{row.body}</Text>
        </VStack>
      </HStack>
    </Button>
    {canStart ? <Button label="เริ่มยืนยันใบหน้า" systemImage="faceid" onPress={onStart}
      modifiers={[buttonStyle('borderedProminent'), buttonBorderShape('capsule'), controlSize('large'), tint(c.primary)]} /> : null}
  </VStack>;
}

function StatusRow({ c, color, icon, text, action }) {
  return <HStack spacing={10} modifiers={[listRowBackground(c.card)]}>
    <Image systemName={icon} size={15} color={color} />
    <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(c.ink), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{text}</Text>
    {action ? <Text modifiers={[font({ textStyle: 'footnote', weight: 'bold' }), foregroundStyle(color)]}>{action}</Text> : null}
  </HStack>;
}

function ListFooter({ c, inbox, onLoadMore }) {
  if (inbox.loadingMore) return <HStack modifiers={[frame({ maxWidth: Infinity }), padding({ top: 8 })]}><ProgressView /></HStack>;
  if (inbox.hasMore) return <HStack modifiers={[frame({ maxWidth: Infinity }), padding({ top: 8 })]}>
    <Button label="โหลดเพิ่มเติม" onPress={onLoadMore} modifiers={[buttonStyle('bordered'), buttonBorderShape('capsule')]} />
  </HStack>;
  return <HStack spacing={5} modifiers={[frame({ maxWidth: Infinity }), padding({ top: 8 })]}>
    <Image systemName="clock" size={12} color={c.inkSoft} />
    <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(c.inkSoft)]}>เก็บประวัติย้อนหลัง 90 วัน</Text>
  </HStack>;
}

// Built from plain views rather than ContentUnavailableView, which renders nothing before iOS 17.
function EmptyState({ c, inbox, unreadOnly, onShowAll, onLoadMore }) {
  // Only the newest page is loaded; older unread rows may still be on the server.
  const olderUnread = unreadOnly && inbox.hasMore;
  const content = inbox.error
    ? { icon: 'exclamationmark.triangle', title: 'อัปเดตไม่สำเร็จ', text: 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' }
    : olderUnread ? { icon: 'tray', title: 'ยังไม่มีรายการที่ยังไม่อ่านในประวัติที่โหลดไว้', text: 'โหลดเพิ่มเติมเพื่อตรวจรายการก่อนหน้า' }
    : unreadOnly ? { icon: 'checkmark.circle', title: 'อ่านครบแล้ว', text: 'ไม่มีแจ้งเตือนที่ยังไม่ได้อ่าน' }
    : { icon: 'bell', title: 'ยังไม่มีแจ้งเตือน', text: 'เมื่อมีคนถูกใจ ส่งข้อความ หรือมีความเคลื่อนไหวของตี้และนัดหมาย จะแสดงที่นี่' };
  const pill = [buttonStyle('bordered'), buttonBorderShape('capsule')];
  return <VStack spacing={12} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), padding({ horizontal: 32 })]}>
    {inbox.loading ? <ProgressView /> : <>
      <Image systemName={content.icon} size={44} color={c.inkSoft} />
      <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(c.ink), multilineTextAlignment('center')]}>{content.title}</Text>
      <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(c.inkMuted), multilineTextAlignment('center')]}>{content.text}</Text>
      {inbox.offline ? <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(c.amber), multilineTextAlignment('center')]}>{OFFLINE_TEXT}</Text> : null}
      {inbox.error ? <Button label="ลองอีกครั้ง" systemImage="arrow.clockwise" onPress={inbox.retry} modifiers={pill} />
        : olderUnread ? (inbox.loadingMore ? <ProgressView /> : <Button label="โหลดเพิ่มเติม" onPress={onLoadMore} modifiers={pill} />)
        : unreadOnly ? <Button label="ดูแจ้งเตือนทั้งหมด" onPress={onShowAll} modifiers={pill} /> : null}
    </>}
  </VStack>;
}

function DetailSheet({ c, row, page }) {
  const kind = kindFor(row.type), color = c[kind.tint], date = fullDateLabel(timestampMillis(row.createdAt));
  const route = row.type === 'admin_announcement' && ANNOUNCEMENT_ROUTES.includes(row.target?.route) ? row.target.route : null;
  const prominent = [buttonStyle('borderedProminent'), buttonBorderShape('capsule'), controlSize('large'), tint(c.primary)];
  return <ScrollView modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
    <VStack alignment="leading" spacing={14} modifiers={[padding({ horizontal: 24, top: 32, bottom: 24 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <HStack spacing={12}>
        <IconBadge color={color} icon={kind.icon} size={48} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: 'footnote', weight: 'bold' }), foregroundStyle(color)]}>{kind.label}</Text>
          {date ? <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(c.inkSoft)]}>{date}</Text> : null}
        </VStack>
      </HStack>
      <Text modifiers={[font({ textStyle: 'title3', weight: 'bold' }), foregroundStyle(c.ink)]}>{row.title}</Text>
      <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(c.inkMuted)]}>{row.body}</Text>
      {/* Deferred to onDismiss: UIKit cannot present the next modal while this sheet is still closing. */}
      {page.canStartFace(row) ? <Button label="เริ่มยืนยันใบหน้า" systemImage="faceid" onPress={() => page.startFace(row, true)} modifiers={[...prominent, padding({ top: 6 })]} /> : null}
      {route ? <Button label="เปิดหน้าที่เกี่ยวข้อง" systemImage="arrow.up.right" onPress={() => page.openRoute(route, true)} modifiers={[...prominent, padding({ top: 6 })]} /> : null}
      <Button label="ปิด" onPress={page.closeDetail} modifiers={[buttonStyle('bordered'), buttonBorderShape('capsule'), controlSize('large'), tint(c.ink)]} />
    </VStack>
  </ScrollView>;
}
