import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { SigningTrackerModal } from './SigningTrackerModal';

/* ───────────────────────────────────────────────────────────────────────
 * Sales Matrix → Sign Document Tracker
 *
 * A read-only "all documents we sent for e-signature" view — our own
 * mirror of Zoho Sign's "All documents" screen, so the team can track
 * every Quotation / PI / Trade Document / Agreement sent for signing
 * without leaving the app. Data comes from GET /clm/signature-requests
 * (all document types, no party filter); the Axios client auto-injects
 * `branch_id`, and the backend `forUser()` scope restricts rows to the
 * active branch — so a user only ever sees their own branch's requests.
 *
 * Sending happens elsewhere (Stage 5 / agreement / trade-doc flows); here
 * you only TRACK. The per-row "Track" action opens the shared
 * SigningTrackerModal (the same timeline used across the Sales Matrix).
 *
 * Theme: the green/emerald Consignee palette (matches SalesConsignee).
 * ─────────────────────────────────────────────────────────────────────── */

type Row = {
  id: number;
  code: string;
  docType: string;
  recipients: string[];
  status: string;
  createdAt: string | null;
  viewedAt: string | null;       // earliest signer view (null = not opened yet)
  reminderCount: number;
  hasSigned: boolean;            // a signed PDF is available to view/download
  hasCertificate: boolean;       // the completion certificate is available
};

/* The four document types that flow through e-signature, with a distinct
 * pill colour each (the page chrome stays Consignee-green; the type pills
 * are colour-coded so the four kinds are scannable at a glance). */
const DOC_TYPES: Record<string, { label: string; bg: string; color: string }> = {
  quotation:         { label: 'Quotation', bg: 'rgba(124,58,237,0.12)', color: '#7c3aed' },
  proforma_invoice:  { label: 'PI',        bg: 'rgba(2,132,199,0.12)',  color: '#0284c7' },
  trade_doc:         { label: 'Trade',     bg: 'rgba(217,119,6,0.14)',  color: '#d97706' },
  agreement:         { label: 'Agreement', bg: 'rgba(5,150,105,0.12)',  color: '#059669' },
};
const docTypeMeta = (t: string) =>
  DOC_TYPES[t] ?? { label: t || '—', bg: 'rgba(100,116,139,0.12)', color: '#475569' };

const TYPE_FILTERS = [
  { key: 'all',              label: 'All' },
  { key: 'quotation',        label: 'Quotation' },
  { key: 'proforma_invoice', label: 'PI' },
  { key: 'trade_doc',        label: 'Trade' },
  { key: 'agreement',        label: 'Agreement' },
];

/* Zoho-style status badges. `inprogress` reads as "Awaiting Sign" so the
 * label matches what the team says out loud. */
const statusMeta = (s: string): { label: string; bg: string; color: string } => {
  switch ((s || '').toLowerCase()) {
    case 'completed':  return { label: 'Completed',     bg: 'rgba(16,185,129,0.14)', color: '#059669' };
    case 'inprogress': return { label: 'Awaiting Sign', bg: 'rgba(245,158,11,0.16)', color: '#b45309' };
    case 'draft':      return { label: 'Draft',         bg: 'rgba(2,132,199,0.12)',  color: '#0284c7' };
    case 'declined':   return { label: 'Declined',      bg: 'rgba(239,68,68,0.12)',  color: '#dc2626' };
    case 'recalled':   return { label: 'Recalled',      bg: 'rgba(234,88,12,0.14)',  color: '#ea580c' };
    case 'expired':    return { label: 'Expired',       bg: 'rgba(100,116,139,0.16)', color: '#475569' };
    case 'superseded': return { label: 'Superseded',    bg: 'rgba(100,116,139,0.14)', color: '#64748b' };
    default:           return { label: s || '—',        bg: 'rgba(100,116,139,0.12)', color: '#475569' };
  }
};

const PAGE_SIZE = 10;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

