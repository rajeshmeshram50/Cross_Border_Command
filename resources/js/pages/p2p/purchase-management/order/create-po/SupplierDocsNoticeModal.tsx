// Step 03 stop: the supplier's standard documents (Company DD, Owner KYC,
// Trade Licenses) are not complete, so the PO cannot be submitted yet. The
// popup says what is missing and opens the Evidence Vault, where it is fixed —
// completing a document there refreshes the status and frees the submit.
import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { LegalSection, PendingCtcDoc } from './supplier-checks';
import { IcoShield, IcoX } from '../shared/icons';

const SupplierEvidenceVaultModal = lazy(() => import('../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));

export type SupplierDocsNotice = {
  /** The Evidence Vault's own header card for this supplier. */
  target: Record<string, unknown> & { id: string; db_id?: number; company: string };
  supplier: string;
  code: string;
  /** The standard-documents stop; absent on the case-to-case one. */
  section?: LegalSection;
  /* The case-to-case stop: paperwork of this supplier's earlier orders that is
     still unsigned. Another PO does not go out while it is outstanding. */
  pending?: PendingCtcDoc[];
};

export default function SupplierDocsNoticeModal({ notice, onClose, onVaultChange }: {
  notice: SupplierDocsNotice;
  onClose: () => void;
  /** A document was added or verified — the caller re-reads the vault. */
  onVaultChange?: () => void;
}) {
  useScrollLock(true, '.cdocn-card');
  const [vaultOpen, setVaultOpen] = useState(false);
  const { section, pending } = notice;
  const caseToCase = !section && !!pending?.length;
  const missing = section ? Math.max(0, section.total - section.done) : (pending?.length ?? 0);

  return createPortal(
    <>
      <div className="cdocn-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="cdocn-card" role="dialog" aria-modal="true" aria-label={caseToCase ? 'Case to case paperwork outstanding' : 'Supplier documents incomplete'}>
          <div className="cdocn-head">
            <span className="cdocn-ico"><IcoShield size={17} /></span>
            <div className="cdocn-headtxt">
              <div className="cdocn-title">{caseToCase ? 'Case to case paperwork outstanding' : 'Supplier documents incomplete'}</div>
              <div className="cdocn-sub">{notice.code}{notice.supplier ? ` — ${notice.supplier}` : ''}</div>
            </div>
            <button type="button" className="cdocn-x" onClick={onClose} aria-label="Close"><IcoX /></button>
          </div>

          <div className="cdocn-body">
            {/* The number first: it is what decides whether the PO can go. */}
            <div className="cdocn-lead">
              {caseToCase
                ? <><b>{missing}</b> document{missing === 1 ? '' : 's'} on this supplier's earlier purchase order{missing === 1 ? '' : 's'} {missing === 1 ? 'is' : 'are'} still unsigned.</>
                : <><b>{missing}</b> of <b>{section!.total}</b> standard document{section!.total === 1 ? '' : 's'} {missing === 1 ? 'is' : 'are'} still pending.</>}
            </div>
            <p className="cdocn-p">
              {caseToCase
                ? 'Another order is not placed on a supplier while the paperwork of the last one is outstanding — a signature is what closes it. Get these signed from the Evidence Vault or Stage 04, then submit again.'
                : "A purchase order cannot be submitted until this supplier's one-time paperwork is complete. Add or verify the documents in the Evidence Vault, then submit again."}
            </p>
            {/* Side by side, not stacked: three short names cost three rows of
                height for no gain. */}
            <div className="cdocn-list">
              {caseToCase
                ? pending!.slice(0, 8).map((d) => <span key={`${d.po}-${d.code}-${d.name}`} className="cdocn-chip">{d.po} · {d.name}</span>)
                : section!.parts.map((x) => <span key={x} className="cdocn-chip">{x}</span>)}
              {caseToCase && pending!.length > 8 && <span className="cdocn-chip">+{pending!.length - 8} more</span>}
            </div>
          </div>

          <div className="cdocn-foot">
            <button type="button" className="cdocn-btn cdocn-btn--ghost" onClick={onClose}>Close</button>
            <button type="button" className="cdocn-btn cdocn-btn--go" disabled={!notice.target.db_id} onClick={() => setVaultOpen(true)}>
              <IcoShield size={14} /> Open Supplier Evidence Vault
            </button>
          </div>
        </div>
      </div>

      {vaultOpen && (
        <Suspense fallback={null}>
          {/* Not view-only: the missing documents are uploaded right here. */}
          <SupplierEvidenceVaultModal
            open
            supplier={notice.target as never}
            onVaultChange={onVaultChange}
            onClose={() => setVaultOpen(false)}
          />
        </Suspense>
      )}
    </>,
    document.body,
  );
}
