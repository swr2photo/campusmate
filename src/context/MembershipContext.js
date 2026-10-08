import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuth } from './AuthContext';
import { getCachedPackages, isPurchaseCancelled, loadMembershipPackages, membershipConfigured, purchaseMembership, purchasesConfigured, releasePurchases, restoreMembership, subscribeMembership, syncMembership } from '../services/membershipService';
import { featuresForPlan, hasFeature, isPlusRecord, PLAN_FREE, PLAN_PLUS, PLUS_ENTITLEMENT_ID } from '../data/plans';
import { showAlert } from '../utils/appAlert';

const MembershipContext = createContext(null);
const CACHE_PREFIX = 'campusmate_membership_v1_';
// Quiet server confirmation after a purchase/restore: never blocks the UI.
const CONFIRM_RETRY_MS = [2000, 5000, 15000, 30000, 60000];

function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString('th-TH') : '';
}
function celebrate(kind, plus) {
  const until = formatDate(plus?.record?.activeUntil);
  const when = !until ? '' : plus?.willRenew ? `\nต่ออายุอัตโนมัติวันที่ ${until}` : `\nใช้สิทธิ์ได้ถึงวันที่ ${until}`;
  if (kind === 'restore') {
    showAlert('คืนค่าสำเร็จ', `คืนค่าสมาชิก CampusMate Plus เรียบร้อยแล้ว${when}`, [{ text: 'เริ่มใช้งาน' }], { tone: 'success', icon: 'sparkles' });
  } else {
    showAlert('สมัครสำเร็จ', `ยินดีต้อนรับสู่ CampusMate Plus! ตอนนี้คุณใช้สิทธิ์สมาชิกได้ครบทุกอย่างแล้ว${when}`, [{ text: 'เริ่มใช้งาน' }], { tone: 'success', icon: 'sparkles' });
  }
}

// Only the fields the entitlement check needs; never trust anything else from storage.
function sanitize(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    source: record.source === 'revenuecat' ? 'revenuecat' : null,
    entitlementId: record.entitlementId === PLUS_ENTITLEMENT_ID ? PLUS_ENTITLEMENT_ID : null,
    activeUntil: Number.isSafeInteger(record.activeUntil) ? record.activeUntil : 0,
    verifiedAt: Number.isSafeInteger(record.verifiedAt) ? record.verifiedAt : 0,
    managementUrl: typeof record.managementUrl === 'string' ? record.managementUrl : null,
    productId: typeof record.productId === 'string' ? record.productId : null,
    store: typeof record.store === 'string' ? record.store : null,
  };
}

/**
 * status: 'loading' until the entitlement is known, then 'free' | 'plus'.
 * A server-confirmed (or last server-confirmed, still unexpired) record is never
 * downgraded by a later cache-only snapshot (offline / reconnecting Firestore).
 */
