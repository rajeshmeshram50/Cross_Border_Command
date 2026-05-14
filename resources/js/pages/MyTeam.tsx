import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Input } from 'reactstrap';
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
interface TeamScope { kind: 'all' | 'client' | 'branch' | 'reports' | 'none'; label: string }

interface TeamEmployee {
  id: number;
  emp_code: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  department?: { id: number; name: string } | null;
  designation?: { id: number; name: string; level?: string | null } | null;
  reportingManager?: { id: number; display_name: string; emp_code: string } | null;
  branch?: { id: number; name: string; is_main: boolean } | null;
  status: string;
}

type ApprovalModule = 'document_signature' | 'expense' | 'leave';
interface ApprovalItem {
  module: ApprovalModule;
  id: number;
  code: string | null;
  title: string;
  subject_name: string;
  subject_dept: string;
  action: string;            // Sign | Approve | Review & Acknowledge
  status: string;
  days_left: number | null;
  created_at: string;
  raw: any;                  // full signature row (frozen content + signers)
}

interface ApprovalsResponse {
  scope: TeamScope;
  approvals: ApprovalItem[];
  counts: { total: number; document_signature: number; expense: number; leave: number };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function MyTeam() {
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<'employees' | 'approvals'>('employees');
  const [scope, setScope] = useState<TeamScope | null>(null);

  // Employees tab
  const [empLoading, setEmpLoading] = useState(true);
  const [employees, setEmployees] = useState<TeamEmployee[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  // Approvals tab
  const [apprLoading, setApprLoading] = useState(true);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalCounts, setApprovalCounts] = useState<ApprovalsResponse['counts']>({ total: 0, document_signature: 0, expense: 0, leave: 0 });

  // Action modal for "Take Action" buttons
  const [actionItem, setActionItem] = useState<ApprovalItem | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionName, setActionName] = useState('');
  const [actionNote, setActionNote] = useState('');

  // View-only preview modal — opens the locked document without the
  // action form, so approvers can read first and decide later.
  const [viewItem, setViewItem] = useState<ApprovalItem | null>(null);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadEmployees = async () => {
    try {
      setEmpLoading(true);
      const { data } = await api.get('/my-team/employees');
      setEmployees(Array.isArray(data?.employees) ? data.employees : []);
      if (data?.scope) setScope(data.scope);
    } catch (err: any) {
      toast.error('Could not load team', err?.response?.data?.message || 'Please try again.');
      setEmployees([]);
    } finally {
      setEmpLoading(false);
    }
  };

  const loadApprovals = async () => {
    try {
      setApprLoading(true);
      const { data } = await api.get<ApprovalsResponse>('/my-team/approvals');
      setApprovals(Array.isArray(data?.approvals) ? data.approvals : []);
      setApprovalCounts(data?.counts || { total: 0, document_signature: 0, expense: 0, leave: 0 });
      if (data?.scope) setScope(data.scope);
    } catch (err: any) {
      toast.error('Could not load approvals', err?.response?.data?.message || 'Please try again.');
      setApprovals([]);
    } finally {
      setApprLoading(false);
    }
  };

