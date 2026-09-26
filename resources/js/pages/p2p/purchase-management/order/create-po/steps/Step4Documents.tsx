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
import { IcoCertificate, IcoChevron, IcoDownload, IcoEye, IcoFolder, IcoHistory, IcoMail, IcoSend, IcoShield } from '../../shared/icons';

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
/* Only a Necessary document goes out for signature: the Purchase Order always,
   a library document once this PO has marked it Necessary. Not necessary — or
   not decided yet — stays here (the lead's popup gates its Send the same way). */
const isNeeded = (doc: PoDocument) => isMandatory(doc) || doc.needed === 'yes';
/* Out for signature, or signed: the answer is settled. It reads Necessary, it
   cannot be re-marked, and the row cannot be ticked. A declined / recalled
   request puts the row back to pending, which frees it again. */
const isSettled = (doc: PoDocument) => doc.status === 'sent' || doc.status === 'signed';
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
  const listRef = useRef<HTMLDivElement | null>(null);
  // Ticks made in the last moment, waiting to go out as one Necessary call.
  const pendingNeeds = useRef(new Map<number, boolean>());
  const needsTimer = useRef<number | null>(null);
  useEffect(() => () => { if (needsTimer.current) window.clearTimeout(needsTimer.current); }, []);
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

  /* Signing happens in Zoho, in another tab, so nothing here tells us when it
     lands. While anything is out for signature the list is re-read quietly —
     it syncs each request's status server-side — and at once when this tab is
     looked at again, so a signed document does not wait for a page refresh. */
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const awaitingSign = docs.some((d) => d.status === 'sent');
  useEffect(() => {
    if (!poId || !awaitingSign) return;
    let live = true;
    const check = () => {
      poDocumentApi.list(poId).then((fresh) => {
        if (!live) return;
        const byId = new Map(docsRef.current.map((d) => [d.id, d]));
        const moved = fresh.some((f) => byId.get(f.id)?.status !== f.status);
        if (!moved) return;
        setDocs(fresh);
        // Step 04 going quiet unlocks (or re-locks) the earlier steps.
        ctx.reloadDetail();
      }).catch(() => { /* a poll that fails is simply the next one's problem */ });
    };
    const onBack = () => { if (document.visibilityState === 'visible') check(); };
    const timer = window.setInterval(check, 15000);
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, awaitingSign]);

  /* The tick and the answer are one thing, so a Necessary row comes up ticked
     and an unticked row reads Not necessary. Rows already out for signature
     are settled — they carry the locked chip instead of a tick. */
  useEffect(() => {
    setSelected(docs.filter((d) => isNeeded(d) && !isSettled(d)).map((d) => d.id));
  }, [docs]);

  /* Eight rows are the window, the rest come on the scroll. Measured rather than
     a fixed height: a row grows with zoom and with a name that wraps. */
  useEffect(() => {
    const box = listRef.current;
    const table = box?.querySelector('table');
    if (!box || !table) return;
    const apply = () => {
      const rows = Array.from(table.tBodies[0]?.rows ?? []);
      if (rows.length <= 8) { box.style.maxHeight = ''; return; }
      const head = table.tHead?.getBoundingClientRect().height ?? 0;
      const body = rows[7].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top;
      box.style.maxHeight = `${Math.ceil(head + body)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(table);
    return () => ro.disconnect();
  }, [docs]);

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
    const targets = docs.filter((d) => ids.includes(d.id) && !isMandatory(d) && !isSettled(d));
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

  /* The Purchase Order PDF is built from the PO itself. It is normally rendered
     in the background after submit; if that has not landed yet (or the queue is
     not running), render it now — nobody should have to attach or generate it. */
  const ensureFile = async (doc: PoDocument): Promise<PoDocument> => {
    if (doc.file_path || doc.doc_kind !== 'purchase_order') return doc;
    const made = await poDocumentApi.generate(poId as number, doc.id);
    patchDoc(made);
    return made;
  };

  /* The draft of a row as a PDF. A library row is the trade document /
     agreement itself, rendered for this supplier — the same PDF the signature
     sender previews. Our own rows (the Purchase Order) are their own file. */
  const canDraft = (doc: PoDocument) =>
    libraryOf(doc) ? !!draft.vendorId : doc.doc_kind === 'purchase_order' || !!doc.file_path;
  const draftBlob = async (doc: PoDocument): Promise<Blob> => {
    const kind = libraryOf(doc);
    if (kind && draft.vendorId) return poSignatureApi.draft(kind, doc.source_id as number, draft.vendorId);
    const d = await ensureFile(doc);
    return poDocumentApi.download(poId as number, d.id);
  };

  const downloadDraft = (doc: PoDocument) => run(`dl:${doc.id}`, async () => {
    const name = libraryOf(doc) ? `Draft_${(doc.code || doc.name).replace(/[\\/:*?"<>|]/g, '_')}.pdf`
      : doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`;
    saveBlob(await draftBlob(doc), name);
  });

  /* View opens the draft in a new tab. The tab is opened inside the click —
     the browser allows that — and pointed at the PDF once it has arrived. */
  const viewDoc = (doc: PoDocument) => {
    if (busy) return;
    const w = window.open('', '_blank');
    void run(`view:${doc.id}`, async () => {
      try {
        const url = URL.createObjectURL(await draftBlob(doc));
        if (w) w.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        w?.close();
        throw e;
      }
    });
  };

  const downloadSigned = (doc: PoDocument) => run(`sdl:${doc.id}`, async () => {
    if (doc.signature_request_id == null) return;
    const blob = await poSignatureApi.signedFile(doc.signature_request_id, doc.signature_index ?? 0);
    saveBlob(blob, `Signed_${doc.original_name || `${doc.code.replace(/\//g, '_')}.pdf`}`);
  });

  const downloadCertificate = (doc: PoDocument) => run(`cert:${doc.id}`, async () => {
    if (doc.signature_request_id == null) return;
    saveBlob(await poSignatureApi.certificate(doc.signature_request_id), `Certificate_${doc.code.replace(/\//g, '_')}.pdf`);
  });

  const chosen = docs.filter((d) => selected.includes(d.id));
  // Email sends stored files; the Purchase Order's is rendered on demand.
  const noFile = chosen.filter((d) => !d.file_path && d.doc_kind !== 'purchase_order');
  const notPending = chosen.filter((d) => d.status !== 'pending');
  const supplierName = draft.supplier?.name ?? 'the supplier';
  const supplierEmail = draft.supplier?.email ?? '';

  const sendForSignature = () => {
    if (notPending.length) { toast.warning('Already sent', `${notPending.map((d) => d.name).join(', ')} is already sent or signed.`); return; }
    const unneeded = chosen.filter((d) => !isNeeded(d));
    if (unneeded.length) {
      toast.warning('Mark it Necessary first',
        `${unneeded.map((d) => d.name).join(', ')} ${unneeded.length === 1 ? 'is' : 'are'} not marked Necessary — only necessary documents are sent for signature.`);
      return;
    }

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
          // The library's own code, as the trade documents beside them show.
          .map((d) => ({ id: d.source_id as number, name: d.name, code: d.master_code ?? d.code, sub: d.doc_sub ?? undefined })),
      });
      return;
    }

    // The Purchase Order is rendered on the spot if it has no PDF yet
    // (ensureFile); any other row of ours without a file has nothing to send.
    const missing = own.filter((d) => !d.file_path && d.doc_kind !== 'purchase_order');
    if (missing.length) { toast.warning('No file to send', `${missing.map((d) => d.name).join(', ')} has no file.`); return; }
    void run('sign', async () => {
      setRawSigning(await Promise.all(own.map(ensureFile)));
    });
  };

  const sendEmail = () => {
    if (noFile.length) {
      toast.warning('Not available by email', `${noFile.map((d) => d.name).join(', ')} — trade documents and agreements go to the supplier through Send for Signature.`);
      return;
    }
    void (async () => {
      const ok = await confirm({
        title: 'Email documents?',
        message: `${chosen.length} document${chosen.length === 1 ? '' : 's'} will be emailed to ${supplierName}${supplierEmail ? ` (${supplierEmail})` : ''}.`,
        tone: 'info', confirmLabel: 'Send Email', icon: 'mail-send-line',
      });
      if (!ok) return;
      await run('email', async () => {
        await Promise.all(chosen.map(ensureFile));
        const res = await poDocumentApi.email(poId as number, selected);
        setSelected([]);
        toast.success('Email sent', `${res.count} document${res.count === 1 ? '' : 's'} emailed to ${res.to}.`);
      });
    })();
  };

  // Rows already out for signature / signed cannot be ticked, so "all" means the rest.
  const selectable = docs.filter((d) => !isSettled(d));
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.includes(d.id));
  /* The tick IS the answer: ticking a row marks it Necessary, and answering No
     takes the tick off again (see setNeeds). Untick on its own only drops the
     row from the selection — it does not decide anything.
     Quick ticks ride together: one request for the whole burst, and no toast,
     because the tick itself is the feedback. */
  const queueNeeds = (ids: number[], needed: boolean) => {
    for (const id of ids) pendingNeeds.current.set(id, needed);
    if (needsTimer.current) window.clearTimeout(needsTimer.current);
    needsTimer.current = window.setTimeout(() => {
      const batch = [...pendingNeeds.current].map(([id, needed]) => ({ id, needed }));
      pendingNeeds.current.clear();
      needsTimer.current = null;
      if (!batch.length || !poId) return;
      poDocumentApi.setNeeds(poId, batch).then(setDocs).catch(fail);
    }, 220);
  };
  const toggleAll = () => {
    const move = selectable.filter((d) => !isMandatory(d) && d.needed === (allSelected ? 'yes' : 'no'));
    setSelected(allSelected ? selectable.filter(isMandatory).map((d) => d.id) : selectable.map((d) => d.id));
    if (move.length) queueNeeds(move.map((d) => d.id), !allSelected);
  };
  const toggleOne = (id: number) => {
    const doc = docs.find((d) => d.id === id);
    const ticking = !selected.includes(id);
    setSelected((all) => (all.includes(id) ? all.filter((c) => c !== id) : [...all, id]));
    // The Purchase Order always stays Necessary; its tick only picks it for sending.
    if (doc && !isMandatory(doc) && doc.needed !== (ticking ? 'yes' : 'no')) queueNeeds([id], ticking);
  };

  const vaultTarget = draft.supplier ? vaultTargetOf(draft.supplier) : null;

  return (
    <>
      <StageSummary draft={draft} ctx={ctx} upto={3} />


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
            onSent={(_ids, signatureRequestId) => {
              const sent = signing.rows.map((d) => d.id);
              setSigning(null);
              setSelected((all) => all.filter((id) => !sent.includes(id)));
              /* Record which request went out for THESE rows. The CLM request
                 knows nothing about a purchase order, so without this the only
                 way back is matching by supplier + library id — which claimed
                 requests other screens had raised. */
              const done = () => { reload(); ctx.reloadDetail(); };
              if (signatureRequestId) {
                poDocumentApi.markSent(poId as number, sent, signatureRequestId).then(setDocs).catch(fail).finally(done);
              } else {
                done();
              }
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
              ctx.reloadDetail();
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
          {/* Eight rows stand, the rest come on the scroll. */}
          <div ref={listRef} className={`cpd-scroll ${docs.length > 8 ? 'cdoc-scrollcap' : ''}`}>
            {/* Not the --pd compact variant: that one is tuned for the product
                grid's 15 columns. The documents table is roomier in the Figma. */}
            <table className="cpd-tbl cdoc-tbl">
              <thead>
                <tr>
                  <th className="cdoc-check">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!selectable.length} aria-label="Select all documents" />
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
                        <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleOne(doc.id)} aria-label={`Select ${doc.name}`}
                          disabled={isSettled(doc)}
                          title={isSettled(doc) ? 'Already sent for signature — nothing more to do on this row' : undefined} />
                      </td>
                      <td>{i + 1}</td>
                      {/* The CLM master's own code is what the libraries call this
                          document; our row code stands in for the Purchase Order. */}
                      <td>
                        <Tooltip label={doc.master_code ? `CLM master ${doc.master_code} · this PO's copy is ${doc.code}` : `This PO's document ${doc.code}`} themed>
                          <span className="cpd-code">{doc.master_code ?? doc.code}</span>
                        </Tooltip>
                      </td>
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
                        {isMandatory(doc) || isSettled(doc) ? (
                          <Tooltip label={isMandatory(doc)
                            ? 'The Purchase Order always goes with the order — it cannot be marked not necessary'
                            : 'Already sent for signature — it stays Necessary'} themed>
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
                        ) : (
                          /* CS-414: a document starts Not necessary and is
                             promoted after someone has read it — no third
                             "not decided yet" state to work through. */
                          <span className={`cdoc-req${doc.needed === 'yes' ? ' cdoc-req--need' : ' cdoc-req--opt'}`}>
                            {doc.needed === 'yes' ? 'NECESSARY' : 'NOT NECESSARY'}
                          </span>
                        )}
                      </td>
                      <td>{doc.generated_on ? formatDmy(doc.generated_on) : '—'}</td>
                      <td>{doc.valid_up_to ? formatDmy(doc.valid_up_to) : '—'}</td>
                      <td>
                        {/* One action: look at the document. The Purchase Order
                            is its own PDF (rendered here if the background job
                            has not made it yet); a library row is its draft. */}
                        <button type="button" className="cdoc-btn" disabled={!canDraft(doc) || busy === `view:${doc.id}`}
                          title={canDraft(doc) ? `View ${doc.name}` : 'Nothing to view yet'} onClick={() => viewDoc(doc)}>
                          <IcoEye size={13} /> {busy === `view:${doc.id}` ? 'Opening…' : 'View'}
                        </button>
                      </td>
                      <td>
                        <span className={`cdoc-status cdoc-status--${st.tone}`}>
                          <span className="cdoc-status__dot" /> {st.text}
                        </span>
                      </td>
                      <td>
                        {/* Every row carries the same four actions, disabled when they don't apply yet. */}
                        <div className="cdoc-actions">
                          <button type="button" className="cdoc-btn" disabled={!canDraft(doc) || busy === `dl:${doc.id}`}
                            title={canDraft(doc) ? undefined : 'Nothing to download yet'}
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
            {/* Nothing ticked is Necessary → nothing to send; say why on hover. */}
            <button type="button" className="cdoc-send cdoc-send--sign"
              disabled={!chosen.some(isNeeded) || busy === 'sign'}
              title={chosen.length && !chosen.some(isNeeded) ? 'Only necessary documents can be sent for signature — mark them Necessary first' : undefined}
              onClick={sendForSignature}>
              <IcoSend size={13} /> {busy === 'sign' ? 'Preparing PO…' : 'Send Selected for Signature'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
