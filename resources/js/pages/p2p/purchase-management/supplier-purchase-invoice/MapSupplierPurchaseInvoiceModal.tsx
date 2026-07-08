import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';

/* ─────────────────────────────────────────────────────────────────────────
 * "Map Supplier Purchase Invoice" choice modal — DESIGN-ONLY (static).
 * Faithful port of the P2P_Main prototype. No real submit yet.
 * ───────────────────────────────────────────────────────────────────────── */

type Choice = 'with' | 'without' | null;

const DEMO_POS = [
  'PO/2025-26/001 — Reliance Industries',
  'PO/2025-26/002 — Adani Enterprises',
  'PO/2025-26/003 — Mahindra Logistics',
  'PO/2025-26/004 — JSW Steel',
];
const DEMO_SUPPLIERS = ['Reliance Industries', 'Adani Enterprises', 'Mahindra Logistics', 'JSW Steel', 'Vedanta Ltd', 'Bharat Forge'];

export default function MapSupplierPurchaseInvoiceModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  useScrollLock();
  const [choice, setChoice] = useState<Choice>(null);
  const [po, setPo] = useState('');
  const [supplier, setSupplier] = useState('');

  const canConfirm = (choice === 'with' && !!po) || (choice === 'without' && !!supplier);

  return createPortal(
    <div className="spi-mdl-backdrop" onMouseDown={onClose}>
      <div className="spi-mdl" onMouseDown={e => e.stopPropagation()}>
        {/* Header */}
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoDoc /></div>
            <div>
              <div className="spi-mdl-title">Map Supplier Purchase Invoice</div>
              <div className="spi-mdl-sub">Choose how to map this supplier invoice.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="spi-mdl-body">
          <div className="spi-mdl-seclabel">MAP INVOICE TO PROCUREMENT</div>

          {/* With Purchase Order */}
          <button type="button" className={`spi-mdl-card ${choice === 'with' ? 'is-sel is-teal' : ''}`} onClick={() => setChoice('with')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-teal"><IcoLink /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">With Purchase Order <span className="spi-mdl-badge spi-mdl-badge-teal">RECOMMENDED</span></div>
              <div className="spi-mdl-card-desc">Link this invoice to an existing PO for a 3-way match.</div>
            </div>
            <span className={`spi-mdl-radio ${choice === 'with' ? 'is-on-teal' : ''}`}>{choice === 'with' && <IcoCheck />}</span>
          </button>

          {choice === 'with' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel"><IcoLink size={13} /> SELECT PURCHASE ORDER <span className="spi-mdl-req">*</span></label>
              <select className="spi-mdl-select" value={po} onChange={e => setPo(e.target.value)}>
                <option value="">— Select a Purchase Order —</option>
                {DEMO_POS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          {/* Without Purchase Order */}
          <button type="button" className={`spi-mdl-card ${choice === 'without' ? 'is-sel is-amber' : ''}`} onClick={() => setChoice('without')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-amber"><IcoWarn /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">Without Purchase Order <span className="spi-mdl-badge spi-mdl-badge-amber">STANDALONE</span></div>
              <div className="spi-mdl-card-desc">Capture a supplier invoice not tied to any PO.</div>
            </div>
            <span className={`spi-mdl-radio ${choice === 'without' ? 'is-on-amber' : ''}`}>{choice === 'without' && <IcoCheck />}</span>
          </button>

          {choice === 'without' && (
            <>
              <div className="spi-mdl-warn">
                <IcoWarn size={14} />
                <span><b>Standalone invoice</b> — not linked to any purchase order. Select the supplier this invoice is for.</span>
              </div>
              <div className="spi-mdl-field">
                <label className="spi-mdl-fieldlabel"><IcoLink size={13} /> SELECT SUPPLIER <span className="spi-mdl-req">*</span></label>
                <select className="spi-mdl-select" value={supplier} onChange={e => setSupplier(e.target.value)}>
                  <option value="">— Select Supplier —</option>
                  {DEMO_SUPPLIERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="spi-mdl-foot">
          <div className="spi-mdl-audit"><IcoClock /> All invoices are audit-tracked</div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" disabled={!canConfirm} onClick={onConfirm}>
              Confirm &amp; Continue <IcoArrow />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Inline icons ── */
function IcoDoc() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLink({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>; }
function IcoWarn({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoClock() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IcoArrow() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
