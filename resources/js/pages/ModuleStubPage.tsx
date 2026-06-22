import { useLocation } from 'react-router-dom';

/* ─────────────────────────────────────────────────────────────────────────
 * ModuleStubPage — shared placeholder for the new top-level header modules
 * that are registered in the permission tree + navigation but whose real
 * pages haven't been built yet (Credentials Vault, Project Navigator,
 * GTS / E-Docs, Inventory Management System).
 *
 * It reads the first URL segment to pick the right title + permission slug
 * so all four routes can share one component, exactly like ClmStubPage does
 * for the CLM leaves. As each real page ships, point its <Route> at the new
 * component and drop the entry here.
 * ───────────────────────────────────────────────────────────────────────── */

// Keyed by the full URL path (segments joined by '/') so nested placeholders
// like the P2P leaves resolve to their own title, while the original top-level
// modules still match on their single segment. `slug` is the permission slug
// shown in the badge (defaults to the first path segment when omitted).
const STUB_META: Record<string, { title: string; group: string; blurb: string; slug?: string }> = {
  'credentials-vault': {
    title: 'Credentials Vault',
    group: 'Security & Access',
    blurb: 'Central store for tenant credentials, secrets and access keys.',
  },
  'project-navigator': {
    title: 'Project Navigator',
    group: 'Operations',
    blurb: 'Cross-module project workspace to track deals, shipments and tasks end to end.',
  },
  'gts': {
    title: 'GTS (E-Docs)',
    group: 'Global Trade Services',
    blurb: 'Electronic trade-document hub for shipping bills, e-BRC and regulatory filings.',
  },
  'inventory': {
    title: 'Inventory Management System',
    group: 'Warehouse & Stock',
    blurb: 'Stock, warehouse, racks and movement tracking across branches.',
  },
  // Procure to Pay (P2P) leaves that don't have a real page yet.
  'p2p/analytics': {
    title: 'P2P Analytics', group: 'Procure to Pay (P2P)', slug: 'p2p.analytics',
    blurb: 'Procurement KPIs & insights — spend, cycle time and vendor performance at a glance.',
  },
  'p2p/diagnosis': {
    title: 'P2P Diagnosis & Resolution Summary', group: 'Procure to Pay (P2P)', slug: 'p2p.diagnosis',
    blurb: 'Identify and resolve procurement issues across the purchase-to-pay cycle.',
  },
  'p2p/bulk-sourcing': {
    title: 'Bulk Sourcing Management', group: 'Procure to Pay (P2P)', slug: 'p2p.bulk_sourcing',
    blurb: 'Raise and track bulk sourcing requests across products and suppliers.',
  },
  'p2p/case-to-case': {
    title: 'Case to Case Procurement Management', group: 'Procure to Pay (P2P)', slug: 'p2p.case_to_case',
    blurb: 'Manage request-based, one-off procurement sourcing.',
  },
  'p2p/purchase-order': {
    title: 'Purchase Order (PO)', group: 'Procure to Pay (P2P)', slug: 'p2p.po',
    blurb: 'Create & track purchase orders from approval to fulfilment.',
  },
  'p2p/supplier-purchase-invoice': {
    title: 'Supplier Purchase Invoice (SPI)', group: 'Procure to Pay (P2P)', slug: 'p2p.spi',
    blurb: 'Process supplier invoices, taxes and three-way matching.',
  },
};

export default function ModuleStubPage() {
  const { pathname } = useLocation();
  const segs = pathname.split('/').filter(Boolean);
  const meta = STUB_META[segs.join('/')] ?? STUB_META[segs[0] ?? ''] ?? {
    title: 'Module',
    group: 'Cross Border Command',
    blurb: 'This module is reserved for an upcoming build.',
  };
  const slug = meta.slug ?? segs[0] ?? '';

  return (
    // Fill the viewport height so the page background is uniform — otherwise a
    // short card leaves an empty band below it that reads as a stray dark "row".
    <div className="p-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
      <style>{CSS}</style>
      <div className="mstub-card">
        <div className="mstub-head">
          <div className="mstub-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <div>
            <div className="mstub-crumb">{meta.group}</div>
            <div className="mstub-title">{meta.title}</div>
          </div>
        </div>
        <div className="mstub-body">
          <div className="mstub-pill">
            <span className="mstub-pill-dot" />
            Coming soon
          </div>
          <p>{meta.blurb}</p>
          <ul>
            <li>Permission gating is live: admins can grant <code>{slug}</code> in the Permissions panel.</li>
            <li>Module is registered in the backend (<code>modules.slug = {slug}</code>) so grants cascade downstream.</li>
            <li>The full UI ships in a later release; this placeholder keeps navigation and permissions shippable now.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.mstub-card {
  max-width: 760px; margin: 24px auto;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  box-shadow: 0 4px 18px rgba(15,23,42,.06);
  overflow: hidden;
}
.mstub-head {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 22px; color: #fff;
  background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
}
.mstub-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.mstub-crumb { font-size: 11px; opacity: .85; letter-spacing: .02em; }
.mstub-title { font-size: 17px; font-weight: 700; line-height: 1.2; margin-top: 2px; }
.mstub-body { padding: 22px; color: #334155; font-size: 13px; line-height: 1.6; }
.mstub-body p { margin: 12px 0; }
.mstub-body ul { margin: 8px 0 0; padding-left: 20px; }
.mstub-body li { margin-bottom: 4px; }
.mstub-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; padding: 1px 6px; border-radius: 4px;
  background: #f5f3ff; color: #6d28d9;
}
.mstub-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 14px; border-radius: 999px;
  background: #ede9fe; color: #5b21b6;
  font-size: 11.5px; font-weight: 700;
  border: 1px solid #ddd6fe;
}
.mstub-pill-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.20);
}

[data-bs-theme="dark"] .mstub-card { background: #14102a; border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .mstub-body { color: #cbd5e1; }
[data-bs-theme="dark"] .mstub-body code { background: rgba(124,58,237,.22); color: #d8b4fe; }
[data-bs-theme="dark"] .mstub-pill { background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.30); color: #d8b4fe; }
`;
