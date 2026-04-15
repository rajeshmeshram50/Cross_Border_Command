import Button from '../components/ui/Button';
import { Check, X, Star, Pencil } from 'lucide-react';

const plans = [
  { name: 'Starter', price: 0, period: 'Free', branches: '1', users: '3', storage: '1GB', support: 'Email', color: 'border-slate-300', featured: false, modules: ['Dashboard', 'Task Manager', 'Basic CRM'] },
  { name: 'Basic', price: 1999, period: '/month', branches: '5', users: '10', storage: '5GB', support: 'Email + Chat', color: 'border-sky-400', featured: false, modules: ['Dashboard', 'Project Navigator', 'Sales Matrix'] },
  { name: 'Pro', price: 4999, period: '/month', branches: '25', users: '50', storage: '25GB', support: 'Priority', color: 'border-primary', featured: true, modules: ['Dashboard', 'Sales Matrix', 'P2P', 'Inventory'] },
  { name: 'Business', price: 9999, period: '/month', branches: '50', users: '100', storage: '100GB', support: 'Dedicated', color: 'border-amber-400', featured: false, modules: ['All Core + CLM + GTS'] },
  { name: 'Enterprise', price: 14999, period: '/month', branches: '∞', users: '∞', storage: '500GB+', support: 'Enterprise SLA', color: 'border-emerald-400', featured: false, modules: ['All Modules + HRMS + API'] },
];

export default function Plans({ onNavigate }: { onNavigate?: (page: string) => void }) {
  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-[17px] font-bold text-text tracking-tight">Subscription Plans</h1>
          <p className="text-[11.5px] text-muted mt-0.5">Manage pricing, limits and module access</p>
        </div>
        <Button size="sm" onClick={() => onNavigate?.('add-plan')}><Pencil size={13} /> Add Plan</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {plans.map(p => (
          <div key={p.name} className={`relative bg-surface border-2 ${p.featured ? p.color + ' shadow-lg shadow-primary/15' : 'border-border'} rounded-2xl p-5 flex flex-col transition-all hover:-translate-y-1 hover:shadow-xl`}>
            {p.featured && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-primary text-white text-[9px] font-bold px-3 py-1 rounded-b-lg tracking-wider">POPULAR</div>
            )}
            <div className="text-center mb-4 pt-2">
              <h3 className="text-[17px] font-extrabold text-text">{p.name}</h3>
              <div className="mt-3">
                {p.price === 0
                  ? <span className="text-3xl font-extrabold text-primary">Free</span>
                  : <><span className="text-sm text-primary font-semibold">₹</span><span className="text-3xl font-extrabold text-primary">{p.price.toLocaleString()}</span><span className="text-sm text-secondary">{p.period}</span></>
                }
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {[['Branches', p.branches], ['Users', p.users], ['Storage', p.storage], ['Support', p.support]].map(([l, v]) => (
                <div key={l} className="bg-bg rounded-lg px-2.5 py-2 text-center">
                  <div className="text-[9px] font-semibold text-muted uppercase">{l}</div>
                  <div className="text-[13px] font-bold text-text">{v}</div>
                </div>
              ))}
            </div>

            <div className="flex-1 space-y-1.5 mb-4">
              {p.modules.map(m => (
                <div key={m} className="flex items-center gap-2 text-[12px] text-secondary">
                  <Check size={12} className="text-emerald-500 flex-shrink-0" /> {m}
                </div>
              ))}
            </div>

            <Button variant={p.featured ? 'primary' : 'outline'} className="w-full justify-center">
              <Pencil size={12} /> Edit Plan
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
