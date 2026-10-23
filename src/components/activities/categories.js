// Activity categories for the Activities tab, shared by iOS and Android.
// `color` tints icons only; selected chips use the theme primary so their
// white label keeps readable contrast.
export const SPOT_CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', icon: 'square.grid.2x2.fill', color: '#5B5CE2' },
  { id: 'sports', label: 'สนามกีฬา', icon: 'sportscourt.fill', color: '#FF9F43' },
  { id: 'chill', label: 'โซนนั่งเล่น', icon: 'leaf.fill', color: '#18A878' },
  { id: 'cafe', label: 'คาเฟ่', icon: 'cup.and.saucer.fill', color: '#F47C6B' },
  { id: 'study', label: 'โซนอ่านหนังสือ', icon: 'book.closed.fill', color: '#3986E8' },
  { id: 'running', label: 'วิ่งออกกำลัง', icon: 'figure.run', color: '#FF7A6B' },
  { id: 'gym', label: 'ยิม/ฟิตเนส', icon: 'dumbbell.fill', color: '#9A8CFF' },
];

const BY_ID = Object.fromEntries(SPOT_CATEGORIES.map((category) => [category.id, category]));
const PLACE = { icon: 'mappin.circle.fill', color: '#5B5CE2' };

/** Icon and tint for a spot's category; unknown categories get a map pin. */
export function categoryMeta(id) {
  return id && id !== 'all' && BY_ID[id] ? BY_ID[id] : PLACE;
}

/** Spots per category id, plus `all`. */
export function countByCategory(spots) {
  const counts = { all: spots.length };
  for (const spot of spots) {
    if (spot?.category) counts[spot.category] = (counts[spot.category] || 0) + 1;
  }
  return counts;
}
