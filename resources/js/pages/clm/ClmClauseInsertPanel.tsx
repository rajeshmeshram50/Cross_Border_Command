import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * Shared Clause Library insert popup.
 *
 * A centered modal (same family as ClmInsertTableModal) used by the CLM
 * rich-text wizards (Agreement, T&C, …) to drop reusable clauses into the
 * editor. Backed by the CLM masters:
 *   GET /clm/clause-types    → { id, code, name }
 *   GET /clm/clause-library  → { id, code, clause_type, name, content }
 *
 * Flow: pick a clause TYPE from the master-style dropdown → its clauses
 * appear → tick one or more → "Insert" builds combined HTML (each clause =
 * name heading + its content body) and hands it back via onInsert.
 *
 * The clause-type dropdown is a SELF-CONTAINED inline dropdown (not the
 * body-portalled MasterSelect) — that keeps its menu inside the modal so it
 * never gets buried behind the modal overlay's stacking context.
 * ───────────────────────────────────────────────────────────────────────── */

type ClauseTypeRow = { id: number; code: string; name: string };
type ClauseRow     = { id: number; code: string; clause_type: string; name: string; content: string | null; clause_status?: string };

function escapeHtml(s: string) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function clauseSnippet(html: string | null): string {
  if (!html) return '';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 110 ? text.slice(0, 110) + '…' : text;
}

interface Props {
  onClose: () => void;
  /** Receives the combined HTML for every ticked clause, in library order. */
  onInsert: (html: string) => void;
}

