import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { IcoCheck, IcoChevronR, IcoDoc, IcoLink, IcoShield, IcoWarn, IcoX } from '../../icons';
import { INVOICE_ROWS } from './data';
import { useToast } from '../../../../contexts/ToastContext';
import { PoApiError, poApi, type PoListRow } from '../order/api/po-api';

const PO_PAGE_SIZE = 20;

export type InvoiceMapMode = 'with-po' | 'without-po';

export interface InvoiceMapChoice {
  mode: InvoiceMapMode;
  poId?: number;
  poNo?: string;
  supplier?: string;
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

  const poLabel = (r: PoListRow) => `${r.code} · ${r.supplier_name ?? '—'}`;
  const poOptions = useMemo(
    () => poRows.map(r => ({ value: String(r.id), label: poLabel(r) })),
    [poRows],
  );

  const supplierOptions = useMemo(() => {
    const seen = new Set(INVOICE_ROWS.map(r => r.supplierName));
    return [...seen].map(name => ({ value: name, label: name }));
  }, []);

  const canConfirm = mode === 'with-po' ? !!poPicked
    : mode === 'without-po' ? !!supplier
    : false;

  const confirm = () => {
    if (!canConfirm || !mode) { setShowError(true); return; }
    onConfirm(mode === 'with-po' && poPicked
      ? { mode, poId: poPicked.id, poNo: poPicked.code, supplier: poPicked.supplier_name ?? undefined }
      : { mode, supplier });
  };

  const choose = (next: InvoiceMapMode) => { setMode(next); setShowError(false); };

  const errorText = !mode ? 'Please choose how to map this invoice to continue.'
    : mode === 'with-po' ? 'Please select a Purchase Order to continue.'
    : 'Please select a supplier to continue.';

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl spi-mdl--wide" role="dialog" aria-modal="true" aria-labelledby="inv-map-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoDoc size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="inv-map-title">Map Supplier Purchase Invoice</div>
              <div className="spi-mdl-sub">Choose how to map this supplier invoice.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="spi-mdl-seclabel">MAP INVOICE TO PROCUREMENT</div>

          <button
            type="button"
            className={`spi-mdl-card ${mode === 'with-po' ? 'is-sel is-teal' : ''}`}
            onClick={() => choose('with-po')}
            aria-pressed={mode === 'with-po'}
          >
            <div className="spi-mdl-card-ico spi-mdl-ico-teal"><IcoLink size={20} /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">
                With Purchase Order <span className="spi-mdl-badge spi-mdl-badge-teal">RECOMMENDED</span>
              </div>
              <div className="spi-mdl-card-desc">Link this invoice to an existing PO for a 3-way match.</div>
            </div>
            <span className={`spi-mdl-radio ${mode === 'with-po' ? 'is-on-teal' : ''}`}>
              {mode === 'with-po' && <IcoCheck size={13} />}
            </span>
          </button>

          {mode === 'with-po' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel">
                <IcoLink size={20} /> SELECT PURCHASE ORDER <span className="spi-mdl-req">*</span>
              </label>
              <MasterSelect
                value={poId}
                placeholder="— Select a Purchase Order —"
                options={poOptions}
                currentValueLabel={poPicked ? poLabel(poPicked) : undefined}
                onSearchChange={setPoSearch}
                onScrollEnd={loadMorePos}
                loadingMore={poLoadingMore}
                emptyText={poLoading ? 'Loading purchase orders…' : 'No submitted purchase orders yet.'}
                onChange={(v) => {
                  setPoId(v);
                  setPoPicked(poRows.find(r => String(r.id) === v) ?? null);
                  setShowError(false);
                }}
              />
            </div>
          )}

          <button
            type="button"
            disabled
            className={`spi-mdl-card is-disabled ${mode === 'without-po' ? 'is-sel is-amber' : ''}`}
            onClick={() => choose('without-po')}
            aria-pressed={mode === 'without-po'}
            title="Standalone invoices are not available yet"
          >
            <div className="spi-mdl-card-ico spi-mdl-ico-amber"><IcoWarn size={20} /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">
                Without Purchase Order <span className="spi-mdl-badge spi-mdl-badge-amber">STANDALONE</span>
              </div>
              <div className="spi-mdl-card-desc">Capture a supplier invoice not tied to any PO.</div>
            </div>
            <span className="spi-mdl-soon">Coming soon</span>
          </button>

          {mode === 'without-po' && (
            <>
              <div className="spi-mdl-warn">
                <IcoWarn size={14} />
                <span>
                  <b>Standalone invoice</b> — not linked to any purchase order. Select the
                  supplier this invoice is for.
                </span>
              </div>
              <div className="spi-mdl-field">
                <label className="spi-mdl-fieldlabel">
                  <IcoLink size={20} /> SELECT SUPPLIER <span className="spi-mdl-req">*</span>
                </label>
                <MasterSelect
                  value={supplier}
                  placeholder="— Select Supplier —"
                  options={supplierOptions}
                  onChange={(v) => { setSupplier(v); setShowError(false); }}
                />
              </div>
            </>
          )}

          {showError && (
            <div className="spi-mdl-err" role="alert">
              <IcoWarn size={13} />{errorText}
            </div>
          )}
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit"><IcoShield size={13} /> All invoices are audit-tracked</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={confirm}>
              Confirm &amp; Continue <IcoChevronR size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
