import { resolveFileUrl } from './resolveFileUrl';

/**
 * Shared helper used by the Customer / Consignee / Supplier Evidence
 * Vault modals to surface Zoho Sign signature requests under their
 * "Trade Documents" tab.
 *
 * Each signature request can bundle up to 10 trade-doc-library rows;
 * we flatten that to one VaultDoc row per included doc so the Evidence
 * Vault's per-document table reads naturally (one row = one signing
 * artifact).
 *
 * Status mapping:
 *   - clm_signature_requests.status === 'completed'   → 'Signed'
 *   - everything else (inprogress / declined / etc.)  → 'Pending'
 *   The vault's existing badge colours treat both 'Pending' and
 *   non-'Verified' rows as warnings, which fits a signing flow that
 *   may still come back.
 *
 * `attachment_url` is set ONLY when the row is signed AND a signed PDF
 * is available — that's what enables the View / Download icons in the
 * vault's Actions column. Pending rows have a "Not uploaded" cell.
 */

export interface SigReqRow {
  id: number;
  status: string;
  /** 'trade_doc' | 'agreement' — discriminates which library the
   *  trade_doc_ids point at, so a trade-doc id and an agreement id that
   *  happen to share a number aren't conflated when overlaying status. */
  document_type?: string | null;
  zoho_request_id?: string | null;
  request_name?: string | null;
  trade_doc_ids?: number[] | null;
  document_names?: string[] | null;
  signed_document_paths?: Array<{ url?: string; path?: string; file_url?: string }> | null;
  /** Legacy single-file pointer (string disk-relative path) — backend
   *  still writes it alongside signed_document_paths for backward compat.
   *  Used as a last-resort fallback when the JSON array is missing
   *  entries for a particular doc index. */
  signed_document_path?: string | null;
  /** Backend-computed absolute URL for the single-file signed PDF
   *  (top-level companion to signed_document_path). Already routes
   *  through file_url() server-side so it's Azure-aware. */
  signed_document_url?: string | null;
  certificate_path?: string | null;
  /** Backend-computed absolute URL for the completion certificate
   *  (top-level companion to certificate_path). Azure-aware. */
  certificate_url?: string | null;
  signers?: Array<{ name?: string; email?: string; order?: number }> | null;
  created_at?: string | null;
  completed_at?: string | null;
  expiry_date?: string | null;
}

export interface VaultDocLike {
  id: number;
  /** clm_trade_doc_library.id this row maps to. On signature rows it's
   *  the sent draft's library id; on expected (segment-rule) rows it's
   *  the master id. Used to merge the two sources and to launch the
   *  Send-for-Signature flow from the Evidence Vault. */
  db_id?: number | null;
  name: string;
  reference?: string | null;
  authority?: string | null;
  issue_date?: string | null;
  expiry?: string | null;
  attachment?: string | null;
  attachment_url?: string | null;
  status: 'Verified' | 'Pending' | 'Expiring' | 'Signed';
  doc_code?: string | null;
  /** Applicable-party CSV (e.g. "Buyer, Consignee") — present on
   *  expected trade-doc rows so the vault can party-filter to match
   *  the edit form. */
  party?: string | null;
  /** Zoho Sign request DB id backing this row (when it has been sent).
   *  Needed to fire a reminder from the vault. */
  signature_request_id?: number | null;
  /** Raw signature-request status, lowercased: 'inprogress' | 'completed'
   *  | 'declined' | 'recalled' | etc. Undefined when the doc was never
   *  sent. Drives the Send / Reminder / View-only action gating. */
  sig_state?: string | null;
  /** URL to the Zoho-issued Certificate of Completion PDF — set on
   * EVERY signed doc row in a request (the certificate is one-per-
   * request, but each doc in the bundle should expose access to it
   * via the row's Actions column, matching New_IDIMS_6.0). */
  certificate_url?: string | null;
}

/**
 * Convert a list of signature requests into per-document vault rows.
 * Newest requests should come first (the API's `latest()` ordering),
 * so when the same trade-doc id appears multiple times we keep only
 * the FIRST occurrence — the latest sent counts.
 */
