// P2P → Advance Receipt Refund Adjustment. Refunds raised against advances already
// released on a purchase order, and the recovery of those refunds. Uses the shared
// SPI/Order list shell (spi-*, ord-*) and the Order module's sample POs until the
// API is connected.
import { useMemo, useState, type ReactNode } from 'react';
import Badge from '../../../../components/ui/Badge';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import SearchClear from '../../../../components/ui/SearchClear';
import { useToast } from '../../../../contexts/ToastContext';
import { money, fmtDate, shortDate } from '../../purchase-management/order/manage-payment/payment-shared';
import {
  IcoCheck, IcoClock, IcoDoc, IcoList, IcoPencil, IcoPlus, IcoRefund, IcoSearch, IcoChevron,
  IcoLink, IcoLines, IcoCard, IcoHistory, IcoAlert, IcoShield, IcoDocSm,
} from '../../purchase-management/order/shared/icons';
import RefundPoPickerModal from './RefundPoPickerModal';
import RefundAdjustmentForm from './RefundAdjustmentForm';
import RecoverPaymentModal from './RecoverPaymentModal';
import EvidenceVaultModal from './EvidenceVaultModal';
import {
  REFUNDABLE_POS, SEED_REFUNDS, TYPE_VARIANT, findPo, isCancellation, nextRefundNo, refundFigures, todayIso, typeLabel,
  type RefundAdjustment, type RefundRecovery,
} from './refund-data';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/po-list/order.css';
import './advance-refund.css';

type TabKey = 'all' | 'pending' | 'recovered';

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'All Refund Adjustments', icon: <IcoList /> },
  { key: 'pending', label: 'Recovery Pending Refunds', icon: <IcoClock /> },
  { key: 'recovered', label: 'Fully Recovered Refunds', icon: <IcoCheck /> },
];

const STEPS = [
  { n: '01', icon: <IcoLink size={11} />, title: 'Link the Purchase Order', desc: 'Pick the PO and supplier the refund is being raised against.' },
  { n: '02', icon: <IcoDoc size={11} />, title: 'Refund Details', desc: "Capture the refund number, date, reason and the supplier's own reference." },
  { n: '03', icon: <IcoCard size={11} />, title: 'Refund Amount', desc: 'Record the amount due back against what was already released to the supplier.' },
  { n: '04', icon: <IcoHistory size={11} />, title: 'Recovery & Accounting', desc: 'Log refunds against the adjustment until nothing is outstanding.' },
];

const EMPTY: Record<TabKey, string> = {
  all: 'No refund adjustments raised yet — one appears here the moment it is raised against a purchase order.',
  pending: 'Nothing pending — every refund raised has been recovered in full.',
  recovered: 'No refund adjustment has been fully recovered yet.',
};

const PAGE_SIZES = [5, 10, 15];

const inTab = (r: RefundAdjustment, tab: TabKey) => {
  if (tab === 'all') return true;
  const full = refundFigures(r).status === 'full';
  return tab === 'recovered' ? full : !full;
};

const searchText = (r: RefundAdjustment) => {
  const po = findPo(r.po);
  return [r.no, r.po, r.type, r.supplierRef, po?.supplier, po?.shipment, po?.opportunity, po?.procurement]
    .join(' ').toLowerCase();
};

