// Phase 4 smoke test: OCR (background + Grab text), stamps, paste, presets, templates.
// Usage: node drive-phase4.mjs <appDir> <smokeDir>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [appDir, dir] = process.argv.slice(2);
const require = createRequire(join(appDir, 'package.json'));
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const electron = require('electron');
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const log = [];
const check = (name, ok, extra = '') => { const line = `[${Math.round(process.uptime())}s] ${ok ? "PASS" : "FAIL"} ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`; results.push(line); console.log(line); };

const root = join(dir, 'p4-root'); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
const cfg = join(dir, 'config-p4'); rmSync(cfg, { recursive: true, force: true }); mkdirSync(join(cfg, 'Magpie'), { recursive: true });
writeFileSync(join(cfg, 'Magpie', 'settings.json'), JSON.stringify({
  autosaveDir: root, ocrEnabled: true,
  capturePresets: [{ id: 'p1', name: 'Quiet', mode: 'full', delaySec: 0, copyToClipboard: true, openEditor: false, tags: ['auto'], hotkey: '' }],
}));
const desktopPng = join(dir, 'desktop.png');
if (!existsSync(desktopPng)) writeFileSync(desktopPng, unzipSync(readFileSync(join(dir, 'test.magpie')))['original.png']);
const env = { ...process.env, MAGPIE_FAKE_CAPTURE: desktopPng, XDG_CONFIG_HOME: cfg, ELECTRON_ENABLE_LOGGING: '1' };
const run = (args) => spawn(electron, ['.', '--no-sandbox', ...args], { cwd: appDir, env });
const main = run([`--remote-debugging-port=${PORT}`, '--library']);
main.stdout.on('data', (x) => log.push(String(x))); main.stderr.on('data', (x) => log.push(String(x)));
const flushLog = setInterval(() => writeFileSync(join(dir, 'electron-p4.log'), log.join('')), 2000);

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
  async click(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); }
  async type(text) { await this.send('Input.insertText', { text }); }
  errors() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => JSON.stringify(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description)).slice(0, 300)); }
}
const btn = (c, text) => c.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
const projectFiles = () => { const out = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : f.endsWith('.magpie') && out.push(p); } }; walk(root); return out; };

