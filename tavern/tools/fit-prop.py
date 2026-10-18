# Cuts the props out of their cleaned pictures and shrinks each to the people's scale (#251).
# Gemini draws every prop to fill its picture, so a stool comes out as tall as a person; each
# piece is brought to its real size (the barkeep is 105 pixels, about 180 cm). One art pixel of
# the result covers a block of the clean picture: it is drawn where at least half the block is,
# in the block's commonest colour, or its darkest when a third of the block is outline, so
# outlines survive the shrink.
# Usage: fit-prop.py layout.json clean_dir out_dir
# The layout lists pieces: {"name", "from" (clean picture, no extension), "pick" [k, n] (the
# k-th of the picture's n largest shapes, in reading order, from 1), and "height" or "scale"
# (a scale is shared by pieces drawn together, such as the bar's ends and middle).
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

layout, clean, out = sys.argv[1], sys.argv[2], sys.argv[3]
pieces = json.load(open(layout, encoding='utf-8'))
cache = {}

def edge(al):
    p = np.pad(~al, 1)
    return al & (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:])

# The magenta background left on the rim: a bright pink glow (a lamp's) is peeled off from the
# outside in; a darker pink rim pixel left after that becomes outline ink.
def unpink(im):
    for _ in range(40):
        r, g, b = [im[..., i].astype(int) for i in range(3)]
        peel = edge(im[..., 3] > 0) & (r - g > 50) & (b - g > 50) & (r > 180)
        if not peel.any():
            break
        im[peel, 3] = 0
    r, g, b = [im[..., i].astype(int) for i in range(3)]
    pink = (r - g > 40) & (b - g > 40) & (np.abs(r - b) < 70)
    im[edge(im[..., 3] > 0) & pink, :3] = (21, 10, 36)

def shapes(name, n):
    im = np.asarray(Image.open(f'{clean}/{name}.png').convert('RGBA')).copy()
    unpink(im)
    al = im[..., 3] > 0
    lab, m = ndimage.label(al, structure=np.ones((3, 3)))
    sizes = ndimage.sum(al, lab, range(1, m + 1))
    big = [int(i) + 1 for i in np.argsort(sizes)[::-1][:n]]
    com = {k: ndimage.center_of_mass(al, lab, k) for k in big}
    # Reading order: rows first (shapes whose middles are within a third of a shape's height of
    # each other share a row), then left to right.
    hgt = {k: np.ptp(np.where(lab == k)[0]) + 1 for k in big}
    row_of, anchor = {}, None
    for k in sorted(big, key=lambda k: com[k][0]):
        if anchor is None or com[k][0] - anchor > hgt[k] / 3:
            anchor = com[k][0]
        row_of[k] = anchor
    order = sorted(big, key=lambda k: (row_of[k], com[k][1]))
    # Every small loose shape goes with the nearest big one.
    own = np.zeros(m + 1, int)
    for k in range(1, m + 1):
        cy, cx = ndimage.center_of_mass(al, lab, k)
        own[k] = min(order, key=lambda b: (com[b][0] - cy) ** 2 + (com[b][1] - cx) ** 2)
    return im, lab, own, order

def shrink(fig, s):
    H, W = fig.shape[:2]
    h, w = max(1, round(H * s)), max(1, round(W * s))
    res = np.zeros((h, w, 4), np.uint8)
    for j in range(h):
        for i in range(w):
            y0, y1 = int(j * H / h), max(int(j * H / h) + 1, int((j + 1) * H / h))
            x0, x1 = int(i * W / w), max(int(i * W / w) + 1, int((i + 1) * W / w))
            blk = fig[y0:y1, x0:x1].reshape(-1, 4)
            on = blk[blk[:, 3] > 0]
            if len(on) * 2 < len(blk):
                continue
            lum = on[:, :3].astype(int).sum(1)
            dark = on[lum < 150]
            if len(dark) * 3 >= len(on):
                c = dark[lum[lum < 150].argmin()]
            else:
                cols, counts = np.unique(on[:, :3], axis=0, return_counts=True)
                c = cols[counts.argmax()]
            res[j, i, :3] = c[:3]
            res[j, i, 3] = 255
    return res

manifest = []
for p in pieces:
    key = (p['from'], p['pick'][1])
    if key not in cache:
        cache[key] = shapes(*key)
    im, lab, own, order = cache[key]
    mask = (lab > 0) & (own[lab] == order[p['pick'][0] - 1])
    ys, xs = np.where(mask)
    fig = im[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
    fig[~mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 3] = 0
    s = p['scale'] if 'scale' in p else p['height'] / fig.shape[0]
    res = shrink(fig, s)
    Image.fromarray(res).save(f"{out}/{p['name']}.png")
    manifest.append({'name': p['name'], 'w': res.shape[1], 'h': res.shape[0], 'from': p['from']})
    print(f"{p['name']}: {res.shape[1]}x{res.shape[0]} (from {fig.shape[1]}x{fig.shape[0]}, x{s:.3f})")
json.dump(manifest, open(f'{out}/props-manifest.json', 'w'), indent=1)