export function signatureRequestsToVaultDocs(rows: SigReqRow[]): VaultDocLike[] {
  const seenDocs = new Set<string>();
  const out: VaultDocLike[] = [];

  for (const req of rows) {
    const ids   = Array.isArray(req.trade_doc_ids)         ? req.trade_doc_ids         : [];
    const names = Array.isArray(req.document_names)        ? req.document_names        : [];
    const paths = Array.isArray(req.signed_document_paths) ? req.signed_document_paths : [];
    const signers = Array.isArray(req.signers)             ? req.signers               : [];

    // Counter party = first signer (the recipient who'll sign). Format
    // as "Name · email" so the vault's Counter Party column reads
    // meaningfully when both are available, and degrades to whichever
    // is set.
    const signer = signers[0];
    const counter = signer
      ? [signer.name, signer.email].filter(Boolean).join(' · ')
      : null;

    const rawState = String(req.status ?? '').toLowerCase();
    const isSigned = rawState === 'completed';
    /* Zoho ships one certificate per signature request, not per doc.
     * Attach the same URL to every doc-row in this request so each
     * row's Actions column can render its own "Certificate of
     * Completion" icon — mirrors New_IDIMS_6.0's per-row action menu
     * exactly.
     *
     * URL resolution priority:
     *   1. `certificate_url` — backend-computed absolute URL routed
     *      through file_url() server-side. This is Azure-aware: when
     *      the disk is Azure, this is the blob URL; when local, it's
     *      /storage/... on the API origin. ALWAYS prefer this.
     *   2. `certificate_path` via resolveFileUrl — only used when the
     *      top-level certificate_url is absent (older rows). Note that
     *      resolveFileUrl can only construct {api_base}/uploads/...
     *      paths, which are WRONG when the disk is Azure — so this
     *      is purely a fallback for local-disk legacy rows. */
    const certUrl = isSigned
      ? (req.certificate_url
          ? resolveFileUrl(req.certificate_url)
          : (req.certificate_path ? resolveFileUrl(req.certificate_path) : null))
      : null;

    for (let i = 0; i < ids.length; i++) {
      const docId = Number(ids[i]);
      if (!Number.isFinite(docId) || docId <= 0) continue;
      const seenKey = `${docId}`;
      if (seenDocs.has(seenKey)) continue;        // keep the latest send only
      seenDocs.add(seenKey);

      const signedEntry = paths[i] ?? null;
      /* URL resolution priority — mirror the certificate logic:
       *   1. Per-entry absolute URL (`file_url` / `url`) — these are
       *      backend-resolved at fetch time via file_url() and are
       *      Azure-aware (the blob's canonical https URL). ALWAYS
       *      prefer them.
       *   2. Top-level `signed_document_url` for legacy single-file
       *      rows where signed_document_paths is empty.
       *   3. Disk-relative `path` via resolveFileUrl — only correct
       *      when the disk is local (resolveFileUrl can't know the
       *      Azure container URL, so it'd produce a wrong
       *      `{api_base}/uploads/...` that 404s). Pure fallback.
       *   4. Top-level legacy `signed_document_path` (first doc only).
       */
      const rawAbs  = signedEntry?.file_url
        || signedEntry?.url
        || (i === 0 ? req.signed_document_url ?? null : null)
        || null;
      const rawPath = signedEntry?.path
        || (i === 0 ? req.signed_document_path ?? null : null)
        || null;
      const url = rawAbs
        ? resolveFileUrl(rawAbs)
        : (rawPath ? resolveFileUrl(rawPath) : null);
      const name = names[i] ?? `Document ${docId}`;

      out.push({
        // Synthetic stable id — vault row keys only need uniqueness within
        // this list, not a real PK. (req.id × 100 + i) safely fits.
        id: req.id * 100 + i,
        db_id: docId,
        signature_request_id: req.id,
        sig_state: rawState,
        name,
        reference: req.zoho_request_id ?? `REQ-${req.id}`,
        authority: counter,
        issue_date: req.created_at ?? null,
        expiry: req.expiry_date ?? null,
        attachment: isSigned && url ? `${name}.pdf` : null,
        attachment_url: isSigned ? url : null,
        status: isSigned ? 'Signed' : 'Pending',
        doc_code: null,
        certificate_url: certUrl,
      });
    }
  }

  return out;
}

export type VaultPartyKey = 'buyer' | 'consignee' | 'supplier';

/** Does a trade-doc's applicable-party CSV apply to the given party
 *  bucket? Mirrors ClmTradeDocumentController::libraryForParty so the
 *  Evidence Vault shows exactly the docs the edit form would. */
export function tradeDocMatchesParty(partyCsv: string | null | undefined, key: VaultPartyKey): boolean {
  const p = (partyCsv ?? '').toLowerCase();
  if (!p) return false;
  if (key === 'buyer')     return p.includes('buyer');
  if (key === 'consignee') return p.includes('consignee');
  return p.includes('supplier');   // any Supplier-* sub-type
}

