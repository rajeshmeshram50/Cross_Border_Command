import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type TargetDraft,
  ASSIGNEES, MASTER_PRODUCTS, nextCode, todayIso,
  type DraftProduct, type SourcingTarget, type SourceType,
} from './data';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { useSaveGuard } from './useSaveGuard';
import { dmy } from './format';
import { seedProducts } from './targetProducts';
import { usePopup } from './popupHooks';
import ClarityDialog, { CLARITY_LABEL, clarityPreview, type Clarity } from './ClarityDialog';
import './popup-shell.css';
import './assign-target-modal.css';
import { IcoCal, IcoCheck, IcoEdit, IcoPlus, IcoSearch, IcoUsers, IcoX, Svg } from './icons';

/** Product List rows shown before the list scrolls inside the popup. */
const PLIST_ROWS = 4;

/** Assign To's "Unassigned" option: the app dropdown reads an empty value as "nothing picked". */
const UNASSIGNED = '__unassigned__';
/* Assign / Edit Sourcing Target popup, built element for element from the Figma (sta-* / stsrc-*
   classes). Runs on dummy data; with the API, onSave becomes the POST / PUT. */

type Props = {
  existing: SourcingTarget[];
  /** Edit mode: pass the row. Add mode: leave out. */
  initial?: SourcingTarget;
  onClose: () => void;
  /** Add → new target; Edit → the same target, updated (parent decides which). */
  onSave: (t: TargetDraft) => void;
};


const IcoCheckBox = ({ size = 14 }: { size?: number }) => <Svg size={size} stroke="#fff"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Svg>;
const IcoLock = ({ size = 12 }: { size?: number }) => <Svg size={size} sw={2.5}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
const IcoTrash = () => <Svg size={13}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;

