// Step 03 stop: the supplier's standard documents (Company DD, Owner KYC,
// Trade Licenses) are not complete, so the PO cannot be submitted yet. The
// popup says what is missing and opens the Evidence Vault, where it is fixed —
// completing a document there refreshes the status and frees the submit.
import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { LegalSection } from './supplier-checks';
import { IcoShield, IcoX } from '../shared/icons';

const SupplierEvidenceVaultModal = lazy(() => import('../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));

export type SupplierDocsNotice = {
  /** The Evidence Vault's own header card for this supplier. */
  target: Record<string, unknown> & { id: string; db_id?: number; company: string };
  supplier: string;
  code: string;
  section: LegalSection;
};

export default function SupplierDocsNoticeModal({ notice, onClose, onVaultChange }: {
  notice: SupplierDocsNotice;
  onClose: () => void;
  /** A document was added or verified — the caller re-reads the vault. */
  onVaultChange?: () => void;
}) {
  useScrollLock(true, '.cdocn-card');
  const [vaultOpen, setVaultOpen] = useState(false);
  const { section } = notice;
  const missing = Math.max(0, section.total - section.done);

  return createPortal(
    <>
      <div className="cdocn-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="cdocn-card" role="dialog" aria-modal="true" aria-label="Supplier documents incomplete">
          <div className="cdocn-head">
            <span className="cdocn-ico"><IcoShield size={17} /></span>
            <div className="cdocn-headtxt">
              <div className="cdocn-title">Supplier documents incomplete</div>
              <div className="cdocn-sub">{notice.code}{notice.supplier ? ` — ${notice.supplier}` : ''}</div>
            </div>
            <button type="button" className="cdocn-x" onClick={onClose} aria-label="Close"><IcoX /></button>
          </div>

          <div className="cdocn-body">
            {/* The number first: it is what decides whether the PO can go. */}
            <div className="cdocn-lead">
              <b>{missing}</b> of <b>{section.total}</b> standard document{section.total === 1 ? '' : 's'} {missing === 1 ? 'is' : 'are'} still pending.
            </div>
            <p className="cdocn-p">
              A purchase order cannot be submitted until this supplier's one-time paperwork is complete.
              Add or verify the documents in the Evidence Vault, then submit again.
            </p>
            {/* Side by side, not stacked: three short names cost three rows of
                height for no gain. */}
            <div className="cdocn-list">
              {section.parts.map((p) => <span key={p} className="cdocn-chip">{p}</span>)}
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
