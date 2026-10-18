// The owner's words, typed on the owner's click (#228). A lead that needs the owner's own
// words in its pane asks for them; the CTO files the request with ask-owner.ps1 as
// state/requests/words-<id>.req; the app shows it as a card, and only the owner's click on
// that card types the stored words into that lead's pane. Nothing here types anything.

export const MAX_WORDS = 500;
export const EXPIRES = 24 * 60 * 60 * 1000;

// A request file's JSON, checked: { id, project, lead, task, words, why, created } or
// { error }. The words must be one line the owner can read whole on the card.
export function parseRequest(id, body, now = Date.now()) {
  let r;
  try { r = JSON.parse(String(body).replace(/^﻿/, '')); } catch { return { error: 'the request is not JSON' }; }
  if (!r || typeof r !== 'object') return { error: 'the request is not JSON' };
  const words = String(r.words ?? ''), why = String(r.why ?? '').replace(/\s+/g, ' ').trim();
  const project = String(r.project ?? ''), task = Number(r.task) || null;
  if (!/^[\w.-]+$/.test(project)) return { error: 'no project' };
  if (!words.trim()) return { error: 'no words' };
  if (/[\x00-\x1f\x7f]/.test(words)) return { error: 'the words hold a line break or control character' };
  if (words.length > MAX_WORDS) return { error: `the words are longer than ${MAX_WORDS} characters` };
  const lead = r.second ? `lead-${project}-2` : `lead-${project}`;
  const created = Number(r.created) || now;
  if (now - created > EXPIRES) return { error: 'the request is older than 24 hours' };
  return { id: String(id), project, lead, task, words, why, created };
}

// The session a lead runs as: lead-<Project> is session <Project>, lead-<Project>-2 is <Project>:2.
export const sessionOfLead = (project, lead) => (lead === `lead-${project}-2` ? `${project}:2` : project);

// What the CTO is told after the owner's click, typed into its prompt like a card's ANSWER.
export function ctoLine(r, outcome) {
  const what = outcome === 'typed' ? `the owner approved; typed into ${r.lead}: "${r.words}"`
    : outcome === 'declined' ? `the owner declined; nothing typed into ${r.lead}`
    : `not typed: ${outcome}`;
  return `WORDS ${r.project}${r.task ? ` #${r.task}` : ''}: ${what}`;
}
