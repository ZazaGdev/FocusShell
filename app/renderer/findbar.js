// Find in a pane (#360): a small bar at the top right of the terminal that searches its whole
// scrollback with xterm's search add-on, highlights every match and counts them. Ctrl+Shift+F
// or the pane's search button opens it; Enter and Shift+Enter (or the arrow keys) go to the
// next and previous match; Esc closes it and gives the terminal its focus back.
import { SearchAddon } from '../node_modules/@xterm/addon-search/lib/addon-search.mjs';
import { h, icon } from './dom.js';

const DECOR = {
  matchBackground: '#4a3d14', matchBorder: '#8a6d24', matchOverviewRuler: '#d9a54a',
  activeMatchBackground: '#9a6c0c', activeMatchBorder: '#ffd27a', activeMatchColorOverviewRuler: '#ffd27a',
};

export function findBar(term) {
  const search = new SearchAddon();
  term.loadAddon(search);
  let caseOn = false, wordOn = false;
  const input = h('input', { type: 'text', placeholder: 'Find in this pane', spellcheck: 'false', 'aria-label': 'Find in this pane' });
  const count = h('span', { class: 'fcount' });
  const opts = incremental => ({ caseSensitive: caseOn, wholeWord: wordOn, incremental, decorations: DECOR });
  const go = (back, incremental = false) => {
    const q = input.value;
    if (!q) { search.clearDecorations(); count.textContent = ''; return; }
    if (back) search.findPrevious(q, opts(false)); else search.findNext(q, opts(incremental));
  };
  search.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (!input.value) { count.textContent = ''; return; }
    count.textContent = !resultCount ? 'No matches' : resultIndex < 0 ? `${resultCount}+ matches` : `${resultIndex + 1} of ${resultCount}`;
    el.classList.toggle('none', !resultCount);
  });
  const toggle = (label, title, get, set) => {
    const b = h('button', { class: 'ftog', title, 'aria-pressed': 'false', onclick: () => { set(!get()); b.classList.toggle('on', get()); b.setAttribute('aria-pressed', String(get()));
      // The add-on keeps its matches for the same words; cleared, it counts them again.
      search.clearDecorations(); go(false, true); input.focus(); } }, label);
    return b;
  };
  const caseBtn = toggle('Aa', 'Match case', () => caseOn, v => { caseOn = v; });
  const wordBtn = toggle('W', 'Whole word', () => wordOn, v => { wordOn = v; });
  const prev = h('button', { title: 'Previous match (Shift+Enter)', onclick: () => { go(true); input.focus(); } }, icon('up'));
  const next = h('button', { title: 'Next match (Enter)', onclick: () => { go(false); input.focus(); } }, icon('down'));
  const shut = h('button', { title: 'Close (Esc)', onclick: () => close() }, icon('x'));
  const el = h('div', { class: 'findbar', onmousedown: e => e.stopPropagation() }, input, count, caseBtn, wordBtn, prev, next, shut);
  input.addEventListener('input', () => go(false, true));
  input.addEventListener('keydown', e => {
    // Keys typed here stay here: the app's own shortcuts and the terminal never see them.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(false); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(true); }
  });

  function open() {
    const sel = term.getSelection();
    if (sel && !sel.includes('\n') && sel.length <= 200) input.value = sel;
    el.classList.add('open');
    input.focus(); input.select();
    if (input.value) go(false, true);
  }
  function close() {
    el.classList.remove('open', 'none');
    search.clearDecorations();
    term.clearSelection();
    term.focus();
  }
  return { el, open, close, isOpen: () => el.classList.contains('open') };
}
