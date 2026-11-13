import { useEffect, useState } from 'react';
import type { CaptureMode, DoctorItem, HotkeyStatus, Settings } from '../../shared/ipc';
import { acceleratorFromEvent } from '../../shared/accelerator';
import { api } from '../shared/api';

const MODE_LABEL: Record<CaptureMode, string> = { region: 'Region', window: 'Window', full: 'Full screen' };

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
      </header>

      <section className="captures">
        {(['region', 'window', 'full'] as CaptureMode[]).map((m) => (
          <button key={m} className="capture" onClick={() => api.capture(m)}>
            <span className="big">{MODE_LABEL[m]}</span>
            <kbd>{settings.hotkeys[m] || 'no hotkey'}</kbd>
          </button>
        ))}
      </section>

      <section className="card">
        <h2>Hotkeys</h2>
        {(['region', 'window', 'full'] as CaptureMode[]).map((m) => {
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
