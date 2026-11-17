import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import {
  BILLING_FREQ, CONDITIONS, DEPARTMENTS, HAZ_CLASSES, HAZ_OPTS, KIND_SUB, KIND_TITLE, MATERIAL_OPTS,
  OTHER_OPTS, OTHER_TYPES, PACKAGING, SOFT_CATEGORIES, SOFT_DELIVERY, SOFT_HSN, SOFT_SEGMENTS, SOFT_UOM,
  type MappedSupplier, type OtherType, type ServiceKind, type ServiceRecord, type ServiceVals,
} from './serviceData';
import { SupplierMapPanel } from './ServiceSupplierModal';
import ServiceGstModal from './ServiceGstModal';
import { SVC_ICONS } from './serviceIcons';
import './service-form.css';

export interface ServiceFormInput {
  kind: ServiceKind;
  record?: ServiceRecord;
  code: string;
  otype?: OtherType;
}

type Stage = 1 | 2;
type Errors = Partial<Record<keyof ServiceVals, string>>;

const REQUIRED: Record<ServiceKind, Array<keyof ServiceVals>> = {
  soft: ['name', 'category', 'provider', 'segment', 'delivery', 'hsn', 'uom', 'desc'],
  other: ['name', 'otype', 'category', 'provider', 'dept', 'billing', 'hsn', 'uom', 'desc'],
  trackable: ['name', 'make', 'segment', 'desc', 'img1', 'haz', 'uom', 'hsn', 'condition', 'packaging'],
  consumable: ['name', 'make', 'segment', 'desc', 'img1', 'haz', 'uom', 'hsn', 'condition', 'packaging'],
};

const emptyVals = (kind: ServiceKind, otype?: OtherType): ServiceVals => ({
  name: '', desc: '',
  ...(kind === 'soft' || kind === 'other' ? { contract: 'Not Required' as const } : {}),
  ...(kind === 'other' ? { otype: otype ?? 'professional' } : {}),
});

