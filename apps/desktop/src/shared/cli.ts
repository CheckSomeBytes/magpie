import type { CaptureMode } from './ipc';

export interface CliCommand {
  capture: CaptureMode | null;
  open: string[];
  /** --doctor: print diagnostics and exit. */
  doctor: boolean;
}

const MODES: readonly CaptureMode[] = ['region', 'window', 'full'];

/**
 * Parse `magpie --capture region|window|full [file.magpie ...]`.
 * argv is process.argv (or the second-instance argv), so it starts with the
 * executable and, in dev, the app path; we only look at flags and .magpie files.
 */
export function parseCli(argv: readonly string[]): CliCommand {
  const out: CliCommand = { capture: null, open: [], doctor: false };
  const asMode = (v: string | undefined): CaptureMode | null => {
    const m = v === 'fullscreen' ? 'full' : v;
    return m && (MODES as readonly string[]).includes(m) ? (m as CaptureMode) : null;
  };
  let bareCaptureFlag = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--capture') {
      const next = asMode(argv[i + 1]);
      if (next) {
        out.capture = next;
        i++;
      } else bareCaptureFlag = true;
    } else if (arg.startsWith('--capture=')) out.capture = asMode(arg.slice('--capture='.length)) ?? out.capture;
    else if (arg === '--doctor') out.doctor = true;
    else if (!arg.startsWith('-') && arg.toLowerCase().endsWith('.magpie')) out.open.push(arg);
  }
  // Chromium rewrites a forwarded (second-instance) argv as switches-then-positionals, so
  // `--capture region` arrives as `--capture ... . region`. Recover the mode from the tail.
  if (bareCaptureFlag && !out.capture) {
    for (const arg of argv) {
      const m = asMode(arg);
      if (m) {
        out.capture = m;
        break;
      }
    }
  }
  return out;
}
