import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Input } from 'reactstrap';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';
import { Shimmer } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';
import SearchClear from '../../../components/ui/SearchClear';

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
  // Designation tier + category the template was authored under — used to scope
  // the Step 1 recipient list (designation.level === role_type).
  role_type?: string;
  employee_category?: string;
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
  /** Already in the /employees payload (LIST_COLUMNS) — just never shown. */
  mobile?: string | null;
  department?: { id: number; name: string } | null;
  /** IT / Non-IT / Legal, resolved server-side from the department hierarchy. */
  document_category?: string | null;
  designation?: { id: number; name: string; level?: string | null } | null;
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

/* Does this employee fall under the template's category (IT / Non-IT / Legal)?
 *
 * The ANSWER COMES FROM THE SERVER (`document_category`, requested with
 * ?with_document_category=1). It is resolved there by App\Support * HrTemplateMatch, which walks the department's parent chain — so a "Software"
 * department created under "IT" is IT, which is what the department hierarchy
 * says and what HR expects. (#20)
 *
 * This screen used to decide it here instead, by exact-matching the department
 * name against 'it' / 'information technology'. Anything else — every child
 * department, and every IT department not named exactly that — was Non-IT, so
 * the employee never appeared in the recipient list for their own department's
 * template. The backend matcher meanwhile used substring hints and reached the
 * opposite answer for the same person: one rule, two implementations,
 * disagreeing.
 *
 * The name check survives only as a fallback for a response that predates the
 * field, and is deliberately the LOOSE substring form so it cannot contradict
 * the server on the common cases.
 */
