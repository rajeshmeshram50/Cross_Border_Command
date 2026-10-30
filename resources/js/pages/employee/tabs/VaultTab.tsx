// Evidence Vault tab — Employee Documents (uploaded KYC/education/etc.) and
// Organizational Documents (signed agreements/policies), with a sub-tab switch.
// Extracted from EmployeeProfile.tsx; shared state via useEmployeeProfile().
import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row } from 'reactstrap';
import { Shimmer } from '../../../components/ui/Shimmer';
import DataTable, { type DataTableColumn } from '../../../components/ui/DataTable';
import { resolveFileUrl } from '../../../utils/resolveFileUrl';
import { downloadFile } from '../../../utils/downloadFile';
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

  /* Download the previewed file. (CBC #18)
   *
   * This was a plain <a href download="…">. The `download` attribute is only
   * honoured for SAME-ORIGIN URLs, and documents are served off the storage
   * origin (Azure on the server), so the browser ignored it and navigated to
   * the file instead — for a PDF that means the built-in viewer opens in a new
   * tab and nothing is saved.
   *
   * utils/downloadFile already exists for exactly this and handles the cases
   * this component should not be reinventing: streaming our own uploads back
   * through the API, normalising a stale host, and detecting the SPA's
   * index.html being returned in place of a missing file. */
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const downloadPreview = async () => {
    if (!previewUrl) return;
    setDownloadingPreview(true);
    try {
      await downloadFile(previewUrl, previewDoc?.original_name || '');
    } finally {
      setDownloadingPreview(false);
    }
  };

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
  /* Mirrors the category half of EvidenceVaultModal's DOC_KEY_CATALOGUE.
     Copied rather than imported so that file stays untouched; an unknown key
     falls through to "Other", as it does there. */
  const DOC_CATEGORY: Record<string, string> = {
    aadhaar: 'Identity',   pan: 'Identity',     p_photo: 'Identity',  p_copy: 'Identity',
    cur_addr: 'Address',   perm_addr: 'Address',
    edu_10: 'Education',   edu_12: 'Education', edu_deg: 'Education', edu_pg: 'Education',
    rel_letter: 'Prev. Employment', exp_cert: 'Prev. Employment', pay_slip: 'Prev. Employment',
  };
  /* One accent per category. The badge mixes it against the surface in CSS
     (.vt-cat), so it adapts to dark mode - the old {bg,fg} were light
     pastels set inline, which inline styles kept even in dark (QA 202). */
  const CATEGORY_TONE: Record<string, string> = {
    Identity:           '#7c3aed',
    Address:            '#16a34a',
    Education:          '#d97706',
    'Prev. Employment': '#2563eb',
  };

  const uploadedColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'document',
      header: 'Document',
      accessorFn: (d: any) => prettyDocKey(d.document_key),
      meta: { width: 180 },
      cell: info => <span className="fw-semibold">{String(info.getValue() ?? '')}</span>,
    },
    {
      /* Identity / Address / Education / Prev. Employment / Other — what the
         vault modal uses to group these. Sortable, so the table can be read
         by category without being grouped. */
      id: 'category',
      header: 'Category',
      accessorFn: (d: any) => DOC_CATEGORY[d.document_key] || 'Other',
      meta: { width: 150 },
      cell: info => {
        const cat = String(info.getValue() ?? 'Other');
        const accent = CATEGORY_TONE[cat] || '#64748b';
        return (
          <span className="rec-pill vt-cat" style={{ ['--vt-cat' as any]: accent, fontSize: 11 }}>
            {cat}
          </span>
        );
      },
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
      /* Onboarding / Promotion / Exit. The run has always carried
         trigger_keyword, but it was only used to split the Exit tab off —
         with the vault down to two tabs this column is what tells the three
         kinds of paperwork apart. */
      id: 'type',
      header: 'Type',
      accessorFn: (d: any) => String(d.trigger_keyword || '').toLowerCase(),
      meta: { width: 130 },
      cell: info => {
        const key = String(info.row.original.trigger_keyword || '').toLowerCase();
        const tone =
          key === 'exit'      ? { bg: '#dcfce7', fg: '#15803d', label: 'Exit' }
          : key === 'promotion' ? { bg: '#fef3c7', fg: '#92400e', label: 'Promotion' }
          : key === 'onboarding' ? { bg: '#ede9fe', fg: '#5b21b6', label: 'Onboarding' }
          : { bg: 'var(--vz-secondary-bg)', fg: 'var(--vz-secondary-color)', label: key ? key : '—' };
        return (
          <span
            className="rec-pill text-capitalize"
            style={{ background: tone.bg, color: tone.fg, fontSize: 11 }}
          >
            {tone.label}
          </span>
        );
      },
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

          {/* Drawn exactly like the Evidence Vault modal's strip — see
              EvidenceVaultModal: .ev-tabstrip wrapping an .ev-softrail rail.
              The strip supplies the violet --dt-a-* palette, which is why the
              rail takes the class rather than data-accent: .ev-softrail's
              trough is mixed against #fff and needs those vars in scope. */}
          <div className="ev-tabstrip mb-3">
            <div className="dt-tabrail dt-tabs ev-softrail" role="tablist">
                  {[
                    { key: 'employee'       as const, label: 'Employee Documents',       count: employeeDocCount,       icon: 'ri-user-line' },
                    { key: 'organizational' as const, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line' },
                  ].map(t => {
                    const on = vaultTab === t.key;
                    const busy = t.key === 'employee' ? uploadedLoading : signedLoading;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => setVaultTab(t.key)}
                        className={`dt-tab ${on ? 'on' : 'off'}`}
                      >
                        <i className={t.icon} />
                        {t.label}
                        <span className="dt-tab-count">
                          {busy ? <Shimmer height={9} width={14} /> : t.count}
                        </span>
                      </button>
                    );
                  })}
            </div>
            {/* Both hosts stay mounted; the inactive one is hidden. Moving a
                single ref between tabs would tear down the portal DataTable
                renders its search into. */}
            <div
              className="vt-head-search"
              ref={setUploadedSearchHost}
              style={{ display: vaultTab === 'employee' ? undefined : 'none' }}
            />
            <div
              className="vt-head-search"
              ref={setSignedSearchHost}
              style={{ display: vaultTab === 'organizational' ? undefined : 'none' }}
            />
          </div>

          {/* Employee Documents sub-tab — live list of files the employee
              has actually uploaded (Aadhaar / PAN / photo / etc.). Drops
              the static placeholder catalogue; rows come straight from
              /api/employees/{id}/documents. */}
          {vaultTab === 'employee' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3 ep-ct-violet flex-grow-1 d-flex flex-column"
            >
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
                  /* The profile has an .ep-hero, not an .hr-cstrip, so the
                     HRMS skin has to be named — otherwise the base skin's
                     solid accent header band shows. */
                  className="hr-dt"
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
              <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 ep-hd-amber">
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
              <div className="px-3 pb-3 pt-2 flex-grow-1 d-flex flex-column">
                <DataTable
                  data={organizationalDocs}
                  columns={signedColumns}
                  serial={{ header: 'SR' }}
                  accent="violet"
                  /* The profile has an .ep-hero, not an .hr-cstrip, so the
                     HRMS skin has to be named — otherwise the base skin's
                     solid accent header band shows. */
                  className="hr-dt"
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
                className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 ep-hd-violet vt-uploaded-head"
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
                  /* The profile has an .ep-hero, not an .hr-cstrip, so the
                     HRMS skin has to be named — otherwise the base skin's
                     solid accent header band shows. */
                  className="hr-dt"
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
                  <button
                    type="button"
                    onClick={downloadPreview}
                    disabled={downloadingPreview}
                    className="vt-preview-btn"
                    title="Download"
                  >
                    <i className={downloadingPreview ? 'ri-loader-4-line' : 'ri-download-2-line'} />
                  </button>
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
