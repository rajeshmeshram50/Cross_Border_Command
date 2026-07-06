import { useEffect, useState } from 'react';
import { formatDmy } from '../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Details — quick-view modal triggered by the eye icon in the table.
 *
 * The table row already carries every column the user can see, but the
 * detail view wants a few extra fields (address, message, stage, etc.)
 * that we don't keep in `leads` state. We fetch the full record via
 * GET /sales/leads/{id} when the modal opens so the modal stays in
 * sync with whatever the controller decides to surface — no need to
 * widen the list payload for these eight extra strings.
 *
 * The modal is *read-only* by design — assign + CTQ live elsewhere
 * (the row action icons and the floating bulk bar). Keeping this view
 * presentational makes it cheap to embed inside other surfaces later.
 * ───────────────────────────────────────────────────────────────────────── */

type ServerLead = {
  id:                  number;
  opp_code:            string;
  unique_query_id:     string | null;
  platform:            string | null;
  query_type:          string | null;
  query_time:          string | null;
  created_at:          string | null;
  sender_name:         string | null;
  sender_mobile:       string | null;
  sender_email:        string | null;
  sender_company:      string | null;
  sender_address:      string | null;
  sender_city:         string | null;
  sender_state:        string | null;
  sender_pincode:      string | null;
  sender_country_iso:  string | null;
  sender_country_name: string | null;
  query_product_name:  string | null;
  query_message:       string | null;
  product_quantity:    string | null;
  lead_stage_id:       number | null;
  qualified:           boolean;
  disqualified:        boolean;
  key_opportunity:     boolean;
  has_whatsapp:        boolean;
  whatsapp_status:     string | null;
  salesperson:         { id: number; name: string } | null;
  customer:            { id: number; company_name: string; customer_code: string } | null;
  consignee:           { id: number; company_name: string } | null;
  ackReason?:          { id: number; reason: string } | null;
};

const STAGE_LABEL: Record<number, string> = {
  1: 'Inquiry Required',
  2: 'Lead Acknowledgement',
  3: 'Product Sourcing',
  4: 'Price Shared',
  5: 'Pre-PI CLM',
  6: 'Quotation vs PI',
  7: 'Post-PI CLM',
  8: 'Victory',
};

type Props = {
  open: boolean;
  leadId: number | null;
  onClose: () => void;
};

