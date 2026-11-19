import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import {
  KIND_SUB, KIND_TITLE, MATERIAL_NAME_PH, OTHER_NAME_PH, OTHER_TYPES,
  type MappedSupplier, type OtherType, type ServiceKind, type ServiceRecord, type ServiceVals,
} from './serviceData';
import {
  apiError, fetchServiceSuppliers, loadServiceBundle, loadServiceCategories, loadServiceFile, saveServiceCore, saveServiceSuppliersStep, segmentReg,
  syncServiceSuppliers,
  type ExistingImage, type Opt, type SavedAttachment, type ServiceBundle, type ServiceCategoryRow,
} from './serviceApi';
import { SupplierMapPanel } from './ServiceSupplierModal';
import ServiceGstModal from './ServiceGstModal';
import { SVC_ICONS } from './serviceIcons';
import { MasterRecordModal } from '../../../master/MasterRecordModal';
import { SegmentModal, type SegmentForm } from '../../../clm/compliance/ClmSegmentPage';
import { CLM_CSS } from '../../../clm/shared/clmShared';
import { bustAllMasterBundles } from '../../../../utils/bustMasterBundles';
import api from '../../../../api';
import { SavingLock, ShimServiceForm } from './serviceLoading';
import { Shimmer } from '../../../../components/ui/Shimmer';
import AttachPicker from '../../procurement-management/sourcing-tracker/AttachPicker';
import './service-form.css';

export interface ServiceFormInput {
  kind: ServiceKind;
  record?: ServiceRecord;
  code: string;
  otype?: OtherType;
  attachmentIds?: number[];
  hasPrimaryImage?: boolean;
  images?: ExistingImage[];
  attachments?: SavedAttachment[];
  loading?: boolean;
}

/* The server's own caps (ServiceController: description max:10000, remark
   max:2000). Enforced here too, so a long description is stopped as it is
   typed instead of failing the save after the whole form is filled in. */
const DESC_MAX = 10000;
const NOTE_MAX = 2000;
const NAME_MAX = 150;
const BRAND_MAX = 255;
/* A real name has at least one letter (any script): "@", "%", "2" or "@#!" are rejected. */
const HAS_LETTER = /\p{L}/u;
/* Same caps as the API: images 2 MB each and at most 10 secondary per save,
   attachment 10 MB of the listed types. */
const IMG_MAX_MB = 2;
const ATT_MAX_MB = 10;
const SECONDARY_MAX = 10;
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const ATT_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp'];
const extOf = (f: File) => (f.name.split('.').pop() ?? '').toLowerCase();
const overMb = (f: File, mb: number) => f.size > mb * 1024 * 1024;

/* The API's field names, mapped to the form field that shows the error. */
const API_FIELD: Record<string, keyof ServiceVals> = {
  name: 'name', description: 'desc', provider_brand: 'provider', category_id: 'category', segment_id: 'segment',
  hsn_id: 'hsn', uom_id: 'uom', gst_id: 'gstId', haz_type: 'haz', haz_class_id: 'hazClass', condition_id: 'condition',
  packaging_id: 'packaging', department_id: 'dept', delivery_type: 'delivery', billing_frequency: 'billing',
  remark: 'remark', confidential_info: 'confidential', classification: 'otype',
  primary_image_file: 'img1', secondary_image_files: 'img2', attachment_files: 'att',
};

type ShownImage = { id: number; name: string; src?: string };

type QuickSlug = 'service_categories' | 'segments' | 'hsn_codes' | 'uom' | 'haz_class' | 'conditions' | 'packaging_material';
type AddMaster = (slug: QuickSlug, field: keyof ServiceVals) => void;

type FormOpts = {
  categoriesLoading?: boolean;
  categories: Opt[]; segments: Opt[]; hsn: Opt[]; uom: Opt[]; depts: Opt[]; hazClasses: Opt[];
  conditions: Opt[]; packaging: Opt[]; delivery: string[]; billing: string[]; haz: string[];
};