try {
  const lib = new Cdp((await waitTarget((t) => t.url.includes('/library/'))).webSocketDebuggerUrl);
  await lib.send('Runtime.enable'); await lib.send('Page.enable');
  await until(() => lib.eval(`!!document.querySelector('.search')`), 15000);

  // Render a real text image in the app (system fonts), wrap it as a .magpie in the library folder.
  const dataUrl = await lib.eval(`(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 260; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 260); g.fillStyle = '#111'; g.font = '40px sans-serif';
    g.fillText('Invoice 4417 is overdue', 40, 90); g.font = '32px sans-serif'; g.fillText('Contact billing team today', 40, 170);
    return c.toDataURL('image/png'); })()`);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const now = new Date().toISOString();
  const manifest = { format: 'magpie', version: 1, app: { name: 'Magpie', version: 'smoke' }, created: now, modified: now, os: { platform: 'linux', release: 'x' }, image: { widthPx: 900, heightPx: 260 }, source: 'import', displays: [], thumb: null, title: 'Text sample' };
  const textFile = join(root, 'text-sample.magpie');
  writeFileSync(textFile, zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'original.png': [new Uint8Array(png), { level: 0 }], 'annotations.json': strToU8(JSON.stringify({ version: 1, crop: null, annotations: [] })) }));

  // 1. Background OCR makes it searchable.
  await lib.eval(`document.querySelector('.search').focus()`);
  await lib.type('overdue');
  const found = await until(() => lib.eval(`document.querySelectorAll('.card').length === 1`), 120000);
  check('background OCR makes text searchable ("overdue")', !!found, log.join('').split('\n').filter((l) => /\[ocr\]|ocr/i.test(l)).slice(-3).join(' | '));
  await lib.eval(`document.querySelector('.card')?.click()`);
  const ocrShown = await until(() => lib.eval(`/Invoice/.test(document.querySelector('.ocr pre')?.textContent ?? '')`));
  check('library details show the text found', !!ocrShown);
  await lib.shot(join(dir, 'P1-library-ocr.png'));

  // 2. Quiet preset: no editor, tagged, in the library.
  const before = projectFiles().length;
  run(['--preset=Quiet']);
  const added = await until(() => projectFiles().length === before + 1, 15000);
  await sleep(1500);
  const newest = projectFiles().find((p) => p !== textFile);
  const m = newest ? JSON.parse(strFromU8(unzipSync(readFileSync(newest))['manifest.json'])) : {};
  const editors = (await targets()).filter((t) => t.url.includes('/editor/')).length;
  check('capture preset saves quietly with its tags', !!added && editors === 0 && (m.tags ?? []).includes('auto'), `editors=${editors} tags=${JSON.stringify(m.tags)}`);

  // 3. Editor: Grab text.
  await lib.eval(`[...document.querySelectorAll('.card')].forEach(c => c.title.endsWith('text-sample.magpie') && c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))`);
  const ed = new Cdp((await waitTarget((t) => t.url.includes('/editor/'))).webSocketDebuggerUrl);
  await ed.send('Runtime.enable'); await ed.send('Page.enable');
  await until(() => ed.eval(`!!document.querySelector('.canvas-wrap canvas')`));
  await sleep(500);
  const box = await ed.eval(`(() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  await ed.key('g', 'KeyG', 71, 0, 'g');
  await ed.click(box.x + box.w / 2, box.y + box.h / 2);
  const grabbed = await until(() => ed.eval(`document.querySelector('.ocr-text')?.value ?? ''`), 60000);
  check('Grab text reads the image', /overdue/i.test(grabbed ?? '') && /Invoice/i.test(grabbed ?? ''), JSON.stringify(grabbed));
  await ed.shot(join(dir, 'P2-grab-text.png'));
  await btn(ed, 'Close');

  // 4. Stamp tool.
  await ed.key('m', 'KeyM', 77, 0, 'm');
  await ed.click(box.x + box.w * 0.85, box.y + box.h * 0.3);
  await sleep(300);

  // 5. Paste an image → image annotation, then Save as stamp.
  await ed.eval(`(async () => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; const g = c.getContext('2d'); g.fillStyle = '#4c8dff'; g.fillRect(0,0,120,80); g.fillStyle = '#fff'; g.fillRect(20,20,80,40);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'logo.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); })()`);
  const pasted = await until(() => ed.eval(`document.querySelector('.props h3')?.textContent.startsWith('Image')`));
  check('pasting an image adds an image annotation', !!pasted);
  await btn(ed, 'Save as stamp');
  await until(() => ed.eval(`!!document.querySelector('#prompt-input')`));
  await ed.eval(`document.querySelector('#prompt-input').select()`);
  await ed.type('Logo');
  await ed.key('Enter', 'Enter', 13, 0, '\r');
  const stamps = await until(() => ed.eval(`window.magpie.listStamps().then(l => l.map(s => s.name).join(','))`));
  check('Save as stamp adds a custom stamp', stamps === 'Logo', stamps);

  // 6. Style preset for rectangles.
  await ed.key('Escape', 'Escape', 27); // deselect
  await ed.key('r', 'KeyR', 82, 0, 'r');
  await btn(ed, '+ Save current');
  await until(() => ed.eval(`!!document.querySelector('#prompt-input')`));
  await ed.type('Thick red');
  await ed.key('Enter', 'Enter', 13, 0, '\r');
  const chip = await until(() => ed.eval(`[...document.querySelectorAll('.preset-chip')].some(c => c.textContent.includes('Thick red'))`));
  check('style preset saved and listed', !!chip);
  await ed.shot(join(dir, 'P3-editor-props.png'));

  // 7. Templates: save current annotations, apply → doubles them.
  await btn(ed, 'Templates');
  await btn(ed, 'Save annotations as template');
  await until(() => ed.eval(`!!document.querySelector('#prompt-input')`));
  await ed.type('Review kit');
  await ed.key('Enter', 'Enter', 13, 0, '\r');
  await sleep(300);
  await btn(ed, 'Templates');
  await sleep(200);
  await ed.eval(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Review kit'))?.click()`);
  await sleep(300);

  // 8. Save and inspect the file.
  await ed.key('s', 'KeyS', 83, 2);
  await sleep(2500);
  const z = unzipSync(readFileSync(textFile));
  const anns = JSON.parse(strFromU8(z['annotations.json'])).annotations;
  const types = anns.map((a) => a.type).sort().join(',');
  const assetEntries = Object.keys(z).filter((k) => k.startsWith('assets/'));
  // Template skips image annotations: stamp + image, then + stamp → 3.
  check('file has stamp, image (+template copy) and embedded asset', types === 'image,stamp,stamp' && assetEntries.length === 1, `types=${types} assets=${assetEntries.join(',')}`);
  await ed.shot(join(dir, 'P4-editor-final.png'));

  const errs = [...lib.errors(), ...ed.errors()];
  check('no console errors', errs.length === 0, errs.join(' | '));
} catch (err) {
  results.push('ERROR ' + err.stack);
} finally {
  main.kill('SIGTERM'); await sleep(2000); if (main.exitCode === null && main.signalCode === null) main.kill('SIGKILL');
  clearInterval(flushLog);
  writeFileSync(join(dir, 'electron-p4.log'), log.join(''));
  console.log(`-- ${results.filter((r) => r.includes(' PASS ')).length}/${results.length} passed`);
}
