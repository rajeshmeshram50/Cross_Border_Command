import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import { type ReportRow } from './SourcingReportModal';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { useModalGuard } from './useModalGuard';
import BaseTooltip from '../../../../components/ui/Tooltip';
/* Themed by default so tooltips follow the active light/dark app theme
 * instead of the always-dark pill (QA #18) — same wrapper as the DCP /
 * consignee pages. */
const Tooltip = (props: ComponentProps<typeof BaseTooltip>) => <BaseTooltip themed {...props} />;
import { resolveFileUrl, downloadClarityFile } from '../../../../utils/resolveFileUrl';
import './bulk-sourcing.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Assign Sourcing Target — two-stage wizard.
 *  Stage 1: Sourcing Details (ID auto, start today, due date).
 *  Stage 2: Product Details — From Product Master (multiselect) OR Manual
 *           Entry, feeding a Product List with Masters/Manual tabs.
 * Data (products / team / edit pre-fill) comes from the backend — see API.md.
 * ───────────────────────────────────────────────────────────────────────── */

type Product = { code: string; name: string; segment: string; hsn: string };
type Member = { id: string; name: string; role: string };
const tInit = (n: string) => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

type Clarity = { type: 'text' | 'link' | 'pdf'; val: string } | null;
// id + mapped come from the edit pre-fill: `mapped` = the product already has a
// supplier mapped in the Sourcing Report, so it's locked (can't be removed).
type MasterRow = { id?: number; mapped?: boolean; code: string; name: string; segment: string; hsn: string; price: string; clarity?: Clarity };
type ManualRow = { id?: number; mapped?: boolean; name: string; price: string; clarity?: Clarity };

function ClarityBtn({ clarity, onClick }: { clarity?: Clarity; onClick: () => void }) {
  const set = !!clarity?.type;
  return (
    <button type="button" className={`ast-pl-clarity ${set ? 'is-set' : ''}`} onClick={onClick}>
      {set
        ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>}
      {set ? (clarity!.type.charAt(0).toUpperCase() + clarity!.type.slice(1)) : 'Add clarity'}
    </button>
  );
}

