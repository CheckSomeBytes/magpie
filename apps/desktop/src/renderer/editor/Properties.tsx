/**
 * Properties for the selected annotation, or for the current tool when
 * nothing is selected. Changing a selected shape also updates that tool's
 * remembered style (last-used per tool, §7).
 */
import { useEffect, useMemo } from 'react';
import { BUILTIN_STAMPS, type AnnotationType, type BuiltinStamp, type Style } from '@magpie/format';
import { api } from '../shared/api';
import { useAsk } from './Dialogs';
import { deleteStylePreset, saveStylePreset, useStylePresets } from './presets';
import { useEditor } from './store';
import { PALETTE, STAMP_ART, TOOLS } from './tools';

const WIDTHS: Partial<Record<AnnotationType, [number, number]>> = {
  arrow: [2, 24],
  line: [1, 24],
  rect: [1, 20],
  ellipse: [1, 20],
  highlighter: [6, 60],
};

export function Properties() {
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.annotations.find((a) => a.id === s.selectedId) ?? null);
  const styles = useEditor((s) => s.styles);
  const blur = useEditor((s) => s.blur);
  const crop = useEditor((s) => s.crop);
  const ed = useEditor.getState;
  const ask = useAsk();

  if (tool === 'crop') {
    return (
      <aside className="props">
        <h3>Crop</h3>
        <p className="muted">Drag on the image to draw a crop, or drag the handles. Press Enter or pick another tool when done.</p>
        <div className="row">
          <button className="primary" onClick={() => ed().setTool('select')}>
            Done
          </button>
          <button disabled={!crop} onClick={() => ed().setCrop(null)}>
            Reset
          </button>
        </div>
        {crop && (
          <p className="muted">
            {Math.round(crop.width)} × {Math.round(crop.height)} at {Math.round(crop.x)}, {Math.round(crop.y)}
          </p>
        )}
      </aside>
    );
  }

  if (tool === 'ocr' && !selected) {
    return (
      <aside className="props">
        <h3>Grab text</h3>
        <p className="muted">Drag around text to read it, or click once to read the whole image. The text is copied to the clipboard. Reading runs offline on this computer.</p>
        <p className="muted">It reads the original capture, not your annotations.</p>
      </aside>
    );
  }

  const type: AnnotationType | null = selected?.type ?? (tool === 'select' || tool === 'ocr' ? null : tool);
  if (!type) {
    return (
      <aside className="props">
        <h3>Select</h3>
        <p className="muted">Click a shape to select it. Drag to move, Delete to remove, arrow keys to nudge (Shift = 10 px). Double-click text to edit.</p>
        <Shortcuts />
      </aside>
    );
  }

  const style: Style = selected ? selected.style : styles[type];
  const setStyle = (patch: Partial<Style>) => {
    ed().setToolStyle(type, patch);
    if (selected) ed().update(selected.id, (a) => ({ ...a, style: { ...a.style, ...patch } }));
  };
  const title = type === 'image' ? 'Image' : TOOLS.find((t) => t.id === type)?.label ?? type;
  const applyBlur = (patch: { mode: 'blur' | 'pixelate'; amount: number }) => {
    ed().setBlurPrefs(patch);
    if (selected?.type === 'blur') ed().update(selected.id, (a) => (a.type === 'blur' ? { ...a, data: { ...a.data, ...patch } } : a));
  };

  return (
    <aside className="props">
      <h3>
        {title}
        {selected ? ' (selected)' : ''}
      </h3>

      {(type === 'stamp' || (type === 'image' && !selected)) && <StampPicker selectedStampId={selected?.type === 'stamp' ? selected.id : null} />}

      {type === 'image' && selected?.type === 'image' && (
        <section>
          <p className="muted">Pasted or stamped image. Drag the corners to resize.</p>
          <button
            onClick={async () => {
              const png = ed().assets[selected.data.asset];
              if (!png) return;
              const name = await ask('Save as stamp', { label: 'Stamp name', initial: 'My stamp' });
              if (!name) return;
              const s = await api.saveStamp(name, png);
              ed().setCustomStamps([...ed().customStamps, s]);
            }}
          >
            Save as stamp
          </button>
        </section>
      )}

      {type !== 'blur' && type !== 'stamp' && type !== 'image' && (
        <section>
          <label>{type === 'step' ? 'Number color' : 'Color'}</label>
          <Swatches value={style.stroke} onChange={(stroke) => stroke && setStyle({ stroke })} />
        </section>
      )}

      {(type === 'rect' || type === 'ellipse' || type === 'step') && (
        <section>
          <label>{type === 'step' ? 'Badge color' : 'Fill'}</label>
          <Swatches value={style.fill ?? null} allowNone={type !== 'step'} onChange={(fill) => setStyle({ fill: fill ?? undefined })} />
        </section>
      )}

      {WIDTHS[type] && (
        <section>
          <label>
            Width <span className="muted">{style.strokeWidth}px</span>
          </label>
          <input
            type="range"
            min={WIDTHS[type]![0]}
            max={WIDTHS[type]![1]}
            value={style.strokeWidth}
            onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })}
          />
        </section>
      )}

      {type === 'highlighter' && (
        <section>
          <label>
            Opacity <span className="muted">{Math.round((style.opacity ?? 0.45) * 100)}%</span>
          </label>
          <input type="range" min={15} max={80} value={Math.round((style.opacity ?? 0.45) * 100)} onChange={(e) => setStyle({ opacity: Number(e.target.value) / 100 })} />
        </section>
      )}

      {type === 'text' && (
        <section>
          <label>
            Size <span className="muted">{style.fontSize ?? 28}px</span>
          </label>
          <input type="range" min={10} max={120} value={style.fontSize ?? 28} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} />
          <p className="muted">Click to place text, type, then Esc or click away. Ctrl+Enter also finishes.</p>
        </section>
      )}

      {type === 'step' && (
        <section>
          <label>
            Size <span className="muted">{selected?.type === 'step' ? Math.round(selected.data.radius) : style.fontSize ?? 18}px</span>
          </label>
          <input
            type="range"
            min={10}
            max={60}
            value={selected?.type === 'step' ? Math.round(selected.data.radius) : style.fontSize ?? 18}
            onChange={(e) => {
              const r = Number(e.target.value);
              ed().setToolStyle('step', { fontSize: r });
              if (selected?.type === 'step') ed().update(selected.id, (a) => (a.type === 'step' ? { ...a, data: { ...a.data, radius: r } } : a));
            }}
          />
          <p className="muted">Click to drop the next number. Steps renumber when one is deleted.</p>
        </section>
      )}

      {type === 'blur' && (
        <BlurControls
          mode={selected?.type === 'blur' ? selected.data.mode : blur.mode}
          amount={selected?.type === 'blur' ? selected.data.amount : blur.amount}
          onChange={(patch) => {
            ed().setBlurPrefs(patch);
            if (selected?.type === 'blur') ed().update(selected.id, (a) => (a.type === 'blur' ? { ...a, data: { ...a.data, ...patch } } : a));
          }}
        />
      )}

      {type !== 'image' && <StylePresets type={type} style={style} onApply={(p) => (p.blur ? applyBlur(p.blur) : setStyle(p.style))} />}

      {selected && (
        <section className="row">
          <button onClick={() => ed().reorder(selected.id, 'front')}>Bring to front</button>
          <button onClick={() => ed().reorder(selected.id, 'back')}>Send to back</button>
          <button className="danger" onClick={() => ed().remove(selected.id)}>
            Delete
          </button>
        </section>
      )}
    </aside>
  );
}