/**
 * Build the Evidence Vault → Trade Documents list shown for a party.
 *
 * Combines two sources so the tab matches the party edit form *and*
 * reflects live signing status:
 *   1. `expected` — the segment-rule trade docs (from the vault endpoint),
 *      party-filtered to mirror the edit form's `for-party` intersection.
 *   2. `sigRows`  — flattened Zoho Sign requests (one row per sent draft).
 *
 * Each expected row inherits its latest signature request's status +
 * signed-PDF + certificate links (matched by library id). Any doc that
 * was sent but no longer appears in the expected set (e.g. the segment
 * changed after sending) is appended so signing history is never lost.
 */
export function mergeTradeDocuments(
  expected: VaultDocLike[],
  sigRows: VaultDocLike[],
  partyKey: VaultPartyKey,
): VaultDocLike[] {
  // Latest signature row per library id. signatureRequestsToVaultDocs
  // already keeps newest-first / first-seen, so the first hit wins.
  const sigByDoc = new Map<number, VaultDocLike>();
  for (const s of sigRows) {
    if (s.db_id != null && !sigByDoc.has(s.db_id)) sigByDoc.set(s.db_id, s);
  }

  const filtered = expected.filter(d => tradeDocMatchesParty(d.party, partyKey));

  const merged: VaultDocLike[] = filtered.map(d => {
    const sig = d.db_id != null ? sigByDoc.get(d.db_id) : undefined;
    if (!sig) return d;   // expected but never sent → stays Pending
    return {
      ...d,
      status:               sig.status,
      attachment:           sig.attachment ?? d.attachment,
      attachment_url:       sig.attachment_url ?? d.attachment_url,
      certificate_url:      sig.certificate_url ?? null,
      reference:            d.reference ?? sig.reference,
      signature_request_id: sig.signature_request_id ?? null,
      sig_state:            sig.sig_state ?? null,
    };
  });

  // Sent docs not represented by an expected row — append so nothing
  // already in-flight / signed silently disappears.
  const shownIds = new Set(filtered.map(d => d.db_id).filter((v): v is number => v != null));
  const extras = sigRows.filter(s => s.db_id == null || !shownIds.has(s.db_id));

  return [...merged, ...extras];
}

/** Raw clm_signature_requests.status → the vault's display status. */
export function rawSigToVaultStatus(raw?: string | null): string {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'completed')  return 'Signed';
  if (s === 'inprogress') return 'Pending';
  if (s === 'declined' || s === 'rejected') return 'Declined';
  if (s === 'recalled')   return 'Recalled';
  if (s === 'expired')    return 'Expired';
  return 'Draft';
}

/**
 * Overlay the freshly-synced signature status onto a shipment-deals structure
 * (each shipment has trade_docs_buyer/consignee + agreements_buyer/consignee).
 *
 * The vault endpoint (buildDeals) reads clm_signature_requests.status straight
 * from the DB WITHOUT a Zoho sync, so a just-declined doc can still read
 * "Pending" there. `sigReqs` come from GET /clm/signature-requests?sync=1 and
 * carry the authoritative latest status — matched to each deal doc by request
 * id (signature_request_id, falling back to the legacy sig_req_id).
 */
export function overlayShipmentSigStatus<T extends Record<string, any>>(shipments: T[], sigReqs: SigReqRow[]): T[] {
  if (!Array.isArray(shipments) || shipments.length === 0) return shipments;
  const byId = new Map<number, SigReqRow>();
  for (const r of sigReqs) if (r && r.id != null) byId.set(Number(r.id), r);
  if (byId.size === 0) return shipments;

  const overlayDoc = (d: any): any => {
    if (!d) return d;
    const sid = (d.signature_request_id != null && Number(d.signature_request_id) > 0)
      ? Number(d.signature_request_id)
      : (typeof d.sig_req_id === 'number' && d.sig_req_id > 0 ? d.sig_req_id : null);
    if (sid == null) return d;
    const sr = byId.get(sid);
    if (!sr) return d;
    const raw = String(sr.status ?? '').toLowerCase();
    return { ...d, status: rawSigToVaultStatus(raw), sig_state: raw, signature_request_id: Number(sr.id) };
  };
  const overlayArr = (a: any): any => (Array.isArray(a) ? a.map(overlayDoc) : a);

  return shipments.map((s) => ({
    ...s,
    trade_docs_buyer:     overlayArr(s.trade_docs_buyer),
    trade_docs_consignee: overlayArr(s.trade_docs_consignee),
    agreements_buyer:     overlayArr(s.agreements_buyer),
    agreements_consignee: overlayArr(s.agreements_consignee),
  }));
}
