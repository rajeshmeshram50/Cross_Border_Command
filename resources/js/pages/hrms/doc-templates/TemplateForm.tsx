import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody } from 'reactstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import api from '../../../api';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import TemplateEditor from './TemplateEditor';

// ── Types ────────────────────────────────────────────────────────────────────
export type EmployeeCategory = 'IT' | 'Non-IT' | 'Legal';
export type RoleType =
  | 'Director / CEO'
  | 'Head of Department (HOD)'
  | 'Team Leader'
  | 'Executive'
  | 'Employee'
  | 'Intern / Trainee';
export type DocStatus   = 'Draft' | 'Active' | 'Deprecated';
export type SigningMode = 'Sequential' | 'Parallel';

export interface SignerRow {
  role_id?: number | null;
  role_name?: string | null;
  designation_id?: number | null;
  designation_name?: string | null;
  action: string;
  days: number;
}

export interface TemplateRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  employee_category: EmployeeCategory;
  role_type: RoleType;
  doc_type: string | null;
  trigger_point_id: number | null;
  trigger_point?: { id: number; module_name: string } | null;
  version: string;
  is_mandatory: boolean;
  requires_signature: boolean;
  requires_manager_approval: boolean;
  include_in_audit: boolean;
  signing_mode: SigningMode;
  signers: SignerRow[] | null;
  editor_mode: 'web' | 'word';
  content_html: string | null;
  docx_path: string | null;
  docx_original_name: string | null;
  status: DocStatus;
  created_at: string;
}

// ── Static option sets ───────────────────────────────────────────────────────
const CATEGORIES: { value: EmployeeCategory; label: string; icon: string }[] = [
  { value: 'IT',     label: 'IT Employee Documents', icon: '💻' },
  { value: 'Non-IT', label: 'Non-IT Operations',     icon: '🏭' },
  { value: 'Legal',  label: 'Legal Documents',       icon: '⚖️' },
];