  useEffect(() => { loadEmployees(); loadApprovals(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Action handlers ───────────────────────────────────────────────────────
  const openAction = (item: ApprovalItem) => {
    setActionItem(item);
    // Pre-fill the typed-signature field with the user's name for Sign rows.
    setActionName(user?.name || '');
    setActionNote('');
  };

  const submitAction = async () => {
    if (!actionItem) return;
    const apiAction = actionItem.action === 'Sign' ? 'Sign'
                    : actionItem.action === 'Approve' ? 'Approve'
                    : 'Acknowledge';
    if (apiAction === 'Sign' && !actionName.trim()) {
      toast.error('Signature required', 'Please type your name to sign.');
      return;
    }
    setActionSubmitting(true);
    try {
      await api.post(`/hr-document-signatures/${actionItem.id}/action`, {
        action:      apiAction,
        signed_name: apiAction === 'Sign' ? actionName.trim() : null,
        note:        actionNote.trim() || null,
      });
      toast.success(
        apiAction === 'Sign' ? 'Signed' : apiAction === 'Approve' ? 'Approved' : 'Acknowledged',
        `${actionItem.code || `Run #${actionItem.id}`} updated.`,
      );
      setActionItem(null);
      loadApprovals();
    } catch (err: any) {
      toast.error('Could not record action', err?.response?.data?.message || 'Please try again.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    const needle = empSearch.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter(e =>
      (e.display_name || '').toLowerCase().includes(needle) ||
      (e.emp_code || '').toLowerCase().includes(needle) ||
      (e.email || '').toLowerCase().includes(needle) ||
      (e.department?.name || '').toLowerCase().includes(needle)
    );
  }, [employees, empSearch]);

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* Header */}
            <Card className="mb-3" style={{ borderRadius: 14 }}>
              <CardBody className="d-flex align-items-center justify-content-between flex-wrap gap-3">
                <div className="d-flex align-items-center gap-3">
                  <span style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ri-team-line" style={{ fontSize: 22, color: '#4338ca' }} />
                  </span>
                  <div>
                    <h4 className="mb-0 fw-bold">My Team</h4>
                    <div className="text-muted" style={{ fontSize: 12.5 }}>{scope?.label || 'Loading…'}</div>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Tabs */}
            <div className="d-flex gap-2 mb-3">
              <button type="button" onClick={() => setTab('employees')}
                style={tabBtnStyle(tab === 'employees', '#6366f1')}>
                <i className="ri-team-line me-1" /> Employee List
                <span style={countPillStyle(tab === 'employees')}>{employees.length}</span>
              </button>
              <button type="button" onClick={() => setTab('approvals')}
                style={tabBtnStyle(tab === 'approvals', '#16a34a')}>
                <i className="ri-checkbox-circle-line me-1" /> Approval List
                <span style={countPillStyle(tab === 'approvals')}>{approvalCounts.total}</span>
              </button>
            </div>

            {tab === 'employees' && (
              <EmployeesPanel
                rows={filteredEmployees}
                loading={empLoading}
                search={empSearch}
                setSearch={setEmpSearch}
              />
            )}

            {tab === 'approvals' && (
              <ApprovalsPanel
                rows={approvals}
                loading={apprLoading}
                counts={approvalCounts}
                onAct={openAction}
                onView={(item) => setViewItem(item)}
              />
            )}
          </div>
        </Col>
      </Row>

      {/* Action modal — opens for Sign / Approve / Acknowledge.
          Renders the locked document preview so the signer reviews before
          committing. Same shape as the modal inside the Evidence Vault. */}
      {actionItem && (
        <ActionModal
          item={actionItem}
          onClose={() => setActionItem(null)}
          actionName={actionName} setActionName={setActionName}
          actionNote={actionNote} setActionNote={setActionNote}
          submitting={actionSubmitting}
          onSubmit={submitAction}
        />
      )}

      {/* Read-only view modal — pure preview, no action form. The footer
          carries a CTA that hands off to the action modal so the user can
          review first and act from inside the preview without losing context. */}
      {viewItem && (
        <ViewModal
          item={viewItem}
          onClose={() => setViewItem(null)}
          onTakeAction={() => { const v = viewItem; setViewItem(null); openAction(v); }}
        />
      )}
    </>
  );
}

