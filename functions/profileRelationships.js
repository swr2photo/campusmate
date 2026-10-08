export function establishedMatch(viewer, owner, outgoing, incoming, participants) {
  const correct = (record, from, to) => record?.fromUserId === from && record?.toUserId === to;
  const decisions = [[outgoing, viewer, owner], [incoming, owner, viewer]].filter(([record, from, to]) => correct(record, from, to));
  if (decisions.some(([record]) => ['removed', 'rejected'].includes(record.status))) return false;
  return decisions.some(([record]) => record.type === 'like' && record.status === 'accepted')
    || (Array.isArray(participants) && participants.length === 2 && participants.includes(viewer) && participants.includes(owner));
}
