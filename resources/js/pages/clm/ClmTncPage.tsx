import { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { CLM_CSS, PER_PAGE, paginate } from './clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from './ClmPageShell';
import { DeleteConf, ShortCodeNameModal } from './clmCommon';
import { SegmentModal } from './ClmSegmentPage';

/* Central CLM → Terms & Conditions Master (two tabs: Categories + Library). */

type Cat = { id: number; code: string; short_code: string; name: string };
type Lib = { id: number; code: string; segment: string; category: string; party: string; content: string | null };

export default function ClmTncPage() {
  const toast = useToast();
  const [tab, setTab]     = useState<'cat'|'lib'>('cat');
  const [cats, setCats]   = useState<Cat[]>([]);
  const [lib, setLib]     = useState<Lib[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: Cat[] }>('/clm/tnc-categories'),
      api.get<{ status: boolean; data: Lib[] }>('/clm/tnc-library'),
    ]).then(([c, l]) => { setCats(c.data.data ?? []); setLib(l.data.data ?? []); })
      .catch(() => toast.error('Load failed', 'Could not load T&C data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pillSwitcher = (
    <div className="clm-pill-group">
      <button className={`clm-pill ${tab === 'cat' ? 'active' : ''}`} onClick={() => setTab('cat')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
        Document Category
      </button>
      <button className={`clm-pill ${tab === 'lib' ? 'active' : ''}`} onClick={() => setTab('lib')}>
        <span className="clm-pill-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        T&amp;C Library
      </button>
    </div>
  );

  return (
    <div className="clm-root">
      <style>{CLM_CSS}</style>

      <ClmPageHeader
        icon={ICO.hTnc}
        title="T&C Master"
        sub="Manage reusable Terms & Conditions templates for trade and operational documents."
        rightSlot={pillSwitcher}
      />

      <ClmBrefBox
        icon={ICO.bTnc}
        label="T&C Master"
        sub="Manage document-wise Terms & Conditions and reusable legal content."
        steps={[
          { n: '01', title: 'Create Category',       desc: 'Add PI, PO, Invoice, and document categories.',         icon: ICO.grid },
          { n: '02', title: 'Create T&C',            desc: 'Add reusable Terms & Conditions content.',              icon: ICO.book },
          { n: '03', title: 'Set Applies To',        desc: 'Define buyer, consignee, and supplier applicability.',   icon: ICO.users },
          { n: '04', title: 'Write T&C Content',     desc: 'Create legal rules and reusable clauses.',              icon: ICO.edit },
          { n: '05', title: 'Enable Usage',          desc: 'Use T&Cs across contracts and trade workflows.',         icon: ICO.check },
        ]}
      />

      {tab === 'cat'
        ? <CategoriesPane rows={cats} loading={loading} reload={reload} />
        : <LibraryPane rows={lib} cats={cats} loading={loading} reload={reload} />}
    </div>
  );
}

function CategoriesPane({ rows, loading, reload }: { rows: Cat[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(s) || r.short_code.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: { short_code: string; name: string }, id?: number) => {
    try {
      if (id) await api.put(`/clm/tnc-categories/${id}`, form);
      else    await api.post('/clm/tnc-categories', form);
      toast.success(id ? 'Updated' : 'Added', form.name);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-categories/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.name); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search categories…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Document Category
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No categories yet</div>
            <div className="clm-empty-sub">Click + Add Document Category to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 120, textAlign: 'center' }}>CATEGORY ID</th>
                <th>DOCUMENT CATEGORY NAME</th>
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

      {modalOpen && <ShortCodeNameModal title={editing ? 'Edit Document Category' : 'Add New Document Category'} code={editing?.code ?? `DC-${String(rows.length + 1).padStart(3, '0')}`} isEdit={!!editing} initialShortCode={editing?.short_code ?? ''} initialName={editing?.name ?? ''} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete category?" sub={`${pendingDelete.name} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

function LibraryPane({ rows, cats, loading, reload }: { rows: Lib[]; cats: Cat[]; loading: boolean; reload: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [editing, setEditing] = useState<Lib | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Lib | null>(null);
  /* Segments come exclusively from the Segment Master — no hardcoded
   * fallback list. If the master is empty the dropdown stays empty and
   * the user creates segments via the inline "+" button. Less Regulatory
   * rows still save as segment='General' silently, but 'General' only
   * appears in the dropdown if the user has actually created it in the
   * Segment Master. The in-modal "+" appends locally for immediate UX
   * after creating a new segment via the real master form. */
  const [segments, setSegments] = useState<string[]>([]);
  const addSegment = (s: string) => setSegments(prev => prev.includes(s) ? prev : [...prev, s]);

  useEffect(() => {
    api.get<{ status: boolean; data: { name: string }[] }>('/clm/segments')
      .then(({ data }) => {
        const names = (data.data ?? []).map(s => s.name).filter(Boolean);
        setSegments(names);
      })
      .catch(() => { /* leave dropdown empty on error */ });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r => r.category.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.party.toLowerCase().includes(s) || r.segment.toLowerCase().includes(s));
  }, [rows, search]);
  const { slice, start, pageCount, safePage } = paginate(filtered, page);

  const onSave = async (form: Omit<Lib, 'id'|'code'>, id?: number) => {
    try {
      if (id) await api.put(`/clm/tnc-library/${id}`, form);
      else    await api.post('/clm/tnc-library', form);
      toast.success(id ? 'Updated' : 'Added', form.category);
      setModalOpen(false); setEditing(null); reload();
    } catch (e: any) { toast.error('Save failed', e?.response?.data?.message ?? 'Could not save'); }
  };
  const onDelete = async () => {
    if (!pendingDelete) return;
    try { await api.delete(`/clm/tnc-library/${pendingDelete.id}`); toast.success('Deleted', pendingDelete.category); setPendingDelete(null); reload(); }
    catch (e: any) { toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete'); }
  };

  return (
    <div className="clm-page-card">
      <div className="clm-tabs-bar" style={{ justifyContent: 'space-between' }}>
        <div className="clm-search clm-search-grow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" placeholder="Search T&C library…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button className="clm-add-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add T&amp;C
        </button>
      </div>

      <div className={`clm-tab-body ${slice.length > 0 ? 'has-data' : ''}`}>
        {slice.length === 0 ? (
          <div className="clm-empty">
            <div className="clm-empty-ico">{ICO.bTnc}</div>
            <div className="clm-empty-title">No T&amp;C blocks yet</div>
            <div className="clm-empty-sub">Click + Add T&amp;C to create the first record.</div>
          </div>
        ) : (
          <div className="clm-table-wrap">
            <table className="clm-table">
              <thead><tr>
                <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                <th style={{ width: 110, textAlign: 'center' }}>T&amp;C ID</th>
                <th style={{ width: 110, textAlign: 'center' }}>SEGMENT</th>
                <th>DOCUMENT CATEGORY</th>
                <th>APPLIES TO</th>
                <th style={{ width: 90, textAlign: 'center' }}>ACTIONS</th>
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="clm-status">Loading…</td></tr>}
                {!loading && slice.map((r, i) => (
                  <tr key={r.id}>
                    <td className="clm-td-num">{start + i + 1}</td>
                    <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.code}</span></td>
                    <td style={{ textAlign: 'center' }}><span className="clm-badge clm-badge-teal">{r.segment}</span></td>
                    <td className="clm-td-name">{r.category}</td>
                    <td className="clm-td-desc">{r.party}</td>
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

      {modalOpen && <TncBlockModal existing={editing} cats={cats} nextCode={`TNC-${String(rows.length + 1).padStart(3, '0')}`} segments={segments} onAddSegment={addSegment} onCategoryCreated={reload} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={(f) => onSave(f, editing?.id)} />}
      {pendingDelete && createPortal(<DeleteConf title="Delete T&C block?" sub={`${pendingDelete.category} (${pendingDelete.code}) will be removed.`} onCancel={() => setPendingDelete(null)} onConfirm={onDelete} />, document.body)}
    </div>
  );
}

/* Party options as shown in the HTML prototype — Buyer/Consignee
 * row + Supplier sub-types row. The stored `party` column is the
 * comma-joined list of labels e.g. "Buyer, Supplier-Material". */
const TNC_PARTIES_BUYER: { key: string; label: string; emoji: string }[] = [
  { key: 'Buyer',     label: 'Buyer',     emoji: '👤' },
  { key: 'Consignee', label: 'Consignee', emoji: '🏢' },
];
const TNC_PARTIES_SUPPLIER: { key: string; label: string; emoji: string }[] = [
  { key: 'Supplier-Material',       label: 'Material',       emoji: '📦' },
  { key: 'Supplier-Logistic',       label: 'Logistic',       emoji: '🚚' },
  { key: 'Supplier-Tech',           label: 'Tech',           emoji: '💻' },
  { key: 'Supplier-Advisory',       label: 'Advisory',       emoji: '📊' },
  { key: 'Supplier-Strategic Risk', label: 'Strategic Risk', emoji: '⚠️' },
];
/* Memoized contenteditable rich editor. React.memo with empty props
 * means the parent (TncBlockModal) re-rendering — from setUploading,
 * toast, etc. — NEVER reconciles this element. The DOM owns the
 * editor's content after the initial innerHTML is set in the ref
 * callback. This is what fixes the "uploaded content flashes for a
 * fraction of a second then disappears" bug.
 *
 * `initialHTML` is read once on the ref callback's first attach and
 * not on subsequent renders, so changing it after mount is a no-op
 * (deliberate — the parent should use editorRef.current.innerHTML
 * for any later mutations like Upload Word). */
const RichEditor = memo(forwardRef<HTMLDivElement, { initialHTML: string }>(
  function RichEditor({ initialHTML }, ref) {
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
        data-placeholder="Write the T&C clause text here…"
      />
    );
  }
));

function TncBlockModal(props: {
  existing:           Lib | null;
  cats:               Cat[];
  nextCode:           string;
  segments:           string[];
  onAddSegment:       (s: string) => void;
  onCategoryCreated:  () => void | Promise<void>;
  onClose:            () => void;
  onSave:             (f: Omit<Lib, 'id'|'code'>) => void;
}) {
  const { existing, cats, nextCode, segments, onAddSegment, onCategoryCreated, onClose, onSave } = props;
  const toast = useToast();
  const isEdit = !!existing;

  /* Stage state — 1 = Basic Details, 2 = T&C Content. */
  const [stage, setStage] = useState<1 | 2>(1);

  /* Inner-modal toggles + upload state. */
  const [showSegAdd,  setShowSegAdd]  = useState(false);
  const [showCatAdd,  setShowCatAdd]  = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* Clause Library picker — opens the master's clause list so the user
   * can insert any saved clause body at the editor's cursor. We stash
   * the active Selection range before showing the picker because the
   * picker steals focus; on insert we restore the range so insertHTML
   * lands at the user's intended cursor position. */
  const [showClausePicker, setShowClausePicker] = useState(false);
  const savedSelectionRef = useRef<Range | null>(null);

  const openClausePicker = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      } else {
        savedSelectionRef.current = null;
      }
    }
    setShowClausePicker(true);
  };

  const insertClauseAtCursor = (html: string, label: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelectionRef.current);
    }
    /* If there's no saved range (cursor never entered the editor),
     * append the clause to the end so the user still sees a result. */
    if (!savedSelectionRef.current) {
      editorRef.current.innerHTML = editorRef.current.innerHTML + html;
    } else {
      document.execCommand('insertHTML', false, html);
    }
    setShowClausePicker(false);
    savedSelectionRef.current = null;
    toast.success('Inserted', `Clause "${label}" inserted at cursor.`);
  };

  /* Stage 1 fields. */
  /* Regulatory status drives whether the Segment dropdown is shown.
   * High → user picks a specific segment.
   * Less → segment is implicitly "General" (applies to all). On edit
   * we infer the status from the stored segment value. */
  const [regStatus, setRegStatus] = useState<'high' | 'less'>(() => {
    const s = existing?.segment?.trim();
    return s && s !== 'General' ? 'high' : 'less';
  });
  const [segment, setSegment]   = useState(existing?.segment ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  /* Hydrate party selection from existing comma-joined string. */
  const [selParties, setSelParties] = useState<Set<string>>(() => {
    if (!existing?.party) return new Set();
    return new Set(existing.party.split(',').map(s => s.trim()).filter(Boolean));
  });

  /* Stage 2: rich text content lives on the contenteditable div. We
   * read .innerHTML on save instead of mirroring it to React state on
   * every keystroke (cursor jumps if we re-render mid-edit). The
   * editor itself is wrapped in React.memo (see RichEditor below) so
   * parent re-renders from setUploading / toast / etc. literally
   * cannot reconcile its DOM — preventing the upload-flash-wipe bug. */
  const editorRef     = useRef<HTMLDivElement | null>(null);
  const initialContent = existing?.content ?? '';

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);


  const allParties = useMemo(() => [...TNC_PARTIES_BUYER, ...TNC_PARTIES_SUPPLIER], []);
  const allOn = useMemo(() => allParties.every(p => selParties.has(p.key)), [allParties, selParties]);

  const toggleParty = (key: string) => {
    setSelParties(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setErrors(p => ({ ...p, party: '' }));
  };
  const toggleAll = (on: boolean) => {
    setSelParties(on ? new Set(allParties.map(p => p.key)) : new Set());
    setErrors(p => ({ ...p, party: '' }));
  };

  /* execCommand is deprecated but every browser still supports it
   * and it's all the prototype uses for the toolbar buttons. */
  const fmt = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  /* Upload Word — read .docx via mammoth.js (lazy-loaded from CDN
   * on first use), .html/.htm as raw HTML, .txt as paragraph-wrapped
   * text. The parsed content REPLACES the editor's current content
   * (matches the user's intent of "uploaded file content shows in
   * the editor"). */
  const loadMammoth = (): Promise<any> => new Promise((resolve, reject) => {
    if ((window as any).mammoth) return resolve((window as any).mammoth);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    s.async = true;
    s.onload  = () => resolve((window as any).mammoth);
    s.onerror = () => reject(new Error('Could not load the .docx parser (check internet connection).'));
    document.head.appendChild(s);
  });

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const name = file.name.toLowerCase();
      let html = '';
      if (name.endsWith('.docx')) {
        const mammoth = await loadMammoth();
        const buf = await file.arrayBuffer();
        const r = await mammoth.convertToHtml({ arrayBuffer: buf });
        html = r?.value || '';
        if (!html) throw new Error('The .docx file appears to be empty.');
      } else if (name.endsWith('.html') || name.endsWith('.htm')) {
        html = await file.text();
      } else if (name.endsWith('.txt')) {
        const text = await file.text();
        html = text.split(/\r?\n/).map(l => l.trim() ? `<p>${l.replace(/[<>&]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]!))}</p>` : '<p><br></p>').join('');
      } else if (name.endsWith('.doc')) {
        throw new Error('Legacy .doc files aren\'t supported — please save as .docx and try again.');
      } else {
        throw new Error(`Unsupported file type: ${file.name}`);
      }
      if (editorRef.current) {
        editorRef.current.innerHTML = html;
        editorRef.current.focus();
      }
      toast.success('Uploaded', `${file.name} loaded into the editor.`);
    } catch (e: any) {
      toast.error('Upload failed', e?.message || 'Could not read the file.');
    } finally { setUploading(false); }
  };

  const goNext = () => {
    const next: Record<string, string> = {};
    if (regStatus === 'high' && !segment.trim()) next.segment = 'Pick a segment for High Regulatory';
    if (!category.trim()) next.category = 'T&C Document Name is required';
    if (selParties.size === 0) next.party = 'Select at least one applicable party';
    setErrors(next);
    if (Object.keys(next).length) return;
    setStage(2);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const content = editorRef.current?.innerHTML?.trim() || null;
      const party = Array.from(selParties).join(', ');
      /* Less Regulatory implies "applies to all standard segments",
       * so we persist 'General' regardless of any stale segment value
       * left in state from a prior High selection. */
      const finalSegment = regStatus === 'high' ? (segment.trim() || 'General') : 'General';
      await Promise.resolve(onSave({
        segment: finalSegment,
        category: category.trim(),
        party,
        content: content === '<br>' ? null : content,
      }));
    } finally { setSaving(false); }
  };

  return createPortal((
    <>
    <div className="clm-modal-bd" onClick={onClose}>
      <div className="clm-modal clm-modal-xwide" onClick={e => e.stopPropagation()}>
        {/* ── HEADER ── */}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
            <div>
              <div className="clm-modal-head-eyebrow">T&amp;C Library</div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit T&C' : 'Add New T&C'}</div>
              <div className="clm-modal-head-sub">Create reusable Terms &amp; Conditions content.</div>
            </div>
          </div>
          <div className="clm-modal-head-right">
            <div className="clm-modal-id-badge">
              <div className="clm-modal-id-label">T&amp;C ID</div>
              <div className="clm-modal-id-val">{isEdit ? existing!.code : nextCode}</div>
            </div>
            <button className="clm-modal-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── STEPPER ── */}
        <div className="clm-stepper">
          <div className={`clm-step-card ${stage === 1 ? 'active' : 'done'}`} onClick={() => setStage(1)}>
            <div className="clm-step-num">{stage === 1 ? '1' : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}</div>
            <div className="clm-step-text">
              <div className="clm-step-title">T&amp;C Basic Details</div>
              <div className="clm-step-sub">Segment, category &amp; party</div>
            </div>
          </div>
          <div className="clm-step-conn">
            <span className={`clm-step-conn-dot ${stage >= 1 ? 'filled' : ''}`} />
            <span className={`clm-step-conn-line ${stage >= 2 ? 'filled' : ''}`} />
            <span className="clm-step-conn-dot-sm" />
          </div>
          <div className={`clm-step-card ${stage === 2 ? 'active' : 'idle'}`} onClick={() => { if (stage === 2) return; /* require stage-1 validation before jumping */ }}>
            <div className="clm-step-num">2</div>
            <div className="clm-step-text">
              <div className="clm-step-title">T&amp;C Content</div>
              <div className="clm-step-sub">Rich text editor &amp; clauses</div>
            </div>
          </div>
          <div className="clm-step-progress">
            <div className="clm-step-progress-bars">
              <span className="clm-step-progress-bar filled" />
              <span className={`clm-step-progress-bar ${stage === 2 ? 'filled' : ''}`} />
            </div>
            <div className="clm-step-progress-label">Step {stage} of 2</div>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="clm-modal-body">
          {stage === 1 ? (
            <>
              {/* Regulatory Status — picked first; controls whether the
                  Segment dropdown is shown. Less = applies to all
                  standard segments (segment is forced to "General" on
                  save). High = user must pick a specific segment. */}
              <div className="clm-reg-card">
                <div className="clm-reg-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span className="clm-reg-head-label">Segment Regulatory Status</span>
                  <span className="clm-req">*</span>
                </div>
                <div className="clm-reg-options">
                  <label className={`clm-reg-option high ${regStatus === 'high' ? 'on' : ''}`}>
                    <input type="radio" name="tnc-reg" value="high" checked={regStatus === 'high'} onChange={() => { setRegStatus('high'); setErrors(p => ({ ...p, segment: '' })); }} />
                    <div className="clm-reg-option-body">
                      <div className="clm-reg-option-title">
                        <span className="clm-reg-option-dot" />
                        High Regulatory
                      </div>
                      <div className="clm-reg-option-desc">Requires specific segment &amp; compliance review</div>
                    </div>
                  </label>
                  <label className={`clm-reg-option less ${regStatus === 'less' ? 'on' : ''}`}>
                    <input type="radio" name="tnc-reg" value="less" checked={regStatus === 'less'} onChange={() => { setRegStatus('less'); setErrors(p => ({ ...p, segment: '' })); }} />
                    <div className="clm-reg-option-body">
                      <div className="clm-reg-option-title">
                        <span className="clm-reg-option-dot" />
                        Less Regulatory
                      </div>
                      <div className="clm-reg-option-desc">Applicable to all standard segments by default</div>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: regStatus === 'high' ? '1fr 1fr' : '1fr', gap: 14 }}>
                {regStatus === 'high' && (
                <div className="clm-field">
                  <label className="clm-field-label">Segment <span className="clm-req">*</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select className={`clm-select ${errors.segment ? 'clm-input-err' : ''}`} value={segment} onChange={e => { setSegment(e.target.value); setErrors(p => ({ ...p, segment: '' })); }} style={{ flex: 1 }}>
                      <option value="">— Select Segment —</option>
                      {segments.map(s => <option key={s} value={s}>{s}</option>)}
                      {segment && !segments.includes(segment) && <option value={segment}>{segment}</option>}
                    </select>
                    <button type="button" className="clm-inline-add" title="Add new segment" onClick={() => setShowSegAdd(true)}>+</button>
                  </div>
                  <div className="clm-field-hint-sm">High Regulatory T&amp;Cs are scoped per specific segment</div>
                  {errors.segment && <div className="clm-err">{errors.segment}</div>}
                </div>
                )}
                <div className="clm-field">
                  <label className="clm-field-label">T&amp;C Document Name <span className="clm-req">*</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select className={`clm-select ${errors.category ? 'clm-input-err' : ''}`} value={category} onChange={e => { setCategory(e.target.value); setErrors(p => ({ ...p, category: '' })); }} style={{ flex: 1 }}>
                      <option value="">— Select Category —</option>
                      {cats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      {category && !cats.find(c => c.name === category) && <option value={category}>{category}</option>}
                    </select>
                    <button type="button" className="clm-inline-add" title="Add new document category" onClick={() => setShowCatAdd(true)}>+</button>
                  </div>
                  <div className="clm-field-hint-sm">One T&amp;C per document · title auto-derived from name</div>
                  {errors.category && <div className="clm-err">{errors.category}</div>}
                </div>
              </div>

              {/* Applies To card */}
              <div className="clm-applies-card">
                <div className="clm-applies-head">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <span className="clm-applies-head-label">Applies To</span>
                  <span className="clm-req">*</span>
                  <label className="clm-applies-all">
                    <input type="checkbox" checked={allOn} onChange={e => toggleAll(e.target.checked)} /> ALL
                  </label>
                </div>
                <div className="clm-applies-row">
                  <span className="clm-applies-row-label">Buyer &amp; Consignee</span>
                  {TNC_PARTIES_BUYER.map(p => (
                    <label key={p.key} className={`clm-party-chip ${selParties.has(p.key) ? 'on' : ''}`}>
                      <input type="checkbox" checked={selParties.has(p.key)} onChange={() => toggleParty(p.key)} />
                      <span className="clm-party-chip-emoji">{p.emoji}</span>{p.label}
                    </label>
                  ))}
                </div>
                <div className="clm-applies-row">
                  <span className="clm-applies-row-label">Supplier</span>
                  {TNC_PARTIES_SUPPLIER.map(p => (
                    <label key={p.key} className={`clm-party-chip ${selParties.has(p.key) ? 'on' : ''}`}>
                      <input type="checkbox" checked={selParties.has(p.key)} onChange={() => toggleParty(p.key)} />
                      <span className="clm-party-chip-emoji">{p.emoji}</span>{p.label}
                    </label>
                  ))}
                </div>
                <div className="clm-applies-hint">Tick "All" to apply to every party · or pick specific ones</div>
                {errors.party && <div className="clm-err" style={{ marginTop: 6 }}>{errors.party}</div>}
              </div>
            </>
          ) : (
            <div className="clm-editor-card">
              <div className="clm-editor-head">
                <div className="clm-editor-head-left">
                  <div className="clm-editor-head-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>
                  <span className="clm-editor-head-label">T&amp;C Content</span>
                </div>
                <div className="clm-editor-head-actions">
                  <button type="button" className="clm-editor-head-btn" title="Upload .docx, .html or .txt — content will replace the editor" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    {uploading ? 'Reading…' : 'Upload Word'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,.html,.htm,.txt"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f); e.target.value = ''; }}
                  />
                  <button type="button" className="clm-editor-head-btn" title="Insert clause from the Clause Library master" onClick={openClausePicker}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    Clause Library
                  </button>
                </div>
              </div>
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
                <button type="button" className="clm-editor-tb-btn" title="Superscript" onClick={() => fmt('superscript')}>X²</button>
                <button type="button" className="clm-editor-tb-btn" title="Subscript" onClick={() => fmt('subscript')}>X₂</button>
                <span className="clm-editor-tb-divider" />
                <label className="clm-editor-tb-btn" title="Text color" style={{ position: 'relative', overflow: 'hidden' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                  <input type="color" defaultValue="#0891b2" onChange={e => fmt('foreColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                </label>
                <label className="clm-editor-tb-btn" title="Highlight" style={{ position: 'relative', overflow: 'hidden' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08L9.06 11.9z"/><path d="M7.07 14.94L3 21l6.06-.07 8.06-8.07"/></svg>
                  <input type="color" defaultValue="#fef08a" onChange={e => fmt('hiliteColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                </label>
                <span className="clm-editor-tb-divider" />
                <button type="button" className="clm-editor-tb-btn" title="Align left" onClick={() => fmt('justifyLeft')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Align center" onClick={() => fmt('justifyCenter')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Align right" onClick={() => fmt('justifyRight')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Justify" onClick={() => fmt('justifyFull')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
                <span className="clm-editor-tb-divider" />
                <button type="button" className="clm-editor-tb-btn" title="Bullet list" onClick={() => fmt('insertUnorderedList')} style={{ fontSize: 15 }}>•≡</button>
                <button type="button" className="clm-editor-tb-btn" title="Numbered list" onClick={() => fmt('insertOrderedList')} style={{ fontWeight: 700 }}>1≡</button>
                <button type="button" className="clm-editor-tb-btn" title="Outdent" onClick={() => fmt('outdent')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="7 8 3 12 7 16"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="18" x2="21" y2="18"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Indent" onClick={() => fmt('indent')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="17 8 21 12 17 16"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="18" x2="15" y2="18"/></svg></button>
                <span className="clm-editor-tb-divider" />
                <button type="button" className="clm-editor-tb-btn" title="Insert link" onClick={() => { const u = prompt('Enter URL:', 'https://'); if (u) fmt('createLink', u); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Remove link" onClick={() => fmt('unlink')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Horizontal rule" onClick={() => fmt('insertHorizontalRule')}>—</button>
                <span className="clm-editor-tb-divider" />
                <button type="button" className="clm-editor-tb-btn" title="Undo" onClick={() => fmt('undo')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Redo" onClick={() => fmt('redo')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg></button>
                <button type="button" className="clm-editor-tb-btn" title="Clear formatting" onClick={() => fmt('removeFormat')}>T̲ₓ</button>
              </div>
              <RichEditor ref={editorRef} initialHTML={initialContent} />
              <div className="clm-editor-foot">
                <div className="clm-editor-foot-hint">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .5 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  T&amp;C Content — write the actual rules / terms text using the rich editor above
                </div>
                <span className="clm-editor-foot-ph">{'{{PLACEHOLDER}}'}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className={`clm-modal-foot ${stage === 2 ? 'split' : ''}`}>
          {stage === 2 && (
            <button className="clm-btn-back" onClick={() => setStage(1)} disabled={saving}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to Basic Details
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            {stage === 1 ? (
              <button className="clm-btn-save" onClick={goNext}>
                Save &amp; Next
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ) : (
              <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                {saving ? 'Saving…' : (isEdit ? 'Update T&C' : 'Save T&C')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Inner quick-add modals — siblings inside the same portal.
     * Both reuse the real master forms (SegmentModal from the
     * Segment master, ShortCodeNameModal from the Category tab) so
     * the user sees the same UI everywhere. */}
    {showSegAdd && (
      <SegmentModal
        existing={null}
        nextCode={`S-${String(segments.length + 1).padStart(3, '0')}`}
        onClose={() => setShowSegAdd(false)}
        onSave={async (form) => {
          try {
            await api.post('/clm/segments', form);
            toast.success('Added', `${form.name} added`);
            onAddSegment(form.name);
            setSegment(form.name);
            setShowSegAdd(false);
          } catch (e: any) {
            const errs = e?.response?.data?.errors as Record<string, string[]> | undefined;
            const first = errs ? Object.values(errs)[0]?.[0] : undefined;
            toast.error('Save failed', first ?? e?.response?.data?.message ?? 'Could not save segment');
          }
        }}
      />
    )}
    {showCatAdd && (
      <ShortCodeNameModal
        title="Add New Document Category"
        code={`DC-${String(cats.length + 1).padStart(3, '0')}`}
        isEdit={false}
        initialShortCode=""
        initialName=""
        onClose={() => setShowCatAdd(false)}
        onSave={async (form) => {
          try {
            await api.post('/clm/tnc-categories', form);
            toast.success('Added', form.name);
            await Promise.resolve(onCategoryCreated());
            setCategory(form.name);
            setErrors(p => ({ ...p, category: '' }));
            setShowCatAdd(false);
          } catch (e: any) {
            toast.error('Save failed', e?.response?.data?.message ?? 'Could not save the category');
          }
        }}
      />
    )}
    {showClausePicker && (
      <ClausePicker
        onClose={() => { setShowClausePicker(false); savedSelectionRef.current = null; }}
        onInsert={insertClauseAtCursor}
      />
    )}
    </>
  ), document.body);
}

/* Clause Library picker — modal that lists clauses from the master
 * and inserts the picked clause's content into the parent editor. */
function ClausePicker(props: { onClose: () => void; onInsert: (html: string, label: string) => void }) {
  const { onClose, onInsert } = props;
  const toast = useToast();
  type ClauseRow = { id: number; code: string; clause_type: string; name: string; content: string | null };
  const [rows, setRows]       = useState<ClauseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    api.get<{ status: boolean; data: ClauseRow[] }>('/clm/clause-library')
      .then(({ data }) => setRows(data.data ?? []))
      .catch(() => toast.error('Load failed', 'Could not load clauses'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.clause_type) set.add(r.clause_type); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let base = rows;
    if (typeFilter !== 'all') base = base.filter(r => r.clause_type === typeFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      base = base.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.clause_type.toLowerCase().includes(s));
    }
    return base;
  }, [rows, search, typeFilter]);

  /* Strip HTML for previews — DOMParser is browser-native and safe
   * for arbitrary input since we just read .textContent. */
  const preview = (html: string | null): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  };

  return createPortal((
    <div className="clm-modal-bd" style={{ zIndex: 210000 }} onClick={onClose}>
      <div className="clm-modal" style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
            <div>
              <div className="clm-modal-head-title">Clause Library</div>
              <div className="clm-modal-head-sub">Pick a clause to insert at the cursor.</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Search + type filter */}
        <div style={{ background: '#fff', padding: '10px 14px', borderBottom: '1px solid rgba(6,182,212,.1)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="clm-search clm-search-grow" style={{ flex: 1, minWidth: 200 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input type="text" placeholder="Search clauses…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          {types.length > 0 && (
            <select className="clm-select" style={{ width: 180, height: 36 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All types ({rows.length})</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, background: '#fff', overflowY: 'auto', minHeight: 200 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading clauses…</div>}
          {!loading && filtered.length === 0 && (
            <div className="clm-empty">
              <div className="clm-empty-ico">{ICO.bCl}</div>
              <div className="clm-empty-title">No clauses found</div>
              <div className="clm-empty-sub">{rows.length === 0 ? 'Add clauses in the Clause Library master to see them here.' : 'Try a different search or type filter.'}</div>
            </div>
          )}
          {!loading && filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => onInsert(c.content ?? '', c.name)}
              style={{
                display: 'flex', width: '100%', alignItems: 'flex-start', gap: 10,
                padding: '10px 14px', background: '#fff', border: 'none',
                borderBottom: '1px solid rgba(6,182,212,.07)',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'background .12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(8,145,178,.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <span className="clm-code-pill" style={{ flexShrink: 0 }}>{c.code}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#0c4a6e' }}>{c.name}</span>
                  {c.clause_type && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 500, color: '#0891b2',
                      background: 'rgba(8,145,178,.08)', border: '1px solid rgba(8,145,178,.2)',
                      padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap',
                    }}>{c.clause_type}</span>
                  )}
                </div>
                <div style={{
                  fontSize: 11, color: '#94a3b8', lineHeight: 1.4,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {preview(c.content) || <em style={{ color: '#cbd5e1' }}>(no content)</em>}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3, opacity: .6 }}><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ))}
        </div>

        <div className="clm-modal-foot">
          <button className="clm-btn-cancel" onClick={onClose}>Cancel</button>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
            {!loading && `${filtered.length} clause${filtered.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
    </div>
  ), document.body);
}