export default function AssignTargetModal({ existing, initial, onClose, onSave }: Props) {
  const isEdit = !!initial;
  // One save at a time: spinner on the button, form locked, × / Cancel / Esc off while it runs (V-C01).
  const { saving, busy, run } = useSaveGuard();
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const claProduct = claKey ? list.find(r => r.key === claKey) : undefined;
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

  // Has anything changed since the popup opened? Then Esc does not close it (only × / Cancel do),
  // so typed data is never lost to one key press.
  const snapshot = JSON.stringify([dueDate, assignee, source, list, pending, q, mName, mPrice,
    Object.entries(clarities).map(([k, c]) => [k, c.type, c.value])]);
  const [cleanSnapshot] = useState(snapshot);
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
    return MASTER_PRODUCTS.filter(p => !s || `${p.code} ${p.name} ${p.segment}`.toLowerCase().includes(s));
  }, [q]);

  const switchSource = (s: SourceType) => { if (isEdit) return; setSource(s); setListTab(s); setPicking(false); };

  const addMasters = () => {
    const rows = MASTER_PRODUCTS.filter(p => pending.includes(p.code) && !added.has(p.code)).map<DraftProduct>(p => ({
      key: `m-${p.code}`, source: 'Product Master', code: p.code, name: p.name,
      segment: p.segment, hsn: p.hsn, targetPrice: '',
    }));
    if (rows.length) setList(l => [...l, ...rows]);
    setPending([]); setQ(''); setPicking(false); setListTab('Product Master');
  };
  const addManual = () => {
    const name = mName.trim();
    if (!name || !(Number(mPrice) > 0)) { setMTried(true); return; }
    setList(l => [...l, { key: `x-${++manualSeq.current}`, source: 'Manual Entry', code: '—', name, segment: '—', hsn: '—', targetPrice: mPrice }]);
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
    if (!valid || busy.current) return;
    void run(() => onSave({
      code, startDate, dueDate,
      sources: Array.from(new Set(list.map(r => r.source))),
      assignedTo: assignee || 'Unassigned',
      firstProduct: list[0].name,
      totalProducts: list.length,
      completedProducts: Math.min(initial?.completedProducts ?? 0, list.length),
      mappedSuppliers: initial?.mappedSuppliers ?? 0,
    }));
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

  return createPortal(
    // A click on the backdrop does nothing. Esc closes only an unchanged form; × and Cancel always close.
    <div className="sta-overlay">
      <div ref={dialogRef} className={`sta-modal${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-busy={saving || undefined}
        aria-label={isEdit ? 'Edit Sourcing Target' : 'Assign Sourcing Target'}>

        <div className="sta-head">
          <div className="sta-head-ico">{isEdit ? <IcoEdit size={18} stroke="#fff" /> : <IcoCheckBox size={18} />}</div>
          <div className="sta-head-txt">
            <div className="sta-title">{isEdit ? `Edit Sourcing Target — ${code}` : 'Assign Sourcing Target'}</div>
            <div className="sta-sub">{isEdit ? 'Update sourcing details and product list.' : 'Create a sourcing target across products.'}</div>
          </div>
          <div className="sta-head-idcard"><span className="sta-head-idcard-label">Sourcing Target ID</span><span className="sta-head-idcard-val">{code}</span></div>
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
              {isEdit
                ? <span className="sta-srccard-tag sta-srccard-tag--edit"><span className="sta-srccard-dot sta-srccard-dot--edit" />Edit Mode</span>
                : <span className="sta-srccard-tag"><span className="sta-srccard-dot" />New</span>}
            </div>
            <div className="sta-srccard-body">
              <div className="sta-srcgrid">
                <div className="sta-field">
                  <div className="sta-lab">Start Date <span className="sta-lock"><IcoLock size={9} /> Today</span></div>
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
                        Same ISO value; days before the Start Date are blocked. */}
                    <div className="sta-dp">
                      <MasterDatePicker value={dueDate} minDate={startDate} placeholder="Select date"
                        invalid={!!(tried && errDue)} onChange={setDueDate} />
                    </div>
                  </div>
                  <div className={`sta-tat-hint${tried && errDue ? ' is-err' : ''}`}>{tried && errDue ? errDue : dueDate ? `${days} days turnaround from start` : 'Pick the target completion date'}</div>
                </div>
                <div className="sta-srcgrid-sep" />
                <div className="sta-field">
                  <div className="sta-lab">Assign To</div>
                  <div className="sta-inputwrap">
                    <span className="sta-input-ico"><IcoUsers size={13} /></span>
                    {/* The app's own dropdown; "Unassigned" is a real option (sentinel value), not just the empty state. */}
                    <div className="sta-ms">
                      <MasterSelect value={assignee || UNASSIGNED} placeholder="Unassigned" searchable={assignees.length > 6}
                        searchPlaceholder="Search people…"
                        options={[{ value: UNASSIGNED, label: 'Unassigned' }, ...assignees.map(a => ({ value: a, label: a }))]}
                        onChange={v => setAssignee(v === UNASSIGNED ? '' : v)} />
                    </div>
                  </div>
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
              <div className={`sta-field${isEdit ? '' : ' sta-field--gap'}`}>
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

              {isEdit ? null : source === 'Product Master' ? (
                <div className="sta-field">
                  <div className="sta-lab">Select Products <span className="sta-hint">(choose one or more, then click Add)</span></div>
                  <div className="stsrc-picker">
                    <div className="stsrc-pick-chips">
                      {pending.length === 0
                        ? <span className="stsrc-pick-ph">No products chosen yet</span>
                        : pending.map(c => (
                          <span key={c} className="stsrc-pick-chip">{MASTER_PRODUCTS.find(p => p.code === c)?.name}
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
                          {options.length === 0 ? <div className="stsrc-pick-none">No products found</div>
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
                    <input id="sta-m-name" type="text" className={`sta-inp${mTried && !mName.trim() ? ' has-err' : ''}`} placeholder="e.g. Office Printer A4"
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
              {shown.length === 0 ? (
                <div className={`sta-empty${tried && errNone ? ' has-err' : ''}`}>
                  {tried && errNone ? 'Add at least one product'
                    : isM ? 'No master products added yet. Select from the dropdown above and click Add.'
                      : 'No manual products added yet. Enter a name and price above and click Add to List.'}
                </div>
              ) : (
                <div className="sta-plist sct-scroller" ref={plistRef} style={plistMax ? { maxHeight: plistMax } : undefined}>
                  <div className={`${rowCls} stsrc-row--head`}>
                    <span>Sr</span>{isM && <span>Product Code</span>}<span>Product Name</span>{isM && <><span>Segment</span><span>HSN Code</span></>}
                    <span>Target Price (₹) <b className="stsrc-th-req">*</b></span><span>Clarity <i className="stsrc-th-opt">(optional)</i></span><span />
                  </div>
                  {shown.map((r, i) => (
                    <div key={r.key} className={rowCls}>
                        <span className="stsrc-sr">{i + 1}</span>
                        {isM && <span className="stsrc-code">{r.code}</span>}
                        <span className="stsrc-name">{r.name}</span>
                        {isM && <><span>{r.segment}</span><span className="stsrc-hsn">{r.hsn}</span></>}
                        <span><input type="text" inputMode="decimal" aria-label={`Target price for ${r.name}`} className={`sta-pl-price${tried && !(Number(r.targetPrice) > 0) ? ' has-err' : ''}`} placeholder="Required"
                          value={r.targetPrice} onChange={e => patch(r.key, { targetPrice: e.target.value.replace(/[^\d.]/g, '') })} /></span>
                        <span>
                          {clarities[r.key] ? (
                            // Saved: the Figma green "✓ Text / Link / Pdf" chip; hover previews the note (V-T95), click edits it.
                            <Tooltip label={clarityPreview(clarities[r.key])}>
                              <button type="button" className="sta-pl-clarity is-set" data-clarity={r.key} onClick={() => setClaKey(r.key)}
                                aria-label={`Clarity: ${CLARITY_LABEL[clarities[r.key].type]} — edit`}>
                                <IcoCheck size={11} sw={3} />{CLARITY_LABEL[clarities[r.key].type]}
                              </button>
                            </Tooltip>
                          ) : (
                            <button type="button" className="sta-pl-clarity" data-clarity={r.key} onClick={() => setClaKey(r.key)}><IcoPlus size={11} sw={2.6} />Add clarity</button>
                          )}
                        </span>
                        <span><button type="button" className="sta-pl-del" title="Delete" aria-label={`Remove ${r.name}`} onClick={() => remove(r.key)}><IcoTrash /></button></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sta-foot">
          <button type="button" className="sta-btn sta-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="sta-btn sta-btn-primary" onClick={submit} disabled={saving} aria-busy={saving || undefined}>
            {saving
              ? <><span className="sct-spin" aria-hidden />{isEdit ? 'Updating…' : 'Assigning…'}</>
              : <>{isEdit ? <IcoEdit size={18} stroke="#fff" /> : <IcoCheckBox />} {isEdit ? 'Update Target' : 'Assign Target'}</>}
          </button>
        </div>
      </div>

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
