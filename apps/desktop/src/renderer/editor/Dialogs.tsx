/** Small in-page dialogs (Electron has no window.prompt). */
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export interface PromptRequest {
  title: string;
  label?: string;
  initial?: string;
  confirm?: string;
  resolve: (value: string | null) => void;
}

export function PromptDialog({ req, onDone }: { req: PromptRequest; onDone: () => void }) {
  const [value, setValue] = useState(req.initial ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const finish = (v: string | null) => {
    req.resolve(v);
    onDone();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <form
        className="modal"
        role="dialog"
        aria-label={req.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) finish(value.trim());
        }}
      >
        <h3>{req.title}</h3>
        {req.label && <label htmlFor="prompt-input">{req.label}</label>}
        <input
          id="prompt-input"
          ref={input}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') finish(null);
          }}
        />
        <div className="modal-actions">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            {req.confirm ?? 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TextResultDialog({ text, busy, error, onCopy, onClose }: { text: string; busy: boolean; error: string | null; onCopy: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Text found">
        <h3>{busy ? 'Reading text…' : error ? 'Could not read text' : text ? 'Text found (copied to clipboard)' : 'No text found'}</h3>
        {error && <p className="error">{error}</p>}
        {!busy && !error && <textarea className="ocr-text" readOnly value={text} rows={10} onKeyDown={(e) => e.stopPropagation()} />}
        {busy && <div className="spinner" aria-hidden />}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={busy || !text} onClick={onCopy}>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}


export type Ask = (title: string, opts?: { label?: string; initial?: string; confirm?: string }) => Promise<string | null>;
export const PromptContext = createContext<Ask>(async () => null);
export const useAsk = (): Ask => useContext(PromptContext);