function Swatches({ value, onChange, allowNone }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none ${value ? '' : 'active'}`} title="None" onClick={() => onChange(null)}>
          ⌀
        </button>
      )}
      {PALETTE.map((c) => (
        <button
          key={c}
          className={`swatch ${value?.toLowerCase() === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          onClick={() => onChange(c)}
        />
      ))}
      <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} title="Custom color" />
    </div>
  );
}

function BlurControls({ mode, amount, onChange }: { mode: 'blur' | 'pixelate'; amount: number; onChange: (p: { mode?: 'blur' | 'pixelate'; amount?: number }) => void }) {
  return (
    <>
      <section className="row">
        <button className={mode === 'pixelate' ? 'primary' : ''} onClick={() => onChange({ mode: 'pixelate' })}>
          Pixelate
        </button>
        <button className={mode === 'blur' ? 'primary' : ''} onClick={() => onChange({ mode: 'blur' })}>
          Blur
        </button>
      </section>
      <section>
        <label>
          Strength <span className="muted">{amount}</span>
        </label>
        <input type="range" min={4} max={40} value={amount} onChange={(e) => onChange({ amount: Number(e.target.value) })} />
      </section>
    </>
  );
}

function Shortcuts() {
  return (
    <div className="shortcuts">
      {TOOLS.map((t) => (
        <div key={t.id}>
          <kbd>{t.key}</kbd> {t.label}
        </div>
      ))}
      <div>
        <kbd>Ctrl+C</kbd> Copy image
      </div>
      <div>
        <kbd>Ctrl+Enter</kbd> Copy &amp; close
      </div>
      <div>
        <kbd>Ctrl+S</kbd> Save
      </div>
      <div>
        <kbd>Ctrl+Shift+S</kbd> Export PNG
      </div>
      <div>
        <kbd>Ctrl+0</kbd> Fit · <kbd>Ctrl+1</kbd> 100%
      </div>
    </div>
  );
}

