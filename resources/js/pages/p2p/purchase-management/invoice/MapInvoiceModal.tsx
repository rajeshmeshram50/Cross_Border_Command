import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { IcoCheck, IcoChevronR, IcoLink, IcoWarn, IcoX } from '../../icons';
import { INVOICE_ROWS } from './data';
import { useToast } from '../../../../contexts/ToastContext';
import { PoApiError, poApi, type PoListRow } from '../order/api/po-api';
import PoPicker from './PoPicker';
import DirectSpiSetup, {
  DirectSpiSummary, DirectSpiSummarySkeleton, DirectSpiStepsSkeleton,
  EMPTY_DIRECT, directReady, PROCUREMENT_STEP_ENABLED, type DirectSpiState,
} from './DirectSpiSetup';
import { SUPPLIERS, NEXT_PROCUREMENT } from './direct-spi-data';
import './direct-spi.css';

const PO_PAGE_SIZE = 20;

export type InvoiceMapMode = 'with-po' | 'without-po';

export interface InvoiceMapChoice {
  mode: InvoiceMapMode;
  poId?: number;
  poNo?: string;
  supplier?: string;
  shipmentId?: string;
  shipmentPi?: string;
  procurementCode?: string;
  supplierCode?: string;
}

function TypeCard({
  kind, on, disabled = false, onPick, icon, title, badge, desc, points,
}: {
  kind: 'with' | 'without';
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  icon: ReactNode;
  title: string;
  badge: string;
  desc: string;
  points: string[];
}) {
  return (
    <button
      type="button"
      className={`spich-card spich-card--${kind}${on ? ' is-on' : ''}${disabled ? ' is-off' : ''}`}
      onClick={onPick}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className="spich-c2">
        <span className="spich-c2__ico">{icon}</span>
        <span className="spich-c2__main">
          <span className="spich-c2__row">
            <span className="spich-c2__t">{title}</span>
            <span className={`spich-card__badge spich-card__badge--${kind === 'with' ? 'ok' : 'warn'}`}>
              {badge}
            </span>
          </span>
          <span className="spich-c2__d">{desc}</span>
          <span className="spich-c2__pts">
            {points.map(p => (
              <span className="spich-c2__pt" key={p}>
                <span className="spich-c2__ck"><IcoCheck size={9} /></span>{p}
              </span>
            ))}
          </span>
        </span>
        <span className="spich-card__rad">{on && <IcoCheck size={11} />}</span>
      </span>
    </button>
  );
}

