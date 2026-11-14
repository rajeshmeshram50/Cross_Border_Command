import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ASSIGNEES, MASTER_PRODUCTS, nextCode, todayIso,
  type DraftProduct, type SourcingTarget, type SourceType,
} from './data';
import './assign-target-modal.css';
/* Assign Sourcing Target popup — Figma cha DOM element for element (ast-* / asrc-* classes).
   Dummy data var; API nantar — onCreate chi jagi POST yeil. */

type Props = {
  existing: SourcingTarget[];
  /** Edit mode: pass the row. Add mode: leave out. */
  initial?: SourcingTarget;
  onClose: () => void;
  /** Add → new target; Edit → the same target, updated (parent decides which). */
  onSave: (t: SourcingTarget) => void;
};

/** DUMMY: the list has no product rows yet, so edit seeds them from the target's counts.
    With the API this is a GET of the target's products — nothing else changes. */
const seedProducts = (t: SourcingTarget): DraftProduct[] => {
  const hasM = t.sources.includes('Product Master');
  const hasX = t.sources.includes('Manual Entry');
  const nManual = !hasX ? 0 : !hasM ? t.totalProducts : Math.max(1, Math.floor(t.totalProducts / 4));
  const seed = parseInt(t.code.replace(/\D/g, ''), 10) || 1;
  const out: DraftProduct[] = [];
  for (let i = 0; i < t.totalProducts; i++) {
    const manual = i >= t.totalProducts - nManual;
    const price = String(1000 + ((i * 7919 + seed * 131) % 19000));
    if (manual) {
      out.push({ key: `x-${i}`, source: 'Manual Entry', code: '—', name: i === 0 ? t.firstProduct : `Manual item ${i + 1}`, segment: '—', hsn: '—', targetPrice: price, clarity: '' });
    } else {
      const m = MASTER_PRODUCTS[i % MASTER_PRODUCTS.length];
      out.push({ key: `m-${i}`, source: 'Product Master', code: m.code, name: i === 0 ? t.firstProduct : m.name, segment: m.segment, hsn: m.hsn, targetPrice: price, clarity: '' });
    }
  }
  return out;
};

