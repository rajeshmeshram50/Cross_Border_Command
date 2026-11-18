import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { todayIso, type DraftProduct, type SourcingTarget, type SourceType } from './data';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { useSaveGuard } from './useSaveGuard';
import { dmy } from './format';
import { usePopup } from './popupHooks';
import ClipText from './ClipText';
import ClarityDialog, { clarityPreview, type Clarity } from './ClarityDialog';
import { clarityPaths, viewDocument } from './targetProducts';
import ClarityNoteView from './ClarityNoteView';
import { apiErrorMessage, apiFieldErrors } from './apiError';
import { uploadP2pFile } from './upload';
import './popup-shell.css';
import './assign-target-modal.css';
import { IcoCal, IcoCheck, IcoEdit, IcoPlus, IcoSearch, IcoUsers, IcoX, Svg } from './icons';

/** Product List rows shown before the list scrolls inside the popup. */
const PLIST_ROWS = 4;

/* Assign / Edit Sourcing Target popup, built element for element from the Figma (sta-* / stsrc-*
   classes). Data (see the Postman collection "P2P · Sourcing Management Tracker"):
     GET  /p2p/products                 → Select Products
     GET  /p2p/team-members             → Assign To
     GET  /p2p/sourcing-targets/next-code → the ID card (Add)
     GET  /p2p/sourcing-targets/{id}    → the form (Edit)
     POST /p2p/upload (kind = clarity)  → a clarity document, uploaded on save
     POST /p2p/sourcing-targets · PUT /p2p/sourcing-targets/{id} → save
   Edit rules from the API: the assignee is fixed, the source is locked, a product that already has
   suppliers mapped cannot be removed, and a target whose assignee is inactive is view-only. */

type Props = {
  /** Edit mode: pass the row. Add mode: leave out. */
  initial?: SourcingTarget;
  onClose: () => void;
  /** Called after the server saved the target. */
  onSaved: (r: { code: string; count: number; assignee: string; isEdit: boolean }) => void;
};

type MasterProduct = { code: string; name: string; segment: string; hsn: string };
type Member = { id: string | number; name: string; role?: string | null };
type ApiClarity = { type: 'text' | 'link' | 'pdf'; val: string } | null;
type EditRow = { id: number; mapped?: boolean; code?: string; name: string; segment?: string | null; hsn?: string | null; price?: string | number | null; clarity?: ApiClarity };
type EditLoad = {
  id: string; source?: string; start?: string; due?: string;
  assignee?: string; assigneeId?: string | null; assigneeActive?: boolean;
  masterRows?: EditRow[]; manualRows?: EditRow[];
};

/** "18,500" → "18500": the server keeps the price as typed; the input holds plain digits. */
const plainPrice = (v: unknown) => String(v ?? '').replace(/,/g, '');
const toClarity = (c?: ApiClarity): Clarity | undefined => (c && c.val ? { type: c.type, value: c.val } : undefined);

const IcoCheckBox = ({ size = 14 }: { size?: number }) => <Svg size={size} stroke="#fff"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Svg>;
const IcoLock = ({ size = 12 }: { size?: number }) => <Svg size={size} sw={2.5}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
/** A saved clarity's chip, by type: the note (hover shows it), the link (opens it) or the document
    (opens it in a new tab — a picked file straight away, a stored one through the API). */
function ClarityOpen({ c, onViewNote }: { c: Clarity; onViewNote: () => void }) {
  const toast = useToast();
  if (c.type === 'text') {
    return (
      <Tooltip label={c.value.length > 60 ? `${c.value.slice(0, 60).trimEnd()}…` : c.value}>
        <button type="button" className="sta-cla-open is-text" onClick={onViewNote} aria-label="Read the clarity note">
          <Svg size={11} sw={2.4}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></Svg>
          Text note
        </button>
      </Tooltip>
    );
  }
  if (c.type === 'link') {
    return (
      <Tooltip label={c.value}>
        <a className="sta-cla-open is-link" href={c.value} target="_blank" rel="noopener noreferrer">
          <Svg size={11} sw={2.4}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></Svg>
          Open link
        </a>
      </Tooltip>
    );
  }
  const paths = c.file ? [] : clarityPaths(c);
  const src: File | string | undefined = c.file ?? paths[0];
  const more = paths.length > 1 ? paths.length - 1 : 0;
  return (
    <Tooltip label={clarityPreview(c)}>
      <button type="button" className="sta-cla-open is-pdf" disabled={!src}
        onClick={() => { if (src) viewDocument(src).catch(() => toast.error('Couldn’t open the document', 'Please try again.')); }}>
        <Svg size={11} sw={2.4}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
        View {/\.pdf$/i.test(c.file?.name ?? paths[0] ?? '') ? 'PDF' : 'file'}{more > 0 && <small>+{more}</small>}
      </button>
    </Tooltip>
  );
}

