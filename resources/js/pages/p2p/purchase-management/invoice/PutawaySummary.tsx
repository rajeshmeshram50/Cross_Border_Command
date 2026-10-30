import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { HeadPill } from '../order/create-po/CreatePoForm';
import {
  IcoBox, IcoBuilding, IcoCard, IcoChevron, IcoClock, IcoDoc, IcoLines, IcoList,
  IcoPin, IcoShip, IcoTag, IcoTarget, IcoCart, IcoUser, IcoWarehouse, IcoX, IcoCalendar,
} from '../../icons';
import { money } from '../order/manage-payment/payment-shared';
import { PoApiError } from '../order/api/po-api';
import { putawayApi } from './putaway-data';
import type { PutawayBox, PutawayParty, PutawaySummaryData } from './putaway-data';
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
import { putId } from './spi-api';

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

/* While the summary loads: the four sections in their real grids, with
   shimmer bars where the figures will land, so the popup shows it is working
   and nothing jumps when the data arrives. Same .spi-sk-bar as the wizard's
   stage skeletons (it stills itself under prefers-reduced-motion). */
const Bar = ({ w, h = 12 }: { w: string | number; h?: number }) => (
  <span className="spi-sk-bar" style={{ width: w, height: h }} />
);

function SkelSection({ children }: { children: ReactNode }) {
  return (
    <div className="spi-dt-sec pts-sec pts-skel" aria-hidden>
      <div className="spi-dt-sec-head">
        <span className="pts-skel__ico" />
        <div className="spi-dt-sec-mid pts-skel__mid">
          <Bar w={260} h={13} />
          <Bar w={340} h={9} />
        </div>
      </div>
      <div className="spi-dt-sec-body">{children}</div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <>
      <span className="visually-hidden" role="status">Loading the putaway summary…</span>
      <SkelSection>
        <div className="pts-tiles">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="pts-skel__card pts-skel__card--tile" key={i}>
              <Bar w={34} h={18} /><Bar w="62%" h={8} />
            </div>
          ))}
        </div>
      </SkelSection>
      <SkelSection>
        <div className="pts-parties">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="pts-skel__card pts-skel__card--row" key={i}>
              <span className="pts-skel__ico" />
              <div className="pts-skel__mid"><Bar w={70} h={8} /><Bar w="70%" h={13} /></div>
            </div>
          ))}
        </div>
      </SkelSection>
      <SkelSection>
        <div className="pts-refs">
          {Array.from({ length: 5 }, (_, i) => (
            <div className="pts-skel__card pts-skel__card--ref" key={i}>
              <Bar w="58%" h={9} /><Bar w={120} h={22} /><Bar w={80} h={8} />
            </div>
          ))}
        </div>
      </SkelSection>
      <SkelSection>
        <div className="pts-skel__rows">
          {Array.from({ length: 3 }, (_, i) => <Bar key={i} w="100%" h={34} />)}
        </div>
      </SkelSection>
    </>
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

const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

