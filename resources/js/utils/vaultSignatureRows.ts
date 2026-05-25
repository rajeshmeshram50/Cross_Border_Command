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
  signed_document_paths?: Array<{ url?: string; path?: string }> | null;
  certificate_path?: string | null;
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
     * exactly (see Stage3Tab2DocumentationArchive's faCertificate
     * button). Hidden by the renderer when the request isn't
     * completed.
     *
     * URL resolution — certificate_path is a disk-relative path
     * ("uploads/signed_documents/customer/cert_…pdf"). resolveFileUrl
     * prefixes the VITE_API_URL (so it works whether the SPA runs from
     * the Vite dev server, the Laravel app, or a deployed CDN host)
     * and routes legacy "storage/" / "uploads/" prefixes consistently.
     * Plain string concatenation produced relative `/storage/…` URLs
     * that 404'd whenever the SPA origin differed from the API. */
    const certUrl = isSigned && req.certificate_path
      ? resolveFileUrl(req.certificate_path)
      : null;

    for (let i = 0; i < ids.length; i++) {
      const docId = Number(ids[i]);
      if (!Number.isFinite(docId) || docId <= 0) continue;
      const seenKey = `${docId}`;
      if (seenDocs.has(seenKey)) continue;        // keep the latest send only
      seenDocs.add(seenKey);

      const signedEntry = paths[i] ?? null;
      // Resolve through resolveFileUrl so the URL works whether the
      // backend returned an absolute URL (CDN / Azure), a /storage/…
      // relative path, or just the disk-relative `path` value. Prevents
      // 404s when the SPA origin and API origin differ (Vite dev
      // server, separate deploy host, etc.).
      const rawUrl = signedEntry?.url || signedEntry?.path || null;
      const url    = rawUrl ? resolveFileUrl(rawUrl) : null;
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
