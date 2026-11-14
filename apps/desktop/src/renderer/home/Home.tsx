import { useEffect, useState } from 'react';
import { CAPTURE_MODES, CAPTURE_MODE_LABELS as MODE_LABEL, type CaptureMode, type CapturePreset, type DoctorItem, type HotkeyStatus, type Settings } from '../../shared/ipc';
import { acceleratorFromEvent } from '../../shared/accelerator';
import { api } from '../shared/api';


export function Home() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyStatus[]>([]);
  const [doctor, setDoctor] = useState<DoctorItem[] | null>(null);
  const isLinux = api.platform === 'linux';

  useEffect(() => {
    void api.getSettings().then(setSettings);
    void api.getHotkeyStatus().then(setHotkeys);
  }, []);

  const patch = async (p: Partial<Settings>) => {
    const res = await api.setSettings(p);
    setSettings(res.settings);
    setHotkeys(res.hotkeys);
  };

  if (!settings) return null;

  return (
    <main className="home">
      <header>
        <h1>Magpie</h1>
        <p className="muted">Lives in your tray. Captures autosave to your Pictures folder as editable .magpie files.</p>
        <button className="primary library-btn" onClick={() => api.openLibrary()}>
          Open Library
        </button>
      </header>

      <section className="captures">
        {CAPTURE_MODES.map((m: CaptureMode) => (
          <button key={m} className="capture" onClick={() => api.capture(m)}>
            <span className="big">{MODE_LABEL[m]}</span>
            <kbd>{settings.hotkeys[m] || 'no hotkey'}</kbd>
          </button>
        ))}
      </section>

      <section className="card">
        <h2>Hotkeys</h2>
        {CAPTURE_MODES.map((m: CaptureMode) => {
          const st = hotkeys.find((h) => h.mode === m);
          return (
            <div className="field" key={m}>
              <span>{MODE_LABEL[m]}</span>
              <HotkeyInput value={settings.hotkeys[m]} onChange={(acc) => void patch({ hotkeys: { ...settings.hotkeys, [m]: acc } })} />
              <span className={`pill ${st?.ok ? 'ok' : 'bad'}`} title={st?.ok ? 'Registered' : 'Not active: taken by another app, or declined in the GNOME dialog'}>
                {st?.ok ? 'active' : 'inactive'}
              </span>
            </div>
          );
        })}
        {isLinux && (
          <p className="muted small">
            GNOME asks once to allow these shortcuts. <kbd>Print</kbd> may already be used by GNOME's own screenshot tool. If a
            hotkey stays inactive, add a GNOME custom shortcut that runs <code>magpie --capture=region</code>.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Capture</h2>
        {isLinux && (
          <div className="field">
            <span>Region select</span>
            <select value={settings.linuxRegionMode} onChange={(e) => void patch({ linuxRegionMode: e.target.value as Settings['linuxRegionMode'] })}>
              <option value="overlay">Overlay on current screen</option>
              <option value="editor-crop">Open full desktop in editor, then crop</option>
            </select>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.copyOnCapture} onChange={(e) => void patch({ copyOnCapture: e.target.checked })} />
          Copy every capture to the clipboard immediately
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.exportPngOnSave} onChange={(e) => void patch({ exportPngOnSave: e.target.checked })} />
          Also write a .png next to the project on Save (Ctrl+S)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => void patch({ launchAtLogin: e.target.checked })} />
          Start Magpie when I log in
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.ocrEnabled} onChange={(e) => void patch({ ocrEnabled: e.target.checked })} />
          Read text in captures so library search finds it (offline)
        </label>
        <div className="field">
          <span>Captures folder</span>
          <code className="path" title={settings.autosaveDir ?? ''}>
            {settings.autosaveDir ?? 'Pictures/Magpie (default)'}
          </code>
          <button
            onClick={async () => {
              const dir = await api.chooseFolder();
              if (dir) void patch({ autosaveDir: dir });
            }}
          >
            Change…
          </button>
          {settings.autosaveDir && <button onClick={() => void patch({ autosaveDir: null })}>Default</button>}
        </div>
      </section>

      <Presets presets={settings.capturePresets} hotkeys={hotkeys} onChange={(capturePresets) => void patch({ capturePresets })} />

      <section className="card">
        <h2>Diagnostics</h2>
        <button onClick={() => void api.runDoctor().then(setDoctor)}>Run checks</button>
        {doctor && (
          <ul className="doctor">
            {doctor.map((d, i) => (
              <li key={i} className={d.level}>
                <span className="dot" aria-label={d.level} /> {d.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function HotkeyInput({ value, onChange }: { value: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <input
      className={`hotkey ${recording ? 'recording' : ''}`}
      readOnly
      value={recording ? 'Press keys…' : value || 'none'}
      onFocus={() => {
        setRecording(true);
        api.suspendHotkeys(true);
      }}
      onBlur={() => {
        setRecording(false);
        api.suspendHotkeys(false);
      }}
      onKeyDown={(e) => {
        e.preventDefault();
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          onChange('');
          (e.target as HTMLInputElement).blur();
          return;
        }
        const acc = acceleratorFromEvent(e.nativeEvent);
        if (acc) {
          onChange(acc);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Presets({ presets, hotkeys, onChange }: { presets: CapturePreset[]; hotkeys: HotkeyStatus[]; onChange: (p: CapturePreset[]) => void }) {
  const update = (id: string, patch: Partial<CapturePreset>) => onChange(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () =>
    onChange([
      ...presets,
      { id: crypto.randomUUID(), name: `Preset ${presets.length + 1}`, mode: 'region', delaySec: 0, copyToClipboard: true, openEditor: true, tags: [], hotkey: '' },
    ]);
  return (
    <section className="card">
      <h2>Capture presets</h2>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 10 }}>
        Named captures with their own delay, tags and hotkey. Run them from the tray, here, or with <code>magpie --preset=&lt;name&gt;</code>.
      </p>
      {presets.map((p) => {
        const st = hotkeys.find((h) => h.mode === `preset:${p.id}`);
        return (
          <div className="preset" key={p.id}>
            <div className="field">
              <span>Name</span>
              <input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} aria-label="Preset name" />
            </div>
            <div className="field">
              <span>Capture</span>
              <select value={p.mode} onChange={(e) => update(p.id, { mode: e.target.value as CapturePreset['mode'] })} aria-label="Capture mode">
                <option value="region">Region</option>
                <option value="window">Window</option>
                <option value="full">Full screen</option>
              </select>
              <label className="inline">
                Delay
                <input type="number" min={0} max={30} value={p.delaySec} onChange={(e) => update(p.id, { delaySec: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />s
              </label>
            </div>
            <div className="field">
              <span>Tags</span>
              <input
                defaultValue={p.tags.join(', ')}
                placeholder="e.g. bug, web"
                aria-label="Tags"
                onBlur={(e) => update(p.id, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              />
            </div>
            <div className="field">
              <span>Hotkey</span>
              <HotkeyInput value={p.hotkey} onChange={(hotkey) => update(p.id, { hotkey })} />
              {p.hotkey && <span className={`pill ${st?.ok ? 'ok' : 'bad'}`}>{st?.ok ? 'active' : 'inactive'}</span>}
            </div>
            <label className="check">
              <input type="checkbox" checked={p.copyToClipboard} onChange={(e) => update(p.id, { copyToClipboard: e.target.checked })} />
              Copy to clipboard
            </label>
            <label className="check">
              <input type="checkbox" checked={p.openEditor} onChange={(e) => update(p.id, { openEditor: e.target.checked })} />
              Open in the editor (otherwise save to the library quietly)
            </label>
            <div className="row">
              <button className="primary" onClick={() => api.runPreset(p.id)}>
                Run
              </button>
              <button className="danger" onClick={() => onChange(presets.filter((x) => x.id !== p.id))}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
      <button onClick={add}>Add preset</button>
    </section>
  );
}
