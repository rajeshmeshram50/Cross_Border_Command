import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import api from '../../api';
import { SigningTrackerModal } from './SigningTrackerModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useScrollLock } from '../../hooks/useScrollLock';
import Tooltip from '../../components/ui/Tooltip';
import { MasterSelect } from '../../components/ui/MasterSelect';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import SalesDocSendForSignatureModal from './matrix/stages/SalesDocSendForSignatureModal';
import ConvertToPiModal, { ConversionBlockedModal } from './ConvertToPiModal';
import { ShimmerTable } from '../../components/ui/Shimmer';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Quotations V/S Proforma Invoice (QPI)
 *
 * Faithful port of the prototype's `#qpiPage`. Purple-palette page with a
 * Quotation / Proforma Invoice tab switch, a 4-step "What We Are Doing Here"
 * stepper, list cards per tab (Quotation table; PI sub-tabs With/Without
 * Shipment), and two multi-step Create modals (Create Quotation, Create PI).
 *
 * Data is mock for now; the dataset mirrors the screenshots from the
 * SalesMatrix_v4_9 prototype.
 * ──────────────────────────────────────────────────────────────────────── */

type QPITab = 'quotation' | 'pi';
type PISubTab = 'with' | 'without';

export type Quotation = {
  id?: number;         // server PK (undefined for legacy seed rows / new draft)
  qtNo: string;        // QT/2026-27/3
  qtDate: string;      // dd/mm/yyyy
  oppId: string;       // 436670875 (display opp_code)
  // Numeric lead id (quotation.opp_id) — the Send-for-Signature flow POSTs
  // this as lead_id and the backend verifies record.opp_id === lead_id.
  leadId?: number | null;
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;    // $, ₹, €
  // Quotation grand total — shown as the "Quotation Value" in the
  // Convert-to-PI confirmation popup.
  grandTotal?: number | null;
  salesManager: string;
  // Drives the "Convert to PI" button state. When the quotation has
  // already been flipped to converted_to_pi (either via direct convert
  // or because a PI was POSTed referencing it as source_quotation_id),
  // the button is locked into a "Converted" disabled chip.
  status?: string;     // draft | sent | approved | converted_to_pi | cancelled
  // Email + reminder state — drives which of the two buttons (Email /
  // Reminder) is enabled in the row's actions:
  //   emailedAt == null → Email enabled, Reminder disabled
  //   emailedAt != null → Email disabled (initial mail already went),
  //                        Reminder enabled (badge shows count)
  emailedAt?: string | null;
  reminderCount?: number;
  // Server-computed: true when the current user can mutate this row.
  // Frontend uses it to grey out Edit / Delete / Email / Reminder /
  // Convert-to-PI on read-only rows so the user gets immediate visual
  // feedback before hitting a 403. Defaults to true so legacy rows (and
  // shows where the backend hasn't stamped the flag yet) remain editable.
  canModify?: boolean;
  // Owning branch (eager-loaded). Drives the "Branch" column so
  // client-level users can tell which branch each record belongs to.
  branchName?: string;
  // Creator info — drives the "Created By" pill. Pill tone is keyed
  // off user_type (super_admin / client_admin / client_user /
  // branch_user); the sub-label shows the creator's branch name.
  createdBy?: string;
  createdById?: number | null;
  creatorUserType?: string;
};

type PI = {
  id?: number;
  piNo: string;
  piDate: string;
  btId: string | null;   // BT-13 (null for Without Shipment row variants)
  btDate: string | null;
  convertFrom: string | null;
  oppId: string;
  // Numeric lead id (proforma_invoice.opp_id) — for Send-for-Signature.
  leadId?: number | null;
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;
  salesManager: string;
  // Same email/reminder state as Quotation rows above.
  emailedAt?: string | null;
  reminderCount?: number;
  // Read-only flag — see Quotation type above.
  canModify?: boolean;
  // Owning branch — see Quotation type above.
  branchName?: string;
  // Creator info — see Quotation type above.
  createdBy?: string;
  createdById?: number | null;
  creatorUserType?: string;
  // True when the source opportunity has reached Stage 6 (Victory
  // Stage) — i.e. shipment is considered complete. Drives the
  // With Shipment vs Without Shipment tab split. PIs whose
  // opportunity hasn't won yet stay in Without-Shipment until the
  // deal closes upstream.
  victoryReached?: boolean;
};

// Default page size — 10 to match the Customer page. The dynamic page-size
// effect grows this on taller screens (and never drops below this floor).
const ROWS_PER_PAGE = 10;

/**
 * Render the "Created By" cell as a colored pill with a small sub-label.
 *
 * Display rules (so the column says something meaningful from the
 * viewer's perspective, not just "who clicked Save"):
 *
 *   1. If the LOGGED-IN user is the creator → pill = "You"
 *      (showing your own name on your own dashboard is noise).
 *   2. Else → pill = creator's actual name + sub-label with their
 *      branch / role.
 *
 * Pill tone is keyed off `user_type` (super-admin / client / branch)
 * so the visual language matches the Master Details "Created By"
 * column.
 */