export function StampIcon({ name, size = 28 }: { name: BuiltinStamp; size?: number }) {
  const art = STAMP_ART[name];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="11" fill={art.color} />
      <path d={art.path} transform="translate(2.16 2.16) scale(0.82)" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill={art.filled ? '#fff' : 'none'} />
    </svg>
  );
}

function StampPicker({ selectedStampId }: { selectedStampId: string | null }) {
  const stamp = useEditor((s) => s.stamp);
  const custom = useEditor((s) => s.customStamps);
  const size = useEditor((s) => s.styles.stamp.fontSize ?? 48);
  const ed = useEditor.getState;
  const urls = useMemo(() => Object.fromEntries(custom.map((c) => [c.id, URL.createObjectURL(new Blob([c.png as BlobPart], { type: 'image/png' }))])), [custom]);
  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), [urls]);

  const pickBuiltin = (name: BuiltinStamp) => {
    ed().setStamp({ kind: 'builtin', name });
    if (selectedStampId) ed().update(selectedStampId, (a) => (a.type === 'stamp' ? { ...a, data: { ...a.data, stamp: name } } : a));
  };

  return (
    <>
      <section>
        <label>Stamp</label>
        <div className="stamp-grid">
          {BUILTIN_STAMPS.map((n) => (
            <button key={n} className={`stamp-btn ${stamp.kind === 'builtin' && stamp.name === n ? 'active' : ''}`} title={STAMP_ART[n].label} aria-label={STAMP_ART[n].label} onClick={() => pickBuiltin(n)}>
              <StampIcon name={n} />
            </button>
          ))}
          {custom.map((c) => (
            <span key={c.id} className="stamp-custom">
              <button className={`stamp-btn ${stamp.kind === 'custom' && stamp.id === c.id ? 'active' : ''}`} title={c.name} aria-label={c.name} onClick={() => ed().setStamp({ kind: 'custom', id: c.id })}>
                <img src={urls[c.id]} alt="" />
              </button>
              <button
                className="stamp-del"
                title={`Delete ${c.name}`}
                aria-label={`Delete stamp ${c.name}`}
                onClick={async () => {
                  await api.deleteStamp(c.id);
                  ed().setCustomStamps(ed().customStamps.filter((x) => x.id !== c.id));
                  if (stamp.kind === 'custom' && stamp.id === c.id) ed().setStamp({ kind: 'builtin', name: 'check' });
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <button
          className="small-btn"
          onClick={async () => {
            const s = await api.importStamp();
            if (!s) return;
            ed().setCustomStamps([...ed().customStamps, s]);
            ed().setStamp({ kind: 'custom', id: s.id });
          }}
        >
          Add image as stamp…
        </button>
      </section>
      <section>
        <label>
          Size <span className="muted">{size}px</span>
        </label>
        <input
          type="range"
          min={16}
          max={160}
          value={size}
          onChange={(e) => {
            const v = Number(e.target.value);
            ed().setToolStyle('stamp', { fontSize: v });
            if (selectedStampId) ed().update(selectedStampId, (a) => (a.type === 'stamp' ? { ...a, data: { ...a.data, size: v } } : a));
          }}
        />
        <p className="muted">Click the image to place a stamp. Paste (Ctrl+V) to drop in any image.</p>
      </section>
    </>
  );
}

function StylePresets({ type, style, onApply }: { type: AnnotationType; style: Style; onApply: (p: { style: Style; blur?: { mode: 'blur' | 'pixelate'; amount: number } }) => void }) {
  const all = useStylePresets();
  const blur = useEditor((s) => s.blur);
  const ask = useAsk();
  const mine = all.filter((p) => p.type === type);
  return (
    <section>
      <label>Presets</label>
      <div className="preset-chips">
        {mine.map((p) => (
          <span key={p.id} className="preset-chip">
            <button onClick={() => onApply(p)} title={`Apply "${p.name}"`}>
              {p.style.stroke && type !== 'blur' && type !== 'stamp' && <i style={{ background: p.style.fill ?? p.style.stroke }} />}
              {p.name}
            </button>
            <button className="preset-del" aria-label={`Delete preset ${p.name}`} onClick={() => deleteStylePreset(p.id)}>
              ×
            </button>
          </span>
        ))}
        <button
          className="small-btn"
          onClick={async () => {
            const name = await ask('Save style preset', { label: 'Preset name', initial: '' });
            if (name) saveStylePreset({ name, type, style: { ...style }, ...(type === 'blur' ? { blur: { ...blur } } : {}) });
          }}
        >
          + Save current
        </button>
      </div>
    </section>
  );
}
