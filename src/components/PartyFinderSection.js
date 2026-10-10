import Text from './AppText';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import FeatureIcon from './FeatureIcon';
import NativeAdCard from './NativeAdCard';
import { insertActivityAdSlots } from '../utils/adPolicy';
import { useAppFeed, useAppProfile } from '../context/AppContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '../theme';


function startMillis(party) {
  if (typeof party?.schedule?.startsAt?.toMillis === 'function') {
    return party.schedule.startsAt.toMillis();
  }
  return party.schedule?.startsAt
    || Date.parse(`${party.schedule?.date || ''}T${party.schedule?.startTime || '00:00'}:00+07:00`)
    || 0;
}

export function getPartyUrgencyInfo(party, now = new Date()) {
  const partyStart = startMillis(party);
  const partyEnd = Date.parse(`${party.schedule?.date || ''}T${party.schedule?.endTime || party.schedule?.startTime || '23:59'}:00+07:00`)
    || (partyStart + 2 * 3600 * 1000);

  const nowMs = now.getTime();
  const isPast = partyStart <= nowMs || party.status !== 'open';
  const memberCount = Number(party.acceptedCount || party.memberCount || party.memberIds?.length || 1);
  const maxPeople = Number(party.maxPeople || 2);
  const remainingSlots = Math.max(0, maxPeople - memberCount);
  const isFull = remainingSlots === 0;

  const diffMs = partyStart - nowMs;
  const partyDateStr = party.schedule?.date || '';
  const nowDateStr = new Date(nowMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let isToday = false;
  let isTomorrow = false;
  if (partyDateStr) {
    const pDate = new Date(`${partyDateStr}T00:00:00+07:00`);
    const nDate = new Date(`${nowDateStr}T00:00:00+07:00`);
    const dayDiff = Math.round((pDate.getTime() - nDate.getTime()) / (24 * 3600 * 1000));
    isToday = dayDiff === 0;
    isTomorrow = dayDiff === 1;
  } else {
    isToday = diffMs >= 0 && diffMs <= 24 * 3600 * 1000;
  }

  // Refit condition: Happening today or tomorrow, has remaining open slots, not yet past
  const isUrgentRefit = diffMs > 0 && !isFull && (isToday || isTomorrow || diffMs <= 36 * 3600 * 1000);

  let urgencyBadge = null;
  if (isUrgentRefit) {
    if (isToday) {
      urgencyBadge = {
        label: `วันนี้นัดแล้ว! ว่างอีก ${remainingSlots} ที่`,
        type: 'today',
        color: '#FF3B30',
        bg: '#FFE5E5',
      };
    } else {
      urgencyBadge = {
        label: `วันสุดท้าย! ว่างอีก ${remainingSlots} ที่`,
        type: 'tomorrow',
        color: '#FF9500',
        bg: '#FFF0D6',
      };
    }
  }

  let rank = 2;
  if (isPast) {
    rank = 4;
  } else if (isUrgentRefit) {
    rank = 1;
  } else if (isFull) {
    rank = 3;
  } else {
    rank = 2;
  }

  return {
    partyStart,
    partyEnd,
    isPast,
    requestStatus: isPast && party.requestStatus === 'pending'
      ? (party.status === 'cancelled' ? 'cancelled' : 'expired') : party.requestStatus,
    pendingRequests: isPast ? [] : party.pendingRequests,
    isFull,
    memberCount,
    maxPeople,
    remainingSlots,
    isUrgentRefit,
    urgencyBadge,
    rank,
  };
}

export function sortAndRefitMeetups(parties = [], now = new Date()) {
  return [...parties].map((party) => {
    const urgency = getPartyUrgencyInfo(party, now);
    return {
      ...party,
      ...urgency,
    };
  }).sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    if (a.partyStart !== b.partyStart) {
      return a.partyStart - b.partyStart;
    }
    const aCreated = a.createdAt?.toMillis?.() || Date.parse(a.createdAt || 0) || 0;
    const bCreated = b.createdAt?.toMillis?.() || Date.parse(b.createdAt || 0) || 0;
    return bCreated - aCreated;
  });
}

function HostAvatar({ uri, name, size = 38, colors }) {
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
  }, [uri]);

  const initial = String(name || 'พ').trim().slice(0, 1);
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));

  if (!isUrl || loadError) {
    return (
      <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors?.primarySoft || '#EAEBFF' }]}>
        <Text style={[styles.avatarInitial, { fontSize: size * 0.42, color: colors?.primary || '#5B5CE2' }]}>{initial}</Text>
      </View>
    );
  }

  return (
    <ExpoImage
      source={{ uri }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
      onError={() => setLoadError(true)}
      style={[styles.avatarImage, { width: size, height: size, borderRadius: size / 2, borderColor: colors?.card || '#FFFFFF' }]}
    />
  );
}

