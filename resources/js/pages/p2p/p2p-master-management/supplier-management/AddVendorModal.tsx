import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import { Shimmer, ShimmerForm, ShimmerTable } from '../../../../components/ui/Shimmer';
import { MasterMultiSelect } from '../../../master/masterFormKit';
import { useRuledSegments, type SegDocType } from '../../../../hooks/useRuledSegments';
import AuthorityBadges from '../../../clm/compliance/AuthorityBadges';
import { MasterRecordModal } from '../../../master/MasterRecordModal';
import { SegmentModal, nextSegmentCode, type SegmentForm } from '../../../clm/compliance/ClmSegmentPage';
import { CLM_CSS } from '../../../clm/shared/clmShared';
import { SegmentTags } from '../../procurement-management/bulk-sourcing/SegmentTags';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { downloadFile } from '../../../../utils/downloadFile';
import { formatProductCode } from '../../../../utils/formatProductCode';
import {
  validateEmail, validatePincode, validateWebsite,
  validateGstin, validateIfsc, validateSwift, validateAccountNumber,
} from '../../../../utils/fieldValidators';
import SalesCustomerSendForSignatureModal from '../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal';
import { SigningTrackerModal } from '../../../sales/opportunity-pipeline/SigningTrackerModal';
import {
  readVendorMasterBundle,
  writeVendorMasterBundle,
  bustVendorMasterBundle,
} from './vendorBundleCache';
import './add-vendor-modal.css';

function validateContactNumber(value: string, label = 'Contact No', isIndia = false): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (!/^\d+$/.test(v))           return `${label} must contain digits only (no spaces, +, or punctuation)`;
  if (isIndia) {
    if (v.length !== 10)          return `${label} must be exactly 10 digits (after +91) — you entered ${v.length}`;
    if (!/^[6-9]/.test(v))        return `${label} must start with 6, 7, 8 or 9 — Indian mobile numbers do not begin with ${v[0]}`;
    return '';
  }
  if (v.length < 7 || v.length > 15) return `${label} must be 7 to 15 digits`;
  return '';
}

const digitsOnly = (raw: string, max = 15): string => (raw || '').replace(/\D/g, '').slice(0, max);

function ContactNoInput(props: {
  value: string;
  onChange: (next: string) => void;
  isIndia: boolean;
  readOnly?: boolean;
}) {
  const { value, onChange, isIndia, readOnly } = props;
  if (isIndia) {
    return (
      <div className="avm-phone-in">
        <span className="avm-phone-cc">+91</span>
        <input
          className="avm-input avm-phone-field"
          placeholder="9876543210"
          inputMode="numeric"
          pattern="\d*"
          maxLength={10}
          value={value}
          readOnly={readOnly}
          onChange={e => onChange(digitsOnly(e.target.value, 10))}
        />
      </div>
    );
  }
  return (
    <input
      className="avm-input"
      placeholder="Enter contact number"
      inputMode="numeric"
      pattern="\d*"
      maxLength={15}
      value={value}
      readOnly={readOnly}
      onChange={e => onChange(digitsOnly(e.target.value))}
    />
  );
}

export type VendorPayload = {
  companyName: string;
  legalName: string;
  vendorType: string;
  website: string;
  gstApplicable: 'Yes' | 'No';
  gstNumber: string;
  riskLevel: string;
  vendorBehaviour: string;
  segment: string;
  complianceBehaviour: string;
  registeredOffice: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  pincode: string;
  googleLocation: string;
  contactName: string;
  designation: string;
  contactNo: string;
  email: string;
  whatsappEnabled: boolean;
  dueDiligence: DueDiligenceRow[];
  ownerKyc: OwnerKycRow[];
  tradeLicenses: TradeLicenseRow[];
  bankAccounts: BankRow[];
  gstScrutiny: GstScrutinyRow[];
  tradeDocuments: TradeDocRow[];
  productMappings: ProductMappingRow[];
  mappedProductCodes: string[];
};