export default function AdvanceRefundAdjustment() {
  const toast = useToast();
  const [refunds, setRefunds] = useState<RefundAdjustment[]>(SEED_REFUNDS);
  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [guideOpen, setGuideOpen] = useState(true);
  // Create: picker first, then the form for the chosen PO. Edit: the form straight away.
  const [picking, setPicking] = useState(false);
  const [form, setForm] = useState<{ po: string; edit?: RefundAdjustment } | null>(null);
  // Refund no. whose recoveries are open — read live from the list so edits show at once.
  const [recoveringNo, setRecoveringNo] = useState<string | null>(null);
  const recovering = refunds.find((r) => r.no === recoveringNo) ?? null;
  const [vault, setVault] = useState<RefundAdjustment | null>(null);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: 0, pending: 0, recovered: 0 };
    refunds.forEach((r) => TABS.forEach((t) => { if (inTab(r, t.key)) c[t.key] += 1; }));
    return c;
  }, [refunds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return refunds.filter((r) => inTab(r, tab) && (!needle || searchText(r).includes(needle)));
  }, [refunds, tab, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, pages);
  const start = (curPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  const saveRefund = (next: RefundAdjustment) => {
    const exists = refunds.some((r) => r.no === next.no);
    setRefunds((list) => (exists ? list.map((r) => (r.no === next.no ? next : r)) : [next, ...list]));
    setForm(null);
    toast.success(exists ? 'Refund adjustment updated' : 'Advance receipt refund adjustment recorded', next.no);
  };

  const saveRecoveries = (no: string, recoveries: RefundRecovery[]) =>
    setRefunds((list) => list.map((r) => (r.no === no ? { ...r, recoveries } : r)));

  return (
    <div className="spi-root">
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoRefund size={19} /></div>
          <div>
            <div className="spi-head-title">Advance Receipt Refund Adjustment (Supplier Tax Invoice Not Generated)</div>
            <div className="spi-head-sub">
              Adjust and recover refunds against advances already released — for cancelled orders, returns, short supply, and price or quantity corrections.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn arf-head-btn" onClick={() => setPicking(true)}>
          <IcoPlus size={13} /> Create Advance Receipt Refund Adjustment
        </button>
      </div>

      <div className={`spi-bref${guideOpen ? '' : ' is-collapsed'}`}>
        <div className="spi-bref-head" role="button" tabIndex={0} aria-expanded={guideOpen}
          onClick={() => setGuideOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setGuideOpen((o) => !o); } }}>
          <div className="spi-bref-ico"><IcoLines size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Advance Receipt Refund Adjustment</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              A debit note is what we raise on the supplier; a refund adjustment is what makes money already released owed back to us — nothing can be recovered until it exists.
            </div>
          </div>
          <div className="spi-bref-toggle"><IcoChevron size={10} /></div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map((s) => (
            <div className="spi-step" key={s.n}>
              <div className="spi-step-top"><span className="spi-step-ico">{s.icon}</span><span className="spi-step-num">STEP {s.n}</span></div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="spi-card">
        <div className="spi-segrow spi-segrow--search">
          <div className="spi-seg" role="tablist" aria-label="Refund adjustment views">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`}
                onClick={() => { setTab(t.key); setPage(1); }}>
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                <span className="spi-seg-c">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="spi-search ui-search-abs">
            <IcoSearch />
            <input autoComplete="off" aria-label="Search refund adjustments" value={q}
              placeholder="Search refund, purchase order, supplier…"
              onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <SearchClear show={q} onClear={() => { setQ(''); setPage(1); }} />
          </div>
        </div>

        <div className="spi-tablewrap">
          <table className="spi-table arf-table">
            <thead>
              <tr>
                <th className="spi-c-sr">SR NO</th>
                <th>REFUND NO.</th>
                <th>PURCHASE ORDER</th>
                <th>SHIPMENT ID</th>
                <th>OPPORTUNITY ID</th>
                <th>PROCUREMENT ID</th>
                <th>CREDIT NOTE TYPE</th>
                <th>TOTAL PO AMOUNT (GRAND TOTAL)</th>
                <th>TDS DEDUCTED</th>
                <th>NET PAYABLE AMOUNT</th>
                <th>TOTAL PO PAID AMOUNT</th>
                <th>AMOUNT NOT REFUNDED</th>
                <th>AMOUNT TO BE REFUNDED</th>
                <th>PAYMENT RECOVERY STATUS</th>
                <th>PO CANCELLATION STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={16}>
                  <div className="spi-empty"><div className="spi-empty-t">No refund adjustments found</div><div className="spi-empty-s">{q ? 'Try a different search.' : EMPTY[tab]}</div></div>
                </td></tr>
              ) : visible.map((r, i) => (
                <RefundRow key={r.no} sr={start + i + 1} refund={r}
                  onEdit={() => setForm({ po: r.po, edit: r })} onRecover={() => setRecoveringNo(r.no)} onVault={() => setVault(r)} />
              ))}
            </tbody>
          </table>
        </div>

        <WorklistPager total={filtered.length} page={curPage} pageSize={pageSize} onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }} pageSizeOptions={PAGE_SIZES} />
      </div>

      {picking && (
        <RefundPoPickerModal
          options={REFUNDABLE_POS.filter((p) => !refunds.some((r) => r.po === p.po))}
          onClose={() => setPicking(false)}
          onContinue={(po) => { setPicking(false); setForm({ po }); }}
        />
      )}
      {form && (
        <RefundAdjustmentForm
          po={form.po}
          edit={form.edit}
          nextNo={nextRefundNo(refunds)}
          today={todayIso()}
          onSubmit={saveRefund}
          onCancel={() => { const creating = !form.edit; setForm(null); if (creating) setPicking(true); }}
          onClose={() => setForm(null)}
        />
      )}
      {vault && <EvidenceVaultModal refund={vault} onClose={() => setVault(null)} />}
      {recovering && (
        <RecoverPaymentModal refund={recovering} onChange={(list) => saveRecoveries(recovering.no, list)} onClose={() => setRecoveringNo(null)} />
      )}
    </div>
  );
}

function IdCell({ id, date, children }: { id?: string | null; date?: string; children?: ReactNode }) {
  if (!id) return <>—</>;
  return (
    <span className="ord-idcell">
      <span className="ord-idpill">{id}</span>
      {date && <span className="ord-idcell__date">{date}</span>}
      {children}
    </span>
  );
}

const RECOVERY_LABEL = { full: 'Fully Recovered', partial: 'Partially Recovered', pending: 'Recovery Not Started' } as const;

function RefundRow({ sr, refund, onEdit, onRecover, onVault }: {
  sr: number; refund: RefundAdjustment; onEdit: () => void; onRecover: () => void; onVault: () => void;
}) {
  const po = findPo(refund.po);
  const fig = refundFigures(refund);
  const tds = po ? Math.max(0, po.total - po.net) : 0;
  const cancelled = !!po?.cancelled || isCancellation(refund);
  const done = fig.status === 'full';

  return (
    <tr>
      <td className="spi-c-sr"><span className="spi-sr">{sr}</span></td>
      <td><IdCell id={refund.no} date={shortDate(refund.date)} /></td>
      <td>
        <IdCell id={refund.po} date={po && fmtDate(po.poDate)}>
          {po?.physicalInspection && (
            <Badge appearance="outline" variant="danger" icon={<IcoAlert />} className="ord-physinsp">Physical Inspection</Badge>
          )}
        </IdCell>
      </td>
      <td><IdCell id={po?.shipment} date={po && fmtDate(po.shipmentDate)} /></td>
      <td><IdCell id={po?.opportunity} date={po && fmtDate(po.opportunityDate)} /></td>
      <td><IdCell id={po?.procurement} date={po && fmtDate(po.procurementDate)} /></td>
      <td>
        <Tooltip label={refund.type} themed>
          <Badge dot variant={TYPE_VARIANT[refund.type] ?? 'muted'} className="arf-pill">{typeLabel(refund.type)}</Badge>
        </Tooltip>
      </td>
      <td><span className="ord-amt">{money(po?.total ?? 0)}</span></td>
      <td>{tds > 0 ? <span className="ord-amt arf-amt--due">{money(tds)}</span> : '—'}</td>
      <td><span className="ord-amt ord-amt--net">{money(po?.net ?? 0)}</span></td>
      <td><span className="ord-amt ord-amt--paid">{money(fig.paid)}</span></td>
      <td>
        {fig.notRefunded > 0 ? (
          <span className="arf-nr">
            <span className="ord-amt ord-amt--bal">{money(fig.notRefunded)}</span>
            {refund.retainedType
              ? <Tooltip label={refund.retainedRemark || refund.retainedType} themed><span className="arf-chip arf-nr__why">{refund.retainedType}</span></Tooltip>
              : <span className="arf-nr__none">reason not recorded</span>}
          </span>
        ) : <span className="ord-amt">{money(0)}</span>}
      </td>
      <td><span className={`ord-amt${fig.toRefund > 0 ? ' arf-amt--due' : ''}`}>{money(fig.toRefund)}</span></td>
      <td>
        <div className="ord-paycell">
          <div className={`ord-progress is-${fig.status}`}>
            <div className="ord-progress__top">
              <span className={`ord-pill ord-pill--${fig.status}`}><span className="ord-pill__dot" />{RECOVERY_LABEL[fig.status]}</span>
              <span className="ord-progress__pct">{fig.pct}%</span>
            </div>
            <div className="ord-progress__bar">
              <div className="ord-progress__fill" style={{ width: `${fig.pct}%` }}><span className="ord-progress__sheen" /></div>
            </div>
            <div className="ord-progress__meta">
              <span className="ord-progress__paid"><span className="ord-progress__mdot" />{money(fig.recovered)} recovered</span>
              <span className="ord-progress__due"><span className="ord-progress__mdot" />{money(fig.pending)} pending</span>
            </div>
          </div>
          <span className="arf-chip arf-refchip"><IcoDocSm size={11} />{refund.no}</span>
          <button type="button" className={`ord-btn ord-btn--hist${done ? ' is-record' : ''}`} onClick={onRecover}>
            {done ? <IcoHistory /> : <IcoRefund />}
            <span>{done ? 'View Recoveries' : 'Manage Recovery'}</span>
            {refund.recoveries.length > 0 && <i className="ord-btn__count">{refund.recoveries.length}</i>}
          </button>
        </div>
      </td>
      <td>
        <span className="ord-idcell">
          {cancelled
            ? <Badge dot variant="danger" className="arf-pill" title={po?.cancelReason || refund.reason}>PO Cancelled</Badge>
            : <Badge dot variant="info" className="arf-pill">PO Active</Badge>}
          {cancelled && <span className="ord-idcell__date">{fmtDate(refund.date)}</span>}
        </span>
      </td>
      <td>
        <div className="arf-acts">
          <Tooltip label="Edit Advance Receipt Refund Adjustment" themed>
            <button type="button" className="ord-btn ord-btn--edit arf-btn-sq" onClick={onEdit} aria-label="Edit"><IcoPencil /></button>
          </Tooltip>
          <Tooltip label="Evidence Vault — refund, PO and payment proofs" themed>
            <button type="button" className="ord-btn ord-btn--vault" onClick={onVault}><IcoShield /><span>Evidence Vault</span></button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
