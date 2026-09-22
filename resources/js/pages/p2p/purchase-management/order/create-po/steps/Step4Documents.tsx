// Create PO — Step 04: Post PO Trade Document Management.
// The rows come from the CLM Trade Document / Agreement libraries that apply to
// the PO's product segments (seeded on submit), plus the Purchase Order itself.
// One list: each row says under its name whether it is a trade document or an
// agreement, and "mandatory" mirrors the library's highly-regulated flag.
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
import { formatDmy } from '../../../../../../utils/formatDmy';
import { FitTip } from '../form-fields';
import Tooltip from '../../../../../../components/ui/Tooltip';
import { useToast } from '../../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../../contexts/ConfirmContext';
import { IcoCertificate, IcoChevron, IcoDownload, IcoFolder, IcoHistory, IcoMail, IcoPaperclip, IcoSend, IcoShield, IcoUpload } from '../../shared/icons';

const SupplierEvidenceVaultModal = lazy(() => import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const warmVault = () => { void import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'); };
const SigningTrackerModal = lazy(() => import('../../../../../sales/opportunity-pipeline/SigningTrackerModal').then((m) => ({ default: m.SigningTrackerModal })));
/* The Zoho Sign sender the Customer vault, the lead's popup and the older PO
   screen all use — preview, draggable signature box, signers, expiry. */
const SendForSignatureModal = lazy(() => import('../../../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal'));

const isSigned = (doc: PoDocument) => doc.status === 'signed';
/* Which library a row came from. Rows created before the libraries were wired
   in carry no source, so the old doc_kind still decides for them. */
const isAgreement = (doc: PoDocument) =>
  doc.source_type === 'agreement' || (doc.source_type == null && doc.doc_kind === 'agreement');
/* Only the Purchase Order itself is necessary outright — its own kind says so,
   which also settles the rows seeded before the marking existed. Everything
   else is this PO's own call, and nobody has decided until somebody answers
   here, which is not the same as "not necessary". */
const isMandatory = (doc: PoDocument) => doc.doc_kind === 'purchase_order';
/* A row that came from a CLM library is signed through the CLM flow: the
   request is raised against the library id and the document is rendered
   server-side, so it needs no file of its own. The Purchase Order PDF and any
   uploaded file are ours, and go through this module's own send. */
const libraryOf = (doc: PoDocument): 'trade' | 'agreement' | null =>
  doc.source_id != null && (doc.source_type === 'trade' || doc.source_type === 'agreement') ? doc.source_type : null;
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
  /* The CLM library documents handed to the signature modal — trade documents
     by library id, agreements alongside them in the same envelope. */
  const [signing, setSigning] = useState<{
    rows: PoDocument[];
    trade: number[];
    agreements: Array<{ id: number; name: string; code?: string; sub?: string }>;
  } | null>(null);
  /* Our own files (the Purchase Order PDF, anything uploaded here) — they have
     no library row, so they go through this module's own send. */
  const [rawSigning, setRawSigning] = useState<PoDocument[] | null>(null);
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

  // The PO PDF is rendered by a background job after submit — check back until it lands.
  const awaitingPdf = docs.some((d) => d.doc_kind === 'purchase_order' && !d.file_path && d.status === 'pending');
  const polls = useRef(0);
  useEffect(() => {
    if (!awaitingPdf || !poId || polls.current >= 30) return;
    const t = window.setTimeout(() => { polls.current += 1; poDocumentApi.list(poId).then(setDocs).catch(() => {}); }, 4000);
    return () => window.clearTimeout(t);
  }, [awaitingPdf, poId, docs]);

  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await task(); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const patchDoc = (doc: PoDocument) => setDocs((all) => all.map((d) => (d.id === doc.id ? doc : d)));

  /* One request for the whole set — marking six documents is one round trip,
     the way the lead's popup does it. The Purchase Order is left out: it goes
     with the order whatever anyone says. */
  const setNeeds = (ids: number[], needed: boolean) => {
    const targets = docs.filter((d) => ids.includes(d.id) && !isMandatory(d));
    if (!targets.length) {
      toast.info('Nothing to change', 'The Purchase Order is always necessary.');
      return;
    }
    void run('needs', async () => {
      setDocs(await poDocumentApi.setNeeds(poId as number, targets.map((d) => ({ id: d.id, needed }))));
      toast.success(
        `${targets.length} document${targets.length === 1 ? '' : 's'} marked ${needed ? 'Necessary' : 'Not necessary'}`,
        needed ? 'They have to be signed for this PO.' : 'They will not be chased for this PO.',
      );
    });
  };

  // The file attached to the row (the Purchase Order PDF, or an upload).
  const downloadFile = (doc: PoDocument) => run(`file:${doc.id}`, async () => {
    saveBlob(await poDocumentApi.download(poId as number, doc.id), doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`);
  });

  /* The draft of a library row is the trade document / agreement itself, as a
     Word file — not whatever was uploaded against it. Our own rows (the
     Purchase Order PDF) have no template, so their file is the draft. */
  const canDownloadDraft = (doc: PoDocument) => (libraryOf(doc) ? true : !!doc.file_path);
  const downloadDraft = (doc: PoDocument) => run(`dl:${doc.id}`, async () => {
    const kind = libraryOf(doc);
    if (!kind) {
      saveBlob(await poDocumentApi.download(poId as number, doc.id), doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`);
      return;
    }
    const blob = await poSignatureApi.draft(kind, doc.source_id as number);
    saveBlob(blob, `Draft_${(doc.code || doc.name).replace(/[\\/:*?"<>|]/g, '_')}.docx`);
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
    if (notPending.length) { toast.warning('Already sent', `${notPending.map((d) => d.name).join(', ')} is already sent or signed.`); return; }

    const lib = chosen.filter((d) => libraryOf(d));
    const own = chosen.filter((d) => !libraryOf(d));

    if (lib.length) {
      if (!vaultTarget?.db_id) { toast.error('Supplier required', 'Select a supplier before sending documents for signature.'); return; }
      // Our own files cannot ride in a CLM envelope — that request is built
      // from the library, not from an upload. Say so rather than dropping them.
      if (own.length) {
        toast.info('Sent separately', `${own.map((d) => d.name).join(', ')} is not a library document — send it on its own after this.`);
      }
      setSigning({
        rows: lib,
        trade: lib.filter((d) => libraryOf(d) === 'trade').map((d) => d.source_id as number),
        // Agreements ride in the SAME envelope as the trade documents, so the
        // supplier gets one email for the whole set (the Case-to-Case pattern).
        agreements: lib.filter((d) => libraryOf(d) === 'agreement')
          .map((d) => ({ id: d.source_id as number, name: d.name, code: d.code, sub: d.doc_sub ?? undefined })),
      });
      return;
    }

    const missing = own.filter((d) => !d.file_path);
    if (missing.length) { toast.warning('File missing', `Attach a file first: ${missing.map((d) => d.name).join(', ')}.`); return; }
    setRawSigning(own);
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
          {/* Not view-only: missing documents can be uploaded here, and the legal status refreshes. */}
        <SupplierEvidenceVaultModal open supplier={vaultTarget} onVaultChange={ctx.refreshVault} onClose={() => setVaultOpen(false)} />
        </Suspense>
      )}
      {/* Library documents → the CLM signature flow. The request is raised
          against the library id and the document is rendered server-side, so
          the row needs no upload; the PO picks the request back up on reload
          (PoDocumentService::adoptClmSignatures) for the tracker, the signed
          copy, the certificate and the unsigned-paperwork gate. */}
      {signing && vaultTarget && (
        <Suspense fallback={null}>
          <SendForSignatureModal
            open
            /* A supplier's company signature is wider than the 150pt default
               and Zoho does not shrink it to fit. */
            boxSize={{ width: 240, height: 55 }}
            modelName="Vendor"
            /* One person may have to sign the same document in more than one
               place (Legal Team #9). */
            multiBox
            customer={vaultTarget}
            preselectedDocIds={signing.trade}
            mixedAgreements={signing.agreements}
            onClose={() => setSigning(null)}
            onSent={() => {
              const sent = signing.rows.map((d) => d.id);
              setSigning(null);
              setSelected((all) => all.filter((id) => !sent.includes(id)));
              reload();
            }}
          />
        </Suspense>
      )}
      {/* The Purchase Order PDF and anything uploaded here — no library row, so
          they go out through this module's own send. */}
      {rawSigning && poId && (
        <Suspense fallback={null}>
          <SendForSignatureModal
            open
            boxSize={{ width: 240, height: 55 }}
            modelName="Vendor"
            multiBox
            customer={{
              id: draft.supplier?.code ?? 'supplier',
              db_id: draft.vendorId ?? undefined,
              company: supplierName,
              contact: draft.supplier?.contact ?? undefined,
              email: supplierEmail || undefined,
            }}
            rawPdfContext={{
              docId: rawSigning[0].id,
              code: rawSigning[0].code,
              title: rawSigning[0].name,
              previewUrl: `/p2p/orders/${poId}/documents/${rawSigning[0].id}/download`,
              docs: rawSigning.map((d) => ({
                docId: d.id,
                code: d.code,
                title: d.name,
                previewUrl: `/p2p/orders/${poId}/documents/${d.id}/download`,
              })),
              sendUrl: `/p2p/orders/${poId}/documents/sign`,
              extraPayload: { document_ids: rawSigning.map((d) => d.id) },
            }}
            onClose={() => setRawSigning(null)}
            onSent={() => {
              const sent = rawSigning.map((d) => d.id);
              setRawSigning(null);
              setSelected((all) => all.filter((id) => !sent.includes(id)));
              reload();
            }}
          />
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
          <button type="button" className="cdoc-vault cpf-push" disabled={!vaultTarget} onPointerEnter={warmVault} onClick={(e) => { e.stopPropagation(); setVaultOpen(true); }}>
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
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!docs.length} aria-label="Select all documents" />
                  </th>
                  <th>Sr. No</th>
                  <th>Document Code</th>
                  <th className="cpd-th-left">Document Name</th>
                  <th>Necessary</th>
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
                        {/* Under the name: which library the row belongs to, then
                            that library's own type. */}
                        <div className="cdoc-ref">
                          <span className={`cdoc-kind${isAgreement(doc) ? ' cdoc-kind--agr' : ''}`}>
                            {isAgreement(doc) ? 'Agreement' : 'Trade Document'}
                          </span>
                          {doc.doc_kind === 'purchase_order' ? (ctx.detail?.code ?? '') : doc.doc_sub}
                        </div>
                      </td>
                      <td>
                        {isMandatory(doc) ? (
                          <Tooltip label="The Purchase Order always goes with the order — it cannot be marked not necessary" themed>
                            <span className="cdoc-req">NECESSARY</span>
                          </Tooltip>
                        ) : selected.includes(doc.id) ? (
                          /* Ticking a row is already the "I am dealing with this
                             one" gesture, so the Yes / No ride on it. */
                          <span className="cdoc-need">
                            <button type="button" disabled={busy === 'needs'}
                              className={`cdoc-need__b${doc.needed === 'yes' ? ' is-yes' : ''}`}
                              onClick={() => setNeeds([doc.id], true)}>Yes</button>
                            <button type="button" disabled={busy === 'needs'}
                              className={`cdoc-need__b${doc.needed === 'no' ? ' is-no' : ''}`}
                              onClick={() => setNeeds([doc.id], false)}>No</button>
                          </span>
                        ) : doc.needed == null ? (
                          /* Undecided. It must not read as "not necessary" —
                             nobody has answered for this PO yet. */
                          <Tooltip label="Not decided yet — tick the row to mark it Necessary or Not necessary" themed>
                            <span className="cdoc-req cdoc-req--todo">NOT DECIDED</span>
                          </Tooltip>
                        ) : (
                          <span className={`cdoc-req${doc.needed === 'yes' ? ' cdoc-req--need' : ' cdoc-req--opt'}`}>
                            {doc.needed === 'yes' ? 'NECESSARY' : 'NOT NECESSARY'}
                          </span>
                        )}
                      </td>
                      <td>{doc.generated_on ? formatDmy(doc.generated_on) : '—'}</td>
                      <td>{doc.valid_up_to ? formatDmy(doc.valid_up_to) : '—'}</td>
                      <td>
                        {/* The name needs its own span — text-overflow does nothing on a flex container. */}
                        {doc.file_path ? (
                          <button type="button" className="cdoc-file" onClick={() => downloadFile(doc)}>
                            <IcoPaperclip size={12} /><FitTip label={doc.original_name ?? 'Attachment'}><span>{doc.original_name ?? 'Attachment'}</span></FitTip>
                          </button>
                        ) : doc.doc_kind === 'purchase_order' && awaitingPdf && polls.current < 30 ? (
                          <span className="cpd-dash">Generating PDF…</span>
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
                          <button type="button" className="cdoc-btn" disabled={!canDownloadDraft(doc) || busy === `dl:${doc.id}`}
                            title={canDownloadDraft(doc) ? undefined : 'No file attached yet'}
                            onClick={() => downloadDraft(doc)}>
                            <IcoDownload size={13} /> {busy === `dl:${doc.id}` ? 'Preparing…' : 'Download Draft Document'}
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
            {selected.length > 0 ? (
              <span className="cdoc-selbar">
                <b>{selected.length}</b> selected
                <button type="button" className="cdoc-selbar__x" aria-label="Clear selection" onClick={() => setSelected([])}>×</button>
                <button type="button" className="cdoc-markbtn" disabled={busy === 'needs'} onClick={() => setNeeds(selected, true)}>
                  Mark Necessary
                </button>
                <button type="button" className="cdoc-markbtn" disabled={busy === 'needs'} onClick={() => setNeeds(selected, false)}>
                  Mark Not necessary
                </button>
              </span>
            ) : (
              <span className="cdoc-foot__hint">Select documents to mark them necessary, or to send / email them together</span>
            )}
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
