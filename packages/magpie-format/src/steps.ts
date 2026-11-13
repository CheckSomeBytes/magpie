import type { Annotation } from './schema';

/** Renumber step callouts 1..n in document order. Returns the same array if nothing changed. */
export function renumberSteps(annotations: Annotation[]): Annotation[] {
  let n = 0;
  let changed = false;
  const out = annotations.map((a) => {
    if (a.type !== 'step') return a;
    n += 1;
    if (a.data.number === n) return a;
    changed = true;
    return { ...a, data: { ...a.data, number: n } };
  });
  return changed ? out : annotations;
}

export function nextStepNumber(annotations: Annotation[]): number {
  return annotations.filter((a) => a.type === 'step').length + 1;
}
