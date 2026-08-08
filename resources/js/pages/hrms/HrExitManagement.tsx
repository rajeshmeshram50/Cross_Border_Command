import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, Input } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { AncillaryRolesChip } from '../../components/AncillaryRolesChip';
import { Shimmer, ShimmerTableRows } from '../../components/ui/Shimmer';
import DataTable, { ChipCell, TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import Tooltip from '../../components/ui/Tooltip';
import DocGenerateModal from './doc-templates/DocGenerateModal';
import { isOnProbation, probationEndLabel, isEarlyResignation, tenureDays, EARLY_EXIT_DAYS } from '../../utils/probation';
/* Every file URL on this page goes through resolveFileUrl, like the rest of the
   app. The API returns Storage::url() paths — bare "/storage/…" strings — which
   a browser resolves against the SPA's own origin, not the API's. Wherever those
   differ (Vite dev server vs. artisan serve, or a split host in production) the
   link 404s. resolveFileUrl re-bases them on VITE_API_URL and leaves absolute
   Azure/CDN URLs alone. */
import { resolveFileUrl } from '../../utils/resolveFileUrl';
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
  /** Switched off in HR > Employees (soft-deleted, login dead). Independent of
   *  the exit status — a disabled employee may still have an exit in progress,
   *  in which case they show in BOTH lists. */
  disabled: boolean;
  exitInitiated: boolean;
  /** Exit type already on file, if any. Empty means the type question hasn't
   *  been answered yet — so even "Continue" has to go through the picker,
   *  since the wizard's stage list is derived from it. */
  exitType: string;
  noticeStartIso: string;
  // Notice period set on the employee at hire (e.g. "30 Days" + 30). Used to
  // auto-derive the Notice Period End Date in the exit form.
  noticePeriodDays: number | null;
  noticePeriodLabel: string;
  /** Monthly BASIC (annual ÷ 12 × 50%) when the list payload carries it — the
   *  basis the notice-period settlement is priced on. HR can override it. */
  monthlySalary: number | null;
  // Probation end date. While it's in the future the notice period does NOT
  // apply — the exit is immediate (see ProbationGuard on the backend).
  probationEndIso: string | null;
  // Joining date. Resigning within 15 days of it also waives the notice period
  // (and keeps the employee out of payroll) — see ProbationGuard::EARLY_EXIT_DAYS.
  dateOfJoiningIso: string | null;
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
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [tab, setTab]             = useState<'active' | 'in-progress' | 'exited'>('active');
  const [search, setSearch]       = useState('');
  /* Paging lives in <DataTable> now. */
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [processing, setProcessing] = useState<EmployeeRow | null>(null);
  /* "Initiate Exit" opens the exit-TYPE picker first — the wizard is only
     mounted once a type is chosen, since the type decides its stage list.
     `initiating` holds the employee while that question is on screen. */
  const [initiating, setInitiating] = useState<EmployeeRow | null>(null);
  const [initiatingBusy, setInitiatingBusy] = useState(false);
  /* Rehire — bringing an exited (standard-resignation) employee back. */
  const [rehiring, setRehiring] = useState<EmployeeRow | null>(null);
  const [vault, setVault] = useState<EmployeeRow | null>(null);

  const loadEmployees = useCallback((silent = false) => {
    if (!silent) setListLoading(true);
    api.get('/employees')
      .then(({ data }) => {
        const rows = (Array.isArray(data) ? data : [])
          .filter(e => Number((e as any)?.onboarding_stage_completed ?? 0) >= 6)
          .map(apiToExitRow)
          /* A DISABLED employee with no exit case has nothing to do with this
             page: switching someone off in HR > Employees is not an exit, so
             they appear in Employees > Disabled and nowhere here — not under
             Active (their login is dead) and not under Exited (they never
             exited). Disabled employees who ARE mid-exit are deliberately kept,
             so they show in both the Disabled list and Exit In Progress. */
          .filter(r => !r.disabled || r.exitInitiated || r.status === 'Exited');
        setEmployees(rows);
      })
      .catch(() => setEmployees([]))
      .finally(() => setListLoading(false));
  }, []);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);


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

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     4+17+8+9+10+8+7+11+9+8+9. */
  const columns = useMemo<DataTableColumn<EmployeeRow>[]>(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      // wrap: the exit-state caption sits on a second line under the name.
      /* PIXEL widths, not percentages.
         Percentages are a share of the table's width, so on any container
         narrower than the content every column shrank together and the whole
         table truncated at once — worse, they summed to 110%, so `table-layout:
         fixed` scaled each one down even further. Fixed px gives every column a
         guaranteed size; when the viewport can't fit the total, .dt-scroll
         scrolls horizontally instead of crushing the columns. Their sum is
         mirrored in `minWidth` on the DataTable below — keep the two in step
         when adding or resizing a column. */
      meta: { width: 260, wrap: true },
      cell: info => {
        const e = info.row.original;
        const isScheduled = e.status === 'Active' && e.exitInitiated;
        const noticeFromLabel = e.noticeStartIso
          ? new Date(e.noticeStartIso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
          : '';
        return (
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
            <div className="d-flex flex-column" style={{ lineHeight: 1.15, minWidth: 0 }}>
              {/* Long names clip to the column width — hover shows the full one. */}
              <Tooltip label={e.name} maxWidth={360}>
                <span className="fw-bold fs-13 text-truncate">{e.name}</span>
              </Tooltip>
              <span className="text-muted text-truncate" style={{ fontSize: 10.5, fontWeight: 500 }}>
                {isScheduled ? (noticeFromLabel ? `Exit scheduled · notice ${noticeFromLabel}` : 'Exit scheduled')
                  : e.status === 'Active' ? 'Active'
                  : e.status === 'Exit In Progress' ? 'In Progress'
                  : e.status === 'Exited' ? 'Exited' : 'Action Needed'}
                {/* Disabled mid-exit: the row legitimately sits here AND in
                    Employees > Disabled, so say so — otherwise "In Progress"
                    with a dead login reads as a bug. */}
                {e.disabled && e.status !== 'Exited' && (
                  <span style={{ color: '#b45309', fontWeight: 600 }}> · Disabled</span>
                )}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Emp ID',
      accessorKey: 'empId',
      /* `wrap` for the same reason as Status: the cell renders a PILL, which is
         an inline-block wider than its text, so the table's default
         `text-overflow: ellipsis` painted a "…" just past the pill's edge.
         Every column whose cell is a pill/badge needs this opt-out. */
      meta: { width: 130, wrap: true },
      cell: info => <span className="rec-id-pill">{String(info.getValue() ?? '')}</span>,
    },
    { header: 'Department',  accessorKey: 'department',  meta: { width: 140 },  cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    { header: 'Designation', accessorKey: 'designation', meta: { width: 150 }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Primary Role',
      accessorKey: 'primaryRole',
      meta: { width: 140 },
      /* Role names run long ("Software Developer", "Sales Intern") and the
         column is narrow — ChipCell ellipsises inside the pill and reveals
         the full name on hover, same contract as the Designation column. */
      cell: info => <ChipCell value={info.getValue() as string} className="exit-role-chip exit-role-chip--primary" />,
    },
    {
      header: 'Ancillary Role',
      id: 'ancillary',
      enableSorting: false,
      meta: { width: 150 },
      cell: info => {
        const e = info.row.original;
        return (
          <AncillaryRolesChip
            names={(e.ancillaryRoles && e.ancillaryRoles.length > 0) ? e.ancillaryRoles : (e.ancillaryRole ? [e.ancillaryRole] : [])}
          />
        );
      },
    },
    {
      header: 'Rep. Manager',
      accessorKey: 'managerName',
      meta: { width: 170 },
      cell: info => {
        const e = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 22, height: 22, fontSize: 9, background: `linear-gradient(135deg, ${e.managerAccent}, ${e.managerAccent}cc)` }}>
              {e.managerInitials}
            </div>
            <Tooltip label={e.managerName} maxWidth={360}>
              <span className="fs-13 text-truncate">{e.managerName}</span>
            </Tooltip>
          </div>
        );
      },
    },
    /* Exit Type — only meaningful once an exit exists, so it's shown on the
       "Exit In Progress" and "Exited" tabs and omitted from Active Employees
       (where every cell would be a dash). */
    ...(tab === 'active' ? [] : [{
      header: 'Exit Type',
      accessorKey: 'exitType',
      meta: { width: 170, wrap: true },
      cell: (info: any) => {
        const t = String(info.getValue() || '').trim();
        if (!t) return <span className="text-muted">—</span>;
        const tone = t === 'Termination'
          ? { bg: '#f5f3ff', fg: '#6d28d9', bd: '#ddd6fe' }
          : t === 'Resignation'
            ? { bg: '#ecfdf5', fg: '#0d9488', bd: '#a7f3d0' }
            : { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' };
        // The without-notice label is long — shorten it in the cell and keep
        // the full wording in the tooltip.
        const label = t === 'Resignation without notice period' ? 'Resignation (no notice)' : t;
        return (
          <Tooltip label={t} position="bottom" themed>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 999,
              background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`,
              fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
            }}>{label}</span>
          </Tooltip>
        );
      },
    }]),
    {
      /* wrap: the meter is a fixed-width block with a badge floating above the
         bar, so the cell must not clip it. */
      header: 'Exit Readiness',
      accessorKey: 'exitReadiness',
      meta: { width: 130, wrap: true },
      cell: info => {
        const p = info.row.original.exitReadiness;
        const TIER = p >= 90 ? { dark: '#0ab39c', light: '#4dd4be' }
                  : p >= 75 ? { dark: '#3b82f6', light: '#93c5fd' }
                  : p >= 60 ? { dark: '#f59e0b', light: '#fcd34d' }
                  :           { dark: '#f06548', light: '#fda192' };
        const badgeLeft = Math.max(11, Math.min(89, p));
        return (
          <Tooltip label={`Exit readiness ${p}%`} position="top" themed>
            <div style={{ position: 'relative', width: 110, paddingTop: 30 }}>
              <div style={{ position: 'absolute', top: 0, left: `${badgeLeft}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
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
              <div style={{ width: '100%', height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${p}%`, height: '100%', borderRadius: 999,
                    background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 4px, transparent 4px 8px), linear-gradient(90deg, ${TIER.dark}, ${TIER.light})`,
                    transition: 'width .25s ease',
                  }}
                />
              </div>
            </div>
          </Tooltip>
        );
      },
    },
    {
      header: 'Status',
      accessorKey: 'status',
      /* `wrap` opts this cell out of the table's default
         `overflow:hidden; text-overflow:ellipsis` (DataTable.css). Without it
         the "Exit In Progress" pill was wider than the column and got clipped,
         and the ellipsis rendered just past the pill's edge — the stray dot
         that looked like a bug in the data. Widened to 10% as well so the pill
         fits outright rather than merely being allowed to overflow. */
      meta: { width: 160, align: 'center', wrap: true },
      cell: info => {
        const e = info.row.original;
        const statusColor = STATUS_COLOR[e.status];
        return (
          <span className={`badge rounded-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2`}>
            {e.status}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Action</div>,
      id: '__actions',
      enableSorting: false,
      /* An Exited row carries Evidence Vault plus the icon-only Rehire on ONE
         line, so this column needs real room. 12% of the raised minWidth
         (1700) is ~204px — MORE absolute space than the old 13% of 1500
         (~195px), so the buttons still fit on one line while the percentages
         now total exactly 100. */
      meta: { width: 210, align: 'center', wrap: true },
      cell: info => {
        const e = info.row.original;
        const isExited = e.status === 'Exited';
        const isInProgress = e.status === 'Exit In Progress';
        const isScheduled = e.status === 'Active' && e.exitInitiated;
        const noticeFromLabel = e.noticeStartIso
          ? new Date(e.noticeStartIso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
          : '';
        if (isExited) {
          /* Rehire is offered for a STANDARD resignation only. Someone who
             left without serving notice, or who was terminated, needs a fresh
             hiring process rather than a one-click reactivation — the button
             stays visible but disabled so the rule is discoverable instead of
             the action just being absent. */
          const canRehire = e.exitType === 'Resignation';
          const rehireWhy = canRehire
            ? 'Reactivate this employee'
            : e.exitType === 'Termination'
              ? 'Terminated employees cannot be rehired from here — this needs a fresh hiring process.'
              : e.exitType
                ? 'This employee left without serving their notice period — rehiring needs a fresh hiring process.'
                : 'No exit type on record — rehire is unavailable.';
          return (
            <div className="exit-action-row">
              <Tooltip label="Open evidence vault" position="left" themed>
                <button type="button" className="exit-action-btn exit-action-btn--vault" onClick={() => setVault(e)}>
                  <i className="ri-shield-check-line" />Evidence Vault
                </button>
              </Tooltip>
              <Tooltip label={rehireWhy} position="left" themed>
                {/* Icon-only — the label lives in the tooltip, which also has
                    to carry the "why not" for the disabled case. aria-disabled
                    rather than `disabled`, since a disabled button swallows
                    pointer events and that tooltip would never fire. */}
                <button
                  type="button"
                  aria-label="Rehire employee"
                  className={`exit-action-btn exit-action-btn--icon exit-action-btn--rehire${canRehire ? '' : ' is-off'}`}
                  aria-disabled={!canRehire}
                  onClick={() => { if (canRehire) setRehiring(e); }}
                >
                  <i className="ri-user-follow-line" />
                </button>
              </Tooltip>
            </div>
          );
        }
        if (isInProgress || isScheduled) {
          return (
            <Tooltip label={isScheduled ? `Exit scheduled — notice starts ${noticeFromLabel || 'later'}. Continue editing.` : 'Continue exit process'} position="left" themed>
              {/* A case saved before the type question existed still has to
                  answer it before the wizard can pick its stages. */}
              <button type="button" className="exit-action-btn exit-action-btn--continue"
                      onClick={() => (e.exitType.trim() ? setProcessing(e) : setInitiating(e))}>
                <i className="ri-arrow-right-line" />Continue
              </button>
            </Tooltip>
          );
        }
        return (
          <Tooltip label="Initiate exit process" position="left" themed>
            <button type="button" className="exit-action-btn exit-action-btn--initiate" onClick={() => setInitiating(e)}>
              <i className="ri-logout-box-r-line" />Initiate Exit
            </button>
          </Tooltip>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `tab` drives whether the Exit Type column is present, so it must be a
    // dependency — with [] the column list froze on the first tab rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tab]);


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
                        : <span className="rec-kpi-num">{k.value}</span>}
                    </div>
                    <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                      <i className={k.icon} />
                    </span>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Shared list table (components/ui/DataTable) — tabs, search,
                sortable headers, the rows-per-page pager and the fit-to-viewport
                sizing all live in the component now. */}
            <DataTable<EmployeeRow>
              data={filtered}
              columns={columns}
              serial
              accent="violet"
              /* Sum of the columns' pixel widths (see the `meta.width` block at
                 the top of `columns`): 56 serial + 1810 = 1866, and 1696 on the
                 Active tab where Exit Type is not rendered. Matching minWidth to
                 the real total is what stops the compaction — the table never
                 shrinks below the space its columns actually need, and
                 .dt-scroll scrolls horizontally instead. Keep this in step when
                 a column is added or resized. */
              minWidth={tab === 'active' ? 1696 : 1866}
              fitToViewport
              autoFitRows
              loading={listLoading}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search name, ID, department…"
              tabs={[
                { key: 'active',      label: 'Active Employees', icon: 'ri-user-line',            count: counts.active + counts.missing },
                { key: 'in-progress', label: 'Exit In Progress', icon: 'ri-time-line',            count: counts.inProgress },
                { key: 'exited',      label: 'Exited Employees', icon: 'ri-checkbox-circle-line', count: counts.exited },
              ]}
              activeTab={tab}
              onTabChange={k => setTab(k as typeof tab)}
              emptyMessage={
                <>
                  <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No employees match your filters
                </>
              }
            />
          </div>
        </Col>
      </Row>

      <ExitChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />

      {/* Step 1 of initiating an exit: ask for the type, save it, and only
          then open the wizard — which now knows which stages it has. */}
      <ExitTypePickerModal
        open={!!initiating}
        employee={initiating}
        current=""
        busy={initiatingBusy}
        onClose={() => setInitiating(null)}
        onPick={async (value) => {
          const emp = initiating;
          if (!emp || initiatingBusy) return;
          setInitiatingBusy(true);
          try {
            await api.put(`/employees/${emp.id}/exit`, { exit_type: value });
            setInitiating(null);
            setProcessing(emp);
          } catch (err: any) {
            toast.error('Could not start the exit', err?.response?.data?.message || 'Please try again.');
          } finally {
            setInitiatingBusy(false);
          }
        }}
      />

      <ExitProcessModal
        employee={processing}
        onClose={() => { setProcessing(null); loadEmployees(true); }}
        onCompleted={() => loadEmployees(true)}
      />
      <RehireModal
        employee={rehiring}
        onClose={() => setRehiring(null)}
        onDone={() => { setRehiring(null); loadEmployees(true); }}
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

/* ── Stages ──────────────────────────────────────────────────────────────
   The wizard is no longer a fixed four steps. The exit type chosen in the
   "Initiate Exit" picker decides how the notice period is settled, and that
   settlement adds a stage of its own:

     Resignation                       → no settlement stage (nothing owed)
     Resignation without notice period → + Notice Period Payment  (employee pays)
     Termination                       → + Full & Final Settlement (company pays)

   Stages are therefore addressed by KEY, never by a hardcoded number — the
   displayed number is just the position in the current list, so inserting a
   stage can't silently repoint "stage 2" at a different screen.            */
type StageKey = 'initiation' | 'notice_payment' | 'fnf' | 'clearance' | 'documents' | 'closure';

const STAGE_DEFS: Record<StageKey, { title: string; short: string; sub: string; icon: string }> = {
  initiation:     { title: 'Exit Initiation & Approval',   short: 'Exit Initiation & Approval',   sub: 'Record exit details, reason, dates, and collect approvals.',              icon: 'ri-clipboard-line' },
  notice_payment: { title: 'Notice Period Payment',        short: 'Notice Period Payment',        sub: 'Record the notice-period recovery from the employee, verify it and approve.', icon: 'ri-wallet-3-line' },
  fnf:            { title: 'Full & Final Settlement (FnF)', short: 'Full & Final Settlement',     sub: 'Calculate the final settlement amount, deductions, and process payment.', icon: 'ri-wallet-3-line' },
  clearance:      { title: 'Clearance & Handover',         short: 'Clearance & Handover',         sub: 'Confirm asset handover then collect every departmental clearance.',       icon: 'ri-checkbox-line' },
  documents:      { title: 'Exit Documents Management',    short: 'Exit Documents Management',    sub: 'Generate each document, then track the signing workflow per stakeholder.', icon: 'ri-file-text-line' },
  closure:        { title: 'Final Deactivation & Closure', short: 'Final Deactivation & Closure', sub: 'Complete final validation, lock profile, and close the exit case.',        icon: 'ri-flag-line' },
};

type Settlement = 'served' | 'recover' | 'pay_in_lieu';

/** Mirrors ExitController::resolveSettlementMode() — keep the two in step. */
function settlementOf(exitType: string): Settlement {
  const t = String(exitType || '').trim();
  if (t === 'Resignation without notice period' || t === 'Absconding') return 'recover';
  if (t === 'Termination') return 'pay_in_lieu';
  return 'served';
}

/** Badge tint per exit type — same palette as the Exit Type column in the list
 *  so a case reads identically in the table and inside the stage modal. */
function exitTypeTone(exitType: string): { bg: string; fg: string; bd: string } {
  const t = String(exitType || '').trim();
  if (t === 'Termination') return { bg: '#f5f3ff', fg: '#6d28d9', bd: '#ddd6fe' };
  if (t === 'Resignation')  return { bg: '#ecfdf5', fg: '#0d9488', bd: '#a7f3d0' };
  return { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' };
}

type Stage = { key: StageKey; num: number; title: string; short: string; sub: string; icon: string };

/**
 * Every exit ends in a Full & Final settlement, whatever the type — a leaver is
 * dropped from the regular payroll run for their exit month (PayrollService
 * excludes anyone whose last working day falls in the cycle), so the salary
 * they earned up to that day is settled here or nowhere.
 *
 * F&F sits after Clearance (it can only be totalled once asset recovery and
 * departmental clearances are known) but BEFORE Exit Documents: the relieving
 * letter and experience certificate are only released once the employee has
 * actually been paid, so the money has to move first. The notice-recovery
 * stage stays early — that's collected while the employee is still serving,
 * not at the end.
 */
function stagesFor(exitType: string): Stage[] {
  const keys: StageKey[] = ['initiation'];
  if (settlementOf(exitType) === 'recover') keys.push('notice_payment');
  keys.push('clearance', 'fnf', 'documents', 'closure');
  return keys.map((key, i) => ({ key, num: i + 1, ...STAGE_DEFS[key] }));
}

/* The three types the Initiate-Exit picker offers, in the order shown. */
const EXIT_TYPE_CHOICES: { value: string; label: string; desc: string; icon: string; accent: string }[] = [
  {
    value: 'Resignation',
    label: 'Standard Exit (Resignation)',
    desc: 'Employee resigns and serves the full notice period. Nothing is recovered or paid for the notice itself — dues are settled in Full & Final.',
    icon: 'ri-user-shared-line',
    accent: '#0d9488',
  },
  {
    value: 'Resignation without notice period',
    label: 'Resignation without notice',
    desc: 'Employee resigns but will not serve the notice. They pay the unserved days — adds a Notice Period Payment stage for HR to verify and approve.',
    icon: 'ri-timer-flash-line',
    accent: '#b91c1c',
  },
  {
    value: 'Termination',
    label: 'Termination',
    desc: 'Company terminates and can relieve the same day, paying salary in lieu of notice through the Full & Final settlement.',
    icon: 'ri-close-circle-line',
    accent: '#7c3aed',
  },
];

/* Old rows persisted stage_status keyed by the numbers 1-4 of the original
   fixed stage list. Re-key them so a case created before this change reopens
   with its progress intact instead of showing every stage as Pending. */
/* Styling + wording for an action held back by the document-release gate. */
/** Remixicon glyph by file extension. This build has no `ri-file-check-line`,
 *  so using it rendered an empty box in the upload zone. */
function fnfFileIcon(name: string): string {
  const ext = String(name).split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'ri-file-pdf-line';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'ri-image-line';
  if (['doc', 'docx'].includes(ext)) return 'ri-file-word-2-line';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'ri-file-excel-2-line';
  return 'ri-file-3-line';
}

const OFF_STYLE: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed', filter: 'grayscale(0.5)' };
const releaseHint = 'Switch on “release this employee’s documents” above to enable this.';

const LEGACY_STAGE_KEYS: Record<string, StageKey> = { 1: 'initiation', 2: 'clearance', 3: 'documents', 4: 'closure' };
function normaliseStageStatus(raw: any): Record<string, StageStatus> {
  const out: Record<string, StageStatus> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    const key = /^\d+$/.test(k) ? LEGACY_STAGE_KEYS[k] : (k as StageKey);
    if (key) out[key] = raw[k] as StageStatus;
  }
  return out;
}

function ExitProcessModal({ employee, onClose, onCompleted }: { employee: EmployeeRow | null; onClose: () => void; onCompleted?: () => void }) {
  const [stage, setStage] = useState<number>(1);
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>({});

  /* Set once by the Initiate-Exit picker before this wizard mounts, then
     read-only for the life of the case — it decides the stage list and the
     notice settlement, so it can't move underneath work already recorded. */
  const [exitType, setExitType]           = useState('');
  const [reasonForExit, setReasonForExit] = useState('');
  const [noticeDate, setNoticeDate]       = useState('');
  const [lwd, setLwd]                     = useState('');
  // The dates as loaded from the server. A date already saved on an in-progress
  // exit is accepted even if it has since fallen into the past — the
  // "not in the past" rule only applies when HR newly picks/changes a date.
  const loadedNoticeRef = useRef<string>('');
  const loadedLwdRef     = useRef<string>('');
  /* An employee still on probation serves NO notice period — the exit is
     immediate. So the notice-period end date is not derived, and the last
     working day is not pushed out past it (it may even be today). */
  const onProbation = isOnProbation(employee?.probationEndIso);
  /* Same waiver for someone who RESIGNS within 15 days of joining, whether or
     not they were ever on probation — a "No Probation" hire who quits on day 8
     owes no notice either (they're also skipped by payroll entirely; see
     ProbationGuard::EARLY_EXIT_DAYS). Keyed on the notice start date currently
     in the form, so the waiver follows HR editing that date. */
  const earlyResignation = isEarlyResignation(employee?.dateOfJoiningIso, noticeDate);
  const earlyTenure      = tenureDays(employee?.dateOfJoiningIso, noticeDate);
  const noticeWaived     = onProbation || earlyResignation;
  // Notice Period End Date — auto-derived from the notice start date + the
  // employee's notice period (set at hire). Read-only; the Last Working Day
  // stays a separate, manually-set field.
  const noticePeriodEnd = useMemo(() => {
    if (noticeWaived) return '';   // probation / early resignation → no notice
    const days = employee?.noticePeriodDays;
    if (!noticeDate || days == null || !Number.isFinite(days)) return '';
    const d = new Date(noticeDate + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }, [noticeDate, employee?.noticePeriodDays, noticeWaived]);
  const [reportingManagerId, setReportingManagerId] = useState<number | null>(null);
  const [reportingManagerName, setReportingManagerName] = useState('');
  // The assigned reporting manager is disabled/exited — exit can't proceed until
  // HR fixes the manager on the employee record.
  const [reportingManagerDisabled, setReportingManagerDisabled] = useState(false);
  const [comments, setComments]           = useState('');
  // Impact Assessment starts BLANK (MasterSelect shows its "Select…"
  // placeholder) — pre-selecting "Low" / "Yes — Immediate" let exits sail
  // through with an assessment nobody actually made. '' saves as null.
  const [businessImpact, setBusinessImpact] = useState('');
  const [replacementNeeded, setReplacementNeeded] = useState('');
  const [stage1Saving, setStage1Saving] = useState(false);

  /* ── Notice-period settlement ──────────────────────────────────────────
     Everything here is DERIVED from Stage 1 (type, dates, notice period) plus
     the salary basis; only the basis, the monthly figure and the payment
     record are actually entered. `settleStatus` is the gate Final
     Deactivation & Closure reads. */
  /* Always monthly BASIC — the recovery is priced on basic ÷ 30. A gross/basic
     choice only invited two different figures for the same settlement. */
  const noticeBasis = 'basic' as const;
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [settleStatus, setSettleStatus]   = useState('NA');
  // Recovery side: what the employee paid + HR's verdict on it.
  const [noticePayment, setNoticePayment] = useState<any>(null);
  const [rcv, setRcv] = useState({ amount: '', date: '', mode: 'UPI', bank: '', ref: '', remarks: '' });
  // Payment-in-lieu side lives inside the FnF stage.
  const [fnf, setFnf] = useState<any>(null);
  const [fnfLines, setFnfLines] = useState({ basic: '', leaveEncash: '', bonus: '', loan: '' });
  const [fnfMeta, setFnfMeta]   = useState({ approval: '', payStatus: 'Pending', payMode: 'Bank Transfer (NEFT)', payDate: '' });
  const [settleSaving, setSettleSaving] = useState(false);
  /* Mandatory F&F document — uploaded separately (multipart) and stored on the
     exit's fnf blob, so it survives a Save Draft without re-uploading. */
  const [fnfDoc, setFnfDoc] = useState<{ name: string; url?: string } | null>(null);
  const [fnfDocUploading, setFnfDocUploading] = useState(false);
  /* Live dues pulled from the modules that hold them — earned salary for the
     exit month (payroll skipped it), outstanding advances, unpaid claims. */
  const [fnfDues, setFnfDues] = useState<any>(null);
  const [duesLoading, setDuesLoading] = useState(false);
  /* Payments the EMPLOYEE submitted themselves (profile → Payroll Details →
     Do Payment). HR verifies these rather than retyping them. */
  const [empPayments, setEmpPayments] = useState<any[]>([]);
  const [empPayLoading, setEmpPayLoading] = useState(false);

  const settlement = settlementOf(exitType);
  /* Blacklist is asked on EVERY exit type. Someone who served their notice
     properly can still be barred from re-hire (conduct, a failed handover, a
     background finding), so gating the question on the settlement was wrong —
     it hid the decision exactly where HR still needed to make it. */
  const blacklistApplies = true;
  const stages     = useMemo(() => stagesFor(exitType), [exitType]);
  const stageCount = stages.length;
  const currentKey: StageKey = (stages[stage - 1] ?? stages[0]).key;

  // Changing the exit type reshapes the stage list, so a position that no
  // longer exists has to be pulled back in range.
  useEffect(() => {
    if (stage > stageCount) setStage(stageCount);
  }, [stageCount, stage]);

  // Prefill the monthly figure from the employee's package the first time the
  // settlement is looked at; HR can overwrite it.
  useEffect(() => {
    if (!monthlyAmount && employee?.monthlySalary) setMonthlyAmount(String(employee.monthlySalary));
  }, [employee?.monthlySalary, monthlyAmount]);

  /* The settlement figures. Overtime-style rule set:
       · days served  = last working day − notice start, clamped to the period
       · unserved     = required − served
       · per-day rate = monthly figure ÷ 30
       · amount       = unserved × rate, and always 0 when the notice was served
     A late-starting exit, a probation exit or a resignation inside the 15-day
     early-exit window carries no notice period, so `required` collapses to 0
     and nothing is ever owed. */
  const settle = useMemo(() => {
    const required = noticeWaived ? 0 : Number(employee?.noticePeriodDays ?? 0) || 0;
    const dayMs = 86400000;
    let served = 0;
    if (noticeDate && lwd) {
      const d = Math.round((new Date(lwd + 'T00:00:00').getTime() - new Date(noticeDate + 'T00:00:00').getTime()) / dayMs);
      served = Math.max(0, Math.min(required, d));
    }
    const unserved = Math.max(0, required - served);
    const monthly  = Math.max(0, Number(monthlyAmount) || 0);
    const perDay   = monthly > 0 ? monthly / 30 : 0;
    const amount   = settlement === 'served' ? 0 : Math.round(unserved * perDay * 100) / 100;
    return { required, served, unserved, monthly, perDay, amount };
  }, [noticeWaived, employee?.noticePeriodDays, noticeDate, lwd, monthlyAmount, settlement]);

  /* NA once nothing is owed; otherwise Pending until the money is accounted
     for — approved (recovery) or fully disbursed (payment in lieu). */
  const effSettleStatus = settlement === 'served' || settle.amount <= 0
    ? 'NA'
    : (settleStatus === 'Settled' || settleStatus === 'Rejected' ? settleStatus : 'Pending');

  /* Full & Final (Termination only). The notice pay-in-lieu is an EARNING here
     — the company owes it — so it sits with the other dues rather than in the
     deductions column where a recovery would go. */
  const fnfNum = (v: string) => Math.max(0, Number(v) || 0);

  /* A notice RECOVERY only hits F&F when it wasn't collected in cash. The
     Notice Period Payment stage owns that money: paid by transfer/cheque it has
     already come in and must not be deducted again here, so it only lands in
     F&F when HR recorded the mode as "Adjusted against F&F dues". */
  const noticeAdjustedInFnf = settlement === 'recover'
    && String(noticePayment?.mode ?? '').startsWith('Adjusted against F&F');

  /* Pull the real dues when the F&F stage is opened. Kept out of the main exit
     load so the wizard doesn't pay for it on every open — only the stage that
     needs it fetches it, and only once the last working day is known (the
     earned-salary pro-ration keys off that date). */
  useEffect(() => {
    if (currentKey !== 'fnf' || !employee || fnfDues || duesLoading) return;
    setDuesLoading(true);
    api.get(`/employees/${employee.id}/exit/fnf-summary`)
      .then(({ data }) => setFnfDues(data?.data ?? null))
      .catch(() => setFnfDues(null))
      .finally(() => setDuesLoading(false));
  }, [currentKey, employee?.id, fnfDues, duesLoading]);

  /* Prefill the editable lines from the pulled figures — only where HR hasn't
     already typed something, so reopening the stage never overwrites their
     work. Advances/claims are shown as their own read-only lines rather than
     folded into these. */
  useEffect(() => {
    if (!fnfDues) return;
    const earned = Number(fnfDues.payroll?.amount ?? 0);
    setFnfLines(s => {
      /* Prefill when the line is empty OR still zero. `s.basic || …` alone made
         a zero STICKY: a settlement opened while the old calendar-day estimate
         returned ₹0 (which it did for anyone paid via a salary structure with
         no annual_salary) kept that 0 forever, even once the payroll engine
         could price the month properly. A zero earned salary is never a
         deliberate HR entry worth protecting; any non-zero figure they typed
         still is. */
      const current = Number(s.basic);
      const keep = s.basic !== '' && Number.isFinite(current) && current !== 0;
      return keep ? s : { ...s, basic: earned ? String(earned) : '' };
    });
  }, [fnfDues]);

  const duesAdvances = Number(fnfDues?.advances?.total ?? 0);
  const duesClaims   = Number(fnfDues?.claims?.total ?? 0);
  // Company advances must be fully reconciled (settled / returned-and-approved /
  // reimbursement raised) before the F&F can close. Self advances never block —
  // they're recovered from the F&F itself. Mirrors the ExitController gate.
  const advancesAllComplete = fnfDues?.advances?.all_complete !== false;
  const advancesIncomplete: any[] = (fnfDues?.advances?.items ?? []).filter((a: any) => a && a.complete === false);

  /* Has the Full & Final settlement actually been paid? This gates the
     document release: the relieving letter and experience certificate go out
     only after the employee has their money, which is why F&F now sits BEFORE
     Exit Documents in the stage order. Mirrored server-side in ExitController. */
  const fnfPaid = fnfMeta.payStatus === 'Paid';
  const fnfBlockHint = 'The Full & Final settlement must be paid before exit documents can be released.';
  const fnfNet = useMemo(() => {
    const earn = fnfNum(fnfLines.basic) + fnfNum(fnfLines.leaveEncash)
               + fnfNum(fnfLines.bonus)
               + duesClaims                                        // approved, unpaid reimbursements
               + (settlement === 'pay_in_lieu' ? settle.amount : 0);
    const ded  = fnfNum(fnfLines.loan)
               + duesAdvances                                      // unrecovered salary advances
               + (noticeAdjustedInFnf ? settle.amount : 0);
    return Math.round((earn - ded) * 100) / 100;
  }, [fnfLines, settlement, settle.amount, noticeAdjustedInFnf, duesClaims, duesAdvances]);
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
  const fmtMoney = (n: number) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Notice start date may be today, but not in the past — UNLESS it's the value
  // already saved on this exit (revisiting an in-progress case shouldn't flag a
  // historical date the user never touched).
  const noticeDateInvalid = !!noticeDate && noticeDate !== loadedNoticeRef.current && noticeDate < todayIso;
  /* Last working day bounds — these follow the EXIT TYPE, because the whole
     point of the non-standard types is that the notice period is NOT served:

       Resignation            the notice IS served, so the last working day is
                              on/after the notice period end and must be a
                              future date.
       Resignation w/o notice the employee is leaving early — that's exactly
                              what is recovered from them — so the notice-end
                              floor doesn't apply and TODAY is a valid last day.
       Termination            relieving can be immediate, so the floor is the
                              termination date itself and today is valid.
       On probation           no notice period at all; immediate exit (existing
                              carve-out, unchanged).
       Early resignation      resigned within 15 days of joining — same waiver,
                              independent of probation.

     Applying the served-notice rule to every type was a bug: it pinned a
     "Resignation without notice period" exit to the notice-end date, making
     the type impossible to actually express. An already-saved value is still
     accepted as-is so reopening a case never invalidates it. */
  const noticeServed = !noticeWaived && settlement === 'served';
  const lwdMin = noticeServed
    ? (noticePeriodEnd || (noticeDate ? addDaysIso(noticeDate, 1) : tomorrowIso))
    : (noticeDate || todayIso);
  /* CEILING — the last working day can never be LATER than the notice period
     end date; the two may be the SAME day (serving the notice in full, which is
     what a standard resignation looks like). The notice period end is the last
     date the employee is on the books, so a last working day beyond it would
     have them working days they are no longer employed for — and it silently
     inflated "days served" in the notice settlement.

     Only applies when an end date actually exists. It does not for a waived
     notice (probation / early resignation) or when the employee record carries
     no notice period, and there is nothing to cap against in those cases. */
  const lwdMax = noticePeriodEnd || '';
  const lwdOverEnd = !!lwd && !!lwdMax && lwd > lwdMax;
  // "Must be a future date" is part of serving notice, so it is waived for the
  // types that don't serve one — they can be relieved today.
  const lwdInvalid = !!lwd && lwd !== loadedLwdRef.current
    && ((noticeServed ? (lwd <= todayIso || lwd < lwdMin) : lwd < lwdMin) || lwdOverEnd);
  // Picker `min`s must never exclude the value already saved on the exit — a
  // saved date earlier than today/lwdMin would otherwise get clamped forward to
  // the min on (re)mount, replacing the loaded value with "today".
  const ndLoaded   = loadedNoticeRef.current ? loadedNoticeRef.current.slice(0, 10) : '';
  const lwdLoaded  = loadedLwdRef.current ? loadedLwdRef.current.slice(0, 10) : '';
  const noticeMin  = ndLoaded && ndLoaded < todayIso ? ndLoaded : todayIso;
  const effLwdMin  = lwdLoaded && lwdLoaded < lwdMin ? lwdLoaded : lwdMin;
  /* Same protection on the ceiling as on the floor: a value already saved on
     the exit is never clamped away. An approved UNPAID leave during notice
     legitimately pushes the last working day PAST the notice end
     (NoticePeriodGuard::applyExtension), so a loaded date beyond the cap is
     valid history, not a mistake. */
  const effLwdMax  = lwdMax && lwdLoaded && lwdLoaded > lwdMax ? lwdLoaded : lwdMax;
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
  /* Exit-document release gate. Defaults to OFF — a sent document can't be
     un-sent, so the safe default is closed. It can only be switched ON once
     the Full & Final settlement has actually been PAID (see fnfPaid below):
     the relieving letter follows the money, never precedes it. */
  const [docsReleased, setDocsReleased] = useState(false);
  // Reopening F&F (back to unpaid) after a release must not leave the
  // documents open behind it — pull the gate shut again.
  useEffect(() => {
    if (!fnfPaid && docsReleased) setDocsReleased(false);
  }, [fnfPaid, docsReleased]);
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
  /* Blacklist decision, captured at final closure. Only posed where it can
     apply — an exit that skipped its notice, or a termination. A standard
     resignation never sees the field and saves null. */
  const [blacklisted, setBlacklisted]         = useState('No');
  const [blacklistReason, setBlacklistReason] = useState('');

  useEffect(() => {
    if (employee) {
      setStage(1);
      setStageStatus({ initiation: 'In Progress' });
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
        // No fallback default — an exit saved without an assessment reopens
        // blank, mirroring the initial state above.
        setBusinessImpact(String(data.business_impact ?? ''));
        setReplacementNeeded(String(data.replacement_required ?? ''));

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
        setDocsReleased(!!data.documents_released);

        if (Array.isArray(data.validation) && data.validation.length) {
          setValidation(data.validation.map((v: any) => !!v));
        }
        setEmpStatus(String(data.final_employee_status ?? data.employee_status ?? 'Active'));
        setProfileLock(String(data.profile_lock ?? 'Unlocked'));
        setExitCaseStatus(String(data.exit_case_status ?? 'Open'));
        setHrSignOff(String(data.hr_sign_off ?? 'Pending'));
        setBlacklisted(String(data.blacklisted ?? 'No') === 'Yes' ? 'Yes' : 'No');
        setBlacklistReason(String(data.blacklist_reason ?? ''));

        if (data.stage_status && typeof data.stage_status === 'object') {
          setStageStatus(normaliseStageStatus(data.stage_status));
        }
        // Clamped against the widest possible list here; the effect below
        // trims it to the real length once the exit type resolves the stages.
        const savedStage = Number(data.current_stage);
        if (savedStage >= 1 && savedStage <= 6) setStage(savedStage);

        // Notice-period settlement + FnF. The basis is no longer loaded — it's
        // always monthly basic now, so a stored 'gross' must not resurrect.
        setSettleStatus(String(data.notice_settlement_status ?? 'NA'));
        setNoticePayment(data.notice_payment && typeof data.notice_payment === 'object' ? data.notice_payment : null);
        const savedFnf = data.fnf && typeof data.fnf === 'object' ? data.fnf : null;
        setFnf(savedFnf);
        if (savedFnf?.lines) setFnfLines({ basic: '', leaveEncash: '', bonus: '', loan: '', ...savedFnf.lines });
        if (savedFnf?.meta)  setFnfMeta({ approval: '', payStatus: 'Pending', payMode: 'Bank Transfer (NEFT)', payDate: '', ...savedFnf.meta });
        if (savedFnf?.monthly && !String(savedFnf.monthly).startsWith('0')) setMonthlyAmount(String(savedFnf.monthly));
        setFnfDoc(savedFnf?.attachment?.name
          // Older rows stored only `path`; resolveFileUrl handles both a
          // "/storage/…" url and a bare disk-relative path.
          ? { name: savedFnf.attachment.name, url: resolveFileUrl(savedFnf.attachment.url || savedFnf.attachment.path) }
          : null);

        // The type is answered BEFORE this modal opens (the list routes both
        // Initiate and Continue through the picker when it's missing), so the
        // wizard never has to pop a question over itself.
      })
      .catch(() => {  });
    return () => { cancelled = true; };
  }, [employee?.id]);

  // The COMPLETE list of everything that blocks "Complete Exit" — surfaced both
  // in the Stage-4 panel AND enforced in completeExit(), so the user sees every
  // blocker at once instead of hitting them one toast at a time.
  const exitPending = useMemo(() => {
    const CLR = ['Manager', 'IT', 'Admin', 'Finance', 'Legal / Compliance'];
    const CHK = ['All clearances obtained', 'All assets handed over', 'All access revoked', 'Exit documents signed', 'Exit interview completed'];
    const items: string[] = [];

    // 1. The last working day must have arrived.
    if (!lwdReached) {
      items.push(lwd ? `Last working day not yet reached (${fmtDateShort(lwd)})` : 'Last working day not set');
    }

    // 2. The reporting manager must be active (not disabled / exited).
    if (reportingManagerDisabled) {
      items.push('Reporting manager is disabled / exited — change it on the employee record');
    }

    // 2b. The notice-period settlement has to have been closed out — money
    //     recovered and approved, or paid in full. Mirrored server-side in
    //     ExitController::complete().
    if (effSettleStatus === 'Pending') {
      items.push(settlement === 'recover'
        ? `Notice-period recovery of ${fmtMoney(settle.amount)} not verified — approve it in Notice Period Payment`
        : `Notice-period payment of ${fmtMoney(settle.amount)} not disbursed — settle it in Full & Final Settlement`);
    } else if (effSettleStatus === 'Rejected') {
      items.push('Notice-period payment was rejected — record a fresh payment and approve it');
    }

    // 2c. The Full & Final settlement has to be approved and disbursed. A
    //     leaver is dropped from the regular payroll run for their exit month,
    //     so closing the case with F&F outstanding would leave them unpaid.
    if (fnfMeta.approval !== 'Approved') {
      items.push('Full & Final settlement not approved by the finance controller');
    } else if (fnfMeta.payStatus !== 'Paid') {
      items.push('Full & Final settlement approved but not yet paid');
    }

    // 3. Every assigned asset must be Handed Over (Pending / Not Returned block).
    const assignedAssets: { id: number; label: string }[] = [];
    if (employee?.laptopAsset) assignedAssets.push({ id: employee.laptopAsset.id, label: employee.laptopAsset.asset_name });
    if (employee?.mobileAsset) assignedAssets.push({ id: employee.mobileAsset.id, label: employee.mobileAsset.asset_name });
    for (const a of employee?.otherAssets || []) assignedAssets.push({ id: a.id, label: a.asset_name });
    const assetsPending = assignedAssets.filter(a => (assetReturns[a.id]?.status ?? 'Pending') !== 'Handed Over');
    if (assetsPending.length) {
      items.push(`${assetsPending.length} asset${assetsPending.length > 1 ? 's' : ''} not handed over`);
    }

    // 4. Every matched exit document must be fully signed.
    const unsigned = exitTemplates.filter(t => runByTemplateId.get(t.id)?.status !== 'Completed');
    if (exitTemplates.length > 0 && unsigned.length) {
      items.push(`${unsigned.length} exit document${unsigned.length > 1 ? 's' : ''} not fully signed`);
    }

    // 5. Every departmental clearance must be approved.
    clearances.forEach((c, i) => { if (c.status !== 'Approved') items.push(`${CLR[i]} clearance — ${c.status || 'Pending'}`); });

    // 4. Every final-validation checklist item must be ticked.
    validation.forEach((v, i) => { if (!v) items.push(CHK[i]); });

    // 5. HR Final Sign-off must be Approved (Rejected / Pending block).
    if (hrSignOff !== 'Approved') items.push(`HR final sign-off — ${hrSignOff === 'Rejected' ? 'Rejected' : 'Pending'}`);

    // 6. Blacklisting someone needs a reason on record — it blocks re-hire, so
    //    a bare "Yes" with no justification must not close the case.
    if (blacklistApplies && blacklisted === 'Yes' && !blacklistReason.trim()) {
      items.push('Blacklist reason is required when blacklisting an employee');
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lwdReached, lwd, reportingManagerDisabled, employee, assetReturns, exitTemplates, runByTemplateId, clearances, validation, hrSignOff, effSettleStatus, settlement, settle.amount, fnfMeta.approval, fnfMeta.payStatus, blacklistApplies, blacklisted, blacklistReason]);

  /* Payments the EMPLOYEE submitted from their own Payroll Details tab, loaded
     when the recovery stage is opened. MUST stay above the early return below —
     a hook after it is called conditionally, which breaks the hook order the
     moment `employee` goes from null to set. */
  const loadEmployeePayments = useCallback(() => {
    if (!employee) return;
    setEmpPayLoading(true);
    api.get(`/employees/${employee.id}/notice-payment`)
      .then(({ data }) => setEmpPayments(data?.data?.payments ?? []))
      .catch(() => setEmpPayments([]))
      .finally(() => setEmpPayLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  useEffect(() => {
    if (currentKey === 'notice_payment') loadEmployeePayments();
  }, [currentKey, loadEmployeePayments]);

  if (!employee) return null;

  const statusOf = (k: StageKey): StageStatus => stageStatus[k] || (k === currentKey ? 'In Progress' : 'Pending');

  const rawStagePct = (n: StageKey): number => {
    if (n === 'initiation') {
      /* Only the fields HR actually FILLS IN on this stage — it must read 0%
         on a freshly opened exit.

         Two were counted that HR never enters, which is where the phantom
         "50% with an empty form" came from:
           · exitType — answered in the type picker BEFORE this modal opens
             (the list routes both Initiate and Continue through it), so it is
             always already set and the stage could never start at zero.
           · reportingManagerId — read-only, populated from the employee
             record; the field on screen is disabled.

         Notice Start Date was missing even though saveStage1() requires it.
         The set now mirrors that required list exactly (minus exitType), so
         100% here means "Save & Next will pass" rather than an unrelated
         count. Business Impact / Replacement Required stay OUT: they are
         optional, and counting them would stop the stage ever reaching 100%
         for HR who legitimately skip them. */
      const items = [
        !!String(reasonForExit).trim(),
        !!String(noticeDate).trim(),
        !!String(lwd).trim(),
      ];
      return Math.round((items.filter(Boolean).length / items.length) * 100);
    }
    // The notice recovery is binary: collected and approved, or not.
    if (n === 'notice_payment') {
      return effSettleStatus === 'NA' || effSettleStatus === 'Settled' ? 100 : 0;
    }
    // F&F needs finance approval AND the payment recorded before it's done.
    if (n === 'fnf') {
      const done = (fnfMeta.approval === 'Approved' ? 1 : 0) + (fnfMeta.payStatus === 'Paid' ? 1 : 0);
      return Math.round((done / 2) * 100);
    }
    if (n === 'clearance') {
      const assetIds  = Object.keys(assetReturns);
      const assetDone = assetIds.filter(k => assetReturns[Number(k)]?.status === 'Handed Over').length;
      const clrDone   = clearances.filter(c => c.status === 'Approved').length;
      const notesDone = handoverNotes.trim() ? 1 : 0;
      const total = assetIds.length + clearances.length + 1;
      const done  = assetDone + clrDone + notesDone;
      return total === 0 ? 0 : Math.round((done / total) * 100);
    }
    if (n === 'documents') {
      const total = exitTemplates.length;
      if (total === 0) return 0;
      const done = exitTemplates.filter(t => runByTemplateId.get(t.id)?.status === 'Completed').length;
      return Math.round((done / total) * 100);
    }
    if (n === 'closure') {
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

  const effStatusOf = (n: StageKey): StageStatus => {
    // Clearance & Handover — only complete when EVERY clearance is approved AND
    // EVERY assigned asset is handed over. A stale persisted "Completed" must
    // not show 100% while clearances/assets are still pending.
    if (n === 'clearance') {
      const allClr = clearances.every(c => c.status === 'Approved');
      const assetIds: number[] = [];
      if (employee?.laptopAsset) assetIds.push(employee.laptopAsset.id);
      if (employee?.mobileAsset) assetIds.push(employee.mobileAsset.id);
      for (const a of employee?.otherAssets || []) assetIds.push(a.id);
      const allAssets = assetIds.every(id => (assetReturns[id]?.status ?? 'Pending') === 'Handed Over');
      if (!allClr || !allAssets) {
        return (n === currentKey || rawStagePct('clearance') > 0 || stageStatus.clearance === 'In Progress') ? 'In Progress' : 'Pending';
      }
    }
    // Exit Documents is only complete once EVERY exit document is fully SIGNED.
    // Merely sending one (run Pending/In Progress) must not flip it to 100%.
    if (n === 'documents') {
      const total = exitTemplates.length;
      const allSigned = total > 0 && exitTemplates.every(t => runByTemplateId.get(t.id)?.status === 'Completed');
      if (!allSigned) {
        const anySent = exitTemplates.some(t => runByTemplateId.has(t.id));
        return (n === currentKey || anySent || rawStagePct('documents') > 0 || stageStatus.documents === 'In Progress') ? 'In Progress' : 'Pending';
      }
    }
    // A settlement stage is only complete once the money is accounted for.
    if (n === 'notice_payment' && effSettleStatus !== 'NA' && effSettleStatus !== 'Settled') {
      return 'In Progress';
    }
    if (n === 'fnf' && rawStagePct('fnf') < 100) {
      return 'In Progress';
    }
    // Final Deactivation & Closure is only complete when there are NO
    // outstanding blockers — it can't show 100% while earlier stages (assets,
    // clearances, documents, sign-off, last working day) are unfinished.
    if (n === 'closure' && exitPending.length > 0) {
      return (n === currentKey || rawStagePct('closure') > 0 || stageStatus.closure === 'In Progress') ? 'In Progress' : 'Pending';
    }
    /* A stage is Completed only when its OWN measure says so.
       `stageStatus[n]` is stamped 'Completed' by Save & Next / markStageCompleted,
       and letting that stamp alone win meant simply moving on jumped a
       part-filled stage straight to 100% — a 75% stage read as done the moment
       you clicked Next (#54), which is exactly the reassurance the percentage
       is supposed to withhold.

       The stamp still carries intent: it keeps a stage the user has worked on
       out of 'Pending' (second line) even when nothing measurable landed yet.
       It just can no longer claim a completion the data doesn't support. */
    if (rawStagePct(n) === 100) return 'Completed';
    if (n === currentKey || rawStagePct(n) > 0
        || stageStatus[n] === 'In Progress' || stageStatus[n] === 'Completed') return 'In Progress';
    return 'Pending';
  };

  const completed = stages.filter(s => effStatusOf(s.key) === 'Completed').length;
  const progressPct = Math.round((completed / stageCount) * 100);

  const advance = () => {
    if (stage < stageCount) {
      setStage(stage + 1);
      setStageStatus(prev => ({
        ...prev,
        [stages[stage].key]: prev[stages[stage].key] === 'Completed' ? 'Completed' : 'In Progress',
      }));
    }
  };
  const markStageCompleted = (k: StageKey) => {
    setStageStatus(prev => ({ ...prev, [k]: 'Completed' }));
  };
  const goBack = () => {
    if (stage > 1) {
      setStage(stage - 1);
      setStageStatus(prev => ({ ...prev, [stages[stage - 2].key]: 'In Progress' }));
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
    documents_released:    docsReleased,
    validation,
    final_employee_status: empStatus || null,
    profile_lock:          profileLock || null,
    hr_sign_off:           hrSignOff || null,
    // Null when the question doesn't apply, so "not asked" stays distinct from
    // a genuine "No" (the server enforces the same rule).
    blacklisted:           blacklistApplies ? blacklisted : null,
    blacklist_reason:      blacklistApplies && blacklisted === 'Yes' ? (blacklistReason.trim() || null) : null,
    stage_status:          stageStatus,
    current_stage:         stage,

    // Notice-period settlement. The figures are recomputed from Stage 1 on
    // every save, so a date or salary edit can never leave a stale amount
    // attached to the exit.
    notice_days_required:     settle.required,
    notice_days_served:       settle.served,
    notice_days_unserved:     settle.unserved,
    notice_settlement_basis:  noticeBasis,
    notice_per_day_rate:      Math.round(settle.perDay * 100) / 100,
    notice_settlement_amount: settle.amount,
    notice_settlement_status: effSettleStatus,
    notice_payment:           noticePayment,
    // Every exit type carries an F&F now — the exit month's payroll is skipped
    // for a leaver, so this is where their salary and dues are settled.
    // Carry the uploaded document through — it is stored on this same blob
    // by a separate multipart call, so omitting it here would wipe it on
    // the next Save Draft.
    fnf:                      { lines: fnfLines, meta: fnfMeta, net: fnfNet, monthly: settle.monthly,
                                ...(fnf?.attachment ? { attachment: fnf.attachment } : {}) },
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

    // Reporting manager must be active — block if disabled / exited.
    if (reportingManagerDisabled) {
      toast.error(
        'Reporting manager is disabled',
        'This employee’s reporting manager is disabled / has exited. Change the reporting manager on the employee record (Add / Edit Employee) first, then complete the exit.',
      );
      setStage(1);
      return;
    }

    // Every assigned asset must be Handed Over (Pending / Not Returned block).
    const assignedAssets: { id: number }[] = [];
    if (employee.laptopAsset) assignedAssets.push({ id: employee.laptopAsset.id });
    if (employee.mobileAsset) assignedAssets.push({ id: employee.mobileAsset.id });
    for (const a of employee.otherAssets || []) assignedAssets.push({ id: a.id });
    const assetsPending = assignedAssets.filter(a => (assetReturns[a.id]?.status ?? 'Pending') !== 'Handed Over');
    if (assetsPending.length) {
      toast.error(
        `Exit can't be completed — ${assetsPending.length} asset${assetsPending.length > 1 ? 's' : ''} not handed over`,
        'Mark every assigned asset as “Handed Over” in Clearance & Handover (Stage 2) before completing the exit.',
      );
      setStage(2);
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
      markStageCompleted(currentKey);
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
        (() => {
          // The last-working-day rule depends on whether a notice is served,
          // so the message has to say the right thing for each exit type.
          const lwdMsg = noticeServed
            ? 'the last working day must be a future date on/after the notice period end date'
            : settlement === 'pay_in_lieu'
              ? 'the last working day cannot be before the termination date'
              : 'the last working day cannot be before the notice start date';
          if (noticeDateInvalid && lwdInvalid) return `Notice start date cannot be in the past, and ${lwdMsg}.`;
          if (noticeDateInvalid) return 'Notice start date cannot be in the past.';
          return `${lwdMsg.charAt(0).toUpperCase()}${lwdMsg.slice(1)}.`;
        })(),
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

  /**
   * Navigate to a stage from the sidebar stepper.
   *
   * Leaving Stage 1 runs the SAME gate as the Next Stage button — saveStage1()
   * validates the mandatory fields, surfaces the inline errors and toast, and
   * only then persists. The stepper used to be a plain `setStage`, so an exit
   * could be walked straight past Stage 1 with Reason / Notice Start Date /
   * Last Working Day still empty: the validation existed but guarded only one
   * of the two ways out.
   *
   * Only LEAVING stage 1 is gated. Coming back to it, and moving between any
   * later stages, is free — those have their own completion rules and blocking
   * navigation there would trap HR on a stage they cannot yet finish.
   */
  const goToStage = async (num: number, key: StageKey) => {
    if (num === stage) return;
    if (currentKey === 'initiation') {
      if (stage1Saving) return;             // a save is already in flight
      const ok = await saveStage1();
      if (!ok) return;                      // errors already shown by saveStage1
      markStageCompleted('initiation');
    }
    setStage(num);
    setStageStatus(prev => ({
      ...prev,
      [key]: prev[key] === 'Completed' ? 'Completed' : 'In Progress',
    }));
  };

  const current = stages[stage - 1] ?? stages[0];
  const isLastStage = stage === stageCount;

  /* HR's verdict on a payment the employee submitted. The endpoint also
     mirrors the decision onto the exit case, so the completion gate updates
     without a second save from here. */
  const decideEmployeePayment = async (id: number, verdict: 'approve' | 'reject') => {
    if (settleSaving) return;
    setSettleSaving(true);
    try {
      const { data } = await api.post(`/notice-payments/${id}/${verdict}`, {});
      toast.success(verdict === 'approve' ? 'Payment approved' : 'Payment rejected',
        data?.message || '');
      setSettleStatus(verdict === 'approve' ? 'Settled' : 'Rejected');
      if (verdict === 'approve') markStageCompleted('notice_payment');
      loadEmployeePayments();
    } catch (err: any) {
      toast.error('Could not record the decision', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSettleSaving(false);
    }
  };

  /* ── Settlement actions ────────────────────────────────────────────────
     Recovery side: HR verifies what the employee paid, then approves it.
     Approving under the amount due is refused — a part payment doesn't
     settle the exit, and letting it through would close the case on money
     that was never collected. */
  const recordVerdict = async (verdict: 'approved' | 'rejected') => {
    if (!employee || settleSaving) return;
    const got = Number(rcv.amount) || 0;
    const ref = rcv.ref.trim();
    const missing: string[] = [];
    if (got <= 0) missing.push('Amount Received');
    if (!rcv.date)         missing.push('Payment Date');
    if (!rcv.bank.trim())  missing.push('Bank Name');
    if (!ref)              missing.push('UTR / Cheque Number');
    if (missing.length) {
      toast.warning('Complete the payment details', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`);
      return;
    }
    if (verdict === 'approved' && got + 0.005 < settle.amount) {
      toast.warning('Amount is short',
        `${fmtMoney(got)} received against ${fmtMoney(settle.amount)} due — collect the balance, or reject this payment.`);
      return;
    }

    setSettleSaving(true);
    try {
      /* Goes through the payments endpoint rather than straight onto the exit
         JSON, so an HR-recorded payment writes the SAME row an employee
         submission would — otherwise it never appears in the employee's own
         Payment Details tab and they'd see "nothing submitted" against a
         settlement HR had already closed. */
      const { data } = await api.post(`/employees/${employee.id}/notice-payment/record`, {
        amount: got,
        payment_mode: rcv.mode,
        bank_name: rcv.bank.trim(),
        utr_cheque_number: ref,
        payment_date: rcv.date,
        remarks: rcv.remarks.trim() || null,
        verdict: verdict === 'approved' ? 'Approved' : 'Rejected',
      });
      setSettleStatus(verdict === 'approved' ? 'Settled' : 'Rejected');
      setNoticePayment({
        amount: got, date: rcv.date, mode: rcv.mode, bank: rcv.bank.trim(),
        ref, remarks: rcv.remarks.trim(), verdict,
      });
      toast.success(verdict === 'approved' ? 'Payment approved' : 'Payment rejected',
        data?.message || '');
      if (verdict === 'approved') markStageCompleted('notice_payment');
      setRcv({ amount: '', date: '', mode: 'UPI', bank: '', ref: '', remarks: '' });
      loadEmployeePayments();
    } catch (err: any) {
      const e = err?.response?.data;
      const first = e?.errors ? (Object.values(e.errors)[0] as string[])?.[0] : null;
      toast.error('Could not save', first || e?.message || 'Please try again.');
    } finally {
      setSettleSaving(false);
    }
  };

  const uploadFnfDoc = async (file: File | null) => {
    if (!file || !employee || fnfDocUploading) return;
    setFnfDocUploading(true);
    try {
      const fd = new FormData();
      fd.append('attachment', file);
      const { data } = await api.post(`/employees/${employee.id}/exit/fnf-attachment`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFnfDoc({
        name: data?.attachment?.name || file.name,
        url: resolveFileUrl(data?.attachment?.url || data?.attachment?.path),
      });
      // Mirror onto the fnf blob too — buildExitPayload reads it from there,
      // so without this the next Save Draft would overwrite the upload.
      setFnf((prev: any) => ({ ...(prev || {}), attachment: data?.attachment }));
      toast.success('Document uploaded', data?.message || '');
    } catch (err: any) {
      const e = err?.response?.data;
      const first = e?.errors ? (Object.values(e.errors)[0] as string[])?.[0] : null;
      toast.error('Upload failed', first || e?.message || 'Please try again.');
    } finally {
      setFnfDocUploading(false);
    }
  };

  /* F&F disbursement. Every exit type ends here, since a leaver is dropped
     from the regular payroll run for their exit month. On a Termination this
     also settles the notice pay-in-lieu (the company owes it, and this is where
     it goes out); on the other types the notice settlement is either nil or was
     already closed at the Notice Period Payment stage. */
  const markFnfPaid = async () => {
    if (!employee || settleSaving) return;
    if (!fnfDoc) {
      toast.warning('Full & Final document required',
        'Upload the signed F&F sheet or payment advice before marking the settlement paid.');
      return;
    }
    if (!fnfMeta.payDate) { toast.warning('Payment date required', 'Enter the date the payment was made.'); return; }
    if (fnfMeta.approval !== 'Approved') {
      toast.warning('Finance approval pending', 'The finance controller must approve the settlement before it can be marked paid.');
      return;
    }
    if (!advancesAllComplete) {
      const refs = advancesIncomplete.map(a => a.reference || a.type).filter(Boolean).join(', ');
      toast.warning('Company advances not settled',
        `Settle / return (payments approved) / raise reimbursement for ${refs || 'the flagged advance(s)'} before marking the F&F paid.`);
      return;
    }
    // Only the pay-in-lieu money is settled BY this stage. A recovery is owned
    // by the Notice Period Payment stage, so don't overwrite its verdict here.
    const settlesNotice = settlement === 'pay_in_lieu' && settle.amount > 0;
    if (settlesNotice) {
      setSettleStatus('Settled');
    }
    setFnfMeta(s => ({ ...s, payStatus: 'Paid' }));
    setSettleSaving(true);
    try {
      await api.put(`/employees/${employee.id}/exit`, {
        ...buildExitPayload(),
        ...(settlesNotice ? { notice_settlement_status: 'Settled' } : {}),
        fnf: { lines: fnfLines, meta: { ...fnfMeta, payStatus: 'Paid' }, net: fnfNet, monthly: settle.monthly,
               ...(fnf?.attachment ? { attachment: fnf.attachment } : {}) },
      });
      toast.success('Settlement recorded', settlesNotice
        ? `${fmtMoney(fnfNet)} F&F paid, including ${fmtMoney(settle.amount)} in lieu of notice.`
        : `${fmtMoney(fnfNet)} F&F marked paid.`);
      markStageCompleted('fnf');
    } catch (err: any) {
      toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSettleSaving(false);
    }
  };

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
                {/* Exit type chip — the type drives the whole flow (which
                    stages exist, the settlement direction, the LWD bounds), so
                    it belongs in the header next to Status instead of only in
                    the Stage-1 form. The long "without notice period" wording
                    is shortened here and kept in full in the title. */}
                {!!exitType.trim() && (
                  <span className="ep-head-chip" title={exitType}>
                    <i className="ri-logout-box-r-line" />
                    {exitType === 'Resignation without notice period' ? 'Resignation (no notice)' : exitType}
                  </span>
                )}
                <span className="ep-head-chip"><i className="ri-time-line" />Status: {statusOf(currentKey)}</span>
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
            {stages.map(s => {
              const st = effStatusOf(s.key);
              const stagePct = st === 'Completed' ? 100 : rawStagePct(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`ep-stage-card ep-stage-card--${st.toLowerCase().replace(' ', '-')}${stage === s.num ? ' is-current' : ''}`}
                  // Same mandatory-field gate as Next Stage — see goToStage().
                  disabled={stage1Saving && currentKey === 'initiation' && s.num !== stage}
                  onClick={() => { void goToStage(s.num, s.key); }}
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

            {currentKey === 'initiation' && (
              <>
                <div className="ep-section-label">Exit Details</div>
                <div className="ep-approval-card ep-details-card mb-2">
                <Row className="g-2">
                  <Col md={6}>
                    <EpField label="Exit Type" required invalid={s1Errors.has('exitType')}>
                      {/* Locked once chosen in the Initiate-Exit picker. The
                          type decides the stage list and the whole notice
                          settlement, so changing it mid-process would strand
                          anything already recorded against the old one — it is
                          fixed for the life of the case (enforced server-side
                          in ExitController too). */}
                      <div className="ep-type-lock">
                        {exitType ? (
                          // Shown as a tinted badge (same palette as the Exit
                          // Type column) rather than plain text — the type is
                          // the one field on this form that can never change,
                          // so it reads as a state, not an editable value.
                          <span
                            className="ep-type-value ep-type-badge"
                            style={{
                              background: exitTypeTone(exitType).bg,
                              color: exitTypeTone(exitType).fg,
                              border: `1px solid ${exitTypeTone(exitType).bd}`,
                            }}
                          >
                            {exitType}
                          </span>
                        ) : (
                          <span className="ep-type-value is-empty">Not selected</span>
                        )}
                        <i className="ri-lock-line ep-type-locked" title="The exit type cannot be changed once the exit has started." />
                      </div>
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
                    <EpField label={`Notice Period End Date${!noticeWaived && employee?.noticePeriodLabel ? ` (${employee.noticePeriodLabel})` : ''}`}>
                      <EpInput
                        type="date"
                        value={noticePeriodEnd}
                        disabled
                        onChange={() => {}}
                      />
                      <div className="ep-hint" style={{ fontSize: 11, color: noticeWaived ? '#b45309' : 'var(--vz-secondary-color)', marginTop: 4 }}>
                        {/* Probation is stated first when both apply: it's the
                            longer-running condition and the one HR recognises. */}
                        {onProbation
                          ? `Not applicable — employee is on probation until ${probationEndLabel(employee?.probationEndIso)}. No notice period is served; the exit can be effective immediately.`
                          : earlyResignation
                            ? `Not applicable — resigned within ${EARLY_EXIT_DAYS} days of joining${earlyTenure != null ? ` (${earlyTenure} day(s))` : ''}. No notice period is served, the exit can be effective immediately, and this employee is not included in payroll processing.`
                            : (employee?.noticePeriodDays != null
                                ? 'Auto-calculated from the notice start date + the employee’s notice period.'
                                : 'No notice period set on this employee — set it on the employee record to auto-fill.')}
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
                            // Ceiling first — it applies to every exit type, so
                            // checking it before the type-specific floors keeps
                            // one message per mistake.
                            if (lwdMax && v > lwdMax) {
                              toast.warning(
                                'Invalid last working day',
                                `Last working day cannot be after the notice period end date (${fmtDateShort(lwdMax)}). It may be the same day, or earlier.`,
                              );
                            } else if (!noticeServed) {
                              // No notice is being served (probation, or an
                              // exit type that pays/recovers it instead), so
                              // today is fine — only "not before the start".
                              if (v < lwdMin) {
                                toast.warning('Invalid last working day',
                                  settlement === 'pay_in_lieu'
                                    ? 'Last working day cannot be before the termination date.'
                                    : 'Last working day cannot be before the notice start date.');
                              }
                            } else if (v <= todayIso) {
                              toast.warning('Invalid last working day', 'Last working day cannot be today or a past date.');
                            } else if (v < lwdMin) {
                              toast.warning(
                                'Invalid last working day',
                                noticePeriodEnd
                                  ? `Last working day must be on or after the notice period end date (${fmtDateShort(noticePeriodEnd)}). To release the employee earlier, change the exit type to “Resignation without notice period”.`
                                  : 'Last working day must be after the notice start date.',
                              );
                            }
                          }
                        }}
                        min={effLwdMin}
                        max={effLwdMax || undefined}
                        invalid={s1Errors.has('lwd') || lwdInvalid}
                      />
                      {(s1Errors.has('lwd') || lwdInvalid) && (
                        <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-error-warning-line" />
                          {lwdInvalid
                            ? (lwdOverEnd
                                ? `Last working day cannot be after the notice period end date (${fmtDateShort(lwdMax)}). It may be the same day, or earlier.`
                                : !noticeServed
                                ? (settlement === 'pay_in_lieu'
                                    ? 'Last working day cannot be before the termination date.'
                                    : 'Last working day cannot be before the notice start date.')
                                : (lwd <= todayIso
                                    ? 'Last working day cannot be today or a past date.'
                                    : (noticePeriodEnd
                                        ? `Last working day must be on or after the notice period end date (${fmtDateShort(noticePeriodEnd)}).`
                                        : 'Last working day must be after the notice start date.')))
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
                </div>

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

            {/* ── Notice Period Payment — "Resignation without notice period".
                   The employee owes the unserved days; HR records what came in
                   and approves it. Approval is the only thing that settles it. */}
            {currentKey === 'notice_payment' && (
              <>
                <div className="ep-section-label">Notice Period Recovery</div>
                <SettlementSummary
                  settle={settle} settlement={settlement} status={effSettleStatus}
                  monthly={monthlyAmount}
                  fmtMoney={fmtMoney}
                />

                {settle.amount <= 0 ? (
                  <div className="ep-settle-note is-ok">
                    <i className="ri-check-double-line" />
                    <span>
                      Nothing to recover — {settle.required === 0
                        ? 'this employee has no notice period on record.'
                        : 'the notice period was served in full.'} This stage does not block completion.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* What the EMPLOYEE submitted from their Payroll Details
                        tab, with their proof of transfer. HR verifies against
                        this rather than retyping it from an email. */}
                    <div className="ep-section-label" style={{ marginTop: 14 }}>Submitted by the Employee</div>
                    {empPayLoading ? (
                      <div className="ep-settle-note"><i className="ri-loader-4-line ri-spin" /><span>Loading submissions…</span></div>
                    ) : (empPayments.length === 0 ? (
                      <div className="ep-settle-note is-no">
                        <i className="ri-time-line" />
                        <span>
                          <strong>Nothing submitted yet.</strong><br />
                          The employee records this payment themselves from their profile → Payroll Details →
                          <em> Do Payment</em>. Once they do, it appears here for you to verify. You can still
                          record a payment manually below if it came in another way.
                        </span>
                      </div>
                    ) : (
                      <div className="ep-submitted">
                        {empPayments.map((p: any) => (
                          <div key={p.id} className={`ep-sub-card is-${String(p.status).toLowerCase()}`}>
                            <div className="ep-sub-head">
                              <span className="ep-sub-amt">{fmtMoney(p.amount)}</span>
                              <span className={`ep-sub-pill is-${String(p.status).toLowerCase()}`}>{p.status}</span>
                              <span className="ep-sub-when">
                                submitted {p.submitted_at ? fmtDateShort(String(p.submitted_at).slice(0, 10)) : '—'}
                              </span>
                            </div>
                            <div className="ep-sub-grid">
                              <div><span>Amount Due Then</span><strong>{fmtMoney(p.amount_due)}</strong></div>
                              <div><span>Mode</span><strong>{p.payment_mode || '—'}</strong></div>
                              <div><span>Bank</span><strong>{p.bank_name || '—'}</strong></div>
                              <div><span>UTR / Cheque</span><strong>{p.utr_cheque_number || '—'}</strong></div>
                              <div><span>Payment Date</span><strong>{p.payment_date ? fmtDateShort(p.payment_date) : '—'}</strong></div>
                              <div>
                                <span>Proof</span>
                                <strong>
                                  {p.attachment_url
                                    ? <a href={resolveFileUrl(p.attachment_url)} target="_blank" rel="noreferrer">
                                        <i className="ri-attachment-2" /> {p.attachment_name || 'View'}
                                      </a>
                                    : '—'}
                                </strong>
                              </div>
                            </div>
                            {p.employee_note && <div className="ep-sub-note"><strong>Employee note:</strong> {p.employee_note}</div>}
                            {p.status === 'Pending' ? (
                              <div className="ep-settle-actions">
                                <button type="button" className="ep-btn ep-btn--complete"
                                  disabled={settleSaving}
                                  onClick={() => decideEmployeePayment(p.id, 'approve')}>
                                  <i className="ri-check-double-line" />Verify &amp; Approve
                                </button>
                                <button type="button" className="ep-btn ep-btn--reject"
                                  disabled={settleSaving}
                                  onClick={() => decideEmployeePayment(p.id, 'reject')}>
                                  <i className="ri-close-circle-line" />Reject
                                </button>
                              </div>
                            ) : (
                              <div className="ep-sub-note">
                                {p.status} by {p.verified_by_name || 'HR'}
                                {p.verification_remarks ? ` — ${p.verification_remarks}` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}

                    {/* Manual entry disappears once the recovery is settled —
                        there is nothing left to record, and leaving the form up
                        invites a second payment against a closed settlement. */}
                    {effSettleStatus !== 'Settled' && (
                    <>
                    <div className="ep-section-label" style={{ marginTop: 14 }}>Record a Payment Manually</div>
                    <div className="ep-approval-card ep-details-card mb-2">
                      <Row className="g-2">
                        <Col md={4}>
                          <EpField label="Amount Received" required>
                            <EpInput type="number" value={rcv.amount} onChange={v => setRcv(s => ({ ...s, amount: v }))} placeholder={String(settle.amount)} />
                            <div className="ep-hint" style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 4 }}>
                              Amount due: {fmtMoney(settle.amount)}
                            </div>
                          </EpField>
                        </Col>
                        <Col md={4}>
                          <EpField label="Payment Date" required>
                            <EpInput type="date" value={rcv.date} onChange={v => setRcv(s => ({ ...s, date: v }))} max={todayIso} />
                          </EpField>
                        </Col>
                        <Col md={4}>
                          <EpField label="Payment Mode" required>
                            <EpSelect value={rcv.mode} onChange={v => setRcv(s => ({ ...s, mode: v }))}
                              options={['UPI', 'Cheque', 'Adjusted against F&F dues']} />
                          </EpField>
                        </Col>
                        <Col md={6}>
                          <EpField label="Bank Name" required>
                            <EpInput value={rcv.bank} onChange={v => setRcv(s => ({ ...s, bank: v }))} placeholder="Enter bank name" />
                          </EpField>
                        </Col>
                        <Col md={6}>
                          <EpField label="UTR / Cheque Number" required>
                            <EpInput value={rcv.ref} onChange={v => setRcv(s => ({ ...s, ref: v }))} placeholder="UPI ref or cheque number" maxLength={22} />
                            <div className="ep-hint" style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 4 }}>
                              UPI reference or cheque number.
                            </div>
                          </EpField>
                        </Col>
                        <Col xs={12}>
                          <EpField label="HR Verification Remarks">
                            <textarea className="ep-textarea" rows={2} value={rcv.remarks}
                              onChange={e => setRcv(s => ({ ...s, remarks: e.target.value }))}
                              placeholder="What was checked — bank credit confirmed, amount tallied, etc." />
                          </EpField>
                        </Col>
                      </Row>

                      {noticePayment?.verdict && (
                        <div className={`ep-settle-note ${noticePayment.verdict === 'approved' ? 'is-ok' : 'is-no'}`}>
                          <i className={noticePayment.verdict === 'approved' ? 'ri-check-double-line' : 'ri-close-circle-line'} />
                          <span>
                            <strong>{noticePayment.verdict === 'approved' ? 'Verified & approved.' : 'Rejected.'}</strong>{' '}
                            {fmtMoney(Number(noticePayment.amount) || 0)} · {noticePayment.mode} · ref {noticePayment.ref} · {noticePayment.date ? fmtDateShort(noticePayment.date) : '—'}
                            {noticePayment.remarks ? <><br />{noticePayment.remarks}</> : null}
                          </span>
                        </div>
                      )}

                      <div className="ep-settle-actions">
                        {/* No need to re-check for 'Settled' — the whole manual
                            block is hidden once the recovery is settled. */}
                        <button type="button" className="ep-btn ep-btn--complete"
                          disabled={settleSaving}
                          onClick={() => recordVerdict('approved')}>
                          <i className="ri-check-double-line" />Verify &amp; Approve
                        </button>
                        <button type="button" className="ep-btn ep-btn--reject"
                          disabled={settleSaving}
                          onClick={() => recordVerdict('rejected')}>
                          <i className="ri-close-circle-line" />Reject
                        </button>
                      </div>
                    </div>
                    </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Full & Final Settlement — Termination. The notice pay-in-lieu
                   is an EARNING here (the company owes it), alongside the usual
                   dues, with finance approval and the payment record. */}
            {currentKey === 'fnf' && (
              <>
                <div className="ep-settle-note is-ok" style={{ marginTop: 0, marginBottom: 12 }}>
                  <i className="ri-information-line" />
                  <span>
                    <strong>This employee is not in the regular payroll run for their exit month.</strong><br />
                    Anyone whose last working day falls inside a payroll cycle is excluded from it
                    {lwd ? <> (last working day {fmtDateShort(lwd)})</> : null} — the salary earned up to
                    that day, and every other due, is settled here instead. Paying both would pay twice.
                  </span>
                </div>

                {/* A RECOVERY is owned by the Notice Period Payment stage — it's
                    collected and approved there, so repeating the whole panel
                    here only invited HR to edit the same figure in two places.
                    Just its outcome is echoed. A PAY-IN-LIEU is different: this
                    stage is where that money actually goes out, so it keeps the
                    full editable summary. */}
                {settlement === 'recover' && (
                  <>
                    <div className="ep-section-label">Notice Period — Recovery</div>
                    <div className={`ep-echo ${effSettleStatus === 'Settled' ? 'is-ok' : effSettleStatus === 'Rejected' ? 'is-no' : 'is-due'}`}>
                      <i className={effSettleStatus === 'Settled' ? 'ri-check-double-line'
                        : effSettleStatus === 'Rejected' ? 'ri-close-circle-line' : 'ri-time-line'} />
                      <span className="ep-echo-txt">
                        <strong>{fmtMoney(settle.amount)}</strong> recoverable from the employee —{' '}
                        {effSettleStatus === 'Settled' ? 'collected and approved.'
                          : effSettleStatus === 'Rejected' ? 'the last payment was rejected, so it is still outstanding.'
                          : 'not settled yet.'}
                        <em> Handled in Stage {stages.find(s => s.key === 'notice_payment')?.num ?? 2} — Notice Period Payment.</em>
                      </span>
                      <span className="ep-echo-pill">
                        {effSettleStatus === 'Settled' ? 'Settled' : effSettleStatus === 'Rejected' ? 'Rejected' : 'Pending'}
                      </span>
                    </div>
                  </>
                )}

                {settlement === 'pay_in_lieu' && (
                  <>
                    <div className="ep-section-label">Notice Period — Payment in Lieu</div>
                    <SettlementSummary
                      settle={settle} settlement={settlement} status={effSettleStatus}
                      monthly={monthlyAmount}
                      fmtMoney={fmtMoney}
                    />
                  </>
                )}

                <div className="ep-section-label" style={{ marginTop: 14 }}>
                  Earnings &amp; Deductions
                  {duesLoading && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none' }}>· loading dues…</span>}
                </div>
                <div className="ep-fnf">
                  <FnfRow label="Salary for the Exit Month (earned up to the last working day)"
                          value={fnfLines.basic}       onChange={v => setFnfLines(s => ({ ...s, basic: v }))}
                          /* Show the payroll BREAKDOWN, not just a day count —
                             this figure is now produced by the payroll engine
                             (structure components, attendance-driven paid days,
                             LOP, overtime), so the hint has to explain how it
                             was reached or the number looks arbitrary. */
                          hint={(() => {
                            const p = fnfDues?.payroll;
                            if (!p) return 'Payroll skipped this employee for the exit month — their earned salary belongs here.';
                            const b = p.breakdown;
                            if (!b) return `${p.earned_days} of ${p.month_days} days in ${p.cycle} — payroll skipped this employee for that cycle.`;
                            const parts: string[] = [
                              `${b.paid_days} paid of ${b.working_days} working days in ${p.cycle}`,
                            ];
                            if (b.lop_days > 0)       parts.push(`LOP ${b.lop_days}d (−${fmtMoney(b.lop_amount)})`);
                            if (b.overtime_hours > 0) parts.push(`overtime ${b.overtime_hours}h (${fmtMoney(b.overtime_amount)})`);
                            const comps = (b.earnings || [])
                              .map((x: any) => `${x.label} ${fmtMoney(x.amount)}`)
                              .join(' · ');
                            if (comps) parts.push(comps);
                            parts.push(`gross ${fmtMoney(b.gross_earnings)} − deductions ${fmtMoney(b.total_deductions)}`);
                            return `${parts.join(' · ')}. Computed on the payroll basis — this employee was skipped in that cycle's run.`;
                          })()} />
                  <FnfRow label="Leave Encashment"             value={fnfLines.leaveEncash} onChange={v => setFnfLines(s => ({ ...s, leaveEncash: v }))} />
                  <FnfRow label="Bonus / Incentives"           value={fnfLines.bonus}       onChange={v => setFnfLines(s => ({ ...s, bonus: v }))} />

                  {/* Pulled from the Expense module — approved claims never
                      disbursed. Read-only here: the claim is the source. */}
                  <FnfRow label={`Reimbursements Payable${fnfDues?.claims?.items?.length ? ` (${fnfDues.claims.items.length} claim${fnfDues.claims.items.length === 1 ? '' : 's'})` : ''}`}
                          value={String(duesClaims)} readOnly
                          hint={fnfDues?.claims?.items?.length
                            ? fnfDues.claims.items.map((c: any) => `${c.reference || c.title}: ${fmtMoney(c.due)}`).join(' · ')
                            : 'No approved expense claims are awaiting payment.'} />

                  {/* Pulled from the Advance module — approved advances the
                      recovery schedule hasn't finished collecting. */}
                  <FnfRow label={`Advance Recovery${fnfDues?.advances?.items?.length ? ` (${fnfDues.advances.items.length} advance${fnfDues.advances.items.length === 1 ? '' : 's'})` : ''}`}
                          value={String(duesAdvances)} readOnly deduction
                          hint={fnfDues?.advances?.items?.length
                            ? fnfDues.advances.items.map((a: any) => {
                                const st = a.complete === false
                                  ? (a.settle_state === 'not_settled' ? 'NOT SETTLED'
                                    : a.settle_state === 'return_pending' ? 'return pending approval'
                                    : a.settle_state === 'reimburse_pending' ? 'reimbursement not raised'
                                    : 'incomplete')
                                  : (Number(a.outstanding) > 0 ? `${fmtMoney(a.outstanding)} outstanding` : 'settled');
                                return `${a.reference || a.type}: ${st}`;
                              }).join(' · ')
                            : 'No advances are outstanding.'} />
                  {/* Company advances that aren't fully reconciled block the F&F —
                      surface them so HR knows exactly what to close first. */}
                  {!advancesAllComplete && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#a4661c', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, margin: '6px 0 2px' }}>
                      <i className="ri-error-warning-line" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} />
                      <span>{advancesIncomplete.length} company advance{advancesIncomplete.length === 1 ? '' : 's'} not fully settled ({advancesIncomplete.map(a => a.reference || a.type).filter(Boolean).join(', ')}). Settle, return the balance (each payment approved), or raise the reimbursement before the F&F can be paid.</span>
                    </div>
                  )}

                  {settlement === 'pay_in_lieu' && (
                    <FnfRow label={`Salary in Lieu of Notice (${settle.unserved} days)`} value={String(settle.amount)} readOnly
                            hint="Computed from the notice period above — not editable here." />
                  )}
                  {settlement === 'recover' && (
                    <FnfRow label={`Notice Period Shortfall (${settle.unserved} days)`}
                            value={noticeAdjustedInFnf ? String(settle.amount) : '0'} readOnly deduction
                            hint={noticeAdjustedInFnf
                              ? 'Recovered here — HR recorded the payment mode as "Adjusted against F&F dues".'
                              : effSettleStatus === 'Settled'
                                ? 'Already collected in cash at the Notice Period Payment stage — not deducted again.'
                                : 'Not yet recovered. Settle it at the Notice Period Payment stage, or record the mode there as "Adjusted against F&F dues" to deduct it here.'} />
                  )}

                  <FnfRow label="Other Recovery"               value={fnfLines.loan}        onChange={v => setFnfLines(s => ({ ...s, loan: v }))} deduction
                          hint="Anything not pulled automatically — loans, asset damage, notice shortfall settled elsewhere." />
                  <div className="ep-fnf-net">
                    <span>Net FnF Payable</span>
                    <span>{fmtMoney(fnfNet)}</span>
                  </div>
                </div>

                <div className="ep-section-label" style={{ marginTop: 14 }}>Finance Approval &amp; Payment</div>
                {/* Every field here is required to settle the F&F (#61):
                    markFnfPaid() refuses without Finance Controller Approval =
                    Approved and a Payment Date, the stage's own completion
                    measure counts Payment Status = Paid, and Payment Mode is
                    part of the payment record it writes. They carry the * now;
                    Approval and Payment Date are additionally marked invalid
                    while empty, since those are the two that hard-block the
                    "Mark F&F Paid" button. */}
                <div className="ep-approval-card ep-details-card mb-2">
                  <Row className="g-2">
                    <Col md={6}>
                      <EpField label="Finance Controller Approval" required invalid={fnfMeta.approval !== 'Approved'}>
                        <EpSelect value={fnfMeta.approval} onChange={v => setFnfMeta(s => ({ ...s, approval: v }))}
                          options={['Pending', 'Approved', 'Rejected']} />
                      </EpField>
                    </Col>
                    <Col md={6}>
                      <EpField label="Payment Status" required>
                        <EpSelect value={fnfMeta.payStatus} onChange={v => setFnfMeta(s => ({ ...s, payStatus: v }))}
                          options={['Pending', 'Processing', 'Paid']} />
                      </EpField>
                    </Col>
                    <Col md={6}>
                      <EpField label="Payment Mode" required>
                        <EpSelect value={fnfMeta.payMode} onChange={v => setFnfMeta(s => ({ ...s, payMode: v }))}
                          options={['Bank Transfer (NEFT)', 'Bank Transfer (RTGS)', 'IMPS', 'UPI', 'Cheque']} />
                      </EpField>
                    </Col>
                    <Col md={6}>
                      <EpField label="Payment Date" required invalid={!fnfMeta.payDate}>
                        <EpInput type="date" value={fnfMeta.payDate} onChange={v => setFnfMeta(s => ({ ...s, payDate: v }))} />
                      </EpField>
                    </Col>
                  </Row>

                  {/* Mandatory document — the settlement can't be marked paid
                      without it. */}
                  <div className="ep-section-label" style={{ marginTop: 14 }}>
                    Full &amp; Final Document <span style={{ color: '#b91c1c' }}>*</span>
                  </div>
                  <label className={`ep-fnf-drop${fnfDoc ? ' has-file' : ''}`}>
                    <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                      disabled={fnfDocUploading}
                      onChange={e => uploadFnfDoc((e.target as HTMLInputElement).files?.[0] ?? null)} />
                    <span className="ep-fnf-drop-ico">
                      <i className={fnfDocUploading ? 'ri-loader-4-line ri-spin' : fnfDoc ? fnfFileIcon(fnfDoc.name) : 'ri-upload-cloud-2-line'} />
                    </span>
                    <span className="ep-fnf-drop-txt">
                      <span className="ep-fnf-drop-t1">
                        {fnfDocUploading ? 'Uploading…' : fnfDoc ? fnfDoc.name : 'Click to upload the signed F&F sheet / payment advice'}
                      </span>
                      <span className="ep-fnf-drop-t2">
                        {fnfDoc ? 'Click again to replace' : 'PDF, image, Word or Excel · up to 10 MB · required'}
                      </span>
                    </span>
                    {/* Download, not View (#59). The label said "View" but an
                        F&F attachment can be PDF, image, Word or Excel — the
                        browser only ever renders the first two inline and
                        downloads the rest, so the button could not honour its
                        own name. It is a download now, stated by an icon:
                        `download` makes the behaviour explicit instead of
                        leaving it to the file type, and the attachment's own
                        name is used rather than the storage hash. */}
                    {fnfDoc?.url && (
                      <a className="ep-fnf-drop-view" href={fnfDoc.url}
                         download={fnfDoc.name || true}
                         title={`Download ${fnfDoc.name || 'document'}`}
                         aria-label={`Download ${fnfDoc.name || 'document'}`}
                         onClick={e => e.stopPropagation()}>
                        <i className="ri-download-2-line" style={{ fontSize: 15 }} />
                      </a>
                    )}
                  </label>

                  <div className="ep-settle-actions">
                    <button type="button" className="ep-btn ep-btn--complete"
                      disabled={settleSaving}
                      onClick={markFnfPaid}>
                      <i className="ri-wallet-3-line" />
                      {settlement === 'pay_in_lieu' && settle.amount > 0
                        ? 'Mark F&F Paid & Notice Settled'
                        : 'Mark F&F Paid'}
                    </button>
                  </div>
                  {settlement === 'pay_in_lieu' && settle.amount <= 0 && (
                    <div className="ep-settle-note is-ok">
                      <i className="ri-check-double-line" />
                      <span>No notice-period amount is payable — only the F&amp;F dues remain.</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {currentKey === 'clearance' && (
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

                {/* All 5 clearances must be Approved before the stage can
                    complete, so the section carries the mandatory * — the same
                    marker EpField renders — instead of a warning note appearing
                    underneath once the rule is broken (#55). */}
                <div className="ep-section-label">
                  Clearance Status
                  <span aria-hidden="true" style={{ color: '#dc2626', marginLeft: 3, fontWeight: 700 }}>*</span>
                </div>
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

                <div className="ep-section-label">Handover Notes</div>
                {/* `required`: these notes are counted by rawStagePct('clearance')
                    — they are one of the items the stage's completion is measured
                    against, so Clearance & Handover can never reach 100% without
                    them. The field behaved as mandatory but carried no * to say
                    so (#55). */}
                <EpField label="Work Handover Notes" required>
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

            {currentKey === 'documents' && (() => {
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

                  {/* Release gate — nothing on this stage can be opened or sent
                      until HR confirms the employee is cleared to receive their
                      paperwork. A sent document can't be un-sent, so the switch
                      defaults to OFF. */}
                  <div className={`ep-release${docsReleased ? ' is-on' : ''}${fnfPaid ? '' : ' is-blocked'}`}>
                    <span className="ep-release-ico">
                      <i className={docsReleased ? 'ri-lock-unlock-line' : 'ri-lock-line'} />
                    </span>
                    <div className="ep-release-text">
                      <div className="ep-release-title">Do you want to release this employee's documents?</div>
                      <div className="ep-release-sub">
                        {!fnfPaid
                          ? 'Blocked — the Full & Final settlement has not been paid yet. Documents are released only after the employee has been paid.'
                          : docsReleased
                            ? 'Released — the exit documents below can be viewed and sent for signature.'
                            : 'Not released — viewing and sending are disabled until you switch this on.'}
                      </div>
                    </div>
                    <label className={`ep-switch${fnfPaid ? '' : ' is-off'}`}
                           title={fnfPaid ? 'Release exit documents' : fnfBlockHint}>
                      <input
                        type="checkbox"
                        checked={docsReleased}
                        disabled={!fnfPaid}
                        onChange={e => {
                          // Belt and braces — the input is disabled, but a
                          // programmatic change must not slip past the rule.
                          if (!fnfPaid) return;
                          setDocsReleased(e.target.checked);
                        }}
                      />
                      <span className="ep-switch-track"><span className="ep-switch-thumb" /></span>
                      <span className="ep-switch-label">{docsReleased ? 'Yes' : 'No'}</span>
                    </label>
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
                              <Tooltip label={docsReleased ? "Preview with this employee's data" : releaseHint} position="bottom" themed>
                                <button type="button" className="ep-doc-btn ep-doc-btn--ghost"
                                  disabled={!docsReleased}
                                  style={!docsReleased ? OFF_STYLE : undefined}
                                  onClick={() => handleView(tpl)}>
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
                                <Tooltip label={docsReleased ? 'Preview the document (fills custom fields if any) then send for signing' : releaseHint} position="bottom" themed>
                                  <button
                                    type="button"
                                    className="ep-doc-btn"
                                    disabled={!docsReleased}
                                    onClick={() => setGenTpl(tpl)}
                                    style={docsReleased
                                      ? { background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', border: 0 }
                                      : { background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', border: 0, ...OFF_STYLE }}
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

            {currentKey === 'closure' && (
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

                  {/* Asked on every exit type — a clean resignation can still
                      warrant a re-hire bar. */}
                  {blacklistApplies && (
                    <>
                      <Col md={6}>
                        <EpField label="Blacklist Employee">
                          <EpSelect value={blacklisted} onChange={setBlacklisted} options={['No', 'Yes']} />
                          <div className="ep-hint" style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 4 }}>
                            Blocks re-hire — a blacklisted employee cannot be brought back,
                            whatever the exit type.
                          </div>
                        </EpField>
                      </Col>
                      {blacklisted === 'Yes' && (
                        <Col md={6}>
                          <EpField label="Blacklist Reason" required invalid={!blacklistReason.trim()}>
                            <EpInput
                              value={blacklistReason}
                              onChange={setBlacklistReason}
                              placeholder="Why this employee is being blacklisted"
                              maxLength={500}
                              invalid={!blacklistReason.trim()}
                            />
                            {!blacklistReason.trim() && (
                              <div className="ep-err" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <i className="ri-error-warning-line" />A reason is required to blacklist.
                              </div>
                            )}
                          </EpField>
                        </Col>
                      )}
                    </>
                  )}
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
            Stage {stage} of {stageCount} — {current.title}
          </div>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={(currentKey === 'initiation' && stage1Saving) || draftSaving}
              onClick={() => { if (currentKey === 'initiation') saveStage1(); else persistDraft(); }}
            >
              <i className={(currentKey === 'initiation' ? stage1Saving : draftSaving) ? 'ri-loader-line' : 'ri-save-3-line'} />
              {(currentKey === 'initiation' ? stage1Saving : draftSaving) ? 'Saving…' : 'Save Draft'}
            </button>
            <div className="flex-grow-1" />
            {stage > 1 && (
              <button type="button" className="ep-btn ep-btn--prev" onClick={goBack}><i className="ri-arrow-left-s-line" />Previous</button>
            )}
            {isLastStage ? (
              <button
                type="button"
                className="ep-btn ep-btn--complete"
                /* Greyed whenever ANY blocker remains (see exitPending) — but
                   only HARD-disabled while a completion is in flight, so a
                   click still fires completeExit() to toast the exact reason
                   instead of silently doing nothing. */
                disabled={completing}
                aria-disabled={exitPending.length > 0}
                onClick={completeExit}
                title={exitPending.length > 0
                  ? `${exitPending.length} item(s) pending: ${exitPending.join('; ')}`
                  : 'Finalize and close this exit case'}
                style={exitPending.length > 0 ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                <i className={completing ? 'ri-loader-4-line ri-spin' : 'ri-check-double-line'} />
                {completing ? 'Completing…' : 'Complete Exit'}
              </button>
            ) : (() => {
              const busy = currentKey === 'initiation' ? stage1Saving : (advancingStage || draftSaving);
              return (
                <button
                  type="button"
                  className="ep-btn ep-btn--next"
                  disabled={busy}
                  onClick={async () => {
                    if (currentKey === 'initiation') {
                      const ok = await saveStage1();
                      if (!ok) return;
                      markStageCompleted('initiation');
                      advance();
                      return;
                    }
                    setAdvancingStage(true);
                    const ok = await persistDraft({ silent: true });
                    setAdvancingStage(false);
                    if (!ok) return;
                    markStageCompleted(currentKey);
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

/**
 * Rehire an exited employee.
 *
 * Two ways back, and the difference matters: reactivating restores the record
 * exactly as it was, while re-onboarding drops them below the "fully
 * onboarded" gate so the wizard reopens and HR can correct bank details,
 * address, documents — anything that has moved on since they left. Until that
 * is finished again they stay out of payroll, the manager picker and Exit
 * Management, which is the point.
 */
function RehireModal({ employee, onClose, onDone }: {
  employee: EmployeeRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [restart, setRestart] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (employee) { setRestart(false); setNote(''); } }, [employee?.id]);

  const submit = async () => {
    if (!employee || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/employees/${employee.id}/rehire`, {
        restart_onboarding: restart,
        note: note.trim() || null,
      });
      toast.success('Employee rehired', data?.message
        || 'Employee reactivated and now shows in the active employee list.');
      onDone();
    } catch (err: any) {
      toast.error('Could not rehire', err?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!employee} toggle={() => { if (!busy) onClose(); }} centered size="lg"
           backdrop="static" contentClassName="border-0 ep-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="ep-head">
          <div className="ep-head-top">
            <span className="ep-head-avatar" style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>
              <i className="ri-user-follow-line" />
            </span>
            <div className="ep-head-text">
              <div className="ep-head-title-row"><div className="ep-head-title">Rehire Employee</div></div>
              <div className="ep-head-sub">
                {employee?.name} · {employee?.empId} — activate this employee again
              </div>
            </div>
            <button type="button" className="ep-close" onClick={onClose} disabled={busy} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        <div style={{ padding: 18, background: 'var(--vz-secondary-bg)' }}>
          <div className="ep-section-label" style={{ marginBottom: 10 }}>How should they come back?</div>
          <div className="etp-grid">
            <button type="button" disabled={busy}
              className={`etp-card${!restart ? ' is-on' : ''}`}
              style={{ ['--etp-accent' as any]: '#0d9488' }}
              onClick={() => setRestart(false)}>
              <span className="etp-ico"><i className="ri-user-follow-line" /></span>
              <span className="etp-body">
                <span className="etp-title">Reactivate only</span>
                <span className="etp-desc">
                  Switch the login back on and return them to the active employee list with their
                  record exactly as it was. Nothing to re-enter.
                </span>
              </span>
            </button>

            <button type="button" disabled={busy}
              className={`etp-card${restart ? ' is-on' : ''}`}
              style={{ ['--etp-accent' as any]: '#7c3aed' }}
              onClick={() => setRestart(true)}>
              <span className="etp-ico"><i className="ri-refresh-line" /></span>
              <span className="etp-body">
                <span className="etp-title">Reactivate and re-onboard</span>
                <span className="etp-desc">
                  Same, but reopens onboarding so their details can be updated — bank account,
                  address, documents. They stay out of payroll and the manager picker until it's complete.
                </span>
              </span>
            </button>
          </div>

          <div className="mt-3">
            <label className="ep-label" style={{ fontSize: 11.5, fontWeight: 700 }}>Note (optional)</label>
            <input className="ep-input" value={note} maxLength={500} disabled={busy}
              onChange={e => setNote(e.target.value)}
              placeholder="Why this employee is being rehired" />
          </div>

          <div className="etp-foot">
            <div className="etp-note">
              <i className="ri-information-line" />
              The original exit stays on record — what they resigned for, when they left and what was
              settled — it just stops counting them as exited.
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="etp-cancel" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="ep-btn ep-btn--complete" onClick={submit} disabled={busy}>
                <i className={busy ? 'ri-loader-4-line ri-spin' : 'ri-check-line'} />
                {busy ? 'Rehiring…' : 'Rehire Employee'}
              </button>
            </div>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

/**
 * Exit-type picker. This is the FIRST thing "Initiate Exit" opens — the exit
 * wizard isn't mounted until a type has been chosen, because the type decides
 * the stage list (a settlement stage is inserted for two of the three types).
 * Showing the wizard first and then covering it with this popup told the user
 * the process had already started, which it hadn't.
 *
 * The same component is reused from Stage 1's "Change" button, where a type is
 * already set — that's the only case with a close button, since the initiation
 * flow has nothing to go back to.
 */
function ExitTypePickerModal({ open, employee, current, onClose, onPick, busy }: {
  open: boolean;
  employee: EmployeeRow | null;
  current: string;
  onClose: () => void;
  onPick: (value: string) => void;
  busy?: boolean;
}) {
  /* Two-step: pick a tile, then Continue. Committing on the first click made
     an irreversible choice (the type is locked for the life of the case) a
     single mis-click away. */
  const [selected, setSelected] = useState(current || '');
  useEffect(() => { if (open) setSelected(current || ''); }, [open, current]);

  return (
    <Modal isOpen={open && !!employee} toggle={() => { if (!busy) onClose(); }}
           centered size="lg" backdrop="static" contentClassName="border-0 ep-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="ep-head">
          <div className="ep-head-top">
            <span className="ep-head-avatar" style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}>
              <i className="ri-logout-box-r-line" />
            </span>
            <div className="ep-head-text">
              <div className="ep-head-title-row">
                <div className="ep-head-title">{current ? 'Change Exit Type' : 'Initiate Exit'}</div>
              </div>
              <div className="ep-head-sub">
                {employee?.name} · {employee?.empId} — choose the exit type to start the process
              </div>
            </div>
            {/* Always closable. Backing out of a first-time initiation is safe
                — nothing is written until a type is picked — so the only time
                it's blocked is while that write is in flight. */}
            <button type="button" className="ep-close" onClick={onClose} disabled={busy} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div style={{ padding: 18, background: 'var(--vz-secondary-bg)' }}>
          {/* --tiles: three square boxes side by side. The Rehire picker reuses
              .etp-grid without this modifier and stays as stacked rows. */}
          <div className="etp-grid etp-grid--tiles">
            {EXIT_TYPE_CHOICES.map(c => (
              <button
                key={c.value}
                type="button"
                disabled={busy}
                aria-pressed={selected === c.value}
                className={`etp-card${selected === c.value ? ' is-on' : ''}`}
                style={{ ['--etp-accent' as any]: c.accent }}
                onClick={() => setSelected(c.value)}
              >
                <span className="etp-ico"><i className={c.icon} /></span>
                <span className="etp-body">
                  <span className="etp-title">{c.label}</span>
                  <span className="etp-desc">{c.desc}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="etp-foot">
            {/* Note sits on the SAME row as the actions, filling the space to
                their left. */}
            <div className="etp-note">
              <i className="ri-alert-line" />
              <span>
                The type sets how the notice period is settled and which stages the exit runs through.
                <strong> It cannot be changed once the exit has started</strong> — pick carefully.
              </span>
            </div>
            <div className="etp-actions">
              <button type="button" className="etp-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="etp-continue"
                disabled={busy || !selected}
                title={selected ? 'Start the exit with this type' : 'Select an exit type first'}
                onClick={() => selected && onPick(selected)}
              >
                {busy ? <><i className="ri-loader-4-line ri-spin" />Starting…</> : <>Continue<i className="ri-arrow-right-line" /></>}
              </button>
            </div>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

/* Read-only recap of the notice-period settlement, shared by both settlement
   stages. Everything except the salary basis is derived from Stage 1, so this
   is a summary with two inputs rather than a form. */
function SettlementSummary({
  settle, settlement, status, monthly, fmtMoney,
}: {
  settle: { required: number; served: number; unserved: number; perDay: number; amount: number };
  settlement: Settlement;
  status: string;
  monthly: string;
  fmtMoney: (n: number) => string;
}) {
  const tone = status === 'Settled' ? 'is-ok' : status === 'Rejected' ? 'is-no' : status === 'NA' ? 'is-na' : 'is-due';
  return (
    <div className={`ep-settle ${tone}`}>
      <div className="ep-settle-band">
        <div>
          <div className="ep-settle-lbl">
            {settlement === 'recover' ? 'Recoverable from employee' : 'Payable to employee'}
          </div>
          <div className="ep-settle-amt">{fmtMoney(settle.amount)}</div>
          <div className="ep-settle-sub">
            {settle.unserved} unserved day{settle.unserved === 1 ? '' : 's'} × {fmtMoney(settle.perDay)}/day
          </div>
        </div>
        <span className="ep-settle-chip">
          {status === 'NA' ? 'Not applicable'
            : status === 'Settled' ? 'Settled'
            : status === 'Rejected' ? 'Rejected'
            : settlement === 'recover' ? 'Pending verification' : 'Pending payment'}
        </span>
      </div>
      <div className="ep-settle-grid">
        <div><span>Notice days {settlement === 'pay_in_lieu' ? 'payable' : 'required'}</span><strong>{settle.required}</strong></div>
        <div><span>Days served</span><strong>{settle.served}</strong></div>
        <div><span>{settlement === 'pay_in_lieu' ? 'Days to pay' : 'Days unserved'}</span><strong>{settle.unserved}</strong></div>
        {/* Fixed, not a choice: the notice recovery is always priced on monthly
            BASIC ÷ 30, so offering "gross" only invited an inconsistent figure. */}
        <div><span>Salary basis</span><strong>Monthly Basic</strong></div>
        <div>
          {/* Read-only: derived from the employee's package (annual ÷ 12 × 50%),
              so an editable box here only let the recovery be priced off a
              figure that doesn't match payroll. */}
          <span>Monthly basic</span><strong>{fmtMoney(Number(monthly) || 0)}</strong>
        </div>
        <div><span>Per-day rate</span><strong>{fmtMoney(settle.perDay)}</strong></div>
      </div>
    </div>
  );
}

/* One line of the Full & Final breakdown. */
function FnfRow({ label, value, onChange, deduction, readOnly, hint }: {
  label: string; value: string; onChange?: (v: string) => void;
  deduction?: boolean; readOnly?: boolean; hint?: string;
}) {
  return (
    <div className={`ep-fnf-row${deduction ? ' is-ded' : ''}`}>
      <span className="ep-fnf-label">
        {label}
        {hint && <em className="ep-fnf-hint">{hint}</em>}
      </span>
      <span className="ep-fnf-amt">
        {deduction && <i className="ep-fnf-sign">−</i>}
        <input
          className="ep-fnf-in" type="number" min={0} value={value}
          readOnly={readOnly} disabled={readOnly}
          onChange={e => onChange?.(e.target.value)} placeholder="0.00"
        />
      </span>
    </div>
  );
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
      // Resolved once here so both View and Download below get an absolute URL.
      category: cat.category, status, url: d.url ? resolveFileUrl(d.url) : null,
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
  /* A rehired exit is spent history — the person is active staff again, so the
     old case must not keep them in the Exited tab. The row is deliberately
     kept (what they resigned for, when they left, what was settled), just
     ignored for status. */
  const rawExit   = e?.exit ?? null;
  const ex        = rawExit?.rehired_at ? null : rawExit;
  const noticeRaw = ex?.notice_date ? String(ex.notice_date).slice(0, 10) : '';
  const caseClosed   = (ex?.exit_case_status === 'Closed') || !!ex?.completed_at;
  /* Inactive is grouped with Resigned/Terminated as a non-active status
     (completing an exit flips employees.status to one of these and kills the
     login — see ExitController::complete). Such staff must NOT appear in the
     Active Employees list; they belong in the Exited bucket (bug #34).

     DISABLED IS NOT EXITED. `trashed` used to be lumped in here, which sent
     anyone switched off in HR > Employees straight to the Exited tab even
     though no exit ever happened — nobody resigned, no notice was served, no
     F&F was settled. Being disabled is now carried separately (`disabled`
     below) and decides nothing about the exit status:

       · disabled, no exit case      → dropped from this page entirely; they
                                       show in Employees > Disabled only.
       · disabled, exit in progress  → stays in Exit In Progress, and is also
                                       in the Disabled list — both, by design.
       · disabled, exit completed    → Exited, as any completed exit is.

     The drop for the first case happens in loadEmployees(), which is the only
     place that can remove a row rather than re-label it. */
  const statusExited = ['Resigned', 'Terminated', 'Inactive'].includes(rawStatus);
  const statusNotice = rawStatus === 'Notice Period';
  const exitInitiated = !!ex && (
    !!ex.exit_type || !!ex.last_working_day || !!ex.notice_date || Number(ex.current_stage) >= 1
  );

  let status: ExitStatus;
  // NOTE: "Exited" here means a completed/closed exit case OR a terminal
  // employees.status (Resigned / Terminated / Inactive). An Inactive employee
  // has been deactivated (login disabled) so they're no longer active staff —
  // they show in the Exited tab, never the Active Employees list.
  if      (caseClosed || statusExited)                              status = 'Exited';
  else if (exitInitiated || statusNotice)                           status = 'Exit In Progress';
  else if (!e.email || !e.department_id || !e.designation_id)        status = 'Missing Details';
  else                                                              status = 'Active';

  const currentStage = Math.max(1, Math.min(6, Number(ex?.current_stage) || 1));
  const exitReadiness = status === 'Exited' ? 100
    : status === 'Exit In Progress' ? Math.min(90, Math.round((currentStage / 5) * 100))
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
    disabled: trashed,
    exitInitiated,
    exitType: String(ex?.exit_type ?? ''),
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
    // Monthly gross, derived from the annual package when the list carries it.
    // Only a PREFILL for the notice-period settlement — HR confirms/overrides
    // the figure there, so a payload without salary just means an empty field
    // rather than a broken stage.
    /* Monthly BASIC — what the notice-period settlement is priced on. Mirrors
       PayrollService::resolveCompensation()'s fallback split (basic = 50% of
       monthly gross) so the exit and payroll agree on the same figure. */
    monthlySalary: (() => {
      const a = Number(e.annual_salary);
      return Number.isFinite(a) && a > 0 ? Math.round((a / 12) * 0.5 * 100) / 100 : null;
    })(),
    probationEndIso: e.probation_end_date ? String(e.probation_end_date).slice(0, 10) : null,
    dateOfJoiningIso: e.date_of_joining ? String(e.date_of_joining).slice(0, 10) : null,
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
