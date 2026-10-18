// A filter dropdown like Azure Boards' (#293): a button naming what is picked, opening a list
// with a search box, a checkbox per option and Clear; with setMode, also Or / And. It stays
// open across the board's redraws until a click lands outside it.
// One open at a time (#1098): opening one closes the rest; Esc or a click outside closes any.
const openIds = new Set(), queries = new Map();
const closeAll = except => { for (const id of [...openIds]) if (id !== except) { document.querySelector(`.fdrop[data-fd="${id}"] .fdpop`)?.classList.remove('open'); openIds.delete(id); } };
document.addEventListener('click', e => { if (!e.target.closest('.fdrop')) closeAll(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && openIds.size) closeAll(); });

// o: { h, id, label, options: [{ value, label, count }], picked: [value], onChange(picked),
//      mode, setMode(mode) }
export function filterDrop(o) {
  const { h } = o, picked = o.picked || [];
  const name = v => (o.options.find(x => x.value === v) || { label: String(v) }).label;
  const shown = !picked.length ? o.label : picked.length === 1 ? `${o.label}: ${name(picked[0])}` : `${o.label}: ${picked.length}`;
  const q = queries.get(o.id) || '';
  const list = h('div', { class: 'fdlist' });
  const fill = text => list.replaceChildren(...o.options.filter(x => !text || x.label.toLowerCase().includes(text.toLowerCase())).map(x =>
    h('label', { class: 'bpopt' }, h('input', { type: 'checkbox', checked: picked.includes(x.value),
      onchange: e => o.onChange(e.target.checked ? [...picked, x.value] : picked.filter(v => v !== x.value)) }),
    h('span', {}, x.label), x.count != null ? h('small', {}, String(x.count)) : null)));
  fill(q);
  if (!list.children.length) list.append(h('div', { class: 'empty-note' }, 'No match'));
  const search = h('input', { class: 'fdsearch', placeholder: 'Search', value: q, oninput: e => { queries.set(o.id, e.target.value); fill(e.target.value); } });
  const modes = o.setMode ? h('span', { class: 'fdmode', title: 'Or: items with any picked one. And: items with all of them.' },
    ['or', 'and'].map(m => h('button', { class: 'chip' + ((o.mode || 'or') === m ? ' on' : ''), onclick: () => o.setMode(m) }, m === 'or' ? 'Or' : 'And'))) : null;
  const pop = h('div', { class: 'pop left fdpop' + (openIds.has(o.id) ? ' open' : '') },
    h('div', { class: 'fdtop' }, search, modes), list,
    h('div', { class: 'fdfoot' }, h('button', { class: 'ptool', disabled: !picked.length, onclick: () => o.onChange([]) }, 'Clear')));
  const btn = h('button', { class: 'bsel' + (picked.length ? ' on' : ''), title: `Filter by ${o.label.toLowerCase()}`, onclick: e => {
    e.stopPropagation();
    const now = !pop.classList.contains('open');
    pop.classList.toggle('open', now);
    if (now) { closeAll(o.id); openIds.add(o.id); search.focus(); } else openIds.delete(o.id);
  } }, shown, h('span', { class: 'bcaret' }, '▾'));
  return h('span', { class: 'wrap fdrop', 'data-fd': o.id }, btn, pop);
}
