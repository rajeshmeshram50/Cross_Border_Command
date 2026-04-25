import { useState, useEffect, useRef } from 'react';
import {
  Card, CardBody, Col, Row, Button, Input, Label, Spinner,
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Autoplay } from 'swiper/modules';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
// @ts-ignore
import 'swiper/css';
// @ts-ignore
import 'swiper/css/navigation';
// @ts-ignore
import 'swiper/css/pagination';
import '../../css/plans-card.css';

interface Plan {
  id: number; name: string; price: number; period: string;
  max_branches: number | null; max_users: number | null; storage_limit: string | null;
  support_level: string | null; is_featured: boolean; badge: string | null;
  description: string | null; best_for: string | null;
  trial_days: number | null; yearly_discount: number | null;
  modules?: { id: number; name: string; pivot?: { access_level: string } }[];
}

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
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

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
    setProcessing(true);

    let orderRes;
    try {
      orderRes = await api.post('/subscription/create-order', {
        plan_id: selectedPlan.id,
        payment_method: paymentMethod,
        billing_cycle: billingCycle,
      });
    } catch (err: any) {
      toast.error('Could not start payment', err.response?.data?.message || 'Something went wrong');
      setProcessing(false);
      return;
    }

    // Free plan — already activated server-side
    if (orderRes.data.free) {
      setTxnResult(orderRes.data);
      setPaymentStep('success');
      setProcessing(false);
      toast.success('Plan Activated', `${selectedPlan.name} plan activated!`);
      return;
    }

    const Razorpay = (window as any).Razorpay;
    if (!Razorpay) {
      toast.error('Payment unavailable', 'Razorpay checkout failed to load');
      setProcessing(false);
      return;
    }

    const rzp = new Razorpay({
      key: orderRes.data.key,
      amount: orderRes.data.amount,
      currency: orderRes.data.currency,
      order_id: orderRes.data.order_id,
      name: orderRes.data.org_name || 'Cross Border Command',
      description: `${orderRes.data.plan_name} Plan (${orderRes.data.billing_cycle}ly)`,
      prefill: orderRes.data.prefill,
      theme: { color: '#405189' },
      method: paymentMethod === 'net_banking'
        ? { netbanking: true, card: false, upi: false, wallet: false }
        : paymentMethod === 'card'
          ? { card: true, netbanking: false, upi: false, wallet: false }
          : { upi: true, card: false, netbanking: false, wallet: false },
      handler: async (response: any) => {
        setPaymentStep('processing');
        try {
          const verify = await api.post('/subscription/verify-payment', {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          setTxnResult(verify.data);
          setPaymentStep('success');
          toast.success('Payment Successful', `${selectedPlan.name} plan activated!`);
        } catch (err: any) {
          toast.error('Verification Failed', err.response?.data?.message || 'Could not verify payment');
          setPaymentStep('select');
        } finally {
          setProcessing(false);
        }
      },
      modal: {
        ondismiss: () => {
          setProcessing(false);
          setPaymentStep('select');
          toast.error('Payment Cancelled', 'You closed the payment window');
        },
      },
    });

    rzp.on('payment.failed', (resp: any) => {
      toast.error('Payment Failed', resp.error?.description || 'Try a different payment method');
      setProcessing(false);
      setPaymentStep('select');
    });

    rzp.open();
  };

  const total = selectedPlan ? getPrice(selectedPlan, billingCycle) : 0;
  const gst = Math.round(total * 0.18);
  const grandTotal = Math.round(total + gst);

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  const hasPlan = user?.plan?.has_plan && !user?.plan?.expired;

  return (
    <div className="plans-surface">
      {/* ── Compact Page Header ── */}
      {hasPlan && (
        <style>{`
          @keyframes cp-dot-pulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(10,179,156,0.55); }
            50%      { transform: scale(1.25); box-shadow: 0 0 0 5px rgba(10,179,156,0); }
          }
          @keyframes cp-blink {
            0%, 100% {
              box-shadow: 0 0 0 0 rgba(10,179,156,0), 0 2px 6px rgba(10,179,156,0.35);
              filter: brightness(1);
            }
            50% {
              box-shadow: 0 0 0 4px rgba(10,179,156,0.22), 0 4px 14px rgba(10,179,156,0.40);
              filter: brightness(1.08);
            }
          }
          @keyframes cp-sweep {
            0%   { transform: translateX(-140%); }
            60%  { transform: translateX(140%); }
            100% { transform: translateX(140%); }
          }
          .cp-current-pill {
            position: relative;
            overflow: hidden;
            animation: cp-blink 1.8s ease-in-out infinite;
          }
          .cp-current-pill::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(110deg, transparent 40%, rgba(255,255,255,0.45) 50%, transparent 60%);
            transform: translateX(-140%);
            animation: cp-sweep 2.6s ease-in-out infinite;
            pointer-events: none;
          }
        `}</style>
      )}
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-0">
        <div className="d-flex align-items-center gap-2 flex-shrink-1 min-w-0">
          <div
            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
            style={{
              width: 36, height: 36,
              background: '#40518918',
              border: '1px solid #40518928',
            }}
          >
            <i className="ri-bank-card-line" style={{ color: '#405189', fontSize: 17 }} />
          </div>
          <div className="min-w-0">
            <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>Choose Your Plan</h5>
            {hasPlan ? (
              /* CURRENT plan pill takes the place of the subtitle */
              <span
                className="cp-current-pill d-inline-flex align-items-center gap-2 rounded-pill mt-2"
                style={{
                  background: 'linear-gradient(135deg, rgba(10,179,156,0.18) 0%, rgba(10,179,156,0.10) 100%)',
                  color: '#0ab39c',
                  border: '1px solid #0ab39c',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  padding: '3px 10px',
                }}
                title={`Valid until ${user?.plan?.expires_at}`}
              >
                <span
                  className="rounded-circle"
                  style={{
                    width: 6, height: 6,
                    background: '#0ab39c',
                    animation: 'cp-dot-pulse 1.4s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                CURRENT: {user?.plan?.plan_name?.toUpperCase()}
                <span className="ms-1" style={{ opacity: 0.8 }}>· {user?.plan?.expires_at}</span>
              </span>
            ) : (
              <p className="mb-0 text-muted" style={{ fontSize: 11.5 }}>
                Select the perfect plan to power your organization
              </p>
            )}
          </div>
        </div>

        {user?.client_name && (
          <span
            className="d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1 text-uppercase fw-semibold"
            style={{
              background: '#40518915',
              color: '#405189',
              border: '1px solid #40518930',
              fontSize: 10.5,
              letterSpacing: '0.05em',
            }}
          >
            <i className="ri-building-line" />{user.client_name}
          </span>
        )}
      </div>

      {/* ── Expired alert (only shown when urgent action needed) ── */}
      {user?.plan?.expired && (
        <div
          className="d-flex align-items-center gap-2 mb-3 px-3 py-2 rounded-2"
          style={{
            background: '#f0654810',
            border: '1px solid #f0654830',
            borderLeft: '3px solid #f06548',
          }}
        >
          <i className="ri-time-line" style={{ color: '#f06548', fontSize: 16 }}></i>
          <span style={{ fontSize: 13, color: 'var(--vz-body-color)' }}>
            <strong style={{ color: '#f06548' }}>Plan expired!</strong>
            <span className="text-muted"> Renew to continue using all features.</span>
          </span>
        </div>
      )}

      {/* ── Billing cycle toggle — glossy animated pill ── */}
      
      <div className="d-flex justify-content-center mb-3">
        <div
          className="d-inline-flex rounded-pill"
          style={{
            background: 'var(--vz-secondary-bg)',
            border: '1px solid var(--vz-border-color)',
            padding: 3,
            gap: 2,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          {(['month', 'quarter', 'year'] as const).map(c => {
            const isActive = billingCycle === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setBillingCycle(c)}
                className={`btn rounded-pill d-inline-flex align-items-center gap-1 border-0 ${isActive ? 'bc-btn-active' : ''}`}
                style={{
                  padding: '5px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  color: isActive ? '#fff' : 'var(--vz-body-color)',
                  boxShadow: isActive
                    ? '0 3px 10px rgba(64,81,137,0.38), inset 0 1px 0 rgba(255,255,255,0.22)'
                    : 'none',
                  textShadow: isActive ? '0 1px 2px rgba(0,0,0,0.18)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ position: 'relative', zIndex: 1 }}>
                  {c === 'month' ? 'Monthly' : c === 'quarter' ? 'Quarterly' : 'Yearly'}
                </span>
                {c === 'year' && (
                  <span
                    className={`rounded-pill fw-bold d-inline-flex align-items-center ${!isActive ? 'bc-save-badge' : ''}`}
                    style={{
                      padding: '1px 6px',
                      background: isActive
                        ? 'rgba(255,255,255,0.28)'
                        : 'linear-gradient(135deg, #0ab39c 0%, #14c9b1 100%)',
                      color: '#fff',
                      fontSize: 8.5,
                      letterSpacing: '0.06em',
                      lineHeight: 1.3,
                      position: 'relative',
                      zIndex: 1,
                      textShadow: isActive ? 'none' : '0 1px 1px rgba(0,0,0,0.15)',
                    }}
                  >
                    SAVE
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>   

      {plans.length === 0 ? (
        <Card><CardBody className="text-center py-5">
          <i className="ri-bank-card-line display-4 text-muted"></i>
          <p className="text-muted mt-3">No plans available. Contact administrator.</p>
        </CardBody></Card>
      ) : (
        <div className="plans-swiper-outer">
          <button ref={prevRef} type="button" className="plans-nav-btn plans-nav-prev" aria-label="Previous">
            <i className="ri-arrow-left-s-line"></i>
          </button>
          <Swiper
            modules={[Navigation, Pagination, Autoplay]}
            onBeforeInit={swiper => {
              if (typeof swiper.params.navigation === 'object' && swiper.params.navigation) {
                (swiper.params.navigation as any).prevEl = prevRef.current;
                (swiper.params.navigation as any).nextEl = nextRef.current;
              }
            }}
            navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
            pagination={{ clickable: true, dynamicBullets: true }}
            loop={plans.length > 1}
            autoplay={{ delay: 3500, disableOnInteraction: true, pauseOnMouseEnter: true }}
            speed={450}
            grabCursor={true}
            centeredSlides={true}
            slidesPerView="auto"
            spaceBetween={24}
            watchSlidesProgress={true}
            observer={true}
            observeParents={true}
            className="plans-swiper plans-swiper-center pb-5"
          >
          {plans.map(p => {
            const price = getPrice(p, billingCycle);
            const isCurrent = hasPlan && user?.plan?.plan_name?.toLowerCase() === p.name.toLowerCase();
            const periodShort = billingCycle === 'month' ? 'mo' : billingCycle === 'quarter' ? 'qtr' : 'yr';
            const stats = [
              { l: 'Branches', v: (p.max_branches  ?? '∞') as string | number, ic: 'ri-git-branch-line'   },
              { l: 'Users',    v: (p.max_users     ?? '∞') as string | number, ic: 'ri-user-3-line'       },
              { l: 'Storage',  v: p.storage_limit || '∞',                      ic: 'ri-hard-drive-2-line' },
              { l: 'Support',  v: p.support_level || '—',                      ic: 'ri-headphone-line'    },
            ];
            return (
              <SwiperSlide key={p.id}>
                <Card className={`plan-card-v2 ${p.is_featured ? 'is-featured' : ''}`}>
                  {/* ── Header: Title + Price + Subtitle ── */}
                  <div className="text-center">
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                      <h4 className="plan-title mb-0">{p.name}</h4>
                      {(isCurrent || p.is_featured) && (
                        <span className="plan-badge-pill" style={isCurrent ? { background: 'rgba(10,179,156,0.18)', color: '#0ab39c', borderColor: 'rgba(10,179,156,0.40)' } : undefined}>
                          {isCurrent ? '● Active' : (p.badge || 'Popular')}
                        </span>
                      )}
                    </div>
                    <div className="d-inline-flex align-items-baseline justify-content-center gap-1">
                      {p.price <= 0 ? (
                        <div className="plan-price">Free</div>
                      ) : (
                        <>
                          <div className="plan-price">
                            <span className="cur">₹</span>
                            {Math.round(price).toLocaleString()}
                          </div>
                          <span className="plan-price-period">/ {periodShort}</span>
                        </>
                      )}
                    </div>
                    {billingCycle === 'year' && p.yearly_discount && p.yearly_discount > 0 && (
                      <div className="mt-1" style={{ color: '#0ab39c', fontSize: 11, fontWeight: 700 }}>
                        Save {p.yearly_discount}% yearly
                      </div>
                    )}
                    {p.best_for && (
                      <p className="plan-subtitle mt-2 mb-0">{p.best_for}</p>
                    )}
                  </div>

                  {/* ── 2×2 Stat grid ── */}
                  <div className="row g-2 mt-3">
                    {stats.map(s => (
                      <div className="col-6" key={s.l}>
                        <div className="plan-stat-box">
                          <div className="plan-stat-icon">
                            <i className={s.ic} />
                          </div>
                          <div className="text-start min-w-0">
                            <div className="plan-stat-label">{s.l}</div>
                            <div className="plan-stat-value text-truncate" title={String(s.v)}>{s.v}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Included Modules section ── */}
                  <div className="mt-3 d-flex flex-column" style={{ flex: '1 1 0', minHeight: 0 }}>
                    {p.modules && p.modules.length > 0 && (
                      <div className="plan-modules-header">
                        <span className="plan-modules-title">
                          <i className="ri-stack-line" />
                          Included Modules
                        </span>
                        <span className="plan-modules-count-pill">{p.modules.length}</span>
                      </div>
                    )}
                    <ul className="plan-ticks text-start">
                      {(p.modules || []).map(m => (
                        <li key={m.id} title={m.name}>
                          <i className="ri-check-line" />
                          <span className="text-truncate flex-grow-1">
                            {m.name}
                            {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                              <span className="opacity-75 ms-1" style={{ fontSize: 10 }}>({m.pivot.access_level})</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ── CTA button ── */}
                  <div className="d-flex gap-2 pt-3 mt-auto">
                    <button
                      type="button"
                      onClick={() => openPayment(p)}
                      className="plan-cta"
                      disabled={isCurrent}
                      style={isCurrent ? { opacity: 0.65, cursor: 'not-allowed' } : undefined}
                    >
                      <span className="plan-cta-icon">
                        <i className={
                          isCurrent ? 'ri-check-line'
                            : p.price <= 0 ? 'ri-flashlight-line'
                            : p.trial_days && p.trial_days > 0 ? 'ri-play-circle-line'
                            : 'ri-arrow-right-line'
                        } style={{ fontSize: 14 }} />
                      </span>
                      <span className="plan-cta-label">
                        {isCurrent
                          ? 'Current Plan'
                          : p.price <= 0
                            ? 'Get Started'
                            : p.trial_days && p.trial_days > 0
                              ? `Start ${p.trial_days}-day Trial`
                              : 'Choose Plan'
                        }
                      </span>
                    </button>
                  </div>
                </Card>
              </SwiperSlide>
            );
          })}
          </Swiper>
          <button ref={nextRef} type="button" className="plans-nav-btn plans-nav-next" aria-label="Next">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
      )}

      {/* Payment Modal */}
      <Modal isOpen={paymentModal} toggle={() => !processing && setPaymentModal(false)} centered size="md" className="pay-modal">
        {/* Styles live in resources/css/app.css under the "Payment Modal" section */}

        {/* ── Premium Hero Header ── */}
        {selectedPlan && paymentStep !== 'success' && (
          <div className="pay-hero">
            <button
              type="button"
              className="pay-hero-close"
              onClick={() => !processing && setPaymentModal(false)}
              aria-label="Close"
            >
              <i className="ri-close-line" />
            </button>
            <div className="d-flex align-items-center gap-3 position-relative">
              <div className="pay-hero-icon d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0">
                <i className={selectedPlan.is_featured ? 'ri-vip-crown-2-fill' : 'ri-rocket-2-line'} />
              </div>
              <div className="flex-grow-1 min-w-0">
                <div className="pay-hero-label">Subscribe to</div>
                <h4 className="pay-hero-title mb-0 fw-bold">{selectedPlan.name} Plan</h4>
                <div className="pay-hero-meta d-flex align-items-center gap-2 mt-1">
                  <i className="ri-calendar-check-line" />
                  <span className="text-capitalize">{billingCycle}ly billing</span>
                  <span className="pay-hero-sep">·</span>
                  <span>₹{grandTotal.toLocaleString()} total</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {paymentStep === 'success' && (
          <ModalHeader toggle={() => !processing && setPaymentModal(false)} className="border-0 pb-0" />
        )}

        <ModalBody className="p-3">
          {paymentStep === 'select' && selectedPlan && (
            <>
              {/* ── Order Summary ── */}
              <div className="pay-summary mb-3">
                <div className="pay-summary-head d-flex align-items-center gap-2">
                  <i className="ri-file-list-3-line pay-section-label-icon text-vz-primary" />
                  <span className="pay-section-label text-uppercase fw-bold">Order Summary</span>
                </div>
                <div className="p-3">
                  <div className="pay-row d-flex justify-content-between mb-2">
                    <span className="text-muted">{selectedPlan.name} Plan <span className="text-capitalize">({billingCycle}ly)</span></span>
                    <span className="fw-semibold">₹{Math.round(total).toLocaleString()}</span>
                  </div>
                  <div className="pay-row-sm d-flex justify-content-between mb-2">
                    <span className="text-muted">GST (18%)</span>
                    <span className="text-muted">₹{gst.toLocaleString()}</span>
                  </div>
                  <div className="pay-total-row d-flex justify-content-between align-items-center pt-2">
                    <span className="pay-total-label fw-bold">Total</span>
                    <span className="pay-total-amount fw-bold">₹{grandTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* ── Payment method ── */}
              <div className="d-flex align-items-center gap-2 mb-2">
                <i className="ri-wallet-3-line pay-section-label-icon text-violet" />
                <span className="pay-section-label text-uppercase fw-bold">Payment Method</span>
              </div>
              <Row className="g-2 mb-3">
                {([
                  { id: 'upi',         label: 'UPI',         icon: 'ri-smartphone-line',  desc: 'GPay / PhonePe' },
                  { id: 'card',        label: 'Card',        icon: 'ri-bank-card-line',   desc: 'Credit / Debit' },
                  { id: 'net_banking', label: 'Net Banking', icon: 'ri-bank-line',        desc: 'Bank Transfer' },
                ] as const).map(m => (
                  <Col xs={4} key={m.id}>
                    <div
                      onClick={() => setPaymentMethod(m.id)}
                      className={`pay-method-tile ${paymentMethod === m.id ? 'active' : ''}`}
                      role="button"
                    >
                      <div className="pay-chip">
                        <i className={m.icon} />
                      </div>
                      <div className="pay-method-label fw-bold">{m.label}</div>
                      <div className="pay-method-desc text-muted">{m.desc}</div>
                    </div>
                  </Col>
                ))}
              </Row>

              {/* ── Payment input ── */}
              {paymentMethod === 'upi' && (
                <div>
                  <Label className="pay-form-label fw-semibold mb-1">
                    <i className="ri-at-line me-1" />UPI ID
                  </Label>
                  <Input className="pay-input" defaultValue="payment@ybl" placeholder="yourname@upi" />
                </div>
              )}
              {paymentMethod === 'card' && (
                <div>
                  <Label className="pay-form-label fw-semibold mb-1">
                    <i className="ri-bank-card-line me-1" />Card Number
                  </Label>
                  <Input className="pay-input-mono" defaultValue="4111 1111 1111 1111" placeholder="4111 1111 1111 1111" />
                  <Row className="g-2 mt-2">
                    <Col xs={6}>
                      <Label className="pay-form-label fw-semibold mb-1">
                        <i className="ri-calendar-line me-1" />Expiry
                      </Label>
                      <Input className="pay-input-mono" defaultValue="12/28" placeholder="MM/YY" />
                    </Col>
                    <Col xs={6}>
                      <Label className="pay-form-label fw-semibold mb-1">
                        <i className="ri-lock-2-line me-1" />CVV
                      </Label>
                      <Input className="pay-input-mono" type="password" defaultValue="123" placeholder="***" />
                    </Col>
                  </Row>
                </div>
              )}
              {paymentMethod === 'net_banking' && (
                <div className="pay-netbank-box d-flex align-items-center gap-2 p-3 rounded-2">
                  <i className="ri-bank-line pay-netbank-icon" />
                  <p className="pay-netbank-text mb-0">
                    You will be redirected to your bank's secure page to complete payment.
                  </p>
                </div>
              )}

              {/* ── Trust row ── */}
              <div className="pay-trust d-flex align-items-center gap-2 mt-3 px-3 py-2 rounded-pill">
                <i className="ri-shield-check-fill" />
                <span className="pay-trust-text">
                  Secured by <strong>Razorpay</strong> · 256-bit SSL encryption
                </span>
              </div>
            </>
          )}

          {paymentStep === 'processing' && (
            <div className="text-center py-5">
              <Spinner color="success" className="pay-processing-spinner" />
              <h5 className="pay-processing-title mt-3 mb-1 fw-bold">Processing Payment...</h5>
              <p className="pay-processing-desc text-muted mb-0">
                Securely processing your transaction. Please don't close this window.
              </p>
            </div>
          )}

          {paymentStep === 'success' && txnResult && (
            <div className="text-center">
              <div className="pay-success-icon mx-auto mb-3 d-inline-flex align-items-center justify-content-center rounded-circle">
                <i className="ri-check-line pay-success-check" />
              </div>
              <h4 className="pay-success-title mb-1 fw-bold">Payment Successful!</h4>
              <p className="pay-success-desc text-muted mb-3">
                Your <strong>{txnResult.plan}</strong> plan has been activated
              </p>
              <div className="pay-receipt text-start mx-auto">
                {[
                  { l: 'Transaction ID', v: txnResult.txn_id,                        mono: true,  valueClass: 'pay-value-muted'   },
                  { l: 'Amount Paid',    v: `₹${txnResult.total?.toLocaleString()}`, mono: false, valueClass: 'pay-value-success' },
                  { l: 'Plan',           v: txnResult.plan,                          mono: false, valueClass: 'pay-value-primary' },
                  { l: 'Valid Until',    v: txnResult.valid_until,                   mono: false, valueClass: 'pay-value-warning' },
                ].map((row) => (
                  <div key={row.l} className="pay-receipt-row d-flex justify-content-between align-items-center py-2">
                    <span className="text-muted">{row.l}</span>
                    <span className={`fw-bold ${row.valueClass} ${row.mono ? 'font-monospace' : ''}`}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ModalBody>
        {paymentStep === 'select' && (
          <ModalFooter className="border-0 pt-0">
            <Button
              color="light"
              className="pay-btn-cancel rounded-pill fw-semibold px-4"
              onClick={() => setPaymentModal(false)}
            >
              Cancel
            </Button>
            <Button
              className="pay-btn-pay rounded-pill pay-primary-btn px-4 text-white"
              onClick={handlePay}
            >
              <i className="ri-secure-payment-line me-1" />
              Pay ₹{grandTotal.toLocaleString()}
            </Button>
          </ModalFooter>
        )}
        {paymentStep === 'success' && (
          <ModalFooter className="border-0 pt-0">
            <Button
              className="pay-btn-dash w-100 rounded-pill fw-semibold pay-primary-btn text-white"
              onClick={() => { setPaymentModal(false); onSuccess(); }}
            >
              <i className="ri-flashlight-line me-1" />
              Go to Dashboard
            </Button>
          </ModalFooter>
        )}
      </Modal>
    </div>
  );
}
