(function () {
  const ctx = { documentId: 1, documentName: 'Reflex study.psd', layerCount: 1 };
  const items = [
    { id: 'layer:1:1', title: 'Butterfly', subtitle: 'Artwork / Subject', category: 'Layers', icon: 'layers', kind: 'layer', documentId: 1, layerId: 1 },
    { id: 'layer:1:2', title: 'Glow highlights', subtitle: 'Artwork / Light', category: 'Layers', icon: 'layers', kind: 'layer', documentId: 1, layerId: 2 },
    { id: 'layer:1:3', title: 'Background', subtitle: 'Artwork', category: 'Layers', icon: 'layers', kind: 'layer', documentId: 1, layerId: 3 },
    { id: 'action:preview:1', title: 'Prepare for export', subtitle: 'My workflow', category: 'Actions', icon: 'play', kind: 'action' },
    { id: 'menu:preview:1', title: 'Free Transform', subtitle: 'Edit', category: 'Menus', icon: 'transform', kind: 'menu' },
    { id: 'menu:preview:2', title: 'Select and Mask…', subtitle: 'Select', category: 'Menus', icon: 'mask', kind: 'menu', interactive: true },
    { id: 'document:1', title: 'Reflex study.psd', subtitle: 'Open document', category: 'Documents', icon: 'file', kind: 'document', documentId: 1 }
  ];
  let state; try { state = JSON.parse(localStorage.getItem('reflex-preview')); } catch (_) {}
  const host = { context: () => ctx, snapshot: async () => ({ context: ctx, items }), run: async item => { window.lastPreviewCommand = item.id; } };
  const app = ReflexUI.createController({ core: ReflexCore, catalog: ReflexCatalog, shortcuts: ReflexShortcuts, theme: ReflexTheme, host, state, storage: { save: async value => localStorage.setItem('reflex-preview', JSON.stringify(value)) }, showSearch: () => open('palette'), showWheel: () => open('wheel') });
  app.mountPanel(document.getElementById('panel')); app.refresh();
  function open(kind) {
    const dialog = document.getElementById(kind + '-dialog'), root = document.getElementById(kind + '-root');
    const close = value => { dialog.reflexValue = value; dialog.close(); };
    const view = kind === 'palette' ? app.mountSearch(root, { floating: true, close }) : app.mountWheel(root, { close });
    dialog.reflexValue = null;
    dialog.addEventListener('close', async () => { view.dispose(); if (dialog.reflexValue) await app.execute(dialog.reflexValue.id, dialog.reflexValue.documentId); }, { once: true });
    dialog.showModal(); view.focus();
  }
  document.getElementById('open-palette').onclick = () => open('palette');
  document.getElementById('open-wheel').onclick = () => open('wheel');
  document.getElementById('preview-size').onchange = event => {
    const [width, height] = event.target.value.split(',').map(Number), panel = document.getElementById('panel');
    panel.style.width = width + 'px'; panel.style.height = height + 'px';
  };
  window.reflexPreview = app;
})();
