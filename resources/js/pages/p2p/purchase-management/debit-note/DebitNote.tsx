import { useState, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import api from '../../../../api';
import DebitNoteDetail from './DebitNoteDetail';
// Reuse the SPI list styling so Debit Note matches the SPI / PO design 1:1.
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note — list view (server-driven). Mirrors the Supplier Purchase
 * Invoice list: header banner, "what we are doing" step strip, and a worklist
 * table. Rows, search, pagination and row actions all hit the Debit Note API.
 * ──────────────────────────────────────────────────────────────────────── */

const inr = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

// One recorded payment recovery, for the history popup.
type PayHistoryRow = {
  id: number; sr: number; amount: number; bank_name?: string | null; reference_no?: string | null;
  paid_date?: string | null; recorded_at?: string | null; attachment_url?: string | null;
  attachment_name?: string | null; balance_after: number; status?: string | null;
};

// Every date renders as "14-July-2026".
const DN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = (s?: string) => {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}-${DN_MONTHS[+m[2] - 1]}-${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : `${String(d.getDate()).padStart(2, '0')}-${DN_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};
// "14-July-2026, 03:45 PM" from an ISO datetime.
const fmtDateTime = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, '0')}-${DN_MONTHS[d.getMonth()]}-${d.getFullYear()}, ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};

type DnStatus = 'Unpaid' | 'Partially Paid' | 'Fully Paid' | 'Payment Overdue';
type DnRow = {
  id: number;
  no: string; dnDate: string; type: string;
  ship: string; proc: string;
  spi: string; spiDate: string; po: string; poDate: string;
  supplier: string; exp: string; total: number;
  paid?: number; balance?: number; locked?: boolean;
  status: DnStatus;
  zoho: 'sync' | 'not';
};

const STEPS = [
  { n: '01', ico: <StepIco1 />, title: 'Link Supplier & Invoice',   desc: 'Select the supplier and the reference invoice or PO.' },
  { n: '02', ico: <StepIco2 />, title: 'Debit Note Details',        desc: 'Enter the debit note number, date, and reason.' },
  { n: '03', ico: <StepIco3 />, title: 'Returned / Adjusted Items', desc: 'Add the items with quantities and debit values.' },
  { n: '04', ico: <StepIco4 />, title: 'Tax Reversal & Adjustment', desc: 'Reverse applicable tax and compute the net amount.' },
  { n: '05', ico: <StepIco5 />, title: 'Sync with Zohobook',        desc: 'Post the approved debit note to Zohobook.' },
];

const statusClass = (s: DnRow['status']) =>
  s === 'Fully Paid' ? 'dn-st-paid'
  : s === 'Partially Paid' ? 'dn-st-partial'
  : s === 'Payment Overdue' ? 'dn-st-overdue'
  : 'dn-st-unpaid';

export default function DebitNote() {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [debQ, setDebQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [menu, setMenu] = useState<{ row: DnRow; x: number; top: number; bottom: number } | null>(null);
  const [payRow, setPayRow] = useState<DnRow | null>(null);   // Payment Recovery popup
  const [syncConfirm, setSyncConfirm] = useState<DnRow | null>(null);   // "Sync with Zohobook?" confirm
  const [detailOpen, setDetailOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);   // opened for a locked (paid) debit note
  const [stepsOpen, setStepsOpen] = useState(true);  // "What We Are Doing Here" collapse toggle
  const [emailing, setEmailing] = useState<Record<number, boolean>>({});
  // Payment Recovery popup state — live already-paid / balance for the row, plus
  // the amount + proof being recorded.
  const [paySummary, setPaySummary] = useState<{ amountPaid: number; balance: number } | null>(null);
  const [payList, setPayList] = useState<PayHistoryRow[]>([]);   // recorded payments for the history popup
  const [payHistoryOpen, setPayHistoryOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const payFileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<DnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // More-Actions menu: measure the real popup size, then anchor it to the kebab
  // button — flip above when it would overflow the bottom, and clamp to the
  // viewport on every side so it is never clipped, at any screen size.
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) { setMenuPos(null); return; }
    const pop = menuRef.current;
    if (!pop) return;
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 6, pad = 8;
    let left = menu.x - pw;
    if (left < pad) left = pad;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pad - pw;
    let top = menu.bottom + gap;
    if (top + ph > window.innerHeight - pad) {
      const above = menu.top - gap - ph;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - pad - ph);
    }
    setMenuPos({ left, top });
  }, [menu]);
  const autoFitRef = useRef(true); // false once the user picks a rows-per-page manually
  const [fillH, setFillH] = useState<number | undefined>(undefined); // stretch the card to the viewport

  const pageCount = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * rpp;

  // Debounce the search box.
  useEffect(() => { const t = setTimeout(() => { setDebQ(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  // Auto-fit rows-per-page to the viewport so the pagination footer always sits
  // at the bottom of the screen without scrolling (mirrors the SPI list).
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      if (window.innerWidth <= 768) { setFillH(undefined); return; }
      const top = el.getBoundingClientRect().top;
      const THEAD = 44, ROW = 58, FOOTER = 96;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      const card = scrollRef.current?.closest('.spi-card') as HTMLElement | null;
      if (card) {
        const fh = Math.max(0, window.innerHeight - card.getBoundingClientRect().top - 20);
        setFillH(prev => (prev === fh ? prev : fh));
      }
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const recomputeDebounced = () => { if (settleTimer) clearTimeout(settleTimer); settleTimer = setTimeout(recompute, 140); };
    window.addEventListener('resize', recomputeDebounced);
    return () => { if (settleTimer) clearTimeout(settleTimer); window.removeEventListener('resize', recomputeDebounced); cancelAnimationFrame(raf); };
  }, []);

  // Fetch the current page of debit notes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/p2p/debit-notes', { params: { page, per_page: rpp, q: debQ || undefined } })
      .then(r => { if (!alive) return; setRows((r.data?.data ?? []) as DnRow[]); setTotal(r.data?.pagination?.total ?? 0); })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, rpp, debQ, reloadKey]);

  // Lock background scroll while any popup/overlay is open. Must lock BOTH
  // <html> and <body> — a body-only overflow:hidden doesn't stop the page from
  // scrolling behind the modal.
  useEffect(() => {
    if (!(payRow || syncConfirm || menu || detailOpen)) return;
    const html = document.documentElement, body = document.body;
    const ph = html.style.overflow, pb = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => { html.style.overflow = ph; body.style.overflow = pb; };
  }, [payRow, syncConfirm, menu, detailOpen]);

  const openCreate = () => { setEditId(null); setViewOnly(false); setDetailOpen(true); };
  const openEdit = (r: DnRow) => { setEditId(r.id); setViewOnly(!!r.locked); setDetailOpen(true); };

  // When the Payment Recovery popup opens, load the debit note's live
  // recovered / balance figures + recorded-payment history, and reset the form.
  useEffect(() => {
    if (!payRow) { setPaySummary(null); setPayList([]); setPayHistoryOpen(false); setPayAmount(''); setPayFile(null); return; }
    let alive = true;
    api.get(`/p2p/debit-notes/${payRow.id}/payment-summary`)
      .then(r => {
        if (!alive) return;
        const a = r.data?.data?.amounts;
        if (a) setPaySummary({ amountPaid: Number(a.amountPaid) || 0, balance: Number(a.balance) || 0 });
        setPayList((r.data?.data?.payments ?? []) as PayHistoryRow[]);
      })
      .catch(() => { if (alive) { setPaySummary(null); setPayList([]); } });
    return () => { alive = false; };
  }, [payRow]);

  const recordPayment = async () => {
    if (!payRow || paySaving) return;
    const amt = parseFloat(payAmount);
    if (!isFinite(amt) || amt <= 0) { toast.info('Enter an amount', 'Enter a valid recovered amount first.'); return; }
    const bal = paySummary?.balance ?? payRow.total;
    if (amt > bal + 0.001) { toast.error('Amount too high', `Cannot exceed the outstanding balance (${inr(bal)}).`); return; }
    setPaySaving(true);
    const fd = new FormData();
    fd.append('amount', String(amt));
    if (payFile) fd.append('attachment', payFile);
    try {
      const r = await api.post(`/p2p/debit-notes/${payRow.id}/payments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Payment recorded', `${inr(amt)} recovered against ${payRow.no}.`);
      // Refresh the popup in place from the returned summary so the balance and
      // History reflect this payment; reset the form; refresh the list statuses.
      const data = r.data?.data;
      if (data?.amounts) setPaySummary({ amountPaid: Number(data.amounts.amountPaid) || 0, balance: Number(data.amounts.balance) || 0 });
      setPayList((data?.payments ?? []) as PayHistoryRow[]);
      setPayAmount('');
      setPayFile(null);
      if (payFileRef.current) payFileRef.current.value = '';
      reload();
    } catch (e: any) {
      toast.error('Could not record payment', e?.response?.data?.message ?? 'Please try again.');
    } finally { setPaySaving(false); }
  };

  const syncRow = async (r: DnRow) => {
    try { const resp = await api.post(`/p2p/debit-notes/${r.id}/sync`); toast.success(`${r.no} synced with Zohobook`, resp?.data?.message); reload(); }
    catch (e: any) { toast.error('Sync failed', e?.response?.data?.message ?? 'Could not sync this debit note.'); }
  };

  const delRow = async (r: DnRow) => {
    const ok = await confirm({ title: 'Delete debit note', message: `Delete ${r.no}? This cannot be undone.`, tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    try { await api.delete(`/p2p/debit-notes/${r.id}`); toast.success(`${r.no} deleted`); reload(); }
    catch { toast.error('Delete failed', 'Could not delete this debit note.'); }
  };

  const soon = () => toast.info('Coming soon', 'This action is in development.');

  // Email the debit note PDF to the supplier (same template as PI / PO).
  const emailDn = (r: DnRow) => {
    if (!r.id || emailing[r.id]) return;
    const id = r.id;
    setEmailing(m => ({ ...m, [id]: true }));
    toast.info(`Emailing ${r.no} to supplier…`);
    api.post(`/p2p/debit-notes/${id}/email`)
      .then(res => toast.success(res.data?.message || `Debit Note emailed — ${r.no}`))
      .catch(err => {
        const msg = err?.response?.data?.message;
        if (err?.response?.status === 422) toast.error('Cannot send email', msg || 'No valid supplier email address.');
        else toast.error('Email failed', msg || 'Please try again.');
      })
      .finally(() => setEmailing(m => { const n = { ...m }; delete n[id]; return n; }));
  };

  // Debit Note PDF (same render shell as the PO PDF) — with/without signature.
  const dnPdfBlob = (id: number, withSign: boolean) =>
    api.get(`/p2p/debit-notes/${id}/pdf`, { params: { signature: withSign ? 1 : 0 }, responseType: 'blob' });
  const viewDnPdf = (r: DnRow, withSign: boolean) => {
    const w = window.open('', '_blank');
    toast.info(`Preparing debit note PDF${withSign ? ' (signed)' : ' (without signature)'}…`);
    return dnPdfBlob(r.id, withSign)
      .then(res => { const url = URL.createObjectURL(res.data as Blob); if (w) w.location.href = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); })
      .catch(() => { if (w) w.close(); toast.error('Could not open debit note PDF', 'Please try again.'); });
  };
  const downloadDnPdf = (r: DnRow, withSign: boolean) => {
    toast.info(`Downloading debit note PDF${withSign ? ' (signed)' : ' (without signature)'}…`);
    return dnPdfBlob(r.id, withSign)
      .then(res => {
        const url = URL.createObjectURL(res.data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DN-${r.no.replace(/[^A-Za-z0-9_-]/g, '_')}${withSign ? '_signed' : '_unsigned'}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      })
      .catch(() => toast.error('Could not download debit note PDF', 'Please try again.'));
  };

  // Run a menu PDF action, keeping the menu open with a spinner on the clicked
  // item until the PDF is ready, then close the menu.
  const [menuBusy, setMenuBusy] = useState<string | null>(null);
  const runMenuPdf = (key: string, fn: () => Promise<unknown>) => {
    if (menuBusy) return;
    setMenuBusy(key);
    fn().finally(() => { setMenuBusy(null); setMenu(null); });
  };

  return (
    <div className="spi-root dn-scope" ref={rootRef}>
      {/* ── Header banner ── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoDoc size={19} /></div>
          <div>
            <div className="spi-head-title">Debit Note</div>
            <div className="spi-head-sub">Issue and track supplier debit notes for returns, rejected goods, and price or quantity adjustments — from creation to tax reversal and accounting sync.</div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={openCreate}>
          <IcoPlus size={15} /> Create Debit Note
        </button>
      </div>

      {/* ── What We Are Doing Here ── */}
      <div className={`spi-bref ${stepsOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setStepsOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoDoc size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Debit Note</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">Link the supplier invoice, capture the debit note, add the returned or adjusted items, reverse the applicable tax, and post the approved note to Zohobook — end to end in one place.</div>
          </div>
          <div className="spi-bref-toggle"><IcoChevron /></div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(s => (
            <div className="spi-step" key={s.n}>
              <div className="spi-step-top"><span className="spi-step-ico">{s.ico}</span><span className="spi-step-num">STEP {s.n}</span></div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── List card ── */}
      <div className="spi-card" style={{ minHeight: fillH }}>
        {/* Figma ".dnlh" list header: teal icon + title + records pill + subtitle, search on the right. */}
        <div className="polist-top dnlh">
          <div className="dnlh-left">
            <span className="dnlh-ico"><IcoList size={20} /></span>
            <div className="dnlh-txt">
              <div className="dnlh-titrow">
                <span className="dnlh-title">All Debit Notes</span>
                <span className="dnlh-count">{total} records</span>
              </div>
              <div className="dnlh-sub">Track returns, rate &amp; quantity adjustments, and payment recovery</div>
            </div>
          </div>
          <div className="spi-search dnlh-search">
            <IcoSearch />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search debit note, supplier, status..." />
          </div>
        </div>

        {/* Table */}
        <div className="spi-tablewrap" ref={scrollRef}>
          <table className="spi-table">
            <thead>
              <tr>
                <th className="spi-c-sr">SR NO</th>
                <th>DEBIT NOTE NO.</th>
                <th>DEBIT NOTE TYPE</th>
                <th>SHIPMENT ID</th>
                <th>PROCUREMENT ID</th>
                <th>SPI NUMBER</th>
                <th>PO NUMBER</th>
                <th>SUPPLIER</th>
                <th>EXPECTED DEBIT DATE</th>
                <th className="spi-c-r">TOTAL DEBIT AMOUNT</th>
                <th className="spi-c-c">DEBIT NOTE STATUS</th>
                <th className="spi-c-c">ZOHOBOOK STATUS</th>
                <th className="spi-c-c">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: Math.max(5, Math.min(rpp, 10)) }).map((_, i) => (
                  <tr key={`sk-${i}`} className="dn-sk-row">
                    <td className="spi-c-sr"><span className="dn-sk" style={{ width: 18 }} /></td>
                    <td><span className="dn-sk" style={{ width: '72%' }} /><span className="dn-sk dn-sk-sm" style={{ width: '46%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '80%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '60%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '60%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '70%' }} /><span className="dn-sk dn-sk-sm" style={{ width: '46%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '70%' }} /><span className="dn-sk dn-sk-sm" style={{ width: '46%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '85%' }} /></td>
                    <td><span className="dn-sk" style={{ width: '58%' }} /></td>
                    <td className="spi-c-r"><span className="dn-sk" style={{ width: '55%', marginLeft: 'auto' }} /></td>
                    <td className="spi-c-c"><span className="dn-sk" style={{ width: 72, margin: '0 auto' }} /></td>
                    <td className="spi-c-c"><span className="dn-sk" style={{ width: 72, margin: '0 auto' }} /></td>
                    <td className="spi-c-c"><span className="dn-sk" style={{ width: 92, margin: '0 auto' }} /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={13}>
                  <div className="spi-empty"><div className="spi-empty-t">No debit notes found</div><div className="spi-empty-s">Create a debit note to get started, or try a different search.</div></div>
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="spi-c-sr"><span className="spi-sr">{start + i + 1}</span></td>
                  <td><span className="spi-idstack"><span className="spi-pill spi-pill-spi">{r.no}</span><span className="spi-date-sub">{fmtDate(r.dnDate)}</span></span></td>
                  <td><span className="dn-type">{r.type || '—'}</span></td>
                  <td>{r.ship ? <span className="spi-pill spi-pill-shp">{r.ship}</span> : '—'}</td>
                  <td>{r.proc ? <span className="spi-pill spi-pill-proc">{r.proc}</span> : '—'}</td>
                  <td>{r.spi ? <span className="spi-idstack"><span className="spi-pill spi-pill-pi">{r.spi}</span><span className="spi-date-sub">{fmtDate(r.spiDate)}</span></span> : '—'}</td>
                  <td>{r.po ? <span className="spi-idstack"><span className="spi-pill spi-pill-po">{r.po}</span><span className="spi-date-sub">{fmtDate(r.poDate)}</span></span> : '—'}</td>
                  <td>{r.supplier ? <Tooltip label={r.supplier}><span>{r.supplier.length > 25 ? r.supplier.slice(0, 25) + '…' : r.supplier}</span></Tooltip> : '—'}</td>
                  <td><span className="spi-date-sub">{r.exp ? fmtDate(r.exp) : '—'}</span></td>
                  <td className="spi-c-r spi-amt">{inr(r.total)}</td>
                  <td className="spi-c-c"><span className={`dn-st ${statusClass(r.status)}`}>{r.status}</span></td>
                  <td className="spi-c-c">
                    <span className={`spi-zb ${r.zoho === 'sync' ? 'spi-zb-sync' : 'spi-zb-not'}`}><span className="spi-zb-dot" />{r.zoho === 'sync' ? 'Synced' : 'Not Synced'}</span>
                  </td>
                  <td className="spi-c-c">
                    <span className="spi-acts">
                      {r.zoho === 'sync'
                        ? <Tooltip label="Already synced to Zohobook"><button type="button" className="spi-zohobtn is-synced"><IcoSync size={13} /> Synced</button></Tooltip>
                        : <Tooltip label="Sync this debit note to Zohobook"><button type="button" className="spi-zohobtn" onClick={() => setSyncConfirm(r)}><IcoSync size={13} /> Zoho Sync</button></Tooltip>}
                      <Tooltip label={r.locked ? 'View debit note (locked — payment recorded)' : 'Edit debit note'}><button type="button" className="spi-iconbtn" onClick={() => openEdit(r)}>{r.locked ? <IcoEye /> : <IcoEdit />}</button></Tooltip>
                      <Tooltip label={r.id && emailing[r.id] ? 'Sending…' : 'Email debit note to supplier'}><button type="button" className="spi-iconbtn" disabled={!!(r.id && emailing[r.id])} onClick={() => emailDn(r)}>{r.id && emailing[r.id] ? <IcoSpinner /> : <IcoMail />}</button></Tooltip>
                      <Tooltip label="Payment recovery"><button type="button" className="spi-iconbtn" onClick={() => setPayRow(r)}><IcoRupee /></button></Tooltip>
                      <Tooltip label="More actions"><button type="button" className="spi-iconbtn" onClick={e => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ row: r, x: b.right, top: b.top, bottom: b.bottom }); }}><IcoMore /></button></Tooltip>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[5, 10, 15]} />
      </div>

      {menu && (
        <div className="pomore-backdrop">
          <div ref={menuRef} className={`pomore-pop${menuPos ? ' is-open' : ''}`}
            style={menuPos ? { left: menuPos.left, top: menuPos.top } : { left: -9999, top: 0 }}
            onMouseDown={e => e.stopPropagation()}>
            <div className="pomore-hd">
              <span className="pomore-hd__ico"><IcoMore /></span>
              <span className="pomore-hd__txt">
                <span className="pomore-hd__t">More Actions</span>
                <span className="pomore-hd__chip"><IcoDocSm /><b>{menu.row.no}</b></span>
                <span className="pomore-hd__sup">Supplier: <b>{menu.row.supplier ?? '—'}</b></span>
              </span>
              <button type="button" className="pomore-x" onClick={() => setMenu(null)} aria-label="Close">✕</button>
            </div>
            <button type="button" className="pomore-item pomore-item--sync" onClick={() => { const r = menu.row; setMenu(null); setSyncConfirm(r); }}><span className="pomore-item__ico pomore-item__ico--sync"><IcoSync size={15} /></span> Sync with Zohobook</button>
            <div className="pomore-divider" />
            <div className="pomore-sec pomore-sec--view"><IcoEye size={13} /> View</div>
            <button type="button" className="pomore-item" disabled={!!menuBusy} onClick={() => runMenuPdf('view-sig', () => viewDnPdf(menu.row, true))}><span className="pomore-item__ico pomore-item__ico--view">{menuBusy === 'view-sig' ? <IcoSpinner size={15} /> : <IcoEye size={15} />}</span> With Signature</button>
            <button type="button" className="pomore-item" disabled={!!menuBusy} onClick={() => runMenuPdf('view-nosig', () => viewDnPdf(menu.row, false))}><span className="pomore-item__ico pomore-item__ico--view">{menuBusy === 'view-nosig' ? <IcoSpinner size={15} /> : <IcoEye size={15} />}</span> Without Signature</button>
            <div className="pomore-sec pomore-sec--dl"><IcoDownload size={13} /> Download</div>
            <button type="button" className="pomore-item" disabled={!!menuBusy} onClick={() => runMenuPdf('dl-sig', () => downloadDnPdf(menu.row, true))}><span className="pomore-item__ico pomore-item__ico--dl">{menuBusy === 'dl-sig' ? <IcoSpinner size={15} /> : <IcoDownload size={15} />}</span> With Signature</button>
            <button type="button" className="pomore-item" disabled={!!menuBusy} onClick={() => runMenuPdf('dl-nosig', () => downloadDnPdf(menu.row, false))}><span className="pomore-item__ico pomore-item__ico--dl">{menuBusy === 'dl-nosig' ? <IcoSpinner size={15} /> : <IcoDownload size={15} />}</span> Without Signature</button>
          </div>
        </div>
      )}

      {syncConfirm && (
        <div className="dn-modal-backdrop">
          <div className="dn-sync" onMouseDown={e => e.stopPropagation()}>
            <span className="dn-sync-ico"><IcoSync size={24} /></span>
            <div className="dn-sync-title">Sync with Zohobook?</div>
            <div className="dn-sync-sub">This will push the latest debit note data to your Zohobook account and update its sync status.</div>
            <div className="dn-sync-dn"><span className="po">{syncConfirm.no}</span> <span className="sup">· {syncConfirm.supplier ?? '—'}</span></div>
            <div className="dn-sync-foot">
              <button type="button" className="dn-pay-cancel" onClick={() => setSyncConfirm(null)}>Cancel</button>
              <button type="button" className="dn-pay-record" onClick={() => { const r = syncConfirm; setSyncConfirm(null); syncRow(r); }}>Yes, Sync</button>
            </div>
          </div>
        </div>
      )}

      {payRow && (
        <div className="dn-modal-backdrop">
          <div className="dn-pay" onMouseDown={e => e.stopPropagation()}>
            <div className="dn-pay-head">
              <span className="dn-pay-ico"><IcoRupee size={18} /></span>
              <div>
                <div className="dn-pay-title">Payment Recovery</div>
                <div className="dn-pay-sub">Record recovered amount &amp; attach proof of payment</div>
              </div>
              <Tooltip label="View payment history">
                <button type="button" className="dn-pay-hist-btn" onClick={() => setPayHistoryOpen(true)}>
                  <IcoHistory size={14} /> History{payList.length ? ` (${payList.length})` : ''}
                </button>
              </Tooltip>
            </div>
            <div className="dn-pay-dn"><span className="po">{payRow.no}</span> <span className="sup">· {payRow.supplier ?? '—'}</span></div>
            <div className="dn-pay-stats">
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">TOTAL DEBIT</div><div className="dn-pay-stat-v">{inr(payRow.total)}</div></div>
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">ALREADY PAID</div><div className="dn-pay-stat-v">{inr(paySummary?.amountPaid ?? 0)}</div></div>
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">BALANCE</div><div className="dn-pay-stat-v">{inr(paySummary?.balance ?? payRow.total)}</div></div>
            </div>
            <label className="dn-pay-lbl">AMOUNT RECOVERED (₹)</label>
            <input className="dn-pay-input" type="number" min={0} step="0.01" placeholder="Enter recovered / debit amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
            <label className="dn-pay-lbl">PROOF OF PAYMENT</label>
            <input ref={payFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style={{ display: 'none' }} onChange={e => {
              const f = e.target.files?.[0] ?? null;
              // Only PDF / JPG / PNG proofs are allowed — reject anything else.
              if (f && !(/\.(pdf|jpe?g|png)$/i.test(f.name) || ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type))) {
                toast.error('Invalid file type', 'Only PDF, JPG or PNG files are allowed as proof of payment.');
                e.target.value = '';
                setPayFile(null);
                return;
              }
              setPayFile(f);
            }} />
            <button type="button" className="dn-pay-attach" onClick={() => payFileRef.current?.click()}>
              <IcoUpload size={15} /> {payFile ? payFile.name : 'Click to attach proof (PDF, JPG, PNG)'}
            </button>
            <div className="dn-pay-foot">
              <button type="button" className="dn-pay-cancel" disabled={paySaving} onClick={() => setPayRow(null)}>Cancel</button>
              <button type="button" className="dn-pay-record" disabled={paySaving} onClick={recordPayment}>{paySaving ? <><IcoSpinner size={14} /> Recording…</> : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment history popup (list view of every recorded recovery). */}
      {payRow && payHistoryOpen && (
        <div className="dn-modal-backdrop dn-hist-backdrop">
          <div className="dn-hist" onMouseDown={e => e.stopPropagation()}>
            <div className="dn-hist-head">
              <span className="dn-pay-ico"><IcoHistory size={17} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dn-pay-title">Payment History</div>
                <div className="dn-pay-sub"><span className="po">{payRow.no}</span> · {payRow.supplier ?? '—'}</div>
              </div>
              <button type="button" className="dn-hist-x" onClick={() => setPayHistoryOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="dn-hist-body">
              {payList.length === 0 ? (
                <div className="dn-hist-empty">No payments recorded yet for this debit note.</div>
              ) : (
                <table className="dn-hist-table">
                  <thead>
                    <tr>
                      <th>SR</th><th>DATE &amp; TIME</th><th className="dn-hist-c">AMOUNT</th><th className="dn-hist-c">BALANCE AFTER</th><th className="dn-hist-c">STATUS</th><th className="dn-hist-c">PROOF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payList.map(p => (
                      <tr key={p.id}>
                        <td>{p.sr}</td>
                        <td>{fmtDateTime(p.recorded_at || p.paid_date)}</td>
                        <td className="dn-hist-c dn-hist-amt">{inr(p.amount)}</td>
                        <td className="dn-hist-c">{inr(p.balance_after)}</td>
                        <td className="dn-hist-c"><span className={`dn-hist-badge ${String(p.status).toLowerCase() === 'pending' ? 'is-pending' : 'is-cleared'}`}>{p.status || 'Cleared'}</span></td>
                        <td className="dn-hist-c">{p.attachment_url ? <a className="dn-hist-proof" href={p.attachment_url} target="_blank" rel="noreferrer" title={p.attachment_name || 'View proof'}><IcoEye size={13} /></a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="dn-hist-foot">
              <div className="dn-hist-total">Total recovered: <b>{inr(paySummary?.amountPaid ?? 0)}</b></div>
              <button type="button" className="dn-pay-cancel" onClick={() => setPayHistoryOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {detailOpen && <DebitNoteDetail editId={editId} readOnly={viewOnly} onClose={() => setDetailOpen(false)} onSaved={reload} />}

      <style>{DN_CSS}</style>
    </div>
  );
}

/* Debit-note-specific bits layered on top of the reused SPI CSS: the type pill
 * and the four payment-status pills, PLUS exact values from the P2P Figma
 * prototype (.polist-* classes) so the table reads pixel-for-pixel like the design. */
const DN_CSS = `
/* Inline action spinner (email / view / download in-flight). */
.dn-spin { animation:dn-spin 0.7s linear infinite; }
@keyframes dn-spin { to { transform:rotate(360deg); } }
.pomore-pop .pomore-item:disabled { opacity:.75; cursor:default; }
/* Rows-per-page selector — the shared pager defaults its <select> to the violet
 * accent; retint it (and its dropdown options) teal to match the table. */
.dn-scope .tc-wl-rows select { color:#0e7490; accent-color:#0e7490; }
.dn-scope .tc-wl-rows select option { color:#0e7490; background:#ffffff; }
.dn-scope .tc-wl-rows select option:checked { color:#ffffff; background:#0e7490; }
[data-bs-theme="dark"] .dn-scope .tc-wl-rows select { color:#67e8f9; accent-color:#22d3ee; }
[data-bs-theme="dark"] .dn-scope .tc-wl-rows select option { color:#67e8f9; background:#0c1c24; }
[data-bs-theme="dark"] .dn-scope .tc-wl-rows select option:checked { color:#0b1220; background:#22d3ee; }
/* Skeleton shimmer for the loading list rows. */
.dn-scope .dn-sk-row td { padding:12px 7px; border-bottom:1px solid #eef3f6; }
.dn-scope .dn-sk { display:block; height:12px; border-radius:6px; margin:3px 0; background:linear-gradient(90deg,#e8eef2 25%,#f4f8fa 37%,#e8eef2 63%); background-size:400% 100%; animation:dn-sk 1.4s ease infinite; }
.dn-scope .dn-sk-sm { height:9px; opacity:.7; }
@keyframes dn-sk { 0% { background-position:100% 50%; } 100% { background-position:0 50%; } }
[data-bs-theme="dark"] .dn-scope .dn-sk { background:linear-gradient(90deg,#1e2c34 25%,#26363e 37%,#1e2c34 63%); background-size:400% 100%; }
[data-bs-theme="dark"] .dn-scope .dn-sk-row td { border-bottom-color:rgba(148,163,184,.12); }
/* Exact Figma table cell — DM Sans 11.5px, #3a5161, centred, 12px 7px padding. */
.dn-scope .spi-table tbody td { padding:12px 7px; border-bottom:1px solid #eef3f6; color:#3a5161; font-weight:600; font-size:11.5px; text-align:center; vertical-align:middle; line-height:1.35; white-space:normal; }
.dn-scope .spi-table thead th { text-align:center; }
/* Mobile: let the wide worklist table scroll horizontally instead of overflowing the card. */
.dn-scope .spi-tablewrap { overflow-x:auto; }
/* Figma uniform teal id-pill (DN / SPI / PO / SHP / PRC all identical). */
.dn-scope .spi-pill { display:inline-block; padding:3px 8px; border:1px solid #cfe3ea; border-radius:7px; background:#f4fafc; color:#0e7490; font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace !important; font-size:10px !important; font-weight:700 !important; white-space:nowrap; }
/* Figma date sub-text — DM Sans 11px, #64748b. */
.dn-scope .spi-date-sub { font-size:11px; color:#64748b; font-weight:600; white-space:nowrap; }
.dn-scope .spi-idstack { align-items:center; gap:3px; }
/* Figma Total Debit Amount — bold dark teal (font-weight 800, #0c4a6e). */
.dn-scope .spi-amt { font-weight:800; color:#0c4a6e; }
[data-bs-theme="dark"] .dn-scope .spi-amt { color:#7dd3fc; }
[data-bs-theme="dark"] .dn-scope .spi-table tbody td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .dn-scope .spi-pill { background:rgba(34,211,238,.1); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .spi-date-sub { color:#94a3b8; }
/* Figma "All Debit Notes" list header (.dnlh) — icon + title + records pill + subtitle. */
.dn-scope .polist-top { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:14px 16px; }
.dn-scope .dnlh { background:#fff; border-bottom:1px solid #e3eef3; }
.dn-scope .dnlh-left { display:flex; align-items:center; gap:13px; min-width:0; }
.dn-scope .dnlh-ico { width:42px; height:42px; border-radius:13px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 8px 18px -5px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.35); }
.dn-scope .dnlh-txt { min-width:0; }
.dn-scope .dnlh-titrow { display:flex; align-items:center; gap:10px; }
.dn-scope .dnlh-title { font-size:16px; font-weight:800; color:#0c4a6e; letter-spacing:-.01em; line-height:1.15; }
.dn-scope .dnlh-count { display:inline-flex; align-items:center; height:21px; padding:0 10px; border-radius:20px; font-size:10.5px; font-weight:800; color:#0e7490; background:#eafaff; border:1px solid #bfe9f3; white-space:nowrap; }
.dn-scope .dnlh-sub { margin-top:3px; font-size:11.5px; font-weight:600; color:#5b8aa0; line-height:1.2; }
/* Figma debit-note search — EXACT clone of .dnlh .polist-search: the visible box lives on the
 * INPUT (border, radius, padding, shadow), the container is just a transparent positioning wrapper.
 * (SPI reuse puts the box on the container, which rendered taller/bulkier than the Figma.) */
.dn-scope .dnlh-search { flex:0 0 auto; width:760px; max-width:62%; min-width:240px; margin:0; height:auto; background:transparent; border:0; border-radius:0; padding:0; box-shadow:none; }
.dn-scope .dnlh-search input { width:100%; height:auto; padding:11px 14px 11px 40px; border:1.5px solid #e3edf2; border-radius:13px; background:#fff; font-size:13px; font-weight:600; color:#0c4a6e; box-shadow:0 2px 8px rgba(8,80,110,.05); box-sizing:border-box; }
.dn-scope .dnlh-search:focus-within { box-shadow:none; }
.dn-scope .dnlh-search input:focus { border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dn-scope .dnlh-search svg { left:13px; }
[data-bs-theme="dark"] .dn-scope .dnlh-search { background:transparent; border:0; }
[data-bs-theme="dark"] .dn-scope .dnlh-search input { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dnlh { background:#0e1b24; border-bottom-color:rgba(34,211,238,.18); }
[data-bs-theme="dark"] .dn-scope .dnlh-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-scope .dnlh-count { background:rgba(34,211,238,.12); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .dnlh-sub { color:#7c9fb0; }

/* Figma DEBIT NOTE TYPE — plain text, inherits the td font (11.5px DM Sans, #3a5161, 600), wraps normally. */
.dn-type { color:#3a5161; font-weight:600; }
.dn-st { display:inline-flex; align-items:center; gap:6px; padding:4px 11px; border-radius:20px; font-size:11px; font-weight:700; white-space:nowrap; }
.dn-st::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.dn-st-paid    { background:#ecfdf5; color:#059669; }
.dn-st-partial { background:#fffbeb; color:#b45309; }
.dn-st-overdue { background:#fef2f2; color:#dc2626; }
.dn-st-unpaid  { background:#f1f5f9; color:#64748b; }
[data-bs-theme="dark"] .dn-type { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-st-paid    { background:rgba(5,150,105,.16); color:#6ee7b7; }
[data-bs-theme="dark"] .dn-st-partial { background:rgba(180,83,9,.18); color:#fcd34d; }
[data-bs-theme="dark"] .dn-st-overdue { background:rgba(220,38,38,.18); color:#fca5a5; }
[data-bs-theme="dark"] .dn-st-unpaid  { background:rgba(148,163,184,.16); color:#cbd5e1; }

/* ── More-Actions popup menu (Figma pomore-*) — fixed 248px card, anchored to the
 * kebab button and clamped to the viewport in JS so it never gets clipped. ── */
.dn-scope .pomore-backdrop { position:fixed; inset:0; z-index:2700000; background:transparent; }
.dn-scope .pomore-pop { position:fixed; z-index:2700001; width:248px; background:#fff; border:1px solid #e6eef3; border-radius:16px; box-shadow:0 20px 48px rgba(8,40,60,.20), 0 2px 6px rgba(8,40,60,.08); padding:9px; opacity:0; transform:translateY(-6px) scale(.97); transform-origin:top right; transition:opacity .15s ease, transform .17s cubic-bezier(.22,1,.36,1); }
.dn-scope .pomore-pop.is-open { opacity:1; transform:translateY(0) scale(1); }
.dn-scope .pomore-hd { display:flex; align-items:flex-start; gap:9px; padding:5px 6px 10px; border-bottom:1px solid #eef3f6; margin-bottom:6px; }
.dn-scope .pomore-hd__ico { width:28px; height:28px; border-radius:9px; background:linear-gradient(135deg,#0e7490,#0891b2 60%,#06b6d4); color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 6px rgba(8,145,178,.32); margin-top:1px; }
.dn-scope .pomore-hd__txt { flex:1; min-width:0; }
.dn-scope .pomore-hd__t { font-size:13px; font-weight:800; color:#0f2333; line-height:1.2; }
.dn-scope .pomore-hd__chip { display:inline-flex; align-items:center; gap:5px; margin-top:6px; background:#eefcff; border:1px solid #cdeef6; border-radius:7px; padding:3px 9px; font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; font-weight:600; color:#0e7490; max-width:100%; }
.dn-scope .pomore-hd__chip svg { flex-shrink:0; opacity:.85; }
.dn-scope .pomore-hd__chip b { font-family:inherit; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dn-scope .pomore-hd__sup { display:block; margin-top:5px; font-size:10.5px; font-weight:600; color:#64798c; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dn-scope .pomore-hd__sup b { color:#334155; font-weight:700; }
.dn-scope .pomore-x { width:26px; height:26px; border-radius:8px; border:1px solid #e6eef3; background:#f7fafc; color:#7a8ba0; font-size:13px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:background .14s,color .14s,border-color .14s; }
.dn-scope .pomore-x:hover { background:#eef3f6; color:#334155; border-color:#dbe5ec; }
.dn-scope .pomore-sec { font-size:9px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; display:flex; align-items:center; gap:6px; padding:9px 8px 5px; }
.dn-scope .pomore-sec--view { color:#7c3aed; }
.dn-scope .pomore-sec--dl { color:#0e7490; }
.dn-scope .pomore-item { display:flex; align-items:center; gap:11px; width:100%; border:none; background:transparent; text-align:left; padding:8px; border-radius:11px; cursor:pointer; font-family:inherit; font-size:12.5px; font-weight:700; color:#243648; transition:background .14s,transform .12s; }
.dn-scope .pomore-item:hover { background:#f4f8fb; transform:translateX(2px); }
.dn-scope .pomore-item:active { transform:translateX(2px) scale(.99); }
.dn-scope .pomore-item__ico { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.dn-scope .pomore-item__ico--sync { background:#dcfaf2; color:#0e7c6b; }
.dn-scope .pomore-item__ico--view { background:#f1ecfe; color:#7c3aed; }
.dn-scope .pomore-item__ico--dl { background:#e2f5fb; color:#0e7490; }
.dn-scope .pomore-item--sync { background:#f6fffd; border:1px solid #d6f5ec; }
.dn-scope .pomore-item--sync:hover { background:#ecfdf7; }
.dn-scope .pomore-divider { height:1px; background:#eef3f6; margin:7px 4px; }
[data-bs-theme="dark"] .dn-scope .pomore-pop { background:#0e1b24; border-color:rgba(34,211,238,.2); box-shadow:0 20px 48px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .dn-scope .pomore-hd { border-bottom-color:rgba(148,163,184,.16); }
[data-bs-theme="dark"] .dn-scope .pomore-hd__t { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-scope .pomore-hd__chip { background:rgba(34,211,238,.1); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .pomore-hd__sup { color:#94a3b8; }
[data-bs-theme="dark"] .dn-scope .pomore-hd__sup b { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .pomore-x { background:#0c1c24; border-color:rgba(148,163,184,.25); color:#94a3b8; }
[data-bs-theme="dark"] .dn-scope .pomore-item { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .pomore-item:hover { background:rgba(148,163,184,.1); }
[data-bs-theme="dark"] .dn-scope .pomore-item--sync { background:rgba(16,185,129,.08); border-color:rgba(16,185,129,.25); }
[data-bs-theme="dark"] .dn-scope .pomore-divider { background:rgba(148,163,184,.16); }
[data-bs-theme="dark"] .dn-scope .pomore-sec--view { color:#c4b5fd; }
[data-bs-theme="dark"] .dn-scope .pomore-sec--dl { color:#67e8f9; }

/* ── Payment Recovery popup (₹ action) ── */
.dn-modal-backdrop { position:fixed; inset:0; z-index:100000; background:rgba(8,30,42,.45); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:20px; }
.dn-pay { width:100%; max-width:460px; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 24px 60px rgba(8,40,60,.32); }
.dn-pay-head { display:flex; align-items:center; gap:12px; padding:22px 22px 0; margin-bottom:14px; }
.dn-pay-ico { width:54px; height:54px; border-radius:16px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 10px 22px -6px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.4); }
.dn-pay-title { font-size:15px; font-weight:800; color:#0f2333; line-height:1.2; }
.dn-pay-sub { font-size:11.5px; font-weight:600; color:#64798c; margin-top:2px; }
.dn-pay-dn { display:inline-flex; align-items:center; gap:6px; margin:0 22px 15px; background:#eefcff; border:1px solid #cdeef6; border-radius:9px; padding:7px 13px; font-size:11.5px; font-weight:700; color:#0e7490; }
.dn-pay-dn .po { font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace; font-weight:600; }
.dn-pay-dn .sup { color:#52708a; font-weight:600; }
.dn-pay-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:0 22px; margin-bottom:17px; }
.dn-pay-stat { border:1px solid #e3eef3; border-radius:10px; background:#f9fdfe; padding:9px 10px; text-align:center; }
.dn-pay-stat-k { font-size:8.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#7c97a8; }
.dn-pay-stat-v { font-size:13px; font-weight:800; color:#0c4a6e; margin-top:4px; font-variant-numeric:tabular-nums; }
.dn-pay-lbl { display:block; margin:0 22px 7px; font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#5f7d92; }
.dn-pay-input { display:block; width:calc(100% - 44px); margin:0 22px 16px; height:40px; padding:0 12px; border:1.5px solid #e6eef3; border-radius:9px; font-size:12.5px; font-weight:600; color:#0f172a; background:#f9fdfe; box-sizing:border-box; }
.dn-pay-input:focus { outline:none; border-color:#22d3ee; background:#fff; box-shadow:0 0 0 4px rgba(34,211,238,.12); }
.dn-pay-input::placeholder { color:#9fb0bf; }
.dn-pay-attach { display:flex; align-items:center; gap:10px; width:calc(100% - 44px); margin:0 22px 8px; padding:13px 14px; border:1.5px dashed #bfe5ee; border-radius:11px; background:#f9fdfe; color:#0e7490; font-size:12.5px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s; }
.dn-pay-attach:hover { background:#eef9fc; border-color:#7fc3d8; }
.dn-pay-foot { display:flex; gap:10px; padding:8px 22px 22px; }
.dn-pay-foot > button { flex:1; }
.dn-pay-cancel { display:inline-flex; align-items:center; justify-content:center; padding:11px 14px; border:1px solid #e1e9ef; border-radius:12px; background:#f1f5f8; color:#506478; font-size:13px; font-weight:800; cursor:pointer; transition:background .14s,color .14s; }
.dn-pay-cancel:hover { background:#e7eef3; color:#334155; }
.dn-pay-record { display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:11px 14px; border:1px solid transparent; border-radius:12px; color:#fff; font-size:13px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,#0e7490,#0891b2 60%,#06b6d4); box-shadow:0 6px 16px rgba(8,145,178,.34); transition:transform .14s,box-shadow .14s; }
.dn-pay-record:hover { transform:translateY(-1px); box-shadow:0 9px 20px rgba(8,145,178,.44); }
[data-bs-theme="dark"] .dn-pay { background:#0e1b24; }
[data-bs-theme="dark"] .dn-pay-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-pay-dn { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-pay-stat { background:#0c1c24; border-color:rgba(34,211,238,.2); }
[data-bs-theme="dark"] .dn-pay-stat-v { color:#7dd3fc; }
[data-bs-theme="dark"] .dn-pay-input, [data-bs-theme="dark"] .dn-pay-attach { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-pay-cancel { background:#0c1c24; border-color:rgba(148,163,184,.25); color:#cbd5e1; }

/* ── Payment history: small header button + list popup ── */
.dn-pay-hist-btn { display:inline-flex; align-items:center; gap:5px; align-self:flex-start; margin-left:auto; padding:6px 11px; border:1.5px solid #bfe9f3; border-radius:9px; background:#f0fdff; color:#0e7490; font-size:11.5px; font-weight:800; cursor:pointer; white-space:nowrap; transition:background .14s,border-color .14s; }
.dn-pay-hist-btn:hover { background:#e2f8fd; border-color:#22d3ee; }
.dn-hist-backdrop { z-index:100010; }
.dn-hist { width:640px; max-width:100%; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 24px 60px -12px rgba(8,47,73,.4); display:flex; flex-direction:column; max-height:82vh; }
.dn-hist-head { display:flex; align-items:center; gap:12px; padding:18px 20px 14px; border-bottom:1px solid #eef3f6; }
.dn-hist-x { width:30px; height:30px; border-radius:9px; border:1px solid #e1e9ef; background:#f1f5f8; color:#506478; font-size:14px; cursor:pointer; flex:0 0 auto; }
.dn-hist-x:hover { background:#e7eef3; }
.dn-hist-body { overflow:auto; padding:6px 8px; }
.dn-hist-empty { padding:34px 20px; text-align:center; color:#94a3b8; font-weight:600; font-size:13px; }
.dn-hist-table { width:100%; border-collapse:collapse; font-size:11.5px; }
.dn-hist-table thead th { position:sticky; top:0; background:#f7fdff; text-align:left; padding:9px 12px; font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#5b7585; border-bottom:1.5px solid #e3eef3; white-space:nowrap; }
.dn-hist-table tbody td { padding:10px 12px; border-bottom:1px solid #eef3f6; color:#3a5161; font-weight:600; vertical-align:middle; }
.dn-hist-r { text-align:right; }
.dn-hist-c { text-align:center; }
.dn-hist-amt { font-weight:800; color:#0c4a6e; font-variant-numeric:tabular-nums; }
.dn-hist-badge { display:inline-flex; align-items:center; padding:3px 9px; border-radius:20px; font-size:10px; font-weight:800; }
.dn-hist-badge.is-cleared { background:#ecfdf5; color:#059669; }
.dn-hist-badge.is-pending { background:#fffbeb; color:#b45309; }
.dn-hist-proof { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:7px; border:1px solid #cfe3ea; background:#f4fafc; color:#0e7490; }
.dn-hist-proof:hover { background:#e2f8fd; border-color:#22d3ee; }
.dn-hist-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 20px; border-top:1px solid #eef3f6; }
.dn-hist-total { font-size:12px; font-weight:600; color:#506478; }
.dn-hist-total b { color:#0c4a6e; font-weight:800; }
.dn-hist-foot .dn-pay-cancel { flex:0 0 auto; padding:9px 20px; }
[data-bs-theme="dark"] .dn-pay-hist-btn { background:rgba(34,211,238,.1); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-hist { background:#0e1b24; }
[data-bs-theme="dark"] .dn-hist-head, [data-bs-theme="dark"] .dn-hist-foot { border-color:rgba(148,163,184,.14); }
[data-bs-theme="dark"] .dn-hist-table thead th { background:#0c1c24; color:#94a3b8; border-bottom-color:rgba(34,211,238,.18); }
[data-bs-theme="dark"] .dn-hist-table tbody td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .dn-hist-amt, [data-bs-theme="dark"] .dn-hist-total b { color:#7dd3fc; }
[data-bs-theme="dark"] .dn-hist-x { background:#0c1c24; border-color:rgba(148,163,184,.25); color:#cbd5e1; }
[data-bs-theme="dark"] .dn-hist-proof { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#67e8f9; }

/* ── "Sync with Zohobook?" confirm popup (centered) ── */
.dn-sync { width:400px; max-width:100%; background:#fff; border-radius:18px; padding:22px; text-align:center; box-shadow:0 24px 60px rgba(8,40,60,.32); }
.dn-sync-ico { width:54px; height:54px; margin:0 auto 14px; border-radius:16px; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 10px 22px -6px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.4); }
.dn-sync-title { font-size:16.5px; font-weight:800; color:#0c2c3a; letter-spacing:-.3px; }
.dn-sync-sub { font-size:12.5px; font-weight:500; color:#5e7888; line-height:1.55; margin:8px auto 0; max-width:340px; }
.dn-sync-dn { display:inline-flex; align-items:center; gap:6px; margin:13px auto 18px; background:#eefcff; border:1px solid #cdeef6; border-radius:9px; padding:7px 13px; font-size:11.5px; font-weight:700; color:#0e7490; }
.dn-sync-dn .po { font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace; font-weight:600; }
.dn-sync-dn .sup { color:#52708a; font-weight:600; }
.dn-sync-foot { display:flex; gap:10px; }
.dn-sync-foot > button { flex:1; }
[data-bs-theme="dark"] .dn-sync { background:#0e1b24; }
[data-bs-theme="dark"] .dn-sync-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-sync-sub { color:#7c9fb0; }
[data-bs-theme="dark"] .dn-sync-dn { background:rgba(34,211,238,.1); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-sync-dn .sup { color:#94a3b8; }
`;

/* ── Inline icons ── */
function IcoDoc({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoList({ size = 20 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>; }
function IcoBox({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoCard({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoSearch({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function IcoSync({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IcoEdit({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>; }
function IcoRupee({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 5-5"/></svg>; }
function IcoMore({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>; }
function IcoPlus({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IcoMail({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>; }
function IcoSpinner({ size = 14 }: { size?: number }) { return <svg className="dn-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>; }
function IcoChevron() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoHistory({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>; }
function IcoTrash({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }

/* ── Step-strip icons — EXACT Figma clones (.bref-item__ico): 11px glyph, stroke-width 2.4. ── */
function StepSvg({ size = 11, children }: { size?: number; children: ReactNode }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
function StepIco1() { return <StepSvg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-2-2"/></StepSvg>; }
function StepIco2() { return <StepSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="15" x2="16" y2="15"/></StepSvg>; }
function StepIco3() { return <StepSvg><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></StepSvg>; }
function StepIco4() { return <StepSvg><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></StepSvg>; }
function StepIco5() { return <StepSvg><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3"/><polyline points="21 3 18.7 6 15.6 5.4"/><polyline points="3 21 5.3 18 8.4 18.6"/></StepSvg>; }
function IcoX({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoEye({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IcoDownload({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function IcoDocSm({ size = 11 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>; }
function IcoUpload({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>; }
