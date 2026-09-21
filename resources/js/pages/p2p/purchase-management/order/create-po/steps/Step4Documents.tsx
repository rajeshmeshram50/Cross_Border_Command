// Create PO — Step 04: Post PO Trade Document Management.
// The recap of stages 01–03, then the documents raised against this PO with
// their signature status. Selecting rows enables the two send actions.
import { lazy, Suspense, useMemo, useState } from 'react';
import StageSummary from './StageSummary';
import { supplierByOption, supplierVaultData, supplierVaultTarget } from '../sample-suppliers';
// The Supplier master's own Evidence Vault, as on Step 01 — warmed on hover so
// the click never waits for the download.
const SupplierEvidenceVaultModal = lazy(() => import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const warmVault = () => { void import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'); };
import type { PoDraft } from '../po-draft';
import { PO_DOCUMENTS } from '../sample-documents';
import { FitTip } from '../form-fields';
import { useToast } from '../../../../../../contexts/ToastContext';
import { formatDmy } from '../../../../../../utils/formatDmy';
import { IcoCertificate, IcoChevron, IcoDownload, IcoFolder, IcoHistory, IcoMail, IcoPaperclip, IcoSend, IcoShield } from '../../icons';

const isSigned = (doc: { status: string }) => doc.status === 'signed';
/* Why the signed-only actions are greyed out, shown on hover. */
const NOT_SIGNED_YET = 'Available once the document is signed';

export default function Step4Documents({ draft }: { draft: PoDraft }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [vaultOpen, setVaultOpen] = useState(false);
  // The supplier picked on Step 01 is whose vault this opens.
  const picked = useMemo(() => supplierByOption(draft.supplier), [draft.supplier]);
  const vault = useMemo(
    () => (picked ? { supplier: supplierVaultTarget(picked), data: supplierVaultData(picked) } : null),
    [picked],
  );
  // A PO can reach this step without a master supplier (a standalone draft, or
  // one typed in by hand) — then there is no vault to show, so say that.
  const toast = useToast();
  const openVault = () => {
    if (vault) { setVaultOpen(true); return; }
    toast.info('No supplier selected', 'Pick a supplier on Step 01 to see its evidence vault.');
  };

  const allSelected = selected.length === PO_DOCUMENTS.length;
  const toggleAll = () => setSelected(allSelected ? [] : PO_DOCUMENTS.map((d) => d.code));
  const toggleOne = (code: string) =>
    setSelected((all) => (all.includes(code) ? all.filter((c) => c !== code) : [...all, code]));

  return (
    <>
      <StageSummary draft={draft} upto={3} />
      {/* View only: the PO shows what the supplier has on file, the supplier
          master is where those documents are managed. */}
      {vaultOpen && vault && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal
            open
            viewOnly
            supplier={vault.supplier}
            data={vault.data}
            onClose={() => setVaultOpen(false)}
          />
        </Suspense>
      )}

      <div className={`spi-dt-sec cpf-fill ${open ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head cpf-clickable" onClick={() => setOpen((o) => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoFolder /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Documents</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Post PO Trade Document Management</span>
            </div>
            <div className="spi-dt-sec-sub">Generate, e-sign &amp; track documents via Zoho Sign</div>
          </div>

          {/* Everything the supplier has on file, one click away. */}
          <button
            type="button"
            className="cdoc-vault cpf-push"
            onPointerEnter={warmVault}
            onClick={(e) => { e.stopPropagation(); openVault(); }}
          >
            <span className="cdoc-vault__ico"><IcoShield size={14} /></span>
            <span className="cdoc-vault__t">Supplier Evidence Vault</span>
            <FitTip label="KYC, Due Diligence, Trade Licenses, Trade Documents and Agreements">
              <span className="cdoc-vault__s">(KYC, Due Diligence, Trade Licenses, Trade Documents and Agreements)</span>
            </FitTip>
          </button>
          <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
        </div>

        <div className="spi-dt-sec-body cpd-body">
          <div className="cpd-scroll">
            {/* Not the --pd compact variant: that one is tuned for the product
                grid's 15 columns. The documents table is roomier in the Figma. */}
            <table className="cpd-tbl cdoc-tbl">
              <thead>
                <tr>
                  <th className="cdoc-check">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all documents" />
                  </th>
                  <th>Sr. No</th>
                  <th>Document Code</th>
                  <th className="cpd-th-left">Document Name</th>
                  <th>Required Status</th>
                  <th>Generated On</th>
                  <th>Valid Up To</th>
                  <th>Document Attachment</th>
                  <th>Current Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {PO_DOCUMENTS.map((doc, i) => (
                  <tr key={doc.code}>
                    <td className="cdoc-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(doc.code)}
                        onChange={() => toggleOne(doc.code)}
                        aria-label={`Select ${doc.name}`}
                      />
                    </td>
                    <td>{i + 1}</td>
                    <td><span className="cpd-code">{doc.code}</span></td>
                    <td className="cpd-td-left">
                      <div className="cpd-prod__nm">{doc.name}</div>
                      <div className="cdoc-ref">{doc.ref}</div>
                    </td>
                    <td>{doc.required && <span className="cdoc-req">REQ</span>}</td>
                    <td>{formatDmy(doc.generatedOn)}</td>
                    <td>{formatDmy(doc.validUpTo)}</td>
                    <td>
                      {/* The name needs its own span — text-overflow does
                          nothing on a flex container, so without it a long
                          file name is chopped off instead of ellipsised. */}
                      <button type="button" className="cdoc-file">
                        <IcoPaperclip size={12} /><FitTip label={doc.file}><span>{doc.file}</span></FitTip>
                      </button>
                    </td>
                    <td>
                      <span className={`cdoc-status cdoc-status--${doc.status}`}>
                        <span className="cdoc-status__dot" /> {doc.status === 'signed' ? 'Signed' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      {/* Every row carries the same four actions, disabled when
                          they don't apply yet. Hiding them made the column ragged
                          and hid what the row will be able to do once it's signed. */}
                      <div className="cdoc-actions">
                        <button type="button" className="cdoc-btn"><IcoDownload size={13} /> Download Draft Document</button>
                        <button
                          type="button"
                          className="cdoc-btn cdoc-btn--signed"
                          disabled={!isSigned(doc)}
                          title={isSigned(doc) ? undefined : NOT_SIGNED_YET}
                        >
                          <IcoDownload size={13} /> Download Signed Document
                        </button>
                        {/* Where this document sits in the Zoho Sign journey. */}
                        <button
                          type="button"
                          className="cdoc-icobtn"
                          title="Signing Tracker"
                          aria-label="Signing Tracker"
                        >
                          <IcoHistory size={15} />
                        </button>
                        {/* Zoho Sign's completion certificate. Icon only — the
                            row already carries two labelled downloads. */}
                        <button
                          type="button"
                          className="cdoc-icobtn cdoc-icobtn--cert"
                          disabled={!isSigned(doc)}
                          title={isSigned(doc) ? 'Download Certificate' : NOT_SIGNED_YET}
                          aria-label="Download Certificate"
                        >
                          <IcoCertificate size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cdoc-foot">
            <span className="cdoc-foot__hint">Select documents to send for signature or email them together</span>
            <button type="button" className="cdoc-send" disabled={selected.length === 0}>
              <IcoMail size={13} /> Send Selected Via Email
            </button>
            <button type="button" className="cdoc-send cdoc-send--sign" disabled={selected.length === 0}>
              <IcoSend size={13} /> Send Selected for Signature
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
