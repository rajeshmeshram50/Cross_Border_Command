import { useEffect, useState } from 'react';
import TradeDocsTable from './TradeDocsTable';
import SupplierEvidenceVaultModal from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Trade Documents & Agreements — post-PO document modal.
 *
 * Opened from the PO list row action (shield / vault icon). Faithful port of
 * the prototype's poEvidence() overlay: a wide luxe modal that hosts the shared
 * Zoho-Sign-style trade-document table (TradeDocsTable). Frontend-only.
 * ───────────────────────────────────────────────────────────────────────── */

export default function TradeDocsModal({ po, poId, supName, supCode, supplierId, onClose }: { po: string; poId?: number | null; supName: string; supCode?: string; supplierId?: number | null; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [signActive, setSignActive] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div className="pom">
      <div className={`cpaysum-overlay ${shown ? 'is-open' : ''}`} style={{ display: (vaultOpen || signActive) ? 'none' : undefined }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="cpaysum-card cpaysum-card--lux cpaysum-card--xwide" role="dialog" aria-modal="true">
          <div className="cpaysum-hd cpaysum-hd--lux">
            <div className="cpaysum-hd__ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg></div>
            <div className="cpaysum-hd__txt">
              <div className="cpaysum-hd__titlerow">
                <div className="cpaysum-hd__t">Trade Documents &amp; Agreements</div>
                <div className="cpaysum-hd__docs">
                  <span className="cpaysum-hd__chip">{po}</span>
                  {supName && <><span className="dot" /><span className="cpaysum-hd__chip cpaysum-hd__chip--kv"><span className="k">Supplier</span>{supName}</span></>}
                </div>
              </div>
              <div className="cpaysum-hd__sub"><span>Generate, e-sign &amp; track post-PO trade documents via Zoho Sign</span></div>
            </div>
            <div className="cpaysum-hd__actions">
              <button type="button" className="potd-vault-btn" onClick={() => setVaultOpen(true)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /></svg><span>Supplier Legal Status</span></button>
              <button type="button" className="cpaysum-x" onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>

          <div className="cpaysum-bd2">
            <TradeDocsTable po={po} poId={poId} supplierId={supplierId} onSignActive={setSignActive} />
          </div>
        </div>
      </div>

      <SupplierEvidenceVaultModal
        open={vaultOpen}
        supplier={{ id: supCode || 'S-001', company: supName || 'Supplier', country: 'India', risk: 'Compliant' }}
        onClose={() => setVaultOpen(false)}
      />
    </div>
  );
}
