// Plugins on the page (#369): a title bar button for each switched-on plugin, each plugin's
// page side mounted with its ui object, and the Settings cards built from the manifests.
// The list comes from the main side (plugins-host.js) and follows it as it changes.
import { PAGES } from '../plugins/pages.js';
import { kitFor, modal } from './plugin-ui.js';
import { parseShortcutInput } from '../lib/plugins.js';

const mounted = new Map(); // id: { btn, caret, unmount, offs }
let items = [], c = null, screen = null, slot = null;

// A plugin switched on or off, its other saved settings kept. `on` is what it is now: an entry
// saved for a setting change must not switch a plugin that is on by default off (#2919).
const withPlugin = (saved, id, patch, on = false) => {
  const cur = saved[id] || {};
  return { ...saved, [id]: { settings: {}, ...cur, on: typeof cur.on === 'boolean' ? cur.on : on, ...patch } };
};
const isOn = id => !!(items.find(x => x.manifest.id === id) || {}).on;

// ctx: { h, icon, deck, toast, bar (the element buttons go before), onChange(), cto(line),
//        settings() the app's settings, save(settings), openSettings(section) }
export async function startPlugins(ctx) {
  c = ctx;
  // The Plugins button is hidden for now (#2919): the recorder shows as a feature of its own and
  // its Record button takes the place Plugins had. This empty slot marks that place, and each
  // plugin's button goes before it. To bring Plugins back, add a button that calls openPlugins
  // (below, kept for that) before the slot.
  slot = c.h('span', { class: 'plugslot' });
  c.bar.before(slot);
  c.deck.plugin.onChanged(sync);
  sync(await c.deck.plugin.list());
}

function sync(list) {
  items = Array.isArray(list) ? list : [];
  for (const it of items) (it.live ? mount : unmount)(it);
  if (screen) screen.draw();
  if (c.onChange) c.onChange();
}

