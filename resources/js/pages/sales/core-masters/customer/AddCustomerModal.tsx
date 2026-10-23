import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SegmentBadge, { SEG_TAG_DARK, SegmentNameList } from '../../../../components/ui/SegmentBadge';
import { createPortal } from 'react-dom';
import AuthorityBadges from '../../../clm/compliance/AuthorityBadges';
import { CLM_CSS } from '../../../clm/shared/clmShared';
import api from '../../../../api';
import { MasterSelect, MasterDatePicker, MasterMultiSelect } from '../../../master/masterFormKit';
import Tooltip from '../../../../components/ui/Tooltip';
import '../../../../components/ui/DataTable.css';
import WorklistPager from '../../../../components/ui/WorklistPager';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { Shimmer, ShimmerTableRows } from '../../../../components/ui/Shimmer';
import { ACM_SHELL_CSS, StepperShimmer, Stage1FormShimmer } from './AddCustomerModalShimmer';
import { downloadFile } from '../../../../utils/downloadFile';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { useToast } from '../../../../contexts/ToastContext';
import { VaultUploadPopup, type VaultStatus } from './CustomerEvidenceVaultModal';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useRuledSegments, type SegDocType } from '../../../../hooks/useRuledSegments';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import SalesCustomerSendForSignatureModal from './SalesCustomerSendForSignatureModal';
import SearchClear from '../../../../components/ui/SearchClear';
import { readCustomerMasterBundle,writeCustomerMasterBundle, bustCustomerMasterBundle,} from './customerBundleCache';

type Stage = 1 | 2;
type StageTab = 'identification' | 'address-contact';
type KycSubTab = 'company-dd' | 'owner-kyc' | 'trade-licence';
type EvTab = 'kyc-documents' | 'trade-documents';
type EvSubTab = 'dd' | 'kyc' | 'tl';

interface LocationRow {
  id: string;
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: 'yes' | 'no' | '';
}
const DEFAULT_ADDRESS_TYPE = 'Registered Office';

interface MasterOpt { id: number; name: string; code?: string; regulatory_status?: string | null; }
interface StateOpt extends MasterOpt { country_id: number; }
interface StateCodeOpt { stateName: string; code: string; }
interface MasterLists {
  customerTypes:     MasterOpt[];
  segments:          MasterOpt[];
  classifications:   MasterOpt[];
  riskLevels:        MasterOpt[];
  addressTypes:      MasterOpt[];
  countries:         MasterOpt[];
  states:            StateOpt[];
  stateCodes:        StateCodeOpt[];
  designations:      MasterOpt[];
  documentTypes:     MasterOpt[];
}
const EMPTY_MASTERS: MasterLists = {
  customerTypes: [], segments: [], classifications: [], riskLevels: [],
  addressTypes: [], countries: [], states: [], stateCodes: [], designations: [], documentTypes: [],
};

const toSelectOpts = (rows: MasterOpt[]) => rows.map(o => ({ value: o.name, label: o.name }));

const optsWith = (rows: MasterOpt[], current?: string | null) => {
  const base = toSelectOpts(rows);
  const v = (current ?? '').trim();
  if (v && !base.some(o => o.value === v)) return [{ value: v, label: v }, ...base];
  return base;
};

const ALLOWED_DOC_EXTS = ['pdf', 'jpg', 'jpeg', 'png'];
const ALLOWED_PHOTO_EXTS = ['jpg', 'jpeg', 'png'];
const MAX_UPLOAD_MB = 2;
type FileKind = 'doc' | 'photo';
function validateUpload(file: File, kind: FileKind = 'doc'): string | null {
  const allowed = kind === 'photo' ? ALLOWED_PHOTO_EXTS : ALLOWED_DOC_EXTS;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!allowed.includes(ext)) {
    return `Only ${allowed.map(e => e.toUpperCase()).join(', ')} files are allowed (got .${ext}).`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `File must not exceed ${MAX_UPLOAD_MB} MB.`;
  }
  return null;
}

const KYC_PER_PAGE = 6;
const KYC_TAB_META: Record<KycSubTab, { title: string; sub: string; nameCol: string; placeholder: string }> = {
  'company-dd':   { title:'COMPANY DUE DILIGENCE', sub:'| Licenses, statutory documents, and compliance proofs', nameCol:'DD Document Name',     placeholder:'Search DD document name...' },
  'owner-kyc':    { title:'OWNER KYC DETAILS',     sub:'| Owner identity proofs, address proofs, and photographs', nameCol:'KYC Document Name', placeholder:'Search KYC document name...' },
  'trade-licence':{ title:'TRADE LICENCE',         sub:'| Trade licence documents and regulatory approvals',     nameCol:'Document Name',         placeholder:'Search trade licence document...' },
};

const newId = (prefix: string) => prefix + '_' + Math.random().toString(36).slice(2, 9);

type StageMemoryEntry = { stage: Stage; maxStage: Stage; tab: StageTab; kycSub: KycSubTab; evTab: EvTab };
const stageMemory = new Map<number, StageMemoryEntry>();

export interface EditCustomer {
  id: string; db_id?: number; company: string; type: string; segment: string; segment_ids?: number[];
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No';
  gstApplicable?: 'Yes' | 'No';
  gstNumber?: string;
}

type GstRow = {
  id: number | string;
  gst_number: string;
  status: string;
  last_filing_date: string | null;
  prev_non_gst_2a_invoice: string | null;
  red_flags: string | null;
  _local?: boolean;
};
type GstDraft = {
  gstNumber: string;
  status: 'Active' | 'Inactive';
  lastFilingDate: string;
  prevNonGst2aInvoice: string;
  redFlags: string;
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const DOMESTIC_COUNTRY = 'India';
function isDomesticCountry(country?: string): boolean {
  return (country ?? '').trim() === DOMESTIC_COUNTRY;
}

const PIN_DOMESTIC_RE = /^[0-9]{6}$/;
const ZIP_INTL_RE = /^[A-Za-z0-9\s\-]+$/;

const pinLabel = (country?: string) => (isDomesticCountry(country) ? 'PIN Code' : 'Zip Code');
const pinMaxLen = (country?: string) => (isDomesticCountry(country) ? 6 : 12);
const pinPlaceholder = (country?: string) =>
  isDomesticCountry(country) ? 'Enter 6-digit PIN code' : 'Enter zip code';

const pinSanitize = (v: string, country?: string) =>
  isDomesticCountry(country)
    ? v.replace(/\D/g, '').slice(0, 6)
    : v.replace(/[^A-Za-z0-9\s\-]/g, '').slice(0, 12);

function pinError(v: string, country?: string): string | undefined {
  const s = (v ?? '').trim();
  const domestic = isDomesticCountry(country);
  if (!s) return domestic ? 'PIN Code is required' : 'Zip Code is required';
  if (domestic) {
    return PIN_DOMESTIC_RE.test(s) ? undefined : 'PIN Code must be exactly 6 digits';
  }
  if (s.length < 3)  return 'Zip Code must be at least 3 characters';
  if (s.length > 12) return 'Zip Code must be 12 characters or fewer';
  return ZIP_INTL_RE.test(s)
    ? undefined
    : 'Zip Code can contain only letters, digits, spaces and hyphens';
}

const cleanPinFor = (v: any, country?: string): string | null => {
  const s = String(v ?? '').trim();
  return s && !pinError(s, country) ? s : null;
};

function countryHasStates(masters: MasterLists, country?: string): boolean {
  const name = (country ?? '').trim();
  if (!name) return false;
  const c = masters.countries.find(x => x.name === name);
  return !!c && masters.states.some(s => s.country_id === c.id);
}

function gstNumberError(v: string, stateCode?: string): string | undefined {
  if (!v.trim()) return 'GST Number is required';
  if (v.length !== 15) return `GST Number must be 15 characters (you've entered ${v.length}). Format: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, Z, 1 digit/letter — e.g. 27AADCI6120M1ZH`;
  if (!/^[0-9]{2}/.test(v)) return 'First 2 characters must be digits (state code) — e.g. 27';
  if (!/^[0-9]{2}[A-Z]{5}/.test(v)) return 'Characters 3–7 must be 5 letters (PAN) — e.g. AADCI';
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}/.test(v)) return 'Characters 8–11 must be 4 digits — e.g. 6120';
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(v)) return 'Character 12 must be a letter — e.g. M';
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]/.test(v)) return 'Character 13 (entity code) must be a digit or letter';
  if (v[13] !== 'Z') return 'Character 14 must be the letter Z';
  if (!GSTIN_RE.test(v)) return 'Character 15 (checksum) must be a digit or letter';
  const sc = (stateCode ?? '').trim();
  if (sc && v.slice(0, 2) !== sc) {
    return `GST state code (${v.slice(0, 2)}) does not match the selected state's code (${sc}). Pick the matching state or correct the GST Number.`;
  }
  return undefined;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customer?: EditCustomer | null;
  onSaved?: (savedId?: number | null) => void;
  leadCurrency?: string | null;
  initialStage?: Stage;
}