export default function MapInvoiceModal({
  onClose, onConfirm,
}: {
  onClose: () => void;
  onConfirm: (choice: InvoiceMapChoice) => void;
}) {
  const [mode, setMode] = useState<InvoiceMapMode | null>(null);
  const [poId, setPoId] = useState('');
  const [poPicked, setPoPicked] = useState<PoListRow | null>(null);
  const [supplier, setSupplier] = useState('');
  const [showError, setShowError] = useState(false);

  useScrollLock(true);

  const toast = useToast();
  const [poSearch, setPoSearch] = useState('');
  const [poRows, setPoRows] = useState<PoListRow[]>([]);
  const [poPage, setPoPage] = useState(1);
  const [poLastPage, setPoLastPage] = useState(1);
  const [poLoading, setPoLoading] = useState(false);
  const [poLoadingMore, setPoLoadingMore] = useState(false);
  const poSeq = useRef(0);

  const loadPos = useCallback((page: number, search: string) => {
    const id = ++poSeq.current;
    if (page === 1) setPoLoading(true); else setPoLoadingMore(true);
    poApi.list({ status: 'submitted', search: search || undefined, page, per_page: PO_PAGE_SIZE })
      .then(({ rows, meta }) => {
        if (id !== poSeq.current) return;
        setPoRows(cur => (page === 1 ? rows : [...cur, ...rows]));
        setPoPage(page);
        setPoLastPage(meta?.last_page ?? page);
      })
      .catch(e => {
        if (id !== poSeq.current) return;
        toast.error('Could not load purchase orders', e instanceof PoApiError ? e.firstError : 'Please try again.');
      })
      .finally(() => {
        if (id !== poSeq.current) return;
        setPoLoading(false);
        setPoLoadingMore(false);
      });
  }, [toast]);

  useEffect(() => {
    if (mode === 'with-po') loadPos(1, poSearch.trim());
  }, [mode, poSearch, loadPos]);

  const loadMorePos = useCallback(() => {
    if (poLoading || poLoadingMore || poPage >= poLastPage) return;
    loadPos(poPage + 1, poSearch.trim());
  }, [poLoading, poLoadingMore, poPage, poLastPage, poSearch, loadPos]);

  const supplierOptions = useMemo(() => {
    const seen = new Set(INVOICE_ROWS.map(r => r.supplierName));
    return [...seen].map(name => ({ value: name, label: name }));
  }, []);

  const [direct, setDirect] = useState<DirectSpiState>(EMPTY_DIRECT);
  const directSupplier = SUPPLIERS.find(r => r.code === direct.supplier);
  const isDirect = mode === 'without-po';

  const [sdxReady, setSdxReady] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isDirect) { setSdxReady(false); return; }
    const box = boxRef.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!box || still) { setSdxReady(true); return; }

    let done = false;
    const finish = () => { if (!done) { done = true; setSdxReady(true); } };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === box && (e.propertyName === 'width' || e.propertyName === 'max-width')) finish();
    };
    box.addEventListener('transitionend', onEnd);
    const t = window.setTimeout(finish, 420);
    return () => { box.removeEventListener('transitionend', onEnd); window.clearTimeout(t); };
  }, [isDirect]);

  const canConfirm = mode === 'with-po' ? !!poPicked
    : isDirect ? directReady(direct)
    : false;

  const [confirming, setConfirming] = useState(false);

  const confirm = () => {
    if (confirming) return;
    if (!canConfirm || !mode) { setShowError(true); return; }
    setConfirming(true);
    onConfirm(mode === 'with-po' && poPicked
      ? { mode, poId: poPicked.id, poNo: poPicked.code, supplier: poPicked.supplier_name ?? undefined }
      : {
        mode,
        supplier: directSupplier?.name ?? supplier,
        shipmentId: direct.shipment === 'with' ? direct.shipmentId ?? undefined : undefined,
        shipmentPi: direct.shipment === 'with' ? direct.shipmentPi ?? undefined : undefined,
        procurementCode: direct.procMode === 'auto' ? NEXT_PROCUREMENT : direct.procurementId ?? undefined,
        supplierCode: direct.supplier ?? undefined,
      });
  };

  const choose = (next: InvoiceMapMode) => { setMode(next); setShowError(false); };

  const errorText = !mode ? 'Please choose how to map this invoice to continue.'
    : mode === 'with-po' ? 'Please select a Purchase Order to continue.'
    : !direct.shipment ? 'Answer step 01 — is this raised against a customer shipment?'
    : PROCUREMENT_STEP_ENABLED && !direct.procurementId ? 'Link a Procurement Case ID in step 02 to continue.'
    : 'Please select a supplier to continue.';

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div ref={boxRef} className={`spi-mdl spi-mdl--wide${isDirect ? ' spi-mdl--sdx' : ''}`} role="dialog" aria-modal="true" aria-labelledby="inv-map-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
                <line x1="8" y1="9" x2="16" y2="9" />
                <line x1="8" y1="13" x2="16" y2="13" />
              </svg>
            </div>
            <div>
              <div className="spi-mdl-title" id="inv-map-title">Create Supplier Purchase Invoice</div>
              <div className="spi-mdl-sub">Choose the SPI type — with a Purchase Order or a Direct SPI.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className={isDirect ? 'sdx-layout' : undefined}>
          <div className={isDirect ? 'sdx-aside' : undefined}>
          <div className="spi-mdl-seclabel">SELECT SPI TYPE</div>

          <div className="spich-grid">
            <TypeCard
              kind="with"
              on={mode === 'with-po'}
              onPick={() => choose('with-po')}
              icon={<IcoLink size={19} />}
              title="With Purchase Order SPI"
              badge="Recommended"
              desc="Invoice raised against an existing Purchase Order."
              points={['3-way match: PO · GRN · Invoice', 'Products & prices pulled from the PO']}
            />
            <TypeCard
              kind="without"
              on={mode === 'without-po'}
              onPick={() => choose('without-po')}
              icon={<IcoWarn size={19} />}
              title="Direct SPI"
              badge="Without Purchase Order"
              desc="Standalone supplier invoice, not tied to any PO."
              points={['Pick the supplier directly', 'Enter products & prices manually']}
            />
          </div>

          {isDirect && (sdxReady
            ? <DirectSpiSummary key="sum" state={direct} />
            : <DirectSpiSummarySkeleton key="sum-sk" />)}
          </div>

          {isDirect && (sdxReady
            ? <DirectSpiSetup key="main" state={direct} onChange={setDirect} />
            : <DirectSpiStepsSkeleton key="main-sk" />)}

          {mode === 'with-po' && (
            <div className="spich-sub">
              <div className="spi-mdl-field">
                  <label className="spi-mdl-fieldlabel">
                    <IcoLink size={20} /> SELECT PURCHASE ORDER <span className="spi-mdl-req">*</span>
                  </label>
                  <PoPicker
                    rows={poRows}
                    value={poId}
                    search={poSearch}
                    onSearch={setPoSearch}
                    onScrollEnd={loadMorePos}
                    loading={poLoading}
                    loadingMore={poLoadingMore}
                    onChange={(r) => { setPoId(String(r.id)); setPoPicked(r); setShowError(false); }}
                  />
              </div>
            </div>
          )}

          {showError && (
            <div className="spi-mdl-err" role="alert">
              <IcoWarn size={13} />{errorText}
            </div>
          )}
          </div>
        </div>

        <div className="spi-mdl-foot">
          {isDirect && (
            <span className="sdx-ft__note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Every Direct SPI is linked to a Procurement Case ID and audit-tracked
            </span>
          )}
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className={`spi-mdl-confirm${canConfirm ? ' is-ready' : ''}`} onClick={confirm}
              disabled={!mode || confirming} aria-busy={confirming}>
              {confirming
                ? <><span className="spi-mdl-spin" aria-hidden />Opening invoice…</>
                : <>Confirm &amp; Continue <IcoChevronR size={14} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