function PartyDetailModal({
  visible,
  party,
  spot,
  colors,
  busy,
  onClose,
  onJoin,
  onWithdraw,
  onApprove,
  onReject,
  onCancel,
  onRetryActivation,
  onOpenChat,
  onOpenMap,
  onLoadMoreRequests,
}) {
  const { profile: currentProfile } = useAppProfile();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const lastParty = useRef(party);
  const pendingAction = useRef(null);
  if (party) lastParty.current = party;
  const flushAction = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };
  useEffect(() => {
    if (visible || Platform.OS === 'ios') return undefined;
    // Android removes a hidden RN Modal in this commit. Continue on the next
    // native frame; iOS instead reports the completed dismissal below.
    const nextFrame = requestAnimationFrame(flushAction);
    return () => cancelAnimationFrame(nextFrame);
  }, [visible]);
  party = party || lastParty.current;
  if (!party) return null;
  const closeAndRun = (action) => {
    if (pendingAction.current) return;
    pendingAction.current = action;
    onClose();
  };
  const mine = party.isUserHost;
  const myAvatar = mine ? (currentProfile?.avatarUri || (Array.isArray(currentProfile?.photos) ? currentProfile.photos[0] : null)) : null;
  const hostAvatarUri = party.host?.avatarUri || party.host?.photoURL || myAvatar;
  const hostName = mine ? (currentProfile?.nickname || currentProfile?.name || party.host?.name || 'ตี้ของคุณ') : (party.host?.name || 'ผู้ใช้ ม.อ.');
  const hostFaculty = mine ? (currentProfile?.faculty || party.host?.faculty) : party.host?.faculty;
  const hostYear = mine ? (currentProfile?.year || party.host?.year) : party.host?.year;

  return (
    <Modal visible={visible} animationType={Platform.OS === 'ios' ? 'slide' : 'none'} transparent onRequestClose={onClose} onDismiss={flushAction}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalDismissArea} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          {/* Clean Modal Header - without fake photo */}
          <View style={[styles.modalHeaderBar, { borderBottomColor: colors.line }]}>
            <View style={styles.modalHeaderTitleRow}>
              <View style={[styles.modalHeaderIconWrap, { backgroundColor: colors.primarySoft }]}>
                <FeatureIcon name="mappin.circle.fill" size={20} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderTitleTextWrap}>
                <Text style={[styles.modalTitle, { color: colors.ink }]} numberOfLines={2}>
                  {party.spotName || 'จุดนัดหมาย'}
                </Text>
                {party.urgencyBadge ? (
                  <View style={[styles.modalUrgentTagInline, { backgroundColor: party.urgencyBadge.bg }]}>
                    <FeatureIcon name="flame.fill" size={11} color={party.urgencyBadge.color} />
                    <Text style={[styles.modalUrgentTagInlineText, { color: party.urgencyBadge.color }]}>
                      {party.urgencyBadge.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable accessibilityLabel="ปิด" onPress={onClose} style={[styles.modalCloseBtnInline, { backgroundColor: colors.surfaceRaised }]}>
              <FeatureIcon name="xmark" size={16} color={colors.inkMuted} />
            </Pressable>
          </View>

          <ScrollView style={[styles.modalContent, { maxHeight: windowHeight * 0.48 }]} contentContainerStyle={styles.modalContentInner} showsVerticalScrollIndicator={false}>
            <View style={styles.modalPhoto}><PartyPhoto spot={spot} party={party} colors={colors} /></View>
            {/* Host Banner */}
            <View style={[styles.modalHostCard, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
              <HostAvatar uri={hostAvatarUri} name={hostName} size={46} colors={colors} />
              <View style={styles.modalHostMeta}>
                <View style={styles.modalHostNameRow}>
                  <Text style={[styles.modalHostName, { color: colors.ink }]}>{hostName}</Text>
                  <View style={[styles.modalHostBadge, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.modalHostBadgeText, { color: colors.primary }]}>{mine ? 'ตี้ของคุณ' : 'โฮสต์'}</Text>
                  </View>
                </View>
                <Text style={[styles.modalHostFaculty, { color: colors.inkMuted }]}>
                  {[hostFaculty, hostYear].filter(Boolean).join(' · ') || 'นักศึกษา ม.อ.'}
                </Text>
              </View>
            </View>

            {/* Details Pills */}
            <View style={styles.modalMetaRow}>
              <View style={[styles.modalPill, { backgroundColor: colors.surfaceRaised }]}>
                <FeatureIcon name="calendar" size={15} color={colors.primary} />
                <Text style={[styles.modalPillText, { color: colors.ink }]}>
                  {party.schedule?.date || ''} · {party.schedule?.startTime || ''}–{party.schedule?.endTime || ''} น.
                </Text>
              </View>
              {party.categoryLabel ? (
                <View style={[styles.modalPill, { backgroundColor: colors.surfaceRaised }]}>
                  <FeatureIcon name={party.categoryIcon || 'tag.fill'} size={15} color={colors.primary} />
                  <Text style={[styles.modalPillText, { color: colors.ink }]}>{party.categoryLabel}</Text>
                </View>
              ) : null}
            </View>

            {/* Capacity Slot Visualizer */}
            <View style={[styles.modalCapacityBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
              <View style={styles.modalCapacityHeader}>
                <Text style={[styles.modalCapacityTitle, { color: colors.ink }]}>สมาชิกในตี้</Text>
                <Text style={[styles.modalCapacityCount, { color: colors.inkMuted }]}>
                  {party.memberCount || 1}/{party.maxPeople || 2} คน
                </Text>
              </View>
              <View style={styles.modalSlotsRow}>
                {Array.from({ length: party.maxPeople || 2 }).map((_, idx) => {
                  const member = party.members?.[idx];
                  const isFilled = idx < (party.memberCount || 1);
                  return (
                    <View key={idx} style={[styles.modalSlotPill, { backgroundColor: isFilled ? colors.primarySoft : colors.card, borderColor: isFilled ? colors.primary : colors.line }]}>
                      {member ? (
                        <HostAvatar uri={member.avatarUri} name={member.name} size={22} colors={colors} />
                      ) : (
                        <FeatureIcon name={isFilled ? 'person.fill' : 'plus'} size={14} color={isFilled ? colors.primary : colors.inkSoft} />
                      )}
                      <Text style={[styles.modalSlotText, { color: isFilled ? colors.primary : colors.inkMuted }]}>
                        {member?.name ? member.name.slice(0, 5) : isFilled ? `คนที่ ${idx + 1}` : 'ว่าง'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Host: Pending Join Requests */}
            {mine && party.pendingRequests && party.pendingRequests.length > 0 ? (
              <View style={[styles.modalRequestsBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
                <View style={styles.modalRequestsHeader}>
                  <FeatureIcon name="person.badge.plus" size={16} color={colors.primary} />
                  <Text style={[styles.modalRequestsTitle, { color: colors.ink }]}>
                    คำขอเข้าร่วม ({party.pendingRequests.length} คน)
                  </Text>
                </View>
                {party.pendingRequests.map((req) => (
                  <View key={req.id || req.requesterId} style={[styles.requestRow, { borderBottomColor: colors.line }]}>
                    <View style={styles.requestUserMeta}>
                      <HostAvatar uri={req.avatarUri} name={req.requesterName} size={34} colors={colors} />
                      <View style={styles.requestNameCol}>
                        <Text style={[styles.requestUserName, { color: colors.ink }]}>
                          {req.requesterName || 'ผู้ใช้ ม.อ.'}
                        </Text>
                        <Text style={[styles.requestUserSub, { color: colors.inkMuted }]}>
                          ขอร่วมตี้
                        </Text>
                      </View>
                    </View>
                    <View style={styles.requestActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`อนุมัติ ${req.requesterName}`}
                        disabled={busy}
                        onPress={() => onApprove?.(party, req)}
                        style={[styles.approveBtn, { backgroundColor: colors.primary }]}
                      >
                        <FeatureIcon name="checkmark" size={13} color={colors.onPrimary} />
                        <Text style={[styles.approveBtnText, { color: colors.onPrimary }]}>อนุมัติ</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`ปฏิเสธ ${req.requesterName}`}
                        disabled={busy}
                        onPress={() => onReject?.(party, req)}
                        style={[styles.rejectBtn, { backgroundColor: colors.card, borderColor: colors.line }]}
                      >
                        <FeatureIcon name="xmark" size={13} color={colors.inkMuted} />
                      </Pressable>
                    </View>
                  </View>
                ))}
                {party.hasMoreRequests ? <Pressable accessibilityRole="button" disabled={party.loadingMoreRequests || busy} onPress={() => onLoadMoreRequests?.(party.id)} style={{ minHeight: 44, justifyContent: 'center' }}>
                  {party.loadingMoreRequests ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary }}>โหลดคำขอเพิ่ม</Text>}
                </Pressable> : null}
              </View>
            ) : null}

            {/* Host Announcement Quote */}
            {party.schedule?.message ? (
              <View style={[styles.modalQuoteBox, { backgroundColor: colors.primarySoft }]}>
                <FeatureIcon name="quote.bubble.fill" size={18} color={colors.primary} />
                <Text style={[styles.modalQuoteText, { color: colors.ink }]}>{party.schedule.message}</Text>
              </View>
            ) : null}

            {/* Map Action */}
            {party.spot?.latitude && party.spot?.longitude ? (
              <Pressable accessibilityRole="button" onPress={() => closeAndRun(() => onOpenMap?.(party.spot))} style={[styles.modalMapBtn, { borderColor: colors.line }]}>
                <FeatureIcon name="map.fill" size={16} color={colors.primary} />
                <Text style={[styles.modalMapBtnText, { color: colors.primary }]}>ดูตำแหน่งบนแผนที่ ม.อ.</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {mine && party.activationError ? <Pressable accessibilityRole="button" onPress={() => onRetryActivation?.(party)}
            style={[styles.hostPendingAlert, { backgroundColor: colors.coralSoft, borderColor: colors.coral, marginHorizontal: 18, marginBottom: 8 }]}>
            <FeatureIcon name="clock.arrow.2.circlepath" size={14} color={colors.coral} />
            <Text style={[styles.hostPendingAlertText, { color: colors.coral }]}>{party.activationError} · ลองเตรียมแชตอีกครั้ง</Text>
          </Pressable> : null}

          {/* Action Footer */}
          <View style={[styles.modalFooter, { backgroundColor: colors.card, borderTopColor: colors.line, paddingBottom: Math.max(12, insets.bottom + 12) }]}>
            {busy ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : (mine || party.isMember) && party.groupReady ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => closeAndRun(() => onOpenChat?.(party))}
                style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
              >
                <FeatureIcon name="bubble.left.and.bubble.right.fill" size={18} color={colors.onPrimary} />
                <Text style={[styles.modalPrimaryBtnText, { color: colors.onPrimary }]}>เปิดแชตกลุ่มตี้</Text>
              </Pressable>
            ) : mine || party.isMember ? (
              <View style={[styles.modalDisabledBtn, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.modalDisabledBtnText, { color: colors.inkMuted }]}>แชตกลุ่มเปิดหลังอนุมัติสมาชิกคนแรก</Text>
              </View>
            ) : party.status === 'cancelled' ? (
              <View style={[styles.modalDisabledBtn, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.modalDisabledBtnText, { color: colors.inkMuted }]}>เจ้าของยกเลิกตี้นี้แล้ว</Text>
              </View>
            ) : party.requestStatus === 'pending' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onWithdraw?.(party)}
                style={[styles.modalSecondaryBtn, { backgroundColor: colors.surfaceRaised }]}
              >
                <FeatureIcon name="xmark.circle.fill" size={18} color={colors.inkMuted} />
                <Text style={[styles.modalSecondaryBtnText, { color: colors.inkMuted }]}>ถอนคำขอเข้าร่วม</Text>
              </Pressable>
            ) : party.isPast || party.isFull ? (
              <View style={[styles.modalDisabledBtn, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.modalDisabledBtnText, { color: colors.inkMuted }]}>
                  {party.isPast ? 'เวลานัดหมายผ่านไปแล้ว' : 'สมาชิกเต็มจำนวนแล้ว'}
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => onJoin?.(party)}
                style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
              >
                <FeatureIcon name="person.badge.plus" size={18} color={colors.onPrimary} />
                <Text style={[styles.modalPrimaryBtnText, { color: colors.onPrimary }]}>
                  {`ขอร่วมตี้กับคุณ ${party.host?.name || 'โฮสต์'}`}
                </Text>
              </Pressable>
            )}
            {mine && party.status === 'open' && !party.isPast ? <Pressable accessibilityRole="button" onPress={() => onCancel?.(party)}
              style={[styles.modalSecondaryBtn, { backgroundColor: colors.surfaceRaised, marginTop: 8 }]}>
              <Text style={[styles.modalSecondaryBtnText, { color: colors.danger }]}>ยกเลิกตี้นี้</Text>
            </Pressable> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function resolvePartySpot(party, campusSpots) {
  const spot = party.spot || party.location || {};
  const id = spot.id || spot.spotId || party.location?.spotId;
  const name = String(spot.name || party.spotName || '').trim();
  const campus = campusSpots.find(entry => (id && entry.id === id)
    || (name && String(entry.name || '').trim() === name));
  return campus ? { ...campus, ...spot, placePhoto: spot.placePhoto || campus.placePhoto } : spot;
}

function formatPartyDate(party) {
  const value = party.schedule?.date;
  if (!value) return 'ยังไม่ระบุวัน';
  const date = new Date(`${value}T12:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
}

function PartyPhoto({ spot, party, colors }) {
  // Use only a photo attached to this location. A category or a random campus
  // photo would make a pin look like a different place.
  const metadata = spot?.placePhoto || party.placePhoto;
  const uri = metadata?.url || metadata?.thumbnailUrl || spot?.photoUrl || spot?.imageUri || party.photoUrl;
  const [failedUri, setFailedUri] = useState(null);
  const hasPhoto = typeof uri === 'string' && /^(https?:\/\/|file:\/\/|data:)/.test(uri) && failedUri !== uri;
  return <View style={[styles.placePhoto, { backgroundColor: colors.surfaceRaised }]}>
    {hasPhoto ? <ExpoImage source={{ uri }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${party.id}:${uri}`} transition={0} accessibilityLabel={`ภาพสถานที่ ${party.spotName || spot?.name || ''}`} onError={() => setFailedUri(uri)} style={StyleSheet.absoluteFill} /> : <View style={styles.photoPlaceholder}>
      <View style={[styles.photoPlaceholderIcon, { backgroundColor: colors.card }]}><FeatureIcon name="mappin.and.ellipse" size={28} color={colors.primary} /></View>
      <Text style={[styles.photoPlaceholderTitle, { color: colors.ink }]} numberOfLines={2}>{party.spotName || spot?.name || 'จุดนัดหมาย ม.อ.'}</Text>
      <Text style={[styles.photoPlaceholderCopy, { color: colors.inkMuted }]}>ยังไม่มีภาพของสถานที่นี้</Text>
    </View>}
    {hasPhoto && metadata?.credit ? <View style={styles.photoCredit}><Text style={styles.photoCreditText} numberOfLines={1}>{`ภาพ: ${metadata.credit}${metadata.license ? ` · ${metadata.license}` : ''}`}</Text></View> : null}
  </View>;
}

function partyStatus(party, remaining, colors) {
  if (party.status === 'cancelled') return { text: 'ยกเลิกแล้ว', icon: 'xmark.circle.fill', color: colors.inkMuted, background: colors.surfaceRaised };
  if (party.isUserHost) return { text: 'ตี้ของคุณ', icon: 'person.fill', color: colors.primary, background: colors.primarySoft };
  if (party.isMember) return { text: 'เข้าร่วมแล้ว', icon: 'checkmark.circle.fill', color: colors.mint, background: colors.mintSoft };
  if (party.requestStatus === 'pending') return { text: 'รออนุมัติ', icon: 'clock.fill', color: colors.amber, background: colors.amberSoft };
  if (party.requestStatus === 'rejected') return { text: 'คำขอไม่ได้รับอนุมัติ', icon: 'xmark.circle.fill', color: colors.inkMuted, background: colors.surfaceRaised };
  if (party.isPast) return { text: 'หมดเวลานัด', icon: 'clock.fill', color: colors.inkMuted, background: colors.surfaceRaised };
  if (party.isFull) return { text: 'ตี้เต็มแล้ว', icon: 'person.2.fill', color: colors.inkMuted, background: colors.surfaceRaised };
  if (party.urgencyBadge) return { text: party.urgencyBadge.type === 'today' ? 'นัดวันนี้' : 'นัดพรุ่งนี้', icon: 'flame.fill', color: party.urgencyBadge.color, background: party.urgencyBadge.bg };
  return { text: `ว่าง ${remaining} ที่`, icon: 'person.badge.plus', color: colors.primary, background: colors.primarySoft };
}

function PartyCard({ party, spot, colors, busy, onSelect, onJoin, onWithdraw, onOpenChat }) {
  const { profile: currentProfile } = useAppProfile();
  const mine = party.isUserHost;
  const myAvatar = mine ? (currentProfile?.avatarUri || (Array.isArray(currentProfile?.photos) ? currentProfile.photos[0] : null)) : null;
  const hostAvatarUri = party.host?.avatarUri || party.host?.photoURL || myAvatar;
  const hostName = mine ? (currentProfile?.nickname || currentProfile?.name || party.host?.name || 'ตี้ของคุณ') : (party.host?.name || 'เพื่อน ม.อ.');
  const hostFaculty = mine ? (currentProfile?.faculty || party.host?.faculty) : party.host?.faculty;
  const hostYear = mine ? (currentProfile?.year || party.host?.year) : party.host?.year;
  const members = Number(party.acceptedCount || party.memberCount || party.memberIds?.length || 1);
  const capacity = Number(party.maxPeople || 2);
  const remaining = Math.max(0, capacity - members);
  const status = partyStatus(party, remaining, colors);
  const time = [party.schedule?.startTime, party.schedule?.endTime].filter(Boolean).join('–');
  const select = () => onSelect?.(party);
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`ดูรายละเอียดตี้ของ ${hostName} ที่ ${party.spotName || 'จุดนัดหมาย'}`} onPress={select} style={({ pressed }) => pressed && styles.pressed}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.hostRow}>
          <HostAvatar uri={hostAvatarUri} name={hostName} size={42} colors={colors} />
          <View style={styles.hostMeta}>
            <Text style={[styles.hostName, { color: colors.ink }]} numberOfLines={1}>{hostName}</Text>
            <Text style={[styles.hostSub, { color: colors.inkMuted }]} numberOfLines={1}>{[hostFaculty, hostYear].filter(Boolean).join(' · ') || 'นักศึกษา ม.อ.'}</Text>
          </View>
        </View>
        <FeatureIcon name="ellipsis" size={20} color={colors.inkMuted} />
      </View>
      <PartyPhoto spot={spot} party={party} colors={colors} />
      <View style={styles.cardBody}>
        <View style={styles.cardStatusRow}>
          <View style={[styles.statusBadge, { backgroundColor: status.background }]}><FeatureIcon name={status.icon} size={13} color={status.color} /><Text style={[styles.statusBadgeText, { color: status.color }]}>{status.text}</Text></View>
          {party.categoryLabel || spot?.categoryLabel ? <Text style={[styles.categoryLabel, { color: colors.inkMuted }]}>{party.categoryLabel || spot.categoryLabel}</Text> : null}
        </View>
        <Text style={[styles.cardSpotName, { color: colors.ink }]} numberOfLines={3}>{party.spotName || spot?.name || 'จุดนัดหมาย ม.อ.'}</Text>
        {party.schedule?.message ? <Text style={[styles.caption, { color: colors.ink }]} numberOfLines={4}>{party.schedule.message}</Text> : null}
        <View style={[styles.scheduleBox, { backgroundColor: colors.surfaceRaised }]}>
          <FeatureIcon name="calendar" size={18} color={colors.primary} />
          <View style={styles.scheduleCopy}><Text style={[styles.scheduleDate, { color: colors.ink }]}>{formatPartyDate(party)}</Text><Text style={[styles.scheduleTime, { color: colors.inkMuted }]}>{time ? `${time} น.` : 'ยังไม่ระบุเวลา'}</Text></View>
        </View>
        <View style={styles.slotRow}><View style={styles.slotMeta}><FeatureIcon name="person.2.fill" size={16} color={colors.primary} /><Text style={[styles.slotMetaText, { color: colors.ink }]}>{`สมาชิก ${members}/${capacity} คน`}</Text></View><Text style={[styles.remainingText, { color: colors.inkMuted }]}>{remaining ? `รับอีก ${remaining} คน` : 'ครบทีมแล้ว'}</Text></View>
        <View style={[styles.capacityTrack, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.capacityFill, { backgroundColor: colors.primary, width: `${Math.min(100, (members / Math.max(1, capacity)) * 100)}%` }]} /></View>
        {mine && party.pendingRequests?.length > 0 ? <View style={[styles.hostPendingAlert, { backgroundColor: colors.coralSoft, borderColor: colors.coral }]}><FeatureIcon name="person.badge.plus" size={15} color={colors.coral} /><Text style={[styles.hostPendingAlertText, { color: colors.coral }]}>{`มี ${party.pendingRequests.length} คำขอรออนุมัติ · แตะเพื่อจัดการ`}</Text></View> : null}
      </View>
    </Pressable>
    <View style={[styles.cardActionRow, { borderTopColor: colors.line }]}>
      <PartyCardAction party={party} remaining={remaining} colors={colors} busy={busy} onSelect={select} onJoin={onJoin} onWithdraw={onWithdraw} onOpenChat={onOpenChat} />
      <Pressable accessibilityRole="button" accessibilityLabel="ดูรายละเอียดตี้" onPress={select} style={[styles.detailIconBtn, { backgroundColor: colors.surfaceRaised }]}><FeatureIcon name="chevron.right" size={17} color={colors.inkMuted} /></Pressable>
    </View>
  </View>;
}

function PartyQuickAction({ colors, icon, label, onPress, secondary = false, color }) {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    style={[styles.quickBtn, { backgroundColor: color || (secondary ? colors.surfaceRaised : colors.primary) }]}
  >
    <FeatureIcon name={icon} size={16} color={secondary ? colors.inkMuted : colors.onPrimary} />
    <Text style={[styles.quickBtnText, { color: secondary ? colors.inkMuted : colors.onPrimary }]}>{label}</Text>
  </Pressable>;
}

function PartyCardAction({ party, remaining, colors, busy, onSelect, onJoin, onWithdraw, onOpenChat }) {
  const message = value => <Text style={[styles.disabledText, { color: colors.inkMuted }]}>{value}</Text>;
  if (busy) return <View style={styles.busyAction}>
    <ActivityIndicator size="small" color={colors.primary} />
    {message('กำลังดำเนินการ…')}
  </View>;
  if (party.isUserHost) return <View style={styles.hostActionButtons}>
    {party.pendingRequests?.length > 0 ? <PartyQuickAction colors={colors} color={colors.coral} icon="person.badge.plus" label={`คำขอ ${party.pendingRequests.length}`} onPress={onSelect} /> : null}
    {party.groupReady
      ? <PartyQuickAction colors={colors} icon="bubble.left.and.bubble.right.fill" label="แชตกลุ่ม" onPress={() => onOpenChat?.(party)} />
      : message('แชตเปิดหลังอนุมัติสมาชิกคนแรก')}
  </View>;
  if (party.isMember) return party.groupReady
    ? <PartyQuickAction colors={colors} icon="bubble.left.and.bubble.right.fill" label="เปิดแชตกลุ่ม" onPress={() => onOpenChat?.(party)} />
    : message('กำลังเตรียมแชตกลุ่ม');
  if (party.status === 'cancelled') return message('ตี้ยกเลิกแล้ว');
  if (party.requestStatus === 'pending') return <PartyQuickAction colors={colors} secondary icon="xmark.circle.fill" label="ถอนคำขอ" onPress={() => onWithdraw?.(party)} />;
  if (party.isPast || party.isFull) return message(party.isPast ? 'หมดเวลานัด' : 'ตี้เต็มแล้ว');
  return <PartyQuickAction colors={colors} icon="person.badge.plus" label={`ขอเข้าร่วม · ว่าง ${remaining} ที่`} onPress={() => onJoin?.(party)} />;
}

export default function PartyFinderSection({
  targetPartyId = null,
  parties = [],
  loading = false,
  error = null,
  busyPartyId = null,
  onCreateParty,
  onJoinParty,
  onWithdrawRequest,
  onApproveRequest,
  onRejectRequest,
  onCancelParty,
  onRetryActivation,
  onOpenChat,
  onOpenMap,
  onRetry,
  onLoadMore,
  onLoadMoreRequests,
  hasMore = false,
  loadingMore = false,
}) {
  const { colors } = useTheme();
  const { campusSpots = [] } = useAppFeed();
  const [tab, setTab] = useState('open');
  const [selectedPartyId, setSelectedPartyId] = useState(targetPartyId);
  useEffect(() => setSelectedPartyId(targetPartyId), [targetPartyId]);

  const pendingRequestsCount = useMemo(() => {
    let count = 0;
    parties.forEach((p) => {
      if (p.isUserHost && p.pendingRequests?.length > 0) count += p.pendingRequests.length;
      if (p.requestStatus === 'pending') count += 1;
    });
    return count;
  }, [parties]);

  const tabs = [
    { id: 'open', label: 'เปิดรับ' },
    { id: 'requests', label: 'คำขอ', badge: pendingRequestsCount > 0 ? pendingRequestsCount : null },
    { id: 'mine', label: 'ตี้ของฉัน' },
  ];

  const visible = useMemo(() => {
    if (tab === 'mine') return parties.filter((party) => party.isUserHost || party.isMember);
    if (tab === 'requests') {
      return parties.filter((party) =>
        (party.requestStatus && !party.isMember) || (party.isUserHost && party.pendingRequests?.length > 0)
      );
    }
    return parties.filter((party) => !party.isPast && !party.isMember && !party.isUserHost);
  }, [parties, tab]);

  const activeSelectedParty = useMemo(() => {
    if (!selectedPartyId) return null;
    return parties.find((p) => p.id === selectedPartyId) || null;
  }, [parties, selectedPartyId]);

  const feedRows = useMemo(() => insertActivityAdSlots(visible), [visible]);
  const header = <View style={styles.feedHeader}>
      {/* Banner Header */}
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <View style={styles.badgeLine}>
            <View style={[styles.bannerLiveDot, { backgroundColor: colors.green }]} />
            <Text style={[styles.bannerTag, { color: colors.primary }]}>ตี้กิจกรรมรอบ ม.อ.</Text>
          </View>
          <Text style={[styles.headingTitle, { color: colors.ink }]}>ไปทำกิจกรรมด้วยกัน</Text>
          <Text style={[styles.headingSubtitle, { color: colors.inkMuted }]}>
            หาเพื่อนทำกิจกรรม นัดเจอกันใน ม.อ.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="สร้างตี้ใหม่"
          onPress={onCreateParty}
          style={[styles.createBtn, { backgroundColor: colors.primary }]}
        >
          <FeatureIcon name="plus" size={18} color={colors.onPrimary} />
          <Text style={[styles.createBtnText, { color: colors.onPrimary }]}>เปิดตี้</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {tabs.map((item) => {
          const isSelected = tab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setTab(item.id)}
              style={[
                styles.tab,
                { backgroundColor: isSelected ? colors.primary : colors.surfaceRaised },
              ]}
            >
              <Text style={[styles.tabLabel, { color: isSelected ? colors.onPrimary : colors.inkMuted }]}>
                {item.label}
              </Text>
              {item.badge ? (
                <View style={[styles.tabBadge, { backgroundColor: isSelected ? colors.onPrimary : colors.coral }]}>
                  <Text style={[styles.tabBadgeText, { color: isSelected ? colors.primary : '#FFFFFF' }]}>
                    {item.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={[styles.stateCard, { borderColor: colors.danger, backgroundColor: colors.dangerSoft }]}>
          <FeatureIcon name="exclamationmark.triangle.fill" size={32} color={colors.danger} />
          <Text style={[styles.stateText, { color: colors.danger }]}>
            {typeof error === 'string' ? error : error?.message || 'เกิดข้อผิดพลาดในการโหลดรายการตี้'}
          </Text>
          {onRetry ? (
            <Pressable onPress={onRetry} style={[styles.retryBtn, { backgroundColor: colors.danger }]}>
              <Text style={styles.retryBtnText}>ลองใหม่อีกครั้ง</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>;
  const empty = (
      loading ? (
        <View style={[styles.stateCard, { borderColor: colors.line, backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.inkMuted }]}>กำลังโหลดรายการตี้...</Text>
        </View>
      ) : !visible.length && !error ? (
        <View style={[styles.stateCard, { borderColor: colors.line, backgroundColor: colors.card }]}>
          <FeatureIcon name="person.3.fill" size={32} color={colors.inkMuted} />
          <Text style={[styles.stateText, { color: colors.inkMuted }]}>
            {tab === 'open'
              ? 'ยังไม่มีตี้ที่เปิดรับ'
              : tab === 'requests'
              ? 'ยังไม่มีคำขอเข้าร่วม'
              : 'ยังไม่มีตี้ของคุณ'}
          </Text>
          <Text style={[styles.stateHint, { color: colors.inkMuted }]}>{tab === 'requests' ? 'คำขอที่ส่งและคำขอจากเพื่อนจะอยู่ที่นี่' : 'เปิดตี้ของคุณ ชวนเพื่อนมาเข้าร่วมกิจกรรมด้วยกัน'}</Text>
          {tab !== 'requests' && onCreateParty ? <Pressable accessibilityRole="button" onPress={onCreateParty} style={[styles.retryBtn, { backgroundColor: colors.primary }]}><Text style={[styles.retryBtnText, { color: colors.onPrimary }]}>เปิดตี้ใหม่</Text></Pressable> : null}
        </View>
      ) : null
  );
  const footer = (
      hasMore ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={onLoadMore} style={[styles.loadMore, { backgroundColor: colors.card, borderColor: colors.line }]}>
        {loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '700' }}>โหลดตี้และคำขอเพิ่มเติม</Text>}
      </Pressable> : null
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={feedRows}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.feedContent}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        ItemSeparatorComponent={() => <View style={styles.feedSeparator} />}
        renderItem={({ item }) => item.kind === 'native-ad'
          ? <NativeAdCard style={{ width: '100%' }} />
          : <PartyCard
              party={item}
              spot={resolvePartySpot(item, campusSpots)}
              colors={colors}
              busy={busyPartyId === item.id}
              onSelect={(party) => setSelectedPartyId(party.id)}
              onJoin={onJoinParty}
              onWithdraw={onWithdrawRequest}
              onOpenChat={onOpenChat}
            />}
      />
      {/* Party Detail Modal */}
      <PartyDetailModal
        visible={Boolean(activeSelectedParty)}
        party={activeSelectedParty}
        spot={activeSelectedParty ? resolvePartySpot(activeSelectedParty, campusSpots) : null}
        colors={colors}
        busy={busyPartyId === activeSelectedParty?.id}
        onClose={() => setSelectedPartyId(null)}
        onJoin={(p) => {
          onJoinParty?.(p);
          setSelectedPartyId(null);
        }}
        onWithdraw={(p) => {
          onWithdrawRequest?.(p);
          setSelectedPartyId(null);
        }}
        onApprove={(p, req) => onApproveRequest?.(p, req)}
        onLoadMoreRequests={onLoadMoreRequests}
        onReject={(p, req) => onRejectRequest?.(p, req)}
        onCancel={onCancelParty}
        onRetryActivation={onRetryActivation}
        onOpenChat={(p) => {
          setSelectedPartyId(null);
          onOpenChat?.(p);
        }}
        onOpenMap={(spot) => {
          setSelectedPartyId(null);
          onOpenMap?.(spot);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%' },
  feedContent: { flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  feedHeader: { gap: 16, paddingBottom: 20 },
  feedSeparator: { height: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingText: { flex: 1, minWidth: 0, gap: 4 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerLiveDot: { width: 6, height: 6, borderRadius: 3 },
  bannerTag: { fontSize: 12, fontWeight: '600' },
  headingTitle: { fontSize: 20, lineHeight: 29, fontWeight: '700' },
  headingSubtitle: { fontSize: 13, lineHeight: 21 },
  createBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  createBtnText: { fontSize: 14, fontWeight: '700' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 14 },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, marginLeft: 5 },
  tabBadgeText: { fontSize: 11, fontWeight: '700' },
  card: { width: '100%', borderRadius: 22, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  pressed: { opacity: 0.92 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14 },
  hostRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hostMeta: { flex: 1, minWidth: 0, gap: 2 },
  hostName: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  hostSub: { fontSize: 12, lineHeight: 19 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontWeight: '700' },
  avatarImage: { borderWidth: StyleSheet.hairlineWidth },
  placePhoto: { width: '100%', aspectRatio: 4 / 3, overflow: 'hidden' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  photoPlaceholderIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderTitle: { fontSize: 17, lineHeight: 26, fontWeight: '600', textAlign: 'center' },
  photoPlaceholderCopy: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  photoCredit: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.5)' },
  photoCreditText: { fontSize: 10, color: '#FFFFFF' },
  cardBody: { padding: 16, gap: 12 },
  cardStatusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  statusBadgeText: { fontSize: 12, fontWeight: '600' },
  categoryLabel: { fontSize: 12, lineHeight: 20, flexShrink: 1 },
  cardSpotName: { fontSize: 19, lineHeight: 29, fontWeight: '700' },
  caption: { fontSize: 15, lineHeight: 24 },
  scheduleBox: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14 },
  scheduleCopy: { flex: 1, gap: 3 },
  scheduleDate: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  scheduleTime: { fontSize: 13, lineHeight: 21 },
  slotRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  slotMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  slotMetaText: { fontSize: 13, lineHeight: 21, fontWeight: '600' },
  remainingText: { fontSize: 12, lineHeight: 20 },
  capacityTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: -5 },
  capacityFill: { height: '100%', borderRadius: 2 },
  hostPendingAlert: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  hostPendingAlertText: { fontSize: 12, lineHeight: 20, fontWeight: '600', flex: 1 },
  cardActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  hostActionButtons: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  quickBtn: { flex: 1, minWidth: 90, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 13 },
  quickBtnText: { fontSize: 14, lineHeight: 22, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  detailIconBtn: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  busyAction: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  disabledText: { flex: 1, fontSize: 12, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  stateCard: { minHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateText: { fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 25 },
  stateHint: { fontSize: 13, textAlign: 'center', lineHeight: 22 },
  retryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  retryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  loadMore: { marginTop: 20, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  modalHeaderIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderTitleTextWrap: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  modalUrgentTagInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  modalUrgentTagInlineText: {
    fontSize: 10,
    fontWeight: '800',
  },
  modalCloseBtnInline: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: { flexShrink: 1 },
  modalPhoto: { borderRadius: 16, overflow: 'hidden' },
  modalContentInner: {
    padding: spacing.lg,
    gap: 14,
  },
  modalHostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalHostMeta: {
    flex: 1,
  },
  modalHostNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalHostName: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalHostBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modalHostBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalHostFaculty: {
    fontSize: 12,
    marginTop: 2,
  },
  modalMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  modalPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalCapacityBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  modalCapacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCapacityTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalCapacityCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalSlotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalSlotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modalSlotText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalQuoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  modalQuoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  modalMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  modalMapBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalFooter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  modalPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingVertical: 13,
    borderRadius: 14,
  },
  modalPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingVertical: 13,
    borderRadius: 14,
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalDisabledBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 13,
    borderRadius: 14,
  },
  modalDisabledBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalRequestsBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  modalRequestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalRequestsTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  requestUserMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  requestNameCol: {
    flex: 1,
  },
  requestUserName: {
    fontSize: 13,
    fontWeight: '700',
  },
  requestUserSub: {
    fontSize: 11,
    marginTop: 1,
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  approveBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rejectBtn: {
    padding: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
