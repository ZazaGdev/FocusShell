// The recorder in the smoke run (#369). Normally the run fakes the capture (a painted canvas and
// a tone), the transcript, Claude's reply and the screenshots: the button starts and stops a
// recording, chunks reach the video file, and the review shows three cards with screenshots. A
// description is typed, one card accepted, one accepted and sent to the CTO, Discard all asks
// first, Accept all ends it; the boards (in state/smoke/data) are read back, and an accepted
// item opens with its screenshots.
// With FOCUSSHELL_RECORDER_REAL=1 (and FOCUSSHELL_PLUGIN_KEYS=1) it records for real and waits
// for the real shortcut to start and stop it, then leaves the review open for the real check.
export async function recorderSmoke({ deck, app, render, wait }) {
  const btn = () => document.querySelector('.plugbtn[data-plugin="recorder"]');
  const until = async (ok, ms = 3000) => { for (let t = 0; t < ms && !ok(); t += 100) await wait(100); return ok(); };
  const state = async () => (await deck.plugin.invoke('recorder', 'state')) || {};
  const peek = (board, n) => deck.plugin.invoke('recorder', 'peek', board, n);
  const fail = why => deck.smokeFail(`recorder: ${why}`);
  let st = {};
  const reached = async (want, ms) => { for (let t = 0; t < ms; t += 250) { st = await state(); if (st.session && st.session.state === want) return true; await wait(250); } return false; };
  const cardEl = id => [...document.querySelectorAll('.recgrid .plugcard')].find(el => el.dataset.card === id);
  const toastSaid = re => [...document.querySelectorAll('#toasts .toast')].some(t => re.test(t.textContent));

  app.saveSettings({ ...app.settings, plugins: { recorder: { on: true, settings: { model: 'ggml-small.en-q5_1.bin' } } } });
  if (!(await until(() => btn()))) fail('the button never showed');
  const fake = ((await deck.plugin.list()).find(p => p.manifest.id === 'recorder') || {}).fake;
  // A recording a failed run left open would be picked up instead: clear it.
  if ((await state()).session) await deck.plugin.invoke('recorder', 'discard', false);

  // #407: Settings offers the Whisper folder, model and ffmpeg as dropdowns, never free text.
  {
    app.view = 'settings'; render();
    const sel = k => document.querySelector(`select.listed[data-key="${k}"]`);
    await until(() => sel('whisperDir') && sel('whisperDir').options.length > 1 && sel('ffmpeg') && sel('model'), 5000);
    const keys = ['whisperDir', 'model', 'ffmpeg'].filter(k => sel(k));
    const opts = Object.fromEntries(keys.map(k => [k, [...sel(k).options].map(o => o.textContent)]));
    sel('whisperDir')?.scrollIntoView({ block: 'center' }); await wait(300);
    await deck.smokeShot('recorder-settings');
    const ok = keys.length === 3 && opts.whisperDir.includes('Choose a folder...') && opts.ffmpeg.includes('Choose a file...');
    console[ok ? 'log' : 'error'](`smoke: recorder settings as dropdowns: ${JSON.stringify(opts)}`);
    app.view = 'home'; render(); await wait(300);
  }

  // Plugins > Screen recorder: its button, named for what a click does now (#394).
  const panelStart = async () => {
    document.querySelector('.plugsbtn').click();
    if (!(await until(() => document.querySelector('.plugsrow')))) fail('the Plugins list did not open');
    [...document.querySelectorAll('.plugsrow')].find(r => /Screen recorder/.test(r.textContent)).querySelector('button').click();
    await until(() => document.querySelector('.plugstart'));
    return document.querySelector('.plugstart');
  };
  if (fake) {
    let b = await panelStart();
    if (b.textContent !== 'Start recording') fail(`the Plugins screen's button reads "${b.textContent}" with nothing recording`);
    b.click(); // the same as the shortcut: a recording starts
    if (!(await reached('recording', 5000))) fail('Start recording on the Plugins screen did not start a recording');
    if (!(await until(() => btn().dataset.state === 'active'))) fail('the button does not show it is recording');
    b = await panelStart();
    const mid = b.textContent;
    const shade = document.querySelector('.plugsmodal');
    shade?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // a click beside the box closes it
    if (document.querySelector('.plugsmodal')) fail('the Plugins screen did not close');
    if (mid !== 'Stop recording') fail(`while recording the Plugins screen's button reads "${mid}"`);
    console.log(`smoke: recorder Plugins screen button: Start recording, then "${mid}" while recording`);
    await wait(2600);
    btn().click();
    // #401: Stop leaves the owner where they are; the button works in the background.
    await wait(800);
    if (document.querySelector('.recsteps, .recgrid, .recbar')) fail('Stop opened the processing screen; it should run in the background');
    console.log(`smoke: recorder after Stop: no screen, button ${btn().dataset.state}`);
  } else if (await deck.plugin.invoke('recorder', 'auto')) {
    // FOCUSSHELL_RECORDER_AREA marks the area (#376): the overlay opens unseen and answers by
    // itself, then the real screen and mic are recorded for eight seconds.
    const kinds = () => deck.plugin.invoke('recorder', 'windows');
    btn().click();
    if (!(await reached('recording', 15000))) fail('the overlay did not start a recording');
    await wait(1500);
    const open = await kinds();
    if (!open.includes('border') || !open.includes('bar') || !open.includes('draw')) fail(`the border, bar and drawing layer are not up: ${open.join(', ')}`);
    console.log(`smoke: recorder area recording, mic ${st.session.mic === false ? 'off' : 'on'}`);
    // An outline drawn with the pen (#380), from 3 s on: it shows in the video from then.
    await wait(1500);
    if (!(await deck.plugin.invoke('recorder', 'drawTest'))) fail('the pen could not draw');
    await wait(5000);
    btn().click();
    // With the mic off there is nothing to transcribe, so it may be in review already.
    let left = false;
    for (let t = 0; t < 10000 && !left; t += 250) { st = await state(); left = !!st.session && st.session.state !== 'recording'; if (!left) await wait(250); }
    if (!left) fail('the dot did not stop the recording');
    if ((await kinds()).length) fail('the overlay windows stayed open after Stop');
    if (document.querySelector('.recsteps, .recgrid, .recbar')) fail('Stop opened the processing screen; it should run in the background (#401)');
  } else {
    console.log('smoke: recorder waiting for the shortcut to start');
    if (!(await reached('recording', 120000))) fail('the shortcut did not start a recording');
    console.log('smoke: recorder recording, waiting for the shortcut to stop');
    if (!(await reached('processing', 120000))) fail('the shortcut did not stop the recording');
  }
  if (!(await reached('review', fake ? 20000 : 900000))) fail(`processing did not finish (${st.session && st.session.state}: ${st.session && st.session.error})`);
  if (!(st.videoBytes > 0)) fail('the video file is empty');
  const cards = st.session.cards;
  console.log(`smoke: recorder saved ${st.files.folder} video ${st.videoBytes} bytes, ${cards.length} cards`);
  if (!(await until(() => btn().dataset.state === 'attention'))) fail('the button does not show the cards are waiting');
  const badge = btn().querySelector('.plugl').textContent;
  if (fake && badge !== String(cards.length)) fail(`the button's badge reads "${badge}", not ${cards.length}`);
  await deck.smokeShot('recorder-badge');
  btn().click();
  if (!(await until(() => document.querySelectorAll('.recgrid .plugcard').length === cards.length, 5000))) fail('the review does not show the cards');
  if (btn().querySelector('.plugl').textContent) fail('the badge stayed after the review was opened');
  console.log(`smoke: recorder badge ${badge} while waiting, gone once the review opened`);
  if (!fake) { await wait(2000); await deck.smokeShot('recorder-review'); return; }

  if (cards.length !== 3) fail(`${cards.length} cards, not 3`);
  if (!cards.every(c => c.shots.length)) fail('a card has no screenshot');
  const [task, gym, bank] = cards;
  const names = app.projects.map(p => p.name);
  if (!names.includes(task.project) || !names.includes(gym.project) || task.project === gym.project || bank.project !== 'Me' || bank.due !== '2026-10-17 10:00') fail(`cards went to the wrong places: ${cards.map(c => `${c.project} ${c.due}`).join(', ')}`);
  if (!(await until(() => document.querySelectorAll('.recthumb img[src^="data:"]').length >= 3, 5000))) fail('the screenshots did not load');

  // A description typed into a card reaches the session, and the box keeps its focus.
  const box = cardEl(task.id).querySelector('textarea');
  box.focus();
  box.value = `${box.value}\nThe change comes from Binance's 7 day ticker.`;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
  st = await state();
  if (!/7 day ticker/.test(st.session.cards[0].description)) fail('the typed description did not reach the card');
  if (document.activeElement !== cardEl(task.id).querySelector('textarea')) fail('typing lost the focus');
  await deck.smokeShot('recorder-review');

  // Accept one card: it goes on its board with Screenshot lines.
  cardEl(task.id).querySelector('.plugsplit .btn:first-child').click();
  if (!(await until(() => cardEl(task.id) && !cardEl(task.id).querySelector('textarea'), 5000))) fail('Accept did not close the card');
  st = await state();
  const placed = st.session.cards[0].placed;
  const item = String(await peek(task.project, placed.n));
  if (!/7 day ticker/.test(item) || (item.match(/> Screenshot: /g) || []).length !== task.shots.length || !/> Transcript: /.test(item)) fail(`the accepted item is not right:\n${item}`);

  // Accept and send to CTO: the main CTO gets the RECORDING line.
  cardEl(gym.id).querySelector('.plugsplit .second').click();
  if (!(await until(() => toastSaid(/CTO/), 5000))) fail('Accept and send to CTO said nothing about the CTO');
  console.log(`smoke: recorder CTO toast: ${[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' / ')}`);

  // Discard all asks first; Cancel keeps everything.
  [...document.querySelectorAll('.recbar .btn')].find(b => b.textContent === 'Discard all').click();
  if (!(await until(() => document.querySelector('.plugconfirm')))) fail('Discard all did not ask first');
  await deck.smokeShot('recorder-discard-all');
  [...document.querySelectorAll('.plugconfirm .btn')].find(b => b.textContent === 'Cancel').click();
  await wait(300);
  if (!(await state()).session) fail('Cancel discarded the recording');

  // Stage 4: Brainstorm with PM opens a session in a terminal beside the cards; a proposal written
  // the way the agent writes one marks the cards; Undo takes the added card away, Undo all
  // restores the rest, End brainstorm closes the session.
  const barBtn = label => [...document.querySelectorAll('.recbar .btn')].find(b => b.textContent === label);
  if (!barBtn('Brainstorm with PM') || !barBtn('Brainstorm with CTO')) fail('the review has no brainstorm buttons');
  barBtn('Brainstorm with PM').click();
  if (!(await until(() => document.querySelector('.recbs .recterm .termhost'), 5000))) fail('Brainstorm with PM did not open its terminal');
  st = await state();
  if (st.brainstormId !== 'brainstorm-pm') fail(`the brainstorm session is ${st.brainstormId}`);
  if (!(await deck.plugin.invoke('recorder', 'fakeProposal'))) fail('no proposal could be written');
  if (!(await until(() => document.querySelectorAll('.recmark').length >= 2, 5000))) fail('the proposal did not mark the cards');
  st = await state();
  const marks = st.session.cards.map(c => c.mark).filter(Boolean);
  if (!marks.includes('rewritten') || !marks.includes('added')) fail(`the marks are ${marks.join(', ')}`);
  await wait(800);
  await deck.smokeShot('recorder-brainstorm');
  const added = st.session.cards.find(c => c.mark === 'added');
  [...document.querySelectorAll('.recgrid .plugcard')].find(el => el.dataset.card === added.id).querySelector('.recmark .reclink').click();
  if (!(await until(() => !document.querySelector(`.recgrid .plugcard[data-card="${added.id}"]`), 5000))) fail('Undo did not take the added card away');
  barBtn('Undo all').click();
  if (!(await until(() => !document.querySelector('.recmark'), 5000))) fail('Undo all left marks');
  [...document.querySelectorAll('.recbs .btn')].find(b => b.textContent === 'End brainstorm').click();
  if (!(await until(() => !document.querySelector('.recbs'), 5000))) fail('End brainstorm did not close the panel');
  if ((await state()).brainstormId) fail('the brainstorm session is still open');

  // Accept all: the reminder lands on Me with its due time and the recording ends.
  document.querySelector('.recbar .plugsplit .btn:first-child').click();
  if (!(await until(() => !document.querySelector('.recgrid'), 5000))) fail('Accept all did not close the review');
  if ((await state()).session !== null) fail('the recording is still open after Accept all');
  const me = String(await peek('Me'));
  if (!/Call the bank[^\n]*\n(\s+>[^\n]*\n)*\s+> Due: 2026-10-17 10:00/.test(me + '\n')) fail(`the reminder is not on Me with its time:\n${me}`);

  // The accepted item opens with its screenshots.
  const [head, ...rest] = item.split('\n');
  app.showTask(task.project, { mark: ' ', n: placed.n, text: task.title, date: (head.match(/\((\d{4}-\d{2}-\d{2})/) || [])[1] || '', who: 'user', forOwner: false,
    details: rest.map(l => l.replace(/^\s*> ?/, '')), result: '' });
  if (!(await until(() => document.querySelectorAll('.tdshot img[src^="data:"]').length === task.shots.length, 5000))) fail('the item view does not show the screenshots');
  await deck.smokeShot('recorder-item');
  document.querySelector('.tdclose')?.click();

  // #384: with nothing open the title bar circle is hidden, and Plugins > Screen recorder lists
  // the finished recording under Recordings.
  if (!(await until(() => btn() && btn().dataset.state === 'idle' && getComputedStyle(btn()).display === 'none'))) fail('the circle still shows with no recording open');
  document.querySelector('.plugsbtn').click();
  if (!(await until(() => document.querySelectorAll('.plugsrow').length))) fail('the Plugins list is empty');
  [...document.querySelectorAll('.plugsrow')].find(r => /Screen recorder/.test(r.textContent)).querySelector('button').click();
  if (!(await until(() => document.querySelector(`.recpastrow[data-rec="${st.session ? st.session.id : ''}"], .recpastrow`)))) fail('Recordings lists nothing');
  const pastText = document.querySelector('.recpast').textContent;
  if (!/Done/.test(pastText)) fail(`Recordings does not show the finished one: ${pastText}`);
  console.log(`smoke: recorder circle hidden when idle, Recordings lists ${document.querySelectorAll('.recpastrow').length}`);
  await deck.smokeShot('recorder-recordings');
  document.querySelector('.plugmodal .closex')?.click();
  app.saveSettings({ ...app.settings, plugins: {} });
  render();
}
