import StatCard from '../../components/StatCard';
import { Card, CardHeader, CardBody } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { Table, Td } from '../../components/ui/Table';
import { useAuth } from '../../contexts/AuthContext';
import { Users, UserCheck, UserX, Building2, CheckCircle, AlertTriangle } from 'lucide-react';

const branches = [
  { name: 'Inorbvict Agrotech Pvt. Ltd.', isMain: true, users: 8, active: 6, status: 'active' },
  { name: 'RM Agro East Branch', isMain: false, users: 3, active: 2, status: 'active' },
  { name: 'RM Trading West', isMain: false, users: 2, active: 2, status: 'active' },
];

export default function ClientDashboard() {
  const { user } = useAuth();
  const totalUsers = branches.reduce((s, b) => s + b.users, 0);
  const activeUsers = branches.reduce((s, b) => s + b.active, 0);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Dashboard — {user?.client_name}</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Organization overview</p>
        </div>
        <Badge variant="success" dot>Pro Plan Active</Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard icon={Users} color="blue" label="Total Users" value={totalUsers} />
        <StatCard icon={UserCheck} color="green" label="Active Users" value={activeUsers} change={`${Math.round(activeUsers / totalUsers * 100)}% active`} up />
        <StatCard icon={UserX} color="red" label="Inactive Users" value={totalUsers - activeUsers} />
        <StatCard icon={Building2} color="sky" label="Branches" value={branches.length} />
        <StatCard icon={CheckCircle} color="green" label="Active Branches" value={branches.filter(b => b.status === 'active').length} up />
        <StatCard icon={AlertTriangle} color="amber" label="Pending" value={0} />
      </div>

      <Table headers={['Branch', 'Users', 'Active', 'Inactive', 'Status']}>
        {branches.map(b => (
          <tr key={b.name} className="hover:bg-primary/5 transition-colors">
            <Td>
              <span className="font-semibold text-text">{b.name}</span>
              {b.isMain && <Badge variant="warning" className="ml-2">★ Main</Badge>}
            </Td>
            <Td>{b.users}</Td>
            <Td><span className="text-emerald-500 font-bold">{b.active}</span></Td>
            <Td><span className="text-red-500 font-bold">{b.users - b.active}</span></Td>
            <Td><Badge variant="success" dot>{b.status}</Badge></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