const PARTY_ROLES: Array<{ role: PutawayParty['role']; tone: string }> = [
  { role: 'Customer', tone: 'cust' },
  { role: 'Consignee', tone: 'cons' },
  { role: 'Supplier', tone: 'sup' },
];

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
          <i>Box ID</i><b className="pts-mono">{putId(box.id)}</b>
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
          <b className="pts-loc"><IcoPin /> {box.allocationId ?? 'Not placed yet'}</b>
        </span>
        <span className="pts-box__act" onClick={e => e.stopPropagation()}>
          <button type="button" className="pts-sticker"
            title={box.apiId ? `Preview the temporary putaway sticker for ${putId(box.id)}` : 'This box could not be matched to its sticker'}
            disabled={!box.apiId}
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
            <span className="pts-box__btxt">Products in {putId(box.id)}</span>
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
                  <tr key={`${p.code}-${i}`}>
                    <td><span className="pts-sr">{i + 1}</span></td>
                    <td><span className="pts-chip pts-chip--code">{p.code}</span></td>
                    <td className="pts-l">
                      <span className="pts-pname" title={p.name}>
                        <i className="pts-pdot" /><span className="pts-trunc">{p.name}</span>
                      </span>
                    </td>
                    <td><span className="pts-qty">{p.qty}</span></td>
                    <td><Flag on={p.hazardous} /></td>
                    <td><Flag on={p.coldChain} /></td>
                    <td><span className="pts-mono pts-dim">{dash(p.serial)}</span></td>
                    <td><span className="pts-mono pts-dim">{dash(p.lot)}</span></td>
                    <td><span className="pts-mono pts-dim">{dash(p.batch)}</span></td>
                    <td><span className="pts-mono pts-dim" title={p.cat}>{dash(p.cat)}</span></td>
                    <td>
                      <span className="pts-ok pts-ok--cap"
                        style={p.remarkKind === 'correct' ? undefined : { color: p.remarkKind === 'damaged' ? '#dc2626' : '#b45309' }}
                        title={p.remarkNote ? `${p.remark} — ${p.remarkNote}` : p.remark}>
                        {p.remark}
                      </span>
                    </td>
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

  const [data, setData] = useState<PutawaySummaryData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!row.apiId) { setState('failed'); setError('This invoice has not been saved yet.'); return; }
    let live = true;
    putawayApi.summary(row.apiId)
      .then(d => { if (live) { setData(d); setState('ready'); } })
      .catch(e => {
        if (!live) return;
        setState('failed');
        setError(e instanceof PoApiError ? e.firstError : 'Could not load the summary.');
      });
    return () => { live = false; };
  }, [row.apiId]);

  const h = data?.header;
  const boxes = data?.boxes ?? [];
  const totals = data?.analytics;
  const refs = data?.references;
  const noPo = !row.poNo && !refs?.po.code;
  const noShip = noPo && !(h?.shipmentId || row.shipmentId);
  const whName = h?.warehouse?.name || row.warehouseName || '—';
  const ownWarehouse = h?.warehouse ? h.warehouse.isOwn : row.warehouseKind === 'own';
  const partyFor = (role: PutawayParty['role']): PutawayParty =>
    data?.parties.find(p => p.role === role) ?? { role, name: '—', code: '—', country: '—' };
  const spiId = h?.spiId || row.invoiceNo;

  return createPortal(
    <div className="spi-mdl-backdrop pts-backdrop">
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
            <HeadPill icon={<IcoDoc />} label="SPI ID" value={spiId} mono
              extra={<span className="pts-dot pts-dot--ok" title="Mapped" />} />
            {!noShip && (<>
              <HeadPill icon={<IcoTruck />} label="SHIPMENT ID" value={h?.shipmentId || row.shipmentId || '—'} alt mono
                extra={<span className="pts-dot pts-dot--info" title="Shipment raised" />} />
              <HeadPill icon={<IcoTarget />} label="OPPORTUNITY ID" value={h?.opportunityId || row.opportunityId || '—'} mono
                extra={<span className="pts-dot pts-dot--violet" title="Opportunity" />} />
            </>)}
            <HeadPill icon={<IcoCart />} label="PROCUREMENT CASE ID" value={h?.procurementId || row.procurementId || '—'} alt mono
              extra={<span className="pts-dot pts-dot--warn" title="Procurement" />} />
            <HeadPill icon={<IcoWarehouse />} label="WAREHOUSE" value={whName}
              extra={<span className={`pts-badge${ownWarehouse ? '' : ' pts-badge--3p'}`}>{ownWarehouse ? 'Own' : 'Third Party'}</span>} />
            <HeadPill icon={<IcoTag />} label="SPI TYPE" value={h?.spiType || (row.poNo ? 'PO + SPI' : 'Direct SPI')} alt />
            <HeadPill icon={<IcoCalendar />} label="SPI DATE" value={(h?.spiDate || row.invoiceDate) ? shortDate(h?.spiDate || row.invoiceDate) : '—'} mono />
            <HeadPill icon={<IcoBox />} label="BOXES" value={h ? String(h.boxes) : '…'} alt mono />
            <HeadPill icon={<IcoBox />} label="PRODUCTS" value={h ? String(h.products) : '…'} mono />
            <HeadPill icon={<IcoWarehouse />} label="TOTAL QTY" value={h ? `${h.totalQty} U` : '…'} alt mono />
          </div>
        </div>

        <div className="pts-body">
          {state === 'loading' ? (
            <SummarySkeleton />
          ) : state === 'failed' ? (
            <div className="pts-fail" role="alert">
              <span className="pts-fail__ico" aria-hidden><IcoX /></span>
              <b>Could not load the putaway summary</b>
              <span>{error}</span>
            </div>
          ) : (<>
          <Section
            icon={<IcoList />}
            prefix={spiId}
            title="Analytics Overview"
            meta="8 metrics"
            sub="Live snapshot of boxes, products, quantities and exceptions."
          >
            <div className="pts-tiles">
              <Tile tone="boxes" value={String(totals?.boxes ?? 0)} label="Total Boxes" />
              <Tile tone="prod" value={String(totals?.products ?? 0)} label="Total Products" />
              <Tile tone="qty" value={String(totals?.quantity ?? 0)} label="Total Quantity" />
              <Tile tone="spi" value={money(totals?.value ?? 0)} label="SPI Value" />
              <Tile tone="haz" value={String(totals?.hazardous ?? 0)} label="Hazardous" />
              <Tile tone="cold" value={String(totals?.coldChain ?? 0)} label="Cold Chain" />
              <Tile tone="dmg" value={String(totals?.damaged ?? 0)} label="Damaged / Rejected" />
              <Tile tone="mis" value={String(totals?.mismatched ?? 0)} label="Mismatched" />
            </div>
          </Section>

          <Section
            icon={<IcoUsers />}
            prefix={spiId}
            title={noShip ? 'Supplier' : 'Customer, Consignee & Supplier'}
            meta={noShip ? '1 party' : '3 parties'}
            sub="Trading parties associated with this invoice."
          >
            <div className={`pts-parties${noShip ? ' pts-parties--one' : ''}`}>
              {PARTY_ROLES.filter(({ role }) => !noShip || role === 'Supplier').map(({ role, tone }) => (
                <PartyCard key={role} party={partyFor(role)} tone={tone}
                  icon={role === 'Customer' ? <IcoUser /> : role === 'Consignee' ? <IcoBuilding /> : <IcoTruck />} />
              ))}
            </div>
          </Section>

          <Section
            icon={<IcoDoc />}
            prefix={spiId}
            title="Supplier Purchase Invoice"
            sub={noShip ? 'SPI reference with its financial value.' : noPo ? 'PI & SPI references with financial values.' : 'PI, PO & SPI references with financial values.'}
          >
            <div className={`pts-refs${noShip ? ' pts-refs--noship' : noPo ? ' pts-refs--nopo' : ''}`}>
              {!noShip && (
                <RefCard tone="pi" label="Proforma Invoice (PI)" value={dash(refs?.pi.code)}
                  date={refs?.pi.date ? shortDate(refs.pi.date) : undefined} />
              )}
              {!noPo && (
                <RefCard tone="po" label="Purchase Order (PO)" value={dash(refs?.po.code)}
                  date={refs?.po.date ? shortDate(refs.po.date) : undefined} />
              )}
              <RefCard tone="spi" label="Supplier Purchase Invoice (SPI)" value={dash(refs?.spi.code || spiId)}
                date={refs?.spi.date ? shortDate(refs.spi.date) : undefined} />
              {!noPo && (
                <AmountCard tone="pov" label="PO Amount" value={refs?.poAmount != null ? money(refs.poAmount) : '—'}
                  sub={refs?.poAmount != null ? 'Purchase Order' : 'Direct SPI — no PO'} />
              )}
              <AmountCard tone="spiv" label="SPI Amount" value={money(refs?.spiAmount ?? 0)} sub="Supplier Invoice" />
            </div>
          </Section>

          <Section
            icon={<IcoWarehouse />}
            prefix={spiId}
            title="Warehouse Location & Rack Allocation"
            meta={`${boxes.length} box${boxes.length === 1 ? '' : 'es'}`}
            sub="Temporary putaway location recorded for each box at invoice mapping."
            right={(
              <>
                <span className="pts-whpill" title={whName}><IcoPin /><span className="pts-trunc">{whName}</span></span>
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
                  {boxes.length === 0 ? (
                    <tr><td colSpan={8} className="pts-dim">No boxes have been packed for this invoice yet.</td></tr>
                  ) : boxes.map((b, i) => (
                    <tr key={b.id}>
                      <td><span className="pts-sr">{i + 1}</span></td>
                      <td><span className="pts-chip pts-chip--code">{putId(b.id)}</span></td>
                      <td className="pts-l">{b.scenario}</td>
                      <td className="pts-l">
                        <span className="pts-whcell" title={whName}>
                          <IcoWarehouse /><span className="pts-trunc">{b.warehouse || whName}</span>
                        </span>
                      </td>
                      <td>{b.zone ? <span className="pts-chip pts-chip--zone">{ICON_ZONE}{b.zone}</span> : <span className="pts-dim">—</span>}</td>
                      <td>{b.rack ? <span className="pts-chip pts-chip--rack">{ICON_RACK}{b.rack}</span> : <span className="pts-dim">—</span>}</td>
                      <td>{b.shelf ? <span className="pts-chip pts-chip--shelf">{ICON_SHELF}{b.shelf}</span> : <span className="pts-dim">—</span>}</td>
                      <td>{b.allocationId
                        ? <span className="pts-mono">{b.allocationId}</span>
                        : <span className="pts-dim">Not placed yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={<IcoBox />}
            prefix={spiId}
            title="Box & Product Details"
            meta={`${boxes.length} box${boxes.length === 1 ? '' : 'es'}`}
            sub="Per-box breakdown with product-level details (temporary putaway)."
          >
            <div className="pts-boxes">
              {boxes.length === 0
                ? <div className="pts-dim" style={{ padding: 16 }}>No boxes have been packed for this invoice yet.</div>
                : boxes.map((b, i) => <BoxRow key={b.id} box={b} row={row} index={i} />)}
            </div>
          </Section>
          </>)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
