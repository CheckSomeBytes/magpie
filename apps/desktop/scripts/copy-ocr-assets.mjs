// Copy tesseract.js worker, LSTM cores and English data into resources/ocr so
// OCR runs fully offline (§11). Runs before dev/build; output is gitignored.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'resources', 'ocr');
const require = createRequire(join(here, '..', 'package.json'));
const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tess] }));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tess, 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [join(core, `tesseract-core-${v}.wasm.js`), join(out, 'core', `tesseract-core-${v}.wasm.js`)]),
  // best_int: LSTM, ~3 MB, better accuracy/size trade-off than the 11 MB float model.
  [join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz')],
];

let copied = 0;
for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  copied++;
}
console.log(`ocr assets: ${copied} copied, ${files.length - copied} up to date → ${out}`);
