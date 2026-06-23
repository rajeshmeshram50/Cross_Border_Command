import { useEffect, useMemo, useState } from 'react';
import api from '../../api';

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
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
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

  const css = `
    .hcp-wrap { padding: 2px; }
    .hcp-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .hcp-grp { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
    .hcp-grp-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: linear-gradient(135deg,#ec4899,#f472b6); color: #fff; font-weight: 700; font-size: 12px; box-shadow: 0 2px 8px rgba(236,72,153,.3); }
    .hcp-controls { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hcp-year { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 9px; padding: 3px; }
    .hcp-year button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: #f1f5f9; color: #334155; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .hcp-year button:hover { background: #e2e8f0; }
    .hcp-year span { min-width: 52px; text-align: center; font-weight: 800; font-size: 14px; color: #0f172a; }
    .hcp-toggle { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
    .hcp-toggle button { border: 0; background: transparent; padding: 6px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .hcp-toggle button.on { background: #fff; color: #4338ca; box-shadow: 0 1px 4px rgba(15,23,42,.12); }
    .hcp-count { font-size: 12px; color: #64748b; font-weight: 600; }

    .hcp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .hcp-table thead th { text-align: left; padding: 10px 12px; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #64748b; font-weight: 700; border-bottom: 1.5px solid #e2e8f0; background: #f8fafc; }
    .hcp-table tbody td { padding: 11px 12px; border-bottom: 1px solid #f1f5f9; color: #1f2937; vertical-align: middle; }
    .hcp-table tbody tr:hover { background: #fcfdff; }
    .hcp-sr { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; }
    .hcp-name { font-weight: 700; color: #0f172a; }
    .hcp-recur { margin-left: 7px; font-size: 9.5px; font-weight: 800; color: #7c3aed; background: #f3e8ff; border: 1px solid #e9d5ff; border-radius: 999px; padding: 1px 7px; vertical-align: middle; }
    .hcp-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid; }
    .hcp-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    .hcp-empty { text-align: center; padding: 48px 20px; color: #94a3b8; }
    .hcp-empty i { font-size: 40px; display: block; margin-bottom: 10px; color: #cbd5e1; }
    .hcp-empty .t { font-weight: 700; color: #475569; font-size: 14px; }

    .hcp-cal-layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
    @media (max-width: 820px) { .hcp-cal-layout { grid-template-columns: 1fr; } }
    .hcp-cal { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #fff; }
    .hcp-cal-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: linear-gradient(135deg,#ec4899,#f472b6); color: #fff; }
    .hcp-cal-head .m { font-weight: 800; font-size: 14px; }
    .hcp-cal-head button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: rgba(255,255,255,.2); color: #fff; cursor: pointer; }
    .hcp-cal-head button:disabled { opacity: .4; cursor: default; }
    .hcp-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); }
    .hcp-cal-grid .wd { text-align: center; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .hcp-cell { min-height: 56px; border-right: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; padding: 5px 6px; position: relative; }
    .hcp-cell:nth-child(7n) { border-right: 0; }
    .hcp-cell .d { font-size: 11.5px; font-weight: 700; color: #475569; }
    .hcp-cell.hol { background: #fdf2f8; }
    .hcp-cell.hol .d { color: #be185d; }
    .hcp-cell .hn { margin-top: 3px; font-size: 9.5px; line-height: 1.2; font-weight: 700; color: #9d174d; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .hcp-cell.empty { background: #fafbfc; }

    .hcp-side { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; overflow: hidden; }
    .hcp-side-h { padding: 10px 14px; font-size: 12px; font-weight: 800; color: #0f172a; border-bottom: 1px solid #f1f5f9; background: #f8fafc; }
    .hcp-side-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #f8fafc; }
    .hcp-side-date { flex-shrink: 0; text-align: center; width: 38px; }
    .hcp-side-date .dd { font-size: 16px; font-weight: 800; color: #be185d; line-height: 1; }
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
    [data-bs-theme="dark"] .hcp-toggle button { color: #94a3b8; }
    [data-bs-theme="dark"] .hcp-toggle button.on { background: var(--vz-card-bg); color: #c4b5fd; }

    [data-bs-theme="dark"] .hcp-table thead th { background: rgba(255,255,255,.04); color: #cbd5e1; border-color: rgba(255,255,255,.1); }
    [data-bs-theme="dark"] .hcp-table tbody td { color: #e2e8f0; border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-table tbody tr:hover { background: rgba(255,255,255,.03); }
    [data-bs-theme="dark"] .hcp-sr { background: rgba(255,255,255,.08); color: #cbd5e1; }
    [data-bs-theme="dark"] .hcp-name { color: #f1f5f9; }
    [data-bs-theme="dark"] .hcp-recur { background: rgba(139,92,246,.2); color: #c4b5fd; border-color: rgba(139,92,246,.4); }

    [data-bs-theme="dark"] .hcp-empty { color: #64748b; }
    [data-bs-theme="dark"] .hcp-empty .t { color: #cbd5e1; }
    [data-bs-theme="dark"] .hcp-empty i { color: #475569; }

    [data-bs-theme="dark"] .hcp-cal, [data-bs-theme="dark"] .hcp-side { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
    [data-bs-theme="dark"] .hcp-cal-grid .wd { color: #64748b; border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-cell { border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-cell .d { color: #94a3b8; }
    [data-bs-theme="dark"] .hcp-cell.empty { background: rgba(255,255,255,.02); }
    [data-bs-theme="dark"] .hcp-cell.hol { background: rgba(236,72,153,.15); }
    [data-bs-theme="dark"] .hcp-cell.hol .d, [data-bs-theme="dark"] .hcp-cell .hn { color: #f9a8d4; }
    [data-bs-theme="dark"] .hcp-side-h { background: rgba(255,255,255,.04); color: #f1f5f9; border-color: rgba(255,255,255,.06); }
    [data-bs-theme="dark"] .hcp-side-item { border-color: rgba(255,255,255,.05); }
    [data-bs-theme="dark"] .hcp-side-date .dd { color: #f9a8d4; }
    [data-bs-theme="dark"] .hcp-side-empty { color: #64748b; }
    [data-bs-theme="dark"] .hcp-skel { background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.09) 37%, rgba(255,255,255,.04) 63%); background-size: 400% 100%; }
  `;

  return (
    <div className="hcp-wrap">
      <style>{css}</style>

      <div className="hcp-toolbar">
        <div className="hcp-grp">
          <i className="ri-calendar-event-line" style={{ fontSize: 17, color: '#ec4899' }} />
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

      {/* List view */}
      {!loading && hasGroup && holidays.length > 0 && view === 'list' && (
        <div style={{ border: '1px solid var(--vz-border-color, #e2e8f0)', borderRadius: 12, overflow: 'hidden' }}>
          <table className="hcp-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>#</th>
                <th>Holiday Name</th>
                <th style={{ width: 220 }}>Date</th>
                <th style={{ width: 150 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h, i) => {
                const c = typeColor(h.type);
                return (
                  <tr key={`${h.id}-${h.date}`}>
                    <td><span className="hcp-sr">{i + 1}</span></td>
                    <td>
                      <span className="hcp-name">{h.name}</span>
                      {h.is_recurring && <span className="hcp-recur">RECURRING</span>}
                      {h.description && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{h.description}</div>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{fmtDate(h.date)}</td>
                    <td><span className="hcp-badge" style={{ background: c.bg, color: c.fg, borderColor: c.bd }}><span className="dot" />{h.type}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
