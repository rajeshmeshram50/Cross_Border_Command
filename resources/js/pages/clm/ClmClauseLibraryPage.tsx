import { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf } from './clmCommon';

/* Central CLM → Clause Library Master (two tabs: Types + Library). */

type ClType = { id: number; code: string; name: string; description: string };
type ClLib = { id: number; code: string; clause_type: string; name: string; party: string; clause_status: string; content: string | null };

export default function ClmClauseLibraryPage() {
  const toast = useToast();
  const [tab, setTab]       = useState<'type'|'lib'>('type');
  const [types, setTypes]   = useState<ClType[]>([]);
  const [lib, setLib]       = useState<ClLib[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: ClType[] }>('/clm/clause-types'),
      api.get<{ status: boolean; data: ClLib[]  }>('/clm/clause-library'),
    ]).then(([t, l]) => { setTypes(t.data.data ?? []); setLib(l.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load clause library'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'type' ? 'active' : ''}`} onClick={() => setTab('type')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
        Clause Types
      </button>
      <button className={`clm-pill ${tab === 'lib' ? 'active' : ''}`} onClick={() => setTab('lib')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        Clause Library
      </button>
    </div>
  );

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hCl}
        title="Clause Library Master"
        sub="Manage reusable legal clauses for CLM agreement generation workflows."
        rightSlot={pillSwitcher}
      />

      <ClmBrefBox
        icon={ICO.bCl}
        label="Clause Library"
        sub="Manage reusable legal clauses and clause types for CLM agreement workflows."
        steps={[
          { n: '01', title: 'Create Clause Type',     desc: 'Define clause categories like Core Legal, Financial, Risk.', icon: ICO.grid },
          { n: '02', title: 'Draft Clause',           desc: 'Author reusable clause text with placeholders.',             icon: ICO.edit },
          { n: '03', title: 'Set Applicable Party',   desc: 'Define buyer, consignee, and supplier applicability.',        icon: ICO.users },
          { n: '04', title: 'Insert Placeholders',    desc: 'Embed dynamic placeholders in clause content.',              icon: ICO.zap },
          { n: '05', title: 'Use in Agreements',      desc: 'Insert clauses in CLM agreement drafts automatically.',      icon: ICO.check },
        ]}
      />

      {tab === 'type'
        ? <TypesPane rows={types} loading={loading} reload={reload} />
        : <LibraryPane rows={lib} types={types} loading={loading} reload={reload} />}
    </div>
  );
}

