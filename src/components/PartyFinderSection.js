import Text from './AppText';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import FeatureIcon from './FeatureIcon';
import NativeAdCard from './NativeAdCard';
import { insertActivityAdSlots } from '../utils/adPolicy';
import { useAppProfile } from '../context/AppContext';
import { radius, spacing, useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(320, SCREEN_WIDTH * 0.82);

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
  if (!party) return null;
  const mine = party.isUserHost;
  const myAvatar = mine ? (currentProfile?.avatarUri || (Array.isArray(currentProfile?.photos) ? currentProfile.photos[0] : null)) : null;
  const hostAvatarUri = party.host?.avatarUri || party.host?.photoURL || myAvatar;
  const hostName = mine ? (currentProfile?.nickname || currentProfile?.name || party.host?.name || 'ตี้ของคุณ') : (party.host?.name || 'ผู้ใช้ ม.อ.');
  const hostFaculty = mine ? (currentProfile?.faculty || party.host?.faculty) : party.host?.faculty;
  const hostYear = mine ? (currentProfile?.year || party.host?.year) : party.host?.year;
  const remaining = Math.max(0, Number(party.maxPeople || 2) - Number(party.memberCount || 1));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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
                <Text style={[styles.modalTitle, { color: colors.ink }]} numberOfLines={1}>
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

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner} showsVerticalScrollIndicator={false}>
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
                {party.hasMoreRequests ? <Pressable accessibilityRole="button" onPress={() => onLoadMoreRequests?.(party.id)} style={{ paddingVertical: 10 }}>
                  <Text style={{ color: colors.primary }}>โหลดคำขอเพิ่ม</Text>
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
              <Pressable accessibilityRole="button" onPress={() => onOpenMap?.(party.spot)} style={[styles.modalMapBtn, { borderColor: colors.line }]}>
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
          <View style={[styles.modalFooter, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
            {busy ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : (mine || party.isMember) && party.groupReady ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenChat?.(party)}
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

function PartyCard({ party, colors, busy, onSelect, onJoin, onWithdraw, onOpenChat }) {
  const { profile: currentProfile } = useAppProfile();
  const mine = party.isUserHost;
  const myAvatar = mine ? (currentProfile?.avatarUri || (Array.isArray(currentProfile?.photos) ? currentProfile.photos[0] : null)) : null;
  const hostAvatarUri = party.host?.avatarUri || party.host?.photoURL || myAvatar;
  const hostName = mine ? (currentProfile?.nickname || currentProfile?.name || party.host?.name || 'ตี้ของคุณ') : (party.host?.name || 'เพื่อน ม.อ.');
  const hostFaculty = mine ? (currentProfile?.faculty || party.host?.faculty) : party.host?.faculty;
  const hostYear = mine ? (currentProfile?.year || party.host?.year) : party.host?.year;
  const remaining = Math.max(0, Number(party.maxPeople || 2) - Number(party.memberCount || 1));

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: party.isUrgentRefit ? party.urgencyBadge?.color || colors.primary : colors.line,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`ดูรายละเอียดตี้ ${party.spotName}`}
        onPress={() => onSelect?.(party)}
        style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
      >
        <View style={styles.cardBody}>
          {/* Card Header: Host Info & Status Badge */}
          <View style={styles.cardHeaderRow}>
            <View style={styles.hostRow}>
              <HostAvatar uri={hostAvatarUri} name={hostName} size={36} colors={colors} />
              <View style={styles.hostMeta}>
                <View style={styles.hostTitleRow}>
                  <Text style={[styles.hostName, { color: colors.ink }]} numberOfLines={1}>
                    {hostName}
                  </Text>
                  <View style={[styles.hostRoleBadge, { backgroundColor: mine ? colors.mintSoft : colors.primarySoft }]}>
                    <Text style={[styles.hostRoleText, { color: mine ? colors.mint : colors.primary }]}>
                      {mine ? 'ฉัน' : 'โฮสต์'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.hostSub, { color: colors.inkMuted }]} numberOfLines={1}>
                  {[hostFaculty, hostYear].filter(Boolean).join(' · ') || 'นักศึกษา ม.อ.'}
                </Text>
              </View>
            </View>

            {/* Status Badge */}
            {party.status === 'cancelled' ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
                <FeatureIcon name="xmark.circle.fill" size={11} color={colors.inkMuted} />
                <Text style={[styles.statusBadgeText, { color: colors.inkMuted }]}>ยกเลิกแล้ว</Text>
              </View>
            ) : party.urgencyBadge ? (
              <View style={[styles.statusBadge, { backgroundColor: party.urgencyBadge.bg, borderColor: party.urgencyBadge.color }]}>
                <FeatureIcon name="flame.fill" size={11} color={party.urgencyBadge.color} />
                <Text style={[styles.statusBadgeText, { color: party.urgencyBadge.color }]}>
                  {party.urgencyBadge.type === 'today' ? 'วันนี้นัดแล้ว!' : 'วันสุดท้าย!'}
                </Text>
              </View>
            ) : party.requestStatus === 'pending' ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.amberSoft, borderColor: colors.amber }]}>
                <FeatureIcon name="clock.fill" size={11} color={colors.amber} />
                <Text style={[styles.statusBadgeText, { color: colors.amber }]}>รออนุมัติ</Text>
              </View>
            ) : party.requestStatus === 'rejected' ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
                <FeatureIcon name="xmark.circle.fill" size={11} color={colors.inkMuted} />
                <Text style={[styles.statusBadgeText, { color: colors.inkMuted }]}>ปฏิเสธ</Text>
              </View>
            ) : party.isMember ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.mintSoft, borderColor: colors.mint }]}>
                <FeatureIcon name="checkmark.circle.fill" size={11} color={colors.mint} />
                <Text style={[styles.statusBadgeText, { color: colors.mint }]}>เข้าร่วมแล้ว</Text>
              </View>
            ) : party.isPast ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
                <FeatureIcon name="clock.badge.xmark" size={11} color={colors.inkMuted} />
                <Text style={[styles.statusBadgeText, { color: colors.inkMuted }]}>หมดเวลานัด</Text>
              </View>
            ) : party.isFull ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.amberSoft, borderColor: colors.amber }]}>
                <FeatureIcon name="person.2.fill" size={11} color={colors.amber} />
                <Text style={[styles.statusBadgeText, { color: colors.amber }]}>ตี้เต็มแล้ว</Text>
              </View>
            ) : (
              <View style={[styles.statusBadge, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                <FeatureIcon name="person.badge.plus" size={11} color={colors.primary} />
                <Text style={[styles.statusBadgeText, { color: colors.primary }]}>
                  {`ว่าง ${remaining} ที่`}
                </Text>
              </View>
            )}
          </View>

          {/* Spot Location */}
          <View style={styles.cardSpotRow}>
            <FeatureIcon name="mappin.circle.fill" size={17} color={colors.primary} />
            <Text style={[styles.cardSpotName, { color: colors.ink }]} numberOfLines={1}>
              {party.spotName || 'จุดนัดหมาย ม.อ.'}
            </Text>
          </View>

          {/* Schedule Time Row */}
          <View style={[styles.timeRow, { backgroundColor: colors.surfaceRaised }]}>
            <FeatureIcon name="calendar" size={13} color={colors.primary} />
            <Text style={[styles.timeText, { color: colors.ink }]} numberOfLines={1}>
              {party.schedule?.date || ''} · {party.schedule?.startTime || ''}–{party.schedule?.endTime || ''} น.
            </Text>
          </View>

          {/* Host Message Quote (if present) */}
          {party.schedule?.message ? (
            <View style={[styles.quoteWrap, { backgroundColor: colors.surfaceRaised }]}>
              <FeatureIcon name="quote.bubble.fill" size={13} color={colors.inkMuted} />
              <Text style={[styles.quoteText, { color: colors.inkSoft }]} numberOfLines={2}>
                {party.schedule.message}
              </Text>
            </View>
          ) : null}

          {/* Capacity Progress / Slots Indicator */}
          <View style={styles.slotRow}>
            <View style={styles.slotMeta}>
              <FeatureIcon name="person.2.fill" size={13} color={colors.inkMuted} />
              <Text style={[styles.slotMetaText, { color: colors.inkMuted }]}>
                {`สมาชิก ${party.memberCount || 1}/${party.maxPeople || 2} คน`}
              </Text>
            </View>
            <View style={styles.slotPillsWrap}>
              {Array.from({ length: Math.min(8, party.maxPeople || 2) }).map((_, idx) => {
                const isFilled = idx < (party.memberCount || 1);
                return (
                  <View
                    key={idx}
                    style={[
                      styles.miniSlotDot,
                      {
                        backgroundColor: isFilled ? colors.primary : colors.surfaceRaised,
                        borderColor: isFilled ? colors.primary : colors.line,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          {/* Host: Pending Requests Notice */}
          {mine && party.pendingRequests?.length > 0 ? (
            <View style={[styles.hostPendingAlert, { backgroundColor: colors.coralSoft, borderColor: colors.coral }]}>
              <FeatureIcon name="person.badge.plus" size={13} color={colors.coral} />
              <Text style={[styles.hostPendingAlertText, { color: colors.coral }]}>
                {`มี ${party.pendingRequests.length} คำขอรออนุมัติ`}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* Action Buttons Row */}
      <View style={[styles.cardActionRow, { borderTopColor: colors.line }]}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : mine ? (
          <View style={styles.hostActionButtons}>
            {party.pendingRequests?.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelect?.(party)}
                style={[styles.quickBtn, { backgroundColor: colors.coral }]}
              >
                <FeatureIcon name="person.badge.plus" size={14} color="#FFFFFF" />
                <Text style={[styles.quickBtnText, { color: '#FFFFFF' }]}>
                  {`คำขอ (${party.pendingRequests.length})`}
                </Text>
              </Pressable>
            ) : null}
            {party.groupReady ? <Pressable
              accessibilityRole="button"
              onPress={() => onOpenChat?.(party)}
              style={[styles.quickBtn, { backgroundColor: colors.primarySoft }]}
            >
              <FeatureIcon name="bubble.left.and.bubble.right.fill" size={14} color={colors.primary} />
              <Text style={[styles.quickBtnText, { color: colors.primary }]}>เปิดแชตกลุ่ม</Text>
            </Pressable> : <Text style={[styles.disabledText, { color: colors.inkMuted }]}>แชตเปิดหลังอนุมัติสมาชิกคนแรก</Text>}
          </View>
        ) : party.isMember ? (
          party.groupReady ? <Pressable
            accessibilityRole="button"
            onPress={() => onOpenChat?.(party)}
            style={[styles.quickBtn, { backgroundColor: colors.primarySoft }]}
          >
            <FeatureIcon name="bubble.left.and.bubble.right.fill" size={14} color={colors.primary} />
            <Text style={[styles.quickBtnText, { color: colors.primary }]}>เปิดแชตกลุ่ม</Text>
          </Pressable> : <Text style={[styles.disabledText, { color: colors.inkMuted }]}>กำลังเตรียมแชตกลุ่ม</Text>
        ) : party.status === 'cancelled' ? (
          <Text style={[styles.disabledText, { color: colors.inkMuted }]}>ตี้ยกเลิกแล้ว</Text>
        ) : party.requestStatus === 'pending' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onWithdraw?.(party)}
            style={[styles.quickBtn, { backgroundColor: colors.surfaceRaised }]}
          >
            <FeatureIcon name="xmark.circle.fill" size={14} color={colors.inkMuted} />
            <Text style={[styles.quickBtnText, { color: colors.inkMuted }]}>ถอนคำขอ</Text>
          </Pressable>
        ) : party.isPast || party.isFull ? (
          <Text style={[styles.disabledText, { color: colors.inkMuted }]}>
            {party.isPast ? 'หมดเวลานัด' : 'ตี้เต็มแล้ว'}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => onJoin?.(party)}
            style={[styles.quickBtn, { backgroundColor: colors.primary }]}
          >
            <FeatureIcon name="person.badge.plus" size={14} color={colors.onPrimary} />
            <Text style={[styles.quickBtnText, { color: colors.onPrimary }]}>
              {`ขอร่วมตี้ · ว่าง ${remaining} ที่`}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ดูรายละเอียดเพิ่มเติม"
          onPress={() => onSelect?.(party)}
          style={[styles.detailIconBtn, { borderColor: colors.line }]}
        >
          <FeatureIcon name="info.circle" size={16} color={colors.inkMuted} />
        </Pressable>
      </View>
    </View>
  );
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

  return (
    <View style={styles.root}>
      {/* Banner Header */}
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <View style={styles.badgeLine}>
            <View style={[styles.bannerLiveDot, { backgroundColor: colors.green }]} />
            <Text style={[styles.bannerTag, { color: colors.primary }]}>ตี้กิจกรรมรอบ ม.อ.</Text>
          </View>
          <Text style={[styles.headingTitle, { color: colors.ink }]}>หาตี้ใน ม.อ.</Text>
          <Text style={[styles.headingSubtitle, { color: colors.inkMuted }]}>
            ชวนเพื่อนวิ่ง ติว กินข้าว ในรัศมี 3 กม.
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

      {/* Cards Feed / Error / Loading / Empty State */}
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
      ) : loading ? (
        <View style={[styles.stateCard, { borderColor: colors.line }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.inkMuted }]}>กำลังโหลดรายการตี้...</Text>
        </View>
      ) : !visible.length ? (
        <View style={[styles.stateCard, { borderColor: colors.line }]}>
          <FeatureIcon name="person.3.fill" size={32} color={colors.inkMuted} />
          <Text style={[styles.stateText, { color: colors.inkMuted }]}>
            {tab === 'open'
              ? 'ยังไม่มีตี้ที่เปิดรับ แตะ "เปิดตี้" เพื่อเริ่มคนแรก'
              : tab === 'requests'
              ? 'ยังไม่มีคำขอเข้าร่วมหรือคำขอที่รออนุมัติ'
              : 'ยังไม่มีตี้ที่คุณเข้าร่วมหรือสร้างขึ้น'}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContainer}
        >
          {insertActivityAdSlots(visible).map((party) => party.kind === 'native-ad' ?
            <NativeAdCard key={party.id} style={{ width: CARD_WIDTH }} /> : (
            <PartyCard
              key={party.id}
              party={party}
              colors={colors}
              busy={busyPartyId === party.id}
              onSelect={(p) => setSelectedPartyId(p.id)}
              onJoin={onJoinParty}
              onWithdraw={onWithdrawRequest}
              onOpenChat={onOpenChat}
            />
          ))}
        </ScrollView>
      )}

      {hasMore ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={onLoadMore} style={{ paddingVertical: 12, alignItems: 'center' }}>
        {loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '700' }}>โหลดตี้และคำขอเพิ่มเติม</Text>}
      </Pressable> : null}
      {/* Party Detail Modal */}
      <PartyDetailModal
        visible={Boolean(activeSelectedParty)}
        party={activeSelectedParty}
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
  root: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headingText: {
    flex: 1,
    paddingRight: 8,
  },
  badgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  bannerLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bannerTag: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headingTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  headingSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.lg,
    marginTop: 14,
    marginBottom: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    marginLeft: 4,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  carouselContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
    gap: 14,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 18,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardBody: {
    padding: 14,
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontWeight: '800',
  },
  avatarImage: {
    borderWidth: 1.5,
  },
  hostMeta: {
    flex: 1,
  },
  hostTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hostName: {
    fontSize: 13,
    fontWeight: '800',
    maxWidth: 120,
  },
  hostRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
  },
  hostRoleText: {
    fontSize: 10,
    fontWeight: '700',
  },
  hostSub: {
    fontSize: 11,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardSpotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  cardSpotName: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  quoteWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quoteText: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: 'italic',
    flex: 1,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  slotMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  slotMetaText: {
    fontSize: 11,
    fontWeight: '700',
  },
  slotPillsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniSlotDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  hostPendingAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  hostPendingAlertText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  hostActionButtons: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  quickBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateCard: {
    minHeight: 120,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    maxHeight: 380,
  },
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
    fontStyle: 'italic',
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
    paddingVertical: 13,
    borderRadius: radius.pill,
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
    paddingVertical: 13,
    borderRadius: radius.pill,
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalDisabledBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radius.pill,
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
