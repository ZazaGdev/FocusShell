// The page side of each built-in plugin, by id (#369). Only renderer/plugins.js imports this.
import * as echo from './smoke-echo/renderer.js';
import * as recorder from './recorder/renderer.js';

export const PAGES = { 'smoke-echo': echo, recorder };
