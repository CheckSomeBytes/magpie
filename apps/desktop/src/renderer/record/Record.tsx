/**
 * Screen recorder (Phase 5): getDisplayMedia (+ mic / system audio) →
 * MediaRecorder → 1 s WebM chunks streamed to main, which writes them to disk.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';

type Phase = 'starting' | 'recording' | 'paused' | 'saving' | 'error';

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Dev-only: an animated canvas + test tone, so the real MediaRecorder path runs without a screen. */
function fakeStream(): MediaStream {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d')!;
  let f = 0;
  setInterval(() => {
    f++;
    g.fillStyle = '#1b1d22';
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#4c8dff';
    g.fillRect(40 + ((f * 6) % 520), 120, 80, 80);
    g.fillStyle = '#fff';
    g.font = '28px sans-serif';
    g.fillText(`frame ${f}`, 24, 48);
  }, 33);
  const stream = c.captureStream(30);
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  gain.gain.value = 0.05;
  const dest = ac.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  return stream;
}

export function Record() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [stopHotkey, setStopHotkey] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStreamTrack[]>([]);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const clock = useRef({ base: 0, startedAt: 0 });
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;

  const stopTracks = () => tracks.current.forEach((t) => t.stop());

  const stop = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state === 'inactive' || phaseRef.current === 'saving') return;
    setPhase('saving');
    r.stop(); // onstop finalises
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const init = await api.recordInit();
      setStopHotkey(init.stopHotkey);
      let screenStream: MediaStream;
      try {
        screenStream = init.fake ? fakeStream() : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: init.systemAudio });
      } catch {
        api.recordCancel(); // picker dismissed or denied
        return;
      }
      if (cancelled) return;
      const out = new MediaStream(screenStream.getVideoTracks());
      const audio: MediaStreamTrack[] = [...screenStream.getAudioTracks()];
      if (init.mic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          audio.push(...mic.getAudioTracks());
          tracks.current.push(...mic.getTracks());
        } catch {
          setNote('Microphone unavailable; recording without it.');
        }
      }
      if (audio.length > 1) {
        // MediaRecorder takes one audio track: mix system audio and mic.
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        for (const t of audio) ac.createMediaStreamSource(new MediaStream([t])).connect(dest);
        out.addTrack(dest.stream.getAudioTracks()[0]!);
      } else if (audio[0]) out.addTrack(audio[0]);
      tracks.current.push(...screenStream.getTracks());
      screenStream.getVideoTracks()[0]?.addEventListener('ended', stop); // "Stop sharing" in the OS UI

      const r = new MediaRecorder(out, { mimeType: pickMime(), videoBitsPerSecond: 6_000_000 });
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        // Serialise writes; also gives backpressure if the disk is slow.
        chain.current = chain.current.then(async () => api.recordChunk(new Uint8Array(await e.data.arrayBuffer())));
      };
      r.onstop = async () => {
        stopTracks();
        try {
          await chain.current;
          await api.recordFinish();
        } catch (err) {
          setNote((err as Error).message);
          setPhase('error');
        }
      };
      recorder.current = r;
      await api.recordStart();
      r.start(1000);
      clock.current = { base: 0, startedAt: performance.now() };
      setPhase('recording');
    })().catch((err: Error) => {
      setNote(err.message);
      setPhase('error');
    });
    return () => {
      cancelled = true;
    };
  }, [stop]);

  useEffect(() => api.onRecordStop(stop), [stop]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed(clock.current.base + performance.now() - clock.current.startedAt), 250);
    return () => clearInterval(t);
  }, [phase]);

  const togglePause = () => {
    const r = recorder.current;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause();
      clock.current.base += performance.now() - clock.current.startedAt;
      setElapsed(clock.current.base);
      setPhase('paused');
    } else if (r.state === 'paused') {
      r.resume();
      clock.current.startedAt = performance.now();
      setPhase('recording');
    }
  };

  const discard = () => {
    const r = recorder.current;
    if (r && r.state !== 'inactive') {
      r.onstop = null;
      r.stop();
    }
    stopTracks();
    api.recordCancel();
  };

  if (phase === 'starting') return <div className="rec center muted">Starting screen recording…</div>;

  return (
    <div className="rec">
      <div className="rec-row drag">
        <span className={`dot ${phase === 'recording' ? 'live' : ''}`} aria-hidden />
        <strong className="time" aria-live="off">
          {fmt(elapsed)}
        </strong>
        <span className="muted">{phase === 'paused' ? 'Paused' : phase === 'saving' ? 'Saving…' : phase === 'error' ? 'Failed' : 'Recording'}</span>
      </div>
      {note && <div className="note">{note}</div>}
      <div className="rec-row">
        <button className="primary" disabled={phase === 'saving' || phase === 'error'} onClick={stop} title={stopHotkey ? `Stop (${stopHotkey})` : 'Stop'}>
          Stop
        </button>
        <button disabled={phase === 'saving' || phase === 'error'} onClick={togglePause}>
          {phase === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button className="danger" disabled={phase === 'saving'} onClick={discard}>
          Discard
        </button>
      </div>
    </div>
  );
}
