/**
 * Scrolling capture (Phase 3): stream → pick region on a frozen frame →
 * sample while the user scrolls → review seams → open in editor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AddStatus, Seam } from '@magpie/stitcher';
import type { Rect } from '@magpie/format';
import { rectFromPoints } from '../../shared/geometry';
import { api } from '../shared/api';
import { fakeScrollStream, type FakeScroll } from './fakeStream';
import type { FromWorker, ToWorker } from './stitch.worker';

type Phase = 'starting' | 'select' | 'recording' | 'stitching' | 'review' | 'error';

const SAMPLE_MS = 120;

const HINTS: Partial<Record<AddStatus, string>> = {
  first: 'Now scroll the content down, slowly and steadily.',
  static: 'Waiting for you to scroll…',
  pending: 'Stitching…',
  kept: 'Stitching…',
  reverse: 'Scrolling up is ignored. Keep going down.',
  gap: 'Too fast! Slow down. That seam is flagged for review.',
  full: 'Reached the maximum length. Press Finish.',
};

export function Scroll() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [stopHotkey, setStopHotkey] = useState('');
  const [status, setStatus] = useState<{ status: AddStatus; height: number; kept: number; ms: number } | null>(null);
  const [result, setResult] = useState<{ url: string; png: Blob; width: number; height: number; seams: Seam[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fake = useRef<FakeScroll | null>(null);
  const frozen = useRef<ImageBitmap | null>(null);
  const region = useRef<Rect | null>(null);
  const worker = useRef<Worker | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;

  const fail = (msg: string) => {
    setError(msg);
    setPhase('error');
    void api.scrollPhase('review');
  };

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // ---- worker -----------------------------------------------------------------
  useEffect(() => {
    const w = new Worker(new URL('./stitch.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.t === 'status') {
        inFlight.current = false;
        setStatus(m);
      } else if (m.t === 'composed') {
        setResult((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(m.png), png: m.png, width: m.width, height: m.height, seams: m.seams };
        });
        setBusy(false);
        if (phaseRef.current === 'stitching') {
          setPhase('review');
          void api.scrollPhase('review');
        }
      } else if (m.t === 'error') {
        inFlight.current = false;
        fail(m.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const send = (m: ToWorker, transfer: Transferable[] = []) => worker.current?.postMessage(m, transfer);

  // ---- start: stream + frozen frame ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const init = await api.scrollInit();
      setStopHotkey(init.stopHotkey);
      let s: MediaStream;
      try {
        if (init.fakeTall) {
          fake.current = await fakeScrollStream(init.fakeTall);
          s = fake.current.stream;
        } else {
          s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
        }
      } catch {
        api.scrollCancel(); // dialog dismissed or permission denied
        return;
      }
      if (cancelled) return;
      stream.current = s;
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (phaseRef.current === 'recording') void finish();
        else if (phaseRef.current === 'select' || phaseRef.current === 'starting') api.scrollCancel();
      });
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      await new Promise<void>((r) => (v.videoWidth ? r() : v.addEventListener('loadeddata', () => r(), { once: true })));
      await new Promise((r) => setTimeout(r, 150)); // first frames can be black on some capturers
      frozen.current = await createImageBitmap(v);
      await api.scrollPhase('select');
      setPhase('select');
    })().catch((err: Error) => fail(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- recording ----------------------------------------------------------------
  const startRecording = useCallback(async (r: Rect) => {
    region.current = r;
    setPhase('recording');
    await api.scrollPhase('recording');
    fake.current?.start();
    timer.current = window.setInterval(async () => {
      const v = video.current;
      const rr = region.current;
      if (!v || !rr || inFlight.current) return;
      inFlight.current = true;
      try {
        const bmp = await createImageBitmap(v, rr.x, rr.y, rr.width, rr.height);
        send({ t: 'frame', bitmap: bmp }, [bmp]);
      } catch {
        inFlight.current = false;
      }
    }, SAMPLE_MS);
  }, []);

  const finish = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    window.clearInterval(timer.current);
    setPhase('stitching');
    // Let the last frame land.
    const t0 = Date.now();
    while (inFlight.current && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 30));
    stopStream();
    setBusy(true);
    send({ t: 'finish' });
  }, []);

  useEffect(() => api.onScrollStop(() => void finish()), [finish]);

  const cancel = () => {
    window.clearInterval(timer.current);
    stopStream();
    api.scrollCancel();
  };

  const openInEditor = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await api.scrollFinish(new Uint8Array(await result.png.arrayBuffer()));
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  };

  const nudge = (index: number, delta: number) => {
    setBusy(true);
    send({ t: 'nudge', index, delta });
  };

  // ---- render ---------------------------------------------------------------------
  return (
    <div className={`scroll phase-${phase}`}>
      <video ref={video} muted playsInline className="hidden-video" />
      {phase === 'starting' && <div className="center muted">Starting screen capture…</div>}
      {phase === 'select' && frozen.current && <RegionSelect frame={frozen.current} onConfirm={(r) => void startRecording(r)} onCancel={cancel} />}
      {(phase === 'recording' || phase === 'stitching') && (
        <div className="panel">
          <div className="row">
            <span className={`dot ${phase === 'recording' ? 'live' : ''}`} />
            <strong>{phase === 'recording' ? 'Scrolling capture' : 'Stitching…'}</strong>
            <span className="muted">
              {status ? `${status.height.toLocaleString()} px · ${status.kept} frames` : ''}
            </span>
          </div>
          <div className={`hint ${status?.status === 'gap' ? 'warn' : ''}`}>{status ? HINTS[status.status] : HINTS.first}</div>
          <div className="row">
            <button className="primary" disabled={phase !== 'recording'} onClick={() => void finish()}>
              Finish{stopHotkey ? ` (${stopHotkey})` : ''}
            </button>
            <button onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {phase === 'review' && result && <Review result={result} busy={busy} onNudge={nudge} onOpen={() => void openInEditor()} onDiscard={cancel} error={error} />}
      {phase === 'error' && (
        <div className="center">
          <p>Scrolling capture failed: {error}</p>
          <button onClick={cancel}>Close</button>
        </div>
      )}
    </div>
  );
}

// ---- region select ------------------------------------------------------------------

function RegionSelect({ frame, onConfirm, onCancel }: { frame: ImageBitmap; onConfirm: (r: Rect) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [fit, setFit] = useState({ s: 1, ox: 0, oy: 0 });

  const draw = useCallback(
    (r: Rect | null) => {
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth;
      const H = window.innerHeight;
      c.width = W * dpr;
      c.height = H * dpr;
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = Math.min(W / frame.width, H / frame.height);
      const ox = (W - frame.width * s) / 2;
      const oy = (H - frame.height * s) / 2;
      setFit({ s, ox, oy });
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.drawImage(frame, ox, oy, frame.width * s, frame.height * s);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.rect(0, 0, W, H);
      if (r) g.rect(ox + r.x * s, oy + r.y * s, r.width * s, r.height * s);
      g.fill('evenodd');
      if (r) {
        g.strokeStyle = '#4c8dff';
        g.lineWidth = 2;
        g.strokeRect(ox + r.x * s, oy + r.y * s, r.width * s, r.height * s);
      }
    },
    [frame],
  );

  useEffect(() => {
    draw(sel);
    const onResize = () => draw(sel);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw, sel]);

  const toFrame = (e: React.PointerEvent) => ({
    x: Math.max(0, Math.min(frame.width, (e.clientX - fit.ox) / fit.s)),
    y: Math.max(0, Math.min(frame.height, (e.clientY - fit.oy) / fit.s)),
  });

  const confirm = useCallback(() => {
    const r = sel && sel.width >= 16 && sel.height >= 48 ? sel : { x: 0, y: 0, width: frame.width, height: frame.height };
    onConfirm({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  }, [sel, frame, onConfirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, onCancel]);

  return (
    <div className="select">
      <canvas
        ref={canvas}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = toFrame(e);
          setSel(null);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = toFrame(e);
          setSel(rectFromPoints(drag.current.x, drag.current.y, p.x, p.y));
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <div className="select-bar">
        <span>Drag around the area that scrolls, then press Start and scroll it.</span>
        <button className="primary" onClick={confirm}>
          {sel ? 'Start' : 'Use whole screen'} (Enter)
        </button>
        <button onClick={onCancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}

// ---- review ---------------------------------------------------------------------------

function Review({
  result,
  busy,
  onNudge,
  onOpen,
  onDiscard,
  error,
}: {
  result: { url: string; width: number; height: number; seams: Seam[] };
  busy: boolean;
  onNudge: (index: number, delta: number) => void;
  onOpen: () => void;
  onDiscard: () => void;
  error: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 24) / result.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [result.width]);

  const jump = (row: number) => box.current?.scrollTo({ top: row * scale - 120, behavior: 'smooth' });
  const flagged = result.seams.filter((s) => s.gap || s.confidence < 0.95).length;

  return (
    <div className="review">
      <div className="review-image" ref={box}>
        <div className="img-wrap" style={{ width: result.width * scale, height: result.height * scale }}>
          <img src={result.url} alt="Stitched capture" width={result.width * scale} height={result.height * scale} />
          {result.seams.map((s) => (
            <div key={s.index} className={`seam ${s.gap ? 'gap' : s.confidence < 0.95 ? 'weak' : ''}`} style={{ top: s.outputRow * scale }} title={`Seam ${s.index}`} />
          ))}
        </div>
      </div>
      <aside className="review-side">
        <h3>Stitched capture</h3>
        <p className="muted">
          {result.width} × {result.height.toLocaleString()} px from {result.seams.length + 1} frames.
          {flagged ? ` ${flagged} seam${flagged > 1 ? 's' : ''} may need a nudge.` : ' All seams matched cleanly.'}
        </p>
        {result.seams.length > 0 && (
          <ol className="seams">
            {result.seams.map((s) => (
              <li key={s.index} className={s.gap ? 'gap' : s.confidence < 0.95 ? 'weak' : ''}>
                <button className="link" onClick={() => jump(s.outputRow)}>
                  Seam {s.index} · {s.outputRow.toLocaleString()} px
                  {s.gap ? ' · lost track' : ` · ${Math.round(s.confidence * 100)}%`}
                  {s.adjust ? ` · ${s.adjust > 0 ? '+' : ''}${s.adjust}` : ''}
                </button>
                <span className="nudges">
                  <button disabled={busy} title="Move up 10 px" onClick={() => onNudge(s.index, -10)}>
                    ⇈
                  </button>
                  <button disabled={busy} title="Move up 1 px" onClick={() => onNudge(s.index, -1)}>
                    ↑
                  </button>
                  <button disabled={busy} title="Move down 1 px" onClick={() => onNudge(s.index, 1)}>
                    ↓
                  </button>
                  <button disabled={busy} title="Move down 10 px" onClick={() => onNudge(s.index, 10)}>
                    ⇊
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={busy} onClick={onOpen}>
            Open in editor
          </button>
          <button onClick={onDiscard}>Discard</button>
        </div>
      </aside>
    </div>
  );
}
