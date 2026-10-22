import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { segmentLabel } from '../../../components/ui/SegmentBadge';
import { createPortal } from 'react-dom';
import { Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import api from '../../../api';
import { formatDmy } from '../../../utils/formatDmy';
import { formatProductCode } from '../../../utils/formatProductCode';
import { SigningTrackerModal } from './SigningTrackerModal';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useSelectionLock } from '../../../hooks/useSelectionLock';
import Tooltip from '../../../components/ui/Tooltip';
import { MasterSelect, OptBadge } from '../../../components/ui/MasterSelect';
import WorklistPager from '../../../components/ui/WorklistPager';
import TableContainer from '../../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../../components/ui/DeleteConfirmModal';
import SalesDocSendForSignatureModal from './matrix/stages/SalesDocSendForSignatureModal';
import ConvertToPiModal, { ConversionBlockedModal } from './ConvertToPiModal';
import { ShimmerTable } from '../../../components/ui/Shimmer';
import SearchClear from '../../../components/ui/SearchClear';


type QPITab = 'quotation' | 'pi';
type PISubTab = 'with' | 'without';

export type Quotation = {
  id?: number;
  qtNo: string;
  qtDate: string;
  oppId: string;
  leadId?: number | null;
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;
  grandTotal?: number | null;
  salesManager: string;
  status?: string;
  emailedAt?: string | null;
  reminderCount?: number;
  canModify?: boolean;
  branchName?: string;
  createdBy?: string;
  createdById?: number | null;
  creatorUserType?: string;
  zoho_status?: string;
};

type PI = {
  id?: number;
  piNo: string;
  piDate: string;
  btId: string | null;
  btDate: string | null;
  convertFrom: string | null;
  oppId: string;
  leadId?: number | null;
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;
  salesManager: string;
  emailedAt?: string | null;
  reminderCount?: number;
  canModify?: boolean;
  branchName?: string;
  createdBy?: string;
  createdById?: number | null;
  creatorUserType?: string;
  victoryReached?: boolean;
  hasShipment?: boolean;
  zoho_status?: string;
};

const ROWS_PER_PAGE = 10;
const QPI_ROWS_OPTIONS = [10, 25, 50, 100];
function renderCreatorCell(
  name: string | undefined,
  creatorId: number | null | undefined,
  userType: string | undefined,
  branchName: string | undefined,
  currentUserId: number | undefined,
) {
  if (!name && !creatorId) return <span className="qpi-em">—</span>;

  const isSelf = !!currentUserId && !!creatorId && currentUserId === creatorId;

  const t = String(userType ?? '').toLowerCase();
  const tone =
    isSelf
      ? { bg: '#e0e7ff', fg: '#3730a3', kind: 'self' as const }
    : t === 'super_admin'
      ? { bg: '#ede9fe', fg: '#6d28d9', kind: 'super' as const }
    : t === 'client_admin' || t === 'client_user'
      ? { bg: '#dbeafe', fg: '#1d4ed8', kind: 'client' as const }
    : t === 'branch_user' || t === 'employee'
      ? { bg: '#ccfbf1', fg: '#0d9488', kind: 'branch' as const }
      : { bg: '#f1f5f9', fg: '#475569', kind: 'other' as const };

  const primary = isSelf ? (name || 'You') : (name || '—');

  const subLabel = (() => {
    if (isSelf) return '';
    if (tone.kind === 'super')  return 'Super Admin';
    if (tone.kind === 'client') return t === 'client_admin' ? 'Client Admin' : 'Client user';
    if (tone.kind === 'branch') return branchName || 'Branch';
    return '';
  })();

  return (
    <div className="qpi-creator-cell">
      <span className={`qpi-creator-pill qpi-creator-${tone.kind}`}
            style={{ background: tone.bg, color: tone.fg }}>
        {primary}
      </span>
      {subLabel && <span className="qpi-creator-sub">{subLabel}</span>}
    </div>
  );
}

