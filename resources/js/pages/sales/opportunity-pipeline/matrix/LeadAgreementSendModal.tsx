import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';import { resolveFileUrl } from '../../../../utils/resolveFileUrl';import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { SigningTrackerModal } from '../SigningTrackerModal';
import SalesDocSendForSignatureModal from './stages/SalesDocSendForSignatureModal';
import SalesCustomerSendForSignatureModal, {
  type AgreementSendRow,
  type AgreementSigner,
} from '../../core-masters/customer/SalesCustomerSendForSignatureModal';
import { type HeaderConfig, type FooterConfig } from '../../../hrms/doc-templates/HeaderFooterPanel';

/*
 * Sales Matrix → Lead detail → "Segment Details" card → Trade Documents /
 * Agreements popup.
 *
 * Walks the lead's latest non-cancelled PI products → distinct product
 * segments → trade documents + applicable agreements per segment. The card
 * row that opens this picks the active document type via the `view` prop
 * (Trade Documents or Agreements); both regulatory tiers are shown. Each
 * agreement row carries Send + Preview actions.
 *
 * Send target: POST /api/clm/signature-requests/agreement-send (auto-
 * resolves signers from the agreement's `party` CSV against the lead's
 * customer + consignee — one Zoho request per agreement, multi-party
 * agreements get parallel signers on the same PDF).
 *
 * Preview target: POST /api/clm/signature-requests/agreement-preview
 * (returns the merged PDF as a blob; opened in a new tab via
 * URL.createObjectURL).
 */

export type AgreementRowSig = {
  id: number;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  signed_url: string | null;
  certificate_url: string | null;
  /* Reminder counter + last-sent timestamp from clm_signature_requests.
   * Drives the "Sent N times" badge next to the Remind button so the
   * salesperson can see at a glance how many times the recipient has
   * already been nudged. */
  reminder_count?: number;
  last_reminder_sent_at?: string | null;
} | null;

export type AgreementRow = {
  id: number;
  code: string | null;
  title: string;
  agreement_type: string;
  party: string;
  regulatory: 'highly' | 'less';
  segment: string | null;
  required: 'REQ' | 'OPT';
  /** This deal's answer — see SegmentTradeDoc.needed. */
  needed?: boolean | null;
  updated_at: string | null;
  signature_request: AgreementRowSig;
  /* Send-for-Signature editor seed fields — body HTML + saved page-
   * shell config so the Edit Header/Footer/Body popup in the
   * workplace can hydrate without an extra fetch. Backend supplies
   * these from applicableForLead. */
  content?: string | null;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};

/* Trade document required for a segment — ONE row per document. The applicable
 * party comes from the trade-doc master's `party` CSV (for_buyer / for_consignee)
 * so the popup can split into Buyer / Consignee / Both tabs. Upload status is
 * unioned across the mapped parties. */
export type SegmentTradeDoc = {
  db_id: number | null;
  /* `name` is the catalog/type name (often shared across documents); `title`
   * is this document's own title and is what the popup shows as the primary
   * label. `title` falls back to name/code server-side when blank. */
  name: string;
  title: string;
  reference: string;
  doc_code: string;
  requirement: 'M' | 'O';
  /* This DEAL's answer, not the catalogue's. null = nobody has decided yet, and
     that is deliberately distinct from false: "not decided" must not read as
     "the user marked it unnecessary". */
  needed?: boolean | null;
  applicable_party: string;
  for_buyer: boolean;
  for_consignee: boolean;
  status: 'Verified' | 'Pending';
  attachment: string | null;
  attachment_url: string | null;
  /* Live signature status for the latest Zoho send of this trade doc on the
   * lead — drives the Sent/Signed badge, Remind button, and signed-PDF /
   * certificate downloads. Same shape as an agreement's signature_request. */
  signature_request?: AgreementRowSig;
};

export type ApplicableSegment = {
  id: number;
  code: string;
  name: string;
  regulatory: 'highly' | 'less';
  agreements: AgreementRow[];
  trade_documents: SegmentTradeDoc[];
};

/* A lead's mapped customer / consignee, with the details surfaced in the
 * Trade Documents popup header (id/code, country, email, segment). */
export type LeadParty = {
  id: number;
  code: string | null;
  name: string;
  email: string | null;
  country: string | null;
  segment: string | null;
};

export type ApplicablePayload = {
  stage5Complete: boolean;
  /* True when there's no distinct consignee (or it's flagged same-as-customer).
   * Trade Documents popup: true ⇒ one flat list; false ⇒ Buyer/Consignee/Both tabs. */
  buyerEqualsConsignee: boolean;
  lead: {
    id: number;
    code: string | null;
    customer: LeadParty | null;
    consignee: LeadParty | null;
  };
  pi: { id: number; code: string | null; status: string | null } | null;
  /* The PI as a signable document — Evidence Vault lists it the same way, and
     a deal that skipped Stage 5 can get it signed from either place. */
  pi_document: {
    pi_id: number; pi_code: string; name: string; status: string;
    signature_request: { id: number; status: string; reminder_count?: number; last_reminder_sent_at?: string | null } | null;
  } | null;
  /* Latest non-cancelled quotation on the lead. Segment Details unlock as
   * soon as EITHER a quotation or a PI exists (segments derive from the
   * mapped products of whichever is present, PI preferred). */
  quotation: { id: number; code: string | null; status: string | null } | null;
  totals: {
    highly: { matched: number; total: number };
    less:   { matched: number; total: number };
  };
  segments: ApplicableSegment[];
};

interface Props {
  open: boolean;
  leadId: number | null | undefined;
  /** Which document type the popup opens on. The Segment Details card now
   *  splits by document TYPE rather than regulatory tier, so both tiers'
   *  segments are shown and `view` just picks the active sub-tab. */
  view: 'trade' | 'agreements';
  onClose: () => void;
  /** Optional payload override — when the parent already fetched the
   *  applicable data it can pass it through to skip a duplicate fetch. */
  data?: ApplicablePayload | null;
  /** Called after a successful Send so the parent (SalesMatrixDetail)
   *  can refresh its own segment-counts/status snapshot. */
  onSent?: () => void;
}

const VIEW_META = {
  trade:      { title: 'Trade Documents', sub: 'Segment-applicable trade documents for this PI’s products' },
  agreements: { title: 'Agreements',      sub: 'Segment-applicable agreements for this PI’s products'      },
} as const;

/* Rewrite one document's `needed` inside the nested payload.
   The answer lives on rows two levels down (segment -> agreements / trade
   documents), so this walks rather than spreads the top level. */
function applyNeed(p: ApplicablePayload | null, kind: 'trade_doc' | 'agreement', docId: number, needed: boolean | null): ApplicablePayload | null {
  if (!p) return p;
  return {
    ...p,
    segments: (p.segments ?? []).map(seg => ({
      ...seg,
      agreements: kind === 'agreement'
        ? (seg.agreements ?? []).map(a => (a.id === docId ? { ...a, needed } : a))
        : seg.agreements,
      trade_documents: kind === 'trade_doc'
        ? (seg.trade_documents ?? []).map(t => (t.db_id === docId ? { ...t, needed } : t))
        : seg.trade_documents,
    })),
  } as ApplicablePayload;
}

/* Needed / Not needed, with an explicit undecided state.
   A plain checkbox cannot say "nobody has looked at this yet", and that was the
   whole complaint — the old REQ/OPT pill came from the segment's regulatory
   tier, so every row under one segment carried the same label and the screen
   never said which ones this deal should send. */
/* The column normally just STATES the answer; the choice appears once the row
   is ticked.
   Two Yes/No pills on every row read as a grid of switches and pulled the eye
   away from the document names, when most rows never need touching. Ticking a
   row is already the "I am dealing with this one" gesture, so the control rides
   on that. */
function NeedToggle({ value, busy, selected, onSet }: {
  value: boolean | null | undefined;
  busy: boolean;
  selected: boolean;
  onSet: (needed: boolean) => void;
}) {
  if (!selected) {
    if (value === true)  return <span className="lasm-need-tag is-yes">Necessary</span>;
    if (value === false) return <span className="lasm-need-tag is-no">Not necessary</span>;
    // Never decided. Reads as the default state rather than as a warning —
    // the send gate is what enforces it, this only reports.
    return <span className="lasm-need-tag is-none">Not necessary</span>;
  }
  const btn = (on: boolean, label: string, active: boolean, tone: string) => (
    <button
      type="button" disabled={busy}
      onClick={e => { e.stopPropagation(); onSet(on); }}
      className="lasm-need-btn"
      style={{
        background: active ? tone : 'transparent',
        color: active ? '#fff' : '#64748b',
        borderColor: active ? tone : '#e2e8f0',
        cursor: busy ? 'wait' : 'pointer',
      }}
    >{label}</button>
  );
  return (
    <div className="lasm-need-row">
      {btn(true,  'Yes', value === true,  '#0ab39c')}
      {btn(false, 'No',  value === false, '#94a3b8')}
    </div>
  );
}

