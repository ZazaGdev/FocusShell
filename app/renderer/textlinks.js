// File paths and web links inside an item's text, clickable (#207). A text file opens in the
// built-in Code pane (openFile); a web link, a folder or a binary file opens as the terminal's
// links do. A path with spaces is stretched to the longest reading that exists on disk.
import { h } from './dom.js';
import { findLinks, stretchCandidates, textParts, opensInExplorer } from '../lib/links.js';

// openFile(path) opens a file in the Code pane and is true if it did; before() runs first.
export function linkedText(tag, attrs, text, { openFile, toast, before } = {}) {
  const s = String(text || ''), el = h(tag, attrs);
  const draw = links => el.replaceChildren(...textParts(s, links).map(p => !p.link ? p.text
    : h('a', { class: 'tlink', href: '#', title: `Open ${p.text} (right-click for its folder)`, onclick: e => { e.preventDefault(); open(p.text); },
      oncontextmenu: /^https?:/i.test(p.text) ? null : e => folderMenu(e, p.text) }, p.text)));
  const open = target => openTarget(target, { openFile, toast, before });
  const links = findLinks(s);
  draw(links);
  const stretch = links.map((l, i) => ({ l, i, c: stretchCandidates(s, l) })).filter(x => x.c.length);
  if (stretch.length) Promise.all(stretch.map(async ({ l, i, c }) => {
    const best = await window.deck.longestPath([l.text, ...c]);
    if (best && best.length > l.text.length) { links[i] = { ...l, text: best }; return true; }
    return false;
  })).then(changed => { if (changed.some(Boolean)) draw(links); }, () => {});
  return el;
}

async function openTarget(target, { openFile, toast, before } = {}) {
  const web = /^https?:/i.test(target);
  const file = !web && openFile && !opensInExplorer(target) ? await window.deck.fileAt(target) : null;
  if (file && before) before();
  const ok = file ? await openFile(file) : await window.deck.openPath(target);
  if (!ok && toast) toast(`Can't find ${target}`, true);
}

// A question card's links and files as chips (#416): the newest few, then "+N more" for the
// rest. links: cardLinks(task). Null when there are none.
export function linkChips(links, { max = 3, ...opts } = {}) {
  if (!links || !links.length) return null;
  const chip = l => h('a', { class: 'lchip' + (l.file ? ' file' : ''), href: '#', title: l.href,
    onclick: e => { e.preventDefault(); e.stopPropagation(); openTarget(l.href, opts); },
    oncontextmenu: l.file ? e => folderMenu(e, l.href) : null }, l.label);
  const el = h('div', { class: 'lchips' }, links.slice(0, max).map(chip));
  if (links.length > max) {
    const more = h('button', { class: 'lchip more', title: 'Show every link', onclick: e => { e.stopPropagation(); more.replaceWith(...links.slice(max).map(chip)); } }, `+${links.length - max} more`);
    el.append(more);
  }
  return el;
}

// Right-click on a file link (#292): "Open containing folder" shows it selected in Explorer.
let menu = null;
const closeMenu = () => { if (!menu) return; menu.remove(); menu = null; removeEventListener('mousedown', outside, true); removeEventListener('keydown', esc, true); };
const outside = e => { if (menu && !menu.contains(e.target)) closeMenu(); };
const esc = e => { if (e.key === 'Escape') closeMenu(); };
export function folderMenu(e, target) {
  e.preventDefault(); e.stopPropagation();
  closeMenu();
  menu = h('div', { class: 'tabmenu linkmenu' }, h('div', { class: 'tml', title: target }, target),
    h('button', { class: 'tmi', onclick: () => { closeMenu(); window.deck.openPath(target); } }, 'Open containing folder'));
  menu.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - 330))}px`; menu.style.top = `${Math.min(e.clientY + 2, innerHeight - 80)}px`;
  document.body.append(menu);
  addEventListener('mousedown', outside, true); addEventListener('keydown', esc, true);
}