const buildOpts = (b: ServiceBundle | null, kind: ServiceKind, otype?: OtherType, cats?: ServiceCategoryRow[] | null): FormOpts => {
  const type = kind === 'soft' ? 'soft_digital' : kind === 'other' ? 'other_operational' : 'self_consumable';
  const o = <T,>(rows: T[] | undefined, id: (r: T) => number, label: (r: T) => string): Opt[] =>
    (rows ?? []).map(r => ({ value: String(id(r)), label: label(r) }));
  return {
    categories: o(
      (cats ?? []).filter(c => c.service_type === type && (type !== 'other_operational' || c.classification === (otype ?? 'professional'))),
      c => c.id, c => c.name,
    ),
    segments: (b?.segments ?? []).map(r => {
      const reg = segmentReg(r.regulatory_status);
      return { value: String(r.id), label: r.name, ...(reg ? { badges: [{ text: '', reg }] } : {}) };
    }),
    hsn: o(b?.hsn_codes, r => r.id, r => (r.description ? `${r.hsn_code} · ${r.description}` : r.hsn_code)),
    uom: o(b?.uom, r => r.id, r => (r.short_code ? `${r.title} (${r.short_code})` : r.title)),
    depts: o(b?.departments, r => r.id, r => r.name),
    hazClasses: o(b?.haz_class, r => r.id, r => r.name),
    conditions: o(b?.conditions, r => r.id, r => r.title),
    packaging: o(b?.packaging_material, r => r.id, r => r.title),
    delivery: b?.delivery_types ?? [],
    billing: b?.billing_frequencies ?? [],
    haz: b?.haz_types ?? ['Non Hazardous', 'Hazardous'],
  };
};

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
  const domesticCount = suppliers.filter(s => s.origin !== 'international').length;
  const gstLocked = domesticCount > 0 && vals.gstPct != null;
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<FileMap>({});
  const [gstOpen, setGstOpen] = useState(false);
  const [serviceId, setServiceId] = useState<number | undefined>(record?.id);
  const [saving, setSaving] = useState(false);
  const [supBusy, setSupBusy] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ slug: QuickSlug; field: keyof ServiceVals } | null>(null);
  const addMaster: AddMaster = (slug, field) => setQuickAdd({ slug, field });
  const [bundle, setBundle] = useState<ServiceBundle | null>(null);
  const catType = kind === 'soft' ? 'soft_digital' : kind === 'other' ? 'other_operational' : null;
  const catClass = kind === 'other' ? (vals.otype ?? 'professional') : undefined;
  const [categories, setCategories] = useState<ServiceCategoryRow[] | null>(catType ? null : []);
  const [catLoading, setCatLoading] = useState(false);
  useEffect(() => {
    if (!catType) return;
    let live = true;
    setCatLoading(true);
    loadServiceCategories(catType, catClass)
      .then(rows => { if (live) { setCategories(rows); setCatLoading(false); } })
      .catch(e => {
        if (!live) return;
        setCategories([]);
        setCatLoading(false);
        toast.error('Could not load service categories', apiError(e, 'Close the form and try again.'));
      });
    return () => { live = false; };
  }, [catType, catClass, toast]);
  const [savedImages, setSavedImages] = useState<ExistingImage[]>(input.images ?? []);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<number[]>(input.attachmentIds ?? []);
  const [savedAtt, setSavedAtt] = useState<SavedAttachment | undefined>(input.attachments?.[0]);
  const [attRemoved, setAttRemoved] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    const created: string[] = [];
    savedImages.forEach(img => {
      if (imageUrls[img.id]) return;
      loadServiceFile(img.path)
        .then(url => {
          if (!live) { URL.revokeObjectURL(url); return; }
          created.push(url);
          setImageUrls(m => ({ ...m, [img.id]: url }));
        })
        .catch(() => {});
    });
    return () => { live = false; };
  }, [savedImages]);
  useEffect(() => () => { Object.values(imageUrls).forEach(u => URL.revokeObjectURL(u)); }, []);

  const keptImages = savedImages.filter(i => !removedImageIds.includes(i.id));
  const primarySaved: ShownImage[] = (files.img1?.length ? [] : keptImages.filter(i => i.isPrimary))
    .map(i => ({ id: i.id, name: i.name, src: imageUrls[i.id] }));
  const secondarySaved: ShownImage[] = keptImages.filter(i => !i.isPrimary)
    .map(i => ({ id: i.id, name: i.name, src: imageUrls[i.id] }));
  const removeSavedImage = (id: number) => setRemovedImageIds(ids => (ids.includes(id) ? ids : [...ids, id]));
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadServiceBundle()
      .then(b => { if (live) setBundle(b); })
      .catch(e => { if (live) toast.error('Could not load form options', apiError(e, 'Please close the form and try again.')); });
    return () => { live = false; };
  }, [toast]);

  const opts = useMemo(() => buildOpts(bundle, kind, vals.otype, categories), [bundle, kind, vals.otype, categories]);
  const formLoading = !!input.loading || !bundle || categories === null;
  const fieldOpts = useMemo(() => ({ ...opts, categoriesLoading: catLoading }), [opts, catLoading]);
  const gstRateId = useMemo(() => {
    if (vals.gstId) return vals.gstId;
    if (vals.gstPct == null) return undefined;
    const hit = (bundle?.gst_percentage ?? []).find(g => Number(g.percentage) === vals.gstPct);
    return hit ? String(hit.id) : undefined;
  }, [vals.gstId, vals.gstPct, bundle]);

  const pick = (k: FileKey, f: File | null) => {
    if (k === 'att' && f) {
      const bad = !ATT_EXT.includes(extOf(f)) ? 'Use a PDF, DOC, DOCX, XLS, XLSX, CSV or image file'
        : overMb(f, ATT_MAX_MB) ? `Attachment must be at most ${ATT_MAX_MB} MB` : '';
      if (bad) {
        setErrors(e => ({ ...e, att: bad }));
        toast.warning('Attachment not added', `${f.name}: ${bad.toLowerCase()}.`);
        return;
      }
    }
    if (k === 'att' && !f) setAttRemoved(true);
    if (k === 'att' && f) setAttRemoved(false);
    setFiles(p => ({ ...p, [k]: f ?? undefined }));
    setVals(p => ({ ...p, [k]: f ? f.name : '' }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const setImages = (k: ImageKey, picked: File[]) => {
    const rejected: string[] = [];
    let list = picked.filter(f => {
      if (!IMG_EXT.includes(extOf(f))) { rejected.push(`${f.name} is not a PNG, JPG or WEBP image`); return false; }
      if (overMb(f, IMG_MAX_MB)) { rejected.push(`${f.name} is over ${IMG_MAX_MB} MB`); return false; }
      return true;
    });
    if (k === 'img2' && list.length > SECONDARY_MAX) {
      rejected.push(`only ${SECONDARY_MAX} secondary images can be added at a time`);
      list = list.slice(0, SECONDARY_MAX);
    }
    if (rejected.length) {
      const msg = rejected.length === 1 ? rejected[0] : `${rejected.length} images skipped`;
      setErrors(e => ({ ...e, [k]: `Images must be PNG, JPG or WEBP, ${IMG_MAX_MB} MB max` }));
      toast.warning('Some images were not added', rejected.length === 1 ? `${msg}.` : rejected.join(' · '));
      if (list.length === (files[k]?.length ?? 0)) return;
    }
    setFiles(p => ({ ...p, [k]: list }));
    setVals(p => ({
      ...p,
      [k]: list.length === 0 ? '' : list.length === 1 ? list[0].name : `${list.length} images`,
    }));
    if (errors[k] && !rejected.length) setErrors(e => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.apm-mv-backdrop, .supch-ov, .avm-backdrop, .apm-gst-overlay, .clm-modal-bd, .master-modal.show, .svf-imgmodal-backdrop, .cam-layer, .sta-att')) return;
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
    setVals(p => ({ ...p, otype: v as OtherType, category: '' }));
    setErrors(e => ({ ...e, otype: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    REQUIRED[kind].forEach(k => {
      if (k === 'img1' && (files.img1?.length || keptImages.some(i => i.isPrimary))) return;
      const v = vals[k];
      if (v == null || String(v).trim() === '') next[k] = 'This field is required';
    });
    const brandKey = kind === 'trackable' || kind === 'consumable' ? 'make' : 'provider';
    if (!next.name && vals.name.trim().length > NAME_MAX) next.name = `Service name must be at most ${NAME_MAX} characters`;
    if (!next.name && !HAS_LETTER.test(vals.name)) next.name = 'Service name must contain letters, not only numbers or special characters';
    else if (!next.name && vals.name.trim().length < 2) next.name = 'Service name must be at least 2 characters';
    if (!next[brandKey] && (vals[brandKey] ?? '').trim().length > BRAND_MAX) next[brandKey] = `Must be at most ${BRAND_MAX} characters`;
    if (REQUIRED[kind].includes('haz') && vals.haz === 'Hazardous' && !vals.hazClass) {
      next.hazClass = 'Haz Class is required when Hazardous';
    }
    setErrors(next);
    const n = Object.keys(next).length;
    if (n) {
      toast.warning(`${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`, 'Fix the highlighted fields to continue.');
      requestAnimationFrame(() => {
        bodyRef.current?.querySelector('.svf-field.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    return n === 0;
  };

  const goNext = async () => {
    if (saving || !validate()) return;
    if (!gstRateId) {
      toast.error('GST is mandatory', 'Map a GST % to this service before continuing.');
      setGstOpen(true);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveServiceCore({
        id: serviceId, kind, vals: { ...vals, gstId: gstRateId }, files,
        replaceAttachmentIds: files.att ? attachmentIds : undefined,
        removeAttachmentIds: attRemoved && !files.att ? attachmentIds : undefined,
        removeImageIds: removedImageIds,
      });
      setServiceId(saved.id);
      setSavedImages(saved.images);
      setRemovedImageIds([]);
      setAttachmentIds(saved.attachmentIds);
      setSavedAtt(saved.attachments[0]);
      setAttRemoved(false);
      setVals(p => ({ ...p, att: saved.attachments[0]?.name ?? '' }));
      setFiles({});
      setStage(2);
      bodyRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      toast.error('Could not save the service', apiError(e, 'Please check the fields and try again.'));
      const apiErrors = (e as { response?: { data?: { errors?: Record<string, string[]> } } })?.response?.data?.errors;
      if (apiErrors) {
        const brandKey = kind === 'trackable' || kind === 'consumable' ? 'make' : 'provider';
        const next: Errors = {};
        Object.entries(apiErrors).forEach(([k, msgs]) => {
          const base = API_FIELD[k.split('.')[0]];
          const field = base === 'provider' ? brandKey : base;
          if (field && msgs?.[0]) next[field] = msgs[0];
        });
        if (Object.keys(next).length) {
          setErrors(cur => ({ ...cur, ...next }));
          requestAnimationFrame(() => {
            bodyRef.current?.querySelector('.svf-field.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const mapSuppliers = async (next: MappedSupplier[]) => {
    if (serviceId == null) { setSuppliers(next); return; }
    const prev = suppliers;
    setSuppliers(next);
    setSupBusy(true);
    try {
      setSuppliers(await syncServiceSuppliers(serviceId, prev, next));
    } catch (e) {
      toast.error('Could not save the supplier change', apiError(e, 'Please try again.'));
      try { setSuppliers(await fetchServiceSuppliers(serviceId)); } catch {  }
    } finally {
      setSupBusy(false);
    }
  };

  const masterAdded = async (field: keyof ServiceVals, row: Record<string, unknown>, label: string) => {
    const id = row?.id != null ? String(row.id) : '';
    setQuickAdd(null);
    bustAllMasterBundles();
    if (row?.status != null && String(row.status).toLowerCase() !== 'active') {
      toast.info('Saved as Inactive', `Only Active records appear in this dropdown. Set the ${label} to Active to select it here.`);
    }
    try {
      setBundle(await loadServiceBundle(true));
      if (field === 'category' && catType) setCategories(await loadServiceCategories(catType, catClass, true));
      if (id && (row?.status == null || String(row.status).toLowerCase() === 'active')) set(field, id as never);
    } catch (e) {
      toast.error('Could not refresh the list', apiError(e, 'Close and reopen the form to see the new record.'));
    }
  };

  const submit = async () => {
    if (saving || serviceId == null) return;
    setSaving(true);
    try {
      await saveServiceSuppliersStep(serviceId, suppliers);
      const rec: ServiceRecord = {
        id: serviceId,
        code,
        kind,
        created: record?.created ?? new Date().toISOString(),
        vals: { ...vals, name: vals.name.trim(), desc: vals.desc.trim() },
        suppliers,
        active: true,
      };
      onSubmit(rec, isEdit);
    } catch (e) {
      toast.error('Could not save the suppliers', apiError(e, 'Please check the mapped suppliers and try again.'));
    } finally {
      setSaving(false);
    }
  };

  const title = `${isEdit ? 'Edit' : 'Add'} ${KIND_TITLE[kind]}`;
  const stage1Sub = kind === 'soft' ? 'Identity, category & delivery details'
    : kind === 'other' ? 'Identity, type & billing details'
      : 'Identity, classification & general info';

  return createPortal((
    <div className="svf-backdrop">
      <div className="svf-modal" role="dialog" aria-modal="true" aria-label={title}>
        {supBusy && !saving && <SavingLock label="Saving suppliers…" />}
        {saving && <SavingLock label={stage === 1 ? (serviceId != null ? 'Saving changes…' : 'Saving…') : (isEdit ? 'Updating service…' : 'Submitting service…')} />}
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
            <Tooltip label={gstLocked
              ? `GST is locked — ${domesticCount} domestic supplier${domesticCount === 1 ? ' is' : 's are'} mapped to this service`
              : 'Map / manage GST %'}>
              <button type="button" className={`apm-head-btn${gstLocked ? ' is-locked' : ''}`} disabled={gstLocked}
                onClick={() => { if (!gstLocked) setGstOpen(true); }}>
                {gstLocked && SVC_ICONS.lock}
                {vals.gstPct != null ? `GST ${vals.gstPct}%` : 'GST (%)'}
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
          {stage === 1 && formLoading && (
            <ShimServiceForm sections={kind === 'soft' || kind === 'other' ? [9, 2] : [6, 6, 2]} />
          )}
          {stage === 1 && !formLoading && kind === 'soft' && <SoftFields o={fieldOpts} addMaster={addMaster} savedAtt={savedAtt} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} />}
          {stage === 1 && !formLoading && kind === 'other' && <OtherFields o={fieldOpts} addMaster={addMaster} savedAtt={savedAtt} vals={vals} set={set} setOtype={setOtype} errors={errors} files={files} pick={pick} setImages={setImages} />}
          {stage === 1 && !formLoading && (kind === 'trackable' || kind === 'consumable') && (
            <MaterialFields o={opts} addMaster={addMaster} savedAtt={savedAtt} kind={kind} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages}
              primarySaved={primarySaved} secondarySaved={secondarySaved} onRemoveSaved={removeSavedImage} />
          )}

          {stage === 2 && (
            <div className="svs-teal svf-sup-panel">
              <SupplierMapPanel serviceName={vals.name} suppliers={suppliers} onChange={(next) => { void mapSuppliers(next); }} defaultGst={vals.gstPct}
                /* This service's own type — the dropdown offers only suppliers
                   that serve it. Soft / Digital has no sub-type. */
                bucket={{
                  service_type: kind === 'soft' ? 'soft_digital' : kind === 'other' ? 'other_operational' : 'self_consumable',
                  classification: kind === 'soft' ? null : kind === 'other' ? (vals.otype ?? 'professional') : kind,
                }} />
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
                <button type="button" className="svf-btn-primary" onClick={() => { void goNext(); }} disabled={saving || formLoading}>
                  {SVC_ICONS.save} {saving ? 'Saving…' : 'Save & Next'} <span className="svf-btn-chev">{SVC_ICONS.chevron}</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="svf-btn-outline" onClick={() => setStage(1)} disabled={saving}>
                  <span className="svf-btn-chev is-back">{SVC_ICONS.chevron}</span> Previous
                </button>
                <button type="button" className="svf-btn-primary" onClick={() => { void submit(); }} disabled={saving || supBusy}>
                  {SVC_ICONS.save} {saving ? 'Saving…' : isEdit ? 'Update Service' : 'Submit Service'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {quickAdd?.slug === 'segments' && (
        <>
          <style>{CLM_CSS}</style>
          <SegmentModal
            existing={null}
            nextCode={`S-${String((bundle?.segments.length ?? 0) + 1).padStart(3, '0')}`}
            existingSegments={(bundle?.segments ?? []).map(sg => ({ name: sg.name, regulatory_status: sg.regulatory_status ?? undefined }))}
            onClose={() => setQuickAdd(null)}
            onSave={async (form: SegmentForm) => {
              try {
                const { data } = await api.post('/clm/segments', form);
                const row = (data?.data ?? data) as Record<string, unknown>;
                toast.success('Segment added', String(row?.name ?? form.name ?? ''));
                await masterAdded('segment', row, 'segment');
              } catch (e) {
                toast.error('Save failed', apiError(e, 'Could not save the segment.'));
              }
            }}
          />
        </>
      )}
      {quickAdd && quickAdd.slug !== 'segments' && (
        <MasterRecordModal
          slug={quickAdd.slug}
          defaults={quickAdd.slug === 'service_categories'
            ? (kind === 'other'
              ? { service_type: 'other_operational', classification: vals.otype ?? 'professional' }
              : { service_type: 'soft_digital' })
            : undefined}
          onClose={() => setQuickAdd(null)}
          onSaved={(row) => { void masterAdded(quickAdd.field, row, quickAdd.slug === 'service_categories' ? 'category' : 'record'); }}
        />
      )}

      {gstOpen && (
        <ServiceGstModal
          value={gstRateId}
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
  o?: FormOpts;
  addMaster?: AddMaster;
  savedAtt?: SavedAttachment;
  vals: ServiceVals; set: SetFn; errors: Errors; files: FileMap;
  pick: (k: FileKey, f: File | null) => void;
  setImages: (k: ImageKey, list: File[]) => void;
};

function AttachmentRemarks({ vals, set, errors, files, pick, savedAtt, noteKey, noteLabel, notePh, title, sub }: GroupProps & {
  noteKey: 'remark' | 'confidential'; noteLabel: string; notePh: string; title: string; sub: string;
}) {
  return (
    <Section icon={SVC_ICONS.clip} title={title} sub={sub}>
      <div className="svf-grid svf-grid-4">
        <Field label="Attachment" optional error={errors.att}>
          <FilePick value={vals.att} file={files.att} remote={!files.att && vals.att ? savedAtt : undefined} hint="PDF, DOC, XLS or images · 10 MB max" invalid={!!errors.att}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp" onPick={f => pick('att', f)} />
        </Field>
        <Field label={noteLabel} span="3" count={{ len: (vals[noteKey] ?? '').length, max: NOTE_MAX }}>
          <textarea className="svf-input svf-textarea" rows={3} maxLength={NOTE_MAX} placeholder={notePh}
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

function SoftFields({ o: opts, addMaster, savedAtt, vals, set, errors, files, pick, setImages }: GroupProps) {
  const o = opts!;
  return (
    <>
      <Section icon={SVC_ICONS.soft} title="Service Core Information" sub="Service identity, provider and classification">
        <div className="svf-grid svf-grid-4">
          <Field label="Service Name" required error={errors.name} count={{ len: vals.name.length, max: NAME_MAX }}>
            <TextInput value={vals.name} maxLength={NAME_MAX} invalid={!!errors.name} onChange={v => set('name', v)} placeholder="e.g. Microsoft 365 Business" />
          </Field>
          <Field label="Service Category" required add onAdd={() => addMaster?.('service_categories', 'category')} error={errors.category}>
            <Select value={vals.category} options={o.categories} label="Service Category" onChange={v => set('category', v)} invalid={!!errors.category} />
          </Field>
          <Field label="Service Provider / Brand" required error={errors.provider} count={{ len: (vals.provider ?? '').length, max: BRAND_MAX }}>
            <TextInput value={vals.provider} maxLength={BRAND_MAX} invalid={!!errors.provider} onChange={v => set('provider', v)} placeholder="e.g. Microsoft, AWS, Anthropic" />
          </Field>
          <Field label="Service Segment" required add onAdd={() => addMaster?.('segments', 'segment')} error={errors.segment}>
            <Select value={vals.segment} options={o.segments} label="Service Segment" onChange={v => set('segment', v)} invalid={!!errors.segment} />
          </Field>
          <Field label="Service Delivery Type" required error={errors.delivery}>
            <Select value={vals.delivery} options={o.delivery} label="Service Delivery Type" onChange={v => set('delivery', v)} invalid={!!errors.delivery} />
          </Field>
          <Field label="HSN / SAC Code" required add onAdd={() => addMaster?.('hsn_codes', 'hsn')} error={errors.hsn}>
            <Select value={vals.hsn} options={o.hsn} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Unit of Measurement" required add onAdd={() => addMaster?.('uom', 'uom')} error={errors.uom}>
            <Select value={vals.uom} options={o.uom} label="Unit of Measurement" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <ContractToggle vals={vals} set={set} />
          <Field label="Service Description" required error={errors.desc} span="full" count={{ len: vals.desc.length, max: DESC_MAX }}>
            <textarea className="svf-input svf-textarea" rows={3} maxLength={DESC_MAX} placeholder="Describe the scope of this service"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
        </div>
      </Section>
      <AttachmentRemarks savedAtt={savedAtt} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="remark" noteLabel="Remark"
        notePh="Enter any remark about this service" title="Attachment & Remarks" sub="Supporting document and internal notes" />
    </>
  );
}

function OtherFields({ o: opts, addMaster, savedAtt, vals, set, setOtype, errors, files, pick, setImages }: GroupProps & { setOtype: (v: string) => void }) {
  const ot = (vals.otype ?? 'professional') as OtherType;
  const o = { ...opts!, ph: OTHER_NAME_PH[ot] };
  return (
    <>
      <Section icon={SVC_ICONS.other} title="Service Core Information" sub="Service identity, vendor and billing details">
        <div className="svf-grid svf-grid-4">
          <Field label="Service Name" required error={errors.name} count={{ len: vals.name.length, max: NAME_MAX }}>
            <TextInput value={vals.name} maxLength={NAME_MAX} invalid={!!errors.name} onChange={v => set('name', v)} placeholder={o.ph} />
          </Field>
          <Field label="Service Type" required error={errors.otype}>
            <Select value={vals.otype} options={OTHER_TYPES} label="Service Type" onChange={setOtype} invalid={!!errors.otype} />
          </Field>
          <Field label="Service Category" required add onAdd={() => addMaster?.('service_categories', 'category')} error={errors.category}>
            {o.categoriesLoading
              ? <Shimmer height={42} radius={12} />
              : <Select key={`cat-${ot}`} value={vals.category} options={o.categories} label="Service Category" onChange={v => set('category', v)} invalid={!!errors.category} />}
          </Field>
          <Field label="Service Provider / Vendor" required error={errors.provider} count={{ len: (vals.provider ?? '').length, max: BRAND_MAX }}>
            <TextInput value={vals.provider} maxLength={BRAND_MAX} invalid={!!errors.provider} onChange={v => set('provider', v)} placeholder="e.g. Sharma & Associates" />
          </Field>
          <Field label="Department / Cost Centre" required error={errors.dept}>
            <Select value={vals.dept} options={o.depts} label="Department / Cost Centre" onChange={v => set('dept', v)} invalid={!!errors.dept} />
          </Field>
          <Field label="Billing Frequency" required error={errors.billing}>
            <Select value={vals.billing} options={o.billing} label="Billing Frequency" onChange={v => set('billing', v)} invalid={!!errors.billing} />
          </Field>
          <Field label="HSN / SAC Code" required add onAdd={() => addMaster?.('hsn_codes', 'hsn')} error={errors.hsn}>
            <Select value={vals.hsn} options={o.hsn} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Unit of Measurement" required add onAdd={() => addMaster?.('uom', 'uom')} error={errors.uom}>
            <Select value={vals.uom} options={o.uom} label="Unit of Measurement" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <ContractToggle vals={vals} set={set} />
          <Field label="Service Description" required error={errors.desc} span="3" count={{ len: vals.desc.length, max: DESC_MAX }}>
            <textarea className="svf-input svf-textarea" rows={3} maxLength={DESC_MAX} placeholder="Describe the scope of this service"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
        </div>
      </Section>
      <AttachmentRemarks savedAtt={savedAtt} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="remark" noteLabel="Remark"
        notePh="Enter any remark about this service" title="Attachment & Remarks" sub="Supporting document and internal notes" />
    </>
  );
}

function MaterialFields({ o: opts, addMaster, savedAtt, kind, vals, set, errors, files, pick, setImages, primarySaved, secondarySaved, onRemoveSaved }: GroupProps & {
  kind: 'trackable' | 'consumable'; primarySaved: ShownImage[]; secondarySaved: ShownImage[]; onRemoveSaved: (id: number) => void;
}) {
  const o = { ...opts!, ph: MATERIAL_NAME_PH[kind] };
  return (
    <>
      <Section icon={SVC_ICONS[kind]} title={`${kind === 'trackable' ? 'Trackable' : 'Consumable'} Material / Goods Core Information`}
        sub="Identity, description and classification">
        <div className="svf-grid svf-grid-3">
          <Field label="Service Name" required error={errors.name} count={{ len: vals.name.length, max: NAME_MAX }}>
            <TextInput value={vals.name} maxLength={NAME_MAX} invalid={!!errors.name} onChange={v => set('name', v)} placeholder={o.ph} />
          </Field>
          <Field label="Make / Brand / Specifications" required error={errors.make} count={{ len: (vals.make ?? '').length, max: BRAND_MAX }}>
            <TextInput value={vals.make} maxLength={BRAND_MAX} invalid={!!errors.make} onChange={v => set('make', v)} placeholder="e.g. Dell · Latitude 5440" />
          </Field>
          <Field label="Segment" required add onAdd={() => addMaster?.('segments', 'segment')} error={errors.segment}>
            <Select value={vals.segment} options={o.segments} label="Segment" onChange={v => set('segment', v)} invalid={!!errors.segment} />
          </Field>
          <Field label="Printable Description" required error={errors.desc} span="full" count={{ len: vals.desc.length, max: DESC_MAX }}>
            <textarea className="svf-input svf-textarea" rows={3} maxLength={DESC_MAX} placeholder="Enter printable description"
              value={vals.desc} onChange={e => set('desc', e.target.value)} />
          </Field>
          <div className="svf-grid svf-grid-2 svf-span-full">
            <Field label="Primary Image" required error={errors.img1}>
              <ImageUpload label="Primary Image" files={files.img1 ?? []} invalid={!!errors.img1}
                saved={primarySaved} onRemoveSaved={onRemoveSaved}
                hint="Click to upload primary image" onChange={list => setImages('img1', list)} />
            </Field>
            <Field label="Secondary Images" error={errors.img2}>
              <ImageUpload label="Secondary Images" multiple files={files.img2 ?? []} invalid={!!errors.img2}
                saved={secondarySaved} onRemoveSaved={onRemoveSaved}
                hint="Click to upload — you can add multiple images" onChange={list => setImages('img2', list)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section icon={SVC_ICONS.all} title="General Information" sub="Handling, classification and packaging attributes">
        <div className="svf-grid svf-grid-3">
          <Field label="Haz / Non Haz" required error={errors.haz}>
            <Select value={vals.haz} options={o.haz} label="Haz / Non Haz" invalid={!!errors.haz}
              onChange={v => set('haz', v)} />
          </Field>
          <Field label="Haz Class" required={vals.haz === 'Hazardous'} add={vals.haz === 'Hazardous'} onAdd={() => addMaster?.('haz_class', 'hazClass')} error={errors.hazClass}>
            <Select value={vals.hazClass} options={o.hazClasses} label="Haz Class" onChange={v => set('hazClass', v)}
              invalid={!!errors.hazClass} disabled={vals.haz !== 'Hazardous'}
              placeholder={vals.haz === 'Hazardous' ? undefined : 'Choose Haz first'} />
          </Field>
          <Field label="UOM" required add onAdd={() => addMaster?.('uom', 'uom')} error={errors.uom}>
            <Select value={vals.uom} options={o.uom} label="UOM" onChange={v => set('uom', v)} invalid={!!errors.uom} />
          </Field>
          <Field label="HSN / SAC Code" required add onAdd={() => addMaster?.('hsn_codes', 'hsn')} error={errors.hsn}>
            <Select value={vals.hsn} options={o.hsn} label="HSN / SAC Code" onChange={v => set('hsn', v)} invalid={!!errors.hsn} />
          </Field>
          <Field label="Condition" required add onAdd={() => addMaster?.('conditions', 'condition')} error={errors.condition}>
            <Select value={vals.condition} options={o.conditions} label="Condition" onChange={v => set('condition', v)} invalid={!!errors.condition} />
          </Field>
          <Field label="Packaging Material" required add onAdd={() => addMaster?.('packaging_material', 'packaging')} error={errors.packaging}>
            <Select value={vals.packaging} options={o.packaging} label="Packaging Material" onChange={v => set('packaging', v)} invalid={!!errors.packaging} />
          </Field>
        </div>
      </Section>

      <AttachmentRemarks savedAtt={savedAtt} vals={vals} set={set} errors={errors} files={files} pick={pick} setImages={setImages} noteKey="confidential" noteLabel="Confidential Info"
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

function Field({ label, required, optional, add, onAdd, error, span, count, children }: {
  label: string; required?: boolean; optional?: boolean; add?: boolean; onAdd?: () => void; error?: string; span?: 'full' | '3';
  /** Live "123/10000" for a capped textarea — the cap used to surface only as
      a save failure after the whole form had been filled in. */
  count?: { len: number; max: number };
  children: ReactNode;
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
                if (onAdd) { onAdd(); return; }
                toast.info(`Add new ${label}`, 'New options can be added once this list is connected to its master.');
              }}>
              {SVC_ICONS.plus}
            </button>
          </Tooltip>
        )}
        {count && (
          <span className={`svf-charcount${count.len >= count.max ? ' is-full' : ''}`}>
            {count.len.toLocaleString('en-IN')}/{count.max.toLocaleString('en-IN')}
          </span>
        )}
      </span>
      {children}
      {error && <span className="svf-error"><i className="ri-error-warning-line" /> {error}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, maxLength, invalid }: {
  value?: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; invalid?: boolean;
}) {
  return <input type="text" className={`svf-input${invalid ? ' is-invalid' : ''}`} value={value ?? ''} placeholder={placeholder}
    maxLength={maxLength} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value)} />;
}

function Select({ value, options, label, onChange, invalid, disabled, placeholder }: {
  value?: string;
  options: Array<string | Opt>;
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
        searchable={opts.length > 7} invalid={invalid} disabled={disabled} onChange={onChange}
        menuClassName="svf-select-menu" />
    </div>
  );
}

const MAX_THUMBS = 6;

function ImageUpload({ label, files, multiple, hint, invalid, onChange, saved = [], onRemoveSaved }: {
  label: string; files: File[]; multiple?: boolean; hint: string; invalid?: boolean; onChange: (list: File[]) => void;
  saved?: ShownImage[]; onRemoveSaved?: (id: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const dropRef = useRef<HTMLButtonElement>(null);
  const fileUrls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
  useEffect(() => () => fileUrls.forEach(u => URL.revokeObjectURL(u)), [fileUrls]);

  const add = (list: File[]) => {
    const picked = list.filter(f => f.type.startsWith('image/'));
    if (!picked.length) return;
    onChange(multiple ? [...files, ...picked] : [picked[0]]);
  };
  const removeFile = (i: number) => {
    const next = files.filter((_, k) => k !== i);
    onChange(next);
    if (next.length + saved.length <= MAX_THUMBS) setShowAll(false);
  };

  const items = [
    ...saved.map(s => ({ key: `s-${s.id}`, src: s.src, name: s.name, remove: () => onRemoveSaved?.(s.id) })),
    ...files.map((f, i) => ({ key: fileUrls[i] ?? `f-${i}`, src: fileUrls[i], name: f.name, remove: () => removeFile(i) })),
  ];
  const total = items.length;
  const overflow = total > MAX_THUMBS;
  const visible = overflow ? items.slice(0, MAX_THUMBS - 1) : items;
  const thumb = (it: typeof items[number], lg = false) => (
    <div key={it.key} className={`svf-thumb${lg ? ' svf-thumb--lg' : ''}`} title={it.name}>
      {it.src ? <img src={it.src} alt={it.name} /> : <span className="svf-thumb-load" />}
      <button type="button" aria-label={`Remove ${it.name}`} onClick={(e) => { e.preventDefault(); it.remove(); }}>
        {SVC_ICONS.x}
      </button>
    </div>
  );

  return (
    <>
      <button type="button" ref={dropRef} className={`svf-drop${invalid ? ' is-invalid' : ''}`} aria-haspopup="menu" aria-expanded={pickOpen}
        onClick={() => setPickOpen(o => !o)}>
        <span className="svf-file-ico">{SVC_ICONS.upload}</span>
        <span className="svf-drop-txt">
          <b>{!multiple && total ? 'Replace primary image' : hint}</b>
          <span>PNG, JPG or WEBP · {IMG_MAX_MB} MB max{multiple && total ? ` · ${total} added` : ''}</span>
        </span>
      </button>
      <AttachPicker anchorRef={dropRef} open={pickOpen} onClose={() => setPickOpen(false)} accept="image/png,image/jpeg,image/webp"
        multiple={multiple} onFiles={add}
        camera={{ title: `Take ${label.toLowerCase()}`, subject: label, namePrefix: multiple ? 'secondary-image' : 'primary-image' }} />

      {total > 0 && (
        <div className="svf-thumbs">
          {visible.map(it => thumb(it))}
          {overflow && (
            <button type="button" className="svf-thumb svf-thumb--more" aria-label={`Show all ${total} images`}
              onClick={() => setShowAll(true)}>
              {items[MAX_THUMBS - 1]?.src ? <img src={items[MAX_THUMBS - 1].src} alt="" /> : <span className="svf-thumb-load" />}
              <span>+{total - (MAX_THUMBS - 1)}</span>
            </button>
          )}
        </div>
      )}

      {showAll && createPortal((
        <div className="svf-imgmodal-backdrop">
          <div className="svf-imgmodal" role="dialog" aria-modal="true" aria-label={label}>
            <div className="svf-imgmodal-head">
              <span>{label} <em>({total})</em></span>
              <button type="button" className="svf-imgmodal-close" aria-label="Close" onClick={() => setShowAll(false)}>{SVC_ICONS.x}</button>
            </div>
            <div className="svf-imgmodal-grid">
              {items.map(it => thumb(it, true))}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function FilePick({ value, file, remote, onPick, hint, accept, invalid }: {
  value?: string; file?: File; remote?: SavedAttachment; onPick: (f: File | null) => void; hint: string; accept?: string; invalid?: boolean;
}) {
  const toast = useToast();
  const [fetching, setFetching] = useState<'view' | 'download' | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const withUrl = (action: 'view' | 'download', fn: (url: string) => void) => {
    if (file) {
      const url = URL.createObjectURL(file);
      fn(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    if (!remote || fetching) return;
    setFetching(action);
    loadServiceFile(remote.path)
      .then(url => { fn(url); setTimeout(() => URL.revokeObjectURL(url), 60_000); })
      .catch(() => toast.error('Could not open the attachment', 'Please try again.'))
      .finally(() => setFetching(null));
  };
  const view = () => withUrl('view', url => window.open(url, '_blank', 'noopener'));
  const download = () => withUrl('download', url => {
    const a = document.createElement('a');
    a.href = url;
    a.download = file?.name ?? remote?.name ?? 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  const noFile = 'The original file is not available in this session';

  return (
    <div className={`svf-file${invalid ? ' is-invalid' : ''}${value ? ' has-file' : ''}`}>
      <button type="button" ref={btnRef} className="svf-file-btn" aria-haspopup="menu" aria-expanded={pickOpen} onClick={() => setPickOpen(o => !o)}
        title={value ? 'Click to replace the file' : undefined}>
        <span className="svf-file-ico">{SVC_ICONS.upload}</span>
        <span className="svf-file-txt">
          <b title={value}>{value || 'Click to upload'}</b>
          <span>{file ? fileSize(file.size) : remote?.size ? fileSize(remote.size) : hint}</span>
        </span>
      </button>
      {value && (
        <span className="svf-file-acts">
          <Tooltip label={file || remote ? 'View file' : noFile}>
            <button type="button" className="svf-file-act" aria-label="View file" disabled={(!file && !remote) || !!fetching} aria-busy={fetching === 'view'} onClick={view}>
              {fetching === 'view' ? <i className="ri-loader-4-line ri-spin svf-file-spin" aria-hidden="true" /> : SVC_ICONS.eye}
            </button>
          </Tooltip>
          <Tooltip label={file || remote ? 'Download file' : noFile}>
            <button type="button" className="svf-file-act" aria-label="Download file" disabled={(!file && !remote) || !!fetching} aria-busy={fetching === 'download'} onClick={download}>
              {fetching === 'download' ? <i className="ri-loader-4-line ri-spin svf-file-spin" aria-hidden="true" /> : SVC_ICONS.download}
            </button>
          </Tooltip>
          <Tooltip label="Remove file">
            <button type="button" className="svf-file-act svf-file-act--del" aria-label="Remove file" onClick={() => onPick(null)}>{SVC_ICONS.x}</button>
          </Tooltip>
        </span>
      )}
      <AttachPicker anchorRef={btnRef} open={pickOpen} onClose={() => setPickOpen(false)} accept={accept ?? ''} onFile={f => onPick(f)}
        camera={{ title: 'Take attachment photo', subject: 'Attachment', namePrefix: 'attachment' }} />
    </div>
  );
}
