// Home "Groups" section: one card per group (its layout, projects and CTO), the
// Last session card, and two cards that make a new group (#1024): Save what is open (one
// click, the projects on screen) and New group... (a card of project chips to tick).

// Open and catch up (#1025), beside Open.
const CATCH_TIP = 'Open, then every lead and the CTO get a recap of where each project stands and where work stopped yesterday';
let picking = null; // the New group card while it is open: { sel, name, named }

// A group's name, renamed by clicking it.
function nameEl(h, g, rename) {
  const el = h('span', { class: 'gname', title: 'Click to rename', onclick: () => {
    const box = h('input', { class: 'grename', value: g.name, onkeydown: e => {
      if (e.key === 'Enter') box.blur();
      if (e.key === 'Escape') { box.value = g.name; box.blur(); }
    }, onblur: () => rename(g.name, box.value) });
    el.replaceWith(box); box.focus(); box.select();
  } }, g.name);
  return el;
}

function pickerCard(c) {
  const { h, icon, groups } = c;
  const inGroup = n => (groups.find(x => x.projects.includes(n)) || {}).name;
  const name = h('input', { class: 'grename', value: picking.name, placeholder: 'Name', oninput: () => { picking.name = name.value; picking.named = true; },
    onkeydown: e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { picking = null; c.rerender(); } } });
  const create = () => { if (c.createGroup(picking.name || c.suggestName(picking.sel), picking.sel)) picking = null; };
  return h('div', { class: 'preset gpick' },
    h('div', { class: 'pbody' },
      h('div', { class: 'pname' }, 'New group ', name),
      h('div', { class: 'pproj' }, c.codeProjects.map(n => h('button', { class: 'gchip' + (picking.sel.includes(n) ? ' on' : ''),
        title: inGroup(n) ? `In ${inGroup(n)}: ticking it moves it here` : '', onclick: () => {
          picking.sel = picking.sel.includes(n) ? picking.sel.filter(x => x !== n) : [...picking.sel, n];
          if (!picking.named) picking.name = c.suggestName(picking.sel);
          c.rerender();
        } }, picking.sel.includes(n) ? icon('check') : null, n, inGroup(n) ? h('small', {}, inGroup(n)) : null)))),
    h('div', { class: 'pacts' },
      h('button', { class: 'btn primary', onclick: create }, 'Create'),
      h('button', { class: 'btn ghost', onclick: () => { picking = null; c.rerender(); } }, 'Cancel')));
}

export function groupsSection(c) {
  const { h, icon, miniTree, groups, projects } = c;
  const cards = [];
  if (c.prevSession) {
    const p = c.prevSession;
    cards.push(h('div', { class: 'preset' },
      h('div', { class: 'pv' }, miniTree(c.lastLayout(p).tree)),
      h('div', { class: 'pbody' }, h('div', { class: 'pname' }, p.name), h('div', { class: 'pproj' }, p.projects.map(n => h('span', { class: 'ptag' }, n)))),
      h('div', { class: 'pacts' }, h('button', { class: 'btn primary', onclick: () => c.openLastSession(p) }, 'Open'),
        h('button', { class: 'btn', title: CATCH_TIP, onclick: () => c.openLastSession(p, true) }, 'Open and catch up'))));
  }
  for (const g of groups) {
    const others = projects.filter(p => !g.projects.includes(p.name));
    const inGroup = n => (groups.find(x => x.projects.includes(n)) || {}).name;
    const pick = h('select', { class: 'gadd', title: 'Add a project to this group', onchange: () => { const n = pick.value; pick.value = ''; if (n) c.addProject(g.name, n); } },
      h('option', { value: '' }, 'Add project...'),
      others.map(p => h('option', { value: p.name }, inGroup(p.name) ? `${p.name} (in ${inGroup(p.name)})` : p.name)));
    cards.push(h('div', { class: 'preset' },
      h('div', { class: 'pv' }, miniTree(c.layoutOf(g, c.groupViews[g.name]).tree)),
      h('div', { class: 'pbody' },
        h('div', { class: 'pname' }, nameEl(h, g, c.renameGroup), h('small', { class: 'gmgr' }, `cto-${g.name}${c.running(g.name) ? ' · running' : ''}`)),
        h('div', { class: 'pproj' },
          g.projects.map(n => h('span', { class: 'ptag' }, n,
            h('button', { class: 'tagx', title: `Take ${n} out of ${g.name}`, onclick: () => c.removeProject(g.name, n) }, icon('x')))),
          pick)),
      h('div', { class: 'pacts' },
        h('button', { class: 'btn primary', title: 'Start its CTO and projects, and bring back its split', onclick: () => c.openGroup(g.name) }, 'Open'),
        h('button', { class: 'btn', title: CATCH_TIP, onclick: () => c.openGroup(g.name, true, true) }, 'Open and catch up'),
        h('button', { class: 'btn ghost', title: 'Delete group', onclick: () => c.removeGroup(g.name) }, icon('x')))));
  }
  // The two ways to make a group, at the end of the list (#1024).
  const open = c.onScreen;
  cards.push(h('button', { class: 'gnew', disabled: !open.length,
    title: open.length ? 'Keep the projects on screen and their split as a group, named after them' : 'Open a project first', onclick: () => c.saveOpen() },
  icon('plus'), open.length ? `Save what is open (${open.join(', ')})` : 'Save what is open'));
  if (picking) cards.push(pickerCard(c));
  else cards.push(h('button', { class: 'gnew', title: 'Pick the projects for a new group', onclick: () => { picking = { sel: [...open], name: c.suggestName(open), named: false }; c.rerender(); } }, icon('plus'), 'New group...'));
  return [h('h2', {}, 'Groups'), h('div', { class: 'presets' }, cards)];
}
