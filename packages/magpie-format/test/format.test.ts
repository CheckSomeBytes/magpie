import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  FORMAT_VERSION,
  annotationText,
  normalizeTags,
  usedAssets,
  FormatError,
  emptyDoc,
  migrate,
  nextStepNumber,
  packProject,
  peekProject,
  renumberSteps,
  unpackProject,
  type Annotation,
  type MagpieProject,
  type Manifest,
} from '../src';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    format: 'magpie',
    version: FORMAT_VERSION,
    app: { name: 'Magpie', version: '0.1.0' },
    created: '2026-11-13T00:00:00.000Z',
    modified: '2026-11-13T00:00:00.000Z',
    os: { platform: 'linux', release: '6.18', session: 'wayland' },
    image: { widthPx: 3840, heightPx: 2160 },
    source: 'portal',
    displays: [
      { id: '1', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5, rectPx: { x: 0, y: 0, width: 3840, height: 2160 } },
    ],
    thumb: 'thumb.webp',
    ...over,
  };
}

const arrow: Annotation = {
  id: 'a1',
  type: 'arrow',
  x: 10,
  y: 20,
  rotation: 0,
  style: { stroke: '#e5484d', strokeWidth: 6 },
  data: { points: [0, 0, 100, 50] },
};

const step = (id: string, number: number): Annotation => ({
  id,
  type: 'step',
  x: 0,
  y: 0,
  rotation: 0,
  style: { stroke: '#fff', fill: '#e5484d', strokeWidth: 2 },
  data: { number, radius: 18 },
});

describe('pack/unpack', () => {
  it('round-trips a project byte-for-byte', () => {
    const project: MagpieProject = {
      manifest: manifest(),
      original: PNG,
      doc: { ...emptyDoc(), crop: { x: 1, y: 2, width: 3, height: 4 }, annotations: [arrow] },
      thumb: new Uint8Array([9, 9, 9]),
    };
    const back = unpackProject(packProject(project));
    expect(back.manifest).toEqual(project.manifest);
    expect(back.doc).toEqual(project.doc);
    expect(Array.from(back.original)).toEqual(Array.from(PNG));
    expect(Array.from(back.thumb!)).toEqual([9, 9, 9]);
  });

  it('writes thumb: null when there is no thumbnail', () => {
    const bytes = packProject({ manifest: manifest(), original: PNG, doc: emptyDoc(), thumb: null });
    const back = unpackProject(bytes);
    expect(back.thumb).toBeNull();
    expect(back.manifest.thumb).toBeNull();
  });

  it('supports a png thumbnail', () => {
    const bytes = packProject({ manifest: manifest({ thumb: 'thumb.png' }), original: PNG, doc: emptyDoc(), thumb: PNG });
    expect(unpackProject(bytes).manifest.thumb).toBe('thumb.png');
  });

  it('peeks manifest and thumb without the original', () => {
    const bytes = packProject({ manifest: manifest(), original: PNG, doc: emptyDoc(), thumb: new Uint8Array([7]) });
    const peek = peekProject(bytes);
    expect(peek.manifest.image.widthPx).toBe(3840);
    expect(Array.from(peek.thumb!)).toEqual([7]);
  });

  it('rejects non-zip bytes and missing entries', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow(FormatError);
    const noPng = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest())),
      'annotations.json': strToU8(JSON.stringify(emptyDoc())),
    });
    expect(() => unpackProject(noPng)).toThrow(/original\.png/);
  });
});

describe('migrate', () => {
  it('passes current files through and fills a missing crop', () => {
    const { doc } = migrate(manifest(), { version: 1, annotations: [] });
    expect(doc.crop).toBeNull();
  });

  it('refuses files from a newer version', () => {
    expect(() => migrate(manifest({ version: FORMAT_VERSION + 1 }), emptyDoc())).toThrow(/newer Magpie/);
  });

  it('refuses foreign manifests', () => {
    expect(() => migrate({ format: 'snagit' }, emptyDoc())).toThrow(FormatError);
  });

  it('chains registered migrations', () => {
    const migrations = {
      1: (raw: { manifest: Record<string, unknown>; doc: Record<string, unknown> }) => ({
        manifest: raw.manifest,
        doc: { ...raw.doc, annotations: [...(raw.doc.annotations as unknown[]), arrow] },
      }),
    };
    const { manifest: m, doc } = migrate(manifest(), emptyDoc(), migrations, 2);
    expect(m.version).toBe(2);
    expect(doc.version).toBe(2);
    expect(doc.annotations).toHaveLength(1);
  });

  it('errors when a migration step is missing', () => {
    expect(() => migrate(manifest(), emptyDoc(), {}, 2)).toThrow(/No migration from format v1/);
  });
});

describe('steps', () => {
  it('renumbers in document order', () => {
    const out = renumberSteps([step('a', 1), arrow, step('c', 3), step('d', 4)]);
    expect(out.filter((a) => a.type === 'step').map((a) => (a.type === 'step' ? a.data.number : 0))).toEqual([1, 2, 3]);
  });

  it('returns the same array when already sequential', () => {
    const list = [step('a', 1), step('b', 2)];
    expect(renumberSteps(list)).toBe(list);
  });

  it('computes the next number', () => {
    expect(nextStepNumber([step('a', 1), arrow])).toBe(2);
  });
});

describe('library helpers', () => {
  it('peek returns the doc too', () => {
    const doc = { ...emptyDoc(), annotations: [arrow] };
    const peek = peekProject(packProject({ manifest: manifest({ tags: ['bug'] }), original: PNG, doc, thumb: null }));
    expect(peek.doc.annotations).toHaveLength(1);
    expect(peek.manifest.tags).toEqual(['bug']);
  });

  it('extracts text annotations', () => {
    const text: Annotation = { id: 't', type: 'text', x: 0, y: 0, rotation: 0, style: { stroke: '#000', strokeWidth: 0 }, data: { text: '  Login button  ', width: 100 } };
    expect(annotationText({ ...emptyDoc(), annotations: [arrow, text] })).toBe('Login button');
  });

  it('normalizes tags', () => {
    expect(normalizeTags([' Bug ', 'bug', 'UI  review', '', 'ui review'])).toEqual(['Bug', 'UI review']);
  });
});

describe('assets', () => {
  it('round-trips embedded images and drops orphans via usedAssets', () => {
    const img: Annotation = { id: 'i', type: 'image', x: 1, y: 2, rotation: 0, style: { stroke: '#000', strokeWidth: 0 }, data: { asset: 'logo_1', width: 10, height: 10 } };
    const doc = { ...emptyDoc(), annotations: [img] };
    const assets = usedAssets(doc, { logo_1: PNG, orphan: PNG });
    expect(Object.keys(assets)).toEqual(['logo_1']);
    const back = unpackProject(packProject({ manifest: manifest(), original: PNG, doc, thumb: null, assets }));
    expect(Object.keys(back.assets ?? {})).toEqual(['logo_1']);
    expect(back.doc.annotations[0]!.type).toBe('image');
  });

  it('rejects unsafe asset ids', () => {
    expect(() => packProject({ manifest: manifest(), original: PNG, doc: emptyDoc(), thumb: null, assets: { '../x': PNG } })).toThrow(/Invalid asset id/);
  });
});
