import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note Type — manage popup. Opened from the "+" beside the DEBIT NOTE
 * TYPE dropdown. Lists every type for the tenant with an active/inactive
 * toggle + delete. The "Add" button (in the header) opens a SEPARATE form
 * popup for entering a new type (name + status). On close it calls onChanged()
 * so the parent re-loads its active-types feed.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DnType { id: number; name: string; status: 'active' | 'inactive' }

export default function DebitNoteTypeModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<DnType[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<DnType | null>(null);
  const [dirty, setDirty] = useState(false); // did anything change → tell the parent on close

  const load = () => {
    setLoading(true);
    api.get('/p2p/debit-note-types')
      .then(r => setRows((r.data?.data ?? []) as DnType[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = async (row: DnType) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/p2p/debit-note-types/${row.id}`, { status: next });
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: next } : r));
      setDirty(true);
    } catch { toast.error('Update failed', 'Could not update the status.'); }
  };

  const remove = async (row: DnType) => {
    const ok = await confirm({ title: 'Delete debit note type', message: `Delete "${row.name}"?`, tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await api.delete(`/p2p/debit-note-types/${row.id}`);
      setRows(rs => rs.filter(r => r.id !== row.id));
      setDirty(true);
    } catch { toast.error('Delete failed', 'Could not delete this type.'); }
  };

  const close = () => { if (dirty) onChanged(); onClose(); };

  return createPortal(
    <div className="dnt-overlay">
      <div className="dnt-modal" onMouseDown={e => e.stopPropagation()}>
        {/* Gradient header (matches the Close button) — title + Add on the right. */}
        <div className="dnt-head">
          <div className="dnt-head-l">
            <span className="dnt-head-ico"><IcoTag /></span>
            <div>
              <div className="dnt-head-title">Debit Note Types</div>
              <div className="dnt-head-sub">Manage the types available in the debit note form.</div>
            </div>
          </div>
          <button type="button" className="dnt-addbtn" onClick={() => { setEditRow(null); setFormOpen(true); }}><IcoPlus /> Add</button>
        </div>

        {/* List */}
        <div className="dnt-list">
          {loading ? (
            <div className="dnt-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="dnt-empty">No debit note types yet. Click “Add” to create one.</div>
          ) : (
            <table className="dnt-table">
              <thead>
                <tr><th>Sr No.</th><th>DEBIT NOTE TYPE</th><th>STATUS</th><th className="dnt-c-r">ACTION</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>
                      <Tooltip label="Click to toggle status">
                        <button type="button" className={`dnt-badge ${r.status === 'active' ? 'is-active' : 'is-inactive'}`} onClick={() => toggle(r)}>
                          <span className="dnt-dot" />{r.status === 'active' ? 'Active' : 'Inactive'}
                        </button>
                      </Tooltip>
                    </td>
                    <td className="dnt-c-r">
                      <div className="dnt-actions">
                        <Tooltip label="Edit debit note type">
                          <button type="button" aria-label="Edit debit note type" className="dnt-act dnt-act-edit" onClick={() => { setEditRow(r); setFormOpen(true); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete debit note type">
                          <button type="button" aria-label="Delete debit note type" className="dnt-act dnt-act-del" onClick={() => remove(r)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dnt-foot">
          <button type="button" className="dnt-close" onClick={close}>Close</button>
          <button type="button" className="dnt-done" onClick={close}>Done</button>
        </div>
      </div>

      {formOpen && <TypeFormModal row={editRow} onClose={() => setFormOpen(false)} onSaved={() => { setDirty(true); load(); }} />}

      <style>{DNT_CSS}</style>
    </div>,
    document.body,
  );
}

/* Status dropdown — custom popover matching the app's other dropdowns
 * (the DN wizard's .spi-dt-select), not a native OS <select>. */
function StatusSelect({ value, onChange }: { value: 'active' | 'inactive'; onChange: (v: 'active' | 'inactive') => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  // Position the portal popover against the button (opens up if there's no room below).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = 2 * 38 + 10;
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.dnt-sel-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const opts: { v: 'active' | 'inactive'; label: string }[] = [{ v: 'active', label: 'Active' }, { v: 'inactive', label: 'Inactive' }];
  return (
    <>
      <button type="button" ref={btnRef} className={`dnt-sel-btn ${open ? 'is-open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{value === 'active' ? 'Active' : 'Inactive'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="dnt-sel-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {opts.map(o => (
            <div key={o.v} className={`dnt-sel-opt ${o.v === value ? 'is-active' : ''}`} onClick={() => { onChange(o.v); setOpen(false); }}>{o.label}</div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/* Separate add / edit form popup for a single debit note type. */
function TypeFormModal({ row, onClose, onSaved }: { row: DnType | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!row;
  const [name, setName] = useState(row?.name ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(row?.status ?? 'active');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = name.trim();
    if (!n) { toast.info('Name required', 'Enter a debit note type name.'); return; }
    setSaving(true);
    try {
      if (isEdit) await api.put(`/p2p/debit-note-types/${row!.id}`, { name: n, status });
      else await api.post('/p2p/debit-note-types', { name: n, status });
      toast.success(isEdit ? 'Debit note type updated' : 'Debit note type added');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(isEdit ? 'Could not update' : 'Could not add', e?.response?.data?.message ?? 'Failed to save debit note type.');
    } finally { setSaving(false); }
  };

  return createPortal(
    <div className="dnt-overlay dnt-overlay-2">
      <div className="dnt-modal dnt-modal-sm" onMouseDown={e => e.stopPropagation()}>
        <div className="dnt-head">
          <div className="dnt-head-l">
            <span className="dnt-head-ico"><IcoPlus size={17} /></span>
            <div>
              <div className="dnt-head-title">{isEdit ? 'Edit Debit Note Type' : 'Add Debit Note Type'}</div>
              <div className="dnt-head-sub">{isEdit ? 'Update this type used in the debit note form.' : 'Create a new type for the debit note form.'}</div>
            </div>
          </div>
        </div>

        <div className="dnt-form">
          <div className="dnt-add-f">
            <label>DEBIT NOTE TYPE</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Purchase Return"
              onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          </div>
          <div className="dnt-add-f">
            <label>STATUS</label>
            <StatusSelect value={status} onChange={setStatus} />
          </div>
        </div>

        <div className="dnt-foot">
          <button type="button" className="dnt-close" onClick={onClose}>Cancel</button>
          <button type="button" className="dnt-done" onClick={save} disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Update' : 'Save')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DNT_CSS = `
.dnt-overlay { position:fixed; inset:0; z-index:1200; background:rgba(8,47,73,.45); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:20px; }
.dnt-overlay-2 { z-index:1300; background:rgba(8,47,73,.5); }
.dnt-modal { width:560px; max-width:100%; max-height:88vh; display:flex; flex-direction:column; background:#fff; border-radius:16px; box-shadow:0 24px 60px -12px rgba(8,47,73,.4); overflow:hidden; }
.dnt-modal-sm { width:440px; }
/* Gradient header — same 135deg teal as the wizard Close button. */
.dnt-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; background:linear-gradient(135deg,#06b6d4 0%,#0891b2 50%,#0e7490 100%); }
.dnt-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.dnt-head-ico { width:40px; height:40px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.28); }
.dnt-head-title { font-size:15px; font-weight:800; color:#fff; }
.dnt-head-sub { font-size:11.5px; font-weight:600; color:rgba(255,255,255,.82); margin-top:2px; }
/* Add button in the header — light chip on the gradient. */
.dnt-addbtn { display:inline-flex; align-items:center; gap:6px; height:36px; padding:0 15px; border:0; border-radius:9px; background:#fff; color:#0e7490; font-size:12.5px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px -3px rgba(8,47,73,.35); transition:transform .15s,box-shadow .15s; flex-shrink:0; }
.dnt-addbtn:hover { transform:translateY(-1.5px); box-shadow:0 7px 16px -4px rgba(8,47,73,.4); }
.dnt-list { flex:1; overflow-y:auto; padding:8px 18px 14px; }
.dnt-empty { padding:40px 10px; text-align:center; color:#94a3b8; font-size:13px; font-weight:600; }
.dnt-table { width:100%; border-collapse:collapse; }
.dnt-table thead th { text-align:left; font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#5b8aa0; padding:8px 8px; border-bottom:1px solid #eef3f6; }
.dnt-table tbody td { padding:9px 8px; font-size:12.5px; font-weight:600; color:#3a5161; border-bottom:1px solid #f1f6f8; vertical-align:middle; }
.dnt-c-r { text-align:right; }
.dnt-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 11px; border-radius:20px; font-size:11px; font-weight:700; border:0; cursor:pointer; }
.dnt-badge .dnt-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
.dnt-badge.is-active { background:#ecfdf5; color:#059669; }
.dnt-badge.is-inactive { background:#f1f5f9; color:#64748b; }
/* Row action buttons — same look + icons as the Segment master (.clm-act). */
.dnt-actions { display:inline-flex; align-items:center; justify-content:flex-end; gap:6px; }
.dnt-act { width:30px; height:30px; border-radius:7px; cursor:pointer; border:1px solid; background:transparent; padding:0; display:inline-flex; align-items:center; justify-content:center; transition:transform .15s,background .15s,border-color .15s,box-shadow .15s; }
.dnt-act:hover { transform:translateY(-1px); }
.dnt-act-edit { color:#0891b2; border-color:rgba(6,182,212,.25); background:rgba(240,253,255,.8); }
.dnt-act-edit:hover { background:#cffafe; border-color:#0891b2; box-shadow:0 4px 12px rgba(8,145,178,.25); }
.dnt-act-del { color:#ef4444; border-color:rgba(239,68,68,.22); background:rgba(255,245,245,.8); }
.dnt-act-del:hover { background:#fee2e2; border-color:#ef4444; box-shadow:0 4px 12px rgba(239,68,68,.22); }
[data-bs-theme="dark"] .dnt-act-edit { background:rgba(8,145,178,.14); border-color:rgba(6,182,212,.35); }
[data-bs-theme="dark"] .dnt-act-edit:hover { background:rgba(8,145,178,.28); }
[data-bs-theme="dark"] .dnt-act-del { background:rgba(239,68,68,.10); border-color:rgba(239,68,68,.32); }
[data-bs-theme="dark"] .dnt-act-del:hover { background:rgba(239,68,68,.22); }
/* Add form popup body */
.dnt-form { padding:18px; display:flex; flex-direction:column; gap:14px; }
.dnt-add-f { display:flex; flex-direction:column; gap:6px; }
.dnt-add-f label { font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#5b8aa0; }
.dnt-add-f input { height:40px; padding:0 12px; border:1.5px solid #e3edf2; border-radius:9px; background:#fff; font-size:13px; font-weight:600; color:#0c4a6e; box-sizing:border-box; }
.dnt-add-f input:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
/* Custom status dropdown — matches the DN wizard's .spi-dt-select. */
.dnt-sel-btn { width:100%; height:40px; padding:0 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; border:1.5px solid #e3edf2; border-radius:9px; background:#fff; font-size:13px; font-weight:600; color:#0c4a6e; cursor:pointer; box-sizing:border-box; text-align:left; }
.dnt-sel-btn:hover { border-color:#cfe3ea; }
.dnt-sel-btn.is-open { border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dnt-sel-btn svg { color:#64748b; flex-shrink:0; transition:transform .15s; }
.dnt-sel-btn.is-open svg { transform:rotate(180deg); }
/* Portalled to <body> so it never gets clipped by the modal's overflow:hidden. */
.dnt-sel-pop { position:fixed; z-index:1400; background:#fff; border:1.5px solid #e3edf2; border-radius:10px; box-shadow:0 12px 28px -8px rgba(8,47,73,.28); overflow:hidden; padding:4px; }
.dnt-sel-opt { padding:9px 11px; font-size:13px; font-weight:600; color:#0c4a6e; border-radius:7px; cursor:pointer; }
.dnt-sel-opt:hover { background:#f0fbfe; }
.dnt-sel-opt.is-active { background:#e6f7fb; color:#0e7490; }
[data-bs-theme="dark"] .dnt-sel-btn { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dnt-sel-pop { background:#0c1c24; border-color:rgba(34,211,238,.22); }
[data-bs-theme="dark"] .dnt-sel-opt { color:#e2e8f0; }
[data-bs-theme="dark"] .dnt-sel-opt:hover, [data-bs-theme="dark"] .dnt-sel-opt.is-active { background:rgba(34,211,238,.14); }
/* Footer — Close/Cancel + Done/Save at the bottom. */
.dnt-foot { padding:13px 18px; border-top:1px solid #e3eef3; display:flex; justify-content:flex-end; gap:10px; }
.dnt-close { height:38px; padding:0 18px; border:1.5px solid #e3edf2; border-radius:9px; background:#fff; color:#475569; font-size:12.5px; font-weight:700; cursor:pointer; }
.dnt-close:hover { background:#f1f5f9; }
.dnt-done { height:38px; padding:0 20px; border:0; border-radius:9px; background:linear-gradient(135deg,#0e7490,#0891b2 55%,#06b6d4); color:#fff; font-size:12.5px; font-weight:700; cursor:pointer; }
.dnt-done:disabled { opacity:.6; cursor:default; }
[data-bs-theme="dark"] .dnt-modal { background:#0e1b24; }
[data-bs-theme="dark"] .dnt-foot { border-color:rgba(34,211,238,.18); }
[data-bs-theme="dark"] .dnt-add-f input, [data-bs-theme="dark"] .dnt-add-f select { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dnt-table tbody td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .dnt-badge.is-inactive { background:rgba(148,163,184,.16); color:#cbd5e1; }
[data-bs-theme="dark"] .dnt-close { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#cbd5e1; }
`;

function IcoPlus({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IcoTag({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
