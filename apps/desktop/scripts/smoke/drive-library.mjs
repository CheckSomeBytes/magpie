// Library smoke test over CDP. Usage: node drive-library.mjs <appDir> <smokeDir>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [appDir, dir] = process.argv.slice(2);
const require = createRequire(join(appDir, 'package.json'));
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const electron = require('electron');
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// ---- fixture library
const root = join(dir, 'lib-root');
rmSync(root, { recursive: true, force: true });
const base = unzipSync(readFileSync(join(dir, 'test.magpie')));
function make(rel, patch) {
  const m = { ...JSON.parse(strFromU8(base['manifest.json'])), ...patch };
  const files = { ...base, 'thumb.png': base['original.png'], 'manifest.json': strToU8(JSON.stringify({ ...m, thumb: 'thumb.png' })) };
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, zipSync(files));
  return p;
}
const d = (daysAgo, h = 10) => { const x = new Date(); x.setDate(x.getDate() - daysAgo); x.setHours(h, 0, 0, 0); return x.toISOString(); };
make('2026/11/a.magpie', { title: 'Grafana CPU dashboard', tags: ['ops', 'metrics'], created: d(0, 11) });
make('2026/11/b.magpie', { title: 'Checkout button bug', tags: ['bug', 'web'], created: d(0, 9) });
make('2026/11/c.magpie', { created: d(1) });
const victim = make('2026/11/d.magpie', { title: 'Delete me externally', created: d(3) });
make('2026/10/e.magpie', { title: 'Old onboarding flow', tags: ['web'], created: d(40) });
const files = readdirSync(join(root, '2026/11'));

const cfg = join(dir, 'config-lib');
rmSync(cfg, { recursive: true, force: true });
mkdirSync(join(cfg, 'Magpie'), { recursive: true });
writeFileSync(join(cfg, 'Magpie', 'settings.json'), JSON.stringify({ autosaveDir: root }));
const env = { ...process.env, MAGPIE_FAKE_CAPTURE: join(dir, 'desktop.png'), XDG_CONFIG_HOME: cfg, ELECTRON_ENABLE_LOGGING: '1' };
const run = (args) => spawn(electron, ['.', '--no-sandbox', ...args], { cwd: appDir, env });
const main = run([`--remote-debugging-port=${PORT}`, '--library']);
main.stdout.on('data', (x) => log.push(String(x)));
main.stderr.on('data', (x) => log.push(String(x)));

async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; } }
async function waitTarget(pred, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await targets()).find(pred); if (t) return t; await sleep(250); } throw new Error('target not found'); }
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; }
class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); } else this.events.push(msg); }); }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); const msg = await new Promise((r) => this.pending.set(id, r)); if (msg.error) throw new Error(method + ': ' + msg.error.message); return msg.result; }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async type(text) { await this.send('Input.insertText', { text }); }
  async key(key, code, vk, modifiers = 0) { await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers }); await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }); }
  errors() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => JSON.stringify(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description)).slice(0, 300)); }
}
const manifestOf = (p) => JSON.parse(strFromU8(unzipSync(readFileSync(p))['manifest.json']));
const cards = (c) => c.eval(`document.querySelectorAll('.card').length`);

