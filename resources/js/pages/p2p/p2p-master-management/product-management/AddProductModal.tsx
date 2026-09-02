import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import './product-management.css';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { resolveFileUrl, viewFile, downloadFile } from '../../../../utils/resolveFileUrl';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import Tooltip from '../../../../components/ui/Tooltip';
import { SegmentModal, type SegmentForm } from '../../../clm/compliance/ClmSegmentPage';
import { CLM_CSS } from '../../../clm/shared/clmShared';
import { readProductMasterBundle,  writeProductMasterBundle,} from './productBundleCache';
import { bustAllMasterBundles } from '../../../../utils/bustMasterBundles';
import { MasterRecordModal } from '../../../master/MasterRecordModal';
import { formatProductCode } from '../../../../utils/formatProductCode';

export type VendorEntry = {
  id: string;
  vendorId: string;
  productCode: string;
  vendorCode: string;
  vendorName: string;
  website: string;
  contactPerson: string;
  contactNo: string;
  email: string;
  designation: string;
  attachments: number;
  purchasePrice: number;
  gstPct: number;
  gstAmt: number;
  totalAmt: number;
  mapDate: string;
  remarks: string;
};

export type AddProductPayload = {
  name: string;
  genericName: string;
  description: string;
  brand: string;
  segment: string;
  hazType: string;
  hazClass: string;
  uom: string;
  hsn: string;
  condition: string;
  packagingMaterial: string;
  confidential: string;
  primaryImagePath: string | null;
  secondaryImagePaths: string[];
  basePrice: number;
  gstPct: number;
  gstAmt: number;
  totalPrice: number;
  markBottom: string;
  netWeight: number;
  grossWeight: number;
  length: number;
  width: number;
  height: number;
  qcRecords: QcRecord[];
  documents: Array<{ name: string; type: string }>;
  vendors: VendorEntry[];
};

export type QcRecord = {
  id: number;
  name: string;
  purpose: string;
  issuedBy: string;
  testingParameter: string;
  minAcceptance: string;
  attachmentName: string;
  attachmentUrl?: string;
  attachmentFile?: File | null;
  attachmentPath?: string;
};

const HAZ_TYPES = ['Non-Haz', 'Haz'];

const QC_NAMES = ['COA', 'MSDS', 'FSSAI', 'AGMARK', 'ISO 9001', 'ISO 22000', 'HACCP', 'HALAL', 'KOSHER', 'FSSC 22000'];

export type VendorOpt = {
  id: string;
  code: string;
  name: string;
  website: string;
  contact: string;
  phone: string;
  email: string;
  designation: string;
  status: string;
  type: string;
  state: string;
  segmentIds: number[];
};

type Tab = 'core' | 'sales' | 'quality';

const formatSupplierCode = (raw: string): string => {
  const m = String(raw ?? '').match(/(\d+)\s*$/);
  return m ? `S-${m[1].padStart(3, '0')}` : String(raw ?? '');
};

const today = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const formatDate = (iso: string) => {
  if (!iso) return '';
  const datePart = iso.split('T')[0];
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const parseDmyToIso = (dmy: string): string | null => {
  if (!dmy) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dmy)) return dmy;
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const extractError = (e: unknown, fallback: string): string => {
  const err = e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
  if (err?.response?.data?.errors) {
    const first = Object.values(err.response.data.errors)[0];
    if (first?.[0]) return first[0];
  }
  return err?.response?.data?.message || fallback;
};

type MasterOpt = { value: string; label: string; extra?: Record<string, unknown> };

