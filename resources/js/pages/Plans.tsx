import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import { Check, Pencil, Trash2, Plus, Loader2, CreditCard, Users, GitBranch, HardDrive, Headphones } from 'lucide-react';

interface Plan {
  id: number; name: string; slug: string; price: number; period: string;
  max_branches: number | null; max_users: number | null; storage_limit: string | null;
  support_level: string | null; is_featured: boolean; badge: string | null;
  color: string | null; description: string | null; best_for: string | null;
  status: string; trial_days: number | null; yearly_discount: number | null;
  is_custom: boolean; clients_count?: number;
  modules?: { id: number; name: string; slug: string; pivot?: { access_level: string } }[];
}

const periodLabel: Record<string, string> = { month: '/mo', quarter: '/qtr', year: '/yr' };

export default function Plans({ onNavigate }: { onNavigate?: (page: string, data?: any) => void }) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchPlans = () => {
    setLoading(true);
    api.get('/plans').then(res => setPlans(res.data || []))
      .catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, []);

  const handleDelete = async (plan: Plan) => {
    if (!confirm(`Delete "${plan.name}" plan?`)) return;
    setDeleting(plan.id);
    try {
      await api.delete(`/plans/${plan.id}`);
      toast.success('Plan Deleted', `"${plan.name}" has been removed`);
      fetchPlans();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot delete plan');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <CreditCard size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-text tracking-tight">Subscription Plans</h1>
            <p className="text-[11.5px] text-muted mt-0.5">Manage pricing, limits and features · {plans.length} plans</p>
          </div>
        </div>
        <Button size="sm" onClick={() => onNavigate?.('add-plan')}><Plus size={13} /> Add Plan</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted text-[12px]">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading plans...
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-2xl">
          <CreditCard size={32} className="text-muted mx-auto mb-3" />
          <p className="text-[13px] text-muted">No plans yet. Click "Add Plan" to create your first plan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {plans.map(p => (
            <div key={p.id} className={`group relative bg-surface border-2 ${p.is_featured ? 'border-primary shadow-lg shadow-primary/10' : 'border-border'} rounded-2xl p-5 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
              {p.is_featured && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-primary text-white text-[8px] font-bold px-3 py-1 rounded-b-lg tracking-wider uppercase">
                  {p.badge || 'Popular'}
                </div>
              )}

              {/* Header */}
              <div className="text-center mb-4 pt-2">
                <h3 className="text-[17px] font-extrabold text-text">{p.name}</h3>
                <Badge variant={p.status === 'active' ? 'success' : 'danger'} dot>{p.status}</Badge>
                <div className="mt-3">
                  {p.price <= 0
                    ? <span className="text-3xl font-extrabold text-primary">Free</span>
                    : <>
                        <span className="text-sm text-primary font-semibold">₹</span>
                        <span className="text-3xl font-extrabold text-primary">{p.price.toLocaleString()}</span>
                        <span className="text-sm text-secondary">{periodLabel[p.period] || '/' + p.period}</span>
                      </>
                  }
                </div>
                {p.best_for && <p className="text-[10.5px] text-muted mt-1.5">{p.best_for}</p>}
              </div>

              {/* Limits */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-bg rounded-lg px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors">
                  <GitBranch size={11} className="text-muted mx-auto mb-0.5" />
                  <div className="text-[8px] font-semibold text-muted uppercase">Branches</div>
                  <div className="text-[13px] font-bold text-text">{p.max_branches ?? '∞'}</div>
                </div>
                <div className="bg-bg rounded-lg px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors">
                  <Users size={11} className="text-muted mx-auto mb-0.5" />
                  <div className="text-[8px] font-semibold text-muted uppercase">Users</div>
                  <div className="text-[13px] font-bold text-text">{p.max_users ?? '∞'}</div>
                </div>
                <div className="bg-bg rounded-lg px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors">
                  <HardDrive size={11} className="text-muted mx-auto mb-0.5" />
                  <div className="text-[8px] font-semibold text-muted uppercase">Storage</div>
                  <div className="text-[13px] font-bold text-text">{p.storage_limit || '—'}</div>
                </div>
                <div className="bg-bg rounded-lg px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors">
                  <Headphones size={11} className="text-muted mx-auto mb-0.5" />
                  <div className="text-[8px] font-semibold text-muted uppercase">Support</div>
                  <div className="text-[13px] font-bold text-text">{p.support_level || '—'}</div>
                </div>
              </div>

              {/* Modules */}
              {p.modules && p.modules.length > 0 && (
                <div className="mb-3 space-y-1">
                  <div className="text-[9px] font-bold text-muted uppercase tracking-wider mb-1">Modules ({p.modules.length})</div>
                  {p.modules.slice(0, 4).map(m => (
                    <div key={m.id} className="flex items-center gap-1.5 text-[11px] text-secondary">
                      <Check size={10} className="text-emerald-500 flex-shrink-0" />
                      <span>{m.name}</span>
                      {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                        <span className="text-[8px] font-bold px-1 py-px rounded bg-sky-100 text-sky-600 ml-auto">{m.pivot.access_level}</span>
                      )}
                    </div>
                  ))}
                  {p.modules.length > 4 && <span className="text-[10px] text-muted">+{p.modules.length - 4} more</span>}
                </div>
              )}

              {/* Info */}
              <div className="mt-auto space-y-1.5 mb-4">
                {p.trial_days && p.trial_days > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-secondary">
                    <Check size={11} className="text-emerald-500" /> {p.trial_days}-day free trial
                  </div>
                )}
                {p.yearly_discount && p.yearly_discount > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-secondary">
                    <Check size={11} className="text-emerald-500" /> {p.yearly_discount}% yearly discount
                  </div>
                )}
                {p.clients_count !== undefined && p.clients_count > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-secondary">
                    <Users size={11} className="text-primary" /> {p.clients_count} active client{p.clients_count !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 justify-center" onClick={() => onNavigate?.('add-plan', { editId: p.id })}>
                  <Pencil size={11} /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(p)} disabled={deleting === p.id}>
                  <Trash2 size={11} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
