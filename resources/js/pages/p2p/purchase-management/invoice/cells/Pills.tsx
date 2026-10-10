import { memo } from 'react';
import Badge, { type BadgeVariant } from '../../../../../components/ui/Badge';
import type {
  InvoiceDocumentType, InvoicePoType, InvoiceRiskLevel,
  InvoiceZohoStatus, InvoiceInspectionStatus, InvoiceSupplierCategory,
} from '../types';

const Warn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const Clock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
    strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const Star = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95z" />
  </svg>
);
const Ban = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
  </svg>
);
const Box = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const Wrench = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4z" />
  </svg>
);

const PO_TYPE_CLASS: Record<InvoicePoType, string> = {
  material: 'materials',
  services: 'services',
};

const PO_TYPE_LABEL: Record<InvoicePoType, string> = {
  material: 'Material / Goods',
  services: 'Services',
};

function PoTypePillBase({ type }: { type?: InvoicePoType }) {
  if (!type) return <span className="ord-dash">—</span>;
  return (
    <span className={`ord-typepill ord-typepill--${PO_TYPE_CLASS[type]}`}>
      <span className="ord-typepill__ico">{type === 'material' ? <Box /> : <Wrench />}</span>
      {PO_TYPE_LABEL[type]}
    </span>
  );
}
export const PoTypePill = memo(PoTypePillBase);

const DOC: Record<InvoiceDocumentType, { cls: string; label: string }> = {
  domestic: { cls: 'dom', label: 'Domestics' },
  international: { cls: 'intl', label: 'International' },
};

function DocTypePillBase({ type }: { type: InvoiceDocumentType }) {
  return <span className={`ord-doctype ord-doctype--${DOC[type].cls}`}>{DOC[type].label}</span>;
}
export const DocTypePill = memo(DocTypePillBase);

const RISK: Record<InvoiceRiskLevel, { label: string; variant: BadgeVariant; icon: React.ReactNode }> = {
  high:   { label: 'High',   variant: 'danger',  icon: <Warn /> },
  medium: { label: 'Medium', variant: 'warning', icon: <Clock /> },
  low:    { label: 'Low',    variant: 'success', icon: <Check /> },
};

function RiskPillBase({ level }: { level?: InvoiceRiskLevel }) {
  if (!level) return <span className="ord-dash">—</span>;
  const r = RISK[level];
  return (
    <Badge appearance="outline" variant={r.variant} icon={r.icon}
      className="ord-risk" title={`${r.label} Risk`}>
      {r.label}
    </Badge>
  );
}
export const RiskPill = memo(RiskPillBase);

const CATEGORY: Record<InvoiceSupplierCategory, { label: string; variant: BadgeVariant; icon: React.ReactNode }> = {
  star:          { label: 'Star Supplier',       variant: 'gold',   icon: <Star /> },
  regular:       { label: 'Regular Supplier',    variant: 'info',   icon: <Check /> },
  'high-risk':   { label: 'High Risk Supplier',  variant: 'danger', icon: <Warn /> },
  blacklisted:   { label: 'Blacklisted Supplier', variant: 'dark',  icon: <Ban /> },
};

function SupplierCategoryBadgeBase({ category }: { category: InvoiceSupplierCategory }) {
  const c = CATEGORY[category];
  return (
    <Badge appearance="outline" variant={c.variant} icon={c.icon}
      className="ord-supplier__cat" title={c.label}>
      {c.label}
    </Badge>
  );
}
export const SupplierCategoryBadge = memo(SupplierCategoryBadgeBase);

function PhysInspBadgeBase() {
  return (
    <Badge appearance="outline" variant="danger" icon={<Warn />}
      className="ord-physinsp"
      title="Physical inspection is mandatory for this purchase order">
      Physical Inspection
    </Badge>
  );
}
export const PhysInspBadge = memo(PhysInspBadgeBase);

type StatusTone = 'ok' | 'bad' | 'na';

function StatusPillBase({ tone, label, title }: { tone: StatusTone; label: string; title?: string }) {
  return (
    <span className={`ord-status ord-status--${tone}`} title={title}>
      <span className="ord-status__dot" />{label}
    </span>
  );
}
export const StatusPill = memo(StatusPillBase);

export const ZohoStatusPill = memo(({ status }: { status: InvoiceZohoStatus }) => (
  <StatusPill tone={status === 'synced' ? 'ok' : 'bad'}
    label={status === 'synced' ? 'Synced' : 'Not Sync'} />
));

const INSPECTION: Record<InvoiceInspectionStatus, { tone: StatusTone; label: string }> = {
  completed: { tone: 'ok', label: 'Completed' },
  pending: { tone: 'bad', label: 'Pending' },
  'not-applicable': { tone: 'na', label: 'Not Applicable' },
};

export const InspectionStatusPill = memo(({ status }: { status: InvoiceInspectionStatus }) => {
  const s = INSPECTION[status];
  return <StatusPill tone={s.tone} label={s.label} />;
});
