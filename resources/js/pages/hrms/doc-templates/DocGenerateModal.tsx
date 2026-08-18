import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'reactstrap';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';
import { saveApiBlob } from '../../../utils/downloadFile';
import Tooltip from '../../../components/ui/Tooltip';
/* .rec-form-content — the shared dialog shell used by every other popup. */
import '../../../../css/recruitment.css';

interface HeaderConfig {
  logo_path?: string | null;
  logo_url?: string | null;
  title?: string | null;
  subtitle?: string | null;
  align?: string | null;
  background?: string | null;
  text_color?: string | null;
  show_logo?: boolean | null;
  show_title?: boolean | null;
}

interface FooterConfig {
  text?: string | null;
  align?: string | null;
  background?: string | null;
  text_color?: string | null;
  show_page_number?: boolean | null;
  page_number_align?: string | null;
  page_number_format?: string | null;
}

interface TemplateRow {
  id: number;
  code: string;
  name: string;
  content_html: string | null;
  status: string;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
}

interface CustomField {
  id: number;
  name: string;
  token: string;
  type: string;
  description: string | null;
}

interface KnownTokens {
  employee: string[];
  custom_fields: CustomField[];
}

export interface DocGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: number | null;
  /** Display name shown in the header while the full template loads. */
  templateName?: string | null;
  templateCode?: string | null;
  employeeId: number | null;
  employeeName?: string | null;
  /** Called after a signing run is created so the parent can refetch runs. */
  onSent?: () => void;
  /** Called after a generated-document record is saved so the parent can
   *  refresh its "Generated" count / list. */
  onGenerated?: () => void;
}

