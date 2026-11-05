// Settings > Preferences (#1026): the theme, spacing and font, applied to the whole window at
// once. The theme is <html data-theme>, a token set in themes.css; the font overrides --ui;
// spacing zooms the window, so terminals refit after it.
import { THEMES, SPACES, FONTS } from '../lib/settings.js';

let applied = '';
export function applyPrefs(s, refit) {
  const theme = THEMES.find(t => t.id === s.theme) || THEMES[0];
  const space = SPACES.find(x => x.id === s.space) || SPACES[1];
  const font = FONTS.find(f => f.id === s.font) || FONTS[0];
  const key = `${theme.id}|${space.id}|${font.id}`;
  if (key === applied) return;
  applied = key;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.space = space.id;
  root.style.setProperty('--ui', font.css);
  window.deck.setZoom(space.zoom);
  if (refit) requestAnimationFrame(() => { refit(); setTimeout(refit, 200); });
}
