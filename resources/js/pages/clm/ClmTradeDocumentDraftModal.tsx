import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { SimpleNameModal } from './clmCommon';
import ClmInsertPlaceholderModal from './ClmInsertPlaceholderModal';
import ClmInsertTableModal from './ClmInsertTableModal';
import ClmInsertHrModal from './ClmInsertHrModal';
import ClmClauseInsertPanel from './ClmClauseInsertPanel';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';

/* ───────────────────────────────────────────────────────────────────────
 * Central CLM → Trade Documents Master → Draft New Trade Document (modal)
 *
 * Full-screen 2-step wizard rendered as a popup over the Library list.
 * Same backend contract as the old LibraryModal — POST/PUT /clm/trade-doc-library
 * with name/title/doc_type/purpose/party/file_path. Applicable-party
 * checkbox grid serialises into the existing `party` CSV.
 *
 * Step 1 — Document Basic Details (type, title, purpose, applicable party)
 * Step 2 — Draft Document Content (rich text + placeholder + clause library)
 *
 * The rich-text editor (step 2) is visual scaffolding — actual content
 * persistence will land with a future backend column.
 * ─────────────────────────────────────────────────────────────────────── */

export type TdName = { id: number; code: string; name: string };

export type TdLib = {
  id: number;
  code: string;
  name: string;
  title: string;
  doc_type: string;
  purpose: string;
  party: string;
  file_path: string | null;
  content: string | null;
  /* Stage 2 page-shell config — mirror of hr_document_templates. Nullable
   * on existing rows that pre-date the columns; the frontend layers each
   * over DEFAULT_HEADER / DEFAULT_FOOTER so missing keys stay safe. */
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};

const DOC_TYPES = ['Declaration', 'Undertaking', 'Authorization', 'Bond', 'Certificate', 'Letter'] as const;

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
  { key: 1, label: 'Document Basic Details', sub: 'Form fields & party selection' },
  { key: 2, label: 'Draft Document Content', sub: 'Rich text editor & placeholders' },
];

// Length bounds for the Trade Document Title. Min keeps users from saving a
// 1-2 char placeholder title; max stops a runaway string overflowing the field
// (and the downstream library list / DOCX header).
const TITLE_MIN = 3;
const TITLE_MAX = 150;

// Length bounds for the Purpose field — same rationale as the title: a minimum
// to force a meaningful description, a maximum to keep the single-line input
// (and its stored value) bounded.
const PURPOSE_MIN = 3;
const PURPOSE_MAX = 250;

interface Props {
  open: boolean;
  existing: TdLib | null;
  names: TdName[];
  nextCode: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ClmTradeDocumentDraftModal({ open, existing, names: initialNames, nextCode, onClose, onSaved }: Props) {
  const toast = useToast();
  const editingId = existing?.id ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Names list — receive from parent and update locally if quick-add fires
  const [names, setNames] = useState<TdName[]>(initialNames);

  // Step 1 fields
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<string>(DOC_TYPES[0]);
  const [purpose, setPurpose] = useState('');
  const [parties, setParties] = useState<Set<string>>(new Set());

  // Step 2 fields
  const [content, setContent] = useState('');
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSizeState] = useState('14');
  const [block, setBlockState]       = useState('p');
  const [pickerOpen, setPickerOpen]  = useState(false);
  /* Insert Table dialog — caret position is stashed via stashSelection()
   * before opening so the generated HTML lands where the user was typing,
   * not at the start of the editor. */
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  /* Insert Horizontal Line dialog — same caret-stash pattern as the table
   * picker. Replaces document.execCommand('insertHorizontalRule') (which
   * inserts an unstyled <hr> the dompdf renderer drops to a 1px grey
   * line) with a styled <hr> the user picks colour + height + style for. */
  const [hrPickerOpen, setHrPickerOpen] = useState(false);
  // Clause Library picker — drops reusable clauses (GET /clm/clause-library) at the caret.
  const [clausePickerOpen, setClausePickerOpen] = useState(false);
  const lastRangeRef                 = useRef<Range | null>(null);

  const [quickAddOpen, setQuickAddOpen] = useState(false);

  /* Stage 2 page-shell — same UX as HR Document Templates. Defaults pre-fill
   * the header with the user's branch (or client) logo + name so a fresh
   * draft already looks branded; the user can edit / replace either side
   * via the header popover. Saved values come back as `header_config` /
   * `footer_config` on the row and layer over the defaults so a row that
   * pre-dates these columns keeps rendering identically. */
  const { user } = useAuth();
  const brandedDefaults = useMemo(() => {
    const headerLogoUrl = user?.branch_logo ?? user?.client_logo ?? null;
    // The PDF renderer reads `logo_path` (storage-relative) to base64-
    // encode the image at render time. /me only ships the public URL,
    // so derive the path by stripping the public-disk prefix. Same
    // pattern works for both `/storage/...` and `http(s)://.../storage/...`
    // forms — anything after the first `/storage/` segment is the
    // storage-relative path on the public disk.
    const headerLogoPath = headerLogoUrl
      ? (headerLogoUrl.match(/\/storage\/(.+)$/)?.[1] ?? null)
      : null;
    const headerTitle     = user?.branch_name ?? user?.client_name ?? DEFAULT_HEADER.title;
    const footerLine      = user?.client_name
      ? `${user.client_name}${user?.branch_name && user.branch_name !== user.client_name ? ' · ' + user.branch_name : ''}  |  Confidential`
      : DEFAULT_FOOTER.text;
    return {
      header: { ...DEFAULT_HEADER, logo_path: headerLogoPath, logo_url: headerLogoUrl, title: headerTitle },
      footer: { ...DEFAULT_FOOTER, text: footerLine },
    };
  }, [user?.branch_logo, user?.client_logo, user?.branch_name, user?.client_name]);
  const [headerConfig, setHeaderConfig] = useState<HeaderConfig>(brandedDefaults.header);
  const [footerConfig, setFooterConfig] = useState<FooterConfig>(brandedDefaults.footer);

