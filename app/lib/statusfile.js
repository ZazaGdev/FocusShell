// The Status view's file (#383): state/lead-status.json in the data folder, written whole.
import fs from 'node:fs';
import path from 'node:path';
import { parseStatus } from './status.js';

export const statusFile = data => path.join(data, 'state', 'lead-status.json');

export function readStatus(file) {
  try { return parseStatus(fs.readFileSync(file, 'utf8')); } catch { return { leads: {} }; }
}

export function writeStatus(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(st, null, 2));
  fs.renameSync(file + '.tmp', file);
}