// Clarity cell — renders the saved clarity inline so the value is visible in
// the table: a PDF shows a download link, a link is clickable, text shows as a
// tooltip-truncated note. A small pencil re-opens the editor. When nothing is
// set yet, it falls back to the "Add clarity" button.
function ClarityCell({ clarity, onEdit, onRemovePdf, onUpdate }: { clarity?: Clarity; onEdit: () => void; onRemovePdf?: (path: string) => void; onUpdate?: () => void }) {
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null);
  if (!clarity?.type) return <ClarityBtn clarity={clarity} onClick={onEdit} />;
  const pdfs = clarity.type === 'pdf' && clarity.val ? clarity.val.split('\n').filter(Boolean) : [];
  return (
    <div className="ast-clarity-cell">
      <Tooltip label="Edit clarity"><button type="button" className="ast-clarity-edit" onClick={onEdit}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button></Tooltip>
      {clarity.type === 'pdf' ? (
        /* First PDF as a chip; when there are more, a "+N" opens a popover
           listing every PDF with Download / View / Delete. */
        <>
          <Tooltip label={pdfs.length > 1 ? `Download ${baseName(pdfs[0])}` : 'Download PDF specification'}>
            <button type="button" className="ast-clarity-chip is-pdf" onClick={() => downloadClarityFile(pdfs[0])}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              <span className="ast-clarity-chip-txt">{pdfs.length > 1 ? 'PDF 1' : 'Download PDF'}</span>
            </button>
          </Tooltip>
          {pdfs.length > 1 && (
            <button type="button" className="ast-clarity-more" onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setPop(p => p ? null : { x: b.left, y: b.bottom + 4 }); }}>+{pdfs.length - 1}</button>
          )}
          {pop && createPortal(
            <>
              <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 13000 }} />
              <div style={{ position: 'fixed', left: Math.max(8, Math.min(pop.x, window.innerWidth - 288)), top: Math.min(pop.y, window.innerHeight - 240), zIndex: 13001, width: 280, background: '#fff', border: '1px solid #cffafe', borderRadius: 12, boxShadow: '0 14px 34px rgba(13,148,136,.18), 0 4px 12px rgba(0,0,0,.08)', padding: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: '#0e7490', padding: '2px 6px 6px' }}>PDF Specifications ({pdfs.length})</div>
                <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {pdfs.map((path, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f7fcfd', border: '1px solid #e0f2f7', borderRadius: 9, padding: '5px 8px' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      <Tooltip label={baseName(path)}><span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseName(path)}</span></Tooltip>
                      <Tooltip label="Download"><button type="button" className="ast-clarity-pop-act dl" onClick={() => downloadClarityFile(path)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></button></Tooltip>
                      <Tooltip label="View"><a className="ast-clarity-pop-act view" href={resolveFileUrl(path)} target="_blank" rel="noopener noreferrer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg></a></Tooltip>
                      {onRemovePdf && (
                        <Tooltip label="Delete"><button type="button" className="ast-clarity-pop-act del" onClick={() => { onRemovePdf(path); if (pdfs.length <= 2) setPop(null); }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></Tooltip>
                      )}
                    </div>
                  ))}
                </div>
                {onUpdate && (
                  <button type="button" className="ast-clarity-pop-update" onClick={() => { onUpdate(); setPop(null); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    Update clarity
                  </button>
                )}
              </div>
            </>,
            document.body,
          )}
        </>
      ) : clarity.type === 'link' ? (
        <Tooltip label={clarity.val}>
          <a className="ast-clarity-chip is-link" href={clarity.val} target="_blank" rel="noopener noreferrer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            <span className="ast-clarity-chip-txt">Open link</span>
          </a>
        </Tooltip>
      ) : (
        <Tooltip label={clarity.val}>
          <span className="ast-clarity-chip is-text">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>
            <span className="ast-clarity-chip-txt">{clarity.val}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Slash display format e.g. "16/07/2026" (used for the read-only Start Date).
const fmtSlash = (s: string) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
// Keep only digits and a single decimal point — Target Price is numeric-only.
const numOnly = (v: string) => { const c = v.replace(/[^0-9.]/g, ''); const p = c.split('.'); return p.length > 2 ? `${p[0]}.${p.slice(1).join('')}` : c; };
// Clarity PDFs store a /storage/... path; show just the filename to the user.
const baseName = (p: string) => (p || '').split('/').pop() || p;
// A target price is invalid when blank, non-numeric, or ≤ 0.
const isBadPrice = (v: string) => { const num = parseFloat(String(v).replace(/,/g, '')); return !String(v).trim() || isNaN(num) || num <= 0; };
const LockIco = () => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;

export default function AssignSourcingTargetModal({ editRow = null, onClose, onSaved }: { editRow?: ReportRow | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast();
  const isEdit = !!editRow;
  const { pulse, guardOverlay } = useModalGuard();
  const [autoCode, setAutoCode] = useState('');
  const srcId = editRow?.id ?? autoCode;
  const start = useMemo(() => editRow?.start ?? today(), [editRow]);

  const [stage, setStage] = useState(1);
  const [due, setDue] = useState(editRow?.due ?? '');
  const [source, setSource] = useState<'master' | 'manual'>(editRow?.source === 'Manual Entry' ? 'manual' : 'master');
  const [masterRows, setMasterRows] = useState<MasterRow[]>([]);
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);
  // In edit mode the existing product rows load async — shimmer until they arrive.
  const [listLoading, setListLoading] = useState(!!editRow);
  const [picks, setPicks] = useState<string[]>([]);
  // Collapse the selected-product chips to a few + "+N" so a large selection
  // doesn't crowd the layout (QA #46). Toggled by the +N / Show less pill.
  const [picksExpanded, setPicksExpanded] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [listTab, setListTab] = useState<'master' | 'manual'>(editRow?.source === 'Manual Entry' ? 'manual' : 'master');
  const [mName, setMName] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [team, setTeam] = useState<string | null>(editRow?.assignee ?? null);
  // False once the current assignee goes Inactive/Exited — set from the edit
  // pre-fill. When false the whole target becomes view-only (no reassign).
  const [assigneeActive, setAssigneeActive] = useState(true);
  // The target's existing assignee id (edit only) — sent straight back on Update
  // since the assignee is fixed and may not be in the filtered team list.
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  // Assignee is always locked while editing (never reassigned).
  const assigneeLocked = isEdit;
  // Editing a target whose assignee went Inactive/Exited → read-only: the form
  // can be viewed but not changed, and a toast explains why.
  const viewOnly = isEdit && !assigneeActive;
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [clarity, setClarity] = useState<{ kind: 'master' | 'manual'; idx: number } | null>(null);
  const [clType, setClType] = useState<'text' | 'link' | 'pdf'>('text');
  const [clVal, setClVal] = useState('');
  const [clUploading, setClUploading] = useState(false);
  const [clProgress, setClProgress] = useState(0);   // 0-100 combined upload %
  const [clSaving, setClSaving] = useState(false);
  const [mAdding, setMAdding] = useState(false);
  const [teamAssigning, setTeamAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  // Inline-validation triggers: show red borders/messages only after the user
  // tries to advance (Next) / save (Assign), then live-clear as they fix fields.
  const [dueTried, setDueTried] = useState(false);
  const [priceTried, setPriceTried] = useState(false);

  // Freeze the background page while the wizard is open (same lock the other
  // Bulk Sourcing modals use). Without it the underlying list stays scrollable
  // and jumps back to the top during the assignment flow; locking overflow
  // pins the scroll position and restores it on close. Lock BOTH <html> and
  // <body> — body-only isn't enough here (the page scrolls on documentElement),
  // so the background still scrolled behind the popup (QA #47).
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // Reference data + edit pre-fill from the backend (see API.md).
  const [products, setProducts] = useState<Product[]>([]);
  const [teamMembers, setTeamMembers] = useState<Member[]>([]);
  useEffect(() => {
    api.get<{ data: Product[] }>('/p2p/products').then(r => setProducts(r.data?.data ?? [])).catch(() => {});
    api.get<{ data: Member[] }>('/p2p/team-members').then(r => setTeamMembers(r.data?.data ?? [])).catch(() => {});
    if (!editRow) api.get<{ data: { code: string } }>('/p2p/sourcing-targets/next-code').then(r => setAutoCode(r.data?.data?.code ?? 'Auto')).catch(() => {});
  }, []);
  useEffect(() => {
    if (!editRow) return;
    setListLoading(true);
    api.get<{ data: { masterRows?: MasterRow[]; manualRows?: ManualRow[]; assigneeActive?: boolean; assigneeId?: string | null } }>(`/p2p/sourcing-targets/${editRow.id}`)
      .then(r => {
        setMasterRows(r.data?.data?.masterRows ?? []);
        setManualRows(r.data?.data?.manualRows ?? []);
        setAssigneeId(r.data?.data?.assigneeId ?? null);
        const active = r.data?.data?.assigneeActive !== false;
        setAssigneeActive(active);
        if (!active) toast.info('View only', 'This sourcing target’s assignee is inactive or exited, so it can’t be edited — you can only view it.');
      })
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, [editRow]);

  const openClarity = (kind: 'master' | 'manual', idx: number) => {
    const row = kind === 'master' ? masterRows[idx] : manualRows[idx];
    setClType(row?.clarity?.type ?? 'text');
    setClVal(row?.clarity?.val ?? '');
    setClarity({ kind, idx });
  };
  const saveClarity = () => {
    if (!clarity) return;
    // Block saving while the PDF is still uploading — otherwise clVal is empty
    // and the clarity silently saves as "none".
    if (clUploading) { toast.warning('Upload in progress', 'Please wait for the file to finish uploading.'); return; }
    const linkVal = clVal.trim();
    if (clType === 'link' && linkVal) {
      // Reject spaces explicitly — a URL can't contain them, and `.+` used to
      // let them through so "http://exa mple.com" saved (QA #49).
      if (/\s/.test(linkVal)) {
        toast.warning('Invalid link', 'The link cannot contain spaces.');
        return;
      }
      if (!/^https?:\/\/\S+$/i.test(linkVal)) {
        toast.warning('Invalid link', 'Links must start with http:// or https://');
        return;
      }
    }
    const has = clType === 'pdf' ? !!clVal : !!clVal.trim();
    const c: Clarity = has ? { type: clType, val: clVal } : null;
    const target = clarity;
    // Brief loader so the save reads as a deliberate action, then confirm.
    setClSaving(true);
    setTimeout(() => {
      if (target.kind === 'master') setMasterRows(rows => rows.map((x, i) => i === target.idx ? { ...x, clarity: c } : x));
      else setManualRows(rows => rows.map((x, i) => i === target.idx ? { ...x, clarity: c } : x));
      setClSaving(false);
      setClarity(null);
      toast.success(c ? 'Clarity saved' : 'Clarity cleared', c ? `${c.type.charAt(0).toUpperCase() + c.type.slice(1)} added to the product.` : 'Removed the clarity from this product.');
    }, 500);
  };
  // Upload a clarity PDF and keep its /storage/... path in clVal (saveClarity
  // then stores it on the row). Previously only the filename was kept, so the
  // file was never persisted.
  // Upload one or MORE clarity PDFs; their /storage/… paths are appended to
  // clVal (newline-joined) so a product can carry several PDF specs at once.
  const uploadClarity = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setClUploading(true);
    setClProgress(0);
    // Combined progress across every file being uploaded → one 0-100% number.
    const loaded = new Array(arr.length).fill(0);
    const total = arr.map(f => f.size || 0);
    const bump = () => {
      const l = loaded.reduce((a, b) => a + b, 0);
      const t = total.reduce((a, b) => a + b, 0);
      setClProgress(t > 0 ? Math.min(100, Math.round((l / t) * 100)) : 0);
    };
    // Override the api default of application/json with undefined so axios emits
    // the proper `multipart/form-data; boundary=...`. A bare 'multipart/form-data'
    // strips the boundary and PHP can't parse the upload (esp. on mobile).
    Promise.all(arr.map((f, idx) => {
      const fd = new FormData(); fd.append('file', f); fd.append('kind', 'clarity');
      return api.post<{ data: { path: string } }>('/p2p/upload', fd, {
        headers: { 'Content-Type': undefined as unknown as string },
        onUploadProgress: (e) => { loaded[idx] = e.loaded; if (e.total) total[idx] = e.total; bump(); },
      }).then(r => r.data?.data?.path ?? '');
    }))
      .then(paths => {
        const clean = paths.filter(Boolean);
        // Newest-first: prepend the just-uploaded files so the latest shows on top.
        if (clean.length) setClVal(prev => [...clean, ...(prev ? prev.split('\n').filter(Boolean) : [])].join('\n'));
      })
      .catch((err) => toast.error('Upload failed', err?.response?.data?.message || 'Could not upload the PDF(s).'))
      .finally(() => { setClUploading(false); setClProgress(0); });
  };
  // Drop one PDF from the clarity list (by path).
  const removeClarityPdf = (path: string) => setClVal(prev => prev.split('\n').filter(p => p && p !== path).join('\n'));
  // Drop one PDF from a ROW's saved clarity (from the Product List "+N" popover),
  // without opening the editor. Clears the clarity entirely when the last one goes.
  const removeRowClarityPdf = (kind: 'master' | 'manual', idx: number, path: string) => {
    const upd = <T extends { clarity?: Clarity }>(rows: T[]): T[] => rows.map((x, i) => {
      if (i !== idx || x.clarity?.type !== 'pdf') return x;
      const rest = (x.clarity.val || '').split('\n').filter(p => p && p !== path);
      return { ...x, clarity: rest.length ? { type: 'pdf' as const, val: rest.join('\n') } : null };
    });
    if (kind === 'master') setMasterRows(upd); else setManualRows(upd);
  };
  // Persist a single product's clarity to the DB straight away (the popover's
  // "Update" button) — no need to re-save the whole target. Edit-mode only: a
  // brand-new (unsaved) row has no product id yet.
  const persistRowClarity = async (kind: 'master' | 'manual', idx: number) => {
    const row = kind === 'master' ? masterRows[idx] : manualRows[idx];
    if (!editRow || !row?.id) {
      toast.info('Save the target first', 'Click Update Target once, then you can update this clarity directly.');
      return;
    }
    try {
      await api.put(`/p2p/sourcing-targets/${editRow.id}/products/${row.id}/clarity`, {
        clarity_type: row.clarity?.type ?? null,
        clarity_value: row.clarity?.val ?? null,
      });
      toast.success('Clarity updated', 'Saved to this product.');
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not save the clarity.');
    }
  };
  const clarityTitle = clarity ? (clarity.kind === 'master' ? `${masterRows[clarity.idx]?.code} — ${masterRows[clarity.idx]?.name}` : manualRows[clarity.idx]?.name) : '';

  const teamList = teamMembers.filter(m => { const q = teamSearch.toLowerCase(); return !q || (m.name + ' ' + m.role).toLowerCase().includes(q); });
  const openTeam = () => { setTeamPick(teamMembers.find(m => m.name === team)?.id ?? null); setTeamSearch(''); setTeamOpen(true); };
  const togglePick = (code: string) => setPicks(p => p.includes(code) ? p.filter(c => c !== code) : [...p, code]);
  const addMaster = () => {
    if (!picks.length) { toast.warning('Pick products', 'Choose one or more products first.'); return; }
    const have = new Set(masterRows.map(r => r.code));
    const fresh = picks.filter(c => !have.has(c));
    if (!fresh.length) { toast.info('Already added', 'The selected product(s) are already in the list.'); setPicks([]); return; }
    const add = fresh.map(c => { const p = products.find(x => x.code === c)!; return { code: p.code, name: p.name, segment: p.segment, hsn: p.hsn, price: '' }; });
    setMasterRows(rows => [...rows, ...add]);
    setPicks([]); setListTab('master');
    toast.success('Added', `${add.length} product${add.length > 1 ? 's' : ''} added to the list.`);
  };
  const addManual = () => {
    if (!mName.trim()) { toast.warning('Product name', 'Please enter a product name.'); return; }
    if (!mPrice.trim()) { toast.warning('Target price', 'Please enter a target price.'); return; }
    const num = parseFloat(mPrice.replace(/,/g, ''));
    if (isNaN(num) || num <= 0) { toast.warning('Invalid price', 'Target price must be a positive number.'); return; }
    if (manualRows.some(r => r.name.trim().toLowerCase() === mName.trim().toLowerCase())) { toast.warning('Duplicate product', 'That product is already in the manual list.'); return; }
    const name = mName.trim(); const price = mPrice.trim();
    setMAdding(true);
    setTimeout(() => {
      setManualRows(rows => [...rows, { name, price }]);
      setMName(''); setMPrice(''); setListTab('manual');
      setMAdding(false);
      toast.success('Product added', 'Product added successfully.');
    }, 500);
  };
  const goAssign = () => {
    if (viewOnly) { toast.info('View only', 'This sourcing target’s assignee is inactive or exited — it can’t be edited.'); return; }
    setPriceTried(true);
    const n = masterRows.length + manualRows.length;
    if (!n) { toast.warning('Add products', 'Add at least one product to the list.'); return; }
    // Jump straight to the FIRST product whose target price is missing/invalid —
    // check Master rows first, then Manual — switching to its tab and scrolling
    // it into focus. Fixes the case where the offending product sits on the
    // other tab (e.g. saving from Manual while a Master row has no price): the
    // user is taken there and its red validation border is shown.
    const firstBadMaster = masterRows.findIndex(r => isBadPrice(r.price));
    const firstBadManual = manualRows.findIndex(r => isBadPrice(r.price));
    if (firstBadMaster !== -1 || firstBadManual !== -1) {
      const kind = firstBadMaster !== -1 ? 'master' : 'manual';
      const idx  = firstBadMaster !== -1 ? firstBadMaster : firstBadManual;
      setListTab(kind);
      toast.warning('Target price required', 'Every product needs a valid target price — jumped to the first one that needs it.');
      setTimeout(() => {
        const el = document.getElementById(`ast-price-${kind}-${idx}`) as HTMLInputElement | null;
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
      }, 80);
      return;
    }
    // On edit the assignee is fixed — reuse its id from the pre-fill (it may not
    // be in the filtered team list). New targets resolve the pick by name.
    const resolvedAssigneeId = (isEdit ? assigneeId : null) ?? teamMembers.find(m => m.name === team)?.id ?? null;
    if (!resolvedAssigneeId) { toast.warning('Assign required', 'Assign this sourcing target to a team member before saving.'); return; }
    const body = {
      due_date: due, source,
      assignee_id: resolvedAssigneeId,
      products: [
        ...masterRows.map(r => ({ id: r.id ?? null, from: 'master', code: r.code, target_price: r.price, clarity: r.clarity ?? null })),
        ...manualRows.map(r => ({ id: r.id ?? null, from: 'manual', name: r.name, target_price: r.price, clarity: r.clarity ?? null })),
      ],
    };
    setSaving(true);
    const req = isEdit
      ? api.put(`/p2p/sourcing-targets/${editRow!.id}`, body)
      : api.post('/p2p/sourcing-targets', body);
    req
      .then(() => { toast.success(isEdit ? 'Sourcing target updated' : 'Sourcing target assigned', `${n} product(s).`); onSaved?.(); onClose(); })
      .catch((err) => {
        const errors = err?.response?.data?.errors as Record<string, string[]> | undefined;
        const msg = err?.response?.data?.message || (errors && Object.values(errors)[0]?.[0]);
        toast.error('Save failed', msg || 'Please try again.');
      })
      .finally(() => setSaving(false));
  };

  const pickList = products
    .filter(p => { const q = pickQuery.toLowerCase(); return !q || (p.code + ' ' + p.name).toLowerCase().includes(q); })
    // Descending by product code (P-003, P-002, P-001…). numeric:true so
    // P-010 sorts above P-002. .filter() already returned a fresh array, so
    // this sort doesn't mutate the source `products`.
    .sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));

  return createPortal(
    <div className="ast-ov" onMouseDown={guardOverlay}>
      <div className={`ast-modal${pulse ? ' bsm-pulse' : ''}`} role="dialog" aria-modal="true" style={{ position: 'relative' }}>
        {/* Save lock — blankets the whole form while the target is being
            saved/updated so no field or button can be touched mid-save (and
            no double-submit). Clears when the request settles. */}
        {saving && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.68)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', cursor: 'progress', borderRadius: 'inherit' }}>
            <svg className="ast-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0e7490', letterSpacing: 0.2 }}>{isEdit ? 'Saving changes…' : 'Assigning…'}</span>
          </div>
        )}
        {/* Header */}
        <div className="ast-head">
          <div className="ast-head-ico" style={isEdit ? { background: 'linear-gradient(135deg,#0891b2,#0e7490)' } : undefined}>
            {isEdit
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
          </div>
          <div style={{ flex: 1 }}><div className="ast-title">{isEdit ? `Edit Sourcing Target — ${srcId}` : 'Assign Sourcing Target'}</div><div className="ast-sub">{isEdit ? 'Update sourcing details and product list.' : 'Create a sourcing target across products.'}</div></div>
          <Tooltip label={viewOnly ? 'Assignee is inactive/exited — view only' : (assigneeLocked ? 'Assignee is locked once the target is created' : undefined)}><button className={`ast-head-btn ${team ? 'is-set' : ''}`} style={assigneeLocked ? { cursor: 'not-allowed' } : undefined} onClick={() => { if (viewOnly) { toast.info('View only', 'This sourcing target’s assignee is inactive or exited — it can’t be edited.'); return; } if (assigneeLocked) { toast.info('Assignee locked', 'The assignee is fixed once a sourcing target is created — it can’t be changed while editing.'); return; } openTeam(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            <span>{team || 'Assign to Team Member'}</span>
          </button></Tooltip>
          <button className="ast-close" onClick={onClose}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          <span className="ast-head-accent" />
        </div>

        {/* Stepper */}
        <div className="ast-steps">
          <div className={`ast-scard ${stage === 1 ? 'is-current' : ''} ${stage > 1 ? 'is-done' : ''}`}>
            <span className="ast-scard-glow" />
            <div className="ast-scard-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div>
            <div className="ast-scard-txt"><div className="ast-scard-stage">Stage 1</div><div className="ast-scard-name">Sourcing Details</div><div className="ast-scard-desc">ID, dates &amp; timeline</div></div>
            <div className="ast-scard-badge">{stage > 1 ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : '1'}</div>
          </div>
          <span className={`ast-scard-link ${stage > 1 ? 'is-done' : ''}`} />
          <div className={`ast-scard ${stage === 2 ? 'is-current' : ''}`}>
            <span className="ast-scard-glow" />
            <div className="ast-scard-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></div>
            <div className="ast-scard-txt"><div className="ast-scard-stage">Stage 2</div><div className="ast-scard-name">Product Details</div><div className="ast-scard-desc">Products, price &amp; clarity</div></div>
            <div className="ast-scard-badge">2</div>
          </div>
        </div>

        {/* Body */}
        {/* View-only: the assignee is Inactive/Exited, so the whole form is
            shown but non-interactive (pointer-events off, slightly dimmed). */}
        <div className="ast-body" style={viewOnly ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
          {stage === 1 ? (
            <div className="ast-srccard">
              <div className="ast-srccard-head">
                <span className="ast-srccard-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></span>
                <div className="ast-srccard-htxt"><b>Sourcing Details</b><small>Identification and timeline for this sourcing</small></div>
                <span className="ast-srccard-tag" style={isEdit ? { background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', borderColor: 'transparent' } : undefined}><span className="ast-srccard-dot" style={isEdit ? { background: '#fff', boxShadow: 'none' } : undefined} />{isEdit ? 'Edit Mode' : 'New'}</span>
              </div>
              <div className="ast-srccard-body">
                <div className="ast-srcgrid">
                  <div className="ast-field">
                    <label>Sourcing ID <span className="ast-lock"><LockIco /> Auto</span></label>
                    <div className="ast-inputwrap is-frozen"><span className="ast-input-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg></span><input type="text" value={srcId || 'Generating…'} readOnly tabIndex={-1} className="ast-readonly has-ico" /><span className="ast-freeze-ico"><LockIco /></span></div>
                  </div>
                  <div className="ast-srcgrid-sep" />
                  <div className="ast-field">
                    <label>Start Date {!isEdit && <span className="ast-lock"><LockIco /> Today</span>}</label>
                    <div className="ast-inputwrap is-frozen"><span className="ast-input-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></span><input type="text" value={fmtSlash(start)} readOnly tabIndex={-1} className="ast-readonly has-ico" /><span className="ast-freeze-ico"><LockIco /></span></div>
                  </div>
                  <div className="ast-srcgrid-sep" />
                  <div className="ast-field">
                    <label>Due Date <span className="ast-req">*</span></label>
                    <MasterDatePicker value={due} onChange={setDue} minDate={start} placeholder="Select due date" invalid={dueTried && !due} />
                    {dueTried && !due && <div style={{ color: '#ef4444', fontSize: 11, fontWeight: 600, marginTop: 5 }}>Due date is required.</div>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="ast-srccard">
                <div className="ast-srccard-head ast-srccard-head--teal">
                  <span className="ast-srccard-ico ast-srccard-ico--teal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg></span>
                  <div className="ast-srccard-htxt"><b>Product Details</b><small>Choose how to add products</small></div>
                  <span className="ast-srccard-tag ast-srccard-tag--teal"><span className="ast-srccard-dot ast-srccard-dot--teal" />Step 2</span>
                </div>
                <div className="ast-srccard-body">
                  {/* Source is switchable in edit too, so the user can append
                      products from either Product Master or Manual Entry. */}
                  <div className="ast-field" style={{ marginBottom: 11, gap: 2 }}>
                    <label>I want to source from <span className="ast-req">*</span></label>
                    <div className="ast-radios">
                      <label className={`ast-radio ${source === 'master' ? 'is-sel' : ''}`} onClick={() => { setSource('master'); setListTab('master'); }}><span className="ast-radio-dot" /><span className="ast-radio-txt"><b>From Product Master</b><small>Pick existing products</small></span></label>
                      <label className={`ast-radio ${source === 'manual' ? 'is-sel' : ''}`} onClick={() => { setSource('manual'); setListTab('manual'); }}><span className="ast-radio-dot" /><span className="ast-radio-txt"><b>Manual Product Entry</b><small>Type a new product</small></span></label>
                    </div>
                  </div>

                  {source === 'master' ? (
                    <div className="ast-field">
                      <label>Select Products <span className="ast-hint">(choose one or more, then click Add)</span></label>
                      <div className="asrc-picker">
                        <div className="asrc-pick-chips">
                          {picks.length === 0 ? <span className="asrc-pick-ph">No products chosen yet</span> : (() => {
                            // Show the first few chips; collapse the rest into a
                            // clickable "+N more" pill so a big selection stays tidy.
                            const CHIP_CAP = 6;
                            const shown = picksExpanded ? picks : picks.slice(0, CHIP_CAP);
                            const extra = picks.length - shown.length;
                            return <>
                              {shown.map(code => {
                                const p = products.find(x => x.code === code); if (!p) return null;
                                return <span className="ast-ms-chip" key={code}>{p.code} — {p.name}<button type="button" onClick={() => togglePick(code)}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button></span>;
                              })}
                              {extra > 0 && (
                                <button type="button" className="ast-ms-chip" style={{ cursor: 'pointer', fontWeight: 700 }} title={`Show all ${picks.length} selected products`} onClick={() => setPicksExpanded(true)}>+{extra} more</button>
                              )}
                              {picksExpanded && picks.length > CHIP_CAP && (
                                <button type="button" className="ast-ms-chip" style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setPicksExpanded(false)}>Show less</button>
                              )}
                            </>;
                          })()}
                        </div>
                        <div className="asrc-pick-search">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                          <input type="text" value={pickQuery} placeholder="Search products..." onChange={e => setPickQuery(e.target.value)} onFocus={() => setPickOpen(true)} onBlur={() => setTimeout(() => setPickOpen(false), 180)} />
                          <button type="button" className="ast-btn ast-btn-primary asrc-pick-add" onClick={addMaster}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add</button>
                          <div className={`asrc-pick-list ${pickOpen ? 'is-open' : ''}`}>
                            {pickList.length === 0 ? <div className="ast-plist-empty" style={{ border: 'none', background: 'none' }}>No matching products</div> : pickList.map(p => {
                              const picked = picks.includes(p.code);
                              const added = masterRows.some(r => r.code === p.code);
                              return (
                                <button type="button" key={p.code} className={`asrc-pick-opt ${picked ? 'is-sel' : ''} ${added ? 'is-added' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => { if (!added) togglePick(p.code); }}>
                                  <span className="asrc-pick-check">{(picked || added) && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}</span>
                                  <span className="asrc-pick-txt"><b>{p.code}</b> — {p.name}{added && <i> (added)</i>}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="ast-grid ast-grid-3">
                      <div className="ast-field"><label>Product Name <span className="ast-req">*</span></label><input type="text" value={mName} placeholder="e.g. Office Printer A4" onChange={e => setMName(e.target.value)} /></div>
                      <div className="ast-field"><label>Target Price (₹) <span className="ast-req">*</span></label><input type="text" inputMode="decimal" value={mPrice} placeholder="e.g. 10000" onChange={e => setMPrice(numOnly(e.target.value))} /></div>
                      <div className="ast-field"><label>&nbsp;</label><button type="button" className="ast-btn ast-btn-primary" style={{ height: 42, justifyContent: 'center' }} onClick={addManual} disabled={mAdding}>{mAdding ? <><svg className="ast-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Adding…</> : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add to List</>}</button></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Product List */}
              <div className="ast-srccard">
                <div className="ast-srccard-head ast-srccard-head--teal">
                  <span className="ast-srccard-ico ast-srccard-ico--teal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg></span>
                  <div className="ast-srccard-htxt"><b>Product List</b><small>Mapped products for this sourcing</small></div>
                  <div className="asrc-listtabs">
                    <button type="button" className={`asrc-ltab ${listTab === 'master' ? 'is-active' : ''}`} onClick={() => setListTab('master')}>Masters <span className="asrc-ltab-c">{masterRows.length}</span></button>
                    <button type="button" className={`asrc-ltab ${listTab === 'manual' ? 'is-active' : ''}`} onClick={() => setListTab('manual')}>Manual <span className="asrc-ltab-c">{manualRows.length}</span></button>
                  </div>
                </div>
                <div className="ast-srccard-body">
                  {listLoading ? (
                    <div className="ast-plist" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Array.from({ length: 3 }).map((_, i) => <span className="bsm-sk" key={i} style={{ width: '100%', height: 40, borderRadius: 8 }} />)}
                    </div>
                  ) : listTab === 'master' ? (
                    masterRows.length === 0 ? <div className="ast-plist-empty">No master products added yet. Select from the dropdown above and click Add.</div> : (
                      <div className="ast-plist">
                        <div className="asrc-row asrc-row--head asrc-row--m"><span>Sr</span><span>Product Code</span><span>Product Name</span><span>Segment</span><span>HSN Code</span><span>Target Price (₹) <b className="asrc-th-req">*</b></span><span>Clarity <i className="asrc-th-opt">(optional)</i></span><span>Action</span></div>
                        {masterRows.map((r, i) => (
                          <div className="asrc-row asrc-row--m" key={r.code}>
                            <span className="asrc-sr" data-label="Sr">{i + 1}</span>
                            <span className="asrc-code" data-label="Product Code">{r.code}</span>
                            <span data-label="Product Name"><Tooltip label={r.name}><span className="asrc-name">{r.name}</span></Tooltip></span>
                            <span data-label="Segment"><span className={`srpt-seg ${(r.segment || 'General').replace(/ /g, '-')}`}>{r.segment}</span></span>
                            <span className="asrc-hsn" data-label="HSN Code"><span className="srpt-hsn">{r.hsn}</span></span>
                            <span data-label="Target Price (₹)"><input id={`ast-price-master-${i}`} type="text" className="ast-pl-price" style={priceTried && isBadPrice(r.price) ? { borderColor: '#ef4444', background: 'rgba(239,68,68,.06)' } : undefined} value={r.price} placeholder="e.g. 10000" inputMode="decimal" onChange={e => setMasterRows(rows => rows.map((x, xi) => xi === i ? { ...x, price: numOnly(e.target.value) } : x))} /></span>
                            <span data-label="Clarity"><ClarityCell clarity={r.clarity} onEdit={() => openClarity('master', i)} onRemovePdf={(path) => removeRowClarityPdf('master', i, path)} onUpdate={isEdit && r.id ? () => persistRowClarity('master', i) : undefined} /></span>
                            <span data-label=""><Tooltip label={r.mapped ? 'Mapped to a supplier — can’t be removed' : 'Delete'}><button type="button" className="ast-pl-del" style={r.mapped ? { opacity: 0.4, cursor: 'not-allowed' } : undefined} onClick={() => { if (r.mapped) { toast.info('Can’t remove product', `“${r.name}” is mapped to a supplier in the Sourcing Report. Unmap its suppliers there first.`); return; } setMasterRows(rows => rows.filter((_, xi) => xi !== i)); toast.success('Product removed', `“${r.name || 'Product'}” has been removed from the list.`); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></Tooltip></span>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    manualRows.length === 0 ? <div className="ast-plist-empty">No manual products added yet. Fill the fields above and click Add to List.</div> : (
                      <div className="ast-plist">
                        <div className="asrc-row asrc-row--head asrc-row--n"><span>Sr</span><span>Product Name</span><span>Target Price (₹) <b className="asrc-th-req">*</b></span><span>Clarity <i className="asrc-th-opt">(optional)</i></span><span>Action</span></div>
                        {manualRows.map((r, i) => (
                          <div className="asrc-row asrc-row--n" key={i}>
                            <span className="asrc-sr" data-label="Sr">{i + 1}</span>
                            <span data-label="Product Name"><input type="text" className="ast-pl-price" style={{ fontWeight: 600 }} value={r.name} onChange={e => setManualRows(rows => rows.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} /></span>
                            <span data-label="Target Price (₹)"><input id={`ast-price-manual-${i}`} type="text" className="ast-pl-price" style={priceTried && isBadPrice(r.price) ? { borderColor: '#ef4444', background: 'rgba(239,68,68,.06)' } : undefined} value={r.price} placeholder="e.g. 10000" inputMode="decimal" onChange={e => setManualRows(rows => rows.map((x, xi) => xi === i ? { ...x, price: numOnly(e.target.value) } : x))} /></span>
                            <span data-label="Clarity"><ClarityCell clarity={r.clarity} onEdit={() => openClarity('manual', i)} onRemovePdf={(path) => removeRowClarityPdf('manual', i, path)} onUpdate={isEdit && r.id ? () => persistRowClarity('manual', i) : undefined} /></span>
                            <span data-label=""><Tooltip label={r.mapped ? 'Mapped to a supplier — can’t be removed' : 'Delete'}><button type="button" className="ast-pl-del" style={r.mapped ? { opacity: 0.4, cursor: 'not-allowed' } : undefined} onClick={() => { if (r.mapped) { toast.info('Can’t remove product', `“${r.name}” is mapped to a supplier in the Sourcing Report. Unmap its suppliers there first.`); return; } setManualRows(rows => rows.filter((_, xi) => xi !== i)); toast.success('Product removed', `“${r.name || 'Product'}” has been removed from the list.`); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></Tooltip></span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="ast-foot">
          {stage === 1 ? (
            <>
              <button className="ast-btn ast-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="ast-btn ast-btn-primary" onClick={() => { setDueTried(true); if (!due) { toast.warning('Due date required', 'Select a due date to continue.'); return; } setStage(2); }}>Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
            </>
          ) : (
            <>
              <button className="ast-btn ast-btn-ghost" onClick={() => setStage(1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg> Previous</button>
              <button className="ast-btn ast-btn-primary" onClick={goAssign} disabled={saving || viewOnly} style={viewOnly ? { cursor: 'not-allowed', opacity: 0.55 } : undefined}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> {saving ? 'Saving…' : (viewOnly ? 'View Only' : (isEdit ? 'Update Target' : 'Assign Target'))}</button>
            </>
          )}
        </div>
      </div>

      {/* Assign to Team Member — single-select picker */}
      {teamOpen && (
        <div className="astp-ov" onClick={e => { if (e.target === e.currentTarget) setTeamOpen(false); }}>
          <div className="astp-pop" role="dialog" aria-modal="true">
            <div className="astp-head">
              <div className="astp-head-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
              <div style={{ flex: 1 }}><div className="astp-title">Assign to Team Member</div><div className="astp-sub">Select one team member for this sourcing</div></div>
              <button className="astp-close" onClick={() => setTeamOpen(false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div className="astp-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="text" value={teamSearch} placeholder="Search by name or role..." onChange={e => setTeamSearch(e.target.value)} />
            </div>
            <div className="astp-body">
              {teamList.length === 0 ? <div className="astp-empty">No team members match your search.</div> : teamList.map(m => (
                <button type="button" key={m.id} className={`astp-row ${teamPick === m.id ? 'is-sel' : ''}`} onClick={() => setTeamPick(p => p === m.id ? null : m.id)}>
                  <span className="astp-av">{tInit(m.name)}</span>
                  <span className="astp-main"><span className="astp-name">{m.name}</span><span className="astp-role">{m.role}</span></span>
                  <span className="astp-check">{teamPick === m.id ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="16 9 11 14 8.5 11.5" /></svg> : <span className="astp-radio" />}</span>
                </button>
              ))}
            </div>
            <div className="astp-foot">
              <button className="ast-btn ast-btn-ghost" onClick={() => setTeamOpen(false)} disabled={teamAssigning}>Cancel</button>
              <button className="ast-btn ast-btn-primary" disabled={!teamPick || teamAssigning} onClick={() => {
                const m = teamMembers.find(x => x.id === teamPick);
                if (!m) return;
                // Brief loader before closing — a direct close felt abrupt.
                setTeamAssigning(true);
                setTimeout(() => {
                  setTeam(m.name);
                  setTeamAssigning(false);
                  setTeamOpen(false);
                  toast.success('Team member assigned', `${m.name} has been assigned to this sourcing successfully.`);
                }, 500);
              }}>
                {teamAssigning
                  ? <><svg className="ast-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Assigning…</>
                  : 'Assign Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Clarity popup */}
      {clarity && (
        <div className="astp-ov" onClick={e => { if (e.target === e.currentTarget && !clSaving && !clUploading) setClarity(null); }}>
          <div className="astp-pop" style={{ maxWidth: 440, position: 'relative' }}>
            {/* Save/upload lock — blankets the whole form so no field, tab or
                button (incl. Text/Link/PDF switch, Cancel, close) can be touched
                while the clarity is saving or a PDF is uploading. */}
            {(clSaving || clUploading) && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 11, alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', cursor: 'progress', borderRadius: 'inherit' }}>
                {clUploading ? (
                  // Circular progress ring with the live upload percentage.
                  <div style={{ position: 'relative', width: 52, height: 52 }}>
                    <svg width="52" height="52" viewBox="0 0 52 52">
                      <circle cx="26" cy="26" r="22" fill="none" stroke="#d5eef4" strokeWidth="5" />
                      <circle cx="26" cy="26" r="22" fill="none" stroke="#0891b2" strokeWidth="5" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 22}
                        strokeDashoffset={2 * Math.PI * 22 * (1 - clProgress / 100)}
                        transform="rotate(-90 26 26)"
                        style={{ transition: 'stroke-dashoffset .2s ease' }} />
                    </svg>
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#0e7490' }}>{clProgress}%</span>
                  </div>
                ) : (
                  <svg className="ast-spin" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                )}
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0e7490', letterSpacing: 0.2 }}>{clUploading ? `Uploading… ${clProgress}%` : 'Saving…'}</span>
              </div>
            )}
            <div className="astp-head">
              <div className="astp-head-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></div>
              <div><div className="astp-title">Product Clarity</div><div className="astp-sub">{clarityTitle}</div></div>
              <button className="astp-close" onClick={() => setClarity(null)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div style={{ padding: 14 }}>
              <div className="ast-tabs">
                {(['text', 'link', 'pdf'] as const).map(t => (
                  <button key={t} type="button" className={`ast-tab ${clType === t ? 'is-active' : ''}`} onClick={() => { setClType(t); setClVal(''); }}>{t === 'pdf' ? 'PDF' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              <div className="ast-clarity-body">
                {clType === 'text' && <textarea value={clVal} placeholder="Add notes or specs..." onChange={e => setClVal(e.target.value)} />}
                {clType === 'link' && <input type="text" value={clVal} placeholder="https://... reference link" onChange={e => setClVal(e.target.value)} />}
                {clType === 'pdf' && (
                  <div className="ast-pdf-list">
                    {/* Upload control ON TOP — add one or more PDFs, repeatable. */}
                    <label className="ast-pdf">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      <span>{clUploading ? 'Uploading…' : (clVal ? 'Add another PDF' : 'Click to upload PDF specification(s)')}</span>
                      <input type="file" accept="application/pdf" multiple disabled={clUploading} onChange={e => { if (e.target.files?.length) uploadClarity(e.target.files); e.target.value = ''; }} />
                    </label>
                    {/* Uploaded PDFs listed BELOW — each with Download + Delete.
                        Shows ~3 rows, the rest scroll (so the modal stays compact
                        no matter how many are attached). */}
                    {(() => {
                      const files = clVal ? clVal.split('\n').filter(Boolean) : [];
                      if (!files.length) return null;
                      return (
                        <div className="ast-pdf-files-scroll">
                          {files.map((path, i) => (
                            <div className="ast-pdf-file" key={i}>
                              <span className="ast-pdf-file-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></span>
                              <Tooltip label={baseName(path)}><span className="ast-pdf-file-name">{baseName(path)}</span></Tooltip>
                              <Tooltip label="Download PDF"><button type="button" className="ast-pdf-dl" onClick={() => downloadClarityFile(path)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></button></Tooltip>
                              <Tooltip label="Delete this PDF"><button type="button" className="ast-pdf-del" onClick={() => removeClarityPdf(path)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg></button></Tooltip>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 14 }}>
                <button className="ast-btn ast-btn-ghost" onClick={() => setClarity(null)}>Cancel</button>
                <button className="ast-btn ast-btn-primary" onClick={saveClarity} disabled={clUploading || clSaving}>
                  {clUploading
                    ? <><svg className="ast-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Uploading…</>
                    : clSaving
                      ? <><svg className="ast-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> Saving…</>
                      : 'Save Clarity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
