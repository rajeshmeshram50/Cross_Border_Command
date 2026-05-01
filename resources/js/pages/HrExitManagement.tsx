import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, Input } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';
import '../../css/recruitment.css';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ExitStatus = 'Active' | 'Exit In Progress' | 'Exited' | 'Missing Details';
type DesigLevel = 'all' | 'hod' | 'lead' | 'exec' | 'employee' | 'intern';
type EmpType    = 'all' | 'it' | 'nonit';
type RoleOwner  = 'hr' | 'it' | 'fin' | 'mgr';

interface EmployeeRow {
  id: number;
  empId: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
  managerName: string;
  managerInitials: string;
  managerAccent: string;
  exitReadiness: number;          // 0–100
  status: ExitStatus;
}

interface ChecklistItem {
  name: string;
  sub: string;
  owner: RoleOwner;
  desig: DesigLevel[] | 'all';    // designations this item applies to
  type: EmpType;                  // 'all' | 'it' | 'nonit'
  tag?: string;                   // optional badge text (ALL / HOD / TL / Intern / IT …)
}

interface ChecklistStage {
  num: number;
  title: string;
  items: ChecklistItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HrExitManagement — page component
// ─────────────────────────────────────────────────────────────────────────────
export default function HrExitManagement() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [tab, setTab]             = useState<'active' | 'in-progress' | 'exited'>('active');
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(10);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // Currently-processing employee for the 7-stage Exit Process modal.
  const [processing, setProcessing] = useState<EmployeeRow | null>(null);
  // Evidence Vault — opens for an Exited employee to view all archived docs.
  const [vault, setVault] = useState<EmployeeRow | null>(null);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    // ── DUMMY DATA — remove this when the `/exit/employees` API is wired
    //    up and replace with `api.get('/exit/employees')`. ─────────────
    setEmployees(buildDummyEmployees());
    /* Real API call — restore when backend is ready
    api.get('/exit/employees').then(({ data }) => setEmployees(Array.isArray(data) ? data : []));
    */
  }, []);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [tab, search, deptFilter, statusFilter]);

  // ── Counts derived from full list (KPI strip + tab badges) ──────────────
  const counts = useMemo(() => {
    const total       = employees.length;
    const active      = employees.filter(e => e.status === 'Active').length;
    const inProgress  = employees.filter(e => e.status === 'Exit In Progress').length;
    const exited      = employees.filter(e => e.status === 'Exited').length;
    const missing     = employees.filter(e => e.status === 'Missing Details').length;
    return { total, active, inProgress, exited, missing };
  }, [employees]);

  // ── Filter pipeline ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees
      .filter(e => {
        if (tab === 'active')      return e.status === 'Active' || e.status === 'Missing Details';
        if (tab === 'in-progress') return e.status === 'Exit In Progress';
        if (tab === 'exited')      return e.status === 'Exited';
        return true;
      })
      .filter(e => deptFilter === 'All' || e.department === deptFilter)
      .filter(e => statusFilter === 'All' || e.status === statusFilter)
      .filter(e => {
        if (!needle) return true;
        return (
          e.name.toLowerCase().includes(needle) ||
          e.empId.toLowerCase().includes(needle) ||
          e.department.toLowerCase().includes(needle) ||
          e.designation.toLowerCase().includes(needle)
        );
      });
  }, [employees, tab, search, deptFilter, statusFilter]);

  // ── Pagination slice ────────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  // Distinct department list for the filter
  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department))).sort(),
    [employees]
  );

  // ── KPI tile config ─────────────────────────────────────────────────────
  const KPI_CARDS = [
    { key: 'total',      label: 'Total Employees',     value: counts.total,      icon: 'ri-team-line',          gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'active',     label: 'Active Employees',    value: counts.active,     icon: 'ri-user-line',          gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'inProgress', label: 'Exit in Progress',    value: counts.inProgress, icon: 'ri-time-line',          gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'exited',     label: 'Exited Employees',    value: counts.exited,     icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'missing',    label: 'Missing Exit Details',value: counts.missing,    icon: 'ri-error-warning-line', gradient: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
  ];

  // ── Status pill tones (table cell) ──────────────────────────────────────
  const STATUS_TONES: Record<ExitStatus, { bg: string; fg: string; dot: string }> = {
    'Active':           { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
    'Exit In Progress': { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
    'Exited':           { bg: '#e5e7eb', fg: '#374151', dot: '#6b7280' },
    'Missing Details':  { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' },
  };

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* ── Header ── */}
            <div className="exit-page-head">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span className="exit-head-icon">
                  <i className="ri-logout-box-r-line" />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Exit Management Hub</h5>
                    <span className="exit-head-badge">
                      <span className="dot" />Active
                    </span>
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Track active employees, ongoing exit cases, and completed employee exits
                  </div>
                </div>
              </div>
              <button type="button" className="exit-checklist-btn" onClick={() => setChecklistOpen(true)}>
                <i className="ri-clipboard-line" />Exit Checklist
              </button>
            </div>

            {/* ── KPI strip — CSS grid so 5 cards fit cleanly across at xl,
                 reflow to 3 / 2 / 1 at smaller breakpoints. ── */}
            <div className="exit-kpi-grid mb-2 rec-page-kpis">
              {KPI_CARDS.map(k => (
                <div key={k.key} className="rec-kpi-card">
                  <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                  <div className="rec-kpi-text">
                    <span className="rec-kpi-label">{k.label}</span>
                    <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value}</span>
                  </div>
                  <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                    <i className={k.icon} />
                  </span>
                </div>
              ))}
            </div>

            {/* ── Tabs ── */}
            <div className="rec-tab-track mb-2">
              {([
                { key: 'active' as const,      label: 'Active Employees',  count: counts.active + counts.missing, icon: 'ri-user-line',           variant: 'in-progress' },
                { key: 'in-progress' as const, label: 'Exit In Progress',  count: counts.inProgress,             icon: 'ri-time-line',            variant: 'in-progress' },
                { key: 'exited' as const,      label: 'Exited Employees',  count: counts.exited,                 icon: 'ri-checkbox-circle-line', variant: 'completed' },
              ]).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rec-tab ${tab === t.key ? `is-active ${t.variant}` : ''}`}
                >
                  <i className={t.icon} />
                  {t.label}
                  <span className="badge">{t.count}</span>
                </button>
              ))}
            </div>

            {/* ── Search + Filter + Table — inside ONE card frame ── */}
            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input type="text" className="form-control" placeholder="Search name, ID, department…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Department</span>
                    <div style={{ minWidth: 150 }}>
                      <MasterSelect
                        value={deptFilter}
                        onChange={setDeptFilter}
                        options={[{ value: 'All', label: 'All' }, ...departments.map(d => ({ value: d, label: d }))]}
                        placeholder="All"
                      />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Status</span>
                    <div style={{ minWidth: 160 }}>
                      <MasterSelect
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                          { value: 'All', label: 'All' },
                          { value: 'Active', label: 'Active' },
                          { value: 'Exit In Progress', label: 'Exit In Progress' },
                          { value: 'Exited', label: 'Exited' },
                          { value: 'Missing Details', label: 'Missing Details' },
                        ]}
                        placeholder="All"
                      />
                    </div>
                    <span className="cand-result-chip ms-auto">
                      <i className="ri-filter-3-line" />
                      {filtered.length} result{filtered.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="rec-list-scroll">
                    <table className="rec-list-table cand-page-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Emp ID</th>
                          <th>Department</th>
                          <th>Designation</th>
                          <th>Primary Role</th>
                          <th>Ancillary Role</th>
                          <th>Rep. Manager</th>
                          <th>Exit Readiness</th>
                          <th>Status</th>
                          <th className="text-center pe-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="text-center py-5 text-muted">
                              <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                              No employees match your filters
                            </td>
                          </tr>
                        ) : visible.map((e) => {
                          const tone = STATUS_TONES[e.status];
                          const isExited = e.status === 'Exited';
                          const isInProgress = e.status === 'Exit In Progress';
                          return (
                            <tr key={e.id}>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                    style={{ width: 26, height: 26, fontSize: 10.5, background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)` }}>
                                    {e.initials}
                                  </div>
                                  <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
                                    <span className="fw-bold fs-13">{e.name}</span>
                                    <span className="text-muted" style={{ fontSize: 10.5, fontWeight: 500 }}>
                                      {e.status === 'Active' ? 'Active' : e.status === 'Exit In Progress' ? 'In Progress' : e.status === 'Exited' ? 'Exited' : 'Action Needed'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td><span className="rec-id-pill">{e.empId}</span></td>
                              <td className="fs-13">{e.department}</td>
                              <td className="fs-13">{e.designation}</td>
                              <td><span className="exit-role-chip exit-role-chip--primary">{e.primaryRole}</span></td>
                              <td><span className="exit-role-chip exit-role-chip--ancillary">{e.ancillaryRole}</span></td>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                    style={{ width: 22, height: 22, fontSize: 9, background: `linear-gradient(135deg, ${e.managerAccent}, ${e.managerAccent}cc)` }}>
                                    {e.managerInitials}
                                  </div>
                                  <span className="fs-13">{e.managerName}</span>
                                </div>
                              </td>
                              <td>
                                {(() => {
                                  // Tier-based colour pair (dark → light). Bar uses a horizontal
                                  // gradient between the two with a diagonal stripe overlay, and a
                                  // circular badge with the percent floats above the fill end —
                                  // same pattern as Profile % on the Employees page so the visuals
                                  // stay consistent across HR modules.
                                  const p = e.exitReadiness;
                                  const TIER = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                                            : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                                            : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                                            :           { dark: '#f06548', light: '#fda192' };
                                  const badgeLeft = Math.max(11, Math.min(89, p));
                                  return (
                                    <div
                                      style={{ position: 'relative', width: 120, paddingTop: 30 }}
                                      title={`Exit readiness ${p}%`}
                                    >
                                      {/* Floating badge + downward pointer */}
                                      <div
                                        style={{
                                          position: 'absolute',
                                          top: 0,
                                          left: `${badgeLeft}%`,
                                          transform: 'translateX(-50%)',
                                          textAlign: 'center',
                                        }}
                                      >
                                        <div
                                          className="d-flex align-items-center justify-content-center fw-bold"
                                          style={{
                                            width: 26, height: 26, borderRadius: '50%',
                                            background: `linear-gradient(135deg, ${TIER.dark}, ${TIER.light})`,
                                            color: '#fff', fontSize: 9.5,
                                            boxShadow: `0 4px 10px ${TIER.dark}55`,
                                          }}
                                        >
                                          {p}%
                                        </div>
                                        <div
                                          style={{
                                            width: 0, height: 0, margin: '0 auto',
                                            borderLeft: '4px solid transparent',
                                            borderRight: '4px solid transparent',
                                            borderTop: `5px solid ${TIER.dark}`,
                                          }}
                                        />
                                      </div>

                                      {/* Track + striped fill */}
                                      <div
                                        style={{
                                          width: '100%', height: 8,
                                          borderRadius: 999,
                                          background: '#e5e7eb',
                                          overflow: 'hidden',
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: `${p}%`, height: '100%',
                                            borderRadius: 999,
                                            background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${TIER.dark}, ${TIER.light})`,
                                            transition: 'width .25s ease',
                                          }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                              <td>
                                <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: tone.bg, color: tone.fg }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
                                  {e.status}
                                </span>
                              </td>
                              <td className="text-center pe-3">
                                {isExited ? (
                                  <button type="button" className="exit-action-btn exit-action-btn--vault" title="Open evidence vault" onClick={() => setVault(e)}>
                                    <i className="ri-shield-check-line" />Evidence Vault
                                  </button>
                                ) : isInProgress ? (
                                  <button type="button" className="exit-action-btn exit-action-btn--continue" title="Continue exit process" onClick={() => setProcessing(e)}>
                                    <i className="ri-arrow-right-line" />Continue
                                  </button>
                                ) : (
                                  <button type="button" className="exit-action-btn exit-action-btn--initiate" title="Initiate exit process" onClick={() => setProcessing(e)}>
                                    <i className="ri-logout-box-r-line" />Initiate Exit
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination footer */}
                  <div className="rec-list-footer">
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
                      <div style={{ width: 80 }}>
                        <MasterSelect
                          value={String(pageSize)}
                          onChange={(v) => { setPageSize(Number(v) || 10); setPage(1); }}
                          options={['10', '25', '50'].map(v => ({ value: v, label: v }))}
                          placeholder="10"
                        />
                      </div>
                      <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
                        Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>‹ Prev</button>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <button
                          key={i}
                          className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                          onClick={() => goto(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>Next ›</button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <ExitChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
      <ExitProcessModal employee={processing} onClose={() => setProcessing(null)} />
      <EvidenceVaultModal employee={vault} onClose={() => setVault(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exit Process Checklist modal
// ─────────────────────────────────────────────────────────────────────────────
function ExitChecklistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [desig, setDesig] = useState<DesigLevel>('all');
  const [type, setType]   = useState<EmpType>('all');
  // Per-stage open state — Stage 1 starts open, others collapsed.
  const [openStages, setOpenStages] = useState<Record<number, boolean>>({ 1: true });

  // Reset filters and stage state every time the modal opens so the user
  // gets a fresh, predictable view.
  useEffect(() => {
    if (open) {
      setDesig('all');
      setType('all');
      setOpenStages({ 1: true });
    }
  }, [open]);

  // Filter logic — an item shows when its `desig` includes the selected
  // designation (or is 'all') AND its `type` matches the selected type
  // (or either side is 'all').
  const matches = (item: ChecklistItem) => {
    const desigOk = item.desig === 'all' || desig === 'all' || item.desig.includes(desig);
    const typeOk  = item.type === 'all' || type === 'all' || item.type === type;
    return desigOk && typeOk;
  };

  const filteredStages = useMemo(
    () => CHECKLIST_STAGES.map(s => ({
      ...s,
      visibleItems: s.items.filter(matches),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desig, type]
  );

  const totalVisible = filteredStages.reduce((acc, s) => acc + s.visibleItems.length, 0);

  const desigLabel = (() => {
    switch (desig) {
      case 'all': return 'All Levels';
      case 'hod': return 'HOD';
      case 'lead': return 'Team Leader';
      case 'exec': return 'Executive';
      case 'employee': return 'Employee';
      case 'intern': return 'Intern';
    }
  })();
  const typeLabel = (() => {
    switch (type) {
      case 'all': return 'All Types';
      case 'it': return 'IT Employee';
      case 'nonit': return 'Non-IT Employee';
    }
  })();

  const desigTabs: Array<{ key: DesigLevel; label: string; icon: string }> = [
    { key: 'all',      label: 'All Levels',         icon: 'ri-global-line' },
    { key: 'hod',      label: 'Head of Dept (HOD)', icon: 'ri-building-2-line' },
    { key: 'lead',     label: 'Team Leader',        icon: 'ri-team-line' },
    { key: 'exec',     label: 'Executive',          icon: 'ri-flashlight-line' },
    { key: 'employee', label: 'Employee',           icon: 'ri-user-line' },
    { key: 'intern',   label: 'Intern / Trainee',   icon: 'ri-graduation-cap-line' },
  ];

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" contentClassName="border-0 ecl-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="ecl-head">
          <div className="ecl-head-left">
            <span className="ecl-head-icon"><i className="ri-clipboard-line" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ecl-head-title">Exit Process Checklist</div>
              <div className="ecl-head-sub">
                6 stages · {CHECKLIST_TOTAL} checkpoints · Filtered by Designation &amp; Employee Type
              </div>

              {/* Designation Level tabs */}
              <div style={{ marginTop: 6 }}>
                <div className="ecl-head-section-label">Designation Level</div>
                <div className="ecl-desig-tabs">
                  {desigTabs.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      className={`ecl-dt${desig === t.key ? ' is-active' : ''}`}
                      onClick={() => setDesig(t.key)}
                    >
                      <i className={t.icon} />{t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Employee Type toggle */}
              <div className="ecl-type-row">
                <div className="ecl-head-section-label" style={{ marginBottom: 0 }}>Employee Type:</div>
                <div className="ecl-type-toggle">
                  {([
                    { key: 'all',   label: 'All',             icon: '' },
                    { key: 'it',    label: 'IT Employee',     icon: 'ri-computer-line' },
                    { key: 'nonit', label: 'Non-IT Employee', icon: 'ri-building-line' },
                  ] as Array<{ key: EmpType; label: string; icon: string }>).map(t => (
                    <button
                      key={t.key}
                      type="button"
                      className={`ecl-type-btn${type === t.key ? ' is-active' : ''}`}
                      onClick={() => setType(t.key)}
                    >
                      {t.icon && <i className={t.icon} />}{t.label}
                    </button>
                  ))}
                </div>
                <span className="ecl-filter-badge">{desigLabel} · {typeLabel}</span>
              </div>
            </div>
          </div>
          <button type="button" className="ecl-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Info bar */}
        <div className="ecl-info-bar">
          <div className="ecl-info-msg">
            <i className="ri-information-line" />
            Reference guideline — checkpoints shown based on selected designation &amp; employee type.
          </div>
          <div className="ecl-role-tags">
            <span className="ecl-role-tag ecl-role-tag--hr"><i className="ri-user-line" />HR</span>
            <span className="ecl-role-tag ecl-role-tag--it"><i className="ri-computer-line" />IT</span>
            <span className="ecl-role-tag ecl-role-tag--fin"><i className="ri-money-dollar-circle-line" />Finance</span>
            <span className="ecl-role-tag ecl-role-tag--mgr"><i className="ri-briefcase-4-line" />Manager</span>
          </div>
        </div>

        {/* Body */}
        <div className="ecl-body">
          {filteredStages.map(stage => {
            const isOpen = !!openStages[stage.num];
            return (
              <div key={stage.num} className={`ecl-stage${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="ecl-stage-header"
                  onClick={() => setOpenStages(s => ({ ...s, [stage.num]: !s[stage.num] }))}
                >
                  <span className="ecl-stage-num">{stage.num}</span>
                  <span className="ecl-stage-title">Stage {stage.num} — {stage.title}</span>
                  <span className="ecl-stage-count">{stage.visibleItems.length} steps</span>
                  <i className="ri-arrow-down-s-line ecl-stage-chevron" />
                </button>
                {isOpen && (
                  <div className="ecl-steps">
                    {stage.visibleItems.length === 0 ? (
                      <div className="ecl-empty">No checkpoints for the selected filters</div>
                    ) : stage.visibleItems.map((item, idx) => (
                      <div key={idx} className="ecl-item">
                        <span className={`ecl-step-dot ecl-step-dot--${item.owner}`} />
                        <div className="ecl-step-info">
                          <div className="ecl-step-name">
                            {item.name}
                            {item.tag && <span className={`ecl-dtag ecl-dtag--${item.tag.toLowerCase().replace(/[^a-z]/g, '')}`}>{item.tag}</span>}
                          </div>
                          <div className="ecl-step-sub">{item.sub}</div>
                        </div>
                        <span className={`ecl-step-owner ecl-step-owner--${item.owner}`}>
                          {OWNER_LABEL[item.owner]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="ecl-footer">
          <div className="ecl-footer-note">
            <i className="ri-shield-check-line" />
            {desigLabel} · {typeLabel} · <strong>{totalVisible}</strong> checkpoints visible
          </div>
          <button type="button" className="ecl-close-action" onClick={onClose}>
            <i className="ri-check-line" />Close
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

const OWNER_LABEL: Record<RoleOwner, string> = {
  hr: 'HR',
  it: 'IT',
  fin: 'Finance',
  mgr: 'Manager',
};

// ─────────────────────────────────────────────────────────────────────────────
// Employee Exit Process modal — 7-stage wizard
// ─────────────────────────────────────────────────────────────────────────────
type StageStatus = 'Completed' | 'In Progress' | 'Pending';

const EXIT_STAGES = [
  { num: 1, title: 'Exit Initiation & Approval',         short: 'Exit Initiation & Approval',         sub: 'Record exit details, reason, dates, and collect approvals.', icon: 'ri-clipboard-line' },
  { num: 2, title: 'Notice Period Management',           short: 'Notice Period Management',           sub: 'Track notice period, attendance, KT and handover completion.', icon: 'ri-time-line' },
  { num: 3, title: 'Clearance & Handover',               short: 'Clearance & Handover',               sub: 'All departmental clearances must be approved before proceeding.', icon: 'ri-checkbox-line' },
  { num: 4, title: 'Asset Recovery & Access Revocation', short: 'Asset Recovery & Access Revocation', sub: 'Track all company assets and revoke system access.', icon: 'ri-lock-2-line' },
  { num: 5, title: 'Full & Final Settlement (FnF)',      short: 'Full & Final Settlement (FnF)',      sub: 'Calculate final settlement amount, deductions, and process payment.', icon: 'ri-money-rupee-circle-line' },
  { num: 6, title: 'Exit Documents Management',          short: 'Exit Documents Management',          sub: 'Generate each document, then track the signing workflow for every stakeholder.', icon: 'ri-file-text-line' },
  { num: 7, title: 'Final Deactivation & Closure',       short: 'Final Deactivation & Closure',       sub: 'Complete final validation, lock profile, and close the exit case.', icon: 'ri-flag-line' },
] as const;

function ExitProcessModal({ employee, onClose }: { employee: EmployeeRow | null; onClose: () => void }) {
  const [stage, setStage] = useState<number>(1);
  const [stageStatus, setStageStatus] = useState<Record<number, StageStatus>>({});

  // Form state — kept loose because this is dummy mode. When the API is
  // ready, lift these into a single payload object that the PATCH call
  // can consume.
  const [exitType, setExitType]           = useState('Resignation');
  const [initiatedBy, setInitiatedBy]     = useState('Employee');
  const [reasonForExit, setReasonForExit] = useState('Better Opportunity');
  const [noticeDate, setNoticeDate]       = useState('2026-04-23');
  const [lwd, setLwd]                     = useState('2026-05-23');
  const [reportingManager, setReportingManager] = useState('Atharv Patekar');
  const [comments, setComments]           = useState('');
  const [mgrApproval, setMgrApproval]     = useState('Pending');
  const [hrApproval, setHrApproval]       = useState('Pending');
  const [businessImpact, setBusinessImpact] = useState('Low');
  const [replacementNeeded, setReplacementNeeded] = useState('Yes — Immediate');

  // Stage 2
  const [noticePeriodDays, setNoticePeriodDays] = useState('30');
  const [daysPresent, setDaysPresent]   = useState('0');
  const [leavesAvailed, setLeavesAvailed] = useState('0');
  const [leaveBalance, setLeaveBalance] = useState('12');
  const [ktItems, setKtItems] = useState<boolean[]>([false, false, false, false]);
  const [handoverPct, setHandoverPct] = useState('0');
  const [ktSignOff, setKtSignOff] = useState('Pending');

  // Stage 3
  const [clearances, setClearances] = useState<{ checked: boolean; status: string }[]>([
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
  ]);
  const [handoverNotes, setHandoverNotes] = useState('');

  // Stage 4
  const [assets, setAssets] = useState<{ checked: boolean; status: string }[]>([
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: true,  status: 'Returned' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
  ]);
  const [accessRevoke, setAccessRevoke] = useState<string[]>(['Pending','Pending','Pending','Pending','Pending','Pending']);
  const [missingAssets, setMissingAssets] = useState('');
  const [recoveryAction, setRecoveryAction] = useState('None');

  // Stage 5
  const [financeApproval, setFinanceApproval] = useState('Pending');
  const [paymentStatus, setPaymentStatus]     = useState('Pending');
  const [paymentMode, setPaymentMode]         = useState('Bank Transfer (NEFT)');
  const [paymentDate, setPaymentDate]         = useState('');

  // Stage 6 — document generated state + accordion (one open at a time)
  const [docs, setDocs] = useState<boolean[]>([true, false, false, false, false]);
  const [expandedDoc, setExpandedDoc] = useState<number | null>(0);

  // Stage 7
  const [validation, setValidation] = useState<boolean[]>([false, false, false, false, false, false]);
  const [empStatus, setEmpStatus] = useState('Active');
  const [profileLock, setProfileLock] = useState('Unlocked');
  const [exitCaseStatus, setExitCaseStatus] = useState('Open');
  const [hrSignOff, setHrSignOff] = useState('Pending');

  // Reset everything each time the modal targets a new employee
  useEffect(() => {
    if (employee) {
      setStage(1);
      setStageStatus({ 1: 'In Progress' });
    }
    // intentionally empty deps for the rest — we only reset on target change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  if (!employee) return null;

  const statusOf = (n: number): StageStatus => stageStatus[n] || (n === stage ? 'In Progress' : 'Pending');
  const completed = Object.values(stageStatus).filter(s => s === 'Completed').length;
  const progressPct = Math.round((completed / EXIT_STAGES.length) * 100);

  const advance = () => {
    setStageStatus(prev => ({ ...prev, [stage]: 'Completed' }));
    if (stage < EXIT_STAGES.length) {
      setStage(stage + 1);
      setStageStatus(prev => ({ ...prev, [stage + 1]: 'In Progress' }));
    }
  };
  const goBack = () => {
    if (stage > 1) {
      setStage(stage - 1);
      setStageStatus(prev => ({ ...prev, [stage - 1]: 'In Progress' }));
    }
  };
  const closeAll = () => {
    setStageStatus(prev => ({ ...prev, [stage]: 'Completed' }));
    onClose();
  };

  const caseId = `EX-${employee.empId.replace(/[^0-9]/g, '')}-${(2000 + employee.id * 31 % 999).toString().padStart(4, '0')}`;
  const current = EXIT_STAGES[stage - 1];
  const isLastStage = stage === EXIT_STAGES.length;

  return (
    <Modal isOpen={!!employee} toggle={onClose} centered size="xl" backdrop="static" contentClassName="border-0 ep-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="ep-head">
          <span className="ep-head-icon"><i className="ri-logout-box-r-line" /></span>
          <div className="ep-head-text">
            <div className="ep-head-title">Employee Exit Process</div>
            <div className="ep-head-meta">
              <span className="ep-head-name">{employee.name}</span>
              <span className="rec-id-pill">{employee.empId}</span>
              <span className="rec-id-pill">{employee.department.toUpperCase()}</span>
              <span className="rec-id-pill">{caseId}</span>
            </div>
            <div className="ep-progress-mini">
              <i className="ri-checkbox-circle-line" />
              <span>Stage {stage} of {EXIT_STAGES.length}</span>
              <span className="ep-progress-mini-dot">·</span>
              <span className="ep-progress-mini-pct">{progressPct}% Complete</span>
            </div>
          </div>
          <ExitProgressDial value={progressPct} />
          <button type="button" className="ep-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="ep-body">
          {/* Sidebar */}
          <aside className="ep-sidebar">
            <div className="ep-sidebar-label"><i className="ri-list-check-2" />Exit Stages</div>
            {EXIT_STAGES.map(s => {
              const st = statusOf(s.num);
              return (
                <button
                  key={s.num}
                  type="button"
                  className={`ep-stage-card ep-stage-card--${st.toLowerCase().replace(' ', '-')}${stage === s.num ? ' is-current' : ''}`}
                  onClick={() => { setStage(s.num); setStageStatus(prev => ({ ...prev, [s.num]: prev[s.num] === 'Completed' ? 'Completed' : 'In Progress' })); }}
                >
                  <span className="ep-stage-num">
                    {st === 'Completed' ? <i className="ri-check-line" /> : s.num}
                  </span>
                  <span className="ep-stage-meta">
                    <span className="ep-stage-title">{s.short}</span>
                    <span className="ep-stage-status">{st}</span>
                  </span>
                  <i className="ri-arrow-right-s-line ep-stage-chev" />
                </button>
              );
            })}
          </aside>

          {/* Content */}
          <section className="ep-content">
            <div className="ep-stage-banner">
              <span className="ep-stage-banner-icon"><i className={current.icon} /></span>
              <div>
                <div className="ep-stage-banner-title">{current.title}</div>
                <div className="ep-stage-banner-sub">{current.sub}</div>
              </div>
            </div>

            {/* ── STAGE 1 ── */}
            {stage === 1 && (
              <>
                <div className="ep-section-label">Exit Details</div>
                <Row className="g-2 mb-2">
                  <Col md={6}><EpField label="Exit Type"><EpSelect value={exitType} onChange={setExitType} options={['Resignation','Termination','Retirement','End of Contract','Absconding']} /></EpField></Col>
                  <Col md={6}><EpField label="Initiated By"><EpSelect value={initiatedBy} onChange={setInitiatedBy} options={['Employee','HR','Manager']} /></EpField></Col>
                  <Col md={6}><EpField label="Reason for Exit"><EpSelect value={reasonForExit} onChange={setReasonForExit} options={['Better Opportunity','Personal Reasons','Higher Studies','Relocation','Health','Performance','Other']} /></EpField></Col>
                  <Col md={6}><EpField label="Notice Date"><EpInput type="date" value={noticeDate} onChange={setNoticeDate} /></EpField></Col>
                  <Col md={6}><EpField label="Last Working Day"><EpInput type="date" value={lwd} onChange={setLwd} /></EpField></Col>
                  <Col md={6}><EpField label="Reporting Manager"><EpInput value={reportingManager} onChange={setReportingManager} /></EpField></Col>
                  <Col xs={12}><EpField label="Comments / Notes"><textarea className="ep-textarea" rows={2} placeholder="Enter any additional comments…" value={comments} onChange={e => setComments(e.target.value)} /></EpField></Col>
                </Row>

                <div className="ep-section-label">Approvals</div>
                <Row className="g-2">
                  <Col md={6}><EpApprovalCard icon="ri-user-line" title="Manager Approval"><EpSelect value={mgrApproval} onChange={setMgrApproval} options={['Pending','Approved','Rejected']} /></EpApprovalCard></Col>
                  <Col md={6}><EpApprovalCard icon="ri-user-settings-line" title="HR Approval"><EpSelect value={hrApproval} onChange={setHrApproval} options={['Pending','Approved','Rejected']} /></EpApprovalCard></Col>
                  <Col md={6}><EpApprovalCard icon="ri-flashlight-line" title="Business Impact"><EpSelect value={businessImpact} onChange={setBusinessImpact} options={['Low','Medium','High','Critical']} /></EpApprovalCard></Col>
                  <Col md={6}><EpApprovalCard icon="ri-question-line" title="Replacement Required"><EpSelect value={replacementNeeded} onChange={setReplacementNeeded} options={['Yes — Immediate','Yes — Within 30 days','Yes — Within 90 days','No']} /></EpApprovalCard></Col>
                </Row>
              </>
            )}

            {/* ── STAGE 2 ── */}
            {stage === 2 && (
              <>
                <div className="ep-section-label">Notice Period Details</div>
                <Row className="g-2 mb-2">
                  <Col md={6}><EpField label="Notice Start Date"><EpInput type="date" value={noticeDate} onChange={setNoticeDate} /></EpField></Col>
                  <Col md={6}><EpField label="Last Working Day"><EpInput type="date" value={lwd} onChange={setLwd} /></EpField></Col>
                  <Col md={6}><EpField label="Remaining Days"><EpInput value={`${calcRemaining(noticeDate, lwd)} days`} onChange={() => {}} disabled /></EpField></Col>
                  <Col md={6}><EpField label="Notice Period (Days)"><EpInput type="number" value={noticePeriodDays} onChange={setNoticePeriodDays} /></EpField></Col>
                </Row>

                <div className="ep-section-label">Attendance & Leave</div>
                <Row className="g-2 mb-2">
                  <Col md={4}><EpField label="Days Present"><EpInput type="number" value={daysPresent} onChange={setDaysPresent} /></EpField></Col>
                  <Col md={4}><EpField label="Leaves Availed"><EpInput type="number" value={leavesAvailed} onChange={setLeavesAvailed} /></EpField></Col>
                  <Col md={4}><EpField label="Leave Balance"><EpInput type="number" value={leaveBalance} onChange={setLeaveBalance} /></EpField></Col>
                </Row>

                <div className="ep-section-label">Knowledge Transfer & Handover</div>
                <div className="ep-checklist mb-3">
                  {[
                    'KT Plan document created & shared',
                    'Daily handover sessions scheduled',
                    'KT tasks assigned to replacement/team',
                    'Manager confirmed KT completion',
                  ].map((label, idx) => (
                    <label key={idx} className="ep-check-row">
                      <input
                        type="checkbox"
                        checked={ktItems[idx]}
                        onChange={() => setKtItems(prev => prev.map((v, i) => i === idx ? !v : v))}
                      />
                      <span className="ep-check-box"><i className="ri-check-line" /></span>
                      <span className="ep-check-label">{label}</span>
                      <span className={`ep-status-pill ep-status-pill--${ktItems[idx] ? 'done' : 'pending'}`}>{ktItems[idx] ? 'Completed' : 'Pending'}</span>
                    </label>
                  ))}
                </div>

                <Row className="g-2">
                  <Col md={6}><EpField label="Handover % Complete"><EpInput type="number" value={handoverPct} onChange={setHandoverPct} /></EpField></Col>
                  <Col md={6}><EpField label="KT Sign-off by Manager"><EpSelect value={ktSignOff} onChange={setKtSignOff} options={['Pending','Approved','Rejected']} /></EpField></Col>
                </Row>

                {(Number(handoverPct) < 100 || ktSignOff !== 'Approved') && (
                  <div className="ep-alert ep-alert--warning mt-3">
                    <i className="ri-error-warning-line" />Cannot proceed until KT is 100% complete and Manager has approved handover.
                  </div>
                )}
              </>
            )}

            {/* ── STAGE 3 ── */}
            {stage === 3 && (
              <>
                <div className="ep-section-label">Clearance Status</div>
                <div className="ep-checklist mb-2">
                  {['Manager Clearance','IT Clearance','Admin Clearance','Finance Clearance','Legal / Compliance'].map((label, idx) => (
                    <div key={idx} className="ep-check-row">
                      <input
                        type="checkbox"
                        checked={clearances[idx].checked}
                        onChange={() => setClearances(prev => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked, status: !c.checked ? 'Approved' : 'Pending' } : c))}
                      />
                      <span className="ep-check-box"><i className="ri-check-line" /></span>
                      <span className="ep-check-label">{label}</span>
                      <div style={{ width: 140 }}>
                        <EpSelect
                          value={clearances[idx].status}
                          onChange={v => setClearances(prev => prev.map((c, i) => i === idx ? { ...c, status: v, checked: v === 'Approved' } : c))}
                          options={['Pending','Approved','Rejected']}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {clearances.some(c => c.status !== 'Approved') && (
                  <div className="ep-alert ep-alert--warning mb-3">
                    <i className="ri-error-warning-line" />All 5 clearances must be individually approved before advancing.
                  </div>
                )}

                <div className="ep-section-label">Handover Notes</div>
                <EpField label="Work Handover Notes">
                  <textarea
                    className="ep-textarea"
                    rows={3}
                    placeholder="List key projects, pending tasks, credentials handed over…"
                    value={handoverNotes}
                    onChange={e => setHandoverNotes(e.target.value)}
                  />
                </EpField>
              </>
            )}

            {/* ── STAGE 4 ── */}
            {stage === 4 && (
              <>
                <div className="ep-section-label">Asset Return Tracking</div>
                <div className="ep-checklist mb-3">
                  {[
                    { name: 'Laptop / MacBook',     code: 'ASSET-L042' },
                    { name: 'Company Mobile Phone', code: 'ASSET-M017' },
                    { name: 'Access Card / Key Fob',code: 'ASSET-K009' },
                    { name: 'Office Keys',           code: 'ASSET-K010' },
                    { name: 'Other Hardware',        code: '—' },
                  ].map((a, idx) => (
                    <label key={idx} className="ep-check-row">
                      <input
                        type="checkbox"
                        checked={assets[idx].checked}
                        onChange={() => setAssets(prev => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked, status: !c.checked ? 'Returned' : 'Pending' } : c))}
                      />
                      <span className="ep-check-box"><i className="ri-check-line" /></span>
                      <span className="ep-check-label">{a.name} <span className="ep-asset-code">({a.code})</span></span>
                      <span className={`ep-status-pill ep-status-pill--${assets[idx].status === 'Returned' ? 'done' : 'pending'}`}>{assets[idx].status}</span>
                    </label>
                  ))}
                </div>

                <div className="ep-section-label">Access Revocation</div>
                <div className="ep-checklist mb-3">
                  {['ERP / HRMS System Access','Company Email & Google Workspace','GitHub / Code Repositories','Slack / Teams / Communication Tools','Cloud Infrastructure (AWS/Azure)','CRM / Sales Tools'].map((label, idx) => (
                    <div key={idx} className="ep-check-row">
                      <input type="checkbox" checked={accessRevoke[idx] === 'Revoked'} onChange={() => setAccessRevoke(prev => prev.map((v, i) => i === idx ? (v === 'Revoked' ? 'Pending' : 'Revoked') : v))} />
                      <span className="ep-check-box"><i className="ri-check-line" /></span>
                      <span className="ep-check-label">{label}</span>
                      <div style={{ width: 140 }}>
                        <EpSelect
                          value={accessRevoke[idx]}
                          onChange={v => setAccessRevoke(prev => prev.map((x, i) => i === idx ? v : x))}
                          options={['Pending','Revoked','Not Applicable']}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="ep-section-label">Missing Asset Flag</div>
                <Row className="g-2">
                  <Col md={6}><EpField label="Missing Assets"><EpInput value={missingAssets} onChange={setMissingAssets} placeholder="Describe missing assets…" /></EpField></Col>
                  <Col md={6}><EpField label="Recovery Action"><EpSelect value={recoveryAction} onChange={setRecoveryAction} options={['None','Salary Deduction','Legal Notice','Written Off']} /></EpField></Col>
                </Row>
              </>
            )}

            {/* ── STAGE 5 ── */}
            {stage === 5 && (
              <>
                <div className="ep-section-label">Earnings & Deductions</div>
                <div className="ep-fnf-table mb-3">
                  <EpFnfRow label="Basic Salary (Pro-rata)"      amount="₹ 42,500" tone="earn" />
                  <EpFnfRow label="Leave Encashment (12 days)"   amount="₹ 16,000" tone="earn" />
                  <EpFnfRow label="Bonus / Incentives"           amount="₹ 8,000"  tone="earn" />
                  <EpFnfRow label="Gratuity (if applicable)"     amount="₹ 24,000" tone="earn" />
                  <EpFnfRow label="Notice Period Shortfall"      amount="- ₹ 0"    tone="ded" />
                  <EpFnfRow label="Asset Recovery Pending"       amount="- ₹ 0"    tone="ded" />
                  <EpFnfRow label="Tax (TDS)"                    amount="- ₹ 9,050" tone="ded" />
                  <EpFnfRow label="Loan / Advance Recovery"      amount="- ₹ 0"    tone="ded" />
                  <div className="ep-fnf-row ep-fnf-row--total">
                    <span>Net FnF Payable</span>
                    <span>₹ 81,450</span>
                  </div>
                </div>

                <div className="ep-section-label">Finance Approval & Payment</div>
                <Row className="g-2">
                  <Col md={6}><EpField label="Finance Controller Approval"><EpSelect value={financeApproval} onChange={setFinanceApproval} options={['Pending','Approved','Rejected']} /></EpField></Col>
                  <Col md={6}><EpField label="Payment Status"><EpSelect value={paymentStatus} onChange={setPaymentStatus} options={['Pending','Processed','On Hold']} /></EpField></Col>
                  <Col md={6}><EpField label="Payment Mode"><EpSelect value={paymentMode} onChange={setPaymentMode} options={['Bank Transfer (NEFT)','RTGS','UPI','Cheque']} /></EpField></Col>
                  <Col md={6}><EpField label="Payment Date"><EpInput type="date" value={paymentDate} onChange={setPaymentDate} /></EpField></Col>
                </Row>
              </>
            )}

            {/* ── STAGE 6 ── */}
            {stage === 6 && (() => {
              const generatedCount = docs.filter(Boolean).length;
              const docList = [
                { icon: 'ri-file-text-line',          name: 'Relieving Letter',     sub: 'Confirms last working day and relieving from duties', signers: ['HR Manager','Department Head','Employee'] },
                { icon: 'ri-graduation-cap-line',     name: 'Experience Letter',    sub: 'Details role, tenure, and performance summary',        signers: ['HR Manager','CEO / MD','Employee'] },
                { icon: 'ri-money-rupee-circle-line', name: 'FnF Settlement Sheet', sub: 'Complete breakdown of full and final payment',         signers: ['Finance Head','HR Manager','Employee'] },
                { icon: 'ri-file-shield-2-line',      name: 'NOC Certificate',      sub: 'No Objection Certificate from the organization',       signers: ['HR Manager','Department Head'] },
                { icon: 'ri-chat-3-line',             name: 'Exit Interview Form',  sub: 'Feedback captured during exit interview session',      signers: ['HR Executive','Employee'] },
              ];
              const KPIS = [
                { label: 'Total Docs',   value: docList.length,  icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
                { label: 'Generated',    value: generatedCount,  icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
                { label: 'Pending Sign', value: generatedCount,  icon: 'ri-time-line',            gradient: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
                { label: 'Completed',    value: 0,               icon: 'ri-check-double-line',    gradient: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 60%, #38bdf8 100%)', deep: '#0369a1' },
              ];
              return (
                <>
                  {/* KPI tiles — same visual language as the page-level KPIs */}
                  <div className="ep-doc-kpis rec-page-kpis mb-3">
                    {KPIS.map(k => (
                      <div key={k.label} className="rec-kpi-card">
                        <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                        <div className="rec-kpi-text">
                          <span className="rec-kpi-label">{k.label}</span>
                          <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value}</span>
                        </div>
                        <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                          <i className={k.icon} />
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="ep-section-label">Documents &amp; Signing Tracker</div>
                  <div className="ep-doc-list">
                    {docList.map((d, idx) => {
                      const isGenerated = docs[idx];
                      const isOpen = expandedDoc === idx;
                      return (
                        <div key={idx} className={`ep-doc-card${isOpen ? ' is-open' : ''}`}>
                          <button
                            type="button"
                            className="ep-doc-row"
                            onClick={() => setExpandedDoc(isOpen ? null : idx)}
                            aria-expanded={isOpen}
                          >
                            <span className="ep-doc-icon"><i className={d.icon} /></span>
                            <div className="ep-doc-info">
                              <div className="ep-doc-name">{d.name}</div>
                              <div className="ep-doc-sub">{d.sub}</div>
                            </div>
                            <span className={`ep-doc-tag ${isGenerated ? 'ep-doc-tag--pending' : 'ep-doc-tag--blank'}`}>
                              {isGenerated ? 'Generated · Pending Signatures' : 'Not Generated'}
                            </span>
                            {isGenerated ? (
                              <span className="ep-doc-btn ep-doc-btn--done" onClick={e => e.stopPropagation()}><i className="ri-check-line" />Generated</span>
                            ) : (
                              <button
                                type="button"
                                className="ep-doc-btn"
                                onClick={e => { e.stopPropagation(); setDocs(prev => prev.map((v, i) => i === idx ? true : v)); setExpandedDoc(idx); }}
                              >
                                <i className="ri-file-add-line" />Generate
                              </button>
                            )}
                            <button type="button" className="ep-doc-btn ep-doc-btn--ghost" disabled={!isGenerated} onClick={e => e.stopPropagation()}>
                              <i className="ri-eye-line" />Preview
                            </button>
                            <i className="ri-arrow-down-s-line ep-doc-chev" />
                          </button>
                          {isOpen && isGenerated && (
                            <div className="ep-signing">
                              <div className="ep-signing-head">
                                <i className="ri-shield-check-line" />Signing Workflow
                                <span className="ep-signing-pct">0% Signed</span>
                              </div>
                              <div className="ep-signing-flow">
                                {d.signers.map((sg, i) => (
                                  <div key={i} className={`ep-signer${i === 0 ? ' is-active' : ''}`}>
                                    <span className="ep-signer-dot">{i + 1}</span>
                                    <span className="ep-signer-name">{sg}</span>
                                    <span className="ep-signer-state">{i === 0 ? 'Awaiting' : 'Pending'}</span>
                                    {i === 0 && <button type="button" className="ep-signer-btn"><i className="ri-quill-pen-line" />e-Sign</button>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {isOpen && !isGenerated && (
                            <div className="ep-doc-empty">
                              <i className="ri-information-line" />
                              Generate this document first to see the signing workflow.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {/* ── STAGE 7 ── */}
            {stage === 7 && (
              <>
                <div className="ep-section-label">Final Validation Checklist</div>
                <div className="ep-checklist mb-3">
                  {[
                    { title: 'All clearances obtained',     sub: 'Manager, IT, Admin, Finance, Legal' },
                    { title: 'All assets recovered',        sub: 'Laptop, phone, access cards, keys' },
                    { title: 'All access revoked',          sub: 'ERP, Email, GitHub, Cloud, CRM' },
                    { title: 'FnF payment processed',       sub: 'Amount: ₹81,450 | Status: Pending' },
                    { title: 'Exit documents signed',       sub: 'Relieving, Experience, NOC, FnF Sheet' },
                    { title: 'Exit interview completed',    sub: 'Feedback recorded and filed' },
                  ].map((v, idx) => (
                    <label key={idx} className="ep-check-row">
                      <input type="checkbox" checked={validation[idx]} onChange={() => setValidation(prev => prev.map((x, i) => i === idx ? !x : x))} />
                      <span className="ep-check-box"><i className="ri-check-line" /></span>
                      <span className="ep-check-label" style={{ flex: 1 }}>
                        <div className="fw-bold fs-13">{v.title}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{v.sub}</div>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="ep-section-label">Final Actions</div>
                <Row className="g-2 mb-2">
                  <Col md={6}><EpField label="Employee Status"><EpSelect value={empStatus} onChange={setEmpStatus} options={['Active','Inactive','Exited']} /></EpField></Col>
                  <Col md={6}><EpField label="Profile Lock"><EpSelect value={profileLock} onChange={setProfileLock} options={['Unlocked','Locked']} /></EpField></Col>
                  <Col md={6}><EpField label="Exit Case Status"><EpSelect value={exitCaseStatus} onChange={setExitCaseStatus} options={['Open','Closed']} /></EpField></Col>
                  <Col md={6}><EpField label="HR Final Sign-off"><EpSelect value={hrSignOff} onChange={setHrSignOff} options={['Pending','Approved','Rejected']} /></EpField></Col>
                </Row>

                <div className="ep-close-case">
                  <i className="ri-flag-line" />
                  <div>
                    <div className="ep-close-case-title">Close Exit Case</div>
                    <div className="ep-close-case-sub">Click "Close &amp; Complete" to finalize and close the exit case for {employee.name}.</div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="ep-footer">
          <div className="d-flex gap-2">
            <button type="button" className="ep-btn ep-btn--ghost"><i className="ri-save-3-line" />Save Draft</button>
            <button type="button" className="ep-btn ep-btn--reject"><i className="ri-close-circle-line" />Reject</button>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="ep-btn ep-btn--approve"><i className="ri-check-line" />Approve</button>
            {stage > 1 && (
              <button type="button" className="ep-btn ep-btn--prev" onClick={goBack}><i className="ri-arrow-left-s-line" />Previous</button>
            )}
            {isLastStage ? (
              <button type="button" className="ep-btn ep-btn--complete" onClick={closeAll}><i className="ri-check-double-line" />Close &amp; Complete</button>
            ) : (
              <button type="button" className="ep-btn ep-btn--next" onClick={advance}>Next Stage<i className="ri-arrow-right-s-line" /></button>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// Circular progress dial — clean, minimal completion gauge inspired by
// modern dashboard meters. The arc is a 270° partial circle (gap at the
// bottom) with a single glowing cyan→violet stroke; an end-dot marks
// where the fill reaches. No tick clutter, no heavy inner well — just
// the arc, the percent, and a soft ambient glow.
function ExitProgressDial({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  // 270° arc spanning from 135° (bottom-left) → 405° (bottom-right).
  // Path is drawn clockwise via SVG arc commands so we can use
  // strokeDasharray + strokeDashoffset on a path the same way we would
  // on a circle.
  const RADIUS = 42;
  const ARC_LEN = (270 / 360) * (2 * Math.PI * RADIUS);
  const offset = ARC_LEN * (1 - pct / 100);
  // End-dot position — sits at the leading edge of the fill so the arc
  // looks "alive" even at low percentages.
  const startAngle = 135;
  const endAngle = startAngle + (270 * pct) / 100;
  const endRad = (endAngle * Math.PI) / 180;
  const dotX = 50 + Math.cos(endRad) * RADIUS;
  const dotY = 50 + Math.sin(endRad) * RADIUS;

  return (
    <div className="ep-dial" aria-label={`${pct}% complete`}>
      <svg width="80" height="80" viewBox="0 0 100 100">
        <defs>
          {/* Mint → emerald → vivid green — complementary to the violet
              header so the meter reads as a fresh "completion" accent
              that pops without clashing. */}
          <linearGradient id="ep-dial-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#6ee7b7" />
            <stop offset="55%"  stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          {/* Soft, subtle glow filter — keeps the arc HD-clean */}
          <filter id="ep-dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track — full 270° arc behind the progress */}
        <path
          d={describeArc(50, 50, RADIUS, 135, 405)}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Progress arc — same path, but dashed/offset by completion */}
        <path
          d={describeArc(50, 50, RADIUS, 135, 405)}
          fill="none"
          stroke="url(#ep-dial-arc)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={ARC_LEN}
          strokeDashoffset={offset}
          filter="url(#ep-dial-glow)"
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }}
        />
        {/* End-cap dot — soft mint halo with white core at the
            leading edge of the arc. */}
        {pct > 0 && (
          <>
            <circle cx={dotX} cy={dotY} r="5.5" fill="rgba(110,231,183,0.55)" />
            <circle cx={dotX} cy={dotY} r="3"   fill="#ffffff" />
          </>
        )}
      </svg>
      <div className="ep-dial-text">
        <div className="ep-dial-num">{pct}%</div>
        <div className="ep-dial-label">Complete</div>
      </div>
    </div>
  );
}

// SVG helper — generate an arc path between two angles (degrees). Used
// by the progress dial so we can stroke an open arc with the same
// dasharray trick as a closed circle.
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const toRad = (a: number) => (a * Math.PI) / 180;
  const startX = cx + Math.cos(toRad(startAngle)) * r;
  const startY = cy + Math.sin(toRad(startAngle)) * r;
  const endX   = cx + Math.cos(toRad(endAngle))   * r;
  const endY   = cy + Math.sin(toRad(endAngle))   * r;
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;
}

// ─── Tiny presentational helpers used inside the Exit Process modal ─────────
function EpField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ep-field">
      <div className="ep-field-label">{label}</div>
      {children}
    </div>
  );
}
function EpInput({ value, onChange, type = 'text', disabled = false, placeholder }: { value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; placeholder?: string }) {
  return <input type={type} className="ep-input" value={value} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}
function EpSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="ep-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o.startsWith('— ') ? o : (o === 'Pending' ? '— Pending —' : o)}</option>)}
    </select>
  );
}
function EpApprovalCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="ep-approval-card">
      <div className="ep-approval-head"><i className={icon} />{title}</div>
      {children}
    </div>
  );
}
function EpFnfRow({ label, amount, tone }: { label: string; amount: string; tone: 'earn' | 'ded' }) {
  return (
    <div className={`ep-fnf-row ep-fnf-row--${tone}`}>
      <span>{label}</span>
      <span>{amount}</span>
    </div>
  );
}
// Compute remaining days between two ISO dates — used in Stage 2.
function calcRemaining(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / 86400000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Vault — opens for an Exited employee to view all archived docs.
// ─────────────────────────────────────────────────────────────────────────────
type DocStatus = 'Verified' | 'Uploaded' | 'Signed' | 'Sent' | 'Pending' | 'Not Generated' | 'Optional' | 'Generated' | 'Completed';

interface VaultDoc {
  icon: string;
  iconBg: string;
  iconFg: string;
  name: string;
  sub: string;
  category: string;
  status: DocStatus;
}

interface VaultGroup {
  title: string;
  icon: string;
  iconBg: string;
  iconFg: string;
  docs: VaultDoc[];
}

type VaultTab = 'employee' | 'organizational' | 'exit';

function EvidenceVaultModal({ employee, onClose }: { employee: EmployeeRow | null; onClose: () => void }) {
  const [tab, setTab] = useState<VaultTab>('employee');

  useEffect(() => { if (employee) setTab('employee'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employee?.id]);

  if (!employee) return null;

  const groups = VAULT_BY_TAB[tab];
  const allDocs = [...VAULT_BY_TAB.employee, ...VAULT_BY_TAB.organizational, ...VAULT_BY_TAB.exit].flatMap(g => g.docs);
  const total      = allDocs.length;
  const verified   = allDocs.filter(d => d.status === 'Verified').length;
  const signed     = allDocs.filter(d => d.status === 'Signed' || d.status === 'Generated' || d.status === 'Completed').length;
  const pending    = allDocs.filter(d => d.status === 'Pending' || d.status === 'Sent').length;
  const notGen     = allDocs.filter(d => d.status === 'Not Generated' || d.status === 'Optional').length;
  const completionPct = Math.round(((total - notGen) / total) * 100);

  const empCount  = VAULT_BY_TAB.employee.reduce((acc, g) => acc + g.docs.length, 0);
  const orgCount  = VAULT_BY_TAB.organizational.reduce((acc, g) => acc + g.docs.length, 0);
  const exitCount = VAULT_BY_TAB.exit.reduce((acc, g) => acc + g.docs.length, 0);

  return (
    <Modal isOpen={!!employee} toggle={onClose} centered size="xl" backdrop="static" contentClassName="border-0 ev-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="ev-head">
          <span className="ev-head-icon"><i className="ri-archive-2-line" /></span>
          <div className="ev-head-text">
            <div className="ev-head-title">Evidence Vault</div>
            <div className="ev-head-sub">Centralized document repository for onboarding, signed organizational, and exit documents</div>
            <div className="ev-head-meta">
              <span className="rec-id-pill">{employee.empId}</span>
              <span className="rec-id-pill">{employee.name}</span>
              <span className="rec-id-pill">{employee.department} - {employee.designation}</span>
              <span className="rec-id-pill">LWD: 15 Apr 2026</span>
            </div>
          </div>
          <div className="ev-head-status">
            <ExitProgressDial value={completionPct} />
            <div className="ev-head-status-text">
              <div className="ev-head-status-label">Vault Status</div>
              <div className="ev-head-status-num">{completionPct}% Complete</div>
            </div>
          </div>
          <button type="button" className="ev-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* KPI strip */}
        <div className="ev-kpis">
          <div className="ev-kpi"><span className="ev-kpi-num" style={{ color: '#7c3aed' }}>{total}</span><span className="ev-kpi-label">Total Docs</span></div>
          <div className="ev-kpi"><span className="ev-kpi-num" style={{ color: '#15803d' }}>{verified}</span><span className="ev-kpi-label">Verified</span></div>
          <div className="ev-kpi"><span className="ev-kpi-num" style={{ color: '#7c3aed' }}>{signed}</span><span className="ev-kpi-label">Signed</span></div>
          <div className="ev-kpi"><span className="ev-kpi-num" style={{ color: '#c2410c' }}>{pending}</span><span className="ev-kpi-label">Pending</span></div>
          <div className="ev-kpi"><span className="ev-kpi-num" style={{ color: '#6b7280' }}>{notGen}</span><span className="ev-kpi-label">Not Generated</span></div>
        </div>

        {/* Tabs */}
        <div className="ev-tabs">
          <button type="button" className={`ev-tab${tab === 'employee' ? ' is-active' : ''}`} onClick={() => setTab('employee')}>
            <i className="ri-user-line" />Employee Documents<span className="ev-tab-badge">{empCount}</span>
          </button>
          <button type="button" className={`ev-tab${tab === 'organizational' ? ' is-active' : ''}`} onClick={() => setTab('organizational')}>
            <i className="ri-briefcase-4-line" />Organizational Documents<span className="ev-tab-badge">{orgCount}</span>
          </button>
          <button type="button" className={`ev-tab${tab === 'exit' ? ' is-active' : ''}`} onClick={() => setTab('exit')}>
            <i className="ri-logout-box-r-line" />Exit Documents<span className="ev-tab-badge">{exitCount}</span>
          </button>
        </div>

        {/* Body — groups + docs */}
        <div className="ev-body">
          {groups.map((g, gi) => (
            <div key={gi} className="ev-group">
              <div className="ev-group-head">
                <span className="ev-group-icon" style={{ background: g.iconBg, color: g.iconFg }}>
                  <i className={g.icon} />
                </span>
                <div className="ev-group-title">{g.title}</div>
                <span className="ev-group-count">{g.docs.length} docs</span>
              </div>
              <div className="ev-doc-list">
                {g.docs.map((d, di) => {
                  const disabled = d.status === 'Not Generated' || d.status === 'Optional';
                  return (
                    <div key={di} className="ev-doc">
                      <span className="ev-doc-icon" style={{ background: d.iconBg, color: d.iconFg }}>
                        <i className={d.icon} />
                      </span>
                      <div className="ev-doc-info">
                        <div className="ev-doc-name">{d.name}</div>
                        <div className="ev-doc-sub">{d.sub}</div>
                      </div>
                      <span className="ev-doc-cat">{d.category}</span>
                      <span className={`ev-doc-status ev-doc-status--${d.status.toLowerCase().replace(/\s+/g, '-')}`}>{d.status}</span>
                      <button type="button" className={`ev-doc-btn ev-doc-btn--view${d.status === 'Generated' ? ' ev-doc-btn--preview' : ''}`} disabled={disabled}>
                        <i className="ri-eye-line" />{d.status === 'Generated' ? 'Preview' : 'View'}
                      </button>
                      <button type="button" className="ev-doc-btn ev-doc-btn--download" disabled={disabled}>
                        <i className="ri-download-line" />Download
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ModalBody>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ─── DUMMY DATA — REMOVE WHEN BACKEND APIs ARE READY ────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// Placeholder employees and the static Exit Checklist content. The checklist
// content is policy/SOP — keep it; only swap the employees over to the real
// `/exit/employees` endpoint when the backend is ready.
// To remove dummy employees: delete `buildDummyEmployees()` and uncomment the
// `api.get('/exit/employees')` block in the `useEffect` near the top.
// ════════════════════════════════════════════════════════════════════════════

// ─── Vault content — onboarding, organizational, and exit documents ────────
const VAULT_BY_TAB: Record<VaultTab, VaultGroup[]> = {
  employee: [
    {
      title: 'Identity Documents', icon: 'ri-id-card-line', iconBg: '#ede9fe', iconFg: '#5b3fd1',
      docs: [
        { icon: 'ri-id-card-line',     iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Aadhaar Card',     sub: 'Government issued 12-digit unique identity', category: 'Identity', status: 'Verified' },
        { icon: 'ri-bank-card-2-line', iconBg: '#fef3c7', iconFg: '#92400e', name: 'PAN Card',         sub: 'Permanent Account Number for taxation',    category: 'Identity', status: 'Verified' },
        { icon: 'ri-camera-line',      iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Passport Photo',   sub: 'Recent passport-size photograph',          category: 'Identity', status: 'Uploaded' },
      ],
    },
    {
      title: 'Address Proof', icon: 'ri-home-4-line', iconBg: '#dcfce7', iconFg: '#15803d',
      docs: [
        { icon: 'ri-home-4-line',    iconBg: '#dcfce7', iconFg: '#15803d', name: 'Current Address Proof',   sub: 'Utility bill or bank statement (last 3 months)', category: 'Address', status: 'Uploaded' },
        { icon: 'ri-map-pin-2-line', iconBg: '#fee2e2', iconFg: '#b91c1c', name: 'Permanent Address Proof', sub: 'Aadhaar / Voter ID as permanent address proof',  category: 'Address', status: 'Verified' },
      ],
    },
    {
      title: 'Education Documents', icon: 'ri-graduation-cap-line', iconBg: '#fef3c7', iconFg: '#92400e',
      docs: [
        { icon: 'ri-file-text-line',      iconBg: '#fef3c7', iconFg: '#92400e', name: '10th Marksheet',             sub: 'Secondary education certificate & marksheet',    category: 'Education', status: 'Verified' },
        { icon: 'ri-file-text-line',      iconBg: '#fef3c7', iconFg: '#92400e', name: '12th Marksheet',             sub: 'Higher secondary education certificate',         category: 'Education', status: 'Verified' },
        { icon: 'ri-graduation-cap-line', iconBg: '#dcfce7', iconFg: '#15803d', name: 'Graduation Certificate',     sub: 'Bachelor degree certificate & transcripts',       category: 'Education', status: 'Verified' },
        { icon: 'ri-trophy-line',         iconBg: '#fef3c7', iconFg: '#92400e', name: 'Post-graduation Certificate', sub: 'Masters / PG degree certificate (if applicable)', category: 'Education', status: 'Optional' },
      ],
    },
    {
      title: 'Previous Employment Documents', icon: 'ri-briefcase-4-line', iconBg: '#ede9fe', iconFg: '#5b3fd1',
      docs: [
        { icon: 'ri-file-text-line',          iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Experience Letter',     sub: 'Experience certificate from last employer',      category: 'Prev. Employment', status: 'Verified' },
        { icon: 'ri-file-text-line',          iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Relieving Letter',      sub: 'Formal relieving from previous organisation',    category: 'Prev. Employment', status: 'Verified' },
        { icon: 'ri-money-rupee-circle-line', iconBg: '#fef3c7', iconFg: '#92400e', name: 'Last 3 Salary Slips',   sub: 'Payslips for last 3 months from previous role',  category: 'Prev. Employment', status: 'Uploaded' },
        { icon: 'ri-file-text-line',          iconBg: '#fef3c7', iconFg: '#92400e', name: 'Previous Offer Letter', sub: 'Original offer letter from last organisation',   category: 'Prev. Employment', status: 'Pending' },
      ],
    },
  ],
  organizational: [
    {
      title: 'Signed Company Documents', icon: 'ri-file-shield-2-line', iconBg: '#fef3c7', iconFg: '#92400e',
      docs: [
        { icon: 'ri-lock-2-line',         iconBg: '#1f2937', iconFg: '#ffffff', name: 'NDA',                          sub: 'Non-Disclosure Agreement — active during and post tenure',  category: 'Signed', status: 'Signed' },
        { icon: 'ri-file-text-line',      iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Employment Agreement',         sub: 'Appointment letter & employment terms and conditions',      category: 'Signed', status: 'Signed' },
        { icon: 'ri-book-2-line',         iconBg: '#fef3c7', iconFg: '#92400e', name: 'Code of Conduct Policy',       sub: 'Acknowledgement of company ethical standards and behavior', category: 'Signed', status: 'Signed' },
        { icon: 'ri-computer-line',       iconBg: '#dcfce7', iconFg: '#15803d', name: 'IT Security & Acceptable Use', sub: 'IT asset usage, data access, and acceptable use policy',    category: 'Signed', status: 'Signed' },
        { icon: 'ri-calendar-check-line', iconBg: '#fee2e2', iconFg: '#b91c1c', name: 'Leave & Attendance Policy',    sub: 'Leave entitlements, attendance rules, and WFH policy',      category: 'Sent',   status: 'Sent' },
        { icon: 'ri-shield-line',         iconBg: '#fee2e2', iconFg: '#b91c1c', name: 'Confidentiality Agreement',    sub: 'Confidential business information protection agreement',    category: 'Signed', status: 'Signed' },
        { icon: 'ri-gift-2-line',         iconBg: '#fef3c7', iconFg: '#92400e', name: 'Gratuity & Benefit Policy',    sub: 'Gratuity eligibility, PF, and other employee benefit terms', category: 'Not Generated', status: 'Not Generated' },
      ],
    },
  ],
  exit: [
    {
      title: 'Exit Process Documents', icon: 'ri-logout-box-r-line', iconBg: '#dcfce7', iconFg: '#15803d',
      docs: [
        { icon: 'ri-file-text-line',          iconBg: '#ede9fe', iconFg: '#5b3fd1', name: 'Relieving Letter',     sub: 'Formal relieving from all duties and responsibilities', category: 'Exit', status: 'Signed' },
        { icon: 'ri-graduation-cap-line',     iconBg: '#dcfce7', iconFg: '#15803d', name: 'Experience Letter',    sub: 'Detailed role, tenure, and performance summary letter', category: 'Exit', status: 'Signed' },
        { icon: 'ri-money-rupee-circle-line', iconBg: '#fef3c7', iconFg: '#92400e', name: 'FnF Settlement Sheet', sub: 'Complete full and final payment breakdown and approval', category: 'Exit', status: 'Signed' },
        { icon: 'ri-file-shield-2-line',      iconBg: '#fef3c7', iconFg: '#92400e', name: 'NOC Certificate',      sub: 'No Objection Certificate issued by the organization',   category: 'Exit', status: 'Generated' },
        { icon: 'ri-chat-3-line',             iconBg: '#1f2937', iconFg: '#ffffff', name: 'Exit Interview Form',  sub: 'Exit feedback form filled and acknowledged by HR',      category: 'Exit', status: 'Completed' },
      ],
    },
  ],
};

function buildDummyEmployees(): EmployeeRow[] {
  const palette = ['#7c5cfc', '#0ab39c', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#f97316', '#ec4899', '#06b6d4'];
  const initialsOf = (name: string) => name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  type Seed = {
    empId: string; name: string;
    department: string; designation: string;
    primaryRole: string; ancillaryRole: string;
    managerName: string;
    readiness: number; status: ExitStatus;
  };

  const seeds: Seed[] = [
    { empId: 'EMP-1031', name: 'Aditi Singh',     department: 'CNS',         designation: 'Jr. Software Engineer', primaryRole: 'Software Engineer',    ancillaryRole: 'Mentor',              managerName: 'Atharv Patekar', readiness: 79, status: 'Active' },
    { empId: 'EMP-1063', name: 'Aarav Kale',      department: 'Accounts',    designation: 'Associate Engineer',    primaryRole: 'Associate',            ancillaryRole: 'Training Coordinator',managerName: 'Deepa Kulkarni', readiness: 83, status: 'Active' },
    { empId: 'EMP-1045', name: 'Priya Mehta',     department: 'HR',          designation: 'HR Manager',            primaryRole: 'HR Business Partner',  ancillaryRole: 'Learning & Dev',      managerName: 'Shalini Rao',    readiness: 91, status: 'Active' },
    { empId: 'EMP-1052', name: 'Rahul Sharma',    department: 'Engineering', designation: 'Senior Developer',      primaryRole: 'Backend Engineer',     ancillaryRole: 'Tech Lead Backup',    managerName: 'Atharv Patekar', readiness: 88, status: 'Active' },
    { empId: 'EMP-1058', name: 'Sneha Joshi',     department: 'Finance',     designation: 'Finance Analyst',       primaryRole: 'FP&A Analyst',         ancillaryRole: 'Budget Coordinator',  managerName: 'Nikhil Mehra',   readiness: 76, status: 'Active' },
    { empId: 'EMP-1071', name: 'Karan Malhotra',  department: 'Sales',       designation: 'Sales Executive',       primaryRole: 'Enterprise Sales Rep', ancillaryRole: 'CRM Champion',        managerName: 'Priya Iyer',     readiness: 84, status: 'Active' },
    { empId: 'EMP-1077', name: 'Tanvi Reddy',     department: 'Design',      designation: 'UI/UX Designer',        primaryRole: 'Product Designer',     ancillaryRole: 'Brand Design Sup.',   managerName: 'Neha Kulkarni',  readiness: 72, status: 'Active' },
    { empId: 'EMP-1082', name: 'Rohan Verma',     department: 'Marketing',   designation: 'Performance Marketer',  primaryRole: 'Digital Marketing …',  ancillaryRole: 'Content Support',     managerName: 'Ritu Khanna',    readiness: 69, status: 'Active' },
    { empId: 'EMP-1086', name: 'Sanya Bose',      department: 'Data Science',designation: 'Data Analyst',          primaryRole: 'Analytics Engineer',   ancillaryRole: 'BI Support',          managerName: 'Shatakshi Singh',readiness: 85, status: 'Active' },
    { empId: 'EMP-1091', name: 'Arjun Mehta',     department: 'Engineering', designation: 'Frontend Developer',    primaryRole: 'React Developer',      ancillaryRole: 'Code Reviewer',       managerName: 'Atharv Patekar', readiness: 78, status: 'Active' },
    { empId: 'EMP-1094', name: 'Divya Nair',      department: 'Operations',  designation: 'Operations Executive',  primaryRole: 'Process Analyst',      ancillaryRole: 'Vendor Coordinator',  managerName: 'Vivek Iyer',     readiness: 81, status: 'Active' },
    { empId: 'EMP-1098', name: 'Neel Kapoor',     department: 'Engineering', designation: 'DevOps Engineer',       primaryRole: 'Cloud Engineer',       ancillaryRole: 'On-call Backup',      managerName: 'Atharv Patekar', readiness: 87, status: 'Active' },
    { empId: 'EMP-1102', name: 'Riya Banerjee',   department: 'HR',          designation: 'Recruiter',             primaryRole: 'Talent Acquisition',   ancillaryRole: 'Onboarding Buddy',    managerName: 'Shalini Rao',    readiness: 74, status: 'Active' },
    { empId: 'EMP-1108', name: 'Vikram Joshi',    department: 'Legal',       designation: 'Legal Associate',       primaryRole: 'Contracts Reviewer',   ancillaryRole: 'Compliance Support',  managerName: 'Anjali Rao',     readiness: 90, status: 'Active' },
    { empId: 'EMP-1112', name: 'Pooja Sinha',     department: 'CNS',         designation: 'QA Engineer',           primaryRole: 'QA Automation',        ancillaryRole: 'Test Architect',      managerName: 'Karan Singh',    readiness: 80, status: 'Active' },
    { empId: 'EMP-1119', name: 'Mihir Patil',     department: 'Engineering', designation: 'Software Engineer',     primaryRole: 'Mobile Developer',     ancillaryRole: 'Release Manager',     managerName: 'Atharv Patekar', readiness: 73, status: 'Active' },
    { empId: 'EMP-1124', name: 'Anita Saxena',    department: 'Sales',       designation: 'Sales Manager',         primaryRole: 'Account Manager',      ancillaryRole: 'Pipeline Reviewer',   managerName: 'Priya Iyer',     readiness: 0,  status: 'Missing Details' },

    // ── Exit In Progress (8) ────────────────────────────────────────────
    { empId: 'EMP-1041', name: 'Sahil Khanna',    department: 'Engineering', designation: 'Senior Developer',      primaryRole: 'Backend Engineer',     ancillaryRole: 'Tech Lead Backup',    managerName: 'Atharv Patekar', readiness: 65, status: 'Exit In Progress' },
    { empId: 'EMP-1049', name: 'Meera Iyer',      department: 'Marketing',   designation: 'Brand Manager',         primaryRole: 'Brand Strategist',     ancillaryRole: 'Campaign Lead',       managerName: 'Ritu Khanna',    readiness: 50, status: 'Exit In Progress' },
    { empId: 'EMP-1057', name: 'Aakash Bose',     department: 'Design',      designation: 'Sr. Designer',          primaryRole: 'Product Designer',     ancillaryRole: 'Design Mentor',       managerName: 'Neha Kulkarni',  readiness: 45, status: 'Exit In Progress' },
    { empId: 'EMP-1064', name: 'Pooja Mehta',     department: 'HR',          designation: 'Talent Specialist',     primaryRole: 'Tech Recruiter',       ancillaryRole: 'Employer Brand',      managerName: 'Shalini Rao',    readiness: 70, status: 'Exit In Progress' },
    { empId: 'EMP-1073', name: 'Rohit Sen',       department: 'Finance',     designation: 'Finance Lead',          primaryRole: 'Treasury Analyst',     ancillaryRole: 'Audit Coordinator',   managerName: 'Nikhil Mehra',   readiness: 55, status: 'Exit In Progress' },
    { empId: 'EMP-1085', name: 'Aisha Rahman',    department: 'Operations',  designation: 'Operations Lead',       primaryRole: 'SCM Lead',             ancillaryRole: 'Vendor Owner',        managerName: 'Vivek Iyer',     readiness: 62, status: 'Exit In Progress' },
    { empId: 'EMP-1092', name: 'Devansh Gupta',   department: 'CNS',         designation: 'Network Engineer',      primaryRole: 'Network Admin',        ancillaryRole: 'Security Liaison',    managerName: 'Karan Singh',    readiness: 40, status: 'Exit In Progress' },
    { empId: 'EMP-1099', name: 'Kavya Menon',     department: 'Engineering', designation: 'Tech Lead',             primaryRole: 'Architect',            ancillaryRole: 'Hiring Panel',        managerName: 'Atharv Patekar', readiness: 78, status: 'Exit In Progress' },

    // ── Exited (8) ──────────────────────────────────────────────────────
    { empId: 'EMP-0987', name: 'Naveen Rao',      department: 'Engineering', designation: 'Senior Developer',      primaryRole: 'Full-stack Developer', ancillaryRole: 'Mentor',              managerName: 'Atharv Patekar', readiness: 100, status: 'Exited' },
    { empId: 'EMP-0991', name: 'Shilpa Nair',     department: 'Sales',       designation: 'Account Executive',     primaryRole: 'Sales Rep',            ancillaryRole: 'Lead Qualifier',      managerName: 'Priya Iyer',     readiness: 100, status: 'Exited' },
    { empId: 'EMP-0995', name: 'Manish Kapoor',   department: 'Finance',     designation: 'Auditor',               primaryRole: 'Internal Auditor',     ancillaryRole: 'Risk Reviewer',       managerName: 'Nikhil Mehra',   readiness: 100, status: 'Exited' },
    { empId: 'EMP-1002', name: 'Geeta Shah',      department: 'HR',          designation: 'L&D Specialist',        primaryRole: 'Trainer',              ancillaryRole: 'Onboarding Lead',     managerName: 'Shalini Rao',    readiness: 100, status: 'Exited' },
    { empId: 'EMP-1011', name: 'Vivaan Roy',      department: 'Design',      designation: 'Visual Designer',       primaryRole: 'Brand Designer',       ancillaryRole: 'Motion Support',      managerName: 'Neha Kulkarni',  readiness: 100, status: 'Exited' },
    { empId: 'EMP-1019', name: 'Tara Bhalla',     department: 'Marketing',   designation: 'Content Writer',        primaryRole: 'SEO Writer',           ancillaryRole: 'Newsletter Lead',     managerName: 'Ritu Khanna',    readiness: 100, status: 'Exited' },
    { empId: 'EMP-1024', name: 'Ishaan Pillai',   department: 'Engineering', designation: 'Junior Developer',      primaryRole: 'Backend Engineer',     ancillaryRole: 'QA Pair',             managerName: 'Atharv Patekar', readiness: 100, status: 'Exited' },
    { empId: 'EMP-1028', name: 'Roshni Datta',    department: 'Operations',  designation: 'Project Coordinator',   primaryRole: 'PMO Coordinator',      ancillaryRole: 'Reporting Sup.',      managerName: 'Vivek Iyer',     readiness: 100, status: 'Exited' },
  ];

  return seeds.map((s, idx) => ({
    id: idx + 1,
    empId: s.empId,
    name: s.name,
    initials: initialsOf(s.name),
    accent: palette[idx % palette.length],
    department: s.department,
    designation: s.designation,
    primaryRole: s.primaryRole,
    ancillaryRole: s.ancillaryRole,
    managerName: s.managerName,
    managerInitials: initialsOf(s.managerName),
    managerAccent: palette[(idx + 4) % palette.length],
    exitReadiness: s.readiness,
    status: s.status,
  }));
}

// ─── Static Exit Checklist content ──────────────────────────────────────────
// This is policy/SOP content, not user-generated data. Keep it in code so the
// checklist is always available even before the backend API exists.
const CHECKLIST_STAGES: ChecklistStage[] = [
  // ══ STAGE 1 — Exit Initiation & Approval ══
  {
    num: 1, title: 'Exit Initiation & Approval',
    items: [
      { name: 'Resignation letter received & acknowledged', sub: 'Formal resignation accepted and recorded in HRMS',                          owner: 'hr',  desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'Exit type and reason documented',            sub: 'Exit category, reason and details captured accurately in system',           owner: 'hr',  desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'Reporting manager notified of resignation',  sub: 'Manager informed via system notification and email',                        owner: 'hr',  desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'HR approval obtained',                       sub: 'HR head sign-off on exit initiation',                                       owner: 'hr',  desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'Manager approval obtained',                  sub: 'Department manager formal approval recorded',                               owner: 'mgr', desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'Last working day confirmed',                 sub: 'Official LWD agreed and updated in system',                                 owner: 'hr',  desig: 'all',                                  type: 'all',  tag: 'ALL' },
      { name: 'Board / Director notification for HOD exit', sub: 'Director/CEO formally notified, transition plan approved at board level',  owner: 'hr',  desig: ['hod'],                                type: 'all',  tag: 'HOD' },
      { name: 'Interim HOD / acting authority designated',  sub: 'Interim Head identified and announced to department before LWD',            owner: 'mgr', desig: ['hod'],                                type: 'all',  tag: 'HOD' },
      { name: 'Team leadership temporarily re-assigned',    sub: 'Acting Team Lead identified, team informed of temporary reporting change', owner: 'mgr', desig: ['lead'],                               type: 'all',  tag: 'TL' },
      { name: 'Replacement requirement flagged',            sub: 'Need for backfill or replacement assessed and noted',                       owner: 'mgr', desig: ['hod', 'lead', 'exec', 'employee'],    type: 'all' },
      { name: 'Internship completion / early exit documented', sub: 'Internship outcome recorded — completion certificate or early exit reason noted', owner: 'hr', desig: ['intern'], type: 'all', tag: 'INTERN' },
    ],
  },
  // ══ STAGE 2 — Notice Period Management ══
  {
    num: 2, title: 'Notice Period Management',
    items: [
      { name: 'Notice period start date confirmed',         sub: 'Notice period officially begins from confirmed date',                                                       owner: 'hr',  desig: ['hod', 'lead', 'exec', 'employee'], type: 'all' },
      { name: 'Notice period waiver / extension assessed',  sub: 'Check if buyout, waiver or extension applies per policy',                                                   owner: 'hr',  desig: ['hod', 'lead', 'exec', 'employee'], type: 'all' },
      { name: 'Attendance tracked during notice period',    sub: 'Leave, WFH and attendance monitored through LWD',                                                           owner: 'mgr', desig: ['hod', 'lead', 'exec', 'employee'], type: 'all' },
      { name: 'Knowledge transfer plan prepared',           sub: 'KT schedule created and shared with team and replacement',                                                  owner: 'mgr', desig: ['hod', 'lead', 'exec', 'employee'], type: 'all', tag: 'ALL' },
      { name: 'KT sessions completed and signed off',       sub: 'All knowledge transfer sessions documented and acknowledged',                                               owner: 'mgr', desig: ['hod', 'lead', 'exec', 'employee'], type: 'all' },
      { name: 'Handover document submitted',                sub: 'Complete handover note submitted and approved by manager',                                                  owner: 'mgr', desig: ['hod', 'lead', 'exec', 'employee'], type: 'all' },
      { name: 'Department strategy & ongoing projects briefed', sub: 'Comprehensive brief to successor/interim HOD on strategy, budgets and key projects',                    owner: 'mgr', desig: ['hod'],                              type: 'all', tag: 'HOD' },
      { name: 'Vendor / client relationships transitioned', sub: 'Key external relationships introduced to successor with formal handover emails',                            owner: 'mgr', desig: ['hod'],                              type: 'all', tag: 'HOD' },
      { name: 'Sprint / active tasks reassigned to team',   sub: 'All open tickets, sprint tasks and ongoing deliverables redistributed',                                     owner: 'mgr', desig: ['lead'],                             type: 'all', tag: 'TL' },
      { name: 'Client / project handover completed',        sub: 'Clients notified and project transitioned to new owner',                                                    owner: 'mgr', desig: ['hod', 'lead', 'exec'],              type: 'all' },
      { name: 'Intern project / work handover done',        sub: 'Incomplete work handed to supervisor, project progress documented',                                         owner: 'mgr', desig: ['intern'],                           type: 'all', tag: 'INTERN' },
    ],
  },
  // ══ STAGE 3 — Clearance & Asset Recovery ══
  {
    num: 3, title: 'Clearance & Asset Recovery',
    items: [
      { name: 'Department clearance obtained',              sub: 'Department head confirms no pending deliverables or dues',          owner: 'mgr', desig: 'all',                       type: 'all',   tag: 'ALL' },
      { name: 'Security and access card surrendered',       sub: 'Physical access cards and office keys returned',                    owner: 'mgr', desig: 'all',                       type: 'all',   tag: 'ALL' },
      { name: 'Admin and facility clearance done',          sub: 'Desk cleared, locker vacated, premises cleared',                    owner: 'mgr', desig: 'all',                       type: 'all',   tag: 'ALL' },
      { name: 'IT asset inventory completed',               sub: 'Laptop, accessories, dongles, and all devices listed and verified', owner: 'it',  desig: 'all',                       type: 'it',    tag: 'IT' },
      { name: 'All IT assets returned and verified',        sub: 'Physical return confirmed with IT team sign-off',                   owner: 'it',  desig: 'all',                       type: 'it',    tag: 'IT' },
      { name: 'System & application access revoked',        sub: 'All accounts, software and tool access disabled immediately on LWD',owner: 'it',  desig: 'all',                       type: 'it',    tag: 'IT' },
      { name: 'Email account deactivated / redirected',     sub: 'Email account closed or auto-forward set up per policy',            owner: 'it',  desig: 'all',                       type: 'it',    tag: 'IT' },
      { name: 'GitHub / cloud / server access removed',     sub: 'Repository access, VPN, AWS/Azure/GCP IAM roles all revoked',       owner: 'it',  desig: 'all',                       type: 'it',    tag: 'IT' },
      { name: 'Admin / elevated system access removed',     sub: 'HOD-level HRMS, finance dashboards, and admin portals access revoked', owner: 'it', desig: ['hod'],                  type: 'it',    tag: 'HOD + IT' },
      { name: 'ERP / CRM access revoked',                   sub: 'SAP/Salesforce/Zoho access removed, data exported/transferred as needed', owner: 'it', desig: 'all',                  type: 'nonit', tag: 'NON-IT' },
      { name: 'Field assets & tools returned',              sub: 'Uniform, SIM card, visiting cards, vehicle, field kit returned and acknowledged', owner: 'mgr', desig: ['exec','employee'], type: 'nonit', tag: 'NON-IT' },
      { name: 'Intern system access deactivated',           sub: 'Email, tool access, and any repo permissions removed on last day',  owner: 'it',  desig: ['intern'],                  type: 'all',   tag: 'INTERN' },
    ],
  },
  // ══ STAGE 4 — Exit Interview ══
  {
    num: 4, title: 'Exit Interview',
    items: [
      { name: 'Exit interview conducted by HR',             sub: 'Feedback collected on role, team, culture and management',                                 owner: 'hr', desig: 'all',                              type: 'all', tag: 'ALL' },
      { name: 'Exit interview form signed by employee',     sub: 'Signed acknowledgement form received and archived',                                        owner: 'hr', desig: 'all',                              type: 'all', tag: 'ALL' },
      { name: 'Insights recorded in HRMS',                  sub: 'Key feedback logged against employee profile for future reference',                        owner: 'hr', desig: 'all',                              type: 'all', tag: 'ALL' },
      { name: 'Director-level exit debrief conducted',      sub: 'Strategic debrief with Director/CEO — department feedback, leadership concerns captured',  owner: 'hr', desig: ['hod'],                            type: 'all', tag: 'HOD' },
      { name: 'Alumni network / rehire eligibility noted',  sub: 'Employee rehire eligibility flagged in system for future reference',                       owner: 'hr', desig: ['hod','lead','exec','employee'],   type: 'all' },
      { name: 'Intern feedback & performance recorded',     sub: 'Supervisor rating and intern self-assessment logged — PPO eligibility noted',              owner: 'hr', desig: ['intern'],                         type: 'all', tag: 'INTERN' },
    ],
  },
  // ══ STAGE 5 — Full & Final Settlement (FnF) ══
  {
    num: 5, title: 'Full & Final Settlement (FnF)',
    items: [
      { name: 'Leave encashment calculated',                sub: 'Pending leaves valued and included in FnF calculation',                                      owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Gratuity eligibility verified',              sub: 'Gratuity entitlement confirmed and computed per policy (min 5 years service)',              owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'PF and statutory dues calculated',           sub: 'Provident fund and other statutory obligations finalised',                                  owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Salary arrears and deductions reconciled',   sub: 'All pending salary, recoveries and deductions netted off',                                  owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Executive perks & allowance settlement',     sub: 'Car allowance, club membership, phone reimbursements and other perks settled',              owner: 'fin', desig: ['hod'],                          type: 'all', tag: 'HOD' },
      { name: 'FnF settlement sheet approved',              sub: 'Final FnF breakdown approved by Finance and HR heads',                                      owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Payment processed to employee',              sub: 'FnF amount transferred to employee bank account',                                           owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Form 16 / tax documents issued',             sub: 'Tax documents provided for the current financial year',                                     owner: 'fin', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Final stipend & reimbursements paid',        sub: 'Pro-rated stipend for last month, approved expense claims cleared',                         owner: 'fin', desig: ['intern'],                       type: 'all', tag: 'INTERN' },
    ],
  },
  // ══ STAGE 6 — Exit Documents Management ══
  {
    num: 6, title: 'Exit Documents Management',
    items: [
      { name: 'Relieving letter generated and signed',      sub: 'Formal relieving letter issued with authorised signature',                                  owner: 'hr', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Experience letter generated and signed',     sub: 'Experience letter with role, tenure and performance issued',                                owner: 'hr', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'NOC certificate issued',                     sub: 'No Objection Certificate issued by the organisation',                                       owner: 'hr', desig: 'all',                            type: 'all', tag: 'ALL' },
      { name: 'Employee record marked as Exited',           sub: 'System status updated to Exited with LWD and exit reason',                                  owner: 'hr', desig: 'all',                            type: 'all', tag: 'ALL' },
      { name: 'Evidence vault archived & sealed',           sub: 'All exit documents archived and sealed in evidence vault',                                  owner: 'hr', desig: 'all',                            type: 'all', tag: 'ALL' },
      { name: 'Reference letter issued (if applicable)',    sub: 'Reference letter issued on request per company policy',                                     owner: 'hr', desig: ['hod','lead','exec','employee'], type: 'all' },
      { name: 'Internship completion certificate issued',   sub: 'Certificate with project name, duration and supervisor name issued to intern',              owner: 'hr', desig: ['intern'],                       type: 'all', tag: 'INTERN' },
      { name: 'Strategic / confidential documents archived',sub: 'Department strategy docs, board meeting minutes, confidential files formally archived',     owner: 'hr', desig: ['hod'],                          type: 'all', tag: 'HOD' },
    ],
  },
];

const CHECKLIST_TOTAL = CHECKLIST_STAGES.reduce((acc, s) => acc + s.items.length, 0);
