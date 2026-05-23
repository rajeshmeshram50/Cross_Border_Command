import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import Tooltip from '../../components/ui/Tooltip';
import { SimpleDescModal } from './clmCommon';

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
  party: string;
  regulatory: 'highly' | 'less';
  signing: boolean;
  segment: string | null;
  agr_status: string;
  content: string | null;
};

const BUYER_SIDE = [
  { value: 'Buyer',             label: 'Buyer',            icon: '👤' },
  { value: 'Consignee Only',    label: 'Consignee Only',   icon: '🚚' },
  { value: 'Buyer + Consignee', label: 'Buyer + Consignee',icon: '👥' },
];
const SUPPLIER_SIDE = [
  { value: 'Supplier — Material', label: 'Supplier — Material', icon: '📦' },
  { value: 'Supplier — Logistic', label: 'Supplier — Logistic', icon: '🚛' },
];
const COMBINED_SCOPE = [
  { value: 'Buyer + Supplier (Material)',       label: 'Buyer + Supplier (Material)',     icon: '🤝' },
  { value: 'Buyer + Consignee + Supplier',      label: 'Buyer + Consignee + Supplier',    icon: '🌐' },
];

const STEPS = [
  { key: 1, label: 'Agreement Basic Details', sub: 'Type, title, parties & signing' },
  { key: 2, label: 'Draft Agreement Content', sub: 'Rich text editor & placeholders' },
];

interface Props {
  open: boolean;
  existing: AgrLib | null;
  types: AgrType[];
  knownSegments: string[];
  nextCode: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ClmAgreementWizardModal({ open, existing, types: initialTypes, knownSegments, nextCode, onClose, onSaved }: Props) {
  const toast = useToast();
  const editingId = existing?.id ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [types, setTypes] = useState<AgrType[]>(initialTypes);

  // Step 1 fields
  const [agreementType, setAgreementType] = useState('');
  const [title, setTitle]                 = useState('');
  const [regulatory, setRegulatory]       = useState<'highly' | 'less'>('less');
  const [purpose, setPurpose]             = useState('');
  const [parties, setParties]             = useState<Set<string>>(new Set());
  const [segment, setSegment]             = useState<string>('');

  // Signing workflow — backend `signing` is derived from these UI-facing
  // flags. The rest are presentation-only and travel with the content as a
  // small metadata block so they're not lost on save.
  const [sequential, setSequential]       = useState(true);
  const [digitalSig, setDigitalSig]       = useState(true);
  const [validityPeriod, setValidityPeriod] = useState('1 Year');
  const [renewalType, setRenewalType]     = useState('Auto-Renew');
  const [noticePeriod, setNoticePeriod]   = useState('30 Days');

  // Step 2 fields
  const [content, setContent]                 = useState('');
  const [placeholderOpen, setPlaceholderOpen] = useState(false);
  const [clauseOpen, setClauseOpen]           = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [quickAddTypeOpen, setQuickAddTypeOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '<p></p>',
    onUpdate({ editor }) { setContent(editor.getHTML()); },
  });

