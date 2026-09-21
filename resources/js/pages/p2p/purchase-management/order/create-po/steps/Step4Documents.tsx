// Create PO — Step 04: Post PO Trade Document Management.
// The recap of stages 01–03, then the documents raised against this PO (created
// on submit; the Purchase Order PDF is generated then). Selected documents can
// be emailed or sent to the supplier for e-signature via Zoho Sign; the signing
// tracker, signed copy and certificate come from the shared signature endpoints.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import StageSummary from './StageSummary';
import type { PoDraft } from '../po-draft';
import type { StepCtx } from '../CreatePoForm';
import { vaultTargetOf } from '../supplier-checks';
import { PoApiError, poDocumentApi, poSignatureApi, type PoDocument } from '../../api/po-api';
import type { VaultData } from '../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';
import { formatDmy } from '../../../../../../utils/formatDmy';
import { useToast } from '../../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../../contexts/ConfirmContext';
import { IcoCertificate, IcoChevron, IcoDownload, IcoFolder, IcoHistory, IcoMail, IcoPaperclip, IcoSend, IcoShield, IcoUpload } from '../../shared/icons';

const SupplierEvidenceVaultModal = lazy(() => import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const SigningTrackerModal = lazy(() => import('../../../../../sales/opportunity-pipeline/SigningTrackerModal').then((m) => ({ default: m.SigningTrackerModal })));

const isSigned = (doc: PoDocument) => doc.status === 'signed';
/* Why the signed-only actions are greyed out, shown on hover. */
const NOT_SIGNED_YET = 'Available once the document is signed';

/** Status pill text — a request that came back declined / recalled says so. */
function statusLabel(doc: PoDocument): { text: string; tone: 'signed' | 'pending' } {
  if (doc.status === 'signed') return { text: 'Signed', tone: 'signed' };
  if (doc.status === 'sent') return { text: 'Sent for Signature', tone: 'pending' };
  const sig = (doc.signature_status ?? '').toLowerCase();
  if (['declined', 'rejected'].includes(sig)) return { text: 'Declined · Resend', tone: 'pending' };
  if (sig === 'recalled') return { text: 'Recalled · Resend', tone: 'pending' };
  if (sig === 'expired') return { text: 'Expired · Resend', tone: 'pending' };
  return { text: 'Pending', tone: 'pending' };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Step4Documents({ draft, ctx, poId }: { draft: PoDraft; ctx: StepCtx; poId: number | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(true);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [docs, setDocs] = useState<PoDocument[]>(ctx.detail?.documents ?? []);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  // Key of the action in flight ("sign", "email", "dl:12", …) — its button shows busy.
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState<PoDocument | null>(null);
  const uploadFor = useRef<PoDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => {
    if (e instanceof PoApiError) toast.error(`${e.action} failed`, e.firstError);
    else toast.error('Something went wrong', 'Please try again.');
  };

  // Load on open — the list also re-reads each sent document's signing status from Zoho.
  const reload = () => {
    if (!poId) { setLoading(false); return; }
    poDocumentApi.list(poId).then(setDocs).catch(fail).finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [poId]);

  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await task(); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const patchDoc = (doc: PoDocument) => setDocs((all) => all.map((d) => (d.id === doc.id ? doc : d)));

  const downloadDraft = (doc: PoDocument) => run(`dl:${doc.id}`, async () => {
    saveBlob(await poDocumentApi.download(poId as number, doc.id), doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`);
  });

  const downloadSigned = (doc: PoDocument) => run(`sdl:${doc.id}`, async () => {
    if (doc.signature_request_id == null) return;
    const blob = await poSignatureApi.signedFile(doc.signature_request_id, doc.signature_index ?? 0);
    saveBlob(blob, `Signed_${doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`}`);
  });

  const downloadCertificate = (doc: PoDocument) => run(`cert:${doc.id}`, async () => {
    if (doc.signature_request_id == null) return;
    saveBlob(await poSignatureApi.certificate(doc.signature_request_id), `Certificate_${doc.code.replace(/\//g, '_')}.pdf`);
  });

  const generate = (doc: PoDocument) => run(`gen:${doc.id}`, async () => {
    patchDoc(await poDocumentApi.generate(poId as number, doc.id));
    toast.success('Purchase Order PDF generated', doc.code);
  });

  const pickUpload = (doc: PoDocument) => {
    uploadFor.current = doc;
    fileInput.current?.click();
  };
  const onFile = (file: File | undefined) => {
    const doc = uploadFor.current;
    if (fileInput.current) fileInput.current.value = '';
    if (!doc || !file) return;
    void run(`up:${doc.id}`, async () => {
      patchDoc(await poDocumentApi.uploadFile(poId as number, doc.id, file));
      toast.success('File attached', `${file.name} → ${doc.name}`);
    });
  };

  const chosen = docs.filter((d) => selected.includes(d.id));
  const noFile = chosen.filter((d) => !d.file_path);
  const notPending = chosen.filter((d) => d.status !== 'pending');
  const supplierName = draft.supplier?.name ?? 'the supplier';
  const supplierEmail = draft.supplier?.email ?? '';

  const sendForSignature = () => {
    if (noFile.length) { toast.warning('File missing', `Attach a file first: ${noFile.map((d) => d.name).join(', ')}.`); return; }
    if (notPending.length) { toast.warning('Already sent', `${notPending.map((d) => d.name).join(', ')} is already sent or signed.`); return; }
    void (async () => {
      const ok = await confirm({
        title: 'Send for e-signature?',
        message: `${chosen.length} document${chosen.length === 1 ? '' : 's'} will be sent to ${supplierName}${supplierEmail ? ` (${supplierEmail})` : ''} for signature via Zoho Sign.`,
        tone: 'info', confirmLabel: 'Send for Signature', icon: 'quill-pen-line',
      });
      if (!ok) return;
      await run('sign', async () => {
        const res = await poDocumentApi.sign(poId as number, selected);
        setDocs(res.documents);
        setSelected([]);
        toast.success('Sent for signature', `Zoho Sign emailed ${res.signer.email}.`);
      });
    })();
  };

  const sendEmail = () => {
    if (noFile.length) { toast.warning('File missing', `Attach a file first: ${noFile.map((d) => d.name).join(', ')}.`); return; }
    void (async () => {
      const ok = await confirm({
        title: 'Email documents?',
        message: `${chosen.length} document${chosen.length === 1 ? '' : 's'} will be emailed to ${supplierName}${supplierEmail ? ` (${supplierEmail})` : ''}.`,
        tone: 'info', confirmLabel: 'Send Email', icon: 'mail-send-line',
      });
      if (!ok) return;
      await run('email', async () => {
        const res = await poDocumentApi.email(poId as number, selected);
        setSelected([]);
        toast.success('Email sent', `${res.count} document${res.count === 1 ? '' : 's'} emailed to ${res.to}.`);
      });
    })();
  };

  const allSelected = docs.length > 0 && selected.length === docs.length;
  const toggleAll = () => setSelected(allSelected ? [] : docs.map((d) => d.id));
  const toggleOne = (id: number) =>
    setSelected((all) => (all.includes(id) ? all.filter((c) => c !== id) : [...all, id]));

  const vaultTarget = draft.supplier ? vaultTargetOf(draft.supplier) : null;

  return (
    <>
      <StageSummary draft={draft} ctx={ctx} upto={3} />

      <input ref={fileInput} type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => onFile(e.target.files?.[0])} />

      {vaultOpen && vaultTarget && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal open viewOnly supplier={vaultTarget} data={draft.vault as VaultData | null} onClose={() => setVaultOpen(false)} />
        </Suspense>
      )}
      {tracking?.signature_request_id != null && (
        <Suspense fallback={null}>
          <SigningTrackerModal sigId={tracking.signature_request_id} code={tracking.code} onClose={() => { setTracking(null); reload(); }} />
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
          <button type="button" className="cdoc-vault cpf-push" disabled={!vaultTarget} onClick={(e) => { e.stopPropagation(); setVaultOpen(true); }}>
            <span className="cdoc-vault__ico"><IcoShield size={14} /></span>
            <span className="cdoc-vault__t">Supplier Evidence Vault</span>
            <span className="cdoc-vault__s">(KYC, Due Diligence, Trade Licenses, Trade Documents and Agreements)</span>
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
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!docs.length} aria-label="Select all documents" />
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
                {docs.length === 0 && (
                  <tr><td colSpan={10} className="cpd-empty">{loading ? 'Loading documents…' : 'Documents are created when the PO is submitted.'}</td></tr>
                )}
                {docs.map((doc, i) => {
                  const st = statusLabel(doc);
                  const hasSig = doc.signature_request_id != null;
                  return (
                    <tr key={doc.id}>
                      <td className="cdoc-check">
                        <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleOne(doc.id)} aria-label={`Select ${doc.name}`} />
                      </td>
                      <td>{i + 1}</td>
                      <td><span className="cpd-code">{doc.code}</span></td>
                      <td className="cpd-td-left">
                        <div className="cpd-prod__nm">{doc.name}</div>
                        <div className="cdoc-ref">{doc.doc_kind === 'purchase_order' ? (ctx.detail?.code ?? '') : doc.doc_kind === 'agreement' ? 'Agreement' : 'Other'}</div>
                      </td>
                      <td>{doc.is_required === 'yes' && <span className="cdoc-req">REQ</span>}</td>
                      <td>{doc.generated_on ? formatDmy(doc.generated_on) : '—'}</td>
                      <td>{doc.valid_up_to ? formatDmy(doc.valid_up_to) : '—'}</td>
                      <td>
                        {/* The name needs its own span — text-overflow does nothing on a flex container. */}
                        {doc.file_path ? (
                          <button type="button" className="cdoc-file" title={doc.original_name ?? ''} onClick={() => downloadDraft(doc)}>
                            <IcoPaperclip size={12} /><span>{doc.original_name ?? 'Attachment'}</span>
                          </button>
                        ) : doc.doc_kind === 'purchase_order' ? (
                          <button type="button" className="cdoc-btn" disabled={busy === `gen:${doc.id}`} onClick={() => generate(doc)}>
                            <IcoFolder size={13} /> {busy === `gen:${doc.id}` ? 'Generating…' : 'Generate PDF'}
                          </button>
                        ) : (
                          <button type="button" className="cdoc-btn" disabled={busy === `up:${doc.id}`} onClick={() => pickUpload(doc)}>
                            <IcoUpload size={13} /> {busy === `up:${doc.id}` ? 'Uploading…' : 'Upload File'}
                          </button>
                        )}
                      </td>
                      <td>
                        <span className={`cdoc-status cdoc-status--${st.tone}`}>
                          <span className="cdoc-status__dot" /> {st.text}
                        </span>
                      </td>
                      <td>
                        {/* Every row carries the same four actions, disabled when they don't apply yet. */}
                        <div className="cdoc-actions">
                          <button type="button" className="cdoc-btn" disabled={!doc.file_path || busy === `dl:${doc.id}`}
                            title={doc.file_path ? undefined : 'No file attached yet'} onClick={() => downloadDraft(doc)}>
                            <IcoDownload size={13} /> Download Draft Document
                          </button>
                          <button type="button" className="cdoc-btn cdoc-btn--signed" disabled={!isSigned(doc) || busy === `sdl:${doc.id}`}
                            title={isSigned(doc) ? undefined : NOT_SIGNED_YET} onClick={() => downloadSigned(doc)}>
                            <IcoDownload size={13} /> Download Signed Document
                          </button>
                          {/* Where this document sits in the Zoho Sign journey. */}
                          <button type="button" className="cdoc-icobtn" disabled={!hasSig}
                            title={hasSig ? 'Signing Tracker' : 'Available once sent for signature'} aria-label="Signing Tracker"
                            onClick={() => setTracking(doc)}>
                            <IcoHistory size={15} />
                          </button>
                          <button type="button" className="cdoc-icobtn cdoc-icobtn--cert" disabled={!isSigned(doc) || busy === `cert:${doc.id}`}
                            title={isSigned(doc) ? 'Download Certificate' : NOT_SIGNED_YET} aria-label="Download Certificate"
                            onClick={() => downloadCertificate(doc)}>
                            <IcoCertificate size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="cdoc-foot">
            <span className="cdoc-foot__hint">Select documents to send for signature or email them together</span>
            <button type="button" className="cdoc-send" disabled={selected.length === 0 || busy === 'email'} onClick={sendEmail}>
              <IcoMail size={13} /> {busy === 'email' ? 'Sending…' : 'Send Selected Via Email'}
            </button>
            <button type="button" className="cdoc-send cdoc-send--sign" disabled={selected.length === 0 || busy === 'sign'} onClick={sendForSignature}>
              <IcoSend size={13} /> {busy === 'sign' ? 'Sending…' : 'Send Selected for Signature'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
