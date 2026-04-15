import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Avatar from '../components/ui/Avatar';
import StatCard from '../components/StatCard';
import { Table, Td } from '../components/ui/Table';
import { Plus, Users, UserCheck, UserX, Download, Eye, Pencil, FileText, Trash2 } from 'lucide-react';

const employees = [
  { name: 'Durgesh Urkude', dept: 'Sales', role: 'Sales Manager', join: '2022-03-15', salary: '₹68,000', perf: 88, status: 'active', initials: 'DU', grad: 'from-indigo-500 to-violet-400' },
  { name: 'Ankit Bhosale', dept: 'Purchase', role: 'Purchase Manager', join: '2021-07-20', salary: '₹62,000', perf: 82, status: 'active', initials: 'AB', grad: 'from-emerald-500 to-teal-400' },
  { name: 'Priti Shende', dept: 'Accounts', role: 'Accounts Manager', join: '2020-11-01', salary: '₹58,000', perf: 91, status: 'active', initials: 'PS', grad: 'from-sky-500 to-blue-400' },
  { name: 'Sandeep Kadu', dept: 'Logistics', role: 'Logistics Manager', join: '2023-01-10', salary: '₹55,000', perf: 79, status: 'active', initials: 'SK', grad: 'from-amber-500 to-yellow-400' },
  { name: 'Rohit Nagpure', dept: 'Sales', role: 'Sales Executive', join: '2023-06-05', salary: '₹38,000', perf: 74, status: 'active', initials: 'RN', grad: 'from-purple-500 to-pink-400' },
  { name: 'Pooja Lokhande', dept: 'HR', role: 'Intern', join: '2024-02-01', salary: '₹18,000', perf: 65, status: 'inactive', initials: 'PL', grad: 'from-rose-500 to-pink-400' },
];

export default function Employees() {
  const active = employees.filter(e => e.status === 'active').length;

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Employees</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Full employee directory, profiles and records</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Download size={13} /> Export</Button>
          <Button size="sm"><Plus size={13} /> Add Employee</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard icon={Users} color="blue" label="Total" value={employees.length} />
        <StatCard icon={UserCheck} color="green" label="Active" value={active} />
        <StatCard icon={UserX} color="red" label="Inactive" value={employees.length - active} />
      </div>

      <Table headers={['Employee', 'Department', 'Role', 'Joining', 'Salary', 'Performance', 'Status', 'Actions']}>
        {employees.map(e => {
          const perfColor = e.perf >= 85 ? 'bg-emerald-500' : e.perf >= 75 ? 'bg-amber-500' : 'bg-red-500';
          const perfText = e.perf >= 85 ? 'text-emerald-500' : e.perf >= 75 ? 'text-amber-500' : 'text-red-500';
          return (
            <tr key={e.name} className="hover:bg-primary/5 transition-colors">
              <Td>
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${e.grad} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 shadow-sm`}>{e.initials}</div>
                  <div>
                    <div className="font-semibold text-text text-[12.5px]">{e.name}</div>
                  </div>
                </div>
              </Td>
              <Td>{e.dept}</Td>
              <Td>{e.role}</Td>
              <Td className="text-muted">{e.join}</Td>
              <Td><span className="font-bold text-text">{e.salary}</span></Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-border rounded-full max-w-[60px]">
                    <div className={`h-full rounded-full ${perfColor}`} style={{ width: `${e.perf}%` }} />
                  </div>
                  <span className={`text-[11px] font-bold ${perfText}`}>{e.perf}%</span>
                </div>
              </Td>
              <Td><Badge variant={e.status === 'active' ? 'success' : 'muted'} dot>{e.status}</Badge></Td>
              <Td>
                <div className="flex gap-1">
                  {[Eye, Pencil, FileText, Trash2].map((I, j) => (
                    <button key={j} className="w-6 h-6 rounded-md border border-border bg-surface text-muted flex items-center justify-center hover:text-primary hover:border-primary/40 transition-all">
                      <I size={11} />
                    </button>
                  ))}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
