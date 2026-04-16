import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import api from '../api';
import { ShimmerPlanCards, ShimmerHero } from '../components/ui/Shimmer';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  CreditCard, Check, Users, GitBranch, HardDrive, Headphones,
  Loader2, Zap, Shield, Clock, IndianRupee, Smartphone, Building2, Wifi,
  CheckCircle2, Star, ArrowRight, Sparkles
} from 'lucide-react';

interface Plan {
  id: number; name: string; price: number; period: string;
  max_branches: number | null; max_users: number | null; storage_limit: string | null;
  support_level: string | null; is_featured: boolean; badge: string | null;
  description: string | null; best_for: string | null;
  trial_days: number | null; yearly_discount: number | null;
  modules?: { id: number; name: string; pivot?: { access_level: string } }[];
}

const periodLabel: Record<string, string> = { month: '/mo', quarter: '/qtr', year: '/yr' };

const planGradients: Record<string, string> = {
  Starter: 'from-slate-500 to-slate-600',
  Basic: 'from-sky-500 to-blue-600',
  Pro: 'from-indigo-500 to-violet-600',
  Business: 'from-amber-500 to-orange-600',
  Enterprise: 'from-red-500 to-rose-600',
};

const planShadows: Record<string, string> = {
  Starter: 'shadow-slate-500/20',
  Basic: 'shadow-sky-500/20',
  Pro: 'shadow-indigo-500/20',
  Business: 'shadow-amber-500/20',
  Enterprise: 'shadow-red-500/20',
};

