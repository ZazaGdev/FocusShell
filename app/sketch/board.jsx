// The Sketch board (#94): Excalidraw in a modal over the window. Only what the board needs
// is switched on: no file open or save, no export dialog, no library, no collaboration.
// renderer/sketch.js mounts it with mountBoard() and owns everything outside the modal.
// With onSave instead of onInsert it is a saved board (#130): closing it saves the drawing
// and a PNG preview, and there is nothing to insert. Its name sits in the top bar and can be
// changed there (#144); onSave gets the name as typed.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, exportToBlob, CaptureUpdateAction } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './board.css';

const UI = {
  canvasActions: {
    loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false,
    toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: true,
  },
  tools: { image: true },
};

function Board({ target, title, name: name0, sub, dark: dark0, scene, onDark, onClose, onInsert, onSave }) {
  const [api, setApi] = useState(null);
  const [dark, setDark] = useState(dark0);
  const [empty, setEmpty] = useState(!scene?.elements?.some(e => !e.isDeleted));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(name0 || '');

  const live = () => api.getSceneElements().filter(e => !e.isDeleted);
  const snapshot = () => (api ? { elements: api.getSceneElements(), files: api.getFiles() } : scene);
  const pickDark = v => { setDark(v); onDark(v); };
  // Recorded in history, so Undo brings the drawing back.
  const clear = () => api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  const png = () => exportToBlob({
    elements: live(), files: api.getFiles(), mimeType: 'image/png', exportPadding: 24,
    appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: dark, viewBackgroundColor: '#ffffff' },
  });
  const close = async () => {
    if (busy) return;
    if (onSave && api) {
      setBusy(true);
      try { await onSave(snapshot(), live().length ? await png() : null, name.trim() || name0); } finally { setBusy(false); }
    }
    onClose(snapshot());
  };

  const insert = async () => {
    if (!api || !live().length) return;
    setBusy(true);
    try {
      await onInsert(await png(), snapshot());
    } finally { setBusy(false); }
  };

  return (
    <div className="sk-scrim" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="sk-modal">
        <div className="sk-head">
          {onSave
            ? <><span className="sk-title">Sketch:</span>
              <input className="sk-name" value={name} title="The sketch's name, saved when you close it" aria-label="Sketch name"
                onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></>
            : <span className="sk-title">{title || 'Sketch'}</span>}
          <span className="sk-sub">{sub || `draws into ${target}'s prompt`}</span>
          <span className="sk-spacer" />
          <div className="seg" role="group" aria-label="Board colour">
            <button className={dark ? '' : 'on'} onClick={() => pickDark(false)}>White</button>
            <button className={dark ? 'on' : ''} onClick={() => pickDark(true)}>Dark</button>
          </div>
          <button className="btn" onClick={clear} disabled={empty}>Clear</button>
          <button className="sk-x" onClick={close} title={onSave ? 'Close and save' : 'Close (the drawing is kept)'}>✕</button>
        </div>
        <div className="sk-canvas">
          <Excalidraw
            excalidrawAPI={setApi}
            theme={dark ? 'dark' : 'light'}
            UIOptions={UI}
            initialData={{
              elements: scene?.elements || [], files: scene?.files || {},
              appState: { viewBackgroundColor: '#ffffff', currentItemStrokeWidth: 2 },
            }}
            onChange={els => setEmpty(!els.some(e => !e.isDeleted))}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
          </Excalidraw>
        </div>
        <div className="sk-foot">
          <span className="sk-hint">Paste a screenshot (Ctrl+V) to draw over it. Ctrl+Z and Ctrl+Y undo and redo.</span>
          <span className="sk-spacer" />
          {onSave
            ? <button className="btn primary" onClick={close} disabled={busy}>{busy ? 'Saving...' : 'Save and close'}</button>
            : <>
              <button className="btn" onClick={close}>Cancel</button>
              <button className="btn primary" onClick={insert} disabled={empty || busy}>{busy ? 'Inserting...' : 'Insert into prompt'}</button>
            </>}
        </div>
      </div>
    </div>
  );
}

// Mounts the board into host; returns a function that unmounts it.
export function mountBoard(host, props) {
  const root = createRoot(host);
  root.render(<Board {...props} />);
  return () => root.unmount();
}