/* ── Employees panel ───────────────────────────────────────────────────────── */
function EmployeesPanel({
  rows, loading, search, setSearch,
}: {
  rows: TeamEmployee[]; loading: boolean;
  search: string; setSearch: (v: string) => void;
}) {
  return (
    <Card style={{ borderRadius: 12 }}>
      <CardBody style={{ padding: 0 }}>
        <div className="d-flex flex-wrap gap-2 align-items-center" style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ position: 'relative', minWidth: 260 }}>
            <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <Input type="text" placeholder="Search by name, code, email…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 30, height: 36 }} />
          </div>
          <span className="ms-auto" style={{ fontSize: 11.5, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', padding: '5px 12px', borderRadius: 999 }}>
            {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
          </span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
            <thead style={{ background: '#f5f3ff' }}>
              <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                <th style={{ padding: '10px 12px', width: 40 }}>#</th>
                <th>Employee</th>
                <th>Code</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Branch</th>
                <th>Reports To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <ShimmerTableRows rows={5} cols={8} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                  <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                  No employees in your team yet.
                </td></tr>
              ) : (
                rows.map((e, i) => (
                  <tr key={e.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#eef2ff', color: '#4338ca', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>
                          {(e.display_name || e.first_name || 'E').split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase()}
                        </span>
                        <div>
                          <div style={{ fontWeight: 700 }}>{e.display_name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || '—'}</div>
                          <div style={{ fontSize: 11.5, color: '#6b7280' }}>{e.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><code style={{ fontSize: 11, background: '#fef3c7', color: '#a16207', padding: '2px 6px', borderRadius: 4 }}>{e.emp_code || '—'}</code></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.designation?.name || '—'}</div>
                      {e.designation?.level && <div style={{ fontSize: 11.5, color: '#6b7280' }}>{e.designation.level}</div>}
                    </td>
                    <td>{e.department?.name || '—'}</td>
                    <td>{e.branch?.name || '—'}</td>
                    <td>{e.reportingManager?.display_name || '—'}</td>
                    <td>
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: '#dcfce7', color: '#15803d' }}>
                        {e.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Approvals panel ───────────────────────────────────────────────────────── */
function ApprovalsPanel({
  rows, loading, counts, onAct, onView,
}: {
  rows: ApprovalItem[]; loading: boolean;
  counts: ApprovalsResponse['counts'];
  onAct: (item: ApprovalItem) => void;
  onView: (item: ApprovalItem) => void;
}) {
  return (
    <>
      {/* KPI strip — module breakdown */}
      <div className="row g-2 mb-3">
        {[
          { label: 'Total Pending',     value: counts.total,              icon: 'ri-inbox-line',         gradient: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)', deep: '#4338ca' },
          { label: 'Document Signing',  value: counts.document_signature, icon: 'ri-quill-pen-line',     gradient: 'linear-gradient(135deg,#0ea5e9 0%,#3b82f6 100%)', deep: '#1d4ed8' },
          { label: 'Expense Approvals', value: counts.expense,            icon: 'ri-bill-line',          gradient: 'linear-gradient(135deg,#f7b84b 0%,#fbc763 100%)', deep: '#a16207' },
          { label: 'Leave Approvals',   value: counts.leave,              icon: 'ri-calendar-2-line',    gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
        ].map(k => (
          <div key={k.label} className="col-md-3 col-sm-6">
            <div style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden' }}>
              <div style={{ height: 4, background: k.gradient }} />
              <div className="d-flex align-items-center justify-content-between" style={{ padding: '10px 14px' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.deep, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4 }}>{k.label}</div>
                </div>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: k.gradient, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Card style={{ borderRadius: 12 }}>
        <CardBody style={{ padding: 0 }}>
          <div className="table-responsive">
            <table className="table align-middle mb-0" style={{ fontSize: 13 }}>
              <thead style={{ background: '#f0fdf4' }}>
                <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                  <th style={{ padding: '10px 12px', width: 40 }}>#</th>
                  <th>Module</th>
                  <th>Document / Request</th>
                  <th>Subject</th>
                  <th>Action</th>
                  <th>Sent</th>
                  <th style={{ width: 240 }}>Take Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ShimmerTableRows rows={5} cols={7} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                    <i className="ri-checkbox-circle-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                    No pending approvals — you're all caught up.
                  </td></tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.module}-${r.id}`}>
                      <td>{i + 1}</td>
                      <td>
                        <span style={{ padding: '3px 9px', borderRadius: 6, background: '#dbeafe', color: '#1d4ed8', fontSize: 11.5, fontWeight: 700 }}>
                          <i className="ri-quill-pen-line me-1" />{moduleLabel(r.module)}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{r.title}</div>
                        {r.code && <code style={{ fontSize: 10.5, background: '#fef3c7', color: '#a16207', padding: '1px 6px', borderRadius: 4 }}>{r.code}</code>}
                      </td>
                      <td>
                        <div>{r.subject_name}</div>
                        <div style={{ fontSize: 11.5, color: '#6b7280' }}>{r.subject_dept}</div>
                      </td>
                      <td>
                        <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                          background: r.action === 'Sign' ? '#fef3c7' : r.action === 'Approve' ? '#dcfce7' : '#e0e7ff',
                          color: r.action === 'Sign' ? '#92400e' : r.action === 'Approve' ? '#15803d' : '#4338ca' }}>
                          {r.action}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <div className="d-flex gap-1 flex-wrap">
                          {/* View — only meaningful for document-signature
                              rows where we already have the frozen HTML on the
                              row. Other modules will need their own preview
                              handlers when they plug in. */}
                          {r.module === 'document_signature' && (
                            <button type="button" onClick={() => onView(r)}
                              title="Preview the document before taking action"
                              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              <i className="ri-eye-line me-1" />View
                            </button>
                          )}
                          <button type="button" onClick={() => onAct(r)}
                            style={{ padding: '6px 12px', borderRadius: 8, border: 0, background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            <i className={r.action === 'Sign' ? 'ri-quill-pen-line me-1' : r.action === 'Approve' ? 'ri-check-double-line me-1' : 'ri-thumb-up-line me-1'} />
                            {r.action}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Action modal ──────────────────────────────────────────────────────────── */
function ActionModal({
  item, onClose,
  actionName, setActionName,
  actionNote, setActionNote,
  submitting, onSubmit,
}: {
  item: ApprovalItem; onClose: () => void;
  actionName: string; setActionName: (v: string) => void;
  actionNote: string; setActionNote: (v: string) => void;
  submitting: boolean; onSubmit: () => void;
}) {
  const isSign = item.action === 'Sign';
  const header = { ...DEFAULT_HEADER, ...(item.raw?.header_config || {}) } as HeaderConfig;
  const footer = { ...DEFAULT_FOOTER, ...(item.raw?.footer_config || {}) } as FooterConfig;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <strong style={{ fontSize: 15 }}><i className="ri-quill-pen-line me-2" />{item.action}</strong>
              <div style={{ fontSize: 11.5, opacity: 0.85 }}>{item.title} · {item.code}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', background: '#f9fafb', flex: 1 }}>
          <HeaderFooterPanel header={header} setHeader={() => {}} footer={footer} setFooter={() => {}} readOnly>
            <div className="tpl-readonly-preview"
              style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 220 }}
              dangerouslySetInnerHTML={{ __html: item.raw?.content_html || '<p>(empty)</p>' }}
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
            <label style={{ ...inputLabelStyle, marginTop: isSign ? 12 : 0 }}>Note (optional)</label>
            <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
              placeholder="Add a comment for the audit trail"
              rows={2} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
          </div>
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onSubmit} disabled={submitting || (isSign && !actionName.trim())}
            style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
            <i className={isSign ? 'ri-quill-pen-line' : item.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
            {submitting ? 'Submitting…' : `Confirm ${item.action}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Read-only view modal ──────────────────────────────────────────────────── */
function ViewModal({
  item, onClose, onTakeAction,
}: {
  item: ApprovalItem; onClose: () => void; onTakeAction: () => void;
}) {
  const header = { ...DEFAULT_HEADER, ...(item.raw?.header_config || {}) } as HeaderConfig;
  const footer = { ...DEFAULT_FOOTER, ...(item.raw?.footer_config || {}) } as FooterConfig;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 60%,#a855f7 100%)', color: '#fff' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="min-w-0">
              <strong style={{ fontSize: 15 }}><i className="ri-file-search-line me-2" />Document Preview</strong>
              <div style={{ fontSize: 11.5, opacity: 0.85 }}>{item.title} · {item.code}</div>
              <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>
                Subject: <strong>{item.subject_name}</strong> · Pending {item.action}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', background: '#f9fafb', flex: 1 }}>
          <HeaderFooterPanel header={header} setHeader={() => {}} footer={footer} setFooter={() => {}} readOnly>
            <div className="tpl-readonly-preview"
              style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
              dangerouslySetInnerHTML={{ __html: item.raw?.content_html || '<p>(empty)</p>' }}
            />
          </HeaderFooterPanel>
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Close
          </button>
          <button type="button" onClick={onTakeAction}
            style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
            <i className={item.action === 'Sign' ? 'ri-quill-pen-line' : item.action === 'Approve' ? 'ri-check-double-line' : 'ri-thumb-up-line'} style={{ marginRight: 6 }} />
            Proceed to {item.action}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────────── */
function moduleLabel(m: ApprovalModule): string {
  return m === 'document_signature' ? 'Document Signing'
       : m === 'expense'           ? 'Expense Claim'
       : m === 'leave'             ? 'Leave Request'
       : m;
}

function tabBtnStyle(active: boolean, color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', borderRadius: 10,
    border: '1px solid ' + (active ? color : '#e5e7eb'),
    background: active ? color : '#fff',
    color: active ? '#fff' : '#374151',
    cursor: 'pointer', fontWeight: 700, fontSize: 13.5,
  };
}
function countPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '2px 9px', borderRadius: 999, fontSize: 11,
    background: active ? 'rgba(255,255,255,0.25)' : '#f3f4f6',
    color: active ? '#fff' : '#6b7280', fontWeight: 800,
  };
}
const inputLabelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 4,
};
