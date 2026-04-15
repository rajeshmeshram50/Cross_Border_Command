import { useState, useEffect } from 'react';
import StatCard from '../../components/StatCard';
import { Card, CardBody } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import { Table, Td } from '../../components/ui/Table';
import { Building2, Users, CreditCard, CheckCircle, Loader2 } from 'lucide-react';
import api from '../../api';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ clients: 0, branches: 0, users: 0, activeClients: 0 });
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/clients', { params: { per_page: 5 } }).then(res => {
      const data = res.data.data || [];
      setClients(data);
      const total = res.data.total || 0;
      const active = data.filter((c: any) => c.status === 'active').length;
      setStats(s => ({ ...s, clients: total, activeClients: active }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Admin Dashboard</h1>
          <p className="text-[11.5px] text-muted mt-0.5">{stats.clients} clients · {stats.activeClients} active</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Building2} color="blue" label="Total Clients" value={stats.clients} />
        <StatCard icon={CheckCircle} color="green" label="Active Clients" value={stats.activeClients} up />
        <StatCard icon={Users} color="amber" label="Total Users" value={stats.users} />
        <StatCard icon={CreditCard} color="purple" label="Subscriptions" value={stats.clients} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted text-[12px]">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading...
          </div>
        ) : clients.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-8 text-muted text-[13px]">
                No clients yet. Go to <strong>Clients</strong> to add your first client.
              </div>
            </CardBody>
          </Card>
        ) : (
          <Table headers={['Client', 'Plan', 'Branches', 'Status']}>
            {clients.map((c: any) => (
              <tr key={c.id} className="hover:bg-primary/5 transition-colors">
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={c.org_name.charAt(0) + (c.org_name.split(' ')[1]?.charAt(0) || '')} size="sm" />
                    <span className="font-semibold text-text">{c.org_name}</span>
                  </div>
                </Td>
                <Td><Badge variant="primary">{c.plan?.name || 'Free'}</Badge></Td>
                <Td><span className="font-bold text-text">{c.branches_count ?? 0}</span></Td>
                <Td><Badge variant={c.status === 'active' ? 'success' : 'danger'} dot>{c.status}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
