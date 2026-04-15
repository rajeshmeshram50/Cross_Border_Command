import { useState, useEffect } from 'react';
import StatCard from '../../components/StatCard';
import { Card, CardBody } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { Table, Td } from '../../components/ui/Table';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { Users, UserCheck, Building2, Info, Star, Loader2 } from 'lucide-react';
import api from '../../api';
import type { Branch } from '../../types';

export default function BranchDashboard() {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, isMainBranchUser } = useBranchSwitcher();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/branches', { params: { per_page: 50 } }).then(res => {
      setBranches(res.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = selectedBranchId ? branches.filter(b => b.id === selectedBranchId) : branches;
  const totalUsers = filtered.reduce((s, b) => s + (b.users_count ?? 0), 0);
  const activeBranches = filtered.filter(b => b.status === 'active').length;

  const displayName = selectedBranch ? selectedBranch.name : (isMainBranchUser ? user?.client_name : user?.branch_name);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Dashboard — {displayName}</h1>
          <p className="text-[11.5px] text-muted mt-0.5">
            {isMainBranchUser ? 'Main branch — viewing all branches' : 'Branch overview'}
          </p>
        </div>
        {isMainBranchUser && !selectedBranchId && (
          <Badge variant="warning"><Star size={8} /> Main Branch — All Data</Badge>
        )}
      </div>

      {/* Info banner for normal branch user */}
      {!isMainBranchUser && (
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl px-4 py-3 mb-5 flex items-center gap-2 text-[12px] text-sky-700">
          <Info size={14} />
          You are viewing <strong className="mx-1">{user?.branch_name}</strong> branch data only.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Users} color="blue" label="Total Users" value={totalUsers} />
        <StatCard icon={UserCheck} color="green" label="Active Branches" value={activeBranches} up />
        <StatCard icon={Building2} color="sky" label="Branches" value={filtered.length} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted text-[12px]">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-8 text-muted text-[13px]">No branch data available.</div>
          </CardBody>
        </Card>
      ) : (
        <Table headers={['Branch', 'Users', 'Status']}>
          {filtered.map(b => (
            <tr key={b.id} className="hover:bg-primary/5 transition-colors">
              <Td>
                <span className="font-semibold text-text">{b.name}</span>
                {b.is_main && <Badge variant="warning"> Main</Badge>}
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