export function MembershipProvider({ children }) {
  const { user } = useAuth();
  const uid = user?.id || user?.uid;
  const owner = useRef(uid); owner.current = uid;
  const configured = membershipConfigured();
  const [confirmed, setConfirmed] = useState(null); // { owner, record, server }
  const [cached, setCached] = useState(null); // { owner, record } from a cache-only snapshot
  // { owner, record } from the store right after a purchase/restore, until the server confirms it.
  const [storePlus, setStorePlus] = useState(null);
  const [settledFor, setSettledFor] = useState(null);
  const [packages, setPackages] = useState(() => getCachedPackages(uid));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [clock, setClock] = useState(Date.now());
  const confirmedRef = useRef(null); confirmedRef.current = confirmed;

  const confirm = useCallback((id, record, server) => {
    const clean = sanitize(record);
    setConfirmed({ owner: id, record: clean, server });
    setSettledFor(id);
    setClock(Date.now());
    if (server) {
      void AsyncStorage.setItem(CACHE_PREFIX + id, JSON.stringify(clean)).catch(() => {});
    }
  }, []);

  // Store packages load on their own: prefetched here, and retried by the paywall while it is open.
  // Failures are not shown to the user; the paywall keeps its loading state until prices arrive.
  const loadPackages = useCallback(async () => {
    const id = owner.current;
    if (!id || !purchasesConfigured()) return [];
    const next = await loadMembershipPackages(id);
    if (owner.current === id && next.length) setPackages(next);
    return next;
  }, []);

  useEffect(() => {
    setConfirmed(null); setCached(null); setStorePlus(null); setPackages(getCachedPackages(uid)); setError(''); setBusy(false);
    setSettledFor(null);
    if (!uid || !configured) return undefined;
    let live = true;
    // A subscriber should not see the paywall while the network answer is pending.
    void AsyncStorage.getItem(CACHE_PREFIX + uid).then((raw) => {
      if (!live || !raw || confirmedRef.current?.owner === uid) return;
      const record = sanitize(JSON.parse(raw));
      if (isPlusRecord(record, Date.now())) {
        setConfirmed({ owner: uid, record, server: false });
        setSettledFor(uid);
      }
    }).catch(() => {});
    const off = subscribeMembership(uid, (data, metadata) => {
      if (!live) return;
      setClock(Date.now());
      if (metadata?.fromCache === false) {
        setError('');
        confirm(uid, data, true);
        return;
      }
      // Cache-only snapshot (offline). Never downgrade a known entitlement with it.
      if (confirmedRef.current?.owner === uid) return;
      setCached({ owner: uid, record: sanitize(data) });
      setSettledFor(uid);
    }, () => {
      if (!live) return;
      setSettledFor(uid);
      setError('ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
    });
    if (purchasesConfigured()) {
      void loadPackages().catch(() => {});
      void syncMembership(uid).catch(() => { if (live && confirmedRef.current?.owner !== uid) setError('ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง'); });
    }
    const needsPackages = () => purchasesConfigured() && !getCachedPackages(uid).length;
    const active = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setClock(Date.now());
      if (purchasesConfigured()) void syncMembership(uid).catch(() => {});
      if (needsPackages()) void loadPackages().catch(() => {});
    });
    let online = null;
    const offNetwork = NetInfo.addEventListener((state) => {
      const next = state.isConnected !== false;
      if (next && online === false && needsPackages()) void loadPackages().catch(() => {});
      online = next;
    });
    return () => { live = false; off(); active.remove(); offNetwork(); void releasePurchases(uid).catch(() => {}); };
  }, [uid, configured, confirm, loadPackages]);

  const knownRecord = !uid ? null : confirmed && confirmed.owner === uid ? confirmed.record : cached && cached.owner === uid ? cached.record : null;
  const storeRecord = uid && storePlus?.owner === uid ? storePlus.record : null;
  // The store's answer right after a purchase bridges the gap until the server record catches up.
  const record = !isPlusRecord(knownRecord, clock) && isPlusRecord(storeRecord, clock) ? storeRecord : knownRecord;
  const plusActive = isPlusRecord(record, clock);
  const status = !uid || !configured ? PLAN_FREE : plusActive ? PLAN_PLUS : settledFor !== uid ? 'loading' : PLAN_FREE;
  const plan = status === 'loading' ? null : status;

  // Re-evaluate exactly at expiry; ask the server first so a renewal is picked up instead of a lockout.
  useEffect(() => {
    if (!plusActive) return undefined;
    const timeout = setTimeout(() => {
      setClock(Date.now());
      if (purchasesConfigured() && owner.current) void syncMembership(owner.current).catch(() => {});
    }, Math.min(Math.max(record.activeUntil - Date.now() + 10, 10), 86400000));
    return () => clearTimeout(timeout);
  }, [plusActive, clock, record?.activeUntil]);

  // Runs a store action with `busy` set; the spinner covers only the store itself, never the server sync.
  const perform = useCallback(async (action) => {
    if (busy || !uid) return undefined;
    setBusy(true); setError('');
    try {
      return await action(uid);
    } catch (reason) {
      if (owner.current === uid && !isPurchaseCancelled(reason)) setError(reason.message || 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง');
      throw reason;
    } finally { if (owner.current === uid) setBusy(false); }
  }, [uid, busy]);
  const acceptVerified = useCallback((id, verified) => {
    if (owner.current !== id || !verified) return false;
    const next = { ...verified, source: 'revenuecat', entitlementId: PLUS_ENTITLEMENT_ID };
    confirm(id, next, true);
    return isPlusRecord(sanitize(next), Date.now());
  }, [confirm]);
  // Ask the server to confirm a store-reported Plus, quietly retrying while it catches up.
  const confirmInBackground = useCallback((id) => {
    let attempt = 0;
    const run = () => {
      if (owner.current !== id || !purchasesConfigured()) return;
      syncMembership(id).then((verified) => {
        if (owner.current !== id) return;
        const next = verified && { ...verified, source: 'revenuecat', entitlementId: PLUS_ENTITLEMENT_ID };
        if (next && isPlusRecord(sanitize(next), Date.now())) { confirm(id, next, true); setStorePlus(null); return; }
        retry();
      }, retry);
    };
    const retry = () => {
      if (owner.current !== id || attempt >= CONFIRM_RETRY_MS.length) return;
      setTimeout(run, CONFIRM_RETRY_MS[attempt]);
      attempt += 1;
    };
    run();
  }, [confirm]);
  const showStorePlus = useCallback((id, plus, kind) => {
    if (owner.current !== id || !plus?.record) return;
    setStorePlus({ owner: id, record: plus.record });
    setClock(Date.now());
    celebrate(kind, plus);
  }, []);

  const purchase = useCallback(async (entry) => {
    const id = uid;
    const outcome = await perform((current) => purchaseMembership(current, entry));
    if (!outcome || outcome.cancelled || owner.current !== id) return null;
    if (outcome.plus) showStorePlus(id, outcome.plus, 'purchase');
    else showAlert('กำลังยืนยันการสมัคร', 'ชำระเงินแล้ว ระบบกำลังยืนยันสิทธิ์สมาชิก อาจใช้เวลาสักครู่', { tone: 'info' });
    confirmInBackground(id);
    return outcome.plus?.record || null;
  }, [uid, perform, showStorePlus, confirmInBackground]);

  const restore = useCallback(async () => {
    const id = uid;
    const outcome = await perform(async (current) => {
      const result = await restoreMembership(current);
      if (result.plus) return result;
      // The store found nothing active; give the server one bounded chance before saying so.
      const verified = await Promise.race([
        syncMembership(current).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
      ]);
      return { plus: null, verified };
    });
    if (!outcome || owner.current !== id) return null;
    if (outcome.plus) {
      showStorePlus(id, outcome.plus, 'restore');
      confirmInBackground(id);
      return outcome.plus.record;
    }
    if (acceptVerified(id, outcome.verified)) {
      celebrate('restore', { record: sanitize(outcome.verified), willRenew: true });
      return outcome.verified;
    }
    showAlert('ไม่พบสมาชิก Plus', 'ไม่พบการสมัคร CampusMate Plus ในบัญชีสโตร์นี้', { tone: 'info' });
    return null;
  }, [uid, perform, showStorePlus, confirmInBackground, acceptVerified]);

  const refresh = useCallback(() => perform(async (id) => {
    const next = await loadMembershipPackages(id);
    if (owner.current === id && next.length) setPackages(next);
    const verified = purchasesConfigured() ? await syncMembership(id) : null;
    acceptVerified(id, verified);
    return verified;
  }), [perform, acceptVerified]);

  const value = useMemo(() => {
    const features = featuresForPlan(plan);
    return {
      status, plan, features,
      loading: status === 'loading',
      can: (feature) => hasFeature(plan, feature),
      plus: status === PLAN_PLUS, ready: status !== 'loading', configured, busy, error, packages, loadPackages,
      serverConfirmed: Boolean(uid) && confirmed?.owner === uid && confirmed?.server === true,
      activeUntil: record?.activeUntil || 0,
      managementUrl: record?.managementUrl || null,
      purchase, restore, refresh,
    };
  }, [status, plan, configured, busy, error, packages, loadPackages, confirmed, record, uid, purchase, restore, refresh]);
  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}
export function useMembership() {
  const value = useContext(MembershipContext);
  if (!value) throw new Error('MembershipProvider is required');
  return value;
}

/**
 * Feature gate for one paid feature.
 *   allowed: the current plan includes it.
 *   loading: entitlement not known yet (never treated as allowed, never sent to the paywall).
 *   locked:  known to be missing -> show the CampusMate Plus prompt.
 *   guard(): returns true when allowed; otherwise opens the paywall (or says we are still checking).
 */
export function useEntitlement(feature) {
  const membership = useMembership();
  const allowed = membership.can(feature);
  const loading = membership.status === 'loading';
  const guard = useCallback(() => {
    if (allowed) return true;
    if (loading) {
      showAlert('CampusMate Plus', 'กำลังตรวจสอบสถานะสมาชิก กรุณาลองอีกครั้งในอีกสักครู่', { tone: 'info' });
      return false;
    }
    router.push('/membership');
    return false;
  }, [allowed, loading]);
  return { allowed, loading, locked: !allowed && !loading, guard };
}
