import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Enquiries Received
 *
 * Faithful port of prototype `#enquiriesPage` (line 14464). Per-customer
 * enquiry list. Mock data for now.
 * ──────────────────────────────────────────────────────────────────────── */

type Enquiry = {
  id: number;
  type: string;
  date: string;
  source: string;
  assigned: string;
  oppId: string;
  customer: string;
  phone: string;
  email: string;
  product: string;
  company: string;
  country: string;
  status: 'New' | 'In Progress' | 'Closed';
};

const SEED: Enquiry[] = [
  { id:1, type:'Manual',          date:'10/04/2026', source:'Offline',  assigned:'Shreeyash Mote', oppId:'OPP-001', customer:'GreenHarvest', phone:'+91 91234 56789', email:'r.vardhan@gmail.com', product:'—',              company:'GreenHarvest', country:'IN', status:'In Progress' },
  { id:2, type:'PNS Calls',       date:'07/04/2026', source:'Agrotech', assigned:'Bhavika',        oppId:'OPP-003', customer:'Aadi Trading', phone:'+91-9315093788',  email:'N/A',                 product:'1 Kg Jasmine Rice', company:'—',         country:'IN', status:'New' },
  { id:3, type:'Direct Enquiries',date:'06/04/2026', source:'Agrotech', assigned:'Durgesh Urkude', oppId:'OPP-004', customer:'Mujahed Al-Rashid', phone:'+962-786919870', email:'aboodmujahed6@gmail.com', product:'Turkish Dry Fig', company:'—', country:'JO', status:'In Progress' },
  { id:4, type:'Direct Enquiries',date:'05/04/2026', source:'Agrotech', assigned:'Rahul Sharma',   oppId:'OPP-008', customer:'Zhang Wei',    phone:'+86-13812345678', email:'zhangwei@example.com', product:'Basmati Rice',  company:'Wei Imports', country:'CN', status:'Closed' },
  { id:5, type:'Manual',          date:'04/04/2026', source:'Agrotech', assigned:'Priya Mehta',    oppId:'OPP-010', customer:'Ayesha Raza',  phone:'+92-3012345678',  email:'ayesha.raza@pk.com',   product:'Mango Pulp',    company:'Raza Exports', country:'PK', status:'In Progress' },
];

