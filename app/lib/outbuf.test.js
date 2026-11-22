// A pane's output buffer (#2928): pieces plus a tail. Imported by lib.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOut, addOut, lastOut, wholeOut, OUT_MAX, TAIL_MAX } from './outbuf.js';

// Made-up output: letters and the two-byte characters a spinner and box drawing bring.
const text = (n, seed) => Array.from({ length: n }, (_, i) => 'ab─│⠋cd\r\n'[(i * 7 + seed) % 9]).join('');

test('outbuf: trimmed from the front once more than the cap is held, never below it', () => {
  const o = makeOut();
  for (let i = 0; i < 50; i++) addOut(o, text(10_000, i));
  assert.equal(wholeOut(o).length, OUT_MAX);
  assert.ok(o.length >= OUT_MAX && o.length < OUT_MAX + 10_000, 'whole pieces leave, the rest still holds the cap');
  assert.ok(o.head > 0, 'pieces left from the front');
});

test('outbuf: the tail is the last characters across pieces, and a short output whole', () => {
  const o = makeOut();
  addOut(o, 'abc'); addOut(o, ''); addOut(o, 'def');
  assert.equal(lastOut(o, 4), 'cdef');
  assert.equal(lastOut(o, 100), 'abcdef');
  let all = 'abcdef';
  for (let i = 0; i < 40; i++) { const p = text(150 + i * 13, i); addOut(o, p); all += p; }
  assert.equal(lastOut(o, TAIL_MAX), all.slice(-TAIL_MAX));
  assert.equal(lastOut(o, 200), all.slice(-200));
  assert.equal(lastOut(o, 0), all.slice(-TAIL_MAX), 'n of 0 gives the whole tail');
});

test('outbuf: a piece larger than the cap keeps its last cap characters', () => {
  const o = makeOut();
  addOut(o, 'before');
  const big = text(OUT_MAX + 5000, 3);
  addOut(o, big);
  assert.equal(wholeOut(o), big.slice(-OUT_MAX));
  assert.equal(lastOut(o, TAIL_MAX), big.slice(-TAIL_MAX));
  addOut(o, 'after');
  assert.equal(wholeOut(o), (big + 'after').slice(-OUT_MAX));
});

test('outbuf: the whole and the tail equal the old (buffer + data).slice(-400000) for random pieces', () => {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const o = makeOut();
  let old = '';
  for (let i = 0; i < 6000; i++) {
    // Mostly small pieces, now and then a large one, so the front is dropped many times over.
    const p = text(rnd(10) === 0 ? rnd(20_000) : rnd(400), i);
    addOut(o, p);
    old = (old + p).slice(-OUT_MAX);
    if (i % 500 === 0 || i === 5999) {
      assert.equal(wholeOut(o), old, `the whole after piece ${i}`);
      const n = 1 + rnd(TAIL_MAX);
      assert.equal(lastOut(o, n), old.slice(-n), `the last ${n} after piece ${i}`);
    }
  }
});
