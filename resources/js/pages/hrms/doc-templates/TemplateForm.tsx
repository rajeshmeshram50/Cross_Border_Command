import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody } from 'reactstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import Tooltip from '../../../components/ui/Tooltip';
import api from '../../../api';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { Shimmer } from '../../../components/ui/Shimmer';
import TemplateEditor from './TemplateEditor';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from './HeaderFooterPanel';

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
  header_config: HeaderConfig | null;
  footer_config: FooterConfig | null;
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
/* `short` is display-only, for tight strips like the level tab rail. It is NOT
   a second name for the role: `value` is what the column stores and what the
   controller validates against, and `label` stays the full descriptive form for
   pickers, where there is room and the reader is choosing rather than scanning.
   Only HOD differs — "Head of Department (HOD)" is nearly three times the width
   of every other tab and pushed the rail onto a second line. The short form
   matches the controller's own ROLE_SHORT map, which already codes it HOD. */
export const ROLE_TYPES: { value: RoleType; label: string; short: string; icon: string; tone: { bg: string; fg: string; border: string } }[] = [
  { value: 'Director / CEO',           label: 'Director / CEO',           short: 'Director / CEO',   icon: '👔', tone: { bg: '#fff7ed', fg: '#9a3412', border: '#fdba74' } },
  { value: 'Head of Department (HOD)', label: 'Head of Department (HOD)', short: 'HOD',              icon: '🎯', tone: { bg: '#f5f3ff', fg: '#6d28d9', border: '#c4b5fd' } },
  { value: 'Team Leader',              label: 'Team Leader',              short: 'Team Leader',      icon: '👥', tone: { bg: '#eff6ff', fg: '#1d4ed8', border: '#93c5fd' } },
  { value: 'Executive',                label: 'Executive',                short: 'Executive',        icon: '💼', tone: { bg: '#ecfdf5', fg: '#047857', border: '#6ee7b7' } },
  { value: 'Employee',                 label: 'Employee',                 short: 'Employee',         icon: '👤', tone: { bg: '#dcfce7', fg: '#15803d', border: '#86efac' } },
  { value: 'Intern / Trainee',         label: 'Intern / Trainee',         short: 'Intern / Trainee', icon: '🎓', tone: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' } },
];

/* Inline so the button keeps its own text colour — a spinner that hard-codes a
   colour reads wrong on the white ghost button and the gradient one alike. */
function Spin() {
  return (
    <span
      aria-hidden
      style={{
        width: 13, height: 13, display: 'inline-block', verticalAlign: '-2px',
        border: '2px solid currentColor', borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'tplspin .7s linear infinite',
        marginRight: 6, opacity: .85,
      }}
    />
  );
}

const STEPS = [
  { key: 1, label: 'Setup',                 sub: 'Basic information' },
  { key: 2, label: 'Lifecycle & Signing',   sub: 'Trigger + approval workflow' },
  { key: 3, label: 'Template Design',       sub: 'Content + placeholders' },
];

/** Max length of a template name. Enforced on the input, in validateStep and by
 *  the API (`max:100` on HrDocumentTemplateController's store/update rules) —
 *  long names were breaking the template card and list layouts. */
const TEMPLATE_NAME_MAX = 100;

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
  const [headerConfig, setHeaderConfig] = useState<HeaderConfig>(DEFAULT_HEADER);
  const [footerConfig, setFooterConfig] = useState<FooterConfig>(DEFAULT_FOOTER);
  const [uploadingDocx, setUploadingDocx] = useState(false);
  // True when Step 3's header/footer was prefilled from the tenant's last
  // template (create only) — drives the "reused / start blank" hint.
  const [brandingFromLast, setBrandingFromLast] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const docxRef = useRef<HTMLInputElement | null>(null);

  // Lookups
  const [triggerPoints, setTriggerPoints] = useState<Array<{ id: number; module_name: string; status: string }>>([]);
  // `roles` is kept around so the signing-flow preview can still resolve a
  // label for legacy rows that have `role_id` but no `role_name` set.
  // Designation lookup was dropped along with the designation column.
  const [roles, setRoles]                 = useState<Array<{ id: number; name: string }>>([]);
  const [loadError, setLoadError]         = useState<string | null>(null);

  // ── Load lookups (always — independent of edit-vs-create) ──────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tpRes, rolesRes] = await Promise.all([
          api.get('/master/trigger_point').catch(() => ({ data: [] })),
          api.get('/master/roles').catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const tps: any[]  = Array.isArray(tpRes.data) ? tpRes.data : [];
        const rls: any[]  = Array.isArray(rolesRes.data) ? rolesRes.data : [];
        const isActive = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';
        setTriggerPoints(tps.filter(isActive).map(r => ({ id: r.id, module_name: r.module_name, status: r.status })));
        setRoles(rls.filter(isActive).map(r => ({ id: r.id, name: r.name })));
      } catch { /* lookups are best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load the template row (edit mode only) ─────────────────────────────────
  // Independent from lookups so a 403 on /master/roles can't suppress the
  // edit data. Errors surface inline so the user can see what went wrong
  // (the old version silently bounced back to the list).
  useEffect(() => {
    if (!editingId) { setBootstrapping(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const { data: row } = await api.get<TemplateRow>(`/hr-document-templates/${editingId}`);
        if (cancelled) return;
        if (!row || typeof row !== 'object') {
          throw new Error('Empty response from /hr-document-templates/' + editingId);
        }
        setEditing(row);
        setName(row.name || '');
        setDescription(row.description || '');
        setCode(row.code || '');
        setCategory((row.employee_category as EmployeeCategory) || 'IT');
        setRoleType((row.role_type as RoleType) || 'Intern / Trainee');
        setIsMandatory(!!row.is_mandatory);
        setRequiresSig(!!row.requires_signature);
        setRequiresMgr(!!row.requires_manager_approval);
        setIncludeAudit(!!row.include_in_audit);
        setTriggerPointId(row.trigger_point_id ?? '');
        setSigningMode((row.signing_mode as SigningMode) || 'Sequential');

        // signers can come back as a JSON string (sqlite without cast, manual
        // DB edit, etc.) — be defensive so a stringified value doesn't blank
        // the wizard. Falls back to one empty row if parsing fails.
        let signerArr: SignerRow[] = [];
        const raw = row.signers as any;
        if (Array.isArray(raw)) signerArr = raw as SignerRow[];
        else if (typeof raw === 'string' && raw.trim()) {
          try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) signerArr = parsed; } catch { /* swallow */ }
        }
        setSigners(signerArr.length
          ? signerArr
          : [{ role_id: null, designation_id: null, role_name: '', designation_name: '', action: 'Sign', days: 3 }]);

        setEditorMode(row.editor_mode || 'web');
        setContentHtml(row.content_html || '');

        // Header / footer — merge over defaults so missing keys (older rows
        // saved before this column existed) still render correctly.
        setHeaderConfig({ ...DEFAULT_HEADER, ...(row.header_config || {}) } as HeaderConfig);
        setFooterConfig({ ...DEFAULT_FOOTER, ...(row.footer_config || {}) } as FooterConfig);
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.response?.data?.message
          || (err?.response?.status === 404 ? 'Template not found or you do not have access to it.'
              : err?.response?.status === 403 ? 'You do not have permission to view this template.'
              : err?.message || 'Could not load template');
        console.error('[doc-templates] load failed', editingId, err);
        setLoadError(msg);
        toast.error('Could not load template', msg);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // ── Prefill header/footer from the last template (create only) ────────────
  // Reuse the tenant's most recent letterhead so a new template doesn't require
  // re-uploading the logo / re-typing the footer every time. Still fully
  // editable, and resettable to blank via the Step 3 hint.
  useEffect(() => {
    if (editingId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/hr-document-templates/last-branding');
        if (cancelled || !data) return;
        if (data.header_config) { setHeaderConfig({ ...DEFAULT_HEADER, ...data.header_config } as HeaderConfig); setBrandingFromLast(true); }
        if (data.footer_config) { setFooterConfig({ ...DEFAULT_FOOTER, ...data.footer_config } as FooterConfig); }
      } catch { /* no previous template — keep the blank defaults */ }
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
  // Every "Sign" signer configured in Step 2 must have its {{SignerNSign}}
  // placeholder somewhere in the design — otherwise, at signing time the person
  // is in the workflow but has no spot to sign. Returns the signers still
  // missing a signature placeholder.
  const missingSignerSlots = (): string[] => {
    if (!requiresSig) return [];
    const html = contentHtml || '';
    const out: string[] = [];
    signers.forEach((s, i) => {
      if ((s.action || 'Sign').toString().toLowerCase() !== 'sign') return;
      const n = i + 1;
      if (!html.includes(`{{Signer${n}Sign}}`)) out.push(s.role_name?.trim() || `Signer ${n}`);
    });
    return out;
  };

  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!name.trim()) e.name = 'Template name is required';
      // Backstop for the maxLength on the input — a paste can still land a
      // longer value in some browsers, and an over-long name breaks the card
      // and list layouts downstream.
      else if (name.trim().length > TEMPLATE_NAME_MAX) e.name = `Template Name cannot exceed ${TEMPLATE_NAME_MAX} characters.`;
      if (!category) e.employee_category = 'Required';
      if (!roleType) e.role_type = 'Required';
    }
    if (s === 2) {
      if (!triggerPointId) e.trigger_point_id = 'Select a lifecycle event';
      // Signing workflow must have at least one signer with a role selected —
      // a blank signer row (the default) doesn't count. The form seeds one
      // empty row, so length alone isn't enough to guarantee a real role.
      if (requiresSig) {
        const hasRole = signers.some(s =>
          (s.role_name && s.role_name.trim() !== '')
          || s.role_id != null
          || (s.designation_name && s.designation_name.trim() !== '')
          || s.designation_id != null
        );
        if (!hasRole) e.signers = 'Add at least one signer and select its role';
      }
    }
    if (s === 3) {
      const missing = missingSignerSlots();
      if (missing.length) {
        e.signers_placeholders = `Add a signature placeholder for each signer in the design: ${missing.join(', ')}.`;
      }
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
      header_config: headerConfig,
      footer_config: footerConfig,
    };
    if (status) payload.status = status;
    return payload;
  };

  const handleSubmit = async (asDraft: boolean) => {
    /* A draft skips the checks for steps the user has not reached — that is what
       makes it a draft — but NOT the step they are standing on.
       Two reasons. It saved from an untouched step 2 with no trigger and no
       signers, which reads as nothing happening even though a toast says
       "saved". And the payload is built from the whole form, so that save wrote
       trigger_point_id: null and signers: [] over whatever the template already
       had — a draft save could quietly erase a finished signing workflow.
       Validating just the current step keeps partial work savable while making
       it impossible to save a step you have left blank.

       Steps 1-2 only. Step 3's rule is "every signer has a signature
       placeholder in the design", which is a completeness check for PUBLISHING
       — it protects no stored data, and applying it here blocked the exact
       thing a step-3 draft is for: parking an uploaded DOCX before the
       placeholders have been dropped in. */
    if (asDraft && step <= 2 && !validateStep(step)) return;
    if (!asDraft && !validateStep(1)) { setStep(1); return; }
    if (!asDraft && !validateStep(2)) { setStep(2); return; }
    // Block publishing a template whose signers have no signature spot in the
    // design — you'd configure a signer who then can't actually sign.
    if (!asDraft && !validateStep(3)) {
      setStep(3);
      const missing = missingSignerSlots();
      toast.error(
        'Add a signature spot for every signer',
        missing.length
          ? `Insert the signature placeholder for: ${missing.join(', ')}. Use the “Workflow Signers” panel to drop {{Signer N Sign}} into the design.`
          : 'Each signer needs a signature placeholder in the template design.',
      );
      return;
    }
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
      } else if (!asDraft) {
        navigate('/hr/doc-templates');
      }
      /* A draft save STAYS on the form. It used to navigate back to the list,
         so saving a draft from step 2 threw the user out of the wizard mid-edit
         — which reads as the form closing on you rather than saving. Only
         Publish / Update finishes and leaves. */
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
  // Make sure a server-side row exists so the DOCX has something to attach to.
  // If the template hasn't been saved yet, auto-create it as a Draft instead of
  // forcing the user to click "Save as Draft" first.
  const ensureSavedDraft = async (): Promise<TemplateRow | null> => {
    // The backend needs at least the Step 1 basics to create/update a row.
    if (!validateStep(1)) {
      setStep(1);
      toast.error('Add the basics first', 'Fill in the template name, category and role before uploading a DOCX.');
      return null;
    }
    try {
      // Persist the CURRENT form state (incl. a just-uploaded header logo) so
      // the download/upload reflects what's on screen — previously this returned
      // the cached `editing` row, so a logo added after the last save never made
      // it into the rendered Word file. Pass no status to avoid downgrading an
      // Active template back to Draft on an existing row.
      if (editing) {
        const { data } = await api.put(`/hr-document-templates/${editing.id}`, buildPayload(null));
        setEditing(data);
        return data as TemplateRow;
      }
      const { data } = await api.post('/hr-document-templates', buildPayload('Draft'));
      setEditing(data);
      navigate(`/hr/doc-templates/${data.id}/edit`, { replace: true });
      return data as TemplateRow;
    } catch (err: any) {
      toast.error('Could not save draft', err?.response?.data?.message || 'Please try again.');
      return null;
    }
  };

  const downloadDocx = async () => {
    if (downloadingDocx) return;            // ignore repeat clicks while in flight
    // Flip the loader on FIRST so it covers the whole operation — the draft
    // auto-save (PUT) AND the blob download — and keeps the button disabled
    // so the user can't fire multiple download requests.
    setDownloadingDocx(true);
    let row;
    try {
      row = await ensureSavedDraft();
    } catch {
      setDownloadingDocx(false);
      return;
    }
    if (!row) { setDownloadingDocx(false); return; }
    try {
      const resp = await api.get(`/hr-document-templates/${row.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${row.code || 'template'}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDownloadingDocx(false);
    }
  };

  const uploadDocx = async (file: File) => {
    // Flip the loader on FIRST so it covers the whole operation — the draft
    // auto-save (PUT) AND the upload/parse (POST) — not just the POST.
    setUploadingDocx(true);
    let row;
    try {
      row = await ensureSavedDraft();
    } catch {
      setUploadingDocx(false);
      return;
    }
    if (!row) { setUploadingDocx(false); return; }
    const fd = new FormData();
    fd.append('docx', file);
    try {
      const { data } = await api.post(`/hr-document-templates/${row.id}/upload-docx`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setContentHtml(data.content_html || '');
      // If the user edited the logo / title / footer inside Word, the backend
      // lifts those back into header_config / footer_config — refresh the
      // preview so the revised header & footer show without a reload.
      if (data.header_config) setHeaderConfig({ ...DEFAULT_HEADER, ...data.header_config } as HeaderConfig);
      if (data.footer_config) setFooterConfig({ ...DEFAULT_FOOTER, ...data.footer_config } as FooterConfig);
      setEditorMode('word');
      setEditing(data);
      toast.success('Revised DOCX uploaded', `Imported ${data.docx_original_name}.`);
    } catch (err: any) {
      toast.error('Could not upload', err?.response?.data?.message || 'Please try again.');
    } finally {
      setUploadingDocx(false);
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
      <div className="rec-page tpl-form-page">
        {/* Header bar shimmer — mirrors the gradient strip + step indicators. */}
        <Card className="mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 22px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)' }}>
            <div className="d-flex align-items-center gap-3">
              <Shimmer width={36} height={36} radius={10} />
              <Shimmer width={44} height={44} radius={12} />
              <div className="flex-grow-1">
                <Shimmer height={18} width="38%" />
                <div style={{ height: 6 }} />
                <Shimmer height={11} width="22%" />
              </div>
            </div>
          </div>
          <CardBody>
            <div className="d-flex align-items-center gap-4 flex-wrap">
              {[0, 1, 2].map(i => (
                <div key={i} className="d-flex align-items-center gap-2">
                  <Shimmer width={30} height={30} radius={999} />
                  <Shimmer height={12} width={90} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        {/* Form body shimmer — a grid of label + field rows. */}
        <Card style={{ borderRadius: 14, position: 'relative' }}>
          <CardBody>
            <div className="row g-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div className="col-md-6" key={i}>
                  <Shimmer height={11} width="35%" />
                  <div style={{ height: 8 }} />
                  <Shimmer height={40} radius={8} />
                </div>
              ))}
              <div className="col-12">
                <Shimmer height={11} width="20%" />
                <div style={{ height: 8 }} />
                <Shimmer height={120} radius={10} />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Fetched but failed — show the actual error so the user can see why the
  // form is empty (instead of silently rendering blank fields).
  if (editingId && !editing && loadError) {
    return (
      <div className="rec-page" style={{ padding: 24 }}>
        <Card>
          <CardBody>
            <div className="d-flex align-items-start gap-3">
              <i className="ri-error-warning-line" style={{ fontSize: 28, color: '#ef4444' }} />
              <div className="flex-grow-1">
                <h5 className="mb-1">Could not load template #{editingId}</h5>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{loadError}</div>
              </div>
              <button type="button" onClick={() => navigate('/hr/doc-templates')}
                style={{ padding: '7px 14px', background: '#6366f1', border: 0, borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Back to list
              </button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="rec-page tpl-form-page">
      <TplFormDarkStyles />
      {/* Header bar — replaces the modal's gradient strip */}
      <Card className="mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-center gap-3 min-w-0">
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
            {/* Back sits on the RIGHT, with the step pill — the left of the bar
                is the page's identity (icon, title, step count) and an escape
                hatch wedged in front of it read as part of that title. */}
            <div className="d-flex align-items-center gap-2 flex-shrink-0">
              <span style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,0.20)', padding: '5px 12px', borderRadius: 999, fontWeight: 700 }}>{STEPS[step - 1].label}</span>
              <Tooltip label="Back to templates">
                <button type="button" onClick={() => navigate('/hr/doc-templates')}
                  style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', cursor: 'pointer' }}
                  aria-label="Back to templates">
                  <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="tpl-step-strip" style={{ padding: '14px 22px', background: '#fff' }}>
          <div className="d-flex align-items-center" style={{ gap: 18, flexWrap: 'wrap' }}>
            {STEPS.map(s => {
              const active = step === s.key;
              const done = step > s.key;
              return (
                <button key={s.key} type="button"
                  onClick={() => { if (done || active) setStep(s.key); }}
                  disabled={!done && !active}
                  className={`tpl-step-btn d-inline-flex align-items-center${active ? ' is-active' : done ? ' is-done' : ' is-todo'}`}
                  style={{ gap: 8, padding: '4px 8px', border: 0, background: 'transparent',
                    color: active ? '#4338ca' : (done ? '#6366f1' : '#9ca3af'),
                    cursor: (done || active) ? 'pointer' : 'default' }}>
                  <span className={`tpl-step-circle${active ? ' is-active' : done ? ' is-done' : ' is-todo'}`}
                    style={{ width: 28, height: 28, borderRadius: '50%',
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
              addSigner={addSigner} updateSigner={updateSigner} removeSigner={removeSigner}
              previewSigners={previewSigners}
              errors={errors}
            />
          )}
          {step === 3 && (
            <Step3
              editorMode={editorMode} setEditorMode={setEditorMode}
              contentHtml={contentHtml} setContentHtml={setContentHtml}
              headerConfig={headerConfig} setHeaderConfig={setHeaderConfig}
              footerConfig={footerConfig} setFooterConfig={setFooterConfig}
              signers={signers}
              slotError={errors.signers_placeholders}
              editingId={editing?.id || null}
              docxName={editing?.docx_original_name || null}
              docxRef={docxRef}
              onDownloadDocx={downloadDocx}
              onUploadDocx={uploadDocx}
              uploadingDocx={uploadingDocx}
              downloadingDocx={downloadingDocx}
              brandingFromLast={brandingFromLast}
              onResetBranding={() => { setHeaderConfig(DEFAULT_HEADER); setFooterConfig(DEFAULT_FOOTER); setBrandingFromLast(false); }}
            />
          )}
        </CardBody>

        {/* While a save is in flight nothing on this page is clickable.
            Disabling the footer buttons alone was not enough: the form fields,
            the step tabs and the signer rows all stayed live, so a value could
            be changed after the payload had been built and the user would be
            looking at a form that no longer matched what was being written. */}
        {saving && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(255,255,255,.55)', backdropFilter: 'blur(1px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'wait',
          }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              padding: '9px 16px', borderRadius: 10, background: '#fff',
              border: '1px solid #e5e7eb', boxShadow: '0 6px 20px rgba(16,24,40,.10)',
              fontSize: 12.5, fontWeight: 700, color: '#4338ca',
            }}>
              <Spin /> Saving…
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="tpl-form-footer" style={{ padding: 14, borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderRadius: '0 0 14px 14px' }}>
          <button type="button" onClick={() => handleSubmit(true)} disabled={saving}
            className="tpl-btn-ghost"
            style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            {saving ? <><Spin /> Saving…</> : <><i className="ri-draft-line me-1" /> Save as Draft</>}
          </button>
          <div className="d-flex gap-2">
            <button type="button" onClick={() => navigate('/hr/doc-templates')} disabled={saving}
              className="tpl-btn-ghost"
              style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={handleBack} disabled={step === 1 || saving}
              className="tpl-btn-ghost"
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
                {saving ? <><Spin /> Saving…</> : (editing ? 'Update Template' : 'Publish Template')}
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
      {/* Employee category — full-width card */}
      <section className="tpl-section" style={sectionStyle}>
        <div style={sectionLabel}>1. Employee Category <span style={req}>*</span></div>
        <div className="row g-2">
          {CATEGORIES.map(c => {
            const active = props.category === c.value;
            return (
              <div key={c.value} className="col-md-4">
                <button type="button" onClick={() => props.setCategory(c.value)}
                  className={`tpl-pick-card${active ? ' is-active' : ''}`}
                  style={{ width: '100%', padding: '16px 12px', borderRadius: 10,
                    border: '2px solid ' + (active ? '#6366f1' : '#e5e7eb'),
                    background: active ? '#eef2ff' : '#fff',
                    cursor: 'pointer', textAlign: 'center', transition: 'all .15s ease' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
                  <div className="tpl-pick-card-label" style={{ fontWeight: 700, fontSize: 13.5, color: active ? '#4338ca' : '#374151' }}>{c.label}</div>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Role / Designation — full-width card, six designation levels */}
      <section className="tpl-section" style={sectionStyle}>
        <div style={sectionLabel}>2. Role / Designation Type <span style={req}>*</span></div>
        <div className="row g-2">
          {ROLE_TYPES.map(r => {
            const active = props.roleType === r.value;
            return (
              <div key={r.value} className="col-lg-2 col-md-4 col-sm-6">
                <button type="button" onClick={() => props.setRoleType(r.value)}
                  className={`tpl-pick-card${active ? ' is-active' : ''}`}
                  style={{ width: '100%', padding: '14px 10px', borderRadius: 10,
                    border: '2px solid ' + (active ? '#6366f1' : '#e5e7eb'),
                    background: active ? '#eef2ff' : '#fff',
                    cursor: 'pointer', textAlign: 'center', minHeight: 92 }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{r.icon}</div>
                  <div className="tpl-pick-card-label" style={{ fontWeight: 700, fontSize: 12, color: active ? '#4338ca' : '#374151', lineHeight: 1.2 }}>{r.label}</div>
                </button>
              </div>
            );
          })}
        </div>
        {props.errors.role_type && <div style={errMsg}>{props.errors.role_type}</div>}
      </section>

      {/* Bottom row — two columns: basic info (left) + settings (right). The
          row uses align-items: stretch so both cards rise to the same height. */}
      <div className="row g-3 align-items-stretch">
        <div className="col-lg-7">
          <section className="tpl-section" style={{ ...sectionStyle, marginBottom: 0, height: '100%' }}>
            <div style={sectionLabel}>3. Basic Information</div>
            <div className="mb-3">
              <label className="tpl-field-label" style={fieldLabel}>Template Name <span style={req}>*</span></label>
              {/* Hard-capped at 100 chars: maxLength blocks typing past it, and
                  the slice covers a paste that overshoots. */}
              <input type="text" value={props.name}
                onChange={e => props.setName(e.target.value.slice(0, TEMPLATE_NAME_MAX))}
                maxLength={TEMPLATE_NAME_MAX}
                placeholder="e.g. Internship Offer Letter (November)"
                className="tpl-input"
                style={inputStyle(!!props.errors.name)} />
              <div className="d-flex align-items-center justify-content-between gap-2">
                <div>{props.errors.name && <div style={errMsg}>{props.errors.name}</div>}</div>
                <div className="tpl-hint" style={{ fontSize: 11, color: props.name.length >= TEMPLATE_NAME_MAX ? '#dc2626' : '#9ca3af', marginTop: 4 }}>
                  {props.name.length}/{TEMPLATE_NAME_MAX}
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label className="tpl-field-label" style={fieldLabel}>Template Code</label>
              <input type="text" value={props.code} readOnly
                className="tpl-code-field"
                style={{ ...inputStyle(false), background: '#fef9c3', color: '#a16207', fontFamily: 'monospace', fontWeight: 700, border: '1px solid #fde68a' }} />
              <div className="tpl-hint" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Auto-generated per category + role.</div>
            </div>
            <div>
              <label className="tpl-field-label" style={fieldLabel}>Description</label>
              <textarea value={props.description} onChange={e => props.setDescription(e.target.value)}
                placeholder="Short note describing when this template is used…"
                rows={3} className="tpl-input" style={{ ...inputStyle(false), resize: 'vertical' }} />
            </div>
          </section>
        </div>

        <div className="col-lg-5">
          <section className="tpl-section" style={{ ...sectionStyle, marginBottom: 0, height: '100%' }}>
            <div style={sectionLabel}>4. Settings</div>
            <Toggle on={props.isMandatory}  setOn={props.setIsMandatory}  title="Mandatory Document"          sub="Must be completed as part of onboarding/offboarding" />
            <Toggle on={props.requiresSig}  setOn={props.setRequiresSig}  title="Requires Employee Signature" sub="Digital or physical signature required" />
            <Toggle on={props.requiresMgr}  setOn={props.setRequiresMgr}  title="Requires Manager Approval"   sub="Manager must review and approve before sending" />
            <Toggle on={props.includeAudit} setOn={props.setIncludeAudit} title="Include in Audit Trail"      sub="Track all generation and signing events" />
          </section>
        </div>
      </div>
    </>
  );
}

function Toggle({ on, setOn, title, sub }: { on: boolean; setOn: (v: boolean) => void; title: string; sub: string }) {
  return (
    <label className="tpl-toggle" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, background: '#fff', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: '#6366f1' }} />
      <div>
        <div className="tpl-toggle-title" style={{ fontSize: 13.5, fontWeight: 700, color: '#374151' }}>{title}</div>
        <div className="tpl-toggle-sub" style={{ fontSize: 12, color: '#6b7280' }}>{sub}</div>
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
  addSigner: () => void;
  updateSigner: (i: number, patch: Partial<SignerRow>) => void;
  removeSigner: (i: number) => void;
  previewSigners: { label: string; action: string }[];
  errors: Record<string, string>;
}) {
  const triggerOptions = props.triggerPoints.map(tp => ({ value: String(tp.id), label: tp.module_name }));

  // Fixed signer-role catalogue — three canonical roles used across every
  // template, independent of the (much larger) master_roles table. Storing
  // them as `role_name` strings keeps the signers JSON portable across
  // tenants that don't share the same master_roles ids.
  //
  // Self-healing: a template saved under an earlier UI may carry role names
  // outside this trio (e.g. a name pulled from master_roles, or a legacy
  // action label). Pull those values off the live signers list and add them
  // as extra options so the dropdown shows the saved value instead of going
  // blank. Marking them "(legacy)" nudges the admin to migrate.
  const CANONICAL_ROLES   = ['Reporting Manager', 'Client (CEO)', 'Employee'];
  const CANONICAL_ACTIONS = ['Sign', 'Review & Acknowledge', 'Approve'];

  const extraRoles = Array.from(new Set(
    props.signers.map(s => (s.role_name || '').trim()).filter(v => v && !CANONICAL_ROLES.includes(v))
  ));
  const extraActions = Array.from(new Set(
    props.signers.map(s => (s.action || '').trim()).filter(v => v && !CANONICAL_ACTIONS.includes(v))
  ));

  const roleOptions = [
    ...CANONICAL_ROLES.map(v => ({ value: v, label: v })),
    ...extraRoles.map(v => ({ value: v, label: `${v} (legacy)` })),
  ];
  const actionOptions = [
    ...CANONICAL_ACTIONS.map(v => ({ value: v, label: v })),
    ...extraActions.map(v => ({ value: v, label: `${v} (legacy)` })),
  ];

  return (
    <>
      {/* Lifecycle event */}
      <section className="tpl-section" style={sectionStyle}>
        <div style={sectionLabel}>HR Lifecycle Event <span style={req}>*</span></div>
        <div className="row g-0">
          <div className="col-md-8">
            <div className="d-flex align-items-center gap-3">
              <label className="tpl-field-label" style={{ ...fieldLabel, marginBottom: 0, whiteSpace: 'nowrap' }}>Trigger</label>
              <div className="flex-grow-1">
                <MasterSelect
                  value={props.triggerPointId ? String(props.triggerPointId) : ''}
                  onChange={(v) => props.setTriggerPointId(v ? Number(v) : '')}
                  options={triggerOptions}
                  placeholder="— Select trigger —"
                  invalid={!!props.errors.trigger_point_id}
                />
              </div>
            </div>
            {props.errors.trigger_point_id && <div style={errMsg}>{props.errors.trigger_point_id}</div>}
          </div>
        </div>
      </section>

      {/* Signing workflow */}
      <section className="tpl-sign-card" style={{ borderRadius: 12, marginBottom: 16, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
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

        <div className="tpl-sign-body" style={{ padding: 14, background: '#fff' }}>
          <div className="tpl-sign-header" style={{ display: 'grid', gridTemplateColumns: '36px 1.6fr 1.2fr 100px 36px', gap: 10, padding: '0 6px 8px', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase' }}>
            <div>#</div><div>Role / Position <span style={{ color: '#ef4444' }}>*</span></div><div>Action</div><div>Days</div><div />
          </div>
          {props.signers.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1.6fr 1.2fr 100px 36px', gap: 10, padding: '6px', alignItems: 'center' }}>
              <span className="tpl-sign-num" style={{ width: 28, height: 28, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
              {/* Role is now a free-text string (not an id) — three canonical
                  options drive the value, and we mirror it into role_name so
                  the signing-flow preview + payload stay in sync. */}
              <MasterSelect
                value={s.role_name || ''}
                onChange={(v) => props.updateSigner(i, { role_id: null, role_name: v })}
                options={roleOptions}
                placeholder="— Select Role —"
              />
              <MasterSelect
                value={s.action}
                onChange={(v) => props.updateSigner(i, { action: v })}
                options={actionOptions}
              />
              <input type="number" min={0} max={365} value={s.days}
                onChange={e => props.updateSigner(i, { days: Number(e.target.value) || 0 })}
                className="tpl-input"
                style={inputStyle(false)} />
              <button type="button" onClick={() => props.removeSigner(i)} title="Remove"
                className="tpl-sign-remove"
                style={{ width: 30, height: 30, border: 0, borderRadius: 6, background: '#fee2e2', color: '#b91c1c', cursor: 'pointer' }}>
                <i className="ri-close-line" />
              </button>
            </div>
          ))}
          {props.errors.signers && <div style={{ ...errMsg, padding: '0 6px' }}>{props.errors.signers}</div>}

          <button type="button" onClick={props.addSigner}
            className="tpl-add-signer"
            style={{ marginTop: 8, width: '100%', padding: 10, borderRadius: 8, border: '1px dashed #c7d2fe', background: '#fafaff', color: '#4338ca', fontWeight: 700, cursor: 'pointer' }}>
            <i className="ri-add-line me-1" /> Add Signer
          </button>
        </div>

        {/* Preview */}
        {props.previewSigners.length > 0 && (
          <div className="tpl-sign-preview" style={{ padding: 12, background: '#faf5ff', borderTop: '1px solid #e5e7eb' }}>
            <div className="tpl-sign-preview-label" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Signing Flow Preview</div>
            <div className="d-flex align-items-center flex-wrap" style={{ gap: 6 }}>
              {props.previewSigners.map((p, i) => (
                <div key={i} className="d-flex align-items-center" style={{ gap: 6 }}>
                  <div className="tpl-sign-preview-pill" style={{ padding: '6px 12px', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#15803d' }}>
                    <span style={{ display: 'inline-flex', width: 18, height: 18, borderRadius: '50%', background: '#16a34a', color: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 6, fontSize: 10 }}>{i + 1}</span>
                    {p.label}
                    <div style={{ fontSize: 10.5, fontWeight: 500, color: '#16a34a' }}>{p.action}</div>
                  </div>
                  {i < props.previewSigners.length - 1 && <i className="ri-arrow-right-line tpl-sign-arrow" style={{ color: '#9ca3af' }} />}
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
  headerConfig: HeaderConfig; setHeaderConfig: (v: HeaderConfig) => void;
  footerConfig: FooterConfig; setFooterConfig: (v: FooterConfig) => void;
  signers: SignerRow[];
  slotError?: string;
  editingId: number | null;
  docxName: string | null;
  docxRef: React.RefObject<HTMLInputElement | null>;
  onDownloadDocx: () => void;
  onUploadDocx: (f: File) => void;
  uploadingDocx: boolean;
  downloadingDocx: boolean;
  brandingFromLast?: boolean;
  onResetBranding?: () => void;
}) {
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', border: '1px solid ' + (active ? '#6366f1' : '#e5e7eb'),
    background: active ? '#6366f1' : '#fff', color: active ? '#fff' : '#374151',
    borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
  });

  return (
    <>
      {props.brandingFromLast && !props.editingId && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 13px', marginBottom: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, fontSize: 12 }}>
          <span style={{ color: '#4338ca', fontWeight: 600 }}>
            <i className="ri-magic-line me-1" />Header &amp; footer reused from your last template — edit it below, or start over.
          </span>
          <button type="button" onClick={props.onResetBranding}
            style={{ border: '1px solid #c7d2fe', background: '#fff', color: '#4338ca', borderRadius: 8, padding: '4px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
            <i className="ri-eraser-line me-1" />Start blank
          </button>
        </div>
      )}
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div className="tpl-help" style={{ fontSize: 11.5, color: '#6b7280' }}>
          <i className="ri-information-line me-1" />
          Header and footer have fixed heights — click any zone in the preview to edit logo / text / styling.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`tpl-editor-tab${props.editorMode === 'web'  ? ' is-active' : ''}`} style={tabBtn(props.editorMode === 'web')}  onClick={() => props.setEditorMode('web')}><i className="ri-global-line me-1" />Web Editor</button>
          <button type="button" className={`tpl-editor-tab${props.editorMode === 'word' ? ' is-active' : ''}`} style={tabBtn(props.editorMode === 'word')} onClick={() => props.setEditorMode('word')}><i className="ri-file-word-2-line me-1" />MS Word</button>
        </div>
      </div>

      {props.slotError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#b91c1c', fontSize: 12.5 }}>
          <i className="ri-error-warning-line" style={{ marginTop: 1 }} />
          <span>{props.slotError} <strong>Drop the signature placeholder from the “Workflow Signers” panel into the document.</strong></span>
        </div>
      )}

      {props.editorMode === 'web' && (
        <HeaderFooterPanel
          header={props.headerConfig} setHeader={props.setHeaderConfig}
          footer={props.footerConfig} setFooter={props.setFooterConfig}
        >
          <TemplateEditor value={props.contentHtml} onChange={props.setContentHtml} signers={props.signers} />
        </HeaderFooterPanel>
      )}

      {props.editorMode === 'word' && (
        <>
          {/* MS Word workflow card */}
          <div className="tpl-word-card" style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, background: '#fff', marginBottom: 16 }}>
            {props.uploadingDocx && (
              <div className="tpl-upload-veil" style={{
                position: 'absolute', inset: 0, zIndex: 20, borderRadius: 12,
                background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(1px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <span className="spinner-border text-success" role="status" aria-hidden="true" />
                <div className="tpl-veil-title" style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>Uploading &amp; processing DOCX…</div>
                <div className="tpl-veil-sub" style={{ fontSize: 11.5, color: '#6b7280' }}>Extracting header, footer &amp; logo</div>
              </div>
            )}
            <div className="tpl-word-title" style={{ fontSize: 13, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>MS Word Workflow</div>
            <ol className="tpl-word-list" style={{ paddingLeft: 18, fontSize: 13, color: '#374151', lineHeight: 1.7, marginBottom: 16 }}>
              <li>Download → the generated DOCX comes pre-baked with the fixed header (logo + title) and footer</li>
              <li>Add tables, formatting, signature blocks in Word</li>
              <li>Upload revised version below — it replaces the saved DOCX and refreshes the web preview</li>
            </ol>
            <div className="d-flex gap-2 flex-wrap">
              <button type="button" onClick={props.onDownloadDocx}
                className="tpl-word-dl-btn" disabled={props.downloadingDocx || props.uploadingDocx}
                style={{ padding: '8px 16px', background: '#1f2937', color: '#fff', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: (props.downloadingDocx || props.uploadingDocx) ? 'wait' : 'pointer', opacity: (props.downloadingDocx || props.uploadingDocx) ? 0.7 : 1 }}>
                {props.downloadingDocx
                  ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" /> Generating DOCX…</>
                  : <><i className="ri-download-2-line me-1" /> Download DOCX (with header/footer)</>}
              </button>
              <input ref={props.docxRef} type="file" accept=".doc,.docx" style={{ display: 'none' }}
                disabled={props.uploadingDocx}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUploadDocx(f); e.currentTarget.value = ''; }} />
              <button type="button" onClick={() => props.docxRef.current?.click()}
                className="tpl-word-up-btn" disabled={props.uploadingDocx}
                style={{ padding: '8px 16px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: props.uploadingDocx ? 'wait' : 'pointer', opacity: props.uploadingDocx ? 0.7 : 1 }}>
                {props.uploadingDocx
                  ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" /> Uploading…</>
                  : <><i className="ri-upload-2-line me-1" /> Upload Revised DOCX</>}
              </button>
            </div>
            {!props.editingId && (
              <div className="tpl-word-warn" style={{ marginTop: 10, fontSize: 11.5, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', padding: '6px 10px', borderRadius: 8 }}>
                <i className="ri-information-line me-1" />Downloading or uploading a DOCX will auto-save this template as a draft first (template name, category and role are required).
              </div>
            )}
            {props.docxName && (
              <div className="tpl-docx-info" style={{ marginTop: 12, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12.5, color: '#374151' }}>
                <i className="ri-file-word-2-line me-1" /> Latest uploaded: <strong>{props.docxName}</strong>
              </div>
            )}
          </div>

          {/* Page preview — read-only render of the latest content with the
              fixed header/footer wrapped around it. Useful so the user can
              verify the uploaded DOCX content came through correctly. */}
          <div className="tpl-preview-label" style={{ fontSize: 11.5, fontWeight: 800, color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 4px 8px' }}>Preview</div>
          <div className="tpl-preview-wrap" style={{ position: 'relative' }}>
            {props.uploadingDocx && (
              <div className="tpl-upload-veil" style={{
                position: 'absolute', inset: 0, zIndex: 20, borderRadius: 12,
                background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(1px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}>
                <span className="spinner-border text-success" role="status" aria-hidden="true" />
                <div className="tpl-veil-title" style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>Updating preview…</div>
                <div className="tpl-veil-sub" style={{ fontSize: 11.5, color: '#6b7280' }}>Rendering revised content</div>
              </div>
            )}
            <HeaderFooterPanel
              header={props.headerConfig} setHeader={props.setHeaderConfig}
              footer={props.footerConfig} setFooter={props.setFooterConfig}
              readOnly
            >
              <div className="tpl-readonly-preview tpl-readonly-body"
                style={{ fontSize: 13.5, lineHeight: 1.6, color: '#374151', minHeight: 260 }}
                // The HTML originates from PhpWord's docxToHtml (server-controlled) +
                // the Tiptap editor's getHTML (sanitised by ProseMirror), so dangerous
                // dangerouslySetInnerHTML is acceptable here.
                dangerouslySetInnerHTML={{ __html: props.contentHtml || '<p style="color:#9ca3af;font-style:italic;">No content yet — download the DOCX, edit it in Word, then upload it back to preview here.</p>' }}
              />
            </HeaderFooterPanel>
          </div>
        </>
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

/* Dark-theme overrides for the Add / Edit Template wizard. Page is scoped via
   .tpl-form-page so the rules don't leak to other pages. Inline styles are
   beaten with !important; semantically-meaningful brand colors (purple
   gradients, status pills) stay intact under either theme. */
function TplFormDarkStyles() {
  return (
    <style>{`
      @keyframes tplspin { to { transform: rotate(360deg); } }

      [data-bs-theme="dark"] .tpl-form-page .tpl-step-strip {
        background: var(--vz-card-bg) !important;
        border-top: 1px solid var(--vz-border-color);
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-step-btn.is-todo {
        color: rgba(255,255,255,0.45) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-step-btn.is-done {
        color: #a5b4fc !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-step-btn.is-active {
        color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-step-circle.is-todo {
        background: rgba(255,255,255,0.10) !important;
        color: rgba(255,255,255,0.55) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-section {
        background: rgba(124,92,252,0.06) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-section code {
        background: rgba(255,255,255,0.08); color: #fbbf24;
        padding: 1px 6px; border-radius: 4px;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-field-label {
        color: rgba(255,255,255,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-help,
      [data-bs-theme="dark"] .tpl-form-page .tpl-hint {
        color: rgba(255,255,255,0.50) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-input {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-input::placeholder {
        color: rgba(255,255,255,0.40) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-code-field {
        background: rgba(245,158,11,0.12) !important;
        color: #fbbf24 !important;
        border-color: rgba(245,158,11,0.35) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-pick-card {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-pick-card.is-active {
        background: rgba(99,102,241,0.18) !important;
        border-color: rgba(124,92,252,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-pick-card .tpl-pick-card-label {
        color: rgba(255,255,255,0.75) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-pick-card.is-active .tpl-pick-card-label {
        color: #c4b5fd !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-toggle {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-toggle-title {
        color: rgba(255,255,255,0.90) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-toggle-sub {
        color: rgba(255,255,255,0.55) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-card {
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-body {
        background: var(--vz-card-bg) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-header {
        color: rgba(255,255,255,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-add-signer {
        background: rgba(99,102,241,0.10) !important;
        border-color: rgba(124,92,252,0.40) !important;
        color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-remove {
        background: rgba(248,113,113,0.18) !important;
        color: #fca5a5 !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-preview {
        background: rgba(124,92,252,0.10) !important;
        border-top-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-preview-label {
        color: rgba(255,255,255,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-preview-pill {
        background: rgba(34,197,94,0.18) !important;
        border-color: rgba(34,197,94,0.40) !important;
        color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-sign-arrow {
        color: rgba(255,255,255,0.40) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-editor-tab:not(.is-active) {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-word-card {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-word-title {
        color: rgba(255,255,255,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-word-list {
        color: rgba(255,255,255,0.80) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-word-dl-btn {
        background: rgba(255,255,255,0.10) !important;
        color: #fff !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-word-up-btn {
        background: rgba(34,197,94,0.18) !important;
        color: #6ee7b7 !important;
        border-color: rgba(34,197,94,0.40) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-word-warn {
        background: rgba(245,158,11,0.14) !important;
        color: #fbbf24 !important;
        border-color: rgba(245,158,11,0.35) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-docx-info {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: rgba(255,255,255,0.80) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-preview-label {
        color: #c4b5fd !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-readonly-body {
        color: rgba(255,255,255,0.85) !important;
      }
      /* Upload loader veil — dark surface + lighter text so it doesn't flash
         white over the dark card/preview. */
      [data-bs-theme="dark"] .tpl-form-page .tpl-upload-veil {
        background: rgba(17,24,39,0.82) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-upload-veil .tpl-veil-title {
        color: #6ee7b7 !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-upload-veil .tpl-veil-sub {
        color: rgba(255,255,255,0.62) !important;
      }

      [data-bs-theme="dark"] .tpl-form-page .tpl-form-footer {
        background: var(--vz-secondary-bg) !important;
        border-top-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-form-page .tpl-btn-ghost {
        background: var(--vz-card-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
    `}</style>
  );
}
