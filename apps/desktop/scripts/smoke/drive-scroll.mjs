// Scrolling-capture smoke test. Usage: node drive-scroll.mjs <appDir> <smokeDir>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { decode } from './png.mjs';
const [appDir, dir] = process.argv.slice(2);
const require = createRequire(join(appDir, 'package.json'));
const { unzipSync } = require('fflate');
const electron = require('electron');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const log = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const root = join(dir, 'scroll-root'); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
const cfg = join(dir, 'config-scroll'); rmSync(cfg, { recursive: true, force: true }); mkdirSync(join(cfg, 'Magpie'), { recursive: true });
writeFileSync(join(cfg, 'Magpie', 'settings.json'), JSON.stringify({ autosaveDir: root }));
const env = { ...process.env, MAGPIE_FAKE_SCROLL: join(dir, 'tall.png'), XDG_CONFIG_HOME: cfg, ELECTRON_ENABLE_LOGGING: '1' };
const main = spawn(electron, ['.', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--capture=scroll'], { cwd: appDir, env });
main.stdout.on('data', (x) => log.push(String(x))); main.stderr.on('data', (x) => log.push(String(x)));

async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; } }
async function waitTarget(pred, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await targets()).find(pred); if (t) return t; await sleep(250); } throw new Error('target not found'); }
async function until(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; }
class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = []; this.ready = new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); } else this.events.push(msg); }); }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); const msg = await new Promise((r) => this.pending.set(id, r)); if (msg.error) throw new Error(method + ': ' + msg.error.message); return msg.result; }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async key(key, code, vk, modifiers = 0) { await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers }); await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); }
  errors() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => JSON.stringify(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description)).slice(0, 300)); }
}

try {
  const sc = new Cdp((await waitTarget((t) => t.url.includes('/scroll/'))).webSocketDebuggerUrl);
  await sc.send('Runtime.enable'); await sc.send('Page.enable');
  const sel = await until(() => sc.eval(`!!document.querySelector('.select canvas')`), 15000);
  check('region select shows the frozen frame', !!sel);
  await sc.shot(join(dir, 'S1-select.png'));
  await sc.key('Enter', 'Enter', 13); // whole frame
  const rec = await until(() => sc.eval(`!!document.querySelector('.panel')`));
  check('recording panel appears', !!rec);
  await sleep(1500);
  await sc.shot(join(dir, 'S2-recording.png'));
  const vw = await sc.eval(`({ w: innerWidth, h: innerHeight })`);
  check('recording window shrinks to a small panel', vw.w <= 480 && vw.h <= 200, `${vw.w}×${vw.h}`);
  // Wait for the fake to reach the bottom and the stitcher to go quiet.
  const quiet = await until(() => sc.eval(`/Waiting for you to scroll/.test(document.querySelector('.hint')?.textContent ?? '') && /3,000 px/.test(document.querySelector('.panel')?.textContent ?? '')`), 40000);
  const panelText = await sc.eval(`document.querySelector('.panel')?.textContent`);
  check('stitched height reaches the full page while recording', !!quiet, panelText);
  await sc.eval(`[...document.querySelectorAll('.panel button')].find(b => b.textContent.startsWith('Finish')).click()`);
  const rev = await until(() => sc.eval(`!!document.querySelector('.review img')?.complete`), 15000);
  check('review shows the stitched image', !!rev);
  await sleep(500);
  await sc.shot(join(dir, 'S3-review.png'));
  const rw = await sc.eval(`({ w: innerWidth, h: innerHeight })`);
  check('review window is a normal-sized window', rw.w <= 1100 && rw.h <= 860, `${rw.w}×${rw.h}`);
  const summary = await sc.eval(`document.querySelector('.review-side p')?.textContent`);
  check('review reports 900 × 3,000', /900 × 3,000 px/.test(summary ?? ''), summary);
  // Nudge round-trip: +1 then -1 restores the height.
  const seams = await sc.eval(`document.querySelectorAll('.seams li').length`);
  if (seams > 0) {
    await sc.eval(`document.querySelector('.seams li .nudges button[title="Move down 1 px"]').click()`);
    const nudged = await until(() => sc.eval(`/3,001 px/.test(document.querySelector('.review-side p')?.textContent ?? '')`));
    await sc.eval(`document.querySelector('.seams li .nudges button[title="Move up 1 px"]').click()`);
    const back = await until(() => sc.eval(`/3,000 px/.test(document.querySelector('.review-side p')?.textContent ?? '')`));
    check('seam nudge re-composes', !!nudged && !!back, `seams=${seams}`);
  }
  const scErr = sc.errors();
  check('no scroll-window console errors', scErr.length === 0, scErr.join(' | '));
  await sc.eval(`[...document.querySelectorAll('.review-side button')].find(b => b.textContent === 'Open in editor').click()`);
  const edT = await waitTarget((t) => t.url.includes('/editor/'));
  const ed = new Cdp(edT.webSocketDebuggerUrl); await ed.send('Runtime.enable'); await ed.send('Page.enable');
  const size = await until(() => ed.eval(`document.querySelector('.statusbar span')?.textContent`));
  check('editor opens the stitched capture', /900 × 3000 px/.test(size ?? ''), size);

  // Pixel check against the source page.
  const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith('.magpie') && files.push(p); } }; walk(root);
  const got = decode(Buffer.from(unzipSync(readFileSync(files[0]))['original.png']));
  const want = decode(readFileSync(join(dir, 'tall.png')));
  let worstRow = 0, worstY = -1, sum = 0;
  for (let y = 0; y < Math.min(got.height, want.height); y++) {
    let s = 0; for (let x = 0; x < want.width; x++) { const i = (y * want.width + x) * 4; s += Math.abs(got.data[i + 1] - want.data[i + 1]); }
    s /= want.width; sum += s; if (s > worstRow) { worstRow = s; worstY = y; }
  }
  const mean = sum / want.height;
  check('stitched pixels match the source page', got.height === want.height && worstRow < 8 && mean < 2, `size=${got.width}×${got.height} meanErr=${mean.toFixed(2)} worstRow=${worstRow.toFixed(1)}@${worstY}`);
  await ed.shot(join(dir, 'S4-editor.png'));
} catch (err) {
  results.push('ERROR ' + err.stack);
} finally {
  main.kill('SIGTERM'); await sleep(1500); if (main.exitCode === null && main.signalCode === null) main.kill('SIGKILL');
  writeFileSync(join(dir, 'electron-scroll.log'), log.join(''));
  console.log(results.join('\n'));
}