function employeeMatchesCategory(
  emp: { document_category?: string | null; department?: { name: string } | null },
  category?: string,
): boolean {
  if (!category) return true;

  const served = (emp.document_category || '').trim();
  if (served) return served === category;

  const d = (emp.department?.name || '').trim().toLowerCase();
  if (!d) return category === 'Non-IT';
  const isLegal = ['legal', 'compliance', 'governance'].some(h => d.includes(h));
  const isIt    = !isLegal && ['it', 'information technology', 'tech', 'engineering', 'software',
    'devops', 'qa', 'mobile', 'data', 'product'].some(h => d.includes(h));
  switch (category) {
    case 'IT':     return isIt;
    case 'Legal':  return isLegal;
    case 'Non-IT': return !isIt && !isLegal;
    default:       return true; // unknown/legacy category → don't scope by department
  }
}

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
  /** employee_id → the live run they already have for THIS template. */
  const [alreadySent, setAlreadySent] = useState<Map<number, { id: number; status: string; code: string | null }>>(new Map());
  const [customByEmp, setCustomByEmp] = useState<Record<number, Record<string, string>>>({});
  const [previews, setPreviews] = useState<Record<number, string>>({});
  /** Resolved organisation name + logo per employee, from the preview
   *  endpoint. Replaces the template's placeholder letterhead. (#126) */
  const [letterheads, setLetterheads] = useState<Record<number, Letterhead>>({});
  const [previewing, setPreviewing] = useState(false);
  // Set once Next is refused on step 2, so the blank cells turn red (#64).
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [generated, setGenerated] = useState<GeneratedDoc[] | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const [tplRes, tokensRes, empRes, runsRes] = await Promise.all([
          api.get(`/hr-document-templates/${templateId}`),
          api.get('/hr-custom-fields/known-tokens').catch(() => ({ data: { employee: [], custom_fields: [] } })),
          // onboarded_only → only Active, fully-onboarded, non-disabled staff
          // are selectable (excludes exited / inactive / half-onboarded), the
          // same gate Recruitment's people-pickers use.
          // with_document_category → the server resolves IT / Non-IT / Legal
          // from the department HIERARCHY, so this screen does not have to
          // guess from the name. (#20)
          api.get('/employees', { params: { onboarded_only: 1, with_document_category: 1 } }),
          /* Who already has this document in flight.
             The backend refuses to create a second ACTIVE run for the same
             template + employee — it returns the existing one instead — so
             sending again does nothing but still reported success. The list
             has to know, or Step 1 keeps offering people who cannot receive
             anything and the confirmation afterwards is untrue. */
          api.get('/hr-document-signatures', { params: { template_id: templateId } }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setTemplate(tplRes.data as TemplateRow);
        setKnownTokens(tokensRes.data as KnownTokens);
        setEmployees(Array.isArray(empRes.data) ? empRes.data : (empRes.data?.data ?? []));

        const runs: any[] = Array.isArray(runsRes.data) ? runsRes.data : (runsRes.data?.data ?? []);
        const active = new Map<number, { id: number; status: string; code: string | null }>();
        for (const r of runs) {
          if (r?.status === 'Pending' || r?.status === 'In Progress') {
            active.set(Number(r.employee_id), { id: r.id, status: r.status, code: r.code ?? null });
          }
        }
        setAlreadySent(active);
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

  // Recipients are scoped to (1) the template's DEPARTMENT category
  // (IT/Non-IT/Legal → employee department) and (2) its designation level
  // (a template is built for a specific role tier, keyed on
  // designation.level === template.role_type). So Step 1 only offers employees
  // in the right department AND at the right level.
  //
  // Guard for legacy/un-seeded data: if NO employee carries the relevant field
  // at all, skip that filter rather than showing an empty picker. (An empty
  // result when the field IS populated is correct — it genuinely means no one
  // matches.)
  const eligibleEmployees = useMemo(() => {
    let list = employees;

    // (1) Department scope — the reported bug: an IT template must not surface
    // Non-IT staff, and vice-versa.
    const category = template?.employee_category;
    if (category) {
      const anyDept = employees.some(e => e.department?.name || e.document_category);
      if (anyDept) list = list.filter(e => employeeMatchesCategory(e, category));
    }

    // (2) Designation-level scope.
    const level = template?.role_type;
    if (level) {
      const anyLevels = list.some(e => e.designation?.level);
      if (anyLevels) list = list.filter(e => (e.designation?.level || '') === level);
    }

    return list;
  }, [employees, template?.role_type, template?.employee_category]);

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
      /* Every custom field is required (#64). A blank one reaches the document
         as a literal {{Token}} — the preview flags it, but nothing stopped the
         operator generating and sending it. */
      const missing: string[] = [];
      for (const emp of selectedEmployees) {
        const vals = customByEmp[emp.id] || {};
        const blanks = templateCustomFields
          .filter(cf => !String(vals[cf.name] ?? '').trim())
          .map(cf => cf.name);
        if (blanks.length) {
          const who = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || `Employee #${emp.id}`;
          missing.push(`${who}: ${blanks.join(', ')}`);
        }
      }
      if (missing.length) {
        setShowFieldErrors(true);
        toast.error(
          `Fill all ${templateCustomFields.length} field${templateCustomFields.length === 1 ? '' : 's'} for every recipient`,
          missing.slice(0, 3).join(' · ') + (missing.length > 3 ? ` · +${missing.length - 3} more` : ''),
        );
        return;
      }
      setShowFieldErrors(false);

      // Fetch a preview render per selected employee before showing step 3.
      setPreviewing(true);
      try {
        const out: Record<number, string> = {};
        const lh: Record<number, Letterhead> = {};
        for (const emp of selectedEmployees) {
          const { data } = await api.post('/hr-generated-documents/preview', {
            template_id: templateId,
            employee_id: emp.id,
            custom_values: customByEmp[emp.id] || {},
          });
          out[emp.id] = data?.rendered_html || '';
          /* Organisation the document is actually issued by, resolved per
             employee by the preview endpoint. The header/footer strips are
             drawn from the template's STORED header_config, which holds
             whatever its author's letterhead resolved to when it was written —
             often the literal words "Company Name" and no logo. Without this
             the strip asserted a company that does not exist and showed no
             logo, while the finished PDF carried the real ones. (#126) */
          lh[emp.id] = {
            company_name: String(data?.letterhead?.company_name ?? ''),
            logo_url:     data?.letterhead?.logo_url ?? null,
          };
        }
        setPreviews(out);
        setLetterheads(lh);
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
    let ok = 0; let fail = 0; let skipped = 0;
    try {
      for (const e of selectedEmployees) {
        /* Second line of defence. The list was read when the page opened, and
           someone else may have sent this document since — from the Evidence
           Vault, or from this page in another tab. The server would return the
           existing run with a 200, which the old count read as a success and
           reported as "sent", so the operator was told something happened that
           had not. Counted as skipped and named as such below. */
        if (alreadySent.has(e.id)) { skipped++; continue; }
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
        toast.success(
          'Sent for signature',
          `${ok} document(s) sent to the signing workflow`
          + (skipped ? ` · ${skipped} already sent` : '')
          + (fail ? ` · ${fail} failed` : '') + '.',
        );
        navigate('/hr/doc-templates');
      } else if (skipped > 0 && fail === 0) {
        toast.info('Already sent', `${skipped} selected employee(s) already have this document awaiting signature. Nothing new was sent.`);
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
          <div style={{ display: 'flex', gap: 16, padding: '14px 22px', borderBottom: '1px solid var(--shim-border, #e5e7eb)' }}>
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
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--shim-border, #eef2f7)', borderRadius: 10 }}>
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
          <div style={{ padding: 14, borderTop: '1px solid var(--shim-border, #e5e7eb)', background: 'var(--shim-secondary-bg, #f9fafb)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      <span className="gd-success-tick" style={{ width: 32, height: 32, borderRadius: 999, background: '#dcfce7', color: '#15803d', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <button type="button" onClick={() => navigate('/hr/doc-templates')} className="gd-cancel"
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
                {/* The three steps are the stepper's whole job, just below. */}
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  {template.name}{template.code ? ` · ${template.code}` : ''}
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
              employees={eligibleEmployees}
              roleType={template.role_type}
              category={template.employee_category}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              alreadySent={alreadySent}
            />
          )}
          {step === 2 && (
            <Step2
              template={template}
              customFields={templateCustomFields}
              selectedEmployees={selectedEmployees}
              customByEmp={customByEmp}
              setCustomByEmp={setCustomByEmp}
              showErrors={showFieldErrors}
            />
          )}
          {step === 3 && (
            <Step3
              template={template}
              selectedEmployees={selectedEmployees}
              previews={previews}
              letterheads={letterheads}
            />
          )}
        </CardBody>

        <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }} className="gd-footer">
          <span style={{ fontSize: 12, color: '#6b7280' }} className="gd-step-counter">Step {step} of {STEPS.length}</span>
          <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end">
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
                {/* Leaving / stepping back, then the two alternatives, then the
                    one thing this page is for. The alternatives used to wear a
                    2px purple border, which read as loud as the primary and
                    made the row a wall of five equal buttons. */}
                <span className="gd-foot-div" aria-hidden style={{ width: 1, alignSelf: 'stretch', background: '#e5e7eb', margin: '0 2px' }} />
                <Tooltip label="Send into the configured signing workflow for the selected employee(s)">
                  <button type="button" onClick={onSendForSignature} disabled={saving || sending} className="gd-outline-btn"
                    style={secondaryBtn(saving || sending)}>
                    <i className="ri-quill-pen-line me-1" style={{ color: '#7c3aed' }} />{sending ? 'Sending…' : 'Send for Signature'}
                  </button>
                </Tooltip>
                {/* Generate + download the document(s) in one click. */}
                <Tooltip label="Generate and download the document(s) right away">
                  <button type="button" onClick={onDownload} disabled={saving || sending} className="gd-outline-btn"
                    style={secondaryBtn(saving || sending)}>
                    <i className="ri-download-2-line me-1" style={{ color: '#7c3aed' }} />{saving ? 'Working…' : `Download document${selectedEmployees.length === 1 ? '' : 's'}`}
                  </button>
                </Tooltip>
                <button type="button" onClick={onGenerate} disabled={saving || sending}
                  style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 20px', background: PRIMARY_GRADIENT, border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: (saving || sending) ? 'default' : 'pointer', boxShadow: PRIMARY_GLOW, opacity: (saving || sending) ? 0.6 : 1, whiteSpace: 'nowrap' }}>
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
    <div className="gd-stepper-strip">
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
    </div>
  );
}

/* The head every step wears: icon tile, title, one line of purpose, and
 * whatever count belongs on the right. The three steps each opened with a bare
 * <h5> and their own idea of spacing, so the page changed shape at every Next.
 * Matches the Add / Edit Template wizard's card heads. */
function StepHead({ icon, title, sub, right }: { icon: string; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="gd-step-head d-flex align-items-center justify-content-between flex-wrap" style={{
      gap: 12, padding: '10px 14px', marginBottom: 14,
      background: '#f5f3ff', border: '1px solid #e9e7f5', borderRadius: 12,
    }}>
      <div className="d-flex align-items-center" style={{ gap: 12, minWidth: 0 }}>
        <span style={{
          width: 36, height: 36, borderRadius: 10, flex: '0 0 auto',
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, boxShadow: '0 2px 6px rgba(99,102,241,.35)',
        }}><i className={icon} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="gd-title" style={{ fontSize: 14.5, fontWeight: 800, color: '#111827', lineHeight: 1.25 }}>{title}</div>
          <div className="gd-subtle" style={{ fontSize: 11.5, color: '#9ca3af' }}>{sub}</div>
        </div>
      </div>
      {right}
    </div>
  );
}

/* A footer action that is not THE action: quiet border, dark label, colour
 * carried by the icon alone, so only Generate is accented. */
function secondaryBtn(busy: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
    padding: '8px 16px', background: '#fff', border: '1px solid #ddd6fe',
    borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#4c1d95',
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
  };
}

// ── Step 1: Select Employees ────────────────────────────────────────────────
function Step1(props: {
  employees: EmployeeRow[];
  roleType?: string;
  category?: string;
  selectedIds: Set<number>;
  setSelectedIds: (s: Set<number>) => void;
  /** employee_id -> the live run they already hold for this template. */
  alreadySent: Map<number, { id: number; status: string; code: string | null }>;
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

  /* Select-all works on the people who can actually receive the document.
     Counting the locked ones would leave the box unchecked forever (they can
     never be selected), and adding them would put recipients into the list
     that the send silently drops. */
  const selectable = filtered.filter(e => !props.alreadySent.has(e.id));
  const allChecked = selectable.length > 0 && selectable.every(e => props.selectedIds.has(e.id));
  const toggleAll = () => {
    const next = new Set(props.selectedIds);
    if (allChecked) selectable.forEach(e => next.delete(e.id));
    else            selectable.forEach(e => next.add(e.id));
    props.setSelectedIds(next);
  };
  const toggleOne = (id: number) => {
    if (props.alreadySent.has(id)) return;
    const next = new Set(props.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    props.setSelectedIds(next);
  };

  return (
    <div>
      <StepHead icon="ri-team-line" title="Select Employees" sub={STEPS[0].sub}
        right={
          <span className="gd-count-badge" style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: 999 }}>
            {props.selectedIds.size} selected
          </span>
        } />

      {/* Scope hint — the list is filtered to the template's designation level
          (and IT/Non-IT/Legal category it was authored under) so only eligible
          recipients appear. */}
      {(props.roleType || props.category) && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }} className="gd-scope-hint">
          <i className="ri-filter-3-line me-1" style={{ color: '#8b5cf6' }} />
          Showing {props.category ? <><strong style={{ color: '#4338ca' }}>{props.category}</strong> employees</> : 'employees'}
          {props.roleType ? <> at the <strong style={{ color: '#4338ca' }}>{props.roleType}</strong> level</> : null}.
        </div>
      )}

      <div className="ui-search-abs" style={{ position: 'relative', marginBottom: 12, maxWidth: 360 }}>
        <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
        <Input autoComplete="off" type="text" placeholder="Search by name, code, email…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ paddingLeft: 32, height: 36 }} className="gd-search" />
          <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }} className="gd-table-wrap">
        <div style={{ background: '#f5f3ff', padding: '10px 14px', display: 'grid', gridTemplateColumns: '52px 32px 2fr 104px 1.4fr 124px 0.9fr 0.9fr', gap: 12, fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase' }} className="gd-table-head">
          <div>Sr No</div>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor: 'pointer' }} />
          <div>Employee</div>
          <div style={{ textAlign: 'center' }}>Emp Code</div>
          <div>Email</div>
          <div style={{ textAlign: 'center' }}>Phone</div>
          <div style={{ textAlign: 'center' }}>Department</div>
          <div style={{ textAlign: 'center' }}>Designation</div>
        </div>
        <div>
          {filtered.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
              {search.trim()
                ? 'No employees match your search.'
                : props.roleType
                  ? `No onboarded employees at the ${props.roleType} level. Assign this designation level to employees in HR → Employees, or in Master → Designations.`
                  : 'No employees available.'}
            </div>
          ) : pageRows.map((e, i) => {
            const checked = props.selectedIds.has(e.id);
            const name = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || `Employee #${e.id}`;
            /* This person already has a live run for this template. The server
               will not create a second one, so offering them again would send
               nothing and still report success. Locked out here instead, with
               the reason on the row rather than hidden in a tooltip. */
            const sentRun = props.alreadySent.get(e.id);
            return (
              <label key={e.id} className="gd-row"
                title={sentRun ? 'Already sent to this employee — waiting on the signers.' : undefined}
                style={{ display: 'grid', gridTemplateColumns: '52px 32px 2fr 104px 1.4fr 124px 0.9fr 0.9fr', gap: 12, padding: '10px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                  background: sentRun ? '#f9fafb' : checked ? '#eef2ff' : '#fff', alignItems: 'center',
                  cursor: sentRun ? 'not-allowed' : 'pointer', opacity: sentRun ? 0.65 : 1 }}>
                <div className="gd-row-cell" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280' }}>{(safePage - 1) * PER_PAGE + i + 1}</div>
                <input type="checkbox" checked={checked} disabled={!!sentRun} onChange={() => toggleOne(e.id)} style={{ cursor: sentRun ? 'not-allowed' : 'pointer' }} />
                <div>
                  <div style={{ fontWeight: 700, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} className="gd-row-name">
                    {name}
                    {sentRun && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: '#92400e', background: '#fef3c7',
                        border: '1px solid #fde68a', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                        Already sent{sentRun.code ? ` · ${sentRun.code}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="gd-row-cell" style={{ textAlign: 'center' }}>
                  {/* A badge, not bare text: the code is an identifier and was
                      the one monospace run floating in a row of prose. */}
                  <span className="gd-code-badge" style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#4338ca', background: '#eef2ff', border: '1px solid #e0e7ff', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>
                    {e.emp_code || '—'}
                  </span>
                </div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.email || undefined}>{e.email || '—'}</div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151', whiteSpace: 'nowrap', textAlign: 'center' }}>{e.mobile || '—'}</div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151', textAlign: 'center' }}>{e.department?.name || '—'}</div>
                <div className="gd-row-cell" style={{ fontSize: 12.5, color: '#374151', textAlign: 'center' }}>{e.designation?.name || '—'}</div>
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
  /** Next was refused — outline the cells that are still blank. */
  showErrors?: boolean;
}) {
  const { customFields, selectedEmployees, customByEmp, setCustomByEmp, showErrors } = props;

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 5;
  // Shut by default once the apply-to-all block would be taller than the table.
  const [applyOpen, setApplyOpen] = useState(customFields.length <= 4);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return selectedEmployees;
    return selectedEmployees.filter(e => {
      const name = `${e.first_name ?? ''} ${e.last_name ?? ''}`.toLowerCase();
      return name.includes(needle)
        || (e.emp_code || '').toLowerCase().includes(needle)
        || (e.email || '').toLowerCase().includes(needle);
    });
  }, [selectedEmployees, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  /* Sr No + Employee, then one column per custom field. minWidth keeps the
     inputs usable when a template carries several fields — the wrapper
     scrolls sideways rather than squeezing every column to nothing. */
  const gridCols = `56px minmax(200px, 1.6fr) ${customFields.map(() => 'minmax(160px, 1fr)').join(' ')}`;
  const gridMinWidth = 56 + 200 + customFields.length * 160 + (customFields.length + 2) * 12 + 28;

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
      <StepHead icon="ri-input-cursor-move" title="Fill Custom Variables"
        sub="Auto-fetched fields are pre-filled — enter the custom values per employee"
        right={
          customFields.length > 0 ? (
            <span className="gd-count-badge" style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: 999 }}>
              {customFields.length} field{customFields.length === 1 ? '' : 's'}
            </span>
          ) : undefined
        } />

      {customFields.length === 0 ? (
        <div style={{ borderRadius: 12, border: '1px dashed #c7d2fe', background: '#fafaff', padding: 18, textAlign: 'center', color: '#4338ca' }} className="gd-empty">
          <i className="ri-magic-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
          This template doesn't reference any custom fields. Click <strong>Next</strong> to preview.
        </div>
      ) : (
        <>
          {/* Apply-to-all bar — one input per custom field, value fans out to every recipient */}
          {selectedEmployees.length > 1 && (
            <section style={gdCard} className="gd-apply-all">
              {/* Collapsible, and shut by default past four fields: fourteen of
                  them filled the screen and pushed the recipient table, which
                  is the actual work, below the fold. */}
              <button type="button" onClick={() => setApplyOpen(o => !o)}
                style={{ ...gdCardHead, width: '100%', border: 0, textAlign: 'left', cursor: 'pointer' }}
                className="gd-card-head" aria-expanded={applyOpen}>
                <span style={gdHeadTile}><i className="ri-stack-line" /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gd-card-head-title" style={{ fontSize: 14.5, fontWeight: 800, lineHeight: 1.25 }}>
                    Apply to all recipients
                  </div>
                  <div className="gd-card-head-sub" style={{ fontSize: 11.5, color: '#9ca3af' }}>
                    Set a value once and it fans out to all {selectedEmployees.length} recipients
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {customFields.length} field{customFields.length === 1 ? '' : 's'}
                </span>
                <i className={applyOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}
                  style={{ fontSize: 20, color: '#6b7280' }} />
              </button>
              <div className="row g-2 gd-card-body" style={{ ...gdCardBody, display: applyOpen ? undefined : 'none' }}>
                {customFields.map(cf => (
                  <div key={cf.id} className="col-xl-3 col-lg-4 col-md-6">
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

          {/* Per-employee values — a table, not a stack of cards. One card per
              recipient meant a 100-person run was a 100-screen scroll with no
              way to find anyone; this is the same grid + pager as Step 1. */}
          <div className="ui-search-abs" style={{ position: 'relative', marginBottom: 12, maxWidth: 360 }}>
            <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <Input autoComplete="off" type="text" placeholder="Search by name, code, email…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ paddingLeft: 32, height: 36 }} className="gd-search" />
            <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }} className="gd-table-wrap gd-vars-table">
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: gridMinWidth }}>
                <div style={{ background: '#f5f3ff', padding: '10px 14px', display: 'grid', gridTemplateColumns: gridCols, gap: 12, fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase' }} className="gd-table-head">
                  <div>Sr No</div>
                  <div>Employee</div>
                  {customFields.map(cf => (
                    <div key={cf.id}>
                      {cf.name} <span style={{ color: '#ef4444' }}>*</span>{' '}
                      <span style={{ fontWeight: 600, color: '#9ca3af' }}>({cf.type})</span>
                    </div>
                  ))}
                </div>
                <div>
                  {filtered.length === 0 ? (
                    <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                      <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
                      No recipients match your search.
                    </div>
                  ) : pageRows.map((emp, i) => {
                    const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || `Employee #${emp.id}`;
                    const values = customByEmp[emp.id] || {};
                    return (
                      <div key={emp.id} className="gd-row"
                        style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '10px 14px',
                          borderTop: i === 0 ? 'none' : '1px solid #f1f5f9', background: '#fff', alignItems: 'center' }}>
                        <div className="gd-row-cell" style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280' }}>
                          {(safePage - 1) * PER_PAGE + i + 1}
                        </div>
                        <div className="d-flex align-items-center" style={{ gap: 10, minWidth: 0 }}>
                          <span style={gdAvatarTile} className="gd-emp-avatar">{initialsOf(name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 13 }} className="gd-emp-name">{name}</div>
                            <div style={{ fontSize: 11.5, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              className="gd-emp-sub" title={emp.email || undefined}>
                              {emp.emp_code || '—'} · {emp.email || '—'}
                            </div>
                          </div>
                        </div>
                        {customFields.map(cf => (
                          <div key={cf.id} style={{ minWidth: 0 }}
                            className={showErrors && !String(values[cf.name] ?? '').trim() ? 'gd-cell gd-cell--err' : 'gd-cell'}>
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
                    );
                  })}
                </div>
              </div>
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
  /** Per-employee letterhead, resolved by the parent. Step 3 read the parent's
   *  state directly, which is not in its scope — the preview threw on open. */
  letterheads: Record<number, Letterhead>;
}) {
  const { template, selectedEmployees, previews, letterheads } = props;
  /* One paper, one recipient at a time. The accordion drew a card per employee
     and each opened its own copy of the page, so ten recipients meant ten
     stacked A4 sheets to scroll past; picking a name now just re-renders the
     one sheet. */
  const [activeId, setActiveId] = useState<number | null>(selectedEmployees[0]?.id ?? null);
  // The selection can shrink on Back, taking the active row with it.
  const active = selectedEmployees.find(e => e.id === activeId) ?? selectedEmployees[0] ?? null;
  const empName = (e: EmployeeRow) =>
    (e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || `Employee #${e.id}`;

  return (
    <div>
      <StepHead icon="ri-file-search-line" title="Document Preview"
        sub="Generate writes these documents — unfilled placeholders are highlighted"
        right={
          <span className="gd-count-badge" style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#e0e7ff', padding: '4px 10px', borderRadius: 999 }}>
            {selectedEmployees.length} document{selectedEmployees.length === 1 ? '' : 's'}
          </span>
        } />

      <div className="row g-3">
        {/* Recipients */}
        <div className="col-lg-4 col-xl-3">
          <div className="gd-rcpt-card" style={{ border: '1px solid #e9e7f5', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <div className="gd-rcpt-head" style={{ padding: '9px 12px', background: '#f5f3ff', borderBottom: '1px solid #e9e7f5', fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280' }}>
              <i className="ri-team-line me-1" />Recipients
            </div>
            {/* Capped so a long selection scrolls the list, not the page — the
                paper beside it has to stay in view to be worth previewing. */}
            <div className="gd-rcpt-list" style={{ maxHeight: 520, overflowY: 'auto', padding: 8 }}>
              {selectedEmployees.map(emp => {
                const on = active?.id === emp.id;
                return (
                  <button key={emp.id} type="button" onClick={() => setActiveId(emp.id)}
                    className={`gd-rcpt${on ? ' is-active' : ''}`}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
                      padding: '8px 10px', marginBottom: 4, borderRadius: 9, cursor: 'pointer',
                      border: '1px solid ' + (on ? '#c7d2fe' : 'transparent'),
                      background: on ? '#eef2ff' : 'transparent',
                    }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%', flex: '0 0 auto',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800,
                      background: on ? '#6366f1' : '#eef2f7', color: on ? '#fff' : '#94a3b8',
                    }}>{empName(emp).slice(0, 1).toUpperCase()}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="gd-rcpt-name" style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: on ? '#4338ca' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{empName(emp)}</span>
                      <span className="gd-rcpt-sub" style={{ display: 'block', fontSize: 10.5, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.emp_code || emp.email || '—'}</span>
                    </span>
                    {on && <i className="ri-arrow-right-s-line" style={{ color: '#6366f1', flex: '0 0 auto' }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* The one sheet, for whoever is picked */}
        <div className="col-lg-8 col-xl-9">
          {active ? (
            <div className="gd-preview-card">
              <div className="gd-preview-head is-open" style={{ cursor: 'default' }}>
                <span className="d-flex align-items-center gap-2">
                  <span className="gd-preview-pill"><i className="ri-file-text-line" /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{empName(active)}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.78)' }}>{template.name} · {template.code}</span>
                  </span>
                </span>
                <span style={{ fontSize: 11.5, opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff' }}>
                  <i className="ri-file-pdf-line" /> PDF Preview
                </span>
              </div>
              <div className="gd-preview-stage">
                {/* Keyed by employee: without it React keeps the previous
                    sheet's DOM and only swaps the inner HTML, so a scrolled
                    preview stays scrolled when you pick the next person. */}
                <div className="gd-preview-paper" key={active.id}>
                  <DocHeader cfg={template.header_config} letterhead={letterheads[active.id]} />
                  <div className="gd-preview-body"
                    dangerouslySetInnerHTML={{ __html: decorateUnfilledTokens(previews[active.id] || '<p>(empty)</p>') }} />
                  <DocFooter cfg={template.footer_config} letterhead={letterheads[active.id]} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ border: '1px dashed #c7d2fe', borderRadius: 12, background: '#fafaff', padding: 28, textAlign: 'center', color: '#6b7280', fontSize: 12.5 }}>
              <i className="ri-user-search-line" style={{ fontSize: 22, display: 'block', marginBottom: 6, color: '#8b5cf6' }} />
              Pick a recipient on the left to see their document.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Document header / footer ─────────────────────────────────────────────────
// These mirror the strips the operator configured in the Template Editor —
// drawn here on top of the preview paper (and round-tripped to DOCX by the
// template's own download endpoint).
type Letterhead = { company_name: string; logo_url: string | null };

/* Swap the template's placeholder letterhead for the organisation this
 * document is actually issued by. (#126)
 *
 * A template stores whatever its author's letterhead resolved to when it was
 * written — and where that could not be resolved it stored the literal words
 * "Company Name" / "Company Name Pvt. Ltd.", or the {{CompanyName}} token.
 * Both reach this preview as plain text with nothing to resolve them, which is
 * why the strip read "Company Name · Confidential" for a document belonging to
 * a real branch. Mirrors the substitution the PDF blade performs, so the
 * preview and the sent document say the same thing.
 *
 * With no name resolvable the placeholder is DROPPED rather than printed, and
 * a stranded separator cleaned up, so the strip degrades to "Confidential"
 * instead of asserting a company that does not exist. */
function fillOrgName(text: string | null | undefined, orgName: string): string {
  let s = String(text ?? '');
  if (!s) return s;
  s = s.replace(/\{\{\s*CompanyName\s*\}\}/gi, orgName);
  // Longest first — "Company Name Pvt. Ltd." must not be half-replaced.
  s = s.replace(/Company Name Pvt\. Ltd\./gi, orgName).replace(/Company Name/gi, orgName);
  return s.replace(/\s*\|\s*\|\s*/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
}

function DocHeader({ cfg, letterhead }: { cfg?: HeaderConfig | null; letterhead?: Letterhead }) {
  if (!cfg) return null;
  const org = letterhead?.company_name ?? '';
  const showLogo  = cfg.show_logo  !== false;
  const showTitle = cfg.show_title !== false;
  /* Falls back to the employing branch's logo when the template carries none —
     the PDF already does this (headerLogoDataUri), so a preview with no logo
     was showing something the sent document would never look like. */
  const logoSrc = cfg.logo_url
    || (cfg.logo_path ? `/storage/${cfg.logo_path}` : null)
    || letterhead?.logo_url
    || null;
  const title    = fillOrgName(cfg.title, org);
  const subtitle = fillOrgName(cfg.subtitle, org);
  const hasAnything = (showLogo && logoSrc) || (showTitle && (title || subtitle));
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
      {showTitle && (title || subtitle) && (
        <div style={{ textAlign: cfg.align === 'left' ? 'left' : 'right', flex: 1 }}>
          {title    && <div className="gd-doc-title">{title}</div>}
          {subtitle && <div className="gd-doc-sub">{subtitle}</div>}
        </div>
      )}
    </div>
  );
}

function DocFooter({ cfg, letterhead }: { cfg?: FooterConfig | null; letterhead?: Letterhead }) {
  if (!cfg) return null;
  // Same substitution as the header — the footer is where
  // "Company Name Pvt. Ltd.  |  Confidential" lives. (#126)
  const text = fillOrgName(cfg.text, letterhead?.company_name ?? '').trim();
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

/* Card shell for the step bodies — the tinted head band + white body of the
   Add / Edit Template sections, so the two wizards read as one product. */
const gdCard: React.CSSProperties = {
  borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 12, overflow: 'hidden',
};
const gdCardHead: React.CSSProperties = {
  padding: '10px 14px', background: '#f5f3ff', borderBottom: '1px solid #e9e7f5',
  color: '#111827', display: 'flex', alignItems: 'center', gap: 12,
};
const gdCardBody: React.CSSProperties = { padding: 12, background: '#fff', margin: 0 };
const gdHeadTile: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, flex: '0 0 auto',
  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 17, boxShadow: '0 2px 6px rgba(99,102,241,.35)',
};
const gdAvatarTile: React.CSSProperties = {
  ...gdHeadTile, fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
};

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? '').join('').toUpperCase() || '?';
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
        font-family: var(--font-sans);
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
      /* max-width, not width:50% + min-width:580px (Bug #63). Between the
         992px breakpoint and ~1160px, 50% resolved BELOW the 580px floor, so
         the strip overflowed its own column while the items refused to shrink
         — the rail then ran under the next step's label. A max-width can only
         ever be smaller than the space available, so it cannot overflow. */
      /* The strip spans the card; the steps inside it take their natural width
         and sit left, so the rails stay short however wide the screen gets. */
      .gd-page .gd-stepper-strip { background: #fff; border-top: 1px solid #f1f5f9; }
      .gd-page .gd-stepper {
        display: flex; align-items: flex-start; padding: 14px 22px;
      }
      /* Natural width, not flex:1 1 0. Equal columns stretched the strip to
         whatever the page was wide and left the rails stranded in open space;
         the steps should sit together and the slack belongs on the right. */
      .gd-page .gd-stepper-frag { display: flex; align-items: flex-start; flex: 0 1 auto; min-width: 0; }
      /* flex 0 1 auto + min-width 0 lets a step give way when the strip is
         tight; flex-shrink:0 is what forced the overflow above. */
      .gd-page .gd-stepper-item {
        display: flex; align-items: center; gap: 10px; flex: 0 1 auto; min-width: 0;
      }
      .gd-page .gd-stepper-label { min-width: 0; }
      .gd-page .gd-stepper-title,
      .gd-page .gd-stepper-sub {
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .gd-page .gd-stepper-circle {
        width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
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
      /* A fixed rail, centred in whatever space the step leaves.
         flex: 1 1 auto made the rail soak up the slack in its own column,
         and the three steps are not the same width — "Select Employees" is
         210px against "Fill Variables" at 224 — so the rails came out 39px
         and 25px. The columns were evenly spaced all along (277 and 276), but
         the eye reads the rails, not the columns, so the strip looked
         crooked. A fixed 30px rail with auto margins is identical between
         every pair, and the slack goes to the margins instead. */
      /* margin-top 15px pins the rail to the CIRCLE's centre (32/2 − 1 for the
         rail's own height) instead of centring it on the whole item. The item
         is circle + two lines of label, so a label that wraps dragged the rail
         downward into the neighbouring step's text — the overlap in Bug #63. */
      .gd-page .gd-stepper-line {
        flex: 0 0 40px; height: 2px; margin: 15px 18px 0; background: #e5e7eb;
        transition: background 200ms ease; border-radius: 2px;
      }
      .gd-page .gd-stepper-line.is-done { background: #818cf8; }
      /* Below 768px three steps plus their captions cannot share a row without
         truncating to nothing, so the captions go and the titles get the room. */
      @media (max-width: 767.98px) {
        .gd-page .gd-stepper { padding: 12px 14px; }
        .gd-page .gd-stepper-sub { display: none; }
        .gd-page .gd-stepper-line { flex-basis: 16px; }
      }

      /* Action button polish — match TemplateForm hover treatment */
      .gd-page .gd-cancel,
      .gd-page .gd-back { transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }
      .gd-page .gd-cancel:hover:not(:disabled),
      .gd-page .gd-back:hover:not(:disabled) {
        background: #f9fafb !important; border-color: #c7d2fe !important; color: #4338ca !important;
      }

      /* A cell left blank when Next was refused. Targets the inner control so
         the date picker, which renders its own input, is covered too. */
      .gd-page .gd-cell--err input,
      .gd-page .gd-cell--err textarea {
        border-color: #f87171 !important;
        background: #fef2f2 !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-cell--err input,
      [data-bs-theme="dark"] .gd-page .gd-cell--err textarea,
      [data-layout-mode="dark"] .gd-page .gd-cell--err input,
      [data-layout-mode="dark"] .gd-page .gd-cell--err textarea {
        border-color: rgba(248,113,113,0.7) !important;
        background: rgba(239,68,68,0.10) !important;
      }

      /* Sr No + Employee stay put while the field columns scroll — a template
         with ten custom fields is ~2000px wide, and without this you end up
         typing into a row with no idea whose it is. */
      .gd-page .gd-vars-table .gd-table-head > *:nth-child(1),
      .gd-page .gd-vars-table .gd-row > *:nth-child(1) { position: sticky; left: 0; z-index: 2; }
      .gd-page .gd-vars-table .gd-table-head > *:nth-child(2),
      .gd-page .gd-vars-table .gd-row > *:nth-child(2) { position: sticky; left: 56px; z-index: 2; }
      .gd-page .gd-vars-table .gd-table-head > *:nth-child(1),
      .gd-page .gd-vars-table .gd-table-head > *:nth-child(2) { background: #f5f3ff; }
      .gd-page .gd-vars-table .gd-row > *:nth-child(1),
      .gd-page .gd-vars-table .gd-row > *:nth-child(2) { background: #fff; }
      /* The shadow only appears once there is something scrolled under it. */
      .gd-page .gd-vars-table .gd-table-head > *:nth-child(2),
      .gd-page .gd-vars-table .gd-row > *:nth-child(2) { box-shadow: 6px 0 8px -6px rgba(15,23,42,0.12); }
      [data-bs-theme="dark"] .gd-page .gd-vars-table .gd-row > *:nth-child(1),
      [data-bs-theme="dark"] .gd-page .gd-vars-table .gd-row > *:nth-child(2),
      [data-layout-mode="dark"] .gd-page .gd-vars-table .gd-row > *:nth-child(1),
      [data-layout-mode="dark"] .gd-page .gd-vars-table .gd-row > *:nth-child(2) { background: #1f2937; }

      /* Without this the browser's own focus ring shows — a hard black outline
         that looked like a validation error on a field the user just clicked. */
      .gd-page .gd-input {
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      .gd-page .gd-input:focus,
      .gd-page .gd-input:focus-visible {
        outline: none;
        border-color: #a5b4fc !important;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
      }
      [data-bs-theme="dark"] .gd-page .gd-input:focus,
      [data-layout-mode="dark"] .gd-page .gd-input:focus {
        border-color: rgba(167,139,250,0.65) !important;
        box-shadow: 0 0 0 3px rgba(139,92,246,0.22);
      }

      /* Dark-mode stepper */
      /* Step 3's recipient list and the footer's divider. */
      [data-bs-theme="dark"] .gd-page .gd-code-badge,
      [data-layout-mode="dark"] .gd-page .gd-code-badge {
        background: rgba(99,102,241,0.18) !important; border-color: rgba(124,92,252,0.40) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-rcpt-card,
      [data-layout-mode="dark"] .gd-page .gd-rcpt-card {
        background: var(--vz-card-bg) !important; border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-rcpt-head,
      [data-layout-mode="dark"] .gd-page .gd-rcpt-head {
        background: rgba(255,255,255,0.04) !important; border-bottom-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-rcpt.is-active,
      [data-layout-mode="dark"] .gd-page .gd-rcpt.is-active {
        background: rgba(99,102,241,0.18) !important; border-color: rgba(124,92,252,0.45) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-rcpt-name,
      [data-layout-mode="dark"] .gd-page .gd-rcpt-name { color: rgba(255,255,255,0.8) !important; }
      [data-bs-theme="dark"] .gd-page .gd-rcpt.is-active .gd-rcpt-name,
      [data-layout-mode="dark"] .gd-page .gd-rcpt.is-active .gd-rcpt-name { color: #c4b5fd !important; }
      [data-bs-theme="dark"] .gd-page .gd-outline-btn,
      [data-layout-mode="dark"] .gd-page .gd-outline-btn {
        background: rgba(124,92,252,0.12) !important; border-color: rgba(124,92,252,0.40) !important; color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-foot-div,
      [data-layout-mode="dark"] .gd-page .gd-foot-div { background: var(--vz-border-color) !important; }

      [data-bs-theme="dark"] .gd-page .gd-step-head,
      [data-layout-mode="dark"] .gd-page .gd-step-head {
        background: rgba(255,255,255,0.04) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-step-head .gd-title,
      [data-layout-mode="dark"] .gd-page .gd-step-head .gd-title {
        color: rgba(255,255,255,0.88) !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-stepper-strip,
      [data-layout-mode="dark"] .gd-page .gd-stepper-strip {
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
      /* Head band + body of the step cards. */
      [data-bs-theme="dark"] .gd-page .gd-card-head,
      [data-layout-mode="dark"] .gd-page .gd-card-head {
        background: rgba(99,102,241,0.14) !important;
        border-bottom-color: rgba(255,255,255,0.08) !important;
        color: #f1f5f9 !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-card-head-title,
      [data-layout-mode="dark"] .gd-page .gd-card-head-title { color: #f1f5f9 !important; }
      [data-bs-theme="dark"] .gd-page .gd-card-head-sub,
      [data-layout-mode="dark"] .gd-page .gd-card-head-sub { color: rgba(255,255,255,0.55) !important; }
      [data-bs-theme="dark"] .gd-page .gd-card-body,
      [data-layout-mode="dark"] .gd-page .gd-card-body { background: #1f2937 !important; }
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

      /* Success tick circle — was a hardcoded light green (#dcfce7) that read as
         a pale disc on the dark success row. Translucent green + brighter check. */
      [data-bs-theme="dark"] .gd-page .gd-success-tick,
      [data-layout-mode="dark"] .gd-page .gd-success-tick {
        background: rgba(16,185,129,0.20) !important; color: #4ade80 !important;
      }

      /* Count pills ("N selected" / "N documents") — were a hardcoded light
         indigo (#e0e7ff / #4338ca) that glowed white on the dark surface. */
      [data-bs-theme="dark"] .gd-page .gd-count-badge,
      [data-layout-mode="dark"] .gd-page .gd-count-badge {
        background: rgba(99,102,241,0.22) !important; color: #c7d2fe !important;
      }

      /* Outline action buttons ("Send for Signature" / "Download document(s)")
         — were white-background/purple-outline, unreadable in dark mode. */
      [data-bs-theme="dark"] .gd-page .gd-outline-btn,
      [data-layout-mode="dark"] .gd-page .gd-outline-btn {
        background: rgba(124,58,237,0.16) !important; border-color: #a78bfa !important; color: #ddd6fe !important;
      }
      [data-bs-theme="dark"] .gd-page .gd-outline-btn:hover:not(:disabled),
      [data-layout-mode="dark"] .gd-page .gd-outline-btn:hover:not(:disabled) {
        background: rgba(124,58,237,0.28) !important;
      }

      /* Back / Cancel hover must stay dark — the base light-mode hover rule
         (background:#f9fafb) applies in both themes and flipped these buttons
         to a white background on hover in dark mode. */
      [data-bs-theme="dark"] .gd-page .gd-cancel:hover:not(:disabled),
      [data-bs-theme="dark"] .gd-page .gd-back:hover:not(:disabled),
      [data-layout-mode="dark"] .gd-page .gd-cancel:hover:not(:disabled),
      [data-layout-mode="dark"] .gd-page .gd-back:hover:not(:disabled) {
        background: rgba(255,255,255,0.12) !important; border-color: rgba(129,140,248,0.55) !important; color: #f1f5f9 !important;
      }
    `}</style>
  );
}
