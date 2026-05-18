import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Leads Details (per-salesperson)
 *
 * Faithful port of prototype `#leadsDetailsPage` (line 27745). Shows all
 * leads assigned to one salesperson — reached via /sales/leads-details/:empId.
 * ──────────────────────────────────────────────────────────────────────── */

type LeadRow = {
  oppId: string;
  type: string;
  date: string;
  source: string;
  assigned: string;
  whatsapp: 'Yes' | 'No';
  customer: string;
  contact: string;
  phone: string;
  email: string;
  product: string;
  company: string;
  done: boolean;
};

const SAMPLE: LeadRow[] = [
  { oppId:'178358019', type:'Manual', date:'3/26/2026', source:'Offline', assigned:'8', whatsapp:'No', customer:'shree',                   contact:'shree',                phone:'1234567890', email:'shreeyashmote.ai@gmail.com', product:'-', company:'-',                    done:true },
  { oppId:'166775267', type:'Manual', date:'3/26/2026', source:'Offline', assigned:'8', whatsapp:'No', customer:'International Buyer',     contact:'International Buyer',  phone:'234567890',  email:'shreeyash.ai@gmail.com',     product:'-', company:'International Buyer', done:true },
  { oppId:'155661421', type:'PNS',    date:'3/24/2026', source:'Agrotech',assigned:'8', whatsapp:'Yes',customer:'GreenHarvest Global',     contact:'Ravi Vardhan',         phone:'+91 91234 56789', email:'r.vardhan@gmail.com',   product:'Cashew W320', company:'GreenHarvest',  done:false },
  { oppId:'144567890', type:'Direct', date:'3/22/2026', source:'Agrotech',assigned:'8', whatsapp:'No', customer:'Mujahed Al-Rashid',       contact:'Mujahed',              phone:'+962-786919870', email:'aboodmujahed6@gmail.com',product:'Turkish Dry Fig', company:'-', done:false },
];

export default function SalesLeadsDetails() {
  const navigate = useNavigate();
  const { empId } = useParams();
  const [q, setQ] = useState('');

  useEffect(() => {
    const id = 'sm-ldp-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const filtered = q
    ? SAMPLE.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q.toLowerCase())))
    : SAMPLE;

  return (
    <div className="ldp-root">
      <style>{SCOPED_CSS}</style>

      <div className="ldp-topbar">
        <div className="ldp-title">Leads Details</div>
        <button className="ldp-back-btn" onClick={() => navigate('/sales/lead-distribution')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
      </div>

      <div className="ldp-card">
        <div className="ldp-meta">
          <div className="ldp-meta-item">Employee ID: <span>{empId || 'EMP-008'}</span></div>
          <div className="ldp-meta-item">Sales Person: <span>Shreeyash Rajaram Mote</span></div>
          <div className="ldp-meta-item">Reporting Manager: <span>Rahul Verma</span></div>
        </div>
        <input
          className="ldp-search"
          type="text"
          placeholder="Search lead..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="ldp-table-wrap">
          <table className="ldp-table">
            <thead>
              <tr>
                <th>Opp ID</th><th>Type</th><th>Date</th><th>Source</th><th>Assigned</th>
                <th>WhatsApp</th><th>Customer</th><th>Contact</th><th>Phone</th>
                <th>Email</th><th>Product</th><th>Company</th><th>Lead Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="ldp-empty">No leads match the search</td></tr>
              )}
              {filtered.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.oppId}</strong></td>
                  <td>{r.type}</td>
                  <td>{r.date}</td>
                  <td>{r.source}</td>
                  <td>{r.assigned}</td>
                  <td>{r.whatsapp}</td>
                  <td>{r.customer}</td>
                  <td>{r.contact}</td>
                  <td>{r.phone}</td>
                  <td>{r.email}</td>
                  <td>{r.product}</td>
                  <td>{r.company}</td>
                  <td>
                    {r.done
                      ? <div className="ldp-check-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></div>
                      : <span className="ldp-pending">Open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ldp-footer">
          <span>{filtered.length} of {SAMPLE.length}</span>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.ldp-root {
  font-family: 'DM Sans', 'Inter', sans-serif;
  background: #f3f4f8;
  padding: 16px 22px 28px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e293b;
  display: flex; flex-direction: column; gap: 12px;
}
.ldp-root *, .ldp-root *::before, .ldp-root *::after { box-sizing: border-box; }

.ldp-topbar { display: flex; align-items: center; justify-content: space-between; }
.ldp-title { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -.3px; }
.ldp-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px;
  border: 1.5px solid #e2e8f0; background: #fff; color: #475569;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ldp-back-btn:hover { border-color: #6366f1; color: #6366f1; }

.ldp-card {
  background: #fff; border: 1px solid #e2e8f0;
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,.05);
  padding: 14px;
}
.ldp-meta { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 10px; }
.ldp-meta-item { font-size: 12px; color: #64748b; font-weight: 600; }
.ldp-meta-item span { color: #0f172a; font-weight: 700; margin-left: 4px; }
.ldp-search {
  width: 100%; max-width: 340px; height: 36px;
  padding: 0 14px; border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; font-family: inherit; font-size: 12px;
  outline: none; transition: all .15s; margin-bottom: 12px;
}
.ldp-search:focus { border-color: #6366f1; background: #fff; box-shadow: 0 0 0 3px rgba(99,102,241,.1); }

.ldp-table-wrap { overflow-x: auto; border: 1px solid #f1f5f9; border-radius: 8px; }
.ldp-table { width: 100%; border-collapse: collapse; font-size: 11.5px; min-width: 1100px; }
.ldp-table thead tr { background: linear-gradient(90deg, #4f46e5, #6366f1); }
.ldp-table thead th { color: #fff; font-size: 9.5px; font-weight: 700; padding: 9px 10px; text-align: left; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
.ldp-table tbody tr { border-bottom: 1px solid #f1f5f9; }
.ldp-table tbody tr:hover { background: #f8fafc; }
.ldp-table tbody td { padding: 7px 10px; color: #475569; }
.ldp-empty { text-align: center !important; padding: 28px !important; color: #94a3b8; font-style: italic; }
.ldp-check-badge {
  display: inline-flex; width: 22px; height: 22px;
  align-items: center; justify-content: center;
  background: #dcfce7; border-radius: 50%; border: 1px solid #86efac;
}
.ldp-pending {
  display: inline-flex; padding: 2px 9px; border-radius: 20px;
  background: #fef3c7; color: #92400e; border: 1px solid #fde68a;
  font-size: 10px; font-weight: 700;
}

.ldp-footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 10px; font-size: 11.5px; color: #64748b;
}
`;
