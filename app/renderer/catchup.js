// Open and catch up (#1025): after a group or the last session opens, each project's lead gets
// a recap of where the project stands and where work stopped yesterday, and so does its CTO.
// Settings picks who writes it: a model (the default, one headless turn per project, saved as a
// file the lead and the CTO read) or each lead itself.
import * as T from './terminal.js';
import { inputDraft } from '../lib/prompts.js';
import { leadLine, ctoLine } from '../lib/catchup.js';
import { typeLine } from './cto-line.js';

const pause = ms => new Promise(r => setTimeout(r, ms));
// A pane is ready once Claude Code shows its empty input box; a fresh lead takes a few seconds.
async function ready(id, wait = 120e3) {
  for (const end = Date.now() + wait; Date.now() < end; await pause(1000)) {
    if (T.isExited(id)) return false;
    try { if (inputDraft(await T.screen(id, true)) === '') return true; } catch { /* not mounted yet */ }
  }
  return false;
}

// c: { deck, toast, settings, mgrOf(project) -> the CTO's pane id, running(id) }
export async function catchUp(c, projects) {
  const by = c.settings.catchUp, model = c.settings.models.catchup;
  c.toast(by === 'model' ? `Writing the catch-up recaps for ${projects.join(', ')}` : `Asking ${projects.length === 1 ? 'the lead' : 'each lead'} for a catch-up recap`);
  await Promise.all(projects.map(async p => {
    let file = null;
    if (by === 'model') {
      const r = await c.deck.catchUp(p, model);
      if (!r || r.error) { c.toast(`No recap for ${p}: ${(r && r.error) || 'no answer'}`, true); return; }
      file = r.file;
    }
    if (await ready(p)) await typeLine(c.deck, p, leadLine(file));
    else c.toast(`${p}'s lead was not ready, so it did not get its recap`, true);
    const m = c.mgrOf(p);
    if (file && c.running(m)) await typeLine(c.deck, m, ctoLine(p, file));
  }));
}
