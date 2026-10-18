# Tavern art

Pixel art for the Pixel Tavern, made by the owner in Google Gemini and cleaned into true pixel
art here. All of it is the owner's own generated art; nothing is taken from other games.

## Folders

- `source/`: the untouched Gemini images, exactly as downloaded.
- `clean/`: each source snapped back to its real pixel grid by `../tools/depixel.py`: one
  image pixel per art pixel, background removed, reduced to one small palette.
- `sprites/`: one transparent PNG per piece, cut from the clean sheets by
  `../tools/cut-sheet.py`, with `manifest.json` listing each piece's name, size, source image
  and its box in the clean sheet.
- `furniture-layout.json`: where each named piece sits on the clean furniture sheet, which
  the cutter uses to name the shapes it finds.

## Sources

| File in `source/` | Gemini download name | What it is | Made |
| --- | --- | --- | --- |
| `barkeep-standing.jpg` | `Gemini_Generated_Image_uanzu7uanzu7uanz.jpg` | the barkeep standing, magenta background | 2026-10-09, Gemini, owner-generated |
| `barkeep-parts.jpg` | `Gemini_Generated_Image_d5z6mld5z6mld5z6.jpg` | the barkeep's parts: head, torso with apron, arms, boots, hair | 2026-10-09, Gemini, owner-generated |
| `furniture-sheet.jpg` | `Gemini_Generated_Image_yodepeyodepeyode.jpg` | the furniture and props sheet, pink background | 2026-10-09, Gemini, owner-generated, from the prompts in `briefs/FocusShell/tavern-prompts.md` |
| `furniture-sheet-2.jpg` | `Gemini_Generated_Image_kaa7p8kaa7p8kaa7.jpg` | a larger bar (middle and both ends) on top; the bottom half repeats sheet 1 from the bench to the cat | 2026-10-09, Gemini, owner-generated |

| `barkeep-face-wide.jpg` | `barkeep-face-wide.jpg` (from Downloads) | the barkeep as the owner's likeness: sunglasses, headphones, same body and pose as the first barkeep, magenta background (#254) | 2026-10-09, Gemini, owner-generated |
| `barkeep-face.jpg` | `barkeep-face.jpg` | the same drawing on a narrower canvas, at a larger pixel size (6.9), so not used | 2026-10-09, Gemini, owner-generated |
| `barkeep-face-parts.jpg` | `barkeep-face-parts.jpg` | his parts sheet; not used, the rig cuts its parts from the standing image | 2026-10-09, Gemini, owner-generated |

