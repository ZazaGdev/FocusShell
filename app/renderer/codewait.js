// What a Code pane shows while VS Code starts, and when it did not (#1114): the start's steps
// with ticks and times, the try number when it is trying again, what VS Code needs to work
// here (checked where it can be), and an error naming the step it stopped at, with Retry and
// Open in VS Code. Kept apart from code.js, which owns the webviews.
export const DOWNLOADING = 'VS Code downloading its server';
const STEPS = [
  ['copy', 'Copying your VS Code settings and extensions'],
  ['start', 'Starting the VS Code server'],
  ['check', 'Checking the server answers'],
  ['download', 'Downloading the VS Code server (first start)'],
  ['open', 'Opening the project'],
];

// The status of each step for this pane: the server's own from main (shared by every pane),
// then the pane's page.
function statuses(st, server) {
  const s = Object.fromEntries(STEPS.map(([k]) => [k, (server[k] && server[k].status) || '']));
  if (st.downloaded || st.step === DOWNLOADING) s.download = st.step === DOWNLOADING ? 'now' : 'done';
  if (st.step === 'loading VS Code' || st.step === 'drawing VS Code' || st.step === 'trusting the project folders') s.open = 'now';
  if (st.painted) s.open = 'done';
  if (st.error) {
    const at = STEPS.map(([k]) => k).find(k => s[k] === 'now' || s[k] === 'failed');
    if (at) s[at] = 'failed';
  }
  return s;
}
const secs = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : `${Math.max(0.1, ms / 1000).toFixed(1)} s`);

// c: { h, name, st, server: the server's steps, req: the requirements or null, tries, onRetry, onExternal, onGet }
export function codeWait(c) {
  const { h, name, st, server, req } = c, s = statuses(st, server);
  const stoppedAt = (STEPS.find(([k]) => s[k] === 'failed') || [])[1];
  const stepRows = h('div', { class: 'cwsteps' }, STEPS.map(([k, label]) => h('div', { class: 'cwst ' + (s[k] || ''), 'data-step': k },
    h('span', { class: 'cwic' }, s[k] === 'done' ? '✓' : s[k] === 'failed' ? '!' : s[k] === 'now' ? h('span', { class: 'cwspin' }) : '·'), label,
    s[k] === 'done' && server[k] && server[k].ms != null ? h('small', {}, secs(server[k].ms)) : null)));
  const reqRows = !req ? h('div', { class: 'cwnote' }, 'Checking…') : [
    ['installed', 'VS Code installed', req.installed ? `Found the desktop app at ${req.installed}` : 'Not found where VS Code installs itself'],
    ['version', 'A recent VS Code', req.version ? `Version ${req.version}, which has the web server FocusShell uses` : req.installed ? 'Could not read its version' : 'Install VS Code first'],
    ['internet', 'Internet for the first start', req.internet ? 'VS Code downloads its server once, a large download, and again after a VS Code update' : 'VS Code\'s download site could not be reached: the first start needs it'],
    ['port', 'A free local port', req.port ? 'FocusShell can open a port on this PC for it' : 'No local port answered'],
    ['firewall', 'Not blocked by a firewall or antivirus', 'Cannot be checked from here: if it stops at "Checking the server answers", allow code-tunnel.exe'],
  ].map(([k, label, text]) => {
    const ok = k === 'firewall' ? null : k === 'version' ? !!req.version : k === 'installed' ? !!req.installed : !!req[k];
    return h('div', { class: 'cwrq ' + (ok === null ? 'info' : ok ? 'ok' : 'bad'), 'data-req': k }, h('span', { class: 'cwic' }, ok === null ? 'i' : ok ? '✓' : '✗'), h('div', {}, h('b', {}, label), h('span', {}, text)));
  });
  const reqBox = h('details', st.error ? { class: 'cwreq', open: '' } : { class: 'cwreq', ontoggle: e => { if (e.target.open) c.onGet(); } },
    h('summary', {}, 'What VS Code needs to work inside FocusShell'), h('div', { class: 'cwreqs' }, reqRows));
  return h('div', { class: 'codewait' },
    st.error ? null : h('h3', {}, st.retrying ? `Still starting VS Code for ${name}` : `Starting VS Code for ${name}`),
    st.retrying && !st.error ? h('p', {}, h('span', { class: 'cwtry' }, `Try ${st.tries} of ${c.tries}. `), 'The last try did not come up within a minute, so it started again.') : null,
    st.error ? h('div', { class: 'cwerr' }, h('b', {}, st.error), stoppedAt ? h('div', { class: 'cwnote' }, `It stopped at "${stoppedAt}".`) : null) : null,
    stepRows,
    st.step === DOWNLOADING && !st.error ? h('div', {}, h('div', { class: 'cwbar' }, h('i')), h('p', { class: 'cwnote' }, 'VS Code is downloading its server, which a first start or a new VS Code release needs. This can take a few minutes on a slow connection.')) : null,
    reqBox,
    st.error ? h('div', { class: 'codeacts' }, h('button', { class: 'btn primary', 'data-act': 'retry', onclick: c.onRetry }, 'Retry'),
      h('button', { class: 'btn', 'data-act': 'external', onclick: c.onExternal }, 'Open in VS Code'))
      : h('p', { class: 'cwnote' }, `If nothing changes for a minute it tries again, up to ${c.tries} times.`));
}
