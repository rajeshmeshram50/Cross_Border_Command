// Evidence Vault tab — Employee Documents (uploaded KYC/education/etc.) and
// Organizational Documents (signed agreements/policies), with a sub-tab switch.
// Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { Card, Col, Row } from 'reactstrap';
import { Shimmer, ShimmerTableRows } from '../../../components/ui/Shimmer';
import { resolveFileUrl } from '../../../utils/resolveFileUrl';
import { useEmployeeProfile } from '../EmployeeProfileContext';

const VAULT_STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Verified':      { bg: 'rgba(16,185,129,0.16)',  fg: '#10b981', dot: '#10b981' },
  'Uploaded':      { bg: 'rgba(59,130,246,0.16)',  fg: '#3b82f6', dot: '#3b82f6' },
  'Pending':       { bg: 'rgba(245,158,11,0.18)',  fg: '#d97706', dot: '#f59e0b' },
  'Signed':        { bg: 'rgba(124,92,252,0.18)',  fg: '#8b5cf6', dot: '#7c5cfc' },
  'Sent':          { bg: 'rgba(59,130,246,0.16)',  fg: '#3b82f6', dot: '#3b82f6' },
  'Not Generated': { bg: 'rgba(100,116,139,0.16)', fg: '#64748b', dot: '#94a3b8' },
};

