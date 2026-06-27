import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, Input } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { AncillaryRolesChip } from '../../components/AncillaryRolesChip';
import { Shimmer, ShimmerTableRows } from '../../components/ui/Shimmer';
import WorklistPager from '../../components/ui/WorklistPager';
import Tooltip from '../../components/ui/Tooltip';
import DocGenerateModal from './doc-templates/DocGenerateModal';
import '../../../css/recruitment.css';

type ExitStatus = 'Active' | 'Exit In Progress' | 'Exited' | 'Missing Details';
type DesigLevel = 'all' | 'hod' | 'lead' | 'exec' | 'employee' | 'intern';
type EmpType    = 'all' | 'it' | 'nonit';
type RoleOwner  = 'hr' | 'it' | 'fin' | 'mgr';

interface AssetMini {
  id: number;
  asset_name: string;
  code: string | null;
  asset_number: string | null;
}

interface EmployeeRow {
  id: number;
  empId: string;
  name: string;
  initials: string;
  accent: string;
  photoUrl?: string | null;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
  ancillaryRoles?: string[];
  managerName: string;
  managerInitials: string;
  managerAccent: string;
  exitReadiness: number;
  status: ExitStatus;
  exitInitiated: boolean;
  noticeStartIso: string;
  // Notice period set on the employee at hire (e.g. "30 Days" + 30). Used to
  // auto-derive the Notice Period End Date in the exit form.
  noticePeriodDays: number | null;
  noticePeriodLabel: string;
  laptopAsset:  AssetMini | null;
  mobileAsset:  AssetMini | null;
  otherAssets:  AssetMini[];
}

interface ChecklistItem {
  name: string;
  sub: string;
  owner: RoleOwner;
  desig: DesigLevel[] | 'all';
  type: EmpType;
  tag?: string;
}

interface ChecklistStage {
  num: number;
  title: string;
  items: ChecklistItem[];
}

