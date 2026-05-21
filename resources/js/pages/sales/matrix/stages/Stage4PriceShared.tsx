import { useState } from 'react';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* Sales Matrix → Stage 4 — Price Shared
 * Lets the sales user capture a quoted price per product and toggle between
 * "Price To Be Share" and "Shared Price" tabs. */

type Tab = 'to_share' | 'shared';

type ProductRow = {
  code:     string;
  name:     string;
  category: string;
  status:   'active' | 'inactive';
  qty:      number;
  target:   number;
};

const PRODUCTS: ProductRow[] = [
  { code: 'P-001', name: 'Potato 50kg Bag Grade A', category: 'VEGETABLES', status: 'active',   qty: 80,  target: 290.00 },
  { code: 'P-002', name: 'Basmati Rice 25kg',       category: 'GRAINS',     status: 'active',   qty: 120, target: 1450.00 },
  { code: 'P-003', name: 'Turmeric Powder 10kg',    category: 'SPICES',     status: 'inactive', qty: 35,  target: 520.00 },
  { code: 'P-004', name: 'Cashew W240 50kg',        category: 'DRY FRUITS', status: 'inactive', qty: 60,  target: 3200.00 },
];

export default function Stage4PriceShared({ onPrev, onNext }: StageProps) {
  const [tab, setTab] = useState<Tab>('to_share');
  const [prices, setPrices] = useState<Record<string, string>>({});

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE4_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 4: Price Shared</div>
            <div className="smd-stg-head-sub">● Price shared with customer</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Tabs */}
        <div className="smd-st4-tabs">
          <button className={`smd-st4-tab ${tab === 'to_share' ? 'active' : ''}`} onClick={() => setTab('to_share')}>
            <span className="smd-st4-tab-icon">$</span>
            Price To Be Share
          </button>
          <button className={`smd-st4-tab smd-st4-tab-shared ${tab === 'shared' ? 'active' : ''}`} onClick={() => setTab('shared')}>
            <span className="smd-st4-tab-icon">✓</span>
            Shared Price
          </button>
        </div>

        {/* Table */}
        <div className="smd-st4-table-card">
          <table className="smd-st4-table">
            <thead>
              <tr>
                <th>SR NO</th>
                <th>PRODUCT CODE</th>
                <th>PRODUCT NAME</th>
                <th>STATUS</th>
                <th>QUANTITY</th>
                <th>TARGET PRICE</th>
                <th>QUOTED PRICE</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p, idx) => (
                <tr key={p.code}>
                  <td><span className="smd-st4-num">{idx + 1}</span></td>
                  <td><span className="smd-st4-code">{p.code}</span></td>
                  <td>
                    <div className="smd-st4-prod-name">{p.name}</div>
                    <div className="smd-st4-prod-cat">{p.category}</div>
                  </td>
                  <td>
                    <span className={`smd-st4-status ${p.status === 'active' ? 'smd-st4-status-active' : 'smd-st4-status-inactive'}`}>
                      ● {p.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{p.qty}</td>
                  <td className="smd-st4-target">$ {p.target.toFixed(2)}</td>
                  <td>
                    <div className="smd-st4-price-input">
                      <span className="smd-st4-price-prefix">$</span>
                      <input
                        type="text"
                        placeholder="Enter price"
                        value={prices[p.code] || ''}
                        onChange={e => setPrices(prev => ({ ...prev, [p.code]: e.target.value }))}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Note : Confirm that final pricing has been communicated to the customer.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
          <button className="smd-stg-btn smd-stg-btn-primary" onClick={onNext}>Save &amp; Next →</button>
        </div>
      </div>
    </>
  );
}

const STAGE4_CSS = `
.smd-st4-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.smd-st4-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: 10px;
  background: #fff; border: 1px solid #c4b5fd; color: #6d28d9;
  font-size: 12px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.smd-st4-tab.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.smd-st4-tab-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 6px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st4-tab.active .smd-st4-tab-icon { background: rgba(255,255,255,.2); color: #fff; }
.smd-st4-tab-shared { border-color: #a7f3d0; color: #047857; }
.smd-st4-tab-shared:not(.active) .smd-st4-tab-icon { background: #ecfdf5; color: #047857; }

.smd-st4-table-card {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow-x: auto;
}
.smd-st4-table { width: 100%; border-collapse: collapse; min-width: 780px; }
.smd-st4-table thead th {
  padding: 11px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #fff;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
}
.smd-st4-table thead th:first-child { border-radius: 0; }
.smd-st4-table tbody td {
  padding: 11px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.smd-st4-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st4-code {
  font-family: 'Inter',monospace; font-size: 11px; font-weight: 700;
  background: #faf5ff; color: #6d28d9; padding: 3px 8px; border-radius: 7px; border: 1px solid #e9d5ff;
}
.smd-st4-prod-name { font-weight: 700; color: #1e293b; }
.smd-st4-prod-cat  { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #94a3b8; margin-top: 1px; }
.smd-st4-status { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
.smd-st4-status-active   { background: #d1fae5; color: #047857; }
.smd-st4-status-inactive { background: #fee2e2; color: #dc2626; }
.smd-st4-target { font-weight: 700; color: #047857; }
.smd-st4-price-input {
  display: flex; align-items: center; gap: 0;
  border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; overflow: hidden;
  max-width: 160px;
}
.smd-st4-price-input:focus-within { border-color: #7c3aed; }
.smd-st4-price-prefix {
  padding: 7px 10px;
  background: #f5f3ff; color: #6d28d9;
  font-size: 11.5px; font-weight: 800;
  border-right: 1px solid #e9d5ff;
}
.smd-st4-price-input input {
  flex: 1; padding: 7px 10px; border: none; outline: none;
  font-size: 12px; color: #1e293b; min-width: 0;
}
`;
