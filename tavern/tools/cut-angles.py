# Adds a character's side and back views to the room (#262): cuts its cleaned angle sheet (side
# walking, side standing, back, left to right) into art/sprites/angles/<name>-side.png and
# <name>-back.png and lists them in art/sprites/angles/angles.json, which the room reads.
# --no-side keeps only the back, for a sheet whose side view does not match the character;
# --height N shrinks the views to N rows, to match a front view cut smaller (the helpers: 85);
# --unpink peels a pink floor shadow off the edges (not for characters with purple or pink).
# Usage, from tavern/: python tools/cut-angles.py art/clean/<sheet>.png <name> [--no-side] [--height N] [--unpink]
import json, os, subprocess, sys

sheet, name = sys.argv[1], sys.argv[2]
views = ['back'] if '--no-side' in sys.argv else ['side', 'back']
height = sys.argv[sys.argv.index('--height') + 1] if '--height' in sys.argv else None
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'art', 'sprites', 'angles')
os.makedirs(out, exist_ok=True)
for v in views:
    subprocess.run([sys.executable, os.path.join(here, 'cut-figure.py'), sheet, '1' if v == 'side' else '2', os.path.join(out, f'{name}-{v}.png')] + ([height] if height else []) + (['--unpink'] if '--unpink' in sys.argv else []), check=True)
path = os.path.join(out, 'angles.json')
listed = json.load(open(path)) if os.path.exists(path) else {}
listed[name] = views
json.dump(dict(sorted(listed.items())), open(path, 'w'), indent=1)
