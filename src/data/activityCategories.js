// Activities a student can pick on their profile. `primary` ones are always
// visible; the rest live behind a "more" toggle so the grid stays scannable.
// `symbol` is the SF Symbol name (FeatureIcon maps it to Ionicons on Android).
export const ACTIVITY_CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', shortLabel: 'ทั้งหมด', icon: '✦', symbol: 'sparkles', color: '#5B5CE2', primary: true },
  { id: 'running', label: 'วิ่งออกกำลังกาย', shortLabel: 'วิ่ง', icon: '🏃', symbol: 'figure.run', color: '#F47C6B', primary: true },
  { id: 'gym', label: 'เข้ายิม / ฟิตเนส', shortLabel: 'ยิม', icon: '🏋️', symbol: 'dumbbell.fill', color: '#9A8CFF', primary: true },
  { id: 'sports', label: 'เล่นกีฬา', shortLabel: 'กีฬา', icon: '🏀', symbol: 'sportscourt.fill', color: '#FF9F43', primary: true },
  { id: 'study', label: 'ทบทวนบทเรียน', shortLabel: 'ติว', icon: '📚', symbol: 'book.closed.fill', color: '#3986E8', primary: true },
  { id: 'chill', label: 'คุยเล่น / คาเฟ่', shortLabel: 'คาเฟ่', icon: '☕', symbol: 'cup.and.saucer.fill', color: '#18A878', primary: true },
  { id: 'cycling', label: 'ปั่นจักรยาน', shortLabel: 'ปั่น', icon: '🚴', symbol: 'bicycle', color: '#12B5A5' },
  { id: 'swimming', label: 'ว่ายน้ำ', shortLabel: 'ว่ายน้ำ', icon: '🏊', symbol: 'figure.pool.swim', color: '#2F9BE0' },
  { id: 'yoga', label: 'โยคะ / สมาธิ', shortLabel: 'โยคะ', icon: '🧘', symbol: 'figure.mind.and.body', color: '#B57BEE' },
  { id: 'music', label: 'ดนตรี / ร้องเพลง', shortLabel: 'ดนตรี', icon: '🎸', symbol: 'music.note', color: '#E85D9A' },
  { id: 'gaming', label: 'เกม / บอร์ดเกม', shortLabel: 'เกม', icon: '🎮', symbol: 'gamecontroller.fill', color: '#6C63FF' },
  { id: 'art', label: 'ศิลปะ / ถ่ายรูป', shortLabel: 'ศิลปะ', icon: '🎨', symbol: 'paintpalette.fill', color: '#F5A623' },
  { id: 'language', label: 'ฝึกภาษา', shortLabel: 'ภาษา', icon: '🗣️', symbol: 'globe', color: '#2AA6C8' },
  { id: 'food', label: 'กินข้าว / ตะลุยร้าน', shortLabel: 'กิน', icon: '🍜', symbol: 'fork.knife', color: '#E8734A' },
  { id: 'volunteer', label: 'จิตอาสา / ชมรม', shortLabel: 'ชมรม', icon: '🤝', symbol: 'person.3.fill', color: '#3DAA6A' },
  { id: 'other', label: 'กิจกรรมอื่น ๆ', shortLabel: 'อื่น ๆ', icon: '✨', symbol: 'sparkles', color: '#60708A', primary: true },
];

export const SELECTABLE_ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES.filter((category) => category.id !== 'all');
export const PRIMARY_ACTIVITY_CATEGORIES = SELECTABLE_ACTIVITY_CATEGORIES.filter((category) => category.primary);
export const MORE_ACTIVITY_CATEGORIES = SELECTABLE_ACTIVITY_CATEGORIES.filter((category) => !category.primary);

export const ACTIVITY_CATEGORY_BY_ID = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((category) => [category.id, category])
);

export function getActivityCategory(id) {
  return ACTIVITY_CATEGORY_BY_ID[id] || null;
}

export const RUNNING_PACE_OPTIONS = [
  'เดิน / เริ่มต้น',
  'Pace 8:00+ นาที/กม.',
  'Pace 7:00 - 8:00 นาที/กม.',
  'Pace 6:00 - 7:00 นาที/กม.',
  'Pace 5:00 - 6:00 นาที/กม.',
  'Pace ต่ำกว่า 5:00 นาที/กม.',
];

const LEVEL_OPTIONS = ['เพิ่งเริ่ม', 'พอเล่นได้', 'จริงจัง / แข่งขัน'];

