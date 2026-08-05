import { useEffect, useState } from 'react';
import { Card, Col, Row, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import ExpenseClaimsTable from '../../../components/ExpenseClaimsTable';
import ExpenseSettlementModal from '../../../components/ExpenseSettlementModal';
import AdvanceRequestsTable from '../../../components/AdvanceRequestsTable';
import WorklistPager from '../../../components/ui/WorklistPager';
import DraftListView from './DraftListView';
import { useToast } from '../../../contexts/ToastContext';
import { useEmployeeProfile } from '../EmployeeProfileContext';
import { draftFilesKey, deleteDraftFiles } from '../../../utils/draftFileStore';

type ExpenseFilter = 'all' | 'approved' | 'rejected' | 'pending' | 'draft';

export default function ExpenseTab() {
  const toast = useToast();
  const {
    employee, employeeId, initials, accent, authUser, isOwnProfile, canRaiseHrRequest,
    expenseModuleTab, setExpenseModuleTab, expenseSubTab, setExpenseSubTab,
    advanceSubTab, setAdvanceSubTab,
    advUsedForTab, setAdvUsedForTab, advUsedForCounts,
    expenseFilter, setExpenseFilter,
    expenseSearch, setExpenseSearch,
    expenseCounts, advanceCounts, totalClaimed,
    activeClaimsSource, filteredExpenses, filteredAdvances, activeAdvancesSource,
    apiClaims, teamClaims, apiAdvances, teamAdvances,
    loadingClaims, loadingAdvances, refreshClaims, refreshAdvances,
    actOnClaim, actOnAdvance, claimCategories, expenseDrafts, advanceDrafts,
    claimDraftKey, advanceDraftKey,
    setClaimOpen, setClaimMode, setEditingDraftId, setResumeFromDraft,
    openReimbursement,
    exportOpen, setExportOpen, runProfileExport, readSavedDrafts,
  } = useEmployeeProfile();

  // Client-side pagination — same WorklistPager (Showing X–Y of Z + rows-per-page
  // + ‹ ›) the Clients / Branches lists use. Only one module's table is mounted at
  // a time, so a single page index serves both; it resets whenever the visible set
  // changes (module, My/Team, status filter, search) so we never land past the end.
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  // Claim whose read-only payment history is open (owner/manager viewing).
  const [viewClaimId, setViewClaimId] = useState<number | null>(null);
  // Claim open in the "Review & Approve" popup (reporting-manager stage).
  const [reviewClaimId, setReviewClaimId] = useState<number | null>(null);
  // Advance equivalents — same modal, driven off the advance endpoints.
  const [viewAdvId, setViewAdvId] = useState<number | null>(null);
  const [reviewAdvId, setReviewAdvId] = useState<number | null>(null);
  // When the advance detail modal is opened via "Settle Payment", the embedded
  // Settlement section becomes an editable usage form for the owner.
  const [viewAdvSettle, setViewAdvSettle] = useState(false);
  useEffect(() => { setPage(1); }, [expenseModuleTab, expenseSubTab, advanceSubTab, advUsedForTab, expenseFilter, expenseSearch]);

  const isAdvance   = expenseModuleTab === 'advance';
  const pagedTotal  = isAdvance ? filteredAdvances.length : filteredExpenses.length;
  const totalPages  = Math.max(1, Math.ceil(pagedTotal / pageSize));
  const safePage    = Math.min(page, totalPages);
  const pageStart   = (safePage - 1) * pageSize;
  const visibleAdvances = filteredAdvances.slice(pageStart, pageStart + pageSize);
  const visibleExpenses = filteredExpenses.slice(pageStart, pageStart + pageSize);

  return (
      <>
        <div className="ep-tab-fill">
          {/* Expense Overview hero — same shape as Evidence Vault / Payroll Summary. */}
          <Card className="mb-3 border-0 ext-hero-card">
            <div className="ext-hero">
              <div className="ep-hero-blob" />
              <Row className="align-items-center g-2 ext-hero-row">
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3 ext-hero-icon-wrap">
                    <i className="ri-wallet-3-line ext-hero-icon" />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold ext-hero-label">
                    {expenseModuleTab === 'advance' ? 'Advance Overview' : 'Expense Overview'}
                  </p>
                  <div className="text-white ext-hero-total">
                    {expenseModuleTab === 'advance' ? 'Total Requested' : 'Total Claimed'}:{' '}
                    <span className="ext-hero-amount">
                      ₹{(expenseModuleTab === 'advance'
                          // Only approved advances count toward Total Requested —
                          // pending/rejected are excluded (mirrors Total Claimed).
                          ? activeAdvancesSource
                              .filter(a => a.status === 'approved')
                              .reduce((s, a) => s + Number(a.amount || 0), 0)
                          : totalClaimed
                        ).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <small className="ext-hero-sub">
                    {expenseModuleTab === 'advance'
                      ? `${advanceCounts.all} advances · ${advanceCounts.approved} approved · ${advanceCounts.pending} pending`
                      : `${expenseCounts.all} claims · ${expenseCounts.approved} approved · ${expenseCounts.pending} pending`}
                  </small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {(() => {
                      const c = expenseModuleTab === 'advance' ? advanceCounts : expenseCounts;
                      return [
                        { key: 'all'      as const, label: 'Total',    value: c.all,      color: '#fff'    },
                        { key: 'approved' as ExpenseFilter, label: 'Approved', value: c.approved, color: '#86efac' },
                        { key: 'pending'  as ExpenseFilter, label: 'Pending',  value: c.pending,  color: '#fcd34d' },
                        { key: 'rejected' as ExpenseFilter, label: 'Rejected', value: c.rejected, color: '#fca5a5' },
                      ];
                    })().map(c => {
                      // Tiles double as filter toggles — clicking "Approved"
                      // narrows the table to approved rows; clicking the
                      // already-active tile (or Total) restores All.
                      const on = expenseFilter === c.key;
                      return (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => setExpenseFilter(on && c.key !== 'all' ? 'all' : c.key)}
                          className="text-center border-0 ext-tile"
                          style={{
                            ['--ext-tile-bg' as any]: on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)',
                            ['--ext-tile-outline' as any]: on ? '1px solid rgba(255,255,255,0.45)' : '1px solid rgba(255,255,255,0.18)',
                          }}
                        >
                          <p className="mb-0 text-uppercase fw-semibold ext-tile-label">{c.label}</p>
                          <div className="fw-bold lh-1 ext-tile-value" style={{ ['--ext-tile-color' as any]: c.color }}>{c.value}</div>
                        </button>
                      );
                    })}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Expense / Advance module switcher — sits between the hero
              overview and the section card so the user can flip between
              Expense Claims and Advance Requests without leaving the
              Expense Details tab. */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div className="d-flex ext-switcher">
                {[
                  { key: 'expense' as const, label: 'Expense Claims',    icon: 'ri-file-list-3-line',         activeBg: 'linear-gradient(135deg,#a855f7,#c084fc)', shadow: 'rgba(168,85,247,0.22)' },
                  { key: 'advance' as const, label: 'Advance Requests',  icon: 'ri-money-dollar-circle-line', activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                ].map(t => {
                  const on = expenseModuleTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setExpenseModuleTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold ext-switcher-btn"
                      style={{
                        ['--ext-sw-bg' as any]: on ? t.activeBg : 'transparent',
                        ['--ext-sw-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        ['--ext-sw-shadow' as any]: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={`${t.icon} ext-switcher-icon`} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {/* Section card — header copy + counts swap based on the
              active module so the rest of the layout (search, Export,
              Raise New Claim, table) stays consistent. */}
          <div
            className="ep-section-card-flat ep-section-card mb-3 ext-section-card"
            style={{ ['--ext-section-border-top' as any]: expenseModuleTab === 'expense' ? '3px solid #a855f7' : '3px solid #4338ca' }}
          >
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap ext-section-header"
              style={{
                ['--ext-section-header-border' as any]: expenseModuleTab === 'expense'
                  ? '1px solid rgba(168,85,247,0.18)'
                  : '1px solid rgba(67,56,202,0.18)',
                ['--ext-section-header-bg' as any]: expenseModuleTab === 'expense'
                  ? 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)'
                  : 'linear-gradient(135deg, rgba(67,56,202,0.14) 0%, rgba(67,56,202,0.04) 60%, rgba(67,56,202,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon ext-section-icon" style={{
                  ['--ext-section-icon-bg' as any]: expenseModuleTab === 'expense' ? 'rgba(168,85,247,0.18)' : 'rgba(67,56,202,0.18)',
                  ['--ext-section-icon-color' as any]: expenseModuleTab === 'expense' ? '#7c3aed' : '#4338ca',
                }}>
                  <i className={expenseModuleTab === 'expense' ? 'ri-file-list-3-line' : 'ri-money-dollar-circle-line'} />
                </span>
                <div>
                  <h6 className="mb-0 fw-bold ext-section-title">
                    {expenseModuleTab === 'expense' ? 'Expense Claims' : 'Advance Requests'}
                  </h6>
                  <small className="text-muted ext-section-sub">
                    {expenseModuleTab === 'expense'
                      ? `${expenseCounts.all} total · ${expenseCounts.approved} approved · ${expenseCounts.pending} pending`
                      : `${apiAdvances.length} total · ${apiAdvances.filter(a => a.status === 'approved').length} approved · ${apiAdvances.filter(a => a.status === 'pending').length} pending`}
                  </small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="search-box ep-exp-search ext-search">
                  <input
                    type="text"
                    className="form-control form-control-sm ext-search-input"
                    placeholder="Search…"
                    value={expenseSearch}
                    onChange={e => setExpenseSearch(e.target.value)}
                  />
                  <i className="ri-search-line search-icon ext-search-icon" />
                </div>
                {/* Export — opens a format picker (Excel / PDF / CSV) and
                    exports the active module's filtered rows. Was previously
                    a dead button with no handler. */}
                <Dropdown isOpen={exportOpen} toggle={() => setExportOpen(o => !o)}>
                  <DropdownToggle
                    tag="button"
                    type="button"
                    caret={false}
                    className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1 ext-export-toggle"
                  >
                    <i className="ri-download-2-line" /> Export
                    <i className="ri-arrow-down-s-line" />
                  </DropdownToggle>
                  <DropdownMenu end>
                    <DropdownItem header>Download as</DropdownItem>
                    <DropdownItem onClick={() => runProfileExport('xlsx')}>
                      <i className="ri-file-excel-2-line me-2 text-success" />Excel (.xlsx)
                    </DropdownItem>
                    <DropdownItem onClick={() => runProfileExport('csv')}>
                      <i className="ri-file-text-line me-2 text-primary" />CSV (.csv)
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
                {/* Raise New Claim — inline styles can't carry :hover, so
                    we drive the brightening + lift via mouse handlers.
                    Hidden until the employee's own onboarding is complete
                    (CBC #85); the server rejects the POST either way. */}
                {canRaiseHrRequest && (
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1 ext-new-claim"
                  onMouseEnter={e => {
                    const t = e.currentTarget;
                    t.style.transform = 'translateY(-1px)';
                    t.style.boxShadow = '0 6px 14px rgba(249,115,22,0.45)';
                    t.style.filter = 'brightness(1.06)';
                  }}
                  onMouseLeave={e => {
                    const t = e.currentTarget;
                    t.style.transform = 'translateY(0)';
                    t.style.boxShadow = '0 4px 10px rgba(249,115,22,0.28)';
                    t.style.filter = 'none';
                  }}
                  onClick={() => {
                    // Open the unified modal in the right mode based on
                    // which list is currently visible.
                    setClaimMode(expenseModuleTab === 'advance' ? 'advance' : 'expense');
                    setClaimOpen(true);
                  }}
                >
                  <i className="ri-add-line" /> {expenseModuleTab === 'advance' ? 'New Advance Request' : 'Raise New Claim'}
                </button>
                )}
              </div>
            </div>
            <div className="px-3 pb-3 pt-2">
              {/* My / Team sub-tabs — only render when the current user is
                  viewing their own profile AND has a team (i.e. is someone's
                  reporting manager). For everyone else the table behaves as
                  a single-list view (the user's own claims/advances). The
                  labels, counts and active-state mirror whichever module
                  (Expense Claims vs Advance Requests) is currently open. */}
              {/* Visible whenever the user is a manager in *either* module —
                  approved/rejected rows stay in teamClaims/teamAdvances
                  (backend returns every row where manager_id = current user
                  regardless of status), so this toggle keeps the historic
                  track visible after the manager has acted. */}
              {isOwnProfile && (teamClaims.length > 0 || teamAdvances.length > 0) && (
                <div className="d-flex gap-1 mb-3 ext-subtab-wrap">
                  {(expenseModuleTab === 'advance'
                    ? [
                        { key: 'mine' as const, label: 'My Advances',   icon: 'ri-user-line', count: apiAdvances.length },
                        { key: 'team' as const, label: 'Team Advances', icon: 'ri-team-line', count: teamAdvances.length },
                      ]
                    : [
                        { key: 'mine' as const, label: 'My Expenses',   icon: 'ri-user-line', count: apiClaims.length },
                        { key: 'team' as const, label: 'Team Expenses', icon: 'ri-team-line', count: teamClaims.length },
                      ]
                  ).map(t => {
                    const currentSub = expenseModuleTab === 'advance' ? advanceSubTab : expenseSubTab;
                    const on = currentSub === t.key;
                    const activeAccent = expenseModuleTab === 'advance' ? '#4338ca' : '#7c3aed';
                    const activeWash   = expenseModuleTab === 'advance' ? 'rgba(67,56,202,0.12)' : 'rgba(124,58,237,0.12)';
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          if (expenseModuleTab === 'advance') setAdvanceSubTab(t.key);
                          else                                setExpenseSubTab(t.key);
                        }}
                        className="d-inline-flex align-items-center gap-2 fw-semibold ext-subtab"
                        style={{
                          ['--ext-subtab-bg' as any]: on ? 'var(--vz-card-bg)' : 'transparent',
                          ['--ext-subtab-color' as any]: on ? activeAccent : 'var(--vz-secondary-color)',
                          ['--ext-subtab-shadow' as any]: on ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                        }}
                      >
                        <i className={t.icon} />
                        {t.label}
                        <span
                          className="d-inline-flex align-items-center justify-content-center rounded-pill ext-subtab-count"
                          style={{
                            ['--ext-subtab-count-bg' as any]: on ? activeWash : 'var(--vz-secondary-bg)',
                            ['--ext-subtab-count-color' as any]: on ? activeAccent : 'var(--vz-secondary-color)',
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Used-For tabs — Advance Requests only. Narrows the list by
                  used_for (Self used / Company used) before the status pills. */}
              {expenseModuleTab === 'advance' && (
                <div className="d-flex gap-2 flex-wrap mb-3">
                  {[
                    { key: 'self'    as const, label: 'Self Used',    count: advUsedForCounts.self,    active: '#0ea5e9', shadow: 'rgba(14,165,233,0.32)' },
                    { key: 'company' as const, label: 'Company Used', count: advUsedForCounts.company, active: '#8b5cf6', shadow: 'rgba(139,92,246,0.32)' },
                  ].map(f => {
                    const on = advUsedForTab === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => { setAdvUsedForTab(f.key); setExpenseFilter('all'); }}
                        className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold ext-filter-pill"
                        style={{
                          ['--ext-pill-bg' as any]: on ? f.active : 'var(--vz-card-bg)',
                          ['--ext-pill-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                          ['--ext-pill-border' as any]: on ? f.active : 'var(--vz-border-color)',
                          ['--ext-pill-shadow' as any]: on ? `0 4px 10px ${f.shadow}` : 'none',
                        }}
                      >
                        {f.label}
                        <span
                          className="d-inline-flex align-items-center justify-content-center rounded-pill ext-filter-count"
                          style={{
                            ['--ext-pill-count-bg' as any]: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                            ['--ext-pill-count-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                          }}
                        >
                          {f.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Filter pills — active = solid filled with colored shadow for
                  strong visibility; inactive = subtle white with border. When
                  the Advance Requests module is active the same pills drive
                  filtering against `advanceCounts` instead of `expenseCounts`.
                  The Drafts pill is appended only when a saved-draft exists
                  in localStorage for the active module — clicking it swaps
                  the table area for a list of resumable drafts. */}
              <div className="d-flex gap-2 flex-wrap mb-3">
                {(() => {
                  const c = expenseModuleTab === 'advance' ? advanceCounts : expenseCounts;
                  const draftCount = expenseModuleTab === 'advance'
                    ? advanceDrafts.length
                    : expenseDrafts.length;
                  const base = [
                    { key: 'all'      as ExpenseFilter, label: 'All',      count: c.all,      active: '#6366f1', shadow: 'rgba(99,102,241,0.32)' },
                    { key: 'approved' as ExpenseFilter, label: 'Approved', count: c.approved, active: '#10b981', shadow: 'rgba(16,185,129,0.32)' },
                    { key: 'rejected' as ExpenseFilter, label: 'Rejected', count: c.rejected, active: '#ef4444', shadow: 'rgba(239,68,68,0.32)'  },
                    { key: 'pending'  as ExpenseFilter, label: 'Pending',  count: c.pending,  active: '#f59e0b', shadow: 'rgba(245,158,11,0.32)' },
                  ];
                  if (draftCount > 0) {
                    base.push({ key: 'draft' as ExpenseFilter, label: 'Drafts', count: draftCount, active: '#0ea5e9', shadow: 'rgba(14,165,233,0.32)' });
                  }
                  return base;
                })().map(f => {
                  const on = expenseFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setExpenseFilter(f.key)}
                      className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold ext-filter-pill"
                      style={{
                        ['--ext-pill-bg' as any]: on ? f.active : 'var(--vz-card-bg)',
                        ['--ext-pill-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        ['--ext-pill-border' as any]: on ? f.active : 'var(--vz-border-color)',
                        ['--ext-pill-shadow' as any]: on ? `0 4px 10px ${f.shadow}` : 'none',
                      }}
                    >
                      {f.label}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-pill ext-filter-count"
                        style={{
                          ['--ext-pill-count-bg' as any]: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                          ['--ext-pill-count-color' as any]: on ? '#fff' : 'var(--vz-secondary-color)',
                        }}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {expenseFilter === 'draft' ? (
                <DraftListView
                  module={expenseModuleTab}
                  expenseEntries={expenseDrafts}
                  advanceEntries={advanceDrafts}
                  claimCategories={claimCategories}
                  onResume={(draftId) => {
                    // Same onboarding gate as the Raise CTA above — resuming a
                    // draft leads to the same blocked submission.
                    if (!canRaiseHrRequest) {
                      toast.error('Onboarding incomplete', 'You can submit this once your onboarding is complete.');
                      return;
                    }
                    setClaimMode(expenseModuleTab === 'advance' ? 'advance' : 'expense');
                    setEditingDraftId(draftId);
                    setResumeFromDraft(true);
                    setClaimOpen(true);
                  }}
                  onDiscard={(draftId) => {
                    try {
                      if (expenseModuleTab === 'advance') {
                        const next = advanceDrafts.filter(e => e.id !== draftId);
                        if (next.length) localStorage.setItem(advanceDraftKey, JSON.stringify(next));
                        else             localStorage.removeItem(advanceDraftKey);
                        void deleteDraftFiles(draftFilesKey(advanceDraftKey, draftId));
                      } else {
                        const next = expenseDrafts.filter(e => e.id !== draftId);
                        if (next.length) localStorage.setItem(claimDraftKey, JSON.stringify(next));
                        else             localStorage.removeItem(claimDraftKey);
                        void deleteDraftFiles(draftFilesKey(claimDraftKey, draftId));
                      }
                    } catch { /* ignore */ }
                    readSavedDrafts();
                    toast.success('Draft discarded', 'The saved draft has been removed.');
                  }}
                />
              ) : expenseModuleTab === 'advance' ? (
                <AdvanceRequestsTable
                  rows={visibleAdvances}
                  loading={loadingAdvances}
                  accent={accent}
                  fallbackInitials={initials}
                  fallbackName={employee?.name || employeeId}
                  mode={advanceSubTab === 'team' ? 'team' : 'mine'}
                  currentEmployeeId={authUser?.employee_id ?? null}
                  usedFor={advUsedForTab}
                  onAct={actOnAdvance}
                  onViewPayments={(a) => { setViewAdvSettle(false); setViewAdvId(a.id); }}
                  onReview={(a) => setReviewAdvId(a.id)}
                  onSettle={(a) => { setViewAdvSettle(true); setViewAdvId(a.id); }}
                  onRaiseReimbursement={(a) => openReimbursement({ advanceId: a.id, balance: a.settle_balance ?? 0, advanceNo: a.advance_no || `ADV-${a.id}` })}
                />
              ) : (
                <ExpenseClaimsTable
                  rows={visibleExpenses}
                  loading={loadingClaims}
                  accent={accent}
                  fallbackInitials={initials}
                  fallbackName={employee?.name || employeeId}
                  mode={expenseSubTab === 'team' ? 'team' : 'mine'}
                  currentEmployeeId={authUser?.employee_id ?? null}
                  onAct={actOnClaim}
                  onViewPayments={(c) => setViewClaimId(c.id)}
                  onReview={(c) => setReviewClaimId(c.id)}
                />
              )}

              {/* Pagination — the shared WorklistPager, same as the Clients /
                  Branches lists. It carries the "Showing X–Y of Z" count that
                  used to live in the footer below. Drafts are a short resumable
                  list rendered by DraftListView, so they stay unpaged and keep
                  the plain bordered footer. */}
              {expenseFilter !== 'draft' && (
                <WorklistPager
                  total={pagedTotal}
                  page={safePage}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={(n) => { setPageSize(n); setPage(1); }}
                />
              )}

              <div className={`d-flex justify-content-end align-items-center flex-wrap gap-2 ${expenseFilter === 'draft' ? 'mt-3 pt-2 border-top' : 'mt-2'}`}>
                <small className="text-muted d-inline-flex align-items-center gap-1">
                  <span className="ext-status-dot" />
                  Last updated: Apr 2026
                </small>
              </div>
            </div>
          </div>
        </div>

        {/* Read-only payment history for the claim owner / manager. */}
        <ExpenseSettlementModal
          claimId={viewClaimId}
          readOnly
          onClose={() => setViewClaimId(null)}
          onDone={refreshClaims}
        />

        {/* Review & Approve (reporting-manager stage) — view-only, approve/reject. */}
        <ExpenseSettlementModal
          claimId={reviewClaimId}
          review
          onClose={() => setReviewClaimId(null)}
          onDone={refreshClaims}
        />

        {/* Advance equivalents — SAME modal on the advance endpoints. The detail
            modal carries the embedded Settlement section; `allowSettle` turns it
            into the editable usage form when opened via "Settle Payment". */}
        <ExpenseSettlementModal
          claimId={viewAdvId}
          basePath="/advance-requests"
          kind="advance"
          readOnly
          allowSettle={viewAdvSettle}
          onClose={() => { setViewAdvId(null); setViewAdvSettle(false); }}
          onDone={refreshAdvances}
          onRaiseReimbursement={(info) => { setViewAdvId(null); setViewAdvSettle(false); openReimbursement(info); }}
        />
        <ExpenseSettlementModal
          claimId={reviewAdvId}
          basePath="/advance-requests"
          kind="advance"
          review
          onClose={() => setReviewAdvId(null)}
          onDone={refreshAdvances}
        />
      </>
  );
}