export default function DocGenerateModal({
  isOpen, onClose, templateId, templateName, templateCode, employeeId, employeeName, onSent, onGenerated,
}: DocGenerateModalProps) {
  const toast = useToast();

  const [loading, setLoading]       = useState(false);
  const [template, setTemplate]     = useState<TemplateRow | null>(null);
  const [knownTokens, setKnownTokens] = useState<KnownTokens>({ employee: [], custom_fields: [] });
  /* The custom-field catalogue is fetched separately and its failure used to be
     swallowed into an empty list — after which this modal stated, as fact, that
     the template references no custom fields. For a low-privilege login (an
     employee opening their own onboarding Stage 5) that fetch can come back
     403, so the one user least able to diagnose it was told a flat untruth and
     went on to generate a document with the variables unfilled. A list we
     failed to load is not an empty list, and the UI has to say which it is. */
  const [tokensFailed, setTokensFailed] = useState(false);
  const [values, setValues]         = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [sending, setSending]       = useState(false);
  // Synchronous double-submit guard — `sending` only disables on next render.
  const sendingRef = useRef(false);
  /** Set the first time a custom value is edited — until then there is nothing
   *  the preview could be out of date against. */
  const valuesTouched = useRef(false);
  /** Template the opening preview has already been built for, so the effect
   *  below fires once per open however its dependencies settle. */
  const previewBuiltFor = useRef<number | null>(null);
  /** The `values` the panel on screen was rendered from. */
  const previewSignature = useRef<string>('');

  // ── Bootstrap: load template + known tokens whenever the modal opens ──────
  useEffect(() => {
    if (!isOpen || !templateId) return;
    let cancelled = false;
    setLoading(true);
    setTemplate(null);
    setValues({});
    setPreviewHtml('');
    setTokensFailed(false);
    valuesTouched.current = false;   // fresh open — nothing edited yet
    previewBuiltFor.current = null;
    previewSignature.current = '';
    (async () => {
      try {
        const [tplRes, tokRes] = await Promise.all([
          api.get(`/hr-document-templates/${templateId}`),
          // Still caught, so a missing catalogue never blocks the template
          // itself from opening — but the failure is now RECORDED rather than
          // flattened into "there are none".
          api.get('/hr-custom-fields/known-tokens').catch(() => null),
        ]);
        if (cancelled) return;
        setTemplate(tplRes.data as TemplateRow);
        if (tokRes) setKnownTokens(tokRes.data as KnownTokens);
        else setTokensFailed(true);
      } catch (err: any) {
        if (!cancelled) {
          toast.error('Could not load', err?.response?.data?.message || 'Template failed to load.');
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, templateId]);

  // ── Which custom fields does THIS template reference? ─────────────────────
  // Scan content_html for {{Token}} and keep only tokens that map to a
  // registered custom field. Employee-derived tokens (FirstName, Email, …)
  // resolve server-side, so we don't collect them here.
  /** Every {{Token}} the template actually contains, lowercased. */
  const templateTokens = useMemo(() => {
    const found = new Set<string>();
    if (!template?.content_html) return found;
    const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.content_html)) !== null) found.add(m[1].toLowerCase());
    return found;
  }, [template]);

  /* Matched case-INSENSITIVELY, because that is how the server resolves them
     (HrGeneratedDocumentController::renderTemplate). Matching exactly here meant
     a template written as {{Aaa}} against a field registered as `aaa` showed no
     input at all, and then rendered fine on the server — the modal and the
     renderer disagreeing about the same document. */
  const customFields = useMemo(
    () => knownTokens.custom_fields.filter(c => templateTokens.has(c.name.toLowerCase())),
    [templateTokens, knownTokens],
  );

  /* Tokens the template uses that neither the employee catalogue nor the custom
     field list can explain. They render as literal braces in the output, so the
     operator is better off seeing them named here than finding them in a signed
     letter. */
  const unresolvedTokens = useMemo(() => {
    if (tokensFailed) return [] as string[];
    const known = new Set<string>([
      ...knownTokens.employee.map(t => String((t as any).name ?? t).toLowerCase()),
      ...knownTokens.custom_fields.map(c => c.name.toLowerCase()),
    ]);
    // Signature/date slots are filled by the signing flow, not at generation.
    const signerSlot = /^signer\d+(sign|name|date|designation)$/;
    return [...templateTokens].filter(t => !known.has(t) && !signerSlot.test(t));
  }, [templateTokens, knownTokens, tokensFailed]);

  const isActive = template?.status === 'Active';
  const displayName = template?.name || templateName || 'Document';
  const displayCode = template?.code || templateCode || '';

  const setVal = (name: string, val: string) => {
    valuesTouched.current = true;   // arms the debounced preview below
    setValues(prev => ({ ...prev, [name]: val }));
  };

  // ── Preview ───────────────────────────────────────────────────────────────
  const refreshPreview = async () => {
    if (!templateId || !employeeId) return;
    setPreviewing(true);
    try {
      const { data } = await api.post('/hr-generated-documents/preview', {
        template_id: templateId,
        employee_id: employeeId,
        custom_values: values,
      });
      setPreviewHtml(data?.rendered_html || '');
      // Remember exactly which values this render was built from, so the
      // "out of date" flag reflects a real difference rather than any keypress.
      previewSignature.current = JSON.stringify(values);
    } catch (err: any) {
      toast.error('Preview failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      setPreviewing(false);
    }
  };

  /* Build the preview ONCE per open, then only when asked.
     The deps here (template, employeeId) settle at different moments as their
     fetches land, so this effect ran more than once on a single open — two
     identical /preview requests before the operator had typed anything. The
     ref pins it to the first time all three are ready. */
  useEffect(() => {
    if (!isOpen || !template || !employeeId) return;
    if (previewBuiltFor.current === templateId) return;
    previewBuiltFor.current = templateId ?? null;
    refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, template, employeeId]);

  /* Editing a value no longer fires a preview.
     It used to re-render 600ms after every change, which meant a request per
     field on the way through the form and a visible wait each time. The
     rendered document only has to be right at the moment it is produced, and
     Save and Send both post the CURRENT values — the preview is a reading aid,
     not the source. So the panel is refreshed on demand instead, and marks
     itself out-of-date in the meantime so nobody reviews a stale page thinking
     it is current. */
  const previewStale = valuesTouched.current && !previewing
    && previewSignature.current !== JSON.stringify(values);

  /* Saves the generated-document record, then streams it back in the chosen
     format. Both formats come off the SAME saved row, so the DOCX and the PDF
     of one click are the same document — the format only decides how it is
     read. PDF exists because PhpWord writes images in the legacy VML form,
     which Word/LibreOffice/Google Docs render but some readers (WordPad) do
     not, so a DOCX letterhead could go missing depending on the opener. */
  const onDownload = async (format: 'docx' | 'pdf' = 'docx') => {
    if (!templateId || !employeeId) return;
    if (!isActive) {
      toast.error('Not active', 'Only Active templates can be generated. Publish this template first.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/hr-generated-documents', {
        template_id: templateId,
        recipients: [{ employee_id: employeeId, custom_values: values }],
      });
      const docs: Array<{ id: number }> = data?.documents ?? [];
      for (const g of docs) {
        const path = format === 'pdf'
          ? `/hr-generated-documents/${g.id}/download-pdf`
          : `/hr-generated-documents/${g.id}/download`;
        const resp = await api.get(path, { responseType: 'blob' });
        const name = `${displayCode || 'doc'}-${(employeeName || `emp${employeeId}`).replace(/\s+/g, '-')}.${format}`;
        // Verify it really is one before handing the user a file named .pdf/.docx.
        await saveApiBlob(new Blob([resp.data]), name, format);
      }
      toast.success('Document saved', `${displayCode || displayName} generated & downloaded as ${format.toUpperCase()}.`);
      onGenerated?.();
    } catch (err: any) {
      toast.error('Could not generate', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Send into the signing workflow (custom values frozen in) ──────────────
  const onSend = async () => {
    if (!templateId || !employeeId || sendingRef.current) return;
    if (!isActive) {
      toast.error('Not active', 'Only Active templates can be sent for signing. Publish this template first.');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: templateId,
        employee_id: employeeId,
        custom_values: values,
      });
      toast.success('Sent for signing', `${data?.code || data?.template?.code || displayName} entered the workflow.`);
      onSent?.();
      onClose();
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const busy = saving || sending || previewing;

  /* `rec-form-content` is the app's standard dialog shell (18px radius, the
     premium shadow, and overflow:hidden so a gradient header is CLIPPED by the
     corners). Without it this modal fell back to reactstrap's default radius
     while the gradient header inside kept square corners, so the curve read as
     broken against every other popup in the app. */
  return (
    <Modal isOpen={isOpen} toggle={busy ? undefined : onClose} centered size="lg"
      className="dgm-dialog" contentClassName="rec-form-content border-0"
      backdrop="static" keyboard={!busy}>
      <ScopedStyles />
      <div className="dgm">
        {/* Header */}
        <div className="dgm-head">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span className="dgm-head-icon"><i className="ri-file-text-line" /></span>
            <div className="min-w-0">
              <div className="dgm-head-title text-truncate">Generate Document</div>
              <div className="dgm-head-sub text-truncate">
                {displayName}{displayCode ? ` · ${displayCode}` : ''}
                {employeeName ? ` — ${employeeName}` : ''}
              </div>
            </div>
          </div>
          <button type="button" className="dgm-close" onClick={onClose} disabled={busy} title="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="dgm-body">
          {loading ? (
            <div className="dgm-loading">
              <span className="spinner-border spinner-border-sm me-2" /> Loading template…
            </div>
          ) : (
            <>
              {/* Fill variables */}
              <div className="dgm-section-title">
                <i className="ri-edit-2-line me-1" /> Fill Custom Variables
              </div>
              {tokensFailed ? (
                /* Say the catalogue is missing rather than that the template
                   has no fields — the second is a claim we cannot make when
                   the list never arrived. */
                <div className="dgm-empty" style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}>
                  <i className="ri-error-warning-line" style={{ fontSize: 20, display: 'block', marginBottom: 4 }} />
                  Couldn't load your organisation's custom fields, so any custom variables in
                  this template can't be filled here. Close and reopen to retry — if it keeps
                  failing, ask your administrator to check your access to Custom Fields.
                </div>
              ) : customFields.length === 0 ? (
                <div className="dgm-empty">
                  <i className="ri-magic-line" style={{ fontSize: 20, display: 'block', marginBottom: 4 }} />
                  This template doesn't reference any custom fields. Employee details are
                  filled automatically — just preview &amp; generate below.
                </div>
              ) : (
                /* Frozen while a save / send / preview is in flight (#46).
                   These values are what get merged into the document, so
                   editing them mid-save would produce a file that doesn't match
                   what is on screen — and a signing request is sent with the
                   values frozen in, which cannot be taken back.

                   A disabled <fieldset> covers the native inputs in one go;
                   pointer-events is what stops MasterDatePicker, which is a
                   custom widget that `disabled` alone does not reach. */
                <fieldset
                  disabled={busy}
                  className="dgm-fieldgrid row g-2 mb-2"
                  style={{
                    minInlineSize: 'auto',
                    ...(busy ? { pointerEvents: 'none', opacity: 0.6 } : {}),
                  }}
                >
                  {customFields.map(cf => (
                    // Three across on a desktop-width dialog, two on a laptop.
                    // At two, a template with a dozen variables ran well past
                    // the fold and the preview under it was never in view.
                    <div key={cf.id} className="col-md-6 col-xl-4">
                      {/* Token names are operator-typed and can run to any
                          length; a long one used to overrun its column and
                          print across the field beside it. Cut it and keep the
                          whole name reachable on hover — the type stays outside
                          the clamp so it never gets trimmed away.
                          `disabled` when nothing was cut, so a short name does
                          not carry a hover that just repeats what is on screen. */}
                      <label className="dgm-label">
                        <Tooltip label={cf.name} disabled={cf.name.length <= MAX_LABEL_CHARS}>
                          <span className="dgm-label-name">{truncateLabel(cf.name)}</span>
                        </Tooltip>
                        {' '}<span className="dgm-label-type">({cf.type})</span>
                      </label>
                      {cf.type === 'textarea' ? (
                        <textarea className="dgm-input" rows={2}
                          value={values[cf.name] || ''}
                          onChange={e => setVal(cf.name, e.target.value)}
                          placeholder={cf.description || ''} style={{ resize: 'vertical' }} />
                      ) : cf.type === 'date' ? (
                        <MasterDatePicker value={values[cf.name] || ''}
                          onChange={(v: string) => setVal(cf.name, v)}
                          placeholder={cf.description || 'Select date'} />
                      ) : (
                        <input className="dgm-input"
                          type={cf.type === 'number' ? 'number' : 'text'}
                          value={values[cf.name] || ''}
                          onChange={e => setVal(cf.name, e.target.value)}
                          placeholder={cf.description || ''} />
                      )}
                    </div>
                  ))}
                </fieldset>
              )}

              {/* Tokens nothing can fill. They reach the document as literal
                  {{braces}}, so naming them here is the last point at which
                  that is cheap to fix. */}
              {unresolvedTokens.length > 0 && (
                <div className="dgm-empty mt-2" style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e', textAlign: 'left' }}>
                  <i className="ri-error-warning-line me-1" />
                  {unresolvedTokens.length === 1 ? 'This variable is' : 'These variables are'} in the
                  template but not registered as a custom field, so {unresolvedTokens.length === 1 ? 'it' : 'they'} will
                  print as-is:{' '}
                  <strong>{unresolvedTokens.map(t => `{{${t}}}`).join(', ')}</strong>
                </div>
              )}

              {/* Preview */}
              <div className="dgm-section-title mt-2 d-flex align-items-center justify-content-between">
                <span className="d-inline-flex align-items-center">
                  <i className="ri-eye-line me-1" /> Preview
                  {/* The panel no longer re-renders as you type, so it has to
                      say when it has fallen behind — otherwise the operator
                      reviews an old page believing it is current. */}
                  {previewStale && (
                    <span className="dgm-stale"><i className="ri-information-line" /> Out of date</span>
                  )}
                </span>
                {/* `busy`, not just `previewing` — re-rendering the preview
                    while a save or send is in flight races the very values
                    that request is carrying. */}
                <Tooltip label="Re-renders the panel below with the values above. Download PDF and Send for Signature always use the current values, whether or not the preview has been refreshed.">
                <button
                  type="button"
                  className={`dgm-refresh${previewStale ? ' is-stale' : ''}`}
                  onClick={refreshPreview}
                  disabled={busy}
                >
                  <i className={`${previewing ? 'ri-loader-4-line dgm-spin' : 'ri-refresh-line'} me-1`} />
                  {previewing ? 'Rendering…' : 'Save preview'}
                </button>
                </Tooltip>
              </div>
              <div className="dgm-preview-stage">
                <div className="dgm-preview-paper">
                  <DocHeader cfg={template?.header_config} />
                  <div className="dgm-preview-body"
                    dangerouslySetInnerHTML={{ __html: decorateUnfilledTokens(previewHtml || '<p style="color:#9ca3af;font-style:italic;">(empty preview)</p>') }} />
                  <DocFooter cfg={template?.footer_config} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="dgm-footer">
          <button type="button" className="dgm-btn dgm-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {/* Both actions swap their icon for a spinning loader while in flight —
              the label alone ("Saving…" / "Sending…") read as a dead button on a
              slow render/upload, and Send had no busy affordance at all. */}
          <div className="d-flex gap-2">
            {/* Both buttons SAVE the same record — the format only decides how
                the copy is read. PDF first because it is the safe one to send
                on: it looks identical in every reader. DOCX is for editing.
                Each names the save AND the download, since the old "Save
                Generated" mentioned only the save and the file arriving in the
                browser came as a surprise. */}
            {/* The label says "Download", so the hover has to carry the half it
                leaves out: this also files the document against the employee. */}
            <Tooltip label="Saves this document against the employee (counts toward Generated) and downloads a PDF — renders identically in every reader">
              <button type="button" className="dgm-btn dgm-btn-outline" onClick={() => onDownload('pdf')} disabled={busy || !isActive || loading}>
                <i className={`${saving ? 'ri-loader-4-line dgm-spin' : 'ri-file-pdf-2-line'} me-1`} />
                {saving ? 'Saving…' : 'Download PDF'}
              </button>
            </Tooltip>
            {/* Save & DOCX — hidden on request. PhpWord writes images in the
                legacy VML form, so the letterhead can vanish depending on the
                reader; PDF above is the reliable copy. onDownload('docx') and
                its route are left intact so this is a one-line restore.
            <button type="button" className="dgm-btn dgm-btn-outline" onClick={() => onDownload('docx')} disabled={busy || !isActive || loading}
              title="Saves this document against the employee (counts toward Generated) and downloads an editable DOCX">
              <i className={`${saving ? 'ri-loader-4-line dgm-spin' : 'ri-file-word-2-line'} me-1`} />
              {saving ? 'Saving…' : 'Save & DOCX'}
            </button>
            */}
            <button type="button" className="dgm-btn dgm-btn-primary" onClick={onSend} disabled={busy || !isActive || loading}>
              <i className={`${sending ? 'ri-loader-4-line dgm-spin' : 'ri-quill-pen-line'} me-1`} />
              {sending ? 'Sending…' : 'Send for Signature'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Longest token name shown in full above a field; the rest is on hover. */
const MAX_LABEL_CHARS = 30;

/* Cut in JS rather than with a CSS ellipsis: the label is two parts — the name
   and the "(type)" hint — and a CSS clamp on the whole line would eat the hint
   first, which is the half that says what to enter. */
function truncateLabel(name: string): string {
  const s = String(name ?? '');
  return s.length > MAX_LABEL_CHARS ? s.slice(0, MAX_LABEL_CHARS).trimEnd() + '…' : s;
}

// Wrap remaining {{Token}} text with a styled "unfilled placeholder" chip so
// the preview clearly flags what didn't resolve.
function decorateUnfilledTokens(html: string): string {
  return html.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_m, name) => `<span class="dgm-unfilled" title="Unfilled placeholder — fill it above or it appears as-is in the final document">${name}</span>`,
  );
}

function DocHeader({ cfg }: { cfg?: HeaderConfig | null }) {
  if (!cfg) return null;
  const showLogo  = cfg.show_logo  !== false;
  const showTitle = cfg.show_title !== false;
  const logoSrc = cfg.logo_url || (cfg.logo_path ? `/storage/${cfg.logo_path}` : null);
  const hasAnything = (showLogo && logoSrc) || (showTitle && (cfg.title || cfg.subtitle));
  if (!hasAnything) return null;
  return (
    <div className="dgm-doc-header" style={{ background: cfg.background || '#0f172a', color: cfg.text_color || '#fff' }}>
      {showLogo && logoSrc && (
        <img src={logoSrc} alt="Logo" className="dgm-doc-logo"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      {showTitle && (cfg.title || cfg.subtitle) && (
        <div style={{ textAlign: cfg.align === 'left' ? 'left' : 'right', flex: 1 }}>
          {cfg.title    && <div className="dgm-doc-title">{cfg.title}</div>}
          {cfg.subtitle && <div className="dgm-doc-sub">{cfg.subtitle}</div>}
        </div>
      )}
    </div>
  );
}

function DocFooter({ cfg }: { cfg?: FooterConfig | null }) {
  if (!cfg) return null;
  const text = (cfg.text || '').trim();
  const showPage = cfg.show_page_number !== false;
  if (!text && !showPage) return null;
  const align = cfg.align || 'right';
  const pageAlign = cfg.page_number_align || 'right';
  const pageLabel = (cfg.page_number_format || '1').replace(/N/g, '1').replace(/M/g, '1');
  return (
    <div className="dgm-doc-footer" style={{ background: cfg.background || '#fff', color: cfg.text_color || '#6b7280' }}>
      <div style={{ flex: 1, textAlign: align as any }}>{text}</div>
      {showPage && <div style={{ marginLeft: 12, textAlign: pageAlign as any }}>{pageLabel}</div>}
    </div>
  );
}

function ScopedStyles() {
  return (
    <style>{`
      /* Wider than Bootstrap's 800px "lg": this popup shows a rendered A4 page,
         and at 800px the preview sheet left too little room for the document to
         read like the page it becomes. Still capped by the viewport so nothing
         overflows on a small laptop screen. */
      .modal-dialog.dgm-dialog { max-width: min(1180px, calc(100vw - 32px)); }
      .dgm { display: flex; flex-direction: column; max-height: 86vh; }
      .dgm-head {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 16px 20px; color: #fff;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%);
      }
      .dgm-head-icon {
        width: 40px; height: 40px; border-radius: 11px; background: rgba(255,255,255,0.18);
        display: inline-flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
      }
      .dgm-head-title { font-size: 16px; font-weight: 800; line-height: 1.2; }
      .dgm-head-sub   { font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 2px; }
      .dgm-close {
        width: 32px; height: 32px; border-radius: 8px; border: 0; flex-shrink: 0;
        background: rgba(255,255,255,0.18); color: #fff; cursor: pointer; font-size: 18px;
      }
      .dgm-close:disabled { opacity: 0.5; cursor: default; }

      .dgm-body { padding: 14px 16px; overflow-y: auto; }
      .dgm-loading { padding: 40px 0; text-align: center; color: #6b7280; font-size: 13.5px; }
      .dgm-section-title {
        font-size: 11.5px; font-weight: 800; letter-spacing: 0.4px; color: #6b7280;
        text-transform: uppercase; margin-bottom: 8px;
      }
      /* The variables sit on a tinted panel of their own so the eye reads one
         block of inputs and then the document, instead of a loose field grid
         running straight into the preview. */
      .dgm-fieldgrid {
        background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px;
        padding: 12px 8px 4px;
        /* This element is the grid row AND the panel. A row carries negative
           side margins to cancel its columns' gutter padding; left on, they
           would pull the first and last column out through the panel's border.
           Zero them and let the column padding be the inset. */
        margin-left: 0; margin-right: 0;
      }
      /* One line, and a hard clamp so a token name with no spaces in it — the
         common case — cannot push the label past its column either. */
      .dgm-label {
        font-size: 11px; font-weight: 700; color: #6b7280; margin-bottom: 3px;
        display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .dgm-label-name { cursor: help; }
      .dgm-label-type { font-size: 10px; color: #9ca3af; font-weight: 500; }
      .dgm-input {
        width: 100%; padding: 6px 10px; border-radius: 7px; border: 1px solid #e5e7eb;
        font-size: 13px; background: #fff; line-height: 1.4; color: #1f2937;
        transition: border-color .15s ease, box-shadow .15s ease;
      }
      .dgm-input:hover:not(:focus) { border-color: #d7dce4; }
      /* The date fields are the shared MasterDatePicker, which brings its own
         38px shell, 10px radius and card background. Sitting in the same grid
         as a 34px text input it read as a bigger, greyer, differently-shaped
         control. Pin the two to one shell so a row of mixed field types lines
         up. Textareas are excluded — they are sized by their rows. */
      .dgm-fieldgrid .dgm-input:not(textarea),
      .dgm-fieldgrid .master-datepicker-toggle { height: 34px; min-height: 34px; }
      .dgm-fieldgrid .master-datepicker-toggle {
        padding: 0 10px; border-radius: 7px; font-size: 13px;
        background: #fff; border-color: #e5e7eb; box-shadow: none;
      }
      [data-bs-theme="dark"] .dgm-fieldgrid .master-datepicker-toggle,
      [data-layout-mode="dark"] .dgm-fieldgrid .master-datepicker-toggle {
        background: #0f172a; border-color: rgba(255,255,255,0.10);
      }
      .dgm-input:focus { outline: none; border-color: #a5b4fc; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
      .dgm-empty {
        border-radius: 12px; border: 1px dashed #c7d2fe; background: #fafaff;
        padding: 16px; text-align: center; color: #4338ca; font-size: 13px;
      }
      .dgm-refresh {
        display: inline-flex; align-items: center;
        border: 1px solid #c7d2fe; background: #fff; color: #4338ca; border-radius: 7px;
        font-size: 11.5px; font-weight: 700; padding: 5px 12px; cursor: pointer; text-transform: none; letter-spacing: 0;
        transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
      }
      .dgm-refresh:hover:not(:disabled) { background: #eef2ff; border-color: #a5b4fc; }
      .dgm-refresh:disabled { opacity: 0.6; cursor: default; }
      /* Filled while the panel is behind the form — the one moment pressing it
         actually changes what you see, so it should read as the next step
         rather than as one more quiet control. */
      .dgm-refresh.is-stale {
        background: #4338ca; border-color: #4338ca; color: #fff;
        box-shadow: 0 2px 8px rgba(67,56,202,0.28);
      }
      .dgm-refresh.is-stale:hover:not(:disabled) { background: #3730a3; border-color: #3730a3; }
      .dgm-stale {
        display: inline-flex; align-items: center; gap: 4px; margin-left: 8px;
        background: #fffbeb; border: 1px solid #fcd34d; color: #92400e;
        border-radius: 999px; padding: 1px 8px;
        font-size: 10px; font-weight: 700; text-transform: none; letter-spacing: 0;
      }
      .dgm-preview-stage { background: #f1f5f9; border-radius: 10px; padding: 18px; }
      .dgm-preview-paper {
        max-width: 820px; margin: 0 auto; background: #fff; border-radius: 6px; overflow: hidden;
        box-shadow: 0 10px 30px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04);
      }
      .dgm-doc-header { display: flex; align-items: center; gap: 16px; padding: 16px 28px; }
      .dgm-doc-logo { max-height: 40px; max-width: 160px; object-fit: contain; border-radius: 6px; }
      .dgm-doc-title { font-weight: 800; font-size: 15px; }
      .dgm-doc-sub { font-size: 11px; opacity: 0.78; margin-top: 2px; }
      .dgm-doc-footer { display: flex; align-items: center; padding: 12px 28px; font-size: 11px; border-top: 1px solid #e5e7eb; }
      .dgm-preview-body { padding: 32px 48px; font-size: 13.5px; line-height: 1.7; color: #1f2937; }
      .dgm-preview-body p { margin: 0 0 10px; }
      .dgm-preview-body h1 { font-size: 20px; font-weight: 800; color: #111827; margin: 14px 0 8px; }
      .dgm-preview-body h2 { font-size: 16px; font-weight: 800; color: #111827; margin: 12px 0 6px; }
      .dgm-preview-body h3 { font-size: 14px; font-weight: 700; color: #111827; margin: 10px 0 5px; }
      .dgm-preview-body ul, .dgm-preview-body ol { padding-left: 22px; margin: 0 0 10px; }
      .dgm-preview-body strong { color: #111827; }
      .dgm-unfilled {
        display: inline-block; background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e;
        padding: 1px 8px; margin: 0 1px; border-radius: 4px; border: 1px dashed #f59e0b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; font-weight: 700;
        /* nowrap kept a long token name on one line, and a token name has no
           spaces to break at — the chip ran straight off the edge of the page
           it is supposed to be sitting on. Let it wrap mid-word and cap it at
           the paper's width so the preview stays a preview. */
        max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: break-word;
        vertical-align: bottom;
      }

      .dgm-footer {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 14px 20px; border-top: 1px solid #e5e7eb; background: #f9fafb;
      }
      .dgm-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; }
      .dgm-btn:disabled { opacity: 0.55; cursor: default; }
      /* Busy spinner for the footer actions + Refresh preview. display:inline-block
         is required — a bare <i> is inline, and transforms don't apply to inline
         boxes, so the icon would sit still. */
      .dgm-spin { display: inline-block; animation: dgm-spin 0.8s linear infinite; }
      @keyframes dgm-spin { to { transform: rotate(360deg); } }
      /* Honour a reduced-motion preference: keep the swapped loader icon, drop
         the rotation. */
      @media (prefers-reduced-motion: reduce) {
        .dgm-spin { animation: none; }
      }
      .dgm-btn-ghost { background: #fff; border: 1px solid #d1d5db; color: #374151; }
      .dgm-btn-outline { background: #fff; border: 2px solid #7c3aed; color: #7c3aed; }
      .dgm-btn-primary { border: 0; color: #fff; background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,0.30); }

      /* Dark mode */
      [data-bs-theme="dark"] .dgm-body,
      [data-layout-mode="dark"] .dgm-body { background: #1f2937; }
      [data-bs-theme="dark"] .dgm-footer,
      [data-layout-mode="dark"] .dgm-footer { background: #111827; border-top-color: rgba(255,255,255,0.08); }
      [data-bs-theme="dark"] .dgm-input,
      [data-layout-mode="dark"] .dgm-input {
        background: #0f172a; border-color: rgba(255,255,255,0.10); color: #f1f5f9;
      }
      [data-bs-theme="dark"] .dgm-input::placeholder,
      [data-layout-mode="dark"] .dgm-input::placeholder { color: rgba(255,255,255,0.35); }
      [data-bs-theme="dark"] .dgm-empty,
      [data-layout-mode="dark"] .dgm-empty {
        background: rgba(99,102,241,0.10); border-color: rgba(129,140,248,0.40); color: #c7d2fe;
      }
      [data-bs-theme="dark"] .dgm-btn-ghost,
      [data-layout-mode="dark"] .dgm-btn-ghost {
        background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); color: #e2e8f0;
      }
      [data-bs-theme="dark"] .dgm-refresh,
      [data-layout-mode="dark"] .dgm-refresh { background: rgba(255,255,255,0.06); color: #c7d2fe; border-color: rgba(129,140,248,0.40); }
      [data-bs-theme="dark"] .dgm-preview-stage,
      [data-layout-mode="dark"] .dgm-preview-stage { background: #0f172a; }
      /* Preview paper stays light — the rendered content carries author-defined
         (usually dark) text, so a dark page would be unreadable. */
      [data-bs-theme="dark"] .dgm-preview-paper,
      [data-layout-mode="dark"] .dgm-preview-paper { background: #fff; }
      [data-bs-theme="dark"] .dgm-preview-body,
      [data-layout-mode="dark"] .dgm-preview-body { color: #1f2937; }
    `}</style>
  );
}