function renderCreatorCell(
  name: string | undefined,
  creatorId: number | null | undefined,
  userType: string | undefined,
  branchName: string | undefined,
  currentUserId: number | undefined,
) {
  if (!name && !creatorId) return <span className="qpi-em">—</span>;

  // Rule 1: self-created → "You"
  const isSelf = !!currentUserId && !!creatorId && currentUserId === creatorId;

  const t = String(userType ?? '').toLowerCase();
  // Pill tone — keyed off user_type. Self-pill borrows the client tone
  // (blue) so it reads as "yours" without colliding with other pills.
  const tone =
    isSelf
      ? { bg: '#e0e7ff', fg: '#3730a3', kind: 'self' as const }
    : t === 'super_admin'
      ? { bg: '#ede9fe', fg: '#6d28d9', kind: 'super' as const }
    : t === 'client_admin' || t === 'client_user'
      ? { bg: '#dbeafe', fg: '#1d4ed8', kind: 'client' as const }
    : t === 'branch_user' || t === 'employee'
      ? { bg: '#ccfbf1', fg: '#0d9488', kind: 'branch' as const }
      : { bg: '#f1f5f9', fg: '#475569', kind: 'other' as const };

  // Primary pill text per rule above. Self-created rows show the creator's
  // actual NAME (not "You"); the self tone/colour still marks it as yours.
  const primary = isSelf ? (name || 'You') : (name || '—');

  // Sub-label — context line under the pill. Skipped for "You" so the cell
  // stays compact. For other creators we still show the role / branch context.
  const subLabel = (() => {
    if (isSelf) return '';
    if (tone.kind === 'super')  return 'Super Admin';
    if (tone.kind === 'client') return t === 'client_admin' ? 'Client Admin' : 'Client user';
    if (tone.kind === 'branch') return branchName || 'Branch';
    return '';
  })();

  return (
    <div className="qpi-creator-cell">
      <span className={`qpi-creator-pill qpi-creator-${tone.kind}`}
            style={{ background: tone.bg, color: tone.fg }}>
        {primary}
      </span>
      {subLabel && <span className="qpi-creator-sub">{subLabel}</span>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * PDF preview / download — Quotation or PI document, signature variants.
 *
 * Used by the More Options dropdown on both tables. Two backends, both
 * per-row real-data endpoints now:
 *   - kind="quotation" → POST /sales/quotations/{id}/preview-pdf
 *   - kind="pi"        → POST /sales/proforma-invoices/{id}/preview-pdf
 *
 * Both render the SAME Blade template — `pdf_title` + `doc_label_short`
 * switch on the backend so the labels read "QT No"/"PI No" appropriately
 * but the rest of the letterhead, products, bank, totals, etc. are
 * identical in shape.
 *
 * The `withSignature` flag picks the stamped vs blank variant.
 * The `mode` decides what to do with the resulting PDF:
 *   - 'view'     → open in a new tab (the caller pre-opens the window
 *                  SYNCHRONOUSLY from the click handler to bypass the
 *                  browser's popup blocker — see the kebab onClick)
 *   - 'download' → trigger a file save via a hidden <a download> click
 *                  (no popup, no tab — works even with blockers)
 * ════════════════════════════════════════════════════════════════════════ */
async function openSalesPdf(
  kind: 'quotation' | 'pi',
  payload: Record<string, unknown>,
  withSignature: boolean,
  mode: 'view' | 'download',
  preOpenedWindow: Window | null,
): Promise<void> {
  const url = kind === 'quotation'
    ? `/sales/quotations/${payload.id}/preview-pdf`
    : `/sales/proforma-invoices/${payload.id}/preview-pdf`;
  // Both endpoints read the row from the DB by id — only the signature
  // flag is needed in the body for either.
  const body = { signature: withSignature };
  const res = await api.post(url, body, { responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);

  if (mode === 'view') {
    // Use the window the caller opened synchronously so popup blockers
    // accept it. If pre-open failed (rare — usually only happens when
    // window.open is invoked outside a user gesture), fall back to a
    // fresh window.open here, which may or may not be blocked.
    const win = preOpenedWindow ?? window.open(objectUrl, '_blank', 'noopener,noreferrer');
    if (win && preOpenedWindow) win.location.href = objectUrl;
    // Revoke after 60s — keeps the tab loadable but eventually GCs the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  // mode === 'download'
  const code = (payload.piNo as string | undefined) ?? ((payload.id as number | undefined)?.toString() ?? 'document');
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, '_');
  const label = kind === 'quotation' ? 'Quotation' : 'PI';
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${label}-${safeCode}-${withSignature ? 'signed' : 'unsigned'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
}

function piPayloadFromQuotation(q: Quotation) {
  // `id` is read by openSalesPdf('quotation', …) to build the per-row
  // URL `/sales/quotations/{id}/preview-pdf`. The rest is unused for
  // the real-data endpoint (server reads from the DB), kept here for
  // backwards-compat in case anything still inspects the payload.
  return {
    id: q.id,
    piNo: q.qtNo, piDate: q.qtDate,
    oppId: q.oppId, oppDate: q.oppDate,
    customer: q.customer, consignee: q.consignee,
    docType: q.docType, currency: q.currency,
    salesManager: q.salesManager,
  };
}

/* Currency values are stored as full labels like "SGD - Singapore Dollar".
 * In the table we only want the code ("SGD") so the column stays narrow and
 * the table doesn't need horizontal scroll. Splits on the first dash/en-dash;
 * plain codes ("USD") and symbols ("$") pass through unchanged. */
function currencyCode(v: string | null | undefined): string {
  if (!v) return '';
  return String(v).split(/\s*[-–—]\s*/)[0].trim();
}

function piPayloadFromPI(p: PI) {
  // `id` is the only field openSalesPdf actually uses now — both backends
  // read the row from the DB by id. The rest is kept for backwards-compat
  // in case anything inspects the payload elsewhere.
  return {
    id: p.id,
    piNo: p.piNo, piDate: p.piDate,
    btId: p.btId ?? '0', btDate: p.btDate ?? 'NA',
    oppId: p.oppId, oppDate: p.oppDate,
    customer: p.customer, consignee: p.consignee,
    docType: p.docType, currency: p.currency,
    salesManager: p.salesManager,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * MoreOptionsMenu — dropdown anchored next to the kebab button.
 *
 * Rendered via portal at document.body so it escapes the table-wrap's
 * overflow:auto clip. Position is computed from a CAPTURED rect snapshot
 * (not a live DOM element) — that way TanStack's row re-renders can't
 * replace the kebab button DOM out from under us and leave us pointing
 * at a detached element. Closes on outside-click, Escape, scroll, and
 * resize.
 *
 * The "click the kebab again to toggle" behaviour is preserved by having
 * the kebab's own onClick call stopPropagation() — that prevents the
 * outside-click handler here from firing for kebab clicks. */
type AnchorRect = { top: number; bottom: number; left: number; right: number };
function MoreOptionsMenu(props: {
  rect: AnchorRect;
  /* Discriminator: quotation rows hit /sales/quotations/{id}/preview-pdf
   * with branch-letterheaded REAL data; PI rows still use the legacy
   * mock /sales/pi/preview-pdf until the PI controller is wired the same
   * way. Labels in the menu also switch on this. */
  kind: 'quotation' | 'pi';
  payload: Record<string, unknown>;
  /* Zoho Sign completion-certificate request id — present only once the
   * document is signed. When set, a "Download Signed Certificate" item is
   * added to the menu. */
  sigId: number | null;
  docCode: string;
  /* Customer-signed (Zoho-executed) document handlers — only used when the
   * row is signed (sigId set). View opens it in a tab; download saves it. */
  onViewSigned?: () => void | Promise<void>;
  onDownloadSigned?: () => void | Promise<void>;
  onClose: () => void;
  onError: (msg: string) => void;
  /* Reports when any PDF/cert action is in flight so the parent can show a
   * row-level loader on this row. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { rect, kind, payload, sigId, docCode, onViewSigned, onDownloadSigned, onClose, onError, onBusyChange } = props;
  const docLabel = kind === 'quotation' ? 'Quotation' : 'PI';
  const menuRef = useRef<HTMLDivElement>(null);
  /* Busy key encodes mode + signature so only the clicked item shows a
   * spinner while the request is in flight. Keys mirror the menu buttons:
   * view-sig / view-nosig / dl-sig / dl-nosig / cert. */
  type BusyKey = 'view-sig' | 'view-nosig' | 'dl-sig' | 'dl-nosig' | 'cert';
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  /* Bubble busy → parent (for the row loader); clear on unmount so a row never
   * gets stuck shimmering if the menu closes mid-flight. */
  useEffect(() => { onBusyChange?.(busy !== null); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  // Measure menu against captured rect before paint — no flash.
  useLayoutEffect(() => {
    const place = () => {
      const menuW = menuRef.current?.offsetWidth ?? 200;
      const menuH = menuRef.current?.offsetHeight ?? 90;
      let top  = rect.bottom + 6;
      let left = rect.right - menuW;
      if (top + menuH > window.innerHeight - 8) top = rect.top - 6 - menuH;
      if (left < 8) left = 8;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [rect]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      // Kebab buttons stop propagation themselves; anything that reaches
      // here is a genuine outside-click.
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  /* CRITICAL: the new tab MUST be opened synchronously in the click
   * handler (this function is fine — it's called directly from onClick)
   * — browsers reject window.open invoked after an async await because
   * the user-gesture token has expired by then. We pre-open the tab
   * with about:blank, kick off the fetch, then redirect the tab to the
   * blob URL when the PDF is ready. Download mode skips the pre-open
   * since it triggers a hidden anchor click instead. */
  const pick = (mode: 'view' | 'download', withSignature: boolean) => {
    const key: BusyKey =
      mode === 'view' ? (withSignature ? 'view-sig' : 'view-nosig')
                      : (withSignature ? 'dl-sig'   : 'dl-nosig');
    // NOTE: no 'noopener' here — window.open() returns null when noopener is
    // set, which would lose the pre-opened tab reference and make us fall back
    // to a second window.open() in openSalesPdf (the "two tabs" bug). We keep
    // the reference and immediately redirect this tab to the blob URL.
    const win = mode === 'view' ? window.open('', '_blank') : null;
    setBusy(key);
    openSalesPdf(kind, payload, withSignature, mode, win)
      .then(() => onClose())
      .catch((err: any) => {
        if (win) win.close();
        onError(err?.response?.data?.message || 'Could not generate PDF');
      })
      .finally(() => setBusy(null));
  };

  /* Download the Zoho Sign completion certificate (audit-trail PDF) for a
   * signed document. Saved via a hidden <a download> click, mirroring the
   * Download items above. */
  const downloadCertificate = () => {
    if (sigId == null) return;
    setBusy('cert');
    api.get(`/clm/signature-requests/${sigId}/certificate`, { responseType: 'blob' })
      .then((res) => {
        const blobUrl = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${(docCode || `${kind}-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_certificate.pdf`;
        a.click();
        URL.revokeObjectURL(blobUrl);
        onClose();
      })
      .catch((err: any) => onError(err?.response?.data?.message || 'Could not download the signing certificate'))
      .finally(() => setBusy(null));
  };

  return createPortal(
    <div
      ref={menuRef}
      className="qpi-moremenu"
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {sigId != null ? (
        /* ── SIGNED row: the "with Signature" rows become the actual
              customer-signed (Zoho-executed) document, plus the blank
              variant + the completion certificate. ── */
        <>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (!onViewSigned) return;
              setBusy('view-sig');
              Promise.resolve(onViewSigned()).finally(() => { setBusy(null); onClose(); });
            }}
          >
            <IconEyeSm />
            <span>View Signed {docLabel}</span>
            {busy === 'view-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('view', false)}
          >
            <IconEyeSm />
            <span>View {docLabel} without Signature</span>
            {busy === 'view-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (!onDownloadSigned) return;
              setBusy('dl-sig');
              Promise.resolve(onDownloadSigned()).finally(() => { setBusy(null); onClose(); });
            }}
          >
            <IconDownloadSm />
            <span>Download Signed {docLabel}</span>
            {busy === 'dl-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('download', false)}
          >
            <IconDownloadSm />
            <span>Download {docLabel} without Signature</span>
            {busy === 'dl-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={downloadCertificate}
          >
            <IconCertificateSm />
            <span>Download Signed Certificate</span>
            {busy === 'cert' && <span className="qpi-moremenu-spinner" />}
          </button>
        </>
      ) : (
        /* ── NOT signed: the generated PDF with / without the signature
              block (same four options as before). ── */
        <>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            /* Quotations aren't e-signed through Zoho here, so "with Signature"
               renders the stamped PDF variant directly (the old stamp output).
               PIs still gate this behind the Zoho signing flow. */
            onClick={() => {
              if (kind === 'quotation') { pick('view', true); return; }
              onError(`Not signed yet — sign this ${docLabel} via Zoho to view the signed PDF.`); onClose();
            }}
          >
            <IconEyeSm />
            <span>View {docLabel} with Signature</span>
            {busy === 'view-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('view', false)}
          >
            <IconEyeSm />
            <span>View {docLabel} without Signature</span>
            {busy === 'view-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            /* Quotations: stamped PDF variant directly; PIs: Zoho-gated. */
            onClick={() => {
              if (kind === 'quotation') { pick('download', true); return; }
              onError(`Not signed yet — sign this ${docLabel} via Zoho to download the signed PDF.`); onClose();
            }}
          >
            <IconDownloadSm />
            <span>Download {docLabel} with Signature</span>
            {busy === 'dl-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('download', false)}
          >
            <IconDownloadSm />
            <span>Download {docLabel} without Signature</span>
            {busy === 'dl-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

const IconEyeSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconCertificateSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);
const IconDownloadSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const STEPS = [
  { n:1, title:'Create Quotation',          desc:'Prepare quotation using opportunity, buyer, product, pricing, currency, and bank details.', tag:'FOUNDATION STEP' },
  { n:2, title:'Share & Track Response',    desc:'Send quotation to buyer and track response status.',                                          tag:'SALES TRACKING' },
  { n:3, title:'Convert to Proforma Invoice', desc:'Convert accepted quotation into PI with shipment, payment, and document details.',        tag:'CONVERSION STEP' },
  { n:4, title:'Sales Readiness',           desc:'Prepare quotation and PI records for CLM, order confirmation, and export execution.',        tag:'FINAL EXECUTION' },
];

export default function SalesQPI() {
  const toast = useToast();
  // Current user — needed by the "Created By" column to swap the creator's
  // name for "You" on self-created rows.
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<QPITab>('quotation');
  const [piSub, setPiSub] = useState<PISubTab>('with');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [q, setQ] = useState('');
  // Pagination is owned here now (the project "apna wala" footer — Showing
  // X–Y of Z + numbered chips) instead of TableContainer's built-in bar.
  // We slice the data ourselves and feed a single page to TableContainer.
  const [page, setPage] = useState(1);

  const [createQtOpen, setCreateQtOpen] = useState(false);
  const [createPiOpen, setCreatePiOpen] = useState(false);
  const [piSourceQuotation, setPiSourceQuotation] = useState<Quotation | null>(null);
  // Edit mode — the modal opens pre-filled from GET /sales/{kind}/{id}
  // and the submit handler PUTs instead of POSTing. null = create mode.
  const [editingQuotationId, setEditingQuotationId] = useState<number | null>(null);
  const [editingPiId, setEditingPiId] = useState<number | null>(null);

  // Real quotation list from /sales/quotations. Each row maps the API's
  // snake_case header columns to the display shape the existing table
  // JSX expects (qtNo, qtDate, oppId, …) so we don't have to refactor
  // the renderer.
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loadingQt, setLoadingQt] = useState(true);
  const reloadQuotations = () => {
    setLoadingQt(true);
    api.get('/sales/quotations', { params: { per_page: 200 } })
      .then(({ data }) => {
        const rows: Quotation[] = (data?.data ?? []).map((r: any) => ({
          id:           r.id,
          qtNo:         r.code,
          qtDate:       r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : '',
          oppId:        r.opp_code ?? '',
          leadId:       r.opp_id != null ? Number(r.opp_id) : null,
          oppDate:      r.opportunity_date
                        ? new Date(r.opportunity_date).toLocaleDateString('en-GB')
                        : '',
          customer:     r.customer_name ?? r.customer?.company_name ?? '',
          consignee:    r.consignee_name ?? r.consignee?.company_name ?? '',
          docType:      (r.doc_type ?? 'International') as 'International' | 'Domestic',
          currency:     r.currency ?? '',
          grandTotal:   r.grand_total != null ? Number(r.grand_total) : null,
          salesManager: r.sales_manager_name ?? r.salesManager?.name ?? '—',
          status:       r.status ?? 'draft',
          emailedAt:    r.emailed_at ?? null,
          reminderCount: Number(r.reminder_count ?? 0),
          // Default to TRUE so rows from older API versions stay editable.
          canModify:    r.can_modify !== false,
          branchName:   r.branch?.name ?? '',
          createdBy:    r.creator_name ?? r.creator?.name ?? '',
          createdById:  r.created_by ?? r.creator?.id ?? null,
          creatorUserType:     r.creator_user_type ?? r.creator?.user_type ?? '',
        }));
        setQuotations(rows);
      })
      .catch(() => toast.error('Load failed', 'Could not fetch quotations'))
      .finally(() => setLoadingQt(false));
  };
  useEffect(() => { reloadQuotations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Real PI list from /sales/proforma-invoices. Single fetch — the two
  // pill sub-tabs (With Shipment / Without Shipment) are derived from
  // `pi_type` on each row, so we don't need separate API calls.
  const [pis, setPis] = useState<PI[]>([]);
  const [loadingPi, setLoadingPi] = useState(true);
  const reloadPis = () => {
    setLoadingPi(true);
    api.get('/sales/proforma-invoices', { params: { per_page: 200 } })
      .then(({ data }) => {
        const rows: PI[] = (data?.data ?? []).map((r: any) => ({
          id:          r.id,
          piNo:        r.code,
          piDate:      r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : '',
          // "Shipp ID" column — prefer the new sequential shipment code
          // (SHP-NNN) created against the opportunity; fall back to the
          // legacy bt_id for older records not yet shipped.
          btId:        r.shipment_code ?? r.bt_id ?? null,
          btDate:      r.bt_date ? new Date(r.bt_date).toLocaleDateString('en-GB') : null,
          convertFrom: r.convert_from_code ?? r.sourceQuotation?.code ?? null,
          oppId:       r.opp_code ?? '',
          leadId:      r.opp_id != null ? Number(r.opp_id) : null,
          oppDate:     r.opportunity_date
                       ? new Date(r.opportunity_date).toLocaleDateString('en-GB')
                       : '',
          customer:    r.customer_name ?? r.customer?.company_name ?? '',
          consignee:   r.consignee_name ?? r.consignee?.company_name ?? '',
          docType:     (r.doc_type ?? 'International') as 'International' | 'Domestic',
          currency:    r.currency ?? '',
          salesManager: r.sales_manager_name ?? r.salesManager?.name ?? '—',
          emailedAt:   r.emailed_at ?? null,
          reminderCount: Number(r.reminder_count ?? 0),
          canModify:   r.can_modify !== false,
          branchName:  r.branch?.name ?? '',
          createdBy:   r.creator_name ?? r.creator?.name ?? '',
          createdById: r.created_by ?? r.creator?.id ?? null,
          creatorUserType:     r.creator_user_type ?? r.creator?.user_type ?? '',
          // Server-computed: opportunity reached Stage 6 (Victory).
          // Fallback to checking the eager-loaded lead.lead_stage_id /
          // lead.won_at directly so an older API response that doesn't
          // ship the flag yet still bucketizes correctly.
          victoryReached: Boolean(
            r.victory_reached
            ?? ((Number(r.lead?.lead_stage_id ?? 0) >= 6) || !!r.lead?.won_at)
          ),
          // Stash pi_type on the row so the sub-tab filter can split it.
          // Cast to any so we don't have to widen the public PI type.
          ...(r.pi_type ? { _piType: r.pi_type } : {}),
        }));
        setPis(rows);
      })
      .catch(() => toast.error('Load failed', 'Could not fetch PIs'))
      .finally(() => setLoadingPi(false));
  };
  useEffect(() => { reloadPis(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Split the single PI list into With/Without buckets by the
  // opportunity's stage progress. A PI lands in "With Shipment" only
  // when its source opportunity has reached Stage 6 (Victory Stage) —
  // i.e. all six stages of the Sales Matrix are complete. Anything
  // still working through Stage 1–5 stays in "Without Shipment" until
  // the deal closes upstream.
  const piWithShipment = useMemo(
    () => pis.filter(r => r.victoryReached === true),
    [pis],
  );
  const piWithoutShipment = useMemo(
    () => pis.filter(r => r.victoryReached !== true),
    [pis],
  );

  useEffect(() => {
    const id = 'sm-qpi-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  /* ─── Filter + paginate ─── */
  const filtered = useMemo(() => {
    const lo = q.trim().toLowerCase();
    if (tab === 'quotation') {
      const src = quotations;
      if (!lo) return src;
      return src.filter(r => (
        r.qtNo.toLowerCase().includes(lo) ||
        r.oppId.toLowerCase().includes(lo) ||
        r.customer.toLowerCase().includes(lo) ||
        r.consignee.toLowerCase().includes(lo) ||
        r.salesManager.toLowerCase().includes(lo)
      ));
    }
    const src = piSub === 'with' ? piWithShipment : piWithoutShipment;
    if (!lo) return src;
    return src.filter(r => (
      r.piNo.toLowerCase().includes(lo) ||
      r.oppId.toLowerCase().includes(lo) ||
      r.customer.toLowerCase().includes(lo) ||
      r.consignee.toLowerCase().includes(lo) ||
      (r.convertFrom ?? '').toLowerCase().includes(lo) ||
      (r.btId ?? '').toLowerCase().includes(lo)
    ));
  }, [tab, piSub, q, quotations, pis, piWithShipment, piWithoutShipment]);

  /* ─── Dynamic page size ───
   * Rows-per-page auto-fits the space between the table header and the
   * footer so the table fills the viewport (same behaviour as the Customer
   * page). `rpp` starts at ROWS_PER_PAGE and grows on taller screens; the
   * remaining rows spill onto the next page (no internal scroll). */
  const tableHostRef = useRef<HTMLDivElement>(null);
  const [rpp, setRpp] = useState(ROWS_PER_PAGE);
  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;
    const fit = () => {
      const top    = host.getBoundingClientRect().top;
      const theadH = (host.querySelector('thead') as HTMLElement | null)?.offsetHeight || 44;
      const rowH   = (host.querySelector('tbody tr') as HTMLElement | null)?.offsetHeight || 48;
      const FOOTER  = 56;   // .qpi-pag height
      const HOSTPAD = 26;   // .qpi-table-host vertical padding (14 top + 12 bottom)
      const avail   = window.innerHeight - top - theadH - FOOTER - HOSTPAD - 16;
      const rowsFit = Math.max(ROWS_PER_PAGE, Math.floor(avail / rowH));
      setRpp(prev => (prev === rowsFit ? prev : rowsFit));
    };
    fit();
    // Re-fit after the layout settles (banner animation / async rows).
    const t = window.setTimeout(fit, 130);
    window.addEventListener('resize', fit);
    // The "What We Are Doing Here" banner expands/collapses with a transition;
    // observe it so the table grows into the freed space as it settles.
    let ro: ResizeObserver | undefined;
    const banner = document.querySelector('.qpi-wdh');
    if (banner && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(banner);
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', fit);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdhOpen, loadingQt, loadingPi, tab, piSub]);

  /* ─── Pagination (our own footer) ───
   * Slice `filtered` into pages of `rpp`. `pageRows` is what we hand to
   * TableContainer so its internal bar collapses to a single page; the
   * visible Showing X–Y of Z + numbered chips footer is rendered below. */
  const totalRows = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / rpp));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * rpp;
  const pageRows  = filtered.slice(pageStart, pageStart + rpp);
  // Snap back to page 1 whenever the active dataset changes (tab, sub-tab or
  // search), so we never sit on an out-of-range empty page.
  useEffect(() => { setPage(1); }, [tab, piSub, q]);

  /* ─── Helpers ─── */
  // Clear the search box on tab switch so the new tab starts unfiltered.
  const switchTab = (next: QPITab) => { setTab(next); setQ(''); };
  const switchPiSub = (next: PISubTab) => { setPiSub(next); setQ(''); };

  const [convertingId, setConvertingId] = useState<number | null>(null);
  // Convert-to-PI confirmation popup: the quotation pending conversion and
  // the previewed next PI code shown inside the dialog.
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null);
  const [convertPreviewCode, setConvertPreviewCode] = useState<string | null>(null);
  // Conversion-blocked popup: shown when the lead already has a PI. Holds
  // the quotation they tried to convert + the existing PI that blocks it.
  const [convertBlocked, setConvertBlocked] = useState<{ fromQt: string; pi: PI } | null>(null);

  /* ── Send-for-Signature (Zoho Sign) — same flow as Sales Matrix Stage 5.
   * `sigSendFor` opens the modal for one row; `sigByRow` holds the live
   * status per row keyed `${kind}:${docId}` (quotation/pi), driving the
   * action button (Send -> Sent +Remind/View -> Signed +View). `sigTick`
   * is bumped after a send so the poller refreshes immediately. */
  const [sigSendFor, setSigSendFor] = useState<
    { kind: 'quotation' | 'pi'; id: number; code: string; customerName: string | null; leadId: number | null } | null
  >(null);
  const [sigByRow, setSigByRow] = useState<Record<string, { id: number; status: string }>>({});
  const [sigTick, setSigTick] = useState(0);
  /* False until the first signature-status poll resolves — while loading, the
   * Send-for-Signature pill shows a loader and is disabled so a row can't be
   * sent again before we know it was already sent/signed. */
  const [sigLoaded, setSigLoaded] = useState(false);

  /* Poll signature status for ALL quotations + PIs of this client (no
   * lead filter — this page spans many leads). `sync=1` round-trips Zoho
   * so an in-progress request flips to Signed without a manual refresh. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [qr, pr] = await Promise.allSettled([
          api.get('/clm/signature-requests', { params: { document_type: 'quotation', sync: 1 } }),
          api.get('/clm/signature-requests', { params: { document_type: 'proforma_invoice', sync: 1 } }),
        ]);
        if (!alive) return;
        const map: Record<string, { id: number; status: string }> = {};
        const ingest = (rows: any, kind: 'quotation' | 'pi') => (Array.isArray(rows) ? rows : []).forEach((row: any) => {
          const did = row.trade_doc_id ?? (Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids[0] : null);
          if (did == null) return;
          const key = `${kind}:${did}`;
          if (!map[key] || row.id > map[key].id) map[key] = { id: row.id, status: String(row.status ?? '').toLowerCase() };
        });
        if (qr.status === 'fulfilled') ingest((qr.value as any).data?.data, 'quotation');
        if (pr.status === 'fulfilled') ingest((pr.value as any).data?.data, 'pi');
        setSigByRow(map);
      } catch { /* signature status is best-effort — never blocks the table */ }
      finally { if (alive) setSigLoaded(true); }
    };
    void load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [sigTick]);

  const onRemindSig = async (sigId: number) => {
    try {
      await api.post(`/clm/signature-requests/${sigId}/remind`);
      toast.success('Reminder sent', 'The signer has been reminded.');
    } catch (e: any) {
      toast.error('Reminder failed', e?.response?.data?.message ?? 'Could not send the reminder.');
    }
  };
  const onViewSignedSig = async (sigId: number) => {
    try {
      const r = await api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data as Blob), '_blank');
    } catch (e: any) {
      toast.error('Open failed', e?.response?.data?.message ?? 'Could not open the signed document.');
    }
  };
  /* Download (not just view) the signed PDF — fired by the labelled
   * "Signed PDF" button on a completed row. */
  const onDownloadSignedSig = async (sigId: number, code: string) => {
    try {
      const r = await api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([r.data as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${(code || `signed-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_signed.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      toast.error('Download failed', e?.response?.data?.message ?? 'Could not download the signed document.');
    }
  };
  const onViewSentPdf = async (kind: 'quotation' | 'pi', id: number) => {
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature: true }, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data as Blob), '_blank');
    } catch {
      toast.error('Preview failed', 'Could not open the document.');
    }
  };

  /* Email PDF state — PER-ROW in-flight tracking. Each row's send is
   * independent: only the row being sent shows the disabled spinner, and a
   * DIFFERENT quotation/PI can be emailed at the same time. The set holds the
   * `${kind}:${id}` keys currently sending (covers both initial emails and
   * reminders — mutually exclusive per row). */
  const [emailingKeys, setEmailingKeys] = useState<Set<string>>(new Set());
  // Synchronous mirror of the set — React state only updates on the next
  // render, so a fast double-click on the SAME row could fire twice before the
  // disable lands. The ref blocks a repeat of the same key in the same tick;
  // other rows' keys are unaffected, so concurrent sends are still allowed.
  const emailingRef = useRef<Set<string>>(new Set());
  const isEmailing = (kind: 'quotation' | 'pi', id: number) => emailingKeys.has(`${kind}:${id}`);

  /* Rate-limit cooldown — once the server returns 429 (max 3 sends per
   * doc per minute) we keep that row's Email button disabled-looking until
   * the cooldown elapses. Keyed by `${kind}:${id}` → epoch-ms when it frees.
   * A 1s ticker re-renders so the remaining time / disabled state updates. */
  const [emailCooldowns, setEmailCooldowns] = useState<Record<string, number>>({});
  const cdKey = (kind: 'quotation' | 'pi', id: number) => `${kind}:${id}`;
  const cooldownLeft = (kind: 'quotation' | 'pi', id: number): number => {
    const end = emailCooldowns[cdKey(kind, id)];
    return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : 0;
  };
  const startCooldown = (kind: 'quotation' | 'pi', id: number, seconds: number) => {
    setEmailCooldowns(m => ({ ...m, [cdKey(kind, id)]: Date.now() + seconds * 1000 }));
  };
  useEffect(() => {
    if (Object.keys(emailCooldowns).length === 0) return;
    const t = setInterval(() => {
      setEmailCooldowns(m => {
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(m)) if (v > now) next[k] = v;
        return Object.keys(next).length === Object.keys(m).length ? m : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [emailCooldowns]);

  const sendDocEmail = async (kind: 'quotation' | 'pi', id: number, code: string) => {
    if (!id) { toast.error('Cannot email', 'This record has no server id yet.'); return; }
    const key = `${kind}:${id}`;
    // Block only a repeat send of THIS SAME row (the button is disabled while
    // its send is in flight; the ref catches a same-tick double-click). Other
    // rows are unaffected — they can be emailed concurrently.
    if (emailingRef.current.has(key)) return;
    // Still cooling down from a previous rate-limit hit — surface the wait.
    const left = cooldownLeft(kind, id);
    if (left > 0) {
      toast.warning('Please wait', `You can email this ${kind === 'pi' ? 'PI' : 'quotation'} again in ${left}s (max 3 per minute).`);
      return;
    }
    emailingRef.current.add(key);
    setEmailingKeys(s => new Set(s).add(key));
    const url = kind === 'quotation'
      ? `/sales/quotations/${id}/email`
      : `/sales/proforma-invoices/${id}/email`;
    try {
      const { data } = await api.post(url, { signature: true });
      toast.success('Email sent', `${code} → ${data?.to ?? 'customer'}`);
      // Optimistically flip the row's emailedAt so the buttons swap
      // immediately (Email → disabled, Reminder → enabled) without
      // waiting for a full reload. Server response also carries the
      // canonical timestamp; we prefer it when present.
      const stamp = data?.emailed_at ?? new Date().toISOString();
      const patch = (r: any) => r.id === id ? { ...r, emailedAt: stamp } : r;
      if (kind === 'quotation') setQuotations(rows => rows.map(patch));
      else                       setPis(rows => rows.map(patch));
    } catch (e: any) {
      // 429 = throttle (max 3 sends per doc per minute). Surface it as a
      // "please wait" warning, not an error — the send didn't fail, it's
      // capped — and start the cooldown so the button stays disabled.
      if (e?.response?.status === 429) {
        const wait = Number(e?.response?.data?.retry_after_seconds) || 60;
        startCooldown(kind, id, wait);
        toast.warning('Please wait', e?.response?.data?.message ?? `Too many attempts — try again in ${wait}s.`);
      } else {
        const msg = e?.response?.data?.message ?? 'Could not send email. Check the customer has a primary email.';
        toast.error('Email failed', String(msg));
      }
    } finally {
      emailingRef.current.delete(key);
      setEmailingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  /* Reminder follow-up — gated by emailedAt server-side (controller
   * returns 422 if the initial email hasn't been sent yet). On success
   * we patch the row's reminderCount locally so the badge updates
   * without a full reload. */
  const sendReminder = async (kind: 'quotation' | 'pi', id: number, code: string) => {
    if (!id) { toast.error('Cannot remind', 'This record has no server id yet.'); return; }
    const key = `${kind}:${id}`;
    if (emailingRef.current.has(key)) return;
    emailingRef.current.add(key);
    setEmailingKeys(s => new Set(s).add(key));
    const url = kind === 'quotation'
      ? `/sales/quotations/${id}/remind`
      : `/sales/proforma-invoices/${id}/remind`;
    try {
      const { data } = await api.post(url, { signature: true });
      const n = Number(data?.reminder_count ?? 0);
      toast.success('Reminder sent', `${code} → ${data?.to ?? 'customer'} (#${n})`);
      const patch = (r: any) => r.id === id ? { ...r, reminderCount: n } : r;
      if (kind === 'quotation') setQuotations(rows => rows.map(patch));
      else                       setPis(rows => rows.map(patch));
    } catch (e: any) {
      if (e?.response?.status === 429) {
        toast.warning('Please wait', e?.response?.data?.message ?? 'Too many attempts — try again in a minute.');
      } else {
        const msg = e?.response?.data?.message ?? 'Could not send reminder.';
        toast.error('Reminder failed', String(msg));
      }
    } finally {
      emailingRef.current.delete(key);
      setEmailingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  /* Delete confirmation state — same DeleteConfirmModal used across the
   * project (Customers, Clients, etc.). `kind` discriminates which API
   * to call; `code` shows in the message; `id` is the row PK. */
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'quotation' | 'pi'; id: number; code: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const url = deleteTarget.kind === 'quotation'
        ? `/sales/quotations/${deleteTarget.id}`
        : `/sales/proforma-invoices/${deleteTarget.id}`;
      await api.delete(url);
      toast.success(
        deleteTarget.kind === 'quotation' ? 'Quotation cancelled' : 'PI cancelled',
        `${deleteTarget.code} has been moved to cancelled status.`,
      );
      if (deleteTarget.kind === 'quotation') reloadQuotations();
      else reloadPis();
      setDeleteTarget(null);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not cancel this record.';
      toast.error('Delete failed', String(msg));
    } finally {
      setDeleting(false);
    }
  };

  // Direct convert: POST /sales/proforma-invoices/from-quotation/{id}.
  // The backend enforces "one PI per opportunity" — we also pre-check
  // against the in-memory PI list so the user gets instant feedback
  // when the rule blocks them instead of a network round-trip.
  /* Convert-to-PI now goes through a confirmation popup (ConvertToPiModal)
   * instead of firing immediately. openConvert() runs the same guards and,
   * if they pass, opens the dialog and best-effort fetches the next PI code
   * to preview; confirmConvert() does the actual POST on "Yes, Convert". */
  const openConvert = (qt: Quotation) => {
    if (!qt.id) {
      toast.error('Cannot convert', 'This quotation has no server id yet.');
      return;
    }
    // Already-converted safety net. The button is disabled in this state,
    // so this only fires if a stale row beat the next reload — explain it
    // and bail before hitting the network.
    if (qt.status === 'converted_to_pi') {
      toast.info('Already converted', `${qt.qtNo} has already been converted to a PI.`);
      return;
    }
    // Pre-check: any non-cancelled PI for the same opportunity? If so, the
    // one-PI-per-lead rule blocks conversion — show the blocker popup that
    // points the user at editing the existing PI (not deleting it).
    if (qt.oppId) {
      const blocker = pis.find(p => p.oppId === qt.oppId);
      if (blocker) {
        // Mutually exclusive with the confirm popup — clear it so a prior
        // open ConvertToPiModal can't stack behind the blocked dialog.
        setConvertTarget(null);
        setConvertBlocked({ fromQt: qt.qtNo, pi: blocker });
        return;
      }
    }
    // Clear any lingering blocked dialog before opening the confirm popup.
    setConvertBlocked(null);
    setConvertTarget(qt);
    setConvertPreviewCode(null);
    // Best-effort preview of the next PI number (never consumes a number).
    api.get('/sales/proforma-invoices/preview-code')
      .then(({ data }) => setConvertPreviewCode(data?.data?.code ?? null))
      .catch(() => setConvertPreviewCode(null));
  };

  const confirmConvert = async () => {
    const qt = convertTarget;
    if (!qt || !qt.id) return;
    setConvertingId(qt.id);
    try {
      const { data } = await api.post(`/sales/proforma-invoices/from-quotation/${qt.id}`);
      const newPiCode = data?.data?.code ?? 'a new PI';
      toast.success('Converted to PI', `${qt.qtNo} → ${newPiCode}`);
      // Refresh both lists — quotation status flipped to converted_to_pi,
      // PI table gets the new row.
      reloadQuotations();
      reloadPis();
      setConvertTarget(null);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not convert this quotation.';
      toast.error('Convert failed', String(msg));
    } finally {
      setConvertingId(null);
    }
  };

  /* ── More-Options anchor state. Lives on the parent so the column
   *    cell-renderer can open / close it; the portal'd menu is rendered
   *    once outside the table at the bottom of this component. */
  // Capture coordinates (not DOM element) so a TanStack re-render of the
  // row doesn't leave us pointing at a detached node and dump the menu
  // at top-left.
  const [qtMenuFor, setQtMenuFor] = useState<{ id: string; rect: AnchorRect; payload: Record<string, unknown>; sigId: number | null } | null>(null);
  const [piMenuFor, setPiMenuFor] = useState<{ id: string; rect: AnchorRect; payload: Record<string, unknown>; sigId: number | null } | null>(null);
  /* Row id whose PDF (view/download/cert) is currently generating — drives the
   * row-level loading shimmer (matches Stage 4's row loader). */
  const [pdfBusyRowId, setPdfBusyRowId] = useState<number | null>(null);
  // Signing Tracker modal — opened from the "Tracker" action on sent rows.
  const [trackerFor, setTrackerFor] = useState<{ sigId: number; code: string } | null>(null);

  /* Stable ActionBtn — matches the customer-page pattern: neutral tile,
   * hover shifts border + icon to the column accent.
   * Optional `disabled` greys the tile and blocks the click handler.
   * Optional `badge` overlays a small count chip in the top-right
   * corner (used by the Reminder button to show how many reminders
   * have already gone out). */
  const ActionBtn = (p: {
    title: string;
    icon: React.ReactNode;
    color: string;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    ariaLabel?: string;
    disabled?: boolean;
    // Rate-limit cooldown: render the dimmed/disabled LOOK but keep the
    // button clickable so the click can surface the "please wait" toast.
    cooling?: boolean;
    badge?: number;
  }) => (
    <Tooltip label={p.title}>
      <button
        type="button"
        aria-label={p.ariaLabel ?? p.title}
        aria-disabled={p.disabled || undefined}
        className={`qpi-act${p.disabled || p.cooling ? ' qpi-act-disabled' : ''}`}
        style={{ ['--qpi-act-accent' as any]: p.color, position: 'relative' }}
        /* Not natively disabled — a soft-disabled button stays clickable so a
           click can surface a short "why it's unavailable" toast (the button's
           own title is the reason). */
        onClick={(e) => { if (p.disabled) { toast.info(p.title); return; } p.onClick(e); }}
      >
        {p.icon}
        {p.badge !== undefined && p.badge > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            minWidth: 16, height: 16, padding: '0 4px',
            background: p.color, color: '#fff',
            borderRadius: 8, fontSize: 9, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #fff', lineHeight: 1,
          }}>{p.badge}</span>
        )}
      </button>
    </Tooltip>
  );

  /* Send-for-Signature control for a row — status-aware, shared by both
   * the Quotation and PI action cells:
   *   not sent   -> "Send for Sign" (opens the Zoho modal)
   *   inprogress -> View sent doc + Send reminder
   *   completed  -> View signed PDF
   * Disabled when the row is read-only or has no numeric lead id. */
  /* Render the FOUR signing slots for EVERY row in a fixed order — Send,
   * View, Reminder, Tracker — so the action column has one consistent layout
   * regardless of the row's signing status. Slots that don't apply to the
   * current status are shown disabled (greyed) rather than hidden, so the
   * icons always line up across rows. */
  const renderSignAction = (
    kind: 'quotation' | 'pi', id: number | undefined, code: string,
    customer: string, leadId: number | null | undefined, readOnly: boolean,
  ) => {
    if (!id) return null;
    const sig = sigByRow[`${kind}:${id}`];
    const st = sig?.status;
    const notSent    = st !== 'inprogress' && st !== 'completed';
    const inProgress = st === 'inprogress';
    const signed     = st === 'completed';
    const hasSig     = st === 'inprogress' || st === 'completed';
    // When signed, Send/View/Reminder are all moot — point the user to the
    // history (tracker) icon, which holds the signed document + full timeline.
    const signedHint = 'Document already signed — open the history icon to view it.';
    return (
      <>
        {/* Send-for-Signature — only on PI rows; hidden for Quotation.
            Rendered as a labelled pill (same shape as the Quotation "Convert
            to PI" button) instead of a bare icon, with three states:
            Send for Sign (active) → Sent (awaiting) → Signed (done). */}
        {kind === 'pi' && (
          !sigLoaded ? (
            <Tooltip label="Checking signing status…">
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-loading" aria-label="Checking signing status">
                <span className="qpi-send-spin" /><span className="qpi-convert-btn-label">Checking…</span>
              </button>
            </Tooltip>
          ) : signed ? (
            <Tooltip label={signedHint}>
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-signed" aria-label="Signed">
                <IconCheck /><span className="qpi-convert-btn-label">Signed</span>
              </button>
            </Tooltip>
          ) : inProgress ? (
            <Tooltip label="Already sent — awaiting signature">
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-sent" aria-label="Sent">
                <IconPaperPlaneSm /><span className="qpi-convert-btn-label">Sent</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={readOnly ? 'View-only — you don\'t have permission to modify this record.' : 'Send for Signature'}>
              <button
                type="button"
                className="qpi-convert-btn qpi-send-btn"
                disabled={readOnly}
                onClick={() => setSigSendFor({ kind, id, code, customerName: customer || null, leadId: leadId ?? null })}
              >
                <IconPaperPlaneSm /><span className="qpi-convert-btn-label">Send for Sign</span>
              </button>
            </Tooltip>
          )
        )}
        <ActionBtn
          title={inProgress ? 'View sent document' : signed ? signedHint : 'No document sent yet'}
          color="#0ea5e9" disabled={!inProgress}
          onClick={() => inProgress && void onViewSentPdf(kind, id)}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>} />
        {/* Signing reminder — only on PI rows; hidden for Quotation. */}
        {kind === 'pi' && (
        <ActionBtn
          title={inProgress ? 'Send signing reminder' : signed ? signedHint : 'Reminders available once the document is sent'}
          color="#f59e0b" disabled={!inProgress}
          onClick={() => inProgress && void onRemindSig(sig!.id)}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} />
        )}
        <ActionBtn
          title={hasSig ? 'Signing tracker' : 'No signing activity yet'}
          color="#7c3aed" disabled={!hasSig}
          onClick={() => hasSig && setTrackerFor({ sigId: sig!.id, code })}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>} />
      </>
    );
  };

  /* ── Quotation table columns ──────────────────────────────────── */
  const quotationColumns = useMemo<any[]>(() => [
    {
      header: 'Sr No', id: '__sr', meta: { align: 'center' },
      cell: (info: any) => <span className="qpi-srno">{info.row.index + 1}</span>,
    },
    {
      header: 'Quotation No', accessorKey: 'qtNo',
      cell: (info: any) => <span className="qpi-link">{info.getValue()}</span>,
    },
    {
      header: 'Quotation Date', accessorKey: 'qtDate',
      cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Opp ID', accessorKey: 'oppId',
      cell: (info: any) => info.getValue() ? <span className="qpi-link">{info.getValue()}</span> : <span className="qpi-em">—</span>,
    },
    {
      header: 'Opp Date', accessorKey: 'oppDate',
      cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Customer', accessorKey: 'customer',
      cell: (info: any) => <span className="qpi-strong">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Consignee', accessorKey: 'consignee',
      cell: (info: any) => info.getValue()
        ? <span className="qpi-cap">{info.getValue()}</span>
        : <span className="qpi-em">—</span>,
    },
    {
      header: 'Document Type', accessorKey: 'docType',
    },
    {
      header: 'Currency', accessorKey: 'currency',
      cell: (info: any) => info.getValue() ? <span className="qpi-currency">{currencyCode(info.getValue())}</span> : <span className="qpi-em">—</span>,
    },
    {
      header: 'Sales Manager', accessorKey: 'salesManager',
      cell: (info: any) => <span className="qpi-sm">{info.getValue() || '—'}</span>,
    },
    {
      // Created By — name of the user who originally created the row,
      // styled as a colored pill (tone keyed off user_type) with the
      // creator's branch/client tier as a sub-label. Mirrors the
      // Master Details "Created By" column.
      header: 'Created By', accessorKey: 'createdBy',
      cell: (info: any) => {
        const r = info.row.original as Quotation;
        return renderCreatorCell(
          r.createdBy, r.createdById, r.creatorUserType, r.branchName,
          currentUser?.id,
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions', meta: { align: 'center' },
      cell: (info: any) => {
        const r = info.row.original as Quotation;
        // A row the user lacks permission to mutate can still be SEEN (and
        // opened in the More-Options preview) but Convert / Email / Remind /
        // Edit / Delete are dimmed with an explanatory tooltip so the user
        // understands why the action is unavailable instead of just clicking
        // and hitting a 403.
        const readOnly = r.canModify === false;
        const readOnlyHint = 'View-only — you don\'t have permission to modify this record.';
        return (
          <div className="d-inline-flex align-items-center gap-2 justify-content-center">
            {r.status === 'converted_to_pi' ? (
              <Tooltip label="This quotation has already been converted to a PI">
                <button type="button" disabled className="qpi-convert-btn qpi-convert-btn-done" aria-label="Already converted to PI">
                  <IconCheck /><span className="qpi-convert-btn-label">Converted</span>
                </button>
              </Tooltip>
            ) : (
              <Tooltip label={readOnly ? readOnlyHint : (convertingId === r.id ? 'Converting…' : 'Convert this quotation into a PI')}>
                <button
                  type="button"
                  className="qpi-convert-btn"
                  disabled={readOnly || convertingId === r.id}
                  onClick={() => openConvert(r)}
                >
                  <IconRepeatSm />
                  <span className="qpi-convert-btn-label">
                    {convertingId === r.id ? 'Converting…' : 'Convert to PI'}
                  </span>
                </button>
              </Tooltip>
            )}
            {/* Signing icons (view-sent + tracker) intentionally NOT rendered
                for Quotations — quotations are not sent through Zoho Sign here,
                so the view-sent and signing-tracker actions are hidden. They
                remain on the PI tab via renderSignAction('pi', …). */}
            {/* Email button — matches the in-matrix Stage 5 table: stays
                available after every send (no one-time disable) so the
                quotation can be re-emailed; each send fires a toast.
                Read-only rows (no mutate permission) show a hint and stay
                disabled. */}
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('quotation', r.id)
                    ? 'Sending…'
                    : r.id && cooldownLeft('quotation', r.id) > 0
                      ? `Please wait ${cooldownLeft('quotation', r.id)}s (max 3 per minute)`
                      : 'Email Quotation'
              }
              icon={<IconMail />}
              color="#2563eb"
              disabled={readOnly || (isEmailing('quotation', r.id))}
              cooling={!!r.id && cooldownLeft('quotation', r.id) > 0}
              onClick={() => r.id && sendDocEmail('quotation', r.id, r.qtNo)}
            />
            {/* Reminder button — REMOVED for the email flow. The only
                reminder on this page is the Zoho Sign signing reminder,
                rendered inside renderSignAction() above. Code kept under
                {false && ...} so the email-follow-up reminder can be
                restored later without re-deriving the state wiring. */}
            {false && (
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('quotation', r.id)
                    ? 'Sending…'
                    : r.emailedAt
                      ? `Send Reminder${r.reminderCount ? ` (#${(r.reminderCount ?? 0) + 1})` : ''}`
                      : 'Send initial email first to enable reminders'
              }
              icon={<IconBellSm />}
              color="#f59e0b"
              disabled={readOnly || !r.emailedAt || (isEmailing('quotation', r.id))}
              badge={r.reminderCount ?? 0}
              onClick={() => r.id && sendReminder('quotation', r.id, r.qtNo)}
            />
            )}
            {(() => {
              // Once a quotation is e-signed (signature status 'completed') it
              // is a finalised document — editing must be locked.
              const qSigned = r.id ? sigByRow[`quotation:${r.id}`]?.status === 'completed' : false;
              // A quotation converted to a PI is locked — the PI is the live doc.
              const qConverted = r.status === 'converted_to_pi';
              return (
            <ActionBtn
              title={readOnly ? readOnlyHint : qConverted ? 'Converted to PI — editing locked' : qSigned ? 'Quotation signed — editing locked' : 'Edit Quotation'}
              icon={<IconEdit />}
              color="#16a34a"
              disabled={readOnly || qSigned || qConverted}
              onClick={() => {
                if (!r.id) { toast.error('Cannot edit', 'This quotation has no server id yet.'); return; }
                if (qConverted) {
                  toast.error('Locked', 'This quotation has been converted to a PI and cannot be edited. Edit the PI instead.');
                  return;
                }
                setEditingQuotationId(r.id);
                setCreateQtOpen(true);
              }}
            />
              );
            })()}
            <Tooltip label="More Options">
              <button
                type="button"
                className="qpi-act"
                style={{ ['--qpi-act-accent' as any]: '#7c3aed' }}
                aria-haspopup="menu"
                /* stopPropagation prevents the menu's outside-click handler
                 * from immediately closing what this click is about to open. */
                onClick={(e) => {
                  e.stopPropagation();
                  const b = e.currentTarget.getBoundingClientRect();
                  const rect: AnchorRect = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
                  const qSig = r.id ? sigByRow[`quotation:${r.id}`] : undefined;
                  setQtMenuFor(prev => prev?.id === r.qtNo
                    ? null
                    : { id: r.qtNo, rect, payload: piPayloadFromQuotation(r), sigId: qSig?.status === 'completed' ? qSig.id : null });
                }}
              >
                <IconKebab />
              </button>
            </Tooltip>
            {/* Always rendered (disabled when signed) so the icon row lines up
                across rows; a signed record stays un-deletable via the disable. */}
            {(() => {
              const qSigned    = r.id ? sigByRow[`quotation:${r.id}`]?.status === 'completed' : false;
              // A quotation already converted to a PI is locked — the backend
              // rejects the cancel with a 409, so disable the button up front.
              const qConverted = r.status === 'converted_to_pi';
              const delTitle = readOnly ? readOnlyHint
                : qConverted ? 'Converted to PI — cannot be deleted'
                : qSigned    ? 'Signed quotation cannot be deleted'
                : 'Delete Quotation';
              return (
                <ActionBtn
                  title={delTitle}
                  icon={<IconTrash />}
                  color="#dc2626"
                  disabled={readOnly || qSigned || qConverted}
                  onClick={() => r.id && setDeleteTarget({ kind: 'quotation', id: r.id, code: r.qtNo })}
                />
              );
            })()}
          </div>
        );
      },
    },
  ], [convertingId, sigByRow, currentUser?.id, emailingKeys, emailCooldowns]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── PI table columns — header set differs by sub-tab (BT ID / BT Date
   *    only on With Shipment). Build both column sets memoised. */
  const piColumnsBase = (withShipment: boolean): any[] => [
    {
      header: 'Sr No', id: '__sr', meta: { align: 'center' },
      cell: (info: any) => <span className="qpi-srno">{info.row.index + 1}</span>,
    },
    { header: 'PI No', accessorKey: 'piNo',  cell: (info: any) => <span className="qpi-link">{info.getValue()}</span> },
    { header: 'PI Date', accessorKey: 'piDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    ...(withShipment ? [
      { header: 'SHP ID', accessorKey: 'btId',   cell: (info: any) => info.getValue() ? <span className="qpi-bt-badge">{info.getValue()}</span> : <span className="qpi-em">—</span> },
      { header: 'SHP Date', accessorKey: 'btDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    ] : []),
    { header: 'Convert From (Quotation No)', accessorKey: 'convertFrom',
      cell: (info: any) => info.getValue() ? <span className="qpi-qt-badge">{info.getValue()}</span> : <span className="qpi-em">—</span> },
    { header: 'Opp ID', accessorKey: 'oppId',
      cell: (info: any) => info.getValue() ? <span className="qpi-link">{info.getValue()}</span> : <span className="qpi-em">—</span> },
    { header: 'Opp Date', accessorKey: 'oppDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    { header: 'Customer',  accessorKey: 'customer',  cell: (info: any) => <span className="qpi-strong">{info.getValue() || '—'}</span> },
    { header: 'Consignee', accessorKey: 'consignee', cell: (info: any) => info.getValue()
        ? <span className="qpi-cap">{info.getValue()}</span>
        : <span className="qpi-em">—</span> },
    { header: 'Document Type', accessorKey: 'docType' },
    { header: 'Currency', accessorKey: 'currency',
      cell: (info: any) => info.getValue() ? <span className="qpi-currency">{currencyCode(info.getValue())}</span> : <span className="qpi-em">—</span> },
    { header: 'Sales Manager', accessorKey: 'salesManager',
      cell: (info: any) => <span className="qpi-sm">{info.getValue() || '—'}</span> },
    {
      // Created By — mirrors the Quotation table column. See helper.
      header: 'Created By', accessorKey: 'createdBy',
      cell: (info: any) => {
        const r = info.row.original as PI;
        return renderCreatorCell(
          r.createdBy, r.createdById, r.creatorUserType, r.branchName,
          currentUser?.id,
        );
      },
    },
    {
      // Signature status — mirrors the Quotation table (and the in-matrix
      // Stage 5 PI table): Not Sent -> Sent (awaiting signature) -> Signed.
      header: () => <div className="text-center">Status</div>,
      id: '__sigstatus', meta: { align: 'center' },
      cell: (info: any) => {
        const r  = info.row.original as PI;
        const st = r.id ? sigByRow[`pi:${r.id}`]?.status : undefined;
        if (st === 'completed')  return <span className="qpi-sig-pill qpi-sig-signed">Signed</span>;
        if (st === 'inprogress') return <span className="qpi-sig-pill qpi-sig-sent">Sent</span>;
        return <span className="qpi-sig-pill qpi-sig-none">Not Sent</span>;
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions', meta: { align: 'center' },
      cell: (info: any) => {
        const r = info.row.original as PI;
        // Same permission gate as the Quotation row — a PI the user can't
        // mutate is visible-but-locked.
        const readOnly = r.canModify === false;
        const readOnlyHint = 'View-only — you don\'t have permission to modify this record.';
        return (
          <div className="d-inline-flex align-items-center gap-2 justify-content-center">
            {/* Send for Signature (Zoho Sign) — status-aware control. */}
            {renderSignAction('pi', r.id, r.piNo, r.customer, r.leadId, readOnly)}
            {/* Email button — matches the in-matrix Stage 5 PI table: stays
                available after every send (no one-time disable) so the PI can
                be re-emailed to the customer; each send fires a toast. The
                follow-up Reminder button stays retired (Zoho Sign reminders
                cover PI signing) — kept under `false &&` for restore. */}
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('pi', r.id)
                    ? 'Sending…'
                    : r.id && cooldownLeft('pi', r.id) > 0
                      ? `Please wait ${cooldownLeft('pi', r.id)}s (max 3 per minute)`
                      : 'Email PI'
              }
              icon={<IconMail />}
              color="#2563eb"
              disabled={readOnly || (isEmailing('pi', r.id))}
              cooling={!!r.id && cooldownLeft('pi', r.id) > 0}
              onClick={() => r.id && sendDocEmail('pi', r.id, r.piNo)}
            />
            {false && (
              <ActionBtn
                title={
                  readOnly
                    ? readOnlyHint
                    : isEmailing('pi', r.id)
                      ? 'Sending…'
                      : r.emailedAt
                        ? `Send Reminder${r.reminderCount ? ` (#${(r.reminderCount ?? 0) + 1})` : ''}`
                        : 'Send initial email first to enable reminders'
                }
                icon={<IconBellSm />}
                color="#f59e0b"
                disabled={readOnly || !r.emailedAt || (isEmailing('pi', r.id))}
                badge={r.reminderCount ?? 0}
                onClick={() => r.id && sendReminder('pi', r.id, r.piNo)}
              />
            )}
            {(() => {
              // Editing is locked once the PI has been SENT for signature
              // (awaiting) or SIGNED — the document must keep matching what was
              // sent to / executed by the customer.
              const pStatus = r.id ? sigByRow[`pi:${r.id}`]?.status : undefined;
              const pSent   = pStatus === 'inprogress';
              const pSigned = pStatus === 'completed';
              const pLocked = pSent || pSigned;
              return (
            <ActionBtn
              title={readOnly ? readOnlyHint : pSigned ? 'PI signed — editing locked' : pSent ? 'PI sent for signature — editing locked' : 'Edit PI'}
              icon={<IconEdit />}
              color="#16a34a"
              disabled={readOnly || pLocked}
              onClick={() => {
                if (!r.id) { toast.error('Cannot edit', 'This PI has no server id yet.'); return; }
                setEditingPiId(r.id);
                setCreatePiOpen(true);
              }}
            />
              );
            })()}
            <Tooltip label="More Options">
              <button
                type="button"
                className="qpi-act"
                style={{ ['--qpi-act-accent' as any]: '#7c3aed' }}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  const b = e.currentTarget.getBoundingClientRect();
                  const rect: AnchorRect = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
                  const pSig = r.id ? sigByRow[`pi:${r.id}`] : undefined;
                  setPiMenuFor(prev => prev?.id === r.piNo
                    ? null
                    : { id: r.piNo, rect, payload: piPayloadFromPI(r), sigId: pSig?.status === 'completed' ? pSig.id : null });
                }}
              >
                <IconKebab />
              </button>
            </Tooltip>
            {/* Delete is DISABLED for PI — a PI shouldn't be removed from the
                history once issued. Code kept under `false &&` (not deleted)
                so it can be re-enabled later. Quotations keep their delete. */}
            {false && (
              <ActionBtn
                title={readOnly ? readOnlyHint : 'Delete PI'}
                icon={<IconTrash />}
                color="#dc2626"
                disabled={readOnly}
                onClick={() => r.id && setDeleteTarget({ kind: 'pi', id: r.id, code: r.piNo })}
              />
            )}
          </div>
        );
      },
    },
  ];
  const piWithColumns    = useMemo<any[]>(() => piColumnsBase(true),  [sigByRow, currentUser?.id, emailingKeys, emailCooldowns]); // eslint-disable-line react-hooks/exhaustive-deps
  const piWithoutColumns = useMemo<any[]>(() => piColumnsBase(false), [sigByRow, currentUser?.id, emailingKeys, emailCooldowns]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qpi-root">
      <style>{SCOPED_CSS}</style>

      {/* ─── Header strip ─── */}
      <div className="qpi-header">
        <span className="qpi-accent" />
        <span className="qpi-glow" />
        <div className="qpi-header-left">
          <div className="qpi-avatar-wrap">
            <div className="qpi-header-icon"><IconUsers /></div>
            <span className="qpi-online-dot" />
          </div>
          <div>
            <div className="qpi-header-title">Quotations V/S Proforma Invoice</div>
            <div className="qpi-header-sub">Manage quotation creation, buyer approval and PI conversion</div>
          </div>
        </div>
        <div className="qpi-tab-switch">
          <button className={`qpi-tab ${tab === 'quotation' ? 'active' : ''}`} onClick={() => switchTab('quotation')}>
            <IconFile /> Quotation <span className="qpi-tab-count">{quotations.length}</span>
          </button>
          <button className={`qpi-tab ${tab === 'pi' ? 'active' : ''}`} onClick={() => switchTab('pi')}>
            <IconMonitor /> Proforma Invoice <span className="qpi-tab-count">{pis.length}</span>
          </button>
        </div>
      </div>

      {/* ─── What We Are Doing Here ─── */}
      <div className="qpi-wdh">
        <div className="qpi-wdh-header" onClick={() => setWdhOpen(o => !o)} role="button">
          <div className="qpi-wdh-title">
            <div className="qpi-wdh-icon"><IconUsers /></div>
            <span>Quotations V/S Proforma Invoice — What We Are Doing Here:</span>
          </div>
          <button className="qpi-wdh-toggle" onClick={(e) => { e.stopPropagation(); setWdhOpen(o => !o); }}>
            {wdhOpen ? <IconChevronUpThin /> : <IconChevronDownThin />}
          </button>
        </div>
        {wdhOpen && (
          <div className="qpi-wdh-body">
            {STEPS.map((s, i) => (
              <Fragment key={s.n}>
                <div className="qpi-wdh-step">
                  <div className="qpi-wdh-step-head">
                    <div className="qpi-wdh-step-num">{s.n}</div>
                    <span className="qpi-wdh-step-title">{s.title}</span>
                  </div>
                  <p className="qpi-wdh-step-desc">{s.desc}</p>
                  <span className="qpi-wdh-step-tag"><span className="qpi-wdh-step-dot" />{s.tag}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="qpi-wdh-arrow"><div className="qpi-wdh-arrow-dot"><IconChevronRight /></div></div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* ─── Table card ─── */}
      <div className="qpi-card">
        {/* Row 1 — "<Tab> List" pill + search + create button (matches the
            Figma reference, which keeps the list pill on the left of the
            toolbar). Label follows the active tab so it reads correctly on
            both the Quotation and Proforma Invoice views. */}
        <div className="qpi-tablebar">
          <div className="qpi-listpill">
            <span className="qpi-listpill-ico"><IconFile /></span>
            {tab === 'quotation' ? 'Quotation List' : 'Proforma Invoice List'}
          </div>
          <div className="qpi-search">
            <IconSearch />
            <input
              type="text"
              placeholder="Search by name, ID, company, email, segment..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {tab === 'quotation' ? (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreateQtOpen(true); }}>
              <IconPlus /> Create Quotation
            </button>
          ) : (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreatePiOpen(true); }}>
              <IconPlus /> Create PI
            </button>
          )}
        </div>

        {/* Row 2 — PI sub-tabs (mirrors .smc-tabs-bar). Rendered only
            on the PI tab; Quotation has no sub-views so this row is
            omitted entirely there. */}
        {tab === 'pi' && (
          <div className="qpi-tabs-bar">
            <div className="qpi-pill-group">
              <button className={`qpi-pi-subtab ${piSub === 'with' ? 'on' : ''}`} onClick={() => switchPiSub('with')}>
                <IconShip /> With Shipment
              </button>
              <button className={`qpi-pi-subtab ${piSub === 'without' ? 'on' : ''}`} onClick={() => switchPiSub('without')}>
                <IconFileSm /> Without Shipment
              </button>
            </div>
          </div>
        )}

        {/* Table — uses the project-standard TableContainer (TanStack)
            so chrome + pagination match the Customer / Recruitment /
            Employee pages. Cell renderers above keep our chips/pills. */}
        <div className="qpi-table-host" ref={tableHostRef}>
          {(tab === 'quotation' ? loadingQt : loadingPi) ? (
            /* Loading shimmer instead of a "0 results" empty table. */
            <ShimmerTable rows={rpp} cols={13} />
          ) : tab === 'quotation' ? (
            <TableContainer
              columns={quotationColumns}
              data={pageRows as Quotation[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search quotations..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('quotation', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          ) : piSub === 'with' ? (
            <TableContainer
              columns={piWithColumns}
              data={pageRows as PI[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search PIs..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('pi', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          ) : (
            <TableContainer
              columns={piWithoutColumns}
              data={pageRows as PI[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search PIs..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('pi', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          )}

          {/* Empty state — centered message in the table body when the active
              dataset has no rows (the TableContainer still shows its header).
              Replaces the previous blank gap below the header. */}
          {!(tab === 'quotation' ? loadingQt : loadingPi) && totalRows === 0 && (
            <div className="qpi-empty">
              {tab === 'quotation' ? 'No quotations found' : 'No proforma invoices found'}
            </div>
          )}
        </div>

        {/* ─── Pagination footer (our own) — Showing X–Y of Z on the left,
            numbered chips + prev/next on the right. Hidden while loading or
            when the active dataset is empty. */}
        {!(tab === 'quotation' ? loadingQt : loadingPi) && totalRows > 0 && (
          <div className="qpi-pag">
            <span className="qpi-pag-info">
              Showing <b>{pageStart + 1}–{pageStart + pageRows.length}</b> of <b>{totalRows}</b>
            </span>
            <div className="qpi-pag-btns">
              <button
                className="qpi-pag-btn qpi-pag-arrow"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                aria-label="Previous page"
              >
                <IconChevronLeft />
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`qpi-pag-btn ${p === safePage ? 'on' : ''}`}
                >
                  {p}
                </button>
              ))}
              <button
                className="qpi-pag-btn qpi-pag-arrow"
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={safePage === pageCount}
                aria-label="Next page"
              >
                <IconChevronRight />
              </button>
            </div>
          </div>
        )}

        {/* Portal'd More-Options menu — rendered once outside the table
            since the column cell-renderer only sets anchor state. */}
        {qtMenuFor && (
          <MoreOptionsMenu
            kind="quotation"
            rect={qtMenuFor.rect}
            payload={qtMenuFor.payload}
            sigId={qtMenuFor.sigId}
            docCode={qtMenuFor.id}
            onViewSigned={qtMenuFor.sigId != null ? () => onViewSignedSig(qtMenuFor.sigId!) : undefined}
            onDownloadSigned={qtMenuFor.sigId != null ? () => onDownloadSignedSig(qtMenuFor.sigId!, qtMenuFor.id) : undefined}
            onBusyChange={(b) => setPdfBusyRowId(b ? Number(qtMenuFor.payload.id) : null)}
            onClose={() => setQtMenuFor(null)}
            onError={(msg) => toast.error('Preview failed', msg)}
          />
        )}
        {piMenuFor && (
          <MoreOptionsMenu
            kind="pi"
            rect={piMenuFor.rect}
            payload={piMenuFor.payload}
            sigId={piMenuFor.sigId}
            docCode={piMenuFor.id}
            onViewSigned={piMenuFor.sigId != null ? () => onViewSignedSig(piMenuFor.sigId!) : undefined}
            onDownloadSigned={piMenuFor.sigId != null ? () => onDownloadSignedSig(piMenuFor.sigId!, piMenuFor.id) : undefined}
            onBusyChange={(b) => setPdfBusyRowId(b ? Number(piMenuFor.payload.id) : null)}
            onClose={() => setPiMenuFor(null)}
            onError={(msg) => toast.error('Preview failed', msg)}
          />
        )}
        {trackerFor && (
          <SigningTrackerModal sigId={trackerFor.sigId} code={trackerFor.code} onClose={() => setTrackerFor(null)} />
        )}

        {/* Soft-delete confirmation — backed by the project-wide
            DeleteConfirmModal so the UX matches Customers/Clients/etc.
            "Cancel" here = flips status to `cancelled` server-side (the
            record stays for audit), not a hard row delete. */}
        <DeleteConfirmModal
          open={!!deleteTarget}
          title={deleteTarget?.kind === 'pi' ? 'Cancel Proforma Invoice' : 'Cancel Quotation'}
          itemName={deleteTarget?.code}
          actionVerb="Cancel"
          confirmLabel="Delete"
          confirmingLabel="Deleting..."
          subMessage={
            deleteTarget?.kind === 'pi'
              ? 'The PI will be marked as cancelled. The record stays in the system for audit but is no longer active.'
              : 'The quotation will be marked as cancelled. The record stays in the system for audit but is no longer active.'
          }
          loading={deleting}
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={onConfirmDelete}
        />

        {/* Convert-to-PI confirmation popup. */}
        <ConvertToPiModal
          open={!!convertTarget}
          fromQuotation={convertTarget?.qtNo ?? ''}
          newPiCode={convertPreviewCode}
          piDate={new Date().toLocaleDateString('en-GB')}
          quotationValue={`${convertTarget?.currency || '$'} ${
            convertTarget?.grandTotal != null ? convertTarget.grandTotal.toFixed(2) : '—'
          }`}
          converting={!!convertTarget?.id && convertingId === convertTarget.id}
          onCancel={() => { if (!convertingId) setConvertTarget(null); }}
          onConfirm={() => void confirmConvert()}
        />

        {/* Conversion blocked — lead already has a PI. */}
        <ConversionBlockedModal
          open={!!convertBlocked}
          fromQuotation={convertBlocked?.fromQt ?? ''}
          existingPiCode={convertBlocked?.pi.piNo ?? ''}
          existingPiDate={convertBlocked?.pi.piDate ?? null}
          existingPiFromQuotation={convertBlocked?.pi.convertFrom ?? null}
          onClose={() => setConvertBlocked(null)}
          onViewExistingPi={() => { setConvertBlocked(null); switchTab('pi'); }}
        />
      </div>

      {/* ─── Modals ─── */}
      {createQtOpen && (
        <CreateQuotationModal
          editId={editingQuotationId}
          onClose={() => { setCreateQtOpen(false); setEditingQuotationId(null); }}
          /* Modal shows its own success toast and only invokes onSubmit on
           * a successful POST/PUT — we just close, clear edit state, and
           * reload the list so the new/updated row appears. */
          onSubmit={() => {
            setCreateQtOpen(false);
            setEditingQuotationId(null);
            reloadQuotations();
          }}
        />
      )}
      {createPiOpen && (
        <CreatePIModal
          editId={editingPiId}
          source={piSourceQuotation}
          onClose={() => { setCreatePiOpen(false); setPiSourceQuotation(null); setEditingPiId(null); }}
          onSubmit={() => {
            setCreatePiOpen(false);
            setPiSourceQuotation(null);
            setEditingPiId(null);
            reloadPis();
            if (piSourceQuotation) reloadQuotations();
          }}
        />
      )}

      {/* Send for Signature (Zoho Sign) — Quotation / PI, same modal as
          Sales Matrix Stage 5. Refreshes the status poller on send. */}
      {sigSendFor && (
        <SalesDocSendForSignatureModal
          open={!!sigSendFor}
          kind={sigSendFor.kind}
          docId={sigSendFor.id}
          docCode={sigSendFor.code}
          leadId={sigSendFor.leadId}
          customerName={sigSendFor.customerName}
          onClose={() => setSigSendFor(null)}
          onSent={() => setSigTick(t => t + 1)}
        />
      )}
    </div>
  );
}

/* QuotationTable + PITable removed — both replaced by inline column
 * definitions feeding the project-standard TableContainer (TanStack).
 * See `quotationColumns` / `piWithColumns` / `piWithoutColumns` in the
 * parent SalesQPI component. */

/* ════════════════════════════════════════════════════════════════════════════
 * Shared Modal building blocks
 * ════════════════════════════════════════════════════════════════════════ */

type BasicFormState = {
  docType: string; opportunity: string; opportunityDate: string;
  customer: string; consignee: string; bankName: string;
  currency: string; exchangeRate: string; incoTerm: string;
  portOfLoading: string; portOfDischarge: string; finalDestination: string;
  originCountry: string;
  stateCode: string;  // Domestic-only: replaces ports / inco / origin

  // Numeric FK ids — populated by the cascade alongside the display
  // labels above. These are what gets POSTed to /sales/quotations.
  oppId: number | null;
  customerId: number | null;
  consigneeId: number | null;
  bankAccountId: number | null;
};

// Default state — every dropdown / input blank. The cascade in BasicForm
// fills downstream fields when the user picks an Opportunity or a
// Customer. Document Type defaults to International so the full
// international field block renders out of the gate (Domestic is the
// narrower variant — user opts in by switching the type).
const EMPTY_BASIC: BasicFormState = {
  docType:         'International',
  opportunity:     '',
  opportunityDate: '',
  customer:        '',
  consignee:       '',
  bankName:        '',
  currency:        '',
  exchangeRate:    '',
  incoTerm:        '',
  portOfLoading:   '',
  portOfDischarge: '',
  finalDestination:'',
  originCountry:   '',
  stateCode:       '',
  oppId:           null,
  customerId:      null,
  consigneeId:     null,
  bankAccountId:   null,
};

/* Seed the Basic form from a lead's opportunity context (Sales Matrix
 * Stage 5). Pre-fills Opportunity / Date / Customer / Consignee AS REAL
 * SELECTIONS — i.e. the "CODE – NAME" dropdown labels AND the FK ids —
 * so the lead's mapped customer & consignee carry through to validation
 * and the POST payload without the user re-picking them. Falls back to
 * name-only labels when a code/id wasn't supplied. */
function seedBasicFromOpp(o: QpiInitialOpp): BasicFormState {
  const custLabel = o.customerCode && o.customerLabel
    ? `${o.customerCode} – ${o.customerLabel}`
    : (o.customerLabel ?? '');
  const consLabel = o.consigneeCode && o.consigneeLabel
    ? `${o.consigneeCode} – ${o.consigneeLabel}`
    : (o.consigneeLabel ?? '');
  return {
    ...EMPTY_BASIC,
    opportunity:     o.customerLabel ? `${o.oppCode} – ${o.customerLabel}` : o.oppCode,
    opportunityDate: o.oppDate ?? '',
    customer:        custLabel,
    customerId:      o.customerId ?? null,
    consignee:       consLabel,
    consigneeId:     o.consigneeId ?? null,
    oppId:           o.oppId,
  };
}

type ProductRow = {
  id: number;          // local UI key
  productId: number | null;  // FK to products.id — null for free-text rows
  hsn: string | null;
  name: string;
  qty: number;
  rate: number;
  taxPct: number;
};

function calcRow(p: ProductRow) {
  const sub = p.qty * p.rate;
  const taxAmt = sub * (p.taxPct / 100);
  const rateWithTax = p.rate * (1 + p.taxPct / 100);
  const amount = sub + taxAmt;
  return { sub, taxAmt, rateWithTax, amount };
}

/* ════════════════════════════════════════════════════════════════════════════
 * Masters hook — pulled once when either Create modal opens so every
 * dropdown gets real, fresh data instead of free-text inputs.
 * ════════════════════════════════════════════════════════════════════════ */
type MasterOpt = { value: string; label: string };
// Raw rows kept alongside the dropdown options so the form can cascade
// (pick opportunity → fill customer + consignee + date + currency; pick
// customer → filter opportunities and consignees).
//
// The KEY field on every row is `dbId` — the numeric primary-key Laravel
// uses for the FK joins (lead.customer_id, consignee.customer_id). The
// display `code` ("C-012", "OPP-0001") is just for label rendering.
type LeadRow = {
  leadId:          number;           // leads.id — POSTed as opp_id
  opp_code:        string;
  sender_company:  string;
  sender_country:  string;
  date:            string;
  // Numeric FKs that join to customers.id / consignees.id. From
  // /sales/leads' eager-loaded customer{} + consignee{} relations.
  customerDbId:    number | null;
  consigneeDbId:   number | null;
  currency:        string | null;
};
type CustomerRow = {
  dbId:     number;          // customers.id (numeric PK)
  code:     string;          // "C-012" (display, from customer_code)
  company:  string;
  country:  string;
  currency: string | null;
};
type ConsigneeRow = {
  dbId:          number;          // consignees.id (numeric PK)
  code:          string;          // "CN-012"
  company:       string;
  customerDbId:  number | null;   // FK → customers.id
  country:       string;
};
type BankRow = {
  dbId:   number;   // master_bank_accounts.id
  label:  string;   // "Bank Name (Holder)"
};
type ProductMasterRow = {
  dbId:    number;   // products.id (numeric PK)
  code:    string;   // P-01
  name:    string;
  hsn:     string | null;   // resolved HSN code
  rate:    number;          // base_price (default sell rate)
  taxPct:  number;          // gst percentage
};
type LoadedMasters = {
  currencies:       MasterOpt[];
  incoterms:        MasterOpt[];
  ports:            MasterOpt[];
  countries:        MasterOpt[];
  customers:        MasterOpt[];
  consignees:       MasterOpt[];
  banks:            MasterOpt[];
  opportunities:    MasterOpt[];
  states:           MasterOpt[];   // Domestic-only "State Code" dropdown
  products:         MasterOpt[];   // Step 2 product dropdown
  // Raw rows for cascade lookups
  opportunitiesRaw: LeadRow[];
  customersRaw:     CustomerRow[];
  consigneesRaw:    ConsigneeRow[];
  banksRaw:         BankRow[];
  productsRaw:      ProductMasterRow[];
  loading:          boolean;
};

/* Module-level cache for the QPI masters. The Create Quotation / Create
 * PI modals fan out 11 GETs to populate their dropdowns; without a cache
 * every re-open of the modal repeats all 11. We keep one in-memory copy
 * keyed by the active branch (so a Branch Switcher change still triggers
 * a fresh load) and a 5-minute TTL so stale data doesn't haunt a long
 * session. Most of these masters (currencies, incoterms, ports,
 * countries, states, banks) change less than once a week — caching them
 * for 5 minutes is safe and dramatically speeds up the modal. */
const QPI_MASTERS_CACHE_TTL_MS = 5 * 60 * 1000;
let qpiMastersCache: {
  data:     LoadedMasters;
  branchId: string;
  loadedAt: number;
} | null = null;
/* Promise dedupe — if two modals open back-to-back (e.g. user double-
 * clicks), only one wave of network traffic actually fires. */
let qpiMastersInFlight: Promise<LoadedMasters> | null = null;

/* Public helper so callers (e.g. after a successful Map Product / Add
 * Customer flow) can drop the cache and force the next open to refetch. */
export function invalidateQpiMastersCache() {
  qpiMastersCache    = null;
  qpiMastersInFlight = null;
}

/* Public prewarm helper — call from a parent screen (e.g. Stage 5 mount)
 * to start the 11-call fan-out + shape work in the background BEFORE
 * the user clicks "+ Create Quotation". By the time they do, the cache
 * is already warm and the modal opens with all dropdowns populated
 * instantly. Safe to call repeatedly: cache + in-flight dedupe make
 * extra calls cheap no-ops. */
export function prewarmQpiMasters(): void {
  const branch = currentBranchKey();
  if (
    qpiMastersCache
    && qpiMastersCache.branchId === branch
    && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
  ) return;
  if (qpiMastersInFlight) return;
  // Kick the same load the hook uses. Errors are swallowed here; the
  // actual modal open will see `qpiMastersInFlight === null` and retry.
  void loadQpiMasters(branch).catch(() => {});
}

/* The actual fetch+shape work, used by both the prewarm helper and the
 * useQpiMasters hook. Sets `qpiMastersInFlight` for concurrent-open
 * dedupe and writes `qpiMastersCache` on success. */
function loadQpiMasters(branch: string): Promise<LoadedMasters> {
  if (qpiMastersInFlight) return qpiMastersInFlight;
  qpiMastersInFlight = Promise.all([
    api.get('/master/currencies').catch(() => ({ data: [] })),
    api.get('/master/incoterms').catch(() => ({ data: [] })),
    api.get('/master/port_of_loading').catch(() => ({ data: [] })),
    api.get('/master/countries').catch(() => ({ data: [] })),
    api.get('/customers', { params: { tab: 'all' } }).catch(() => ({ data: { data: [] } })),
    api.get('/consignees').catch(() => ({ data: { data: [] } })),
    api.get('/master/bank_accounts').catch(() => ({ data: [] })),
    api.get('/sales/leads', { params: { per_page: 50 } }).catch(() => ({ data: { data: [] } })),
    api.get('/master/state_codes').catch(() => ({ data: [] })),
    api.get('/master/states').catch(() => ({ data: [] })),
    api.get('/products', { params: { per_page: 200, status: 'active' } }).catch(() => ({ data: { data: [] } })),
  ]).then(([cur, inco, port, ctry, cust, cons, bank, lead, stCode, st, prod]): LoadedMasters => {
    const next = shapeQpiMasters(cur, inco, port, ctry, cust, cons, bank, lead, stCode, st, prod);
    qpiMastersCache    = { data: next, branchId: branch, loadedAt: Date.now() };
    qpiMastersInFlight = null;
    return next;
  }).catch((err): never => {
    qpiMastersInFlight = null;
    throw err;
  });
  return qpiMastersInFlight;
}

/* Pure shaper — extracted so the prewarm path and the hook path both
 * produce the exact same `LoadedMasters` object, avoiding any drift
 * between two slightly different shaping implementations. */
function shapeQpiMasters(
  cur: any, inco: any, port: any, ctry: any,
  cust: any, cons: any, bank: any, lead: any,
  stCode: any, st: any, prod: any,
): LoadedMasters {
  const arr = (x: any) => Array.isArray(x?.data?.data) ? x.data.data : (Array.isArray(x?.data) ? x.data : []);
  const optByCode = (rows: any[], codeKey = 'code', nameKey = 'name') =>
    rows.map((r: any) => {
      const code = r[codeKey] ?? '';
      const name = r[nameKey] ?? r.full_name ?? r.title ?? '';
      const label = code && name ? `${code} – ${name}` : (name || code || '');
      return { value: label, label };
    }).filter(o => o.label);
  const customerRows = arr(cust);
  const consigneeRows = arr(cons);
  const bankRows = arr(bank);
  const leadRows = arr(lead);
  const productRows = arr(prod);

  const productOptList: MasterOpt[] = [];
  const productRawList: ProductMasterRow[] = [];
  productRows.forEach((r: any) => {
    const dbId = Number(r.id ?? 0);
    if (!dbId) return;
    const code = String(r.product_code ?? r.code ?? `P-${String(dbId).padStart(2, '0')}`);
    const name = r.name ?? '';
    if (!name) return;
    const label = `${code} – ${name}`;
    productOptList.push({ value: label, label });
    const gstPct = Number(
      r.gstPercentage?.percentage
      ?? r.gst_percentage?.percentage
      ?? r.gst_percentage
      ?? (Number(r.base_price) > 0 ? (Number(r.gst_amount) / Number(r.base_price)) * 100 : 0)
    );
    productRawList.push({
      dbId, code, name,
      hsn:    r.hsn?.code ?? r.hsn_code ?? null,
      rate:   Number(r.base_price ?? 0),
      taxPct: isFinite(gstPct) ? Number(gstPct.toFixed(2)) : 0,
    });
  });

  const bankOptList: MasterOpt[] = [];
  const bankRawList: BankRow[]   = [];
  bankRows.forEach((r: any) => {
    const dbId = Number(r.id ?? 0);
    if (!dbId) return;
    const name = r.bank_name ?? r.name ?? '';
    const holder = r.account_holder ?? '';
    const label = holder ? `${name} (${holder})` : name;
    if (!label) return;
    bankOptList.push({ value: label, label });
    bankRawList.push({ dbId, label });
  });

  const customerOpts: MasterOpt[] = [];
  const customersRaw: CustomerRow[] = [];
  customerRows.forEach((r: any) => {
    const dbId = Number(r.db_id ?? r.id ?? 0);
    if (!dbId) return;
    const code = String(r.id ?? r.customer_code ?? `C-${String(dbId).padStart(3, '0')}`);
    const co   = r.company ?? r.company_name ?? r.name ?? '';
    const label = `${code} – ${co}`;
    if (!co) return;
    customerOpts.push({ value: label, label });
    customersRaw.push({
      dbId, code, company: co,
      country: r.country ?? r.country_iso ?? '',
      currency: r.currency ?? r.default_currency ?? null,
    });
  });
  const consigneeOpts: MasterOpt[] = [];
  const consigneesRaw: ConsigneeRow[] = [];
  consigneeRows.forEach((r: any) => {
    const dbId = Number(r.db_id ?? r.id ?? 0);
    if (!dbId) return;
    const code = String(r.id ?? r.consignee_code ?? `CN-${String(dbId).padStart(3, '0')}`);
    const co   = r.company ?? r.company_name ?? r.name ?? '';
    if (!co) return;
    const label = `${code} – ${co}`;
    consigneeOpts.push({ value: label, label });
    consigneesRaw.push({
      dbId, code, company: co,
      customerDbId: r.customer_id != null ? Number(r.customer_id) : null,
      country: r.country ?? '',
    });
  });
  const opportunityOpts: MasterOpt[] = [];
  const opportunitiesRaw: LeadRow[] = [];
  leadRows.forEach((r: any) => {
    const code = r.opp_code ?? r.opp_id ?? (r.id ? `OPP-${String(r.id).padStart(4, '0')}` : '');
    // Show the mapped customer's COMPANY name (not legal name) beside the
    // Opp ID. Falls back to the lead's sender/company only when the opp has
    // no customer mapped yet.
    const who  = (
      r.customer?.company_name
      || r.customer_company_name
      || r.sender_company
      || r.sender_name
      || r.company
      || ''
    ).toString();
    const label = code && who ? `${code} – ${who}` : (code || who || '');
    if (!label) return;
    opportunityOpts.push({ value: label, label });
    const dateSrc = r.query_time ?? r.created_at;
    opportunitiesRaw.push({
      leadId:         Number(r.id ?? 0),
      opp_code:       code,
      sender_company: who,
      sender_country: r.sender_country_iso ?? r.sender_country ?? '',
      date:           dateSrc ? new Date(dateSrc).toLocaleDateString('en-GB') : '',
      customerDbId:   r.customer_id != null ? Number(r.customer_id)
                      : (r.customer?.id != null ? Number(r.customer.id) : null),
      consigneeDbId:  r.consignee_id != null ? Number(r.consignee_id)
                      : (r.consignee?.id != null ? Number(r.consignee.id) : null),
      currency:       r.currency ?? r.quote_currency ?? null,
    });
  });
  const stateRows = arr(st);
  const stateById = new Map<number, string>();
  stateRows.forEach((s: any) => { if (s.id) stateById.set(Number(s.id), s.name ?? ''); });
  const codeRows = arr(stCode);
  const stateOpts: MasterOpt[] = codeRows.map((r: any) => {
    const code = (r.state_code ?? r.code ?? '').toString().trim().toUpperCase();
    const name = stateById.get(Number(r.state_id ?? r.state?.id ?? 0)) ?? (r.state?.name ?? '');
    const label = code && name ? `${code} – ${name}` : (name || code);
    return { value: label, label };
  }).filter((o: MasterOpt) => o.label);
  const statesFinal: MasterOpt[] = stateOpts.length > 0
    ? stateOpts
    : stateRows.map((s: any) => ({ value: s.name ?? '', label: s.name ?? '' })).filter((o: MasterOpt) => o.label);

  return {
    currencies: optByCode(arr(cur)),
    incoterms:  optByCode(arr(inco)),
    ports:      optByCode(arr(port)),
    countries:  arr(ctry).map((r: any) => ({ value: r.name ?? '', label: r.name ?? '' })).filter((o: MasterOpt) => o.label),
    states:     statesFinal,
    customers:  customerOpts,
    consignees: consigneeOpts,
    banks:      bankOptList,
    banksRaw:   bankRawList,
    products:   productOptList,
    productsRaw: productRawList,
    opportunities:    opportunityOpts,
    opportunitiesRaw,
    customersRaw,
    consigneesRaw,
    loading: false,
  };
}

function currentBranchKey(): string {
  try {
    const userRaw = localStorage.getItem('cbc_user');
    const user    = userRaw ? JSON.parse(userRaw) : null;
    if (!user?.id) return 'anon';
    const b = localStorage.getItem(`cbc_selected_branch_id_${user.id}`);
    return `${user.id}:${b ?? 'all'}`;
  } catch { return 'anon'; }
}

export function useQpiMasters(open: boolean): LoadedMasters {
  const [state, setState] = useState<LoadedMasters>(() => {
    // Hydrate from cache synchronously so the first render of a re-opened
    // modal already has the dropdown options — no flash of "Loading…".
    const branch = currentBranchKey();
    if (
      qpiMastersCache
      && qpiMastersCache.branchId === branch
      && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
    ) return qpiMastersCache.data;
    return {
      currencies: [], incoterms: [], ports: [], countries: [],
      customers: [], consignees: [], banks: [], opportunities: [],
      states: [], products: [],
      opportunitiesRaw: [], customersRaw: [], consigneesRaw: [],
      banksRaw: [], productsRaw: [],
      loading: false,
    };
  });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const branch = currentBranchKey();

    // Cache hit — return synchronously, no network at all.
    if (
      qpiMastersCache
      && qpiMastersCache.branchId === branch
      && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
    ) {
      setState(qpiMastersCache.data);
      return;
    }

    // Concurrent-open dedupe — piggy-back on the in-flight wave.
    if (qpiMastersInFlight) {
      setState(s => ({ ...s, loading: true }));
      qpiMastersInFlight.then(d => { if (!cancelled) setState(d); }).catch(() => {});
      return () => { cancelled = true; };
    }

    setState(s => ({ ...s, loading: true }));
    // Delegate to the shared loader — it handles the fan-out fetch +
    // shape work and writes the module cache so this and any
    // pre-warmed/sibling caller share the same result.
    loadQpiMasters(branch)
      .then(d => { if (!cancelled) setState(d); })
      .catch(() => { if (!cancelled) setState(s => ({ ...s, loading: false })); });
    return () => { cancelled = true; };
  }, [open]);
  return state;
}

/* ════════════════════════════════════════════════════════════════════════════
 * Create Quotation Modal (2-step wizard)
 * ════════════════════════════════════════════════════════════════════════ */

export type QpiInitialOpp = {
  oppId:            number;
  oppCode:          string;
  oppDate?:         string;
  /** Customer company NAME — used to build the Opportunity label
   *  ("OPP-005 – Acme"). */
  customerLabel?:   string;
  /** Customer master code (e.g. C-012). Combined with the name to seed
   *  the Customer dropdown's "CODE – NAME" value. */
  customerCode?:    string;
  /** Customer FK — seeded so the lead's mapped customer is a real
   *  selection (validation + submit need the id, not just the label). */
  customerId?:      number | null;
  /** Consignee company name + code + FK — same idea for the consignee
   *  the lead was mapped to (so the user never re-picks it). */
  consigneeLabel?:  string;
  consigneeCode?:   string;
  consigneeId?:     number | null;
};

export function CreateQuotationModal(props: {
  editId: number | null;
  initialOpp?: QpiInitialOpp;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { editId, initialOpp, onClose, onSubmit } = props;
  const isEdit = editId != null;
  const toast = useToast();
  useScrollLock();   // freeze background scroll while the modal is open
  const [step, setStep] = useState<1 | 2>(1);
  /* If the modal was opened from inside a Sales Matrix lead, the parent
   * passes the opportunity context so the user doesn't have to re-pick it
   * from the Opportunity dropdown. The form is still freely editable —
   * only the visible labels are pre-filled. */
  const seededFromOpp: BasicFormState = initialOpp ? seedBasicFromOpp(initialOpp) : EMPTY_BASIC;
  const [form, setForm] = useState<BasicFormState>(seededFromOpp);
  /* Step-1 validation gate for the "Save & Next" button.
   * Server-required fields per QuotationController::validatePayload:
   *   - Always: doc_type, customer_id
   *   - International: inco_term, port_of_loading, port_of_discharge,
   *                    final_destination, origin_country
   *   - Domestic:      state_code
   * Opportunity / Consignee / Bank / Currency are nullable on the server
   * so the wizard doesn't gate on them. */
  const [step1Errors, setStep1Errors] = useState<Set<string>>(new Set());
  const onSaveNext = () => {
    const errs = new Set<string>();
    const labels: Record<string, string> = {
      customer: 'Customer', consignee: 'Consignee', bankName: 'Bank Name',
      incoTerm: 'INCO Term', portOfLoading: 'Port of Loading',
      portOfDischarge: 'Port of Discharge', finalDestination: 'Final Destination',
      originCountry: 'Origin Country', stateCode: 'State Code',
    };
    if (!form.customerId)            errs.add('customer');
    if (!form.consigneeId)           errs.add('consignee');
    if (!form.bankName)              errs.add('bankName');
    if (form.docType === 'International') {
      if (!form.incoTerm)            errs.add('incoTerm');
      if (!form.portOfLoading)       errs.add('portOfLoading');
      if (!form.portOfDischarge)     errs.add('portOfDischarge');
      if (!form.finalDestination)    errs.add('finalDestination');
      if (!form.originCountry)       errs.add('originCountry');
    } else {
      if (!form.stateCode)           errs.add('stateCode');
    }
    setStep1Errors(errs);
    if (errs.size > 0) {
      const list = Array.from(errs).map(k => labels[k]).join(', ');
      toast.error('Missing required fields', `Please fill: ${list}`);
      return;
    }
    setStep(2);
  };
  const masters = useQpiMasters(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  const [saving, setSaving] = useState(false);
  // Existing record metadata shown in the top-right pills + used for the
  // PUT URL. Populated by the hydrate effect below when editId is set.
  const [existingCode, setExistingCode] = useState<string | null>(null);
  const [existingDate, setExistingDate] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  /* Indicative next code (QT/<FY>/<n>) shown in the header pill while
   * creating — the real code is allocated atomically on save. */
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    api.get('/sales/quotations/preview-code')
      .then(({ data }) => { if (!cancelled) setPreviewCode(data?.data?.code ?? null); })
      .catch(() => { /* fall back to "Auto-assigned" */ });
    return () => { cancelled = true; };
  }, [isEdit]);

  // Edit-mode hydration. When editId is provided, fetch the full row
  // (with items + eager-loaded customer/consignee/lead/salesManager) and
  // map it into our form state. This runs only after `masters` finishes
  // loading so we can resolve display labels like "C-012 – Acme Corp".
  useEffect(() => {
    if (!isEdit) return;
    if (masters.loading) return;       // wait for masters to populate
    let cancelled = false;
    setHydrating(true);
    api.get(`/sales/quotations/${editId}`)
      .then(({ data }) => {
        if (cancelled) return;
        const r = data?.data;
        if (!r) return;
        setExistingCode(r.code ?? null);
        setExistingDate(r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : null);

        // Resolve label-formatted dropdown values from the raw rows in
        // masters. We already have customer_id / consignee_id / opp_id /
        // bank_account_id as numeric FKs from the server.
        const custRow = r.customer_id != null
          ? masters.customersRaw.find(c => c.dbId === r.customer_id) : null;
        const consRow = r.consignee_id != null
          ? masters.consigneesRaw.find(c => c.dbId === r.consignee_id) : null;
        const oppRow  = r.opp_id != null
          ? masters.opportunitiesRaw.find(o => o.leadId === r.opp_id) : null;
        const bankRow = r.bank_account_id != null
          ? masters.banksRaw.find(b => b.dbId === r.bank_account_id) : null;

        setForm({
          docType:          r.doc_type ?? 'International',
          opportunity:      oppRow ? `${oppRow.opp_code} – ${oppRow.sender_company}` : (r.opp_code ?? ''),
          opportunityDate:  r.opportunity_date ? new Date(r.opportunity_date).toLocaleDateString('en-GB') : '',
          customer:         custRow ? `${custRow.code} – ${custRow.company}` : (r.customer_name ?? ''),
          consignee:        consRow ? `${consRow.code} – ${consRow.company}` : (r.consignee_name ?? ''),
          bankName:         bankRow?.label ?? (r.bank_label ?? ''),
          currency:         r.currency ?? '',
          exchangeRate:     r.exchange_rate != null ? String(r.exchange_rate) : '',
          incoTerm:         r.inco_term ?? '',
          portOfLoading:    r.port_of_loading ?? '',
          portOfDischarge:  r.port_of_discharge ?? '',
          finalDestination: r.final_destination ?? '',
          originCountry:    r.origin_country ?? '',
          stateCode:        r.state_code ?? '',
          oppId:            r.opp_id ?? null,
          customerId:       r.customer_id ?? null,
          consigneeId:      r.consignee_id ?? null,
          bankAccountId:    r.bank_account_id ?? null,
        });

        // Hydrate the products grid from the server's items array.
        const items = Array.isArray(r.items) ? r.items : [];
        setProducts(items.map((it: any, i: number) => ({
          id:        Date.now() + i,
          productId: it.product_id ?? null,
          hsn:       it.hsn_code ?? null,
          name:      it.product_name ?? '',
          qty:       Number(it.quantity ?? 0),
          rate:      Number(it.rate ?? 0),
          taxPct:    Number(it.tax_pct ?? 0),
        })));
        setTerms(r.terms ?? '');
        setShipping(Number(r.shipping ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load this quotation for editing.'))
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [editId, isEdit, masters.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // POST (create) → /sales/quotations  •  PUT (update) → /sales/quotations/{id}.
  // Server is the source of truth for line totals — we send the picked
  // FK ids + items and let the controller recompute.
  const submit = async () => {
    if (saving) return;
    if (!form.customerId) { toast.error('Customer required', 'Pick a customer before saving.'); return; }
    if (!form.consigneeId) { setStep1Errors(prev => new Set(prev).add('consignee')); setStep(1); toast.error('Consignee required', 'Select a consignee before saving.'); return; }
    if (products.length === 0) { toast.error('No products', 'Add at least one line item.'); return; }
    setSaving(true);
    try {
      const payload = {
        doc_type:          form.docType,
        opp_id:            form.oppId,
        customer_id:       form.customerId,
        consignee_id:      form.consigneeId,
        bank_account_id:   form.bankAccountId,
        currency:          form.currency || null,
        exchange_rate:     form.exchangeRate ? Number(form.exchangeRate) : null,
        inco_term:         form.incoTerm        || null,
        port_of_loading:   form.portOfLoading   || null,
        port_of_discharge: form.portOfDischarge || null,
        final_destination: form.finalDestination|| null,
        origin_country:    form.originCountry   || null,
        state_code:        form.stateCode       || null,
        shipping:          Number(shipping) || 0,
        terms:             terms || null,
        items: products.map(p => ({
          product_id:   p.productId,    // FK from master pick, null for free-text
          product_name: p.name,
          hsn_code:     p.hsn,
          quantity:     Number(p.qty),
          rate:         Number(p.rate),
          tax_pct:      Number(p.taxPct) || 0,
        })),
      };
      if (isEdit) {
        await api.put(`/sales/quotations/${editId}`, payload);
        toast.success('Quotation Updated', `${existingCode ?? 'Quotation'} saved.`);
      } else {
        await api.post('/sales/quotations', payload);
        toast.success('Quotation Created', 'Saved as draft for review');
      }
      // If the lead had no consignee and one was picked here, map it back onto
      // the lead (same as the toolbar's consignee mapping) so it sticks.
      if (form.oppId && form.consigneeId && !initialOpp?.consigneeId) {
        try { await api.put(`/sales/leads/${form.oppId}`, { consignee_id: form.consigneeId }); }
        catch { /* non-fatal — the quotation already carries the consignee */ }
      }
      onSubmit();   // Parent closes modal + reloads list.
    } catch (e: any) {
      // Use ?? + explicit parens to avoid the (|| ? :) precedence trap —
      // the old code crashed when the API returned `{message: '...'}`
      // without an `errors` map (it'd run `Object.values(undefined)`).
      const data = e?.response?.data;
      const msg = data?.message
        ?? (data?.errors ? Object.values(data.errors).flat().join(' ') : 'Could not save the quotation.');
      toast.error('Save failed', String(msg));
    } finally {
      setSaving(false);
    }
  };

  const addProduct = () => {
    // Required-field validation with explicit feedback — the old silent
    // `return` left the user wondering why the Add button "did nothing".
    if (!draft.name) {
      toast.error('Product required', 'Please select a product from the dropdown first.');
      return;
    }
    if (!(draft.qty > 0)) {
      toast.error('Quantity required', 'Enter a quantity greater than 0.');
      return;
    }
    if (!(draft.rate > 0)) {
      toast.error('Rate required', 'Enter a product rate greater than 0.');
      return;
    }
    // Duplicate guard — the dropdown already filters out added products,
    // so this is a backstop for free-text rows or race conditions. By
    // productId for master-picked rows, by name as a fallback for
    // free-text rows.
    const dup = draft.productId
      ? products.some(p => p.productId === draft.productId)
      : products.some(p => p.name === draft.name);
    if (dup) {
      toast.error('Already added', `${draft.name} is already in the list. Remove it first to change quantity or rate.`);
      return;
    }
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => setProducts(p => p.filter(x => x.id !== id));

  const subTotal = products.reduce((s, p) => s + calcRow(p).amount, 0);
  const grandTotal = subTotal + (Number(shipping) || 0);

  return (
    /* Backdrop is purely visual — closing only via the X / Cancel button
     * so accidental outside-clicks don't wipe an in-progress quote. */
    <div className="qpi-modal-backdrop">
      {/* The QPI stylesheet lives at the bottom of this file and is injected
       * once per modal mount so the modal renders correctly even when opened
       * from outside the /sales/qpi workspace (e.g. Sales Matrix Stage 5).
       * Duplicate <style> tags are inert when the workspace is also mounted. */}
      <style>{SCOPED_CSS}</style>
      <div className="qpi-modal qpi-modal-teal">
        {/* Header (teal) — title + pills reflect create vs edit mode. */}
        <div className="qpi-modal-head qpi-modal-head-teal">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">
                {isEdit ? 'Edit Quotation' : 'Create Quotation'}
                {hydrating && <span style={{ marginLeft: 10, fontSize: 11, opacity: .8 }}>Loading…</span>}
              </div>
              <div className="qpi-modal-sub">
                {isEdit
                  ? 'Update the quotation details below — saving overwrites the existing record.'
                  : 'Fill in the details to generate a new quotation'}
              </div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation ID</span>
              <span className="qpi-modal-pill-value">{existingCode ?? previewCode ?? 'Auto-assigned'}</span>
            </div>
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation Date</span>
              <span className="qpi-modal-pill-value">{existingDate ?? new Date().toLocaleDateString('en-GB')}</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        {/* Stepper */}
        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic Quotation Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="teal" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="teal" />
        </div>

        {/* Body */}
        <div className="qpi-modal-body">
          {step === 1 && (
            hydrating ? <BasicFormSkeleton theme="teal" /> : (
            <BasicForm
              form={form} setForm={setForm}
              masters={masters} theme="teal"
              titleLabel="Basic Quotation Details" partyKind="Quotation"
              lockParty={!!initialOpp}
              /* Lock the consignee whenever the lead already has one mapped
               * (initialOpp carries it) OR we're editing an existing
               * quotation — the lead's FINAL consignee is fixed by the
               * first quotation and must not drift on later create/edit. */
              lockConsignee={isEdit || !!initialOpp?.consigneeId}
              errors={step1Errors}
              clearError={(k) => setStep1Errors(prev => {
                if (!prev.has(k)) return prev;
                const next = new Set(prev); next.delete(k); return next;
              })}
            />
            )
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="teal"
              titleLabel="Quotation"
              productOptions={masters.products}
              productsRaw={masters.productsRaw}
              loadingProducts={masters.loading}
            />
          )}
        </div>

        {/* Footer */}
        <div className="qpi-modal-foot">
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button className="qpi-btn-next qpi-btn-next-teal" onClick={onSaveNext} disabled={hydrating}>
                Save &amp; Next →
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-teal" onClick={submit} disabled={saving || hydrating}>
                {saving
                  ? (isEdit ? 'Updating…' : 'Saving…')
                  : (isEdit ? '✓ Update Quotation' : '✓ Submit Quotation')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Create Proforma Invoice (PI) Modal (2-step wizard, purple theme)
 * ════════════════════════════════════════════════════════════════════════ */

export function CreatePIModal(props: {
  editId: number | null;
  source: Quotation | null;
  /* Lead-scoped opening (from Sales Matrix Stage 5). Same shape as the
   * Quotation modal — pre-fills the Opportunity dropdown. */
  initialOpp?: QpiInitialOpp;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { editId, source, initialOpp, onClose, onSubmit } = props;
  const isEdit = editId != null;
  const toast = useToast();
  useScrollLock();   // freeze background scroll while the modal is open
  const [step, setStep] = useState<1 | 2>(1);
  // Existing PI metadata shown in the top-right pills + used for the
  // PUT URL when in edit mode.
  const [existingCode, setExistingCode] = useState<string | null>(null);
  const [existingDate, setExistingDate] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  /* Indicative next PI code (INV/<FY>/<n>) for the header pill. */
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    api.get('/sales/proforma-invoices/preview-code')
      .then(({ data }) => { if (!cancelled) setPreviewCode(data?.data?.code ?? null); })
      .catch(() => { /* fall back to "Auto-assigned" */ });
    return () => { cancelled = true; };
  }, [isEdit]);

  // When PI is created from an existing Quotation row, prefill the
  // visible labels from that row so the user sees what they're carrying
  // over. When opened standalone, start blank — the same opportunity /
  // customer cascade fills the rest. When the matrix Stage 5 opens this
  // modal, `initialOpp` takes precedence over `source` to lock the lead.
  const seeded: BasicFormState = initialOpp ? seedBasicFromOpp(initialOpp) : source ? {
    ...EMPTY_BASIC,
    opportunity:     source.oppId ? `${source.oppId} – ${source.customer}` : '',
    opportunityDate: source.oppDate ?? '',
    customer:        source.customer ? `${source.customer}` : '',
    consignee:       source.consignee ? `${source.consignee}` : '',
  } : { ...EMPTY_BASIC };
  const [form, setForm] = useState<BasicFormState>(seeded);
  const masters = useQpiMasters(true);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  const [saving, setSaving] = useState(false);
  // pi_type lives in state so the edit hydrate can restore the original
  // variant (with_shipment / without_shipment) when re-opening a row.
  const [piType, setPiType] = useState<'with_shipment' | 'without_shipment'>('with_shipment');

  /* Step-1 validation gate — same rules as the Quotation modal since
   * ProformaInvoiceController::validatePayload mirrors the Quotation one. */
  const [step1Errors, setStep1Errors] = useState<Set<string>>(new Set());
  const onSaveNext = () => {
    const errs = new Set<string>();
    const labels: Record<string, string> = {
      customer: 'Customer', consignee: 'Consignee', bankName: 'Bank Name',
      incoTerm: 'INCO Term', portOfLoading: 'Port of Loading',
      portOfDischarge: 'Port of Discharge', finalDestination: 'Final Destination',
      originCountry: 'Origin Country', stateCode: 'State Code',
    };
    if (!form.customerId)            errs.add('customer');
    if (!form.consigneeId)           errs.add('consignee');
    if (!form.bankName)              errs.add('bankName');
    if (form.docType === 'International') {
      if (!form.incoTerm)            errs.add('incoTerm');
      if (!form.portOfLoading)       errs.add('portOfLoading');
      if (!form.portOfDischarge)     errs.add('portOfDischarge');
      if (!form.finalDestination)    errs.add('finalDestination');
      if (!form.originCountry)       errs.add('originCountry');
    } else {
      if (!form.stateCode)           errs.add('stateCode');
    }
    setStep1Errors(errs);
    if (errs.size > 0) {
      const list = Array.from(errs).map(k => labels[k]).join(', ');
      toast.error('Missing required fields', `Please fill: ${list}`);
      return;
    }
    setStep(2);
  };

  // Edit-mode hydration — same pattern as the Quotation modal. Waits
  // for masters to load so dropdown labels resolve correctly.
  useEffect(() => {
    if (!isEdit) return;
    if (masters.loading) return;
    let cancelled = false;
    setHydrating(true);
    api.get(`/sales/proforma-invoices/${editId}`)
      .then(({ data }) => {
        if (cancelled) return;
        const r = data?.data;
        if (!r) return;
        setExistingCode(r.code ?? null);
        setExistingDate(r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : null);
        setPiType(r.pi_type === 'without_shipment' ? 'without_shipment' : 'with_shipment');

        const custRow = r.customer_id != null
          ? masters.customersRaw.find(c => c.dbId === r.customer_id) : null;
        const consRow = r.consignee_id != null
          ? masters.consigneesRaw.find(c => c.dbId === r.consignee_id) : null;
        const oppRow  = r.opp_id != null
          ? masters.opportunitiesRaw.find(o => o.leadId === r.opp_id) : null;
        const bankRow = r.bank_account_id != null
          ? masters.banksRaw.find(b => b.dbId === r.bank_account_id) : null;

        setForm({
          docType:          r.doc_type ?? 'International',
          opportunity:      oppRow ? `${oppRow.opp_code} – ${oppRow.sender_company}` : (r.opp_code ?? ''),
          opportunityDate:  r.opportunity_date ? new Date(r.opportunity_date).toLocaleDateString('en-GB') : '',
          customer:         custRow ? `${custRow.code} – ${custRow.company}` : (r.customer_name ?? ''),
          consignee:        consRow ? `${consRow.code} – ${consRow.company}` : (r.consignee_name ?? ''),
          bankName:         bankRow?.label ?? (r.bank_label ?? ''),
          currency:         r.currency ?? '',
          exchangeRate:     r.exchange_rate != null ? String(r.exchange_rate) : '',
          incoTerm:         r.inco_term ?? '',
          portOfLoading:    r.port_of_loading ?? '',
          portOfDischarge:  r.port_of_discharge ?? '',
          finalDestination: r.final_destination ?? '',
          originCountry:    r.origin_country ?? '',
          stateCode:        r.state_code ?? '',
          oppId:            r.opp_id ?? null,
          customerId:       r.customer_id ?? null,
          consigneeId:      r.consignee_id ?? null,
          bankAccountId:    r.bank_account_id ?? null,
        });

        const items = Array.isArray(r.items) ? r.items : [];
        setProducts(items.map((it: any, i: number) => ({
          id:        Date.now() + i,
          productId: it.product_id ?? null,
          hsn:       it.hsn_code ?? null,
          name:      it.product_name ?? '',
          qty:       Number(it.quantity ?? 0),
          rate:      Number(it.rate ?? 0),
          taxPct:    Number(it.tax_pct ?? 0),
        })));
        setTerms(r.terms ?? '');
        setShipping(Number(r.shipping ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load this PI for editing.'))
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [editId, isEdit, masters.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // POST (create) → /sales/proforma-invoices  •  PUT (update) → /sales/proforma-invoices/{id}.
  // If `source` is set on create (Convert flow), we link via source_quotation_id
  // and the backend flips the source quotation's status to converted_to_pi.
  const submitPi = async () => {
    if (saving) return;
    if (!form.customerId) { toast.error('Customer required', 'Pick a customer before saving.'); return; }
    if (!form.consigneeId) { setStep1Errors(prev => new Set(prev).add('consignee')); setStep(1); toast.error('Consignee required', 'Select a consignee before saving.'); return; }
    if (products.length === 0) { toast.error('No products', 'Add at least one line item.'); return; }
    setSaving(true);
    try {
      const payload = {
        pi_type:             piType,
        source_quotation_id: source?.id ?? null,
        doc_type:            form.docType,
        opp_id:              form.oppId,
        customer_id:         form.customerId,
        consignee_id:        form.consigneeId,
        bank_account_id:     form.bankAccountId,
        currency:            form.currency || null,
        exchange_rate:       form.exchangeRate ? Number(form.exchangeRate) : null,
        inco_term:           form.incoTerm        || null,
        port_of_loading:     form.portOfLoading   || null,
        port_of_discharge:   form.portOfDischarge || null,
        final_destination:   form.finalDestination|| null,
        origin_country:      form.originCountry   || null,
        state_code:          form.stateCode       || null,
        shipping:            Number(shipping) || 0,
        terms:               terms || null,
        items: products.map(p => ({
          product_id:   p.productId,
          product_name: p.name,
          hsn_code:     p.hsn,
          quantity:     Number(p.qty),
          rate:         Number(p.rate),
          tax_pct:      Number(p.taxPct) || 0,
        })),
      };
      if (isEdit) {
        await api.put(`/sales/proforma-invoices/${editId}`, payload);
        toast.success('PI Updated', `${existingCode ?? 'PI'} saved.`);
      } else {
        await api.post('/sales/proforma-invoices', payload);
        toast.success('PI Created', source
          ? `Converted ${source.qtNo} → new draft PI`
          : 'Saved as draft for review');
      }
      // Map a newly-picked consignee back onto the lead (it had none).
      if (form.oppId && form.consigneeId && !initialOpp?.consigneeId) {
        try { await api.put(`/sales/leads/${form.oppId}`, { consignee_id: form.consigneeId }); }
        catch { /* non-fatal — the PI already carries the consignee */ }
      }
      onSubmit();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.message
        ?? (data?.errors ? Object.values(data.errors).flat().join(' ') : 'Could not save the PI.');
      toast.error('Save failed', String(msg));
    } finally {
      setSaving(false);
    }
  };

  const addProduct = () => {
    // Required-field validation with explicit feedback — the old silent
    // `return` left the user wondering why the Add button "did nothing".
    if (!draft.name) {
      toast.error('Product required', 'Please select a product from the dropdown first.');
      return;
    }
    if (!(draft.qty > 0)) {
      toast.error('Quantity required', 'Enter a quantity greater than 0.');
      return;
    }
    if (!(draft.rate > 0)) {
      toast.error('Rate required', 'Enter a product rate greater than 0.');
      return;
    }
    // Duplicate guard — the dropdown already filters out added products,
    // so this is a backstop for free-text rows or race conditions. By
    // productId for master-picked rows, by name as a fallback for
    // free-text rows.
    const dup = draft.productId
      ? products.some(p => p.productId === draft.productId)
      : products.some(p => p.name === draft.name);
    if (dup) {
      toast.error('Already added', `${draft.name} is already in the list. Remove it first to change quantity or rate.`);
      return;
    }
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => setProducts(p => p.filter(x => x.id !== id));

  const subTotal = products.reduce((s, p) => s + calcRow(p).amount, 0);
  const grandTotal = subTotal + (Number(shipping) || 0);

  return (
    /* Backdrop is purely visual — closing only via the X / Cancel button
     * so accidental outside-clicks don't wipe an in-progress quote. */
    <div className="qpi-modal-backdrop">
      {/* Same scope CSS injection as the Quotation modal — keeps the PI
       * modal styled regardless of where it's mounted. */}
      <style>{SCOPED_CSS}</style>
      <div className="qpi-modal qpi-modal-purple">
        {/* Header (purple) — title + pills reflect create vs edit mode. */}
        <div className="qpi-modal-head qpi-modal-head-purple">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">
                {isEdit ? 'Edit Proforma Invoice (PI)' : 'Create Proforma Invoice (PI)'}
                {hydrating && <span style={{ marginLeft: 10, fontSize: 11, opacity: .8 }}>Loading…</span>}
              </div>
              <div className="qpi-modal-sub">
                {isEdit
                  ? 'Update the PI details below — saving overwrites the existing record.'
                  : 'Fill in the details to generate a new proforma invoice'}
              </div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI No</span>
              <span className="qpi-modal-pill-value">{existingCode ?? previewCode ?? 'Auto-assigned'}</span>
            </div>
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI Date</span>
              <span className="qpi-modal-pill-value">{existingDate ?? new Date().toLocaleDateString('en-GB')}</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        {/* Stepper */}
        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic PI Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="purple" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="purple" />
        </div>

        {/* Body */}
        <div className="qpi-modal-body">
          {step === 1 && (
            hydrating ? <BasicFormSkeleton theme="purple" /> : (
            <BasicForm
              form={form} setForm={setForm}
              masters={masters} theme="purple"
              titleLabel="Basic PI Details" partyKind="PI"
              /* All Step-1 fields stay editable when going back from Step 2
                 (the post-Step-2 core lock was removed). Lead-opened (initialOpp)
                 and edit-mode locks still apply. */
              lockParty={!!initialOpp || isEdit}
              lockConsignee={isEdit || !!initialOpp?.consigneeId}
              lockDocType={isEdit}
              errors={step1Errors}
              clearError={(k) => setStep1Errors(prev => {
                if (!prev.has(k)) return prev;
                const next = new Set(prev); next.delete(k); return next;
              })}
            />
            )
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="purple"
              titleLabel="PI"
              productOptions={masters.products}
              productsRaw={masters.productsRaw}
              loadingProducts={masters.loading}
            />
          )}
        </div>

        {/* Footer */}
        <div className="qpi-modal-foot">
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button className="qpi-btn-next qpi-btn-next-purple" onClick={onSaveNext} disabled={hydrating}>
                Save &amp; Next →
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-purple" onClick={submitPi} disabled={products.length === 0 || saving || hydrating}>
                {saving
                  ? (isEdit ? 'Updating…' : 'Saving…')
                  : (isEdit ? '✓ Update PI' : '✓ Submit PI')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Step badge (1 or 2) ─── */
function StepBadge(props: { n: number; title: string; subtitle: string; state: 'idle' | 'active' | 'done'; theme: 'teal' | 'purple' }) {
  const { n, title, subtitle, state, theme } = props;
  return (
    <div className={`qpi-step-badge qpi-step-${state} qpi-step-${theme}`}>
      <div className="qpi-step-badge-num">
        {state === 'done' ? <IconCheck /> : n}
      </div>
      <div>
        <div className="qpi-step-badge-title">{title}</div>
        <div className="qpi-step-badge-sub">{subtitle}</div>
      </div>
    </div>
  );
}

/* ─── Basic form skeleton — shown while an Edit modal hydrates the
 *      record from the server, so the user sees a shimmer instead of a
 *      momentarily-empty form (which read as "the saved values are
 *      missing"). Mirrors the 3-column field grid + note. */
function BasicFormSkeleton({ theme }: { theme: 'teal' | 'purple' }) {
  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>BASIC DETAILS</div>
      <div className="qpi-form-grid">
        {Array.from({ length: 13 }).map((_, i) => (
          <div className="qpi-field" key={i}>
            <span className="qpi-skel qpi-skel-label" />
            <span className="qpi-skel qpi-skel-input" />
          </div>
        ))}
      </div>
      <div className="qpi-skel qpi-skel-note" />
    </>
  );
}

/* ─── Opportunity picker — async, server-paginated + globally searchable.
 *  Replaces the static 50-row MasterSelect: it fetches /sales/leads one
 *  page at a time, appends the next page when the list is scrolled to the
 *  bottom (infinite scroll), and routes the search box to the server's
 *  full-table `search` so a query matches EVERY lead, not just the loaded
 *  page. `customerId` (when a customer is picked) narrows the list
 *  server-side via the leads `customer_id` filter. onPick hands the parent
 *  the fully-mapped LeadRow so the cascade (customer/consignee/currency)
 *  works without a second lookup. */
function OpportunitySelect({
  value, customerId, disabled, excludeWithPi, onPick,
}: {
  value: string;
  customerId: number | null;
  disabled?: boolean;
  /* When true (Create Quotation), opportunities that already have a Proforma
   * Invoice are hidden — a quotation can't be created against an opp with a PI. */
  excludeWithPi?: boolean;
  onPick: (oppValue: string, row: LeadRow | null) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [items, setItems]     = useState<Array<{ value: string; label: string; row: LeadRow }>>([]);
  const [page, setPage]       = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  const [dropDir, setDropDir]     = useState<'up' | 'down'>('down');

  // Map an API lead row → option + LeadRow (identical shape to the static
  // masters loader so the parent cascade reads the same fields).
  const mapLead = (r: any): { value: string; label: string; row: LeadRow } | null => {
    const code = r.opp_code ?? r.opp_id ?? (r.id ? `OPP-${String(r.id).padStart(4, '0')}` : '');
    // Show the mapped customer's COMPANY name (not legal name) beside the
    // Opp ID. Falls back to the lead's sender/company only when the opp has
    // no customer mapped yet.
    const who  = (
      r.customer?.company_name
      || r.customer_company_name
      || r.sender_company
      || r.sender_name
      || r.company
      || ''
    ).toString();
    const label = code && who ? `${code} – ${who}` : (code || who || '');
    if (!label) return null;
    const dateSrc = r.query_time ?? r.created_at;
    const row: LeadRow = {
      leadId:         Number(r.id ?? 0),
      opp_code:       code,
      sender_company: who,
      sender_country: r.sender_country_iso ?? r.sender_country ?? '',
      date:           dateSrc ? new Date(dateSrc).toLocaleDateString('en-GB') : '',
      customerDbId:   r.customer_id != null ? Number(r.customer_id) : (r.customer?.id != null ? Number(r.customer.id) : null),
      consigneeDbId:  r.consignee_id != null ? Number(r.consignee_id) : (r.consignee?.id != null ? Number(r.consignee.id) : null),
      currency:       r.currency ?? r.quote_currency ?? null,
    };
    return { value: label, label, row };
  };

  const fetchPage = useCallback(async (pageNum: number, q: string, replace: boolean) => {
    setLoading(true);
    try {
      const res = await api.get<any>('/sales/leads', {
        params: {
          page: pageNum, per_page: 50, with_counts: 0,
          search:      q.trim() || undefined,
          customer_id: customerId || undefined,
          // Only offer opportunities whose Stage 2 (Lead Acknowledgement) is
          // complete — i.e. the lead is QUALIFIED. Opps that haven't cleared
          // Stage 2 are hidden regardless of any later progress (price shared,
          // etc.). The customer_id filter (when set) stacks on top.
          lead_ack_complete: 1,
          // Create Quotation: hide opps that already have a Proforma Invoice.
          exclude_with_pi: excludeWithPi ? 1 : undefined,
        },
      });
      const rows   = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped = rows.map(mapLead).filter(Boolean) as Array<{ value: string; label: string; row: LeadRow }>;
      setItems(prev => (replace ? mapped : [...prev, ...mapped]));
      const lastPage = res.data?.pagination?.last_page ?? null;
      setHasMore(lastPage != null ? pageNum < lastPage : mapped.length >= 50);
      setPage(pageNum);
    } catch {
      if (replace) setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [customerId, excludeWithPi]);

  // (Re)load page 1 on open and whenever the search text or customer
  // changes while open. Debounce typed searches so we don't fire per key.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void fetchPage(1, search, true); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, search, fetchPage]);
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  // Width + auto-flip, mirroring MasterSelect so the portalled menu lines up.
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setMenuWidth(rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropDir(spaceBelow < 280 && rect.top > spaceBelow ? 'up' : 'down');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  // Infinite scroll — append the next page as the list nears its bottom.
  const onScroll = () => {
    const el = listRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      void fetchPage(page + 1, search, false);
    }
  };

  return (
    <div ref={wrapRef}>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => { if (!disabled) setOpen(v => !v); }}
        direction={dropDir}
        className={`master-select-wrap${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle tag="button" type="button" disabled={disabled} className="master-select-toggle">
          {value
            ? <span className="master-select-value">{value}</span>
            : <span className="master-select-placeholder">— Select Opportunity —</span>}
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        <DropdownMenu
          className="master-select-menu"
          container="body"
          strategy="fixed"
          style={menuWidth ? { width: menuWidth, minWidth: menuWidth } : undefined}
        >
          <div className="master-select-search" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <i className="ri-search-line master-select-search-icon" />
            <input
              type="text"
              className="master-select-search-input"
              placeholder="Search opportunities…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="master-select-list" ref={listRef} onScroll={onScroll} style={{ maxHeight: 220, overflowY: 'auto' }}>
            {items.length === 0 && !loading ? (
              <div className="master-select-empty">{search ? 'No results' : 'No opportunities'}</div>
            ) : (
              <>
                {items.map(opt => (
                  <DropdownItem
                    key={opt.row.leadId}
                    active={opt.value === value}
                    onClick={() => onPick(opt.value, opt.row)}
                    className="master-select-item"
                  >
                    {opt.label}
                  </DropdownItem>
                ))}
                {loading && <div className="master-select-empty">Loading…</div>}
                {!loading && !hasMore && items.length > 0 && (
                  <div className="master-select-empty" style={{ fontSize: 10.5, opacity: 0.55 }}>— End of list —</div>
                )}
              </>
            )}
          </div>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}

/* ─── Basic form (Step 1) ─── */
function BasicForm(props: {
  form: BasicFormState; setForm: (f: BasicFormState) => void;
  masters: LoadedMasters;
  theme: 'teal' | 'purple'; titleLabel: string; partyKind: 'Quotation' | 'PI';
  /* Validation error keys for the required-field highlight. Parent owns
   * the Set; we read it to add `.has-error` and call `clearError` when
   * the user provides a value so the red border disappears immediately
   * (without waiting for the next Save & Next click). */
  errors?: Set<string>;
  clearError?: (k: string) => void;
  /* When the modal was opened from a Sales Matrix lead, the lead already
   * fixes the Opportunity + its mapped Customer & Consignee — those four
   * fields render read-only so they can't drift away from the lead. */
  lockParty?: boolean;
  /* Lock ONLY the Consignee field. When the lead this was opened from has a
   * consignee mapped it's read-only (like the customer); when the lead has
   * NO consignee, this is false so the user can pick one here — and the
   * parent maps that choice back onto the lead on save. */
  lockConsignee?: boolean;
  /* Lock the Document Type (e.g. when EDITING a PI) — changing
   * International/Domestic on an existing doc would break its tax/costing
   * structure, so it renders read-only. */
  lockDocType?: boolean;
}) {
  const { form, setForm, masters, theme, partyKind, errors, clearError, lockParty, lockConsignee, lockDocType } = props;
  const hasError = (k: string) => errors?.has(k) ?? false;
  const set = <K extends keyof BasicFormState>(k: K, v: BasicFormState[K]) => {
    setForm({ ...form, [k]: v });
    // Clear the matching error key when the user fills the field.
    if (v && clearError) clearError(k as string);
  };

  // Helper — make sure the current value always renders even if the master
  // hasn't loaded yet (or the value comes from an older record that isn't
  // in the live master list anymore). Otherwise the MasterSelect shows blank.
  const withCurrent = (opts: MasterOpt[], value: string): MasterOpt[] =>
    value && !opts.find(o => o.value === value) ? [...opts, { value, label: value }] : opts;

  // ── Cascade logic ─────────────────────────────────────────────
  // Labels are deterministic: "{code} – {company}". We parse the label
  // back to a code so we can resolve the underlying numeric db_id.
  const labelCode = (label: string) => (label || '').split(' – ')[0]?.trim() ?? '';

  // Resolve the currently-selected customer row by parsing the label's
  // code prefix (e.g. "C-012 – GreenHarvest Global" → "C-012").
  const selectedCustomerRow = useMemo<CustomerRow | null>(() => {
    if (!form.customer) return null;
    const code = labelCode(form.customer);
    return masters.customersRaw.find(c => c.code === code) ?? null;
  }, [form.customer, masters.customersRaw]);

  // (Opportunity filtering now happens server-side inside OpportunitySelect
  // via the leads `customer_id` param + paginated fetch — the old client-side
  // `filteredOpportunities` memo over the static 50-row list was removed.)

  // Consignees filtered by selected customer — uses consignee.customer_id
  // (numeric FK) matching the customer's numeric dbId. STRICT: only the
  // consignees mapped to this customer are shown (whether the customer was
  // picked directly or auto-filled from an opportunity). When the customer
  // has none mapped, the list is empty and the field shows the
  // "No consignees for this customer" placeholder — we no longer fall back
  // to the full list, which used to leak every consignee.
  const filteredConsignees = useMemo(() => {
    if (!selectedCustomerRow) return masters.consignees;
    const matchValues = new Set(
      masters.consigneesRaw
        .filter(c => c.customerDbId === selectedCustomerRow.dbId)
        .map(c => `${c.code} – ${c.company}`)
    );
    return masters.consignees.filter(opt => matchValues.has(opt.value));
  }, [selectedCustomerRow, masters.consignees, masters.consigneesRaw]);

  // ── Auto-fill on Opportunity selection ────────────────────────
  // 1. Look up the lead row from the picked OPP code.
  // 2. Use lead.customerDbId → resolve the Customer master row → fill Customer.
  // 3. Use lead.consigneeDbId → resolve the Consignee master row → fill
  //    the EXACT consignee mapped on that lead.
  // 4. Auto-fill Opportunity Date and Origin Country from the lead.
  const onOpportunityChange = (oppValue: string, providedRow?: LeadRow | null) => {
    const code = labelCode(oppValue);
    // The async OpportunitySelect hands us the picked LeadRow directly (it
    // may not live in the static masters list when paginated). Fall back to
    // the masters lookup for any other caller.
    const row  = providedRow ?? masters.opportunitiesRaw.find(o => o.opp_code === code);
    if (!row) { setForm({ ...form, opportunity: oppValue, oppId: null }); return; }

    let nextCustomer  = form.customer;
    let nextConsignee = form.consignee;
    let nextCurrency  = form.currency;
    let nextCustomerId: number | null  = form.customerId;
    let nextConsigneeId: number | null = form.consigneeId;

    // Resolve the customer for this lead by numeric FK first, fall back
    // to company-name match for legacy/sync'd rows missing customer_id.
    const custRow = (row.customerDbId != null
      ? masters.customersRaw.find(c => c.dbId === row.customerDbId)
      : null)
      ?? masters.customersRaw.find(c =>
        c.company && row.sender_company &&
        c.company.trim().toLowerCase() === row.sender_company.trim().toLowerCase());

    if (custRow) {
      nextCustomer    = `${custRow.code} – ${custRow.company}`;
      nextCustomerId  = custRow.dbId;
      if (custRow.currency) nextCurrency = custRow.currency;
    }

    // Currency is driven by the opportunity's PRODUCTS (lead enforces a
    // single currency across its products), so the lead/opportunity currency
    // wins over the customer default. The Currency field is read-only and
    // simply reflects this.
    if (row.currency) nextCurrency = row.currency;

    // Consignee resolution priority:
    //  (a) If the lead itself has a consignee mapped, use it.
    //  (b) Otherwise, if the matched customer has exactly one consignee, pick it.
    //  (c) Multiple → leave blank for user to pick from the filtered dropdown.
    //  (d) 0 → blank.
    if (row.consigneeDbId != null) {
      const conRow = masters.consigneesRaw.find(c => c.dbId === row.consigneeDbId);
      if (conRow) {
        nextConsignee   = `${conRow.code} – ${conRow.company}`;
        nextConsigneeId = conRow.dbId;
      }
    } else if (custRow) {
      const mine = masters.consigneesRaw.filter(c => c.customerDbId === custRow.dbId);
      if (mine.length === 1) {
        nextConsignee   = `${mine[0].code} – ${mine[0].company}`;
        nextConsigneeId = mine[0].dbId;
      } else if (mine.length === 0) {
        nextConsignee   = '';
        nextConsigneeId = null;
      }
    }

    // Pull opp_id (numeric lead id) so the POST payload can include it.
    // The opportunities raw rows don't currently carry the lead.id —
    // resolve it by matching opp_code to the lead in masters loading.
    // For now we leave oppId in sync with the cascade's own knowledge.
    setForm({
      ...form,
      opportunity:     oppValue,
      opportunityDate: row.date || form.opportunityDate,
      customer:        nextCustomer,
      customerId:      nextCustomerId,
      consignee:       nextConsignee,
      consigneeId:     nextConsigneeId,
      currency:        nextCurrency,
      originCountry:   row.sender_country || form.originCountry,
      oppId:           row.leadId ?? form.oppId,
    });
  };

  // ── Auto-fill on Customer selection ──────────────────────────
  // 1. Currency from customer master if set.
  // 2. Clear Opportunity if it doesn't belong to this customer.
  // 3. Filter Consignees — auto-pick single, clear stale, keep if still valid.
  const onCustomerChange = (custValue: string) => {
    const cust = masters.customersRaw.find(c => c.code === labelCode(custValue));
    let nextOpportunity = form.opportunity;
    let nextConsignee   = form.consignee;
    let nextCurrency    = form.currency;
    let nextOppId: number | null       = form.oppId;
    let nextConsigneeId: number | null = form.consigneeId;

    if (cust) {
      if (cust.currency) nextCurrency = cust.currency;

      // Clear opportunity only when the currently-selected opportunity
      // exists in the master list and does not belong to this customer.
      const oppRow = masters.opportunitiesRaw.find(o => o.opp_code === labelCode(form.opportunity));
      const oppMatches = oppRow && (
        oppRow.customerDbId === cust.dbId ||
        (oppRow.sender_company && oppRow.sender_company.trim().toLowerCase() === cust.company.trim().toLowerCase())
      );
      if (oppRow && !oppMatches) { nextOpportunity = ''; nextOppId = null; }

      // Filter consignees by numeric FK — auto-pick if exactly one,
      // clear if the current selection no longer belongs to this customer.
      const mine = masters.consigneesRaw.filter(c => c.customerDbId === cust.dbId);
      const stillValid = mine.find(c => `${c.code} – ${c.company}` === form.consignee);
      if (mine.length === 1) {
        nextConsignee   = `${mine[0].code} – ${mine[0].company}`;
        nextConsigneeId = mine[0].dbId;
      } else if (!stillValid) {
        nextConsignee   = '';
        nextConsigneeId = null;
      } else {
        nextConsigneeId = stillValid.dbId;
      }
    }

    setForm({
      ...form,
      customer:    custValue,
      customerId:  cust?.dbId ?? null,
      opportunity: nextOpportunity,
      oppId:       nextOppId,
      consignee:   nextConsignee,
      consigneeId: nextConsigneeId,
      currency:    nextCurrency,
    });
  };

  // Direct (non-cascade) onChange wrappers for fields that still need
  // to capture an FK id alongside the display label.
  const onConsigneeChange = (v: string) => {
    const c = masters.consigneesRaw.find(c => `${c.code} – ${c.company}` === v);
    setForm({ ...form, consignee: v, consigneeId: c?.dbId ?? null });
  };
  const onBankChange = (v: string) => {
    const b = masters.banksRaw.find(b => b.label === v);
    setForm({ ...form, bankName: v, bankAccountId: b?.dbId ?? null });
  };

  // Currency is owned by the opportunity's PRODUCTS (the lead enforces one
  // currency across them). Whenever an opportunity is active — whether the
  // user picks it here or it's pre-selected when the modal opens from Stage 5
  // — fetch the product currency and reflect it in the read-only field.
  useEffect(() => {
    if (!form.oppId) return;
    let cancelled = false;
    api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/products`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.data) ? data.data : [];
        const ccy = rows.map((r: any) => r.currency).find((c: any) => c);
        if (ccy) setForm((f) => ({ ...f, currency: ccy }));
      })
      .catch(() => { /* leave currency as-is on failure */ });
    return () => { cancelled = true; };
  }, [form.oppId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>BASIC {partyKind === 'PI' ? 'PI' : 'QUOTATION'} DETAILS</div>

      <div className="qpi-form-grid">
        <Field label="Document Type" required>
          {lockDocType ? (
            <input className="qpi-input qpi-input-readonly" value={form.docType} readOnly
              title="Document Type can't be changed when editing — create a new document to switch International / Domestic." />
          ) : (
          <MasterSelect
            value={form.docType}
            placeholder="— Select —"
            options={[{ value: 'International', label: 'International' }, { value: 'Domestic', label: 'Domestic' }]}
            onChange={(v) => set('docType', v)}
          />
          )}
        </Field>
        <Field label="Opportunity">
          {lockParty ? (
            <input className="qpi-input qpi-input-readonly" value={form.opportunity} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <OpportunitySelect
              value={form.opportunity}
              customerId={form.customerId}
              /* Hide opportunities that already have a PI — applies to BOTH the
                 Quotation and PI pickers (one PI per opp; no quoting after PI). */
              excludeWithPi
              onPick={(val, row) => onOpportunityChange(val, row)}
            />
          )}
        </Field>
        <Field label="Opportunity Date">
          <input className="qpi-input qpi-input-readonly" value={form.opportunityDate} readOnly />
        </Field>

        <Field label="Customer" required error={hasError('customer')}>
          {lockParty ? (
            <input className="qpi-input qpi-input-readonly" value={form.customer} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <MasterSelect
              key={`cust-${masters.customers.length}`}
              value={form.customer}
              loading={masters.loading}
              placeholder="— Select Customer —"
              options={withCurrent(masters.customers, form.customer)}
              onChange={(v) => { onCustomerChange(v); if (v) clearError?.('customer'); }}
            />
          )}
        </Field>
        <Field label="Consignee" required error={hasError('consignee')}>
          {lockConsignee ? (
            <input className="qpi-input qpi-input-readonly" value={form.consignee} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <MasterSelect
              key={`cons-${filteredConsignees.length}-${form.customer}`}
              value={form.consignee}
              loading={masters.loading}
              placeholder={form.customer
                ? (filteredConsignees.length === 0
                    ? 'No consignees for this customer'
                    : '— Select Consignee —')
                : '— Select Consignee —'}
              options={withCurrent(filteredConsignees, form.consignee)}
              onChange={(v) => { onConsigneeChange(v); if (v) clearError?.('consignee'); }}
            />
          )}
        </Field>
        <Field label="Bank Name" required error={hasError('bankName')}>
          <MasterSelect
            key={`bank-${masters.banks.length}`}
            value={form.bankName}
            loading={masters.loading}
            placeholder="— Select Bank —"
            options={withCurrent(masters.banks, form.bankName)}
            onChange={(v) => { onBankChange(v); if (v) clearError?.('bankName'); }}
          />
        </Field>

        {form.docType === 'Domestic' ? (
          /* ── Domestic-only field — replaces the international shipping
             block (Currency / Exchange Rate / INCO / Ports / Origin)
             with a single State Code dropdown sourced from the State
             Codes master. */
          <Field label="State Code" required error={hasError('stateCode')}>
            <MasterSelect
              key={`st-${masters.states.length}`}
              value={form.stateCode}
              loading={masters.loading}
              placeholder="— Select State —"
              options={withCurrent(masters.states, form.stateCode)}
              onChange={(v) => set('stateCode', v)}
            />
          </Field>
        ) : (
          <>
            {/* Currency:
                 • With an Opportunity → driven by the opp's products (the lead
                   enforces one currency across its products), so it stays
                   read-only here to avoid drifting from the product pricing.
                 • Direct customer (no Opportunity) → there are no opp products
                   to source from, so the user picks the currency from the
                   Currencies master dropdown. */}
            <Field label="Currency" required>
              {form.opportunity ? (
                <input
                  className="qpi-input qpi-input-readonly"
                  value={form.currency || ''}
                  readOnly
                  placeholder="Auto — from the opportunity's products"
                  title="Currency is taken from the opportunity's products and cannot be changed here."
                  style={{ cursor: 'not-allowed' }}
                />
              ) : (
                <MasterSelect
                  key={`cur-${masters.currencies.length}`}
                  value={form.currency}
                  loading={masters.loading}
                  placeholder="— Select Currency —"
                  options={withCurrent(masters.currencies, form.currency)}
                  onChange={(v) => set('currency', v)}
                />
              )}
            </Field>
            <Field label="Exchange Rate">
              <input
                className="qpi-input"
                placeholder="Enter exchange rate"
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => {
                  // Allow only digits and a single decimal point — no letters/symbols.
                  let v = e.target.value.replace(/[^0-9.]/g, '');
                  const dot = v.indexOf('.');
                  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
                  set('exchangeRate', v);
                }}
              />
            </Field>
            <Field label="INCO Term" required error={hasError('incoTerm')}>
              <MasterSelect
                key={`inco-${masters.incoterms.length}`}
                value={form.incoTerm}
                loading={masters.loading}
                placeholder="— Select INCO Term —"
                options={withCurrent(masters.incoterms, form.incoTerm)}
                onChange={(v) => set('incoTerm', v)}
              />
            </Field>

            <Field label="Port of Loading" required error={hasError('portOfLoading')}>
              <MasterSelect
                key={`pol-${masters.ports.length}`}
                value={form.portOfLoading}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.ports, form.portOfLoading)}
                onChange={(v) => set('portOfLoading', v)}
              />
            </Field>
            <Field label="Port of Discharge" required error={hasError('portOfDischarge')}>
              <MasterSelect
                key={`pod-${masters.ports.length}`}
                value={form.portOfDischarge}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.ports, form.portOfDischarge)}
                onChange={(v) => set('portOfDischarge', v)}
              />
            </Field>
            <Field label="Final Destination" required error={hasError('finalDestination')}>
              <input
                className="qpi-input"
                placeholder="Enter final destination"
                maxLength={100}
                value={form.finalDestination}
                /* Auto-capitalise the first letter (e.g. "pune" → "Pune"). */
                onChange={(e) => { const v = e.target.value; set('finalDestination', v.charAt(0).toUpperCase() + v.slice(1)); }}
              />
            </Field>

            <Field label="Origin Country" required error={hasError('originCountry')}>
              <MasterSelect
                key={`oc-${masters.countries.length}`}
                value={form.originCountry}
                loading={masters.loading}
                placeholder="— Select Country —"
                options={withCurrent(masters.countries, form.originCountry)}
                onChange={(v) => set('originCountry', v)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={`qpi-note qpi-note-${theme}`}>
        <span className="qpi-note-icon"><IconWarn /></span>
        <div className="qpi-note-body">
          <div className="qpi-note-line"><strong>Note</strong></div>
          <div className="qpi-note-line">
            <strong>Without Opportunity:</strong> You can create a general {partyKind === 'PI' ? 'PI' : 'quotation'} by directly selecting the customer; ensure the customer is fully created in the system. You do not need to select an Opportunity.
          </div>
          <div className="qpi-note-line">
            <strong>With Opportunity:</strong> Customer and Consignee must be mapped to the selected Opportunity (mandatory).
          </div>
        </div>
      </div>
    </>
  );
}

function Field(props: { label: string; required?: boolean; error?: boolean; children: React.ReactNode }) {
  return (
    <div className={`qpi-field${props.error ? ' has-error' : ''}`}>
      <label className="qpi-field-label">
        {props.label}
        {props.required && <span className="qpi-req-star"> *</span>}
      </label>
      {props.children}
      {props.error && (
        <span className="qpi-field-error-msg">This field is required</span>
      )}
    </div>
  );
}

/* ─── Products step (Step 2) ─── */
function ProductsStep(props: {
  form: BasicFormState;
  products: ProductRow[];
  setProducts: (p: ProductRow[]) => void;
  removeProduct: (id: number) => void;
  draft: ProductRow; setDraft: (d: ProductRow) => void;
  addProduct: () => void;
  terms: string; setTerms: (s: string) => void;
  shipping: number; setShipping: (n: number) => void;
  subTotal: number; grandTotal: number;
  theme: 'teal' | 'purple';
  titleLabel: string;
  // Products master from useQpiMasters — drives the line-item dropdown.
  productOptions: MasterOpt[];
  productsRaw:    ProductMasterRow[];
  loadingProducts: boolean;
}) {
  const { form, products, removeProduct, draft, setDraft, addProduct, terms, setTerms, shipping, setShipping, subTotal, grandTotal, theme,
          productOptions, productsRaw, loadingProducts } = props;

  // Per-opportunity product filter. When the user picks an Opportunity
  // on Step 1, the Product Directory mapping (lead_products) tells us
  // which products that opportunity is actively quoting for — narrow
  // the Step 2 dropdown to just those products + a target price/qty
  // we can auto-fill into the line. When no opportunity is selected
  // (general quotation), allow the full Products master.
  const [allowedProductIds, setAllowedProductIds] = useState<Set<number> | null>(null);
  const [leadPriceMap, setLeadPriceMap] = useState<Map<number, { rate: number; qty: number }>>(new Map());
  // Latest quoted price per product (from Stage 4 "Price Shared"). This is the
  // most recently shared price the customer was quoted — it takes priority over
  // the Product Directory's target_price when auto-filling the rate on pick.
  const [latestQuotedMap, setLatestQuotedMap] = useState<Map<number, number>>(new Map());
  const [loadingLeadProducts, setLoadingLeadProducts] = useState(false);

  useEffect(() => {
    // No opportunity → show all master products.
    if (!form.oppId) {
      setAllowedProductIds(null);
      setLeadPriceMap(new Map());
      setLatestQuotedMap(new Map());
      return;
    }
    let cancelled = false;
    setLoadingLeadProducts(true);
    Promise.all([
      api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/products`),
      // Shared prices come back ordered by shared_at DESC, so the FIRST row per
      // product_id is its latest quoted price. Best-effort — a lead with no
      // Stage-4 shares just falls back to target_price.
      api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/shared-prices`)
        .catch(() => ({ data: { data: [] } })),
    ])
      .then(([prodRes, sharedRes]) => {
        if (cancelled) return;
        const rows = Array.isArray(prodRes.data?.data) ? prodRes.data.data : [];
        const ids = new Set<number>();
        const priceMap = new Map<number, { rate: number; qty: number }>();
        rows.forEach((r) => {
          const pid = Number(r.product_id ?? 0);
          if (!pid) return;
          ids.add(pid);
          priceMap.set(pid, {
            rate: Number(r.target_price ?? 0),
            qty:  Number(r.quantity     ?? 0),
          });
        });
        const sharedRows = Array.isArray(sharedRes.data?.data) ? sharedRes.data.data : [];
        const quotedMap = new Map<number, number>();
        const quotedIds = new Set<number>();
        sharedRows.forEach((s) => {
          const pid = Number(s.product_id ?? 0);
          const price = Number(s.quoted_price ?? 0);
          // First row per product wins (rows are shared_at DESC = newest first).
          if (pid && price > 0 && !quotedMap.has(pid)) quotedMap.set(pid, price);
          if (pid) quotedIds.add(pid);
        });
        // Product list = the lead's LATEST QUOTED PRICE list (the same products
        // shown in the "Latest Quoted Price Summary" popup, from the
        // /shared-prices API). Fall back to the Product Directory mapping only
        // when the lead has no shared prices yet, so it's never empty.
        setAllowedProductIds(quotedIds.size > 0 ? quotedIds : ids);
        setLeadPriceMap(priceMap);
        setLatestQuotedMap(quotedMap);
      })
      .catch(() => {
        // On error, fall back to the full master so the user is never
        // blocked from quoting — just lose the per-opp narrowing.
        if (!cancelled) { setAllowedProductIds(null); setLeadPriceMap(new Map()); setLatestQuotedMap(new Map()); }
      })
      .finally(() => { if (!cancelled) setLoadingLeadProducts(false); });
    return () => { cancelled = true; };
  }, [form.oppId]);

  // Narrowed dropdown — keeps the source of truth + lookup mapping in
  // sync without re-fetching the master.
  // Two filters stack:
  //   1) Lead-product restriction (when an opportunity is picked, only
  //      products mapped to that opp are pickable).
  //   2) Hide products already added to this quotation/PI so the user
  //      can't add the same line twice. To change qty/rate on an
  //      existing line, the user must remove it first — then the
  //      product reappears in the dropdown.
  const visibleProductOptions = useMemo(() => {
    let opts = productOptions;

    /* When an opportunity is selected, restrict to its Product Directory
     * mapping — even when that mapping is empty (show nothing, prompting
     * the user to add products to the directory first) rather than
     * leaking the full master. `allowedProductIds === null` means "no
     * opportunity / fetch failed" → keep the full master as a safe
     * fallback so general quotations aren't blocked. */
    if (allowedProductIds) {
      const allowedLabels = new Set(
        productsRaw.filter(p => allowedProductIds.has(p.dbId))
                   .map(p => `${p.code} – ${p.name}`)
      );
      opts = opts.filter(o => allowedLabels.has(o.value));
    }

    // Build a set of already-added productIds (skip free-text rows that
    // have no productId, otherwise we'd over-filter).
    const addedIds = new Set(
      products.map(p => p.productId).filter((id): id is number => id != null)
    );
    if (addedIds.size > 0) {
      opts = opts.filter(o => {
        const code = (o.value || '').split(' – ')[0]?.trim() ?? '';
        const master = productsRaw.find(pr => pr.code === code);
        // Keep options without a master match (free-text edge case) and
        // those whose productId is NOT already in the list.
        return !master || !addedIds.has(master.dbId);
      });
    }

    return opts;
  }, [allowedProductIds, productOptions, productsRaw, products]);

  /* No selectable products left to add (every mapped product is already in the
   * list, or none are mapped) → the whole "add product" draft row is hidden. */
  const noMoreProducts = !loadingProducts && !loadingLeadProducts && visibleProductOptions.length === 0;

  // On product selection, auto-fill hsn + (qty/rate/tax) from masters.
  // Priority for rate: latest QUOTED price (Stage 4) > lead-product
  //   target_price > product master base_price.
  // Priority for qty:  lead-product quantity (Product Directory) > draft qty.
  // Tax: product master taxPct. Never overwrite a value the user has typed.
  // International documents are tax-free → Tax % is locked at 0%; Domestic is
  // free-entry. Drives the draft tax input + the value used when adding a line.
  const isIntl = form.docType === 'International';
  const onProductPick = (label: string) => {
    const code = (label || '').split(' – ')[0]?.trim() ?? '';
    const p = productsRaw.find(pr => pr.code === code);
    if (!p) {
      setDraft({ ...draft, name: label, productId: null, hsn: null });
      return;
    }
    const leadPrice = leadPriceMap.get(p.dbId);
    const latestQuoted = latestQuotedMap.get(p.dbId);
    setDraft({
      ...draft,
      name:      `${p.code} – ${p.name}`,
      productId: p.dbId,
      hsn:       p.hsn,
      qty:    draft.qty    > 0 ? draft.qty    : (leadPrice?.qty  ?? draft.qty),
      rate:   draft.rate   > 0 ? draft.rate   : (latestQuoted ?? leadPrice?.rate ?? p.rate),
      taxPct: isIntl ? 0 : (draft.taxPct > 0 ? draft.taxPct : p.taxPct),
    });
  };

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>ORDER SUMMARY</div>

      {/* Read-only mirror of Step 1 data — splits the "CODE – NAME"
          dropdown labels into separate ID + Name pills where applicable
          and shows the raw value (no false "OPP-001" placeholder) when
          the field is empty. International-only fields are skipped on
          Domestic and vice-versa so the summary matches what the user
          actually filled. */}
      <div className={`qpi-order-summary qpi-order-summary-${theme}`}>



      {/* test */}
        <SummaryItem label="Opportunity ID"    value={(form.opportunity.split(' – ')[0] || form.opportunity)} />
        <SummaryItem label="Opportunity Date"  value={form.opportunityDate} />
        <SummaryItem label="Customer ID"       value={form.customer.split(' – ')[0] || ''} />
        <SummaryItem label="Customer Name"     value={form.customer.split(' – ')[1] || form.customer} />
        <SummaryItem label="Consignee ID"      value={form.consignee.split(' – ')[0] || ''} />
        <SummaryItem label="Consignee Name"    value={form.consignee.split(' – ')[1] || form.consignee} />
        <SummaryItem label="Document Type"     value={form.docType} />
        <SummaryItem label="Bank Name"         value={form.bankName} />
        {/* International-only commercial + shipping fields. Domestic
            collects none of these (only a State Code), so the readonly
            summary mirrors exactly what Step 1 captured. */}
        {form.docType === 'International' ? (
          <>
            <SummaryItem label="Currency"          value={form.currency} />
            <SummaryItem label="Exchange Rate"     value={form.exchangeRate} />
            <SummaryItem label="INCO Term"         value={form.incoTerm} />
            <SummaryItem label="Port of Loading"   value={form.portOfLoading} />
            <SummaryItem label="Port of Discharge" value={form.portOfDischarge} />
            <SummaryItem label="Final Destination" value={form.finalDestination} />
            <SummaryItem label="Origin Country"    value={form.originCountry} />
          </>
        ) : (
          <SummaryItem label="State Code" value={form.stateCode} />
        )}
      </div>

      {products.length === 0 && (
        <div className="qpi-product-warn">
          <span className="qpi-product-warn-icon"><IconWarn /></span>
          At least 1 product is required to proceed
        </div>
      )}

      <div className="qpi-products-wrap">
        <table className={`qpi-products-table qpi-pt-${theme}`}>
          {/* Product Name is the dominant column (matches the figma); the
              numeric columns are sized just wide enough for their inputs. */}
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Qty</th>
              <th>Product Rate</th>
              <th>Tax %</th>
              <th>Tax Amount</th>
              <th>Rate with Tax</th>
              <th>Amount</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const c = calcRow(p);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.qty}</td>
                  <td>{p.rate.toFixed(2)}</td>
                  <td>{p.taxPct}</td>
                  <td>{c.taxAmt.toFixed(2)}</td>
                  <td>{c.rateWithTax.toFixed(2)}</td>
                  <td className="qpi-amt">{c.amount.toFixed(2)}</td>
                  <td>
                    <Tooltip label="Remove product">
                      <button className="qpi-prod-remove" onClick={() => removeProduct(p.id)} aria-label="Remove product"><IconTrash /></button>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
            {/* Add-product draft row — hidden entirely once there are no more
                products to add (all mapped products already in the list, or
                none mapped to the opportunity). */}
            {!noMoreProducts && (
            <tr className="qpi-products-input-row">
              <td>
                <MasterSelect
                  key={`prod-${visibleProductOptions.length}-${form.oppId ?? 'all'}`}
                  value={draft.name}
                  placeholder={
                    loadingProducts || loadingLeadProducts
                      ? 'Loading products…'
                      : (form.oppId && visibleProductOptions.length === 0
                          ? 'No products mapped to this opportunity'
                          : '— Select Product —')
                  }
                  options={draft.name && !visibleProductOptions.find(o => o.value === draft.name)
                    ? [...visibleProductOptions, { value: draft.name, label: draft.name }]
                    : visibleProductOptions}
                  onChange={onProductPick}
                />
              </td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.qty || ''} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })} /></td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.rate || ''} onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })} /></td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0"
                disabled={isIntl}
                placeholder="0"
                title={isIntl ? 'International documents are tax-free — Tax % is locked at 0%.' : undefined}
                /* Show empty (not "0") when zero so typing replaces it instead of
                 * leaving a leading zero like "012". International stays a fixed 0. */
                value={isIntl ? 0 : (draft.taxPct || '')}
                onChange={(e) => setDraft({ ...draft, taxPct: Number(e.target.value) })} /></td>
              {/* Computed columns — read-only boxes that fill live from qty ×
                  rate × tax once both qty and rate are entered (not editable). */}
              {(() => {
                const dc = calcRow(draft);
                const has = draft.qty > 0 && draft.rate > 0;
                /* Computed columns are read-only — styled as disabled (grey)
                   boxes and showing 0.00 (not a dash) until qty × rate fill. */
                const cell = (val: number) => (
                  <td><input className="qpi-input qpi-input-num qpi-input-readonly" type="text" readOnly tabIndex={-1}
                    value={has ? val.toFixed(2) : '0.00'} /></td>
                );
                return <>{cell(dc.taxAmt)}{cell(dc.rateWithTax)}{cell(dc.amount)}</>;
              })()}
              <td>
                <button className={`qpi-prod-add qpi-prod-add-${theme}`} onClick={addProduct}>
                  <IconPlus /> Add
                </button>
              </td>
            </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qpi-totals-row">
        <div className="qpi-terms">
          <div className={`qpi-form-heading qpi-form-heading-${theme}`}>TERMS &amp; CONDITIONS</div>
          <textarea
            className="qpi-textarea"
            placeholder="Enter terms and conditions..."
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </div>

        <div className={`qpi-summary qpi-summary-${theme}`}>
          <div className="qpi-summary-heading">SUMMARY</div>
          <div className="qpi-summary-line">
            <span>Sub Total</span>
            <span className="qpi-summary-val">{subTotal.toFixed(2)}</span>
          </div>
          <div className="qpi-summary-line">
            <span>Shipping Cost</span>
            <input
              className="qpi-input qpi-summary-input"
              type="number" min="0"
              placeholder="0"
              /* Right-aligned so the value lines up under Sub Total / Grand
               * Total; inline style guarantees it over any base .qpi-input rule. */
              style={{ textAlign: 'right' }}
              /* Show empty (not a literal "0") when zero, so typing replaces it
               * instead of leaving a leading zero like "05". Empty = 0. */
              value={shipping || ''}
              onChange={(e) => setShipping(Number(e.target.value))}
            />
          </div>
          <div className="qpi-summary-grand">
            <span>GRAND TOTAL</span>
            <span className="qpi-summary-val">{grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryItem(props: { label: string; value: string }) {
  const val = props.value || '—';
  return (
    <div className="qpi-summary-item">
      <div className="qpi-summary-item-label">{props.label}</div>
      {/* Single line — long values (e.g. a bank's full legal name) truncate
          with an ellipsis and expose the full text on hover. */}
      <div className="qpi-summary-item-value" title={val}>{val}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Icons (inline SVG, Lucide-style stroke)
 * ════════════════════════════════════════════════════════════════════════ */

const IconUsers = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconBellSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const IconFile = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconFileSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconMonitor = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const IconShip = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l9-5 9 5" /><path d="M5 21l1.5-4h11L19 21" /><path d="M12 7v5" /><path d="M9 7h6" />
  </svg>
);
const IconChevronUpThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 14 12 9 17 14" />
  </svg>
);
const IconChevronDownThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 10 12 15 17 10" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconChevronLeft = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconMail = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);
const IconEdit = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);
const IconKebab = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
  </svg>
);
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconRepeatSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
/* Paper-plane glyph for the PI "Send for Sign" pill. White stroke since the
   pill has a coloured (sky/amber) background — matches IconCheck's treatment. */
const IconPaperPlaneSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);
const IconWarn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/* ════════════════════════════════════════════════════════════════════════════
 * Scoped CSS (all rules under .qpi-root or .qpi-modal-backdrop)
 * ════════════════════════════════════════════════════════════════════════ */

const SCOPED_CSS = `
/* Match the Customer Master root (.smc-root) — no own padding, no
 * negative margin trick, no full-viewport purple wash. The parent
 * layout container already provides the page gutters, so adding our
 * own caused the extra empty rim on the left/right edges. */
.qpi-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: transparent;
  padding: 0;
  margin: 0;
  color: var(--vz-body-color);
  display: flex; flex-direction: column; gap: 8px;
}
.qpi-root *, .qpi-root *::before, .qpi-root *::after { box-sizing: border-box; }

/* ─── Header strip ─── */
.qpi-header {
  /* Matches the Customer page hero (.smc-cstrip) exactly — same gradient
     ring (padding-box / border-box trick), height, shadow and glow — so
     both top-level Sales Matrix pages read as one design language. */
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px; min-height: 70px;
  border: 1px solid #c4b5fd; border-radius: 16px;
  background:
    linear-gradient(110deg, #faf7ff 0%, #f4eeff 45%, #efe8ff 75%, #ece4ff 100%) padding-box,
    linear-gradient(125deg, #7c3aed 0%, #8b5cf6 22%, #6366f1 48%, #d946ef 76%, #ec4899 100%) border-box;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.70) inset,
    0 4px 18px rgba(124,58,237,0.16),
    0 1px 4px rgba(99,102,241,0.10);
  font-family: 'DM Sans', system-ui, sans-serif;
}
.qpi-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(255,255,255,0.40) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(167,139,250,0.20) 0%, transparent 55%);
}
.qpi-header::after {
  content: ''; position: absolute; top: 0; left: 14px; right: 14px; height: 1.5px;
  border-radius: 2px; pointer-events: none; z-index: 3; opacity: 0.9; filter: blur(0.4px);
  background: linear-gradient(90deg,
    rgba(255,255,255,0) 0%, rgba(147,197,253,0.30) 14%, rgba(196,181,253,0.55) 30%,
    rgba(253,242,248,0.95) 50%, rgba(232,193,255,0.80) 66%, rgba(168,85,247,0.95) 86%,
    rgba(124,58,237,0.92) 100%);
}
.qpi-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 16px 0 0 16px; }
.qpi-glow   { position: absolute; right: -20px; top: -20px; width: 120px; height: 120px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.qpi-header-left { display: flex; align-items: center; gap: 12px; z-index: 1; padding-left: 6px; }
.qpi-avatar-wrap { position: relative; flex-shrink: 0; }
.qpi-header-icon {
  /* Same size + gradient + ring as .smc-cstrip-icon on the Customer page. */
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 14px rgba(91,33,182,0.40), 0 0 0 3px rgba(255,255,255,0.50);
}
.qpi-online-dot { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg,#4ade80,#22c55e); border: 2px solid #f3e8ff; }
.qpi-header-title { font-size: 18px; font-weight: 800; color: #2e1065; letter-spacing: -.3px; line-height: 1.2; }
.qpi-header-sub   { font-size: 12px; color: #6b7280; margin-top: 4px; font-weight: 400; line-height: 1.5; opacity: .85; }

.qpi-tab-switch {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(255,255,255,.7);
  border: 1px solid rgba(124,58,237,.2);
  border-radius: 10px; z-index: 1;
}
.qpi-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 7px; border: none;
  background: transparent; color: #7c3aed;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.qpi-tab:hover { background: rgba(124,58,237,.08); }
.qpi-tab.active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.4); }
/* Count chip on each tab — shows how many quotations / PIs exist. */
.qpi-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(124,58,237,.14); color: #7c3aed;
  font-size: 10.5px; font-weight: 800; line-height: 1;
}
.qpi-tab.active .qpi-tab-count { background: rgba(255,255,255,.25); color: #fff; }
/* Signature-status pill in the Quotation table Status column. */
.qpi-sig-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
.qpi-sig-none   { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.qpi-sig-sent   { background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; }
.qpi-sig-signed { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
/* Dark mode — translucent fills + light text, like the other app badges. */
[data-bs-theme="dark"] .qpi-sig-none   { background: rgba(148,163,184,.16); color: #cbd5e1; border-color: rgba(148,163,184,.34); }
[data-bs-theme="dark"] .qpi-sig-sent   { background: rgba(234,179,8,.16);   color: #fde68a; border-color: rgba(234,179,8,.40); }
[data-bs-theme="dark"] .qpi-sig-signed { background: rgba(34,197,94,.16);    color: #86efac; border-color: rgba(34,197,94,.40); }

/* ─── What We Are Doing Here ─── */
/* Matches the Customer page .smc-wdh-card design: lavender gradient card,
   40px gradient bulb icon, circular tinted chevron, white step tiles with a
   purple left-accent stripe + hover lift, and white arrow circles. */
.qpi-wdh {
  position: relative;
  background: linear-gradient(135deg, #faf5ff 0%, #f3eaff 45%, #ede1ff 100%);
  border: 1px solid #d6c5ff; border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(124,58,237,.10), 0 1px 3px rgba(124,58,237,.06);
}
.qpi-wdh-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 18px; cursor: pointer; user-select: none; transition: background .2s ease; }
.qpi-wdh-header:hover { background: rgba(124,58,237,.05); }
.qpi-wdh-title { display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 700; color: #3b0764; line-height: 1.2; }
.qpi-wdh-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 4px 10px rgba(124,58,237,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
  flex-shrink: 0;
}
.qpi-wdh-toggle {
  width: 32px; height: 32px; border-radius: 50%; border: 0;
  background: rgba(124,58,237,.10);
  color: #6d28d9;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  flex-shrink: 0;
  transition: background .2s ease;
}
.qpi-wdh-toggle:hover { background: rgba(124,58,237,.18); }

.qpi-wdh-body {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 8px; padding: 14px 18px 18px;
}
.qpi-wdh-step {
  background: #fff;
  border: 1px solid rgba(124,58,237,.18);
  border-left: 4px solid #7c3aed;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 110px;
  box-shadow: 0 2px 8px rgba(18,38,63,.04);
  cursor: default;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.qpi-wdh-step:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(124,58,237,.18), 0 2px 6px rgba(124,58,237,.10);
}
.qpi-wdh-step-head { display: flex; align-items: center; gap: 8px; }
.qpi-wdh-step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: linear-gradient(135deg, #7c3aed, #a78bfa); color: #fff;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(124,58,237,.30);
}
.qpi-wdh-step-title { font-size: 14px; font-weight: 700; color: #6d28d9; line-height: 1.2; }
.qpi-wdh-step-desc { font-size: 12px; color: var(--vz-secondary-color, #6b7280); line-height: 1.45; margin: 0; flex: 1; }
.qpi-wdh-step-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 800; color: #7c3aed;
  letter-spacing: .04em; text-transform: uppercase;
  margin-top: auto;
}
.qpi-wdh-step-dot { width: 6px; height: 6px; border-radius: 50%; background: #7c3aed; }

.qpi-wdh-arrow { display: flex; align-items: center; justify-content: center; }
.qpi-wdh-arrow-dot {
  width: 28px; height: 28px; border-radius: 50%;
  background: #fff; border: 1px solid rgba(124,58,237,.22);
  display: flex; align-items: center; justify-content: center;
  color: #7c3aed;
  box-shadow: 0 1px 4px rgba(124,58,237,.12);
}

/* ─── Table card ─── Clean neutral card. The 3px violet accent stripe
   that used to sit on ::before was reading as a floating "ptti" between
   the WDH section and the table card, so it's removed — the toolbar
   below it already carries the violet wash. */
.qpi-card {
  position: relative;
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color, #e9ecef);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,.04);
}
.qpi-tablebar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  /* Match SalesCustomers.smc-toolbar exactly — same 14px vertical
   * padding, same soft lavender wash, same 1px violet bottom border.
   * Keeps the toolbar / header relationship identical to the customer
   * page (which is the design baseline the user pointed to). */
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(124,58,237,0.04), rgba(167,139,250,0.02));
  border-bottom: 1px solid rgba(124,58,237,0.15);
  position: relative; z-index: 1;
}
/* "<Tab> List" pill on the left of the toolbar — re-added to match the
   Figma. White rounded chip with a purple gradient icon box, echoing the
   page-header icon styling so the two read as the same design language. */
.qpi-listpill {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 6px 14px 6px 7px; border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(124,58,237,.2);
  color: #3b0764; font-size: 12.5px; font-weight: 800;
  white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(124,58,237,.08);
}
.qpi-listpill-ico {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; flex-shrink: 0;
}
.qpi-listpill-ico svg { width: 15px; height: 15px; }
[data-bs-theme="dark"] .qpi-listpill,
[data-layout-mode="dark"] .qpi-listpill {
  background: rgba(124,58,237,.10);
  border-color: rgba(167,139,250,.30);
  color: #e9e3ff;
}

/* Tabs bar (row 2) — mirrors .smc-tabs-bar on the Customer page.
   Light violet wash + same horizontal padding as the toolbar above,
   with its own bottom border so it reads as a separate strip. */
.qpi-tabs-bar {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(124,58,237,.15);
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, rgba(124,58,237,.04), rgba(167,139,250,.02));
}

/* Pill group (segmented control) — mirrors .smc-pill-group. */
.qpi-pill-group {
  display: inline-flex; align-items: center; gap: 2px;
  background: var(--vz-secondary-bg, #f3f3f9);
  border: 1px solid var(--vz-border-color, #e9ecef);
  border-radius: 10px;
  padding: 4px;
  flex-shrink: 0;
}
.qpi-pi-subtab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; height: 32px;
  border: 0; border-radius: 8px;
  background: transparent;
  color: var(--vz-secondary-color, #878a99);
  font-family: inherit; font-size: 12.5px; font-weight: 600;
  cursor: pointer;
  letter-spacing: 0; white-space: nowrap;
  transition: all .18s ease;
}
.qpi-pi-subtab:hover { background: rgba(124,58,237,.06); color: #6d28d9; }
.qpi-pi-subtab.on {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
}
.qpi-pi-subtab svg { width: 14px; height: 14px; }

/* Legacy .qpi-pi-subtabs left as alias so the responsive rules below
   that still reference it don't break. */
.qpi-pi-subtabs { display: contents; }

/* Search field — match .smc-toolbar .smc-search exactly (42px tall,
   10px radius, translucent white, violet border). */
.qpi-search {
  position: relative;
  flex: 1; min-width: 240px;
  display: flex; align-items: center;
  background: rgba(255,255,255,.85);
  border: 1px solid rgba(124,58,237,.20);
  border-radius: 10px;
  padding: 0 14px 0 38px;
  height: 42px;
  box-shadow: 0 1px 3px rgba(124,58,237,.06);
  transition: border-color .15s, box-shadow .15s;
}
.qpi-search:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.15);
}
.qpi-search svg {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px;
  color: var(--vz-secondary-color, #878a99);
}
.qpi-search input {
  flex: 1; height: 100%; border: 0; outline: 0;
  background: transparent;
  font-family: inherit; font-size: 13px;
  color: var(--vz-body-color, #212529);
  font-weight: 500;
}
.qpi-search input::placeholder { color: var(--vz-secondary-color, #878a99); }

/* Create button — match .smc-add-btn (42px pill, purple gradient). */
.qpi-create-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 42px;
  border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.qpi-create-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(124,58,237,.40);
}
.qpi-create-btn:active { transform: translateY(0); }
.qpi-create-btn svg { width: 16px; height: 16px; }

/* (removed: legacy .qpi-table-wrap rules — TableContainer renders into
    .qpi-table-host now; the scrollbar styling lives on
    .qpi-table-host .table-responsive below.) */

/* Scope project-standard TableContainer to our card. Same soft violet
   header wash + 14px vertical cell padding the recruitment list uses,
   but applied to the Bootstrap .table the shared component renders.
   Top padding gives breathing room between the toolbar/tabs row above
   and the violet header row of the table so they don't visually stick. */
/* 14px top padding creates a WHITE GAP between the toolbar's bottom
 * border and the lavender table header band, so the two lavender
 * areas don't visually merge into one blob. Mirrors the same
 * padding 14/14/12 on .smc-table-wrap in SalesCustomers, which is
 * the visual baseline the user pointed to. */
.qpi-table-host { padding: 14px 14px 12px; }
/* Inner table is flush inside .qpi-card (which already provides the
 * white background + border + 16px outer radius). Giving the table
 * its OWN border/radius produced a card-within-a-card whose rounded
 * top corners poked up next to the search pill above and read as
 * "overlap". Now: no inner border, no inner radius, transparent
 * background — the white gap above + lavender header band below
 * are the visual dividers between the toolbar and the row area. */
.qpi-table-host .table-responsive {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.qpi-table-host .table-responsive::-webkit-scrollbar { height: 8px; }
.qpi-table-host .table-responsive::-webkit-scrollbar-track { background: transparent; }
.qpi-table-host .table-responsive::-webkit-scrollbar-thumb {
  background: #d1d5db; border-radius: 10px;
  border: 2px solid transparent; background-clip: padding-box;
}
.qpi-table-host .table-responsive::-webkit-scrollbar-thumb:hover {
  background: #9ca3af; background-clip: padding-box;
}
.qpi-table-host .table {
  --bs-table-bg: transparent;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  font-size: 13px;
  color: var(--vz-body-color, #212529);
  margin-bottom: 0 !important;
}
.qpi-table-host .table thead.table-light tr {
  /* Violet header band — EXACT same gradient as the Customer page
   * (.smc-table-wrap thead tr) so both tables read identically. The
   * gradient lives on the row so it's seamless across columns. */
  background: linear-gradient(110deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%) !important;
}
.qpi-table-host .table thead.table-light th {
  /* White uppercase labels on the violet band, matching the Figma. */
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  background: transparent !important;
  color: #fff !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  letter-spacing: .03em !important;
  text-transform: uppercase;
  /* Match SalesCustomers .smc-table-wrap th padding exactly. */
  padding: 11px 14px !important;
  border-bottom: 0 !important;
  white-space: nowrap;
  vertical-align: middle !important;
  line-height: 1.3 !important;
}
/* Header content is wrapped in a flex span by TableContainer. We need it
 * to behave like inline text so it stacks exactly above the body cell
 * content. Force block display + zero offset + matching line-height. */
.qpi-table-host .table thead.table-light th > span {
  display: block !important;
  padding: 0 !important;
  margin: 0 !important;
  gap: 0 !important;
  line-height: 1.3;
}
/* Centered columns — keep the flex span centered (so the centered
 * action-column header lines up with the centered action buttons). */
.qpi-table-host .table thead.table-light th[style*="text-align: center"] > span {
  text-align: center;
}
/* First/last column edge padding — match the toolbar's 18px outer padding
 * AND the toolbar pill's own internal padding (16px) so the column header
 * lines up with the toolbar pill label, not its outer edge. Total: ~18px
 * for the first column, 18px for the last. */
.qpi-table-host .table thead.table-light th:first-child,
.qpi-table-host .table tbody td:first-child { padding-left: 18px !important; }
.qpi-table-host .table thead.table-light th:last-child,
.qpi-table-host .table tbody td:last-child  { padding-right: 18px !important; }

.qpi-table-host .table tbody tr {
  background: transparent;
  transition: background .14s ease;
}
/* Zebra striping — alternating two-tone rows like the Figma. Odd rows stay
 * white (the card background); even rows get a soft lavender tint. Targeting
 * the cells (not the row) with !important also recolours the pinned ACTION
 * cell so it matches its row's stripe instead of showing through white. */
.qpi-table-host .table tbody tr:nth-child(even) td { background: #f4f0ff !important; }
/* Hover wins over the stripe (declared after) — a deeper lavender so the
 * active row stands out from both stripe tones. */
.qpi-table-host .table tbody tr:hover td {
  background: #ece5fb !important;
}
.qpi-table-host .table tbody td {
  --bs-table-bg: transparent !important;
  background: transparent !important;
  /* 12px vertical padding + 13px font + 500 weight + 1.45 line-height
   * mirrors .smc-table-wrap so rows have the same density. */
  padding: 12px 14px !important;
  font-size: 13px;
  font-weight: 500;
  color: var(--vz-body-color);
  border-bottom: 1px solid rgba(124,58,237,0.08) !important;
  vertical-align: middle;
  white-space: nowrap;
  line-height: 1.45;
}
.qpi-table-host .table tbody tr:last-child td { border-bottom: 0 !important; }

/* ── Pin the ACTION column (last) ──
   The table carries 13 columns and a wide action cluster (Convert to PI +
   the row tools), so it scrolls horizontally. Pinning the last column to the
   right keeps the actions aligned under their header and always reachable,
   instead of scrolling out of view / breaking past the header band. */
.qpi-table-host .table thead.table-light th:last-child,
.qpi-table-host .table tbody td:last-child {
  position: sticky; right: 0;
}
.qpi-table-host .table thead.table-light th:last-child {
  /* Solid fill — the header gradient lives on the <tr> and can't ride a
     sticky cell; the gradient's end colour keeps it seamless with the band. */
  background: #6d28d9 !important;
  z-index: 4;
}
.qpi-table-host .table tbody td:last-child {
  background: #fff !important;
  z-index: 2;
  box-shadow: -10px 0 12px -10px rgba(15,23,42,.18);
}
.qpi-table-host .table tbody tr:hover td:last-child { background: #ece5fb !important; }
/* Dark-mode zebra + pinned-cell tints. */
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:nth-child(even) td { background: rgba(124,58,237,.06) !important; }
[data-bs-theme="dark"] .qpi-table-host .table tbody td:last-child {
  background: var(--vz-card-bg, #1a1d21) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:nth-child(even) td:last-child {
  background: #1d1830 !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:hover td:last-child {
  background: rgba(134,92,226,.12) !important;
}

/* TableContainer's built-in pagination strip — styled as a proper card
 * footer that MIRRORS the toolbar above (same soft lavender wash + violet
 * hairline border + violet pagination), so it reads as part of .qpi-card,
 * not a separate coloured strip. The card's overflow:hidden + 16px radius
 * already round the footer's bottom corners. */
/* TableContainer's built-in pagination Row is hidden — we render our own
   "apna wala" footer (.qpi-pag) below the table instead. */
.qpi-table-host > .row { display: none !important; }

/* ─── Our pagination footer — Showing X–Y of Z + numbered chips. Mirrors
   the CLM .clm-pag footer but in the QPI violet palette. */
.qpi-pag {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px;
  padding: 10px 18px;
  border-top: 1px solid rgba(124,58,237,.15);
  background: linear-gradient(135deg, rgba(124,58,237,.04), rgba(167,139,250,.02));
}
.qpi-pag-info {
  font-size: 12px; font-weight: 600; color: #6d28d9;
  background: #fff; border: 1px solid rgba(124,58,237,.25);
  padding: 4px 12px; border-radius: 20px;
  font-variant-numeric: tabular-nums;
}
.qpi-pag-info b { color: #3b0764; font-weight: 800; }
.qpi-pag-btns { display: inline-flex; align-items: center; gap: 6px; }
.qpi-pag-btn {
  min-width: 30px; height: 30px; padding: 0 8px;
  border-radius: 50%;
  border: 1.5px solid rgba(124,58,237,.25);
  background: #fff;
  color: #6d28d9;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s, color .15s, box-shadow .2s;
}
.qpi-pag-btn:hover:not(:disabled):not(.on) {
  background: rgba(124,58,237,.08);
  border-color: rgba(124,58,237,.45);
  color: #5b21b6;
}
.qpi-pag-btn.on {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
  cursor: default;
}
.qpi-pag-btn:disabled { opacity: .45; cursor: not-allowed; }
.qpi-pag-arrow { color: #7c3aed; }
[data-bs-theme="dark"] .qpi-pag,
[data-layout-mode="dark"] .qpi-pag {
  border-top-color: rgba(167,139,250,.20);
  background: rgba(124,58,237,.06);
}
[data-bs-theme="dark"] .qpi-pag-info,
[data-layout-mode="dark"] .qpi-pag-info {
  background: rgba(124,58,237,.12); border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-pag-info b { color: #e9e3ff; }
[data-bs-theme="dark"] .qpi-pag-btn,
[data-layout-mode="dark"] .qpi-pag-btn {
  background: rgba(124,58,237,.10); border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
.qpi-table-host > .row > [class^="col-"] { padding: 0; width: auto; flex: 0 0 auto; }
/* "Showing X of Y Results" — plain muted text, no pill. */
.qpi-table-host .text-muted {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--vz-secondary-color, #878a99) !important;
  font-size: 12.5px; font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.qpi-table-host .text-muted .fw-semibold {
  color: var(--vz-body-color, #212529) !important;
  font-weight: 700;
}
/* Pagination — violet rounded buttons matching the qpi accent. */
.qpi-table-host .pagination { align-items: center; margin: 0; gap: 4px; }
.qpi-table-host .pagination .page-item { display: inline-flex; }
.qpi-table-host .pagination .page-link {
  border-radius: 8px !important;
  min-width: 32px; height: 32px;
  padding: 0 8px !important;
  display: inline-flex; align-items: center; justify-content: center;
  color: #6d28d9 !important;
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid rgba(124,58,237,0.20) !important;
  font-weight: 600; font-size: 13px; line-height: 1; margin: 0 !important;
  transition: all .15s;
}
.qpi-table-host .pagination .page-link:hover {
  background: rgba(124,58,237,0.08) !important;
  border-color: rgba(124,58,237,0.40) !important;
  color: #5b21b6 !important;
}
.qpi-table-host .pagination .page-item.active .page-link,
.qpi-table-host .pagination .page-link.active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
  border-color: transparent !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(124,58,237,0.30);
}
.qpi-table-host .pagination .page-item.disabled .page-link {
  color: #c4b5fd !important;
  opacity: .6;
}
/* prev / next chevron buttons */
.qpi-table-host .pagination .page-item:first-child .page-link,
.qpi-table-host .pagination .page-item:last-child  .page-link {
  min-width: 32px; padding: 0;
}
.qpi-table-host .pagination .page-item:first-child .page-link i,
.qpi-table-host .pagination .page-item:last-child  .page-link i {
  font-size: 16px;
  line-height: 1;
}
/* Dark mode — flat footer (no bar / border), matching light. */
[data-bs-theme="dark"] .qpi-table-host > .row,
[data-layout-mode="dark"] .qpi-table-host > .row {
  border-top: none;
  background: transparent;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(167,139,250,0.25) !important;
  color: #c4b5fd !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link:hover,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link:hover {
  background: rgba(124,58,237,0.20) !important;
  border-color: rgba(167,139,250,0.45) !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.active .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
  border-color: transparent !important;
  color: #fff !important;
}

.qpi-empty {
  text-align: center !important;
  padding: 56px 12px !important;
  color: #9ca3af;
  font-size: 13px; font-style: normal;
}

/* Sr No — plain numeric, no badge. */
.qpi-srno { color: var(--vz-body-color, #495057); font-weight: 600; font-size: 13px; }

/* Quotation No / Opp ID — match .rec-id-pill exactly. */
.qpi-link {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 999px;
  background: #ece6ff; color: #5a3fd1;
  font-family: var(--vz-font-monospace, 'JetBrains Mono', ui-monospace, monospace);
  font-weight: 700; font-size: 11.5px;
  letter-spacing: .02em;
  text-decoration: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.qpi-link:hover {
  background: #ddd0ff; color: #4a32b2;
  text-decoration: none;
}

/* Customer / Consignee — strong heading hierarchy. */
.qpi-strong { color: #0f1729; font-weight: 600; font-size: 13px; text-transform: capitalize; }
/* Same capitalization on Consignee but at normal body weight, so the
   first letter of each word is always uppercase regardless of what the
   user typed in the customer/consignee record. */
.qpi-cap { text-transform: capitalize; }

/* Branch column — owner branch name + optional MAIN chip. The chip
   uses the brand purple so it pops without clashing with the per-row
   action accents. Whole cell stays compact so the QPI table doesn't
   need an extra horizontal scroll when the column is added. */
.qpi-branch-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.qpi-branch-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1e293b;
  text-transform: capitalize;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qpi-branch-main {
  display: inline-block;
  padding: 2px 6px;
  background: #ede9fe;
  color: #6d28d9;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  border-radius: 5px;
  border: 1px solid #ddd6fe;
  line-height: 1.2;
}
[data-bs-theme="dark"] .qpi-branch-name { color: #e2e8f0; }
[data-bs-theme="dark"] .qpi-branch-main {
  background: rgba(167,139,250,.18);
  color: #c4b5fd;
  border-color: rgba(167,139,250,.30);
}

/* Dates — tabular monospace numerics, secondary color. */
.qpi-date {
  font-variant-numeric: tabular-nums;
  letter-spacing: .01em;
  color: var(--vz-secondary-color, #878a99);
  font-weight: 500;
  font-size: 13px;
}

/* Currency — small soft pill (matches .rec-pill density). */
.qpi-currency {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  background: #ece6ff; color: #5a3fd1;
  font-size: 11px; font-weight: 600;
  letter-spacing: .02em;
  font-family: var(--vz-font-monospace, 'JetBrains Mono', ui-monospace, monospace);
  white-space: nowrap;
}

.qpi-sm { color: var(--vz-body-color, #495057); font-weight: 500; font-size: 13px; }
.qpi-em { color: #cbd5e1; font-weight: 400; }
.qpi-em-center { text-align: center; color: #cbd5e1; font-weight: 400; }

/* Created By — colored pill keyed off user_type, with a small
 * sub-label (branch name / role). Same scheme as the Master Details
 * "Created By" column so the visual language stays consistent between
 * the two pages. */
.qpi-creator-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}
.qpi-creator-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}
.qpi-creator-sub {
  font-size: 10.5px;
  color: var(--vz-secondary-color, #878a99);
}
[data-bs-theme="dark"] .qpi-creator-sub { color: rgba(255,255,255,.55); }
/* Dark mode — the pill colours are set inline (light tints), so override with
   translucent fills + light text (!important to beat the inline style), matching
   how the other app badges read in dark mode. */
[data-bs-theme="dark"] .qpi-creator-self   { background: rgba(99,102,241,.20) !important;  color: #c7d2fe !important; }
[data-bs-theme="dark"] .qpi-creator-super  { background: rgba(139,92,246,.20) !important;  color: #ddd6fe !important; }
[data-bs-theme="dark"] .qpi-creator-client { background: rgba(59,130,246,.20) !important;   color: #bfdbfe !important; }
[data-bs-theme="dark"] .qpi-creator-branch { background: rgba(20,184,166,.20) !important;   color: #99f6e4 !important; }
[data-bs-theme="dark"] .qpi-creator-other  { background: rgba(148,163,184,.20) !important;  color: #cbd5e1 !important; }

.qpi-bt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 20px;
  border: 1.5px solid #5eead4; background: #f0fdfa;
  color: #0f766e; font-size: 11px; font-weight: 800;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.qpi-qt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 20px;
  border: 1.5px solid #ddd6fe; background: #faf5ff;
  color: #6d28d9; font-size: 11px; font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* Action group — center-aligned, tight 6px gap (matches customer page). */
.qpi-actions {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; flex-wrap: nowrap;
}

/* Convert to PI — restrained pill matching .smc-add-btn weight (gradient
   fill, modest shadow, NO heavy inset highlight). */
.qpi-convert-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  /* Fixed width so the "Convert to PI" and "Converted" pills are identical —
     keeps the trailing action icons vertically aligned across every row. */
  min-width: 132px;
  padding: 0 12px; height: 30px;
  border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  font-family: inherit; font-size: 11.5px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.qpi-convert-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(124,58,237,.40);
}
.qpi-convert-btn:active:not(:disabled) { transform: translateY(0); }
.qpi-convert-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(124,58,237,.25), 0 3px 10px rgba(124,58,237,.30);
}
.qpi-convert-btn:disabled { opacity: .65; cursor: wait; }
.qpi-convert-btn svg { width: 12px; height: 12px; }

/* "Already converted" locked state — green pill, no hover lift. */
.qpi-convert-btn-done,
.qpi-convert-btn-done:disabled {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.25);
  opacity: 1;
  cursor: not-allowed;
}
.qpi-convert-btn-done:hover { transform: none; }

/* Send-for-Signature pill (PI tab) — same pill shape as the convert button,
   in sky blue. "Sent" turns amber, "Signed" turns green; both are locked. */
.qpi-send-btn {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  box-shadow: 0 3px 10px rgba(14,165,233,.30);
}
.qpi-send-btn:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(14,165,233,.40); }
.qpi-send-btn:disabled { cursor: not-allowed; }
.qpi-send-btn-sent, .qpi-send-btn-sent:disabled {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  box-shadow: 0 3px 10px rgba(99,102,241,.28);
  opacity: 1; cursor: not-allowed;
}
.qpi-send-btn-sent:hover { transform: none; }
.qpi-send-btn-signed, .qpi-send-btn-signed:disabled {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.25);
  opacity: 1; cursor: not-allowed;
}
.qpi-send-btn-signed:hover { transform: none; }
/* Loading state — shown until the first signing-status poll resolves so a PI
   can't be re-sent before we know it was already sent/signed. */
.qpi-send-btn-loading, .qpi-send-btn-loading:disabled {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 3px 10px rgba(124,58,237,.28);
  opacity: 1; cursor: wait;
}
.qpi-send-spin {
  display: inline-block; width: 11px; height: 11px;
  border: 2px solid rgba(255,255,255,.45); border-top-color: #fff;
  border-radius: 50%; animation: qpi-send-spin-rot .6s linear infinite;
}
@keyframes qpi-send-spin-rot { to { transform: rotate(360deg); } }

/* "Signed PDF" download button — green pill, clickable (unlike the locked
   "converted" state above). Shown on completed e-signature rows. */
.qpi-signed-btn {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.28);
}
.qpi-signed-btn:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(22,163,74,.42);
}
.qpi-signed-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(22,163,74,.28), 0 3px 10px rgba(22,163,74,.28);
}

/* Action tiles — colour-coded like the Customer page ActionBtn: each tile
   shows a soft tint of its per-action accent (--qpi-act-accent) with a
   matching border + icon, and fills solid with a lift on hover. The accent
   is set inline per button (email = blue, edit = green, delete = red, etc.). */
.qpi-act {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; padding: 0;
  /* Fallbacks first for browsers without color-mix; modern browsers use the
     accent-derived tint below. */
  background: #f6f4ff;
  background: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 10%, #fff);
  border: 1px solid #e5e0f5;
  border: 1px solid color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 38%, #fff);
  color: var(--qpi-act-accent, #7c3aed);
  transition: background .15s ease, border-color .15s ease, color .15s ease,
              transform .15s ease, box-shadow .15s ease;
}
.qpi-act:hover {
  background: var(--qpi-act-accent, #7c3aed);
  border-color: transparent;
  color: #fff;
  transform: translateY(-2px) scale(1.08);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 45%, transparent);
}
.qpi-act:active { transform: translateY(0) scale(1); }
/* Disabled state for action tiles (e.g. Email after first send, or
   Reminder before first send). Greyed out, no hover lift, no pointer. */
.qpi-act-disabled,
.qpi-act:disabled,
.qpi-act[disabled] {
  cursor: not-allowed;
  opacity: 0.5;
  background: var(--vz-secondary-bg, #f3f3f9) !important;
  color: var(--vz-secondary-color, #878a99) !important;
  border-color: var(--vz-border-color, #e9ecef) !important;
}
.qpi-act-disabled:hover,
.qpi-act:disabled:hover,
.qpi-act[disabled]:hover {
  transform: none;
  box-shadow: none;
  background: var(--vz-secondary-bg, #f3f3f9) !important;
  color: var(--vz-secondary-color, #878a99) !important;
}
.qpi-act:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 25%, transparent);
}
.qpi-act svg { width: 14px; height: 14px; }

/* ─── More-Options dropdown (portal'd into <body>; positioned via inline style) ─── */
.qpi-moremenu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 14px 32px rgba(15,23,42,.20), 0 4px 10px rgba(15,23,42,.08);
  padding: 6px;
  display: flex; flex-direction: column; gap: 2px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  animation: qpi-moremenu-in .12s ease-out;
}
@keyframes qpi-moremenu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.qpi-moremenu-item {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 7px;
  background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 600;
  color: #1e293b;
  text-align: left;
  transition: background .12s, color .12s;
}
.qpi-moremenu-item:hover:not(:disabled) { background: #eff6ff; color: #0369a1; }
.qpi-moremenu-item:disabled { opacity: .65; cursor: wait; }
.qpi-moremenu-item svg { flex-shrink: 0; color: #0ea5e9; }
.qpi-moremenu-item span { flex: 1; white-space: nowrap; }
/* Slim divider between the View group and the Download group. */
.qpi-moremenu-sep {
  height: 1px;
  margin: 4px 8px;
  background: #e2e8f0;
}
[data-bs-theme="dark"] .qpi-moremenu-sep { background: rgba(167,139,250,.25); }
.qpi-moremenu-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(14,165,233,.30); border-top-color: #0ea5e9;
  animation: qpi-moremenu-spin .7s linear infinite;
}
@keyframes qpi-moremenu-spin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .qpi-moremenu {
  background: #2a2342;
  border-color: rgba(167,139,250,.45);
  box-shadow: 0 14px 32px rgba(0,0,0,.60), 0 4px 10px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .qpi-moremenu-item { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-moremenu-item:hover:not(:disabled) {
  background: rgba(14,165,233,.20);
  color: #e0f2fe;
}
[data-bs-theme="dark"] .qpi-moremenu-item svg { color: #38bdf8; }

/* ─── Pagination ─── Matches the Recruitment list-footer:
   plain "Showing X of Y Results" text on the left, prev / numbered
   page buttons / next on the right. Active page = purple gradient. */
.qpi-pagination {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px;
  padding: 12px 16px;
}
.qpi-pag-info {
  display: inline-flex; align-items: center;
  font-size: 13px; font-weight: 500;
  color: var(--vz-secondary-color, #878a99);
  font-variant-numeric: tabular-nums;
}
.qpi-pag-info strong {
  color: var(--vz-body-color, #212529);
  font-weight: 700;
  margin: 0 2px;
}
.qpi-pag-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
/* (removed: legacy .qpi-pag-btn rules — TableContainer renders pagination
    as Bootstrap .pagination .page-link, which is styled directly via
    .qpi-table-host .pagination .page-link further up.) */

/* ════════════════════════════════════════════════════════════════════════════
 * Modal styles (shared between Create Quotation and Create PI)
 * ════════════════════════════════════════════════════════════════════════ */
.qpi-modal-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', sans-serif;
}
.qpi-modal-backdrop *, .qpi-modal-backdrop *::before, .qpi-modal-backdrop *::after { box-sizing: border-box; }
.qpi-modal {
  width: 100%; max-width: 1140px;
  background: #fff; border-radius: 12px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, .40), 0 8px 24px rgba(124,58,237,.14);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 32px);
  overflow: hidden;
}
.qpi-modal-head {
  padding: 12px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  color: #fff;
}
.qpi-modal-head-right { flex-wrap: wrap; }
.qpi-modal-head-teal   { background: linear-gradient(110deg, #0f4c5c 0%, #0d3b48 60%, #042f36 100%); }
.qpi-modal-head-purple { background: linear-gradient(110deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
.qpi-modal-head-left { display: flex; align-items: center; gap: 12px; }
.qpi-modal-head-icon {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.15); border: 1.5px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.qpi-modal-head-icon svg { width: 16px; height: 16px; }
.qpi-modal-title { font-size: 14.5px; font-weight: 800; letter-spacing: -.2px; line-height: 1.2; }
.qpi-modal-sub   { font-size: 11px; opacity: .85; margin-top: 1px; line-height: 1.3; }

.qpi-modal-head-right { display: flex; align-items: center; gap: 8px; }
.qpi-modal-pill {
  background: rgba(255,255,255,.08);
  border: 1.5px solid rgba(255,255,255,.2);
  border-radius: 7px;
  padding: 3px 10px;
  display: flex; flex-direction: column;
}
.qpi-modal-pill-label { font-size: 8.5px; opacity: .75; letter-spacing: .05em; text-transform: uppercase; font-weight: 700; line-height: 1.2; }
.qpi-modal-pill-value { font-size: 11px; font-weight: 800; font-family: 'JetBrains Mono', ui-monospace, monospace; line-height: 1.2; }
.qpi-modal-pill-purple { background: rgba(255,255,255,.1); }
.qpi-modal-close {
  width: 28px; height: 28px; border-radius: 7px;
  background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.2);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.qpi-modal-close:hover { background: rgba(255,255,255,.2); }
.qpi-modal-close svg { width: 13px; height: 13px; }

/* Stepper — compact: smaller badge, tighter padding. */
.qpi-modal-stepper {
  display: flex; align-items: center; gap: 0;
  padding: 10px 16px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.qpi-modal-step-divider {
  flex: 0 0 56px;
  height: 2px;
  background: #e2e8f0;
  margin: 0 0;
}
/* Steps are sized to their content and left-aligned (matching the figma)
 * rather than stretched to fill the row — the connector + trailing space
 * read as a proper 2-step progress indicator. */
.qpi-step-badge {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 10px;
  border: 1.5px solid transparent;
  background: #fff;
  flex: 0 1 auto; min-width: 210px;
  transition: all .15s;
}
.qpi-step-badge-num {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
  flex-shrink: 0;
}
.qpi-step-badge-title { font-size: 12px; font-weight: 800; line-height: 1.2; }
.qpi-step-badge-sub   { font-size: 10px; color: #94a3b8; margin-top: 1px; line-height: 1.2; }
/* idle */
.qpi-step-idle { background: #fff; border-color: #e2e8f0; }
.qpi-step-idle .qpi-step-badge-num { background: #f1f5f9; color: #94a3b8; }
.qpi-step-idle .qpi-step-badge-title { color: #94a3b8; }
/* active */
.qpi-step-active.qpi-step-teal   { background: #ecfeff; border-color: #67e8f9; box-shadow: 0 4px 12px rgba(8, 145, 178, .15); }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-num { background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff; }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-title { color: #0e7490; }
.qpi-step-active.qpi-step-purple { background: #f5f3ff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,58,237,.15); }
.qpi-step-active.qpi-step-purple .qpi-step-badge-num { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; }
.qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #6d28d9; }
/* done */
.qpi-step-done .qpi-step-badge-num { background: linear-gradient(135deg, #4ade80, #22c55e); color: #fff; }
.qpi-step-done .qpi-step-badge-title { color: #15803d; }
.qpi-step-done.qpi-step-teal   { background: #f0fdfa; border-color: #99f6e4; }
.qpi-step-done.qpi-step-purple { background: #f0fdf4; border-color: #bbf7d0; }

/* Body — compact: tighter padding so the modal feels denser. */
.qpi-modal-body {
  padding: 12px 18px;
  overflow-y: auto;
  flex: 1;
  background: #fff;
}
.qpi-form-heading {
  font-size: 11px; font-weight: 800; letter-spacing: .05em;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid;
  text-transform: uppercase;
}
.qpi-form-heading-teal   { color: #0e7490; border-color: #0891b2; }
.qpi-form-heading-purple { color: #6d28d9; border-color: #7c3aed; }

.qpi-form-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px;
}
/* Each form-grid cell — block flow (.qpi-form-grid is a CSS Grid so
   flex props would be ignored on children anyway). The 4px gap stacks
   the label above the input/select inside the cell. */
.qpi-field { display: block; min-width: 0; }
.qpi-field > label { display: block; margin-bottom: 4px; }
.qpi-field-label {
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: #475569;
  line-height: 1.2;
}
.qpi-req-star { color: #ef4444; margin-left: 2px; }
.qpi-input {
  width: 100%; height: 32px; box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid #e2e8f0; border-radius: 7px;
  background: #fff;
  font-family: inherit; font-size: 12.5px; color: #0f172a;
  outline: none; transition: border .15s, box-shadow .15s;
}
.qpi-input:hover  { border-color: #cbd5e1; }
.qpi-input:focus  { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.14); }
.qpi-input-readonly { background: #f8fafc; color: #64748b; cursor: not-allowed; }
.qpi-input-num { text-align: right; }

/* Row-level loader while a PDF (view / download / certificate) generates —
 * the whole row sweeps violet and its buttons dim, matching Stage 4's loader.
 * Prevents double-clicks and makes it obvious which row is working. */
@keyframes qpi-row-sweep { 0% { background-position: -360px 0; } 100% { background-position: 360px 0; } }
.qpi-row-busy { pointer-events: none; }
.qpi-row-busy td {
  background-image: linear-gradient(90deg, rgba(124,58,237,0) 0%, rgba(124,58,237,.16) 50%, rgba(124,58,237,0) 100%) !important;
  background-size: 360px 100% !important;
  background-repeat: no-repeat !important;
  animation: qpi-row-sweep 1.1s ease-in-out infinite;
}
.qpi-row-busy td > * { opacity: .4; }
[data-bs-theme="dark"] .qpi-row-busy td {
  background-image: linear-gradient(90deg, rgba(167,139,250,0) 0%, rgba(167,139,250,.20) 50%, rgba(167,139,250,0) 100%) !important;
}

/* Edit-mode hydration shimmer */
@keyframes qpi-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.qpi-skel {
  display: block; border-radius: 7px;
  background: linear-gradient(90deg, #eef2f7 0%, #f7fafc 50%, #eef2f7 100%);
  background-size: 800px 100%; animation: qpi-shimmer 1.3s ease-in-out infinite;
}
.qpi-skel-label { width: 38%; height: 9px; border-radius: 4px; margin-bottom: 7px; }
.qpi-skel-input { width: 100%; height: 38px; }
.qpi-skel-note  { width: 100%; height: 64px; margin-top: 12px; }
@media (prefers-reduced-motion: reduce) { .qpi-skel { animation: none; } }
[data-bs-theme="dark"] .qpi-skel {
  background: linear-gradient(90deg, rgba(148,163,184,.12) 0%, rgba(148,163,184,.24) 50%, rgba(148,163,184,.12) 100%);
  background-size: 800px 100%;
}

/* ── Required-field error state (gated by Save and Next validation) ──
 * .qpi-field.has-error is set by the parent form when the user tries
 * to advance with this field empty. We tint the label red, paint the
 * input + MasterSelect trigger borders red with a soft halo, and surface
 * a tiny hint below. As soon as the user picks/types a value, the parent
 * clears the error and the styling disappears. */
.qpi-field.has-error .qpi-field-label { color: #dc2626; }
.qpi-field.has-error .qpi-input {
  border-color: #ef4444;
  background: #fef2f2;
  box-shadow: 0 0 0 3px rgba(239,68,68,.10);
}
.qpi-field.has-error .qpi-input:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239,68,68,.20);
}
.qpi-field.has-error .master-select-toggle {
  border-color: #ef4444 !important;
  background-color: #fef2f2 !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,.10) !important;
}
.qpi-field.has-error .master-select-wrap.show .master-select-toggle {
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,.20) !important;
}
.qpi-field-error-msg {
  font-size: 10.5px; font-weight: 600; color: #dc2626;
  letter-spacing: .01em;
  line-height: 1.2;
}
[data-bs-theme="dark"] .qpi-field.has-error .qpi-field-label { color: #fca5a5; }
[data-bs-theme="dark"] .qpi-field.has-error .qpi-input,
[data-bs-theme="dark"] .qpi-field.has-error .master-select-toggle {
  background-color: rgba(239,68,68,.08) !important;
  border-color: #f87171 !important;
}
[data-bs-theme="dark"] .qpi-field-error-msg { color: #fca5a5; }

/* MasterSelect override — match the (now compact) qpi-input dimensions. */
.qpi-modal-body .master-select-toggle {
  height: 32px;
  border-radius: 7px;
  border-color: #e2e8f0;
  background-color: #fff;
  font-size: 12.5px;
  color: #0f172a;
}
.qpi-modal-body .master-select-toggle:hover:not(:disabled) {
  border-color: #cbd5e1;
}
.qpi-modal-body .master-select-wrap.show .master-select-toggle {
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.14) !important;
}
.qpi-modal-body .master-select-wrap.show .master-select-chev { color: #7c3aed; }
/* Bump dropdown above the modal backdrop */
.master-select-menu.dropdown-menu { z-index: 11000 !important; }

/* Note panel — compact. */
.qpi-note {
  margin-top: 12px;
  padding: 10px 12px;
  background: linear-gradient(110deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fde68a; border-radius: 8px;
  display: flex; gap: 10px; align-items: flex-start;
}
.qpi-note-icon { color: #d97706; flex-shrink: 0; margin-top: 1px; }
.qpi-note-icon svg { width: 14px; height: 14px; }
.qpi-note-body { flex: 1; }
.qpi-note-line { font-size: 11px; color: #78350f; line-height: 1.45; }
.qpi-note-line + .qpi-note-line { margin-top: 2px; }
.qpi-note-line strong { color: #92400e; font-weight: 800; }
/* Note tinted to match the modal's theme (teal for Quotation, purple
   for PI) so it reads as part of the same surface, not an amber alert. */
.qpi-note-teal { background: linear-gradient(110deg, #ecfeff 0%, #cffafe 100%); border-color: #a5f3fc; }
.qpi-note-teal .qpi-note-icon { color: #0e7490; }
.qpi-note-teal .qpi-note-line { color: #155e75; }
.qpi-note-teal .qpi-note-line strong { color: #0c4a6e; }
.qpi-note-purple { background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%); border-color: #ddd6fe; }
.qpi-note-purple .qpi-note-icon { color: #7c3aed; }
.qpi-note-purple .qpi-note-line { color: #5b21b6; }
.qpi-note-purple .qpi-note-line strong { color: #4c1d95; }

/* Order summary card (step 2) — compact density so 12+ fields fit
   without the panel dominating the modal body. */
.qpi-order-summary {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid;
  background: #faf5ff;
  margin-bottom: 12px;
}
.qpi-order-summary-purple { background: #faf5ff; border-color: #ddd6fe; }
.qpi-order-summary-teal   { background: #ecfeff; border-color: #a5f3fc; }
.qpi-summary-item {}
.qpi-summary-item-label { font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #6d28d9; line-height: 1.2; }
.qpi-order-summary-teal .qpi-summary-item-label { color: #0e7490; }
.qpi-summary-item-value { font-size: 12px; font-weight: 600; color: #475569; margin-top: 1px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Product warning */
.qpi-product-warn {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px;
  background: #fef2f2; border: 1.5px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  font-size: 12px; font-weight: 700;
  margin-bottom: 14px;
}
.qpi-product-warn-icon { color: #dc2626; display: inline-flex; }

/* Products table — caps at ~5 product rows + header + input row,
   anything beyond that scrolls vertically inside the wrap so the
   modal footer stays on-screen. Horizontal scroll still kicks in
   when the table's min-width exceeds the modal width. */
.qpi-products-wrap {
  overflow-x: auto;
  overflow-y: auto;
  /* 36px header + 5 × ~42px product rows + ~52px input row ≈ 298px.
     Bumped to 320 to give a small breathing margin so the input
     row isn't right against the scroll edge. */
  max-height: 320px;
  margin-bottom: 18px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.qpi-products-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
.qpi-products-wrap::-webkit-scrollbar-track { background: transparent; }
.qpi-products-wrap::-webkit-scrollbar-thumb {
  background: #d1d5db; border-radius: 999px;
}
.qpi-products-wrap::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.qpi-products-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 800px; table-layout: fixed; }
/* Header matches the modal's popup chrome — teal gradient for the
   Quotation modal, purple for PI — using the same gradient as the modal
   header. The gradient lives on the ROW (with transparent cells) so it
   flows as ONE continuous sweep across the whole header instead of
   restarting in every cell. */
.qpi-products-table.qpi-pt-teal   thead tr { background: linear-gradient(90deg, #0f4c5c 0%, #0d3b48 60%, #042f36 100%); }
.qpi-products-table.qpi-pt-purple thead tr { background: linear-gradient(90deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
/* Sticky header — keep column labels visible while rows scroll.
   position:sticky needs an OWN background on the <th> (the <tr>'s
   gradient doesn't follow a positioned cell), so we paint the
   gradient directly here. z-index 5 keeps it above the input row's
   sticky background below. */
.qpi-products-table thead th {
  /* Transparent so the single row-level gradient shows through as one
     continuous sweep (no per-cell seams). */
  background: transparent;
  color: #fff; font-size: 9.5px; font-weight: 800;
  padding: 11px 12px;
  text-transform: uppercase; letter-spacing: .06em; text-align: left;
}
.qpi-products-table tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f0fc; vertical-align: middle; color: #475569; }
.qpi-products-table tbody tr:last-child td { border-bottom: none; }
/* Add-product row stays anchored to the bottom of the scroll wrap
   so the "+ Add" button is always reachable without scrolling
   through every existing line. */
.qpi-products-input-row td {
  position: sticky;
  bottom: 0;
  z-index: 4;
  background: #faf5ff;
  box-shadow: inset 0 1px 0 0 #ede9fe;
}
.qpi-amt { font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
/* Product Name (col 1) stays left-aligned; EVERY other column — header, data
   rows AND the draft input boxes — is centered. */
.qpi-products-table thead th:not(:first-child),
.qpi-products-table tbody td:not(:first-child) { text-align: center; }
/* Center the numeric inputs' text too so typed values sit under their centered
   headers (overrides the global right-aligned .qpi-input-num inside this table). */
.qpi-products-table .qpi-input-num { text-align: center; }
.qpi-prod-remove {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1.5px solid #fecaca; background: #fef2f2;
  color: #dc2626; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.qpi-prod-add {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: none;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  box-shadow: 0 3px 10px rgba(124,58,237,.35);
}
.qpi-prod-add-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 3px 10px rgba(14,116,144,.35); }
.qpi-prod-add-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }

/* Totals row */
.qpi-totals-row {
  display: grid; grid-template-columns: 1fr 320px; gap: 18px;
}
.qpi-terms { display: flex; flex-direction: column; }
.qpi-textarea {
  width: 100%; min-height: 130px;
  padding: 10px 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  font-family: inherit; font-size: 12px; color: #1e1b4b;
  resize: vertical;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.qpi-textarea::-webkit-scrollbar { width: 8px; height: 8px; }
.qpi-textarea::-webkit-scrollbar-track { background: transparent; }
.qpi-textarea::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 999px; }
.qpi-textarea::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.qpi-textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }

/* Totals summary panel (right column on step 2) — tightened to match
   the order-summary density above. */
.qpi-summary {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid;
  background: #fff;
}
.qpi-summary-teal   { border-color: #a5f3fc; background: #ecfeff; }
.qpi-summary-purple { border-color: #ddd6fe; background: #faf5ff; }
.qpi-summary-heading {
  font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  color: #6d28d9; margin-bottom: 6px;
}
.qpi-summary-teal .qpi-summary-heading { color: #0e7490; }
.qpi-summary-line {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0; font-size: 12px; color: #475569; font-weight: 600;
}
.qpi-summary-val { font-weight: 800; color: #1e1b4b; font-variant-numeric: tabular-nums; }
.qpi-summary-input { width: 96px; height: 28px; padding: 0 10px; font-size: 12px; text-align: right; }
/* Drop the native number-spinner arrows so the right-aligned value / placeholder
   ("0") sits flush at the right edge instead of being pushed left by the spinner. */
.qpi-summary-input::-webkit-outer-spin-button,
.qpi-summary-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.qpi-summary-input { -moz-appearance: textfield; appearance: textfield; }
.qpi-summary-input::placeholder { text-align: right; }
.qpi-summary-grand {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 4px; padding-top: 6px;
  border-top: 1px solid;
  font-size: 13px; font-weight: 800; color: #1e1b4b;
}
.qpi-summary-teal   .qpi-summary-grand { border-top-color: #a5f3fc; color: #0e7490; }
.qpi-summary-purple .qpi-summary-grand { border-top-color: #ddd6fe; color: #6d28d9; }

/* Footer — compact strip. Buttons sit right-aligned now that the
   "* Required fields" hint on the left has been removed. */
.qpi-modal-foot {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 10px 18px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.qpi-modal-req { font-size: 11px; color: #ef4444; font-weight: 600; }
.qpi-modal-foot-actions { display: flex; align-items: center; gap: 8px; }
.qpi-btn-cancel {
  padding: 6px 16px; border-radius: 7px;
  border: 1px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.qpi-btn-cancel:hover { background: #f8fafc; }
.qpi-btn-back {
  padding: 6px 14px; border-radius: 7px;
  border: 1px solid #c4b5fd; background: #fff;
  color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .18s ease, border-color .18s ease, color .18s ease,
              transform .15s ease, box-shadow .18s ease;
}
.qpi-btn-back:hover {
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border-color: #a78bfa;
  color: #5b21b6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(124,58,237,.20);
}
.qpi-btn-back:active { transform: translateY(0); box-shadow: 0 2px 6px rgba(124,58,237,.18); }
.qpi-btn-back:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(167,139,250,.30);
}

.qpi-btn-next, .qpi-btn-submit {
  padding: 6px 18px; border-radius: 7px;
  border: none; color: #fff;
  font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: transform .15s ease, box-shadow .18s ease, filter .18s ease;
}
.qpi-btn-next-teal,   .qpi-btn-submit-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 12px rgba(14,116,144,.4); }
.qpi-btn-next-purple, .qpi-btn-submit-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); box-shadow: 0 4px 12px rgba(124,58,237,.4); }

.qpi-btn-next:hover:not(:disabled),
.qpi-btn-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.qpi-btn-next-teal:hover:not(:disabled),
.qpi-btn-submit-teal:hover:not(:disabled) {
  box-shadow: 0 6px 18px rgba(14,116,144,.55);
}
.qpi-btn-next-purple:hover:not(:disabled),
.qpi-btn-submit-purple:hover:not(:disabled) {
  box-shadow: 0 6px 18px rgba(124,58,237,.55);
}
.qpi-btn-next:active:not(:disabled),
.qpi-btn-submit:active:not(:disabled) { transform: translateY(0); filter: brightness(1); }
.qpi-btn-next:focus-visible,
.qpi-btn-submit:focus-visible {
  outline: none;
}
.qpi-btn-next-teal:focus-visible,
.qpi-btn-submit-teal:focus-visible   { box-shadow: 0 0 0 3px rgba(8,145,178,.30), 0 4px 12px rgba(14,116,144,.4); }
.qpi-btn-next-purple:focus-visible,
.qpi-btn-submit-purple:focus-visible { box-shadow: 0 0 0 3px rgba(124,58,237,.28), 0 4px 12px rgba(124,58,237,.4); }
.qpi-btn-submit:disabled { opacity: .55; cursor: not-allowed; transform: none; }

/* ════════════════════════════════════════════════════════════════════════════
 * Dark mode — mirrors the SalesLeadAckMaster palette so the two Sales-Matrix
 * pages feel consistent. Page bg #14101d, cards #1a1530, body bg #221a3a,
 * inputs #0f0c19, text #e9d5ff / #c4b5fd, borders rgba(167,139,250,.25–.45).
 * ════════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .qpi-root {
  background: transparent;
  color: var(--vz-body-color);
}

/* Clean, calm dark banner — matches the Customer page hero: a mostly-dark,
 * low-chroma violet surface with a SINGLE subtle border. The old version
 * stacked a saturated fill + a bright pink/magenta gradient ring + glow blobs
 * + a white shine line, which read as noisy/over-saturated on dark. */
[data-bs-theme="dark"] .qpi-header {
  border: 1px solid rgba(139,92,246,0.22);
  /* Flat, even dark (no lighter right end that reads as a glowy patch). */
  background: linear-gradient(110deg, #181426 0%, #1e1838 100%);
  box-shadow: 0 6px 20px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .qpi-header::before { background-image: none; }
[data-bs-theme="dark"] .qpi-header::after  { background: none; }
[data-bs-theme="dark"] .qpi-header-title { color: #f5f3ff; }
[data-bs-theme="dark"] .qpi-header-sub   { color: #ede9fe; opacity: 0.92; }
[data-bs-theme="dark"] .qpi-header-icon  {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 4px 14px rgba(124,58,237,0.50), 0 0 0 3px rgba(167,139,250,0.18);
}
[data-bs-theme="dark"] .qpi-online-dot   { border-color: #1a1530; }
[data-bs-theme="dark"] .qpi-tab-switch {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-tab        { color: #ede9fe; }
[data-bs-theme="dark"] .qpi-tab:hover  { background: rgba(167,139,250,.12); }
/* Inactive count chip — the light-mode dark-purple text/bg is invisible on
   the dark toggle, so brighten both. The active chip stays white-on-glass. */
[data-bs-theme="dark"] .qpi-tab-count { background: rgba(167,139,250,.22); color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-tab.active .qpi-tab-count { background: rgba(255,255,255,.28); color: #fff; }

/* What We Are Doing Here */
[data-bs-theme="dark"] .qpi-wdh {
  background: linear-gradient(110deg, #181426 0%, #1e1838 100%);
  border-color: rgba(167,139,250,.22);
  box-shadow: 0 2px 8px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-wdh-title  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-toggle {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-wdh-step {
  background: #1a1530;
  border-color: rgba(167,139,250,.25);
  /* Keep the accent stripe visible on the dark tile (brighter violet). */
  border-left-color: #a78bfa;
}
[data-bs-theme="dark"] .qpi-wdh-step-title { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-step-desc  { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-wdh-step-tag   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-wdh-arrow-dot  {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.30);
  color: #c4b5fd;
}

/* Table card */
[data-bs-theme="dark"] .qpi-card {
  background: var(--vz-card-bg);
  border-color: var(--vz-border-color);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-tablebar {
  background: linear-gradient(135deg, rgba(124,58,237,.10), rgba(167,139,250,.05));
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-tabs-bar {
  background: linear-gradient(135deg, rgba(124,58,237,.10), rgba(167,139,250,.05));
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-pill-group,
[data-layout-mode="dark"] .qpi-pill-group {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.22);
}
[data-bs-theme="dark"] .qpi-pi-subtab,
[data-layout-mode="dark"] .qpi-pi-subtab { color: #cbd5e1; }
[data-bs-theme="dark"] .qpi-pi-subtab:hover,
[data-layout-mode="dark"] .qpi-pi-subtab:hover { background: rgba(167,139,250,.12); color: #ede9fe; }
[data-bs-theme="dark"] .qpi-search {
  background: rgba(255,255,255,.03);
  border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .qpi-search input { color: var(--vz-body-color); }
[data-bs-theme="dark"] .qpi-search input::placeholder,
[data-bs-theme="dark"] .qpi-search svg { color: var(--vz-secondary-color); }

/* Table — dark variant for TableContainer chrome */
[data-bs-theme="dark"] .qpi-table-host .table-responsive { scrollbar-color: rgba(255,255,255,.12) transparent; }
[data-bs-theme="dark"] .qpi-table-host .table-responsive::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); }
[data-bs-theme="dark"] .qpi-table-host .table-responsive::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.20); }
[data-bs-theme="dark"] .qpi-table-host .table { color: var(--vz-body-color); }
[data-bs-theme="dark"] .qpi-table-host .table thead.table-light tr {
  /* Match the Customer page's dark header gradient. */
  background: linear-gradient(110deg, #5b21b6 0%, #4c1d95 55%, #3b1675 100%) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table thead.table-light th {
  color: #fff !important;
  border-bottom: 0 !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:hover td {
  background: rgba(134,92,226,.08) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody td {
  color: var(--vz-body-color);
  border-bottom-color: color-mix(in srgb, #ffffff 6%, transparent) !important;
}

[data-bs-theme="dark"] .qpi-table-host .pagination .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link {
  background: #2b2640;
  color: #ddd6fe;
  border-color: rgba(167,139,250,.28);
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link:hover,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link:hover {
  background: rgba(167,139,250,.12); border-color: rgba(167,139,250,.45); color: #ede9fe;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.active .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #6d28d9, #4c1d95) !important;
  border-color: #7c3aed !important; color: #fff !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.disabled .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.disabled .page-link {
  background: rgba(255,255,255,.03); color: #6b6481;
  border-color: rgba(167,139,250,.18);
}

/* Cell-level chrome */
[data-bs-theme="dark"] .qpi-srno                 { color: rgba(255,255,255,.88); }
[data-bs-theme="dark"] .qpi-strong               { color: #ffffff; }
[data-bs-theme="dark"] .qpi-sm                   { color: rgba(255,255,255,.85); }
[data-bs-theme="dark"] .qpi-date                 { color: rgba(255,255,255,.78); }
[data-bs-theme="dark"] .qpi-em,
[data-bs-theme="dark"] .qpi-em-center            { color: rgba(255,255,255,.35); }
[data-bs-theme="dark"] .qpi-empty                { color: rgba(255,255,255,.45); }
[data-bs-theme="dark"] .qpi-link {
  background: rgba(124,92,252,.22);
  color: #c8b8ff;
}
[data-bs-theme="dark"] .qpi-link:hover {
  background: rgba(124,92,252,.32);
  color: #ffffff;
}
[data-bs-theme="dark"] .qpi-currency {
  background: rgba(124,92,252,.22);
  color: #c8b8ff;
}
[data-bs-theme="dark"] .qpi-bt-badge {
  background: rgba(13,148,136,.20); color: #5eead4; border-color: rgba(13,148,136,.40);
}
[data-bs-theme="dark"] .qpi-qt-badge {
  background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.40);
}

/* Action tiles — slate base with lavender hover accent. */
[data-bs-theme="dark"] .qpi-act {
  background: #1c2531;
  background: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 20%, #141a26);
  border-color: rgba(167,139,250,.30);
  border-color: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 45%, transparent);
  color: #c4b5fd;
  color: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 70%, #fff);
}
[data-bs-theme="dark"] .qpi-act:hover {
  background: var(--qpi-act-accent, #7c3aed);
  border-color: transparent;
  color: #fff;
}
[data-bs-theme="dark"] .qpi-act:focus-visible { box-shadow: 0 0 0 3px rgba(167,139,250,.30); }
/* Disabled-state action tile in dark mode — keep the muted look that
   reads as "not interactive" without going invisible against the dark
   table row background. Targets both the explicit class (.qpi-act-disabled)
   and the native :disabled / [disabled] selectors. */
[data-bs-theme="dark"] .qpi-act-disabled,
[data-bs-theme="dark"] .qpi-act:disabled,
[data-bs-theme="dark"] .qpi-act[disabled] {
  background: #1c2531 !important;
  border-color: rgba(167,139,250,.18) !important;
  color: rgba(196,181,253,.45) !important;
  opacity: 0.55;
}

/* Convert button */
[data-bs-theme="dark"] .qpi-convert-btn {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  box-shadow: 0 3px 10px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-convert-btn:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .qpi-convert-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(167,139,250,.35), 0 3px 10px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-convert-btn-done,
[data-bs-theme="dark"] .qpi-convert-btn-done:disabled {
  background: linear-gradient(135deg, #15803d, #166534);
  box-shadow: 0 3px 10px rgba(0,0,0,.40);
}

/* Pagination — dark variant of the slim footer. */
[data-bs-theme="dark"] .qpi-pag-info        { color: rgba(255,255,255,.70); }
[data-bs-theme="dark"] .qpi-pag-info strong { color: #ffffff; }
[data-bs-theme="dark"] .qpi-pag-btn {
  background: var(--vz-secondary-bg);
  border-color: var(--vz-border-color);
  color: rgba(255,255,255,.70);
}
[data-bs-theme="dark"] .qpi-pag-btn:hover:not(:disabled):not(.is-active) {
  border-color: #a78bfa; color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-pag-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(124,92,252,.22);
}
[data-bs-theme="dark"] .qpi-pag-btn:disabled { opacity: .45; }
[data-bs-theme="dark"] .qpi-pag-btn.is-active {
  background: linear-gradient(135deg, #7c5cfc, #a78bfa);
  border-color: transparent;
  color: #fff;
}

/* Modals — backdrop is already dark enough; we just need to dark-mode
   the modal shell, stepper, body, inputs, totals card, and footer. */
[data-bs-theme="dark"] .qpi-modal {
  background: #1a1530;
  box-shadow: 0 25px 60px rgba(0,0,0,.65);
}
[data-bs-theme="dark"] .qpi-modal-stepper {
  background: #14101d;
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-num { background: #2a2342; color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-title { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-teal {
  background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-purple {
  background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal .qpi-step-badge-title   { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-step-done .qpi-step-badge-title                   { color: #86efac; }
[data-bs-theme="dark"] .qpi-step-badge-sub { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-modal-step-divider { background: rgba(167,139,250,.20); }

[data-bs-theme="dark"] .qpi-modal-body { background: #221a3a; color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-input,
[data-bs-theme="dark"] .qpi-textarea {
  background: #0f0c19;
  border-color: rgba(167,139,250,.25);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-input::placeholder,
[data-bs-theme="dark"] .qpi-textarea::placeholder { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-input:focus,
[data-bs-theme="dark"] .qpi-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-input-readonly {
  background: rgba(255,255,255,.04); color: #9aa0b4;
}
[data-bs-theme="dark"] .qpi-field-label { color: #cbd5e1; }
[data-bs-theme="dark"] .qpi-modal-body .master-select-toggle {
  background-color: #0f0c19; border-color: rgba(167,139,250,.25); color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-toggle:hover:not(:disabled) {
  border-color: rgba(167,139,250,.45);
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-wrap.show .master-select-toggle {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20) !important;
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-wrap.show .master-select-chev { color: #a78bfa; }
[data-bs-theme="dark"] .qpi-form-heading-teal   { color: #67e8f9; border-color: #0891b2; }
[data-bs-theme="dark"] .qpi-form-heading-purple { color: #c4b5fd; border-color: #a78bfa; }

/* Note panel — keep amber theme but darken */
[data-bs-theme="dark"] .qpi-note {
  background: rgba(180,83,9,.18); border-color: rgba(217,119,6,.45);
}
[data-bs-theme="dark"] .qpi-note-line   { color: #fde68a; }
[data-bs-theme="dark"] .qpi-note-line strong { color: #fcd34d; }

/* Order summary + product table + totals + summary card */
[data-bs-theme="dark"] .qpi-order-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-order-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-item-label   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-order-summary-teal .qpi-summary-item-label { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-item-value   { color: #e9d5ff; }

[data-bs-theme="dark"] .qpi-product-warn {
  background: rgba(220,38,38,.15); border-color: rgba(239,68,68,.40); color: #fca5a5;
}
[data-bs-theme="dark"] .qpi-products-table tbody td {
  border-bottom-color: rgba(167,139,250,.15); color: #d4d1de;
}
/* Sticky thead in dark mode — needs its own opaque background so
   scrolling rows don't show through. Slightly deeper purple
   gradient so the strip still feels like a header band against
   the modal's dark canvas. */
/* Header keeps its popup-matching teal/purple gradient in dark mode too
   (both are already dark enough), so it stays consistent with the modal
   chrome — no separate dark override needed. */
[data-bs-theme="dark"] .qpi-products-input-row td {
  background: #1c1538;
  box-shadow: inset 0 1px 0 0 rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-products-wrap { scrollbar-color: rgba(255,255,255,.18) transparent; }
[data-bs-theme="dark"] .qpi-products-wrap::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.18);
}
[data-bs-theme="dark"] .qpi-products-wrap::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,.28);
}
[data-bs-theme="dark"] .qpi-textarea { scrollbar-color: rgba(255,255,255,.18) transparent; }
[data-bs-theme="dark"] .qpi-textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); }
[data-bs-theme="dark"] .qpi-textarea::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.28); }
[data-bs-theme="dark"] .qpi-amt { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-prod-remove {
  background: rgba(220,38,38,.18); border-color: rgba(239,68,68,.40); color: #fca5a5;
}

[data-bs-theme="dark"] .qpi-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-summary-heading { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-teal .qpi-summary-heading { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-line { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-val  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-grand { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-teal   .qpi-summary-grand { border-top-color: rgba(14,165,233,.45); color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-purple .qpi-summary-grand { border-top-color: rgba(167,139,250,.45); color: #c4b5fd; }

/* Modal footer + secondary buttons */
[data-bs-theme="dark"] .qpi-modal-foot {
  background: #1a1530;
  border-top-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-modal-req { color: #fca5a5; }
[data-bs-theme="dark"] .qpi-btn-cancel {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.40);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-btn-cancel:hover { background: rgba(167,139,250,.15); }
[data-bs-theme="dark"] .qpi-btn-back {
  background: rgba(167,139,250,.10);
  border-color: rgba(167,139,250,.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-btn-back:hover {
  background: rgba(167,139,250,.25);
  border-color: rgba(167,139,250,.70);
  color: #f1ecff;
  box-shadow: 0 4px 12px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .qpi-btn-back:focus-visible {
  box-shadow: 0 0 0 3px rgba(167,139,250,.30);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Responsive ladder
 *  ≤1100px  — drop wizard stepper / order-summary / form grid to 2 cols, WDH stacks
 *  ≤ 900px  — header tabs wrap below title, WDH cards lose min-height
 *  ≤ 680px  — tablebar stacks (search full-width, list pill + Create on row 2),
 *             form grids drop to 1 col, modal stepper + head collapse
 *  ≤ 520px  — pagination rows split, action chips & row text shrink, page padding tightens
 *  ≤ 400px  — modal backdrop padding minimised, modal pills reduce, Convert-to-PI button
 *             shrinks so 4-button action group fits on one row
 * ═══════════════════════════════════════════════════════════════════════ */
@media (max-width: 1100px) {
  .qpi-wdh-body { grid-template-columns: 1fr; }
  .qpi-wdh-arrow { display: none; }
  .qpi-form-grid { grid-template-columns: repeat(2, 1fr); }
  .qpi-order-summary { grid-template-columns: repeat(2, 1fr); }
  .qpi-totals-row { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .qpi-header { padding: 12px 14px; }
  .qpi-tab-switch { width: 100%; justify-content: flex-start; }
  .qpi-tab { flex: 1; justify-content: center; }
  .qpi-wdh-step { min-height: 0; }
  .qpi-wdh-body { padding: 6px 12px 10px; gap: 10px; }
}

@media (max-width: 680px) {
  /* Root no longer needs its own padding — parent layout handles gutters. */
  .qpi-header-title { font-size: 13.5px; }
  .qpi-header-sub   { font-size: 10.5px; }

  /* Tablebar stacks: search full-width, create button shrinks below it. */
  .qpi-tablebar { padding: 10px 12px; gap: 10px; flex-wrap: wrap; }
  .qpi-search { flex: 1 1 100%; min-width: 0; }
  .qpi-create-btn { flex: 1 1 100%; justify-content: center; }
  /* PI sub-tabs row goes full-width and the pill-group stretches. */
  .qpi-tabs-bar { padding: 10px 12px; }
  .qpi-pill-group { width: 100%; }
  .qpi-pi-subtab { flex: 1; justify-content: center; }

  /* Table forces its natural min-width and the wrapper scrolls. */
  .qpi-table-host { padding: 0; }
  .qpi-table-host .table-responsive { overflow-x: auto; }

  /* Form / order-summary / wizard stepper / modal head all collapse */
  .qpi-form-grid { grid-template-columns: 1fr; }
  .qpi-order-summary { grid-template-columns: 1fr; }
  .qpi-modal-stepper { flex-direction: column; gap: 8px; padding: 14px 16px 10px; }
  .qpi-modal-step-divider { display: none; }
  .qpi-modal-head { flex-direction: column; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .qpi-modal-head-right { width: 100%; justify-content: space-between; }
  .qpi-modal-body { padding: 14px 16px; }
  .qpi-modal-foot { padding: 12px 16px; flex-wrap: wrap; gap: 10px; }
  .qpi-modal-foot-actions { flex: 1 1 100%; justify-content: flex-end; }
}

@media (max-width: 520px) {
  .qpi-root { gap: 10px; }
  .qpi-header { padding: 10px 12px; gap: 10px; }
  .qpi-header-icon { width: 36px; height: 36px; }
  .qpi-header-title { font-size: 13px; }

  /* "What we are doing here" — tighter padding so it doesn't dominate */
  .qpi-wdh-header { padding: 8px 10px; }
  .qpi-wdh-body   { padding: 4px 10px 10px; }
  .qpi-wdh-step   { padding: 9px 10px; }

  /* Pagination split: "Showing X of Y" on row 1, prev/next/numbered
     buttons full-width on row 2 so nothing gets crammed. */
  .qpi-table-host > .row { padding: 10px 12px; }
  .qpi-table-host > .row > .col-sm { width: 100%; text-align: center; }
  .qpi-table-host > .row > .col-sm-auto { width: 100%; }
  .qpi-table-host .pagination { justify-content: center; flex-wrap: wrap; }

  /* Tighten the table's outer cell padding on narrow screens so the
     horizontal scroll bar isn't fighting for space. */
  .qpi-table-host .table thead.table-light th:first-child,
  .qpi-table-host .table tbody td:first-child { padding-left: 12px !important; }
  .qpi-table-host .table thead.table-light th:last-child,
  .qpi-table-host .table tbody td:last-child  { padding-right: 12px !important; }

  /* Action buttons compress — Convert label hides, icon stays.
     Drop the fixed pill width here so the icon-only button stays compact. */
  .qpi-convert-btn-label { display: none; }
  .qpi-convert-btn { padding: 0 9px; min-width: 0; }

  /* Modal backdrop hugs the edge — give the modal more breathing room */
  .qpi-modal-backdrop { padding: 8px; }
  .qpi-modal { max-height: calc(100vh - 16px); border-radius: 12px; }
  .qpi-modal-head { padding: 12px 14px; gap: 10px; }
  .qpi-modal-pill { padding: 4px 10px; }
  .qpi-modal-pill-value { font-size: 11px; }
  .qpi-modal-body { padding: 12px 14px; }
  .qpi-modal-foot { padding: 10px 14px; }
  .qpi-btn-cancel, .qpi-btn-back, .qpi-btn-next, .qpi-btn-submit {
    padding: 9px 14px; font-size: 12px;
  }

  /* More-options portal'd menu fits within viewport */
  .qpi-moremenu { min-width: 180px; }
}

@media (max-width: 400px) {
  .qpi-root { font-size: 12px; }
  .qpi-modal-pill { padding: 3px 8px; }
  .qpi-modal-pill-label { font-size: 9px; }
  .qpi-modal-pill-value { font-size: 10.5px; }
  .qpi-actions { gap: 4px; }
  .qpi-act { width: 28px; height: 28px; }
  .qpi-convert-btn { padding: 6px 8px; }
  .qpi-products-table { min-width: 700px; }
}
`;
