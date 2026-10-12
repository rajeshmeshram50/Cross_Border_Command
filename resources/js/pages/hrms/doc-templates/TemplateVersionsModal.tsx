import { useEffect, useState } from 'react';
import { Modal, Spinner } from 'reactstrap';
import api from '../../../api';
import { SalaryModalStyles } from '../../../components/SalaryStructureModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Document template version history — every save a template has had, each
 * downloadable as the DOCX it was at the time.
 *
 * WHY THIS EXISTS
 * The version label moved but nothing kept what it referred to: every save
 * overwrote content_html in place, so "v3" named a document nobody could
 * read. A template is approved, signed against and quoted in audits, so the
 * question "what did v2 actually say" has to have an answer.
 *
 * Read-only by design. Editing is the editor's job; this is the audit trail
 * beside it, and a history panel that could rewrite history would not be one.
 *
 * Built on the same shell as Salary Revision History — hero, timeline rail,
 * one card per version — because they answer the same shape of question and
 * two designs for it would be one too many.
 * ───────────────────────────────────────────────────────────────────────── */

export type TemplateVersion = {
  id: number;
  version: string;
  code: string | null;
  name: string | null;
  status: string | null;
  source: string;
  saved_by: string | null;
  saved_at: string | null;
  is_current: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  template: { id: number; code?: string | null; name?: string | null; version?: string | null } | null;
};

const stamp = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';

