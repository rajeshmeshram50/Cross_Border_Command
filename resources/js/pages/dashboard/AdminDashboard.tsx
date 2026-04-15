import StatCard from '../../components/StatCard';
import { Card, CardHeader, CardBody } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import { Table, Td } from '../../components/ui/Table';
import { Building2, IndianRupee, GitBranch, Users, CreditCard, CheckCircle, Activity } from 'lucide-react';

const stats = [
  { icon: Building2, color: 'blue' as const, label: 'Total Clients', value: '10', change: '+3 this month', up: true },
  { icon: IndianRupee, color: 'green' as const, label: 'Monthly Revenue', value: '₹58K', change: '+₹4,999', up: true },
  { icon: GitBranch, color: 'sky' as const, label: 'Total Branches', value: '106', change: '+2 this week', up: true },
  { icon: Users, color: 'amber' as const, label: 'Branch Users', value: '24', change: '18 online', up: true },
  { icon: CreditCard, color: 'purple' as const, label: 'Paid Clients', value: '8/10', change: '80% conversion', up: true },
  { icon: CheckCircle, color: 'green' as const, label: 'Pay Success', value: '83%', change: '10 of 12 txns', up: true },
];

const clients = [
  { name: 'Rajesh Meshram Enterprises', plan: 'Pro', amount: '₹4,999', status: 'active' },
  { name: 'Hockey Maharashtra', plan: 'Enterprise', amount: '₹14,999', status: 'active' },
  { name: 'Thane Boxing Association', plan: 'Pro', amount: '₹4,999', status: 'active' },
  { name: 'Lagori Sport Federation', plan: 'Enterprise', amount: '₹14,999', status: 'active' },
  { name: 'Gaurav Jagtap & Co.', plan: 'Free', amount: '₹0', status: 'inactive' },
];

const activity = [
  { icon: 'bg-emerald-500/10 text-emerald-500', msg: 'New client Rajesh Meshram Enterprises registered', time: '2 mins ago' },
  { icon: 'bg-emerald-500/10 text-emerald-500', msg: 'Payment received ₹4,999', time: '1 hour ago' },
  { icon: 'bg-sky-500/10 text-sky-500', msg: 'New branch Inorbvict Agrotech created', time: '3 hours ago' },
  { icon: 'bg-red-500/10 text-red-500', msg: 'Login failed for gaurav.jagtap@gjco.com', time: '5 hours ago' },
  { icon: 'bg-primary/10 text-primary', msg: 'Permissions updated for Durgesh Urkude', time: '1 day ago' },
];

export default function AdminDashboard() {
  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Admin Dashboard</h1>
          <p className="text-[11.5px] text-muted mt-0.5">10 clients · ₹58K MRR · 24 branch users · 106 branches</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Clients Table */}
        <div className="lg:col-span-2">
          <Table headers={['Client', 'Plan', 'MRR', 'Status']}>
            {clients.map(c => (
              <tr key={c.name} className="hover:bg-primary/5 transition-colors">
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={c.name.charAt(0) + (c.name.split(' ')[1]?.charAt(0) || '')} size="sm" />
                    <span className="font-semibold text-text">{c.name}</span>
                  </div>
                </Td>
                <Td><Badge variant="primary">{c.plan}</Badge></Td>
                <Td><span className="font-bold text-text">{c.amount}</span></Td>
                <Td><Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge></Td>
              </tr>
            ))}
          </Table>
        </div>

        {/* Activity Feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-[13px] font-bold text-text">
              <Activity size={14} className="text-emerald-500" /> Recent Activity
            </div>
          </CardHeader>
          <CardBody className="!p-0">
            {activity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-border/40 last:border-0">
                <div className={`w-6 h-6 rounded-md ${a.icon} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  <div className="w-2 h-2 rounded-full bg-current" />
                </div>
                <div>
                  <p className="text-[11px] text-text leading-snug" dangerouslySetInnerHTML={{ __html: a.msg }} />
                  <span className="text-[10px] text-muted">{a.time}</span>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