export default function ClmClauseInsertPanel({ onClose, onInsert }: Props) {
  const [types, setTypes]       = useState<ClauseTypeRow[]>([]);
  const [clauses, setClauses]   = useState<ClauseRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [typeName, setTypeName] = useState('');                 // selected clause type name
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Inline clause-type dropdown state.
  const [ddOpen, setDdOpen]     = useState(false);
  const [ddSearch, setDdSearch] = useState('');
  const ddRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/clm/clause-types').then(r => (Array.isArray(r.data?.data) ? r.data.data : []) as ClauseTypeRow[]).catch(() => [] as ClauseTypeRow[]),
      api.get('/clm/clause-library').then(r => (Array.isArray(r.data?.data) ? r.data.data : []) as ClauseRow[]).catch(() => [] as ClauseRow[]),
    ]).then(([t, c]) => {
      if (cancelled) return;
      setTypes(t);
      setClauses(c);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Esc closes the picker (not the host wizard — the wizards' own Esc
  // handlers no-op while the clause panel is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (ddOpen) { setDdOpen(false); } else { onClose(); } }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, ddOpen]);

  // Close the inline dropdown on outside click.
  useEffect(() => {
    if (!ddOpen) return;
    const onDown = (e: MouseEvent) => { if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [ddOpen]);

  // Clauses belonging to the chosen type (matched by the type's name, which
  // is what clause_library rows store in their clause_type column).
  const visible = typeName ? clauses.filter(c => c.clause_type === typeName) : [];
  const filteredTypes = ddSearch.trim()
    ? types.filter(t => t.name.toLowerCase().includes(ddSearch.trim().toLowerCase()))
    : types;

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const insert = () => {
    if (selected.size === 0) return;
    // Preserve library order; each clause = name heading + its body.
    const chosen = clauses.filter(c => selected.has(c.id));
    const html = chosen.map(c => {
      const body = (c.content && c.content.trim()) ? c.content : '<p></p>';
      return `<h3>${escapeHtml(c.name)}</h3>${body}`;
    }).join('');
    onInsert(html);
  };

  return createPortal(
    <div
      className="clp-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Clause Library"
    >
      <style>{CLP_CSS}</style>
      <div className="clp-shell" onMouseDown={e => e.stopPropagation()}>
        <div className="clp-head">
          <div className="clp-head-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </div>
          <div className="clp-head-text">
            <div className="clp-head-title">Clause Library</div>
            <div className="clp-head-sub">Pick a clause type, then select clauses to insert.</div>
          </div>
          <button type="button" className="clp-head-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="clp-body">
          <div className="clp-field">
            <span className="clp-lbl">Clause Type</span>
            <div className="clp-dd" ref={ddRef}>
              <button
                type="button"
                className={`clp-dd-toggle ${ddOpen ? 'is-open' : ''}`}
                onClick={() => setDdOpen(o => !o)}
                disabled={loading}
              >
                {loading ? (
                  <span className="clp-dd-ph">Loading…</span>
                ) : typeName ? (
                  <span className="clp-dd-val">{typeName}</span>
                ) : (
                  <span className="clp-dd-ph">— Select clause type —</span>
                )}
                <i className="ri-arrow-down-s-line clp-dd-chev" />
              </button>
              {ddOpen && !loading && (
                <div className="clp-dd-menu">
                  <div className="clp-dd-search" onMouseDown={e => e.stopPropagation()}>
                    <i className="ri-search-line clp-dd-search-ico" />
                    <input
                      type="text"
                      value={ddSearch}
                      onChange={e => setDdSearch(e.target.value)}
                      placeholder="Search…"
                      autoFocus
                    />
                  </div>
                  <div className="clp-dd-list">
                    {filteredTypes.length === 0 ? (
                      <div className="clp-dd-empty">{types.length === 0 ? 'No clause types' : 'No results'}</div>
                    ) : filteredTypes.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className={`clp-dd-item ${t.name === typeName ? 'is-active' : ''}`}
                        onClick={() => { setTypeName(t.name); setDdOpen(false); setDdSearch(''); }}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="clp-list-label">Clauses {visible.length > 0 ? `(${visible.length})` : ''}</div>
          <div className="clp-list">
            {loading ? (
              <div className="clp-empty">Loading clauses…</div>
            ) : !typeName ? (
              <div className="clp-empty">Pick a clause type above to see its clauses.</div>
            ) : visible.length === 0 ? (
              <div className="clp-empty">No clauses found for “{typeName}”.</div>
            ) : (
              visible.map(c => {
                const on = selected.has(c.id);
                return (
                  <label key={c.id} className={`clp-item ${on ? 'is-on' : ''}`}>
                    <input type="checkbox" className="clp-check" checked={on} onChange={() => toggle(c.id)} />
                    <span className="clp-item-text">
                      <span className="clp-item-title">{c.name}</span>
                      <span className="clp-item-sub">{clauseSnippet(c.content) || c.code}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="clp-foot">
          <span className="clp-selcount">{selected.size} selected</span>
          <div className="clp-foot-btns">
            <button type="button" className="clp-btn clp-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="clp-btn clp-btn-primary" disabled={selected.size === 0} onClick={insert}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Insert {selected.size > 0 ? selected.size + ' ' : ''}clause{selected.size === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CLP_CSS = `
.clp-overlay {
  position: fixed; inset: 0; z-index: 280000;
  background: rgba(7,30,50,.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  animation: clpFade .16s ease both;
}
@keyframes clpFade { from { opacity: 0 } to { opacity: 1 } }
.clp-shell {
  width: 100%; max-width: 560px; max-height: calc(100vh - 36px);
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 28px 64px rgba(15,23,42,.45), 0 0 0 1px rgba(6,182,212,.18);
  animation: clpSlide .22s cubic-bezier(.22,1,.36,1) both;
}
@keyframes clpSlide { from { opacity: 0; transform: translateY(14px) scale(.98) } to { opacity: 1; transform: none } }

.clp-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; background: linear-gradient(110deg, #0c6680 0%, #0e7490 40%, #0891b2 100%); color: #fff; flex-shrink: 0; }
.clp-head-ico { width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.26); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.clp-head-text { flex: 1; min-width: 0; }
.clp-head-title { font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
.clp-head-sub { font-size: 12px; opacity: .88; margin-top: 2px; }
.clp-head-close { width: 28px; height: 28px; border-radius: 8px; border: 0; background: rgba(255,255,255,.16); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; }
.clp-head-close:hover { background: rgba(255,255,255,.30); }

/* Body intentionally NOT scrollable so the inline dropdown menu isn't
 * clipped — the clause LIST has its own internal scroll instead. */
.clp-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; overflow: visible; }
.clp-field { display: flex; flex-direction: column; gap: 5px; }
.clp-lbl { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #0e7490; }

/* Inline master-style dropdown */
.clp-dd { position: relative; }
.clp-dd-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border-radius: 9px; border: 1.5px solid rgba(6,182,212,.30); background: #fff; color: #0c4a6e; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; transition: border-color .15s ease, box-shadow .15s ease; }
.clp-dd-toggle:hover { border-color: #0891b2; }
.clp-dd-toggle.is-open { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
.clp-dd-toggle:disabled { opacity: .6; cursor: wait; }
.clp-dd-val { color: #0c4a6e; }
.clp-dd-ph { color: #94a3b8; }
.clp-dd-chev { font-size: 18px; color: #0891b2; flex-shrink: 0; transition: transform .15s ease; }
.clp-dd-toggle.is-open .clp-dd-chev { transform: rotate(180deg); }
.clp-dd-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; background: #fff; border: 1px solid rgba(6,182,212,.25); border-radius: 10px; box-shadow: 0 16px 34px rgba(15,23,42,.18); overflow: hidden; }
.clp-dd-search { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(6,182,212,.14); }
.clp-dd-search-ico { color: #94a3b8; font-size: 14px; }
.clp-dd-search input { flex: 1; border: none; outline: none; font-size: 13px; color: #0c4a6e; background: transparent; }
.clp-dd-list { max-height: 200px; overflow-y: auto; padding: 4px; }
.clp-dd-empty { padding: 14px 12px; text-align: center; font-size: 12px; color: #94a3b8; }
.clp-dd-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: none; background: transparent; border-radius: 7px; font-size: 13px; font-weight: 600; color: #0c4a6e; cursor: pointer; transition: background .12s ease; }
.clp-dd-item:hover { background: #ecfeff; }
.clp-dd-item.is-active { background: #cffafe; color: #0e7490; }

.clp-list-label { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #0e7490; margin-top: 2px; }
.clp-list { display: flex; flex-direction: column; gap: 8px; min-height: 120px; max-height: 300px; overflow-y: auto; padding: 2px; }
.clp-empty { padding: 28px 12px; text-align: center; font-size: 12.5px; color: #64748b; }
.clp-item { display: flex; flex-direction: row; align-items: flex-start; gap: 9px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(6,182,212,.18); background: #f8feff; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.clp-item:hover { border-color: #0891b2; background: #ecfeff; transform: translateY(-1px); }
.clp-item.is-on { border-color: #0891b2; background: #ecfeff; box-shadow: 0 0 0 1px rgba(8,145,178,.25) inset; }
.clp-check { width: 15px; height: 15px; flex-shrink: 0; margin-top: 2px; accent-color: #0891b2; cursor: pointer; }
.clp-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.clp-item-title { font-size: 13px; font-weight: 800; color: #0c4a6e; }
.clp-item-sub { font-size: 11px; color: #0e7490; opacity: .85; }

.clp-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px; border-top: 1px solid #f1f5f9; background: #f9fafb; flex-shrink: 0; }
.clp-selcount { font-size: 11.5px; font-weight: 700; color: #64748b; }
.clp-foot-btns { display: inline-flex; align-items: center; gap: 10px; }
.clp-btn { padding: 9px 16px; border-radius: 9px; font-size: 13px; font-weight: 700; border: 1px solid transparent; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background .15s ease, filter .15s ease, opacity .15s ease; }
.clp-btn-cancel { background: #fff; color: #374151; border-color: #e5e7eb; }
.clp-btn-cancel:hover { background: #f3f4f6; }
.clp-btn-primary { background: linear-gradient(135deg, #0e7490 0%, #0891b2 60%, #06b6d4 100%); color: #fff; }
.clp-btn-primary:hover:not(:disabled) { filter: brightness(1.05); }
.clp-btn-primary:disabled { opacity: .45; cursor: not-allowed; }

[data-bs-theme="dark"] .clp-shell { background: #1e293b; box-shadow: 0 28px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(6,182,212,.20); }
[data-bs-theme="dark"] .clp-body { background: #172033; }
[data-bs-theme="dark"] .clp-lbl,
[data-bs-theme="dark"] .clp-list-label { color: #67e8f9; }
[data-bs-theme="dark"] .clp-empty,
[data-bs-theme="dark"] .clp-selcount { color: #94a3b8; }
[data-bs-theme="dark"] .clp-dd-toggle { background: #0f172a; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .clp-dd-val { color: #e2e8f0; }
[data-bs-theme="dark"] .clp-dd-menu { background: #1e293b; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .clp-dd-search { border-bottom-color: rgba(6,182,212,.20); }
[data-bs-theme="dark"] .clp-dd-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .clp-dd-item { color: #cffafe; }
[data-bs-theme="dark"] .clp-dd-item:hover { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .clp-dd-item.is-active { background: rgba(8,145,178,.30); color: #67e8f9; }
[data-bs-theme="dark"] .clp-item { background: rgba(8,145,178,.08); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .clp-item:hover,
[data-bs-theme="dark"] .clp-item.is-on { background: rgba(8,145,178,.18); border-color: #67e8f9; }
[data-bs-theme="dark"] .clp-item-title { color: #cffafe; }
[data-bs-theme="dark"] .clp-item-sub { color: #67e8f9; }
[data-bs-theme="dark"] .clp-foot { background: #1e293b; border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .clp-btn-cancel { background: #0f172a; color: #cbd5e1; border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .clp-btn-cancel:hover { background: #1e293b; }
`;
