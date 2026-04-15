import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  CreditCard, Check, Users, GitBranch, HardDrive, Headphones,
  Loader2, Zap, Shield, Clock, IndianRupee, Smartphone, Building2, Wifi
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
    if (cycle === 'year' && plan.yearly_discount) {
      amount = amount * (1 - plan.yearly_discount / 100);
    }
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

    // Simulate payment processing delay
    await new Promise(r => setTimeout(r, 2500));

    try {
      const res = await api.post('/subscription/subscribe', {
        plan_id: selectedPlan.id,
        payment_method: paymentMethod,
        billing_cycle: billingCycle,
      });
      setTxnResult(res.data);
      setPaymentStep('success');
      toast.success('Payment Successful', `${selectedPlan.name} plan activated!`);
    } catch (err: any) {
      toast.error('Payment Failed', err.response?.data?.message || 'Something went wrong');
      setPaymentStep('select');
    } finally {
      setProcessing(false);
    }
  };

  const total = selectedPlan ? getPrice(selectedPlan, billingCycle) : 0;
  const gst = Math.round(total * 0.18);
  const grandTotal = Math.round(total + gst);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted"><Loader2 size={24} className="animate-spin mr-2" /> Loading plans...</div>;
  }

  const hasPlan = user?.plan?.has_plan && !user?.plan?.expired;

  return (
    <div>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet-400 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
            <CreditCard size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-text">Choose Your Plan</h1>
          <p className="text-[13px] text-muted mt-2">Select a plan to activate your organization and unlock features</p>
          {user?.client_name && <p className="text-[12px] text-primary font-semibold mt-1">{user.client_name}</p>}
        </div>

        {/* Current plan banner */}
        {hasPlan && (
          <div className="max-w-xl mx-auto mb-6 flex items-center gap-3 px-5 py-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
            <Check size={16} className="text-emerald-500 flex-shrink-0" />
            <div>
              <strong>Current Plan: {user?.plan?.plan_name}</strong>
              <span className="text-emerald-600 ml-2">Valid until {user?.plan?.expires_at}</span>
            </div>
          </div>
        )}
        {user?.plan?.expired && (
          <div className="max-w-xl mx-auto mb-6 flex items-center gap-3 px-5 py-3.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
            <Clock size={16} className="text-red-500 flex-shrink-0" />
            <div>
              <strong>Your plan has expired!</strong> Please renew to continue using all features.
            </div>
          </div>
        )}

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(['month', 'quarter', 'year'] as const).map(c => (
            <button key={c} onClick={() => setBillingCycle(c)}
              className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-all duration-200 cursor-pointer ${
                billingCycle === c ? 'bg-primary text-white shadow-md shadow-primary/30' : 'bg-surface border border-border text-secondary hover:border-primary/40'
              }`}>
              {c === 'month' ? 'Monthly' : c === 'quarter' ? 'Quarterly' : 'Yearly'}
              {c === 'year' && <span className="ml-1 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">SAVE</span>}
            </button>
          ))}
        </div>

        {/* Plans Grid */}
        {plans.length === 0 ? (
          <div className="text-center py-16 bg-surface border border-border rounded-2xl">
            <p className="text-muted">No plans available. Contact administrator.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {plans.map(p => {
              const price = getPrice(p, billingCycle);
              return (
                <div key={p.id} className={`group relative bg-surface border-2 ${p.is_featured ? 'border-primary shadow-xl shadow-primary/10' : 'border-border'} rounded-2xl p-6 flex flex-col transition-all duration-300 hover:-translate-y-2 hover:shadow-xl`}>
                  {p.is_featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-violet-400 text-white text-[9px] font-bold px-4 py-1.5 rounded-full shadow-lg tracking-wider">
                      {p.badge || 'MOST POPULAR'}
                    </div>
                  )}

                  <div className="text-center mb-5 pt-2">
                    <h3 className="text-[18px] font-extrabold text-text">{p.name}</h3>
                    <div className="mt-3">
                      {p.price <= 0
                        ? <span className="text-3xl font-extrabold text-primary">Free</span>
                        : <>
                            <span className="text-sm text-primary font-semibold">₹</span>
                            <span className="text-3xl font-extrabold text-primary">{Math.round(price).toLocaleString()}</span>
                            <span className="text-sm text-secondary">{periodLabel[billingCycle]}</span>
                          </>
                      }
                    </div>
                    {p.best_for && <p className="text-[10.5px] text-muted mt-2">{p.best_for}</p>}
                    {billingCycle === 'year' && p.yearly_discount && p.yearly_discount > 0 && (
                      <span className="inline-block mt-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{p.yearly_discount}% off yearly</span>
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
                      <div key={l.label} className="bg-bg rounded-xl px-2.5 py-2 text-center group-hover:bg-primary/5 transition-colors">
                        <l.icon size={11} className="text-muted mx-auto mb-0.5" />
                        <div className="text-[8px] font-semibold text-muted uppercase">{l.label}</div>
                        <div className="text-[13px] font-bold text-text">{l.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Modules */}
                  {p.modules && p.modules.length > 0 && (
                    <div className="flex-1 mb-4">
                      <div className="text-[9px] font-bold text-muted uppercase tracking-wider mb-2">Included Modules</div>
                      <div className="space-y-1.5">
                        {p.modules.map(m => (
                          <div key={m.id} className="flex items-center gap-2 text-[11.5px] text-secondary">
                            <Check size={11} className="text-emerald-500 flex-shrink-0" />
                            {m.name}
                            {m.pivot?.access_level === 'limited' && <span className="text-[8px] font-bold px-1 py-px rounded bg-sky-100 text-sky-600 ml-auto">Limited</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {p.trial_days && p.trial_days > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 mb-3">
                      <Clock size={11} /> {p.trial_days}-day free trial
                    </div>
                  )}

                  <Button variant={p.is_featured ? 'primary' : 'outline'} size="lg" className="w-full justify-center mt-auto" onClick={() => openPayment(p)}>
                    <Zap size={14} /> {p.price <= 0 ? 'Get Started Free' : 'Choose Plan'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Modal open={paymentModal} onClose={() => !processing && setPaymentModal(false)} title={paymentStep === 'success' ? 'Payment Successful' : `Subscribe to ${selectedPlan?.name}`} size="md">
        {paymentStep === 'select' && selectedPlan && (
          <div className="space-y-5">
            {/* Order Summary */}
            <div className="bg-bg rounded-xl p-4">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3">Order Summary</div>
              <div className="flex justify-between text-[13px] mb-1">
                <span className="text-secondary">{selectedPlan.name} Plan ({billingCycle}ly)</span>
                <span className="font-bold text-text">₹{Math.round(total).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-muted">GST (18%)</span>
                <span className="text-muted">₹{gst.toLocaleString()}</span>
              </div>
              <div className="border-t border-border mt-2 pt-2 flex justify-between text-[14px]">
                <span className="font-bold text-text">Total</span>
                <span className="font-extrabold text-primary">₹{grandTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <div className="text-[11.5px] font-semibold text-text mb-2">Payment Method</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'upi', label: 'UPI', icon: Smartphone, desc: 'Google Pay / PhonePe' },
                  { id: 'card', label: 'Card', icon: CreditCard, desc: 'Credit / Debit Card' },
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

            {/* Dummy payment fields */}
            {paymentMethod === 'upi' && (
              <Input label="UPI ID" placeholder="yourname@upi" defaultValue="payment@ybl" />
            )}
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
              <div className="bg-bg rounded-xl p-3 text-center text-[12px] text-secondary">
                <Building2 size={20} className="mx-auto mb-2 text-muted" />
                You will be redirected to your bank's secure page
              </div>
            )}

            <div className="flex items-center gap-2 text-[10px] text-muted">
              <Shield size={12} /> Secured by Razorpay · 256-bit SSL encryption
            </div>

            <Button size="lg" className="w-full justify-center" onClick={handlePay}>
              <IndianRupee size={14} /> Pay ₹{grandTotal.toLocaleString()}
            </Button>
          </div>
        )}

        {paymentStep === 'processing' && (
          <div className="text-center py-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 animate-pulse-ring">
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

            <div className="bg-bg rounded-xl p-4 text-left mb-5 space-y-2">
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

            <Button size="lg" className="w-full justify-center" onClick={() => { setPaymentModal(false); onSuccess(); }}>
              <Zap size={14} /> Go to Dashboard
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
