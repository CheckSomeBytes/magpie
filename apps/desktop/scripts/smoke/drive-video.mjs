// Phase 5 smoke test: record (fake stream) → remux → review → trim → export MP4/GIF → library.
// Usage: node drive-video.mjs <appDir> <smokeDir>
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [appDir, dir] = process.argv.slice(2);
const require = createRequire(join(appDir, 'package.json'));
const electron = require('electron');
const ffmpeg = require('ffmpeg-static');
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const log = [];
const check = (name, ok, extra = '') => { const line = `[${Math.round(process.uptime())}s] ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`; results.push(line); console.log(line); };

const root = join(dir, 'video-root'); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
const cfg = join(dir, 'config-video'); rmSync(cfg, { recursive: true, force: true }); mkdirSync(join(cfg, 'Magpie'), { recursive: true });
writeFileSync(join(cfg, 'Magpie', 'settings.json'), JSON.stringify({ autosaveDir: root, ocrEnabled: false }));
const env = { ...process.env, MAGPIE_FAKE_VIDEO: '1', XDG_CONFIG_HOME: cfg, ELECTRON_ENABLE_LOGGING: '1' };
const run = (args) => spawn(electron, ['.', '--no-sandbox', ...args], { cwd: appDir, env });
const main = run([`--remote-debugging-port=${PORT}`, '--library']);
main.stdout.on('data', (x) => log.push(String(x))); main.stderr.on('data', (x) => log.push(String(x)));