export default function ServiceFormModal({
  input, onClose, onSubmit,
}: {
  input: ServiceFormInput;
  onClose: () => void;
  onSubmit: (rec: ServiceRecord, isEdit: boolean) => void;
}) {
  const toast = useToast();
  const { kind, record, code } = input;
  const isEdit = !!record;

  const [stage, setStage] = useState<Stage>(1);
  const [vals, setVals] = useState<ServiceVals>(() => record ? { ...record.vals } : emptyVals(kind, input.otype));
  const [suppliers, setSuppliers] = useState<MappedSupplier[]>(() => record?.suppliers ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<FileMap>({});
  const [gstOpen, setGstOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const pick = (k: FileKey, f: File | null) => {
    setFiles(p => ({ ...p, [k]: f ?? undefined }));
    setVals(p => ({ ...p, [k]: f ? f.name : '' }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const setImages = (k: ImageKey, list: File[]) => {
    setFiles(p => ({ ...p, [k]: list }));
    setVals(p => ({
      ...p,
      [k]: list.length === 0 ? '' : list.length === 1 ? list[0].name : `${list.length} images`,
    }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.apm-mv-backdrop, .supch-ov, .avm-backdrop, .apm-gst-overlay')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const set = <K extends keyof ServiceVals>(k: K, v: ServiceVals[K]) => {
    const clearHaz = k === 'haz' && v !== 'Hazardous';
    setVals(p => ({ ...p, [k]: v, ...(clearHaz ? { hazClass: '' } : {}) }));
    if (errors[k] || (clearHaz && errors.hazClass)) {
      setErrors(e => ({ ...e, [k]: undefined, ...(clearHaz ? { hazClass: undefined } : {}) }));
    }
  };

  const setOtype = (v: string) => {
    setVals(p => ({ ...p, otype: v as OtherType, category: '', hsn: '', uom: '' }));
    setErrors(e => ({ ...e, otype: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    REQUIRED[kind].forEach(k => {
      if (k === 'img1' && isEdit) return;
      const v = vals[k];
      if (v == null || String(v).trim() === '') next[k] = 'This field is required';
    });
    if (REQUIRED[kind].includes('haz') && vals.haz === 'Hazardous' && !vals.hazClass) {
      next.hazClass = 'Haz Class is required when Hazardous';
    }
    setErrors(next);
    const n = Object.keys(next).length;
    if (n) {
      toast.warning(`${n} required field${n === 1 ? '' : 's'} still empty`, 'Fill the highlighted fields to continue.');
      requestAnimationFrame(() => {
        bodyRef.current?.querySelector('.svf-field.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    return n === 0;
  };

  const goNext = () => {
    if (!validate()) return;
    if (!vals.gstId) {
      toast.error('GST is mandatory', 'Map a GST % to this service before continuing.');
      setGstOpen(true);
      return;
    }
    setStage(2);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  const submit = () => {
    const rec: ServiceRecord = {
      code,
      kind,
      created: record?.created ?? new Date().toISOString(),
      vals: { ...vals, name: vals.name.trim(), desc: vals.desc.trim() },
      suppliers,
      active: record?.active ?? true,
    };
    onSubmit(rec, isEdit);
  };

  const title = `${isEdit ? 'Edit' : 'Add'} ${KIND_TITLE[kind]}`;
  const stage1Sub = kind === 'soft' ? 'Identity, category & delivery details'
    : kind === 'other' ? 'Identity, type & billing details'
      : 'Identity, classification & general info';

  return createPortal((
    <div className="svf-backdrop">
      <div className="svf-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="svf-head">
          <div className="svf-head-left">
            <div className="svf-head-icon">{SVC_ICONS.wrench}</div>
            <div>
              <div className="svf-title">
                {title}
                {isEdit && <span className="svf-title-code">· {code}</span>}
              </div>
              <div className="svf-sub">{KIND_SUB[kind]}</div>
            </div>
          </div>
          <div className="svf-head-actions">
            <Tooltip label="Map / manage GST %">
              <button type="button" className="apm-head-btn" onClick={() => setGstOpen(true)}>
                {vals.gstId && vals.gstPct != null ? `GST ${vals.gstPct}%` : 'GST (%)'}
              </button>
            </Tooltip>
            <button type="button" className="svf-close" onClick={onClose} aria-label="Close">{SVC_ICONS.x}</button>
          </div>
        </div>

        <div className="svf-stepper">
          <Step n={1} current={stage} title="Service Core Information" sub={stage1Sub} icon={SVC_ICONS[kind]} />
          <div className={`svf-step-connector${stage > 1 ? ' done' : ''}`} />
          <Step n={2} current={stage} title="Map Service Suppliers" sub="Link suppliers with price & GST" icon={SVC_ICONS.mapUser} />
        </div>

        <div className="svf-body" ref={bodyRef}>
          {stage === 1 && kind === 'soft' && <SoftFields vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} />}
          {stage === 1 && kind === 'other' && <OtherFields vals={vals} set={set} setOtype={setOtype} errors={errors} files={files} pick={pick} setImages={setImages} />}
          {stage === 1 && (kind === 'trackable' || kind === 'consumable') && (
            <MaterialFields kind={kind} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} />
          )}

          {stage === 2 && (
            <div className="svs-teal svf-sup-panel">
              <SupplierMapPanel serviceName={vals.name} suppliers={suppliers} onChange={setSuppliers} defaultGst={vals.gstPct} />
            </div>
          )}
        </div>

        <div className="svf-foot">
          <div className="svf-foot-left">
            <span className="svf-note">
              {SVC_ICONS.info} Fields marked <span className="svf-req">*</span> are required
              <code>{code}</code>
            </span>
          </div>
          <div className="svf-foot-right">
            {stage === 1 ? (
              <>
                <button type="button" className="svf-btn-ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="svf-btn-primary" onClick={goNext}>
                  {SVC_ICONS.save} Save &amp; Next <span className="svf-btn-chev">{SVC_ICONS.chevron}</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="svf-btn-outline" onClick={() => setStage(1)}>
                  <span className="svf-btn-chev is-back">{SVC_ICONS.chevron}</span> Previous
                </button>
                <button type="button" className="svf-btn-primary" onClick={submit}>
                  {SVC_ICONS.save} {isEdit ? 'Update Service' : 'Submit Service'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {gstOpen && (
        <ServiceGstModal
          value={vals.gstId}
          onClose={() => setGstOpen(false)}
          onMap={(r) => setVals(p => ({ ...p, gstId: r.id, gstPct: r.pct }))}
          onRemoved={(id) => setVals(p => (p.gstId === id ? { ...p, gstId: undefined, gstPct: undefined } : p))}
        />
      )}
    </div>
  ), document.body);
}

type SetFn = <K extends keyof ServiceVals>(k: K, v: ServiceVals[K]) => void;
type FileKey = 'att';
type ImageKey = 'img1' | 'img2';
type FileMap = { att?: File; img1?: File[]; img2?: File[] };
type GroupProps = {
  vals: ServiceVals; set: SetFn; errors: Errors; files: FileMap;
  pick: (k: FileKey, f: File | null) => void;
  setImages: (k: ImageKey, list: File[]) => void;
};

function AttachmentRemarks({ vals, set, files, pick, noteKey, noteLabel, notePh, title, sub }: GroupProps & {
  noteKey: 'remark' | 'confidential'; noteLabel: string; notePh: string; title: string; sub: string;
}) {
  return (
    <Section icon={SVC_ICONS.clip} title={title} sub={sub}>
      <div className="svf-grid svf-grid-4">
        <Field label="Attachment" optional>
          <FilePick value={vals.att} file={files.att} hint="PDF, DOC, XLS or images"
            accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onPick={f => pick('att', f)} />
        </Field>
        <Field label={noteLabel} span="3">
          <textarea className="svf-input svf-textarea" rows={3} placeholder={notePh}
            value={vals[noteKey] ?? ''} onChange={e => set(noteKey, e.target.value)} />
        </Field>
      </div>
    </Section>
  );
}

function ContractToggle({ vals, set }: { vals: ServiceVals; set: SetFn }) {
  const on = vals.contract === 'Required';
  return (
    <Field label="Contract Required">
      <button type="button" role="switch" aria-checked={on}
        className={`svf-toggle${on ? ' is-on' : ''}`}
        onClick={() => set('contract', on ? 'Not Required' : 'Required')}>
        <span className="svf-toggle-track"><span className="svf-toggle-knob" /></span>
        <span className="svf-toggle-lbl">{on ? 'Required' : 'Not Required'}</span>
      </button>
    </Field>
  );
}

function SoftFields({ vals, set, errors, files, pick, setImages }: GroupProps) {
  return (
    <>
      <Section icon={SVC_ICONS.soft} title="Service Core Information" sub="Service identity, provider and classification">
        <div className="svf-grid svf-grid-4">
          <Field label="Service Name" required error={errors.name}>
            <TextInput value={vals.name} onChange={v => set('name', v)} placeholder="e.g. Microsoft 365 Business" />
          </Field>
          <Field label="Service Category" required add error={errors.category}>
            <Select value={vals.category} options={SOFT_CATEGORIES} label="Service Category" onChange={v => set('category', v)} invalid={!!errors.category} />
          </Field>
          <Field label="Service Provider / Brand" required error={errors.provider}>
            <TextInput value={vals.provider} onChange={v => set('provider', v)} placeholder="e.g. Microsoft, AWS, Anthropic" />
          </Field>
          <Field label="Service Segment" required add error={errors.segment}>
            <Select value={vals.segment} options={SOFT_SEGMENTS} label="Service Segment" onChange={v => set('segment', v)} invalid={!!errors.segment} />
          </Field>
          <Field label="Service Delivery Type" required error={errors.delivery}>
            <Select value={vals.delivery} options={SOFT_DELIVERY} label="Service Delivery Type" onChange={v => set('delivery', v)} invalid={!!errors.delivery} />
          </Field>
          <Field label="HSN / SAC Code" required add error={errors.hsn}>
            <Select value={vals.hsn} options={SOFT_HSN} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Unit of Measurement" required add error={errors.uom}>
            <Select value={vals.uom} options={SOFT_UOM} label="Unit of Measurement" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <ContractToggle vals={vals} set={set} />
          <Field label="Service Description" required error={errors.desc} span="full">
            <textarea className="svf-input svf-textarea" rows={3} placeholder="Describe the scope of this service"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
        </div>
      </Section>
      <AttachmentRemarks vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="remark" noteLabel="Remark"
        notePh="Enter any remark about this service" title="Attachment & Remarks" sub="Supporting document and internal notes" />
    </>
  );
}

function OtherFields({ vals, set, setOtype, errors, files, pick, setImages }: GroupProps & { setOtype: (v: string) => void }) {
  const ot = (vals.otype ?? 'professional') as OtherType;
  const o = OTHER_OPTS[ot];
  return (
    <>
      <Section icon={SVC_ICONS.other} title="Service Core Information" sub="Service identity, vendor and billing details">
        <div className="svf-grid svf-grid-4">
          <Field label="Service Name" required error={errors.name}>
            <TextInput value={vals.name} onChange={v => set('name', v)} placeholder={o.ph} />
          </Field>
          <Field label="Service Type" required error={errors.otype}>
            <Select value={vals.otype} options={OTHER_TYPES} label="Service Type" onChange={setOtype} invalid={!!errors.otype} />
          </Field>
          <Field label="Service Category" required add error={errors.category}>
            <Select key={`cat-${ot}`} value={vals.category} options={o.cats} label="Service Category" onChange={v => set('category', v)} invalid={!!errors.category} />
          </Field>
          <Field label="Service Provider / Vendor" required error={errors.provider}>
            <TextInput value={vals.provider} onChange={v => set('provider', v)} placeholder="e.g. Sharma & Associates" />
          </Field>
          <Field label="Department / Cost Centre" required error={errors.dept}>
            <Select value={vals.dept} options={DEPARTMENTS} label="Department / Cost Centre" onChange={v => set('dept', v)} invalid={!!errors.dept} />
          </Field>
          <Field label="Billing Frequency" required error={errors.billing}>
            <Select value={vals.billing} options={BILLING_FREQ} label="Billing Frequency" onChange={v => set('billing', v)} invalid={!!errors.billing} />
          </Field>
          <Field label="HSN / SAC Code" required add error={errors.hsn}>
            <Select key={`hsn-${ot}`} value={vals.hsn} options={o.hsn} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Unit of Measurement" required add error={errors.uom}>
            <Select key={`uom-${ot}`} value={vals.uom} options={o.uom} label="Unit of Measurement" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <ContractToggle vals={vals} set={set} />
          <Field label="Service Description" required error={errors.desc} span="3">
            <textarea className="svf-input svf-textarea" rows={3} placeholder="Describe the scope of this service"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
        </div>
      </Section>
      <AttachmentRemarks vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="remark" noteLabel="Remark"
        notePh="Enter any remark about this service" title="Attachment & Remarks" sub="Supporting document and internal notes" />
    </>
  );
}

function MaterialFields({ kind, vals, set, errors, files, pick, setImages }: GroupProps & { kind: 'trackable' | 'consumable' }) {
  const o = MATERIAL_OPTS[kind];
  return (
    <>
      <Section icon={SVC_ICONS[kind]} title={`${kind === 'trackable' ? 'Trackable' : 'Consumable'} Material / Goods Core Information`}
        sub="Identity, description and classification">
        <div className="svf-grid svf-grid-3">
          <Field label="Service Name" required error={errors.name}>
            <TextInput value={vals.name} onChange={v => set('name', v)} placeholder={o.ph} />
          </Field>
          <Field label="Make / Brand / Specifications" required error={errors.make}>
            <TextInput value={vals.make} onChange={v => set('make', v)} placeholder="e.g. Dell · Latitude 5440" />
          </Field>
          <Field label="Segment" required add error={errors.segment}>
            <Select value={vals.segment} options={o.segments} label="Segment" onChange={v => set('segment', v)} invalid={!!errors.segment} />
          </Field>
          <Field label="Printable Description" required error={errors.desc} span="full">
            <textarea className="svf-input svf-textarea" rows={3} placeholder="Enter printable description"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
          <div className="svf-grid svf-grid-2 svf-span-full">
            <Field label="Primary Image" required error={errors.img1}>
              <ImageUpload label="Primary Image" files={files.img1 ?? []} invalid={!!errors.img1}
                hint="Click to upload primary image" onChange={list => setImages('img1', list)} />
            </Field>
            <Field label="Secondary Images">
              <ImageUpload label="Secondary Images" multiple files={files.img2 ?? []}
                hint="Click to upload — you can add multiple images" onChange={list => setImages('img2', list)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section icon={SVC_ICONS.all} title="General Information" sub="Handling, classification and packaging attributes">
        <div className="svf-grid svf-grid-3">
          <Field label="Haz / Non Haz" required error={errors.haz}>
            <Select value={vals.haz} options={HAZ_OPTS} label="Haz / Non Haz" invalid={!!errors.haz}
              onChange={v => set('haz', v)} />
          </Field>
          <Field label="Haz Class" required={vals.haz === 'Hazardous'} add={vals.haz === 'Hazardous'} error={errors.hazClass}>
            <Select value={vals.hazClass} options={HAZ_CLASSES} label="Haz Class" onChange={v => set('hazClass', v)}
              invalid={!!errors.hazClass} disabled={vals.haz !== 'Hazardous'}
              placeholder={vals.haz === 'Hazardous' ? undefined : 'Choose Haz first'} />
          </Field>
          <Field label="UOM" required add error={errors.uom}>
            <Select value={vals.uom} options={o.uom} label="UOM" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <Field label="HSN / SAC Code" required add error={errors.hsn}>
            <Select value={vals.hsn} options={o.hsn} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Condition" required add error={errors.condition}>
            <Select value={vals.condition} options={CONDITIONS} label="Condition" onChange={v => set('condition', v)} invalid={!!errors.condition} />
          </Field>
          <Field label="Packaging Material" required add error={errors.packaging}>
            <Select value={vals.packaging} options={PACKAGING} label="Packaging Material" onChange={v => set('packaging', v)} invalid={!!errors.packaging} />
          </Field>
        </div>
      </Section>

      <AttachmentRemarks vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="confidential" noteLabel="Confidential Info"
        notePh="Enter confidential information" title="Attachment & Confidential Info" sub="Supporting document, certificate or specification" />
    </>
  );
}

function Step({ n, current, title, sub, icon }: { n: number; current: number; title: string; sub: string; icon: ReactNode }) {
  const state = current > n ? 'done' : current === n ? 'active' : 'idle';
  return (
    <div className={`svf-step svf-step-${state}`}>
      <div className="svf-step-icon-wrap">
        <span className="svf-step-icon">{state === 'done' ? SVC_ICONS.check : icon}</span>
        <span className="svf-step-num">{state === 'done' ? SVC_ICONS.check : n}</span>
      </div>
      <div className="svf-step-text">
        <div className="svf-step-title">{title}</div>
        <div className="svf-step-sub">{sub}</div>
      </div>
      {state === 'active' && <span className="svf-step-flag">In Progress</span>}
      {state === 'done' && <span className="svf-step-flag svf-step-flag-done">Completed</span>}
    </div>
  );
}

function Section({ icon, title, sub, extra, children }: { icon: ReactNode; title: string; sub: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="svf-section">
      <div className="svf-section-head">
        <div className="svf-section-icon">{icon}</div>
        <div className="svf-section-titles" title={sub}>
          <span className="svf-section-title">{title}{extra}</span>
        </div>
      </div>
      <div className="svf-section-body">{children}</div>
    </div>
  );
}

function Field({ label, required, optional, add, error, span, children }: {
  label: string; required?: boolean; optional?: boolean; add?: boolean; error?: string; span?: 'full' | '3'; children: ReactNode;
}) {
  const toast = useToast();
  const cls = ['svf-field', error ? 'has-error' : '', span === 'full' ? 'svf-span-full' : span === '3' ? 'svf-span-3' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="svf-label">
        {label} {required && <span className="svf-req">*</span>}
        {optional && <span className="svf-opt">Optional</span>}
        {add && (
          <Tooltip label={`Add new ${label}`}>
            <button type="button" className="svf-plus" tabIndex={-1} aria-label={`Add new ${label}`}
              onClick={(e) => {
                e.preventDefault();
                toast.info(`Add new ${label}`, 'New options can be added once this list is connected to its master.');
              }}>
              {SVC_ICONS.plus}
            </button>
          </Tooltip>
        )}
      </span>
      {children}
      {error && <span className="svf-error"><i className="ri-error-warning-line" /> {error}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" className="svf-input" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}

function Select({ value, options, label, onChange, invalid, disabled, placeholder }: {
  value?: string;
  options: Array<string | { value: string; label: string }>;
  label: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const opts = useMemo(() => options.map(o => (typeof o === 'string' ? { value: o, label: o } : o)), [options]);
  return (
    <div className="svf-select">
      <MasterSelect value={value ?? ''} options={opts} placeholder={placeholder ?? `Select ${label}`}
        searchable={opts.length > 7} invalid={invalid} disabled={disabled} onChange={onChange} />
    </div>
  );
}

const MAX_THUMBS = 6;

function ImageUpload({ label, files, multiple, hint, invalid, onChange }: {
  label: string; files: File[]; multiple?: boolean; hint: string; invalid?: boolean; onChange: (list: File[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const urls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach(u => URL.revokeObjectURL(u)), [urls]);

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    if (!picked.length) return;
    onChange(multiple ? [...files, ...picked] : [picked[0]]);
  };
  const remove = (i: number) => {
    const next = files.filter((_, k) => k !== i);
    onChange(next);
    if (next.length <= MAX_THUMBS) setShowAll(false);
  };

  const total = files.length;
  const overflow = total > MAX_THUMBS;
  const visible = overflow ? urls.slice(0, MAX_THUMBS - 1) : urls;

  return (
    <>
      <label className={`svf-drop${invalid ? ' is-invalid' : ''}`}>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple={multiple} onChange={add} className="svf-drop-input" />
        <span className="svf-file-ico">{SVC_ICONS.upload}</span>
        <span className="svf-drop-txt">
          <b>{!multiple && total ? 'Replace primary image' : hint}</b>
          <span>PNG, JPG or WEBP images{multiple && total ? ` · ${total} added` : ''}</span>
        </span>
      </label>

      {total > 0 && (
        <div className="svf-thumbs">
          {visible.map((src, i) => (
            <div key={src} className="svf-thumb" title={files[i]?.name}>
              <img src={src} alt={files[i]?.name ?? ''} />
              <button type="button" aria-label={`Remove ${files[i]?.name ?? 'image'}`} onClick={(e) => { e.preventDefault(); remove(i); }}>
                {SVC_ICONS.x}
              </button>
            </div>
          ))}
          {overflow && (
            <button type="button" className="svf-thumb svf-thumb--more" aria-label={`Show all ${total} images`}
              onClick={() => setShowAll(true)}>
              <img src={urls[MAX_THUMBS - 1]} alt="" />
              <span>+{total - (MAX_THUMBS - 1)}</span>
            </button>
          )}
        </div>
      )}

      {showAll && createPortal((
        <div className="svf-imgmodal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAll(false); }}>
          <div className="svf-imgmodal" role="dialog" aria-modal="true" aria-label={label}>
            <div className="svf-imgmodal-head">
              <span>{label} <em>({total})</em></span>
              <button type="button" className="svf-imgmodal-close" aria-label="Close" onClick={() => setShowAll(false)}>{SVC_ICONS.x}</button>
            </div>
            <div className="svf-imgmodal-grid">
              {urls.map((src, i) => (
                <div key={src} className="svf-thumb svf-thumb--lg" title={files[i]?.name}>
                  <img src={src} alt={files[i]?.name ?? ''} />
                  <button type="button" aria-label={`Remove ${files[i]?.name ?? 'image'}`} onClick={() => remove(i)}>{SVC_ICONS.x}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function FilePick({ value, file, onPick, hint, accept, invalid }: {
  value?: string; file?: File; onPick: (f: File | null) => void; hint: string; accept?: string; invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPick(f);
    e.target.value = '';
  };
  const withUrl = (fn: (url: string) => void) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    fn(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const view = () => withUrl(url => window.open(url, '_blank', 'noopener'));
  const download = () => withUrl(url => {
    const a = document.createElement('a');
    a.href = url;
    a.download = file?.name ?? 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  const noFile = 'The original file is not available in this session';

  return (
    <div className={`svf-file${invalid ? ' is-invalid' : ''}${value ? ' has-file' : ''}`}>
      <button type="button" className="svf-file-btn" onClick={() => ref.current?.click()}
        title={value ? 'Click to replace the file' : undefined}>
        <span className="svf-file-ico">{SVC_ICONS.upload}</span>
        <span className="svf-file-txt">
          <b title={value}>{value || 'Click to upload'}</b>
          <span>{file ? fileSize(file.size) : hint}</span>
        </span>
      </button>
      {value && (
        <span className="svf-file-acts">
          <Tooltip label={file ? 'View file' : noFile}>
            <button type="button" className="svf-file-act" aria-label="View file" disabled={!file} onClick={view}>{SVC_ICONS.eye}</button>
          </Tooltip>
          <Tooltip label={file ? 'Download file' : noFile}>
            <button type="button" className="svf-file-act" aria-label="Download file" disabled={!file} onClick={download}>{SVC_ICONS.download}</button>
          </Tooltip>
          <Tooltip label="Remove file">
            <button type="button" className="svf-file-act svf-file-act--del" aria-label="Remove file" onClick={() => onPick(null)}>{SVC_ICONS.x}</button>
          </Tooltip>
        </span>
      )}
      <input ref={ref} type="file" hidden accept={accept} onChange={change} />
    </div>
  );
}
