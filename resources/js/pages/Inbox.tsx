import { useEffect, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ShimmerTableRows } from '../components/ui/Shimmer';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from './hrms/doc-templates/HeaderFooterPanel';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type SignerState = {
  index: number; role_name: string; action: string; days: number;
  user_id: number | null; name: string;
  status: 'Pending' | 'Done' | 'Rejected' | 'Skipped';
  acted_at: string | null; signed_name: string | null; note: string | null;
};

interface SignatureRun {
  id: number;
  code: string | null;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
  template_id: number;
  template?: { id: number; code: string; name: string; doc_type: string | null } | null;
  employee_id: number;
  employee?: {
    id: number; display_name: string | null; first_name: string | null; last_name: string | null;
    emp_code: string | null; department?: { id: number; name: string } | null;
  } | null;
  content_html: string | null;
  header_config: HeaderConfig | null;
  footer_config: FooterConfig | null;
  signers: SignerState[];
  current_index: number;
  created_at: string;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Inbox() {
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<SignatureRun[]>([]);
  const [loading, setLoading] = useState(true);

  // View modal (read-only preview)
  const [viewRun, setViewRun] = useState<SignatureRun | null>(null);

  // Decision modal — same shape as MyTeam: doc preview + remark + Reject /
  // Approve|Sign|Acknowledge in the footer.
  const [actionRun, setActionRun] = useState<SignatureRun | null>(null);
  const [actionName, setActionName] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get<SignatureRun[]>('/hr-document-signatures/inbox');
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error('Could not load inbox', err?.response?.data?.message || 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openAction = (run: SignatureRun) => {
    const current = run.signers[run.current_index];
    setActionRun(run);
    setActionName(user?.name || current?.name || '');
    setActionNote('');
  };

  const submitDecision = async (verdict: 'approve' | 'reject') => {
    if (!actionRun) return;
    const current = actionRun.signers[actionRun.current_index];
    if (!current) return;
    const apiAction = current.action === 'Sign' ? 'Sign'
                    : current.action === 'Approve' ? 'Approve'
                    : 'Acknowledge';

    if (verdict === 'reject') {
      const reason = actionNote.trim();
      if (!reason) {
        toast.error('Remark required', 'Add a remark explaining what should change.');
        return;
      }
      if (!confirm(`Reject ${actionRun.code || 'this document'}? The workflow will halt and the sender will see your remark.`)) return;
      setSubmitting(true);
      try {
        await api.post(`/hr-document-signatures/${actionRun.id}/reject`, { reason });
        toast.success('Rejected', `${actionRun.code || `Run #${actionRun.id}`} returned with your remark.`);
        setActionRun(null);
        load();
      } catch (err: any) {
        toast.error('Could not reject', err?.response?.data?.message || 'Please try again.');
      } finally { setSubmitting(false); }
      return;
    }

    if (apiAction === 'Sign' && !actionName.trim()) {
      toast.error('Signature required', 'Please type your name to sign.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${actionRun.id}/action`, {
        action:      apiAction,
        signed_name: apiAction === 'Sign' ? actionName.trim() : null,
        note:        actionNote.trim() || null,
      });
      toast.success(
        apiAction === 'Sign' ? 'Signed' : apiAction === 'Approve' ? 'Approved' : 'Acknowledged',
        `${actionRun.code || `Run #${actionRun.id}`} updated.`,
      );
      setActionRun(null);
      load();
    } catch (err: any) {
      toast.error('Could not record action', err?.response?.data?.message || 'Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <Row>
      <Col xs={12}>
        <div className="rec-page">
          {/* Header */}
          <Card className="mb-3" style={{ borderRadius: 14 }}>
            <CardBody className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div className="d-flex align-items-center gap-3">
                <span style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ri-inbox-line" style={{ fontSize: 22, color: '#a16207' }} />
                </span>
                <div>
                  <h4 className="mb-0 fw-bold">Inbox</h4>
                  <div className="text-muted" style={{ fontSize: 12.5 }}>
                    Documents waiting on your action — sign, approve, or acknowledge.
                  </div>
                </div>
              </div>
              <span style={{ padding: '6px 14px', borderRadius: 999, background: 'linear-gradient(135deg,#f7b84b,#fbc763)', color: '#fff', fontWeight: 700, fontSize: 13 }}>
                <i className="ri-mail-unread-line me-1" />
                {loading ? '…' : `${rows.length} pending`}
              </span>
            </CardBody>
          </Card>

          {/* List */}
          <Card style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="table-responsive">
                <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
                  <thead style={{ background: '#fffbeb' }}>
                    <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px', width: 40 }}>#</th>
                      <th>Document</th>
                      <th>Subject Employee</th>
                      <th>Action Requested</th>
                      <th>Step</th>
                      <th>Received</th>
                      <th style={{ width: 240 }}>Take Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={5} cols={7} />
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
                        <i className="ri-checkbox-circle-line" style={{ fontSize: 36, display: 'block', marginBottom: 8 }} />
                        <div style={{ fontSize: 14, fontWeight: 600 }}>No pending documents</div>
                        <div style={{ fontSize: 12 }}>You're all caught up. Anything sent to you will land here.</div>
                      </td></tr>
                    ) : (
                      rows.map((r, i) => {
                        const current = r.signers[r.current_index];
                        const empName = r.employee?.display_name
                          || `${r.employee?.first_name || ''} ${r.employee?.last_name || ''}`.trim()
                          || '—';
                        const actionTone =
                          current?.action === 'Sign'    ? { bg: '#fef3c7', fg: '#92400e' }
                          : current?.action === 'Approve'? { bg: '#dcfce7', fg: '#15803d' }
                          :                                { bg: '#e0e7ff', fg: '#4338ca' };
                        return (
                          <tr key={r.id}>
                            <td>{i + 1}</td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{r.template?.name || '(template removed)'}</div>
                              {r.code && <code style={{ fontSize: 10.5, background: '#fef3c7', color: '#a16207', padding: '1px 6px', borderRadius: 4 }}>{r.code}</code>}
                            </td>
                            <td>
                              <div>{empName}</div>
                              <div style={{ fontSize: 11.5, color: '#6b7280' }}>
                                {r.employee?.emp_code || '—'}
                                {r.employee?.department?.name ? ` · ${r.employee.department.name}` : ''}
                              </div>
                            </td>
                            <td>
                              <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: actionTone.bg, color: actionTone.fg }}>
                                {current?.action || '—'}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>
                              Step <strong>{r.current_index + 1}</strong> of {r.signers.length}
                            </td>
                            <td style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.created_at).toLocaleString()}</td>
                            <td>
                              <div className="d-flex gap-1 flex-wrap">
                                <button type="button" onClick={() => setViewRun(r)}
                                  title="Preview the document before deciding"
                                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  <i className="ri-eye-line me-1" />View
                                </button>
                                <button type="button" onClick={() => openAction(r)}
                                  style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  <i className="ri-checkbox-circle-line me-1" />Review &amp; Decide
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      </Col>

      {/* View modal — pure preview */}
      {viewRun && (
        <ModalShell onClose={() => setViewRun(null)} title="Document Preview"
          subtitle={`${viewRun.template?.name || ''} · ${viewRun.code || ''}`}
          gradient="linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)">
          <div style={{ padding: 16, background: '#f9fafb', overflowY: 'auto', flex: 1 }}>
            <HeaderFooterPanel
              header={{ ...DEFAULT_HEADER, ...(viewRun.header_config || {}) } as HeaderConfig}
              setHeader={() => {}}
              footer={{ ...DEFAULT_FOOTER, ...(viewRun.footer_config || {}) } as FooterConfig}
              setFooter={() => {}}
              readOnly
            >
              <div className="tpl-readonly-preview"
                style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                dangerouslySetInnerHTML={{ __html: viewRun.content_html || '<p>(empty)</p>' }}
              />
            </HeaderFooterPanel>
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setViewRun(null)}
              style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              Close
            </button>
            <button type="button" onClick={() => { const v = viewRun; setViewRun(null); openAction(v); }}
              style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              <i className="ri-checkbox-circle-line me-1" />Review &amp; Decide
            </button>
          </div>
        </ModalShell>
      )}

      {/* Decision modal */}
      {actionRun && (() => {
        const current = actionRun.signers[actionRun.current_index];
        const isSign = current?.action === 'Sign';
        return (
          <ModalShell onClose={() => setActionRun(null)} title="Review & Decide"
            subtitle={`Action requested: ${current?.action} · ${actionRun.code || ''}`}
            hint={`Add a remark below, then choose ${current?.action} or Reject.`}
            gradient="linear-gradient(135deg,#6366f1,#8b5cf6)">
            <div style={{ padding: 16, background: '#f9fafb', overflowY: 'auto', flex: 1 }}>
              <HeaderFooterPanel
                header={{ ...DEFAULT_HEADER, ...(actionRun.header_config || {}) } as HeaderConfig}
                setHeader={() => {}}
                footer={{ ...DEFAULT_FOOTER, ...(actionRun.footer_config || {}) } as FooterConfig}
                setFooter={() => {}}
                readOnly
              >
                <div className="tpl-readonly-preview"
                  style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 220 }}
                  dangerouslySetInnerHTML={{ __html: actionRun.content_html || '<p>(empty)</p>' }}
                />
              </HeaderFooterPanel>

              <div style={{ marginTop: 14, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                {isSign && (
                  <>
                    <label style={inputLabelStyle}>Type your name to sign <span style={{ color: '#ef4444' }}>*</span></label>
                    <input type="text" value={actionName} onChange={e => setActionName(e.target.value)}
                      placeholder="Your full name"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }} />
                    {actionName && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 11.5, color: '#6b7280' }}>
                        Preview: <span style={{ fontFamily: '"Brush Script MT", cursive', fontSize: 22, color: '#1d4ed8', marginLeft: 6 }}>{actionName}</span>
                      </div>
                    )}
                  </>
                )}
                <label style={{ ...inputLabelStyle, marginTop: isSign ? 12 : 0 }}>Remark</label>
                <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
                  placeholder="Add a remark — optional when approving, REQUIRED when rejecting (describe what should change)."
                  rows={3} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  Remarks land in the audit trail. Rejection halts the workflow and returns the document to the sender.
                </div>
              </div>
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => submitDecision('reject')}
                disabled={submitting || !actionNote.trim()}
                title={actionNote.trim() ? 'Reject with this remark' : 'Add a remark first'}
                style={{ padding: '7px 14px', background: actionNote.trim() ? 'linear-gradient(135deg,#dc2626,#ef4444)' : '#fee2e2', color: actionNote.trim() ? '#fff' : '#b91c1c', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: actionNote.trim() ? 'pointer' : 'not-allowed', opacity: actionNote.trim() ? 1 : 0.7 }}>
                <i className="ri-close-circle-line me-1" />Reject &amp; Send Back
              </button>
              <div className="d-flex gap-2">
                <button type="button" onClick={() => setActionRun(null)} disabled={submitting}
                  style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={() => submitDecision('approve')}
                  disabled={submitting || (isSign && !actionName.trim())}
                  style={{
                    padding: '7px 16px',
                    background: current?.action === 'Approve'
                      ? 'linear-gradient(135deg,#16a34a,#22c55e)'
                      : isSign
                        ? 'linear-gradient(135deg,#0ea5e9,#3b82f6)'
                        : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                    border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
                  }}>
                  <i className={isSign ? 'ri-quill-pen-line' : current?.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
                  {submitting ? 'Submitting…' : current?.action}
                </button>
              </div>
            </div>
          </ModalShell>
        );
      })()}
    </Row>
  );
}

/* ── Lightweight modal shell — local to this file to keep Inbox self-contained.
    Provides the dark backdrop + click-outside-to-close + gradient header pattern
    so the View and Decision modals share their chrome. */
function ModalShell({
  onClose, title, subtitle, hint, gradient, children,
}: {
  onClose: () => void; title: string; subtitle?: string; hint?: string;
  gradient: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: gradient, color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="min-w-0">
              <strong style={{ fontSize: 15 }}><i className="ri-checkbox-circle-line me-2" />{title}</strong>
              {subtitle && <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>{subtitle}</div>}
              {hint && <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>{hint}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4,
};
