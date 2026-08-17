import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect, MasterFormStyles } from '../../master/masterFormKit';
import DataTable, { type DataTableColumn } from '../../../components/ui/DataTable';

/**
 * Reporting Manager Dependency — closure-stage blocker.
 *
 * Completing an exit flips the employee's status and disables their login. If
 * anyone still reports to them, every reader that walks the org chart (My Team,
 * leave and expense approval chains, the permission subordinate check) would
 * dead-end at a switched-off row. So the reports are moved to someone else
 * first, and Complete Exit stays blocked until none are left.
 *
 * Built on the shared DataTable + MasterSelect rather than a raw table and
 * <select>: the manager pool is every active employee in the client, which is
 * long enough to need MasterSelect's in-menu search, and DataTable gives the
 * same header/serial/empty-state treatment as every other list in the app.
 *
 * Lives in its own file rather than inside HrExitManagement.tsx, which is
 * already ~4,700 lines.
 */

type Person = {
  id: number;
  name: string;
  emp_code: string | null;
  department: string | null;
  designation: string | null;
  /** Lower = more senior. Null for a designation outside the seeded hierarchy. */
  rank: number | null;
  /** Their own exit is already open — still Active, but not a safe manager. */
  exiting?: boolean;
  /** 'user' = a tenant login user (Branch User / admin), not an employee row.
   *  The two id spaces overlap, so this decides which column the server writes. */
  kind?: 'user';
};

/** A completed move, held for the confirmation table under the form. */
type SavedRow = {
  id: number;
  name: string;
  emp_code: string | null;
  department: string | null;
  designation: string | null;
  managerName: string;
  managerCode: string | null;
};

/**
 * Mirrors PositionHierarchy::eligible(). A manager must sit STRICTLY higher.
 * When either rank is unknown we stay lenient and allow it — the same call the
 * server makes, so the dropdown never hides an option the API would accept
 * (nor offers one it would reject).
 */
function eligibleManager(reportRank: number | null, managerRank: number | null): boolean {
  if (reportRank == null || managerRank == null) return true;
  return managerRank < reportRank;
}

