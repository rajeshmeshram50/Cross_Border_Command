import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Customer Evidence Vault — read-only compliance archive
 *
 * Single-customer popup that shows every piece of compliance evidence
 * tied to that customer in five buckets:
 *
 *   1. Company Due Diligence — PAN, TAN, GST, CIN, IEC, Address Proof, …
 *   2. Owner KYC Details     — Aadhaar, PAN, Passport, Director address …
 *   3. Trade Licenses        — IEC, APEDA, Agro Export Permit, Organic …
 *   4. Trade Documents       — Master Sales Agreement, PO Framework, NDA …
 *   5. Shipment Agreements   — per-shipment matrix (Buyer = Consignee / ≠)
 *
 * Header carries the per-customer status: total docs, verified count,
 * pending count, and per-bucket counts. Footer has Export All + Close.
 *
 * Backend wiring (planned, NOT live yet):
 *   GET /api/customers/{id}/vault → { stats, company_dd, owner_kyc,
 *                                     trade_licenses, trade_documents,
 *                                     shipment_agreements, last_updated }
 *
 * The component takes a `data` prop matching the VaultData shape below
 * so the future API integration is a one-line swap: replace the demo
 * builder with an api.get(`/customers/${id}/vault`) call. The shape is
 * intentionally flat so a single endpoint can hydrate the whole panel.
 * ──────────────────────────────────────────────────────────────────── */

/* ─── API contract — when the backend is built, this is the response
 *      shape the endpoint must return so the modal plugs in unchanged. */
export type VaultStatus = 'Verified' | 'Pending' | 'Expiring' | 'Signed';

export interface VaultDoc {
  id: number;
  name: string;
  reference?: string | null;       // license number / reference no
  authority?: string | null;       // issuing authority / counter party
  issue_date?: string | null;      // DD/MM/YYYY for display
  expiry?: string | null;          // DD/MM/YYYY or "Lifetime" or "—"
  attachment?: string | null;      // filename only — URL resolved by parent
  status: VaultStatus;
}

export interface VaultShipmentRow {
  id: number;
  shipment_id: string;             // SHP-2026-00487
  opportunity_id: string;          // OPP-107
  customer: string;
  country: string;
  due_dil:    { ratio: string; pct: number };   // "2/2"  + 100
  kyc:        { ratio: string; pct: number };
  trade_lic:  { ratio: string; pct: number };
  trade_docs: { ratio: string; pct: number };
  agreement:  { ratio: string; pct: number };
  risk: 'Compliant' | 'Medium' | 'High';
  buyer_is_consignee: boolean;
}

export interface VaultData {
  total_documents:        number;
  verified_signed:        number;
  pending:                number;
  company_dd_count:       number;
  owner_kyc_count:        number;
  trade_license_count:    number;
  trade_documents_count:  number;
  total_shipments:        number;
  company_dd:             VaultDoc[];
  owner_kyc:              VaultDoc[];
  trade_licenses:         VaultDoc[];
  trade_documents:        VaultDoc[];
  shipment_agreements:    VaultShipmentRow[];
  last_updated:           string;   // DD/MM/YYYY
}

export interface CustomerVaultTarget {
  id: string;             // C-001
  db_id?: number;
  company: string;
  risk?: string;          // Low / Medium / High
  type?: string;          // Retailer / Wholesaler / …
  segment?: string;       // Dry Fruits / Handicrafts …
  country?: string;
  contact?: string;
  contactCity?: string;
}

interface Props {
  open: boolean;
  customer: CustomerVaultTarget | null;
  onClose: () => void;
  /** Optional override — when the backend is wired, the parent passes
   *  the API response. Until then, the demo builder below produces a
   *  realistic snapshot for the design review. */
  data?: VaultData | null;
}

type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

const TABS: { key: TabKey; label: string; icon: string; countKey: keyof VaultData }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: 'ri-article-line',        countKey: 'trade_documents_count' },
  { key: 'shipment-agreements', label: 'Shipment Agreements',   icon: 'ri-truck-line',          countKey: 'total_shipments' },
];

/* ─── Demo-data builder — produces a realistic vault snapshot keyed
 *      off the customer's id so the same customer always renders the
 *      same numbers during design review. Swap this for the API call
 *      when the backend lands. */
