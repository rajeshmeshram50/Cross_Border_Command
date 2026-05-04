import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Container } from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ExpenseClaimsTable, { type ExpenseClaimRow } from '../components/ExpenseClaimsTable';

/**
 * HR > Time & Pay Inputs > Expense Management
 *
 * HR / Finance landing page. Lists every expense claim under the current
 * tenant and lets the HR user approve or reject claims that have already
 * cleared the manager stage. The same `ExpenseClaimsTable` component
 * powers the EmployeeProfile expense tab — passing `mode="hr"` toggles the
 * inline HR Approve/Reject buttons (only shown when manager has approved
 * AND HR stage is still pending).
 *
 * Stats strip + filter pills + search bar mirror other HR pages so the
 * surface stays consistent with HrLeave / HrAttendance.
 */
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

export default function HrExpenseManagement() {
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<ExpenseClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // HR users can approve when their permission row on the `hr.expense`
  // module includes can_approve. Super admins and main-branch admins
  // bypass the explicit flag — the backend mirrors this.
  const canHrApprove = useMemo(() => {
    if (!user) return false;
    if (user.user_type === 'super_admin') return true;
    const perm = user.permissions?.['hr.expense'];
    if (perm?.can_approve) return true;
    // Tenant-level fallback — keeps the action usable on installs where the
    // hr.expense permissions row hasn't been seeded for the admin yet.
    return user.user_type === 'client_admin';
  }, [user]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get('/expense-claims', { params: { scope: 'all' } });
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Could not load claims.';
      toast.error('Load failed', msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAct = async (
    claimId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/expense-claims/${claimId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Claim status updated');
      await refresh();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  const counts = {
    all:      rows.length,
    pending:  rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  };
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const filtered = rows.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [
        r.claim_no, r.employee_name, r.employee_code,
        r.category_name, r.title, r.vendor, r.purpose,
      ].some(v => (v || '').toString().toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div className="page-content">
      <Container fluid>
        {/* Hero */}
        <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div
            style={{
              background: 'linear-gradient(135deg,#0f0c29 0%,#312e81 50%,#7c3aed 100%)',
              color: '#fff',
              padding: '18px 24px',
            }}
          >
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div className="d-flex align-items-center gap-3">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded"
                  style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.15)', fontSize: 22 }}
                >
                  <i className="ri-receipt-line" />
                </span>
                <div>
                  <h4 className="text-white fw-bold mb-0" style={{ fontSize: 18 }}>Expense Management</h4>
                  <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
                    Approve / reject claims that have cleared the manager stage
                  </small>
                </div>
              </div>
              <div className="d-flex gap-3 flex-wrap">
                {[
                  { label: 'Total',     value: counts.all,      fg: '#fff'    },
                  { label: 'Pending',   value: counts.pending,  fg: '#fcd34d' },
                  { label: 'Approved',  value: counts.approved, fg: '#86efac' },
                  { label: 'Rejected',  value: counts.rejected, fg: '#fca5a5' },
                  { label: 'Volume',    value: `₹${totalAmount.toLocaleString('en-IN')}`, fg: '#c4b5fd' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div className="fw-bold" style={{ fontSize: 18, color: s.fg }}>{s.value}</div>
                    <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {s.label}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="border-0" style={{ borderRadius: 14 }}>
          <CardBody>
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
              <div className="d-flex gap-2 flex-wrap">
                {[
                  { key: 'all'      as StatusFilter, label: 'All',      count: counts.all,      active: '#6366f1', shadow: 'rgba(99,102,241,0.32)' },
                  { key: 'pending'  as StatusFilter, label: 'Pending',  count: counts.pending,  active: '#f59e0b', shadow: 'rgba(245,158,11,0.32)' },
                  { key: 'approved' as StatusFilter, label: 'Approved', count: counts.approved, active: '#10b981', shadow: 'rgba(16,185,129,0.32)' },
                  { key: 'rejected' as StatusFilter, label: 'Rejected', count: counts.rejected, active: '#ef4444', shadow: 'rgba(239,68,68,0.32)'  },
                ].map(f => {
                  const on = filter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold"
                      style={{
                        fontSize: 11.5,
                        padding: '4px 12px',
                        background: on ? f.active : 'var(--vz-card-bg)',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: `1px solid ${on ? f.active : 'var(--vz-border-color)'}`,
                        boxShadow: on ? `0 4px 10px ${f.shadow}` : 'none',
                      }}
                    >
                      {f.label}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-pill"
                        style={{
                          minWidth: 20, height: 16, padding: '0 6px',
                          background: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          fontSize: 10, fontWeight: 700,
                        }}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="search-box" style={{ minWidth: 240 }}>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Search by claim no, employee, category…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ fontSize: 12, height: 32 }}
                />
                <i className="ri-search-line search-icon" style={{ fontSize: 12 }} />
              </div>
            </div>

            <ExpenseClaimsTable
              rows={filtered}
              loading={loading}
              mode="hr"
              canHrApprove={canHrApprove}
              currentEmployeeId={user?.employee_id ?? null}
              onAct={onAct}
            />

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
              <small className="text-muted">
                Showing <strong className="text-body">{filtered.length}</strong> of <strong className="text-body">{rows.length}</strong> claims
              </small>
              <small className="text-muted d-inline-flex align-items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                Live data
              </small>
            </div>
          </CardBody>
        </Card>
      </Container>
    </div>
  );
}