export default function ReportingManagerDependencyModal({
  open, employeeId, employeeName, onClose, onResolved, inline = false,
}: {
  open: boolean;
  employeeId: number | null;
  employeeName: string;
  onClose: () => void;
  /** Fired once no active reports remain, so the wizard can re-check its gate. */
  onResolved: () => void;
  /** Render the working area only — no modal chrome — for embedding in the
   *  closure stage's Final Actions. */
  inline?: boolean;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [reports, setReports] = useState<Person[]>([]);
  const [managers, setManagers] = useState<Person[]>([]);
  /* Branch Users / admins. Kept separate because they are USER ids, not
     employee ids, and only offered when the employee hierarchy dead-ends. */
  const [loginUsers, setLoginUsers] = useState<Person[]>([]);
  /* What was moved in THIS sitting. Saving takes those people off the
     outstanding list — they no longer report to the exiting employee — so
     without holding onto them the panel would give no sign of what it just
     did. Kept in component state, not on the exit row: it is a confirmation
     of the action, not an audit record, and it is gone on reload by design. */
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  /** reportId → chosen managerId, as a string (MasterSelect is string-valued). */
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [bulk, setBulk] = useState('');

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    api.get(`/employees/${employeeId}/exit/direct-reports`)
      .then(({ data }) => {
        setReports(Array.isArray(data?.reports) ? data.reports : []);
        setManagers(Array.isArray(data?.managers) ? data.managers : []);
        setLoginUsers(Array.isArray(data?.login_users) ? data.login_users : []);
        setPicks({});
        setBulk('');
      })
      .catch(() => toast.error('Could not load direct reports', 'Please try again.'))
      .finally(() => setLoading(false));
  }, [employeeId, toast]);

  // Inline has no open/closed state — it loads as soon as it is mounted.
  useEffect(() => { if (open || inline) load(); }, [open, inline, load]);

  /* One MasterSelect option per manager. Someone with their own exit already
     open is shown DISABLED with the reason rather than dropped from the list —
     silently omitting them turns "why isn't X here?" into a support call, and
     the server rejects the pick anyway. */
  const optionFor = (m: Person) => ({
    /* Prefixed because employee ids and user ids are separate sequences that
       overlap — "5" alone would be ambiguous, and the server writes a different
       column for each. Split back apart in save(). */
    value: `${m.kind === 'user' ? 'user' : 'emp'}:${m.id}`,
    label: m.emp_code ? `${m.name} · ${m.emp_code}` : m.name,
    selectedLabel: m.name,
    badge: m.designation ? { text: m.designation, tone: 'gray' as const } : undefined,
    /* The reason rides ON the row, not just in the tooltip. A greyed name with
       no visible explanation reads as a bug — the first question it got asked
       was "why is this disabled?". */
    badges: m.exiting ? [{ text: 'Exiting', tone: 'red' as const }] : undefined,
    disabled: !!m.exiting,
    disabledReason: m.exiting ? 'This employee has their own exit in progress, so they cannot take on reports.' : undefined,
  });

  /** Pickable = passes seniority AND is not themselves on the way out. */
  const assignable = (r: Person, m: Person) =>
    m.id !== r.id && !m.exiting && eligibleManager(r.rank, m.rank);

  /* Employee candidates for one report. Login users are appended ONLY when no
     employee can take them — a hierarchy dead-end, e.g. a Team Leader whose
     only possible managers (the HODs) are all exiting. Offering Branch Users
     unconditionally would make it too easy to flatten the org chart by
     accident; offering them here is the difference between an exit that can be
     completed and one that is stuck with no route out of the screen. */
  const optionsFor = (r: Person) => {
    const emp = managers.filter(m => m.id !== r.id && eligibleManager(r.rank, m.rank));
    const anyPickable = emp.some(m => !m.exiting);
    return anyPickable ? emp : [...emp, ...loginUsers];
  };

  /* Clicking a greyed option is intercepted rather than ignored — MasterSelect
     keeps the menu open and hands the row back, so the toast lands while the
     option the user just tried is still on screen. */
  const explainDisabled = (opt: { label: string }) => {
    toast.warning(
      'Exit in progress',
      `${opt.label.split(' · ')[0]} has an exit in progress — they cannot be chosen as a reporting manager.`,
    );
  };

  /* A manager offered for EVERY report — the only safe basis for a bulk apply.
     Picking the pool per-report and then applying one of them to all would
     silently skip the reports that manager cannot take, which reads as a
     successful bulk and leaves the case still blocked. */
  const bulkOptions = useMemo(
    () => {
      const emp = managers.filter(m => reports.every(r => assignable(r, m)));
      // Same fallback as a single row: when no employee outranks everyone,
      // a Branch User does (TOP_RANK), so bulk stays usable.
      return (emp.length ? emp : loginUsers).map(optionFor);
    },
    [managers, reports, loginUsers],
  );

  const assigned = reports.filter(r => picks[r.id]).length;
  const pending  = reports.length - assigned;

  const applyBulk = (managerId: string) => {
    setBulk(managerId);
    if (!managerId) return;
    const next: Record<number, string> = {};
    reports.forEach(r => { next[r.id] = managerId; });
    setPicks(next);
  };

  const save = async () => {
    if (!employeeId || saving) return;
    const assignments = reports
      .filter(r => picks[r.id])
      .map(r => {
        const [kind, id] = String(picks[r.id]).split(':');
        return kind === 'user'
          ? { employee_id: r.id, reporting_manager_user_id: Number(id) }
          : { employee_id: r.id, reporting_manager_id: Number(id) };
      });

    if (assignments.length === 0) {
      toast.warning('Nothing to save', 'Choose a new reporting manager first.');
      return;
    }
    /* Snapshot the pairs BEFORE the save — the reload that follows drops these
       people from `reports`, so this is the last moment both halves are known. */
    const moved: SavedRow[] = reports
      .filter(r => picks[r.id])
      .map(r => {
        const m = [...managers, ...loginUsers].find(x => optionFor(x).value === picks[r.id]);
        return {
          id: r.id, name: r.name, emp_code: r.emp_code,
          department: r.department, designation: r.designation,
          managerName: m?.name ?? '—', managerCode: m?.emp_code ?? null,
        };
      });

    setSaving(true);
    try {
      const { data } = await api.post(`/employees/${employeeId}/exit/reassign-reports`, { assignments });
      toast.success('Reporting managers updated', data?.message || '');
      // Replace any earlier entry for the same person, so the table shows
      // where each employee ENDED UP rather than every step along the way.
      setSavedRows(prev => [...prev.filter(p => !moved.some(m => m.id === p.id)), ...moved]);
      const remaining = Number(data?.remaining ?? 0);
      // Always reload so the outstanding table drops whoever was just moved.
      load();
      /* Tell the wizard either way — a partial pass still changes the count in
         its pending list. The inline panel stays mounted so the confirmation
         table below remains visible; the modal closes as before. */
      onResolved();
      if (remaining === 0 && !inline) onClose();
    } catch (err: any) {
      toast.error('Could not reassign', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<Person>[] = useMemo(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      meta: { width: 240, wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div>
            <div style={{ fontWeight: 700 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
              {r.emp_code || '—'}{r.department ? ` · ${r.department}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Designation',
      accessorKey: 'designation',
      meta: { width: 150, align: 'center' },
      cell: info => <span>{(info.getValue() as string) || '—'}</span>,
    },
    {
      id: 'manager',
      header: 'New Reporting Manager',
      enableSorting: false,
      meta: { width: 260 },
      cell: info => {
        const r = info.row.original;
        /* Seniority-ineligible managers are filtered OUT (they are simply not
           valid for this row). Exit-in-progress managers are kept but disabled,
           so HR sees why the obvious candidate can't be used. */
        const options = optionsFor(r).map(optionFor);
        /* Two very different dead ends, and collapsing them into one message
           ("No eligible manager") told HR nothing they could act on:

             nobody senior enough EXISTS   → promote someone, or fix a wrong
                                             designation on this employee
             they exist but are all LEAVING → finish or cancel one of those
                                              exits first

           A Team Leader can only report to an HOD, and when both HODs happen
           to have open exits the second case is what HR is actually looking
           at. */
        if (options.length === 0) {
          return (
            <span style={{ fontSize: 11.5, color: '#b91c1c' }} title={`Nobody outranks ${r.designation || 'this designation'}.`}>
              <i className="ri-error-warning-line" /> No one outranks {r.designation || 'this role'}
            </span>
          );
        }
        if (options.every(o => o.disabled)) {
          const names = options.map(o => o.selectedLabel).join(', ');
          return (
            <span style={{ fontSize: 11.5, color: '#b45309' }} title={`${names} — exit in progress.`}>
              <i className="ri-time-line" /> Only {names} outrank{options.length === 1 ? 's' : ''} them — exit in progress
            </span>
          );
        }
        return (
          <MasterSelect
            value={picks[r.id] ?? ''}
            options={options}
            placeholder="Select…"
            disabled={saving}
            onChange={v => setPicks(p => ({ ...p, [r.id]: v }))}
            onDisabledClick={explainDisabled}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [managers, picks, saving]);

  /** Same shape as above, but the manager column is settled text. */
  const savedColumns: DataTableColumn<SavedRow>[] = useMemo(() => [
    {
      header: 'Employee',
      accessorKey: 'name',
      meta: { width: 240, wrap: true },
      cell: info => {
        const r = info.row.original;
        return (
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
              {r.emp_code || '—'}{r.department ? ` · ${r.department}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      header: 'Designation',
      accessorKey: 'designation',
      meta: { width: 150, align: 'center' },
      cell: info => <span>{(info.getValue() as string) || '—'}</span>,
    },
    {
      id: 'newManager',
      header: 'New Reporting Manager',
      enableSorting: false,
      meta: { width: 260 },
      cell: info => {
        const r = info.row.original;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ri-checkbox-circle-fill" style={{ color: '#0d9488', fontSize: 14 }} />
            <div>
              {/* Lighter than the form above — this is a settled record being
                  read, not a field competing for attention. */}
              <div style={{ fontWeight: 600 }}>{r.managerName}</div>
              {r.managerCode && (
                <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>{r.managerCode}</div>
              )}
            </div>
          </div>
        );
      },
    },
  ], []);

  /* The working area — bulk picker, the affected-employee table, and Save.
     Shared by both presentations so the inline panel and the modal can never
     drift apart. */
  const body = (
    <>
      {/* Bulk — the common case is "everyone moves to the same person". */}
      {reports.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 12px', borderRadius: 10, marginBottom: 12,
          background: 'var(--vz-body-bg)', border: '1px solid var(--vz-border-color)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>Assign all to</span>
          <div style={{ minWidth: 260, flex: '0 1 320px' }}>
            <MasterSelect
              value={bulk}
              options={bulkOptions}
              placeholder={bulkOptions.length ? 'Select a manager…' : 'No manager fits all'}
              disabled={saving || bulkOptions.length === 0}
              onChange={applyBulk}
              onDisabledClick={explainDisabled}
            />
          </div>
          {bulkOptions.length === 0 && !loading && (
            <span style={{ fontSize: 11.5, color: '#b45309' }}>
              <i className="ri-information-line" /> Assign individually.
            </span>
          )}
        </div>
      )}

      {/* Once everyone has been moved this table has nothing to show, and its
          empty state ("No active direct reports…") sat directly above the
          Reassigned list saying the same thing twice. Kept only while there is
          outstanding work — or when there is nothing at all, where the empty
          state is the whole message. */}
      {(reports.length > 0 || savedRows.length === 0) && (
        <DataTable<Person>
          data={reports}
          columns={columns}
          serial={{ header: 'Sr', width: 56 }}
          searchable={false}
          paginate={false}
          disableSorting
          accent="amber"
          minWidth={620}
          loading={loading}
          emptyMessage="No active direct reports — nothing blocks the exit from this side."
        />
      )}

      {/* Confirmation of what was just saved. Same columns as the form above,
          read-only, so the third column reads as the ANSWER rather than an
          input still waiting to be filled. */}
      {savedRows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0d9488', marginBottom: 6 }}>
            <i className="ri-checkbox-circle-line" /> Reassigned ({savedRows.length})
          </div>
          <DataTable<SavedRow>
            data={savedRows}
            columns={savedColumns}
            serial={{ header: 'Sr', width: 56 }}
            searchable={false}
            paginate={false}
            disableSorting
            accent="emerald"
            minWidth={620}
          />
        </div>
      )}

      {/* Footer goes with the form. With nothing left outstanding it was a
          disabled Save button under a note telling HR to save. */}
      {(reports.length > 0 || savedRows.length === 0) && (
      <div className="etp-foot" style={{ marginTop: 14 }}>
        <div className="etp-note">
          <i className="ri-alert-line" />
          <span>
            {pending > 0
              ? <><strong>{pending}</strong> still unassigned — Complete Exit stays blocked.</>
              : <>All assigned — save to apply.</>}
          </span>
        </div>
        <div className="etp-actions">
          {!inline && (
            <button type="button" className="etp-cancel" onClick={onClose} disabled={saving}>Close</button>
          )}
          <button
            type="button"
            className="etp-continue"
            disabled={saving || loading || assigned === 0}
            title={assigned === 0 ? 'Choose at least one new reporting manager' : 'Save the reassignments'}
            onClick={save}
          >
            {saving
              ? <><i className="ri-loader-4-line ri-spin" />Saving…</>
              : <>Save {assigned > 0 ? `(${assigned})` : ''}<i className="ri-arrow-right-line" /></>}
          </button>
        </div>
      </div>
      )}
    </>
  );

  /* INLINE — rendered straight into the closure stage's Final Actions, so the
     affected people and their new manager are visible with the rest of the
     blockers instead of behind a button. HR was having to open a modal to find
     out WHO was blocking the exit. */
  if (inline) {
    return (
      <>
        <MasterFormStyles />
        {body}
      </>
    );
  }

  return (
    <Modal isOpen={open} toggle={() => { if (!saving) onClose(); }} centered size="lg"
           backdrop="static" contentClassName="border-0 ep-modal">
      {/* MasterSelect's styling lives in this sheet. The page renders it too,
          but repeating it here keeps the modal self-contained. */}
      <MasterFormStyles />
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="ep-head">
          <div className="ep-head-top">
            <span className="ep-head-avatar" style={{ background: 'linear-gradient(135deg,#f59e0b,#b45309)' }}>
              <i className="ri-organization-chart" />
            </span>
            <div className="ep-head-text">
              <div className="ep-head-title-row">
                <div className="ep-head-title">Reporting Manager Dependency</div>
              </div>
              <div className="ep-head-sub">
                {reports.length} {reports.length === 1 ? 'employee reports' : 'employees report'} to {employeeName} — assign a new manager to each.
              </div>
            </div>
            <button type="button" className="ep-close" onClick={onClose} disabled={saving} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        <div style={{ padding: 18, background: 'var(--vz-secondary-bg)' }}>
          {body}
        </div>
      </ModalBody>
    </Modal>
  );
}
