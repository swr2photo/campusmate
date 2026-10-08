import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPick, pickDailyProfile } from './dailyPick.js';

const people = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
];

test('daily pick is stable across reorder of the same people', () => {
  const seed = '2026-9-19:me';
  const first = dailyPick(people, seed)[0].id;
  const reordered = dailyPick([...people].reverse(), seed)[0].id;
  assert.equal(reordered, first);
});

test('pinning keeps the current person when the list grows', () => {
  const seed = '2026-9-19:me';
  const first = dailyPick(people, seed)[0].id;
  const grown = pickDailyProfile([...people, { id: 'e' }, { id: 'f' }], seed, first)[0].id;
  assert.equal(grown, first);
});

test('pinned profile wins even if another person would be the daily pick', () => {
  const seed = '2026-9-19:me';
  const winner = dailyPick(people, seed)[0].id;
  const other = people.find((item) => item.id !== winner).id;
  assert.equal(pickDailyProfile(people, seed, other)[0].id, other);
  assert.equal(pickDailyProfile(people.filter((item) => item.id !== other), seed, other)[0].id, winner);
});