export default function TemplateVersionsModal({ open, onClose, template }: Props) {
  const [rows, setRows] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "<versionId>:<format>" while that one download is building, so DOCX and
  // PDF on the same row can show their own spinner.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    let live = true;
    setLoading(true);
    setError(null);
    setRows([]);
    api.get(`/hr-document-templates/${template.id}/versions`)
      .then(({ data }) => { if (live) setRows(data?.versions ?? []); })
      .catch((e: any) => { if (live) setError(e?.response?.data?.message || 'Could not load the version history.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, template?.id]);

  const MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
  } as const;

  const download = async (v: TemplateVersion, format: 'docx' | 'pdf') => {
    if (!template || busy !== null) return;
    setBusy(`${v.id}:${format}`);
    try {
      const res = await api.get(
        `/hr-document-templates/${template.id}/versions/${v.id}/download`,
        { params: { format }, responseType: 'blob' },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: MIME[format] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${v.code || 'template'}-${v.version}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — revoking immediately cancels the download in
      // some browsers before they have read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e?.response?.data?.message || `Could not build that version as ${format.toUpperCase()}.`);
    } finally {
      setBusy(null);
    }
  };

  /* A glyph, not initials. The salary modal shows a person, who has them;
     a template code reduces to nonsense — IT-INT-016 gives "II", which reads
     as a pause button. */

  return (
    <Modal isOpen={open} toggle={onClose} centered className="tvm-modal" contentClassName="ssm-card">
      <SalaryModalStyles />
      <VersionStyles />

      <div className="ssm-shell">
        <div className="ssm-hero">
          <div className="ssm-hero-glow" />
          <div className="ssm-hero-main">
            <span className="ssm-avatar"><i className="ri-file-list-3-line" /></span>
            <div className="ssm-hero-text">
              <h5 className="ssm-title">
                Version History
                <span className="ssm-title-sep">—</span>
                <span className="ssm-title-emp">{template?.name}</span>
              </h5>
              <div className="ssm-chips">
                {template?.code && <span className="ssm-chip">{template.code}</span>}
                {template?.version && <span className="ssm-chip">Current {template.version}</span>}
                {rows.length > 0 && (
                  <span className="ssm-chip ssm-chip--solid">
                    {rows.length} version{rows.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button type="button" className="ssm-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="ssm-body tvm-body">
          {loading && (
            <div className="text-center py-5">
              <Spinner size="sm" /> <span className="ms-2 text-muted" style={{ fontSize: 12.5 }}>Loading history…</span>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-5 text-danger" style={{ fontSize: 12.5 }}>{error}</div>
          )}

          {/* Snapshots begin the first time a template is saved after this
              shipped, so an untouched template has nothing to show. Say which
              it is, rather than leaving a blank panel that reads as a failure. */}
          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-5 text-muted" style={{ fontSize: 12.5 }}>
              <i className="ri-history-line d-block mb-2" style={{ fontSize: 26, opacity: .35 }} />
              No saved versions yet. A version is filed each time this template is saved.
            </div>
          )}

          {!loading && !error && rows.map((v, i) => {
            /* rows are newest-first, so the LAST entry is the oldest version —
               the rail must not draw a connector below it. */
            const isLast = i === rows.length - 1;

            return (
              <div key={v.id} className="d-flex" style={{ gap: 14 }}>
                {/* ── Timeline rail ──
                    A vertical line with a node per version, so the sequence
                    reads as one story rather than a stack of cards. */}
                <div className="d-flex flex-column align-items-center flex-shrink-0" style={{ width: 22 }}>
                  <span
                    style={{
                      width: 11, height: 11, borderRadius: '50%', marginTop: 17,
                      background: v.is_current ? 'var(--vz-success)' : 'var(--vz-border-color)',
                      boxShadow: v.is_current ? '0 0 0 3px rgba(var(--vz-success-rgb), .18)' : 'none',
                      flexShrink: 0,
                    }}
                  />
                  {!isLast && <span style={{ flex: 1, width: 2, background: 'var(--vz-border-color)', marginTop: 4 }} />}
                </div>

                <div
                  className="mb-3 flex-grow-1"
                  style={{
                    border: `1px solid ${v.is_current ? 'var(--vz-success)' : 'var(--vz-border-color)'}`,
                    borderRadius: 12,
                    background: v.is_current ? 'rgba(var(--vz-success-rgb), .06)' : 'var(--vz-card-bg)',
                    minWidth: 0,
                  }}
                >
                  {/* Two lines, not one. Version, state and the download are
                      what the eye looks for; who saved it and when is the
                      detail underneath. Crammed onto a single row they all
                      competed and the card could not breathe. */}
                  <div className="d-flex align-items-center gap-3" style={{ padding: '12px 14px' }}>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="fw-bold" style={{ fontSize: 13.5 }}>{v.version}</span>

                        {v.is_current
                          ? <span className="badge bg-success-subtle text-success" style={{ fontSize: 9.5, letterSpacing: '.04em' }}>CURRENT</span>
                          : <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: 9.5, letterSpacing: '.04em' }}>SUPERSEDED</span>}

                        <span className="badge bg-light text-body-secondary" style={{ fontSize: 9.5, letterSpacing: '.04em' }}>
                          {v.source.toUpperCase()}
                        </span>
                      </div>

                      <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>
                        Saved by <strong>{v.saved_by || 'Unknown'}</strong>
                        <span className="mx-1">·</span>
                        {stamp(v.saved_at)}
                      </div>
                    </div>

                    {/* Both formats, side by side. The Word file is what gets
                        edited and re-uploaded; the PDF is what gets read and
                        filed, and asking which one you wanted behind a menu
                        would be a click for no reason. */}
                    <div className="d-flex gap-2 flex-shrink-0">
                      <button
                        type="button"
                        className="tvm-dl"
                        disabled={busy !== null}
                        onClick={() => void download(v, 'docx')}
                        title={`Download ${v.version} as a Word file`}
                      >
                        <i className={busy === `${v.id}:docx` ? 'ri-loader-4-line ri-spin' : 'ri-file-word-2-line'} />
                        <span>DOCX</span>
                      </button>
                      <button
                        type="button"
                        className="tvm-dl tvm-dl--pdf"
                        disabled={busy !== null}
                        onClick={() => void download(v, 'pdf')}
                        title={`Download ${v.version} as a PDF`}
                      >
                        <i className={busy === `${v.id}:pdf` ? 'ri-loader-4-line ri-spin' : 'ri-file-pdf-2-line'} />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function VersionStyles() {
  return (
    <style>{`
      .tvm-modal { max-width: 720px; }
      /* The hero is full-bleed, so the dialog clips — otherwise its square top
         corners sit proud of the rounded shell. */
      .tvm-modal .modal-content { border-radius: 16px; overflow: hidden; border: 0; }
      .tvm-body {
        /* Five cards, then scroll. A card is ~67px plus its 16px gap, so five
           land at ~415px — enough that a short history needs no scrollbar at
           all, and a long one still shows the newest five without the dialog
           running off the screen. The vh cap keeps that honest on a short
           laptop display, where a fixed height would push the footer under the
           viewport. */
        max-height: min(62vh, 415px);
        padding-bottom: 6px;
      }
      .tvm-body::-webkit-scrollbar { width: 8px; }
      .tvm-body::-webkit-scrollbar-thumb { background: var(--vz-border-color); border-radius: 8px; }
      .tvm-body::-webkit-scrollbar-thumb:hover { background: var(--vz-secondary-color); }

      /* Styled here rather than borrowing .btn-sm: this page compresses the
         Bootstrap small button for its Actions column, and inheriting that
         left the only action in the dialog looking like a disabled chip. */
      .tvm-dl {
        display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
        padding: 7px 14px; border-radius: 10px;
        font-size: 12px; font-weight: 600; letter-spacing: .01em; line-height: 1;
        color: var(--vz-primary);
        background: rgba(var(--vz-primary-rgb), .08);
        border: 1px solid rgba(var(--vz-primary-rgb), .35);
        cursor: pointer; transition: background .15s, border-color .15s, transform .12s;
      }
      .tvm-dl i { font-size: 15px; line-height: 1; }
      .tvm-dl:hover:not(:disabled) {
        background: rgba(var(--vz-primary-rgb), .16);
        border-color: var(--vz-primary);
        transform: translateY(-1px);
      }
      .tvm-dl:disabled { opacity: .55; cursor: default; transform: none; }

      /* PDF reads as the read-only sibling of the Word file, so it takes the
         danger hue the rest of the app already uses for a PDF glyph. */
      .tvm-dl--pdf {
        color: var(--vz-danger);
        background: rgba(var(--vz-danger-rgb), .08);
        border-color: rgba(var(--vz-danger-rgb), .35);
      }
      .tvm-dl--pdf:hover:not(:disabled) {
        background: rgba(var(--vz-danger-rgb), .16);
        border-color: var(--vz-danger);
      }
    `}</style>
  );
}
