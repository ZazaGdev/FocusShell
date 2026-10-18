// The Settings page: preferences that change how FocusShell looks and behaves.
import { DOCKS, MODELS, STATUS_EVERY, THEMES, SPACES, FONTS, cleanTags } from '../lib/settings.js';

const DOCK_WORD = { left: 'Left', right: 'Right', bottom: 'Bottom', float: 'Floating' };
const MODEL_WORD = { '': 'Claude default', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };

// c: { h, settings, save, back, pushed: [project names] or null while loading, projects: [names],
//      roots: [folders projects are listed from] or null while loading, pickRoot(),
//      pluginSection(parts) (#369), demo: the Demo (#1065) }
export function renderSettings(root, c) {
  const { h, settings: s } = c;
  const set = patch => c.save({ ...s, ...patch });
  const seg = (opts, value, onPick, word = o => o) => h('span', { class: 'seg' },
    opts.map(o => h('button', { class: o === value ? 'on' : '', onclick: () => onPick(o) }, word(o))));
  const toggle = (on, onFlip) => h('button', { class: 'sw' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: () => onFlip(!on) });
  const opt = (label, sub, control) => h('div', { class: 'opt' }, h('div', { class: 'l' }, h('b', {}, label), h('span', {}, sub)), h('div', {}, control));
  const modelPick = (value, onPick) => h('select', { class: 'inp', onchange: e => onPick(e.target.value) },
    MODELS.map(m => h('option', { value: m, selected: m === value }, MODEL_WORD[m])));
  const size = h('input', { class: 'inp', type: 'number', min: 240, max: 900, step: 10, value: s.pmSize, onchange: () => set({ pmSize: Number(size.value) }) });
  // Preferences (#1026): each theme shows as a swatch of its own colours (data-theme on the
  // swatch picks up its tokens from themes.css).
  const themePick = h('div', { class: 'themes' }, THEMES.map(t => h('button', { class: 'themepick' + (t.id === s.theme ? ' on' : ''), 'data-theme': t.id, 'data-pick': t.id, onclick: () => set({ theme: t.id }) },
    h('span', { class: 'sw3', style: 'background:var(--bg)' }, h('i', { style: 'background:var(--bg)' }), h('i', { style: 'background:var(--surface2)' }), h('i', { style: 'background:var(--accent)' })),
    h('span', {}, t.name))));
  const cards = [
    h('section', { class: 'pcard prefs' },
      h('h2', {}, 'Preferences'),
      opt('Theme', 'Colours of the whole app; light themes keep the terminals dark', themePick),
      opt('Spacing', 'How roomy the app is: text and gaps grow or shrink together', seg(SPACES.map(x => x.id), s.space, v => set({ space: v }), v => SPACES.find(x => x.id === v).name)),
      opt('Font', 'The app\'s text; terminals keep their own font', h('select', { class: 'inp', onchange: e => set({ font: e.target.value }) },
        FONTS.map(f => h('option', { value: f.id, selected: f.id === s.font }, f.name)))),
      // #1101: off removes the part from the window entirely; questions still reach the Board and Waiting on you.
      opt('Show Maybe missed', 'The button above the CTO that lists questions and results in its replies you may have skipped', toggle(s.showMissed, v => set({ showMissed: v }))),
      opt('Show Tavern', 'The Tavern button in the title bar and the tavern itself; off, it does not run', toggle(s.showTavern, v => set({ showTavern: v }))),
      opt('Walkthrough', 'A short tour of the main parts of FocusShell', h('button', { class: 'btn', 'data-act': 'tour', onclick: c.replayTour }, 'Replay the walkthrough')),
      // In-app updates (#1088): the installed app looks for new versions by itself.
      c.update ? opt('Version', !c.update.on ? 'This copy does not update itself (a development or test run)'
        : c.update.ready ? `v${c.update.latest} is downloaded: Update ready in the title bar restarts into it`
        : c.update.checking ? 'Looking for a new version…' : c.update.error ? `Could not check: ${c.update.error}` : 'New versions download by themselves; you choose when to restart',
      h('span', { class: 'rootrow' }, h('code', { class: 'fixedname' }, `v${c.update.version}`),
        c.update.on && !c.update.ready ? h('button', { class: 'btn', 'data-act': 'update', onclick: c.checkUpdates }, 'Check now') : null)) : null),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Project manager'),
      opt('Run the PM', 'Off: no PM starts and the CTO keeps the board itself. Applies the next time FocusShell starts', toggle(s.runPm, v => set({ runPm: v })))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Home sidebar'),
      h('p', { class: 'sub' }, 'The CTO above the PM, on Home. The buttons in its title bar change these too; drag its edge to resize it and the line between the two to share the space. In the coding view, Ctrl+Shift+P or the PM button in the corner slides the PM over the right edge.'),
      opt('Position', 'Left, right or bottom of Home, or floating over the board', seg(DOCKS, s.pmDock, d => set({ pmDock: d, pmFolded: false }), d => DOCK_WORD[d])),
      opt('Width or height', 'In pixels, 240 to 900', size),
      opt('Folded', 'Shrink it to a thin strip; click the strip to open it', toggle(s.pmFolded, v => set({ pmFolded: v }))),
      opt('CTO folded', 'Show only the title bar of the CTO', toggle(s.foldCto, v => set({ foldCto: v }))),
      opt('PM folded', 'Show only the title bar of the PM', toggle(s.foldPm, v => set({ foldPm: v }))),
      opt('Start folded', 'Open FocusShell with the sidebar folded', toggle(s.pmStartFolded, v => set({ pmStartFolded: v })))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Projects'),
      // Connected projects (#1115): one full-width row each, its folder in grey, its Claude
      // model and a remove that asks first; an older setup's projects folders list every folder
      // in them, and those rows have no remove.
      h('div', { class: 'plist' },
        h('div', { class: 'plhead' }, h('b', {}, 'Connected projects'), h('span', {}, `${(c.projectRows || []).length} projects. Removing one leaves its folder on disk.`)),
        !c.roots ? h('div', { class: 'plrow' }, 'checking…') : [
          ...(c.projectRows || []).map(p => {
            const removable = c.roots.projects.some(x => x.name === p.name);
            if (confirming === p.name) return h('div', { class: 'plrow plask', 'data-proj': p.name }, h('span', { class: 'plask-t' }, `Remove ${p.name}? Its folder stays on disk.`),
              h('button', { class: 'btn primary', 'data-act': 'remove-yes', onclick: () => { confirming = null; c.removeProject(p.name); } }, 'Remove'),
              h('button', { class: 'btn', 'data-act': 'remove-no', onclick: () => { confirming = null; c.redraw(); } }, 'Cancel'));
            return h('div', { class: 'plrow', 'data-proj': p.name },
              h('span', { class: 'plname' }, p.name), h('span', { class: 'plpath', title: p.path }, p.path),
              h('select', { class: 'inp plmodel', title: `Claude model for ${p.name}'s lead`, onchange: e => c.setProjectModel(p.name, e.target.value) },
                MODELS.map(m => h('option', { value: m, selected: m === (p.model || '') }, MODEL_WORD[m] === 'Claude default' ? 'Default' : MODEL_WORD[m]))),
              removable ? h('button', { class: 'x plx', title: `Remove ${p.name}`, 'data-act': 'remove', onclick: () => { confirming = p.name; c.redraw(); } }, '×') : h('span', { class: 'plx' }));
          }),
          ...c.roots.roots.map(r => h('div', { class: 'plrow plroot' }, h('span', { class: 'plpath' }, `Also every folder in ${r}`))),
          h('div', { class: 'plrow pladd' }, c.connect)])),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Connections'),
      opt('Remote Control', "Sessions start reachable from claude.ai and the Claude app, under their own names. Applies the next time a session starts", toggle(s.remoteControl, v => set({ remoteControl: v }))),
      opt('Push board backups', "The hourly backup of tasks, ideas, notes and briefs is always committed in the data folder; on, it is also pushed to that folder's git remote", toggle(s.backupPush, v => set({ backupPush: v })))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Board'),
      opt('Compact items', 'Project board items take one line each (Me and Today stay as they are)', toggle(s.boardCompact, v => set({ boardCompact: v })))),
    c.pluginSection ? c.pluginSection({ h, opt, toggle, settings: s, set }) : null,
    h('section', { class: 'pcard' },
      h('h2', {}, 'Tags'),
      opt('Item tags', 'Badges an item can carry, to filter a board by', h('div', { class: 'tagset' },
        s.tags.map(t => h('span', { class: 'tag' }, t, h('button', { class: 'tagx', title: `Remove the tag ${t}`, onclick: () => set({ tags: s.tags.filter(x => x !== t) }) }, '×'))),
        (() => { const i = h('input', { class: 'inp', placeholder: 'New tag, then Enter', onkeydown: e => { if (e.key === 'Enter' && i.value.trim()) set({ tags: cleanTags([...s.tags, i.value]) }); } }); return i; })()))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Models'),
      h('p', { class: 'sub' }, "The Claude model of FocusShell's own sessions. A change applies the next time that session starts. Leads start on Claude's default."),
      opt('CTO', 'Also the group CTOs', modelPick(s.models.cto, m => set({ models: { ...s.models, cto: m } }))),
      opt('Project manager', 'Sonnet unless you pick another', modelPick(s.models.pm, m => set({ models: { ...s.models, pm: m } }))),
      opt('AI helper', 'The sparkle beside add boxes; Haiku unless you pick another', modelPick(s.models.helper, m => set({ models: { ...s.models, helper: m } })))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Catch up'),
      h('p', { class: 'sub' }, 'Open and catch up, on each group: every lead and the CTO get a recap of where the project stands and where work stopped yesterday.'),
      opt('Who writes the recap', 'A model reads the board, the git log and the lead\'s recent sessions; or each lead writes its own',
        seg(['model', 'lead'], s.catchUp, v => set({ catchUp: v }), v => (v === 'model' ? 'A model' : 'Each lead'))),
      s.catchUp === 'model' ? opt('Recap model', 'Haiku unless you pick another', modelPick(s.models.catchup, m => set({ models: { ...s.models, catchup: m || 'haiku' } }))) : null),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Status'),
      opt('Refresh every', 'How often each CTO is asked to update the Status lines while a lead is busy or has changed; a busy CTO answers at its next pause',
        seg(STATUS_EVERY, s.statusEvery, m => set({ statusEvery: m }), m => (m < 60 ? `${m} min` : `${m / 60} h`)))),
    h('section', { class: 'pcard' },
      h('h2', {}, 'Sessions'),
      h('p', { class: 'sub' }, 'The names sessions use to message each other. Fixed, shown for reference.'),
      // Plain text, not boxes that look like inputs: the names are fixed (#408).
      opt('CTO', 'Turns items into briefs, hands them to leads, relays reports', h('code', { class: 'fixedname' }, 'cto')),
      opt('Group CTOs', 'One per group, for that group\'s projects', h('code', { class: 'fixedname' }, 'cto-<Group>')),
      opt('Project manager', 'Owns the board across every project', h('code', { class: 'fixedname' }, 'pm')),
      opt('Leads', 'One per project', h('code', { class: 'fixedname' }, 'lead-<Project>')))].filter(Boolean)
    // The Demo is the release (#1065): no Goals or Dashboard switch there.
    .filter(x => !(c.demo && ['Self', 'Dashboard'].includes(x.querySelector('h2').textContent)));
  // Which projects push without asking sits with the projects folder.
  cards.find(x => x.querySelector('h2').textContent === 'Projects').append(h('p', { class: 'pushline' }, h('b', {}, 'Push without asking: '),
    !c.pushed ? 'checking…' : c.pushed.length ? c.pushed.join(', ') : 'none, every lead asks',
    h('span', { class: 'qhelp', tabindex: '0', title: "Projects whose lead pushes with no permission prompt, read from the git push rules in each project's .claude/settings.local.json. To change one, tell that project's lead in its pane. Force pushes still ask." }, '?')));
  // A sidebar of the sections (#409), the small ones folded together; the one picked shows on
  // the right, remembered for this run. A card no group names gets its own entry.
  const titles = cards.map(x => x.querySelector('h2').textContent);
  const groups = [...GROUPS.filter(([, of]) => of.some(t => titles.includes(t))),
    ...titles.filter(t => !GROUPS.some(([, of]) => of.includes(t))).map(t => [t, [t]])];
  const names = groups.map(([n]) => n), inGroup = (n, t) => groups.find(([g]) => g === n)[1].includes(t);
  if (!names.includes(shown)) shown = names[0];
  const nav = h('nav', { class: 'setnav' }, names.map(n => h('button', { class: n === shown ? 'on' : '', 'data-sec': n, onclick: () => pick(n) }, n)));
  const pick = n => {
    shown = n;
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sec === n));
    cards.forEach((x, i) => { x.hidden = !inGroup(n, titles[i]); });
  };
  pick(shown);
  root.replaceChildren(h('div', { class: 'home-inner settings' },
    h('button', { class: 'btn ghost back', onclick: c.back }, '← Home'),
    h('div', { class: 'setpage' }, h('div', { class: 'setside' }, h('h1', {}, 'Settings'), nav), h('div', { class: 'setmain' }, cards))));
}
let shown = null; // the section on the right
let confirming = null; // the project whose remove is waiting for Remove or Cancel (#1115)
// The sidebar's entries and the cards each shows, in order.
const GROUPS = [
  ['Preferences', ['Preferences']],
  ['Projects', ['Projects']],
  ['Sidebar and PM', ['Project manager', 'Home sidebar']],
  ['Boards', ['Board', 'Self', 'Tags']],
  ['Sessions', ['Models', 'Catch up', 'Status', 'Sessions']],
  ['Connections', ['Connections']],
  ['Plugins', ['Plugins']],
];
