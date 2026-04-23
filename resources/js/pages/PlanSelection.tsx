import { useState, useEffect } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Label, Spinner,
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

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
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
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
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Current plan chip — animated pulse + shimmer */}
          {hasPlan && (
            <>
              <style>{`
                @keyframes cp-pulse {
                  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(10,179,156,0.55), 0 0 6px #0ab39c; }
                  70%     { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(10,179,156,0), 0 0 10px #0ab39c; }
                }
                @keyframes cp-shimmer {
                  0%   { transform: translateX(-120%); }
                  60%  { transform: translateX(220%); }
                  100% { transform: translateX(220%); }
                }
                .cp-badge { position: relative; overflow: hidden; }
                .cp-badge::after {
                  content: '';
                  position: absolute;
                  top: 0; left: 0;
                  width: 35%; height: 100%;
                  background: linear-gradient(90deg, transparent, rgba(10,179,156,0.35), transparent);
                  animation: cp-shimmer 3.2s ease-in-out infinite;
                  pointer-events: none;
                }
              `}</style>
              <span
                className="cp-badge d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1 fw-semibold"
                style={{
                  background: '#0ab39c15',
                  color: '#0ab39c',
                  border: '1px solid #0ab39c40',
                  fontSize: 10.5,
                  letterSpacing: '0.04em',
                }}
                title={`Valid until ${user?.plan?.expires_at}`}
              >
                <span
                  className="rounded-circle"
                  style={{
                    width: 6, height: 6,
                    background: '#0ab39c',
                    animation: 'cp-pulse 1.8s ease-in-out infinite',
                  }}
                />
                CURRENT: {user?.plan?.plan_name?.toUpperCase()}
                <span className="text-muted fw-normal ms-1" style={{ opacity: 0.75 }}>· {user?.plan?.expires_at}</span>
              </span>
            </>
          )}

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
      <style>{`
        @keyframes bc-shine {
          0%   { transform: translateX(-120%) skewX(-20deg); }
          100% { transform: translateX(260%) skewX(-20deg); }
        }
        @keyframes bc-save-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(10,179,156,0.45), 0 1px 4px rgba(10,179,156,0.35); }
          60%      { box-shadow: 0 0 0 5px rgba(10,179,156,0),     0 1px 4px rgba(10,179,156,0.50); }
        }
        .bc-btn-active {
          background: linear-gradient(135deg, #405189 0%, #4a63a8 45%, #6691e7 100%) !important;
          position: relative;
          overflow: hidden;
        }
        .bc-btn-active::before {
          content: '';
          position: absolute;
          inset: 1px 1px auto 1px;
          height: 48%;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(255,255,255,0.30), rgba(255,255,255,0));
          pointer-events: none;
          z-index: 0;
        }
        .bc-btn-active::after {
          content: '';
          position: absolute;
          top: 0; left: 0;
          width: 42%; height: 100%;
          background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.38) 50%, transparent 80%);
          transform: translateX(-120%) skewX(-20deg);
          animation: bc-shine 3.4s ease-in-out infinite;
          animation-delay: 1s;
          pointer-events: none;
          z-index: 0;
        }
        .bc-save-badge { animation: bc-save-pulse 2s ease-in-out infinite; }
      `}</style>
      <div className="d-flex justify-content-center mb-6">
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

      {/* Shine animation keyframes — shared across all cards */}
      <style>{`
        @keyframes plan-shine-sweep {
          0%   { transform: translateX(-120%) skewX(-20deg); opacity: 0; }
          8%   { opacity: 1; }
          35%  { transform: translateX(320%) skewX(-20deg); opacity: 0; }
          100% { transform: translateX(320%) skewX(-20deg); opacity: 0; }
        }
      `}</style>

      {plans.length === 0 ? (
        <Card><CardBody className="text-center py-5">
          <i className="ri-bank-card-line display-4 text-muted"></i>
          <p className="text-muted mt-3">No plans available. Contact administrator.</p>
        </CardBody></Card>
      ) : (
        <Row className="g-3">
          {plans.map((p, idx) => {
            const price = getPrice(p, billingCycle);
            // Per-plan accent color — featured gets gold, rest cycle through premium palette
            const PLAN_ACCENTS = ['#405189', '#0ab39c', '#299cdb', '#7c5cfc', '#e83e8c', '#f06548'];
            const accent = p.is_featured ? '#f7b84b' : PLAN_ACCENTS[idx % PLAN_ACCENTS.length];
            return (
              <Col xl={3} lg={4} md={6} key={p.id} className="d-flex">
                {(() => {
                  const isCurrent = hasPlan
                    && user?.plan?.plan_name?.toLowerCase() === p.name.toLowerCase();
                  const isDark = p.is_featured;
                  const textMain = isDark ? '#fff' : 'var(--vz-heading-color, var(--vz-body-color))';
                  const textMuted = isDark ? 'rgba(255,255,255,0.65)' : 'var(--vz-secondary-color)';
                  const dividerColor = isDark ? 'rgba(255,255,255,0.12)' : 'var(--vz-border-color)';
                  const bgBase = isDark
                    ? 'linear-gradient(160deg, #0b1324 0%, #1a2545 60%, #2d4373 100%)'
                    : `linear-gradient(160deg, ${accent}0a 0%, var(--vz-card-bg) 45%)`;

                  return (
                    <Card
                      className="w-100 mb-0"
                      style={{
                        height: 560,
                        borderRadius: 20,
                        border: isDark ? `1px solid ${accent}88` : '1px solid var(--vz-border-color)',
                        background: bgBase,
                        boxShadow: isDark
                          ? `0 14px 36px ${accent}38, 0 4px 12px rgba(0,0,0,0.12)`
                          : '0 4px 14px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'transform .25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow .25s ease, border-color .22s ease',
                        cursor: 'default',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.transform = 'translateY(-6px)';
                        el.style.boxShadow = isDark
                          ? `0 22px 50px ${accent}55, 0 6px 16px rgba(0,0,0,0.18)`
                          : `0 16px 34px ${accent}30, 0 4px 10px rgba(15, 23, 42, 0.08)`;
                        if (!isDark) el.style.borderColor = accent + '66';
                        // Trigger a slow single shine sweep on hover
                        const shine = el.querySelector<HTMLDivElement>('.plan-shine-overlay');
                        if (shine) {
                          shine.style.animation = 'none';
                          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                          void shine.offsetWidth; // restart animation
                          shine.style.animation = 'plan-shine-sweep 2.2s ease-out 1 forwards';
                        }
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLDivElement;
                        el.style.transform = 'translateY(0)';
                        el.style.boxShadow = isDark
                          ? `0 14px 36px ${accent}38, 0 4px 12px rgba(0,0,0,0.12)`
                          : '0 4px 14px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)';
                        if (!isDark) el.style.borderColor = 'var(--vz-border-color)';
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
                        <h4
                          className="mb-2 fw-bold"
                          style={{ color: textMain, fontSize: 19, letterSpacing: '-0.01em' }}
                        >
                          {p.name}
                        </h4>

                        {/* ── Price ── */}
                        <div className="mb-2">
                          {p.price <= 0 ? (
                            <div
                              className="fw-bold lh-1"
                              style={{
                                fontSize: 44,
                                background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                display: 'inline-block',
                                letterSpacing: '-0.02em',
                              }}
                            >
                              Free
                            </div>
                          ) : (
                            <>
                              <span
                                className="fw-bold lh-1"
                                style={{
                                  fontSize: 44,
                                  color: isDark ? accent : textMain,
                                  letterSpacing: '-0.02em',
                                }}
                              >
                                <small style={{ fontSize: 20, opacity: 0.6, fontWeight: 500 }}>₹</small>
                                {Math.round(price).toLocaleString()}
                              </span>
                              <div style={{ color: textMuted, fontSize: 12, marginTop: 4 }}>
                                / {billingCycle === 'month' ? 'month' : billingCycle === 'quarter' ? 'quarter' : 'year'} (INR)
                              </div>
                            </>
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
                              fontSize: 11.5,
                              lineHeight: 1.5,
                              minHeight: 34,
                            }}
                          >
                            {p.best_for}
                          </p>
                        )}

                        {/* ── Stat boxes 2×2 — dark/light aware ── */}
                        <Row className="gx-2 gy-2 mb-3">
                          {[
                            { icon: 'ri-git-branch-line',         label: 'Branches', val: p.max_branches  ?? '∞' },
                            { icon: 'ri-user-3-line',             label: 'Users',    val: p.max_users     ?? '∞' },
                            { icon: 'ri-hard-drive-2-line',       label: 'Storage',  val: p.storage_limit || '—' },
                            { icon: 'ri-customer-service-2-line', label: 'Support',  val: p.support_level || '—' },
                          ].map(l => (
                            <Col xs={6} key={l.label}>
                              <div
                                className="rounded-3 p-2 text-center"
                                style={{
                                  background: isDark ? 'rgba(255,255,255,0.06)' : 'var(--vz-secondary-bg)',
                                  border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid var(--vz-border-color)',
                                  transition: 'background .18s ease, border-color .18s ease',
                                }}
                              >
                                <div
                                  className="d-inline-flex align-items-center justify-content-center rounded-2 mb-1"
                                  style={{
                                    width: 24, height: 24,
                                    background: accent + (isDark ? '28' : '15'),
                                    border: `1px solid ${accent}${isDark ? '45' : '30'}`,
                                  }}
                                >
                                  <i className={l.icon} style={{ color: accent, fontSize: 12 }} />
                                </div>
                                <div
                                  className="text-uppercase fw-semibold"
                                  style={{
                                    fontSize: 9.5,
                                    color: textMuted,
                                    letterSpacing: '0.05em',
                                    lineHeight: 1.2,
                                    marginBottom: 2,
                                  }}
                                >
                                  {l.label}
                                </div>
                                <div
                                  className="fw-bold text-truncate"
                                  style={{
                                    fontSize: 13,
                                    color: textMain,
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {l.val}
                                </div>
                              </div>
                            </Col>
                          ))}
                        </Row>

                        {/* ── Divider ── */}
                        <div style={{ height: 1, background: dividerColor, margin: '0 -4px 12px' }} />

                        {/* ── Modules list — scrollable ── */}
                        {p.modules && p.modules.length > 0 && (
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <span
                              className="text-uppercase fw-bold"
                              style={{ fontSize: 9.5, letterSpacing: '0.06em', color: textMuted }}
                            >
                              Modules
                            </span>
                            <span
                              className="rounded-pill px-2 fw-bold"
                              style={{
                                fontSize: 10,
                                background: '#0ab39c20',
                                color: '#0ab39c',
                                border: '1px solid #0ab39c40',
                              }}
                            >
                              {p.modules.length}
                            </span>
                          </div>
                        )}
                        <ul
                          className="list-unstyled vstack gap-2 mb-0 pe-1 text-start"
                          style={{
                            overflowY: 'auto',
                            flex: '1 1 auto',
                            minHeight: 0,
                            scrollbarWidth: 'thin',
                          }}
                        >
                          {(p.modules || []).map(m => (
                            <li key={m.id} className="d-flex align-items-center gap-2">
                              <span
                                className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                style={{
                                  width: 18, height: 18,
                                  background: m.pivot?.access_level === 'limited' ? '#f7b84b' : '#0ab39c',
                                  boxShadow: `0 2px 6px ${m.pivot?.access_level === 'limited' ? 'rgba(247,184,75,0.30)' : 'rgba(10,179,156,0.30)'}`,
                                }}
                              >
                                <i className="ri-check-line" style={{ color: '#fff', fontSize: 11, fontWeight: 700 }} />
                              </span>
                              <span style={{ color: textMain, fontSize: 12.5 }} className="text-truncate flex-grow-1">
                                {m.name}
                              </span>
                              {m.pivot?.access_level === 'limited' && (
                                <span
                                  className="badge rounded-pill flex-shrink-0"
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    background: '#f7b84b22',
                                    color: '#f7b84b',
                                    border: '1px solid #f7b84b40',
                                    padding: '2px 6px',
                                  }}
                                >
                                  Limited
                                </span>
                              )}
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
              </Col>
            );
          })}
        </Row>
      )}

      {/* Payment Modal */}
      <Modal isOpen={paymentModal} toggle={() => !processing && setPaymentModal(false)} centered size="md">
        <ModalHeader toggle={() => !processing && setPaymentModal(false)}>
          {paymentStep === 'success' ? 'Payment Successful' : `Subscribe to ${selectedPlan?.name}`}
        </ModalHeader>
        <ModalBody>
          {paymentStep === 'select' && selectedPlan && (
            <>
              {/* Order summary */}
              <Card className="mb-3">
                <CardHeader className="bg-light"><h6 className="mb-0 text-uppercase fs-12">Order Summary</h6></CardHeader>
                <CardBody>
                  <div className="d-flex justify-content-between mb-1">
                    <span className="text-muted">{selectedPlan.name} Plan ({billingCycle}ly)</span>
                    <span className="fw-bold">₹{Math.round(total).toLocaleString()}</span>
                  </div>
                  <div className="d-flex justify-content-between mb-2 fs-13">
                    <span className="text-muted">GST (18%)</span>
                    <span className="text-muted">₹{gst.toLocaleString()}</span>
                  </div>
                  <div className="d-flex justify-content-between border-top pt-2">
                    <strong>Total</strong>
                    <strong className="text-success fs-15">₹{grandTotal.toLocaleString()}</strong>
                  </div>
                </CardBody>
              </Card>

              {/* Payment method */}
              <Label>Payment Method</Label>
              <Row className="g-2 mb-3">
                {([
                  { id: 'upi',         label: 'UPI',         icon: 'ri-smartphone-line',  desc: 'Google Pay / PhonePe' },
                  { id: 'card',        label: 'Card',        icon: 'ri-bank-card-line',   desc: 'Credit / Debit' },
                  { id: 'net_banking', label: 'Net Banking', icon: 'ri-bank-line',        desc: 'Bank Transfer' },
                ] as const).map(m => (
                  <Col xs={4} key={m.id}>
                    <div
                      onClick={() => setPaymentMethod(m.id)}
                      className={`p-3 rounded border-2 text-center cursor-pointer ${paymentMethod === m.id ? 'border-primary bg-primary bg-opacity-10' : 'border-light'}`}
                      role="button"
                    >
                      <i className={`${m.icon} fs-4 ${paymentMethod === m.id ? 'text-primary' : 'text-muted'}`}></i>
                      <div className="fw-bold fs-13 mt-1">{m.label}</div>
                      <div className="text-muted fs-11">{m.desc}</div>
                    </div>
                  </Col>
                ))}
              </Row>

              {paymentMethod === 'upi' && (
                <>
                  <Label>UPI ID</Label>
                  <Input defaultValue="payment@ybl" placeholder="yourname@upi" />
                </>
              )}
              {paymentMethod === 'card' && (
                <>
                  <Label>Card Number</Label>
                  <Input defaultValue="4111 1111 1111 1111" placeholder="4111 1111 1111 1111" />
                  <Row className="g-2 mt-2">
                    <Col xs={6}><Label>Expiry</Label><Input defaultValue="12/28" placeholder="MM/YY" /></Col>
                    <Col xs={6}><Label>CVV</Label><Input type="password" defaultValue="123" placeholder="***" /></Col>
                  </Row>
                </>
              )}
              {paymentMethod === 'net_banking' && (
                <div
                  className="text-center p-3 rounded-2"
                  style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)' }}
                >
                  <i className="ri-bank-line fs-2 text-muted"></i>
                  <p className="mb-0 fs-13 text-muted mt-1">You will be redirected to your bank's secure page</p>
                </div>
              )}

              <div className="text-muted fs-11 mt-3">
                <i className="ri-shield-check-line me-1"></i>Secured by Razorpay · 256-bit SSL encryption
              </div>
            </>
          )}

          {paymentStep === 'processing' && (
            <div className="text-center py-5">
              <Spinner color="primary" style={{ width: 48, height: 48 }} />
              <h5 className="mt-3 mb-1">Processing Payment...</h5>
              <p className="text-muted mb-0">Please wait while we process your payment</p>
            </div>
          )}

          {paymentStep === 'success' && txnResult && (
            <div className="text-center">
              <div className="avatar-lg mx-auto mb-3">
                <div className="avatar-title rounded-circle bg-success-subtle text-success fs-1">
                  <i className="ri-checkbox-circle-line"></i>
                </div>
              </div>
              <h3 className="mb-1">Payment Successful!</h3>
              <p className="text-muted mb-3">{txnResult.plan} plan has been activated</p>
              <Card className="text-start mb-0">
                <CardBody>
                  {[
                    ['Transaction ID', txnResult.txn_id],
                    ['Amount Paid', `₹${txnResult.total?.toLocaleString()}`],
                    ['Plan', txnResult.plan],
                    ['Valid Until', txnResult.valid_until],
                  ].map(([l, v]) => (
                    <div key={l} className="d-flex justify-content-between fs-13 py-1">
                      <span className="text-muted">{l}</span>
                      <span className="fw-bold">{v}</span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}
        </ModalBody>
        {paymentStep === 'select' && (
          <ModalFooter>
            <Button color="light" onClick={() => setPaymentModal(false)}>Cancel</Button>
            <Button color="success" onClick={handlePay}>
              <i className="ri-money-rupee-circle-line me-1"></i> Pay ₹{grandTotal.toLocaleString()}
            </Button>
          </ModalFooter>
        )}
        {paymentStep === 'success' && (
          <ModalFooter>
            <Button color="primary" className="w-100" onClick={() => { setPaymentModal(false); onSuccess(); }}>
              <i className="ri-flashlight-line me-1"></i> Go to Dashboard
            </Button>
          </ModalFooter>
        )}
      </Modal>
    </>
  );
}
