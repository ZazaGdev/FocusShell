// Images in a card's Answer box (#1731): a pasted or dropped image shows as a small thumbnail
// under the box, and on Send it is saved as a .png whose full path goes at the end of the line.
// Text pastes as before.
// pasteShots(h, icon, deck, box) -> { strip, has(), take() -> paths, clear() }
export function pasteShots(h, icon, deck, box) {
  const shots = [];
  const strip = h('div', { class: 'ashots', hidden: true });
  const draw = () => {
    strip.hidden = !shots.length;
    strip.replaceChildren(...shots.map(s => h('span', { class: 'ashot' }, h('img', { src: s.url, alt: 'Pasted image' }),
      h('button', { class: 'ashotx', title: 'Remove this image', 'aria-label': 'Remove this image', onclick: () => drop(s) }, icon('x')))));
  };
  const drop = s => { URL.revokeObjectURL(s.url); shots.splice(shots.indexOf(s), 1); draw(); };
  const add = files => {
    const imgs = files.filter(f => f && /^image\//.test(f.type));
    for (const f of imgs) shots.push({ file: f, url: URL.createObjectURL(f) });
    if (imgs.length) draw();
    return imgs.length;
  };
  box.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (add(files) && !e.clipboardData.getData('text')) e.preventDefault();
  });
  box.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => /^image\//.test(i.type))) e.preventDefault(); });
  box.addEventListener('drop', e => { if (add([...(e.dataTransfer?.files || [])])) e.preventDefault(); });
  const clear = () => { for (const s of shots) URL.revokeObjectURL(s.url); shots.length = 0; draw(); };
  const take = async () => {
    const paths = [];
    for (const s of shots) {
      // Converted to PNG first, so a pasted JPEG or GIF still lands as the .png it is named.
      const bmp = await createImageBitmap(s.file), c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      const png = await new Promise(r => c.toBlob(r, 'image/png'));
      const p = png && await deck.saveAnswerImage(new Uint8Array(await png.arrayBuffer()));
      if (p) paths.push(p);
    }
    return paths;
  };
  // A card built again keeps the images of the one it replaces (#1734 keeps the typed text).
  const adopt = from => { if (from && from.has()) { shots.push(...from.list.splice(0)); draw(); } };
  return { strip, list: shots, has: () => shots.length > 0, take, clear, adopt };
}

// The line with the images' paths at its end.
export const withShots = (text, paths) => [String(text || '').trim(), ...paths.map(p => `Image: ${p}`)].filter(Boolean).join(' ');