export default function LeadAgreementSendModal({ open, leadId, view, onClose, data, onSent }: Props) {
  const toast = useToast();
  const [payload, setPayload] = useState<ApplicablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeSegId, setActiveSegId] = useState<number | null>(null);
  /* Top-level regulatory tier tab — High / Less (Agreements view only).
   * Filters the segment tabs below to that tier's segments. */
  const [tierTab, setTierTab] = useState<'highly' | 'less'>('highly');
  /* Trade Documents view tab — applicable-party split. When buyer == consignee
   * the popup shows a single flat list ('all'); otherwise Buyer / Consignee /
   * Both tabs. The active tab also decides the Zoho Sign recipient. */
  const [tdTab, setTdTab] = useState<'all' | 'buyer' | 'consignee' | 'both'>('all');
  /* Agreements view — applicable-party sub-tab WITHIN the active segment.
   * Same Buyer / Consignee / Both split (or a flat list when buyer ==
   * consignee), classified by each agreement's `party` field. */
  const [agrPartyTab, setAgrPartyTab] = useState<'all' | 'buyer' | 'consignee' | 'both'>('all');
  /* Table pagination — 5 rows per page for both the Trade Documents and the
   * Agreements tables (matches the Evidence Vault pager). */
  const [tdPage, setTdPage] = useState(1);
  const [agrPage, setAgrPage] = useState(1);
  // Rows-per-page (WorklistPager selector), same style as the customer / master
  // lists. Default 5 (Evidence-Vault feel); user can bump it.
  const [tdPerPage, setTdPerPage] = useState(5);
  const [agrPerPage, setAgrPerPage] = useState(5);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  /* Applicable-party "+N" popover — click the badge to see the full list of
   * parties (mirrors the segment "+N" popovers on the customer/consignee
   * lists). Pinned to fixed x/y captured on click. */
  const [partyPop, setPartyPop] = useState<{ names: string[]; x: number; y: number } | null>(null);

  /* Bulk selection. Multi-row checkbox state — the "Send Selected"
   * footer button fires a single Zoho request containing every
   * checked agreement. Selection is locked to a single applicable-
   * party CSV across all picked rows; checkboxes on rows whose
   * party differs from the first pick are disabled until the user
   * clears the selection. */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reminderId, setReminderId]   = useState<number | null>(null);
  // Signing activity tracker (shared modal) target — opened from the history
  // icon on any trade-doc / agreement row that has a signature request.
  const [trackerFor, setTrackerFor]   = useState<{ sigId: number; code: string } | null>(null);

  /* Normalise the agreement's `party` CSV into a stable key so
   * "Buyer, Consignee" and "buyer,consignee" group together. Matches
   * the server-side normaliser in ClmSignatureController::agreementSend. */
  /* Only the buyer / consignee tokens.
     The key locks a bulk selection to one signer set, and signers are derived
     from these two alone — supplier tokens never produce a recipient here.
     Including them made two agreements that both go to "Buyer + Consignee"
     look like different parties whenever their supplier lists differed
     ("Supplier-Material / Goods" vs "Supplier-Material, Supplier-Logistic"),
     so picking one silently locked the other out of the selection. */
  const partyKey = (party: string | null | undefined) =>
    String(party ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(t => t === 'buyer' || t === 'consignee')
      .sort()
      .join(',');

  /* True when there's no distinct consignee (or it's same-as-customer) —
   * drives whether the party sub-tabs show or a flat list does. */
  const buyerEqualsConsignee = !!payload?.buyerEqualsConsignee;

  /* Classify a `party` CSV (Buyer / Consignee / both) for the sub-tab split.
   * Tokens naming neither fall back to "both" so nothing is hidden. */
  const partyBucket = (party: string | null | undefined): 'buyer' | 'consignee' | 'both' => {
    const tokens = String(party ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const b = tokens.includes('buyer'), c = tokens.includes('consignee');
    if (b && c) return 'both';
    if (b) return 'buyer';
    if (c) return 'consignee';
    return 'both';
  };

  // Index every agreement currently visible across all segments so
  // the bulk selection state can look up rows by id when the active
  // tab changes (and so `selectedAgreementRows` resolves to ordered
  // AgreementRow objects for the bulk send).
  const allAgreementsById = useMemo(() => {
    const m = new Map<number, AgreementRow>();
    (payload?.segments ?? []).forEach(seg =>
      seg.agreements.forEach(a => { if (!m.has(a.id)) m.set(a.id, a); }));
    return m;
  }, [payload]);

  const selectedAgreementRows = useMemo(
    () => Array.from(selectedIds).map(id => allAgreementsById.get(id)).filter((a): a is AgreementRow => !!a),
    [selectedIds, allAgreementsById],
  );

  // Locked party for the active bulk selection — taken from the first
  // selected row. While at least one row is selected, every other row
  // whose normalised party doesn't match this key is disabled at the
  // checkbox level (rendered as a greyed-out lock).
  const selectedPartyKey = selectedAgreementRows.length > 0
    ? partyKey(selectedAgreementRows[0].party)
    : null;

  /* Per-row predicate driving the checkbox disabled state. Rows the
   * recipient has already signed (or that are in-progress) shouldn't
   * be re-bundled, and rows whose party differs from the lock are
   * out of bounds until the selection is cleared. */
  const canSelectAgreement = (a: AgreementRow): boolean => {
    const sig = a.signature_request;
    const sigStatus = sig?.status ?? 'draft';
    if (sigStatus !== 'draft' && sigStatus !== 'recalled') return false;
    if (!selectedPartyKey) return true;
    return partyKey(a.party) === selectedPartyKey;
  };

  const toggleSelect = (a: AgreementRow) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(a.id)) {
        next.delete(a.id);
      } else {
        if (!canSelectAgreement(a)) return prev;
        next.add(a.id);
      }
      return next;
    });
  };

  /* Header checkbox driver. "Select all in this tab" toggles every
   * sendable row inside the active segment. If they're all already
   * selected, the click clears them; otherwise it adds the missing
   * ones (and seeds selectedPartyKey from the first if empty). */
  const toggleSelectAll = (agreements: AgreementRow[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const eligible = agreements.filter(a => {
        const sig = a.signature_request;
        const status = sig?.status ?? 'draft';
        return status === 'draft' || status === 'recalled';
      });
      if (eligible.length === 0) return prev;
      // Use the FIRST eligible row's party as the lock if nothing's
      // selected yet, otherwise honour the existing lock.
      const seedKey = prev.size > 0 ? selectedPartyKey : partyKey(eligible[0].party);
      const matching = eligible.filter(a => partyKey(a.party) === seedKey);
      const allChecked = matching.every(a => next.has(a.id));
      if (allChecked) {
        matching.forEach(a => next.delete(a.id));
      } else {
        matching.forEach(a => next.add(a.id));
      }
      return next;
    });
  };

  /* ── Multi-segment ("combined") agreements ──────────────────────────────
     An agreement applicable to more than one segment of the active tier is
     pulled OUT of the individual segment tabs and shown once in a synthetic
     "Multiple Segments" tab (activeSegId === COMBINED_SEG_ID). Its `segment`
     field carries the joined segment names ("Rice + Basmati Rice") so the
     row makes clear which segments it covers. Single-segment agreements stay
     in their own segment tab. */
  const COMBINED_SEG_ID = -1;
  const tierSegments = (payload?.segments ?? []).filter(s => s.regulatory === tierTab);
  const agrSegCount = new Map<number, number>();   // agreement id → # tier segments
  const agrFirstRow = new Map<number, AgreementRow>();
  const agrSegNames = new Map<number, string[]>();
  tierSegments.forEach(seg => seg.agreements.forEach(a => {
    agrSegCount.set(a.id, (agrSegCount.get(a.id) ?? 0) + 1);
    if (!agrFirstRow.has(a.id)) agrFirstRow.set(a.id, a);
    const names = agrSegNames.get(a.id) ?? [];
    if (seg.name && !names.includes(seg.name)) { names.push(seg.name); agrSegNames.set(a.id, names); }
  }));
  const combinedAgreements: AgreementRow[] = Array.from(agrFirstRow.entries())
    .filter(([id]) => (agrSegCount.get(id) ?? 0) > 1)
    .map(([id, a]) => ({ ...a, segment: (agrSegNames.get(id) ?? []).join(' + ') }));
  const hasCombined = combinedAgreements.length > 0;

  // Active segment's agreements + the applicable-party sub-tab counts. The
  // table, select-all and header-check all read the party-narrowed list.
  // Segment tabs show only single-segment agreements; the Combined tab shows
  // the de-duped multi-segment ones.
  const activeSegRawAgreements = activeSegId === COMBINED_SEG_ID
    ? combinedAgreements
    : activeSegId
      ? (payload?.segments.find(s => s.id === activeSegId)?.agreements ?? [])
          .filter(a => (agrSegCount.get(a.id) ?? 1) <= 1)
      : [];
  const agrPartyCounts = {
    buyer:     activeSegRawAgreements.filter(a => partyBucket(a.party) === 'buyer').length,
    consignee: activeSegRawAgreements.filter(a => partyBucket(a.party) === 'consignee').length,
    both:      activeSegRawAgreements.filter(a => partyBucket(a.party) === 'both').length,
  };
  // buyer == consignee → show ONLY pure buyer agreements (a single party means
  // the Consignee and Buyer+Consignee categories are redundant). When buyer !=
  // consignee, the three party sub-tabs (Buyer / Consignee / Buyer+Consignee)
  // filter the list.
  const activeAgreements = buyerEqualsConsignee
    ? activeSegRawAgreements.filter(a => partyBucket(a.party) === 'buyer')
    : (agrPartyTab === 'all'
        ? activeSegRawAgreements
        : activeSegRawAgreements.filter(a => partyBucket(a.party) === agrPartyTab));
  // Human label of the active party sub-tab, for empty-state messages.
  const partyLabel = agrPartyTab === 'buyer' ? 'Customer' : agrPartyTab === 'consignee' ? 'Consignee' : 'Customer + Consignee';

  // Agreements table pagination — 5 rows per page (Evidence Vault style).
  // Header checkbox / bulk selection still span the full list; only display pages.
  const AGR_PER_PAGE = agrPerPage;
  const agrTotalPages = Math.max(1, Math.ceil(activeAgreements.length / AGR_PER_PAGE));
  const agrSafePage = Math.min(agrPage, agrTotalPages);
  const pagedAgreements = activeAgreements.slice((agrSafePage - 1) * AGR_PER_PAGE, agrSafePage * AGR_PER_PAGE);
  const agrFirst = activeAgreements.length === 0 ? 0 : (agrSafePage - 1) * AGR_PER_PAGE + 1;
  const agrLast = Math.min(agrSafePage * AGR_PER_PAGE, activeAgreements.length);

  // Header-checkbox state for the active tab — checked when every
  // matching-party row is already in the selection, indeterminate
  // when only some are, disabled when there's nothing sendable.
  const headerCheckEligible = activeAgreements.filter(a => {
    const status = a.signature_request?.status ?? 'draft';
    return (status === 'draft' || status === 'recalled')
      && (!selectedPartyKey || partyKey(a.party) === selectedPartyKey);
  });
  const headerCheckSelectedCount = headerCheckEligible.filter(a => selectedIds.has(a.id)).length;
  const headerCheckChecked       = headerCheckEligible.length > 0 && headerCheckSelectedCount === headerCheckEligible.length;
  const headerCheckIndeterminate = headerCheckSelectedCount > 0 && !headerCheckChecked;
  const headerCheckDisabled      = headerCheckEligible.length === 0;

  // Default / reset the agreement party sub-tab whenever the segment (or the
  // popup) changes — flat list when buyer == consignee, else the first
  // non-empty applicable-party bucket in the active segment.
  useEffect(() => {
    if (!open || view !== 'agreements') return;
    if (buyerEqualsConsignee) { setAgrPartyTab('all'); return; }
    if (agrPartyCounts.buyer > 0)          setAgrPartyTab('buyer');
    else if (agrPartyCounts.consignee > 0) setAgrPartyTab('consignee');
    else                                   setAgrPartyTab('both');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, activeSegId, buyerEqualsConsignee, agrPartyCounts.buyer, agrPartyCounts.consignee]);

  /* Send-for-Signature modal launch state. The actual preview +
   * draggable signature box UI lives in SalesCustomerSendForSignatureModal
   * (mode="agreement") so the workplace flow looks and feels identical
   * to the customer/consignee trade-doc tab's Send step. We just track
   * which agreements were picked when the user clicked Send. */
  const [ssfAgreements, setSsfAgreements] = useState<AgreementRow[]>([]);

  /* Trade Documents view — bulk selection (by trade-doc library id) and the
   * id list handed to the Zoho Sign wizard. The signer is derived from the
   * active tab (Buyer ⇒ customer, Consignee ⇒ consignee, Both/All ⇒ customer). */
  const [tdSelected, setTdSelected] = useState<Set<number>>(new Set());
  const [tdSendIds, setTdSendIds]   = useState<number[] | null>(null);
  // Clear the selection when the popup opens or the tab flips.
  useEffect(() => { setTdSelected(new Set()); }, [open, view, tdTab]);
  /* Ticked AND marked Necessary — the set the Send button really acts on. */
  const tdSendableSelected = useMemo(
    () => (payload?.segments ?? [])
      .flatMap(sg => sg.trade_documents ?? [])
      .filter(t => t.db_id != null && tdSelected.has(t.db_id) && t.needed === true)
      .map(t => t.db_id as number),
    [payload, tdSelected],
  );

  /* Escape-to-close mirrors the rest of the matrix modals. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Lock background page scroll while the popup is open. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /* Fetch the applicable payload when the modal opens for a new lead —
   * unless the parent already supplied it. */
  useEffect(() => {
    if (!open || !leadId) { setPayload(null); setActiveSegId(null); return; }
    /* `data` is the parent's copy, fetched once when the stage page loaded. It
       paints instantly, so it is used as the FIRST frame — but it is not the
       last word: anything decided since (the Necessary answers, a signature
       status) is missing from it, and returning here meant reopening the popup
       silently reverted every mark to how the page found them.
       So it seeds the view and a fresh read replaces it. */
    let cancelled = false;
    if (data) setPayload(data);
    else setLoading(true);
    api.get(`/clm/leads/${leadId}/agreement-applicable`)
      .then(r => { if (!cancelled) setPayload((r.data?.data ?? null) as ApplicablePayload | null); })
      // A failed refresh keeps the seeded copy rather than blanking the popup —
      // stale beats empty when the user already has it open.
      .catch(() => { if (!cancelled && !data) setPayload(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, leadId, data]);

  /* Saving the deal's answer for one document.
     Written straight through rather than batched on close: the popup is the
     only place this decision is made, and a user who closes it after ticking
     would otherwise lose the lot. `busy` is per document so one row saving
     never freezes the others. */
  const [needBusy, setNeedBusy] = useState<string[]>([]);
  /* Routed to SalesDocSendForSignatureModal (kind='pi') — the same component
     the Evidence Vault and the Q/PI stage use, so one document cannot be sent
     two different ways from two different screens. */
  const [piSend, setPiSend] = useState<{ id: number; code: string } | null>(null);
  /* Same decision for a whole checked set.
     One request rather than N: the endpoint already takes an items[] array, so
     marking eight documents is one round trip and one optimistic repaint
     instead of eight of each. */
  const setNeedBulk = async (kind: 'trade_doc' | 'agreement', docIds: number[], needed: boolean) => {
    if (!leadId || !docIds.length) return;
    const keys = docIds.map(id => `${kind}:${id}`);
    setNeedBusy(b => [...b, ...keys]);
    setPayload(p => docIds.reduce((acc, id) => applyNeed(acc, kind, id, needed), p));
    try {
      await api.post(`/clm/leads/${leadId}/doc-needs`, {
        items: docIds.map(id => ({ doc_kind: kind, doc_id: id, needed })),
      });
      toast.success(`${docIds.length} marked ${needed ? 'Necessary' : 'Not needed'}`, '');
    } catch {
      setPayload(p => docIds.reduce((acc, id) => applyNeed(acc, kind, id, null), p));
      toast.error('Could not save', 'The decisions were not recorded — please try again.');
    } finally {
      setNeedBusy(b => b.filter(k => !keys.includes(k)));
    }
  };

  const setNeed = async (kind: 'trade_doc' | 'agreement', docId: number, needed: boolean) => {
    if (!leadId) return;
    const key = `${kind}:${docId}`;
    setNeedBusy(b => [...b, key]);
    // Optimistic: the toggle answers instantly and rolls back only on failure.
    setPayload(p => applyNeed(p, kind, docId, needed));
    try {
      await api.post(`/clm/leads/${leadId}/doc-needs`, { items: [{ doc_kind: kind, doc_id: docId, needed }] });
    } catch {
      setPayload(p => applyNeed(p, kind, docId, null));
      toast.error('Could not save', 'The decision was not recorded — please try again.');
    } finally {
      setNeedBusy(b => b.filter(k => k !== key));
    }
  };


  // Every PI-derived segment carrying the chosen document type, across both
  // regulatory tiers — drives the High / Less tier-tab counts.
  const typeSegments = useMemo(
    () => (payload?.segments ?? []).filter(s =>
      view === 'trade' ? s.trade_documents.length > 0 : s.agreements.length > 0),
    [payload, view],
  );
  const tierCounts = useMemo(() => ({
    highly: typeSegments.filter(s => s.regulatory === 'highly').length,
    less:   typeSegments.filter(s => s.regulatory === 'less').length,
  }), [typeSegments]);

  /* Trade documents across every PI segment — ONE row per document. A single
   * trade doc that's applicable to multiple segments is collapsed into a single
   * row whose Segment column lists all its segments comma-separated (rather than
   * a duplicate row per segment). De-duped by db_id (the trade-doc master id),
   * falling back to doc_code + reference + name when db_id is missing. */
  type TradeDocRow = SegmentTradeDoc & { segmentName: string; segmentCode: string };
  const tradeDocs = useMemo(() => {
    const byKey = new Map<string, TradeDocRow>();
    (payload?.segments ?? []).forEach(seg =>
      seg.trade_documents.forEach(td => {
        const key = td.db_id != null
          ? `id:${td.db_id}`
          : `code:${td.doc_code}|ref:${td.reference}|name:${td.name}`;
        const existing = byKey.get(key);
        if (existing) {
          // Same document mapped to another segment → merge the segment into
          // the existing row (comma-separated, de-duplicated) instead of adding
          // a second row for the same document.
          const names = existing.segmentName ? existing.segmentName.split(', ') : [];
          if (seg.name && !names.includes(seg.name)) {
            existing.segmentName = [...names, seg.name].join(', ');
            const codes = existing.segmentCode ? existing.segmentCode.split(', ') : [];
            existing.segmentCode = [...codes, seg.code].filter(Boolean).join(', ');
          }
          // A verified upload in any segment satisfies the requirement.
          if (td.status === 'Verified') existing.status = 'Verified';
        } else {
          byKey.set(key, { ...td, segmentName: seg.name, segmentCode: seg.code });
        }
      }));
    return Array.from(byKey.values());
  }, [payload]);

  /* Applicable-party buckets driving the Buyer / Consignee / Both tabs.
   * `buyer` / `consignee` / `both` are mutually exclusive. `all` is the flat
   * list shown when buyer == consignee — every doc that involves the buyer
   * (buyer-only AND buyer+consignee "both" docs). Only pure consignee-only docs
   * are excluded, since those are the mirror copies redundant with a single
   * party — a "both" doc is one document that must still be signed once. */
  const tdBuckets = useMemo(() => ({
    all:       tradeDocs.filter(d => d.for_buyer),
    buyer:     tradeDocs.filter(d => d.for_buyer && !d.for_consignee),
    consignee: tradeDocs.filter(d => d.for_consignee && !d.for_buyer),
    both:      tradeDocs.filter(d => d.for_buyer && d.for_consignee),
  }), [tradeDocs]);

  // Default the Trade Documents tab when the popup opens: one flat list when
  // buyer == consignee, otherwise the first applicable-party tab that has docs.
  useEffect(() => {
    if (!open || view !== 'trade') return;
    if (buyerEqualsConsignee) { setTdTab('all'); return; }
    if (tdBuckets.buyer.length)          setTdTab('buyer');
    else if (tdBuckets.consignee.length) setTdTab('consignee');
    else                                 setTdTab('both');
  }, [open, view, buyerEqualsConsignee, tdBuckets.buyer.length, tdBuckets.consignee.length]);

  // Reset to page 1 whenever the visible row set changes (tab / segment /
  // tier / open) so the pager never lands on an out-of-range page.
  useEffect(() => { setTdPage(1); }, [tdTab, activeSegId, open]);
  useEffect(() => { setAgrPage(1); }, [agrPartyTab, activeSegId, tierTab, open]);

  // Segment tabs for the active tier tab.
  const visibleSegments = useMemo(
    () => typeSegments.filter(s => s.regulatory === tierTab),
    [typeSegments, tierTab],
  );

  // Default the tier tab to a non-empty tier whenever the popup opens or the
  // view flips (prefer Highly Regulated when both tiers carry segments).
  useEffect(() => {
    if (!open) return;
    if (tierCounts.highly > 0) setTierTab('highly');
    else if (tierCounts.less > 0) setTierTab('less');
  }, [open, view, tierCounts.highly, tierCounts.less]);

  // Default the active segment tab to the first in the current tier whenever
  // the segment list changes (fresh fetch, tier flip, or view flip).
  useEffect(() => {
    if (!visibleSegments.length) { setActiveSegId(null); return; }
    // Keep the synthetic "Multiple Segments" tab selected while it still has
    // rows; otherwise fall back to the first real segment tab.
    if (activeSegId === COMBINED_SEG_ID) { if (!hasCombined) setActiveSegId(visibleSegments[0].id); return; }
    if (!activeSegId || !visibleSegments.find(s => s.id === activeSegId)) {
      setActiveSegId(visibleSegments[0].id);
    }
  }, [visibleSegments, activeSegId, hasCombined]);

  const activeSeg = visibleSegments.find(s => s.id === activeSegId) ?? null;
  // True when this segment has no standalone agreement of its own but DOES take
  // part in a multi-segment agreement (which lives in the Combined tab). Used to
  // explain an empty segment table instead of a bare "no agreements" line.
  const activeSegHasCombined = !!activeSeg && activeSeg.agreements.some(a => (agrSegCount.get(a.id) ?? 1) > 1);

  /* Open the agreement PDF preview in a new tab. The backend response
   * is a binary stream, so we wrap it in a Blob and createObjectURL it.
   * Using window.open(_blank) lets the user keep this modal up while
   * they review the preview. */
  const handlePreview = async (agreementId: number) => {
    if (!leadId) return;
    setPreviewingId(agreementId);
    try {
      const resp = await api.post(
        '/clm/signature-requests/agreement-preview',
        { agreement_id: agreementId, lead_id: leadId },
        { responseType: 'blob' },
      );
      const blob = new Blob([resp.data], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) toast.error('Popup blocked', 'Allow popups to view the preview.');
      // Revoke the blob URL after the tab has had time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not render the preview.';
      toast.error('Preview failed', msg);
    } finally {
      setPreviewingId(null);
    }
  };

  /* Send — hands off to SalesCustomerSendForSignatureModal in
   * agreement mode. That modal handles the preview blob fetch + the
   * draggable signature box + the eventual POST to /agreement-send,
   * so this side just supplies the picked agreements and waits for
   * its `onSent` callback to refresh our row statuses. */
  const handleSend = (agreements: AgreementRow[]) => {
    /* One gate for the row button and the bulk footer alike. Filtering the list
       here rather than disabling each control keeps the two paths honest with
       each other — a rule enforced in only one of them is a rule that leaks. */
    const skipped = agreements.filter(a => a.needed !== true);
    agreements = agreements.filter(a => a.needed === true);
    if (!agreements.length) {
      toast.warning('Nothing marked Needed',
        'Mark an agreement as Needed before sending it for signature.');
      return;
    }
    if (skipped.length) {
      toast.info(`${skipped.length} skipped`, 'Only agreements marked Needed were sent.');
    }
    if (!leadId || agreements.length === 0) return;
    setSsfAgreements(agreements);
  };

  /* Refresh the applicable payload after a successful Send so the
   * row status pills flip to "In Progress" and the parent
   * (SalesMatrixDetail) can refresh its segment-counts snapshot. */
  const onSsfSent = async () => {
    setSsfAgreements([]);
    setSelectedIds(new Set());
    if (leadId) {
      try {
        const ref = await api.get(`/clm/leads/${leadId}/agreement-applicable`);
        setPayload((ref.data?.data ?? null) as ApplicablePayload | null);
      } catch {
        // ignore — UI still works on the previous payload
      }
    }
    onSent?.();
  };

  /* Same refresh after a Trade Document send so the row status reflects the
   * new signature request and the parent card counts re-pull. */
  const onTdSent = async () => {
    setTdSendIds(null);
    setTdSelected(new Set());
    if (leadId) {
      try {
        const ref = await api.get(`/clm/leads/${leadId}/agreement-applicable`);
        setPayload((ref.data?.data ?? null) as ApplicablePayload | null);
      } catch {
        // ignore — UI still works on the previous payload
      }
    }
    onSent?.();
  };

  /* The signer the Trade Documents wizard sends to is derived from the active
   * tab: the Consignee tab signs as the consignee, everything else (Buyer /
   * Both / the buyer==consignee flat list) signs as the customer. */
  const tdSignRole: 'customer' | 'consignee' = tdTab === 'consignee' ? 'consignee' : 'customer';
  const tdSignParty = tdSignRole === 'customer' ? payload?.lead.customer : payload?.lead.consignee;
  /* "Buyer + Consignee" documents are signed by BOTH parties — surface that
   * in the send affordances instead of the single primary party's name. */
  const tdIsBothParty = !buyerEqualsConsignee && tdTab === 'both';
  const tdSignerLabel = tdIsBothParty ? 'Customer + Consignee' : (tdSignParty?.name ?? tdSignRole);
  const tdSignCustomer = tdSignParty ? {
    id:      tdSignParty.code ?? `${tdSignRole === 'customer' ? 'c' : 'g'}-${tdSignParty.id}`,
    db_id:   tdSignParty.id,
    company: tdSignParty.name,
    contact: '',
    email:   tdSignParty.email ?? '',
  } : null;

  /* Poll every 15 seconds for agreement signature-request status updates
   * on the current lead. Mirrors the customer/consignee/vendor trade-
   * document polling but scoped tightly by `document_type=agreement` and
   * `lead_id` so trade-doc requests on the same party can't bleed into
   * agreement rows. ?sync=1 nudges the backend to round-trip Zoho for
   * any still-inprogress rows, which flips them to `completed` +
   * downloads the signed PDF + completion certificate the moment the
   * recipient finishes signing. */
  useEffect(() => {
    if (!open || !payload || !leadId) return;

    let cancelled = false;

    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const response = await api.get('/clm/signature-requests', {
          params: {
            lead_id: leadId,
            document_type: 'agreement',
            sync: withSync ? 1 : 0,
          },
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const infoMap: Record<number, { status: string; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }> = {};

        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i += 1) {
            const agreementId = Number(ids[i]);
            // `latest()` ordering means the first hit is the freshest
            // request for this agreement — skip older ones so a recalled
            // request can't overwrite a later in-progress one.
            if (!agreementId || infoMap[agreementId]) continue;

            const signedArr = row.signed_document_paths;
            let rawSignedUrl: string | null = null;
            if (Array.isArray(signedArr)) {
              const entry = signedArr[i] as { url?: string; path?: string; file_url?: string } | string | undefined;
              if (typeof entry === 'string') rawSignedUrl = entry;
              else if (entry && typeof entry === 'object') rawSignedUrl = entry.url || entry.file_url || entry.path || null;
            }
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_url || null;
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_path || null;

            const rawCertUrl = row.certificate_url || row.certificate_path || null;
            infoMap[agreementId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl: rawSignedUrl ? resolveFileUrl(rawSignedUrl) : undefined,
              certificateUrl: rawCertUrl ? resolveFileUrl(rawCertUrl) : undefined,
              // Pull reminder counter + last-sent timestamp so the
              // Remind button's "× N" badge stays live on the same
              // 15s tick as the signed-PDF artifacts.
              reminderCount: typeof row.reminder_count === 'number' ? row.reminder_count : undefined,
              lastReminderAt: row.last_reminder_sent_at ?? null,
            };
          }
        }

        if (cancelled) return;

        setPayload((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            segments: prev.segments.map((seg) => ({
              ...seg,
              agreements: seg.agreements.map((agreement) => {
                const info = infoMap[agreement.id];
                if (!info) return agreement;

                const existing = agreement.signature_request ?? {
                  id: info.signatureRequestId,
                  status: info.status,
                  signed_url: null,
                  certificate_url: null,
                  sent_at: null,
                  completed_at: null,
                };

                return {
                  ...agreement,
                  signature_request: {
                    ...existing,
                    id: info.signatureRequestId,
                    status: info.status,
                    signed_url: info.signedUrl ?? existing.signed_url,
                    certificate_url: info.certificateUrl ?? existing.certificate_url,
                    reminder_count: info.reminderCount ?? existing.reminder_count ?? 0,
                    last_reminder_sent_at: info.lastReminderAt ?? existing.last_reminder_sent_at ?? null,
                  },
                };
              }),
            })),
          };
        });
      } catch {
        // Silent — polling failures shouldn't toast every 15s.
      }
    };

    // Fire once immediately (no sync) so the table reflects whatever is
    // already in the DB without waiting for the first 15s tick, then
    // hand off to the interval which forces a Zoho round-trip every tick.
    fetchAndUpdate(false);
    const intervalId = window.setInterval(() => fetchAndUpdate(true), 15000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [open, leadId, payload?.lead.id]);

  /* Identical 15s status poll for TRADE-DOCUMENT signature requests on this
   * lead (document_type=trade_doc). Flips each trade-doc row to Signed,
   * surfaces the signed-PDF / certificate links, and keeps the Remind "× N"
   * count live — matched to rows by the trade-doc library id (db_id). */
  useEffect(() => {
    if (!open || !payload || !leadId) return;
    let cancelled = false;

    const fetchTd = async (withSync: boolean) => {
      try {
        const response = await api.get('/clm/signature-requests', {
          params: { lead_id: leadId, document_type: 'trade_doc', sync: withSync ? 1 : 0 },
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const infoMap: Record<number, { status: string; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }> = {};
        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i += 1) {
            const docId = Number(ids[i]);
            if (!docId || infoMap[docId]) continue;
            const signedArr = row.signed_document_paths;
            let rawSignedUrl: string | null = null;
            if (Array.isArray(signedArr)) {
              const entry = signedArr[i] as { url?: string; path?: string; file_url?: string } | string | undefined;
              if (typeof entry === 'string') rawSignedUrl = entry;
              else if (entry && typeof entry === 'object') rawSignedUrl = entry.url || entry.file_url || entry.path || null;
            }
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_url || null;
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_path || null;
            const rawCertUrl = row.certificate_url || row.certificate_path || null;
            infoMap[docId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl: rawSignedUrl ? resolveFileUrl(rawSignedUrl) : undefined,
              certificateUrl: rawCertUrl ? resolveFileUrl(rawCertUrl) : undefined,
              reminderCount: typeof row.reminder_count === 'number' ? row.reminder_count : undefined,
              lastReminderAt: row.last_reminder_sent_at ?? null,
            };
          }
        }
        if (cancelled) return;
        setPayload((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            segments: prev.segments.map((seg) => ({
              ...seg,
              trade_documents: seg.trade_documents.map((td) => {
                const info = td.db_id != null ? infoMap[td.db_id] : undefined;
                if (!info) return td;
                const existing = td.signature_request ?? {
                  id: info.signatureRequestId,
                  status: info.status,
                  signed_url: null,
                  certificate_url: null,
                  sent_at: null,
                  completed_at: null,
                };
                return {
                  ...td,
                  signature_request: {
                    ...existing,
                    id: info.signatureRequestId,
                    status: info.status,
                    signed_url: info.signedUrl ?? existing.signed_url,
                    certificate_url: info.certificateUrl ?? existing.certificate_url,
                    reminder_count: info.reminderCount ?? existing.reminder_count ?? 0,
                    last_reminder_sent_at: info.lastReminderAt ?? existing.last_reminder_sent_at ?? null,
                  },
                };
              }),
            })),
          };
        });
      } catch {
        // Silent — polling failures shouldn't toast every 15s.
      }
    };

    fetchTd(false);
    const intervalId = window.setInterval(() => fetchTd(true), 15000);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [open, leadId, payload?.lead.id]);

  /* Resend a Zoho reminder for an existing in-progress signature
   * request. Hits the same /clm/signature-requests/{id}/remind
   * endpoint the customer/consignee/vendor flows use — no doc-type
   * specific logic on the backend, so the wiring is one-line. */
  const handleRemind = async (signatureRequestId: number) => {
    setReminderId(signatureRequestId);
    try {
      const { data: r } = await api.post(`/clm/signature-requests/${signatureRequestId}/remind`);
      toast.success('Reminder sent', r?.message ?? 'Reminder dispatched to the recipient.');

      // Bump the on-button badge locally right away so the salesperson
      // sees the increment without waiting for the 15s polling tick.
      // Server is the source of truth — its reminder_count comes back
      // on the response.data and we project it onto every agreement
      // row whose signature_request.id matches.
      const serverCount = Number(r?.data?.reminder_count ?? NaN);
      const serverLastAt = (r?.data?.last_reminder_sent_at ?? null) as string | null;
      setPayload(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          segments: prev.segments.map(seg => ({
            ...seg,
            agreements: seg.agreements.map(a => {
              const sig = a.signature_request;
              if (!sig || sig.id !== signatureRequestId) return a;
              return {
                ...a,
                signature_request: {
                  ...sig,
                  reminder_count: Number.isFinite(serverCount) ? serverCount : (sig.reminder_count ?? 0) + 1,
                  last_reminder_sent_at: serverLastAt ?? new Date().toISOString(),
                },
              };
            }),
          })),
        };
      });
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not send the reminder.';
      toast.error('Reminder failed', msg);
    } finally {
      setReminderId(null);
    }
  };

  if (!open) return null;

  const meta = VIEW_META[view];

  return createPortal(
    <div className="lasm-overlay" role="dialog" aria-modal="true">
      <style>{LASM_CSS}</style>
      <div className="lasm-shell" onMouseDown={(e) => e.stopPropagation()}>
        {/* ── HEADER ── */}
        <div className="lasm-head">
          <div className="lasm-head-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div className="lasm-head-text">
            <div className="lasm-head-title">{meta.title}</div>
            <div className="lasm-head-sub">{meta.sub}</div>
          </div>
          <button type="button" className="lasm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="lasm-body">
          {loading ? (
            <div className="lasm-empty">Loading {view === 'trade' ? 'trade documents' : 'agreements'}…</div>
          ) : !payload ? (
            <div className="lasm-empty">Could not load applicable {view === 'trade' ? 'trade documents' : 'agreements'}.</div>
          ) : !payload.pi ? (
            <div className="lasm-empty lasm-empty-warn">
              Map a Proforma Invoice to this lead first — {view === 'trade' ? 'trade documents' : 'agreements'} unlock once a PI is attached.
            </div>
          ) : view === 'trade' ? (
            /* ── Trade Documents view ──
                 Read-only Customer + Consignee detail cards (always shown).
                 When buyer == consignee → one flat document list. Otherwise
                 the docs split into Buyer / Consignee / Both tabs by each
                 document's applicable party. The active tab also decides the
                 Zoho Sign recipient. ── */
            tradeDocs.length === 0 ? (
              <div className="lasm-empty">No trade documents configured for this lead's PI segments yet.</div>
            ) : (() => {
              const rows = tdBuckets[tdTab];
              // Paginate 5 per page (Evidence Vault style). Select-all still
              // operates on the full group, only the display is paged.
              const TD_PER_PAGE = tdPerPage;
              const tdTotalPages = Math.max(1, Math.ceil(rows.length / TD_PER_PAGE));
              const tdSafePage = Math.min(tdPage, tdTotalPages);
              const pagedTd = rows.slice((tdSafePage - 1) * TD_PER_PAGE, tdSafePage * TD_PER_PAGE);
              const tdFirst = rows.length === 0 ? 0 : (tdSafePage - 1) * TD_PER_PAGE + 1;
              const tdLast = Math.min(tdSafePage * TD_PER_PAGE, rows.length);
              // Already out-for / back-from signature → not re-sendable. Mirrors
              // the per-row `tdSent` check below so "select all" can't pick up a
              // doc that's already been sent and queue it for a second send.
              const isTdSent = (r: typeof rows[number]) => {
                const st = r.signature_request?.status ?? null;
                return !!st && !['draft', 'recalled', 'superseded'].includes(st);
              };
              // Library docs (db_id set) that haven't been sent are the only
              // sendable rows — select-all only touches these.
              const selectableIds = Array.from(new Set(rows.filter(r => r.db_id != null && !isTdSent(r)).map(r => r.db_id as number)));
              const allSel  = selectableIds.length > 0 && selectableIds.every(id => tdSelected.has(id));
              const someSel = selectableIds.some(id => tdSelected.has(id)) && !allSel;
              const toggleAll = () => setTdSelected(allSel ? new Set() : new Set(selectableIds));
              const toggleOne = (id: number) => setTdSelected(prev => {
                const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
              });
              const TD_TABS = [
                ['buyer',     'Customer Documents'],
                ['consignee', 'Consignee Documents'],
                ['both',      'Customer + Consignee'],
              ] as const;
              return (<>
                {/* Read-only party detail cards — NOT tabs. */}
                <div className="lasm-party-tabs">
                  {(['customer', 'consignee'] as const).map(p => {
                    const info  = p === 'customer' ? payload.lead.customer : payload.lead.consignee;
                    return (
                      <div key={p} className={`lasm-party-tab lasm-party-tab-readonly lasm-party-tab-${p} is-on`}>
                        <span className="lasm-party-tab-role">{p === 'customer' ? 'Customer' : 'Consignee'}</span>
                        <span className="lasm-party-tab-title-row">
                          <span className="lasm-party-tab-name">{info?.code ? `${info.code}: ` : ''}{info?.name ?? 'Not mapped'}</span>
                          <span className="lasm-party-tab-country">
                            <span className="lasm-party-tab-k">Country</span>{info?.country || '—'}
                          </span>
                        </span>
                        <span className="lasm-party-tab-meta">
                          <span><span className="lasm-party-tab-k">Email</span>{info?.email || '—'}</span>
                          {(() => { const seg = info?.segment || ''; const long = seg.length > 25; return (
                            <Tooltip label={seg} disabled={!long}><span><span className="lasm-party-tab-k">Segment</span>{long ? seg.slice(0, 25) + '…' : (seg || '—')}</span></Tooltip>
                          ); })()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Applicable-party tabs — only when buyer ≠ consignee. */}
                {!buyerEqualsConsignee && (
                  <div className="lasm-tabs" role="tablist">
                    {TD_TABS.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tdTab === key}
                        className={`lasm-tab ${tdTab === key ? 'is-on' : ''}`}
                        onClick={() => setTdTab(key)}
                      >
                        {label}<span className="lasm-tab-count">{tdBuckets[key].length}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="lasm-td-panel">
                  {rows.length === 0 ? (
                    <div className="lasm-td-empty">No trade documents in this group.</div>
                  ) : (<>
                    <div className="lasm-td-scroll">
                    <table className="lasm-td-table">
                      <thead>
                        <tr>
                          <th style={{ width: 38 }}>
                            <input
                              type="checkbox"
                              aria-label="Select all trade documents"
                              ref={el => { if (el) el.indeterminate = someSel; }}
                              checked={allSel}
                              disabled={selectableIds.length === 0 || !tdSignCustomer}
                              onChange={toggleAll}
                            />
                          </th>
                          <th style={{ width: 56 }}>Sr No.</th>
                          <th>Document</th>
                          <th style={{ width: 180 }}>Segment</th>
                          <th style={{ width: 150 }}>Necessary</th>
                          <th style={{ width: 130 }}>Status</th>
                          <th style={{ width: 160 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* The PI itself, pinned to the top — this whole list is
                            derived from its products, and it is signable in its
                            own right. Outside the pager on purpose: it is one
                            fixed row, not part of the catalogue being paged. */}
                        {payload.pi_document && (() => {
                          const pd  = payload.pi_document;
                          const sig = pd.signature_request;
                          const sent = !!sig && !['draft', 'recalled', 'superseded'].includes(sig.status);
                          return (
                            <tr className="lasm-pi-row">
                              <td />
                              <td>1</td>
                              <td>
                                <div className="lasm-doc-name">Proforma Invoice</div>
                                <div className="lasm-doc-sub">{pd.pi_code}</div>
                              </td>
                              <td><span className="lasm-doc-sub">Deal document</span></td>
                              {/* No Yes/No here. The PI is the deal's own
                                  invoice, not a catalogue entry someone may or
                                  may not want — the Evidence Vault marks it
                                  Mandatory for the same reason. */}
                              <td><span className="lasm-need-tag is-yes">Mandatory</span></td>
                              <td>
                                {sent
                                  ? <StatusPill status={sig!.status as any} />
                                  : <span className="lasm-td-status is-pending">Pending</span>}
                              </td>
                              <td>
                                <div className="lasm-actions">
                                  {!sent && (
                                    <Tooltip label="Send the Proforma Invoice for signature">
                                      <button type="button" className="lasm-btn-send"
                                        onClick={() => setPiSend({ id: pd.pi_id, code: pd.pi_code })}>
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                        Send
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                        {pagedTd.map((td, i) => {
                          const tdSig       = td.signature_request;
                          const tdSigStatus = tdSig?.status ?? null;
                          // Only inprogress / completed are locked. A declined,
                          // recalled or expired round is DEAD → it can be re-sent
                          // (the Send button becomes "Resend").
                          const tdSent      = !!tdSigStatus && !['draft', 'recalled', 'superseded', 'declined', 'rejected', 'expired'].includes(tdSigStatus);
                          const tdResend    = !!tdSigStatus && ['declined', 'rejected', 'recalled', 'expired'].includes(tdSigStatus);
                          const tdRemind    = tdSigStatus === 'inprogress';
                          const tdIsRemind  = !!tdSig && reminderId === tdSig.id;
                          /* Only documents this deal marked Needed can go for
                             signature. Undecided is not treated as yes — that
                             silent default is what made the list unusable. */
                          /* Selectable and sendable are different questions.
                             `needed` was folded into this one flag, and the
                             checkbox reads it — so a row could not be ticked
                             until it was marked Necessary, while the Yes/No
                             control only appears once a row IS ticked. Nothing
                             could ever be marked. */
                          const selectable = td.db_id != null && !tdSent;
                          const sendable = selectable && !!tdSignCustomer && td.needed === true;
                          const checked  = td.db_id != null && tdSelected.has(td.db_id);
                          return (
                          <tr key={`${td.doc_code}-${td.segmentCode}-${i}`} className={checked ? 'lasm-row-selected' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${td.title || td.name}`}
                                checked={checked}
                                disabled={!selectable}
                                title={tdSent ? `Already ${tdSigStatus}` : 'Select to mark Necessary or send'}
                                onChange={() => td.db_id != null && toggleOne(td.db_id)}
                              />
                            </td>
                            {/* Offset by the pinned PI row so the column reads
                                1, 2, 3 down the page instead of restarting. The
                                PI sits outside the pager, so it is present on
                                every page and the offset applies throughout. */}
                            <td>{(tdSafePage - 1) * TD_PER_PAGE + i + 1 + (payload.pi_document ? 1 : 0)}</td>
                            <td>
                              {(() => { const nm = td.title || td.name || ''; const long = nm.length > 25; return <Tooltip label={nm} disabled={!long}><div className="lasm-doc-name">{long ? nm.slice(0, 25) + '…' : nm}</div></Tooltip>; })()}
                              <div className="lasm-doc-sub">{td.reference}</div>
                            </td>
                            <td>
                              {(() => { const seg = td.segmentName ?? ''; const long = seg.length > 30; return <Tooltip label={seg} disabled={!long}><div className="lasm-doc-name">{long ? seg.slice(0, 30) + '…' : seg}</div></Tooltip>; })()}
                              <div className="lasm-doc-sub">{td.segmentCode}</div>
                            </td>
                            <td>
                              {/* db_id is null for a catalogue entry the tenant
                                  has not created a document row for yet — there
                                  is nothing to record an answer against. */}
                              {td.db_id == null
                                ? <span className="lasm-need-undecided">—</span>
                                : <NeedToggle
                                    value={td.needed}
                                    selected={tdSelected.has(td.db_id)}
                                    busy={needBusy.includes(`trade_doc:${td.db_id}`)}
                                    onSet={n => setNeed('trade_doc', td.db_id as number, n)}
                                  />}
                            </td>
                            <td>
                              {/* Signature status (Sent / Signed) once it's been
                                  sent for e-signature; otherwise the upload state. */}
                              {tdSig
                                ? <StatusPill status={tdSigStatus!} />
                                : <span className={`lasm-td-status ${td.status === 'Verified' ? 'is-ok' : 'is-pending'}`}>{td.status === 'Verified' ? 'Uploaded' : 'Pending'}</span>}
                            </td>
                            <td>
                              <div className="lasm-actions">
                                {/* Send — while the doc hasn't been sent; becomes
                                    "Resend" for a declined / recalled / expired round. */}
                                {sendable && (
                                  <Tooltip label={tdResend ? `Re-send to ${tdSignerLabel} for signature` : `Send to ${tdSignerLabel} for signature`}>
                                    <button
                                      type="button"
                                      className={`lasm-td-send${tdResend ? ' lasm-td-resend' : ''}`}
                                      onClick={() => td.db_id != null && setTdSendIds([td.db_id])}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                      {tdResend ? 'Resend' : 'Send'}
                                    </button>
                                  </Tooltip>
                                )}
                                {/* Remind — while out for signature, with a sent-count badge. */}
                                {tdRemind && tdSig && (() => {
                                  const remCount = tdSig.reminder_count ?? 0;
                                  const lastAt   = tdSig.last_reminder_sent_at;
                                  const tipLine  = remCount > 0
                                    ? `Reminder sent ${remCount} time${remCount === 1 ? '' : 's'}${lastAt ? ` (last: ${new Date(lastAt).toLocaleString()})` : ''}`
                                    : 'Resend reminder to the signer(s)';
                                  return (
                                    <Tooltip label={tipLine}>
                                      <button
                                        type="button"
                                        className="lasm-btn-remind"
                                        disabled={tdIsRemind}
                                        onClick={() => void handleRemind(tdSig.id)}
                                      >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                                        {tdIsRemind ? 'Sending…' : 'Remind'}
                                        {remCount > 0 && (
                                          <span className="lasm-remind-count" aria-label={`Sent ${remCount} times`}>{remCount}</span>
                                        )}
                                      </button>
                                    </Tooltip>
                                  );
                                })()}
                                {/* Signing timeline — always shown; disabled until the
                                    doc is sent for signature, enabled once it is. Same
                                    clock icon + icon-button style as the PI's tracker. */}
                                <Tooltip label={tdSig?.id ? 'View signing timeline' : 'Not sent for signature yet'}>
                                  <button
                                    type="button"
                                    className="lasm-btn-icon"
                                    aria-label="Signing timeline"
                                    disabled={!tdSig?.id}
                                    onClick={() => { if (tdSig?.id) setTrackerFor({ sigId: tdSig.id, code: td.reference || td.title || td.name }); }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                                  </button>
                                </Tooltip>
                                {/* Signed PDF + Certificate — once the doc is signed. */}
                                {tdSig?.signed_url && (
                                  <Tooltip label="View / download signed PDF">
                                    <a href={tdSig.signed_url} target="_blank" rel="noreferrer" className="lasm-btn-icon" aria-label="Signed PDF" download>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    </a>
                                  </Tooltip>
                                )}
                                {tdSig?.certificate_url && (
                                  <Tooltip label="Certificate of Completion">
                                    <a href={tdSig.certificate_url} target="_blank" rel="noreferrer" className="lasm-btn-cert" aria-label="Certificate" download>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
                                    </a>
                                  </Tooltip>
                                )}
                                {/* Sent but no row-level action yet (e.g. completed without a
                                    resolved signed URL) → keep the cell from collapsing. */}
                                {!sendable && !tdRemind && !tdSig?.id && !tdSig?.signed_url && !tdSig?.certificate_url && (
                                  <span className="lasm-td-dash">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>

                    {/* Pagination footer — same WorklistPager (Rows-per-page +
                        page/total + arrows) used on the Customer / master lists. */}
                    {rows.length > 0 && (
                      <WorklistPager
                        total={rows.length}
                        page={tdSafePage}
                        pageSize={tdPerPage}
                        onPage={setTdPage}
                        onPageSize={(n) => { setTdPerPage(n); setTdPage(1); }}
                        pageSizeOptions={[5, 10, 25, 50]}
                        className="lasm-pager"
                      />
                    )}

                    {/* Bulk send bar — one Zoho request for every checked doc,
                        all signed by the active tab's party. */}
                    {tdSelected.size > 0 && (
                      <div className="lasm-bulk-bar">
                        <div className="lasm-bulk-info">
                          <strong>{tdSelected.size}</strong> selected
                          {/* The signer is already named in the header card, and
                              repeating it here crowded the bar. */}
                          <button type="button" className="lasm-bulk-clear" title="Clear selection"
                            aria-label="Clear selection" onClick={() => setTdSelected(new Set())}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                        {/* Marking is separate from sending: the checked set is
                            usually decided on first, and only then sent. */}
                        <div className="lasm-bulk-need">
                          <button type="button" className="lasm-need-btn lasm-need-bulk is-yes"
                            onClick={() => setNeedBulk('trade_doc', Array.from(tdSelected), true)}>
                            Mark Necessary
                          </button>
                          <button type="button" className="lasm-need-btn lasm-need-bulk"
                            onClick={() => setNeedBulk('trade_doc', Array.from(tdSelected), false)}>
                            Mark Not necessary
                          </button>
                        </div>
                        {/* Counts what will ACTUALLY be sent, not what is
                            ticked. It read the checked set, so "Send Selected
                            (3)" appeared over two Necessary rows and one that
                            the gate would silently drop. */}
                        <button
                          type="button"
                          className="lasm-bulk-send"
                          disabled={!tdSignCustomer || tdSendableSelected.length === 0}
                          onClick={() => setTdSendIds(tdSendableSelected)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                          {`Send Selected (${tdSendableSelected.length})`}
                        </button>
                      </div>
                    )}
                  </>)}
                </div>
              </>);
            })()
          ) : typeSegments.length === 0 ? (
            <div className="lasm-empty">
              No segments with agreements in this lead's PI yet.
            </div>
          ) : (
            <>
              {/* Regulatory tier tabs — High / Less. Selecting a tier filters
                  the segment tabs below to that tier's segments. */}
              <div className="lasm-tier-tabs" role="tablist">
                {(['highly', 'less'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tierTab === t}
                    className={`lasm-tier-tab lasm-tier-tab-${t} ${tierTab === t ? 'is-on' : ''}`}
                    onClick={() => setTierTab(t)}
                  >
                    {t === 'highly' ? 'Highly Regulated' : 'Less Regulated'}
                    <span className="lasm-tier-tab-count">{tierCounts[t]}</span>
                  </button>
                ))}
              </div>

              {visibleSegments.length === 0 ? (
                <div className="lasm-empty">
                  No {tierTab === 'highly' ? 'highly' : 'less'}-regulated segments with agreements on this PI.
                </div>
              ) : (
                <>
              {/* Tabs — one per applicable segment, plus a "Multiple Segments"
                  tab listing agreements that apply to 2+ segments at once. */}
              <div className="lasm-tabs">
                {visibleSegments.map(seg => {
                  // Single-segment agreements for this segment — the same set
                  // its table shows (multi-segment docs live in the Combined tab).
                  // When buyer == consignee only pure-buyer rows are shown, so the
                  // count must apply that same filter to stay in sync with the table.
                  const segAgs = seg.agreements.filter(a => (agrSegCount.get(a.id) ?? 1) <= 1);
                  const segCount = buyerEqualsConsignee ? segAgs.filter(a => partyBucket(a.party) === 'buyer').length : segAgs.length;
                  return (
                  <button
                    key={seg.id}
                    type="button"
                    role="tab"
                    aria-selected={seg.id === activeSegId}
                    className={`lasm-tab ${seg.id === activeSegId ? 'is-on' : ''}`}
                    onClick={() => setActiveSegId(seg.id)}
                  >
                    {seg.name}<span className="lasm-tab-count">{segCount}</span>
                  </button>
                  );
                })}
                {hasCombined && (
                  <button
                    key="combined"
                    type="button"
                    role="tab"
                    aria-selected={activeSegId === COMBINED_SEG_ID}
                    className={`lasm-tab ${activeSegId === COMBINED_SEG_ID ? 'is-on' : ''}`}
                    onClick={() => setActiveSegId(COMBINED_SEG_ID)}
                    title="Agreements applicable to more than one segment"
                  >
                    Combined Segment Agreements<span className="lasm-tab-count">{buyerEqualsConsignee ? combinedAgreements.filter(a => partyBucket(a.party) === 'buyer').length : combinedAgreements.length}</span>
                  </button>
                )}
              </div>

              {/* Applicable-party sub-tabs WITHIN the segment — only when the
                  buyer differs from the consignee. Classified by each
                  agreement's `party` field set on the draft. */}
              {!buyerEqualsConsignee && (
                <div className="lasm-subtabs lasm-subtabs-inset" role="tablist">
                  {([['buyer', 'Customer'], ['consignee', 'Consignee'], ['both', 'Customer + Consignee']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={agrPartyTab === key}
                      className={`lasm-subtab ${agrPartyTab === key ? 'is-on' : ''}`}
                      onClick={() => setAgrPartyTab(key)}
                    >
                      {label}<span className="lasm-subtab-count">{agrPartyCounts[key]}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* ── Agreements ── */}
              <>
              <div className="lasm-table-wrap">
                <div className="lasm-table-scroll">
                <table className="lasm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}>
                        {/* Checkbox header — selects every row in the
                            active segment whose applicable_party still
                            satisfies the bulk same-party lock. Disabled
                            if there are no sendable rows in view. */}
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          ref={el => { if (el) el.indeterminate = headerCheckIndeterminate; }}
                          checked={headerCheckChecked}
                          disabled={headerCheckDisabled}
                          onChange={() => toggleSelectAll(activeAgreements)}
                        />
                      </th>
                      <th style={{ width: 56 }}>Sr No.</th>
                      <th>Document</th>
                      <th style={{ width: 140 }}>Applicable Party</th>
                      <th style={{ width: 150 }}>Necessary</th>
                      <th style={{ width: 130 }}>Updated On</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 210 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAgreements.length === 0 ? (
                      <tr><td colSpan={8} className="lasm-empty-row">
                        {activeSegId === COMBINED_SEG_ID ? (
                          // Combined-segment tab: empty only because the party sub-tab filters it out.
                          <span>
                            No <strong>{partyLabel}</strong> agreement in the combined-segment group.
                            {!buyerEqualsConsignee && ' Check the other party tabs above.'}
                          </span>
                        ) : (!buyerEqualsConsignee && activeSegRawAgreements.length > 0) ? (
                          // Segment HAS agreements, just none for the party sub-tab in view.
                          <span>
                            No <strong>{partyLabel}</strong> agreement
                            for <strong>{activeSeg?.name}</strong> in this segment. Check the other party tabs above,
                            or create one for this party from the <strong>Agreements Master</strong>.
                          </span>
                        ) : activeSegHasCombined ? (
                          <span>
                            <strong>{activeSeg?.name}</strong> has no separate agreement of its own — it’s covered by a
                            shared agreement that spans multiple segments. Open the
                            <strong> “Combined Segment Agreements”</strong> tab to view and send it.
                          </span>
                        ) : (
                          <span>
                            No agreement exists for <strong>{activeSeg?.name}</strong> yet — create one for this
                            segment from the <strong>Agreements Master</strong>, then it will appear here to send.
                          </span>
                        )}
                      </td></tr>
                    ) : pagedAgreements.map((a, idx) => {
                      const sig = a.signature_request;
                      const sigStatus = sig?.status ?? 'draft';
                      // Only inprogress / completed lock the row; a declined /
                      // recalled / expired agreement can be re-sent.
                      const sentAlready = !['draft', 'recalled', 'declined', 'rejected', 'expired'].includes(sigStatus);
                      const agResend      = ['declined', 'rejected', 'recalled', 'expired'].includes(sigStatus);
                      const isPrev        = previewingId === a.id;
                      const isRemind      = !!sig && reminderId === sig.id;
                      const checkboxLocked = sentAlready || !canSelectAgreement(a);
                      const checked       = selectedIds.has(a.id);
                      const showReminder  = sig && (sigStatus === 'inprogress');
                      return (
                        <tr key={a.id} className={checked ? 'lasm-row-selected' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.title}`}
                              checked={checked}
                              disabled={checkboxLocked}
                              title={
                                sentAlready
                                  ? `Already ${sigStatus} — bulk send only covers unsent agreements`
                                  : (canSelectAgreement(a)
                                      ? 'Add to bulk selection'
                                      : `Locked — bulk selection is tied to "${selectedPartyKey ?? ''}" applicable party`)
                              }
                              onChange={() => toggleSelect(a)}
                            />
                          </td>
                          <td>{(agrSafePage - 1) * AGR_PER_PAGE + idx + 1}</td>
                          <td>
                            {(() => { const nm = a.title || ''; const long = nm.length > 25; return <Tooltip label={nm} disabled={!long}><div className="lasm-doc-name">{long ? nm.slice(0, 25) + '…' : nm}</div></Tooltip>; })()}
                            <div className="lasm-doc-sub">{a.agreement_type || '—'}</div>
                            {/* On the Multiple Segments tab, list the segments this
                                one agreement covers (e.g. "Rice + Basmati Rice"). */}
                            {activeSegId === COMBINED_SEG_ID && a.segment && (
                              <div className="lasm-doc-sub" style={{ color: '#7c3aed', fontWeight: 600 }}>{a.segment}</div>
                            )}
                          </td>
                          <td>
                            {/* Applicable party CSV (e.g. "Buyer, Consignee") — show the
                                first party as a pill and collapse the rest into a "+N"
                                badge so the cell stays compact. */}
                            <div className="lasm-party-cell">
                              {(() => {
                                const parties = String(a.party ?? '').split(',').map(p => p.trim()).filter(Boolean)
                                  .map(p => /^buyer$/i.test(p) ? 'Customer' : p);
                                if (parties.length === 0) return <span className="lasm-td-dash">—</span>;
                                return (
                                  <>
                                    <span className="lasm-party-pill lasm-party-agr">{parties[0]}</span>
                                    {parties.length > 1 && (
                                      <button
                                        type="button"
                                        className="lasm-party-pill lasm-party-agr lasm-party-more"
                                        onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setPartyPop(prev => prev ? null : { names: parties, x: b.left, y: b.bottom + 6 }); }}
                                      >
                                        +{parties.length - 1}
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </td>
                          <td>
                            <NeedToggle
                              value={a.needed}
                              selected={selectedIds.has(a.id)}
                              busy={needBusy.includes(`agreement:${a.id}`)}
                              onSet={n => setNeed('agreement', a.id, n)}
                            />
                          </td>
                          <td className="lasm-mono">{fmtDmyLong(a.updated_at)}</td>
                          <td>
                            <StatusPill status={sigStatus} />
                          </td>
                          <td>
                            <div className="lasm-actions">
                              {!sentAlready && (
                                /* Disabled until the deal marks it Necessary.
                                   handleSend already refuses these, but a button
                                   that looks live and then argues back is worse
                                   than one that plainly cannot be pressed —
                                   the trade-doc side has always disabled it. */
                                <Tooltip label={a.needed !== true
                                  ? 'Mark this agreement Necessary before sending'
                                  : (agResend ? 'Re-send for signature' : 'Send for signature')}>
                                  <span className="d-inline-flex">
                                  <button
                                    type="button"
                                    disabled={a.needed !== true}
                                    className={`lasm-btn-send${agResend ? ' lasm-td-resend' : ''}`}
                                    onClick={() => handleSend([a])}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                    {agResend ? 'Resend' : 'Send'}
                                  </button>
                                  </span>
                                </Tooltip>
                              )}
                              {showReminder && (() => {
                                const remCount = sig?.reminder_count ?? 0;
                                const lastAt   = sig?.last_reminder_sent_at;
                                const tipLine  = remCount > 0
                                  ? `Reminder sent ${remCount} time${remCount === 1 ? '' : 's'}${lastAt ? ` (last: ${new Date(lastAt).toLocaleString()})` : ''}`
                                  : 'Resend reminder to the signer(s)';
                                return (
                                <Tooltip label={tipLine}>
                                  <button
                                    type="button"
                                    className="lasm-btn-remind"
                                    disabled={isRemind}
                                    onClick={() => void handleRemind(sig!.id)}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                                    {isRemind ? 'Sending…' : 'Remind'}
                                    {remCount > 0 && (
                                      <span className="lasm-remind-count" aria-label={`Sent ${remCount} times`}>{remCount}</span>
                                    )}
                                  </button>
                                </Tooltip>
                                );
                              })()}
                              {/* Signing timeline — always shown; disabled until the
                                  agreement is sent for signature, enabled once it is.
                                  Same clock icon + icon-button style as the PI's
                                  signing tracker. */}
                              <Tooltip label={sig?.id ? 'View signing timeline' : 'Not sent for signature yet'}>
                                <button
                                  type="button"
                                  className="lasm-btn-icon"
                                  aria-label="Signing timeline"
                                  disabled={!sig?.id}
                                  onClick={() => { if (sig?.id) setTrackerFor({ sigId: sig.id, code: a.code || a.title }); }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                                </button>
                              </Tooltip>
                              {/* Preview the agreement PDF (always available). */}
                              <Tooltip label="Preview agreement PDF">
                                <button
                                  type="button"
                                  className="lasm-btn-eye"
                                  disabled={isPrev}
                                  onClick={() => void handlePreview(a.id)}
                                  aria-label="Preview"
                                >
                                  {isPrev ? (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                  ) : (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  )}
                                </button>
                              </Tooltip>
                              {sig?.signed_url && (
                                <Tooltip label="View / download signed PDF">
                                  <a href={sig.signed_url} target="_blank" rel="noreferrer" className="lasm-btn-icon" aria-label="Signed PDF" download>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                  </a>
                                </Tooltip>
                              )}
                              {sig?.certificate_url && (
                                <Tooltip label="Certificate of Completion">
                                  <a href={sig.certificate_url} target="_blank" rel="noreferrer" className="lasm-btn-cert" aria-label="Certificate" download>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
                                  </a>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {/* Pagination footer — same WorklistPager (Rows-per-page +
                    page/total + arrows) used on the Customer / master lists. */}
                {activeAgreements.length > 0 && (
                  <WorklistPager
                    total={activeAgreements.length}
                    page={agrSafePage}
                    pageSize={agrPerPage}
                    onPage={setAgrPage}
                    onPageSize={(n) => { setAgrPerPage(n); setAgrPage(1); }}
                    pageSizeOptions={[5, 10, 25, 50]}
                    className="lasm-pager"
                  />
                )}
              </div>

              {/* Bulk send sticky footer — only visible when ≥1 row is
                  checked. The button caption surfaces the applicable
                  party so it's obvious which signer set is locked in
                  for this bundle. */}
              {selectedIds.size > 0 && (
                <div className="lasm-bulk-bar">
                  <div className="lasm-bulk-info">
                    <strong>{selectedIds.size}</strong> selected
                    <button type="button" className="lasm-bulk-clear" title="Clear selection"
                      aria-label="Clear selection" onClick={() => setSelectedIds(new Set())}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div className="lasm-bulk-need">
                    <button type="button" className="lasm-need-btn lasm-need-bulk is-yes"
                      onClick={() => setNeedBulk('agreement', Array.from(selectedIds), true)}>
                      Mark Necessary
                    </button>
                    <button type="button" className="lasm-need-btn lasm-need-bulk"
                      onClick={() => setNeedBulk('agreement', Array.from(selectedIds), false)}>
                      Mark Not necessary
                    </button>
                  </div>
                  <button
                    type="button"
                    className="lasm-bulk-send"
                    onClick={() => handleSend(selectedAgreementRows)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    {`Send Selected (${selectedAgreementRows.filter(a => a.needed === true).length})`}
                  </button>
                </div>
              )}
              </>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Signing activity tracker (shared modal) — opened from the history
          icon on any sent trade-doc / agreement row. */}
      {trackerFor && (
        <SigningTrackerModal
          sigId={trackerFor.sigId}
          code={trackerFor.code}
          onClose={() => setTrackerFor(null)}
        />
      )}

      {/* The PI's own signature flow — the same modal the Evidence Vault and
          the Q/PI stage open, so the invoice is sent one way from everywhere. */}
      {piSend && leadId && (
        <SalesDocSendForSignatureModal
          open
          kind="pi"
          docId={piSend.id}
          docCode={piSend.code}
          leadId={leadId}
          customerName={payload?.lead?.customer?.name ?? null}
          onClose={() => setPiSend(null)}
          onSent={() => { setPiSend(null); onSent?.(); }}
        />
      )}

      {/* Send-for-Signature modal — reuses the customer/consignee
          trade-doc preview UI (mode="agreement") so the workplace
          flow shows the SAME preview pane the user sees on the
          trade-doc tab. Backend wiring branches to the agreement
          preview/send endpoints inside the modal. */}
      <SalesCustomerSendForSignatureModal
        open={ssfAgreements.length > 0}
        customer={null}
        mode="agreement"
        agreementContext={ssfAgreements.length > 0 && leadId ? (() => {
          /* All agreements in a bulk-send share the same applicable
           * party (the same-party guard is enforced both client- and
           * server-side), so we read the CSV from the first agreement
           * and intersect it with the lead's mapped customer/
           * consignee to build the active signer list. The recipient
           * card and the per-signer draggable signature boxes both
           * iterate this array, so an agreement scoped to "Buyer"
           * only never surfaces the consignee, and a
           * "Buyer, Consignee" agreement gets two independent boxes.
           *
           * Unmapped parties (e.g. agreement expects Consignee but
           * the lead has no consignee_id) are still emitted into the
           * signers array but with email=null, so the modal renders
           * a disabled box + warning row for them. Without this the
           * modal silently dropped the unmapped party and the user
           * couldn't tell why their multi-signer agreement only
           * showed one signature box. */
          const partyTokens = String(ssfAgreements[0].party ?? '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
          const wantsBuyer     = partyTokens.includes('buyer');
          const wantsConsignee = partyTokens.includes('consignee');
          const signers: AgreementSigner[] = [];
          if (wantsBuyer) {
            signers.push({
              role: 'buyer',
              name:  payload?.lead.customer?.name  ?? '⚠ Customer not mapped',
              email: payload?.lead.customer?.email ?? null,
            });
          }
          if (wantsConsignee) {
            signers.push({
              role: 'consignee',
              name:  payload?.lead.consignee?.name  ?? '⚠ Consignee not mapped',
              email: payload?.lead.consignee?.email ?? null,
            });
          }
          // Diagnostic — visible in DevTools so the operator can see
          // exactly which signers got built when the modal opens.
          // eslint-disable-next-line no-console
          console.debug('[agreement-send] resolved signers', {
            leadId,
            partyCsv: ssfAgreements[0].party,
            wantsBuyer,
            wantsConsignee,
            customer:  payload?.lead.customer  ?? null,
            consignee: payload?.lead.consignee ?? null,
            signers,
          });
          return {
            leadId,
            agreements: ssfAgreements.map<AgreementSendRow>(a => ({
              id:             a.id,
              code:           a.code,
              title:          a.title,
              agreement_type: a.agreement_type,
              party:          a.party,
              content:        a.content       ?? null,
              header_config:  a.header_config ?? null,
              footer_config:  a.footer_config ?? null,
            })),
            signers,
          };
        })() : null}
        onClose={() => setSsfAgreements([])}
        onSent={() => { void onSsfSent(); }}
      />

      {/* Trade Documents → Send for Signature (Zoho Sign). Reuses the same
          wizard in trade-doc mode; the signer is the active party tab, so
          modelName + recipient flip between Customer and Consignee.

          The "Buyer + Consignee" tab is special: those documents must be
          signed by BOTH parties, so we hand the wizard a two-entry
          `tradeSigners` list (buyer + consignee) and it renders two
          independent signature boxes + sends to both — exactly like the
          agreement flow. Single-party tabs (Buyer / Consignee) and the flat
          buyer==consignee list keep the original single-signer behaviour. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(tdSendIds)}
        mode="trade-doc"
        modelName={tdSignRole === 'customer' ? 'Customer' : 'Consignee'}
        customer={tdSignCustomer}
        leadId={leadId ?? null}
        preselectedDocIds={tdSendIds ?? undefined}
        tradeSigners={
          (!buyerEqualsConsignee && tdTab === 'both')
            ? [
                {
                  role:  'buyer',
                  name:  payload?.lead.customer?.name  ?? '⚠ Customer not mapped',
                  email: payload?.lead.customer?.email ?? null,
                },
                {
                  role:  'consignee',
                  name:  payload?.lead.consignee?.name  ?? '⚠ Consignee not mapped',
                  email: payload?.lead.consignee?.email ?? null,
                },
              ]
            : null
        }
        onClose={() => setTdSendIds(null)}
        onSent={() => { void onTdSent(); }}
      />

      {/* Applicable-party "+N" popover — titled list of every party the row
          applies to, same interaction as the segment "+N" popovers. */}
      {partyPop && createPortal(
        <>
          <div onClick={() => setPartyPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 12000 }} />
          <div
            className="lasm-party-pop"
            style={{ position: 'fixed', left: Math.min(partyPop.x, window.innerWidth - 230), top: partyPop.y, zIndex: 12001 }}
          >
            <div className="lasm-party-pop-title">Applicable Party ({partyPop.names.length})</div>
            {partyPop.names.map((n, i) => (
              <div key={i} className="lasm-party-pop-row">
                <span className="lasm-party-pill lasm-party-agr">{n}</span>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>,
    document.body,
  );
}

/* DD-Mon-YYYY (e.g. 10-Aug-2026) — the app's standard date shape.
 * Full month names wrapped the column onto two lines ("10-August-
2026") and
 * read differently from every other date on screen. Backend sends a bare Y-m-d. */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDmyLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : `${String(d.getDate()).padStart(2, '0')}-${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`;
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  // Class-based (not inline) so dark mode can re-tint — inline styles would
  // win over the [data-bs-theme="dark"] rules.
  const tone =
      s === 'completed'  ? { cls: 'lasm-st-signed',   mark: '✓', label: 'Signed' }
    : s === 'inprogress' ? { cls: 'lasm-st-progress', mark: '◔', label: 'In Progress' }
    : s === 'declined'   ? { cls: 'lasm-st-declined', mark: '✕', label: 'Declined' }
    : s === 'recalled'   ? { cls: 'lasm-st-recalled', mark: '⤺', label: 'Recalled' }
    : s === 'expired'    ? { cls: 'lasm-st-expired',  mark: '⌛', label: 'Expired' }
    // No signature request yet (or a saved-but-unsent 'draft') reads as
    // "Pending" — nothing has been sent for signature at this point.
    :                      { cls: 'lasm-st-draft',    mark: '●', label: 'Pending' };
  return (
    <span className={`lasm-status-pill ${tone.cls}`}>
      {tone.mark} {tone.label}
    </span>
  );
}

/* ── Scoped CSS ────────────────────────────────────────────────────── */
const LASM_CSS = `
.lasm-overlay { position: fixed; inset: 0; z-index: 11500;
  background: rgba(15,23,42,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  font-family: var(--font-sans); animation: lasmFade .18s ease both; }
@keyframes lasmFade { from { opacity: 0 } to { opacity: 1 } }
/* Fixed height so the Agreements and Trade Documents views are always the
   same size — the table region inside scrolls when rows overflow. */
.lasm-shell { width: 100%; max-width: 1080px; height: min(620px, calc(100vh - 48px)); display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(15,23,42,.40); }
.lasm-head { display: flex; align-items: center; gap: 12px;
  padding: 16px 22px; color: #fff;
  background: linear-gradient(110deg,#4c1d95 0%,#6d28d9 40%,#7c3aed 80%,#8b5cf6 100%); }
.lasm-head-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lasm-head-text { flex: 1; min-width: 0; }
.lasm-head-title { font-size: 17px; font-weight: 800; letter-spacing: -.2px; }
.lasm-head-sub { font-size: 12px; opacity: .85; margin-top: 2px; }
.lasm-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.16); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; }
.lasm-close:hover { background: rgba(255,255,255,.28); }
.lasm-body { padding: 0; display: flex; flex-direction: column; overflow: hidden; flex: 1; min-height: 0; }
.lasm-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }
.lasm-empty-warn { color: #92400e; background: linear-gradient(110deg,rgba(251,191,36,.08),rgba(254,243,199,.40)); border-radius: 0; }
.lasm-tabs { display: flex; align-items: stretch; gap: 0; padding: 0 22px; flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0; background: #fff; overflow-x: auto; }
.lasm-tab { padding: 14px 18px; background: transparent; border: 0; border-bottom: 3px solid transparent;
  color: #64748b; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: color .15s ease, border-color .15s ease; }
.lasm-tab:hover { color: #6d28d9; }
.lasm-tab.is-on { color: #6d28d9; border-bottom-color: #6d28d9; }
.lasm-tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; margin-left: 7px; padding: 0 5px; border-radius: 9px; background: #e2e8f0; color: #475569; font-size: 10px; font-weight: 800; }
.lasm-tab.is-on .lasm-tab-count { background: #ede9fe; color: #6d28d9; }
/* Rounded card wrapper — mirrors the Evidence Vault's .lev-table-card so the
   table reads as a bordered, shadowed card with rounded corners. It's also the
   scroll container, so the sticky violet header clips to the rounded top. */
.lasm-table-wrap { margin: 16px 22px 18px; flex: 1 1 0; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #eceef3; border-radius: 14px;
  box-shadow: 0 1px 3px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.05); }
/* Rows scroll here; the pager below stays pinned to the panel bottom. */
.lasm-table-scroll, .lasm-td-scroll { flex: 1 1 0; min-height: 0; overflow: auto; }
.lasm-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
/* Header row matches the popup's violet header — a flat fill so every column
   reads as one continuous bar (a per-cell gradient would segment). */
.lasm-table thead th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 14px 18px; font-size: 10.5px; font-weight: 800; letter-spacing: .10em; text-transform: uppercase; white-space: nowrap; color: #fff; background: linear-gradient(180deg, #4c1d95 0%, #6d28d9 100%); }
.lasm-table tbody td { padding: 14px 18px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #1e293b; }
.lasm-table tbody tr:last-child td { border-bottom: none; }
.lasm-table tbody tr:hover td { background: #fafbff; }
.lasm-empty-row { text-align: center; color: #94a3b8; padding: 22px !important; }
.lasm-mono { font-family: 'Geist Mono', ui-monospace, monospace; color: #64748b; }
.lasm-doc-name { font-weight: 700; color: #4c1d95; }
.lasm-doc-sub  { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
.lasm-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .06em; }
.lasm-pill-req { background: #fee2e2; color: #b91c1c; }
.lasm-pill-opt { background: #fef3c7; color: #92400e; }

/* ── Top-level regulatory tier tabs: Highly / Less Regulated ── */
.lasm-tier-tabs { display: inline-flex; flex-shrink: 0; gap: 6px; padding: 6px; margin: 14px 22px 4px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 12px; }
.lasm-tier-tab { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border: none; background: transparent; border-radius: 9px; color: #475569; font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; transition: all .15s; }
.lasm-tier-tab:hover { background: rgba(15,23,42,.05); }
.lasm-tier-tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: rgba(15,23,42,.08); color: #475569; font-size: 10.5px; font-weight: 800; }
.lasm-tier-tab-highly.is-on { background: linear-gradient(135deg,#4c1d95,#6d28d9); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.32); }
.lasm-tier-tab-less.is-on { background: linear-gradient(135deg,#7c3aed,#a78bfa); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.28); }
.lasm-tier-tab.is-on .lasm-tier-tab-count { background: rgba(255,255,255,.28); color: #fff; }

/* ── Party tabs (Trade Documents view): Customer / Consignee. Each tab is a
      detail card — role + name + email + doc count. ── */
.lasm-party-tabs { display: grid; flex-shrink: 0; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px 22px 4px; }
.lasm-party-tab { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; text-align: left; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; cursor: pointer; font-family: inherit; transition: all .15s; }
.lasm-party-tab:hover { border-color: #cbd5e1; box-shadow: 0 2px 10px rgba(15,23,42,.06); }
/* Read-only detail cards (Trade Documents header) — not interactive. */
.lasm-party-tab-readonly { cursor: default; }
.lasm-party-tab-readonly:hover { box-shadow: none; }
.lasm-party-tab-role { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; }
.lasm-party-tab-count { position: absolute; top: 10px; right: 12px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 9px; border-radius: 999px; background: rgba(15,23,42,.06); color: #475569; font-size: 10.5px; font-weight: 800; }
/* Title row: "code: name" in column 1, country in column 2 — same 2-col grid
   as the Email/Segment row below, so COUNTRY lines up under SEGMENT. */
.lasm-party-tab-title-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; align-items: start; width: 100%; margin-top: 2px; }
.lasm-party-tab-name { font-size: 13.5px; font-weight: 800; color: #0f172a; line-height: 1.3; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lasm-party-tab-country { display: flex; flex-direction: column; gap: 1px; min-width: 0; text-align: left; font-size: 11.5px; font-weight: 600; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Detail row below: Email + Segment. */
.lasm-party-tab-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; width: 100%; margin-top: 8px; }
.lasm-party-tab-meta > span { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 11.5px; font-weight: 600; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lasm-party-tab-k { font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
.lasm-party-tab-customer.is-on { border-color: #6d28d9; background: linear-gradient(180deg,#faf5ff,#fff); box-shadow: 0 2px 10px rgba(124,58,237,.18); }
.lasm-party-tab-customer.is-on .lasm-party-tab-role { color: #6d28d9; }
.lasm-party-tab-consignee.is-on { border-color: #6d28d9; background: linear-gradient(180deg,#faf5ff,#fff); box-shadow: 0 2px 10px rgba(124,58,237,.18); }
.lasm-party-tab-consignee.is-on .lasm-party-tab-role { color: #6d28d9; }
.lasm-party-tab.is-on .lasm-party-tab-count { background: rgba(15,23,42,.10); color: #0f172a; }

/* ── Sub-tabs within a segment (e.g. Buyer / Consignee / Both agreements) ── */
.lasm-subtabs { display: inline-flex; flex-shrink: 0; gap: 4px; padding: 4px; margin: 4px 0 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; }
.lasm-subtabs-inset { align-self: flex-start; margin: 10px 22px 2px; }
.lasm-subtab { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border: none; background: transparent; border-radius: 7px; color: #64748b; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; }
.lasm-subtab:hover { background: rgba(124,58,237,.08); color: #6d28d9; }
.lasm-subtab.is-on { background: linear-gradient(135deg,#8b5cf6,#6d28d9); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.32); }
.lasm-subtab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(124,58,237,.14); color: #6d28d9; font-size: 10px; font-weight: 800; }
.lasm-subtab.is-on .lasm-subtab-count { background: rgba(255,255,255,.28); color: #fff; }
.lasm-party-cell { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.lasm-party-agr { background: #ede9fe; color: #5b21b6; }
/* Clickable "+N" party badge — opens the applicable-party popover. */
.lasm-party-more { border: none; cursor: pointer; font-family: inherit; transition: filter .12s; }
.lasm-party-more:hover { filter: brightness(.94); }
/* Applicable-party "+N" popover (titled list of pills). */
.lasm-party-pop { width: 210px; max-height: 300px; overflow-y: auto; background: #fff; border: 1px solid #e9e5f5; border-radius: 12px; box-shadow: 0 14px 34px rgba(76,29,149,.18), 0 4px 12px rgba(0,0,0,.08); padding: 10px; }
.lasm-party-pop-title { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #6d28d9; margin-bottom: 8px; }
.lasm-party-pop-row { padding: 3px 0; }
[data-bs-theme="dark"] .lasm-party-pop { background: #1e1b2e; border-color: rgba(148,163,184,.22); box-shadow: 0 14px 34px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .lasm-party-pop-title { color: #c4b5fd; }

/* ── Segment-wise Trade Documents panel (moved out of the per-party vault) ── */
/* Rounded card + violet gradient header — same recipe as the Agreements
   table (.lasm-table) so both Trade Documents and Agreements look identical. */
.lasm-td-panel { margin: 16px 22px 18px; border: 1px solid #eceef3; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.05); flex: 1 1 0; min-height: 0; }
.lasm-td-head { display: flex; align-items: center; gap: 7px; padding: 9px 12px; background: #f5f3ff; color: #4c1d95; font-size: 11.5px; font-weight: 800; letter-spacing: .02em; border-bottom: 1px solid #e2e8f0; }
.lasm-td-empty { padding: 14px 12px; color: #94a3b8; font-size: 11.5px; font-style: italic; }
/* Table pager — mirrors the Evidence Vault's lev-pager look. */
/* Only pin the WorklistPager to the panel bottom — its own .wl-pager band
   provides the padding / background / border (Customer-list reference style). */
.lasm-pager { flex-shrink: 0; }
.lasm-pager-info { font-size: 12px; font-weight: 600; color: #64748B; }
.lasm-pager-ctrls { display: inline-flex; align-items: center; gap: 6px; }
.lasm-pager-btn, .lasm-pager-num {
  min-width: 30px; height: 30px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; transition: all .14s ease;
}
.lasm-pager-btn svg { width: 14px; height: 14px; }
.lasm-pager-btn:hover:not(:disabled), .lasm-pager-num:hover:not(.active) { background: #F5F3FF; border-color: #ddd6fe; color: #6d28d9; }
.lasm-pager-btn:disabled { opacity: .45; cursor: not-allowed; }
.lasm-pager-num.active { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff; box-shadow: 0 3px 8px rgba(124,58,237,.30); }
[data-bs-theme="dark"] .lasm-pager { background: rgba(148,163,184,.06); border-top-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lasm-pager-info { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-pager-btn, [data-bs-theme="dark"] .lasm-pager-num { background: #1e293b; border-color: rgba(148,163,184,.30); color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-pager-num.active { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff; }
.lasm-td-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.lasm-td-table thead th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 14px 18px; font-size: 10.5px; font-weight: 800; letter-spacing: .10em; text-transform: uppercase; white-space: nowrap; color: #fff; background: linear-gradient(180deg, #4c1d95 0%, #6d28d9 100%); }
.lasm-td-table tbody td { padding: 14px 18px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.lasm-td-table tbody tr:last-child td { border-bottom: none; }
.lasm-td-table tbody tr:hover td { background: #fafbff; }
.lasm-td-table tbody tr.lasm-row-selected td { background: rgba(124,58,237,.06); }
.lasm-td-send { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(124,58,237,.30); background: linear-gradient(135deg,#8b5cf6,#6d28d9); color: #fff; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: filter .15s, opacity .15s; }
.lasm-td-send:hover:not(:disabled) { filter: brightness(1.06); }
.lasm-td-send:disabled { opacity: .45; cursor: not-allowed; }
/* Resend (declined / recalled / expired) — warm red-orange to distinguish it
   from a first-time send. Applies to both trade-doc and agreement send buttons. */
.lasm-td-resend { background: linear-gradient(135deg,#f97316,#dc2626) !important; border-color: rgba(220,38,38,.30) !important; }
.lasm-party-pill { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.lasm-party-customer  { background: #fef3c7; color: #92400e; }
.lasm-party-consignee { background: #d1fae5; color: #065f46; }
.lasm-td-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.lasm-td-status.is-ok { background: #dcfce7; color: #15803d; }
.lasm-td-status.is-pending { background: #f1f5f9; color: #64748b; }
.lasm-td-file { color: #6d28d9; font-weight: 700; font-size: 11.5px; text-decoration: none; }
.lasm-td-file:hover { text-decoration: underline; }
.lasm-td-dash { color: #cbd5e1; }
.lasm-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.lasm-st-signed   { background: #d1fae5; color: #047857; }
.lasm-st-progress { background: #dbeafe; color: #1e40af; }
.lasm-st-declined { background: #fee2e2; color: #b91c1c; }
.lasm-st-recalled { background: #fef3c7; color: #92400e; }
.lasm-st-expired  { background: #f3e8ff; color: #6b21a8; }
.lasm-st-draft    { background: #e2e8f0; color: #475569; }
.lasm-actions { display: inline-flex; gap: 6px; align-items: center; }
.lasm-btn-send { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px;
  background: linear-gradient(135deg,#8b5cf6,#6d28d9); color: #fff; border: none; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.lasm-btn-send:hover:not(.is-disabled):not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(124,58,237,.25); }
.lasm-btn-send.is-disabled, .lasm-btn-send:disabled { opacity: .55; cursor: not-allowed; }
.lasm-btn-eye, .lasm-btn-icon, .lasm-btn-cert { display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; cursor: pointer; text-decoration: none; transition: background .15s ease; }
.lasm-btn-eye { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.lasm-btn-eye:hover:not(:disabled) { background: #e0e7ff; color: #4338ca; }
.lasm-btn-eye:disabled { opacity: .55; cursor: not-allowed; }
.lasm-btn-icon { background: #f5f3ff; color: #6d28d9; border: 1px solid #c4b5fd; }
.lasm-btn-icon:hover:not(:disabled) { background: #ede9fe; }
.lasm-btn-icon:disabled { opacity: .45; cursor: not-allowed; }
.lasm-btn-cert { background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; }
.lasm-btn-cert:hover { background: #ddd6fe; }
.lasm-btn-remind { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 7px;
  background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.lasm-btn-remind:hover:not(:disabled) { background: #fde68a; border-color: #f59e0b; }
.lasm-btn-remind:disabled { opacity: .55; cursor: not-allowed; }
/* Reminder-count badge embedded in the Remind button. Pill-shaped so
   it sits visually flush with the icon + label inside the button. */
.lasm-remind-count { display: inline-flex; align-items: center; justify-content: center;
  margin-left: 2px; min-width: 18px; padding: 0 5px; height: 16px;
  border-radius: 999px; background: #92400e; color: #fff;
  font-family: 'Geist Mono', ui-monospace, monospace; font-size: 9.5px; font-weight: 800; letter-spacing: .02em; line-height: 1; }

.lasm-row-selected td { background: rgba(124,58,237,.06) !important; }

/* Same floating pill as My Workplace's lead bar (.lwp-bulk-bar).
   It was a pale sticky strip welded to the modal's bottom edge, which read as
   part of the table's chrome rather than as "you have a selection open". The
   floating bar says a selection exists and is dismissable — and one selection
   pattern across the app means it does not have to be re-learned per screen. */
.lasm-bulk-bar {
  /* In flow, not sticky. Sticky pins it to the bottom of its nearest scrolling
     ancestor — which for the trade-doc table is the scroll box around the rows,
     so the bar floated ON TOP of the entries it was meant to act on. The
     agreements one only looked right because it sits outside that box.
     Both now sit after their table and push the pager down instead. */
  position: relative; z-index: 5; flex-shrink: 0;
  margin: 6px auto 10px; width: fit-content; max-width: calc(100% - 24px);
  display: flex; align-items: center; gap: 12px; white-space: nowrap;
  padding: 11px 18px; border-radius: 16px;
  background: linear-gradient(135deg, #4c1d95, #7c3aed);
  box-shadow: 0 12px 40px rgba(124,58,237,.45), 0 4px 14px rgba(0,0,0,.18);
  animation: lasmBulkIn .22s cubic-bezier(.22,1,.36,1);
}
@keyframes lasmBulkIn { from { opacity: 0; transform: translateY(14px); } }
.lasm-bulk-info { font-size: 12.5px; font-weight: 700; color: #fff; display: inline-flex; align-items: center; gap: 10px; }
.lasm-bulk-info strong { font-size: 13px; }
.lasm-bulk-info em { font-style: normal; font-family: 'Geist Mono', ui-monospace, monospace;
  color: #fff; padding: 2px 8px; background: rgba(255,255,255,.16); border-radius: 6px; border: 1px solid rgba(255,255,255,.25); }
.lasm-bulk-clear { display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0;
  background: rgba(255,255,255,.14); border: 1.5px solid rgba(255,255,255,.25); color: #fff;
  border-radius: 8px; cursor: pointer; transition: background .15s; }
.lasm-bulk-clear:hover { background: rgba(255,255,255,.22); }
.lasm-bulk-send { display: inline-flex; align-items: center; gap: 7px; padding: 8px 18px; border-radius: 10px;
  background: #fff; color: #7c3aed; border: none; box-shadow: 0 2px 8px rgba(0,0,0,.12);
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background .15s, transform .15s ease; }
.lasm-bulk-send:hover:not(:disabled) { background: #f5f3ff; }
.lasm-bulk-send:disabled { opacity: .5; cursor: not-allowed; }
.lasm-btn-send:disabled { opacity: .45; cursor: not-allowed; }
.lasm-bulk-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(124,58,237,.30); }
.lasm-bulk-send:disabled { opacity: .55; cursor: not-allowed; }

/* Posing pane CSS removed — the agreement Send-for-Signature preview
   now renders inside SalesCustomerSendForSignatureModal, which carries
   its own SSF_CSS for the preview pane, doc rail, sig overlay,
   coord pane and recipient card. */

/* ── Dark mode overrides ──
 * The modal shell, segment-tab strip, document table and bulk-action
 * bar are all hard-coded to light surfaces. Without these the whole
 * modal renders as a near-white card on the dark workplace background. */
[data-bs-theme="dark"] .lasm-shell {
  background: #0f172a;
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(139,92,246,.20);
}
[data-bs-theme="dark"] .lasm-empty { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-empty-warn {
  color: #fcd34d;
  background: linear-gradient(110deg, rgba(251,191,36,.08), rgba(217,119,6,.18));
}
[data-bs-theme="dark"] .lasm-tabs {
  background: #0f172a;
  border-bottom-color: rgba(139,92,246,.22);
}
[data-bs-theme="dark"] .lasm-tab { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-tab:hover { color: #c4b5fd; }
[data-bs-theme="dark"] .lasm-tab.is-on {
  color: #c4b5fd;
  border-bottom-color: #8b5cf6;
}
[data-bs-theme="dark"] .lasm-table-wrap {
  background: #1e293b; border-color: rgba(139,92,246,.22);
  box-shadow: 0 1px 3px rgba(0,0,0,.30), 0 8px 18px rgba(0,0,0,.25);
}
[data-bs-theme="dark"] .lasm-table thead th {
  color: #ffffff;
  background: linear-gradient(180deg, #4c1d95 0%, #6d28d9 100%);
}
[data-bs-theme="dark"] .lasm-table tbody td {
  color: #e2e8f0;
  border-bottom-color: rgba(139,92,246,.10);
}
[data-bs-theme="dark"] .lasm-table tbody tr:hover td { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .lasm-empty-row { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-mono { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-doc-name { color: #c4b5fd; }
[data-bs-theme="dark"] .lasm-doc-sub  { color: #94a3b8; }
.lasm-pi-row { background: rgba(124,58,237,.05); }
.lasm-pi-row td { border-bottom: 1.5px solid rgba(124,58,237,.18) !important; }

.lasm-need-row { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
.lasm-need-tag {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 10px; font-weight: 800; letter-spacing: .03em; white-space: nowrap;
}
.lasm-need-tag.is-yes  { background: #d9f5f0; color: #0a8a78; }
.lasm-need-tag.is-no   { background: #eef1f5; color: #64748b; }
.lasm-need-tag.is-none { background: #eef1f5; color: #94a3b8; }
.lasm-need-btn {
  min-width: 42px; padding: 4px 12px; white-space: nowrap;
  border-radius: 999px; border: 1px solid #e2e8f0;
  font-size: 10.5px; font-weight: 800; letter-spacing: .03em; line-height: 1.5;
  transition: background .12s, color .12s, border-color .12s;
}
.lasm-need-btn:disabled { opacity: .6; }
/* Shown only while the answer is still null. Wording matters: the row is not
   "optional", nobody has decided about it yet. */
.lasm-bulk-need { display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; }
.lasm-need-bulk { min-width: 0; padding: 7px 14px; font-size: 11px; border-radius: 10px;
  background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.25); color: #fff; }
/* White, like the reference bar's primary. Marking is the action people come
   to this bar for; sending is what they do after. */
.lasm-need-bulk.is-yes { background: #fff; border-color: #fff; color: #7c3aed; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
.lasm-need-bulk.is-yes:hover { background: #f5f3ff; }
.lasm-need-bulk:not(.is-yes):hover { background: rgba(255,255,255,.24); }

.lasm-need-undecided {
  font-size: 9.5px; font-weight: 700; color: #b45309;
  background: #fef3c7; border-radius: 999px; padding: 2px 8px; white-space: nowrap;
}

/* REQ / OPT pills — bump the tinted backgrounds and brighten the text
 * so they read against the dark row instead of looking like washed-out
 * pastel patches. */
[data-bs-theme="dark"] .lasm-pill-req {
  background: rgba(239,68,68,.20); color: #fca5a5;
}
[data-bs-theme="dark"] .lasm-pill-opt {
  background: rgba(245,158,11,.20); color: #fcd34d;
}
[data-bs-theme="dark"] .lasm-st-signed   { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .lasm-st-progress { background: rgba(59,130,246,.20); color: #93c5fd; }
[data-bs-theme="dark"] .lasm-st-declined { background: rgba(239,68,68,.18);  color: #fca5a5; }
[data-bs-theme="dark"] .lasm-st-recalled { background: rgba(245,158,11,.18); color: #fde68a; }
[data-bs-theme="dark"] .lasm-st-expired  { background: rgba(168,85,247,.22); color: #d8b4fe; }
[data-bs-theme="dark"] .lasm-st-draft    { background: rgba(148,163,184,.20); color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-tier-tabs { background: rgba(30,41,59,.55); border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lasm-tier-tab { color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-tier-tab:hover { background: rgba(148,163,184,.12); }
[data-bs-theme="dark"] .lasm-tier-tab-count { background: rgba(148,163,184,.18); color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-tier-tab.is-on .lasm-tier-tab-count { background: rgba(255,255,255,.28); color: #fff; }

[data-bs-theme="dark"] .lasm-party-tab { background: rgba(30,41,59,.55); border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lasm-party-tab:hover { border-color: rgba(148,163,184,.32); }
[data-bs-theme="dark"] .lasm-party-tab-name { color: #f1f5f9; }
[data-bs-theme="dark"] .lasm-party-tab-country,
[data-bs-theme="dark"] .lasm-party-tab-meta > span { color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-party-tab-count { background: rgba(148,163,184,.18); color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-party-tab-customer.is-on { border-color: #a78bfa; background: rgba(124,58,237,.16); }
[data-bs-theme="dark"] .lasm-party-tab-consignee.is-on { border-color: #a78bfa; background: rgba(124,58,237,.16); }
[data-bs-theme="dark"] .lasm-party-tab.is-on .lasm-party-tab-count { background: rgba(255,255,255,.16); color: #f1f5f9; }

[data-bs-theme="dark"] .lasm-subtabs { background: rgba(30,41,59,.55); border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lasm-subtab { color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-subtab:hover { background: rgba(124,58,237,.16); color: #c4b5fd; }
[data-bs-theme="dark"] .lasm-subtab-count { background: rgba(124,58,237,.22); color: #ddd6fe; }
[data-bs-theme="dark"] .lasm-subtab.is-on .lasm-subtab-count { background: rgba(255,255,255,.28); color: #fff; }
[data-bs-theme="dark"] .lasm-party-agr { background: rgba(124,58,237,.20); color: #ddd6fe; }
[data-bs-theme="dark"] .lasm-td-panel { background: #1e293b; border-color: rgba(139,92,246,.22); box-shadow: 0 1px 3px rgba(0,0,0,.30), 0 8px 18px rgba(0,0,0,.25); }
[data-bs-theme="dark"] .lasm-td-head { background: rgba(124,58,237,.14); color: #c4b5fd; border-bottom-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lasm-td-table thead th { background: linear-gradient(180deg, #4c1d95 0%, #6d28d9 100%); color: #fff; }
[data-bs-theme="dark"] .lasm-td-table tbody td { color: #e2e8f0; border-bottom-color: rgba(139,92,246,.10); }
[data-bs-theme="dark"] .lasm-td-table tbody tr:hover td { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .lasm-td-table tbody tr.lasm-row-selected td { background: rgba(124,58,237,.16); }
[data-bs-theme="dark"] .lasm-party-customer  { background: rgba(245,158,11,.20); color: #fcd34d; }
[data-bs-theme="dark"] .lasm-party-consignee { background: rgba(16,185,129,.20); color: #6ee7b7; }
[data-bs-theme="dark"] .lasm-td-status.is-ok { background: rgba(34,197,94,.20); color: #86efac; }
[data-bs-theme="dark"] .lasm-td-status.is-pending { background: rgba(148,163,184,.16); color: #cbd5e1; }
[data-bs-theme="dark"] .lasm-row-selected td { background: rgba(124,58,237,.16) !important; }
[data-bs-theme="dark"] .lasm-btn-eye {
  background: rgba(124,58,237,.10); color: #c4b5fd; border-color: rgba(139,92,246,.30);
}
[data-bs-theme="dark"] .lasm-btn-eye:hover:not(:disabled) {
  background: rgba(124,58,237,.22); color: #ede9fe;
}
[data-bs-theme="dark"] .lasm-btn-icon {
  background: rgba(124,58,237,.12); color: #c4b5fd; border-color: rgba(103,232,249,.35);
}
[data-bs-theme="dark"] .lasm-btn-icon:hover:not(:disabled) { background: rgba(124,58,237,.24); }
[data-bs-theme="dark"] .lasm-btn-cert {
  background: rgba(124,58,237,.18); color: #ede9fe; border-color: rgba(103,232,249,.40);
}
[data-bs-theme="dark"] .lasm-btn-cert:hover { background: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .lasm-btn-remind {
  background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(245,158,11,.40);
}
[data-bs-theme="dark"] .lasm-btn-remind:hover:not(:disabled) {
  background: rgba(245,158,11,.30); border-color: #f59e0b;
}
[data-bs-theme="dark"] .lasm-bulk-bar {
  background: linear-gradient(110deg, rgba(124,58,237,.16), rgba(124,58,237,.10));
  border-top-color: rgba(139,92,246,.35);
  box-shadow: 0 -6px 14px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .lasm-bulk-info { color: #ede9fe; }
[data-bs-theme="dark"] .lasm-bulk-info em {
  color: #c4b5fd; background: #0f172a; border-color: rgba(103,232,249,.40);
}
[data-bs-theme="dark"] .lasm-bulk-clear {
  border-color: rgba(103,232,249,.35); color: #c4b5fd;
}
[data-bs-theme="dark"] .lasm-bulk-clear:hover { background: rgba(124,58,237,.18); }
`;
