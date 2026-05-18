import { useEffect, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Quotations V/S Proforma Invoice (QPI)
 *
 * Faithful port of prototype `#qpiPage` (line 61758). Purple-palette page
 * with a Quotation / Proforma Invoice tab switch and a "What We Are Doing
 * Here" stepper. Both tab bodies show a sample table.
 * ──────────────────────────────────────────────────────────────────────── */

type QPITab = 'quotation' | 'pi';

type Row = {
  id: string;
  oppId: string;
  customer: string;
  amount: string;
  currency: string;
  status: string;
  date: string;
};

const QUOTATIONS: Row[] = [
  { id:'QT-001', oppId:'OPP-001', customer:'GreenHarvest Global', amount:'$45,800', currency:'USD', status:'Sent',     date:'12/05/2026' },
  { id:'QT-002', oppId:'OPP-008', customer:'Wei Imports',          amount:'$72,500', currency:'USD', status:'Approved', date:'10/05/2026' },
  { id:'QT-003', oppId:'OPP-010', customer:'Raza Exports',         amount:'$31,200', currency:'USD', status:'Sent',     date:'09/05/2026' },
  { id:'QT-004', oppId:'OPP-011', customer:'Al-Hassan Foods',      amount:'$58,750', currency:'USD', status:'Draft',    date:'08/05/2026' },
  { id:'QT-005', oppId:'OPP-012', customer:'Bianchi Imports',      amount:'€24,300', currency:'EUR', status:'Sent',     date:'07/05/2026' },
];

const PROFORMA: Row[] = [
  { id:'PI-001', oppId:'OPP-001', customer:'GreenHarvest Global', amount:'$45,800', currency:'USD', status:'Issued',     date:'13/05/2026' },
  { id:'PI-002', oppId:'OPP-008', customer:'Wei Imports',          amount:'$72,500', currency:'USD', status:'Paid',       date:'11/05/2026' },
  { id:'PI-003', oppId:'OPP-013', customer:'Al-Farsi Trading',     amount:'$18,900', currency:'USD', status:'Outstanding',date:'10/05/2026' },
];

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  'Draft':       { bg:'#f3f4f6', fg:'#475569', border:'#e2e8f0' },
  'Sent':        { bg:'#dbeafe', fg:'#1d4ed8', border:'#bfdbfe' },
  'Approved':    { bg:'#dcfce7', fg:'#15803d', border:'#bbf7d0' },
  'Issued':      { bg:'#ede9fe', fg:'#6d28d9', border:'#ddd6fe' },
  'Paid':        { bg:'#dcfce7', fg:'#15803d', border:'#bbf7d0' },
  'Outstanding': { bg:'#fef3c7', fg:'#92400e', border:'#fde68a' },
};

