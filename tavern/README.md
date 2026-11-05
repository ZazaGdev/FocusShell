# Pixel Tavern (mock-up, #238)

Running agents as guests in a top-down tavern; you are the barkeeper. This is the browser
mock-up with fake agents, built as the start of the real core, before anything goes into
FocusShell.

Run: `npm install` once, then `npm start` and open `http://localhost:5238/` (or this PC's
Tailscale address on port 5238 from a phone). Tests: `npm test`.

## How it is built

- `src/core/`: no Phaser, all tested. `layout.js` the room (tiles, tables, seats, bar spots),
  `path.js` A* over the tiles, `walker.js` movement and each guest's small state machine
  (walking, working, drinking, waiting, leaving, gone), `sync.js` the sync step: the agent
  list is the truth, and it says who comes in, moves or leaves.
- `src/scenes/TavernScene.js`: draws what the core says. Agents go in with `setAgents()`;
  a guest's question comes out as the `answer-open` event, the waiting count as `waiting`.
- `src/scenes/textures.js`: floor, walls, fireplace, tables, rug, mugs and glows drawn in code.
- `src/mock/fakeAgents.js`: stands in for FocusShell's sessions; the real app replaces it.
- `src/main.js`: the page around the canvas (badge, answer box, evening switch), the 20 fps
  cap, keeping on when the window loses focus, and sleeping while the page is hidden.

Art is placeholder: see `assets/LICENSES.md`.
