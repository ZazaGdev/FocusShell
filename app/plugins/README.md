# Writing an FocusShell plugin

A plugin is a built-in feature in its own folder, `app/plugins/<id>/`, switched on and off in
Settings. Spec: `docs/superpowers/specs/2026-10-16-plugin-system-design.md`.

Plugins have no screen of their own for now (#2919): the Plugins title bar button is hidden and
nothing in the UI says "plugin". A plugin shows as a feature of its own: its button (and the arrow
menu it may add) sits where Plugins was, and Settings gives it a card named for it. The Plugins
screen's code (`openPlugins` in `renderer/plugins.js`) is kept, so it can come back.

## The folder

- `manifest.js`: plain data, `export default { id, name, version, api: 1, description,
  button: { icon, title, labels }, shortcut, uses, settings }`. `icon` is a name from
  `renderer/dom.js`. `labels` (optional) names the button of the hidden Plugins screen (#2919) for each button state
  (`idle`, `active`, `busy`, `attention`); without it the button says Start. `uses` lists the host services the plugin may call. `smokeOnly: true` keeps
  a plugin out of normal runs. `defaultOn: true` (optional) makes it on until the owner switches it
  off: a saved `on: false` stays off, a saved `on: true` stays on, and an entry saved only for a
  setting or the shortcut leaves the default.
- `main.js`: `export function activate(host)`, synchronous, returning `{ deactivate }`.
- `renderer.js`: `export function mount(ui)`, returning `{ unmount }`.
- `lib/`: pure logic with tests, imported by `app/lib/lib.test.js`.

Then add one line each to `manifests.js`, `index.js` and `pages.js`.

## The host (main side)

`host.id`, `host.dir` (its own data folder, never committed), `host.smoke`, `host.fake` (the
hidden smoke run: fake what is recorded or run, unless `FOCUSSHELL_RECORDER_REAL=1`),
`host.settings()`, `host.onSettings(fn)`, `host.handle(name, fn)`, `host.emit(event, data)`,
`host.shortcut(fn)`, `host.log(text)`, and each service named in `uses`.

Services (`app/plugin-services.js`): `screen.source(which)` gives the desktop source id of a
display (`primary`, `2`, `3`) for `getUserMedia` with `chromeMediaSource: 'desktop'`.
`boards` changes boards through the deck command's own rules and lock: `projects()`,
`open(board)` (`[{ n, title }]`), `add(board, { title, details, due })` (returns the number),
`detail(board, n, text)`, `note(board, text)`, `show(board, n)`; smoke and try runs write to
`state/smoke/data`. `claude.turn({ system, text, model, effort, timeoutMs })` runs one headless
Claude turn with none of the owner's setup and resolves the reply text.
Smoke and try runs take no global shortcut unless `FOCUSSHELL_PLUGIN_KEYS=1`.

## The ui (page side)

`ui.h`, `ui.icon`, `ui.toast`, `ui.fake` (as `host.fake`), `ui.cto(line)` (only with `uses: ['cto']`: types one line into the main CTO's pane as the owner's words, held while the owner writes there; resolves false when the CTO is not running), `ui.button` (`set(state, label)` with `idle`, `active`, `busy`,
`attention`; `onClick(fn)`; `menu(fn, tip)` adds a small arrow beside the button, and each time it opens
`fn()` returns its rows, `[{ label, icon, hint, run }]` with null rows skipped), `ui.invoke(name, ...args)` (it resolves to `{ error: message }` when the handler is missing or throws, and a throw also switches the plugin off), `ui.on(event, fn)`, `ui.settings()`, `ui.shortcut()` (its current shortcut, or null), `ui.openSettings()` (opens Settings at the plugin's own card), `ui.panel(fn)` (its own rows at the end of its Settings card: `fn({ close, opt })` returns an element, and `opt(label, help, control)` is Settings' own row),
and `ui.kit` (`modal`, `card`, `talkBox`, `confirm`, `splitButton`, `buttonRow`), the shared screen pieces in `renderer/plugin-ui.js`. Build screens from the kit,
so every plugin looks and behaves alike.

## Rules

- A screen draws state and sends actions. Logic, files and board writes live on the main side
  or in `lib/`, never in a screen.
- Reach the app only through `host` and `ui`: no imports of other plugins or of FocusShell's own
  modules, apart from your own `lib/`.
- Heavy work (ffmpeg, whisper, a Claude turn) runs in a child process, never on the main thread.
- A throw in `activate`, a handler or a shortcut switches the plugin off for this run and shows
  the error in Settings; it never takes FocusShell down. Do not swallow errors you cannot handle.
- No em or en dashes, no `innerHTML`.
