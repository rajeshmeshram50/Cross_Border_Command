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
  name: string;
  reference?: string | null;
  authority?: string | null;
  issue_date?: string | null;
  expiry?: string | null;
  attachment?: string | null;
  attachment_url?: string | null;
  status: 'Verified' | 'Pending' | 'Expiring' | 'Signed';
  doc_code?: string | null;
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

    const isSigned = String(req.status ?? '').toLowerCase() === 'completed';
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
