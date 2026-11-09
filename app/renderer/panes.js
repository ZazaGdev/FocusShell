// Panes (#1785, from app.js): a session's pane with its header, a lead's cell in a pane's
// side-by-side split, and the layout tree of panes with draggable dividers.
import { PM, isMgr } from '../lib/groups.js';
import { leadGrid, toggleLead } from '../lib/layouts.js';
import { extraId, extraOf, projectOf, nextLead, sessionName } from '../lib/sessions.js';
import { paneColour } from '../lib/projects.js';
import * as T from './terminal.js';
import * as C from './code.js';
import { h, icon, toast } from './dom.js';
import { openSketch } from './sketch.js';
import { missedButton } from './missed.js';
import { statusButton } from './status.js';
import { dragGutter } from './layout-ui.js';
import { MOD_NAME } from '../lib/platform.js';

// a: app.js's shared state and functions (S there), read when each pane is drawn.
export function panes(a) {
  function paneEl(id) {
    if (!id) return h('div', { class: 'pane empty' }, h('div', { class: 'ph' }, h('span', { class: 'pn' }, 'Empty slot')), h('div', { class: 'body' }, `${MOD_NAME}+click a tab to fill this slot`));
    const mgr = isMgr(id), leadSplits = a.leadSplits;
    // A project pane shows its first lead or, switched in the header, one of its extra leads (term).
    const lead = !mgr && id !== PM, extras = lead ? a.extrasOf(id) : [];
    const term = lead ? a.shownLead(id) : id;
    // Ctrl+click puts a lead in the pane's side-by-side split or takes it out (#1554); a plain click
    // shows that lead alone.
    const grid = lead && !a.collapsed.has(id) ? a.splitLeads(id) : null;
    const swBtn = (n, s) => h('button', { class: (term === s ? 'on' : '') + ((leadSplits[id] || []).includes(n) ? ' insplit' : ''),
      title: `${sessionName(s)}. ${MOD_NAME}+click to show it side by side with the others`, onclick: async e => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          const r = toggleLead(leadSplits[id], extraOf(term) ? extraOf(term).n : 1, n);
          if (r.split) leadSplits[id] = r.split; else delete leadSplits[id];
          a.showN(id, r.show); a.render(); return;
        }
        delete leadSplits[id];
        a.showN(id, n); if (n === 1) await a.ensureSession(id); a.render();
      } }, a.dot(s), String(n));
    // "+<n>" starts the next free lead, up to five a project (#1485).
    const next = lead ? nextLead(k => a.started.has(extraId(id, k))) : null;
    const add = !next ? null : h('button', { class: 'two', title: `Start lead ${next} on this project`, onclick: e => {
      e.stopPropagation();
      e.currentTarget.replaceWith(h('span', { class: 'leads pick' },
        h('button', { title: 'The leads share the project folder, on files that do not overlap', onclick: () => a.openExtra(id, next, false) }, 'Same folder'),
        h('button', { title: `Lead ${next} gets its own git worktree, removed when it closes`, onclick: () => a.openExtra(id, next, true) }, 'Own worktree')));
    } }, `+${next}`);
    const two = !lead ? null : extras.length ? h('span', { class: 'leads' }, swBtn(1, id), ...extras.map(n => swBtn(n, extraId(id, n))), add) : add;
    const folded = a.collapsed.has(id);
    const foldBtn = !mgr && a.view === 'split'
      ? h('button', { class: 'fold', title: folded ? 'Expand' : 'Collapse', onclick: e => { e.stopPropagation(); folded ? a.collapsed.delete(id) : a.collapsed.add(id); a.render(); } }, icon('fold'))
      : null;
    const find = h('button', { class: 'find', title: `Find in this pane (${MOD_NAME}+Shift+F)`, onclick: e => { e.stopPropagation(); T.openFind(term); } }, icon('search'));
    const top = h('button', { title: 'Jump to top (Ctrl+Home)', onclick: () => T.jumpToTop(term) }, icon('top'));
    const last = h('button', { title: 'Jump to your last prompt', onclick: () => { if (!T.jumpToLastPrompt(term)) toast('No prompt sent in this pane yet, or it has scrolled out of the history'); } }, icon('lastprompt'));
    const who = mgr ? a.mgrName(id) : id === PM ? 'the PM' : sessionName(term);
    const sketch = h('button', { class: 'sketch', title: `Sketch: draw something into ${who}'s prompt`, onclick: () => openSketch(term, who, () => T.focus(term)) }, icon('pen'));
    const end2 = lead && term !== id ? h('button', { title: `End ${who}`, onclick: () => { if (confirm(`End ${who}?`)) a.closeExtra(id, extraOf(term).n); } }, icon('x')) : null;
    // Every project pane opens or closes VS Code beside itself, like the tab's </> button.
    const code = mgr || id === PM ? null : h('button', { class: C.isOpen(id) ? 'on' : '', title: C.isOpen(id) ? 'Close VS Code' : 'Open VS Code beside the lead',
      onclick: () => { if (C.isOpen(id)) C.closeCode(id); else C.openCode(id, a.deck, a.render); a.render(); } }, icon('code'));
    const acts = h('span', { class: 'pa' }, mgr ? a.wbButton(id) : null, mgr && a.settings.showMissed ? missedButton(id) : null, mgr ? statusButton(id) : null, foldBtn, find, top, last, code, sketch, end2,
      !mgr && a.view === 'split' ? h('button', { title: 'Open on its own', onclick: () => { a.view = 'single'; a.single = id; a.render(); } }, icon('popout')) : null,
      !mgr && a.view === 'split' ? h('button', { title: 'Remove from split', onclick: () => a.toggleInSplit(id) }, icon('x')) : null);
    const head = h('div', { class: 'ph', ondblclick: () => { if (!mgr) { a.view = 'single'; a.single = id; a.render(); } } },
      a.dot(term), lead ? h('span', { class: 'pn link', title: `Open the ${id} project page`, onclick: e => { e.stopPropagation(); a.openProjectPage(id); } }, id)
        : h('span', { class: 'pn' }, mgr ? a.mgrName(id) : id), two, h('span', { class: 'lbl', 'data-lbl': term }, a.labelOf(term)), acts);
    const body = h('div', { class: 'body' + (grid ? ' leadsplit' : '') });
    const el = h('div', { class: 'pane' + (mgr ? ' manager' : '') + (folded ? ' collapsed' : '') + (a.focused === id ? ' focus' : ''), style: `--pc:${mgr ? 'var(--accent)' : id === PM ? 'var(--me)' : `var(--p${paneColour(id, 8)})`}`, onmousedown: () => {
      a.focused = id; document.querySelectorAll('.pane').forEach(x => x.classList.remove('focus')); el.classList.add('focus');
    } }, head, body);
    // Each lead in the grid shows its own ended state.
    if (grid) body.append(buildTree(leadGrid(grid.length), grid, `leads:${grid.join(',')}`, leadCell));
    else T.mount(term, body);
    if (!grid && T.isExited(term) && T.shellLive(term)) body.append(h('div', { class: 'endbar' }, h('span', {}, 'Claude has exited. This pane is a shell now.'), h('button', { class: 'btn primary', onclick: () => a.restart(term) }, 'Restart')));
    else if (!grid && T.isExited(term)) body.append(h('div', { class: 'overlay' }, h('div', {}, h('p', {}, 'This session has ended.'), h('button', { class: 'btn primary', onclick: () => a.restart(term) }, 'Restart'))));
    if (!lead || folded || !C.isOpen(id)) return el;
    return C.beside(id, el, { h, icon, dragGutter, onClose: () => { C.closeCode(id); a.render(); }, onExternal: () => a.deck.openInCode(id),
      onRetry: () => { C.closeCode(id); C.openCode(id, a.deck, a.render); a.render(); } });
  }
  // Divider positions dragged this run, per layout, panes and split (#189), so a redraw such
  // as opening VS Code keeps them instead of going back to the layout's fractions.
  const dragged = new Map();
  // One lead in a pane's side-by-side split (#1554): its number and state above its terminal. A
  // click on it makes it the lead the pane's header acts on.
  function leadCell(s) {
    const project = projectOf(s), n = extraOf(s) ? extraOf(s).n : 1, body = h('div', { class: 'body' });
    const el = h('div', { class: 'leadcell' + (a.shownLead(project) === s ? ' on' : ''), onmousedown: () => {
      if (a.shownLead(project) !== s) { a.showN(project, n); a.render(); T.focus(s); }
    } }, h('div', { class: 'lch' }, a.dot(s), h('span', { class: 'ln' }, String(n)), h('span', { class: 'lbl', 'data-lbl': s }, a.labelOf(s))), body);
    T.mount(s, body);
    if (T.isExited(s)) body.append(h('div', { class: 'overlay' }, h('div', {}, h('p', {}, 'This session has ended.'), h('button', { class: 'btn primary', onclick: () => a.restart(s) }, 'Restart'))));
    return el;
  }
  function buildTree(node, names, key = names.join(','), slot = paneEl) {
    if (node === 'M') {
      // The context's manager; a group's manager starts here if it is not running yet.
      const m = a.curMgr();
      if (!a.started.has(m)) a.ensureSession(m).then(ok => ok && a.updateLive());
      return paneEl(m);
    }
    if (typeof node === 'number') return slot(names[node]);
    const [dir, kids] = node, wrap = h('div', { class: 'split' + (dir === 'v' ? ' v' : '') });
    const saved = dragged.get(key), fracs = saved && saved.length === kids.length ? saved : kids.map(k => k[1]);
    const cellEls = [];
    // After a drag, each open cell keeps its share of the space the open cells had.
    const remember = () => {
      const open = cellEls.map((c, i) => /folded-/.test(c.className) ? null : i).filter(i => i !== null);
      const px = open.map(i => { const r = cellEls[i].getBoundingClientRect(); return dir === 'v' ? r.height : r.width; });
      const total = px.reduce((x, y) => x + y, 0), share = open.reduce((x, i) => x + fracs[i], 0);
      if (!total) return;
      const next = [...fracs];
      open.forEach((i, j) => { next[i] = px[j] / total * share; });
      dragged.set(key, next);
    };
    kids.forEach(([child], i) => {
      if (i > 0) { const g = h('div', { class: 'gutter' }); dragGutter(g, dir, remember); wrap.append(g); }
      const leaf = typeof child === 'number' ? names[child] : null;
      const fold = leaf && a.collapsed.has(leaf);
      const cell = h('div', { class: 'cell' + (fold ? ' folded-' + dir : ''), style: fold ? `flex:0 0 ${dir === 'v' ? 31 : 34}px` : `flex:${fracs[i] * 100} 1 0` }, buildTree(child, names, `${key}/${i}`, slot));
      cellEls.push(cell); wrap.append(cell);
    });
    return wrap;
  }
  return { buildTree };
}
