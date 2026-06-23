import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import { genProducts, type ReportRow } from './SourcingReportModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Assign Sourcing Target — two-stage wizard (static port of the prototype).
 *  Stage 1: Sourcing Details (ID auto, start today, due date).
 *  Stage 2: Product Details — From Product Master (multiselect) OR Manual
 *           Entry, feeding a Product List with Masters/Manual tabs.
 * Backend wiring comes later; "Assign Target" currently just toasts + closes.
 * ───────────────────────────────────────────────────────────────────────── */

type Product = { code: string; name: string; segment: string; hsn: string };
const PRODUCTS: Product[] = [
  { code: 'P-001', name: 'Premium Basmati Rice 1121 Sella (25kg)', segment: 'Rice', hsn: '10063020' },
  { code: 'P-002', name: 'Sharbati Wheat Grain (MP Origin) Export Quality', segment: 'Wheat', hsn: '10019990' },
  { code: 'P-003', name: 'Yellow Maize (Corn) Feed Grade 50kg', segment: 'Corn', hsn: '10059000' },
  { code: 'P-004', name: 'Turmeric Powder (Alleppey Finger — 5% Curcumin)', segment: 'Spices', hsn: '09103010' },
  { code: 'P-005', name: 'Cold Pressed Groundnut Oil (Filtered) 15 Ltr', segment: 'Oil', hsn: '15079010' },
  { code: 'P-006', name: 'Toor Dal (Arhar) Unpolished Premium 30kg', segment: 'Pulses', hsn: '07136000' },
  { code: 'P-007', name: 'Organic Soybean Seeds (Non-GMO) 40kg', segment: 'Oilseeds', hsn: '12010010' },
  { code: 'P-008', name: 'Red Chilli Whole (Teja S17) Stemless 10kg', segment: 'Spices', hsn: '09042110' },
  { code: 'P-009', name: 'Sona Masoori Rice (Steam) 26kg', segment: 'Rice', hsn: '10063090' },
  { code: 'P-010', name: 'Coriander Seeds (Eagle Quality) Sortex 25kg', segment: 'Spices', hsn: '09092110' },
  { code: 'P-011', name: 'Cumin Seeds (Jeera) Singapore 99% Pure 20kg', segment: 'Spices', hsn: '09093121' },
  { code: 'P-012', name: 'Refined Sunflower Oil (Edible) 15 Ltr Tin', segment: 'Oil', hsn: '15121110' },
  { code: 'P-013', name: 'Chana Dal (Bengal Gram Split) Premium 30kg', segment: 'Pulses', hsn: '07132000' },
  { code: 'P-014', name: 'Mustard Seeds (Black) Oil Grade 40kg', segment: 'Oilseeds', hsn: '12075010' },
  { code: 'P-015', name: 'Green Cardamom (Elaichi) 8mm Bold AGEB 5kg', segment: 'Spices', hsn: '09083110' },
  { code: 'P-016', name: 'Bajra (Pearl Millet) Feed Grade 50kg', segment: 'Millets', hsn: '10082900' },
];

type Member = { id: string; name: string; role: string };
const TEAM: Member[] = [
  { id: 'u1', name: 'Arjun Mehta', role: 'Procurement Lead' },
  { id: 'u2', name: 'Priya Sharma', role: 'Sourcing Manager' },
  { id: 'u3', name: 'Rohan Kulkarni', role: 'Category Buyer' },
  { id: 'u4', name: 'Sneha Patil', role: 'Supplier Coordinator' },
  { id: 'u5', name: 'Vikram Patel', role: 'Procurement Analyst' },
  { id: 'u6', name: 'Ananya Gupta', role: 'Supply Chain Officer' },
  { id: 'u7', name: 'Karan Singh', role: 'Purchase Executive' },
  { id: 'u8', name: 'Meera Krishnan', role: 'Sourcing Specialist' },
  { id: 'u9', name: 'Parth Lakare', role: 'Senior Buyer' },
];
const tInit = (n: string) => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

type Clarity = { type: 'text' | 'link' | 'pdf'; val: string } | null;
type MasterRow = { code: string; name: string; segment: string; hsn: string; price: string; clarity?: Clarity };
type ManualRow = { name: string; price: string; clarity?: Clarity };

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

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (s: string) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const LockIco = () => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;

