# Cuts a cleaned sprite sheet (from depixel.py) into one transparent PNG per piece and writes
# a manifest. Pieces are the sheet's connected shapes (touching or one pixel apart); each is
# named by the nearest point in the layout file, which lists [name, x, y] in sheet pixels.
# Usage: cut-sheet.py cleaned.png layout.json out_dir source_name
import json
import sys
from collections import deque

import numpy as np
from PIL import Image

src, layout_file, out_dir, source = sys.argv[1:5]
im = np.asarray(Image.open(src).convert('RGBA'))
alpha = im[..., 3] > 0
H, W = alpha.shape
layout = json.load(open(layout_file, encoding='utf-8'))

# Shapes: flood fill over touching opaque pixels. A piece drawn in parts (a candle and its
# flame) comes back together because its parts share the nearest layout name.
label = np.zeros((H, W), int)
shapes = []
for y in range(H):
    for x in range(W):
        if not alpha[y, x] or label[y, x]:
            continue
        n = len(shapes) + 1
        label[y, x] = n
        q, pts = deque([(y, x)]), []
        while q:
            cy, cx = q.popleft()
            pts.append((cy, cx))
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and alpha[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = n
                        q.append((ny, nx))
        shapes.append(pts)

# A layout entry may carry a box [x0, y0, x1, y1]: everything opaque inside it is that piece,
# for pieces drawn touching another (logs against the hearth).
forced = {}
for e in layout:
    if len(e) > 3:
        x0, y0, x1, y1 = e[3]
        n = len(shapes) + 1
        sub = alpha[y0:y1, x0:x1] & (label[y0:y1, x0:x1] > 0)
        label[y0:y1, x0:x1][sub] = n
        ys, xs = np.where(sub)
        shapes.append(list(zip(ys + y0, xs + x0)))
        forced[n] = e[0]
for n, pts in enumerate(shapes, 1):
    shapes[n - 1] = [p for p in pts if label[p] == n]

# Tiny specks (fewer than 6 pixels) are left over from the background and are dropped.
pieces = {}
for n, pts in enumerate(shapes, 1):
    if len(pts) < 6:
        continue
    ys, xs = zip(*pts)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    name = forced.get(n) or min(layout, key=lambda e: (e[1] - cx) ** 2 + (e[2] - cy) ** 2)[0]
    pieces.setdefault(name, []).append(n)

manifest = []
for name, *_ in layout:
    ids = pieces.get(name)
    if not ids:
        print(f'MISSING {name}')
        continue
    mask = np.isin(label, ids)
    ys, xs = np.where(mask)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    out = np.zeros_like(im)
    out[mask] = im[mask]
    Image.fromarray(out[box[1]:box[3], box[0]:box[2]]).save(f'{out_dir}/{name}.png')
    manifest.append({'name': name, 'file': f'{name}.png', 'w': int(box[2] - box[0]), 'h': int(box[3] - box[1]),
                     'source': source, 'box': [int(v) for v in box]})
    print(f'{name:16} {box[2]-box[0]:3}x{box[3]-box[1]:<3} from {len(ids)} shape(s)')
json.dump(manifest, open(f'{out_dir}/manifest.json', 'w', encoding='utf-8'), indent=1)
