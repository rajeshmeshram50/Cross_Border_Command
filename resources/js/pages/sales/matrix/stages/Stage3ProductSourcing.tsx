import { useState } from 'react';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import { MasterSelect } from '../../../../components/ui/MasterSelect';

/* Sales Matrix → Stage 3 — Product Sourcing
 * Toggle between Product Details / Sourcing Required / Sourcing Not Required
 * and assign a sourcing status per mapped product. */

type Tab = 'details' | 'required' | 'not_required';

type Product = {
  code:     string;
  name:     string;
  category: string;
  status:   'active' | 'inactive';
  qty:      number;
  price:    number;
  currency: string;
};

const PRODUCTS: Product[] = [
  { code: 'P-001', name: 'Potato 50kg Bag Grade A',  category: 'VEGETABLES', status: 'active',   qty: 80,  price: 290.00,  currency: 'USD' },
  { code: 'P-002', name: 'Basmati Rice 25kg',        category: 'GRAINS',     status: 'active',   qty: 120, price: 1450.00, currency: 'USD' },
  { code: 'P-003', name: 'Turmeric Powder 10kg',     category: 'SPICES',     status: 'inactive', qty: 35,  price: 520.00,  currency: 'USD' },
  { code: 'P-004', name: 'Cashew W240 50kg',         category: 'DRY FRUITS', status: 'inactive', qty: 60,  price: 3200.00, currency: 'USD' },
];