| `barkeep-v2.jpg` | `barkeep-v2.jpg` | the owner-likeness barkeep in barkeep clothes: no headphones or glasses, white shirt, burgundy waistcoat, black half apron with a towel (#259) | 2026-10-09, Gemini, owner-generated |

Barkeep v2 (`sprites/barkeep-v2.png`, 51x105, also `demos/room/barkeep.png`) is
`clean/barkeep-v2.png` (cleaned at its own pixel size, 6.9) cropped at x 60-110, y 13-117, with
colours snapped to the first barkeep's palette as below; his body lines up with the first
barkeep's within 5 pixels and nothing stands above it. The #254 version stays archived as
`sprites/barkeep-owner.png`.

The owner-likeness barkeep (`sprites/barkeep-owner.png`, 51x106, also `demos/room/barkeep.png`)
is `clean/barkeep-face-wide.png` cropped to the figure (x 94-144, y 11-116), with each colour
within 30 (summed RGB) of the first barkeep's palette snapped to it, so the rig's apron and
trouser colours match. His body lines up with the first barkeep's pixel for pixel; the
headphones stand one row above, which the rig takes as an extra head row. The first barkeep's
files stay as they are: the room's guest is still drawn from him.

| `robot-<name>.jpg` (18) | `<name>.jpg` (from Downloads, via `briefs/FocusShell/tavern-chars/`) | the owner's robots, one sheet each: two front views (one plain, one holding its item) and a back view, magenta background (#252). Names: cto, pm, focus-shell, ai-fun, budget-expense-tracker, compass, builder, claude-setup, gym, research, web, video-editor, personal, spare (miner), spare-1 (hooded cloak), helper (tray), helper-2 (mushroom cap, scroll), general-1 (plain, for projects without their own robot) | 2026-10-09, Gemini, owner-generated |

Each robot sprite (`sprites/robot-<name>.png`) is the front view with its arms free: the middle
figure on the CTO's sheet, the left one on every other sheet. The item views and the back views
stay in the sources for later. The helpers are drawn full size on their sheets and are shrunk to
85 rows (50x85 and 46x85), about three quarters of a robot (#263; first 52 rows). No parts sheets are needed: like the barkeep, each robot's parts are
cut from its standing image, by the body layout in `demos/room/robots.js`. Projects without a
robot of their own get one picked from their name, or `general-1` when the owner sets that in
Settings (#358).

```
python tavern/tools/depixel.py tavern/art/source/robot-<name>.jpg tavern/art/clean/robot-<name>.png 32
python tavern/tools/cut-figure.py tavern/art/clean/robot-<name>.png <0 left, 1 middle> tavern/art/sprites/robot-<name>.png [52 for a helper]
```

| `prop-<name>.jpg` (18) | `<name>.jpg` (from Downloads, via `briefs/FocusShell/tavern-props/`) | the owner's props, one picture each (#251): bar-counter (left end, middle, right end, a grid drawn behind), bar-stool, bar-table, bar-chair (facing right and left), bar-bench, bar-keg, barrel-crate (a barrel, and a barrel in front of a crate), sacks, bottle-shelf, fireplace, fire-animated (8 frames; the bottom 4 are used, the top ones sit on purple squares), candle (unlit and 3 flame frames), candelabra, wall-torch (3 frames), hanging-lantern, door (in fact the window, night and day), door-2 (the door, closed and open), notice-board (with a lamp) | 2026-10-09, Gemini, owner-generated |

Gemini draws each prop to fill its picture, so they all come out too big for the people.
`../tools/fit-prop.py` cuts each piece out of its cleaned picture and shrinks it to its real size
(the heights or shared scales are in `props-layout.json`), keeping outlines; the results are in
`props/` with `props/props-manifest.json`. The room uses them under `p:` names. The pieces not
sent yet (shields, painting, rug, cat, plant, logs, the small things on the tables) are left out
of the room until they come.

```
python tavern/tools/depixel.py tavern/art/source/prop-<name>.jpg tavern/art/clean/prop-<name>.png 48
python tavern/tools/fit-prop.py tavern/art/props-layout.json tavern/art/clean tavern/art/props
```

| `prop2-<name>.jpg` (17) | `<name>.jpg` (via `briefs/FocusShell/tavern-props-2/`) | round 2 props (#261), from `briefs/FocusShell/tavern-prompts-2.md`: counter (front with taps), corner-counter (3/4 pieces, not used: drawn at half the counter's scale and not front-on), bar-counter-ends, bar-taps, bar-barrel-rack, bar-back-shelf, table (long), table-small (square), round, round-1 (small round), table-barrel, bench-long, stools (3), chairs (2), fireplace (front-on, with chimney), fire (4 frames), window (arched, night and day) | 2026-10-09, Gemini, owner-generated |

Round 2 pieces are fitted the same way, under `r2-` names in `props-layout.json`. The corner bar is
the counter with taps and, at its left, end blocks stepping back to the wall; its right end is
open. The round 1 bar, round tables, fireplace and window stay in `props/` but are no longer
placed.

| `<name>-angles.jpg` (7) | `<name>-angles.jpg` (via `briefs/FocusShell/tavern-chars/angles/`) | side walking, side standing and back views (#262) for focus-shell, ai-fun, barkeep (v2), compass, budget-tracker, cto, pm | 2026-10-09, Gemini, owner-generated |

The angle views live in `sprites/angles/` as `<name>-side.png` and `<name>-back.png`, listed in
`sprites/angles/angles.json`, which the room reads: a character listed there is drawn from the
side when walking left or right and from behind when walking away. The CTO's sheet has no true
side view (both of its "side" figures are three-quarter front), so only its back is used. To add
a character later, clean its sheet and run, from `tavern/`:

```
python tools/depixel.py art/source/<sheet>.jpg art/clean/<sheet>.png 32
python tools/cut-angles.py art/clean/<sheet>.png <robot name> [--no-side]
```

| `prop3-<name>.jpg` (13) | `<name>.jpg` (via `briefs/FocusShell/tavern-props-3/`) | round 3 decorations (#266): antlers, broom-bucket, cat (two frames, breathing), table-clutter (mugs, tankard, jug, bread, candle), painting, plant, rug, shields (round, crest), floor-tile, wall-tile; and the back wall behind the bar (#268): back-tap-ledge, back-mug-rack, back-chalkboard | 2026-10-09, Gemini, owner-generated |
| `prop4-beers.jpg` | `briefs/FocusShell/prop-beers.jpg` | four beer mugs on magenta: wooden tankard, glass pint, pewter stein with its lid open, clay mug (#307). Fitted at a shared scale of 0.3 as `r4-beer-*`, 13-14 pixels wide; each idle robot drinks from one, chosen from its name | 2026-10-09, Gemini, owner-generated |

Round 3 pieces are fitted under `r3-` names in `props-layout.json`. The floor and wall tiles are
used only with `?tiles` (both) or `?tiles=wall` in the room's address, pending the owner's choice.

The approved walk for the room is speed 3, frame rate 15 (30 until #269), bob 2.5 (6 until #271), arm swing 5.5,
leg swing 4, head tilt 2.5; each character keeps its own animation clock and a pace a few percent
apart, so no two walk in step (#269). Full notes in `docs/superpowers/specs/2026-10-09-tavern-art-design.md`.

From sheet 2 only the bar pieces are cut (`bar-large-left`, `bar-large-mid`, `bar-large-right`,
layout in `furniture-2-layout.json`). Its bottom half is the same drawing as sheet 1, differing
only in how the clean-up rounded the colours, so sheet 1's pieces are kept for those.

Scale: every sheet is drawn at the same pixel size, but the pieces are not all at the people's
scale. The room shows everything 1:1 so all pixels match the people's. The big bar and the
small props (mugs, tankard, jug, bread and cheese, candles, candelabra, torch, lantern, cat) fit
the barkeep as they are. The rest of sheet 1 is drawn too small for him.

## To regenerate at the people's scale

The barkeep is 51x105 pixels (about 180 cm, so about 0.58 pixels a centimetre). These pieces
need drawing again in Gemini, same style and pixel size, at roughly these sizes in pixels (width
x height); until then the room uses them 1:1 as they are.

| Piece | Now | Needed |
| --- | --- | --- |
| table-round | 26x26 | about 46x44 |
| chair-left, chair-right | 16x27 | about 30x55 |
| stool, stool-2, stool-3 (bar stools) | 13x20-23 | about 24x44 |
| bench | 36x14 | about 66x26 (the room uses a code-drawn bench of that size until then) |
| barrel, barrel-2 | 18x26 | about 34x52 |
| barrel-tap | 25x29 | about 44x52 |
| keg-crate | 13x25 | about 26x50 |
| sacks | 16x18 | about 30x34 |
| plant | 19x27 | about 30x52 |
| fireplace | 35x28 | about 105x88 |
| logs | 13x12 | about 26x22 |
| window-night | 27x28 | about 52x56 |
| door | 25x27 | about 62x116 (left out of the room until then) |
| shelf-bottles | 30x26 | about 58x50 |
| notice-board | 35x24 | about 58x40 |
| shield-wolf, shield-lion | 19x20, 16x22 | about 34x36, 30x40 |
| painting | 28x22 | about 44x34 |
| rug | 37x21 | about 116x60 |
| bar end pieces (both sheets) | three-quarter view | front-on ends that join the big bar's middle, same height (46) |

The Gemini images are true pixel art drawn about 5.87 screen pixels per art pixel and saved as
JPEG, so the cleaned versions are 238x130 (barkeep) and 239x130 (furniture) art pixels.

## Redo the clean-up

From the repo root:

```
python tavern/tools/depixel.py tavern/art/source/furniture-sheet.jpg tavern/art/clean/furniture-sheet.png 48
python tavern/tools/cut-sheet.py tavern/art/clean/furniture-sheet.png tavern/art/furniture-layout.json tavern/art/sprites furniture-sheet.jpg
```

The barkeep sprite (`sprites/barkeep.png`, 51x105) is the standing image's clean version
cropped to the figure; the cutter's manifest gets its entry added after a re-run.
