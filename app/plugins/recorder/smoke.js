// The recorder in the smoke run (#369). Normally the run fakes the capture (a painted canvas and
// a tone), the transcript, Claude's reply and the screenshots: the recorder is on by default, the
// Record button opens its intro and Start recording starts (#2919), the arrow beside it opens a
// menu, the button stops a recording, chunks reach the video file, and the review shows three
// cards with screenshots. A
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

  const caret = () => document.querySelector('.plugcaret[data-plugin="recorder"]');
  const menuRows = () => [...document.querySelectorAll('.plugmenu .mitem')];
  const menuWords = () => menuRows().map(r => r.querySelector('span').textContent);
  const introBtn = label => [...document.querySelectorAll('.recintro .btn')].find(b => b.textContent === label);
  // The arrow's menu, opened fresh (#2919).
  const openMenu = async () => {
    if (document.querySelector('.plugmenu')) caret().click();
    caret().click();
    if (!(await until(() => menuRows().length))) fail('the arrow beside Record opened no menu');
  };
  // Record, then the intro's Start recording: how a recording starts from the button.
  const startFromButton = async () => {
    btn().click();
    if (!(await until(() => introBtn('Start recording')))) fail('the Record button did not open the intro');
    introBtn('Start recording').click();
  };

  // #2919: the recorder is on by default, so its button shows with nothing saved: Record, where
  // Plugins was, with no Plugins button.
  if (!(await until(() => btn()))) fail('the button never showed');
  if (document.querySelector('.plugsbtn')) fail('the Plugins button still shows');
  if (getComputedStyle(btn()).display === 'none' || btn().querySelector('.plugl').textContent !== 'Record' || btn().dataset.state !== 'idle') fail(`the idle button is not "Record": ${btn().textContent}`);
  if (!caret() || caret().previousElementSibling !== btn() || btn().compareDocumentPosition(document.getElementById('btnSettings')) !== Node.DOCUMENT_POSITION_FOLLOWING) fail('the Record button and its arrow are not before Settings');
  console.log(`smoke: recorder on by default, button "${btn().textContent}" with its arrow, no Plugins button`);
  // Changing a recorder setting saves an entry with no `on`: it must stay on.
  app.saveSettings({ ...app.settings, plugins: { recorder: { settings: { model: 'ggml-small.en-q5_1.bin' } } } });
  await wait(800);
  if (!btn()) fail('changing a recorder setting switched the recorder off');
  const fake = ((await deck.plugin.list()).find(p => p.manifest.id === 'recorder') || {}).fake;
  // A recording a failed run left open would be picked up instead: clear it.
  if ((await state()).session) await deck.plugin.invoke('recorder', 'discard', false);

  // #407: Settings offers the Whisper folder, model and ffmpeg as dropdowns, never free text.
  // #2919: they are in the Screen recorder section, with Delete all recordings at its end.
  {
    app.view = 'settings'; render();
    document.querySelector('.setnav [data-sec="Screen recorder"]')?.click();
    const sel = k => document.querySelector(`select.listed[data-key="${k}"]`);
    await until(() => sel('whisperDir') && sel('whisperDir').options.length > 1 && sel('ffmpeg') && sel('ffmpeg').options.length > 1 && sel('model') && document.querySelector('.recdelall'), 8000);
    const keys = ['whisperDir', 'model', 'ffmpeg'].filter(k => sel(k));
    const opts = Object.fromEntries(keys.map(k => [k, [...sel(k).options].map(o => o.textContent)]));
    const card = document.querySelector('.recdelall')?.closest('.pcard');
    const last = card && card.lastElementChild;
    if (!card || card.querySelector('h2').textContent !== 'Screen recorder' || !last || !last.querySelector('.recdelall')) fail('Delete all recordings is not at the end of the Screen recorder card');
    if (document.querySelector('.recpast')) fail('the old Recordings list still shows in Settings');
    last?.scrollIntoView({ block: 'end' }); await wait(300);
    await deck.smokeShot('recorder-settings');
    const ok = keys.length === 3 && opts.whisperDir.includes('Choose a folder...') && opts.ffmpeg.includes('Choose a file...');
    console[ok ? 'log' : 'error'](`smoke: recorder settings as dropdowns: ${JSON.stringify(opts)}`);
    app.view = 'home'; render(); await wait(300);
  }

  // The arrow beside Record (#2919): New recording, Recorded videos with its count, Recorder
  // settings. Recorded videos opens even with no recordings, and its New recording opens the intro.
  {
    await openMenu();
    const words = menuWords();
    if (words.join('|') !== 'New recording|Recorded videos|Recorder settings') fail(`the arrow menu lists ${words.join(', ')}`);
    await deck.smokeShot('recorder-menu');
    menuRows()[1].click();
    if (document.querySelector('.plugmenu')) fail('a menu row did not close the menu');
    if (!(await until(() => document.querySelector('.recvmodal .recvids')))) fail('Recorded videos did not open from the arrow menu');
    document.querySelector('.recvmodal .closex')?.click();
    await openMenu();
    menuRows()[0].click();
    if (!(await until(() => introBtn('Start recording')))) fail('New recording did not open the intro');
    await wait(300);
    await deck.smokeShot('recorder-intro');
    if (!/Ctrl\+Alt\+R/.test(document.querySelector('.recintro').textContent)) fail('the intro does not show the shortcut');
    introBtn('Cancel').click();
    if (document.querySelector('.recintro') || (await state()).session) fail('Cancel on the intro left it open or started a recording');
    await openMenu();
    menuRows()[2].click();
    if (!(await until(() => document.querySelector('.setnav .on')?.dataset.sec === 'Screen recorder'))) fail('Recorder settings did not open the Screen recorder section');
    app.view = 'home'; render(); await wait(300);
    // Escape closes the menu, and so does a click elsewhere.
    await openMenu();
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.querySelector('.plugmenu')) fail('Escape did not close the arrow menu');
    console.log('smoke: recorder arrow menu: rows, Recorded videos, New recording intro, Recorder settings, Escape');
  }

  if (fake) {
    // The intro shows every time Record is clicked; Start recording starts (#2919).
    btn().click();
    if (!(await until(() => introBtn('Start recording')))) fail('the Record button did not open the intro');
    introBtn('Cancel').click();
    await startFromButton();
    if (!(await reached('recording', 5000))) fail('Start recording on the intro did not start a recording');
    if (!(await until(() => btn().dataset.state === 'active'))) fail('the button does not show it is recording');
    await openMenu();
    const mid = menuWords()[0];
    caret().click();
    if (mid !== 'Stop recording') fail(`while recording the arrow menu starts with "${mid}"`);
    console.log(`smoke: recorder intro Start recording, then "${mid}" in the menu while recording`);
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
    await startFromButton();
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
  // #1482: the button opens Recorded videos on this recording, and its Review button the cards.
  btn().click();
  const sel = () => document.querySelector('.recvitem.sel');
  if (!(await until(() => sel() && sel().dataset.rec === st.session.id, 5000))) fail('Recorded videos did not open on the new recording');
  if (!document.querySelector('.recvnew')) fail('the new recording is not tagged Just recorded');
  const acts = () => [...document.querySelectorAll('.recvacts .btn')].map(b => b.textContent);
  console.log(`smoke: recorder videos list ${document.querySelectorAll('.recvitem').length} recordings, actions ${acts().join(', ')}`);
  if (!['Play video', 'Open folder', 'Regenerate tasks', 'Talk to agent', 'Delete'].every(a => acts().includes(a))) fail(`the preview lacks an action: ${acts().join(', ')}`);
  await wait(800);
  await deck.smokeShot('recorder-videos');
  if (!fake) return;
  [...document.querySelectorAll('.recvacts .btn')].find(b => /^Review \d+ cards?$/.test(b.textContent))?.click();
  if (!(await until(() => document.querySelectorAll('.recgrid .plugcard').length === cards.length, 5000))) fail('the review does not show the cards');
  if (btn().querySelector('.plugl').textContent) fail('the badge stayed after the review was opened');
  console.log(`smoke: recorder badge ${badge} while waiting, gone once the review opened`);

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

  // Accept all: the reminder lands on Me with its due time, the recording ends and the modal is
  // back on the list (#1482).
  document.querySelector('.recbar .plugsplit .btn:first-child').click();
  if (!(await until(() => !document.querySelector('.recgrid'), 5000))) fail('Accept all did not close the review');
  if ((await state()).session !== null) fail('the recording is still open after Accept all');
  if (!(await until(() => document.querySelector('.recvids'), 5000))) fail('Recorded videos did not come back after Accept all');
  // Talk to agent types the RECORDING TALK line for the CTO; Regenerate tasks reads it again and
  // its three cards replace the old ones, which the review lists as already on the boards (#2185).
  const actBtn = label => [...document.querySelectorAll('.recvacts .btn')].find(b => b.textContent === label);
  const talk = await deck.plugin.invoke('recorder', 'talk', st.session.id);
  if (!/^RECORDING TALK: Recording \d{4}-\d\d-\d\d \d\d:\d\d \| transcript: .+transcript\.md \| video: .+video\.webm \| cards: /.test(String(talk))) fail(`the Talk to agent line is wrong: ${talk}`);
  actBtn('Talk to agent').click();
  if (!(await until(() => toastSaid(/CTO/), 5000))) fail('Talk to agent said nothing about the CTO');
  actBtn('Regenerate tasks').click();
  if (!(await reached('review', 20000))) fail('Regenerate tasks did not read the recording again');
  if (st.session.cards.length !== 3 || st.session.cards.some(c => c.status !== 'open') || (st.session.earlier || []).length !== 3) fail(`Regenerate did not replace the cards: ${st.session.cards.map(c => `${c.title} ${c.status}`).join(', ')}; earlier ${(st.session.earlier || []).length}`);
  console.log(`smoke: recorder Talk to agent: ${talk.slice(0, 60)}..., Regenerate replaced the cards with ${st.session.cards.length} new ones`);
  for (const c of st.session.cards) await deck.plugin.invoke('recorder', 'drop', c.id);
  await deck.plugin.invoke('recorder', 'done');
  for (let t = 0; t < 5000 && (await state()).session; t += 250) await wait(250);
  if ((await state()).session) fail('a regenerated recording with its cards dropped did not finish');
  document.querySelector('.plugmodal .closex')?.click();
  const me = String(await peek('Me'));
  if (!/Call the bank[^\n]*\n(\s+>[^\n]*\n)*\s+> Due: 2026-10-17 10:00/.test(me + '\n')) fail(`the reminder is not on Me with its time:\n${me}`);

  // The accepted item opens with its screenshots.
  const [head, ...rest] = item.split('\n');
  app.showTask(task.project, { mark: ' ', n: placed.n, text: task.title, date: (head.match(/\((\d{4}-\d{2}-\d{2})/) || [])[1] || '', who: 'user', forOwner: false,
    details: rest.map(l => l.replace(/^\s*> ?/, '')), result: '' });
  if (!(await until(() => document.querySelectorAll('.tdshot img[src^="data:"]').length === task.shots.length, 5000))) fail('the item view does not show the screenshots');
  await deck.smokeShot('recorder-item');
  document.querySelector('.tdclose')?.click();

  // #2919: with nothing open the Record button is back to idle and still shows, and Settings >
  // Screen recorder counts the finished recording and deletes every recording after asking.
  if (!(await until(() => btn() && btn().dataset.state === 'idle' && getComputedStyle(btn()).display !== 'none' && btn().querySelector('.plugl').textContent === 'Record'))) fail('the Record button is not back to idle with no recording open');
  app.view = 'settings'; render();
  document.querySelector('.setnav [data-sec="Screen recorder"]')?.click();
  const helpOf = () => (document.querySelector('.recdelall')?.closest('.opt')?.querySelector('.l span') || {}).textContent || '';
  if (!(await until(() => /^[1-9]\d* kept/.test(helpOf()) && !document.querySelector('.recdelall').disabled))) fail(`Settings does not count the finished recording: "${helpOf()}"`);
  document.querySelector('.recdelall').click();
  if (!(await until(() => document.querySelector('.plugconfirm')))) fail('Delete all recordings did not ask first');
  [...document.querySelectorAll('.plugconfirm .btn')].find(b => b.textContent === 'Cancel').click();
  await wait(300);
  if (!/^[1-9]\d* kept/.test(helpOf())) fail('Cancel deleted the recordings');
  document.querySelector('.recdelall').click();
  if (!(await until(() => document.querySelector('.plugconfirm')))) fail('Delete all recordings did not ask again');
  [...document.querySelectorAll('.plugconfirm .btn')].find(b => b.textContent === 'Delete all').click();
  if (!(await until(() => /^0 kept/.test(helpOf()), 5000))) fail(`Delete all recordings left ${helpOf()}`);
  console.log(`smoke: recorder idle button "${btn().textContent}", Settings counted the recording, Delete all emptied it: ${helpOf()}`);
  await deck.smokeShot('recorder-recordings');
  // Changing a setting did not switch it off (#2919).
  if (!btn()) fail('the recorder went off during the run');
  app.saveSettings({ ...app.settings, plugins: {} });
  app.view = 'home';
  render();
}
