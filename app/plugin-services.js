// Host services for plugins (#369): what a plugin may reach beyond its own folder, each handed
// out only to a plugin whose manifest `uses` it. `screen` finds the display to record, `boards`
// changes boards through the deck command's own rules and lock, `claude` runs one headless turn.
// `sessions` starts the recorder's brainstorm sessions (#369 stage 4) and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { run as deck } from './lib/deckcli.js';
import { parseTasks } from './lib/tasks.js';
import { helperCommand } from './lib/helper.js';
import { runTurn } from './helper.js';

// d: { desktopCapturer, screen } from Electron; data (the folder boards live in: the smoke data
// folder in smoke and try runs), lock (the board lock), projectList(), cleanEnv(env), work (a
// folder for Claude turns).
export function pluginServices({ desktopCapturer, screen, data, lock, projectList, cleanEnv, work, brainstorm }) {
  const ctx = () => ({ data, lock });
  return {
    // Sessions (#369 stage 4): only the recorder's brainstorm-cto and brainstorm-pm, started
    // in that agent's own folder with a prompt; the page shows them with ui.terminal.
    sessions: () => ({
      startBrainstorm: (who, prompt, addDir) => brainstorm.start(who, String(prompt), String(addDir)),
      end: id => (/^brainstorm-(cto|pm)$/.test(String(id)) ? brainstorm.end(String(id)) : undefined),
      alive: id => brainstorm.alive(String(id)),
    }),
    // The screen to record. which: a display's id, 'primary', or '2' and '3' for that display in
    // Windows' order. Returns the desktop source id the page records with getUserMedia, and the
    // display's size in pixels.
    screen: () => ({
      async source(which) {
        const displays = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
        const want = displays.find(d => String(d.id) === String(which))
          || (which === 'primary' || !which ? primary : displays[Number(which) - 1] || primary);
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) throw new Error('Windows offered no screen to record');
        // With one display any source is it; with more, a guess would crop the wrong screen.
        const src = sources.find(s => String(s.display_id) === String(want.id)) || (displays.length === 1 ? sources[0] : null);
        if (!src) throw new Error('Windows did not say which screen is which, so the marked area could not be found');
        const { width, height } = want.size, f = want.scaleFactor || 1;
        return { id: src.id, name: src.name, width: Math.round(width * f), height: Math.round(height * f) };
      },
    }),
    // Boards: a project's name or Me. Every change goes through deck's run(), so it follows the
    // same rules (one-line text, no lost items) under the same lock as the deck command.
    boards: () => ({
      projects: () => projectList().filter(p => p.kind !== 'personal').map(p => p.name),
      open: board => parseTasks(deck(['show', board], ctx())).filter(t => t.mark !== 'x').map(t => ({ n: t.n, title: t.text })),
      add(board, { title, details = [], due = '' }) {
        const args = ['add', board, title];
        for (const d of details) args.push('--detail', d);
        if (due) args.push('--due', due);
        const m = deck(args, ctx()).match(/#(\d+) added/);
        if (!m) throw new Error(`could not add to ${board}`);
        return Number(m[1]);
      },
      detail: (board, n, text) => { deck(['detail', board, String(n), text], ctx()); },
      note: (board, text) => { deck(['note', board, text], ctx()); },
      show: (board, n) => deck(['show', board, ...(n == null ? [] : [String(n)])], ctx()),
      // Screenshots that outlive their recording (#1030) live in the data folder's screenshots/;
      // relink points every board's Screenshot lines under one folder at another, and returns
      // the old paths it moved (dry: the paths it would move, changing nothing).
      shotsHome: () => path.join(data, 'screenshots'),
      relink(from, to, dry) {
        const out = deck(['relink', String(from), String(to), ...(dry ? ['--dry'] : [])], ctx());
        return out === 'nothing to relink' ? [] : out.split('\n').filter(Boolean);
      },
    }),
    // One headless Claude turn, with nothing of the owner's setup loaded (the AI helper's way).
    // o: { system, text, model, effort, timeoutMs }. Resolves the reply text; throws Claude's error.
    claude: () => ({
      async turn({ system, text, model = 'sonnet', effort = 'medium', timeoutMs = 5 * 60000 }) {
        fs.mkdirSync(work, { recursive: true });
        const promptFile = path.join(path.dirname(work), `prompt-${crypto.randomUUID()}.txt`);
        fs.writeFileSync(promptFile, system);
        try {
          const r = await runTurn(helperCommand({ promptFile, model, effort }), String(text), {
            cwd: work, env: cleanEnv(process.env), timeout: timeoutMs, slow: `Claude took over ${Math.round(timeoutMs / 60000)} minutes and was stopped` });
          if (r.error) throw new Error(r.error);
          let o;
          try { o = JSON.parse(r.out); } catch { throw new Error(`Claude did not answer: ${(r.err || r.out).trim().split(/\r?\n/).pop() || 'no output'}`); }
          if (o.is_error) throw new Error(`Claude: ${String(o.result || o.subtype || 'error').slice(0, 300)}`);
          return String(o.result || '');
        } finally { try { fs.unlinkSync(promptFile); } catch { /* best effort */ } }
      },
    }),
  };
}