const STATUS_COLORS: Record<Enquiry['status'], { bg: string; fg: string; border: string }> = {
  'New':         { bg: '#dbeafe', fg: '#1d4ed8', border: '#bfdbfe' },
  'In Progress': { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  'Closed':      { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
};

const ROWS_OPTIONS = [10, 25, 50];

export default function SalesEnquiries() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.enquiries'];
  const canView = isSuperAdmin || perm?.can_view !== false;

  const [data] = useState<Enquiry[]>(SEED);
  const [q, setQ] = useState('');
  const [rpp, setRpp] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = 'sm-enq-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = useMemo(() => {
    if (!q) return data;
    const lo = q.toLowerCase();
    return data.filter(e => Object.values(e).some(v => String(v).toLowerCase().includes(lo)));
  }, [data, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  if (!canView) {
    return <div className="enq-root"><style>{SCOPED_CSS}</style><div className="enq-no-access">No access to Enquiries</div></div>;
  }

  return (
    <div className="enq-root">
      <style>{SCOPED_CSS}</style>

      <div className="enq-top">
        <div>
          <h1 className="enq-title">Enquiries Received</h1>
          <div className="enq-meta">
            <span><strong>Customer Name:</strong> {SEED[0].customer}</span>
            <span><strong>Customer ID:</strong> C-001</span>
            <span><strong>Country:</strong> IN</span>
          </div>
        </div>
        <button className="enq-back-btn" onClick={() => navigate('/sales/customers')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          Back To Customer View
        </button>
      </div>

      <div className="enq-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          placeholder="Search enquiries..."
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
        />
      </div>

      <div className="enq-card">
        <div className="enq-table-wrap">
          <table className="enq-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>Sr No</th>
                <th>Lead Type</th>
                <th>Lead Date</th>
                <th>Lead Source</th>
                <th>Assigned To</th>
                <th>Opportunity ID</th>
                <th>Customer Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Product</th>
                <th>Company</th>
                <th>Country</th>
                <th style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} className="enq-empty">No enquiries found</td></tr>
              )}
              {rows.map((e, i) => {
                const col = STATUS_COLORS[e.status];
                return (
                  <tr key={e.id} onClick={() => toast.info('Open lead', e.oppId)}>
                    <td>{startIdx + i + 1}</td>
                    <td>{e.type}</td>
                    <td>{e.date}</td>
                    <td>{e.source}</td>
                    <td>{e.assigned}</td>
                    <td><span className="enq-mono">{e.oppId}</span></td>
                    <td><strong>{e.customer}</strong></td>
                    <td>{e.phone}</td>
                    <td>{e.email}</td>
                    <td>{e.product === '—' ? <span className="enq-dash">—</span> : e.product}</td>
                    <td>{e.company === '—' ? <span className="enq-dash">—</span> : e.company}</td>
                    <td><span className="enq-country">{e.country}</span></td>
                    <td><span className="enq-status" style={{ background: col.bg, color: col.fg, borderColor: col.border }}>{e.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="enq-pagination">
          <span className="enq-page-info">
            {total === 0 ? 'No enquiries' : <>{startIdx + 1} to {Math.min(startIdx + rpp, total)} of {total}</>}
          </span>
          <div className="enq-pag-right">
            <div className="enq-rows">
              Rows:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {ROWS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="enq-range">{safePage}–{pages}</span>
            <button className="enq-pg-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button className="enq-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.enq-root {
  font-family: 'DM Sans', 'Inter', sans-serif;
  background: #f8fafc;
  padding: 20px 24px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #0f172a;
  display: flex; flex-direction: column; gap: 14px;
}
.enq-root *, .enq-root *::before, .enq-root *::after { box-sizing: border-box; }
.enq-no-access { background:#fff; border:1.5px solid #e5e7eb; border-radius:14px; padding:28px; text-align:center; color:#64748b; }

.enq-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.enq-title { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -.3px; margin: 0; }
.enq-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 6px; font-size: 12px; color: #64748b; }
.enq-meta strong { color: #0f172a; margin-right: 4px; }
.enq-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px; border: 1.5px solid #e2e8f0;
  background: #fff; color: #475569;
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.enq-back-btn:hover { border-color: #6366f1; color: #6366f1; }

.enq-search {
  position: relative; max-width: 420px; width: 100%;
}
.enq-search svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); }
.enq-search input {
  width: 100%; height: 40px; padding: 0 14px 0 38px;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  background: #fff; color: #0f172a;
  font-family: inherit; font-size: 12.5px;
  outline: none; transition: all .15s;
}
.enq-search input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.1); }

.enq-card {
  background: #fff; border: 1px solid #e2e8f0;
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,.05);
}
.enq-table-wrap { overflow-x: auto; }
.enq-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; }
.enq-table thead tr { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
.enq-table thead th { color: #64748b; font-size: 10px; font-weight: 700; padding: 10px; text-align: left; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.enq-table tbody tr { border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background .12s; }
.enq-table tbody tr:hover { background: #f8fafc; }
.enq-table tbody td { padding: 8px 10px; color: #475569; vertical-align: middle; }
.enq-table tbody td strong { color: #0f172a; }
.enq-empty { text-align: center !important; padding: 36px !important; color: #94a3b8; font-style: italic; }
.enq-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #6366f1; font-weight: 600; }
.enq-dash { color: #cbd5e1; }
.enq-country {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 32px; padding: 3px 9px; border-radius: 6px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff; font-size: 10.5px; font-weight: 800; letter-spacing: .04em;
}
.enq-status {
  display: inline-flex; align-items: center; padding: 3px 10px;
  border-radius: 20px; border: 1px solid;
  font-size: 10.5px; font-weight: 700;
}

.enq-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1px solid #f1f5f9; background: #f8fafc;
  flex-wrap: wrap; gap: 8px;
}
.enq-page-info { font-size: 11.5px; color: #64748b; font-weight: 600; }
.enq-pag-right { display: flex; align-items: center; gap: 8px; }
.enq-rows { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: #64748b; }
.enq-rows select { border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 6px; font-family: inherit; font-size: 11.5px; }
.enq-range { font-size: 11.5px; font-weight: 700; color: #0f172a; padding: 3px 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
.enq-pg-btn {
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid #e2e8f0; background: #fff;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #6366f1; transition: all .15s;
}
.enq-pg-btn:hover:not(:disabled) { background: #6366f1; color: #fff; border-color: #6366f1; }
.enq-pg-btn:disabled { opacity: .4; cursor: not-allowed; }
`;
