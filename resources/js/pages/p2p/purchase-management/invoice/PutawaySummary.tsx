import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { HeadPill } from '../order/create-po/CreatePoForm';
import {
  IcoBox, IcoBuilding, IcoCard, IcoChevron, IcoClock, IcoDoc, IcoLines, IcoList,
  IcoPin, IcoShip, IcoTag, IcoTarget, IcoCart, IcoUser, IcoWarehouse, IcoX,
} from '../../icons';
import { money } from '../order/manage-payment/payment-shared';
import { proformaNo, putawayBoxes, putawayParties, putawayTotals } from './putaway-data';
import type { PutawayBox, PutawayParty } from './putaway-data';
import type { InvoiceRow } from './types';

const PutawayStickerModal = lazy(() => import('./PutawayStickerModal'));

const IcoUsers = IcoUser;
const IcoTruck = IcoShip;

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_ZONE = (
  <svg {...ic}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
const ICON_RACK = (
  <svg {...ic}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>
);
const ICON_SHELF = (
  <svg {...ic}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);

import '../../p2p-detail.css';
import './putaway-summary.css';

const shortDate = (iso?: string) => {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

function Section({ icon, prefix, title, sub, meta, right, children }: {
  icon: ReactNode; prefix: string; title: string; sub: string;
  meta?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`spi-dt-sec pts-sec ${open ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setOpen(o => !o)}>
        <div className="spi-dt-sec-ico">{icon}</div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">{prefix}</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">{title}</span>
            {meta && <span className="pts-count">{meta}</span>}
          </div>
          <div className="spi-dt-sec-sub">{sub}</div>
        </div>
        {right && <div className="pts-sec-right" onClick={e => e.stopPropagation()}>{right}</div>}
        <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>
      <div className="spi-dt-sec-body">{children}</div>
    </div>
  );
}

function Tile({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className={`pts-tile pts-tile--${tone}`}>
      <div className="pts-tile__n">{value}</div>
      <div className="pts-tile__l">{label}</div>
    </div>
  );
}

function PartyCard({ party, icon, tone }: { party: PutawayParty; icon: ReactNode; tone: string }) {
  return (
    <div className={`pts-party pts-party--${tone}`}>
      <span className="pts-party__bar" />
      <span className="pts-party__wm">{icon}</span>
      <span className="pts-party__ico">{icon}</span>
      <div className="pts-party__txt">
        <div className="pts-party__role">{party.role}</div>
        <div className="pts-party__name">{party.name}</div>
      </div>
      <div className="pts-party__foot">
        <span className="pts-party__code"># {party.code}</span>
        <span className="pts-party__country">{party.country}</span>
      </div>
    </div>
  );
}

function RefCard({ label, value, date, tone }: { label: string; value: string; date?: string; tone: string }) {
  return (
    <div className={`pts-ref pts-ref--${tone}`}>
      <span className="pts-ref__bar" />
      <span className="pts-ref__glow" />
      <div className="pts-ref__hd">
        <span className="pts-ref__ico"><IcoDoc /></span>
        <span className="pts-ref__lbl">{label}</span>
      </div>
      <span className="pts-ref__val">{value}</span>
      {date && <div className="pts-ref__date"><IcoLines /> {date}</div>}
    </div>
  );
}

function AmountCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`pts-ref pts-ref--fill pts-ref--${tone}`}>
      <span className="pts-ref__glow" />
      <div className="pts-ref__hd">
        <span className="pts-ref__ico"><IcoCard /></span>
        <span className="pts-ref__lbl">{label}</span>
      </div>
      <div className="pts-ref__amt">{value}</div>
      <div className="pts-ref__date">{sub}</div>
    </div>
  );
}

function BoxRow({ box, row, index }: { box: PutawayBox; row: InvoiceRow; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const [sticker, setSticker] = useState(false);
  const dims: Array<[string, string, number]> = [
    ['Length', 'cm', box.length], ['Width', 'cm', box.width], ['Height', 'cm', box.height],
    ['Weight', 'kg', box.weight], ['Net Wt', 'kg', box.net],
    ['Gross Wt', 'kg', box.gross], ['Vol Wt', 'kg', box.volumetric],
  ];
  const qty = box.products.reduce((n, p) => n + p.qty, 0);

  return (
    <div className={`pts-box ${open ? 'is-open' : ''}`}>
      <div className="pts-box__strip" role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      >
        <span className="pts-box__n">{index + 1}</span>
        <span className="pts-box__ico"><IcoBox /></span>
        <span className="pts-box__f pts-box__f--id">
          <i>Box ID</i><b className="pts-mono">{box.id}</b>
        </span>
        <span className="pts-box__f pts-box__f--scn">
          <i>Scenario</i><b>{box.scenario}</b>
        </span>
        <span className="pts-box__f">
          <i>Qty</i><b>{qty} <em>units</em></b>
        </span>
        {dims.map(([label, unit, v]) => (
          <span className="pts-box__f" key={label}>
            <i>{label} <em className="pts-unit">{unit}</em></i><b>{v}</b>
          </span>
        ))}
        <span className="pts-box__f pts-box__f--loc">
          <i>Temporary Putaway Location</i>
          <b className="pts-loc"><IcoPin /> {box.allocationId}</b>
        </span>
        <span className="pts-box__act" onClick={e => e.stopPropagation()}>
          <button type="button" className="pts-sticker"
            title={`Preview the temporary putaway sticker for ${box.id}`}
            onClick={() => setSticker(true)}>
            <IcoTag /> Temporary Putaway Sticker
          </button>
        </span>
        <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>

      {open && (
        <div className="pts-box__body">
          <div className="pts-box__bt">
            <span className="pts-box__bico"><IcoBox /></span>
            <span className="pts-box__btxt">Products in {box.id}</span>
            <span className="pts-count">{box.products.length} Items</span>
          </div>
          <div className="pts-tblwrap">
            <table className="pts-tbl">
              <thead>
                <tr>
                  <th>Sr. No</th><th>Product Code</th><th>Product Name</th><th>Quantity</th>
                  <th>Hazardous</th><th>Cold Chain</th><th>Serial No.</th><th>Lot No.</th>
                  <th>Batch No.</th><th>Cat No.</th><th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {box.products.map((p, i) => (
                  <tr key={p.code}>
                    <td><span className="pts-sr">{i + 1}</span></td>
                    <td><span className="pts-chip pts-chip--code">{p.code}</span></td>
                    {/* The name is the one cell here with no shape to it. In
                        an auto-layout table a long one widens its column and
                        squeezes every other, so it is capped and cut with "…",
                        and the title carries it whole. */}
                    <td className="pts-l">
                      <span className="pts-pname" title={p.name}>
                        <i className="pts-pdot" /><span className="pts-trunc">{p.name}</span>
                      </span>
                    </td>
                    <td><span className="pts-qty">{p.qty}</span></td>
                    <td><Flag on={p.hazardous} /></td>
                    <td><Flag on={p.coldChain} /></td>
                    <td><span className="pts-mono pts-dim">{p.serial}</span></td>
                    <td><span className="pts-mono pts-dim">{p.lot}</span></td>
                    <td><span className="pts-mono pts-dim">{p.batch}</span></td>
                    <td><span className="pts-chip pts-chip--cap" title={p.cat}>{p.cat}</span></td>
                    <td><span className="pts-ok pts-ok--cap" title={p.remark}>{p.remark}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sticker && (
        <Suspense fallback={null}>
          <PutawayStickerModal box={box} row={row} onClose={() => setSticker(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Flag({ on }: { on: boolean }) {
  return (
    <span className={`pts-flag${on ? ' pts-flag--on' : ''}`}>
      <i className="pts-flag__dot" />{on ? 'Yes' : 'No'}
    </span>
  );
}

export default function PutawaySummary({ row, onClose }: { row: InvoiceRow; onClose: () => void }) {
  useScrollLock(true, '.pts-card');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const boxes = useMemo(() => putawayBoxes(row), [row]);
  const totals = useMemo(() => putawayTotals(boxes, row), [boxes, row]);
  const parties = useMemo(() => putawayParties(row), [row]);

  const ownWarehouse = row.warehouseKind === 'own';

  return createPortal(
    <div className="spi-mdl-backdrop pts-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl pts-card"
        role="dialog" aria-modal="true" aria-labelledby="pts-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="pts-hero">
          <div className="pts-hero__top">
            <span className="pts-hero__ico"><IcoClock /></span>
            <span className="pts-hero__title" id="pts-title">Temporary Putaway Summary</span>
            <button type="button" className="pts-hero__x" onClick={onClose} aria-label="Close"><IcoX /></button>
          </div>

          <div className="spi-dt-pills pts-pills">
            <HeadPill icon={<IcoDoc />} label="SPI ID" value={row.invoiceNo} mono
              extra={<span className="pts-dot pts-dot--ok" title="Mapped" />} />
            <HeadPill icon={<IcoCart />} label="SHIPMENT ID" value={row.shipmentId || '—'} alt mono
              extra={<span className="pts-dot pts-dot--info" title="Shipment raised" />} />
            <HeadPill icon={<IcoTarget />} label="OPPORTUNITY ID" value={row.opportunityId || '—'} mono
              extra={<span className="pts-dot pts-dot--violet" title="Opportunity" />} />
            <HeadPill icon={<IcoCart />} label="PROCUREMENT ID" value={row.procurementId || '—'} alt mono
              extra={<span className="pts-dot pts-dot--warn" title="Procurement" />} />
            <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={row.warehouseName || '—'}
              extra={<span className="pts-badge">{ownWarehouse ? 'Own' : '3P'}</span>} />
            <HeadPill icon={<IcoTag />} label="SPI TYPE" value={row.poNo ? 'PO + SPI' : 'SPI Only'} alt />
            <HeadPill icon={<IcoLines />} label="SPI DATE" value={shortDate(row.invoiceDate)} mono />
            <HeadPill icon={<IcoBox />} label="BOXES" value={String(totals.boxes)} alt mono />
            <HeadPill icon={<IcoCard />} label="PRODUCTS" value={String(totals.products)} mono />
            <HeadPill icon={<IcoPin />} label="TOTAL QTY" value={`${totals.quantity} U`} alt mono />
          </div>
        </div>

        <div className="pts-body">
          <Section
            icon={<IcoList />}
            prefix={row.invoiceNo}
            title="Analytics Overview"
            meta="8 metrics"
            sub="Live snapshot of boxes, products, quantities and exceptions."
          >
            <div className="pts-tiles">
              <Tile tone="boxes" value={String(totals.boxes)} label="Total Boxes" />
              <Tile tone="prod" value={String(totals.products)} label="Total Products" />
              <Tile tone="qty" value={String(totals.quantity)} label="Total Quantity" />
              <Tile tone="spi" value={money(totals.value)} label="SPI Value" />
              <Tile tone="haz" value={String(totals.hazardous)} label="Hazardous" />
              <Tile tone="cold" value={String(totals.coldChain)} label="Cold Chain" />
              <Tile tone="dmg" value={String(totals.damaged)} label="Damaged / Rejected" />
              <Tile tone="mis" value={String(totals.mismatched)} label="Mismatched" />
            </div>
          </Section>

          <Section
            icon={<IcoUsers />}
            prefix={row.invoiceNo}
            title="Customer, Consignee & Supplier"
            meta="3 parties"
            sub="Trading parties associated with this invoice."
          >
            <div className="pts-parties">
              <PartyCard party={parties[0]} icon={<IcoUser />} tone="cust" />
              <PartyCard party={parties[1]} icon={<IcoBuilding />} tone="cons" />
              <PartyCard party={parties[2]} icon={<IcoTruck />} tone="sup" />
            </div>
          </Section>

          <Section
            icon={<IcoDoc />}
            prefix={row.invoiceNo}
            title="Supplier Purchase Invoice"
            sub="PI, PO & SPI references with financial values."
          >
            <div className="pts-refs">
              <RefCard tone="pi" label="Proforma Invoice (PI)" value={proformaNo(row)} />
              <RefCard tone="po" label="Purchase Order (PO)" value={row.poNo || '—'}
                date={row.poDate ? row.poDate : undefined} />
              <RefCard tone="spi" label="Supplier Purchase Invoice (SPI)" value={row.invoiceNo}
                date={row.invoiceDate} />
              <AmountCard tone="pov" label="PO Amount" value={money(row.totalPoAmount)} sub="Purchase Order" />
              <AmountCard tone="spiv" label="SPI Amount" value={money(row.netPayable)} sub="Supplier Invoice" />
            </div>
          </Section>

          <Section
            icon={<IcoWarehouse />}
            prefix={row.invoiceNo}
            title="Warehouse Location & Rack Allocation"
            meta={`${boxes.length} box${boxes.length === 1 ? '' : 'es'}`}
            sub="Temporary putaway location recorded for each box at invoice mapping."
            right={(
              <>
                <span className="pts-whpill" title={row.warehouseName}><IcoPin /><span className="pts-trunc">{row.warehouseName}</span></span>
                <span className="pts-temp">Temporary</span>
              </>
            )}
          >
            <div className="pts-tblwrap">
              <table className="pts-tbl pts-tbl--alloc">
                <thead>
                  <tr>
                    <th>Sr. No</th><th>Box ID</th><th>Box Scenario</th><th>Warehouse</th>
                    <th>Zone</th><th>Rack</th><th>Shelf</th><th>Rack Allocation ID</th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.map((b, i) => (
                    <tr key={b.id}>
                      <td><span className="pts-sr">{i + 1}</span></td>
                      <td><span className="pts-chip pts-chip--code">{b.id}</span></td>
                      <td className="pts-l">{b.scenario}</td>
                      {/* Same treatment as the product name: a warehouse is
                          free text and can be long. */}
                      <td className="pts-l">
                        <span className="pts-whcell" title={row.warehouseName}>
                          <IcoWarehouse /><span className="pts-trunc">{row.warehouseName}</span>
                        </span>
                      </td>
                      <td><span className="pts-chip pts-chip--zone">{ICON_ZONE}{b.zone}</span></td>
                      <td><span className="pts-chip pts-chip--rack">{ICON_RACK}{b.rack}</span></td>
                      <td><span className="pts-chip pts-chip--shelf">{ICON_SHELF}{b.shelf}</span></td>
                      <td><span className="pts-mono">{b.allocationId}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={<IcoBox />}
            prefix={row.invoiceNo}
            title="Box & Product Details"
            meta={`${boxes.length} box${boxes.length === 1 ? '' : 'es'}`}
            sub="Per-box breakdown with product-level details (temporary putaway)."
          >
            <div className="pts-boxes">
              {boxes.map((b, i) => <BoxRow key={b.id} box={b} row={row} index={i} />)}
            </div>
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