  // Reset/hydrate on open
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErrors({});
    setSaving(false);
    if (existing) {
      setAgreementType(existing.agreement_type ?? '');
      setTitle(existing.title ?? '');
      setRegulatory(existing.regulatory ?? 'less');
      setPurpose('');
      setParties(new Set((existing.party ?? '').split(',').map(s => s.trim()).filter(Boolean)));
      setSegment(existing.segment ?? '');
      setContent(existing.content ?? '');
      // Try to recover the previously-saved signing metadata from the
      // leading <!-- AGW-META: {...} --> comment we embed on save. If the
      // comment isn't present (older rows), keep the defaults.
      const meta = parseMetaFromContent(existing.content ?? '');
      setSequential(meta?.sequential ?? (existing.signing ?? true));
      setDigitalSig(meta?.digitalSig ?? (existing.signing ?? true));
      setValidityPeriod(meta?.validityPeriod ?? '1 Year');
      setRenewalType(meta?.renewalType ?? 'Auto-Renew');
      setNoticePeriod(meta?.noticePeriod ?? '30 Days');
    } else {
      setAgreementType('');
      setTitle('');
      setRegulatory('less');
      setPurpose('');
      setParties(new Set());
      setSegment('');
      setContent('');
      setSequential(true);
      setDigitalSig(true);
      setValidityPeriod('1 Year');
      setRenewalType('Auto-Renew');
      setNoticePeriod('30 Days');
    }
    if (editor) editor.commands.setContent(existing?.content || '<p></p>', { emitUpdate: false });
  }, [open, existing, editor]);

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

  const segmentOptions = useMemo(() => {
    const set = new Set<string>(knownSegments);
    if (segment) set.add(segment);
    return Array.from(set).filter(Boolean).map(s => ({ value: s, label: s }));
  }, [knownSegments, segment]);

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
    () => [...BUYER_SIDE, ...SUPPLIER_SIDE, ...COMBINED_SCOPE].map(p => p.value),
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
    if (!title.trim())          next.title         = 'Title is required';
    if (parties.size === 0)     next.party         = 'Select at least one applicable party';
    if (regulatory === 'highly' && !segment.trim()) next.segment = 'High-regulatory agreements need a specific segment';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => { if (validateStep1()) setStep(2); };
  const goBack = () => setStep(1);

  const insertPlaceholderToken = (token: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(token + ' ').run();
  };

  const handleSave = async () => {
    if (!validateStep1()) { setStep(1); return; }
    setSaving(true);
    // Strip any previous meta comment from the editor's content so we don't
    // accumulate duplicates on every edit, then prepend a fresh one.
    const strippedContent = stripMetaFromContent(content?.trim() || '');
    const meta = { sequential, digitalSig, validityPeriod, renewalType, noticePeriod };
    const metaComment = `<!-- AGW-META: ${JSON.stringify(meta)} -->`;
    const purposeBlock = purpose.trim()
      ? `<p><strong>Purpose:</strong> ${escapeHtml(purpose.trim())}</p>`
      : '';
    const signingLabel = [sequential ? 'Sequential' : null, digitalSig ? 'Digital' : null].filter(Boolean).join(' · ') || 'None';
    const signingBlock = `<p><strong>Signing:</strong> ${signingLabel} · <strong>Validity:</strong> ${escapeHtml(validityPeriod)} · <strong>Renewal:</strong> ${escapeHtml(renewalType)} · <strong>Notice:</strong> ${escapeHtml(noticePeriod)}</p>`;
    const finalContent = (metaComment + purposeBlock + signingBlock + strippedContent) || null;
    // Backend `signing` is true whenever any signing flow is enabled
    const signingFlag = sequential || digitalSig;
    const payload: Omit<AgrLib, 'id' | 'code'> = {
      agreement_type: agreementType.trim(),
      title:          title.trim(),
      party:          Array.from(parties).join(', '),
      regulatory,
      signing:        signingFlag,
      segment:        regulatory === 'highly' ? (segment.trim() || null) : null,
      agr_status:     'Active',
      content:        finalContent,
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
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <style>{AGW_CSS}</style>
      <div className="agw-shell" onMouseDown={e => e.stopPropagation()}>
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
        <div className="agw-body">
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
                    <input type="radio" name="agw-reg" checked={regulatory === 'highly'} onChange={() => setRegulatory('highly')} />
                    <span className="agw-reg-opt-dot" />
                    <div>
                      <div className="agw-reg-opt-title">High Regulatory</div>
                      <div className="agw-reg-opt-sub">Requires specific segment &amp; compliance review</div>
                    </div>
                  </label>
                  <label className={`agw-reg-opt agw-reg-less ${regulatory === 'less' ? 'is-on' : ''}`}>
                    <input type="radio" name="agw-reg" checked={regulatory === 'less'} onChange={() => setRegulatory('less')} />
                    <span className="agw-reg-opt-dot" />
                    <div>
                      <div className="agw-reg-opt-title">Less Regulatory</div>
                      <div className="agw-reg-opt-sub">Applicable to all standard segments by default</div>
                    </div>
                  </label>
                </div>
                {regulatory === 'highly' && (
                  <div className="agw-field" style={{ marginTop: 12 }}>
                    <label className="agw-label">Segment <span className="agw-req">*</span></label>
                    <MasterSelect
                      key={`agw-seg-${segmentOptions.length}`}
                      value={segment}
                      invalid={!!errors.segment}
                      placeholder="— Select Segment —"
                      options={segmentOptions}
                      onChange={(v) => { setSegment(v); setErrors(p => ({ ...p, segment: '' })); }}
                    />
                    {errors.segment && <div className="agw-err">{errors.segment}</div>}
                  </div>
                )}
              </div>

              <div className="agw-field">
                <label className="agw-label">Agreement Purpose <span className="agw-req">*</span></label>
                <textarea
                  className="agw-input agw-textarea"
                  placeholder="e.g. Governs supplier material sourcing terms for the FY2026 procurement cycle…"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
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
                  <div className="agw-party-label agw-party-label-buyer">BUYER SIDE</div>
                  <div className="agw-party-options">
                    {BUYER_SIDE.map(p => (
                      <label key={p.value} className={`agw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="agw-checkbox-emoji">{p.icon}</span>
                        <span className="agw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="agw-party-row">
                  <div className="agw-party-label agw-party-label-supplier">SUPPLIER SIDE</div>
                  <div className="agw-party-options">
                    {SUPPLIER_SIDE.map(p => (
                      <label key={p.value} className={`agw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="agw-checkbox-emoji">{p.icon}</span>
                        <span className="agw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="agw-party-row">
                  <div className="agw-party-label agw-party-label-combined">COMBINED SCOPE</div>
                  <div className="agw-party-options">
                    {COMBINED_SCOPE.map(p => (
                      <label key={p.value} className={`agw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="agw-checkbox-emoji">{p.icon}</span>
                        <span className="agw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="agw-party-hint">Tick "ALL" to apply to every party · or pick specific ones</div>
                {errors.party && <div className="agw-err">{errors.party}</div>}
              </div>

              {/* Signing Workflow card */}
              <div className="agw-signing">
                <div className="agw-signing-head">
                  <div className="agw-signing-head-title">
                    <span className="agw-signing-ico">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </span>
                    SIGNING WORKFLOW
                  </div>
                  <div className="agw-signing-head-toggles">
                    <label className={`agw-mini-check ${sequential ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} />
                      <span>Sequential</span>
                    </label>
                    <label className={`agw-mini-check ${digitalSig ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={digitalSig} onChange={(e) => setDigitalSig(e.target.checked)} />
                      <span>Digital Signature</span>
                    </label>
                  </div>
                </div>
                <div className="agw-signing-hint">
                  {parties.size === 0
                    ? 'Select applicable parties above to configure signing order'
                    : `Signing order will follow the ${parties.size} selected ${parties.size === 1 ? 'party' : 'parties'} above`}
                </div>

                {/* Expiry Conditions sub-card */}
                <div className="agw-expiry">
                  <div className="agw-expiry-head">
                    <span className="agw-expiry-ico">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </span>
                    EXPIRY CONDITIONS
                  </div>
                  <div className="agw-expiry-grid">
                    <div className="agw-field">
                      <label className="agw-mini-label">Validity Period</label>
                      <select className="agw-input agw-select" value={validityPeriod} onChange={(e) => setValidityPeriod(e.target.value)}>
                        {['6 Months', '1 Year', '2 Years', '3 Years', '5 Years', 'Perpetual'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="agw-field">
                      <label className="agw-mini-label">Renewal Type</label>
                      <select className="agw-input agw-select" value={renewalType} onChange={(e) => setRenewalType(e.target.value)}>
                        {['Auto-Renew', 'Manual Renewal', 'No Renewal'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="agw-field">
                      <label className="agw-mini-label">Notice Period</label>
                      <select className="agw-input agw-select" value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)}>
                        {['15 Days', '30 Days', '60 Days', '90 Days', '120 Days'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="agw-step-body">
              <AgrEditor
                editor={editor}
                onUploadWord={() => fileInputRef.current?.click()}
                onOpenPlaceholder={() => { setPlaceholderOpen(true); setClauseOpen(false); }}
                onOpenClauseLibrary={() => { setClauseOpen(o => !o); setPlaceholderOpen(false); }}
                clauseOpen={clauseOpen}
                onCloseClauseLibrary={() => setClauseOpen(false)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx,.txt,.html"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !editor) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const txt = String(reader.result ?? '');
                    if (file.name.toLowerCase().endsWith('.html')) {
                      editor.chain().focus().insertContent(txt).run();
                    } else {
                      const html = txt.split(/\r?\n/).map(line => `<p>${escapeHtml(line)}</p>`).join('');
                      editor.chain().focus().insertContent(html).run();
                    }
                    toast.success('Imported', `${file.name} loaded into the editor.`);
                  };
                  reader.onerror = () => toast.error('Read failed', 'Could not read the selected file.');
                  reader.readAsText(file);
                  e.target.value = '';
                }}
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
            onPick={(token) => { insertPlaceholderToken(token); setPlaceholderOpen(false); }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Tiptap editor sub-component for the Agreement wizard ──────────── */

function AgrEditor({
  editor,
  onUploadWord,
  onOpenPlaceholder,
  onOpenClauseLibrary,
  onCloseClauseLibrary,
  clauseOpen,
}: {
  editor: Editor | null;
  onUploadWord: () => void;
  onOpenPlaceholder: () => void;
  onOpenClauseLibrary: () => void;
  onCloseClauseLibrary: () => void;
  clauseOpen: boolean;
}) {
  if (!editor) return <div className="agw-editor-shell" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading editor…</div>;

  const isActive = (name: string, attrs?: Record<string, any>) => {
    try { return editor.isActive(name, attrs); } catch { return false; }
  };

  return (
    <div className="agw-editor-shell">
      <div className="agw-editor-head">
        <div className="agw-editor-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          DRAFT AGREEMENT CONTENT
        </div>
        <div className="agw-editor-actions">
          <Tooltip label="Upload a Word / text document and import its content">
            <button type="button" className="agw-editor-btn" onClick={onUploadWord}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload Word Doc
            </button>
          </Tooltip>
          <Tooltip label="Insert a {{group.field}} placeholder">
            <button type="button" className="agw-editor-btn" onClick={onOpenPlaceholder}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              {'{} Placeholder'}
            </button>
          </Tooltip>
          <Tooltip label="Browse reusable clauses">
            <button type="button" className="agw-editor-btn" onClick={onOpenClauseLibrary}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              Clause Library
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="agw-toolbar">
        <select
          className="agw-toolbar-sel"
          title="Block type"
          value={
            isActive('heading', { level: 1 }) ? 'h1' :
            isActive('heading', { level: 2 }) ? 'h2' :
            isActive('heading', { level: 3 }) ? 'h3' : 'p'
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) as 1|2|3 }).run();
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <Tooltip label="Bold (Ctrl+B)"><button type="button" className={`agw-toolbar-btn ${isActive('bold') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button></Tooltip>
        <Tooltip label="Italic (Ctrl+I)"><button type="button" className={`agw-toolbar-btn ${isActive('italic') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button></Tooltip>
        <Tooltip label="Underline (Ctrl+U)"><button type="button" className={`agw-toolbar-btn ${isActive('underline') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button></Tooltip>
        <Tooltip label="Strikethrough"><button type="button" className={`agw-toolbar-btn ${isActive('strike') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button></Tooltip>
        <Tooltip label="Inline code"><button type="button" className={`agw-toolbar-btn ${isActive('code') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button></Tooltip>
        <Tooltip label="Blockquote"><button type="button" className={`agw-toolbar-btn ${isActive('blockquote') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“”</button></Tooltip>

        <span className="agw-toolbar-sep" />

        <Tooltip label="Align left"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('left').run()} aria-label="Align left"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg></button></Tooltip>
        <Tooltip label="Align center"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('center').run()} aria-label="Align center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg></button></Tooltip>
        <Tooltip label="Align right"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('right').run()} aria-label="Align right"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg></button></Tooltip>
        <Tooltip label="Justify"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('justify').run()} aria-label="Justify"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button></Tooltip>

        <span className="agw-toolbar-sep" />

        <Tooltip label="Bullet list"><button type="button" className={`agw-toolbar-btn ${isActive('bulletList') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">•≡</button></Tooltip>
        <Tooltip label="Numbered list"><button type="button" className={`agw-toolbar-btn ${isActive('orderedList') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">1≡</button></Tooltip>
        <Tooltip label="Decrease indent / lift"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().liftListItem('listItem').run()} aria-label="Outdent">⇤</button></Tooltip>
        <Tooltip label="Increase indent / sink"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} aria-label="Indent">⇥</button></Tooltip>

        <span className="agw-toolbar-sep" />

        <Tooltip label="Horizontal rule"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()} aria-label="Horizontal rule">—</button></Tooltip>
        <Tooltip label="Undo (Ctrl+Z)"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="Undo">↶</button></Tooltip>
        <Tooltip label="Redo (Ctrl+Y)"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="Redo">↷</button></Tooltip>
        <Tooltip label="Clear formatting"><button type="button" className="agw-toolbar-btn" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} aria-label="Clear formatting">⌫</button></Tooltip>
      </div>

      <div className="agw-editor-area">
        <EditorContent editor={editor} className="agw-editor" />
        {clauseOpen && (
          <div className="agw-clause-panel">
            <div className="agw-clause-panel-head">
              <span>Insert a clause</span>
              <button type="button" className="agw-clause-close" onClick={onCloseClauseLibrary} aria-label="Close clause library">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="agw-clause-panel-body">
              {CLAUSE_PRESETS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className="agw-clause-item"
                  onClick={() => { editor.chain().focus().insertContent(c.html).run(); onCloseClauseLibrary(); }}
                >
                  <span className="agw-clause-item-title">{c.title}</span>
                  <span className="agw-clause-item-sub">{c.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="agw-editor-foot">
        <span className="agw-editor-foot-hint">ⓘ Placeholders auto-fill on agreement generation</span>
        <Tooltip label="Open the placeholder picker">
          <button type="button" className="agw-editor-foot-tag" onClick={onOpenPlaceholder}>{'{{PLACEHOLDER}}'}</button>
        </Tooltip>
      </div>
    </div>
  );
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
  { id: 'transaction', label: 'Transaction', iconEmoji: '💼', iconColor: '#7c3aed', fields: [
    { label: 'Shipment ID',       token: '{{transaction.shipment_id}}' },
    { label: 'OPP ID',            token: '{{transaction.opp_id}}' },
    { label: 'Product',           token: '{{transaction.product}}' },
    { label: 'Quantity',          token: '{{transaction.quantity}}' },
    { label: 'Invoice Date',      token: '{{transaction.invoice_date}}' },
    { label: 'Invoice No',        token: '{{transaction.invoice_no}}' },
    { label: 'Amount',            token: '{{transaction.amount}}' },
    { label: 'Currency',          token: '{{transaction.currency}}' },
    { label: 'Tax Date',          token: '{{transaction.tax_date}}' },
    { label: 'Port of Loading',   token: '{{transaction.port_of_loading}}' },
    { label: 'Port of Discharge', token: '{{transaction.port_of_discharge}}' },
    { label: 'Vessel Name',       token: '{{transaction.vessel_name}}' },
  ] },
  { id: 'contract', label: 'Contract', iconEmoji: '📄', iconColor: '#0e7490', fields: [
    { label: 'Contract No',     token: '{{contract.contract_no}}' },
    { label: 'Contract Date',   token: '{{contract.contract_date}}' },
    { label: 'Start Date',      token: '{{contract.start_date}}' },
    { label: 'End Date',        token: '{{contract.end_date}}' },
    { label: 'Payment Terms',   token: '{{contract.payment_terms}}' },
    { label: 'Delivery Terms',  token: '{{contract.delivery_terms}}' },
    { label: 'Incoterms',       token: '{{contract.incoterms}}' },
    { label: 'Governing Law',   token: '{{contract.governing_law}}' },
  ] },
  { id: 'agreement', label: 'Agreement', iconEmoji: '🤝', iconColor: '#be185d', fields: [
    { label: 'Agreement No',    token: '{{agreement.agreement_no}}' },
    { label: 'Agreement Title', token: '{{agreement.agreement_title}}' },
    { label: 'Agreement Type',  token: '{{agreement.agreement_type}}' },
    { label: 'Agreement Date',  token: '{{agreement.agreement_date}}' },
    { label: 'Effective Date',  token: '{{agreement.effective_date}}' },
    { label: 'Expiry Date',     token: '{{agreement.expiry_date}}' },
    { label: 'Renewal Date',    token: '{{agreement.renewal_date}}' },
    { label: 'Signing Party',   token: '{{agreement.signing_party}}' },
    { label: 'Counter Party',   token: '{{agreement.counter_party}}' },
    { label: 'Governing Law',   token: '{{agreement.governing_law}}' },
    { label: 'Jurisdiction',    token: '{{agreement.jurisdiction}}' },
    { label: 'Notice Period',   token: '{{agreement.notice_period}}' },
  ] },
];

function PlaceholderPicker({ onClose, onPick }: { onClose: () => void; onPick: (token: string) => void }) {
  const [activeId, setActiveId] = useState<string>('buyer');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const active = PLACEHOLDER_GROUPS.find(g => g.id === activeId) ?? PLACEHOLDER_GROUPS[0];

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
        <div className="agw-ph-hint">ⓘ Click any field to insert it into the editor. Placeholders auto-fill on agreement generation.</div>
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
            <div className="agw-ph-grid">
              {active.fields.map(f => (
                <button
                  key={f.token}
                  type="button"
                  className="agw-ph-card"
                  style={{ ['--ph-card-color' as any]: active.iconColor }}
                  onClick={() => onPick(f.token)}
                  title={`Click to insert ${f.token}`}
                >
                  <span className="agw-ph-card-label">{f.label}</span>
                  <span className="agw-ph-card-token">{f.token}</span>
                </button>
              ))}
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

/* Signing-workflow metadata lives in an HTML comment at the very start of
 * `content` so the rich-text editor never shows it but we can still recover
 * the user's last picks on edit. */
const META_RE = /^\s*<!--\s*AGW-META:\s*(\{[\s\S]*?\})\s*-->\s*/;
function parseMetaFromContent(content: string): { sequential: boolean; digitalSig: boolean; validityPeriod: string; renewalType: string; noticePeriod: string } | null {
  const m = content.match(META_RE);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    return {
      sequential:     !!obj.sequential,
      digitalSig:     !!obj.digitalSig,
      validityPeriod: typeof obj.validityPeriod === 'string' ? obj.validityPeriod : '1 Year',
      renewalType:    typeof obj.renewalType    === 'string' ? obj.renewalType    : 'Auto-Renew',
      noticePeriod:   typeof obj.noticePeriod   === 'string' ? obj.noticePeriod   : '30 Days',
    };
  } catch { return null; }
}
function stripMetaFromContent(content: string): string {
  // Remove leading meta comment + any auto-prepended Purpose / Signing
  // paragraphs so re-saves don't accumulate duplicates.
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

/* ── Clause presets (same as T&C wizard) ──────────────────────────────── */
const CLAUSE_PRESETS = [
  { title: 'Force Majeure',   sub: 'Standard force-majeure clause',     html: '<h3>Force Majeure</h3><p>Neither Party shall be liable for any failure or delay in performance under this Agreement caused by acts of God, war, terrorism, riots, fire, flood, epidemic, or any other event beyond the reasonable control of such Party.</p>' },
  { title: 'Confidentiality', sub: 'Mutual NDA clause',                 html: '<h3>Confidentiality</h3><p>Each Party agrees to hold the other Party\'s Confidential Information in strict confidence and not to disclose such information to any third party without prior written consent.</p>' },
  { title: 'Governing Law',   sub: 'Jurisdiction & dispute resolution', html: '<h3>Governing Law</h3><p>This Agreement shall be governed by and construed in accordance with the laws of [Jurisdiction]. Any disputes arising hereunder shall be subject to the exclusive jurisdiction of the courts of [Jurisdiction].</p>' },
  { title: 'Payment Terms',   sub: '30-day net payment terms',          html: '<h3>Payment Terms</h3><p>All invoices shall be payable within thirty (30) days from the invoice date. Late payments shall accrue interest at the rate of 1.5% per month or the maximum rate permitted by law, whichever is lower.</p>' },
  { title: 'Termination',     sub: 'Termination-for-convenience clause',html: '<h3>Termination</h3><p>Either Party may terminate this Agreement at any time upon thirty (30) days\' prior written notice to the other Party. All accrued obligations shall survive such termination.</p>' },
  { title: 'Indemnification', sub: 'Mutual indemnity provisions',       html: '<h3>Indemnification</h3><p>Each Party shall indemnify, defend, and hold harmless the other Party from and against any claims, damages, losses, and expenses arising out of or relating to the indemnifying Party\'s breach of this Agreement.</p>' },
];

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
  padding: 18px 22px;
  background: linear-gradient(110deg, #0c6680 0%, #0e7490 35%, #0891b2 75%, #06b6d4 100%);
  color: #fff; position: relative; overflow: hidden; flex-shrink: 0;
}
.agw-head::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.10), transparent); pointer-events: none; }
.agw-head > * { position: relative; z-index: 1; }
.agw-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.agw-head-ico {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.agw-head-text { min-width: 0; }
.agw-head-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); text-transform: uppercase; }
.agw-head-title { font-size: 19px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; margin-top: 2px; }
.agw-head-sub { font-size: 12.5px; color: rgba(255,255,255,.86); margin-top: 4px; }
.agw-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.agw-id-chip { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.24); border-radius: 10px; padding: 8px 16px; text-align: right; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.agw-id-chip-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.74); text-transform: uppercase; }
.agw-id-chip-val { font-size: 18px; font-weight: 800; color: #fff; margin-top: 2px; font-family: 'Geist Mono', ui-monospace, monospace; }
.agw-close { width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease, transform .15s ease; }
.agw-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }
.agw-close:disabled { opacity: .5; cursor: not-allowed; }

.agw-stepper { display: flex; align-items: center; justify-content: space-between; background: #f8feff; border-bottom: 1px solid rgba(6,182,212,.18); padding: 16px 22px; gap: 22px; flex-wrap: wrap; flex-shrink: 0; }
.agw-stepper-row { display: inline-flex; align-items: center; gap: 0; flex: 1; min-width: 0; flex-wrap: wrap; }
.agw-step { display: inline-flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; position: relative; transition: background .18s ease, box-shadow .22s ease; }
.agw-step.is-active { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 14px rgba(8,145,178,.40); }
.agw-step.is-active .agw-step-label, .agw-step.is-active .agw-step-sub { color: #fff; }
.agw-step.is-active .agw-step-num { background: rgba(255,255,255,.20); border-color: rgba(255,255,255,.45); color: #fff; }
.agw-step.is-complete .agw-step-num { background: #22c55e; border-color: #16a34a; color: #fff; }
.agw-step-num { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; border: 1.5px solid rgba(6,182,212,.32); background: #f0fdff; color: #0e7490; font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.agw-step-text { min-width: 0; }
.agw-step-label { font-size: 13px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; line-height: 1.2; }
.agw-step-sub { font-size: 11px; color: #0e7490; opacity: .8; margin-top: 2px; }
.agw-step-line { width: 70px; height: 2px; flex-shrink: 0; background: #e2e8f0; margin: 0 6px; border-radius: 1px; transition: background .22s ease; }
.agw-step-line.is-complete { background: linear-gradient(90deg, #22c55e, #16a34a); }
.agw-stepper-progress { display: inline-flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: flex-end; }
.agw-stepper-label { font-size: 10.5px; font-weight: 700; color: #0e7490; background: #f0fdff; border: 1px solid rgba(6,182,212,.22); padding: 4px 10px; border-radius: 999px; }

.agw-body { flex: 1; min-height: 0; overflow-y: auto; background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%); padding: 22px; }
.agw-step-body { display: flex; flex-direction: column; gap: 16px; }
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

/* Signing Workflow card */
.agw-signing { border: 1.5px solid rgba(6,182,212,.20); border-radius: 14px; background: linear-gradient(180deg, #ffffff 0%, #f7feff 100%); padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.agw-signing-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.agw-signing-head-title { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0891b2; }
.agw-signing-ico { width: 22px; height: 22px; border-radius: 7px; background: rgba(8,145,178,.10); display: inline-flex; align-items: center; justify-content: center; color: #0891b2; }
.agw-signing-head-toggles { display: inline-flex; gap: 14px; align-items: center; }
.agw-mini-check { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: #475569; padding: 4px 6px; border-radius: 6px; transition: color .15s ease; user-select: none; }
.agw-mini-check input { width: 15px; height: 15px; accent-color: #0891b2; cursor: pointer; margin: 0; }
.agw-mini-check.is-on { color: #0c4a6e; }
.agw-mini-check:hover { color: #0891b2; }

.agw-signing-hint {
  text-align: center;
  font-size: 11.5px; color: #94a3b8;
  font-style: italic;
  padding: 8px 12px; border-radius: 8px;
  border: 1px dashed rgba(6,182,212,.32);
  background: rgba(240,253,255,.6);
}

.agw-expiry {
  border: 1px solid rgba(245,158,11,.30);
  border-radius: 10px;
  background: rgba(255,251,235,.45);
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.agw-expiry-head { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #b45309; }
.agw-expiry-ico { width: 18px; height: 18px; border-radius: 5px; background: rgba(245,158,11,.18); display: inline-flex; align-items: center; justify-content: center; color: #b45309; }
.agw-expiry-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
.agw-mini-label { font-size: 11px; font-weight: 800; color: #0c4a6e; }
.agw-select {
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px 14px;
  padding-right: 32px;
}

/* Editor */
.agw-editor-shell { border: 1px solid rgba(6,182,212,.20); border-radius: 14px; overflow: hidden; background: #fff; }
.agw-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: linear-gradient(110deg, #0891b2, #0e7490); padding: 12px 18px; color: #fff; }
.agw-editor-title { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.agw-editor-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.agw-editor-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; transition: background .15s ease; }
.agw-editor-btn:hover { background: rgba(255,255,255,.26); }
.agw-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.agw-toolbar-sel, .agw-toolbar-btn { height: 30px; min-width: 30px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #475569; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.agw-toolbar-btn:hover { background: #f0fdff; border-color: #67e8f9; color: #0891b2; }
.agw-toolbar-btn.is-on { background: #cffafe; border-color: #0891b2; color: #0c4a6e; box-shadow: inset 0 1px 2px rgba(8,145,178,.18); }
.agw-toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.agw-toolbar-sep { width: 1px; height: 20px; background: #cbd5e1; }

.agw-editor-area { position: relative; }
.agw-editor, .agw-editor .ProseMirror { min-height: 240px; padding: 18px 22px; background: #fff; outline: none; font-size: 13.5px; line-height: 1.6; color: #0c4a6e; }
.agw-editor .ProseMirror { padding: 0; min-height: 240px; }
.agw-editor .ProseMirror:focus { outline: none; }
.agw-editor .ProseMirror p { margin: 0 0 .6em 0; }
.agw-editor .ProseMirror p:last-child { margin-bottom: 0; }
.agw-editor .ProseMirror h1, .agw-editor .ProseMirror h2, .agw-editor .ProseMirror h3 { color: #0c4a6e; font-weight: 800; margin: .4em 0; line-height: 1.25; }
.agw-editor .ProseMirror h1 { font-size: 22px; }
.agw-editor .ProseMirror h2 { font-size: 18px; }
.agw-editor .ProseMirror h3 { font-size: 15.5px; }
.agw-editor .ProseMirror ul, .agw-editor .ProseMirror ol { padding-left: 22px; margin: 0 0 .6em 0; }
.agw-editor .ProseMirror blockquote { border-left: 3px solid #67e8f9; padding-left: 12px; margin: .4em 0; color: #475569; font-style: italic; }
.agw-editor .ProseMirror code { background: #f0fdff; padding: 1px 5px; border-radius: 4px; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12.5px; color: #0e7490; }
.agw-editor .ProseMirror hr { border: 0; border-top: 1px dashed #94a3b8; margin: 14px 0; }

.agw-clause-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(320px, 70%); background: #fff; border-left: 1px solid rgba(6,182,212,.22); box-shadow: -8px 0 24px rgba(15,23,42,.10); display: flex; flex-direction: column; animation: agwClauseSlide .22s ease both; z-index: 5; }
@keyframes agwClauseSlide { from { transform: translateX(12px); opacity: 0 } to { transform: none; opacity: 1 } }
.agw-clause-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: linear-gradient(110deg, #0891b2, #0e7490); color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.agw-clause-close { width: 24px; height: 24px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; }
.agw-clause-close:hover { background: rgba(255,255,255,.30); }
.agw-clause-panel-body { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.agw-clause-item { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(6,182,212,.18); background: #f8feff; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.agw-clause-item:hover { border-color: #0891b2; background: #ecfeff; transform: translateY(-1px); }
.agw-clause-item-title { font-size: 13px; font-weight: 800; color: #0c4a6e; }
.agw-clause-item-sub { font-size: 11px; color: #0e7490; opacity: .85; }

.agw-editor-foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; background: #f0fdff; border-top: 1px solid #e2e8f0; font-size: 11.5px; gap: 12px; flex-wrap: wrap; }
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
.agw-ph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.agw-ph-card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; cursor: pointer; text-align: left; transition: border-color .15s ease, transform .15s ease, box-shadow .22s ease, background .15s ease; }
.agw-ph-card:hover { border-color: var(--ph-card-color); transform: translateY(-1px); box-shadow: 0 6px 14px rgba(15,23,42,.08); background: #fafffd; }
.agw-ph-card-label { font-size: 12.5px; font-weight: 800; color: #0c4a6e; }
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
[data-bs-theme="dark"] .agw-party-label { color: #cbd5e1; }
[data-bs-theme="dark"] .agw-party-label-buyer    { color: #67e8f9; }
[data-bs-theme="dark"] .agw-party-label-supplier { color: #4ade80; }
[data-bs-theme="dark"] .agw-party-label-combined { color: #c4b5fd; }
[data-bs-theme="dark"] .agw-party-hint { color: #94a3b8; }
[data-bs-theme="dark"] .agw-checkbox { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .agw-checkbox:hover { background: rgba(8,145,178,.10); border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-checkbox.is-on { background: rgba(8,145,178,.22); border-color: #67e8f9; color: #cffafe; }
[data-bs-theme="dark"] .agw-signing { background: linear-gradient(180deg, #0f172a 0%, #102234 100%); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-signing-head-title { color: #67e8f9; }
[data-bs-theme="dark"] .agw-signing-ico { background: rgba(8,145,178,.20); color: #67e8f9; }
[data-bs-theme="dark"] .agw-mini-check { color: #cbd5e1; }
[data-bs-theme="dark"] .agw-mini-check.is-on { color: #cffafe; }
[data-bs-theme="dark"] .agw-mini-check:hover { color: #67e8f9; }
[data-bs-theme="dark"] .agw-signing-hint { background: rgba(8,145,178,.10); border-color: rgba(6,182,212,.30); color: #94a3b8; }
[data-bs-theme="dark"] .agw-expiry { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.30); }
[data-bs-theme="dark"] .agw-expiry-head { color: #fbbf24; }
[data-bs-theme="dark"] .agw-expiry-ico { background: rgba(245,158,11,.22); color: #fbbf24; }
[data-bs-theme="dark"] .agw-mini-label { color: #cffafe; }
[data-bs-theme="dark"] .agw-select { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2367e8f9' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>"); }
[data-bs-theme="dark"] .agw-editor-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-toolbar { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-toolbar-sel, [data-bs-theme="dark"] .agw-toolbar-btn { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .agw-toolbar-btn:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-toolbar-btn.is-on { background: rgba(8,145,178,.30); border-color: rgba(103,232,249,.55); color: #cffafe; }
[data-bs-theme="dark"] .agw-toolbar-sep { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .agw-editor, [data-bs-theme="dark"] .agw-editor .ProseMirror { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .agw-editor .ProseMirror h1, [data-bs-theme="dark"] .agw-editor .ProseMirror h2, [data-bs-theme="dark"] .agw-editor .ProseMirror h3 { color: #cffafe; }
[data-bs-theme="dark"] .agw-editor-foot { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-editor-foot-hint { color: #67e8f9; }
[data-bs-theme="dark"] .agw-editor-foot-tag { background: rgba(8,145,178,.18); color: #cffafe; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .agw-foot { background: #0f172a; border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-btn-back, [data-bs-theme="dark"] .agw-btn-cancel { background: rgba(255,255,255,.04); color: #cbd5e1; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-btn-back:hover, [data-bs-theme="dark"] .agw-btn-cancel:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .agw-clause-panel { background: #0f172a; border-left-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .agw-clause-item { background: rgba(8,145,178,.08); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-clause-item:hover { background: rgba(8,145,178,.18); border-color: #67e8f9; }
[data-bs-theme="dark"] .agw-clause-item-title { color: #cffafe; }
[data-bs-theme="dark"] .agw-clause-item-sub { color: #67e8f9; }
[data-bs-theme="dark"] .agw-ph-shell { background: #0f172a; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .agw-ph-hint { background: rgba(8,145,178,.10); color: #67e8f9; border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-sidebar { background: linear-gradient(180deg, rgba(8,145,178,.10) 0%, #0b1726 100%); border-right-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-tab { color: #cbd5e1; }
[data-bs-theme="dark"] .agw-ph-tab:hover { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .agw-ph-card { background: #1e293b; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .agw-ph-card:hover { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .agw-ph-card-label { color: #cffafe; }
[data-bs-theme="dark"] .agw-ph-fields-sub { color: #94a3b8; }

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
  .agw-expiry-grid { grid-template-columns: 1fr; }
  .agw-signing-head { flex-direction: column; align-items: flex-start; }
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