export default function PlanSelection({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [billingCycle, setBillingCycle] = useState<'month' | 'quarter' | 'year'>('month');
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card' | 'net_banking'>('upi');
  const [processing, setProcessing] = useState(false);
  const [paymentStep, setPaymentStep] = useState<'select' | 'processing' | 'success'>('select');
  const [txnResult, setTxnResult] = useState<any>(null);

  useEffect(() => {
    api.get('/subscription/plans').then(res => setPlans(res.data || []))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const getPrice = (plan: Plan, cycle: string) => {
    const base = plan.price;
    const mult = cycle === 'quarter' ? 3 : cycle === 'year' ? 12 : 1;
    let amount = base * mult;
    if (cycle === 'year' && plan.yearly_discount) amount = amount * (1 - plan.yearly_discount / 100);
    return amount;
  };

  const openPayment = (plan: Plan) => {
    setSelectedPlan(plan);
    setPaymentStep('select');
    setPaymentModal(true);
  };

  const handlePay = async () => {
    if (!selectedPlan) return;
    setPaymentStep('processing');
    setProcessing(true);
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await api.post('/subscription/subscribe', { plan_id: selectedPlan.id, payment_method: paymentMethod, billing_cycle: billingCycle });
      setTxnResult(res.data);
      setPaymentStep('success');
      toast.success('Payment Successful', `${selectedPlan.name} plan activated!`);
    } catch (err: any) {
      toast.error('Payment Failed', err.response?.data?.message || 'Something went wrong');
      setPaymentStep('select');
    } finally { setProcessing(false); }
  };

  const total = selectedPlan ? getPrice(selectedPlan, billingCycle) : 0;
  const gst = Math.round(total * 0.18);
  const grandTotal = Math.round(total + gst);

  if (loading) return <div className="space-y-6"><ShimmerHero /><ShimmerPlanCards count={5} /></div>;

  const hasPlan = user?.plan?.has_plan && !user?.plan?.expired;

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 shadow-xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA0KSIvPjwvc3ZnPg==')] opacity-60" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-red-500/10 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-orange-500/10 rounded-full translate-y-1/2 -translate-x-1/4 blur-3xl" />
        <div className="relative px-8 py-8 text-center">
          <div className="relative inline-block mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-red-500/30 mx-auto">
              <CreditCard size={28} className="text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-emerald-500 border-[3px] border-slate-900 flex items-center justify-center">
              <CheckCircle2 size={12} className="text-white" />
            </div>
          </div>
          <h1 className="text-[26px] font-extrabold text-white tracking-tight">Choose Your Plan</h1>
          <p className="text-white/50 text-[14px] mt-2 max-w-md mx-auto">Select the perfect plan to power your organization</p>
          {user?.client_name && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg mt-3">
              <Building2 size={11} /> {user.client_name}
            </span>
          )}
        </div>
      </div>

      {/* Current Plan / Expired Banner */}
      {hasPlan && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-emerald-50 border border-emerald-200/60">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-[12.5px] text-emerald-700">
            <strong>Current: {user?.plan?.plan_name}</strong> · Valid until {user?.plan?.expires_at}
          </div>
        </div>
      )}
      {user?.plan?.expired && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-red-50 border border-red-200/60">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <Clock size={16} className="text-red-500" />
          </div>
          <div className="text-[12.5px] text-red-700"><strong>Plan expired!</strong> Renew to continue using all features.</div>
        </div>
      )}

      {/* Billing Toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border shadow-sm">
          {(['month', 'quarter', 'year'] as const).map(c => (
            <button key={c} onClick={() => setBillingCycle(c)}
              className={`px-5 py-2.5 rounded-lg text-[12px] font-semibold transition-all duration-200 cursor-pointer ${
                billingCycle === c ? 'bg-gradient-to-r from-red-500 to-orange-600 text-white shadow-md shadow-red-500/25' : 'text-secondary hover:text-text hover:bg-surface-2'
              }`}>
              {c === 'month' ? 'Monthly' : c === 'quarter' ? 'Quarterly' : 'Yearly'}
              {c === 'year' && <span className="ml-1.5 text-[8px] font-extrabold bg-white/20 px-1.5 py-0.5 rounded-full uppercase">Save</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Grid */}
      {plans.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-2xl">
          <CreditCard size={32} className="text-muted/30 mx-auto mb-3" />
          <p className="text-muted text-[13px]">No plans available. Contact administrator.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
          {plans.map(p => {
            const price = getPrice(p, billingCycle);
            const gradient = planGradients[p.name] || 'from-indigo-500 to-violet-600';
            const shadow = planShadows[p.name] || 'shadow-indigo-500/20';
            return (
              <div key={p.id} className={`group relative bg-surface border-2 rounded-2xl flex flex-col transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl overflow-hidden ${
                p.is_featured ? 'border-primary shadow-xl shadow-primary/10' : 'border-border hover:border-primary/30'
              }`}>
                {/* Top Gradient Bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${gradient}`} />

                {p.is_featured && (
                  <div className="absolute top-3.5 right-3">
                    <span className="flex items-center gap-1 text-[8px] font-extrabold bg-gradient-to-r from-red-500 to-orange-600 text-white px-2.5 py-1 rounded-full shadow-lg uppercase tracking-wider">
                      <Star size={8} /> {p.badge || 'Popular'}
                    </span>
                  </div>
                )}

                <div className="p-5 flex flex-col flex-1">
                  {/* Plan Header */}
                  <div className="mb-4">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg ${shadow} mb-3 group-hover:scale-110 transition-transform duration-300`}>
                      <Sparkles size={18} className="text-white" />
                    </div>
                    <h3 className="text-[17px] font-extrabold text-text">{p.name}</h3>
                    {p.best_for && <p className="text-[10.5px] text-muted mt-1">{p.best_for}</p>}
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    {p.price <= 0 ? (
                      <span className="text-[28px] font-extrabold text-text">Free</span>
                    ) : (
                      <div>
                        <span className="text-[14px] text-muted font-semibold align-top">₹</span>
                        <span className="text-[32px] font-extrabold text-text leading-none">{Math.round(price).toLocaleString()}</span>
                        <span className="text-[13px] text-muted ml-0.5">{periodLabel[billingCycle]}</span>
                      </div>
                    )}
                    {billingCycle === 'year' && p.yearly_discount && p.yearly_discount > 0 && (
                      <span className="inline-block mt-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">{p.yearly_discount}% off yearly</span>
                    )}
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {[
                      { icon: GitBranch, label: 'Branches', val: p.max_branches ?? '∞' },
                      { icon: Users, label: 'Users', val: p.max_users ?? '∞' },
                      { icon: HardDrive, label: 'Storage', val: p.storage_limit || '—' },
                      { icon: Headphones, label: 'Support', val: p.support_level || '—' },
                    ].map(l => (
                      <div key={l.label} className="bg-surface-2 rounded-xl px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors duration-200">
                        <l.icon size={12} className="text-muted mx-auto mb-0.5" />
                        <div className="text-[8px] font-bold text-muted uppercase tracking-wider">{l.label}</div>
                        <div className="text-[13px] font-extrabold text-text">{l.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Modules */}
                  {p.modules && p.modules.length > 0 && (
                    <div className="flex-1 mb-4">
                      <div className="text-[9px] font-bold text-muted uppercase tracking-widest mb-2">Modules</div>
                      <div className="space-y-1.5">
                        {p.modules.map(m => (
                          <div key={m.id} className="flex items-center gap-2 text-[11.5px] text-secondary">
                            <div className="w-4 h-4 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                              <Check size={9} className="text-emerald-500" />
                            </div>
                            <span className="flex-1">{m.name}</span>
                            {m.pivot?.access_level === 'limited' && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-600">Limited</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {p.trial_days && p.trial_days > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold mb-3">
                      <Clock size={11} /> {p.trial_days}-day free trial
                    </div>
                  )}

                  {/* CTA */}
                  <Button
                    variant={p.is_featured ? 'primary' : 'outline'}
                    size="lg"
                    className={`w-full justify-center mt-auto ${p.is_featured ? '!bg-gradient-to-r !from-red-500 !to-orange-600 !border-0 !shadow-lg !shadow-red-500/25 hover:!brightness-110' : ''}`}
                    onClick={() => openPayment(p)}>
                    {p.price <= 0 ? <><Zap size={14} /> Get Started</> : <><ArrowRight size={14} /> Choose Plan</>}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Payment Modal ── */}
      <Modal open={paymentModal} onClose={() => !processing && setPaymentModal(false)} title={paymentStep === 'success' ? 'Payment Successful' : `Subscribe to ${selectedPlan?.name}`} size="md">
        {paymentStep === 'select' && selectedPlan && (
          <div className="space-y-5">
            {/* Order Summary */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 bg-surface-2 border-b border-border/50">
                <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Order Summary</span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-secondary">{selectedPlan.name} Plan ({billingCycle}ly)</span>
                  <span className="font-bold text-text">₹{Math.round(total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-muted">GST (18%)</span>
                  <span className="text-muted">₹{gst.toLocaleString()}</span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between text-[15px]">
                  <span className="font-bold text-text">Total</span>
                  <span className="font-extrabold text-emerald-600">₹{grandTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <div className="text-[11.5px] font-semibold text-text mb-2">Payment Method</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'upi', label: 'UPI', icon: Smartphone, desc: 'Google Pay / PhonePe' },
                  { id: 'card', label: 'Card', icon: CreditCard, desc: 'Credit / Debit' },
                  { id: 'net_banking', label: 'Net Banking', icon: Building2, desc: 'Bank Transfer' },
                ] as const).map(m => (
                  <button key={m.id} onClick={() => setPaymentMethod(m.id)}
                    className={`p-3 rounded-xl border-2 text-center transition-all duration-200 cursor-pointer ${
                      paymentMethod === m.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30'
                    }`}>
                    <m.icon size={18} className={`mx-auto mb-1 ${paymentMethod === m.id ? 'text-primary' : 'text-muted'}`} />
                    <div className="text-[11px] font-bold text-text">{m.label}</div>
                    <div className="text-[9px] text-muted">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === 'upi' && <Input label="UPI ID" placeholder="yourname@upi" defaultValue="payment@ybl" />}
            {paymentMethod === 'card' && (
              <div className="space-y-3">
                <Input label="Card Number" placeholder="4111 1111 1111 1111" defaultValue="4111 1111 1111 1111" />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Expiry" placeholder="MM/YY" defaultValue="12/28" />
                  <Input label="CVV" placeholder="***" defaultValue="123" type="password" />
                </div>
              </div>
            )}
            {paymentMethod === 'net_banking' && (
              <div className="bg-surface-2 rounded-xl p-4 text-center text-[12px] text-secondary">
                <Building2 size={20} className="mx-auto mb-2 text-muted" />
                You will be redirected to your bank's secure page
              </div>
            )}

            <div className="flex items-center gap-2 text-[10px] text-muted">
              <Shield size={12} /> Secured by Razorpay · 256-bit SSL encryption
            </div>

            <Button size="lg" className="w-full justify-center !bg-gradient-to-r !from-red-500 !to-orange-600 !border-0 !shadow-lg !shadow-red-500/25 hover:!brightness-110" onClick={handlePay}>
              <IndianRupee size={14} /> Pay ₹{grandTotal.toLocaleString()}
            </Button>
          </div>
        )}

        {paymentStep === 'processing' && (
          <div className="text-center py-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Loader2 size={28} className="text-primary animate-spin" />
            </div>
            <h3 className="text-[16px] font-bold text-text mb-1">Processing Payment...</h3>
            <p className="text-[12px] text-muted">Please wait while we process your payment</p>
            <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-muted">
              <Wifi size={12} className="animate-pulse" /> Connecting to payment gateway...
            </div>
          </div>
        )}

        {paymentStep === 'success' && txnResult && (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <Check size={28} className="text-emerald-600" />
            </div>
            <h3 className="text-[18px] font-extrabold text-text mb-1">Payment Successful!</h3>
            <p className="text-[13px] text-secondary mb-5">{txnResult.plan} plan has been activated</p>

            <div className="rounded-xl border border-border p-4 text-left mb-5 space-y-2">
              {[
                ['Transaction ID', txnResult.txn_id],
                ['Amount Paid', `₹${txnResult.total?.toLocaleString()}`],
                ['Plan', txnResult.plan],
                ['Valid Until', txnResult.valid_until],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between text-[12px]">
                  <span className="text-muted">{l}</span>
                  <span className="font-bold text-text">{v}</span>
                </div>
              ))}
            </div>

            <Button size="lg" className="w-full justify-center !bg-gradient-to-r !from-red-500 !to-orange-600 !border-0 !shadow-lg" onClick={() => { setPaymentModal(false); onSuccess(); }}>
              <Zap size={14} /> Go to Dashboard
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
