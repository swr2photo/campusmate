import { createHash } from 'node:crypto';

const UID = /^[A-Za-z0-9_-]{1,128}$/;
export function legacyActionPlan(uid, decisions) {
  return decisions.flatMap((snapshot) => {
    const decision = snapshot.data();
    if (decision.fromUserId !== uid || !UID.test(decision.toUserId || '') || decision.toUserId === uid
      || snapshot.id !== `${uid}_${decision.toUserId}` || decision.lastActionId
      || !['skip', 'like'].includes(decision.type) || decision.status !== 'pending') return [];
    const at = decision.updatedAt?.toMillis?.() || decision.createdAt?.toMillis?.();
    // Missing ordering evidence is reported separately; never invent the order.
    if (!Number.isSafeInteger(at) || at <= 0) return [];
    const id = `legacy-${createHash('sha256').update(`${snapshot.id}:${at}:${decision.type}`).digest('hex').slice(0, 48)}`;
    return [{ snapshot, decision, id, at }];
  }).sort((a, b) => a.at - b.at || a.snapshot.id.localeCompare(b.snapshot.id));
}

// Run during cutover with legacy decision writes closed and the new action
// endpoints still disabled. Only the last surviving legacy decision is known;
// earlier checkout-era action history cannot be reconstructed from these docs.
export async function migrateLegacyUser(db, uid, { apply = false, serverTimestamp } = {}) {
  if (!UID.test(uid)) throw new Error('Invalid user id');
  const snapshot = await db.collection('decisions').where('fromUserId', '==', uid).get();
  const planned = legacyActionPlan(uid, snapshot.docs);
  const withoutOrdering = snapshot.docs.filter((entry) => {
    const value = entry.data();
    return value.status === 'pending' && !value.lastActionId && !value.updatedAt?.toMillis?.() && !value.createdAt?.toMillis?.();
  }).length;
  if (!apply) return { planned: planned.length, withoutOrdering, written: 0 };
  let written = 0;
  for (let index = 0; index < planned.length; index += 200) {
    const group = planned.slice(index, index + 200);
    written += await db.runTransaction(async (tx) => {
      const stateRef = db.doc(`discoveryState/${uid}`);
      const [state, ...current] = await tx.getAll(stateRef, ...group.map((entry) => entry.snapshot.ref));
      if (state.data()?.secureActionsStarted === true) throw new Error('New actions already started; do not append older legacy history.');
      const refs = group.map((entry) => db.doc(`discoveryActions/${uid}/entries/${entry.id}`));
      const history = await tx.getAll(...refs);
      let sequence = state.data()?.nextSequence || 0, count = 0;
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid action sequence');
      for (let position = 0; position < group.length; position++) {
        const entry = group[position], record = current[position];
        const next = legacyActionPlan(uid, record.exists ? [record] : [])[0];
        if (!next || next.id !== entry.id || history[position].exists) continue;
        sequence += 1;
        if (!Number.isSafeInteger(sequence)) throw new Error('Action sequence overflow');
        const result = { status: 'pending', conversationId: null, sequence };
        tx.create(refs[position], { target: next.decision.toUserId, kind: next.decision.type, sequence,
          previous: null, undoable: true, createdAt: next.decision.updatedAt || next.decision.createdAt,
          migrated: true, result });
        tx.update(record.ref, { lastActionId: entry.id });
        count += 1;
      }
      if (count) tx.set(stateRef, { nextSequence: sequence, legacyMigrationVersion: 1, updatedAt: serverTimestamp() }, { merge: true });
      return count;
    });
  }
  return { planned: planned.length, withoutOrdering, written };
}