export default function LeadDetailsModal({ open, leadId, onClose }: Props) {
  const toast = useToast();
  const [lead, setLead] = useState<ServerLead | null>(null);
  const [loading, setLoading] = useState(false);

  // Scroll lock — lock BOTH <html> and <body> so the page behind can't
  // scroll regardless of which element owns the viewport scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  useEffect(() => {
    if (!open || !leadId) {
      setLead(null);
      return;
    }
    setLoading(true);
    api.get<{ status: boolean; data: ServerLead }>(`/sales/leads/${leadId}`)
      .then(({ data }) => setLead(data.data))
      .catch(() => toast.error('Load failed', 'Could not load lead details'))
      .finally(() => setLoading(false));
  }, [open, leadId, toast]);

  if (!open) return null;

  const status: 'qualified' | 'disqualified' = lead?.disqualified ? 'disqualified' : 'qualified';
  const dateLabel = lead?.query_time
    ? formatDmy(lead.query_time)
    : (lead?.created_at ? formatDmy(lead.created_at) : '—');
  const fullAddress = lead
    ? [lead.sender_address, lead.sender_city, lead.sender_state, lead.sender_pincode ?? null]
        .filter(Boolean)
        .join(', ')
    : '';

  return createPortal((
    /* Backdrop click is not wired to onClose — a stray click outside
     * the panel should not dismiss the detail view. The header ✕ and
     * footer Close button are the explicit dismissal paths. */
    <div className="ldv-backdrop">
      <style>{LDV_CSS}</style>
      <div className="ldv-modal">
        <div className="ldv-head">
          <div className="ldv-head-left">
            <div className="ldv-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <div className="ldv-head-title">Lead Details</div>
              <div className="ldv-head-sub">Opp ID: {lead?.opp_code ?? '—'}</div>
            </div>
          </div>
          {lead && (
            <span className={`ldv-status ldv-status-${status}`}>
              <span className="ldv-status-dot" />
              {status === 'qualified' ? 'Qualified' : 'Disqualified'}
            </span>
          )}
          <button className="ldv-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ldv-body">
          {loading && !lead && (
            <div className="ldv-loading">
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}

          {lead && (
            <div className="ldv-grid">
              <Card iconBg="#e0f2fe" iconColor="#0284c7" label="OPP ID" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="9" y="2" width="6" height="4" rx="1" />
                  <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
                </svg>
              }>
                <span className="ldv-value">{lead.opp_code}</span>
              </Card>

              <Card iconBg="#dbeafe" iconColor="#2563eb" label="OPP DATE" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }>
                <span className="ldv-value">{dateLabel}</span>
              </Card>

              <Card iconBg="#ede9fe" iconColor="#7c3aed" label="LEAD TYPE" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              }>
                <span className="ldv-chip ldv-chip-violet">{lead.query_type ?? '—'}</span>
              </Card>

              <Card iconBg="#dcfce7" iconColor="#16a34a" label="LEAD SOURCE" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              }>
                <span className="ldv-chip ldv-chip-green">{lead.platform ?? '—'}</span>
              </Card>

              <Card iconBg="#fce7f3" iconColor="#db2777" label="ASSIGN TO" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              }>
                <span className={`ldv-value ${!lead.salesperson ? 'ldv-value-muted' : ''}`}>
                  {lead.salesperson?.name ?? 'Unassigned'}
                </span>
              </Card>

              <Card iconBg="#cffafe" iconColor="#0891b2" label="CUSTOMER" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }>
                <span className="ldv-value">{lead.customer?.company_name ?? lead.sender_company ?? lead.sender_name ?? '—'}</span>
              </Card>

              <Card iconBg="#ccfbf1" iconColor="#0d9488" label="MOBILE NO" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              }>
                <span className="ldv-value">{lead.sender_mobile ?? '—'}</span>
              </Card>

              <Card iconBg="#e0e7ff" iconColor="#4f46e5" label="EMAIL ID" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              }>
                {lead.sender_email
                  ? <a className="ldv-link" href={`mailto:${lead.sender_email}`}>{lead.sender_email}</a>
                  : <span className="ldv-value-muted">—</span>}
              </Card>

              <Card iconBg="#fef3c7" iconColor="#d97706" label="COMPANY" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M3 21h18" />
                  <path d="M5 21V7l8-4v18" />
                  <path d="M19 21V11l-6-4" />
                </svg>
              }>
                <span className="ldv-value">{lead.sender_company ?? '—'}</span>
              </Card>

              <Card iconBg="#f1f5f9" iconColor="#475569" label="COUNTRY" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }>
                <span className="ldv-chip ldv-chip-cyan" title={lead.sender_country_name ?? undefined}>
                  {lead.sender_country_iso ?? lead.sender_country_name ?? '—'}
                </span>
              </Card>

              <Card highlight iconBg="#fde68a" iconColor="#ca8a04" label="PRODUCT" icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              }>
                <span className={`ldv-value ${!lead.query_product_name ? 'ldv-value-muted' : ''}`}>
                  {lead.query_product_name ?? '—'}
                </span>
              </Card>

              {/* Optional / data-dependent rows below. Render only when populated
                  so the modal stays compact for thin leads. */}
              {fullAddress && (
                <Card iconBg="#fae8ff" iconColor="#a21caf" label="ADDRESS" icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                }>
                  <span className="ldv-value">{fullAddress}</span>
                </Card>
              )}

              {lead.lead_stage_id && (
                <Card iconBg="#ecfeff" iconColor="#06b6d4" label="STAGE" icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                }>
                  <span className="ldv-chip ldv-chip-cyan">{STAGE_LABEL[lead.lead_stage_id] ?? `Stage ${lead.lead_stage_id}`}</span>
                </Card>
              )}

            </div>
          )}
        </div>

        <div className="ldv-foot">
          <span className="ldv-foot-meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Full lead record details
          </span>
          <button className="ldv-btn ldv-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Small primitives — kept inside the module so this component
 *     is fully self-contained and trivially copy-pasteable.        ─── */

