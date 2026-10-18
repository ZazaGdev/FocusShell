# Turns an upscaled, JPEG-blurred pixel-art image back into its real pixels: finds the grid
# (period and offset per axis), takes each cell's middle colour, keys out the background and
# reduces everything to one small palette. Usage: depixel.py in.jpg out.png [colours] [period]
# A period (such as 5.865) fixes the grid size when the search picks a wrong one (#265).
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
ncol = int(sys.argv[3]) if len(sys.argv) > 3 else 32
fixed = float(sys.argv[4]) if len(sys.argv) > 4 else None
im = np.asarray(Image.open(src).convert('RGB')).astype(float)
H, W, _ = im.shape
bg = np.median(np.concatenate([im[:8].reshape(-1, 3), im[-8:].reshape(-1, 3)]), axis=0)

def grid(axis):
    d = np.abs(np.diff(im, axis=axis)).sum(2)
    g = d.sum(0) if axis == 1 else d.sum(1)
    best = (0, 0, 0)
    for p in ([fixed] if fixed else np.arange(5.0, 7.0, 0.005)):
        n = int((len(g) - 1) / p)
        for o in np.arange(0, p, 0.1):
            idx = np.minimum(len(g) - 1, (o + np.arange(n) * p).astype(int))
            s = g[idx].mean()
            if s > best[0]:
                best = (s, p, o)
    return best[1], best[2]

px, ox = grid(1)
py, oy = grid(0)
cols, rows = int((W - ox) / px), int((H - oy) / py)
cells = np.zeros((rows, cols, 3))
for j in range(rows):
    for i in range(cols):
        x0, y0 = ox + i * px, oy + j * py
        a = im[int(y0 + py * 0.3):int(y0 + py * 0.7) + 1, int(x0 + px * 0.3):int(x0 + px * 0.7) + 1]
        cells[j, i] = np.median(a.reshape(-1, 3), axis=0)

# Background (and the soft drop shadow beside parts) out: near the background colour, or a
# darker shade of the same grey/magenta hue with low contrast.
dist = np.abs(cells - bg).sum(2)
shade = cells / np.maximum(1, cells.sum(2, keepdims=True)) - bg / bg.sum()
alpha = ~((dist < 70) | ((np.abs(shade).sum(2) < 0.05) & (dist < 150)))
# Specks left from the drop shadow: kept cells with at most one kept neighbour go.
for _ in range(2):
    p = np.pad(alpha, 1)
    n = p[:-2, 1:-1].astype(int) + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]
    alpha = alpha & (n >= 2)

# One palette: k-means on the kept cells.
pts = cells[alpha]
rng = np.random.default_rng(1)
cent = pts[rng.choice(len(pts), ncol, replace=False)]
for _ in range(30):
    lab = np.argmin(((pts[:, None] - cent[None]) ** 2).sum(2), 1)
    for k in range(ncol):
        if (lab == k).any():
            cent[k] = pts[lab == k].mean(0)
lab = np.argmin(((cells[..., None, :] - cent[None, None]) ** 2).sum(3), 2)
outimg = np.zeros((rows, cols, 4), np.uint8)
outimg[..., :3] = cent[lab].round().astype(np.uint8)
outimg[..., 3] = np.where(alpha, 255, 0)
# Crop to the art.
ys, xs = np.where(alpha)
Image.fromarray(outimg).save(out)
print(f'grid {px:.3f}x{py:.3f} offset {ox:.1f},{oy:.1f} -> {cols}x{rows}; art bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()} ({xs.max()-xs.min()+1}x{ys.max()-ys.min()+1})')
