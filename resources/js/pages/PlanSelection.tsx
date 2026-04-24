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
  const [darkTheme, setDarkTheme] = useState(false);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Watch the document for Velzon dark-theme toggle
  useEffect(() => {
    const check = () => {
      const html = document.documentElement;
      const mode = html.getAttribute('data-layout-mode') || html.getAttribute('data-bs-theme');
      setDarkTheme(mode === 'dark');
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout-mode', 'data-bs-theme'] });
    return () => observer.disconnect();
  }, []);

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
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await api.post('/subscription/subscribe', { plan_id: selectedPlan.id, payment_method: paymentMethod, billing_cycle: billingCycle }, { timeout: 60000 });
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

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  const hasPlan = user?.plan?.has_plan && !user?.plan?.expired;

  return (
    <>
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
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
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
          <div>
            <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>Choose Your Plan</h5>
            <p className="mb-0 text-muted" style={{ fontSize: 11.5 }}>
              Select the perfect plan to power your organization
            </p>
          </div>

          {/* Current plan pill — inline with header (right of title on wide, wraps on narrow) */}
          {hasPlan && (
            <span
              className="cp-current-pill d-inline-flex align-items-center gap-2 rounded-pill ms-md-2"
              style={{
                background: 'linear-gradient(135deg, rgba(10,179,156,0.18) 0%, rgba(10,179,156,0.10) 100%)',
                color: '#0ab39c',
                border: '1px solid #0ab39c',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.03em',
                padding: '4px 11px',
              }}
              title={`Valid until ${user?.plan?.expires_at}`}
            >
              <span
                className="rounded-circle"
                style={{
                  width: 7, height: 7,
                  background: '#0ab39c',
                  animation: 'cp-dot-pulse 1.4s ease-in-out infinite',
                  flexShrink: 0,
                }}
              />
              CURRENT: {user?.plan?.plan_name?.toUpperCase()}
              <span className="ms-1" style={{ opacity: 0.8 }}>· {user?.plan?.expires_at}</span>
            </span>
          )}
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
        <div className="plansel-swiper-outer">
          <button ref={prevRef} type="button" className="plansel-nav-btn plansel-nav-prev" aria-label="Previous">
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
            loop={plans.length > 3}
            autoplay={{ delay: 2000, disableOnInteraction: false, pauseOnMouseEnter: true }}
            breakpoints={{
              0:    { slidesPerView: 1, spaceBetween: 12 },
              576:  { slidesPerView: 2, spaceBetween: 14 },
              992:  { slidesPerView: 3, spaceBetween: 18 },
              1400: { slidesPerView: 4, spaceBetween: 20 },
            }}
            className="plansel-swiper"
          >
          {plans.map((p, idx) => {
            const price = getPrice(p, billingCycle);
            // Unified violet accent for all non-featured cards, gold for featured
            const accent = p.is_featured ? '#f7b84b' : '#7c5cfc';
            return (
              <SwiperSlide key={p.id} style={{ height: 'auto', display: 'flex' }}>
                {(() => {
                  const isCurrent = hasPlan
                    && user?.plan?.plan_name?.toLowerCase() === p.name.toLowerCase();
                  const isDark = p.is_featured;
                  const textMain = (isDark || darkTheme) ? 'rgba(255,255,255,0.95)' : 'var(--vz-heading-color, var(--vz-body-color))';
                  const textMuted = (isDark || darkTheme) ? 'rgba(255,255,255,0.72)' : 'var(--vz-secondary-color)';
                  const dividerColor = (isDark || darkTheme) ? 'rgba(255,255,255,0.12)' : 'var(--vz-border-color)';
                  const bgBase = isDark
                    ? `
                      linear-gradient(135deg, rgba(247,184,75,0.10) 0%, transparent 55%),
                      linear-gradient(225deg, rgba(102,145,231,0.14) 0%, transparent 55%),
                      linear-gradient(160deg, #0b1324 0%, #1a2545 60%, #2d4373 100%)
                    `
                    : darkTheme
                      ? `linear-gradient(135deg, ${accent}14 0%, transparent 60%), var(--vz-card-bg)`
                      : 'var(--vz-card-bg)';

                  return (
                    <Card
                      className="w-100 mb-0"
                      style={{
                        height: 560,
                        borderRadius: 20,
                        border: isDark ? `1px solid ${accent}88` : `1px solid ${accent}30`,
                        background: bgBase,
                        boxShadow: isDark
                          ? `
                            0 20px 50px ${accent}38,
                            0 12px 28px rgba(0,0,0,0.20),
                            0 4px 10px rgba(0,0,0,0.10),
                            inset 0 1px 0 rgba(255,255,255,0.06)
                          `
                          : darkTheme
                            ? `
                              0 14px 38px ${accent}30,
                              0 6px 14px rgba(0,0,0,0.28),
                              0 2px 6px rgba(0,0,0,0.16),
                              inset 0 1px 0 rgba(255,255,255,0.05)
                            `
                            : `
                              0 12px 32px ${accent}22,
                              0 6px 14px rgba(15, 23, 42, 0.08),
                              0 2px 6px rgba(15, 23, 42, 0.04),
                              inset 0 1px 0 rgba(255,255,255,0.85)
                            `,
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'transform .28s cubic-bezier(0.4, 0, 0.2, 1), box-shadow .28s ease, border-color .22s ease',
                        cursor: 'default',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.transform = 'translateY(-8px)';
                        el.style.boxShadow = isDark
                          ? `
                            0 32px 70px ${accent}55,
                            0 16px 36px rgba(0,0,0,0.28),
                            0 6px 14px rgba(0,0,0,0.14),
                            inset 0 1px 0 rgba(255,255,255,0.10)
                          `
                          : darkTheme
                            ? `
                              0 26px 60px ${accent}50,
                              0 12px 28px rgba(0,0,0,0.40),
                              0 4px 10px rgba(0,0,0,0.20),
                              inset 0 1px 0 rgba(255,255,255,0.08)
                            `
                            : `
                              0 24px 54px ${accent}40,
                              0 12px 26px rgba(15, 23, 42, 0.12),
                              0 4px 10px rgba(15, 23, 42, 0.06),
                              inset 0 1px 0 rgba(255,255,255,0.95)
                            `;
                        if (!isDark) el.style.borderColor = accent + '70';
                        const shine = el.querySelector<HTMLDivElement>('.plan-shine-overlay');
                        if (shine) {
                          shine.style.animation = 'none';
                          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                          void shine.offsetWidth;
                          shine.style.animation = 'plan-shine-sweep 2.2s ease-out 1 forwards';
                        }
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.transform = 'translateY(0)';
                        el.style.boxShadow = isDark
                          ? `
                            0 20px 50px ${accent}38,
                            0 12px 28px rgba(0,0,0,0.20),
                            0 4px 10px rgba(0,0,0,0.10),
                            inset 0 1px 0 rgba(255,255,255,0.06)
                          `
                          : darkTheme
                            ? `
                              0 14px 38px ${accent}30,
                              0 6px 14px rgba(0,0,0,0.28),
                              0 2px 6px rgba(0,0,0,0.16),
                              inset 0 1px 0 rgba(255,255,255,0.05)
                            `
                            : `
                              0 12px 32px ${accent}22,
                              0 6px 14px rgba(15, 23, 42, 0.08),
                              0 2px 6px rgba(15, 23, 42, 0.04),
                              inset 0 1px 0 rgba(255,255,255,0.85)
                            `;
                        if (!isDark) el.style.borderColor = accent + '30';
                      }}
                    >
                      {/* ── Corner badge (Active / Popular / Save %) ── */}
                      {(isCurrent || p.is_featured) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 14, right: 14,
                            zIndex: 4,
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: 9.5,
                            fontWeight: 800,
                            letterSpacing: '0.08em',
                            background: isCurrent ? '#0ab39c' : accent,
                            color: isCurrent ? '#fff' : (isDark ? '#0b1324' : '#fff'),
                            boxShadow: `0 4px 12px ${isCurrent ? '#0ab39c' : accent}55`,
                            textTransform: 'uppercase',
                          }}
                        >
                          {isCurrent ? '● Active' : (p.badge || 'Popular')}
                        </div>
                      )}

                      {/* ── Diagonal shine sweep overlay (slow, once on mount + once on hover) ── */}
                      <div
                        className="plan-shine-overlay"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '55%',
                          height: '100%',
                          background: isDark
                            ? 'linear-gradient(100deg, transparent 15%, rgba(255,255,255,0.14) 50%, transparent 85%)'
                            : `linear-gradient(100deg, transparent 15%, ${accent}20 50%, transparent 85%)`,
                          transform: 'translateX(-120%) skewX(-20deg)',
                          opacity: 0,
                          pointerEvents: 'none',
                          zIndex: 3,
                          animation: `plan-shine-sweep 2.6s ease-out ${0.6 + idx * 0.35}s 1 forwards`,
                        }}
                      />

                      {/* ── Soft corner glow (featured only) ── */}
                      {isDark && (
                        <>
                          <div
                            style={{
                              position: 'absolute',
                              top: -80, right: -80,
                              width: 220, height: 220,
                              borderRadius: '50%',
                              background: `radial-gradient(circle, ${accent}26 0%, transparent 70%)`,
                              pointerEvents: 'none',
                              zIndex: 0,
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              bottom: -80, left: -80,
                              width: 200, height: 200,
                              borderRadius: '50%',
                              background: `radial-gradient(circle, #6691e722 0%, transparent 70%)`,
                              pointerEvents: 'none',
                              zIndex: 0,
                            }}
                          />
                        </>
                      )}

                      <CardBody
                        className="px-3 py-3 d-flex flex-column position-relative text-center"
                        style={{ minHeight: 0, zIndex: 2 }}
                      >
                        {/* ── Plan name ── */}
                        <h5
                          className="mb-2 fw-bold"
                          style={{ color: textMain, fontSize: 16, letterSpacing: '-0.01em' }}
                        >
                          {p.name}
                        </h5>

                        {/* ── Price — colored per accent ── */}
                        <div className="mb-2">
                          {p.price <= 0 ? (
                            <div
                              className="fw-bold lh-1"
                              style={{
                                fontSize: 30,
                                color: accent,
                                letterSpacing: '-0.02em',
                                display: 'inline-block',
                              }}
                            >
                              Free
                            </div>
                          ) : (
                            <div className="d-inline-flex align-items-baseline justify-content-center gap-1">
                              <small style={{ fontSize: 14, color: accent, fontWeight: 600, opacity: 0.75 }}>₹</small>
                              <span
                                className="fw-bold lh-1"
                                style={{ fontSize: 30, color: accent, letterSpacing: '-0.02em' }}
                              >
                                {Math.round(price).toLocaleString()}
                              </span>
                              <small style={{ fontSize: 11, color: textMuted, fontWeight: 500 }}>
                                / {billingCycle === 'month' ? 'mo' : billingCycle === 'quarter' ? 'qtr' : 'yr'}
                              </small>
                            </div>
                          )}
                          {billingCycle === 'year' && p.yearly_discount && p.yearly_discount > 0 && (
                            <div className="mt-1" style={{ color: '#0ab39c', fontSize: 11, fontWeight: 600 }}>
                              Save {p.yearly_discount}% yearly
                            </div>
                          )}
                        </div>

                        {/* ── Description ── */}
                        {p.best_for && (
                          <p
                            className="mb-3"
                            style={{
                              color: textMuted,
                              fontSize: 11,
                              lineHeight: 1.4,
                              minHeight: 26,
                            }}
                          >
                            {p.best_for}
                          </p>
                        )}

                        {/* ── Stat boxes 2×2 — stylish cross gradient with glossy top ── */}
                        <Row className="gx-2 gy-2 mb-3">
                          {[
                            { icon: 'ri-git-branch-line',         label: 'Branches', val: p.max_branches  ?? '∞' },
                            { icon: 'ri-user-3-line',             label: 'Users',    val: p.max_users     ?? '∞' },
                            { icon: 'ri-hard-drive-2-line',       label: 'Storage',  val: p.storage_limit || '—' },
                            { icon: 'ri-customer-service-2-line', label: 'Support',  val: p.support_level || '—' },
                          ].map(l => (
                            <Col xs={6} key={l.label}>
                              <div
                                className="rounded-2 d-flex align-items-center gap-2 px-2 py-2"
                                style={{
                                  background: (isDark || darkTheme) ? 'rgba(255,255,255,0.03)' : '#fff',
                                  border: (isDark || darkTheme) ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--vz-border-color)',
                                  boxShadow: (isDark || darkTheme)
                                    ? '0 1px 2px rgba(0,0,0,0.35)'
                                    : '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.04)',
                                  transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
                                }}
                                onMouseEnter={e => {
                                  const el = e.currentTarget as HTMLDivElement;
                                  el.style.transform = 'translateY(-2px)';
                                  el.style.boxShadow = (isDark || darkTheme)
                                    ? `0 6px 16px rgba(0,0,0,0.5), 0 0 0 1px ${accent}55`
                                    : `0 6px 14px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.05)`;
                                  el.style.borderColor = accent + '55';
                                }}
                                onMouseLeave={e => {
                                  const el = e.currentTarget as HTMLDivElement;
                                  el.style.transform = 'translateY(0)';
                                  el.style.boxShadow = (isDark || darkTheme)
                                    ? '0 1px 2px rgba(0,0,0,0.35)'
                                    : '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.04)';
                                  el.style.borderColor = (isDark || darkTheme) ? 'rgba(255,255,255,0.08)' : 'var(--vz-border-color)';
                                }}
                              >
                                <span
                                  className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                                  style={{
                                    width: 28, height: 28,
                                    background: accent + (isDark || darkTheme ? '20' : '15'),
                                    color: accent,
                                  }}
                                >
                                  <i className={l.icon} style={{ fontSize: 14 }} />
                                </span>
                                <div className="text-start min-w-0 flex-grow-1">
                                  <div
                                    className="text-uppercase fw-semibold"
                                    style={{ fontSize: 8.5, color: textMuted, letterSpacing: '0.07em', lineHeight: 1.2 }}
                                  >
                                    {l.label}
                                  </div>
                                  <div
                                    className="fw-bold text-truncate"
                                    style={{ fontSize: 12.5, color: textMain, lineHeight: 1.25, marginTop: 1 }}
                                  >
                                    {l.val}
                                  </div>
                                </div>
                              </div>
                            </Col>
                          ))}
                        </Row>

                        {/* ── Divider ── */}
                        <div style={{ height: 1, background: dividerColor, margin: '0 -4px 12px' }} />

                        {/* ── Included modules header ── */}
                        {p.modules && p.modules.length > 0 && (
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <span
                              className="text-uppercase fw-bold"
                              style={{ fontSize: 9, letterSpacing: '0.08em', color: textMuted }}
                            >
                              Included Modules
                            </span>
                            <span
                              className="rounded-pill px-2 fw-bold"
                              style={{
                                fontSize: 9.5,
                                background: accent + '20',
                                color: accent,
                                border: `1px solid ${accent}45`,
                                padding: '2px 7px',
                              }}
                            >
                              {p.modules.length}
                            </span>
                          </div>
                        )}
                        <ul
                          className={`list-unstyled vstack gap-1 mb-0 pe-1 text-start plan-modules-scroll ${isDark ? 'plan-scroll-dark' : ''}`}
                          style={{
                            overflowY: 'auto',
                            flex: '1 1 auto',
                            minHeight: 0,
                          }}
                        >
                          {(p.modules || []).map(m => (
                            <li key={m.id} className="d-flex align-items-center gap-2" title={m.name}>
                              <i
                                className="ri-check-line flex-shrink-0"
                                style={{
                                  color: m.pivot?.access_level === 'limited' ? '#f7b84b' : '#0ab39c',
                                  fontSize: 13,
                                  fontWeight: 700,
                                }}
                              />
                              <span className="text-truncate flex-grow-1" style={{ color: textMain, fontSize: 10.5 }}>
                                {m.name}
                                {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                                  <span className="text-muted ms-1" style={{ fontSize: 10 }}>
                                    ({m.pivot.access_level})
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>

                        {/* ── Trial hint + CTA — pinned to bottom ── */}
                        <div className="mt-auto pt-3">
                          <button
                            type="button"
                            onClick={() => openPayment(p)}
                            className="btn w-100 rounded-pill fw-semibold d-inline-flex align-items-center justify-content-center gap-1"
                            style={{
                              padding: '10px 20px',
                              fontSize: 13,
                              background: isDark ? accent : 'transparent',
                              color: isDark ? '#0b1324' : accent,
                              border: isDark ? 'none' : `1.5px solid ${accent}`,
                              boxShadow: isDark ? `0 6px 18px ${accent}55` : 'none',
                              transition: 'all .18s ease',
                            }}
                            onMouseEnter={e => {
                              const el = e.currentTarget;
                              if (!isDark) {
                                el.style.background = accent;
                                el.style.color = '#fff';
                              } else {
                                el.style.boxShadow = `0 10px 24px ${accent}88`;
                              }
                            }}
                            onMouseLeave={e => {
                              const el = e.currentTarget;
                              if (!isDark) {
                                el.style.background = 'transparent';
                                el.style.color = accent;
                              } else {
                                el.style.boxShadow = `0 6px 18px ${accent}55`;
                              }
                            }}
                          >
                            {p.price <= 0
                              ? <><i className="ri-flashlight-line" /> Get Started</>
                              : p.trial_days && p.trial_days > 0
                                ? <><i className="ri-play-circle-line" /> Start {p.trial_days}-days Free Trial</>
                                : <><i className="ri-arrow-right-line" /> Choose Plan</>
                            }
                          </button>
                        </div>
                      </CardBody>
                    </Card>
                  );
                })()}
              </SwiperSlide>
            );
          })}
          </Swiper>
          <button ref={nextRef} type="button" className="plansel-nav-btn plansel-nav-next" aria-label="Next">
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
    </>
  );
}
