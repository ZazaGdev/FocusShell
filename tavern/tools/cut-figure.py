# Cuts one figure out of a cleaned character sheet (#252): the sheet's figures are its largest
# shapes, counted left to right; anything small and loose (specks, a detached key) goes with
# the figure it sits beside. Magenta fringe left by the clean-up is dropped. With a height, the
# figure is shrunk to it (each art pixel the colour most of its source pixels have).
# Usage: cut-figure.py clean.png index out.png [height]
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, index, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
args = [a for a in sys.argv[4:] if not a.startswith('--')]
height = int(args[0]) if args else 0
# --unpink: peel pink pixels (Gemini's pink shadow under the feet) off the figure's edge, for
# characters with no purple or pink of their own (#265).
unpink = '--unpink' in sys.argv
im = np.asarray(Image.open(src).convert('RGBA')).copy()
r, g, b, a = [im[..., i].astype(int) for i in range(4)]
# Holes the clean-up keyed out inside the figure (a dark patch close in hue to the background)
# come back with the colour they had, unless that colour is the background's own.
holes = ndimage.binary_fill_holes(a > 0) & (a == 0)
holes &= ~((r - g > 60) & (b - g > 60))  # magenta of any shade is background
im[holes, 3] = 255
# The outline came out mixed with the magenta: dark pixels with almost no green and red close to
# blue, within two pixels of the background. Where the pixel inside it is already dark it goes;
# otherwise it becomes the outline ink.
INK = (21, 10, 36)
def near_bg(al, d):
    out = np.zeros_like(al)
    p = np.pad(~al, d)
    for dy in range(-d, d + 1):
        for dx in range(-d, d + 1):
            out |= p[d + dy:d + dy + al.shape[0], d + dx:d + dx + al.shape[1]]
    return out & al
# Fringe: a bright magenta pixel (red and blue high, green far below both) beside the background.
r, g, b, a = [im[..., i].astype(int) for i in range(4)]
im[near_bg(a > 0, 2) & (r > 150) & (b > 150) & (g < 0.4 * np.minimum(r, b)), 3] = 0
for _ in range(2):
    r, g, b, a = [im[..., i].astype(int) for i in range(4)]
    al = a > 0
    tint = al & (g * 4 < np.minimum(r, b)) & (np.abs(r - b) < 40) & (np.maximum(r, b) > 30) & near_bg(al, 2)
    lum = r + g + b
    p = np.pad(al & ~tint & (lum < 140), 1)
    dark_inside = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    edge = near_bg(al, 1)
    im[tint & edge & dark_inside, 3] = 0
    im[tint & ~(edge & dark_inside), :3] = INK
alpha = im[..., 3] > 0
# A ground line drawn under the figures (some angle sheets, #262) would join them into one
# shape: a run of 30 or more pixels one or two rows thick, with little above or below it, goes.
for y in range(alpha.shape[0]):
    row, x = alpha[y], 0
    while x < len(row):
        if not row[x]:
            x += 1
            continue
        e = x
        while e < len(row) and row[e]:
            e += 1
        if e - x >= 30:
            above = alpha[max(0, y - 3):max(0, y - 2), x:e].mean() if y >= 3 else 0
            below = alpha[y + 3:y + 4, x:e].mean() if y + 3 < alpha.shape[0] else 0
            if above < 0.35 and below < 0.35:
                # Kept only right under a figure (two rows up is part of it).
                for yy in range(y, min(alpha.shape[0], y + 2)):
                    alpha[yy, x:e] &= alpha[max(0, y - 2), x:e]
        x = e
im[~alpha, 3] = 0
lab, n = ndimage.label(alpha, structure=np.ones((3, 3)))
# Two figures drawn touching come out as one shape: while there are not three figure-sized
# shapes (the third at least a quarter of the largest), the widest is split at its thinnest
# column near its middle.
while True:
    sizes = ndimage.sum(alpha, lab, range(1, n + 1))
    rank = np.argsort(sizes)[::-1]
    big = [i + 1 for i in rank[:3]]
    if len(rank) >= 3 and sizes[rank[2]] >= 0.25 * sizes[rank[0]]:
        break
    spans = {k: np.where((lab == k).any(0))[0] for k in big}
    widths = {k: spans[k].max() - spans[k].min() + 1 for k in big}
    wide = max(big, key=lambda k: widths[k])
    x0, w = spans[wide].min(), widths[wide]
    cols = (lab == wide).sum(0)
    cut = x0 + int(w * 0.3) + int(np.argmin(cols[x0 + int(w * 0.3):x0 + int(w * 0.7)]))
    piece = (lab == wide) & (np.arange(lab.shape[1]) > cut)[None, :]
    n += 1
    lab[piece] = n
    lab[:, cut][lab[:, cut] == wide] = 0
centres = {k: ndimage.center_of_mass(alpha, lab, k)[1] for k in big}
order = sorted(big, key=lambda k: centres[k])
xs = sorted(centres[k] for k in order)
# Every shape belongs to the figure whose centre is nearest.
own = np.zeros(n + 1, int)
for k in range(1, n + 1):
    cx = ndimage.center_of_mass(alpha, lab, k)[1]
    own[k] = order[int(np.argmin([abs(cx - c) for c in xs]))]
mask = (lab > 0) & (own[lab] == order[index])
ys, xs_ = np.where(mask)
fig = im[ys.min():ys.max() + 1, xs_.min():xs_.max() + 1].copy()
fig[~mask[ys.min():ys.max() + 1, xs_.min():xs_.max() + 1], 3] = 0
fig[..., 3] = np.where(fig[..., 3] > 0, 255, 0)
if unpink:
    # The shadow sits between and under the feet, so pink in the bottom rows goes; a stray pink
    # pixel higher up becomes outline ink.
    r, g, b = [fig[..., i].astype(int) for i in range(3)]
    pink = (fig[..., 3] > 0) & (r - g > 50) & (b - g > 50)
    low = np.arange(fig.shape[0])[:, None] >= fig.shape[0] * 0.85
    fig[pink & low, 3] = 0
    fig[pink & ~low, :3] = (21, 10, 36)
# What is left of a ground line sticks out past the feet along the bottom rows: gone, then the
# figure is cropped again.
for y in range(fig.shape[0] - 1, max(1, fig.shape[0] - 4), -1):
    fig[y, fig[y - 2, :, 3] == 0, 3] = 0
ys, xs_ = np.where(fig[..., 3] > 0)
fig = fig[ys.min():ys.max() + 1, xs_.min():xs_.max() + 1]
if height:
    H, W = fig.shape[:2]
    w = max(1, round(W * height / H))
    small = np.zeros((height, w, 4), np.uint8)
    for j in range(height):
        for i in range(w):
            blk = fig[j * H // height:max(j * H // height + 1, (j + 1) * H // height), i * W // w:max(i * W // w + 1, (i + 1) * W // w)].reshape(-1, 4)
            if (blk[:, 3] > 0).sum() * 2 < len(blk):
                continue
            cols, counts = np.unique(blk[blk[:, 3] > 0][:, :3], axis=0, return_counts=True)
            small[j, i, :3] = cols[counts.argmax()]
            small[j, i, 3] = 255
    fig = small
Image.fromarray(fig).save(out)
print(f'{out}: {fig.shape[1]}x{fig.shape[0]}')