// Designation levels — mirrors master_designations.level so the chip strip
// here always matches what the master shows. Keep these labels byte-identical
// to the controller's ROLE_TYPES constant.
export const ROLE_TYPES: { value: RoleType; label: string; icon: string; tone: { bg: string; fg: string; border: string } }[] = [
  { value: 'Director / CEO',           label: 'Director / CEO',           icon: '👔', tone: { bg: '#fff7ed', fg: '#9a3412', border: '#fdba74' } },
  { value: 'Head of Department (HOD)', label: 'Head of Department (HOD)', icon: '🎯', tone: { bg: '#f5f3ff', fg: '#6d28d9', border: '#c4b5fd' } },
  { value: 'Team Leader',              label: 'Team Leader',              icon: '👥', tone: { bg: '#eff6ff', fg: '#1d4ed8', border: '#93c5fd' } },
  { value: 'Executive',                label: 'Executive',                icon: '💼', tone: { bg: '#ecfdf5', fg: '#047857', border: '#6ee7b7' } },
  { value: 'Employee',                 label: 'Employee',                 icon: '👤', tone: { bg: '#dcfce7', fg: '#15803d', border: '#86efac' } },
  { value: 'Intern / Trainee',         label: 'Intern / Trainee',         icon: '🎓', tone: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' } },
];

const STEPS = [
  { key: 1, label: 'Setup',                 sub: 'Basic information' },
  { key: 2, label: 'Lifecycle & Signing',   sub: 'Trigger + approval workflow' },
  { key: 3, label: 'Template Design',       sub: 'Content + placeholders' },
];

// ── Form ─────────────────────────────────────────────────────────────────────
export default function TemplateFormPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const editingId = routeId ? Number(routeId) : null;

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bootstrapping, setBootstrapping] = useState(!!editingId);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<EmployeeCategory>('IT');
  const [roleType, setRoleType] = useState<RoleType>('Intern / Trainee');
  const [isMandatory, setIsMandatory]   = useState(true);
  const [requiresSig, setRequiresSig]   = useState(true);
  const [requiresMgr, setRequiresMgr]   = useState(true);
  const [includeAudit, setIncludeAudit] = useState(true);

  // Step 2
  const [triggerPointId, setTriggerPointId] = useState<number | ''>('');
  const [signingMode, setSigningMode] = useState<SigningMode>('Sequential');
  const [signers, setSigners] = useState<SignerRow[]>([
    { role_id: null, designation_id: null, role_name: '', designation_name: '', action: 'Sign', days: 3 },
  ]);

  // Step 3
  const [editorMode, setEditorMode] = useState<'web' | 'word'>('web');
  const [contentHtml, setContentHtml] = useState<string>('');
  const docxRef = useRef<HTMLInputElement | null>(null);

  // Lookups
  const [triggerPoints, setTriggerPoints] = useState<Array<{ id: number; module_name: string; status: string }>>([]);
  const [roles, setRoles]                 = useState<Array<{ id: number; name: string }>>([]);
  const [designations, setDesignations]   = useState<Array<{ id: number; name: string; level?: string }>>([]);

  // ── Bootstrap: load lookups + (if editing) the existing template ───────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tpRes, rolesRes, desigRes, rowRes] = await Promise.all([
          api.get('/master/trigger_point').catch(() => ({ data: [] })),
          api.get('/master/roles').catch(() => ({ data: [] })),
          api.get('/master/designations').catch(() => ({ data: [] })),
          editingId ? api.get(`/hr-document-templates/${editingId}`) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const tps: any[]  = Array.isArray(tpRes.data) ? tpRes.data : [];
        const rls: any[]  = Array.isArray(rolesRes.data) ? rolesRes.data : [];
        const dsgs: any[] = Array.isArray(desigRes.data) ? desigRes.data : [];
        const isActive = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';
        setTriggerPoints(tps.filter(isActive).map(r => ({ id: r.id, module_name: r.module_name, status: r.status })));
        setRoles(rls.filter(isActive).map(r => ({ id: r.id, name: r.name })));
        setDesignations(dsgs.filter(isActive).map(r => ({ id: r.id, name: r.name, level: r.level })));

        if (rowRes) {
          const row = rowRes.data as TemplateRow;
          setEditing(row);
          setName(row.name || '');
          setDescription(row.description || '');
          setCode(row.code || '');
          setCategory(row.employee_category || 'IT');
          setRoleType(row.role_type || 'Intern / Trainee');
          setIsMandatory(!!row.is_mandatory);
          setRequiresSig(!!row.requires_signature);
          setRequiresMgr(!!row.requires_manager_approval);
          setIncludeAudit(!!row.include_in_audit);
          setTriggerPointId(row.trigger_point_id ?? '');
          setSigningMode(row.signing_mode || 'Sequential');
          setSigners(Array.isArray(row.signers) && row.signers.length
            ? row.signers
            : [{ role_id: null, designation_id: null, role_name: '', designation_name: '', action: 'Sign', days: 3 }]);
          setEditorMode(row.editor_mode || 'web');
          setContentHtml(row.content_html || '');
        }
      } catch (err: any) {
        if (!cancelled) {
          toast.error('Could not load template', err?.response?.data?.message || 'Please try again.');
          navigate('/hr/doc-templates');
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // ── Auto-preview the code when category/role change (create only) ─────────
  useEffect(() => {
    if (editingId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/hr-document-templates/next-code', {
          params: { employee_category: category, role_type: roleType },
        });
        if (!cancelled) setCode(data?.code || '');
      } catch {
        if (!cancelled) setCode('');
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, category, roleType]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!name.trim()) e.name = 'Template name is required';
      if (!category) e.employee_category = 'Required';
      if (!roleType) e.role_type = 'Required';
    }
    if (s === 2) {
      if (!triggerPointId) e.trigger_point_id = 'Select a lifecycle event';
      if (requiresSig && signers.length === 0) e.signers = 'Add at least one signer';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validateStep(step)) setStep(s => Math.min(STEPS.length, s + 1)); };
  const handleBack = () => setStep(s => Math.max(1, s - 1));

  // ── Save helpers ───────────────────────────────────────────────────────────
  const buildPayload = (status: DocStatus | null) => {
    const payload: Record<string, any> = {
      name: name.trim(),
      description,
      employee_category: category,
      role_type: roleType,
      // Document Type field was removed from step 1 — leave the column null on
      // create. Edits preserve whatever value already existed.
      ...(editing?.doc_type ? { doc_type: editing.doc_type } : {}),
      trigger_point_id: triggerPointId || null,
      is_mandatory: isMandatory ? 1 : 0,
      requires_signature: requiresSig ? 1 : 0,
      requires_manager_approval: requiresMgr ? 1 : 0,
      include_in_audit: includeAudit ? 1 : 0,
      signing_mode: signingMode,
      signers,
      editor_mode: editorMode,
      content_html: contentHtml,
    };
    if (status) payload.status = status;
    return payload;
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!asDraft && !validateStep(1)) { setStep(1); return; }
    if (!asDraft && !validateStep(2)) { setStep(2); return; }
    setSaving(true);
    try {
      const payload = buildPayload(asDraft ? 'Draft' : 'Active');
      const url = editing ? `/hr-document-templates/${editing.id}` : '/hr-document-templates';
      const { data } = editing
        ? await api.put(url, payload)
        : await api.post(url, payload);
      toast.success(asDraft ? 'Saved as draft' : (editing ? 'Template updated' : 'Template created'),
        `${data.code || data.id} saved.`);
      // After a successful create, swap to the edit URL so the DOCX
      // download/upload buttons (which need a saved row) light up.
      if (!editing && data?.id) {
        navigate(`/hr/doc-templates/${data.id}/edit`, { replace: true });
        setEditing(data);
      } else {
        navigate('/hr/doc-templates');
      }
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          mapped[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setErrors(mapped);
        toast.error('Validation failed', 'Please fix the highlighted fields.');
      } else {
        toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── DOCX actions ───────────────────────────────────────────────────────────
  const downloadDocx = async () => {
    if (!editing) {
      toast.error('Save first', 'Save the template as a draft before downloading as DOCX.');
      return;
    }
    try {
      const resp = await api.get(`/hr-document-templates/${editing.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${editing.code || 'template'}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    }
  };

  const uploadDocx = async (file: File) => {
    if (!editing) {
      toast.error('Save first', 'Save the template as a draft before uploading a revised DOCX.');
      return;
    }
    const fd = new FormData();
    fd.append('docx', file);
    try {
      const { data } = await api.post(`/hr-document-templates/${editing.id}/upload-docx`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setContentHtml(data.content_html || '');
      setEditorMode('word');
      setEditing(data);
      toast.success('Revised DOCX uploaded', `Imported ${data.docx_original_name}.`);
    } catch (err: any) {
      toast.error('Could not upload', err?.response?.data?.message || 'Please try again.');
    }
  };

  // ── Signer mutators ────────────────────────────────────────────────────────
  const addSigner = () => setSigners(arr => [...arr, { role_id: null, designation_id: null, role_name: '', designation_name: '', action: 'Sign', days: 3 }]);
  const updateSigner = (i: number, patch: Partial<SignerRow>) => setSigners(arr => arr.map((s, j) => j === i ? { ...s, ...patch } : s));
  const removeSigner = (i: number) => setSigners(arr => arr.filter((_, j) => j !== i));

  const previewSigners = useMemo(() => signers.map(s => ({
    label: s.role_name || (s.role_id ? roles.find(r => r.id === s.role_id)?.name : '') || 'Unassigned',
    action: s.action || 'Sign',
  })), [signers, roles]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (bootstrapping) {
    return (
      <div className="rec-page" style={{ padding: 24 }}>
        <Card><CardBody>Loading template…</CardBody></Card>
      </div>
    );
  }

  return (
    <div className="rec-page">
      {/* Header bar — replaces the modal's gradient strip */}
      <Card className="mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-center gap-3 min-w-0">
              <button type="button" onClick={() => navigate('/hr/doc-templates')}
                style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', cursor: 'pointer' }}
                title="Back to templates">
                <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
              </button>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-file-text-line" style={{ fontSize: 22, color: '#fff' }} />
              </span>
              <div>
                <h4 className="fw-bold mb-0" style={{ color: '#fff' }}>{editing ? 'Edit Template' : 'Add New Template'}</h4>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  Step {step} of {STEPS.length} — {STEPS[step - 1].sub}
                </div>
              </div>
            </div>
            <span style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,0.20)', padding: '5px 12px', borderRadius: 999, fontWeight: 700 }}>{STEPS[step - 1].label}</span>
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '14px 22px', background: '#fff' }}>
          <div className="d-flex align-items-center" style={{ gap: 18, flexWrap: 'wrap' }}>
            {STEPS.map(s => {
              const active = step === s.key;
              const done = step > s.key;
              return (
                <button key={s.key} type="button"
                  onClick={() => { if (done || active) setStep(s.key); }}
                  disabled={!done && !active}
                  className="d-inline-flex align-items-center"
                  style={{ gap: 8, padding: '4px 8px', border: 0, background: 'transparent',
                    color: active ? '#4338ca' : (done ? '#6366f1' : '#9ca3af'),
                    cursor: (done || active) ? 'pointer' : 'default' }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%',
                    background: active ? '#4338ca' : (done ? '#6366f1' : '#e5e7eb'),
                    color: (active || done) ? '#fff' : '#6b7280',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700 }}>
                    {done ? <i className="ri-check-line" /> : s.key}
                  </span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.1 }}>{s.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.75 }}>{s.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Body */}
      <Card style={{ borderRadius: 14 }}>
        <CardBody style={{ padding: 22 }}>
          {step === 1 && (
            <Step1
              name={name} setName={setName}
              description={description} setDescription={setDescription}
              code={code}
              category={category} setCategory={setCategory}
              roleType={roleType} setRoleType={setRoleType}
              isMandatory={isMandatory} setIsMandatory={setIsMandatory}
              requiresSig={requiresSig} setRequiresSig={setRequiresSig}
              requiresMgr={requiresMgr} setRequiresMgr={setRequiresMgr}
              includeAudit={includeAudit} setIncludeAudit={setIncludeAudit}
              errors={errors}
            />
          )}
          {step === 2 && (
            <Step2
              triggerPoints={triggerPoints}
              triggerPointId={triggerPointId} setTriggerPointId={setTriggerPointId}
              signingMode={signingMode} setSigningMode={setSigningMode}
              signers={signers}
              roles={roles} designations={designations}
              addSigner={addSigner} updateSigner={updateSigner} removeSigner={removeSigner}
              previewSigners={previewSigners}
              errors={errors}
            />
          )}
          {step === 3 && (
            <Step3
              editorMode={editorMode} setEditorMode={setEditorMode}
              contentHtml={contentHtml} setContentHtml={setContentHtml}
              signers={signers}
              editingId={editing?.id || null}
              docxName={editing?.docx_original_name || null}
              docxRef={docxRef}
              onDownloadDocx={downloadDocx}
              onUploadDocx={uploadDocx}
            />
          )}
        </CardBody>

        {/* Footer */}
        <div style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderRadius: '0 0 14px 14px' }}>
          <button type="button" onClick={() => handleSubmit(true)} disabled={saving}
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            <i className="ri-draft-line me-1" /> Save as Draft
          </button>
          <div className="d-flex gap-2">
            <button type="button" onClick={() => navigate('/hr/doc-templates')} disabled={saving}
              style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={handleBack} disabled={step === 1 || saving}
              style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: step === 1 ? '#9ca3af' : '#374151', cursor: step === 1 ? 'default' : 'pointer' }}>
              ← Back
            </button>
            {step < STEPS.length ? (
              <button type="button" onClick={handleNext} disabled={saving}
                style={{ padding: '8px 18px', background: '#6366f1', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
                Next →
              </button>
            ) : (
              <button type="button" onClick={() => handleSubmit(false)} disabled={saving}
                style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                {saving ? 'Saving…' : (editing ? 'Update Template' : 'Publish Template')}
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Step 1 — Setup ────────────────────────────────────────────────────────── */
function Step1(props: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  code: string;
  category: EmployeeCategory; setCategory: (v: EmployeeCategory) => void;
  roleType: RoleType; setRoleType: (v: RoleType) => void;
  isMandatory: boolean; setIsMandatory: (v: boolean) => void;
  requiresSig: boolean; setRequiresSig: (v: boolean) => void;
  requiresMgr: boolean; setRequiresMgr: (v: boolean) => void;
  includeAudit: boolean; setIncludeAudit: (v: boolean) => void;
  errors: Record<string, string>;
}) {
  return (
    <>
      {/* Basic info */}
      <section style={sectionStyle}>
        <div style={sectionLabel}>Basic Information</div>
        <div className="row g-3">
          <div className="col-md-8">
            <label style={fieldLabel}>Template Name <span style={req}>*</span></label>
            <input type="text" value={props.name} onChange={e => props.setName(e.target.value)}
              placeholder="e.g. Internship Offer Letter (November)"
              style={inputStyle(!!props.errors.name)} />
            {props.errors.name && <div style={errMsg}>{props.errors.name}</div>}
          </div>
          <div className="col-md-4">
            <label style={fieldLabel}>Template Code</label>
            <input type="text" value={props.code} readOnly
              style={{ ...inputStyle(false), background: '#fef9c3', color: '#a16207', fontFamily: 'monospace', fontWeight: 700, border: '1px solid #fde68a' }} />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Auto-generated per category + role.</div>
          </div>
          <div className="col-12">
            <label style={fieldLabel}>Description</label>
            <textarea value={props.description} onChange={e => props.setDescription(e.target.value)}
              placeholder="Short note describing when this template is used…"
              rows={2} style={{ ...inputStyle(false), resize: 'vertical' }} />
          </div>
        </div>
      </section>

      {/* Employee category */}
      <section style={sectionStyle}>
        <div style={sectionLabel}>1. Employee Category <span style={req}>*</span></div>
        <div className="row g-2">
          {CATEGORIES.map(c => {
            const active = props.category === c.value;
            return (
              <div key={c.value} className="col-md-4">
                <button type="button" onClick={() => props.setCategory(c.value)}
                  style={{ width: '100%', padding: '16px 12px', borderRadius: 10,
                    border: '2px solid ' + (active ? '#6366f1' : '#e5e7eb'),
                    background: active ? '#eef2ff' : '#fff',
                    cursor: 'pointer', textAlign: 'center', transition: 'all .15s ease' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: active ? '#4338ca' : '#374151' }}>{c.label}</div>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Role / Designation — six designation levels, mirrors master_designations.level */}
      <section style={sectionStyle}>
        <div style={sectionLabel}>2. Role / Designation Type <span style={req}>*</span></div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Sourced from the Designation Master's <code>level</code> field.</div>
        <div className="row g-2">
          {ROLE_TYPES.map(r => {
            const active = props.roleType === r.value;
            return (
              <div key={r.value} className="col-lg-2 col-md-4 col-sm-6">
                <button type="button" onClick={() => props.setRoleType(r.value)}
                  style={{ width: '100%', padding: '14px 10px', borderRadius: 10,
                    border: '2px solid ' + (active ? '#6366f1' : '#e5e7eb'),
                    background: active ? '#eef2ff' : '#fff',
                    cursor: 'pointer', textAlign: 'center', minHeight: 92 }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{r.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: active ? '#4338ca' : '#374151', lineHeight: 1.2 }}>{r.label}</div>
                </button>
              </div>
            );
          })}
        </div>
        {props.errors.role_type && <div style={errMsg}>{props.errors.role_type}</div>}
      </section>

      {/* Settings (Document Type field removed per spec) */}
      <section style={sectionStyle}>
        <div style={sectionLabel}>3. Settings</div>
        <Toggle on={props.isMandatory}  setOn={props.setIsMandatory}  title="Mandatory Document"      sub="Must be completed as part of onboarding/offboarding" />
        <Toggle on={props.requiresSig}  setOn={props.setRequiresSig}  title="Requires Employee Signature" sub="Digital or physical signature required" />
        <Toggle on={props.requiresMgr}  setOn={props.setRequiresMgr}  title="Requires Manager Approval" sub="Manager must review and approve before sending" />
        <Toggle on={props.includeAudit} setOn={props.setIncludeAudit} title="Include in Audit Trail"   sub="Track all generation and signing events" />
      </section>
    </>
  );
}

function Toggle({ on, setOn, title, sub }: { on: boolean; setOn: (v: boolean) => void; title: string; sub: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, background: '#fff', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: '#6366f1' }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#374151' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>{sub}</div>
      </div>
    </label>
  );
}

/* ── Step 2 — Lifecycle & Signing ──────────────────────────────────────────── */
function Step2(props: {
  triggerPoints: Array<{ id: number; module_name: string; status: string }>;
  triggerPointId: number | ''; setTriggerPointId: (v: number | '') => void;
  signingMode: SigningMode; setSigningMode: (v: SigningMode) => void;
  signers: SignerRow[];
  roles: Array<{ id: number; name: string }>;
  designations: Array<{ id: number; name: string; level?: string }>;
  addSigner: () => void;
  updateSigner: (i: number, patch: Partial<SignerRow>) => void;
  removeSigner: (i: number) => void;
  previewSigners: { label: string; action: string }[];
  errors: Record<string, string>;
}) {
  const triggerOptions = props.triggerPoints.map(tp => ({ value: String(tp.id), label: tp.module_name }));
  const roleOptions = props.roles.map(r => ({ value: String(r.id), label: r.name }));
  const designationOptions = props.designations.map(d => ({ value: String(d.id), label: d.name + (d.level ? ` · ${d.level}` : '') }));
  const actionOptions = [
    { value: 'Sign',         label: 'Sign' },
    { value: 'Approve',      label: 'Approve' },
    { value: 'Review',       label: 'Review' },
    { value: 'Acknowledge',  label: 'Acknowledge' },
  ];

  return (
    <>
      {/* Lifecycle event */}
      <section style={sectionStyle}>
        <div style={sectionLabel}>HR Lifecycle Event <span style={req}>*</span></div>
        <div className="row g-3">
          <div className="col-md-8">
            <label style={fieldLabel}>Trigger</label>
            <MasterSelect
              value={props.triggerPointId ? String(props.triggerPointId) : ''}
              onChange={(v) => props.setTriggerPointId(v ? Number(v) : '')}
              options={triggerOptions}
              placeholder="— Select trigger —"
              invalid={!!props.errors.trigger_point_id}
            />
            {props.errors.trigger_point_id && <div style={errMsg}>{props.errors.trigger_point_id}</div>}
            <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 4 }}>
              Sourced from the Trigger Point Master under HR &gt; Document &amp; Evidence.
            </div>
          </div>
        </div>
      </section>

      {/* Signing workflow */}
      <section style={{ borderRadius: 12, marginBottom: 16, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
        <div style={{ padding: '12px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="d-flex align-items-center gap-2">
            <i className="ri-shield-check-line" style={{ fontSize: 18 }} />
            <strong>Signing Workflow</strong>
          </div>
          <div style={{ minWidth: 160 }}>
            <MasterSelect
              value={props.signingMode}
              onChange={(v) => props.setSigningMode(v as SigningMode)}
              options={[{ value: 'Sequential', label: 'Sequential' }, { value: 'Parallel', label: 'Parallel' }]}
            />
          </div>
        </div>

        <div style={{ padding: 14, background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1.4fr 1.4fr 1fr 80px 36px', gap: 10, padding: '0 6px 8px', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase' }}>
            <div>#</div><div>Role / Position</div><div>Designation Level</div><div>Action</div><div>Days</div><div />
          </div>
          {props.signers.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1.4fr 1.4fr 1fr 80px 36px', gap: 10, padding: '6px', alignItems: 'center' }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
              <MasterSelect
                value={s.role_id ? String(s.role_id) : ''}
                onChange={(v) => {
                  const id = v ? Number(v) : null;
                  const role = props.roles.find(r => r.id === id);
                  props.updateSigner(i, { role_id: id, role_name: role?.name || '' });
                }}
                options={roleOptions}
                placeholder="— Select Role —"
              />
              <MasterSelect
                value={s.designation_id ? String(s.designation_id) : ''}
                onChange={(v) => {
                  const id = v ? Number(v) : null;
                  const dsg = props.designations.find(d => d.id === id);
                  props.updateSigner(i, { designation_id: id, designation_name: dsg?.name || '' });
                }}
                options={designationOptions}
                placeholder="— Select —"
              />
              <MasterSelect
                value={s.action}
                onChange={(v) => props.updateSigner(i, { action: v })}
                options={actionOptions}
              />
              <input type="number" min={0} max={365} value={s.days}
                onChange={e => props.updateSigner(i, { days: Number(e.target.value) || 0 })}
                style={inputStyle(false)} />
              <button type="button" onClick={() => props.removeSigner(i)} title="Remove"
                style={{ width: 30, height: 30, border: 0, borderRadius: 6, background: '#fee2e2', color: '#b91c1c', cursor: 'pointer' }}>
                <i className="ri-close-line" />
              </button>
            </div>
          ))}
          {props.errors.signers && <div style={{ ...errMsg, padding: '0 6px' }}>{props.errors.signers}</div>}

          <button type="button" onClick={props.addSigner}
            style={{ marginTop: 8, width: '100%', padding: 10, borderRadius: 8, border: '1px dashed #c7d2fe', background: '#fafaff', color: '#4338ca', fontWeight: 700, cursor: 'pointer' }}>
            <i className="ri-add-line me-1" /> Add Signer
          </button>
        </div>

        {/* Preview */}
        {props.previewSigners.length > 0 && (
          <div style={{ padding: 12, background: '#faf5ff', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Signing Flow Preview</div>
            <div className="d-flex align-items-center flex-wrap" style={{ gap: 6 }}>
              {props.previewSigners.map((p, i) => (
                <div key={i} className="d-flex align-items-center" style={{ gap: 6 }}>
                  <div style={{ padding: '6px 12px', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#15803d' }}>
                    <span style={{ display: 'inline-flex', width: 18, height: 18, borderRadius: '50%', background: '#16a34a', color: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 6, fontSize: 10 }}>{i + 1}</span>
                    {p.label}
                    <div style={{ fontSize: 10.5, fontWeight: 500, color: '#16a34a' }}>{p.action}</div>
                  </div>
                  {i < props.previewSigners.length - 1 && <i className="ri-arrow-right-line" style={{ color: '#9ca3af' }} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/* ── Step 3 — Template Design ──────────────────────────────────────────────── */
function Step3(props: {
  editorMode: 'web' | 'word'; setEditorMode: (v: 'web' | 'word') => void;
  contentHtml: string; setContentHtml: (v: string) => void;
  signers: SignerRow[];
  editingId: number | null;
  docxName: string | null;
  docxRef: React.RefObject<HTMLInputElement | null>;
  onDownloadDocx: () => void;
  onUploadDocx: (f: File) => void;
}) {
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', border: '1px solid ' + (active ? '#6366f1' : '#e5e7eb'),
    background: active ? '#6366f1' : '#fff', color: active ? '#fff' : '#374151',
    borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button type="button" style={tabBtn(props.editorMode === 'web')}  onClick={() => props.setEditorMode('web')}><i className="ri-global-line me-1" />Web Editor</button>
        <button type="button" style={tabBtn(props.editorMode === 'word')} onClick={() => props.setEditorMode('word')}><i className="ri-file-word-2-line me-1" />MS Word</button>
      </div>

      {props.editorMode === 'web' && (
        <TemplateEditor value={props.contentHtml} onChange={props.setContentHtml} signers={props.signers} />
      )}

      {props.editorMode === 'word' && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, background: '#fff' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>MS Word Workflow</div>
          <ol style={{ paddingLeft: 18, fontSize: 13, color: '#374151', lineHeight: 1.7, marginBottom: 16 }}>
            <li>Download → Edit in Word</li>
            <li>Add tables, formatting, signature blocks</li>
            <li>Upload revised version below — it replaces the saved DOCX</li>
          </ol>
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" onClick={props.onDownloadDocx} disabled={!props.editingId}
              style={{ padding: '8px 16px', background: '#1f2937', color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: props.editingId ? 'pointer' : 'not-allowed', opacity: props.editingId ? 1 : 0.5 }}>
              <i className="ri-download-2-line me-1" /> Download DOCX
            </button>
            <input ref={props.docxRef} type="file" accept=".doc,.docx" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUploadDocx(f); e.currentTarget.value = ''; }} />
            <button type="button" onClick={() => props.docxRef.current?.click()} disabled={!props.editingId}
              style={{ padding: '8px 16px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: props.editingId ? 'pointer' : 'not-allowed', opacity: props.editingId ? 1 : 0.5 }}>
              <i className="ri-upload-2-line me-1" /> Upload Revised DOCX
            </button>
          </div>
          {!props.editingId && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', padding: '6px 10px', borderRadius: 8 }}>
              <i className="ri-information-line me-1" />Save the template as a draft first to enable DOCX export/import.
            </div>
          )}
          {props.docxName && (
            <div style={{ marginTop: 12, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12.5, color: '#374151' }}>
              <i className="ri-file-word-2-line me-1" /> Latest uploaded: <strong>{props.docxName}</strong>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ── Small style helpers ───────────────────────────────────────────────────── */
const sectionStyle: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 18, background: '#fafaff' };
const sectionLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: '#6366f1', textTransform: 'uppercase', marginBottom: 12 };
const fieldLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6, display: 'block' };
const req: React.CSSProperties = { color: '#ef4444' };
function inputStyle(error: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid ' + (error ? '#ef4444' : '#e5e7eb'),
    fontSize: 13.5, background: '#fff', lineHeight: 1.4,
  };
}
const errMsg: React.CSSProperties = { fontSize: 11.5, color: '#ef4444', marginTop: 4 };
