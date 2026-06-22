import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Input } from 'reactstrap';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';
import { Shimmer } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';

/**
 * Generate Document — 3-step wizard launched from a template row.
 *
 *   Step 1 — Select Employees     pick recipients from the tenant's employee list
 *   Step 2 — Fill Variables       auto-fetch employee tokens + capture custom-field values per employee
 *   Step 3 — Preview & Generate   render every recipient's document, then POST to commit
 *
 * Flow: parent (HrDocumentTemplates) navigates here with the template id in
 * the URL. We fetch the template + the known-tokens catalogue once on mount,
 * then walk the user through the three screens. Step 3's Generate button
 * bulk-creates one hr_generated_documents row per recipient and lands the
 * user on a download-ready success summary.
 */

interface HeaderConfig {
  logo_path?: string | null;
  logo_url?: string | null;
  title?: string | null;
  subtitle?: string | null;
  align?: 'left' | 'center' | 'right' | 'space-between' | null;
  background?: string | null;
  text_color?: string | null;
  show_logo?: boolean | null;
  show_title?: boolean | null;
}

interface FooterConfig {
  text?: string | null;
  align?: 'left' | 'center' | 'right' | null;
  background?: string | null;
  text_color?: string | null;
  show_page_number?: boolean | null;
  page_number_align?: 'left' | 'center' | 'right' | null;
  page_number_format?: string | null;
}

interface TemplateRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  content_html: string | null;
  status: string;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
}

interface EmployeeRow {
  id: number;
  emp_code: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  department?: { id: number; name: string } | null;
  designation?: { id: number; name: string } | null;
  status?: string;
}

interface KnownTokens {
  employee: string[];
  custom_fields: Array<{ id: number; name: string; token: string; type: string; description: string | null }>;
}

interface GeneratedDoc {
  id: number;
  template_id: number;
  employee_id: number;
  status: string;
  template?: { id: number; code: string; name: string };
  employee?: { id: number; emp_code: string; first_name: string; last_name: string };
}

const STEPS = [
  { key: 1, label: 'Select Employees',  sub: 'Choose who receives this document' },
  { key: 2, label: 'Fill Variables',    sub: 'Enter custom field values per employee' },
  { key: 3, label: 'Preview & Generate', sub: 'Review and generate documents' },
];

