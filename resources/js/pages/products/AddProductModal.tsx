import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { resolveFileUrl, viewFile } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Product — 2-step wizard
 *
 * Step 1: Product Information — 3 inner tabs
 *           • Product Core Information  (identity, classification, media)
 *           • For Sales Department      (pricing + GST)
 *           • Quality & Compliance      (box matrix + QC list)
 * Step 2: Map Product Vendor — vendor selection + mapped vendor table
 *
 * Light + dark mode aware. Validation is light, the form stays local, and
 * `onSubmit` fires when the user clicks "Save Product" on step 2.
 * ──────────────────────────────────────────────────────────────────────── */

export type VendorEntry = {
  id: string;
  /** DB id of the vendor row. Carries through so storeVendors can
   *  mirror the mapping into VendorProductMapping (vendor side). */
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
  name: string;            // QC Name (dropdown: COA, MSDS, FSSC, etc.)
  purpose: string;         // QC Purpose
  issuedBy: string;        // Issuing authority
  testingParameter: string;
  minAcceptance: string;
  attachmentName: string;  // single attachment filename
  /** Resolved URL for the attachment (from API's `attachment_url`
   *  accessor when available, else built via resolveFileUrl).
   *  Empty when the row has no attachment yet. */
  attachmentUrl?: string;
  /** Newly picked File object (set by the QC modal's file input)
   *  — kept in memory until Save uploads it via multipart and the
   *  server returns the stored attachment_path. */
  attachmentFile?: File | null;
  /** Existing server-side path. Preserved on edit so the row keeps
   *  its uploaded file when the user doesn't replace the attachment. */
  attachmentPath?: string;
};

/* ─── Static option lists ─── */
// Segments / Haz Class / UOM / HSN / Conditions / Packaging / GST are loaded
// from the master API at runtime — see the masters loader effect inside the
// component. These three lists stay local because:
//   • Haz Type is a binary flag, not a master
//   • Bottom / Non Bottom is fixed
//   • QC Names + Vendor List don't have masters yet (TODO)
const HAZ_TYPES = ['Non-Haz', 'Haz'];
const BOTTOM_OPTIONS = ['Bottom', 'Non Bottom'];
const QC_NAMES = ['COA', 'MSDS', 'FSSAI', 'AGMARK', 'ISO 9001', 'ISO 22000', 'HACCP', 'HALAL', 'KOSHER', 'FSSC 22000'];
/** Vendor option as it lives in the in-memory list backing the
 *  Step-2 dropdown. Loaded from /api/vendors when the wizard reaches
 *  the vendor step, includes both Active and Inactive vendors so the
 *  user can map any vendor the org has on file. */
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
};

type Tab = 'core' | 'sales' | 'quality';

