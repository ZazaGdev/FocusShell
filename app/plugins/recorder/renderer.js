// The recorder's page side (#369): records the screen and the mic with MediaRecorder and
// streams a chunk a second to the main side; draws the button and the screens from the state
// the main side sends. The button (or the shortcut) starts a recording, stops it, or opens the
// screen of the recording that is waiting.
import { buttonFor } from './lib/session.js';
import { micLevel, micLit } from './lib/area.js';
import { reviewScreen, shapeOf } from './screens/review.js';
import { videosView } from './screens/videos.js';
import { micError } from './lib/permissions.js';
import { MAC } from '../../lib/platform.js';

const STEP_LABEL = { audio: 'Pulling out the sound', transcript: 'Transcribing with Whisper', items: 'Finding the items in what you said', screenshots: 'Taking the screenshots' };
const MIME = 'video/webm;codecs=vp8,opus';

export function mount(ui) {
  const { h } = ui;
  const css = h('link', { rel: 'stylesheet', href: new URL('./recorder.css', import.meta.url).href });
  document.head.append(css);
  let st = { session: null }, cap = null, working = false, screen = null, tick = null, shape = '';
  const shots = new Map(); // screenshot path: data URL, loaded once

  // The review's id once it has been opened: its badge goes, the button stays lit (#401).
  let seen = null;
  const paint = () => {
    const s = st.session, b = buttonFor(s, Date.now());
    ui.button.set(b.state, b.state === 'attention' && s && seen === s.id ? '' : b.label);
    ui.button.el.dataset.tip = { active: 'Stop recording', busy: `Working in the background: ${(s && STEP_LABEL[s.step]) || 'processing'}. Click for the steps`, attention: 'The recording is ready to review' }[b.state] || 'Record the screen';
    if (b.state === 'active' && !tick) tick = setInterval(paint, 1000);
    if (b.state !== 'active' && tick) { clearInterval(tick); tick = null; }
  };
  const show = next => {
    st = next || { session: null };
    if (screen && st.session && st.session.state === 'review') seen = st.session.id; // turned into the review in front of the owner
    paint();
    dropTerm();
    const s = st.session;
    if (screen && s && s.state === 'recording') { screen.close(); return; }
    if (mode === 'review' && !(s && (s.state === 'review' || s.state === 'sending'))) mode = 'list';
    redraw();
  };

  // The Recorded videos modal (#1482): the list and preview, or the open recording's card review.
  // A text edit coming back changes nothing on screen: redrawing would lose the caret.
  let mode = 'list', sel = null, rows = [];
  const thumbs = new Map(); // recording id: data URL, or null while it loads or when there is none
  async function redraw(force = false) {
    if (!screen) return;
    if (mode === 'review') {
      const sh = 'review' + shapeOf(st);
      if (force || sh !== shape) { shape = sh; screen.setBody(body()); }
      return;
    }
    const got = await ui.invoke('list');
    if (!screen || mode !== 'list') return;
    rows = Array.isArray(got) ? got : [];
    const sh = 'list' + JSON.stringify([sel, rows, shapeOf(st), (st.session && st.session.done) || null, [...thumbs.entries()].map(([k, v]) => [k, !!v])]);
    if (!force && sh === shape) return;
    shape = sh;
    screen.setBody(videosView({ ui, rows, sel, session: st.session, steps: st.steps, thumbs, pick: id => { sel = id; redraw(); }, on: videoActs }));
    const want = rows.find(r => r.id === sel) || rows[0];
    if (want && want.video && !thumbs.has(want.id)) {
      thumbs.set(want.id, null);
      ui.invoke('thumb', want.id).then(url => { if (url) { thumbs.set(want.id, url); redraw(); } });
    }
  }
  const videoActs = {
    review: () => { mode = 'review'; const s = st.session; if (s) { seen = s.id; paint(); } redraw(true); },
    open: (id, what) => ui.invoke('openPast', id, what),
    async regenerate(id) {
      const r = await ui.invoke('regenerate', id);
      if (!r || r.error) ui.toast(`Could not regenerate: ${(r && r.error) || 'no answer'}`, true);
      else { sel = id; ui.toast('Reading the transcript again. The new cards replace these ones and wait for your review'); }
    },
    async talk(id) {
      const line = await ui.invoke('talk', id);
      if (!line) { ui.toast('That recording is gone', true); return; }
      if (await ui.cto(line)) ui.toast('Sent to the CTO. Ask it about the recording in its pane');
      else ui.toast('The CTO is not running, so the recording was not sent', true);
    },
    async remove(r) {
      if (r.current) { await discard(); return; }
      const ok = await ui.kit.confirm({ title: 'Delete this recording?', text: 'Its video, sound and transcript are deleted. Board items keep their screenshots.', ok: 'Delete', danger: true });
      if (!ok) return;
      const res = await ui.invoke('deleteOne', r.id);
      if (!res || res.error) { ui.toast(`Could not delete: ${(res && res.error) || 'no answer'}`, true); return; }
      thumbs.delete(r.id);
      if (sel === r.id) sel = null;
      redraw();
    },
    retry: () => ui.invoke('retry'),
    discard: () => discard(),
  };

  // The display's track cut down to the marked area (#376). The frames are cropped as they
  // arrive, with no timer or canvas, so a hidden or covered FocusShell window does not slow it.
  // crop is in the pixels of source's size; a frame of another size is scaled to it.
  function cropped(track, source, crop) {
    if (typeof MediaStreamTrackProcessor !== 'function' || typeof MediaStreamTrackGenerator !== 'function') throw new Error('this Electron cannot crop a screen track');
    const proc = new MediaStreamTrackProcessor({ track }), gen = new MediaStreamTrackGenerator({ kind: 'video' });
    const even = n => Math.floor(n / 2) * 2, stopper = new AbortController();
    const cut = new TransformStream({
      transform(frame, out) {
        try {
          const v = frame.visibleRect, k = v.width / source.width;
          const x = even(v.x + crop.x * k), y = even(v.y + crop.y * k);
          const width = Math.max(2, even(Math.min(crop.width * k, v.x + v.width - x))), height = Math.max(2, even(Math.min(crop.height * k, v.y + v.height - y)));
          out.enqueue(new VideoFrame(frame, { visibleRect: { x, y, width, height }, displayWidth: width, displayHeight: height }));
        } finally { frame.close(); }
      },
    });
    proc.readable.pipeThrough(cut, { signal: stopper.signal }).pipeTo(gen.writable, { signal: stopper.signal }).catch(() => { /* stopped */ });
    return { track: gen, end: () => { stopper.abort(); track.stop(); gen.stop(); } };
  }

  // The streams to record: the marked area of one display at 5 frames a second, plus the mic
  // when it is on. A fake run records a painted canvas and a tone instead, so the smoke run
  // never records the owner's screen.
  async function streams(source, crop, mic) {
    if (ui.fake) {
      const cv = h('canvas', { width: 320, height: 180 }), g = cv.getContext('2d');
      let n = 0;
      const paintCv = setInterval(() => { g.fillStyle = `hsl(${(n++ * 40) % 360} 60% 40%)`; g.fillRect(0, 0, 320, 180); }, 200);
      const ac = new AudioContext(), osc = ac.createOscillator(), dest = ac.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      const v = cv.captureStream(5), meter = micMeter(dest.stream);
      return { stream: new MediaStream([...v.getVideoTracks(), ...dest.stream.getAudioTracks()]), end: () => { meter(); clearInterval(paintCv); osc.stop(); ac.close(); } };
    }
    const video = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: 5, maxWidth: source.width, maxHeight: source.height } } });
    let area;
    try { area = crop ? cropped(video.getVideoTracks()[0], source, crop) : { track: video.getVideoTracks()[0], end: () => {} }; } catch (e) {
      for (const t of video.getTracks()) t.stop();
      throw e;
    }
    let voice = null;
    if (mic !== false) {
      try { voice = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) {
        area.end();
        for (const t of video.getTracks()) t.stop();
        throw new Error(micError(e, MAC));
      }
    }
    const meter = voice ? micMeter(voice) : () => {};
    return { stream: new MediaStream([area.track, ...(voice ? voice.getAudioTracks() : [])]), end: () => { meter(); area.end(); } };
  }

  // The mic icon on the floating bar (#1792): lit while the mic hears the owner, dim in silence,
  // crossed out while Windows has the mic muted. Only a change is sent. Returns its stop.
  function micMeter(stream) {
    const ac = new AudioContext(), an = ac.createAnalyser(), buf = new Float32Array(1024), track = stream.getAudioTracks()[0];
    an.fftSize = buf.length;
    ac.createMediaStreamSource(stream).connect(an);
    let lit = false, said = null;
    const tick = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      lit = micLit(micLevel(buf), lit);
      const now = track && track.muted ? 'muted' : lit ? 'live' : 'quiet';
      if (now !== said) { said = now; ui.invoke('voice', now); }
    }, 100);
    return () => { clearInterval(tick); ac.close(); };
  }

  async function start() {
    const r = await ui.invoke('start');
    if (r && r.cancel) return; // the overlay was closed without recording
    if (!r || r.error) { ui.toast(`Could not start recording: ${(r && r.error) || 'no answer'}`, true); return; }
    let got = null;
    try {
      got = await streams(r.source, r.crop, r.mic);
      const mimeType = got.stream.getAudioTracks().length ? MIME : 'video/webm;codecs=vp8';
      const rec = new MediaRecorder(got.stream, { mimeType, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 });
      cap = { id: r.id, rec, got, queue: Promise.resolve() };
      const c = cap;
      rec.ondataavailable = e => {
        if (!e.data || !e.data.size) return;
        c.queue = c.queue.then(async () => ui.invoke('chunk', c.id, new Uint8Array(await e.data.arrayBuffer())));
      };
      rec.start(1000);
    } catch (e) {
      if (got) { for (const t of got.stream.getTracks()) t.stop(); got.end(); }
      cap = null;
      await ui.invoke('abort', r.id, e.message);
      ui.toast(`Could not start recording: ${e.message}`, true);
    }
  }

  async function stop() {
    const c = cap;
    cap = null;
    if (!c) return;
    if (c.rec.state !== 'inactive') await new Promise(res => { c.rec.onstop = res; c.rec.stop(); });
    await c.queue; // the last chunk is queued before onstop
    for (const t of c.got.stream.getTracks()) t.stop();
    c.got.end();
    await ui.invoke('stop', c.id);
  }

  // After Stop the owner stays where they are (#401): processing runs in the background, the
  // button spins while it works and lights up with a badge when the review is ready.

  async function toggle() {
    if (working) return;
    working = true;
    try {
      const s = st.session;
      if (cap) await stop();
      else if (!s) await start();
      else if (s.state === 'recording') await ui.invoke('stop', s.id); // nothing is capturing it here any more
      else open();
    } finally { working = false; }
  }

  // ---------- screens ----------
  const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick }, label);

  // The open recording's card review, reached from its Review cards button (#1482).
  function body() {
    const s = st.session;
    if (!s) return h('p', {}, 'No recording.');
    // The review: the header row, then the cards, and the brainstorm beside them when open.
    const busy = s.state === 'sending', open = (s.cards || []).filter(c => c.status === 'open');
    const talking = !!st.brainstormId, marked = (s.cards || []).some(c => c.mark && c.mark !== 'unchanged' && c.status !== 'accepted');
    const bar = [
      btn('Back to recordings', () => { mode = 'list'; redraw(true); }, 'ghost recback'),
      btn('Open transcript', () => ui.invoke('open', 'transcript'), 'ghost'),
      btn('Open video', () => ui.invoke('open', 'video'), 'ghost'),
      open.length && !talking && ui.terminal ? btn('Brainstorm with CTO', () => brainstorm('cto'), 'ghost') : null,
      open.length && !talking && ui.terminal ? btn('Brainstorm with PM', () => brainstorm('pm'), 'ghost') : null,
      marked ? btn('Undo all', () => ui.invoke('undoAll'), 'ghost') : null,
      btn('Discard all', discard, 'danger'),
      open.length
        ? ui.kit.splitButton({ main: { label: 'Accept all', onClick: () => accept('all', false) }, second: { label: 'and send to CTO', onClick: () => accept('all', true) } })
        : btn('Done', () => ui.invoke('done'), 'primary'),
    ].filter(Boolean);
    if (busy) for (const b of bar) for (const x of b.tagName === 'BUTTON' ? [b] : b.querySelectorAll('button')) x.disabled = true;
    const cards = reviewScreen({ ui, st, shots, accept, zoom });
    return h('div', { class: 'recwrap' }, h('div', { class: 'plugrow recbar' }, ...bar),
      talking ? h('div', { class: 'recsplit' }, cards, brainstormPanel(st.brainstormId, s.brainstorm && s.brainstorm.who)) : cards);
  }

  // ---------- the brainstorm (stage 4) ----------
  // The session's terminal lives in one box, moved into each redraw of the screen.
  let termBox = null, termFor = null;
  async function brainstorm(who) {
    const r = await ui.invoke('brainstorm', who);
    if (!r || r.error) ui.toast(`Could not start the brainstorm: ${(r && r.error) || 'no answer'}`, true);
  }
  function brainstormPanel(sid, who) {
    if (termFor !== sid) {
      if (termFor) ui.terminal.dispose(termFor);
      termBox = h('div', { class: 'recterm' });
      termFor = sid;
      ui.terminal.mount(sid, termBox);
      setTimeout(() => ui.terminal.focus(sid), 300);
    }
    const update = async () => {
      const line = await ui.invoke('updateLine');
      if (line) await ui.terminal.type(sid, line);
    };
    return h('section', { class: 'recbs', 'aria-label': 'Brainstorm' },
      h('header', {}, h('h3', {}, `Brainstorm with the ${who === 'pm' ? 'PM' : 'CTO'}`),
        btn('Update the cards', update, 'primary'), btn('End brainstorm', () => ui.invoke('brainstormEnd'), 'ghost')),
      termBox);
  }
  // The terminal goes once its brainstorm has ended.
  const dropTerm = () => { if (termFor && !st.brainstormId) { ui.terminal.dispose(termFor); termFor = null; termBox = null; } };

  // Accept puts the cards on their boards; with send, the main CTO gets the line main wrote.
  async function accept(ids, send) {
    const r = await ui.invoke('accept', ids, send);
    if (!r || r.error) {
      ui.toast(`Could not accept: ${(r && r.error) || 'no answer'}`, true);
      // the cards placed before the failure still reach the CTO
      if (r && r.cto && !(await ui.cto(r.cto))) ui.toast('The CTO is not running, so it was not told about the cards that did go on', true);
      return;
    }
    const added = `${r.placed} ${r.placed === 1 ? 'card' : 'cards'} added to the boards`;
    if (!send) { ui.toast(added); return; }
    // It stays until closed: a short toast here was missed and the cards never reached the CTO (#2185).
    if (!r.cto) { ui.toast(`${added}. ${r.why || 'Nothing sent to the CTO.'}`, true, { label: 'OK', run() {} }); return; }
    if (!(await ui.cto(r.cto))) ui.toast(`${added}, but the CTO is not running, so it was not told`, true);
  }

  function zoom(p) {
    const img = h('img', { class: 'reczoom', alt: 'Screenshot' });
    if (shots.has(p)) img.src = shots.get(p);
    ui.kit.modal({ title: 'Screenshot', sub: p.split(/[\\/]/).pop(), body: img });
  }

  // Opens Recorded videos on the open recording, else on the newest. A review with no card left
  // to decide is finished first, so it lists as done.
  async function open() {
    if (screen) return;
    const s = st.session;
    if (s && s.state === 'review' && !(s.cards || []).some(c => c.status === 'open')) await ui.invoke('done');
    else if (s && s.state === 'review') { seen = s.id; paint(); }
    if (screen) return;
    mode = 'list'; sel = s ? s.id : null; shape = '';
    screen = ui.kit.modal({ title: 'Recorded videos', body: h('p', { class: 'sub' }, 'Loading...'), onClose: () => { screen = null; } });
    screen.el.classList.add('recvmodal');
    redraw(true);
  }

  async function discard() {
    const s = st.session, kept = (s && s.cards || []).some(c => c.status === 'accepted');
    const keep = h('input', { type: 'checkbox' });
    const ok = await ui.kit.confirm(kept
      ? { title: 'Discard the cards left?', text: 'The cards you did not accept are dropped. The ones on the boards stay, with their screenshots.', ok: 'Discard', danger: true }
      : { title: 'Discard this recording?', text: 'The cards, the video and the transcript are deleted.', ok: 'Discard', danger: true,
        extra: h('label', { class: 'reckeep' }, keep, ' Keep the recording files') });
    if (ok) await ui.invoke('discard', keep.checked);
  }

  // ---------- Recordings (#384): past ones, in Plugins > Screen recorder ----------
  const PAST_STATE = { recording: 'Recording now', processing: 'Transcribing', failed: 'Failed, waiting', review: 'Waiting for review', sending: 'Adding cards', done: 'Done', discarded: 'Discarded, files kept' };
  const when = t => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const length = r => (r.stoppedAt && r.startedAt ? (s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)(Math.round((r.stoppedAt - r.startedAt) / 1000)) : '');
  function pastRow(r, close) {
    const what = [PAST_STATE[r.state] || r.state, length(r), r.cards ? `${r.accepted} of ${r.cards} cards on the boards` : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'recpastrow', 'data-rec': r.id },
      h('span', { class: 'recwhen' }, when(r.startedAt)), h('span', { class: 'sub' }, what),
      r.current && r.state !== 'recording' ? btn('Open review', () => { close(); open(); }, 'primary') : null,
      // Real buttons with icons (#394): plain words read as text. They sit on their own line.
      h('div', { class: 'recacts' },
        r.video ? btn([ui.icon('play'), 'Play video'], () => ui.invoke('openPast', r.id, 'video'), 'recopen') : null,
        r.transcript ? btn([ui.icon('doc'), 'Open transcript'], () => ui.invoke('openPast', r.id, 'transcript'), 'recopen') : null,
        btn([ui.icon('folder'), 'Open folder'], () => ui.invoke('openPast', r.id, 'folder'), 'recopen')));
  }
  // Delete all recordings (#1030), after an "are you sure"; the one open in the recorder stays.
  async function deleteAll(fill) {
    const ok = await ui.kit.confirm({ title: 'Delete all recordings?', text: 'Every recording\'s video, sound and transcript are deleted. Board items keep their screenshots.', ok: 'Delete all', danger: true });
    if (!ok) return;
    const r = await ui.invoke('deleteAll');
    if (!r || r.error) { ui.toast(`Could not delete: ${(r && r.error) || 'no answer'}`, true); return; }
    ui.toast(`${r.deleted} ${r.deleted === 1 ? 'recording' : 'recordings'} deleted` + (r.failed ? `, ${r.failed} could not be` : '') + (r.open ? '. The one open in the recorder stays.' : ''), !!r.failed);
    fill();
  }
  ui.panel(({ close }) => {
    const box = h('section', { class: 'recpast', 'aria-label': 'Recordings' }, h('h4', {}, 'Recordings'), h('p', { class: 'sub' }, 'Loading...'));
    const fill = () => ui.invoke('list').then(list => {
      const rows = Array.isArray(list) ? list : [];
      const head = h('div', { class: 'recpasthd' }, h('h4', {}, 'Recordings'),
        rows.length ? btn([ui.icon('play'), 'Recorded videos'], () => { close(); open(); }, 'recopen recvideos') : null,
        rows.some(r => !r.current) ? btn([ui.icon('trash'), 'Delete all recordings'], () => deleteAll(fill), 'recopen recdelall') : null);
      box.replaceChildren(head, ...(rows.length ? rows.map(r => pastRow(r, close)) : [h('p', { class: 'sub' }, 'No recordings yet.')]));
    });
    fill();
    return box;
  });

  ui.button.onClick(toggle);
  ui.on('toggle', toggle);
  ui.on('state', show);
  ui.invoke('state').then(v => { if (v && !v.error) show(v); });

  return {
    unmount() {
      if (tick) clearInterval(tick);
      css.remove();
      // Switched off mid-recording: what reached the main side is kept and processed at the
      // next start; the last second or two may be lost, since the main side stops first.
      if (cap) { const c = cap; cap = null; try { c.rec.stop(); } catch { /* stopped */ } for (const t of c.got.stream.getTracks()) t.stop(); c.got.end(); }
    },
  };
}
