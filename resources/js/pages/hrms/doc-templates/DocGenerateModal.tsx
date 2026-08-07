import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'reactstrap';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';

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
  const [values, setValues]         = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [sending, setSending]       = useState(false);
  // Synchronous double-submit guard — `sending` only disables on next render.
  const sendingRef = useRef(false);

  // ── Bootstrap: load template + known tokens whenever the modal opens ──────
  useEffect(() => {
    if (!isOpen || !templateId) return;
    let cancelled = false;
    setLoading(true);
    setTemplate(null);
    setValues({});
    setPreviewHtml('');
    (async () => {
      try {
        const [tplRes, tokRes] = await Promise.all([
          api.get(`/hr-document-templates/${templateId}`),
          api.get('/hr-custom-fields/known-tokens').catch(() => ({ data: { employee: [], custom_fields: [] } })),
        ]);
        if (cancelled) return;
        setTemplate(tplRes.data as TemplateRow);
        setKnownTokens(tokRes.data as KnownTokens);
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
  const customFields = useMemo(() => {
    if (!template?.content_html) return [] as CustomField[];
    const found = new Set<string>();
    const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.content_html)) !== null) found.add(m[1]);
    return knownTokens.custom_fields.filter(c => found.has(c.name));
  }, [template, knownTokens]);

  const isActive = template?.status === 'Active';
  const displayName = template?.name || templateName || 'Document';
  const displayCode = template?.code || templateCode || '';

  const setVal = (name: string, val: string) =>
    setValues(prev => ({ ...prev, [name]: val }));

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
    } catch (err: any) {
      toast.error('Preview failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      setPreviewing(false);
    }
  };

  // Auto-build the first preview once the template + fields are loaded.
  useEffect(() => {
    if (isOpen && template && employeeId) refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, template, employeeId]);

  // ── Generate + download the filled DOCX ───────────────────────────────────
  const onDownload = async () => {
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
        const resp = await api.get(`/hr-generated-documents/${g.id}/download`, { responseType: 'blob' });
        const url = URL.createObjectURL(new Blob([resp.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${displayCode || 'doc'}-${(employeeName || `emp${employeeId}`).replace(/\s+/g, '-')}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      toast.success('Document saved', `${displayCode || displayName} generated & downloaded.`);
      onGenerated?.();
    } catch (err: any) {
      toast.error('Could not generate', err?.response?.data?.message || 'Please try again.');
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

  return (
    <Modal isOpen={isOpen} toggle={busy ? undefined : onClose} centered size="lg"
      contentClassName="border-0" backdrop="static" keyboard={!busy}>
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
              {customFields.length === 0 ? (
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
                  className="row g-2 mb-2"
                  style={{
                    border: 0, padding: 0, margin: 0, minInlineSize: 'auto',
                    ...(busy ? { pointerEvents: 'none', opacity: 0.6 } : {}),
                  }}
                >
                  {customFields.map(cf => (
                    <div key={cf.id} className="col-md-6">
                      <label className="dgm-label">
                        {cf.name} <span className="dgm-label-type">({cf.type})</span>
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

              {/* Preview */}
              <div className="dgm-section-title mt-3 d-flex align-items-center justify-content-between">
                <span><i className="ri-eye-line me-1" /> Preview</span>
                {/* `busy`, not just `previewing` — re-rendering the preview
                    while a save or send is in flight races the very values
                    that request is carrying. */}
                <button type="button" className="dgm-refresh" onClick={refreshPreview} disabled={busy}>
                  <i className={`${previewing ? 'ri-loader-4-line dgm-spin' : 'ri-refresh-line'} me-1`} />
                  {previewing ? 'Rendering…' : 'Refresh preview'}
                </button>
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
            <button type="button" className="dgm-btn dgm-btn-outline" onClick={onDownload} disabled={busy || !isActive || loading}
              title="Save this generated document (counts toward Generated) and download the DOCX">
              <i className={`${saving ? 'ri-loader-4-line dgm-spin' : 'ri-save-3-line'} me-1`} />
              {saving ? 'Saving…' : 'Save Generated'}
            </button>
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

      .dgm-body { padding: 18px 20px; overflow-y: auto; }
      .dgm-loading { padding: 40px 0; text-align: center; color: #6b7280; font-size: 13.5px; }
      .dgm-section-title {
        font-size: 11.5px; font-weight: 800; letter-spacing: 0.4px; color: #6b7280;
        text-transform: uppercase; margin-bottom: 10px;
      }
      .dgm-label { font-size: 11.5px; font-weight: 700; color: #6b7280; margin-bottom: 5px; display: block; }
      .dgm-label-type { font-size: 10px; color: #9ca3af; font-weight: 500; }
      .dgm-input {
        width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #e5e7eb;
        font-size: 13.5px; background: #fff; line-height: 1.4; color: #1f2937;
      }
      .dgm-input:focus { outline: none; border-color: #a5b4fc; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
      .dgm-empty {
        border-radius: 12px; border: 1px dashed #c7d2fe; background: #fafaff;
        padding: 16px; text-align: center; color: #4338ca; font-size: 13px;
      }
      .dgm-refresh {
        border: 1px solid #c7d2fe; background: #fff; color: #4338ca; border-radius: 7px;
        font-size: 11.5px; font-weight: 700; padding: 4px 10px; cursor: pointer; text-transform: none; letter-spacing: 0;
      }
      .dgm-refresh:disabled { opacity: 0.6; cursor: default; }
      .dgm-preview-stage { background: #f1f5f9; border-radius: 10px; padding: 18px; }
      .dgm-preview-paper {
        max-width: 720px; margin: 0 auto; background: #fff; border-radius: 6px; overflow: hidden;
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
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; font-weight: 700; white-space: nowrap;
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