const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const Svg = ({ size = 16, sw = 2.2, stroke = 'currentColor', children }: { size?: number; sw?: number; stroke?: string; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoCheckBox = ({ size = 14 }: { size?: number }) => <Svg size={size} stroke="#fff"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Svg>;
const IcoEditBox = () => <Svg size={18} stroke="#fff"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></Svg>;
const IcoX = ({ size = 15, sw = 2.6 }: { size?: number; sw?: number }) => <Svg size={size} sw={sw}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
const IcoPlus = ({ size = 13 }: { size?: number }) => <Svg size={size} sw={2.6} stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
const IcoCal = ({ size = 13, stroke = 'currentColor' }: { size?: number; stroke?: string }) => <Svg size={size} stroke={stroke}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>;
const IcoLock = ({ size = 12 }: { size?: number }) => <Svg size={size} sw={2.5}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
const IcoUsers = () => <Svg size={13}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
const IcoSearch = () => <Svg size={13} sw={2.2}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>;
const IcoTrash = () => <Svg size={13}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;
const IcoTick = () => <Svg size={11} sw={3} stroke="#fff"><polyline points="20 6 9 17 4 12" /></Svg>;

type ClarityType = 'text' | 'link' | 'pdf';
/** Clarity of one product: notes, a link, or a PDF. API nantar — PDF upload hya jagi hoil. */
type Clarity = { type: ClarityType; value: string; file?: File };

const IcoPen = () => <Svg size={16} stroke="#fff"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
const IcoUpload = () => <Svg size={16}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Svg>;

function ClarityDialog({ product, initial, onCancel, onSave }: {
  product: DraftProduct; initial?: Clarity; onCancel: () => void; onSave: (c: Clarity | null) => void;
}) {
  const [type, setType] = useState<ClarityType>(initial?.type ?? 'text');
  const [text, setText] = useState(initial?.type === 'text' ? initial.value : '');
  const [link, setLink] = useState(initial?.type === 'link' ? initial.value : '');
  const [file, setFile] = useState<File | undefined>(initial?.file);
  const [fileName, setFileName] = useState(initial?.type === 'pdf' ? initial.value : '');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f?: File) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { setErr('Only PDF files are allowed'); return; }
    if (f.size > 10 * 1024 * 1024) { setErr('PDF must be 10 MB or smaller'); return; }
    setErr(''); setFile(f); setFileName(f.name);
  };

  const save = () => {
    if (type === 'text') {
      const v = text.trim();
      return onSave(v ? { type, value: v } : null);          // khali = clarity kadhun taka
    }
    if (type === 'link') {
      const v = link.trim();
      if (!v) return onSave(null);
      if (!/^https?:\/\/\S+\.\S+/i.test(v)) { setErr('Enter a valid link starting with http:// or https://'); return; }
      return onSave({ type, value: v });
    }
    if (!fileName) return onSave(null);
    onSave({ type, value: fileName, file });
  };

  return createPortal(
    <div className="ast-overlay ast-overlay--top" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ast-modal ast-modal--sm" role="dialog" aria-modal="true" aria-label="Product Clarity">
        <div className="ast-head ast-head--sm">
          <div className="ast-head-ico"><IcoPen /></div>
          <div className="ast-head-txt">
            <div className="ast-title">Product Clarity</div>
            <div className="ast-sub">{product.code !== '—' ? `${product.code} — ` : ''}{product.name}</div>
          </div>
          <button type="button" className="ast-close ast-close--sm" aria-label="Close" onClick={onCancel}><IcoX size={14} /></button>
        </div>
        <div className="ast-pop-body">
          <div className="ast-tabs" role="tablist">
            {(['text', 'link', 'pdf'] as ClarityType[]).map(t => (
              <button key={t} type="button" role="tab" aria-selected={type === t} className={`asrc-ltab${type === t ? ' is-active' : ''}`}
                onClick={() => { setType(t); setErr(''); }}>{t === 'pdf' ? 'PDF' : t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>

          {type === 'text' && (
            <textarea className="ast-inp ast-inp--area" autoFocus rows={4} placeholder="Add notes or specs..." value={text} onChange={e => setText(e.target.value)} />
          )}
          {type === 'link' && (
            <input type="url" className={`ast-inp${err ? ' has-err' : ''}`} autoFocus placeholder="https://..." value={link}
              onChange={e => { setLink(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          )}
          {type === 'pdf' && (
            <>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => pickFile(e.target.files?.[0])} />
              <button type="button" className={`ast-drop${fileName ? ' has-file' : ''}`} onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}>
                <IcoUpload />
                <b>{fileName || 'Choose a PDF'}</b>
                <small>{fileName ? 'Click to replace' : 'or drag and drop here · max 10 MB'}</small>
              </button>
            </>
          )}
          {err && <div className="ast-pop-err">{err}</div>}

          <div className="ast-pop-foot">
            <button type="button" className="ast-btn ast-btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="ast-btn ast-btn-primary" onClick={save}>Save Clarity</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function AssignTargetModal({ existing, initial, onClose, onSave }: Props) {
  const isEdit = !!initial;
  const today = useMemo(todayIso, []);
  const startDate = initial?.startDate ?? today;
  const code = useMemo(() => initial?.code ?? nextCode(existing), [existing, initial]);

  const firstSource: SourceType = initial && !initial.sources.includes('Product Master') ? 'Manual Entry' : 'Product Master';
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [assignee, setAssignee] = useState(initial && initial.assignedTo !== 'Unassigned' ? initial.assignedTo : '');
  const [source, setSource] = useState<SourceType>(firstSource);
  const [list, setList] = useState<DraftProduct[]>(() => (initial ? seedProducts(initial) : []));
  const [listTab, setListTab] = useState<SourceType>(firstSource);
  const [tried, setTried] = useState(false);
  const [claKey, setClaKey] = useState<string | null>(null);
  const [clarities, setClarities] = useState<Record<string, Clarity>>({});
  const claOpen = useRef(false);
  claOpen.current = claKey !== null;

  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const pickRef = useRef<HTMLDivElement>(null);

  const [mName, setMName] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [mTried, setMTried] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (claOpen.current) setClaKey(null); else onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => {
    if (!picking) return;
    const h = (e: MouseEvent) => { if (!pickRef.current?.contains(e.target as Node)) setPicking(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [picking]);

  const added = useMemo(() => new Set(list.filter(p => p.source === 'Product Master').map(p => p.code)), [list]);
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    return MASTER_PRODUCTS.filter(p => !s || `${p.code} ${p.name} ${p.segment}`.toLowerCase().includes(s));
  }, [q]);

  const switchSource = (s: SourceType) => { if (isEdit) return; setSource(s); setListTab(s); setPicking(false); };

  const addMasters = () => {
    const rows = MASTER_PRODUCTS.filter(p => pending.includes(p.code) && !added.has(p.code)).map<DraftProduct>(p => ({
      key: `m-${p.code}`, source: 'Product Master', code: p.code, name: p.name,
      segment: p.segment, hsn: p.hsn, targetPrice: '', clarity: '',
    }));
    if (rows.length) setList(l => [...l, ...rows]);
    setPending([]); setQ(''); setPicking(false); setListTab('Product Master');
  };
  const addManual = () => {
    const name = mName.trim();
    if (!name || !(Number(mPrice) > 0)) { setMTried(true); return; }
    setList(l => [...l, { key: `x-${Date.now()}`, source: 'Manual Entry', code: '—', name, segment: '—', hsn: '—', targetPrice: mPrice, clarity: '' }]);
    setMName(''); setMPrice(''); setMTried(false); setListTab('Manual Entry');
  };
  const patch = (key: string, p: Partial<DraftProduct>) => setList(l => l.map(r => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: string) => {
    setList(l => l.filter(r => r.key !== key));
    setClarities(c => { const n = { ...c }; delete n[key]; return n; });
  };

  const errDue = !dueDate ? 'Pick the target completion date' : dueDate < startDate ? 'TAT cannot be before the start date' : '';
  const days = dueDate ? Math.round((Date.parse(dueDate) - Date.parse(startDate)) / 86400000) : 0;
  const assignees = assignee && !ASSIGNEES.includes(assignee) ? [assignee, ...ASSIGNEES] : ASSIGNEES;
  const errNone = list.length === 0;
  const errPrice = list.some(r => !(Number(r.targetPrice) > 0));
  const valid = !errDue && !errNone && !errPrice;

  const submit = () => {
    setTried(true);
    if (!valid) return;
    onSave({
      code, startDate, dueDate,
      sources: Array.from(new Set(list.map(r => r.source))),
      createdBy: initial?.createdBy ?? '',             // add: parent ME bharto
      assignedTo: assignee || 'Unassigned',
      firstProduct: list[0].name,
      totalProducts: list.length,
      completedProducts: Math.min(initial?.completedProducts ?? 0, list.length),
      mappedSuppliers: initial?.mappedSuppliers ?? 0,
    });
  };

  const masters = list.filter(r => r.source === 'Product Master');
  const manuals = list.filter(r => r.source === 'Manual Entry');
  const isM = listTab === 'Product Master';
  const shown = isM ? masters : manuals;
  const rowCls = isM ? 'asrc-row asrc-row--m' : 'asrc-row asrc-row--n';

  return createPortal(
    <div className="ast-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ast-modal" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit Sourcing Target' : 'Assign Sourcing Target'}>

        <div className="ast-head">
          <div className="ast-head-ico">{isEdit ? <IcoEditBox /> : <IcoCheckBox size={18} />}</div>
          <div className="ast-head-txt">
            <div className="ast-title">{isEdit ? `Edit Sourcing Target — ${code}` : 'Assign Sourcing Target'}</div>
            <div className="ast-sub">{isEdit ? 'Update sourcing details and product list.' : 'Create a sourcing target across products.'}</div>
          </div>
          <div className="ast-head-idcard"><span className="ast-head-idcard-label">Sourcing Target ID</span><span className="ast-head-idcard-val">{code}</span></div>
          <button type="button" className="ast-close" aria-label="Close" onClick={onClose}><IcoX /></button>
          <span className="ast-head-accent" />
        </div>

        <div className="ast-body">

          {/* 1. Sourcing Details */}
          <div className="ast-srccard">
            <div className="ast-srccard-head">
              <span className="ast-srccard-ico"><IcoCal size={16} stroke="#fff" /></span>
              <div className="ast-srccard-htxt"><b>Sourcing Details</b><small>Identification and timeline for this sourcing</small></div>
              {isEdit
                ? <span className="ast-srccard-tag ast-srccard-tag--edit"><span className="ast-srccard-dot ast-srccard-dot--edit" />Edit Mode</span>
                : <span className="ast-srccard-tag"><span className="ast-srccard-dot" />New</span>}
            </div>
            <div className="ast-srccard-body">
              <div className="ast-srcgrid">
                <div className="ast-field">
                  <div className="ast-lab">Start Date <span className="ast-lock"><IcoLock size={9} /> Today</span></div>
                  <div className="ast-inputwrap is-frozen">
                    <span className="ast-input-ico"><IcoCal /></span>
                    <input type="text" className="ast-inp has-ico" value={dmy(startDate)} readOnly tabIndex={-1} />
                    <span className="ast-freeze-ico"><IcoLock /></span>
                  </div>
                </div>
                <div className="ast-srcgrid-sep" />
                <div className="ast-field">
                  <div className="ast-lab">Sourcing TAT <span className="ast-req">*</span></div>
                  <div className="ast-inputwrap ast-inputwrap--active">
                    <span className="ast-input-ico"><IcoCal /></span>
                    <input type="date" className={`ast-inp has-ico${tried && errDue ? ' has-err' : ''}`} min={startDate}
                      value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  </div>
                  <div className={`ast-tat-hint${tried && errDue ? ' is-err' : ''}`}>{tried && errDue ? errDue : dueDate ? `${days} days turnaround from start` : 'Pick the target completion date'}</div>
                </div>
                <div className="ast-srcgrid-sep" />
                <div className="ast-field">
                  <div className="ast-lab">Assign To</div>
                  <div className="ast-inputwrap">
                    <span className="ast-input-ico"><IcoUsers /></span>
                    <select className="ast-inp has-ico" value={assignee} onChange={e => setAssignee(e.target.value)}>
                      <option value="">Unassigned</option>
                      {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Product Details */}
          <div className="ast-srccard">
            <div className="ast-srccard-head">
              <span className="ast-srccard-ico ast-srccard-ico--teal"><Svg size={16} stroke="#fff"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Svg></span>
              <div className="ast-srccard-htxt"><b>Product Details</b><small>Choose how to add products</small></div>
              <span className="ast-srccard-tag"><span className="ast-srccard-dot ast-srccard-dot--teal" />Products</span>
            </div>
            <div className="ast-srccard-body">
              <div className="ast-field" style={{ marginBottom: isEdit ? 0 : 13 }}>
                <div className="ast-lab">I want to source from <span className="ast-req">*</span>{isEdit && <span className="ast-locked"><IcoLock size={10} /> Locked</span>}</div>
                <div className="ast-radios" role="radiogroup">
                  <button type="button" role="radio" aria-checked={source === 'Product Master'} className={`ast-radio${source === 'Product Master' ? ' is-sel' : ''}${isEdit ? ' is-locked' : ''}`} onClick={() => switchSource('Product Master')}>
                    <span className="ast-radio-dot" /><span className="ast-radio-txt"><b>From Product Master</b><small>Pick existing products</small></span>
                  </button>
                  <button type="button" role="radio" aria-checked={source === 'Manual Entry'} className={`ast-radio${source === 'Manual Entry' ? ' is-sel' : ''}${isEdit ? ' is-locked' : ''}`} onClick={() => switchSource('Manual Entry')}>
                    <span className="ast-radio-dot" /><span className="ast-radio-txt"><b>Manual Product Entry</b><small>Type a new product</small></span>
                  </button>
                </div>
              </div>

              {isEdit ? null : source === 'Product Master' ? (
                <div className="ast-field">
                  <div className="ast-lab">Select Products <span className="ast-hint">(choose one or more, then click Add)</span></div>
                  <div className="asrc-picker">
                    <div className="asrc-pick-chips">
                      {pending.length === 0
                        ? <span className="asrc-pick-ph">No products chosen yet</span>
                        : pending.map(c => (
                          <span key={c} className="asrc-pick-chip">{MASTER_PRODUCTS.find(p => p.code === c)?.name}
                            <button type="button" aria-label="Remove" onClick={() => setPending(p => p.filter(x => x !== c))}><IcoX size={10} sw={3} /></button>
                          </span>
                        ))}
                    </div>
                    <div className="asrc-pick-search" ref={pickRef}>
                      <IcoSearch />
                      <input type="text" placeholder="Search products..." value={q}
                        onFocus={() => setPicking(true)} onChange={e => { setQ(e.target.value); setPicking(true); }} />
                      <button type="button" className="ast-btn ast-btn-primary asrc-pick-add" disabled={!pending.length} onClick={addMasters}><IcoPlus /> Add</button>
                      {picking && (
                        <div className="asrc-pick-list" role="listbox" aria-multiselectable>
                          {options.length === 0 ? <div className="asrc-pick-none">No products found</div>
                            : options.map(p => {
                              const isAdded = added.has(p.code);
                              const on = pending.includes(p.code);
                              return (
                                <button key={p.code} type="button" role="option" aria-selected={on || isAdded}
                                  className={`asrc-pick-opt${on || isAdded ? ' is-on' : ''}`}
                                  onClick={() => { if (!isAdded) setPending(s => (on ? s.filter(x => x !== p.code) : [...s, p.code])); }}>
                                  <span className="asrc-pick-check">{(on || isAdded) && <IcoTick />}</span>
                                  <span className="asrc-pick-txt"><b>{p.code}</b> — {p.name}{isAdded && <i> (added)</i>}</span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ast-grid-3">
                  <div className="ast-field">
                    <div className="ast-lab">Product Name <span className="ast-req">*</span></div>
                    <input type="text" className={`ast-inp${mTried && !mName.trim() ? ' has-err' : ''}`} placeholder="e.g. Office Printer A4"
                      value={mName} onChange={e => setMName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addManual(); }} />
                  </div>
                  <div className="ast-field">
                    <div className="ast-lab">Target Price (₹) <span className="ast-req">*</span></div>
                    <input type="text" inputMode="decimal" className={`ast-inp${mTried && !(Number(mPrice) > 0) ? ' has-err' : ''}`} placeholder="Required"
                      value={mPrice} onChange={e => setMPrice(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') addManual(); }} />
                  </div>
                  <div className="ast-field">
                    <button type="button" className="ast-btn ast-btn-primary" style={{ width: '100%' }} onClick={addManual}><IcoPlus /> Add to List</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Product List */}
          <div className="ast-srccard">
            <div className="ast-srccard-head">
              <span className="ast-srccard-ico ast-srccard-ico--teal"><Svg size={16} stroke="#fff"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Svg></span>
              <div className="ast-srccard-htxt"><b>Product List</b><small>Mapped products for this sourcing</small></div>
              <div className="asrc-listtabs">
                <button type="button" className={`asrc-ltab${isM ? ' is-active' : ''}`} onClick={() => setListTab('Product Master')}>Masters <span className="asrc-ltab-c">{masters.length}</span></button>
                <button type="button" className={`asrc-ltab${!isM ? ' is-active' : ''}`} onClick={() => setListTab('Manual Entry')}>Manual <span className="asrc-ltab-c">{manuals.length}</span></button>
              </div>
            </div>
            <div className="ast-srccard-body">
              {shown.length === 0 ? (
                <div className={`ast-empty${tried && errNone ? ' has-err' : ''}`}>
                  {tried && errNone ? 'Add at least one product'
                    : isM ? 'No master products added yet. Select from the dropdown above and click Add.'
                      : 'No manual products added yet. Enter a name and price above and click Add to List.'}
                </div>
              ) : (
                <div className="ast-plist">
                  <div className={`${rowCls} asrc-row--head`}>
                    <span>Sr</span>{isM && <span>Product Code</span>}<span>Product Name</span>{isM && <><span>Segment</span><span>HSN Code</span></>}
                    <span>Target Price (₹) <b className="asrc-th-req">*</b></span><span>Clarity <i className="asrc-th-opt">(optional)</i></span><span />
                  </div>
                  {shown.map((r, i) => (
                    <div key={r.key}>
                      <div className={rowCls}>
                        <span className="asrc-sr">{i + 1}</span>
                        {isM && <span className="asrc-code">{r.code}</span>}
                        <span className="asrc-name">{r.name}</span>
                        {isM && <><span>{r.segment}</span><span className="asrc-hsn">{r.hsn}</span></>}
                        <span><input type="text" inputMode="decimal" className={`ast-pl-price${tried && !(Number(r.targetPrice) > 0) ? ' has-err' : ''}`} placeholder="Required"
                          value={r.targetPrice} onChange={e => patch(r.key, { targetPrice: e.target.value.replace(/[^\d.]/g, '') })} /></span>
                        <span>
                          <button type="button" className={`ast-pl-clarity${clarities[r.key] ? ' has-val' : ''}`} onClick={() => setClaKey(r.key)}>
                            {clarities[r.key] ? 'Edit clarity' : <><IcoPlus size={11} />Add clarity</>}
                          </button>
                        </span>
                        <span><button type="button" className="ast-pl-del" title="Delete" aria-label={`Remove ${r.name}`} onClick={() => remove(r.key)}><IcoTrash /></button></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ast-foot">
          <button type="button" className="ast-btn ast-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ast-btn ast-btn-primary" onClick={submit}>{isEdit ? <IcoEditBox /> : <IcoCheckBox />} {isEdit ? 'Update Target' : 'Assign Target'}</button>
        </div>
      </div>

        {claKey && (() => {
          const prod = list.find(r => r.key === claKey);
          if (!prod) return null;
          return (
            <ClarityDialog key={claKey} product={prod} initial={clarities[claKey]}
              onCancel={() => setClaKey(null)}
              onSave={c => {
                setClarities(m => { const n = { ...m }; if (c) n[claKey] = c; else delete n[claKey]; return n; });
                setClaKey(null);
              }} />
          );
        })()}
    </div>,
    document.body,
  );
}
