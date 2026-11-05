// Plain summaries for Waiting on you cards (#1521): one headless Haiku turn per card text,
// made in the background one at a time and kept in state/card-summaries.json, so a card shows
// its summary as soon as the owner opens Waiting. Runs on the owner's Claude Code sign-in, never
// an API key. A card without one, or whose turn failed, shows its parsed view (lib/cardview.js).
import fs from 'node:fs';
import path from 'node:path';
import { runTurn } from './helper.js';
import { helperCommand } from './lib/helper.js';
import { SUMMARY_PROMPT, parseSummary } from './lib/cardsummary.js';

const KEEP = 300;          // summaries kept, newest first
const TIMEOUT = 60000;
const RETRY_MS = 30 * 60000; // a failed card is tried again after this long

// d: { ipcMain, P: { state }, read, send, env: () => the environment for claude, smoke }
export function registerCardSummaries(d) {
  const { ipcMain, P, read, send, env, smoke } = d;
  const file = path.join(P.state, smoke ? 'smoke' : '', 'card-summaries.json'), work = path.join(P.state, 'helper', 'work');
  let cache = {}; try { cache = JSON.parse(read(file, '{}')) || {}; } catch { cache = {}; }
  const failed = new Map(); // key -> ms of the failed try
  const queue = new Map();  // key -> input text
  let busy = false;
  const save = () => {
    const keep = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, KEEP);
    cache = Object.fromEntries(keep);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(cache, null, 1)); } catch { /* next save */ }
  };

  async function next() {
    if (busy || !queue.size) return;
    busy = true;
    const [key, input] = queue.entries().next().value;
    queue.delete(key);
    const t0 = Date.now();
    let md = null;
    if (smoke) md = `**Smoke summary for ${key.split(':')[0]}.**\n\nWritten without Claude in a smoke run.\n\n- **First choice**: what it means`;
    else {
      fs.mkdirSync(work, { recursive: true });
      const promptFile = path.join(P.state, 'helper', 'card-summary-prompt.txt');
      fs.writeFileSync(promptFile, SUMMARY_PROMPT);
      const r = await runTurn(helperCommand({ promptFile, model: 'haiku' }), input,
        { cwd: work, env: { ...env(), MAX_THINKING_TOKENS: '0' }, timeout: TIMEOUT });
      md = r.error ? null : parseSummary(r.out);
    }
    if (md) { cache[key] = { md, at: Date.now(), ms: Date.now() - t0 }; save(); send('cardsum:ready', { key, md }); }
    else failed.set(key, Date.now());
    busy = false;
    next();
  }

  // The page lists the cards waiting now; the ones with no summary yet join the queue.
  ipcMain.on('cardsum:want', (_e, list) => {
    for (const { key, input } of Array.isArray(list) ? list : []) {
      if (typeof key !== 'string' || typeof input !== 'string' || cache[key] || queue.has(key)) continue;
      if (Date.now() - (failed.get(key) || 0) < RETRY_MS) continue;
      queue.set(key, input.slice(0, 8000));
    }
    next();
  });
  ipcMain.handle('cardsum:all', () => Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, v.md])));
}
