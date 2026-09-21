import { useState, type ReactNode } from 'react';
import type { OrderRow } from '../po-list/Order';

export const money = (v: number) => '₹' + Math.round(v || 0).toLocaleString('en-IN');

export const round2 = (v: number) => Math.round(v * 100) / 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  const mon = MONTHS[Number(m) - 1];
  if (!y || !d || !mon) return iso || '—';
  return `${d}-${mon}-${y}`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

export function shiftIso(iso: string, days: number): string {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (Number.isNaN(t)) return iso || '';
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

export const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0] || '?').charAt(0) + (p[1] || '').charAt(0)).toUpperCase();
};

export const APPROVERS = [
  { name: 'Rajiv Menon', role: 'Head of Procurement' },
  { name: 'Sunita Rao', role: 'Finance Controller' },
  { name: 'Amit Shetty', role: 'GM Commercial' },
  { name: 'Priya Nair', role: 'Accounts Head' },
];

export const PAYMENT_TYPES = [
  'TDS Payment',
  'Advance Payment',
  'Partial Payment',
  'Final Payment',
  'Balance Payment',
];

const SUPPLIER_CODES: Record<string, string> = {
  'Adani Enterprises': 'S-003',
  'Bharat Forge': 'S-011',
  'Reliance Industries': 'S-001',
  'Infosys Ltd': 'S-024',
  'Larsen & Toubro': 'S-007',
  'JSW Steel': 'S-016',
  'Godrej Industries': 'S-032',
  'Bosch India': 'S-015',
  'Tata Chemicals': 'S-012',
  'QuickShip Couriers': 'S-021',
};

export function supplierCode(name: string): string {
  if (SUPPLIER_CODES[name]) return SUPPLIER_CODES[name];
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 97;
  return 'S-' + String(h + 1).padStart(3, '0');
}

export function valueBreakdown(total: number) {
  const extra = 0;
  const base = Math.round((total - extra) / 1.18);
  return { extra, base, gst: total - extra - base, gstPct: 18 };
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

export const ICON_X = (
  <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

const ICON_CHEVRON = <svg {...ic} width="10" height="10" strokeWidth={2.8}><polyline points="6 9 12 15 18 9" /></svg>;

const ICON_CHART = (
  <svg {...ic} width="14" height="14" strokeWidth={2.4}>
    <path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" />
  </svg>
);

export const ICON_PENCIL = (
  <svg {...ic} width="14" height="14" strokeWidth={2.2}>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

export const statIco = (d: ReactNode) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

export function Chip({ label, value, meta, mod, extra }: {
  label: string; value: string; meta?: string; mod?: string; extra?: ReactNode;
}) {
  return (
    <div className={`mpr-hero__chip${mod ? ' ' + mod : ''}`}>
      <span className="mpr-hero__chip-lbl">{label}</span>
      <span className="mpr-hero__chip-line">
        <span className="mpr-hero__chip-val" title={value}>{value}</span>
        {meta && <span className="mpr-hero__chip-meta">{meta}</span>}
        {extra}
      </span>
    </div>
  );
}

export function HeroRefChips({ row }: { row: OrderRow }) {
  const spi = row.invoices[0];
  return (
    <div className="mpr-hero__chips">
      <Chip label="Supplier" value={row.supplier} meta={supplierCode(row.supplier)} mod="mpr-hero__chip--sup" />
      <Chip label="PO Number" value={row.po} meta={fmtDate(row.poDate)} />
      <Chip
        label={row.invoices.length > 1 ? 'SPI Numbers' : 'SPI Number'}
        value={spi ? spi.spi : '—'}
        meta={spi ? fmtDate(spi.spiDate) : undefined}
        extra={row.invoices.length > 1
          ? <span className="mpr-hero__chip-meta">+{row.invoices.length - 1}</span>
          : undefined}
      />
      <Chip label="Shipment ID" value={row.shipment || '—'} meta={row.shipment ? fmtDate(row.shipmentDate) : undefined} />
      <Chip label="Opportunity ID" value={row.opportunity} meta={fmtDate(row.opportunityDate)} />
      <Chip label="Procurement ID" value={row.procurement} meta={fmtDate(row.procurementDate)} />
    </div>
  );
}

export function Stat({ mod, icon, label, value, sub }: {
  mod?: string; icon: ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div className={`mpr-stat${mod ? ' ' + mod : ''}`}>
      <div className="mpr-stat__ico">{statIco(icon)}</div>
      <div>
        <div className="mpr-stat__lbl">{label}</div>
        <div className="mpr-stat__val">{value}</div>
        {sub && <div className="mpr-stat__sub">{sub}</div>}
      </div>
    </div>
  );
}

export function Box({ label, title, sub, headerExtra, icon, className, children }: {
  label: string; title: string; sub: string; headerExtra?: ReactNode;
  icon?: ReactNode; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`spi-bref mpr-box${className ? ' ' + className : ''}${open ? '' : ' is-collapsed'}`}>
      <div
        className="spi-bref-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); }
        }}
      >
        <div className="spi-bref-ico">{icon ?? ICON_CHART}</div>
        <div className="spi-bref-mid">
          <div className="spi-bref-row">
            <div className="spi-bref-label">{label}</div>
            <div className="spi-bref-sep" />
            <div className="spi-bref-title">{title}</div>
          </div>
          <div className="spi-bref-sub">{sub}</div>
        </div>
        {headerExtra}
        <div className="spi-bref-toggle">{ICON_CHEVRON}</div>
      </div>
      <div className="spi-bref-body">{children}</div>
    </div>
  );
}

