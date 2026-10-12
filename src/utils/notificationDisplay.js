import { timestampMillis } from '../services/notificationInboxService';

const DAY_MS = 86400000;
export const TODO_SECTION = 'สิ่งที่ต้องทำ';
export const ANNOUNCEMENT_ROUTES = ['/home', '/discover', '/meetup', '/me', '/chat'];

// SF Symbol, theme color key and short label for each inbox type.
// FeatureIcon maps the same symbol names to Ionicons on Android.
export function kindFor(type) {
  const value = String(type || '');
  if (value === 'face_verification') return { icon: 'person.crop.circle.badge.checkmark', tint: 'primary', label: 'ยืนยันตัวตน' };
  if (value === 'like') return { icon: 'heart.fill', tint: 'coral', label: 'ถูกใจ' };
  if (value === 'match') return { icon: 'heart.circle.fill', tint: 'coral', label: 'จับคู่สำเร็จ' };
  if (value === 'incoming_call') return { icon: 'phone.fill', tint: 'green', label: 'สายเรียกเข้า' };
  if (value === 'group_message') return { icon: 'bubble.left.and.bubble.right.fill', tint: 'blue', label: 'แชตกลุ่ม' };
  if (value.includes('message')) return { icon: 'bubble.left.fill', tint: 'blue', label: 'ข้อความ' };
  if (value.includes('party')) return { icon: 'person.3.fill', tint: 'amber', label: 'ตี้' };
  if (value === 'appointment') return { icon: 'calendar.badge.clock', tint: 'mint', label: 'นัดหมาย' };
  if (value === 'admin_announcement') return { icon: 'bell.badge.fill', tint: 'primary', label: 'ประกาศจาก CampusMate' };
  return { icon: 'bell.fill', tint: 'inkMuted', label: 'CampusMate' };
}

// Theme tints are #RRGGBB; rgba() works for both React Native and SwiftUI colors.
export function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const startOfDay = millis => { const day = new Date(millis); day.setHours(0, 0, 0, 0); return day.getTime(); };
export const isTodo = row => row?.type === 'face_verification' && row.status === 'required';

function sectionTitle(row, today) {
  if (isTodo(row)) return TODO_SECTION;
  const millis = timestampMillis(row.createdAt);
  const days = millis ? Math.round((today - startOfDay(millis)) / DAY_MS) : 0;
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (days < 7) return new Date(millis).toLocaleDateString('th-TH', { weekday: 'long' });
  return new Date(millis).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Rows arrive newest first, so consecutive grouping yields one section per day.
export function groupInboxRows(rows, unreadOnly) {
  const today = startOfDay(Date.now()), sections = [], used = new Set();
  for (const row of rows) {
    if (unreadOnly && row.readAt) continue;
    const title = sectionTitle(row, today), last = sections.at(-1);
    if (last?.title === title) { last.data.push(row); continue; }
    // Day titles are unique in newest-first order; a stable key keeps rows mounted
    // when a new section appears above them.
    sections.push({ key: used.has(title) ? `${title}:${sections.length}` : title, title, data: [row] });
    used.add(title);
  }
  return sections;
}

export function timeLabel(millis, now) {
  const minutes = Math.floor((now - millis) / 60000);
  if (!millis || minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 360 && startOfDay(millis) === startOfDay(now)) return `${Math.floor(minutes / 60)} ชม.`;
  return `${new Date(millis).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
}

export function fullDateLabel(millis) {
  return millis ? new Date(millis).toLocaleString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