export default function SalesSignTracker() {
  const toast = useToast();
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage]       = useState(1);
  const [trackFor, setTrackFor] = useState<{ sigId: number; code: string } | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      // sync=1 round-trips Zoho so statuses (and per-signer Viewed activity)
      // stay current; no document_type filter → every kind comes back.
      const r = await api.get<{ status: boolean; data: any[] }>('/clm/signature-requests', {
        params: { sync: 1 },
      });
      const data = Array.isArray(r.data?.data) ? r.data.data : [];
      setRows(data.map((d: any): Row => {
        const signers = Array.isArray(d.signers) ? d.signers : [];
        // Earliest view across signers (backend stamps signers[].viewed_at).
        const views = signers.map((s: any) => s?.viewed_at).filter(Boolean).sort();
        return {
          id:         Number(d.id ?? 0),
          code:       String(d.request_name ?? (Array.isArray(d.document_names) ? d.document_names[0] : '') ?? `#${d.id}`),
          docType:    String(d.document_type ?? ''),
          recipients: signers.map((s: any) => String(s?.email ?? s?.name ?? '')).filter(Boolean),
          status:     String(d.status ?? ''),
          createdAt:  d.created_at ?? null,
          viewedAt:   views[0] ?? null,
          reminderCount: Number(d.reminder_count ?? 0),
          hasSigned:  !!(d.signed_document_url || (Array.isArray(d.signed_document_paths) && d.signed_document_paths.length > 0)),
          hasCertificate: !!d.certificate_url,
        };
      }));
    } catch (e: any) {
      toast.error('Failed to load', e?.response?.data?.message ?? 'Could not load signed documents.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const [acting, setActing] = useState<number | null>(null);

  /* Send a signing reminder (only meaningful while awaiting signature). */
  const onRemind = async (id: number) => {
    setActing(id);
    try {
      await api.post(`/clm/signature-requests/${id}/remind`);
      toast.success('Reminder sent', 'The signer has been reminded.');
      void fetchRows();
    } catch (e: any) {
      toast.error('Reminder failed', e?.response?.data?.message ?? 'Could not send the reminder.');
    } finally { setActing(null); }
  };

  /* Open the signed PDF in a new tab. */
  const onViewSigned = async (id: number) => {
    setActing(id);
    try {
      const r = await api.get(`/clm/signature-requests/${id}/view-file/0`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data as Blob), '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error('Open failed', e?.response?.data?.message ?? 'The signed PDF is not available yet.');
    } finally { setActing(null); }
  };

  /* Download the signed PDF (or the completion certificate). */
  const onDownload = async (id: number, code: string, kind: 'signed' | 'certificate') => {
    setActing(id);
    try {
      const url = kind === 'signed'
        ? `/clm/signature-requests/${id}/download-file/0`
        : `/clm/signature-requests/${id}/certificate`;
      const r = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([r.data as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${(code || `sig-${id}`).replace(/[^a-z0-9\-_.]/gi, '_')}_${kind === 'signed' ? 'signed' : 'certificate'}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      toast.error('Download failed', e?.response?.data?.message ?? 'This file is not available yet.');
    } finally { setActing(null); }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (typeFilter !== 'all' && r.docType !== typeFilter) return false;
      if (!needle) return true;
      return (
        r.code.toLowerCase().includes(needle) ||
        r.status.toLowerCase().includes(needle) ||
        docTypeMeta(r.docType).label.toLowerCase().includes(needle) ||
        r.recipients.some(e => e.toLowerCase().includes(needle))
      );
    });
  }, [rows, q, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage  = Math.min(Math.max(1, page), pageCount);
  const pageRows  = filtered.slice((safePage - 1) * PAGE_SIZE, (safePage - 1) * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, typeFilter]);

  return (
    <div className="sdt-root">
      <style>{SDT_CSS}</style>

      {/* ── Hero strip (Consignee green theme) ── */}
      <div className="sdt-hero">
        <div className="sdt-hero-left">
          <div className="sdt-hero-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/></svg>
          </div>
          <div>
            <div className="sdt-hero-title">Sign Document Tracker</div>
            <div className="sdt-hero-sub">Track every Quotation, PI, Trade Document &amp; Agreement sent for e-signature — scoped to your branch.</div>
          </div>
        </div>
        <button type="button" className="sdt-refresh" onClick={() => void fetchRows()} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Toolbar — type filter pills + search ── */}
      <div className="sdt-toolbar">
        <div className="sdt-pills">
          {TYPE_FILTERS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`sdt-pill ${typeFilter === t.key ? 'is-on' : ''}`}
              onClick={() => setTypeFilter(t.key)}
            >
              {t.label}
              {t.key !== 'all' && (
                <span className="sdt-pill-cnt">{rows.filter(r => r.docType === t.key).length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="sdt-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name, recipient, status…"
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="sdt-card">
        <div className="sdt-table-wrap">
          <table className="sdt-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Document Name</th>
                <th style={{ width: 110 }}>Type</th>
                <th>Recipient(s)</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 150 }}>Sent On</th>
                <th style={{ width: 150 }}>Viewed On</th>
                <th style={{ width: 230, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={8} className="sdt-empty">Loading signed documents…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={8} className="sdt-empty">No documents sent for signature {typeFilter !== 'all' ? 'in this type' : 'yet'}.</td></tr>
              ) : pageRows.map((r, i) => {
                const dt = docTypeMeta(r.docType);
                const st = statusMeta(r.status);
                return (
                  <tr key={r.id}>
                    <td className="sdt-muted">{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="sdt-name">{r.code}</td>
                    <td><span className="sdt-badge" style={{ background: dt.bg, color: dt.color }}>{dt.label}</span></td>
                    <td>
                      {r.recipients.length === 0 ? <span className="sdt-muted">—</span> : (
                        <div className="sdt-recips">
                          {r.recipients.map((e, k) => <span key={k} className="sdt-recip">{e}</span>)}
                        </div>
                      )}
                    </td>
                    <td><span className="sdt-badge" style={{ background: st.bg, color: st.color }}>{st.label}</span></td>
                    <td className="sdt-muted">{fmtDate(r.createdAt)}</td>
                    <td className="sdt-muted">
                      {r.viewedAt
                        ? <span className="sdt-viewed">{fmtDate(r.viewedAt)}</span>
                        : <span className="sdt-muted">Not opened</span>}
                    </td>
                    <td>
                      {(() => {
                        const busy = acting === r.id;
                        const inProgress = r.status.toLowerCase() === 'inprogress';
                        return (
                          <div className="sdt-actions">
                            {/* View signed PDF */}
                            <button type="button" className="sdt-act" title="View signed PDF"
                              disabled={busy || !r.hasSigned} onClick={() => void onViewSigned(r.id)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            {/* Download signed PDF */}
                            <button type="button" className="sdt-act" title="Download signed PDF"
                              disabled={busy || !r.hasSigned} onClick={() => void onDownload(r.id, r.code, 'signed')}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                            {/* Download certificate */}
                            <button type="button" className="sdt-act" title="Download completion certificate"
                              disabled={busy || !r.hasCertificate} onClick={() => void onDownload(r.id, r.code, 'certificate')}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                            </button>
                            {/* Remind — only while awaiting signature */}
                            <button type="button" className="sdt-act" title={inProgress ? 'Send signing reminder' : 'Reminders apply only while awaiting signature'}
                              disabled={busy || !inProgress} onClick={() => void onRemind(r.id)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                              {r.reminderCount > 0 && <span className="sdt-act-cnt">{r.reminderCount}</span>}
                            </button>
                            {/* Track — full activity timeline */}
                            <button type="button" className="sdt-act sdt-act-track" title="Track signing activity"
                              disabled={busy} onClick={() => setTrackFor({ sigId: r.id, code: r.code })}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ── */}
        <div className="sdt-foot">
          <span className="sdt-foot-info">
            Showing <b>{filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + pageRows.length}</b> of <b>{filtered.length}</b>
          </span>
          <div className="sdt-pager">
            <button type="button" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Prev</button>
            <span className="sdt-page-of">Page {safePage} of {pageCount}</span>
            <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next ›</button>
          </div>
        </div>
      </div>

      {trackFor && (
        <SigningTrackerModal
          sigId={trackFor.sigId}
          code={trackFor.code}
          onClose={() => { setTrackFor(null); void fetchRows(); }}
        />
      )}
    </div>
  );
}

const SDT_CSS = `
.sdt-root { font-family: var(--font-sans); display: flex; flex-direction: column; gap: 14px; padding: 4px; }

/* Hero — Consignee green/emerald gradient ring. */
.sdt-hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px; min-height: 70px;
  border: 1px solid #99f6e4; border-radius: 16px;
  background:
    linear-gradient(110deg, #f0fdf9 0%, #ecfdf5 45%, #e2fbf1 75%, #d6f9ea 100%) padding-box,
    linear-gradient(125deg, #059669 0%, #10b981 22%, #14b8a6 48%, #2dd4bf 76%, #5eead4 100%) border-box;
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 4px 18px rgba(16,185,129,0.16);
}
.sdt-hero-left { display: flex; align-items: center; gap: 14px; }
.sdt-hero-icon {
  width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #10b981, #047857);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 14px rgba(4,120,87,0.40), 0 0 0 3px rgba(255,255,255,0.5);
}
.sdt-hero-title { font-size: 18px; font-weight: 800; color: #064e3b; letter-spacing: -.3px; }
.sdt-hero-sub   { font-size: 12px; color: #475569; margin-top: 4px; max-width: 720px; }
.sdt-refresh {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; border-radius: 10px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #10b981, #047857); color: #fff;
  font-size: 12.5px; font-weight: 700; box-shadow: 0 4px 12px rgba(4,120,87,.3);
}
.sdt-refresh:disabled { opacity: .6; cursor: default; }

/* Toolbar */
.sdt-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.sdt-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.sdt-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid #d1fae5; background: #fff; color: #047857;
  font-size: 12px; font-weight: 700; transition: all .15s;
}
.sdt-pill:hover { background: #ecfdf5; }
.sdt-pill.is-on { background: linear-gradient(135deg, #10b981, #047857); color: #fff; border-color: transparent; }
.sdt-pill-cnt {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(4,120,87,.12); color: #047857; font-size: 10.5px; font-weight: 800;
}
.sdt-pill.is-on .sdt-pill-cnt { background: rgba(255,255,255,.25); color: #fff; }
.sdt-search {
  display: inline-flex; align-items: center; gap: 8px; min-width: 280px;
  padding: 8px 12px; border-radius: 10px; border: 1px solid #d1fae5; background: #fff; color: #94a3b8;
}
.sdt-search input { border: none; outline: none; flex: 1; font-size: 13px; color: #0f172a; background: transparent; }

/* Table card */
.sdt-card { border: 1px solid #d1fae5; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 4px 18px rgba(16,185,129,.08); }
.sdt-table-wrap { overflow-x: auto; }
.sdt-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sdt-table thead tr { background: linear-gradient(110deg, #059669 0%, #047857 55%, #065f46 100%); }
.sdt-table thead th {
  text-align: left; padding: 12px 14px; color: #fff;
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap;
}
.sdt-table tbody td { padding: 11px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #1e293b; }
.sdt-table tbody tr:hover { background: #f0fdf9; }
.sdt-name { font-weight: 700; color: #0f172a; }
.sdt-muted { color: #64748b; white-space: nowrap; }
.sdt-empty { text-align: center; color: #94a3b8; padding: 38px 14px !important; font-size: 13px; }
.sdt-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; white-space: nowrap; }
.sdt-recips { display: flex; flex-direction: column; gap: 2px; }
.sdt-recip { font-size: 12px; color: #334155; }
.sdt-track-btn {
  width: 32px; height: 32px; border-radius: 9px; cursor: pointer;
  border: 1px solid #99f6e4; background: #ecfdf5; color: #047857;
  display: inline-flex; align-items: center; justify-content: center; transition: all .15s;
}
.sdt-track-btn:hover { background: #10b981; color: #fff; border-color: transparent; }

/* Per-row action buttons (View / Download / Certificate / Remind / Track). */
.sdt-actions { display: inline-flex; align-items: center; gap: 5px; }
.sdt-act {
  position: relative;
  width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
  border: 1px solid #d1fae5; background: #fff; color: #047857;
  display: inline-flex; align-items: center; justify-content: center; transition: all .15s;
}
.sdt-act:hover:not(:disabled) { background: #10b981; color: #fff; border-color: transparent; }
.sdt-act:disabled { opacity: .38; cursor: not-allowed; }
.sdt-act-track { background: #ecfdf5; }
.sdt-act-cnt {
  position: absolute; top: -5px; right: -5px;
  min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px;
  background: #f59e0b; color: #fff; font-size: 9px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.sdt-viewed { color: #059669; font-weight: 600; white-space: nowrap; }

[data-bs-theme="dark"] .sdt-act { background: #0b1220; border-color: rgba(16,185,129,.25); color: #5eead4; }
[data-bs-theme="dark"] .sdt-act-track { background: rgba(16,185,129,.10); }

/* Footer */
.sdt-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #f8fafc; border-top: 1px solid #f1f5f9; flex-wrap: wrap; }
.sdt-foot-info { font-size: 12.5px; color: #475569; }
.sdt-pager { display: flex; align-items: center; gap: 8px; }
.sdt-pager button {
  padding: 6px 12px; border-radius: 8px; border: 1px solid #d1fae5; background: #fff; color: #047857;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.sdt-pager button:disabled { opacity: .45; cursor: default; }
.sdt-page-of { font-size: 12px; color: #64748b; font-weight: 600; }

[data-bs-theme="dark"] .sdt-hero {
  border-color: transparent;
  background:
    linear-gradient(110deg, #052e25 0%, #04231d 50%, #06352a 100%) padding-box,
    linear-gradient(125deg, #059669 0%, #10b981 40%, #2dd4bf 100%) border-box;
}
[data-bs-theme="dark"] .sdt-hero-title { color: #d1fae5; }
[data-bs-theme="dark"] .sdt-hero-sub { color: #94a3b8; }
[data-bs-theme="dark"] .sdt-card { background: #0b1220; border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .sdt-table tbody td { color: #e2e8f0; border-color: rgba(148,163,184,.12); }
[data-bs-theme="dark"] .sdt-table tbody tr:hover { background: rgba(16,185,129,.07); }
[data-bs-theme="dark"] .sdt-name { color: #f1f5f9; }
[data-bs-theme="dark"] .sdt-foot { background: rgba(148,163,184,.05); border-color: rgba(148,163,184,.12); }
[data-bs-theme="dark"] .sdt-search, [data-bs-theme="dark"] .sdt-pill { background: #0b1220; border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .sdt-search input { color: #e2e8f0; }
`;