export default function SalesQPI() {
  const toast = useToast();
  const [tab, setTab] = useState<QPITab>('quotation');
  const [wdhOpen, setWdhOpen] = useState(true);

  useEffect(() => {
    const id = 'sm-qpi-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const rows = tab === 'quotation' ? QUOTATIONS : PROFORMA;

  return (
    <div className="qpi-root">
      <style>{SCOPED_CSS}</style>

      {/* Header strip */}
      <div className="qpi-header">
        <span className="qpi-accent" />
        <span className="qpi-glow" />
        <div className="qpi-header-left">
          <div className="qpi-header-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <div className="qpi-header-title">Quotations V/S Proforma Invoice</div>
            <div className="qpi-header-sub">Manage quotation creation, buyer approval and PI conversion</div>
          </div>
        </div>
        <div className="qpi-tab-switch">
          <button className={`qpi-tab ${tab === 'quotation' ? 'active' : ''}`} onClick={() => setTab('quotation')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Quotation
          </button>
          <button className={`qpi-tab ${tab === 'pi' ? 'active' : ''}`} onClick={() => setTab('pi')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="4" width="20" height="14" rx="2" /></svg>
            Proforma Invoice
          </button>
        </div>
      </div>

      {/* What We Are Doing Here */}
      <div className="qpi-wdh">
        <div className="qpi-wdh-header" onClick={() => setWdhOpen(!wdhOpen)}>
          <div className="qpi-wdh-title">
            <div className="qpi-wdh-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            </div>
            <span>Quotations V/S Proforma Invoice — What We Are Doing Here:</span>
          </div>
          <button className="qpi-wdh-toggle" onClick={e => { e.stopPropagation(); setWdhOpen(!wdhOpen); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
              {wdhOpen ? <polyline points="7 11 12 6 17 11" /> : <polyline points="7 13 12 18 17 13" />}
            </svg>
          </button>
        </div>
        {wdhOpen && (
          <div className="qpi-wdh-body">
            {[
              { n:1, title:'Create Quotation',          desc:'Prepare quotation using opportunity, buyer, product, pricing, currency, and bank details.', tag:'Foundation Step' },
              { n:2, title:'Buyer Approval',            desc:'Send to buyer, track open + acceptance, capture revision requests and reissue quotations.', tag:'Engagement' },
              { n:3, title:'Convert to PI',             desc:'On buyer acceptance, convert to a Proforma Invoice with payment terms and incoterms.', tag:'Lock Pricing' },
              { n:4, title:'Receive Payment & BT',      desc:'Receipt of advance triggers Booking Thread (BT) hand-off to operations.', tag:'Hand-off' },
            ].map(s => (
              <div key={s.n} className="qpi-wdh-step">
                <div className="qpi-wdh-step-num">{s.n}</div>
                <div className="qpi-wdh-step-title">{s.title}</div>
                <p className="qpi-wdh-step-desc">{s.desc}</p>
                <span className="qpi-wdh-step-tag"><span className="qpi-wdh-step-dot" />{s.tag}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="qpi-card">
        <div className="qpi-card-head">
          <div className="qpi-card-title">{tab === 'quotation' ? 'Quotations' : 'Proforma Invoices'}</div>
          <button className="qpi-add-btn" onClick={() => toast.info('Coming next', `Create ${tab === 'quotation' ? 'Quotation' : 'PI'}`)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {tab === 'quotation' ? 'Create Quotation' : 'Create PI'}
          </button>
        </div>
        <div className="qpi-table-wrap">
          <table className="qpi-table">
            <thead>
              <tr>
                <th>{tab === 'quotation' ? 'Quotation #' : 'PI #'}</th>
                <th>Opportunity</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const col = STATUS_COLORS[r.status] || STATUS_COLORS['Draft'];
                return (
                  <tr key={r.id}>
                    <td><span className="qpi-mono">{r.id}</span></td>
                    <td><span className="qpi-mono">{r.oppId}</span></td>
                    <td><strong>{r.customer}</strong></td>
                    <td className="qpi-amt">{r.amount}</td>
                    <td>{r.currency}</td>
                    <td><span className="qpi-status" style={{ background: col.bg, color: col.fg, borderColor: col.border }}>{r.status}</span></td>
                    <td>{r.date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.qpi-root {
  font-family: 'DM Sans', 'Inter', sans-serif;
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 40%, #ede9fe 100%);
  padding: 12px 22px 24px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 12px;
}
.qpi-root *, .qpi-root *::before, .qpi-root *::after { box-sizing: border-box; }

.qpi-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 18px; min-height: 60px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(124,58,237,.1);
}
.qpi-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 14px 0 0 14px; }
.qpi-glow { position: absolute; right: -10px; top: -10px; width: 100px; height: 100px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.qpi-header-left { display: flex; align-items: center; gap: 12px; z-index: 1; padding-left: 6px; }
.qpi-header-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.qpi-header-title { font-size: 14.5px; font-weight: 800; color: #3b0764; letter-spacing: -.3px; }
.qpi-header-sub   { font-size: 10.5px; color: #7c3aed; margin-top: 2px; font-weight: 500; }

.qpi-tab-switch {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(255,255,255,.6);
  border: 1px solid rgba(124,58,237,.2);
  border-radius: 10px; z-index: 1;
}
.qpi-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 7px; border: none;
  background: transparent; color: #7c3aed;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.qpi-tab:hover { background: rgba(124,58,237,.08); }
.qpi-tab.active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.4); }

.qpi-wdh {
  position: relative;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(139,92,246,.1);
}
.qpi-wdh-header { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; cursor: pointer; user-select: none; }
.qpi-wdh-title { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 800; color: #3b0764; }
.qpi-wdh-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); display: flex; align-items: center; justify-content: center; }
.qpi-wdh-toggle { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid rgba(124,58,237,.25); background: rgba(255,255,255,.7); display: flex; align-items: center; justify-content: center; cursor: pointer; }

.qpi-wdh-body {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px; padding: 6px 14px 12px;
}
.qpi-wdh-step {
  background: #fff; border: 1.5px solid #e8e4f9;
  border-left: 3px solid #7c3aed; border-radius: 10px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.qpi-wdh-step-num { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.qpi-wdh-step-title { font-size: 11.5px; font-weight: 800; color: #5b21b6; }
.qpi-wdh-step-desc { font-size: 10.5px; color: #6b7280; line-height: 1.45; margin: 0; }
.qpi-wdh-step-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 800; color: #5b21b6; letter-spacing: .04em; text-transform: uppercase; }
.qpi-wdh-step-dot { width: 5px; height: 5px; border-radius: 50%; background: #7c3aed; }

.qpi-card { background: #fff; border: 1px solid #ddd6fe; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(124,58,237,.08); }
.qpi-card-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: linear-gradient(90deg, #f5f3ff, #ede9fe); border-bottom: 1px solid #ddd6fe; }
.qpi-card-title { font-size: 13.5px; font-weight: 800; color: #3b0764; }
.qpi-add-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: none; border-radius: 8px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(124,58,237,.35); }

.qpi-table-wrap { overflow-x: auto; }
.qpi-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 800px; }
.qpi-table thead tr { background: linear-gradient(90deg, #6d28d9, #7c3aed); }
.qpi-table thead th { color: #fff; font-size: 9.5px; font-weight: 700; padding: 10px 12px; text-align: left; text-transform: uppercase; letter-spacing: .06em; }
.qpi-table tbody tr { border-bottom: 1px solid #f3f4f6; }
.qpi-table tbody tr:hover { background: #faf5ff; }
.qpi-table tbody td { padding: 9px 12px; color: #475569; }
.qpi-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #7c3aed; font-weight: 700; }
.qpi-amt { font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.qpi-status { display: inline-flex; padding: 3px 10px; border-radius: 20px; border: 1px solid; font-size: 10.5px; font-weight: 700; }
`;