// Extra questions shown under each activity the user has selected.
// Field types: `select` (single value), `multi` (string list), `text`.
export const ACTIVITY_DETAIL_FIELDS = {
  running: [
    { key: 'pace', label: 'เพซวิ่ง', type: 'select', options: RUNNING_PACE_OPTIONS, required: true, symbol: 'speedometer' },
    { key: 'distance', label: 'ระยะที่วิ่งประจำ', type: 'select', options: ['3 กม.', '5 กม.', '10 กม.', 'ฮาล์ฟมาราธอน', 'มาราธอน'], symbol: 'point.topleft.down.curvedto.point.bottomright.up' },
    { key: 'timeOfDay', label: 'ช่วงที่ชอบวิ่ง', type: 'multi', options: ['เช้าตรู่', 'เย็น', 'กลางคืน', 'วันหยุด'] },
  ],
  gym: [
    { key: 'focus', label: 'สายที่เล่น', type: 'multi', options: ['เวทเทรนนิ่ง', 'คาร์ดิโอ', 'HIIT', 'บอดี้เวท', 'ยืดเหยียด'] },
    { key: 'level', label: 'ระดับ', type: 'select', options: LEVEL_OPTIONS, symbol: 'chart.bar.fill' },
    { key: 'goal', label: 'เป้าหมาย', type: 'select', options: ['ลดน้ำหนัก', 'เพิ่มกล้าม', 'สุขภาพทั่วไป', 'เตรียมแข่ง'], symbol: 'target' },
  ],
  sports: [
    { key: 'sports', label: 'กีฬาที่เล่น', type: 'multi', options: ['ฟุตบอล / ฟุตซอล', 'บาสเกตบอล', 'แบดมินตัน', 'วอลเลย์บอล', 'เทนนิส', 'ปิงปอง', 'สเกต / เซิร์ฟสเกต', 'อื่น ๆ'] },
    { key: 'level', label: 'ระดับ', type: 'select', options: LEVEL_OPTIONS, symbol: 'chart.bar.fill' },
  ],
  study: [
    { key: 'subjects', label: 'วิชาที่อยากติว', type: 'multi', options: ['คณิต / สถิติ', 'วิทย์ / วิศวะ', 'ภาษา', 'โปรแกรมมิ่ง', 'ธุรกิจ / บัญชี', 'กฎหมาย / สังคม', 'แพทย์ / สุขภาพ', 'อื่น ๆ'] },
    { key: 'style', label: 'สไตล์การติว', type: 'select', options: ['ติวกันเป็นกลุ่ม', 'อ่านเงียบ ๆ ด้วยกัน', 'ผลัดกันสอน', 'เตรียมสอบกลาง / ปลายภาค'], symbol: 'person.2.fill' },
  ],
  chill: [
    { key: 'vibe', label: 'ชอบไป', type: 'multi', options: ['คาเฟ่', 'ดูหนัง / ซีรีส์', 'เดินเล่นในมหาลัย', 'ช้อปปิ้ง', 'ตลาดนัด', 'คอนเสิร์ต / อีเวนต์'] },
    { key: 'topics', label: 'เรื่องที่คุยได้ยาว', type: 'text', placeholder: 'เช่น ซีรีส์เกาหลี การ์ตูน ข่าวเทค' },
  ],
  cycling: [
    { key: 'bikeType', label: 'จักรยานที่ใช้', type: 'select', options: ['จักรยานทั่วไป', 'เสือหมอบ', 'เสือภูเขา', 'ฟิกซ์เกียร์ / มินิ', 'ยังไม่มี อยากลอง'], symbol: 'bicycle' },
    { key: 'distance', label: 'ระยะที่ปั่น', type: 'select', options: ['รอบมหาลัย', '10 - 20 กม.', '20 - 50 กม.', '50 กม.+'], symbol: 'point.topleft.down.curvedto.point.bottomright.up' },
  ],
  swimming: [
    { key: 'level', label: 'ระดับ', type: 'select', options: ['เพิ่งหัด', 'ว่ายได้สบาย', 'ซ้อมจริงจัง'], symbol: 'chart.bar.fill' },
    { key: 'strokes', label: 'ท่าที่ถนัด', type: 'multi', options: ['ฟรีสไตล์', 'กรรเชียง', 'กบ', 'ผีเสื้อ'] },
  ],
  yoga: [
    { key: 'kind', label: 'แบบที่ชอบ', type: 'multi', options: ['โยคะ', 'พิลาทิส', 'นั่งสมาธิ', 'ยืดเหยียด'] },
    { key: 'level', label: 'ระดับ', type: 'select', options: LEVEL_OPTIONS, symbol: 'chart.bar.fill' },
  ],
  music: [
    { key: 'role', label: 'เล่น / ร้อง', type: 'multi', options: ['ร้องเพลง', 'กีตาร์', 'เปียโน / คีย์บอร์ด', 'กลอง', 'เบส', 'ดีเจ / โปรดิวซ์', 'แค่ฟัง'] },
    { key: 'genres', label: 'แนวเพลง', type: 'multi', options: ['ป๊อป', 'ร็อก', 'ฮิปฮอป', 'อินดี้', 'แจ๊ส', 'T-Pop / K-Pop', 'ลูกทุ่ง'] },
  ],
  gaming: [
    { key: 'platform', label: 'เล่นบน', type: 'multi', options: ['มือถือ', 'PC', 'คอนโซล', 'บอร์ดเกม / การ์ดเกม'] },
    { key: 'games', label: 'เกมที่เล่นอยู่', type: 'text', placeholder: 'เช่น Valorant, ROV, Catan' },
  ],
  art: [
    { key: 'kind', label: 'สายที่ทำ', type: 'multi', options: ['วาดรูป', 'ถ่ายรูป', 'งานคราฟต์', 'กราฟิก / ดีไซน์', 'ทำวิดีโอ', 'เขียน'] },
    { key: 'level', label: 'ระดับ', type: 'select', options: ['เพิ่งเริ่ม', 'ทำเป็นงานอดิเรก', 'รับงาน / จริงจัง'], symbol: 'chart.bar.fill' },
  ],
  language: [
    { key: 'languages', label: 'ภาษาที่ฝึก', type: 'multi', options: ['อังกฤษ', 'ญี่ปุ่น', 'เกาหลี', 'จีน', 'ฝรั่งเศส / เยอรมัน', 'อื่น ๆ'] },
    { key: 'goal', label: 'เป้าหมาย', type: 'select', options: ['สนทนาทั่วไป', 'เตรียมสอบ TOEIC / IELTS', 'แลกเปลี่ยนภาษา', 'เตรียมไปแลกเปลี่ยน / เรียนต่อ'], symbol: 'target' },
  ],
  food: [
    { key: 'kind', label: 'สายกิน', type: 'multi', options: ['สตรีทฟู้ด', 'บุฟเฟต์ / ชาบู', 'คาเฟ่ / ของหวาน', 'อาหารญี่ปุ่น / เกาหลี', 'อาหารคลีน', 'ทำอาหารเอง'] },
    { key: 'budget', label: 'งบต่อมื้อ', type: 'select', options: ['ไม่เกิน 100', '100 - 300', '300 - 500', 'ไม่จำกัด'], symbol: 'banknote.fill' },
  ],
  volunteer: [
    { key: 'kind', label: 'สนใจ', type: 'multi', options: ['จิตอาสา', 'ชมรมมหาลัย', 'กิจกรรมคณะ', 'งานอีเวนต์ / สตาฟ', 'ค่าย'] },
  ],
  other: [
    { key: 'note', label: 'เล่าเพิ่มเติม', type: 'text', placeholder: 'ชอบทำอะไร อยากหาเพื่อนทำอะไรด้วยกัน' },
  ],
};