export default function AddCustomerModal({ open, onClose, customer, onSaved, initialStage, leadCurrency }: Props) {
  const isEdit = !!customer;
  const toast = useToast();
  const confirm = useConfirm();

  const confirmOrphanDocs = async (err: any): Promise<boolean> => {
    const data = err?.response?.data;
    if (err?.response?.status !== 409 || !data?.requires_doc_confirmation) return false;
    const docs = (data.orphan_documents ?? []) as Array<{ name: string; category?: string }>;
    return confirm({
      title: 'Remove segment & delete its documents?',
      tone: 'danger',
      confirmLabel: 'Delete & Remove',
      cancelLabel: 'Keep Segment',
      message: (
        <div>
          <div>{data.message}</div>
          {docs.length > 0 && (
            <ul style={{ margin: '10px 0 0 18px', padding: 0 }}>
              {docs.map((d, i) => <li key={i}>{d.name}{d.category ? ` (${d.category})` : ''}</li>)}
            </ul>
          )}
        </div>
      ),
    });
  };
  const [stage, setStage] = useState<Stage>(1);
  const [maxStage, setMaxStage] = useState<Stage>(1);
  const [tab, setTab] = useState<StageTab>('identification');
  const [kycSub, setKycSub] = useState<KycSubTab>('company-dd');
  const [kycPage, setKycPage] = useState<Record<KycSubTab, number>>({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 });
  const [kycSearch, setKycSearch] = useState('');
  const [evTab, setEvTab] = useState<EvTab>('kyc-documents');
  const [, setEvSub] = useState<EvSubTab>('dd');
  const [historyOpen, setHistoryOpen] = useState(false);

  const [masters, setMasters] = useState<MasterLists>(EMPTY_MASTERS);
  const [mastersLoading, setMastersLoading] = useState<boolean>(true);
  const { ruledCodes: ruledSegCodes, typesByCode: segTypesByCode, loaded: segRulesLoaded } = useRuledSegments(open);
  const segTypesById = useMemo(() => {
    const m = new Map<string, Set<SegDocType>>();
    for (const s of masters.segments) {
      const t = segTypesByCode.get(String(s.code ?? ''));
      if (t && t.size) m.set(String(s.id), new Set(t));
    }
    return m;
  }, [masters.segments, segTypesByCode]);
  const segNameOf = (v: string) => masters.segments.find(s => String(s.id) === String(v))?.name ?? String(v);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    type IdNamed = { id: number | string; name?: string | null };
    type Bundle = {
      customer_types: IdNamed[];
      segments: Array<{ id: number | string; name?: string | null; title?: string | null; code?: string | null; regulatory_status?: string | null }>;
      customer_classifications: IdNamed[];
      risk_levels: IdNamed[];
      address_types: IdNamed[];
      countries: IdNamed[];
      states: Array<{ id: number | string; name?: string | null; country_id?: number | string | null }>;
      state_codes?: Array<{ id: number | string; state_id?: number | string | null; state_code?: string | null; state?: { id: number | string; name?: string | null; country_id?: number | string | null } | null }>;
      designations: IdNamed[];
      document_type: Array<{ id: number | string; title?: string | null }>;
    };

    const pickName = (rows: IdNamed[]): MasterOpt[] => (rows || [])
      .map(r => ({ id: Number(r.id), name: String(r.name ?? '') }))
      .filter(r => r.name);
    const pickStates = (rows: Bundle['states']): StateOpt[] => (rows || [])
      .map(r => ({ id: Number(r.id), name: String(r.name ?? ''), country_id: Number(r.country_id) }))
      .filter(r => r.name);

    const hydrate = (b: Bundle) => {
      const segments: MasterOpt[] = (b.segments || [])
        .map(r => ({ id: Number(r.id), name: String(r.title ?? r.name ?? ''), code: String(r.code ?? ''), regulatory_status: r.regulatory_status ?? null }))
        .filter(r => r.name);
      const countries = pickName([...(b.countries ?? [])].sort((a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
      const documentTypes: MasterOpt[] = (b.document_type || [])
        .map(r => ({ id: Number(r.id), name: String(r.title ?? '') }))
        .filter(r => r.name);
      const stateCodes: StateCodeOpt[] = (b.state_codes || [])
        .map(r => ({ stateName: String(r.state?.name ?? ''), code: String(r.state_code ?? '') }))
        .filter(r => r.stateName && r.code);

      setMasters({
        customerTypes:   pickName(b.customer_types),
        segments,
        classifications: pickName(b.customer_classifications),
        riskLevels:      pickName(b.risk_levels),
        addressTypes:    pickName(b.address_types),
        countries,
        states:          pickStates(b.states),
        stateCodes,
        designations:    pickName(b.designations),
        documentTypes,
      });
    };

    const cached = readCustomerMasterBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setMastersLoading(false);
    }

    (async () => {
      try {
        const res = await api.get<Bundle>('/customers/master-bundle');
        if (cancelled) return;
        hydrate(res.data);
        writeCustomerMasterBundle(res.data);
      } catch {
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const [form, setForm] = useState({
    coName:'', coLegal:'', coType:'', coWeb:'', coSeg:[] as string[], coClass:'', coRisk:'',
    coGstApplicable:'Yes' as 'Yes'|'No'|'',
    coGstNumber:'',
    addrType: DEFAULT_ADDRESS_TYPE, addr:'', country:'', state:'', stateCode:'', city:'', pin:'',
    cpName:'', cpDesig:'', cpTel:'', cpEmail:'', cpWa:'yes' as 'yes'|'no'|'',
  });
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }));

  const [locations, setLocations] = useState<LocationRow[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const phone = (form.cpTel   || '').trim();
    const email = (form.cpEmail || '').trim().toLowerCase();
    const dupPhoneMsg = 'This phone number is already used by another address on this customer';
    const dupEmailMsg = 'This email is already used by another address on this customer';
    setErrors(prev => {
      const next = { ...prev };
      const phoneDup = phone && locations.some(l => (l.cpContact || '').trim() === phone);
      const emailDup = email && locations.some(l => (l.cpEmail   || '').trim().toLowerCase() === email);
      if (phoneDup) next.cpTel = dupPhoneMsg;
      else if (next.cpTel === dupPhoneMsg) delete next.cpTel;
      if (emailDup) next.cpEmail = dupEmailMsg;
      else if (next.cpEmail === dupEmailMsg) delete next.cpEmail;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cpTel, form.cpEmail, locations]);

  useEffect(() => {
    if (!isDomesticCountry(form.country)) return;
    setForm(prev => (/\D/.test(prev.cpTel) || prev.cpTel.length > 10)
      ? { ...prev, cpTel: prev.cpTel.replace(/\D/g, '').slice(0, 10) } : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.country]);

  const [savedDbId, setSavedDbId] = useState<number | null>(customer?.db_id ?? null);

  const [gstRows, setGstRows] = useState<GstRow[]>([]);
  const [gstPopupOpen, setGstPopupOpen] = useState(false);
  const [mapLeadLocked, setMapLeadLocked] = useState(false);
  const [lockedSegments, setLockedSegments] = useState<string[]>([]);
  const [lockedSegmentReasons, setLockedSegmentReasons] = useState<Record<string, string>>({});
  const [segReqKeys, setSegReqKeys] = useState<Record<string, string[]>>({});
  const [uploadedKeys, setUploadedKeys] = useState<string[]>([]);
  const gstRowsRef = useRef<GstRow[]>([]);
  useEffect(() => { gstRowsRef.current = gstRows; }, [gstRows]);

  useEffect(() => {
    const gst = (form.coGstNumber ?? '').trim().toUpperCase();
    if (gst.length !== 15) return;
    setGstRows(prev => prev.some(r => r.gst_number !== gst)
      ? prev.map(r => ({ ...r, gst_number: gst }))
      : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.coGstNumber]);

  const gstBody = (r: { gst_number: string; status: string; last_filing_date: string | null; prev_non_gst_2a_invoice: string | null; red_flags: string | null }) => ({
    gst_number:              r.gst_number,
    status:                  r.status,
    last_filing_date:        r.last_filing_date || null,
    prev_non_gst_2a_invoice: r.prev_non_gst_2a_invoice || null,
    red_flags:               r.red_flags || null,
  });

  const addGstRow = async (draft: GstDraft): Promise<boolean> => {
    const id = customer?.db_id ?? savedDbId;
    const row = {
      gst_number: draft.gstNumber,
      status: draft.status,
      last_filing_date: draft.lastFilingDate || null,
      prev_non_gst_2a_invoice: draft.prevNonGst2aInvoice || null,
      red_flags: draft.redFlags || null,
    };
    if (id) {
      try {
        const { data } = await api.post(`/customers/${id}/gst-scrutiny`, gstBody(row));
        setGstRows(prev => [data.data, ...prev]);
        toast.success('GST scrutiny saved', row.gst_number);
      } catch (err: any) {
        toast.error('Could not save GST scrutiny', err?.response?.data?.message ?? 'Please try again.');
        return false;
      }
    } else {
      setGstRows(prev => [{ id: `local-${prev.length}-${draft.gstNumber}`, _local: true, ...row } as GstRow, ...prev]);
    }
    return true;
  };

  const flushLocalGst = async (newId: number) => {
    const locals = gstRowsRef.current.filter(r => r._local);
    if (!locals.length) return;
    for (const r of locals) {
      try { await api.post(`/customers/${newId}/gst-scrutiny`, gstBody(r)); } catch {  }
    }
    try {
      const { data } = await api.get(`/customers/${newId}/gst-scrutiny`);
      setGstRows(data.data ?? []);
    } catch {  }
  };

  const inFlightRef = useRef(false);

  const dirtySavedRef = useRef(false);

  const gstGateRef = useRef<{ status: string; takenBy: string | null }>({ status: 'idle', takenBy: null });
  const reportGstGate = useCallback((g: { status: string; takenBy: string | null }) => {
    gstGateRef.current = g;
  }, []);

  const [, setTdDocs] = useState<TdDocRow[]>([]);

  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);

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

  type SigInfo = { status: TdSigStatus; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null };
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, SigInfo>>({});

  useEffect(() => {
    const partyId = customer?.db_id ?? savedDbId;
    if (!open || evTab !== 'trade-documents' || !partyId) return;

    let cancelled = false;

    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: partyId, model_name: 'Customer', sync: withSync ? 1 : 0 },
        });
        if (cancelled) return;
        const rows: Array<{
          id: number;
          status: TdSigStatus;
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

        const map: Record<number, SigInfo> = {};
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
      } catch {
      }
    };

    fetchAndUpdate(false);
    const iv = window.setInterval(() => fetchAndUpdate(true), 15000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [open, stage, evTab, customer?.db_id, savedDbId]);

  useEffect(() => {
    setTdDocs(prev => prev.map(d => {
      if (!d.db_id) return d;
      const info = sigStatusByDoc[d.db_id];
      if (!info) return d;
      return {
        ...d,
        sent: d.sent || info.status !== 'idle',
        status: info.status,
        signature_request_id: info.signatureRequestId,
        signed_url:      info.signedUrl      ?? d.signed_url,
        certificate_url: info.certificateUrl ?? d.certificate_url,
        reminder_count:        info.reminderCount  ?? d.reminder_count        ?? 0,
        last_reminder_sent_at: info.lastReminderAt ?? d.last_reminder_sent_at ?? null,
      };
    }));
  }, [sigStatusByDoc]);

  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' };
  type SegmentDocs = { kyc: SegDocRow[]; dd: SegDocRow[]; tl: SegDocRow[]; td: SegDocRow[]; qc: SegDocRow[] };
  const EMPTY_SEG_DOCS: SegmentDocs = { kyc:[], dd:[], tl:[], td:[], qc:[] };
  const [segmentDocs, setSegmentDocs] = useState<SegmentDocs>(EMPTY_SEG_DOCS);
  const [, setSegCodeMap] = useState<Record<string, string[]>>({});
  const [segmentDocsLoading, setSegmentDocsLoading] = useState(false);


  type SegRefUpload = SegRefUploadEntry;
  const [segmentRefUploads, setSegmentRefUploads] = useState<Record<string, SegRefUpload>>({});

  const SUB_TO_CAT_C: Record<string, 'kyc' | 'dd' | 'tl'> = {
    'company-dd':    'dd',
    'owner-kyc':     'kyc',
    'trade-licence': 'tl',
  };
  const persistSegmentRefUpload = async (refKey: string, file: File, docName: string, opts?: { issueDate?: string; expiryDate?: string }) => {
    const fileErr = validateUpload(file, 'doc');
    if (fileErr) {
      toast.error('Unsupported file', fileErr);
      return;
    }
    const ownerId = savedDbId || customer?.db_id || null;
    if (!ownerId) {
      toast.error('Save first', 'Save the customer before attaching reference documents.');
      return;
    }
    const [sub, doc_code] = refKey.split('::');
    const category = SUB_TO_CAT_C[sub];
    if (!category || !doc_code) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    if (opts?.issueDate)  fd.append('issue_date', opts.issueDate);
    if (opts?.expiryDate) fd.append('expiry_date', opts.expiryDate);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/customer/${ownerId}`, fd, {
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
            [refKey]: {
              file: null, url: row.attachment_url, name: row.attachment_name || file.name,
              issueDate: row.issue_date ?? null, expiryDate: row.expiry_date ?? null,
            },
          };
        });
      }
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message ?? 'Could not save the attachment.');
    }
  };

  const [locModal, setLocModal] = useState<{ open:boolean; editing:string|null }>({ open:false, editing:null });

  const [delModal, setDelModal] = useState<{ open:boolean; id:string|null }>({ open:false, id:null });
  const [delLocBusy, setDelLocBusy] = useState(false);

  const [docModal, setDocModal] = useState<{ open:boolean; sub:KycSubTab }>({ open:false, sub:'company-dd' });

  type KycDocRowApi = {
    id: number; kind: 'dd' | 'tl'; name: string; license_number?: string | null;
    issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null;
    attachment_path?: string | null; attachment_url?: string | null; attachment_name?: string | null;
    description?: string | null; status?: string;
  };
  type KycOwnerRowApi = {
    id: number; owner_name: string; designation?: string | null; official_email?: string | null;
    phone_number?: string | null;
    id_proof_path?: string | null;       id_proof_url?: string | null;
    address_proof_path?: string | null;  address_proof_url?: string | null;
    photograph_path?: string | null;     photograph_url?: string | null;
    status?: string;
  };
  const [kycDocs,   setKycDocs]   = useState<KycDocRowApi[]>([]);
  const [kycOwners, setKycOwners] = useState<KycOwnerRowApi[]>([]);

  const [kycDelModal, setKycDelModal] = useState<{ open: boolean; kind: 'doc' | 'owner'; id: number | null; label?: string }>({ open: false, kind: 'doc', id: null });
  const [kycDeleting, setKycDeleting] = useState(false);

  const [editDocId,   setEditDocId]   = useState<number | null>(null);
  const [editOwnerId, setEditOwnerId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);

  const [hydrating, setHydrating] = useState(false);
  const showShimmer = hydrating || mastersLoading;

  useEffect(() => {
    if (!open) return;
    const memKey = customer?.db_id ?? null;
    const remembered = memKey ? stageMemory.get(memKey) : null;
    const landing = Math.min(2, (isEdit && initialStage) ? initialStage : 1) as Stage;
    setStage   (landing);
    setMaxStage(Math.min(2, Math.max(remembered?.maxStage ?? 1, landing)) as Stage);
    setTab     ('identification');
    setKycSub  (remembered?.kycSub   ?? 'company-dd');
    setEvTab   (remembered?.evTab    ?? 'kyc-documents');
    setKycPage({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 });
    setKycSearch('');
    setEvSub('dd');
    setHistoryOpen(false);
    setForm({
      coName:   customer?.company ?? '',
      coLegal:  customer?.company ?? '',
      coType:   customer?.type ?? '',
      coWeb:    '',
      coSeg:    (customer?.segment_ids ?? []).map(String),
      coClass:  '',
      coRisk:   '',
      coGstApplicable: (customer?.gstApplicable as 'Yes'|'No'|undefined) ?? 'No',
      coGstNumber: (customer?.gstNumber as string|undefined) ?? '',
      addrType: DEFAULT_ADDRESS_TYPE,
      addr:     '',
      country:  customer?.country ?? '',
      state:    '',
      stateCode: '',
      city:     '',
      pin:      '',
      cpName:   customer?.contact ?? '',
      cpDesig:  '',
      cpTel:    customer?.phone ?? '',
      cpEmail:  customer?.email ?? '',
      cpWa:     customer?.whatsapp === 'No' ? 'no' : 'yes',
    });
    setLocations([]);
    setKycDocs([]);
    setKycOwners([]);
    setGstRows([]);
    setGstPopupOpen(false);
    setMapLeadLocked(false);
    setLockedSegments([]);
    setSegReqKeys({});
    setUploadedKeys([]);
    setErrors({});
    setSavedDbId(customer?.db_id ?? null);
    setTdDocs([]);
    setSegmentDocs(EMPTY_SEG_DOCS);
    Object.values(segmentRefUploads).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
    setSegmentRefUploads({});
    setLocModal({ open:false, editing:null });
    setHydrating(!!customer?.db_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id ?? null, customer?.id ?? null]);

  useEffect(() => {
    if (!open) return;
    const memKey = customer?.db_id ?? null;
    if (memKey == null) return;
    stageMemory.set(memKey, { stage, maxStage, tab, kycSub, evTab });
  }, [open, customer?.db_id, stage, maxStage, tab, kycSub, evTab]);

  useEffect(() => {
    if (!open || !customer?.db_id) return;
    let cancelled = false;
    setHydrating(true);

    api.get(`/customers/${customer.db_id}`)
      .then(r => {
        if (cancelled) return;
        const d = r.data?.data ?? r.data ?? {};
        const pa = d.primary_address ?? {};
        setMapLeadLocked(d.isMapLead === 'Yes');
        setLockedSegments(Array.isArray(d.locked_segments) ? d.locked_segments : []);
        setLockedSegmentReasons(d.locked_segment_reasons && typeof d.locked_segment_reasons === 'object' ? d.locked_segment_reasons : {});
        setSegReqKeys(d.segment_required_doc_keys && typeof d.segment_required_doc_keys === 'object' ? d.segment_required_doc_keys : {});
        setUploadedKeys(Array.isArray(d.uploaded_doc_keys) ? d.uploaded_doc_keys : []);
        setForm({
          coName:   d.company       ?? '',
          coLegal:  d.legalName     ?? d.company ?? '',
          coType:   d.type          ?? '',
          coWeb:    d.website       ?? '',
          coSeg:    Array.isArray(d.segment_ids) ? d.segment_ids.map(String) : [],
          coClass:  d.classification ?? '',
          coRisk:   d.riskLevel     ?? '',
          coGstApplicable: (d.gstApplicable as 'Yes'|'No'|undefined) ?? 'No',
          coGstNumber: (d.gstNumber as string|undefined) ?? '',
          addrType: DEFAULT_ADDRESS_TYPE,
          addr:     pa.address_line ?? d.addr    ?? '',
          country:  pa.country      ?? d.country ?? '',
          state:    pa.state        ?? d.state   ?? '',
          stateCode: pa.state_code  ?? d.stateCode ?? '',
          city:     pa.city         ?? d.city    ?? '',
          pin:      pa.pin          ?? d.pin     ?? '',
          cpName:   pa.cp_name        ?? d.contact ?? '',
          cpDesig:  pa.cp_designation ?? d.cpDesig ?? '',
          cpTel:    pa.cp_contact     ?? d.phone   ?? '',
          cpEmail:  pa.cp_email       ?? d.email   ?? '',
          cpWa:     (pa.cp_whatsapp === 'no' || d.whatsapp === 'No') ? 'no' : 'yes',
        });
        const extra = Array.isArray(d.locations) ? d.locations : [];
        setLocations(extra.map((a: any) => ({
          id:             'loc_' + String(a.id),
          type:           a.type           ?? '',
          line:           a.address_line   ?? '',
          country:        a.country        ?? '',
          state:          a.state          ?? '',
          city:           a.city           ?? '',
          pin:            a.pin            ?? '',
          cpName:         a.cp_name        ?? '',
          cpDesignation:  a.cp_designation ?? '',
          cpContact:      a.cp_contact     ?? '',
          cpEmail:        a.cp_email       ?? '',
          cpWhatsapp:     a.cp_whatsapp === 'no' ? 'no' : 'yes',
        })));

        const root = r.data ?? {};
        setKycDocs(Array.isArray(root.documents) ? root.documents : []);
        setKycOwners(Array.isArray(root.owners) ? root.owners : []);
        setGstRows(Array.isArray(root.gst_scrutiny) ? root.gst_scrutiny : []);

        const refs = Array.isArray(root.segment_uploads?.data) ? root.segment_uploads.data : [];
        const CAT_TO_SUB: Record<string, string> = { dd: 'company-dd', kyc: 'owner-kyc', tl: 'trade-licence' };
        const hydrated: Record<string, SegRefUpload> = {};
        for (const ref of refs) {
          const sub = CAT_TO_SUB[ref.category];
          if (!sub || !ref.doc_code) continue;
          hydrated[`${sub}::${ref.doc_code}`] = {
            file: null as unknown as File,
            url:  ref.attachment_url || '',
            name: ref.attachment_name || '',
            issueDate:  ref.issue_date ?? null,
            expiryDate: ref.expiry_date ?? null,
          };
        }
        if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
      })
      .catch(() => {  })
      .finally(() => { if (!cancelled) setHydrating(false); });

    return () => { cancelled = true; };
  }, [open, customer?.db_id]);

  useEffect(() => {
    if (!open) return;
    if (stage < 2 && maxStage < 2 && !isEdit) return;

    const picked = (form.coSeg ?? []).filter(Boolean);
    if (picked.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setTdDocs([]); setSegmentDocsLoading(false); return; }
    const segRows = picked
      .map(v => masters.segments.find(s => String(s.id) === v))
      .filter((r): r is { id:number; name:string } => !!r);
    if (segRows.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setTdDocs([]); setSegmentDocsLoading(false); return; }

    let cancelled = false;
    setSegmentDocsLoading(true);
    const custDocType: SegDocType = isDomesticCountry(form.country) ? 'domestic' : 'international';
    Promise.all([
      Promise.all(
        segRows.map(s =>
          api.get(`/clm/segment-rules/for-segment/${s.id}`, { params: { document_type: custDocType } })
            .then(r => r.data?.data ?? {})
            .catch(() => ({}))
        )
      ),
      // view=list: only `code` is read from these rows, and the full version
      // carries every trade document's drafted body — over a megabyte for this
      // party (113 kB even after gzip).
      api.get('/clm/trade-doc-library/for-party/buyer', { params: { view: 'list' } })
        .then(r => Array.isArray(r.data?.data) ? r.data.data : [])
        .catch(() => [] as Array<{ code: string }>),
    ]).then(([results, partyDocs]) => {
      if (cancelled) return;
      const mergeCat = (cat: 'kyc'|'dd'|'tl'|'td'|'qc') => {
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
      const merged: SegmentDocs = {
        kyc: mergeCat('kyc'),
        dd:  mergeCat('dd'),
        tl:  mergeCat('tl'),
        td:  mergeCat('td'),
        qc:  mergeCat('qc'),
      };
      setSegmentDocs(merged);
      const codeMap: Record<string, string[]> = {};
      results.forEach((r: any, i: number) => {
        const seg = segRows[i];
        if (!seg) return;
        const codes = new Set<string>();
        (['kyc', 'dd', 'tl'] as const).forEach(cat => {
          const rows: SegDocRow[] = Array.isArray(r?.[cat]) ? r[cat] : [];
          rows.forEach(d => { if (d?.code) codes.add(d.code); });
        });
        codeMap[String(seg.id)] = Array.from(codes);
      });
      setSegCodeMap(codeMap);
      const partyById = new Map<string, number>(
        (partyDocs as Array<{ code: string; id: number }>).map(p => [p.code, p.id]),
      );
      const buyerTd = merged.td.filter(d => partyById.has(d.code));
      setTdDocs(buyerTd.map(d => ({
        id: `td_${d.code}`,
        db_id: partyById.get(d.code) ?? null,
        name: d.name,
        selected: d.requirement === 'M',
        sent: false,
        status: 'idle' as TdSigStatus,
      })));
    }).finally(() => { if (!cancelled) setSegmentDocsLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, maxStage, form.coSeg, form.country, masters.segments]);

  useEffect(() => {
    const id = 'acm-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }, []);

  useScrollLock(open, '.acm-root');

  const handleClose = () => {
    if (inFlightRef.current || saving) return;
    if (dirtySavedRef.current) {
      dirtySavedRef.current = false;
      onSaved?.(savedDbId ?? customer?.db_id ?? null);
    }
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (locModal.open) { setLocModal({ open:false, editing:null }); return; }
      handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locModal.open, onClose, onSaved]);

  if (!open) return null;

  const gotoStage = (s: Stage) => {
    if (s > maxStage) return;
    if (s === 2 && !gstScrutinyComplete) { promptForGstScrutiny(); return; }
    setStage(s);
    if (s === 1) setTab('identification');
  };

  const stage1FieldRule = (k: string, f: typeof form): string | null => {
    switch (k) {
      case 'coName':
        if (!f.coName.trim()) return 'Company name is required';
        if (f.coName.trim().length < 2) return 'Company name must be at least 2 characters';
        if (f.coName.trim().length > 30) return 'Company name must be 30 characters or fewer';
        if (!/^[\p{L}\p{N} .,'&()\-\/]+$/u.test(f.coName.trim()))
          return 'Company name has invalid characters — letters, numbers and . , & \' - ( ) / only';
        if (!/\p{L}/u.test(f.coName)) return 'Company name must contain at least one letter';
        return null;
      case 'coLegal':
        if (!f.coLegal.trim()) return 'Legal name is required';
        if (f.coLegal.trim().length < 2) return 'Legal name must be at least 2 characters';
        if (f.coLegal.trim().length > 100) return 'Legal name must be 100 characters or fewer';
        if (!/^[\p{L}\p{N} .,'&()\-\/]+$/u.test(f.coLegal.trim()))
          return 'Legal name has invalid characters — letters, numbers and . , & \' - ( ) / only';
        if (!/\p{L}/u.test(f.coLegal)) return 'Legal name must contain at least one letter';
        return null;
      case 'coType':
        if (!f.coType) return 'Select a customer category';
        return null;
      case 'coSeg': {
        if (!f.coSeg || f.coSeg.length === 0) return 'Select at least one segment';
        if (segRulesLoaded && f.country) {
          const custType: SegDocType = isDomesticCountry(f.country) ? 'domestic' : 'international';
          const custLabel = custType === 'domestic' ? 'Domestic' : 'International';
          const mismatched = (f.coSeg as string[]).filter(id => {
            const types = segTypesById.get(id);
            return types && types.size > 0 && !types.has(custType);
          }).map(segNameOf);
          if (mismatched.length) {
            return `${mismatched.join(', ')} ${mismatched.length > 1 ? 'have' : 'has'} no ${custLabel} rule — this is a ${custLabel} customer, so the segment's document type must match.`;
          }
        }
        return null;
      }
      case 'coClass':
        if (!f.coClass) return 'Select a classification';
        return null;
      case 'coRisk':
        if (!f.coRisk) return 'Select a risk level';
        return null;
      case 'coGstApplicable':
        return null;
      case 'coGstNumber':
        if (!isDomesticCountry(f.country)) return null;
        return gstNumberError((f.coGstNumber ?? '').trim(), f.stateCode) ?? null;
      case 'coWeb':
        if (!f.coWeb || !f.coWeb.trim()) return null;
        if (f.coWeb.trim().length > 200) return 'Website must be 200 characters or fewer';
        if (!/^(https?:\/\/)?([\w-]+\.)+[A-Za-z]{2,}(\/[\w\-./?%&=#]*)?$/.test(f.coWeb.trim()))
          return 'Enter a valid website (e.g. https://example.com)';
        return null;
      case 'addrType':
        if (!f.addrType) return 'Select an address type';
        return null;
      case 'addr':
        if (!f.addr.trim()) return 'Address is required';
        if (f.addr.trim().length < 4) return 'Address must be at least 4 characters';
        if (f.addr.trim().length > 75) return 'Address must be 75 characters or fewer';
        if (!/[A-Za-z]/.test(f.addr)) return 'Address must contain at least one letter';
        return null;
      case 'country':
        if (!f.country) return 'Select a country';
        return null;
      case 'state':
        if (!f.state) {
          return countryHasStates(masters, f.country)
            ? 'Select a state'
            : 'No states exist for this country yet — add them under Master → States first';
        }
        return null;
      case 'city':
        if (!f.city.trim()) return 'City is required';
        if (f.city.trim().length > 30) return 'City must be 30 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(f.city.trim()))
          return 'City can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'pin':
        return pinError(f.pin, f.country) ?? null;
      case 'cpName':
        if (!f.cpName.trim()) return 'Contact person name is required';
        if (f.cpName.trim().length > 60) return 'Name must be 60 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(f.cpName.trim()))
          return 'Name can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'cpDesig':
        if (!f.cpDesig.trim()) return 'Designation is required';
        return null;
      case 'cpTel':
        if (!f.cpTel.trim()) return 'Contact number is required';
        if (isDomesticCountry(f.country)) { if (!/^\d{10}$/.test(f.cpTel)) return 'Enter a valid 10-digit mobile number'; }
        else if (!/^\+?[0-9\s-]{7,15}$/.test(f.cpTel)) return 'Phone must be 7–15 digits';
        if (locations.some(l => (l.cpContact || '').trim() === f.cpTel.trim()))
          return 'This phone number is already used by another address on this customer';
        return null;
      case 'cpEmail':
        if (!f.cpEmail.trim()) return 'Email is required';
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(f.cpEmail)) return 'Enter a valid email address';
        if (locations.some(l => (l.cpEmail || '').trim().toLowerCase() === f.cpEmail.trim().toLowerCase()))
          return 'This email is already used by another address on this customer';
        return null;
      case 'cpWa':
        if (!f.cpWa) return 'Select WhatsApp preference';
        return null;
    }
    return null;
  };

  const STAGE1_FIELD_KEYS = [
    'coName','coLegal','coType','coSeg','coClass','coRisk','coGstNumber','coWeb',
    'addrType','addr','country','state','city','pin',
    'cpName','cpDesig','cpTel','cpEmail','cpWa',
  ];

  const validateStage1 = (): boolean => {
    const next: Record<string, string> = {};
    for (const k of STAGE1_FIELD_KEYS) {
      const msg = stage1FieldRule(k, form);
      if (msg) next[k] = msg;
    }
    if (isDomesticCountry(form.country) && !next.coGstNumber) {
      const gate = gstGateRef.current;
      if (gate.status === 'taken') {
        next.coGstNumber = gate.takenBy
          ? `This GST Number is already registered to ${gate.takenBy}. Enter a different one.`
          : 'This GST Number is already registered to another customer. Enter a different one.';
      } else if (gate.status === 'checking') {
        next.coGstNumber = 'Still checking whether this GST Number is already registered — one moment.';
      }
    }
    setErrors(next);
    if (Object.keys(next).length === 0) return true;
    const firstKey = Object.keys(next)[0];
    const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };

  const stageComplete: [boolean, boolean, boolean] = (() => {
    const s1 = STAGE1_FIELD_KEYS.every(k => !stage1FieldRule(k, form));

    const subFor = (cat: 'dd' | 'kyc' | 'tl') =>
      cat === 'dd' ? 'company-dd' : cat === 'kyc' ? 'owner-kyc' : 'trade-licence';
    let mandTotal = 0, mandDone = 0, anyDoc = false, anyUpload = false;
    (['dd', 'kyc', 'tl'] as const).forEach(cat => {
      ((segmentDocs as any)[cat] || []).forEach((d: any) => {
        anyDoc = true;
        const up = !!segmentRefUploads[`${subFor(cat)}::${d.code}`];
        if (up) anyUpload = true;
        if (d.requirement === 'M') { mandTotal++; if (up) mandDone++; }
      });
    });
    const docsComplete = !anyDoc
      ? true
      : mandTotal > 0 ? mandDone === mandTotal : anyUpload;

    return [s1, docsComplete, docsComplete];
  })();

  const validateField = (k: string, nextForm: typeof form) => {
    const msg = stage1FieldRule(k, nextForm);
    setErrors(prev => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      if (msg) next[k] = msg;
      else delete next[k];
      return next;
    });
  };

  const buildPayload = () => ({
    company_name:   form.coName,
    legal_name:     form.coLegal,
    type:           form.coType,
    segment:        (form.coSeg ?? []).map(segNameOf).join(', '),
    segment_ids:    (form.coSeg ?? []).map(Number).filter(Boolean),
    classification: form.coClass,
    risk_level:     form.coRisk,
    gst_applicable: isDomesticCountry(form.country) ? 'Yes' : 'No',
    gst_number:     isDomesticCountry(form.country) ? ((form.coGstNumber ?? '').trim().toUpperCase() || null) : null,
    website:        form.coWeb,
    status:         'Active' as const,
    primary_address: {
      type:           form.addrType,
      address_line:   form.addr,
      country:        form.country,
      state:          form.state,
      state_code:     form.stateCode || null,
      city:           form.city,
      pin:            cleanPinFor(form.pin, form.country),
      cp_name:        form.cpName,
      cp_designation: form.cpDesig,
      cp_contact:     form.cpTel,
      cp_email:       form.cpEmail,
      cp_whatsapp:    form.cpWa,
    },
    locations: locations.map(l => ({
      type:           l.type,
      address_line:   l.line,
      country:        l.country,
      state:          l.state,
      city:           l.city,
      pin:            cleanPinFor(l.pin, l.country),
      cp_name:        l.cpName,
      cp_designation: l.cpDesignation,
      cp_contact:     l.cpContact,
      cp_email:       l.cpEmail,
      cp_whatsapp:    l.cpWhatsapp,
    })),
  });

  const gstScrutinyComplete = !isDomesticCountry(form.country) || gstRows.length > 0;

  const promptForGstScrutiny = () => {
    toast.warning('GST Scrutiny required', 'Add at least one GST Scrutiny entry before moving to KYC / Due Diligence.');
    setStage(1); setTab('identification'); setGstPopupOpen(true);
  };

  const currencyCountryBlock = (): string | null => {
    const lc = (leadCurrency ?? '').trim().toUpperCase();
    const country = (form.country ?? '').trim();
    if (!lc || !country) return null;
    const isIndia = isDomesticCountry(country);
    if (lc === 'INR' && !isIndia)
      return 'This opportunity is priced in INR (a domestic sale) — the customer must be based in India. Set the country to India, or map this customer to an export-currency opportunity.';
    if (lc !== 'INR' && isIndia)
      return `This opportunity is priced in ${lc} (an export sale) — the customer must be based outside India. Pick a non-Indian country.`;
    return null;
  };

  const submitCustomer = async () => {
    const ccBlock = currencyCountryBlock();
    if (ccBlock) { setStage(1); setTab('identification'); toast.error('Country doesn’t match the opportunity', ccBlock); return; }
    if (!gstScrutinyComplete) { promptForGstScrutiny(); return; }
    if (inFlightRef.current || saving) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const persistedDbId = (isEdit && customer?.db_id) || savedDbId;
      let finalDbId: number | null = persistedDbId || null;
      const attempt = async (confirmDocRemoval: boolean): Promise<void> => {
        const payload = { ...buildPayload(), ...(confirmDocRemoval ? { confirm_segment_doc_removal: true } : {}) };
        try {
          if (persistedDbId) {
            await api.put(`/customers/${persistedDbId}`, payload);
          } else {
            const r = await api.post('/customers', payload);
            const newId = r.data?.data?.db_id ?? null;
        finalDbId = newId;
            if (newId) { setSavedDbId(newId); await flushLocalGst(newId); }
          }
        } catch (e: any) {
          if (!confirmDocRemoval && await confirmOrphanDocs(e)) return attempt(true);
          throw e;
        }
      };
      await attempt(false);
      if (persistedDbId) stageMemory.delete(persistedDbId);
      dirtySavedRef.current = false;
      onSaved?.(finalDbId);
      onClose();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        for (const [key, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          const map: Record<string, string> = {
            'company_name': 'coName', 'legal_name': 'coLegal',
            'type': 'coType', 'segment': 'coSeg',
            'classification': 'coClass', 'risk_level': 'coRisk',
            'primary_address.type': 'addrType', 'primary_address.address_line': 'addr',
            'primary_address.country': 'country', 'primary_address.state': 'state',
            'primary_address.city': 'city', 'primary_address.pin': 'pin',
            'primary_address.cp_name': 'cpName', 'primary_address.cp_designation': 'cpDesig',
            'primary_address.cp_contact': 'cpTel', 'primary_address.cp_email': 'cpEmail',
            'primary_email': 'cpEmail',
            'primary_address.cp_whatsapp': 'cpWa',
          };
          next[map[key] ?? key] = msg;
        }
        setErrors(next);
        setStage(1);
        const firstKey = Object.keys(next)[0];
        const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!Object.keys(next).some(k => document.querySelector(`[data-field="${k}"]`))) {
          toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
        }
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  const persistStage1 = async (): Promise<number | null> => {
    const ccBlock = currencyCountryBlock();
    if (ccBlock) { toast.error('Country doesn’t match the opportunity', ccBlock); return null; }
    if (inFlightRef.current || saving) return savedDbId;
    inFlightRef.current = true;
    setSaving(true);
    const _saveStart = Date.now();
    try {
      const attempt = async (confirmDocRemoval: boolean): Promise<number | null> => {
        const payload = { ...buildPayload(), ...(confirmDocRemoval ? { confirm_segment_doc_removal: true } : {}) };
        const persistedDbId = (isEdit && customer?.db_id) || savedDbId;
        try {
          if (persistedDbId) {
            await api.put(`/customers/${persistedDbId}`, payload);
            dirtySavedRef.current = true;
            return persistedDbId;
          }
          const r = await api.post('/customers', payload);
          const newId = r.data?.data?.db_id ?? null;
          if (newId) { setSavedDbId(newId); await flushLocalGst(newId); }
          dirtySavedRef.current = true;
          return newId;
        } catch (e: any) {
          if (!confirmDocRemoval && await confirmOrphanDocs(e)) return attempt(true);
          throw e;
        }
      };
      return await attempt(false);
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        const map: Record<string, string> = {
          'company_name': 'coName', 'legal_name': 'coLegal',
          'type': 'coType', 'segment': 'coSeg',
          'classification': 'coClass', 'risk_level': 'coRisk',
          'primary_address.type': 'addrType', 'primary_address.address_line': 'addr',
          'primary_address.country': 'country', 'primary_address.state': 'state',
          'primary_address.city': 'city', 'primary_address.pin': 'pin',
          'primary_address.cp_name': 'cpName', 'primary_address.cp_designation': 'cpDesig',
          'primary_address.cp_contact': 'cpTel', 'primary_address.cp_email': 'cpEmail',
          'primary_email': 'cpEmail',
          'primary_address.cp_whatsapp': 'cpWa',
        };
        for (const [key, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          next[map[key] ?? key] = msg;
        }
        setErrors(next);
        setStage(1);
        setTab('identification');
        const firstKey = Object.keys(next)[0];
        document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!Object.keys(next).some(k => document.querySelector(`[data-field="${k}"]`))) {
          toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
        }
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
      return null;
    } finally {
      const elapsed = Date.now() - _saveStart;
      if (elapsed < 350) await new Promise(r => setTimeout(r, 350 - elapsed));
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  const goNext = async () => {
    if (stage === 1) {
      if (!validateStage1()) {
        setTab('identification');
        return;
      }
      if (tab === 'identification') {
        const id = await persistStage1();
        if (!id) return;
        setTab('address-contact');
        return;
      }
      if (!gstScrutinyComplete) { promptForGstScrutiny(); return; }
      const id = await persistStage1();
      if (!id) return;
      setStage(2); setMaxStage(m => Math.max(m, 2) as Stage);
    } else {
      if (kycSub === 'company-dd') { setKycSub('owner-kyc');    return; }
      if (kycSub === 'owner-kyc')  { setKycSub('trade-licence'); return; }
      submitCustomer();
    }
  };
  const goPrev = () => {
    if (stage === 1) {
      if (tab === 'address-contact') setTab('identification');
    } else {
      if (kycSub === 'trade-licence') { setKycSub('owner-kyc'); return; }
      if (kycSub === 'owner-kyc')     { setKycSub('company-dd'); return; }
      setStage(1); setTab('address-contact');
    }
  };

  const atStart = stage === 1 && tab === 'identification';
  const onFinalTab = stage === 2 && kycSub === 'trade-licence';
  const nextLabel = onFinalTab
    ? (isEdit ? 'Update Customer' : 'Submit Customer')
    : 'Save & Next';

  const stage2Missing = '';
  const nextLocked = false;

  return createPortal((
    <div className="acm-root">
      <style>{ACM_SHELL_CSS}</style>
      <style>{SCOPED_CSS}</style>
      <style>{CLM_CSS}</style>
      <div className="acm-card">

        <div className="acm-header">
          <div className="acm-header-left">
            <div className="acm-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="acm-title">{isEdit ? `Edit Customer — ${customer!.company || customer!.id}` : 'Add Customer'}</div>
              <div className="acm-subtitle">{isEdit ? 'Update customer details, KYC, and trade documents.' : 'Capture, verify, and onboard customers with complete compliance and product readiness.'}</div>
            </div>
          </div>
          <div className="acm-header-right">
            {(() => {
              const gstOn = isDomesticCountry(form.country);
              const hasGstNo = !!(form.coGstNumber ?? '').trim();
              const identitySaved = !!(savedDbId || customer?.db_id);
              const canScrutinise = gstOn && hasGstNo && identitySaved;
              return (
                <button
                  type="button"
                  className={`acm-gst-btn${canScrutinise ? '' : ' is-disabled'}`}
                  onClick={() => { if (canScrutinise) setGstPopupOpen(true); }}
                  disabled={!canScrutinise}
                  title={
                    canScrutinise ? 'Manage GST Scrutiny'
                      : !gstOn ? 'Set GST Applicable = Yes to enable'
                      : !hasGstNo ? 'Enter the GST Number to enable'
                      : 'Save the Customer Legal Identity step to enable'
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  GST Scrutiny
                  {gstRows.length > 0 && <span className="acm-gst-count">{gstRows.length}</span>}
                </button>
              );
            })()}
            <button type="button" className="acm-close" onClick={handleClose} aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {showShimmer && <div className="acm-top-progress" role="progressbar" aria-label="Loading"><span /></div>}

        {showShimmer
          ? <StepperShimmer />
          : <Stepper stage={stage} maxStage={maxStage} onGoto={gotoStage} complete={stageComplete} />}

        {stage > 1 && (
          <div className={`acm-history ${historyOpen ? 'acm-hist-open' : ''}`}>
            <div className="acm-history-header" onClick={() => setHistoryOpen(o => !o)}>
              <div className="acm-history-header-left">
                <div className="acm-history-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/>
                  </svg>
                </div>
                <div>
                  <div className="acm-history-title">What you did in previous stages</div>
                  <div className="acm-history-meta">{stage - 1 === 1 ? 'Stage 1 completed' : `Stages 1–${stage - 1} completed`} — review your entries below</div>
                </div>
              </div>
              <div className="acm-history-actions">
                <span className="acm-history-badge">{stage - 1} stage{stage - 1 === 1 ? '' : 's'} completed</span>
                <div className={`acm-history-chevron ${historyOpen ? 'acm-open' : ''}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
            </div>
            <div className="acm-history-body">
              <HistoryStage1 form={form} locations={locations} customerId={customer?.id} segments={masters.segments} />
            </div>
          </div>
        )}

        {stage === 1 && showShimmer && (
          <div className="acm-tabs acm-tabs-shimmer">
            <Shimmer height={36} width={180} radius={999} />
            <Shimmer height={36} width={200} radius={999} />
          </div>
        )}
        {stage === 1 && !showShimmer && (
          <div className="acm-tabs">
            <button type="button" className={`acm-tab ${tab === 'identification' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setTab('identification')}>Customer Identification</button>
            <button type="button" className={`acm-tab ${tab === 'address-contact' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => { if (tab === 'address-contact' || validateStage1()) setTab('address-contact'); }}>Address &amp; Contact Details</button>
          </div>
        )}


        <div className="acm-body">
          {stage === 1 && showShimmer && <Stage1FormShimmer />}
          {stage === 1 && !showShimmer && tab === 'identification' && (
            <Stage1Identification form={form} setF={setF} masters={masters} errors={errors} currentCustomerId={savedDbId ?? customer?.db_id ?? null} unruledSegments={segRulesLoaded ? masters.segments.filter(s => !ruledSegCodes.has(s.code ?? '')).map(s => String(s.id)) : []} clearErr={(k) => setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; })} validateField={validateField} segTypesById={segTypesById} onGstGate={reportGstGate} guardSegmentRemove={(prev, vs) => {
              const removed = prev.filter(s => !vs.includes(s));
              if (!removed.length) return vs;
              const lockedRemoved = removed.filter(s => lockedSegments.some(l => l.toLowerCase() === segNameOf(s).toLowerCase()));
              const uploadedSet = new Set(uploadedKeys);
              const keepKeys = new Set(vs.flatMap(s => segReqKeys[segNameOf(s)] ?? []));
              const docRemoved = removed.filter(s => !lockedRemoved.includes(s)
                && (segReqKeys[segNameOf(s)] ?? []).some(k => uploadedSet.has(k) && !keepKeys.has(k)));
              if (lockedRemoved.length) {
                const reasonOf = (s: string) => lockedSegmentReasons[segNameOf(s).trim().toLowerCase()] ?? 'pi';
                const piNames   = lockedRemoved.filter(s => reasonOf(s) !== 'product').map(segNameOf);
                const prodNames = lockedRemoved.filter(s => reasonOf(s) === 'product').map(segNameOf);
                if (piNames.length) {
                  toast.error('Cannot remove segment', `${piNames.join(', ')} — this segment is currently in use.`);
                }
                if (prodNames.length) {
                  toast.error('Cannot remove segment', `${prodNames.join(', ')} — a product in this segment is mapped to an opportunity. Unmap it in Product Directory first.`);
                }
              }
              if (docRemoved.length) {
                toast.error('Cannot remove segment', `${docRemoved.map(segNameOf).join(', ')} — has its own uploaded document.`);
              }
              const blocked = [...lockedRemoved, ...docRemoved];
              if (blocked.length) {
                vs = [...vs, ...blocked.filter(s => !vs.includes(s))];
              }
              return vs;
            }} gstLocked={gstRows.length > 0} onCountryBlockedByGst={() => toast.warning('Country is locked to India', 'This customer has GST Scrutiny entries. Delete them first — an international customer has no GST.')}
            docsLocked={Object.keys(segmentRefUploads).length > 0}
            onCountryBlockedByDocs={() => toast.warning('Country is locked', 'KYC / Due-Diligence documents have already been uploaded for this customer’s trade type. Changing the country would switch the segment’s document rule (Domestic ↔ International) and orphan those files — delete the uploaded documents first.')}
            mapLeadLocked={mapLeadLocked}
            onCountryBlockedByLead={() => toast.warning('Country is locked', 'This customer is already mapped to a lead. Opportunities, quotations and proforma invoices were raised against its current country, so it can no longer be changed.')} />
          )}
          {stage === 1 && !showShimmer && tab === 'address-contact' && (
            <Stage1AdditionalLocations
              primary={{
                type:          form.addrType,
                line:          form.addr,
                country:       form.country,
                state:         form.state,
                city:          form.city,
                pin:           form.pin,
                cpName:        form.cpName,
                cpDesignation: form.cpDesig,
                cpContact:     form.cpTel,
                cpEmail:       form.cpEmail,
                cpWhatsapp:    form.cpWa,
              }}
              locations={locations}
              onAdd={() => setLocModal({ open:true, editing:null })}
              onEdit={(id) => setLocModal({ open:true, editing:id })}
              onDel={(id) => setDelModal({ open:true, id })}
              onEditPrimary={() => setTab('identification')}
            />
          )}
          {stage === 2 && showShimmer && <Stage2Shimmer />}
          {stage === 2 && !showShimmer && (
            <Stage2KYC
              sub={kycSub} setSub={(s) => { setKycSub(s); setKycSearch(''); }}
              page={kycPage} setPage={(s, p) => setKycPage(prev => ({ ...prev, [s]: p }))}
              search={kycSearch} setSearch={setKycSearch}
              onAdd={(s) => { setEditDocId(null); setEditOwnerId(null); setDocModal({ open: true, sub: s }); }}
              docs={kycDocs}
              owners={kycOwners}
              loading={segmentDocsLoading}
              segmentName={(form.coSeg ?? []).map(segNameOf).join(', ')}
              segmentDocs={segmentDocs}
              segmentRefUploads={segmentRefUploads}
              setSegmentRefUploads={setSegmentRefUploads}
              persistSegmentRefUpload={persistSegmentRefUpload}
              customerSaved={!!savedDbId}
              onEditDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                if (!row) return;
                setEditDocId(id);
                setDocModal({ open: true, sub: row.kind === 'dd' ? 'company-dd' : 'trade-licence' });
              }}
              onDeleteDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                setKycDelModal({ open: true, kind: 'doc', id, label: row?.name });
              }}
              onEditOwner={(id) => {
                setEditOwnerId(id);
                setDocModal({ open: true, sub: 'owner-kyc' });
              }}
              onDeleteOwner={(id) => {
                const row = kycOwners.find(o => o.id === id);
                setKycDelModal({ open: true, kind: 'owner', id, label: row?.owner_name });
              }}
            />
          )}
          
        </div>

        <div className="acm-footer">
          <div className="acm-req-note">
            <span className="acm-req-dot" />
            <span>Fields marked with <span className="acm-req-star">*</span> are required</span>
          </div>
          <div className="acm-footer-actions">
            {!atStart && (
              <button type="button" className="acm-btn-prev" onClick={goPrev}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Previous
              </button>
            )}
            <Tooltip label={nextLocked ? stage2Missing : ''} disabled={!nextLocked}>
              <button
                type="button"
                className="acm-btn-next"
                onClick={goNext}
                disabled={saving || nextLocked}
                style={
                  saving      ? { opacity:.7, cursor:'wait' } :
                  nextLocked  ? { opacity:.55, cursor:'not-allowed' } :
                  undefined
                }
              >
                {saving ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" className="acm-cust-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                )}
                <span>{saving ? 'Saving…' : nextLabel}</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {saving && (
          <div className="acm-save-lock" aria-live="polite" aria-busy="true">
            <span className="acm-save-lock-spinner" />
            <span className="acm-save-lock-text">{isEdit ? 'Updating…' : 'Saving…'}</span>
          </div>
        )}

      </div>

      {locModal.open && (() => {
        const editingId = locModal.editing;
        const otherLocs = editingId
          ? locations.filter(l => l.id !== editingId)
          : locations;
        const primaryEmail = (form.cpEmail || '').trim().toLowerCase();
        const primaryPhone = (form.cpTel   || '').trim();
        const existingEmails = [
          primaryEmail,
          ...otherLocs.map(l => (l.cpEmail || '').trim().toLowerCase()),
        ].filter(Boolean);
        const existingPhones = [
          primaryPhone,
          ...otherLocs.map(l => (l.cpContact || '').trim()),
        ].filter(Boolean);
        const usedAddressTypes = [
          (form.addrType || '').trim(),
          ...otherLocs.map(l => (l.type || '').trim()),
        ].filter(Boolean);
        return (
          <LocationSubModal
            editing={editingId ? locations.find(l => l.id === editingId) ?? null : null}
            masters={masters}
            disallowedTypes={usedAddressTypes}
            existingEmails={existingEmails}
            existingPhones={existingPhones}
            primaryCountry={form.country}
            onClose={() => setLocModal({ open:false, editing:null })}
            onSave={(rec) => {
              if (editingId) setLocations(prev => prev.map(l => l.id === editingId ? { ...rec, id: l.id } : l));
              else setLocations(prev => [...prev, { ...rec, id: newId('loc') }]);
              setLocModal({ open:false, editing:null });
            }}
          />
        );
      })()}

      <DeleteConfirmModal
        open={delModal.open}
        title="Delete Address & Contact"
        itemName={delModal.id ? (locations.find(l => l.id === delModal.id)?.type || 'this location') : undefined}
        subMessage="This will remove the address and its contact person from this customer. The action cannot be undone."
        loading={delLocBusy}
        onClose={() => { if (!delLocBusy) setDelModal({ open:false, id:null }); }}
        onConfirm={() => {
          if (delLocBusy) return;
          setDelLocBusy(true);
          const id = delModal.id;
          setTimeout(() => {
            if (id) setLocations(prev => prev.filter(l => l.id !== id));
            setDelLocBusy(false);
            setDelModal({ open:false, id:null });
          }, 450);
        }}
      />

      <DeleteConfirmModal
        open={kycDelModal.open}
        title={kycDelModal.kind === 'doc' ? 'Delete Document' : 'Delete Owner'}
        itemName={kycDelModal.label || (kycDelModal.kind === 'doc' ? 'this document' : 'this owner')}
        subMessage={kycDelModal.kind === 'doc'
          ? 'This will permanently delete the document and its uploaded attachment.'
          : 'This will permanently delete the owner record and all uploaded identity proofs.'}
        onClose={() => { if (!kycDeleting) setKycDelModal({ open: false, kind: kycDelModal.kind, id: null }); }}
        loading={kycDeleting}
        onConfirm={async () => {
          const id = kycDelModal.id;
          const kind = kycDelModal.kind;
          if (!id || !customer?.db_id) { setKycDelModal({ open: false, kind, id: null }); return; }
          setKycDeleting(true);
          try {
            if (kind === 'doc') {
              await api.delete(`/customers/${customer.db_id}/documents/${id}`);
              setKycDocs(prev => prev.filter(d => d.id !== id));
            } else {
              await api.delete(`/customers/${customer.db_id}/owners/${id}`);
              setKycOwners(prev => prev.filter(o => o.id !== id));
            }
          } catch (err: any) {
            toast.error('Delete failed', err?.response?.data?.message ?? 'Please try again.');
          } finally {
            setKycDelModal({ open: false, kind, id: null });
            setKycDeleting(false);
          }
        }}
      />

      {docModal.open && docModal.sub === 'owner-kyc' && (
        <OwnerDDSubModal
          masters={masters}
          customerId={savedDbId}
          editing={editOwnerId ? kycOwners.find(o => o.id === editOwnerId) ?? null : null}
          onClose={() => { setEditOwnerId(null); setDocModal(m => ({ ...m, open: false })); }}
          onSaved={(row) => {
            setKycOwners(prev => editOwnerId
              ? prev.map(o => o.id === editOwnerId ? row : o)
              : [row, ...prev]);
            setEditOwnerId(null);
            setDocModal(m => ({ ...m, open: false }));
          }}
        />
      )}
      {docModal.open && docModal.sub !== 'owner-kyc' && (
        <DocumentSubModal
          sub={docModal.sub}
          masters={masters}
          customerId={savedDbId}
          editing={editDocId ? kycDocs.find(d => d.id === editDocId) ?? null : null}
          onDocTypeAdded={(opt) => setMasters(m => ({ ...m, documentTypes: [...m.documentTypes, opt] }))}
          onClose={() => { setEditDocId(null); setDocModal(m => ({ ...m, open: false })); }}
          onSaved={(row) => {
            setKycDocs(prev => editDocId
              ? prev.map(d => d.id === editDocId ? row : d)
              : [row, ...prev]);
            setEditDocId(null);
            setDocModal(m => ({ ...m, open: false }));
          }}
        />
      )}

      <SalesCustomerSendForSignatureModal
        boxSize={{ width: 240, height: 55 }}
        open={Array.isArray(sendForSignature)}
        multiBox
        customer={(() => {
          const partyId = (customer?.db_id ?? savedDbId) ?? null;
          if (!partyId) return null;
          return {
            id:      customer?.id ?? `c-${partyId}`,
            db_id:   partyId,
            company: form.coName || customer?.company || '',
            contact: form.cpName || customer?.contact || '',
            email:   form.cpEmail || customer?.email || '',
          };
        })()}
        preselectedDocIds={sendForSignature ?? undefined}
        onClose={() => setSendForSignature(null)}
        onSent={(sentDocIds) => {
          const sentSet = new Set(sentDocIds);
          setTdDocs(prev => prev.map(d => (d.db_id && sentSet.has(d.db_id))
            ? { ...d, sent: true, status: 'inprogress' as TdSigStatus }
            : d));
          setSendForSignature(null);
        }}
      />

      <GstScrutinyManagePopup
        open={gstPopupOpen}
        rows={gstRows}
        onClose={() => setGstPopupOpen(false)}
        onAdd={addGstRow}
        defaultGstNumber={form.coGstNumber}
      />
    </div>
  ), document.body);
}

const EMPTY_GST_DRAFT: GstDraft = { gstNumber: '', status: 'Active', lastFilingDate: '', prevNonGst2aInvoice: '', redFlags: '' };
const GST_STATUS_OPTS = [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }];
function GstScrutinyManagePopup(props: {
  open: boolean;
  rows: GstRow[];
  onClose: () => void;
  onAdd: (draft: GstDraft) => Promise<boolean>;
  defaultGstNumber?: string;
}) {
  const { open, rows, onClose, onAdd, defaultGstNumber } = props;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GstDraft>(EMPTY_GST_DRAFT);
  const [errs, setErrs] = useState<{ gstNumber?: string; lastFilingDate?: string }>({});
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const GST_PER_PAGE = 5;

  useEffect(() => {
    if (!open) { setAdding(false); setDraft(EMPTY_GST_DRAFT); setErrs({}); setPage(1); }
  }, [open]);

  const pageCount = Math.max(1, Math.ceil(rows.length / GST_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * GST_PER_PAGE, safePage * GST_PER_PAGE);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  if (!open) return null;

  const setD = <K extends keyof GstDraft>(k: K, v: GstDraft[K]) => setDraft(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    const e: typeof errs = {};
    const gstErr = gstNumberError(draft.gstNumber);
    if (gstErr) e.gstNumber = gstErr;
    if (!draft.lastFilingDate) e.lastFilingDate = 'GST Last Filing Date is required';
    if (Object.keys(e).length) { setErrs(e); return; }
    setBusy(true);
    const ok = await onAdd(draft);
    setBusy(false);
    if (ok) { setDraft(EMPTY_GST_DRAFT); setErrs({}); setAdding(false); setPage(1); }
  };

  const today = new Date().toISOString().slice(0, 10);

  const closeForm = () => { setAdding(false); setDraft(EMPTY_GST_DRAFT); setErrs({}); };

  return (
    <>
    <div className="acm-gst-overlay" role="dialog" aria-modal="true">
      <div className="acm-gst-card">
        <div className="acm-gst-head">
          <div className="acm-gst-head-left">
            <div className="acm-gst-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
            </div>
            <div>
              <div className="acm-gst-title">GST Scrutiny</div>
              <div className="acm-gst-sub">GST profile, filing status &amp; compliance red-flags</div>
            </div>
          </div>
          <div className="acm-gst-head-actions">
            {!adding && (
              <button type="button" className="acm-add-pill" onClick={() => { setDraft({ ...EMPTY_GST_DRAFT, gstNumber: ((defaultGstNumber || rows[0]?.gst_number || '') as string).toUpperCase() }); setErrs({}); setAdding(true); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add GST Scrutiny
              </button>
            )}
            <button type="button" className="acm-close" onClick={onClose} aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div className="acm-gst-body">
          <div className="acm-gst-table-wrap dt-root hr-dt" data-accent="violet">
            <table className="acm-gst-table dt-table">
              <thead>
                <tr>
                  <th className="acm-gst-srno-col">SR NO</th>
                  <th>GST Number</th>
                  <th>Status</th>
                  <th>Last Filing Date</th>
                  <th>Prev Non-GST 2A Invoice</th>
                  <th>Red Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="acm-gst-empty">No GST scrutiny entries added yet. Click “Add GST Scrutiny” to create one.</td></tr>
                ) : pageRows.map((r, i) => {
                  const sr = (safePage - 1) * GST_PER_PAGE + i + 1;
                  return (
                    <tr key={r.id}>
                      <td className="acm-gst-srno-col"><span className="dt-serial">{sr}</span></td>
                      <td>{r.gst_number}</td>
                      <td><span className={`acm-gst-status acm-gst-status-${String(r.status).toLowerCase()}`}>{r.status}</span></td>
                      <td>{r.last_filing_date || '—'}</td>
                      <td>{(() => {
                        const v = r.prev_non_gst_2a_invoice || '';
                        if (!v) return '—';
                        const span = <span style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{v}</span>;
                        return v.length > 26 ? <Tooltip label={v}>{span}</Tooltip> : span;
                      })()}</td>
                      <td>{(() => {
                        const v = r.red_flags || '';
                        if (!v) return '—';
                        const span = <span style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{v}</span>;
                        return v.length > 26 ? <Tooltip label={v}>{span}</Tooltip> : span;
                      })()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length > GST_PER_PAGE && (
              <WorklistPager total={rows.length} page={safePage} pageSize={GST_PER_PAGE} onPage={setPage} />
            )}
          </div>
        </div>
      </div>
    </div>

    {adding && (
      <div className="acm-gst-overlay" style={{ zIndex: 1300, background: 'rgba(6,4,18,0.82)', backdropFilter: 'blur(3px)' }} role="dialog" aria-modal="true">
        <div className="acm-gst-card acm-gst-form-card" style={{ width: 'min(900px, 96vw)' }}>
          <div className="acm-gst-head">
            <div className="acm-gst-head-left">
              <div className="acm-gst-head-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
              </div>
              <div>
                <div className="acm-gst-title">GST Scrutiny</div>
                <div className="acm-gst-sub">GST profile, filing status &amp; compliance red-flags</div>
              </div>
            </div>
            <div className="acm-gst-head-actions">
              <button type="button" className="acm-close" onClick={closeForm} aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div className="acm-gst-body">
            <div className="acm-gst-form">
              <div className="acm-row acm-row-3">
                <Field label="GST Number" required error={errs.gstNumber}>
                  <input
                    className={`acm-input-ro${errs.gstNumber ? ' acm-input-error' : ''}`}
                    value={draft.gstNumber}
                    readOnly
                    title="Comes from the customer's GST Number — change it on the customer form"
                    placeholder="—"
                  />
                </Field>
                <Field label="GST Status" required>
                  <MasterSelect value={draft.status} options={GST_STATUS_OPTS} placeholder="Select GST status" onChange={v => setD('status', v as GstDraft['status'])} />
                </Field>
                <Field label="GST Last Filing Date" required error={errs.lastFilingDate}>
                  <MasterDatePicker value={draft.lastFilingDate} onChange={v => { setD('lastFilingDate', v); setErrs(p => ({ ...p, lastFilingDate: undefined })); }} placeholder="dd/mm/yyyy" maxDate={today} />
                </Field>
              </div>
              <div className="acm-row acm-row-2">
                <Field label="Previous Non-GST 2A Reflected Invoice">
                  <input value={draft.prevNonGst2aInvoice} maxLength={50} onChange={e => setD('prevNonGst2aInvoice', e.target.value)} placeholder="Enter invoice reference (optional)" />
                </Field>
                <Field label="Red Flags">
                  <input value={draft.redFlags} maxLength={300} onChange={e => setD('redFlags', e.target.value)} placeholder="Enter red flags (optional)" />
                </Field>
              </div>
              <div className="acm-gst-form-actions">
                <button type="button" className="acm-btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
                <button type="button" className="acm-btn-primary" onClick={save} disabled={busy}>
                  {busy ? (
                    <>
                      <svg className="acm-loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Saving…
                    </>
                  ) : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function Stepper({ stage, maxStage, onGoto, complete }: { stage: Stage; maxStage: Stage; onGoto: (s: Stage) => void; complete: [boolean, boolean, boolean] }) {
  const steps = [
    { n:1 as Stage, title:'Customer Legal Identity', sub:'Company, GST, PAN & contact',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
    { n:2 as Stage, title:'KYC / Due Diligence', sub:'Docs, identity & compliance',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg> },
  ];
  const CHECK_BADGE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
  const CHECK_NUM = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>;

  return (
    <div className="acm-stepper">
      {steps.map((s, i) => {
        const visited = s.n <= maxStage;
        const isActive = s.n === stage;
        const isDone = !isActive && visited && complete[s.n - 1];
        const cls = isActive
          ? 'acm-step-active'
          : isDone
            ? 'acm-step-done'
            : visited
              ? 'acm-step-incomplete'
              : 'acm-step-pending';
        const showCheck = isDone;
        return (
          <Fragment key={s.n}>
            <div className={`acm-step ${cls}`} onClick={() => onGoto(s.n)}>
              <div className="acm-step-badge-wrap">
                <div className="acm-step-badge">{showCheck ? CHECK_BADGE : s.icon}</div>
                <div className="acm-step-num">{showCheck ? CHECK_NUM : s.n}</div>
              </div>
              <div className="acm-step-text">
                <div className="acm-step-title">{s.title}</div>
                <div className="acm-step-sub">{s.sub}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="acm-step-connector"><div className="acm-connector-line" data-done={s.n < maxStage ? '1' : '0'} /></div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}


function Stage2Shimmer() {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Shimmer height={46} width={460} radius={11} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Shimmer height={36} width="60%" radius={8} />
        <Shimmer height={36} width={170} radius={8} />
      </div>
      <div style={{ border: '1px solid var(--vz-border-color)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', background: 'rgba(124,58,237,0.04)' }}>
          <Shimmer height={11} width="40%" radius={4} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 14, padding: '14px', borderTop: '1px solid var(--vz-border-color)' }}>
            <Shimmer height={14} width={28} radius={4} />
            <Shimmer height={14} width="22%" radius={4} />
            <Shimmer height={14} width="18%" radius={4} />
            <Shimmer height={14} width="18%" radius={4} />
            <Shimmer height={14} width="14%" radius={4} />
            <Shimmer height={14} width={70} radius={4} />
          </div>
        ))}
      </div>
    </div>
  );
}


function Stage1Identification({ form, setF, masters, errors, clearErr, validateField, guardSegmentRemove, gstLocked, onCountryBlockedByGst, docsLocked = false, onCountryBlockedByDocs, mapLeadLocked = false, onCountryBlockedByLead, currentCustomerId, unruledSegments = [], segTypesById, onGstGate }:
  { form: any; setF: (k: any, v: any) => void; masters: MasterLists; errors: Record<string, string>; clearErr: (k: string) => void; validateField: (k: string, nextForm: any) => void; guardSegmentRemove: (prev: string[], next: string[]) => string[];
    gstLocked: boolean;
    onCountryBlockedByGst: () => void;
    docsLocked?: boolean;
    onCountryBlockedByDocs?: () => void;
    mapLeadLocked?: boolean;
    onCountryBlockedByLead?: () => void;
    currentCustomerId?: number | null;
    unruledSegments?: string[];
    segTypesById: Map<string, Set<SegDocType>>;
    onGstGate?: (g: { status: string; takenBy: string | null }) => void }) {
  const domestic = isDomesticCountry(form.country);
  const [expandedSegBadges, setExpandedSegBadges] = useState<Set<string>>(new Set());
  const toggleSegBadge = (name: string) => setExpandedSegBadges(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });
  const selectedCountry = masters.countries.find(c => c.name === form.country);
  const states = selectedCountry
    ? masters.states.filter(s => s.country_id === selectedCountry.id)
    : [];
  const hasStates = countryHasStates(masters, form.country);
  const set = (k: string, v: any) => {
    setF(k as any, v);
    validateField(k, { ...form, [k]: v });
  };

  const [gstStatus, setGstStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'taken'>('idle');
  const [gstTakenBy, setGstTakenBy] = useState<string | null>(null);
  const gstRaw = (form.coGstNumber ?? '').trim();
  const gstApplicable = domestic;
  useEffect(() => {
    if (!gstApplicable || !gstRaw) { setGstStatus('idle'); setGstTakenBy(null); return; }
    setGstStatus('checking');
    setGstTakenBy(null);
    let cancelled = false;
    const t = window.setTimeout(() => {
      validateField('coGstNumber', { ...form, coGstNumber: gstRaw });
      if (gstNumberError(gstRaw, form.stateCode)) { setGstStatus('invalid'); return; }
      api.get('/customers/gst-available', {
        params: { gst_number: gstRaw, ignore_id: currentCustomerId ?? undefined },
      })
        .then(r => {
          if (cancelled) return;
          const d = r.data?.data ?? r.data ?? {};
          if (d.available === false) { setGstTakenBy(d.taken_by ?? null); setGstStatus('taken'); }
          else setGstStatus('valid');
        })
        .catch(() => { if (!cancelled) setGstStatus('valid'); });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstRaw, gstApplicable, form.stateCode]);

  const gstStateMismatch = useMemo(
    () => (gstApplicable && GSTIN_RE.test(gstRaw))
      ? gstNumberError(gstRaw, form.stateCode) ?? null
      : null,
    [gstApplicable, gstRaw, form.stateCode],
  );

  useEffect(() => { onGstGate?.({ status: gstStatus, takenBy: gstTakenBy }); }, [gstStatus, gstTakenBy, onGstGate]);

  const contactPersonField = (
    <Field label="Contact Person Name" required error={errors.cpName} fieldKey="cpName">
      <input className={errors.cpName ? 'acm-input-error' : ''} value={form.cpName} onChange={e => set('cpName', e.target.value)} placeholder="Full name" />
    </Field>
  );
  const whatsappField = (
    <Field label="Whatsapp Enabled" required error={errors.cpWa} fieldKey="cpWa">
      <div className="acm-radio-row">
        <label className="acm-radio"><input type="radio" name="cpWa" value="yes" checked={form.cpWa === 'yes'} onChange={() => set('cpWa', 'yes')} /> YES</label>
        <label className="acm-radio"><input type="radio" name="cpWa" value="no" checked={form.cpWa === 'no'} onChange={() => set('cpWa', 'no')} /> NO</label>
      </div>
    </Field>
  );

  return (
    <div>
      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <div>
            <span className="acm-section-title">BASIC COMPANY DETAILS</span>
            <span className="acm-section-sub">| Company identity, segment, and risk classification</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-4">
            <Field label="Company Name" required error={errors.coName} fieldKey="coName"><input className={errors.coName ? 'acm-input-error' : ''} value={form.coName} maxLength={30} onChange={e => set('coName', e.target.value.slice(0, 30))} placeholder="e.g. Shree Agro Pvt Ltd (max 30)" /></Field>
            <Field label="Company Legal Name" required error={errors.coLegal} fieldKey="coLegal"><input className={errors.coLegal ? 'acm-input-error' : ''} value={form.coLegal} onChange={e => set('coLegal', e.target.value)} placeholder="Registered legal entity name" /></Field>
            <Field label="Customer Category" required error={errors.coType} fieldKey="coType">
              <MasterSelect value={form.coType} options={optsWith(masters.customerTypes, form.coType)} placeholder="Select customer category" invalid={!!errors.coType} onChange={v => set('coType', v)} />
            </Field>
            <Field label="Company Website" error={errors.coWeb} fieldKey="coWeb"><input className={errors.coWeb ? 'acm-input-error' : ''} value={form.coWeb} onChange={e => set('coWeb', e.target.value)} placeholder="https://example.com" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Customer Segment" required error={errors.coSeg} fieldKey="coSeg">
              <MasterMultiSelect
                value={form.coSeg}

                options={[...masters.segments]
                  .sort((a, b) => (b.code ?? '').localeCompare(a.code ?? '', undefined, { numeric: true }))
                  .map(o => ({ value: String(o.id), label: o.code ? `${o.code}: ${o.name}` : o.name }))}
                emptyText="No segment has a Document Control Panel rule yet"
                placeholder="Select segment"
                menuClassName="acm-seg-menu"
                invalid={!!errors.coSeg}
                onChange={vs => {
                  set('coSeg', guardSegmentRemove(form.coSeg ?? [], vs));
                }}
                disabledValues={unruledSegments}
                disabledHint="no document rule defined in the Document Control Panel yet"
                renderBadges={(id) => {
                  const reg = <SegmentBadge status={masters.segments.find(s => String(s.id) === id)?.regulatory_status} />;
                  const t = segTypesById.get(id);
                  if (!t || t.size === 0) return reg;
                  const both = t.has('international') && t.has('domestic');
                  const badge = (text: string, title: string, color: string, bg: string, bd: string, onClick?: (e: React.MouseEvent) => void) => (
                    <span className="seg-type-badge" title={title} onClick={onClick} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.02em', padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap', color, background: bg, border: `1px solid ${bd}`, cursor: onClick ? 'pointer' : undefined, '--sb-dk': SEG_TAG_DARK[text] } as React.CSSProperties}>{text}</span>
                  );
                  const intl = () => badge('INT', 'International rule', '#3730a3', '#eef2ff', '#c7d2fe');
                  const dom  = () => badge('DOM', 'Domestic rule', '#0f766e', '#ecfdf5', '#99f6e4');
                  if (both) {
                    return expandedSegBadges.has(id)
                      ? <>{reg}{intl()}{dom()}</>
                      : <>{reg}{badge('+2', 'Has both International & Domestic — click to show', '#6d28d9', '#f5f3ff', '#ddd6fe',
                          (e) => { e.stopPropagation(); toggleSegBadge(id); })}</>;
                  }
                  return <>{reg}{t.has('international') ? intl() : dom()}</>;
                }}
                maxChips={2}
              />
            </Field>
            <Field label="Classification & Flags" required error={errors.coClass} fieldKey="coClass">
              <MasterSelect value={form.coClass} options={optsWith(masters.classifications, form.coClass)} placeholder="Select classification" invalid={!!errors.coClass} allowDeselect onChange={v => set('coClass', v)} />
            </Field>
            <Field label="Risk Level" required error={errors.coRisk} fieldKey="coRisk">
              <MasterSelect value={form.coRisk} options={optsWith(masters.riskLevels, form.coRisk)} placeholder="Select risk level" invalid={!!errors.coRisk} onChange={v => set('coRisk', v)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
          <div>
            <span className="acm-section-title">PRIMARY ADDRESS &amp; CONTACT PERSON</span>
            <span className="acm-section-sub">| Registered office and primary contact at this location</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required error={errors.addrType} fieldKey="addrType">
              <MasterSelect
                value={DEFAULT_ADDRESS_TYPE}
                options={[{ value: DEFAULT_ADDRESS_TYPE, label: DEFAULT_ADDRESS_TYPE }]}
                placeholder="Select address type"
                disabled
                onChange={() => {  }}
              />
            </Field>
            <Field label="Address" required error={errors.addr} fieldKey="addr"><input className={errors.addr ? 'acm-input-error' : ''} value={form.addr} onChange={e => set('addr', e.target.value)} placeholder="Street, building, area" maxLength={75} /></Field>
          </div>
          <div className="acm-row acm-row-3">
            <Field label="Country" required error={errors.country} fieldKey="country">
              <MasterSelect value={form.country} options={optsWith(masters.countries, form.country)} placeholder="Select country" invalid={!!errors.country}
                disabled={mapLeadLocked}
                onChange={v => {
                if (gstLocked && !isDomesticCountry(v)) { onCountryBlockedByGst(); return; }
                if (docsLocked && isDomesticCountry(v) !== domestic) { onCountryBlockedByDocs?.(); return; }
                const nextForm = { ...form, country: v, state: '', stateCode: '' };
                setF('country', v); setF('state', ''); setF('stateCode', '');
                if (!isDomesticCountry(v)) clearErr('coGstNumber');
                validateField('country', nextForm); validateField('state', nextForm);
                validateField('pin', nextForm);
                validateField('coSeg', nextForm);
              }} />
              {mapLeadLocked && (
                <span
                  className="acm-field-note"
                  role="note"
                  onClick={() => onCountryBlockedByLead?.()}
                >
                  Locked — this customer is already mapped to a lead.
                </span>
              )}
            </Field>
            <Field label="State" required error={errors.state} fieldKey="state">
              <MasterSelect
                value={form.state}
                options={(() => {
                  const base = states.map(s => ({ value: s.name, label: s.name }));
                  if (form.state && !base.some(o => o.value === form.state)) return [{ value: form.state, label: form.state }, ...base];
                  return base;
                })()}
                placeholder={!form.country ? 'Select country first' : hasStates ? 'Select state' : 'Add states in Master → States'}
                disabled={!form.country || !hasStates}
                invalid={!!errors.state}
                onChange={v => {
                  set('state', v);
                  const newCode = masters.stateCodes.find(sc => sc.stateName === v)?.code ?? '';
                  set('stateCode', newCode);
                  validateField('coGstNumber', { ...form, state: v, stateCode: newCode });
                }}
              />
            </Field>
            {domestic && (
              <Field label="State Code" required fieldKey="stateCode">
                <input
                  className="acm-input acm-input-ro"
                  placeholder="Auto-filled from State"
                  value={form.stateCode ?? ''}
                  readOnly
                  tabIndex={-1}
                  title="GST state code — automatically set from the selected State"
                />
              </Field>
            )}
            <Field label="City" required error={errors.city} fieldKey="city"><input className={errors.city ? 'acm-input-error' : ''} value={form.city} onChange={e => set('city', e.target.value)} placeholder="City name" /></Field>
            <Field label={pinLabel(form.country)} required error={errors.pin} fieldKey="pin"><input className={errors.pin ? 'acm-input-error' : ''} value={form.pin} onChange={e => set('pin', pinSanitize(e.target.value, form.country))} inputMode={isDomesticCountry(form.country) ? 'numeric' : 'text'} maxLength={pinMaxLen(form.country)} placeholder={pinPlaceholder(form.country)} /></Field>
            {!domestic && contactPersonField}
            {domestic && (
              <Field label="GST Number" required error={errors.coGstNumber} fieldKey="coGstNumber">
                <input
                  className={`acm-input ${errors.coGstNumber || gstStateMismatch || gstStatus === 'taken' ? 'acm-input-error' : ''} ${gstStatus === 'valid' && !gstStateMismatch ? 'acm-input-ok' : ''}`}
                  placeholder="e.g. 27AADCI6120M1ZH"
                  maxLength={15}
                  value={form.coGstNumber ?? ''}
                  onChange={e => { setF('coGstNumber', e.target.value.toUpperCase().replace(/\s+/g, '')); clearErr('coGstNumber'); }}
                />
                {gstStatus === 'checking' && !gstStateMismatch && (
                  <div className="acm-gst-hint acm-gst-checking">Checking GST Number…</div>
                )}
                {gstStatus === 'valid' && !gstStateMismatch && (
                  <div className="acm-gst-hint acm-gst-ok">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    GST Number is valid
                  </div>
                )}
                {gstStateMismatch && !errors.coGstNumber && (
                  <div className="acm-gst-hint acm-gst-taken">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {gstStateMismatch}
                  </div>
                )}
                {gstStatus === 'taken' && (
                  <div className="acm-gst-hint acm-gst-taken">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {gstTakenBy ? `Already used by ${gstTakenBy}` : 'This GST Number is already taken'}
                  </div>
                )}
              </Field>
            )}
          </div>
          <div className="acm-row acm-row-4">
            {domestic && contactPersonField}
            <Field label="Designation" required error={errors.cpDesig} fieldKey="cpDesig">
              <input
                className={`acm-input ${errors.cpDesig ? 'acm-input-error' : ''}`}
                placeholder="Type designation (e.g. Compliance Officer)"
                value={form.cpDesig}
                onChange={e => set('cpDesig', e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="Contact No" required error={errors.cpTel} fieldKey="cpTel">{domestic ? (
              <div className={`acm-phone-wrap${errors.cpTel ? ' acm-phone-invalid' : ''}`}>
                <span className="acm-phone-cc">+91</span>
                <input type="tel" inputMode="numeric" maxLength={10} value={form.cpTel} onChange={e => set('cpTel', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
              </div>
            ) : (
              <input className={errors.cpTel ? 'acm-input-error' : ''} type="tel" value={form.cpTel} onChange={e => set('cpTel', e.target.value)} placeholder="7–15 digit number" />
            )}</Field>
            <Field label="Email" required error={errors.cpEmail} fieldKey="cpEmail"><input className={errors.cpEmail ? 'acm-input-error' : ''} type="email" value={form.cpEmail} onChange={e => set('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
            {!domestic && whatsappField}
          </div>
          {domestic && (
            <div className="acm-row acm-row-1">
              {whatsappField}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type PrimaryRowData = {
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: string;
};
function Stage1AdditionalLocations({ primary, locations, onAdd, onEdit, onDel, onEditPrimary }:
  { primary: PrimaryRowData;
    locations: LocationRow[];
    onAdd: () => void;
    onEdit: (id: string) => void;
    onDel: (id: string) => void;
    onEditPrimary: () => void;
  }) {
  type DisplayRow = PrimaryRowData & { id: string; isPrimary: boolean };
  const allRows: DisplayRow[] = [
    { id: '__primary__', isPrimary: true, ...primary },
    ...locations.map(l => ({ ...l, isPrimary: false })),
  ];
  return (
    <div className="acm-section acm-section-purple">
      <div className="acm-section-head">
        <div className="acm-section-head-row" style={{ width: '100%' }}>
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>
          <div>
            <span className="acm-section-title">ADDRESS &amp; CONTACT DETAILS</span>
            <span className="acm-section-sub">| All addresses with their authorized contact person</span>
          </div>
          <button type="button" className="acm-add-pill" onClick={onAdd}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add More Address &amp; Contact
          </button>
        </div>
      </div>
      <div className="acm-section-body acm-section-body-table">
        <div className="acm-table-wrap">
          <table className="acm-table">
            <thead>
              <tr>
                <th>Sr No</th><th>Address Type</th><th>Address</th><th>City / State / Country</th>
                <th>Contact Person</th><th>Phone</th><th>Email</th><th>WhatsApp</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((l, i) => {
                const place = [l.city, l.state, l.country].filter(Boolean).join(' • ');
                const contact = l.cpName + (l.cpDesignation ? ` (${l.cpDesignation})` : '');
                return (
                  <tr key={l.id} className={l.isPrimary ? 'acm-primary-row' : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="acm-type-cell">
                        {l.type
                          ? <TruncatedCell text={l.type} max={14} />
                          : <span>—</span>}
                        {l.isPrimary && <span className="acm-primary-tag">Primary</span>}
                      </div>
                    </td>
                    <td><TruncatedCell text={l.line} max={16} /></td>
                    <td><TruncatedCell text={place} max={18} /></td>
                    <td><TruncatedCell text={contact} max={18} /></td>
                    <td><TruncatedCell text={l.cpContact} max={15} mono /></td>
                    <td><TruncatedCell text={l.cpEmail} max={18} /></td>
                    <td>{l.cpWhatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : l.cpWhatsapp === 'no' ? <span className="acm-pill-no">✕ No</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td>
                      <div className="acm-row-actions">
                        <Tooltip label={l.isPrimary ? 'Edit in Customer Identification tab' : 'Edit'}>
                          <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => l.isPrimary ? onEditPrimary() : onEdit(l.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        </Tooltip>
                        {l.isPrimary ? (
                          <Tooltip label="The primary address cannot be deleted">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete (disabled)" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                            </button>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Delete">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDel(l.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


type SegRefUploadEntry = {
  file: File | null; url: string; name: string;
  issueDate?: string | null; expiryDate?: string | null;
};

function SegRefIssueDate({ value }: { value?: string | null }) {
  return value
    ? <span className="acm-issue-date">{value}</span>
    : <span className="acm-expiry-na">N/A</span>;
}

function SegRefExpiryDate({ value }: { value?: string | null }) {
  if (!value) return <span className="acm-expiry-na">N/A</span>;
  const due = new Date(value);
  const days = Number.isNaN(due.getTime()) ? null : Math.ceil((due.getTime() - Date.now()) / 86400000);
  const cls = days === null ? 'acm-expiry-future'
    : days < 0 ? 'acm-expiry-past'
    : days <= 30 ? 'acm-expiry-soon'
    : 'acm-expiry-future';
  const chip = <span className={cls}>{value}</span>;
  if (days === null) return chip;
  return <Tooltip label={days < 0 ? `Expired ${Math.abs(days)} day(s) ago` : `Expires in ${days} day(s)`}>{chip}</Tooltip>;
}

function SegmentRefRowActions({ refKey, docName, docCode, authority, expiry, category, uploads, setUploads, persistUpload }: {
  refKey: string;
  docName: string;
  docCode: string;
  authority?: string | null;
  expiry?: string | null;
  category: 'kyc' | 'dd' | 'tl';
  uploads: Record<string, SegRefUploadEntry>;
  setUploads: React.Dispatch<React.SetStateAction<Record<string, SegRefUploadEntry>>>;
  persistUpload: (refKey: string, file: File, docName: string, opts?: { issueDate?: string; expiryDate?: string }) => Promise<void> | void;
}) {
  const toast = useToast();
  const uploaded = uploads[refKey];
  const [uploadOpen, setUploadOpen] = useState(false);
  const onPick = (f: File | undefined, opts?: { issueDate?: string; expiryDate?: string }): boolean => {
    if (!f) return false;
    const err = validateUpload(f, 'doc');
    if (err) {
      toast.error('File rejected', err);
      return false;
    }
    setUploads(prev => {
      const existing = prev[refKey];
      if (existing?.url && existing.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing.url); } catch {}
      }
      return { ...prev, [refKey]: {
        file: f, url: URL.createObjectURL(f), name: f.name,
        issueDate: opts?.issueDate ?? null, expiryDate: opts?.expiryDate ?? null,
      } };
    });
    void persistUpload(refKey, f, docName, opts);
    return true;
  };


  const popup = uploadOpen ? (
    <VaultUploadPopup
      doc={{
        id: 0,
        name: docName,
        reference: docCode,
        doc_code: docCode,
        authority: authority ?? null,
        expiry: expiry ?? null,
        attachment: uploaded?.name ?? null,
        attachment_url: uploaded?.url ?? null,
        status: (uploaded ? 'Verified' : 'Pending') as VaultStatus,
      }}
      category={category}
      busy={false}
      onClose={() => setUploadOpen(false)}
      onSubmit={(f, opts) => { if (onPick(f, opts)) setUploadOpen(false); }}
    />
  ) : null;

  if (!uploaded) {
    return (
      <div className="acm-row-actions">
        {popup}
        <Tooltip label="Upload">
          <button type="button" className="acm-doc-action acm-doc-action-upload" aria-label="Upload" onClick={() => setUploadOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="acm-row-actions">
      {popup}
      <Tooltip label={`View ${uploaded.name}`}>
        <a href={uploaded.url} target="_blank" rel="noreferrer" className="acm-doc-action acm-doc-action-view" aria-label="View">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={`Download ${uploaded.name}`}>
        <a href={uploaded.url} onClick={e => { e.preventDefault(); void downloadFile(uploaded.url, uploaded.name); }} className="acm-doc-action acm-doc-action-download" aria-label="Download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label="Re-upload (replace file)">
        <button type="button" className="acm-doc-action acm-doc-action-upload" aria-label="Re-upload" onClick={() => setUploadOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </Tooltip>
    </div>
  );
}

function Stage2KYC({ sub, setSub, page, setPage, search, setSearch,  docs, owners, loading,  segmentDocs, segmentRefUploads, setSegmentRefUploads, persistSegmentRefUpload,  onEditDoc, onDeleteDoc, onEditOwner, onDeleteOwner }:
  { sub: KycSubTab; setSub: (s: KycSubTab) => void;
    page: Record<KycSubTab, number>; setPage: (s: KycSubTab, p: number) => void;
    search: string; setSearch: (s: string) => void;
    onAdd: (s: KycSubTab) => void;
    loading?: boolean;
    docs: { id:number; kind:'dd'|'tl'; name:string; license_number?:string|null; issuing_authority?:string|null; issue_date?:string|null; expiry_date?:string|null; attachment_path?:string|null; attachment_url?:string|null; attachment_name?:string|null; status?:string }[];
    owners: { id:number; owner_name:string; designation?:string|null; official_email?:string|null; phone_number?:string|null; id_proof_path?:string|null; id_proof_url?:string|null; address_proof_path?:string|null; address_proof_url?:string|null; photograph_path?:string|null; photograph_url?:string|null; status?:string }[];
    segmentName: string;
    segmentDocs: { kyc:{ id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' }[]; dd:any[]; tl:any[]; td:any[]; qc:any[] };
    segmentRefUploads: Record<string, SegRefUploadEntry>;
    setSegmentRefUploads: React.Dispatch<React.SetStateAction<Record<string, SegRefUploadEntry>>>;
    persistSegmentRefUpload: (refKey: string, file: File, docName: string, opts?: { issueDate?: string; expiryDate?: string }) => Promise<void> | void;
    customerSaved: boolean;
    onEditDoc:     (id:number) => void;
    onDeleteDoc:   (id:number) => void;
    onEditOwner:   (id:number) => void;
    onDeleteOwner: (id:number) => void;
  }) {
  const meta = KYC_TAB_META[sub];

  const isOwners      = sub === 'owner-kyc';
  const isTradeLegacy = sub === 'trade-licence';
  const kind: 'dd' | 'tl' = sub === 'company-dd' ? 'dd' : 'tl';

  const q = search.toLowerCase().trim();
  const filteredDocs = useMemo(() => {
    const base = docs.filter(d => d.kind === kind);
    if (!q) return base;
    return base.filter(d =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.license_number || '').toLowerCase().includes(q) ||
      (d.issuing_authority || '').toLowerCase().includes(q));
  }, [docs, kind, q]);
  const filteredOwners = useMemo(() => {
    if (!q) return owners;
    return owners.filter(o =>
      (o.owner_name || '').toLowerCase().includes(q) ||
      (o.designation || '').toLowerCase().includes(q) ||
      (o.official_email || '').toLowerCase().includes(q));
  }, [owners, q]);
  const segmentRefSource = useMemo(() => {
    const norm = (rows: any[]) => rows.map(d => ({
      code:      d.code,
      name:      d.name,
      authority: d.authority ?? '—',
      expiry:    d.expiry ?? 'N/A',
      status:    d.requirement === 'M' ? 'mandatory' : 'optional',
    }));
    if (sub === 'company-dd')   return norm(segmentDocs.dd || []);
    if (sub === 'owner-kyc')    return norm(segmentDocs.kyc || []);
    if (sub === 'trade-licence') return norm(segmentDocs.tl || []);
    return [];
  }, [sub, segmentDocs]);
  const filteredTradeLegacy = useMemo(() => {
    if (!q) return segmentRefSource;
    return segmentRefSource.filter(d =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      (d.authority || '').toLowerCase().includes(q));
  }, [q, segmentRefSource]);
  const showSegmentRef =
       (isTradeLegacy            && filteredDocs.length === 0 && (segmentDocs.tl?.length ?? 0) > 0)
    || (sub === 'company-dd'     && filteredDocs.length === 0 && (segmentDocs.dd?.length ?? 0) > 0)
    || (sub === 'owner-kyc'      && owners.length === 0);

  const totalRows = showSegmentRef ? filteredTradeLegacy.length
                  : isOwners       ? filteredOwners.length
                  : filteredDocs.length;

  const [rpp, setRpp] = useState(KYC_PER_PAGE);
  const maxPage = Math.max(1, Math.ceil(totalRows / rpp));
  const curPage = Math.min(page[sub], maxPage);
  const start = (curPage - 1) * rpp;
  const docSlice    = filteredDocs.slice(start, start + rpp);
  const ownerSlice  = filteredOwners.slice(start, start + rpp);
  const legacySlice = filteredTradeLegacy.slice(start, start + rpp);

  const codeFor = (kindLetters: string, sr: number) => `${kindLetters}-${String(sr).padStart(3, '0')}`;

  return (
    <div className="acm-kyc-stage">
      <div className="acm-subtabs-row">
        <div className="dt-tabrail hr-dt" data-accent="violet">
          <div className="dt-tabs" role="tablist">
            {(['company-dd','owner-kyc','trade-licence'] as KycSubTab[]).map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sub === s}
                className={`dt-tab ${sub === s ? 'on' : 'off'}`}
                onClick={() => setSub(s)}
              >
                <i className={s === 'company-dd' ? 'ri-building-line' : s === 'owner-kyc' ? 'ri-user-star-line' : 'ri-file-shield-2-line'} />
                {s === 'company-dd' ? 'Company Due Diligence' : s === 'owner-kyc' ? 'Owner KYC' : 'Trade Licence'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width:'100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <span className="acm-section-title">{meta.title}</span>
              <span className="acm-section-sub">{meta.sub}</span>
            </div>
          </div>
        </div>

        <div className="acm-doc-toolbar">
          <div className="acm-doc-search ui-search-abs">
            <svg className="acm-doc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input autoComplete="off" type="search" placeholder={meta.placeholder} value={search} onChange={e => setSearch(e.target.value)} />
            <SearchClear show={search} onClear={() => { setSearch(''); }} />
          </div>
          <div className="acm-doc-count">{totalRows} {(!showSegmentRef && isOwners) ? `owner${totalRows === 1 ? '' : 's'}` : `document${totalRows === 1 ? '' : 's'}`}</div>
        </div>

        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            {loading ? (
              <table className="acm-table">
                <thead><tr>
                  {isOwners ? (
                    <>
                      <th>Sr No</th><th>Owner Name</th><th>Designation</th><th>Email</th><th>Phone</th>
                      <th>ID Proof</th><th>Address Proof</th><th>Photograph</th><th>Actions</th>
                    </>
                  ) : (
                    <>
                      <th>Sr No</th><th>Auto Code</th><th>Document Name</th>
                      <th>Issuing Authority</th><th>Requirement</th>
                      <th>Issued Date</th><th>Expired At</th><th>Actions</th>
                    </>
                  )}
                </tr></thead>
                <tbody><ShimmerTableRows rows={4} cols={isOwners ? 9 : 8} /></tbody>
              </table>
            ) : showSegmentRef ? (
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Auto Code</th><th>Document Name</th>
                  <th>Issuing Authority</th><th>Requirement</th>
                  <th>Issued Date</th><th>Expired At</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={8}>
                      {q
                        ? 'No reference documents match your search.'
                        : 'No standard documents are configured for this segment yet.'}
                    </td></tr>
                  ) : legacySlice.map((dl, i) => {
                    const sr = start + i + 1;
                    const srPad = String(sr).padStart(2, '0');
                    const up = segmentRefUploads[`${sub}::${dl.code}`];
                    return (
                      <tr key={dl.code}>
                        <td>{srPad}</td>
                        <td><span className="acm-doc-code">{dl.code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{(() => {
                          const v = dl.name || '';
                          const span = <span style={{ display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{v || '—'}</span>;
                          return v.length > 32 ? <Tooltip label={v}>{span}</Tooltip> : span;
                        })()}</td>
                        <td><AuthorityBadges value={dl.authority} variant="violet" /></td>
                        <td>
                          {dl.status === 'mandatory'
                            ? <span className="acm-badge acm-badge--mand">★ Mandatory</span>
                            : <span className="acm-badge acm-badge--opt">Optional</span>}
                        </td>
                        <td><SegRefIssueDate value={up?.issueDate} /></td>
                        <td><SegRefExpiryDate value={up?.expiryDate} /></td>
                        <td>
                          <SegmentRefRowActions
                            refKey={`${sub}::${dl.code}`}
                            docName={dl.name}
                            docCode={dl.code}
                            authority={dl.authority}
                            expiry={dl.expiry}
                            category={sub === 'owner-kyc' ? 'kyc' : sub === 'trade-licence' ? 'tl' : 'dd'}
                            uploads={segmentRefUploads}
                            setUploads={setSegmentRefUploads}
                            persistUpload={persistSegmentRefUpload}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : isOwners ? (
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Owner Name</th><th>Designation</th><th>Email</th><th>Phone</th>
                  <th>ID Proof</th><th>Address Proof</th><th>Photograph</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={9}>{q ? 'No owners match your search.' : 'No owners captured yet. Click "+ Add Owner KYC Document" to add one.'}</td></tr>
                  ) : ownerSlice.map((o, i) => (
                    <tr key={o.id}>
                      <td>{String(start + i + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{o.owner_name}</td>
                      <td>{o.designation || '—'}</td>
                      <td>{o.official_email || '—'}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{o.phone_number || '—'}</td>
                      <td><BustedLink url={o.id_proof_url}      path={o.id_proof_path} /></td>
                      <td><BustedLink url={o.address_proof_url} path={o.address_proof_path} /></td>
                      <td><BustedLink url={o.photograph_url}    path={o.photograph_path} /></td>
                      <td>
                        <div className="acm-row-actions">
                          <Tooltip label="Edit">
                            <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => onEditOwner(o.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDeleteOwner(o.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Auto Code</th><th>{meta.nameCol}</th><th>License</th>
                  <th>Issuing Authority</th><th>Issuing Date</th><th>Expiry</th><th>Attachment</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={9}>{q ? 'No documents match your search.' : 'No documents in this bucket yet.'}</td></tr>
                  ) : docSlice.map((d, i) => {
                    const sr = start + i + 1;
                    const code = codeFor(kind.toUpperCase(), sr);
                    const fmtMonthYear = (s?: string | null) =>
                      s ? (() => { const [y, m] = s.split('-'); return `${m}/${y}`; })() : 'N/A';
                    const expLabel = fmtMonthYear(d.expiry_date);
                    const issLabel = fmtMonthYear(d.issue_date);
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const expClass = !d.expiry_date ? 'acm-expiry-na'
                      : d.expiry_date < todayStr ? 'acm-expiry-past'
                      : 'acm-expiry-future';
                    const issClass = d.issue_date ? 'acm-issue-date' : 'acm-expiry-na';
                    return (
                      <tr key={d.id}>
                        <td>{String(sr).padStart(2, '0')}</td>
                        <td><span className="acm-doc-code">{code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{d.license_number || '—'}</td>
                        <td><AuthorityBadges value={d.issuing_authority} variant="violet" /></td>
                        <td><span className={issClass}>{issLabel}</span></td>
                        <td><span className={expClass}>{expLabel}</span></td>
                        <td><BustedLink url={d.attachment_url} path={d.attachment_path} /></td>
                        <td>
                          <div className="acm-row-actions">
                            <Tooltip label="Edit">
                              <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => onEditDoc(d.id)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDeleteDoc(d.id)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="acm-doc-pag-wrap">
            <WorklistPager
              total={totalRows}
              page={curPage}
              pageSize={rpp}
              onPage={(p) => setPage(sub, p)}
              onPageSize={(n) => { setRpp(n); setPage(sub, 1); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}



type TdSigStatus = 'idle' | 'inprogress' | 'completed' | 'declined' | 'recalled' | 'expired';
type TdDocRow = {
  id: string; db_id: number | null;
  name: string; selected: boolean; sent: boolean;
  status?: TdSigStatus;
  signature_request_id?: number;
  signed_url?: string;
  certificate_url?: string;
  cooldownActive?: boolean;
  reminder_count?: number;
  last_reminder_sent_at?: string | null;
};




function KycFileSlot({
  label, required, kind = 'doc', accept, value, existingUrl, existingName,
  removeExisting, error, fieldKey,
  onPick, onRemoveExisting, onRestoreExisting,
}: {
  label: string;
  required?: boolean;
  kind?: FileKind;
  accept: string;
  value: File | null;
  existingUrl?: string | null;
  existingName?: string | null;
  removeExisting: boolean;
  error?: string;
  fieldKey?: string;
  onPick: (file: File | null) => void;
  onRemoveExisting: () => void;
  onRestoreExisting: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setBlobUrl(null); return; }
    const url = URL.createObjectURL(value);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const hasNew      = !!value;
  const showExisting = !hasNew && !!existingUrl && !removeExisting;
  const showRemoved  = !hasNew && removeExisting && !!existingUrl;
  const hintText     = kind === 'photo'
    ? `JPG, JPEG, PNG — max ${MAX_UPLOAD_MB} MB`
    : `PDF, DOC, DOCX, JPG, PNG — max ${MAX_UPLOAD_MB} MB`;

  const handlePick = (f: File | null) => {
    if (!f) { onPick(null); return; }
    const err = validateUpload(f, kind);
    if (err) {
      toast.error('File rejected', err);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onPick(f);
  };

  const previewUrl = hasNew ? blobUrl : (showExisting ? existingUrl : null);
  const previewName = hasNew ? value!.name : existingName || 'attachment';
  const openPreview = () => {
    if (!previewUrl) return;
    let url = previewUrl;
    if (!hasNew) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}t=${Date.now()}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="acm-field" data-field={fieldKey}>
      <label>{label} {required && <span className="acm-req">*</span>}</label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={e => handlePick(e.target.files?.[0] ?? null)}
      />
      {hasNew || showExisting ? (
        <div className={`acm-fileslot-chip ${hasNew ? 'is-new' : 'is-existing'}`}>
          <div className="acm-fileslot-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <span className="acm-fileslot-name" title={previewName}>{previewName}</span>
          <div className="acm-fileslot-actions">
            <Tooltip label="Preview">
              <button
                type="button"
                className="acm-fileslot-btn acm-fileslot-btn-view"
                aria-label="Preview"
                disabled={!previewUrl}
                onClick={openPreview}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Replace">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Replace"
                onClick={() => inputRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Remove">
              <button
                type="button"
                className="acm-fileslot-btn acm-fileslot-btn-del"
                aria-label="Remove"
                onClick={() => {
                  if (hasNew) {
                    onPick(null);
                    if (inputRef.current) inputRef.current.value = '';
                  } else {
                    onRemoveExisting();
                  }
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </Tooltip>
          </div>
        </div>
      ) : showRemoved ? (
        <div className="acm-fileslot-removed">
          <span className="acm-fileslot-removed-text">Attachment will be removed on save</span>
          <div className="acm-fileslot-actions">
            <Tooltip label="Undo">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Undo"
                onClick={onRestoreExisting}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Pick a different file">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Replace"
                onClick={() => inputRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <Tooltip label={hintText}>
          <button type="button" className={`acm-fileslot-drop ${error ? 'acm-input-error' : ''}`} onClick={() => inputRef.current?.click()}>
            <span className="acm-fileslot-drop-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </span>
            <span className="acm-fileslot-drop-title">Click to upload</span>
            <span className="acm-fileslot-drop-size">max {MAX_UPLOAD_MB} MB</span>
          </button>
        </Tooltip>
      )}
      {error && <span className="acm-field-error" title={error}>{error}</span>}
    </div>
  );
}

type NewDoc = {
  name: string;
  license: string;
  authority: string;
  issueDate: string;
  expiryDate: string;
  attachment: File | null;
};
function DocumentSubModal({ sub, masters, customerId, editing, onClose, onSaved, onDocTypeAdded }:
  { sub: KycSubTab; masters: MasterLists; customerId: number | null;
    editing?: { id: number; name: string; license_number?: string | null; issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null; attachment_name?: string | null; attachment_url?: string | null; attachment_path?: string | null } | null;
    onClose: () => void;
    onSaved: (row: any) => void;
    onDocTypeAdded: (opt: MasterOpt) => void }) {
  const toast = useToast();
  const [d, setD] = useState<NewDoc>(() => editing ? {
    name:       editing.name             ?? '',
    license:    editing.license_number   ?? '',
    authority:  editing.issuing_authority ?? '',
    issueDate:  editing.issue_date       ?? '',
    expiryDate: editing.expiry_date      ?? '',
    attachment: null,
  } : { name: '', license: '', authority: '', issueDate: '', expiryDate: '', attachment: null });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [typeModal, setTypeModal] = useState(false);
  const set = <K extends keyof NewDoc>(k: K, v: NewDoc[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const docOptions = (() => {
    const base = masters.documentTypes.map(x => ({ value: x.name, label: x.name }));
    if (d.name && !base.some(o => o.value === d.name)) {
      return [{ value: d.name, label: d.name }, ...base];
    }
    return base;
  })();
  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!d.name.trim())      next.name      = 'Document name is required';
    if (!d.license.trim())   next.license   = 'License number is required';
    else if (d.license.trim().length > 25) next.license = 'License number must be 25 characters or fewer';
    if (!d.authority.trim()) next.authority = 'Issuing authority is required';
    if (!d.issueDate)        next.issueDate = 'Issue date is required';
    else {
      const today = new Date().toISOString().slice(0, 10);
      if (d.issueDate > today) next.issueDate = 'Issue date cannot be in the future';
    }
    if (!d.expiryDate)       next.expiryDate = 'Expiry date is required';
    else {
      const today = new Date().toISOString().slice(0, 10);
      if (d.expiryDate < today) next.expiryDate = 'Expiry date cannot be in the past';
    }
    if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) {
      next.expiryDate = 'Expiry date must be on or after the issue date';
    }
    if (sub === 'company-dd') {
      const hasNew      = !!d.attachment;
      const hasExisting = !!editing?.attachment_url && !removeAttachment;
      if (!hasNew && !hasExisting) {
        next.attachment = 'Attachment is required for Company Due Diligence documents';
      }
    }
    setErrs(next);
    if (Object.keys(next).length > 0) return;

    if (!customerId) {
      toast.warning('Save customer first', 'Complete Stage 1 before adding KYC documents.');
      return;
    }

    const kind = sub === 'company-dd' ? 'dd' : 'tl';
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('name', d.name.trim());
    fd.append('license_number', d.license.trim());
    fd.append('issuing_authority', d.authority.trim());
    if (d.issueDate)  fd.append('issue_date',  d.issueDate);
    if (d.expiryDate) fd.append('expiry_date', d.expiryDate);
    if (d.attachment) {
      fd.append('attachment', d.attachment);
    } else if (removeAttachment && editing?.attachment_url) {
      fd.append('remove_attachment', '1');
    }
    fd.append('status', 'Active');

    setSaving(true);
    try {
      const url = editing
        ? `/customers/${customerId}/documents/${editing.id}`
        : `/customers/${customerId}/documents`;
      const { data } = await api.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data ?? data;
      onSaved(row);
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const map: Record<string, string> = {
          name: 'name', license_number: 'license', issuing_authority: 'authority',
          issue_date: 'issueDate', expiry_date: 'expiryDate', attachment: 'name',
        };
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const localKey = map[k] ?? k;
          next2[localKey] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the document. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit Document / License' : 'Add New Document / License'}</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-2">
            <Field label="Document / License Name" required error={errs.name}>
              <div className="acm-doc-name-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MasterSelect
                    value={d.name}
                    options={docOptions}
                    placeholder="Select Document / License"
                    invalid={!!errs.name}
                    onChange={v => set('name', v)}
                  />
                </div>
                <Tooltip label="Add new document type">
                  <button
                    type="button"
                    className="acm-doc-plus-btn"
                    aria-label="Add new document type"
                    onClick={() => setTypeModal(true)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </Tooltip>
              </div>
            </Field>
            <Field label="License Number" required error={errs.license}>
              <input className={errs.license ? 'acm-input-error' : ''} value={d.license} maxLength={25} onChange={e => set('license', e.target.value.slice(0, 25))} placeholder="Enter license number (max 25)" />
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Issuing Authority" required error={errs.authority}>
              <input className={errs.authority ? 'acm-input-error' : ''} value={d.authority} onChange={e => set('authority', e.target.value)} placeholder="Enter issuing authority" />
            </Field>
            <Field label="Issuing Date" required error={errs.issueDate}>
              <MasterDatePicker
                value={d.issueDate}
                maxDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.expiryDate && d.expiryDate < today ? d.expiryDate : today;
                })()}
                invalid={!!errs.issueDate}
                onChange={(v: string) => {
                  set('issueDate', v);
                  if (d.expiryDate && v && d.expiryDate < v) set('expiryDate', '');
                }}
                placeholder="DD/MM/YYYY"
              />
            </Field>
            <Field label="Expiry Date" required error={errs.expiryDate}>
              <MasterDatePicker
                value={d.expiryDate}
                minDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.issueDate && d.issueDate > today ? d.issueDate : today;
                })()}
                invalid={!!errs.expiryDate}
                onChange={(v: string) => set('expiryDate', v)}
                placeholder="DD/MM/YYYY"
              />
            </Field>
            <KycFileSlot
              label="Attachment"
              required={sub === 'company-dd'}
              kind="doc"
              accept=".pdf,.jpg,.jpeg,.png"
              value={d.attachment}
              existingUrl={editing?.attachment_url ?? null}
              existingName={editing?.attachment_name ?? null}
              removeExisting={removeAttachment}
              error={errs.attachment}
              fieldKey="attachment"
              onPick={(f) => {
                set('attachment', f);
                if (f) {
                  setRemoveAttachment(false);
                  setErrs(s => { const n = { ...s }; delete n.attachment; return n; });
                }
              }}
              onRemoveExisting={() => setRemoveAttachment(true)}
              onRestoreExisting={() => setRemoveAttachment(false)}
            />
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>

      {typeModal && (
        <AddDocumentTypeMasterModal
          onClose={() => setTypeModal(false)}
          onSaved={(opt) => {
            onDocTypeAdded(opt);
            set('name', opt.name);
            setTypeModal(false);
          }}
        />
      )}
    </div>
  );
}

function AddDocumentTypeMasterModal({ onClose, onSaved }:
  { onClose: () => void; onSaved: (opt: MasterOpt) => void }) {
  const toast = useToast();
  const [title, setTitle]               = useState('');
  const [applicableTo, setApplicableTo] = useState('');
  const [isMandatory, setIsMandatory]   = useState('');
  const [status, setStatus]             = useState('Active');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Document type name is required';
    if (!status)       next.status = 'Status is required';
    setErrs(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const { data } = await api.post('/master/document_type', {
        title:         title.trim(),
        applicable_to: applicableTo || null,
        is_mandatory:  isMandatory  || null,
        status,
      });
      const row = data?.data ?? data;
      onSaved({ id: Number(row?.id ?? 0), name: String(row?.title ?? title.trim()) });
      bustCustomerMasterBundle();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          next2[k] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the document type. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acm-sub-modal acm-doc-type-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card acm-doc-type-master-card">
        <div className="acm-sub-header acm-doc-sub-header acm-doc-type-master-head">
          <div className="acm-doc-type-master-head-left">
            <div className="acm-doc-type-master-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div>
              <div className="acm-sub-title acm-doc-sub-title" style={{ textAlign: 'left' }}>Add Document Type</div>
              <div className="acm-doc-type-master-sub">Fill in the details to register a new document type</div>
            </div>
          </div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body acm-doc-type-master-body">
          <div className="acm-row acm-row-1">
            <Field label="Document Type Name" required error={errs.title}>
              <input
                className={errs.title ? 'acm-input-error' : ''}
                value={title}
                onChange={e => { setTitle(e.target.value); if (errs.title) setErrs(p => { const n = { ...p }; delete n.title; return n; }); }}
                placeholder="e.g. GST Registration Certificate"
                autoFocus
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Applicable To" error={errs.applicable_to}>
              <MasterSelect
                value={applicableTo}
                options={[
                  { value: 'Customer', label: 'Customer' },
                  { value: 'Vendor',   label: 'Supplier' },
                  { value: 'Both',     label: 'Both' },
                  { value: 'Internal', label: 'Internal' },
                ]}
                placeholder="Select…"
                invalid={!!errs.applicable_to}
                onChange={v => setApplicableTo(v)}
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Is Mandatory" error={errs.is_mandatory}>
              <MasterSelect
                value={isMandatory}
                options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                placeholder="Select…"
                invalid={!!errs.is_mandatory}
                onChange={v => setIsMandatory(v)}
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Status" required error={errs.status}>
              <MasterSelect
                value={status}
                options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]}
                placeholder="Select…"
                invalid={!!errs.status}
                onChange={v => setStatus(v)}
              />
            </Field>
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer acm-doc-type-master-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>
            <span style={{ marginRight: 6 }}>×</span> Cancel
          </button>
          <button type="button" className="acm-btn-save acm-doc-save acm-doc-type-master-save" onClick={submit} disabled={saving}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>{saving ? 'Saving…' : 'Save Document Type'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

type NewOwnerDD = {
  ownerName:     string;
  designation:   string;
  officialEmail: string;
  phoneNumber:   string;
  idProof:       File | null;
  addressProof:  File | null;
  photograph:    File | null;
};
function OwnerDDSubModal({ masters, customerId, editing, onClose, onSaved }:
  { masters: MasterLists; customerId: number | null;
    editing?: { id: number; owner_name: string; designation?: string | null; official_email?: string | null; phone_number?: string | null; id_proof_path?: string | null; id_proof_url?: string | null; id_proof_name?: string | null; address_proof_path?: string | null; address_proof_url?: string | null; address_proof_name?: string | null; photograph_path?: string | null; photograph_url?: string | null; photograph_name?: string | null } | null;
    onClose: () => void;
    onSaved: (row: any) => void }) {
  const toast = useToast();
  const [d, setD] = useState<NewOwnerDD>(() => editing ? {
    ownerName:     editing.owner_name      ?? '',
    designation:   editing.designation     ?? '',
    officialEmail: editing.official_email  ?? '',
    phoneNumber:   editing.phone_number    ?? '',
    idProof: null, addressProof: null, photograph: null,
  } : {
    ownerName: '', designation: '', officialEmail: '', phoneNumber: '',
    idProof: null, addressProof: null, photograph: null,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removeIdProof,      setRemoveIdProof]      = useState(false);
  const [removeAddressProof, setRemoveAddressProof] = useState(false);
  const [removePhotograph,   setRemovePhotograph]   = useState(false);
  const set = <K extends keyof NewOwnerDD>(k: K, v: NewOwnerDD[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!d.ownerName.trim())                            next.ownerName    = 'Owner name is required';
    if (!d.designation)                                 next.designation  = 'Select a designation';
    if (!d.officialEmail.trim())                        next.officialEmail = 'Official email is required';
    else if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(d.officialEmail))   next.officialEmail = 'Enter a valid email';
    if (!d.phoneNumber.trim())                          next.phoneNumber  = 'Phone number is required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(d.phoneNumber)) next.phoneNumber = 'Phone must be 7–15 digits';
    const has = (file: File | null, existing: string | null | undefined, remove: boolean) =>
      !!file || (!!existing && !remove);
    if (!has(d.idProof,      editing?.id_proof_url,      removeIdProof))      next.idProof      = 'ID proof is required';
    if (!has(d.addressProof, editing?.address_proof_url, removeAddressProof)) next.addressProof = 'Address proof is required';
    if (!has(d.photograph,   editing?.photograph_url,    removePhotograph))   next.photograph   = 'Photograph is required';
    setErrs(next);
    if (Object.keys(next).length > 0) {
      return;
    }

    if (!customerId) {
      toast.warning('Save customer first', 'Complete Stage 1 before adding owner KYC.');
      return;
    }

    const fd = new FormData();
    fd.append('owner_name',     d.ownerName.trim());
    fd.append('designation',    d.designation);
    fd.append('official_email', d.officialEmail.trim());
    fd.append('phone_number',   d.phoneNumber.trim());
    if (d.idProof)           fd.append('id_proof',           d.idProof);
    else if (removeIdProof && editing?.id_proof_url) fd.append('remove_id_proof', '1');
    if (d.addressProof)      fd.append('address_proof',      d.addressProof);
    else if (removeAddressProof && editing?.address_proof_url) fd.append('remove_address_proof', '1');
    if (d.photograph)        fd.append('photograph',         d.photograph);
    else if (removePhotograph && editing?.photograph_url) fd.append('remove_photograph', '1');
    fd.append('status', 'Active');

    setSaving(true);
    try {
      const url = editing
        ? `/customers/${customerId}/owners/${editing.id}`
        : `/customers/${customerId}/owners`;
      const { data } = await api.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSaved(data?.data ?? data);
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const map: Record<string, string> = {
          owner_name: 'ownerName', designation: 'designation',
          official_email: 'officialEmail', phone_number: 'phoneNumber',
          id_proof: 'idProof', address_proof: 'addressProof', photograph: 'photograph',
        };
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const localKey = map[k] ?? k;
          next2[localKey] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the owner. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };
  const SLOT_META: Record<'idProof' | 'addressProof' | 'photograph', {
    label: string; kind: FileKind; accept: string;
    existingUrl: string | null | undefined; existingName: string | null | undefined;
    removeFlag: boolean; setRemoveFlag: (v: boolean) => void;
  }> = {
    idProof: {
      label: 'ID Proof', kind: 'doc',
      accept: '.pdf,.jpg,.jpeg,.png',
      existingUrl:  editing?.id_proof_url,
      existingName: editing?.id_proof_name,
      removeFlag:    removeIdProof,
      setRemoveFlag: setRemoveIdProof,
    },
    addressProof: {
      label: 'Address Proof', kind: 'doc',
      accept: '.pdf,.jpg,.jpeg,.png',
      existingUrl:  editing?.address_proof_url,
      existingName: editing?.address_proof_name,
      removeFlag:    removeAddressProof,
      setRemoveFlag: setRemoveAddressProof,
    },
    photograph: {
      label: 'Photograph', kind: 'photo',
      accept: '.jpg,.jpeg,.png',
      existingUrl:  editing?.photograph_url,
      existingName: editing?.photograph_name,
      removeFlag:    removePhotograph,
      setRemoveFlag: setRemovePhotograph,
    },
  };
  const slot = (field: 'idProof' | 'addressProof' | 'photograph') => {
    const m = SLOT_META[field];
    return (
      <KycFileSlot
        label={m.label}
        required
        kind={m.kind}
        accept={m.accept}
        value={d[field]}
        existingUrl={m.existingUrl ?? null}
        existingName={m.existingName ?? null}
        removeExisting={m.removeFlag}
        error={errs[field]}
        fieldKey={field}
        onPick={(f) => {
          set(field, f);
          if (f) {
            m.setRemoveFlag(false);
            setErrs(s => { const n = { ...s }; delete n[field]; return n; });
          }
        }}
        onRemoveExisting={() => m.setRemoveFlag(true)}
        onRestoreExisting={() => m.setRemoveFlag(false)}
      />
    );
  };
  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit Owner Due Diligence' : 'Add Owner Due Diligence'}</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-4">
            <Field label="Owner Name" required error={errs.ownerName}>
              <input className={errs.ownerName ? 'acm-input-error' : ''} value={d.ownerName} onChange={e => set('ownerName', e.target.value)} placeholder="Enter owner name" />
            </Field>
            <Field label="Designation" required error={errs.designation}>
              <MasterSelect value={d.designation} options={optsWith(masters.designations, d.designation)} placeholder="Select designation" invalid={!!errs.designation} onChange={v => set('designation', v)} />
            </Field>
            <Field label="Official Email" required error={errs.officialEmail}>
              <input className={errs.officialEmail ? 'acm-input-error' : ''} type="email" value={d.officialEmail} onChange={e => set('officialEmail', e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Phone Number" required error={errs.phoneNumber}>
              <input className={errs.phoneNumber ? 'acm-input-error' : ''} type="tel" value={d.phoneNumber} onChange={e => set('phoneNumber', e.target.value)} placeholder="7–15 digit number" />
            </Field>
          </div>
          <div className="acm-row acm-row-3">
            {slot('idProof')}
            {slot('addressProof')}
            {slot('photograph')}
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationSubModal({ editing, masters, disallowedTypes, existingEmails = [], existingPhones = [], primaryCountry, onClose, onSave }:
  { editing: LocationRow | null; masters: MasterLists; disallowedTypes?: string[];
    existingEmails?: string[];
    existingPhones?: string[];
    primaryCountry?: string;
    onClose: () => void; onSave: (rec: Omit<LocationRow, 'id'>) => void }) {
  const primaryDomestic = isDomesticCountry(primaryCountry);
  const primarySet = !!(primaryCountry ?? '').trim();
  const initialType = editing
    ? editing.type
    : (disallowedTypes?.includes(DEFAULT_ADDRESS_TYPE) ? '' : DEFAULT_ADDRESS_TYPE);
  const [d, setD] = useState<Omit<LocationRow, 'id'>>(() => editing ? { ...editing } : {
    type: initialType, line: '', country: primaryDomestic ? 'India' : '', state: '', city: '', pin: '',
    cpName: '', cpDesignation: '', cpContact: '', cpEmail: '', cpWhatsapp: 'yes' as 'yes' | 'no' | '',
  });
  const availableAddressTypes = useMemo(() => {
    if (!disallowedTypes || disallowedTypes.length === 0) return masters.addressTypes;
    return masters.addressTypes.filter(t => !disallowedTypes.includes(t.name) || t.name === d.type);
  }, [masters.addressTypes, disallowedTypes, d.type]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const locFieldRule = (k: string, dd: typeof d): string | null => {
    switch (k) {
      case 'type':
        if (!dd.type) return 'Select address type';
        return null;
      case 'line':
        if (!dd.line.trim()) return 'Address is required';
        if (dd.line.trim().length < 4) return 'Address must be at least 4 characters';
        if (dd.line.trim().length > 75) return 'Address must be 75 characters or fewer';
        if (!/[A-Za-z]/.test(dd.line)) return 'Address must contain at least one letter';
        return null;
      case 'country':
        if (!dd.country) return 'Select country';
        return null;
      case 'state':
        if (!dd.state) {
          return countryHasStates(masters, dd.country)
            ? 'Select state'
            : 'No states exist for this country yet — add them under Master → States first';
        }
        return null;
      case 'city':
        if (!dd.city.trim()) return 'City is required';
        if (dd.city.trim().length > 30) return 'City must be 30 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(dd.city.trim()))
          return 'City can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'pin':
        return pinError(dd.pin, dd.country) ?? null;
      case 'cpName':
        if (!dd.cpName.trim()) return 'Contact name required';
        return null;
      case 'cpDesignation':
        if (!dd.cpDesignation.trim()) return 'Designation required';
        return null;
      case 'cpContact':
        if (!dd.cpContact.trim()) return 'Phone required';
        if (isDomesticCountry(dd.country)) { if (!/^\d{10}$/.test(dd.cpContact)) return 'Enter a valid 10-digit mobile number'; }
        else if (!/^\+?[0-9\s-]{7,15}$/.test(dd.cpContact)) return 'Phone must be 7–15 digits';
        if (existingPhones.includes(dd.cpContact.trim()))
          return 'This phone number is already used by another address on this customer';
        return null;
      case 'cpEmail':
        if (!dd.cpEmail.trim()) return 'Email required';
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(dd.cpEmail)) return 'Enter a valid email';
        if (existingEmails.includes(dd.cpEmail.trim().toLowerCase()))
          return 'This email is already used by another address on this customer';
        return null;
      case 'cpWhatsapp':
        if (!dd.cpWhatsapp) return 'Select WhatsApp preference';
        return null;
    }
    return null;
  };
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    const nextD = { ...d, [k]: v } as typeof d;
    setD(nextD);
    const msg = locFieldRule(k as string, nextD);
    setErrs(prev => {
      const next = { ...prev };
      if (msg) next[k as string] = msg;
      else delete next[k as string];
      return next;
    });
  };
  useEffect(() => {
    const phone = (d.cpContact || '').trim();
    const email = (d.cpEmail   || '').trim().toLowerCase();
    setErrs(prev => {
      const next = { ...prev };
      if (phone && existingPhones.includes(phone)) {
        next.cpContact = 'This phone number is already used by another address on this customer';
      } else if (next.cpContact === 'This phone number is already used by another address on this customer') {
        delete next.cpContact;
      }
      if (email && existingEmails.includes(email)) {
        next.cpEmail = 'This email is already used by another address on this customer';
      } else if (next.cpEmail === 'This email is already used by another address on this customer') {
        delete next.cpEmail;
      }
      return next;
    });
  }, [d.cpContact, d.cpEmail, existingPhones, existingEmails]);
  const selectedCountry = masters.countries.find(c => c.name === d.country);
  const states = selectedCountry
    ? masters.states.filter(s => s.country_id === selectedCountry.id)
    : [];
  const locHasStates = countryHasStates(masters, d.country);
  const submit = () => {
    const next: Record<string, string> = {};
    const keys = ['type','line','country','state','city','pin','cpName','cpDesignation','cpContact','cpEmail','cpWhatsapp'];
    for (const k of keys) {
      const msg = locFieldRule(k, d);
      if (msg) next[k] = msg;
    }
    setErrs(next);
    if (Object.keys(next).length === 0) { onSave(d); return; }
  };
  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit' : 'Add New'} Location &amp; Contact</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required error={errs.type}>
              <MasterSelect value={d.type} options={optsWith(availableAddressTypes, d.type)} placeholder="Select address type" invalid={!!errs.type} onChange={v => set('type', v)} />
            </Field>
            <Field label="Address" required error={errs.line}><input className={errs.line ? 'acm-input-error' : ''} value={d.line} onChange={e => set('line', e.target.value)} placeholder="Enter complete address" maxLength={75} /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required error={errs.country}>
              <MasterSelect
                value={d.country}
                options={
                  primaryDomestic
                    ? masters.countries.filter(c => c.name === 'India').map(c => ({ value: c.name, label: c.name }))
                    : primarySet
                      ? optsWith(masters.countries.filter(c => c.name !== 'India'), d.country)
                      : optsWith(masters.countries, d.country)
                }
                disabled={primaryDomestic}
                placeholder={primaryDomestic ? 'India' : 'Select country'}
                invalid={!!errs.country}
                onChange={v => {
                  const nextTel = isDomesticCountry(v) ? (d.cpContact || '').replace(/\D/g, '').slice(0, 10) : d.cpContact;
                  const nd = { ...d, country: v, state: '', cpContact: nextTel } as typeof d;
                  setD(nd);
                  setErrs(prev => {
                    const next = { ...prev };
                    const c = locFieldRule('country', nd); if (c) next.country = c; else delete next.country;
                    const s = locFieldRule('state', nd);   if (s) next.state = s; else delete next.state;
                    return next;
                  });
                }} />
            </Field>
            <Field label="State" required error={errs.state}>
              <MasterSelect
                value={d.state}
                options={(() => {
                  const base = states.map(s => ({ value: s.name, label: s.name }));
                  if (d.state && !base.some(o => o.value === d.state)) return [{ value: d.state, label: d.state }, ...base];
                  return base;
                })()}
                placeholder={!d.country ? 'Select country first' : locHasStates ? 'Select state' : 'Add states in Master → States'}
                disabled={!d.country || !locHasStates}
                invalid={!!errs.state}
                onChange={v => set('state', v)}
              />
            </Field>
            <Field label="City" required error={errs.city}><input className={errs.city ? 'acm-input-error' : ''} value={d.city} onChange={e => set('city', e.target.value)} placeholder="Enter City" /></Field>
            <Field label={pinLabel(d.country)} required error={errs.pin}><input className={errs.pin ? 'acm-input-error' : ''} value={d.pin} onChange={e => set('pin', pinSanitize(e.target.value, d.country))} inputMode={isDomesticCountry(d.country) ? 'numeric' : 'text'} maxLength={pinMaxLen(d.country)} placeholder={pinPlaceholder(d.country)} /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required error={errs.cpName}><input className={errs.cpName ? 'acm-input-error' : ''} value={d.cpName} onChange={e => set('cpName', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required error={errs.cpDesignation}>
              <input
                className={`acm-input ${errs.cpDesignation ? 'acm-input-error' : ''}`}
                placeholder="e.g. Sales Manager"
                value={d.cpDesignation}
                onChange={e => set('cpDesignation', e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="Contact No" required error={errs.cpContact}>{isDomesticCountry(d.country) ? (
              <div className={`acm-phone-wrap${errs.cpContact ? ' acm-phone-invalid' : ''}`}>
                <span className="acm-phone-cc">+91</span>
                <input type="tel" inputMode="numeric" maxLength={10} value={d.cpContact} onChange={e => set('cpContact', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
              </div>
            ) : (
              <input className={errs.cpContact ? 'acm-input-error' : ''} type="tel" value={d.cpContact} onChange={e => set('cpContact', e.target.value)} placeholder="7–15 digit mobile" />
            )}</Field>
            <Field label="Email Id" required error={errs.cpEmail}><input className={errs.cpEmail ? 'acm-input-error' : ''} type="email" value={d.cpEmail} onChange={e => set('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled?" required error={errs.cpWhatsapp}>
              <div className="acm-radio-pills">
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'yes' ? 'is-active' : ''}`}><input type="radio" name="locWa" value="yes" checked={d.cpWhatsapp === 'yes'} onChange={() => set('cpWhatsapp', 'yes')} /> Yes</label>
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'no' ? 'is-active' : ''}`}><input type="radio" name="locWa" value="no" checked={d.cpWhatsapp === 'no'} onChange={() => set('cpWhatsapp', 'no')} /> No</label>
              </div>
            </Field>
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ReadInline({ label, value, span, node: rich, tip }: { label: string; value?: string | null; span?: number; node?: React.ReactNode; tip?: React.ReactNode }) {
  const v = (value ?? '').toString().trim();
  const node = (
    <div className="acm-hs-inline" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="acm-hs-inline-lbl">{label} :</span>
      <span className={`acm-hs-inline-val ${!v ? 'is-empty' : ''}`}>{v ? (rich ?? v) : '—'}</span>
    </div>
  );
  const tipLabel = <span style={{ fontWeight: 500 }}>{tip ? <>{label}: {tip}</> : `${label}: ${v}`}</span>;
  return v ? <Tooltip label={tipLabel}>{node}</Tooltip> : node;
}

function HistoryStage1({ form, locations, customerId, segments = [] }: { form: any; locations: LocationRow[]; customerId?: string; segments?: MasterOpt[] }) {
  const segItems = (form.coSeg ?? []).map((v: string) => segments.find(s => String(s.id) === String(v))).filter(Boolean) as MasterOpt[];
  const wa = form.cpWa === 'yes' ? 'Yes' : form.cpWa === 'no' ? 'No' : '';
  return (
    <div className="acm-hs-mirror">
      <div className="acm-hs-grid">
        <ReadInline label="Customer ID"               value={customerId} />
        <ReadInline label="Company Name"              value={form.coName} />
        <ReadInline label="Company Legal Name"        value={form.coLegal} />
        <ReadInline label="Customer Category"         value={form.coType} />

        <ReadInline label="Company Website"           value={form.coWeb} />
        <ReadInline label="Customer Segment"          value={segItems.map(s => (s.code ? `${s.code}: ${s.name}` : s.name)).join(', ')} node={<SegmentNameList compact items={segItems} />} tip={<SegmentNameList items={segItems} />} />
        <ReadInline label="Classification"            value={form.coClass} />
        <ReadInline label="Risk Level"                value={form.coRisk} />

        <ReadInline label="Registered Office Address" value={form.addr} span={2} />
        <ReadInline label="Country"                   value={form.country} />
        <ReadInline label="State"                     value={form.state} />

        <ReadInline label="City"                      value={form.city} />
        <ReadInline label={pinLabel(form.country)}         value={form.pin} />
        <ReadInline label="Contact Person Name"       value={form.cpName} />
        <ReadInline label="Designation"               value={form.cpDesig} />

        <ReadInline label="Contact No"                value={form.cpTel} />
        <ReadInline label="Email"                     value={form.cpEmail} />
        <ReadInline label="WhatsApp Enable"           value={wa} />
        {locations.length > 0 && (
          <ReadInline label="Additional Locations" value={`${locations.length} captured`} />
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children, error, fieldKey }: { label: string; required?: boolean; children: React.ReactNode; error?: string; fieldKey?: string }) {
  return (
    <div className="acm-field" data-field={fieldKey}>
      <label>{label} {required && <span className="acm-req">*</span>}</label>
      {children}
      {error && <span className="acm-field-error" title={error}>{error}</span>}
    </div>
  );
}

function BustedLink({ url, path, label = 'View', className = 'acm-attach-link' }:
  { url?: string | null; path?: string | null; label?: string; className?: string }) {
  const href = url || (path ? resolveFileUrl(path) : '');
  if (!href) return <span style={{ color: '#9ca3af' }}>—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        const sep = href.includes('?') ? '&' : '?';
        window.open(`${href}${sep}t=${Date.now()}`, '_blank', 'noopener,noreferrer');
      }}
    >
      {label}
    </a>
  );
}

function TruncatedCell({ text, max = 28, mono = false }: { text: string; max?: number; mono?: boolean }) {
  const t = (text ?? '').trim();
  if (!t) return <span style={{ color: '#9ca3af' }}>—</span>;
  const style: React.CSSProperties | undefined = mono
    ? { fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 11.5 }
    : undefined;
  if (t.length <= max) return <span style={style}>{t}</span>;
  return (
    <Tooltip label={t} maxWidth={320}>
      <span style={style}>{t.slice(0, max - 1)}…</span>
    </Tooltip>
  );
}

const SCOPED_CSS = `
@keyframes acm-cust-spin { to { transform: rotate(360deg); } }
.acm-cust-spin { animation: acm-cust-spin .9s linear infinite; transform-origin: 50% 50%; }
@keyframes acm-hydrate-slide {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes acmSlideUp { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

.acm-save-lock {
  position: absolute; inset: 0; z-index: 60;
  display: flex; flex-direction: column; gap: 12px;
  align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.62);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  cursor: progress;
}
.acm-save-lock-spinner {
  width: 40px; height: 40px; border-radius: 50%;
  border: 3.5px solid rgba(124, 58, 237, 0.22);
  border-top-color: #7c3aed;
  animation: acmSpin .7s linear infinite;
}
.acm-save-lock-text { font-size: 13px; font-weight: 700; color: #6d28d9; letter-spacing: .2px; }
@keyframes acmSpin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .acm-save-lock { background: rgba(11, 18, 32, 0.66); }
[data-bs-theme="dark"] .acm-save-lock-spinner { border-color: rgba(167, 139, 250, 0.22); border-top-color: #a78bfa; }
[data-bs-theme="dark"] .acm-save-lock-text { color: #c4b5fd; }

.acm-close {
  width: 34px; height: 34px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.12);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
  position: relative; z-index: 1;
}
.acm-close:hover { background: rgba(255,255,255,0.22); transform: rotate(90deg); }
@keyframes acmPillFade { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: none } }
.acm-loading-spinner {
  display: inline-flex; width: 12px; height: 12px;
  flex: 0 0 auto;
  animation: acmSpin .8s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .acm-loading-spinner { animation-duration: 2.4s; } }
@keyframes acmSpin { to { transform: rotate(360deg); } }

.acm-connector-line { width: 100%; height: 3px; background: #e2e8f0; border-radius: 3px; position: relative; overflow: hidden; }
.acm-connector-line::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #8b5cf6, #6d28d9); border-radius: 3px; transform: scaleX(0); transform-origin: left; transition: transform .5s cubic-bezier(.4,0,.2,1); }
.acm-connector-line[data-done="1"]::after { transform: scaleX(1); }
.acm-step-badge { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all .25s; }
.acm-step-num { position: absolute; bottom: -4px; right: -4px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; border: 2px solid #fff; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.acm-step-title { font-size: 12px; font-weight: 800; letter-spacing: -.2px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-sub { font-size: 9.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-active {     background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
    border: 3px solid #7c3aed;
    box-shadow: 0 6px 22px rgba(109, 40, 217, .22), 0 1px 0 rgba(255, 255, 255, .85) inset;}
.acm-step-active .acm-step-badge { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; box-shadow: 0 5px 14px rgba(109,40,217,.48); }
.acm-step-active .acm-step-num { background: linear-gradient(135deg, #6d28d9, #4c1d95); color: #fff; }
.acm-step-active .acm-step-title { color: #2e1065; }
.acm-step-active .acm-step-sub { color: #6d28d9; }
.acm-step-done { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #34d399; box-shadow: 0 6px 20px rgba(16,185,129,.18), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-done .acm-step-badge { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; box-shadow: 0 5px 12px rgba(22,163,74,.42); }
.acm-step-done .acm-step-num { background: #fff; color: #16a34a; box-shadow: 0 1px 3px rgba(22,163,74,.30); }
.acm-step-done .acm-step-title { color: #065f46; }
.acm-step-done .acm-step-sub { color: #059669; }
.acm-step-incomplete { background: #f8fafc; border: 2px solid #e2e8f0; box-shadow: 0 4px 14px rgba(100,116,139,.10), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-incomplete .acm-step-badge { background: linear-gradient(135deg, #e2e8f0, #cbd5e1); color: #64748b; }
.acm-step-incomplete .acm-step-num { background: #94a3b8; color: #fff; }
.acm-step-incomplete .acm-step-title { color: #475569; }
.acm-step-incomplete .acm-step-sub { color: #94a3b8; }
.acm-step-pending .acm-step-badge { background: linear-gradient(135deg, #f1f5f9, #e2e8f0); color: #94a3b8; border: 1px solid #e2e8f0; }
.acm-step-pending .acm-step-num { background: #e2e8f0; color: #94a3b8; }
.acm-step-pending .acm-step-title { color: #94a3b8; font-weight: 700; }
.acm-step-pending .acm-step-sub { color: #cbd5e1; }

.acm-tab { padding: 7px 18px; border-radius: 10px; border: 1.5px solid transparent; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-tab-on { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.acm-tab-off { background: #fff; color: #6d28d9; border-color: #c4b5fd; }
.acm-tab-off:hover { background: #ede9fe; border-color: #7c3aed; }

.acm-kyc-stage { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.acm-kyc-stage .acm-section-purple { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.acm-kyc-stage .acm-section-body-table { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.acm-kyc-stage .acm-section-body-table .acm-table-wrap { flex: 1 1 auto; min-height: 168px; }
@media (max-height: 820px) {
  .acm-kyc-stage,
  .acm-kyc-stage .acm-section-purple,
  .acm-kyc-stage .acm-section-body-table { flex: 0 0 auto; min-height: 0; }
  .acm-kyc-stage .acm-section-body-table .acm-table-wrap { flex: 0 0 auto; min-height: 0; max-height: 44vh; }
}
.acm-body::-webkit-scrollbar { width: 6px; }
.acm-body::-webkit-scrollbar-track { background: #ede9fe; border-radius: 10px; }
.acm-body::-webkit-scrollbar-thumb { background: #a78bfa; border-radius: 10px; }

.acm-section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: linear-gradient(135deg,#ede9fe,#ddd6fe); color: #7c3aed; border: 1px solid #c4b5fd; }
.acm-section-title { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #5b21b6; }
.acm-section-sub { font-size: 11px; color: #9ca3af; font-weight: 500; display: inline-block; margin-left: 6px; }
.acm-section-body-table { padding: 0 !important; }
.acm-section-head-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
.acm-section-head-row > div:nth-child(2) { flex: 1; min-width: 0; }

.acm-field label { font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
.acm-req { color: #ef4444; font-weight: 700; }
.acm-field input, .acm-field select, .acm-field textarea {
  width: 100%; padding: 9px 12px; border: 1.5px solid #e0d9f7; border-radius: 9px;
  font-family: inherit; font-size: 12px; color: #3b0764;
  background: #fff; outline: none; transition: border-color .18s, box-shadow .18s, background .18s;
  appearance: auto; box-sizing: border-box;
}
.acm-field input:focus, .acm-field select:focus, .acm-field textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3.5px rgba(124,58,237,.14); }
.acm-field input::placeholder { color: #c4b5fd; font-size: 11.5px; }
.acm-phone-wrap { display: flex; align-items: stretch; border: 1.5px solid #e0d9f7; border-radius: 9px; background: #fff; overflow: hidden; transition: border-color .18s, box-shadow .18s; }
.acm-phone-wrap:focus-within { border-color: #7c3aed; box-shadow: 0 0 0 3.5px rgba(124,58,237,.14); }
.acm-phone-wrap.acm-phone-invalid { border-color: #ef4444; background: #fef2f2; }
.acm-phone-cc { display: flex; align-items: center; padding: 0 11px; background: #f5f3ff; color: #3b0764; font-size: 12px; font-weight: 700; border-right: 1.5px solid #e0d9f7; flex-shrink: 0; }
.acm-phone-wrap input { border: none !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important; }
[data-bs-theme="dark"] .acm-phone-wrap { background: #131c33; border-color: rgba(167,139,250,0.50); }
[data-bs-theme="dark"] .acm-phone-cc { background: #1c2540; color: #e2e8f0; border-right-color: rgba(167,139,250,0.35); }
.acm-field input.acm-input-error { border-color: #ef4444; background: #fef2f2; }
.acm-field input.acm-input-error:focus { box-shadow: 0 0 0 3.5px rgba(239,68,68,.15); }
.acm-field-error { color: #ef4444; font-size: 10.5px; font-weight: 600; margin-top: 4px; letter-spacing: .02em; }

.acm-row .acm-field > .acm-field-error,
.acm-row .acm-field > .acm-field-note {
  line-height: 1.35;
}

.acm-field-note { display: block; color: #94a3b8; font-size: 10.5px; font-weight: 600; margin-top: 4px; letter-spacing: .02em; cursor: help; }
[data-bs-theme="dark"] .acm-field-note { color: #94a3b8; }

.acm-field input.acm-input-ok { border-color: #10b981; background: #f0fdf4; }
.acm-field input.acm-input-ok:focus { box-shadow: 0 0 0 3.5px rgba(16,185,129,.15); }
.acm-gst-hint { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; margin-top: 4px; letter-spacing: .02em; }
.acm-gst-ok { color: #059669; }
.acm-gst-checking { color: #94a3b8; }
.acm-gst-taken { color: #ef4444; }
[data-bs-theme="dark"] .acm-field input.acm-input-ok { border-color: rgba(16,185,129,.55); background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .acm-gst-ok { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-gst-checking { color: #94a3b8; }
[data-bs-theme="dark"] .acm-gst-taken { color: #fca5a5; }

.acm-hs-mirror { padding: 14px 18px 16px; }
.acm-hs-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 28px;
  row-gap: 13px;
}
.acm-hs-inline {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; min-width: 0;
  cursor: default; padding: 1px 2px; border-radius: 4px;
  transition: background .12s;
}
.acm-hs-inline:hover { background: rgba(124,58,237,0.06); }
.acm-hs-inline-lbl {
  color: #64748b; font-weight: 500;
  letter-spacing: .01em; white-space: nowrap; flex-shrink: 0;
}
.acm-hs-inline-val {
  color: #6d28d9; font-weight: 500;
  line-height: 1.4; min-width: 0; flex: 1 1 auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acm-hs-inline-val.is-empty { color: #cbd5e1; font-weight: 500; }

[data-bs-theme="dark"] .acm-hs-inline:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .acm-hs-inline-lbl { color: #94a3b8; }
[data-bs-theme="dark"] .acm-hs-inline-val { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-hs-inline-val.is-empty { color: #475569; }

@media (max-width: 900px) {
  .acm-hs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.acm-radio-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; }
.acm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #6b7280; cursor: pointer; letter-spacing: .04em; user-select: none; }
.acm-radio input[type="radio"] { accent-color: #7c3aed; width: 14px; height: 14px; cursor: pointer; }

.acm-footer {
  padding: 14px 22px; border-top: 1px solid rgba(167,139,250,.35);
  background: linear-gradient(180deg, rgba(255,255,255,.6) 0%, rgba(237,233,254,.92) 100%);
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0;
}
.acm-req-note { font-size: 11.5px; color: #6d28d9; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; }
.acm-req-dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg,#a78bfa,#7c3aed); box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
.acm-req-star { color: #ef4444; font-weight: 700; }
.acm-footer-actions { display: inline-flex; align-items: center; gap: 10px; }
.acm-btn-prev, .acm-btn-next {
  padding: 9px 22px; border-radius: 10px; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all .22s;
  letter-spacing: .02em;
}
.acm-btn-prev { border: 1.5px solid rgba(124,58,237,.3); background: rgba(255,255,255,.92); color: #5b21b6; box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 2px 6px rgba(124,58,237,.08); }
.acm-btn-prev:hover { background: #fff; border-color: #7c3aed; color: #4c1d95; transform: translateY(-1px); }
.acm-btn-next { border: none; background: linear-gradient(135deg,#8b5cf6 0%,#7c3aed 45%,#6d28d9 100%); color: #fff; box-shadow: 0 6px 18px -4px rgba(109,40,217,.55), 0 2px 4px rgba(76,29,149,.25), inset 0 1px 0 rgba(255,255,255,.28); }
.acm-btn-next:hover { transform: translateY(-1.5px); box-shadow: 0 10px 24px -4px rgba(109,40,217,.65); }

.acm-subtabs-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.acm-subtabs-row .dt-tabrail .dt-tab { height: 38px; }
.acm-nested-tab { padding: 7px 18px; border-radius: 10px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-nested-tab:hover:not(.is-active) { background: #ede9fe; }
.acm-nested-tab.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
[data-bs-theme="dark"] .acm-nested-tab { background: transparent; color: #c4b5fd; border: 1.5px solid rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-nested-tab:hover:not(.is-active) { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .acm-nested-tab.is-active { background: linear-gradient(135deg,#6d28d9,#4c1d95); color: #fff; border-color: #7c3aed; }

.acm-doc-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: linear-gradient(180deg, #faf7ff, #f5efff); border-bottom: 1px solid #ede9fe; }
.acm-doc-search { position: relative; flex: 1; max-width: 340px; min-width: 200px; }
.acm-doc-search input { width: 100%; padding: 8px 14px 8px 36px !important; border: 1.5px solid #e0d9f7 !important; border-radius: 22px !important; font-size: 12px !important; background: #fff !important; font-family: inherit; color: #3b0764; outline: none; box-sizing: border-box; }
.acm-doc-search input:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important; }
.acm-doc-search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #a78bfa; pointer-events: none; }
.acm-doc-count { font-size: 11.5px; color: #6d28d9; font-weight: 700; white-space: nowrap; letter-spacing: .02em; }

.acm-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 380px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #a78bfa #ede9fe;
}
.acm-table-wrap::-webkit-scrollbar { height: 8px; width: 8px; }
.acm-table-wrap::-webkit-scrollbar-track { background: #ede9fe; border-radius: 999px; }
.acm-table-wrap::-webkit-scrollbar-thumb { background: #a78bfa; border-radius: 999px; }
.acm-table-wrap::-webkit-scrollbar-thumb:hover { background: #7c3aed; }
.acm-table-wrap::-webkit-scrollbar-corner { background: #ede9fe; }
.acm-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; min-width: 900px; font-family: var(--font-sans); }
.acm-table thead tr { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-table thead th {
  position: sticky;
  top: 0;
  z-index: 5;
  background: linear-gradient(180deg, #faf7ff, #f5efff);
  padding: 14px 16px;
  text-align: left;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: .07em;
  color: #5b21b6;
  text-transform: uppercase;
  box-shadow: inset 0 -1.5px 0 0 #e9d5ff;
  white-space: nowrap;
}
.acm-table tbody td {
  padding: 14px 16px;
  border-bottom: 1px solid #f5f3ff;
  color: #1f2937;
  vertical-align: middle;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.45;
}
.acm-table tbody td:not(:last-child) *:not(i):not(svg):not(svg *):not(.seg-reg-badge) {
  font-size: 11.5px;
  font-weight: 500;
}
.acm-table tbody td:not(:last-child) .acm-doc-code.acm-doc-code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
}
.master-select-menu.acm-seg-menu .master-select-item { font-family: var(--font-sans); font-weight: 500; }
.master-select-menu.acm-seg-menu .master-select-item.active { font-weight: 500; }
.acm-table tbody tr:last-child td { border-bottom: none; }
.acm-table tbody tr:hover td { background: #faf7ff; }
.acm-empty-row td { text-align: center; color: #9ca3af; padding: 26px 14px !important; font-size: 11.5px; font-style: italic; background: #fafaff; }
.acm-empty-row strong { color: #6d28d9; font-style: normal; }

.acm-doc-code {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 7px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  color: #5b21b6;
  font-family: ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11.5px;
  font-weight: 700;
  border: 1px solid #c4b5fd;
  letter-spacing: .02em;
  white-space: nowrap;
}
.acm-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid transparent; white-space:nowrap; }
.acm-badge--mand   { background:#dcfce7; color:#15803d; border-color:#86efac; }
.acm-badge--opt    { background:#f3f4f6; color:#4b5563; border-color:#e5e7eb; }
.acm-badge--done   { background:#d1fae5; color:#065f46; border-color:#6ee7b7; }
.acm-badge--miss-m { background:#fee2e2; color:#b91c1c; border-color:#fecaca; }
.acm-badge--miss-o { background:#f3f4f6; color:#6b7280; border-color:#e5e7eb; }
[data-bs-theme="dark"] .acm-badge--mand   { background:rgba(16,185,129,0.18); color:#6ee7b7; border-color:rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-badge--opt    { background:rgba(255,255,255,0.06); color:#cbd5e1; border-color:rgba(255,255,255,0.14); }
[data-bs-theme="dark"] .acm-badge--done   { background:rgba(16,185,129,0.18); color:#6ee7b7; border-color:rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-badge--miss-m { background:rgba(239,68,68,0.18); color:#fca5a5; border-color:rgba(239,68,68,0.40); }
[data-bs-theme="dark"] .acm-badge--miss-o { background:rgba(255,255,255,0.06); color:#94a3b8; border-color:rgba(255,255,255,0.12); }
.acm-expiry-na, .acm-expiry-future, .acm-expiry-past, .acm-expiry-soon, .acm-issue-date {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: .02em;
}
.acm-expiry-na     { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.acm-issue-date    { background: linear-gradient(135deg,#e0e7ff,#c7d2fe); color: #3730a3; border: 1px solid #a5b4fc; }
.acm-expiry-future { background: linear-gradient(135deg,#d1fae5,#a7f3d0); color: #047857; border: 1px solid #6ee7b7; }
.acm-expiry-past   { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }
.acm-expiry-soon   { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #92400e; border: 1px solid #fcd34d; }

.acm-row-actions { display: inline-flex; gap: 4px; }
.acm-row-btn { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #e0d9f7; background: #fff; color: #7c3aed; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.acm-row-btn:hover { background: #ede9fe; border-color: #c4b5fd; }
.acm-row-btn-del { color: #ef4444; }
.acm-row-btn-del:hover { background: #fee2e2; border-color: #fca5a5; }
.acm-doc-action { width: 28px; height: 28px; border-radius: 7px; border: 1.5px solid; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: all .15s; }
.acm-doc-action-upload { border-color: #bae6fd; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); color: #0284c7; }
.acm-doc-action-upload:hover { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; border-color: #0284c7; }
.acm-doc-action-download { border-color: #bbf7d0; background: linear-gradient(135deg, #f0fdf4, #dcfce7); color: #16a34a; }
.acm-doc-action-download:hover { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: #16a34a; }
.acm-doc-action-view { border-color: #c4b5fd; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #6d28d9; }
.acm-doc-action-view:hover { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; }

.acm-pill-yes, .acm-pill-no { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
.acm-pill-yes { background: linear-gradient(135deg,#dcfce7,#bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-pill-no { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }

.acm-primary-row td { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-primary-row:hover td { background: #f3edff; }
.acm-type-cell { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.acm-primary-tag { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; background: linear-gradient(135deg, #ede9fe, #ddd6fe); color: #5b21b6; border: 1px solid #c4b5fd; }

.acm-add-pill { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 20px; border: 1px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .18s; white-space: nowrap; box-shadow: 0 2px 6px rgba(109,40,217,.1); flex-shrink: 0; }
.acm-add-pill:hover { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; transform: translateY(-1px); }

.acm-header-right { display: flex; align-items: center; gap: 8px; position: relative; z-index: 1; flex-shrink: 0; }
.acm-gst-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.55); background: rgba(255,255,255,0.18); color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all .18s; white-space: nowrap; position: relative; z-index: 1; }
.acm-gst-btn:hover:not(.is-disabled) { background: rgba(255,255,255,0.30); transform: translateY(-1px); }
.acm-gst-btn.is-disabled { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.45); cursor: not-allowed; }
.acm-gst-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #fff; color: #6d28d9; font-size: 11px; font-weight: 800; }
.acm-gst-btn.is-disabled .acm-gst-count { background: rgba(255,255,255,0.45); color: #6d28d9; }

.acm-gst-overlay { position: fixed; inset: 0; background: rgba(17,12,40,0.55); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 1200; padding: 24px; }
.acm-gst-card { width: min(920px, 96vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--vz-card-bg, #fff); border: 0.5px solid #fff; border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,0.35); overflow: hidden; }
.acm-gst-head { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 22px; background: linear-gradient(115deg, #4c1d95 0%, #5b21b6 30%, #6d28d9 60%, #7c3aed 82%, #8b5cf6 100%); color: #fff; border-top-left-radius: 16px; border-top-right-radius: 16px; }
.acm-gst-head::before { content: ''; position: absolute; inset: 0; opacity: .35; pointer-events: none; background-image: radial-gradient(rgba(255,255,255,.16) 1px, transparent 1px); background-size: 16px 16px; }
.acm-gst-head-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; }
.acm-gst-head-icon { width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(255,255,255,.3), rgba(255,255,255,.12)); border: 1px solid rgba(255,255,255,.38); box-shadow: 0 5px 14px rgba(0,0,0,.18), 0 1px 0 rgba(255,255,255,.4) inset; }
.acm-gst-title { font-size: 16px; font-weight: 800; letter-spacing: -0.2px; line-height: 1.1; }
.acm-gst-sub { font-size: 11px; font-weight: 500; color: rgba(255,255,255,.82); text-shadow: none; line-height: 1.2; margin-top: 1px; }
.acm-gst-head-actions { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; }
.acm-gst-head-actions .acm-add-pill { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.55); color: #fff; box-shadow: none; }
.acm-gst-head-actions .acm-add-pill:hover { background: #fff; color: #6d28d9; border-color: #fff; }
.acm-gst-body { padding: 20px 22px 22px; overflow-y: auto; }
.acm-gst-form { padding: 0; margin: 0; }
.acm-gst-form-card .acm-gst-form .acm-row-2 { grid-template-columns: repeat(3, 1fr); }
.acm-gst-form-card .acm-gst-form .acm-row-2 > .acm-field:last-child { grid-column: span 2; }
@media (max-width: 900px) {
  .acm-gst-form-card .acm-gst-form .acm-row-2 { grid-template-columns: repeat(2, 1fr); }
  .acm-gst-form-card .acm-gst-form .acm-row-2 > .acm-field:last-child { grid-column: auto; }
}
@media (max-width: 680px) {
  .acm-gst-form-card .acm-gst-form .acm-row-2 { grid-template-columns: 1fr; }
}
.acm-gst-form-card .acm-gst-form .acm-field label { white-space: nowrap; }
.acm-gst-form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 18px; }
.acm-gst-card .acm-field input.acm-input-error { background: #fff; }
.acm-btn-ghost { padding: 8px 18px; border-radius: 9px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.acm-btn-ghost:hover:not(:disabled) { background: #ede9fe; }
.acm-btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 18px; border-radius: 9px; border: none; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.acm-btn-primary:disabled, .acm-btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
.acm-gst-table-wrap { border: 1px solid #ece9f6; border-radius: 12px; overflow: hidden; }
.acm-gst-table-wrap .wl-pager { margin-top: 0; border-radius: 0; }
.acm-gst-table { width: 100%; border-collapse: collapse; }
.acm-gst-table thead tr { background: transparent; }
.acm-gst-table th { text-align: left; padding: 10px 12px; white-space: nowrap; }
.acm-gst-table td { padding: 9px 12px; }
.acm-gst-table td .acm-gst-status { font-size: 11.5px; font-weight: 500; }
.acm-gst-table th:first-child, .acm-gst-table td:first-child { padding-left: 16px; }
.acm-gst-table th:last-child, .acm-gst-table td:last-child { padding-right: 16px; }
.acm-gst-srno-col { width: 64px; }
.acm-gst-empty { text-align: center; color: #9ca3af; padding: 26px 12px !important; white-space: normal !important; }
.acm-gst-status { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
.acm-gst-status-active { background: #dcfce7; color: #15803d; }
.acm-gst-status-inactive { background: #fee2e2; color: #b91c1c; }
.acm-gst-status-suspended { background: #fef3c7; color: #b45309; }
.acm-gst-status-cancelled { background: #fee2e2; color: #b91c1c; }

[data-bs-theme="dark"] .acm-gst-card { background: #0f1729; border-color: rgba(167,139,250,0.22); }
[data-bs-theme="dark"] .acm-gst-table-wrap { border-color: rgba(167,139,250,0.25); }
[data-bs-theme="dark"] .acm-gst-table thead tr { background: transparent; }
[data-bs-theme="dark"] .acm-gst-table td { color: #cbd5e1; border-top-color: rgba(167,139,250,0.15); }
[data-bs-theme="dark"] .acm-btn-ghost { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.40); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-btn-ghost:hover:not(:disabled) { background: rgba(167,139,250,0.22); border-color: rgba(167,139,250,0.55); color: #ddd6fe; }

.acm-doc-pag-wrap { display: block; padding: 0; border: 0; background: transparent; }
.acm-doc-pag-wrap .wl-pager { margin-top: 0; padding-left: 16px; padding-right: 16px; }

.acm-attach-link {
  display: inline-flex; align-items: center; gap: 5px;
  color: #7c3aed; font-family: inherit;
  font-size: 12px; font-weight: 700;
  cursor: pointer; background: none; border: none; padding: 0;
  text-decoration: none;
}
.acm-attach-link:hover { color: #5b21b6; text-decoration: underline; }

.acm-sub-modal { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(20,20,30,.45); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.acm-sub-card { width: 100%; max-width: 880px; max-height: calc(100vh - 36px); background: #fff; border: 1px solid #e9e6f5; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 56px -16px rgba(15,15,30,.32), 0 8px 24px rgba(15,15,30,.14); animation: acmSlideUp .3s cubic-bezier(.34,1.56,.64,1); }
.acm-sub-header { background: linear-gradient(110deg, #7c3aed 0%, #8b5cf6 60%, #a78bfa 100%); padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.acm-sub-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; }
.acm-sub-close { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.4); background: rgba(255,255,255,.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.acm-sub-close:hover { background: rgba(255,255,255,.32); transform: rotate(90deg); }
.acm-sub-body { flex: 1; padding: 20px 24px; overflow-y: auto; background: linear-gradient(180deg, #fff 0%, #fbfaff 100%); }
.acm-sub-footer { padding: 14px 22px; display: flex; justify-content: center; gap: 12px; border-top: 1px solid #efeaf9; background: #faf9fd; flex-shrink: 0; }
.acm-btn-save { padding: 7px 18px; border-radius: 9px; border: none; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 10px rgba(109,40,217,.35); }

.acm-doc-sub-card { max-width: 920px; border-radius: 18px; background: #fff !important; box-shadow: 0 24px 60px -16px rgba(15,15,30,.32), 0 8px 24px rgba(15,15,30,.14); }
.acm-doc-sub-header {
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 70%, #8b5cf6 100%) !important;
  border-bottom: none; padding: 16px 26px; justify-content: center; position: relative;
}
.acm-doc-sub-title { color: #fff; font-size: 17px; font-weight: 800; letter-spacing: -.2px; }
.acm-doc-sub-header .acm-sub-close {
  position: absolute; top: 50%; right: 18px; transform: translateY(-50%);
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,0.15) !important; border: 1px solid rgba(255,255,255,0.35) !important;
  color: #fff !important;
  z-index: 2;
}
.acm-doc-sub-header .acm-sub-close:hover { background: rgba(255,255,255,0.28) !important; transform: translateY(-50%) rotate(90deg); }
.acm-doc-sub-card .acm-sub-body { background: #fff !important; padding: 18px 26px 8px; }
.acm-doc-sub-footer { background: #fff !important; border-top: none; padding: 6px 22px 22px; }
.acm-doc-sub-footer .acm-btn-mini-cancel {
  background: #fff; border: 1.5px solid #c4b5fd; color: #7c3aed;
  padding: 9px 22px; border-radius: 9px; font-weight: 700; font-size: 12px; cursor: pointer;
}
.acm-doc-sub-footer .acm-btn-mini-cancel:hover { background: #faf5ff; }
.acm-doc-save {
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 70%, #8b5cf6 100%) !important;
  box-shadow: 0 4px 12px rgba(109,40,217,.35);
  padding: 9px 44px !important; min-width: 120px; font-size: 12px !important;
}
.acm-doc-save:hover { filter: brightness(1.08); box-shadow: 0 6px 16px rgba(109,40,217,.45); }
.acm-doc-name-row { display: flex; align-items: stretch; gap: 8px; }
.acm-doc-plus-btn {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 9px;
  border: 1.5px solid #c4b5fd; background: #faf5ff; color: #7c3aed;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s;
}
.acm-doc-plus-btn:hover { background: #ede9fe; border-color: #7c3aed; }

.acm-fileslot-drop {
  display: inline-flex; align-items: center; gap: 8px;
  width: 100%; height: 40px;
  padding: 0 12px;
  border: 1.5px dashed #c4b5fd; border-radius: 10px;
  background: #faf7ff; color: #6d28d9;
  cursor: pointer; transition: all .18s;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
}
.acm-fileslot-drop:hover { border-color: #7c3aed; background: #ede9fe; }
.acm-fileslot-drop.acm-input-error { border-color: #ef4444; background: #fef2f2; }
.acm-fileslot-drop-icon { display: inline-flex; flex-shrink: 0; color: #7c3aed; }
.acm-fileslot-drop-title { font-size: 12px; font-weight: 700; color: #5b21b6; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.acm-fileslot-drop-size {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(124,58,237,0.10);
  color: #6d28d9;
  font-size: 10px; font-weight: 700;
  letter-spacing: .03em;
}

.acm-fileslot-chip {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 40px; padding: 6px 8px 6px 10px;
  border: 1.5px solid #e0d9f7; border-radius: 10px;
  background: #fff;
}
.acm-fileslot-chip.is-existing { border-color: #c4b5fd; background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-fileslot-chip.is-new      { border-color: #86efac; background: linear-gradient(180deg, #f0fdf4, #ecfdf5); }
.acm-fileslot-icon {
  width: 26px; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ede9fe; color: #6d28d9; flex-shrink: 0;
}
.acm-fileslot-chip.is-new .acm-fileslot-icon { background: #d1fae5; color: #047857; }
.acm-fileslot-name {
  flex: 1; min-width: 0;
  font-size: 11.5px; color: #3b0764; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acm-fileslot-actions { display: inline-flex; gap: 4px; flex-shrink: 0; }
.acm-fileslot-btn {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid #e0d9f7; background: #fff;
  color: #7c3aed; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; transition: all .15s;
}
.acm-fileslot-btn:hover:not(:disabled) { background: #ede9fe; border-color: #c4b5fd; }
.acm-fileslot-btn:disabled { opacity: .45; cursor: not-allowed; }
.acm-fileslot-btn-view { border-color: #c4b5fd; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #6d28d9; }
.acm-fileslot-btn-view:hover:not(:disabled) { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; border-color: #7c3aed; }
.acm-fileslot-btn-del { color: #ef4444; }
.acm-fileslot-btn-del:hover:not(:disabled) { background: #fee2e2; border-color: #fca5a5; }

.acm-fileslot-removed {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 40px; padding: 6px 8px 6px 12px;
  border: 1.5px dashed #fca5a5; border-radius: 10px;
  background: #fef2f2;
}
.acm-fileslot-removed-text { font-size: 11.5px; color: #b91c1c; font-weight: 600; }

[data-bs-theme="dark"] .acm-fileslot-drop { background: rgba(124,58,237,0.10); border-color: rgba(167,139,250,0.40); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-drop:hover { background: rgba(124,58,237,0.18); border-color: #a78bfa; }
[data-bs-theme="dark"] .acm-fileslot-drop-title { color: #ddd6fe; }
[data-bs-theme="dark"] .acm-fileslot-drop-size { background: rgba(167,139,250,0.22); color: #ddd6fe; }
[data-bs-theme="dark"] .acm-fileslot-chip { background: #11182a; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-fileslot-chip.is-existing { background: rgba(124,58,237,0.10); border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-fileslot-chip.is-new { background: rgba(16,185,129,0.10); border-color: rgba(110,231,183,0.40); }
[data-bs-theme="dark"] .acm-fileslot-icon { background: rgba(167,139,250,0.22); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-chip.is-new .acm-fileslot-icon { background: rgba(16,185,129,0.22); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-fileslot-name { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-fileslot-btn { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.12); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-btn:hover:not(:disabled) { background: rgba(167,139,250,0.18); border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-fileslot-btn-del { color: #fca5a5; }
[data-bs-theme="dark"] .acm-fileslot-btn-del:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: rgba(252,165,165,0.50); }
[data-bs-theme="dark"] .acm-fileslot-removed { background: rgba(239,68,68,0.10); border-color: rgba(252,165,165,0.40); }
[data-bs-theme="dark"] .acm-fileslot-removed-text { color: #fca5a5; }

.acm-doc-type-sub-modal { z-index: 10002; }
.acm-doc-type-master-card { max-width: 560px; border-radius: 18px; }
.acm-doc-type-master-head { justify-content: space-between !important; padding: 18px 24px !important; }
.acm-doc-type-master-head-left { display: flex; align-items: center; gap: 14px; }
.acm-doc-type-master-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: rgba(255,255,255,0.20); border: 1px solid rgba(255,255,255,0.35);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; flex-shrink: 0;
}
.acm-doc-type-master-sub { font-size: 11px; color: rgba(255,255,255,0.85); margin-top: 3px; }
.acm-doc-type-master-body { padding: 18px 24px 4px !important; }
.acm-doc-type-master-body .acm-row { margin-bottom: 14px; }
.acm-doc-type-master-footer { padding: 8px 24px 22px !important; justify-content: flex-end !important; }
.acm-doc-type-master-save {
  background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 60%, #2563eb 100%) !important;
  display: inline-flex !important; align-items: center; gap: 8px;
  min-width: 200px;
}
.acm-doc-type-master-save:hover { filter: brightness(1.1); }
[data-bs-theme="dark"] .acm-doc-type-master-save {
  background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1e40af 100%) !important;
}

[data-bs-theme="dark"] .acm-doc-sub-card {
  background: #11182a !important;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 24px 60px -16px rgba(0,0,0,.65), 0 8px 24px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .acm-doc-sub-header {
  background: linear-gradient(135deg, #2e1065 0%, #4c1d95 35%, #6d28d9 70%, #7c3aed 100%) !important;
}
[data-bs-theme="dark"] .acm-doc-sub-title { color: #fff; }
[data-bs-theme="dark"] .acm-doc-sub-header .acm-sub-close {
  background: rgba(255,255,255,0.15) !important;
  border-color: rgba(255,255,255,0.35) !important;
  color: #fff !important;
}
[data-bs-theme="dark"] .acm-doc-sub-header .acm-sub-close:hover { background: rgba(255,255,255,0.28) !important; }
[data-bs-theme="dark"] .acm-doc-sub-card .acm-sub-body { background: #11182a !important; }
[data-bs-theme="dark"] .acm-doc-sub-footer { background: #11182a !important; }
[data-bs-theme="dark"] .acm-doc-sub-footer .acm-btn-mini-cancel {
  background: transparent; border-color: rgba(167,139,250,0.45); color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-doc-sub-footer .acm-btn-mini-cancel:hover { background: rgba(167,139,250,0.12); }
[data-bs-theme="dark"] .acm-doc-save {
  background: linear-gradient(135deg, #2e1065 0%, #4c1d95 35%, #6d28d9 70%, #7c3aed 100%) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .acm-doc-save:hover { filter: brightness(1.15); }
[data-bs-theme="dark"] .acm-doc-plus-btn {
  background: rgba(167,139,250,0.10);
  border-color: rgba(167,139,250,0.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-doc-plus-btn:hover { background: rgba(167,139,250,0.20); border-color: #a78bfa; color: #ede9fe; }
.acm-btn-save:hover { background: linear-gradient(135deg, #6d28d9, #4c1d95); transform: translateY(-1px); }
.acm-btn-mini-cancel { padding: 7px 18px; border-radius: 9px; border: 1.5px solid rgba(124,58,237,.3); background: #fff; color: #5b21b6; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.acm-btn-mini-cancel:hover { border-color: #7c3aed; }

.acm-radio-pills { display: inline-flex; gap: 10px; flex-wrap: wrap; }
.acm-radio-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border: 1.5px solid #e5e1f3; border-radius: 9px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 700; color: #6b7280; user-select: none; }
.acm-radio-pill input[type="radio"] { accent-color: #7c3aed; width: 13px; height: 13px; margin: 0; }
.acm-radio-pill.is-active { border-color: #7c3aed; background: #f5f3ff; color: #5b21b6; box-shadow: 0 0 0 3px rgba(124,58,237,.10); }

.acm-history { margin: 10px 22px 0; border-radius: 12px; border: 1.5px solid #c4b5fd; background: #fff; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.09); flex-shrink: 0; max-height: 46px; transition: max-height .38s cubic-bezier(.4,0,.2,1); }
.acm-history.acm-hist-open { max-height: 340px; }
.acm-history-header { height: 46px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; cursor: pointer; background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%); border-left: 4px solid #7c3aed; user-select: none; }
.acm-history-header:hover { background: linear-gradient(110deg, #ede9fe, #ddd6fe); }
.acm-history-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.acm-history-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-history-title { font-size: 12px; font-weight: 800; color: #3b0764; white-space: nowrap; }
.acm-history-meta { font-size: 9.5px; color: #7c3aed; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-history-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.acm-history-badge { padding: 3px 11px; border-radius: 20px; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-size: 9.5px; font-weight: 800; white-space: nowrap; }
.acm-history-chevron { width: 22px; height: 22px; border-radius: 50%; background: rgba(124,58,237,.12); display: flex; align-items: center; justify-content: center; color: #7c3aed; transition: transform .3s; }
.acm-history-chevron.acm-open { transform: rotate(180deg); }
.acm-history-body { overflow-y: auto; max-height: calc(340px - 46px); border-top: 1px solid #ede9fe; }

@media (max-width: 900px) {
  .acm-card { max-width: 100%; }
  .acm-row-3, .acm-row-4 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .acm-row-2, .acm-row-3, .acm-row-4 { grid-template-columns: 1fr; }
  .acm-stepper { overflow-x: auto; }
  .acm-step { min-width: 200px; flex: 0 0 auto; }
}

[data-bs-theme="dark"] .acm-card {
  background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%);
  border-color: rgba(167,139,250,0.20);
  box-shadow: 0 32px 80px -20px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.45);
}
[data-bs-theme="dark"] .acm-body {
  background: #0c1322;
  scrollbar-color: #4c1d95 #11182a;
}
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-track { background: #11182a; }
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-thumb { background: #6d28d9; }
[data-bs-theme="dark"] .acm-stepper,
[data-bs-theme="dark"] .acm-tabs { background: #0c1322; border-bottom-color: rgba(167,139,250,0.18); }

[data-bs-theme="dark"] .acm-header {
  background: linear-gradient(135deg, #1e1838 0%, #251c44 50%, #2a1d49 100%);
  border-bottom-color: rgba(167,139,250,0.20);
}
[data-bs-theme="dark"] .acm-title { color: #e9d5ff; }
[data-bs-theme="dark"] .acm-subtitle { color: #9aa0b4; }
[data-bs-theme="dark"] .acm-close {
  background: rgba(255,255,255,0.06);
  border-color: rgba(167,139,250,0.30);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-close:hover {
  background: rgba(167,139,250,0.15);
  border-color: #a78bfa;
  color: #e9d5ff;
}
[data-bs-theme="dark"] .acm-top-progress { background: rgba(167,139,250,.14); }
[data-bs-theme="dark"] .acm-top-progress > span { background: linear-gradient(90deg, transparent, #a78bfa 30%, #c4b5fd 70%, transparent); }

[data-bs-theme="dark"] .acm-step-active { background: linear-gradient(135deg, rgba(76,29,149,0.45) 0%, rgba(109,40,217,0.30) 100%); border-color: #a78bfa; box-shadow: 0 6px 22px rgba(0,0,0,.4), 0 0 0 1px rgba(167,139,250,.15) inset; }
[data-bs-theme="dark"] .acm-step-active .acm-step-title { color: #f1f5f9; }
[data-bs-theme="dark"] .acm-step-active .acm-step-sub { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-step-done { background: linear-gradient(135deg, rgba(6,95,70,0.45) 0%, rgba(16,185,129,0.20) 100%); border-color: #34d399; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .acm-step-done .acm-step-title { color: #d1fae5; }
[data-bs-theme="dark"] .acm-step-done .acm-step-sub { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-step-incomplete { background: rgba(40,52,70,0.60); border-color: rgba(148,163,184,0.25); box-shadow: 0 4px 14px rgba(0,0,0,.30); }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-badge { background: #2b3650; color: #cbd5e1; }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-title { color: #cbd5e1; }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-sub { color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-pending { background: rgba(40,52,70,0.75); border-color: rgba(167,139,250,0.18); opacity: 0.92; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-badge { background: #232c44; border-color: rgba(167,139,250,0.25); color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-num { background: #232c44; color: #cbd5e1; border-color: #11182a; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-title { color: #cbd5e1; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-sub { color: #94a3b8; }
[data-bs-theme="dark"] .acm-connector-line { background: rgba(255,255,255,0.06); }

[data-bs-theme="dark"] .acm-history { background: #11182a; border-color: rgba(167,139,250,0.20); box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
[data-bs-theme="dark"] .acm-history-header { background: linear-gradient(110deg, rgba(76,29,149,0.30) 0%, rgba(109,40,217,0.20) 100%); border-left-color: #a78bfa; }
[data-bs-theme="dark"] .acm-history-header:hover { background: linear-gradient(110deg, rgba(76,29,149,0.40), rgba(109,40,217,0.30)); }
[data-bs-theme="dark"] .acm-history-title { color: #ede9fe; }
[data-bs-theme="dark"] .acm-history-meta { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-history-body { border-top-color: rgba(167,139,250,0.18); }
[data-bs-theme="dark"] .acm-history-badge { background: rgba(124,58,237,0.30); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-history-icon { background: linear-gradient(135deg, #4c1d95, #2e1065); }
[data-bs-theme="dark"] .acm-history-chevron { background: rgba(167,139,250,0.15); color: #c4b5fd; }

[data-bs-theme="dark"] .acm-tab-off { background: transparent; color: #c4b5fd; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-tab-off:hover { background: rgba(167,139,250,0.10); border-color: #a78bfa; }
[data-bs-theme="dark"] .acm-tab-on { background: linear-gradient(135deg,#6d28d9,#4c1d95); border-color: #7c3aed; box-shadow: 0 3px 10px rgba(0,0,0,.4); }

[data-bs-theme="dark"] .acm-section {
  background: #1f2942;
  border-color: rgba(167,139,250,0.35);
  box-shadow:
    0 6px 22px rgba(0,0,0,0.50),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
[data-bs-theme="dark"] .acm-section-purple { border-top-color: #a78bfa; }
[data-bs-theme="dark"] .acm-section-head {
  background: linear-gradient(110deg, rgba(124,58,237,0.22) 0%, rgba(167,139,250,0.10) 100%);
  border-bottom-color: rgba(167,139,250,0.28);
}
[data-bs-theme="dark"] .acm-section-icon { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; border-color: rgba(167,139,250,0.55); box-shadow: 0 2px 8px rgba(124,58,237,0.35); }
[data-bs-theme="dark"] .acm-section-title { color: #ffffff; }
[data-bs-theme="dark"] .acm-section-sub { color: #d1d5db; }

[data-bs-theme="dark"] .acm-field label { color: #e2e8f0; font-weight: 700; }
.acm-root .master-select-toggle {
  border: 1.5px solid #e0d9f7;
  border-radius: 9px;
  background: #fff;
  font-size: 12px;
  color: #3b0764;
}
.acm-root .master-select-wrap.show .master-select-toggle,
.acm-root .master-select-toggle:focus-visible {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3.5px rgba(124,58,237,.14);
}
[data-bs-theme="dark"] .acm-root .master-select-toggle {
  background: #131c33;
  border-color: rgba(167,139,250,0.50);
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-root .master-select-toggle:disabled { color: #94a3b8; }
[data-bs-theme="dark"] .acm-root .master-datepicker-toggle {
  background: #131c33;
  border-color: rgba(167,139,250,0.50);
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-root .master-datepicker-toggle:hover { border-color: rgba(167,139,250,0.75); }
[data-bs-theme="dark"] .acm-root .master-datepicker-toggle::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .acm-root .master-datepicker-toggle:disabled { color: #94a3b8; }

.acm-field input:-webkit-autofill,
.acm-field input:-webkit-autofill:hover,
.acm-field input:-webkit-autofill:focus {
  -webkit-text-fill-color: #3b0764;
  -webkit-box-shadow: 0 0 0 1000px #fff inset;
  caret-color: #3b0764;
  transition: background-color 9999s ease-out 0s;
  font-family: inherit !important;
  font-size: 12px !important;
}
[data-bs-theme="dark"] .acm-field input:-webkit-autofill,
[data-bs-theme="dark"] .acm-field input:-webkit-autofill:hover,
[data-bs-theme="dark"] .acm-field input:-webkit-autofill:focus {
  -webkit-text-fill-color: #ffffff;
  -webkit-box-shadow: 0 0 0 1000px #131c33 inset;
  caret-color: #ffffff;
}

[data-bs-theme="dark"] .acm-field input,
[data-bs-theme="dark"] .acm-field select,
[data-bs-theme="dark"] .acm-field textarea {
  background: #131c33 !important;
  border-color: rgba(167,139,250,0.50);
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-field input::placeholder,
[data-bs-theme="dark"] .acm-field textarea::placeholder { color: #94a3b8; }
.acm-field input.acm-input-ro { background: #f5f3fb; color: #6b7280; cursor: not-allowed; }
[data-bs-theme="dark"] .acm-field input.acm-input-ro {
  background: #1b2440 !important; color: #94a3b8; cursor: not-allowed;
}
[data-bs-theme="dark"] .acm-field input:hover,
[data-bs-theme="dark"] .acm-field select:hover,
[data-bs-theme="dark"] .acm-field textarea:hover { border-color: rgba(167,139,250,0.75); }
[data-bs-theme="dark"] .acm-field input:focus,
[data-bs-theme="dark"] .acm-field select:focus,
[data-bs-theme="dark"] .acm-field textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3.5px rgba(167,139,250,0.22);
}
[data-bs-theme="dark"] .acm-field input.acm-input-error { background: rgba(239,68,68,0.10); border-color: #ef4444; }
[data-bs-theme="dark"] .acm-radio { color: #e2e8f0; }
[data-bs-theme="dark"] .acm-radio input[type="radio"] { accent-color: #a78bfa; }
[data-bs-theme="dark"] .acm-radio-pill { background: #131c33; border-color: rgba(167,139,250,0.40); color: #ddd6fe; }
[data-bs-theme="dark"] .acm-radio-pill.is-active { background: rgba(124,58,237,0.45); border-color: #a78bfa; color: #ffffff; }

[data-bs-theme="dark"] .acm-add-pill { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.40); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-add-pill:hover { background: rgba(167,139,250,0.22); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .acm-row-btn { background: #1c2531; border-color: rgba(167,139,250,0.20); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-row-btn:hover { background: rgba(167,139,250,0.18); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .acm-row-btn-del:hover { background: rgba(239,68,68,0.18); border-color: #ef4444; color: #fca5a5; }

[data-bs-theme="dark"] .acm-table thead tr {
  background: linear-gradient(180deg, rgba(28,37,49,0.85), rgba(17,24,42,0.85)) !important;
}
[data-bs-theme="dark"] .acm-table thead th {
  color: #c4b5fd !important;
  background: #16202d !important;
  box-shadow: inset 0 -1.5px 0 0 rgba(167,139,250,0.20) !important;
  border-bottom-color: transparent !important;
}
[data-bs-theme="dark"] .acm-table tbody td {
  color: #e2e8f0;
  border-bottom-color: rgba(255,255,255,0.06);
}
[data-bs-theme="dark"] .acm-table tbody tr:hover td { background: rgba(167,139,250,0.06) !important; }
[data-bs-theme="dark"] .acm-empty-row td { color: #64748b !important; background: transparent !important; }
[data-bs-theme="dark"] .acm-empty-row strong { color: #c4b5fd !important; }
[data-bs-theme="dark"] .acm-table tbody td[style*="color: rgb(31, 41, 55)"],
[data-bs-theme="dark"] .acm-table tbody td[style*="color:#1f2937"] { color: #f1f5f9 !important; }
[data-bs-theme="dark"] .acm-table tbody td[style*="color: rgb(107, 114, 128)"],
[data-bs-theme="dark"] .acm-table tbody td[style*="color:#6b7280"] { color: #94a3b8 !important; }
[data-bs-theme="dark"] .acm-section-body-table { background: transparent !important; }
[data-bs-theme="dark"] .acm-table-wrap { background: transparent; scrollbar-color: #6d28d9 #11182a; }
[data-bs-theme="dark"] .acm-table-wrap::-webkit-scrollbar-track { background: #11182a; }
[data-bs-theme="dark"] .acm-table-wrap::-webkit-scrollbar-thumb { background: #6d28d9; }
[data-bs-theme="dark"] .acm-table-wrap::-webkit-scrollbar-thumb:hover { background: #7c3aed; }
[data-bs-theme="dark"] .acm-table-wrap::-webkit-scrollbar-corner { background: #11182a; }
[data-bs-theme="dark"] .acm-expiry-na     { background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-issue-date    { background: rgba(99,102,241,0.20); color: #c7d2fe; border-color: rgba(99,102,241,0.40); }
[data-bs-theme="dark"] .acm-expiry-future { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-expiry-past   { background: rgba(239,68,68,0.18); color: #fca5a5; border-color: rgba(239,68,68,0.40); }
[data-bs-theme="dark"] .acm-expiry-soon   { background: rgba(245,158,11,0.18); color: #fcd34d; border-color: rgba(245,158,11,0.40); }
[data-bs-theme="dark"] .acm-doc-code { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-pill-yes { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-pill-no  { background: rgba(255,255,255,0.06); color: #94a3b8; border-color: rgba(255,255,255,0.20); }
[data-bs-theme="dark"] .acm-primary-row td { background: rgba(124,58,237,0.10); }
[data-bs-theme="dark"] .acm-primary-row:hover td { background: rgba(124,58,237,0.16); }
[data-bs-theme="dark"] .acm-primary-tag { background: rgba(124,58,237,0.20); color: #ddd6fe; border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-attach-link { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-attach-link:hover { color: #ede9fe; }
[data-bs-theme="dark"] .acm-doc-action-upload { background: rgba(167,139,250,0.12); color: #c4b5fd; border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-doc-action-download { background: rgba(16,185,129,0.12); color: #6ee7b7; border-color: rgba(16,185,129,0.30); }
[data-bs-theme="dark"] .acm-doc-action-view { background: rgba(56,189,248,0.12); color: #7dd3fc; border-color: rgba(56,189,248,0.30); }

[data-bs-theme="dark"] .acm-doc-toolbar { background: rgba(28,37,49,0.4); border-color: rgba(255,255,255,0.06); }
[data-bs-theme="dark"] .acm-doc-search input {
  background: #131c33 !important;
  border-color: rgba(167,139,250,0.40) !important;
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-doc-search input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .acm-doc-search input:focus {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,0.22) !important;
}
[data-bs-theme="dark"] .acm-doc-search-icon { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-doc-count { color: #c4b5fd; }

[data-bs-theme="dark"] .acm-footer {
  background: linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(17,24,42,0.95) 100%);
  border-top-color: rgba(167,139,250,0.25);
}
[data-bs-theme="dark"] .acm-req-note { color: #c4b5fd; font-weight: 600; }
[data-bs-theme="dark"] .acm-btn-prev { background: rgba(167,139,250,0.08); color: #ddd6fe; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-btn-prev:hover { background: rgba(167,139,250,0.18); border-color: #a78bfa; color: #ffffff; }

[data-bs-theme="dark"] .acm-field-error { color: #fca5a5; }

@media (max-width: 1440px) {
  .acm-root { padding: 10px; }
  .acm-card {
    max-width: min(1224px, calc(100vw - 20px));
    height: min(94vh, calc(100vh - 16px));
  }
  .acm-header { padding: 12px 18px; }
  .acm-stepper { padding: 12px 16px 10px; }
  .acm-history { margin: 10px 16px 0; }
  .acm-body { padding: 14px 18px 16px; }
  .acm-footer { padding: 10px 18px; }
  .acm-section-body, .acm-sec-pad { padding: 14px; }
}

@media (max-width: 1280px) {
  .acm-row-4 { grid-template-columns: 1fr 1fr; }
  .acm-step { padding: 9px 11px; gap: 9px; }
  .acm-step-badge-wrap,
  .acm-step-badge { width: 34px; height: 34px; }
  .acm-step-title { font-size: 11.5px; }
  .acm-step-sub   { font-size: 9px; }
  .acm-step-connector { flex-basis: 18px; }
}

@media (max-width: 1024px) {
  .acm-root { padding: 8px; }
  .acm-card {
    max-width: min(1224px, calc(100vw - 16px));
    height: min(96vh, calc(100vh - 12px));
  }
  .acm-row-4 { grid-template-columns: 1fr 1fr; }
  .acm-row-3 { grid-template-columns: 1fr 1fr; }
  .acm-row-2 { grid-template-columns: 1fr 1fr; }
  .acm-section-body, .acm-sec-pad { padding: 12px; }
  .acm-stepper { padding: 10px 12px 8px; flex-wrap: wrap; gap: 8px; }
  .acm-history { margin: 10px 12px 0; }
  .acm-step-connector { display: none; }
  .acm-step { flex: 1 1 calc(50% - 6px); min-width: 0; }
  .acm-tabs { padding: 0 16px; }
  .acm-body { padding: 12px 14px 14px; }
}

@media (max-width: 640px) {
  .acm-root { padding: 0; align-items: stretch; }
  .acm-card {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
    width: 100vw;
    max-width: 100vw;
  }
  .acm-header { padding: 14px 16px; flex-direction: column; align-items: flex-start; gap: 10px; }
  .acm-header-icon { width: 40px; height: 40px; }
  .acm-title { font-size: 16px; }
  .acm-subtitle   { font-size: 11.5px; }
  .acm-close { position: absolute; top: 12px; right: 12px; }
  .acm-stepper { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; }
  .acm-history { margin: 10px 12px 0; }
  .acm-step-connector { display: none; }
  .acm-step { width: 100%; flex: 0 0 auto; }
  .acm-tabs { flex-wrap: wrap; padding: 0 12px; }
  .acm-tab { flex: 1 1 auto; min-width: 40%; font-size: 12px; padding: 8px 10px; }
  .acm-body { padding: 12px; }
  .acm-row-4, .acm-row-3, .acm-row-2 { grid-template-columns: 1fr; }
  .acm-row { gap: 10px; }
  .acm-input { font-size: 13px; padding: 8px 10px; }
  .acm-section-head { padding: 10px 12px; gap: 8px; }
  .acm-section-title { font-size: 12.5px; }
  .acm-section-sub { display: none; }
  .acm-section-body, .acm-sec-pad { padding: 10px; }
  .acm-footer {
    padding: 10px 12px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-req-note { display: none; }
  .acm-footer-actions {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 8px;
  }
  .acm-btn-prev, .acm-btn-next {
    flex: 1 1 0;
    min-width: 0;
    padding: 11px 14px;
    font-size: 13px;
    justify-content: center;
  }
  .acm-sub-modal { padding: 0; align-items: stretch; }
  .acm-sub-card { border-radius: 0; max-height: 100vh; height: 100vh; width: 100vw; }
  .acm-sub-header { padding: 14px 16px; }
  .acm-sub-body { padding: 14px; }
  .acm-sub-footer {
    padding: 12px 14px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-btn-mini-cancel, .acm-btn-save, .acm-doc-save { width: 100%; flex: 0 0 auto; }
  .acm-doc-toolbar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px; }
  .acm-doc-pag-wrap .wl-pager { padding-left: 12px; padding-right: 12px; }
  .acm-doc-search { max-width: 100%; }
  .acm-doc-count { align-self: flex-start; }
  .acm-subtabs-row { flex-wrap: wrap; gap: 6px; }
  .acm-recap-grid { grid-template-columns: 1fr; }
  .acm-same-banner { padding: 10px 12px; gap: 10px; }
  .acm-same-banner-sub { font-size: 11.5px; }
  .acm-add-pill { font-size: 11.5px; padding: 6px 12px; }
  .acm-section-head-row { flex-wrap: wrap; gap: 8px; }
}
`;
