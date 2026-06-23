import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import ClmInsertTableModal from '../clm/ClmInsertTableModal';
import ClmInsertHrModal from '../clm/ClmInsertHrModal';
import ClmInsertPlaceholderModal from '../clm/ClmInsertPlaceholderModal';
import ClmClauseInsertPanel from '../clm/ClmClauseInsertPanel';
import ClmRichTextToolbar from '../clm/ClmRichTextToolbar';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;



export type SendForSignatureCustomer = {
  id: string;
  db_id?: number;
  company: string;
  contact?: string;
  email?: string;
};

type TradeDoc = {
  id: number;
  code: string;
  name: string;
  title: string;
  doc_type?: string;
  purpose?: string;
  party?: string;
  content?: string | null;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};

type Signer = {
  email: string;
  name: string;
  order?: number;
};

export type DocSettings = {
  x: number;
  y: number;
  page: number;
  width: number;
  height: number;
};

export const DEFAULTS: DocSettings = { x: 380, y: 720, page: 0, width: 150, height: 45 };
export type SignerRoleKey = 'buyer' | 'consignee' | 'supplier';
export const SIGNER_DEFAULTS: Record<SignerRoleKey, DocSettings> = {
  buyer:     { x:  60, y: 720, page: 0, width: 150, height: 45 },
  consignee: { x: 380, y: 720, page: 0, width: 150, height: 45 },
  supplier:  { x: 220, y: 720, page: 0, width: 150, height: 45 },
};

const ROLE_TO_MARKER_TOKEN: Record<SignerRoleKey, 'customer' | 'consignee' | 'supplier'> = {
  buyer:     'customer',
  consignee: 'consignee',
  supplier:  'supplier',
};

export const A4_W = 595;
export const A4_H = 842;


export type AgreementSendRow = {
  id: number;
  code: string | null;
  title: string;
  agreement_type?: string | null;
  party?: string | null;
  content?: string | null;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};


export type AgreementSignerRole = 'buyer' | 'consignee' | 'supplier';

export type AgreementSigner = {
  role: AgreementSignerRole;
  name: string;
  email: string | null;
};

export type AgreementContext = {
  leadId: number;

  agreements: AgreementSendRow[];
  /* Active signers for this bundle. The caller pre-filters by each
   * agreement's `party` CSV (all agreements in a bulk-send share the
   * same party set — backend enforces it), so a Buyer-only agreement
   * sends [{role:'buyer',...}] and a Buyer+Consignee agreement sends
   * both entries. The preview renders one draggable signature box
   * per entry, and the Send payload carries per-role coords keyed by
   * `role` so each signer's signature lands at its own position. */
  signers: AgreementSigner[];
};

interface Props {
  open: boolean;
  customer: SendForSignatureCustomer | null;
  onClose: () => void;
  onSent?: (sentDocIds: number[]) => void;
  /** Pre-checked Trade Document IDs when launched from the party's
   * Stage 3 Trade Documents tab — the user can still toggle them off
   * or add more before sending. */
  preselectedDocIds?: number[];
  /** Party model the send is bound to — drives both the request body's
   * `model_name` and which token namespace gets resolved by the
   * controller's replacePlaceholders. Defaults to 'Customer' for the
   * existing caller. */
  modelName?: 'Customer' | 'Consignee' | 'Vendor';
  /** Switches the modal between the original trade-doc flow and the
   * agreement-send flow used by the workplace's Segment Details card.
   * Default keeps every existing caller (customer / consignee /
   * vendor modals) on the trade-doc behaviour. */
  mode?: 'trade-doc' | 'agreement';
  /** Required when mode === 'agreement'. Carries the lead + the
   * preselected agreements so the modal can skip its picker step and
   * dispatch to the agreement preview/send endpoints. */
  agreementContext?: AgreementContext | null;
  /** Optional lead scope for trade-doc mode. When set, the trade-doc send is
   * tied to this opportunity (lead_id), so the Sales-Matrix popup can resolve
   * its signature status, Remind, and signed/certificate downloads. */
  leadId?: number | null;
  /** Trade-doc mode only — the resolved party signers for a multi-party
   * "Buyer + Consignee" send. When present (≥2 entries), the modal switches
   * to the same per-role flow agreements use: one draggable signature box per
   * signer, per-role coordinates, and a multi-signer recipient card. Absent
   * for single-party buckets and standalone vault sends, which keep the
   * original single-signer behaviour. Mirrors AgreementContext.signers. */
  tradeSigners?: AgreementSigner[] | null;
}

