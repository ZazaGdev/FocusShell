// The app's tooltip (#1035). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTip, placeTip, MARGIN, GAP } from './tip.js';

test('tooltip: a trailing shortcut in brackets is split off', () => {
  assert.deepEqual(splitTip('Find in this pane (Ctrl+Shift+F)'), { label: 'Find in this pane', key: 'Ctrl+Shift+F' });
  assert.deepEqual(splitTip('Close (Esc)'), { label: 'Close', key: 'Esc' });
  assert.deepEqual(splitTip('Projects (3 open)'), { label: 'Projects (3 open)', key: '' });
  assert.deepEqual(splitTip(''), { label: '', key: '' });
  assert.deepEqual(splitTip(undefined), { label: '', key: '' });
});

const view = { w: 1000, h: 600 };
const rect = (left, top, w = 28, hgt = 28) => ({ left, top, width: w, height: hgt, right: left + w, bottom: top + hgt });

test('tooltip: below and centred when there is room', () => {
  const p = placeTip(rect(500, 100), { w: 100, h: 24 }, view);
  assert.equal(p.below, true);
  assert.equal(p.top, 128 + GAP);
  assert.equal(p.left, 464);
  assert.equal(p.arrow, 46);
});

test('tooltip: above when there is no room below', () => {
  const p = placeTip(rect(500, 570), { w: 100, h: 24 }, view);
  assert.equal(p.below, false);
  assert.equal(p.top, 570 - GAP - 24);
});

test('tooltip: kept inside the window near the edges, arrow still on the target', () => {
  const l = placeTip(rect(0, 100), { w: 200, h: 24 }, view);
  assert.equal(l.left, MARGIN);
  assert.ok(l.arrow >= 8 && l.arrow < 20);
  const r = placeTip(rect(970, 100), { w: 200, h: 24 }, view);
  assert.equal(r.left, view.w - 200 - MARGIN);
  assert.ok(r.arrow <= 200 - 16 && r.arrow > 150);
});

test('tooltip: taller than the room either side still stays on screen', () => {
  const p = placeTip(rect(500, 20, 28, 560), { w: 100, h: 60 }, view);
  assert.ok(p.top >= MARGIN && p.top + 60 <= view.h - MARGIN);
});
