// "Push without asking" for one project: permission rules in that project's
// .claude/settings.local.json. On adds them, off removes exactly them; every other key and
// rule in the file stays. Force pushes keep asking (as far as a rule prefix can tell).

export const PUSH_ALLOW = ['Bash(git push:*)'];
export const PUSH_ASK = ['Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(git push --force-with-lease:*)'];

function parse(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) return {};
  const d = JSON.parse(t);
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('settings file is not a JSON object');
  return d;
}

export function pushAllowed(text) {
  try {
    const allow = (parse(text).permissions || {}).allow;
    return Array.isArray(allow) && PUSH_ALLOW.every(r => allow.includes(r));
  } catch { return false; }
}

// Returns the new file text. Throws if the file is not valid JSON, so nothing is overwritten.
export function setPushRule(text, on) {
  const d = parse(text);
  const perms = d.permissions && typeof d.permissions === 'object' ? d.permissions : {};
  const change = (key, rules) => {
    const list = Array.isArray(perms[key]) ? perms[key] : [];
    const next = on ? [...list, ...rules.filter(r => !list.includes(r))] : list.filter(r => !rules.includes(r));
    if (next.length) perms[key] = next; else delete perms[key];
  };
  change('allow', PUSH_ALLOW);
  change('ask', PUSH_ASK);
  if (Object.keys(perms).length) d.permissions = perms; else delete d.permissions;
  return JSON.stringify(d, null, 2) + '\n';
}
