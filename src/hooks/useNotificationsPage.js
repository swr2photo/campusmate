import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useNotificationInbox } from '../context/NotificationInboxContext';
import { useFaceVerificationFlow } from '../components/FaceVerificationPrompt';
import { inboxTargetAvailable } from '../services/notificationInboxService';
import { showAlert } from '../utils/appAlert';
import { groupInboxRows } from '../utils/notificationDisplay';

// State and actions shared by the React Native and SwiftUI notification pages.
export default function useNotificationsPage() {
  const inbox = useNotificationInbox(), face = useFaceVerificationFlow();
  const [unreadOnly, setUnreadOnly] = useState(false), [detailId, setDetailId] = useState(null), [busy, setBusy] = useState(false);
  const lastDetail = useRef(null), pendingAction = useRef(null);
  // Relative times ("5 นาที") must advance while the page stays mounted under a pushed screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const sections = useMemo(() => groupInboxRows(inbox.rows, unreadOnly), [inbox.rows, unreadOnly]);
  // Track live changes to the open row, and keep the last one so a sheet
  // still has content while it animates closed.
  const live = detailId ? inbox.rows.find(row => row.id === detailId) : null;
  if (live) lastDetail.current = live;
  const detail = lastDetail.current;

  const report = () => showAlert('ยังเปิดรายการไม่ได้', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', { tone: 'danger' });
  const markRead = row => { if (!row.readAt) void inbox.markRead(row.id).catch(report); };
  const showDetail = row => { lastDetail.current = row; setDetailId(row.id); };
  const open = async row => {
    try {
      markRead(row);
      if (row.type === 'face_verification' || row.type === 'admin_announcement' || row.type === 'system') { showDetail(row); return; }
      if (!await inboxTargetAvailable(row, inbox.uid)) { showAlert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'ข้อมูลอาจถูกลบ หรือคุณไม่มีสิทธิ์เปิดรายการนี้', { tone: 'warning' }); return; }
      const target = row.target || {};
      if (target.conversationId) router.push({ pathname: '/chat-room', params: { chatId: target.conversationId } });
      else if (row.type === 'group_message' && target.partyId) router.push({ pathname: '/group-chat', params: { partyId: target.partyId } });
      else if (target.partyId) router.push({ pathname: '/party-finder', params: { partyId: target.partyId } });
      else if (target.appointmentId) router.push('/appointments');
      else if (row.type === 'like') router.push('/likes');
      else showDetail(row);
    } catch (error) {
      if (String(error.code).includes('permission-denied') || String(error.code).includes('not-found')) showAlert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'คุณไม่มีสิทธิ์เปิดรายการนี้ หรือข้อมูลถูกลบแล้ว', { tone: 'warning' });
      else report();
    }
  };
  const closeDetail = () => setDetailId(null);
  // A native sheet must finish dismissing before the next modal or push, so the iOS
  // page defers these to BottomSheet onDismiss and calls flushPending there.
  const afterClose = (afterDismiss, run) => { closeDetail(); if (afterDismiss) pendingAction.current = run; else run(); };
  const flushPending = () => { const run = pendingAction.current; pendingAction.current = null; run?.(); };
  const startFace = (row, afterDismiss = false) => { markRead(row); afterClose(afterDismiss, face.start); };
  const openRoute = (route, afterDismiss = false) => afterClose(afterDismiss, () => router.push(route));
  const canStartFace = row => row?.type === 'face_verification' && face.required && row.status !== 'completed';
  const allRead = async () => { setBusy(true); try { await inbox.markAll(); } catch { report(); } finally { setBusy(false); } };
  const loadMore = () => { if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore().catch(report); };

  return { inbox, face, now, sections, unreadOnly, setUnreadOnly, detail, detailOpen: !!detailId, busy, open, markRead, closeDetail, flushPending, startFace, openRoute, canStartFace, allRead, loadMore };
}