async function openSalesPdf(
  kind: 'quotation' | 'pi',
  payload: Record<string, unknown>,
  withSignature: boolean,
  mode: 'view' | 'download',
  preOpenedWindow: Window | null,
): Promise<void> {
  const url = kind === 'quotation'
    ? `/sales/quotations/${payload.id}/preview-pdf`
    : `/sales/proforma-invoices/${payload.id}/preview-pdf`;
  const body = { signature: withSignature };
  const res = await api.post(url, body, { responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);

  if (mode === 'view') {
    const win = preOpenedWindow ?? window.open(objectUrl, '_blank', 'noopener,noreferrer');
    if (win && preOpenedWindow) win.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  const code = (payload.piNo as string | undefined) ?? ((payload.id as number | undefined)?.toString() ?? 'document');
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, '_');
  const label = kind === 'quotation' ? 'Quotation' : 'PI';
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${label}-${safeCode}-${withSignature ? 'signed' : 'unsigned'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
}

function piPayloadFromQuotation(q: Quotation) {
  return {
    id: q.id,
    piNo: q.qtNo, piDate: q.qtDate,
    oppId: q.oppId, oppDate: q.oppDate,
    customer: q.customer, consignee: q.consignee,
    docType: q.docType, currency: q.currency,
    salesManager: q.salesManager,
  };
}

function currencyCode(v: string | null | undefined): string {
  if (!v) return '';
  return String(v).split(/\s*[-–—]\s*/)[0].trim();
}

function displayCurrency(v: string | null | undefined, docType: string | null | undefined): string {
  const code = currencyCode(v);
  if (code) return code;
  return String(docType ?? '').trim() === 'Domestic' ? 'INR' : '';
}

function piPayloadFromPI(p: PI) {
  return {
    id: p.id,
    piNo: p.piNo, piDate: p.piDate,
    btId: p.btId ?? '0', btDate: p.btDate ?? 'NA',
    oppId: p.oppId, oppDate: p.oppDate,
    customer: p.customer, consignee: p.consignee,
    docType: p.docType, currency: p.currency,
    salesManager: p.salesManager,
  };
}

type AnchorRect = { top: number; bottom: number; left: number; right: number };
function MoreOptionsMenu(props: {
  rect: AnchorRect;
  kind: 'quotation' | 'pi';
  payload: Record<string, unknown>;
  sigId: number | null;
  sigStatus?: string | null;
  docCode: string;
  onViewSigned?: () => void | Promise<void>;
  onDownloadSigned?: () => void | Promise<void>;
  onClose: () => void;
  onError: (msg: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { rect, kind, payload, sigId, sigStatus, docCode, onViewSigned, onDownloadSigned, onClose, onError, onBusyChange } = props;
  const docLabel = kind === 'quotation' ? 'Quotation' : 'PI';
  const menuRef = useRef<HTMLDivElement>(null);
  type BusyKey = 'view-sig' | 'view-nosig' | 'dl-sig' | 'dl-nosig' | 'cert';
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => { onBusyChange?.(busy !== null); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  useLayoutEffect(() => {
    const place = () => {
      const menuW = menuRef.current?.offsetWidth ?? 200;
      const menuH = menuRef.current?.offsetHeight ?? 90;
      let top  = rect.bottom + 6;
      let left = rect.right - menuW;
      if (top + menuH > window.innerHeight - 8) top = rect.top - 6 - menuH;
      if (left < 8) left = 8;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [rect]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const pick = (mode: 'view' | 'download', withSignature: boolean) => {
    const key: BusyKey =
      mode === 'view' ? (withSignature ? 'view-sig' : 'view-nosig')
                      : (withSignature ? 'dl-sig'   : 'dl-nosig');
    const win = mode === 'view' ? window.open('', '_blank') : null;
    setBusy(key);
    openSalesPdf(kind, payload, withSignature, mode, win)
      .then(() => onClose())
      .catch((err: any) => {
        if (win) win.close();
        onError(err?.response?.data?.message || 'Could not generate PDF');
      })
      .finally(() => setBusy(null));
  };

  const downloadCertificate = () => {
    if (sigId == null) return;
    setBusy('cert');
    api.get(`/clm/signature-requests/${sigId}/certificate`, { responseType: 'blob' })
      .then((res) => {
        const blobUrl = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${(docCode || `${kind}-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_certificate.pdf`;
        a.click();
        URL.revokeObjectURL(blobUrl);
        onClose();
      })
      .catch((err: any) => onError(err?.response?.data?.message || 'Could not download the signing certificate'))
      .finally(() => setBusy(null));
  };

  return createPortal(
    <div
      ref={menuRef}
      className="qpi-moremenu"
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {(sigStatus === 'declined' || sigStatus === 'recalled') && (
        <div className="qpi-moremenu-notice" role="note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <span>This {docLabel} was {sigStatus === 'declined' ? 'declined' : 'recalled'} — it was not signed. You can re-send it for signature.</span>
        </div>
      )}
      {kind === 'quotation' ? (
        <>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('view', false)}
          >
            <IconEyeSm />
            <span>View {docLabel}</span>
            {busy === 'view-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('download', false)}
          >
            <IconDownloadSm />
            <span>Download {docLabel}</span>
            {busy === 'dl-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
        </>
      ) : sigId != null ? (
        <>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (!onViewSigned) return;
              setBusy('view-sig');
              Promise.resolve(onViewSigned()).finally(() => { setBusy(null); onClose(); });
            }}
          >
            <IconEyeSm />
            <span>View Signed {docLabel}</span>
            {busy === 'view-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('view', false)}
          >
            <IconEyeSm />
            <span>View {docLabel} without Signature</span>
            {busy === 'view-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (!onDownloadSigned) return;
              setBusy('dl-sig');
              Promise.resolve(onDownloadSigned()).finally(() => { setBusy(null); onClose(); });
            }}
          >
            <IconDownloadSm />
            <span>Download Signed {docLabel}</span>
            {busy === 'dl-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('download', false)}
          >
            <IconDownloadSm />
            <span>Download {docLabel} without Signature</span>
            {busy === 'dl-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={downloadCertificate}
          >
            <IconCertificateSm />
            <span>Download Signed Certificate</span>
            {busy === 'cert' && <span className="qpi-moremenu-spinner" />}
          </button>
        </>
      ) : (
        <>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (kind === 'quotation') { pick('view', true); return; }
              onError(`Not signed yet — sign this ${docLabel} via Zoho to view the signed PDF.`); onClose();
            }}
          >
            <IconEyeSm />
            <span>View {docLabel} with Signature</span>
            {busy === 'view-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('view', false)}
          >
            <IconEyeSm />
            <span>View {docLabel} without Signature</span>
            {busy === 'view-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <div className="qpi-moremenu-sep" />
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => {
              if (kind === 'quotation') { pick('download', true); return; }
              onError(`Not signed yet — sign this ${docLabel} via Zoho to download the signed PDF.`); onClose();
            }}
          >
            <IconDownloadSm />
            <span>Download {docLabel} with Signature</span>
            {busy === 'dl-sig' && <span className="qpi-moremenu-spinner" />}
          </button>
          <button
            type="button" role="menuitem"
            className="qpi-moremenu-item"
            disabled={busy !== null}
            onClick={() => pick('download', false)}
          >
            <IconDownloadSm />
            <span>Download {docLabel} without Signature</span>
            {busy === 'dl-nosig' && <span className="qpi-moremenu-spinner" />}
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

const IconEyeSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconCertificateSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);
const IconDownloadSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const STEPS = [
  { n:1, title:'Create Quotation',          desc:'Prepare quotation using opportunity, customer, product, pricing, currency, and bank details.', tag:'FOUNDATION STEP' },
  { n:2, title:'Share & Track Response',    desc:'Send quotation to customer and track response status.',                                          tag:'SALES TRACKING' },
  { n:3, title:'Convert to Proforma Invoice', desc:'Convert accepted quotation into PI with shipment, payment, and document details.',        tag:'CONVERSION STEP' },
  { n:4, title:'Sales Readiness',           desc:'Prepare quotation and PI records for CLM, order confirmation, and export execution.',        tag:'FINAL EXECUTION' },
];

export default function SalesQPI() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<QPITab>('quotation');
  const [piSub, setPiSub] = useState<PISubTab>('with');
  const [wdhOpen, setWdhOpen] = useState(false);
  const [q, setQ] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<'all' | 'International' | 'Domestic'>('all');
  const [page, setPage] = useState(1);

  const [createQtOpen, setCreateQtOpen] = useState(false);
  const [createPiOpen, setCreatePiOpen] = useState(false);
  const [piSourceQuotation, setPiSourceQuotation] = useState<Quotation | null>(null);
  const [editingQuotationId, setEditingQuotationId] = useState<number | null>(null);
  const [editingPiId, setEditingPiId] = useState<number | null>(null);

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loadingQt, setLoadingQt] = useState(true);
  const reloadQuotations = () => {
    setLoadingQt(true);
    api.get('/sales/quotations', { params: { per_page: 200 } })
      .then(({ data }) => {
        const rows: Quotation[] = (data?.data ?? []).map((r: any) => ({
          id:           r.id,
          qtNo:         r.code,
          qtDate:       r.created_at ? formatDmy(r.created_at) : '',
          oppId:        r.opp_code ?? '',
          leadId:       r.opp_id != null ? Number(r.opp_id) : null,
          oppDate:      r.opportunity_date
                        ? formatDmy(r.opportunity_date)
                        : '',
          customer:     r.customer_name ?? r.customer?.company_name ?? '',
          consignee:    r.consignee_name ?? r.consignee?.company_name ?? '',
          docType:      (r.doc_type ?? 'International') as 'International' | 'Domestic',
          currency:     r.currency ?? '',
          grandTotal:   r.grand_total != null ? Number(r.grand_total) : null,
          salesManager: r.sales_manager_name ?? '—',
          status:       r.status ?? 'draft',
          emailedAt:    r.emailed_at ?? null,
          reminderCount: Number(r.reminder_count ?? 0),
          canModify:    r.can_modify !== false,
          branchName:   r.branch?.name ?? '',
          createdBy:    r.creator_name ?? r.creator?.name ?? '',
          createdById:  r.created_by ?? r.creator?.id ?? null,
          creatorUserType:     r.creator_user_type ?? r.creator?.user_type ?? '',
          zoho_status:  r.zoho_status ?? 'Not Sync',
        }));
        setQuotations(rows);
      })
      .catch(() => toast.error('Load failed', 'Could not fetch quotations'))
      .finally(() => setLoadingQt(false));
  };
  useEffect(() => { reloadQuotations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [pis, setPis] = useState<PI[]>([]);
  const [loadingPi, setLoadingPi] = useState(true);
  const reloadPis = () => {
    setLoadingPi(true);
    api.get('/sales/proforma-invoices', { params: { per_page: 200 } })
      .then(({ data }) => {
        const rows: PI[] = (data?.data ?? []).map((r: any) => ({
          id:          r.id,
          piNo:        r.code,
          piDate:      r.created_at ? formatDmy(r.created_at) : '',
          btId:        r.shipment_code ?? r.bt_id ?? null,
          btDate:      r.shipment_date
                         ? formatDmy(r.shipment_date)
                         : (r.bt_date ? formatDmy(r.bt_date) : null),
          convertFrom: r.convert_from_code ?? r.sourceQuotation?.code ?? null,
          oppId:       r.opp_code ?? '',
          leadId:      r.opp_id != null ? Number(r.opp_id) : null,
          oppDate:     r.opportunity_date
                       ? formatDmy(r.opportunity_date)
                       : '',
          customer:    r.customer_name ?? r.customer?.company_name ?? '',
          consignee:   r.consignee_name ?? r.consignee?.company_name ?? '',
          docType:     (r.doc_type ?? 'International') as 'International' | 'Domestic',
          currency:    r.currency ?? '',
          salesManager: r.sales_manager_name ?? '—',
          emailedAt:   r.emailed_at ?? null,
          reminderCount: Number(r.reminder_count ?? 0),
          canModify:   r.can_modify !== false,
          branchName:  r.branch?.name ?? '',
          createdBy:   r.creator_name ?? r.creator?.name ?? '',
          createdById: r.created_by ?? r.creator?.id ?? null,
          creatorUserType:     r.creator_user_type ?? r.creator?.user_type ?? '',
          victoryReached: Boolean(
            r.victory_reached
            ?? ((Number(r.lead?.lead_stage_id ?? 0) >= 6) || !!r.lead?.won_at)
          ),
          hasShipment: Boolean(r.shipment_code),
          zoho_status: r.zoho_status ?? 'Not Sync',
          ...(r.pi_type ? { _piType: r.pi_type } : {}),
        }));
        setPis(rows);
      })
      .catch(() => toast.error('Load failed', 'Could not fetch PIs'))
      .finally(() => setLoadingPi(false));
  };
  useEffect(() => { reloadPis(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* Load the Create Quotation / PI masters in the background while the user
   * reads the list, same as Stage 5 does. Without it the bundle only started
   * on the click, so the form shimmered for the whole load (QA #8). Same API,
   * same 5-minute cache; the modal reuses the in-flight request if clicked early. */
  useEffect(() => { prewarmQpiMasters(); }, []);

  const piWithShipment = useMemo(
    () => pis.filter(r => r.hasShipment === true),
    [pis],
  );
  const piWithoutShipment = useMemo(
    () => pis.filter(r => r.hasShipment !== true),
    [pis],
  );

  useEffect(() => {
    const id = 'sm-qpi-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = useMemo(() => {
    const lo = q.trim().toLowerCase();
    const byDoc = <T extends { docType: string }>(arr: T[]) =>
      docTypeFilter === 'all' ? arr : arr.filter(r => r.docType === docTypeFilter);
    if (tab === 'quotation') {
      const src = byDoc(quotations);
      if (!lo) return src;
      return src.filter(r => (
        r.qtNo.toLowerCase().includes(lo) ||
        r.oppId.toLowerCase().includes(lo) ||
        r.customer.toLowerCase().includes(lo) ||
        r.consignee.toLowerCase().includes(lo) ||
        r.salesManager.toLowerCase().includes(lo)
      ));
    }
    const src = byDoc(piSub === 'with' ? piWithShipment : piWithoutShipment);
    if (!lo) return src;
    return src.filter(r => (
      r.piNo.toLowerCase().includes(lo) ||
      r.oppId.toLowerCase().includes(lo) ||
      r.customer.toLowerCase().includes(lo) ||
      r.consignee.toLowerCase().includes(lo) ||
      (r.convertFrom ?? '').toLowerCase().includes(lo) ||
      (r.btId ?? '').toLowerCase().includes(lo)
    ));
  }, [tab, piSub, q, quotations, pis, piWithShipment, piWithoutShipment, docTypeFilter]);

  const tableHostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const [rpp, setRpp] = useState(ROWS_PER_PAGE);
  const rppManualRef = useRef(false);
  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;
    const fit = () => {
      const cardEl = cardRef.current;
      if (cardEl) {
        const cardTop = cardEl.getBoundingClientRect().top;
        const cardH = Math.max(0, window.innerHeight - cardTop - 16);
        setFillH(prev => (prev === cardH ? prev : cardH));
      }
      const headRow = host.querySelector('thead tr') as HTMLElement | null;
      if (headRow) {
        const bw = headRow.getBoundingClientRect().width;
        if (bw) host.style.setProperty('--qpi-band-w', `${bw}px`);
      }
      if (rppManualRef.current) return;
      const top    = host.getBoundingClientRect().top;
      const theadH = (host.querySelector('thead') as HTMLElement | null)?.offsetHeight || 44;
      const rowH   = (host.querySelector('tbody tr') as HTMLElement | null)?.offsetHeight || 48;
      const FOOTER  = 56;
      const HOSTPAD = 15;
      const avail   = window.innerHeight - top - theadH - FOOTER - HOSTPAD - 16;
      const rowsFit = Math.max(4, Math.floor(avail / rowH));
      setRpp(prev => (prev === rowsFit ? prev : rowsFit));
    };
    fit();
    const t = window.setTimeout(fit, 130);
    window.addEventListener('resize', fit);
    let ro: ResizeObserver | undefined;
    const banner = document.querySelector('.qpi-wdh');
    if (banner && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(banner);
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', fit);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdhOpen, loadingQt, loadingPi, tab, piSub]);

  const totalRows = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / rpp));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * rpp;
  const pageRows  = filtered.slice(pageStart, pageStart + rpp);
  useEffect(() => { setPage(1); }, [tab, piSub, q, docTypeFilter]);

  const switchTab = (next: QPITab) => { setTab(next); setQ(''); };
  const switchPiSub = (next: PISubTab) => { setPiSub(next); setQ(''); };

  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null);
  const [convertPreviewCode, setConvertPreviewCode] = useState<string | null>(null);
  const [convertBlocked, setConvertBlocked] = useState<{ fromQt: string; pi: PI } | null>(null);

  const [sigSendFor, setSigSendFor] = useState<
    { kind: 'quotation' | 'pi'; id: number; code: string; customerName: string | null; leadId: number | null } | null
  >(null);
  const [sigByRow, setSigByRow] = useState<Record<string, { id: number; status: string }>>({});
  const [sigTick, setSigTick] = useState(0);
  const [sigLoaded, setSigLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async (sync: boolean) => {
      try {
        const [qr, pr] = await Promise.allSettled([
          api.get('/clm/signature-requests', { params: { document_type: 'quotation', sync: sync ? 1 : 0 } }),
          api.get('/clm/signature-requests', { params: { document_type: 'proforma_invoice', sync: sync ? 1 : 0 } }),
        ]);
        if (!alive) return;
        const map: Record<string, { id: number; status: string }> = {};
        const ingest = (rows: any, kind: 'quotation' | 'pi') => (Array.isArray(rows) ? rows : []).forEach((row: any) => {
          const did = row.trade_doc_id ?? (Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids[0] : null);
          if (did == null) return;
          const key = `${kind}:${did}`;
          if (!map[key] || row.id > map[key].id) map[key] = { id: row.id, status: String(row.status ?? '').toLowerCase() };
        });
        if (qr.status === 'fulfilled') ingest((qr.value as any).data?.data, 'quotation');
        if (pr.status === 'fulfilled') ingest((pr.value as any).data?.data, 'pi');
        setSigByRow(map);
      } catch {  }
      finally { if (alive) setSigLoaded(true); }
    };
    void load(false).then(() => load(true));
    const t = setInterval(() => void load(true), 20000);
    return () => { alive = false; clearInterval(t); };
  }, [sigTick]);

  const onRemindSig = async (sigId: number) => {
    try {
      await api.post(`/clm/signature-requests/${sigId}/remind`);
      toast.success('Reminder sent', 'The signer has been reminded.');
    } catch (e: any) {
      toast.error('Reminder failed', e?.response?.data?.message ?? 'Could not send the reminder.');
    }
  };
  const onViewSignedSig = async (sigId: number) => {
    try {
      const r = await api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data as Blob), '_blank');
    } catch (e: any) {
      toast.error('Open failed', e?.response?.data?.message ?? 'Could not open the signed document.');
    }
  };
  const onDownloadSignedSig = async (sigId: number, code: string) => {
    try {
      const r = await api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([r.data as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${(code || `signed-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_signed.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      toast.error('Download failed', e?.response?.data?.message ?? 'Could not download the signed document.');
    }
  };
  const onViewSentPdf = async (kind: 'quotation' | 'pi', id: number) => {
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature: true }, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data as Blob), '_blank');
    } catch {
      toast.error('Preview failed', 'Could not open the document.');
    }
  };

  const [emailingKeys, setEmailingKeys] = useState<Set<string>>(new Set());
  const emailingRef = useRef<Set<string>>(new Set());
  const isEmailing = (kind: 'quotation' | 'pi', id: number) => emailingKeys.has(`${kind}:${id}`);

  const [emailCooldowns, setEmailCooldowns] = useState<Record<string, number>>({});
  const cdKey = (kind: 'quotation' | 'pi', id: number) => `${kind}:${id}`;
  const cooldownLeft = (kind: 'quotation' | 'pi', id: number): number => {
    const end = emailCooldowns[cdKey(kind, id)];
    return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : 0;
  };
  const startCooldown = (kind: 'quotation' | 'pi', id: number, seconds: number) => {
    setEmailCooldowns(m => ({ ...m, [cdKey(kind, id)]: Date.now() + seconds * 1000 }));
  };
  useEffect(() => {
    if (Object.keys(emailCooldowns).length === 0) return;
    const t = setInterval(() => {
      setEmailCooldowns(m => {
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(m)) if (v > now) next[k] = v;
        return Object.keys(next).length === Object.keys(m).length ? m : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [emailCooldowns]);

  const sendDocEmail = async (kind: 'quotation' | 'pi', id: number, code: string) => {
    if (!id) { toast.error('Cannot email', 'This record has no server id yet.'); return; }
    const key = `${kind}:${id}`;
    if (emailingRef.current.has(key)) return;
    const left = cooldownLeft(kind, id);
    if (left > 0) {
      toast.warning('Please wait', `You can email this ${kind === 'pi' ? 'PI' : 'quotation'} again in ${left}s (max 3 per minute).`);
      return;
    }
    emailingRef.current.add(key);
    setEmailingKeys(s => new Set(s).add(key));
    const url = kind === 'quotation'
      ? `/sales/quotations/${id}/email`
      : `/sales/proforma-invoices/${id}/email`;
    try {
      const { data } = await api.post(url, { signature: true });
      toast.success('Email sent', `${code} → ${data?.to ?? 'customer'}`);
      const stamp = data?.emailed_at ?? new Date().toISOString();
      const patch = (r: any) => r.id === id ? { ...r, emailedAt: stamp } : r;
      if (kind === 'quotation') setQuotations(rows => rows.map(patch));
      else                       setPis(rows => rows.map(patch));
    } catch (e: any) {
      if (e?.response?.status === 429) {
        const wait = Number(e?.response?.data?.retry_after_seconds) || 60;
        startCooldown(kind, id, wait);
        toast.warning('Please wait', e?.response?.data?.message ?? `Too many attempts — try again in ${wait}s.`);
      } else {
        const msg = e?.response?.data?.message ?? 'Could not send email. Check the customer has a primary email.';
        toast.error('Email failed', String(msg));
      }
    } finally {
      emailingRef.current.delete(key);
      setEmailingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const sendReminder = async (kind: 'quotation' | 'pi', id: number, code: string) => {
    if (!id) { toast.error('Cannot remind', 'This record has no server id yet.'); return; }
    const key = `${kind}:${id}`;
    if (emailingRef.current.has(key)) return;
    emailingRef.current.add(key);
    setEmailingKeys(s => new Set(s).add(key));
    const url = kind === 'quotation'
      ? `/sales/quotations/${id}/remind`
      : `/sales/proforma-invoices/${id}/remind`;
    try {
      const { data } = await api.post(url, { signature: true });
      const n = Number(data?.reminder_count ?? 0);
      toast.success('Reminder sent', `${code} → ${data?.to ?? 'customer'} (#${n})`);
      const patch = (r: any) => r.id === id ? { ...r, reminderCount: n } : r;
      if (kind === 'quotation') setQuotations(rows => rows.map(patch));
      else                       setPis(rows => rows.map(patch));
    } catch (e: any) {
      if (e?.response?.status === 429) {
        toast.warning('Please wait', e?.response?.data?.message ?? 'Too many attempts — try again in a minute.');
      } else {
        const msg = e?.response?.data?.message ?? 'Could not send reminder.';
        toast.error('Reminder failed', String(msg));
      }
    } finally {
      emailingRef.current.delete(key);
      setEmailingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'quotation' | 'pi'; id: number; code: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const url = deleteTarget.kind === 'quotation'
        ? `/sales/quotations/${deleteTarget.id}`
        : `/sales/proforma-invoices/${deleteTarget.id}`;
      await api.delete(url);
      toast.success(
        deleteTarget.kind === 'quotation' ? 'Quotation cancelled' : 'PI cancelled',
        `${deleteTarget.code} has been moved to cancelled status.`,
      );
      if (deleteTarget.kind === 'quotation') reloadQuotations();
      else reloadPis();
      setDeleteTarget(null);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not cancel this record.';
      toast.error('Delete failed', String(msg));
    } finally {
      setDeleting(false);
    }
  };

  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());
  const syncRow = async (kind: 'quotation' | 'pi', id: number | undefined, code: string) => {
    if (!id) { toast.error('Cannot sync', 'This record has no server id yet.'); return; }
    const key = `${kind}:${id}`;
    if (syncingKeys.has(key)) return;
    setSyncingKeys(s => new Set(s).add(key));
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/sync` : `/sales/proforma-invoices/${id}/sync`;
      const { data } = await api.post(url);
      toast.success(kind === 'quotation' ? 'Quotation synced' : 'PI synced', data?.message ?? `${code} synced to Zoho Books.`);
      if (kind === 'quotation') reloadQuotations(); else reloadPis();
    } catch (e: any) {
      toast.error('Zoho sync failed', e?.response?.data?.message ?? 'Could not sync to Zoho Books.');
    } finally {
      setSyncingKeys(s => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const openConvert = (qt: Quotation) => {
    if (!qt.id) {
      toast.error('Cannot convert', 'This quotation has no server id yet.');
      return;
    }
    if (qt.status === 'converted_to_pi') {
      toast.info('Already converted', `${qt.qtNo} has already been converted to a PI.`);
      return;
    }
    if (qt.oppId) {
      const blocker = pis.find(p => p.oppId === qt.oppId);
      if (blocker) {
        setConvertTarget(null);
        setConvertBlocked({ fromQt: qt.qtNo, pi: blocker });
        return;
      }
    }
    setConvertBlocked(null);
    setConvertTarget(qt);
    setConvertPreviewCode(null);
    api.get('/sales/proforma-invoices/preview-code')
      .then(({ data }) => setConvertPreviewCode(data?.data?.code ?? null))
      .catch(() => setConvertPreviewCode(null));
  };

  const confirmConvert = async () => {
    const qt = convertTarget;
    if (!qt || !qt.id) return;
    setConvertingId(qt.id);
    try {
      const { data } = await api.post(`/sales/proforma-invoices/from-quotation/${qt.id}`);
      const newPiCode = data?.data?.code ?? 'a new PI';
      toast.success('Converted to PI', `${qt.qtNo} → ${newPiCode}`);
      reloadQuotations();
      reloadPis();
      setConvertTarget(null);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not convert this quotation.';
      toast.error('Convert failed', String(msg));
      reloadQuotations();
      reloadPis();
      setConvertTarget(null);
    } finally {
      setConvertingId(null);
    }
  };

  const [qtMenuFor, setQtMenuFor] = useState<{ id: string; rect: AnchorRect; payload: Record<string, unknown>; sigId: number | null } | null>(null);
  const [piMenuFor, setPiMenuFor] = useState<{ id: string; rect: AnchorRect; payload: Record<string, unknown>; sigId: number | null } | null>(null);
  const [pdfBusyRowId, setPdfBusyRowId] = useState<number | null>(null);
  const [trackerFor, setTrackerFor] = useState<{ sigId: number; code: string } | null>(null);

  const ActionBtn = (p: {
    title: string;
    icon: React.ReactNode;
    color: string;
    loading?: boolean;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    ariaLabel?: string;
    disabled?: boolean;
    cooling?: boolean;
    badge?: number;
  }) => (
    <Tooltip label={p.title}>
      <button
        type="button"
        aria-label={p.ariaLabel ?? p.title}
        aria-disabled={p.disabled || undefined}
        className={`qpi-act${p.disabled || p.cooling ? ' qpi-act-disabled' : ''}`}
        style={{ ['--qpi-act-accent' as any]: p.color, position: 'relative' }}
        onClick={(e) => { if (p.disabled) { toast.info(p.title); return; } p.onClick(e); }}
      >
        {p.loading
          ? <span aria-label="Working…" role="status" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'qpi-moremenu-spin .7s linear infinite' }} />
          : p.icon}
        {p.badge !== undefined && p.badge > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            minWidth: 16, height: 16, padding: '0 4px',
            background: p.color, color: '#fff',
            borderRadius: 8, fontSize: 9, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #fff', lineHeight: 1,
          }}>{p.badge}</span>
        )}
      </button>
    </Tooltip>
  );

  const renderSignAction = (
    kind: 'quotation' | 'pi', id: number | undefined, code: string,
    customer: string, leadId: number | null | undefined, readOnly: boolean,
  ) => {
    if (!id) return null;
    const sig = sigByRow[`${kind}:${id}`];
    const st = sig?.status;
    const notSent    = st !== 'inprogress' && st !== 'completed';
    const inProgress = st === 'inprogress';
    const signed     = st === 'completed';
    const declined   = st === 'declined' || st === 'recalled';
    const hasSig     = !!sig?.id;
    const signedHint = 'Document already signed — open the history icon to view it.';
    return (
      <>
        {kind === 'pi' && (
          !sigLoaded ? (
            <Tooltip label="Checking signing status…">
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-loading" aria-label="Checking signing status">
                <span className="qpi-send-spin" /><span className="qpi-convert-btn-label">Checking…</span>
              </button>
            </Tooltip>
          ) : signed ? (
            <Tooltip label={signedHint}>
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-signed" aria-label="Signed">
                <IconCheck /><span className="qpi-convert-btn-label">Signed</span>
              </button>
            </Tooltip>
          ) : inProgress ? (
            <Tooltip label="Already sent — awaiting signature">
              <button type="button" disabled className="qpi-convert-btn qpi-send-btn qpi-send-btn-sent" aria-label="Sent">
                <IconPaperPlaneSm /><span className="qpi-convert-btn-label">Sent</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={readOnly ? 'View-only — you don\'t have permission to modify this record.' : declined ? (st === 'recalled' ? 'Recalled — re-send for signature' : 'Declined — re-send for signature') : 'Send for Signature'}>
              <button
                type="button"
                className={`qpi-convert-btn qpi-send-btn${declined ? ' qpi-send-btn-resend' : ''}`}
                disabled={readOnly}
                onClick={() => setSigSendFor({ kind, id, code, customerName: customer || null, leadId: leadId ?? null })}
              >
                <IconPaperPlaneSm /><span className="qpi-convert-btn-label">{declined ? 'Resend for Sign' : 'Send for Sign'}</span>
              </button>
            </Tooltip>
          )
        )}
        <ActionBtn
          title={inProgress ? 'View sent document' : signed ? signedHint : 'No document sent yet'}
          color="#0ea5e9" disabled={!inProgress}
          onClick={() => inProgress && void onViewSentPdf(kind, id)}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>} />
        {kind === 'pi' && (
        <ActionBtn
          title={inProgress ? 'Send signing reminder' : signed ? signedHint : 'Reminders available once the document is sent'}
          color="#f59e0b" disabled={!inProgress}
          onClick={() => inProgress && void onRemindSig(sig!.id)}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} />
        )}
        <ActionBtn
          title={hasSig ? 'Signing tracker' : 'No signing activity yet'}
          color="#7c3aed" disabled={!hasSig}
          onClick={() => hasSig && setTrackerFor({ sigId: sig!.id, code })}
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>} />
      </>
    );
  };

  const oppsWithPi = useMemo(() => {
    const s = new Set<string>();
    for (const p of pis) {
      if (p.oppId) s.add(p.oppId);
      if (p.leadId != null) s.add(`lead:${p.leadId}`);
    }
    return s;
  }, [pis]);
  const oppHasPi = (r: { oppId?: string; leadId?: number | null }): boolean =>
    !!(r.oppId && oppsWithPi.has(r.oppId)) || (r.leadId != null && oppsWithPi.has(`lead:${r.leadId}`));

  const quotationColumns = useMemo<any[]>(() => [
    {
      header: 'Sr No', id: '__sr', meta: { align: 'center' },
      cell: (info: any) => <span className="qpi-srno">{info.row.index + 1}</span>,
    },
    {
      header: 'Quotation No', accessorKey: 'qtNo',
      cell: (info: any) => <span className="qpi-link">{info.getValue()}</span>,
    },
    {
      header: 'Quotation Date', accessorKey: 'qtDate',
      cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Opp ID', accessorKey: 'oppId',
      cell: (info: any) => info.getValue() ? <span className="qpi-link">{info.getValue()}</span> : <span className="qpi-em">—</span>,
    },
    {
      header: 'Opp Date', accessorKey: 'oppDate',
      cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Customer', accessorKey: 'customer',
      cell: (info: any) => <span className="qpi-strong">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Consignee', accessorKey: 'consignee',
      cell: (info: any) => info.getValue()
        ? <span className="qpi-cap">{info.getValue()}</span>
        : <span className="qpi-em">—</span>,
    },
    {
      header: 'Document Type', accessorKey: 'docType',
    },
    {
      header: 'Currency', accessorKey: 'currency',
      cell: (info: any) => {
        const code = displayCurrency(info.getValue(), info.row.original?.docType);
        return code ? <span className="qpi-currency">{code}</span> : <span className="qpi-em">—</span>;
      },
    },
    {
      header: 'Sales Manager', accessorKey: 'salesManager',
      cell: (info: any) => <span className="qpi-sm">{info.getValue() || '—'}</span>,
    },
    {
      header: 'Created By', accessorKey: 'createdBy',
      cell: (info: any) => {
        const r = info.row.original as Quotation;
        return renderCreatorCell(
          r.createdBy, r.createdById, r.creatorUserType, r.branchName,
          currentUser?.id,
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions', meta: { align: 'center' },
      cell: (info: any) => {
        const r = info.row.original as Quotation;
        const readOnly = r.canModify === false;
        const readOnlyHint = 'View-only — you don\'t have permission to modify this record.';
        return (
          <div className="d-inline-flex align-items-center gap-2 justify-content-center">
            {r.status === 'converted_to_pi' ? (
              <Tooltip label="This quotation has already been converted to a PI">
                <button type="button" disabled className="qpi-convert-btn qpi-convert-btn-done" aria-label="Already converted to PI">
                  <IconCheck /><span className="qpi-convert-btn-label">Converted</span>
                </button>
              </Tooltip>
            ) : (
              <Tooltip label={readOnly ? readOnlyHint : oppHasPi(r) ? 'This opportunity already has a Proforma Invoice — its quotations can no longer be converted' : (convertingId === r.id ? 'Converting…' : 'Convert this quotation into a PI')}>
                <button
                  type="button"
                  className="qpi-convert-btn"
                  disabled={readOnly || convertingId === r.id || oppHasPi(r)}
                  onClick={() => { if (oppHasPi(r)) { toast.error('Locked', 'This opportunity already has a Proforma Invoice. No more PIs can be created from its quotations.'); return; } openConvert(r); }}
                >
                  {convertingId === r.id ? <span className="qpi-convert-spinner" aria-hidden /> : <IconRepeatSm />}
                  <span className="qpi-convert-btn-label">
                    {convertingId === r.id ? 'Converting' : 'Convert to PI'}
                  </span>
                </button>
              </Tooltip>
            )}
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('quotation', r.id)
                    ? 'Sending…'
                    : r.id && cooldownLeft('quotation', r.id) > 0
                      ? `Please wait ${cooldownLeft('quotation', r.id)}s (max 3 per minute)`
                      : 'Email Quotation'
              }
              icon={<IconMail />}
              color="#2563eb"
              disabled={readOnly || (isEmailing('quotation', r.id))}
              loading={isEmailing('quotation', r.id)}
              cooling={!!r.id && cooldownLeft('quotation', r.id) > 0}
              onClick={() => r.id && sendDocEmail('quotation', r.id, r.qtNo)}
            />
            {false && (
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('quotation', r.id)
                    ? 'Sending…'
                    : r.emailedAt
                      ? `Send Reminder${r.reminderCount ? ` (#${(r.reminderCount ?? 0) + 1})` : ''}`
                      : 'Send initial email first to enable reminders'
              }
              icon={<IconBellSm />}
              color="#f59e0b"
              disabled={readOnly || !r.emailedAt || (isEmailing('quotation', r.id))}
              badge={r.reminderCount ?? 0}
              onClick={() => r.id && sendReminder('quotation', r.id, r.qtNo)}
            />
            )}
            {(() => {
              const qSigned = r.id ? sigByRow[`quotation:${r.id}`]?.status === 'completed' : false;
              const qConverted = r.status === 'converted_to_pi';
              const oppLocked = !qConverted && oppHasPi(r);
              return (
            <ActionBtn
              title={readOnly ? readOnlyHint : qConverted ? 'Converted to PI — editing locked' : oppLocked ? 'This opportunity already has a Proforma Invoice — its quotations are locked' : qSigned ? 'Quotation signed — editing locked' : 'Edit Quotation'}
              icon={<IconEdit />}
              color="#16a34a"
              disabled={readOnly || qSigned || qConverted || oppLocked}
              onClick={() => {
                if (!r.id) { toast.error('Cannot edit', 'This quotation has no server id yet.'); return; }
                if (qConverted) {
                  toast.error('Locked', 'This quotation has been converted to a PI and cannot be edited. Edit the PI instead.');
                  return;
                }
                if (oppLocked) {
                  toast.error('Locked', 'This opportunity already has a Proforma Invoice. Its quotations can no longer be edited.');
                  return;
                }
                setEditingQuotationId(r.id);
                setCreateQtOpen(true);
              }}
            />
              );
            })()}
            <ActionBtn
              title={(r as any).zoho_status === 'Sync' ? 'Already synced to Zoho Books — sync again' : 'Sync to Zoho Books (Estimate)'}
              icon={<IconZohoSync />}
              color={(r as any).zoho_status === 'Sync' ? '#0d9488' : '#0ea5e9'}
              disabled={readOnly || syncingKeys.has(`quotation:${r.id}`)}
              onClick={() => syncRow('quotation', r.id, r.qtNo)}
            />
            <Tooltip label="More Options">
              <button
                type="button"
                className="qpi-act"
                style={{ ['--qpi-act-accent' as any]: '#7c3aed' }}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  const b = e.currentTarget.getBoundingClientRect();
                  const rect: AnchorRect = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
                  const qSig = r.id ? sigByRow[`quotation:${r.id}`] : undefined;
                  setQtMenuFor(prev => prev?.id === r.qtNo
                    ? null
                    : { id: r.qtNo, rect, payload: piPayloadFromQuotation(r), sigId: qSig?.status === 'completed' ? qSig.id : null, sigStatus: qSig?.status ?? null });
                }}
              >
                <IconKebab />
              </button>
            </Tooltip>
            {(() => {
              const qSigned    = r.id ? sigByRow[`quotation:${r.id}`]?.status === 'completed' : false;
              const qConverted = r.status === 'converted_to_pi';
              const delTitle = readOnly ? readOnlyHint
                : qConverted ? 'Converted to PI — cannot be deleted'
                : qSigned    ? 'Signed quotation cannot be deleted'
                : 'Delete Quotation';
              return (
                <ActionBtn
                  title={delTitle}
                  icon={<IconTrash />}
                  color="#dc2626"
                  disabled={readOnly || qSigned || qConverted}
                  onClick={() => r.id && setDeleteTarget({ kind: 'quotation', id: r.id, code: r.qtNo })}
                />
              );
            })()}
          </div>
        );
      },
    },
  ], [convertingId, sigByRow, currentUser?.id, emailingKeys, emailCooldowns, oppsWithPi]); // eslint-disable-line react-hooks/exhaustive-deps

  const piColumnsBase = (withShipment: boolean): any[] => [
    {
      header: 'Sr No', id: '__sr', meta: { align: 'center' },
      cell: (info: any) => <span className="qpi-srno">{info.row.index + 1}</span>,
    },
    { header: 'PI No', accessorKey: 'piNo',  cell: (info: any) => <span className="qpi-link">{info.getValue()}</span> },
    { header: 'PI Date', accessorKey: 'piDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    ...(withShipment ? [
      { header: 'SHP ID', accessorKey: 'btId',   cell: (info: any) => info.getValue() ? <span className="qpi-bt-badge">{info.getValue()}</span> : <span className="qpi-em">—</span> },
      { header: 'SHP Date', accessorKey: 'btDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    ] : []),
    { header: 'Convert From (Quotation No)', accessorKey: 'convertFrom',
      cell: (info: any) => info.getValue() ? <span className="qpi-qt-badge">{info.getValue()}</span> : <span className="qpi-em">—</span> },
    { header: 'Opp ID', accessorKey: 'oppId',
      cell: (info: any) => info.getValue() ? <span className="qpi-link">{info.getValue()}</span> : <span className="qpi-em">—</span> },
    { header: 'Opp Date', accessorKey: 'oppDate', cell: (info: any) => <span className="qpi-date">{info.getValue() || '—'}</span> },
    { header: 'Customer',  accessorKey: 'customer',  cell: (info: any) => <span className="qpi-strong">{info.getValue() || '—'}</span> },
    { header: 'Consignee', accessorKey: 'consignee', cell: (info: any) => info.getValue()
        ? <span className="qpi-cap">{info.getValue()}</span>
        : <span className="qpi-em">—</span> },
    { header: 'Document Type', accessorKey: 'docType' },
    { header: 'Currency', accessorKey: 'currency',
      cell: (info: any) => {
        const code = displayCurrency(info.getValue(), info.row.original?.docType);
        return code ? <span className="qpi-currency">{code}</span> : <span className="qpi-em">—</span>;
      } },
    { header: 'Sales Manager', accessorKey: 'salesManager',
      cell: (info: any) => <span className="qpi-sm">{info.getValue() || '—'}</span> },
    {
      header: 'Created By', accessorKey: 'createdBy',
      cell: (info: any) => {
        const r = info.row.original as PI;
        return renderCreatorCell(
          r.createdBy, r.createdById, r.creatorUserType, r.branchName,
          currentUser?.id,
        );
      },
    },
    {
      header: () => <div className="text-center">Status</div>,
      id: '__sigstatus', meta: { align: 'center' },
      cell: (info: any) => {
        const r  = info.row.original as PI;
        const st = r.id ? sigByRow[`pi:${r.id}`]?.status : undefined;
        if (st === 'completed')  return <span className="qpi-sig-pill qpi-sig-signed">Signed</span>;
        if (st === 'inprogress') return <span className="qpi-sig-pill qpi-sig-sent">Sent</span>;
        if (st === 'declined')   return <span className="qpi-sig-pill qpi-sig-declined">Declined</span>;
        if (st === 'recalled')   return <span className="qpi-sig-pill qpi-sig-recalled">Recalled</span>;
        return <span className="qpi-sig-pill qpi-sig-none">Not Sent</span>;
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions', meta: { align: 'center' },
      cell: (info: any) => {
        const r = info.row.original as PI;
        const readOnly = r.canModify === false;
        const readOnlyHint = 'View-only — you don\'t have permission to modify this record.';
        return (
          <div className="d-inline-flex align-items-center gap-2 justify-content-center">
            {renderSignAction('pi', r.id, r.piNo, r.customer, r.leadId, readOnly)}
            <ActionBtn
              title={
                readOnly
                  ? readOnlyHint
                  : isEmailing('pi', r.id)
                    ? 'Sending…'
                    : r.id && cooldownLeft('pi', r.id) > 0
                      ? `Please wait ${cooldownLeft('pi', r.id)}s (max 3 per minute)`
                      : 'Email PI'
              }
              icon={<IconMail />}
              color="#2563eb"
              disabled={readOnly || (isEmailing('pi', r.id))}
              loading={isEmailing('pi', r.id)}
              cooling={!!r.id && cooldownLeft('pi', r.id) > 0}
              onClick={() => r.id && sendDocEmail('pi', r.id, r.piNo)}
            />
            {false && (
              <ActionBtn
                title={
                  readOnly
                    ? readOnlyHint
                    : isEmailing('pi', r.id)
                      ? 'Sending…'
                      : r.emailedAt
                        ? `Send Reminder${r.reminderCount ? ` (#${(r.reminderCount ?? 0) + 1})` : ''}`
                        : 'Send initial email first to enable reminders'
                }
                icon={<IconBellSm />}
                color="#f59e0b"
                disabled={readOnly || !r.emailedAt || (isEmailing('pi', r.id))}
                badge={r.reminderCount ?? 0}
                onClick={() => r.id && sendReminder('pi', r.id, r.piNo)}
              />
            )}
            {(() => {
              const pStatus = r.id ? sigByRow[`pi:${r.id}`]?.status : undefined;
              const pSent   = pStatus === 'inprogress';
              const pSigned = pStatus === 'completed';
              const pLocked = !sigLoaded || pSent || pSigned;
              return (
            <ActionBtn
              title={readOnly ? readOnlyHint : !sigLoaded ? 'Checking signature status…' : pSigned ? 'PI signed — editing locked' : pSent ? 'PI sent for signature — editing locked' : 'Edit PI'}
              icon={<IconEdit />}
              color="#16a34a"
              disabled={readOnly || pLocked}
              onClick={() => {
                if (!r.id) { toast.error('Cannot edit', 'This PI has no server id yet.'); return; }
                setEditingPiId(r.id);
                setCreatePiOpen(true);
              }}
            />
              );
            })()}
            <ActionBtn
              title={(r as any).zoho_status === 'Sync' ? 'Already synced to Zoho Books — sync again' : 'Sync to Zoho Books (Invoice)'}
              icon={<IconZohoSync />}
              color={(r as any).zoho_status === 'Sync' ? '#0d9488' : '#0ea5e9'}
              disabled={readOnly || syncingKeys.has(`pi:${r.id}`)}
              onClick={() => syncRow('pi', r.id, r.piNo)}
            />
            <Tooltip label="More Options">
              <button
                type="button"
                className="qpi-act"
                style={{ ['--qpi-act-accent' as any]: '#7c3aed' }}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  const b = e.currentTarget.getBoundingClientRect();
                  const rect: AnchorRect = { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
                  const pSig = r.id ? sigByRow[`pi:${r.id}`] : undefined;
                  setPiMenuFor(prev => prev?.id === r.piNo
                    ? null
                    : { id: r.piNo, rect, payload: piPayloadFromPI(r), sigId: pSig?.status === 'completed' ? pSig.id : null, sigStatus: pSig?.status ?? null });
                }}
              >
                <IconKebab />
              </button>
            </Tooltip>
            {false && (
              <ActionBtn
                title={readOnly ? readOnlyHint : 'Delete PI'}
                icon={<IconTrash />}
                color="#dc2626"
                disabled={readOnly}
                onClick={() => r.id && setDeleteTarget({ kind: 'pi', id: r.id, code: r.piNo })}
              />
            )}
          </div>
        );
      },
    },
  ];
  const piWithColumns    = useMemo<any[]>(() => piColumnsBase(true),  [sigByRow, currentUser?.id, emailingKeys, emailCooldowns]); // eslint-disable-line react-hooks/exhaustive-deps
  const piWithoutColumns = useMemo<any[]>(() => piColumnsBase(false), [sigByRow, currentUser?.id, emailingKeys, emailCooldowns]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qpi-root">
      <style>{SCOPED_CSS}</style>

      <div className="qpi-header">
        <span className="qpi-accent" />
        <span className="qpi-glow" />
        <div className="qpi-header-left">
          <div className="qpi-avatar-wrap">
            <div className="qpi-header-icon"><IconUsers /></div>
            <span className="qpi-online-dot" />
          </div>
          <div>
            <div className="qpi-header-title">Quotations V/S Proforma Invoice</div>
            <div className="qpi-header-sub">Manage quotation creation, customer approval and PI conversion</div>
          </div>
        </div>
        <div className="qpi-tab-switch">
          <button className={`qpi-tab ${tab === 'quotation' ? 'active' : ''}`} onClick={() => switchTab('quotation')}>
            <IconFile /> Quotation <span className="qpi-tab-count">{quotations.length}</span>
          </button>
          <button className={`qpi-tab ${tab === 'pi' ? 'active' : ''}`} onClick={() => switchTab('pi')}>
            <IconMonitor /> Proforma Invoice <span className="qpi-tab-count">{pis.length}</span>
          </button>
        </div>
      </div>

      <div className="qpi-wdh">
        <div className="qpi-wdh-header" onClick={() => setWdhOpen(o => !o)} role="button">
          <div className="qpi-wdh-title">
            <div className="qpi-wdh-icon"><IconUsers /></div>
            <span>Quotations V/S Proforma Invoice — What We Are Doing Here:</span>
          </div>
          <button className="qpi-wdh-toggle" onClick={(e) => { e.stopPropagation(); setWdhOpen(o => !o); }}>
            {wdhOpen ? <IconChevronUpThin /> : <IconChevronDownThin />}
          </button>
        </div>
        {wdhOpen && (
          <div className="qpi-wdh-body">
            {STEPS.map((s, i) => (
              <Fragment key={s.n}>
                <div className="qpi-wdh-step">
                  <div className="qpi-wdh-step-head">
                    <div className="qpi-wdh-step-num">{s.n}</div>
                    <span className="qpi-wdh-step-title">{s.title}</span>
                  </div>
                  <p className="qpi-wdh-step-desc">{s.desc}</p>
                  <span className="qpi-wdh-step-tag"><span className="qpi-wdh-step-dot" />{s.tag}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="qpi-wdh-arrow"><div className="qpi-wdh-arrow-dot"><IconChevronRight /></div></div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="qpi-card" ref={cardRef} style={fillH ? { minHeight: fillH } : undefined}>
        <div className="qpi-tablebar">
          {tab === 'pi' ? (
            <div className="qpi-pill-group">
              <button className={`qpi-pi-subtab ${piSub === 'with' ? 'on' : 'off'}`} onClick={() => switchPiSub('with')}>
                <IconShip /> With Shipment
                <span className="qpi-pi-subtab-count">{piWithShipment.length}</span>
              </button>
              <button className={`qpi-pi-subtab ${piSub === 'without' ? 'on' : 'off'}`} onClick={() => switchPiSub('without')}>
                <IconFileSm /> Without Shipment
                <span className="qpi-pi-subtab-count">{piWithoutShipment.length}</span>
              </button>
            </div>
          ) : (
            <div className="qpi-listpill">
              <span className="qpi-listpill-ico"><IconFile /></span>
              Quotation List
            </div>
          )}
          <div className="qpi-search ui-search-abs">
            <IconSearch />
            <input
              type="text"
              autoComplete="off"
              placeholder="Search by name, ID, company, email, segment..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SearchClear show={q} onClear={() => { setQ(''); }} />
          </div>

          <div className={`qpi-doctype-filter ${docTypeFilter !== 'all' ? 'active' : ''}`}>
            <svg className="qpi-doctype-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            <MasterSelect
              value={docTypeFilter}
              options={[
                { value: 'all', label: 'Doc Type: All Types' },
                { value: 'International', label: 'International' },
                { value: 'Domestic', label: 'Domestic' },
              ]}
              onChange={(v) => setDocTypeFilter((v || 'all') as 'all' | 'International' | 'Domestic')}
            />
          </div>

          {tab === 'quotation' ? (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreateQtOpen(true); }}>
              <IconPlus /> Create Quotation
            </button>
          ) : (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreatePiOpen(true); }}>
              <IconPlus /> Create PI
            </button>
          )}
        </div>

        <div
          className={`qpi-table-host${!(tab === 'quotation' ? loadingQt : loadingPi) && totalRows === 0 ? ' qpi-table-host--empty' : ''}`}
          ref={tableHostRef}
        >
          {(tab === 'quotation' ? loadingQt : loadingPi) ? (
            <ShimmerTable rows={rpp} cols={13} />
          ) : tab === 'quotation' ? (
            <TableContainer
              columns={quotationColumns}
              data={pageRows as Quotation[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search quotations..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('quotation', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          ) : piSub === 'with' ? (
            <TableContainer
              columns={piWithColumns}
              data={pageRows as PI[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search PIs..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('pi', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          ) : (
            <TableContainer
              columns={piWithoutColumns}
              data={pageRows as PI[]}
              isGlobalFilter={false}
              customPageSize={rpp}
              tableClass="table align-middle table-nowrap mb-0"
              theadClass="table-light"
              divClass="table-responsive table-card"
              SearchPlaceholder="Search PIs..."
              condensedPagination
              rowClassName={(row: any) => {
                const rid = Number(row.original?.id);
                const busy = (pdfBusyRowId != null && rid === pdfBusyRowId) || isEmailing('pi', rid);
                return busy ? 'qpi-row-busy' : '';
              }}
            />
          )}

          {!(tab === 'quotation' ? loadingQt : loadingPi) && totalRows === 0 && (
            <div className="qpi-empty">
              {tab === 'quotation' ? 'No quotations found' : 'No proforma invoices found'}
            </div>
          )}
        </div>

        {!(tab === 'quotation' ? loadingQt : loadingPi) && totalRows > 0 && (
          <WorklistPager
            total={totalRows}
            page={safePage}
            pageSize={rpp}
            onPage={setPage}
            onPageSize={(n) => { rppManualRef.current = true; setRpp(n); setPage(1); }}
            pageSizeOptions={QPI_ROWS_OPTIONS}
          />
        )}

        {qtMenuFor && (
          <MoreOptionsMenu
            kind="quotation"
            rect={qtMenuFor.rect}
            payload={qtMenuFor.payload}
            sigId={qtMenuFor.sigId}
            sigStatus={(qtMenuFor as any).sigStatus}
            docCode={qtMenuFor.id}
            onViewSigned={qtMenuFor.sigId != null ? () => onViewSignedSig(qtMenuFor.sigId!) : undefined}
            onDownloadSigned={qtMenuFor.sigId != null ? () => onDownloadSignedSig(qtMenuFor.sigId!, qtMenuFor.id) : undefined}
            onBusyChange={(b) => setPdfBusyRowId(b ? Number(qtMenuFor.payload.id) : null)}
            onClose={() => setQtMenuFor(null)}
            onError={(msg) => toast.error('Preview failed', msg)}
          />
        )}
        {piMenuFor && (
          <MoreOptionsMenu
            kind="pi"
            rect={piMenuFor.rect}
            payload={piMenuFor.payload}
            sigId={piMenuFor.sigId}
            sigStatus={(piMenuFor as any).sigStatus}
            docCode={piMenuFor.id}
            onViewSigned={piMenuFor.sigId != null ? () => onViewSignedSig(piMenuFor.sigId!) : undefined}
            onDownloadSigned={piMenuFor.sigId != null ? () => onDownloadSignedSig(piMenuFor.sigId!, piMenuFor.id) : undefined}
            onBusyChange={(b) => setPdfBusyRowId(b ? Number(piMenuFor.payload.id) : null)}
            onClose={() => setPiMenuFor(null)}
            onError={(msg) => toast.error('Preview failed', msg)}
          />
        )}
        {trackerFor && (
          <SigningTrackerModal sigId={trackerFor.sigId} code={trackerFor.code} onClose={() => setTrackerFor(null)} />
        )}

        <DeleteConfirmModal
          open={!!deleteTarget}
          title={deleteTarget?.kind === 'pi' ? 'Cancel Proforma Invoice' : 'Cancel Quotation'}
          itemName={deleteTarget?.code}
          actionVerb="Cancel"
          confirmLabel="Delete"
          confirmingLabel="Deleting..."
          subMessage={
            deleteTarget?.kind === 'pi'
              ? 'The PI will be marked as cancelled. The record stays in the system for audit but is no longer active.'
              : 'The quotation will be marked as cancelled. The record stays in the system for audit but is no longer active.'
          }
          loading={deleting}
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={onConfirmDelete}
        />

        <ConvertToPiModal
          open={!!convertTarget}
          fromQuotation={convertTarget?.qtNo ?? ''}
          newPiCode={convertPreviewCode}
          piDate={formatDmy(new Date())}
          quotationValue={`${convertTarget?.currency || '$'} ${
            convertTarget?.grandTotal != null ? convertTarget.grandTotal.toFixed(2) : '—'
          }`}
          converting={!!convertTarget?.id && convertingId === convertTarget.id}
          onCancel={() => { if (!convertingId) setConvertTarget(null); }}
          onConfirm={() => void confirmConvert()}
        />

        <ConversionBlockedModal
          open={!!convertBlocked}
          fromQuotation={convertBlocked?.fromQt ?? ''}
          existingPiCode={convertBlocked?.pi.piNo ?? ''}
          existingPiDate={convertBlocked?.pi.piDate ?? null}
          existingPiFromQuotation={convertBlocked?.pi.convertFrom ?? null}
          onClose={() => setConvertBlocked(null)}
          onViewExistingPi={() => { setConvertBlocked(null); switchTab('pi'); }}
        />
      </div>

      {createQtOpen && (
        <CreateQuotationModal
          editId={editingQuotationId}
          onClose={() => { setCreateQtOpen(false); setEditingQuotationId(null); }}
          onSubmit={() => {
            setCreateQtOpen(false);
            setEditingQuotationId(null);
            reloadQuotations();
          }}
        />
      )}
      {createPiOpen && (
        <CreatePIModal
          editId={editingPiId}
          source={piSourceQuotation}
          onClose={() => { setCreatePiOpen(false); setPiSourceQuotation(null); setEditingPiId(null); }}
          onSubmit={() => {
            setCreatePiOpen(false);
            setPiSourceQuotation(null);
            setEditingPiId(null);
            reloadPis();
            if (piSourceQuotation) reloadQuotations();
          }}
        />
      )}

      {sigSendFor && (
        <SalesDocSendForSignatureModal
          open={!!sigSendFor}
          kind={sigSendFor.kind}
          docId={sigSendFor.id}
          docCode={sigSendFor.code}
          leadId={sigSendFor.leadId}
          customerName={sigSendFor.customerName}
          onClose={() => setSigSendFor(null)}
          onSent={(created) => {
            if (created && sigSendFor) {
              const key = `${sigSendFor.kind}:${sigSendFor.id}`;
              setSigByRow(prev => ({ ...prev, [key]: { id: created.id, status: created.status } }));
            }
            setSigTick(t => t + 1);
          }}
        />
      )}
    </div>
  );
}



type BasicFormState = {
  docType: string; opportunity: string; opportunityDate: string;
  customer: string; consignee: string; bankName: string;
  currency: string; exchangeRate: string; incoTerm: string;
  portOfLoading: string; portOfDischarge: string; finalDestination: string;
  originCountry: string;
  stateCode: string;
  dispatchFrom: string;
  deliverTo: string;
  customerGstNo: string;

  oppId: number | null;
  customerId: number | null;
  consigneeId: number | null;
  bankAccountId: number | null;
};

const EMPTY_BASIC: BasicFormState = {
  docType:         'International',
  opportunity:     '',
  opportunityDate: '',
  customer:        '',
  consignee:       '',
  bankName:        '',
  currency:        '',
  exchangeRate:    '',
  incoTerm:        '',
  portOfLoading:   '',
  portOfDischarge: '',
  finalDestination:'',
  originCountry:   '',
  stateCode:       '',
  dispatchFrom:    '',
  deliverTo:       '',
  customerGstNo:   '',
  oppId:           null,
  customerId:      null,
  consigneeId:     null,
  bankAccountId:   null,
};

function seedBasicFromOpp(o: QpiInitialOpp): BasicFormState {
  const custLabel = o.customerCode && o.customerLabel
    ? `${o.customerCode} – ${o.customerLabel}`
    : (o.customerLabel ?? '');
  const consLabel = o.consigneeCode && o.consigneeLabel
    ? `${o.consigneeCode} – ${o.consigneeLabel}`
    : (o.consigneeLabel ?? '');
  return {
    ...EMPTY_BASIC,
    opportunity:     o.customerLabel ? `${o.oppCode} – ${o.customerLabel}` : o.oppCode,
    opportunityDate: o.oppDate ?? '',
    customer:        custLabel,
    customerId:      o.customerId ?? null,
    consignee:       consLabel,
    consigneeId:     o.consigneeId ?? null,
    oppId:           o.oppId,
  };
}

type ProductRow = {
  id: number;
  productId: number | null;
  hsn: string | null;
  name: string;
  qty: number;
  rate: number;
  taxPct: number;
};

function calcRow(p: ProductRow) {
  const sub = p.qty * p.rate;
  const taxUnit = p.rate * (p.taxPct / 100);
  const taxAmt = taxUnit * p.qty;
  const rateWithTax = p.rate * (1 + p.taxPct / 100);
  const amount = sub + taxAmt;
  return { sub, taxUnit, taxAmt, rateWithTax, amount };
}


const stateCodeOf = (label: string): string => {
  const v = (label || '').trim();
  if (!v) return '';
  const head = v.split(' – ')[0]?.trim() ?? '';
  return /^\d{1,2}$/.test(head) ? head : '';
};
const normStateCode = (code: string): string => {
  const t = (code || '').trim();
  return /^\d+$/.test(t) ? String(Number(t)) : '';
};
const DEFAULT_HOME_STATE_CODE = '27';

const TERMS_MAX_LEN = 8000;
const TERMS_LIMIT_MSG = `Limit is ${TERMS_MAX_LEN} characters. Add more against the segment in the T&C master.`;

const isIntraState = (stateCodeLabel: string, homeStateCode: string): boolean => {
  const party = normStateCode(stateCodeOf(stateCodeLabel));
  const home  = normStateCode(homeStateCode) || DEFAULT_HOME_STATE_CODE;
  if (!party) return true;
  return party === home;
};

type TaxSplit = {
  cgstP: number; sgstP: number; igstP: number;
  cgstA: number; sgstA: number; igstA: number;
  cgstAU: number; sgstAU: number; igstAU: number;
};
function splitTax(p: ProductRow, intra: boolean): TaxSplit {
  const base = p.qty * p.rate;
  const gst = p.taxPct;
  const cgstP = intra ? gst / 2 : 0;
  const sgstP = intra ? gst / 2 : 0;
  const igstP = intra ? 0 : gst;
  return {
    cgstP, sgstP, igstP,
    cgstA: base * cgstP / 100,
    sgstA: base * sgstP / 100,
    igstA: base * igstP / 100,
    cgstAU: p.rate * cgstP / 100,
    sgstAU: p.rate * sgstP / 100,
    igstAU: p.rate * igstP / 100,
  };
}

type MasterOpt = {
  value: string;
  label: string;
  id?: number;
  badge?: { text: string; tone?: 'green' | 'red' | 'gray' | 'violet'; title?: string };
  disabled?: boolean;
  disabledReason?: string;
};

function displayProductLabel(rawLabel: string): string {
  const [code, ...rest] = rawLabel.split(' – ');
  return rest.length ? `${formatProductCode(code)} – ${rest.join(' – ')}` : rawLabel;
}

function splitSegmentNames(raw: string | null | undefined): string[] {
  return typeof raw === 'string'
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : [];
}

function partyScopeBadge(country: string | null | undefined): MasterOpt['badge'] {
  const c = (country ?? '').trim();
  if (!c) return undefined;
  return c === 'India'
    ? { text: 'Domestic', tone: 'green', title: 'India — use with a Domestic document' }
    : { text: 'International', tone: 'violet', title: `${c} — use with an International document` };
}
type LeadRow = {
  leadId:          number;
  opp_code:        string;
  sender_company:  string;
  sender_country:  string;
  date:            string;
  customerDbId:    number | null;
  consigneeDbId:   number | null;
  currency:        string | null;
};
type CustomerRow = {
  dbId:      number;
  segmentIds?: number[];
  code:      string;
  company:   string;
  country:   string;
  currency:  string | null;
  stateCode: string;
  gstNumber: string;
  segment:   string | null;
};
type ConsigneeRow = {
  dbId:          number;
  code:          string;
  company:       string;
  customerDbId:  number | null;
  customerDbIds: number[];
  country:       string;
};
type BankRow = {
  dbId:   number;
  label:  string;
};
type ProductMasterRow = {
  dbId:    number;
  code:    string;
  name:    string;
  hsn:     string | null;
  rate:    number;
  taxPct:  number;
  segment: string | null;
  segmentId?: number | null;
  segmentReg?: string | null;
};
type LoadedMasters = {
  currencies:       MasterOpt[];
  incoterms:        MasterOpt[];
  ports:            MasterOpt[];
  portsDischarge:   MasterOpt[];
  countries:        MasterOpt[];
  customers:        MasterOpt[];
  consignees:       MasterOpt[];
  banks:            MasterOpt[];
  opportunities:    MasterOpt[];
  products:         MasterOpt[];
  homeStateCode:    string;
  opportunitiesRaw: LeadRow[];
  customersRaw:     CustomerRow[];
  consigneesRaw:    ConsigneeRow[];
  banksRaw:         BankRow[];
  productsRaw:      ProductMasterRow[];
  loading:          boolean;
};

const QPI_MASTERS_CACHE_TTL_MS = 5 * 60 * 1000;
let qpiMastersCache: {
  data:     LoadedMasters;
  branchId: string;
  loadedAt: number;
} | null = null;
let qpiMastersInFlight: Promise<LoadedMasters> | null = null;

export function invalidateQpiMastersCache() {
  qpiMastersCache    = null;
  qpiMastersInFlight = null;
}

export function prewarmQpiMasters(): void {
  const branch = currentBranchKey();
  if (
    qpiMastersCache
    && qpiMastersCache.branchId === branch
    && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
  ) return;
  if (qpiMastersInFlight) return;
  void loadQpiMasters(branch).catch(() => {});
}

function loadQpiMasters(branch: string): Promise<LoadedMasters> {
  if (qpiMastersInFlight) return qpiMastersInFlight;
  const grab = (url: string) => api
    .get(url)
    .then(r => (r.data ?? {}) as Record<string, unknown>)
    .catch(() => ({} as Record<string, unknown>));

  qpiMastersInFlight = Promise
    .all([grab('/sales/qpi/master-bundle'), grab('/sales/qpi/geo-bundle')])
    .then(([bundle, geo]): LoadedMasters => {
      const b = { ...bundle, ...geo };
      const pick = <T,>(key: string, fallback: T) => ({ data: (b[key] ?? fallback) as T });
      const list  = <T,>(key: string) => pick<T[]>(key, [] as T[]);
      const paged = (key: string) => pick<{ data: unknown[] }>(key, { data: [] });

      const next = shapeQpiMasters(
        list('currencies'),
        list('incoterms'),
        list('port_of_loading'),
        list('port_of_discharge'),
        list('countries'),
        paged('customers'),
        paged('consignees'),
        list('bank_accounts'),
        paged('leads'),
        paged('products'),
        pick('gst_home_state', {}),
      );
      qpiMastersCache    = { data: next, branchId: branch, loadedAt: Date.now() };
      qpiMastersInFlight = null;
      return next;
    })
    .catch((err): never => {
      qpiMastersInFlight = null;
      throw err;
    });
  return qpiMastersInFlight;
}

function shapeQpiMasters(
  cur: any, inco: any, port: any, portDis: any, ctry: any,
  cust: any, cons: any, bank: any, lead: any,
  prod: any, home?: any,
): LoadedMasters {
  const arr = (x: any) => Array.isArray(x?.data?.data) ? x.data.data : (Array.isArray(x?.data) ? x.data : []);
  const optByCode = (rows: any[], codeKey = 'code', nameKey = 'name') =>
    rows.map((r: any) => {
      const code = r[codeKey] ?? '';
      const name = r[nameKey] ?? r.full_name ?? r.title ?? '';
      const label = code && name ? `${code} – ${name}` : (name || code || '');
      return { value: label, label };
    }).filter(o => o.label);
  const INCO_CODE_MAP: Record<string, string> = { EXW: 'EXW', FOB: 'FOB', CIF: 'CIF', CFR: 'C&F', CNF: 'C&F', 'C&F': 'C&F' };
  const INCO_ORDER = ['FOB', 'EXW', 'CIF', 'C&F'];
  const incoSeen = new Set<string>();
  const incoOpts: MasterOpt[] = arr(inco)
    .map((r: any) => {
      const code = INCO_CODE_MAP[String(r.code ?? '').trim().toUpperCase()];
      if (!code || incoSeen.has(code)) return null;
      incoSeen.add(code);
      const name = String(r.full_name ?? r.name ?? '').trim();
      const label = name ? `${code} – ${name}` : code;
      return { id: Number(r.id), value: label, label };
    })
    .filter(Boolean)
    .sort((a: any, b: any) =>
      INCO_ORDER.indexOf(String(a.label).split(/\s|–/)[0]) - INCO_ORDER.indexOf(String(b.label).split(/\s|–/)[0]));

  const customerRows = arr(cust);
  const consigneeRows = arr(cons);
  const bankRows = arr(bank);
  const leadRows = arr(lead);
  const productRows = arr(prod);

  const productOptList: MasterOpt[] = [];
  const productRawList: ProductMasterRow[] = [];
  productRows.forEach((r: any) => {
    const dbId = Number(r.id ?? 0);
    if (!dbId) return;
    const code = String(r.product_code ?? r.code ?? `P-${String(dbId).padStart(2, '0')}`);
    const name = r.name ?? '';
    if (!name) return;
    const label = `${code} – ${name}`;
    productOptList.push({ value: label, label: displayProductLabel(label) });
    const gstPct = Number(
      r.gstPercentage?.percentage
      ?? r.gst_percentage?.percentage
      ?? r.gst_percentage
      ?? (Number(r.base_price) > 0 ? (Number(r.gst_amount) / Number(r.base_price)) * 100 : 0)
    );
    productRawList.push({
      dbId, code, name,
      hsn:    r.hsn?.code ?? r.hsn_code ?? null,
      rate:   Number(r.base_price ?? 0),
      taxPct: isFinite(gstPct) ? Number(gstPct.toFixed(2)) : 0,
      segment: (r.segment?.name ?? '').trim() || null,
      segmentId: r.segment_id ?? r.segment?.id ?? null,
      segmentReg: r.segment?.regulatory_status ?? null,
    });
  });

  const bankOptList: MasterOpt[] = [];
  const bankRawList: BankRow[]   = [];
  bankRows.forEach((r: any) => {
    const dbId = Number(r.id ?? 0);
    if (!dbId) return;
    const name = r.bank_name ?? r.name ?? '';
    const holder = r.account_holder ?? '';
    const label = holder ? `${name} (${holder})` : name;
    if (!label) return;
    bankOptList.push({ value: label, label });
    bankRawList.push({ dbId, label });
  });

  const customerOpts: MasterOpt[] = [];
  const customersRaw: CustomerRow[] = [];
  customerRows.forEach((r: any) => {
    const dbId = Number(r.db_id ?? r.id ?? 0);
    if (!dbId) return;
    const code = String(r.id ?? r.customer_code ?? `C-${String(dbId).padStart(3, '0')}`);
    const co   = r.company ?? r.company_name ?? r.name ?? '';
    const label = `${code} – ${co}`;
    if (!co) return;
    const country = r.country ?? r.country_iso ?? '';
    customerOpts.push({ value: label, label, badge: partyScopeBadge(country) });
    customersRaw.push({
      dbId, code, company: co,
      country,
      currency: r.currency ?? r.default_currency ?? null,
      stateCode: String(r.stateCode ?? r.state_code ?? ''),
      gstNumber: String(r.gstNumber ?? r.gst_number ?? ''),
      segment:   (r.segment ?? '').trim() || null,
      segmentIds: Array.isArray(r.segment_ids) ? r.segment_ids.map(Number).filter(Boolean) : [],
    });
  });
  const consigneeOpts: MasterOpt[] = [];
  const consigneesRaw: ConsigneeRow[] = [];
  consigneeRows.forEach((r: any) => {
    const dbId = Number(r.db_id ?? r.id ?? 0);
    if (!dbId) return;
    const code = String(r.id ?? r.consignee_code ?? `CN-${String(dbId).padStart(3, '0')}`);
    const co   = r.company ?? r.company_name ?? r.name ?? '';
    if (!co) return;
    const label = `${code} – ${co}`;
    consigneeOpts.push({ value: label, label, badge: partyScopeBadge(r.country) });
    const mappedIds: number[] = Array.isArray(r.customer_ids)
      ? r.customer_ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const primaryId = r.customer_id != null ? Number(r.customer_id) : null;
    if (primaryId && !mappedIds.includes(primaryId)) mappedIds.push(primaryId);
    consigneesRaw.push({
      dbId, code, company: co,
      customerDbId: primaryId,
      customerDbIds: mappedIds,
      country: r.country ?? '',
    });
  });
  const opportunityOpts: MasterOpt[] = [];
  const opportunitiesRaw: LeadRow[] = [];
  leadRows.forEach((r: any) => {
    const code = r.opp_code ?? r.opp_id ?? (r.id ? `OPP-${String(r.id).padStart(4, '0')}` : '');
    const who  = (
      r.customer?.company_name
      || r.customer_company_name
      || r.sender_company
      || r.sender_name
      || r.company
      || ''
    ).toString();
    const label = code && who ? `${code} – ${who}` : (code || who || '');
    if (!label) return;
    opportunityOpts.push({ value: label, label });
    const dateSrc = r.query_time ?? r.created_at;
    opportunitiesRaw.push({
      leadId:         Number(r.id ?? 0),
      opp_code:       code,
      sender_company: who,
      sender_country: r.sender_country_iso ?? r.sender_country ?? '',
      date:           dateSrc ? formatDmy(dateSrc) : '',
      customerDbId:   r.customer_id != null ? Number(r.customer_id)
                      : (r.customer?.id != null ? Number(r.customer.id) : null),
      consigneeDbId:  r.consignee_id != null ? Number(r.consignee_id)
                      : (r.consignee?.id != null ? Number(r.consignee.id) : null),
      currency:       r.currency ?? r.quote_currency ?? null,
    });
  });
  return {
    currencies: optByCode(arr(cur)),
    incoterms:  incoOpts,
    ports:         optByCode(arr(port)),
    portsDischarge: optByCode(arr(portDis)),
    countries:  arr(ctry).map((r: any) => ({ value: r.name ?? '', label: r.name ?? '' })).filter((o: MasterOpt) => o.label),
    customers:  customerOpts,
    consignees: consigneeOpts,
    banks:      bankOptList,
    banksRaw:   bankRawList,
    products:   productOptList,
    productsRaw: productRawList,
    homeStateCode: String(home?.data?.data?.state_code ?? '') || DEFAULT_HOME_STATE_CODE,
    opportunities:    opportunityOpts,
    opportunitiesRaw,
    customersRaw,
    consigneesRaw,
    loading: false,
  };
}

function currentBranchKey(): string {
  try {
    const userRaw = localStorage.getItem('cbc_user');
    const user    = userRaw ? JSON.parse(userRaw) : null;
    if (!user?.id) return 'anon';
    const b = localStorage.getItem(`cbc_selected_branch_id_${user.id}`);
    return `${user.id}:${b ?? 'all'}`;
  } catch { return 'anon'; }
}

export function useQpiMasters(open: boolean): LoadedMasters {
  const [state, setState] = useState<LoadedMasters>(() => {
    const branch = currentBranchKey();
    if (
      qpiMastersCache
      && qpiMastersCache.branchId === branch
      && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
    ) return qpiMastersCache.data;
    return {
      currencies: [], incoterms: [], ports: [], portsDischarge: [], countries: [],
      customers: [], consignees: [], banks: [], opportunities: [],
      products: [],
      homeStateCode: DEFAULT_HOME_STATE_CODE,
      opportunitiesRaw: [], customersRaw: [], consigneesRaw: [],
      banksRaw: [], productsRaw: [],
      loading: false,
    };
  });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const branch = currentBranchKey();

    if (
      qpiMastersCache
      && qpiMastersCache.branchId === branch
      && Date.now() - qpiMastersCache.loadedAt < QPI_MASTERS_CACHE_TTL_MS
    ) {
      setState(qpiMastersCache.data);
      if (!qpiMastersInFlight) {
        loadQpiMasters(branch).then(d => { if (!cancelled) setState(d); }).catch(() => {});
      }
      return () => { cancelled = true; };
    }

    if (qpiMastersInFlight) {
      setState(s => ({ ...s, loading: true }));
      qpiMastersInFlight.then(d => { if (!cancelled) setState(d); }).catch(() => {});
      return () => { cancelled = true; };
    }

    setState(s => ({ ...s, loading: true }));
    loadQpiMasters(branch)
      .then(d => { if (!cancelled) setState(d); })
      .catch(() => { if (!cancelled) setState(s => ({ ...s, loading: false })); });
    return () => { cancelled = true; };
  }, [open]);
  return state;
}


export type QpiInitialOpp = {
  oppId:            number;
  oppCode:          string;
  oppDate?:         string;
  customerLabel?:   string;
  customerCode?:    string;
  customerId?:      number | null;
  consigneeLabel?:  string;
  consigneeCode?:   string;
  consigneeId?:     number | null;
};

function useFrozenConsigneeId(
  leadConsigneeId: number | null | undefined,
  initialOpp: QpiInitialOpp | undefined,
  oppId: number | null,
  masters: LoadedMasters,
): number | null {
  return useMemo(() => {
    if (leadConsigneeId)          return leadConsigneeId;
    if (initialOpp?.consigneeId)  return initialOpp.consigneeId;
    if (!oppId)                   return null;
    return masters.opportunitiesRaw.find(o => o.leadId === oppId)?.consigneeDbId ?? null;
  }, [leadConsigneeId, initialOpp?.consigneeId, oppId, masters.opportunitiesRaw]);
}

export function CreateQuotationModal(props: {
  editId: number | null;
  initialOpp?: QpiInitialOpp;
  leadConsigneeId?: number | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { editId, initialOpp, leadConsigneeId, onClose, onSubmit } = props;
  const isEdit = editId != null;
  const toast = useToast();
  useScrollLock();
  useSelectionLock();
  const [step, setStep] = useState<1 | 2>(1);
  const seededFromOpp: BasicFormState = initialOpp ? seedBasicFromOpp(initialOpp) : EMPTY_BASIC;
  const [form, setForm] = useState<BasicFormState>(seededFromOpp);
  const [step1Errors, setStep1Errors] = useState<Set<string>>(new Set());
  const onSaveNext = () => {
    const errs = new Set<string>();
    const labels: Record<string, string> = {
      customer: 'Customer', consignee: 'Consignee', bankName: 'Bank Name',
      incoTerm: 'INCO Term', portOfLoading: 'Port of Loading',
      portOfDischarge: 'Port of Discharge', finalDestination: 'Final Destination',
      originCountry: 'Origin Country', stateCode: 'State Code',
      dispatchFrom: 'Dispatch From', deliverTo: 'Deliver To',
    };
    if (!form.customerId)            errs.add('customer');
    if (!form.consigneeId)           errs.add('consignee');
    if (!form.bankName)              errs.add('bankName');
    if (form.docType === 'International') {
      if (!form.incoTerm)            errs.add('incoTerm');
      if (!form.portOfLoading)       errs.add('portOfLoading');
      if (!form.portOfDischarge)     errs.add('portOfDischarge');
      if (!form.finalDestination)    errs.add('finalDestination');
      if (!form.originCountry)       errs.add('originCountry');
    } else {
      if (form.customerId && !form.stateCode) errs.add('stateCode');
      if (!form.dispatchFrom.trim())          errs.add('dispatchFrom');
      if (!form.deliverTo.trim())             errs.add('deliverTo');
    }
    setStep1Errors(errs);
    if (errs.size > 0) {
      const fillable = Array.from(errs).filter(k => k !== 'stateCode');
      if (fillable.length === 0) {
        toast.error(
          'Customer has no GST state code',
          "State Code is taken from the customer's address. Open this customer's record, set the State, then reopen this form.",
        );
        return;
      }
      toast.error('Missing required fields', `Please fill: ${fillable.map(k => labels[k]).join(', ')}`);
      return;
    }
    setStep(2);
  };
  const masters = useQpiMasters(true);
  const frozenConsigneeId = useFrozenConsigneeId(leadConsigneeId, initialOpp, form.oppId, masters);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  const [saving, setSaving] = useState(false);
  const [existingCode, setExistingCode] = useState<string | null>(null);
  const [existingDate, setExistingDate] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    api.get('/sales/quotations/preview-code')
      .then(({ data }) => { if (!cancelled) setPreviewCode(data?.data?.code ?? null); })
      .catch(() => {  });
    return () => { cancelled = true; };
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    if (masters.loading) return;
    let cancelled = false;
    setHydrating(true);
    api.get(`/sales/quotations/${editId}`)
      .then(({ data }) => {
        if (cancelled) return;
        const r = data?.data;
        if (!r) return;
        setExistingCode(r.code ?? null);
        setExistingDate(r.created_at ? formatDmy(r.created_at) : null);

        const custRow = r.customer_id != null
          ? masters.customersRaw.find(c => c.dbId === r.customer_id) : null;
        const consRow = r.consignee_id != null
          ? masters.consigneesRaw.find(c => c.dbId === r.consignee_id) : null;
        const oppRow  = r.opp_id != null
          ? masters.opportunitiesRaw.find(o => o.leadId === r.opp_id) : null;
        const bankRow = r.bank_account_id != null
          ? masters.banksRaw.find(b => b.dbId === r.bank_account_id) : null;

        setForm({
          docType:          r.doc_type ?? 'International',
          opportunity:      oppRow ? `${oppRow.opp_code} – ${oppRow.sender_company}` : (r.opp_code ?? ''),
          opportunityDate:  r.opportunity_date ? formatDmy(r.opportunity_date) : '',
          customer:         custRow ? `${custRow.code} – ${custRow.company}` : (r.customer_name ?? ''),
          consignee:        consRow ? `${consRow.code} – ${consRow.company}` : (r.consignee_name ?? ''),
          bankName:         bankRow?.label ?? (r.bank_label ?? ''),
          currency:         r.currency ?? '',
          exchangeRate:     r.exchange_rate != null ? String(r.exchange_rate) : '',
          incoTerm:         r.inco_term ?? '',
          portOfLoading:    r.port_of_loading ?? '',
          portOfDischarge:  r.port_of_discharge ?? '',
          finalDestination: r.final_destination ?? '',
          originCountry:    r.origin_country ?? '',
          stateCode:        custRow?.stateCode || (r.state_code ?? ''),
          dispatchFrom:     r.dispatch_from ?? '',
          deliverTo:        r.deliver_to ?? '',
          customerGstNo:    custRow?.gstNumber || (r.customer_gst_no ?? ''),
          oppId:            r.opp_id ?? null,
          customerId:       r.customer_id ?? null,
          consigneeId:      r.consignee_id ?? null,
          bankAccountId:    r.bank_account_id ?? null,
        });

        const items = (Array.isArray(r.items) ? r.items : [])
          .filter((it: any) => it.product_id != null || (it.product_name ?? '').toString().trim() !== '');
        setProducts(items.map((it: any, i: number) => ({
          id:        Date.now() + i,
          productId: it.product_id ?? null,
          hsn:       it.hsn_code ?? null,
          name:      it.product_name ?? '',
          qty:       Number(it.quantity ?? 0),
          rate:      Number(it.rate ?? 0),
          taxPct:    Number(it.tax_pct ?? 0),
        })));
        setTerms(r.terms ?? '');
        setShipping(Number(r.shipping ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load this quotation for editing.'))
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [editId, isEdit, masters.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (saving) return;
    if (!form.customerId) { toast.error('Customer required', 'Pick a customer before saving.'); return; }
    if (!form.consigneeId) { setStep1Errors(prev => new Set(prev).add('consignee')); setStep(1); toast.error('Consignee required', 'Select a consignee before saving.'); return; }
    if (products.length === 0) { toast.error('No products', 'Add at least one line item.'); return; }
    if (terms.length > TERMS_MAX_LEN) { toast.error('Character limit reached', TERMS_LIMIT_MSG); return; }
    setSaving(true);
    const isDomestic = form.docType === 'Domestic';
    try {
      const payload = {
        doc_type:          form.docType,
        opp_id:            form.oppId,
        customer_id:       form.customerId,
        consignee_id:      form.consigneeId,
        bank_account_id:   form.bankAccountId,
        currency:          isDomestic ? 'INR' : (form.currency || null),
        exchange_rate:     form.exchangeRate ? Number(form.exchangeRate) : null,
        inco_term:         form.incoTerm        || null,
        port_of_loading:   form.portOfLoading   || null,
        port_of_discharge: form.portOfDischarge || null,
        final_destination: form.finalDestination|| null,
        origin_country:    form.originCountry   || null,
        state_code:        form.stateCode       || null,
        dispatch_from:     isDomestic ? (form.dispatchFrom  || null) : null,
        deliver_to:        isDomestic ? (form.deliverTo     || null) : null,
        customer_gst_no:   isDomestic ? (form.customerGstNo || null) : null,
        shipping:          Number(shipping) || 0,
        terms:             terms || null,
        items: products.map(p => ({
          product_id:   p.productId,
          product_name: p.name,
          hsn_code:     p.hsn,
          quantity:     Number(p.qty),
          rate:         Number(p.rate),
          tax_pct:      Number(p.taxPct) || 0,
        })),
      };
      if (isEdit) {
        await api.put(`/sales/quotations/${editId}`, payload);
        toast.success('Quotation Updated', `${existingCode ?? 'Quotation'} saved.`);
      } else {
        await api.post('/sales/quotations', payload);
        toast.success('Quotation Created', 'Saved as draft for review');
      }
      onSubmit();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.message
        ?? (data?.errors ? Object.values(data.errors).flat().join(' ') : 'Could not save the quotation.');
      toast.error('Save failed', String(msg));
    } finally {
      setSaving(false);
    }
  };

  const addProduct = () => {
    if (!draft.name) {
      toast.error('Product required', 'Please select a product from the dropdown first.');
      return;
    }
    if (!(draft.qty > 0)) {
      toast.error('Quantity required', 'Enter a quantity greater than 0.');
      return;
    }
    if (!(draft.rate > 0)) {
      toast.error('Rate required', 'Enter a product rate greater than 0.');
      return;
    }
    const dup = draft.productId
      ? products.some(p => p.productId === draft.productId)
      : products.some(p => p.name === draft.name);
    if (dup) {
      toast.error('Already added', `${draft.name} is already in the list. Remove it first to change quantity or rate.`);
      return;
    }
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => {
    const removed = products.find(x => x.id === id);
    setProducts(p => p.filter(x => x.id !== id));
    toast.success('Product removed', removed?.name ? `${removed.name} removed from the list.` : 'Removed from the list.');
  };

  const subTotal = products.reduce((s, p) => s + calcRow(p).sub, 0);
  const taxTotal = products.reduce((s, p) => s + calcRow(p).taxAmt, 0);
  const grandTotal = subTotal + taxTotal + (Number(shipping) || 0);

  return createPortal((
    <div className="qpi-modal-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className={`qpi-modal qpi-modal-teal${saving ? ' qpi-modal-busy' : ''}`}>
        <div className="qpi-modal-head qpi-modal-head-teal">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">
                {isEdit ? 'Edit Quotation' : 'Create Quotation'}
                {hydrating && <span style={{ marginLeft: 10, fontSize: 11, opacity: .8 }}>Loading…</span>}
              </div>
              <div className="qpi-modal-sub">
                {isEdit
                  ? 'Update the quotation details below — saving overwrites the existing record.'
                  : 'Fill in the details to generate a new quotation'}
              </div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation ID</span>
              <span className="qpi-modal-pill-value">{existingCode ?? previewCode ?? 'Auto-assigned'}</span>
            </div>
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation Date</span>
              <span className="qpi-modal-pill-value">{existingDate ?? formatDmy(new Date())}</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} disabled={saving} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic Quotation Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="teal" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="teal" />
        </div>

        <div className="qpi-modal-body">
          {step === 1 && (
            hydrating ? <BasicFormSkeleton theme="teal" /> : (
            <BasicForm
              form={form} setForm={setForm}
              masters={masters} theme="teal"
              titleLabel="Basic Quotation Details" partyKind="Quotation"
              lockParty={!!initialOpp || isEdit}
              lockConsignee={!!frozenConsigneeId}
              lockDocType={isEdit}
              errors={step1Errors}
              clearError={(k) => setStep1Errors(prev => {
                if (!prev.has(k)) return prev;
                const next = new Set(prev); next.delete(k); return next;
              })}
            />
            )
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="teal"
              titleLabel="Quotation"
              productOptions={masters.products}
              productsRaw={masters.productsRaw}
              loadingProducts={masters.loading}
              homeStateCode={masters.homeStateCode}
              customerSegments={splitSegmentNames(
                masters.customersRaw.find(c => c.dbId === form.customerId)?.segment
              )}
              customerSegmentIds={masters.customersRaw.find(c => c.dbId === form.customerId)?.segmentIds}
            />
          )}
        </div>

        <div className="qpi-modal-foot">
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)} disabled={saving}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button className="qpi-btn-next qpi-btn-next-teal" onClick={onSaveNext} disabled={hydrating || saving}>
                Save &amp; Next →
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-teal" onClick={submit} disabled={saving || hydrating}>
                {saving && <span className="qpi-send-spin" />}
                {saving
                  ? (isEdit ? 'Updating…' : 'Saving…')
                  : (isEdit ? '✓ Update Quotation' : '✓ Submit Quotation')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}


export function CreatePIModal(props: {
  editId: number | null;
  source: Quotation | null;
  initialOpp?: QpiInitialOpp;
  leadConsigneeId?: number | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { editId, source, initialOpp, leadConsigneeId, onClose, onSubmit } = props;
  const isEdit = editId != null;
  const toast = useToast();
  useScrollLock();
  useSelectionLock();
  const [step, setStep] = useState<1 | 2>(1);
  const [existingCode, setExistingCode] = useState<string | null>(null);
  const [existingDate, setExistingDate] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    api.get('/sales/proforma-invoices/preview-code')
      .then(({ data }) => { if (!cancelled) setPreviewCode(data?.data?.code ?? null); })
      .catch(() => {  });
    return () => { cancelled = true; };
  }, [isEdit]);

  const seeded: BasicFormState = initialOpp ? seedBasicFromOpp(initialOpp) : source ? {
    ...EMPTY_BASIC,
    opportunity:     source.oppId ? `${source.oppId} – ${source.customer}` : '',
    opportunityDate: source.oppDate ?? '',
    customer:        source.customer ? `${source.customer}` : '',
    consignee:       source.consignee ? `${source.consignee}` : '',
  } : { ...EMPTY_BASIC };
  const [form, setForm] = useState<BasicFormState>(seeded);
  const masters = useQpiMasters(true);
  const frozenConsigneeId = useFrozenConsigneeId(leadConsigneeId, initialOpp, form.oppId, masters);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  const [saving, setSaving] = useState(false);
  const [piType, setPiType] = useState<'with_shipment' | 'without_shipment'>('with_shipment');

  const [step1Errors, setStep1Errors] = useState<Set<string>>(new Set());
  const [docChecking, setDocChecking] = useState(false);
  const onSaveNext = async () => {
    if (docChecking) return;
    const errs = new Set<string>();
    const labels: Record<string, string> = {
      customer: 'Customer', consignee: 'Consignee', bankName: 'Bank Name',
      incoTerm: 'INCO Term', portOfLoading: 'Port of Loading',
      portOfDischarge: 'Port of Discharge', finalDestination: 'Final Destination',
      originCountry: 'Origin Country', stateCode: 'State Code',
      dispatchFrom: 'Dispatch From', deliverTo: 'Deliver To',
    };
    if (!form.customerId)            errs.add('customer');
    if (!form.consigneeId)           errs.add('consignee');
    if (!form.bankName)              errs.add('bankName');
    if (form.docType === 'International') {
      if (!form.incoTerm)            errs.add('incoTerm');
      if (!form.portOfLoading)       errs.add('portOfLoading');
      if (!form.portOfDischarge)     errs.add('portOfDischarge');
      if (!form.finalDestination)    errs.add('finalDestination');
      if (!form.originCountry)       errs.add('originCountry');
    } else {
      if (form.customerId && !form.stateCode) errs.add('stateCode');
      if (!form.dispatchFrom.trim())          errs.add('dispatchFrom');
      if (!form.deliverTo.trim())             errs.add('deliverTo');
    }
    setStep1Errors(errs);
    if (errs.size > 0) {
      const fillable = Array.from(errs).filter(k => k !== 'stateCode');
      if (fillable.length === 0) {
        toast.error(
          'Customer has no GST state code',
          "State Code is taken from the customer's address. Open this customer's record, set the State, then reopen this form.",
        );
        return;
      }
      toast.error('Missing required fields', `Please fill: ${fillable.map(k => labels[k]).join(', ')}`);
      return;
    }

    if (!isEdit) {
      setDocChecking(true);
      try {
        const { data } = await api.get<{ data?: { ok?: boolean; message?: string | null } }>(
          '/sales/proforma-invoices/party-docs-check',
          { params: { customer_id: form.customerId, consignee_id: form.consigneeId } },
        );
        if (data?.data?.ok === false) {
          toast.error(
            'Documents pending',
            data.data.message
              ?? 'Upload the mandatory KYC / Due Diligence / Trade Licence documents for this customer and consignee before creating a PI.',
          );
          return;
        }
      } catch {
      } finally {
        setDocChecking(false);
      }
    }

    setStep(2);
  };

  useEffect(() => {
    if (!isEdit) return;
    if (masters.loading) return;
    let cancelled = false;
    setHydrating(true);
    api.get(`/sales/proforma-invoices/${editId}`)
      .then(({ data }) => {
        if (cancelled) return;
        const r = data?.data;
        if (!r) return;
        setExistingCode(r.code ?? null);
        setExistingDate(r.created_at ? formatDmy(r.created_at) : null);
        setPiType(r.pi_type === 'without_shipment' ? 'without_shipment' : 'with_shipment');

        const custRow = r.customer_id != null
          ? masters.customersRaw.find(c => c.dbId === r.customer_id) : null;
        const consRow = r.consignee_id != null
          ? masters.consigneesRaw.find(c => c.dbId === r.consignee_id) : null;
        const oppRow  = r.opp_id != null
          ? masters.opportunitiesRaw.find(o => o.leadId === r.opp_id) : null;
        const bankRow = r.bank_account_id != null
          ? masters.banksRaw.find(b => b.dbId === r.bank_account_id) : null;

        setForm({
          docType:          r.doc_type ?? 'International',
          opportunity:      oppRow ? `${oppRow.opp_code} – ${oppRow.sender_company}` : (r.opp_code ?? ''),
          opportunityDate:  r.opportunity_date ? formatDmy(r.opportunity_date) : '',
          customer:         custRow ? `${custRow.code} – ${custRow.company}` : (r.customer_name ?? ''),
          consignee:        consRow ? `${consRow.code} – ${consRow.company}` : (r.consignee_name ?? ''),
          bankName:         bankRow?.label ?? (r.bank_label ?? ''),
          currency:         r.currency ?? '',
          exchangeRate:     r.exchange_rate != null ? String(r.exchange_rate) : '',
          incoTerm:         r.inco_term ?? '',
          portOfLoading:    r.port_of_loading ?? '',
          portOfDischarge:  r.port_of_discharge ?? '',
          finalDestination: r.final_destination ?? '',
          originCountry:    r.origin_country ?? '',
          stateCode:        custRow?.stateCode || (r.state_code ?? ''),
          dispatchFrom:     r.dispatch_from ?? '',
          deliverTo:        r.deliver_to ?? '',
          customerGstNo:    custRow?.gstNumber || (r.customer_gst_no ?? ''),
          oppId:            r.opp_id ?? null,
          customerId:       r.customer_id ?? null,
          consigneeId:      r.consignee_id ?? null,
          bankAccountId:    r.bank_account_id ?? null,
        });

        const items = (Array.isArray(r.items) ? r.items : [])
          .filter((it: any) => it.product_id != null || (it.product_name ?? '').toString().trim() !== '');
        setProducts(items.map((it: any, i: number) => ({
          id:        Date.now() + i,
          productId: it.product_id ?? null,
          hsn:       it.hsn_code ?? null,
          name:      it.product_name ?? '',
          qty:       Number(it.quantity ?? 0),
          rate:      Number(it.rate ?? 0),
          taxPct:    Number(it.tax_pct ?? 0),
        })));
        setTerms(r.terms ?? '');
        setShipping(Number(r.shipping ?? 0));
      })
      .catch(() => toast.error('Load failed', 'Could not load this PI for editing.'))
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
  }, [editId, isEdit, masters.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitPi = async () => {
    if (saving) return;
    if (!form.customerId) { toast.error('Customer required', 'Pick a customer before saving.'); return; }
    if (!form.consigneeId) { setStep1Errors(prev => new Set(prev).add('consignee')); setStep(1); toast.error('Consignee required', 'Select a consignee before saving.'); return; }
    if (products.length === 0) { toast.error('No products', 'Add at least one line item.'); return; }
    if (terms.length > TERMS_MAX_LEN) { toast.error('Character limit reached', TERMS_LIMIT_MSG); return; }
    setSaving(true);
    const isDomestic = form.docType === 'Domestic';
    try {
      const payload = {
        pi_type:             piType,
        source_quotation_id: source?.id ?? null,
        doc_type:            form.docType,
        opp_id:              form.oppId,
        customer_id:         form.customerId,
        consignee_id:        form.consigneeId,
        bank_account_id:     form.bankAccountId,
        currency:            isDomestic ? 'INR' : (form.currency || null),
        exchange_rate:       form.exchangeRate ? Number(form.exchangeRate) : null,
        inco_term:           form.incoTerm        || null,
        port_of_loading:     form.portOfLoading   || null,
        port_of_discharge:   form.portOfDischarge || null,
        final_destination:   form.finalDestination|| null,
        origin_country:      form.originCountry   || null,
        state_code:          form.stateCode       || null,
        dispatch_from:       isDomestic ? (form.dispatchFrom  || null) : null,
        deliver_to:          isDomestic ? (form.deliverTo     || null) : null,
        customer_gst_no:     isDomestic ? (form.customerGstNo || null) : null,
        shipping:            Number(shipping) || 0,
        terms:               terms || null,
        items: products.map(p => ({
          product_id:   p.productId,
          product_name: p.name,
          hsn_code:     p.hsn,
          quantity:     Number(p.qty),
          rate:         Number(p.rate),
          tax_pct:      Number(p.taxPct) || 0,
        })),
      };
      if (isEdit) {
        await api.put(`/sales/proforma-invoices/${editId}`, payload);
        toast.success('PI Updated', `${existingCode ?? 'PI'} saved.`);
      } else {
        await api.post('/sales/proforma-invoices', payload);
        toast.success('PI Created', source
          ? `Converted ${source.qtNo} → new draft PI`
          : 'Saved as draft for review');
      }
      onSubmit();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.message
        ?? (data?.errors ? Object.values(data.errors).flat().join(' ') : 'Could not save the PI.');
      toast.error('Save failed', String(msg));
    } finally {
      setSaving(false);
    }
  };

  const addProduct = () => {
    if (!draft.name) {
      toast.error('Product required', 'Please select a product from the dropdown first.');
      return;
    }
    if (!(draft.qty > 0)) {
      toast.error('Quantity required', 'Enter a quantity greater than 0.');
      return;
    }
    if (!(draft.rate > 0)) {
      toast.error('Rate required', 'Enter a product rate greater than 0.');
      return;
    }
    const dup = draft.productId
      ? products.some(p => p.productId === draft.productId)
      : products.some(p => p.name === draft.name);
    if (dup) {
      toast.error('Already added', `${draft.name} is already in the list. Remove it first to change quantity or rate.`);
      return;
    }
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, productId:null, hsn:null, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => {
    const removed = products.find(x => x.id === id);
    setProducts(p => p.filter(x => x.id !== id));
    toast.success('Product removed', removed?.name ? `${removed.name} removed from the list.` : 'Removed from the list.');
  };

  const subTotal = products.reduce((s, p) => s + calcRow(p).sub, 0);
  const taxTotal = products.reduce((s, p) => s + calcRow(p).taxAmt, 0);
  const grandTotal = subTotal + taxTotal + (Number(shipping) || 0);

  return createPortal((
    <div className="qpi-modal-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className={`qpi-modal qpi-modal-purple${saving || docChecking ? ' qpi-modal-busy' : ''}`}>
        <div className="qpi-modal-head qpi-modal-head-purple">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">
                {isEdit ? 'Edit Proforma Invoice (PI)' : 'Create Proforma Invoice (PI)'}
                {hydrating && <span style={{ marginLeft: 10, fontSize: 11, opacity: .8 }}>Loading…</span>}
              </div>
              <div className="qpi-modal-sub">
                {isEdit
                  ? 'Update the PI details below — saving overwrites the existing record.'
                  : 'Fill in the details to generate a new proforma invoice'}
              </div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI No</span>
              <span className="qpi-modal-pill-value">{existingCode ?? previewCode ?? 'Auto-assigned'}</span>
            </div>
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI Date</span>
              <span className="qpi-modal-pill-value">{existingDate ?? formatDmy(new Date())}</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} disabled={saving || docChecking} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic PI Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="purple" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="purple" />
        </div>

        <div className="qpi-modal-body">
          {step === 1 && (
            hydrating ? <BasicFormSkeleton theme="purple" /> : (
            <BasicForm
              form={form} setForm={setForm}
              masters={masters} theme="purple"
              titleLabel="Basic PI Details" partyKind="PI"
              lockParty={!!initialOpp || isEdit}
              lockConsignee={isEdit || !!frozenConsigneeId}
              lockDocType={isEdit}
              errors={step1Errors}
              clearError={(k) => setStep1Errors(prev => {
                if (!prev.has(k)) return prev;
                const next = new Set(prev); next.delete(k); return next;
              })}
            />
            )
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="purple"
              titleLabel="PI"
              productOptions={masters.products}
              productsRaw={masters.productsRaw}
              loadingProducts={masters.loading}
              homeStateCode={masters.homeStateCode}
              customerSegments={splitSegmentNames(
                masters.customersRaw.find(c => c.dbId === form.customerId)?.segment
              )}
              customerSegmentIds={masters.customersRaw.find(c => c.dbId === form.customerId)?.segmentIds}
            />
          )}
        </div>

        <div className="qpi-modal-foot">
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose} disabled={saving || docChecking}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)} disabled={saving || docChecking}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button
                className="qpi-btn-next qpi-btn-next-purple"
                onClick={() => void onSaveNext()}
                disabled={hydrating || docChecking}
              >
                {docChecking && <span className="qpi-send-spin" />}
                {docChecking ? 'Checking documents…' : 'Save & Next →'}
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-purple" onClick={submitPi} disabled={products.length === 0 || saving || hydrating}>
                {saving && <span className="qpi-send-spin" />}
                {saving
                  ? (isEdit ? 'Updating…' : 'Saving…')
                  : (isEdit ? '✓ Update PI' : '✓ Submit PI')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function StepBadge(props: { n: number; title: string; subtitle: string; state: 'idle' | 'active' | 'done'; theme: 'teal' | 'purple' }) {
  const { n, title, subtitle, state, theme } = props;
  return (
    <div className={`qpi-step-badge qpi-step-${state} qpi-step-${theme}`}>
      <div className="qpi-step-badge-num">
        {state === 'done' ? <IconCheck /> : n}
      </div>
      <div>
        <div className="qpi-step-badge-title">{title}</div>
        <div className="qpi-step-badge-sub">{subtitle}</div>
      </div>
    </div>
  );
}

function BasicFormSkeleton({ theme }: { theme: 'teal' | 'purple' }) {
  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>BASIC DETAILS</div>
      <div className="qpi-form-grid">
        {Array.from({ length: 13 }).map((_, i) => (
          <div className="qpi-field" key={i}>
            <span className="qpi-skel qpi-skel-label" />
            <span className="qpi-skel qpi-skel-input" />
          </div>
        ))}
      </div>
      <div className="qpi-skel qpi-skel-note" />
    </>
  );
}

type OppOption = { value: string; label: string; row: LeadRow; badge?: MasterOpt['badge'] };

function OpportunitySelect({
  value, customerId, disabled, excludeWithPi, docType, onPick,
}: {
  value: string;
  customerId: number | null;
  disabled?: boolean;
  excludeWithPi?: boolean;
  docType?: 'International' | 'Domestic';
  onPick: (oppValue: string, row: LeadRow | null) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [items, setItems]     = useState<Array<OppOption>>([]);
  const [page, setPage]       = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);
  const [dropDir, setDropDir]     = useState<'up' | 'down'>('down');

  const mapLead = (r: any): OppOption | null => {
    const code = r.opp_code ?? r.opp_id ?? (r.id ? `OPP-${String(r.id).padStart(4, '0')}` : '');
    const who  = (
      r.customer?.company_name
      || r.customer_company_name
      || r.sender_company
      || r.sender_name
      || r.company
      || ''
    ).toString();
    const label = code && who ? `${code} – ${who}` : (code || who || '');
    if (!label) return null;
    const dateSrc = r.query_time ?? r.created_at;
    const row: LeadRow = {
      leadId:         Number(r.id ?? 0),
      opp_code:       code,
      sender_company: who,
      sender_country: r.sender_country_iso ?? r.sender_country ?? '',
      date:           dateSrc ? formatDmy(dateSrc) : '',
      customerDbId:   r.customer_id != null ? Number(r.customer_id) : (r.customer?.id != null ? Number(r.customer.id) : null),
      consigneeDbId:  r.consignee_id != null ? Number(r.consignee_id) : (r.consignee?.id != null ? Number(r.consignee.id) : null),
      currency:       r.currency ?? r.quote_currency ?? null,
    };
    const badge = partyScopeBadge(r.customer?.primary_address?.country);
    return { value: label, label, row, badge };
  };

  const fetchPage = useCallback(async (pageNum: number, q: string, replace: boolean) => {
    setLoading(true);
    try {
      const res = await api.get<any>('/sales/leads', {
        params: {
          page: pageNum, per_page: 50, with_counts: 0,
          search:      q.trim() || undefined,
          customer_id: customerId || undefined,
          lead_ack_complete: 1,
          exclude_with_pi: excludeWithPi ? 1 : undefined,
          doc_scope:   docType || undefined,
        },
      });
      const rows   = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped = rows.map(mapLead).filter(Boolean) as Array<OppOption>;
      setItems(prev => (replace ? mapped : [...prev, ...mapped]));
      const lastPage = res.data?.pagination?.last_page ?? null;
      setHasMore(lastPage != null ? pageNum < lastPage : mapped.length >= 50);
      setPage(pageNum);
    } catch {
      if (replace) setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [customerId, excludeWithPi, docType]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void fetchPage(1, search, true); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, search, fetchPage]);
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setMenuWidth(rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropDir(spaceBelow < 280 && rect.top > spaceBelow ? 'up' : 'down');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      void fetchPage(page + 1, search, false);
    }
  };

  return (
    <div ref={wrapRef}>
      <Dropdown
        isOpen={open && !disabled}
        toggle={() => { if (!disabled) setOpen(v => !v); }}
        direction={dropDir}
        className={`master-select-wrap${disabled ? ' disabled' : ''}`}
      >
        <DropdownToggle tag="button" type="button" disabled={disabled} className="master-select-toggle">
          {value
            ? <span className="master-select-value">{value}</span>
            : <span className="master-select-placeholder">— Select Opportunity —</span>}
          <i className="ri-arrow-down-s-line master-select-chev" />
        </DropdownToggle>
        <DropdownMenu
          className="master-select-menu"
          container="body"
          strategy="fixed"
          style={menuWidth ? { width: menuWidth, minWidth: menuWidth } : undefined}
        >
          <div className="master-select-search ui-search-abs" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <i className="ri-search-line master-select-search-icon" />
            <input
              type="text"
              className="master-select-search-input"
              autoComplete="off"
              placeholder="Search opportunities…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              autoFocus
            />
            <SearchClear show={search} onClear={() => { setSearch(''); }} />
          </div>
          <div className="master-select-list" ref={listRef} onScroll={onScroll} style={{ maxHeight: 220, overflowY: 'auto' }}>
            {items.length === 0 && !loading ? (
              <div className="master-select-empty">
                {search ? 'No results' : (
                  docType ? (
                    <>
                      <div>No {docType} opportunities</div>
                      <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 3, lineHeight: 1.45 }}>
                        {docType === 'International'
                          ? 'Every qualified opportunity belongs to an Indian customer. Switch Document Type to Domestic, or qualify a lead for a foreign customer.'
                          : 'Every qualified opportunity belongs to a foreign customer. Switch Document Type to International, or qualify a lead for an Indian customer.'}
                      </div>
                    </>
                  ) : 'No opportunities'
                )}
              </div>
            ) : (
              <>
                {items.map(opt => (
                  <DropdownItem
                    key={opt.row.leadId}
                    active={opt.value === value}
                    onClick={() => onPick(opt.value, opt.row)}
                    className="master-select-item"
                  >
                    <span className="master-select-value-text">{opt.label}</span>
                    {opt.badge && <OptBadge b={opt.badge} staticPill />}
                  </DropdownItem>
                ))}
                {loading && <div className="master-select-empty">Loading…</div>}
                {!loading && !hasMore && items.length > 0 && (
                  <div className="master-select-empty" style={{ fontSize: 10.5, opacity: 0.55 }}>— End of list —</div>
                )}
              </>
            )}
          </div>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}

function BasicForm(props: {
  form: BasicFormState; setForm: Dispatch<SetStateAction<BasicFormState>>;
  masters: LoadedMasters;
  theme: 'teal' | 'purple'; titleLabel: string; partyKind: 'Quotation' | 'PI';
  errors?: Set<string>;
  clearError?: (k: string) => void;
  lockParty?: boolean;
  lockConsignee?: boolean;
  lockDocType?: boolean;
}) {
  const { form, setForm, masters, theme, partyKind, errors, clearError, lockParty, lockConsignee, lockDocType } = props;
  const hasError = (k: string) => errors?.has(k) ?? false;
  const set = <K extends keyof BasicFormState>(k: K, v: BasicFormState[K]) => {
    setForm({ ...form, [k]: v });
    if (v && clearError) clearError(k as string);
  };

  const withCurrent = (opts: MasterOpt[], value: string): MasterOpt[] =>
    value && !opts.find(o => o.value === value) ? [...opts, { value, label: value }] : opts;

  const labelCode = (label: string) => (label || '').split(' – ')[0]?.trim() ?? '';

  const selectedCustomerRow = useMemo<CustomerRow | null>(() => {
    if (!form.customer) return null;
    const code = labelCode(form.customer);
    return masters.customersRaw.find(c => c.code === code) ?? null;
  }, [form.customer, masters.customersRaw]);


  const isIndiaCountry = (c?: string | null): boolean => {
    const v = (c ?? '').trim().toLowerCase();
    return v === 'india' || v === 'in' || v === 'ind';
  };
  const custCountry = (
    (form.customerId != null ? masters.customersRaw.find(c => c.dbId === form.customerId) : null)
      ?? selectedCustomerRow
  )?.country?.trim() ?? '';
  const forcedDocType: 'International' | 'Domestic' | null =
    custCountry === '' ? null : (isIndiaCountry(custCountry) ? 'Domestic' : 'International');
  useEffect(() => {
    if (lockDocType || !forcedDocType) return;
    setForm(f => (f.docType === forcedDocType ? f : { ...f, docType: forcedDocType }));
  }, [forcedDocType, lockDocType, setForm]);


  const consigneesForCustomer = useMemo(() => {
    if (!selectedCustomerRow) return masters.consignees;
    const matchValues = new Set(
      masters.consigneesRaw
        .filter(c => c.customerDbIds.includes(selectedCustomerRow.dbId))
        .map(c => `${c.code} – ${c.company}`)
    );
    return masters.consignees.filter(opt => matchValues.has(opt.value));
  }, [selectedCustomerRow, masters.consignees, masters.consigneesRaw]);

  const filteredConsignees = useMemo(
    () => consigneesForCustomer.filter(o => !o.badge?.text || o.badge.text === form.docType),
    [consigneesForCustomer, form.docType],
  );

  const onOpportunityChange = (oppValue: string, providedRow?: LeadRow | null) => {
    const code = labelCode(oppValue);
    const row  = providedRow ?? masters.opportunitiesRaw.find(o => o.opp_code === code);
    if (!row) { setForm({ ...form, opportunity: oppValue, oppId: null }); return; }

    let nextCustomer  = form.customer;
    let nextConsignee = form.consignee;
    let nextCurrency  = form.currency;
    let nextCustomerId: number | null  = form.customerId;
    let nextConsigneeId: number | null = form.consigneeId;
    let nextGstNo     = form.customerGstNo;
    let nextStateCode = form.stateCode;

    const custRow = (row.customerDbId != null
      ? masters.customersRaw.find(c => c.dbId === row.customerDbId)
      : null)
      ?? masters.customersRaw.find(c =>
        c.company && row.sender_company &&
        c.company.trim().toLowerCase() === row.sender_company.trim().toLowerCase());

    if (custRow) {
      nextCustomer    = `${custRow.code} – ${custRow.company}`;
      nextCustomerId  = custRow.dbId;
      if (custRow.currency) nextCurrency = custRow.currency;
      nextGstNo     = custRow.gstNumber;
      nextStateCode = custRow.stateCode;
    }

    if (row.currency) nextCurrency = row.currency;

    if (row.consigneeDbId != null) {
      const conRow = masters.consigneesRaw.find(c => c.dbId === row.consigneeDbId);
      if (conRow) {
        nextConsignee   = `${conRow.code} – ${conRow.company}`;
        nextConsigneeId = conRow.dbId;
      }
    } else if (custRow) {
      const mine = masters.consigneesRaw.filter(c => c.customerDbIds.includes(custRow.dbId));
      if (mine.length === 1) {
        nextConsignee   = `${mine[0].code} – ${mine[0].company}`;
        nextConsigneeId = mine[0].dbId;
      } else if (mine.length === 0) {
        nextConsignee   = '';
        nextConsigneeId = null;
      }
    }

    setForm({
      ...form,
      opportunity:     oppValue,
      opportunityDate: row.date || form.opportunityDate,
      customer:        nextCustomer,
      customerId:      nextCustomerId,
      consignee:       nextConsignee,
      consigneeId:     nextConsigneeId,
      currency:        nextCurrency,
      originCountry:   row.sender_country || form.originCountry,
      oppId:           row.leadId ?? form.oppId,
      customerGstNo:   nextGstNo,
      stateCode:       nextStateCode,
    });
    if (nextStateCode) clearError?.('stateCode');
  };

  const onCustomerChange = (custValue: string) => {
    const cust = masters.customersRaw.find(c => c.code === labelCode(custValue));
    let nextOpportunity = form.opportunity;
    let nextConsignee   = form.consignee;
    let nextCurrency    = form.currency;
    let nextOppId: number | null       = form.oppId;
    let nextConsigneeId: number | null = form.consigneeId;
    let nextGstNo     = '';
    let nextStateCode = '';

    if (cust) {
      if (cust.currency) nextCurrency = cust.currency;

      nextGstNo     = cust.gstNumber;
      nextStateCode = cust.stateCode;

      const oppRow = masters.opportunitiesRaw.find(o => o.opp_code === labelCode(form.opportunity));
      const oppMatches = oppRow && (
        oppRow.customerDbId === cust.dbId ||
        (oppRow.sender_company && oppRow.sender_company.trim().toLowerCase() === cust.company.trim().toLowerCase())
      );
      if (oppRow && !oppMatches) { nextOpportunity = ''; nextOppId = null; }

      const mine = masters.consigneesRaw.filter(c => c.customerDbIds.includes(cust.dbId));
      const stillValid = mine.find(c => `${c.code} – ${c.company}` === form.consignee);
      if (mine.length === 1) {
        nextConsignee   = `${mine[0].code} – ${mine[0].company}`;
        nextConsigneeId = mine[0].dbId;
      } else if (!stillValid) {
        nextConsignee   = '';
        nextConsigneeId = null;
      } else {
        nextConsigneeId = stillValid.dbId;
      }
    }

    setForm({
      ...form,
      customer:      custValue,
      customerId:    cust?.dbId ?? null,
      opportunity:   nextOpportunity,
      oppId:         nextOppId,
      consignee:     nextConsignee,
      consigneeId:   nextConsigneeId,
      currency:      nextCurrency,
      customerGstNo: nextGstNo,
      stateCode:     nextStateCode,
    });
    if (nextStateCode) clearError?.('stateCode');
  };

  const onConsigneeChange = (v: string) => {
    const c = masters.consigneesRaw.find(c => `${c.code} – ${c.company}` === v);
    setForm({ ...form, consignee: v, consigneeId: c?.dbId ?? null });
  };
  const onBankChange = (v: string) => {
    const b = masters.banksRaw.find(b => b.label === v);
    setForm({ ...form, bankName: v, bankAccountId: b?.dbId ?? null });
  };

  useEffect(() => {
    if (masters.loading || !form.customerId) return;
    if (form.customerGstNo && form.stateCode) return;
    const cust = masters.customersRaw.find(c => c.dbId === form.customerId);
    if (!cust) return;
    setForm(f => ({
      ...f,
      customerGstNo: f.customerGstNo || cust.gstNumber,
      stateCode:     f.stateCode     || cust.stateCode,
    }));
  }, [masters.loading, masters.customersRaw, form.customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.oppId) return;
    let cancelled = false;
    api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/products`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.data) ? data.data : [];
        const ccy = rows.map((r: any) => r.currency).find((c: any) => c);
        if (ccy) setForm((f) => ({ ...f, currency: ccy }));
      })
      .catch(() => {  });
    return () => { cancelled = true; };
  }, [form.oppId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>BASIC {partyKind === 'PI' ? 'PI' : 'QUOTATION'} DETAILS</div>

      <div className="qpi-form-grid">
        <Field label="Document Type" required>
          {lockDocType || forcedDocType ? (
            <input className="qpi-input qpi-input-readonly" value={form.docType} readOnly
              title={lockDocType
                ? "Document Type can't be changed when editing — create a new document to switch International / Domestic."
                : `Fixed by the customer's country (${custCountry}) — a ${forcedDocType === 'Domestic' ? 'domestic (Indian)' : 'foreign'} customer only gets ${forcedDocType} documents.`} />
          ) : (
          <MasterSelect
            value={form.docType}
            placeholder="— Select —"
            options={[{ value: 'International', label: 'International' }, { value: 'Domestic', label: 'Domestic' }]}
            onChange={(v) => set('docType', v)}
          />
          )}
        </Field>
        <Field label="Opportunity">
          {lockParty ? (
            <input className="qpi-input qpi-input-readonly" value={form.opportunity} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <OpportunitySelect
              value={form.opportunity}
              customerId={form.customerId}
              excludeWithPi
              docType={form.docType}
              onPick={(val, row) => onOpportunityChange(val, row)}
            />
          )}
        </Field>
        <Field label="Opportunity Date">
          <input className="qpi-input qpi-input-readonly" value={form.opportunityDate} readOnly />
        </Field>

        <Field label="Customer" required error={hasError('customer')}>
          {lockParty ? (
            <input className="qpi-input qpi-input-readonly" value={form.customer} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <MasterSelect
              key={`cust-${masters.customers.length}-${form.docType}`}
              value={form.customer}
              loading={masters.loading}
              placeholder="— Select Customer —"
              options={withCurrent(masters.customers.filter(o => !o.badge?.text || o.badge.text === form.docType), form.customer)}
              onChange={(v) => { onCustomerChange(v); if (v) clearError?.('customer'); }}
            />
          )}
        </Field>
        <Field label="Consignee" required error={hasError('consignee')}>
          {lockConsignee ? (
            <input className="qpi-input qpi-input-readonly" value={form.consignee} readOnly title="Fixed by the lead this was opened from" />
          ) : (
            <MasterSelect
              key={`cons-${filteredConsignees.length}-${form.customer}-${form.docType}`}
              value={form.consignee}
              loading={masters.loading}
              placeholder={form.customer
                ? (filteredConsignees.length === 0
                    ? (consigneesForCustomer.length > 0
                        ? `No ${form.docType} consignee for this customer`
                        : 'No consignees for this customer')
                    : '— Select Consignee —')
                : '— Select Consignee —'}
              options={withCurrent(filteredConsignees, form.consignee)}
              onChange={(v) => { onConsigneeChange(v); if (v) clearError?.('consignee'); }}
            />
          )}
        </Field>
        <Field label="Bank Name" required error={hasError('bankName')}>
          <MasterSelect
            key={`bank-${masters.banks.length}`}
            value={form.bankName}
            loading={masters.loading}
            placeholder="— Select Bank —"
            options={withCurrent(masters.banks, form.bankName)}
            onChange={(v) => { onBankChange(v); if (v) clearError?.('bankName'); }}
          />
        </Field>

        {form.docType === 'Domestic' ? (
          <>
            <Field label="State Code" required error={hasError('stateCode')}>
              <input
                className="qpi-input qpi-input-readonly"
                value={form.stateCode}
                readOnly
                tabIndex={-1}
                placeholder={!form.customerId
                  ? 'Select a customer'
                  : (masters.loading ? 'Loading…' : 'No state code on this customer')}
                title={form.customerId && !form.stateCode
                  ? "This customer's address has no GST state code — set the State on the Customer record."
                  : 'GST state code — auto-fetched from the customer'}
              />
            </Field>
            <Field label="Customer GST No">
              <input
                className="qpi-input qpi-input-readonly"
                value={form.customerGstNo}
                readOnly
                tabIndex={-1}
                placeholder={form.customerId ? 'No GST number on this customer' : 'Select a customer'}
                title={form.customerId
                  ? 'Auto-fetched from the customer master — edit it on the Customer record.'
                  : undefined}
              />
            </Field>
            <Field label="Dispatch From" required error={hasError('dispatchFrom')}>
              <input
                className="qpi-input"
                value={form.dispatchFrom}
                maxLength={255}
                placeholder="Enter dispatch location"
                onChange={(e) => set('dispatchFrom', e.target.value)}
              />
            </Field>
            <Field label="Deliver To" required error={hasError('deliverTo')}>
              <input
                className="qpi-input"
                value={form.deliverTo}
                maxLength={255}
                placeholder="Enter delivery location"
                onChange={(e) => set('deliverTo', e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Currency" required>
              {form.opportunity ? (
                <input
                  className="qpi-input qpi-input-readonly"
                  value={form.currency || ''}
                  readOnly
                  placeholder="Auto — from the opportunity's products"
                  title="Currency is taken from the opportunity's products and cannot be changed here."
                  style={{ cursor: 'not-allowed' }}
                />
              ) : (
                <MasterSelect
                  key={`cur-${masters.currencies.length}`}
                  value={form.currency}
                  loading={masters.loading}
                  placeholder="— Select Currency —"
                  options={withCurrent(
                    masters.currencies.filter((o) => currencyCode(o.value) !== 'INR'),
                    form.currency,
                  )}
                  onChange={(v) => set('currency', v)}
                />
              )}
            </Field>
            <Field label="Exchange Rate">
              <input
                className="qpi-input"
                placeholder="Enter exchange rate"
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => {
                  let v = e.target.value.replace(/[^0-9.]/g, '');
                  const dot = v.indexOf('.');
                  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
                  set('exchangeRate', v);
                }}
              />
            </Field>
            <Field label="INCO Term" required error={hasError('incoTerm')}>
              <MasterSelect
                key={`inco-${masters.incoterms.length}`}
                value={form.incoTerm}
                loading={masters.loading}
                placeholder="— Select INCO Term —"
                options={withCurrent(masters.incoterms, form.incoTerm)}
                onChange={(v) => set('incoTerm', v)}
              />
            </Field>

            <Field label="Port of Loading" required error={hasError('portOfLoading')}>
              <MasterSelect
                key={`pol-${masters.ports.length}`}
                value={form.portOfLoading}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.ports, form.portOfLoading)}
                onChange={(v) => set('portOfLoading', v)}
              />
            </Field>
            <Field label="Port of Discharge" required error={hasError('portOfDischarge')}>
              <MasterSelect
                key={`pod-${masters.portsDischarge.length}`}
                value={form.portOfDischarge}
                loading={masters.loading}
                placeholder="— Select Port —"
                options={withCurrent(masters.portsDischarge, form.portOfDischarge)}
                onChange={(v) => set('portOfDischarge', v)}
              />
            </Field>
            <Field label="Final Destination" required error={hasError('finalDestination')}>
              <input
                className="qpi-input"
                placeholder="Enter final destination"
                maxLength={100}
                value={form.finalDestination}
                onChange={(e) => { const v = e.target.value; set('finalDestination', v.charAt(0).toUpperCase() + v.slice(1)); }}
              />
            </Field>

            <Field label="Origin Country" required error={hasError('originCountry')}>
              <MasterSelect
                key={`oc-${masters.countries.length}`}
                value={form.originCountry}
                loading={masters.loading}
                placeholder="— Select Country —"
                options={withCurrent(masters.countries, form.originCountry)}
                onChange={(v) => set('originCountry', v)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={`qpi-note qpi-note-${theme}`}>
        <span className="qpi-note-icon"><IconWarn /></span>
        <div className="qpi-note-body">
          <div className="qpi-note-line"><strong>Note</strong></div>
          <div className="qpi-note-line">
            <strong>Without Opportunity:</strong> You can create a general {partyKind === 'PI' ? 'PI' : 'quotation'} by directly selecting the customer; ensure the customer is fully created in the system. You do not need to select an Opportunity.
          </div>
          <div className="qpi-note-line">
            <strong>With Opportunity:</strong> Customer and Consignee must be mapped to the selected Opportunity (mandatory).
          </div>
        </div>
      </div>
    </>
  );
}

function Field(props: { label: string; required?: boolean; error?: boolean; children: React.ReactNode }) {
  return (
    <div className={`qpi-field${props.error ? ' has-error' : ''}`}>
      <label className="qpi-field-label">
        {props.label}
        {props.required && <span className="qpi-req-star"> *</span>}
      </label>
      {props.children}
      {props.error && (
        <span className="qpi-field-error-msg">This field is required</span>
      )}
    </div>
  );
}

function ProductsStep(props: {
  form: BasicFormState;
  products: ProductRow[];
  setProducts: (p: ProductRow[]) => void;
  removeProduct: (id: number) => void;
  draft: ProductRow; setDraft: (d: ProductRow) => void;
  addProduct: () => void;
  terms: string; setTerms: (s: string) => void;
  shipping: number; setShipping: (n: number) => void;
  subTotal: number; grandTotal: number;
  theme: 'teal' | 'purple';
  titleLabel: string;
  productOptions: MasterOpt[];
  productsRaw:    ProductMasterRow[];
  loadingProducts: boolean;
  homeStateCode: string;
  customerSegments: string[];
  customerSegmentIds?: number[];
}) {
  const { form, products, removeProduct, draft, setDraft, addProduct, terms, setTerms, shipping, setShipping, subTotal, grandTotal, theme,
          productOptions, productsRaw, loadingProducts, homeStateCode, customerSegments, customerSegmentIds } = props;
  const toast = useToast();

  const termsToastAt = useRef(0);
  const onTermsChange = (next: string) => {
    if (next.length > TERMS_MAX_LEN) {
      setTerms(next.slice(0, TERMS_MAX_LEN));
      const now = performance.now();
      if (now - termsToastAt.current > 3000) {
        termsToastAt.current = now;
        toast.error('Character limit reached', TERMS_LIMIT_MSG);
      }
      return;
    }
    setTerms(next);
  };

  const [allowedProductIds, setAllowedProductIds] = useState<Set<number> | null>(null);
  const [leadPriceMap, setLeadPriceMap] = useState<Map<number, { rate: number; qty: number }>>(new Map());
  const [latestQuotedMap, setLatestQuotedMap] = useState<Map<number, number>>(new Map());
  const [loadingLeadProducts, setLoadingLeadProducts] = useState(false);
  const [resolvedOppId, setResolvedOppId] = useState<unknown>(undefined);

  useEffect(() => {
    if (!form.oppId) {
      setAllowedProductIds(null);
      setLeadPriceMap(new Map());
      setLatestQuotedMap(new Map());
      setResolvedOppId(form.oppId);
      return;
    }
    let cancelled = false;
    setLoadingLeadProducts(true);
    Promise.all([
      api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/products`),
      api.get<{ status: boolean; data: Array<any> }>(`/sales/leads/${form.oppId}/shared-prices`)
        .catch(() => ({ data: { data: [] } })),
    ])
      .then(([prodRes, sharedRes]) => {
        if (cancelled) return;
        const rows = Array.isArray(prodRes.data?.data) ? prodRes.data.data : [];
        const ids = new Set<number>();
        const priceMap = new Map<number, { rate: number; qty: number }>();
        rows.forEach((r) => {
          const pid = Number(r.product_id ?? 0);
          if (!pid) return;
          ids.add(pid);
          priceMap.set(pid, {
            rate: Number(r.target_price ?? 0),
            qty:  Number(r.quantity     ?? 0),
          });
        });
        const sharedRows = Array.isArray(sharedRes.data?.data) ? sharedRes.data.data : [];
        const quotedMap = new Map<number, number>();
        const quotedIds = new Set<number>();
        sharedRows.forEach((s) => {
          const pid = Number(s.product_id ?? 0);
          const price = Number(s.quoted_price ?? 0);
          if (pid && price > 0 && !quotedMap.has(pid)) quotedMap.set(pid, price);
          if (pid) quotedIds.add(pid);
        });
        setAllowedProductIds(quotedIds.size > 0 ? quotedIds : ids);
        setLeadPriceMap(priceMap);
        setLatestQuotedMap(quotedMap);
      })
      .catch(() => {
        if (!cancelled) { setAllowedProductIds(null); setLeadPriceMap(new Map()); setLatestQuotedMap(new Map()); }
      })
      .finally(() => { if (!cancelled) { setLoadingLeadProducts(false); setResolvedOppId(form.oppId); } });
    return () => { cancelled = true; };
  }, [form.oppId]);

  const leadProductsPending = !!form.oppId && resolvedOppId !== form.oppId;

  const customerSegmentKey = customerSegments.join('|').toLowerCase() + '#' + (customerSegmentIds ?? []).join(',');

  const visibleProductOptions = useMemo(() => {
    if (leadProductsPending) return [];

    let opts = productOptions;

    if (allowedProductIds) {
      const allowedLabels = new Set(
        productsRaw.filter(p => allowedProductIds.has(p.dbId))
                   .map(p => `${p.code} – ${p.name}`)
      );
      opts = opts.filter(o => allowedLabels.has(o.value));
    }

    const segmentSet = new Set(customerSegments.map(s => s.toLowerCase()));
    opts = opts.map(o => {
      const code = (o.value || '').split(' – ')[0]?.trim() ?? '';
      const prodRow = productsRaw.find(pr => pr.code === code);
      const seg = prodRow?.segment;
      if (!seg) return o;
      const short = seg.length > 24 ? `${seg.slice(0, 24)}…` : seg;
      const badge = { text: short, tone: 'violet' as const, title: segmentLabel(seg, prodRow?.segmentReg), reg: prodRow?.segmentReg ?? null };
      const offSegment = customerSegmentIds?.length
        ? prodRow?.segmentId != null && !customerSegmentIds.includes(Number(prodRow.segmentId))
        : segmentSet.size > 0 && !segmentSet.has(seg.toLowerCase());
      const fullLabel = `${o.label} · ${segmentLabel(seg, prodRow?.segmentReg)}`;
      return offSegment
        ? { ...o, badge, fullLabel, disabled: true, disabledReason: 'Customer and product segment must match.' }
        : { ...o, badge, fullLabel };
    });

    const addedIds = new Set(
      products.map(p => p.productId).filter((id): id is number => id != null)
    );
    if (addedIds.size > 0) {
      opts = opts.filter(o => {
        const code = (o.value || '').split(' – ')[0]?.trim() ?? '';
        const master = productsRaw.find(pr => pr.code === code);
        return !master || !addedIds.has(master.dbId);
      });
    }

    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadProductsPending, allowedProductIds, productOptions, productsRaw, products, customerSegmentKey]);

  const noMoreProducts = !loadingProducts && !loadingLeadProducts && !leadProductsPending && visibleProductOptions.length === 0;
  const anyProductsLoading = loadingProducts || loadingLeadProducts || leadProductsPending;
  const showAddProductRow  = !anyProductsLoading && visibleProductOptions.length > 0;

  const isIntl = form.docType === 'International';
  const intra = isIntraState(form.stateCode, homeStateCode);
  const taxColCount = isIntl ? 2 : (intra ? 4 : 2);
  const colWidths = isIntl
    ? ['29%', '7%', '11%', '7%', '11%', '12%', '12%', '11%']
    : intra
      ? ['19%', '7%', '10%', '7%', '7%', '10%', '10%', '11%', '8%', '11%']
      : ['25%', '8%', '11%', '9%', '12%', '12%', '12%', '11%'];
  const zeroTaxLines = useMemo(
    () => (isIntl ? [] : products.filter(p => !(p.taxPct > 0))),
    [isIntl, products],
  );
  const taxTotals = useMemo(() => {
    let cgst = 0, sgst = 0, igst = 0;
    products.forEach(p => {
      const t = splitTax(p, intra);
      cgst += t.cgstA; sgst += t.sgstA; igst += t.igstA;
    });
    return { cgst, sgst, igst };
  }, [products, intra]);
  const onProductPick = (label: string) => {
    const code = (label || '').split(' – ')[0]?.trim() ?? '';
    const p = productsRaw.find(pr => pr.code === code);
    if (!p) {
      setDraft({ ...draft, name: label, productId: null, hsn: null });
      return;
    }
    const leadPrice = leadPriceMap.get(p.dbId);
    const latestQuoted = latestQuotedMap.get(p.dbId);
    const samePick = draft.productId === p.dbId;
    setDraft({
      ...draft,
      name:      `${p.code} – ${p.name}`,
      productId: p.dbId,
      hsn:       p.hsn,
      qty:    samePick && draft.qty  > 0 ? draft.qty  : (leadPrice?.qty ?? 0),
      rate:   samePick && draft.rate > 0 ? draft.rate : (latestQuoted ?? leadPrice?.rate ?? p.rate),
      taxPct: isIntl ? 0 : p.taxPct,
    });
  };

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>ORDER SUMMARY</div>

      <div className={`qpi-order-summary qpi-order-summary-${theme}`}>



        <SummaryItem label="Opportunity ID"    value={(form.opportunity.split(' – ')[0] || form.opportunity)} />
        <SummaryItem label="Opportunity Date"  value={form.opportunityDate} />
        <SummaryItem label="Customer ID"       value={form.customer.split(' – ')[0] || ''} />
        <SummaryItem label="Customer Name"     value={form.customer.split(' – ')[1] || form.customer} />
        <SummaryItem label="Consignee ID"      value={form.consignee.split(' – ')[0] || ''} />
        <SummaryItem label="Consignee Name"    value={form.consignee.split(' – ')[1] || form.consignee} />
        <SummaryItem label="Document Type"     value={form.docType} />
        <SummaryItem label="Bank Name"         value={form.bankName} />
        {form.docType === 'International' ? (
          <>
            <SummaryItem label="Currency"          value={form.currency} />
            <SummaryItem label="Exchange Rate"     value={form.exchangeRate} />
            <SummaryItem label="INCO Term"         value={form.incoTerm} />
            <SummaryItem label="Port of Loading"   value={form.portOfLoading} />
            <SummaryItem label="Port of Discharge" value={form.portOfDischarge} />
            <SummaryItem label="Final Destination" value={form.finalDestination} />
            <SummaryItem label="Origin Country"    value={form.originCountry} />
          </>
        ) : (
          <>
            <SummaryItem label="State Code"      value={form.stateCode} />
            <SummaryItem label="Customer GST No" value={form.customerGstNo} />
            <SummaryItem label="Dispatch From"   value={form.dispatchFrom} />
            <SummaryItem label="Deliver To"      value={form.deliverTo} />
            <SummaryItem
              label="Place of Supply"
              value={intra ? 'Intra-state — CGST + SGST' : 'Inter-state — IGST'}
            />
          </>
        )}
      </div>

      {products.length === 0 && (
        <div className="qpi-product-warn">
          <span className="qpi-product-warn-icon"><IconWarn /></span>
          At least 1 product is required to proceed
        </div>
      )}

      {zeroTaxLines.length > 0 && (
        <div className="qpi-product-warn">
          <span className="qpi-product-warn-icon"><IconWarn /></span>
          No GST % set on {zeroTaxLines.map(p => p.name.split(' – ')[0] || p.name).join(', ')} — {zeroTaxLines.length === 1 ? 'this line is' : 'these lines are'} quoted tax-free.
          {' '}Tax comes from the product master; set the GST on the product record to change it.
        </div>
      )}

      <div className="qpi-products-wrap">
        <table className={`qpi-products-table qpi-pt-${theme}${!isIntl && intra ? ' qpi-products-table--wide' : ''}`}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Qty</th>
              <th>Product Rate</th>
              {isIntl ? (
                <><th>Tax %</th><th>Tax Amount</th></>
              ) : intra ? (
                <><th>CGST (%)</th><th>SGST (%)</th><th>CGST Amount</th><th>SGST Amount</th></>
              ) : (
                <><th>IGST (%)</th><th>IGST Amount</th></>
              )}
              <th>Rate with Tax</th>
              <th>Amount</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const c = calcRow(p);
              const t = splitTax(p, intra);
              return (
                <tr key={p.id}>
                  <td><Tooltip label={displayProductLabel(p.name)} themed maxWidth={420}><div className="qpi-prodname-cell">{displayProductLabel(p.name)}</div></Tooltip></td>
                  <td>{p.qty}</td>
                  <td>{p.rate.toFixed(2)}</td>
                  {isIntl ? (
                    <><td>{p.taxPct}</td><td>{c.taxUnit.toFixed(2)}</td></>
                  ) : intra ? (
                    <>
                      <td>{t.cgstP}</td>
                      <td>{t.sgstP}</td>
                      <td>{t.cgstAU.toFixed(2)}</td>
                      <td>{t.sgstAU.toFixed(2)}</td>
                    </>
                  ) : (
                    <>
                      <td>{t.igstP}</td>
                      <td>{t.igstAU.toFixed(2)}</td>
                    </>
                  )}
                  <td>{c.rateWithTax.toFixed(2)}</td>
                  <td className="qpi-amt">{c.amount.toFixed(2)}</td>
                  <td>
                    <Tooltip label="Remove product">
                      <button className="qpi-prod-remove" onClick={() => removeProduct(p.id)} aria-label="Remove product"><IconTrash /></button>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
            {anyProductsLoading && products.length === 0 && Array.from({ length: 3 }).map((_, r) => (
              <tr key={`sk-${r}`} className="qpi-products-skel-row">
                {Array.from({ length: taxColCount + 5 }).map((_, c) => (
                  <td key={c}><span className="qpi-skel" style={{ width: c === 0 ? '78%' : '58%' }} /></td>
                ))}
              </tr>
            ))}
            {showAddProductRow && (
            <tr className="qpi-products-input-row">
              <td>
                <MasterSelect
                  key={`prod-${visibleProductOptions.length}-${form.oppId ?? 'all'}`}
                  value={draft.name}
                  placeholder={
                    loadingProducts || loadingLeadProducts || leadProductsPending
                      ? 'Loading products…'
                      : (form.oppId && visibleProductOptions.length === 0
                          ? 'No products mapped to this opportunity'
                          : '— Select Product —')
                  }
                  options={draft.name && !visibleProductOptions.find(o => o.value === draft.name)
                    ? [...visibleProductOptions, { value: draft.name, label: displayProductLabel(draft.name) }]
                    : visibleProductOptions}
                  onChange={onProductPick}
                  onDisabledClick={() => toast.warning('Segment mismatch', 'Customer and product segment must match to add.')}
                />
              </td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.qty || ''} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })} /></td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.rate || ''} onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })} /></td>
              {(() => {
                const dc = calcRow(draft);
                const dt = splitTax(draft, intra);
                const has = draft.qty > 0 && draft.rate > 0;
                const cell = (val: number) => (
                  <td><input className="qpi-input qpi-input-num qpi-input-readonly" type="text" readOnly tabIndex={-1}
                    value={has ? val.toFixed(2) : '0.00'} /></td>
                );
                const pctCell = (val: number, title?: string) => (
                  <td><input className="qpi-input qpi-input-num qpi-input-readonly" type="text" readOnly tabIndex={-1}
                    title={title} value={String(val)} /></td>
                );
                const taxCells = isIntl
                  ? <>{pctCell(0, 'International documents are tax-free — Tax % is locked at 0%.')}{cell(dc.taxUnit)}</>
                  : intra
                    ? <>{pctCell(dt.cgstP)}{pctCell(dt.sgstP)}{cell(dt.cgstAU)}{cell(dt.sgstAU)}</>
                    : <>{pctCell(dt.igstP)}{cell(dt.igstAU)}</>;
                return <>{taxCells}{cell(dc.rateWithTax)}{cell(dc.amount)}</>;
              })()}
              <td>
                <button className={`qpi-prod-add qpi-prod-add-${theme}`} onClick={addProduct}>
                  <IconPlus /> Add
                </button>
              </td>
            </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qpi-totals-row">
        <div className="qpi-terms">
          <div className={`qpi-form-heading qpi-form-heading-${theme}`}>TERMS &amp; CONDITIONS</div>
          <div style={{ position: 'relative', display: 'flex' }}>
            <textarea
              className="qpi-textarea"
              placeholder="Enter terms and conditions..."
              value={terms}
              onChange={(e) => onTermsChange(e.target.value)}
            />
            <div style={{ position: 'absolute', right: 10, bottom: 8, fontSize: 11, color: terms.length >= TERMS_MAX_LEN ? '#ef4444' : 'var(--vz-secondary-color)', pointerEvents: 'none' }}>
              {terms.length} / {TERMS_MAX_LEN} characters
            </div>
          </div>
        </div>

        <div className={`qpi-summary qpi-summary-${theme}`}>
          <div className="qpi-summary-heading">SUMMARY</div>
          <div className="qpi-summary-line">
            <span>Sub Total</span>
            <span className="qpi-summary-val">{subTotal.toFixed(2)}</span>
          </div>
          {isIntl && (
            <div className="qpi-summary-line">
              <span>Total Tax Amount</span>
              <span className="qpi-summary-val">
                {products.reduce((s, p) => s + calcRow(p).taxAmt, 0).toFixed(2)}
              </span>
            </div>
          )}
          {!isIntl && (intra ? (
            <>
              <div className="qpi-summary-line">
                <span>Total CGST Amount</span>
                <span className="qpi-summary-val">{taxTotals.cgst.toFixed(2)}</span>
              </div>
              <div className="qpi-summary-line">
                <span>Total SGST Amount</span>
                <span className="qpi-summary-val">{taxTotals.sgst.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="qpi-summary-line">
              <span>Total IGST Amount</span>
              <span className="qpi-summary-val">{taxTotals.igst.toFixed(2)}</span>
            </div>
          ))}
          <div className="qpi-summary-line">
            <span>Shipping Cost</span>
            <input
              className="qpi-input qpi-summary-input"
              type="number" min="0"
              placeholder="0"
              style={{ textAlign: 'right' }}
              value={shipping || ''}
              onChange={(e) => setShipping(Number(e.target.value))}
            />
          </div>
          <div className="qpi-summary-grand">
            <span>GRAND TOTAL</span>
            <span className="qpi-summary-val">{grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryItem(props: { label: string; value: string }) {
  const val = props.value || '—';
  return (
    <div className="qpi-summary-item">
      <div className="qpi-summary-item-label">{props.label}</div>
      <div className="qpi-summary-item-value" title={val}>{val}</div>
    </div>
  );
}


const IconUsers = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconBellSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const IconFile = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconFileSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconMonitor = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const IconShip = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l9-5 9 5" /><path d="M5 21l1.5-4h11L19 21" /><path d="M12 7v5" /><path d="M9 7h6" />
  </svg>
);
const IconChevronUpThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 14 12 9 17 14" />
  </svg>
);
const IconChevronDownThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 10 12 15 17 10" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconFilter = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);
const IconMail = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);
const IconEdit = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);
const IconKebab = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
  </svg>
);
const IconZohoSync = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3" />
    <path d="M21 3v5h-5M3 21v-5h5" />
  </svg>
);
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconRepeatSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconPaperPlaneSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);
const IconWarn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);


const SCOPED_CSS = `
.qpi-root {
  font-family: var(--font-sans);
  background: transparent;
  padding: 0;
  margin: 0;
  color: var(--vz-body-color);
  display: flex; flex-direction: column; gap: 8px;
}
.qpi-root *, .qpi-root *::before, .qpi-root *::after { box-sizing: border-box; }

.qpi-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px; min-height: 70px;
  border: 1px solid #c4b5fd; border-radius: 16px;
  background:
    linear-gradient(110deg, #faf7ff 0%, #f4eeff 45%, #efe8ff 75%, #ece4ff 100%) padding-box,
    linear-gradient(125deg, #7c3aed 0%, #8b5cf6 22%, #6366f1 48%, #d946ef 76%, #ec4899 100%) border-box;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.70) inset,
    0 4px 18px rgba(124,58,237,0.16),
    0 1px 4px rgba(99,102,241,0.10);
  font-family: var(--font-sans);
}
.qpi-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background-image:
    radial-gradient(ellipse at 12% 50%, rgba(255,255,255,0.40) 0%, transparent 55%),
    radial-gradient(ellipse at 88% 50%, rgba(167,139,250,0.20) 0%, transparent 55%);
}
.qpi-header::after {
  content: ''; position: absolute; top: 0; left: 14px; right: 14px; height: 1.5px;
  border-radius: 2px; pointer-events: none; z-index: 3; opacity: 0.9; filter: blur(0.4px);
  background: linear-gradient(90deg,
    rgba(255,255,255,0) 0%, rgba(147,197,253,0.30) 14%, rgba(196,181,253,0.55) 30%,
    rgba(253,242,248,0.95) 50%, rgba(232,193,255,0.80) 66%, rgba(168,85,247,0.95) 86%,
    rgba(124,58,237,0.92) 100%);
}
.qpi-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 16px 0 0 16px; }
.qpi-glow   { position: absolute; right: -20px; top: -20px; width: 120px; height: 120px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.qpi-header-left { display: flex; align-items: center; gap: 12px; z-index: 1; padding-left: 6px; }
.qpi-avatar-wrap { position: relative; flex-shrink: 0; }
.qpi-header-icon {
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 14px rgba(91,33,182,0.40), 0 0 0 3px rgba(255,255,255,0.50);
}
.qpi-online-dot { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg,#4ade80,#22c55e); border: 2px solid #f3e8ff; }
.qpi-header-title { font-size: 18px; font-weight: 800; color: #2e1065; letter-spacing: -.3px; line-height: 1.2; }
.qpi-header-sub   { font-size: 12px; color: #6b7280; margin-top: 4px; font-weight: 400; line-height: 1.5; opacity: .85; }

.qpi-tab-switch {
  display: flex; gap: 4px; padding: 4px;
  background: #ffffff;
  border: 1px solid rgba(124,58,237,.2);
  border-radius: 10px;
  position: relative; z-index: 2;
}
.qpi-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 7px; border: none;
  background: transparent; color: #7c3aed;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.qpi-tab:hover { background: rgba(124,58,237,.08); }
.qpi-tab.active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.4); }
.qpi-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(124,58,237,.14); color: #7c3aed;
  font-size: 10.5px; font-weight: 800; line-height: 1;
}
.qpi-tab.active .qpi-tab-count { background: rgba(255,255,255,.25); color: #fff; }
.qpi-sig-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
.qpi-sig-none   { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.qpi-sig-sent   { background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; }
.qpi-sig-signed { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.qpi-sig-declined { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
.qpi-sig-recalled { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
[data-bs-theme="dark"] .qpi-sig-none   { background: rgba(148,163,184,.16); color: #cbd5e1; border-color: rgba(148,163,184,.34); }
[data-bs-theme="dark"] .qpi-sig-sent   { background: rgba(234,179,8,.16);   color: #fde68a; border-color: rgba(234,179,8,.40); }
[data-bs-theme="dark"] .qpi-sig-signed { background: rgba(34,197,94,.16);    color: #86efac; border-color: rgba(34,197,94,.40); }

.qpi-wdh {
  position: relative;
  background: linear-gradient(135deg, #faf5ff 0%, #f3eaff 45%, #ede1ff 100%);
  border: 1px solid #d6c5ff; border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(124,58,237,.10), 0 1px 3px rgba(124,58,237,.06);
}
.qpi-wdh-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 18px; cursor: pointer; user-select: none; transition: background .2s ease; }
.qpi-wdh-header:hover { background: rgba(124,58,237,.05); }
.qpi-wdh-title { display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 700; color: #3b0764; line-height: 1.2; }
.qpi-wdh-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 4px 10px rgba(124,58,237,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
  flex-shrink: 0;
}
.qpi-wdh-toggle {
  width: 32px; height: 32px; border-radius: 50%; border: 0;
  background: rgba(124,58,237,.10);
  color: #6d28d9;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  flex-shrink: 0;
  transition: background .2s ease;
}
.qpi-wdh-toggle:hover { background: rgba(124,58,237,.18); }

.qpi-wdh-body {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 8px; padding: 14px 18px 18px;
}
.qpi-wdh-step {
  background: #fff;
  border: 1px solid rgba(124,58,237,.18);
  border-left: 4px solid #7c3aed;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 110px;
  box-shadow: 0 2px 8px rgba(18,38,63,.04);
  cursor: default;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.qpi-wdh-step:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(124,58,237,.18), 0 2px 6px rgba(124,58,237,.10);
}
.qpi-wdh-step-head { display: flex; align-items: center; gap: 8px; }
.qpi-wdh-step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: linear-gradient(135deg, #7c3aed, #a78bfa); color: #fff;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(124,58,237,.30);
}
.qpi-wdh-step-title { font-size: 14px; font-weight: 700; color: #6d28d9; line-height: 1.2; }
.qpi-wdh-step-desc { font-size: 12px; color: var(--vz-secondary-color, #6b7280); line-height: 1.45; margin: 0; flex: 1; }
.qpi-wdh-step-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 800; color: #7c3aed;
  letter-spacing: .04em; text-transform: uppercase;
  margin-top: auto;
}
.qpi-wdh-step-dot { width: 6px; height: 6px; border-radius: 50%; background: #7c3aed; }

.qpi-wdh-arrow { display: flex; align-items: center; justify-content: center; }
.qpi-wdh-arrow-dot {
  width: 28px; height: 28px; border-radius: 50%;
  background: #fff; border: 1px solid rgba(124,58,237,.22);
  display: flex; align-items: center; justify-content: center;
  color: #7c3aed;
  box-shadow: 0 1px 4px rgba(124,58,237,.12);
}

.qpi-card {
  position: relative;
  background: var(--vz-card-bg, #fff);
  border: 1px solid var(--vz-border-color, #e9ecef);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,.04);
  display: flex;
  flex-direction: column;
}
.qpi-tablebar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(124,58,237,0.04), rgba(167,139,250,0.02));
  border-bottom: 1px solid rgba(124,58,237,0.15);
  position: relative; z-index: 1;
}
.qpi-listpill {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 6px 14px 6px 7px; border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(124,58,237,.2);
  color: #3b0764; font-size: 12.5px; font-weight: 800;
  white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(124,58,237,.08);
}
.qpi-listpill-ico {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; flex-shrink: 0;
}
.qpi-listpill-ico svg { width: 15px; height: 15px; }
[data-bs-theme="dark"] .qpi-listpill,
[data-layout-mode="dark"] .qpi-listpill {
  background: rgba(124,58,237,.10);
  border-color: rgba(167,139,250,.30);
  color: #e9e3ff;
}

.qpi-tabs-bar {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(124,58,237,.15);
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, rgba(124,58,237,.04), rgba(167,139,250,.02));
}

.qpi-pill-group {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(255, 255, 255, .55);
  border: 1px solid rgba(139, 92, 246, .22);
  border-radius: 11px;
  padding: 4px;
  flex-shrink: 0;
}
.qpi-pi-subtab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 0 14px; height: 34px;
  border-radius: 8px;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  letter-spacing: 0; white-space: nowrap;
  transition: background .16s, color .16s, box-shadow .16s, border-color .16s;
}
.qpi-pi-subtab.off {
  background: linear-gradient(135deg, #f5f1fe, #ede9fe);
  border: 1px solid rgba(139,92,246,.2);
  color: #6d28d9;
}
.qpi-pi-subtab.off:hover {
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border-color: rgba(139,92,246,.35);
  color: #5b21b6;
}
.qpi-pi-subtab.on {
  position: relative; overflow: hidden; border: 0;
  background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 35%, #7c3aed 68%, #5b21b6 100%);
  color: #fff;
  box-shadow: 0 5px 14px rgba(124,58,237,.5), 0 1px 0 rgba(255,255,255,.4) inset, 0 -2px 6px rgba(91,33,182,.3) inset;
  text-shadow: 0 1px 2px rgba(76,29,149,.4);
}
.qpi-pi-subtab svg { width: 14px; height: 14px; }
.qpi-pi-subtab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 7px;
  border-radius: 999px;
  font-size: 10px; font-weight: 800; line-height: 1;
}
.qpi-pi-subtab.off .qpi-pi-subtab-count { color: #7c3aed; background: #fff; border: 1px solid #ddd0f7; }
.qpi-pi-subtab.on  .qpi-pi-subtab-count { color: #fff; background: rgba(255,255,255,.24); border: 1px solid rgba(255,255,255,.4); }

.qpi-pi-subtabs { display: contents; }

.qpi-search {
  position: relative;
  flex: 1; min-width: 240px;
  display: flex; align-items: center;
  background: rgba(255,255,255,.85);
  border: 1px solid rgba(124,58,237,.20);
  border-radius: 10px;
  padding: 0 14px 0 38px;
  height: 42px;
  box-shadow: 0 1px 3px rgba(124,58,237,.06);
  transition: border-color .15s, box-shadow .15s;
}
.qpi-search:focus-within {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.15);
}
.qpi-search svg {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px;
  color: var(--vz-secondary-color, #878a99);
}
.qpi-search input {
  flex: 1; height: 100%; border: 0; outline: 0;
  background: transparent;
  font-family: inherit; font-size: 13px;
  color: var(--vz-body-color, #212529);
  font-weight: 500;
}
.qpi-search input::placeholder { color: var(--vz-secondary-color, #878a99); }

.qpi-doctype-filter {
  display: flex; align-items: center;
  position: relative;
  height: 42px;
  flex: 0 0 186px;
  width: 186px; min-width: 186px; max-width: 186px;
}
.qpi-doctype-filter > div { flex: 1 1 auto; width: 100%; min-width: 0; }
.qpi-doctype-filter .master-select-wrap { width: 100% !important; }
.qpi-doctype-filter .master-select-toggle { height: 42px; width: 100% !important; padding-left: 34px !important; }
.qpi-doctype-ico { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #7c3aed; pointer-events: none; z-index: 2; }
[data-bs-theme="dark"] .qpi-doctype-ico { color: #c4b5fd; }
.qpi-doctype-filter .master-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qpi-doctype-filter.active .master-select-toggle { border-color: #7c3aed; background: rgba(124,58,237,.06); }
[data-bs-theme="dark"] .qpi-doctype-filter.active .master-select-toggle { background: rgba(124,58,237,.22); }

.qpi-create-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 22px; height: 42px;
  border: 0; border-radius: 15px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.qpi-create-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(124,58,237,.40);
}
.qpi-create-btn:active { transform: translateY(0); }
.qpi-create-btn svg { width: 16px; height: 16px; }


.qpi-table-host { padding: 14px 14px 1px; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.qpi-table-host > .table-card { margin-bottom: 0 !important; }
.qpi-card .wl-pager { margin-top: 0; }
.qpi-table-host:not(.qpi-table-host--empty) > .table-responsive { flex: 1 0 auto; }
.qpi-table-host .table-responsive {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
  will-change: transform;
  transform: translateZ(0);
}
.qpi-table-host .table-responsive::-webkit-scrollbar { height: 8px; }
.qpi-table-host .table-responsive::-webkit-scrollbar-track { background: transparent; }
.qpi-table-host .table-responsive::-webkit-scrollbar-thumb {
  background: #d1d5db; border-radius: 10px;
  border: 2px solid transparent; background-clip: padding-box;
}
.qpi-table-host .table-responsive::-webkit-scrollbar-thumb:hover {
  background: #9ca3af; background-clip: padding-box;
}
.qpi-table-host .table {
  --bs-table-bg: transparent;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--vz-body-color, #212529);
  margin-bottom: 0 !important;
}
.qpi-table-host .table thead.table-light tr {
  background: linear-gradient(110deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%) !important;
}
.qpi-table-host .table thead.table-light th {
  --bs-table-bg: transparent !important;
  --bs-table-accent-bg: transparent !important;
  background: transparent !important;
  color: #fff !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  letter-spacing: .03em !important;
  text-transform: uppercase;
  padding: 11px 14px !important;
  border-bottom: 0 !important;
  white-space: nowrap;
  vertical-align: middle !important;
  line-height: 1.3 !important;
}
.qpi-table-host .table thead.table-light th > span {
  display: block !important;
  padding: 0 !important;
  margin: 0 !important;
  gap: 0 !important;
  line-height: 1.3;
}
.qpi-table-host .table thead.table-light th[style*="text-align: center"] > span {
  text-align: center;
}
.qpi-table-host .table thead.table-light th:first-child,
.qpi-table-host .table tbody td:first-child { padding-left: 18px !important; }
.qpi-table-host .table thead.table-light th:last-child,
.qpi-table-host .table tbody td:last-child  { padding-right: 18px !important; }

.qpi-table-host .table tbody tr {
  background: transparent;
  transition: background .14s ease;
}
.qpi-table-host .table tbody tr:nth-child(even) td { background: #f4f0ff !important; }
.qpi-table-host .table tbody tr:hover td {
  background: #ece5fb !important;
}
.qpi-table-host .table tbody td {
  --bs-table-bg: transparent !important;
  background: transparent !important;
  padding: 12px 14px !important;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--vz-body-color);
  border-bottom: 1px solid rgba(124,58,237,0.08) !important;
  vertical-align: middle;
  white-space: nowrap;
  line-height: 1.45;
}
.qpi-table-host .table tbody tr:last-child td { border-bottom: 0 !important; }

.qpi-table-host .table thead.table-light th:last-child,
.qpi-table-host .table tbody td:last-child {
  position: sticky; right: 0;
}
.qpi-table-host .table thead.table-light th:last-child {
  background-color: transparent !important;
  background-image: linear-gradient(110deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%) !important;
  background-size: var(--qpi-band-w, 480%) 100% !important;
  background-position: right center !important;
  background-repeat: no-repeat !important;
  z-index: 4;
}
.qpi-table-host .table tbody td:last-child {
  background: #fff !important;
  z-index: 2;
  box-shadow: -10px 0 12px -10px rgba(15,23,42,.18);
}
.qpi-table-host .table tbody tr:hover td:last-child { background: #ece5fb !important; }
[data-bs-theme="dark"] .qpi-table-host {
  --qpi-row-odd:  var(--vz-card-bg, #212529);
  --qpi-row-even: color-mix(in srgb, #7c3aed 6%, var(--vz-card-bg, #212529));
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:nth-child(even) td { background: var(--qpi-row-even) !important; }
[data-bs-theme="dark"] .qpi-table-host .table tbody td:last-child {
  background: var(--qpi-row-odd) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:nth-child(even) td:last-child {
  background: var(--qpi-row-even) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:hover td:last-child {
  background: color-mix(in srgb, #865ce2 8%, var(--qpi-row-odd)) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:nth-child(even):hover td:last-child {
  background: color-mix(in srgb, #865ce2 8%, var(--qpi-row-even)) !important;
}

.qpi-table-host > .row { display: none !important; }

.qpi-pag {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px;
  padding: 10px 18px;
  border-top: 1px solid rgba(124,58,237,.15);
  background: linear-gradient(135deg, rgba(124,58,237,.04), rgba(167,139,250,.02));
}
.qpi-pag-info {
  font-size: 12px; font-weight: 600; color: #6d28d9;
  background: #fff; border: 1px solid rgba(124,58,237,.25);
  padding: 4px 12px; border-radius: 20px;
  font-variant-numeric: tabular-nums;
}
.qpi-pag-info b { color: #3b0764; font-weight: 800; }
.qpi-pag-btns { display: inline-flex; align-items: center; gap: 6px; }
.qpi-pag-btn {
  min-width: 30px; height: 30px; padding: 0 8px;
  border-radius: 50%;
  border: 1.5px solid rgba(124,58,237,.25);
  background: #fff;
  color: #6d28d9;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s, color .15s, box-shadow .2s;
}
.qpi-pag-btn:hover:not(:disabled):not(.on) {
  background: rgba(124,58,237,.08);
  border-color: rgba(124,58,237,.45);
  color: #5b21b6;
}
.qpi-pag-btn.on {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
  cursor: default;
}
.qpi-pag-btn:disabled { opacity: .45; cursor: not-allowed; }
.qpi-pag-arrow { color: #7c3aed; }
[data-bs-theme="dark"] .qpi-pag,
[data-layout-mode="dark"] .qpi-pag {
  border-top-color: rgba(167,139,250,.20);
  background: rgba(124,58,237,.06);
}
[data-bs-theme="dark"] .qpi-pag-info,
[data-layout-mode="dark"] .qpi-pag-info {
  background: rgba(124,58,237,.12); border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-pag-info b { color: #e9e3ff; }
[data-bs-theme="dark"] .qpi-pag-btn,
[data-layout-mode="dark"] .qpi-pag-btn {
  background: rgba(124,58,237,.10); border-color: rgba(167,139,250,.30); color: #c4b5fd;
}
.qpi-table-host > .row > [class^="col-"] { padding: 0; width: auto; flex: 0 0 auto; }
.qpi-table-host .text-muted {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--vz-secondary-color, #878a99) !important;
  font-size: 12.5px; font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.qpi-table-host .text-muted .fw-semibold {
  color: var(--vz-body-color, #212529) !important;
  font-weight: 700;
}
.qpi-table-host .pagination { align-items: center; margin: 0; gap: 4px; }
.qpi-table-host .pagination .page-item { display: inline-flex; }
.qpi-table-host .pagination .page-link {
  border-radius: 8px !important;
  min-width: 32px; height: 32px;
  padding: 0 8px !important;
  display: inline-flex; align-items: center; justify-content: center;
  color: #6d28d9 !important;
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid rgba(124,58,237,0.20) !important;
  font-weight: 600; font-size: 13px; line-height: 1; margin: 0 !important;
  transition: all .15s;
}
.qpi-table-host .pagination .page-link:hover {
  background: rgba(124,58,237,0.08) !important;
  border-color: rgba(124,58,237,0.40) !important;
  color: #5b21b6 !important;
}
.qpi-table-host .pagination .page-item.active .page-link,
.qpi-table-host .pagination .page-link.active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
  border-color: transparent !important;
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(124,58,237,0.30);
}
.qpi-table-host .pagination .page-item.disabled .page-link {
  color: #c4b5fd !important;
  opacity: .6;
}
.qpi-table-host .pagination .page-item:first-child .page-link,
.qpi-table-host .pagination .page-item:last-child  .page-link {
  min-width: 32px; padding: 0;
}
.qpi-table-host .pagination .page-item:first-child .page-link i,
.qpi-table-host .pagination .page-item:last-child  .page-link i {
  font-size: 16px;
  line-height: 1;
}
[data-bs-theme="dark"] .qpi-table-host > .row,
[data-layout-mode="dark"] .qpi-table-host > .row {
  border-top: none;
  background: transparent;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(167,139,250,0.25) !important;
  color: #c4b5fd !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link:hover,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link:hover {
  background: rgba(124,58,237,0.20) !important;
  border-color: rgba(167,139,250,0.45) !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.active .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
  border-color: transparent !important;
  color: #fff !important;
}

.qpi-empty {
  text-align: center !important;
  padding: 56px 12px !important;
  color: #9ca3af;
  font-size: 13px; font-style: normal;
}
.qpi-table-host--empty > .qpi-empty {
  flex: 1 1 auto;
  display: flex; align-items: center; justify-content: center;
}

.qpi-srno { color: var(--vz-body-color, #495057); font-weight: 600; font-size: 13px; }

.qpi-link {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 999px;
  background: #ece6ff; color: #5a3fd1;
  font-family: var(--vz-font-monospace, 'JetBrains Mono', ui-monospace, monospace);
  font-weight: 700; font-size: 11.5px;
  letter-spacing: .02em;
  text-decoration: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.qpi-link:hover {
  background: #ddd0ff; color: #4a32b2;
  text-decoration: none;
}

.qpi-strong { color: #0f1729; font-weight: 600; font-size: 13px; text-transform: capitalize; }
.qpi-cap { text-transform: capitalize; }

.qpi-branch-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.qpi-branch-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1e293b;
  text-transform: capitalize;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qpi-branch-main {
  display: inline-block;
  padding: 2px 6px;
  background: #ede9fe;
  color: #6d28d9;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  border-radius: 5px;
  border: 1px solid #ddd6fe;
  line-height: 1.2;
}
[data-bs-theme="dark"] .qpi-branch-name { color: #e2e8f0; }
[data-bs-theme="dark"] .qpi-branch-main {
  background: rgba(167,139,250,.18);
  color: #c4b5fd;
  border-color: rgba(167,139,250,.30);
}

.qpi-date {
  font-variant-numeric: tabular-nums;
  letter-spacing: .01em;
  color: var(--vz-secondary-color, #878a99);
  font-weight: 500;
  font-size: 13px;
}

.qpi-currency {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  background: #ece6ff; color: #5a3fd1;
  font-size: 11px; font-weight: 600;
  letter-spacing: .02em;
  font-family: var(--vz-font-monospace, 'JetBrains Mono', ui-monospace, monospace);
  white-space: nowrap;
}

.qpi-sm { color: var(--vz-body-color, #495057); font-weight: 500; font-size: 13px; }
.qpi-em { color: #cbd5e1; font-weight: 400; }
.qpi-em-center { text-align: center; color: #cbd5e1; font-weight: 400; }

.qpi-creator-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}
.qpi-creator-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}
.qpi-creator-sub {
  font-size: 10.5px;
  color: var(--vz-secondary-color, #878a99);
}
[data-bs-theme="dark"] .qpi-creator-sub { color: rgba(255,255,255,.55); }
[data-bs-theme="dark"] .qpi-creator-self   { background: rgba(99,102,241,.20) !important;  color: #c7d2fe !important; }
[data-bs-theme="dark"] .qpi-creator-super  { background: rgba(139,92,246,.20) !important;  color: #ddd6fe !important; }
[data-bs-theme="dark"] .qpi-creator-client { background: rgba(59,130,246,.20) !important;   color: #bfdbfe !important; }
[data-bs-theme="dark"] .qpi-creator-branch { background: rgba(20,184,166,.20) !important;   color: #99f6e4 !important; }
[data-bs-theme="dark"] .qpi-creator-other  { background: rgba(148,163,184,.20) !important;  color: #cbd5e1 !important; }

.qpi-bt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 20px;
  border: 1.5px solid #5eead4; background: #f0fdfa;
  color: #0f766e; font-size: 11px; font-weight: 800;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.qpi-qt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 20px;
  border: 1.5px solid #ddd6fe; background: #faf5ff;
  color: #6d28d9; font-size: 11px; font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.qpi-actions {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; flex-wrap: nowrap;
}

.qpi-convert-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 132px;
  padding: 0 12px; height: 30px;
  border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  font-family: inherit; font-size: 11.5px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  box-shadow: 0 3px 10px rgba(124,58,237,.30);
  transition: transform .15s, box-shadow .15s, background .18s;
}
.qpi-convert-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(124,58,237,.40);
}
.qpi-convert-btn:active:not(:disabled) { transform: translateY(0); }
.qpi-convert-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(124,58,237,.25), 0 3px 10px rgba(124,58,237,.30);
}
.qpi-convert-btn:disabled { opacity: .65; cursor: wait; }
.qpi-convert-spinner {
  width: 13px; height: 13px; flex: 0 0 auto; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  animation: qpi-convert-spin .7s linear infinite;
}
@keyframes qpi-convert-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .qpi-convert-spinner { animation-duration: 2s; } }
.qpi-convert-btn svg { width: 12px; height: 12px; }

.qpi-convert-btn-done,
.qpi-convert-btn-done:disabled {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.25);
  opacity: 1;
  cursor: not-allowed;
}
.qpi-convert-btn-done:hover { transform: none; }

.qpi-send-btn {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  box-shadow: 0 3px 10px rgba(14,165,233,.30);
}
.qpi-send-btn:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(14,165,233,.40); }
.qpi-send-btn:disabled { cursor: not-allowed; }
.qpi-send-btn-sent, .qpi-send-btn-sent:disabled {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  box-shadow: none;
  opacity: .55; cursor: not-allowed;
}
.qpi-send-btn-sent:hover { transform: none; }
.qpi-send-btn-signed, .qpi-send-btn-signed:disabled {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.25);
  opacity: 1; cursor: not-allowed;
}
.qpi-send-btn-signed:hover { transform: none; }
.qpi-send-btn-resend {
  background: linear-gradient(135deg, #f97316, #dc2626);
  box-shadow: 0 3px 10px rgba(220,38,38,.30);
}
.qpi-send-btn-resend:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(220,38,38,.42); }
.qpi-send-btn-loading, .qpi-send-btn-loading:disabled {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 3px 10px rgba(124,58,237,.28);
  opacity: 1; cursor: wait;
}
.qpi-send-spin {
  display: inline-block; width: 11px; height: 11px;
  border: 2px solid rgba(255,255,255,.45); border-top-color: #fff;
  border-radius: 50%; animation: qpi-send-spin-rot .6s linear infinite;
}
@keyframes qpi-send-spin-rot { to { transform: rotate(360deg); } }

.qpi-signed-btn {
  background: linear-gradient(135deg, #16a34a, #15803d);
  box-shadow: 0 3px 10px rgba(22,163,74,.28);
}
.qpi-signed-btn:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(22,163,74,.42);
}
.qpi-signed-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(22,163,74,.28), 0 3px 10px rgba(22,163,74,.28);
}

.qpi-act {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; padding: 0;
  background: #f6f4ff;
  background: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 10%, #fff);
  border: 1px solid #e5e0f5;
  border: 1px solid color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 38%, #fff);
  color: var(--qpi-act-accent, #7c3aed);
  transition: background .15s ease, border-color .15s ease, color .15s ease,
              transform .15s ease, box-shadow .15s ease;
}
.qpi-act:hover {
  background: var(--qpi-act-accent, #7c3aed);
  border-color: transparent;
  color: #fff;
  transform: scale(1.08);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 45%, transparent);
}
.qpi-act:active { transform: translateY(0) scale(1); }
.qpi-act-disabled,
.qpi-act:disabled,
.qpi-act[disabled] {
  cursor: not-allowed;
  opacity: 0.5;
  background: var(--vz-secondary-bg, #f3f3f9) !important;
  color: var(--vz-secondary-color, #878a99) !important;
  border-color: var(--vz-border-color, #e9ecef) !important;
}
.qpi-act-disabled:hover,
.qpi-act:disabled:hover,
.qpi-act[disabled]:hover {
  transform: none;
  box-shadow: none;
  background: var(--vz-secondary-bg, #f3f3f9) !important;
  color: var(--vz-secondary-color, #878a99) !important;
}
.qpi-act:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 25%, transparent);
}
.qpi-act svg { width: 14px; height: 14px; }

.qpi-moremenu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 14px 32px rgba(15,23,42,.20), 0 4px 10px rgba(15,23,42,.08);
  padding: 6px;
  display: flex; flex-direction: column; gap: 2px;
  font-family: var(--font-sans);
  animation: qpi-moremenu-in .12s ease-out;
}
@keyframes qpi-moremenu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.qpi-moremenu-item {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 7px;
  background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 600;
  color: #1e293b;
  text-align: left;
  transition: background .12s, color .12s;
}
.qpi-moremenu-item:hover:not(:disabled) { background: #eff6ff; color: #0369a1; }
.qpi-moremenu-item:disabled { opacity: .65; cursor: wait; }
.qpi-moremenu-item svg { flex-shrink: 0; color: #0ea5e9; }
.qpi-moremenu-item span:not(.qpi-moremenu-spinner) { flex: 1; white-space: nowrap; }
.qpi-moremenu-item span.qpi-moremenu-spinner { flex: 0 0 auto; }
.qpi-moremenu-notice {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 2px 4px 6px; padding: 9px 11px; border-radius: 8px;
  font-size: 12px; font-weight: 700; line-height: 1.4;
  color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca;
}
.qpi-moremenu-notice svg { flex-shrink: 0; color: #ef4444; margin-top: 1px; }
[data-bs-theme="dark"] .qpi-moremenu-notice { color: #fca5a5; background: rgba(239,68,68,.12); border-color: rgba(239,68,68,.34); }
[data-bs-theme="dark"] .qpi-moremenu-notice svg { color: #f87171; }
.qpi-moremenu-sep {
  height: 1px;
  margin: 4px 8px;
  background: #e2e8f0;
}
[data-bs-theme="dark"] .qpi-moremenu-sep { background: rgba(167,139,250,.25); }
.qpi-moremenu-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(14,165,233,.30); border-top-color: #0ea5e9;
  animation: qpi-moremenu-spin .7s linear infinite;
}
@keyframes qpi-moremenu-spin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .qpi-moremenu {
  background: #2a2342;
  border-color: rgba(167,139,250,.45);
  box-shadow: 0 14px 32px rgba(0,0,0,.60), 0 4px 10px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .qpi-moremenu-item { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-moremenu-item:hover:not(:disabled) {
  background: rgba(14,165,233,.20);
  color: #e0f2fe;
}
[data-bs-theme="dark"] .qpi-moremenu-item svg { color: #38bdf8; }

.qpi-pagination {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px;
  padding: 12px 16px;
}
.qpi-pag-info {
  display: inline-flex; align-items: center;
  font-size: 13px; font-weight: 500;
  color: var(--vz-secondary-color, #878a99);
  font-variant-numeric: tabular-nums;
}
.qpi-pag-info strong {
  color: var(--vz-body-color, #212529);
  font-weight: 700;
  margin: 0 2px;
}
.qpi-pag-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.qpi-modal-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  overflow-y: auto;
  font-family: var(--font-sans);
  -webkit-user-select: text; user-select: text;
}
.qpi-modal-backdrop *, .qpi-modal-backdrop *::before, .qpi-modal-backdrop *::after { box-sizing: border-box; }
.qpi-modal {
  width: 100%; max-width: 1380px;
  background: #fff; border-radius: 12px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, .40), 0 8px 24px rgba(124,58,237,.14);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 32px);
  overflow: hidden;
}
.qpi-modal-head {
  padding: 12px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  color: #fff;
}
.qpi-modal-head-right { flex-wrap: wrap; }
.qpi-modal-head-teal   { background: linear-gradient(110deg, #0f4c5c 0%, #0d3b48 60%, #042f36 100%); }
.qpi-modal-head-purple { background: linear-gradient(110deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
.qpi-modal-head-left { display: flex; align-items: center; gap: 12px; }
.qpi-modal-head-icon {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.15); border: 1.5px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.qpi-modal-head-icon svg { width: 16px; height: 16px; }
.qpi-modal-title { font-size: 14.5px; font-weight: 800; letter-spacing: -.2px; line-height: 1.2; }
.qpi-modal-sub   { font-size: 11px; opacity: .85; margin-top: 1px; line-height: 1.3; }

.qpi-modal-head-right { display: flex; align-items: center; gap: 8px; }
.qpi-modal-pill {
  background: rgba(255,255,255,.08);
  border: 1.5px solid rgba(255,255,255,.2);
  border-radius: 7px;
  padding: 3px 10px;
  display: flex; flex-direction: column;
}
.qpi-modal-pill-label { font-size: 8.5px; opacity: .75; letter-spacing: .05em; text-transform: uppercase; font-weight: 700; line-height: 1.2; }
.qpi-modal-pill-value { font-size: 11px; font-weight: 800; font-family: 'JetBrains Mono', ui-monospace, monospace; line-height: 1.2; }
.qpi-modal-pill-purple { background: rgba(255,255,255,.1); }
.qpi-modal-close {
  width: 28px; height: 28px; border-radius: 7px;
  background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.2);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.qpi-modal-close:hover:not(:disabled) { background: rgba(255,255,255,.2); }
.qpi-modal-close svg { width: 13px; height: 13px; }

.qpi-modal-stepper {
  display: flex; align-items: center; gap: 0;
  padding: 10px 16px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.qpi-modal-step-divider {
  flex: 0 0 56px;
  height: 2px;
  background: #e2e8f0;
  margin: 0 0;
}
.qpi-step-badge {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 10px;
  border: 1.5px solid transparent;
  background: #fff;
  flex: 0 1 auto; min-width: 210px;
  transition: all .15s;
}
.qpi-step-badge-num {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
  flex-shrink: 0;
}
.qpi-step-badge-title { font-size: 12px; font-weight: 800; line-height: 1.2; }
.qpi-step-badge-sub   { font-size: 10px; color: #94a3b8; margin-top: 1px; line-height: 1.2; }
.qpi-step-idle { background: #fff; border-color: #e2e8f0; }
.qpi-step-idle .qpi-step-badge-num { background: #f1f5f9; color: #94a3b8; }
.qpi-step-idle .qpi-step-badge-title { color: #94a3b8; }
.qpi-step-active.qpi-step-teal   { background: #ecfeff; border-color: #67e8f9; box-shadow: 0 4px 12px rgba(8, 145, 178, .15); }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-num { background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff; }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-title { color: #0e7490; }
.qpi-step-active.qpi-step-purple { background: #f5f3ff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,58,237,.15); }
.qpi-step-active.qpi-step-purple .qpi-step-badge-num { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; }
.qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #6d28d9; }
.qpi-step-done .qpi-step-badge-num { background: linear-gradient(135deg, #4ade80, #22c55e); color: #fff; }
.qpi-step-done .qpi-step-badge-title { color: #15803d; }
.qpi-step-done.qpi-step-teal   { background: #f0fdfa; border-color: #99f6e4; }
.qpi-step-done.qpi-step-purple { background: #f0fdf4; border-color: #bbf7d0; }

.qpi-modal-body {
  padding: 12px 18px;
  overflow-y: auto;
  flex: 1;
  background: #fff;
}
.qpi-form-heading {
  font-size: 11px; font-weight: 800; letter-spacing: .05em;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid;
  text-transform: uppercase;
}
.qpi-form-heading-teal   { color: #0e7490; border-color: #0891b2; }
.qpi-form-heading-purple { color: #6d28d9; border-color: #7c3aed; }

.qpi-form-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 14px;
}
.qpi-field { display: block; min-width: 0; }
.qpi-field > label { display: block; margin-bottom: 4px; }
.qpi-field-label {
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: #475569;
  line-height: 1.2;
}
.qpi-req-star { color: #ef4444; margin-left: 2px; }
.qpi-input {
  width: 100%; height: 32px; box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid #e2e8f0; border-radius: 7px;
  background: #fff;
  font-family: inherit; font-size: 12.5px; color: #0f172a;
  outline: none; transition: border .15s, box-shadow .15s;
}
.qpi-input:hover  { border-color: #cbd5e1; }
.qpi-input:focus  { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.14); }
.qpi-input-readonly { background: #fff; color: #64748b; cursor: not-allowed; }
.qpi-input-num { text-align: right; }

@keyframes qpi-row-sweep { 0% { background-position: -360px 0; } 100% { background-position: 360px 0; } }
.qpi-row-busy { pointer-events: none; }
.qpi-row-busy td {
  background-image: linear-gradient(90deg, rgba(124,58,237,0) 0%, rgba(124,58,237,.16) 50%, rgba(124,58,237,0) 100%) !important;
  background-size: 360px 100% !important;
  background-repeat: no-repeat !important;
  animation: qpi-row-sweep 1.1s ease-in-out infinite;
}
.qpi-row-busy td > * { opacity: .4; }
[data-bs-theme="dark"] .qpi-row-busy td {
  background-image: linear-gradient(90deg, rgba(167,139,250,0) 0%, rgba(167,139,250,.20) 50%, rgba(167,139,250,0) 100%) !important;
}

@keyframes qpi-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.qpi-skel {
  display: block; border-radius: 7px;
  background: linear-gradient(90deg, #eef2f7 0%, #f7fafc 50%, #eef2f7 100%);
  background-size: 800px 100%; animation: qpi-shimmer 1.3s ease-in-out infinite;
}
.qpi-skel-label { width: 38%; height: 9px; border-radius: 4px; margin-bottom: 7px; }
.qpi-skel-input { width: 100%; height: 38px; }
.qpi-skel-note  { width: 100%; height: 64px; margin-top: 12px; }
.qpi-products-skel-row td { padding: 10px 12px; }
.qpi-products-skel-row .qpi-skel { height: 18px; border-radius: 5px; }
@media (prefers-reduced-motion: reduce) { .qpi-skel { animation: none; } }
[data-bs-theme="dark"] .qpi-skel {
  background: linear-gradient(90deg, rgba(148,163,184,.12) 0%, rgba(148,163,184,.24) 50%, rgba(148,163,184,.12) 100%);
  background-size: 800px 100%;
}

.qpi-field.has-error .qpi-field-label { color: #dc2626; }
.qpi-field.has-error .qpi-input {
  border-color: #ef4444;
  background: #fef2f2;
  box-shadow: 0 0 0 3px rgba(239,68,68,.10);
}
.qpi-field.has-error .qpi-input:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239,68,68,.20);
}
.qpi-field.has-error .master-select-toggle {
  border-color: #ef4444 !important;
  background-color: #fef2f2 !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,.10) !important;
}
.qpi-field.has-error .master-select-wrap.show .master-select-toggle {
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,.20) !important;
}
.qpi-field-error-msg {
  font-size: 10.5px; font-weight: 600; color: #dc2626;
  letter-spacing: .01em;
  line-height: 1.2;
}
[data-bs-theme="dark"] .qpi-field.has-error .qpi-field-label { color: #fca5a5; }
[data-bs-theme="dark"] .qpi-field.has-error .qpi-input,
[data-bs-theme="dark"] .qpi-field.has-error .master-select-toggle {
  background-color: #321d3b !important;
  border-color: #f87171 !important;
}
[data-bs-theme="dark"] .qpi-field-error-msg { color: #fca5a5; }

.qpi-modal-body .master-select-toggle {
  height: 32px;
  border-radius: 7px;
  border-color: #e2e8f0;
  background-color: #fff;
  font-size: 12.5px;
  color: #0f172a;
}
.qpi-modal-body .master-select-toggle:hover:not(:disabled) {
  border-color: #cbd5e1;
}
.qpi-modal-body .master-select-wrap.show .master-select-toggle {
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.14) !important;
}
.qpi-modal-body .master-select-wrap.show .master-select-chev { color: #7c3aed; }
.master-select-menu.dropdown-menu { z-index: 11000 !important; }

.qpi-note {
  margin-top: 12px;
  padding: 10px 12px;
  background: linear-gradient(110deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fde68a; border-radius: 8px;
  display: flex; gap: 10px; align-items: flex-start;
}
.qpi-note-icon { color: #d97706; flex-shrink: 0; margin-top: 1px; }
.qpi-note-icon svg { width: 14px; height: 14px; }
.qpi-note-body { flex: 1; }
.qpi-note-line { font-size: 11px; color: #78350f; line-height: 1.45; }
.qpi-note-line + .qpi-note-line { margin-top: 2px; }
.qpi-note-line strong { color: #92400e; font-weight: 800; }
.qpi-note-teal { background: linear-gradient(110deg, #ecfeff 0%, #cffafe 100%); border-color: #a5f3fc; }
.qpi-note-teal .qpi-note-icon { color: #0e7490; }
.qpi-note-teal .qpi-note-line { color: #155e75; }
.qpi-note-teal .qpi-note-line strong { color: #0c4a6e; }
.qpi-note-purple { background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%); border-color: #ddd6fe; }
.qpi-note-purple .qpi-note-icon { color: #7c3aed; }
.qpi-note-purple .qpi-note-line { color: #5b21b6; }
.qpi-note-purple .qpi-note-line strong { color: #4c1d95; }

.qpi-order-summary {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid;
  background: #faf5ff;
  margin-bottom: 12px;
}
.qpi-order-summary-purple { background: #faf5ff; border-color: #ddd6fe; }
.qpi-order-summary-teal   { background: #ecfeff; border-color: #a5f3fc; }
.qpi-summary-item {}
.qpi-summary-item-label { font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #6d28d9; line-height: 1.2; }
.qpi-order-summary-teal .qpi-summary-item-label { color: #0e7490; }
.qpi-summary-item-value { font-size: 12px; font-weight: 600; color: #475569; margin-top: 1px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.qpi-product-warn {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px;
  background: #fef2f2; border: 1.5px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  font-size: 12px; font-weight: 700;
  margin-bottom: 14px;
}
.qpi-product-warn-icon { color: #dc2626; display: inline-flex; }

.qpi-products-wrap {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 320px;
  margin-bottom: 18px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.qpi-products-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
.qpi-products-wrap::-webkit-scrollbar-track { background: transparent; }
.qpi-products-wrap::-webkit-scrollbar-thumb {
  background: #d1d5db; border-radius: 999px;
}
.qpi-products-wrap::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.qpi-products-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; table-layout: fixed; min-width: 800px; }
.qpi-products-table--wide { min-width: 1020px; }
.qpi-prodname-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.qpi-products-table.qpi-pt-teal   thead tr { background: linear-gradient(90deg, #0f4c5c 0%, #0d3b48 60%, #042f36 100%); }
.qpi-products-table.qpi-pt-purple thead tr { background: linear-gradient(90deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
.qpi-products-table thead th {
  background: transparent;
  color: #fff; font-size: 9.5px; font-weight: 800;
  padding: 11px 12px;
  text-transform: uppercase; letter-spacing: .06em; text-align: left;
}
.qpi-products-table tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f0fc; vertical-align: middle; color: #475569; }
.qpi-products-table thead th:last-child,
.qpi-products-table tbody td:last-child { padding-left: 8px; padding-right: 8px; }
.qpi-products-table tbody td:last-child > .qpi-prod-add { max-width: 100%; }
.qpi-products-table tbody tr:last-child td { border-bottom: none; }
.qpi-products-input-row td {
  position: sticky;
  bottom: 0;
  z-index: 4;
  background: #faf5ff;
  box-shadow: inset 0 1px 0 0 #ede9fe;
}
.qpi-amt { font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.qpi-products-table thead th:not(:first-child),
.qpi-products-table tbody td:not(:first-child) { text-align: center; }
.qpi-products-table .qpi-input-num { text-align: center; }
.qpi-prod-remove {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1.5px solid #fecaca; background: #fef2f2;
  color: #dc2626; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.qpi-prod-add {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 7px; border: none;
  color: #fff; font-family: inherit; font-size: 11px; font-weight: 800; cursor: pointer;
  box-shadow: 0 3px 10px rgba(124,58,237,.35);
  white-space: nowrap;
}
.qpi-prod-add-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 3px 10px rgba(14,116,144,.35); }
.qpi-prod-add-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }

.qpi-totals-row {
  display: grid; grid-template-columns: 1fr 320px; gap: 18px;
}
.qpi-terms { display: flex; flex-direction: column; }
.qpi-textarea {
  width: 100%; min-height: 130px;
  padding: 10px 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  font-family: inherit; font-size: 12px; color: #1e1b4b;
  resize: vertical;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.qpi-textarea::-webkit-scrollbar { width: 8px; height: 8px; }
.qpi-textarea::-webkit-scrollbar-track { background: transparent; }
.qpi-textarea::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 999px; }
.qpi-textarea::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.qpi-textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }

.qpi-summary {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid;
  background: #fff;
}
.qpi-summary-teal   { border-color: #a5f3fc; background: #ecfeff; }
.qpi-summary-purple { border-color: #ddd6fe; background: #faf5ff; }
.qpi-summary-heading {
  font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  color: #6d28d9; margin-bottom: 6px;
}
.qpi-summary-teal .qpi-summary-heading { color: #0e7490; }
.qpi-summary-line {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0; font-size: 12px; color: #475569; font-weight: 600;
}
.qpi-summary-val { font-weight: 800; color: #1e1b4b; font-variant-numeric: tabular-nums; }
.qpi-summary-input { width: 96px; height: 28px; padding: 0 10px; font-size: 12px; text-align: right; }
.qpi-summary-input::-webkit-outer-spin-button,
.qpi-summary-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.qpi-summary-input { -moz-appearance: textfield; appearance: textfield; }
.qpi-summary-input::placeholder { text-align: right; }
.qpi-summary-grand {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 4px; padding-top: 6px;
  border-top: 1px solid;
  font-size: 13px; font-weight: 800; color: #1e1b4b;
}
.qpi-summary-teal   .qpi-summary-grand { border-top-color: #a5f3fc; color: #0e7490; }
.qpi-summary-purple .qpi-summary-grand { border-top-color: #ddd6fe; color: #6d28d9; }

.qpi-modal-foot {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 10px 18px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.qpi-modal-req { font-size: 11px; color: #ef4444; font-weight: 600; }
.qpi-modal-foot-actions { display: flex; align-items: center; gap: 8px; }
.qpi-btn-cancel {
  padding: 6px 16px; border-radius: 7px;
  border: 1px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}

.qpi-btn-back {
  padding: 6px 14px; border-radius: 7px;
  border: 1px solid #c4b5fd; background: #fff;
  color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .18s ease, border-color .18s ease, color .18s ease,
              transform .15s ease, box-shadow .18s ease;
}
.qpi-btn-back:hover:not(:disabled) {
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border-color: #a78bfa;
  color: #5b21b6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(124,58,237,.20);
}
.qpi-btn-back:active { transform: translateY(0); box-shadow: 0 2px 6px rgba(124,58,237,.18); }
.qpi-btn-back:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(167,139,250,.30);
}

.qpi-btn-next, .qpi-btn-submit {
  padding: 6px 18px; border-radius: 7px;
  border: none; color: #fff;
  font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: transform .15s ease, box-shadow .18s ease, filter .18s ease;
}
.qpi-btn-next-teal,   .qpi-btn-submit-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 12px rgba(14,116,144,.4); }
.qpi-btn-next-purple, .qpi-btn-submit-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); box-shadow: 0 4px 12px rgba(124,58,237,.4); }

.qpi-btn-next:hover:not(:disabled),
.qpi-btn-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.qpi-btn-next-teal:hover:not(:disabled),
.qpi-btn-submit-teal:hover:not(:disabled) {
  box-shadow: 0 6px 18px rgba(14,116,144,.55);
}
.qpi-btn-next-purple:hover:not(:disabled),
.qpi-btn-submit-purple:hover:not(:disabled) {
  box-shadow: 0 6px 18px rgba(124,58,237,.55);
}
.qpi-btn-next:active:not(:disabled),
.qpi-btn-submit:active:not(:disabled) { transform: translateY(0); filter: brightness(1); }
.qpi-btn-next:focus-visible,
.qpi-btn-submit:focus-visible {
  outline: none;
}
.qpi-btn-next-teal:focus-visible,
.qpi-btn-submit-teal:focus-visible   { box-shadow: 0 0 0 3px rgba(8,145,178,.30), 0 4px 12px rgba(14,116,144,.4); }
.qpi-btn-next-purple:focus-visible,
.qpi-btn-submit-purple:focus-visible { box-shadow: 0 0 0 3px rgba(124,58,237,.28), 0 4px 12px rgba(124,58,237,.4); }
.qpi-btn-submit:disabled { opacity: .55; cursor: not-allowed; transform: none; }

.qpi-modal-busy .qpi-modal-body,
.qpi-modal-busy .qpi-modal-stepper {
  pointer-events: none;
  user-select: none;
  opacity: .55;
  transition: opacity .15s ease;
}
.qpi-btn-cancel:disabled,
.qpi-btn-back:disabled,
.qpi-btn-next:disabled {
  opacity: .55; cursor: not-allowed; transform: none; box-shadow: none;
}
.qpi-modal-close:disabled { opacity: .45; cursor: not-allowed; }
.qpi-btn-cancel:hover:not(:disabled) { background: #f8fafc; }

[data-bs-theme="dark"] .qpi-root {
  background: transparent;
  color: var(--vz-body-color);
}

[data-bs-theme="dark"] .qpi-header {
  border: 1px solid rgba(139,92,246,0.22);
  background: linear-gradient(110deg, #181426 0%, #1e1838 100%);
  box-shadow: 0 6px 20px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .qpi-header::before { background-image: none; }
[data-bs-theme="dark"] .qpi-header::after  { background: none; }
[data-bs-theme="dark"] .qpi-header-title { color: #f5f3ff; }
[data-bs-theme="dark"] .qpi-header-sub   { color: #ede9fe; opacity: 0.92; }
[data-bs-theme="dark"] .qpi-header-icon  {
  background: linear-gradient(135deg, #a78bfa, #7c3aed);
  box-shadow: 0 4px 14px rgba(124,58,237,0.50), 0 0 0 3px rgba(167,139,250,0.18);
}
[data-bs-theme="dark"] .qpi-online-dot   { border-color: #1a1530; }
[data-bs-theme="dark"] .qpi-tab-switch {
  background: #221b36;
  border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-tab        { color: #ede9fe; }
[data-bs-theme="dark"] .qpi-tab:hover  { background: rgba(167,139,250,.12); }
[data-bs-theme="dark"] .qpi-tab-count { background: rgba(167,139,250,.22); color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-tab.active .qpi-tab-count { background: rgba(255,255,255,.28); color: #fff; }

[data-bs-theme="dark"] .qpi-wdh {
  background: linear-gradient(110deg, #181426 0%, #1e1838 100%);
  border-color: rgba(167,139,250,.22);
  box-shadow: 0 2px 8px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-wdh-title  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-toggle {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-wdh-step {
  background: #1a1530;
  border-color: rgba(167,139,250,.25);
  border-left-color: #a78bfa;
}
[data-bs-theme="dark"] .qpi-wdh-step-title { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-step-desc  { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-wdh-step-tag   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-wdh-arrow-dot  {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.30);
  color: #c4b5fd;
}

[data-bs-theme="dark"] .qpi-card {
  background: var(--vz-card-bg);
  border-color: var(--vz-border-color);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-tablebar {
  background: linear-gradient(135deg, rgba(124,58,237,.10), rgba(167,139,250,.05));
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-tabs-bar {
  background: linear-gradient(135deg, rgba(124,58,237,.10), rgba(167,139,250,.05));
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-pill-group,
[data-layout-mode="dark"] .qpi-pill-group {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.22);
}
[data-bs-theme="dark"] .qpi-pi-subtab.off,
[data-layout-mode="dark"] .qpi-pi-subtab.off {
  background: rgba(124,58,237,.14); border-color: rgba(167,139,250,.28); color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-pi-subtab.off:hover,
[data-layout-mode="dark"] .qpi-pi-subtab.off:hover { background: rgba(167,139,250,.22); color: #ede9fe; }
[data-bs-theme="dark"] .qpi-pi-subtab.off .qpi-pi-subtab-count,
[data-layout-mode="dark"] .qpi-pi-subtab.off .qpi-pi-subtab-count {
  color: #c4b5fd; background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .qpi-search {
  background: rgba(255,255,255,.03);
  border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .qpi-search input { color: var(--vz-body-color); }
[data-bs-theme="dark"] .qpi-search input::placeholder,
[data-bs-theme="dark"] .qpi-search svg { color: var(--vz-secondary-color); }

[data-bs-theme="dark"] .qpi-table-host .table-responsive { scrollbar-color: rgba(255,255,255,.12) transparent; }
[data-bs-theme="dark"] .qpi-table-host .table-responsive::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); }
[data-bs-theme="dark"] .qpi-table-host .table-responsive::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.20); }
[data-bs-theme="dark"] .qpi-table-host .table { color: var(--vz-body-color); }
[data-bs-theme="dark"] .qpi-table-host .table thead.table-light tr {
  background: linear-gradient(110deg, #5b21b6 0%, #4c1d95 55%, #3b1675 100%) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table thead.table-light th {
  color: #fff !important;
  border-bottom: 0 !important;
}
[data-bs-theme="dark"] .qpi-table-host .table thead.table-light th:last-child {
  background-image: linear-gradient(110deg, #5b21b6 0%, #4c1d95 55%, #3b1675 100%) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody tr:hover td {
  background: rgba(134,92,226,.08) !important;
}
[data-bs-theme="dark"] .qpi-table-host .table tbody td {
  color: var(--vz-body-color);
  border-bottom-color: color-mix(in srgb, #ffffff 6%, transparent) !important;
}

[data-bs-theme="dark"] .qpi-table-host .pagination .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link {
  background: #2b2640;
  color: #ddd6fe;
  border-color: rgba(167,139,250,.28);
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-link:hover,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-link:hover {
  background: rgba(167,139,250,.12); border-color: rgba(167,139,250,.45); color: #ede9fe;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.active .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.active .page-link {
  background: linear-gradient(135deg, #6d28d9, #4c1d95) !important;
  border-color: #7c3aed !important; color: #fff !important;
}
[data-bs-theme="dark"] .qpi-table-host .pagination .page-item.disabled .page-link,
[data-layout-mode="dark"] .qpi-table-host .pagination .page-item.disabled .page-link {
  background: rgba(255,255,255,.03); color: #6b6481;
  border-color: rgba(167,139,250,.18);
}

[data-bs-theme="dark"] .qpi-srno                 { color: rgba(255,255,255,.88); }
[data-bs-theme="dark"] .qpi-strong               { color: #ffffff; }
[data-bs-theme="dark"] .qpi-sm                   { color: rgba(255,255,255,.85); }
[data-bs-theme="dark"] .qpi-date                 { color: rgba(255,255,255,.78); }
[data-bs-theme="dark"] .qpi-em,
[data-bs-theme="dark"] .qpi-em-center            { color: rgba(255,255,255,.35); }
[data-bs-theme="dark"] .qpi-empty                { color: rgba(255,255,255,.45); }
[data-bs-theme="dark"] .qpi-link {
  background: rgba(124,92,252,.22);
  color: #c8b8ff;
}
[data-bs-theme="dark"] .qpi-link:hover {
  background: rgba(124,92,252,.32);
  color: #ffffff;
}
[data-bs-theme="dark"] .qpi-currency {
  background: rgba(124,92,252,.22);
  color: #c8b8ff;
}
[data-bs-theme="dark"] .qpi-bt-badge {
  background: rgba(13,148,136,.20); color: #5eead4; border-color: rgba(13,148,136,.40);
}
[data-bs-theme="dark"] .qpi-qt-badge {
  background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.40);
}

[data-bs-theme="dark"] .qpi-act {
  background: #1c2531;
  background: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 20%, #141a26);
  border-color: rgba(167,139,250,.30);
  border-color: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 45%, transparent);
  color: #c4b5fd;
  color: color-mix(in srgb, var(--qpi-act-accent, #7c3aed) 70%, #fff);
}
[data-bs-theme="dark"] .qpi-act:hover {
  background: var(--qpi-act-accent, #7c3aed);
  border-color: transparent;
  color: #fff;
}
[data-bs-theme="dark"] .qpi-act:focus-visible { box-shadow: 0 0 0 3px rgba(167,139,250,.30); }
[data-bs-theme="dark"] .qpi-act-disabled,
[data-bs-theme="dark"] .qpi-act:disabled,
[data-bs-theme="dark"] .qpi-act[disabled] {
  background: #1c2531 !important;
  border-color: rgba(167,139,250,.18) !important;
  color: rgba(196,181,253,.45) !important;
  opacity: 0.55;
}

[data-bs-theme="dark"] .qpi-convert-btn {
  background: linear-gradient(135deg, #6d28d9, #4c1d95);
  box-shadow: 0 3px 10px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-convert-btn:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .qpi-convert-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(167,139,250,.35), 0 3px 10px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-convert-btn-done,
[data-bs-theme="dark"] .qpi-convert-btn-done:disabled {
  background: linear-gradient(135deg, #15803d, #166534);
  box-shadow: 0 3px 10px rgba(0,0,0,.40);
}

[data-bs-theme="dark"] .qpi-pag-info        { color: rgba(255,255,255,.70); }
[data-bs-theme="dark"] .qpi-pag-info strong { color: #ffffff; }
[data-bs-theme="dark"] .qpi-pag-btn {
  background: var(--vz-secondary-bg);
  border-color: var(--vz-border-color);
  color: rgba(255,255,255,.70);
}
[data-bs-theme="dark"] .qpi-pag-btn:hover:not(:disabled):not(.is-active) {
  border-color: #a78bfa; color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-pag-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(124,92,252,.22);
}
[data-bs-theme="dark"] .qpi-pag-btn:disabled { opacity: .45; }
[data-bs-theme="dark"] .qpi-pag-btn.is-active {
  background: linear-gradient(135deg, #7c5cfc, #a78bfa);
  border-color: transparent;
  color: #fff;
}

[data-bs-theme="dark"] .qpi-modal {
  background: #1a1530;
  box-shadow: 0 25px 60px rgba(0,0,0,.65);
}
[data-bs-theme="dark"] .qpi-modal-stepper {
  background: #14101d;
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-num { background: #2a2342; color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-title { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-teal {
  background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-purple {
  background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal .qpi-step-badge-title   { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-step-done .qpi-step-badge-title                   { color: #86efac; }
[data-bs-theme="dark"] .qpi-step-badge-sub { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-modal-step-divider { background: rgba(167,139,250,.20); }

[data-bs-theme="dark"] .qpi-modal-body { background: #221a3a; color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-input,
[data-bs-theme="dark"] .qpi-textarea {
  background: #0f0c19;
  border-color: rgba(167,139,250,.25);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-input::placeholder,
[data-bs-theme="dark"] .qpi-textarea::placeholder { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-input:focus,
[data-bs-theme="dark"] .qpi-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-input-readonly {
  background: #0f0c19; color: #9aa0b4; cursor: not-allowed;
}
[data-bs-theme="dark"] .qpi-field-label { color: #cbd5e1; }
[data-bs-theme="dark"] .qpi-modal-body .master-select-toggle {
  background-color: #0f0c19; border-color: rgba(167,139,250,.25); color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-toggle:hover:not(:disabled) {
  border-color: rgba(167,139,250,.45);
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-wrap.show .master-select-toggle {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20) !important;
}
[data-bs-theme="dark"] .qpi-modal-body .master-select-wrap.show .master-select-chev { color: #a78bfa; }
[data-bs-theme="dark"] .qpi-form-heading-teal   { color: #67e8f9; border-color: #0891b2; }
[data-bs-theme="dark"] .qpi-form-heading-purple { color: #c4b5fd; border-color: #a78bfa; }

[data-bs-theme="dark"] .qpi-note {
  background: rgba(180,83,9,.18); border-color: rgba(217,119,6,.45);
}
[data-bs-theme="dark"] .qpi-note-line   { color: #fde68a; }
[data-bs-theme="dark"] .qpi-note-line strong { color: #fcd34d; }

[data-bs-theme="dark"] .qpi-order-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-order-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-item-label   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-order-summary-teal .qpi-summary-item-label { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-item-value   { color: #e9d5ff; }

[data-bs-theme="dark"] .qpi-product-warn {
  background: rgba(220,38,38,.15); border-color: rgba(239,68,68,.40); color: #fca5a5;
}
[data-bs-theme="dark"] .qpi-products-table tbody td {
  border-bottom-color: rgba(167,139,250,.15); color: #d4d1de;
}
[data-bs-theme="dark"] .qpi-products-input-row td {
  background: #1c1538;
  box-shadow: inset 0 1px 0 0 rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-products-wrap { scrollbar-color: rgba(255,255,255,.18) transparent; }
[data-bs-theme="dark"] .qpi-products-wrap::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.18);
}
[data-bs-theme="dark"] .qpi-products-wrap::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,.28);
}
[data-bs-theme="dark"] .qpi-textarea { scrollbar-color: rgba(255,255,255,.18) transparent; }
[data-bs-theme="dark"] .qpi-textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); }
[data-bs-theme="dark"] .qpi-textarea::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.28); }
[data-bs-theme="dark"] .qpi-amt { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-prod-remove {
  background: rgba(220,38,38,.18); border-color: rgba(239,68,68,.40); color: #fca5a5;
}

[data-bs-theme="dark"] .qpi-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-summary-heading { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-teal .qpi-summary-heading { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-line { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-val  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-grand { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-teal   .qpi-summary-grand { border-top-color: rgba(14,165,233,.45); color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-purple .qpi-summary-grand { border-top-color: rgba(167,139,250,.45); color: #c4b5fd; }

[data-bs-theme="dark"] .qpi-modal-foot {
  background: #1a1530;
  border-top-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-modal-req { color: #fca5a5; }
[data-bs-theme="dark"] .qpi-btn-cancel {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.40);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-btn-cancel:hover { background: rgba(167,139,250,.15); }
[data-bs-theme="dark"] .qpi-btn-back {
  background: rgba(167,139,250,.10);
  border-color: rgba(167,139,250,.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-btn-back:hover {
  background: rgba(167,139,250,.25);
  border-color: rgba(167,139,250,.70);
  color: #f1ecff;
  box-shadow: 0 4px 12px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .qpi-btn-back:focus-visible {
  box-shadow: 0 0 0 3px rgba(167,139,250,.30);
}

@media (max-width: 1100px) {
  .qpi-wdh-body { grid-template-columns: 1fr; }
  .qpi-wdh-arrow { display: none; }
  .qpi-form-grid { grid-template-columns: repeat(2, 1fr); }
  .qpi-order-summary { grid-template-columns: repeat(2, 1fr); }
  .qpi-totals-row { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .qpi-header { padding: 12px 14px; }
  .qpi-tab-switch { width: 100%; justify-content: flex-start; }
  .qpi-tab { flex: 1; justify-content: center; }
  .qpi-wdh-step { min-height: 0; }
  .qpi-wdh-body { padding: 6px 12px 10px; gap: 10px; }
}

@media (max-width: 680px) {
  .qpi-header-title { font-size: 13.5px; }
  .qpi-header-sub   { font-size: 10.5px; }

  .qpi-tablebar { padding: 10px 12px; gap: 10px; flex-wrap: wrap; }
  .qpi-search { flex: 1 1 100%; min-width: 0; }
  .qpi-create-btn { flex: 1 1 100%; justify-content: center; }
  .qpi-tabs-bar { padding: 10px 12px; }
  .qpi-pill-group { width: 100%; }
  .qpi-pi-subtab { flex: 1; justify-content: center; }

  .qpi-table-host { padding: 0; }
  .qpi-table-host .table-responsive { overflow-x: auto; }

  .qpi-form-grid { grid-template-columns: 1fr; }
  .qpi-order-summary { grid-template-columns: 1fr; }
  .qpi-modal-stepper { flex-direction: column; gap: 8px; padding: 14px 16px 10px; }
  .qpi-modal-step-divider { display: none; }
  .qpi-modal-head { flex-direction: column; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .qpi-modal-head-right { width: 100%; justify-content: space-between; }
  .qpi-modal-body { padding: 14px 16px; }
  .qpi-modal-foot { padding: 12px 16px; flex-wrap: wrap; gap: 10px; }
  .qpi-modal-foot-actions { flex: 1 1 100%; justify-content: flex-end; }
}

@media (max-width: 520px) {
  .qpi-root { gap: 10px; }
  .qpi-header { padding: 10px 12px; gap: 10px; }
  .qpi-header-icon { width: 36px; height: 36px; }
  .qpi-header-title { font-size: 13px; }

  .qpi-wdh-header { padding: 8px 10px; }
  .qpi-wdh-body   { padding: 4px 10px 10px; }
  .qpi-wdh-step   { padding: 9px 10px; }

  .qpi-table-host > .row { padding: 10px 12px; }
  .qpi-table-host > .row > .col-sm { width: 100%; text-align: center; }
  .qpi-table-host > .row > .col-sm-auto { width: 100%; }
  .qpi-table-host .pagination { justify-content: center; flex-wrap: wrap; }

  .qpi-table-host .table thead.table-light th:first-child,
  .qpi-table-host .table tbody td:first-child { padding-left: 12px !important; }
  .qpi-table-host .table thead.table-light th:last-child,
  .qpi-table-host .table tbody td:last-child  { padding-right: 12px !important; }

  .qpi-convert-btn-label { display: none; }
  .qpi-convert-btn { padding: 0 9px; min-width: 0; }

  .qpi-modal-backdrop { padding: 8px; }
  .qpi-modal { max-height: calc(100vh - 16px); border-radius: 12px; }
  .qpi-modal-head { padding: 12px 14px; gap: 10px; }
  .qpi-modal-pill { padding: 4px 10px; }
  .qpi-modal-pill-value { font-size: 11px; }
  .qpi-modal-body { padding: 12px 14px; }
  .qpi-modal-foot { padding: 10px 14px; }
  .qpi-btn-cancel, .qpi-btn-back, .qpi-btn-next, .qpi-btn-submit {
    padding: 9px 14px; font-size: 12px;
  }

  .qpi-moremenu { min-width: 180px; }
}

@media (max-width: 400px) {
  .qpi-root { font-size: 12px; }
  .qpi-modal-pill { padding: 3px 8px; }
  .qpi-modal-pill-label { font-size: 9px; }
  .qpi-modal-pill-value { font-size: 10.5px; }
  .qpi-actions { gap: 4px; }
  .qpi-act { width: 28px; height: 28px; }
  .qpi-convert-btn { padding: 6px 8px; }
}
`;
