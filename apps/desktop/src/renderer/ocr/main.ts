// Hidden OCR worker window for background library indexing (Phase 4).
import { api } from '../shared/api';
import { recognizeText } from '../shared/ocr';

let queue = Promise.resolve();
api.onOcrJob((job) => {
  queue = queue.then(async () => {
    try {
      api.ocrResult(job.id, await recognizeText(job.png));
    } catch (err) {
      api.ocrResult(job.id, null, (err as Error).message ?? String(err));
    }
  });
});
api.ocrReady();