function Card(props: {
  label: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /* Amber-tinted surface — the Figma highlights the PRODUCT card. */
  highlight?: boolean;
}) {
  const { label, iconBg, iconColor, icon, children, highlight } = props;
  return (
    <div className={`ldv-card${highlight ? ' ldv-card-amber' : ''}`}>
      <div className="ldv-card-icon" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </div>
      <div className="ldv-card-body">
        <div className="ldv-label">{label}</div>
        <div className="ldv-card-val">{children}</div>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="ldv-skel" />;
}

const LDV_CSS = `
.ldv-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  animation: ldv-fade .15s ease-out;
  padding: 24px;
}
@keyframes ldv-fade { from { opacity: 0; } to { opacity: 1; } }
.ldv-modal {
  width: 880px; max-width: 100%; max-height: 90vh;
  background: #fff; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  animation: ldv-pop .18s ease-out;
}
@keyframes ldv-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.ldv-head {
  display: flex; align-items: center; gap: 11px;
  padding: 13px 18px; background: linear-gradient(135deg, #0e7490, #0891b2 55%, #22d3ee);
  color: #fff; position: relative;
}
.ldv-head-left { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; }
.ldv-head-icon {
  width: 34px; height: 34px; border-radius: 10px;
  background: rgba(255,255,255,.2);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ldv-head-icon svg { width: 16px; height: 16px; }
.ldv-head-title { font-size: 14.5px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.ldv-head-sub { font-size: 10.5px; opacity: .85; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.ldv-status {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 999px;
  font-size: 10px; font-weight: 700; letter-spacing: .02em;
  background: rgba(255,255,255,.20); color: #fff;
  border: 1px solid rgba(255,255,255,.35);
}
.ldv-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,.30);
}
.ldv-status-disqualified .ldv-status-dot {
  background: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,.30);
}

.ldv-close {
  width: 26px; height: 26px; border: none; background: rgba(255,255,255,.18);
  color: #fff; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.ldv-close:hover { background: rgba(255,255,255,.32); }

.ldv-body { padding: 14px 18px; flex: 1; overflow-y: auto; background: #f8fafc; }
.ldv-loading {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
}
.ldv-skel {
  height: 56px; border-radius: 10px;
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 200% 100%;
  animation: ldv-shimmer 1.1s ease-in-out infinite;
}
@keyframes ldv-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.ldv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
}
.ldv-card {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; background: #fff;
  border: 1px solid #e2e8f0; border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
}
.ldv-card:hover { border-color: #cbd5e1; box-shadow: 0 2px 10px rgba(15,23,42,.04); }
/* Highlighted card (PRODUCT) — amber surface + border, matching Figma. */
.ldv-card-amber { background: #fffbeb; border-color: #fcd34d; }
.ldv-card-amber:hover { border-color: #fbbf24; box-shadow: 0 2px 10px rgba(217,119,6,.10); }
.ldv-card-wide { grid-column: 1 / -1; align-items: flex-start; flex-direction: column; gap: 6px; }
.ldv-card-head { display: flex; align-items: center; gap: 8px; }
.ldv-card-icon {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ldv-card-icon svg { width: 14px; height: 14px; }
.ldv-card-body { flex: 1; min-width: 0; }
.ldv-label {
  font-size: 8.5px; font-weight: 800; color: #94a3b8;
  letter-spacing: .10em; text-transform: uppercase; margin-bottom: 2px;
}
.ldv-card-val { line-height: 1.3; }
.ldv-value {
  font-size: 11.5px; font-weight: 700; color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.ldv-value-muted { color: #cbd5e1; font-weight: 500; }
.ldv-link { color: #0891b2; text-decoration: none; font-size: 11.5px; font-weight: 600; }
.ldv-link:hover { text-decoration: underline; }

.ldv-chip {
  display: inline-block; padding: 2px 9px; border-radius: 6px;
  font-size: 10px; font-weight: 700; border: 1.5px solid;
}
.ldv-chip-violet { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
.ldv-chip-green  { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.ldv-chip-cyan   { background: #ecfeff; color: #0e7490; border-color: #a5f3fc; }
.ldv-chip-slate  { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }

.ldv-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px; background: #fff; border-top: 1px solid #e2e8f0;
}
.ldv-foot-meta {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; color: #0891b2;
}
.ldv-btn {
  padding: 7px 22px; border-radius: 8px; font-size: 11px; font-weight: 700;
  cursor: pointer; border: 1.5px solid transparent; transition: all .15s;
}
.ldv-btn-primary {
  background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff;
}
.ldv-btn-primary:hover { filter: brightness(1.08); }

[data-bs-theme="dark"] .ldv-modal { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .ldv-body { background: #0b1226; }
[data-bs-theme="dark"] .ldv-card { background: #0f172a; border-color: #1e293b; }
[data-bs-theme="dark"] .ldv-card:hover { border-color: #334155; }
[data-bs-theme="dark"] .ldv-card-amber { background: rgba(217,119,6,.14); border-color: rgba(251,191,36,.4); }
[data-bs-theme="dark"] .ldv-value { color: #e2e8f0; }
[data-bs-theme="dark"] .ldv-foot { background: #0f172a; border-color: #1e293b; }
[data-bs-theme="dark"] .ldv-link { color: #67e8f9; }

/* Lead-details shimmer in dark mode — the light-mode gradient
 * (#e2e8f0 → #f1f5f9) renders as glaring near-white bars against the
 * #0b1226 modal body. Swap to a dark-slate gradient so the skeleton
 * reads as a subtle pulse instead of a flashbang. The lower-alpha
 * second stop preserves the "shimmer" highlight motion the keyframe
 * animates across. */
[data-bs-theme="dark"] .ldv-skel {
  background: linear-gradient(90deg, #1e293b 0%, #334155 50%, #1e293b 100%);
  background-size: 200% 100%;
}

@media (max-width: 720px) {
  .ldv-head { padding: 14px 16px; flex-wrap: wrap; gap: 10px; }
  .ldv-head-title { font-size: 16px; }
  .ldv-head-icon { width: 36px; height: 36px; }
  .ldv-status { order: 3; flex-basis: 100%; justify-content: flex-start; }
  .ldv-body { padding: 14px 16px; }
  .ldv-foot { padding: 12px 16px; flex-direction: column; gap: 10px; align-items: stretch; }
  .ldv-btn  { width: 100%; }
  .ldv-foot-meta { text-align: center; }
}
@media (max-width: 480px) {
  .ldv-backdrop { padding: 0; }
  .ldv-modal { border-radius: 0; max-height: 100vh; height: 100vh; }
}
`;