const IcoTrash = () => <Svg size={13}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;

export default function AssignTargetModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const toast = useToast();
  // One save at a time: spinner on the button, form locked, × / Cancel / Esc off while it runs (V-C01).
  const { saving, busy, run } = useSaveGuard();
  const today = useMemo(todayIso, []);

  // Reference data and, on Edit, the target itself.
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState(initial?.code ?? '');
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [viewOnly, setViewOnly] = useState(false);
  const [startDate, setStartDate] = useState(initial?.startDate || today);
  const [assigneeName, setAssigneeName] = useState(initial?.assignedTo ?? '');

  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [assignee, setAssignee] = useState('');   // team member id (Add only; fixed on Edit)
  const [source, setSource] = useState<SourceType>('Product Master');
  const [list, setList] = useState<DraftProduct[]>([]);
  const [listTab, setListTab] = useState<SourceType>('Product Master');
  const [tried, setTried] = useState(false);
  // Field messages the server sent back (422), shown under the field until it changes.
  const [serverErr, setServerErr] = useState<{ due?: string; assignee?: string }>({});
  const [claKey, setClaKey] = useState<string | null>(null);
  // The product whose Text clarity is being read (the note popup).
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const noteProduct = noteKey ? list.find(r => r.key === noteKey) : undefined;
  const [clarities, setClarities] = useState<Record<string, Clarity>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const claProduct = claKey ? list.find(r => r.key === claKey) : undefined;

  useEffect(() => {
    api.get<{ data: MasterProduct[] }>('/p2p/products').then(r => setProducts(r.data?.data ?? [])).catch(() => {
      toast.error('Products not loaded', 'The Product Master list could not be loaded.');
    });
    if (!isEdit) {
      api.get<{ data: Member[] }>('/p2p/team-members').then(r => setMembers(r.data?.data ?? [])).catch(() => {
        toast.error('Team not loaded', 'The Assign To list could not be loaded.');
      });
      api.get<{ data: { code: string } }>('/p2p/sourcing-targets/next-code').then(r => setCode(r.data?.data?.code ?? '')).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit: fill the form from the server's copy of the target.
  const needClean = useRef(false);
  useEffect(() => {
    if (!initial) return;
    api.get<{ data: EditLoad }>(`/p2p/sourcing-targets/${encodeURIComponent(initial.code)}`)
      .then(r => {
        const d = r.data?.data;
        if (!d) return;
        const masters = (d.masterRows ?? []).map<DraftProduct>(p => ({
          key: `s-${p.id}`, id: p.id, mapped: !!p.mapped, source: 'Product Master', code: p.code || '—', name: p.name,
          segment: p.segment || '—', hsn: p.hsn || '—', targetPrice: plainPrice(p.price),
        }));
        const manuals = (d.manualRows ?? []).map<DraftProduct>(p => ({
          key: `s-${p.id}`, id: p.id, mapped: !!p.mapped, source: 'Manual Entry', code: '—', name: p.name,
          segment: '—', hsn: '—', targetPrice: plainPrice(p.price),
        }));
        const cl: Record<string, Clarity> = {};
        [...(d.masterRows ?? []), ...(d.manualRows ?? [])].forEach(p => { const c = toClarity(p.clarity); if (c) cl[`s-${p.id}`] = c; });
        const first: SourceType = d.source === 'Manual Entry' ? 'Manual Entry' : 'Product Master';
        setList([...masters, ...manuals]);
        setClarities(cl);
        setSource(first);
        setListTab(masters.length || !manuals.length ? 'Product Master' : 'Manual Entry');
        if (d.due) setDueDate(d.due);
        if (d.start) setStartDate(d.start);
        if (d.id) setCode(d.id);
        setAssigneeName(d.assignee || initial.assignedTo);
        if (d.assigneeActive === false) {
          setViewOnly(true);
          toast.info('View only', 'This sourcing target’s assignee is inactive or exited, so it can’t be edited.');
        }
        needClean.current = true;
      })
      .catch(e => toast.error('Couldn’t open the target', apiErrorMessage(e, 'Please try again.')))
      .finally(() => setLoadingEdit(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the Clarity dialog closes, focus goes back to that row's clarity button. Saving swaps
  // "Add clarity" for the "✓ Text" chip (a new element), so it is found by its row key.
  const lastClaKey = useRef<string | null>(null);
  useEffect(() => {
    if (claKey) { lastClaKey.current = claKey; return; }
    const k = lastClaKey.current;
    lastClaKey.current = null;
    if (k) dialogRef.current?.querySelector<HTMLElement>(`[data-clarity="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  }, [claKey]);

  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const pickRef = useRef<HTMLDivElement>(null);

  const [mName, setMName] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [mTried, setMTried] = useState(false);
  const manualSeq = useRef(0);   // unique keys for manual products (two adds in one ms can't collide)

  // Has anything changed since the popup opened (or, on Edit, since the target loaded)? Then Esc
  // does not close it (only × / Cancel do), so typed data is never lost to one key press.
  const snapshot = JSON.stringify([dueDate, assignee, source, list, pending, q, mName, mPrice,
    Object.entries(clarities).map(([k, c]) => [k, c.type, c.value])]);
  const [cleanSnapshot, setCleanSnapshot] = useState(snapshot);
  useEffect(() => { if (needClean.current) { needClean.current = false; setCleanSnapshot(snapshot); } }, [snapshot]);
  const dirty = snapshot !== cleanSnapshot;

  // Scroll lock, Esc and focus. Esc is held back while saving, while the product picker is open
  // (the picker closes itself on Esc) and once the form has changes.
  usePopup(dialogRef, { onClose, blocked: () => busy.current || picking || dirty });

  // The open picker closes on Esc, on a click outside it, and when focus leaves it (Tab out).
  useEffect(() => {
    if (!picking) return;
    const outside = (t: EventTarget | null) => !pickRef.current?.contains(t as Node);
    const onDown = (e: MouseEvent) => { if (outside(e.target)) setPicking(false); };
    const onFocus = (e: FocusEvent) => { if (outside(e.target)) setPicking(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [picking]);

  const added = useMemo(() => new Set(list.filter(p => p.source === 'Product Master').map(p => p.code)), [list]);
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(p => !s || `${p.code} ${p.name} ${p.segment}`.toLowerCase().includes(s));
  }, [q, products]);

  const locked = saving || viewOnly || loadingEdit;
  const switchSource = (s: SourceType) => { if (isEdit) return; setSource(s); setListTab(s); setPicking(false); };

  const addMasters = () => {
    const rows = products.filter(p => pending.includes(p.code) && !added.has(p.code)).map<DraftProduct>(p => ({
      key: `m-${p.code}`, source: 'Product Master', code: p.code, name: p.name,
      segment: p.segment || '—', hsn: p.hsn || '—', targetPrice: '',
    }));
    if (rows.length) setList(l => [...l, ...rows]);
    setPending([]); setQ(''); setPicking(false); setListTab('Product Master');
  };
  const addManual = () => {
    const name = mName.trim();
    if (!name || !(Number(mPrice) > 0)) { setMTried(true); return; }
    if (list.some(r => r.source === 'Manual Entry' && r.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.warning('Already in the list', `“${name}” is already a manual product on this target.`);
      return;
    }
    setList(l => [...l, { key: `x-${++manualSeq.current}`, source: 'Manual Entry', code: '—', name, segment: '—', hsn: '—', targetPrice: mPrice }]);
    setMName(''); setMPrice(''); setMTried(false); setListTab('Manual Entry');
  };
  const patch = (key: string, p: Partial<DraftProduct>) => setList(l => l.map(r => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: string) => {
    setList(l => l.filter(r => r.key !== key));
    setClarities(c => { const n = { ...c }; delete n[key]; return n; });
  };

  const errDue = serverErr.due || (!dueDate ? 'Pick the target completion date'
    : !isEdit && dueDate < today ? 'The Sourcing TAT cannot be in the past'
      : dueDate < startDate ? 'TAT cannot be before the start date' : '');
  const days = dueDate ? Math.round((Date.parse(dueDate) - Date.parse(startDate)) / 86400000) : 0;
  const errAssignee = isEdit ? '' : serverErr.assignee || (!assignee ? 'Assign this target to a team member' : '');
  const errNone = list.length === 0;
  const errPrice = list.some(r => !(Number(r.targetPrice) > 0));
  // Edit lets the creator rename a manual product: it cannot be left empty.
  const errName = list.some(r => r.source === 'Manual Entry' && !r.name.trim());
  const valid = !errDue && !errAssignee && !errNone && !errPrice && !errName;

  /** Upload the clarity documents picked in this session; already-saved ones keep their path. */
  const uploadClarities = async (): Promise<Record<string, ApiClarity>> => {
    const out: Record<string, ApiClarity> = {};
    await Promise.all(list.map(async r => {
      const c = clarities[r.key];
      if (!c) { out[r.key] = null; return; }
      if (c.type !== 'pdf' || !c.file) { out[r.key] = { type: c.type, val: c.value }; return; }
      out[r.key] = { type: 'pdf', val: await uploadP2pFile(c.file, 'clarity') };
    }));
    return out;
  };

  const submit = () => {
    setTried(true);
    if (viewOnly || loadingEdit) return;
    if (!valid || busy.current) {
      // A product price that is missing may be on the other list tab: switch to it.
      const bad = list.find(r => !(Number(r.targetPrice) > 0) || (r.source === 'Manual Entry' && !r.name.trim()));
      if (!errDue && !errAssignee && bad && bad.source !== listTab) setListTab(bad.source);
      return;
    }
    void run(async () => {
      try {
        const cl = await uploadClarities();
        const body = {
          source: source === 'Manual Entry' ? 'manual' : 'master',
          due_date: dueDate,
          // Ignored by the server on Edit (the assignee is fixed); sent so the body matches create.
          assignee_id: isEdit ? (initial?.assigneeId ?? null) : assignee,
          products: list.map(r => ({
            ...(r.id ? { id: r.id } : {}),
            from: r.source === 'Manual Entry' ? 'manual' : 'master',
            ...(r.source === 'Manual Entry' ? { name: r.name } : { code: r.code }),
            target_price: r.targetPrice,
            clarity: cl[r.key],
          })),
        };
        const res = isEdit
          ? await api.put<{ data: { id: string } }>(`/p2p/sourcing-targets/${encodeURIComponent(initial!.code)}`, body)
          : await api.post<{ data: { id: string } }>('/p2p/sourcing-targets', body);
        const name = isEdit ? assigneeName : (members.find(m => String(m.id) === assignee)?.name ?? '');
        onSaved({ code: res.data?.data?.id ?? code, count: list.length, assignee: name, isEdit });
      } catch (e) {
        const fields = apiFieldErrors(e);
        setServerErr({ due: fields.due_date, assignee: fields.assignee_id });
        toast.error(isEdit ? 'Update failed' : 'Assign failed', apiErrorMessage(e, 'Please try again.'));
      }
    });
  };

  const masters = list.filter(r => r.source === 'Product Master');
  const manuals = list.filter(r => r.source === 'Manual Entry');
  const isM = listTab === 'Product Master';
  const shown = isM ? masters : manuals;

  // Product List: after 4 products the list scrolls inside (sticky header). Measured from the real
  // rows (they hold a price input and buttons), so the cut lands exactly on row 4.
  const plistRef = useRef<HTMLDivElement>(null);
  const [plistMax, setPlistMax] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = plistRef.current;
    if (!el || shown.length <= PLIST_ROWS) { setPlistMax(null); return; }
    const measure = () => {
      const last = el.querySelectorAll<HTMLElement>('.stsrc-row:not(.stsrc-row--head)')[PLIST_ROWS - 1];
      if (last) setPlistMax(Math.ceil(last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop) + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [listTab, shown.length]);
  const rowCls = isM ? 'stsrc-row stsrc-row--m' : 'stsrc-row stsrc-row--n';
  const memberOptions = members.map(m => ({ value: String(m.id), label: m.role ? `${m.name} · ${m.role}` : m.name, selectedLabel: m.name }));

  return createPortal(
    // A click on the backdrop does nothing. Esc closes only an unchanged form; × and Cancel always close.
    <div className="sta-overlay">
      <div ref={dialogRef} className={`sta-modal${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-busy={saving || loadingEdit || undefined}
        aria-label={isEdit ? 'Edit Sourcing Target' : 'Assign Sourcing Target'}>

        <div className="sta-head">
          <div className="sta-head-ico">{isEdit ? <IcoEdit size={18} stroke="#fff" /> : <IcoCheckBox size={18} />}</div>
          <div className="sta-head-txt">
            <div className="sta-title">{isEdit ? `Edit Sourcing Target — ${code}` : 'Assign Sourcing Target'}</div>
            <div className="sta-sub">{isEdit ? 'Update sourcing details and product list.' : 'Create a sourcing target across products.'}</div>
          </div>
          {/* Add: the server's next ID, a preview only (the real one is given on save). */}
          <div className="sta-head-idcard"><span className="sta-head-idcard-label">Sourcing Target ID</span><span className="sta-head-idcard-val">{code || '…'}</span></div>
          <button type="button" className="sta-close" aria-label="Close" onClick={onClose} disabled={saving}><IcoX /></button>
          <span className="sta-head-accent" />
        </div>

        {/* While saving, the whole form is inert: no typing, clicking or tabbing into it. */}
        <div className="sta-body sct-scroller" inert={saving}>

          {/* 1. Sourcing Details */}
          <div className="sta-srccard">
            <div className="sta-srccard-head">
              <span className="sta-srccard-ico"><IcoCal size={16} stroke="#fff" /></span>
              <div className="sta-srccard-htxt"><b>Sourcing Details</b><small>Identification and timeline for this sourcing</small></div>
              {viewOnly
                ? <span className="sta-srccard-tag sta-srccard-tag--edit"><span className="sta-srccard-dot sta-srccard-dot--edit" />View Only</span>
                : isEdit
                  ? <span className="sta-srccard-tag sta-srccard-tag--edit"><span className="sta-srccard-dot sta-srccard-dot--edit" />Edit Mode</span>
                  : <span className="sta-srccard-tag"><span className="sta-srccard-dot" />New</span>}
            </div>
            <div className="sta-srccard-body">
              <div className="sta-srcgrid">
                <div className="sta-field">
                  <div className="sta-lab">Start Date <span className="sta-lock"><IcoLock size={9} /> {isEdit ? 'Locked' : 'Today'}</span></div>
                  <div className="sta-inputwrap is-frozen">
                    <span className="sta-input-ico"><IcoCal size={13} /></span>
                    <input type="text" className="sta-inp has-ico" value={dmy(startDate)} readOnly tabIndex={-1} />
                    <span className="sta-freeze-ico"><IcoLock /></span>
                  </div>
                </div>
                <div className="sta-srcgrid-sep" />
                <div className="sta-field">
                  <div className="sta-lab">Sourcing TAT <span className="sta-req">*</span></div>
                  <div className="sta-inputwrap sta-inputwrap--active">
                    <span className="sta-input-ico"><IcoCal size={13} /></span>
                    {/* The app's own calendar (MasterDatePicker), not the browser's native date input.
                        Same ISO value; days before the Start Date (Add: before today) are blocked. */}
                    <div className="sta-dp">
                      <MasterDatePicker value={dueDate} minDate={isEdit ? startDate : today} placeholder="Select date" disabled={locked}
                        invalid={!!(tried && errDue)} onChange={v => { setDueDate(v); setServerErr(s => ({ ...s, due: undefined })); }} />
                    </div>
                  </div>
                  <div className={`sta-tat-hint${tried && errDue ? ' is-err' : ''}`}>{tried && errDue ? errDue : dueDate ? `${days} days turnaround from start` : 'Pick the target completion date'}</div>
                </div>
                <div className="sta-srcgrid-sep" />
                <div className="sta-field">
                  <div className="sta-lab">Assign To {isEdit ? <span className="sta-lock"><IcoLock size={9} /> Fixed</span> : <span className="sta-req">*</span>}</div>
                  {isEdit ? (
                    // The assignee is fixed once the target exists (the API ignores a change).
                    <div className="sta-inputwrap is-frozen">
                      <span className="sta-input-ico"><IcoUsers size={13} /></span>
                      <input type="text" className="sta-inp has-ico" value={assigneeName} readOnly tabIndex={-1} aria-label="Assigned to" />
                      <span className="sta-freeze-ico"><IcoLock /></span>
                    </div>
                  ) : (
                    <>
                      <div className="sta-inputwrap">
                        <span className="sta-input-ico"><IcoUsers size={13} /></span>
                        <div className="sta-ms">
                          <MasterSelect value={assignee} placeholder={members.length ? 'Select team member' : 'No team members available'}
                            searchable={members.length > 6} searchPlaceholder="Search people…" disabled={locked}
                            invalid={!!(tried && errAssignee)} options={memberOptions}
                            onChange={v => { setAssignee(v); setServerErr(s => ({ ...s, assignee: undefined })); }} />
                        </div>
                      </div>
                      {tried && errAssignee && <div className="sta-tat-hint is-err">{errAssignee}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Product Details */}
          <div className="sta-srccard">
            <div className="sta-srccard-head sta-srccard-head--teal">
              <span className="sta-srccard-ico sta-srccard-ico--teal"><Svg size={16} stroke="#fff"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Svg></span>
              <div className="sta-srccard-htxt"><b>Product Details</b><small>Choose how to add products</small></div>
              <span className="sta-srccard-tag sta-srccard-tag--teal"><span className="sta-srccard-dot sta-srccard-dot--teal" />Products</span>
            </div>
            <div className="sta-srccard-body">
              <div className={`sta-field${viewOnly ? '' : ' sta-field--gap'}`}>
                <div className="sta-lab">I want to source from <span className="sta-req">*</span>{isEdit && <span className="sta-locked"><IcoLock size={10} /> Locked</span>}</div>
                <div className="sta-radios" role="radiogroup">
                  <button type="button" role="radio" aria-checked={source === 'Product Master'} className={`sta-radio${source === 'Product Master' ? ' is-sel' : ''}${isEdit ? ' is-locked' : ''}`} aria-disabled={isEdit || undefined} onClick={() => switchSource('Product Master')}>
                    <span className="sta-radio-dot" /><span className="sta-radio-txt"><b>From Product Master</b><small>Pick existing products</small></span>
                  </button>
                  <button type="button" role="radio" aria-checked={source === 'Manual Entry'} className={`sta-radio${source === 'Manual Entry' ? ' is-sel' : ''}${isEdit ? ' is-locked' : ''}`} aria-disabled={isEdit || undefined} onClick={() => switchSource('Manual Entry')}>
                    <span className="sta-radio-dot" /><span className="sta-radio-txt"><b>Manual Product Entry</b><small>Type a new product</small></span>
                  </button>
                </div>
              </div>

              {/* Add products — on Add, and on Edit too (the creator adds to the target; the PUT adds
                  every product sent without an id). The source is locked on Edit, so the adder of the
                  target's own source shows. Not on a view-only target. */}
              {viewOnly || loadingEdit ? null : source === 'Product Master' ? (
                <div className="sta-field">
                  <div className="sta-lab">Select Products <span className="sta-hint">(choose one or more, then click Add)</span></div>
                  <div className="stsrc-picker">
                    <div className="stsrc-pick-chips">
                      {pending.length === 0
                        ? <span className="stsrc-pick-ph">No products chosen yet</span>
                        : pending.map(c => (
                          <span key={c} className="stsrc-pick-chip">{products.find(p => p.code === c)?.name}
                            <button type="button" aria-label="Remove" onClick={() => setPending(p => p.filter(x => x !== c))}><IcoX size={10} sw={3} /></button>
                          </span>
                        ))}
                    </div>
                    <div className="stsrc-pick-search" ref={pickRef}>
                      <IcoSearch size={13} />
                      <input type="text" placeholder="Search products..." value={q}
                        onFocus={() => setPicking(true)} onChange={e => { setQ(e.target.value); setPicking(true); }} />
                      <button type="button" className="sta-btn sta-btn-primary stsrc-pick-add" disabled={!pending.length} onClick={addMasters}><IcoPlus size={13} sw={2.6} /> Add</button>
                      {picking && (
                        <div className="stsrc-pick-list sct-scroller" role="listbox" aria-multiselectable>
                          {options.length === 0 ? <div className="stsrc-pick-none">{products.length ? 'No products found' : 'No products in the Product Master'}</div>
                            : options.map(p => {
                              const isAdded = added.has(p.code);
                              const on = pending.includes(p.code);
                              return (
                                <button key={p.code} type="button" role="option" aria-selected={on || isAdded}
                                  className={`stsrc-pick-opt${on ? ' is-on' : ''}${isAdded ? ' is-added' : ''}`}
                                  onClick={() => { if (!isAdded) setPending(s => (on ? s.filter(x => x !== p.code) : [...s, p.code])); }}>
                                  <span className="stsrc-pick-check">{(on || isAdded) && <IcoCheck size={11} sw={3} />}</span>
                                  <span className="stsrc-pick-txt"><b>{p.code}</b> — {p.name}{isAdded && <i> (added)</i>}</span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sta-grid-3">
                  <div className="sta-field">
                    <label className="sta-lab" htmlFor="sta-m-name">Product Name <span className="sta-req">*</span></label>
                    <input id="sta-m-name" type="text" maxLength={255} className={`sta-inp${mTried && !mName.trim() ? ' has-err' : ''}`} placeholder="e.g. Office Printer A4"
                      value={mName} onChange={e => setMName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addManual(); }} />
                  </div>
                  <div className="sta-field">
                    <label className="sta-lab" htmlFor="sta-m-price">Target Price (₹) <span className="sta-req">*</span></label>
                    <input id="sta-m-price" type="text" inputMode="decimal" className={`sta-inp${mTried && !(Number(mPrice) > 0) ? ' has-err' : ''}`} placeholder="Required"
                      value={mPrice} onChange={e => setMPrice(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') addManual(); }} />
                  </div>
                  <div className="sta-field">
                    <button type="button" className="sta-btn sta-btn-primary sta-btn--block" onClick={addManual}><IcoPlus size={13} sw={2.6} /> Add to List</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Product List */}
          <div className="sta-srccard">
            <div className="sta-srccard-head sta-srccard-head--teal">
              <span className="sta-srccard-ico sta-srccard-ico--teal"><Svg size={16} stroke="#fff"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Svg></span>
              <div className="sta-srccard-htxt"><b>Product List</b><small>Mapped products for this sourcing</small></div>
              <div className="stsrc-listtabs" role="tablist" aria-label="Product list">
                <button type="button" role="tab" aria-selected={isM} className={`stsrc-ltab${isM ? ' is-active' : ''}`} onClick={() => setListTab('Product Master')}>Masters <span className="stsrc-ltab-c">{masters.length}</span></button>
                <button type="button" role="tab" aria-selected={!isM} className={`stsrc-ltab${!isM ? ' is-active' : ''}`} onClick={() => setListTab('Manual Entry')}>Manual <span className="stsrc-ltab-c">{manuals.length}</span></button>
              </div>
            </div>
            <div className="sta-srccard-body sta-srccard-body--list">
              {loadingEdit ? (
                <div className="sta-empty"><span className="sct-spin sct-spin--dark" aria-hidden /> Loading the target’s products…</div>
              ) : shown.length === 0 ? (
                <div className={`sta-empty${tried && errNone ? ' has-err' : ''}`}>
                  {tried && errNone ? 'Add at least one product'
                    : isM ? 'No master products added yet. Select from the dropdown above and click Add.'
                      : 'No manual products added yet. Enter a name and price above and click Add to List.'}
                </div>
              ) : (
                <div className="sta-plist sct-scroller" ref={plistRef} style={plistMax ? { maxHeight: plistMax } : undefined}>
                  <div className={`${rowCls} stsrc-row--head`}>
                    <span>Sr</span>{isM && <span>Product Code</span>}<span>Product Name</span>{isM && <><span>Segment</span><span>HSN Code</span></>}
                    <span>Target Price (₹) <b className="stsrc-th-req">*</b></span><span>Clarity <i className="stsrc-th-opt">(optional)</i></span><span className="stsrc-th-act">Action</span>
                  </div>
                  {shown.map((r, i) => (
                    <div key={r.key} className={rowCls}>
                        <span className="stsrc-sr">{i + 1}</span>
                        {isM && <span className="stsrc-code">{r.code}</span>}
                        {/* Edit: a manual product's name can be corrected, even with suppliers mapped (the
                            mapping is by the product's id, not its name — it only cannot be removed). */}
                        {isEdit && r.source === 'Manual Entry' && !viewOnly ? (
                          <span><input type="text" maxLength={255} aria-label={`Product name for ${r.name || 'manual product'}`}
                            className={`sta-pl-price sta-pl-name${tried && !r.name.trim() ? ' has-err' : ''}`} placeholder="Product name"
                            value={r.name} onChange={e => patch(r.key, { name: e.target.value })} /></span>
                        ) : <span className="stsrc-name">{r.name}</span>}
                        {isM && <><span><ClipText text={r.segment} /></span><span className="stsrc-hsn">{r.hsn}</span></>}
                        <span><input type="text" inputMode="decimal" aria-label={`Target price for ${r.name}`} className={`sta-pl-price${tried && !(Number(r.targetPrice) > 0) ? ' has-err' : ''}`} placeholder="Required"
                          value={r.targetPrice} readOnly={viewOnly} onChange={e => patch(r.key, { targetPrice: e.target.value.replace(/[^\d.]/g, '') })} /></span>
                        <span>
                          {clarities[r.key] ? (
                            // Saved: ✏ edits it; the chip opens it (the note on hover, the link in a new tab,
                            // the document in a new tab) — as in Bulk Sourcing's product list.
                            <span className="sta-cla-cell">
                              <Tooltip label="Edit clarity">
                                <button type="button" className="sta-cla-edit" data-clarity={r.key} disabled={viewOnly} onClick={() => setClaKey(r.key)}
                                  aria-label={`Edit clarity of ${r.name}`}>
                                  <Svg size={12} sw={2.3}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></Svg>
                                </button>
                              </Tooltip>
                              <ClarityOpen c={clarities[r.key]} onViewNote={() => setNoteKey(r.key)} />
                            </span>
                          ) : (
                            <button type="button" className="sta-pl-clarity" data-clarity={r.key} disabled={viewOnly} onClick={() => setClaKey(r.key)}><IcoPlus size={11} sw={2.6} />Add clarity</button>
                          )}
                        </span>
                        <span>
                          {/* A product with suppliers mapped stays on the target (only its price and clarity change). */}
                          {r.mapped ? (
                            <Tooltip label="Suppliers are mapped to this product — it can’t be removed">
                              <span className="sta-pl-del is-locked" aria-label={`${r.name} has suppliers mapped and can't be removed`}><IcoLock size={12} /></span>
                            </Tooltip>
                          ) : (
                            <button type="button" className="sta-pl-del" title="Delete" aria-label={`Remove ${r.name}`} disabled={viewOnly} onClick={() => remove(r.key)}><IcoTrash /></button>
                          )}
                        </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sta-foot">
          <button type="button" className="sta-btn sta-btn-ghost" onClick={onClose} disabled={saving}>{viewOnly ? 'Close' : 'Cancel'}</button>
          {!viewOnly && (
            <button type="button" className="sta-btn sta-btn-primary" onClick={submit} disabled={saving || loadingEdit} aria-busy={saving || undefined}>
              {saving
                ? <><span className="sct-spin" aria-hidden />{isEdit ? 'Updating…' : 'Assigning…'}</>
                : <>{isEdit ? <IcoEdit size={18} stroke="#fff" /> : <IcoCheckBox />} {isEdit ? 'Update Target' : 'Assign Target'}</>}
            </button>
          )}
        </div>
      </div>

        {noteKey && noteProduct && clarities[noteKey]?.type === 'text' && (
          <ClarityNoteView productName={noteProduct.name} note={clarities[noteKey].value} onClose={() => setNoteKey(null)}
            onEdit={viewOnly ? undefined : () => { const k = noteKey; setNoteKey(null); setClaKey(k); }} />
        )}
        {claKey && claProduct && (
          <ClarityDialog key={claKey} product={claProduct} initial={clarities[claKey]}
            onCancel={() => setClaKey(null)}
            onSave={c => {
              setClarities(m => { const n = { ...m }; if (c) n[claKey] = c; else delete n[claKey]; return n; });
              setClaKey(null);
            }} />
        )}
    </div>,
    document.body,
  );
}