export default function AssignSourcingTargetModal({ editRow = null, onClose }: { editRow?: ReportRow | null; onClose: () => void }) {
  const toast = useToast();
  const isEdit = !!editRow;
  const srcId = editRow?.id ?? 'SRC-001';
  const start = useMemo(() => editRow?.start ?? today(), [editRow]);
  // Pre-fill product rows when editing (from the same seeded generator the
  // Sourcing Report uses, so the lists line up).
  const initial = useMemo(() => {
    if (!editRow) return { source: 'master' as const, master: [] as MasterRow[], manual: [] as ManualRow[] };
    const gen = genProducts(editRow.id, editRow.products || 0, editRow.completed || 0, editRow.source);
    const strip = (s: string) => s.replace('₹', '').replace(/,/g, '');
    return {
      source: (editRow.source === 'Manual Entry' ? 'manual' : 'master') as 'master' | 'manual',
      master: gen.filter(p => p.type === 'master').map(p => ({ code: p.code, name: p.name, segment: p.segment || '—', hsn: p.hsn || '—', price: strip(p.price) })),
      manual: gen.filter(p => p.type === 'manual').map(p => ({ name: p.name, price: strip(p.price) })),
    };
  }, [editRow]);
  const [stage, setStage] = useState(1);
  const [due, setDue] = useState(editRow?.due ?? '');
  const [source, setSource] = useState<'master' | 'manual'>(initial.source);
  const [masterRows, setMasterRows] = useState<MasterRow[]>(initial.master);
  const [manualRows, setManualRows] = useState<ManualRow[]>(initial.manual);
  const [picks, setPicks] = useState<string[]>([]);
  const [pickQuery, setPickQuery] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [listTab, setListTab] = useState<'master' | 'manual'>(initial.source);
  const [mName, setMName] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [team, setTeam] = useState<string | null>(editRow?.assignee ?? null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [clarity, setClarity] = useState<{ kind: 'master' | 'manual'; idx: number } | null>(null);
  const [clType, setClType] = useState<'text' | 'link' | 'pdf'>('text');
  const [clVal, setClVal] = useState('');

  const openClarity = (kind: 'master' | 'manual', idx: number) => {
    const row = kind === 'master' ? masterRows[idx] : manualRows[idx];
    setClType(row?.clarity?.type ?? 'text');
    setClVal(row?.clarity?.val ?? '');
    setClarity({ kind, idx });
  };
  const saveClarity = () => {
    if (!clarity) return;
    const has = clType === 'pdf' ? !!clVal : !!clVal.trim();
    const c: Clarity = has ? { type: clType, val: clVal } : null;
    if (clarity.kind === 'master') setMasterRows(rows => rows.map((x, i) => i === clarity.idx ? { ...x, clarity: c } : x));
    else setManualRows(rows => rows.map((x, i) => i === clarity.idx ? { ...x, clarity: c } : x));
    setClarity(null);
  };
  const clarityTitle = clarity ? (clarity.kind === 'master' ? `${masterRows[clarity.idx]?.code} — ${masterRows[clarity.idx]?.name}` : manualRows[clarity.idx]?.name) : '';

  const teamList = TEAM.filter(m => { const q = teamSearch.toLowerCase(); return !q || (m.name + ' ' + m.role).toLowerCase().includes(q); });
  const openTeam = () => { setTeamPick(TEAM.find(m => m.name === team)?.id ?? null); setTeamSearch(''); setTeamOpen(true); };
  const togglePick = (code: string) => setPicks(p => p.includes(code) ? p.filter(c => c !== code) : [...p, code]);
  const addMaster = () => {
    if (!picks.length) { toast.warning('Pick products', 'Choose one or more products first.'); return; }
    setMasterRows(rows => {
      const have = new Set(rows.map(r => r.code));
      const add = picks.filter(c => !have.has(c)).map(c => { const p = PRODUCTS.find(x => x.code === c)!; return { code: p.code, name: p.name, segment: p.segment, hsn: p.hsn, price: '' }; });
      return [...rows, ...add];
    });
    setPicks([]); setListTab('master');
  };
  const addManual = () => {
    if (!mName.trim()) { toast.warning('Product name', 'Please enter a product name.'); return; }
    if (!mPrice.trim()) { toast.warning('Target price', 'Please enter a target price.'); return; }
    setManualRows(rows => [...rows, { name: mName.trim(), price: mPrice.trim() }]);
    setMName(''); setMPrice(''); setListTab('manual');
  };
  const goAssign = () => {
    const n = masterRows.length + manualRows.length;
    if (isEdit) toast.success('Sourcing target updated', `${srcId} updated with ${n} product(s).`);
    else toast.success('Sourcing target assigned', `${srcId} created with ${n} product(s).`);
    onClose();
  };

  const pickList = PRODUCTS.filter(p => { const q = pickQuery.toLowerCase(); return !q || (p.code + ' ' + p.name).toLowerCase().includes(q); });

  return createPortal(
    <div className="ast-ov" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="ast-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="ast-head">
          <div className="ast-head-ico" style={isEdit ? { background: 'linear-gradient(135deg,#0891b2,#0e7490)' } : undefined}>
            {isEdit
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
          </div>
          <div style={{ flex: 1 }}><div className="ast-title">{isEdit ? `Edit Sourcing Target — ${srcId}` : 'Assign Sourcing Target'}</div><div className="ast-sub">{isEdit ? 'Update sourcing details and product list.' : 'Create a sourcing target across products.'}</div></div>
          <button className={`ast-head-btn ${team ? 'is-set' : ''}`} onClick={openTeam}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            <span>{team || 'Assign to Team Member'}</span>
          </button>
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
        <div className="ast-body">
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
                    <div className="ast-inputwrap is-frozen"><span className="ast-input-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg></span><input type="text" value={srcId} readOnly tabIndex={-1} className="ast-readonly has-ico" /><span className="ast-freeze-ico"><LockIco /></span></div>
                  </div>
                  <div className="ast-srcgrid-sep" />
                  <div className="ast-field">
                    <label>Start Date <span className="ast-lock"><LockIco /> Today</span></label>
                    <div className="ast-inputwrap is-frozen"><span className="ast-input-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></span><input type="text" value={fmt(start)} readOnly tabIndex={-1} className="ast-readonly has-ico" /><span className="ast-freeze-ico"><LockIco /></span></div>
                  </div>
                  <div className="ast-srcgrid-sep" />
                  <div className="ast-field">
                    <label>Due Date <span className="ast-req">*</span></label>
                    <div className="ast-inputwrap ast-inputwrap--active"><span className="ast-input-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg></span><input type="date" value={due} min={start} onChange={e => setDue(e.target.value)} className="has-ico" /></div>
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
                  <div className="ast-field" style={{ marginBottom: 13, ...(isEdit ? { pointerEvents: 'none', opacity: 0.7 } as React.CSSProperties : {}) }}>
                    <label>I want to source from <span className="ast-req">*</span>{isEdit && <span style={{ fontSize: 10, color: '#0891b2', fontWeight: 600, marginLeft: 6, textTransform: 'none' }}>🔒 Locked</span>}</label>
                    <div className="ast-radios">
                      <label className={`ast-radio ${source === 'master' ? 'is-sel' : ''}`} onClick={() => !isEdit && setSource('master')}><span className="ast-radio-dot" /><span className="ast-radio-txt"><b>From Product Master</b><small>Pick existing products</small></span></label>
                      <label className={`ast-radio ${source === 'manual' ? 'is-sel' : ''}`} onClick={() => !isEdit && setSource('manual')}><span className="ast-radio-dot" /><span className="ast-radio-txt"><b>Manual Product Entry</b><small>Type a new product</small></span></label>
                    </div>
                  </div>

                  {!isEdit && (source === 'master' ? (
                    <div className="ast-field">
                      <label>Select Products <span className="ast-hint">(choose one or more, then click Add)</span></label>
                      <div className="asrc-picker">
                        <div className="asrc-pick-chips">
                          {picks.length === 0 ? <span className="asrc-pick-ph">No products chosen yet</span> : picks.map(code => {
                            const p = PRODUCTS.find(x => x.code === code)!;
                            return <span className="ast-ms-chip" key={code}>{p.code} — {p.name}<button type="button" onClick={() => togglePick(code)}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button></span>;
                          })}
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
                      <div className="ast-field"><label>Target Price (₹) <span className="ast-req">*</span></label><input type="text" value={mPrice} placeholder="Required" onChange={e => setMPrice(e.target.value)} /></div>
                      <div className="ast-field"><label>&nbsp;</label><button type="button" className="ast-btn ast-btn-primary" style={{ height: 42, justifyContent: 'center' }} onClick={addManual}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Add to List</button></div>
                    </div>
                  ))}
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
                  {listTab === 'master' ? (
                    masterRows.length === 0 ? <div className="ast-plist-empty">No master products added yet. Select from the dropdown above and click Add.</div> : (
                      <div className="ast-plist">
                        <div className="asrc-row asrc-row--head asrc-row--m"><span>Sr</span><span>Product Code</span><span>Product Name</span><span>Segment</span><span>HSN Code</span><span>Target Price (₹) <b className="asrc-th-req">*</b></span><span>Clarity <i className="asrc-th-opt">(optional)</i></span><span /></div>
                        {masterRows.map((r, i) => (
                          <div className="asrc-row asrc-row--m" key={r.code}>
                            <span className="asrc-sr">{i + 1}</span>
                            <span className="asrc-code">{r.code}</span>
                            <span className="asrc-name">{r.name}</span>
                            <span>{r.segment}</span>
                            <span className="asrc-hsn">{r.hsn}</span>
                            <span><input type="text" className="ast-pl-price" value={r.price} placeholder="Required" onChange={e => setMasterRows(rows => rows.map((x, xi) => xi === i ? { ...x, price: e.target.value } : x))} /></span>
                            <span><ClarityBtn clarity={r.clarity} onClick={() => openClarity('master', i)} /></span>
                            <span><button type="button" className="ast-pl-del" title="Delete" onClick={() => setMasterRows(rows => rows.filter((_, xi) => xi !== i))}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></span>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    manualRows.length === 0 ? <div className="ast-plist-empty">No manual products added yet. Fill the fields above and click Add to List.</div> : (
                      <div className="ast-plist">
                        <div className="asrc-row asrc-row--head asrc-row--n"><span>Sr</span><span>Product Name</span><span>Target Price (₹) <b className="asrc-th-req">*</b></span><span>Clarity <i className="asrc-th-opt">(optional)</i></span><span /></div>
                        {manualRows.map((r, i) => (
                          <div className="asrc-row asrc-row--n" key={i}>
                            <span className="asrc-sr">{i + 1}</span>
                            <span><input type="text" className="ast-pl-price" style={{ fontWeight: 600 }} value={r.name} onChange={e => setManualRows(rows => rows.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} /></span>
                            <span><input type="text" className="ast-pl-price" value={r.price} placeholder="Required" onChange={e => setManualRows(rows => rows.map((x, xi) => xi === i ? { ...x, price: e.target.value } : x))} /></span>
                            <span><ClarityBtn clarity={r.clarity} onClick={() => openClarity('manual', i)} /></span>
                            <span><button type="button" className="ast-pl-del" title="Delete" onClick={() => setManualRows(rows => rows.filter((_, xi) => xi !== i))}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button></span>
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
              <button className="ast-btn ast-btn-primary" onClick={() => setStage(2)}>Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
            </>
          ) : (
            <>
              <button className="ast-btn ast-btn-ghost" onClick={() => setStage(1)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg> Previous</button>
              <button className="ast-btn ast-btn-primary" onClick={goAssign}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> {isEdit ? 'Update Target' : 'Assign Target'}</button>
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
              <button className="ast-btn ast-btn-ghost" onClick={() => setTeamOpen(false)}>Cancel</button>
              <button className="ast-btn ast-btn-primary" disabled={!teamPick} onClick={() => { const m = TEAM.find(x => x.id === teamPick); if (m) setTeam(m.name); setTeamOpen(false); }}>Assign Member</button>
            </div>
          </div>
        </div>
      )}

      {/* Product Clarity popup */}
      {clarity && (
        <div className="astp-ov" onClick={e => { if (e.target === e.currentTarget) setClarity(null); }}>
          <div className="astp-pop" style={{ maxWidth: 440 }}>
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
                  <label className="ast-pdf">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <span>{clVal || 'Click to upload a PDF specification'}</span>
                    <input type="file" accept="application/pdf" onChange={e => setClVal(e.target.files?.[0]?.name ?? '')} />
                  </label>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 14 }}>
                <button className="ast-btn ast-btn-ghost" onClick={() => setClarity(null)}>Cancel</button>
                <button className="ast-btn ast-btn-primary" onClick={saveClarity}>Save Clarity</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

const CSS = `
.ast-ov{position:fixed;inset:0;background:rgba(8,30,45,.58);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:2200000;display:flex;align-items:center;justify-content:center;padding:22px;font-family:'DM Sans','Inter',system-ui,sans-serif;}
.ast-modal{background:#fff;border-radius:20px;width:100%;max-width:1180px;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 40px 90px -20px rgba(8,40,60,.55),0 0 0 1px rgba(8,40,60,.06);}
.ast-head{position:relative;display:flex;align-items:center;gap:14px;padding:24px 26px 25px;background:linear-gradient(118deg,#0e7490 0%,#0891b2 38%,#06b6d4 70%,#22d3ee 100%);color:#fff;overflow:hidden;}
.ast-head::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.16) 1px,transparent 1.4px);background-size:18px 18px;opacity:.45;pointer-events:none;-webkit-mask-image:linear-gradient(105deg,transparent 40%,#000 100%);mask-image:linear-gradient(105deg,transparent 40%,#000 100%);}
.ast-head::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 92% -60%,rgba(255,255,255,.4),transparent 50%);pointer-events:none;}
.ast-head-accent{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,#bef264,#5eead4 40%,#67e8f9 70%,#a5b4fc);opacity:.9;}
.ast-head-ico{width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.17);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 0 1px rgba(255,255,255,.28) inset,0 6px 16px rgba(0,0,0,.16);position:relative;z-index:1;}
.ast-title{font-size:17px;font-weight:700;letter-spacing:-.45px;position:relative;z-index:1;}
.ast-sub{font-size:11.5px;opacity:.9;margin-top:2px;font-weight:500;letter-spacing:.1px;position:relative;z-index:1;}
.ast-close{margin-left:auto;width:32px;height:32px;border-radius:10px;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,transform .15s;position:relative;z-index:1;}
.ast-close:hover{background:rgba(255,255,255,.3);transform:rotate(90deg);}
.ast-head-btn{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:11.5px;font-weight:600;color:#0e7490;background:#fff;border:none;border-radius:9px;padding:8px 14px;cursor:pointer;flex-shrink:0;box-shadow:0 3px 10px rgba(0,0,0,.16);transition:transform .15s,box-shadow .15s;max-width:260px;position:relative;z-index:1;}
.ast-head-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ast-head-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.2);}
.ast-head-btn.is-set{color:#fff;background:linear-gradient(135deg,#0e7490,#155e75);box-shadow:0 3px 10px rgba(8,40,60,.3);}
.ast-head-btn + .ast-close{margin-left:0;}
.ast-body{padding:14px 20px;overflow-y:auto;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:11px;background:linear-gradient(180deg,#f4fcfe 0%,#fbfeff 55%,#ffffff 100%);}
.ast-steps{display:flex;align-items:center;gap:10px;padding:11px 20px;background:linear-gradient(180deg,#ecfbfe,#f5fdfe);border-bottom:1px solid #dcf0f5;}
.ast-scard{flex:1;position:relative;overflow:hidden;display:flex;align-items:center;gap:11px;padding:9px 14px;border-radius:13px;border:1.5px solid #d2edf3;background:rgba(255,255,255,.7);transition:all .26s cubic-bezier(.22,1,.36,1);}
.ast-scard::after{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
.ast-scard-glow{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .3s;background:radial-gradient(ellipse at 0% 0%,rgba(34,211,238,.22),transparent 62%);}
.ast-scard.is-current{border-color:#22d3ee;background:linear-gradient(135deg,#ecfeff,#d6f6fc);box-shadow:0 8px 22px -6px rgba(6,182,212,.4),0 0 0 1px rgba(34,211,238,.3),0 1px 0 rgba(255,255,255,.85) inset;}
.ast-scard.is-current .ast-scard-glow{opacity:1;}
.ast-scard.is-done{border-color:#86efac;background:linear-gradient(135deg,#f0fdf4,#d8f9e2);box-shadow:0 6px 18px -6px rgba(34,197,94,.35),0 1px 0 rgba(255,255,255,.75) inset;}
.ast-scard-ico{width:34px;height:34px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#a7b8c2,#869aa8);box-shadow:0 3px 9px rgba(100,116,139,.3);position:relative;z-index:1;transition:all .26s;}
.ast-scard.is-current .ast-scard-ico{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 6px 16px -2px rgba(8,145,178,.55),0 0 0 3px rgba(34,211,238,.16),0 1px 0 rgba(255,255,255,.4) inset;}
.ast-scard.is-done .ast-scard-ico{background:linear-gradient(135deg,#34d399,#16a34a);box-shadow:0 6px 16px -2px rgba(34,197,94,.5),0 0 0 3px rgba(74,222,128,.16),0 1px 0 rgba(255,255,255,.4) inset;}
.ast-scard-ico svg{width:15px;height:15px;}
.ast-scard-txt{flex:1;min-width:0;position:relative;z-index:1;}
.ast-scard-stage{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;line-height:1;margin-bottom:3px;}
.ast-scard.is-current .ast-scard-stage{color:#0891b2;}
.ast-scard.is-done .ast-scard-stage{color:#16a34a;}
.ast-scard-name{font-size:12.5px;font-weight:600;color:#475569;letter-spacing:-.2px;line-height:1.05;}
.ast-scard-desc{font-size:9.5px;font-weight:500;color:#94a3b8;margin-top:2px;}
.ast-scard.is-current .ast-scard-name{color:#0c4a6e;} .ast-scard.is-current .ast-scard-desc{color:#0e7490;}
.ast-scard.is-done .ast-scard-name{color:#166534;} .ast-scard.is-done .ast-scard-desc{color:#16a34a;}
.ast-scard-badge{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#94a3b8;background:#fff;border:1.5px solid #cbd5e1;position:relative;z-index:1;box-shadow:0 2px 5px rgba(15,23,42,.08);transition:all .26s;}
.ast-scard.is-current .ast-scard-badge{color:#fff;background:linear-gradient(135deg,#0891b2,#0e7490);border-color:#fff;box-shadow:0 4px 10px rgba(8,145,178,.4);}
.ast-scard.is-done .ast-scard-badge{color:#fff;background:linear-gradient(135deg,#16a34a,#15803d);border-color:#fff;box-shadow:0 4px 10px rgba(22,163,74,.4);}
.ast-scard-link{flex:0 0 28px;align-self:center;height:2.5px;border-radius:3px;background:#c4e7ef;position:relative;overflow:hidden;transition:background .2s;}
.ast-scard-link.is-done{background:linear-gradient(90deg,#34d399,#16a34a);}
.ast-readonly{background:linear-gradient(135deg,#f1f6f9,#eef4f7) !important;color:#475569 !important;cursor:default;font-weight:600;border-color:#e3ecf1 !important;}
@media(max-width:600px){.ast-scard-desc{display:none;}.ast-scard-link{flex-basis:14px;}.ast-srcgrid{grid-template-columns:1fr;gap:12px;}.ast-srcgrid-sep{display:none;}.ast-grid-3{grid-template-columns:1fr;}.ast-radios{flex-direction:column;}}
.ast-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;}
.ast-grid-3{grid-template-columns:1fr 1fr 1fr;}
.ast-field{display:flex;flex-direction:column;gap:6px;}
.ast-field label{font-size:10.5px;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;}
.ast-req{color:#ef4444;}
.ast-field input,.ast-field select,.ast-field textarea{font-family:inherit;font-size:12.5px;color:#0f172a;background:#f7fafc;border:1.5px solid #e6edf2;border-radius:10px;padding:0 13px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s;width:100%;height:42px;box-sizing:border-box;}
.ast-field input::placeholder{color:#aab8c5;}
.ast-field input:hover{border-color:#cfe2ea;}
.ast-field input:focus{border-color:#22d3ee;background:#fff;box-shadow:0 0 0 3px rgba(34,211,238,.16);}
.ast-inputwrap{position:relative;display:flex;align-items:center;}
.ast-input-ico{position:absolute;left:12px;display:flex;align-items:center;color:#94a3b8;pointer-events:none;z-index:1;}
.ast-field input.has-ico{padding-left:38px;}
.ast-inputwrap:focus-within .ast-input-ico{color:#0891b2;}
.ast-lock{display:inline-flex;align-items:center;gap:3px;font-size:8.5px;font-weight:600;letter-spacing:.04em;color:#7c93a3;background:#eef4f7;border:1px solid #dde7ed;border-radius:999px;padding:2px 7px 2px 6px;margin-left:5px;text-transform:none;vertical-align:middle;}
.ast-hint{font-size:9.5px;font-weight:600;color:#94a3b8;text-transform:none;letter-spacing:0;margin-left:6px;}
.ast-inputwrap--active .ast-input-ico{color:#0891b2;}
.ast-inputwrap--active input{border-color:#67e8f9;background:#fff;box-shadow:0 0 0 3px rgba(34,211,238,.13),0 4px 12px -4px rgba(8,145,178,.25);}
.ast-inputwrap.is-frozen input{padding-right:34px;background:linear-gradient(135deg,#f3f7fa,#eef3f7) !important;border:1.5px dashed #d3dee6 !important;color:#5a6b7b !important;cursor:not-allowed;}
.ast-inputwrap.is-frozen .ast-input-ico{color:#9fb0bf;}
.ast-freeze-ico{position:absolute;right:11px;display:flex;align-items:center;color:#a8b6c4;pointer-events:none;}
.ast-srccard{border-radius:16px;background:#fff;border:1px solid #e2edf3;box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 12px 30px -12px rgba(15,40,60,.22);}
.ast-srccard-head{position:relative;display:flex;align-items:center;gap:11px;padding:11px 16px;background:linear-gradient(120deg,#eef4ff,#ecfeff 60%,#f0fdff);border-bottom:1px solid #e2edf3;overflow:hidden;border-radius:16px 16px 0 0;}
.ast-srccard-head::after{content:'';position:absolute;right:-30px;top:-40px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,.1),transparent 70%);pointer-events:none;}
.ast-srccard-ico{width:32px;height:32px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#818cf8,#4f46e5);box-shadow:0 5px 13px -3px rgba(79,70,229,.55),0 1px 0 rgba(255,255,255,.4) inset;position:relative;z-index:1;}
.ast-srccard-htxt{display:flex;flex-direction:column;gap:1px;position:relative;z-index:1;}
.ast-srccard-htxt b{font-size:13.5px;font-weight:600;color:#0f172a;letter-spacing:-.25px;line-height:1.1;}
.ast-srccard-htxt small{font-size:10.5px;font-weight:500;color:#8b9bb0;}
.ast-srccard-tag{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#4f46e5;background:#fff;border:1px solid #ddd9fb;border-radius:999px;padding:4px 10px;position:relative;z-index:1;box-shadow:0 2px 6px -2px rgba(79,70,229,.3);}
.ast-srccard-dot{width:6px;height:6px;border-radius:50%;background:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18);}
.ast-srccard-body{padding:13px 16px 14px;}
.ast-srcgrid{display:grid;grid-template-columns:1fr 1px 1fr 1px 1fr;align-items:start;gap:16px;}
.ast-srccard-head--teal{background:linear-gradient(120deg,#ecfeff,#e0fbff 60%,#effdff);}
.ast-srccard-head--teal::after{background:radial-gradient(circle,rgba(6,182,212,.12),transparent 70%);}
.ast-srccard-ico--teal{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 5px 13px -3px rgba(8,145,178,.55),0 1px 0 rgba(255,255,255,.4) inset;}
.ast-srccard-tag--teal{color:#0891b2;border-color:#a5e8f2;box-shadow:0 2px 6px -2px rgba(8,145,178,.3);}
.ast-srccard-dot--teal{background:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.18);}
.ast-srccard-head .asrc-listtabs{margin-left:auto;margin-bottom:0;}
.ast-srccard-head .asrc-ltab{padding:6px 11px;font-size:11px;background:rgba(255,255,255,.7);}
.ast-srcgrid-sep{align-self:stretch;width:1px;background:linear-gradient(180deg,transparent,#e6edf2 30%,#e6edf2 70%,transparent);}
.ast-radios{display:flex;gap:10px;}
.ast-radio{flex:1;display:flex;align-items:center;gap:11px;padding:10px 14px;border:1.5px solid #e6edf2;border-radius:12px;background:#f7fafc;cursor:pointer;transition:all .16s;position:relative;overflow:hidden;}
.ast-radio:hover{border-color:#bfe6ef;background:#f0fdff;}
.ast-radio.is-sel{border-color:#22d3ee;background:linear-gradient(135deg,#ecfeff,#e0fbff);box-shadow:0 4px 14px -4px rgba(6,182,212,.3);}
.ast-radio-dot{width:19px;height:19px;border-radius:50%;border:2px solid #cbd5e1;flex-shrink:0;position:relative;transition:all .15s;background:#fff;}
.ast-radio.is-sel .ast-radio-dot{border-color:#0891b2;}
.ast-radio.is-sel .ast-radio-dot::after{content:'';position:absolute;inset:3px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#0891b2);}
.ast-radio-txt{display:flex;flex-direction:column;gap:2px;}
.ast-radio-txt b{font-size:12.5px;font-weight:600;color:#334155;letter-spacing:-.1px;}
.ast-radio-txt small{font-size:10px;color:#94a3b8;}
.ast-radio.is-sel .ast-radio-txt b{color:#0c4a6e;}
.ast-ms-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#0e7490;background:#e0fbff;border:1px solid #a5f3fc;border-radius:999px;padding:4px 6px 4px 10px;}
.ast-ms-chip button{display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:none;background:rgba(8,145,178,.15);color:#0e7490;cursor:pointer;padding:0;}
.ast-ms-chip button:hover{background:rgba(8,145,178,.3);}
.asrc-picker{border:1.5px solid #e6edf2;border-radius:13px;background:linear-gradient(180deg,#f7fafc,#f4fbfd);padding:11px;display:flex;flex-direction:column;gap:10px;}
.asrc-pick-chips{display:flex;flex-wrap:wrap;gap:6px;min-height:24px;align-items:center;}
.asrc-pick-ph{font-size:11.5px;color:#aab8c5;padding:2px 4px;}
.asrc-pick-search{position:relative;display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid #e4edf2;border-radius:10px;padding:0 6px 0 12px;height:44px;transition:border-color .16s,box-shadow .16s;}
.asrc-pick-search:focus-within{border-color:#67e8f9;box-shadow:0 0 0 3px rgba(34,211,238,.14);}
.asrc-pick-search > svg{flex-shrink:0;}
.asrc-pick-search input{flex:1;min-width:0;border:none;outline:none;box-shadow:none;font-family:inherit;font-size:12.5px;color:#0f172a;background:transparent;height:100%;}
.asrc-pick-add{flex-shrink:0;height:32px;padding:0 15px;font-size:11.5px;border-radius:8px;}
.asrc-pick-list{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:50;background:#fff;border:1.5px solid #e4edf2;border-radius:11px;box-shadow:0 12px 30px -8px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.06);padding:5px;max-height:0;opacity:0;overflow:hidden;visibility:hidden;display:flex;flex-direction:column;gap:3px;transform:translateY(-4px);transition:max-height .2s ease,opacity .16s ease,transform .2s ease;}
.asrc-pick-list.is-open{max-height:248px;opacity:1;visibility:visible;overflow-y:auto;transform:translateY(0);}
.asrc-pick-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font-family:inherit;background:#fff;border:1px solid transparent;border-radius:8px;padding:9px 11px;cursor:pointer;transition:background .12s,border-color .12s;}
.asrc-pick-opt:hover{background:#f0fdff;}
.asrc-pick-opt.is-sel{border-color:#22d3ee;background:#ecfeff;}
.asrc-pick-opt.is-added{opacity:.5;cursor:default;}
.asrc-pick-opt.is-added:hover{background:#fff;}
.asrc-pick-check{width:18px;height:18px;border-radius:6px;border:1.5px solid #cbd5e1;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .12s,background .12s;}
.asrc-pick-opt.is-sel .asrc-pick-check,.asrc-pick-opt.is-added .asrc-pick-check{border-color:#22d3ee;background:#cffafe;}
.asrc-pick-txt{font-size:12.5px;color:#334155;font-weight:500;line-height:1.4;}
.asrc-pick-txt b{font-weight:600;color:#0f172a;}
.asrc-pick-txt i{font-style:normal;color:#16a34a;font-weight:600;font-size:10.5px;}
.asrc-listtabs{display:flex;gap:8px;margin-bottom:12px;}
.asrc-ltab{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12px;font-weight:600;color:#64748b;background:#f4f8fb;border:1.5px solid #e6edf2;border-radius:10px;padding:8px 14px;cursor:pointer;transition:all .15s;}
.asrc-ltab:hover{border-color:#bfe6ef;color:#0e7490;}
.asrc-ltab.is-active{color:#0891b2;background:linear-gradient(135deg,#ecfeff,#e0fbff);border-color:#67e8f9;box-shadow:0 3px 10px -3px rgba(6,182,212,.3);}
.asrc-ltab-c{font-size:10px;font-weight:600;color:#0e7490;background:#cffafe;border:1px solid #a5f3fc;border-radius:999px;padding:1px 7px;min-width:18px;text-align:center;}
.asrc-ltab.is-active .asrc-ltab-c{background:#fff;}
.ast-plist{display:flex;flex-direction:column;border:1px solid #e6edf2;border-radius:12px;overflow-x:auto;background:#fff;box-shadow:0 2px 8px -3px rgba(15,40,60,.08);}
.asrc-row{display:grid;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #eef4f7;font-size:11.5px;}
.asrc-row:last-child{border-bottom:none;}
.asrc-row:not(.asrc-row--head):hover{background:#f4fcfe;}
.asrc-row--m{grid-template-columns:40px 86px minmax(150px,1.4fr) minmax(90px,1fr) 92px 116px 116px 38px;min-width:760px;}
.asrc-row--n{grid-template-columns:40px minmax(180px,2fr) 130px 130px 38px;min-width:560px;}
.asrc-row--head{background:linear-gradient(180deg,#f4fbfd,#eef8fb);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#7c93a3;}
.asrc-th-req{color:#ef4444;font-weight:600;}
.asrc-th-opt{font-style:normal;font-weight:600;color:#aab8c5;text-transform:none;letter-spacing:0;}
.asrc-sr{font-weight:600;color:#64748b;}
.asrc-code{font-weight:600;color:#0891b2;font-family:ui-monospace,Menlo,Consolas,monospace;}
.asrc-name{font-weight:600;color:#0f172a;}
.asrc-hsn{color:#475569;font-family:ui-monospace,Menlo,Consolas,monospace;}
.ast-pl-price{width:100%;height:34px;border:1.5px solid #e6edf2;border-radius:9px;padding:0 9px;font-family:inherit;font-size:11.5px;color:#0f172a;background:#f7fafc;outline:none;transition:border-color .15s,box-shadow .15s;box-sizing:border-box;}
.ast-pl-price:focus{border-color:#22d3ee;background:#fff;box-shadow:0 0 0 3px rgba(34,211,238,.15);}
.ast-pl-clarity{display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:10.5px;font-weight:600;color:#0891b2;background:#ecfeff;border:1px solid #a5f3fc;border-radius:9px;padding:7px 10px;cursor:pointer;white-space:nowrap;transition:all .14s;}
.ast-pl-clarity:hover{background:#cffafe;border-color:#67e8f9;}
.ast-pl-del{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:1px solid #fecaca;background:#fef2f2;color:#ef4444;cursor:pointer;transition:all .14s;}
.ast-pl-del:hover{background:#fee2e2;border-color:#fca5a5;}
.ast-plist-empty{font-size:11.5px;color:#94a3b8;padding:20px;text-align:center;border:1.5px dashed #cfe6ec;border-radius:12px;background:linear-gradient(180deg,#f7fcfd,#fff);}
.ast-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid #eaf1f5;background:linear-gradient(180deg,#fff,#f7fcfd);}
.ast-btn{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:600;border-radius:11px;padding:11px 20px;cursor:pointer;border:none;transition:all .16s;letter-spacing:-.1px;}
.ast-btn-ghost{background:#fff;color:#475569;border:1.5px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.05);}
.ast-btn-ghost:hover{background:#f1f5f9;border-color:#cbd5e1;}
.ast-btn-primary{background:linear-gradient(135deg,#22d3ee,#0891b2 55%,#0e7490);color:#fff;box-shadow:0 6px 18px -4px rgba(8,145,178,.55),0 1px 0 rgba(255,255,255,.25) inset;}
.ast-btn-primary:hover{transform:translateY(-1px);box-shadow:0 10px 24px -4px rgba(8,145,178,.62),0 1px 0 rgba(255,255,255,.25) inset;}
@media(max-width:760px){.ast-ov{padding:0;align-items:flex-end;}.ast-modal{max-width:100%;max-height:96vh;border-radius:18px 18px 0 0;}.ast-head{flex-wrap:wrap;padding:13px 15px;}.ast-head-btn{order:3;margin-left:0;width:100%;justify-content:center;margin-top:4px;}.ast-steps{flex-direction:column;gap:8px;}.ast-scard-link{display:none;}.ast-foot{flex-direction:column-reverse;gap:8px;}.ast-foot .ast-btn{width:100%;justify-content:center;}}
/* team picker */
.astp-ov{position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(5px);z-index:2300000;display:flex;align-items:center;justify-content:center;padding:20px;}
.astp-pop{background:#fff;border-radius:16px;width:100%;max-width:400px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 28px 70px rgba(8,40,60,.42);}
.astp-head{display:flex;align-items:center;gap:11px;padding:14px 15px;background:linear-gradient(120deg,#06b6d4,#0891b2,#0e7490);color:#fff;}
.astp-head-ico{width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.astp-title{font-size:13.5px;font-weight:600;letter-spacing:-.2px;}
.astp-sub{font-size:10.5px;opacity:.9;margin-top:1px;}
.astp-close{margin-left:auto;width:26px;height:26px;border-radius:7px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.astp-close:hover{background:rgba(255,255,255,.3);}
.astp-body{padding:8px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;}
.astp-row{display:flex;align-items:center;gap:11px;width:100%;text-align:left;font-family:inherit;background:#fff;border:1.5px solid #eef2f7;border-radius:11px;padding:9px 11px;cursor:pointer;transition:all .14s;}
.astp-row:hover{border-color:#a5f3fc;background:#f0fdff;}
.astp-row.is-sel{border-color:#22d3ee;background:#ecfeff;box-shadow:0 2px 8px rgba(6,182,212,.14);}
.astp-av{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;font-weight:600;font-size:14px;display:flex;align-items:center;justify-content:center;}
.astp-main{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;}
.astp-name{font-size:12.5px;font-weight:600;color:#0f172a;}
.astp-role{font-size:10.5px;font-weight:500;color:#64748b;}
.astp-check{flex-shrink:0;display:flex;align-items:center;}
.astp-radio{width:18px;height:18px;border-radius:50%;border:2px solid #cbd5e1;display:block;background:#fff;}
.astp-row:hover .astp-radio{border-color:#67e8f9;}
.astp-search{display:flex;align-items:center;gap:9px;margin:10px 14px 4px;padding:0 12px;height:40px;background:#f7fafc;border:1.5px solid #e6edf2;border-radius:10px;transition:border-color .15s,box-shadow .15s;}
.astp-search:focus-within{border-color:#67e8f9;background:#fff;box-shadow:0 0 0 3px rgba(34,211,238,.13);}
.astp-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:12.5px;color:#0f172a;height:100%;}
.astp-empty{padding:24px 14px;text-align:center;color:#94a3b8;font-size:12px;}
.astp-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 14px;border-top:1px solid #eef2f7;background:linear-gradient(180deg,#fff,#f7fcfd);}
.astp-foot .ast-btn{padding:9px 16px;}
.astp-foot .ast-btn-primary:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:0 3px 9px -3px rgba(8,145,178,.4);}
/* clarity popup body */
.ast-tabs{display:flex;gap:7px;margin-bottom:9px;}
.ast-tab{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:11.5px;font-weight:600;color:#64748b;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:9px;padding:7px 12px;cursor:pointer;transition:all .15s;}
.ast-tab:hover{border-color:#cbd5e1;}
.ast-tab.is-active{color:#0891b2;background:#ecfeff;border-color:#67e8f9;box-shadow:0 2px 6px rgba(6,182,212,.14);}
.ast-clarity-body textarea,.ast-clarity-body input[type=text]{width:100%;box-sizing:border-box;font-family:inherit;font-size:12.5px;color:#0f172a;background:#f7fafc;border:1.5px solid #e6edf2;border-radius:10px;padding:11px 13px;outline:none;transition:border-color .15s,box-shadow .15s;}
.ast-clarity-body textarea{min-height:96px;resize:vertical;}
.ast-clarity-body input[type=text]{height:42px;padding:0 13px;}
.ast-clarity-body textarea:focus,.ast-clarity-body input[type=text]:focus{border-color:#22d3ee;background:#fff;box-shadow:0 0 0 3px rgba(34,211,238,.16);}
.ast-clarity-body textarea::placeholder,.ast-clarity-body input::placeholder{color:#aab8c5;}
.ast-pdf{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 14px;border:1.5px dashed #cfe6ec;border-radius:11px;background:linear-gradient(180deg,#f7fcfd,#fff);color:#0891b2;font-size:11.5px;font-weight:600;cursor:pointer;text-align:center;}
.ast-pdf:hover{border-color:#67e8f9;background:#f0fdff;}
.ast-pdf input[type=file]{display:none;}
/* ── Dark mode ─────────────────────────────────────────────────────────── */
[data-bs-theme="dark"] .ast-modal{background:#0e1b24;}
[data-bs-theme="dark"] .ast-body{background:linear-gradient(180deg,#0d1922,#0b151c);}
[data-bs-theme="dark"] .ast-steps{background:linear-gradient(180deg,#102530,#0d1f28);border-bottom-color:rgba(34,211,238,.14);}
[data-bs-theme="dark"] .ast-scard{background:rgba(255,255,255,.03);border-color:rgba(34,211,238,.16);}
[data-bs-theme="dark"] .ast-scard-name{color:#cbd5e1;}
[data-bs-theme="dark"] .ast-scard.is-current{background:linear-gradient(135deg,rgba(34,211,238,.12),rgba(8,145,178,.16));}
[data-bs-theme="dark"] .ast-scard.is-current .ast-scard-name{color:#e2faff;}
[data-bs-theme="dark"] .ast-scard.is-done{background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(22,163,74,.16));}
[data-bs-theme="dark"] .ast-srccard{background:#13242e;border-color:rgba(34,211,238,.16);}
[data-bs-theme="dark"] .ast-srccard-head{background:linear-gradient(120deg,#15202e,#13242e);border-bottom-color:rgba(255,255,255,.06);}
[data-bs-theme="dark"] .ast-srccard-head--teal{background:linear-gradient(120deg,#0f2630,#102e38);}
[data-bs-theme="dark"] .ast-srccard-htxt b{color:#e2e8f0;}
[data-bs-theme="dark"] .ast-srccard-htxt small{color:#94a3b8;}
[data-bs-theme="dark"] .ast-srccard-tag{background:rgba(255,255,255,.05);}
[data-bs-theme="dark"] .ast-field label{color:#94a3b8;}
[data-bs-theme="dark"] .ast-field input,[data-bs-theme="dark"] .ast-field select{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:#e2e8f0;}
[data-bs-theme="dark"] .ast-field input::placeholder{color:#64748b;}
[data-bs-theme="dark"] .ast-readonly{background:rgba(255,255,255,.05) !important;color:#cbd5e1 !important;border-color:rgba(255,255,255,.1) !important;}
[data-bs-theme="dark"] .ast-inputwrap.is-frozen input{background:rgba(255,255,255,.03) !important;border-color:rgba(255,255,255,.12) !important;color:#94a3b8 !important;}
[data-bs-theme="dark"] .ast-radio{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);}
[data-bs-theme="dark"] .ast-radio.is-sel{background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(6,182,212,.1));border-color:rgba(34,211,238,.45);}
[data-bs-theme="dark"] .ast-radio-txt b{color:#cbd5e1;}
[data-bs-theme="dark"] .ast-radio.is-sel .ast-radio-txt b{color:#e2faff;}
[data-bs-theme="dark"] .asrc-picker{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);}
[data-bs-theme="dark"] .asrc-pick-search{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);}
[data-bs-theme="dark"] .asrc-pick-search input{color:#e2e8f0;}
[data-bs-theme="dark"] .asrc-pick-list{background:#13242e;border-color:rgba(34,211,238,.2);}
[data-bs-theme="dark"] .asrc-pick-opt{background:transparent;}
[data-bs-theme="dark"] .asrc-pick-opt:hover{background:rgba(34,211,238,.08);}
[data-bs-theme="dark"] .asrc-pick-txt{color:#cbd5e1;}
[data-bs-theme="dark"] .asrc-pick-txt b{color:#e2e8f0;}
[data-bs-theme="dark"] .asrc-ltab{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:#94a3b8;}
[data-bs-theme="dark"] .asrc-ltab.is-active{background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(6,182,212,.1));border-color:rgba(34,211,238,.4);color:#67e8f9;}
[data-bs-theme="dark"] .ast-plist{background:#0f1c25;border-color:rgba(255,255,255,.08);}
[data-bs-theme="dark"] .asrc-row{border-bottom-color:rgba(255,255,255,.05);}
[data-bs-theme="dark"] .asrc-row:not(.asrc-row--head):hover{background:rgba(34,211,238,.05);}
[data-bs-theme="dark"] .asrc-row--head{background:linear-gradient(180deg,#102530,#0d1f28);color:#6b97a6;}
[data-bs-theme="dark"] .asrc-name{color:#e2e8f0;}
[data-bs-theme="dark"] .asrc-hsn,[data-bs-theme="dark"] .asrc-sr{color:#94a3b8;}
[data-bs-theme="dark"] .ast-pl-price{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:#e2e8f0;}
[data-bs-theme="dark"] .ast-plist-empty{background:rgba(255,255,255,.02);border-color:rgba(255,255,255,.1);color:#94a3b8;}
[data-bs-theme="dark"] .ast-pl-clarity{background:rgba(34,211,238,.12);border-color:rgba(34,211,238,.3);color:#67e8f9;}
[data-bs-theme="dark"] .ast-foot{background:linear-gradient(180deg,#0f2028,#0d1922);border-top-color:rgba(255,255,255,.06);}
[data-bs-theme="dark"] .ast-btn-ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:#cbd5e1;}
[data-bs-theme="dark"] .ast-btn-ghost:hover{background:rgba(255,255,255,.1);}
[data-bs-theme="dark"] .astp-pop{background:#0e1b24;}
[data-bs-theme="dark"] .astp-row{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);}
[data-bs-theme="dark"] .astp-row:hover{background:rgba(34,211,238,.08);border-color:rgba(34,211,238,.3);}
[data-bs-theme="dark"] .astp-row.is-sel{background:rgba(34,211,238,.12);border-color:rgba(34,211,238,.45);}
[data-bs-theme="dark"] .astp-name{color:#e2e8f0;}
[data-bs-theme="dark"] .astp-role{color:#94a3b8;}
[data-bs-theme="dark"] .astp-search{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);}
[data-bs-theme="dark"] .astp-search input{color:#e2e8f0;}
[data-bs-theme="dark"] .astp-foot{background:linear-gradient(180deg,#0f2028,#0d1922);border-top-color:rgba(255,255,255,.06);}
[data-bs-theme="dark"] .ast-tab{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:#94a3b8;}
[data-bs-theme="dark"] .ast-tab.is-active{background:rgba(34,211,238,.14);border-color:rgba(34,211,238,.4);color:#67e8f9;}
[data-bs-theme="dark"] .ast-clarity-body textarea,[data-bs-theme="dark"] .ast-clarity-body input[type=text]{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:#e2e8f0;}
[data-bs-theme="dark"] .ast-pdf{background:rgba(255,255,255,.03);border-color:rgba(34,211,238,.25);}
`;
