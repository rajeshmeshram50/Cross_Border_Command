import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import Tooltip from '../../components/ui/Tooltip';

/* ──────────────────────────────────────────────────────────────────────────
 * Assigned Holiday Calendar — surfaces the holidays from the employee's
 * assigned Holiday Group inside the Employee Profile. Live-fetched per year
 * from /employees/{id}/holidays (recurring-aware on the server), so any change
 * to the assigned calendar reflects automatically on the next open / year flip.
 * Offers both a List view and a month Calendar view.
 * ────────────────────────────────────────────────────────────────────────── */

type Holiday = {
  id: number;
  code?: string | null;
  name: string;
  date: string;            // YYYY-MM-DD (already shifted to the requested year)
  type: string;            // Public | Restricted | Company | Regional | Optional
  is_recurring?: boolean;
  description?: string | null;
};
type Resp = { group: { id: number; name: string | null } | null; year: number; holidays: Holiday[] };

// Translucent fills so the badges read on BOTH light and dark surfaces
// (a solid light chip would look out of place on the dark profile card).
const TYPE_COLORS: Record<string, { bg: string; fg: string; bd: string }> = {
  Public:     { bg: 'rgba(99,102,241,.14)',  fg: '#6366f1', bd: 'rgba(99,102,241,.32)' },
  Restricted: { bg: 'rgba(245,158,11,.16)',  fg: '#d97706', bd: 'rgba(245,158,11,.34)' },
  Company:    { bg: 'rgba(16,185,129,.16)',  fg: '#10b981', bd: 'rgba(16,185,129,.34)' },
  Regional:   { bg: 'rgba(14,165,233,.16)',  fg: '#0ea5e9', bd: 'rgba(14,165,233,.34)' },
  Optional:   { bg: 'rgba(139,92,246,.16)',  fg: '#8b5cf6', bd: 'rgba(139,92,246,.34)' },
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? { bg: 'rgba(100,116,139,.16)', fg: '#64748b', bd: 'rgba(100,116,139,.32)' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  // Dashed date to match the admin Holiday list (e.g. "Tue, 16-Jun-2026").
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${wd}, ${dd}-${mon}-${d.getFullYear()}`;
};

export default function HolidayCalendarPanel({ employeeId }: { employeeId: string }) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState<number>(now.getMonth()); // 0-11
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<Resp>(`/employees/${encodeURIComponent(employeeId)}/holidays`, { params: { year } })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId, year]);

  const holidays = data?.holidays ?? [];
  const groupName = data?.group?.name ?? null;
  const hasGroup = !!data?.group;

  // date(YYYY-MM-DD) → holiday(s) on that day, for calendar lookups.
  const byDate = useMemo(() => {
    const m = new Map<string, Holiday[]>();
    holidays.forEach(h => {
      if (!m.has(h.date)) m.set(h.date, []);
      m.get(h.date)!.push(h);
    });
    return m;
  }, [holidays]);

  // ── Calendar grid for the selected month ──────────────────────────────────
  const firstDow = new Date(year, calMonth, 1).getDay();
  const daysInMonth = new Date(year, calMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const isoFor = (d: number) => `${year}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const monthHolidays = holidays.filter(h => Number(h.date.slice(5, 7)) === calMonth + 1);

  /* List columns for the shared DataTable. Sr No comes from `serial`, and
     paging / sorting / the footer are the component's own — the calendar
     view stays hand-rolled because it's a month grid, not a list. */
  const holidayColumns: DataTableColumn<Holiday>[] = useMemo(() => [
    /* Name and description are two COLUMNS, not two lines of one.
       Stacked, the description sat under the name in a 46%-wide cell and both
       fought for the same space — the name clipped early while half the row's
       width stood empty to the right, and neither could be scanned down the
       page. Split, each gets its own width and its own header, and the eye can
       run down one of them at a time.

       One line each, ellipsis, full text on hover: clipping (rather than
       wrapping) is what keeps every row the same height whatever is pasted in,
       and nothing is lost because `title` carries the whole string. */
    {
      header: 'Holiday Name',
      accessorKey: 'name',
      meta: { width: '30%', wrap: true },
      cell: info => {
        const h = info.row.original;
        return (
          <div className="hcp-name-row">
            {/* The app's own Tooltip, the same one the Holiday module's action
                column uses — a native `title` is the browser's, so it looked
                different here from every other hover on the page and took a
                second to appear. */}
            <Tooltip label={h.name}>
              <span className="hcp-name">{h.name}</span>
            </Tooltip>
          </div>
        );
      },
    },
    {
      header: 'Description',
      accessorKey: 'description',
      meta: { width: '28%', wrap: true },
      cell: info => {
        const d = String(info.getValue() ?? '').trim();
        // An em dash, not an empty cell — a blank reads as a rendering fault,
        // and "no description" is a real answer.
        return d
          ? <Tooltip label={d}><span className="hcp-desc">{d}</span></Tooltip>
          : <span className="hcp-desc hcp-desc--empty">—</span>;
      },
    },
    {
      header: 'Date',
      accessorKey: 'date',
      meta: { width: '22%' },
      cell: info => <span style={{ fontWeight: 600 }}>{fmtDate(String(info.getValue() ?? ''))}</span>,
    },
    {
      header: 'Type',
      accessorKey: 'type',
      meta: { width: '16%' },
      cell: info => {
        const t = String(info.getValue() ?? '');
        const c = typeColor(t);
        return <span className="hcp-badge" style={{ background: c.bg, color: c.fg, borderColor: c.bd }}><span className="dot" />{t}</span>;
      },
    },
  ], []);

  const css = `
    .hcp-wrap { padding: 2px; }
    .hcp-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .hcp-grp { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
    .hcp-grp-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: linear-gradient(135deg,#7c3aed,#8b5cf6); color: #fff; font-weight: 700; font-size: 12px; box-shadow: 0 2px 8px rgba(124,58,237,.3); }
    .hcp-controls { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hcp-year { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 9px; padding: 3px; }
    .hcp-year button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: #f1f5f9; color: #334155; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .hcp-year button:hover { background: #e2e8f0; }
    .hcp-year span { min-width: 52px; text-align: center; font-weight: 800; font-size: 14px; color: #0f172a; }
    .hcp-toggle { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
    .hcp-toggle button { border: 0; background: transparent; padding: 6px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .hcp-toggle button.on { background: #fff; color: #4338ca; box-shadow: 0 1px 4px rgba(15,23,42,.12); }
    .hcp-count { font-size: 12px; color: #64748b; font-weight: 600; }

    /* The list is the shared DataTable now — header band, row styling, Sr No
       and the footer pager all come from it, so this file only styles what
       goes INSIDE the cells. A pasted, space-less name must break rather than
       stretch the row past the Date / Type columns. */
    /* min-width:0 lets the name shrink far enough for its own ellipsis —
       a flex item defaults to its content's min-content width and would push
       the RECURRING pill out of the column instead of clipping. */
    .hcp-name-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .hcp-name { font-weight: 700; color: #0f172a; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hcp-desc { display: block; font-size: 12px; color: #64748b; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hcp-desc--empty { color: #cbd5e1; }
    .hcp-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid; }
    .hcp-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    .hcp-empty { text-align: center; padding: 48px 20px; color: #94a3b8; }
    .hcp-empty i { font-size: 40px; display: block; margin-bottom: 10px; color: #cbd5e1; }
    .hcp-empty .t { font-weight: 700; color: #475569; font-size: 14px; }

    .hcp-cal-layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
    @media (max-width: 820px) { .hcp-cal-layout { grid-template-columns: 1fr; } }
    .hcp-cal { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #fff; }
    .hcp-cal-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: linear-gradient(135deg,#7c3aed,#8b5cf6); color: #fff; }
    .hcp-cal-head .m { font-weight: 800; font-size: 14px; }
    .hcp-cal-head button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: rgba(255,255,255,.2); color: #fff; cursor: pointer; }
    .hcp-cal-head button:disabled { opacity: .4; cursor: default; }
    .hcp-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); }
    .hcp-cal-grid .wd { text-align: center; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .hcp-cell { min-height: 56px; border-right: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; padding: 5px 6px; position: relative; }
    .hcp-cell:nth-child(7n) { border-right: 0; }
    .hcp-cell .d { font-size: 11.5px; font-weight: 700; color: #475569; }
    .hcp-cell.hol { background: #f5f3ff; }
    .hcp-cell.hol .d { color: #6d28d9; }
    .hcp-cell .hn { margin-top: 3px; font-size: 9.5px; line-height: 1.2; font-weight: 700; color: #5b21b6; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .hcp-cell.empty { background: #fafbfc; }

    .hcp-side { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; overflow: hidden; }
    .hcp-side-h { padding: 10px 14px; font-size: 12px; font-weight: 800; color: #0f172a; border-bottom: 1px solid #f1f5f9; background: #f8fafc; }
    .hcp-side-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #f8fafc; }
    .hcp-side-date { flex-shrink: 0; text-align: center; width: 38px; }
    .hcp-side-date .dd { font-size: 16px; font-weight: 800; color: #6d28d9; line-height: 1; }
    .hcp-side-date .wd { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
    .hcp-side-empty { padding: 24px 14px; text-align: center; color: #94a3b8; font-size: 12.5px; }

    .hcp-skel { height: 14px; border-radius: 6px; background: linear-gradient(90deg,#eef2f7 25%,#f6f8fb 37%,#eef2f7 63%); background-size: 400% 100%; animation: hcpsh 1.2s ease infinite; }
    @keyframes hcpsh { 0%{background-position:100% 50%} 100%{background-position:0 50%} }
    /* ── Dark mode ──────────────────────────────────────────────────────── */
    [data-bs-theme="dark"] .hcp-grp { color: #cbd5e1; }
    [data-bs-theme="dark"] .hcp-count { color: #94a3b8; }
    [data-bs-theme="dark"] .hcp-year { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
    [data-bs-theme="dark"] .hcp-year button { background: rgba(255,255,255,.08); color: #e2e8f0; }
    [data-bs-theme="dark"] .hcp-year button:hover { background: rgba(255,255,255,.16); }
    [data-bs-theme="dark"] .hcp-year span { color: #f1f5f9; }
    [data-bs-theme="dark"] .hcp-toggle { background: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-toggle button { color: #9b8fc4; }
    /* Selected tab = vivid purple pill + glow so it's clearly the active one in
       dark mode (the old card-bg fill blended with the inactive button). */
    [data-bs-theme="dark"] .hcp-toggle button.on { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.5); }

    /* Table chrome in dark mode is DataTable's own; only cell content here. */
    [data-bs-theme="dark"] .hcp-name { color: #f1f5f9; }
    /* The description is its own column now, so it carries its own dark
       colour rather than inheriting the muted grey it had as a subtitle. */
    [data-bs-theme="dark"] .hcp-desc { color: #9aa6b2; }
    [data-bs-theme="dark"] .hcp-desc--empty { color: #4b5563; }

    [data-bs-theme="dark"] .hcp-empty { color: #64748b; }
    [data-bs-theme="dark"] .hcp-empty .t { color: #cbd5e1; }
    [data-bs-theme="dark"] .hcp-empty i { color: #475569; }

    [data-bs-theme="dark"] .hcp-cal, [data-bs-theme="dark"] .hcp-side { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
    [data-bs-theme="dark"] .hcp-cal-grid .wd { color: #64748b; border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-cell { border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-cell .d { color: #94a3b8; }
    [data-bs-theme="dark"] .hcp-cell.empty { background: rgba(255,255,255,.02); }
    [data-bs-theme="dark"] .hcp-cell.hol { background: rgba(139,92,246,.15); }
    [data-bs-theme="dark"] .hcp-cell.hol .d, [data-bs-theme="dark"] .hcp-cell .hn { color: #c4b5fd; }
    [data-bs-theme="dark"] .hcp-side-h { background: rgba(255,255,255,.04); color: #f1f5f9; border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-side-item { border-color: rgba(255,255,255,.05); }
    [data-bs-theme="dark"] .hcp-side-date .dd { color: #c4b5fd; }
    [data-bs-theme="dark"] .hcp-side-empty { color: #64748b; }
    [data-bs-theme="dark"] .hcp-skel { background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.09) 37%, rgba(255,255,255,.04) 63%); background-size: 400% 100%; }
  `;

  return (
    <div className="hcp-wrap">
      <style>{css}</style>

      <div className="hcp-toolbar">
        <div className="hcp-grp">
          <i className="ri-calendar-event-line" style={{ fontSize: 17, color: '#7c3aed' }} />
          {hasGroup ? (
            <>
              <span>Assigned calendar:</span>
              <span className="hcp-grp-pill"><i className="ri-bookmark-line" />{groupName || 'Holiday Group'}</span>
            </>
          ) : (
            <span style={{ fontWeight: 600 }}>No holiday calendar assigned</span>
          )}
        </div>

        <div className="hcp-controls">
          {!loading && hasGroup && <span className="hcp-count">{holidays.length} holiday{holidays.length === 1 ? '' : 's'} in {year}</span>}
          <div className="hcp-year">
            <button type="button" onClick={() => setYear(y => y - 1)} aria-label="Previous year"><i className="ri-arrow-left-s-line" /></button>
            <span>{year}</span>
            <button type="button" onClick={() => setYear(y => y + 1)} aria-label="Next year"><i className="ri-arrow-right-s-line" /></button>
          </div>
          <div className="hcp-toggle">
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><i className="ri-list-unordered" /> List</button>
            <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}><i className="ri-calendar-2-line" /> Calendar</button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="hcp-skel" style={{ height: 40 }} />)}
        </div>
      )}

      {/* No group / no holidays */}
      {!loading && !hasGroup && (
        <div className="hcp-empty">
          <i className="ri-calendar-close-line" />
          <div className="t">No Holiday Calendar assigned</div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>Assign a Holiday Group to this employee to see their holidays here.</div>
        </div>
      )}
      {!loading && hasGroup && holidays.length === 0 && (
        <div className="hcp-empty">
          <i className="ri-calendar-line" />
          <div className="t">No holidays in {year}</div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>The assigned calendar has no holidays for this year. Try another year.</div>
        </div>
      )}

      {/* List view — the shared DataTable used across the HRMS modules, so the
          header band, Sr No column, sortable headers and the
          "Showing X–Y of Z / Rows per page" footer all match Attendance,
          Leave History and the rest instead of being hand-rolled here. */}
      {!loading && hasGroup && holidays.length > 0 && view === 'list' && (
        <DataTable
          data={holidays}
          columns={holidayColumns}
          serial
          accent="violet"
          pageSize={10}
          minWidth={720}
          /* No search box: one year's holiday calendar is a short, complete
             list the employee reads top to bottom, and the year stepper above
             already scopes it. Sorting on Holiday Name / Date covers the rest. */
          searchable={false}
          emptyMessage={`No holidays in ${year}`}
        />
      )}

      {/* Calendar view */}
      {!loading && hasGroup && holidays.length > 0 && view === 'calendar' && (
        <div className="hcp-cal-layout">
          <div className="hcp-cal">
            <div className="hcp-cal-head">
              <button type="button" onClick={() => setCalMonth(m => Math.max(0, m - 1))} disabled={calMonth === 0}><i className="ri-arrow-left-s-line" /></button>
              <span className="m">{MONTHS[calMonth]} {year}</span>
              <button type="button" onClick={() => setCalMonth(m => Math.min(11, m + 1))} disabled={calMonth === 11}><i className="ri-arrow-right-s-line" /></button>
            </div>
            <div className="hcp-cal-grid">
              {WEEK.map(w => <div key={w} className="wd">{w}</div>)}
              {cells.map((d, i) => {
                if (d === null) return <div key={i} className="hcp-cell empty" />;
                const iso = isoFor(d);
                const hs = byDate.get(iso);
                return (
                  <div key={i} className={`hcp-cell${hs ? ' hol' : ''}`} title={hs ? hs.map(h => `${h.name} (${h.type})`).join(', ') : undefined}>
                    <div className="d">{d}</div>
                    {hs && <div className="hn">{hs.map(h => h.name).join(', ')}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="hcp-side">
            <div className="hcp-side-h">{MONTHS[calMonth]} holidays</div>
            {monthHolidays.length === 0 ? (
              <div className="hcp-side-empty">No holidays this month.</div>
            ) : monthHolidays.map(h => {
              const c = typeColor(h.type);
              const d = new Date(h.date + 'T00:00:00');
              return (
                <div key={`${h.id}-${h.date}`} className="hcp-side-item">
                  <div className="hcp-side-date">
                    <div className="dd">{String(d.getDate()).padStart(2, '0')}</div>
                    <div className="wd">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="hcp-name" style={{ fontSize: 13 }}>{h.name}</div>
                    <span className="hcp-badge" style={{ marginTop: 4, background: c.bg, color: c.fg, borderColor: c.bd }}><span className="dot" />{h.type}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
