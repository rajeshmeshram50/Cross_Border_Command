import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterMultiSelect } from '../master/masterFormKit';
import Tooltip from '../../components/ui/Tooltip';
import { SimpleDescModal } from './clmCommon';
import ClmInsertTableModal from './ClmInsertTableModal';
import ClmInsertHrModal from './ClmInsertHrModal';
import ClmClauseInsertPanel from './ClmClauseInsertPanel';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';

/* ───────────────────────────────────────────────────────────────────────
 * Central CLM → Agreements Master → Library → "Add New Agreement" wizard
 *
 *   Step 1 — Agreement Basic Details (type, title, regulatory, purpose, party)
 *   Step 2 — Draft Agreement Content (Tiptap rich text + placeholder picker +
 *            Clause Library + Upload Word import)
 *
 * Backend contract (POST/PUT /clm/agreement-library):
 *   { agreement_type, title, party, regulatory, signing, segment,
 *     agr_status, content }
 *
 * Quick-add for Agreement Type calls POST /clm/agreement-types.
 * The Purpose field is UI-only (not persisted server-side yet) — it lives
 * in component state and gets prepended into `content` as a leading
 * paragraph so the user's intent isn't lost.
 * ─────────────────────────────────────────────────────────────────────── */

export type AgrType = { id: number; code: string; name: string; description: string };
export type AgrLib = {
  id: number;
  code: string;
  agreement_type: string;
  title: string;
  purpose?: string | null;
  party: string;
  regulatory: 'highly' | 'less';
  signing: boolean;
  segment: string | null;
  agr_status: string;
  content: string | null;
  /* Stage 2 page-shell — same shape Trade Document carries. Nullable for
   * rows that pre-date the columns; the wizard layers the row's config
   * over branded defaults so missing keys stay safe. */
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};

/* Applicable Party — identical to the Trade Document Draft page's
 * checkbox grid (`PARTY_BUYER_CONSIGNEE` / `PARTY_SUPPLIER`) so the
 * Agreement and Trade Document forms read as a single visual family.
 * Selected values concatenate into the agreement_library.party CSV. */
const PARTY_BUYER_CONSIGNEE = [
  { value: 'Buyer',     label: 'Buyer',     icon: '👤' },
  { value: 'Consignee', label: 'Consignee', icon: '🚚' },
];
const PARTY_SUPPLIER = [
  { value: 'Supplier-Material',       label: 'Material',       icon: '📦' },
  { value: 'Supplier-Logistic',       label: 'Logistic',       icon: '🚛' },
  { value: 'Supplier-Tech',           label: 'Tech',           icon: '💻' },
  { value: 'Supplier-Advisory',       label: 'Advisory',       icon: '📊' },
  { value: 'Supplier-Strategic Risk', label: 'Strategic Risk', icon: '⚠️' },
];

const STEPS = [
  { key: 1, label: 'Agreement Basic Details', sub: 'Type, title, parties' },
  { key: 2, label: 'Draft Agreement Content', sub: 'Rich text editor & placeholders' },
];

