// Saved Sketch boards (#130). One Excalidraw file per board in the data folder,
// sketches/<Project>/<id>.excalidraw, with a PNG preview beside it (<id>.png). An item
// carries a board as a detail line "> Sketch: sketches/<Project>/<id>.excalidraw"; one board
// can hang off several items: Me to-dos, ideas, notes and any project's tasks.
// Notes have no number, so a note's detail lines simply follow its own line in notes.md.
import { parseTasks } from './tasks.js';

const SAFE_PROJECT = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/;
const REL_RE = /^sketches\/([^\\/:*?"<>|]+)\/([a-z0-9][a-z0-9-]{0,59})\.excalidraw$/;
const LINE_RE = /^\s+> ?Sketch:\s*(.+?)\s*$/i;
const NOTE_RE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.+)$/;

export const sketchRel = (project, id) => `sketches/${project}/${id}.excalidraw`;
export function parseRel(rel) {
  const m = String(rel).match(REL_RE);
  return m && SAFE_PROJECT.test(m[1]) ? { project: m[1], id: m[2] } : null;
}
// A readable name from the id: "ai-limits" reads "ai limits".
export const sketchName = rel => (parseRel(rel) || { id: '' }).id.replace(/-/g, ' ');

// An id from the name the owner typed, unique among `taken`.
export function sketchId(name, taken = []) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'sketch';
  let id = base;
  for (let k = 2; taken.includes(id); k++) id = `${base}-${k}`;
  return id;
}

// The boards an item carries, from its detail lines, in order.
export const sketchesOf = item => (item.details || []).map(d => (d.match(/^Sketch:\s*(.+?)\s*$/i) || [])[1]).filter(r => r && parseRel(r));

// Where an item's detail lines end: tasks by number, notes by their own line.
function blockEnd(lines, i) {
  let end = i + 1;
  while (end < lines.length && /^\s+> ?/.test(lines[end])) end++;
  return end;
}
const taskLine = (lines, n) => lines.findIndex(l => new RegExp(`^- \\[.\\] #${Number(n)}\\b`).test(l));
const noteLine = (lines, when, text) => lines.findIndex(l => { const m = l.match(NOTE_RE); return m && m[1] === when && m[2] === text; });

function attachAt(md, i, rel) {
  const lines = String(md).split(/\r?\n/);
  if (i < 0 || !parseRel(rel)) return String(md);
  const end = blockEnd(lines, i);
  if (lines.slice(i + 1, end).some(l => (l.match(LINE_RE) || [])[1] === rel)) return String(md);
  return [...lines.slice(0, end), `  > Sketch: ${rel}`, ...lines.slice(end)].join('\n');
}
function detachAt(md, i, rel) {
  const lines = String(md).split(/\r?\n/);
  if (i < 0) return String(md);
  const end = blockEnd(lines, i);
  return [...lines.slice(0, i + 1), ...lines.slice(i + 1, end).filter(l => (l.match(LINE_RE) || [])[1] !== rel), ...lines.slice(end)].join('\n');
}
export const attachToTask = (md, n, rel) => attachAt(md, taskLine(String(md).split(/\r?\n/), n), rel);
export const detachFromTask = (md, n, rel) => detachAt(md, taskLine(String(md).split(/\r?\n/), n), rel);
export const attachToNote = (md, when, text, rel) => attachAt(md, noteLine(String(md).split(/\r?\n/), when, text), rel);
export const detachFromNote = (md, when, text, rel) => detachAt(md, noteLine(String(md).split(/\r?\n/), when, text), rel);
// A deleted board leaves no line pointing at it, in any file.
export const dropSketch = (md, rel) => String(md).split(/\r?\n/).filter(l => (l.match(LINE_RE) || [])[1] !== rel).join('\n');

// A renamed board (#144): every line that pointed at `from` points at `to`, in any file.
export const renameSketch = (md, from, to) => String(md).split(/\r?\n/)
  .map(l => ((l.match(LINE_RE) || [])[1] === from ? l.replace(from, to) : l)).join('\n');

// Notes with the boards they carry, oldest first.
export function notesWithSketches(md) {
  const out = [];
  for (const l of String(md).split(/\r?\n/)) {
    const m = l.match(NOTE_RE);
    if (m) { out.push({ when: m[1], text: m[2], sketches: [] }); continue; }
    const s = l.match(LINE_RE);
    if (s && out.length && parseRel(s[1])) out[out.length - 1].sketches.push(s[1]);
  }
  return out;
}

// Every item that carries a board: "idea #2", "Me #4", "Clipper #30", "a note".
// data: { tasks: { project: md }, ideas: md, notes: md }
export function usesOf(rel, data) {
  const out = [];
  for (const t of parseTasks(data.ideas || '')) if (sketchesOf(t).includes(rel)) out.push({ kind: 'idea', n: t.n, text: t.text, label: `idea #${t.n}` });
  for (const [project, md] of Object.entries(data.tasks || {})) {
    for (const t of parseTasks(md)) if (sketchesOf(t).includes(rel)) out.push({ kind: 'task', project, n: t.n, text: t.text, label: `${project} #${t.n}` });
  }
  for (const n of notesWithSketches(data.notes || '')) if (n.sketches.includes(rel)) out.push({ kind: 'note', when: n.when, text: n.text, label: 'a note' });
  return out;
}
