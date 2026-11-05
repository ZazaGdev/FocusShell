// The recorder's brainstorm on the main side (#369, stage 4): starts brainstorm-cto or
// brainstorm-pm through the sessions service with the cards, the transcript and the named
// projects' open items, looks for the proposal the agent writes to proposed.json once a second,
// applies it to the open cards (lib/brainstorm.js) and ends the session with the review.
import fs from 'node:fs';
import path from 'node:path';
import { brainstormPrompt, readProposal, applyProposal } from './lib/brainstorm.js';
import { transcriptText } from './lib/extract.js';
import { readLines } from './process.js';

// o: { host, current: () => the session, apply(event), dirOf(session) }
export function brainstormer({ host, current, apply, dirOf }) {
  let poll = null, sid = null, n = 0;
  const projects = () => { try { return host.boards.projects(); } catch { return []; } };
  const openOf = cards => {
    const open = {};
    for (const p of new Set((cards || []).map(c => c.project).filter(p => p && p !== 'Me'))) try { open[p] = host.boards.open(p); } catch { /* no board yet */ }
    return open;
  };
  const proposedFile = s => path.join(dirOf(s), 'proposed.json');
  const idFor = who => `brainstorm-${who}`;

  // A proposal written since the last look: applied once, then kept as proposed-<n>.json.
  function look() {
    const s = current();
    if (!s || !s.brainstorm) return;
    const f = proposedFile(s);
    if (!fs.existsSync(f)) return;
    let raw = '';
    try { raw = fs.readFileSync(f, 'utf8'); } catch { return; } // still being written
    const keep = ok => { try { fs.renameSync(f, path.join(dirOf(s), `proposed-${++n}${ok ? '' : '-bad'}.json`)); } catch (e) { host.log(`proposal: ${e.message}`); } };
    try {
      const entries = readProposal(raw);
      keep(true);
      apply({ type: 'proposal', cards: applyProposal(s.cards, entries, { open: openOf(s.cards), projects: projects() }) });
    } catch (e) {
      if (!raw.trim()) return; // an empty file: the agent has not written it yet
      keep(false);
      apply({ type: 'proposalFailed', error: e.message });
    }
  }

  function start(who) {
    const s = current();
    if (!s || s.state !== 'review' || s.brainstorm) return { error: 'A brainstorm is already open, or nothing is in review' };
    if (!['cto', 'pm'].includes(who)) return { error: 'Brainstorm with the CTO or the PM' };
    try { fs.rmSync(proposedFile(s), { force: true }); } catch { /* none */ }
    const dir = dirOf(s);
    const prompt = brainstormPrompt({ who, cards: s.cards, transcript: transcriptText(readLines(dir)), transcriptFile: path.join(dir, 'transcript.md'),
      proposedFile: proposedFile(s), open: openOf(s.cards) });
    try { sid = host.sessions.startBrainstorm(who, prompt, dir); } catch (e) { return { error: e.message }; }
    apply({ type: 'brainstorm', who });
    if (!poll) poll = setInterval(look, 1000);
    return { id: sid };
  }

  // Ends the session (the button, the review ending, a restart finding one recorded open).
  function end() {
    if (poll) { clearInterval(poll); poll = null; }
    const s = current();
    const id = sid || (s && s.brainstorm ? idFor(s.brainstorm.who) : null);
    if (id) try { host.sessions.end(id); } catch (e) { host.log(`end ${id}: ${e.message}`); }
    sid = null;
    if (s && s.brainstorm) apply({ type: 'brainstormEnd' });
  }

  // What "Update the cards" types into the session.
  const updateLine = () => { const s = current(); return s && s.brainstorm ? `Please write your proposal for the cards to ${proposedFile(s)} now.` : null; };
  const liveId = () => { const s = current(); return s && s.brainstorm ? idFor(s.brainstorm.who) : null; };

  // The smoke run's stand-in for the agent: a proposal written the way the agent writes one.
  const fakeProposal = () => {
    const s = current();
    if (!s || !s.brainstorm) return false;
    const [a, b, c] = (s.cards || []).filter(x => x.status === 'open');
    const cards = [];
    if (a) cards.push({ id: a.id, action: 'rewrite', title: `${a.title}, with the 7 day change in green or red` });
    if (b) cards.push({ id: b.id, action: 'drop' });
    if (c) cards.push({ id: c.id, action: 'unchanged' });
    cards.push({ action: 'add', kind: 'task', project: a ? a.project : 'Me', title: 'Add a test for the weekly change', description: ['Raised in the brainstorm.'] });
    fs.writeFileSync(proposedFile(s), JSON.stringify({ cards }));
    return true;
  };

  return { start, end, look, updateLine, liveId, fakeProposal, stop() { if (poll) clearInterval(poll); poll = null; } };
}