async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; } }
async function waitTarget(pred, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await targets()).find(pred); if (t) return t; await sleep(250); } throw new Error('target not found'); }
async function until(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(250); } return null; }
class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = []; this.ready = new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); } else this.events.push(msg); }); }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); const msg = await new Promise((r) => this.pending.set(id, r)); if (msg.error) throw new Error(method + ': ' + msg.error.message); return msg.result; }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async key(key, code, vk, modifiers = 0, text) { await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text }); await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); }
  async type(text) { await this.send('Input.insertText', { text }); }
  errors() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => JSON.stringify(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description)).slice(0, 300)); }
}
const btn = (c, text) => c.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b || b.disabled) return false; b.click(); return true; })()`);
const files = (ext) => { const out = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith(ext) && out.push(p); } }; walk(root); return out; };
const durationOf = (f) => { try { execFileSync(ffmpeg, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; } return NaN; };

try {
  const lib = new Cdp((await waitTarget((t) => t.url.includes('/library/'))).webSocketDebuggerUrl);
  await lib.send('Runtime.enable'); await lib.send('Page.enable');
  await until(() => lib.eval(`!!document.querySelector('.search')`), 15000);

  // 1. Record via the hotkey path (second instance).
  run(['--capture=video']);
  const rec = new Cdp((await waitTarget((t) => t.url.includes('/record/'))).webSocketDebuggerUrl);
  await rec.send('Runtime.enable'); await rec.send('Page.enable');
  const live = await until(() => rec.eval(`/Recording/.test(document.body.textContent)`), 15000);
  check('recorder starts and shows the panel', !!live);
  await sleep(3500);
  await rec.shot(join(dir, 'V1-recording.png'));
  const part = files('.webm.part');
  check('chunks stream to a .part file while recording', part.length === 1 && statSync(part[0]).size > 10000, part.map((p) => statSync(p).size).join(','));
  // Stop with the hotkey path again.
  run(['--capture=video']);

  // 2. Review window opens on a remuxed, seekable WebM.
  const vt = await waitTarget((t) => t.url.includes('/video/'), 20000);
  const vid = new Cdp(vt.webSocketDebuggerUrl);
  await vid.send('Runtime.enable'); await vid.send('Page.enable');
  const webm = files('.webm');
  check('recording saved as .webm (no .part left)', webm.length === 1 && files('.webm.part').length === 0, webm.join(','));
  const d = durationOf(webm[0]);
  check('remuxed file has a real duration', d > 2.5 && d < 6, `duration=${d}`);
  const ready = await until(() => vid.eval(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 1 && Number.isFinite(v.duration) ? v.duration : 0; })()`), 15000);
  check('player knows the duration', ready > 2.5, `duration=${ready}`);
  const seeked = await vid.eval(`new Promise((res) => { const v = document.querySelector('video'); v.addEventListener('seeked', () => res(v.currentTime), { once: true }); v.currentTime = 1.0; setTimeout(() => res(-1), 5000); })`);
  check('player can seek (Range requests)', Math.abs(seeked - 1.0) < 0.2, `currentTime=${seeked}`);

  // 3. Trim 0.5 → 2.0 with I / O at the playhead.
  await vid.eval(`new Promise((res) => { const v = document.querySelector('video'); v.addEventListener('seeked', () => res(true), { once: true }); v.currentTime = 0.5; })`);
  await vid.eval(`document.activeElement?.blur()`);
  await vid.key('i', 'KeyI', 73, 0, 'i');
  await vid.eval(`new Promise((res) => { const v = document.querySelector('video'); v.addEventListener('seeked', () => res(true), { once: true }); v.currentTime = 2.0; })`);
  await vid.key('o', 'KeyO', 79, 0, 'o');
  await sleep(300);
  const sel = await vid.eval(`document.querySelector('.trim-row.meta span')?.textContent`);
  check('trim set with I / O', /selection 0:01\.5/.test(sel ?? ''), sel);
  await vid.shot(join(dir, 'V2-review.png'));

  // 4. Export MP4 + GIF.
  await btn(vid, 'Export MP4');
  const mp4 = await until(() => files('.mp4')[0], 60000);
  await until(() => vid.eval(`/Saved/.test(document.querySelector('.result')?.textContent ?? '')`), 30000);
  const md = mp4 ? durationOf(mp4) : NaN;
  check('MP4 export honours the trim', !!mp4 && md > 1.3 && md < 1.8, `duration=${md}`);
  await btn(vid, 'Export GIF');
  const gif = await until(() => files('.gif')[0], 60000);
  await until(() => vid.eval(`/\\.gif/.test(document.querySelector('.result')?.textContent ?? '')`), 30000);
  check('GIF export', !!gif && readFileSync(gif).subarray(0, 6).toString('ascii') === 'GIF89a');
  await vid.shot(join(dir, 'V3-exported.png'));

  // 5. Library shows the recording and the MP4 as videos; tagging writes a sidecar.
  const cards = await until(async () => { const n = await lib.eval(`document.querySelectorAll('.card .badge').length`); return n >= 2 ? n : null; }, 20000);
  check('library lists videos with a duration badge', cards >= 2, `badges=${cards}`);
  await lib.eval(`[...document.querySelectorAll('.card')].find(c => c.title.endsWith('.webm'))?.click()`);
  await sleep(300);
  await lib.eval(`document.querySelector('.tag-editor input').focus()`);
  await lib.type('demo');
  await lib.key('Enter', 'Enter', 13);
  const side = await until(() => existsSync(`${webm[0]}.json`) && JSON.parse(readFileSync(`${webm[0]}.json`, 'utf8')).tags?.includes('demo'));
  check('tagging a video writes its sidecar', !!side);
  const tagged = await until(() => lib.eval(`[...document.querySelectorAll('.side-item.tag')].some(b => b.textContent.includes('demo'))`));
  check('sidebar picks up the video tag', !!tagged);
  await lib.shot(join(dir, 'V4-library.png'));

  const errs = [...lib.errors(), ...vid.errors()];
  check('no console errors', errs.length === 0, errs.join(' | '));
} catch (err) {
  results.push('ERROR ' + err.stack); console.log('ERROR ' + err.stack);
} finally {
  main.kill('SIGTERM'); await sleep(2000); if (main.exitCode === null && main.signalCode === null) main.kill('SIGKILL');
  writeFileSync(join(dir, 'electron-video.log'), log.join(''));
  console.log(`-- ${results.filter((r) => r.includes(' PASS ')).length}/${results.length} passed`);
}
