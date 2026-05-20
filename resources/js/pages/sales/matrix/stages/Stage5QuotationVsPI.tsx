import { useState } from 'react';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* Sales Matrix → Stage 5 — Quotation vs PI
 * Quotation / Proforma Invoice list with "Convert to PI" affordance. */

type DocType = 'quotation' | 'pi';

type Quote = {
  no:    string;
  date:  string;
  type:  'International' | 'Domestic';
  ccy:   string;
  value: number;
};

const QUOTES: Quote[] = [
  { no: 'QT/2025-26/4', date: '28/04/2026', type: 'International', ccy: 'USD', value: 2500000 },
  { no: 'QT/2025-26/3', date: '15/04/2026', type: 'International', ccy: 'USD', value: 850000  },
  { no: 'QT/2025-26/2', date: '02/04/2026', type: 'International', ccy: 'USD', value: 1750000 },
  { no: 'QT/2025-26/1', date: '18/03/2026', type: 'International', ccy: 'USD', value: 3200000 },
];

export default function Stage5QuotationVsPI({ onPrev, onNext }: StageProps) {
  const [docType, setDocType] = useState<DocType>('quotation');

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE5_CSS}</style>

      <div className="smd-stg-head smd-st5-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 0 0 6.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 0 0 6.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 5: Quotation vs PI</div>
            <div className="smd-stg-head-sub">● Quotation / PI comparison underway</div>
          </div>
        </div>
        <div className="smd-st5-head-right">
          <span className="smd-st5-head-badge">● ACTIVE</span>
          <button className="smd-st5-view-summary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            View Latest Quoted Price Summary
          </button>
        </div>
      </div>

      <div className="smd-stg-body">
        <div className="smd-st5-tabs-row">
          <div className="smd-st5-tabs">
            <button className={`smd-st5-tab ${docType === 'quotation' ? 'active' : ''}`} onClick={() => setDocType('quotation')}>
              <span className="smd-st5-tab-bullet" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
              Quotation
            </button>
            <button className={`smd-st5-tab smd-st5-tab-pi ${docType === 'pi' ? 'active' : ''}`} onClick={() => setDocType('pi')}>
              <span className="smd-st5-tab-bullet" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="4" width="18" height="16" rx="2"/></svg>
              Proforma Invoice
            </button>
          </div>
          <div className="smd-st5-create-row">
            <button className="smd-st5-create-btn">+ Create Quotation</button>
            <button className="smd-st5-create-btn smd-st5-create-pi">+ Create PI</button>
          </div>
        </div>

        <div className="smd-st5-table-card">
          <table className="smd-st5-table">
            <thead>
              <tr>
                <th>SR NO</th>
                <th>QUOTATION NO</th>
                <th>QUOTATION DATE</th>
                <th>DOCUMENT TYPE</th>
                <th>CURRENCY</th>
                <th>QUOTATION VALUE</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {QUOTES.map((q, idx) => (
                <tr key={q.no}>
                  <td><span className="smd-st5-num">{idx + 1}</span></td>
                  <td><span className="smd-st5-qno">{q.no}</span></td>
                  <td>{q.date}</td>
                  <td><span className="smd-st5-doctype">{q.type}</span></td>
                  <td><span className="smd-st5-ccy">{q.ccy}</span></td>
                  <td className="smd-st5-value">{q.value.toLocaleString('en-IN')}</td>
                  <td>
                    <button className="smd-st5-convert">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                      </svg>
                      Convert to PI
                    </button>
                  </td>
                  <td>
                    <button className="smd-st5-icon-btn" aria-label="Send">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Verify the quotation matches the proforma invoice.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
          <button className="smd-stg-btn smd-stg-btn-primary" onClick={onNext}>Save &amp; Next →</button>
        </div>
      </div>
    </>
  );
}

const STAGE5_CSS = `
.smd-st5-head {
  background: linear-gradient(135deg,#0e7490 0%,#0891b2 60%,#06b6d4 100%);
}
.smd-st5-head-right { display: flex; align-items: center; gap: 10px; }
.smd-st5-head-badge {
  font-size: 9.5px; font-weight: 800; letter-spacing: .08em;
  padding: 4px 10px; border-radius: 20px;
  background: rgba(255,255,255,.22); color: #fff;
}
.smd-st5-view-summary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 10px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.35);
  color: #fff; font-size: 11px; font-weight: 700; cursor: pointer;
}
.smd-st5-view-summary:hover { background: rgba(255,255,255,.28); }

.smd-st5-tabs-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.smd-st5-tabs { display: flex; gap: 8px; }
.smd-st5-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: 10px;
  background: #fff; border: 1px solid #a5f3fc; color: #0e7490;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.smd-st5-tab.active { background: #0891b2; color: #fff; border-color: #0891b2; }
.smd-st5-tab-bullet { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.smd-st5-tab-pi { color: #047857; border-color: #a7f3d0; }
.smd-st5-tab-pi.active { background: #10b981; border-color: #10b981; }
.smd-st5-create-row { display: flex; gap: 8px; }
.smd-st5-create-btn {
  padding: 7px 14px; border-radius: 10px;
  background: #fff; border: 1px dashed #a5f3fc; color: #0e7490;
  font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.smd-st5-create-pi { border-color: #a7f3d0; color: #047857; }

.smd-st5-table-card {
  background: linear-gradient(180deg,#0c4a6e 0%,#0e7490 100%);
  border: 1px solid #0e7490; border-radius: 14px; overflow-x: auto;
  padding: 2px;
}
.smd-st5-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 720px; background: transparent; }
.smd-st5-table thead th {
  padding: 11px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #cffafe;
  background: rgba(255,255,255,.06);
  border-bottom: 1px solid rgba(255,255,255,.1);
}
.smd-st5-table tbody tr { background: #fff; }
.smd-st5-table tbody tr:nth-child(even) { background: #f0f9ff; }
.smd-st5-table tbody td {
  padding: 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #e0f2fe;
}
.smd-st5-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #ecfeff; color: #0e7490; font-size: 11px; font-weight: 800;
}
.smd-st5-qno { font-weight: 700; color: #0e7490; font-family: 'Inter',monospace; }
.smd-st5-doctype {
  font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px;
  background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc;
}
.smd-st5-ccy {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 7px;
  background: #1e293b; color: #fff;
}
.smd-st5-value { font-weight: 700; color: #0e7490; }
.smd-st5-convert {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  background: linear-gradient(135deg,#0891b2,#0e7490); color: #fff;
  font-size: 10.5px; font-weight: 700; border: none; cursor: pointer;
  box-shadow: 0 2px 8px rgba(8,145,178,.3);
}
.smd-st5-icon-btn {
  width: 28px; height: 28px; border-radius: 8px;
  background: #ecfeff; color: #0e7490; border: 1px solid #a5f3fc;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
`;
