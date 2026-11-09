// The Recorded videos modal (#1482, design C): the recordings on the left, newest first, and the
// picked one on the right with its picture, its cards and every action. The newest is picked
// when the modal opens and tagged "Just recorded" for an hour after it stopped. Drawn only from
// the rows main lists and the open session's state; every button calls back to the page side.
const STEP_LABEL = { audio: 'Pulling out the sound', transcript: 'Transcribing with Whisper', items: 'Finding the items in what you said', screenshots: 'Taking the screenshots' };
const JUST = 3600e3;

const mss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const when = t => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const lengthOf = r => (r.stoppedAt && r.startedAt ? mss(Math.round((r.stoppedAt - r.startedAt) / 1000)) : '');
export function cardsText(r) {
  if (r.state === 'recording') return 'Recording now';
  if (r.state === 'processing') return 'Working on it';
  if (!r.cards) return 'No cards';
  const n = `${r.cards} ${r.cards === 1 ? 'card' : 'cards'}`;
  return r.open ? `${n}, ${r.open} to review` : r.accepted ? `${n}, ${r.accepted} on the boards` : n;
}
export const justRecorded = (r, rows, now) => !!r && rows[0] === r && (r.current || (r.stoppedAt && now - r.stoppedAt < JUST));

// a: { ui, rows, sel (an id), session (the open one, or null), steps, thumbs (Map id: data URL or
// null), pick(id), on: { review, open(id, what), regenerate(id), talk(id), remove(row), retry, discard } }
export function videosView(a) {
  const { ui, rows } = a, { h } = ui;
  if (!rows.length) return h('div', { class: 'recvids' }, h('p', { class: 'sub recnone' }, 'No recordings yet. Start one with the record button.'));
  const r = rows.find(x => x.id === a.sel) || rows[0], now = Date.now();
  const list = h('nav', { class: 'recvlist', 'aria-label': 'Recordings' }, rows.map(x => h('button', {
    class: 'recvitem' + (x === r ? ' sel' : ''), 'data-rec': x.id, onclick: () => a.pick(x.id) },
  h('span', { class: 'recvtxt' }, h('span', { class: 'recwhen' }, when(x.startedAt)),
    h('span', { class: 'sub' }, [lengthOf(x), cardsText(x)].filter(Boolean).join(' · '))),
  justRecorded(x, rows, now) ? h('span', { class: 'recvdot', title: 'Just recorded' }) : null)));
  return h('div', { class: 'recvids' }, list, preview(a, r, now));
}

function preview(a, r, now) {
  const { ui } = a, { h } = ui, s = r.current ? a.session : null, on = a.on;
  const state = s ? s.state : r.state, live = state === 'recording' || state === 'processing' || state === 'sending';
  const pic = h('div', { class: 'recvpic' });
  const shown = a.thumbs.get(r.id);
  if (shown) pic.append(h('img', { src: shown, alt: `The recording of ${when(r.startedAt)}` }));
  if (lengthOf(r)) pic.append(h('span', { class: 'recvlen' }, lengthOf(r)));
  const btn = (label, icon, fn, o = {}) => h('button', { class: 'btn recopen ' + (o.cls || ''), disabled: !!o.off, title: o.title || label, onclick: fn }, icon ? ui.icon(icon) : null, label);

  let status = null;
  if (s && state === 'processing') {
    status = h('ol', { class: 'recsteps' }, (a.steps || []).map(k => h('li', { class: s.done.includes(k) ? 'ok' : s.step === k ? 'now' : '' }, STEP_LABEL[k] || k, s.step === k ? ' ...' : '')));
  } else if (s && state === 'failed') {
    status = h('div', { class: 'recwrap' }, h('p', { class: 'plugerr' }, `${STEP_LABEL[s.step] || s.step} failed: ${s.error}`),
      h('div', { class: 'plugrow' }, btn('Discard', null, on.discard, { cls: 'ghost' }), btn('Try again', null, on.retry, { cls: 'primary' })));
  } else if (s && state === 'sending') status = h('p', { class: 'sub' }, 'Putting the cards on their boards...');
  else if (state === 'recording') status = h('p', { class: 'sub' }, 'Still recording.');

  const titles = r.titles || [];
  const cards = state === 'processing' || state === 'recording' ? null : titles.length
    ? h('ul', { class: 'recvcards' }, titles.slice(0, 8).map(t => h('li', {}, t)), titles.length > 8 ? h('li', { class: 'sub' }, `and ${titles.length - 8} more`) : null)
    : h('p', { class: 'sub' }, r.transcript ? 'Nothing in the talk turned into a card.' : 'No transcript.');
  const regenOff = state !== 'done' || !r.transcript;
  const acts = h('div', { class: 'recvacts' },
    r.open && state === 'review' ? btn(`Review ${r.open} ${r.open === 1 ? 'card' : 'cards'}`, null, on.review, { cls: 'primary' }) : null,
    r.video && state !== 'recording' ? btn('Play video', 'play', () => on.open(r.id, 'video'), { cls: r.open ? '' : 'primary' }) : null,
    r.transcript ? btn('Open transcript', 'doc', () => on.open(r.id, 'transcript')) : null,
    btn('Open folder', 'folder', () => on.open(r.id, 'folder'), { cls: 'ghost' }),
    btn('Regenerate tasks', null, () => on.regenerate(r.id), { off: regenOff || live,
      title: regenOff ? (state === 'done' ? 'This recording has no transcript to read' : 'Finish this recording\'s review first') : 'Read the transcript again. The new cards replace these ones and wait for your review; items already on boards stay there' }),
    btn('Talk to agent', null, () => on.talk(r.id), { off: state === 'recording', title: 'Send this recording to the CTO, to talk about it in its pane' }),
    btn('Delete', 'trash', () => on.remove(r), { cls: 'ghost recdel', off: live }));
  return h('section', { class: 'recvprev' }, pic,
    h('div', {}, h('h3', {}, when(r.startedAt), justRecorded(r, a.rows, now) ? h('span', { class: 'recvnew' }, 'Just recorded') : null),
      h('div', { class: 'sub' }, [lengthOf(r) && `${lengthOf(r)} long`, cardsText(r), r.mic === false ? 'mic off' : ''].filter(Boolean).join(' · '))),
    status, cards, acts);
}