export type DueDiligenceRow = {
  id: string;
  code: string;              
  documentName: string;
  issuingAuthority: string;
  expiry: string;            
  mandatory: boolean;
  file: File | null;
  fileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type OwnerKycRow = {
  id: string;
  code: string;              
  documentName: string;
  issuingAuthority: string;
  documentNumber: string;
  issueDate: string;         
  expiry: string;
  status: 'Active' | 'Inactive';
  file: File | null;
  fileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type TradeLicenseRow = {
  id: string;
  code: string;              
  licenseType: string;       
  licenseNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expiryDate: string;
  file: File | null;
  fileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type BankRow = {
  id: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  ifsc: string;
  branchAddress: string;
  chequeFile: File | null;
  chequeFileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type GstScrutinyRow = {
  id: string;
  gstNumber: string;
  status: 'Active' | 'Inactive';
  scrutinyDate?: string;   
  lastFilingDate: string;
  prevNonGst2aInvoice: string;
  redFlags: string;
};

export type TradeDocRow = {
  code: string;             
  name: string;             
  db_id: number | null;
  sendForSignature: boolean;
  status: 'N/A' | 'Sent' | 'Signed' | 'inprogress' | 'completed' | 'declined' | 'recalled' | 'expired';
  attachment: File | null;
  attachmentName: string;
  signatureRequestId?: number;
  signedUrl?: string;
  certificateUrl?: string;
  cooldownActive?: boolean;
  reminder_count?: number;
  last_reminder_sent_at?: string | null;
};

export type ProductMappingRow = {
  id: string;
  productId: number | null;     
  productCode: string;
  productName: string;
  hsnSacCode: string;
  segment: string;
  batchSerialLot: string;
  purchasePrice: number;
  gstPercentage: number;
  gstAmount: number;
  totalAmount: number;
};

type StepKey = 1 | 2 | 3;
type IdTab = 'identification' | 'address';
type KycTab = 'company' | 'owner' | 'license' | 'bank' | 'gst';

const KYC_TAB_ORDER: KycTab[] = ['company', 'owner', 'license', 'bank', 'gst'];

const KYC_SUB_ORDER: KycSubTab[] = ['owner', 'company', 'license'];
type TradeTab = 'kyc' | 'trade';
type KycSubTab = 'owner' | 'company' | 'license';

const SEED_DD: DueDiligenceRow[] = [];

const SEED_TRADE_LICENSE: TradeLicenseRow[] = [];

const SUPPLIER_TYPE_OPTS: { value: string; label: string }[] = [
  { value: 'Material / Goods',  label: 'Material / Goods' },
  { value: 'Services',          label: 'Services' },
  { value: 'FFD / Transporter', label: 'FFD / Transporter' },
];

const KYC_TAB_TITLE: Record<string, string> = {
  company: 'Company Due Diligence',
  owner:   'Owner KYC',
  license: 'Trade Licence',
  bank:    'Supplier Bank Details',
  gst:     'GST Scrutiny',
};
const KYC_TAB_SUB: Record<string, string> = {
  company: 'Licenses, statutory documents, and compliance proofs',
  owner:   'Identity & address proofs for owners / directors',
  license: 'Export / import licences and registrations',
  bank:    'Account, IFSC, and cancelled cheque proof',
  gst:     'GST registration & compliance checks',
};

export default function AddVendorModal(props: {
  vendorId?: number | null;
  initialStep?: StepKey;
  scope?: 'domestic' | 'international';
  vendorCodeHint?: string | null;
  onClose: () => void;
  onSubmit: (payload: VendorPayload) => void;
}) {
  const { onClose, onSubmit, vendorId: initialVendorId, initialStep, scope, vendorCodeHint } = props;
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = !!initialVendorId;

  const [step, setStep] = useState<StepKey>(isEdit && initialStep ? initialStep : 1);
  const [idTab,    setIdTab]    = useState<IdTab>('identification');
  const [kycTab,   setKycTab]   = useState<KycTab>('company');
  const [tradeTab, setTradeTab] = useState<TradeTab>('kyc');
  const [kycSub,   setKycSub]   = useState<KycSubTab>('owner');
  const [prevOpen, setPrevOpen] = useState(false);

  type Opt = { value: string; label: string };
  const [vendorTypeOpts, setVendorTypeOpts]     = useState<Opt[]>([]);
  const [riskLevelOpts,  setRiskLevelOpts]      = useState<Opt[]>([]);
  const [segmentOpts,    setSegmentOpts]        = useState<Opt[]>([]);
  const [complianceOpts, setComplianceOpts]     = useState<Opt[]>([]);
  const [classificationOpts, setClassificationOpts] = useState<Opt[]>([]);
  const [behaviourOpts,  setBehaviourOpts]      = useState<Opt[]>([]);
  const [countryOpts,    setCountryOpts]        = useState<Opt[]>([]);
  const [stateRows, setStateRows] = useState<Array<{
    id: string;
    name: string;
    country_id: string;
  }>>([]);
  const [stateCodeRows, setStateCodeRows] = useState<Array<{
    id: string;
    state_id: string;
    state_code: string;
    state_name: string;
    country_id: string;
  }>>([]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (k: string) => {
    setFieldErrors(prev => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const COMPANY_NAME_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;
  const COMPANY_NAME_INVALID_RE = /[^\p{L}\p{N}\s\-.,()&/'%]/gu;
  const COMPANY_NAME_MAX = 100;
  const handleCompanyNameChange = (
    raw: string,
    fieldKey: 'companyName' | 'legalName',
    setter: (v: string) => void,
  ) => {
    let cleaned = raw.replace(/[<>]/g, '');
    const afterAngles = cleaned;
    cleaned = cleaned.replace(COMPANY_NAME_SQL_RE, '');
    const afterSql = cleaned;
    cleaned = cleaned.replace(COMPANY_NAME_INVALID_RE, '');
    if (cleaned.length > COMPANY_NAME_MAX) cleaned = cleaned.slice(0, COMPANY_NAME_MAX);
    setter(cleaned);
    if (cleaned === raw) {
      clearFieldError(fieldKey);
      return;
    }
    let msg: string;
    if (afterAngles !== raw)        msg = 'HTML characters (< or >) are not allowed';
    else if (afterSql !== afterAngles) msg = 'SQL-like patterns are not allowed';
    else                            msg = "Use letters, numbers, spaces, and . , - ( ) & / ' % only";
    setFieldErrors(prev => ({ ...prev, [fieldKey]: msg }));
  };

  const applySanitizer = (
    raw: string,
    fieldKey: string,
    setter: (v: string) => void,
    sanitizer: (raw: string) => SanitizeResult,
  ) => {
    const { cleaned, error } = sanitizer(raw);
    setter(cleaned);
    if (error) setFieldErrors(prev => ({ ...prev, [fieldKey]: error }));
    else clearFieldError(fieldKey);
  };

  const [quickAdd, setQuickAdd] = useState<VendorMasterSlug | null>(null);

  const [segAdd, setSegAdd] = useState<{ nextCode: string; names: string[] } | null>(null);
  const [segAddLoading, setSegAddLoading] = useState(false);
  const openSegmentAdd = async () => {
    if (segAddLoading) return;
    setSegAddLoading(true);
    try {
      const { data } = await api.get<{ data: { code: string; name: string }[] }>('/clm/segments');
      const segRows = data.data ?? [];
      setSegAdd({ nextCode: nextSegmentCode(segRows), names: segRows.map(r => r.name) });
    } catch {
      setSegAdd({ nextCode: 'SG-001', names: [] });
    } finally {
      setSegAddLoading(false);
    }
  };

  const [vendorId, setVendorId] = useState<number | null>(initialVendorId ?? null);
  const [vendorCode, setVendorCode] = useState<string>(vendorCodeHint ?? '');
  const [saving,   setSaving]   = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [mastersLoading, setMastersLoading] = useState<boolean>(true);

  const [companyName, setCompanyName] = useState('');
  const [legalName,   setLegalName]   = useState('');
  const [vendorType,  setVendorType]  = useState('');
  const [website,     setWebsite]     = useState('');
  const [gstApplicable, setGstApplicable] = useState<'Yes' | 'No'>('No');
  const [gstNumber,     setGstNumber]     = useState('');
  const kycTabOrder = useMemo(
    () => (gstApplicable === 'Yes' ? KYC_TAB_ORDER : KYC_TAB_ORDER.filter(t => t !== 'gst')),
    [gstApplicable],
  );
  const [riskLevel,   setRiskLevel]   = useState('');
  const [vendorBehaviour, setVendorBehaviour] = useState('');
  const [segment,     setSegment]     = useState<string[]>([]);
  const [lockedSegments, setLockedSegments] = useState<string[]>([]);
  const [lockedSegmentReasons, setLockedSegmentReasons] = useState<Record<string, string>>({});
  const savedSegmentRef = useRef<string[]>([]);
  const [segReqKeys, setSegReqKeys] = useState<Record<string, string[]>>({});
  const [uploadedKeys, setUploadedKeys] = useState<string[]>([]);
  const { ruledIds: ruledSegIds, typesById: segTypesById, loaded: segRulesLoaded } = useRuledSegments(true);
  const [expandedSegBadges, setExpandedSegBadges] = useState<Set<string>>(new Set());
  const toggleSegBadge = (id: string) => setExpandedSegBadges(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const [complianceBehaviour, setComplianceBehaviour] = useState('');
  const [classificationId, setClassificationId] = useState('');

  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; authority_list?:string[]|null; expiry?:string|null; status?:string; requirement:'M'|'O' };
  type SegmentDocs = { kyc: SegDocRow[]; dd: SegDocRow[]; tl: SegDocRow[]; td: SegDocRow[]; qc: SegDocRow[] };
  const EMPTY_SEG_DOCS: SegmentDocs = { kyc:[], dd:[], tl:[], td:[], qc:[] };
  const [segmentDocs, setSegmentDocs] = useState<SegmentDocs>(EMPTY_SEG_DOCS);

  const [segmentDocKeys, setSegmentDocKeys] = useState<Record<string, string[]>>({});

  type SegRefUpload = { file: File | null; url: string; name: string; expiry?: string };
  const [segmentRefUploads, setSegmentRefUploads] = useState<Record<string, SegRefUpload>>({});

  const [bundledSegUploads, setBundledSegUploads] = useState<any[] | null>(null);

  const SUB_TO_CAT_V: Record<string, 'kyc' | 'dd' | 'tl'> = {
    company: 'dd',
    owner:   'kyc',
    license: 'tl',
  };
  const persistSegmentRefUpload = async (refKey: string, file: File, docName: string, expiryDate?: string) => {
    const ownerId = vendorId || initialVendorId || null;
    if (!ownerId) {
      toast.error(
        'Save Step 1 first',
        'The supplier has to exist before documents can be attached to it. Save Supplier Legal Identity, then upload.',
      );
      throw new Error('vendor not saved');
    }
    const [sub, doc_code] = refKey.split('::');
    const category = SUB_TO_CAT_V[sub];
    if (!category || !doc_code) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    if (expiryDate) fd.append('expiry_date', expiryDate);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/supplier/${ownerId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data;
      if (row?.attachment_url) {
        setSegmentRefUploads(prev => {
          const existing = prev[refKey];
          if (existing?.url && existing.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(existing.url); } catch {}
          }
          return {
            ...prev,
            [refKey]: { file: null, url: row.attachment_url, name: row.attachment_name || file.name, expiry: row.expiry_date || expiryDate || undefined },
          };
        });
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const body   = e?.response?.data;
      const detail = body?.errors
        ? Object.values(body.errors as Record<string, string[]>).flat()[0]
        : body?.message;
      toast.error(
        status === 403 ? 'Not allowed' : 'Upload failed',
        detail || 'The document could not be saved. Please try again.',
      );
      setSegmentRefUploads(prev => {
        const existing = prev[refKey];
        if (existing?.url && existing.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(existing.url); } catch {}
        }
        const next = { ...prev };
        delete next[refKey];
        return next;
      });
      throw e;
    }
  };

  const [addressType, setAddressType] = useState('Registered Office');
  const [registeredOffice, setRegisteredOffice] = useState('');
  const [country,   setCountry]   = useState('');
  const [state,     setState]     = useState('');
  const [stateCode, setStateCode] = useState('');
  const [stateLocked, setStateLocked] = useState(false);
  const lockToast = () => toast.warning(
    'Can’t change this',
    'This supplier is already used in a Purchase Order.',
  );
  const intlStateCodeToast = () => toast.info(
    'Not applicable',
    'State Code is only for Indian (GST) suppliers — it doesn’t apply to an international supplier.',
  );
  const [city,      setCity]      = useState('');
  const [pincode,   setPincode]   = useState('');
  const [googleLocation, setGoogleLocation] = useState('');
  const mapsLinkOk = /^https?:\/\/[^\s]+$/i.test(googleLocation.trim());

  const stateOpts = useMemo<Opt[]>(() => {
    const filtered = country
      ? stateRows.filter(r => r.country_id === country)
      : stateRows;
    return filtered
      .map(r => ({ value: r.id, label: r.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [stateRows, country]);
  const effectiveScope: 'domestic' | 'international' | null = useMemo(() => {
    const name = (countryOpts.find(o => o.value === country)?.label ?? '').trim().toLowerCase();
    if (name) return name === 'india' ? 'domestic' : 'international';
    return scope ?? null;   
  }, [country, countryOpts, scope]);

  const countryScopeLocked = effectiveScope === 'domestic';

  const scopedCountryOpts = useMemo<Opt[]>(() => {
    if (!effectiveScope) return countryOpts;
    const isIndia = (o: Opt) => String(o.label).trim().toLowerCase() === 'india';
    return effectiveScope === 'domestic'
      ? countryOpts.filter(isIndia)
      : countryOpts.filter(o => !isIndia(o));
  }, [countryOpts, effectiveScope]);

  useEffect(() => {
    if (isEdit || scope !== 'domestic' || country || countryOpts.length === 0) return;
    const india = countryOpts.find(o => String(o.label).trim().toLowerCase() === 'india');
    if (!india) return;
    setCountry(india.value);
    setState('');
    setStateCode('');
  }, [scope, isEdit, countryOpts, country]);

  const scopeLockToast = () => toast.info(
    'Country is fixed',
    isEdit
      ? 'This is a domestic supplier — GST and State Code are tied to India. Changing the country would change which documents apply, so it is set at creation.'
      : 'You chose Domestic, so this supplier is registered in India. Close and add them as an International supplier to pick another country.',
  );

  const supplierDocType: SegDocType = useMemo(() => {
    const name = (countryOpts.find(o => o.value === country)?.label ?? '').trim();
    return name === 'India' ? 'domestic' : 'international';
  }, [country, countryOpts]);
  const disabledSegmentIds = useMemo(() => {
    if (!segRulesLoaded) return [] as string[];
    return segmentOpts.map(o => o.value).filter(v => {
      if (!ruledSegIds.has(v)) return true;                 
      if (!country) return false;                           
      if (segment.includes(v)) return false;                
      const t = segTypesById.get(String(v));
      return !!t && t.size > 0 && !t.has(supplierDocType);  
    });
  }, [segRulesLoaded, segmentOpts, ruledSegIds, country, segment, segTypesById, supplierDocType]);

  const sortedSegmentOpts = useMemo(() => {
    const disabled = new Set(disabledSegmentIds);
    const rank = (v: string): number => {
      if (segment.includes(v)) return 0;
      if (!disabled.has(v)) return 1;
      return ruledSegIds.has(v) ? 2 : 3;
    };
    return [...segmentOpts].sort((a, b) => {
      const d = rank(a.value) - rank(b.value);
      return d !== 0 ? d : String(a.label).localeCompare(String(b.label));
    });
  }, [segmentOpts, disabledSegmentIds, segment, ruledSegIds]);

  const segmentDisabledHint = country
    ? `not available for a ${supplierDocType === 'domestic' ? 'Domestic' : 'International'} supplier — no matching rule in the Document Control Panel`
    : 'no document rule defined in the Document Control Panel yet';
  const [contactName, setContactName] = useState('');
  const [designation, setDesignation] = useState('');
  const [contactNo,   setContactNo]   = useState('');
  const [email,       setEmail]       = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [primarySaved, setPrimarySaved] = useState(false);
  type PrimarySnapshot = { name: string; designation: string; phone: string; email: string; whatsapp: boolean; attachmentName: string; attachmentHref: string };
  const [savedPrimary, setSavedPrimary] = useState<PrimarySnapshot | null>(null);
  const [savingPrimary, setSavingPrimary] = useState(false);
  const [editingPrimary, setEditingPrimary] = useState(false);
  const primaryCardRef = useRef<HTMLDivElement>(null);
  const [primaryAttachmentPath, setPrimaryAttachmentPath] = useState<string>('');
  const [primaryAttachmentUrl, setPrimaryAttachmentUrl] = useState<string>('');

  type ContactRow = {
    id: number;
    name: string;
    designation: string;
    phone: string;
    email: string;
    whatsapp: boolean;
    attachmentName: string;
    attachmentPath?: string;
    attachmentUrl?: string;
    attachmentFile?: File | null;
  };
  const [extraContacts, setExtraContacts] = useState<ContactRow[]>([]);

  const [contactPopupOpen, setContactPopupOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<Omit<ContactRow, 'id'>>({
    name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '', attachmentFile: null,
  });

  const [ddRows,      setDdRows]      = useState<DueDiligenceRow[]>(SEED_DD);
  const [ownerRows,   setOwnerRows]   = useState<OwnerKycRow[]>([]);
  const [licenseRows, setLicenseRows] = useState<TradeLicenseRow[]>(SEED_TRADE_LICENSE);
  const [bankRows,    setBankRows]    = useState<BankRow[]>([]);
  const [gstRows,     setGstRows]     = useState<GstScrutinyRow[]>([]);

  type DdDraft     = Omit<DueDiligenceRow, 'id' | 'code'>;
  type OwnerDraft  = Omit<OwnerKycRow,    'id' | 'code'>;
  type LicDraft    = Omit<TradeLicenseRow,'id' | 'code'>;
  type BankDraft   = Omit<BankRow,        'id'>;
  type GstDraft    = Omit<GstScrutinyRow, 'id'>;
  const EMPTY_DD_DRAFT: DdDraft = { documentName: '', issuingAuthority: '', expiry: 'N/A', mandatory: false, file: null, fileName: '' };
  const EMPTY_OWNER_DRAFT: OwnerDraft = { documentName: '', issuingAuthority: '', documentNumber: '', issueDate: '', expiry: '', status: 'Active', file: null, fileName: '' };
  const EMPTY_LIC_DRAFT: LicDraft = { licenseType: '', licenseNumber: '', issuingAuthority: '', issueDate: '', expiryDate: '', file: null, fileName: '' };
  const EMPTY_BANK_DRAFT: BankDraft = { bankName: '', branchName: '', accountNumber: '', ifsc: '', branchAddress: '', chequeFile: null, chequeFileName: '' };
  const EMPTY_GST_DRAFT: GstDraft = { gstNumber: '', status: 'Active', lastFilingDate: '', prevNonGst2aInvoice: '', redFlags: '' };

  const [ddPopupOpen,    setDdPopupOpen]    = useState(false);
  const [ownerPopupOpen, setOwnerPopupOpen] = useState(false);
  const [licPopupOpen,   setLicPopupOpen]   = useState(false);
  const [bankPopupOpen,  setBankPopupOpen]  = useState(false);
  const [editingBankId,  setEditingBankId]  = useState<string | null>(null);
  const [gstPopupOpen,   setGstPopupOpen]   = useState(false);
  useEffect(() => {
    if (gstApplicable !== 'Yes' && kycTab === 'gst') setKycTab('bank');
  }, [gstApplicable, kycTab]);
  useEffect(() => {
    if (country && countryOpts.length === 0) return;
    const derived = supplierDocType === 'domestic' ? 'Yes' : 'No';
    setGstApplicable(derived);
    clearFieldError('gstApplicable');
    if (derived === 'No') { setGstNumber(''); clearFieldError('gstNumber'); }
  }, [supplierDocType, country, countryOpts]); 

  const [ddDraft,    setDdDraft]    = useState<DdDraft>(EMPTY_DD_DRAFT);
  const [ownerDraft, setOwnerDraft] = useState<OwnerDraft>(EMPTY_OWNER_DRAFT);
  const [licDraft,   setLicDraft]   = useState<LicDraft>(EMPTY_LIC_DRAFT);
  const [bankDraft,  setBankDraft]  = useState<BankDraft>(EMPTY_BANK_DRAFT);
  const [gstDraft,   setGstDraft]   = useState<GstDraft>(EMPTY_GST_DRAFT);

  const [licenseTypeOpts, setLicenseTypeOpts] = useState<Opt[]>([]);

  const [tradeDocRows, setTradeDocRows] = useState<TradeDocRow[]>([]);
  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }>>({});

  
  const [recentReminds, setRecentReminds] = useState<Record<number, number>>({});
  useEffect(() => {
    const expiries = Object.values(recentReminds);
    if (expiries.length === 0) return;
    const earliest = Math.min(...expiries);
    const wait = Math.max(50, earliest - Date.now() + 50);
    const id = window.setTimeout(() => {
      setRecentReminds(prev => {
        const now = Date.now();
        const fresh: Record<number, number> = {};
        for (const k in prev) if (prev[k] > now) fresh[+k] = prev[k];
        return fresh;
      });
    }, wait);
    return () => window.clearTimeout(id);
  }, [recentReminds]);
  const isReminderCooldown = (reqId?: number | null): boolean => !!reqId && (recentReminds[reqId] ?? 0) > Date.now();
  const reminderCooldownSeconds = (reqId?: number | null): number => {
    if (!reqId) return 0;
    return Math.max(0, Math.ceil(((recentReminds[reqId] ?? 0) - Date.now()) / 1000));
  };

  type ProductOpt = {
    value: string;             
    label: string;             
    code: string;
    name: string;
    hsn: string;
    segment: string;
    segmentId: number | null;  

    basePrice: string;
    gstPercentage: string;
  };
  const [productOpts,    setProductOpts]    = useState<ProductOpt[]>([]);
  const [gstPctOpts,     setGstPctOpts]     = useState<Opt[]>([]);
  const [productMappings, setProductMappings] = useState<ProductMappingRow[]>([]);
  const [mapPopupOpen,   setMapPopupOpen]   = useState(false);
  const [mappedListOpen, setMappedListOpen] = useState(false);

  type MapDraft = {
    productId: string;         
    productCode: string;
    productName: string;
    hsnSacCode: string;
    segment: string;
    batchSerialLot: string;
    purchasePrice: string;     
    gstPercentage: string;
    gstAmount: string;
    totalAmount: string;
  };
  const EMPTY_MAP_DRAFT: MapDraft = { productId: '', productCode: '', productName: '', hsnSacCode: '', segment: '', batchSerialLot: '', purchasePrice: '', gstPercentage: '', gstAmount: '', totalAmount: '' };
  const [mapDraft,       setMapDraft]       = useState<MapDraft>(EMPTY_MAP_DRAFT);
  const [mapEditingId,   setMapEditingId]   = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    type IdRow = { id: number | string };
    type NamedRow = IdRow & { name?: string | null };
    type Bundle = {
      vendor_types: NamedRow[];
      risk_levels: NamedRow[];
      vendor_behaviour: NamedRow[];
      segments: Array<IdRow & { name?: string | null; title?: string | null }>;
      compliance_behaviours: NamedRow[];
      classifications: NamedRow[];
      countries: NamedRow[];
      state_codes: Array<IdRow & {
        state_id: number | string;
        state_code: string;
        status?: string | null;
        state?: { id?: number; name?: string; country_id?: number | string } | null;
      }>;
      states: Array<IdRow & { name?: string | null; country_id?: number | string | null }>;
      license_name: NamedRow[];
      gst_percentage: Array<IdRow & { percentage?: number | string | null }>;
    };

    const toOpt = (rows: NamedRow[]): Opt[] =>
      (rows || [])
        .map(r => ({ value: String(r.id), label: String(r.name ?? '') }))
        .filter(o => o.value !== '' && o.label !== '');

    const hydrate = (b: Bundle) => {
      setVendorTypeOpts(toOpt(b.vendor_types));
      setRiskLevelOpts(toOpt(b.risk_levels));
      setBehaviourOpts(toOpt(b.vendor_behaviour));
      setSegmentOpts(
        (b.segments || [])
          .map(r => ({ value: String(r.id), label: String(r.title ?? r.name ?? '') }))
          .filter(o => o.value !== '' && o.label !== '')
      );
      setComplianceOpts(toOpt(b.compliance_behaviours));
      setClassificationOpts(toOpt(b.classifications));
      setCountryOpts(toOpt(b.countries));
      setStateCodeRows(
        (b.state_codes || [])
          .map(r => ({
            id: String(r.id),
            state_id: String(r.state_id ?? ''),
            state_code: String(r.state_code ?? ''),
            state_name: String(r.state?.name ?? ''),
            country_id: String(r.state?.country_id ?? ''),
          }))
          .filter(r => r.state_name !== '')
      );
      setStateRows(
        (b.states || [])
          .map(r => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            country_id: String(r.country_id ?? ''),
          }))
          .filter(r => r.name !== '')
      );
      setLicenseTypeOpts(
        (b.license_name || [])
          .map(r => ({ value: String(r.name ?? ''), label: String(r.name ?? '') }))
          .filter(o => o.value)
      );
      setGstPctOpts(
        (b.gst_percentage || [])
          .map(r => ({ value: String(r.percentage ?? ''), label: `${r.percentage ?? ''}%` }))
          .filter(o => o.value && o.value !== '')
      );
    };

    const cached = readVendorMasterBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setMastersLoading(false);
    }

    (async () => {
      try {
        const res = await api.get<Bundle>('/vendors/master-bundle');
        hydrate(res.data);
        writeVendorMasterBundle(res.data);
      } catch {
        // Network failed. With a cache hit the user keeps the cached options
        // (better than blanking a form they may be mid-way through); without
        // one the dropdowns stay empty and individual saves will surface
        // validation errors if a required option is missing.
      } finally {
        setMastersLoading(false);
      }
    })();
  }, []);

  const segmentDirtyRef = useRef(false);
  useEffect(() => {
    if (!segmentDirtyRef.current) {
      segmentDirtyRef.current = true;
      return;
    }
    setSegmentRefUploads(prev => {
      const kept: Record<string, SegRefUpload> = {};
      for (const [k, u] of Object.entries(prev)) {
        if (u?.url && !u.url.startsWith('blob:')) { kept[k] = u; continue; }
        try { URL.revokeObjectURL(u.url); } catch {}
      }
      return kept;
    });
  }, [segment]);

  useEffect(() => {
    if (step < 2 && !initialVendorId) return;

    const ids = (segment ?? [])
      .map(s => Number(s))
      .filter(n => Number.isFinite(n) && n > 0);
    if (ids.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setTradeDocRows([]); setSegmentDocKeys({}); return; }

    let cancelled = false;
    Promise.all([
      Promise.all(
        ids.map(id =>
          api.get(`/clm/segment-rules/for-segment/${id}`, { params: { document_type: supplierDocType } })
            .then(r => r.data?.data ?? {})
            .catch(() => ({}))
        )
      ),
      api.get('/clm/trade-doc-library/for-party/supplier')
        .then(r => Array.isArray(r.data?.data) ? r.data.data : [])
        .catch(() => [] as Array<{ code: string; name: string }>),
    ]).then(([results, partyDocs]) => {
      if (cancelled) return;
      const docKeyMap: Record<string, string[]> = {};
      results.forEach((r: any, i: number) => {
        const keys: string[] = [];
        for (const d of (Array.isArray(r?.dd)  ? r.dd  : [])) keys.push(`company::${d.code}`);
        for (const d of (Array.isArray(r?.kyc) ? r.kyc : [])) keys.push(`owner::${d.code}`);
        for (const d of (Array.isArray(r?.tl)  ? r.tl  : [])) keys.push(`license::${d.code}`);
        docKeyMap[String(ids[i])] = keys;
      });
      setSegmentDocKeys(docKeyMap);
      const mergeCat = (cat: 'kyc'|'dd'|'tl'|'td'|'qc'): SegDocRow[] => {
        const map = new Map<string, SegDocRow>();
        for (const r of results) {
          const rows: SegDocRow[] = Array.isArray(r?.[cat]) ? r[cat] : [];
          for (const d of rows) {
            const existing = map.get(d.code);
            if (!existing) { map.set(d.code, d); continue; }
            if (existing.requirement !== 'M' && d.requirement === 'M') {
              map.set(d.code, { ...existing, requirement: 'M' });
            }
          }
        }
        return Array.from(map.values());
      };
      const partyById = new Map<string, number>(
        (partyDocs as Array<{ code: string; id: number }>).map(p => [p.code, p.id]),
      );
      const mergedTd = mergeCat('td').filter(d => partyById.has(d.code));
      setSegmentDocs({
        kyc: mergeCat('kyc'),
        dd:  mergeCat('dd'),
        tl:  mergeCat('tl'),
        td:  mergedTd,
        qc:  mergeCat('qc'),
      });
      setTradeDocRows(mergedTd.map(d => ({
        code: d.code,
        name: d.name,
        db_id: partyById.get(d.code) ?? null,
        sendForSignature: d.requirement === 'M',
        status: 'N/A' as const,
        attachment: null,
        attachmentName: '',
      })));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, segment, supplierDocType]);

  const segGuardReady = !initialVendorId || (segment ?? [])
    .filter(s => Number.isFinite(Number(s)) && Number(s) > 0)
    .every(s => segmentDocKeys[String(s)] !== undefined);

  useEffect(() => {
    if (!bundledSegUploads || bundledSegUploads.length === 0) return;
    const CAT_TO_SUB: Record<string, string> = { dd: 'company', kyc: 'owner', tl: 'license' };
    const hydrated: Record<string, SegRefUpload> = {};
    for (const x of bundledSegUploads) {
      const sub = CAT_TO_SUB[x.category];
      if (!sub || !x.doc_code) continue;
      hydrated[`${sub}::${x.doc_code}`] = {
        file: null,
        url:  x.attachment_url || '',
        name: x.attachment_name || '',
        expiry: x.expiry_date || undefined,
      };
    }
    if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundledSegUploads]);

  useEffect(() => {
    if (!vendorId || tradeTab !== 'trade') return;
    let cancelled = false;
    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: vendorId, model_name: 'Vendor', sync: withSync ? 1 : 0 },
        });
        if (cancelled) return;
        const rows: Array<{
          id: number;
          status: TradeDocRow['status'];
          trade_doc_ids: number[];
          signed_document_paths?: Array<{ url?: string; path?: string; file_url?: string }> | string[] | null;
          signed_document_path?: string | null;
          signed_document_url?: string | null;
          certificate_path?: string | null;
          certificate_url?: string | null;
          file_url?: string | null;
          reminder_count?: number;
          last_reminder_sent_at?: string | null;
        }> = Array.isArray(r.data?.data) ? r.data.data : [];
        const map: Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }> = {};
        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i++) {
            const docId = Number(ids[i]);
            if (!docId || map[docId]) continue;
            const signedArr = row.signed_document_paths;
            let rawSignedUrl: string | null = null;
            if (Array.isArray(signedArr)) {
              const entry = signedArr[i] as { url?: string; path?: string; file_url?: string } | string | undefined;
              if (typeof entry === 'string') rawSignedUrl = entry;
              else if (entry && typeof entry === 'object') rawSignedUrl = entry.url || entry.file_url || entry.path || null;
            }
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_url || null;
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_path || null;
            const rawCertUrl = row.certificate_url || row.certificate_path || null;
            map[docId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl:      rawSignedUrl ? resolveFileUrl(rawSignedUrl) : undefined,
              certificateUrl: rawCertUrl   ? resolveFileUrl(rawCertUrl)   : undefined,
              reminderCount:  typeof row.reminder_count === 'number' ? row.reminder_count : undefined,
              lastReminderAt: row.last_reminder_sent_at ?? null,
            };
          }
        }
        setSigStatusByDoc(map);
      } catch { /* silent — polling failures shouldn't toast every 15s */ }
    };
    fetchAndUpdate(false);
    const iv = window.setInterval(() => fetchAndUpdate(true), 15000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [vendorId, step, tradeTab]);

  useEffect(() => {
    setTradeDocRows(prev => prev.map(r => {
      if (!r.db_id) return r;
      const info = sigStatusByDoc[r.db_id];
      if (!info) return r;
      return {
        ...r,
        status: info.status,
        signatureRequestId: info.signatureRequestId,
        signedUrl:      info.signedUrl      ?? r.signedUrl,
        certificateUrl: info.certificateUrl ?? r.certificateUrl,
        reminder_count:        info.reminderCount  ?? r.reminder_count        ?? 0,
        last_reminder_sent_at: info.lastReminderAt ?? r.last_reminder_sent_at ?? null,
      };
    }));
  }, [sigStatusByDoc]);

  useEffect(() => {
    if (!initialVendorId) return;
    type ApiAddress = {
      address_type?: string | null;
      address_line?: string | null; country_id?: number | null; state_id?: number | null;
      state_code?: string | null; city?: string | null; pincode?: string | null;
      google_location?: string | null;
      contact_name?: string | null; designation?: string | null; contact_no?: string | null;
      email?: string | null; whatsapp_enabled?: boolean;
      attachment_path?: string | null; attachment_url?: string | null;
    };
    type ApiExtra = {
      id: number; contact_name?: string | null; designation?: string | null;
      contact_no?: string | null; email?: string | null; whatsapp_enabled?: boolean;
      attachment_path?: string | null; attachment_url?: string | null;
    };
    type ApiDd = { id: number; code?: string | null; document_name?: string | null; issuing_authority?: string | null; expiry?: string | null; mandatory?: boolean; attachment_path?: string | null; attachment_url?: string | null };
    type ApiOwner = { id: number; code?: string | null; document_name?: string | null; issuing_authority?: string | null; document_number?: string | null; issue_date?: string | null; expiry?: string | null; status?: string | null; attachment_path?: string | null; attachment_url?: string | null };
    type ApiTl = { id: number; code?: string | null; license_type_id?: number | null; license_type_name?: string | null; license_number?: string | null; issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null; attachment_path?: string | null; attachment_url?: string | null };
    type ApiBank = { id: number; bank_name?: string | null; branch_name?: string | null; account_number?: string | null; ifsc?: string | null; branch_address?: string | null; cheque_path?: string | null; cheque_url?: string | null };
    type ApiGst = { id: number; gst_number?: string | null; status?: string | null; scrutiny_date?: string | null; last_filing_date?: string | null; prev_non_gst_2a_invoice?: string | null; red_flags?: string | null };
    type ApiMapping = { id: number; product_id?: number | null; product_code?: string | null; product_name?: string | null; batch_serial_lot?: string | null; purchase_price?: number | string | null; gst_percentage?: number | string | null; gst_amount?: number | string | null; total_amount?: number | string | null };
    type ApiVendor = {
      id: number;
      vendor_code?: string | null;
      company_name?: string | null; legal_name?: string | null; website?: string | null;
      gst_applicable?: string | null; gst_number?: string | null;
      vendor_type_id?: number | null; vendor_type_name?: string | null; risk_level_id?: number | null;
      vendor_behaviour_id?: number | null; segment_id?: number | null;
      segment_ids?: Array<number | string> | string | null;
      compliance_behaviour_id?: number | null;
      classification_id?: number | null;
      primary_address?: ApiAddress | null;
      extra_contacts?: ApiExtra[];
      due_diligence?: ApiDd[];
      owner_kyc?: ApiOwner[];
      trade_licenses?: ApiTl[];
      bank_accounts?: ApiBank[];
      gst_scrutiny?: ApiGst[];
      product_mappings?: ApiMapping[];
    };

    const basename = (p?: string | null): string => {
      if (!p) return '';
      const last = String(p).split('/').pop() ?? '';
      const sep = last.indexOf('__');
      return sep >= 0 ? last.slice(sep + 2) : last;
    };
    const numStr = (n?: number | null): string => (n ?? '') === '' || n == null ? '' : String(n);

    (async () => {
      const minShimmerMs = 350; 
      const t0 = performance.now();
      try {
        const res = await api.get<{ data: ApiVendor; segment_uploads?: { data?: any[] } }>(`/vendors/${initialVendorId}`);
        const root = res.data ?? ({} as { data?: ApiVendor; segment_uploads?: { data?: any[] } });
        const v = root.data;
        if (!v) return;
        if ((v.product_mappings ?? []).length > 0) await fetchProductOptsIfNeeded();

        const refs: any[] = Array.isArray(root.segment_uploads?.data) ? root.segment_uploads!.data! : [];
        setBundledSegUploads(refs);

        setVendorCode(v.vendor_code ?? '');
        setCompanyName(v.company_name ?? '');
        setLegalName(v.legal_name ?? '');
        setWebsite(v.website ?? '');
        setGstApplicable(v.gst_applicable === 'Yes' ? 'Yes' : 'No');
        setGstNumber(v.gst_number ?? '');
        setVendorType(v.vendor_type_name ?? '');
        setRiskLevel(numStr(v.risk_level_id));
        setVendorBehaviour(numStr(v.vendor_behaviour_id));
        const fromIds: string[] = Array.isArray((v as any).segment_ids)
          ? (v as any).segment_ids.map((x: any) => String(x)).filter(Boolean)
          : typeof (v as any).segment_ids === 'string'
            ? (v as any).segment_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];
        const segIds: string[] = fromIds.length ? fromIds : (v.segment_id ? [String(v.segment_id)] : []);
        setSegment(segIds);
        savedSegmentRef.current = segIds;
        setLockedSegments(Array.isArray((v as any).locked_segments) ? (v as any).locked_segments.map(String) : []);
        setLockedSegmentReasons((v as any).locked_segment_reasons && typeof (v as any).locked_segment_reasons === 'object' ? (v as any).locked_segment_reasons : {});
        setLockedSegmentReasons((v as any).locked_segment_reasons && typeof (v as any).locked_segment_reasons === 'object' ? (v as any).locked_segment_reasons : {});
        setStateLocked(!!(v as any).state_locked);
        setSegReqKeys((v as any).segment_required_doc_keys && typeof (v as any).segment_required_doc_keys === 'object' ? (v as any).segment_required_doc_keys : {});
        setUploadedKeys(Array.isArray((v as any).uploaded_doc_keys) ? (v as any).uploaded_doc_keys : []);
        setComplianceBehaviour(numStr(v.compliance_behaviour_id));
        setClassificationId(numStr(v.classification_id));

        const pa = v.primary_address;
        if (pa) {
          setAddressType(pa.address_type || 'Registered Office');
          setRegisteredOffice(pa.address_line ?? '');
          setCountry(numStr(pa.country_id));
          setState(numStr(pa.state_id));
          setStateCode(pa.state_code ?? '');
          setCity(pa.city ?? '');
          setPincode(pa.pincode ?? '');
          setGoogleLocation(pa.google_location ?? '');
          setContactName(pa.contact_name ?? '');
          setDesignation(pa.designation ?? '');
          setContactNo(pa.contact_no ?? '');
          setEmail(pa.email ?? '');
          setWhatsappEnabled(pa.whatsapp_enabled ?? true);
          setPrimaryAttachmentPath(pa.attachment_path ?? '');
          setPrimaryAttachmentUrl(pa.attachment_url ?? '');
          if ((pa.contact_name ?? '').trim() || (pa.email ?? '').trim() || (pa.contact_no ?? '').trim()) {
            setSavedPrimary({
              name: pa.contact_name ?? '',
              designation: pa.designation ?? '',
              phone: pa.contact_no ?? '',
              email: pa.email ?? '',
              whatsapp: pa.whatsapp_enabled ?? true,
              attachmentName: basename(pa.attachment_path),
              attachmentHref: pa.attachment_url || (pa.attachment_path ? resolveFileUrl(pa.attachment_path) : ''),
            });
          }
        }
        setExtraContacts((v.extra_contacts ?? []).map(c => ({
          id: c.id,
          name: c.contact_name ?? '',
          designation: c.designation ?? '',
          phone: c.contact_no ?? '',
          email: c.email ?? '',
          whatsapp: c.whatsapp_enabled ?? true,
          attachmentName: basename(c.attachment_path),
          attachmentPath: c.attachment_path ?? undefined,
          attachmentUrl: c.attachment_url ?? undefined,
        })));

        setDdRows((v.due_diligence ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          documentName: r.document_name ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          expiry: r.expiry ?? '',
          mandatory: !!r.mandatory,
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setOwnerRows((v.owner_kyc ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          documentName: r.document_name ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          documentNumber: r.document_number ?? '',
          issueDate: r.issue_date ?? '',
          expiry: r.expiry ?? '',
          status: (r.status === 'Inactive' ? 'Inactive' : 'Active'),
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setLicenseRows((v.trade_licenses ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          licenseType: r.license_type_id != null ? String(r.license_type_id) : (r.license_type_name ?? ''),
          licenseNumber: r.license_number ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          issueDate: r.issue_date ?? '',
          expiryDate: r.expiry_date ?? '',
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setBankRows((v.bank_accounts ?? []).map(r => ({
          id: String(r.id),
          bankName: r.bank_name ?? '',
          branchName: r.branch_name ?? '',
          accountNumber: r.account_number ?? '',
          ifsc: r.ifsc ?? '',
          branchAddress: r.branch_address ?? '',
          chequeFile: null,
          chequeFileName: basename(r.cheque_path),
          existingPath: r.cheque_path ?? undefined,
          existingUrl: r.cheque_url ?? undefined,
        })));
        setGstRows((v.gst_scrutiny ?? []).map(r => ({
          id: String(r.id),
          gstNumber: r.gst_number ?? '',
          status: (r.status === 'Active' ? 'Active' : 'Inactive'),
          scrutinyDate: r.scrutiny_date ?? '',
          lastFilingDate: r.last_filing_date ?? '',
          prevNonGst2aInvoice: r.prev_non_gst_2a_invoice ?? '',
          redFlags: r.red_flags ?? '',
        })).reverse());   

        setProductMappings((v.product_mappings ?? []).map(m => ({
          id: String(m.id),
          productId: m.product_id ?? null,
          productCode: m.product_code ?? '',
          productName: m.product_name ?? '',
          hsnSacCode: '',
          segment: '',
          batchSerialLot: m.batch_serial_lot ?? '',
          purchasePrice: Number(m.purchase_price ?? 0),
          gstPercentage: Number(m.gst_percentage ?? 0),
          gstAmount: Number(m.gst_amount ?? 0),
          totalAmount: Number(m.total_amount ?? 0),
        })));
        // productOpts already fetched in parallel above — Map Products
        // backfill effect joins on productId once both arrays are
        // populated, so no extra fetch needed here.
      } catch {
        toast.error('Load failed', 'Could not load the supplier — closing the form.');
        onClose();
      } finally {
        const elapsed = performance.now() - t0;
        const wait = Math.max(0, minShimmerMs - elapsed);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        setLoadingEdit(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVendorId]);

  const labelFor = (id: string, opts: Opt[]): string =>
    opts.find(o => o.value === id)?.label ?? '';

  const FIELD_LABELS: Record<string, string> = {
    companyName: 'Company Name', legalName: 'Legal Name', website: 'Company Website',
    gstNumber: 'GST Number', gstApplicable: 'GST Applicable',
    vendorType: 'Supplier Type', riskLevel: 'Risk Level', vendorBehaviour: 'Supplier Behaviour',
    segment: 'Supplier Segment', complianceBehaviour: 'Compliance Behaviour',
    registeredOffice: 'Registered Office Address', country: 'Country', state: 'State',
    stateCode: 'State Code', city: 'City', contactName: 'Contact Person Name',
    designation: 'Designation', contactNo: 'Contact No', email: 'Email', pincode: 'Pincode',
    googleLocation: 'Google Location',
  };

  const flagErrors = (errs: Record<string, string>) => {
    setFieldErrors(prev => ({ ...prev, ...errs }));
    const keys = Object.keys(errs);
    const isRequiredMsg = (m: string) => /\bis required$/i.test((m ?? '').trim());
    const allRequired = keys.length > 0 && keys.every(k => isRequiredMsg(errs[k]));
    if (allRequired) {
      toast.error('Missing required fields', `Please check: ${keys.map(k => FIELD_LABELS[k] ?? k).join(', ')}`);
    } else {
      const lines = keys.map(k => {
        const label = FIELD_LABELS[k] ?? k;
        const msg = (errs[k] ?? '').trim() || `${label} is invalid`;
        return msg.toLowerCase().startsWith(label.toLowerCase()) ? msg : `${label}: ${msg}`;
      });
      toast.error(keys.length === 1 ? 'Invalid value' : 'Please fix these fields', lines.join(' · '));
    }
    setTimeout(() => {
      document.querySelector('.avm-field.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const saveIdentity = async (): Promise<boolean> => {
    const errs: Record<string, string> = {};
    if (!companyName.trim()) errs.companyName         = 'Company Name is required';
    if (!legalName.trim())   errs.legalName           = 'Company Legal Name is required';
    if (!vendorType)         errs.vendorType          = 'Supplier Type is required';
    if (!riskLevel)          errs.riskLevel           = 'Risk Level is required';
    if (!vendorBehaviour)    errs.vendorBehaviour     = 'Supplier Behaviour is required';
    if (!Array.isArray(segment) || segment.length === 0)
                              errs.segment             = 'Select at least one supplier segment';
    else if (segRulesLoaded && country) {
      const label = supplierDocType === 'domestic' ? 'Domestic' : 'International';
      const mismatched = segment.filter(id => {
        const t = segTypesById.get(String(id));
        return t && t.size > 0 && !t.has(supplierDocType);
      });
      if (mismatched.length) {
        const names = mismatched.map(id => segmentOpts.find(o => o.value === id)?.label ?? id);
        errs.segment = `${names.join(', ')} ${mismatched.length > 1 ? 'have' : 'has'} no ${label} rule — this is a ${label} supplier, so the segment's document type must match.`;
      }
    }
    if (!complianceBehaviour) errs.complianceBehaviour = 'Compliance Behaviour is required';
    if (website)             { const e = validateWebsite(website); if (e) errs.website = e; }
    if (gstApplicable === 'Yes') {
      if (!gstNumber.trim()) errs.gstNumber = 'GST Number is required';
      else { const e = validateGstin(gstNumber); if (e) errs.gstNumber = e; }
      if (!errs.gstNumber && gstNumber.trim() && stateCode.trim()) {
        const expected = stateCode.trim().padStart(2, '0');
        if (gstNumber.trim().slice(0, 2) !== expected) {
          errs.gstNumber = `GST Number must start with the state code ${expected}.`;
        }
      }
    }
    if (!registeredOffice.trim()) errs.registeredOffice = 'Registered Office Address is required';
    if (!country)                 errs.country          = 'Country is required';
    if (googleLocation.trim() && !mapsLinkOk) {
      errs.googleLocation = 'Enter a full link starting with https://';
    }
    if (!state) errs.state = 'State is required';
    if (supplierDocType === 'domestic') {
      if (!stateCode.trim()) errs.stateCode = 'State Code is required';
      else if (!/^\d{1,2}$/.test(stateCode.trim())) errs.stateCode = 'State Code must be a 1–2 digit GST code';
    }
    if (!city.trim())             errs.city             = 'City is required';
    if (Object.keys(errs).length) { flagErrors(errs); return false; }

    setSaving(true);
    try {
      const identityPayload = {
        id: vendorId,
        company_name: companyName,
        legal_name: legalName || null,
        website: website || null,
        gst_applicable: gstApplicable,
        gst_number: gstApplicable === 'Yes' ? (gstNumber.trim() || null) : null,
        vendor_type: vendorType || null,
        risk_level_id: riskLevel ? Number(riskLevel) : null,
        vendor_behaviour_id: vendorBehaviour ? Number(vendorBehaviour) : null,
        segment_id: (segment ?? [])[0] ? Number((segment ?? [])[0]) : null,
        segment_ids: (segment ?? []).map(Number),
        compliance_behaviour_id: complianceBehaviour ? Number(complianceBehaviour) : null,
        classification_id: classificationId ? Number(classificationId) : null,
        address: {
          address_line: registeredOffice || null,
          country_id: country ? Number(country) : null,
          state_id: state ? Number(state) : null,
          state_code: stateCode || null,
          city: city || null,
          pincode: pincode || null,
          google_location: googleLocation.trim() || null,
        },
      };

      const attempt = async (): Promise<boolean> => {
        const res = await api.post<{ data: { id: number } }>('/vendors/step/identity', identityPayload);
        setVendorId(res.data?.data?.id ?? vendorId);
        const returnedCode = (res.data?.data as Record<string, unknown> | undefined)?.vendor_code;
        if (typeof returnedCode === 'string' && returnedCode) setVendorCode(returnedCode);
        setFieldErrors({});
        savedSegmentRef.current = segment;
        toast.success('Identity saved', 'Vendor identity details captured');
        return true;
      };

      try {
        return await attempt();
      } catch (e: any) {
        const d = e?.response?.data;
        if (e?.response?.status === 409 && d?.requires_doc_confirmation) {
          const docs = (d.orphan_documents ?? []) as Array<{ name: string; category?: string }>;
          const list = docs.map(x => `${x.name}${x.category ? ` (${x.category})` : ''}`).join(', ');
          toast.error(
            'Cannot remove segment',
            `${docs.length > 1 ? 'Documents are' : 'A document is'} uploaded against ${docs.length > 1 ? 'segments' : 'a segment'} you removed${list ? `: ${list}` : ''}. Delete ${docs.length > 1 ? 'them' : 'it'} in KYC / Due Diligence first, then remove the segment.`,
          );
          setSegment(savedSegmentRef.current);
          return false;   
        }
        throw e;   
      }
    } catch (err: unknown) {
      const res = (err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
      const msg = res?.message || 'Could not save vendor identity';
      const apiErrs = res?.errors ?? {};
      const mapped: Record<string, string> = {};
      if (apiErrs.gst_number?.[0]) mapped.gstNumber = apiErrs.gst_number[0];
      if (Object.keys(mapped).length) {
        setFieldErrors(prev => ({ ...prev, ...mapped }));
        setTimeout(() => {
          document.querySelector('.avm-field.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveContacts = async (opts?: { outerSpinner?: boolean }): Promise<boolean> => {
    const useOuter = opts?.outerSpinner !== false;
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    const errs: Record<string, string> = {};
    if (!registeredOffice.trim())  errs.registeredOffice = 'Registered Office Address is required';
    if (!country)                  errs.country          = 'Country is required';
    if (googleLocation.trim() && !mapsLinkOk) {
      errs.googleLocation = 'Enter a full link starting with https://';
    }
    if (!state) errs.state = 'State is required';
    if (supplierDocType === 'domestic') {
      if (!stateCode.trim()) errs.stateCode = 'State Code is required';
      else if (!/^\d{1,2}$/.test(stateCode.trim())) errs.stateCode = 'State Code must be a 1–2 digit GST code';
    }
    if (!city.trim())              errs.city             = 'City is required';
    if (!contactName.trim())       errs.contactName      = 'Contact Person Name is required';
    if (!designation.trim())       errs.designation      = 'Designation is required';
    if (!contactNo.trim())         errs.contactNo        = 'Contact No is required';
    if (!email.trim())             errs.email            = 'Email is required';
    if (!errs.email && email)      { const e = validateEmail(email);              if (e) errs.email     = e; }
    if (!errs.contactNo && contactNo) { const e = validateContactNumber(contactNo, 'Contact No', supplierDocType === 'domestic'); if (e) errs.contactNo = e; }
    if (pincode)                   { const e = validatePincode(pincode);          if (e) errs.pincode   = e; }
    if (Object.keys(errs).length) { flagErrors(errs); return false; }

    if (useOuter) setSaving(true);
    try {
      const fd = new FormData();
      fd.append('_method', 'PUT');
      const pa: Record<string, string> = {
        address_type: addressType,
        address_line: registeredOffice,
        country_id: country ? String(Number(country)) : '',
        state_id:   state   ? String(Number(state))   : '',
        state_code: stateCode,
        city,
        pincode: pincode || '',
        google_location: googleLocation.trim(),
        contact_name: contactName,
        designation,
        contact_no: contactNo,
        email,
        whatsapp_enabled: whatsappEnabled ? '1' : '0',
      };
      Object.entries(pa).forEach(([k, v]) => fd.append(`primary_address[${k}]`, v));
      if (attachment) fd.append('primary_attachment', attachment);
      else if (primaryAttachmentPath) fd.append('primary_address[attachment_path]', primaryAttachmentPath);

      const { data } = await api.post(`/vendors/${vendorId}/step/contacts`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const savedPa = data?.data?.primary_address as { attachment_path?: string; attachment_url?: string } | undefined;
      setPrimaryAttachmentPath(savedPa?.attachment_path ?? '');
      setPrimaryAttachmentUrl(savedPa?.attachment_url ?? '');
      setSavedPrimary({
        name: contactName, designation, phone: contactNo, email,
        whatsapp: whatsappEnabled,
        attachmentName: attachment?.name ?? (savedPa?.attachment_path ? (savedPa.attachment_path.split('/').pop() ?? '') : ''),
        attachmentHref: savedPa?.attachment_url || (savedPa?.attachment_path ? resolveFileUrl(savedPa.attachment_path) : ''),
      });
      if (attachment) setAttachment(null);
      setFieldErrors({});
      toast.success('Contacts saved', 'Address & contact persons captured');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save contacts';
      toast.error('Save failed', msg);
      return false;
    } finally {
      if (useOuter) setSaving(false);
    }
  };

  const saveKyc = async (opts?: { silentToast?: boolean }): Promise<boolean> => {
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    const missingDd = ddRows.filter(r => r.mandatory && !r.fileName);
    if (missingDd.length) {
      toast.error('Upload required documents', `Missing file on: ${missingDd.map(r => r.code).join(', ')}`);
      return false;
    }

    const fd = new FormData();
    ddRows.forEach((r, i) => {
      fd.append(`due_diligence[${i}][code]`, r.code);
      fd.append(`due_diligence[${i}][document_name]`, r.documentName);
      fd.append(`due_diligence[${i}][issuing_authority]`, r.issuingAuthority || '');
      fd.append(`due_diligence[${i}][expiry]`, r.expiry || '');
      fd.append(`due_diligence[${i}][mandatory]`, r.mandatory ? '1' : '0');
      if (r.file) fd.append(`dd_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`due_diligence[${i}][existing_path]`, r.existingPath);
    });
    ownerRows.forEach((r, i) => {
      fd.append(`owner_kyc[${i}][code]`, r.code);
      fd.append(`owner_kyc[${i}][document_name]`, r.documentName);
      fd.append(`owner_kyc[${i}][issuing_authority]`, r.issuingAuthority || '');
      fd.append(`owner_kyc[${i}][document_number]`, r.documentNumber || '');
      if (r.issueDate) fd.append(`owner_kyc[${i}][issue_date]`, r.issueDate);
      fd.append(`owner_kyc[${i}][expiry]`, r.expiry || '');
      fd.append(`owner_kyc[${i}][status]`, r.status);
      if (r.file) fd.append(`owner_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`owner_kyc[${i}][existing_path]`, r.existingPath);
    });
    licenseRows.forEach((r, i) => {
      fd.append(`trade_licenses[${i}][code]`, r.code);
      const ltId = Number(r.licenseType);
      if (Number.isInteger(ltId) && ltId > 0) {
        fd.append(`trade_licenses[${i}][license_type_id]`, String(ltId));
      }
      fd.append(`trade_licenses[${i}][license_number]`, r.licenseNumber || '');
      fd.append(`trade_licenses[${i}][issuing_authority]`, r.issuingAuthority || '');
      if (r.issueDate)  fd.append(`trade_licenses[${i}][issue_date]`, r.issueDate);
      if (r.expiryDate) fd.append(`trade_licenses[${i}][expiry_date]`, r.expiryDate);
      if (r.file) fd.append(`tl_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`trade_licenses[${i}][existing_path]`, r.existingPath);
    });

    setSaving(true);
    try {
      await api.post(`/vendors/${vendorId}/step/kyc`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFieldErrors({});
      if (!opts?.silentToast) {
        toast.success(
          `${KYC_TAB_TITLE[kycTab] ?? 'KYC'} saved`,
          KYC_TAB_SUB[kycTab] ?? 'Details captured',
        );
      }
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save KYC';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveProducts = async (): Promise<boolean> => {
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    if (productMappings.length === 0) {
      toast.error('No products mapped', 'Map at least one product before saving the vendor.');
      return false;
    }
    setSaving(true);
    try {
      await api.post(`/vendors/${vendorId}/step/products`, {
        mappings: productMappings.map(m => ({
          product_id: m.productId,
          batch_serial_lot: m.batchSerialLot || null,
          purchase_price: m.purchasePrice,
          gst_percentage: m.gstPercentage,
          gst_amount: m.gstAmount,
          total_amount: m.totalAmount,
        })),
      });
      toast.success('Vendor saved', 'Products mapped — vendor is now Active');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save product mappings';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (saving || advancing) return;
    setAdvancing(true);
    try {
      if (step === 1 && idTab === 'identification') {
        const ok = await saveIdentity();
        if (ok) setIdTab('address');
      } else if (step === 1 && idTab === 'address') {
        const ok = await saveContacts();
        if (ok) setStep(2);
      } else if (step === 2) {
        if (kycTab === 'bank' && bankRows.length === 0) {
          toast.error('Bank Details required', 'Add at least one bank account before continuing.');
          return;
        }
        if (kycTab === 'gst' && gstApplicable === 'Yes' && gstRows.length === 0) {
          toast.error('GST Scrutiny required', 'Add at least one GST Scrutiny record for a domestic supplier before continuing.');
          return;
        }
        const ok = await saveKyc();
        if (!ok) return;
        const idx = kycTabOrder.indexOf(kycTab);
        if (idx >= 0 && idx < kycTabOrder.length - 1) {
          setKycTab(kycTabOrder[idx + 1]);
        }
        // Last KYC sub-tab is the final step — the Save/Update button
        // (finishSupplier) closes the wizard; there is no Product step to
        // advance to here.
      }
    } finally {
      setAdvancing(false);
    }
  };

  const goPrev = () => {
    if (step > 2) { setStep((step - 1) as StepKey); return; }
    if (step === 2) {
      const idx = kycTabOrder.indexOf(kycTab);
      if (idx > 0) { setKycTab(kycTabOrder[idx - 1]); return; }   
      setStep(1);
      setIdTab('address');
      return;
    }
    if (step === 1 && idTab === 'address') setIdTab('identification');
    // step 1 / identification is the very first tab — nothing before it.
  };

  const finishSupplier = async () => {
    if (saving) return;
    if (bankRows.length === 0) {
      toast.error('Bank Details required', 'Add at least one bank account before saving the supplier.');
      setKycTab('bank');
      return;
    }
    if (gstApplicable === 'Yes' && gstRows.length === 0) {
      toast.error('GST Scrutiny required', 'Add at least one GST Scrutiny record for a domestic supplier before saving.');
      setKycTab('gst');
      return;
    }
    const okKyc = await saveKyc({ silentToast: true });
    if (!okKyc) return;
    if (productMappings.length > 0) {
      const okProd = await saveProducts();
      if (!okProd) return;
    }
    toast.success(
      isEdit ? 'Supplier updated' : 'Supplier saved',
      `${vendorCode ? vendorCode + ' — ' : ''}${companyName.trim() || 'Supplier'} completed and saved.`,
    );
    onSubmit({
      companyName, legalName, vendorType, website, gstApplicable, gstNumber, riskLevel,
      vendorBehaviour, segment, complianceBehaviour,
      registeredOffice, country, state, stateCode, city, pincode, googleLocation,
      contactName, designation, contactNo, email, whatsappEnabled,
      dueDiligence: ddRows,
      ownerKyc: ownerRows,
      tradeLicenses: licenseRows,
      bankAccounts: bankRows,
      gstScrutiny: gstRows,
      tradeDocuments: tradeDocRows,
      productMappings,
      mappedProductCodes: productMappings.map(m => m.productCode).filter(Boolean),
    });
  };

  const nextCode = (prefix: string, rows: Array<{ code: string }>) => {
    let max = 0;
    const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
    for (const r of rows) {
      const m = re.exec(r.code);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  };
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const attachFileToDd = (id: string, file: File) => {
    const err = validateVendorUpload(file);
    if (err) { toast.error(err.title, err.body); return; }
    setDdRows(prev => prev.map(r => r.id === id ? { ...r, file, fileName: file.name } : r));
  };
  const attachFileToLicense = (id: string, file: File) => {
    const err = validateVendorUpload(file);
    if (err) { toast.error(err.title, err.body); return; }
    setLicenseRows(prev => prev.map(r => r.id === id ? { ...r, file, fileName: file.name } : r));
  };

  const openDdPopup = () => { setDdDraft(EMPTY_DD_DRAFT); setDdPopupOpen(true); };
  const saveDdDraft = () => {
    if (!ddDraft.documentName.trim()) { toast.error('Missing field', 'DD Document Name is required'); return; }
    if (!ddDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    const row: DueDiligenceRow = { id: uid(), code: nextCode('DD', ddRows), ...ddDraft };
    setDdRows(prev => [...prev, row]);
    setDdPopupOpen(false);
    toast.success('Document added', `${row.code} ${row.documentName} added`);
  };
  const removeDdRow = async (id: string) => {
    const ok = await confirm({
      title: 'Remove Due Diligence Document?',
      message: 'This due-diligence document will be removed from this supplier. It is deleted for good once you save.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    setDdRows(prev => prev.filter(r => r.id !== id));
  };

  const openOwnerPopup = () => { setOwnerDraft(EMPTY_OWNER_DRAFT); setOwnerPopupOpen(true); };
  const saveOwnerDraft = () => {
    if (!ownerDraft.documentName.trim())     { toast.error('Missing field', 'KYC Document Name is required'); return; }
    if (!ownerDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    if (!ownerDraft.fileName)                { toast.error('Missing file', 'Please upload the KYC document'); return; }
    const row: OwnerKycRow = { id: uid(), code: nextCode('KYC', ownerRows), ...ownerDraft };
    setOwnerRows(prev => [...prev, row]);
    setOwnerPopupOpen(false);
    toast.success('Owner KYC added', `${row.code} ${row.documentName} added`);
  };
  const removeOwnerRow = async (id: string) => {
    const ok = await confirm({
      title: 'Remove Owner KYC Document?',
      message: 'This KYC document will be removed from this supplier. It is deleted for good once you save.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    setOwnerRows(prev => prev.filter(r => r.id !== id));
  };

  const openLicPopup = () => {
    setLicDraft(EMPTY_LIC_DRAFT);
    setLicPopupOpen(true);
    // license_name options are now seeded from the master bundle on mount
    // (see hydrate() in the bundled-fetch useEffect above), so no fetch
    // is needed here. The popup opens with the dropdown pre-populated.
  };
  const saveLicDraft = () => {
    if (!licDraft.licenseType.trim())   { toast.error('Missing field', 'License Type is required'); return; }
    if (!licDraft.licenseNumber.trim()) { toast.error('Missing field', 'License Number is required'); return; }
    if (!licDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    if (!licDraft.issueDate)            { toast.error('Missing field', 'Issue Date is required'); return; }
    if (!licDraft.expiryDate)           { toast.error('Missing field', 'Expiry Date is required'); return; }
    if (!licDraft.fileName)             { toast.error('Missing file', 'Please upload the license document'); return; }
    const row: TradeLicenseRow = { id: uid(), code: nextCode('TL', licenseRows), ...licDraft };
    setLicenseRows(prev => [...prev, row]);
    setLicPopupOpen(false);
    toast.success('Trade license added', `${row.code} ${row.licenseType} added`);
  };
  const removeLicRow = async (id: string) => {
    const ok = await confirm({
      title: 'Remove Trade License?',
      message: 'This trade license will be removed from this supplier. It is deleted for good once you save.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    setLicenseRows(prev => prev.filter(r => r.id !== id));
  };

  const lastName = (p?: string | null): string => {
    const f = (p ?? '').split('/').pop() ?? '';
    return f.includes('__') ? f.slice(f.indexOf('__') + 2) : f;
  };
  type ApiBankRow = { id: number; bank_name?: string | null; branch_name?: string | null; account_number?: string | null; ifsc?: string | null; branch_address?: string | null; cheque_path?: string | null; cheque_url?: string | null };
  type ApiGstRow = { id: number; gst_number?: string | null; status?: string | null; scrutiny_date?: string | null; last_filing_date?: string | null; prev_non_gst_2a_invoice?: string | null; red_flags?: string | null };

  const openBankPopup = () => { setEditingBankId(null); setBankDraft(EMPTY_BANK_DRAFT); setBankPopupOpen(true); };
  const openBankEdit = (row: BankRow) => {
    setEditingBankId(row.id);
    setBankDraft({
      bankName: row.bankName, branchName: row.branchName,
      accountNumber: row.accountNumber, ifsc: row.ifsc,
      branchAddress: row.branchAddress,
      chequeFile: null, chequeFileName: row.chequeFileName,
      existingPath: row.existingPath, existingUrl: row.existingUrl,
    });
    setBankPopupOpen(true);
  };
  const saveBankDraft = async () => {
    if (!bankDraft.bankName.trim())      { toast.error('Missing field', 'Bank Name is required'); return; }
    if (!bankDraft.branchName.trim())    { toast.error('Missing field', 'Branch is required'); return; }
    if (!bankDraft.accountNumber.trim()) { toast.error('Missing field', 'Account Number is required'); return; }
    const routingLabel = supplierDocType === 'international' ? 'SWIFT Code' : 'IFSC Code';
    if (!bankDraft.ifsc.trim())          { toast.error('Missing field', routingLabel + ' is required'); return; }
    if (!bankDraft.chequeFile && !bankDraft.existingPath) { toast.error('Missing field', 'Cancelled Cheque is required'); return; }
    const accErr = validateAccountNumber(bankDraft.accountNumber, 'Account Number', supplierDocType === 'international');
    if (accErr) { toast.error('Invalid Account Number', accErr); return; }
    const ifscErr = supplierDocType === 'international' ? validateSwift(bankDraft.ifsc) : validateIfsc(bankDraft.ifsc);
    if (ifscErr) { toast.error('Invalid ' + routingLabel, ifscErr); return; }
    const accNorm  = bankDraft.accountNumber.trim();
    const ifscNorm = bankDraft.ifsc.trim().toUpperCase();
    if (bankRows.some(b => b.id !== editingBankId && b.accountNumber.trim() === accNorm)) {
      toast.error('Duplicate Account Number', `Account number ${accNorm} is already added for this supplier.`);
      return;
    }
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return; }

    const fd = new FormData();
    fd.append('bank_name', bankDraft.bankName);
    fd.append('branch_name', bankDraft.branchName);
    fd.append('account_number', accNorm);
    fd.append('ifsc', ifscNorm);
    fd.append('branch_address', bankDraft.branchAddress || '');
    if (bankDraft.chequeFile) fd.append('cheque', bankDraft.chequeFile);

    try {
      if (editingBankId) {
        fd.append('_method', 'PUT');
        const { data } = await api.post<{ data: ApiBankRow }>(`/vendors/${vendorId}/bank-accounts/${editingBankId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const b = data.data;
        setBankRows(prev => prev.map(r => r.id === editingBankId ? {
          id: String(b.id),
          bankName: b.bank_name ?? '', branchName: b.branch_name ?? '',
          accountNumber: b.account_number ?? '', ifsc: b.ifsc ?? '',
          branchAddress: b.branch_address ?? '',
          chequeFile: null, chequeFileName: lastName(b.cheque_path),
          existingPath: b.cheque_path ?? undefined, existingUrl: b.cheque_url ?? undefined,
        } : r));
        setBankPopupOpen(false);
        setEditingBankId(null);
        toast.success('Bank updated', `${b.bank_name} (${b.branch_name})`);
      } else {
        const { data } = await api.post<{ data: ApiBankRow }>(`/vendors/${vendorId}/bank-accounts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const b = data.data;
        setBankRows(prev => [...prev, {
          id: String(b.id),
          bankName: b.bank_name ?? '', branchName: b.branch_name ?? '',
          accountNumber: b.account_number ?? '', ifsc: b.ifsc ?? '',
          branchAddress: b.branch_address ?? '',
          chequeFile: null, chequeFileName: lastName(b.cheque_path),
          existingPath: b.cheque_path ?? undefined, existingUrl: b.cheque_url ?? undefined,
        }]);
        setBankPopupOpen(false);
        toast.success('Bank saved', `${b.bank_name} (${b.branch_name})`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save bank';
      toast.error('Save failed', msg);
    }
  };
  const removeBankRow = async (id: string) => {
    const ok = await confirm({
      title: 'Remove Bank Details?',
      message: 'This bank account will be permanently removed from this supplier. This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (!vendorId || !/^\d+$/.test(id)) { setBankRows(prev => prev.filter(r => r.id !== id)); return; }
    setSaving(true);
    try {
      await api.delete(`/vendors/${vendorId}/bank-accounts/${id}`);
      setBankRows(prev => prev.filter(r => r.id !== id));
      toast.success('Bank deleted', 'Bank account removed');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not delete bank';
      toast.error('Delete failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const openGstPopup = () => {
    if (gstApplicable !== 'Yes' || !gstNumber.trim()) {
      toast.error('GST Number missing', 'Set GST Applicable to “Yes” and enter the GST Number on Supplier Identification (Stage 1) first.');
      return;
    }
    setGstDraft({ ...EMPTY_GST_DRAFT, gstNumber: gstNumber.trim().toUpperCase() });
    setGstPopupOpen(true);
  };
  const saveGstDraft = async () => {
    if (!gstDraft.gstNumber.trim())     { toast.error('Missing field', 'GST Number is required'); return; }
    if (!gstDraft.lastFilingDate)       { toast.error('Missing field', 'GST Last Filing Date is required'); return; }
    const gstErr = validateGstin(gstDraft.gstNumber); if (gstErr) { toast.error('Invalid GST Number', gstErr); return; }
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return; }

    try {
      const { data } = await api.post<{ data: ApiGstRow }>(`/vendors/${vendorId}/gst-scrutiny`, {
        gst_number: gstDraft.gstNumber,
        status: gstDraft.status,
        last_filing_date: gstDraft.lastFilingDate || null,
        prev_non_gst_2a_invoice: gstDraft.prevNonGst2aInvoice || null,
        red_flags: gstDraft.redFlags || null,
      });
      const g = data.data;
      const gstNo = g.gst_number ?? '';
      setGstRows(prev => [{
        id: String(g.id),
        gstNumber: gstNo,
        status: (g.status === 'Active' ? 'Active' : 'Inactive'),
        scrutinyDate: g.scrutiny_date ?? new Date().toISOString().slice(0, 10),
        lastFilingDate: g.last_filing_date ?? '',
        prevNonGst2aInvoice: g.prev_non_gst_2a_invoice ?? '',
        redFlags: g.red_flags ?? '',
      }, ...prev].map(r => ({ ...r, gstNumber: gstNo })));
      setGstPopupOpen(false);
      toast.success('GST scrutiny saved', g.gst_number ?? '');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save GST scrutiny';
      toast.error('Save failed', msg);
    }
  };

  const kycTabAddMeta: Record<KycTab, { label: string; onClick: () => void }> = {
    company: { label: '+ Add More Due Diligence', onClick: openDdPopup },
    owner:   { label: '+ Add Owner KYC',          onClick: openOwnerPopup },
    license: { label: '+ Add Trade License',      onClick: openLicPopup },
    bank:    { label: '+ Add More Bank',          onClick: openBankPopup },
    gst:     { label: '+ Add GST Scrutiny',       onClick: openGstPopup },
  };

  const toggleTradeDocSign = (code: string) => {
    setTradeDocRows(prev => prev.map(r => r.code === code ? { ...r, sendForSignature: !r.sendForSignature } : r));
  };
  const toggleAllTradeDocSign = () => {
    const isSignedRow = (s: string) => s === 'completed' || s === 'Signed';
    setTradeDocRows(prev => {
      const selectable = prev.filter(r => !isSignedRow(r.status));
      const allOn = selectable.length > 0 && selectable.every(r => r.sendForSignature);
      return prev.map(r => isSignedRow(r.status) ? r : { ...r, sendForSignature: !allOn });
    });
  };
  const sendTradeDoc = (code: string) => {
    const row = tradeDocRows.find(r => r.code === code);
    if (!row?.db_id) {
      toast.info('Not a library document', 'This row is a legacy placeholder. Pick a segment with mapped trade documents to enable signature sending.');
      return;
    }
    if (!vendorId) {
      toast.info('Save vendor first', 'Save the vendor before sending documents for signature.');
      return;
    }
    const reqId = row.signatureRequestId;
    if (reqId && row.status === 'inprogress') {
      if (isReminderCooldown(reqId)) {
        toast.info('Already reminded', `One reminder covers every document in this bundle. Try again in ${reminderCooldownSeconds(reqId)}s.`);
        return;
      }
      const bundleCount = tradeDocRows.filter(r => r.signatureRequestId === reqId).length;
      api.post(`/clm/signature-requests/${reqId}/remind`)
        .then((res) => {
          setRecentReminds(prev => ({ ...prev, [reqId]: Date.now() + 60_000 }));
          toast.success('Reminder sent',
            bundleCount > 1
              ? `The signer was notified about all ${bundleCount} documents in this signature request.`
              : 'The signer has been notified.',
          );
          const serverCount = Number(res?.data?.data?.reminder_count ?? NaN);
          const serverLastAt = (res?.data?.data?.last_reminder_sent_at ?? null) as string | null;
          setTradeDocRows(prev => prev.map(r => (
            r.signatureRequestId === reqId
              ? {
                  ...r,
                  reminder_count: Number.isFinite(serverCount) ? serverCount : (r.reminder_count ?? 0) + 1,
                  last_reminder_sent_at: serverLastAt ?? new Date().toISOString(),
                }
              : r
          )));
        })
        .catch(err => toast.error('Reminder failed', err?.response?.data?.message ?? 'Could not send the reminder. Try again later.'));
      return;
    }
    setSendForSignature([row.db_id]);
  };
  const sendSelectedTradeDocs = () => {
    const ids = tradeDocRows
      .filter(r => r.sendForSignature && r.db_id && r.status !== 'completed' && r.status !== 'Signed')
      .map(r => r.db_id!);
    if (ids.length === 0) {
      toast.info('Nothing selected', 'Tick one or more unsigned documents under "Send for Signature" first.');
      return;
    }
    if (!vendorId) {
      toast.info('Save vendor first', 'Save the vendor before sending documents for signature.');
      return;
    }
    setSendForSignature(ids.slice(0, 10));
  };

  const fetchProductOptsIfNeeded = async () => {
    if (productOpts.length) return;
    try {
      type ProductRow = {
        id: number; product_code?: string; name?: string;
        status?: string; step_completed?: number;
        base_price?: number | string | null;
        segment_id?: number | null;
        hsn?: { hsn_code?: string } | null;
        segment?: { id?: number; title?: string } | null;
        gst_percentage?: { percentage?: number | string } | null;
      };
      const res = await api.get<{ data?: ProductRow[] } | ProductRow[]>('/products?per_page=500&lite=1');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      const eligible = rows.filter(r => r.segment_id != null || r.segment?.id != null);
      setProductOpts(eligible.map(r => ({
        value:    String(r.id),
        label:    `${formatProductCode(r.product_code) || (r.product_code ?? '')} — ${r.name ?? ''}`.replace(/^ — /, ''),
        code:     r.product_code ?? '',
        name:     r.name ?? '',
        hsn:      r.hsn?.hsn_code ?? '',
        segment:  r.segment?.title ?? '',
        segmentId: r.segment_id ?? r.segment?.id ?? null,
        basePrice:     r.base_price != null ? String(r.base_price) : '',
        gstPercentage: r.gst_percentage?.percentage != null ? String(r.gst_percentage.percentage) : '',
      })));
    } catch { /* silent — modal falls back to manual entry */ }
  };
  const fetchGstPctOptsIfNeeded = async () => { /* seeded from bundle */ };

  const recomputeMapTotals = (draft: MapDraft): MapDraft => {
    const price = parseFloat(draft.purchasePrice);
    const pct   = parseFloat(draft.gstPercentage);
    if (!isFinite(price) || price < 0) return { ...draft, gstAmount: '', totalAmount: '' };
    const safePct = isFinite(pct) ? pct : 0;
    const gstAmt  = +(price * (safePct / 100)).toFixed(2);
    const total   = +(price + gstAmt).toFixed(2);
    return { ...draft, gstAmount: gstAmt.toFixed(2), totalAmount: total.toFixed(2) };
  };

  const openMapPopup = () => {
    setMapEditingId(null);
    setMapDraft(EMPTY_MAP_DRAFT);
    setMapPopupOpen(true);
    void fetchProductOptsIfNeeded();
    void fetchGstPctOptsIfNeeded();
  };

  const onMapProductChange = (productIdStr: string) => {
    const picked = productOpts.find(p => p.value === productIdStr);
    setMapDraft(d => recomputeMapTotals({
      ...d,
      productId:     productIdStr,
      productCode:   picked?.code ?? '',
      productName:   picked?.name ?? '',
      hsnSacCode:    picked?.hsn  ?? '',
      segment:       picked?.segment ?? '',
      purchasePrice: picked?.basePrice ?? d.purchasePrice,
      gstPercentage: picked?.gstPercentage ?? d.gstPercentage,
    }));
  };

  const [mappingBusy, setMappingBusy] = useState(false);

  const persistMappings = async (list: ProductMappingRow[]): Promise<boolean> => {
    if (!vendorId) return true;   
    try {
      await api.post(`/vendors/${vendorId}/step/products`, {
        mappings: list.map(m => ({
          product_id: m.productId,
          batch_serial_lot: m.batchSerialLot || null,
          purchase_price: m.purchasePrice,
          gst_percentage: m.gstPercentage,
          gst_amount: m.gstAmount,
          total_amount: m.totalAmount,
        })),
      });
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save the product mapping';
      toast.error('Save failed', msg);
      return false;
    }
  };

  const saveMapDraft = async () => {
    if (!mapDraft.productId)             { toast.error('Missing field', 'Pick a Product Name'); return; }
    {
      const segSet = new Set((segment ?? []).map(Number).filter(n => n > 0));
      const opt = productOpts.find(o => o.value === mapDraft.productId);
      if (segSet.size > 0 && opt && opt.segmentId != null && !segSet.has(opt.segmentId)) {
        toast.error('Segment mismatch', `${mapDraft.productCode || 'This product'} is in a segment this supplier isn't onboarded for.`);
        return;
      }
    }
    if (!mapDraft.purchasePrice.trim())  { toast.error('Missing field', 'Purchase Price is required'); return; }
    const price = parseFloat(mapDraft.purchasePrice);
    if (!isFinite(price) || price < 0)   { toast.error('Invalid price', 'Purchase Price must be a non-negative number'); return; }
    if (productMappings.some(m => m.productId === Number(mapDraft.productId) && m.id !== mapEditingId)) {
      toast.error('Already mapped', `${mapDraft.productCode} is already mapped to this vendor`);
      return;
    }
    if (mapEditingId) {
      const next = productMappings.map(r => r.id !== mapEditingId ? r : {
        ...r,
        productId:    Number(mapDraft.productId),
        productCode:  mapDraft.productCode,
        productName:  mapDraft.productName,
        hsnSacCode:   mapDraft.hsnSacCode,
        segment:      mapDraft.segment,
        batchSerialLot: mapDraft.batchSerialLot,
        purchasePrice: price,
        gstPercentage: parseFloat(mapDraft.gstPercentage) || 0,
        gstAmount:    parseFloat(mapDraft.gstAmount) || 0,
        totalAmount:  parseFloat(mapDraft.totalAmount) || price,
      });
      if (!(await persistMappings(next))) return;   
      setProductMappings(next);
      setMapEditingId(null);
      setMapPopupOpen(false);
      toast.success('Mapping updated', `${mapDraft.productCode} ${mapDraft.productName} updated`);
      return;
    }
    const row: ProductMappingRow = {
      id: uid(),
      productId:    Number(mapDraft.productId),
      productCode:  mapDraft.productCode,
      productName:  mapDraft.productName,
      hsnSacCode:   mapDraft.hsnSacCode,
      segment:      mapDraft.segment,
      batchSerialLot: mapDraft.batchSerialLot,
      purchasePrice: price,
      gstPercentage: parseFloat(mapDraft.gstPercentage) || 0,
      gstAmount:    parseFloat(mapDraft.gstAmount) || 0,
      totalAmount:  parseFloat(mapDraft.totalAmount) || price,
    };
    const next = [...productMappings, row];
    if (!(await persistMappings(next))) return;     
    setProductMappings(next);
    setMapPopupOpen(false);
    toast.success('Product mapped', `${row.productCode} ${row.productName} added`);
  };
  const removeMapRow = async (id: string) => {
    if (mappingBusy) return;
    const ok = await confirm({
      title: 'Remove Mapped Product?',
      message: 'This product mapping will be permanently removed from this supplier. This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (mappingBusy) return;
    setMappingBusy(true);
    try {
      const next = productMappings.filter(r => r.id !== id);
      if (!(await persistMappings(next))) return;
      setProductMappings(next);
    } finally {
      setMappingBusy(false);
    }
  };

  useEffect(() => {
    if (productOpts.length === 0 || productMappings.length === 0) return;
    let dirty = false;
    const next = productMappings.map(m => {
      if (m.hsnSacCode && m.segment) return m;
      const opt = productOpts.find(o => Number(o.value) === Number(m.productId));
      if (!opt) return m;
      if ((m.hsnSacCode || '') === (opt.hsn || '') && (m.segment || '') === (opt.segment || '')) return m;
      dirty = true;
      return { ...m, hsnSacCode: m.hsnSacCode || opt.hsn || '', segment: m.segment || opt.segment || '' };
    });
    if (dirty) setProductMappings(next);
  }, [productOpts, productMappings]);

  const openMapEdit = (id: string) => {
    const row = productMappings.find(r => r.id === id);
    if (!row) return;
    setMapEditingId(id);
    setMapDraft({
      productId: row.productId != null ? String(row.productId) : '',
      productCode: row.productCode,
      productName: row.productName,
      hsnSacCode: row.hsnSacCode,
      segment: row.segment,
      batchSerialLot: row.batchSerialLot,
      purchasePrice: String(row.purchasePrice ?? ''),
      gstPercentage: String(row.gstPercentage ?? ''),
      gstAmount: String(row.gstAmount ?? ''),
      totalAmount: String(row.totalAmount ?? ''),
    });
    setMapPopupOpen(true);
    void fetchProductOptsIfNeeded();
    void fetchGstPctOptsIfNeeded();
  };

  const [contactEditingId, setContactEditingId] = useState<number | null>(null);
  const savePrimaryContact = async () => {
    const errs: Record<string, string> = {};
    if (!contactName.trim())  errs.contactName = 'Contact Person Name is required';
    if (!designation.trim())  errs.designation = 'Designation is required';
    if (!contactNo.trim())    errs.contactNo   = 'Contact No is required';
    else { const e = validateContactNumber(contactNo, 'Contact No', supplierDocType === 'domestic'); if (e) errs.contactNo = e; }
    if (!email.trim())        errs.email       = 'Email is required';
    else { const e = validateEmail(email); if (e) errs.email = e; }
    if (Object.keys(errs).length) {
      setFieldErrors(prev => ({ ...prev, ...errs }));
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setSavingPrimary(true);
    try {
      const ok = await saveContacts({ outerSpinner: false });   
      if (ok) { setPrimarySaved(true); setEditingPrimary(false); }
    } finally {
      setSavingPrimary(false);
    }
  };
  const savedPrimaryComplete = !!(
    savedPrimary
    && savedPrimary.name.trim()
    && savedPrimary.designation.trim()
    && savedPrimary.phone.trim()
    && savedPrimary.email.trim()
  );
  const primaryLocked = (primarySaved || (isEdit && savedPrimaryComplete)) && !editingPrimary;
  const startEditPrimary = () => {
    setEditingPrimary(true);
    primaryCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const openContactPopup = () => {
    setContactEditingId(null);
    setContactDraft({ name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '', attachmentFile: null });
    setContactPopupOpen(true);
  };
  const openContactEdit = (id: number) => {
    const c = extraContacts.find(x => x.id === id);
    if (!c) return;
    setContactEditingId(id);
    setContactDraft({
      name: c.name,
      designation: c.designation,
      phone: c.phone,
      email: c.email,
      whatsapp: c.whatsapp,
      attachmentName: c.attachmentName,
      attachmentFile: c.attachmentFile ?? null,
      attachmentPath: c.attachmentPath,
      attachmentUrl: c.attachmentUrl,
    });
    setContactPopupOpen(true);
  };
  type ApiContactRow = {
    id: number; contact_name?: string | null; designation?: string | null;
    contact_no?: string | null; email?: string | null; whatsapp_enabled?: boolean;
    attachment_path?: string | null; attachment_url?: string | null;
  };
  const mapApiContact = (c: ApiContactRow): ContactRow => {
    const raw = (c.attachment_path ?? '').split('/').pop() ?? '';
    const label = raw.includes('__') ? raw.slice(raw.indexOf('__') + 2) : raw;
    return {
      id: c.id,
      name: c.contact_name ?? '',
      designation: c.designation ?? '',
      phone: c.contact_no ?? '',
      email: c.email ?? '',
      whatsapp: c.whatsapp_enabled ?? true,
      attachmentName: label,
      attachmentPath: c.attachment_path ?? undefined,
      attachmentUrl: c.attachment_url ?? undefined,
    };
  };

  const saveContactDraft = async () => {
    const missing: string[] = [];
    if (!contactDraft.name.trim())        missing.push('Contact Person Name');
    if (!contactDraft.designation.trim()) missing.push('Designation');
    if (!contactDraft.phone.trim())       missing.push('Contact No');
    if (!contactDraft.email.trim())       missing.push('Email');
    if (missing.length) {
      toast.error('Missing required fields', `Please fill: ${missing.join(', ')}`);
      return;
    }
    const phoneErr = validateContactNumber(contactDraft.phone, 'Contact No', supplierDocType === 'domestic');
    if (phoneErr) { toast.error('Invalid Contact No', phoneErr); return; }
    const emailErr = validateEmail(contactDraft.email);
    if (emailErr) { toast.error('Invalid Email', emailErr); return; }
    const emailNorm = contactDraft.email.trim().toLowerCase();
    const usedEmails = new Set<string>([
      email.trim().toLowerCase(),
      ...extraContacts.filter(c => c.id !== contactEditingId).map(c => (c.email ?? '').trim().toLowerCase()),
    ].filter(Boolean));
    if (usedEmails.has(emailNorm)) {
      toast.error('Duplicate Email', 'This email is already used by another contact — each contact must have a unique email.');
      return;
    }
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return; }

    const fd = new FormData();
    fd.append('contact_name', contactDraft.name);
    fd.append('designation', contactDraft.designation || '');
    fd.append('contact_no', contactDraft.phone || '');
    fd.append('email', emailNorm);
    fd.append('whatsapp_enabled', contactDraft.whatsapp ? '1' : '0');
    if (contactDraft.attachmentFile) fd.append('attachment', contactDraft.attachmentFile);
    else if (contactDraft.attachmentPath) fd.append('attachment_path', contactDraft.attachmentPath);
    else fd.append('remove_attachment', '1');  

    try {
      if (contactEditingId !== null) {
        fd.append('_method', 'PUT');  
        const { data } = await api.post<{ data: ApiContactRow }>(`/vendors/${vendorId}/contacts/${contactEditingId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const saved = mapApiContact(data.data);
        setExtraContacts(prev => prev.map(c => c.id === contactEditingId ? saved : c));
        toast.success('Contact updated', `${saved.name} updated`);
      } else {
        const { data } = await api.post<{ data: ApiContactRow }>(`/vendors/${vendorId}/contacts`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        const saved = mapApiContact(data.data);
        setExtraContacts(prev => [...prev, saved]);
        toast.success('Contact saved', `${saved.name} added`);
      }
      setContactPopupOpen(false);
      setContactEditingId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save contact';
      toast.error('Save failed', msg);
    }
  };

  const removeExtraContact = async (id: number) => {
    const ok = await confirm({
      title: 'Delete Contact Person?',
      message: 'This contact person will be permanently deleted from this supplier. This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    if (!vendorId) { setExtraContacts(prev => prev.filter(c => c.id !== id)); return; }
    setSaving(true);
    try {
      await api.delete(`/vendors/${vendorId}/contacts/${id}`);
      setExtraContacts(prev => prev.filter(c => c.id !== id));
      toast.success('Contact deleted', 'Contact person removed');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not delete contact';
      toast.error('Delete failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const kycDocCount =
    kycTab === 'company' ? (ddRows.length      || segmentDocs.dd.length) :
    kycTab === 'owner'   ? (ownerRows.length   || segmentDocs.kyc.length) :
    kycTab === 'license' ? (licenseRows.length || segmentDocs.tl.length) :
    kycTab === 'bank'    ? bankRows.length :
                           gstRows.length;

  return createPortal((
    <div className="avm-backdrop">
      <div className="avm-modal" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
        {/* While a step save is in flight, a veil over the whole modal blocks
            EVERY other action (Map Product, tab switch, Add buttons, etc.) until
            the save resolves. Popups have their own veil (PopupShell).
            segAddLoading is here too: the Segment "+" needs a /clm/segments
            round-trip before its form can open, and its own button spinner only
            disabled THAT button — every other "+" and action stayed live, so the
            user could stack a second popup on top of the one still opening. */}
        {(saving || savingPrimary || segAddLoading) && <div className="avm-busy-veil" aria-hidden />}
        {/* ─── Header ─── */}
        <div className="avm-head">
          <div className="avm-head-left">
            <div className="avm-head-icon">
              {/* person-with-+ (add user) — matches the Figma header icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="avm-title">{isEdit ? `Edit Supplier${vendorCode ? ` — ${vendorCode}` : ''}` : 'Add Supplier'}</div>
              <div className="avm-sub">{isEdit ? 'Review, update, and modify this supplier profile, compliance, and product details.' : 'Capture, verify, and onboard suppliers with complete compliance and product readiness.'}</div>
            </div>
          </div>
          <div className="avm-head-right">
            {/* Map Product — opens the Mapped Products list popup (Figma).
                Disabled until the supplier exists (Stage 1 saved → vendorId set);
                you can't map products to a supplier that hasn't been created. */}
            <button
              className="avm-map-btn"
              onClick={() => setMappedListOpen(true)}
              disabled={!vendorId}
              title={!vendorId ? 'Save the Supplier Legal Identity step first to map products' : 'Map products to this supplier'}
            >
              <i className="ri-price-tag-line" /> <span className="avm-map-btn-label">Map Product</span>
            </button>
            <button className="avm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ─── Stepper strip ─── */}
        <div className="avm-stepper-wrap">
          <div className="avm-stepper">
            {/* Two-stage stepper to mirror the Figma exactly: Legal Identity →
                KYC / Due Diligence. Product mapping is the final wizard step
                (step 3) but is not surfaced as a stepper card here. */}
            <StepperItem n={1} title="Supplier Legal Identity"   sub="Company, GST, PAN & contact" current={step} tone="violet" icon="ri-building-2-line" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={2} title="KYC / Due Diligence"       sub="Docs, identity & compliance" current={step} tone="purple" icon="ri-shield-check-line" />
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="avm-body">
          {/* Tab strip renders OUTSIDE the loading branch.
              It used to live inside the loaded form, so while the edit prefill
              was in flight the body opened straight onto the shimmer and the
              two tabs popped in afterwards, shoving every skeleton card down
              the page. The strip is chrome, not data — it says the same thing
              before and after the fetch — so it is painted immediately and
              merely disabled until the form behind it is real. */}
          {step === 1 && (
            <div className="avm-tabs">
              <button
                className={`avm-tab ${idTab === 'identification' ? 'on' : ''}`}
                disabled={loadingEdit || mastersLoading || advancing}
                onClick={() => setIdTab('identification')}
              >Supplier Identification &amp; Address Details</button>
              {/* Can't jump to Contact Person Details until Supplier
                  Identification is valid. Mirrors Save & Next: validates +
                  persists (so the contact step has a vendorId to attach to)
                  and only switches when clean — else inline errors show. */}
              <button
                className={`avm-tab ${idTab === 'address' ? 'on' : ''}`}
                disabled={saving || advancing || loadingEdit || mastersLoading}
                onClick={async () => { if (saving || advancing || idTab === 'address') return; setAdvancing(true); try { const ok = await saveIdentity(); if (ok) setIdTab('address'); } finally { setAdvancing(false); } }}
              >Contact Person Details</button>
            </div>
          )}
          {(loadingEdit || mastersLoading || advancing) ? (
            <div className="avm-load-overlay avm-load-overlay-static" role="status" aria-live="polite" aria-label="Loading supplier form">
              {/* Step 1's identification tab is what opens 99% of the time, and
                  it gets a skeleton built from the real section cards so nothing
                  shifts when the data lands (see Step1IdentitySkeleton).

                  Everything else — step 2/3, or the Contact Person tab mid
                  `advancing` — falls back to the generic form shimmer. `header`
                  is off there because that block draws a 64px avatar, two lines
                  and a button: a profile card this wizard does not have, which
                  vanished on load and dragged every real section up the page.
                  No max-width either; the real cards run the full width of
                  .avm-body, so a 1100px cap made the skeleton visibly narrower
                  than the form replacing it. */}
              <div style={{ width: '100%' }}>
                {step === 1 && idTab === 'identification'
                  ? <Step1IdentitySkeleton />
                  : <ShimmerForm sections={4} cols={3} fieldsPerSection={6} header={false} />}
              </div>
            </div>
          ) : (<>
          {/* The form body proper renders only when masters and edit-mode
              prefill have both finished — keeps half-hydrated inputs from
              flashing onscreen behind a translucent skeleton. */}
          {step > 1 && (() => {
            type PrevField = {
              label: string;
              value: string;
              href?: string;        
              suffix?: string;      
            };
            type PrevGroup =
              | { label: string; kind: 'grid'; fields: PrevField[] }
              | { label: string; kind: 'line'; parts: string[]; empty: string };
            type PrevStage = {
              name: string;
              tone: 'violet' | 'teal' | 'purple';
              groups: PrevGroup[];
            };
            const prevStages: PrevStage[] = [];
            const joined = (parts: Array<string | undefined | null>) =>
              parts.map(p => (p ?? '').trim()).filter(p => p && p !== '—');

            if (step > 1) {
              const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
              const identityFields: PrevField[] = [
                { label: 'Supplier Code',        value: vendorCode || '—' },
                { label: 'Company Name',         value: companyName || '—' },
                { label: 'Legal Name',           value: legalName || '—' },
                { label: 'Supplier Type',        value: labelFor(vendorType, SUPPLIER_TYPE_OPTS) || vendorType || '—' },
                { label: 'Segment',              value: segment.map(s => labelFor(s, segmentOpts) || s).join(', ') || '—' },
                { label: 'Risk Level',           value: labelFor(riskLevel, riskLevelOpts) || '—' },
                { label: 'Supplier Behaviour',   value: labelFor(vendorBehaviour, behaviourOpts) || '—' },
                { label: 'Compliance Behaviour', value: labelFor(complianceBehaviour, complianceOpts) || '—' },
                { label: 'Company Website',      value: website || 'NA' },
              ];
              if (supplierDocType === 'domestic') {
                identityFields.push({ label: 'GST Number', value: gstNumber || '—' });
              }

              prevStages.push({
                name: 'Stage 1 — Supplier Legal Identity',
                tone: 'violet',
                groups: [
                  { label: 'Company Information', kind: 'grid', fields: identityFields },
                  {
                    label: 'Primary Address', kind: 'line',
                    parts: joined([
                      registeredOffice, city,
                      labelFor(state, stateOpts),
                      stateCode ? `State Code ${stateCode}` : '',
                      labelFor(country, countryOpts),
                    ]),
                    empty: 'No address entered yet',
                  },
                  {
                    label: 'Primary Contact Person', kind: 'line',
                    parts: joined([
                      contactName, designation, contactNo, email,
                      `WhatsApp ${yesNo(whatsappEnabled)}`,
                    ]),
                    empty: 'No contact entered yet',
                  },
                ],
              });
            }

            if (step > 2) {
              const bank = bankRows[0];
              const dd   = ddRows[0];
              const own  = ownerRows[0];
              const kycGroups: PrevGroup[] = [];

              if (bank) {
                kycGroups.push({
                  label: 'Bank Details', kind: 'grid',
                  fields: [
                    { label: 'Bank Name',      value: bank.bankName || '—' },
                    { label: 'Branch',         value: bank.branchName || '—' },
                    { label: 'Account Number', value: bank.accountNumber || '—' },
                    { label: supplierDocType === 'international' ? 'SWIFT Code' : 'IFSC Code', value: bank.ifsc || '—' },
                  ],
                });
              }
              if (dd) {
                const fileLabel = dd.fileName || (dd.existingPath ? dd.existingPath.split('/').pop() ?? '' : '');
                const href = dd.existingUrl || (dd.existingPath ? resolveFileUrl(dd.existingPath) : (dd.file ? URL.createObjectURL(dd.file) : ''));
                kycGroups.push({
                  label: 'Company Due Diligence', kind: 'grid',
                  fields: [{
                    label: dd.documentName || 'Document',
                    value: fileLabel || '—',
                    href: href || undefined,
                    suffix: dd.expiry && dd.expiry !== 'N/A' ? `(Validity: ${dd.expiry})` : undefined,
                  }],
                });
              }
              if (own) {
                kycGroups.push({
                  label: 'Owner KYC', kind: 'grid',
                  fields: [
                    { label: 'Document Name',     value: own.documentName || '—' },
                    { label: 'Issuing Authority', value: own.issuingAuthority || '—' },
                    { label: 'Document Number',   value: own.documentNumber || '—' },
                    { label: 'Issue Date',        value: fmtDMY(own.issueDate) },
                  ],
                });
              }
              if (kycGroups.length) {
                prevStages.push({
                  name: 'Stage 2 — KYC / Due Diligence',
                  tone: 'teal',
                  groups: kycGroups,
                });
              }
            }

            if (prevStages.length === 0) return null;

            return (
              <div className="avm-prev">
                <div className="avm-prev-head">
                  <span className="avm-prev-ico"><i className="ri-time-line" /></span>
                  <div className="avm-prev-headtext">
                    <div className="avm-prev-title">What you did in previous stages</div>
                    <div className="avm-prev-subtitle">Stage {step - 1} completed — review your entry below</div>
                  </div>
                  <button className="avm-prev-toggle" onClick={() => setPrevOpen(o => !o)}>
                    <span className="avm-prev-toggle-pill">{step - 1} stage{step - 1 > 1 ? 's' : ''} completed</span>
                    <i className="ri-arrow-down-s-line avm-prev-toggle-chev" style={{ transform: prevOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                  </button>
                </div>
                {prevOpen && (
                  <div className="avm-prev-body">
                    {prevStages.map(s => (
                      <div key={s.name} className={`avm-prev-stage tone-${s.tone}`}>
                        {/* Green tick, not the old ⊕ glyph — the block exists to
                            say "this stage is done", and a check is the mark
                            that already means completed on the stepper above. */}
                        <div className="avm-prev-stage-label">
                          <span className="avm-prev-check">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          </span>
                          {s.name}
                        </div>
                        {s.groups.map(g => (
                          <div key={g.label} className="avm-prev-group">
                            <div className="avm-prev-glabel">{g.label}</div>
                            {g.kind === 'grid' ? (
                              <div className="avm-prev-grid">
                                {g.fields.map((f, j) => (
                                  <div key={`${f.label}-${j}`} className="avm-prev-cell">
                                    <span className="avm-prev-k">{f.label}</span>
                                    {f.href ? (
                                      <Tooltip label={f.value}><a href={f.href} target="_blank" rel="noopener noreferrer" className="avm-prev-v avm-prev-link">{f.value}</a></Tooltip>
                                    ) : (
                                      <Tooltip label={f.value}><span className="avm-prev-v">{f.value}</span></Tooltip>
                                    )}
                                    {f.suffix ? <span className="avm-prev-suffix">{f.suffix}</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="avm-prev-line">
                                {g.parts.length
                                  ? g.parts.map((p, j) => (
                                      <span key={j}>
                                        {j > 0 && <span className="avm-prev-dot">·</span>}
                                        {p}
                                      </span>
                                    ))
                                  : <span className="avm-prev-empty">{g.empty}</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─── STEP 1 ─── */}
          {step === 1 && (
            <>
              {/* (Tab strip hoisted above the loading branch — see there.) */}
              {idTab === 'identification' && (
                <SectionCard tone="violet" icon={<i className="ri-home-line" />} title="Basic Company Details" subtitle="Supplier identity, type, and risk classification">
                  {/* 3×3 grid mirroring the Figma:
                      row1: Company Name · Company Legal Name · Supplier Type
                      row2: Company Website · Supplier Segment · Risk Level
                      row3: Supplier Behaviour · Classification & Flags · Compliance Behaviour */}
                  <div className="avm-grid-3">
                    <Field label="Company Name" required error={fieldErrors.companyName}>
                      <input
                        className="avm-input"
                        placeholder="e.g. ABC Logistics"
                        value={companyName}
                        maxLength={COMPANY_NAME_MAX}
                        onChange={e => handleCompanyNameChange(e.target.value, 'companyName', setCompanyName)}
                      />
                    </Field>
                    <Field label="Company Legal Name" required error={fieldErrors.legalName}>
                      <input
                        className="avm-input"
                        placeholder="ABC Logistics Pvt Ltd"
                        value={legalName}
                        maxLength={COMPANY_NAME_MAX}
                        onChange={e => handleCompanyNameChange(e.target.value, 'legalName', setLegalName)}
                      />
                    </Field>
                    <Field label="Supplier Type" required error={fieldErrors.vendorType}>
                      <SelectInput value={vendorType} onChange={(v) => { setVendorType(v); clearFieldError('vendorType'); }} placeholder="Select" options={SUPPLIER_TYPE_OPTS} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    {/* `error` was missing entirely (QA #97): flagErrors set
                        fieldErrors.website, but with nothing bound here the
                        message never rendered and the input never got
                        .has-error — so the scroll-to-first-bad-field couldn't
                        find it either. The user was told to "check Company
                        Website" and then shown a field with no mark on it. */}
                    <Field label="Company Website" error={fieldErrors.website}>
                      <input className="avm-input" placeholder="https://abclogistics.com" value={website} onChange={e => { setWebsite(e.target.value); clearFieldError('website'); }} />
                    </Field>
                    <Field label="Supplier Segment" required addNew addLoading={segAddLoading} onAdd={openSegmentAdd} error={fieldErrors.segment}>
                      {/* masterFormKit's MasterMultiSelect renders visible violet
                          chips with × buttons + a checkbox-marked dropdown so
                          multi-select is obvious. `value` prop is plural despite
                          the singular name. No lock icon — like the Customer master,
                          the × stays visible and removal is guarded via onChange
                          (toast + restore) if the segment has uploaded documents. */}
                      <div className="avm-master-select">
                        <MasterMultiSelect
                          value={segment}
                          options={sortedSegmentOpts}
                          placeholder="Select Segment"
                          disabledValues={disabledSegmentIds}
                          disabledHint={segmentDisabledHint}
                          renderBadges={(id) => {
                            const t = segTypesById.get(String(id));
                            if (!t || t.size === 0) return null;
                            const badge = (text: string, title: string, color: string, bg: string, bd: string, onClick?: (e: React.MouseEvent) => void) => (
                              <span title={title} onClick={onClick} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.02em', padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap', color, background: bg, border: `1px solid ${bd}`, cursor: onClick ? 'pointer' : undefined }}>{text}</span>
                            );
                            const intl = () => badge('INT', 'International rule', '#3730a3', '#eef2ff', '#c7d2fe');
                            const dom  = () => badge('DOM', 'Domestic rule', '#0f766e', '#ecfdf5', '#99f6e4');
                            if (t.has('international') && t.has('domestic')) {
                              return expandedSegBadges.has(String(id))
                                ? <>{intl()}{dom()}</>
                                : badge('+2', 'Both International & Domestic — click to show', '#6d28d9', '#f5f3ff', '#ddd6fe',
                                    (e) => { e.stopPropagation(); toggleSegBadge(String(id)); });
                            }
                            if (t.has('international')) return intl();
                            return dom();
                          }}
                          onChange={vs => {
                            const added = vs.filter(s => !segment.includes(s));
                            const badAdd = country ? added.filter(s => {
                              const t = segTypesById.get(String(s));
                              return t && t.size > 0 && !t.has(supplierDocType);
                            }) : [];
                            if (badAdd.length) {
                              const names = badAdd.map(id => segmentOpts.find(o => o.value === id)?.label ?? id);
                              const label = supplierDocType === 'domestic' ? 'Domestic' : 'International';
                              toast.error(
                                'Segment not allowed',
                                `${names.join(', ')} has no ${label} rule — this is a ${label} supplier. Add the ${label} rule in the Document Control Panel first.`,
                              );
                              vs = vs.filter(s => !badAdd.includes(s));
                            }
                            const removed = segment.filter(s => !vs.includes(s));
                            if (removed.length) {
                              const lockedRemoved = removed.filter(s => lockedSegments.includes(s));
                              const uploadedSet = new Set(uploadedKeys);
                              const keepKeys = new Set(vs.flatMap(s => segReqKeys[String(s)] ?? []));
                              const docRemoved = removed.filter(s => !lockedRemoved.includes(s)
                                && (segReqKeys[String(s)] ?? []).some(k => uploadedSet.has(k) && !keepKeys.has(k)));
                              if (lockedRemoved.length) {
                                const label = (id: string) => segmentOpts.find(o => o.value === id)?.label ?? id;
                                const by = (r: string) => lockedRemoved.filter(s => lockedSegmentReasons[String(s)] === r).map(label);
                                const poNames   = lockedRemoved.filter(s => !['spi', 'product'].includes(lockedSegmentReasons[String(s)] ?? '')).map(label);
                                const spiNames  = by('spi');
                                const prodNames = by('product');
                                const plural = (n: string[], one: string, many: string) => (n.length > 1 ? many : one);
                                if (poNames.length) {
                                  toast.error('Cannot remove segment', `${poNames.join(', ')} — ${plural(poNames, 'this segment has', 'these segments have')} a product on an issued Purchase Order.`);
                                }
                                if (spiNames.length) {
                                  toast.error('Cannot remove segment', `${spiNames.join(', ')} — ${plural(spiNames, 'this segment has', 'these segments have')} a product on a Supplier Invoice.`);
                                }
                                if (prodNames.length) {
                                  toast.error('Cannot remove segment', `${prodNames.join(', ')} — a product in ${plural(prodNames, 'this segment is', 'these segments is')} mapped to this supplier. Unmap it under Map Product first.`);
                                }
                              }
                              if (docRemoved.length) {
                                const n = docRemoved.map(id => segmentOpts.find(o => o.value === id)?.label ?? id);
                                toast.error(
                                  'Cannot remove segment',
                                  `${n.join(', ')} — ${n.length > 1 ? 'documents have' : 'a document has'} been uploaded against ${n.length > 1 ? 'requirements only these segments ask for' : 'a requirement only this segment asks for'}. Delete ${n.length > 1 ? 'those files' : 'that file'} in KYC / Due Diligence first.`,
                                );
                              }
                              const blocked = [...lockedRemoved, ...docRemoved];
                              if (blocked.length) vs = [...vs, ...blocked.filter(s => !vs.includes(s))];
                            }
                            setSegment(vs);
                            clearFieldError('segment');
                          }}
                        />
                      </div>
                    </Field>
                    <Field label="Risk Level" required error={fieldErrors.riskLevel}>
                      <SelectInput value={riskLevel} onChange={(v) => { setRiskLevel(v); clearFieldError('riskLevel'); }} placeholder="Select" options={riskLevelOpts} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Supplier Behaviour" required addNew onAdd={() => setQuickAdd('vendor_behaviour')} error={fieldErrors.vendorBehaviour}>
                      <SelectInput value={vendorBehaviour} onChange={(v) => { setVendorBehaviour(v); clearFieldError('vendorBehaviour'); }} placeholder="Select" options={behaviourOpts} />
                    </Field>
                    <Field label="Classification & Flags">
                      {/* Master-driven (master_customer_classifications) → vendors.classification_id. */}
                      <SelectInput value={classificationId} onChange={setClassificationId} placeholder="Select" options={classificationOpts} />
                    </Field>
                    <Field label="Compliance Behaviour" required addNew onAdd={() => setQuickAdd('compliance_behaviours')} error={fieldErrors.complianceBehaviour}>
                      <SelectInput value={complianceBehaviour} onChange={(v) => { setComplianceBehaviour(v); clearFieldError('complianceBehaviour'); }} placeholder="Select" options={complianceOpts} />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'identification' && (
                <SectionCard tone="amber" icon={<i className="ri-map-pin-line" />} title="Supplier Address Details" subtitle="Registered office and location">
                  {/* Single full-width address field — no separate Address Type
                      dropdown; the primary address is the registered office. */}
                  <div className="avm-grid-2" style={{ gridTemplateColumns: '1fr' }}>
                    <Field label="Registered Office Address" required error={fieldErrors.registeredOffice}>
                      <input
                        className="avm-input"
                        placeholder="Plot 21, Industrial Area"
                        value={registeredOffice}
                        maxLength={200}
                        onChange={e => applySanitizer(e.target.value, 'registeredOffice', setRegisteredOffice, sanitizeKycAddress)}
                      />
                    </Field>
                  </div>
                  <div className="avm-grid-4">
                    <Field label="Country" required addNew onAdd={() => setQuickAdd('countries')} error={fieldErrors.country}>
                      <LockField
                        locked={stateLocked || countryScopeLocked}
                        onLockClick={stateLocked ? lockToast : scopeLockToast}
                      >
                        <SelectInput
                          value={country}
                          onChange={(v) => { setCountry(v); setState(''); setStateCode(''); clearFieldError('country'); }}
                          placeholder={scope === 'international' ? 'Select Country (outside India)' : 'Select Country'}
                          options={scopedCountryOpts}
                          disabled={stateLocked || countryScopeLocked}
                        />
                      </LockField>
                    </Field>
                    {/* Required for domestic AND international — only State Code
                        below is GST-specific and drops out for international. */}
                    <Field label="State" required error={fieldErrors.state}>
                      <LockField locked={stateLocked} onLockClick={lockToast}>
                        <SelectInput
                          value={state}
                          onChange={(v) => {
                            setState(v);
                            const sc = stateCodeRows.find(r => r.state_id === v)?.state_code ?? '';
                            setStateCode(sc);
                            clearFieldError('state');
                            clearFieldError('stateCode');
                          }}
                          placeholder={country ? 'Select State' : 'Select country first'}
                          options={stateOpts}
                          disabled={!country || stateLocked}
                        />
                      </LockField>
                    </Field>
                    {/* State Code is an Indian GST construct (2-digit GST state code).
                        Shown for every supplier, but for a non-India (international)
                        one it's disabled with a "Not applicable" placeholder + a toast
                        on click. Kept visible rather than removed so the address row
                        keeps the same four fields in the same places whichever scope
                        the supplier is — the field explains why it is empty, which a
                        missing field cannot. */}
                    <Field label="State Code" required={!(supplierDocType === 'international' && !!country)} error={fieldErrors.stateCode}>
                      {/* Derived from the selected State — read-only so it can't drift
                          out of sync with the State (GST state code is fixed per state). */}
                      <LockField
                        locked={stateLocked || (supplierDocType === 'international' && !!country)}
                        onLockClick={() => (stateLocked ? lockToast() : intlStateCodeToast())}
                      >
                        <input
                          className="avm-input avm-input-ro"
                          placeholder={supplierDocType === 'international' && !!country ? 'Not applicable (international)' : 'Auto-filled from State'}
                          value={supplierDocType === 'international' && !!country ? '' : stateCode}
                          readOnly
                          disabled={stateLocked || (supplierDocType === 'international' && !!country)}
                          tabIndex={-1}
                          title="GST state code — automatically set from the selected State"
                        />
                      </LockField>
                    </Field>
                    <Field label="City" required error={fieldErrors.city}>
                      <input
                        className="avm-input"
                        placeholder="e.g. Pune"
                        value={city}
                        maxLength={60}
                        onChange={e => applySanitizer(e.target.value, 'city', setCity, raw => sanitizeKycAlpha(raw, 60))}
                      />
                    </Field>
                  </div>
                  {/* Google Location + GST Number share a row.
                      GST Number is 15 fixed characters, so it never needed the
                      half-width it was getting in its own 4-up grid, and the
                      Maps link is the one field on this card that benefits from
                      the space. On an international supplier GST does not apply,
                      the row drops to one column and the link takes it all.
                      Google Location is shown for BOTH scopes: an address line
                      locates neither, and the overseas one is the harder of the
                      two to verify from text alone. */}
                  <div className={gstApplicable === 'Yes' ? 'avm-grid-2' : 'avm-grid-1'}>
                    <Field label="Google Location Link" error={fieldErrors.googleLocation}>
                      <input
                        className="avm-input"
                        placeholder="Paste the Google Maps link — e.g. https://maps.app.goo.gl/…"
                        value={googleLocation}
                        maxLength={1000}
                        onChange={e => { setGoogleLocation(e.target.value); clearFieldError('googleLocation'); }}
                      />
                    </Field>
                    {/* GST Number sits with the address because its first 2 digits
                        ARE the state code. Derived purely from the country (India →
                        applies), so it only appears for a domestic supplier — there
                        is no separate "GST Applicable" toggle (mirrors the Customer
                        master). */}
                    {gstApplicable === 'Yes' && (
                      <Field label="GST Number" required error={fieldErrors.gstNumber}>
                        <LockField locked={stateLocked} onLockClick={lockToast}>
                          <input
                            className="avm-input"
                            placeholder="e.g. 27AADCI6120M1ZH"
                            value={gstNumber}
                            maxLength={15}
                            disabled={stateLocked}
                            onChange={e => {
                              setGstNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15));
                              clearFieldError('gstNumber');
                            }}
                          />
                        </LockField>
                      </Field>
                    )}
                  </div>
                </SectionCard>
              )}

              {idTab === 'address' && (
                <>
                  {/* Primary Contact Person Details — moved here from the
                      Identification tab to mirror the Figma's "Contact Person
                      Details" tab. Same component state, so saveContacts()
                      still validates + persists it on Save & Next. */}
                  <div ref={primaryCardRef}>
                  <SectionCard tone="violet" icon={<i className="ri-user-3-line" />} title="Primary Contact Person Details" subtitle="Primary point of contact for this supplier" headerAction={
                    primaryLocked
                      ? <span className="avm-doc-count"><i className="ri-lock-2-line" /> Saved — locked</span>
                      : (
                        <button className="avm-section-add-btn" onClick={savePrimaryContact} disabled={savingPrimary}>
                          {savingPrimary
                            ? <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
                            : <><i className="ri-save-line" /> Save Contact</>}
                        </button>
                      )
                  }>
                    <div
                      className="avm-grid-4"
                      onClick={() => { if (primaryLocked) toast.info('Primary contact locked', 'Click the Edit icon on the primary row below to change it.'); }}
                    >
                      <Field label="Contact Person Name" required error={fieldErrors.contactName}>
                        <input className="avm-input" placeholder="Rahul Sharma" value={contactName} maxLength={60} readOnly={primaryLocked} onChange={e => applySanitizer(e.target.value, 'contactName', setContactName, raw => sanitizeKycAlpha(raw, 60))} />
                      </Field>
                      <Field label="Designation" required error={fieldErrors.designation}>
                        <input className="avm-input" placeholder="Manager" value={designation} maxLength={60} readOnly={primaryLocked} onChange={e => applySanitizer(e.target.value, 'designation', setDesignation, raw => sanitizeKycDesignation(raw, 60))} />
                      </Field>
                      <Field label="Contact No" required error={fieldErrors.contactNo}>
                        <ContactNoInput
                          value={contactNo}
                          isIndia={supplierDocType === 'domestic'}
                          readOnly={primaryLocked}
                          onChange={(v) => { setContactNo(v); clearFieldError('contactNo'); }}
                        />
                      </Field>
                      <Field label="Email" required error={fieldErrors.email}>
                        {/* Lower-cased as it is typed. The domain half of an address
                            is case-INSENSITIVE, so Gmail@gmail.com and gmail@gmail.com
                            are the same mailbox — but stored as typed they are two
                            different strings, and every duplicate check here already
                            compares lower-cased. That mismatch is what let the same
                            contact be added twice. Normalising at the input keeps what
                            is shown, what is compared and what is stored identical. */}
                        <input className="avm-input" placeholder="rahul@abclogistics.com" value={email} readOnly={primaryLocked} onChange={e => { setEmail(e.target.value.toLowerCase()); clearFieldError('email'); }} />
                      </Field>
                    </div>
                    <div className="avm-grid-2">
                      <Field label="WhatsApp Enabled ?">
                        <div className="avm-radio-row">
                          <label className="avm-radio">
                            <input type="radio" checked={whatsappEnabled} disabled={primaryLocked} onChange={() => setWhatsappEnabled(true)} />
                            <span>Yes</span>
                          </label>
                          <label className="avm-radio">
                            <input type="radio" checked={!whatsappEnabled} disabled={primaryLocked} onChange={() => setWhatsappEnabled(false)} />
                            <span>No</span>
                          </label>
                        </div>
                      </Field>
                      <Field label="Attachment (Business Card)">
                        {/* Locked along with the rest of the primary contact.
                            This used to stay live while the card said
                            "Saved - locked", so the business card could be
                            replaced or deleted without ever pressing Edit — a
                            saved contact's attachment was the one field anyone
                            could change by accident, and the header claimed
                            otherwise. Read-only still shows the file and keeps
                            its view link; Edit on the primary row unlocks it
                            with everything else.
                            imagesPdfOnly matches the backend's primary_attachment
                            rule (mimes:jpg,jpeg,png,webp,pdf) so a .docx is
                            rejected the moment it is picked, not after a
                            round-trip. */}
                        <FileChooser file={attachment} onPick={(f) => { setAttachment(f); if (!f) { setPrimaryAttachmentPath(''); setPrimaryAttachmentUrl(''); } }} existingPath={primaryAttachmentPath} existingUrl={primaryAttachmentUrl || undefined} placeholder="No files attached" imagesPdfOnly readOnly={primaryLocked} />
                      </Field>
                    </div>
                  </SectionCard>
                  </div>

                  {/* ── Additional Contact Persons ──
                      The primary KYC contact (captured on the Vendor
                      Identification sub-tab) is also surfaced here as
                      the first row so the table reads as "all contacts
                      we know about". Marked with a "Primary" pill and
                      not deletable — the user has to go back to the
                      first sub-tab to change it. */}
                  <SectionCard tone="violet" className="avm-section-grow" icon={<i className="ri-user-add-line" />} title="Additional Contact Persons" subtitle="Add more points of contact for this supplier" headerAction={
                    <button className="avm-section-add-btn" onClick={openContactPopup}>+ Add More Contact Person</button>
                  }>
                    {(() => {
                      type Row = {
                        key: string;
                        isPrimary: boolean;
                        contactId?: number;
                        name: string;
                        designation: string;
                        phone: string;
                        email: string;
                        whatsapp: boolean;
                        attachmentName: string;
                        attachmentHref: string;
                      };
                      const rows: Row[] = [];
                      if (savedPrimary) {
                        rows.push({
                          key: 'primary',
                          isPrimary: true,
                          name: savedPrimary.name,
                          designation: savedPrimary.designation,
                          phone: savedPrimary.phone,
                          email: savedPrimary.email,
                          whatsapp: savedPrimary.whatsapp,
                          attachmentName: savedPrimary.attachmentName,
                          attachmentHref: savedPrimary.attachmentHref,
                        });
                      }
                      extraContacts.forEach(c => rows.push({
                        key: String(c.id),
                        isPrimary: false,
                        contactId: c.id,
                        name: c.name,
                        designation: c.designation,
                        phone: c.phone,
                        email: c.email,
                        whatsapp: c.whatsapp,
                        attachmentName: c.attachmentName,
                        attachmentHref: c.attachmentUrl || (c.attachmentPath ? resolveFileUrl(c.attachmentPath) : ''),
                      }));

                      if (rows.length === 0) {
                        return <div className="avm-empty">No contact persons added yet.</div>;
                      }
                      return (
                        <div className="table-responsive avm-contacts-scroll">
                          <table className="table align-middle table-nowrap mb-0 avm-mini-table">
                            <thead className="table-light">
                              <tr>
                                <th>Sr No</th>
                                <th>Name</th>
                                <th>Designation</th>
                                <th>Phone</th>
                                <th>Email</th>
                                <th>WhatsApp</th>
                                <th>Attachment</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, idx) => (
                                <tr key={r.key}>
                                  <td>{idx + 1}</td>
                                  <td>
                                    <Tooltip label={r.name || '—'}>
                                      <strong>{r.name && r.name.length > 20 ? r.name.slice(0, 20) + '…' : (r.name || '—')}</strong>
                                    </Tooltip>
                                    {r.isPrimary && (
                                      <span className="avm-primary-tag ms-2">Primary</span>
                                    )}
                                  </td>
                                  <td>
                                    {r.designation
                                      ? <Tooltip label={r.designation}><span>{r.designation.length > 25 ? r.designation.slice(0, 25) + '…' : r.designation}</span></Tooltip>
                                      : '—'}
                                  </td>
                                  <td><span className="font-monospace fs-13">{r.phone || '—'}</span></td>
                                  <td>
                                    {r.email
                                      ? <Tooltip label={r.email}><span>{r.email.length > 24 ? r.email.slice(0, 24) + '…' : r.email}</span></Tooltip>
                                      : '—'}
                                  </td>
                                  <td>
                                    <span className={r.whatsapp ? 'avm-wa-yes' : 'avm-wa-no'}>
                                      {r.whatsapp ? '✓ Yes' : '— No'}
                                    </span>
                                  </td>
                                  <td>
                                    {r.attachmentName ? (
                                      r.attachmentHref ? (
                                        <Tooltip label={r.attachmentName}>
                                          <a
                                            href={r.attachmentHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="fs-13 d-inline-flex align-items-center"
                                            style={{ color: '#6d28d9', textDecoration: 'underline', textUnderlineOffset: 2 }}
                                          >
                                            <i className="ri-attachment-line me-1" />
                                            {r.attachmentName.length > 20 ? r.attachmentName.slice(0, 20) + '…' : r.attachmentName}
                                          </a>
                                        </Tooltip>
                                      ) : (
                                        <Tooltip label={r.attachmentName}>
                                          <span className="fs-13"><i className="ri-attachment-line text-muted me-1" />{r.attachmentName.length > 20 ? r.attachmentName.slice(0, 20) + '…' : r.attachmentName}</span>
                                        </Tooltip>
                                      )
                                    ) : (
                                      <span className="text-muted fs-13">—</span>
                                    )}
                                  </td>
                                  <td>
                                    <div className="avm-row-actions">
                                      {r.isPrimary ? (
                                        <>
                                          <Tooltip label="Edit primary contact">
                                            <button type="button" className="avm-row-btn" onClick={startEditPrimary} aria-label="Edit primary contact">
                                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                          </Tooltip>
                                          <Tooltip label="Primary contact can’t be deleted">
                                            {/* Kept clickable (not disabled) so a click can surface the
                                                toast — a truly-disabled button fires nothing. Styled to
                                                read as non-actionable. */}
                                            <button
                                              type="button"
                                              className="avm-row-btn avm-row-btn-del"
                                              aria-label="Delete (not allowed)"
                                              style={{ opacity: 0.4, cursor: 'not-allowed' }}
                                              onClick={() => toast.info('Primary contact locked', 'The primary contact can’t be deleted here.')}
                                            >
                                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                                            </button>
                                          </Tooltip>
                                        </>
                                      ) : (
                                        <>
                                          <Tooltip label="Edit">
                                            <button type="button" className="avm-row-btn" onClick={() => r.contactId !== undefined && openContactEdit(r.contactId)} aria-label="Edit">
                                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                            </button>
                                          </Tooltip>
                                          <Tooltip label="Delete">
                                            <button type="button" className="avm-row-btn avm-row-btn-del" onClick={() => r.contactId !== undefined && removeExtraContact(r.contactId)} aria-label="Delete">
                                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                                            </button>
                                          </Tooltip>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </SectionCard>
                </>
              )}
            </>
          )}

          {/* ─── STEP 2 ─── */}
          {/* The "+ Add" header pill is hidden for the three KYC sub-tabs
              (company / owner / license) — rows there are sourced from
              the segment-rule reference tables now. Bank Details and GST
              Scrutiny still need the add button for manual entries. */}
          {step === 2 && (<>
            {/* Sub-tab strip sits ABOVE the section card (Figma layout). */}
            <div className="avm-pill-tabs">
              <button className={`avm-pill ${kycTab === 'company' ? 'on' : ''}`} onClick={() => setKycTab('company')}>Company Due Diligence</button>
              <button className={`avm-pill ${kycTab === 'owner'   ? 'on' : ''}`} onClick={() => setKycTab('owner')}>Owner KYC</button>
              <button className={`avm-pill ${kycTab === 'license' ? 'on' : ''}`} onClick={() => setKycTab('license')}>Trade Licence</button>
              <button className={`avm-pill ${kycTab === 'bank'    ? 'on' : ''}`} onClick={() => setKycTab('bank')}>Bank Details</button>
              {/* Hidden entirely when the supplier isn't GST-registered — there
                  is no GSTIN to scrutinise. See kycTabOrder. */}
              {gstApplicable === 'Yes' && (
                <button className={`avm-pill ${kycTab === 'gst'     ? 'on' : ''}`} onClick={() => setKycTab('gst')}>GST Scrutiny</button>
              )}
            </div>
            <SectionCard tone="purple" icon={<i className="ri-file-line" style={{ transform: 'scaleX(-1)' }} />} title={KYC_TAB_TITLE[kycTab] ?? 'KYC / Due Diligence'} subtitle={KYC_TAB_SUB[kycTab] ?? 'Upload statutory & identity proofs'} headerAction={
              <div className="d-inline-flex align-items-center gap-2">
                <span className="avm-doc-count">{kycDocCount} document{kycDocCount === 1 ? '' : 's'}</span>
                {(kycTab === 'bank' || kycTab === 'gst') && (
                  <button className="avm-section-add-btn" onClick={kycTabAddMeta[kycTab].onClick}>
                    {kycTabAddMeta[kycTab].label}
                  </button>
                )}
              </div>
            }>

              {kycTab === 'company' && (
                ddRows.length === 0 && segmentDocs.dd.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="DD DOCUMENT NAME"
                    rows={segmentDocs.dd}
                    tabKey="company"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <DdTable
                    rows={ddRows}
                    onRemove={removeDdRow}
                    onAttach={attachFileToDd}
                    onClearFile={(id) => setDdRows(prev => prev.map(r => r.id === id ? { ...r, file: null, fileName: '', existingPath: undefined } : r))}
                  />
                )
              )}
              {kycTab === 'owner' && (
                ownerRows.length === 0 && segmentDocs.kyc.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="KYC DOCUMENT NAME"
                    rows={segmentDocs.kyc}
                    tabKey="owner"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <OwnerKycTable
                    rows={ownerRows}
                    onRemove={removeOwnerRow}
                  />
                )
              )}
              {kycTab === 'license' && (
                licenseRows.length === 0 && segmentDocs.tl.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="TRADE LICENSE NAME"
                    rows={segmentDocs.tl}
                    tabKey="license"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <TradeLicenseTable
                    rows={licenseRows}
                    onRemove={removeLicRow}
                    onAttach={attachFileToLicense}
                    onClearFile={(id) => setLicenseRows(prev => prev.map(r => r.id === id ? { ...r, file: null, fileName: '', existingPath: undefined } : r))}
                  />
                )
              )}
              {kycTab === 'bank' && (
                <BankTable
                  rows={bankRows}
                  onRemove={removeBankRow}
                  lockRemove={isEdit}
                  international={supplierDocType === "international"}
                  onEdit={openBankEdit}
                  onClearFile={(id) => setBankRows(prev => prev.map(r => r.id === id ? { ...r, chequeFile: null, chequeFileName: '', existingPath: undefined } : r))}
                />
              )}
              {kycTab === 'gst' && (
                <GstScrutinyTable rows={gstRows} />
              )}
            </SectionCard>
          </>)}

          {/* ─── STEP 3 ─── */}
          {/* Step 3 (Trade Document Management / Evidence Vault) removed —
              KYC & trade-document uploads now live in the standalone
              Evidence Vault popup. */}

          {/* ─── STEP 3 — Map Products ─── */}
          {step === 3 && (
            <SectionCard tone="green" icon={<i className="ri-box-3-line" />} title="Products Details" subtitle="Link products to this vendor with purchase price & GST" headerAction={
              <button className="avm-section-add-btn" onClick={openMapPopup}>+ Add More Products</button>
            }>
              <ProductMappingTable rows={productMappings} onRemove={removeMapRow} onEdit={openMapEdit} />
            </SectionCard>
          )}
          </>)}
        </div>

        {/* ─── Footer ─── */}
        <div className="avm-foot">
          <div className="avm-foot-note">
            <span className="avm-foot-dot" /> Fields marked with <span className="avm-req">*</span> are required
          </div>
          <div className="avm-foot-right">
            {!(step === 1 && idTab === 'identification') && <button className="avm-btn-outline" onClick={goPrev}>← Previous</button>}
            {!(step === 2 && kycTabOrder.indexOf(kycTab) === kycTabOrder.length - 1) ? (
              <button className="avm-btn-primary" onClick={goNext} disabled={saving || loadingEdit || mastersLoading}>
                {saving ? (
                  <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    {isEdit ? 'Update' : 'Save'} &amp; Next →
                  </>
                )}
              </button>
            ) : (
              <button className="avm-btn-primary" onClick={finishSupplier} disabled={saving || loadingEdit || mastersLoading}>
                {saving ? (
                  <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    {isEdit ? 'Update Supplier' : 'Save Supplier'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {contactPopupOpen && (
        <ContactAddPopup
          draft={contactDraft}
          setDraft={setContactDraft}
          onClose={() => setContactPopupOpen(false)}
          onSave={saveContactDraft}
          isIndia={supplierDocType === 'domestic'}
        />
      )}

      {ddPopupOpen && (
        <DdAddPopup
          nextCodePreview={nextCode('DD', ddRows)}
          draft={ddDraft}
          setDraft={setDdDraft}
          onClose={() => setDdPopupOpen(false)}
          onSave={saveDdDraft}
        />
      )}
      {ownerPopupOpen && (
        <OwnerKycAddPopup
          nextCodePreview={nextCode('KYC', ownerRows)}
          draft={ownerDraft}
          setDraft={setOwnerDraft}
          onClose={() => setOwnerPopupOpen(false)}
          onSave={saveOwnerDraft}
        />
      )}
      {licPopupOpen && (
        <TradeLicenseAddPopup
          draft={licDraft}
          setDraft={setLicDraft}
          typeOpts={licenseTypeOpts}
          onClose={() => setLicPopupOpen(false)}
          onSave={saveLicDraft}
        />
      )}
      {bankPopupOpen && (
        <BankAddPopup
          draft={bankDraft}
          setDraft={setBankDraft}
          onClose={() => { setBankPopupOpen(false); setEditingBankId(null); }}
          onSave={saveBankDraft}
          isEdit={editingBankId !== null}
          existingAccounts={bankRows.filter(b => b.id !== editingBankId).map(b => b.accountNumber.trim())}
          international={supplierDocType === 'international'}
        />
      )}
      {gstPopupOpen && (
        <GstScrutinyAddPopup
          draft={gstDraft}
          setDraft={setGstDraft}
          onClose={() => setGstPopupOpen(false)}
          onSave={saveGstDraft}
        />
      )}
      {mappedListOpen && (
        <MappedProductsPopup
          rows={productMappings}
          onAdd={openMapPopup}
          onRemove={removeMapRow}
          onEdit={openMapEdit}
          onClose={() => setMappedListOpen(false)}
          busy={mappingBusy}
        />
      )}
      {mapPopupOpen && (
        <AddProductMappingPopup
          draft={mapDraft}
          setDraft={setMapDraft}
          productOpts={(() => {
            const segSet = new Set((segment ?? []).map(Number).filter(n => n > 0));
            const mapped = new Set(
              productMappings
                .filter(m => m.id !== mapEditingId)      
                .map(m => String(m.productId ?? '')),
            );
            return productOpts.filter(o => {
              if (o.value === mapDraft.productId) return true;   
              if (mapped.has(String(o.value))) return false;
              return segSet.size === 0 || (o.segmentId != null && segSet.has(o.segmentId));
            });
          })()}
          gstPctOpts={gstPctOpts}
          onProductChange={onMapProductChange}
          recompute={recomputeMapTotals}
          onClose={() => setMapPopupOpen(false)}
          onSave={saveMapDraft}
        />
      )}

      {segAdd && (
        <>
          {/* CLM modal styles aren't injected by SegmentModal itself (the CLM
              page normally provides them), so load them here while it's open. */}
          <style>{CLM_CSS}</style>
          <SegmentModal
            existing={null}
            nextCode={segAdd.nextCode}
            existingNames={segAdd.names}
            onClose={() => setSegAdd(null)}
            onSave={async (form: SegmentForm) => {
              try {
                const { data } = await api.post<{ data: { id: number; name: string } }>('/clm/segments', form);
                const created = data?.data;
                if (created?.id) {
                  const id = String(created.id);
                  setSegmentOpts(prev => [...prev, { value: id, label: String(created.name ?? form.name) }]);
                  toast.info(
                    'Segment created',
                    `${created.name ?? form.name} can't be selected until a rule is defined for it in the Document Control Panel.`,
                  );
                }
                bustVendorMasterBundle();
                setSegAdd(null);
                return { ok: true } as const;
              } catch (e: any) {
                toast.error('Save failed', e?.response?.data?.message ?? 'Could not save segment');
                return { ok: false } as const;
              }
            }}
          />
        </>
      )}

      {quickAdd && (
        <MasterRecordModal
          slug={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(row) => {
            const id = String(row.id ?? '');
            if (!id) { setQuickAdd(null); return; }
            bustVendorMasterBundle();
            if (row.status && String(row.status).toLowerCase() !== 'active') {
              toast.info('Saved as Inactive', 'Only Active records appear in this dropdown. Set it to Active to select it here.');
              setQuickAdd(null);
              return;
            }
            switch (quickAdd) {
              case 'vendor_types': {
                const label = String(row.name ?? '');
                if (label) { setVendorTypeOpts(prev => [...prev, { value: id, label }]); setVendorType(id); clearFieldError('vendorType'); }
                break;
              }
              case 'risk_levels': {
                const label = String(row.name ?? '');
                if (label) { setRiskLevelOpts(prev => [...prev, { value: id, label }]); setRiskLevel(id); clearFieldError('riskLevel'); }
                break;
              }
              case 'vendor_behaviour': {
                const label = String(row.name ?? '');
                if (label) { setBehaviourOpts(prev => [...prev, { value: id, label }]); setVendorBehaviour(id); clearFieldError('vendorBehaviour'); }
                break;
              }
              case 'segments': {
                const label = String(row.title ?? '');
                if (label) {
                  setSegmentOpts(prev => [...prev, { value: id, label }]);
                  setSegment(prev => prev.includes(id) ? prev : [...prev, id]);
                  clearFieldError('segment');
                }
                break;
              }
              case 'compliance_behaviours': {
                const label = String(row.name ?? '');
                if (label) { setComplianceOpts(prev => [...prev, { value: id, label }]); setComplianceBehaviour(id); clearFieldError('complianceBehaviour'); }
                break;
              }
              case 'countries': {
                const label = String(row.name ?? '');
                if (label) { setCountryOpts(prev => [...prev, { value: id, label }]); setCountry(id); clearFieldError('country'); }
                break;
              }
            }
            setQuickAdd(null);
          }}
        />
      )}

      {/* Step 3 Trade Documents → Send for Signature (Zoho Sign).
          Mounts at the modal root so the wizard renders ABOVE the
          vendor form. modelName='Vendor' makes the backend resolve
          the {{supplier.*}} token namespace from this vendor. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendForSignature)}
        modelName="Vendor"
        customer={(() => {
          if (!vendorId) return null;
          return {
            id:      `v-${vendorId}`,
            db_id:   vendorId,
            company: companyName || '',
            contact: contactName || '',
            email:   email || '',
          };
        })()}
        preselectedDocIds={sendForSignature ?? undefined}
        onClose={() => setSendForSignature(null)}
        onSent={(sentDocIds) => {
          const sentSet = new Set(sentDocIds);
          setTradeDocRows(prev => prev.map(r => (r.db_id && sentSet.has(r.db_id))
            ? { ...r, sendForSignature: false, status: 'inprogress' as const }
            : r));
          setSendForSignature(null);
        }}
      />
    </div>
  ), document.body);
}

type VendorMasterSlug = 'vendor_types' | 'risk_levels' | 'vendor_behaviour' | 'segments' | 'compliance_behaviours' | 'countries';

type QaField = { name: string; label: string; type?: 'text' | 'number' | 'textarea' | 'select'; required?: boolean; placeholder?: string; options?: string[] };

const STATUS_FIELD: QaField = { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Inactive'] };
const QUICK_ADD_SCHEMAS: Record<VendorMasterSlug, { title: string; singular: string; icon: string; fields: QaField[] }> = {
  vendor_types:          { title: 'Add Supplier Type', singular: 'Supplier Type', icon: 'ri-shield-check-line', fields: [
    { name: 'name',  label: 'Supplier Type', required: true, placeholder: 'e.g. Genuine / Verified' },
    STATUS_FIELD,
  ] },
  risk_levels:           { title: 'Add Risk Level', singular: 'Risk Level', icon: 'ri-flashlight-line', fields: [
    { name: 'name',            label: 'Risk Level',      type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
    { name: 'description',     label: 'Description',      placeholder: 'Risk criteria' },
    { name: 'action_required', label: 'Action Required',  placeholder: 'e.g. Escalate' },
    STATUS_FIELD,
  ] },
  vendor_behaviour:      { title: 'Add Supplier Behaviour', singular: 'Supplier Behaviour', icon: 'ri-pulse-line', fields: [
    { name: 'name',        label: 'Behaviour Type', required: true, placeholder: 'e.g. Excellent, Good' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Behaviour definition' },
    STATUS_FIELD,
  ] },
  segments:              { title: 'Add Segment', singular: 'Segment', icon: 'ri-focus-3-line', fields: [
    { name: 'title', label: 'Segment Name', required: true, placeholder: 'e.g. Dry Fruits' },
    STATUS_FIELD,
  ] },
  compliance_behaviours: { title: 'Add Compliance Behaviour', singular: 'Compliance Behaviour', icon: 'ri-scales-3-line', fields: [
    { name: 'name',            label: 'Behaviour Name',  required: true, placeholder: 'e.g. Compliant, Under Review' },
    { name: 'action_required', label: 'Action Required', placeholder: 'Next steps' },
    STATUS_FIELD,
  ] },
  countries:             { title: 'Add Country', singular: 'Country', icon: 'ri-earth-line', fields: [
    { name: 'name',     label: 'Country Name', required: true, placeholder: 'e.g. India' },
    { name: 'iso_code', label: 'ISO Code', placeholder: 'e.g. IN' },
    STATUS_FIELD,
  ] },
};

function MasterQuickAddPopup(props: {
  slug: VendorMasterSlug;
  onClose: () => void;
  onSaved: (row: Record<string, unknown>) => void;
}) {
  const { slug, onClose, onSaved } = props;
  const toast = useToast();
  const schema = QUICK_ADD_SCHEMAS[slug];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (schema.fields.some(f => f.name === 'status')) init.status = 'Active';
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => {
    setValues(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    const QA_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i;
    const QA_NAME_WHITELIST = /^[A-Za-z0-9\s\-.,()&/'%]+$/;
    schema.fields.forEach(f => {
      const raw = (values[f.name] ?? '').toString().trim();
      if (f.required && !raw) {
        errs[f.name] = `${f.label} is required`;
        return;
      }
      if (!raw || f.type === 'number') return;
      if (/[<>]/.test(raw)) {
        errs[f.name] = `${f.label} cannot contain HTML characters (< or >)`;
        return;
      }
      if (QA_SQL_RE.test(raw)) {
        errs[f.name] = `${f.label} contains disallowed patterns (possible SQL/JS injection)`;
        return;
      }
      if (!/[A-Za-z0-9]/.test(raw)) {
        errs[f.name] = `${f.label} must contain meaningful text (letters or numbers)`;
        return;
      }
      if (!QA_NAME_WHITELIST.test(raw)) {
        errs[f.name] = `${f.label} may only contain letters, numbers, spaces, and . , - ( ) & / ' %`;
        return;
      }
      if (raw.length > 80) {
        errs[f.name] = `${f.label} must be 80 characters or fewer`;
        return;
      }
    });
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { status: 'Active', ...values };
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
    <div className="avm-qa-backdrop">
      <div className="avm-qa-popup">
        <div className="avm-qa-head">
          {/* Mirrors the master Add modal: frosted icon badge + title +
              "Fill in the details to register a new X" subtitle. */}
          <span className="avm-qa-head-glow" aria-hidden />
          <div className="avm-qa-head-main">
            <span className="avm-qa-head-ico"><i className={schema.icon} /></span>
            <div className="avm-qa-head-text">
              <div className="avm-qa-title">{schema.title}</div>
              <div className="avm-qa-sub">Fill in the details to register a new {schema.singular.toLowerCase()}</div>
            </div>
          </div>
          <button className="avm-close avm-qa-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="avm-qa-body">
          {/* Footer Cancel was already guarded; the ✕ was not — closing mid-POST
              let the user reopen and submit the same master row twice. */}
          {saving && <div className="avm-cp-saving-veil" />}
          {schema.fields.map(f => (
            <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]}>
              {f.type === 'textarea' ? (
                <textarea
                  className="avm-input"
                  rows={3}
                  placeholder={f.placeholder ?? ''}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              ) : f.type === 'select' ? (
                <select
                  className="avm-input"
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                >
                  <option value="">— Select —</option>
                  {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="avm-input"
                  type={f.type === 'number' ? 'number' : 'text'}
                  placeholder={f.placeholder ?? ''}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="avm-qa-foot">
          <button className="avm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="avm-btn-primary" onClick={submit} disabled={saving}>
            <i className="ri-save-line" /> {saving ? 'Saving…' : `Save ${schema.singular}`}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

type ContactDraft = {
  name: string;
  designation: string;
  phone: string;
  email: string;
  whatsapp: boolean;
  attachmentName: string;
  attachmentFile?: File | null;
  attachmentPath?: string;
  attachmentUrl?: string;
};
function ContactAddPopup(props: {
  draft: ContactDraft;
  setDraft: (next: ContactDraft) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  isIndia?: boolean;
}) {
  const { draft, setDraft, onClose, onSave, isIndia = false } = props;
  const confirm = useConfirm();
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ name?: string; designation?: string; phone?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const handleNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAlpha(raw, 60);
    setDraft({ ...draft, name: cleaned });
    setErrors(prev => ({ ...prev, name: error }));
  };
  const handleDesignationChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycDesignation(raw, 60);
    setDraft({ ...draft, designation: cleaned });
    setErrors(prev => ({ ...prev, designation: error }));
  };
  return createPortal((
    <div className="avm-cp-backdrop">
      <div className="avm-cp-popup">
        <div className="avm-cp-head">
          <div className="avm-cp-title">
            <i className="ri-user-add-line" /> Add Contact Person
          </div>
          <button className="avm-close avm-cp-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="avm-cp-body">
          {/* This popup hand-rolls the .avm-cp-* chrome instead of using
              PopupShell, so it needs its own veil — otherwise every field stays
              editable mid-save and the attachment-delete confirm can fire. */}
          {saving && <div className="avm-cp-saving-veil" />}
          <div className="avm-grid-4">
            <Field label="Contact Person Name" required error={errors.name}>
              <input
                className="avm-input"
                placeholder="Enter name"
                value={draft.name}
                maxLength={60}
                onChange={e => handleNameChange(e.target.value)}
              />
            </Field>
            <Field label="Designation" required error={errors.designation}>
              <input
                className="avm-input"
                placeholder="Enter designation"
                value={draft.designation}
                maxLength={60}
                onChange={e => handleDesignationChange(e.target.value)}
              />
            </Field>
            <Field label="Contact No" required error={errors.phone}>
              <ContactNoInput
                value={draft.phone}
                isIndia={isIndia}
                onChange={(v) => { set('phone', v); setErrors(prev => ({ ...prev, phone: undefined })); }}
              />
            </Field>
            <Field label="Email" required error={errors.email}>
              {/* Lower-cased on entry — same reason as the primary contact's
                  email field above: the uniqueness check compares lower-cased. */}
              <input className="avm-input" placeholder="Enter email" value={draft.email} onChange={e => { set('email', e.target.value.toLowerCase()); setErrors(prev => ({ ...prev, email: undefined })); }} />
            </Field>
          </div>

          <div className="avm-grid-2">
            <Field label="WhatsApp Enabled?">
              <div className="avm-radio-row">
                <label className="avm-radio">
                  <input type="radio" checked={draft.whatsapp} onChange={() => set('whatsapp', true)} /> Yes
                </label>
                <label className="avm-radio">
                  <input type="radio" checked={!draft.whatsapp} onChange={() => set('whatsapp', false)} /> No
                </label>
              </div>
            </Field>
            <Field label="Attachments">
              {/* FileChooser provides the empty-state input + populated-
                 state filename / View / Delete actions. Swapping in here
                 so the contact popup matches the rest of the wizard's
                 file fields and the user can preview / remove an
                 attachment without retyping the form.
                 imagesPdfOnly matches the backend's validateContact() rule
                 (mimes:jpg,jpeg,png,webp,pdf) — same as the primary card. */}
              <FileChooser
                imagesPdfOnly
                file={draft.attachmentFile ?? null}
                existingPath={draft.attachmentFile ? undefined : draft.attachmentPath}
                existingUrl={draft.attachmentFile ? undefined : draft.attachmentUrl}
                existingName={draft.attachmentFile ? undefined : (draft.attachmentName || undefined)}
                onPick={async (f) => {
                  if (!f && (draft.attachmentFile || draft.attachmentPath)) {
                    const ok = await confirm({
                      title: 'Remove Attachment?',
                      message: 'This attachment will be removed from this contact person. It is deleted for good once you save.',
                      confirmLabel: 'Remove',
                      cancelLabel: 'Cancel',
                      tone: 'danger',
                      icon: 'delete-bin-line',
                    });
                    if (!ok) return;
                  }
                  setDraft({
                    ...draft,
                    attachmentFile: f,
                    attachmentName: f?.name ?? '',
                    attachmentPath: f ? draft.attachmentPath : undefined,
                  });
                }}
                placeholder="No files attached"
              />
            </Field>
          </div>
        </div>

        <div className="avm-cp-foot">
          <button className="avm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="avm-btn-primary"
            disabled={saving}
            onClick={async () => {
              if (saving) return;
              const errs: typeof errors = { ...errors };
              errs.name        = draft.name.trim()        ? errs.name        : 'Contact Person Name is required';
              errs.designation = draft.designation.trim() ? errs.designation : 'Designation is required';
              errs.phone       = draft.phone.trim()       ? undefined        : 'Contact No is required';
              errs.email       = draft.email.trim()       ? undefined        : 'Email is required';
              setErrors(errs);
              if (Object.values(errs).some(Boolean)) return;
              setSaving(true);
              try { await onSave(); } finally { setSaving(false); }
            }}
          >
            {saving
              ? <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
              : <><i className="ri-save-line" /> Save</>}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

function StepperItem(props: {
  n: number; title: string; sub: string; current: number;
  tone: 'violet' | 'teal' | 'purple' | 'green';
  icon: string;
}) {
  const state = props.current > props.n ? 'done' : props.current === props.n ? 'active' : 'idle';
  return (
    <div className={`avm-step avm-step-${state} avm-step-${props.tone}`}>
      <div className="avm-step-ico">
        {state === 'done'
          ? <><i className="ri-check-line" /><span className="avm-step-ico-check"><i className="ri-check-line" /></span></>
          : <><i className={props.icon} /><span className="avm-step-ico-num">{props.n}</span></>}
      </div>
      <div className="avm-step-text">
        <div className="avm-step-title">{props.title}</div>
        <div className="avm-step-sub">{props.sub}</div>
      </div>
      {state === 'active' && <span className="avm-step-badge avm-step-badge-active">In Progress</span>}
      {state === 'done'   && <span className="avm-step-badge avm-step-badge-done">Completed</span>}
    </div>
  );
}

function SectionCard(props: {
  tone: 'violet' | 'amber' | 'teal' | 'green' | 'purple';
  icon: ReactNode;
  title: string;
  subtitle: string;
  headerAction?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`avm-section avm-section-${props.tone}${props.className ? ` ${props.className}` : ''}`}>
      <div className="avm-section-head">
        <div className="avm-section-head-left">
          <div className="avm-section-icon">{props.icon}</div>
          <div className="avm-section-headtext">
            <div className="avm-section-title">{props.title}</div>
            <div className="avm-section-sub">{props.subtitle}</div>
          </div>
        </div>
        {props.headerAction}
      </div>
      <div className="avm-section-body">{props.children}</div>
    </div>
  );
}

function SkelField({ label = 60 }: { label?: number }) {
  return (
    <div className="avm-field">
      <Shimmer width={`${label}%`} height={10} radius={4} />
      <Shimmer width="100%" height={38} radius={10} />
    </div>
  );
}

function Step1IdentitySkeleton() {
  return (
    <>
      <SectionCard tone="violet" icon={<i className="ri-home-line" />} title="Basic Company Details" subtitle="Supplier identity, type, and risk classification">
        {/* 3 × 3 — the same grid the real card uses. */}
        <div className="avm-grid-3">
          {[52, 62, 46, 50, 58, 40, 56, 60, 64].map((w, i) => <SkelField key={i} label={w} />)}
        </div>
      </SectionCard>
      <SectionCard tone="amber" icon={<i className="ri-map-pin-line" />} title="Supplier Address Details" subtitle="Registered office and location">
        {/* Full-width Registered Office Address, then Country / State / State
            Code / City across four, then the two-up row below it. */}
        <div className="avm-grid-2" style={{ gridTemplateColumns: '1fr' }}><SkelField label={28} /></div>
        <div className="avm-grid-4">
          {[42, 38, 52, 30].map((w, i) => <SkelField key={i} label={w} />)}
        </div>
        <div className="avm-grid-2">
          {[46, 40].map((w, i) => <SkelField key={i} label={w} />)}
        </div>
      </SectionCard>
    </>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  addNew?: boolean;
  addLoading?: boolean;
  onAdd?: () => void;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`avm-field${props.error ? ' has-error' : ''}`}>
      <span className="avm-field-label">
        {props.label}{props.required && <span className="avm-req">*</span>}
        {props.addNew && (
          <button
            type="button"
            className="avm-field-plus"
            tabIndex={-1}
            disabled={props.addLoading}
            title={props.addLoading ? 'Opening…' : `Add new ${props.label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!props.addLoading) props.onAdd?.(); }}
          >{props.addLoading ? <span className="avm-spinner avm-spinner-sm" role="status" aria-hidden="true" /> : '+'}</button>
        )}
        {props.hint}
      </span>
      {props.children}
      {props.error && (
        <span className="avm-field-error">
          <i className="ri-error-warning-line" /> {props.error}
        </span>
      )}
    </div>
  );
}

function LockField({ locked, onLockClick, children }: { locked: boolean; onLockClick: () => void; children: React.ReactNode }) {
  if (!locked) return <>{children}</>;
  return (
    <div className="avm-lockwrap" onClick={onLockClick} title="Locked — this supplier is mapped to a Purchase Order">
      <div className="avm-lockwrap-inner">{children}</div>
    </div>
  );
}

function SelectInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: Array<string | { value: string; label: string }>;
  disabled?: boolean;
}) {
  const normalized = props.options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <div className="avm-master-select">
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

const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const FILE_ACCEPT     = '.jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FILE_MAX_BYTES  = 2 * 1024 * 1024; 
const FILE_TYPE_LABEL = 'JPG / PNG / PDF / DOC / DOCX';
const FILE_ALLOWED_EXT_RE   = /\.(jpe?g|png|pdf|docx?)$/i;
const FILE_ALLOWED_MIME_RE  = /^(image\/(jpeg|png)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/i;

const IMG_PDF_ACCEPT    = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';
const IMG_PDF_LABEL     = 'JPG / JPEG / PNG / WEBP / PDF';
const IMG_PDF_EXT_RE    = /\.(jpe?g|png|webp|pdf)$/i;
const IMG_PDF_MIME_RE   = /^(image\/(jpe?g|png|webp)|application\/pdf)$/i;
const FILE_DENY_EXT_RE = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ws[hf]?|ps1|psm1|jar|sh|app|apk|dll|deb|rpm|html?|svg|php|asp[x]?|jsp)$/i;

function validateVendorUpload(file: File): { title: string; body: string } | null {
  if (FILE_DENY_EXT_RE.test(file.name)) {
    return { title: 'Unsafe file type blocked', body: `${file.name} — executable / script files are not allowed` };
  }
  const mimeOk = file.type && FILE_ALLOWED_MIME_RE.test(file.type);
  const extOk  = FILE_ALLOWED_EXT_RE.test(file.name);
  if (!mimeOk && !extOk) {
    return { title: 'Unsupported file', body: `Only ${FILE_TYPE_LABEL} files are allowed` };
  }
  if (file.size > FILE_MAX_BYTES) {
    return { title: 'File too large', body: `${file.name} exceeds the 2 MB limit` };
  }
  return null;
}

function FileChooser(props: {
  file: File | null;
  onPick: (f: File | null) => void;
  placeholder?: string;
  existingPath?: string;
  existingUrl?: string;
  existingName?: string;
  readOnly?: boolean;
  imagesPdfOnly?: boolean;
  noDelete?: boolean;
}) {
  const { file, onPick, placeholder, existingPath, existingUrl, existingName, readOnly, imagesPdfOnly, noDelete } = props;
  const toast = useToast();

  const ACCEPT   = imagesPdfOnly ? IMG_PDF_ACCEPT   : FILE_ACCEPT;
  const EXT_RE   = imagesPdfOnly ? IMG_PDF_EXT_RE   : FILE_ALLOWED_EXT_RE;
  const MIME_RE  = imagesPdfOnly ? IMG_PDF_MIME_RE  : FILE_ALLOWED_MIME_RE;
  const LABEL    = imagesPdfOnly ? IMG_PDF_LABEL    : FILE_TYPE_LABEL;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) { onPick(null); return; }
    const name = picked.name;
    if (FILE_DENY_EXT_RE.test(name)) {
      toast.error('Unsafe file type blocked', `${name} — executable / script files are not allowed`);
      e.target.value = '';
      return;
    }
    const mimeOk = picked.type && MIME_RE.test(picked.type);
    const extOk  = EXT_RE.test(name);
    if (!mimeOk && !extOk) {
      toast.error('Unsupported file', `Only ${LABEL} files are allowed`);
      e.target.value = '';
      return;
    }
    if (picked.size > FILE_MAX_BYTES) {
      toast.error('File too large', `${picked.name} exceeds the 2 MB limit`);
      e.target.value = '';
      return;
    }
    onPick(picked);
  };

  const hasFile = !!file || !!existingPath || !!existingUrl;
  const stripPrefix = (n: string) => {
    const idx = n.indexOf('__');
    return idx >= 0 ? n.slice(idx + 2) : n;
  };
  const fileName = file?.name
    ?? existingName
    ?? (existingPath ? stripPrefix(existingPath.split('/').pop() ?? 'Attachment') : (existingUrl ? 'Uploaded file' : ''));
  const viewHref = file
    ? URL.createObjectURL(file)
    : (existingUrl || (existingPath ? resolveFileUrl(existingPath) : ''));

  if (!hasFile) {
    if (readOnly) {
      return (
        <div className="avm-filechooser">
          <span className="avm-filechooser-icon"><i className="ri-attachment-line" /></span>
          <span className="avm-filechooser-text">No file attached</span>
        </div>
      );
    }
    return (
      <div className="avm-filechooser">
        <input
          type="file"
          className="avm-filechooser-input"
          accept={ACCEPT}
          onChange={onChange}
        />
        {/* Upload-cloud icon for the EMPTY state so it reads as "upload here",
            not an already-attached file (the paperclip stays for the filled state). */}
        <span className="avm-filechooser-icon"><i className="ri-upload-cloud-2-line" /></span>
        <span className="avm-filechooser-text">{placeholder ?? `Choose file (${FILE_TYPE_LABEL}, max 2 MB)`}</span>
      </div>
    );
  }

  return (
    <div className="avm-filechooser avm-filechooser-has-file">
      {viewHref ? (
        <Tooltip label={`Open ${fileName}`}>
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="avm-filechooser-text avm-filechooser-link"
            onClick={(e) => e.stopPropagation()}
          >
            {fileName}
          </a>
        </Tooltip>
      ) : (
        <Tooltip label={fileName}>
          <span className="avm-filechooser-text">{fileName}</span>
        </Tooltip>
      )}
      <div className="avm-filechooser-actions">
        {/* View (eye) removed — the filename above is itself a link that opens
            the attachment. Replace swaps the file in place (re-upload without
            deleting first); Delete clears it. Both hidden when read-only. */}
        {!readOnly && (
          <Tooltip label="Replace file">
            <label
              className="avm-fc-action avm-fc-replace"
              aria-label="Replace file"
              onClick={(e) => e.stopPropagation()}
            >
              <i className="ri-refresh-line" />
              <input type="file" hidden accept={ACCEPT} onChange={onChange} />
            </label>
          </Tooltip>
        )}
        {!readOnly && !noDelete && (
          <Tooltip label="Delete attachment">
            <button
              type="button"
              className="avm-fc-action avm-fc-delete"
              aria-label="Delete attachment"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPick(null); }}
            >
              <i className="ri-delete-bin-line" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function EmptyTable(props: { label: string }) {
  return <div className="avm-empty">{props.label}</div>;
}

/* Shared chrome for every KYC-style table in this form.
 *
 * The six tables below — Due Diligence, Owner KYC, Trade Licence, Bank, GST
 * Scrutiny, Product Mapping — each repeated the same opening: an empty-state
 * guard, the .table-responsive wrapper, the .avm-kyc-table element, a
 * .table-light thead and a <tr> of <th>. Six copies of twelve lines, which is
 * also six places for the chrome to drift apart — and it had: one table's
 * wrapper was already missing .table-card.
 *
 * What is NOT shared is the body. Each table maps a different row type over a
 * different set of 6-10 columns with its own formatters, so the rows stay
 * written out per table. A generic column-config table would have to express
 * every one of those cases and would end up longer than what it replaced.
 *
 * `headers` takes a plain string, or a {label, className} pair for the few
 * columns that need alignment (the money columns are .text-end).
 * `tableClassName` carries the per-table modifiers: .avm-gst-table pins the
 * GST column alignment, .avm-mapped-table restyles Product Mapping. */
type KycTableHeader = string | { label: string; className?: string };
function KycTable(props: {
  empty: string;
  isEmpty: boolean;
  headers: KycTableHeader[];
  wrapClassName?: string;
  tableClassName?: string;
  children: ReactNode;
}) {
  if (props.isEmpty) return <EmptyTable label={props.empty} />;
  return (
    <div className={`table-responsive table-card border rounded avm-kyc-table-wrap${props.wrapClassName ? ` ${props.wrapClassName}` : ''}`}>
      <table className={`table align-middle mb-0 avm-kyc-table${props.tableClassName ? ` ${props.tableClassName}` : ''}`}>
        <thead className="table-light">
          <tr>
            {props.headers.map((h, i) => (
              typeof h === 'string'
                ? <th key={i}>{h}</th>
                : <th key={i} className={h.className}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

function fmtSegRefExpiry(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDMY(iso?: string | null): string {
  if (!iso) return '—';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}-${DMY_MONTHS[parseInt(m[2], 10) - 1]}-${m[1]}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : `${String(d.getDate()).padStart(2, '0')}-${DMY_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function segExpiryTone(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today ? 'is-expired' : 'is-valid';
}

type SegRefRow = { code: string; name: string; authority?: string | null; authority_list?: string[] | null; expiry?: string | null; requirement: 'M' | 'O' };

function SupplierSegmentRefTable(props: {
  title: string;
  tabKey: string;
  rows: SegRefRow[];
  uploads: Record<string, { file: File | null; url: string; name: string; expiry?: string }>;
  setUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string; expiry?: string }>>>;
  persistUpload: (refKey: string, file: File, docName: string, expiryDate?: string) => Promise<void> | void;
}) {
  const { title, tabKey, rows, uploads, setUploads, persistUpload } = props;
  const toast = useToast();
  const [popupRow, setPopupRow] = useState<SegRefRow | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const doDownload = async (refKey: string, url: string, name: string) => {
    if (downloadingKey) return;
    setDownloadingKey(refKey);
    try { await downloadFile(url, name); }
    catch { toast.error('Download failed', 'Could not download the file. Please try again.'); }
    finally { setDownloadingKey(null); }
  };
  const onSubmit = async (row: SegRefRow, f: File, expiryDate?: string): Promise<boolean> => {
    const refKey = `${tabKey}::${row.code}`;
    const err = validateVendorUpload(f);
    if (err) { toast.error(err.title, err.body); return false; }
    setUploads(prev => {
      const existing = prev[refKey];
      if (existing?.url && existing.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing.url); } catch {}
      }
      return { ...prev, [refKey]: { file: f, url: URL.createObjectURL(f), name: f.name, expiry: expiryDate || undefined } };
    });
    try {
      await persistUpload(refKey, f, row.name, expiryDate);
    } catch {
      return false;
    }
    return true;
  };
  const [q, setQ] = useState('');
  const lo = q.trim().toLowerCase();
  const filtered = lo
    ? rows.filter(r => `${r.code} ${r.name} ${r.authority ?? ''}`.toLowerCase().includes(lo))
    : rows;
  return (
    <>
      {/* Search bar (Figma) */}
      <div className="avm-kyc-search">
        <i className="ri-search-line" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${title.replace(/ NAME$/i, '').toLowerCase()} name…`} />
        {q && <button type="button" className="avm-kyc-search-clear" onClick={() => setQ('')} aria-label="Clear"><i className="ri-close-line" /></button>}
      </div>
      <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
        <table className="table align-middle mb-0 avm-kyc-table avm-segref-table">
          {/* Fixed column widths (table-layout: fixed, see .avm-segref-table)
              so every header sits exactly over its data — an auto layout
              stretched the columns unevenly and made them look misaligned.
              The Document Name column has no width, so it absorbs the slack. */}
          <thead className="table-light">
            <tr>
              <th style={{ width: 64 }}>SR NO</th>
              <th style={{ width: 130 }}>AUTO CODE</th>
              <th>{title}</th>
              <th style={{ width: 180 }}>ISSUING AUTHORITY</th>
              <th style={{ width: 150 }}>EXPIRY</th>
              <th style={{ width: 150 }}>REQUIREMENT</th>
              <th style={{ width: 140 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const refKey = `${tabKey}::${r.code}`;
              const uploaded = uploads[refKey];
              const uploadedExpiry = uploaded?.expiry ? fmtSegRefExpiry(uploaded.expiry) : '';
              const expiryText = uploadedExpiry || r.expiry || 'N/A';
              const isDate = !!uploadedExpiry || !!(r.expiry && /\d/.test(r.expiry));
              const expTone = segExpiryTone(uploaded?.expiry);
              return (
                <tr key={r.code}>
                  <td><span className="avm-sr-badge">{String(i + 1).padStart(2, '0')}</span></td>
                  <td><span className="avm-auto-code">{r.code}</span></td>
                  {/* Truncate a long document name to one line with an ellipsis;
                      the full name is available on hover (QA #91). */}
                  <td>
                    <Tooltip label={r.name} disabled={(r.name || '').length <= 40}>
                      <strong style={{ display: 'block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</strong>
                    </Tooltip>
                  </td>
                  <td><AuthorityBadges value={r.authority_list && r.authority_list.length ? r.authority_list : r.authority} /></td>
                  <td><span className={`avm-exp-pill ${isDate ? 'is-date' : 'is-na'} ${expTone}`}>{expiryText}</span></td>
                  <td>
                    <div className="avm-req-pair">
                      {r.requirement === 'M'
                        ? <span className="avm-req-pill on-m">✓ Mandatory</span>
                        : <span className="avm-req-pill on-o">Optional</span>}
                    </div>
                  </td>
                  <td>
                    <div className="avm-kyc-actions">
                      {uploaded ? (
                        <>
                          <Tooltip label={`View ${uploaded.name}`}>
                            <a href={uploaded.url} target="_blank" rel="noreferrer" className="avm-kyc-act view" aria-label="View"><i className="ri-eye-line" /></a>
                          </Tooltip>
                          <Tooltip label={downloadingKey === refKey ? 'Downloading…' : `Download ${uploaded.name}`}>
                            <button
                              type="button"
                              className="avm-kyc-act down"
                              aria-label="Download"
                              disabled={downloadingKey === refKey}
                              onClick={() => doDownload(refKey, uploaded.url, uploaded.name)}
                            >
                              <i className={downloadingKey === refKey ? 'ri-loader-4-line avm-spin' : 'ri-download-2-line'} />
                            </button>
                          </Tooltip>
                          <Tooltip label="Re-upload">
                            <button type="button" className="avm-kyc-act reup" aria-label="Re-upload" onClick={() => setPopupRow(r)}>
                              <i className="ri-refresh-line" />
                            </button>
                          </Tooltip>
                        </>
                      ) : (
                        <Tooltip label="Upload">
                          <button type="button" className="avm-kyc-act up" aria-label="Upload" onClick={() => setPopupRow(r)}>
                            <i className="ri-upload-2-line" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '18px', color: '#94a3b8' }}>No documents match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {popupRow && (
        <SegmentRefUploadPopup
          title={title}
          row={popupRow}
          existing={uploads[`${tabKey}::${popupRow.code}`]}
          onClose={() => setPopupRow(null)}
          onSubmit={async (f, expiryDate) => { const ok = await onSubmit(popupRow, f, expiryDate); if (ok) setPopupRow(null); }}
        />
      )}
    </>
  );
}

export function SegmentRefUploadPopup(props: {
  title: string;
  row: SegRefRow;
  existing?: { file: File | null; url: string; name: string; expiry?: string };
  onClose: () => void;
  onSubmit: (file: File, expiryDate?: string) => void | Promise<void>;
}) {
  const { title, row, existing, onClose, onSubmit } = props;
  const toast = useToast();
  const [file, setFile] = useState<File | null>(existing?.file ?? null);
  const [hasExpiry, setHasExpiry] = useState<boolean>(!!existing?.expiry);
  const [expiryDate, setExpiryDate] = useState<string>(existing?.expiry ?? '');
  const catLabel = title.replace(/ (DOCUMENT )?NAME$/i, '').replace(/\bDD\b/i, 'Due Diligence');
  const save = async () => {
    if (hasExpiry && !expiryDate) { toast.error('Expiry date required', 'Pick the expiry date, or switch Expiry to No.'); return; }
    let toSubmit = file;
    if (!toSubmit) {
      if (!existing?.url) { toast.error('File required', 'Choose a document to upload.'); return; }
      try {
        const res = await fetch(existing.url);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        toSubmit = new File([blob], existing.name || 'document', { type: blob.type || 'application/octet-stream' });
      } catch {
        toast.error('Could not keep the current file', 'Please pick the document again to re-upload.');
        return;
      }
    }
    await onSubmit(toSubmit, hasExpiry ? expiryDate : undefined);
  };
  return (
    <PopupShell title={`Upload ${catLabel} Document`} icon="ri-upload-cloud-2-line" subtitle={row.name} onClose={onClose} onSave={save}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={row.code} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="Document Name">
          <input className="avm-input" value={row.name} readOnly />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority">
          <input className="avm-input" value={row.authority || '—'} readOnly />
        </Field>
        <Field label="Expiry" hint={!hasExpiry ? <span className="avm-field-hint">Has an expiry date?</span> : undefined}>
          <div className="avm-expiry-row">
            <div className="avm-yesno" role="radiogroup" aria-label="Does this document have an expiry date?">
              <button type="button" role="radio" aria-checked={hasExpiry} className={`avm-yesno-btn${hasExpiry ? ' on' : ''}`} onClick={() => setHasExpiry(true)}>Yes</button>
              <button type="button" role="radio" aria-checked={!hasExpiry} className={`avm-yesno-btn${!hasExpiry ? ' on' : ''}`} onClick={() => { setHasExpiry(false); setExpiryDate(''); }}>No</button>
            </div>
            {hasExpiry && (
              <div className="avm-expiry-date">
                <MasterDatePicker value={expiryDate} onChange={setExpiryDate} placeholder="Select expiry date" minDate={todayIso()} />
              </div>
            )}
          </div>
        </Field>
      </div>
      <div className="avm-grid-1">
        <Field label="Upload Document" required>
          <FileChooser
            file={file}
            existingUrl={existing && !existing.file ? existing.url : undefined}
            existingName={existing && !existing.file ? existing.name : undefined}
            onPick={f => setFile(f)}
            placeholder="Upload document (JPG / PNG / PDF, max 2 MB)"
            imagesPdfOnly
            noDelete
          />
        </Field>
      </div>
    </PopupShell>
  );
}

function AttachmentCell(props: {
  fileName?: string;
  file?: File | null;
  existingPath?: string;
  existingUrl?: string;
  onClear?: () => void;
}) {
  const { fileName, file, existingPath, existingUrl } = props;
  const hasContent = !!(fileName || file || existingPath);
  if (!hasContent) return <span className="text-muted fs-13">—</span>;
  const href = file
    ? URL.createObjectURL(file)
    : (existingUrl || (existingPath ? resolveFileUrl(existingPath) : ''));
  return href ? (
    <Tooltip label={`Open ${fileName || 'Attachment'}`}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="fs-13 text-truncate d-inline-flex align-items-center"
        style={{ maxWidth: 260, color: '#6d28d9', textDecoration: 'underline', textUnderlineOffset: 2 }}
      >
        {fileName || 'Attachment'}
      </a>
    </Tooltip>
  ) : (
    <Tooltip label={fileName || 'Attachment'}>
      <span className="fs-13 text-truncate d-inline-flex align-items-center" style={{ maxWidth: 260 }}>
        {fileName || 'Attachment'}
      </span>
    </Tooltip>
  );
}

function DdTable(props: {
  rows: DueDiligenceRow[];
  onRemove?: (id: string) => void;
  onAttach?: (id: string, file: File) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty="No due-diligence documents added yet. Use “+ Add More Due Diligence” to begin."
      headers={[
        'SR NO', 'AUTO CODE', 'DD DOCUMENT NAME', 'ISSUING AUTHORITY', 'EXPIRY', 'STATUS', 'FILE',
        ...(props.readOnly ? [] : ['ACTIONS']),
      ]}
    >
      {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="avm-auto-code">{r.code}</span></td>
              <td><strong>{r.documentName}</strong></td>
              <td className="avm-cell-authority">{r.issuingAuthority}</td>
              <td>{r.expiry || 'N/A'}</td>
              <td>
                <span className={`avm-pill ${r.mandatory ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                  {r.mandatory ? '✓ Mandatory' : 'Optional'}
                </span>
              </td>
              <td>
                <AttachmentCell
                  fileName={r.fileName}
                  file={r.file}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              {!props.readOnly && (
                <td>
                  <div className="hstack gap-1">
                    {/* Mandatory seed rows let the user attach a file inline
                        instead of going through the Add modal, since their
                        row metadata is already populated. */}
                    {props.onAttach && (
                      <Tooltip label="Upload">
                        <label className="btn btn-sm btn-soft-primary mb-0" aria-label="Upload">
                          <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                          <input type="file" hidden accept={IMG_PDF_ACCEPT} onChange={e => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (!f) return;
                            if (!IMG_PDF_EXT_RE.test(f.name) && !IMG_PDF_MIME_RE.test(f.type || '')) {
                              toast.error('Unsupported file type', 'Only JPG, JPEG, PNG or PDF files are allowed.');
                              return;
                            }
                            if (props.onAttach) props.onAttach(r.id, f);
                          }} />
                        </label>
                      </Tooltip>
                    )}
                    {props.onRemove && !r.mandatory && (
                      <Tooltip label="Remove">
                        <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} aria-label="Remove">
                          <i className="ri-delete-bin-line" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
    </KycTable>
  );
}

function OwnerKycTable(props: {
  rows: OwnerKycRow[];
  onRemove?: (id: string) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty="No owner-KYC documents added yet. Use “+ Add Owner KYC” to begin."
      headers={[
        'SR NO', 'AUTO CODE', 'KYC DOCUMENT NAME', 'ISSUING AUTHORITY', 'DOCUMENT NO',
        'ISSUE DATE', 'EXPIRY', 'STATUS', 'FILE',
        ...(props.readOnly ? [] : ['ACTIONS']),
      ]}
    >
      {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="avm-auto-code">{r.code}</span></td>
              <td><strong>{r.documentName}</strong></td>
              <td className="avm-cell-authority">{r.issuingAuthority}</td>
              <td><span className="font-monospace fs-13">{r.documentNumber || '—'}</span></td>
              <td>{fmtDMY(r.issueDate)}</td>
              <td>{r.expiry || 'N/A'}</td>
              <td>
                <span className={`avm-pill ${r.status === 'Active' ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                  {r.status}
                </span>
              </td>
              <td>
                <AttachmentCell
                  fileName={r.fileName}
                  file={r.file}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              {!props.readOnly && (
                <td>
                  <Tooltip label="Remove">
                    <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} aria-label="Remove">
                      <i className="ri-delete-bin-line" />
                    </button>
                  </Tooltip>
                </td>
              )}
            </tr>
          ))}
    </KycTable>
  );
}

function TradeLicenseTable(props: {
  rows: TradeLicenseRow[];
  onRemove?: (id: string) => void;
  onAttach?: (id: string, file: File) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  const toast = useToast();
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty="No trade licenses added yet. Use “+ Add Trade License” to begin."
      headers={[
        'SR NO', 'AUTO CODE', 'LICENSE TYPE', 'LICENSE NO', 'ISSUING AUTHORITY',
        'ISSUE', 'EXPIRY', 'FILE',
        ...(props.readOnly ? [] : ['ACTIONS']),
      ]}
    >
          {props.rows.map((r, i) => {
            const isSeed = r.id.startsWith('seed-');
            return (
              <tr key={r.id}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><span className="avm-auto-code">{r.code}</span></td>
                <td><strong>{r.licenseType}</strong></td>
                <td><span className="font-monospace fs-13">{r.licenseNumber || '—'}</span></td>
                <td className="avm-cell-authority">{r.issuingAuthority}</td>
                <td>{fmtDMY(r.issueDate)}</td>
                <td>{fmtDMY(r.expiryDate)}</td>
                <td>
                  <AttachmentCell
                    fileName={r.fileName}
                    file={r.file}
                    existingPath={r.existingPath}
                    existingUrl={r.existingUrl}
                    onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                  />
                </td>
                {!props.readOnly && (
                  <td>
                    <div className="hstack gap-1">
                      {props.onAttach && (
                        <Tooltip label="Upload">
                          <label className="btn btn-sm btn-soft-primary mb-0" aria-label="Upload">
                            <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                            {/* Same allow-list as DdTable — the backend's tl_files.*
                                rule is mimes:jpg,jpeg,png,webp,pdf, so reject
                                DOC/DOCX inline instead of on Update & Next. */}
                            <input type="file" hidden accept={IMG_PDF_ACCEPT} onChange={e => {
                              const f = e.target.files?.[0];
                              e.currentTarget.value = '';
                              if (!f) return;
                              if (!IMG_PDF_EXT_RE.test(f.name) && !IMG_PDF_MIME_RE.test(f.type || '')) {
                                toast.error('Unsupported file type', 'Only JPG, JPEG, PNG or PDF files are allowed.');
                                return;
                              }
                              if (props.onAttach) props.onAttach(r.id, f);
                            }} />
                          </label>
                        </Tooltip>
                      )}
                      {props.onRemove && !isSeed && (
                        <Tooltip label="Remove">
                          <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} aria-label="Remove">
                            <i className="ri-delete-bin-line" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
    </KycTable>
  );
}

function BankTable(props: { rows: BankRow[];  international?: boolean; onRemove?: (id: string) => void; onEdit?: (row: BankRow) => void; onClearFile?: (id: string) => void;  lockRemove?: boolean }) {
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty="No bank records added yet."
      headers={[
        'SR NO', 'BANK NAME', 'BRANCH', 'ACCOUNT NO',
        props.international ? 'SWIFT CODE' : 'IFSC CODE',
        'BRANCH ADDRESS', 'PROOF ATTACHMENT', 'ACTION',
      ]}
    >
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><strong>{r.bankName}</strong></td>
              <td>{r.branchName}</td>
              <td><span className="font-monospace fs-13">{r.accountNumber}</span></td>
              <td><span className="font-monospace fs-13">{r.ifsc}</span></td>
              <td>{r.branchAddress
                ? (r.branchAddress.length > 30
                    ? <Tooltip label={r.branchAddress}><span>{r.branchAddress.slice(0, 30)}…</span></Tooltip>
                    : r.branchAddress)
                : '—'}</td>
              <td>
                <AttachmentCell
                  fileName={r.chequeFileName}
                  file={r.chequeFile}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              <td>
                <div className="d-inline-flex gap-1">
                  {props.onEdit && (
                    <Tooltip label="Edit">
                      <button type="button" className="btn btn-sm btn-soft-primary" onClick={() => props.onEdit?.(r)} aria-label="Edit">
                        <i className="ri-pencil-line" />
                      </button>
                    </Tooltip>
                  )}
                  {/* No Remove while EDITING an existing supplier (QA #99).
                      Bank details are mandatory to create a supplier, so letting
                      them be deleted on edit left saved suppliers in a state the
                      create form would have refused — payout details missing on a
                      record an invoice can already be raised against. Editing a
                      wrong account is still possible via the pencil; removing the
                      last means of paying the supplier is not. Add mode keeps the
                      button so a row typed by mistake can be dropped before the
                      supplier exists. */}
                  {!props.lockRemove && (
                    <Tooltip label="Remove">
                      <button type="button" className="avm-row-btn avm-row-btn-del" onClick={() => props.onRemove?.(r.id)} aria-label="Remove">
                        <i className="ri-close-line" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </td>
            </tr>
          ))}
    </KycTable>
  );
}

function GstScrutinyTable(props: { rows: GstScrutinyRow[] }) {
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty="No GST scrutiny entries added yet."
      tableClassName="avm-no-actions avm-gst-table"
      headers={['SR NO', 'SCRUTINY DATE', 'GST NUMBER', 'STATUS', 'LAST FILING', 'PREV 2A INVOICE', 'RED FLAGS']}
    >
      {props.rows.map((r, i) => (
        <tr key={r.id}>
          <td>{String(i + 1).padStart(2, '0')}</td>
          <td>{fmtDMY(r.scrutinyDate)}</td>
          <td><span className="font-monospace fs-13">{r.gstNumber}</span></td>
          <td>
            <span className={`avm-pill ${r.status === 'Active' ? 'avm-pill-success' : 'avm-pill-danger'}`}>
              {r.status}
            </span>
          </td>
          <td>{fmtDMY(r.lastFilingDate)}</td>
          <td>{r.prevNonGst2aInvoice || '—'}</td>
          <td>{r.redFlags || '—'}</td>
        </tr>
      ))}
    </KycTable>
  );
}

function ProductMappingTable(props: { rows: ProductMappingRow[]; onRemove: (id: string) => void; onEdit?: (id: string) => void; busy?: boolean; readOnly?: boolean }) {
  return (
    <KycTable
      isEmpty={props.rows.length === 0}
      empty={props.readOnly
        ? 'No products mapped to this supplier yet.'
        : 'No products mapped yet. Use “+ Add More Products” to link this vendor to one or more products.'}
      wrapClassName="avm-mapped-wrap"
      tableClassName="avm-mapped-table"
      headers={[
        'SR NO', 'PRODUCT', 'CODE', 'HSN/SAC', 'SEGMENT',
        { label: 'PRICE (₹)', className: 'text-end' },
        { label: 'GST %', className: 'text-end' },
        { label: 'GST (₹)', className: 'text-end' },
        { label: 'TOTAL (₹)', className: 'text-end' },
        ...(props.readOnly ? [] : ['ACTIONS']),
      ]}
    >
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td><span className="avm-sr-pill">{String(i + 1).padStart(2, '0')}</span></td>
              <td><strong>{r.productName}</strong></td>
              <td><span className="avm-auto-code">{formatProductCode(r.productCode) || r.productCode}</span></td>
              <td><span className="font-monospace fs-13">{r.hsnSacCode || '—'}</span></td>
              <td>{r.segment ? <SegmentTags segment={r.segment} tagClassName="avm-seg-tag" /> : '—'}</td>
              <td className="text-end avm-num fs-13">₹{r.purchasePrice.toFixed(2)}</td>
              <td className="text-end avm-num fs-13">{r.gstPercentage ? `${r.gstPercentage.toFixed(2)}%` : '—'}</td>
              <td className="text-end avm-num fs-13">₹{r.gstAmount.toFixed(2)}</td>
              <td className="text-end avm-num fs-13"><strong>₹{r.totalAmount.toFixed(2)}</strong></td>
              {!props.readOnly && (
              <td>
                <div className="avm-row-actions">
                  {props.onEdit && (
                    <Tooltip label="Edit product">
                      <button type="button" className="avm-row-btn" onClick={() => props.onEdit?.(r.id)} aria-label="Edit product" disabled={props.busy}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="Remove product">
                    <button type="button" className="avm-row-btn avm-row-btn-del" onClick={() => props.onRemove(r.id)} aria-label="Remove product" disabled={props.busy}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                    </button>
                  </Tooltip>
                </div>
              </td>
              )}
            </tr>
          ))}
    </KycTable>
  );
}

type Setter<T> = (v: T) => void;

function MappedProductsPopup(props: {
  rows: ProductMappingRow[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const n = props.rows.length;
  const busy = !!props.busy;
  return (
    <PopupChrome
      title="Mapped Products"
      subtitle="Products linked to this supplier with price & GST"
      icon="ri-box-3-line"
      panelClassName="avm-cp-popup-wide"
      onClose={props.onClose}
      busy={busy}
      footer={<button className="avm-btn-ghost" onClick={props.onClose} disabled={busy}>Close</button>}
    >
      <div className="avm-mapped-toolbar">
        <span className="avm-mapped-count">{n} product{n === 1 ? '' : 's'} mapped</span>
        <button className="avm-section-add-btn" onClick={props.onAdd} disabled={busy}>
          <i className="ri-add-line" /> Map Product
        </button>
      </div>
      {n === 0 ? (
        <div className="avm-empty avm-empty-accent">No products mapped yet. Click "Map Product" to begin.</div>
      ) : (
        <ProductMappingTable rows={props.rows} onRemove={props.onRemove} onEdit={props.onEdit} busy={busy} />
      )}
    </PopupChrome>
  );
}

export function MappedProductsViewPopup(props: {
  vendorId: number;
  code: string;
  name: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<ProductMappingRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
let alive = true;    
    type ApiRow = {
      id: number; product_id?: number | null;
      product_code?: string | null; product_name?: string | null;
      hsn_sac_code?: string | null; segment?: string | null; batch_serial_lot?: string | null;
      purchase_price?: number | string | null; gst_percentage?: number | string | null;
      gst_amount?: number | string | null; total_amount?: number | string | null;
    };
    (async () => {
      try {
        const res = await api.get<{ data?: ApiRow[] }>(`/vendors/${props.vendorId}/product-mappings`);
        if (!alive) return;
        const list = Array.isArray(res.data) ? res.data as ApiRow[] : (res.data?.data ?? []);
        setRows(list.map(m => ({
          id: String(m.id),
          productId: m.product_id ?? null,
          productCode: m.product_code ?? '',
          productName: m.product_name ?? '—',
          hsnSacCode: m.hsn_sac_code ?? '',
          segment: m.segment ?? '',
          batchSerialLot: m.batch_serial_lot ?? '',
          purchasePrice: Number(m.purchase_price ?? 0),
          gstPercentage: Number(m.gst_percentage ?? 0),
          gstAmount: Number(m.gst_amount ?? 0),
          totalAmount: Number(m.total_amount ?? 0),
        })));
      } catch {
        if (!alive) return;
        setFailed(true);
        setRows([]);
        toast.error('Load failed', 'Could not load the mapped products for this supplier.');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vendorId]);

  return (
    <PopupChrome
      title={`Mapped Products — ${props.code}`}
      subtitle={`${props.name} · Products linked to this supplier with price & GST`}
      icon="ri-box-3-line"
      panelClassName="avm-cp-popup-wide"
      onClose={props.onClose}
      /* Backdrop dismisses — unlike the wizard popups, nothing here is unsaved
         input that a stray click could destroy. */
      dismissOnBackdrop
      footer={<button className="avm-btn-ghost" onClick={props.onClose}>Close</button>}
    >
      {rows === null ? (
        <ShimmerTable rows={5} cols={9} />
      ) : failed ? (
        <div className="avm-empty avm-empty-accent">Could not load the mapped products. Close and try again.</div>
      ) : (
        /* No count pill here, unlike the wizard's popup above. There it shares a
           toolbar row with "+ Map Product" and balances it; opened from the LIST
           there is no button, so the pill would sit alone restating a number the
           badge that was just clicked already showed. */
        <ProductMappingTable rows={rows} onRemove={() => {}} readOnly />
      )}
    </PopupChrome>
  );
}

/* Popup chrome — backdrop, panel, header and body, portalled to <body>.
 *
 * The layer under PopupShell. Seven popups here are save-forms and use
 * PopupShell; the two Mapped Products popups are read-only and end in a single
 * Close, so they could not use it and each carried its own copy of this markup
 * instead. Three copies of the same head/title/close block is three places for
 * the chrome to drift.
 *
 * Everything except the FOOTER is shared, so the footer is the slot. */
function PopupChrome(props: {
  title: string;
  icon: string;
  subtitle?: string;
  tone?: 'purple' | 'amber';
  /** Extra class on the panel — e.g. avm-cp-popup-wide for the wide tables. */
  panelClassName?: string;
  onClose: () => void;
  /** Freezes the close button and veils the body while a write is in flight. */
  busy?: boolean;
  /** Backdrop click dismisses. Off by default: a form popup holds unsaved
   *  input that a stray click must not discard. */
  dismissOnBackdrop?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const amber = props.tone === 'amber';
  const busy = !!props.busy;
  return createPortal((
    <div
      className="avm-cp-backdrop"
      onClick={props.dismissOnBackdrop ? (e) => { if (e.target === e.currentTarget) props.onClose(); } : undefined}
    >
      <div className={`avm-cp-popup${amber ? ' avm-cp-amber' : ''}${props.panelClassName ? ` ${props.panelClassName}` : ''}`}>
        <div className="avm-cp-head">
          <div className="avm-cp-title">
            <i className={props.icon} />
            <div className="avm-cp-htext">
              <div className="avm-cp-htitle">{props.title}</div>
              {props.subtitle && <div className="avm-cp-subtitle">{props.subtitle}</div>}
            </div>
          </div>
          <button className="avm-close avm-cp-close" onClick={props.onClose} aria-label="Close" disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        {/* While busy, a veil over the body blocks ALL interaction (editing a
            field, opening an attached image, etc.) until the write resolves. */}
        <div className="avm-cp-body" style={{ position: 'relative' }}>
          {props.children}
          {busy && <div className="avm-cp-saving-veil" aria-hidden />}
        </div>
        <div className="avm-cp-foot">{props.footer}</div>
      </div>
    </div>
  ), document.body);
}

/* Save-form popup: PopupChrome plus a Cancel / Save footer that owns its own
 * in-flight state, so the popup's OWN button spins rather than the wizard's. */
function PopupShell(props: {
  title: string;
  icon: string;
  subtitle?: string;
  tone?: 'purple' | 'amber';
  onClose: () => void;
  onSave: () => void | Promise<void>;
  children: ReactNode;
}) {
  const amber = props.tone === 'amber';
  const [saving, setSaving] = useState(false);
  return (
    <PopupChrome
      title={props.title}
      icon={props.icon}
      subtitle={props.subtitle}
      tone={props.tone}
      onClose={props.onClose}
      busy={saving}
      footer={<>
        <button className="avm-btn-ghost" onClick={props.onClose} disabled={saving}>Cancel</button>
        <button
          className={`avm-btn-primary${amber ? ' avm-btn-amber' : ''}`}
          disabled={saving}
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            try { await props.onSave(); } finally { setSaving(false); }
          }}
        >
          {saving
            ? <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
            : 'Save'}
        </button>
      </>}
    >
      {props.children}
    </PopupChrome>
  );
}

type DdAddPopupDraft = { documentName: string; issuingAuthority: string; expiry: string; mandatory: boolean; file: File | null; fileName: string };

const VENDOR_KYC_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;

type SanitizeResult = { cleaned: string; error?: string };

const stripXssAndSql = (raw: string): { cleaned: string; afterAngles: string; afterSql: string } => {
  const afterAngles = raw.replace(/[<>]/g, '');
  const afterSql = afterAngles.replace(VENDOR_KYC_SQL_RE, '');
  return { cleaned: afterSql, afterAngles, afterSql };
};

const VENDOR_NAME_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%]/g;
const sanitizeKycName = (raw: string, maxLen = 120): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_NAME_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = "Use letters, numbers, spaces, and . , - ( ) & / ' % only";
  return { cleaned, error };
};

const VENDOR_ID_INVALID_RE = /[^A-Za-z0-9\-/]/g;
const sanitizeKycId = (raw: string, maxLen = 40): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_ID_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = 'Only letters, digits, hyphens and slashes are allowed';
  return { cleaned, error };
};

const VENDOR_ALPHA_INVALID_RE = /[^A-Za-z\s.,'-]/g;
const sanitizeKycAlpha = (raw: string, maxLen = 60): SanitizeResult => {
  const cleaned = raw.replace(VENDOR_ALPHA_INVALID_RE, '').slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Only alphabetic characters are allowed' };
};

const VENDOR_ALPHANUM_INVALID_RE = /[^A-Za-z0-9\s.,'-]/g;
const sanitizeKycAlphaNum = (raw: string, maxLen = 60): SanitizeResult => {
  const cleaned = raw.replace(VENDOR_ALPHANUM_INVALID_RE, '').slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Only letters and numbers are allowed' };
};

const VENDOR_DESIGNATION_INVALID_RE = /[^A-Za-z\s.,'/-]/g;
const sanitizeKycDesignation = (raw: string, maxLen = 60): SanitizeResult => {
  const cleaned = raw.replace(VENDOR_DESIGNATION_INVALID_RE, '').slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Only letters, spaces, and . , - / are allowed' };
};

const VENDOR_ADDRESS_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'#%]/g;
const sanitizeKycAddress = (raw: string, maxLen = 200): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_ADDRESS_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = "Use letters, numbers, spaces, and . , - ( ) & / ' # % only";
  return { cleaned, error };
};

const VENDOR_EXPIRY_INVALID_RE = /[^0-9NA/]/gi;
const sanitizeKycExpiry = (raw: string): SanitizeResult => {
  let cleaned = raw.replace(VENDOR_EXPIRY_INVALID_RE, '');
  if (cleaned.length > 7) cleaned = cleaned.slice(0, 7);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Enter MM/YYYY (e.g. 12/2026) or N/A' };
};

const sanitizeDdDocName = (raw: string) => sanitizeKycName(raw, 120);
const DD_DOC_NAME_MAX = 120;

function DdAddPopup(props: {
  nextCodePreview: string;
  draft: DdAddPopupDraft;
  setDraft: Setter<DdAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, nextCodePreview } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ documentName?: string; issuingAuthority?: string; expiry?: string }>({});
  const handleDocNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeDdDocName(raw);
    setDraft({ ...draft, documentName: cleaned });
    setErrors(prev => ({ ...prev, documentName: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  const handleExpiryChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycExpiry(raw);
    setDraft({ ...draft, expiry: cleaned });
    setErrors(prev => ({ ...prev, expiry: error }));
  };
  return (
    <PopupShell title="Add Due Diligence Document" icon="ri-file-text-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="DD Document Name" required error={errors.documentName}>
          <input
            className="avm-input"
            placeholder="e.g. Memorandum of Association"
            value={draft.documentName}
            maxLength={DD_DOC_NAME_MAX}
            onChange={e => handleDocNameChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. Registrar of Companies (ROC)"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
        </Field>
        <Field label="Expiry" error={errors.expiry}>
          <input
            className="avm-input"
            placeholder="MM/YYYY or N/A"
            value={draft.expiry}
            maxLength={7}
            onChange={e => handleExpiryChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Status">
          <SelectInput value={draft.mandatory ? 'Mandatory' : 'Optional'} onChange={v => set('mandatory', v === 'Mandatory')} options={['Mandatory', 'Optional']} />
        </Field>
        <Field label="Upload Document">
          <FileChooser
            file={draft.file}
            existingPath={draft.existingPath}
            onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
            placeholder="Upload DD document (JPG / PNG / PDF, max 2 MB)"
            imagesPdfOnly
          />
        </Field>
      </div>
    </PopupShell>
  );
}

type OwnerKycAddPopupDraft = { documentName: string; issuingAuthority: string; documentNumber: string; issueDate: string; expiry: string; status: 'Active' | 'Inactive'; file: File | null; fileName: string };
function OwnerKycAddPopup(props: {
  nextCodePreview: string;
  draft: OwnerKycAddPopupDraft;
  setDraft: Setter<OwnerKycAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, nextCodePreview } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ documentName?: string; issuingAuthority?: string; documentNumber?: string; expiry?: string }>({});
  const handleDocNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, documentName: cleaned });
    setErrors(prev => ({ ...prev, documentName: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  const handleDocNumberChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 40);
    setDraft({ ...draft, documentNumber: cleaned });
    setErrors(prev => ({ ...prev, documentNumber: error }));
  };
  const handleExpiryChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycExpiry(raw);
    setDraft({ ...draft, expiry: cleaned });
    setErrors(prev => ({ ...prev, expiry: error }));
  };
  return (
    <PopupShell title="Add Owner KYC Document" icon="ri-user-add-line" subtitle="Upload an identity, address, or compliance document for the owner" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="KYC Document Name" required error={errors.documentName}>
          <input
            className="avm-input"
            placeholder="e.g. PAN Card, Aadhaar Card, Passport"
            value={draft.documentName}
            maxLength={120}
            onChange={e => handleDocNameChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. Income Tax Department"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
        </Field>
        <Field label="Document Number" error={errors.documentNumber}>
          <input
            className="avm-input"
            placeholder="e.g. AABCT1234F"
            value={draft.documentNumber}
            maxLength={40}
            onChange={e => handleDocNumberChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Issue Date">
          <MasterDatePicker
            value={draft.issueDate}
            onChange={(v) => set('issueDate', v)}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="Expiry" error={errors.expiry}>
          <input
            className="avm-input"
            placeholder="MM/YYYY or N/A"
            value={draft.expiry}
            maxLength={7}
            onChange={e => handleExpiryChange(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <SelectInput value={draft.status} onChange={v => set('status', v as 'Active' | 'Inactive')} options={['Active', 'Inactive']} />
        </Field>
      </div>
      <Field label="Upload Document" required>
        <FileChooser
          file={draft.file}
          existingPath={draft.existingPath}
          onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
          placeholder="Upload KYC document (JPG / PNG / PDF, max 2 MB)"
          imagesPdfOnly
        />
      </Field>
    </PopupShell>
  );
}

type TradeLicenseAddPopupDraft = { licenseType: string; licenseNumber: string; issuingAuthority: string; issueDate: string; expiryDate: string; file: File | null; fileName: string };
function TradeLicenseAddPopup(props: {
  draft: TradeLicenseAddPopupDraft;
  setDraft: Setter<TradeLicenseAddPopupDraft>;
  typeOpts: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, typeOpts } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ licenseNumber?: string; issuingAuthority?: string }>({});
  const handleLicenseNumberChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 40);
    setDraft({ ...draft, licenseNumber: cleaned });
    setErrors(prev => ({ ...prev, licenseNumber: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  return (
    <PopupShell title="Add Trade License" icon="ri-file-list-3-line" subtitle="Register a regulatory license, certification, or trade authorization" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="License Type" required>
          {typeOpts.length > 0
            ? <SelectInput value={draft.licenseType} onChange={v => set('licenseType', v)} placeholder="Select License Type" options={typeOpts} />
            : <input className="avm-input" placeholder="e.g. FSSAI License" value={draft.licenseType} onChange={e => set('licenseType', e.target.value)} />}
        </Field>
        <Field label="License Number" required error={errors.licenseNumber}>
          <input
            className="avm-input"
            placeholder="e.g. 10019011000123"
            value={draft.licenseNumber}
            maxLength={40}
            onChange={e => handleLicenseNumberChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. FSSAI, Govt. of India"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
        </Field>
        <Field label="Issue Date" required>
          <MasterDatePicker
            value={draft.issueDate}
            onChange={(v) => set('issueDate', v)}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="Expiry Date" required>
          <MasterDatePicker
            value={draft.expiryDate}
            onChange={(v) => set('expiryDate', v)}
            placeholder="dd/mm/yyyy"
            minDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
      </div>
      <Field label="License Document" required>
        <FileChooser
          file={draft.file}
          existingPath={draft.existingPath}
          onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
          placeholder="Upload License document (JPG / PNG / PDF, max 2 MB)"
          imagesPdfOnly
        />
      </Field>
    </PopupShell>
  );
}

type BankAddPopupDraft = { bankName: string; branchName: string; accountNumber: string; ifsc: string; branchAddress: string; chequeFile: File | null; chequeFileName: string; existingPath?: string; existingUrl?: string };
function BankAddPopup(props: {
  draft: BankAddPopupDraft;
  setDraft: Setter<BankAddPopupDraft>;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  existingAccounts: string[];
  international?: boolean;
  isEdit?: boolean;
}) {
  const { draft, setDraft, onClose, onSave, existingAccounts, isEdit } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ bankName?: string; branchName?: string; branchAddress?: string; accountNumber?: string; ifsc?: string; cheque?: string }>({});
  const handleSave = async () => {
    const e: typeof errors = {};
    if (!draft.bankName.trim())      e.bankName = 'Bank Name is required';
    if (!draft.branchName.trim())    e.branchName = 'Branch is required';
    if (!draft.accountNumber.trim()) e.accountNumber = 'Account Number is required';
    else { const accErr = validateAccountNumber(draft.accountNumber, 'Account Number', !!props.international); if (accErr) e.accountNumber = accErr; }
    const routingLabel = props.international ? 'SWIFT Code' : 'IFSC Code';
    if (!draft.ifsc.trim()) e.ifsc = `${routingLabel} is required`;
    else {
      const err = props.international ? validateSwift(draft.ifsc) : validateIfsc(draft.ifsc);
      if (err) e.ifsc = err;
    }
    if (!draft.chequeFile && !draft.existingPath) e.cheque = 'Cancelled Cheque is required';
    if (!e.accountNumber && existingAccounts.includes(draft.accountNumber.trim())) {
      e.accountNumber = 'This account number is already added for this supplier.';
    }
    if (Object.keys(e).length) { setErrors(prev => ({ ...prev, ...e })); return; }
    await onSave();
  };
  const handleBankNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 80);
    setDraft({ ...draft, bankName: cleaned });
    setErrors(prev => ({ ...prev, bankName: error }));
  };
  const handleBranchChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAlphaNum(raw, 60);
    setDraft({ ...draft, branchName: cleaned });
    setErrors(prev => ({ ...prev, branchName: error }));
  };
  const handleBranchAddressChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAddress(raw, 200);
    setDraft({ ...draft, branchAddress: cleaned });
    setErrors(prev => ({ ...prev, branchAddress: error }));
  };
  return (
    <PopupShell title={isEdit ? 'Edit Bank Details' : 'Add Bank Details'} icon="ri-bank-card-line" onClose={onClose} onSave={handleSave}>
      <div className="avm-grid-4">
        <Field label="Bank Name" required error={errors.bankName}>
          <input
            className="avm-input"
            placeholder="Enter bank name"
            value={draft.bankName}
            maxLength={80}
            onChange={e => handleBankNameChange(e.target.value)}
          />
        </Field>
        <Field label="Branch" required error={errors.branchName}>
          <input
            className="avm-input"
            placeholder="Enter branch"
            value={draft.branchName}
            maxLength={60}
            onChange={e => handleBranchChange(e.target.value)}
          />
        </Field>
        <Field label="Account Number" required error={errors.accountNumber}>
          {/* maxLength caps the field at its own limit, so the 36-digit value in
              QA #98 can no longer even be typed — the validator was the only
              thing stopping it, and only at Save. */}
          <input
            className="avm-input"
            placeholder={props.international ? 'Enter account / IBAN number' : 'Enter account number'}
            maxLength={props.international ? 34 : 18}
            value={draft.accountNumber}
            onChange={e => { set('accountNumber', e.target.value); setErrors(p => ({ ...p, accountNumber: undefined })); }}
          />
        </Field>
        <Field label={props.international ? 'SWIFT Code' : 'IFSC Code'} required error={errors.ifsc}>
          <input
            className="avm-input"
            placeholder={props.international ? 'e.g. HDFCINBBXXX' : 'Enter IFSC code'}
            maxLength={11}
            value={draft.ifsc}
            onChange={e => { set('ifsc', e.target.value.toUpperCase()); setErrors(p => ({ ...p, ifsc: undefined })); }}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Branch Address" error={errors.branchAddress}>
          <input
            className="avm-input"
            placeholder="Enter branch address"
            value={draft.branchAddress}
            maxLength={200}
            onChange={e => handleBranchAddressChange(e.target.value)}
          />
        </Field>
        <Field label="Cancelled Cheque" required error={errors.cheque}>
          <FileChooser
            file={draft.chequeFile}
            existingPath={draft.existingPath}
            existingUrl={draft.existingUrl}
            imagesPdfOnly
            onPick={f => { setDraft({ ...draft, chequeFile: f, chequeFileName: f?.name ?? '', existingPath: undefined, existingUrl: undefined }); setErrors(p => ({ ...p, cheque: undefined })); }}
            placeholder="Upload Cancelled Cheque"
          />
        </Field>
      </div>
    </PopupShell>
  );
}

type GstScrutinyAddPopupDraft = { gstNumber: string; status: 'Active' | 'Inactive'; lastFilingDate: string; prevNonGst2aInvoice: string; redFlags: string };
function GstScrutinyAddPopup(props: {
  draft: GstScrutinyAddPopupDraft;
  setDraft: Setter<GstScrutinyAddPopupDraft>;
  onClose: () => void;
  onSave: () => void | Promise<void>;
}) {
  const { draft, setDraft, onClose, onSave } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ gstNumber?: string; prevNonGst2aInvoice?: string; redFlags?: string; lastFilingDate?: string }>({});
  const handlePrevInvoiceChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 50);
    set('prevNonGst2aInvoice', cleaned);
    setErrors(prev => ({ ...prev, prevNonGst2aInvoice: error }));
  };
  const handleRedFlagsChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAddress(raw, 300);
    set('redFlags', cleaned);
    setErrors(prev => ({ ...prev, redFlags: error }));
  };
  const handleSave = async () => {
    const e: typeof errors = {};
    if (!draft.gstNumber.trim()) {
      e.gstNumber = 'GST Number is required';
    } else {
      const gstErr = validateGstin(draft.gstNumber);
      if (gstErr) e.gstNumber = gstErr;
    }
    if (!draft.lastFilingDate)    e.lastFilingDate = 'GST Last Filing Date is required';
    if (Object.keys(e).length) { setErrors(prev => ({ ...prev, ...e })); return; }
    await onSave();
  };
  return (
    <PopupShell title="Add GST Scrutiny" icon="ri-file-text-line" onClose={onClose} onSave={handleSave}>
      <div className="avm-grid-3">
        <Field label="GST Number" required error={errors.gstNumber}>
          {/* Read-only — the supplier's GST number is captured once on Stage 1
              (Supplier Identification) and flows in here. Every scrutiny entry
              reports on that same GSTIN, so it is never retyped per row; change
              it on Stage 1 instead. openGstPopup() seeds it and blocks opening
              when Stage 1 has none, so this can't be an empty dead end. */}
          <Tooltip label="Comes from the supplier's GST Number on Stage 1 — change it there">
            <input
              className="avm-input avm-input-ro"
              placeholder="—"
              value={draft.gstNumber}
              readOnly
              tabIndex={-1}
            />
          </Tooltip>
        </Field>
        <Field label="GST Status" required>
          <SelectInput value={draft.status} onChange={v => set('status', v as 'Active' | 'Inactive')} placeholder="Select GST status" options={['Active', 'Inactive']} />
        </Field>
        <Field label="GST Last Filing Date" required error={errors.lastFilingDate}>
          <MasterDatePicker
            value={draft.lastFilingDate}
            onChange={(v) => { set('lastFilingDate', v); setErrors(p => ({ ...p, lastFilingDate: undefined })); }}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Previous Non-GST 2A Reflected Invoice" error={errors.prevNonGst2aInvoice}>
          <input
            className="avm-input"
            placeholder="Enter invoice reference (optional)"
            value={draft.prevNonGst2aInvoice}
            maxLength={50}
            onChange={e => handlePrevInvoiceChange(e.target.value)}
          />
        </Field>
        <Field label="Red Flags" error={errors.redFlags}>
          <input
            className="avm-input"
            placeholder="Enter red flags (optional)"
            value={draft.redFlags}
            maxLength={300}
            onChange={e => handleRedFlagsChange(e.target.value)}
          />
        </Field>
      </div>
    </PopupShell>
  );
}

type ProductMappingDraft = { productId: string; productCode: string; productName: string; hsnSacCode: string; segment: string; batchSerialLot: string; purchasePrice: string; gstPercentage: string; gstAmount: string; totalAmount: string };
function AddProductMappingPopup(props: {
  draft: ProductMappingDraft;
  setDraft: Setter<ProductMappingDraft>;
  productOpts: Array<{ value: string; label: string }>;
  onProductChange: (productIdStr: string) => void;
  recompute: (d: ProductMappingDraft) => ProductMappingDraft;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, productOpts, onProductChange, recompute, onClose, onSave } = props;
  const set = <K extends keyof ProductMappingDraft>(k: K, v: ProductMappingDraft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Map Product" icon="ri-box-3-line" subtitle="Link a product with purchase price & GST for this supplier" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Product Name" required>
          {productOpts.length > 0
            ? <SelectInput value={draft.productId} onChange={onProductChange} placeholder="Select Product Name" options={productOpts} />
            : <input className="avm-input" placeholder="Loading products…" value={draft.productName} onChange={e => set('productName', e.target.value)} />}
        </Field>
        <Field label="Product Code">
          <input className="avm-input" value={formatProductCode(draft.productCode) || draft.productCode} readOnly placeholder="Auto-fills from product" />
        </Field>
      </div>
      {/* HSN/SAC + Segment only (2-col) — matches the Figma's Map Product
          modal, which has no Batch/Serial/Lot field. */}
      <div className="avm-grid-2">
        <Field label="HSN / SAC Code">
          <input className="avm-input" value={draft.hsnSacCode} readOnly placeholder="—" />
        </Field>
        <Field label="Segment">
          <input className="avm-input" value={draft.segment} readOnly placeholder="—" />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Purchase Price (₹)" required>
          <input className="avm-input" type="number" min="0" step="0.01" placeholder="Enter purchase price" value={draft.purchasePrice} onChange={e => setDraft(recompute({ ...draft, purchasePrice: e.target.value }))} />
        </Field>
        {/* GST % is inherited from the selected product (set in the
            Product wizard's Sales Config step) and locked here so a
            vendor mapping can never carry a different tax rate than
            the product itself. Same behavior as the product form's
            Map Vendor popup — the two flows are now symmetric. */}
        <Field label="GST %">
          <input
            className="avm-input"
            value={draft.gstPercentage ? `${draft.gstPercentage}%` : ''}
            readOnly
            placeholder="Auto-fills from product"
            title="GST % comes from the product's Sales Config — not editable here"
          />
        </Field>
        <Field label="GST Amount (₹)">
          <input className="avm-input" value={draft.gstAmount} readOnly placeholder="Auto-computed" />
        </Field>
      </div>
      <Field label="Total Amount (₹)">
        <input className="avm-input" value={draft.totalAmount} readOnly placeholder="Auto-computed" />
      </Field>
    </PopupShell>
  );
}