export default function HrExitManagement() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [tab, setTab]             = useState<'active' | 'in-progress' | 'exited'>('active');
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(10);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [processing, setProcessing] = useState<EmployeeRow | null>(null);
  const [vault, setVault] = useState<EmployeeRow | null>(null);

  const loadEmployees = useCallback((silent = false) => {
    if (!silent) setListLoading(true);
    api.get('/employees')
      .then(({ data }) => {
        const list = (Array.isArray(data) ? data : []).filter(
          e => Number((e as any)?.onboarding_stage_completed ?? 0) >= 6
        );
        setEmployees(list.map(apiToExitRow));
      })
      .catch(() => setEmployees([]))
      .finally(() => setListLoading(false));
  }, []);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  useEffect(() => { setPage(1); }, [tab, search]);

  const counts = useMemo(() => {
    const total       = employees.length;
    const active      = employees.filter(e => e.status === 'Active').length;
    const inProgress  = employees.filter(e => e.status === 'Exit In Progress').length;
    const exited      = employees.filter(e => e.status === 'Exited').length;
    const missing     = employees.filter(e => e.status === 'Missing Details').length;
    return { total, active, inProgress, exited, missing };
  }, [employees]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees
      .filter(e => {
        if (tab === 'active')      return e.status === 'Active' || e.status === 'Missing Details';
        if (tab === 'in-progress') return e.status === 'Exit In Progress';
        if (tab === 'exited')      return e.status === 'Exited';
        return true;
      })
      .filter(e => {
        if (!needle) return true;
        return (
          e.name.toLowerCase().includes(needle) ||
          e.empId.toLowerCase().includes(needle) ||
          e.department.toLowerCase().includes(needle) ||
          e.designation.toLowerCase().includes(needle)
        );
      });
  }, [employees, tab, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  const listRootRef   = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [listFillH, setListFillH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const recompute = () => {
      const el = listScrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const fh = Math.max(320, window.innerHeight - top - 24);
      setListFillH(prev => (prev === fh ? prev : fh));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    if (listRootRef.current) ro.observe(listRootRef.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); cancelAnimationFrame(raf); };
  }, [filtered.length]);


  const KPI_CARDS = [
    { key: 'total',      label: 'Total Employees',     value: counts.total,      icon: 'ri-team-line',          gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'active',     label: 'Active Employees',    value: counts.active,     icon: 'ri-user-line',          gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'inProgress', label: 'Exit in Progress',    value: counts.inProgress, icon: 'ri-time-line',          gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'exited',     label: 'Exited Employees',    value: counts.exited,     icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'missing',    label: 'Missing Exit Details',value: counts.missing,    icon: 'ri-error-warning-line', gradient: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
  ];

  const STATUS_COLOR: Record<ExitStatus, string> = {
    'Active':           'success',
    'Exit In Progress': 'warning',
    'Exited':           'secondary',
    'Missing Details':  'danger',
  };

  return (
    <>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div className="rec-page">
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-logout-box-r-line" /></div>
                <div className="min-w-0">
                  <div className="frm-cstrip-title">Exit Management Hub</div>
                  <div className="frm-cstrip-sub">Track active employees, ongoing exit cases, and completed employee exits</div>
                </div>
              </div>
              <button type="button" className="exit-checklist-btn flex-shrink-0" onClick={() => setChecklistOpen(true)}>
                <i className="ri-clipboard-line" />Exit Checklist
              </button>
            </div>

            <Row className="g-3 mb-3 align-items-stretch rec-page-kpis row-cols-xl-5 row-cols-md-3 row-cols-sm-2 row-cols-1">
              {KPI_CARDS.map(k => (
                <Col key={k.key}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">{k.label}</span>
                      {listLoading
                        ? <Shimmer height={28} width={56} style={{ marginTop: 4 }} />
                        : <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value}</span>}
                    </div>
                    <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                      <i className={k.icon} />
                    </span>
                  </div>
                </Col>
              ))}
            </Row>

            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame" ref={listRootRef}>
                  <div className="rec-req-filter-row d-flex align-items-center gap-3 flex-wrap">
                    <div className="rec-tab-track" style={{ marginBottom: 0, flex: '1 1 0', minWidth: 0 }}>
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
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          <i className={t.icon} />
                          {t.label}
                          <span className="badge">{t.count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="rec-req-search search-box" style={{ flex: '1 1 0', minWidth: 0 }}>
                      <Input type="text" className="form-control" placeholder="Search name, ID, department…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                  </div>

                  <div className="d-flex flex-column" ref={listScrollRef} style={{ minHeight: listFillH }}>
                  <div className="p-2 rec-list-scroll flex-grow-1">
                    <table className="rec-list-table cand-page-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th className="ps-3 text-center" style={{ width: 60 }}>Sr No</th>
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
                        {listLoading ? (
                          <ShimmerTableRows rows={6} cols={11} keyPrefix="exit-shim" />
                        ) : filtered.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="text-center py-5 text-muted">
                              <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                              No employees match your filters
                            </td>
                          </tr>
                        ) : visible.map((e, idx) => {
                          const statusColor = STATUS_COLOR[e.status];
                          const isExited = e.status === 'Exited';
                          const isInProgress = e.status === 'Exit In Progress';
                          const isScheduled = e.status === 'Active' && e.exitInitiated;
                          const noticeFromLabel = e.noticeStartIso
                            ? new Date(e.noticeStartIso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                            : '';
                          return (
                            <tr key={e.id}>
                              <td className="ps-3 text-center fs-13 hr-exit-srno">{sliceFrom + idx + 1}</td>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  {e.photoUrl ? (
                                    <img
                                      src={e.photoUrl}
                                      alt={e.name}
                                      className="rounded-circle flex-shrink-0"
                                      style={{ width: 26, height: 26, objectFit: 'cover', border: '1px solid rgba(128,128,128,0.2)' }}
                                    />
                                  ) : (
                                    <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                      style={{ width: 26, height: 26, fontSize: 10.5, background: `linear-gradient(135deg, ${e.accent}, ${e.accent}cc)` }}>
                                      {e.initials}
                                    </div>
                                  )}
                                  <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
                                    <span className="fw-bold fs-13">{e.name}</span>
                                    <span className="text-muted" style={{ fontSize: 10.5, fontWeight: 500 }}>
                                      {isScheduled ? (noticeFromLabel ? `Exit scheduled · notice ${noticeFromLabel}` : 'Exit scheduled')
                                        : e.status === 'Active' ? 'Active'
                                        : e.status === 'Exit In Progress' ? 'In Progress'
                                        : e.status === 'Exited' ? 'Exited' : 'Action Needed'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td><span className="rec-id-pill">{e.empId}</span></td>
                              <td className="fs-13">{e.department}</td>
                              <td className="fs-13">{e.designation}</td>
                              <td><span className="exit-role-chip exit-role-chip--primary">{e.primaryRole}</span></td>
                              <td>
                                <AncillaryRolesChip
                                  names={
                                    (e.ancillaryRoles && e.ancillaryRoles.length > 0)
                                      ? e.ancillaryRoles
                                      : (e.ancillaryRole ? [e.ancillaryRole] : [])
                                  }
                                />
                              </td>
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
                                  const p = e.exitReadiness;
                                  const TIER = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                                            : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                                            : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                                            :           { dark: '#f06548', light: '#fda192' };
                                  const badgeLeft = Math.max(11, Math.min(89, p));
                                  return (
                                    <Tooltip label={`Exit readiness ${p}%`} position="top" themed>
                                    <div
                                      style={{ position: 'relative', width: 120, paddingTop: 30 }}
                                    >
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
                                    </Tooltip>
                                  );
                                })()}
                              </td>
                              <td>
                                <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2`}>
                                  {e.status}
                                </span>
                              </td>
                              <td className="text-center pe-3">
                                {isExited ? (
                                  <Tooltip label="Open evidence vault" position="left" themed>
                                    <button type="button" className="exit-action-btn exit-action-btn--vault" onClick={() => setVault(e)}>
                                      <i className="ri-shield-check-line" />Evidence Vault
                                    </button>
                                  </Tooltip>
                                ) : (isInProgress || isScheduled) ? (
                                  <Tooltip label={isScheduled ? `Exit scheduled — notice starts ${noticeFromLabel || 'later'}. Continue editing.` : 'Continue exit process'} position="left" themed>
                                    <button type="button" className="exit-action-btn exit-action-btn--continue"
                                      onClick={() => setProcessing(e)}>
                                      <i className="ri-arrow-right-line" />Continue
                                    </button>
                                  </Tooltip>
                                ) : (
                                  <Tooltip label="Initiate exit process" position="left" themed>
                                    <button type="button" className="exit-action-btn exit-action-btn--initiate" onClick={() => setProcessing(e)}>
                                      <i className="ri-logout-box-r-line" />Initiate Exit
                                    </button>
                                  </Tooltip>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <WorklistPager
                    total={filtered.length}
                    page={safePage}
                    pageSize={pageSize}
                    onPage={goto}
                    onPageSize={(n) => { setPageSize(n); setPage(1); }}
                  />
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <ExitChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
      <ExitProcessModal
        employee={processing}
        onClose={() => { setProcessing(null); loadEmployees(true); }}
        onCompleted={() => loadEmployees(true)}
      />
      <EvidenceVaultModal employee={vault} onClose={() => setVault(null)} />
    </>
  );
}

function ExitChecklistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [desig, setDesig] = useState<DesigLevel>('all');
  const [type, setType]   = useState<EmpType>('all');
  const [openStages, setOpenStages] = useState<Record<number, boolean>>({ 1: true });

  useEffect(() => {
    if (open) {
      setDesig('all');
      setType('all');
      setOpenStages({ 1: true });
    }
  }, [open]);

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
        <div className="ecl-head" style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 8, border: 0, background: 'rgba(255,255,255,0.22)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, lineHeight: 1, zIndex: 3 }}
          >
            <i className="ri-close-line" />
          </button>
          <div className="ecl-head-left">
            <span className="ecl-head-icon"><i className="ri-clipboard-line" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ecl-head-title">Exit Process Checklist</div>
              <div className="ecl-head-sub">
                6 stages · {CHECKLIST_TOTAL} checkpoints · Filtered by Designation &amp; Employee Type
              </div>

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
        </div>

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

type StageStatus = 'Completed' | 'In Progress' | 'Pending';

const EXIT_STAGES = [
  { num: 1, title: 'Exit Initiation & Approval', short: 'Exit Initiation & Approval', sub: 'Record exit details, reason, dates, and collect approvals.',           icon: 'ri-clipboard-line' },
  { num: 2, title: 'Clearance & Handover',       short: 'Clearance & Handover',       sub: 'Confirm asset handover then collect every departmental clearance.',     icon: 'ri-checkbox-line' },
  { num: 3, title: 'Exit Documents Management',  short: 'Exit Documents Management',  sub: 'Generate each document, then track the signing workflow per stakeholder.', icon: 'ri-file-text-line' },
  { num: 4, title: 'Final Deactivation & Closure', short: 'Final Deactivation & Closure', sub: 'Complete final validation, lock profile, and close the exit case.',  icon: 'ri-flag-line' },
] as const;

function ExitProcessModal({ employee, onClose, onCompleted }: { employee: EmployeeRow | null; onClose: () => void; onCompleted?: () => void }) {
  const [stage, setStage] = useState<number>(1);
  const [stageStatus, setStageStatus] = useState<Record<number, StageStatus>>({});

  const [exitType, setExitType]           = useState('');
  const [reasonForExit, setReasonForExit] = useState('');
  const [noticeDate, setNoticeDate]       = useState('');
  const [lwd, setLwd]                     = useState('');
  // The dates as loaded from the server. A date already saved on an in-progress
  // exit is accepted even if it has since fallen into the past — the
  // "not in the past" rule only applies when HR newly picks/changes a date.
  const loadedNoticeRef = useRef<string>('');
  const loadedLwdRef     = useRef<string>('');
  // Notice Period End Date — auto-derived from the notice start date + the
  // employee's notice period (set at hire). Read-only; the Last Working Day
  // stays a separate, manually-set field.
  const noticePeriodEnd = useMemo(() => {
    const days = employee?.noticePeriodDays;
    if (!noticeDate || days == null || !Number.isFinite(days)) return '';
    const d = new Date(noticeDate + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }, [noticeDate, employee?.noticePeriodDays]);
  const [reportingManagerId, setReportingManagerId] = useState<number | null>(null);
  const [reportingManagerName, setReportingManagerName] = useState('');
  // The assigned reporting manager is disabled/exited — exit can't proceed until
  // HR fixes the manager on the employee record.
  const [reportingManagerDisabled, setReportingManagerDisabled] = useState(false);
  const [comments, setComments]           = useState('');
  const [businessImpact, setBusinessImpact] = useState('Low');
  const [replacementNeeded, setReplacementNeeded] = useState('Yes — Immediate');
  const [stage1Saving, setStage1Saving] = useState(false);
  type Stage1FieldKey = 'exitType' | 'reasonForExit' | 'noticeDate' | 'lwd';
  const [s1Errors, setS1Errors] = useState<Set<Stage1FieldKey>>(new Set());
  const clearS1Err = (k: Stage1FieldKey) => setS1Errors(prev => {
    if (!prev.has(k)) return prev;
    const n = new Set(prev); n.delete(k); return n;
  });
  const [advancingStage, setAdvancingStage] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const addDaysIso = (iso: string, days: number) => {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const tomorrowIso = addDaysIso(todayIso, 1);
  const fmtDateShort = (iso: string) => {
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };
  // Notice start date may be today, but not in the past — UNLESS it's the value
  // already saved on this exit (revisiting an in-progress case shouldn't flag a
  // historical date the user never touched).
  const noticeDateInvalid = !!noticeDate && noticeDate !== loadedNoticeRef.current && noticeDate < todayIso;
  // Last working day must be in the future (not today) AND on/after the notice
  // period END date (notice start + notice period). When no notice period is
  // set, fall back to "strictly after the notice start date". Same carve-out:
  // an already-saved value is accepted as-is.
  const lwdMin = noticePeriodEnd || (noticeDate ? addDaysIso(noticeDate, 1) : tomorrowIso);
  const lwdInvalid = !!lwd && lwd !== loadedLwdRef.current && (lwd <= todayIso || lwd < lwdMin);
  // Picker `min`s must never exclude the value already saved on the exit — a
  // saved date earlier than today/lwdMin would otherwise get clamped forward to
  // the min on (re)mount, replacing the loaded value with "today".
  const ndLoaded   = loadedNoticeRef.current ? loadedNoticeRef.current.slice(0, 10) : '';
  const lwdLoaded  = loadedLwdRef.current ? loadedLwdRef.current.slice(0, 10) : '';
  const noticeMin  = ndLoaded && ndLoaded < todayIso ? ndLoaded : todayIso;
  const effLwdMin  = lwdLoaded && lwdLoaded < lwdMin ? lwdLoaded : lwdMin;
  // Exit can only be finalised on/after the Last Working Day — you can't close
  // out an employee before their last day has actually arrived.
  const lwdReached = !!lwd && lwd <= todayIso;

  const [clearances, setClearances] = useState<{ checked: boolean; status: string }[]>([
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
    { checked: false, status: 'Pending' },
  ]);
  const [handoverNotes, setHandoverNotes] = useState('');
  const [assetReturns, setAssetReturns]   = useState<Record<number, { checked: boolean; status: string }>>({});


  type TplSigner = { role_name?: string | null; designation_name?: string | null; action?: string | null; days?: number | null };
  type ExitTemplate = {
    id: number;
    code?: string | null;
    name?: string | null;
    doc_type?: string | null;
    status?: string | null;
    signing_mode?: 'Sequential' | 'Parallel' | string | null;
    signers?: TplSigner[] | string | null;
    trigger_point?: { module_name?: string | null } | null;
  };
  const [exitTemplates, setExitTemplates] = useState<ExitTemplate[]>([]);
  const [exitTplLoading, setExitTplLoading] = useState(false);
  type ExitMatchMeta = {
    employee_category: string | null;
    role_type:         string | null;
    department_name:   string | null;
    designation_name:  string | null;
  };
  const [exitMatchMeta, setExitMatchMeta] = useState<ExitMatchMeta | null>(null);
  useEffect(() => {
    if (!employee) { setExitTemplates([]); setExitMatchMeta(null); return; }
    let cancelled = false;
    setExitTplLoading(true);
    api.get('/hr-document-templates/match', {
      params: { employee_id: employee.id, trigger_keyword: 'exit' },
    })
      .then(({ data }) => {
        if (cancelled) return;
        setExitTemplates(Array.isArray(data?.templates) ? data.templates : []);
        setExitMatchMeta({
          employee_category: data?.employee_category ?? null,
          role_type:         data?.role_type         ?? null,
          department_name:   data?.department_name   ?? null,
          designation_name:  data?.designation_name  ?? null,
        });
      })
      .catch(() => { if (!cancelled) { setExitTemplates([]); setExitMatchMeta(null); } })
      .finally(() => { if (!cancelled) setExitTplLoading(false); });
    return () => { cancelled = true; };
  }, [employee?.id]);

  const toast = useToast();
  type SignerState = {
    index: number; role_name: string; action: string; days: number;
    user_id: number | null; name: string;
    status: 'Pending' | 'Done' | 'Rejected' | 'Skipped';
    acted_at: string | null; signed_name: string | null; note: string | null;
  };
  type SignatureRun = {
    id: number; code: string | null;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
    template_id: number;
    employee_id: number;
    signers: SignerState[];
    current_index: number;
    created_at: string;
  };
  const [runs, setRuns] = useState<SignatureRun[]>([]);
  const fetchRuns = async () => {
    if (!employee) { setRuns([]); return; }
    try {
      const { data } = await api.get('/hr-document-signatures', { params: { employee_id: employee.id } });
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    }
  };
  useEffect(() => {
    if (!employee) { setRuns([]); return; }
    fetchRuns();
  }, [employee?.id]);
  const runByTemplateId = useMemo(() => {
    const m = new Map<number, SignatureRun>();
    for (const r of runs) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [runs]);

  const [generatedTplIds, setGeneratedTplIds] = useState<Set<number>>(new Set());
  const fetchGenerated = async () => {
    if (!employee) { setGeneratedTplIds(new Set()); return; }
    try {
      const { data } = await api.get('/hr-generated-documents', { params: { employee_id: employee.id } });
      const ids = Array.isArray(data) ? data.map((d: any) => Number(d.template_id)) : [];
      setGeneratedTplIds(new Set(ids));
    } catch {
      setGeneratedTplIds(new Set());
    }
  };
  useEffect(() => {
    if (!employee) { setGeneratedTplIds(new Set()); return; }
    fetchGenerated();
  }, [employee?.id]);

  const [previewOpen, setPreviewOpen]     = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTpl, setPreviewTpl]       = useState<ExitTemplate | null>(null);
  const [previewHtml, setPreviewHtml]     = useState<string>('');
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  const [generating, setGenerating]       = useState(false);
  const [expandedDocs, setExpandedDocs]   = useState<Set<number>>(new Set());
  const toggleDoc = (id: number) =>
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const handleView = async (tpl: ExitTemplate) => {
    if (!employee) return;
    setPreviewTpl(tpl);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const { data } = await api.get(`/hr-document-templates/${tpl.id}/preview`, {
        params: { employee_id: employee.id },
      });
      setPreviewHtml((data?.content_html as string) || '<p style="color:#9ca3af;font-style:italic;">(empty template)</p>');
      setPreviewMissing(Array.isArray(data?.tokens_missing) ? data.tokens_missing : []);
    } catch (err: any) {
      toast.error('Could not load preview', err?.response?.data?.message || 'Please try again.');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = async (tpl: ExitTemplate) => {
    if (!employee || generating) return;
    setGenerating(true);
    try {
      const resp = await api.get(`/hr-document-templates/${tpl.id}/generate`, {
        params: { employee_id: employee.id },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(employee.name || 'employee').replace(/\s+/g, '-')}-${tpl.code || tpl.id}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Document generated', `${tpl.code || tpl.name || 'Document'} downloaded.`);
    } catch (err: any) {
      toast.error('Could not generate', err?.response?.data?.message || 'Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const [downloadingRunId, setDownloadingRunId] = useState<number | null>(null);
  const downloadSignedRun = async (run: { id: number; code?: string | null }) => {
    if (downloadingRunId !== null) return;
    setDownloadingRunId(run.id);
    try {
      const resp = await api.get(`/hr-document-signatures/${run.id}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${run.code || `doc-${run.id}`}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Signed PDF saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDownloadingRunId(null);
    }
  };

  const [remindingRunId, setRemindingRunId] = useState<number | null>(null);
  const sendReminder = async (run: SignatureRun) => {
    if (remindingRunId !== null) return;
    setRemindingRunId(run.id);
    try {
      const res = await api.post(`/hr-document-signatures/${run.id}/remind`);
      const signer = res?.data?.signer || run.signers?.[run.current_index]?.name || 'the current signer';
      toast.success('Reminder sent', `${signer} will see it in their Inbox.`);
      fetchRuns();
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || 'Please try again.';
      toast.error(status === 429 ? 'Slow down' : 'Could not send reminder', msg);
    } finally {
      setRemindingRunId(null);
    }
  };

  const [genTpl, setGenTpl] = useState<ExitTemplate | null>(null);

  const [sendForTpl, setSendForTpl] = useState<ExitTemplate | null>(null);
  const [sending, setSending] = useState(false);
  const openSend = (tpl: ExitTemplate) => setSendForTpl(tpl);
  const confirmSend = async () => {
    if (!sendForTpl || !employee) return;
    setSending(true);
    try {
      const { data } = await api.post('/hr-document-signatures', {
        template_id: sendForTpl.id,
        employee_id: employee.id,
      });
      toast.success('Sent for signing', `${data.code || data.template?.code || 'Document'} entered the workflow.`);
      setSendForTpl(null);
      fetchRuns();
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const parseSigners = (raw: ExitTemplate['signers']): TplSigner[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  };

  const [validation, setValidation] = useState<boolean[]>([false, false, false, false, false]);
  const [draftSaving, setDraftSaving] = useState(false);
  const [completing, setCompleting]   = useState(false);
  const [empStatus, setEmpStatus] = useState('Active');
  const [profileLock, setProfileLock] = useState('Unlocked');
  const [exitCaseStatus, setExitCaseStatus] = useState('Open');
  const [hrSignOff, setHrSignOff] = useState('Pending');

  useEffect(() => {
    if (employee) {
      setStage(1);
      setStageStatus({ 1: 'In Progress' });
    }
  }, [employee?.id]);

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    api.get(`/employees/${employee.id}/exit`)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setExitType(String(data.exit_type ?? ''));
        setReasonForExit(String(data.reason_for_exit ?? ''));
        setNoticeDate(data.notice_date ? String(data.notice_date) : '');
        setLwd(data.last_working_day ? String(data.last_working_day) : '');
        loadedNoticeRef.current = data.notice_date ? String(data.notice_date) : '';
        loadedLwdRef.current    = data.last_working_day ? String(data.last_working_day) : '';
        setReportingManagerId(data.reporting_manager_id ?? null);
        setReportingManagerName(data.reporting_manager?.display_name || '');
        setReportingManagerDisabled(!!data.reporting_manager?.disabled);
        setComments(String(data.comments ?? ''));
        setBusinessImpact(String(data.business_impact ?? 'Low'));
        setReplacementNeeded(String(data.replacement_required ?? 'Yes — Immediate'));

        if (Array.isArray(data.clearances) && data.clearances.length) {
          setClearances(data.clearances.map((c: any) => ({
            checked: !!c?.checked,
            status: String(c?.status ?? 'Pending'),
          })));
        }
        if (data.asset_returns && typeof data.asset_returns === 'object') {
          setAssetReturns(data.asset_returns as Record<number, { checked: boolean; status: string }>);
        }
        setHandoverNotes(String(data.handover_notes ?? ''));

        if (Array.isArray(data.validation) && data.validation.length) {
          setValidation(data.validation.map((v: any) => !!v));
        }
        setEmpStatus(String(data.final_employee_status ?? data.employee_status ?? 'Active'));
        setProfileLock(String(data.profile_lock ?? 'Unlocked'));
        setExitCaseStatus(String(data.exit_case_status ?? 'Open'));
        setHrSignOff(String(data.hr_sign_off ?? 'Pending'));

        if (data.stage_status && typeof data.stage_status === 'object') {
          setStageStatus(data.stage_status as Record<number, StageStatus>);
        }
        const savedStage = Number(data.current_stage);
        if (savedStage >= 1 && savedStage <= EXIT_STAGES.length) setStage(savedStage);
      })
      .catch(() => {  });
    return () => { cancelled = true; };
  }, [employee?.id]);

  const exitPending = useMemo(() => {
    const CLR = ['Manager', 'IT', 'Admin', 'Finance', 'Legal / Compliance'];
    const CHK = ['All clearances obtained', 'All assets handed over', 'All access revoked', 'Exit documents signed', 'Exit interview completed'];
    const items: string[] = [];
    clearances.forEach((c, i) => { if (c.status !== 'Approved') items.push(`${CLR[i]} clearance — ${c.status || 'Pending'}`); });
    validation.forEach((v, i) => { if (!v) items.push(CHK[i]); });
    // Exit may complete ONLY when HR Final Sign-off is Approved — a Rejected
    // (or still-Pending) sign-off must block completion. (QA bug fix.)
    if (hrSignOff !== 'Approved') items.push(`HR final sign-off — ${hrSignOff === 'Rejected' ? 'Rejected' : 'Pending'}`);
    return items;
  }, [clearances, validation, hrSignOff]);

  if (!employee) return null;

  const statusOf = (n: number): StageStatus => stageStatus[n] || (n === stage ? 'In Progress' : 'Pending');

  const rawStagePct = (n: number): number => {
    if (n === 1) {
      const items = [
        !!String(exitType).trim(),
        !!String(reasonForExit).trim(),
        !!String(lwd).trim(),
        !!reportingManagerId,
      ];
      return Math.round((items.filter(Boolean).length / items.length) * 100);
    }
    if (n === 2) {
      const assetIds  = Object.keys(assetReturns);
      const assetDone = assetIds.filter(k => assetReturns[Number(k)]?.status === 'Handed Over').length;
      const clrDone   = clearances.filter(c => c.status === 'Approved').length;
      const notesDone = handoverNotes.trim() ? 1 : 0;
      const total = assetIds.length + clearances.length + 1;
      const done  = assetDone + clrDone + notesDone;
      return total === 0 ? 0 : Math.round((done / total) * 100);
    }
    if (n === 3) {
      const total = exitTemplates.length;
      if (total === 0) return 0;
      const done = exitTemplates.filter(t => runByTemplateId.get(t.id)?.status === 'Completed').length;
      return Math.round((done / total) * 100);
    }
    if (n === 4) {
      // Final actions now expose only Employee Status + HR Final Sign-off.
      // Only HR Final Sign-off (Approved) is a real completion gate — Employee
      // Status is informational and must NOT hold the progress below 100%.
      const validationDone = validation.filter(Boolean).length;
      const finalsDone = (hrSignOff === 'Approved' ? 1 : 0);
      const total = validation.length + 1;
      return Math.round(((validationDone + finalsDone) / total) * 100);
    }
    return 0;
  };

  const effStatusOf = (n: number): StageStatus => {
    // Stage 2 is only truly complete once EVERY clearance is approved — don't
    // let a stale persisted "Completed" show 100% while clearances are pending.
    if (n === 2 && !clearances.every(c => c.status === 'Approved')) {
      return (n === stage || rawStagePct(2) > 0 || stageStatus[2] === 'In Progress') ? 'In Progress' : 'Pending';
    }
    // Stage 3 is only complete once EVERY exit document is fully SIGNED. Merely
    // sending a document (run Pending/In Progress) must not flip it to 100%.
    if (n === 3) {
      const total = exitTemplates.length;
      const allSigned = total > 0 && exitTemplates.every(t => runByTemplateId.get(t.id)?.status === 'Completed');
      if (!allSigned) {
        const anySent = exitTemplates.some(t => runByTemplateId.has(t.id));
        return (n === stage || anySent || rawStagePct(3) > 0 || stageStatus[3] === 'In Progress') ? 'In Progress' : 'Pending';
      }
    }
    if (stageStatus[n] === 'Completed' || rawStagePct(n) === 100) return 'Completed';
    if (n === stage || rawStagePct(n) > 0 || stageStatus[n] === 'In Progress') return 'In Progress';
    return 'Pending';
  };

  const completed = EXIT_STAGES.filter(s => effStatusOf(s.num) === 'Completed').length;
  const progressPct = Math.round((completed / EXIT_STAGES.length) * 100);

  const advance = () => {
    if (stage < EXIT_STAGES.length) {
      setStage(stage + 1);
      setStageStatus(prev => ({
        ...prev,
        [stage + 1]: prev[stage + 1] === 'Completed' ? 'Completed' : 'In Progress',
      }));
    }
  };
  const markStageCompleted = (n: number) => {
    setStageStatus(prev => ({ ...prev, [n]: 'Completed' }));
  };
  const goBack = () => {
    if (stage > 1) {
      setStage(stage - 1);
      setStageStatus(prev => ({ ...prev, [stage - 1]: 'In Progress' }));
    }
  };
  const buildExitPayload = () => ({
    exit_type:             exitType || null,
    reason_for_exit:       reasonForExit.trim() || null,
    notice_date:           noticeDate || null,
    last_working_day:      lwd || null,
    reporting_manager_id:  reportingManagerId,
    comments:              comments.trim() || null,
    business_impact:       businessImpact || null,
    replacement_required:  replacementNeeded || null,
    clearances,
    asset_returns:         assetReturns,
    handover_notes:        handoverNotes.trim() || null,
    validation,
    final_employee_status: empStatus || null,
    profile_lock:          profileLock || null,
    hr_sign_off:           hrSignOff || null,
    stage_status:          stageStatus,
    current_stage:         stage,
  });

  const persistDraft = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!employee || draftSaving) return false;
    setDraftSaving(true);
    try {
      await api.put(`/employees/${employee.id}/exit`, buildExitPayload());
      if (!opts?.silent) toast.success('Draft saved', 'Your progress on this stage was saved.');
      return true;
    } catch (err: any) {
      toast.error('Could not save draft', err?.response?.data?.message || 'Please try again.');
      return false;
    } finally {
      setDraftSaving(false);
    }
  };

  const completeExit = async () => {
    if (!employee || completing) return;

    // Can't finalise before the employee's last working day has arrived.
    if (!lwdReached) {
      toast.error(
        'Exit can’t be completed yet',
        lwd
          ? `You can complete this exit on or after the last working day (${fmtDateShort(lwd)}).`
          : 'Set the last working day in Stage 1 first.',
      );
      setStage(1);
      return;
    }

    // HARD gate: every matched exit document must be fully SIGNED (run
    // Completed) before the exit can be finalised. The "Exit documents signed"
    // checklist box is a manual tick and was being used to bypass real signing
    // status — this checks the actual signing runs instead. (QA bug fix.)
    const unsignedDocs = exitTemplates.filter(t => runByTemplateId.get(t.id)?.status !== 'Completed');
    if (exitTemplates.length > 0 && unsignedDocs.length) {
      toast.error(
        `Exit can't be completed — ${unsignedDocs.length} document${unsignedDocs.length > 1 ? 's' : ''} not fully signed`,
        'Every exit document must be sent and signed by all required signatories first. Finish them in “Exit Documents Management”.',
      );
      setStage(3);
      return;
    }

    if (exitPending.length) {
      toast.error(
        `Exit can't be completed — ${exitPending.length} item${exitPending.length > 1 ? 's' : ''} pending`,
        exitPending.join('  •  '),
      );
      setStage(clearances.some(c => c.status !== 'Approved') ? 2 : 4);
      return;
    }

    setCompleting(true);
    try {
      await api.post(`/employees/${employee.id}/exit/complete`, buildExitPayload());
      markStageCompleted(stage);
      toast.success('Exit completed', `${employee.name} has been marked as exited and their login disabled.`);
      onCompleted?.();
      onClose();
    } catch (err: any) {
      toast.error('Could not complete exit', err?.response?.data?.message || 'Please try again.');
    } finally {
      setCompleting(false);
    }
  };

  const saveStage1 = async (): Promise<boolean> => {
    if (!employee || stage1Saving) return false;
    const missing: string[] = [];
    const errs = new Set<Stage1FieldKey>();
    if (!exitType.trim())      { missing.push('Exit Type');        errs.add('exitType'); }
    if (!reasonForExit.trim()) { missing.push('Reason for Exit');  errs.add('reasonForExit'); }
    if (!noticeDate)           { missing.push('Notice Start Date'); errs.add('noticeDate'); }
    if (!lwd)                  { missing.push('Last Working Day'); errs.add('lwd'); }
    if (missing.length) {
      setS1Errors(errs);
      toast.error(
        'Fill the required fields',
        missing.length === 1
          ? `${missing[0]} is required.`
          : `${missing.slice(0, -1).join(', ')} and ${missing.slice(-1)} are required.`,
      );
      return false;
    }
    setS1Errors(new Set());
    // Block when the assigned reporting manager is disabled/exited — HR must
    // reassign the manager on the employee record first (we don't pick one here).
    if (reportingManagerDisabled) {
      toast.error(
        'Reporting manager unavailable',
        'This employee’s reporting manager is disabled or has already exited. Change the reporting manager on the employee record (Add / Edit Employee) before continuing the exit.',
      );
      return false;
    }
    if (noticeDateInvalid || lwdInvalid) {
      toast.error(
        'Fix the highlighted dates',
        noticeDateInvalid && lwdInvalid
          ? 'Notice start date cannot be in the past, and the last working day must be a future date on/after it.'
          : noticeDateInvalid
            ? 'Notice start date cannot be in the past.'
            : 'Last working day must be a future date on/after the notice start date.',
      );
      return false;
    }
    setStage1Saving(true);
    try {
      await api.put(`/employees/${employee.id}/exit`, {
        exit_type:            exitType || null,
        reason_for_exit:      reasonForExit.trim() || null,
        notice_date:          noticeDate || null,
        last_working_day:     lwd || null,
        reporting_manager_id: reportingManagerId,
        comments:             comments.trim() || null,
        business_impact:      businessImpact || null,
        replacement_required: replacementNeeded || null,
      });
      return true;
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      const firstFieldErr =
        fieldErrors && typeof fieldErrors === 'object'
          ? (Array.isArray(Object.values(fieldErrors)[0])
              ? (Object.values(fieldErrors)[0] as string[])[0]
              : String(Object.values(fieldErrors)[0]))
          : null;
      toast.error(
        'Could not save exit details',
        firstFieldErr || err?.response?.data?.message || err?.message || 'Please try again.',
      );
      return false;
    } finally {
      setStage1Saving(false);
    }
  };

  const current = EXIT_STAGES[stage - 1];
  const isLastStage = stage === EXIT_STAGES.length;

  return (
    <>
    <Modal isOpen={!!employee} toggle={onClose} centered size="xl" backdrop="static" contentClassName="border-0 ep-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="ep-head">
          <div className="ep-head-top">
            <span className="ep-head-avatar" style={{ background: `linear-gradient(135deg, ${employee.accent}, ${employee.accent}cc)` }}>
              {employee.initials}
            </span>
            <div className="ep-head-text">
              <div className="ep-head-title-row">
                <div className="ep-head-title">{employee.name}</div>
              </div>
              <div className="ep-head-sub">
                {employee.empId} · {employee.department} · {employee.designation}
              </div>
            </div>
            <div className="ep-head-right">
              <div className="ep-head-chips">
                <span className="ep-head-chip"><i className="ri-time-line" />Status: {statusOf(stage)}</span>
                <span className="ep-head-chip ep-head-chip--profile">
                  <MiniProgressRing value={progressPct} />
                  <span className="ep-head-chip-profile-text">
                    <span className="ep-head-chip-profile-label">Profile</span>
                    <span className="ep-head-chip-profile-sub">Completion</span>
                  </span>
                </span>
              </div>
              
            </div>
            <button type="button" className="ep-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        <div className="ep-body">
          <aside className="ep-sidebar">
            {EXIT_STAGES.map(s => {
              const st = effStatusOf(s.num);
              const stagePct = st === 'Completed' ? 100 : rawStagePct(s.num);
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
                  <span className="ep-stage-pct">{stagePct}%</span>
                </button>
              );
            })}
          </aside>

          <section className="ep-content">

            {stage === 1 && (
              <>
                <div className="ep-section-label">Exit Details</div>
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <EpField label="Exit Type" required invalid={s1Errors.has('exitType')}>
                      <EpSelect
                        value={exitType}
                        onChange={(v) => { setExitType(v); clearS1Err('exitType'); }}
                        options={['Resignation', 'Termination', 'Retirement', 'End of Contract', 'Absconding', 'Other']}
                        invalid={s1Errors.has('exitType')}
                      />
                      {s1Errors.has('exitType') && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />Exit type is required.
                        </div>
                      )}
                    </EpField>
                  </Col>
                  <Col md={6}>
                    <EpField label="Reason for Exit" required invalid={s1Errors.has('reasonForExit')}>
                      <EpInput
                        value={reasonForExit}
                        onChange={(v) => { setReasonForExit(v); clearS1Err('reasonForExit'); }}
                        placeholder="Describe the reason for exit"
                        maxLength={60}
                        invalid={s1Errors.has('reasonForExit')}
                      />
                      {s1Errors.has('reasonForExit') && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />Reason for exit is required.
                        </div>
                      )}
                    </EpField>
                  </Col>
                  <Col md={6}>
                    <EpField label="Notice Start Date" required invalid={s1Errors.has('noticeDate') || noticeDateInvalid}>
                      <EpInput
                        type="date"
                        value={noticeDate}
                        onChange={(v) => {
                          setNoticeDate(v); clearS1Err('noticeDate');
                          if (v && v !== loadedNoticeRef.current && v < todayIso) toast.warning('Invalid notice start date', 'Notice start date cannot be in the past.');
                        }}
                        min={noticeMin}
                        invalid={s1Errors.has('noticeDate') || noticeDateInvalid}
                      />
                      {(s1Errors.has('noticeDate') || noticeDateInvalid) && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />
                          {noticeDateInvalid ? 'Notice start date cannot be in the past.' : 'Notice start date is required.'}
                        </div>
                      )}
                    </EpField>
                  </Col>
                  <Col md={6}>
                    <EpField label={`Notice Period End Date${employee?.noticePeriodLabel ? ` (${employee.noticePeriodLabel})` : ''}`}>
                      <EpInput
                        type="date"
                        value={noticePeriodEnd}
                        disabled
                        onChange={() => {}}
                      />
                      <div className="ep-hint" style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 4 }}>
                        {employee?.noticePeriodDays != null
                          ? 'Auto-calculated from the notice start date + the employee’s notice period.'
                          : 'No notice period set on this employee — set it on the employee record to auto-fill.'}
                      </div>
                    </EpField>
                  </Col>
                  <Col md={6}>
                    <EpField label="Last Working Day" required invalid={s1Errors.has('lwd') || lwdInvalid}>
                      <EpInput
                        type="date"
                        value={lwd}
                        onChange={(v) => {
                          setLwd(v); clearS1Err('lwd');
                          if (v && v !== loadedLwdRef.current) {
                            if (v <= todayIso) {
                              toast.warning('Invalid last working day', 'Last working day cannot be today or a past date.');
                            } else if (v < lwdMin) {
                              toast.warning(
                                'Invalid last working day',
                                noticePeriodEnd
                                  ? `Last working day must be on or after the notice period end date (${fmtDateShort(noticePeriodEnd)}).`
                                  : 'Last working day must be after the notice start date.',
                              );
                            }
                          }
                        }}
                        min={effLwdMin}
                        invalid={s1Errors.has('lwd') || lwdInvalid}
                      />
                      {(s1Errors.has('lwd') || lwdInvalid) && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />
                          {lwdInvalid
                            ? (lwd <= todayIso
                                ? 'Last working day cannot be today or a past date.'
                                : (noticePeriodEnd
                                    ? `Last working day must be on or after the notice period end date (${fmtDateShort(noticePeriodEnd)}).`
                                    : 'Last working day must be after the notice start date.'))
                            : 'Last working day is required.'}
                        </div>
                      )}
                    </EpField>
                  </Col>
                  <Col xs={12}>
              
                  </Col>
                  <Col md={6}>
                    <EpField label="Reporting Manager" invalid={reportingManagerDisabled}>
                      <EpInput
                        value={reportingManagerName || '— Not set on employee record —'}
                        onChange={() => {}}
                        disabled
                        invalid={reportingManagerDisabled}
                      />
                      {reportingManagerDisabled && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />
                          This reporting manager is disabled / has exited. Change it on the employee record (Add / Edit Employee) before continuing.
                        </div>
                      )}
                    </EpField>
                  </Col>
                  <Col xs={12}>
                    <EpField label="Comments / Notes">
                      <textarea
                        className="ep-textarea"
                        rows={2}
                        placeholder="Enter any additional comments…"
                        value={comments}
                        onChange={e => setComments(e.target.value)}
                      />
                    </EpField>
                  </Col>
                </Row>

                <div className="ep-section-label">Impact Assessment</div>
                <Row className="g-2">
                  <Col md={6}>
                    <EpApprovalCard icon="ri-flashlight-line" title="Business Impact">
                      <EpSelect value={businessImpact} onChange={setBusinessImpact} options={['Low', 'Medium', 'High', 'Critical']} />
                    </EpApprovalCard>
                  </Col>
                  <Col md={6}>
                    <EpApprovalCard icon="ri-question-line" title="Replacement Required">
                      <EpSelect value={replacementNeeded} onChange={setReplacementNeeded} options={['Yes — Immediate', 'Yes — Within 30 days', 'Yes — Within 90 days', 'No']} />
                    </EpApprovalCard>
                  </Col>
                </Row>
              </>
            )}

            {stage === 2 && (
              <>
                <div className="ep-section-label">Asset Handover</div>
                {(() => {
                  const list: { id: number; label: string; code: string }[] = [];
                  if (employee.laptopAsset) {
                    const a = employee.laptopAsset;
                    list.push({ id: a.id, label: a.asset_name, code: a.code || a.asset_number || '—' });
                  }
                  if (employee.mobileAsset) {
                    const a = employee.mobileAsset;
                    list.push({ id: a.id, label: a.asset_name, code: a.code || a.asset_number || '—' });
                  }
                  for (const a of employee.otherAssets) {
                    list.push({ id: a.id, label: a.asset_name, code: a.code || a.asset_number || '—' });
                  }
                  if (list.length === 0) {
                    return (
                      <div className="ep-checklist mb-3" style={{ padding: 16, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
                        <i className="ri-inbox-line" style={{ fontSize: 22, marginRight: 6, verticalAlign: 'middle' }} />
                        No assets are currently assigned to this employee.
                      </div>
                    );
                  }
                  return (
                    <div className="ep-checklist mb-3">
                      {list.map(a => {
                        const row = assetReturns[a.id] ?? { checked: false, status: 'Pending' };
                        return (
                          <div key={a.id} className="ep-check-row">
                            <span className="ep-check-box" style={{
                              background: row.status === 'Handed Over' ? '#10b981' : row.status === 'Not Returned' ? '#ef4444' : 'transparent',
                              borderColor: row.status === 'Handed Over' ? '#10b981' : row.status === 'Not Returned' ? '#ef4444' : 'var(--vz-border-color)',
                            }}>
                              {row.status === 'Handed Over' && <i className="ri-check-line" style={{ color: '#fff' }} />}
                              {row.status === 'Not Returned' && <i className="ri-close-line" style={{ color: '#fff' }} />}
                            </span>
                            <span className="ep-check-label">
                              {a.label} <span className="ep-asset-code">({a.code})</span>
                            </span>
                            <div style={{ width: 160 }}>
                              <EpSelect
                                value={row.status}
                                onChange={v => setAssetReturns(prev => ({
                                  ...prev,
                                  [a.id]: { checked: v === 'Handed Over', status: v },
                                }))}
                                options={['Pending', 'Handed Over', 'Not Returned']}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="ep-section-label">Clearance Status</div>
                <div className="ep-checklist mb-2">
                  {['Manager Clearance','IT Clearance','Admin Clearance','Finance Clearance','Legal / Compliance'].map((label, idx) => (
                    <div key={idx} className="ep-check-row">
                      <input
                        type="checkbox"
                        checked={clearances[idx].checked}
                        onChange={() => setClearances(prev => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked, status: !c.checked ? 'Approved' : 'Pending' } : c))}
                      />
                      <span className="ep-check-box" style={{
                        background: clearances[idx].status === 'Approved' ? '#10b981' : clearances[idx].status === 'Rejected' ? '#ef4444' : 'transparent',
                        borderColor: clearances[idx].status === 'Approved' ? '#10b981' : clearances[idx].status === 'Rejected' ? '#ef4444' : 'var(--vz-border-color)',
                      }}>
                        {clearances[idx].status === 'Approved' && <i className="ri-check-line" style={{ color: '#fff' }} />}
                        {clearances[idx].status === 'Rejected' && <i className="ri-close-line" style={{ color: '#fff' }} />}
                      </span>
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

            {stage === 3 && (() => {
              const totalDocs = exitTemplates.length;
              // "Sent" = documents that have entered the signing workflow (a run exists).
              const sentCount = exitTemplates.filter(t => runByTemplateId.has(t.id)).length;
              const pendingCount = exitTemplates.filter(t => {
                const r = runByTemplateId.get(t.id);
                return r && (r.status === 'Pending' || r.status === 'In Progress');
              }).length;
              const completedCount = exitTemplates.filter(t => runByTemplateId.get(t.id)?.status === 'Completed').length;
              const KPIS = [
                { label: 'Total Docs',   value: totalDocs,      icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
                { label: 'Sent',         value: sentCount,      icon: 'ri-send-plane-line',      gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
                { label: 'Pending Sign', value: pendingCount,   icon: 'ri-time-line',            gradient: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
                { label: 'Completed',    value: completedCount, icon: 'ri-check-double-line',    gradient: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 60%, #38bdf8 100%)', deep: '#0369a1' },
              ];
              return (
                <>
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

                  <div className="ep-section-label">Exit Documents</div>

                  {exitMatchMeta && (
                    <div className="d-flex align-items-center gap-2 flex-wrap mb-3 ep-match-banner">
                      <i className="ri-magic-line ep-match-icon" />
                      <strong className="ep-match-title">Matching templates for</strong>
                      <span className="ep-match-text">
                        Department <strong>{exitMatchMeta.department_name || '—'}</strong> → Category{' '}
                        <span className="ep-match-chip">{exitMatchMeta.employee_category || '—'}</span>
                        {exitMatchMeta.role_type && (
                          <>{' '}· Level{' '}<span className="ep-match-chip">{exitMatchMeta.role_type}</span></>
                        )}
                        {' '}· Trigger contains{' '}
                        <span className="ep-match-chip">“exit”</span>
                      </span>
                    </div>
                  )}

                  {exitTplLoading ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--vz-secondary-color)', fontSize: 12.5, border: '1px dashed var(--vz-border-color)', borderRadius: 10, marginBottom: 12 }}>
                      <i className="ri-loader-4-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
                      Looking up exit-trigger templates…
                    </div>
                  ) : exitTemplates.length === 0 ? (
                    <div style={{ padding: 18, textAlign: 'left', color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 10, marginBottom: 12, fontSize: 12.5 }}>
                      <div style={{ textAlign: 'center', marginBottom: 10 }}>
                        <i className="ri-inbox-line" style={{ fontSize: 24, display: 'block', marginBottom: 6 }} />
                        <strong>No matching exit-trigger templates found.</strong>
                      </div>
                      <div style={{ paddingTop: 8, borderTop: '1px dashed var(--vz-border-color)' }}>
                        To surface a template here it must be created under <strong>HR &gt; Document &amp; Evidence &gt; Document Templates</strong> with:
                        <ul style={{ marginBottom: 0, paddingLeft: 20, marginTop: 6 }}>
                          <li>Status = <strong>Active</strong></li>
                          <li>Trigger Point = any row whose name contains <strong>“exit”</strong> (e.g. <em>Exit Management</em>, <em>Exit process trigger point</em>)</li>
                          {exitMatchMeta && (
                            <>
                              <li>Employee Category = <strong>{exitMatchMeta.employee_category || '—'}</strong> (this employee's department maps here)</li>
                              {exitMatchMeta.role_type
                                ? <li>Role Type = <strong>{exitMatchMeta.role_type}</strong> (this employee's designation level)</li>
                                : <li style={{ color: '#b45309' }}>⚠ This employee has no designation level set, so the role-type filter is skipped. Set a level on their designation master row.</li>}
                            </>
                          )}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="ep-doc-list" style={{ marginBottom: 16 }}>
                      {exitTemplates.map(tpl => {
                        const signers = parseSigners(tpl.signers);
                        const run = runByTemplateId.get(tpl.id) || null;
                        const canGenerate = tpl.status === 'Active';
                        const runInFlight = !!run && (run.status === 'Pending' || run.status === 'In Progress');
                        const runCompleted = run?.status === 'Completed';
                        const canSend = canGenerate && (!run || run.status === 'Rejected' || run.status === 'Cancelled');
                        const runTone =
                          run?.status === 'Completed'  ? { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' }
                          : run?.status === 'Rejected'  ? { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' }
                          : run?.status === 'Cancelled' ? { bg: '#e5e7eb', fg: '#374151', dot: '#6b7280' }
                          : run?.status === 'In Progress' ? { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' }
                          : run                          ? { bg: '#dbeafe', fg: '#1d4ed8', dot: '#3b82f6' }
                          : null;
                        const isExpanded = expandedDocs.has(tpl.id);
                        return (
                          <div key={`tpl-${tpl.id}`} className={`ep-doc-card${isExpanded ? ' is-open' : ''}`}>
                            <div className="ep-doc-row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                              <span className="ep-doc-icon"><i className="ri-file-text-line" /></span>
                              <div className="ep-doc-info">
                                <div className="ep-doc-name">
                                  {tpl.name || '(unnamed template)'}{' '}
                                  {tpl.code && (
                                    <span className="ep-doc-code">{tpl.code}</span>
                                  )}
                                  {run && runTone && (
                                    <span className="ep-doc-status-badge" style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 999, background: runTone.bg, color: runTone.fg, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, ['--pill-fg' as string]: runTone.fg } as React.CSSProperties}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: runTone.dot }} />
                                      {run.status}
                                    </span>
                                  )}
                                </div>
                                <div className="ep-doc-sub">
                                  {tpl.doc_type || 'Document'}
                                  {tpl.trigger_point?.module_name ? ` · Trigger: ${tpl.trigger_point.module_name}` : ''}
                                  {tpl.signing_mode ? ` · ${tpl.signing_mode} signing` : ''}
                                  {signers.length ? ` · ${signers.length} signer${signers.length === 1 ? '' : 's'}` : ''}
                                </div>
                              </div>
                              <span className={`ep-doc-tag ${tpl.status === 'Active' ? 'ep-doc-tag--pending' : 'ep-doc-tag--blank'}`}>
                                {tpl.status || 'Draft'}
                              </span>
                              <Tooltip label="Preview with this employee's data" position="bottom" themed>
                                <button type="button" className="ep-doc-btn ep-doc-btn--ghost" onClick={() => handleView(tpl)}>
                                  <i className="ri-eye-line" />View
                                </button>
                              </Tooltip>
                              {runInFlight && run && (() => {
                                const isReminding = remindingRunId === run.id;
                                return (
                                  <Tooltip label="Send a reminder to the current pending signer" position="bottom" themed>
                                    <button
                                      type="button"
                                      className="ep-doc-btn"
                                      onClick={() => sendReminder(run)}
                                      disabled={isReminding}
                                      style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff', border: 0, ...(isReminding ? { opacity: 0.65, cursor: 'wait' } : {}) }}
                                    >
                                      {isReminding
                                        ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Sending…</>
                                        : <><i className="ri-mail-send-line" />Reminder</>}
                                    </button>
                                  </Tooltip>
                                );
                              })()}
                              {canSend && (
                                <Tooltip label="Preview the document (fills custom fields if any) then send for signing" position="bottom" themed>
                                  <button
                                    type="button"
                                    className="ep-doc-btn"
                                    onClick={() => setGenTpl(tpl)}
                                    style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', border: 0 }}
                                  >
                                    <i className="ri-send-plane-line" />Send for Signature
                                  </button>
                                </Tooltip>
                              )}
                              {runCompleted && run && (() => {
                                const isDownloading = downloadingRunId === run.id;
                                return (
                                  <Tooltip label="Download the signed PDF — all signatures complete" position="bottom" themed>
                                    <button
                                      type="button"
                                      className="ep-doc-btn ep-doc-btn--done"
                                      onClick={() => downloadSignedRun(run)}
                                      disabled={isDownloading}
                                      style={isDownloading ? { opacity: 0.65, cursor: 'wait' } : undefined}
                                    >
                                      {isDownloading
                                        ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                                        : <><i className="ri-file-pdf-2-line" />Download</>}
                                    </button>
                                  </Tooltip>
                                );
                              })()}
                              <button
                                type="button"
                                onClick={() => toggleDoc(tpl.id)}
                                className="ep-doc-btn ep-doc-btn--ghost"
                                aria-expanded={isExpanded}
                                title={isExpanded ? 'Hide signing workflow' : 'Show signing workflow'}
                              >
                                <i className="ep-doc-chev ri-arrow-down-s-line" />
                              </button>
                            </div>

                            {isExpanded && !(signers.length > 0 || run) && (
                              <div className="ep-doc-empty">
                                <i className="ri-information-line" />No signing workflow configured for this document.
                              </div>
                            )}
                            {isExpanded && (signers.length > 0 || run) && (
                              <div className="ep-signing">
                                <div className="ep-signing-head">
                                  <i className="ri-shield-check-line" />Signing Workflow
                                  {run ? (
                                    <span className="ep-signing-pct">
                                      {run.signers.filter(s => s.status === 'Done').length}/{run.signers.length} signed
                                    </span>
                                  ) : (
                                    <span className="ep-signing-pct">Not yet sent</span>
                                  )}
                                </div>
                                <div className="ep-signing-flow">
                                  {(run ? run.signers.map((s, i) => ({
                                        name: s.name || s.role_name || `Signer ${i + 1}`,
                                        role: s.role_name,
                                        action: s.action,
                                        status: s.status === 'Done' ? 'Completed' : s.status === 'Rejected' ? 'Rejected' : run.status === 'Completed' ? 'Completed' : (String((run as any).template?.signing_mode || '').toLowerCase() === 'parallel' || i === run.current_index) ? 'Awaiting' : 'Pending',
                                        active: (String((run as any).template?.signing_mode || '').toLowerCase() === 'parallel' ? (s.status !== 'Done' && s.status !== 'Rejected') : i === run.current_index) && (run.status === 'Pending' || run.status === 'In Progress'),
                                      }))
                                      : signers.map((s, i) => ({
                                        name: s.role_name || s.designation_name || `Signer ${i + 1}`,
                                        role: s.role_name,
                                        action: s.action,
                                        status: 'Pending' as string,
                                        active: i === 0,
                                      }))
                                  ).map((sg, i) => (
                                    <div key={i} className={`ep-signer${sg.active ? ' is-active' : ''}`}>
                                      <span className="ep-signer-dot">{i + 1}</span>
                                      <span className="ep-signer-name">
                                        {sg.name}
                                        {sg.action && (
                                          <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>
                                            ({sg.action})
                                          </span>
                                        )}
                                      </span>
                                      <span className="ep-signer-state">{sg.status}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                </>
              );
            })()}

            {stage === 4 && (
              <>
                <div className="ep-section-label">Final Validation Checklist</div>
                <div className="ep-checklist mb-3">
                  {[
                    { title: 'All clearances obtained',    sub: 'Manager, IT, Admin, Finance, Legal' },
                    { title: 'All assets handed over',     sub: 'Laptop, phone, access cards, keys' },
                    { title: 'All access revoked',         sub: 'ERP, Email, GitHub, Cloud, CRM' },
                    { title: 'Exit documents signed',      sub: 'Templates from HR > Document Templates with trigger Exit Management' },
                    { title: 'Exit interview completed',   sub: 'Feedback recorded and filed' },
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
                  <Col md={6}><EpField label="HR Final Sign-off"><EpSelect value={hrSignOff} onChange={setHrSignOff} options={['Pending','Approved','Rejected']} /></EpField></Col>
                </Row>

                {exitPending.length === 0 ? (
                  <div className="ep-close-case">
                    <i className="ri-flag-line" />
                    <div>
                      <div className="ep-close-case-title">Ready to close</div>
                      <div className="ep-close-case-sub">Everything's done — click "Complete Exit" to finalize and close the exit case for {employee.name}.</div>
                    </div>
                  </div>
                ) : (
                  <div className="ep-close-case ep-close-case--blocked">
                    <i className="ri-error-warning-line" />
                    <div>
                      <div className="ep-close-case-title">{exitPending.length} item{exitPending.length > 1 ? 's' : ''} pending before this exit can be completed</div>
                      <ul className="ep-close-case-list">
                        {exitPending.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <div className="ep-footer">
          <div className="ep-footer-info">
            <i className="ri-information-line" />
            Stage {stage} of {EXIT_STAGES.length} — {current.title}
          </div>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={(stage === 1 && stage1Saving) || draftSaving}
              onClick={() => { if (stage === 1) saveStage1(); else persistDraft(); }}
            >
              <i className={(stage === 1 ? stage1Saving : draftSaving) ? 'ri-loader-line' : 'ri-save-3-line'} />
              {(stage === 1 ? stage1Saving : draftSaving) ? 'Saving…' : 'Save Draft'}
            </button>
            <div className="flex-grow-1" />
            {stage > 1 && (
              <button type="button" className="ep-btn ep-btn--prev" onClick={goBack}><i className="ri-arrow-left-s-line" />Previous</button>
            )}
            {isLastStage ? (
              <button
                type="button"
                className="ep-btn ep-btn--complete"
                /* Only HARD-disable while a completion is in flight. When it's
                   blocked by the last-working-day we keep it clickable (greyed)
                   so completeExit() can toast WHY instead of silently doing
                   nothing. */
                disabled={completing}
                aria-disabled={!lwdReached}
                onClick={completeExit}
                title={!lwdReached
                  ? (lwd ? `Exit can be completed on or after the last working day (${fmtDateShort(lwd)})` : 'Set the last working day first')
                  : 'Finalize and close this exit case'}
                style={!lwdReached ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                <i className={completing ? 'ri-loader-4-line ri-spin' : 'ri-check-double-line'} />
                {completing ? 'Completing…' : 'Complete Exit'}
              </button>
            ) : (() => {
              const busy = stage === 1 ? stage1Saving : (advancingStage || draftSaving);
              return (
                <button
                  type="button"
                  className="ep-btn ep-btn--next"
                  disabled={busy}
                  onClick={async () => {
                    if (stage === 1) {
                      const ok = await saveStage1();
                      if (!ok) return;
                      markStageCompleted(1);
                      advance();
                      return;
                    }
                    setAdvancingStage(true);
                    const ok = await persistDraft({ silent: true });
                    setAdvancingStage(false);
                    if (!ok) return;
                    markStageCompleted(stage);
                    advance();
                  }}
                >
                  {busy
                    ? <><i className="ri-loader-4-line ri-spin" /> Advancing…</>
                    : <>Next Stage<i className="ri-arrow-right-s-line" /></>}
                </button>
              );
            })()}
          </div>
        </div>
      </ModalBody>
    </Modal>

    <Modal isOpen={previewOpen} toggle={() => setPreviewOpen(false)} size="lg" centered contentClassName="border-0" backdrop="static">
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)', borderRadius: '6px 6px 0 0' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2 min-w-0">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-file-search-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div className="min-w-0">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>
                  {previewTpl?.name || 'Document Preview'}
                </h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                  {employee?.name ? `Filled with ${employee.name}'s data` : 'Live preview'}
                  {previewTpl?.code ? ` · ${previewTpl.code}` : ''}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>
        <div style={{ padding: 16, background: 'var(--vz-secondary-bg)', maxHeight: '70vh', overflowY: 'auto' }}>
          {previewLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
              <i className="ri-loader-4-line" style={{ fontSize: 26, display: 'block', marginBottom: 8 }} />
              Resolving placeholders…
            </div>
          ) : (
            <>
              {previewMissing.length > 0 && (
                <div className="d-flex align-items-start gap-2 mb-3 ep-preview-warn">
                  <i className="ri-error-warning-line" style={{ marginTop: 2 }} />
                  <div>
                    <strong>Unfilled placeholders:</strong> {previewMissing.join(', ')}
                  </div>
                </div>
              )}
              <div
                style={{ background: '#fff', color: '#1f2937', padding: 24, borderRadius: 10, border: '1px solid var(--vz-border-color)', minHeight: 320, boxShadow: '0 6px 24px rgba(0,0,0,0.22)' }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </>
          )}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--vz-border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => setPreviewOpen(false)}
            className="btn rounded-pill px-3 fw-semibold"
            style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 13 }}>
            Close
          </button>
          {previewTpl && (
            <button type="button" onClick={() => { handleGenerate(previewTpl); }}
              disabled={generating}
              className="btn rounded-pill px-3 fw-semibold"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', border: 0, fontSize: 13, boxShadow: '0 4px 10px rgba(124,58,237,0.30)', opacity: generating ? 0.7 : 1, cursor: generating ? 'progress' : 'pointer' }}>
              {generating
                ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                : <><i className="ri-download-2-line me-1" />Download DOCX</>}
            </button>
          )}
        </div>
      </ModalBody>
    </Modal>

    <DocGenerateModal
      isOpen={!!genTpl}
      onClose={() => setGenTpl(null)}
      templateId={genTpl?.id ?? null}
      templateName={genTpl?.name}
      templateCode={genTpl?.code}
      employeeId={employee?.id ?? null}
      employeeName={employee?.name}
      onSent={fetchRuns}
      onGenerated={fetchGenerated}
    />

    <Modal isOpen={!!sendForTpl} toggle={() => !sending && setSendForTpl(null)} size="md" centered contentClassName="border-0" backdrop="static">
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 14px' }}>
          <div className="d-flex align-items-center gap-3 mb-2">
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ri-send-plane-fill" style={{ fontSize: 20, color: '#fff' }} />
            </span>
            <div>
              <div className="fw-bold" style={{ fontSize: 16, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>Send for signing?</div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                The document will enter the configured signing workflow.
              </div>
            </div>
          </div>
          {sendForTpl && (
            <div style={{ padding: 14, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', borderRadius: 10, marginTop: 10 }}>
              <div className="fw-semibold" style={{ fontSize: 13.5 }}>
                {sendForTpl.name || '(unnamed template)'}
                {sendForTpl.code && (
                  <span className="ep-tpl-code-badge" style={{ marginLeft: 8, fontSize: 11, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4 }}>{sendForTpl.code}</span>
                )}
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {parseSigners(sendForTpl.signers).length} signer(s) · {sendForTpl.signing_mode || 'Sequential'} signing
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 24px 22px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" disabled={sending} onClick={() => setSendForTpl(null)}
            className="btn rounded-pill px-3 fw-semibold"
            style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 13 }}>
            Cancel
          </button>
          <button type="button" disabled={sending} onClick={confirmSend}
            className="btn rounded-pill px-3 fw-semibold"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', border: 0, fontSize: 13, boxShadow: '0 4px 10px rgba(124,58,237,0.30)', opacity: sending ? 0.7 : 1 }}>
            <i className={sending ? 'ri-loader-4-line me-1' : 'ri-send-plane-line me-1'}
              style={{ animation: sending ? 'onb-spin 0.8s linear infinite' : undefined }} />
            {sending ? 'Sending…' : 'Yes, send'}
          </button>
        </div>
      </ModalBody>
    </Modal>
    </>
  );
}

function ExitProgressDial({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const RADIUS = 42;
  const ARC_LEN = (270 / 360) * (2 * Math.PI * RADIUS);
  const offset = ARC_LEN * (1 - pct / 100);
  const startAngle = 135;
  const endAngle = startAngle + (270 * pct) / 100;
  const endRad = (endAngle * Math.PI) / 180;
  const dotX = 50 + Math.cos(endRad) * RADIUS;
  const dotY = 50 + Math.sin(endRad) * RADIUS;

  return (
    <div className="ep-dial" aria-label={`${pct}% complete`}>
      <svg width="80" height="80" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="ep-dial-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#6ee7b7" />
            <stop offset="55%"  stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="ep-dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={describeArc(50, 50, RADIUS, 135, 405)}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="6"
          strokeLinecap="round"
        />
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

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const toRad = (a: number) => (a * Math.PI) / 180;
  const startX = cx + Math.cos(toRad(startAngle)) * r;
  const startY = cy + Math.sin(toRad(startAngle)) * r;
  const endX   = cx + Math.cos(toRad(endAngle))   * r;
  const endY   = cy + Math.sin(toRad(endAngle))   * r;
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;
}

function EpField({ label, required, invalid, children }: { label: string; required?: boolean; invalid?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ep-field${invalid ? ' ep-field--invalid' : ''}`}>
      <div className="ep-field-label">
        {label}
        {required && (
          <span
            aria-hidden="true"
            style={{ color: '#dc2626', marginLeft: 3, fontWeight: 700 }}
          >*</span>
        )}
      </div>
      {children}
    </div>
  );
}
function EpInput({ value, onChange, type = 'text', disabled = false, placeholder, min, max, maxLength, invalid }: { value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; placeholder?: string; min?: string; max?: string; maxLength?: number; invalid?: boolean }) {
  if (type === 'date') {
    return (
      <MasterDatePicker
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder ?? 'dd-mm-yyyy'}
        minDate={min}
        maxDate={max}
        invalid={invalid}
      />
    );
  }
  return (
    <input
      type={type}
      className={`ep-input${invalid ? ' ep-input--invalid' : ''}`}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      min={min} max={max} maxLength={maxLength}
      onChange={e => onChange(e.target.value)}
    />
  );
}
function EpSelect({ value, onChange, options, invalid }: { value: string; onChange: (v: string) => void; options: string[]; invalid?: boolean }) {
  const items = options.map(o => ({
    value: o,
    label: o.startsWith('— ') ? o : (o === 'Pending' ? '— Pending —' : o),
  }));
  return <MasterSelect value={value} onChange={onChange} options={items} placeholder="Select…" invalid={invalid} />;
}
function EpApprovalCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="ep-approval-card">
      <div className="ep-approval-head"><i className={icon} />{title}</div>
      {children}
    </div>
  );
}
function MiniProgressRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const RADIUS = 16;
  const CIRC = 2 * Math.PI * RADIUS;
  const offset = CIRC * (1 - pct / 100);
  return (
    <span className="ep-mini-ring">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="3.5" />
        <circle
          cx="22" cy="22" r={RADIUS}
          fill="none"
          stroke="#34d399"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
          style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <span className="ep-mini-ring-pct">{pct}%</span>
    </span>
  );
}


type DocStatus = 'Verified' | 'Uploaded' | 'Signed' | 'Sent' | 'Pending' | 'Not Generated' | 'Optional' | 'Generated' | 'Completed';

type VaultTab = 'employee' | 'organizational' | 'exit';

const DOC_KEY_CATALOGUE: Record<string, { name: string; desc: string; icon: string; iconBg: string; iconFg: string; category: string }> = {
  aadhaar:     { name: 'Aadhaar Card',           desc: 'Government issued 12-digit unique identity',     icon: 'ri-fingerprint-line',         iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Identity'        },
  pan:         { name: 'PAN Card',               desc: 'Permanent Account Number for taxation',          icon: 'ri-bank-card-2-line',         iconBg: '#fef3c7', iconFg: '#92400e', category: 'Identity'        },
  p_photo:     { name: 'Passport Photo',         desc: 'Recent passport-size photograph',                icon: 'ri-camera-line',              iconBg: '#fdd9ea', iconFg: '#a02960', category: 'Identity'        },
  p_copy:      { name: 'Passport Copy',          desc: 'Govt issued travel document (if applicable)',    icon: 'ri-passport-line',            iconBg: '#dceefe', iconFg: '#0c63b0', category: 'Identity'        },
  cur_addr:    { name: 'Current Address Proof',  desc: 'Utility bill or bank statement (last 3 months)', icon: 'ri-home-4-line',              iconBg: '#dcfce7', iconFg: '#15803d', category: 'Address'         },
  perm_addr:   { name: 'Permanent Address Proof',desc: 'Aadhaar / Voter ID — permanent address proof',   icon: 'ri-map-pin-line',             iconBg: '#fee2e2', iconFg: '#b91c1c', category: 'Address'         },
  edu_10:      { name: '10th Marksheet',         desc: 'Secondary school certification',                 icon: 'ri-file-text-line',           iconBg: '#fef3c7', iconFg: '#92400e', category: 'Education'       },
  edu_12:      { name: '12th Marksheet',         desc: 'Higher secondary certification',                 icon: 'ri-file-text-line',           iconBg: '#fef3c7', iconFg: '#92400e', category: 'Education'       },
  edu_deg:     { name: 'Graduation Degree',      desc: "Bachelor's degree certificate",                  icon: 'ri-graduation-cap-line',      iconBg: '#dcfce7', iconFg: '#15803d', category: 'Education'       },
  edu_pg:      { name: 'Post Graduation',        desc: "Master's or postgraduate diploma",               icon: 'ri-award-line',               iconBg: '#dceefe', iconFg: '#0c63b0', category: 'Education'       },
  rel_letter:  { name: 'Relieving Letter',       desc: 'Final relieving from previous employer',         icon: 'ri-mail-send-line',           iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Prev. Employment'},
  exp_cert:    { name: 'Experience Letter',      desc: 'Past employment experience certificate',         icon: 'ri-briefcase-4-line',         iconBg: '#ede9fe', iconFg: '#5b3fd1', category: 'Prev. Employment'},
  pay_slip:    { name: 'Last 3 Pay Slips',       desc: 'Most recent salary slips for reference',         icon: 'ri-money-rupee-circle-line',  iconBg: '#fef3c7', iconFg: '#92400e', category: 'Prev. Employment'},
};
const labelForDocKey = (key: string) => DOC_KEY_CATALOGUE[key] || {
  name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  desc: 'Uploaded document',
  icon: 'ri-file-text-line',
  iconBg: '#eef2f6',
  iconFg: '#475569',
  category: 'Other',
};

type EmpDocApiRow = {
  id: number;
  document_key: string;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  original_name: string | null;
  url: string | null;
  uploaded_at: string | null;
};
type VaultTemplate = {
  id: number;
  code: string | null;
  name: string | null;
  doc_type: string | null;
  status: string | null;
  trigger_point?: { module_name?: string | null } | null;
};
type VaultRun = {
  id: number;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Rejected' | 'Cancelled';
  template_id: number;
};

function EvidenceVaultModal({ employee, onClose }: { employee: EmployeeRow | null; onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<VaultTab>('employee');
  // Which doc row is mid view/download — drives the spinner + blocks a second
  // click (multiple concurrent downloads were hanging the UI).
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'view' | 'download' | null>(null);

  const [empDocs, setEmpDocs]               = useState<EmpDocApiRow[]>([]);
  const [orgTemplates, setOrgTemplates]     = useState<VaultTemplate[]>([]);
  const [exitTemplates, setExitTemplates]   = useState<VaultTemplate[]>([]);
  const [signingRuns, setSigningRuns]       = useState<VaultRun[]>([]);
  const [loading, setLoading]               = useState(false);

  useEffect(() => {
    if (!employee) {
      setEmpDocs([]); setOrgTemplates([]); setExitTemplates([]); setSigningRuns([]);
      setTab('employee');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTab('employee');
    Promise.allSettled([
      api.get(`/employees/${employee.id}/documents`),
      api.get('/hr-document-templates/match', { params: { employee_id: employee.id, trigger_keyword: 'onboarding' } }),
      api.get('/hr-document-templates/match', { params: { employee_id: employee.id, trigger_keyword: 'exit' } }),
      api.get('/hr-document-signatures', { params: { employee_id: employee.id } }),
    ]).then(results => {
      if (cancelled) return;
      const [docsR, orgR, exitR, runsR] = results;
      setEmpDocs(docsR.status === 'fulfilled' && Array.isArray(docsR.value.data) ? docsR.value.data : []);
      setOrgTemplates(orgR.status === 'fulfilled' && Array.isArray(orgR.value.data?.templates) ? orgR.value.data.templates : []);
      setExitTemplates(exitR.status === 'fulfilled' && Array.isArray(exitR.value.data?.templates) ? exitR.value.data.templates : []);
      setSigningRuns(runsR.status === 'fulfilled' && Array.isArray(runsR.value.data) ? runsR.value.data : []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employee?.id]);

  const runByTemplateId = useMemo(() => {
    const m = new Map<number, VaultRun>();
    for (const r of signingRuns) {
      const existing = m.get(r.template_id);
      if (!existing || r.id > existing.id) m.set(r.template_id, r);
    }
    return m;
  }, [signingRuns]);

  if (!employee) return null;

  const empDocsView = empDocs.map(d => {
    const cat = labelForDocKey(d.document_key);
    const status: DocStatus =
      d.status === 'verified' ? 'Verified'
      : d.status === 'uploaded' ? 'Uploaded'
      : d.status === 'rejected' ? 'Pending'
      : 'Pending';
    return {
      id: d.id, key: d.document_key, name: cat.name, sub: cat.desc, icon: cat.icon, iconBg: cat.iconBg, iconFg: cat.iconFg,
      category: cat.category, status, url: d.url,
    };
  });

  const empGroups = (() => {
    const buckets: Record<string, typeof empDocsView> = {};
    for (const d of empDocsView) {
      const k = d.category || 'Other';
      (buckets[k] = buckets[k] || []).push(d);
    }
    return Object.entries(buckets).map(([title, docs]) => ({
      title,
      icon: docs[0]?.icon || 'ri-folder-line',
      iconBg: docs[0]?.iconBg || '#eef2f6',
      iconFg: docs[0]?.iconFg || '#475569',
      docs,
    }));
  })();

  const buildTplGroup = (templates: VaultTemplate[], title: string, groupIcon: string, groupBg: string, groupFg: string) => {
    const docs = templates.map(tpl => {
      const run = runByTemplateId.get(tpl.id) || null;
      const status: DocStatus =
        run?.status === 'Completed'   ? 'Completed'
        : run?.status === 'In Progress' ? 'Sent'
        : run?.status === 'Pending'     ? 'Sent'
        : run?.status === 'Rejected'    ? 'Pending'
        : run?.status === 'Cancelled'   ? 'Not Generated'
        : tpl.status === 'Active'       ? 'Not Generated'
        : 'Not Generated';
      return {
        id: tpl.id, key: `tpl-${tpl.id}`,
        name: tpl.name || '(unnamed template)',
        sub: `${tpl.doc_type || 'Document'}${tpl.code ? ` · ${tpl.code}` : ''}${run ? ` · Run #${run.id}` : ''}`,
        icon: 'ri-file-text-line', iconBg: groupBg, iconFg: groupFg,
        category: tpl.trigger_point?.module_name || 'Template',
        status,
        url: null as string | null,
        // Signed-PDF source once the run is fully signed — View/Download use this
        // instead of the template /generate endpoint (which 401→login-redirects
        // when opened directly in a browser tab).
        runId: run?.status === 'Completed' ? run.id : null,
      };
    });
    return docs.length ? [{ title, icon: groupIcon, iconBg: groupBg, iconFg: groupFg, docs }] : [];
  };
  const orgGroups  = buildTplGroup(orgTemplates,  'Signed Company Documents', 'ri-file-shield-2-line', '#fef3c7', '#92400e');
  const exitGroups = buildTplGroup(exitTemplates, 'Exit Process Documents',   'ri-logout-box-r-line',  '#dcfce7', '#15803d');

  const groups =
    tab === 'employee'       ? empGroups
    : tab === 'organizational' ? orgGroups
    : exitGroups;

  const allDocs: { status: DocStatus }[] = [...empDocsView, ...orgGroups.flatMap(g => g.docs), ...exitGroups.flatMap(g => g.docs)];
  const total      = allDocs.length;
  const signed     = allDocs.filter(d => d.status === 'Signed' || d.status === 'Generated' || d.status === 'Completed').length;
  const pending    = allDocs.filter(d => d.status === 'Pending' || d.status === 'Sent').length;
  const notGen     = allDocs.filter(d => d.status === 'Not Generated' || d.status === 'Optional').length;
  const completionPct = total > 0 ? Math.round(((total - notGen) / total) * 100) : 0;

  const empCount  = empDocsView.length;
  const orgCount  = orgGroups.reduce((a, g) => a + g.docs.length, 0);
  const exitCount = exitGroups.reduce((a, g) => a + g.docs.length, 0);

  type VaultDoc = { url: string | null; key: string; id: number; name: string; runId?: number | null };
  // View — show the SIGNED PDF inline for completed runs (opens the
  // authenticated blob in a new tab); falls back to an uploaded file URL.
  const handleViewRow = async (d: VaultDoc) => {
    if (busyKey) return;
    if (d.runId) {
      setBusyKey(d.key); setBusyAction('view');
      try {
        const resp = await api.get(`/hr-document-signatures/${d.runId}/download-pdf`, { responseType: 'blob' });
        const objUrl = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        window.open(objUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      } catch (err: any) {
        toast.error('Could not open', err?.response?.data?.message || 'Please try again.');
      } finally { setBusyKey(null); setBusyAction(null); }
      return;
    }
    if (d.url) { window.open(d.url, '_blank', 'noopener,noreferrer'); return; }
    toast.info('Not available yet', 'This document has not been generated / signed yet.');
  };
  // Download — signed PDF for completed runs; uploaded file otherwise. Shows a
  // "downloading" toast, a button spinner, and blocks concurrent clicks.
  const handleDownloadRow = async (d: VaultDoc) => {
    if (busyKey) return;
    setBusyKey(d.key); setBusyAction('download');
    try {
      if (d.runId) {
        toast.info('Downloading…', 'Preparing the signed PDF.');
        const resp = await api.get(`/hr-document-signatures/${d.runId}/download-pdf`, { responseType: 'blob' });
        const objUrl = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = objUrl; a.download = `${(d.name || 'document').replace(/\s+/g, '-')}-signed.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(objUrl);
        toast.success('Downloaded', 'Signed PDF saved.');
      } else if (d.url) {
        // Direct anchor download — NOT fetch(): uploaded files are served from
        // storage / a different origin, and fetch() trips a CORS error there.
        // An anchor download works for same-origin files and falls back to
        // opening the file in a new tab cross-origin (no CORS preflight).
        const a = document.createElement('a');
        a.href = d.url;
        a.download = d.name || 'document';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        toast.success('Downloaded', 'Document saved.');
      } else {
        toast.info('Not available yet', 'This document has not been generated / signed yet.');
      }
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    } finally { setBusyKey(null); setBusyAction(null); }
  };

  return (
    <Modal isOpen={!!employee} toggle={onClose} centered size="xl" backdrop="static" contentClassName="border-0 ev-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
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

        <div className="ev-kpis rec-page-kpis">
          {[
            { label: 'Total Docs',      value: total,    icon: 'ri-file-list-3-line',     gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
            { label: 'Signed',          value: signed,   icon: 'ri-quill-pen-line',       gradient: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 60%, #a78bfa 100%)', deep: '#6d28d9' },
            { label: 'Pending',         value: pending,  icon: 'ri-time-line',            gradient: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
          ].map(k => (
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

        <div className="ev-body">
          {loading ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
              <i className="ri-loader-4-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
              Loading vault…
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--vz-secondary-color)', background: 'var(--vz-secondary-bg)', border: '1px dashed var(--vz-border-color)', borderRadius: 10, fontSize: 13 }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
              {tab === 'employee'
                ? 'No documents uploaded yet by this employee.'
                : tab === 'organizational'
                  ? 'No onboarding-trigger documents on record. Create templates under HR > Document Templates with trigger “Onboarding”.'
                  : 'No exit-trigger documents on record. Create templates under HR > Document Templates with trigger “Exit Management”.'}
            </div>
          ) : groups.map((g, gi) => (
            <div key={gi} className="ev-group">
              <div className="ev-group-head">
                <span className="ev-group-icon" style={{ background: g.iconBg, color: g.iconFg }}>
                  <i className={g.icon} />
                </span>
                <div className="ev-group-title">{g.title}</div>
                <span className="ev-group-count">{g.docs.length} docs</span>
              </div>
              <div className="ev-doc-list">
                {g.docs.map(d => {
                  const status = d.status as DocStatus;
                  const disabled = status === 'Not Generated' || status === 'Optional';
                  return (
                    <div key={d.key} className="ev-doc">
                      <span className="ev-doc-icon" style={{ background: d.iconBg, color: d.iconFg }}>
                        <i className={d.icon} />
                      </span>
                      <div className="ev-doc-info">
                        <div className="ev-doc-name">{d.name}</div>
                        <div className="ev-doc-sub">{d.sub}</div>
                      </div>
                      <span className="ev-doc-cat">{d.category}</span>
                      <span className={`ev-doc-status ev-doc-status--${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
                      <button type="button"
                        className={`ev-doc-btn ev-doc-btn--view${status === 'Generated' ? ' ev-doc-btn--preview' : ''}`}
                        disabled={disabled || busyKey === d.key}
                        onClick={() => handleViewRow(d)}
                      >
                        {busyKey === d.key && busyAction === 'view'
                          ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Opening…</>
                          : <><i className="ri-eye-line" />{status === 'Generated' ? 'Preview' : 'View'}</>}
                      </button>
                      <button type="button"
                        className="ev-doc-btn ev-doc-btn--download"
                        disabled={disabled || busyKey === d.key}
                        onClick={() => handleDownloadRow(d)}
                      >
                        {busyKey === d.key && busyAction === 'download'
                          ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />Downloading…</>
                          : <><i className="ri-download-line" />Download</>}
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



const _exitAccentPalette = ['#7c5cfc', '#0ab39c', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#f97316', '#ec4899', '#06b6d4'];
function _exitAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return _exitAccentPalette[h % _exitAccentPalette.length];
}
function _exitInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';
}

function apiToExitRow(e: any): EmployeeRow {
  const name = (e.display_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`).trim() || '—';
  const mgr  = e.reporting_manager;
  const mgrName = mgr?.display_name
    || (mgr ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ').trim() : '')
    || e.reporting_manager_user?.name
    || '—';

  const trashed   = !!e.deleted_at;
  const rawStatus = String(e.status ?? 'Active');
  const ex        = e?.exit ?? null;
  const noticeRaw = ex?.notice_date ? String(ex.notice_date).slice(0, 10) : '';
  const caseClosed   = (ex?.exit_case_status === 'Closed') || !!ex?.completed_at;
  const statusExited = ['Resigned', 'Terminated'].includes(rawStatus);
  const statusNotice = rawStatus === 'Notice Period';
  const exitInitiated = !!ex && (
    !!ex.exit_type || !!ex.last_working_day || !!ex.notice_date || Number(ex.current_stage) >= 1
  );

  let status: ExitStatus;
  // NOTE: a soft-disabled employee (deleted_at set via the Employee module
  // toggle) is NOT an exit — only a completed/closed exit case or a
  // Resigned/Terminated status counts as "Exited" here. This keeps a merely
  // disabled employee visible & manageable in the hub instead of being
  // silently moved to the Exited list.
  if      (caseClosed || statusExited)                              status = 'Exited';
  else if (exitInitiated || statusNotice)                           status = 'Exit In Progress';
  else if (!e.email || !e.department_id || !e.designation_id)        status = 'Missing Details';
  else                                                              status = 'Active';

  const currentStage = Math.max(1, Math.min(EXIT_STAGES.length, Number(ex?.current_stage) || 1));
  const exitReadiness = status === 'Exited' ? 100
    : status === 'Exit In Progress' ? Math.min(90, Math.round((currentStage / EXIT_STAGES.length) * 100))
    : 0;

  return {
    id:         Number(e.id) || 0,
    empId:      e.emp_code || `EMP-${e.id}`,
    name,
    initials:   _exitInitials(name),
    accent:     _exitAccent(name),
    photoUrl:   (e as any).photo_url || null,
    department: e.department?.name   || '—',
    designation: e.designation?.name || '—',
    primaryRole:   e.primary_role?.name   || '—',
    ancillaryRole: e.ancillary_role?.name || '',
    ancillaryRoles: (Array.isArray(e.ancillary_roles_resolved) && e.ancillary_roles_resolved.length > 0)
      ? e.ancillary_roles_resolved.map((r: any) => r.name)
      : (e.ancillary_role?.name ? [e.ancillary_role.name] : []),
    managerName:     mgrName,
    managerInitials: _exitInitials(mgrName),
    managerAccent:   _exitAccent(mgrName || 'manager'),
    exitReadiness,
    status,
    exitInitiated,
    noticeStartIso: noticeRaw,
    // Prefer the explicit integer; fall back to parsing the label ("90 Days")
    // since notice_period_days is often null while notice_period holds "N Days".
    noticePeriodDays: (() => {
      const n = e.notice_period_days;
      if (n != null && n !== '' && Number.isFinite(Number(n))) return Number(n);
      const m = String(e.notice_period || '').match(/(\d+)/);
      return m ? Number(m[1]) : null;
    })(),
    noticePeriodLabel: e.notice_period || '',
    laptopAsset: e.laptop_asset ? {
      id:           Number(e.laptop_asset.id),
      asset_name:   e.laptop_asset.asset_name,
      code:         e.laptop_asset.code ?? null,
      asset_number: e.laptop_asset.asset_number ?? null,
    } : null,
    mobileAsset: e.mobile_asset ? {
      id:           Number(e.mobile_asset.id),
      asset_name:   e.mobile_asset.asset_name,
      code:         e.mobile_asset.code ?? null,
      asset_number: e.mobile_asset.asset_number ?? null,
    } : null,
    otherAssets: Array.isArray(e.other_assets_resolved)
      ? e.other_assets_resolved.map((a: any) => ({
          id:           Number(a.id),
          asset_name:   a.asset_name,
          code:         a.code ?? null,
          asset_number: a.asset_number ?? null,
        }))
      : [],
  };
}







const CHECKLIST_STAGES: ChecklistStage[] = [
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
      { name: 'Supplier / client relationships transitioned', sub: 'Key external relationships introduced to successor with formal handover emails',                          owner: 'mgr', desig: ['hod'],                              type: 'all', tag: 'HOD' },
      { name: 'Sprint / active tasks reassigned to team',   sub: 'All open tickets, sprint tasks and ongoing deliverables redistributed',                                     owner: 'mgr', desig: ['lead'],                             type: 'all', tag: 'TL' },
      { name: 'Client / project handover completed',        sub: 'Clients notified and project transitioned to new owner',                                                    owner: 'mgr', desig: ['hod', 'lead', 'exec'],              type: 'all' },
      { name: 'Intern project / work handover done',        sub: 'Incomplete work handed to supervisor, project progress documented',                                         owner: 'mgr', desig: ['intern'],                           type: 'all', tag: 'INTERN' },
    ],
  },
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
