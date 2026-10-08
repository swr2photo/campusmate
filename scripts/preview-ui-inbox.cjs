// Structural browser checks of actual RN components, using fixture services.
// These do not replace native device or authenticated end-to-end tests.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const RN = require('react-native-web');
const babel = require('@babel/core');
const br = createRequire(require.resolve('babel-preset-expo'));
const root = process.cwd(), output = path.join(root, 'artifacts/ui-inbox/layout-preview');
fs.mkdirSync(output, { recursive: true });
let mode = 'light', scale = 1, width = 393;
const themeSource = fs.readFileSync('src/theme.js', 'utf8');
const records = [
  { id: 'face-verification', type: 'face_verification', title: 'ยืนยันใบหน้าเพื่อเปิดโปรไฟล์', body: 'โปรไฟล์ของคุณจะแสดงให้คนอื่นเห็นหลังยืนยันใบหน้า เตรียมอยู่ในที่สว่างและทำตามคำแนะนำ', status: 'required', readAt: null },
  { id: 'm1', type: 'message', title: 'มีข้อความใหม่จากเพื่อนของคุณ', body: 'คุณมีข้อความใหม่ แตะเพื่อเปิดแชต', readAt: null },
  { id: 'p1', type: 'party_request', title: 'คำขอเข้าร่วมตี้ได้รับอนุมัติ', body: 'แตะเพื่อดูรายละเอียดในหน้าหาตี้', readAt: {} },
  { id: 'a1', type: 'admin_announcement', title: 'รายละเอียดกิจกรรมและประกาศจากมหาวิทยาลัย', body: 'อ่านข้อความและรายละเอียดของกิจกรรมภายหลังได้จากประวัติแจ้งเตือน', readAt: {} },
].map(row => ({ ...row, target: {}, createdAt: { seconds: 1791442800 } }));
const router = { push() {}, navigate() {} }, Stack = () => null; Stack.Screen = () => null;
const Icon = ({ size = 20, color }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { flexShrink: 0 } }, React.createElement('circle', { cx: 12, cy: 12, r: 8, stroke: color, strokeWidth: 1.7, fill: 'none' }));
const Native = { ...RN, useColorScheme: () => mode, useWindowDimensions: () => ({ width, height: 900, scale: 1, fontScale: scale }),
  Image: props => React.createElement('img', { src: props.source?.uri, alt: props.accessibilityLabel || '', style: { ...RN.StyleSheet.flatten(props.style), objectFit: props.resizeMode || 'contain' } }),
  Text: props => {
    const flat = RN.StyleSheet.flatten(props.style) || {};
    return React.createElement(RN.Text, { ...props, style: [props.style, props.allowFontScaling === false ? null : { fontSize: (flat.fontSize || 15) * scale, lineHeight: (flat.lineHeight || 22.5) * scale }] });
  },
};
const cache = new Map();
function load(file) {
  file = path.resolve(file); if (!path.extname(file)) file += '.js';
  if (file.endsWith('.png')) return { uri: pathToFileURL(file).href };
  if (cache.has(file)) return cache.get(file).exports;
  const source = fs.readFileSync(file, 'utf8');
  const code = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [[br.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], br.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} }; cache.set(file, module);
  const request = spec => {
    if (spec === 'react-native') return Native;
    if (spec === 'expo-router') return { router, Stack };
    if (spec === '@expo/vector-icons') return { Feather: Icon };
    if (spec === 'expo-image') return { Image: props => React.createElement(Native.Image, { ...props, resizeMode: props.contentFit || 'contain' }) };
    if (spec.endsWith('FeatureIcon')) return { __esModule: true, default: Icon };
    if (spec.endsWith('NotificationInboxContext')) return { useNotificationInbox: () => ({ uid: 'fixture', count: 102, rows: records, loading: false, hasMore: false, markRead: async () => {}, markAll: async () => {} }) };
    if (spec.endsWith('FaceVerificationPrompt')) return { useFaceVerificationFlow: () => ({ required: true, start() {}, modal: null }) };
    if (spec.endsWith('notificationInboxService')) return { timestampMillis: value => (value?.seconds || 0) * 1000, inboxTargetAvailable: async () => true };
    if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec));
    return require(spec);
  };
  new Function('require', 'module', 'exports', code)(request, module, module.exports);
  return module.exports;
}
const Party = load('src/components/PartyFinderEntry.js').default;
const Empty = load('src/components/StorysetStateView.js').default;
const Bell = load('src/components/NotificationBell.js').default;
const Notifications = load('app/notifications.js').default;
const fontFaces = ['400Regular', '500Medium', '600SemiBold', '700Bold'].map(weight => {
  const filename = `NotoSansThai_${weight}.ttf`;
  const source = require.resolve(`@expo-google-fonts/noto-sans-thai/${weight}/${filename}`);
  fs.copyFileSync(source, path.join(output, filename));
  return `@font-face{font-family:NotoSansThai_${weight};src:url('${filename}');font-weight:normal;font-display:block}`;
}).join('\n');
const pages = [];
for (const w of [320, 360, 393, 430, 768]) for (const s of [1, 1.3, 2]) for (const m of ['light', 'dark']) for (const kind of ['components', 'notifications']) {
  width = w; scale = s; mode = m;
  const content = kind === 'notifications' ? React.createElement(Notifications) : React.createElement(RN.View, { style: { padding: 16, gap: 16 } },
    React.createElement(Bell), React.createElement(Party), React.createElement(Empty, { title: 'ยังไม่มีคู่ที่จับคู่แล้ว', description: 'คนที่คุณรับเป็นเพื่อนแล้วจะแสดงในรายการนี้ เริ่มส่งข้อความทักทายได้เลย', actionLabel: 'ค้นหาเพื่อนใหม่', onAction() {} }));
  const markup = renderToStaticMarkup(React.createElement(RN.View, { style: { width: '100%', maxWidth: 760, alignSelf: 'center', minHeight: 900, backgroundColor: m === 'dark' ? '#16171A' : '#F7F7F8' } }, content));
  const name = `${kind}-${w}-${s}-${m}`;
  fs.writeFileSync(path.join(output, name + '.html'), `<!doctype html><html lang="th"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusMate component layout preview</title><style>${RN.StyleSheet.getSheet().textContent}\n${fontFaces}\nhtml,body{margin:0;width:100%;background:${m === 'dark' ? '#16171A' : '#F7F7F8'}}body{display:flex;flex-direction:column;min-height:100vh}svg{display:block}</style><body>${markup}</body></html>`);
  pages.push({ name, width: w, scale: s, mode: m, kind });
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(pages, null, 2));
console.log(`Rendered ${pages.length} actual-component fixture pages. Native behavior is not exercised.`);
if (process.argv.includes('--screenshots')) (async () => {
  const { chromium } = require('C:/Users/This PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); const results = [];
  for (const item of pages) {
    await page.setViewportSize({ width: item.width, height: 900 });
    await page.goto(pathToFileURL(path.join(output, item.name + '.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const checks = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
      smallButtons: [...document.querySelectorAll('[role="button"], [role="tab"]')].map(el => el.getBoundingClientRect()).filter(rect => rect.height > 0 && (rect.height < 43.5 || rect.width < 43.5)).length }));
    await page.screenshot({ path: path.join(output, item.name + '.png'), fullPage: true });
    results.push({ ...item, ...checks });
  }
  await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  const failures = results.filter(row => row.overflow || row.smallButtons);
  console.log(JSON.stringify({ checked: results.length, failures })); if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