export const STAT_ICONS = {
  base: <><rect x="2" y="7" width="20" height="14" rx="2.5" /><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" /></>,
  trend: <><path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" /></>,
  truck: <><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  coin: <><circle cx="12" cy="12" r="10" /><path d="M12 7v10" /><path d="M9 10h6" /><path d="M9 14h6" /></>,
  rupee: <><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>,
  wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>,
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
};

export function PoSummaryCards({ total, paid, balance, net, complete }: {
  total: number; paid: number; balance: number; net: number; complete: boolean;
}) {
  const { base, gst, extra, gstPct } = valueBreakdown(total);
  const pctPaid = net > 0 ? Math.round((paid / net) * 100) : 0;
  return (
    <div className="mpr-stats">
      <Stat icon={STAT_ICONS.base} label="PO Base Amount (Without GST)" value={money(base)} sub="Pre-tax order value" />
      <Stat mod="mpr-stat--base" icon={STAT_ICONS.trend} label="GST Amount" value={money(gst)} sub={`${gstPct}% on the base amount`} />
      <Stat mod="mpr-stat--bal" icon={STAT_ICONS.truck} label="Extra Charges" value={money(extra)} sub="None on this order" />
      <Stat mod="mpr-stat--gst" icon={STAT_ICONS.coin} label="Total PO Amount (Grand Total)" value={money(total)} sub={`${money(net)} net payable`} />
      <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount" value={money(paid)} sub={`${pctPaid}% of net payable released`} />
      <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Balance Amount" value={money(balance)} sub={complete ? 'Fully settled' : 'Still to be released'} />
    </div>
  );
}

const ICON_TDS = (
  <svg {...ic} strokeWidth={2.4}>
    <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);

const ICON_WALLET = (
  <svg {...ic} strokeWidth={2.4}>
    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
    <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);

export function TdsStrip({ tds, total, supplier, onOpen }: {
  tds: number; total: number; supplier: string; onOpen: () => void;
}) {
  return (
    <div className="mpr-tds" onClick={(e) => e.stopPropagation()}>
      {tds > 0 && (
        <>
          <span className="mpr-chip mpr-chip--cut" title="Tax withheld at source on this PO · counted towards paid">
            <span className="mpr-chip__ico">{ICON_TDS}</span>
            <span className="mpr-chip__txt">
              <span className="mpr-chip__k">TDS Deducted</span>
              <b className="mpr-chip__v">{money(tds)}</b>
            </span>
          </span>
          <span className="mpr-chip mpr-chip--net" title={`Payable to ${supplier} after TDS · ${money(total)} less ${money(tds)}`}>
            <span className="mpr-chip__ico">{ICON_WALLET}</span>
            <span className="mpr-chip__txt">
              <span className="mpr-chip__k">Net Payable</span>
              <b className="mpr-chip__v">{money(Math.max(0, total - tds))}</b>
            </span>
          </span>
        </>
      )}
      <button
        type="button"
        className={`mpr-tdsbtn${tds > 0 ? ' mpr-tdsbtn--edit' : ''}`}
        title={tds > 0 ? 'Revise the tax deducted at source on this PO' : 'Withhold tax at source against this PO'}
        onClick={onOpen}
      >
        <span className="mpr-tdsbtn__ico">{ICON_TDS}</span>
        <span>{tds > 0 ? 'Revise TDS' : 'Deduct TDS Here'}</span>
      </button>
    </div>
  );
}
