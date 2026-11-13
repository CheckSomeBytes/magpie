import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { Settings } from '../shared/ipc';

type Listener = (s: Settings, prev: Settings) => void;

class SettingsStore {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);
  private listeners = new Set<Listener>();
  private file = '';

  load(): void {
    this.file = join(app.getPath('userData'), 'settings.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>;
      this.current = {
        ...DEFAULT_SETTINGS,
        ...raw,
        hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(raw.hotkeys ?? {}) },
      };
    } catch {
      this.current = structuredClone(DEFAULT_SETTINGS);
    }
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const prev = this.current;
    this.current = {
      ...prev,
      ...patch,
      hotkeys: { ...prev.hotkeys, ...(patch.hotkeys ?? {}) },
    };
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.current, null, 2));
    for (const l of this.listeners) l(this.current, prev);
    return this.current;
  }

  onChange(l: Listener): void {
    this.listeners.add(l);
  }
}

export const settings = new SettingsStore();
