// Every built-in plugin's manifest (#369). Adding a plugin: its folder, then one line here,
// one in index.js (its main side) and one in pages.js (its page side). See README.md.
import echo from './smoke-echo/manifest.js';
import recorder from './recorder/manifest.js';

export const MANIFESTS = [recorder, echo];
