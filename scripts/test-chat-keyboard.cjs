// Exercise the production effects/callbacks without loading native modules.
// Run: node scripts/test-chat-keyboard.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function readComponent(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const ast = babel.parseSync(source, {
    configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] },
  });
  return { source, ast };
}

const viewer = readComponent('src/components/ChatImageViewerModal.js');
let resetEffect;
babel.traverse(viewer.ast, {
  CallExpression({ node }) {
    if (node.callee.name === 'useEffect' &&
        viewer.source.slice(node.start, node.end).includes('setReplyText')) {
      resetEffect = node;
    }
  },
});
assert.ok(resetEffect, 'viewer lifecycle effect found');
const context = vm.createContext({
  visible: false, initialIndex: 0, images: [], openingIndex: 0, openingImage: undefined,
  wasVisibleRef: { current: false }, isKeyboardOpenRef: { current: false },
  singleTapTimer: { current: null }, keyboardTranslateY: { setValue() {} },
  dismissals: 0, reply: 'draft',
  setCurrentIndex() {}, setImageRatio() {}, setJustSent() {},
  getCachedAspectRatio() { return null; }, resetZoom() {}, showControls() {}, clearTimeout,
});
context.Keyboard = { dismiss() { context.dismissals++; } };
context.setReplyText = (value) => { context.reply = value; };
const callback = vm.runInContext(`(${viewer.source.slice(resetEffect.arguments[0].start, resetEffect.arguments[0].end)})`, context);
const dependencies = viewer.source.slice(resetEffect.arguments[1].start, resetEffect.arguments[1].end);
let previous;
function render(visible, images) {
  Object.assign(context, { visible, images, openingIndex: 0, openingImage: images[0] });
  const next = vm.runInContext(dependencies, context);
  if (!previous || next.some((value, i) => !Object.is(value, previous[i]))) callback();
  previous = next;
}
render(false, []);
for (let i = 0; i < 20; i++) render(false, []);
assert.equal(context.dismissals, 0, 'hidden viewer must not dismiss the chat keyboard');
render(true, ['file:///photo.jpg']);
context.reply = 'reply in progress';
render(true, ['file:///photo.jpg']);
assert.equal(context.reply, 'reply in progress', 'equivalent arrays must not erase image replies');
render(false, []);
assert.equal(context.dismissals, 1, 'closing an open viewer dismisses its keyboard once');
render(false, []);
assert.equal(context.dismissals, 1);

for (const file of ['src/screens/ChatRoomScreen.js', 'src/screens/ChatRoomScreen.ios.js']) {
  const component = readComponent(file);
  let changeCallback;
  babel.traverse(component.ast, {
    VariableDeclarator({ node }) {
      if (node.id.name === 'handleTextInputChange') changeCallback = node.init.arguments[0];
    },
  });
  let draft;
  const change = vm.runInNewContext(`(${component.source.slice(changeCallback.start, changeCallback.end)})`, {
    setInputText(value) { draft = value; },
    setSelectedImage() { throw new Error('Typing must not silently become an attachment'); },
  });
  for (const text of ['ไทย hello', 'line one\nline two', 'https://example.com/photo.jpg', '']) {
    change(text);
    assert.equal(draft, text, `${file}: preserve typed/pasted draft`);
  }
}
console.log('PASS: hidden viewer, close transition, stable image reply, Android/iOS drafts');
