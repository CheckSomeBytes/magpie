/**
 * Video review (Phase 5): play, trim, export MP4 / GIF / trimmed WebM.
 * Keys: I / O set the trim start / end at the playhead; Space plays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoExport, VideoInit } from '../../shared/ipc';
import { api } from '../shared/api';

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0:00.0';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function Video() {
  const [info, setInfo] = useState<VideoInit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [now, setNow] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ path: string; label: string } | null>(null);
  const [gifWidth, setGifWidth] = useState(640);
  const [gifFps, setGifFps] = useState(12);
  const video = useRef<HTMLVideoElement>(null);
  const stopAtEnd = useRef(false);

  useEffect(() => {
    api
      .videoInit()
      .then((i) => {
        setInfo(i);
        document.title = `${i.name} — Magpie`;
        setDuration(i.duration);
        setEnd(i.duration);
        setGifWidth(Math.min(640, i.width));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => api.onVideoProgress((f) => setProgress(f)), []);

  const onMeta = () => {
    const v = video.current;
    if (!v) return;
    // Trust the player when ffmpeg couldn't read a duration.
    if (!duration && Number.isFinite(v.duration)) {
      setDuration(v.duration);
      setEnd(v.duration);
    }
  };

  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setNow(v.currentTime);
    if (stopAtEnd.current && v.currentTime >= end) {
      v.pause();
      stopAtEnd.current = false;
    }
  };

  const playSelection = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = start;
    stopAtEnd.current = true;
    void v.play();
  };

  const setIn = useCallback(() => {
    const t = video.current?.currentTime ?? 0;
    setStart(Math.min(t, end - 0.1));
  }, [end]);
  const setOut = useCallback(() => {
    const t = video.current?.currentTime ?? 0;
    setEnd(Math.max(t, start + 0.1));
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'i' || e.key === 'I') setIn();
      else if (e.key === 'o' || e.key === 'O') setOut();
      else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        const v = video.current;
        if (v) void (v.paused ? v.play() : v.pause());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setIn, setOut]);

  const doExport = async (kind: VideoExport['kind']) => {
    setResult(null);
    setError(null);
    setProgress(0);
    try {
      const path = await api.videoExport({ kind, start, end, gifWidth, gifFps });
      setResult({ path, label: path.split(/[\\/]/).pop() ?? path });
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''));
    } finally {
      setProgress(null);
    }
  };

  if (error && !info) return <div className="video-error">Could not open this video: {error}</div>;
  if (!info) return <div className="video-error muted">Loading…</div>;

  const busy = progress !== null;
  const trimmed = start > 0.05 || end < duration - 0.05;
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  return (
    <div className="video-page">
      <div className="player">
        <video ref={video} src={info.url} controls preload="metadata" onLoadedMetadata={onMeta} onTimeUpdate={onTime} />
      </div>

      <section className="trim" aria-label="Trim">
        <div className="timeline" aria-hidden>
          <div className="sel" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
          <div className="head" style={{ left: pct(now) }} />
        </div>
        <div className="trim-row">
          <label>
            Start <strong>{fmt(start)}</strong>
            <input type="range" min={0} max={duration} step={0.05} value={start} onChange={(e) => setStart(Math.min(Number(e.target.value), end - 0.1))} />
          </label>
          <button onClick={setIn} title="Set start at playhead (I)">
            Set start <kbd>I</kbd>
          </button>
        </div>
        <div className="trim-row">
          <label>
            End <strong>{fmt(end)}</strong>
            <input type="range" min={0} max={duration} step={0.05} value={end} onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.1))} />
          </label>
          <button onClick={setOut} title="Set end at playhead (O)">
            Set end <kbd>O</kbd>
          </button>
        </div>
        <div className="trim-row meta">
          <span className="muted">
            {info.width}×{info.height} · {fmt(duration)} total · selection {fmt(end - start)}
            {info.hasAudio ? ' · audio' : ' · no audio'}
          </span>
          <button onClick={playSelection}>Play selection</button>
          {trimmed && (
            <button
              onClick={() => {
                setStart(0);
                setEnd(duration);
              }}
            >
              Reset trim
            </button>
          )}
        </div>
      </section>

      <section className="exports" aria-label="Export">
        <button className="primary" disabled={busy} onClick={() => void doExport('mp4')}>
          Export MP4
        </button>
        <span className="gif-opts">
          <button disabled={busy} onClick={() => void doExport('gif')}>
            Export GIF
          </button>
          <select value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))} aria-label="GIF width">
            {[...new Set([Math.min(480, info.width), Math.min(640, info.width), Math.min(960, info.width), info.width])].map((w) => (
              <option key={w} value={w}>
                {w === info.width ? `${w}px (original)` : `${w}px`}
              </option>
            ))}
          </select>
          <select value={gifFps} onChange={(e) => setGifFps(Number(e.target.value))} aria-label="GIF frame rate">
            {[8, 12, 15, 20].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </span>
        <button disabled={busy || !trimmed} onClick={() => void doExport('webm')} title={trimmed ? '' : 'Set a trim first'}>
          Save trimmed WebM
        </button>
        <span className="spacer" />
        <button onClick={() => api.videoReveal()}>Show in folder</button>
        <button className="danger" disabled={busy} onClick={() => void api.videoTrash()}>
          Move to Trash
        </button>
      </section>

      {busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          <span>Exporting… {Math.round((progress ?? 0) * 100)}%</span>
        </div>
      )}
      {result && (
        <div className="result">
          Saved <strong>{result.label}</strong>
          <button onClick={() => api.videoReveal(result.path)}>Show in folder</button>
        </div>
      )}
      {error && <div className="result error">{error}</div>}
    </div>
  );
}
