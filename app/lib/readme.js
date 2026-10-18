// The first paragraph of a README that says something: skips headings, badges,
// images, HTML, front matter and empty lines.
export function readmeSummary(md, max = 600) {
  const text = String(md || '').replace(/^﻿/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const paras = text.split(/\r?\n\s*\r?\n/);
  for (const raw of paras) {
    const p = raw.trim();
    if (!p) continue;
    if (/^#{1,6}\s/.test(p) && !p.includes('\n')) continue;
    if (/^(!\[|\[!\[|<|```|\|)/.test(p)) continue;
    const clean = p.split(/\r?\n/).filter(l => !/^#{1,6}\s/.test(l)).join(' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 20) continue;
    return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
  }
  return '';
}
