import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItem, LibraryOverview, LibraryQuery } from '../../shared/ipc';
import { api } from '../shared/api';
import { groupByDay } from './group';

const PAGE = 200;

export function Library() {
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [untagged, setUntagged] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [limit, setLimit] = useState(PAGE);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 180);
    return () => clearTimeout(t);
  }, [text]);

  const query: LibraryQuery = useMemo(() => ({ text: debounced, tags, untagged, sort, limit }), [debounced, tags, untagged, sort, limit]);

  const reload = useCallback(async () => {
    const [res, ov] = await Promise.all([api.libraryQuery(query), api.libraryOverview()]);
    setItems(res.items);
    setTotal(res.total);
    setOverview(ov);
    setLoaded(true);
    // Drop selections that no longer exist.
    setSelected((sel) => {
      const ids = new Set(res.items.map((i) => i.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => api.onLibraryChanged(() => void reload()), [reload]);
  useEffect(() => setLimit(PAGE), [debounced, tags, untagged, sort]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && items.length < total) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, total]);

  const flash = (msg: string) => {
    setError(msg);
    window.setTimeout(() => setError((e) => (e === msg ? null : e)), 5000);
  };
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      flash((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  // ---- selection ------------------------------------------------------------
  const indexOf = (id: number) => items.findIndex((i) => i.id === id);
  const onCardClick = (e: React.MouseEvent, item: LibraryItem) => {
    const idx = indexOf(item.id);
    if (e.shiftKey && anchor.current !== null) {
      const a = indexOf(anchor.current);
      const [lo, hi] = a < idx ? [a, idx] : [idx, a];
      const range = items.slice(lo, hi + 1).map((i) => i.id);
      setSelected(new Set(e.ctrlKey || e.metaKey ? [...selected, ...range] : range));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      setSelected(next);
    } else setSelected(new Set([item.id]));
    anchor.current = item.id;
  };

  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedIds = selectedItems.map((i) => i.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.id)));
      } else if (e.key === 'Escape') setSelected(new Set());
      else if (e.key === 'Enter' && selectedIds.length) api.libraryOpen(selectedIds);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) void run(api.libraryTrash(selectedIds));
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!items.length) return;
        const cur = anchor.current !== null ? indexOf(anchor.current) : -1;
        const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
        const id = items[next]!.id;
        anchor.current = id;
        setSelected(new Set([id]));
        document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIds.join(',')]);

  const toggleTag = (name: string) => {
    setUntagged(false);
    setTags((t) => (t.includes(name) ? t.filter((x) => x !== name) : [...t, name]));
  };

  const groups = useMemo(() => groupByDay(items, sort), [items, sort]);
  const filtered = !!(debounced || tags.length || untagged);

  return (
    <div className="library">
      <header className="lib-toolbar">
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Search titles, text in annotations, tags…  (Ctrl+F)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <span className="muted count">
          {filtered ? `${total} of ${overview?.all ?? 0}` : `${total} captures`}
          {overview?.scanning ? ' · indexing…' : ''}
        </span>
        <button onClick={() => void run(api.libraryRescan())} title="Re-read the captures folder">
          Rescan
        </button>
      </header>

      <nav className="lib-side" aria-label="Filters">
        <button className={`side-item ${!tags.length && !untagged ? 'active' : ''}`} onClick={() => (setTags([]), setUntagged(false))}>
          <span>All captures</span>
          <span className="n">{overview?.all ?? 0}</span>
        </button>
        <button className={`side-item ${untagged ? 'active' : ''}`} onClick={() => (setTags([]), setUntagged(!untagged))}>
          <span>Untagged</span>
          <span className="n">{overview?.untagged ?? 0}</span>
        </button>
        <h4>Tags</h4>
        {overview?.tags.length ? (
          overview.tags.map((t) => (
            <button key={t.name} className={`side-item tag ${tags.includes(t.name) ? 'active' : ''}`} onClick={() => toggleTag(t.name)}>
              <span># {t.name}</span>
              <span className="n">{t.count}</span>
            </button>
          ))
        ) : (
          <p className="muted small">No tags yet. Select a capture and add one in the panel on the right.</p>
        )}
        <p className="muted small root" title={overview?.root}>
          {overview?.root}
        </p>
      </nav>

      <main className="lib-grid-wrap" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
        {loaded && items.length === 0 && (
          <div className="empty">
            {filtered ? (
              <>
                <h3>Nothing matches</h3>
                <p className="muted">Try fewer words, or clear the tag filter.</p>
              </>
            ) : (
              <>
                <h3>No captures yet</h3>
                <p className="muted">Take one from the tray or with your capture hotkey. Every capture lands here automatically.</p>
              </>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="day">{g.label}</h3>
            <div className="grid">
              {g.items.map((item) => (
                <button
                  key={item.id}
                  data-id={item.id}
                  className={`card ${selected.has(item.id) ? 'selected' : ''}`}
                  onClick={(e) => onCardClick(e, item)}
                  onDoubleClick={() => api.libraryOpen([item.id])}
                  title={item.path}
                >
                  <div className="thumb">
                    {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" draggable={false} /> : <span className="muted">no preview</span>}
                    {item.kind === 'video' && (
                      <span className="badge">
                        ▶ {fmtDuration(item.duration)} · {item.path.split('.').pop()?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="card-title">{item.title}</div>
                  <div className="card-meta muted">
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {item.width}×{item.height}
                  </div>
                  {item.tags.length > 0 && (
                    <div className="chips">
                      {item.tags.slice(0, 3).map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                      {item.tags.length > 3 && <span className="chip more">+{item.tags.length - 3}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
        <div ref={sentinel} className="sentinel" />
      </main>

      <aside className="lib-details">
        {selectedItems.length === 0 && <p className="muted">Select a capture to rename it, tag it, or open it. Ctrl/Shift-click selects several.</p>}
        {selectedItems.length === 1 && <Details item={selectedItems[0]!} allTags={overview?.tags.map((t) => t.name) ?? []} run={run} />}
        {selectedItems.length > 1 && <MultiDetails items={selectedItems} allTags={overview?.tags.map((t) => t.name) ?? []} run={run} />}
      </aside>

      {error && (
        <div className="lib-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

type Run = (p: Promise<unknown>) => Promise<void>;

function fmtDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '–:––';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Details({ item, allTags, run }: { item: LibraryItem; allTags: string[]; run: Run }) {
  const [title, setTitle] = useState(item.customTitle ? item.title : '');
  const [ocrText, setOcrText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.libraryOcrText(item.id).then((t) => alive && setOcrText(t));
    return () => {
      alive = false;
    };
  }, [item.id, item.modifiedAt]);
  useEffect(() => setTitle(item.customTitle ? item.title : ''), [item.id, item.title, item.customTitle]);
  const commitTitle = () => {
    const current = item.customTitle ? item.title : '';
    if (title.trim() !== current) void run(api.librarySetTitle(item.id, title));
  };

  return (
    <div className="details">
      <div className="big-thumb">{item.thumbUrl && <img src={item.thumbUrl} alt="" />}</div>
      <label className="field-label" htmlFor="title">
        Title
      </label>
      <input
        id="title"
        value={title}
        placeholder={item.customTitle ? '' : item.title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setTitle(item.customTitle ? item.title : '');
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="field-label">Tags</span>
      <TagEditor tags={item.tags} allTags={allTags} onAdd={(t) => run(api.libraryAddTag([item.id], t))} onRemove={(t) => run(api.libraryRemoveTag([item.id], t))} />
      <dl className="info">
        <dt>Size</dt>
        <dd>
          {item.width} × {item.height} px
        </dd>
        <dt>Captured</dt>
        <dd>{new Date(item.createdAt).toLocaleString()}</dd>
        <dt>Edited</dt>
        <dd>{new Date(item.modifiedAt).toLocaleString()}</dd>
        {item.kind === 'video' ? (
          <>
            <dt>Duration</dt>
            <dd>{fmtDuration(item.duration)}</dd>
          </>
        ) : (
          <>
            <dt>Annotations</dt>
            <dd>{item.annotationCount}</dd>
          </>
        )}
        <dt>File</dt>
        <dd className="path" title={item.path}>
          {item.path}
        </dd>
      </dl>
      {item.kind === 'image' && (
      <details className="ocr" open={!!ocrText}>
        <summary>Text found {ocrText === null ? '(reading…)' : ocrText ? '' : '(none)'}</summary>
        {ocrText ? (
          <>
            <pre>{ocrText.length > 1200 ? `${ocrText.slice(0, 1200)}…` : ocrText}</pre>
            <button className="small" onClick={() => void api.copyText(ocrText)}>
              Copy text
            </button>
          </>
        ) : null}
      </details>
      )}
      <div className="actions">
        <button className="primary" onClick={() => api.libraryOpen([item.id])}>
          {item.kind === 'video' ? 'Open' : 'Open in editor'}
        </button>
        <button onClick={() => api.libraryReveal(item.id)}>Show in folder</button>
        <button className="danger" onClick={() => void run(api.libraryTrash([item.id]))}>
          Move to Trash
        </button>
      </div>
    </div>
  );
}

function MultiDetails({ items, allTags, run }: { items: LibraryItem[]; allTags: string[]; run: Run }) {
  const ids = items.map((i) => i.id);
  const union = [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));
  return (
    <div className="details">
      <h3>{items.length} captures selected</h3>
      <span className="field-label">Tags on any of them</span>
      <TagEditor tags={union} allTags={allTags} onAdd={(t) => run(api.libraryAddTag(ids, t))} onRemove={(t) => run(api.libraryRemoveTag(ids, t))} addLabel="Add tag to all" />
      <div className="actions">
        <button className="primary" disabled={items.length > 12} title={items.length > 12 ? 'Opens at most 12 at once' : ''} onClick={() => api.libraryOpen(ids)}>
          Open {items.length} in editor
        </button>
        <button className="danger" onClick={() => void run(api.libraryTrash(ids))}>
          Move {items.length} to Trash
        </button>
      </div>
    </div>
  );
}

function TagEditor({
  tags,
  allTags,
  onAdd,
  onRemove,
  addLabel = 'Add tag',
}: {
  tags: string[];
  allTags: string[];
  onAdd: (t: string) => Promise<void>;
  onRemove: (t: string) => Promise<void>;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = useMemo(() => `tags-${Math.random().toString(36).slice(2)}`, []);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    void onAdd(t);
  };
  return (
    <div className="tag-editor">
      <div className="chips">
        {tags.map((t) => (
          <span key={t} className="chip removable">
            {t}
            <button aria-label={`Remove tag ${t}`} onClick={() => void onRemove(t)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        list={listId}
        value={draft}
        placeholder={`${addLabel}…`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <datalist id={listId}>
        {allTags
          .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  );
}
