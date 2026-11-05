// The main side of each built-in plugin, by id (#369). Only plugins-host.js imports this.
import * as echo from './smoke-echo/main.js';
import * as recorder from './recorder/main.js';

export const MAINS = { 'smoke-echo': echo, recorder };