  /* Rich-text helpers (step 2). execCommand is deprecated but still the
   * simplest path for contentEditable without pulling in an editor framework.
   * preventDefault on mouseDown keeps the editor's selection intact when a
   * toolbar button is clicked. */
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
    // execCommand fontSize accepts 1-7; we tag with size="7" then rewrite
    // the resulting <font> elements into <span style="font-size:Npx">.
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
   * is closer to user intent than the top-default `editor.focus()`
   * would otherwise produce. */
  const restoreCaretForInsert = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const stash = lastRangeRef.current;
    const sel = window.getSelection();
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
   * Insert Table + Insert HR modals — the rich-HTML insertion path
   * execCommand's `insertHTML` is more reliable than splicing nodes
   * by hand, and it cleanly handles the case where the user's
   * selection spans multiple existing nodes (insertHTML replaces
   * the selection). */
  const insertHtmlAtCaret = (html: string) => {
    restoreCaretForInsert();
    document.execCommand('insertHTML', false, html);
    rememberCaretAfterInsert();
    syncContent();
  };

  /* DOCX round-trip — mirrors the HRMS template flow. Download streams
   * the saved Word file (or one generated from `content` HTML on the
   * fly); upload replaces the editor body with the parsed DOCX. Both
   * require the row to have been saved at least once so we have an id. */
  const docxRef = useRef<HTMLInputElement | null>(null);
  const downloadDocx = async () => {
    if (!editingId) {
      toast.error('Save first', 'Save the trade document before downloading as DOCX.');
      return;
    }
    try {
      const resp = await api.get(`/clm/trade-doc-library/${editingId}/download`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([resp.data]));
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${existing?.code || 'trade-document'}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // The response is a Blob (responseType: 'blob'), so a server error body
      // arrives as a Blob too — read it back to surface the real message
      // instead of a generic "Please try again".
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
      toast.error('Save first', 'Save the trade document before uploading a revised DOCX.');
      return;
    }
    const fd = new FormData();
    fd.append('docx', file);
    try {
      const { data } = await api.post(`/clm/trade-doc-library/${editingId}/upload-docx`, fd, {
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

  // Bootstrap form state from the row being edited (or reset for add)
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErrors({});
    setSaving(false);
    if (existing) {
      setName(existing.name ?? '');
      setTitle(existing.title ?? '');
      setDocType(existing.doc_type ?? DOC_TYPES[0]);
      setPurpose(existing.purpose ?? '');
      setParties(new Set((existing.party ?? '').split(',').map(s => s.trim()).filter(Boolean)));
      setContent(existing.content ?? '');
      if (editorRef.current) editorRef.current.innerHTML = existing.content ?? '';
      // Layer the saved zone config over the branded defaults. Rows that
      // pre-date these columns hit the spread with null and keep the
      // logged-in user's branch branding as their starting point.
      setHeaderConfig({ ...brandedDefaults.header, ...(existing.header_config || {}) } as HeaderConfig);
      setFooterConfig({ ...brandedDefaults.footer, ...(existing.footer_config || {}) } as FooterConfig);
    } else {
      setName('');
      setTitle('');
      setDocType(DOC_TYPES[0]);
      setPurpose('');
      setParties(new Set());
      setContent('');
      if (editorRef.current) editorRef.current.innerHTML = '';
      setHeaderConfig(brandedDefaults.header);
      setFooterConfig(brandedDefaults.footer);
    }
  }, [open, existing]);

  // Keep our names list in sync with the parent — picks up new entries
  // added via the standalone "Trade Documents List" tab while the modal
  // is open in the background.
  useEffect(() => { setNames(initialNames); }, [initialNames]);

  /* Editor element only mounts when step === 2. When the user crosses
   * the step boundary, push the persisted content into the freshly-
   * mounted contentEditable div so edit mode shows the saved body. */
  useEffect(() => {
    if (step === 2 && editorRef.current) {
      editorRef.current.innerHTML = content ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /* Track the last caret position inside the body editor on every
   * selectionchange. Without this, clicking a toolbar button that opens
   * a modal (Placeholder / Table / HR) wouldn't capture the caret
   * reliably — modal focus would clobber the in-editor selection
   * before insertHtmlAtCaret could read it. The listener only updates
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  const headerCode = useMemo(() => {
    if (editingId && existing?.code) return existing.code;
    return nextCode;
  }, [editingId, existing, nextCode]);

  const toggleParty = (v: string) => {
    setParties(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    setErrors(p => ({ ...p, party: '' }));
  };

  const validateStep1 = () => {
    const next: Record<string, string> = {};
    if (!name.trim())    next.name    = 'Document type is required';
    if (!title.trim())   next.title   = 'Title is required';
    else if (title.trim().length < TITLE_MIN) next.title = `Title must be at least ${TITLE_MIN} characters`;
    else if (title.trim().length > TITLE_MAX) next.title = `Title must not exceed ${TITLE_MAX} characters`;
    if (!purpose.trim()) next.purpose = 'Purpose is required';
    else if (purpose.trim().length < PURPOSE_MIN) next.purpose = `Purpose must be at least ${PURPOSE_MIN} characters`;
    else if (purpose.trim().length > PURPOSE_MAX) next.purpose = `Purpose must not exceed ${PURPOSE_MAX} characters`;
    if (parties.size === 0) next.party = 'Select at least one applicable party';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (validateStep1()) setStep(2);
  };
  const goBack = () => setStep(1);

  const handleSave = async () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    setSaving(true);
    const payload: Omit<TdLib, 'id' | 'code'> = {
      name: name.trim(),
      title: title.trim(),
      doc_type: docType.trim(),
      purpose: purpose.trim(),
      party: Array.from(parties).join(','),
      file_path: null,
      content: editorRef.current?.innerHTML ?? content ?? null,
      header_config: headerConfig,
      footer_config: footerConfig,
    };
    try {
      if (editingId) {
        await api.put(`/clm/trade-doc-library/${editingId}`, payload);
        toast.success('Updated', payload.title);
      } else {
        await api.post('/clm/trade-doc-library', payload);
        toast.success('Added', payload.title);
      }
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onAddNewName = async (newName: string) => {
    try {
      const r = await api.post<{ status: boolean; data: TdName }>(
        '/clm/trade-doc-names',
        { name: newName },
      );
      const created = r.data.data;
      setNames(prev => [...prev, created]);
      setName(created.name);
      setQuickAddOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="tdw-overlay"
      role="dialog"
      aria-modal="true"
    >
      <style>{TDW_CSS}</style>
      <div className="tdw-shell">
        {/* ── Header strip ── */}
        <div className="tdw-head">
          <div className="tdw-head-left">
            <div className="tdw-head-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="tdw-head-text">
              <div className="tdw-head-title">{editingId ? 'Edit Trade Document' : 'Draft New Trade Document'}</div>
              <div className="tdw-head-sub">Create a reusable trade document draft for CLM workflows</div>
            </div>
          </div>
          <div className="tdw-head-right">
            <div className="tdw-id-chip">
              <div className="tdw-id-chip-label">TRADE DOCUMENT ID</div>
              <div className="tdw-id-chip-val">{headerCode}</div>
            </div>
            <button type="button" className="tdw-close" onClick={onClose} aria-label="Close" disabled={saving}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Stepper ── */}
        <div className="tdw-stepper">
          <div className="tdw-stepper-row">
            {STEPS.map((s, idx) => {
              const active   = s.key === step;
              const complete = s.key < step;
              return (
                <div key={s.key} className={`tdw-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}>
                  <div className="tdw-step-num">
                    {complete
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      : <span>{s.key}</span>}
                  </div>
                  <div className="tdw-step-text">
                    <div className="tdw-step-label">{s.label}</div>
                    <div className="tdw-step-sub">{s.sub}</div>
                  </div>
                  {idx < STEPS.length - 1 && <div className={`tdw-step-line ${complete ? 'is-complete' : ''}`} />}
                </div>
              );
            })}
          </div>
          <div className="tdw-stepper-progress">
            <div className="tdw-stepper-bars">
              <span className={`tdw-stepper-bar ${step >= 1 ? 'on' : ''}`} />
              <span className={`tdw-stepper-bar ${step >= 2 ? 'on' : ''}`} />
            </div>
            <div className="tdw-stepper-label">Step {step} of {STEPS.length}</div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={`tdw-body ${step === 2 ? 'tdw-body-editor' : ''}`}>
          {step === 1 ? (
            <div className="tdw-step-body">
              <div className="tdw-grid-2">
                <div className="tdw-field">
                  <label className="tdw-label">Trade Document Type <span className="tdw-req">*</span></label>
                  <div className="tdw-inline-add">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MasterSelect
                        key={`tdw-name-${names.length}`}
                        value={name}
                        invalid={!!errors.name}
                        placeholder="— Select Document —"
                        options={[
                          ...names.map(n => ({ value: n.name, label: n.name })),
                          ...(name && !names.find(n => n.name === name) ? [{ value: name, label: name }] : []),
                        ]}
                        onChange={(v) => { setName(v); setErrors(p => ({ ...p, name: '' })); }}
                      />
                    </div>
                    <button
                      type="button"
                      className="tdw-add-mini"
                      title="Add new Trade Document Name"
                      onClick={() => setQuickAddOpen(true)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                  </div>
                  <div className="tdw-hint">Sourced from Trade Documents List — click + to add</div>
                  {errors.name && <div className="tdw-err">{errors.name}</div>}
                </div>

                <div className="tdw-field">
                  <label className="tdw-label">
                    Trade Document Title <span className="tdw-req">*</span>
                    <span className="tdw-count" style={{ color: title.length >= TITLE_MAX ? '#b45309' : undefined }}>{title.length}/{TITLE_MAX}</span>
                  </label>
                  <input
                    type="text"
                    className={`tdw-input ${errors.title ? 'is-err' : ''}`}
                    placeholder="e.g. Supplier Self Declaration Form"
                    value={title}
                    maxLength={TITLE_MAX}
                    minLength={TITLE_MIN}
                    onChange={e => { setTitle(e.target.value.slice(0, TITLE_MAX)); setErrors(p => ({ ...p, title: '' })); }}
                  />
                  {errors.title && <div className="tdw-err">{errors.title}</div>}
                </div>
              </div>

              <div className="tdw-field">
                <label className="tdw-label">
                  Purpose <span className="tdw-req">*</span>
                  <span className="tdw-count" style={{ color: purpose.length >= PURPOSE_MAX ? '#b45309' : undefined }}>{purpose.length}/{PURPOSE_MAX}</span>
                </label>
                <input
                  type="text"
                  className={`tdw-input ${errors.purpose ? 'is-err' : ''}`}
                  placeholder="e.g. Vendor onboarding compliance verification"
                  value={purpose}
                  maxLength={PURPOSE_MAX}
                  minLength={PURPOSE_MIN}
                  onChange={e => { setPurpose(e.target.value.slice(0, PURPOSE_MAX)); setErrors(p => ({ ...p, purpose: '' })); }}
                />
                {errors.purpose && <div className="tdw-err">{errors.purpose}</div>}
              </div>

              <div className="tdw-party">
                <div className="tdw-party-head">
                  <span className="tdw-party-ico">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  </span>
                  Applicable Party <span className="tdw-req">*</span>
                </div>
                <div className="tdw-party-row">
                  <div className="tdw-party-label">BUYER & CONSIGNEE</div>
                  <div className="tdw-party-options">
                    {PARTY_BUYER_CONSIGNEE.map(p => (
                      <label key={p.value} className={`tdw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="tdw-checkbox-emoji">{p.icon}</span>
                        <span className="tdw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="tdw-party-row">
                  <div className="tdw-party-label">SUPPLIER</div>
                  <div className="tdw-party-options">
                    {PARTY_SUPPLIER.map(p => (
                      <label key={p.value} className={`tdw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="tdw-checkbox-emoji">{p.icon}</span>
                        <span className="tdw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="tdw-party-hint">Select all parties this document applies to.</div>
                {errors.party && <div className="tdw-err">{errors.party}</div>}
              </div>
            </div>
          ) : (
            <div className="tdw-step-body">
              <div className="tdw-editor-shell">
                <div className="tdw-editor-head">
                  <div className="tdw-editor-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    DRAFT DOCUMENT CONTENT
                  </div>
                  <div className="tdw-editor-actions">
                    <input ref={docxRef} type="file" accept=".doc,.docx" style={{ display: 'none' }}
                           onChange={e => { const f = e.target.files?.[0]; if (f) void uploadDocx(f); e.currentTarget.value = ''; }} />
                    <button type="button" className="tdw-editor-btn" onClick={() => void downloadDocx()} title={editingId ? 'Download as DOCX' : 'Save the trade document first'}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      Download DOCX
                    </button>
                    <button type="button" className="tdw-editor-btn" onClick={() => docxRef.current?.click()} title={editingId ? 'Upload a revised Word file' : 'Save the trade document first'}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      Upload Word Doc
                    </button>
                    <button type="button" className="tdw-editor-btn" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={() => setPickerOpen(true)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                      {'{}'} Placeholder
                    </button>
                    <button
                      type="button" className="tdw-editor-btn"
                      onMouseDown={e => { e.preventDefault(); stashSelection(); }}
                      onClick={() => setTablePickerOpen(true)}
                      title="Insert table"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                      Insert Table
                    </button>
                    <button type="button" className="tdw-editor-btn" onMouseDown={e => { e.preventDefault(); stashSelection(); }} onClick={() => setClausePickerOpen(true)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                      Clause Library
                    </button>
                  </div>
                </div>
                <div className="tdw-toolbar" onMouseDown={e => e.preventDefault()}>
                  <select className="tdw-toolbar-sel" value={fontSize} onChange={e => { setFontSizeState(e.target.value); applyFontSize(e.target.value); }} title="Font size">
                    <option value="11">11</option><option value="12">12</option><option value="13">13</option>
                    <option value="14">14</option><option value="16">16</option><option value="18">18</option>
                    <option value="20">20</option><option value="24">24</option><option value="28">28</option>
                  </select>
                  <select className="tdw-toolbar-sel" value={block} onChange={e => { setBlockState(e.target.value); applyBlock(e.target.value); }} title="Block format">
                    <option value="p">Paragraph</option>
                    <option value="h1">Heading 1</option>
                    <option value="h2">Heading 2</option>
                    <option value="h3">Heading 3</option>
                    <option value="blockquote">Quote</option>
                    <option value="pre">Code</option>
                  </select>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('bold')}        title="Bold (Ctrl+B)"><b>B</b></button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('italic')}      title="Italic (Ctrl+I)"><i>I</i></button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('underline')}   title="Underline (Ctrl+U)"><u>U</u></button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('superscript')} title="Superscript">X²</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('subscript')}   title="Subscript">X₂</button>
                  <label className="tdw-toolbar-btn tdw-toolbar-color" title="Text color" style={{ position: 'relative' }}>
                    T
                    <input type="color" defaultValue="#0c4a6e" onChange={e => exec('foreColor', e.target.value)}
                           style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                  </label>
                  {/* Highlight — system color picker (click the icon) + a
                     quick-pick palette of 5 common highlights immediately
                     to the right so the user doesn't have to dive into the
                     OS picker for the everyday yellow / mint / pink etc. */}
                  <label className="tdw-toolbar-btn tdw-toolbar-color" title="Custom highlight color" style={{ position: 'relative', color: '#f59e0b' }}>
                    ✎
                    <input type="color" defaultValue="#fde68a" onChange={e => exec('hiliteColor', e.target.value)}
                           style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                  </label>
                  {['#fde68a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e9d5ff'].map(c => (
                    <button
                      key={c}
                      type="button"
                      className="tdw-toolbar-btn"
                      title={`Highlight ${c}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => exec('hiliteColor', c)}
                      style={{ background: c, width: 22, padding: 0, border: '1px solid #cbd5e1' }}
                    >&nbsp;</button>
                  ))}
                  <span className="tdw-toolbar-sep" />
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('justifyLeft')}    title="Align left">≡</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('justifyCenter')}  title="Align center">≡</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('justifyRight')}   title="Align right">≡</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('justifyFull')}    title="Justify">≡</button>
                  <span className="tdw-toolbar-sep" />
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('insertUnorderedList')} title="Bullet list">•≡</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('insertOrderedList')}   title="Numbered list">1≡</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('outdent')} title="Outdent">⇤</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('indent')}  title="Indent">⇥</button>
                  <span className="tdw-toolbar-sep" />
                  <button
                    type="button" className="tdw-toolbar-btn"
                    title="Insert horizontal line"
                    onMouseDown={e => { e.preventDefault(); stashSelection(); }}
                    onClick={() => setHrPickerOpen(true)}
                  >—</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('undo')} title="Undo">↶</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('redo')} title="Redo">↷</button>
                  <button type="button" className="tdw-toolbar-btn" onClick={() => exec('removeFormat')} title="Clear formatting">🅣</button>
                </div>
                {/* Scrollable region — the editor head + toolbar above stay
                   pinned; only this page-shell preview scrolls when the
                   content grows. */}
                <div className="tdw-editor-scroll">
                  {/* Page-shell preview wraps the editor in a fixed header
                     (logo + title + subtitle) and footer (text + page #).
                     Same component the HR Document Templates Step 3 uses,
                     so the look-and-feel stays uniform across modules.
                     Logo upload posts to the trade-doc tenant folder. */}
                  <HeaderFooterPanel
                    header={headerConfig} setHeader={setHeaderConfig}
                    footer={footerConfig} setFooter={setFooterConfig}
                    uploadLogoEndpoint="/clm/trade-doc-library/upload-header-logo"
                  >
                    <div
                      ref={editorRef}
                      className="tdw-editor"
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(e) => setContent((e.target as HTMLElement).innerHTML)}
                      role="textbox"
                      aria-multiline="true"
                      aria-label="Document content"
                    />
                  </HeaderFooterPanel>
                </div>
                <div className="tdw-editor-foot">
                  <span className="tdw-editor-foot-hint">ℹ Placeholders auto-fill on document generation</span>
                  <span className="tdw-editor-foot-tag">{'{{PLACEHOLDER}}'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="tdw-foot">
          <div className="tdw-foot-left">
            {step === 2 && (
              <button type="button" className="tdw-btn tdw-btn-back" onClick={goBack} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to Basic Details
              </button>
            )}
          </div>
          <div className="tdw-foot-right">
            <button type="button" className="tdw-btn tdw-btn-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            {step === 1 ? (
              <button type="button" className="tdw-btn tdw-btn-primary" onClick={goNext} disabled={saving}>
                Save &amp; Next
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ) : (
              <button type="button" className="tdw-btn tdw-btn-primary" onClick={() => void handleSave()} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Saving…' : 'Save Trade Document'}
              </button>
            )}
          </div>
        </div>

        {/* Quick-add Trade Doc Name inside the wizard */}
        {quickAddOpen && (
          <SimpleNameModal
            title="Add Trade Document Name"
            placeholder="e.g. Bill of Lading, Commercial Invoice"
            code={`TDN-${String(names.length + 1).padStart(3, '0')}`}
            isEdit={false}
            initial=""
            onClose={() => setQuickAddOpen(false)}
            onSave={(newName) => void onAddNewName(newName)}
          />
        )}

        <ClmInsertPlaceholderModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onInsert={(token) => { insertAtCaret(token); setPickerOpen(false); }}
        />

        <ClmInsertTableModal
          open={tablePickerOpen}
          onClose={() => setTablePickerOpen(false)}
          onInsert={(html) => { insertHtmlAtCaret(html); setTablePickerOpen(false); }}
        />

        <ClmInsertHrModal
          open={hrPickerOpen}
          onClose={() => setHrPickerOpen(false)}
          onInsert={(html) => { insertHtmlAtCaret(html); setHrPickerOpen(false); }}
        />

        {clausePickerOpen && (
          <ClmClauseInsertPanel
            onClose={() => setClausePickerOpen(false)}
            onInsert={(html) => { insertHtmlAtCaret(html); setClausePickerOpen(false); }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* Scoped CSS — modal overlay + portalled shell. Sits at z-index above
 * everything except other CLM portalled menus (MasterSelect = 250000). */
const TDW_CSS = `
.tdw-overlay {
  position: fixed; inset: 0; z-index: 200000;
  background: rgba(7,30,50,.65);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  overflow-y: auto;
  animation: tdwFade .18s ease both;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
@keyframes tdwFade { from { opacity: 0; } to { opacity: 1; } }
.tdw-shell {
  width: 100%; max-width: 1100px; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff;
  margin: auto;
  box-shadow:
    0 28px 70px rgba(15,23,42,.45),
    0 12px 32px rgba(6,182,212,.22),
    0 0 0 1px rgba(255,255,255,.06);
  border: 1px solid rgba(6,182,212,.20);
  animation: tdwSlideUp .24s cubic-bezier(.22,1,.36,1) both;
}
@keyframes tdwSlideUp { from { opacity: 0; transform: translateY(20px) scale(.97) } to { opacity: 1; transform: none } }

/* ── Header strip ── */
.tdw-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 11px 22px;
  background: linear-gradient(110deg, #0c6680 0%, #0e7490 35%, #0891b2 75%, #06b6d4 100%);
  color: #fff;
  position: relative; overflow: hidden;
  flex-shrink: 0;
}
.tdw-head::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.10), transparent);
  pointer-events: none;
}
.tdw-head > * { position: relative; z-index: 1; }
.tdw-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.tdw-head-ico {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.tdw-head-text { min-width: 0; }
.tdw-head-title { font-size: 16px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; }
.tdw-head-sub { font-size: 11.5px; color: rgba(255,255,255,.86); margin-top: 2px; }
.tdw-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tdw-id-chip {
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.24);
  border-radius: 9px;
  padding: 5px 14px;
  text-align: right;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.tdw-id-chip-label { font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.74); text-transform: uppercase; }
.tdw-id-chip-val { font-size: 15px; font-weight: 800; color: #fff; margin-top: 1px;
  font-family: 'Geist Mono', ui-monospace, monospace; }
.tdw-close {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.22);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.tdw-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }
.tdw-close:disabled { opacity: .5; cursor: not-allowed; }

/* ── Stepper ── */
.tdw-stepper {
  display: flex; align-items: center; justify-content: space-between;
  background: #f8feff;
  border-bottom: 1px solid rgba(6,182,212,.18);
  padding: 8px 22px;
  gap: 22px; flex-wrap: wrap;
  flex-shrink: 0;
}
.tdw-stepper-row { display: inline-flex; align-items: center; gap: 0; flex: 1; min-width: 0; flex-wrap: wrap; }
.tdw-step {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 6px 12px; border-radius: 11px;
  position: relative;
  transition: background .18s ease, box-shadow .22s ease;
}
.tdw-step.is-active {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  box-shadow: 0 4px 14px rgba(8,145,178,.40);
}
.tdw-step.is-active .tdw-step-label,
.tdw-step.is-active .tdw-step-sub { color: #fff; }
.tdw-step.is-active .tdw-step-num { background: rgba(255,255,255,.20); border-color: rgba(255,255,255,.45); color: #fff; }
.tdw-step.is-complete .tdw-step-num { background: #22c55e; border-color: #16a34a; color: #fff; }
.tdw-step-num {
  width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
  border: 1.5px solid rgba(6,182,212,.32);
  background: #f0fdff;
  color: #0e7490;
  font-size: 13px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.tdw-step-text { min-width: 0; }
.tdw-step-label { font-size: 13px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; line-height: 1.2; }
.tdw-step-sub { font-size: 11px; color: #0e7490; opacity: .8; margin-top: 2px; }
.tdw-step-line {
  width: 70px; height: 2px; flex-shrink: 0;
  background: #e2e8f0; margin: 0 6px;
  border-radius: 1px;
  transition: background .22s ease;
}
.tdw-step-line.is-complete { background: linear-gradient(90deg, #22c55e, #16a34a); }
.tdw-stepper-progress { display: inline-flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: flex-end; }
.tdw-stepper-bars { display: inline-flex; gap: 4px; }
.tdw-stepper-bar { width: 50px; height: 4px; border-radius: 999px; background: #e2e8f0; transition: background .22s ease; }
.tdw-stepper-bar.on { background: linear-gradient(90deg, #22c55e, #06b6d4); }
.tdw-stepper-label {
  font-size: 10.5px; font-weight: 700; color: #0e7490;
  background: #f0fdff; border: 1px solid rgba(6,182,212,.22);
  padding: 4px 10px; border-radius: 999px;
}

/* ── Body ── */
.tdw-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%);
  padding: 22px;
}
.tdw-step-body { display: flex; flex-direction: column; gap: 18px; }
/* Step 2 (editor) — the body itself does NOT scroll; the editor card fills
 * the available height and only its page-shell region scrolls internally. */
.tdw-body-editor { overflow: hidden; display: flex; flex-direction: column; }
.tdw-body-editor .tdw-step-body { flex: 1; min-height: 0; }
.tdw-body-editor .tdw-editor-shell { flex: 1; min-height: 0; }
.tdw-grid-2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 18px; }
.tdw-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tdw-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #0e7490;
}
.tdw-req { color: #ef4444; font-size: 12px; line-height: 1; }
.tdw-count { float: right; font-weight: 700; letter-spacing: 0; text-transform: none; color: #94a3b8; }
.tdw-input {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  padding: 10px 13px;
  font-family: inherit; font-size: 13px; color: #0c4a6e;
  background: #fff; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tdw-input:hover { border-color: rgba(6,182,212,.40); }
.tdw-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
.tdw-input.is-err { border-color: #ef4444; }
.tdw-input::placeholder { color: #94a3b8; }
.tdw-hint { font-size: 11px; color: #0891b2; opacity: .8; }
.tdw-err { font-size: 11px; color: #ef4444; font-weight: 600; }

.tdw-inline-add { display: flex; gap: 8px; align-items: stretch; }
.tdw-add-mini {
  width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
  border: none; cursor: pointer;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(8,145,178,.35);
  transition: transform .15s ease, box-shadow .22s ease;
}
.tdw-add-mini:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(8,145,178,.50); }

/* ── Applicable Party card ── */
.tdw-party {
  border: 1.5px solid rgba(6,182,212,.20);
  border-radius: 14px;
  padding: 18px 20px;
  background: linear-gradient(180deg, #ffffff 0%, #f7feff 100%);
  display: flex; flex-direction: column; gap: 14px;
}
.tdw-party-head {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #0891b2;
}
.tdw-party-ico {
  width: 22px; height: 22px; border-radius: 7px;
  background: rgba(8,145,178,.10);
  display: inline-flex; align-items: center; justify-content: center;
  color: #0891b2;
}
.tdw-party-row {
  display: grid;
  grid-template-columns: 170px 1fr;
  align-items: center;
  gap: 14px;
}
.tdw-party-label {
  font-size: 11px; font-weight: 700; letter-spacing: .04em; color: #475569;
  text-transform: uppercase;
}
.tdw-party-options { display: inline-flex; flex-wrap: wrap; gap: 10px; }
.tdw-checkbox {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 10px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  font-size: 13px; font-weight: 600; color: #334155;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .22s ease;
}
.tdw-checkbox input { width: 14px; height: 14px; accent-color: #0891b2; }
.tdw-checkbox-emoji { font-size: 15px; line-height: 1; }
.tdw-checkbox:hover { border-color: rgba(6,182,212,.45); background: #f0fdff; }
.tdw-checkbox.is-on {
  background: #f0fdff;
  border-color: #0891b2;
  color: #0e7490;
  box-shadow: 0 2px 8px rgba(8,145,178,.18);
}
.tdw-party-hint { font-size: 11.5px; color: #94a3b8; }

/* ── Editor (step 2) ── */
.tdw-editor-shell {
  border: 1px solid rgba(6,182,212,.20);
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  display: flex; flex-direction: column;
}
.tdw-editor-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap;
  background: linear-gradient(110deg, #0891b2, #0e7490);
  padding: 7px 14px;
  color: #fff;
  flex-shrink: 0;
}
/* Scrollable page-shell region between the pinned toolbar and footer. */
.tdw-editor-scroll { flex: 1; min-height: 0; overflow-y: auto; background: #fff; }
.tdw-editor-title {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
}
.tdw-editor-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.tdw-editor-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 9px; border-radius: 7px;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24);
  color: #fff;
  font-size: 11px; font-weight: 700;
  cursor: pointer;
  transition: background .15s ease;
}
.tdw-editor-btn svg { width: 12px; height: 12px; }
.tdw-editor-btn:hover { background: rgba(255,255,255,.26); }
/* Single-row toolbar — never wraps; scrolls horizontally if it overflows. */
.tdw-toolbar {
  display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; overflow-x: auto;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.tdw-toolbar::-webkit-scrollbar { height: 6px; }
.tdw-toolbar::-webkit-scrollbar-thumb { background: rgba(6,182,212,.30); border-radius: 999px; }
.tdw-toolbar-sel, .tdw-toolbar-btn {
  height: 26px; min-width: 26px; padding: 0 6px; flex-shrink: 0;
  border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #475569;
  font-size: 11px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.tdw-toolbar-sel { min-width: auto; }
.tdw-toolbar-btn:hover { background: #f0fdff; border-color: #67e8f9; color: #0891b2; }
.tdw-toolbar-sep { width: 1px; height: 18px; flex-shrink: 0; background: #cbd5e1; }
.tdw-editor {
  min-height: 240px;
  padding: 18px 22px;
  background: #fff;
  outline: none;
  font-size: 13.5px; line-height: 1.6; color: #0c4a6e;
}
.tdw-editor-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px;
  background: #f0fdff; border-top: 1px solid #e2e8f0;
  font-size: 11.5px;
  flex-shrink: 0;
}
.tdw-editor-foot-hint { color: #0e7490; opacity: .85; }
.tdw-editor-foot-tag {
  background: #fff; border: 1px solid #67e8f9;
  padding: 3px 9px; border-radius: 6px;
  color: #0891b2; font-weight: 700;
  font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px;
}

/* ── Footer ── */
.tdw-foot {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff;
  border-top: 1px solid rgba(6,182,212,.18);
  padding: 14px 22px;
  flex-shrink: 0;
}
.tdw-foot-left, .tdw-foot-right { display: inline-flex; align-items: center; gap: 10px; }
.tdw-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 22px; border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .22s ease, background .18s ease, color .18s ease, border-color .18s ease;
}
.tdw-btn-back, .tdw-btn-cancel {
  background: #fff; color: #475569;
  border: 1px solid #e2e8f0;
}
.tdw-btn-back:hover, .tdw-btn-cancel:hover { border-color: #0891b2; color: #0891b2; background: #f0fdff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.16); }
.tdw-btn-primary {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff; border: none;
  box-shadow: 0 4px 14px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18);
}
.tdw-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.22);
}
.tdw-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .tdw-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-stepper { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-step-num { background: rgba(8,145,178,.16); border-color: rgba(6,182,212,.35); color: #67e8f9; }
[data-bs-theme="dark"] .tdw-step-label { color: #cffafe; }
[data-bs-theme="dark"] .tdw-step-sub { color: #67e8f9; }
[data-bs-theme="dark"] .tdw-step.is-active .tdw-step-label,
[data-bs-theme="dark"] .tdw-step.is-active .tdw-step-sub { color: #fff; }
[data-bs-theme="dark"] .tdw-step-line { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .tdw-stepper-bar { background: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .tdw-stepper-label { background: rgba(8,145,178,.16); color: #67e8f9; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .tdw-body { background: linear-gradient(160deg, rgba(8,145,178,.06) 0%, rgba(8,145,178,.03) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .tdw-label { color: #67e8f9; }
[data-bs-theme="dark"] .tdw-input { background-color: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .tdw-input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .tdw-hint { color: #67e8f9; }
[data-bs-theme="dark"] .tdw-party { background: linear-gradient(180deg, #0f172a 0%, #102234 100%); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-party-head { color: #67e8f9; }
[data-bs-theme="dark"] .tdw-party-ico { background: rgba(8,145,178,.20); color: #67e8f9; }
[data-bs-theme="dark"] .tdw-party-label { color: #cbd5e1; }
[data-bs-theme="dark"] .tdw-checkbox { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .tdw-checkbox:hover { background: rgba(8,145,178,.10); border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .tdw-checkbox.is-on { background: rgba(8,145,178,.22); border-color: #67e8f9; color: #cffafe; }
[data-bs-theme="dark"] .tdw-party-hint { color: #94a3b8; }
[data-bs-theme="dark"] .tdw-editor-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-toolbar { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-toolbar-sel, [data-bs-theme="dark"] .tdw-toolbar-btn { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .tdw-toolbar-btn:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .tdw-toolbar-sep { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .tdw-editor { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .tdw-editor-foot { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-editor-foot-hint { color: #67e8f9; }
[data-bs-theme="dark"] .tdw-editor-foot-tag { background: rgba(8,145,178,.18); color: #cffafe; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .tdw-foot { background: #0f172a; border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-btn-back, [data-bs-theme="dark"] .tdw-btn-cancel { background: rgba(255,255,255,.04); color: #cbd5e1; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tdw-btn-back:hover, [data-bs-theme="dark"] .tdw-btn-cancel:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }

/* MasterSelect's portalled dropdown menu sits at z-index 11000 by
   default — bump it above this modal so option lists are visible. */
.master-select-menu.dropdown-menu { z-index: 250000 !important; }

/* ── Responsive ── */
@media (max-width: 900px) {
  .tdw-overlay { padding: 16px; }
  .tdw-shell { max-height: calc(100vh - 32px); }
  .tdw-head { flex-direction: column; align-items: stretch; }
  .tdw-head-right { align-self: flex-start; }
  .tdw-stepper-row { width: 100%; }
  .tdw-step-line { display: none; }
  .tdw-grid-2 { grid-template-columns: minmax(0,1fr); }
  .tdw-party-row { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .tdw-overlay { padding: 8px; }
  .tdw-step { padding: 8px 10px; gap: 8px; }
  .tdw-step-num { width: 30px; height: 30px; font-size: 12px; }
  .tdw-step-label { font-size: 12px; }
  .tdw-step-sub { font-size: 10.5px; }
  .tdw-body, .tdw-foot, .tdw-stepper, .tdw-head { padding: 14px 16px; }
  .tdw-foot { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .tdw-foot-left, .tdw-foot-right { width: 100%; justify-content: stretch; }
  .tdw-btn { flex: 1; justify-content: center; }
}
`;
