// Echo (#369): a plugin that exists only in smoke runs, to prove the plugin path end to end.
export default {
  id: 'smoke-echo',
  name: 'Echo (smoke test)',
  version: '1.0.0',
  api: 1,
  smokeOnly: true,
  description: 'Answers what it is sent. Only in smoke runs.',
  button: { icon: 'spark', title: 'Echo' },
  shortcut: 'Control+Alt+E',
  uses: [],
  settings: [
    { key: 'greeting', label: 'Greeting', type: 'text', default: 'hello' },
    { key: 'loud', label: 'Loud', type: 'toggle', default: false },
  ],
};
