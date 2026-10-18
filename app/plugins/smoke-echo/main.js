// Echo's main side: one handler that answers, one that throws on purpose, and its shortcut.
export function activate(host) {
  let presses = 0;
  host.handle('echo', text => {
    const s = host.settings(), out = `${s.greeting} ${text}`;
    return s.loud ? out.toUpperCase() : out;
  });
  host.handle('boom', () => { throw new Error('boom on purpose'); });
  host.shortcut(() => host.emit('key', ++presses));
  return { deactivate() {} };
}