function TypesPane({ rows, loading, reload }: { rows: ClType[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<ClType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClType | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { name: string; description: string }, id?: number) => {
    try {
      if (id) await api.put(`/clm/clause-types/${id}`, form);
      else    await api.post('/clm/clause-types', form);
      toast.success(id ? 'Updated' : 'Added', form.name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/clause-types/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search clause types…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Clause Type
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bCl}</div>
            <div className="clm-empty-title">No clause types yet</div>
            <div className="clm-empty-sub">Click + Add Clause Type to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 120, textAlign: 'center' }}>TYPE ID</th>
                <th>CLAUSE TYPE NAME</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={4} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td className="clm-td-name">{r.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <div className="clm-pag">
                <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
                <div className="clm-pag-btns">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modalOpen && <ClauseTypeModal title={editing ? 'Edit Clause Type' : 'Add Clause Type'} code={editing?.code ?? `CLT-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initialName={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(name) => onSave({ name, description: '' }, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete clause type?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

function LibraryPane({ rows, types, loading, reload }: { rows: ClLib[]; types: ClType[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<ClLib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClLib | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.clause_type.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: Omit<ClLib, 'id'|'code'>, id?: number) => {
    try {
      if (id) await api.put(`/clm/clause-library/${id}`, form);
      else    await api.post('/clm/clause-library', form);
      toast.success(id ? 'Updated' : 'Added', form.name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/clause-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  const typeBadge = (t: string) => {
    const m: Record<string, string> = {
      'Core Legal': 'clm-badge-teal', 'Commercial': 'clm-badge-emerald', 'Financial': 'clm-badge-amber',
      'Risk': 'clm-badge-red', 'Regulatory': 'clm-badge-violet', 'Operational': 'clm-badge-emerald',
      'IP & Confidentiality': 'clm-badge-pink', 'Dispute & Arbitration': 'clm-badge-orange',
    };
    return m[t] ?? 'clm-badge-slate';
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search clause library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Clause
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bCl}</div>
            <div className="clm-empty-title">No clauses yet</div>
            <div className="clm-empty-sub">Click + Add Clause to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>CLAUSE ID</th>
                <th style={{ width: 170, textAlign: 'center' }}>CLAUSE TYPE</th>
                <th>CLAUSE NAME</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td style={{ textAlign: 'center' }}><span className={`clm-badge ${typeBadge(r.clause_type)}`}>{r.clause_type}</span></td>
                    <td className="clm-td-name">{r.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="clm-actions">
                        <button className="clm-act clm-act-edit" title="Edit" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button className="clm-act clm-act-del" title="Delete" onClick={() => setPendingDelete(r)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length > 0 && (
              <div className="clm-pag">
                <span className="clm-pag-info">Showing <b>{start + 1}–{Math.min(start + PER_PAGE, filtered.length)}</b> of <b>{filtered.length}</b></span>
                <div className="clm-pag-btns">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPage(p)} disabled={p === safePage} className={`clm-pag-btn ${p === safePage ? 'on' : ''}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modalOpen && <ClauseLibModal existing={editing} types={types} nextCode={`CL-${String(rows.length + 1).padStart(3, '0')}`} onTypeCreated={reload} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete clause?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

/* Memoized contenteditable rich editor for the clause modal — same
 * pattern as the T&C editor (React.memo isolates the DOM from parent
 * re-renders so manual innerHTML mutations are never wiped). */
const ClauseRichEditor = memo(forwardRef<HTMLDivElement, { initialHTML: string }>(
  function ClauseRichEditor({ initialHTML }, ref) {
    const inited = useRef(false);
    return (
      <div
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
          if (node && !inited.current) {
            node.innerHTML = initialHTML;
            inited.current = true;
          }
        }}
        className="clm-editor-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write the clause text here…"
      />
    );
  }
));

function ClauseLibModal(props: {
  existing:        ClLib | null;
  types:           ClType[];
  nextCode:        string;
  onTypeCreated:   () => void | Promise<void>;
  onClose:         () => void;
  onSave:          (f: Omit<ClLib, 'id'|'code'>) => void;
}) {
  const { existing, types, nextCode, onTypeCreated, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;

  /* Form fields. Per the design brief, party + status are dropped from
   * the visible form — we still send them in the payload (defaults) so
   * the backend contract stays compatible. */
  const [type, setType] = useState(existing?.clause_type ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /* Inner type-add modal toggle. */
  const [showTypeAdd, setShowTypeAdd] = useState(false);

  /* Rich text editor — DOM owns the content, read on save. */
  const editorRef     = useRef<HTMLDivElement | null>(null);
  const initialContent = existing?.content ?? '';

  const fmt = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!type.trim()) next.type = 'Clause type is required';
    if (!name.trim()) next.name = 'Clause name is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const content = editorRef.current?.innerHTML?.trim() || null;
      await Promise.resolve(onSave({
        clause_type: type.trim(),
        name: name.trim(),
        party: existing?.party ?? '',
        clause_status: existing?.clause_status ?? 'Active',
        content: content === '<br>' ? null : content,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <>
    <div className="clm-modal-bd">
      <div className="clm-modal clm-modal-xwide">
        {/* ── HEADER ── */}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
            <div>
              <div className="clm-modal-head-eyebrow">Clause Library</div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Clause' : 'Add New Clause'}</div>
              <div className="clm-modal-head-sub">Define a reusable clause for CLM workflows.</div>
            </div>
          </div>
          <div className="clm-modal-head-right">
            <div className="clm-modal-id-badge">
              <div className="clm-modal-id-label">Clause ID</div>
              <div className="clm-modal-id-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <button className="clm-modal-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="clm-modal-body">
          {/* Top row — Type + Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="clm-field">
              <label className="clm-field-label">Clause Type <span className="clm-req">*</span></label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className={`clm-select ${errors.type ? 'clm-input-err' : ''}`}
                  value={type}
                  onChange={e => { setType(e.target.value); setErrors(p => ({ ...p, type: '' })); }}
                  style={{ flex: 1 }}
                >
                  <option value="">— Select Clause Type —</option>
                  {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  {type && !types.find(t => t.name === type) && <option value={type}>{type}</option>}
                </select>
                <button type="button" className="clm-inline-add" title="Add new clause type" onClick={() => setShowTypeAdd(true)}>+</button>
              </div>
              {errors.type && <div className="clm-err">{errors.type}</div>}
            </div>
            <div className="clm-field">
              <label className="clm-field-label">Clause Name <span className="clm-req">*</span></label>
              <input
                className={`clm-input ${errors.name ? 'clm-input-err' : ''}`}
                placeholder="e.g. Force Majeure, Payment Terms — 30 Days"
                value={name}
                onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
              />
              {errors.name && <div className="clm-err">{errors.name}</div>}
            </div>
          </div>

          {/* Rich text editor — no Upload Word / Placeholder buttons
              per the design brief (clauses are simpler than T&Cs). */}
          <div className="clm-editor-card">
            <div className="clm-editor-head">
              <div className="clm-editor-head-left">
                <div className="clm-editor-head-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>
                <span className="clm-editor-head-label">Clause Content</span>
              </div>
            </div>
            {/* Simplified toolbar — only the buttons shown in the design:
                font size, paragraph style, B/I/U/S, align L/C, lists,
                undo/redo, clear formatting. */}
            <div className="clm-editor-toolbar">
              <select className="clm-editor-tb-sel" defaultValue="3" onChange={e => { fmt('fontSize', e.target.value); e.target.value = '3'; }} title="Font size">
                <option value="1">8</option><option value="2">10</option><option value="3">12</option><option value="4">14</option><option value="5">18</option><option value="6">24</option><option value="7">32</option>
              </select>
              <select className="clm-editor-tb-sel" defaultValue="p" onChange={e => { fmt('formatBlock', e.target.value); e.target.value = 'p'; }} title="Paragraph style">
                <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="blockquote">Quote</option>
              </select>
              <span className="clm-editor-tb-divider" />
              <button type="button" className="clm-editor-tb-btn b" title="Bold" onClick={() => fmt('bold')}>B</button>
              <button type="button" className="clm-editor-tb-btn i" title="Italic" onClick={() => fmt('italic')}>I</button>
              <button type="button" className="clm-editor-tb-btn u" title="Underline" onClick={() => fmt('underline')}>U</button>
              <button type="button" className="clm-editor-tb-btn s" title="Strikethrough" onClick={() => fmt('strikeThrough')}>S</button>
              <span className="clm-editor-tb-divider" />
              <button type="button" className="clm-editor-tb-btn" title="Align left" onClick={() => fmt('justifyLeft')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg></button>
              <button type="button" className="clm-editor-tb-btn" title="Align center" onClick={() => fmt('justifyCenter')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg></button>
              <span className="clm-editor-tb-divider" />
              <button type="button" className="clm-editor-tb-btn" title="Bullet list" onClick={() => fmt('insertUnorderedList')} style={{ fontSize: 15 }}>•≡</button>
              <button type="button" className="clm-editor-tb-btn" title="Numbered list" onClick={() => fmt('insertOrderedList')} style={{ fontWeight: 700 }}>1≡</button>
              <span className="clm-editor-tb-divider" />
              <button type="button" className="clm-editor-tb-btn" title="Undo" onClick={() => fmt('undo')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg></button>
              <button type="button" className="clm-editor-tb-btn" title="Redo" onClick={() => fmt('redo')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg></button>
              <button type="button" className="clm-editor-tb-btn" title="Clear formatting" onClick={() => fmt('removeFormat')}>T̲ₓ</button>
            </div>
            <ClauseRichEditor ref={editorRef} initialHTML={initialContent} />
            <div className="clm-editor-foot">
              <div className="clm-editor-foot-hint">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .5 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Placeholders auto-fill on clause insertion
              </div>
              <span className="clm-editor-foot-ph">{'{{PLACEHOLDER}}'}</span>
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Clause' : 'Save Clause')}
          </button>
        </div>
      </div>
    </div>

    {showTypeAdd && (
      <ClauseTypeModal
        title="Add Clause Type"
        code={`CLT-${String(types.length + 1).padStart(3, '0')}`}
        isEdit={false}
        initialName=""
        onClose={() => setShowTypeAdd(false)}
        onSave={async (newName) => {
          try {
            await api.post('/clm/clause-types', { name: newName, description: '' });
            toast.success('Added', newName);
            await Promise.resolve(onTypeCreated());
            setType(newName);
            setErrors(p => ({ ...p, type: '' }));
            setShowTypeAdd(false);
          } catch (e: any) {
            toast.error('Save failed', e?.response?.data?.message ?? 'Could not save clause type');
          }
        }}
      />
    )}
    </>
  ), document.body);
}

/* Clause Type modal — single name field, replaces the previous
 * SimpleDescModal usage (description is dropped from the form and
 * always saved as empty string to keep the backend contract). */
function ClauseTypeModal(props: {
  title: string;
  code: string;
  isEdit: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { title, code, isEdit, onClose, onSave } = props;
  const [name, setName] = useState(props.initialName);
  const [err,  setErr]  = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    const v = name.trim();
    if (!v) { setErr('Clause type name is required'); return; }
    setSaving(true);
    try { await Promise.resolve(onSave(v)); }
    finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal">
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{title}</div>
              <div className="clm-modal-head-sub">Define a clause type for the Clause Library.</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="clm-modal-body">
          <div className="clm-autocode">
            <div className="clm-autocode-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
            <div className="clm-autocode-text">
              <div className="clm-autocode-label">Auto Generated</div>
              <div className="clm-autocode-val">{code}</div>
            </div>
            <div className={`clm-autocode-badge ${isEdit ? 'edit' : ''}`}><span className="clm-autocode-dot" />{isEdit ? 'Edit' : 'Auto'}</div>
          </div>
          <div className="clm-field">
            <label className="clm-field-label">Clause Type Name <span className="clm-req">*</span></label>
            <input
              className={`clm-input ${err ? 'clm-input-err' : ''}`}
              autoFocus
              value={name}
              onChange={e => { setName(e.target.value); setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handle(); } }}
              placeholder="e.g. Core Legal, Financial, Risk"
            />
            {err && <div className="clm-err">{err}</div>}
          </div>
        </div>
        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="clm-btn-save" onClick={() => void handle()} disabled={saving}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Saving…' : (isEdit ? 'Update Type' : 'Save Type')}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
