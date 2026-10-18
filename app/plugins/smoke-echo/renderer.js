// Echo's page side: its button opens a modal with the answer; its shortcut shows a count.
export function mount(ui) {
  const { h } = ui;
  ui.button.onClick(async () => {
    const answer = await ui.invoke('echo', 'there');
    ui.kit.modal({ title: 'Echo', body: h('p', { class: 'echo-out' }, String(answer)) });
  });
  ui.on('key', n => ui.button.set('attention', String(n)));
  return { unmount() {} };
}