export default function GenerateDocument() {
  const toast = useToast();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const templateId = routeId ? Number(routeId) : null;

  const [bootstrapping, setBootstrapping] = useState(true);
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [knownTokens, setKnownTokens] = useState<KnownTokens>({ employee: [], custom_fields: [] });
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);

  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [customByEmp, setCustomByEmp] = useState<Record<number, Record<string, string>>>({});
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [previewing, setPreviewing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc[] | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, tokensRes, empRes] = await Promise.all([
          api.get(`/hr-document-templates/${templateId}`),
          api.get('/hr-custom-fields/known-tokens').catch(() => ({ data: { employee: [], custom_fields: [] } })),
          // onboarded_only → only Active, fully-onboarded, non-disabled staff
          // are selectable (excludes exited / inactive / half-onboarded), the
          // same gate Recruitment's people-pickers use.
          api.get('/employees', { params: { onboarded_only: 1 } }),
        ]);
        if (cancelled) return;
        setTemplate(tplRes.data as TemplateRow);
        setKnownTokens(tokensRes.data as KnownTokens);
        setEmployees(Array.isArray(empRes.data) ? empRes.data : (empRes.data?.data ?? []));
      } catch (err: any) {
        if (!cancelled) {
          toast.error('Could not load', err?.response?.data?.message || 'Template or employee list failed to load.');
          navigate('/hr/doc-templates');
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // ── Derived: which custom fields does THIS template reference? ─────────────
  // Scan content_html for {{Token}} and keep only the tokens that match a
  // registered custom field — those are the only inputs Step 2 collects.
  // Employee-derived tokens (FirstName, Email, etc.) are resolved server-side
  // at generate time from the employee record, so we don't expose them here.
  const templateCustomFields = useMemo(() => {
    if (!template?.content_html) return [] as KnownTokens['custom_fields'];
    const html = template.content_html;
    const found = new Set<string>();
    const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) found.add(m[1]);
    return knownTokens.custom_fields.filter(c => found.has(c.name));
  }, [template, knownTokens]);

  const selectedEmployees = useMemo(
    () => employees.filter(e => selectedIds.has(e.id)),
    [employees, selectedIds],
  );

  // ── Step transitions ─────────────────────────────────────────────────────
  const goNext = async () => {
    if (step === 1) {
      if (selectedIds.size === 0) {
        toast.error('No employees selected', 'Pick at least one recipient to continue.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      // Fetch a preview render per selected employee before showing step 3.
      setPreviewing(true);
      try {
        const out: Record<number, string> = {};
        for (const emp of selectedEmployees) {
          const { data } = await api.post('/hr-generated-documents/preview', {
            template_id: templateId,
            employee_id: emp.id,
            custom_values: customByEmp[emp.id] || {},
          });
          out[emp.id] = data?.rendered_html || '';
        }
        setPreviews(out);
        setStep(3);
      } catch (err: any) {
        toast.error('Preview failed', err?.response?.data?.message || 'Please try again.');
      } finally {
        setPreviewing(false);
      }
    }
  };

  const goBack = () => setStep(s => Math.max(1, s - 1));

  // Authenticated blob download — the project uses Bearer-token auth via
  // localStorage, so a plain <a href="/api/..."> link gets a 401 because the
  // Authorization header doesn't fire. We pull the file as a blob through
  // axios (which the interceptor signs) and trigger the download manually.
  const downloadGenerated = async (g: GeneratedDoc) => {
    try {
      const resp = await api.get(`/hr-generated-documents/${g.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      const tplCode = g.template?.code || 'doc';
      const empCode = g.employee?.emp_code || `emp${g.employee_id}`;
      a.download = `${tplCode}-${empCode}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    }
  };

  const onGenerate = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/hr-generated-documents', {
        template_id: templateId,
        recipients: selectedEmployees.map(e => ({
          employee_id: e.id,
          custom_values: customByEmp[e.id] || {},
        })),
      });
      setGenerated(data?.documents ?? []);
      toast.success('Documents generated', `${data?.count ?? 0} document(s) ready to download.`);
    } catch (err: any) {
      toast.error('Could not generate', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* Generate the document(s) and download them immediately — saves the user a
     trip through the success screen when they just want the file. Reuses the
     same generate endpoint + the existing authenticated DOCX download. */
  const onDownload = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/hr-generated-documents', {
        template_id: templateId,
        recipients: selectedEmployees.map(e => ({
          employee_id: e.id,
          custom_values: customByEmp[e.id] || {},
        })),
      });
      const docs: GeneratedDoc[] = data?.documents ?? [];
      for (const g of docs) {
        await downloadGenerated(g);
      }
      setGenerated(docs);
      toast.success('Downloaded', `${docs.length} document(s) generated and downloaded.`);
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* Send the customised document into the signing workflow for each selected
     employee — same custom values the user filled here are frozen into the
     signed copy (backend store() merges custom_values). One run per employee. */
  const onSendForSignature = async () => {
    setSending(true);
    let ok = 0; let fail = 0;
    try {
      for (const e of selectedEmployees) {
        try {
          await api.post('/hr-document-signatures', {
            template_id: templateId,
            employee_id: e.id,
            custom_values: customByEmp[e.id] || {},
          });
          ok++;
        } catch { fail++; }
      }
      if (ok > 0) {
        toast.success('Sent for signature', `${ok} document(s) sent to the signing workflow${fail ? ` · ${fail} failed` : ''}.`);
        navigate('/hr/doc-templates');
      } else {
        toast.error('Could not send', 'No documents were sent. Make sure the template has a signing workflow configured.');
      }
    } finally {
      setSending(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (bootstrapping || !template) {
    // Skeleton mirrors the wizard shell (gradient header → step strip →
    // employee-select body → footer) so the layout doesn't jump when it loads.
    return (
      <div className="rec-page gd-page">
        <Card className="mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
          {/* Header band */}
          <div style={headerGradient}>
            <div className="d-flex align-items-center gap-3" style={{ padding: '16px 22px' }}>
              <Shimmer width={44} height={44} radius={12} style={{ background: 'rgba(255,255,255,0.25)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Shimmer width={180} height={18} style={{ background: 'rgba(255,255,255,0.30)' }} />
                <Shimmer width={260} height={11} style={{ background: 'rgba(255,255,255,0.22)' }} />
              </div>
            </div>
          </div>

          {/* Step strip */}
          <div style={{ display: 'flex', gap: 16, padding: '14px 22px', borderBottom: '1px solid #e5e7eb' }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <Shimmer width={28} height={28} radius={999} />
                <Shimmer height={12} width="55%" />
              </div>
            ))}
          </div>

          {/* Body — employee select list */}
          <CardBody style={{ padding: 22 }}>
            <Shimmer width={200} height={14} style={{ marginBottom: 16 }} />
            <div style={{ display: 'grid', gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #eef2f7', borderRadius: 10 }}>
                  <Shimmer width={18} height={18} radius={4} />
                  <Shimmer width={36} height={36} radius={999} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Shimmer height={12} width="40%" />
                    <Shimmer height={10} width="60%" />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>

          {/* Footer */}
          <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Shimmer width={90} height={12} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Shimmer width={80} height={34} radius={8} />
              <Shimmer width={80} height={34} radius={8} />
              <Shimmer width={110} height={34} radius={8} />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Success state — replaces the wizard once generate completes
  if (generated) {
    return (
      <div className="rec-page gd-page">
        <ScopedStyles />
        <Card style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div style={headerGradient}>
            <div style={{ padding: '20px 24px', color: '#fff' }}>
              <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 4 }}>Done.</div>
              <h4 className="mb-0 fw-bold" style={{ color: '#fff' }}>
                {generated.length} document{generated.length === 1 ? '' : 's'} generated
              </h4>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
                {template.name} · {template.code}
              </div>
            </div>
          </div>
          <CardBody style={{ padding: 18 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              {generated.map(g => {
                const name = g.employee ? `${g.employee.first_name ?? ''} ${g.employee.last_name ?? ''}`.trim() : `#${g.employee_id}`;
                return (
                  <div key={g.id} className="gd-success-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                    <div className="d-flex align-items-center gap-3">
                      <span style={{ width: 32, height: 32, borderRadius: 999, background: '#dcfce7', color: '#15803d', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="ri-check-line" />
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, color: '#1f2937' }} className="gd-success-name">{name}</div>
                        <div style={{ fontSize: 11.5, color: '#6b7280' }} className="gd-success-sub">{g.employee?.emp_code || ''} · {g.status}</div>
                      </div>
                    </div>
                    <button type="button" onClick={() => downloadGenerated(g)}
                      style={{ padding: '6px 12px', borderRadius: 8, background: PRIMARY_GRADIENT, color: '#fff', fontSize: 12, fontWeight: 700, border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: PRIMARY_GLOW }}>
                      <i className="ri-download-2-line" /> Download DOCX
                    </button>
                  </div>
                );
              })}
            </div>
          </CardBody>
          <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 8 }} className="gd-footer">
            <button type="button" onClick={() => navigate('/hr/doc-templates')}
              style={{ padding: '8px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="rec-page gd-page">
      <ScopedStyles />
      <Card className="mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
        <div style={headerGradient}>
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap" style={{ padding: '16px 22px' }}>
            <div className="d-flex align-items-center gap-3 min-w-0">
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-file-text-line" style={{ fontSize: 22, color: '#fff' }} />
              </span>
              <div>
                <h4 className="fw-bold mb-0" style={{ color: '#fff' }}>Generate Document</h4>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  {template.name} — Select employees, fill variables &amp; generate
                </div>
              </div>
            </div>
            <button type="button" onClick={() => navigate('/hr/doc-templates')}
              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', cursor: 'pointer' }} title="Close">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <StepStrip step={step} />

        <CardBody style={{ padding: 22 }} className="gd-body">
          {step === 1 && (
            <Step1
              employees={employees}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
            />
          )}
          {step === 2 && (
            <Step2
              template={template}
              customFields={templateCustomFields}
              selectedEmployees={selectedEmployees}
              customByEmp={customByEmp}
              setCustomByEmp={setCustomByEmp}
            />
          )}
          {step === 3 && (
            <Step3
              template={template}
              selectedEmployees={selectedEmployees}
              previews={previews}
            />
          )}
        </CardBody>

        <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }} className="gd-footer">
          <span style={{ fontSize: 12, color: '#6b7280' }} className="gd-step-counter">Step {step} of {STEPS.length}</span>
          <div className="d-flex gap-2">
            <button type="button" onClick={() => navigate('/hr/doc-templates')} disabled={saving || previewing}
              style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }} className="gd-cancel">
              Cancel
            </button>
            <button type="button" onClick={goBack} disabled={step === 1 || saving || previewing}
              style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: step === 1 ? '#9ca3af' : '#374151', cursor: step === 1 ? 'default' : 'pointer' }} className="gd-back">
              ← Back
            </button>
            {step < 3 ? (
              <button type="button" onClick={goNext} disabled={previewing}
                style={{ padding: '8px 18px', background: PRIMARY_GRADIENT, border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: PRIMARY_GLOW }}>
                {previewing ? 'Building preview…' : 'Next →'}
              </button>
            ) : (
              <>
                {/* Send the customised doc straight into the signing workflow
                    (preserves the custom values filled in this wizard). Styled
                    Tooltip to match the doc-templates list action column. */}
                <Tooltip label="Send into the configured signing workflow for the selected employee(s)">
                  <button type="button" onClick={onSendForSignature} disabled={saving || sending}
                    style={{ padding: '8px 18px', background: '#fff', border: '2px solid #7c3aed', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#7c3aed', cursor: (saving || sending) ? 'default' : 'pointer', opacity: (saving || sending) ? 0.6 : 1 }}>
                    <i className="ri-quill-pen-line me-1" />{sending ? 'Sending…' : 'Send for Signature'}
                  </button>
                </Tooltip>
                {/* Generate + download the document(s) in one click. */}
                <Tooltip label="Generate and download the document(s) right away">
                  <button type="button" onClick={onDownload} disabled={saving || sending}
                    style={{ padding: '8px 18px', background: '#fff', border: '2px solid #7c3aed', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#7c3aed', cursor: (saving || sending) ? 'default' : 'pointer', opacity: (saving || sending) ? 0.6 : 1 }}>
                    <i className="ri-download-2-line me-1" />{saving ? 'Working…' : `Download document${selectedEmployees.length === 1 ? '' : 's'}`}
                  </button>
                </Tooltip>
                <button type="button" onClick={onGenerate} disabled={saving || sending}
                  style={{ padding: '8px 22px', background: PRIMARY_GRADIENT, border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: (saving || sending) ? 'default' : 'pointer', boxShadow: PRIMARY_GLOW, opacity: (saving || sending) ? 0.6 : 1 }}>
                  <i className="ri-file-add-line me-1" />{saving ? 'Generating…' : `Generate ${selectedEmployees.length} document${selectedEmployees.length === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Step indicator — connector-line stepper on a white strip ─────────────────
function StepStrip({ step }: { step: number }) {
  return (
    <div className="gd-stepper">
      {STEPS.map((s, i) => {
        const active = step === s.key;
        const done   = step > s.key;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={s.key} className="gd-stepper-frag">
            <div className={`gd-stepper-item${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
              <span className="gd-stepper-circle">
                {done ? <i className="ri-check-line" /> : s.key}
              </span>
              <div className="gd-stepper-label">
                <div className="gd-stepper-title">{s.label}</div>
                <div className="gd-stepper-sub">{s.sub}</div>
              </div>
            </div>
            {!isLast && <div className={`gd-stepper-line${done ? ' is-done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Select Employees ────────────────────────────────────────────────
function Step1(props: {
  employees: EmployeeRow[];
  selectedIds: Set<number>;
  setSelectedIds: (s: Set<number>) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return props.employees;
    return props.employees.filter(e => {
      const name = `${e.first_name ?? ''} ${e.last_name ?? ''}`.toLowerCase();
      return name.includes(needle)
        || (e.emp_code || '').toLowerCase().includes(needle)
        || (e.email || '').toLowerCase().includes(needle)
        || (e.department?.name || '').toLowerCase().includes(needle);
    });
  }, [props.employees, search]);

  // 5-per-page pagination over the (search-filtered) employee list.
  const PER_PAGE = 5;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const allChecked = filtered.length > 0 && filtered.every(e => props.selectedIds.has(e.id));
  const toggleAll = () => {
    const next = new Set(props.selectedIds);
    if (allChecked) filtered.forEach(e => next.delete(e.id));
    else            filtered.forEach(e => next.add(e.id));
    props.setSelectedIds(next);
  };
  const toggleOne = (id: number) => {
    const next = new Set(props.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    props.setSelectedIds(next);
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <h5 className="fw-bold mb-0 gd-title">Select Employees</h5>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: 999 }}>
          {props.selectedIds.size} selected
        </span>
      </div>

      <div style={{ position: 'relative', marginBottom: 12, maxWidth: 360 }}>
        <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
        <Input type="text" placeholder="Search by name, code, email…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ paddingLeft: 32, height: 36 }} className="gd-search" />
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }} className="gd-table-wrap">
        <div style={{ background: '#f5f3ff', padding: '10px 14px', display: 'grid', gridTemplateColumns: '56px 32px 1fr 140px 160px 160px', gap: 12, fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase' }} className="gd-table-head">
          <div>Sr No</div>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor: 'pointer' }} />
          <div>Employee</div>
          <div>Code</div>
          <div>Department</div>
          <div>Designation</div>
        </div>
        <div>
          {filtered.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
              No employees match.
            </div>
          ) : pageRows.map((e, i) => {
            const checked = props.selectedIds.has(e.id);
            const name = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || `Employee #${e.id}`;
            return (
              <label key={e.id} className="gd-row"
                style={{ display: 'grid', gridTemplateColumns: '56px 32px 1fr 140px 160px 160px', gap: 12, padding: '10px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                  background: checked ? '#eef2ff' : '#fff', alignItems: 'center', cursor: 'pointer' }}>
                <div className="gd-row-cell" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280' }}>{(safePage - 1) * PER_PAGE + i + 1}</div>
                <input type="checkbox" checked={checked} onChange={() => toggleOne(e.id)} style={{ cursor: 'pointer' }} />
                <div>
                  <div style={{ fontWeight: 700, color: '#1f2937' }} className="gd-row-name">{name}</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280' }} className="gd-row-sub">{e.email || '—'}</div>
                </div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151', fontFamily: 'monospace' }}>{e.emp_code || '—'}</div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151' }}>{e.department?.name || '—'}</div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151' }}>{e.designation?.name || '—'}</div>
              </label>
            );
          })}
        </div>
        {filtered.length > PER_PAGE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid #f1f5f9', background: '#fafafa' }} className="gd-pagination">
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                aria-label="Previous page"
                style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: safePage <= 1 ? 'not-allowed' : 'pointer', opacity: safePage <= 1 ? 0.5 : 1 }}>
                <i className="ri-arrow-left-s-line" />
              </button>
              <span style={{ minWidth: 44, textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: '#4338ca' }}>
                {safePage} / {totalPages}
              </span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                aria-label="Next page"
                style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: safePage >= totalPages ? 'not-allowed' : 'pointer', opacity: safePage >= totalPages ? 0.5 : 1 }}>
                <i className="ri-arrow-right-s-line" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 2: Fill Variables ───────────────────────────────────────────────────
// Only collects custom field values. Employee-derived tokens (FirstName,
// Email, JoiningDate, etc.) are resolved server-side at generate time and
// shown here as read-only token chips for reference.
function Step2(props: {
  template: TemplateRow;
  customFields: KnownTokens['custom_fields'];
  selectedEmployees: EmployeeRow[];
  customByEmp: Record<number, Record<string, string>>;
  setCustomByEmp: (next: Record<number, Record<string, string>>) => void;
}) {
  const { customFields, selectedEmployees, customByEmp, setCustomByEmp } = props;

  const setVal = (empId: number, name: string, val: string) => {
    setCustomByEmp({
      ...customByEmp,
      [empId]: { ...(customByEmp[empId] || {}), [name]: val },
    });
  };

  // Apply-to-all — value fans out to every selected recipient. Useful when
  // a custom field (e.g. EffectiveDate) has the same value for everyone.
  const applyToAll = (name: string, val: string) => {
    const next: Record<number, Record<string, string>> = { ...customByEmp };
    for (const e of selectedEmployees) {
      next[e.id] = { ...(next[e.id] || {}), [name]: val };
    }
    setCustomByEmp(next);
  };

  return (
    <div>
      <h5 className="fw-bold mb-1 gd-title">Fill Custom Variables</h5>
      <div className="text-muted mb-3 gd-subtle" style={{ fontSize: 12.5 }}>
        Auto-fetched fields are pre-filled. Enter custom values per employee below.
      </div>

      {customFields.length === 0 ? (
        <div style={{ borderRadius: 12, border: '1px dashed #c7d2fe', background: '#fafaff', padding: 18, textAlign: 'center', color: '#4338ca' }} className="gd-empty">
          <i className="ri-magic-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
          This template doesn't reference any custom fields. Click <strong>Next</strong> to preview.
        </div>
      ) : (
        <>
          {/* Apply-to-all bar — one input per custom field, value fans out to every recipient */}
          {selectedEmployees.length > 1 && (
            <section style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fafaff', padding: 14, marginBottom: 16 }} className="gd-apply-all">
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
                Apply to all recipients ({selectedEmployees.length})
              </div>
              <div className="row g-2">
                {customFields.map(cf => (
                  <div key={cf.id} className="col-md-6">
                    <label style={fieldLabel}>{cf.name}</label>
                    {cf.type === 'date' ? (
                      <MasterDatePicker
                        onChange={v => applyToAll(cf.name, v)}
                        placeholder={cf.description || `Sets {{${cf.name}}} for all`} />
                    ) : (
                      <input type={inputTypeFor(cf.type)}
                        onChange={e => applyToAll(cf.name, e.target.value)}
                        placeholder={cf.description || `Sets {{${cf.name}}} for all selected`}
                        style={inputStyle} className="gd-input" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Per-employee forms */}
          {selectedEmployees.map(emp => {
            const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || `Employee #${emp.id}`;
            const values = customByEmp[emp.id] || {};
            return (
              <section key={emp.id} style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', padding: 14, marginBottom: 12 }} className="gd-emp-card">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div>
                    <div style={{ fontWeight: 700, color: '#1f2937' }} className="gd-emp-name">{name}</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280' }} className="gd-emp-sub">{emp.emp_code || ''} · {emp.email || ''}</div>
                  </div>
                </div>
                <div className="row g-2">
                  {customFields.map(cf => (
                    <div key={cf.id} className="col-md-6">
                      <label style={fieldLabel}>{cf.name} <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>({cf.type})</span></label>
                      {cf.type === 'textarea' ? (
                        <textarea value={values[cf.name] || ''} onChange={e => setVal(emp.id, cf.name, e.target.value)}
                          rows={2} placeholder={cf.description || ''} style={{ ...inputStyle, resize: 'vertical' }} className="gd-input" />
                      ) : cf.type === 'date' ? (
                        <MasterDatePicker value={values[cf.name] || ''}
                          onChange={v => setVal(emp.id, cf.name, v)}
                          placeholder={cf.description || 'Select date'} />
                      ) : (
                        <input type={inputTypeFor(cf.type)} value={values[cf.name] || ''}
                          onChange={e => setVal(emp.id, cf.name, e.target.value)}
                          placeholder={cf.description || ''}
                          style={inputStyle} className="gd-input" />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

// Wrap any remaining {{Token}} text in the rendered HTML with a styled
// "unfilled placeholder" chip so the preview clearly flags what didn't
// resolve (custom fields the operator left blank, tokens the template
// references but our resolver doesn't know about, etc).
function decorateUnfilledTokens(html: string): string {
  return html.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_m, name) => `<span class="gd-unfilled" title="Unfilled placeholder — fill in Step 2 or it will appear as-is in the final document">${name}</span>`,
  );
}

// ── Step 3: Preview & Generate ───────────────────────────────────────────────
function Step3(props: {
  template: TemplateRow;
  selectedEmployees: EmployeeRow[];
  previews: Record<number, string>;
}) {
  const { template, selectedEmployees, previews } = props;
  const [openId, setOpenId] = useState<number | null>(selectedEmployees[0]?.id ?? null);

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h5 className="fw-bold mb-0 gd-title">Document Preview</h5>
          <div className="text-muted gd-subtle" style={{ fontSize: 12.5 }}>
            {selectedEmployees.length} document{selectedEmployees.length === 1 ? '' : 's'} will be generated when you click <strong>Generate</strong>.
            {' '}Unfilled placeholders are highlighted below.
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: 999 }}>
          {selectedEmployees.length} document{selectedEmployees.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {selectedEmployees.map(emp => {
          const open = openId === emp.id;
          const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || `Employee #${emp.id}`;
          const html = previews[emp.id] || '<p>(empty)</p>';
          return (
            <div key={emp.id} className="gd-preview-card">
              <button type="button" onClick={() => setOpenId(open ? null : emp.id)}
                className={`gd-preview-head${open ? ' is-open' : ''}`}>
                <span className="d-flex align-items-center gap-2">
                  <span className="gd-preview-pill"><i className="ri-file-text-line" /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{name}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.78)' }}>{template.name} · {template.code}</span>
                  </span>
                </span>
                <span style={{ fontSize: 11.5, opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff' }}>
                  <i className="ri-file-pdf-line" /> PDF Preview <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                </span>
              </button>
              {open && (
                <div className="gd-preview-stage">
                  <div className="gd-preview-paper">
                    <DocHeader cfg={template.header_config} />
                    <div className="gd-preview-body"
                      dangerouslySetInnerHTML={{ __html: decorateUnfilledTokens(html) }} />
                    <DocFooter cfg={template.footer_config} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Document header / footer ─────────────────────────────────────────────────
// These mirror the strips the operator configured in the Template Editor —
// drawn here on top of the preview paper (and round-tripped to DOCX by the
// template's own download endpoint).
function DocHeader({ cfg }: { cfg?: HeaderConfig | null }) {
  if (!cfg) return null;
  const showLogo  = cfg.show_logo  !== false;
  const showTitle = cfg.show_title !== false;
  const logoSrc = cfg.logo_url || (cfg.logo_path ? `/storage/${cfg.logo_path}` : null);
  const hasAnything = (showLogo && logoSrc) || (showTitle && (cfg.title || cfg.subtitle));
  if (!hasAnything) return null;
  return (
    <div className="gd-doc-header" style={{
      background: cfg.background || '#0f172a',
      color: cfg.text_color || '#fff',
    }}>
      {showLogo && logoSrc && (
        <img src={logoSrc} alt="Logo" className="gd-doc-logo"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      {showTitle && (cfg.title || cfg.subtitle) && (
        <div style={{ textAlign: cfg.align === 'left' ? 'left' : 'right', flex: 1 }}>
          {cfg.title    && <div className="gd-doc-title">{cfg.title}</div>}
          {cfg.subtitle && <div className="gd-doc-sub">{cfg.subtitle}</div>}
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
    <div className="gd-doc-footer" style={{
      background: cfg.background || '#fff',
      color: cfg.text_color || '#6b7280',
    }}>
      <div style={{ flex: 1, textAlign: align as any }}>{text}</div>
      {showPage && <div style={{ marginLeft: 12, textAlign: pageAlign as any }}>{pageLabel}</div>}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────
const headerGradient: React.CSSProperties = {
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)',
};
const PRIMARY_GRADIENT = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
const PRIMARY_GLOW     = '0 4px 12px rgba(99,102,241,0.30)';

const fieldLabel: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280',
  textTransform: 'uppercase', marginBottom: 6, display: 'block',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid #e5e7eb', fontSize: 13.5, background: '#fff', lineHeight: 1.4,
};
function inputTypeFor(t: string): string {
  return t === 'date' ? 'date' : (t === 'number' ? 'number' : 'text');
}

// Dark-mode + page-scoped CSS. Light mode is byte-for-byte unchanged.
function ScopedStyles() {
  return (
    <style>{`
      .gd-page .card { box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06); }
      .gd-page .gd-row { transition: background 140ms ease; }
      .gd-page .gd-row:hover { background: #eef2ff !important; }
      .gd-page .gd-success-row { transition: transform 160ms ease, box-shadow 160ms ease; }
      .gd-page .gd-success-row:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(99,102,241,0.12); }

      /* Preview cards — premium document feel */
      .gd-page .gd-preview-card {
        border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;
        background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,0.04);
        transition: box-shadow 200ms ease;
      }
      .gd-page .gd-preview-card:hover { box-shadow: 0 6px 18px rgba(99,102,241,0.10); }
      .gd-page .gd-preview-head {
        width: 100%; padding: 14px 18px; border: 0;
        background: linear-gradient(135deg, #312e81 0%, #4338ca 60%, #6366f1 100%);
        color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        transition: filter 180ms ease;
      }
      .gd-page .gd-preview-head:hover { filter: brightness(1.08); }
      .gd-page .gd-preview-head.is-open { box-shadow: inset 0 -1px 0 rgba(255,255,255,0.15); }
      .gd-page .gd-preview-pill {
        width: 30px; height: 30px; border-radius: 8px;
        background: rgba(255,255,255,0.18);
        display: inline-flex; align-items: center; justify-content: center;
        color: #fff; font-size: 15px;
      }
      .gd-page .gd-preview-stage {
        background: #f1f5f9; padding: 28px 18px;
      }
      .gd-page .gd-preview-paper {
        max-width: 760px; margin: 0 auto;
        background: #fff; border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04);
      }
      .gd-page .gd-preview-paper .gd-preview-body {
        padding: 40px 64px;
      }

      /* Document header strip — mirrors the template's header_config */
      .gd-page .gd-doc-header {
        display: flex; align-items: center; gap: 16px;
        padding: 18px 28px;
      }
      .gd-page .gd-doc-logo {
        max-height: 44px; max-width: 180px; object-fit: contain;
        background: rgba(255,255,255,0.06); border-radius: 6px;
      }
      .gd-page .gd-doc-title { font-weight: 800; font-size: 16px; letter-spacing: 0.2px; }
      .gd-page .gd-doc-sub   { font-size: 11.5px; opacity: 0.78; margin-top: 2px; }

      /* Document footer strip — mirrors the template's footer_config */
      .gd-page .gd-doc-footer {
        display: flex; align-items: center;
        padding: 12px 28px;
        font-size: 11.5px;
        border-top: 1px solid #e5e7eb;
      }
      .gd-page .gd-preview-body {
        font-size: 14px; line-height: 1.75; color: #1f2937;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .gd-page .gd-preview-body p { margin: 0 0 12px; }
      .gd-page .gd-preview-body h1 { font-size: 22px; font-weight: 800; color: #111827; margin: 16px 0 10px; }
      .gd-page .gd-preview-body h2 { font-size: 18px; font-weight: 800; color: #111827; margin: 14px 0 8px; }
      .gd-page .gd-preview-body h3 { font-size: 15px; font-weight: 700; color: #111827; margin: 12px 0 6px; }
      .gd-page .gd-preview-body ul,
      .gd-page .gd-preview-body ol { padding-left: 24px; margin: 0 0 12px; }
      .gd-page .gd-preview-body strong { color: #111827; }
      .gd-page .gd-preview-body hr { border: 0; border-top: 1px solid #e5e7eb; margin: 18px 0; }

      /* Unfilled placeholder — clearly marked but still readable in flow */
      .gd-page .gd-unfilled {
        display: inline-block;
        background: linear-gradient(135deg, #fef3c7, #fde68a);
        color: #92400e;
        padding: 1px 8px;
        margin: 0 1px;
        border-radius: 4px;
        border: 1px dashed #f59e0b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.92em;
        font-weight: 700;
        line-height: 1.4;
        white-space: nowrap;
      }

      /* Stepper — circle-and-line wizard indicator. White strip below header. */
      .gd-page .gd-stepper {
        display: flex; align-items: center; padding: 18px 22px;
        background: #fff; border-top: 1px solid #f1f5f9;
      }
      .gd-page .gd-stepper-frag { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
      .gd-page .gd-stepper-frag:last-child { flex: 0 0 auto; }
      .gd-page .gd-stepper-item {
        display: flex; align-items: center; gap: 10px; flex-shrink: 0;
      }
      .gd-page .gd-stepper-circle {
        width: 32px; height: 32px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: #e5e7eb; color: #9ca3af;
        font-size: 13px; font-weight: 800;
        transition: background 200ms ease, color 200ms ease, box-shadow 200ms ease;
      }
      .gd-page .gd-stepper-item.is-done .gd-stepper-circle {
        background: #818cf8; color: #fff;
      }
      .gd-page .gd-stepper-item.is-active .gd-stepper-circle {
        background: #6366f1; color: #fff;
        box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.18);
      }
      .gd-page .gd-stepper-title {
        font-size: 12.5px; font-weight: 700; color: #6b7280; line-height: 1.2;
      }
      .gd-page .gd-stepper-item.is-active .gd-stepper-title { color: #4338ca; }
      .gd-page .gd-stepper-item.is-done .gd-stepper-title { color: #4338ca; }
      .gd-page .gd-stepper-sub {
        font-size: 10.5px; color: #9ca3af; margin-top: 1px;
      }
      .gd-page .gd-stepper-line {
        flex: 1 1 auto; height: 2px; margin: 0 14px; background: #e5e7eb;
        transition: background 200ms ease; border-radius: 2px;
      }
      .gd-page .gd-stepper-line.is-done { background: #818cf8; }

      /* Action button polish — match TemplateForm hover treatment */
      .gd-page .gd-cancel,
      .gd-page .gd-back { transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }
      .gd-page .gd-cancel:hover:not(:disabled),
      .gd-page .gd-back:hover:not(:disabled) {
        background: #f9fafb !important; border-color: #c7d2fe !important; color: #4338ca !important;
      }

      /* Dark-mode stepper */
      [data-bs-theme="dark"] .gd-page .gd-stepper,
      [data-layout-mode="dark"] .gd-page .gd-stepper {
        background: #1f2937 !important; border-top-color: rgba(255,255,255,0.06) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-stepper-circle,
      [data-layout-mode="dark"] .gd-page .gd-stepper-circle {
        background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.55);
      }
      [data-bs-theme="dark"] .gd-page .gd-stepper-title,
      [data-layout-mode="dark"] .gd-page .gd-stepper-title { color: rgba(255,255,255,0.55); }
      [data-bs-theme="dark"] .gd-page .gd-stepper-item.is-active .gd-stepper-title,
      [data-bs-theme="dark"] .gd-page .gd-stepper-item.is-done .gd-stepper-title,
      [data-layout-mode="dark"] .gd-page .gd-stepper-item.is-active .gd-stepper-title,
      [data-layout-mode="dark"] .gd-page .gd-stepper-item.is-done .gd-stepper-title { color: #c7d2fe; }
      [data-bs-theme="dark"] .gd-page .gd-stepper-sub,
      [data-layout-mode="dark"] .gd-page .gd-stepper-sub { color: rgba(255,255,255,0.40); }
      [data-bs-theme="dark"] .gd-page .gd-stepper-line,
      [data-layout-mode="dark"] .gd-page .gd-stepper-line { background: rgba(255,255,255,0.10); }
      [data-bs-theme="dark"] .gd-page .gd-stepper-line.is-done,
      [data-layout-mode="dark"] .gd-page .gd-stepper-line.is-done { background: #818cf8; }

      [data-bs-theme="dark"] .gd-page .card,
      [data-layout-mode="dark"] .gd-page .card { background: #1f2937; border-color: rgba(255,255,255,0.08); }
      [data-bs-theme="dark"] .gd-page .gd-body,
      [data-layout-mode="dark"] .gd-page .gd-body { background: #1f2937; }
      [data-bs-theme="dark"] .gd-page .gd-footer,
      [data-layout-mode="dark"] .gd-page .gd-footer { background: #111827 !important; border-top-color: rgba(255,255,255,0.08) !important; }
      /* Step-1 table pagination strip — was a hardcoded light #fafafa (BUG-113). */
      [data-bs-theme="dark"] .gd-page .gd-pagination,
      [data-layout-mode="dark"] .gd-page .gd-pagination { background: #111827 !important; border-top-color: rgba(255,255,255,0.08) !important; }
      [data-bs-theme="dark"] .gd-page .gd-pagination span,
      [data-layout-mode="dark"] .gd-page .gd-pagination span { color: rgba(255,255,255,0.70) !important; }
      [data-bs-theme="dark"] .gd-page .gd-pagination button,
      [data-layout-mode="dark"] .gd-page .gd-pagination button { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; color: #cbd5e1 !important; }
      [data-bs-theme="dark"] .gd-page .gd-step-counter,
      [data-layout-mode="dark"] .gd-page .gd-step-counter { color: rgba(255,255,255,0.6); }
      [data-bs-theme="dark"] .gd-page .gd-cancel,
      [data-bs-theme="dark"] .gd-page .gd-back,
      [data-layout-mode="dark"] .gd-page .gd-cancel,
      [data-layout-mode="dark"] .gd-page .gd-back {
        background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.10) !important; color: #e2e8f0 !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-title,
      [data-layout-mode="dark"] .gd-page .gd-title { color: #f1f5f9; }
      [data-bs-theme="dark"] .gd-page .gd-subtle,
      [data-layout-mode="dark"] .gd-page .gd-subtle { color: rgba(255,255,255,0.6) !important; }
      [data-bs-theme="dark"] .gd-page .gd-search,
      [data-bs-theme="dark"] .gd-page .gd-input,
      [data-layout-mode="dark"] .gd-page .gd-search,
      [data-layout-mode="dark"] .gd-page .gd-input {
        background: #0f172a !important; border-color: rgba(255,255,255,0.10) !important; color: #f1f5f9 !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-search::placeholder,
      [data-bs-theme="dark"] .gd-page .gd-input::placeholder,
      [data-layout-mode="dark"] .gd-page .gd-search::placeholder,
      [data-layout-mode="dark"] .gd-page .gd-input::placeholder { color: rgba(255,255,255,0.35) !important; }
      [data-bs-theme="dark"] .gd-page .gd-table-wrap,
      [data-layout-mode="dark"] .gd-page .gd-table-wrap { border-color: rgba(255,255,255,0.08) !important; }
      [data-bs-theme="dark"] .gd-page .gd-table-head,
      [data-layout-mode="dark"] .gd-page .gd-table-head { background: rgba(99,102,241,0.12) !important; color: rgba(255,255,255,0.65) !important; }
      [data-bs-theme="dark"] .gd-page .gd-row,
      [data-layout-mode="dark"] .gd-page .gd-row { background: #1f2937 !important; border-top-color: rgba(255,255,255,0.06) !important; }
      [data-bs-theme="dark"] .gd-page .gd-row:hover,
      [data-layout-mode="dark"] .gd-page .gd-row:hover { background: rgba(99,102,241,0.14) !important; }
      [data-bs-theme="dark"] .gd-page .gd-row-name,
      [data-layout-mode="dark"] .gd-page .gd-row-name { color: #f1f5f9 !important; }
      [data-bs-theme="dark"] .gd-page .gd-row-sub,
      [data-bs-theme="dark"] .gd-page .gd-row-cell,
      [data-layout-mode="dark"] .gd-page .gd-row-sub,
      [data-layout-mode="dark"] .gd-page .gd-row-cell { color: rgba(255,255,255,0.7) !important; }
      [data-bs-theme="dark"] .gd-page .gd-autofetch,
      [data-layout-mode="dark"] .gd-page .gd-autofetch {
        background: rgba(16,185,129,0.10) !important; border-color: rgba(16,185,129,0.40) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-emp-card,
      [data-bs-theme="dark"] .gd-page .gd-apply-all,
      [data-layout-mode="dark"] .gd-page .gd-emp-card,
      [data-layout-mode="dark"] .gd-page .gd-apply-all {
        background: #1f2937 !important; border-color: rgba(255,255,255,0.08) !important;
      }
      /* Custom-variables empty/content box — was a hardcoded light #fafaff (BUG-114). */
      [data-bs-theme="dark"] .gd-page .gd-empty,
      [data-layout-mode="dark"] .gd-page .gd-empty {
        background: rgba(99,102,241,0.10) !important; border-color: rgba(129,140,248,0.40) !important; color: #c7d2fe !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-emp-name,
      [data-layout-mode="dark"] .gd-page .gd-emp-name { color: #f1f5f9 !important; }
      [data-bs-theme="dark"] .gd-page .gd-emp-sub,
      [data-layout-mode="dark"] .gd-page .gd-emp-sub { color: rgba(255,255,255,0.6) !important; }
      [data-bs-theme="dark"] .gd-page .gd-preview-card,
      [data-layout-mode="dark"] .gd-page .gd-preview-card {
        background: #1f2937 !important; border-color: rgba(255,255,255,0.08) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-preview-stage,
      [data-layout-mode="dark"] .gd-page .gd-preview-stage {
        background: #0f172a !important;
      }
      /* Document preview stays a light "paper" surface in dark mode — the
         rendered content_html carries author-defined (usually dark) text, so
         a dark paper made the document unreadable. Keep it white + dark text,
         like a real printed page / PDF preview. */
      [data-bs-theme="dark"] .gd-page .gd-preview-paper,
      [data-layout-mode="dark"] .gd-page .gd-preview-paper {
        background: #ffffff !important;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06);
      }
      [data-bs-theme="dark"] .gd-page .gd-preview-body,
      [data-layout-mode="dark"] .gd-page .gd-preview-body { color: #1f2937 !important; }
      [data-bs-theme="dark"] .gd-page .gd-preview-body h1,
      [data-bs-theme="dark"] .gd-page .gd-preview-body h2,
      [data-bs-theme="dark"] .gd-page .gd-preview-body h3,
      [data-bs-theme="dark"] .gd-page .gd-preview-body strong,
      [data-layout-mode="dark"] .gd-page .gd-preview-body h1,
      [data-layout-mode="dark"] .gd-page .gd-preview-body h2,
      [data-layout-mode="dark"] .gd-page .gd-preview-body h3,
      [data-layout-mode="dark"] .gd-page .gd-preview-body strong { color: #111827 !important; }
      [data-bs-theme="dark"] .gd-page .gd-preview-body hr,
      [data-layout-mode="dark"] .gd-page .gd-preview-body hr { border-top-color: #e5e7eb !important; }
      [data-bs-theme="dark"] .gd-page .gd-unfilled,
      [data-layout-mode="dark"] .gd-page .gd-unfilled {
        background: rgba(245, 158, 11, 0.18) !important;
        color: #fcd34d !important;
        border-color: rgba(245, 158, 11, 0.50) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-success-row,
      [data-layout-mode="dark"] .gd-page .gd-success-row { background: #1f2937 !important; border-color: rgba(255,255,255,0.08) !important; }
      [data-bs-theme="dark"] .gd-page .gd-success-name,
      [data-layout-mode="dark"] .gd-page .gd-success-name { color: #f1f5f9 !important; }
      [data-bs-theme="dark"] .gd-page .gd-success-sub,
      [data-layout-mode="dark"] .gd-page .gd-success-sub { color: rgba(255,255,255,0.65) !important; }
    `}</style>
  );
}