export default function AddProductModal(props: {
  productId?: number | null;
  initialProduct?: any | null;
  supplierOnly?: boolean;
  onClose: () => void;
  onSaved: (productId: number, finalised: boolean) => void;
}) {
  const { productId: initialId, initialProduct, onClose, onSaved } = props;
  const supplierOnly = props.supplierOnly === true;
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const dept = (user?.department || '').trim().toLowerCase();
  const isSalesDept    = dept === 'sales';
  const isPurchaseDept = dept === 'purchase';

  const [step, setStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<Tab>('core');
  const [previousOpen, setPreviousOpen] = useState(false);
  const [productId, setProductId] = useState<number | null>(initialId ?? null);
  const [loadingEdit, setLoadingEdit] = useState<boolean>(!!initialId);
  const [productCodeFromApi, setProductCodeFromApi] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (k: string) => {
    setFieldErrors(prev => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };
  const PRODUCT_NAME_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%]/g;
  const handleProductNameChange = (
    raw: string,
    fieldKey: 'name' | 'genericName',
    setter: (v: string) => void,
  ) => {
    const cleaned = raw.replace(PRODUCT_NAME_INVALID_RE, '');
    setter(cleaned);
    if (cleaned !== raw) {
      setFieldErrors(prev => ({
        ...prev,
        [fieldKey]: "Special characters are not allowed. Use letters, numbers, spaces, and . , - ( ) & / ' % only",
      }));
    } else {
      clearFieldError(fieldKey);
    }
  };

  const HAS_ANGLE_BRACKET_RE = /[<>]/;
  const SQL_INJECTION_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i;
  const handleDescriptionChange = (raw: string) => {
    let cleaned = raw;
    const issues: string[] = [];
    if (HAS_ANGLE_BRACKET_RE.test(cleaned)) {
      cleaned = cleaned.replace(/[<>]/g, '');
      issues.push('HTML-like syntax (<, >) is not allowed');
    }
    if (SQL_INJECTION_RE.test(cleaned)) {
      cleaned = cleaned.replace(/(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi, '');
      issues.push('Suspicious SQL-like patterns are not allowed');
    }
    setDescription(cleaned);
    if (issues.length) {
      setFieldErrors(prev => ({ ...prev, description: issues.join('; ') }));
    } else {
      clearFieldError('description');
    }
  };
  const CONFIDENTIAL_MAX = 2000;
  const handleConfidentialChange = (raw: string) => {
    let cleaned = raw.replace(/[<>]/g, '');
    cleaned = cleaned.replace(/(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi, '');
    if (cleaned.length > CONFIDENTIAL_MAX) cleaned = cleaned.slice(0, CONFIDENTIAL_MAX);
    setConfidential(cleaned);
  };

  type MasterSlug = 'segments' | 'haz_class' | 'uom' | 'hsn_codes' | 'conditions' | 'packaging_material' | 'gst_percentage';
  const [quickAdd, setQuickAdd] = useState<MasterSlug | null>(null);

  const [optSegments, setOptSegments] = useState<MasterOpt[]>([]);
  const [optHazClasses, setOptHazClasses] = useState<MasterOpt[]>([]);
  const [optUoms, setOptUoms] = useState<MasterOpt[]>([]);
  const [optHsn, setOptHsn] = useState<MasterOpt[]>([]);
  const [optConditions, setOptConditions] = useState<MasterOpt[]>([]);
  const [optPackaging, setOptPackaging] = useState<MasterOpt[]>([]);
  const [optGst, setOptGst] = useState<MasterOpt[]>([]);
  const [mastersLoading, setMastersLoading] = useState<boolean>(true);

  const [name, setName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [hazType, setHazType] = useState('');
  const [hazClassId, setHazClassId] = useState('');
  const [uomId, setUomId] = useState('');
  const [hsnId, setHsnId] = useState('');
  const [conditionId, setConditionId] = useState('');
  const [packagingMaterialId, setPackagingMaterialId] = useState('');
  const [confidential, setConfidential] = useState('');
  const [primaryImagePath, setPrimaryImagePath] = useState<string | null>(null);
  const [primaryImageFile, setPrimaryImageFile] = useState<File | null>(null);
  const [secondaryImagePaths, setSecondaryImagePaths] = useState<string[]>([]);
  const [secondaryImageFiles, setSecondaryImageFiles] = useState<File[]>([]);
  const [primaryImageUrl, setPrimaryImageUrl]     = useState<string | null>(null);
  const [secondaryImageUrls, setSecondaryImageUrls] = useState<string[]>([]);
  const [prodAttachmentFile, setProdAttachmentFile] = useState<File | null>(null);
  const [prodAttachmentPath, setProdAttachmentPath] = useState<string | null>(null);
  const [prodAttachmentUrl,  setProdAttachmentUrl]  = useState<string | null>(null);

  const primaryPreview = primaryImageFile
    ? URL.createObjectURL(primaryImageFile)
    : (primaryImageUrl || (primaryImagePath ? resolveFileUrl(primaryImagePath) : ''));
  const secondaryPreviews = [
    ...secondaryImagePaths.map((p, i) => secondaryImageUrls[i] || resolveFileUrl(p)),
    ...secondaryImageFiles.map(f => URL.createObjectURL(f)),
  ];
  const attachmentPreview = prodAttachmentFile
    ? URL.createObjectURL(prodAttachmentFile)
    : (prodAttachmentUrl || (prodAttachmentPath ? resolveFileUrl(prodAttachmentPath) : ''));
  const attachmentName = (() => {
    if (prodAttachmentFile) return prodAttachmentFile.name;
    const src = prodAttachmentPath || prodAttachmentUrl || '';
    if (!src) return '';
    const last = src.split('/').pop() ?? '';
    const sep = last.indexOf('__');
    return sep >= 0 ? last.slice(sep + 2) : last;
  })();

  const [basePrice, setBasePrice] = useState<string>('');
  const [gstId, setGstId] = useState<string>('');
  const [markBottom, setMarkBottom] = useState('');

  const basePriceNum = parseFloat(basePrice) || 0;
  const gstRow = useMemo(() => optGst.find(o => o.value === gstId), [optGst, gstId]);
  const gstPctNum = useMemo(
    () => parseFloat(String(gstRow?.extra?.percentage ?? '0')) || 0,
    [gstRow],
  );
  const optGstSorted = useMemo(() => {
    const pct = (o: MasterOpt) => {
      const n = parseFloat(String(o.extra?.percentage ?? o.label));
      return Number.isFinite(n) ? n : 0;
    };
    return [...optGst].sort((a, b) => pct(a) - pct(b));
  }, [optGst]);
  const gstPctStr = gstRow ? `${gstPctNum.toFixed(2)}%` : '';
  const canMapSupplier = !!gstId;
  const gstAmt    = +(basePriceNum * (gstPctNum / 100)).toFixed(2);
  const totalPrice = +(basePriceNum + gstAmt).toFixed(2);

  const [netWeight,   setNetWeight]   = useState<string>('');
  const [grossWeight, setGrossWeight] = useState<string>('');
  const [length,      setLength]      = useState<string>('');
  const [width,       setWidth]       = useState<string>('');
  const [height,      setHeight]      = useState<string>('');
  const [batchNo,  setBatchNo]  = useState<string>('');
  const [serialNo, setSerialNo] = useState<string>('');
  const [catNo,    setCatNo]    = useState<string>('');
  const [lotNo,    setLotNo]    = useState<string>('');
  const [qcRecords,   setQcRecords]   = useState<QcRecord[]>([]);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcDraft, setQcDraft] = useState<Omit<QcRecord, 'id'>>({
    name: '', purpose: '', issuedBy: '',
    testingParameter: '', minAcceptance: '', attachmentName: '',
  });

  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; expiry?:string|null; requirement:'M'|'O' };
  const [segmentQcDocs, setSegmentQcDocs] = useState<SegDocRow[]>([]);
  type SegRefUpload = { file: File | null; url: string; name: string };
  const [qcRefUploads, setQcRefUploads] = useState<Record<string, SegRefUpload>>({});

  const [bundledQcUploads, setBundledQcUploads] = useState<any[] | null>(null);
  const persistQcRefUpload = async (refKey: string, file: File, docName: string) => {
    if (!productId) {
      toast.error('Save first', 'Save the product before attaching QC documents.');
      return;
    }
    const [, doc_code] = refKey.split('::');
    if (!doc_code) return;
    const fd = new FormData();
    fd.append('category', 'qc');
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/product/${productId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data;
      if (row?.attachment_url) {
        setQcRefUploads(prev => {
          const existing = prev[refKey];
          if (existing?.url && existing.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(existing.url); } catch {}
          }
          return {
            ...prev,
            [refKey]: { file: null, url: row.attachment_url, name: row.attachment_name || file.name },
          };
        });
      }
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message ?? 'Could not save the QC document.');
    }
  };
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [vendorDraftOpen, setVendorDraftOpen] = useState(false);
  const [supplierPopupOpen, setSupplierPopupOpen] = useState(false);
  const [segGatePending, setSegGatePending] = useState('');
  const [segChecking, setSegChecking] = useState(false);
  const [gstMapOpen, setGstMapOpen] = useState(false);
  const [gstMapValue, setGstMapValue] = useState('');
  const [gstMasterOpen, setGstMasterOpen] = useState(false);
  const [newGstRate, setNewGstRate] = useState('');
  const [gstBusy, setGstBusy] = useState(false);
  const [vendorOpts, setVendorOpts] = useState<VendorOpt[]>([]);
  const [vendorSelectedCode, setVendorSelectedCode] = useState('');
  const [vendorPurchasePrice, setVendorPurchasePrice] = useState<string>('');
  const [vendorRemarks, setVendorRemarks] = useState('');
  const [vendorEditingId, setVendorEditingId] = useState<string | null>(null);

  const vendorSelected = useMemo(
    () => vendorOpts.find(v => v.code === vendorSelectedCode) || null,
    [vendorOpts, vendorSelectedCode]
  );
  const vendorPp   = parseFloat(vendorPurchasePrice) || 0;
  const vendorGp   = gstPctNum;
  const vendorGsta = +(vendorPp * (vendorGp / 100)).toFixed(2);
  const vendorTota = +(vendorPp + vendorGsta).toFixed(2);

  const productCode = productCodeFromApi || (name ? 'P-NEW' : '');
  const headerProductCode = formatProductCode(productCodeFromApi);

  const labelOf = (opts: MasterOpt[], id: string, fallback = '—') =>
    opts.find(o => o.value === id)?.label || fallback;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.jfif', '.jpe', '.pjpeg'];
  const ALLOWED_IMAGE_MIMES = /^image\/(png|jpeg|pjpeg)$/i;
  const validateFileSize = (file: File): boolean => {
    if (file.size <= MAX_IMAGE_BYTES) return true;
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    toast.error('File too large', `${file.name} is ${mb} MB — each file must be 2 MB or smaller.`);
    return false;
  };
  const validateImageFile = (file: File): boolean => {
    const lowerName = file.name.toLowerCase();
    const okExt  = ALLOWED_IMAGE_EXTS.some(ext => lowerName.endsWith(ext));
    const okMime = !!file.type && ALLOWED_IMAGE_MIMES.test(file.type);
    if (!okExt && !okMime) {
      toast.error('Unsupported file type', `${file.name} — only PNG or JPG images are allowed.`);
      return false;
    }
    return validateFileSize(file);
  };
  const ALLOWED_ATTACH_EXTS = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const ALLOWED_ATTACH_MIMES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(png|jpe?g|gif|webp))$/;
  const validateAttachmentFile = (file: File): boolean => {
    const lowerName = file.name.toLowerCase();
    const okExt  = ALLOWED_ATTACH_EXTS.some(ext => lowerName.endsWith(ext));
    const okMime = !!file.type && ALLOWED_ATTACH_MIMES.test(file.type);
    if (!okExt && !okMime) {
      toast.error('Unsupported file type', `${file.name} — only PDF, Word or image files are allowed.`);
      return false;
    }
    return validateFileSize(file);
  };

  const onPrimaryUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!validateImageFile(f)) { e.target.value = ''; return; }
    setPrimaryImageFile(f);
    setPrimaryImagePath(null);
    setPrimaryImageUrl(null);
  };

  const onSecondaryUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(validateImageFile);
    e.target.value = '';
    if (files.length) setSecondaryImageFiles(prev => [...prev, ...files]);
  };
  const removeSecondary = (i: number) => {
    if (i < secondaryImagePaths.length) {
      setSecondaryImagePaths(prev => prev.filter((_, idx) => idx !== i));
      setSecondaryImageUrls(prev => prev.filter((_, idx) => idx !== i));
    } else {
      const fi = i - secondaryImagePaths.length;
      setSecondaryImageFiles(prev => prev.filter((_, idx) => idx !== fi));
    }
  };

  const clearPrimary = () => {
    setPrimaryImageFile(null);
    setPrimaryImagePath(null);
    setPrimaryImageUrl(null);
  };

  const onAttachmentUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!validateAttachmentFile(f)) { e.target.value = ''; return; }
    setProdAttachmentFile(f);
    setProdAttachmentPath(null);
    setProdAttachmentUrl(null);
  };
  const clearAttachment = () => {
    setProdAttachmentFile(null);
    setProdAttachmentPath(null);
    setProdAttachmentUrl(null);
  };

  const openQcModal = () => {
    setQcDraft({ name: '', purpose: '', issuedBy: '', testingParameter: '', minAcceptance: '', attachmentName: '' });
    setQcEditingId(null);
    setQcModalOpen(true);
  };
  const saveQcDraft = () => {
    const missing: string[] = [];
    if (!qcDraft.name)     missing.push('QC Name');
    if (!qcDraft.purpose)  missing.push('QC Purpose');
    if (!qcDraft.issuedBy) missing.push('Issued By');
    if (missing.length) {
      toast.error('Missing required fields', `Please fill: ${missing.join(', ')}`);
      return;
    }
    if (qcEditingId !== null) {
      setQcRecords(prev => prev.map(q => q.id === qcEditingId ? { ...q, ...qcDraft } : q));
      toast.success('QC updated', `${qcDraft.name} updated`);
    } else {
      setQcRecords(prev => [...prev, { id: Date.now(), ...qcDraft }]);
      toast.success('QC added', `${qcDraft.name} added to the QC list`);
    }
    setQcEditingId(null);
    setQcModalOpen(false);
  };
  const removeQc = (id: number) =>
    setQcRecords(prev => prev.filter(q => q.id !== id));
 const [qcDeleteTarget, setQcDeleteTarget] = useState<QcRecord | null>(null);
 const [qcEditingId, setQcEditingId] = useState<number | null>(null);

  const openQcViewer = (q: QcRecord) => {
    if (q.attachmentUrl) viewFile(q.attachmentUrl);
    else toast.info('No attachment', `${q.name} has no file uploaded`);
  };
  const openQcEdit = (q: QcRecord) => {
    setQcDraft({
      name: q.name, purpose: q.purpose, issuedBy: q.issuedBy,
      testingParameter: q.testingParameter, minAcceptance: q.minAcceptance,
      attachmentName: q.attachmentName, attachmentUrl: q.attachmentUrl,
    });
    setQcEditingId(q.id);
    setQcModalOpen(true);
  };
 const QcActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        className="btn p-0 d-inline-flex align-items-center justify-content-center"
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'var(--vz-secondary-bg)',
          border: '1px solid var(--vz-border-color)',
          color: 'var(--vz-secondary-color)',
          transition: 'all .15s ease',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = `var(--vz-${color}-bg-subtle, ${color === 'primary' ? '#40518918' : color === 'danger' ? '#f0654818' : color === 'success' ? '#0ab39c18' : color === 'info' ? '#299cdb18' : color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)'})`;
          el.style.borderColor = `var(--vz-${color})`;
          el.style.color = `var(--vz-${color})`;
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = 'var(--vz-secondary-bg)';
          el.style.borderColor = 'var(--vz-border-color)';
          el.style.color = 'var(--vz-secondary-color)';
        }}
        onClick={onClick}
      >
        <i className={`${icon} fs-14`} />
      </button>
    </Tooltip>
  );
 const REMARKS_MIN = 3;
  const REMARKS_MAX = 250;
  const vendorRemarksError = (val: string): string | undefined => {
    const t = val.trim();
    if (t.length === 0)          return undefined;
    if (t.length < REMARKS_MIN)  return `Remarks must be at least ${REMARKS_MIN} characters`;
    if (val.length > REMARKS_MAX) return `Remarks must be ${REMARKS_MAX} characters or fewer`;
    return undefined;
  };

  const persistsImmediately = initialId != null;

  const commitVendorList = async (newList: VendorEntry[], successTitle: string, successMsg: string): Promise<boolean> => {
    const prevList = vendors;
    setVendors(newList);
    if (persistsImmediately && !(await autoPersistVendors(newList))) {
      setVendors(prevList);
      return false;
    }
    toast.success(successTitle, successMsg);
    return true;
  };

  const removeVendor = async (v: VendorEntry) => {
    if (vendors.length <= 1) {
      toast.info('Cannot remove', 'A product must keep at least one mapped supplier. Add another supplier first, or remove the product.');
      return;
    }
    const ok = await confirm({
      title: 'Remove mapped supplier?',
      message: `“${v.vendorName}” will be unmapped from this product.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (vendorEditingId === v.id) setVendorEditingId(null);
    await commitVendorList(vendors.filter(row => row.id !== v.id), 'Supplier removed', `${v.vendorName} unmapped from this product`);
  };

  const requestSegmentChange = async (v: string) => {
    if (v === segmentId || segChecking) return;

    if (productId) {
      setSegChecking(true);
      let usage: {
        in_po_or_spi?: boolean;
        latest_po_code?: string | null;
        latest_spi_code?: string | null;
        blocking_leads?: [
          { opp_code: string; lead_id: number; product_id: number; }
        ];
      } = {};
      try {
        usage = (await api.get(`/products/${productId}/usage`)).data?.data ?? {};
      } catch {
       
        toast.error('Could not verify', 'Please try again.');
        setSegChecking(false);
        return;
      }
      setSegChecking(false);

      if (usage.in_po_or_spi) {
        const used = [usage.latest_po_code, usage.latest_spi_code].filter(Boolean);
        toast.error('Segment locked', `This product is used in ${used.join(' and ')}.`);
        return;
      }
      if (usage.blocking_leads?.length) {
        toast.error('Segment locked', `Remove it from the product directory first ${usage.blocking_leads[0].opp_code}.`);
        return;
      }
    }

    if (vendors.length > 0) {
      setSegGatePending(v);
      return;
    }
    setSegmentId(v);
    clearFieldError('segmentId');
  };

  const applyPendingSegment = (pending: string) => {
    setSegmentId(pending);
    clearFieldError('segmentId');
    setSegGatePending('');
    toast.success('Segment changed', 'Save this step to persist it.');
  };

  const unmapForSegmentChange = async (v: VendorEntry) => {
    const pending = segGatePending;
    const ok = await confirm({
      title: 'Unmap supplier to change segment?',
      message: persistsImmediately
        ? `“${v.vendorName}” will be unmapped now. The segment change still needs Save & Next.`
        : `“${v.vendorName}” will be removed from the list.`,
      confirmLabel: 'Unmap',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (vendorEditingId === v.id) setVendorEditingId(null);
    const next = vendors.filter(row => row.id !== v.id);
    if (!(await commitVendorList(next, 'Supplier unmapped', `${v.vendorName} unmapped from this product`))) return;
    if (next.length === 0) applyPendingSegment(pending);
  };

  const saveVendorDraft = async () => {
    if (!canMapSupplier) {
      toast.error('GST rate required', 'Select a GST rate for this product (Sales Config step) before you can map a supplier — 0% is allowed.');
      return;
    }
    const missing: string[] = [];
    if (!vendorSelected)        missing.push('Vendor');
    if (String(vendorPurchasePrice ?? '').trim() === '') missing.push('Purchase Price');
    if (missing.length) {
      toast.error('Missing required fields', `Please fill: ${missing.join(', ')}`);
      return;
    }
    if (!vendorSelected) return;
    if (!(vendorPp >= 1)) {
      toast.error('Invalid Purchase Price', 'Purchase Price must be 1 or greater.');
      return;
    }

    const remarksErr = vendorRemarksError(vendorRemarks);
    if (remarksErr) {
      toast.error('Invalid remarks', remarksErr);
      return;
    }

    const selId   = String(vendorSelected.id);
    const selCode = String(vendorSelected.code ?? '');
    const alreadyMapped = vendors.some(row =>
      row.id !== vendorEditingId &&
      ((row.vendorId && String(row.vendorId) === selId) ||
       (selCode && String(row.vendorCode) === selCode))
    );
    if (alreadyMapped) {
      toast.error('Already mapped', `${vendorSelected.name} is already mapped to this product.`);
      return;
    }

    if (segmentId) {
      const prodSeg = Number(segmentId);
      const vendorSegs = vendorSelected.segmentIds ?? [];
      if (vendorSegs.length > 0 && !vendorSegs.includes(prodSeg)) {
        const segName = labelOf(optSegments, segmentId) || "this product's segment";
        toast.error('Segment mismatch', `${vendorSelected.name} does not deal in "${segName}". Only a supplier in the same segment as the product can be mapped.`);
        return;
      }
    }

    if (vendorEditingId) {
      const newList = vendors.map(row =>
        row.id !== vendorEditingId ? row : {
          ...row,
          vendorId:      vendorSelected.id,
          vendorCode:    vendorSelected.code,
          vendorName:    vendorSelected.name,
          website:       vendorSelected.website,
          contactPerson: vendorSelected.contact,
          contactNo:     vendorSelected.phone,
          email:         vendorSelected.email,
          designation:   vendorSelected.designation,
          purchasePrice: vendorPp,
          gstPct:        vendorGp,
          gstAmt:        vendorGsta,
          totalAmt:      vendorTota,
          remarks:       vendorRemarks,
        }
      );
      if (await commitVendorList(newList, 'Supplier updated', `${vendorSelected.name} mapping updated`)) {
        closeVendorDraft();
      }
      return;
    }

    const entry: VendorEntry = {
      id: String(Date.now()),
      vendorId: vendorSelected.id,
      productCode: productCode || 'P-NEW',
      vendorCode: vendorSelected.code,
      vendorName: vendorSelected.name,
      website: vendorSelected.website,
      contactPerson: vendorSelected.contact,
      contactNo: vendorSelected.phone,
      email: vendorSelected.email,
      designation: vendorSelected.designation,
      attachments: 0,
      purchasePrice: vendorPp,
      gstPct: vendorGp,
      gstAmt: vendorGsta,
      totalAmt: vendorTota,
      mapDate: today(),
      remarks: vendorRemarks,
    };
    const newList = [...vendors, entry];
    if (await commitVendorList(newList, 'Supplier mapped', `${entry.vendorName} added to this product`)) {
      closeVendorDraft();
    }
  };

  const openVendorEdit = (v: VendorEntry) => {
    setVendorEditingId(v.id);
    const opt = vendorOpts.find(o => (v.vendorId && o.id === String(v.vendorId)) || (v.vendorCode && o.code === v.vendorCode));
    setVendorSelectedCode(opt?.code ?? v.vendorCode);
    setVendorPurchasePrice(v.purchasePrice ? String(v.purchasePrice) : '');
    setVendorRemarks(v.remarks ?? '');
    setVendorDraftOpen(true);
  };

  const closeVendorDraft = () => {
    setVendorDraftOpen(false);
    setVendorEditingId(null);
    setVendorSelectedCode('');
    setVendorPurchasePrice('');
    setVendorRemarks('');
  };

  const closeSupplierPopup = () => {
    if (saving) return;
    setSupplierPopupOpen(false);
    if (supplierOnly) onClose();
  };

  const addGstRate = async () => {
    const val = newGstRate.trim();
    const num = Number(val);
    if (!val || isNaN(num) || num < 0 || num > 100) {
      toast.error('Invalid rate', 'Enter a GST % between 0 and 100');
      return;
    }
    if (optGst.some(o => Number(o.extra?.percentage) === num)) {
      toast.error('Duplicate rate', `${num}% already exists`);
      return;
    }
    setGstBusy(true);
    try {
      const res = await api.post<Record<string, unknown>>('/master/gst_percentage', { percentage: num, status: 'Active' });
      onMasterAdded('gst_percentage', res.data);
      setNewGstRate('');
      toast.success('Rate added', `${num}% added to the GST master`);
    } catch (e: unknown) {
      toast.error('Failed', extractError(e, 'Could not add the GST rate.'));
    } finally {
      setGstBusy(false);
    }
  };
  const removeGstRate = async (id: string) => {
    setGstBusy(true);
    try {
      await api.delete(`/master/gst_percentage/${id}`);
      setOptGst(prev => prev.filter(o => o.value !== id));
      if (gstId === id) setGstId('');
      if (gstMapValue === id) setGstMapValue('');
      toast.success('Rate removed', 'GST rate removed from the master');
    } catch (e: unknown) {
      toast.error('Failed', extractError(e, 'Could not remove the GST rate.'));
    } finally {
      setGstBusy(false);
    }
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    type Row = { id: number | string; status?: string | null };
    type Bundle = {
      segments:           Array<Row & { title?: string | null }>;
      haz_class:          Array<Row & { name?: string | null }>;
      uom:                Array<Row & { title?: string | null; short_code?: string | null; unit_type?: string | null }>;
      hsn_codes:          Array<Row & { hsn_code?: string | null; description?: string | null }>;
      conditions:         Array<Row & { title?: string | null }>;
      packaging_material: Array<Row & { title?: string | null }>;
      gst_percentage:     Array<Row & { percentage?: number | string | null }>;
      vendors: Array<{
        id: number | string;
        vendor_code?: string | null;
        company_name?: string | null;
        website?: string | null;
        primary_email?: string | null;
        status?: string | null;
        vendor_type_name?: string | null;
        state?: string | null;
        segment_ids?: Array<number | string> | null;
        primary_address?: {
          contact_name?: string | null;
          contact_no?: string | null;
          email?: string | null;
          designation?: string | null;
        } | null;
      }>;
    };

    const toOpt = <T extends Row>(rows: T[], labelKey: keyof T, extraKeys?: Array<keyof T>): MasterOpt[] =>
      (rows || []).map(r => {
        const extra: Record<string, unknown> = {};
        extraKeys?.forEach(k => { extra[k as string] = r[k]; });
        return { value: String(r.id), label: String(r[labelKey] ?? ''), extra };
      });

    const hydrate = (b: Bundle) => {
      setOptSegments(toOpt(b.segments,                            'title'));
      setOptHazClasses(toOpt(b.haz_class,                         'name'));
      setOptUoms(
        toOpt(b.uom, 'title', ['short_code', 'unit_type'])
          .map(o => ({ ...o, label: o.label + (o.extra?.short_code ? ` (${o.extra.short_code})` : '') }))
      );
      setOptHsn(
        toOpt(b.hsn_codes, 'hsn_code', ['description'])
          .map(o => ({ ...o, label: o.label + (o.extra?.description ? ` — ${String(o.extra.description).slice(0, 40)}` : '') }))
      );
      setOptConditions(toOpt(b.conditions,                        'title'));
      setOptPackaging(toOpt(b.packaging_material,                 'title'));
      setOptGst(
        toOpt(b.gst_percentage, 'percentage', ['percentage'])
          .map(o => {
            const n = parseFloat(o.label);
            const clean = Number.isFinite(n) ? String(Number(n.toFixed(2))) : o.label;
            return { ...o, label: `${clean}%` };
          })
      );
      setVendorOpts((b.vendors || []).map(r => ({
        id:          String(r.id),
        code:        String(r.vendor_code ?? ''),
        name:        String(r.company_name ?? ''),
        website:     String(r.website ?? ''),
        contact:     String(r.primary_address?.contact_name ?? ''),
        phone:       String(r.primary_address?.contact_no ?? ''),
        email:       String(r.primary_address?.email ?? r.primary_email ?? ''),
        designation: String(r.primary_address?.designation ?? ''),
        status:      String(r.status ?? '').toLowerCase(),
        type:        String(r.vendor_type_name ?? ''),
        state:       String(r.state ?? ''),
        segmentIds:  Array.isArray(r.segment_ids) ? r.segment_ids.map(Number).filter(Number.isFinite) : [],
      })));
    };

    const cached = readProductMasterBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setMastersLoading(false);
    }

    (async () => {
      try {
        const res = await api.get<Bundle>('/products/master-bundle');
        hydrate(res.data);
        writeProductMasterBundle(res.data);
      } catch {
      } finally {
        setMastersLoading(false);
      }
    })();
  }, []);

  const qcDirtyRef = useRef(false);
  useEffect(() => {
    if (!qcDirtyRef.current) {
      qcDirtyRef.current = true;
      return;
    }
    setQcRefUploads(prev => {
      Object.values(prev).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
      return {};
    });
  }, [segmentId]);

  useEffect(() => {
    if (tab !== 'quality') return;
    if (!segmentId) { setSegmentQcDocs([]); return; }
    const id = Number(segmentId);
    if (!Number.isFinite(id) || id <= 0) { setSegmentQcDocs([]); return; }

    let cancelled = false;
    api.get(`/clm/segment-rules/for-segment/${id}`)
      .then(r => {
        if (cancelled) return;
        const data = r.data?.data ?? {};
        setSegmentQcDocs(Array.isArray(data.qc) ? data.qc : []);
      })
      .catch(() => { if (!cancelled) setSegmentQcDocs([]); });
    return () => { cancelled = true; };
  }, [tab, segmentId]);

  useEffect(() => {
    if (!bundledQcUploads || bundledQcUploads.length === 0) return;
    const hydrated: Record<string, SegRefUpload> = {};
    for (const u of bundledQcUploads) {
      if (u.category !== 'qc' || !u.doc_code) continue;
      hydrated[`qc::${u.doc_code}`] = {
        file: null,
        url:  u.attachment_url || '',
        name: u.attachment_name || '',
      };
    }
    if (Object.keys(hydrated).length > 0) setQcRefUploads(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundledQcUploads]);

  const onMasterAdded = (slug: MasterSlug, row: Record<string, unknown>) => {
    const id = String(row.id ?? '');
    if (!id) return;
    bustAllMasterBundles();
    const labelOf = (key: string) => String(row[key] ?? '');
    switch (slug) {
      case 'segments':
        setOptSegments(prev => [...prev, { value: id, label: labelOf('title') }]);
        void requestSegmentChange(id);
        break;
      case 'haz_class':
        setOptHazClasses(prev => [...prev, { value: id, label: labelOf('name') }]);
        setHazClassId(id);
        clearFieldError('hazClassId');
        break;
      case 'uom': {
        const short = labelOf('short_code');
        const title = labelOf('title');
        setOptUoms(prev => [...prev, { value: id, label: title + (short ? ` (${short})` : '') }]);
        setUomId(id);
        clearFieldError('uomId');
        break;
      }
      case 'hsn_codes': {
        const code = labelOf('hsn_code');
        const desc = labelOf('description');
        setOptHsn(prev => [...prev, { value: id, label: code + (desc ? ` — ${desc.slice(0, 40)}` : '') }]);
        setHsnId(id);
        clearFieldError('hsnId');
        break;
      }
      case 'conditions':
        setOptConditions(prev => [...prev, { value: id, label: labelOf('title') }]);
        setConditionId(id);
        clearFieldError('conditionId');
        break;
      case 'packaging_material':
        setOptPackaging(prev => [...prev, { value: id, label: labelOf('title') }]);
        setPackagingMaterialId(id);
        clearFieldError('packagingMaterialId');
        break;
      case 'gst_percentage': {
        const raw = labelOf('percentage');
        const n = parseFloat(raw);
        const clean = Number.isFinite(n) ? String(Number(n.toFixed(2))) : raw;
        setOptGst(prev => [...prev, { value: id, label: `${clean}%`, extra: { percentage: row.percentage } }]);
      }
        setGstId(id);
        clearFieldError('gstId');
        break;
    }
  };

  useEffect(() => {
    if (!initialId) return;
    (async () => {
      try {
        type ProductDto = {
          id: number; product_code?: string;
          name?: string; generic_name?: string; description?: string; brand?: string;
          segment_id?: number; haz_type?: string; haz_class_id?: number;
          uom_id?: number; hsn_id?: number; condition_id?: number;
          packaging_material_id?: number; confidential_info?: string;
          primary_image?: string | null; secondary_images?: string[] | null;
          primary_image_url?: string | null; secondary_images_url?: string[] | null;
          product_attachment?: string | null; product_attachment_url?: string | null;
          base_price?: string | number; gst_id?: number; mark_bottom?: string;
          net_weight?: string | number; gross_weight?: string | number;
          length_cm?: string | number; width_cm?: string | number; height_cm?: string | number;
          step_completed?: number;
          qc_records?: Array<{ id: number; qc_name: string; qc_purpose?: string; issued_by?: string; qa_testing_parameter?: string; min_acceptance_criteria?: string; attachment_path?: string; attachment_url?: string | null }>;
          vendor_maps?: Array<Record<string, unknown>>;
          segment_uploads?: { data?: any[] };
        };
        const p: ProductDto = initialProduct
          ? (initialProduct as ProductDto)
          : (await api.get<ProductDto>(`/products/${initialId}`)).data;
        setBundledQcUploads(Array.isArray(p.segment_uploads?.data) ? p.segment_uploads!.data! : []);
        setProductId(p.id);
        setProductCodeFromApi(p.product_code ?? '');
        setName(p.name ?? '');
        setGenericName(p.generic_name ?? '');
        setDescription(p.description ?? '');
        setBrand(p.brand ?? '');
        setSegmentId(p.segment_id ? String(p.segment_id) : '');
        setHazType(p.haz_type ?? '');
        setHazClassId(p.haz_class_id ? String(p.haz_class_id) : '');
        setUomId(p.uom_id ? String(p.uom_id) : '');
        setHsnId(p.hsn_id ? String(p.hsn_id) : '');
        setConditionId(p.condition_id ? String(p.condition_id) : '');
        setPackagingMaterialId(p.packaging_material_id ? String(p.packaging_material_id) : '');
        setConfidential(p.confidential_info ?? '');
        setPrimaryImagePath(p.primary_image ?? null);
        setPrimaryImageUrl(p.primary_image_url ?? (p.primary_image ? resolveFileUrl(p.primary_image) : null));
        setPrimaryImageFile(null);
        setSecondaryImagePaths(p.secondary_images ?? []);
        setSecondaryImageUrls(p.secondary_images_url ?? (p.secondary_images ?? []).map(s => resolveFileUrl(s)));
        setSecondaryImageFiles([]);
        setProdAttachmentPath(p.product_attachment ?? null);
        setProdAttachmentUrl(p.product_attachment_url ?? (p.product_attachment ? resolveFileUrl(p.product_attachment) : null));
        setProdAttachmentFile(null);
        setBasePrice(p.base_price != null ? String(p.base_price) : '');
        setGstId(p.gst_id ? String(p.gst_id) : '');
        setMarkBottom(p.mark_bottom ?? '');
        setNetWeight(p.net_weight != null ? String(p.net_weight) : '');
        setGrossWeight(p.gross_weight != null ? String(p.gross_weight) : '');
        setLength(p.length_cm != null ? String(p.length_cm) : '');
        setWidth(p.width_cm != null ? String(p.width_cm) : '');
        setHeight(p.height_cm != null ? String(p.height_cm) : '');
        setBatchNo (((p as Record<string, unknown>).batch_no  ?? '') as string);
        setSerialNo(((p as Record<string, unknown>).serial_no ?? '') as string);
        setCatNo   (((p as Record<string, unknown>).cat_no    ?? '') as string);
        setLotNo   (((p as Record<string, unknown>).lot_no    ?? '') as string);
        setQcRecords((p.qc_records ?? []).map(q => ({
          id: q.id,
          name: q.qc_name,
          purpose: q.qc_purpose ?? '',
          issuedBy: q.issued_by ?? '',
          testingParameter: q.qa_testing_parameter ?? '',
          minAcceptance: q.min_acceptance_criteria ?? '',
          attachmentName: q.attachment_path
            ? (() => {
                const last = q.attachment_path.split('/').pop() ?? '';
                const sep = last.indexOf('__');
                return sep >= 0 ? last.slice(sep + 2) : last;
              })()
            : '',
          attachmentUrl: q.attachment_url ?? (q.attachment_path ? resolveFileUrl(q.attachment_path) : ''),
          attachmentPath: q.attachment_path ?? '',
          attachmentFile: null,
        })));
        setVendors((p.vendor_maps ?? []).map(v => ({
          id: String(v.id),
          vendorId: (v as Record<string, unknown>).vendor_id ? String((v as Record<string, unknown>).vendor_id) : '',
          productCode: p.product_code ?? '',
          vendorCode: String(
            (v.vendor as { vendor_code?: string | null } | null | undefined)?.vendor_code
            ?? v.vendor_code
            ?? ''
          ),
          vendorName: String(v.vendor_name ?? ''),
          website: String(v.vendor_website ?? ''),
          contactPerson: String(v.contact_person ?? ''),
          contactNo: String(v.contact_no ?? ''),
          email: String(v.email ?? ''),
          designation: String(v.designation ?? ''),
          attachments: 0,
          purchasePrice: Number(v.purchase_price ?? 0),
          gstPct: Number(v.gst_percentage ?? 0),
          gstAmt: Number(v.gst_amount ?? 0),
          totalAmt: Number(v.total_amount ?? 0),
          mapDate: v.map_date ? formatDate(String(v.map_date)) : '',
          remarks: String(v.remarks ?? ''),
        })));
      } catch {
        toast.error('Not found', 'Failed to load product. Closing…');
        setTimeout(onClose, 1200);
      } finally {
        setLoadingEdit(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  const saveCore = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim())            errs.name              = 'Product name is required';
    if (!genericName.trim())     errs.genericName       = 'Generic name is required';
    if (!description.trim())     errs.description       = 'Printable description is required';
    else if (HAS_ANGLE_BRACKET_RE.test(description)) errs.description = 'HTML-like syntax (<, >) is not allowed';
    else if (SQL_INJECTION_RE.test(description))     errs.description = 'Suspicious SQL-like patterns are not allowed';
    if (!brand.trim())           errs.brand             = 'Make / Brand / Specifications is required';
    if (!segmentId)              errs.segmentId         = 'Segment is required';
    if (!hazType)                errs.hazType           = 'Haz / Non-Haz is required';
    if (hazType === 'Haz' && !hazClassId) errs.hazClassId = 'Haz Class is required when Haz Type is Haz';
    if (!uomId)                  errs.uomId             = 'UOM is required';
    if (!hsnId)                  errs.hsnId             = 'HSN / SAC Code is required';
    if (!conditionId)            errs.conditionId       = 'Condition is required';
    if (!packagingMaterialId)    errs.packagingMaterialId = 'Packaging Material is required';
    const hasPrimary = !!primaryImageFile || !!primaryImagePath;
    const hasSecondary = secondaryImageFiles.length > 0 || secondaryImagePaths.length > 0;
    if (!hasPrimary)   errs.primaryImage   = 'Primary image is required';
    if (!hasSecondary) errs.secondaryImage = 'At least one secondary image is required';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setFieldErrors({});
    if (!productId && !isPurchaseDept) {
      if (!gstId) toast.info('GST is mandatory', 'Please select a GST rate from the GST Master before proceeding to Stage 2.');
      setGstMapValue(gstId);
      setGstMasterOpen(false);
      setGstMapOpen(true);
      return;
    }
    await commitCore();
  };

  const commitCore = async (gstToCommit?: string): Promise<boolean> => {
    setSaving(true);
    try {
      const fd = new FormData();
      const put = (k: string, v: unknown) => {
        if (v === null || v === undefined) return;
        fd.append(k, typeof v === 'string' ? v : String(v));
      };
      if (productId) put('id', productId);
      put('name', name);
      put('generic_name', genericName);
      put('description', description);
      put('brand', brand);
      put('segment_id', segmentId ? Number(segmentId) : null);
      put('haz_type', hazType || null);
      put('haz_class_id', hazClassId ? Number(hazClassId) : null);
      put('uom_id', uomId ? Number(uomId) : null);
      put('hsn_id', hsnId ? Number(hsnId) : null);
      put('condition_id', conditionId ? Number(conditionId) : null);
      put('packaging_material_id', packagingMaterialId ? Number(packagingMaterialId) : null);
      put('confidential_info', confidential);
      if (gstToCommit) put('gst_id', Number(gstToCommit));

      fd.append('primary_image', primaryImagePath ?? '');
      if (primaryImageFile) fd.append('primary_image_file', primaryImageFile);

      fd.append('secondary_images_replace', '1');
      secondaryImagePaths.forEach(p => fd.append('secondary_images[]', p));
      secondaryImageFiles.forEach(f => fd.append('secondary_image_files[]', f));

      fd.append('product_attachment', prodAttachmentPath ?? '');
      if (prodAttachmentFile) fd.append('product_attachment_file', prodAttachmentFile);

      const res = await api.post<{
        id: number; product_code?: string;
        primary_image?: string | null; secondary_images?: string[] | null;
        primary_image_url?: string | null; secondary_images_url?: string[] | null;
        product_attachment?: string | null; product_attachment_url?: string | null;
        step_completed?: number;
      }>(
        '/products/step/core',
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      setProductId(res.data.id);
      setProductCodeFromApi(res.data.product_code ?? '');
      setPrimaryImagePath(res.data.primary_image ?? null);
      setPrimaryImageUrl(res.data.primary_image_url ?? (res.data.primary_image ? resolveFileUrl(res.data.primary_image) : null));
      setPrimaryImageFile(null);
      setSecondaryImagePaths(res.data.secondary_images ?? []);
      setSecondaryImageUrls(res.data.secondary_images_url ?? (res.data.secondary_images ?? []).map(s => resolveFileUrl(s)));
      setSecondaryImageFiles([]);
      setProdAttachmentPath(res.data.product_attachment ?? null);
      setProdAttachmentUrl(res.data.product_attachment_url ?? (res.data.product_attachment ? resolveFileUrl(res.data.product_attachment) : null));
      setProdAttachmentFile(null);

      if (isPurchaseDept) {
        onSaved(res.data.id, true);
        toast.success('Product saved', 'Product created successfully');
        return true;
      }
      onSaved(res.data.id, false);
      if (!gstToCommit) toast.success('Core saved', 'Product Core Information saved');
      setTab('sales');
      return true;
    } catch (e: unknown) {
      const msg = extractError(e, 'Failed to save Core information.');
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openGstMap = () => {
    if (!productId) {
      toast.error('Complete Core Information first', 'Save Product Core Information (Save & Next) before mapping a GST %.');
      return;
    }
    setGstMapValue(gstId);
    setGstMasterOpen(false);
    setGstMapOpen(true);
  };

  const closeGstMap = () => {
    setGstMapOpen(false);
    if (!productId) {
      toast.info('GST % required', 'Map a GST % to add this product. Your details are kept — nothing is saved until GST is mapped.');
    }
  };

  const saveSales = async () => {
    if (!productId) {
      toast.error('Step blocked', 'Save Core information first.'); return;
    }
    const errs: Record<string, string> = {};
    if (!basePrice || basePriceNum <= 0) errs.basePrice  = 'Selling Price is required (must be greater than 0)';
    if (!gstId)                          errs.gstId      = 'GST is mandatory. Please select a valid GST rate from the GST Master.';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      if (errs.gstId && !errs.basePrice) {
        toast.error('GST is mandatory', 'Product cannot be saved because the GST field is mandatory. Please select a GST rate from the GST Master.');
      } else {
        toast.error('Missing required fields', 'Please fix the highlighted fields');
      }
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      await api.put(`/products/${productId}/step/sales`, {
        base_price: basePriceNum || null,
        gst_id: gstId ? Number(gstId) : null,
        gst_amount: gstAmt || null,
        total_price: totalPrice || null,
        mark_bottom: markBottom || null,
      });
      onSaved(productId, true);
      toast.success('Product saved', 'Product created successfully');
    } catch (e: unknown) {
      const msg = extractError(e, 'Failed to save Sales information.');
      toast.error('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const saveQuality = async () => {
    if (!productId) {
      toast.error('Step blocked', 'Save Core information first.'); return;
    }
    const errs: Record<string, string> = {};
    const netN   = parseFloat(netWeight)   || 0;
    const grossN = parseFloat(grossWeight) || 0;
    if (!netWeight   || netN   <= 0) errs.netWeight   = 'Net Weight is required (must be greater than 0)';
    if (!grossWeight || grossN <= 0) errs.grossWeight = 'Gross Weight is required (must be greater than 0)';
    if (!length      || parseFloat(length)      <= 0) errs.length      = 'Length is required (must be greater than 0)';
    if (!width       || parseFloat(width)       <= 0) errs.width       = 'Width is required (must be greater than 0)';
    if (!height      || parseFloat(height)      <= 0) errs.height      = 'Height is required (must be greater than 0)';
    if (!errs.netWeight && !errs.grossWeight && grossN <= netN) {
      errs.grossWeight = 'Gross Weight must be greater than Net Weight.';
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    const badQc = qcRecords.findIndex(q => !q.name.trim());
    if (badQc !== -1) {
      toast.error('Invalid QC record', `QC record #${badQc + 1} is missing the QC Name`);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const hasNewFiles = qcRecords.some(q => q.attachmentFile instanceof File);
      const qcRows = qcRecords.map(q => ({
        qc_name: q.name,
        qc_purpose: q.purpose,
        issued_by: q.issuedBy,
        qa_testing_parameter: q.testingParameter,
        min_acceptance_criteria: q.minAcceptance,
        attachment_path: (q.attachmentPath && q.attachmentPath.includes('/'))
          ? q.attachmentPath
          : null,
      }));

      const qualityFields = {
        batch_no: batchNo || null,
        serial_no: serialNo || null,
        cat_no: catNo || null,
        lot_no: lotNo || null,
        net_weight: parseFloat(netWeight) || null,
        gross_weight: parseFloat(grossWeight) || null,
        length_cm: parseFloat(length) || null,
        width_cm: parseFloat(width) || null,
        height_cm: parseFloat(height) || null,
      };

      type QualitySaveResponse = {
        qc_records?: Array<{ id: number; attachment_path?: string | null; attachment_url?: string | null }>;
      };
      let saveRes: { data: QualitySaveResponse };
      if (hasNewFiles) {
        const fd = new FormData();
        fd.append('_method', 'PUT');
        Object.entries(qualityFields).forEach(([k, v]) => {
          if (v === null || v === undefined) return;
          fd.append(k, String(v));
        });
        qcRows.forEach((row, idx) => {
          Object.entries(row).forEach(([k, v]) => {
            if (v === null || v === undefined) return;
            fd.append(`qc_records[${idx}][${k}]`, String(v));
          });
          const file = qcRecords[idx]?.attachmentFile;
          if (file instanceof File) {
            fd.append(`qc_records[${idx}][attachment_file]`, file);
          }
        });
        saveRes = await api.post<QualitySaveResponse>(`/products/${productId}/step/quality`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        saveRes = await api.put<QualitySaveResponse>(`/products/${productId}/step/quality`, {
          ...qualityFields,
          qc_records: qcRows,
        });
      }

      const serverQc = saveRes.data.qc_records ?? [];
      setQcRecords(prev => prev.map((q, idx) => {
        const sv = serverQc[idx];
        if (!sv) return { ...q, attachmentFile: null };
        return {
          ...q,
          attachmentFile: null,
          attachmentPath: sv.attachment_path ?? '',
          attachmentUrl:  sv.attachment_url  ?? q.attachmentUrl ?? '',
        };
      }));

      onSaved(productId, false);
      toast.success('Quality saved', 'Product is now Inactive — map a vendor to activate');
      setStep(2);
    } catch (e: unknown) {
      const msg = extractError(e, 'Failed to save Quality information.');
      toast.error('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const persistVendors = async (list: VendorEntry[]): Promise<boolean> => {
    if (!productId) return false;
    try {
      await api.put(`/products/${productId}/step/vendors`, {
        vendors: list.map(v => ({
          vendor_id: v.vendorId ? Number(v.vendorId) : null,
          vendor_code: v.vendorCode,
          vendor_name: v.vendorName,
          vendor_website: v.website,
          contact_person: v.contactPerson,
          contact_no: v.contactNo,
          email: v.email,
          designation: v.designation,
          purchase_price: v.purchasePrice,
          gst_percentage: v.gstPct,
          gst_amount: v.gstAmt,
          total_amount: v.totalAmt,
          map_date: parseDmyToIso(v.mapDate),
          remarks: v.remarks,
        })),
      });
      return true;
    } catch (e: unknown) {
      toast.error('Save failed', extractError(e, 'Failed to save suppliers.'));
      return false;
    }
  };

  const autoPersistVendors = async (list: VendorEntry[]): Promise<boolean> => {
    if (!productId) return false;
    setSaving(true);
    const ok = await persistVendors(list);
    if (ok) onSaved(productId, false);
    setSaving(false);
    return ok;
  };

  const saveVendorsAndFinish = async () => {
    if (!productId) {
      toast.error('Step blocked', 'Save Core information first.'); return;
    }
    setFieldErrors({});
    setSaving(true);
    const ok = await persistVendors(vendors);
    if (ok) {
      onSaved(productId, true);
      toast.success('Product saved', vendors.length
        ? 'Suppliers mapped — product is now Active'
        : 'Saved with no suppliers — map one to activate the product.');
    }
    setSaving(false);
  };

  const supplierPopupFiredRef = useRef(false);
  useEffect(() => {
    if (supplierOnly && !supplierPopupFiredRef.current && productId && !mastersLoading && !loadingEdit) {
      supplierPopupFiredRef.current = true;
      setSupplierPopupOpen(true);
    }
  }, [supplierOnly, productId, mastersLoading, loadingEdit]);

  return createPortal((
    <div className={`apm-backdrop ${supplierOnly ? 'apm-backdrop-supplieronly' : ''}`}>
      <div className={`apm-modal ${supplierOnly ? 'apm-modal-hidden' : ''}`} onClick={(e) => e.stopPropagation()}>
        {saving && <div className="apm-busy-veil" aria-hidden />}
        <div className="apm-head">
          <div className="apm-head-left">
            <div className="apm-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </div>
            <div>
              <div className="apm-title">
                {step === 2
                  ? 'Map Product Supplier'
                  : (initialId ? 'Edit Product' : 'Add Product')}
                {(initialId != null || step === 2) && headerProductCode && (
                  <span className="apm-title-code">— {headerProductCode}</span>
                )}
              </div>
              <div className="apm-sub">
                {step === 2
                  ? 'Link this product to one or more suppliers with purchase pricing.'
                  : (initialId
                      ? 'Update product details — identity, pricing, compliance and dimensions.'
                      : 'Create products with pricing, compliance, quality controls, and supplier mapping for procurement and sales readiness.')}
              </div>
            </div>
          </div>
          <div className="apm-head-actions">
            <button
              type="button"
              className="apm-head-btn"
              title={productId ? 'Map / manage GST %' : 'Save Product Core Information (Stage 1) before mapping a GST %'}
              disabled={saving || !productId}
              onClick={openGstMap}
            >
              {gstRow ? `GST ${gstPctNum}%` : 'GST (%)'}
            </button>
            {!isSalesDept && (
              <button
                type="button"
                className="apm-head-btn"
                title={productId ? 'Map a supplier to this product' : 'Save Product Core Information (Stage 1) before mapping suppliers'}
                disabled={saving || !productId}
                onClick={() => {
                  if (!productId) {
                    toast.error('Complete Core Information first', 'Save Product Core Information (Save & Next) before mapping suppliers.');
                    return;
                  }
                  if (!gstId) {
                    toast.error('Map GST % first', 'Map a GST % to this product before mapping suppliers (it drives the supplier GST calculation).');
                    return;
                  }
                  setSupplierPopupOpen(true);
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                Map Supplier
              </button>
            )}
            <button className="apm-close" onClick={onClose} aria-label="Close" disabled={saving}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div className={`apm-stepper${isPurchaseDept ? ' apm-stepper--solo' : ''}`}>
          <StepperItem
            n={1}
            title="Product Core Information"
            sub="Identity, classification & general info"
            current={tab === 'core' ? 1 : 2}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>}
          />
          {!isPurchaseDept && (
            <>
              <div className={`apm-step-connector${tab !== 'core' ? ' done' : ''}`} />
              <StepperItem
                n={2}
                title="For Sales Department"
                sub="Pricing, GST & sales details"
                current={tab === 'core' ? 1 : 2}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
              />
            </>
          )}
        </div>

        <div className="apm-body">
          {(mastersLoading || loadingEdit) ? (
            <FormSkeleton />
          ) : step === 1 && (
            <>
              {tab !== 'core' && (
                <PreviousStages
                  open={previousOpen}
                  onToggle={() => setPreviousOpen(v => !v)}
                  completed={1}
                  total={1}
                  stages={[
                    {
                      name: 'PRODUCT CORE',
                      tone: 'violet',
                      fields: [
                        { label: 'Product Name', value: name || '—' },
                        { label: 'Generic Name', value: genericName || '—' },
                        { label: 'HSN/SAC',      value: labelOf(optHsn, hsnId) },
                        { label: 'Segment',      value: labelOf(optSegments, segmentId) },
                        { label: 'Haz/Non-Haz',  value: hazType || '—' },
                        { label: 'UOM',          value: labelOf(optUoms, uomId) },
                        { label: 'Brand',        value: brand || '—' },
                        { label: 'Condition',    value: labelOf(optConditions, conditionId) },
                      ],
                    },
                    ...(tab === 'quality' ? [{
                      name: 'SALES CONFIG',
                      tone: 'amber' as const,
                      fields: [
                        { label: 'Base Price',  value: basePrice ? `₹${basePriceNum}` : '—' },
                        { label: 'GST %',       value: gstPctStr || '—' },
                        { label: 'GST Amount',  value: gstAmt ? `₹${gstAmt}` : '—' },
                        { label: 'Total Price', value: totalPrice ? `₹${totalPrice}` : '—' },
                        { label: 'Mark Bottom', value: markBottom || '—' },
                      ],
                    }] : []),
                  ]}
                />
              )}

              {tab === 'core' && (
                <>
                <SectionCard
                  tone="violet"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                  }
                  title="PRODUCT CORE INFORMATION"
                  subtitle="Product identity, description, and classification"
                >
                  <div className="apm-grid-2">
                    <Field label="Product Name" required icon={<i className="ri-product-hunt-line" />} error={fieldErrors.name}>
                      <input className="apm-input apm-input-mf" placeholder="Enter product name" maxLength={100} value={name} onChange={e => handleProductNameChange(e.target.value, 'name', setName)} />
                    </Field>
                    <Field label="Generic Name" required icon={<i className="ri-price-tag-3-line" />} error={fieldErrors.genericName}>
                      <input className="apm-input apm-input-mf" placeholder="Enter generic name" value={genericName} onChange={e => handleProductNameChange(e.target.value, 'genericName', setGenericName)} />
                    </Field>
                  </div>

                  <Field label="Product Printable Description" required icon={<i className="ri-file-text-line" />} error={fieldErrors.description}>
                    <textarea
                      className="apm-input apm-input-mf apm-textarea"
                      placeholder="Enter printable description"
                      value={description}
                      onChange={e => handleDescriptionChange(e.target.value)}
                      maxLength={10000}
                      rows={3}
                    />
                    <div className={`apm-char-count${description.length >= 10000 ? ' is-full' : ''}`}>
                      {description.length} / 10000 characters
                    </div>
                  </Field>

                  <div className="apm-grid-2">
                    <Field label="Make / Brand / Specifications" required icon={<i className="ri-store-2-line" />} error={fieldErrors.brand}>
                      <input className="apm-input apm-input-mf" placeholder="Make / Brand / Specifications" value={brand} onChange={e => { setBrand(e.target.value); clearFieldError('brand'); }} />
                    </Field>
                    <Field label="Segment" required addNew onAdd={() => setQuickAdd('segments')} error={fieldErrors.segmentId}>
                      <SelectInput value={segmentId} onChange={(v) => { void requestSegmentChange(v); }} placeholder="Select" options={optSegments} disabled={segChecking} />
                    </Field>
                  </div>

                  <div className="apm-grid-2">
                    <UploadDropzone
                      label="Product Primary Image"
                      required
                      hint="Click to upload primary image"
                      multiple={false}
                      preview={primaryPreview ? [primaryPreview] : []}
                      onPick={onPrimaryUpload}
                      onRemove={clearPrimary}
                    />
                    <UploadDropzone
                      label="Product Secondary Images"
                      required
                      hint="You Can Add Multiple Attachments"
                      multiple
                      preview={secondaryPreviews}
                      onPick={onSecondaryUpload}
                      onRemove={removeSecondary}
                    />
                  </div>

                </SectionCard>

                <SectionCard
                  tone="violet"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>}
                  title="PRODUCT GENERAL INFORMATION"
                  subtitle="Handling, classification, and packaging attributes"
                >
                    <div className="apm-grid-3">
                      <Field label="Haz / Non Haz" required error={fieldErrors.hazType}>
                        <SelectInput
                          value={hazType}
                          onChange={(v) => {
                            setHazType(v);
                            clearFieldError('hazType');
                            if (v !== 'Haz') {
                              setHazClassId('');
                              clearFieldError('hazClassId');
                            }
                          }}
                          placeholder="Select"
                          options={HAZ_TYPES}
                        />
                      </Field>
                      <Field
                        label="Haz Class"
                        required={hazType === 'Haz'}
                        addNew={hazType === 'Haz'}
                        onAdd={hazType === 'Haz' ? () => setQuickAdd('haz_class') : undefined}
                        disabled={hazType !== 'Haz'}
                        error={fieldErrors.hazClassId}
                      >
                        <SelectInput
                          value={hazClassId}
                          onChange={(v) => { setHazClassId(v); clearFieldError('hazClassId'); }}
                          placeholder={hazType === 'Haz' ? 'Select' : 'Choose Haz first'}
                          options={optHazClasses}
                          disabled={hazType !== 'Haz'}
                        />
                      </Field>
                      <Field label="UOM" required addNew onAdd={() => setQuickAdd('uom')} error={fieldErrors.uomId}>
                        <SelectInput value={uomId} onChange={(v) => { setUomId(v); clearFieldError('uomId'); }} placeholder="Select" options={optUoms} />
                      </Field>
                    </div>
                    <div className="apm-grid-3">
                      <Field label="HSN / SAC Code" required addNew onAdd={() => setQuickAdd('hsn_codes')} error={fieldErrors.hsnId}>
                        <SelectInput value={hsnId} onChange={(v) => { setHsnId(v); clearFieldError('hsnId'); }} placeholder="Select" options={optHsn} />
                      </Field>
                      <Field label="Condition" required addNew onAdd={() => setQuickAdd('conditions')} error={fieldErrors.conditionId}>
                        <SelectInput value={conditionId} onChange={(v) => { setConditionId(v); clearFieldError('conditionId'); }} placeholder="Select" options={optConditions} />
                      </Field>
                      <Field label="Packaging Material" required addNew onAdd={() => setQuickAdd('packaging_material')} error={fieldErrors.packagingMaterialId}>
                        <SelectInput value={packagingMaterialId} onChange={(v) => { setPackagingMaterialId(v); clearFieldError('packagingMaterialId'); }} placeholder="Select" options={optPackaging} />
                      </Field>
                    </div>
                    <Field label="Confidential Info" icon={<i className="ri-lock-2-line" />}>
                      <textarea
                        className="apm-input apm-input-mf apm-textarea"
                        placeholder="Confidential information"
                        value={confidential}
                        onChange={e => handleConfidentialChange(e.target.value)}
                        maxLength={CONFIDENTIAL_MAX}
                        rows={4}
                      />
                      <div className={`apm-char-count${confidential.length >= CONFIDENTIAL_MAX ? ' is-full' : ''}`}>
                        {confidential.length} / {CONFIDENTIAL_MAX} characters
                      </div>
                    </Field>
                </SectionCard>

                <SectionCard
                  tone="violet"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>}
                  title="PRODUCT ATTACHMENT"
                  subtitle="Supporting document, certificate or specification"
                >
                  <UploadDropzone
                    label="Product Attachment"
                    hint="Click to upload attachment (PDF, Word or image)"
                    multiple={false}
                    fileMode
                    fileName={attachmentName}
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/gif,image/webp"
                    preview={attachmentPreview ? [attachmentPreview] : []}
                    onPick={onAttachmentUpload}
                    onRemove={clearAttachment}
                  />
                </SectionCard>
                </>
              )}

              {tab === 'sales' && (
                <SectionCard
                  tone="violet"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  }
                  title="For Sales Department"
                  subtitle="Pricing, GST and sales configuration"
                >
                  <div className="apm-grid-2">
                    <Field label="Product Selling Price (Without GST)" required error={fieldErrors.basePrice}>
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix" placeholder="Enter base price" type="number" value={basePrice} onChange={e => { setBasePrice(e.target.value); clearFieldError('basePrice'); }} />
                      </div>
                    </Field>
                    <Field
                      label="GST %"
                      required
                      error={fieldErrors.gstId}
                      onEdit={openGstMap}
                      editDisabled={saving || !productId}
                      editTitle={productId ? 'Map / manage GST %' : 'Save Product Core Information (Stage 1) before mapping a GST %'}
                    >
                      <input
                        className="apm-input apm-readonly"
                        value={optGst.find(o => o.value === gstId)?.label ?? ''}
                        readOnly
                        placeholder='Map from the "GST (%)" button above'
                        title='GST % is mapped through the "GST (%)" button above'
                      />
                    </Field>
                  </div>
                  <div className="apm-grid-2">
                    <Field label="GST Amount" required>
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix apm-readonly" value={gstAmt} readOnly />
                      </div>
                    </Field>
                    <Field label="Total Selling Price" required>
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix apm-readonly apm-total" value={totalPrice} readOnly />
                      </div>
                    </Field>
                  </div>
                </SectionCard>
              )}

              {tab === 'quality' && (
                <>
                  <SectionCard
                    tone="amber"
                    icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>}
                    title="Box Matrix Details"
                    subtitle="Physical dimensions and weight specifications"
                  >
                    <div className="apm-grid-5">
                      <Field label="Net Weight (Kg)" icon={<i className="ri-scales-2-line" />} error={fieldErrors.netWeight}>
                        <input className="apm-input apm-input-mf apm-input-amber" placeholder="Net Weight" type="number" value={netWeight} onChange={e => { setNetWeight(e.target.value); clearFieldError('netWeight'); }} />
                      </Field>
                      <Field label="Gross Weight (Kg)" icon={<i className="ri-scales-3-line" />} error={fieldErrors.grossWeight}>
                        <input className="apm-input apm-input-mf apm-input-amber" placeholder="Gross Weight" type="number" value={grossWeight} onChange={e => { setGrossWeight(e.target.value); clearFieldError('grossWeight'); }} />
                      </Field>
                      <Field label="Length (Cm)" icon={<i className="ri-ruler-2-line" />} error={fieldErrors.length}>
                        <input className="apm-input apm-input-mf apm-input-amber" placeholder="Length" type="number" value={length} onChange={e => { setLength(e.target.value); clearFieldError('length'); }} />
                      </Field>
                      <Field label="Width (Cm)" icon={<i className="ri-ruler-line" />} error={fieldErrors.width}>
                        <input className="apm-input apm-input-mf apm-input-amber" placeholder="Width" type="number" value={width} onChange={e => { setWidth(e.target.value); clearFieldError('width'); }} />
                      </Field>
                      <Field label="Height (Cm)" icon={<i className="ri-arrow-up-down-line" />} error={fieldErrors.height}>
                        <input className="apm-input apm-input-mf apm-input-amber" placeholder="Height" type="number" value={height} onChange={e => { setHeight(e.target.value); clearFieldError('height'); }} />
                      </Field>
                    </div>
                  </SectionCard>

                  <SectionCard
                    tone="green"
                    icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
                    title="QC & Compliance"
                    subtitle={segmentId ? "Quality checks required by the chosen segment's rule" : "Pick a segment on the Core tab to load required QC documents"}
                  >
                    {!segmentId ? (
                      <div className="apm-empty">Select a segment first — required QC documents are pulled from that segment's rule.</div>
                    ) : segmentQcDocs.length === 0 ? (
                      <div className="apm-empty">The chosen segment's rule has no QC documents configured. Open Document Control Panel → Segment Rules to add them.</div>
                    ) : (
                      <div className="table-responsive table-card border rounded">
                        <table className="table align-middle table-nowrap mb-0">
                          <thead className="table-light">
                            <tr>
                              <th scope="col">Sr No</th>
                              <th scope="col">Auto Code</th>
                              <th scope="col">QC Document Name</th>
                              <th scope="col">Status</th>
                              <th scope="col">File</th>
                              <th scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {segmentQcDocs.map((q, i) => {
                              const refKey = `qc::${q.code}`;
                              const uploaded = qcRefUploads[refKey];
                              const onPick = (f: File | undefined, inputEl?: HTMLInputElement | null) => {
                                if (!f) return;
                                const reset = () => { if (inputEl) inputEl.value = ''; };
                                if (QC_COMPLIANCE_DENY_EXT_RE.test(f.name)) {
                                  toast.error('Unsafe file type blocked', `${f.name} — executable / script files are not allowed`);
                                  reset();
                                  return;
                                }
                                const mimeOk = f.type && QC_COMPLIANCE_ALLOWED_MIME_RE.test(f.type);
                                const extOk  = QC_COMPLIANCE_ALLOWED_EXT_RE.test(f.name);
                                if (!mimeOk && !extOk) {
                                  toast.error('Unsupported file type', `${f.name} — only PDF, DOC, DOCX, XLS, XLSX, JPG, PNG are allowed`);
                                  reset();
                                  return;
                                }
                                if (f.size > QC_COMPLIANCE_MAX_BYTES) {
                                  const mb = (f.size / (1024 * 1024)).toFixed(2);
                                  toast.error('File too large', `${f.name} is ${mb} MB — maximum allowed size is 10 MB`);
                                  reset();
                                  return;
                                }
                                setQcRefUploads(prev => {
                                  const existing = prev[refKey];
                                  if (existing?.url && existing.url.startsWith('blob:')) {
                                    try { URL.revokeObjectURL(existing.url); } catch {}
                                  }
                                  return { ...prev, [refKey]: { file: f, url: URL.createObjectURL(f), name: f.name } };
                                });
                                void persistQcRefUpload(refKey, f, q.name);
                              };
                              return (
                                <tr key={q.code} style={{ background: uploaded ? undefined : '#fafafa' }}>
                                  <td><span className="text-muted fs-13">{String(i + 1).padStart(2, '0')}</span></td>
                                  <td><span className="badge bg-light text-dark border">{q.code}</span></td>
                                  <td><strong className="fs-13">{q.name}</strong></td>
                                  <td>
                                    <span className={`badge ${q.requirement === 'M' ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}`}>
                                      {q.requirement === 'M' ? '✓ Mandatory' : 'Optional'}
                                    </span>
                                  </td>
                                  <td>
                                    {uploaded
                                      ? <a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600 }}>{uploaded.name}</a>
                                      : <span className="text-muted fs-13 fst-italic">Not uploaded</span>}
                                  </td>
                                  <td>
                                    {!uploaded ? (
                                      <label className="btn btn-sm btn-soft-primary mb-0" title="Upload (PDF, DOC, DOCX, XLS, XLSX, JPG, PNG · max 10 MB)" style={{ cursor: 'pointer' }}>
                                        <i className="ri-upload-2-line" />
                                        <input
                                          type="file"
                                          hidden
                                          accept={QC_COMPLIANCE_ACCEPT}
                                          onChange={e => onPick(e.target.files?.[0], e.currentTarget)}
                                        />
                                      </label>
                                    ) : (
                                      <div className="d-flex gap-1">
                                        <a href={uploaded.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-soft-info" title={`View ${uploaded.name}`}>
                                          <i className="ri-eye-line" />
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => void downloadFile(uploaded.url, uploaded.name)}
                                          className="btn btn-sm btn-soft-secondary"
                                          title={`Download ${uploaded.name}`}
                                        >
                                          <i className="ri-download-2-line" />
                                        </button>
                                        <label className="btn btn-sm btn-soft-primary mb-0" title="Re-upload (replace file)" style={{ cursor: 'pointer' }}>
                                          <i className="ri-refresh-line" />
                                          <input
                                            type="file"
                                            hidden
                                            accept={QC_COMPLIANCE_ACCEPT}
                                            onChange={e => onPick(e.target.files?.[0], e.currentTarget)}
                                          />
                                        </label>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
                </>
              )}
            </>
          )}

          {supplierPopupOpen && createPortal((
            <div className="apm-sup-overlay" onClick={closeSupplierPopup}>
              <div className="apm-sup-modal" onClick={(e) => e.stopPropagation()}>
                <div className="apm-sup-head">
                  <div className="apm-sup-head-ico">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                  </div>
                  <div className="apm-sup-head-txt">
                    <div className="apm-sup-title">Mapped Suppliers</div>
                    <div className="apm-sup-sub">Suppliers linked to this product with purchase price &amp; GST</div>
                  </div>
                  <button className="apm-sup-close" onClick={closeSupplierPopup} disabled={saving} aria-label="Close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="apm-sup-body">
              <div className="apm-sup-bar">
                <span className="apm-sup-countpill">{vendors.length} supplier{vendors.length !== 1 ? 's' : ''} mapped</span>
                <button
                  type="button"
                  className="apm-sup-map"
                  disabled={!canMapSupplier || saving}
                  title={canMapSupplier ? undefined : 'Select a GST rate for this product (Sales Config) before mapping a supplier.'}
                  onClick={() => {
                    if (!canMapSupplier) {
                      toast.error('GST rate required', 'Select a GST rate for this product (Sales Config step) before you can map a supplier — 0% is allowed.');
                      return;
                    }
                    setVendorDraftOpen(true);
                  }}
                >
                  <span>+</span> Map Supplier
                </button>
              </div>

              {vendorDraftOpen && createPortal((
                <div className="apm-mv-backdrop">
                  <div className="apm-mv-popup">
                    <div className="apm-mv-popup-head">
                      <div className="apm-mv-popup-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        <div>
                          <div className="apm-mv-popup-title-main">{vendorEditingId ? 'Edit Mapped Supplier' : 'Map Supplier'}</div>
                          <div className="apm-mv-popup-title-sub">Link a supplier with purchase price &amp; GST for this product</div>
                        </div>
                      </div>
                      <button className="apm-close apm-mv-close" onClick={closeVendorDraft} disabled={saving} aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>

                    <div className="apm-mv-popup-body">
                      <div className="apm-grid-3">
                        <Field label="Supplier Name" required>
                          <SelectInput value={vendorSelectedCode} onChange={setVendorSelectedCode} placeholder="Select Supplier Name"
                            disabled={saving}
                            options={vendorOpts.map(v => {
                              const segNames = (v.segmentIds ?? [])
                                .map(id => labelOf(optSegments, String(id), ''))
                                .filter(Boolean);
                              const MAX_INLINE = 1;
                              const badges: OptBadge[] = segNames
                                .slice(0, MAX_INLINE)
                                .map(s => ({ text: s, tone: 'violet' as const }));
                              if (segNames.length > MAX_INLINE) {
                                const rest = segNames.slice(MAX_INLINE);
                                badges.push({ text: `+${rest.length}`, tone: 'gray' as const, title: rest.join(', '), items: rest });
                              }
                              return {
                                value: v.code,
                                label: `${v.code ? `${formatSupplierCode(v.code)}: ` : ''}${v.name}`,
                                badges,
                              };
                            })}
                          />
                        </Field>
                        <Field label="Supplier Code">
                          <input className="apm-input apm-readonly" value={vendorSelected ? formatSupplierCode(vendorSelected.code) : ''} readOnly placeholder="Auto-fills from supplier" />
                        </Field>
                        <Field label="Supplier Type">
                          <input className="apm-input apm-readonly" value={vendorSelected ? (vendorSelected.type || '—') : ''} readOnly placeholder="—" />
                        </Field>

                        <Field label="State">
                          <input className="apm-input apm-readonly" value={vendorSelected ? (vendorSelected.state || '—') : ''} readOnly placeholder="—" />
                        </Field>
                        <Field label="Contact Person">
                          <input className="apm-input apm-readonly" value={vendorSelected?.contact ?? ''} readOnly placeholder="—" />
                        </Field>
                        <Field label="Purchase Price (₹)" required>
                          <div className="apm-input-icon">
                            <span className="apm-input-icon-prefix">₹</span>
                            <input className="apm-input has-prefix" type="number" placeholder="Enter purchase price" value={vendorPurchasePrice} onChange={e => setVendorPurchasePrice(e.target.value)} disabled={saving} />
                          </div>
                        </Field>

                        <Field label="GST %">
                          <input className="apm-input apm-readonly" value={gstPctStr || '—'} readOnly title="GST % comes from the product's Sales Config (Step 2)" />
                        </Field>
                        <Field label="GST Amount (₹)">
                          <div className="apm-input-icon">
                            <span className="apm-input-icon-prefix">₹</span>
                            <input className="apm-input has-prefix apm-readonly" value={vendorPurchasePrice.trim() === '' ? '' : vendorGsta.toFixed(2)} readOnly placeholder="Auto-computed" />
                          </div>
                        </Field>
                        <Field label="Total Amount (₹)">
                          <div className="apm-input-icon">
                            <span className="apm-input-icon-prefix">₹</span>
                            <input className="apm-input has-prefix apm-readonly apm-total" value={vendorPurchasePrice.trim() === '' ? '' : vendorTota.toFixed(2)} readOnly placeholder="Auto-computed" />
                          </div>
                        </Field>
                      </div>
                    </div>

                    <div className="apm-mv-popup-foot">
                      <button className="apm-btn-ghost" onClick={closeVendorDraft} disabled={saving}>Cancel</button>
                      <button className="apm-btn-primary" onClick={saveVendorDraft} disabled={saving}>
                        {saving ? <span className="apm-spinner" /> : null}
                        {saving ? 'Saving…' : (vendorEditingId ? 'Save Changes' : 'Save')}
                      </button>
                    </div>
                  </div>
                </div>
              ), document.body)}

              {vendors.length === 0 ? (
                <div className="apm-sup-empty">No suppliers mapped yet. Click &quot;Map Supplier&quot; to begin.</div>
              ) : (
                <div className="apm-sup-tablewrap">
                  <table className="apm-sup-table">
                    <thead>
                      <tr>
                        <th>Sr No</th><th>Supplier</th><th>Code</th><th>Type</th><th>State</th><th>Contact</th>
                        <th>Price (₹)</th><th>GST %</th><th>GST (₹)</th><th>Total (₹)</th><th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.map((v, i) => {
                        const opt = vendorOpts.find(o => (v.vendorId && o.id === String(v.vendorId)) || (v.vendorCode && o.code === v.vendorCode));
                        return (
                        <tr key={v.id}>
                          <td><span className="apm-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                          <td className="apm-sup-cname">
                            {v.vendorName.length > 15
                              ? <Tooltip label={v.vendorName}><span>{v.vendorName.slice(0, 15) + '…'}</span></Tooltip>
                              : (v.vendorName || '—')}
                          </td>
                          <td><span className="apm-sup-code">{formatSupplierCode(v.vendorCode)}</span></td>
                          <td>{opt?.type || '—'}</td>
                          <td>{opt?.state || '—'}</td>
                          <td className="apm-sup-cperson">{v.contactPerson || '—'}</td>
                          <td>₹{v.purchasePrice.toLocaleString()}</td>
                          <td>{String(Number(v.gstPct.toFixed(2)))}%</td>
                          <td>₹{v.gstAmt.toFixed(2)}</td>
                          <td className="apm-sup-ctotal">₹{v.totalAmt.toLocaleString()}</td>
                          <td>
                            <div className="apm-sup-actions">
                              <button type="button" className="apm-sup-edit" title="Edit supplier" aria-label="Edit supplier" disabled={saving} onClick={() => openVendorEdit(v)}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              {vendors.length > 1 && (
                                <button type="button" className="apm-sup-del" title="Remove supplier" aria-label="Remove supplier" disabled={saving} onClick={() => removeVendor(v)}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
                </div>
                <div className="apm-sup-foot">
                  <button className="apm-btn-ghost" onClick={closeSupplierPopup} disabled={saving}>Close</button>
                  {!persistsImmediately && (
                    <button className="apm-btn-primary" onClick={saveVendorsAndFinish} disabled={saving}>
                      {saving ? 'Saving…' : 'Save Product'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ), document.body)}
        </div>

        <div className="apm-foot">
          <div className="apm-foot-left">
            <span className="apm-req-hint">
              <span className="apm-req-hint-dot" />
              Fields marked with <span className="apm-req">*</span> are required
            </span>
          </div>
          <div className="apm-foot-right">
            {(step === 2 || (step === 1 && tab !== 'core')) && (
              <button
                className="apm-btn-outline"
                disabled={saving}
                onClick={() => {
                  if (step === 2)            { setStep(1); setTab('sales'); }
                  else if (tab === 'sales')  { setTab('core'); }
                }}
              >
                ← Previous
              </button>
            )}
            {step === 2 ? (
              <button className="apm-btn-primary" onClick={saveVendorsAndFinish} disabled={saving || loadingEdit || mastersLoading}>
                {saving ? (
                  <span className="apm-spinner" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
                {saving ? 'Saving…' : 'Save Product'}
              </button>
            ) : (
              <button
                className="apm-btn-primary"
                disabled={saving || loadingEdit || mastersLoading}
                onClick={() => {
                  if (tab === 'core')       saveCore();
                  else if (tab === 'sales') saveSales();
                }}
              >
                {saving ? <span className="apm-spinner" /> : null}
                {saving ? 'Saving…' : (tab === 'core' ? (isPurchaseDept ? <>Save &amp; Close</> : <>Save &amp; Next →</>) : <>Submit Product</>)}
              </button>
            )}
          </div>
        </div>
      </div>

      {qcModalOpen && (
        <QcAddPopup
          draft={qcDraft}
          setDraft={setQcDraft}
          isEdit={qcEditingId !== null}
          product={{
            code: productCode || 'P-NEW',
            name: name || '—',
            generic: genericName || '—',
            hsn: labelOf(optHsn, hsnId),
            segment: labelOf(optSegments, segmentId),
            hazType: hazType || '—',
            hazClass: labelOf(optHazClasses, hazClassId),
            vendorCount: vendors.length,
          }}
          onClose={() => { setQcModalOpen(false); setQcEditingId(null); }}
          onSave={saveQcDraft}
        />
      )}

      <DeleteConfirmModal
        open={qcDeleteTarget !== null}
        itemName={qcDeleteTarget?.name}
        title="Delete QC Record"
        subMessage="This removes the QC record from the form. The product must be saved (Save & Next) for the change to persist."
        onClose={() => setQcDeleteTarget(null)}
        onConfirm={() => {
          if (qcDeleteTarget) removeQc(qcDeleteTarget.id);
          setQcDeleteTarget(null);
        }}
      />

      {segGatePending && createPortal((
        <div className="apm-sup-overlay" onClick={() => { if (!saving) setSegGatePending(''); }}>
          <div className="apm-sup-modal apm-sup-modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="apm-sup-head">
              <div className="apm-sup-head-ico">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <div className="apm-sup-head-txt">
                <div className="apm-sup-title">Suppliers are mapped to this segment</div>
                <div className="apm-sup-sub">Unmap them before moving this product to another segment</div>
              </div>
              <button className="apm-sup-close" onClick={() => setSegGatePending('')} disabled={saving} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="apm-sup-body">
              <div className="apm-seg-gate-note">
                <i className="ri-error-warning-line" />
                <span>
                  <b>{vendors.length}</b> supplier{vendors.length !== 1 ? 's' : ''} mapped under{' '}
                  <b>{labelOf(optSegments, segmentId)}</b>. Unmap {vendors.length !== 1 ? 'them' : 'it'} to move this
                  product to <b>{labelOf(optSegments, segGatePending)}</b>.
                </span>
              </div>
              <div className="apm-sup-tablewrap">
                <table className="apm-sup-table">
                  <thead>
                    <tr>
                      <th>Sr No</th><th>Supplier</th><th>Code</th><th>Contact</th><th>Total (₹)</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v, i) => (
                      <tr key={v.id}>
                        <td><span className="apm-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                        <td className="apm-sup-cname">
                          {v.vendorName.length > 22
                            ? <Tooltip label={v.vendorName}><span>{v.vendorName.slice(0, 22) + '…'}</span></Tooltip>
                            : (v.vendorName || '—')}
                        </td>
                        <td><span className="apm-sup-code">{formatSupplierCode(v.vendorCode)}</span></td>
                        <td className="apm-sup-cperson">{v.contactPerson || '—'}</td>
                        <td className="apm-sup-ctotal">₹{v.totalAmt.toLocaleString()}</td>
                        <td>
                          <button type="button" className="apm-sup-del" title="Unmap supplier" aria-label="Unmap supplier" disabled={saving} onClick={() => unmapForSegmentChange(v)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="apm-sup-foot">
              <button className="apm-btn-ghost" onClick={() => setSegGatePending('')} disabled={saving}>
                Keep “{labelOf(optSegments, segmentId)}”
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {gstMapOpen && createPortal((
        <div className="apm-gst-overlay" onClick={closeGstMap}>
          <div className="apm-gst-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apm-gst-head">
              <div className="apm-gst-head-ico">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
              </div>
              <div className="apm-gst-head-txt">
                <div className="apm-gst-title">Map GST (%)</div>
                <div className="apm-gst-sub">Select the GST percentage you want to map for this product</div>
              </div>
              <button className="apm-gst-close" onClick={closeGstMap} aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="apm-gst-body">
              <div className="apm-gst-label-row">
                <span className="apm-gst-label">How much GST % do you want to map for this product?</span>
                <button className="apm-gst-plus" title="Add / manage GST % master" onClick={() => setGstMasterOpen(true)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              </div>
              <SelectInput value={gstMapValue} onChange={setGstMapValue} placeholder="Select GST %" options={optGstSorted} />
              <div className="apm-gst-hint">Need a different rate? Use the <b>+</b> button above to add it to the GST % master.</div>
            </div>
            <div className="apm-gst-foot">
              <button className="apm-btn-ghost" onClick={closeGstMap}>Cancel</button>
              <button className="apm-btn-primary" disabled={!gstMapValue || saving} onClick={async () => {
                const chosen = gstMapValue;
                setGstId(chosen); clearFieldError('gstId');
                const rate = optGst.find(o => o.value === chosen)?.label;
                if (!productId) {
                  const ok = await commitCore(chosen);
                  if (ok) {
                    setGstMapOpen(false);
                    toast.success('Product added', rate ? `GST ${rate} mapped — product created.` : 'Product created.');
                  }
                  return;
                }
                setGstMapOpen(false);
                toast.success('GST mapped', rate ? `GST ${rate} is mapped to this product.` : 'GST is mapped to this product.');
              }}>Map GST</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {gstMasterOpen && createPortal((
        <div className="apm-gst-overlay apm-gst-overlay--master" onClick={() => setGstMasterOpen(false)}>
          <div className="apm-gst-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apm-gst-head">
              <div className="apm-gst-head-ico">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
              </div>
              <div className="apm-gst-head-txt">
                <div className="apm-gst-title">GST (%) Master</div>
                <div className="apm-gst-sub">Manage the GST percentage values available across products</div>
              </div>
              <button className="apm-gst-close" onClick={() => setGstMasterOpen(false)} aria-label="Back to Map GST">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="apm-gst-body">
              <div className="apm-gst-bar">
                <span className="apm-gst-count">{optGst.length} rate{optGst.length !== 1 ? 's' : ''} configured</span>
                <div className="apm-gst-add-wrap">
                  <input className="apm-input apm-gst-new" type="number" min="0" max="100" step="0.5" placeholder="e.g. 18" value={newGstRate} onChange={(e) => setNewGstRate(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addGstRate(); }} />
                  <button className="apm-gst-addbtn" disabled={gstBusy} onClick={addGstRate}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add Rate
                  </button>
                </div>
              </div>
              {optGst.length === 0 ? (
                <div className="apm-gst-empty">No GST rates yet. Add one above.</div>
              ) : (
                <div className="apm-gst-tablewrap">
                  <table className="apm-gst-table">
                    <thead><tr><th>Sr No</th><th>GST Rate</th><th aria-label="Remove" /></tr></thead>
                    <tbody>
                      {optGstSorted.map((o, i) => (
                        <tr key={o.value}>
                          <td><span className="apm-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                          <td className="apm-gst-rate">{o.label}</td>
                          <td><button className="apm-sup-del" title="Remove rate" disabled={gstBusy} onClick={() => removeGstRate(o.value)}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="apm-gst-foot">
              <button className="apm-btn-primary" onClick={() => setGstMasterOpen(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to Map GST
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {quickAdd === 'segments' ? (
        <>
          <style>{CLM_CSS}</style>
          <SegmentModal
            existing={null}
            nextCode={`S-${String(optSegments.length + 1).padStart(3, '0')}`}
            onClose={() => setQuickAdd(null)}
            onSave={async (form: SegmentForm) => {
              try {
                const { data } = await api.post('/clm/segments', form);
                const row = (data?.data ?? data) as Record<string, unknown>;
                onMasterAdded('segments', { ...row, title: row.title ?? row.name });
                setQuickAdd(null);
                toast.success('Segment added', String(row.name ?? row.title ?? form.name));
              } catch (e: any) {
                toast.error('Save failed', e?.response?.data?.message ?? 'Could not save segment');
              }
            }}
          />
        </>
      ) : quickAdd && (
        <MasterRecordModal
          slug={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(row) => {
            if (row.status && String(row.status).toLowerCase() !== 'active') {
              bustAllMasterBundles();
              toast.info('Saved as Inactive', 'Only Active records appear in this dropdown. Set it to Active to select it here.');
              setQuickAdd(null);
              return;
            }
            onMasterAdded(quickAdd, row);
            setQuickAdd(null);
          }}
        />
      )}
    </div>
  ), document.body);
}

function StepperItem(props: { n: number; title: string; sub: string; current: number; icon?: ReactNode }) {
  const { n, title, sub, current, icon } = props;
  const state = current > n ? 'done' : current === n ? 'active' : 'idle';
  const defaultIcon = n === 1
    ? <i className="ri-home-line" />
    : <i className="ri-shield-check-line" />;
  return (
    <div className={`apm-step apm-step-${state}`}>
      <div className="apm-step-icon-wrap">
        <span className="apm-step-icon">
          {state === 'done'
            ? <i className="ri-check-line" />
            : (icon ?? defaultIcon)}
        </span>
        <span className="apm-step-num-badge">{n}</span>
      </div>
      <div className="apm-step-text">
        <div className="apm-step-title">{title}</div>
        <div className="apm-step-sub">{sub}</div>
      </div>
      {state === 'active' && <span className="apm-step-flag">In Progress</span>}
      {state === 'done' && <span className="apm-step-flag apm-step-flag-done">Completed</span>}
    </div>
  );
}

function SectionCard(props: {
  tone: 'blue' | 'violet' | 'amber' | 'green' | 'navy';
  icon: ReactNode;
  title: string;
  subtitle: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`apm-section apm-section-${props.tone}`}>
      <div className="apm-section-head">
        <div className="apm-section-head-left">
          <div className="apm-section-icon">{props.icon}</div>
          <div className="apm-section-titles">
            <span className="apm-section-title">{props.title}</span>
            {props.subtitle && <span className="apm-section-sub">| {props.subtitle}</span>}
          </div>
        </div>
        {props.headerAction}
      </div>
      <div className="apm-section-body">{props.children}</div>
    </div>
  );
}

function FormSkeleton() {
  const Field = ({ wide = false }: { wide?: boolean }) => (
    <div className={`apm-shim-field${wide ? ' wide' : ''}`}>
      <div className="apm-shim apm-shim-label" />
      <div className="apm-shim apm-shim-input" />
    </div>
  );
  return (
    <div className="apm-shim-wrap" aria-busy="true" aria-live="polite">
      {[0, 1].map(s => (
        <div key={s} className="apm-shim-section">
          <div className="apm-shim-section-head">
            <div className="apm-shim apm-shim-icon" />
            <div className="apm-shim-section-titles">
              <div className="apm-shim apm-shim-title" />
              <div className="apm-shim apm-shim-sub" />
            </div>
          </div>
          <div className="apm-shim-section-body">
            <div className="apm-shim-grid-2">
              <Field /><Field /><Field /><Field />
            </div>
            <Field wide />
            <div className="apm-shim-grid-2">
              <Field /><Field />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  addNew?: boolean;
  onAdd?: () => void;
  onEdit?: () => void;
  editTitle?: string;
  editDisabled?: boolean;
  icon?: ReactNode;
  error?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`apm-field${props.error ? ' has-error' : ''}${props.disabled ? ' is-disabled' : ''}`}>
      <span className="apm-field-label">
        {props.label} {props.required && <span className="apm-req">*</span>}
        {props.addNew && !props.disabled && (
          <button
            type="button"
            className="apm-field-plus"
            aria-label="Add new option"
            tabIndex={-1}
            title={`Add new ${props.label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onAdd?.(); }}
          >+</button>
        )}
        {props.onEdit && (
          <button
            type="button"
            className="apm-field-edit"
            aria-label={props.editTitle ?? `Edit ${props.label}`}
            tabIndex={-1}
            title={props.editTitle ?? `Edit ${props.label}`}
            disabled={props.editDisabled}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onEdit?.(); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
          </button>
        )}
      </span>
      {props.icon ? (
        <div className="apm-master-field">
          {props.children}
        </div>
      ) : props.children}
      {props.error && (
        <span className="apm-field-error">
          <i className="ri-error-warning-line" /> {props.error}
        </span>
      )}
    </div>
  );
}

type OptBadge = { text: string; tone?: 'green' | 'red' | 'gray' | 'violet'; title?: string; items?: string[] };

type Opt = string | { value: string; label: string; badges?: OptBadge[] };

function SelectInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: Opt[];
  disabled?: boolean;
}) {
  const normalized = props.options.map(o =>
    typeof o === 'string' ? { value: o, label: o } : o
  );
  return (
    <div className="apm-master-select">
      <MasterSelect
        value={props.value}
        options={normalized}
        placeholder={props.placeholder ?? 'Select'}
        onChange={props.onChange}
        disabled={props.disabled}
      />
    </div>
  );
}

function UploadDropzone(props: {
  label: string;
  required?: boolean;
  hint: string;
  multiple: boolean;
  preview: string[];
  onPick: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  fileMode?: boolean;
  fileName?: string;
  accept?: string;
}) {
  const MAX_VISIBLE = 6;
  const [showAll, setShowAll] = useState(false);
  const total = props.preview.length;
  const overflow = total > MAX_VISIBLE;
  const visible = overflow ? props.preview.slice(0, MAX_VISIBLE - 1) : props.preview;

  return (
    <div className="apm-field apm-upload-field">
      <span className="apm-field-label">
        {props.label} {props.required && <span className="apm-req">*</span>}
      </span>
      <label className="apm-dropzone">
        <input
          type="file"
          accept={props.accept ?? '.png,.jpg,.jpeg,.jfif,.jpe,.pjpeg,image/png,image/jpeg,image/pjpeg'}
          multiple={props.multiple}
          onChange={props.onPick}
          className="apm-dropzone-input"
        />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>{props.hint}</span>
      </label>
      {total > 0 && props.fileMode && (
        <div className="apm-upload-preview">
          <a
            className="apm-upload-chip apm-upload-filechip"
            href={props.preview[0]}
            target="_blank"
            rel="noopener noreferrer"
            title={props.fileName || 'Open attachment'}
          >
            <svg className="apm-upload-fileico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="apm-upload-filename">{props.fileName || 'Attachment'}</span>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onRemove(0); }} aria-label="Remove">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </a>
        </div>
      )}
      {total > 0 && !props.fileMode && (
        <div className="apm-upload-preview">
          {visible.map((src, i) => (
            <div key={i} className="apm-upload-chip">
              <img src={src} alt="" />
              <button type="button" onClick={(e) => { e.preventDefault(); props.onRemove(i); }} aria-label="Remove">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
          {overflow && (
            <button
              type="button"
              className="apm-upload-chip apm-upload-more"
              onClick={(e) => { e.preventDefault(); setShowAll(true); }}
              aria-label={`Show all ${total} images`}
            >
              <img src={props.preview[MAX_VISIBLE - 1]} alt="" />
              <span className="apm-upload-more-badge">+{total - (MAX_VISIBLE - 1)}</span>
            </button>
          )}
        </div>
      )}

      {showAll && (
        <div className="apm-imgmodal-backdrop" onClick={() => setShowAll(false)}>
          <div className="apm-imgmodal" onClick={(e) => e.stopPropagation()}>
            <div className="apm-imgmodal-head">
              <span>{props.label} <em className="apm-imgmodal-count">({total})</em></span>
              <button type="button" className="apm-imgmodal-close" onClick={() => setShowAll(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="apm-imgmodal-grid">
              {props.preview.map((src, i) => (
                <div key={i} className="apm-imgmodal-chip">
                  <img src={src} alt="" />
                  <button type="button" onClick={(e) => { e.preventDefault(); props.onRemove(i); }} aria-label="Remove">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PrevStage = {
  name: string;
  tone: 'violet' | 'amber' | 'green';
  fields: { label: string; value: string }[];
  extras?: PrevStageExtra[];
};

type PrevStageExtra = {
  label: string;
  pairs: { k: string; v: string }[];
  attachment?: { name: string; href: string } | null;
};

function PreviousStages(props: {
  open: boolean;
  onToggle: () => void;
  completed: number;
  total: number;
  stages: PrevStage[];
}) {
  return (
    <div className={`apm-prev ${props.open ? 'is-open' : ''}`}>
      <div className="apm-prev-head" onClick={props.onToggle}>
        <span className="apm-prev-ico">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </span>
        <div className="apm-prev-headtext">
          <div className="apm-prev-title">What you did in previous stages</div>
          <div className="apm-prev-sub">Stage {props.completed} completed — review your entry below</div>
        </div>
        <span className="apm-prev-badge">{props.completed} stage{props.completed !== 1 ? 's' : ''} completed</span>
        <span className="apm-prev-chev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </div>
      {props.open && (
        <div className="apm-prev-body">
          {props.stages.map((s, si) => (
            <div key={s.name} className={`apm-prev-stage tone-${s.tone}`}>
              <div className="apm-prev-sumtitle">
                <span className="apm-prev-sumcheck">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                STAGE {si + 1} — {s.name}
              </div>
              <div className="apm-prev-sumgrid">
                {s.fields.map(f => (
                  <div key={f.label} className="apm-prev-sumcell">
                    <span className="apm-prev-sumk">{f.label}</span>
                    <span className="apm-prev-sumv" title={f.value}>{f.value}</span>
                  </div>
                ))}
              </div>
              {s.extras && s.extras.length > 0 && (
                <div className="apm-prev-extras">
                  {s.extras.map((ex, i) => (
                    <div key={i} className="apm-prev-extra-row">
                      <span className="apm-prev-extra-label">{ex.label}</span>
                      {ex.pairs.map((p, j) => (
                        <span key={j} className="apm-prev-extra-pair">
                          <span className="apm-prev-extra-k">{p.k} :</span>{' '}
                          <span className="apm-prev-extra-v" title={p.v}>{p.v}</span>
                        </span>
                      ))}
                      {ex.attachment?.href && (
                        <a
                          href={ex.attachment.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="apm-prev-extra-attach"
                          title={`Open ${ex.attachment.name}`}
                        >
                          <i className="ri-attachment-line" /> {ex.attachment.name}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const QC_ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg'];

const QC_ALLOWED_MIMES = /^(application\/pdf|image\/(png|jpe?g))$/i;

const QC_MAX_BYTES = 5 * 1024 * 1024;

const QC_COMPLIANCE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png';

const QC_COMPLIANCE_ALLOWED_EXT_RE = /\.(pdf|docx?|xlsx?|jpe?g|png)$/i;

const QC_COMPLIANCE_ALLOWED_MIME_RE = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel)|image\/(jpeg|png))$/i;

const QC_COMPLIANCE_DENY_EXT_RE = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ws[hf]?|ps1|psm1|jar|sh|app|apk|dll|deb|rpm|html?|svg|php|asp[x]?|jsp)$/i;

const QC_COMPLIANCE_MAX_BYTES = 10 * 1024 * 1024;

const QC_SQL_INJECTION_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;

const QC_ISSUED_BY_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%]/g;

const QC_ISSUED_BY_MAX = 80;

const QC_PURPOSE_MAX = 200;

function QcAddPopup(props: {
  draft: Omit<QcRecord, 'id'>;
  setDraft: (next: Omit<QcRecord, 'id'>) => void;
  isEdit?: boolean;
  product: {
    code: string; name: string; generic: string; hsn: string;
    segment: string; hazType: string; hazClass: string; vendorCount: number;
  };
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, isEdit, product, onClose, onSave } = props;
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<{ issuedBy?: string; purpose?: string }>({});
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft({ ...draft, [key]: value });

  const setIssuedBy = (raw: string) => {
    let cleaned = raw.replace(/[<>]/g, '').replace(QC_SQL_INJECTION_RE, '');
    const beforeWhitelist = cleaned;
    cleaned = cleaned.replace(QC_ISSUED_BY_INVALID_RE, '');
    if (cleaned.length > QC_ISSUED_BY_MAX) cleaned = cleaned.slice(0, QC_ISSUED_BY_MAX);
    setDraft({ ...draft, issuedBy: cleaned });
    if (cleaned !== raw) {
      setFieldErrors(prev => ({
        ...prev,
        issuedBy: beforeWhitelist !== raw
          ? 'HTML/SQL-like content is not allowed'
          : "Use letters, numbers, spaces, and . , - ( ) & / ' % only",
      }));
    } else {
      setFieldErrors(prev => ({ ...prev, issuedBy: undefined }));
    }
  };

  const setPurpose = (raw: string) => {
    let cleaned = raw.replace(/[<>]/g, '').replace(QC_SQL_INJECTION_RE, '');
    if (cleaned.length > QC_PURPOSE_MAX) cleaned = cleaned.slice(0, QC_PURPOSE_MAX);
    setDraft({ ...draft, purpose: cleaned });
    if (cleaned !== raw) {
      setFieldErrors(prev => ({ ...prev, purpose: 'HTML or SQL-like content is not allowed' }));
    } else {
      setFieldErrors(prev => ({ ...prev, purpose: undefined }));
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const resetInput = () => { e.target.value = ''; };

    const lower = f.name.toLowerCase();
    const extOk = QC_ALLOWED_EXTS.some(ext => lower.endsWith(ext));
    const mimeOk = !f.type || QC_ALLOWED_MIMES.test(f.type);
    if (!extOk || !mimeOk) {
      toast.error('Unsupported file type', `${f.name} — only PDF, PNG, or JPG files are allowed.`);
      resetInput();
      return;
    }
    if (f.size > QC_MAX_BYTES) {
      const mb = (f.size / (1024 * 1024)).toFixed(2);
      toast.error('File too large', `${f.name} is ${mb} MB — maximum allowed size is 5 MB.`);
      resetInput();
      return;
    }

    const previewUrl = URL.createObjectURL(f);
    setDraft({
      ...draft,
      attachmentName: f.name,
      attachmentFile: f,
      attachmentUrl: previewUrl,
    });
  };

  return createPortal((
    <div className="apm-qc-backdrop">
      <div className="apm-qc-popup">
        <div className="apm-qc-popup-head">
          <div className="apm-qc-popup-title">
            <i className="ri-shield-check-line" />
            {isEdit ? 'Edit QC Record' : 'Add QC Record'}
          </div>
          <button className="apm-close apm-qc-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="apm-qc-product-bar">
          <QcProd label="Product Code"  value={product.code} />
          <QcProd label="Product Name"  value={product.name} />
          <QcProd label="Generic Name"  value={product.generic} />
          <QcProd label="HSN/SAC Code"  value={product.hsn} />
          <QcProd label="Segment"       value={product.segment} />
          <QcProd label="Haz/Non-Haz"   value={product.hazType} />
          <QcProd label="Haz Class"     value={product.hazClass} />
          <QcProd label="Product Suppliers" value={String(product.vendorCount)} accent />
        </div>

        <div className="apm-qc-body">
          <div className="apm-qc-row-3">
            <Field label="QC Name" required>
              <SelectInput
                value={draft.name}
                onChange={(v) => set('name', v)}
                placeholder="Select QC"
                options={QC_NAMES}
              />
            </Field>
            <Field label="Issued By" required icon={<i className="ri-government-line" />} error={fieldErrors.issuedBy}>
              <input
                className="apm-input apm-input-mf"
                placeholder="Authority"
                value={draft.issuedBy}
                maxLength={QC_ISSUED_BY_MAX}
                onChange={e => setIssuedBy(e.target.value)}
              />
            </Field>
            <Field label={`Attachment ( Only One File Allowed )`} required>
              <div className="apm-qc-file">
                <input id="qc-file-input" type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" className="apm-qc-file-input" onChange={onPickFile} />
                <label htmlFor="qc-file-input" className="apm-qc-file-trigger">
                  <i className="ri-attachment-2" />
                  <span>{draft.attachmentName || 'Choose file'}</span>
                </label>
              </div>
            </Field>
          </div>

          <Field label="QC Purpose" required icon={<i className="ri-file-list-3-line" />} error={fieldErrors.purpose}>
            <input
              className="apm-input apm-input-mf"
              placeholder="Certificate of Analysis"
              value={draft.purpose}
              maxLength={QC_PURPOSE_MAX}
              onChange={e => setPurpose(e.target.value)}
            />
          </Field>

          <div className="apm-qc-row-2">
            <Field label="QA Testing Parameter">
              <textarea
                className="apm-input apm-textarea apm-qc-textarea"
                placeholder="Enter testing parameter…"
                value={draft.testingParameter}
                onChange={e => set('testingParameter', e.target.value)}
              />
            </Field>
            <Field label="Minimum Acceptance Criteria">
              <textarea
                className="apm-input apm-textarea apm-qc-textarea"
                placeholder="Enter minimum acceptance criteria…"
                value={draft.minAcceptance}
                onChange={e => set('minAcceptance', e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="apm-qc-foot">
          <button
            className="apm-qc-save"
            onClick={onSave}
            disabled={!draft.name || !draft.purpose || !draft.issuedBy}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

function QcProd(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="apm-qc-prod">
      <span className="apm-qc-prod-key">{props.label} :</span>
      <span className={`apm-qc-prod-val ${props.accent ? 'accent' : ''}`}>{props.value}</span>
    </div>
  );
}