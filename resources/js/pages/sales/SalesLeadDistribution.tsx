import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Distribution
 *
 * Faithful port of the prototype's `#leadDistributionPage` (line 9872) —
 * amber/orange-palette dashboard showing 4 stat tiles + a salesperson lead-
 * count table. Mock data based on the prototype's `ASSIGNED_LEADS_DATA`.
 *
 * Perm-gated on `sales.lead_distribution`.
 * ──────────────────────────────────────────────────────────────────────── */

type SalesPerson = {
  id: number;
  name: string;
  department: string;
  designation: string;
  primaryRole: string;
  ancillaryRole: string;
  manager: string;
  totalLeads: number;
};

const SEED: SalesPerson[] = [
  { id:1,  name:'Shreeyash Rajaram Mote', department:'Sales',     designation:'Senior Sales Executive', primaryRole:'Sales',     ancillaryRole:'Customer Success', manager:'Rahul Verma',     totalLeads:52 },
  { id:2,  name:'Durgesh Urkude',         department:'Sales',     designation:'Sales Manager',          primaryRole:'Sales',     ancillaryRole:'—',                manager:'Director',        totalLeads:18 },
  { id:3,  name:'Bhavika',                department:'Sales',     designation:'Sales Executive',        primaryRole:'Sales',     ancillaryRole:'Field Visits',     manager:'Rahul Verma',     totalLeads:14 },
  { id:4,  name:'Rahul Sharma',           department:'Sales',     designation:'BDR',                    primaryRole:'Sales',     ancillaryRole:'Demo',             manager:'Shreeyash Mote',  totalLeads:11 },
  { id:5,  name:'Priya Mehta',            department:'Inside Sales', designation:'Inside Sales Rep',    primaryRole:'Sales',     ancillaryRole:'Cold Calling',     manager:'Shreeyash Mote',  totalLeads:8  },
  { id:6,  name:'Vikram Desai',           department:'Sales',     designation:'Sales Executive',        primaryRole:'Sales',     ancillaryRole:'—',                manager:'Rahul Verma',     totalLeads:6  },
  { id:7,  name:'Ankit Verma',            department:'Sales',     designation:'Sales Executive',        primaryRole:'Sales',     ancillaryRole:'Documentation',    manager:'Shreeyash Mote',  totalLeads:3  },
  { id:8,  name:'Sneha Patil',            department:'Inside Sales', designation:'Account Executive',   primaryRole:'Sales',     ancillaryRole:'—',                manager:'Priya Mehta',     totalLeads:2  },
  { id:9,  name:'Karthik R',              department:'Sales',     designation:'Sales Trainee',          primaryRole:'Sales',     ancillaryRole:'Learning',         manager:'Durgesh Urkude',  totalLeads:1  },
  { id:10, name:'Aisha Khan',             department:'Sales',     designation:'Sales Trainee',          primaryRole:'Sales',     ancillaryRole:'Learning',         manager:'Durgesh Urkude',  totalLeads:0  },
];

const ROWS_OPTIONS = [10, 25, 50];
const TOTAL_LEADS  = 115;

