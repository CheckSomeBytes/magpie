// Smoke test: drive Magpie over CDP. Usage: node drive.mjs <appDir> <smokeDir>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [appDir, dir] = process.argv.slice(2);
const require = createRequire(join(appDir, 'package.json'));
const { unzipSync, strFromU8 } = require('fflate');
const electron = require('electron');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const proj = join(dir, 'work.magpie');
copyFileSync(join(dir, 'test.magpie'), proj);
writeFileSync(join(dir, 'desktop.png'), unzipSync(readFileSync(proj))['original.png']);
const picDir = join(dir, 'Pictures'); rmSync(picDir, { recursive: true, force: true }); mkdirSync(picDir, { recursive: true });
const env = { ...process.env, MAGPIE_FAKE_CAPTURE: join(dir, 'desktop.png'), ELECTRON_ENABLE_LOGGING: '1', XDG_CONFIG_HOME: join(dir, 'config'), HOME_PICTURES: picDir };

const run = (args) => spawn(electron, ['.', '--no-sandbox', ...args], { cwd: appDir, env });
const main = run([`--remote-debugging-port=${PORT}`, proj]);
main.stdout.on('data', (d) => log.push(String(d)));
main.stderr.on('data', (d) => log.push(String(d)));

async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; } }
async function waitTarget(pred, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const t = (await targets()).find(pred); if (t) return t; await sleep(250); }
  throw new Error('target not found');
}
class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); } else this.events.push(msg); }); }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    const msg = await new Promise((r) => this.pending.set(id, r)); if (msg.error) throw new Error(method + ': ' + msg.error.message); return msg.result; }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async key(key, code, vk, modifiers = 0, text) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); }
  async drag(x0, y0, x1, y1) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, button: 'left', buttons: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 }); }
  errors() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map((e) => JSON.stringify(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description)).slice(0, 400)); }
}
const annCount = () => JSON.parse(strFromU8(unzipSync(readFileSync(proj))['annotations.json'])).annotations;

try {
  // ---- A: editor renders an existing project
  const ed = new Cdp((await waitTarget((t) => t.url.includes('/editor/'))).webSocketDebuggerUrl);
  await ed.send('Runtime.enable'); await ed.send('Page.enable');
  await sleep(2500);
  await ed.shot(join(dir, '1-editor-open.png'));
  const hasCanvas = await ed.eval(`!!document.querySelector('.canvas-wrap canvas')`);
  check('editor renders Konva canvas', hasCanvas);

  // ---- B: draw a rectangle with the R tool
  const box = await ed.eval(`(() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  await ed.key('r', 'KeyR', 82, 0, 'r');
  await ed.drag(box.x + box.w * 0.06, box.y + box.h * 0.75, box.x + box.w * 0.3, box.y + box.h * 0.93);
  await sleep(300);
  // ---- arrow too
  await ed.key('a', 'KeyA', 65, 0, 'a');
  await ed.drag(box.x + box.w * 0.9, box.y + box.h * 0.9, box.x + box.w * 0.75, box.y + box.h * 0.7);
  await sleep(300);
  await ed.shot(join(dir, '2-editor-drawn.png'));

  // ---- C: explicit save, verify on disk
  await ed.key('s', 'KeyS', 83, 2);
  await sleep(2500);
  const anns = annCount();
  check('save writes new annotations to .magpie', anns.length === 10, `count=${anns.length}`);
  const entries = Object.keys(unzipSync(readFileSync(proj)));
  check('save writes thumb.webp', entries.includes('thumb.webp'), entries.join(','));

  // ---- D: undo then autosave
  await ed.key('z', 'KeyZ', 90, 2);
  await sleep(2000);
  check('undo + autosave removes last shape', annCount().length === 9, `count=${annCount().length}`);

  // ---- E: crop tool + copy
  await ed.key('c', 'KeyC', 67, 0, 'c');
  await ed.drag(box.x + box.w * 0.15, box.y + box.h * 0.08, box.x + box.w * 0.7, box.y + box.h * 0.7);
  await sleep(300);
  await ed.shot(join(dir, '3-editor-crop.png'));
  await ed.key('Enter', 'Enter', 13);
  await sleep(400);
  await ed.shot(join(dir, '4-editor-cropped.png'));
  await ed.key('c', 'KeyC', 67, 2);
  await sleep(800);
  const toast = await ed.eval(`document.querySelector('.toast')?.textContent ?? null`);
  check('Ctrl+C copies (toast shown)', toast === 'Copied to clipboard', String(toast));
  const status = await ed.eval(`document.querySelector('.statusbar')?.textContent`);
  check('status bar shows cropped size', /cropped/.test(status), status);
  const edErrors = ed.errors();
  check('no editor console errors', edErrors.length === 0, edErrors.join(' | '));

  // ---- F: capture region through overlay (fake provider), via second instance CLI
  run(['--capture', 'region']);
  const ovT = await waitTarget((t) => t.url.includes('/overlay/'));
  const ov = new Cdp(ovT.webSocketDebuggerUrl);
  await ov.send('Runtime.enable'); await ov.send('Page.enable');
  await sleep(1500);
  const vw = await ov.eval(`({w: innerWidth, h: innerHeight})`);
  await ov.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vw.w * 0.3, y: vw.h * 0.3 });
  await sleep(200);
  await ov.shot(join(dir, '5-overlay.png'));
  const before = new Set((await targets()).filter((t) => t.url.includes('/editor/')).map((t) => t.id));
  await ov.drag(vw.w * 0.2, vw.h * 0.25, vw.w * 0.6, vw.h * 0.65);
  const ed2T = await waitTarget((t) => t.url.includes('/editor/') && !before.has(t.id));
  const ed2 = new Cdp(ed2T.webSocketDebuggerUrl);
  await ed2.send('Runtime.enable'); await ed2.send('Page.enable');
  await sleep(2000);
  await ed2.shot(join(dir, '6-editor-from-capture.png'));
  const size = await ed2.eval(`document.querySelector('.statusbar span')?.textContent`);
  check('region capture opens editor with cropped image', !!size && !/1600 × 1000/.test(size), size);

  // ---- G: home window via second instance with no args
  run([]);
  const home = new Cdp((await waitTarget((t) => t.url.includes('/home/'))).webSocketDebuggerUrl);
  await home.send('Runtime.enable'); await home.send('Page.enable');
  await sleep(1500);
  await home.eval(`document.querySelector('.card button') && [...document.querySelectorAll('button')].find(b => b.textContent==='Run checks')?.click()`);
  await sleep(1500);
  await home.shot(join(dir, '7-home.png'));
  const homeErr = home.errors();
  check('no home console errors', homeErr.length === 0, homeErr.join(' | '));

  // ---- H: close editor → app stays resident (tray)
  await ed2.key('w', 'KeyW', 87, 2);
  await sleep(1500);
  check('app stays resident after closing an editor', main.exitCode === null);

  // ---- I: quitting with editors open must still exit (editors flush first)
  const exited = new Promise((r) => main.once('exit', () => r(true)));
  main.kill('SIGTERM');
  const ok = await Promise.race([exited, sleep(8000).then(() => false)]);
  check('app quits with editors open', ok === true);
} catch (err) {
  results.push('ERROR ' + err.stack);
} finally {
  if (main.exitCode === null && main.signalCode === null) main.kill('SIGKILL');
  await sleep(500);
  writeFileSync(join(dir, 'electron.log'), log.join(''));
  console.log(results.join('\n'));
}