function buildDemoVault(customer: CustomerVaultTarget): VaultData {
  return {
    total_documents:       22,
    verified_signed:       18,
    pending:               2,
    company_dd_count:      8,
    owner_kyc_count:       5,
    trade_license_count:   4,
    trade_documents_count: 3,
    total_shipments:       4,
    company_dd: [
      { id: 1, name: 'Company PAN',          reference: 'AABCT1234F',     authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyPAN.pdf',     status: 'Verified' },
      { id: 2, name: 'Company TAN',          reference: 'PNET01234B',     authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyTAN.pdf',     status: 'Verified' },
      { id: 3, name: 'Company GST',          reference: '27AABCT1234F1Z5', authority: 'GST Portal',     issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyGST.pdf',     status: 'Verified' },
      { id: 4, name: 'CIN / Shop Act',       reference: 'U72900MH2019PTC', authority: 'MCA',           issue_date: '01/01/2022', expiry: '—',           attachment: 'CIN.pdf',            status: 'Verified' },
      { id: 5, name: 'IEC Code',             reference: '0412345678',     authority: 'DGFT',           issue_date: '01/01/2021', expiry: '—',           attachment: 'IECCode.pdf',        status: 'Verified' },
      { id: 6, name: 'Business Address Proof', reference: '1234567890',   authority: '—',              issue_date: '01/01/2022', expiry: '01/01/2027', attachment: 'AddressProof.pdf',   status: 'Verified' },
      { id: 7, name: 'Cancelled Cheque',     reference: '1234567890',     authority: 'HDFC Bank',     issue_date: '01/01/2025', expiry: '—',           attachment: 'CancelledCheque.pdf', status: 'Expiring' },
      { id: 8, name: 'FSSAI License',        reference: '10223452000120', authority: 'FSSAI',         issue_date: '01/03/2024', expiry: '01/03/2025', attachment: 'FSSAI.pdf',          status: 'Pending' },
    ],
    owner_kyc: [
      { id: 1, name: 'Aadhaar Card',         reference: 'XXXX-XXXX-3456', authority: 'UIDAI',            issue_date: '01/05/2018', expiry: 'Lifetime', attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { id: 2, name: 'PAN Card',             reference: 'BVKPJ5678K',     authority: 'Income Tax Dept', issue_date: '01/01/2015', expiry: 'Lifetime', attachment: 'PANCard.pdf',     status: 'Verified' },
      { id: 3, name: 'Passport',             reference: 'P4521876J',      authority: 'MEA India',       issue_date: '15/06/2020', expiry: '15/06/2030', attachment: 'Passport.pdf',    status: 'Verified' },
      { id: 4, name: 'Director Address Proof', reference: '—',             authority: '—',               issue_date: '01/01/2024', expiry: '01/01/2026', attachment: 'DirAddress.pdf',  status: 'Verified' },
      { id: 5, name: 'DIN Certificate',      reference: '07654321',       authority: 'MCA',             issue_date: '—',           expiry: '—',           attachment: 'DIN.pdf',          status: 'Pending' },
    ],
    trade_licenses: [
      { id: 1, name: 'Import Export License', reference: 'IEC-0412345678',      authority: 'DGFT',          issue_date: '01/01/2021', expiry: 'Lifetime',   attachment: 'IECLicense.pdf',  status: 'Verified' },
      { id: 2, name: 'APEDA Registration',    reference: 'APEDA/REG/2021/7823', authority: 'APEDA',          issue_date: '15/03/2021', expiry: '14/03/2027', attachment: 'APEDA.pdf',       status: 'Verified' },
      { id: 3, name: 'Agro Export Permit',    reference: 'AGRO/EXP/MH/4512',    authority: 'State Agri Dept', issue_date: '01/06/2023', expiry: '01/06/2026', attachment: 'AgroPermit.pdf',  status: 'Expiring' },
      { id: 4, name: 'Organic Certification', reference: 'NPOP/ORG/2022/1134',  authority: 'APEDA / NPOP',   issue_date: '10/10/2022', expiry: '09/10/2027', attachment: 'OrganicCert.pdf', status: 'Verified' },
    ],
    trade_documents: [
      { id: 1, name: 'Master Sales Agreement', reference: 'MSA/CUST/2024/001', authority: customer.company, issue_date: '01/04/2024', expiry: '31/03/2027', attachment: 'MSA.pdf',         status: 'Verified' },
      { id: 2, name: 'Purchase Order Framework', reference: 'POF/CUST/2024/012', authority: customer.company, issue_date: '15/04/2024', expiry: '14/04/2026', attachment: 'POFramework.pdf', status: 'Verified' },
      { id: 3, name: 'NDA & Confidentiality', reference: 'NDA/CUST/2025/003', authority: customer.company, issue_date: '—',           expiry: '—',          attachment: 'NDA.pdf',         status: 'Pending' },
    ],
    shipment_agreements: [
      { id: 1, shipment_id: 'SHP-2026-00487', opportunity_id: 'OPP-107', customer: customer.company,    country: customer.country ?? 'India',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
      { id: 2, shipment_id: 'SHP-2026-00328', opportunity_id: 'OPP-028', customer: 'GreenHarvest Global Ltd', country: 'United States',
        due_dil: { ratio: '0/2', pct: 0 },   kyc: { ratio: '0/4', pct: 0 },   trade_lic: { ratio: '0/1', pct: 0 },   trade_docs: { ratio: '0/4', pct: 0 },   agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: false },
      { id: 3, shipment_id: 'SHP-2026-00512', opportunity_id: 'OPP-134', customer: 'Eastern Harvest Co.',    country: 'UAE',
        due_dil: { ratio: '1/2', pct: 50 },  kyc: { ratio: '2/3', pct: 67 },  trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '2/4', pct: 50 },  agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: true },
      { id: 4, shipment_id: 'SHP-2026-00601', opportunity_id: 'OPP-156', customer: 'International Buyer LLC', country: 'UAE',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
    ],
    last_updated: '04/05/2026',
  };
}

export default function CustomerEvidenceVaultModal({ open, customer, onClose, data }: Props) {
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [shipmentFilter, setShipmentFilter] = useState<'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee'>('all');

  /* Close on Escape — destructive shortcut is fine for a read-only
   * panel since there's no in-flight edit to lose. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Reset to first tab whenever the modal opens for a new customer.
    setTab('company-dd');
    setShipmentFilter('all');
    return () => window.removeEventListener('keydown', onKey);
  }, [open, customer?.db_id, onClose]);

  const vault: VaultData | null = useMemo(() => {
    if (!customer) return null;
    return data ?? buildDemoVault(customer);
  }, [customer, data]);

  if (!open || !customer || !vault) return null;

  /* ─── Status pill renderer — Verified (mint), Expiring (amber),
   *      Pending (rose), Signed (sky). Same palette across all tabs. */
  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#d1fae5', fg: '#047857', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', mark: '⌛' };
    return (
      <span className="cev-pill" style={{ background: tone.bg, color: tone.fg }}>
        {tone.mark} {s}
      </span>
    );
  };

  /* ─── Filter chips above each docs table (Verified / Expiring /
   *      Pending) — pure counters from the bucket data. */
  const docsForTab: VaultDoc[] = tab === 'company-dd' ? vault.company_dd
    : tab === 'owner-kyc'      ? vault.owner_kyc
    : tab === 'trade-licenses' ? vault.trade_licenses
    : tab === 'trade-documents' ? vault.trade_documents
    : [];
  const counts = {
    Verified: docsForTab.filter(d => d.status === 'Verified' || d.status === 'Signed').length,
    Expiring: docsForTab.filter(d => d.status === 'Expiring').length,
    Pending:  docsForTab.filter(d => d.status === 'Pending').length,
  };

  const tabMeta = TABS.find(t => t.key === tab)!;

  return createPortal(
    <div className="cev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CEV_CSS}</style>
      <div className="cev-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="cev-header">
          <div className="cev-header-bg" aria-hidden />
          <span className="cev-header-orb" aria-hidden />
          <div className="cev-header-content">
            <div className="cev-header-left">
              <div className="cev-vault-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1.5" />
                  <path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                  <line x1="10" y1="13" x2="14" y2="13" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                <span className="cev-vault-icon-tick" aria-hidden>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="cev-header-text">
                <div className="cev-header-eyebrow">— EVIDENCE VAULT</div>
                <div className="cev-header-title">{customer.company}</div>
                <div className="cev-header-chips">
                  <span className="cev-chip cev-chip-id">● {customer.id}</span>
                  <span className="cev-chip cev-chip-risk"  data-risk={(customer.risk ?? 'Low').toLowerCase()}>● {customer.risk ?? 'Low'} Risk</span>
                  {customer.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {customer.contact}{customer.contactCity ? ` · ${customer.contactCity}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="cev-header-right">
              <div className="cev-header-meta">
                {customer.type && <span>{customer.type}</span>}
                {customer.segment && <span>· {customer.segment}</span>}
                {customer.country && <span>· {customer.country}</span>}
              </div>
              <button type="button" className="cev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ─── KPI STRIP — horizontal scroll marquee (HR Employees
             pattern). Wheel-to-horizontal handler converts vertical
             mouse-wheel into horizontal scroll so the user can pan
             through tiles without grabbing a scrollbar. */}
        <div
          className="cev-kpi-strip"
          onWheel={(e) => {
            // Forward only vertical wheel motion; trackpad horizontal
            // scrolls are already handled natively (deltaX) so we
            // skip those to avoid doubling the scroll.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          <KpiTile label="Total Documents"        value={vault.total_documents}        icon="ri-file-list-3-line"        gradient="linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)" />
          <KpiTile label="Verified / Signed"      value={vault.verified_signed}        icon="ri-shield-check-line"       gradient="linear-gradient(135deg, #16a34a 0%, #4ade80 100%)" />
          <KpiTile label="Pending"                value={vault.pending}                icon="ri-time-line"               gradient="linear-gradient(135deg, #d97706 0%, #f59e0b 100%)" />
          <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       icon="ri-building-line"           gradient="linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)" />
          <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        icon="ri-user-3-line"             gradient="linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)" />
          <KpiTile label="Trade License"          value={vault.trade_license_count}    icon="ri-government-line"         gradient="linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" />
          <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  icon="ri-article-line"            gradient="linear-gradient(135deg, #6366f1 0%, #a5b4fc 100%)" />
          <KpiTile label="Total Shipments"        value={vault.total_shipments}        icon="ri-truck-line"              gradient="linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)" />
        </div>

        {/* ─── TABS ─── */}
        <div className="cev-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`cev-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <i className={t.icon} aria-hidden />
              <span>{t.label}</span>
              <span className="cev-tab-count">{vault[t.countKey] as number}</span>
            </button>
          ))}
        </div>

        {/* ─── BODY ─── */}
        <div className="cev-body">
          {/* Section banner — explains what the active tab holds. */}
          <div className="cev-section">
            <div className="cev-section-left">
              <div className="cev-section-icon"><i className={tabMeta.icon} /></div>
              <div>
                <div className="cev-section-title">{tabMeta.label}</div>
                <div className="cev-section-sub">{sectionSub(tab)}</div>
              </div>
            </div>
            <div className="cev-section-right">
              <div className="cev-section-count">{vault[tabMeta.countKey] as number}</div>
              <div className="cev-section-count-label">{tab === 'shipment-agreements' ? 'SHIPMENTS' : 'DOCUMENTS'}</div>
            </div>
          </div>

          {/* Status filter chips — only for the 4 document tabs. */}
          {tab !== 'shipment-agreements' && (
            <div className="cev-filter-row">
              <span className="cev-filter cev-filter-verified">● Verified {counts.Verified}</span>
              <span className="cev-filter cev-filter-expiring">● Expiring {counts.Expiring}</span>
              <span className="cev-filter cev-filter-pending">● Pending {counts.Pending}</span>
            </div>
          )}

          {/* Tables */}
          {tab === 'shipment-agreements'
            ? <ShipmentTable rows={vault.shipment_agreements} filter={shipmentFilter} setFilter={setShipmentFilter} />
            : <DocsTable rows={docsForTab} tab={tab} StatusPill={StatusPill} />}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="cev-footer">
          <div className="cev-footer-meta">
            Last updated: <b>{vault.last_updated}</b> · Vault managed by Compliance Team
          </div>
          <div className="cev-footer-actions">
            <button type="button" className="cev-btn cev-btn-light" onClick={() => alert('Export wiring lands with the backend')}>
              <i className="ri-download-cloud-2-line" /> Export All
            </button>
            <button type="button" className="cev-btn cev-btn-dark" onClick={onClose}>
              Close Vault
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── KPI tile — project-standard card pattern (mirrors the Master
 *      pages' .mp-kpi-tile). Top gradient accent strip, label +
 *      value on the left, gradient icon square on the right. */
function KpiTile({ label, value, icon, gradient }: { label: string; value: number; icon: string; gradient: string }) {
  return (
    <div className="cev-kpi-tile">
      <span className="cev-kpi-strip-top" style={{ background: gradient }} aria-hidden />
      <div className="cev-kpi-body">
        <div className="cev-kpi-text">
          <div className="cev-kpi-label">{label.toUpperCase()}</div>
          <div className="cev-kpi-value">{value.toLocaleString()}</div>
        </div>
        <div className="cev-kpi-icon" style={{ background: gradient }}>
          <i className={icon} aria-hidden />
        </div>
      </div>
    </div>
  );
}

/* ─── Docs table — used by 4 of the 5 tabs. */
function DocsTable({ rows, tab, StatusPill }: { rows: VaultDoc[]; tab: TabKey; StatusPill: (p: { s: VaultStatus }) => JSX.Element }) {
  const numberHeader = tab === 'company-dd' ? 'License / Number' : tab === 'owner-kyc' ? 'Document Number' : tab === 'trade-licenses' ? 'License Number' : 'Reference No';
  const issueLabel   = tab === 'trade-documents' ? 'Signed Date' : 'Issue Date';
  const expiryLabel  = tab === 'trade-documents' ? 'Valid Till'  : 'Expiry';
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">
      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>SR</th>
            <th>Document Name</th>
            <th>{numberHeader}</th>
            <th>{authorityLbl}</th>
            <th>{issueLabel}</th>
            <th>{expiryLabel}</th>
            <th>Attachment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="cev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              <td className="cev-doc-name">{d.name}</td>
              <td className="cev-mono">{d.reference || '—'}</td>
              <td>{d.authority || '—'}</td>
              <td><span className="cev-date">{d.issue_date || '—'}</span></td>
              <td><span className="cev-date cev-date-expiry" data-status={d.status.toLowerCase()}>{d.expiry || '—'}</span></td>
              <td>
                {d.attachment ? (
                  <Tooltip label={d.attachment}>
                    <span className="cev-attach">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {d.attachment}
                    </span>
                  </Tooltip>
                ) : <span className="cev-muted">Not uploaded</span>}
              </td>
              <td><StatusPill s={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ─── Shipment agreements matrix — different shape from the docs
 *      tables, so it gets its own renderer. */
function ShipmentTable({ rows, filter, setFilter }: {
  rows: VaultShipmentRow[];
  filter: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee';
  setFilter: (f: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee') => void;
}) {
  const filtered = rows.filter(r =>
    filter === 'all' ? true
    : filter === 'buyer-eq-consignee' ? r.buyer_is_consignee
    : !r.buyer_is_consignee
  );
  return (
    <>
      <div className="cev-ship-filter">
        <button type="button" className={`cev-ship-fbtn ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All Shipments</button>
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-eq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-eq-consignee')}>✓ Buyer = Consignee</button>
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-neq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-neq-consignee')}>✕ Buyer ≠ Consignee</button>
      </div>
      <div className="cev-table-wrap">
        <div className="cev-table-scroll">
        <table className="cev-table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>SR</th>
              <th>Shipment ID</th>
              <th>Opportunity ID</th>
              <th>Customer</th>
              <th>Country</th>
              <th>Due Dil.</th>
              <th>KYC</th>
              <th>Trade Lic.</th>
              <th>Trade Docs</th>
              <th>Agreement</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="cev-empty">No shipments match the filter.</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td><span className="cev-chip-pill">● {r.shipment_id}</span></td>
                <td><span className="cev-chip-pill cev-chip-pill-warm">● {r.opportunity_id}</span></td>
                <td>
                  <span className="cev-cust-cell">
                    <span className="cev-cust-mono">{r.customer.charAt(0)}</span>
                    {r.customer}
                  </span>
                </td>
                <td>{r.country}</td>
                <td><Ratio r={r.due_dil} /></td>
                <td><Ratio r={r.kyc} /></td>
                <td><Ratio r={r.trade_lic} /></td>
                <td><Ratio r={r.trade_docs} /></td>
                <td><Ratio r={r.agreement} /></td>
                <td>
                  <span className={`cev-pill cev-risk-${r.risk.toLowerCase()}`}>
                    {r.risk === 'Compliant' ? '✓' : '⚠'} {r.risk}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function Ratio({ r }: { r: { ratio: string; pct: number } }) {
  return (
    <span className="cev-ratio" data-tone={r.pct >= 100 ? 'good' : r.pct >= 50 ? 'mid' : 'bad'}>
      <span className="cev-ratio-num">{r.ratio}</span>
      <span className="cev-ratio-pct">{r.pct}%</span>
    </span>
  );
}

function sectionSub(tab: TabKey): string {
  switch (tab) {
    case 'company-dd':       return 'Business registration, tax, compliance & identity documents';
    case 'owner-kyc':        return 'Director identity, address proof & personal compliance documents';
    case 'trade-licenses':   return 'Export, import & product-specific trade authorization licenses';
    case 'trade-documents':  return 'Sales contracts, purchase orders & signed trade agreements';
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by buyer-consignee link';
  }
}

/* ─── Scoped CSS (all rules under .cev-*) ─── */
/* Violet palette — matches the Sales → Customers page (purple WDH
   strip, violet Add Customer button, lavender table header). The
   vault opens FROM that page so it should feel like an extension of
   it, not a sibling module. Emerald is reserved for the Consignee
   module which has its own visual identity. */
const CEV_CSS = `
.cev-overlay {
  position: fixed; inset: 0;
  background: rgba(40,18,80,0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: stretch; justify-content: flex-end;
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  animation: cevFade .18s ease both;
}
@keyframes cevFade { from { opacity: 0; } to { opacity: 1; } }
.cev-card {
  position: relative;
  width: min(1280px, 90vw);
  height: 100vh;
  background: #faf7ff;
  /* No curve — straight edges so the drawer feels like a flush
     extension of the page rather than a floating card. */
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: -32px 0 80px rgba(40,18,80,.40), -12px 0 30px rgba(40,18,80,.18);
  animation: cevSlide .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes cevSlide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── HEADER ─── */
.cev-header {
  position: relative;
  flex-shrink: 0;
  padding: 14px 22px;
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 65%, #a78bfa 100%);
  color: #fff;
  overflow: hidden;
}
/* Decorative bubble cluster — mirrors the green Figma reference. Pure
   CSS circles sized + positioned so they read as soft floating orbs on
   the right side of the gradient. pointer-events: none keeps them
   purely cosmetic. */
.cev-header-bg {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(circle at 100% 0%, rgba(221,214,254,0.32), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(167,139,250,0.30), transparent 55%);
}
.cev-header-bg::before,
.cev-header-bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 60%, transparent 75%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
.cev-header-bg::before { width: 220px; height: 220px; top: -80px; right: -40px; }
.cev-header-bg::after  { width: 130px; height: 130px; bottom: -45px; right: 130px;
  background: radial-gradient(circle at 30% 30%, rgba(196,181,253,0.30), rgba(196,181,253,0.06) 60%, transparent 75%); }
/* Extra orb via a span on the JSX side too — gives a third bubble
   without nesting another wrapper. */
.cev-header-orb {
  position: absolute;
  width: 90px; height: 90px;
  top: 8px; right: 220px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%, transparent 75%);
  pointer-events: none;
}
.cev-header-content {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
}
.cev-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cev-vault-icon {
  position: relative;
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,0.18);
  border: 1.5px solid rgba(255,255,255,0.35);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  flex-shrink: 0;
}
.cev-vault-icon-tick {
  position: absolute; top: -3px; right: -3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #a78bfa; color: #2e1065;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #6d28d9;
}
.cev-header-text { min-width: 0; }
.cev-header-eyebrow { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.78); margin-bottom: 2px; }
.cev-header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 6px; color: #fff; }
.cev-header-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cev-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.24); color: #f5f3ff; }
.cev-chip-id { background: rgba(255,255,255,0.20); }
.cev-chip-risk[data-risk="low"]    { background: rgba(16,185,129,0.30); color: #ecfdf5; }
.cev-chip-risk[data-risk="medium"] { background: rgba(245,158,11,0.30); color: #fef3c7; }
.cev-chip-risk[data-risk="high"]   { background: rgba(239,68,68,0.30);  color: #fee2e2; }

.cev-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.cev-header-meta { font-size: 11px; color: rgba(255,255,255,.84); display: inline-flex; gap: 4px; align-items: center; }
.cev-header-meta span { white-space: nowrap; }
.cev-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); color: #fff; border: 1px solid rgba(255,255,255,0.28);
  cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.cev-close:hover { background: rgba(255,255,255,0.30); transform: rotate(90deg); }

/* ─── KPI STRIP — horizontal scroll marquee. Same affordance as the
   HR Employees KPI strip: tiles stay at their natural width and the
   user wheels/drags horizontally to see them all. Mouse-wheel
   vertical → horizontal scroll via the JSX onWheel handler. */
.cev-kpi-strip {
  flex-shrink: 0;
  display: flex; gap: 10px; align-items: stretch;
  padding: 12px 24px;
  background: #faf7ff;
  border-bottom: 1px solid #ede9fe;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scroll-behavior: smooth;
  scroll-snap-type: x proximity;
}
.cev-kpi-strip::-webkit-scrollbar { height: 6px; }
.cev-kpi-strip::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-kpi-strip::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.55); }
.cev-kpi-tile {
  position: relative;
  flex: 0 0 220px;            /* fixed width — strip scrolls when many */
  scroll-snap-align: start;
  background: var(--vz-card-bg, #fff);
  border: 1px solid rgba(124,58,237,0.16);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 2px 10px rgba(40,18,80,0.06);
  overflow: hidden;
  min-width: 0;
  transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
}
.cev-kpi-tile:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(40,18,80,0.10);
  border-color: rgba(124,58,237,0.30);
}
.cev-kpi-strip-top {
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
}
.cev-kpi-body {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.cev-kpi-text { min-width: 0; }
.cev-kpi-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  color: var(--vz-secondary-color, #6b7280);
  text-transform: uppercase;
  margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cev-kpi-value {
  font-size: 22px; font-weight: 800; line-height: 1;
  color: var(--vz-heading-color, #2b3245);
}
.cev-kpi-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0,0,0,0.10);
}

/* ─── TABS ─── */
.cev-tabs {
  flex-shrink: 0;
  display: flex; gap: 2px;
  padding: 14px 24px 0;
  background: #faf7ff;
  border-bottom: 1px solid #ede9fe;
  overflow-x: auto;
  scrollbar-width: thin;
}
.cev-tab {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #6b7280;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .15s;
  margin-bottom: -1px;
}
.cev-tab i { font-size: 14px; opacity: 0.7; }
.cev-tab:hover { color: #6d28d9; }
.cev-tab.is-active { color: #6d28d9; border-bottom-color: #7c3aed; }
.cev-tab-count {
  background: #ede9fe; color: #5b21b6;
  font-size: 10.5px; font-weight: 700;
  padding: 2px 7px; border-radius: 999px;
  min-width: 22px; text-align: center;
}
.cev-tab.is-active .cev-tab-count { background: #7c3aed; color: #fff; }

/* ─── BODY ─── */
.cev-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 18px 24px 22px;
  display: flex; flex-direction: column; gap: 14px;
  scrollbar-width: thin;
}
.cev-body::-webkit-scrollbar { width: 8px; }
.cev-body::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-body::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.55); }

.cev-section {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(110deg, #f5f3ff, #ede9fe 70%, #ddd6fe);
  border: 1px solid rgba(124,58,237,.18);
  border-radius: 14px;
}
.cev-section-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cev-section-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
}
.cev-section-title { font-size: 15px; font-weight: 800; color: #4c1d95; }
.cev-section-sub   { font-size: 12px; color: #6d28d9; margin-top: 1px; }
.cev-section-right { text-align: right; }
.cev-section-count { font-size: 26px; font-weight: 800; color: #4c1d95; line-height: 1; }
.cev-section-count-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: #6d28d9; margin-top: 2px; }

.cev-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cev-filter { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; border: 1px solid transparent; }
.cev-filter-verified { background: #d1fae5; color: #047857; border-color: rgba(5,150,105,.30); }
.cev-filter-expiring { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-filter-pending  { background: #fee2e2; color: #b91c1c; border-color: rgba(239,68,68,.30); }

.cev-table-wrap {
  background: #fff;
  border: 1px solid rgba(124,58,237,.18);
  border-radius: 14px;
  overflow: hidden;          /* keep the rounded edge crisp over the
                                 sticky header band — w/o this the band
                                 paints over the corner radius */
  scrollbar-width: thin;
  position: relative;
}
/* Inner scroll context for the table — its own scrolling ancestor
   so the sticky thead pins inside the table, not against the
   outer body. Without an explicit max-height the table would grow
   freely and the body's scroll would handle it instead, which let
   long row lists slide under the sticky band visually. */
.cev-table-scroll {
  max-height: 480px;
  overflow-x: auto;
  overflow-y: auto;
  scrollbar-width: thin;
}
.cev-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.55); }
.cev-table-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.cev-table thead th {
  position: sticky; top: 0;
  z-index: 3;                /* sits above row cells AND above any
                                 backdrop the body might leak under */
  padding: 9px 14px;         /* tighter than 12px — visually slim band */
  text-align: left;
  /* Glossy lavender band: top highlight → core fill → soft shadow line
     at the bottom. Looks lifted off the surface so the sticky scroll
     state reads cleanly even when rows pass underneath. */
  background:
    linear-gradient(180deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.65),
    inset 0 -1px 0 rgba(124,58,237,0.25),
    0 4px 10px -8px rgba(124,58,237,0.30);
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  color: #5b21b6; text-transform: uppercase;
  white-space: nowrap;
}
.cev-table tbody td { padding: 13px 14px; border-bottom: 1px solid #f5f3ff; vertical-align: middle; }
.cev-table tbody tr:last-child td { border-bottom: none; }
.cev-table tbody tr:hover td { background: #faf7ff; }
.cev-doc-name { font-weight: 700; color: #4c1d95; }
.cev-mono { font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace; font-size: 12px; color: #1f2937; }
.cev-empty { padding: 30px !important; text-align: center; color: #94a3b8; font-style: italic; }
.cev-muted { color: #94a3b8; font-style: italic; font-size: 12px; }

.cev-date {
  display: inline-block;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 6px;
  background: #f5f3ff; color: #5b21b6;
}
.cev-date-expiry[data-status="expiring"] { background: #fef3c7; color: #92400e; }
.cev-date-expiry[data-status="pending"]  { background: #fee2e2; color: #b91c1c; }

.cev-attach {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  background: #ede9fe; color: #5b21b6;
  font-size: 11.5px; font-weight: 600;
  border: 1px solid rgba(124,58,237,.30);
}

.cev-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.cev-risk-compliant { background: #d1fae5; color: #047857; }
.cev-risk-medium    { background: #fef3c7; color: #92400e; }
.cev-risk-high      { background: #fee2e2; color: #b91c1c; }

/* Chip pills used in shipment matrix */
.cev-chip-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 6px; background: #ede9fe; color: #5b21b6; font-size: 11.5px; font-weight: 700; border: 1px solid rgba(124,58,237,.30); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.cev-chip-pill-warm { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-cust-cell { display: inline-flex; align-items: center; gap: 8px; }
.cev-cust-mono {
  width: 26px; height: 26px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
  font-size: 11.5px; font-weight: 800;
  flex-shrink: 0;
}
.cev-ratio { display: inline-flex; flex-direction: column; gap: 1px; line-height: 1.1; }
.cev-ratio-num { font-weight: 800; font-size: 13px; }
.cev-ratio-pct { font-size: 10px; font-weight: 700; color: #6b7280; }
.cev-ratio[data-tone="good"] .cev-ratio-num { color: #047857; }
.cev-ratio[data-tone="mid"]  .cev-ratio-num { color: #b45309; }
.cev-ratio[data-tone="bad"]  .cev-ratio-num { color: #b91c1c; }

.cev-ship-filter { display: flex; gap: 8px; flex-wrap: wrap; }
.cev-ship-fbtn {
  flex: 1; min-width: 160px;
  padding: 10px 18px;
  background: #fff;
  border: 1px solid rgba(124,58,237,.20);
  border-radius: 10px;
  color: #475569;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.cev-ship-fbtn:hover { background: #faf7ff; color: #6d28d9; }
.cev-ship-fbtn.is-active {
  background: linear-gradient(135deg, #6d28d9, #7c3aed);
  color: #fff; border-color: transparent;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
}

/* ─── FOOTER ─── */
.cev-footer {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.cev-footer-meta { font-size: 12px; color: #475569; }
.cev-footer-actions { display: flex; gap: 10px; }
.cev-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all .15s;
}
.cev-btn-light { background: #fff; color: #6d28d9; border-color: rgba(124,58,237,.30); }
.cev-btn-light:hover { background: #f5f3ff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.20); }
.cev-btn-dark  { background: linear-gradient(135deg, #4c1d95, #7c3aed); color: #fff; box-shadow: 0 4px 14px rgba(76,29,149,.30); }
.cev-btn-dark:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(76,29,149,.45); }

/* ─── DARK MODE — violet palette mapped to lavender-on-deep-purple ─── */
[data-bs-theme="dark"] .cev-card { background: #1a1430; }
[data-bs-theme="dark"] .cev-tabs { background: #1a1430; border-bottom-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-tab { color: #94a3b8; }
[data-bs-theme="dark"] .cev-tab:hover { color: #c4b5fd; }
[data-bs-theme="dark"] .cev-tab.is-active { color: #c4b5fd; border-bottom-color: #a78bfa; }
[data-bs-theme="dark"] .cev-tab-count { background: rgba(124,58,237,.22); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-tab.is-active .cev-tab-count { background: #7c3aed; color: #fff; }
[data-bs-theme="dark"] .cev-kpi-strip { background: #1a1430; border-bottom-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-kpi-tile { background: #211a3d; border-color: rgba(124,58,237,.28); box-shadow: 0 2px 10px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .cev-kpi-tile:hover { border-color: rgba(124,58,237,.45); box-shadow: 0 6px 18px rgba(0,0,0,0.40); }
[data-bs-theme="dark"] .cev-kpi-label { color: #94a3b8; }
[data-bs-theme="dark"] .cev-kpi-value { color: #ede9fe; }
[data-bs-theme="dark"] .cev-body { background: #1a1430; }
[data-bs-theme="dark"] .cev-section { background: linear-gradient(110deg, rgba(124,58,237,.14), rgba(167,139,250,.10)); border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-section-title { color: #ede9fe; }
[data-bs-theme="dark"] .cev-section-sub { color: #c4b5fd; }
[data-bs-theme="dark"] .cev-section-count { color: #ede9fe; }
[data-bs-theme="dark"] .cev-section-count-label { color: #c4b5fd; }
[data-bs-theme="dark"] .cev-table-wrap { background: #211a3d; border-color: rgba(124,58,237,.28); }
[data-bs-theme="dark"] .cev-table thead th {
  background:
    linear-gradient(180deg, rgba(124,58,237,.22) 0%, rgba(124,58,237,.16) 55%, rgba(76,29,149,.18) 100%);
  color: #c4b5fd;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(124,58,237,0.40),
    0 4px 10px -8px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .cev-table tbody td { color: #e2e8f0; border-bottom-color: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .cev-table tbody tr:hover td { background: rgba(124,58,237,.06); }
[data-bs-theme="dark"] .cev-doc-name { color: #ede9fe; }
[data-bs-theme="dark"] .cev-mono { color: #e2e8f0; }
[data-bs-theme="dark"] .cev-date { background: rgba(124,58,237,.16); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="expiring"] { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="pending"]  { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .cev-attach { background: rgba(124,58,237,.16); color: #c4b5fd; border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-chip-pill { background: rgba(124,58,237,.16); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-chip-pill-warm { background: rgba(217,119,6,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cev-footer { background: #1a1430; border-top-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-footer-meta { color: #cbd5e1; }
[data-bs-theme="dark"] .cev-btn-light { background: rgba(124,58,237,.12); color: #c4b5fd; border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-btn-light:hover { background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .cev-ship-fbtn { background: #211a3d; color: #94a3b8; border-color: rgba(124,58,237,.28); }
[data-bs-theme="dark"] .cev-ship-fbtn:hover { color: #c4b5fd; background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .cev-filter-verified { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .cev-filter-expiring { background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cev-filter-pending  { background: rgba(239,68,68,.18);  color: #fca5a5; border-color: rgba(239,68,68,.30); }

/* ─── RESPONSIVE ─── */
@media (max-width: 1440px) {
  .cev-card { width: min(1100px, 92vw); }
}
@media (max-width: 1280px) {
  .cev-card { width: 92vw; }
}
@media (max-width: 960px) {
  .cev-card { width: 96vw; }
  .cev-header { padding: 12px 14px; }
  .cev-header-title { font-size: 16px; }
  .cev-vault-icon { width: 38px; height: 38px; border-radius: 10px; }
  .cev-header-content { flex-direction: column; align-items: flex-start; gap: 10px; }
  .cev-header-right { width: 100%; justify-content: space-between; }
  .cev-kpi-strip { padding: 10px 14px; gap: 8px; }
  .cev-kpi-tile { flex: 0 0 190px; padding: 10px 12px; }
  .cev-kpi-value { font-size: 20px; }
  .cev-kpi-icon { width: 32px; height: 32px; font-size: 15px; }
  .cev-tabs { padding: 8px 14px 0; }
  .cev-body { padding: 14px 16px 18px; gap: 12px; }
  .cev-section { padding: 12px 14px; }
  .cev-section-count { font-size: 22px; }
  .cev-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .cev-footer-actions { display: flex; gap: 8px; }
  .cev-footer-actions .cev-btn { flex: 1; justify-content: center; }
  .cev-header-orb { display: none; }
  .cev-header-bg::after { display: none; }
}
@media (max-width: 640px) {
  .cev-card { width: 100vw; }
  .cev-kpi-tile { flex: 0 0 170px; }
  .cev-tab { padding: 8px 12px; font-size: 12px; }
  .cev-tab-count { font-size: 9.5px; padding: 1px 6px; }
}
`;