try {
  const lib = new Cdp((await waitTarget((t) => t.url.includes('/library/'))).webSocketDebuggerUrl);
  await lib.send('Runtime.enable'); await lib.send('Page.enable');
  const n0 = await until(async () => (await cards(lib)) === 5 && 5, 10000);
  check('initial scan indexes all 5 files', n0 === 5, `cards=${await cards(lib)}`);
  const thumbsOk = await until(() => lib.eval(`[...document.querySelectorAll('.card img')].every(i => i.complete && i.naturalWidth > 0) && document.querySelectorAll('.card img').length`), 6000);
  check('thumbnails load over magpie-thumb://', thumbsOk === 5, String(thumbsOk));
  const days = await lib.eval(`[...document.querySelectorAll('.day')].map(e => e.textContent)`);
  check('grouped by day', days[0] === 'Today' && days[1] === 'Yesterday', days.join(' | '));
  await lib.shot(join(dir, 'L1-library.png'));

  // Search
  await lib.eval(`document.querySelector('.search').focus()`);
  await lib.type('grafa');
  const s1 = await until(async () => { const n = await cards(lib); return n === 1 ? n : null; });
  check('search narrows to prefix match', s1 === 1, `cards=${await cards(lib)}`);
  await lib.eval(`(() => { const i = document.querySelector('.search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(async () => (await cards(lib)) === 5);

  // Tag filter (sidebar): web → 2
  await lib.eval(`[...document.querySelectorAll('.side-item.tag')].find(b => b.textContent.includes('web')).click()`);
  const t1 = await until(async () => { const n = await cards(lib); return n === 2 ? n : null; });
  check('tag filter', t1 === 2, `cards=${await cards(lib)}`);
  await lib.eval(`[...document.querySelectorAll('.side-item')].find(b => b.textContent.startsWith('All captures')).click()`);
  await until(async () => (await cards(lib)) === 5);

  // Select untitled capture "c", add a tag and a title → written into the file
  const cPath = join(root, '2026/11/c.magpie');
  await lib.eval(`document.querySelector('.card[title$="c.magpie"]').click()`);
  await sleep(300);
  await lib.eval(`document.querySelector('.tag-editor input').focus()`);
  await lib.type('triage');
  await lib.key('Enter', 'Enter', 13);
  const tagged = await until(() => (manifestOf(cPath).tags ?? []).includes('triage'));
  check('adding a tag writes the .magpie manifest', !!tagged, JSON.stringify(manifestOf(cPath).tags));
  await lib.eval(`document.querySelector('#title').focus()`);
  await lib.type('Staging deploy error');
  await lib.key('Enter', 'Enter', 13);
  const titled = await until(() => manifestOf(cPath).title === 'Staging deploy error');
  check('renaming writes the manifest title', !!titled, String(manifestOf(cPath).title));
  const sideTag = await until(() => lib.eval(`[...document.querySelectorAll('.side-item.tag')].some(b => b.textContent.includes('triage'))`));
  check('sidebar picks up the new tag', !!sideTag);
  const cardTitle = await until(() => lib.eval(`document.querySelector('.card[title$="c.magpie"] .card-title')?.textContent === 'Staging deploy error'`));
  check('card shows the new title', !!cardTitle);
  await lib.shot(join(dir, 'L2-library-edited.png'));

  // External delete → watcher drops it
  unlinkSync(victim);
  const afterDel = await until(async () => { const n = await cards(lib); return n === 4 ? n : null; }, 8000);
  check('watcher removes externally deleted files', afterDel === 4, `cards=${await cards(lib)}`);

  // New capture via CLI → appears automatically
  run(['--capture=full']);
  const edT = await waitTarget((t) => t.url.includes('/editor/'));
  const afterCap = await until(async () => { const n = await cards(lib); return n === 5 ? n : null; }, 10000);
  check('a new capture shows up in the library', afterCap === 5, `cards=${await cards(lib)}`);

  // Editor save must not clobber library tags: tag the new capture, then edit + save in the editor.
  const ed = new Cdp(edT.webSocketDebuggerUrl);
  await ed.send('Runtime.enable'); await ed.send('Page.enable');
  await sleep(1500);
  const newest = await lib.eval(`document.querySelector('.card').getAttribute('title')`);
  await lib.eval(`document.querySelector('.card').click()`);
  await sleep(300);
  await lib.eval(`document.querySelector('.tag-editor input').focus()`);
  await lib.type('fresh');
  await lib.key('Enter', 'Enter', 13);
  await until(() => (manifestOf(newest).tags ?? []).includes('fresh'));
  const box = await ed.eval(`(() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  await ed.key('r', 'KeyR', 82);
  await ed.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x + 30, y: box.y + 30, button: 'left', buttons: 1, clickCount: 1 });
  await ed.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 120, y: box.y + 90, button: 'left', buttons: 1 });
  await ed.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 120, y: box.y + 90, button: 'left', buttons: 0, clickCount: 1 });
  await ed.key('s', 'KeyS', 83, 2);
  await sleep(2500);
  const m = manifestOf(newest);
  const docN = JSON.parse(strFromU8(unzipSync(readFileSync(newest))['annotations.json'])).annotations.length;
  check('editor save keeps library tags', (m.tags ?? []).includes('fresh') && docN === 1, `tags=${JSON.stringify(m.tags)} annotations=${docN}`);
  const annCount = await until(() => lib.eval(`document.querySelector('.info') && [...document.querySelectorAll('.info dd')][3]?.textContent === '1'`));
  check('library re-indexes after an editor save', !!annCount);
  await lib.shot(join(dir, 'L3-library-final.png'));

  const errs = lib.errors();
  check('no library console errors', errs.length === 0, errs.join(' | '));
} catch (err) {
  results.push('ERROR ' + err.stack);
} finally {
  main.kill();
  await sleep(500);
  writeFileSync(join(dir, 'electron-lib.log'), log.join(''));
  console.log(results.join('\n'));
  console.log(log.join('').split('\n').filter((l) => l.includes('[library]')).join('\n'));
}
