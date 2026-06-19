import { useParams } from 'react-router-dom';

/* ─────────────────────────────────────────────────────────────────────────
 * Central CLM — single stub page reused by every clm.* leaf route until
 * each section gets its real implementation. Reads the slug off the URL
 * (`/clm/:slug`) so the title + breadcrumb can change without spinning
 * up 16 dedicated components.
 *
 * The label lookup mirrors the CLM_GROUPS structure in constants.ts;
 * keep them in sync when adding a new leaf.
 * ───────────────────────────────────────────────────────────────────────── */

const CLM_TITLES: Record<string, { title: string; group: string }> = {
  // Command Center
  analytics:               { title: 'CLM Analytics',                    group: 'CLM Command Center' },
  'diagnosis-resolution':  { title: 'Diagnosis & Resolution Center',     group: 'CLM Command Center' },
  'regulatory-defense':    { title: 'Regulatory Defense File',          group: 'CLM Command Center' },
  // Operations — With Shipment ID
  'buyer-profile':       { title: 'Customer Profile',        group: 'CLM Operations · With Shipment ID' },
  'supplier-profile':    { title: 'Supplier Profile',        group: 'CLM Operations · With Shipment ID' },
  // Operations — Without Shipment ID
  'case-to-case':        { title: 'Case to Case Contracts',  group: 'CLM Operations · Without Shipment ID' },
  'agreements-sent':     { title: 'Agreements We Sent',      group: 'CLM Operations · Without Shipment ID' },
  'agreements-to-approve': { title: 'Agreements To Approve', group: 'CLM Operations · Without Shipment ID' },
  // Compliance & Regulatory
  segment:               { title: 'Segment',                 group: 'Compliance & Regulatory' },
  authority:             { title: 'Authority',               group: 'Compliance & Regulatory' },
  'quality-docs':        { title: 'Quality & Compliance Docs', group: 'Compliance & Regulatory' },
  kyc:                   { title: 'KYC',                     group: 'Compliance & Regulatory' },
  'due-diligence':       { title: 'Due Diligence (DD)',      group: 'Compliance & Regulatory' },
  'trade-licenses':      { title: 'Trade Licenses',          group: 'Compliance & Regulatory' },
  // Contract & Document Masters
  'document-panel':      { title: 'Document Control Panel',  group: 'Contract & Document Masters' },
  'trade-documents':     { title: 'Trade Documents',         group: 'Contract & Document Masters' },
  agreements:            { title: 'Agreements',              group: 'Contract & Document Masters' },
  'terms-conditions':    { title: 'Terms & Conditions',      group: 'Contract & Document Masters' },
  'clause-library':      { title: 'Clause Library',          group: 'Contract & Document Masters' },
};

export default function ClmStubPage() {
  const { slug = '' } = useParams<{ slug?: string }>();
  const meta = CLM_TITLES[slug] ?? { title: 'Central CLM', group: 'Contract Lifecycle Management' };

  return (
    <div className="p-6">
      <style>{CSS}</style>
      <div className="clm-stub-card">
        <div className="clm-stub-head">
          <div className="clm-stub-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div>
            <div className="clm-stub-crumb">{meta.group}</div>
            <div className="clm-stub-title">{meta.title}</div>
          </div>
        </div>
        <div className="clm-stub-body">
          <div className="clm-stub-pill">
            <span className="clm-stub-pill-dot" />
            Coming soon
          </div>
          <p>
            <strong>{meta.title}</strong> is part of the Central CLM module.
            The page is reserved for the upcoming contract-lifecycle build —
            until then this surface stays as a placeholder so the navigation
            and permission tree can ship independently.
          </p>
          <ul>
            <li>Permission gating is live: branch admins can grant <code>{`clm.${slug.replace(/-/g, '_')}`}</code> in the Permissions panel.</li>
            <li>Module is registered in the backend (<code>modules.slug = clm.{slug.replace(/-/g, '_')}</code>) so cascades downstream.</li>
            <li>Final UI ships in the CLM v1 release.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.clm-stub-card {
  max-width: 760px; margin: 24px auto;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  box-shadow: 0 4px 18px rgba(15,23,42,.06);
  overflow: hidden;
}
.clm-stub-head {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 22px; color: #fff;
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
}
.clm-stub-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.clm-stub-crumb { font-size: 11px; opacity: .85; letter-spacing: .02em; }
.clm-stub-title { font-size: 17px; font-weight: 700; line-height: 1.2; margin-top: 2px; }
.clm-stub-body { padding: 22px; color: #334155; font-size: 13px; line-height: 1.6; }
.clm-stub-body p { margin: 12px 0; }
.clm-stub-body ul { margin: 8px 0 0; padding-left: 20px; }
.clm-stub-body li { margin-bottom: 4px; }
.clm-stub-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; padding: 1px 6px; border-radius: 4px;
  background: #f5f3ff; color: #6d28d9;
}
.clm-stub-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 14px; border-radius: 999px;
  background: #ede9fe; color: #5b21b6;
  font-size: 11.5px; font-weight: 700;
  border: 1px solid #ddd6fe;
}
.clm-stub-pill-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,.20);
}

[data-bs-theme="dark"] .clm-stub-card { background: #14102a; border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .clm-stub-body { color: #cbd5e1; }
[data-bs-theme="dark"] .clm-stub-body code { background: rgba(124,58,237,.22); color: #d8b4fe; }
[data-bs-theme="dark"] .clm-stub-pill { background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.30); color: #d8b4fe; }
`;
