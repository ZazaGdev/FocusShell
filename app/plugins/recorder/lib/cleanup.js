// Old recordings deleted after the time the owner picked (#1030). The recording open in the
// recorder never goes; the rest are timed from when they stopped (or started, if never stopped).
export const KEEP_FOR = { never: null, '24 hours': 24 * 3600e3, 'a week': 7 * 24 * 3600e3, 'a month': 30 * 24 * 3600e3 };
export const KEEP_CHOICES = Object.keys(KEEP_FOR);

// The ids of the recordings to delete now. sessions: what loadAll read; current: the open one's id.
export function expired(sessions, keepFor, now = Date.now(), current = null) {
  const ms = KEEP_FOR[keepFor];
  if (!ms) return [];
  return (sessions || []).filter(s => s && s.id && s.id !== current && now - (s.stoppedAt || s.startedAt || now) > ms).map(s => s.id);
}

// A screenshot's copy that outlives its recording: <keep>\<recording id>\<file name>.
export const keptPath = (keep, id, shot) => `${String(keep).replace(/[\\/]+$/, '')}\\${id}\\${String(shot).split(/[\\/]/).pop()}`;
