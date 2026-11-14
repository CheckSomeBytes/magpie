/**
 * Video helpers over the bundled ffmpeg-static binary (Phase 5, §12).
 * Pure Node (no Electron imports) so they run in unit tests.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

let cachedPath: string | null | undefined;

/** Path to ffmpeg, or null when it isn't available. Handles the packaged asar layout. */
export function ffmpegPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  let p: string | null = (ffmpegStatic as unknown as string | null) ?? null;
  // Inside a packaged app the binary is unpacked next to app.asar.
  if (p && p.includes(`app.asar${sep}`)) p = p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  cachedPath = p && existsSync(p) ? p : null;
  return cachedPath;
}

export class FfmpegError extends Error {
  override name = 'FfmpegError';
}

interface RunOptions {
  /** Total seconds of output, for progress. */
  duration?: number;
  onProgress?: (fraction: number) => void;
  /** Collect stdout (e.g. a piped PNG). */
  stdout?: boolean;
}

function parseTime(s: string): number {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

export function run(args: string[], opts: RunOptions = {}): Promise<{ stderr: string; stdout: Buffer }> {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(new FfmpegError('ffmpeg is not available in this build.'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    let stderr = '';
    const out: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => opts.stdout && out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-20000);
      if (opts.onProgress && opts.duration) {
        const m = /time=(\d+:\d+:\d+(?:\.\d+)?)/g;
        let last: RegExpExecArray | null = null;
        for (let x = m.exec(s); x; x = m.exec(s)) last = x;
        if (last) opts.onProgress(Math.max(0, Math.min(1, parseTime(last[1]!) / opts.duration)));
      }
    });
    child.on('error', (err) => reject(new FfmpegError(err.message)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr, stdout: Buffer.concat(out) });
      else reject(new FfmpegError(stderr.split('\n').filter(Boolean).slice(-3).join('\n') || `ffmpeg exited with ${code}`));
    });
  });
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** Duration, size and audio presence, parsed from `ffmpeg -i` (no ffprobe in ffmpeg-static). */
export async function probe(file: string): Promise<ProbeResult> {
  let stderr = '';
  try {
    // `-f null -` decodes nothing useful but makes ffmpeg exit 0 with full stream info; -t 0 keeps it instant.
    stderr = (await run(['-i', file, '-t', '0', '-f', 'null', '-'])).stderr;
  } catch (err) {
    stderr = (err as Error).message;
  }
  const dur = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(stderr);
  const vid = /Stream #\S+.*?Video: .*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!vid) throw new FfmpegError(`Not a readable video: ${file}`);
  return {
    duration: dur ? parseTime(dur[1]!) : NaN,
    width: Number(vid[1]),
    height: Number(vid[2]),
    hasAudio: /Stream #\S+.*?Audio:/.test(stderr),
  };
}

/** A small PNG frame for library thumbnails. */
export async function thumbnail(file: string, atSec = 0.5, width = 320): Promise<Buffer> {
  const args = (ss: number) => ['-ss', String(ss), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-vcodec', 'png', '-'];
  let { stdout } = await run(args(atSec), { stdout: true });
  if (!stdout.length) ({ stdout } = await run(args(0), { stdout: true })); // shorter than atSec
  if (!stdout.length) throw new FfmpegError('Could not extract a frame.');
  return stdout;
}

/**
 * MediaRecorder WebM has no duration/cues, so players can't seek it.
 * A stream copy writes proper headers; it's fast (no re-encode).
 */
export async function remux(input: string, output: string): Promise<void> {
  await run(['-y', '-i', input, '-c', 'copy', output]);
}

export interface ExportOptions {
  kind: 'mp4' | 'gif' | 'webm';
  start: number;
  end: number;
  gifWidth?: number;
  gifFps?: number;
  onProgress?: (fraction: number) => void;
}

export async function exportVideo(input: string, output: string, o: ExportOptions): Promise<void> {
  const start = Math.max(0, o.start);
  const length = Math.max(0.05, o.end - start);
  const trim = ['-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', input];
  let args: string[];
  switch (o.kind) {
    case 'mp4':
      args = [...trim, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
      break;
    case 'gif': {
      const fps = Math.max(1, Math.min(30, o.gifFps ?? 12));
      const w = o.gifWidth && o.gifWidth > 0 ? `${Math.round(o.gifWidth)}:-1` : 'iw:-1';
      // One pass, two branches: build a palette from the clip, then dither with it.
      args = [...trim, '-vf', `fps=${fps},scale=${w}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'];
      break;
    }
    case 'webm':
      // Re-encode so the cut is frame-accurate (stream copy can only cut on keyframes).
      args = [...trim, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-c:a', 'libopus'];
      break;
  }
  await run(['-y', ...args, output], { duration: length, onProgress: o.onProgress });
  o.onProgress?.(1);
}