export default function VaultTab() {
  const {
    employee, employeeId, vaultTab, setVaultTab,
    signedDocs, uploadedDocs, signedLoading, uploadedLoading, vaultCounts,
    prettyDocKey, formatBytes, setSignedPreview, downloadSignedPdf, downloadingDocId,
    employeeDocCount, organizationalDocCount,
  } = useEmployeeProfile();

  return (
        // Fill the profile content pane's full height so the active document
        // card stretches to the bottom instead of leaving a large empty area.
        <div className="vt-tab-fill d-flex flex-column" style={{ minHeight: '100%' }}>
          {/* Hero strip — "Evidence Vault — {Name} Document Repository" + KPIs */}
          <Card className="mb-3 border-0 vt-hero-card">
            <div className="vt-hero-strip">
              <div className="ep-hero-blob" />
              <Row className="align-items-center g-2 vt-relative">
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3 vt-hero-icon">
                    <i className="ri-lock-2-line vt-hero-icon-glyph" />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold vt-hero-eyebrow">Evidence Vault</p>
                  <div className="text-white vt-hero-title">
                    {employee?.name || employeeId} <span className="vt-hero-dash">—</span> Document Repository
                  </div>
                  <small className="vt-hero-sub">All documents are securely stored and version-controlled</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total Docs', value: vaultCounts.total,    color: '#fff' },
                      { label: 'Uploaded',   value: vaultCounts.pending,  color: '#fcd34d' },
                      { label: 'Signed',     value: vaultCounts.signed,   color: '#c4b5fd' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center vt-kpi-tile"
                      >
                        <p className="mb-0 text-uppercase fw-semibold vt-kpi-label">{c.label}</p>
                        {(uploadedLoading || signedLoading) ? (
                          // Translucent-white shimmer bar so the KPI tile
                          // doesn't flash 0 before the counts resolve.
                          <div className="d-flex justify-content-center vt-kpi-shim-wrap">
                            <Shimmer height={13} width={28} className="vt-kpi-shim" />
                          </div>
                        ) : (
                          <div className="fw-bold lh-1 vt-kpi-value" style={{ ['--vt-kpi-color' as any]: c.color }}>{c.value}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Sub-tab pill — Employee Documents | Organizational Documents */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex vt-subtab-bar"
              >
                {[
                  { key: 'employee'       as const, label: 'Employee Documents',      count: employeeDocCount,      icon: 'ri-user-line',     activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'organizational' as const, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line', activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                ].map(t => {
                  const on = vaultTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setVaultTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold vt-subtab-btn"
                      style={{
                        ['--vt-subtab-bg' as any]: on ? t.activeBg : 'transparent',
                        ['--vt-subtab-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        ['--vt-subtab-shadow' as any]: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={`${t.icon} vt-subtab-icon`} />
                      {t.label}
                      <span
                        className="badge rounded-pill d-inline-flex align-items-center justify-content-center vt-subtab-badge"
                        style={{
                          ['--vt-subtab-badge-bg' as any]: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                          ['--vt-subtab-badge-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        }}
                      >
                        {(t.key === 'employee' ? uploadedLoading : signedLoading)
                          ? <Shimmer height={9} width={14} className="vt-subtab-badge-shim" style={{ ['--vt-subtab-badge-shim-bg' as any]: on ? 'rgba(255,255,255,0.35)' : 'var(--vz-secondary-color)' }} />
                          : t.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {/* Employee Documents sub-tab — live list of files the employee
              has actually uploaded (Aadhaar / PAN / photo / etc.). Drops
              the static placeholder catalogue; rows come straight from
              /api/employees/{id}/documents. */}
          {vaultTab === 'employee' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3 ep-ct-violet flex-grow-1 d-flex flex-column"
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-violet"
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon ep-icon-violet">
                    <i className="ri-upload-cloud-2-line" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold vt-head-title">Uploaded Documents</h6>
                    <small className="text-muted vt-head-sub">
                      Files attached by the employee or HR — view, download, and verification status.
                    </small>
                  </div>
                </div>
                <div className="text-end">
                  {uploadedLoading
                    ? <Shimmer height={20} width={28} className="vt-count-shim" />
                    : <h4 className="mb-0 fw-bold vt-count-violet">{uploadedDocs.length}</h4>}
                  <small className="text-muted text-uppercase vt-count-label">Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                <div className="table-responsive border rounded ep-att-scroll-wrap flex-grow-1">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead>
                      <tr>
                        {['SR', 'Document', 'File Name', 'Size', 'Uploaded', 'Attachment', 'Status'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadedLoading ? (
                        <ShimmerTableRows rows={4} cols={7} keyPrefix="uploaded-shim" />
                      ) : uploadedDocs.length === 0 ? (
                        <tr><td colSpan={7} className="vt-empty-cell">
                          <i className="ri-inbox-line vt-empty-icon" />
                          No uploaded documents yet. Files attached during onboarding will land here.
                        </td></tr>
                      ) : (
                        uploadedDocs.map((d, idx) => {
                          const statusKey = d.status === 'verified' ? 'Verified'
                                          : d.status === 'rejected' ? 'Pending'   // surface rejected in amber
                                          : 'Uploaded';
                          const st = VAULT_STATUS_TONE[statusKey as keyof typeof VAULT_STATUS_TONE]
                                  || { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' };
                          return (
                            <tr key={d.id}>
                              <td className="text-muted">{idx + 1}</td>
                              <td className="fw-semibold">{prettyDocKey(d.document_key)}</td>
                              <td className="text-muted vt-fname-cell" title={d.original_name || ''}>
                                {d.original_name || '—'}
                              </td>
                              <td className="font-monospace vt-mono-sm">{formatBytes(d.size_bytes)}</td>
                              <td className="font-monospace vt-mono-sm">
                                {d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : '—'}
                              </td>
                              <td>
                                {d.url
                                  ? <a href={resolveFileUrl(d.url) || d.url} target="_blank" rel="noopener noreferrer" className="d-inline-flex align-items-center gap-1 text-decoration-none vt-open-link">
                                      <i className="ri-file-text-line" /> Open
                                    </a>
                                  : <span className="text-muted">—</span>}
                              </td>
                              <td>
                                <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase vt-status-badge"
                                  title={d.status === 'rejected' ? (d.rejection_reason || 'Rejected') : undefined}
                                  style={{
                                    ['--vt-status-bg' as any]: d.status === 'rejected' ? '#fee2e2' : st.bg,
                                    ['--vt-status-fg' as any]: d.status === 'rejected' ? '#b91c1c' : st.fg }}>
                                  <span className="vt-status-dot" style={{ ['--vt-status-dot' as any]: d.status === 'rejected' ? '#ef4444' : st.dot }} /> {d.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* My Signed Documents — live list of completed signature
              workflows targeting this employee. Sits above the static
              Org Docs catalogue so the most recent signed copies are
              top of the page. */}
          {vaultTab === 'organizational' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3 ep-ct-violet flex-grow-1 d-flex flex-column"
            >
              {/* Dark-theme-aware styling for the org-doc Code badge, Signer
                  tags and View button (were hardcoded light → BUG-131/132/133). */}
              <style>{`
                .epv-code-badge { font-size: 10.5px; background: #fef3c7; color: #a16207; padding: 2px 6px; border-radius: 4px; }
                .epv-signer-tag { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; font-weight: 700; display: inline-block; }
                .epv-signer-tag.is-done { background: #e0e7ff; color: #4338ca; }
                .epv-signer-tag.is-pending { background: #f3f4f6; color: #6b7280; }
                .epv-view-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: background .15s ease; }
                .epv-view-btn:hover { background: #e0e7ff; }
                [data-bs-theme="dark"] .epv-code-badge, [data-layout-mode="dark"] .epv-code-badge { background: rgba(251,191,36,.16); color: #fcd34d; }
                [data-bs-theme="dark"] .epv-signer-tag.is-done, [data-layout-mode="dark"] .epv-signer-tag.is-done { background: rgba(99,102,241,.20); color: #c7d2fe; }
                [data-bs-theme="dark"] .epv-signer-tag.is-pending, [data-layout-mode="dark"] .epv-signer-tag.is-pending { background: rgba(148,163,184,.16); color: #cbd5e1; }
                [data-bs-theme="dark"] .epv-view-btn, [data-layout-mode="dark"] .epv-view-btn { background: rgba(99,102,241,.16); border-color: rgba(129,140,248,.40); color: #c7d2fe; }
                [data-bs-theme="dark"] .epv-view-btn:hover, [data-layout-mode="dark"] .epv-view-btn:hover { background: rgba(99,102,241,.26); }
              `}</style>
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-violet"
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon ep-icon-violet">
                    <i className="ri-quill-pen-line" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold vt-head-title">My Signed Documents</h6>
                    <small className="text-muted vt-head-sub">
                      Final, fully-signed copies — view in the browser or download as PDF.
                    </small>
                  </div>
                </div>
                <div className="text-end">
                  {signedLoading
                    ? <Shimmer height={20} width={28} className="vt-count-shim" />
                    : <h4 className="mb-0 fw-bold vt-count-violet">{signedDocs.length}</h4>}
                  <small className="text-muted text-uppercase vt-count-label">Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                <div className="table-responsive border rounded ep-att-scroll-wrap flex-grow-1">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead>
                      <tr>
                        {['SR', 'Document', 'Code', 'Signers', 'Completed', 'Actions'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {signedLoading ? (
                        <ShimmerTableRows rows={3} cols={6} keyPrefix="signed-shim" />
                      ) : signedDocs.length === 0 ? (
                        <tr><td colSpan={6} className="vt-empty-cell">
                          <i className="ri-inbox-line vt-empty-icon" />
                          No signed documents yet. Completed workflows will land here automatically.
                        </td></tr>
                      ) : (
                        signedDocs.map((doc, i) => (
                          <tr key={doc.id}>
                            <td className="text-muted">{i + 1}</td>
                            <td className="fw-semibold">{doc.template?.name || '(template removed)'}</td>
                            <td>
                              <code className="epv-code-badge">{doc.code || '—'}</code>
                            </td>
                            <td>
                              <div className="d-flex flex-wrap gap-1">
                                {(doc.signers || []).slice(0, 3).map((s: any, j: number) => (
                                  <span key={j} className={`epv-signer-tag ${s.status === 'Done' ? 'is-done' : 'is-pending'}`}>
                                    {s.name}
                                  </span>
                                ))}
                                {doc.signers && doc.signers.length > 3 && (
                                  <span className="vt-signers-more">+{doc.signers.length - 3} more</span>
                                )}
                              </div>
                            </td>
                            <td className="font-monospace vt-mono-sm">
                              {new Date(doc.updated_at).toLocaleDateString()}
                            </td>
                            <td>
                              <div className="d-flex gap-1">
                                <button type="button" className="epv-view-btn" onClick={() => setSignedPreview(doc)}>
                                  <i className="ri-eye-line me-1" />View
                                </button>
                                <button type="button" onClick={() => downloadSignedPdf(doc.id, doc.code)}
                                  className="vt-download-btn" disabled={downloadingDocId === doc.id}>
                                  {downloadingDocId === doc.id
                                    ? (<><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>)
                                    : (<><i className="ri-file-pdf-2-line me-1" />Download PDF</>)}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
  );
}
