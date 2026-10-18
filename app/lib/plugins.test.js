import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API, parseShortcutInput, canonicalShortcut, checkManifest, cleanPluginSettings, pluginStates, shortcutClashes, normalizePluginsEntry, validShortcut } from './plugins.js';

const good = {
  id: 'echo', name: 'Echo', version: '1.0.0', api: API, description: 'Says it back',
  button: { icon: 'spark', title: 'Echo' }, shortcut: 'Control+Alt+E', uses: ['boards'],
  settings: [
    { key: 'greeting', label: 'Greeting', type: 'text', default: 'hello' },
    { key: 'loud', label: 'Loud', type: 'toggle', default: false },
    { key: 'size', label: 'Size', type: 'choice', default: 'm', choices: ['s', 'm', 'l'] },
  ],
};

test('checkManifest passes a good manifest', () => {
  assert.deepEqual(checkManifest(good), []);
});

test('checkManifest names each problem', () => {
  const errs = checkManifest({ ...good, id: 'Bad Id', api: 99, shortcut: 'Banana', uses: ['rockets'], settings: [{ key: 'x', type: 'choice', default: 'z', choices: ['a'] }] });
  assert.equal(errs.length, 5);
  assert.match(errs.join('|'), /id must/);
  assert.match(errs.join('|'), /api 99/);
  assert.match(errs.join('|'), /shortcut Banana/);
  assert.match(errs.join('|'), /uses rockets/);
  assert.match(errs.join('|'), /setting x needs choices/);
  assert.deepEqual(checkManifest(null), ['not an object']);
});

test('validShortcut takes Electron accelerators with a modifier', () => {
  assert.equal(validShortcut('Control+Alt+R'), true);
  assert.equal(validShortcut('Control+Shift+F5'), true);
  assert.equal(validShortcut('R'), false);
  assert.equal(validShortcut('Control+'), false);
  assert.equal(validShortcut('Shift+A'), false);
  assert.equal(validShortcut('Control+V'), false);
  assert.equal(validShortcut('Control+Control+R'), false);
  assert.equal(validShortcut('Control+Alt+R'), true);
  assert.equal(validShortcut('Control+F5'), true);
  assert.equal(validShortcut('Alt+Space'), true);
});

test('canonicalShortcut puts modifiers in a fixed order', () => {
  assert.equal(canonicalShortcut('Shift+Control+Space'), 'Control+Shift+Space');
  assert.equal(canonicalShortcut('Alt+Control+R'), 'Control+Alt+R');
});

test('parseShortcutInput tidies case and Ctrl, empty means none, bad is null', () => {
  assert.equal(parseShortcutInput('ctrl+alt+r'), 'Control+Alt+R');
  assert.equal(parseShortcutInput(' Alt + Ctrl + 5 '), 'Control+Alt+5');
  assert.equal(parseShortcutInput('control+space'), 'Control+Space');
  assert.equal(parseShortcutInput('ctrl+f5'), 'Control+F5');
  assert.equal(parseShortcutInput(''), '');
  assert.equal(parseShortcutInput('   '), '');
  assert.equal(parseShortcutInput('R'), null);
  assert.equal(parseShortcutInput('ctrl+r'), null);
  assert.equal(parseShortcutInput('ctrl+alt+nonsense'), null);
});

test('checkManifest gives one error for each single fault', () => {
  assert.deepEqual(checkManifest({ ...good, version: '1' }), ['version must look like 1.0.0']);
  assert.deepEqual(checkManifest({ ...good, name: '' }), ['name is missing']);
  assert.deepEqual(checkManifest({ ...good, button: undefined }), ['button needs icon and title']);
  assert.deepEqual(checkManifest({ ...good, settings: [good.settings[0], good.settings[0]] }), ['setting greeting is listed twice']);
  assert.deepEqual(checkManifest({ ...good, settings: [{ key: 'z', type: 'dial', default: 1 }] }), ['setting z has type dial']);
  assert.deepEqual(checkManifest({ ...good, uses: {} }), ['uses must be a list']);
  assert.deepEqual(checkManifest({ ...good, settings: {} }), ['settings must be a list']);
  assert.deepEqual(checkManifest({ ...good, settings: [{ key: 'x', type: 'choice', default: 'a', choices: ['a', 2] }] }), ['setting x choices must be text']);
});

test('cleanPluginSettings keeps known keys of the right type, else the default', () => {
  assert.deepEqual(cleanPluginSettings(good, { greeting: 'hi', loud: 'yes', size: 'xl', stray: 1 }), { greeting: 'hi', loud: false, size: 'm' });
  assert.deepEqual(cleanPluginSettings(good, null), { greeting: 'hello', loud: false, size: 'm' });
});

test('pluginStates: off by default, manifest shortcut unless changed or cleared', () => {
  const s = pluginStates([good], { echo: { on: true, settings: { greeting: 'yo' } } });
  assert.deepEqual(s.echo, { on: true, shortcut: 'Control+Alt+E', settings: { greeting: 'yo', loud: false, size: 'm' } });
  assert.equal(pluginStates([good], {}).echo.on, false);
  assert.equal(pluginStates([good], { echo: { on: true, shortcut: null } }).echo.shortcut, null);
  assert.equal(pluginStates([good], { echo: { on: true, shortcut: 'Control+Alt+Q' } }).echo.shortcut, 'Control+Alt+Q');
});

test('shortcutClashes: FocusShell keys and a second plugin on the same key', () => {
  const st = {
    a: { on: true, shortcut: 'Control+Alt+R' },
    b: { on: true, shortcut: 'control+alt+r' },
    c: { on: true, shortcut: 'Control+Shift+Space' },
    d: { on: false, shortcut: 'Control+Alt+R' },
    e: { on: true, shortcut: 'Alt+Control+R' },
    f: { on: true, shortcut: 'Shift+Control+Space' },
  };
  const c = shortcutClashes(st);
  assert.deepEqual(Object.keys(c).sort(), ['b', 'c', 'e', 'f']);
  assert.match(c.f, /FocusShell's own key/);
  assert.match(c.b, /also a's shortcut/);
  assert.match(c.c, /FocusShell's own key/);
});

test('normalizePluginsEntry keeps the shape Settings saves', () => {
  const n = normalizePluginsEntry({ echo: { on: true, shortcut: 'Control+Alt+E', settings: { greeting: 'hi', n: 3, ok: true } }, 'Bad Id': { on: true }, x: 5 });
  assert.deepEqual(n, { echo: { on: true, shortcut: 'Control+Alt+E', settings: { greeting: 'hi', ok: true } } });
  assert.deepEqual(normalizePluginsEntry({ echo: { on: false, shortcut: null } }), { echo: { on: false, shortcut: null, settings: {} } });
  assert.deepEqual(normalizePluginsEntry([]), {});
});

import { normalizeSettings } from './settings.js';

test('normalizeSettings keeps the plugins entry, empty by default', () => {
  assert.deepEqual(normalizeSettings(null).plugins, {});
  assert.deepEqual(normalizeSettings({ plugins: { echo: { on: true, settings: { a: 'b' } } } }).plugins, { echo: { on: true, settings: { a: 'b' } } });
});

import { MANIFESTS } from '../plugins/manifests.js';

test('every built-in plugin manifest passes checkManifest, ids unique', () => {
  assert.ok(MANIFESTS.length >= 1);
  for (const m of MANIFESTS) assert.deepEqual(checkManifest(m), [], m.id);
  assert.equal(new Set(MANIFESTS.map(m => m.id)).size, MANIFESTS.length);
});
