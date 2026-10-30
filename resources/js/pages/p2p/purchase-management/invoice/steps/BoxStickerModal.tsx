import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import StickerPdfPreview from './StickerPdfPreview';
import { IcoCheck, IcoDownload, IcoTag, IcoX } from '../../../icons';
import type { BoxContent } from './SelectedProducts';
import { putId, spiApi } from '../spi-api';
import { PoApiError } from '../../order/api/po-api';
import { useToast } from '../../../../../contexts/ToastContext';

export type StickerApi = { spiId: number | null; spiCode: string | null; boxIdOf: (code: string) => number | null };
export const StickerApiContext = createContext<StickerApi | null>(null);

const STICKER_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
});

export const stickerPayload = (boxId: string, rows: BoxContent[], qty: number) =>
  ['BOX', boxId, rows.map(r => r.line.code).join('+'), String(qty)].join('|');

function StickerQr({ payload, size }: { payload: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    QRCode.toCanvas(el, payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    }).catch(() => setErr(true));
  }, [payload, size]);

  if (err) return <div className="invf-stk__qrfail">Could not render code</div>;
  return <canvas ref={ref} width={size} height={size} className="invf-stk__qr" />;
}

export default function BoxStickerModal({
  boxId, rows, quantity, scenario, modeLabel, condition, spiNumber, onClose,
}: {
  boxId: string;
  rows: BoxContent[];
  quantity: number;
  scenario: string;
  modeLabel: string;
  condition: string;
  spiNumber?: string;
  onClose: () => void;
}) {
  useScrollLock(true);

  const toast = useToast();
  const ctx = useContext(StickerApiContext);
  const apiSpiId = ctx?.spiId ?? null;
  const apiBoxId = ctx ? ctx.boxIdOf(boxId) : null;
  const spiNo = spiNumber || ctx?.spiCode || '';
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

  const notSaved = () => toast.warning('Save the box first', `${putId(boxId)} needs to be saved before its sticker can be produced.`);
  const failed = (e: unknown) => toast.error('Could not get the sticker',
    e instanceof PoApiError ? e.firstError : 'Please try again.');

  const downloadPdf = async () => {
    if (busy) return;
    if (!apiSpiId || !apiBoxId) { notSaved(); return; }
    setBusy('pdf');
    try {
      const blob = await spiApi.stickerPdf(apiSpiId, apiBoxId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(spiNo || 'SPI').replace(/\//g, '-')}-${boxId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  };

  const printLabel = async () => {
    if (busy) return;
    if (!apiSpiId || !apiBoxId) { notSaved(); return; }
    setBusy('print');
    try {
      await spiApi.printSticker(apiSpiId, apiBoxId);
      window.print();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  };

  const printed = STICKER_DATE.format(new Date());
  const payload = stickerPayload(boxId, rows, quantity);
  const first = rows[0]?.line;
  const mixed = rows.length > 1;

  const title = mixed ? `${rows.length} products` : first?.spiName ?? '—';
  const sku = mixed ? `${rows.length} SKUs` : `HSN ${first?.hsn ?? '—'}`;

  /* vti-over-drawer: the Sticker button sits in the box drawer's header, so
     this dialog opens on top of another dialog. Same class the Cold Chain
     dialog uses — see the rule beside .vti-dw-modal-backdrop in
     invoice-form.css. Harmless from PackedProducts, which is a step panel and
     has nothing above it to clear. */
  return createPortal(
    <div className="spi-mdl-backdrop vti-over-drawer">
      <div className="spi-mdl invf-stk" role="dialog" aria-modal="true" aria-labelledby="invf-stk-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoTag size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-stk-title">Temporary Putaway Sticker</div>
              <div className="spi-mdl-sub">
                {putId(boxId)} &nbsp;·&nbsp; {scenario} &nbsp;·&nbsp;
                <span className="invf-stk__temp"><IcoCheck size={9} stroke={3} /> TEMPORARY</span>
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <StickerPdfPreview spiId={apiSpiId} boxId={apiBoxId} fallback={<>
          <div className="invf-stk__card">
            <div className="invf-stk__strip">
              <div>
                <div className="invf-stk__strip-lbl">SPI Number</div>
                <div className="invf-stk__strip-val">{spiNo || '—'}</div>
              </div>
              <div className="invf-stk__strip-right">
                <div className="invf-stk__strip-lbl">Box No.</div>
                <div className="invf-stk__strip-box">{putId(boxId)}</div>
              </div>
            </div>

            <div className="invf-stk__name">{title}</div>
            <div className="invf-stk__chips">
              {!mixed && first && <span className="invf-stk__chip invf-stk__chip--code">{first.code}</span>}
              <span className="invf-stk__chip invf-stk__chip--mode">{modeLabel}</span>
              <span className="invf-stk__chip invf-stk__chip--cond">
                <IcoCheck size={10} stroke={3} /> {condition}
              </span>
            </div>

            <div className="invf-stk__grid">
              <div className="invf-stk__qrbox">
                <StickerQr payload={payload} size={118} />
              </div>
              <div className="invf-stk__facts">
                <div className="invf-stk__facts-lbl">Scan to verify</div>
                <dl className="invf-stk__rows">
                  <div><dt>SKU</dt><dd className="invf-stk__mono">{sku}</dd></div>
                  <div><dt>Quantity</dt><dd>{quantity} Units</dd></div>
                  <div><dt>Date</dt><dd>{printed}</dd></div>
                  <div><dt>Scenario</dt><dd>{scenario}</dd></div>
                </dl>
              </div>
            </div>

            <div className="invf-stk__foot">
              <span className="invf-stk__foot-qty">
                <span className="invf-stk__dot" />Qty: {quantity} u
              </span>
              <span className="invf-stk__mono">{printed}</span>
            </div>
          </div>

          {mixed && (
            <ul className="invf-stk__contents">
              {rows.map(r => (
                <li key={r.line.code}>
                  <span className="invf-stk__mono">{r.line.code}</span>
                  {r.line.spiName}
                  <b>{r.qty} u</b>
                </li>
              ))}
            </ul>
          )}
          </>} />
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">Reprinted once the box reaches its rack</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" disabled={busy !== null} aria-busy={busy === 'pdf'} onClick={() => void downloadPdf()}>
              {busy === 'pdf' ? <><span className="spi-btn-spin" aria-hidden />Downloading…</> : <><IcoDownload size={13} /> PDF</>}
            </button>
            <button type="button" className="spi-mdl-confirm" disabled={busy !== null} aria-busy={busy === 'print'} onClick={() => void printLabel()}>
              {busy === 'print' ? <><span className="spi-btn-spin" aria-hidden />Preparing…</> : <><IcoTag size={14} /> Print Label</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
