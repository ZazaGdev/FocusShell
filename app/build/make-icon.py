"""Draws the FocusShell logo: the manager pane on the left, four project panes on the right.

Run: python app/build/make-icon.py
Writes icon.ico (Windows shortcut and window icon) and icon.png next to this file.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
S = 1024                       # draw large, then scale down for each size
BG = (22, 22, 26, 255)         # graphite surface
EDGE = (44, 44, 49, 255)
MANAGER = (155, 155, 240, 255) # Graphite accent violet
PANE = (74, 74, 86, 255)
PANE_LIT = (120, 120, 136, 255)


def draw(size_hint: int) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([24, 24, S - 24, S - 24], radius=210, fill=BG, outline=EDGE, width=12)
    # Small icons get bigger gaps so the panes stay readable at 16-32 px.
    gap = 70 if size_hint <= 32 else 44
    pad = 190 if size_hint <= 32 else 200
    inner = S - 2 * pad
    left_w = int(inner * 0.36)
    r = 60 if size_hint <= 32 else 46
    d.rounded_rectangle([pad, pad, pad + left_w, S - pad], radius=r, fill=MANAGER)
    x0 = pad + left_w + gap
    cell_w = (S - pad - x0 - gap) // 2
    cell_h = (inner - gap) // 2
    for row in range(2):
        for col in range(2):
            x = x0 + col * (cell_w + gap)
            y = pad + row * (cell_h + gap)
            colour = PANE_LIT if (row, col) == (0, 0) else PANE
            d.rounded_rectangle([x, y, x + cell_w, y + cell_h], radius=r, fill=colour)
    return img


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [draw(n).resize((n, n), Image.LANCZOS) for n in sizes]
    frames[-1].save(HERE / "icon.ico", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    draw(256).resize((256, 256), Image.LANCZOS).save(HERE / "icon.png")
    draw(256).resize((64, 64), Image.LANCZOS).save(HERE.parent / "renderer" / "logo.png")
    print("wrote", HERE / "icon.ico")


if __name__ == "__main__":
    main()