export default function SalesLeadDistribution() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.lead_distribution'];
  const canView = isSuperAdmin || perm?.can_view !== false;

  const [team]       = useState<SalesPerson[]>(SEED);
  const [q, setQ]    = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp]   = useState(10);

  useEffect(() => {
    const id = 'sm-ldd-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const totalAssigned   = team.reduce((s, p) => s + p.totalLeads, 0);
  const totalUnassigned = Math.max(0, TOTAL_LEADS - totalAssigned);
  const topPerformer    = team.reduce((a, b) => (b.totalLeads > a.totalLeads ? b : a), team[0]);

  const filtered = useMemo(() => {
    if (!q) return team;
    const lo = q.toLowerCase();
    return team.filter(p =>
      p.name.toLowerCase().includes(lo) ||
      p.department.toLowerCase().includes(lo) ||
      p.designation.toLowerCase().includes(lo) ||
      p.manager.toLowerCase().includes(lo)
    );
  }, [team, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  if (!canView) {
    return (
      <div className="ldd-root">
        <style>{SCOPED_CSS}</style>
        <div className="ldd-no-access">
          <div className="ldd-no-access-title">No access</div>
          <div className="ldd-no-access-sub">You don't have permission to view Lead Distribution.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ldd-root">
      <style>{SCOPED_CSS}</style>

      {/* Header */}
      <div className="ldd-header">
        <div className="ldd-header-left">
          <div className="ldd-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <div className="ldd-header-title">Lead Distribution</div>
            <div className="ldd-header-sub">Track and manage leads assigned to your sales team</div>
          </div>
        </div>
        <div className="ldd-header-right">
          <div className="ldd-chip ldd-chip-amber"><span className="ldd-chip-dot" />{team.length} Sales Members</div>
          <div className="ldd-chip ldd-chip-orange"><span className="ldd-chip-dot ldd-chip-dot-orange" />{TOTAL_LEADS} Total Leads</div>
          <button className="ldd-back-btn" onClick={() => navigate('/sales/lead-worksheet')}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            Back to My Workplace
          </button>
        </div>
      </div>

      {/* Stat Tiles */}
      <div className="ldd-stats">
        <div className="ldd-stat ldd-stat-amber">
          <div className="ldd-stat-head">
            <span className="ldd-stat-label">Total Sales Persons</span>
            <div className="ldd-stat-icon ldd-stat-icon-amber">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
            </div>
          </div>
          <div className="ldd-stat-value">{team.length}</div>
          <div className="ldd-stat-foot ldd-stat-foot-amber">Active members</div>
        </div>
        <div className="ldd-stat ldd-stat-orange">
          <div className="ldd-stat-head">
            <span className="ldd-stat-label">Total Leads</span>
            <div className="ldd-stat-icon ldd-stat-icon-amber">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
          </div>
          <div className="ldd-stat-value">{TOTAL_LEADS}</div>
          <div className="ldd-stat-foot ldd-stat-foot-orange">All leads</div>
        </div>
        <div className="ldd-stat ldd-stat-green">
          <div className="ldd-stat-head">
            <span className="ldd-stat-label">Assigned Leads</span>
            <div className="ldd-stat-icon ldd-stat-icon-green">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
          </div>
          <div className="ldd-stat-value">{totalAssigned}</div>
          <div className="ldd-stat-foot ldd-stat-foot-green">Salesperson assigned</div>
        </div>
        <div className="ldd-stat ldd-stat-rose">
          <div className="ldd-stat-head">
            <span className="ldd-stat-label">Unassigned</span>
            <div className="ldd-stat-icon ldd-stat-icon-rose">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
          </div>
          <div className="ldd-stat-value">{totalUnassigned}</div>
          <div className="ldd-stat-foot ldd-stat-foot-rose">Needs assignment</div>
        </div>
      </div>

      <div className="ldd-search-row">
        <div className="ldd-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.3"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input
            type="text"
            placeholder="Search by salesperson, department, manager…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <div className="ldd-top-pill">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          Top performer: <strong>{topPerformer.name}</strong> · {topPerformer.totalLeads} leads
        </div>
      </div>

      {/* Table card */}
      <div className="ldd-table-card">
        <div className="ldd-table-wrap">
          <table className="ldd-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sr No</th>
                <th>Sales Person</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Primary Role</th>
                <th>Ancillary Role</th>
                <th>Reporting Manager</th>
                <th style={{ width: 110, textAlign: 'center' }}>Total Leads</th>
                <th style={{ width: 120, textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="ldd-empty">No salespeople found</td></tr>
              )}
              {rows.map((p, i) => (
                <tr key={p.id}>
                  <td>{startIdx + i + 1}</td>
                  <td>
                    <div className="ldd-person">
                      <div className="ldd-avatar">{p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                      <div><strong>{p.name}</strong></div>
                    </div>
                  </td>
                  <td>{p.department}</td>
                  <td>{p.designation}</td>
                  <td><span className="ldd-pill ldd-pill-role">{p.primaryRole}</span></td>
                  <td>{p.ancillaryRole}</td>
                  <td>{p.manager}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`ldd-leads-badge ${p.totalLeads === 0 ? 'zero' : p.totalLeads > 20 ? 'hot' : ''}`}>{p.totalLeads}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <Tooltip label="View Leads">
                      <button className="ldd-view-btn" onClick={() => toast.info('Coming next', `View ${p.totalLeads} leads for ${p.name}`)}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        View
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ldd-pagination">
          <span className="ldd-pag-info">
            {total === 0 ? 'Showing 0 of 0' : <>Showing <strong>{startIdx + 1}–{Math.min(startIdx + rpp, total)}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="ldd-pag-right">
            <div className="ldd-rows-sel">
              Rows:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {ROWS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="ldd-pag-range">{safePage} / {pages}</span>
            <div className="ldd-pag-btns">
              <button className="ldd-pg-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button className="ldd-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.ldd-root {
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
  background: #fffbeb;
  padding: 14px 22px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  display: flex; flex-direction: column; gap: 10px;
  color: #111827; font-size: 13.5px;
}
.ldd-root *, .ldd-root *::before, .ldd-root *::after { box-sizing: border-box; }
.ldd-no-access { background: #fff; border: 1.5px solid #fde68a; border-radius: 14px; padding: 28px; text-align: center; }
.ldd-no-access-title { font-size: 16px; font-weight: 800; color: #b45309; }
.ldd-no-access-sub   { font-size: 12px; color: #64748b; margin-top: 8px; }

.ldd-header {
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1px solid #fde68a; border-radius: 10px;
  padding: 10px 16px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-shrink: 0;
}
.ldd-header-left { display: flex; align-items: center; gap: 12px; }
.ldd-header-icon {
  width: 36px; height: 36px; border-radius: 8px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(245,158,11,.35);
}
.ldd-header-title { font-size: 14px; font-weight: 800; color: #451a03; letter-spacing: -.3px; }
.ldd-header-sub   { font-size: 10.5px; color: #b45309; margin-top: 1px; font-weight: 500; }
.ldd-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ldd-chip { display: inline-flex; align-items: center; gap: 5px; background: #fff; border-radius: 20px; padding: 5px 13px; font-size: 11.5px; font-weight: 700; }
.ldd-chip-amber  { border: 1.5px solid #f59e0b; color: #92400e; }
.ldd-chip-orange { border: 1.5px solid #d97706; color: #78350f; }
.ldd-chip-dot { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; }
.ldd-chip-dot-orange { background: #d97706; }
.ldd-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 15px; border: none;
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  border-radius: 8px; font-family: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; transition: all .18s;
  box-shadow: 0 3px 10px rgba(245,158,11,.35);
}
.ldd-back-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(245,158,11,.45); }

.ldd-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.ldd-stat {
  background: #fff; border-radius: 10px;
  padding: 10px 14px; border-left: 3px solid;
  box-shadow: 0 1px 4px rgba(245,158,11,.08);
}
.ldd-stat-amber  { border: 1.5px solid #fde68a; border-left-color: #f59e0b; }
.ldd-stat-orange { border: 1.5px solid #fde68a; border-left-color: #d97706; }
.ldd-stat-green  { border: 1.5px solid #a7f3d0; border-left-color: #10b981; box-shadow: 0 1px 4px rgba(16,185,129,.08); }
.ldd-stat-rose   { border: 1.5px solid #fecdd3; border-left-color: #f43f5e; box-shadow: 0 1px 4px rgba(244,63,94,.08); }
.ldd-stat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.ldd-stat-label { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .1em; }
.ldd-stat-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.ldd-stat-icon-amber { background: #fff7ed; border: 1px solid #fed7aa; }
.ldd-stat-icon-green { background: #ecfdf5; border: 1px solid #a7f3d0; }
.ldd-stat-icon-rose  { background: #fff1f2; border: 1px solid #fecdd3; }
.ldd-stat-value { font-size: 22px; font-weight: 900; color: #451a03; letter-spacing: -1px; line-height: 1; }
.ldd-stat-foot { font-size: 9.5px; font-weight: 600; margin-top: 3px; }
.ldd-stat-foot-amber  { color: #b45309; }
.ldd-stat-foot-orange { color: #d97706; }
.ldd-stat-foot-green  { color: #059669; }
.ldd-stat-foot-rose   { color: #e11d48; }

.ldd-search-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ldd-search-wrap {
  position: relative; width: 380px; max-width: 100%;
}
.ldd-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.ldd-search-wrap input {
  width: 100%; height: 38px; padding: 0 14px 0 34px;
  border: 1.5px solid #fde68a; border-radius: 20px;
  background: #fff; color: #78350f;
  font-family: inherit; font-size: 12px; font-weight: 500;
  outline: none; transition: all .15s;
}
.ldd-search-wrap input:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(245,158,11,.12); }
.ldd-top-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1.5px solid #fde68a; border-radius: 20px;
  font-size: 11.5px; color: #78350f;
}

.ldd-table-card {
  background: #fff; border: 1px solid #fde68a;
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 2px 8px rgba(245,158,11,.1);
  display: flex; flex-direction: column;
}
.ldd-table-wrap { overflow-x: auto; }
.ldd-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 900px; }
.ldd-table thead tr {
  background: linear-gradient(90deg, #78350f 0%, #92400e 30%, #b45309 65%, #d97706 100%);
}
.ldd-table thead th {
  color: rgba(255,255,255,.85); font-size: 8.5px; font-weight: 700;
  padding: 10px 8px; letter-spacing: .1em; text-transform: uppercase;
  text-align: left; white-space: nowrap;
}
.ldd-table thead th:first-child { padding-left: 16px; }
.ldd-table tbody tr { border-bottom: 1px solid #fef3c7; }
.ldd-table tbody tr:hover { background: #fffbeb; }
.ldd-table tbody td { padding: 8px 10px; color: #1e293b; vertical-align: middle; }
.ldd-table tbody td:first-child { padding-left: 16px; }
.ldd-empty { text-align: center !important; padding: 36px !important; color: #94a3b8; font-style: italic; }

.ldd-person { display: flex; align-items: center; gap: 8px; }
.ldd-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ldd-pill {
  display: inline-flex; padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
}
.ldd-pill-role { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.ldd-leads-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px; padding: 4px 12px;
  border-radius: 20px;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  color: #78350f; border: 1.5px solid #fde68a;
  font-size: 11px; font-weight: 800;
}
.ldd-leads-badge.zero { background: #f8fafc; color: #94a3b8; border-color: #e2e8f0; }
.ldd-leads-badge.hot { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border-color: #d97706; box-shadow: 0 2px 6px rgba(245,158,11,.4); }

.ldd-view-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border: 1.5px solid #fde68a; border-radius: 6px;
  background: #fff; color: #b45309;
  font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.ldd-view-btn:hover { background: #fef3c7; border-color: #d97706; }

.ldd-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; border-top: 1px solid #fef3c7;
  background: #fffbeb;
  flex-wrap: wrap; gap: 6px;
}
.ldd-pag-info { font-size: 11px; font-weight: 600; color: #92400e; background: #fff; border: 1.5px solid #fde68a; padding: 4px 12px; border-radius: 20px; }
.ldd-pag-right { display: flex; align-items: center; gap: 6px; }
.ldd-rows-sel { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #92400e; background: #fff; border: 1.5px solid #fde68a; padding: 3px 11px; border-radius: 20px; }
.ldd-rows-sel select { border: none; background: transparent; font-family: inherit; font-size: 11px; color: #78350f; font-weight: 700; cursor: pointer; outline: none; }
.ldd-pag-range { font-size: 11px; font-weight: 700; color: #78350f; background: linear-gradient(135deg, #fef9c3, #fef3c7); border: 1.5px solid #fde68a; padding: 4px 14px; border-radius: 20px; }
.ldd-pag-btns { display: flex; gap: 4px; }
.ldd-pg-btn { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid #fde68a; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #d97706; transition: all .18s; }
.ldd-pg-btn:hover:not(:disabled) { background: #d97706; color: #fff; }
.ldd-pg-btn:disabled { opacity: .4; cursor: not-allowed; }
`;