export const ACTIVITY_DETAIL_TEXT_MAX = 120;
export const ACTIVITY_DETAIL_MULTI_MAX = 10;

export function getActivityDetailFields(activityId) {
  return ACTIVITY_DETAIL_FIELDS[activityId] || [];
}

function cleanText(value, maxLength = ACTIVITY_DETAIL_TEXT_MAX) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// Keep only known activities/fields and coerce values to the declared type.
// Values are stored as plain strings / string arrays so Firestore rules and
// the public profile stay simple.
export function sanitizeActivityDetails(details, activities) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const allowed = Array.isArray(activities) ? new Set(activities) : null;
  const result = {};
  Object.entries(details).forEach(([activityId, raw]) => {
    if (allowed && !allowed.has(activityId)) return;
    const fields = getActivityDetailFields(activityId);
    if (!fields.length || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const clean = {};
    fields.forEach((field) => {
      const value = raw[field.key];
      if (field.type === 'multi') {
        if (!Array.isArray(value)) return;
        const list = value
          .map((item) => cleanText(item))
          .filter((item) => item && field.options.includes(item))
          .slice(0, ACTIVITY_DETAIL_MULTI_MAX);
        if (list.length) clean[field.key] = Array.from(new Set(list));
        return;
      }
      const text = cleanText(value);
      if (!text) return;
      if (field.type === 'select' && !field.options.includes(text)) return;
      clean[field.key] = text;
    });
    if (Object.keys(clean).length) result[activityId] = clean;
  });
  return result;
}

// Turn saved details into display rows: [{ id, label, symbol, color, lines }].
export function describeActivityDetails(details, activities) {
  if (!details || typeof details !== 'object') return [];
  const order = Array.isArray(activities) && activities.length
    ? activities
    : Object.keys(details);
  const rows = [];
  order.forEach((activityId) => {
    const category = getActivityCategory(activityId);
    const fields = getActivityDetailFields(activityId);
    const values = details[activityId];
    if (!category || !fields.length || !values || typeof values !== 'object') return;
    const lines = [];
    fields.forEach((field) => {
      const value = values[field.key];
      if (Array.isArray(value)) {
        if (value.length) lines.push(`${field.label}: ${value.join(', ')}`);
      } else if (typeof value === 'string' && value.trim()) {
        lines.push(`${field.label}: ${value.trim()}`);
      }
    });
    if (lines.length) {
      rows.push({ id: activityId, label: category.label, symbol: category.symbol, color: category.color, lines });
    }
  });
  return rows;
}

// Legacy `pace` stays in sync with the running detail so existing filters
// and older clients keep working.
export function getRunningPace(details) {
  const pace = details?.running?.pace;
  return typeof pace === 'string' && RUNNING_PACE_OPTIONS.includes(pace) ? pace : '';
}