// The Plugins screen (#377): the list of plugins, each with Open; Open shows that plugin's own
// screen, what it does and its controls. Both follow the list as plugins switch on and off.
// Nothing opens it while Plugins is hidden (#2919).
function openPlugins() {
  const { h, icon } = c;
  let shown = null; // the opened plugin's id, or null for the list
  const draw = () => {
    const it = shown && items.find(x => x.manifest.id === shown);
    if (shown && !it) shown = null;
    m.setBody(it ? one(it) : list());
  };
  const state = it => it.error && it.on ? 'Off: it failed' : it.on ? 'On' : 'Off';
  // The whole row opens the plugin (#1030); a manifest's icon shows before its name.
  const list = () => h('div', { class: 'plugslist' }, items.length ? items.map(it => h('div', { class: 'plugsrow', role: 'button', tabindex: '0',
    onclick: () => { shown = it.manifest.id; draw(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shown = it.manifest.id; draw(); } } },
    it.manifest.icon ? h('span', { class: 'plugsicon' }, icon(it.manifest.icon)) : null,
    h('div', { class: 'plugsname' }, h('b', {}, it.manifest.name), h('span', {}, state(it))),
    h('button', { class: 'btn', tabindex: '-1' }, 'Open')))
    : h('p', { class: 'sub' }, 'No plugins in this FocusShell.'));
  const one = it => {
    const id = it.manifest.id, live = mounted.get(id);
    const flip = () => c.save({ ...c.settings(), plugins: withPlugin(c.settings().plugins || {}, id, { on: !it.on }, it.on) });
    return h('div', { class: 'plugsone' },
      h('button', { class: 'btn ghost back', onclick: () => { shown = null; draw(); } }, '← All plugins'),
      h('h3', {}, it.manifest.name),
      h('p', {}, it.manifest.description),
      it.error || it.clash ? h('p', { class: 'plugerr' }, it.error || it.clash) : null,
      h('div', { class: 'plugsctl' },
        // The switch names what it is (#394): a bare "On" beside Start read as a second action.
        h('label', { class: 'plugon' },
          h('button', { class: 'sw' + (it.on ? ' on' : ''), role: 'switch', 'aria-checked': it.on ? 'true' : 'false', onclick: flip }),
          it.on ? 'Plugin on' : 'Plugin off'),
        h('span', { class: 'plugsep' }),
        // The same action as its title bar button, named for what a click does now (#394): a
        // plain "Start" stopped a running recording.
        (bs => h('button', { class: 'btn primary plugstart', 'data-plugin': id, 'data-state': bs, disabled: !live || bs === 'busy', title: live ? it.manifest.button.title : 'Switch it on first',
          onclick: () => { m.close(); live.btn.click(); } }, icon(it.manifest.button.icon), (it.manifest.button.labels || {})[bs] || 'Start'))(live ? live.btn.dataset.state : 'idle'),
        it.shortcut ? h('span', { class: 'plugkeys', title: 'Its shortcut, which works even when FocusShell is not in front' }, 'or ',
          it.shortcut.split('+').map(k => ({ Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl' })[k] || k)
            .flatMap((k, i) => [i ? '+' : null, h('kbd', {}, k)])) : null),
      live && live.panel ? panelOf(live, { close: () => m.close() }) : null);
  };
  const m = modal(h, icon, { title: 'Plugins', onClose: () => { screen = null; } });
  m.el.classList.add('plugsmodal');
  screen = { draw };
  draw();
}

// A plugin's own part of its Settings card (ui.panel); one that throws shows its message.
// arg: what the panel is given ({ close, opt }).
function panelOf(live, arg) {
  try { return live.panel(arg) || null; } catch (e) { return c.h('p', { class: 'plugerr' }, e.message); }
}

function mount(it) {
  const id = it.manifest.id, page = PAGES[id];
  if (mounted.has(id) || !page) return;
  const { h, icon, deck } = c;
  const label = h('span', { class: 'plugl' });
  const btn = h('button', { class: 'iconbtn plugbtn', 'data-plugin': id, 'data-state': 'idle',
    title: it.manifest.button.title + (it.shortcut ? ` (${it.shortcut})` : '') }, icon(it.manifest.button.icon), label);
  (slot || c.bar).before(btn); // where Plugins was (#2919)
  const kit = kitFor(h, icon, deck);
  const m = { btn, caret: null, closeMenu: () => {}, unmount: null, offs: [], kit };
  mounted.set(id, m);
  const ui = {
    id, h, icon, toast: c.toast, kit,
    button: {
      el: btn,
      set: (state, text = '') => {
        const moved = btn.dataset.state !== state;
        btn.dataset.state = state; label.textContent = text;
        if (moved && screen) screen.draw(); // its Plugins screen names the new action
      },
      onClick: fn => { btn.onclick = fn; },
      // An arrow beside the button that opens a menu (#2919): fn() returns the rows when it opens,
      // [{ label, icon, hint, run }], null rows skipped. tip is the arrow's tooltip.
      menu: (fn, tip = 'More') => menuFor(m, btn, id, fn, tip),
    },
    // Opens Settings at this plugin's own section, and its current shortcut (null when none).
    openSettings: () => { if (c.openSettings) c.openSettings(it.manifest.name); },
    shortcut: () => (items.find(x => x.manifest.id === id) || {}).shortcut || null,
    invoke: (name, ...args) => deck.plugin.invoke(id, name, ...args),
    on: (event, fn) => { const off = deck.plugin.on(id, event, fn); m.offs.push(off); return off; },
    settings: () => (items.find(x => x.manifest.id === id) || {}).settings || {},
    // Its own rows at the end of its Settings card: fn({ close, opt }) returns an element (#384,
    // drawn in Settings since #2919); opt(label, help, control) is Settings' own row.
    panel: fn => { m.panel = typeof fn === 'function' ? fn : null; },
    fake: it.fake === true, // the hidden smoke run: fake what is recorded
  };
  // A line for the main CTO, typed into its pane as the owner's words (held while the owner is
  // writing there). Resolves false when the CTO is not running. Only for a plugin that uses cto.
  if ((it.manifest.uses || []).includes('cto') && c.cto) ui.cto = line => c.cto(String(line));
  // A session the plugin started (its sessions service, #369 stage 4) shown in its own screen:
  // the app's terminal for that id, and a line typed into it as the owner's words.
  if ((it.manifest.uses || []).includes('sessions') && c.terminal) {
    const ok = sid => /^brainstorm-(cto|pm)$/.test(String(sid));
    ui.terminal = {
      mount: (sid, el) => { if (ok(sid)) c.terminal.mount(sid, el); },
      focus: sid => { if (ok(sid)) c.terminal.focus(sid); },
      dispose: sid => { if (ok(sid)) c.terminal.dispose(sid); },
      type: (sid, line) => (ok(sid) ? c.terminal.type(sid, String(line)) : Promise.resolve(false)),
    };
  }
  try {
    const r = page.mount(ui);
    m.unmount = r && typeof r.unmount === 'function' ? r.unmount : null;
  } catch (e) {
    for (const off of m.offs) try { off(); } catch { /* going anyway */ }
    kit.closeAll();
    m.closeMenu();
    if (m.caret) m.caret.remove();
    btn.remove();
    mounted.delete(id);
    c.toast(`${it.manifest.name} could not start on the page: ${e.message}`);
  }
}

function unmount(it) {
  const id = it.manifest.id, m = mounted.get(id);
  if (!m) return;
  mounted.delete(id);
  for (const off of m.offs) off();
  if (m.unmount) try { m.unmount(); } catch { /* it is going anyway */ }
  m.kit.closeAll();
  m.closeMenu();
  if (m.caret) m.caret.remove();
  m.btn.remove();
}

// The arrow beside a plugin's button and the menu it opens (#2919). The rows are asked for each
// time it opens, so counts and labels are current. The menu is a small popover under the arrow,
// built with h(); a row click runs it and closes it; Escape, a click elsewhere or a resize close it.
function menuFor(m, btn, id, fn, tip) {
  const { h, icon } = c;
  m.closeMenu();
  if (m.caret) { m.caret.remove(); m.caret = null; }
  if (typeof fn !== 'function') return;
  let pop = null, off = null;
  const caret = h('button', { class: 'iconbtn plugcaret', 'data-plugin': id, title: tip, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: e => { e.stopPropagation(); if (pop) close(); else open(); } }, icon('down'));
  const close = () => {
    if (off) { off(); off = null; }
    if (pop) { pop.remove(); pop = null; }
    caret.setAttribute('aria-expanded', 'false');
    caret.classList.remove('on');
  };
  const run = it => {
    close();
    try {
      const r = it.run();
      if (r && typeof r.catch === 'function') r.catch(e => c.toast(e.message, true));
    } catch (e) { c.toast(e.message, true); }
  };
  function open() {
    let rows = [];
    try { rows = (fn() || []).filter(Boolean); } catch (e) { c.toast(e.message, true); return; }
    if (!rows.length) return;
    const r = caret.getBoundingClientRect();
    pop = h('div', { class: 'plugmenu', role: 'menu', style: `top:${Math.round(r.bottom + 4)}px;right:${Math.max(6, Math.round(innerWidth - r.right))}px` },
      rows.map(it => h('button', { class: 'mitem', role: 'menuitem', onclick: () => run(it) },
        it.icon ? icon(it.icon) : null, h('span', {}, it.label), it.hint ? h('small', {}, it.hint) : null)));
    document.body.append(pop);
    caret.setAttribute('aria-expanded', 'true');
    caret.classList.add('on');
    const away = e => { if (pop && !pop.contains(e.target) && !caret.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    addEventListener('resize', close);
    addEventListener('blur', close); // a click inside a webview (the Code pane) never reaches the page
    off = () => { document.removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); removeEventListener('resize', close); removeEventListener('blur', close); };
  }
  btn.after(caret);
  m.caret = caret;
  m.closeMenu = close;
}

// A setting picked from a dropdown of what the plugin found on this PC (#407), never typed: the
// current value first (marked when it would not work), then the rest, then Choose... when the
// manifest gives `pick`, which opens a folder or file dialog.
const CHOOSE = '::choose::';
function listedField(id, f, value, putSetting) {
  const { h, deck } = c;
  const sel = h('select', { class: 'inp listed', 'data-key': f.key, onchange: async e => {
    if (e.target.value !== CHOOSE) { putSetting(id, f.key, e.target.value); return; }
    const p = await deck.plugin.invoke(id, 'pickPath', f.key);
    if (typeof p === 'string' && p) putSetting(id, f.key, p); else e.target.value = value ?? '';
  } }, h('option', { value: value ?? '' }, value ?? ''));
  deck.plugin.invoke(id, 'choices', f.key).then(list => {
    if (!Array.isArray(list)) return;
    const opts = list.map(ch => h('option', { value: ch.value, selected: ch.value === value, class: ch.ok ? '' : 'bad' }, ch.label));
    if (!list.some(ch => ch.value === value)) opts.unshift(h('option', { value: value ?? '', selected: true }, value || 'none'));
    if (f.pick) opts.push(h('option', { value: CHOOSE }, f.pick === 'file' ? 'Choose a file...' : 'Choose a folder...'));
    sel.replaceChildren(...opts);
  });
  return sel;
}

// The Settings cards, one per plugin, named for it (#2919). s: the settings; set(patch) saves; opt
// and toggle are the page's own. A live plugin's ui.panel rows go at the end of its card. No
// plugins, no cards.
export function pluginSection({ h, opt, toggle, settings: s, set }) {
  const saved = s.plugins || {};
  const put = (id, patch) => set({ plugins: withPlugin(saved, id, patch, isOn(id)) });
  const putSetting = (id, key, v) => put(id, { settings: { ...((saved[id] || {}).settings || {}), [key]: v } });
  const field = (id, f, value) => {
    if (f.type === 'toggle') return toggle(value === true, v => putSetting(id, f.key, v));
    if (f.type === 'choice') return h('select', { class: 'inp', onchange: e => putSetting(id, f.key, e.target.value) },
      f.choices.map(ch => h('option', { value: ch, selected: ch === value }, ch)));
    if (f.listed && mounted.has(id)) return listedField(id, f, value, putSetting);
    return h('input', { class: 'inp', value: value ?? '', onchange: e => putSetting(id, f.key, e.target.value) });
  };
  return items.map(it => {
    const m = it.manifest, id = m.id, rows = [opt('Switched on', m.description, toggle(it.on, v => put(id, { on: v })))];
    if (it.error || it.clash) rows.push(h('p', { class: 'plugerr' }, it.error && it.on ? `Off for this run: ${it.error}. Switch it off and on to try again.` : it.error || it.clash));
    if (it.on) {
      const badKey = h('p', { class: 'plugerr' }, 'not a valid shortcut');
      badKey.hidden = true;
      rows.push(opt('Shortcut', 'Works even when FocusShell is not in front. Empty: none',
        h('input', { class: 'inp', value: it.shortcut || '', placeholder: 'Control+Alt+R', onchange: e => {
          const v = parseShortcutInput(e.target.value);
          if (v === null) { badKey.hidden = false; return; }
          badKey.hidden = true;
          e.target.value = v;
          put(id, { shortcut: v || null });
        } })), badKey);
      for (const f of m.settings || []) rows.push(opt(f.label, f.help || '', field(id, f, it.settings[f.key])));
    }
    const live = it.live ? mounted.get(id) : null;
    return h('section', { class: 'pcard' }, h('h2', {}, m.name), rows,
      live && live.panel ? panelOf(live, { close() {}, opt }) : null);
  });
}
