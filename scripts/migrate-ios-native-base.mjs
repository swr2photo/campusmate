import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), babel = require('@babel/core');
const apply = process.argv.includes('--apply');
const files = execFileSync('rg', ['--files', 'src', 'app', '-g', '*.js', '-g', '!*.android.js', '-g', '!*.test.js'], { encoding: 'utf8' }).trim().split(/\r?\n/);
const primitives = /(?:^|[\\/])(?:NativePressable|NativeCard|NativeButton|NativeAnimatedCard|native-base-policy)(?:\.ios)?\.js$/;
const touchables = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
const cardName = /^(?:card|group|panel|sheet|list|[A-Za-z]\w*(?:Card|Panel|Sheet))$/;
const report = [];
for (const file of files) {
  if (primitives.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const edits = [], controls = [], surfaces = [];
  let hasNativeCard = false, hasAnimatedCard = false;
  babel.traverse(ast, {
    ImportDeclaration(p) {
      if (/\/NativeCard$/.test(p.node.source.value)) hasNativeCard = true;
      if (/\/NativeAnimatedCard$/.test(p.node.source.value)) hasAnimatedCard = true;
      if (p.node.source.value !== 'react-native') return;
      const migrated = p.node.specifiers.filter(s => touchables.has(s.imported?.name));
      if (!migrated.length) return;
      controls.push(...migrated.map(s => s.imported.name === s.local.name ? s.local.name : `${s.imported.name} as ${s.local.name}`));
      const kept = p.node.specifiers.filter(s => !migrated.includes(s));
      const named = kept.filter(s => s.type === 'ImportSpecifier').map(s => s.imported.name === s.local.name ? s.local.name : `${s.imported.name} as ${s.local.name}`);
      const defaultImport = kept.find(s => s.type === 'ImportDefaultSpecifier');
      const spec = [defaultImport?.local.name, named.length ? `{ ${named.join(', ')} }` : null].filter(Boolean).join(', ');
      edits.push({ start: p.node.start, end: p.node.end, text: spec ? `import ${spec} from 'react-native';` : '' });
    },
    JSXElement(p) {
      const opening = p.node.openingElement;
      const name = source.slice(opening.name.start, opening.name.end);
      if (name !== 'View' && name !== 'Animated.View' && name !== 'Pressable') return;
      const style = opening.attributes.find(a => a.name?.name === 'style');
      if (!style?.value?.expression) return;
      let isCard = false;
      babel.traverse(style.value.expression, { noScope: true, MemberExpression(q) {
        if (!q.node.computed && /(?:styles|Styles)$/.test(q.node.object.name || '') && cardName.test(q.node.property.name)) isCard = true;
      } });
      // traverse doesn't visit the root node when the style is `styles.card`.
      const root = style.value.expression;
      if (root.type === 'MemberExpression' && !root.computed && /(?:styles|Styles)$/.test(root.object.name || '') && cardName.test(root.property.name)) isCard = true;
      if (!isCard) return;
      if (name === 'Pressable') {
        if (opening.attributes.some(a => a.name?.name === 'nativeCardSurface')) return;
        edits.push({ start: opening.name.end, end: opening.name.end, text: ' nativeCardSurface' });
        surfaces.push({ name: 'TouchableCard', line: opening.loc.start.line });
        return;
      }
      const replacement = name === 'View' ? 'NativeCard' : 'NativeAnimatedCard';
      surfaces.push({ name: replacement, line: opening.loc.start.line });
      edits.push({ start: opening.name.start, end: opening.name.end, text: replacement });
      const closing = p.node.closingElement;
      if (closing) edits.push({ start: closing.name.start, end: closing.name.end, text: replacement });
    },
  });
  if (!edits.length) continue;
  const relative = target => {
    let result = path.relative(path.dirname(file), `src/components/${target}`).replaceAll('\\', '/');
    if (!result.startsWith('.')) result = `./${result}`;
    return result;
  };
  const imports = [];
  if (controls.length) imports.push(`import { ${controls.join(', ')} } from '${relative('NativePressable')}';`);
  if (surfaces.some(s => s.name === 'NativeCard') && !hasNativeCard) imports.push(`import NativeCard from '${relative('NativeCard')}';`);
  if (surfaces.some(s => s.name === 'NativeAnimatedCard') && !hasAnimatedCard) imports.push(`import NativeAnimatedCard from '${relative('NativeAnimatedCard')}';`);
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  if (imports.length) result = `${imports.join('\n')}\n${result}`;
  babel.parseSync(result, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  if (apply) {
    const backup = path.join('D:/Temp/campusmate-ios-native-base-before-20261021', file);
    mkdirSync(path.dirname(backup), { recursive: true });
    if (!existsSync(backup)) writeFileSync(backup, source, { flag: 'wx' });
    try {
      const target = path.resolve(file);
      if (!target.startsWith(path.resolve('.') + path.sep)) throw Error('Target outside workspace');
      const temporary = `${target}.native-base.tmp`;
      writeFileSync(temporary, result, { flag: 'wx' });
      renameSync(temporary, target);
    } catch (error) {
      report.push({ file, error: error.message });
      process.exitCode = 1;
      continue;
    }
  }
  report.push({ file, controls: controls.length, surfaces });
}
console.log(JSON.stringify({ applied: apply, files: report.length, controlImports: report.reduce((n, f) => n + f.controls, 0), surfaces: report.reduce((n, f) => n + f.surfaces.length, 0), changes: report }, null, 2));