const today = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const formatDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const parseDmyToIso = (dmy: string): string | null => {
  if (!dmy) return null;
  // Accept either DD/MM/YYYY (display format) or YYYY-MM-DD (ISO from picker)
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

/* ──────────────────────────────────────────────────────────────────────────
 * Component
 * ────────────────────────────────────────────────────────────────────── */
type MasterOpt = { value: string; label: string; extra?: Record<string, unknown> };

export default function AddProductModal(props: {
  productId?: number | null;
  onClose: () => void;
  onSaved: (productId: number, finalised: boolean) => void;
}) {
  const { productId: initialId, onClose, onSaved } = props;
  const toast = useToast();

  /* ─── Wizard nav ─── */
  const [step, setStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<Tab>('core');
  const [previousOpen, setPreviousOpen] = useState(true);

  /* Add-mode tab-lock — user can only click into tabs they've already
   * reached via Save & Next. Edit mode unlocks everything immediately
   * because the full record already exists on the server.
   *
   *   On first render reachedTabs already includes every tab when
   *   `initialId` is set, so Save & Next on Core saves and advances
   *   instantly without waiting for the prefill fetch to finish.
   *   Previously the load effect reset step/tab AFTER the await,
   *   yanking the user back to Core when they'd already advanced. */
  const [reachedTabs, setReachedTabs] = useState<Set<Tab>>(() =>
    new Set<Tab>(initialId ? ['core', 'sales', 'quality'] : ['core'])
  );
  const markTabReached = (t: Tab) => setReachedTabs(prev => new Set(prev).add(t));
  const canSwitchToTab = (t: Tab) => reachedTabs.has(t);
  const [productId, setProductId] = useState<number | null>(initialId ?? null);
  /* True while the edit-mode prefill is in flight. Disables Save &
     Next so the user can't fire a save against half-loaded form state
     and hit spurious validation errors. */
  const [loadingEdit, setLoadingEdit] = useState<boolean>(!!initialId);
  const [productCodeFromApi, setProductCodeFromApi] = useState<string>('');
  const [saving, setSaving] = useState(false);
  /**
   * Per-field validation errors keyed by field name. Each saver populates
   * this on validation failure; the matching `Field` shows a red border +
   * inline "ri-error-warning" message. Typing in a field clears its entry.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (k: string) => {
    setFieldErrors(prev => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  /* ─── Master Quick-Add state ───────────────────────────────────────
   * The `+` button next to a master-backed field sets this to the
   * master slug; the MasterQuickAddPopup component renders the right
   * form for that slug and POSTs to /api/master/{slug}. On save the
   * new row is appended to the right opt* list and selected on the
   * field that triggered the popup.
   * ──────────────────────────────────────────────────────────── */
  type MasterSlug = 'segments' | 'haz_class' | 'uom' | 'hsn_codes' | 'conditions' | 'packaging_material' | 'gst_percentage';
  const [quickAdd, setQuickAdd] = useState<MasterSlug | null>(null);

  /* ─── Master options (loaded from API on mount) ─── */
  const [optSegments, setOptSegments] = useState<MasterOpt[]>([]);
  const [optHazClasses, setOptHazClasses] = useState<MasterOpt[]>([]);
  const [optUoms, setOptUoms] = useState<MasterOpt[]>([]);
  const [optHsn, setOptHsn] = useState<MasterOpt[]>([]);
  const [optConditions, setOptConditions] = useState<MasterOpt[]>([]);
  const [optPackaging, setOptPackaging] = useState<MasterOpt[]>([]);
  const [optGst, setOptGst] = useState<MasterOpt[]>([]);

  /* ─── Step 1: Core ─── */
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

  /* ─── Image state ─────────────────────────────────────────────────
   * `primaryImagePath`  — server-stored disk path (null when never saved
   *                       or freshly cleared).
   * `primaryImageFile`  — newly picked File pending upload. When set, it
   *                       overrides the stored path on next save.
   * Secondary images follow the same kept-paths + new-files split.
   * Preview URLs are derived: `URL.createObjectURL(file)` for pending
   * files, `resolveFileUrl(path)` for already-uploaded paths.
   * ──────────────────────────────────────────────────────────────── */
  const [primaryImagePath, setPrimaryImagePath] = useState<string | null>(null);
  const [primaryImageFile, setPrimaryImageFile] = useState<File | null>(null);
  const [secondaryImagePaths, setSecondaryImagePaths] = useState<string[]>([]);
  const [secondaryImageFiles, setSecondaryImageFiles] = useState<File[]>([]);

  /* Display URLs for already-uploaded images. The backend ships these
     ready-to-render (Product::primary_image_url + secondary_images_url
     accessors) so the frontend doesn't have to guess at storage layout
     — `resolveFileUrl` was returning broken paths for some prod
     configurations. Paths stay separate because the save round-trip
     uses raw `primary_image` / `secondary_images[]` keys. */
  const [primaryImageUrl, setPrimaryImageUrl]     = useState<string | null>(null);
  const [secondaryImageUrls, setSecondaryImageUrls] = useState<string[]>([]);

  const primaryPreview = primaryImageFile
    ? URL.createObjectURL(primaryImageFile)
    : (primaryImageUrl || (primaryImagePath ? resolveFileUrl(primaryImagePath) : ''));
  const secondaryPreviews = [
    ...secondaryImagePaths.map((p, i) => secondaryImageUrls[i] || resolveFileUrl(p)),
    ...secondaryImageFiles.map(f => URL.createObjectURL(f)),
  ];

  /* ─── Step 1: Sales ─── */
  const [basePrice, setBasePrice] = useState<string>('');
  const [gstId, setGstId] = useState<string>('');
  const [markBottom, setMarkBottom] = useState('');

  const basePriceNum = parseFloat(basePrice) || 0;
  // Pull the percentage value out of the selected GST master row for the
  // amount calculation. `extra.percentage` carries the numeric column from
  // the master response shape; fall back to 0 when nothing is picked yet.
  const gstPctNum = useMemo(() => {
    const row = optGst.find(o => o.value === gstId);
    return parseFloat(String(row?.extra?.percentage ?? '0')) || 0;
  }, [optGst, gstId]);
  const gstPctStr = gstPctNum ? `${gstPctNum}%` : '';
  const gstAmt    = +(basePriceNum * (gstPctNum / 100)).toFixed(2);
  const totalPrice = +(basePriceNum + gstAmt).toFixed(2);

  /* ─── Step 1: Quality ─── */
  const [netWeight,   setNetWeight]   = useState<string>('');
  const [grossWeight, setGrossWeight] = useState<string>('');
  const [length,      setLength]      = useState<string>('');
  const [width,       setWidth]       = useState<string>('');
  const [height,      setHeight]      = useState<string>('');
  /* Inventory tracking — optional fields under the Quality tab. */
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

  /* ─── Step 2: Vendor ─── */
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [vendorDraftOpen, setVendorDraftOpen] = useState(false);
  /* Vendors loaded from /api/vendors. Both Active and Inactive show
     up — the user may map either, since a draft vendor still needs
     its products linked before the vendor itself can flip to Active. */
  const [vendorOpts, setVendorOpts] = useState<VendorOpt[]>([]);
  const [vendorSelectedCode, setVendorSelectedCode] = useState('');
  const [vendorPurchasePrice, setVendorPurchasePrice] = useState<string>('');
  const [vendorGstPct, setVendorGstPct] = useState<string>('');
  const [vendorRemarks, setVendorRemarks] = useState('');
  const [vendorMapDate, setVendorMapDate] = useState<string>('');

  const vendorSelected = useMemo(
    () => vendorOpts.find(v => v.code === vendorSelectedCode) || null,
    [vendorOpts, vendorSelectedCode]
  );
  const vendorPp   = parseFloat(vendorPurchasePrice) || 0;
  // Vendor GST% is locked to the product's own GST% (set in the
  // Sales Config step). Mapping a vendor must not introduce a
  // different tax rate than the product itself, so the picker is
  // gone and the calc just reads gstPctNum directly. The legacy
  // `vendorGstPct` state still exists for backward compat with
  // edit-mode prefill but no longer feeds the math.
  const vendorGp   = gstPctNum;
  const vendorGsta = +(vendorPp * (vendorGp / 100)).toFixed(2);
  const vendorTota = +(vendorPp + vendorGsta).toFixed(2);

  // Use the server-generated code once it exists; until then derive a
  // throwaway placeholder so the summary strip has something to show.
  const productCode = productCodeFromApi || (name ? 'P-NEW' : '');

  // Look up a master row's display label from its id — used by the
  // previous-stages summary and the QC popup's product header.
  const labelOf = (opts: MasterOpt[], id: string, fallback = '—') =>
    opts.find(o => o.value === id)?.label || fallback;

  /* Per-file image cap — keeps the multipart payload well under PHP's
     post_max_size (typically 8 MB by default) so the server doesn't
     reject the request with PostTooLargeException. Mirrors the
     `max:2048` rule on ProductController::storeCore. */
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_PRODUCT_EXTS = ['.png', '.jpg', '.jpeg', '.pdf'];
  /* Two-stage validation on picked product files:
       1. extension/mime → only PNG, JPG, or PDF allowed
       2. size → 2 MB cap (matches `max:2048` rule on storeCore)
     Extension check uses the filename suffix because some browsers ship
     an empty `file.type` for PDFs picked via drag-drop. */
  const validateImageSize = (file: File): boolean => {
    const lowerName = file.name.toLowerCase();
    const okExt = ALLOWED_PRODUCT_EXTS.some(ext => lowerName.endsWith(ext));
    if (!okExt) {
      toast.error('Unsupported file type', `${file.name} — only PNG, JPG, or PDF files are allowed.`);
      return false;
    }
    if (file.size <= MAX_IMAGE_BYTES) return true;
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    toast.error('File too large', `${file.name} is ${mb} MB — each file must be 2 MB or smaller.`);
    return false;
  };

  const onPrimaryUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!validateImageSize(f)) { e.target.value = ''; return; }
    setPrimaryImageFile(f);
    setPrimaryImagePath(null); // queued file supersedes any stored path
    setPrimaryImageUrl(null);  // and its display URL
  };

  const onSecondaryUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(validateImageSize);
    // Reset the input so the user can re-pick the same oversize file
    // after shrinking it without the browser silently swallowing the change.
    e.target.value = '';
    if (files.length) setSecondaryImageFiles(prev => [...prev, ...files]);
  };

  /**
   * Remove secondary preview at flat index `i` where the array is
   * `[...paths, ...files]`. We splice from whichever underlying array the
   * index lands in.
   */
  const removeSecondary = (i: number) => {
    if (i < secondaryImagePaths.length) {
      // Path-backed slot — drop the path AND its parallel display URL.
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
      // Update-in-place when the user opened an existing row via Edit.
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

  /* QC delete confirmation — same DeleteConfirmModal used by Clients /
     HR Employees / the Products list. Holds the row pending user
     confirmation; backdrop click and Esc respect `qcDeleting` so the
     user can't cancel mid-action. */
  const [qcDeleteTarget, setQcDeleteTarget] = useState<QcRecord | null>(null);

  /* Edit-mode for an existing QC row: opens the same QcAddPopup
     pre-filled with the row's data. On save we update the existing
     entry instead of appending a new one. */
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

  /* QC table action button — matches the outline-pill style used in the
     Clients list (Clients.tsx#L131) so the visual language stays
     consistent across the app. Inline so the modal stays a single file. */
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

  const saveVendorDraft = () => {
    const missing: string[] = [];
    if (!vendorSelected)        missing.push('Vendor');
    if (!vendorPp || vendorPp <= 0) missing.push('Purchase Price');
    if (missing.length) {
      toast.error('Missing required fields', `Please fill: ${missing.join(', ')}`);
      return;
    }
    if (!vendorSelected) return; // type-guard after the check
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
      mapDate: vendorMapDate ? formatDate(vendorMapDate) : today(),
      remarks: vendorRemarks,
    };
    setVendors(prev => [...prev, entry]);
    setVendorDraftOpen(false);
    setVendorSelectedCode('');
    setVendorPurchasePrice('');
    setVendorGstPct('');
    setVendorRemarks('');
    setVendorMapDate('');
    toast.success('Vendor mapped', `${entry.vendorName} added to this product`);
  };

  const removeVendor = (id: string) =>
    setVendors(prev => prev.filter(v => v.id !== id));

  // Lock the page scroll so the modal feels like a true overlay rather
  // than a panel that floats above scrollable content.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ─── Load master options on mount ─── */
  useEffect(() => {
    type Row = Record<string, unknown> & { id: number | string };
    const fetchMaster = async (slug: string, labelKey: string, opts?: { extraKeys?: string[] }): Promise<MasterOpt[]> => {
      try {
        const res = await api.get<Row[]>(`/master/${slug}`);
        return (res.data || [])
          .filter(r => String((r as Record<string, unknown>).status ?? '').toLowerCase() !== 'inactive')
          .map(r => {
            const extra: Record<string, unknown> = {};
            opts?.extraKeys?.forEach(k => { extra[k] = (r as Record<string, unknown>)[k]; });
            return {
              value: String(r.id),
              label: String((r as Record<string, unknown>)[labelKey] ?? ''),
              extra,
            };
          });
      } catch {
        return [];
      }
    };

    /* Vendor master ships its own paginated endpoint, not /master/*.
       We pull every vendor (no status filter) so both Active and
       Inactive rows show up in the Step-2 dropdown — the user may
       legitimately want to map a draft/inactive vendor, after which
       the vendor flips to Active. */
    const fetchVendors = async (): Promise<VendorOpt[]> => {
      try {
        type VRow = {
          id: number | string;
          vendor_code?: string | null;
          company_name?: string | null;
          website?: string | null;
          primary_email?: string | null;
          status?: string | null;
          primary_address?: {
            contact_name?: string | null;
            contact_no?: string | null;
            email?: string | null;
            designation?: string | null;
          } | null;
        };
        const res = await api.get<{ data?: VRow[] } | VRow[]>('/vendors?per_page=500');
        const rows: VRow[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        return rows.map(r => ({
          id:          String(r.id),
          code:        String(r.vendor_code ?? ''),
          name:        String(r.company_name ?? ''),
          website:     String(r.website ?? ''),
          contact:     String(r.primary_address?.contact_name ?? ''),
          phone:       String(r.primary_address?.contact_no ?? ''),
          email:       String(r.primary_address?.email ?? r.primary_email ?? ''),
          designation: String(r.primary_address?.designation ?? ''),
          status:      String(r.status ?? '').toLowerCase(),
        }));
      } catch { return []; }
    };

    (async () => {
      const [seg, hz, uo, hs, co, pk, gst, vd] = await Promise.all([
        fetchMaster('segments',           'title'),
        fetchMaster('haz_class',          'name'),
        fetchMaster('uom',                'title', { extraKeys: ['short_code', 'unit_type'] }),
        fetchMaster('hsn_codes',          'hsn_code', { extraKeys: ['description'] }),
        fetchMaster('conditions',         'title'),
        fetchMaster('packaging_material', 'title'),
        fetchMaster('gst_percentage',     'percentage', { extraKeys: ['percentage'] }),
        fetchVendors(),
      ]);
      setOptSegments(seg);
      setOptHazClasses(hz);
      setOptUoms(uo.map(o => ({ ...o, label: o.label + (o.extra?.short_code ? ` (${o.extra.short_code})` : '') })));
      setOptHsn(hs.map(o => ({ ...o, label: o.label + (o.extra?.description ? ` — ${String(o.extra.description).slice(0, 40)}` : '') })));
      setOptConditions(co);
      setOptPackaging(pk);
      setOptGst(gst.map(o => ({ ...o, label: `${o.label}%` })));
      setVendorOpts(vd);
    })();
  }, []);

  /**
   * Called by the MasterQuickAddPopup after a successful POST. Pushes
   * the new row into the matching opt* list and selects it on the
   * dropdown that triggered the popup, so the user can keep typing
   * without manually reopening the select.
   */
  const onMasterAdded = (slug: MasterSlug, row: Record<string, unknown>) => {
    const id = String(row.id ?? '');
    if (!id) return;
    const labelOf = (key: string) => String(row[key] ?? '');
    switch (slug) {
      case 'segments':
        setOptSegments(prev => [...prev, { value: id, label: labelOf('title') }]);
        setSegmentId(id);
        clearFieldError('segmentId');
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
      case 'gst_percentage':
        setOptGst(prev => [...prev, { value: id, label: `${labelOf('percentage')}%`, extra: { percentage: row.percentage } }]);
        setGstId(id);
        clearFieldError('gstId');
        break;
    }
  };

  /* ─── If editing, load the product and prefill ─── */
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
          base_price?: string | number; gst_id?: number; mark_bottom?: string;
          net_weight?: string | number; gross_weight?: string | number;
          length_cm?: string | number; width_cm?: string | number; height_cm?: string | number;
          step_completed?: number;
          qc_records?: Array<{ id: number; qc_name: string; qc_purpose?: string; issued_by?: string; qa_testing_parameter?: string; min_acceptance_criteria?: string; attachment_path?: string; attachment_url?: string | null }>;
          vendor_maps?: Array<Record<string, unknown>>;
        };
        const res = await api.get<ProductDto>(`/products/${initialId}`);
        const p = res.data;
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
          attachmentName: q.attachment_path ? q.attachment_path.split('/').pop() ?? '' : '',
          attachmentUrl: q.attachment_url ?? (q.attachment_path ? resolveFileUrl(q.attachment_path) : ''),
          attachmentPath: q.attachment_path ?? '',
          attachmentFile: null,
        })));
        setVendors((p.vendor_maps ?? []).map(v => ({
          id: String(v.id),
          vendorId: (v as Record<string, unknown>).vendor_id ? String((v as Record<string, unknown>).vendor_id) : '',
          productCode: p.product_code ?? '',
          vendorCode: String(v.vendor_code ?? ''),
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

        // Wizard starts at Core (the useState defaults already do this)
        // and all three tabs are pre-unlocked via reachedTabs's initial
        // value when initialId is set. Resetting step/tab here would
        // override the user if they Save&Next'd while the prefill was
        // still loading — that was the source of the "stuck on Core"
        // glitch reported from the Single Product View edit flow.
      } catch {
        toast.error('Not found', 'Failed to load product. Closing…');
        setTimeout(onClose, 1200);
      } finally {
        setLoadingEdit(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  /* ──────────────────────────────────────────────────────────────────
   * Per-step save handlers
   *
   * Each "Save & Next" call writes the relevant slice to the server and
   * advances the wizard only after a 2xx response. If the call fails we
   * keep the user on the current tab so they can correct the error.
   * ────────────────────────────────────────────────────────────── */
  const saveCore = async () => {
    // Per-field validation — collect errors keyed by field so the matching
    // `Field` wrapper can render a red border + inline message.
    const errs: Record<string, string> = {};
    if (!name.trim())            errs.name              = 'Product name is required';
    if (!genericName.trim())     errs.genericName       = 'Generic name is required';
    if (!description.trim())     errs.description       = 'Printable description is required';
    if (!brand.trim())           errs.brand             = 'Make / Brand / Specifications is required';
    if (!segmentId)              errs.segmentId         = 'Segment is required';
    if (!hazType)                errs.hazType           = 'Haz / Non-Haz is required';
    if (hazType === 'Haz' && !hazClassId) errs.hazClassId = 'Haz Class is required when Haz Type is Haz';
    if (!uomId)                  errs.uomId             = 'UOM is required';
    if (!hsnId)                  errs.hsnId             = 'HSN / SAC Code is required';
    if (!conditionId)            errs.conditionId       = 'Condition is required';
    if (!packagingMaterialId)    errs.packagingMaterialId = 'Packaging Material is required';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      // Always send multipart so file uploads work; Laravel handles either
      // JSON or multipart against the same validation rules.
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

      // Primary image: send the kept-path if any, plus the new file if one
      // was just picked. Backend prefers the file when both are present.
      fd.append('primary_image', primaryImagePath ?? '');
      if (primaryImageFile) fd.append('primary_image_file', primaryImageFile);

      // Secondary images: kept paths as a repeating field + new files.
      secondaryImagePaths.forEach(p => fd.append('secondary_images[]', p));
      secondaryImageFiles.forEach(f => fd.append('secondary_image_files[]', f));

      const res = await api.post<{
        id: number; product_code?: string;
        primary_image?: string | null; secondary_images?: string[] | null;
        primary_image_url?: string | null; secondary_images_url?: string[] | null;
        step_completed?: number;
      }>(
        '/products/step/core',
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      // Mirror the persisted state — pending files have now become paths.
      setProductId(res.data.id);
      setProductCodeFromApi(res.data.product_code ?? '');
      setPrimaryImagePath(res.data.primary_image ?? null);
      setPrimaryImageUrl(res.data.primary_image_url ?? (res.data.primary_image ? resolveFileUrl(res.data.primary_image) : null));
      setPrimaryImageFile(null);
      setSecondaryImagePaths(res.data.secondary_images ?? []);
      setSecondaryImageUrls(res.data.secondary_images_url ?? (res.data.secondary_images ?? []).map(s => resolveFileUrl(s)));
      setSecondaryImageFiles([]);

      onSaved(res.data.id, false);
      toast.success('Core saved', 'Product Core Information saved');
      markTabReached('sales');
      setTab('sales');
    } catch (e: unknown) {
      const msg = extractError(e, 'Failed to save Core information.');
      toast.error('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const saveSales = async () => {
    if (!productId) {
      toast.error('Step blocked', 'Save Core information first.'); return;
    }
    const errs: Record<string, string> = {};
    if (!basePrice || basePriceNum <= 0) errs.basePrice  = 'Selling Price is required (must be greater than 0)';
    if (!gstId)                          errs.gstId      = 'GST % is required';
    if (!markBottom)                     errs.markBottom = 'Mark Bottom / Non Bottom is required';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
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
      onSaved(productId, false);
      toast.success('Sales saved', 'Pricing and GST saved');
      markTabReached('quality');
      setTab('quality');
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
    // Gross must exceed Net — gross includes packaging weight on top of
    // the net product weight, so they can't be equal or inverted.
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
      /* Switch the request to multipart only when a QC row carries a
         newly-picked File. Pure-text saves stay on the JSON path so
         existing call sites don't pay the multipart overhead.
         Laravel reads array-indexed file inputs as
         `qc_records.{idx}.attachment_file`. */
      const hasNewFiles = qcRecords.some(q => q.attachmentFile instanceof File);
      const qcRows = qcRecords.map(q => ({
        qc_name: q.name,
        qc_purpose: q.purpose,
        issued_by: q.issuedBy,
        qa_testing_parameter: q.testingParameter,
        min_acceptance_criteria: q.minAcceptance,
        // Keep the existing server-side path when the user didn't
        // replace the attachment on this open of the modal. The
        // backend overrides with the multipart upload path below.
        attachment_path: q.attachmentPath || (q.attachmentFile ? null : (q.attachmentName || null)),
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

      if (hasNewFiles) {
        const fd = new FormData();
        // Laravel needs a method override since the route is PUT.
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
        await api.post(`/products/${productId}/step/quality`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.put(`/products/${productId}/step/quality`, {
          ...qualityFields,
          qc_records: qcRows,
        });
      }

      // Clear the in-memory File objects — on the next save the row
      // should be treated as having no fresh file picked, so we don't
      // re-upload the same blob.
      setQcRecords(prev => prev.map(q => ({ ...q, attachmentFile: null })));

      // Step 1 fully complete — product is now Inactive on the server.
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

  const saveVendorsAndFinish = async () => {
    if (!productId) {
      toast.error('Step blocked', 'Save Core information first.'); return;
    }
    if (vendors.length === 0) {
      toast.error('No vendors mapped', 'Map at least one vendor before saving the product.');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      await api.put(`/products/${productId}/step/vendors`, {
        vendors: vendors.map(v => ({
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
      onSaved(productId, true);
      toast.success('Product saved', 'Vendors mapped — product is now Active');
    } catch (e: unknown) {
      const msg = extractError(e, 'Failed to save vendors.');
      toast.error('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    // Backdrop click intentionally does NOT close the wizard — the
    // user has multi-step form data in flight; an accidental click
    // outside would wipe everything. The Cancel button and the
    // top-right X are the only dismissal paths.
    <div className="apm-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="apm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ─── Gradient header ─── */}
        <div className="apm-head">
          <div className="apm-head-left">
            <div className="apm-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div>
              <div className="apm-title">
                {step === 2
                  ? 'Map Product Vendor'
                  : (initialId ? 'Edit Product' : 'Add Product')}
              </div>
              <div className="apm-sub">
                {step === 2
                  ? 'Link this product to one or more vendors with purchase pricing.'
                  : (initialId
                      ? 'Update product details — identity, pricing, compliance and dimensions.'
                      : 'Add complete product details — identity, pricing, compliance and dimensions.')}
              </div>
            </div>
          </div>
          <button className="apm-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* ─── Step strip — two pill cards side by side ─── */}
        <div className="apm-stepper">
          <StepperItem n={1} title="Product Information" sub="Identity, pricing, compliance" current={step} icon={<i className="ri-home-line" />} />
          <StepperItem n={2} title="Map Product Vendor"  sub="Link vendors with pricing"    current={step} icon={<i className="ri-shield-check-line" />} />
        </div>

        {/* ─── Body ─── */}
        <div className="apm-body">
          {step === 1 && (
            <>
              {/* Previous stages summary — visible once user moves past Core */}
              {tab !== 'core' && (
                <PreviousStages
                  open={previousOpen}
                  onToggle={() => setPreviousOpen(v => !v)}
                  completed={tab === 'sales' ? 1 : 2}
                  total={3}
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

              <div className="apm-tabs">
                {(['core', 'sales', 'quality'] as Tab[]).map(t => {
                  const labels: Record<Tab, string> = { core: 'Product Core Information', sales: 'For Sales Department', quality: 'Quality & Compliance' };
                  const locked = !canSwitchToTab(t);
                  return (
                    <button
                      key={t}
                      className={`apm-tab ${tab === t ? 'on' : ''}${locked ? ' is-locked' : ''}`}
                      onClick={() => {
                        if (locked) {
                          toast.error('Locked', 'Complete the previous step with "Save & Next" to unlock this tab.');
                          return;
                        }
                        setTab(t);
                      }}
                      title={locked ? 'Locked — complete the previous step first' : undefined}
                    >
                      {labels[t]}{locked && <i className="ri-lock-line" style={{ marginLeft: 6, fontSize: 12 }} />}
                    </button>
                  );
                })}
              </div>

              {tab === 'core' && (
                <SectionCard
                  tone="blue"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                  }
                  title="Product Core Information"
                  subtitle="Basic identity, classification and media"
                >
                  <div className="apm-grid-2">
                    <Field label="Product Name" required icon={<i className="ri-product-hunt-line" />} error={fieldErrors.name}>
                      <input className="apm-input apm-input-mf" placeholder="Enter product name" value={name} onChange={e => { setName(e.target.value); clearFieldError('name'); }} />
                    </Field>
                    <Field label="Generic Name" required icon={<i className="ri-price-tag-3-line" />} error={fieldErrors.genericName}>
                      <input className="apm-input apm-input-mf" placeholder="Enter generic name" value={genericName} onChange={e => { setGenericName(e.target.value); clearFieldError('genericName'); }} />
                    </Field>
                  </div>

                  <Field label="Product Printable Description" required icon={<i className="ri-file-text-line" />} error={fieldErrors.description}>
                    <textarea className="apm-input apm-input-mf apm-textarea" placeholder="Enter printable description" value={description} onChange={e => { setDescription(e.target.value); clearFieldError('description'); }} rows={3} />
                  </Field>

                  <div className="apm-grid-2">
                    <Field label="Make / Brand / Specifications" required icon={<i className="ri-store-2-line" />} error={fieldErrors.brand}>
                      <input className="apm-input apm-input-mf" placeholder="Make / Brand / Specifications" value={brand} onChange={e => { setBrand(e.target.value); clearFieldError('brand'); }} />
                    </Field>
                    <Field label="Segment" required addNew onAdd={() => setQuickAdd('segments')} error={fieldErrors.segmentId}>
                      <SelectInput value={segmentId} onChange={(v) => { setSegmentId(v); clearFieldError('segmentId'); }} placeholder="Select" options={optSegments} />
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

                  <div className="apm-inner-section">
                    <div className="apm-inner-title">PRODUCT GENERAL INFORMATION</div>
                    <div className="apm-grid-3">
                      <Field label="Haz / Non Haz" required error={fieldErrors.hazType}>
                        <SelectInput
                          value={hazType}
                          onChange={(v) => {
                            setHazType(v);
                            clearFieldError('hazType');
                            // Switching away from Haz wipes any previously
                            // picked Haz Class so we never persist a stale
                            // (and now hidden) classification.
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
                    <div className="apm-grid-2 apm-inv-conf-row">
                      <div className="apm-inv-grid">
                        <Field label="Batch No" icon={<i className="ri-hashtag" />}>
                          <input className="apm-input apm-input-mf" placeholder="Optional" value={batchNo} onChange={e => setBatchNo(e.target.value)} />
                        </Field>
                        <Field label="Serial No" icon={<i className="ri-barcode-line" />}>
                          <input className="apm-input apm-input-mf" placeholder="Optional" value={serialNo} onChange={e => setSerialNo(e.target.value)} />
                        </Field>
                        <Field label="Cat No" icon={<i className="ri-price-tag-3-line" />}>
                          <input className="apm-input apm-input-mf" placeholder="Optional" value={catNo} onChange={e => setCatNo(e.target.value)} />
                        </Field>
                        <Field label="Lot No" icon={<i className="ri-list-check-2" />}>
                          <input className="apm-input apm-input-mf" placeholder="Optional" value={lotNo} onChange={e => setLotNo(e.target.value)} />
                        </Field>
                      </div>
                      <Field label="Confidential Info" icon={<i className="ri-lock-2-line" />}>
                        <textarea className="apm-input apm-input-mf apm-textarea apm-conf-textarea" placeholder="Confidential information" value={confidential} onChange={e => setConfidential(e.target.value)} rows={6} />
                      </Field>
                    </div>
                  </div>
                </SectionCard>
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
                    <Field label="GST %" required addNew onAdd={() => setQuickAdd('gst_percentage')} error={fieldErrors.gstId}>
                      <SelectInput value={gstId} onChange={(v) => { setGstId(v); clearFieldError('gstId'); }} placeholder="Select" options={optGst} />
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
                  <Field label="Mark Bottom / Non Bottom" required error={fieldErrors.markBottom}>
                    <SelectInput value={markBottom} onChange={(v) => { setMarkBottom(v); clearFieldError('markBottom'); }} placeholder="Select" options={BOTTOM_OPTIONS} />
                  </Field>
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
                    subtitle="Quality standards and compliance certifications"
                    headerAction={
                      <button className="apm-section-add-btn" onClick={openQcModal}>
                        <span>+</span> Add QC
                      </button>
                    }
                  >
                    {qcRecords.length === 0 ? (
                      <div className="apm-empty">No QC records. Click "Add QC" to begin.</div>
                    ) : (
                      <div className="table-responsive table-card border rounded">
                        <table className="table align-middle table-nowrap mb-0">
                          <thead className="table-light">
                            <tr>
                              <th scope="col">Sr No</th>
                              <th scope="col">QC Name</th>
                              <th scope="col">QC Purpose</th>
                              <th scope="col">Issued By</th>
                              <th scope="col">QA Testing Parameter</th>
                              <th scope="col">Min Acceptance Criteria</th>
                              <th scope="col">Attachments</th>
                              <th scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {qcRecords.map((q, i) => (
                              <tr key={q.id}>
                                <td><span className="text-muted fs-13">{i + 1}</span></td>
                                <td><span className="fw-semibold text-primary fs-13">{q.name}</span></td>
                                <td><span className="fs-13">{q.purpose}</span></td>
                                <td><span className="fs-13">{q.issuedBy}</span></td>
                                <td>
                                  <span className="fs-13 d-inline-block text-truncate" style={{ maxWidth: 220 }} title={q.testingParameter}>
                                    {q.testingParameter || <span className="text-muted">—</span>}
                                  </span>
                                </td>
                                <td>
                                  <span className="fs-13 d-inline-block text-truncate" style={{ maxWidth: 220 }} title={q.minAcceptance}>
                                    {q.minAcceptance || <span className="text-muted">—</span>}
                                  </span>
                                </td>
                                <td>
                                  {q.attachmentName ? (
                                    q.attachmentUrl ? (
                                      <a
                                        href={q.attachmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="fs-13 d-inline-block text-truncate"
                                        style={{ maxWidth: 200, color: '#4338ca', textDecoration: 'underline', cursor: 'pointer' }}
                                        title={`Open ${q.attachmentName}`}
                                      >
                                        <i className="ri-attachment-line me-1" />
                                        {q.attachmentName}
                                      </a>
                                    ) : (
                                      <span className="fs-13 d-inline-block text-truncate" style={{ maxWidth: 200 }} title={q.attachmentName}>
                                        <i className="ri-attachment-line text-muted me-1" />
                                        {q.attachmentName}
                                      </span>
                                    )
                                  ) : <span className="text-muted fs-13">—</span>}
                                </td>
                                <td>
                                  <div className="d-flex gap-1">
                                    <QcActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => openQcViewer(q)} disabled={!q.attachmentUrl} />
                                    <QcActionBtn title="Edit"   icon="ri-pencil-line"     color="info"    onClick={() => openQcEdit(q)} />
                                    <QcActionBtn title="Delete" icon="ri-delete-bin-line" color="danger"  onClick={() => setQcDeleteTarget(q)} />
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {/* All Step-1 data carried into Step 2 */}
              <PreviousStages
                open={previousOpen}
                onToggle={() => setPreviousOpen(v => !v)}
                completed={3}
                total={3}
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
                  {
                    name: 'SALES CONFIG',
                    tone: 'amber',
                    fields: [
                      { label: 'Base Price',  value: basePrice ? `₹${basePriceNum}` : '—' },
                      { label: 'GST %',       value: gstPctStr || '—' },
                      { label: 'GST Amount',  value: gstAmt ? `₹${gstAmt}` : '—' },
                      { label: 'Total Price', value: totalPrice ? `₹${totalPrice}` : '—' },
                      { label: 'Mark Bottom', value: markBottom || '—' },
                    ],
                  },
                  {
                    name: 'QUALITY & COMPLIANCE',
                    tone: 'green',
                    fields: [
                      { label: 'Net Weight',   value: netWeight   ? `${netWeight} kg` : '—' },
                      { label: 'Gross Weight', value: grossWeight ? `${grossWeight} kg` : '—' },
                      { label: 'Length',       value: length ? `${length} cm` : '—' },
                      { label: 'Width',        value: width  ? `${width} cm`  : '—' },
                      { label: 'Height',       value: height ? `${height} cm` : '—' },
                      { label: 'QC Records',   value: String(qcRecords.length) },
                    ],
                  },
                ]}
              />

              {!vendorDraftOpen && (
                <div className="apm-vendor-toolbar">
                  <div className="apm-vendor-toolbar-title">Map Product Vendor</div>
                  <button className="apm-btn-primary" onClick={() => setVendorDraftOpen(true)}>
                    <span>+</span> Map New Vendor
                  </button>
                </div>
              )}

              {vendorDraftOpen && (
                <SectionCard
                  tone="navy"
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>}
                  title="Map Product Vendor"
                  subtitle="Select a vendor and enter purchase pricing"
                  headerAction={
                    <button className="apm-btn-outline">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                      Add Vendor
                    </button>
                  }
                >
                  <div className="apm-grid-2">
                    <Field label="Select Vendor" required>
                      <SelectInput value={vendorSelectedCode} onChange={setVendorSelectedCode} placeholder="Select vendor"
                        options={vendorOpts.map(v => ({
                          value: v.code,
                          label: `${v.code} — ${v.name}${v.status && v.status !== 'active' ? ` (${v.status.charAt(0).toUpperCase()}${v.status.slice(1)})` : ''}`,
                        }))}
                      />
                    </Field>
                    <span />
                  </div>

                  {/* Read-only vendor info grid */}
                  <div className="apm-vendor-info">
                    <InfoCell label="Vendor Code"          value={vendorSelected?.code   ?? 'NA'} />
                    <InfoCell label="Vendor Company Name"  value={vendorSelected?.name   ?? 'NA'} />
                    <InfoCell label="Company Website"      value={vendorSelected?.website ?? 'NA'} />
                    <InfoCell label="Contact person name" value={vendorSelected?.contact ?? 'NA'} />
                    <InfoCell label="Contact no"           value={vendorSelected?.phone  ?? 'NA'} />
                    <InfoCell label="Email ID"             value={vendorSelected?.email  ?? 'NA'} />
                    <InfoCell label="Designation"          value={vendorSelected?.designation ?? 'NA'} />
                    <InfoCell label="Attachments"          value="—" />
                  </div>

                  <div className="apm-grid-4">
                    <Field label="Purchase Price" required>
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix" type="number" placeholder="0.00" value={vendorPurchasePrice} onChange={e => setVendorPurchasePrice(e.target.value)} />
                      </div>
                    </Field>
                    {/* GST% is inherited from the product's Sales Config
                        step — locked here so a vendor mapping can never
                        carry a different rate than the parent product. */}
                    <Field label="GST %">
                      <input
                        className="apm-input apm-readonly"
                        value={gstPctStr || '—'}
                        readOnly
                        title="GST % comes from the product's Sales Config (Step 2)"
                      />
                    </Field>
                    <Field label="GST Amount">
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix apm-readonly" value={vendorGsta.toFixed(2)} readOnly />
                      </div>
                    </Field>
                    <Field label="Total Amount">
                      <div className="apm-input-icon">
                        <span className="apm-input-icon-prefix">₹</span>
                        <input className="apm-input has-prefix apm-readonly apm-total" value={vendorTota.toFixed(2)} readOnly />
                      </div>
                    </Field>
                  </div>

                  <div className="apm-grid-2">
                    <Field label="Map Date" icon={<i className="ri-calendar-line" />}>
                      <div className="apm-master-date">
                        <MasterDatePicker
                          value={vendorMapDate}
                          onChange={setVendorMapDate}
                          placeholder="Select date"
                        />
                      </div>
                    </Field>
                    <Field label="Remarks" icon={<i className="ri-chat-3-line" />}>
                      <textarea className="apm-input apm-input-mf apm-textarea" placeholder="Enter remarks" value={vendorRemarks} onChange={e => setVendorRemarks(e.target.value)} rows={2} />
                    </Field>
                  </div>

                  <div className="apm-vendor-draft-foot">
                    <button className="apm-btn-primary" onClick={saveVendorDraft} disabled={!vendorSelected || !vendorPp}>
                      Save Vendor
                    </button>
                    <button className="apm-btn-ghost" onClick={() => setVendorDraftOpen(false)}>Cancel</button>
                  </div>
                </SectionCard>
              )}

              {/* Mapped vendor table — same shell as the Clients master table */}
              {vendors.length > 0 && (
                <div className="apm-vendor-table-card">
                  <div className="apm-vendor-table-head">
                    <div className="apm-vendor-table-title">
                      <i className="ri-links-line" />
                      Mapped Vendors
                      <span className="apm-vendor-table-count">{vendors.length}</span>
                    </div>
                  </div>
                  <div className="table-responsive table-card border rounded">
                    <table className="table align-middle table-nowrap mb-0">
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Sr No</th>
                          <th scope="col">Product/Vendor Code</th>
                          <th scope="col">Vendor Company Name</th>
                          <th scope="col">Company Website</th>
                          <th scope="col">Purchase Price</th>
                          <th scope="col">GST %</th>
                          <th scope="col">GST Amount</th>
                          <th scope="col">Total Amount</th>
                          <th scope="col">Map Date</th>
                          <th scope="col">Remarks</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendors.map((v, i) => (
                          <tr key={v.id}>
                            <td><span className="text-muted fs-13">{i + 1}</span></td>
                            <td><span className="fw-medium text-primary font-monospace fs-13">{v.productCode}/{v.vendorCode}</span></td>
                            <td><span className="fw-semibold fs-13">{v.vendorName}</span></td>
                            <td>
                              {v.website ? (
                                <a href={`https://${v.website}`} target="_blank" rel="noreferrer" className="text-body text-decoration-none d-inline-flex align-items-center gap-1">
                                  <i className="ri-global-line text-muted fs-13" />
                                  <span className="fs-13">{v.website}</span>
                                </a>
                              ) : <span className="text-muted fs-13">—</span>}
                            </td>
                            <td><span className="fw-medium fs-13">₹{v.purchasePrice.toLocaleString()}</span></td>
                            <td><span className="fs-13">{v.gstPct.toFixed(2)}%</span></td>
                            <td><span className="fs-13">₹{v.gstAmt.toFixed(2)}</span></td>
                            <td><span className="text-success fw-semibold fs-13">₹{v.totalAmt.toLocaleString()}</span></td>
                            <td>
                              <span className="d-inline-flex align-items-center gap-1 fs-13">
                                <i className="ri-calendar-line text-muted" />
                                <span>{v.mapDate}</span>
                              </span>
                            </td>
                            <td><span className="fs-13">{v.remarks || <span className="text-muted">—</span>}</span></td>
                            <td>
                              <div className="hstack gap-1">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-soft-primary"
                                  title="Edit"
                                  aria-label="Edit"
                                >
                                  <i className="ri-pencil-line" />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-soft-danger"
                                  onClick={() => removeVendor(v.id)}
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <i className="ri-delete-bin-line" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="apm-foot">
          <div className="apm-foot-left">
            <button className="apm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          </div>
          <div className="apm-foot-right">
            {(step === 2 || (step === 1 && tab !== 'core')) && (
              <button
                className="apm-btn-outline"
                disabled={saving}
                onClick={() => {
                  if (step === 2)              { setStep(1); setTab('quality'); }
                  else if (tab === 'quality')  { setTab('sales'); }
                  else if (tab === 'sales')    { setTab('core'); }
                }}
              >
                ← Previous
              </button>
            )}
            {step === 2 ? (
              <button className="apm-btn-primary" onClick={saveVendorsAndFinish} disabled={saving || loadingEdit}>
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
                disabled={saving || loadingEdit}
                onClick={() => {
                  if (tab === 'core')         saveCore();
                  else if (tab === 'sales')   saveSales();
                  else if (tab === 'quality') saveQuality();
                }}
              >
                {saving ? <span className="apm-spinner" /> : null}
                {saving ? 'Saving…' : <>Save &amp; Next →</>}
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

      {quickAdd && (
        <MasterQuickAddPopup
          slug={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(row) => {
            onMasterAdded(quickAdd, row);
            setQuickAdd(null);
          }}
        />
      )}
    </div>
  ), document.body);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sub-components
 * ────────────────────────────────────────────────────────────────────── */
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
          <div>
            <div className="apm-section-title">{props.title}</div>
            <div className="apm-section-sub">{props.subtitle}</div>
          </div>
        </div>
        {props.headerAction}
      </div>
      <div className="apm-section-body">{props.children}</div>
    </div>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  addNew?: boolean;
  onAdd?: () => void;
  icon?: ReactNode;
  error?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`apm-field${props.error ? ' has-error' : ''}${props.disabled ? ' is-disabled' : ''}`}>
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
      </span>
      {props.icon ? (
        <div className="apm-master-field">
          <span className="apm-master-field-icon">{props.icon}</span>
          {props.children}
        </div>
      ) : props.children}
      {props.error && (
        <span className="apm-field-error">
          <i className="ri-error-warning-line" /> {props.error}
        </span>
      )}
    </label>
  );
}

type Opt = string | { value: string; label: string };
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
}) {
  return (
    <label className="apm-field apm-upload-field">
      <span className="apm-field-label">
        {props.label} {props.required && <span className="apm-req">*</span>}
      </span>
      <div className="apm-dropzone">
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
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
      </div>
      {props.preview.length > 0 && (
        <div className="apm-upload-preview">
          {props.preview.map((src, i) => (
            <div key={i} className="apm-upload-chip">
              <img src={src} alt="" />
              <button type="button" onClick={(e) => { e.preventDefault(); props.onRemove(i); }} aria-label="Remove">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </label>
  );
}

function InfoCell(props: { label: string; value: string }) {
  return (
    <div className="apm-info-cell">
      <span className="apm-info-key">{props.label}:</span>
      <span className="apm-info-val">{props.value}</span>
    </div>
  );
}

type PrevStage = {
  name: string;
  tone: 'violet' | 'amber' | 'green';
  fields: { label: string; value: string }[];
};

function PreviousStages(props: {
  open: boolean;
  onToggle: () => void;
  completed: number;
  total: number;
  stages: PrevStage[];
}) {
  return (
    <div className="apm-prev">
      <div className="apm-prev-head">
        <div className="apm-prev-title">
          <span className="apm-prev-check">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          What you did in previous stages
          <span className="apm-prev-chip">Stage {props.completed} of {props.total} Complete</span>
        </div>
        <button className="apm-prev-toggle" onClick={props.onToggle}>{props.open ? 'Hide' : 'Show'}</button>
      </div>
      {props.open && (
        <div className="apm-prev-body">
          {props.stages.map(s => (
            <div key={s.name} className={`apm-prev-stage tone-${s.tone}`}>
              <div className="apm-prev-stage-label">⊕ {s.name}</div>
              <div className="apm-prev-grid">
                {s.fields.map(f => (
                  <div key={f.label} className="apm-prev-field">
                    <div className="apm-prev-field-label">{f.label}</div>
                    {/* `title` exposes the full value as a native tooltip
                        when the cell truncates — cheap and a11y-friendly. */}
                    <div className="apm-prev-field-value" title={f.value}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * QC Add popup — opens above the parent modal
 * ────────────────────────────────────────────────────────────────────── */
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
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft({ ...draft, [key]: value });

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      /* Build an in-memory blob URL right away so the freshly-added
         row's "View Attachment" link works before the file is saved
         to the server. The server URL replaces this on the next
         /products/{id} prefill once Save Quality finishes uploading. */
      const previewUrl = URL.createObjectURL(f);
      setDraft({
        ...draft,
        attachmentName: f.name,
        attachmentFile: f,
        attachmentUrl: previewUrl,
      });
    }
  };

  return createPortal((
    <div className="apm-qc-backdrop" onClick={onClose}>
      <div className="apm-qc-popup" onClick={(e) => e.stopPropagation()}>
        <div className="apm-qc-popup-head">
          <div className="apm-qc-popup-title">
            <i className="ri-shield-check-line" />
            {isEdit ? 'Edit QC Record' : 'Add QC Record'}
          </div>
          <button className="apm-close apm-qc-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Product summary strip */}
        <div className="apm-qc-product-bar">
          <QcProd label="Product Code"  value={product.code} />
          <QcProd label="Product Name"  value={product.name} />
          <QcProd label="Generic Name"  value={product.generic} />
          <QcProd label="HSN/SAC Code"  value={product.hsn} />
          <QcProd label="Segment"       value={product.segment} />
          <QcProd label="Haz/Non-Haz"   value={product.hazType} />
          <QcProd label="Haz Class"     value={product.hazClass} />
          <QcProd label="Product Vendors" value={String(product.vendorCount)} accent />
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
            <Field label="Issued By" required icon={<i className="ri-government-line" />}>
              <input className="apm-input apm-input-mf" placeholder="Authority" value={draft.issuedBy} onChange={e => set('issuedBy', e.target.value)} />
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

          <Field label="QC Purpose" required icon={<i className="ri-file-list-3-line" />}>
            <input className="apm-input apm-input-mf" placeholder="Certificate of Analysis" value={draft.purpose} onChange={e => set('purpose', e.target.value)} />
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

/* ──────────────────────────────────────────────────────────────────────────
 * Master Quick-Add popup — opens above the wizard when a "+" button is
 * clicked next to a master-backed field. Posts the new row directly to
 * /api/master/{slug} and hands the result back to the wizard so the
 * dropdown can refresh + auto-select it.
 *
 * Each slug declares its own minimal field list. Status is always sent
 * as "Active" so the new row immediately shows up in the dropdown
 * filter (which strips Inactive rows).
 * ────────────────────────────────────────────────────────────────────── */
type QuickAddSlug = 'segments' | 'haz_class' | 'uom' | 'hsn_codes' | 'conditions' | 'packaging_material' | 'gst_percentage';
type QaField = { name: string; label: string; type?: 'text' | 'number'; required?: boolean; placeholder?: string };

const QUICK_ADD_SCHEMAS: Record<QuickAddSlug, { title: string; fields: QaField[] }> = {
  segments:           { title: 'Add Segment',            fields: [{ name: 'title', label: 'Segment Name', required: true, placeholder: 'e.g. Dry Fruits' }] },
  haz_class:          { title: 'Add Haz Class',          fields: [{ name: 'name',  label: 'Haz Class Name', required: true, placeholder: 'e.g. Class 3 - Flammable Liquids' }] },
  uom:                { title: 'Add Unit of Measurement', fields: [
                          { name: 'title',      label: 'Title', required: true, placeholder: 'e.g. Kilogram' },
                          { name: 'short_code', label: 'Short Code', required: true, placeholder: 'e.g. KG' },
                          { name: 'unit_type',  label: 'Unit Type', placeholder: 'e.g. Weight / Volume / Count' },
                        ] },
  hsn_codes:          { title: 'Add HSN / SAC Code',     fields: [
                          { name: 'hsn_code',    label: 'HSN / SAC Code', required: true, placeholder: 'e.g. 08013100' },
                          { name: 'description', label: 'Description', placeholder: 'Brief description' },
                        ] },
  conditions:         { title: 'Add Condition',          fields: [{ name: 'title', label: 'Condition Name', required: true, placeholder: 'e.g. New, Refurbished' }] },
  packaging_material: { title: 'Add Packaging Material', fields: [
                          { name: 'title',         label: 'Title', required: true, placeholder: 'e.g. Carton Box' },
                          { name: 'material_type', label: 'Material Type', placeholder: 'e.g. Cardboard' },
                        ] },
  gst_percentage:     { title: 'Add GST Percentage',     fields: [{ name: 'percentage', label: 'GST %', type: 'number', required: true, placeholder: 'e.g. 18' }] },
};

function MasterQuickAddPopup(props: {
  slug: QuickAddSlug;
  onClose: () => void;
  onSaved: (row: Record<string, unknown>) => void;
}) {
  const { slug, onClose, onSaved } = props;
  const toast = useToast();
  const schema = QUICK_ADD_SCHEMAS[slug];
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => {
    setValues(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    schema.fields.forEach(f => {
      if (f.required && !(values[f.name] ?? '').toString().trim()) {
        errs[f.name] = `${f.label} is required`;
      }
    });
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...values, status: 'Active' };
      // Numeric fields go in as Number so the master accepts the schema cast.
      schema.fields.forEach(f => {
        if (f.type === 'number' && payload[f.name] !== undefined) {
          payload[f.name] = Number(payload[f.name]);
        }
      });
      const res = await api.post<Record<string, unknown>>(`/master/${slug}`, payload);
      toast.success('Saved', `${schema.title.replace('Add ', '')} added`);
      onSaved(res.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
      const fieldErr = err?.response?.data?.errors;
      if (fieldErr) {
        const flat: Record<string, string> = {};
        Object.entries(fieldErr).forEach(([k, v]) => { if (v?.[0]) flat[k] = v[0]; });
        setErrors(flat);
      }
      toast.error('Save failed', err?.response?.data?.message || `Could not add to ${slug}`);
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="apm-qa-backdrop" onClick={onClose}>
      <div className="apm-qa-popup" onClick={(e) => e.stopPropagation()}>
        <div className="apm-qa-head">
          <div className="apm-qa-title">
            <i className="ri-add-circle-line" /> {schema.title}
          </div>
          <button className="apm-close apm-qa-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="apm-qa-body">
          {schema.fields.map(f => (
            <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]}>
              <input
                className="apm-input"
                type={f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder ?? ''}
                value={values[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="apm-qa-foot">
          <button className="apm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="apm-btn-primary" onClick={submit} disabled={saving}>
            {saving ? <span className="apm-spinner" /> : <i className="ri-save-line" />} Save
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

/* ──────────────────────────────────────────────────────────────────────────
 * Scoped CSS — light + dark mode
 * ────────────────────────────────────────────────────────────────────── */
const SCOPED_CSS = `
.apm-backdrop {
  position: fixed; inset: 0;
  /* Above Velzon topbar (1002) and vertical-menu overlays (1003-1004). */
  z-index: 1090;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.apm-modal {
  width: 100%; max-width: 1360px;
  max-height: calc(100vh - 48px);
  margin: auto;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.apm-modal *, .apm-modal *::before, .apm-modal *::after { box-sizing: border-box; }

/* ─── Header ─── */
.apm-head {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 22px;
  background:
    linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.08) 100%),
    linear-gradient(135deg, #5b21b6 0%, #6d28d9 35%, #7c3aed 70%, #8b5cf6 100%);
  color: #fff;
}
.apm-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.apm-head-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.apm-title { font-size: 18px; font-weight: 800; letter-spacing: -.2px; }
.apm-sub   { font-size: 12px; color: rgba(255,255,255,.82); margin-top: 2px; }
.apm-close {
  width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .12s;
}
.apm-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

/* ─── Stepper — pill-card style matching the Customer Legal Identity sample.
   Each step is its own rounded card with a coloured icon tile + step number
   badge in the corner. Active step gets a violet border + glow + tinted
   background; idle steps fade out so the focus reads at a glance. */
.apm-stepper {
  display: flex; align-items: stretch; gap: 14px;
  padding: 18px 22px;
  background: #faf5ff;
  border-bottom: 1px solid #ede9fe;
}
.apm-step {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px;
  background: #fff;
  border: 1.5px solid #ede9fe;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,.03);
  transition: border-color .2s, box-shadow .2s, transform .2s, background .2s;
  position: relative;
}
.apm-step-icon-wrap { position: relative; flex-shrink: 0; }
.apm-step-icon {
  width: 46px; height: 46px; border-radius: 12px;
  background: #f1f5f9; color: #94a3b8;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 22px;
  transition: background .25s, color .25s, box-shadow .25s;
}
.apm-step-num-badge {
  position: absolute;
  bottom: -6px; right: -6px;
  width: 20px; height: 20px; border-radius: 50%;
  background: #cbd5e1; color: #fff;
  border: 2px solid #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 800;
  transition: background .25s;
}
.apm-step-text { min-width: 0; }
.apm-step-title { font-size: 14px; font-weight: 800; color: #1e1b4b; letter-spacing: -.01em; }
.apm-step-sub   { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }

/* Active step — violet tinted card */
.apm-step-active {
  border-color: #7c3aed;
  background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
  box-shadow: 0 6px 24px rgba(124,58,237,.18);
}
.apm-step-active .apm-step-icon {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.apm-step-active .apm-step-num-badge { background: #5b21b6; }
.apm-step-active .apm-step-title { color: #5b21b6; }

/* Done step — soft green */
.apm-step-done {
  border-color: #86efac;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
}
.apm-step-done .apm-step-icon {
  background: linear-gradient(135deg, #22c55e, #15803d);
  color: #fff;
}
.apm-step-done .apm-step-num-badge { background: #16a34a; }
.apm-step-done .apm-step-title { color: #15803d; }

/* Idle step — fade so the active step pops */
.apm-step-idle { opacity: .8; }
.apm-step-line {
  flex: 1; height: 2px; background: #ddd6fe; border-radius: 2px;
  transition: background .25s;
}
.apm-step-line.done { background: #16a34a; }

/* ─── Body ─── */
.apm-body {
  flex: 1; overflow-y: auto;
  padding: 18px 22px 22px;
  background: linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%);
  scrollbar-width: thin; scrollbar-color: #c4b5fd transparent;
}
.apm-body::-webkit-scrollbar { width: 8px; }
.apm-body::-webkit-scrollbar-thumb { background: #c4b5fd; border-radius: 99px; }

/* ─── Tabs ─── */
.apm-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
  border-bottom: 1.5px solid #ddd6fe;
  padding-bottom: 0;
}
.apm-tab {
  background: none; border: none;
  padding: 10px 16px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.apm-tab:hover { color: #6d28d9; }
.apm-tab.on { color: #5b21b6; border-bottom-color: #7c3aed; }
.apm-tab.is-locked { color: #cbd5e1; cursor: not-allowed; }
.apm-tab.is-locked:hover { color: #94a3b8; }

/* ─── Section card ─── */
.apm-section {
  background: #fff;
  border: 1.5px solid transparent;
  border-left-width: 4px;
  border-radius: 14px;
  margin-bottom: 14px;
  overflow: hidden;
}
.apm-section-blue   { border-color: #c4b5fd; border-left-color: #7c3aed; }
.apm-section-violet { border-color: #c4b5fd; border-left-color: #7c3aed; }
.apm-section-amber  { border-color: #fde68a; border-left-color: #f59e0b; }
.apm-section-green  { border-color: #bbf7d0; border-left-color: #16a34a; }
.apm-section-navy   { border-color: #c4b5fd; border-left-color: #4338ca; }

.apm-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px;
}
.apm-section-blue   .apm-section-head { background: linear-gradient(135deg, #ede9fe, #f5f3ff); }
.apm-section-violet .apm-section-head { background: linear-gradient(135deg, #ede9fe, #f3e8ff); }
.apm-section-amber  .apm-section-head { background: linear-gradient(135deg, #fef3c7, #fef9c3); }
.apm-section-green  .apm-section-head { background: linear-gradient(135deg, #dcfce7, #ecfdf5); }
.apm-section-navy   .apm-section-head { background: linear-gradient(135deg, #ede9fe, #e0e7ff); }
.apm-section-head-left { display: flex; align-items: center; gap: 10px; }
.apm-section-icon {
  width: 32px; height: 32px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
}
.apm-section-blue   .apm-section-icon { background: linear-gradient(135deg,#7c3aed,#5b21b6); }
.apm-section-violet .apm-section-icon { background: linear-gradient(135deg,#7c3aed,#5b21b6); }
.apm-section-amber  .apm-section-icon { background: linear-gradient(135deg,#f59e0b,#d97706); }
.apm-section-green  .apm-section-icon { background: linear-gradient(135deg,#16a34a,#0f8a3e); }
.apm-section-navy   .apm-section-icon { background: linear-gradient(135deg,#4338ca,#312e81); }

.apm-section-title { font-size: 13.5px; font-weight: 800; color: #1e1b4b; }
.apm-section-sub   { font-size: 11px; color: #6b7280; margin-top: 1px; }
.apm-section-amber .apm-section-title { color: #92400e; }
.apm-section-amber .apm-section-sub   { color: #b45309; }
.apm-section-green .apm-section-title { color: #166534; }
.apm-section-green .apm-section-sub   { color: #15803d; }

.apm-section-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }

.apm-section-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px;
  background: #16a34a; color: #fff; border: none;
  font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  transition: background .15s, transform .12s;
}
.apm-section-add-btn:hover { background: #15803d; transform: translateY(-1px); }
.apm-section-add-btn span { font-size: 14px; line-height: 1; }

/* ─── Inner section heading (e.g. "PRODUCT GENERAL INFORMATION") ─── */
.apm-inner-section {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafafa;
  display: flex; flex-direction: column; gap: 10px;
}
.apm-inner-title {
  font-size: 11px; font-weight: 800; letter-spacing: .08em;
  color: #475569; padding-bottom: 6px;
  border-bottom: 1px dashed #cbd5e1;
}

/* ─── Form layout grids ─── */
.apm-grid-2 { display: grid; grid-template-columns: 1fr 1fr;       gap: 12px; }
.apm-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr;   gap: 12px; }
.apm-grid-4 { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
.apm-grid-5 { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; }

/* Inventory (2x2) + Confidential Info side-by-side row */
.apm-inv-conf-row { align-items: stretch; }
.apm-inv-conf-row > .apm-field { display: flex; }
.apm-inv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.apm-conf-textarea { flex: 1; min-height: 100%; resize: vertical; }

/* ─── Field ─── */
.apm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.apm-field-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  color: #5b21b6; text-transform: uppercase;
}
.apm-req { color: #ef4444; font-weight: 700; }
.apm-field-plus {
  width: 18px; height: 18px;
  border: none; border-radius: 5px;
  background: #7c3aed; color: #fff;
  font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.apm-field-plus:hover { background: #6d28d9; }

/* Inline per-field error — small red row right under the input, with a
   warning icon. Pairs with .apm-field.has-error flipping the input
   border to red so the user can spot every wrong field at a glance.
   Specificity is bumped so the parent label / root colour can't bleed
   through and turn the message dark. */
.apm-field .apm-field-error,
.apm-modal .apm-field-error,
.apm-field-error {
  display: inline-flex !important; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; color: #ef4444 !important;
  margin-top: 4px;
  line-height: 1.2;
}
.apm-field .apm-field-error i,
.apm-modal .apm-field-error i,
.apm-field-error i { font-size: 13px; color: #ef4444 !important; }
.apm-field.has-error .apm-input,
.apm-field.has-error .apm-master-field,
.apm-field.has-error textarea {
  border-color: #ef4444 !important;
}
.apm-field.has-error .apm-input:focus,
.apm-field.has-error textarea:focus {
  box-shadow: 0 0 0 3px rgba(239,68,68,.15) !important;
}
.apm-field.has-error .master-select-wrap .master-select-toggle {
  border-color: #ef4444 !important;
}
.apm-field.has-error .apm-field-label { color: #ef4444 !important; }

/* Disabled field — gated dropdown (e.g. Haz Class until Haz Type is chosen) */
.apm-field.is-disabled { opacity: .55; }
.apm-field.is-disabled .apm-field-label { color: #94a3b8; }
.apm-field.is-disabled .apm-input,
.apm-field.is-disabled .master-select-wrap .master-select-toggle {
  background: #f1f5f9 !important;
  cursor: not-allowed !important;
}

/* ─── Master-form-style field container (with leading icon) ─── */
.apm-master-field { position: relative; }
.apm-master-field-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 15px; color: #6b7280; pointer-events: none; z-index: 3; line-height: 1;
  transition: color .18s ease, transform .18s ease;
  display: inline-flex; align-items: center; justify-content: center;
}
.apm-master-field:has(.apm-input-mf:focus) .apm-master-field-icon {
  color: #7c3aed; transform: translateY(-50%) scale(1.08);
}
/* Lift the icon up for multi-line fields so it sits in the first row. */
.apm-master-field:has(textarea.apm-input-mf) .apm-master-field-icon {
  top: 13px; transform: none;
}
.apm-master-field:has(textarea.apm-input-mf:focus) .apm-master-field-icon {
  transform: scale(1.08);
}
.apm-input-mf { padding-left: 36px !important; }

/* ─── MasterSelect inside the modal — restyle the trigger to match apm-input ─── */
.apm-master-select .master-select-wrap .master-select-toggle {
  min-height: 38px !important;
  height: 38px;
  padding: 0 32px 0 12px !important;
  font-size: 13px !important;
  font-family: inherit !important;
  background: color-mix(in srgb, #7c3aed 5%, #f8fafc) !important;
  border: 1.5px solid color-mix(in srgb, #7c3aed 18%, #e2e8f0) !important;
  border-radius: 10px !important;
  color: #1e1b4b !important;
  transition: border-color .15s, background .15s, box-shadow .15s !important;
}
.apm-master-select .master-select-wrap .master-select-toggle:hover {
  border-color: #c4b5fd !important;
}
.apm-master-select .master-select-wrap.show .master-select-toggle {
  background: #fff !important;
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important;
}
.apm-master-select .master-select-placeholder { color: #94a3b8 !important; font-size: 13px !important; }

/* ─── MasterDatePicker inside the modal ─── */
.apm-master-date .master-date-input,
.apm-master-date input.form-control {
  min-height: 38px !important;
  height: 38px !important;
  padding-left: 12px !important;
  font-size: 13px !important;
  background: color-mix(in srgb, #7c3aed 5%, #f8fafc) !important;
  border: 1.5px solid color-mix(in srgb, #7c3aed 18%, #e2e8f0) !important;
  border-radius: 10px !important;
  color: #1e1b4b !important;
}
.apm-master-date .master-date-input:focus {
  background: #fff !important;
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important;
}

/* ─── Input ─── */
.apm-input {
  height: 38px; width: 100%;
  padding: 0 12px;
  border: 1.5px solid color-mix(in srgb, #7c3aed 18%, #e2e8f0); border-radius: 10px;
  background: color-mix(in srgb, #7c3aed 5%, #f8fafc); color: #1e1b4b;
  font-family: inherit; font-size: 13px;
  outline: none;
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.apm-input::placeholder { color: #94a3b8; }
.apm-input:focus { border-color: #7c3aed; background: #fff; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
.apm-input:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }

.apm-textarea { height: auto; min-height: 64px; padding: 9px 12px; resize: vertical; }
.apm-select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2.4'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
.apm-readonly { background: #f5f3ff; color: #5b21b6; font-weight: 700; }
.apm-total    { background: #dcfce7 !important; color: #15803d !important; }

.apm-input-amber {
  background: #fef9c3; border-color: #fde68a;
}
.apm-input-amber:focus { background: #fef3c7; border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }

.apm-input-icon { position: relative; }
.apm-input-icon-prefix {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #7c3aed; font-weight: 700; font-size: 13px;
  pointer-events: none;
}
.apm-input.has-prefix { padding-left: 28px; }

/* ─── Upload dropzone ─── */
.apm-upload-field { position: relative; }
.apm-dropzone {
  position: relative;
  min-height: 80px;
  border: 1.5px dashed #c4b5fd;
  border-radius: 10px;
  background: #f5f3ff;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  color: #7c3aed; font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.apm-dropzone:hover { background: #ede9fe; border-color: #7c3aed; }
.apm-dropzone-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.apm-upload-preview { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.apm-upload-chip {
  position: relative;
  width: 64px; height: 64px; border-radius: 8px; overflow: hidden;
  border: 1px solid #ddd6fe;
}
.apm-upload-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.apm-upload-chip button {
  position: absolute; top: 2px; right: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(15,23,42,.7); color: #fff; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}

/* ─── QC empty state ─── */
.apm-empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 12.5px; }

/* ─── QC Add popup ─── */
.apm-qc-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.apm-qc-popup {
  width: 100%; max-width: 1080px;
  margin: auto;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .5);
  color: #1e1b4b;
  max-height: calc(100vh - 48px);
}
.apm-qc-popup-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
  color: #fff;
}
.apm-qc-popup-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 800;
}
.apm-qc-popup-title i { font-size: 18px; }
.apm-qc-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
}
.apm-qc-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.apm-qc-product-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px 18px;
  padding: 12px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.apm-qc-prod { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; min-width: 0; }
.apm-qc-prod-key { color: #1e1b4b; font-weight: 700; flex-shrink: 0; }
.apm-qc-prod-val { color: #6d28d9; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apm-qc-prod-val.accent { color: #5b21b6; font-weight: 800; }

.apm-qc-body {
  flex: 1; overflow-y: auto;
  padding: 18px;
  display: flex; flex-direction: column; gap: 14px;
  scrollbar-width: thin; scrollbar-color: #c4b5fd transparent;
}
.apm-qc-body::-webkit-scrollbar { width: 8px; }
.apm-qc-body::-webkit-scrollbar-thumb { background: #c4b5fd; border-radius: 99px; }

.apm-qc-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.apm-qc-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.apm-qc-textarea { min-height: 240px !important; }

.apm-qc-file { position: relative; }
.apm-qc-file-input { display: none; }
.apm-qc-file-trigger {
  display: inline-flex; align-items: center; gap: 8px;
  width: 100%; height: 38px; padding: 0 12px;
  border: 1.5px dashed color-mix(in srgb, #7c3aed 25%, #e2e8f0);
  border-radius: 10px;
  background: color-mix(in srgb, #7c3aed 5%, #f8fafc);
  color: #475569; font-size: 12.5px; font-weight: 600; cursor: pointer;
  white-space: nowrap; overflow: hidden;
  transition: background .15s, border-color .15s;
}
.apm-qc-file-trigger:hover { background: #ede9fe; border-color: #7c3aed; }
.apm-qc-file-trigger i { color: #7c3aed; font-size: 15px; flex-shrink: 0; }
.apm-qc-file-trigger span { overflow: hidden; text-overflow: ellipsis; }

.apm-qc-foot {
  display: flex; justify-content: center;
  padding: 14px 18px 18px;
  border-top: 1px solid #ede9fe;
}
.apm-qc-save {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 42px; padding: 0 38px;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: #fff; border: none; border-radius: 10px;
  font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 12px rgba(15,23,42,.35);
  transition: transform .12s, box-shadow .15s;
}
.apm-qc-save:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(15,23,42,.5);
}
.apm-qc-save:disabled { opacity: .55; cursor: not-allowed; }

@media (max-width: 880px) {
  .apm-qc-product-bar { grid-template-columns: 1fr 1fr; }
  .apm-qc-row-3 { grid-template-columns: 1fr; }
  .apm-qc-row-2 { grid-template-columns: 1fr; }
}

/* ─── Previous stages summary ─── */
.apm-prev {
  background: #f0fdf4;
  border: 1.5px solid #86efac;
  border-radius: 12px;
  margin-bottom: 14px;
  overflow: hidden;
}
.apm-prev-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #dcfce7, #ecfdf5);
  border-bottom: 1px solid #bbf7d0;
}
.apm-prev-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 800; color: #166534;
}
.apm-prev-check {
  width: 22px; height: 22px; border-radius: 50%;
  background: linear-gradient(135deg, #22c55e, #16a34a);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.apm-prev-chip {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 99px;
  background: #fff; color: #166534;
  font-size: 11px; font-weight: 700;
  border: 1px solid #bbf7d0;
}
.apm-prev-toggle {
  height: 28px; padding: 0 12px;
  background: #fff; border: 1px solid #bbf7d0; color: #166534;
  border-radius: 7px;
  font-family: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.apm-prev-toggle:hover { background: #dcfce7; border-color: #4ade80; }

.apm-prev-body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 10px; }
.apm-prev-stage { display: flex; flex-direction: column; gap: 6px; }
.apm-prev-stage-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  display: inline-flex; align-items: center;
}
.apm-prev-stage.tone-violet .apm-prev-stage-label { color: #5b21b6; }
.apm-prev-stage.tone-amber  .apm-prev-stage-label { color: #b45309; }
.apm-prev-stage.tone-green  .apm-prev-stage-label { color: #166534; }

/* Flat label/value grid — no per-cell box. The PRODUCT CORE / SALES
 * CONFIG / QUALITY headers already segment the data, so each cell is
 * just two lines of text. Tooltips on the value pick up the slack
 * when the cell still has to ellipsis-truncate. */
.apm-prev-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  column-gap: 18px;
  row-gap: 10px;
}
.apm-prev-field {
  min-width: 0;
  padding: 0;
}
.apm-prev-field-label {
  font-size: 9.5px; font-weight: 700; letter-spacing: .08em;
  color: #94a3b8; text-transform: uppercase;
}
.apm-prev-field-value {
  font-size: 13px; font-weight: 600; color: #1e1b4b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-top: 2px;
  cursor: default;
}

/* ─── Vendor toolbar ─── */
.apm-vendor-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: #fff; border: 1px solid #ddd6fe; border-radius: 12px;
  margin-bottom: 12px;
}
.apm-vendor-toolbar-title { font-size: 13px; font-weight: 800; color: #1e1b4b; }

/* ─── Vendor info read-only grid ─── */
.apm-vendor-info {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.apm-info-cell { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; min-width: 0; }
.apm-info-key { color: #6b7280; font-weight: 700; }
.apm-info-val { color: #1e1b4b; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ─── Vendor draft footer ─── */
.apm-vendor-draft-foot { display: flex; justify-content: center; gap: 10px; padding-top: 4px; }

/* ─── Vendor mapped table — Velzon table-card shell ─── */
.apm-vendor-table-card {
  margin-top: 12px;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 12px;
  padding: 12px;
}
.apm-vendor-table-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.apm-vendor-table-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 800; color: #1e1b4b;
}
.apm-vendor-table-title i { color: #7c3aed; font-size: 16px; }
.apm-vendor-table-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 8px; border-radius: 99px;
  background: #ede9fe; color: #5b21b6;
  font-size: 11px; font-weight: 800;
  border: 1px solid #c4b5fd;
}
/* Lighten the table chrome inside the modal so it reads as a sub-table,
   not the page's main table. */
.apm-vendor-table-card .table-responsive { border-radius: 10px; }
.apm-vendor-table-card .table thead th {
  font-size: 11.5px; font-weight: 700; letter-spacing: .02em;
  color: #475569;
}
.apm-vendor-table-card .table tbody td { vertical-align: middle; }

/* ─── Footer ─── */
.apm-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 22px;
  background: #fff; border-top: 1px solid #ede9fe;
}
.apm-foot-left  { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.apm-foot-right { display: flex; align-items: center; gap: 8px; }
.apm-foot-error {
  font-size: 12.5px; font-weight: 700; color: #b91c1c;
  background: #fef2f2; border: 1px solid #fecaca;
  padding: 6px 10px; border-radius: 8px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 480px;
}
.apm-spinner {
  width: 13px; height: 13px;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: apm-spin .8s linear infinite;
}
@keyframes apm-spin { to { transform: rotate(360deg); } }
.apm-btn-primary:disabled,
.apm-btn-outline:disabled,
.apm-btn-ghost:disabled { opacity: .55; cursor: not-allowed; }
.apm-btn-ghost,
.apm-btn-outline,
.apm-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 18px;
  font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
  border-radius: 10px;
  transition: transform .12s, background .15s, box-shadow .15s, border-color .15s;
}
.apm-btn-ghost { background: #fff; border: 1.5px solid #e2e8f0; color: #475569; }
.apm-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.apm-btn-outline { background: #fff; border: 1.5px solid #c4b5fd; color: #5b21b6; }
.apm-btn-outline:hover { background: #f5f3ff; border-color: #7c3aed; }
.apm-btn-primary {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border: none;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.apm-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(124,58,237,.5); }
.apm-btn-primary:disabled { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }
.apm-btn-primary span { font-size: 16px; line-height: 1; }

/* ─── Responsive ─── */
@media (max-width: 880px) {
  .apm-grid-2, .apm-grid-3, .apm-grid-4, .apm-grid-5 { grid-template-columns: 1fr 1fr; }
  .apm-vendor-info { grid-template-columns: 1fr 1fr; }
  .apm-qc-row { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 540px) {
  .apm-grid-2, .apm-grid-3, .apm-grid-4, .apm-grid-5 { grid-template-columns: 1fr; }
  .apm-vendor-info { grid-template-columns: 1fr; }
  .apm-stepper { padding: 12px; gap: 8px; }
  .apm-step-text { display: none; }
}

/* ════════════════════════════════════════════════════════════════════════
 * Dark mode
 * ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .apm-modal {
  background: #14102a;
  color: #ede9fe;
  box-shadow: 0 30px 80px rgba(0,0,0,.75);
}
[data-bs-theme="dark"] .apm-stepper {
  background: #1a1430;
  border-bottom-color: #3b2a6b;
}
[data-bs-theme="dark"] .apm-step { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-step-icon { background: #2a1d5c; color: #a89fc7; }
[data-bs-theme="dark"] .apm-step-num-badge { border-color: #110c25; }
[data-bs-theme="dark"] .apm-step-title { color: #ede9fe; }
[data-bs-theme="dark"] .apm-step-sub   { color: #a89fc7; }
[data-bs-theme="dark"] .apm-step-active { background: linear-gradient(135deg, #221852 0%, #2a1d5c 100%); border-color: #a78bfa; box-shadow: 0 6px 24px rgba(167,139,250,.25); }
[data-bs-theme="dark"] .apm-step-active .apm-step-title { color: #c4b5fd; }
[data-bs-theme="dark"] .apm-step-done   { background: linear-gradient(135deg, #14241a 0%, #1a3225 100%); border-color: #166534; }
[data-bs-theme="dark"] .apm-step-done   .apm-step-title { color: #4ade80; }

[data-bs-theme="dark"] .apm-body {
  background: linear-gradient(180deg, #110c25 0%, #1a1430 100%);
  scrollbar-color: #4c1d95 transparent;
}
[data-bs-theme="dark"] .apm-body::-webkit-scrollbar-thumb { background: #4c1d95; }

[data-bs-theme="dark"] .apm-tabs { border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-tab { color: #6d6391; }
[data-bs-theme="dark"] .apm-tab:hover { color: #c4b5fd; }
[data-bs-theme="dark"] .apm-tab.on { color: #c4b5fd; border-bottom-color: #a78bfa; }

[data-bs-theme="dark"] .apm-section { background: #1a1430; }
[data-bs-theme="dark"] .apm-section-blue,
[data-bs-theme="dark"] .apm-section-violet,
[data-bs-theme="dark"] .apm-section-navy { border-color: #3b2a6b; border-left-color: #a78bfa; }
[data-bs-theme="dark"] .apm-section-amber { border-color: #78350f; border-left-color: #f59e0b; }
[data-bs-theme="dark"] .apm-section-green { border-color: #14532d; border-left-color: #4ade80; }

[data-bs-theme="dark"] .apm-section-blue   .apm-section-head,
[data-bs-theme="dark"] .apm-section-violet .apm-section-head,
[data-bs-theme="dark"] .apm-section-navy   .apm-section-head { background: linear-gradient(135deg, #221852, #2a1d5c); }
[data-bs-theme="dark"] .apm-section-amber  .apm-section-head { background: linear-gradient(135deg, #3f2c0a, #4a3408); }
[data-bs-theme="dark"] .apm-section-green  .apm-section-head { background: linear-gradient(135deg, #14241a, #1a3225); }

[data-bs-theme="dark"] .apm-section-title { color: #ede9fe; }
[data-bs-theme="dark"] .apm-section-sub   { color: #a89fc7; }
[data-bs-theme="dark"] .apm-section-amber .apm-section-title { color: #fde68a; }
[data-bs-theme="dark"] .apm-section-amber .apm-section-sub   { color: #fcd34d; }
[data-bs-theme="dark"] .apm-section-green .apm-section-title { color: #bbf7d0; }
[data-bs-theme="dark"] .apm-section-green .apm-section-sub   { color: #86efac; }

[data-bs-theme="dark"] .apm-inner-section { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-inner-title   { color: #a89fc7; border-bottom-color: #3b2a6b; }

[data-bs-theme="dark"] .apm-field-label { color: #a78bfa; }
[data-bs-theme="dark"] .apm-master-field-icon { color: #8579b5; }
[data-bs-theme="dark"] .apm-master-field:has(.apm-input-mf:focus) .apm-master-field-icon { color: #a78bfa; }
[data-bs-theme="dark"] .apm-master-select .master-select-wrap .master-select-toggle {
  background: color-mix(in srgb, #a78bfa 12%, #110c25) !important;
  border-color: #3b2a6b !important;
  color: #ede9fe !important;
}
[data-bs-theme="dark"] .apm-master-select .master-select-wrap .master-select-toggle:hover {
  border-color: #4c1d95 !important;
}
[data-bs-theme="dark"] .apm-master-select .master-select-wrap.show .master-select-toggle {
  background: #1a1430 !important; border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.18) !important;
}
[data-bs-theme="dark"] .apm-master-select .master-select-placeholder { color: #6d6391 !important; }
[data-bs-theme="dark"] .apm-master-date .master-date-input,
[data-bs-theme="dark"] .apm-master-date input.form-control {
  background: color-mix(in srgb, #a78bfa 12%, #110c25) !important;
  border-color: #3b2a6b !important;
  color: #ede9fe !important;
}
[data-bs-theme="dark"] .apm-master-date .master-date-input:focus {
  background: #1a1430 !important; border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.18) !important;
}
[data-bs-theme="dark"] .apm-input {
  background: #110c25; border-color: #3b2a6b; color: #ede9fe;
}
[data-bs-theme="dark"] .apm-input::placeholder { color: #6d6391; }
[data-bs-theme="dark"] .apm-input:focus { background: #1a1430; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
[data-bs-theme="dark"] .apm-input:disabled { background: #16102d; color: #6d6391; }
[data-bs-theme="dark"] .apm-readonly { background: #221852; color: #c4b5fd; }
[data-bs-theme="dark"] .apm-total    { background: #14241a !important; color: #4ade80 !important; }
[data-bs-theme="dark"] .apm-input-amber { background: #2a1f08; border-color: #78350f; color: #fde68a; }
[data-bs-theme="dark"] .apm-input-amber:focus { background: #3f2c0a; border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.22); }
[data-bs-theme="dark"] .apm-input-icon-prefix { color: #a78bfa; }
[data-bs-theme="dark"] .apm-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a78bfa' stroke-width='2.4'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); }
[data-bs-theme="dark"] .apm-select option { background: #1a1430; color: #ede9fe; }

[data-bs-theme="dark"] .apm-dropzone { background: #221852; border-color: #4c1d95; color: #c4b5fd; }
[data-bs-theme="dark"] .apm-dropzone:hover { background: #2a1d5c; border-color: #a78bfa; }
[data-bs-theme="dark"] .apm-upload-chip { border-color: #4c1d95; }

[data-bs-theme="dark"] .apm-qc-popup { background: #14102a; color: #ede9fe; box-shadow: 0 30px 80px rgba(0,0,0,.75); }
[data-bs-theme="dark"] .apm-qc-product-bar { background: #110c25; border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-qc-prod-key { color: #ede9fe; }
[data-bs-theme="dark"] .apm-qc-prod-val { color: #a78bfa; }
[data-bs-theme="dark"] .apm-qc-prod-val.accent { color: #c4b5fd; }
[data-bs-theme="dark"] .apm-qc-body { scrollbar-color: #4c1d95 transparent; }
[data-bs-theme="dark"] .apm-qc-body::-webkit-scrollbar-thumb { background: #4c1d95; }
[data-bs-theme="dark"] .apm-qc-file-trigger {
  background: color-mix(in srgb, #a78bfa 12%, #110c25);
  border-color: #4c1d95; color: #a89fc7;
}
[data-bs-theme="dark"] .apm-qc-file-trigger:hover { background: #221852; border-color: #a78bfa; }
[data-bs-theme="dark"] .apm-qc-foot { border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-qc-save {
  background: linear-gradient(135deg, #4338ca, #312e81);
  box-shadow: 0 4px 12px rgba(67,56,202,.45);
}
[data-bs-theme="dark"] .apm-qc-save:hover:not(:disabled) { box-shadow: 0 8px 20px rgba(67,56,202,.6); }

[data-bs-theme="dark"] .apm-vendor-toolbar {
  background: #1a1430; border-color: #3b2a6b;
}
[data-bs-theme="dark"] .apm-vendor-toolbar-title { color: #ede9fe; }

/* Previous stages — dark */
[data-bs-theme="dark"] .apm-prev { background: #14241a; border-color: #14532d; }
[data-bs-theme="dark"] .apm-prev-head { background: linear-gradient(135deg, #14241a, #1a3225); border-bottom-color: #14532d; }
[data-bs-theme="dark"] .apm-prev-title { color: #bbf7d0; }
[data-bs-theme="dark"] .apm-prev-chip { background: #14241a; color: #bbf7d0; border-color: #166534; }
[data-bs-theme="dark"] .apm-prev-toggle { background: #14241a; color: #bbf7d0; border-color: #166534; }
[data-bs-theme="dark"] .apm-prev-toggle:hover { background: #1a3225; border-color: #22c55e; }
[data-bs-theme="dark"] .apm-prev-field-label { color: #6d6391; }
[data-bs-theme="dark"] .apm-prev-field-value { color: #ede9fe; }
[data-bs-theme="dark"] .apm-prev-stage.tone-violet .apm-prev-stage-label { color: #c4b5fd; }
[data-bs-theme="dark"] .apm-prev-stage.tone-amber  .apm-prev-stage-label { color: #fde68a; }
[data-bs-theme="dark"] .apm-prev-stage.tone-green  .apm-prev-stage-label { color: #bbf7d0; }

[data-bs-theme="dark"] .apm-vendor-info { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-info-key { color: #a89fc7; }
[data-bs-theme="dark"] .apm-info-val { color: #ede9fe; }

[data-bs-theme="dark"] .apm-vendor-table-card { background: #1a1430; border-color: #3b2a6b; }
[data-bs-theme="dark"] .apm-vendor-table-title { color: #ede9fe; }
[data-bs-theme="dark"] .apm-vendor-table-title i { color: #a78bfa; }
[data-bs-theme="dark"] .apm-vendor-table-count { background: #2a1d5c; color: #c4b5fd; border-color: #4c1d95; }
[data-bs-theme="dark"] .apm-vendor-table-card .table thead th { color: #a89fc7; }

[data-bs-theme="dark"] .apm-foot {
  background: #14102a; border-top-color: #3b2a6b;
}
[data-bs-theme="dark"] .apm-foot-error { background: #3f1d1d; border-color: #7f1d1d; color: #fca5a5; }
[data-bs-theme="dark"] .apm-btn-ghost { background: #1a1430; border-color: #3b2a6b; color: #c4b5fd; }
[data-bs-theme="dark"] .apm-btn-ghost:hover { background: #221852; border-color: #4c1d95; }
[data-bs-theme="dark"] .apm-btn-outline { background: #1a1430; border-color: #4c1d95; color: #c4b5fd; }
[data-bs-theme="dark"] .apm-btn-outline:hover { background: #221852; border-color: #a78bfa; }

/* ─── Master Quick-Add popup ─── */
.apm-qa-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .6);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.apm-qa-popup {
  width: 100%; max-width: 480px;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .5);
}
.apm-qa-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #5b21b6, #7c3aed);
  color: #fff;
}
.apm-qa-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; }
.apm-qa-title i { font-size: 18px; }
.apm-qa-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .12s;
}
.apm-qa-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }
.apm-qa-body {
  padding: 18px; display: flex; flex-direction: column; gap: 12px;
  max-height: calc(100vh - 240px); overflow-y: auto;
}
.apm-qa-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid #ede9fe;
}

[data-bs-theme="dark"] .apm-qa-popup { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .apm-qa-head { background: linear-gradient(135deg, #4c1d95, #7c3aed); }
[data-bs-theme="dark"] .apm-qa-foot { border-top-color: #3b2a6b; }
`;
