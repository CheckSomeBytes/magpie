import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnnotationType, Rect } from '@magpie/format';
import type { EditorInit } from '../../shared/ipc';
import { api, loadImage, pngUrl } from '../shared/api';
import { recognizeText } from '../shared/ocr';
import { CanvasView, type CanvasHandle } from './CanvasView';
import { PromptContext, PromptDialog, TextResultDialog, type Ask, type PromptRequest } from './Dialogs';
import { deleteTemplate, instantiateTemplate, saveTemplate, useTemplates } from './presets';
import { Properties } from './Properties';
import { newId, useEditor } from './store';
import { TOOLS, type Tool } from './tools';

const AUTOSAVE_MS = 800;
const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

type Zoom = number | 'fit';

export function Editor() {
  const [init, setInit] = useState<EditorInit | null>(null);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [status, setStatus] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const savedRevision = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const savePromise = useRef<Promise<void>>(Promise.resolve());

  const tool = useEditor((s) => s.tool);
  const crop = useEditor((s) => s.crop);
  const revision = useEditor((s) => s.revision);
  const hasBlur = useEditor((s) => s.annotations.some((a) => a.type === 'blur'));
  const assets = useEditor((s) => s.assets);
  const hasAnnotations = useEditor((s) => s.annotations.length > 0);
  const templates = useTemplates();
  const [assetImages, setAssetImages] = useState<Record<string, HTMLImageElement>>({});
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [ocr, setOcr] = useState<{ busy: boolean; text: string; error: string | null } | null>(null);
  const [menu, setMenu] = useState(false);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const ed = useEditor.getState;

  // ---- load -------------------------------------------------------------------
  useEffect(() => {
    let url = '';
    api
      .editorInit()
      .then(async (i) => {
        url = pngUrl(i.original);
        const img = await loadImage(url);
        ed().load({ annotations: i.doc.annotations, crop: i.doc.crop });
        useEditor.setState({ assets: i.assets ?? {} });
        void api.listStamps().then((list) => ed().setCustomStamps(list));
        if (i.startTool) ed().setTool(i.startTool as Tool);
        document.title = `${i.path.split(/[\\/]/).pop()} — Magpie`;
        setInit(i);
        setBg(img);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [ed]);

  // ---- layout / zoom --------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bg]);

  const view: Rect | null = bg ? (tool !== 'crop' && crop ? crop : { x: 0, y: 0, width: bg.naturalWidth, height: bg.naturalHeight }) : null;
  const fitScale = view ? Math.min(1, (box.w - 48) / view.width, (box.h - 48) / view.height) : 1;
  const scale = zoom === 'fit' ? Math.max(0.05, fitScale) : zoom;

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const cur = scale;
      const next = dir > 0 ? ZOOMS.find((z) => z > cur + 1e-3) : [...ZOOMS].reverse().find((z) => z < cur - 1e-3);
      if (next) setZoom(next);
    },
    [scale],
  );

  // ---- save / copy / export ---------------------------------------------------
  const save = useCallback(
    async (explicit = false) => {
      if (!init) return;
      canvas.current?.commitText();
      const rev = ed().revision;
      const run = savePromise.current.then(async () => {
        setStatus('Saving…');
        const thumb = await canvas.current?.flatten({ maxWidth: 320, mimeType: 'image/webp', quality: 0.8 });
        const flattenedPng = explicit && init.settings.exportPngOnSave ? await canvas.current?.flatten() : null;
        const doc = { version: 1, crop: ed().crop, annotations: ed().annotations };
        await api.editorSave({ doc, thumbWebp: thumb ?? null, flattenedPng, assets: ed().assets });
        savedRevision.current = Math.max(savedRevision.current, rev);
        setStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
      });
      savePromise.current = run.catch((err: Error) => setStatus(`Save failed: ${err.message}`));
      await savePromise.current;
      if (explicit) flash(init.settings.exportPngOnSave ? 'Saved project and PNG' : 'Saved');
    },
    [init, ed],
  );

  useEffect(() => {
    if (!init || revision === 0 || revision === savedRevision.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(false), AUTOSAVE_MS);
  }, [revision, init, save]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    canvas.current?.commitText();
    if (ed().revision !== savedRevision.current) await save(false);
    else await savePromise.current;
  }, [save, ed]);

  useEffect(() => api.onEditorRequestClose(() => void flush().finally(() => api.editorCloseReady())), [flush]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600);
  };

  const copy = useCallback(async () => {
    canvas.current?.commitText();
    if (ed().tool === 'crop') ed().setTool('select');
    const png = await canvas.current!.flatten();
    await api.editorCopy(png);
    flash('Copied to clipboard');
  }, [ed]);

  const copyAndClose = useCallback(async () => {
    await copy();
    await flush();
    api.editorClose();
  }, [copy, flush]);

  const exportPng = useCallback(async () => {
    canvas.current?.commitText();
    const png = await canvas.current!.flatten();
    const path = await api.editorExportPng(png);
    if (path) flash('Exported PNG');
  }, []);

  // ---- assets: decode embedded images once per id ----------------------------
  useEffect(() => {
    const missing = Object.keys(assets).filter((id) => !assetImages[id]);
    if (!missing.length) return;
    let alive = true;
    void Promise.all(missing.map(async (id) => [id, await loadImage(pngUrl(assets[id]!))] as const)).then((pairs) => {
      if (alive) setAssetImages((m) => ({ ...m, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
  }, [assets, assetImages]);

  // ---- prompts ----------------------------------------------------------------
  const ask: Ask = useCallback((title, opts = {}) => new Promise((resolve) => setPrompt({ title, ...opts, resolve })), []);

  // ---- paste an image (Ctrl+V) -------------------------------------------------
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || !bg) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      // Normalise to PNG (assets are stored as .png).
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      const png = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
      const view = ed().crop ?? { x: 0, y: 0, width: bg.naturalWidth, height: bg.naturalHeight };
      const k = Math.min(1, (view.width * 0.6) / bmp.width, (view.height * 0.6) / bmp.height);
      const w = bmp.width * k;
      const h = bmp.height * k;
      const asset = `paste-${newId().slice(0, 8)}`;
      ed().addAsset(asset, png);
      const id = newId();
      ed().add({ id, type: 'image', x: view.x + (view.width - w) / 2, y: view.y + (view.height - h) / 2, rotation: 0, style: { stroke: '#000000', strokeWidth: 0 }, data: { asset, width: w, height: h } });
      ed().setTool('select');
      ed().select(id);
      flash('Pasted image');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [bg, ed]);

  // ---- grab text (OCR) ------------------------------------------------------------
  const grabText = useCallback(
    async (rect: Rect | null) => {
      if (!bg) return;
      const r = rect ?? ed().crop ?? { x: 0, y: 0, width: bg.naturalWidth, height: bg.naturalHeight };
      setOcr({ busy: true, text: '', error: null });
      try {
        // Upscale small regions: tesseract reads ~20px+ text far more reliably.
        const k = Math.max(1, Math.min(3, 1200 / Math.max(r.width, 1)));
        const c = document.createElement('canvas');
        c.width = Math.round(r.width * k);
        c.height = Math.round(r.height * k);
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bg, r.x, r.y, r.width, r.height, 0, 0, c.width, c.height);
        const text = await recognizeText(c);
        if (text) await api.copyText(text);
        setOcr({ busy: false, text, error: null });
      } catch (err) {
        setOcr({ busy: false, text: '', error: (err as Error).message ?? String(err) });
      }
    },
    [bg, ed],
  );

  // ---- templates ------------------------------------------------------------------
  const saveAsTemplate = async () => {
    setMenu(false);
    if (!bg) return;
    const name = await ask('Save as template', { label: 'Template name', initial: '' });
    if (!name) return;
    const n = saveTemplate(name, ed().annotations, bg.naturalWidth, bg.naturalHeight);
    flash(`Saved template "${name}" (${n} annotation${n === 1 ? '' : 's'})`);
  };

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
      if (document.querySelector('.modal-backdrop')) return;
      const st = ed();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (mod) {
        if (k === 'z' && !e.shiftKey) st.undo();
        else if ((k === 'z' && e.shiftKey) || k === 'y') st.redo();
        else if (k === 'c' && !window.getSelection()?.toString()) void copy();
        else if (k === 'v') return; // handled by the paste event
        else if (k === 's' && e.shiftKey) void exportPng();
        else if (k === 's') void save(true);
        else if (k === 'enter') void copyAndClose();
        else if (k === 'w') api.editorClose();
        else if (k === '0') setZoom('fit');
        else if (k === '1') setZoom(1);
        else if (k === '=' || k === '+') stepZoom(1);
        else if (k === '-') stepZoom(-1);
        else return;
        e.preventDefault();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedId) {
        st.remove(st.selectedId);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (st.selectedId) st.select(null);
        else st.setTool('select');
        return;
      }
      if (e.key === 'Enter' && st.tool === 'crop') {
        st.setTool('select');
        return;
      }
      if (st.selectedId && e.key.startsWith('Arrow')) {
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        st.update(st.selectedId, (a) => ({ ...a, x: a.x + dx, y: a.y + dy }));
        e.preventDefault();
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t && !e.altKey) st.setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy, copyAndClose, exportPng, save, stepZoom, ed]);

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    stepZoom(e.deltaY < 0 ? 1 : -1);
  };

  if (error) return <div className="editor-error">Could not open this capture: {error}</div>;
  if (!init || !bg) return <div className="editor-loading">Loading…</div>;

  const out = crop ?? { width: bg.naturalWidth, height: bg.naturalHeight };

  return (
    <PromptContext.Provider value={ask}>
    <div className="editor">
      <header className="toolbar">
        <div className="tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool ${tool === t.id ? 'active' : ''}`}
              title={`${t.label} (${t.key})`}
              aria-pressed={tool === t.id}
              onClick={() => ed().setTool(t.id)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="menu-wrap">
          <button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            Templates ▾
          </button>
          {menu && (
            <>
              <div className="menu-scrim" onClick={() => setMenu(false)} />
              <div className="menu" role="menu">
                {templates.length === 0 && <div className="menu-empty muted">No templates yet</div>}
                {templates.map((t) => (
                  <div key={t.id} className="menu-row">
                    <button
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        setMenu(false);
                        if (!bg) return;
                        ed().addMany(instantiateTemplate(t, bg.naturalWidth, bg.naturalHeight));
                        flash(`Applied "${t.name}"`);
                      }}
                    >
                      {t.name} <span className="muted">· {t.annotations.length}</span>
                    </button>
                    <button className="menu-del" aria-label={`Delete template ${t.name}`} onClick={() => deleteTemplate(t.id)}>
                      ×
                    </button>
                  </div>
                ))}
                <div className="menu-sep" />
                <button role="menuitem" className="menu-item" disabled={!hasAnnotations} onClick={() => void saveAsTemplate()}>
                  Save annotations as template…
                </button>
              </div>
            </>
          )}
        </div>
        <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => ed().undo()}>
          Undo
        </button>
        <button title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => ed().redo()}>
          Redo
        </button>
        <span className="divider" />
        <button title="Export PNG (Ctrl+Shift+S)" onClick={() => void exportPng()}>
          Export PNG
        </button>
        <button className="primary" title="Copy to clipboard (Ctrl+C) · Copy & close (Ctrl+Enter)" onClick={() => void copy()}>
          Copy
        </button>
      </header>

      <div className="body">
        <div className="scroller" ref={scroller} onWheel={onWheel}>
          <div className="center">
            <CanvasView ref={canvas} bg={bg} scale={scale} assetImages={assetImages} onGrabText={(r) => void grabText(r)} />
          </div>
        </div>
        <Properties />
      </div>

      <footer className="statusbar">
        <span>
          {Math.round(out.width)} × {Math.round(out.height)} px{crop ? ' (cropped)' : ''}
        </span>
        <span className="zoom">
          <button onClick={() => stepZoom(-1)} title="Zoom out (Ctrl+−)">
            −
          </button>
          <button onClick={() => setZoom('fit')} title="Fit (Ctrl+0)" className={zoom === 'fit' ? 'active' : ''}>
            {Math.round(scale * 100)}%
          </button>
          <button onClick={() => stepZoom(1)} title="Zoom in (Ctrl+=)">
            +
          </button>
        </span>
        {hasBlur && <span className="note">Blur is baked into PNG exports. The .magpie file keeps the original pixels, so don't share it.</span>}
        <span className="spacer" />
        <span className="muted">{status}</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
      {prompt && <PromptDialog req={prompt} onDone={() => setPrompt(null)} />}
      {ocr && (
        <TextResultDialog
          {...ocr}
          onCopy={() => {
            void api.copyText(ocr.text);
            flash('Copied text');
          }}
          onClose={() => setOcr(null)}
        />
      )}
    </div>
    </PromptContext.Provider>
  );
}

export type { AnnotationType };
