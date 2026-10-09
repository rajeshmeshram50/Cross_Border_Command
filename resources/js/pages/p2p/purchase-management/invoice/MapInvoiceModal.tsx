import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { IcoCheck, IcoChevronR, IcoDoc, IcoLink, IcoShield, IcoWarn, IcoX } from '../../icons';
import { INVOICE_ROWS } from './data';

/** How the new invoice will be raised. */
export type InvoiceMapMode = 'with-po' | 'without-po';

/** What the chooser hands back: the path, plus whatever it was linked to. */
export interface InvoiceMapChoice {
  mode: InvoiceMapMode;
  /** The PO it will be matched against, when mode is 'with-po'. */
  poNo?: string;
  /** The supplier it belongs to, when mode is 'without-po'. */
  supplier?: string;
}

/**
 * "Map Supplier Purchase Invoice" — the chooser that opens from the head strip.
 *
 * Every class is `spi-mdl-*` from p2p-common.css, the shared P2P dialog, plus
 * the `--wide` variant for the design's 780px. The Create Purchase Order modal
 * is the same object with different words, so this mirrors its markup — cards,
 * the revealed field, the standalone warning — rather than inventing a second
 * dialog.
 *
 * It renders through a PORTAL to document.body. Inside the page it would sit
 * inside `.ord-table-scroll`, which has `overflow-x: auto` — a dialog cannot
 * escape a scroll container, so it would be clipped at the table's edge and
 * scroll sideways with the columns.
 */
export default function MapInvoiceModal({
  onClose, onConfirm,
}: {
  onClose: () => void;
  onConfirm: (choice: InvoiceMapChoice) => void;
}) {
  /* Nothing is pre-selected. The two paths lead to different forms and a
     default would quietly make one of them the answer for anyone who clicks
     straight through. */
  const [mode, setMode] = useState<InvoiceMapMode | null>(null);
  const [poNo, setPoNo] = useState('');
  const [supplier, setSupplier] = useState('');
  /* Set only when Confirm is pressed with something missing. Validation that
     appears while you are still filling the form scolds you for not having
     finished yet. */
  const [showError, setShowError] = useState(false);

  /* Locks the page behind the dialog. The shared hook locks <html> as well as
     <body>; a body-only lock does not stop the background scrolling. */
  useScrollLock(true);

  /* Built from the rows that actually carry a PO, so the list can never offer
     an order the module does not know about. Deduplicated because several
     invoices can sit against one PO. */
  const poOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of INVOICE_ROWS) {
      if (r.poNo && !seen.has(r.poNo)) seen.set(r.poNo, r.supplierName);
    }
    return [...seen].map(([no, sup]) => ({ value: no, label: `${no} · ${sup}` }));
  }, []);

  /* Every supplier the module knows, once each. */
  const supplierOptions = useMemo(() => {
    const seen = new Set(INVOICE_ROWS.map(r => r.supplierName));
    return [...seen].map(name => ({ value: name, label: name }));
  }, []);

  /* A path alone is not enough: "with PO" needs the order and "without PO"
     needs the supplier, exactly as the design's hint lines say. */
  const canConfirm = mode === 'with-po' ? !!poNo
    : mode === 'without-po' ? !!supplier
    : false;

  /* The design keeps Confirm ENABLED and explains on click. A disabled button
     with no message leaves you guessing which field it wants; this says so. */
  const confirm = () => {
    if (!canConfirm || !mode) { setShowError(true); return; }
    onConfirm(mode === 'with-po' ? { mode, poNo } : { mode, supplier });
  };

  /* Choosing a path or a value clears the complaint. */
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

          {/* The field belongs to the card above it, so it is revealed under
              that card rather than living permanently at the foot — which is
              also why choosing the other path removes it entirely. */}
          {mode === 'with-po' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel">
                <IcoLink size={20} /> SELECT PURCHASE ORDER <span className="spi-mdl-req">*</span>
              </label>
              <MasterSelect
                value={poNo}
                placeholder="— Select a Purchase Order —"
                options={poOptions}
                onChange={(v) => { setPoNo(v); setShowError(false); }}
              />
            </div>
          )}

          {/* Not built yet: a standalone invoice has no PO to match against,
              and the form behind it still assumes one. Shown greyed rather
              than removed, so the option is known to be coming. The branch
              below stays, so turning it back on is one word. */}
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
              {/* A standalone invoice skips the 3-way match, so the warning
                  states that before asking for the one thing that replaces the
                  PO as its anchor: the supplier. */}
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