export default function Stage3ProductSourcing({ onPrev, onNext }: StageProps) {
  const [tab, setTab] = useState<Tab>('details');
  const [sourcingStatus, setSourcingStatus] = useState<Record<string, string>>({});

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE3_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 3: Product Sourcing</div>
            <div className="smd-stg-head-sub">● Product and vendor sourcing in progress</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Sub-tabs */}
        <div className="smd-st3-tabs">
          <button className={`smd-st3-tab smd-st3-tab-detail ${tab === 'details'      ? 'active' : ''}`} onClick={() => setTab('details')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
            Product Details
            <span className="smd-st3-tab-count">{PRODUCTS.length}</span>
          </button>
          <button className={`smd-st3-tab smd-st3-tab-req ${tab === 'required'      ? 'active' : ''}`} onClick={() => setTab('required')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            Sourcing Required
          </button>
          <button className={`smd-st3-tab smd-st3-tab-not ${tab === 'not_required' ? 'active' : ''}`} onClick={() => setTab('not_required')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="20 6 9 17 4 12"/></svg>
            Sourcing Not Required
          </button>
        </div>

        {/* Mapped products */}
        <div className="smd-st3-table-card">
          <div className="smd-st3-table-head">
            <div className="smd-st3-table-head-left">
              <div className="smd-st3-table-head-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </div>
              <div>
                <div className="smd-st3-table-head-title">All Mapped Products <span className="smd-st3-head-pill">{PRODUCTS.length}</span></div>
                <div className="smd-st3-table-head-sub">Assign sourcing status to each product to proceed</div>
              </div>
            </div>
            <div className="smd-st3-legend">
              <span className="smd-st3-legend-item smd-st3-legend-active">● Active: either tab</span>
              <span className="smd-st3-legend-item smd-st3-legend-inactive">● Inactive: Required only</span>
            </div>
          </div>

          <div className="smd-st3-table-wrap">
            <table className="smd-st3-table">
              <thead>
                <tr>
                  <th>SR</th><th>CODE</th><th>PRODUCT NAME</th><th>STATUS</th>
                  <th>QTY</th><th>TARGET PRICE</th><th>CURRENCY</th><th>SOURCING STATUS</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCTS.map((p, idx) => (
                  <tr key={p.code}>
                    <td><span className="smd-st3-num">{idx + 1}</span></td>
                    <td><span className="smd-st3-code">{p.code}</span></td>
                    <td>
                      <div className="smd-st3-prod">
                        <div className="smd-st3-prod-name">{p.name}</div>
                        <div className="smd-st3-prod-cat">{p.category}</div>
                      </div>
                    </td>
                    <td>
                      <span className={`smd-st3-status ${p.status === 'active' ? 'smd-st3-status-active' : 'smd-st3-status-inactive'}`}>
                        ● {p.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{p.qty}</td>
                    <td>$ {p.price.toFixed(2)}</td>
                    <td><span className="smd-st3-currency">{p.currency}</span></td>
                    <td>
                      <MasterSelect
                        value={sourcingStatus[p.code] || ''}
                        onChange={(v) => setSourcingStatus(prev => ({ ...prev, [p.code]: v }))}
                        options={[
                          { value: 'vendor_assigned', label: 'Vendor Assigned' },
                          { value: 'awaiting_quote',  label: 'Awaiting Quote'  },
                          { value: 'sourced',         label: 'Sourced'         },
                          { value: 'not_required',    label: 'Not Required'    },
                        ]}
                        placeholder="— Select —"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Add product details and shortlist vendors to proceed.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
          <button className="smd-stg-btn smd-stg-btn-primary" onClick={onNext}>Save &amp; Next →</button>
        </div>
      </div>
    </>
  );
}

const STAGE3_CSS = `
.smd-st3-tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.smd-st3-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: 10px;
  background: #fff; border: 1px solid; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.smd-st3-tab-detail { color: #6d28d9; border-color: #c4b5fd; }
.smd-st3-tab-detail.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.smd-st3-tab-req    { color: #d97706; border-color: #fde68a; }
.smd-st3-tab-req.active { background: #fffbeb; }
.smd-st3-tab-not    { color: #047857; border-color: #a7f3d0; }
.smd-st3-tab-not.active { background: #ecfdf5; }
.smd-st3-tab-count {
  background: rgba(255,255,255,.3); color: inherit;
  font-size: 10.5px; font-weight: 800; padding: 1px 7px; border-radius: 20px;
}
.smd-st3-tab:not(.active) .smd-st3-tab-count { background: #f5f3ff; color: #6d28d9; }

.smd-st3-table-card {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: hidden;
}
.smd-st3-table-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: #faf5ff; border-bottom: 1px solid #e9d5ff; flex-wrap: wrap; }
.smd-st3-table-head-left { display: flex; align-items: center; gap: 9px; }
.smd-st3-table-head-icon { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg,#7c3aed,#6d28d9); display: flex; align-items: center; justify-content: center; }
.smd-st3-table-head-title { font-size: 13px; font-weight: 700; color: #4c1d95; display: flex; align-items: center; gap: 7px; }
.smd-st3-head-pill { background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 800; padding: 1px 8px; border-radius: 20px; }
.smd-st3-table-head-sub { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
.smd-st3-legend { display: flex; gap: 8px; font-size: 10.5px; font-weight: 600; }
.smd-st3-legend-active   { color: #10b981; }
.smd-st3-legend-inactive { color: #ef4444; }

.smd-st3-table-wrap { overflow-x: auto; }
.smd-st3-table { width: 100%; border-collapse: collapse; min-width: 760px; }
.smd-st3-table thead th {
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280;
  background: #faf5ff; border-bottom: 1px solid #e9d5ff;
}
.smd-st3-table tbody td {
  padding: 10px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.smd-st3-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st3-code {
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 700;
  background: #faf5ff; color: #6d28d9; padding: 3px 8px; border-radius: 7px; border: 1px solid #e9d5ff;
}
.smd-st3-prod-name { font-weight: 700; color: #1e293b; }
.smd-st3-prod-cat  { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #94a3b8; margin-top: 1px; }
.smd-st3-status { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
.smd-st3-status-active   { background: #d1fae5; color: #047857; }
.smd-st3-status-inactive { background: #fee2e2; color: #dc2626; }
.smd-st3-currency {
  font-size: 11px; font-weight: 700;
  background: #faf5ff; color: #6d28d9; padding: 2px 8px; border-radius: 7px;
}
.smd-st3-select {
  padding: 6px 10px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; font-size: 11.5px; color: #1e293b; min-width: 130px;
  cursor: pointer;
}
.smd-st3-select:focus { outline: none; border-color: #7c3aed; }
`;
