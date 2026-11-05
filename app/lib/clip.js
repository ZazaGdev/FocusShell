// The owner's clipboard is theirs (#1902). Smoke and try runs use a clipboard of their own in
// memory, so nothing they copy reaches the owner's clipboard or Win+V history; and a Sketch
// Insert puts back whatever the owner had copied once Claude Code has taken the picture.

// A clipboard in memory with the calls of Electron's: { text } or { png: Uint8Array } or nothing.
export function memoryClipboard() {
  let held = null;
  return {
    async readText() { return held && held.text != null ? held.text : ''; },
    async has(type) { return !!held && ((type === 'image/png' && !!held.png) || (type === 'text/plain' && held.text != null)); },
    async writeText(text) { held = { text: String(text) }; },
    async writePng(png) { held = { png: new Uint8Array(png) }; },
    async clear() { held = null; },
    peek() { return held; },
  };
}

// Everything on a clipboard, to put back later: [{ type: data }] per item, or null if unreadable.
// read(): Electron's clipboard.read(), items with .types and .getType(type).
export async function keepClipboard(read) {
  try {
    const items = await read();
    return await Promise.all(items.map(async it => Object.fromEntries(await Promise.all(it.types.map(async t => [t, await it.getType(t)])))));
  } catch { return null; }
}

// Waits until done() says the paste was taken, or ms pass, checking every `every` ms.
export function whenTaken(done, ms = 8000, every = 200) {
  return new Promise(res => {
    const t0 = Date.now();
    const tick = () => (done() || Date.now() - t0 >= ms ? res(done()) : setTimeout(tick, every));
    tick();
  });
}

// Puts a kept clipboard back: the same items, or empty if it was empty. An unreadable one is left alone.
// clip: { write(items), clear() }; make(record) builds one clipboard item from { type: data }.
export async function putBack(clip, kept, make) {
  if (!kept) return false;
  if (!kept.length) { await clip.clear(); return true; }
  await clip.write(kept.map(make));
  return true;
}
