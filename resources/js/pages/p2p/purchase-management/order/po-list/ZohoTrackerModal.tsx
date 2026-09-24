// Where a PO stands in Zoho Books, as the chain the sync itself runs:
// purchase order → bill → payments, and once cancelled, vendor credit → refunds.
// Read from our own columns, so opening it never calls Zoho.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { poApi, type ZohoTracker, type ZohoTrackerStep } from '../api/po-api';
import { moneyIn } from '../../../../../utils/currency';
import './zoho-tracker.css';

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_X = <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const ICON_CHAIN = (
  <svg {...ic}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

/* One icon per link of the chain, so a step reads before its title does. */
const STEP_ICON: Record<ZohoTrackerStep['key'], React.ReactNode> = {
  purchase_order: <svg {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /></svg>,
  bill: <svg {...ic}><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="14" x2="13" y2="14" /></svg>,
  payments: <svg {...ic}><rect x="2" y="5" width="20" height="14" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" /></svg>,
  vendor_credit: <svg {...ic}><circle cx="12" cy="12" r="9" /><path d="M15 9.5a3.5 3.5 0 1 0 0 5" /></svg>,
  refunds: <svg {...ic}><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>,
};

const ICON_TICK_SM = <svg {...ic} strokeWidth={3.4} width="9" height="9"><polyline points="20 6 9 17 4 12" /></svg>;

const STATE_LABEL: Record<ZohoTrackerStep['state'], string> = {
  done: 'Done', pending: 'Pending', failed: 'Failed',
};

/** "17 Sep 2026 11:35" — the short form the timeline rows use. */
function stamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${date} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Who owns this link of the chain — us, or Zoho Books once it is across. */
const ACTOR: Record<ZohoTrackerStep['key'], string> = {
  purchase_order: 'Zoho Books',
  bill: 'Zoho Books',
  payments: 'Finance',
  vendor_credit: 'Zoho Books',
  refunds: 'Supplier',
};

export default function ZohoTrackerModal({ poId, poCode, onClose }: {
  poId: number; poCode: string; onClose: () => void;
}) {
  useScrollLock(true, '.zt-card');
  const [data, setData] = useState<ZohoTracker | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    poApi.zohoTracker(poId).then(setData).catch((e) => setError(e?.message || 'Could not load the Zoho Books tracker.'));
  }, [poId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct = data && data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
  const money = moneyIn(data?.currency);

  return createPortal(
    <div className="zt-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="zt-card" role="dialog" aria-modal="true" aria-label="PO timeline">

        <div className="zt-hero">
          <div className="zt-hero__ico">{ICON_CHAIN}</div>
          <div className="zt-hero__mid">
            <div className="zt-hero__eyebrow">{poCode} · Zoho Books Sync</div>
            <div className="zt-hero__title">PO Timeline</div>
            <div className="zt-hero__sub">{data?.cancelled ? 'Cancelled purchase order — credit & refund' : 'Purchase order, bill & payment'}</div>
          </div>
          <button type="button" className="zt-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="zt-prog">
          <div className="zt-prog__row">
            <span className="zt-prog__label">Overall Progress</span>
            <span className="zt-prog__count">{data ? `${data.done} / ${data.total} steps complete` : '—'}</span>
          </div>
          <div className="zt-prog__bar">
            <div className="zt-prog__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="zt-bd">
          {error && <div className="zt-err">{error}</div>}
          {!data && !error && <div className="zt-loading">Reading the sync state…</div>}
          {data && <div className="zt-bd__head">Sync Timeline</div>}

          {data?.steps.map((s, i) => (
            <div key={s.key} className={`zt-step is-${s.state}`}>
              <div className="zt-step__rail">
                <span className="zt-step__dot">{STEP_ICON[s.key]}</span>
                {i < data.steps.length - 1 && <span className="zt-step__line" />}
              </div>

              <div className="zt-step__body">
                <div className="zt-step__head">
                  <span className="zt-step__title">{s.title}</span>
                  <span className={`zt-pill zt-pill--${s.state}`}>
                    {s.state === 'done' && ICON_TICK_SM}{STATE_LABEL[s.state]}
                  </span>
                </div>
                <div className="zt-step__sub">{s.sub}</div>

                <div className="zt-step__meta">
                  <span className="zt-meta">{ACTOR[s.key]}</span>
                  {s.ref && <span className="zt-ref" title={s.ref}>{s.ref}</span>}
                  {s.note && <span className="zt-meta zt-meta--note">{s.note}{s.amount != null ? ' · ' + money(s.amount) : ''}</span>}
                  {s.at && <span className="zt-meta zt-meta--when">{stamp(s.at)}</span>}
                </div>

                {/* Every payment / refund on its own line — a part-posted step says which one is missing. */}
                {s.items.length > 0 && (
                  <div className="zt-items">
                    {s.items.map((it, n) => (
                      <div key={n} className={`zt-item is-${it.state}`}>
                        <span className="zt-item__dot" />
                        <span className="zt-item__label" title={it.label}>{it.label}</span>
                        <span className="zt-item__amt">{money(it.amount)}</span>
                        {it.at && <span className="zt-item__when">{stamp(it.at)}</span>}
                        <span className={`zt-pill zt-pill--${it.state} zt-pill--sm`}>
                          {it.state === 'done' ? 'Synced' : it.state === 'failed' ? 'Failed' : 'Not Synced'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {s.error && <div className="zt-step__err">{s.error}</div>}
              </div>
            </div>
          ))}

          {data && !data.cancelled && (
            <div className="zt-foot">Cancel this PO and two more steps appear here — the vendor credit and the refunds against it.</div>
          )}
        </div>

        <div className="zt-actions">
          <button type="button" className="zt-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
