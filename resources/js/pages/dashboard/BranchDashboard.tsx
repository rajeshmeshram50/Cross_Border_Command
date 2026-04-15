import StatCard from '../../components/StatCard';
import { Card, CardHeader, CardBody } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';
import { Users, UserCheck, Building2, Info } from 'lucide-react';

export default function BranchDashboard() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-[17px] font-bold text-text tracking-tight mb-1">{user?.branch_name || 'My Branch'}</h1>
      <p className="text-[11.5px] text-muted mb-4">Your branch overview</p>

      <div className="bg-sky-500/10 border border-sky-300 rounded-xl px-4 py-3 mb-5 flex items-center gap-2 text-[13px] text-sky-700">
        <Info size={15} />
        You are viewing <strong className="mx-1">{user?.branch_name}</strong> branch only. Contact client admin for cross-branch access.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Users} color="blue" label="My Users" value={8} />
        <StatCard icon={UserCheck} color="green" label="Active" value={6} change="75% active" up />
        <StatCard icon={Building2} color="amber" label="Departments" value={4} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-[13px] font-bold text-text">Quick Stats</span></CardHeader>
          <CardBody className="!p-0">
            {[['Attendance (Today)', '92%', 'text-emerald-500'], ['Fees Collected', '₹18,500', 'text-primary'], ['Pending Fees', '₹2,500', 'text-amber-500'], ['Upcoming Events', '3', 'text-sky-500']].map(([l, v, c]) => (
              <div key={l} className="flex justify-between px-4 py-3 border-b border-border/40 text-[13px]">
                <span className="text-secondary">{l}</span>
                <strong className={c}>{v}</strong>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><span className="text-[13px] font-bold text-text">Branch Info</span></CardHeader>
          <CardBody className="!p-0">
            {[['Branch', user?.branch_name || 'Main'], ['Client', user?.client_name || '—'], ['Contact', 'Durgesh Urkude'], ['Email', user?.email || '—'], ['Status', 'Active']].map(([l, v]) => (
              <div key={l} className="flex gap-3 px-4 py-2.5 border-b border-border/40 text-[12.5px]">
                <span className="text-muted min-w-[80px]">{l}</span>
                <strong className="text-text">{v}</strong>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
