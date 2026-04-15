import { useState, useEffect } from 'react';
import StatCard from '../../components/StatCard';
import { Card, CardBody } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { Table, Td } from '../../components/ui/Table';
import { useAuth } from '../../contexts/AuthContext';
import { Users, Building2, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../api';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import type { Branch } from '../../types';

export default function ClientDashboard() {
  const { user } = useAuth();
  const { selectedBranchId } = useBranchSwitcher();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/branches', { params: { per_page: 50 } }).then(res => {
      setBranches(res.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Filter by selected branch
  const filtered = selectedBranchId ? branches.filter(b => b.id === selectedBranchId) : branches;
  const totalUsers = filtered.reduce((s, b) => s + (b.users_count ?? 0), 0);
  const activeBranches = filtered.filter(b => b.status === 'active').length;

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Dashboard — {user?.client_name}</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Organization overview</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Users} color="blue" label="Total Users" value={totalUsers} />
        <StatCard icon={Building2} color="sky" label="Branches" value={filtered.length} />
        <StatCard icon={CheckCircle} color="green" label="Active Branches" value={activeBranches} up />
        <StatCard icon={AlertTriangle} color="amber" label="Pending" value={0} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted text-[12px]">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-8 text-muted text-[13px]">
              No branches yet. Go to <strong>Branches</strong> to add your first branch.
            </div>
          </CardBody>
        </Card>
      ) : (
        <Table headers={['Branch', 'Users', 'Status']}>
          {filtered.map(b => (
            <tr key={b.id} className="hover:bg-primary/5 transition-colors">
              <Td>
                <span className="font-semibold text-text">{b.name}</span>
                {b.is_main && <Badge variant="warning">Main</Badge>}
              </Td>
              <Td>{b.users_count ?? 0}</Td>
              <Td><Badge variant={b.status === 'active' ? 'success' : 'danger'} dot>{b.status}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