interface Props {
  open: boolean;
  existing: AgrLib | null;
  types: AgrType[];
  /* Segment master rows (name + regulatory tier) — used to filter the
   * Stage-1 segment selector by the chosen High/Less regulatory radio.
   * Accept the legacy string[] shape too for callers that haven't been
   * updated yet; those entries default to 'less'. */
  knownSegments: Array<{ name: string; regulatory_status: 'highly' | 'less' }> | string[];
  nextCode: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ClmAgreementWizardModal({ open, existing, types: initialTypes, knownSegments, nextCode, onClose, onSaved }: Props) {
  const toast = useToast();
  const editingId = existing?.id ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  // Full-page drafting — expands the Step-2 editor to fill the screen. Lives
  // here (not in AgrEditor) so the content-restore effect can re-seed the
  // contentEditable after the portal re-parents it (mirrors Trade Doc).
  const [fullPage, setFullPage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [types, setTypes] = useState<AgrType[]>(initialTypes);

  // Step 1 fields
  const [agreementType, setAgreementType] = useState('');
  const [title, setTitle]                 = useState('');
  const [regulatory, setRegulatory]       = useState<'highly' | 'less'>('less');
  const [purpose, setPurpose]             = useState('');
  const [parties, setParties]             = useState<Set<string>>(new Set());
  /* Segments — always an array internally so the high-reg / less-reg
   * branches share the same state shape. High-reg is single-select
   * (length 0 or 1); less-reg is multi-select (any length). Persisted
   * as a comma-separated string in clm_agreement_library.segment. */
  const [segments, setSegments]           = useState<string[]>([]);

  // Step 2 fields
  const [content, setContent]                 = useState('');
  const [placeholderOpen, setPlaceholderOpen] = useState(false);
  const [clauseOpen, setClauseOpen]           = useState(false);
  /* Insert Table / Insert HR — same pattern Trade Doc uses. Caret is
   * stashed via stashSelection() before opening so the generated HTML
   * lands at the user's last in-editor caret, not the editor's start. */
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [hrPickerOpen, setHrPickerOpen]       = useState(false);

  // Editor state — contentEditable + execCommand, mirrors Trade Doc modal.
  const editorRef        = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSizeState] = useState('14');
  const [block, setBlockState]       = useState('p');
  const lastRangeRef                  = useRef<Range | null>(null);
  const docxRef                       = useRef<HTMLInputElement | null>(null);

  /* Stage 2 page-shell — same UX as Trade Document modal. Defaults pre-
   * fill the header with the user's branch (or client) logo + name so
   * a fresh draft looks branded; the user can edit / replace either
   * side via the header popover. Saved values come back as
   * `header_config` / `footer_config` on the row and layer over the
   * defaults so a row that pre-dates these columns keeps rendering. */
  const { user: authUser } = useAuth();
  const brandedDefaults = useMemo(() => {
    const headerLogoUrl = authUser?.branch_logo ?? authUser?.client_logo ?? null;
    const headerLogoPath = headerLogoUrl
      ? (headerLogoUrl.match(/\/storage\/(.+)$/)?.[1] ?? null)
      : null;
    const headerTitle = authUser?.branch_name ?? authUser?.client_name ?? DEFAULT_HEADER.title;
    const footerLine  = authUser?.client_name
      ? `${authUser.client_name}${authUser?.branch_name && authUser.branch_name !== authUser.client_name ? ' · ' + authUser.branch_name : ''}  |  Confidential`
      : DEFAULT_FOOTER.text;
    return {
      header: { ...DEFAULT_HEADER, logo_path: headerLogoPath, logo_url: headerLogoUrl, title: headerTitle },
      footer: { ...DEFAULT_FOOTER, text: footerLine },
    };
  }, [authUser?.branch_logo, authUser?.client_logo, authUser?.branch_name, authUser?.client_name]);
  const [headerConfig, setHeaderConfig] = useState<HeaderConfig>(brandedDefaults.header);
  const [footerConfig, setFooterConfig] = useState<FooterConfig>(brandedDefaults.footer);

  const [quickAddTypeOpen, setQuickAddTypeOpen] = useState(false);

  /* Rich-text helpers — execCommand is deprecated but the lightest path
   * for a contentEditable div. preventDefault on the toolbar's mousedown
   * keeps the editor's selection alive while a button is being clicked. */
  const syncContent = () => {
    if (editorRef.current) setContent(editorRef.current.innerHTML);
  };
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    syncContent();
  };
  const applyFontSize = (px: string) => {
    editorRef.current?.focus();
    document.execCommand('fontSize', false, '7');
    editorRef.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      span.innerHTML = (f as HTMLElement).innerHTML;
      f.replaceWith(span);
    });
    syncContent();
  };
  const applyBlock = (tag: string) => exec('formatBlock', `<${tag}>`);
  const insertLink = () => {
    const url = window.prompt('Enter URL', 'https://');
    if (url) exec('createLink', url);
  };
  const stashSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    // Don't clobber the previous stash if the new selection is OUTSIDE
    // the editor — that happens while a modal (Placeholder / Table /
    // HR) is open. We want to remember the LAST in-editor caret.
  };
  /* Restore the stashed caret BEFORE executing the insertion command.
   * Falls back to the END of the editor (collapsed range) when no
   * stash exists yet — happens when the user opens a Placeholder / HR /
   * Table modal without first clicking inside the body. End-of-editor
   * is closer to user intent than the top-default `editor.focus()`. */
  const restoreCaretForInsert = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const stash = lastRangeRef.current;
    const sel   = window.getSelection();
    if (!sel) return;
    if (stash && editor.contains(stash.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(stash);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);   // collapse to end
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };
  const rememberCaretAfterInsert = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const insertAtCaret = (text: string) => {
    restoreCaretForInsert();
    document.execCommand('insertText', false, text);
    rememberCaretAfterInsert();
    syncContent();
  };
  /* Drop generated HTML at the stashed caret position. Used by the
   * Insert Table + Insert HR modals — execCommand('insertHTML') is
   * more reliable than splicing nodes by hand and handles the case
   * where the user's selection spans multiple existing nodes. */
  const insertHtmlAtCaret = (html: string) => {
    restoreCaretForInsert();
    document.execCommand('insertHTML', false, html);
    rememberCaretAfterInsert();
    syncContent();
  };

  /* DOCX round-trip — mirrors the Trade Doc draft flow. Requires an
   * existing row so we have an id to scope the upload/download to. */
  const downloadDocx = async () => {
    if (!editingId) {
      toast.error('Save first', 'Save the agreement before downloading as DOCX.');
      return;
    }
    try {
      const resp = await api.get(`/clm/agreement-library/${editingId}/download`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([resp.data]));
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${existing?.code ?? `A-${String(editingId).padStart(3, '0')}`}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // The response is a Blob (responseType: 'blob'), so a server error body
      // arrives as a Blob too — read it back to surface the real message
      // instead of a generic "Please try again". Mirrors the Trade Doc flow.
      let msg = 'Please try again.';
      try {
        const blob = e?.response?.data;
        if (blob instanceof Blob) {
          const json = JSON.parse(await blob.text());
          if (json?.message) msg = json.message;
        } else if (typeof e?.response?.data?.message === 'string') {
          msg = e.response.data.message;
        }
      } catch { /* keep the default message */ }
      toast.error('Download failed', msg);
    }
  };
  const uploadDocx = async (file: File) => {
    if (!editingId) {
      toast.error('Save first', 'Save the agreement before uploading a revised DOCX.');
      return;
    }
    const fd = new FormData();
    fd.append('docx', file);
    try {
      const { data } = await api.post(`/clm/agreement-library/${editingId}/upload-docx`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data;
      if (row?.content) {
        setContent(row.content);
        if (editorRef.current) editorRef.current.innerHTML = row.content;
      }
      toast.success('Uploaded', file.name);
    } catch (e: any) {
      toast.error('Upload failed', e?.response?.data?.message ?? 'Please try again.');
    }
  };

  // Reset/hydrate on open
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setFullPage(false);
    setErrors({});
    setSaving(false);
    if (existing) {
      setAgreementType(existing.agreement_type ?? '');
      setTitle(existing.title ?? '');
      setRegulatory(existing.regulatory ?? 'less');
      setPurpose(existing.purpose ?? '');
      setParties(new Set((existing.party ?? '').split(',').map(s => s.trim()).filter(Boolean)));
      setSegments((existing.segment ?? '').split(',').map(s => s.trim()).filter(Boolean));
      setContent(existing.content ?? '');
      // Layer the saved zone config over branded defaults — pre-migration
      // rows come back with null and keep the logged-in user's branch
      // branding as their starting point.
      setHeaderConfig({ ...brandedDefaults.header, ...(existing.header_config || {}) } as HeaderConfig);
      setFooterConfig({ ...brandedDefaults.footer, ...(existing.footer_config || {}) } as FooterConfig);
    } else {
      setAgreementType('');
      setTitle('');
      setRegulatory('less');
      setPurpose('');
      setParties(new Set());
      setSegments([]);
      setContent('');
      setHeaderConfig(brandedDefaults.header);
      setFooterConfig(brandedDefaults.footer);
    }
  }, [open, existing, brandedDefaults]);

  /* Track the last caret position inside the body editor on every
   * selectionchange so opening a child modal (Placeholder / Table /
   * HR) doesn't clobber the in-editor caret. The listener only updates
   * when the new selection is INSIDE the editor, so modal openings
   * leave the stash untouched. */
  useEffect(() => {
    if (step !== 2) return;
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
        lastRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [step]);

  // When the user enters step 2, hydrate the contentEditable DOM from
  // the `content` state. Mirrors the Trade Doc draft page — the editor
  // node only exists in the tree on step 2 so this is the right place
  // to seed its innerHTML.
  useEffect(() => {
    // Only re-seed the DOM when it actually differs from `content` — i.e. on
    // step entry, fullPage toggle (portal remount) or an async load. During
    // typing, onInput→syncContent already set `content` FROM the DOM, so the
    // two are equal and we must NOT reassign innerHTML: doing so collapses the
    // caret to position 0, which made every keystroke land at the start
    // (text appearing right-to-left) and backspace jump to the first line.
    if (step === 2 && editorRef.current && editorRef.current.innerHTML !== (content ?? '')) {
      editorRef.current.innerHTML = content ?? '';
    }
    // `fullPage` is a dep because toggling it portals the editor to/from
    // <body>, remounting the contentEditable — re-push content so the draft
    // body survives the switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, content, fullPage]);

  useEffect(() => { setTypes(initialTypes); }, [initialTypes]);

  // Escape closes (but not while a child picker is open — the picker
  // owns the ESC behaviour while mounted)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (saving) return;
      if (placeholderOpen || clauseOpen || quickAddTypeOpen) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose, placeholderOpen, clauseOpen, quickAddTypeOpen]);

  const headerCode = useMemo(() => {
    if (editingId && existing?.code) return existing.code;
    return nextCode;
  }, [editingId, existing, nextCode]);

  /* Normalise the knownSegments prop into a uniform { name, regulatory_status }
   * shape regardless of whether the caller passed strings (legacy) or
   * objects (new shape). Legacy strings default to 'less' so they still
   * surface on the less-regulatory dropdown. */
  const normalisedSegments = useMemo(() => {
    return (knownSegments as Array<string | { name: string; regulatory_status: 'highly' | 'less' }>).map(s => (
      typeof s === 'string' ? { name: s, regulatory_status: 'less' as const } : s
    )).filter(s => !!s.name);
  }, [knownSegments]);

  /* Dropdown options for the current regulatory tier. Filter by the
   * radio selection so high-reg only shows highly-regulated segments
   * and less-reg only shows less-regulated ones. Any segments saved
   * on the row that no longer match the tier (e.g. the row's
   * regulatory was flipped after originally being saved) are still
   * appended so the user can see what's already there and remove it. */
  const segmentOptions = useMemo(() => {
    const byName = new Map<string, string>();
    normalisedSegments
      .filter(s => s.regulatory_status === regulatory)
      .forEach(s => byName.set(s.name, `${s.name}`));
    segments.forEach(name => { if (!byName.has(name)) byName.set(name, name); });
    return Array.from(byName.entries()).map(([value, label]) => ({ value, label }));
  }, [normalisedSegments, segments, regulatory]);

  const toggleParty = (v: string) => {
    setParties(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    setErrors(p => ({ ...p, party: '' }));
  };

  const allPartyValues = useMemo(
    () => [...PARTY_BUYER_CONSIGNEE, ...PARTY_SUPPLIER].map(p => p.value),
    [],
  );
  const allPartiesSelected = useMemo(
    () => allPartyValues.every(v => parties.has(v)),
    [parties, allPartyValues],
  );
  const toggleAllParties = () => {
    setParties(allPartiesSelected ? new Set() : new Set(allPartyValues));
    setErrors(p => ({ ...p, party: '' }));
  };

  const validateStep1 = () => {
    const next: Record<string, string> = {};
    if (!agreementType.trim()) next.agreementType = 'Agreement type is required';

    const t = title.trim();
    if (!t)                 next.title = 'Title is required';
    else if (t.length < 3)  next.title = 'Title must be at least 3 characters';
    else if (t.length > 255) next.title = 'Title must not be greater than 255 characters';

    const p = purpose.trim();
    if (!p)                  next.purpose = 'Purpose is required';
    else if (p.length < 10)  next.purpose = 'Purpose must be at least 10 characters';
    else if (p.length > 1000) next.purpose = 'Purpose must not be greater than 1000 characters';

    if (parties.size === 0)     next.party         = 'Select at least one applicable party';
    if (regulatory === 'highly' && segments.length !== 1) {
      next.segment = 'High-regulatory agreements need exactly one segment';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => { if (validateStep1()) setStep(2); };
  const goBack = () => setStep(1);

  const insertPlaceholderToken = (token: string) => {
    insertAtCaret(token + ' ');
  };

  const handleSave = async () => {
    if (!validateStep1()) { setStep(1); return; }
    setSaving(true);
    // Strip any previous meta comment from the editor's content so we don't
    // accumulate duplicates on every edit, then prepend a fresh one.
    // The Signing Workflow / Expiry Conditions section was removed from
    // the wizard — agreements no longer carry signing metadata in their
    // content blob. stripMetaFromContent still runs so legacy rows
    // (drafted before the cut) load cleanly without the embedded
    // <!-- AGW-META --> comment leaking back into the editor.
    const raw = (editorRef.current?.innerHTML ?? content ?? '').trim();
    // Purpose is now its own persisted column (no longer baked into the
    // content HTML), so the editor body stays clean — just strip legacy meta.
    const finalContent = stripMetaFromContent(raw) || null;
    const payload: Omit<AgrLib, 'id' | 'code'> = {
      agreement_type: agreementType.trim(),
      title:          title.trim(),
      purpose:        purpose.trim() || null,
      party:          Array.from(parties).join(', '),
      regulatory,
      // Backend column still exists but is hard-coded false since the
      // wizard no longer exposes a signing-workflow toggle. A separate
      // Send-for-Signature flow drives Zoho Sign when needed.
      signing:        false,
      // Persist as CSV — high-reg always sends a single segment, less-reg
      // can send zero or many. Empty list → null so the column stays
      // searchable as "no segment configured".
      segment:        segments.length ? segments.join(', ') : null,
      agr_status:     'Active',
      content:        finalContent,
      header_config:  headerConfig,
      footer_config:  footerConfig,
    };
    try {
      if (editingId) {
        await api.put(`/clm/agreement-library/${editingId}`, payload);
        toast.success('Updated', payload.title);
      } else {
        await api.post('/clm/agreement-library', payload);
        toast.success('Added', payload.title);
      }
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onAddNewType = async (form: { name: string; description: string }) => {
    try {
      const r = await api.post<{ status: boolean; data: AgrType }>(
        '/clm/agreement-types',
        form,
      );
      const created = r.data.data;
      setTypes(prev => [...prev, created]);
      setAgreementType(created.name);
      setQuickAddTypeOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="agw-overlay"
      role="dialog"
      aria-modal="true"
    >
      <style>{AGW_CSS}</style>
      <div className="agw-shell">
        {/* Header */}
        <div className="agw-head">
          <div className="agw-head-left">
            <div className="agw-head-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="agw-head-text">
              <div className="agw-head-eyebrow">AGREEMENT LIBRARY</div>
              <div className="agw-head-title">{editingId ? 'Edit Agreement' : 'Add New Agreement'}</div>
              <div className="agw-head-sub">Create a reusable agreement template for CLM workflows</div>
            </div>
          </div>
          <div className="agw-head-right">
            <div className="agw-id-chip">
              <div className="agw-id-chip-label">AGREEMENT ID</div>
              <div className="agw-id-chip-val">{headerCode}</div>
            </div>
            <button type="button" className="agw-close" onClick={onClose} aria-label="Close" disabled={saving}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stepper */}
        <div className="agw-stepper">
          <div className="agw-stepper-row">
            {STEPS.map((s, idx) => {
              const active   = s.key === step;
              const complete = s.key < step;
              return (
                <div key={s.key} className={`agw-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}>
                  <div className="agw-step-num">
                    {complete
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      : <span>{s.key}</span>}
                  </div>
                  <div className="agw-step-text">
                    <div className="agw-step-label">{s.label}</div>
                    <div className="agw-step-sub">{s.sub}</div>
                  </div>
                  {idx < STEPS.length - 1 && <div className={`agw-step-line ${complete ? 'is-complete' : ''}`} />}
                </div>
              );
            })}
          </div>
          <div className="agw-stepper-progress">
            <div className="agw-stepper-label">Step {step} of {STEPS.length}</div>
          </div>
        </div>

        {/* Body */}
        <div className={`agw-body ${step === 2 ? 'agw-body-editor' : ''}`}>
          {step === 1 ? (
            <div className="agw-step-body">
              <div className="agw-grid-2">
                <div className="agw-field">
                  <label className="agw-label">Agreement Type <span className="agw-req">*</span></label>
                  <div className="agw-inline-add">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MasterSelect
                        key={`agw-type-${types.length}`}
                        value={agreementType}
                        invalid={!!errors.agreementType}
                        placeholder="— Select Agreement Type —"
                        options={[
                          ...types.map(t => ({ value: t.name, label: t.name })),
                          ...(agreementType && !types.find(t => t.name === agreementType) ? [{ value: agreementType, label: agreementType }] : []),
                        ]}
                        onChange={(v) => { setAgreementType(v); setErrors(p => ({ ...p, agreementType: '' })); }}
                      />
                    </div>
                    <Tooltip label="Add new agreement type">
                      <button type="button" className="agw-add-mini" onClick={() => setQuickAddTypeOpen(true)} aria-label="Add agreement type">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </Tooltip>
                  </div>
                  {errors.agreementType && <div className="agw-err">{errors.agreementType}</div>}
                </div>

                <div className="agw-field">
                  <label className="agw-label">Agreement Title <span className="agw-req">*</span></label>
                  <input
                    type="text"
                    className={`agw-input ${errors.title ? 'is-err' : ''}`}
                    placeholder="e.g. Master Supplier Agreement — FY2026"
                    maxLength={255}
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); setErrors(p => ({ ...p, title: '' })); }}
                  />
                  {errors.title && <div className="agw-err">{errors.title}</div>}
                </div>
              </div>

              {/* Regulatory status card */}
              <div className="agw-reg">
                <div className="agw-reg-head">
                  <span className="agw-reg-ico">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  </span>
                  Segment Regulatory Status <span className="agw-req">*</span>
                </div>
                <div className="agw-reg-grid">
                  <label className={`agw-reg-opt agw-reg-high ${regulatory === 'highly' ? 'is-on' : ''}`}>
                    <input type="radio" name="agw-reg" checked={regulatory === 'highly'} onChange={() => { setRegulatory('highly'); setSegments([]); setErrors(p => ({ ...p, segment: '' })); }} />
                    <span className="agw-reg-opt-dot" />
                    <div>
                      <div className="agw-reg-opt-title">High Regulatory</div>
                      <div className="agw-reg-opt-sub">Requires specific segment &amp; compliance review</div>
                    </div>
                  </label>
                  <label className={`agw-reg-opt agw-reg-less ${regulatory === 'less' ? 'is-on' : ''}`}>
                    <input type="radio" name="agw-reg" checked={regulatory === 'less'} onChange={() => { setRegulatory('less'); setSegments([]); setErrors(p => ({ ...p, segment: '' })); }} />
                    <span className="agw-reg-opt-dot" />
                    <div>
                      <div className="agw-reg-opt-title">Less Regulatory</div>
                      <div className="agw-reg-opt-sub">Applicable to all standard segments by default</div>
                    </div>
                  </label>
                </div>
                {/* Segment selector — gated by the regulatory tier:
                      - High-reg: single-select (each high-reg agreement
                        targets exactly one regulated segment).
                      - Less-reg: multi-select (a less-reg agreement can
                        apply across many general segments). The dropdown
                        only lists segments whose master tier matches the
                        current radio, so the user can never accidentally
                        cross tiers. */}
                <div className="agw-field" style={{ marginTop: 12 }}>
                  <label className="agw-label">
                    {regulatory === 'highly' ? <>Segment <span className="agw-req">*</span></> : 'Segments (select one or more)'}
                  </label>
                  {regulatory === 'highly' ? (
                    <MasterSelect
                      key={`agw-seg-h-${segmentOptions.length}`}
                      value={segments[0] ?? ''}
                      invalid={!!errors.segment}
                      placeholder={segmentOptions.length ? '— Select Segment —' : 'No highly-regulated segments configured'}
                      options={segmentOptions}
                      onChange={(v) => { setSegments(v ? [v] : []); setErrors(p => ({ ...p, segment: '' })); }}
                    />
                  ) : (
                    <MasterMultiSelect
                      key={`agw-seg-l-${segmentOptions.length}`}
                      value={segments}
                      invalid={!!errors.segment}
                      placeholder={segmentOptions.length ? '— Select Segments —' : 'No less-regulated segments configured'}
                      options={segmentOptions}
                      onChange={(vs) => { setSegments(vs); setErrors(p => ({ ...p, segment: '' })); }}
                    />
                  )}
                  {errors.segment && <div className="agw-err">{errors.segment}</div>}
                </div>
              </div>

              <div className="agw-field">
                <label className="agw-label">Agreement Purpose <span className="agw-req">*</span></label>
                <textarea
                  className={`agw-input agw-textarea ${errors.purpose ? 'is-err' : ''}`}
                  placeholder="e.g. Governs supplier material sourcing terms for the FY2026 procurement cycle…"
                  maxLength={1000}
                  value={purpose}
                  onChange={(e) => { setPurpose(e.target.value); setErrors(p => ({ ...p, purpose: '' })); }}
                />
                {errors.purpose && <div className="agw-err">{errors.purpose}</div>}
              </div>

              {/* Applicable Party */}
              <div className="agw-party">
                <div className="agw-party-top">
                  <div className="agw-party-head">
                    <span className="agw-party-ico">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </span>
                    Applicable Party <span className="agw-req">*</span>
                  </div>
                  <label className={`agw-checkbox agw-checkbox-all ${allPartiesSelected ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={allPartiesSelected} onChange={toggleAllParties} />
                    <span className="agw-checkbox-label">ALL</span>
                  </label>
                </div>

                <div className="agw-party-row">
                  <div className="agw-party-label agw-party-label-buyer">BUYER &amp; CONSIGNEE</div>
                  <div className="agw-party-options">
                    {PARTY_BUYER_CONSIGNEE.map(p => (
                      <label key={p.value} className={`agw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="agw-checkbox-emoji">{p.icon}</span>
                        <span className="agw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="agw-party-row">
                  <div className="agw-party-label agw-party-label-supplier">SUPPLIER</div>
                  <div className="agw-party-options">
                    {PARTY_SUPPLIER.map(p => (
                      <label key={p.value} className={`agw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="agw-checkbox-emoji">{p.icon}</span>
                        <span className="agw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="agw-party-hint">Select all parties this agreement applies to.</div>
                {errors.party && <div className="agw-err">{errors.party}</div>}
              </div>
              {/* Signing Workflow + Expiry Conditions card removed —
                  agreements no longer carry signing/validity/renewal/
                  notice settings. Send-for-Signature lives in a
                  separate flow when needed. */}
            </div>
          ) : (
            <div className="agw-step-body">
              <AgrEditor
                editorRef={editorRef}
                fontSize={fontSize}
                setFontSizeState={setFontSizeState}
                applyFontSize={applyFontSize}
                block={block}
                setBlockState={setBlockState}
                applyBlock={applyBlock}
                exec={exec}
                insertLink={insertLink}
                stashSelection={stashSelection}
                syncContent={syncContent}
                docxRef={docxRef}
                onDownloadDocx={() => void downloadDocx()}
                onUploadDocx={(f) => void uploadDocx(f)}
                onOpenPlaceholder={() => { stashSelection(); setPlaceholderOpen(true); setClauseOpen(false); }}
                onOpenClauseLibrary={() => { setClauseOpen(o => !o); setPlaceholderOpen(false); }}
                onOpenTablePicker={() => { stashSelection(); setTablePickerOpen(true); }}
                onOpenHrPicker={() => { stashSelection(); setHrPickerOpen(true); }}
                clauseOpen={clauseOpen}
                onCloseClauseLibrary={() => setClauseOpen(false)}
                onInsertClause={(html) => { insertHtmlAtCaret(html); setClauseOpen(false); }}
                editingId={editingId}
                headerConfig={headerConfig}
                setHeaderConfig={setHeaderConfig}
                footerConfig={footerConfig}
                setFooterConfig={setFooterConfig}
                fullPage={fullPage}
                setFullPage={setFullPage}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="agw-foot">
          <div className="agw-foot-left">
            {step === 2 && (
              <button type="button" className="agw-btn agw-btn-back" onClick={goBack} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back
              </button>
            )}
          </div>
          <div className="agw-foot-right">
            <button type="button" className="agw-btn agw-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            {step === 1 ? (
              <button type="button" className="agw-btn agw-btn-primary" onClick={goNext} disabled={saving}>
                Save &amp; Next
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ) : (
              <button type="button" className="agw-btn agw-btn-save" onClick={() => void handleSave()} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Saving…' : 'Submit & Save Agreement'}
              </button>
            )}
          </div>
        </div>

        {/* Quick-add agreement type */}
        {quickAddTypeOpen && (
          <SimpleDescModal
            title="Add Agreement Type"
            namePlaceholder="e.g. Sales Agreement, Service Agreement"
            descPlaceholder="Short description of when this agreement type is used"
            code={`AT-${String(types.length + 1).padStart(3, '0')}`}
            isEdit={false}
            initialName=""
            initialDesc=""
            onClose={() => setQuickAddTypeOpen(false)}
            onSave={(f) => void onAddNewType(f)}
          />
        )}

        {/* Insert Placeholder picker */}
        {placeholderOpen && (
          <PlaceholderPicker
            onClose={() => setPlaceholderOpen(false)}
            onPick={(token) => { if (/^\s*</.test(token)) insertHtmlAtCaret(token); else insertPlaceholderToken(token); setPlaceholderOpen(false); }}
          />
        )}

        {/* Insert Table picker — same component the Trade Doc draft uses
            so generated table markup stays consistent across CLM. */}
        <ClmInsertTableModal
          open={tablePickerOpen}
          onClose={() => setTablePickerOpen(false)}
          onInsert={(html) => { insertHtmlAtCaret(html); setTablePickerOpen(false); }}
        />

        {/* Insert Horizontal Line picker — replaces the toolbar's plain
            HR button with the styled-line picker (colour, height, style)
            so PDF output renders a deliberate separator instead of the
            1px grey line dompdf falls back to. */}
        <ClmInsertHrModal
          open={hrPickerOpen}
          onClose={() => setHrPickerOpen(false)}
          onInsert={(html) => { insertHtmlAtCaret(html); setHrPickerOpen(false); }}
        />
      </div>
    </div>,
    document.body,
  );
}

/* ── Agreement editor sub-component ─────────────────────────────────
 * Uses the same contentEditable + execCommand engine as the Trade
 * Document draft page (ClmTradeDocumentDraftPage.tsx) so the two
 * editors are visually and functionally identical. */

function AgrEditor({
  editorRef,
  fontSize,
  setFontSizeState,
  applyFontSize,
  block,
  setBlockState,
  applyBlock,
  exec,
  insertLink,
  stashSelection,
  syncContent,
  docxRef,
  onDownloadDocx,
  onUploadDocx,
  onOpenPlaceholder,
  onOpenClauseLibrary,
  onCloseClauseLibrary,
  onOpenTablePicker,
  onOpenHrPicker,
  clauseOpen,
  onInsertClause,
  editingId,
  headerConfig,
  setHeaderConfig,
  footerConfig,
  setFooterConfig,
  fullPage,
  setFullPage,
}: {
  editorRef: React.MutableRefObject<HTMLDivElement | null>;
  fontSize: string;
  setFontSizeState: (v: string) => void;
  applyFontSize: (px: string) => void;
  block: string;
  setBlockState: (v: string) => void;
  applyBlock: (tag: string) => void;
  exec: (cmd: string, value?: string) => void;
  insertLink: () => void;
  stashSelection: () => void;
  syncContent: () => void;
  docxRef: React.MutableRefObject<HTMLInputElement | null>;
  onDownloadDocx: () => void;
  onUploadDocx: (file: File) => void;
  onOpenPlaceholder: () => void;
  onOpenClauseLibrary: () => void;
  onCloseClauseLibrary: () => void;
  onOpenTablePicker: () => void;
  onOpenHrPicker: () => void;
  clauseOpen: boolean;
  onInsertClause: (html: string) => void;
  editingId: number | null;
  headerConfig: HeaderConfig;
  setHeaderConfig: (h: HeaderConfig) => void;
  footerConfig: FooterConfig;
  setFooterConfig: (f: FooterConfig) => void;
  fullPage: boolean;
  setFullPage: (v: boolean | ((p: boolean) => boolean)) => void;
}) {
  const shell = (
    <div className={`agw-editor-shell ${fullPage ? 'agw-editor-shell-full' : ''}`}>
      <div className="agw-editor-head">
        <div className="agw-editor-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          DRAFT AGREEMENT CONTENT
        </div>
        <div className="agw-editor-actions">
          <input ref={docxRef} type="file" accept=".doc,.docx" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; if (f) onUploadDocx(f); e.currentTarget.value = ''; }} />
          <Tooltip label={editingId ? 'Download as DOCX' : 'Save the agreement first'}>
            <button type="button" className="agw-editor-btn" onClick={onDownloadDocx}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download DOCX
            </button>
          </Tooltip>
          <Tooltip label={editingId ? 'Upload a revised Word file' : 'Save the agreement first'}>
            <button type="button" className="agw-editor-btn" onClick={() => docxRef.current?.click()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload Word Doc
            </button>
          </Tooltip>
          <Tooltip label="Insert a {{group.field}} placeholder">
            <button type="button" className="agw-editor-btn" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={onOpenPlaceholder}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              {'{} Placeholder'}
            </button>
          </Tooltip>
          <Tooltip label="Insert a table at the caret">
            <button type="button" className="agw-editor-btn" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={onOpenTablePicker}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              Insert Table
            </button>
          </Tooltip>
          <Tooltip label="Browse reusable clauses">
            <button type="button" className="agw-editor-btn" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={onOpenClauseLibrary}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              Clause Library
            </button>
          </Tooltip>
          {/* Full Page — expands the drafting area to fill the screen (and
              collapses back) so long agreements can be authored without the
              modal frame cramping the editor. */}
          <Tooltip label={fullPage ? 'Exit full page' : 'Edit in full page'}>
            <button type="button" className={`agw-editor-btn ${fullPage ? 'is-on' : ''}`} onClick={() => setFullPage(v => !v)}>
              {fullPage ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
              )}
              {fullPage ? 'Exit Full Page' : 'Full Page'}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* preventDefault on mousedown keeps the editor's text selection alive
          when a toolbar BUTTON is clicked (so execCommand acts on the
          selection). Native <select> dropdowns, however, open ON mousedown —
          blanket-preventing it stopped the Font-size / Block-format dropdowns
          from opening at all. Skip the preventDefault when the target is a
          <select> (or its options) so those dropdowns work again. */}
      <div
        className="agw-toolbar"
        onMouseDown={e => { if (!(e.target as HTMLElement).closest('select')) e.preventDefault(); }}
      >
        <select className="agw-toolbar-sel" value={fontSize} onChange={e => { setFontSizeState(e.target.value); applyFontSize(e.target.value); }} title="Font size">
          <option value="11">11</option><option value="12">12</option><option value="13">13</option>
          <option value="14">14</option><option value="16">16</option><option value="18">18</option>
          <option value="20">20</option><option value="24">24</option><option value="28">28</option>
        </select>
        <select className="agw-toolbar-sel" value={block} onChange={e => { setBlockState(e.target.value); applyBlock(e.target.value); }} title="Block format">
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code</option>
        </select>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('bold')}          title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('italic')}        title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('underline')}     title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('superscript')}   title="Superscript">X²</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('subscript')}     title="Subscript">X₂</button>
        <label className="agw-toolbar-btn agw-toolbar-color" title="Text color" style={{ position: 'relative' }}>
          T
          <input type="color" defaultValue="#0c4a6e" onChange={e => exec('foreColor', e.target.value)}
                 style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
        {/* Highlight — system color picker (click ✎) + quick-pick
            swatches for the everyday yellow / mint / sky / pink / lilac
            so the user doesn't have to dive into the OS picker for
            common cases. Same palette the Trade Doc modal uses. */}
        <label className="agw-toolbar-btn agw-toolbar-color" title="Custom highlight color" style={{ position: 'relative', color: '#f59e0b' }}>
          ✎
          <input type="color" defaultValue="#fde68a" onChange={e => exec('hiliteColor', e.target.value)}
                 style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
        {['#fde68a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e9d5ff'].map(c => (
          <button
            key={c}
            type="button"
            className="agw-toolbar-btn"
            title={`Highlight ${c}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => exec('hiliteColor', c)}
            style={{ background: c, width: 22, padding: 0, border: '1px solid #cbd5e1' }}
          >&nbsp;</button>
        ))}
        <span className="agw-toolbar-sep" />
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('justifyLeft')}    title="Align left">≡</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('justifyCenter')}  title="Align center">≡</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('justifyRight')}   title="Align right">≡</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('justifyFull')}    title="Justify">≡</button>
        <span className="agw-toolbar-sep" />
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('insertUnorderedList')} title="Bullet list">•≡</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('insertOrderedList')}   title="Numbered list">1≡</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('outdent')} title="Outdent">⇤</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('indent')}  title="Indent">⇥</button>
        <span className="agw-toolbar-sep" />
        {/* Insert HR opens the styled-line picker (colour / height /
            style) instead of dropping a plain <hr> — same UX as the
            Trade Doc modal. The previous selection is stashed before
            the modal opens so the insertion lands where the caret was. */}
        <button
          type="button" className="agw-toolbar-btn"
          title="Insert horizontal line"
          onMouseDown={e => { e.preventDefault(); stashSelection(); }}
          onClick={onOpenHrPicker}
        >—</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('undo')} title="Undo">↶</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('redo')} title="Redo">↷</button>
        <button type="button" className="agw-toolbar-btn" onClick={() => exec('removeFormat')} title="Clear formatting">🅣</button>
      </div>

      {/* Scrollable region — the editor head + toolbar above stay pinned;
          only this page-shell preview scrolls when the content grows. */}
      <div className="agw-editor-scroll">
        {/* Page-shell preview — wraps the editor in a fixed header (logo +
            title + subtitle) and footer (text + page #). Same component
            the HR Document Templates Step 3 and Trade Document modal use,
            so look-and-feel stays uniform across CLM. Logo upload posts to
            the agreement_library tenant folder. */}
        <HeaderFooterPanel
          header={headerConfig} setHeader={setHeaderConfig}
          footer={footerConfig} setFooter={setFooterConfig}
          uploadLogoEndpoint="/clm/agreement-library/upload-header-logo"
        >
          <div
            ref={editorRef}
            className="agw-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={syncContent}
            role="textbox"
            aria-multiline="true"
            aria-label="Agreement content"
          />
        </HeaderFooterPanel>

        {/* Clause-library host (the picker itself portals to <body>). */}
        <div className="agw-editor-area">
          {clauseOpen && (
            <ClmClauseInsertPanel onClose={onCloseClauseLibrary} onInsert={onInsertClause} />
          )}
        </div>
      </div>

      <div className="agw-editor-foot">
        <span className="agw-editor-foot-hint">ⓘ Placeholders auto-fill on agreement generation</span>
        <Tooltip label="Open the placeholder picker">
          <button type="button" className="agw-editor-foot-tag" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={onOpenPlaceholder}>{'{{PLACEHOLDER}}'}</button>
        </Tooltip>
      </div>
    </div>
  );
  // In full page the shell is portalled to <body> so its position:fixed is
  // relative to the viewport — otherwise the modal's CSS transform traps it
  // inside the modal box (same approach as the Trade Doc draft editor).
  return fullPage ? createPortal(shell, document.body) : shell;
}

/* ── Insert Placeholder picker (modal-within-modal) ──────────────────── */

type PhField = { label: string; token: string };
type PhGroup = { id: string; label: string; iconEmoji: string; iconColor: string; fields: PhField[] };

const PLACEHOLDER_GROUPS: PhGroup[] = [
  { id: 'buyer', label: 'Buyer', iconEmoji: '👤', iconColor: '#0891b2', fields: [
    { label: 'Buyer Name',     token: '{{buyer.buyer_name}}' },
    { label: 'Buyer Code',     token: '{{buyer.buyer_code}}' },
    { label: 'Company',        token: '{{buyer.company}}' },
    { label: 'Contact Person', token: '{{buyer.contact_person}}' },
    { label: 'Phone',          token: '{{buyer.phone}}' },
    { label: 'Email',          token: '{{buyer.email}}' },
    { label: 'GST',            token: '{{buyer.gst}}' },
    { label: 'Country',        token: '{{buyer.country}}' },
    { label: 'Address',        token: '{{buyer.address}}' },
    { label: 'PAN',            token: '{{buyer.pan}}' },
    { label: 'IEC',            token: '{{buyer.iec}}' },
    { label: 'Risk Level',     token: '{{buyer.risk_level}}' },
  ] },
  { id: 'consignee', label: 'Consignee', iconEmoji: '🚚', iconColor: '#f59e0b', fields: [
    { label: 'Consignee Name', token: '{{consignee.consignee_name}}' },
    { label: 'Country',        token: '{{consignee.country}}' },
    { label: 'Address',        token: '{{consignee.address}}' },
    { label: 'Role',           token: '{{consignee.role}}' },
    { label: 'City',           token: '{{consignee.city}}' },
    { label: 'Contact Person', token: '{{consignee.contact_person}}' },
    { label: 'Phone',          token: '{{consignee.phone}}' },
    { label: 'Email',          token: '{{consignee.email}}' },
  ] },
  { id: 'supplier', label: 'Supplier', iconEmoji: '📦', iconColor: '#16a34a', fields: [
    { label: 'Supplier Name',  token: '{{supplier.supplier_name}}' },
    { label: 'Vendor Code',    token: '{{supplier.vendor_code}}' },
    { label: 'Company',        token: '{{supplier.company}}' },
    { label: 'Contact Person', token: '{{supplier.contact_person}}' },
    { label: 'Phone',          token: '{{supplier.phone}}' },
    { label: 'Email',          token: '{{supplier.email}}' },
    { label: 'GST',            token: '{{supplier.gst}}' },
    { label: 'PAN',            token: '{{supplier.pan}}' },
    { label: 'Country',        token: '{{supplier.country}}' },
    { label: 'City',           token: '{{supplier.city}}' },
    { label: 'Category',       token: '{{supplier.category}}' },
    { label: 'Risk Level',     token: '{{supplier.risk_level}}' },
  ] },
  { id: 'product', label: 'Product', iconEmoji: '🛒', iconColor: '#8b5cf6', fields: [
    { label: 'Product Code',    token: '{{product.code}}' },
    { label: 'Product Name',    token: '{{product.name}}' },
    { label: 'Product Segment', token: '{{product.segment}}' },
    { label: 'Quantity',        token: '{{product.quantity}}' },
  ] },
];

/* A ready-made product table, identical to the trade-doc picker's. Its single
 * tbody row carries the {{product.*}} tokens; the agreement render path
 * (renderAgreementPdf → expandProductTable) repeats that row once per product
 * on the opportunity at generation time. */
const PH_TD_CELL = 'border:1px solid #cbd5e1;padding:6px 10px;';
const PH_TH_CELL = `${PH_TD_CELL}background:#f1f5f9;font-weight:700;text-align:left;`;
const PRODUCT_TABLE_HTML =
  `<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;">` +
    `<thead><tr>` +
      `<th style="${PH_TH_CELL}">#</th>` +
      `<th style="${PH_TH_CELL}">Product Code</th>` +
      `<th style="${PH_TH_CELL}">Product Name</th>` +
      `<th style="${PH_TH_CELL}">Segment</th>` +
      `<th style="${PH_TH_CELL}text-align:right;">Quantity</th>` +
    `</tr></thead>` +
    `<tbody><tr>` +
      `<td style="${PH_TD_CELL}">{{product.sr}}</td>` +
      `<td style="${PH_TD_CELL}">{{product.code}}</td>` +
      `<td style="${PH_TD_CELL}">{{product.name}}</td>` +
      `<td style="${PH_TD_CELL}">{{product.segment}}</td>` +
      `<td style="${PH_TD_CELL}text-align:right;">{{product.quantity}}</td>` +
    `</tr></tbody>` +
  `</table>`;

function PlaceholderPicker({ onClose, onPick }: { onClose: () => void; onPick: (token: string) => void }) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string>('buyer');
  // Multi-select set — tokens ticked across ALL groups so one "Copy
  // selected" can grab a mix of buyer + consignee + supplier placeholders.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const writeClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
  };

  const copyToken = async (token: string) => {
    try { await writeClipboard(token); toast.success('Copied', `${token} copied to clipboard.`); }
    catch { toast.error('Could not copy', 'Clipboard access was blocked — copy manually.'); }
  };

  const copySelected = async () => {
    if (selected.size === 0) return;
    const ordered = PLACEHOLDER_GROUPS.flatMap(g => g.fields).map(f => f.token).filter(tok => selected.has(tok));
    try {
      await writeClipboard(ordered.join(' '));
      toast.success('Copied', `${ordered.length} placeholder${ordered.length === 1 ? '' : 's'} copied to clipboard.`);
    } catch { toast.error('Could not copy', 'Clipboard access was blocked — copy manually.'); }
  };

  const toggleSelect = (token: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token); else next.add(token);
      return next;
    });
  };

  const active = PLACEHOLDER_GROUPS.find(g => g.id === activeId) ?? PLACEHOLDER_GROUPS[0];
  const allInGroupSelected = active.fields.length > 0 && active.fields.every(f => selected.has(f.token));
  const toggleSelectAllInGroup = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allInGroupSelected) active.fields.forEach(f => next.delete(f.token));
      else active.fields.forEach(f => next.add(f.token));
      return next;
    });
  };

  return createPortal(
    <div className="agw-ph-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="agw-ph-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="agw-ph-head">
          <div className="agw-ph-head-left">
            <div className="agw-ph-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </div>
            <div>
              <div className="agw-ph-eyebrow">DRAFT EDITOR</div>
              <div className="agw-ph-title">Insert Placeholder</div>
            </div>
          </div>
          <div className="agw-ph-head-right">
            <span className="agw-ph-format-chip">{'{{group.field}}'}</span>
            <button type="button" className="agw-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div className="agw-ph-hint">ⓘ Click a field to insert it, or tick the checkboxes and use “Copy selected” to copy several placeholders at once.</div>
        <div className="agw-ph-body">
          <div className="agw-ph-sidebar" role="tablist">
            {PLACEHOLDER_GROUPS.map(g => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === activeId}
                className={`agw-ph-tab ${g.id === activeId ? 'is-on' : ''}`}
                style={{ ['--ph-tab-color' as any]: g.iconColor }}
                onClick={() => setActiveId(g.id)}
              >
                <span className="agw-ph-tab-emoji" aria-hidden>{g.iconEmoji}</span>
                <span className="agw-ph-tab-text">
                  <span className="agw-ph-tab-label">{g.label}</span>
                  <span className="agw-ph-tab-sub">{g.fields.length} fields</span>
                </span>
              </button>
            ))}
          </div>
          <div className="agw-ph-fields" role="tabpanel">
            <div className="agw-ph-fields-head">
              <span className="agw-ph-fields-ico" style={{ background: hexA(active.iconColor, .12), color: active.iconColor }}>{active.iconEmoji}</span>
              <div>
                <div className="agw-ph-fields-title" style={{ color: active.iconColor }}>{active.label} Fields</div>
                <div className="agw-ph-fields-sub">Select a field to insert its placeholder into the agreement</div>
              </div>
            </div>
            <div className="agw-ph-selbar">
              <label className="agw-ph-selall">
                <input type="checkbox" checked={allInGroupSelected} onChange={toggleSelectAllInGroup} />
                Select all in {active.label} ({active.fields.length})
              </label>
              <div className="agw-ph-selbar-actions">
                <span className="agw-ph-selcount">{selected.size} selected</span>
                <button type="button" className="agw-ph-selbtn agw-ph-selbtn-copy" disabled={selected.size === 0}
                        onClick={() => void copySelected()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy selected
                </button>
                <button type="button" className="agw-ph-selbtn" disabled={selected.size === 0}
                        onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            </div>

            <div className="agw-ph-grid">
              {activeId === 'product' && (
                <div
                  className="agw-ph-card"
                  style={{ ['--ph-card-color' as any]: active.iconColor, gridColumn: '1 / -1', borderColor: hexA(active.iconColor, .4), background: hexA(active.iconColor, .05) }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(PRODUCT_TABLE_HTML)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(PRODUCT_TABLE_HTML); } }}
                  title="Insert a product table"
                >
                  <span className="agw-ph-card-top">
                    <span className="agw-ph-card-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: active.iconColor }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                      Product Table
                    </span>
                  </span>
                  <span className="agw-ph-card-token" style={{ whiteSpace: 'normal' }}>Inserts a table with Code · Name · Segment · Quantity — one row per product at generation time.</span>
                </div>
              )}
              {active.fields.map(f => {
                const isChecked = selected.has(f.token);
                return (
                <div
                  key={f.token}
                  className={`agw-ph-card ${isChecked ? 'is-checked' : ''}`}
                  style={{ ['--ph-card-color' as any]: active.iconColor }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(f.token)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(f.token); } }}
                  title={`Click to insert ${f.token}`}
                >
                  <span className="agw-ph-card-top">
                    <input type="checkbox" className="agw-ph-card-check" checked={isChecked}
                           title="Select for bulk copy" aria-label={`Select ${f.token} for bulk copy`}
                           onClick={e => e.stopPropagation()}
                           onChange={() => toggleSelect(f.token)} />
                    <span className="agw-ph-card-label">{f.label}</span>
                    <button type="button" className="agw-ph-card-copy" title={`Copy ${f.token}`} aria-label={`Copy ${f.token}`}
                            onClick={e => { e.stopPropagation(); void copyToken(f.token); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </span>
                  <span className="agw-ph-card-token">{f.token}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Legacy AGW-META comment scrubber. Rows drafted before the Signing
 * Workflow section was cut had a leading
 *   <!-- AGW-META: {"sequential":…,"digitalSig":…,"validityPeriod":…} -->
 * plus auto-prepended Purpose / Signing paragraphs. Edit-mode strips
 * them out so re-saves don't accumulate duplicates and the editor
 * doesn't render the hidden comment as visible text. The metadata
 * itself is intentionally NOT re-hydrated — those fields no longer
 * exist on the UI. */
const META_RE = /^\s*<!--\s*AGW-META:\s*(\{[\s\S]*?\})\s*-->\s*/;
function stripMetaFromContent(content: string): string {
  let out = content.replace(META_RE, '');
  out = out.replace(/^\s*<p>\s*<strong>\s*Purpose\s*:?\s*<\/strong>[\s\S]*?<\/p>\s*/i, '');
  out = out.replace(/^\s*<p>\s*<strong>\s*Signing\s*:?\s*<\/strong>[\s\S]*?<\/p>\s*/i, '');
  return out;
}

function hexA(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ── Scoped CSS ───────────────────────────────────────────────────────── */

const AGW_CSS = `
.agw-overlay {
  position: fixed; inset: 0; z-index: 200000;
  background: rgba(7,30,50,.65);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
  animation: agwFade .18s ease both;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
@keyframes agwFade { from { opacity: 0; } to { opacity: 1; } }
.agw-shell {
  width: 100%; max-width: 1100px; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff; margin: auto;
  box-shadow: 0 28px 70px rgba(15,23,42,.45), 0 12px 32px rgba(6,182,212,.22), 0 0 0 1px rgba(255,255,255,.06);
  border: 1px solid rgba(6,182,212,.20);
  animation: agwSlideUp .24s cubic-bezier(.22,1,.36,1) both;
}
@keyframes agwSlideUp { from { opacity: 0; transform: translateY(20px) scale(.97) } to { opacity: 1; transform: none } }

.agw-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 11px 22px;
  background: linear-gradient(110deg, #0c6680 0%, #0e7490 35%, #0891b2 75%, #06b6d4 100%);
  color: #fff; position: relative; overflow: hidden; flex-shrink: 0;
}
.agw-head::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.10), transparent); pointer-events: none; }
.agw-head > * { position: relative; z-index: 1; }
.agw-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.agw-head-ico {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.agw-head-text { min-width: 0; }
.agw-head-eyebrow { font-size: 9.5px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); text-transform: uppercase; }
.agw-head-title { font-size: 16px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; margin-top: 1px; }
.agw-head-sub { font-size: 11.5px; color: rgba(255,255,255,.86); margin-top: 2px; }
.agw-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.agw-id-chip { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.24); border-radius: 9px; padding: 5px 14px; text-align: right; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.agw-id-chip-label { font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.74); text-transform: uppercase; }
.agw-id-chip-val { font-size: 15px; font-weight: 800; color: #fff; margin-top: 1px; font-family: 'Geist Mono', ui-monospace, monospace; }
.agw-close { width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease, transform .15s ease; }
.agw-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }
.agw-close:disabled { opacity: .5; cursor: not-allowed; }

.agw-stepper { display: flex; align-items: center; justify-content: space-between; background: #f8feff; border-bottom: 1px solid rgba(6,182,212,.18); padding: 8px 22px; gap: 22px; flex-wrap: wrap; flex-shrink: 0; }
.agw-stepper-row { display: inline-flex; align-items: center; gap: 0; flex: 1; min-width: 0; flex-wrap: wrap; }
.agw-step { display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px; border-radius: 11px; position: relative; transition: background .18s ease, box-shadow .22s ease; }
.agw-step.is-active { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 14px rgba(8,145,178,.40); }
.agw-step.is-active .agw-step-label, .agw-step.is-active .agw-step-sub { color: #fff; }
.agw-step.is-active .agw-step-num { background: rgba(255,255,255,.20); border-color: rgba(255,255,255,.45); color: #fff; }
.agw-step.is-complete .agw-step-num { background: #22c55e; border-color: #16a34a; color: #fff; }
.agw-step-num { width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0; border: 1.5px solid rgba(6,182,212,.32); background: #f0fdff; color: #0e7490; font-size: 13px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.agw-step-text { min-width: 0; }
.agw-step-label { font-size: 13px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; line-height: 1.2; }
.agw-step-sub { font-size: 11px; color: #0e7490; opacity: .8; margin-top: 2px; }
.agw-step-line { width: 70px; height: 2px; flex-shrink: 0; background: #e2e8f0; margin: 0 6px; border-radius: 1px; transition: background .22s ease; }
.agw-step-line.is-complete { background: linear-gradient(90deg, #22c55e, #16a34a); }
.agw-stepper-progress { display: inline-flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: flex-end; }
.agw-stepper-label { font-size: 10.5px; font-weight: 700; color: #0e7490; background: #f0fdff; border: 1px solid rgba(6,182,212,.22); padding: 4px 10px; border-radius: 999px; }

.agw-body { flex: 1; min-height: 0; overflow-y: auto; background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%); padding: 22px; }
.agw-step-body { display: flex; flex-direction: column; gap: 16px; }
/* Step 2 (editor) — the body itself does NOT scroll; the editor card fills
 * the available height and only its page-shell region scrolls internally. */
.agw-body-editor { overflow: hidden; display: flex; flex-direction: column; }
.agw-body-editor .agw-step-body { flex: 1; min-height: 0; }
.agw-body-editor .agw-editor-shell { flex: 1; min-height: 0; }
.agw-grid-2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 18px; }
.agw-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.agw-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0e7490; }
.agw-req { color: #ef4444; font-size: 12px; line-height: 1; }
.agw-input {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  padding: 10px 13px; font-family: inherit; font-size: 13px; color: #0c4a6e; background: #fff; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.agw-input:hover { border-color: rgba(6,182,212,.40); }
.agw-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
.agw-input.is-err { border-color: #ef4444; }
.agw-input::placeholder { color: #94a3b8; }
.agw-textarea { min-height: 70px; resize: vertical; line-height: 1.55; }
.agw-err { font-size: 11px; color: #ef4444; font-weight: 600; }
.agw-inline-add { display: flex; gap: 8px; align-items: stretch; }
.agw-add-mini { width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0; border: none; cursor: pointer; background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(8,145,178,.35); transition: transform .15s ease, box-shadow .22s ease; }
.agw-add-mini:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(8,145,178,.50); }

/* Regulatory cards */
.agw-reg { border: 1.5px solid rgba(6,182,212,.20); border-radius: 14px; padding: 16px 18px; background: linear-gradient(180deg, #ffffff 0%, #f7feff 100%); }
.agw-reg-head { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0891b2; margin-bottom: 12px; }
.agw-reg-ico { width: 22px; height: 22px; border-radius: 7px; background: rgba(8,145,178,.10); display: inline-flex; align-items: center; justify-content: center; color: #0891b2; }
.agw-reg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.agw-reg-opt { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; border: 1.5px solid; cursor: pointer; transition: background .15s, box-shadow .22s ease, transform .15s ease; }
.agw-reg-opt input { display: none; }
.agw-reg-opt-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; border: 2px solid #cbd5e1; transition: border-color .15s ease, background .15s ease; }
.agw-reg-opt.is-on .agw-reg-opt-dot { border-color: currentColor; background: radial-gradient(circle at 50% 50%, currentColor 0 5px, transparent 6px); }
.agw-reg-opt-title { font-size: 13px; font-weight: 800; letter-spacing: -.01em; }
.agw-reg-opt-sub { font-size: 11px; opacity: .85; margin-top: 1px; }
.agw-reg-high { color: #b91c1c; background: rgba(254, 226, 226, .35); border-color: rgba(248,113,113,.35); }
.agw-reg-high.is-on { background: rgba(254, 226, 226, .7); border-color: #ef4444; box-shadow: 0 6px 18px rgba(239,68,68,.18); }
.agw-reg-less { color: #15803d; background: rgba(220, 252, 231, .35); border-color: rgba(74, 222, 128, .35); }
.agw-reg-less.is-on { background: rgba(220, 252, 231, .7); border-color: #22c55e; box-shadow: 0 6px 18px rgba(34,197,94,.18); }

/* Applicable Party card — row layout (label · options) mirroring T&C wizard */
.agw-party { border: 1.5px solid rgba(6,182,212,.20); border-radius: 14px; padding: 18px 20px; background: linear-gradient(180deg, #ffffff 0%, #f7feff 100%); display: flex; flex-direction: column; gap: 14px; }
.agw-party-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.agw-party-head { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0891b2; }
.agw-party-ico { width: 22px; height: 22px; border-radius: 7px; background: rgba(8,145,178,.10); display: inline-flex; align-items: center; justify-content: center; color: #0891b2; }
.agw-party-row {
  display: grid;
  grid-template-columns: 170px 1fr;
  align-items: center;
  gap: 14px;
}
.agw-party-label {
  font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: #475569;
  display: inline-flex; align-items: center; gap: 6px;
}
.agw-party-label::before {
  content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
}
.agw-party-label-buyer    { color: #0e7490; }
.agw-party-label-supplier { color: #15803d; }
.agw-party-label-combined { color: #6d28d9; }
.agw-party-options { display: inline-flex; flex-wrap: wrap; gap: 10px; }
.agw-checkbox { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; font-size: 13px; font-weight: 600; color: #334155; cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .22s ease; }
.agw-checkbox input { width: 14px; height: 14px; accent-color: #0891b2; }
.agw-checkbox-emoji { font-size: 15px; line-height: 1; }
.agw-checkbox:hover { border-color: rgba(6,182,212,.45); background: #f0fdff; }
.agw-checkbox.is-on { background: #f0fdff; border-color: #0891b2; color: #0e7490; box-shadow: 0 2px 8px rgba(8,145,178,.18); }
.agw-checkbox-all { padding: 6px 12px; font-size: 12px; letter-spacing: .04em; font-weight: 800; }
.agw-party-hint { font-size: 11.5px; color: #94a3b8; }
/* Signing Workflow + Expiry Conditions CSS removed — markup is gone. */
.agw-select {
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px 14px;
  padding-right: 32px;
}

/* Editor */
.agw-editor-shell { border: 1px solid rgba(6,182,212,.20); border-radius: 14px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
/* Full-page drafting — pops the editor out to fill the viewport. Sits above
   the modal overlay but below the Placeholder/Table/Clause pickers so those
   still open on top while in full page. */
.agw-editor-shell-full {
  position: fixed; inset: 0; z-index: 210000;
  border: 0; border-radius: 0;
  height: 100vh; max-height: 100vh;
}
.agw-editor-shell-full .agw-editor-scroll { flex: 1; min-height: 0; }
.agw-editor-shell-full .agw-editor-head { padding: 12px 20px; }
.agw-editor-btn.is-on { background: linear-gradient(135deg,#06b6d4,#0e7490); border-color: transparent; color: #fff; }
[data-bs-theme="dark"] .agw-editor-shell-full,
[data-layout-mode="dark"] .agw-editor-shell-full { background: #0f172a; }
.agw-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: linear-gradient(110deg, #0891b2, #0e7490); padding: 7px 14px; color: #fff; flex-shrink: 0; }
/* Scrollable page-shell region — sits between the pinned toolbar and the
 * pinned footer; grows/scrolls as the agreement content does. */
.agw-editor-scroll { flex: 1; min-height: 0; overflow-y: auto; background: #fff; }
.agw-editor-title { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.agw-editor-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.agw-editor-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 7px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff; font-size: 11px; font-weight: 700; cursor: pointer; transition: background .15s ease; }
.agw-editor-btn svg { width: 12px; height: 12px; }
.agw-editor-btn:hover { background: rgba(255,255,255,.26); }
/* Single-row toolbar — never wraps; scrolls horizontally if it overflows. */
.agw-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; overflow-x: auto; padding: 6px 10px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
.agw-toolbar::-webkit-scrollbar { height: 6px; }
.agw-toolbar::-webkit-scrollbar-thumb { background: rgba(6,182,212,.30); border-radius: 999px; }
.agw-toolbar-sel, .agw-toolbar-btn { height: 26px; min-width: 26px; padding: 0 6px; flex-shrink: 0; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.agw-toolbar-sel { min-width: auto; }
.agw-toolbar-btn:hover { background: #f0fdff; border-color: #67e8f9; color: #0891b2; }
.agw-toolbar-btn.is-on { background: #cffafe; border-color: #0891b2; color: #0c4a6e; box-shadow: inset 0 1px 2px rgba(8,145,178,.18); }
.agw-toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.agw-toolbar-sep { width: 1px; height: 18px; flex-shrink: 0; background: #cbd5e1; }

.agw-editor-area { position: relative; }
.agw-editor { min-height: 280px; padding: 18px 22px; background: #fff; outline: none; font-size: 13.5px; line-height: 1.6; color: #0c4a6e; }
.agw-editor:focus { outline: none; }
.agw-editor p { margin: 0 0 .6em 0; }
.agw-editor p:last-child { margin-bottom: 0; }
.agw-editor h1, .agw-editor h2, .agw-editor h3 { color: #0c4a6e; font-weight: 800; margin: .4em 0; line-height: 1.25; }
.agw-editor h1 { font-size: 22px; }
.agw-editor h2 { font-size: 18px; }
.agw-editor h3 { font-size: 15.5px; }
.agw-editor ul, .agw-editor ol { padding-left: 22px; margin: 0 0 .6em 0; }
.agw-editor blockquote { border-left: 3px solid #67e8f9; padding-left: 12px; margin: .4em 0; color: #475569; font-style: italic; }
.agw-editor code { background: #f0fdff; padding: 1px 5px; border-radius: 4px; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12.5px; color: #0e7490; }
.agw-editor pre { background: #f0fdff; border: 1px solid #cffafe; border-radius: 6px; padding: 10px 12px; margin: .6em 0; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12.5px; color: #0e7490; overflow-x: auto; }
.agw-editor hr { border: 0; border-top: 1px dashed #94a3b8; margin: 14px 0; }
.agw-editor a { color: #0891b2; text-decoration: underline; }
.agw-toolbar-color { overflow: hidden; font-weight: 800; }

.agw-clause-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(320px, 70%); background: #fff; border-left: 1px solid rgba(6,182,212,.22); box-shadow: -8px 0 24px rgba(15,23,42,.10); display: flex; flex-direction: column; animation: agwClauseSlide .22s ease both; z-index: 5; }
@keyframes agwClauseSlide { from { transform: translateX(12px); opacity: 0 } to { transform: none; opacity: 1 } }
.agw-clause-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: linear-gradient(110deg, #0891b2, #0e7490); color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.agw-clause-close { width: 24px; height: 24px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; }
.agw-clause-close:hover { background: rgba(255,255,255,.30); }
.agw-clause-panel-body { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.agw-clause-controls { padding: 10px 12px; border-bottom: 1px solid rgba(6,182,212,.16); display: flex; flex-direction: column; gap: 5px; background: #f8feff; }
.agw-clause-ctl-label { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #0e7490; }
.agw-clause-select { width: 100%; padding: 8px 10px; border-radius: 9px; border: 1.5px solid rgba(6,182,212,.30); background: #fff; color: #0c4a6e; font-size: 13px; font-weight: 600; cursor: pointer; outline: none; }
.agw-clause-select:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
.agw-clause-empty { padding: 24px 12px; text-align: center; font-size: 12px; color: #64748b; }
.agw-clause-item { display: flex; flex-direction: row; align-items: flex-start; gap: 9px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(6,182,212,.18); background: #f8feff; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.agw-clause-item:hover { border-color: #0891b2; background: #ecfeff; transform: translateY(-1px); }
.agw-clause-item.is-on { border-color: #0891b2; background: #ecfeff; box-shadow: 0 0 0 1px rgba(8,145,178,.25) inset; }
.agw-clause-check { width: 15px; height: 15px; flex-shrink: 0; margin-top: 2px; accent-color: #0891b2; cursor: pointer; }
.agw-clause-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.agw-clause-item-title { font-size: 13px; font-weight: 800; color: #0c4a6e; }
.agw-clause-item-sub { font-size: 11px; color: #0e7490; opacity: .85; overflow: hidden; text-overflow: ellipsis; }
.agw-clause-panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(6,182,212,.16); background: #f8feff; }
.agw-clause-selcount { font-size: 11.5px; font-weight: 700; color: #64748b; }
.agw-clause-insert { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9px; border: none; background: #0891b2; color: #fff; font-size: 12.5px; font-weight: 800; cursor: pointer; transition: background .15s ease, opacity .15s ease; }
.agw-clause-insert:hover:not(:disabled) { background: #0e7490; }
.agw-clause-insert:disabled { opacity: .45; cursor: not-allowed; }

.agw-editor-foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; background: #f0fdff; border-top: 1px solid #e2e8f0; font-size: 11.5px; gap: 12px; flex-wrap: wrap; flex-shrink: 0; }
.agw-editor-foot-hint { color: #0e7490; opacity: .85; }
.agw-editor-foot-tag { background: #fff; border: 1px solid #67e8f9; padding: 3px 9px; border-radius: 6px; color: #0891b2; font-weight: 700; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; cursor: pointer; transition: background .15s ease, color .15s ease, transform .15s ease; }
.agw-editor-foot-tag:hover { background: #cffafe; color: #0c4a6e; transform: translateY(-1px); }

/* Footer */
.agw-foot { display: flex; align-items: center; justify-content: space-between; background: #fff; border-top: 1px solid rgba(6,182,212,.18); padding: 14px 22px; flex-shrink: 0; }
.agw-foot-left, .agw-foot-right { display: inline-flex; align-items: center; gap: 10px; }
.agw-btn { display: inline-flex; align-items: center; gap: 7px; padding: 10px 22px; border-radius: 10px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform .18s ease, box-shadow .22s ease, background .18s ease, color .18s ease, border-color .18s ease; }
.agw-btn-back, .agw-btn-cancel { background: #fff; color: #475569; border: 1px solid #e2e8f0; }
.agw-btn-back:hover, .agw-btn-cancel:hover { border-color: #0891b2; color: #0891b2; background: #f0fdff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.16); }
.agw-btn-primary { background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%); color: #fff; border: none; box-shadow: 0 4px 14px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18); }
.agw-btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.22); }
.agw-btn-save { background: linear-gradient(135deg, #10b981 0%, #059669 55%, #047857 100%); color: #fff; border: none; box-shadow: 0 4px 14px rgba(16,185,129,.40), inset 0 1px 0 rgba(255,255,255,.18); }
.agw-btn-save:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(16,185,129,.55), inset 0 1px 0 rgba(255,255,255,.22); }
.agw-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── Placeholder Picker (modal-within-modal) ── */
.agw-ph-overlay {
  position: fixed; inset: 0; z-index: 300000;
  background: rgba(7,30,50,.72); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: agwFade .18s ease both;
}
.agw-ph-shell {
  width: 100%; max-width: 980px; max-height: calc(100vh - 40px);
  background: #fff; border-radius: 16px; overflow: hidden;
  border: 1px solid rgba(6,182,212,.22);
  box-shadow: 0 28px 70px rgba(15,23,42,.55), 0 12px 32px rgba(6,182,212,.20);
  display: flex; flex-direction: column;
  animation: agwSlideUp .22s cubic-bezier(.22,1,.36,1) both;
}
.agw-ph-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 22px; background: linear-gradient(110deg, #0c6680 0%, #0e7490 50%, #0891b2 100%); color: #fff; }
.agw-ph-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.agw-ph-head-ico { width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28); display: inline-flex; align-items: center; justify-content: center; color: #fff; }
.agw-ph-eyebrow { font-size: 9.5px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); text-transform: uppercase; }
.agw-ph-title { font-size: 16px; font-weight: 800; line-height: 1.2; }
.agw-ph-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.agw-ph-format-chip { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700; padding: 5px 10px; border-radius: 8px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.24); color: #fff; }
.agw-ph-hint { display: flex; align-items: center; gap: 6px; padding: 10px 22px; font-size: 11.5px; color: #0e7490; background: #f0fdff; border-bottom: 1px solid rgba(6,182,212,.18); }
.agw-ph-body { display: grid; grid-template-columns: 220px 1fr; min-height: 0; flex: 1; }
.agw-ph-sidebar { background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%); border-right: 1px solid rgba(6,182,212,.18); padding: 10px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.agw-ph-tab { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 10px; border: 0; background: transparent; color: #0c4a6e; font: inherit; cursor: pointer; text-align: left; transition: background .15s ease, color .15s ease; }
.agw-ph-tab:hover { background: rgba(8,145,178,.08); }
.agw-ph-tab.is-on { background: var(--ph-tab-color); color: #fff; }
.agw-ph-tab.is-on .agw-ph-tab-sub { color: rgba(255,255,255,.85); }
.agw-ph-tab-emoji { font-size: 18px; line-height: 1; flex-shrink: 0; }
.agw-ph-tab-text { display: flex; flex-direction: column; min-width: 0; }
.agw-ph-tab-label { font-size: 13px; font-weight: 800; color: inherit; }
.agw-ph-tab-sub { font-size: 10.5px; color: var(--ph-tab-color); opacity: .9; }
.agw-ph-tab.is-on .agw-ph-tab-emoji { filter: brightness(1.05); }
.agw-ph-fields { padding: 18px 22px; overflow-y: auto; }
.agw-ph-fields-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.agw-ph-fields-ico { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; }
.agw-ph-fields-title { font-size: 15.5px; font-weight: 800; }
.agw-ph-fields-sub { font-size: 11.5px; color: #64748b; }
.agw-ph-selbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 11px; margin-bottom: 12px; border-radius: 10px; background: #fff; border: 1.5px solid #e2e8f0; }
.agw-ph-selall { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: #0c4a6e; cursor: pointer; margin: 0; }
.agw-ph-selall input { width: 15px; height: 15px; accent-color: #0891b2; cursor: pointer; }
.agw-ph-selbar-actions { display: inline-flex; align-items: center; gap: 8px; }
.agw-ph-selcount { font-size: 12px; font-weight: 700; color: #64748b; }
.agw-ph-selbtn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; border: 1.5px solid rgba(6,182,212,.25); background: #fff; color: #0e7490; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background .15s ease, border-color .15s ease, opacity .15s ease, transform .15s ease; }
.agw-ph-selbtn:hover:not(:disabled) { background: #ecfeff; border-color: #0891b2; transform: translateY(-1px); }
.agw-ph-selbtn:disabled { opacity: .45; cursor: not-allowed; }
.agw-ph-selbtn-copy { background: #0891b2; border-color: #0891b2; color: #fff; }
.agw-ph-selbtn-copy:hover:not(:disabled) { background: #0e7490; border-color: #0e7490; color: #fff; }

.agw-ph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.agw-ph-card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; cursor: pointer; text-align: left; transition: border-color .15s ease, transform .15s ease, box-shadow .22s ease, background .15s ease; }
.agw-ph-card:hover { border-color: var(--ph-card-color); transform: translateY(-1px); box-shadow: 0 6px 14px rgba(15,23,42,.08); background: #fafffd; }
.agw-ph-card.is-checked { border-color: var(--ph-card-color); background: #ecfeff; box-shadow: 0 0 0 1px var(--ph-card-color) inset; }
.agw-ph-card-top { display: flex; align-items: center; gap: 8px; }
.agw-ph-card-check { width: 15px; height: 15px; flex-shrink: 0; accent-color: var(--ph-card-color); cursor: pointer; }
.agw-ph-card-label { font-size: 12.5px; font-weight: 800; color: #0c4a6e; flex: 1; min-width: 0; }
.agw-ph-card-copy { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; color: #94a3b8; cursor: pointer; opacity: 0; transition: opacity .15s ease, background .15s ease, color .15s ease, border-color .15s ease; }
.agw-ph-card:hover .agw-ph-card-copy, .agw-ph-card:focus-within .agw-ph-card-copy { opacity: 1; }
.agw-ph-card-copy:hover { background: #ecfeff; border-color: rgba(6,182,212,.30); color: #0891b2; }
.agw-ph-card-token { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px; font-weight: 600; color: var(--ph-card-color); }

/* MasterSelect dropdown above the modal */
.master-select-menu.dropdown-menu { z-index: 350000 !important; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .agw-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-stepper { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-step-num { background: rgba(8,145,178,.16); border-color: rgba(6,182,212,.35); color: #67e8f9; }
[data-bs-theme="dark"] .agw-step-label { color: #cffafe; }
[data-bs-theme="dark"] .agw-step-sub { color: #67e8f9; }
[data-bs-theme="dark"] .agw-step.is-active .agw-step-label, [data-bs-theme="dark"] .agw-step.is-active .agw-step-sub { color: #fff; }
[data-bs-theme="dark"] .agw-step-line { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .agw-stepper-label { background: rgba(8,145,178,.16); color: #67e8f9; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .agw-body { background: linear-gradient(160deg, rgba(8,145,178,.06) 0%, rgba(8,145,178,.03) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .agw-label { color: #67e8f9; }
[data-bs-theme="dark"] .agw-input { background-color: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .agw-input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .agw-reg, [data-bs-theme="dark"] .agw-party { background: linear-gradient(180deg, #0f172a 0%, #102234 100%); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-reg-head, [data-bs-theme="dark"] .agw-party-head { color: #67e8f9; }
[data-bs-theme="dark"] .agw-reg-ico, [data-bs-theme="dark"] .agw-party-ico { background: rgba(8,145,178,.20); color: #67e8f9; }
[data-bs-theme="dark"] .agw-reg-opt-sub { color: #94a3b8; }
/* High/Less Regulatory radio cards use light red/green tinted backgrounds in
 * light mode (rgba(254,226,226,.35) / rgba(220,252,231,.35)). Without these
 * overrides the same tints render as nearly-white islands in dark mode and
 * the dark red/green title text becomes unreadable against them. */
[data-bs-theme="dark"] .agw-reg-high {
  background: rgba(239,68,68,.10);
  border-color: rgba(239,68,68,.30);
  color: #fca5a5;
}
[data-bs-theme="dark"] .agw-reg-high.is-on {
  background: rgba(239,68,68,.18);
  border-color: #ef4444;
  color: #fca5a5;
  box-shadow: 0 6px 18px rgba(239,68,68,.25);
}
[data-bs-theme="dark"] .agw-reg-less {
  background: rgba(34,197,94,.10);
  border-color: rgba(34,197,94,.30);
  color: #86efac;
}
[data-bs-theme="dark"] .agw-reg-less.is-on {
  background: rgba(34,197,94,.18);
  border-color: #22c55e;
  color: #86efac;
  box-shadow: 0 6px 18px rgba(34,197,94,.25);
}
[data-bs-theme="dark"] .agw-party-label { color: #cbd5e1; }
[data-bs-theme="dark"] .agw-party-label-buyer    { color: #67e8f9; }
[data-bs-theme="dark"] .agw-party-label-supplier { color: #4ade80; }
[data-bs-theme="dark"] .agw-party-label-combined { color: #c4b5fd; }
[data-bs-theme="dark"] .agw-party-hint { color: #94a3b8; }
[data-bs-theme="dark"] .agw-checkbox { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .agw-checkbox:hover { background: rgba(8,145,178,.10); border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-checkbox.is-on { background: rgba(8,145,178,.22); border-color: #67e8f9; color: #cffafe; }
/* Dark-mode rules for the removed signing-workflow + expiry-conditions
 * blocks are dropped along with the markup they targeted. */
[data-bs-theme="dark"] .agw-select { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2367e8f9' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>"); }
[data-bs-theme="dark"] .agw-editor-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-toolbar { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-toolbar-sel, [data-bs-theme="dark"] .agw-toolbar-btn { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .agw-toolbar-btn:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-toolbar-btn.is-on { background: rgba(8,145,178,.30); border-color: rgba(103,232,249,.55); color: #cffafe; }
[data-bs-theme="dark"] .agw-toolbar-sep { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .agw-editor { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .agw-editor h1, [data-bs-theme="dark"] .agw-editor h2, [data-bs-theme="dark"] .agw-editor h3 { color: #cffafe; }
[data-bs-theme="dark"] .agw-editor-foot { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-editor-foot-hint { color: #67e8f9; }
[data-bs-theme="dark"] .agw-editor-foot-tag { background: rgba(8,145,178,.18); color: #cffafe; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .agw-foot { background: #0f172a; border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-btn-back, [data-bs-theme="dark"] .agw-btn-cancel { background: rgba(255,255,255,.04); color: #cbd5e1; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-btn-back:hover, [data-bs-theme="dark"] .agw-btn-cancel:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-clause-panel { background: #0f172a; border-left-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .agw-clause-controls,
[data-bs-theme="dark"] .agw-clause-panel-foot { background: rgba(8,145,178,.08); border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .agw-clause-select { background: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .agw-clause-ctl-label { color: #67e8f9; }
[data-bs-theme="dark"] .agw-clause-empty { color: #94a3b8; }
[data-bs-theme="dark"] .agw-clause-selcount { color: #94a3b8; }
[data-bs-theme="dark"] .agw-clause-item { background: rgba(8,145,178,.08); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-clause-item:hover,
[data-bs-theme="dark"] .agw-clause-item.is-on { background: rgba(8,145,178,.18); border-color: #67e8f9; }
[data-bs-theme="dark"] .agw-clause-item-title { color: #cffafe; }
[data-bs-theme="dark"] .agw-clause-item-sub { color: #67e8f9; }
[data-bs-theme="dark"] .agw-ph-shell { background: #0f172a; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .agw-ph-hint { background: rgba(8,145,178,.10); color: #67e8f9; border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-sidebar { background: linear-gradient(180deg, rgba(8,145,178,.10) 0%, #0b1726 100%); border-right-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-tab { color: #cbd5e1; }
[data-bs-theme="dark"] .agw-ph-tab:hover { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .agw-ph-card { background: #1e293b; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-card:hover { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .agw-ph-card.is-checked { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .agw-ph-card-label { color: #cffafe; }
[data-bs-theme="dark"] .agw-ph-card-copy { color: #94a3b8; }
[data-bs-theme="dark"] .agw-ph-card-copy:hover { background: rgba(8,145,178,.20); border-color: rgba(103,232,249,.30); color: #67e8f9; }
[data-bs-theme="dark"] .agw-ph-selbar { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .agw-ph-selall { color: #cffafe; }
[data-bs-theme="dark"] .agw-ph-selcount { color: #94a3b8; }
[data-bs-theme="dark"] .agw-ph-selbtn { background: #1e293b; border-color: rgba(6,182,212,.30); color: #67e8f9; }
[data-bs-theme="dark"] .agw-ph-selbtn:hover:not(:disabled) { background: rgba(8,145,178,.20); border-color: #67e8f9; }
[data-bs-theme="dark"] .agw-ph-selbtn-copy { background: #0891b2; border-color: #0891b2; color: #fff; }
[data-bs-theme="dark"] .agw-ph-selbtn-copy:hover:not(:disabled) { background: #0e7490; border-color: #0e7490; }
[data-bs-theme="dark"] .agw-ph-fields-sub { color: #94a3b8; }

/* MasterMultiSelect chips — the segment picker inline-styles each chip
   with a pale indigo (#eef2ff bg + #4338ca text), which renders as a
   stark white sticker on this modal's dark navy body. Override the
   inline values with !important so the chips read as tinted-glass tokens
   in dark mode. The remove × button (role="button") inherits the chip
   text colour. masterFormKit.tsx ships the same overrides but only when
   MasterFormStyles is mounted — this modal doesn't pull that in, so the
   rules have to live here too. */
[data-bs-theme="dark"] .master-select-toggle > span > span.d-inline-flex {
  background: rgba(8,145,178,.18) !important;
  color: #cffafe !important;
  border: 1px solid rgba(103,232,249,.35) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
}
[data-bs-theme="dark"] .master-select-toggle > span > span.d-inline-flex > span[role="button"] {
  color: #ecfeff !important;
  opacity: .85;
}
[data-bs-theme="dark"] .master-select-toggle > span > span.d-inline-flex > span[role="button"]:hover {
  color: #fff !important;
  opacity: 1;
}
[data-bs-theme="dark"] .master-multi-more {
  background: rgba(8,145,178,.22) !important;
  color: #cffafe !important;
  border-color: rgba(103,232,249,.45) !important;
}
[data-bs-theme="dark"] .master-multi-more:hover {
  background: rgba(8,145,178,.32) !important;
  color: #fff !important;
}
[data-bs-theme="dark"] .master-select-toggle > span.d-inline-flex.flex-wrap {
  scrollbar-color: rgba(103,232,249,.45) transparent;
}
[data-bs-theme="dark"] .master-select-toggle > span.d-inline-flex.flex-wrap::-webkit-scrollbar-thumb {
  background: rgba(103,232,249,.45);
}

/* Responsive */
@media (max-width: 900px) {
  .agw-overlay { padding: 16px; }
  .agw-shell { max-height: calc(100vh - 32px); }
  .agw-head { flex-direction: column; align-items: stretch; }
  .agw-head-right { align-self: flex-start; }
  .agw-stepper-row { width: 100%; }
  .agw-step-line { display: none; }
  .agw-grid-2 { grid-template-columns: minmax(0,1fr); }
  .agw-reg-grid { grid-template-columns: 1fr; }
  .agw-party-row { grid-template-columns: 1fr; }
  .agw-ph-body { grid-template-columns: 1fr; }
  .agw-ph-sidebar { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; border-right: 0; border-bottom: 1px solid rgba(6,182,212,.18); }
  .agw-ph-tab { flex-shrink: 0; }
}
@media (max-width: 640px) {
  .agw-overlay { padding: 8px; }
  .agw-step { padding: 8px 10px; gap: 8px; }
  .agw-step-num { width: 30px; height: 30px; font-size: 12px; }
  .agw-step-label { font-size: 12px; }
  .agw-step-sub { font-size: 10.5px; }
  .agw-body, .agw-foot, .agw-stepper, .agw-head { padding: 14px 16px; }
  .agw-foot { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .agw-foot-left, .agw-foot-right { width: 100%; justify-content: stretch; }
  .agw-btn { flex: 1; justify-content: center; }
}
`;
