import { useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useNotificationInbox } from '../context/NotificationInboxContext';
import { useFaceVerificationFlow } from '../components/FaceVerificationPrompt';
import { inboxTargetAvailable } from '../services/notificationInboxService';
import { groupInboxRows } from '../utils/notificationDisplay';

// State and actions shared by the React Native and SwiftUI notification pages.
export default function useNotificationsPage() {
  const inbox = useNotificationInbox(), face = useFaceVerificationFlow();
  const [unreadOnly, setUnreadOnly] = useState(false), [detailId, setDetailId] = useState(null), [busy, setBusy] = useState(false);
  const lastDetail = useRef(null);
  const sections = useMemo(() => groupInboxRows(inbox.rows, unreadOnly), [inbox.rows, unreadOnly]);
  // Track live changes to the open row, and keep the last one so a sheet
  // still has content while it animates closed.
  const live = detailId ? inbox.rows.find(row => row.id === detailId) : null;
  if (live) lastDetail.current = live;
  const detail = lastDetail.current;

  const report = () => Alert.alert('ยังเปิดรายการไม่ได้', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง');
  const markRead = row => { if (!row.readAt) void inbox.markRead(row.id).catch(report); };
  const showDetail = row => { lastDetail.current = row; setDetailId(row.id); };
  const open = async row => {
    try {
      markRead(row);
      if (row.type === 'face_verification' || row.type === 'admin_announcement' || row.type === 'system') { showDetail(row); return; }
      if (!await inboxTargetAvailable(row, inbox.uid)) { Alert.alert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'ข้อมูลอาจถูกลบ หรือคุณไม่มีสิทธิ์เปิดรายการนี้'); return; }
      const target = row.target || {};
      if (target.conversationId) router.push({ pathname: '/chat-room', params: { chatId: target.conversationId } });
      else if (row.type === 'group_message' && target.partyId) router.push({ pathname: '/group-chat', params: { partyId: target.partyId } });
      else if (target.partyId) router.push({ pathname: '/party-finder', params: { partyId: target.partyId } });
      else if (target.appointmentId) router.push('/appointments');
      else if (row.type === 'like') router.push('/likes');
      else showDetail(row);
    } catch (error) {
      if (String(error.code).includes('permission-denied') || String(error.code).includes('not-found')) Alert.alert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'คุณไม่มีสิทธิ์เปิดรายการนี้ หรือข้อมูลถูกลบแล้ว');
      else report();
    }
  };
  const closeDetail = () => setDetailId(null);
  // `delay` lets a native sheet finish dismissing before the next presentation.
  const after = (delay, run) => { if (delay) setTimeout(run, delay); else run(); };
  const startFace = (row, delay = 0) => { markRead(row); closeDetail(); after(delay, face.start); };
  const openRoute = (route, delay = 0) => { closeDetail(); after(delay, () => router.push(route)); };
  const canStartFace = row => row?.type === 'face_verification' && face.required && row.status !== 'completed';
  const allRead = async () => { setBusy(true); try { await inbox.markAll(); } catch { report(); } finally { setBusy(false); } };
  const loadMore = () => { if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore().catch(report); };

  return { inbox, face, sections, unreadOnly, setUnreadOnly, detail, detailOpen: !!detailId, busy, open, markRead, closeDetail, startFace, openRoute, canStartFace, allRead, loadMore };
}
