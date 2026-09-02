// Evidence Vault tab — Employee Documents (uploaded KYC/education/etc.) and
// Organizational Documents (signed agreements/policies), with a sub-tab switch.
// Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row } from 'reactstrap';
import { Shimmer } from '../../../components/ui/Shimmer';
import DataTable, { type DataTableColumn } from '../../../components/ui/DataTable';
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
    signedDocs, uploadedDocs, organizationalDocs, exitDocs, signedLoading, uploadedLoading, vaultCounts,
    applicableDocs, canSendDocuments, sendApplicableDoc, sendingTemplateId,
    prettyDocKey, formatBytes, setSignedPreview, downloadSignedPdf, downloadingDocId,
    employeeDocCount, organizationalDocCount, exitDocCount,
  } = useEmployeeProfile();

  /* Host element for the Uploaded Documents search box — held in state rather
     than a ref so the portal re-renders once the node actually exists (a ref
     alone is still null on the first pass and the box would never mount). */
  const [uploadedSearchHost, setUploadedSearchHost] = useState<HTMLDivElement | null>(null);
  const [signedSearchHost, setSignedSearchHost]     = useState<HTMLDivElement | null>(null);

  /* In-app preview for an uploaded file (#212).
   *
   * The Attachment cell only offered "Open", an <a target="_blank"> that hands
   * the file to the browser and takes the user out of the profile — to check
   * one document they lost their place in the vault and came back through a
   * new tab. "View" renders it in a lightbox over the tab instead: images
   * inline, PDFs in a frame. "Open" is kept alongside it, since a new tab is
   * still the better answer for printing or for a type we cannot render. */
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);

  const previewUrl  = previewDoc ? (resolveFileUrl(previewDoc.url) || previewDoc.url) : '';
  /* Trust mime_type, which the API returns for every row, and fall back to the
     extension only when it is missing (older rows predate the column). */
  const previewKind = (() => {
    if (!previewDoc) return 'other';
    const mime = String(previewDoc.mime_type || '').toLowerCase();
    const name = String(previewDoc.original_name || previewDoc.url || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
    if (mime === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
    return 'other';
  })();

  /* Esc closes, and the page behind must not scroll while the overlay is up —
     otherwise the wheel scrolls the vault table under the preview. */
  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewDoc(null); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [previewDoc]);

  /* Both vault tables are the shared DataTable now, so they carry the same
     header band, sortable columns and "Showing X–Y of Z / Rows per page"
     footer as Attendance, Leave, Holidays and Hiring Requests. The hand-rolled
     tables they replace had no footer at all — the list just stopped after the
     last row, with no count and no way to page (#45). */
  const uploadedColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'document',
      header: 'Document',
      accessorFn: (d: any) => prettyDocKey(d.document_key),
      meta: { width: 180 },
      cell: info => <span className="fw-semibold">{String(info.getValue() ?? '')}</span>,
    },
    {
      id: 'file_name',
      header: 'File Name',
      accessorFn: (d: any) => d.original_name || '',
      meta: { width: 260 },
      cell: info => {
        const v = String(info.getValue() ?? '');
        return <span className="text-muted vt-fname-cell" title={v}>{v || '—'}</span>;
      },
    },
    {
      id: 'size',
      header: 'Size',
      // Sort on the raw byte count, not the formatted "1.6 MB" string —
      // otherwise 900 KB sorts above 1.6 MB.
      accessorFn: (d: any) => Number(d.size_bytes) || 0,
      meta: { width: 110 },
      cell: info => <span className="font-monospace vt-mono-sm">{formatBytes(info.row.original.size_bytes)}</span>,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      // Same reason: sort on the timestamp, display the local date.
      accessorFn: (d: any) => (d.uploaded_at ? new Date(d.uploaded_at).getTime() : 0),
      meta: { width: 130 },
      cell: info => {
        const at = info.row.original.uploaded_at;
        return <span className="font-monospace vt-mono-sm">{at ? new Date(at).toLocaleDateString() : '—'}</span>;
      },
    },
    {
      id: 'attachment',
      header: 'Attachment',
      enableSorting: false,
      meta: { width: 150, wrap: true },
      cell: info => {
        const d = info.row.original;
        if (!d.url) return <span className="text-muted">—</span>;
        return (
          <span className="d-inline-flex align-items-center gap-2">
            {/* View = preview in place; Open = hand off to the browser. Both are
                offered because they answer different needs (#212). */}
            <button
              type="button"
              onClick={() => setPreviewDoc(d)}
              className="d-inline-flex align-items-center gap-1 vt-view-btn"
              title={`Preview ${d.original_name || 'document'}`}
            >
              <i className="ri-eye-line" /> View
            </button>
            <a href={resolveFileUrl(d.url) || d.url} target="_blank" rel="noopener noreferrer" className="d-inline-flex align-items-center gap-1 text-decoration-none vt-open-link">
              <i className="ri-external-link-line" /> Open
            </a>
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (d: any) => d.status || '',
      // wrap: the cell is a pill, which is wider than its text — without this
      // the table's default ellipsis paints a stray "…" past the pill's edge.
      meta: { width: 130, wrap: true },
      cell: info => {
        const d = info.row.original;
        const statusKey = d.status === 'verified' ? 'Verified'
                        : d.status === 'rejected' ? 'Pending'   // surface rejected in amber
                        : 'Uploaded';
        const st = VAULT_STATUS_TONE[statusKey as keyof typeof VAULT_STATUS_TONE]
                || { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' };
        return (
          <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase vt-status-badge"
            title={d.status === 'rejected' ? (d.rejection_reason || 'Rejected') : undefined}
            style={{
              ['--vt-status-bg' as any]: d.status === 'rejected' ? '#fee2e2' : st.bg,
              ['--vt-status-fg' as any]: d.status === 'rejected' ? '#b91c1c' : st.fg }}>
            <span className="vt-status-dot" style={{ ['--vt-status-dot' as any]: d.status === 'rejected' ? '#ef4444' : st.dot }} /> {d.status}
          </span>
        );
      },
    },
  ], [prettyDocKey, formatBytes]);

  /** Latest `acted_at` across a run's signers — i.e. when the last one signed. */
  const completedAt = (d: any): Date | null => {
    const times = (Array.isArray(d?.signers) ? d.signers : [])
      .map((s: any) => (s?.acted_at ? new Date(s.acted_at).getTime() : NaN))
      .filter((t: number) => Number.isFinite(t));
    return times.length ? new Date(Math.max(...times)) : null;
  };

  const signedColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'document',
      header: 'Document',
      accessorFn: (d: any) => d.template?.name || '',
      meta: { width: 220 },
      cell: info => <span className="fw-semibold">{info.row.original.template?.name || '(template removed)'}</span>,
    },
    {
      id: 'code',
      header: 'Code',
      accessorFn: (d: any) => d.code || '',
      meta: { width: 130, wrap: true },
      cell: info => <code className="epv-code-badge">{info.row.original.code || '—'}</code>,
    },
    {
      id: 'signers',
      header: 'Signers',
      enableSorting: false,
      meta: { width: 260, wrap: true },
      cell: info => {
        const doc = info.row.original;
        return (
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
        );
      },
    },
    {
      id: 'completed',
      header: 'Completed',
      // When the LAST signer acted — not `updated_at`, which any later edit
      // bumps, so a run nobody had finished still showed a confident date.
      // There is no completed_at column; the signer log is the only record of
      // when the run actually closed.
      accessorFn: (d: any) => completedAt(d)?.getTime() ?? 0,
      meta: { width: 130 },
      cell: info => {
        const at = completedAt(info.row.original);
        return <span className="font-monospace vt-mono-sm">{at ? at.toLocaleDateString() : '—'}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      meta: { width: 230, wrap: true },
      cell: info => {
        const doc = info.row.original;
        return (
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
        );
      },
    },
  ], [setSignedPreview, downloadSignedPdf, downloadingDocId]);

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
                  { key: 'employee'       as const, label: 'Employee Documents',      count: employeeDocCount,      icon: 'ri-user-line',       activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'organizational' as const, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line',   activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'exit'           as const, label: 'Exit Documents',           count: exitDocCount,          icon: 'ri-door-open-line',   activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
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
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-violet vt-uploaded-head"
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
                <div className="d-flex align-items-center gap-3">
                  {/* DataTable portals its own search box in here, so the
                      toolbar strip above the table collapses away and the
                      search sits on the card's header row instead. */}
                  <div className="vt-head-search" ref={setUploadedSearchHost} />
                  <div className="text-end">
                    {uploadedLoading
                      ? <Shimmer height={20} width={28} className="vt-count-shim" />
                      : <h4 className="mb-0 fw-bold vt-count-violet">{uploadedDocs.length}</h4>}
                    <small className="text-muted text-uppercase vt-count-label">Documents</small>
                  </div>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                {/* fitToViewport + autoFitRows: the same fill behaviour as the
                    other list screens — the card stretches to the bottom of the
                    viewport with the pager pinned to its lower edge, and the
                    page size becomes however many rows that height holds.
                    Without it a short (or empty) result left the pager floating
                    mid-card above a band of dead white space. */}
                <DataTable
                  data={uploadedDocs}
                  columns={uploadedColumns}
                  serial={{ header: 'SR' }}
                  accent="violet"
                  pageSize={10}
                  fitToViewport
                  autoFitRows
                  minWidth={1130}
                  loading={uploadedLoading}
                  searchHost={uploadedSearchHost}
                  searchPlaceholder="Search document, file name…"
                  emptyMessage={
                    <>
                      <i className="ri-inbox-line vt-empty-icon" />
                      No uploaded documents yet. Files attached during onboarding will land here.
                    </>
                  }
                />
              </div>
            </div>
          )}

          {/* Required by role — what this employee's CURRENT department and
              designation call for, and whether each has actually been sent.
              Above the signed table because it is the open question: the table
              below is a record, this is a to-do.

              Only rendered for an HR-side viewer with something outstanding —
              an empty card here would read as a broken feature rather than as
              "nothing to do", and the employee themselves can act on none of
              it. Sending is one row at a time and always deliberate; changing
              a designation never sends anything by itself. */}
          {vaultTab === 'organizational' && canSendDocuments && applicableDocs.some((d: any) => !d.is_sent) && (
            <div className="ep-section-card-flat ep-section-card mb-3 ep-ct-amber">
              <div className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-amber">
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon ep-icon-amber"><i className="ri-user-star-line" /></span>
                  <div>
                    <h6 className="mb-0 fw-bold vt-head-title">Promotion documents — not yet sent</h6>
                    <small className="text-muted vt-head-sub">
                      Promotion-triggered templates matching this employee&rsquo;s current department and designation. Updates when the designation changes.
                    </small>
                  </div>
                </div>
                <div className="text-end">
                  <h4 className="mb-0 fw-bold vt-count-amber">{applicableDocs.filter((d: any) => !d.is_sent).length}</h4>
                  <small className="text-muted text-uppercase vt-count-label">Outstanding</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 d-flex flex-column gap-2">
                {applicableDocs.filter((d: any) => !d.is_sent).map((d: any) => (
                  <div key={d.id} className="vt-applicable-row d-flex align-items-center justify-content-between gap-3">
                    <div className="d-flex align-items-center gap-2 min-w-0">
                      <code className="epv-code-badge">{d.code}</code>
                      <span className="fw-semibold text-truncate">{d.name}</span>
                    </div>
                    <button
                      type="button"
                      className="ev-doc-btn"
                      disabled={sendingTemplateId != null}
                      onClick={() => sendApplicableDoc(d.id, d.name)}
                    >
                      <i className={`${sendingTemplateId === d.id ? 'ri-loader-4-line dgm-spin' : 'ri-quill-pen-line'} me-1`} />
                      {sendingTemplateId === d.id ? 'Sending…' : 'Send for Signature'}
                    </button>
                  </div>
                ))}
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
              {/* The .epv-* rules (Code badge, signer tags, View button) used to
                  be an inline <style> here — see EmployeeProfile.css, where they
                  now live so the Exit Documents tab gets them too. */}
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-violet vt-uploaded-head"
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
                <div className="d-flex align-items-center gap-3">
                  {/* Search lifted onto the header row, same as the Uploaded
                      Documents card — see the note on that one. */}
                  <div className="vt-head-search" ref={setSignedSearchHost} />
                  {/* This card only renders under `vaultTab === 'organizational'`,
                      so the count is organizationalDocs — the old
                      `vaultTab === 'exit' ? exitDocs.length : …` ternary could
                      never take its first branch (TS flagged the comparison as
                      having no overlap). The Exit card below counts its own. */}
                  <div className="text-end">
                    {signedLoading
                      ? <Shimmer height={20} width={28} className="vt-count-shim" />
                      : <h4 className="mb-0 fw-bold vt-count-violet">{organizationalDocs.length}</h4>}
                    <small className="text-muted text-uppercase vt-count-label">Documents</small>
                  </div>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                <DataTable
                  data={organizationalDocs}
                  columns={signedColumns}
                  serial={{ header: 'SR' }}
                  accent="violet"
                  pageSize={10}
                  fitToViewport
                  autoFitRows
                  minWidth={1030}
                  loading={signedLoading}
                  searchHost={signedSearchHost}
                  searchPlaceholder="Search document, code, signer…"
                  emptyMessage={
                    <>
                      <i className="ri-inbox-line vt-empty-icon" />
                      No signed documents yet. Completed workflows will land here automatically.
                    </>
                  }
                />
              </div>
            </div>
          )}

          {vaultTab === 'exit' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3 ep-ct-violet flex-grow-1 d-flex flex-column"
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-violet vt-uploaded-head"
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon ep-icon-violet">
                    <i className="ri-door-open-line" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold vt-head-title">Exit Documents</h6>
                    <small className="text-muted vt-head-sub">
                      Documents signed as part of exit workflows — final clearances and separation agreements.
                    </small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-3">
                  <div className="vt-head-search" ref={setSignedSearchHost} />
                  <div className="text-end">
                    {signedLoading
                      ? <Shimmer height={20} width={28} className="vt-count-shim" />
                      : <h4 className="mb-0 fw-bold vt-count-violet">{exitDocs.length}</h4>}
                    <small className="text-muted text-uppercase vt-count-label">Documents</small>
                  </div>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                <DataTable
                  data={exitDocs}
                  columns={signedColumns}
                  serial={{ header: 'SR' }}
                  accent="violet"
                  pageSize={10}
                  fitToViewport
                  autoFitRows
                  minWidth={1030}
                  loading={signedLoading}
                  searchHost={signedSearchHost}
                  searchPlaceholder="Search document, code, signer…"
                  emptyMessage={
                    <>
                      <i className="ri-inbox-line vt-empty-icon" />
                      No exit documents yet. Completed workflows with 'exit' trigger will appear here.
                    </>
                  }
                />
              </div>
            </div>
          )}

          {/* ── Document preview lightbox (#212) ──
              Click-outside and Esc both close; the bar keeps Open/Download so
              the preview is not a dead end for a file the browser cannot
              render inline. */}
          {previewDoc && (
            <div className="vt-preview-backdrop" onClick={() => setPreviewDoc(null)}>
              <div className="vt-preview-bar" onClick={e => e.stopPropagation()}>
                <span className="vt-preview-name" title={previewDoc.original_name || ''}>
                  <i className="ri-file-text-line" /> {previewDoc.original_name || prettyDocKey(previewDoc.document_key)}
                </span>
                <span className="d-inline-flex align-items-center gap-1">
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="vt-preview-btn" title="Open in new tab">
                    <i className="ri-external-link-line" />
                  </a>
                  <a href={previewUrl} download={previewDoc.original_name || undefined} className="vt-preview-btn" title="Download">
                    <i className="ri-download-2-line" />
                  </a>
                  <button type="button" className="vt-preview-btn" title="Close" onClick={() => setPreviewDoc(null)}>
                    <i className="ri-close-line" />
                  </button>
                </span>
              </div>
              <div className="vt-preview-stage" onClick={e => e.stopPropagation()}>
                {previewKind === 'image' ? (
                  <img src={previewUrl} alt={previewDoc.original_name || 'Document'} className="vt-preview-img" />
                ) : previewKind === 'pdf' ? (
                  <iframe title={previewDoc.original_name || 'Document'} src={previewUrl} className="vt-preview-frame" />
                ) : (
                  <div className="vt-preview-fallback">
                    <i className="ri-file-unknow-line" />
                    <p>This file type cannot be previewed here.</p>
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="vt-preview-fallback-btn">
                      Open in a new tab <i className="ri-external-link-line" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
  );
}