export default function SalesCustomerSendForSignatureModal({
  open,
  customer,
  onClose,
  onSent,
  preselectedDocIds,
  modelName = 'Customer',
  mode = 'trade-doc',
  agreementContext = null,
  leadId = null,
  tradeSigners = null,
}: Props) {
  const isAgreement = mode === 'agreement';
  const toast = useToast();

  /* Unified per-role signer list. Agreement mode reads it from the
   * agreementContext; trade-doc mode reads it from the `tradeSigners` prop
   * (set only for a multi-party "Buyer + Consignee" send). `roleMode` gates
   * the per-role signature-box UI + per-role coordinate payload — it's true
   * for every agreement send and for a Buyer+Consignee trade-doc send, and
   * false for single-signer trade-doc sends (vault + Buyer-only / Consignee-
   * only buckets), which keep their original single-box behaviour. */
  const roleSigners: AgreementSigner[] = isAgreement
    ? (agreementContext?.signers ?? [])
    : (tradeSigners ?? []);
  const roleMode = roleSigners.length > 0;

  const [step, setStep] = useState<1 | 2>(1);
  const [docs, setDocs] = useState<TradeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [isSequential, setIsSequential] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  const [notes, setNotes] = useState('Please review and sign these documents.');

  const [settings, setSettings] = useState<Record<number, DocSettings>>({});
  /* Agreement mode only — per-doc-per-signer coord map. Trade-doc mode
   * keeps using the flat `settings` map above so its existing single-
   * signer behaviour is unchanged. Active role decides which slice
   * the coord pane drives and which overlay accepts pointer drags. */
  const [signerSettings, setSignerSettings] =
    useState<Record<number, Partial<Record<SignerRoleKey, DocSettings>>>>({});
  const [activeSignerRole, setActiveSignerRole] = useState<SignerRoleKey | null>(null);
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /* True once the active doc's preview PDF is loaded into pdf.js and ready
   * to paint onto the canvas. Replaces the old <iframe>: we render ONE page
   * at a time onto a canvas with Prev/Next nav (matching the Quotation/PI
   * send modal) so there's no second browser PDF scrollbar. */
  const [pdfRenderReady, setPdfRenderReady] = useState(false);
  /* Total page count of the active doc's preview PDF — populated by the
   * PDF.js loader so the page input can be range-limited and a "page X
   * of Y" hint can be shown. Kept per modal-open (no per-doc map needed
   * since switching docs reloads the preview anyway). */
  const [pageCount, setPageCount] = useState<number>(1);

  const [sending, setSending] = useState(false);

  /* ── Per-doc page-shell overrides (header / footer / body content).
   * Seeded from each trade-doc row's saved values when the user enters
   * step 2 for that doc; mutated by the inline editor (Edit Header /
   * Footer side panel + Insert Table modal) and POSTed alongside
   * /preview + /send so the rendered PDF reflects the tweaks WITHOUT
   * mutating the saved row.
   *
   * Per-doc rather than global because each trade-doc draft has its own
   * brand band on Stage 2 — the user might want to keep their NDA
   * footer one way and their Commercial Invoice footer another. */
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, HeaderConfig>>({});
  const [footerOverrides, setFooterOverrides] = useState<Record<number, FooterConfig>>({});
  const [contentOverrides, setContentOverrides] = useState<Record<number, string>>({});

  /* Side-panel mode: when true the Signature Position pane swaps for the
   * HeaderFooterPanel editor. User-visible Save / Cancel buttons commit
   * the pending edits into the per-doc overrides and reload the preview. */
  const [editingShell, setEditingShell] = useState(false);
  const [pendingHeader, setPendingHeader] = useState<HeaderConfig>(DEFAULT_HEADER);
  const [pendingFooter, setPendingFooter] = useState<FooterConfig>(DEFAULT_FOOTER);

  /* Insert Table / HR / Placeholder modals — shared with the draft
   * editor. Each stashes the current caret BEFORE opening so the
   * inserted HTML lands at the right spot in the in-progress body edit. */
  const [tablePickerOpen, setTablePickerOpen]       = useState(false);
  const [hrPickerOpen, setHrPickerOpen]             = useState(false);
  const [placeholderPickerOpen, setPlaceholderPickerOpen] = useState(false);
  const [clausePickerOpen, setClausePickerOpen] = useState(false);
  const contentEditorRef = useRef<HTMLDivElement | null>(null);
  const contentLastRangeRef = useRef<Range | null>(null);
  const stashContentSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && contentEditorRef.current?.contains(sel.anchorNode)) {
      contentLastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    // Don't clobber the previous stash when the new selection is OUTSIDE
    // the editor — that's the case while a modal is open (focus jumped
    // to the modal). We want to remember the LAST in-editor caret so
    // insertions land where the user was last typing.
  };

  /* Track the user's last caret position inside the body editor — every
   * `selectionchange` event that lands inside the editor updates the
   * stash. Without this, clicking the toolbar's HR / Table / Placeholder
   * buttons would only stash if the user happened to right-click or
   * hadn't yet moved focus to a modal, and a fresh popup with no body
   * click would have no caret at all — causing insertions to default to
   * the top of the editor. With the listener, every in-body click /
   * keystroke updates contentLastRangeRef, and modal openings (which
   * move focus AWAY from the editor) leave the stash untouched. */
  useEffect(() => {
    if (!editingShell) return;
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && contentEditorRef.current?.contains(sel.anchorNode)) {
        contentLastRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [editingShell]);

  /* Seed the editor's innerHTML imperatively when the popup opens or
   * the active doc changes. Intentionally NOT keyed on contentOverrides
   * — pushing state-driven HTML back into the editor via React would
   * wipe the DOM on every keystroke / execCommand, losing the caret +
   * just-inserted nodes (which was the "HR lands at the top" bug).
   * Once seeded, the editor owns its own DOM; user typing fires
   * onInput → setContentOverrides one-way for the eventual /preview
   * + /send payloads. */
  useEffect(() => {
    if (!editingShell || !activeDocId) return;
    const editor = contentEditorRef.current;
    if (!editor) return;
    const seed = contentOverrides[activeDocId] ?? (docs.find(d => d.id === activeDocId)?.content ?? '');
    editor.innerHTML = seed ?? '';
    contentLastRangeRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingShell, activeDocId]);

  /* Drop HTML / a placeholder token at the stashed caret in the body
   * editor, then push the new innerHTML into contentOverrides so the
   * /preview re-render reflects it. Used by Insert Table / Insert HR /
   * Insert Placeholder modals and by the rich-text toolbar's onChange
   * sync. activeDocId is captured at call-time. */
  const insertIntoBody = (html: string, mode: 'html' | 'text' = 'html') => {
    if (!activeDocId) return;
    const editor = contentEditorRef.current;
    if (editor) {
      editor.focus();
      const stash = contentLastRangeRef.current;
      const stashValid = stash && editor.contains(stash.startContainer);
      const sel = window.getSelection();
      if (stashValid && sel) {
        // Restore the last in-editor caret so the insertion lands where
        // the user was typing — not at the top of the editor (which is
        // what `editor.focus()` defaults to when no selection is set).
        sel.removeAllRanges();
        sel.addRange(stash);
      } else if (sel) {
        // User never placed a caret in the body (opened the popup and
        // jumped straight to a toolbar modal). Collapse the selection
        // to the END of the editor's contents so the new HTML appends
        // after existing text — much closer to user intent than the
        // top-default.
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand(mode === 'text' ? 'insertText' : 'insertHTML', false, html);
      // Re-stash so subsequent inserts during the same modal session
      // chain naturally instead of all landing at the original caret.
      const newSel = window.getSelection();
      if (newSel && newSel.rangeCount > 0 && editor.contains(newSel.anchorNode)) {
        contentLastRangeRef.current = newSel.getRangeAt(0).cloneRange();
      }
      setContentOverrides(prev => ({ ...prev, [activeDocId]: editor.innerHTML }));
    } else {
      // Editor not mounted yet (popup just opening) — append to the
      // current override / saved content so the change still lands.
      setContentOverrides(prev => {
        const seed = prev[activeDocId] ?? (docs.find(d => d.id === activeDocId)?.content ?? '');
        return { ...prev, [activeDocId]: (seed ?? '') + html };
      });
    }
  };
  const syncBodyFromEditor = () => {
    if (!activeDocId) return;
    const editor = contentEditorRef.current;
    if (!editor) return;
    setContentOverrides(prev => ({ ...prev, [activeDocId]: editor.innerHTML }));
  };

  /* ── Reset when the modal opens. Trigger ONLY on the `open` edge and
   * when the bound customer.db_id actually changes — NOT on every parent
   * render. The parent (AddCustomerModal) recreates its `customer` prop
   * on each render (form edits, polling, etc.); if we depended on the
   * object reference, the modal would re-reset state + re-fetch the
   * preview + nuke the user's drag positioning multiple times a second.
   * The primitive db_id is what genuinely identifies a "different
   * customer" worth re-initialising for. */
  useEffect(() => {
    if (!open) return;
    if (isAgreement) {
      // Agreement mode skips the picker step entirely — Segment Details
      // already chose which agreements ride this send. Signers are
      // server-resolved from the lead's customer/consignee, so the
      // editor is hidden and we seed display-only rows for the
      // recipient card.
      const ctx = agreementContext;
      const ids = (ctx?.agreements ?? []).map(a => a.id).slice(0, 10);
      const ctxSigners = ctx?.signers ?? [];
      setStep(2);
      setSelectedIds(ids);
      // Display-only signer rows for the recipient card — built from
      // the pre-filtered ctx.signers so a Buyer-only agreement never
      // surfaces the consignee, and vice-versa.
      const displaySigners: Signer[] = ctxSigners.length > 0
        ? ctxSigners.map((s, i) => ({ name: s.name, email: s.email ?? '', order: i + 1 }))
        : [{ name: '', email: '', order: 1 }];
      setSigners(displaySigners);
      setIsSequential(false);
      setExpiryDays(30);
      setNotes('Please review and sign these agreements.');
      setSettings({});
      // Seed per-doc-per-signer coords from SIGNER_DEFAULTS so the
      // preview opens with non-overlapping boxes for each role. Each
      // signer gets their own slot; user drags adjust the slot tied
      // to whichever signer tab is active.
      const seededSignerSettings: Record<number, Partial<Record<SignerRoleKey, DocSettings>>> = {};
      ids.forEach(id => {
        const perRole: Partial<Record<SignerRoleKey, DocSettings>> = {};
        ctxSigners.forEach(s => { perRole[s.role] = { ...SIGNER_DEFAULTS[s.role] }; });
        seededSignerSettings[id] = perRole;
      });
      setSignerSettings(seededSignerSettings);
      setActiveSignerRole(ctxSigners[0]?.role ?? null);
      setActiveDocId(ids[0] ?? null);
      setPreviewUrl(null);
      userOverrodeRef.current.clear();
      setHeaderOverrides({});
      setFooterOverrides({});
      setContentOverrides({});
      setEditingShell(false);
      return;
    }
    const hasPreselected = Array.isArray(preselectedDocIds) && preselectedDocIds.length > 0;
    const tradeRoleSigners = tradeSigners ?? [];
    const isTradeRoleMode  = tradeRoleSigners.length > 0;
    setStep(hasPreselected ? 2 : 1);
    const initialIds = hasPreselected ? preselectedDocIds!.slice(0, 10) : [];
    setSelectedIds(initialIds);
    // Multi-party trade send → seed display rows from the resolved role
    // signers (Buyer / Consignee). Single-party send → the single customer
    // contact, exactly as before.
    setSigners(isTradeRoleMode
      ? tradeRoleSigners.map((s, i) => ({ name: s.name, email: s.email ?? '', order: i + 1 }))
      : (customer
          ? [{ name: (customer.contact || customer.company || '').trim() || 'Signer 1', email: (customer.email || '').trim(), order: 1 }]
          : [{ name: '', email: '', order: 1 }]),
    );
    setIsSequential(false);
    setExpiryDays(30);
    setNotes('Please review and sign these documents.');
    setSettings({});
    // Per-role coord seeding (Buyer+Consignee trade doc) — one non-
    // overlapping box per signer, mirroring agreement mode. Empty for the
    // single-signer path, which keeps using the flat `settings` map.
    if (isTradeRoleMode) {
      const seeded: Record<number, Partial<Record<SignerRoleKey, DocSettings>>> = {};
      initialIds.forEach(id => {
        const perRole: Partial<Record<SignerRoleKey, DocSettings>> = {};
        tradeRoleSigners.forEach(s => { perRole[s.role] = { ...SIGNER_DEFAULTS[s.role] }; });
        seeded[id] = perRole;
      });
      setSignerSettings(seeded);
      setActiveSignerRole(tradeRoleSigners[0]?.role ?? null);
    } else {
      setSignerSettings({});
      setActiveSignerRole(null);
    }
    setActiveDocId(null);
    setPreviewUrl(null);
    userOverrodeRef.current.clear();
    // Drop per-doc page-shell overrides — fresh modal open seeds from
    // each row's saved config the first time it's previewed.
    setHeaderOverrides({});
    setFooterOverrides({});
    setContentOverrides({});
    setEditingShell(false);
  // preselectedDocIds, customer and tradeSigners are read at open-time only —
  // intentionally excluded from deps. db_id captures "different customer".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id, isAgreement, agreementContext?.leadId]);

  /* ── Fetch the trade-doc library when the modal opens (cached for the
   * lifetime of the modal — re-fetched on next open). The for-party
   * filter is tied to the modelName so the picker only surfaces drafts
   * declared applicable to this party type. */
  const partyFilter = modelName === 'Customer' ? 'buyer' : modelName === 'Consignee' ? 'consignee' : 'supplier';
  const partyToken: 'customer' | 'consignee' | 'supplier' =
    modelName === 'Customer' ? 'customer' : modelName === 'Consignee' ? 'consignee' : 'supplier';

  useEffect(() => {
    if (!open) return;
    if (isAgreement) {
      // Skip the trade-doc library fetch and stitch the picker-list
      // shape directly from the supplied agreement context. The picker
      // step is hidden in this mode, but the rail + active-doc lookup
      // still reads from `docs`, so we hydrate it with adapted rows.
      const adapted: TradeDoc[] = (agreementContext?.agreements ?? []).map(a => ({
        id:    a.id,
        code:  a.code ?? `A-${a.id}`,
        name:  a.title,
        title: a.title,
        doc_type: a.agreement_type ?? undefined,
        purpose:  a.party ?? undefined,
        content:       a.content       ?? null,
        header_config: a.header_config ?? null,
        footer_config: a.footer_config ?? null,
      }));
      setDocs(adapted);
      setDocsLoading(false);
      return;
    }
    setDocsLoading(true);
    api.get(`/clm/trade-doc-library/for-party/${partyFilter}`)
      .then(r => setDocs(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [open, partyFilter, isAgreement, agreementContext?.leadId]);

  /* ── Escape closes the modal whenever we're not mid-send. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  /* ── Default signature placement seeds on selection change so step 2
   * always has coords to render before the user touches anything. */
  useEffect(() => {
    setSettings(prev => {
      const next: Record<number, DocSettings> = { ...prev };
      selectedIds.forEach(id => { if (!next[id]) next[id] = { ...DEFAULTS }; });
      Object.keys(next).forEach(k => {
        const n = Number(k);
        if (!selectedIds.includes(n)) delete next[n];
      });
      return next;
    });
    if (selectedIds.length === 0) setActiveDocId(null);
    else if (!activeDocId || !selectedIds.includes(activeDocId)) setActiveDocId(selectedIds[0]);
  }, [selectedIds, activeDocId]);

  const selectedDocs = useMemo(() => selectedIds.map(id => docs.find(d => d.id === id)).filter(Boolean) as TradeDoc[], [selectedIds, docs]);

  /* Per-document set tracking whether the user has manually overridden
   * the signature box. Once they drag the overlay, we stop auto-snapping
   * back to the placeholder-detected position on subsequent fetches —
   * the dragged value is what they meant to use.
   *
   * Keys are strings to support BOTH the trade-doc flow (single signer,
   * key = `${docId}`) and the agreement flow (per-role, key =
   * `${docId}:${role}`). Without the per-role split, dragging the buyer
   * box would also freeze the consignee's auto-detect, which never gets
   * a chance to seed from the {{consignee.signature}} placeholder. */
  const userOverrodeRef = useRef<Set<string>>(new Set());

  /* ── Re-render the preview blob when step 2 changes its active doc.
   * After the PDF lands we also run a PDF.js pass over the bytes to find
   * the «CBC-SIG-CUSTOMER-9417» marker the controller embedded inside the
   * sig-box — that position becomes the default for the draggable
   * overlay. Detection is best-effort: if it fails, we fall back to the
   * pre-existing default (bottom-right of page 1). */
  useEffect(() => {
    if (step !== 2 || !activeDocId) return;
    // Agreement mode hits the agreement-preview endpoint and skips the
    // header/footer/body overrides (the backend doesn't accept them on
    // the agreement render path). Trade-doc mode keeps its existing
    // customer-bound request shape.
    if (isAgreement && !agreementContext?.leadId) return;
    if (!isAgreement && !customer?.db_id) return;
    const docId = activeDocId;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewUrl(null);
    setPdfRenderReady(false);
    // Per-doc page-shell override carried along so the preview reflects
    // whatever the user tweaked in the side panel + table inserts. The
    // backend layers these over the saved row's config; no override =
    // saved values render unchanged.
    const headerOverride = headerOverrides[docId];
    const footerOverride = footerOverrides[docId];
    const contentOverride = contentOverrides[docId];
    const previewRequest = isAgreement
      ? api.post('/clm/signature-requests/agreement-preview',
          {
            agreement_id: docId,
            lead_id: agreementContext!.leadId,
            ...(headerOverride  ? { header_config_override:  headerOverride  } : {}),
            ...(footerOverride  ? { footer_config_override:  footerOverride  } : {}),
            ...(contentOverride !== undefined ? { content_override: contentOverride } : {}),
          },
          { responseType: 'blob' },
        )
      : api.post('/clm/signature-requests/preview',
          {
            trade_doc_id: docId,
            party_id: customer!.db_id,
            model_name: modelName,
            ...(leadId ? { lead_id: leadId } : {}),
            ...(headerOverride  ? { header_config_override:  headerOverride  } : {}),
            ...(footerOverride  ? { footer_config_override:  footerOverride  } : {}),
            ...(contentOverride !== undefined ? { content_override: contentOverride } : {}),
          },
          { responseType: 'blob' },
        );
    previewRequest
      .then(async r => {
        if (cancelled) return;
        const blob = r.data as Blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);

        // Load the PDF into pdf.js so we can paint it one page at a time
        // onto the canvas (navigated via Prev/Next). This is separate from
        // detectSignatureMarkers below, which does its own short-lived load
        // for placeholder detection.
        try {
          const renderDoc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
          if (cancelled) { renderDoc.destroy(); return; }
          try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
          pdfDocRef.current = renderDoc;
          setPageCount(Math.max(1, renderDoc.numPages));
          setPdfRenderReady(true);
        } catch { /* keep any previous doc; the user can still drag the box */ }

        // Detect placeholder coords. The two modes write to different
        // state slices and track overrides on different keys, so they
        // share the same PDF.js loader but diverge on what they seed.
        // Page count comes out of the loader call — fed into state so
        // the page input can be clamped and "page X of Y" stays accurate.
        try {
          if (roleMode) {
            // Per-role (agreement OR Buyer+Consignee trade doc): detect every
            // signer role's marker and seed signerSettings[docId][role] for
            // each one whose placeholder we found. Roles the user has already
            // dragged are skipped so the draft's coord doesn't overwrite their
            // adjustment.
            const ctxSigners = roleSigners;
            const roles = ctxSigners.map(s => s.role);
            const parties = roles.map(role => ROLE_TO_MARKER_TOKEN[role]);
            const uniqueParties = Array.from(new Set(parties));
            const detected = await detectSignatureMarkers(blob, uniqueParties, (n) => {
              if (!cancelled) setPageCount(Math.max(1, n));
            });
            if (cancelled) return;
            setSignerSettings(prev => {
              const docSlice = { ...(prev[docId] ?? {}) };
              let changed = false;
              for (const role of roles) {
                const overrideKey = `${docId}:${role}`;
                if (userOverrodeRef.current.has(overrideKey)) continue;
                const partyToken = ROLE_TO_MARKER_TOKEN[role];
                const found = detected[partyToken];
                if (!found) continue;
                const roleSeed = SIGNER_DEFAULTS[role] ?? DEFAULTS;
                docSlice[role] = { ...roleSeed, ...(docSlice[role] ?? {}), ...found };
                changed = true;
              }
              if (!changed) return prev;
              return { ...prev, [docId]: docSlice };
            });
          } else {
            // Trade-doc: single signer, single token derived from
            // modelName. Write to the flat settings map. The override
            // key for this mode is just the docId.
            if (userOverrodeRef.current.has(String(docId))) return;
            const detected = await detectSignatureMarkers(blob, [partyToken], (n) => {
              if (!cancelled) setPageCount(Math.max(1, n));
            });
            const found = detected[partyToken];
            if (cancelled || !found) return;
            setSettings(prev => ({
              ...prev,
              [docId]: { ...DEFAULTS, ...prev[docId], ...found },
            }));
          }
        } catch {
          // Detection failed (e.g., corrupted PDF, worker init issue).
          // Silently keep the previous defaults — the user can still drag.
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Preview failed', 'Could not render the document. Check the draft content.');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeDocId, customer?.db_id, leadId, agreementContext?.leadId, isAgreement, headerOverrides, footerOverrides, contentOverrides]);

  /* ── Release blob URLs we created so we don't leak memory. */
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const toggleDoc = (id: number) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 10) {
        toast.error('Limit reached', 'You can send at most 10 documents per request.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const addSigner = () => {
    if (signers.length >= 5) {
      toast.error('Limit reached', 'You can configure at most 5 signers.');
      return;
    }
    setSigners(prev => [...prev, { name: '', email: '', order: prev.length + 1 }]);
  };

  const updateSigner = (idx: number, patch: Partial<Signer>) => {
    setSigners(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const removeSigner = (idx: number) => {
    setSigners(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  /* ── Validate step 1 → can proceed to step 2 */
  const step1Valid = selectedIds.length >= 1
    && signers.length >= 1
    && signers.every(s => s.name.trim() && /\S+@\S+\.\S+/.test(s.email.trim()));

  /* ── Send. */
  const send = async () => {
    if (isAgreement) {
      if (!agreementContext?.leadId || selectedIds.length === 0) {
        toast.error('Missing context', 'Lead or agreement selection is missing.');
        return;
      }
      setSending(true);
      try {
        /* Build per-role document_settings — agreement-send accepts
         * `{[agreementId]: {buyer: {...}, consignee: {...}}}` so each
         * signer's signature box can land at its own dragged position
         * on the same PDF (rather than every signer's widget sharing
         * one coord and visually stacking). Falls back to SIGNER_DEFAULTS
         * for any signer the user didn't touch. */
        const documentSettings: Record<number, Record<string, DocSettings>> = {};
        selectedIds.forEach(id => {
          const slice = signerSettings[id] ?? {};
          const filled: Record<string, DocSettings> = {};
          (agreementContext.signers ?? []).forEach(s => {
            filled[s.role] = slice[s.role] ?? { ...(SIGNER_DEFAULTS[s.role] ?? DEFAULTS) };
          });
          documentSettings[id] = filled;
        });
        const r = await api.post('/clm/signature-requests/agreement-send', {
          agreement_ids:     selectedIds,
          lead_id:           agreementContext.leadId,
          is_sequential:     isSequential,
          expiry_days:       expiryDays,
          notes:             notes.trim(),
          document_settings: documentSettings,
          ...(Object.keys(headerOverrides).length  ? { header_config_overrides:  headerOverrides  } : {}),
          ...(Object.keys(footerOverrides).length  ? { footer_config_overrides:  footerOverrides  } : {}),
          ...(Object.keys(contentOverrides).length ? { content_overrides:        contentOverrides } : {}),
        });
        toast.success('Sent for signature', r.data?.message ?? `${selectedIds.length} agreement(s) sent.`);
        onSent?.(selectedIds.slice());
        onClose();
      } catch (e: any) {
        const msg = e?.response?.data?.message
          || (e?.response?.data?.errors && Object.values(e.response.data.errors).flat().join(' · '))
          || 'Failed to send the agreement(s).';
        toast.error('Send failed', msg);
      } finally {
        setSending(false);
      }
      return;
    }
    if (!customer?.db_id) {
      toast.error('Missing customer', 'This customer is not saved yet.');
      return;
    }
    setSending(true);
    try {
      /* Signers + signature-box coords branch by mode:
       *   - role mode (Buyer + Consignee trade doc): one signer per resolved
       *     role, each carrying its `role` so the backend can tag the Zoho
       *     action and place that signer's box at its own dragged position.
       *     document_settings becomes per-role: { [docId]: { buyer:{…},
       *     consignee:{…} } }.
       *   - single-signer (vault / Buyer-only / Consignee-only): the original
       *     flat signer list + flat document_settings, unchanged. */
      let payloadSigners: Array<{ name: string; email: string; order: number; role?: SignerRoleKey }>;
      let documentSettings: Record<number, DocSettings | Record<string, DocSettings>>;
      if (roleMode) {
        payloadSigners = roleSigners.map((s, i) => ({
          name:  s.name.trim(),
          email: (s.email ?? '').trim(),
          order: i + 1,
          role:  s.role,
        }));
        const perRole: Record<number, Record<string, DocSettings>> = {};
        selectedIds.forEach(id => {
          const slice = signerSettings[id] ?? {};
          const filled: Record<string, DocSettings> = {};
          roleSigners.forEach(s => {
            filled[s.role] = slice[s.role] ?? { ...(SIGNER_DEFAULTS[s.role] ?? DEFAULTS) };
          });
          perRole[id] = filled;
        });
        documentSettings = perRole;
      } else {
        payloadSigners = signers.map((s, i) => ({ ...s, name: s.name.trim(), email: s.email.trim(), order: s.order ?? i + 1 }));
        documentSettings = settings;
      }
      const payload = {
        trade_doc_ids: selectedIds,
        party_id: customer.db_id,
        model_name: modelName,
        // Lead scope (Sales-Matrix Trade Documents popup) — omitted for the
        // standalone vault sends so their behaviour is unchanged.
        ...(leadId ? { lead_id: leadId } : {}),
        signers: payloadSigners,
        is_sequential: isSequential,
        expiry_days: expiryDays,
        notes: notes.trim(),
        document_settings: documentSettings,
        // Per-doc page-shell overrides — keys are trade_doc_id, payloads
        // mirror the saved row's columns. Backend layers them over the
        // saved config when rendering each doc to PDF, so each draft can
        // carry its own brand band + body edits in a multi-doc send.
        ...(Object.keys(headerOverrides).length  ? { header_config_overrides:  headerOverrides  } : {}),
        ...(Object.keys(footerOverrides).length  ? { footer_config_overrides:  footerOverrides  } : {}),
        ...(Object.keys(contentOverrides).length ? { content_overrides:        contentOverrides } : {}),
      };
      const r = await api.post('/clm/signature-requests', payload);
      const data = r.data?.data;
      toast.success('Sent for signature', `${data?.document_count ?? selectedIds.length} document(s) emailed to the signer.`);
      onSent?.(selectedIds.slice());
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message
        || (e?.response?.data?.errors && Object.values(e.response.data.errors).flat().join(' · '))
        || 'Failed to send. Check the server log for details.';
      toast.error('Send failed', msg);
    } finally {
      setSending(false);
    }
  };

  /* activeSettings + updateActiveSettings branch by mode so the
   * coord pane (X / Y / W / H / Page inputs) and the draggable
   * overlay both bind to:
   *   - agreement mode → signerSettings[docId][activeSignerRole]
   *   - trade-doc mode → settings[docId]
   * Per-signer agreement coords are kept in their own state map so
   * trade-doc behaviour stays bit-for-bit unchanged. */
  const activeSettings: DocSettings | null = (() => {
    if (!activeDocId) return null;
    if (roleMode) {
      if (!activeSignerRole) return null;
      const roleSeed = SIGNER_DEFAULTS[activeSignerRole] ?? DEFAULTS;
      return signerSettings[activeDocId]?.[activeSignerRole] ?? { ...roleSeed };
    }
    return settings[activeDocId] ?? { ...DEFAULTS };
  })();
  const updateActiveSettings = (patch: Partial<DocSettings>) => {
    if (!activeDocId) return;
    if (roleMode) {
      if (!activeSignerRole) return;
      const role = activeSignerRole;
      setSignerSettings(prev => {
        const roleSeed = SIGNER_DEFAULTS[role] ?? DEFAULTS;
        const docSlice = prev[activeDocId] ?? {};
        const cur      = docSlice[role] ?? { ...roleSeed };
        return {
          ...prev,
          [activeDocId]: { ...docSlice, [role]: { ...roleSeed, ...cur, ...patch } },
        };
      });
      return;
    }
    setSettings(prev => ({ ...prev, [activeDocId]: { ...DEFAULTS, ...prev[activeDocId], ...patch } }));
  };

  /* Flip the active signer's signature box (and the rendered preview page)
   * to the previous/next page — mirrors the Quotation/PI modal's Prev/Next. */
  const goPage = (delta: number) => {
    const cur = activeSettings?.page ?? 0;
    updateActiveSettings({ page: Math.max(0, Math.min(pageCount - 1, cur + delta)) });
  };

  /* ── Drag-to-position the signature box on the live PDF preview.
   * The preview wrapper is sized to A4 aspect ratio (595×842), so the
   * px↔pt conversion is uniform on both axes: `ptPerPx = 595 / widthPx`.
   * PDF coords place origin at bottom-left, CSS places it at top-left,
   * so Y is mirrored when rendering and on mouseup. */
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  // Canvas we paint the active page onto, the loaded pdf.js document, and
  // the in-flight render task (cancelled when the page/size changes — pdf.js
  // rejects rendering onto a canvas that's still mid-render). These replace
  // the old <iframe> preview.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const dragStateRef = useRef<{
    mode: 'move' | 'resize';
    startX: number; startY: number;
    initial: DocSettings;
  } | null>(null);
  /* Track the wrapper width via ResizeObserver so the overlay renders
   * correctly from the FIRST paint after the iframe loads, not after
   * a user interaction. Also keeps the overlay aligned when the modal
   * is resized via window resize / dark-mode toggle / etc. */
  const [wrapWidthPx, setWrapWidthPx] = useState(0);

  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    setWrapWidthPx(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setWrapWidthPx(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, previewUrl]);

  /* ── Render the active page onto the canvas at the wrapper's width.
   * Re-runs when the page changes, the doc loads, or the wrapper resizes.
   * The page shown is whichever page the active signature box lives on
   * (activeSettings.page), so navigating pages and positioning stay in sync. */
  const activePageNum = activeSettings?.page ?? 0;
  useEffect(() => {
    if (step !== 2 || !pdfRenderReady) return;
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const wrap = previewWrapRef.current;
    if (!pdf || !canvas || !wrap) return;
    const cssWidth = wrap.clientWidth || wrapWidthPx;
    if (cssWidth <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pageNum = Math.min(pdf.numPages, Math.max(1, activePageNum + 1));
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = (cssWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch { /* cancelled renders throw — safe to ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRenderReady, activePageNum, wrapWidthPx, step, previewUrl]);

  /* Tear down the pdf.js document + any in-flight render when the modal
   * unmounts so we don't leak the parsed PDF or a pending render task. */
  useEffect(() => () => {
    try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
    try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
    pdfDocRef.current = null;
  }, []);

  const wrapperSizePt = () => {
    const w = wrapWidthPx || previewWrapRef.current?.clientWidth || 0;
    if (w <= 0) return { w: 0, h: 0, ptPerPx: 0 };
    return { w, h: w * (A4_H / A4_W), ptPerPx: A4_W / w };
  };

  // Page currently being positioned on — drives which PDF page the canvas
  // paints so the visible sheet matches the (x, y) Zoho will apply.
  const activePreviewPage = activeSettings?.page ?? 0;

  /* ── Paint the active page onto the <canvas> at the wrapper's width.
   * Re-runs when the page changes, the doc finishes loading, or the
   * wrapper is resized. Mirrors the Quotation/PI modal so the overlay
   * sits in the SAME coordinate space as the rendered page (the old
   * <iframe> let the browser PDF viewer add its own page-fit padding,
   * which knocked the signature box off the placeholder). */
  useEffect(() => {
    if (!pdfRenderReady || step !== 2) return;
    const pdf = canvasRef.current && pdfDocRef.current;
    const canvas = canvasRef.current;
    const wrap = previewWrapRef.current;
    if (!pdf || !canvas || !wrap) return;
    const cssWidth = wrap.clientWidth || wrapWidthPx;
    if (cssWidth <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const doc = pdfDocRef.current;
        const pageNum = Math.min(doc.numPages, Math.max(1, activePreviewPage + 1));
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = (cssWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch { /* cancelled renders throw — safe to ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRenderReady, activePreviewPage, wrapWidthPx, step]);

  // Tear down the pdf.js document + any in-flight render on unmount.
  useEffect(() => () => {
    try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
    try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
    pdfDocRef.current = null;
  }, []);

  const onSigPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!activeSettings || !activeDocId) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // First drag on this doc disables placeholder-detection auto-snap so
    // we don't fight the user's intent on the next preview load. Agreement
    // mode keys per-role so dragging the buyer overlay doesn't freeze
    // the consignee's auto-detect (and vice versa).
    const overrideKey = roleMode && activeSignerRole
      ? `${activeDocId}:${activeSignerRole}`
      : String(activeDocId);
    userOverrodeRef.current.add(overrideKey);
    dragStateRef.current = {
      mode,
      startX: e.clientX, startY: e.clientY,
      initial: { ...activeSettings },
    };
    window.addEventListener('pointermove', onSigPointerMove);
    window.addEventListener('pointerup', onSigPointerUp);
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onSigPointerMove = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || !activeDocId) return;
    const { ptPerPx } = wrapperSizePt();
    if (ptPerPx <= 0) return;
    const dxPt = (e.clientX - drag.startX) * ptPerPx;
    const dyPt = (e.clientY - drag.startY) * ptPerPx;

    // Zoho's signature-field coords use a TOP-LEFT origin (y grows down),
    // matching CSS — so cursor-down (+dy) means y increases.
    if (drag.mode === 'move') {
      const x = clamp(drag.initial.x + dxPt, 0, A4_W - drag.initial.width);
      const y = clamp(drag.initial.y + dyPt, 0, A4_H - drag.initial.height);
      updateActiveSettings({ x, y });
    } else {
      // Resize from bottom-right: width grows with +dx, height grows
      // with +dy. Top-left (x, y) stays anchored.
      const width  = clamp(drag.initial.width  + dxPt, 40, A4_W - drag.initial.x);
      const height = clamp(drag.initial.height + dyPt, 24, A4_H - drag.initial.y);
      updateActiveSettings({ width, height });
    }
  };

  const onSigPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onSigPointerMove);
    window.removeEventListener('pointerup', onSigPointerUp);
  };

  if (!open) return null;

  // When opened from Stage 3 with documents already chosen, the modal
  // skips the picker entirely — show a single "preview & position" view
  // with Send as the action. The two-step stepper is hidden in that mode.
  // Agreement mode follows the same single-step pattern (the segment
  // details card already picked which agreements to send).
  const launchedFromStage3 = Array.isArray(preselectedDocIds) && preselectedDocIds.length > 0;
  const singleStepFlow = launchedFromStage3 || isAgreement;

  return createPortal(
    <div className="ssf-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }} role="dialog" aria-modal="true">
      <style>{SSF_CSS}</style>
      <div className="ssf-shell" onMouseDown={e => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="ssf-head">
          <div className="ssf-head-left">
            <div className="ssf-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34" />
                <polygon points="18 2 22 6 12 16 8 16 8 12 18 2" />
              </svg>
            </div>
            <div>
              <div className="ssf-head-label">{isAgreement ? 'SEND AGREEMENTS FOR SIGNATURE' : 'SEND FOR SIGNATURE'}</div>
              <div className="ssf-head-title">
                {isAgreement
                  ? ((agreementContext?.signers ?? [])[0]?.name || 'Lead Agreements')
                  : (customer?.company || 'Customer')}
              </div>
              {roleMode
                ? (() => {
                    const ctxSigners = roleSigners;
                    if (ctxSigners.length === 0) return null;
                    if (ctxSigners.length === 1) {
                      return ctxSigners[0].email ? <div className="ssf-head-sub">{ctxSigners[0].email}</div> : null;
                    }
                    // Multi-signer header — surface "Buyer + Consignee"
                    // so the sender knows at a glance who's getting the
                    // doc.
                    const labels = ctxSigners.map(s => s.role === 'buyer' ? 'Customer' : s.role === 'consignee' ? 'Consignee' : 'Supplier');
                    return <div className="ssf-head-sub">{labels.join(' + ')} · {ctxSigners.length} signer{ctxSigners.length > 1 ? 's' : ''}</div>;
                  })()
                : (customer?.email && <div className="ssf-head-sub">{customer.email}</div>)}
            </div>
          </div>
          <button type="button" className="ssf-close" onClick={() => !sending && onClose()} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Stepper only shown for the standalone (no-preselection) path.
            When launched from Stage 3 OR in agreement mode, documents
            are already chosen and the modal is a single Preview & Send
            screen — no stepper. */}
        {!singleStepFlow && (
          <div className="ssf-steps">
            {[
              { n: 1, label: 'Documents & Signers' },
              { n: 2, label: 'Preview & Send' },
            ].map(s => (
              <div key={s.n} className={`ssf-step ${step === s.n ? 'is-active' : ''} ${step > s.n ? 'is-done' : ''}`}>
                <span className="ssf-step-num">{step > s.n ? '✓' : s.n}</span>
                <span className="ssf-step-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="ssf-body">
          {step === 1 && (
            <div className="ssf-step1">
              <section className="ssf-block">
                <div className="ssf-block-head">
                  <div>
                    <div className="ssf-block-title">Pick Trade Documents</div>
                    <div className="ssf-block-sub">Select 1–10 drafts to send. Only Customer-applicable drafts are shown.</div>
                  </div>
                  <div className="ssf-counter">{selectedIds.length}/10 selected</div>
                </div>
                {docsLoading && <div className="ssf-loading">Loading documents…</div>}
                {!docsLoading && docs.length === 0 && <div className="ssf-empty">No customer-applicable trade documents found. Create one from Central CLM → Trade Documents.</div>}
                {!docsLoading && docs.length > 0 && (
                  <div className="ssf-doc-grid">
                    {docs.map(d => {
                      const checked = selectedIds.includes(d.id);
                      return (
                        <label key={d.id} className={`ssf-doc-card ${checked ? 'is-checked' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleDoc(d.id)} />
                          <div className="ssf-doc-card-body">
                            <div className="ssf-doc-card-code">{d.code}</div>
                            <div className="ssf-doc-card-title">{d.title || d.name}</div>
                            <div className="ssf-doc-card-meta">
                              {d.doc_type && <span className="ssf-chip">{d.doc_type}</span>}
                              {d.purpose && <span className="ssf-chip ssf-chip-muted" title={d.purpose}>{d.purpose.length > 28 ? d.purpose.slice(0, 28) + '…' : d.purpose}</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="ssf-block">
                <div className="ssf-block-head">
                  <div>
                    <div className="ssf-block-title">Signers</div>
                    <div className="ssf-block-sub">Zoho will email these recipients. The first signer is pre-filled from the customer.</div>
                  </div>
                  <button type="button" className="ssf-add-btn" onClick={addSigner} disabled={signers.length >= 5}>
                    + Add Signer ({signers.length}/5)
                  </button>
                </div>
                <div className="ssf-signers">
                  {signers.map((s, i) => (
                    <div key={i} className="ssf-signer-row">
                      <span className="ssf-signer-order">{s.order ?? i + 1}</span>
                      <input type="text" placeholder="Name" value={s.name} onChange={e => updateSigner(i, { name: e.target.value })} />
                      <input type="email" placeholder="Email" value={s.email} onChange={e => updateSigner(i, { email: e.target.value })} />
                      {signers.length > 1 && (
                        <button type="button" className="ssf-signer-remove" onClick={() => removeSigner(i)} aria-label="Remove signer">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="ssf-options">
                  <label className="ssf-checkbox">
                    <input type="checkbox" checked={isSequential} onChange={e => setIsSequential(e.target.checked)} />
                    <span>Sequential signing (each signer waits for the previous one)</span>
                  </label>
                  <div className="ssf-inline">
                    <label>
                      <span>Expiry (days)</span>
                      <input type="number" min={1} max={180} value={expiryDays} onChange={e => setExpiryDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} />
                    </label>
                  </div>
                  <label className="ssf-notes-label">
                    <span>Notes to signers</span>
                    <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
                  </label>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="ssf-step2">
              <aside className="ssf-doc-rail">
                <div className="ssf-rail-head">Documents</div>
                {selectedDocs.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={`ssf-rail-item ${activeDocId === d.id ? 'is-active' : ''}`}
                    onClick={() => setActiveDocId(d.id)}
                  >
                    <span className="ssf-rail-code">{d.code}</span>
                    <span className="ssf-rail-name">{d.title || d.name}</span>
                  </button>
                ))}
              </aside>

              <div className="ssf-preview-pane">
                {previewLoading && <div className="ssf-preview-state">Rendering preview…</div>}
                {!previewLoading && !previewUrl && <div className="ssf-preview-state">Preview unavailable.</div>}
                {previewUrl && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                    {/* Multi-signer info banner — surfaces the signer
                        composition right above the preview so the
                        user sees which parties will receive the doc
                        and whether any are blocked (unmapped on the
                        lead). Renders unconditionally in agreement
                        mode so a single-signer agreement also gets
                        the visual confirmation. */}
                    {roleMode && (
                      <div className="ssf-signer-banner">
                        {(() => {
                          const ctxSigners = roleSigners;
                          const unmapped = ctxSigners.filter(s => !s.email);
                          if (ctxSigners.length === 0) {
                            return (
                              <span className="ssf-banner-warn">
                                ⚠ No applicable parties resolved. Check the {isAgreement ? "agreement's" : "document's"} "Applicable Party" setting.
                              </span>
                            );
                          }
                          if (unmapped.length > 0) {
                            return (
                              <>
                                <span className="ssf-banner-warn">
                                  ⚠ {unmapped.length} signer{unmapped.length > 1 ? 's' : ''} missing on this lead:&nbsp;
                                  {unmapped.map(s => s.role === 'buyer' ? 'Customer' : s.role === 'consignee' ? 'Consignee' : 'Supplier').join(', ')}.
                                  Map them on the lead before sending.
                                </span>
                              </>
                            );
                          }
                          return (
                            <span className="ssf-banner-ok">
                              ✓ {ctxSigners.length} signer{ctxSigners.length > 1 ? 's' : ''} resolved — each receives the same PDF and signs on their own box.
                              {ctxSigners.length > 1 && ' Click a tab below to reposition that signer\'s box.'}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {/* Signer-tab strip — only renders in agreement
                        mode with ≥2 signers (Buyer + Consignee).
                        Clicking a tab promotes that role to "active":
                        the coord pane drives its coords, the iframe
                        jumps to its saved page, and its overlay
                        becomes draggable while the other signer's
                        box dims to a read-only outline. */}
                    {roleMode && roleSigners.length > 1 && (
                      <div className="ssf-signer-tabs" role="tablist">
                        {roleSigners.map(s => (
                          <button
                            key={s.role}
                            type="button"
                            role="tab"
                            aria-selected={s.role === activeSignerRole}
                            className={`ssf-signer-tab ${s.role === activeSignerRole ? 'is-on' : ''} ${!s.email ? 'is-unmapped' : ''}`}
                            onClick={() => setActiveSignerRole(s.role)}
                            title={s.email ? `Position ${s.name}'s signature` : `${s.name} — not mapped on this lead`}
                          >
                            <span className={`ssf-signer-dot ssf-signer-dot-${s.role}`} />
                            {s.role === 'buyer' ? 'Customer' : s.role === 'consignee' ? 'Consignee' : 'Supplier'}
                            <span className="ssf-signer-tab-name">· {s.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Page navigator — flip through the document pages one
                        at a time (single-page canvas, no browser PDF
                        scrollbar) and drop the signature box on whichever
                        page you want. Mirrors the Quotation/PI send modal. */}
                    {pageCount > 1 && (
                      <div className="ssf-pagenav">
                        <button type="button" className="ssf-pagenav-btn" onClick={() => goPage(-1)} disabled={(activeSettings?.page ?? 0) <= 0} aria-label="Previous page">‹ Prev</button>
                        <span className="ssf-pagenav-label">Page {(activeSettings?.page ?? 0) + 1} of {pageCount}</span>
                        <button type="button" className="ssf-pagenav-btn" onClick={() => goPage(1)} disabled={(activeSettings?.page ?? 0) >= pageCount - 1} aria-label="Next page">Next ›</button>
                      </div>
                    )}
                    <div className="ssf-preview-wrap" ref={previewWrapRef}>
                      {/* The active page is painted onto this canvas by the
                          render effect (pdf.js), one page at a time. The
                          draggable overlay sits on top in the SAME coordinate
                          space. Changing the active signer's page (Prev/Next
                          or the Page input) re-renders this canvas — so the
                          user always sees the page their (x,y) is applied to. */}
                      <canvas ref={canvasRef} className="ssf-preview-frame" />
                      {previewLoading && <div className="ssf-preview-state" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Rendering…</div>}
                      {/* Overlay rendering branches by mode.
                          - trade-doc: ONE overlay bound to settings[docId]
                          - agreement: ONE overlay per signer on the active
                            page; only the active signer is draggable, the
                            rest are dimmed read-only previews so the user
                            can see how the layout looks for the bundle. */}
                      {roleMode && wrapWidthPx > 0 && activeDocId && (() => {
                        const pxPerPt = wrapWidthPx / A4_W;
                        const visiblePage = activeSettings?.page ?? 0;
                        return roleSigners.map(s => {
                          const ds = signerSettings[activeDocId]?.[s.role]
                            ?? SIGNER_DEFAULTS[s.role]
                            ?? DEFAULTS;
                          // Only paint overlays whose .page matches the
                          // iframe's current page — otherwise the box
                          // would float over the wrong page.
                          if (ds.page !== visiblePage) return null;
                          const isActive = s.role === activeSignerRole;
                          const leftPx   = ds.x      * pxPerPt;
                          const topPx    = ds.y      * pxPerPt;
                          const widthPx  = ds.width  * pxPerPt;
                          const heightPx = ds.height * pxPerPt;
                          const dotCls   = `ssf-signer-dot ssf-signer-dot-${s.role}`;
                          return (
                            <div
                              key={s.role}
                              className={`ssf-sig-overlay ssf-sig-overlay-${s.role} ${isActive ? 'is-active' : 'is-dim'}`}
                              style={{ left: leftPx, top: topPx, width: widthPx, height: heightPx }}
                              onPointerDown={(e) => {
                                if (!isActive) {
                                  // Clicking another signer's box switches
                                  // focus to that signer (drag won't fire
                                  // on this pointerdown — user clicks
                                  // again to start the drag).
                                  e.stopPropagation();
                                  setActiveSignerRole(s.role);
                                  return;
                                }
                                onSigPointerDown(e, 'move');
                              }}
                              tabIndex={isActive ? 0 : -1}
                              onKeyDown={e => {
                                if (!isActive) return;
                                const step = e.altKey ? 10 : e.shiftKey ? 5 : 1;
                                if (e.key === 'ArrowUp')    { e.preventDefault(); updateActiveSettings({ y: Math.max(0, ds.y - step) }); }
                                if (e.key === 'ArrowDown')  { e.preventDefault(); updateActiveSettings({ y: Math.max(0, ds.y + step) }); }
                                if (e.key === 'ArrowLeft')  { e.preventDefault(); updateActiveSettings({ x: Math.max(0, ds.x - step) }); }
                                if (e.key === 'ArrowRight') { e.preventDefault(); updateActiveSettings({ x: Math.max(0, ds.x + step) }); }
                              }}
                              title={isActive ? 'Drag to move' : `Click to switch to ${s.name}`}
                            >
                              <div className="ssf-sig-label"><span className={dotCls} /> {s.role === 'buyer' ? 'Customer' : s.role === 'consignee' ? 'Consignee' : 'Supplier'}</div>
                              <div className="ssf-sig-page">page {ds.page + 1}</div>
                              {isActive && (
                                <div
                                  className="ssf-sig-resize"
                                  onPointerDown={(e) => onSigPointerDown(e, 'resize')}
                                  aria-label="Resize signature"
                                />
                              )}
                            </div>
                          );
                        });
                      })()}
                      {!roleMode && activeSettings && wrapWidthPx > 0 && (() => {
                        // Trade-doc single-overlay path — unchanged from
                        // before, kept inside its own IIFE so the agreement
                        // branch above can grow independently.
                        const pxPerPt  = wrapWidthPx / A4_W;
                        const leftPx   = activeSettings.x      * pxPerPt;
                        const topPx    = activeSettings.y      * pxPerPt;
                        const widthPx  = activeSettings.width  * pxPerPt;
                        const heightPx = activeSettings.height * pxPerPt;
                        return (
                          <div
                            className="ssf-sig-overlay"
                            style={{ left: leftPx, top: topPx, width: widthPx, height: heightPx }}
                            onPointerDown={e => onSigPointerDown(e, 'move')}
                            tabIndex={0}
                            onKeyDown={e => {
                              const step = e.altKey ? 10 : e.shiftKey ? 5 : 1;
                              if (e.key === 'ArrowUp')    { e.preventDefault(); updateActiveSettings({ y: Math.max(0, activeSettings.y - step) }); }
                              if (e.key === 'ArrowDown')  { e.preventDefault(); updateActiveSettings({ y: Math.max(0, activeSettings.y + step) }); }
                              if (e.key === 'ArrowLeft')  { e.preventDefault(); updateActiveSettings({ x: Math.max(0, activeSettings.x - step) }); }
                              if (e.key === 'ArrowRight') { e.preventDefault(); updateActiveSettings({ x: Math.max(0, activeSettings.x + step) }); }
                            }}
                            title="Drag to move, arrow keys to nudge by 1pt (Shift = 5, Alt = 10)"
                          >
                            <div className="ssf-sig-label">Signature</div>
                            <div className="ssf-sig-page">page {activeSettings.page + 1}</div>
                            <div
                              className="ssf-sig-resize"
                              onPointerDown={e => onSigPointerDown(e, 'resize')}
                              aria-label="Resize signature"
                            />
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <aside className="ssf-coord-pane">
                <div className="ssf-rail-head">Signature Position</div>
                <div className="ssf-coord-help">
                  Drag the box on the preview to reposition the signature.
                  The corner handle resizes it. The preview jumps to the
                  page you're positioning on — change <strong>Page</strong>
                  to switch.
                </div>

                {/* Opens the full-screen Edit Layout popup so the user
                   has room to drag the logo, edit the title, change the
                   footer text, and insert tables / lines into the body
                   without fighting the cramped side-rail width. Same
                   editor in both trade-doc and agreement modes — the
                   agreement preview/send endpoints now honour the same
                   header/footer/body overrides as the trade-doc path. */}
                <button
                  type="button"
                  className="ssf-reset-btn"
                  style={{ marginTop: 4, background: 'linear-gradient(135deg,#0d9488,#14b8a6)', color: '#fff', borderColor: 'transparent', fontWeight: 700 }}
                  onClick={() => {
                    if (!activeDocId) return;
                    const activeDoc = docs.find(d => d.id === activeDocId);
                    setPendingHeader({ ...DEFAULT_HEADER, ...(activeDoc?.header_config ?? {}), ...(headerOverrides[activeDocId] ?? {}) } as HeaderConfig);
                    setPendingFooter({ ...DEFAULT_FOOTER, ...(activeDoc?.footer_config ?? {}), ...(footerOverrides[activeDocId] ?? {}) } as FooterConfig);
                    setEditingShell(true);
                  }}
                >
                  Edit Header / Footer / Body
                </button>

                {activeSettings && (
                  <>
                    <label className="ssf-coord-row">
                      <span>Page <small style={{ color: '#94a3b8', fontWeight: 400 }}>of {pageCount}</small></span>
                      <input
                        type="number"
                        min={1}
                        max={pageCount}
                        // Display 1-indexed page numbers (matches what the user
                        // reads in the iframe), store 0-indexed in settings
                        // (matches Zoho's page_no convention).
                        value={Math.min(pageCount, (activeSettings.page ?? 0) + 1)}
                        onChange={e => {
                          const v = Number(e.target.value) || 1;
                          const clamped = Math.max(1, Math.min(pageCount, v));
                          updateActiveSettings({ page: clamped - 1 });
                        }}
                      />
                    </label>
                    {/* Fine-tune: each row has explicit ▲ / ▼ nudge
                       buttons so the user can dial pixel-perfect placement
                       per page without having to repeatedly drag the
                       overlay. The signature box on the iframe shows
                       Chrome's PDF viewer chrome (≈3pt) which the drag
                       conversion can't account for; these buttons cover
                       that gap. Shift+click nudges by 5pt; Alt+click by
                       10pt. Same modifiers work on arrow keys when the
                       overlay is focused (handler below). */}
                    {(['X', 'Y'] as const).map(axis => {
                      const key = axis.toLowerCase() as 'x' | 'y';
                      const value = Math.round(activeSettings[key] ?? 0);
                      const step  = (mods: { shiftKey: boolean; altKey: boolean }) =>
                        mods.altKey ? 10 : mods.shiftKey ? 5 : 1;
                      return (
                        <div className="ssf-coord-row ssf-coord-row-nudge" key={axis}>
                          <span>{axis}</span>
                          <div className="ssf-coord-nudge-group">
                            <button
                              type="button" className="ssf-nudge-btn"
                              title={`Decrease ${axis} (Shift = -5, Alt = -10)`}
                              onClick={e => updateActiveSettings({ [key]: Math.max(0, value - step(e)) } as any)}
                            >▼</button>
                            <input
                              type="number" min={0} step={1}
                              value={value}
                              onChange={e => updateActiveSettings({ [key]: Math.max(0, Number(e.target.value) || 0) } as any)}
                            />
                            <button
                              type="button" className="ssf-nudge-btn"
                              title={`Increase ${axis} (Shift = +5, Alt = +10)`}
                              onClick={e => updateActiveSettings({ [key]: Math.max(0, value + step(e)) } as any)}
                            >▲</button>
                          </div>
                        </div>
                      );
                    })}
                    <label className="ssf-coord-row">
                      <span>Width</span>
                      <input type="number" min={20} value={Math.round(activeSettings.width)} onChange={e => updateActiveSettings({ width: Math.max(20, Number(e.target.value) || 20) })} />
                    </label>
                    <label className="ssf-coord-row">
                      <span>Height</span>
                      <input type="number" min={20} value={Math.round(activeSettings.height)} onChange={e => updateActiveSettings({ height: Math.max(20, Number(e.target.value) || 20) })} />
                    </label>

                    <div className="ssf-coord-hint">
                      Drag the box, or click ▲/▼ to nudge by 1pt
                      (Shift = 5, Alt = 10). When the signature box on the
                      preview has focus, the keyboard arrow keys also nudge.
                    </div>

                    <button type="button" className="ssf-reset-btn" onClick={() => updateActiveSettings(DEFAULTS)}>
                      Reset to default
                    </button>
                  </>
                )}

                <div className="ssf-recipient-card">
                  <div className="ssf-recipient-h">{roleMode ? 'Signers' : 'Recipient'}</div>
                  {roleMode ? (
                    <>
                      {roleSigners.length === 0 && (
                        <div className="ssf-recipient-email">No signers resolved — check the lead's customer/consignee mapping against the {isAgreement ? 'agreement' : 'document'}'s applicable party.</div>
                      )}
                      {roleSigners.map((s, i) => (
                        <div key={s.role} style={{ marginBottom: i < roleSigners.length - 1 ? 6 : 0 }}>
                          <div className="ssf-recipient-name">
                            <span className={`ssf-signer-dot ssf-signer-dot-${s.role}`} style={{ marginRight: 6 }} />
                            {s.role === 'buyer' ? 'Customer · ' : s.role === 'consignee' ? 'Consignee · ' : 'Supplier · '}
                            {s.name}
                          </div>
                          <div className="ssf-recipient-email">{s.email || '—'}</div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="ssf-recipient-name">{customer?.company || '—'}</div>
                      <div className="ssf-recipient-email">{customer?.email || '—'}</div>
                    </>
                  )}
                </div>
              </aside>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="ssf-foot">
          <div className="ssf-foot-left">
            {/* Only show Back when there's somewhere to go back TO — i.e.
                a standalone launch that started at step 1. Stage-3 and
                agreement-mode launches have no step 1 to return to. */}
            {step === 2 && !singleStepFlow && (
              <button type="button" className="ssf-btn ssf-btn-ghost" onClick={() => setStep(1)} disabled={sending}>← Back</button>
            )}
          </div>
          <div className="ssf-foot-right">
            <button type="button" className="ssf-btn ssf-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            {step === 1 && (
              <button type="button" className="ssf-btn ssf-btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>
                Next: Preview →
              </button>
            )}
            {step === 2 && (() => {
              // Block Send when any applicable party on the agreement
              // is missing from the lead (e.g. Buyer+Consignee
              // agreement on a lead with no consignee). The backend
              // would 422 anyway; client gating gives clearer
              // feedback up front. Trade-doc path isn't affected
              // because `unmapped` is always empty there.
              const unmapped = roleMode
                ? roleSigners.filter(s => !s.email)
                : [];
              const blocked = roleMode && (
                roleSigners.length === 0 || unmapped.length > 0
              );
              const tooltip = unmapped.length > 0
                ? `Cannot send — missing: ${unmapped.map(s => s.role === 'buyer' ? 'Customer' : s.role === 'consignee' ? 'Consignee' : 'Supplier').join(', ')}`
                : undefined;
              return (
                <button
                  type="button"
                  className="ssf-btn ssf-btn-primary"
                  disabled={sending || blocked}
                  onClick={send}
                  title={tooltip}
                >
                  {sending ? 'Sending…'
                    : isAgreement
                      ? `Send Agreement${selectedDocs.length > 1 ? `s (${selectedDocs.length})` : ''} for Signature`
                      : `Send for Signature (${selectedDocs.length})`}
                </button>
              );
            })()}
          </div>
        </div>

        {/* Insertion modals — Table / HR / Placeholder. Each lands its
           HTML at the stashed caret in the body editor via the shared
           insertIntoBody helper, which also patches contentOverrides
           so the preview useEffect picks up the change on next render. */}
        <ClmInsertTableModal
          open={tablePickerOpen}
          onClose={() => setTablePickerOpen(false)}
          onInsert={(html) => { insertIntoBody(html); setTablePickerOpen(false); }}
        />
        <ClmInsertHrModal
          open={hrPickerOpen}
          onClose={() => setHrPickerOpen(false)}
          onInsert={(html) => { insertIntoBody(html); setHrPickerOpen(false); }}
        />
        <ClmInsertPlaceholderModal
          open={placeholderPickerOpen}
          onClose={() => setPlaceholderPickerOpen(false)}
          onInsert={(token) => { insertIntoBody(token, /^\s*</.test(token) ? 'html' : 'text'); setPlaceholderPickerOpen(false); }}
        />

        {clausePickerOpen && (
          <ClmClauseInsertPanel
            onClose={() => setClausePickerOpen(false)}
            onInsert={(html) => { insertIntoBody(html); setClausePickerOpen(false); }}
          />
        )}
      </div>

      {/* ── Edit Layout popup — full-screen overlay so the HeaderFooterPanel
         and the body editor have room to breathe. Cramming this into the
         180-px right rail produced a squashed, unreadable preview. The
         popup is a sibling of the main Send-for-Signature shell (same
         portal root) so its own backdrop sits above the modal but below
         the Insert Table dialog when both are open. */}
      {editingShell && activeDocId && (() => {
        const activeDoc = docs.find(d => d.id === activeDocId);
        // seededBody is read ONLY at popup-open time via the
        // initialiser useEffect below. The editor's innerHTML is then
        // mutated directly by the user / by execCommand calls, and
        // synced TO state via the onInput handler. We deliberately
        // do NOT push state changes BACK into the editor via
        // dangerouslySetInnerHTML — doing so would clobber the DOM
        // (caret position + just-inserted nodes) on every keystroke,
        // which is why earlier the HR appeared to land at the top:
        // React was wiping the DOM after execCommand and re-rendering
        // the old content. Same one-way binding pattern the draft
        // editor uses.
        const commit = () => {
          setHeaderOverrides(prev => ({ ...prev, [activeDocId]: pendingHeader }));
          setFooterOverrides(prev => ({ ...prev, [activeDocId]: pendingFooter }));
          setEditingShell(false);
          // contentOverrides was kept fresh on every keystroke via the
          // editor's onInput, so no extra commit needed for the body.
        };
        return (
          <div className="ssf-edit-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setEditingShell(false); }}>
            <style>{SSF_EDIT_CSS}</style>
            <div className="ssf-edit-shell" onMouseDown={e => e.stopPropagation()}>
              <div className="ssf-edit-head">
                <div>
                  <div className="ssf-edit-head-label">EDIT LAYOUT</div>
                  <div className="ssf-edit-head-title">{activeDoc?.code} · {activeDoc?.name ?? 'Trade Document'}</div>
                </div>
                <div className="ssf-edit-head-actions">
                  <button type="button" className="ssf-edit-btn ssf-edit-btn-ghost" onClick={() => setEditingShell(false)}>Cancel</button>
                  <button type="button" className="ssf-edit-btn ssf-edit-btn-primary" onClick={commit}>Save &amp; Reload Preview</button>
                </div>
              </div>
              <div className="ssf-edit-hint">
                Click the header / footer band to edit colours, title, logo, and page-number style. Drag the logo / title inside the header. Use the toolbar to format body text — highlight, colour, alignment, lists, lines, tables, placeholders. Changes apply only to this send — the saved draft is untouched.
              </div>

              {/* Body-text formatting toolbar — same controls the draft
                 editor uses (font size, block, B/I/U/strike, text colour,
                 highlight palette, alignment, lists, indent, link, HR,
                 table, placeholder, undo/redo, clear). The Insert HR /
                 Table / Placeholder buttons hand off to the per-popup
                 modal state. */}
              <div className="ssf-edit-toolbar-wrap">
                <ClmRichTextToolbar
                  editorRef={contentEditorRef}
                  onChange={syncBodyFromEditor}
                  onStashSelection={stashContentSelection}
                  onInsertTable={() => setTablePickerOpen(true)}
                  onInsertHr={() => setHrPickerOpen(true)}
                  onInsertPlaceholder={() => setPlaceholderPickerOpen(true)}
                  onInsertClause={() => setClausePickerOpen(true)}
                />
              </div>

              <div className="ssf-edit-canvas">
                <HeaderFooterPanel
                  header={pendingHeader} setHeader={setPendingHeader}
                  footer={pendingFooter} setFooter={setPendingFooter}
                  uploadLogoEndpoint="/clm/trade-doc-library/upload-header-logo"
                >
                  <div
                    ref={contentEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="ssf-edit-body"
                    onInput={(e) => {
                      const html = (e.target as HTMLElement).innerHTML;
                      setContentOverrides(prev => ({ ...prev, [activeDocId]: html }));
                    }}
                  />
                </HeaderFooterPanel>
              </div>
            </div>
          </div>
        );
      })()}
    </div>,
    document.body,
  );
}

/* Edit Layout popup — full-screen overlay sized for actual editing.
 * Sits ABOVE the Send-for-Signature shell (z-index 265000) so its
 * backdrop covers everything except the Insert Table dialog
 * (z-index 270000) when both are open. */
const SSF_EDIT_CSS = `
.ssf-edit-overlay {
  position: fixed; inset: 0; z-index: 265000;
  background: rgba(7, 30, 50, .58);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  font-family: var(--font-sans);
}
.ssf-edit-shell {
  width: 100%; max-width: 1000px;
  height: calc(100vh - 48px);
  background: #f3f4f6;
  border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, .35);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ssf-edit-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #0d9488 0%, #14b8a6 60%, #5eead4 100%);
  color: #fff;
}
.ssf-edit-head-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px; opacity: 0.85; }
.ssf-edit-head-title { font-size: 15px; font-weight: 800; margin-top: 2px; }
.ssf-edit-head-actions { display: inline-flex; gap: 8px; align-items: center; }
.ssf-edit-btn {
  padding: 9px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 700;
  border: 1px solid transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.ssf-edit-btn-ghost   { background: rgba(255,255,255,0.18); color: #fff; border-color: rgba(255,255,255,0.30); }
.ssf-edit-btn-ghost:hover { background: rgba(255,255,255,0.28); }
.ssf-edit-btn-primary { background: #fff; color: #047857; }
.ssf-edit-btn-primary:hover { background: #ecfdf5; }
.ssf-edit-hint {
  padding: 10px 18px;
  background: #ecfeff; color: #0e7490;
  font-size: 11.5px; font-weight: 600;
  border-bottom: 1px solid #cffafe;
}
.ssf-edit-toolbar-wrap {
  padding: 10px 18px 0;
  background: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
}
.ssf-edit-canvas {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 22px;
  background: #e5e7eb;
}
.ssf-edit-body {
  min-height: 320px;
  outline: none;
  font-size: 12.5px;
  line-height: 1.55;
  color: #1f2937;
}
.ssf-edit-body:focus { outline: 2px solid #14b8a6; outline-offset: 4px; border-radius: 4px; }
[data-bs-theme="dark"] .ssf-edit-shell  { background: var(--vz-secondary-bg); }
[data-bs-theme="dark"] .ssf-edit-canvas { background: var(--vz-body-bg); }
[data-bs-theme="dark"] .ssf-edit-body   { color: var(--vz-body-color); }
`;

type SigMarkerParty = 'customer' | 'consignee' | 'supplier';

/**
 * Find every controller-embedded «CBC-SIG-{PARTY}-9417» marker in the
 * preview PDF (one per signer party) and convert each position into
 * Zoho-style (top-left origin, page 0-based) coordinates that drop
 * straight into DocSettings.
 *
 * PDF.js exposes text items with a `transform` matrix; the last two
 * entries are the baseline (x, y) in PDF user-space (bottom-left origin),
 * so we mirror Y to match Zoho's top-left convention. A marker may
 * appear split across multiple text items (DomPDF sometimes breaks runs
 * at style boundaries) — we therefore concatenate items in reading
 * order and search the joined string, then trace the match back to the
 * item that anchors its start.
 *
 * Multi-party version: agreement drafts can carry BOTH `{{buyer.signature}}`
 * and `{{consignee.signature}}` placeholders on the same PDF. We do one
 * pass per page and check every requested party's marker, so the
 * draggable overlay for each signer role can open at the draft's
 * placeholder rather than a hardcoded fallback slot. Returns a partial
 * map — only parties whose marker was actually found get an entry; the
 * rest fall back to SIGNER_DEFAULTS / DEFAULTS at the caller.
 */
async function detectSignatureMarkers(
  blob: Blob,
  parties: SigMarkerParty[],
  onPageCount?: (n: number) => void,
): Promise<Partial<Record<SigMarkerParty, Partial<DocSettings>>>> {
  const result: Partial<Record<SigMarkerParty, Partial<DocSettings>>> = {};
  if (parties.length === 0) return result;

  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  onPageCount?.(pdf.numPages);

  // Visual sig-box scaffold: 220×80 CSS px ≈ 165×60 pt (DomPDF 96 dpi → PDF
  // 72 pt/in conversion = 0.75). Field is sized to match the box so Zoho's
  // signature widget visually replaces the placeholder when the customer
  // signs. Adjustable per-send via drag/resize.
  const BOX_WIDTH_PT  = 165;
  const BOX_HEIGHT_PT = 60;
  // Distance from the marker's text BASELINE to the sig-box's TOP edge.
  // As of the position-absolute fix on .sig-marker (see
  // clm-signature-document.blade.php) the marker is anchored to the box's
  // top-left corner — so its baseline sits ~0.4pt below the box top
  // (0.5pt font, ~80% ascent). The legacy 34pt offset existed because
  // the marker was previously inline with the visible "[ Signature ]"
  // label, riding the 10pt font's baseline ~34pt below the box top.
  // That value moved with the surrounding draft's text-alignment, which
  // is why Vendor (centred context) landed off and Customer (left-aligned
  // context) happened to work.
  const BASELINE_TO_BOX_TOP_PT = 0.5;

  try {
    for (let pageIdx = 1; pageIdx <= pdf.numPages; pageIdx++) {
      // Short-circuit once every requested party is located.
      const remaining = parties.filter(p => !(p in result));
      if (remaining.length === 0) break;

      const page = await pdf.getPage(pageIdx);
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      const content = await page.getTextContent();
      // Build a flat string and a parallel array of (charIndex → item) so
      // we can resolve a regex hit back to a positioned text item.
      let joined = '';
      const charToItem: number[] = [];
      const items = content.items as Array<{ str: string; transform: number[] }>;
      items.forEach((it, idx) => {
        joined += it.str;
        for (let i = 0; i < it.str.length; i++) charToItem.push(idx);
      });

      for (const party of remaining) {
        const re = new RegExp(`«CBC-SIG-${party.toUpperCase()}-9417»`, 'i');
        const m = re.exec(joined);
        if (!m || m.index == null) continue;

        const hitItem = items[charToItem[m.index]];
        if (!hitItem) continue;

        // transform = [a, b, c, d, e, f] where (e, f) is the baseline
        // origin in PDF user-space (bottom-left origin).
        const xBaseline = hitItem.transform[4];
        const yBaseline = hitItem.transform[5];

        // PDF.js → Zoho (top-left origin):
        //   baseline-from-top = pageHeight − baselineInPdfCoords
        //   box-top-from-top   = baseline-from-top − BASELINE_TO_BOX_TOP_PT
        const baselineFromTop = pageHeight - yBaseline;
        const yZoho           = Math.max(0, baselineFromTop - BASELINE_TO_BOX_TOP_PT);

        result[party] = {
          page:   pageIdx - 1,
          x:      Math.max(0, xBaseline),
          y:      yZoho,
          width:  BOX_WIDTH_PT,
          height: BOX_HEIGHT_PT,
        };
      }
    }
  } finally {
    pdf.destroy();
  }
  return result;
}

export const SSF_CSS = `
.ssf-overlay {
  position: fixed; inset: 0; z-index: 260000;
  background: rgba(7, 30, 50, .55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  animation: ssfFade .18s ease both;
  font-family: var(--font-sans);
}
@keyframes ssfFade { from { opacity: 0 } to { opacity: 1 } }

.ssf-shell {
  width: 100%; max-width: 1200px; height: calc(100vh - 36px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff;
  box-shadow: 0 28px 70px rgba(15, 23, 42, .50), 0 0 0 1px rgba(99, 102, 241, .15);
}

.ssf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  background: linear-gradient(110deg, #4338ca 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff;
  flex-shrink: 0;
}
.ssf-head-left { display: inline-flex; align-items: center; gap: 14px; min-width: 0; }
.ssf-head-ico {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
}
.ssf-head-label { font-size: 10px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); }
.ssf-head-title { font-size: 17px; font-weight: 800; letter-spacing: -.01em; margin-top: 2px; }
.ssf-head-sub   { font-size: 11px; color: rgba(255,255,255,.78); margin-top: 1px; }
.ssf-close {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.ssf-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }

.ssf-steps {
  display: flex; align-items: center; gap: 0;
  padding: 12px 22px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.ssf-step {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  font-size: 12.5px; font-weight: 600; color: #94a3b8;
}
.ssf-step:not(:last-child)::after {
  content: ''; display: inline-block; width: 60px; height: 1px;
  background: #cbd5e1; margin-left: 4px;
}
.ssf-step.is-active { color: #4338ca; }
.ssf-step.is-done   { color: #16a34a; }
.ssf-step-num {
  width: 22px; height: 22px; border-radius: 50%;
  background: #e2e8f0; color: #475569;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800;
}
.ssf-step.is-active .ssf-step-num { background: #4338ca; color: #fff; }
.ssf-step.is-done   .ssf-step-num { background: #16a34a; color: #fff; }

.ssf-body { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.ssf-step1 {
  flex: 1; overflow-y: auto; padding: 18px 22px;
  display: flex; flex-direction: column; gap: 18px;
  background: #fafbff;
}
.ssf-step2 {
  flex: 1; min-height: 0; display: grid;
  grid-template-columns: 220px 1fr 280px;
  background: #f1f5f9;
}

.ssf-block {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
.ssf-block-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ssf-block-title { font-size: 14px; font-weight: 800; color: #0f172a; }
.ssf-block-sub   { font-size: 12px; color: #64748b; margin-top: 2px; }
.ssf-counter {
  background: #eef2ff; color: #4338ca; padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}

.ssf-doc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ssf-doc-card {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  cursor: pointer; transition: all .15s ease;
}
.ssf-doc-card:hover { border-color: #cbd5e1; }
.ssf-doc-card.is-checked { border-color: #4338ca; background: linear-gradient(180deg, #fff 0%, #eef2ff 100%); }
.ssf-doc-card input { margin-top: 3px; accent-color: #4338ca; }
.ssf-doc-card-body { min-width: 0; flex: 1; }
.ssf-doc-card-code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 800; color: #4338ca; letter-spacing: .04em; }
.ssf-doc-card-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px; line-height: 1.35; }
.ssf-doc-card-meta { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.ssf-chip { background: #ecfeff; color: #0e7490; padding: 2px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600; }
.ssf-chip-muted { background: #f1f5f9; color: #64748b; }

.ssf-loading, .ssf-empty {
  padding: 22px; text-align: center; color: #64748b; font-size: 13px;
  background: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1;
}

.ssf-add-btn {
  background: #eef2ff; border: 1px solid #c7d2fe; color: #4338ca;
  padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ssf-add-btn:disabled { opacity: .5; cursor: not-allowed; }

.ssf-signers { display: flex; flex-direction: column; gap: 8px; }
.ssf-signer-row {
  display: grid; grid-template-columns: 32px 1fr 1fr 30px; gap: 8px; align-items: center;
}
.ssf-signer-order {
  width: 28px; height: 28px; border-radius: 8px;
  background: #4338ca; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
}
.ssf-signer-row input {
  height: 36px; padding: 0 10px;
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  font-size: 13px; color: #0f172a;
}
.ssf-signer-row input:focus { border-color: #4338ca; outline: none; box-shadow: 0 0 0 3px rgba(67,56,202,.12); }
.ssf-signer-remove {
  width: 30px; height: 30px; border-radius: 8px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}

.ssf-options { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0; display: flex; flex-direction: column; gap: 10px; }
.ssf-checkbox { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; cursor: pointer; }
.ssf-checkbox input { accent-color: #4338ca; }
.ssf-inline label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; }
.ssf-inline input {
  height: 32px; width: 80px; padding: 0 10px;
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  font-size: 13px;
}
.ssf-notes-label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: #475569; }
.ssf-notes-label textarea {
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  padding: 8px 10px; font: inherit; font-size: 13px; color: #0f172a; resize: vertical;
}

/* Step 2 */
.ssf-doc-rail { background: #fff; border-right: 1px solid #e2e8f0; padding: 14px 10px; overflow-y: auto; }
.ssf-rail-head { font-size: 10.5px; font-weight: 800; color: #64748b; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 8px; padding: 0 4px; }
.ssf-rail-item {
  width: 100%; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px; border-radius: 9px;
  background: transparent; border: 1.5px solid transparent; color: #475569;
  cursor: pointer; transition: all .15s ease;
  margin-bottom: 6px;
}
.ssf-rail-item:hover { background: #f1f5f9; }
.ssf-rail-item.is-active { background: #eef2ff; border-color: #c7d2fe; }
.ssf-rail-code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 800; color: #4338ca; }
.ssf-rail-name { font-size: 12.5px; font-weight: 600; color: #0f172a; line-height: 1.3; }

/* align-items: flex-start pins the PDF wrapper to the TOP of the pane.
 * Otherwise on lower-zoom screens (<=100%) the wrapper grows taller
 * than the pane and align-items: center clips both ends, hiding the
 * PDF's header (logo + barcode) behind the modal's purple title bar.
 * With flex-start + overflow-y: auto the user can scroll the wrapper
 * vertically to see the bottom of the page. */
.ssf-preview-pane { background: #cbd5e1; display: flex; align-items: flex-start; justify-content: center; padding: 16px; overflow-y: auto; }
/* Wrapper sized to A4 aspect ratio so the px↔pt conversion is uniform
 * on both axes — letting the drag handler compute PDF coords without
 * having to track horizontal/vertical scale factors separately. */
.ssf-preview-wrap {
  position: relative;
  width: 100%; max-width: 560px;
  aspect-ratio: 595 / 842;
  background: #fff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, .25);
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
}
/* Canvas paints the PDF page at the wrapper width; height follows the
 * page aspect (set inline by the render effect), filling the A4-shaped
 * wrapper edge-to-edge so the drag overlay lines up with the page. */
.ssf-preview-canvas { width: 100%; height: auto; display: block; background: #fff; }
/* Centred "Rendering preview…" overlay shown while pdf.js parses the
 * blob — sits on top of the blank canvas inside the A4 wrapper. */
.ssf-preview-canvas-loading {
  position: absolute; inset: 0; z-index: 5;
  display: flex; align-items: center; justify-content: center;
}
.ssf-preview-state { color: #475569; font-size: 13px; padding: 32px; }
/* Prev / Next page navigation above the preview (parity with the
 * Quotation/PI modal's .sds-pagenav). */
.ssf-pagenav { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ssf-pagenav-label { font-size: 12.5px; font-weight: 700; color: #334155; min-width: 92px; text-align: center; }
.ssf-pagenav-btn {
  border: 1.5px solid #cbd5e1; background: #fff; color: #0f172a;
  border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.ssf-pagenav-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.ssf-pagenav-btn:disabled { opacity: .45; cursor: not-allowed; }
[data-bs-theme="dark"] .ssf-pagenav-label { color: #cbd5e1; }
[data-bs-theme="dark"] .ssf-pagenav-btn { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-pagenav-btn:hover:not(:disabled) { background: #243244; }
/* Page navigator (Prev / page X of Y / Next) above the canvas preview. */
.ssf-pagenav { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ssf-pagenav-label { font-size: 12.5px; font-weight: 700; color: #334155; min-width: 92px; text-align: center; }
.ssf-pagenav-btn {
  border: 1.5px solid #cbd5e1; background: #fff; color: #0f172a;
  border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.ssf-pagenav-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.ssf-pagenav-btn:disabled { opacity: .45; cursor: not-allowed; }
[data-bs-theme="dark"] .ssf-pagenav-label { color: #cbd5e1; }
[data-bs-theme="dark"] .ssf-pagenav-btn { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-pagenav-btn:hover:not(:disabled) { background: #243244; }

/* Draggable signature box overlaid on the PDF preview. The corner
 * handle is a child so its own pointerdown can be distinguished from
 * the parent's "move" pointerdown — picking up the corner resizes,
 * picking up anywhere else moves. */
.ssf-sig-overlay {
  position: absolute;
  z-index: 10;
  background: rgba(99, 102, 241, .22);
  border: 2px dashed #4338ca;
  border-radius: 4px;
  cursor: move;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(67, 56, 202, .25);
  touch-action: none;
}
.ssf-sig-label {
  color: #4338ca; font-size: 11px; font-weight: 800;
  text-shadow: 0 1px 0 rgba(255,255,255,.8);
  letter-spacing: .04em; text-transform: uppercase;
  pointer-events: none;
}
.ssf-sig-page {
  position: absolute; top: 2px; left: 4px;
  font-size: 9px; color: #4338ca; opacity: .8; font-weight: 700;
  pointer-events: none;
}
.ssf-sig-resize {
  position: absolute; right: -1px; bottom: -1px;
  width: 14px; height: 14px;
  background: #4338ca; border: 2px solid #fff;
  border-radius: 3px;
  cursor: nwse-resize;
  touch-action: none;
}

/* ── Multi-signer (agreement mode) ────────────────────────────────────
 * Signer tabs above the preview let the user pick which signer's box
 * the coord pane drives. Each role gets its own colour dot for quick
 * visual mapping between tab / overlay / recipient card. */
.ssf-signer-tabs {
  display: inline-flex; gap: 6px;
  margin: 0 auto 10px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.ssf-signer-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  background: transparent; border: 0;
  font-family: inherit; font-size: 12px; font-weight: 700;
  color: #475569; cursor: pointer;
  border-radius: 7px;
  transition: background .15s ease, color .15s ease;
}
.ssf-signer-tab:hover { background: #f1f5f9; color: #0f172a; }
.ssf-signer-tab.is-on { background: #eef2ff; color: #4338ca; }
.ssf-signer-tab-name {
  font-weight: 500; color: #94a3b8; max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ssf-signer-tab.is-on .ssf-signer-tab-name { color: #6366f1; }

/* Role colour swatches — buyer = indigo, consignee = teal,
 * supplier = amber. The same dot recurs in the recipient card and the
 * sig-label so the user can scan the layout at a glance. */
.ssf-signer-dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%;
  vertical-align: middle;
}
.ssf-signer-dot-buyer     { background: #4338ca; }
.ssf-signer-dot-consignee { background: #0d9488; }
.ssf-signer-dot-supplier  { background: #d97706; }

/* Active overlay keeps the default indigo styling (defined above).
 * Per-role variants tint the active border + label to match the dot,
 * and the .is-dim variant fades inactive boxes so the user can tell
 * at a glance which one their drag targets. */
.ssf-sig-overlay-buyer.is-active     { border-color: #4338ca; background: rgba(99, 102, 241, .22); }
.ssf-sig-overlay-consignee.is-active { border-color: #0d9488; background: rgba(20, 184, 166, .22); }
.ssf-sig-overlay-supplier.is-active  { border-color: #d97706; background: rgba(245, 158, 11, .22); }

/* Inactive signer's box — still clearly visible (matches the role's
 * colour at lower saturation) so multi-signer layouts read at a
 * glance. Clicking promotes it to active. */
.ssf-sig-overlay.is-dim {
  border-style: dashed;
  border-width: 2px;
  opacity: 0.75;
  cursor: pointer;
}
.ssf-sig-overlay-buyer.is-dim     { border-color: #4338ca; background: rgba(67, 56, 202, .10); }
.ssf-sig-overlay-consignee.is-dim { border-color: #0d9488; background: rgba(13, 148, 136, .10); }
.ssf-sig-overlay-supplier.is-dim  { border-color: #d97706; background: rgba(217, 119, 6, .10); }
.ssf-sig-overlay.is-dim:hover { opacity: 1; }
.ssf-sig-overlay.is-dim::before {
  content: 'click to activate';
  position: absolute;
  bottom: -18px; left: 0;
  font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: #64748b;
  pointer-events: none;
}

/* Banner above the preview pane — surfaces signer resolution state
 * (count, unmapped warnings) so the user never has to guess why
 * boxes do/don't appear. */
.ssf-signer-banner {
  width: 100%; max-width: 560px;
  padding: 8px 12px;
  margin: 0 auto 10px;
  border-radius: 8px;
  font-size: 12px; line-height: 1.4;
  background: #ecfeff; border: 1px solid #67e8f9;
  color: #0e7490;
  text-align: center;
}
.ssf-banner-warn { color: #92400e; }
.ssf-signer-banner:has(.ssf-banner-warn) {
  background: #fef3c7; border-color: #fde68a;
}
.ssf-banner-ok { color: #047857; }
.ssf-signer-banner:has(.ssf-banner-ok) {
  background: #ecfdf5; border-color: #a7f3d0;
}

/* Unmapped signer tab — strikethrough name + amber border so the
 * user sees at a glance which party is blocking the send. */
.ssf-signer-tab.is-unmapped {
  border: 1.5px dashed #f59e0b;
  background: #fffbeb;
  color: #b45309;
}
.ssf-signer-tab.is-unmapped .ssf-signer-tab-name { text-decoration: line-through; }

.ssf-coord-pane { background: #fff; border-left: 1px solid #e2e8f0; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.ssf-coord-help { font-size: 11.5px; color: #64748b; line-height: 1.45; }
.ssf-coord-help code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 10.5px; color: #4338ca; }

/* Recipient mini-card at the bottom of the coord pane — replaces the
 * separate Review step by showing the destination right next to the
 * Send button. */
.ssf-recipient-card {
  margin-top: 10px; padding: 10px 12px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.ssf-recipient-h { font-size: 9.5px; font-weight: 800; color: #64748b; letter-spacing: .14em; text-transform: uppercase; }
.ssf-recipient-name { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 4px; }
.ssf-recipient-email { font-size: 11.5px; color: #64748b; margin-top: 2px; word-break: break-all; }

.ssf-coord-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: #334155; }
.ssf-coord-row span { font-weight: 600; min-width: 60px; }
.ssf-coord-row input {
  width: 90px; height: 30px; padding: 0 8px;
  border: 1.5px solid #e2e8f0; border-radius: 7px; background: #fff;
  font-size: 12.5px; color: #0f172a; text-align: right;
}
.ssf-coord-row input:focus { border-color: #4338ca; outline: none; box-shadow: 0 0 0 3px rgba(67,56,202,.12); }
/* Nudge group — X / Y rows pair the input with explicit ▼ / ▲ buttons
   so pixel-perfect adjustment doesn't require dragging a 1pt distance. */
.ssf-coord-row-nudge .ssf-coord-nudge-group {
  display: inline-flex; align-items: center; gap: 2px;
}
.ssf-coord-row-nudge input {
  width: 60px; text-align: center; border-radius: 0;
  border-left-width: 0; border-right-width: 0;
}
.ssf-nudge-btn {
  width: 26px; height: 30px;
  background: #fff; border: 1.5px solid #e2e8f0; color: #475569;
  font-size: 11px; font-weight: 700; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.ssf-nudge-btn:first-child { border-radius: 7px 0 0 7px; }
.ssf-nudge-btn:last-child  { border-radius: 0 7px 7px 0; }
.ssf-nudge-btn:hover { background: #eef2ff; color: #4338ca; border-color: #c7d2fe; }
.ssf-coord-hint {
  font-size: 10.5px; color: #94a3b8; line-height: 1.4;
  padding: 6px 8px; background: #f8fafc; border-radius: 6px;
  border: 1px dashed #e2e8f0;
}
/* Focus ring on the signature overlay — only when the user has clicked
   it, so the arrow-key nudge handler activates without the ring being
   constantly visible. */
.ssf-sig-overlay:focus { outline: 2px solid #4338ca; outline-offset: 2px; }
.ssf-reset-btn {
  margin-top: 6px;
  background: #f8fafc; border: 1px solid #cbd5e1; color: #475569;
  padding: 6px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; cursor: pointer;
}

/* Footer */
.ssf-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 22px;
  background: #fff; border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.ssf-foot-right { display: inline-flex; gap: 10px; }
.ssf-btn {
  padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all .15s ease; border: 1.5px solid transparent;
}
.ssf-btn-ghost { background: #fff; border-color: #cbd5e1; color: #334155; }
.ssf-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.ssf-btn-primary { background: linear-gradient(110deg, #4338ca 0%, #6366f1 100%); color: #fff; }
.ssf-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(67,56,202,.30); }
.ssf-btn:disabled { opacity: .5; cursor: not-allowed; }

@media (max-width: 980px) {
  .ssf-step2 { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
  .ssf-doc-rail, .ssf-coord-pane { border: 0; border-bottom: 1px solid #e2e8f0; }
  .ssf-doc-grid { grid-template-columns: 1fr; }
}

[data-bs-theme="dark"] .ssf-shell { background: #0f172a; }
[data-bs-theme="dark"] .ssf-steps { background: #0b1220; border-bottom-color: #1e293b; }
[data-bs-theme="dark"] .ssf-step1 { background: #0b1220; }
[data-bs-theme="dark"] .ssf-step2 { background: #0b1220; }
[data-bs-theme="dark"] .ssf-block { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .ssf-block-title { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-block-sub { color: #94a3b8; }
[data-bs-theme="dark"] .ssf-doc-card { background: #0f172a; border-color: #334155; }
[data-bs-theme="dark"] .ssf-doc-card.is-checked { background: linear-gradient(180deg, #0f172a 0%, rgba(99,102,241,.18) 100%); border-color: #6366f1; }
[data-bs-theme="dark"] .ssf-doc-card-title { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-signer-row input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-doc-rail, [data-bs-theme="dark"] .ssf-coord-pane { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .ssf-rail-name { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-rail-item:hover { background: rgba(99,102,241,.10); }
[data-bs-theme="dark"] .ssf-rail-item.is-active { background: rgba(99,102,241,.18); border-color: #6366f1; }
[data-bs-theme="dark"] .ssf-coord-row input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-recipient-card { background: rgba(99,102,241,.10); border-color: #334155; }
[data-bs-theme="dark"] .ssf-recipient-name { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-foot { background: #0b1220; border-top-color: #1e293b; }
[data-bs-theme="dark"] .ssf-btn-ghost { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-loading, [data-bs-theme="dark"] .ssf-empty { background: #0f172a; border-color: #334155; color: #94a3b8; }
`;
