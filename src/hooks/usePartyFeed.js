import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { startMillis, nextPartyRefreshDelay } from '../utils/partyClock';
import {
  activateLegacyPartyChat, resolveCampusPlace, subscribeHostedPartyRequests, subscribeMyPartyRequests,
  subscribeParties, subscribeGroupChats, subscribeLegacyPartiesToActivate,
  subscribeOwnParties, subscribePartyById, subscribeMyPartyRequest, subscribeGroupChat,
} from '../services/partyService';
import { preparePartyActivation } from '../services/groupChatEncryption';
import { getPublicProfilesByIds } from '../services/firestoreService';

const resolvedPlaces = new Map();
const attemptedLegacyActivations = new Set();

export default function usePartyFeed(userOrId, campusSpots = [], userProfile = null, targetPartyId = null) {
  const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
  const myProfile = (typeof userOrId === 'object' && userOrId !== null ? userOrId : userProfile) || null;
  const [targetParty, setTargetParty] = useState(null);
  useEffect(() => {
    setTargetParty(null);
    if (!userId || !targetPartyId) return undefined;
    return subscribePartyById(targetPartyId, setTargetParty, () => setTargetParty(null));
  }, [userId, targetPartyId]);
  const [rawParties, setRawParties] = useState([]);
  const [ownParties, setOwnParties] = useState([]);
  const [requestedParties, setRequestedParties] = useState({});
  const [requestByParty, setRequestByParty] = useState({});
  const [pages, setPages] = useState({});
  const [clock, setClock] = useState(Date.now());
  const [retryFeed, setRetryFeed] = useState(0);
  const pageSubscriptions = useRef({});
  const hostSubscriptions = useRef({});
  const [legacyParties, setLegacyParties] = useState([]);
  const [requests, setRequests] = useState([]);
  const [hostRequests, setHostRequests] = useState({});
  const [groupChats, setGroupChats] = useState([]);
  const [placeResults, setPlaceResults] = useState({});
  const [peerProfiles, setPeerProfiles] = useState({});
  const [activationErrors, setActivationErrors] = useState({});
  const [activationRetry, setActivationRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setOwnParties([]); setRequestedParties({}); setRequestByParty({}); setPages({});
    setPlaceResults({}); setPeerProfiles({}); setActivationErrors({}); setError(null);
    if (!userId) {
      setRawParties([]);
      setLegacyParties([]);
      setRequests([]);
      setGroupChats([]);
      setHostRequests({});
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setRawParties([]);
    setLegacyParties([]);
    setRequests([]);
    setGroupChats([]);
    setHostRequests({});
    const offParties = subscribeParties((items, page) => {
      setRawParties(items);
      setPages((old) => ({ ...old, feed: page }));
      setLoading(false);
      setError(null);
    }, (reason) => {
      setError(reason);
      setLoading(false);
    });
    const offOwn = subscribeOwnParties(userId, (items, page) => {
      setOwnParties(items); setPages((old) => ({ ...old, own: page }));
    }, setError);
    const offRequests = subscribeMyPartyRequests(userId, (items, page) => {
      setRequests(items); setPages((old) => ({ ...old, requests: page }));
    }, setError);
    const offLegacy = subscribeLegacyPartiesToActivate(userId, setLegacyParties, setError);
    pageSubscriptions.current = { feed: offParties, own: offOwn, requests: offRequests };
    return () => { offParties(); offOwn(); offRequests(); offLegacy(); pageSubscriptions.current = {}; };
  }, [userId, retryFeed]);

  useEffect(() => {
    const off = requests.map((item) => subscribePartyById(item.partyId,
      (party) => setRequestedParties((old) => ({ ...old, [item.partyId]: party })), setError));
    const ids = new Set(requests.map((item) => item.partyId));
    setRequestedParties((old) => Object.fromEntries(Object.entries(old).filter(([id]) => ids.has(id))));
    return () => off.forEach((stop) => stop());
  }, [requests.map((item) => item.partyId).sort().join('|'), userId]);

  const allParties = useMemo(() => {
    const byId = new Map([...(targetParty ? [targetParty] : []), ...rawParties, ...ownParties, ...Object.values(requestedParties).filter(Boolean), ...legacyParties].map((party) => [party.id, party]));
    return [...byId.values()];
  }, [rawParties, ownParties, requestedParties, legacyParties, targetParty]);
  const partyIds = allParties.map((party) => party.id).sort().join('|');
  useEffect(() => {
    if (!userId) return undefined;
    const off = allParties.map((party) => subscribeMyPartyRequest(party.id, userId,
      (item) => setRequestByParty((old) => ({ ...old, [party.id]: item })), setError));
    return () => off.forEach((stop) => stop());
  }, [partyIds, userId]);
  useEffect(() => {
    if (!userId) return undefined;
    setGroupChats([]);
    const off = allParties.filter((party) => party.memberCount > 1 && party.memberIds?.includes(userId)).map((party) =>
      subscribeGroupChat(party.id, (chat) => setGroupChats((old) => [...old.filter((item) => item.id !== party.id), ...(chat ? [chat] : [])]), setError));
    return () => off.forEach((stop) => stop());
  }, [partyIds, userId, allParties.map((party) => `${party.memberCount}:${party.memberIds?.join(',')}`).join('|')]);

  useEffect(() => {
    const timer = setTimeout(() => setClock(Date.now()), nextPartyRefreshDelay(allParties, Date.now()));
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') setClock(Date.now()); });
    return () => { clearTimeout(timer); listener.remove(); };
  }, [allParties, clock]);
  const hostedIds = useMemo(() => allParties.filter((party) => party.hostId === userId && party.status === 'open').map((party) => party.id), [allParties, userId]);
  useEffect(() => {
    setHostRequests({});
    hostSubscriptions.current = Object.fromEntries(hostedIds.map((id) => [id, subscribeHostedPartyRequests(id, userId,
      (items, page) => {
        setHostRequests((prior) => ({ ...prior, [id]: items }));
        setPages((old) => ({ ...old, [`host:${id}`]: page }));
      }, setError)]));
    return () => { Object.values(hostSubscriptions.current).forEach((stop) => stop()); hostSubscriptions.current = {}; };
  }, [hostedIds.join('|'), userId, retryFeed]);

  useEffect(() => {
    let active = true;
    const ids = [...new Set(allParties.filter((party) => party.location?.kind === 'google').map((party) => party.location.placeId))];
    ids.forEach(async (id) => {
      if (resolvedPlaces.has(id)) {
        setPlaceResults((old) => ({ ...old, [id]: resolvedPlaces.get(id) }));
        return;
      }
      try {
        const place = await resolveCampusPlace(id);
        if (!active) return;
        resolvedPlaces.set(id, place);
        setPlaceResults((old) => ({ ...old, [id]: place }));
      } catch {
        if (active) setPlaceResults((old) => ({ ...old, [id]: { name: 'สถานที่จาก Google Maps', unavailable: true } }));
      }
    });
    return () => { active = false; };
  }, [allParties]);

  const missingUserIds = useMemo(() => {
    const ids = new Set();
    allParties.forEach((party) => {
      if (party.hostId && party.hostId !== userId && !party.host?.avatarUri) {
        ids.add(party.hostId);
      }
    });
    Object.values(hostRequests).forEach((reqList) => {
      (reqList || []).forEach((req) => {
        if (req.requesterId && !req.avatarUri && !req.requesterAvatarUri) {
          ids.add(req.requesterId);
        }
      });
    });
    return [...ids].filter((id) => !peerProfiles[id]);
  }, [allParties, hostRequests, peerProfiles, userId]);

  useEffect(() => {
    if (!missingUserIds.length) return;
    let active = true;
    getPublicProfilesByIds(missingUserIds)
      .then((profiles) => {
        if (!active || !profiles?.length) return;
        setPeerProfiles((prev) => {
          const next = { ...prev };
          profiles.forEach((p) => {
            if (p?.id) next[p.id] = p;
          });
          return next;
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [missingUserIds.join('|')]);

  const parties = useMemo(() => allParties.map((party) => {
    const campus = campusSpots.find((spot) => spot.id === party.location?.spotId);
    const google = placeResults[party.location?.placeId];
    const location = party.location?.kind === 'google' ? google : party.location?.kind === 'campus' ? campus || party.location : party.location;
    const request = requestByParty[party.id] || requests.find((item) => item.partyId === party.id);
    const memberCount = Number(party.memberCount || party.memberIds?.length || 1);
    const isUserHost = party.hostId === userId;
    const peerHost = peerProfiles[party.hostId];

    const hostAvatarUri = (isUserHost ? (myProfile?.avatarUri || (Array.isArray(myProfile?.photos) ? myProfile.photos[0] : null)) : null)
      || party.host?.avatarUri
      || party.host?.photoURL
      || peerHost?.avatarUri
      || peerHost?.photoURL
      || (Array.isArray(peerHost?.photos) ? peerHost.photos[0] : null)
      || null;

    const hostName = isUserHost
      ? (myProfile?.nickname || myProfile?.name || party.host?.name || 'ตี้ของคุณ')
      : (party.host?.name || peerHost?.nickname || peerHost?.name || 'เพื่อนใน ม.อ.');

    const hostFaculty = (isUserHost ? myProfile?.faculty : null)
      || party.host?.faculty
      || peerHost?.faculty
      || '';

    const hostYear = (isUserHost ? myProfile?.year : null)
      || party.host?.year
      || peerHost?.year
      || '';

    const host = {
      ...party.host,
      name: hostName,
      avatarUri: hostAvatarUri,
      faculty: hostFaculty,
      year: hostYear,
    };

    const pendingRequests = (hostRequests[party.id] || []).map((req) => ({
      ...req,
      avatarUri: req.avatarUri
        || req.requesterAvatarUri
        || peerProfiles[req.requesterId]?.avatarUri
        || (Array.isArray(peerProfiles[req.requesterId]?.photos) ? peerProfiles[req.requesterId].photos[0] : null)
        || null,
      requesterName: req.requesterName || peerProfiles[req.requesterId]?.nickname || peerProfiles[req.requesterId]?.name || 'ผู้ใช้ ม.อ.',
    }));

    return {
      ...party,
      host,
      spot: location,
      spotName: location?.name || 'กำลังโหลดสถานที่',
      acceptedCount: memberCount,
      isUserHost,
      isMember: party.memberIds?.includes(userId),
      requestStatus: request?.status || null,
      pendingRequests,
      hasMoreRequests: pages[`host:${party.id}`]?.hasMore,
      loadingMoreRequests: pages[`host:${party.id}`]?.loadingMore,
      groupReady: groupChats.some((chat) => chat.id === party.id),
      activationError: activationErrors[party.id],
      isFull: memberCount >= party.maxPeople,
      isPast: startMillis(party) <= clock,
    };
  }).sort((a, b) => startMillis(a) - startMillis(b)), [allParties, requests, requestByParty, pages, clock, placeResults, campusSpots, userId, myProfile, peerProfiles, hostRequests, groupChats, activationErrors]);

  useEffect(() => {
    parties.filter((party) => party.isUserHost && party.legacy && party.chatActivationRequired && !party.groupReady)
      .forEach(async (party) => {
        if (attemptedLegacyActivations.has(party.id)) return;
        attemptedLegacyActivations.add(party.id);
        try {
          const grants = await preparePartyActivation(party);
          await activateLegacyPartyChat(party.id, grants);
        } catch (reason) {
          setActivationErrors((old) => ({ ...old, [party.id]: reason?.message || 'เปิดแชตกลุ่มไม่สำเร็จ' }));
        }
      });
  }, [parties, activationRetry]);

  const retryLegacyActivation = (partyId) => {
    attemptedLegacyActivations.delete(partyId);
    setActivationErrors((old) => ({ ...old, [partyId]: null }));
    setActivationRetry((old) => old + 1);
  };

  const loadMore = () => Object.entries(pageSubscriptions.current).forEach(([key, stop]) => {
    if (pages[key]?.hasMore) { setPages((old) => ({ ...old, [key]: { ...old[key], loadingMore: true } })); stop.loadMore(); }
  });
  const loadMoreRequests = (partyId) => hostSubscriptions.current[partyId]?.loadMore();
  return { parties, loading, error, requests, hostRequests, retryLegacyActivation, loadMore, loadMoreRequests,
    retry: () => setRetryFeed((old) => old + 1),
    hasMore: ['feed', 'own', 'requests'].some((key) => pages[key]?.hasMore),
    loadingMore: Object.values(pages).some((page) => page?.loadingMore) };
}
