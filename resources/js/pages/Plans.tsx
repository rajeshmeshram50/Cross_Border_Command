import { useState, useEffect, useRef } from 'react';
import { Card, CardBody, Col, Row, Badge, Button, Spinner, Modal, ModalBody } from 'reactstrap';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Autoplay } from 'swiper/modules';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import Swal from 'sweetalert2';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

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

const accessColors: Record<string, string> = {
  limited: 'warning',
  read: 'info',
  write: 'primary',
  full: 'success',
};

const SWIPER_STYLES = `
  .plans-surface { background: #ffffff; }
  [data-bs-theme="dark"] .plans-surface { background: #1c2531; }

  /* Give the swiper breathing space above/below the cards so hover-lift
     (translateY) and drop-shadow are NOT clipped by the swiper's own
     overflow:hidden. */
  .plans-swiper {
    padding-top: 16px !important;
    padding-bottom: 36px !important;
  }

  .plans-swiper-outer {
    position: relative;
    padding: 0 56px;
  }
  .plans-nav-btn {
    position: absolute;
    top: calc(50% - 24px);
    transform: translateY(-50%);
    z-index: 10;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid var(--vz-border-color);
    background: var(--vz-card-bg, #fff);
    color: var(--vz-primary);
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(0,0,0,0.10);
    transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s;
    outline: none;
  }
  .plans-nav-btn:hover:not(:disabled) {
    background: var(--vz-primary);
    color: #fff;
    border-color: var(--vz-primary);
    box-shadow: 0 6px 24px rgba(64,81,137,0.35);
    transform: translateY(-50%) scale(1.1);
  }
  .plans-nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .plans-nav-prev { left: 0; }
  .plans-nav-next { right: 0; }
  [data-layout-mode="dark"] .plans-nav-btn,
  [data-bs-theme="dark"] .plans-nav-btn {
    background: var(--vz-card-bg);
    border-color: var(--vz-border-color);
    box-shadow: 0 4px 18px rgba(0,0,0,0.35);
  }
`;

export default function Plans({ onNavigate }: { onNavigate?: (page: string, data?: any) => void }) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const fetchPlans = () => {
    setLoading(true);
    api.get('/plans').then(res => setPlans(res.data || []))
      .catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, []);

  const handleDelete = async (plan: Plan) => {
    const result = await Swal.fire({
      title: 'Delete Plan?',
      html: `Delete <strong>"${plan.name}"</strong> plan? This cannot be undone.`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Delete', confirmButtonColor: '#f06548', cancelButtonColor: '#878a99',
    });
    if (!result.isConfirmed) return;
    setDeleting(plan.id);
    try {
      await api.delete(`/plans/${plan.id}`);
      Swal.fire({ title: 'Deleted!', text: `"${plan.name}" has been removed.`, icon: 'success', timer: 1800, showConfirmButton: false });
      fetchPlans();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot delete plan');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <style>{SWIPER_STYLES}</style>
      {/* Shine animation keyframes — shared across all cards */}
      <style>{`
        @keyframes plan-shine-sweep {
          0%   { transform: translateX(-120%) skewX(-20deg); opacity: 0; }
          8%   { opacity: 1; }
          35%  { transform: translateX(320%) skewX(-20deg); opacity: 0; }
          100% { transform: translateX(320%) skewX(-20deg); opacity: 0; }
        }
      `}</style>

      <div
        className="plans-surface"
        style={{
          borderRadius: 16,
          border: '1px solid var(--vz-border-color)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          padding: '20px',
        }}
      >
        {/* ── Compact Page Header ── */}
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3 pb-2">
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
              <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>Subscription Plans</h5>
              <p className="mb-0 text-muted" style={{ fontSize: 11.5 }}>
                Manage pricing, limits and features ·{' '}
                <span style={{ color: '#405189', fontWeight: 700 }}>{plans.length}</span> plans
              </p>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            
            <Button
              color="secondary"
              className="btn-label waves-effect waves-light rounded-pill"
              onClick={() => onNavigate?.('add-plan')}
            >
              <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
              Add Plan
            </Button>
          </div>
        </div>

      {loading ? (
        <div className="text-center py-3"><Spinner color="primary" /></div>
      ) : plans.length === 0 ? (
        <Card>
          <CardBody className="text-center py-5">
            <i className="ri-bank-card-line display-4 text-muted"></i>
            <p className="mt-3 text-muted">No plans yet. Click "Add Plan" to create your first plan.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="plans-swiper-outer">
          <button ref={prevRef} className="plans-nav-btn plans-nav-prev" aria-label="Previous">
            <i className="ri-arrow-left-s-line"></i>
          </button>

          <Swiper
            modules={[Navigation, Pagination, Autoplay]}
            onBeforeInit={(swiper) => {
              if (typeof swiper.params.navigation === 'object' && swiper.params.navigation) {
                (swiper.params.navigation as any).prevEl = prevRef.current;
                (swiper.params.navigation as any).nextEl = nextRef.current;
              }
            }}
            navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
            pagination={{ clickable: true, dynamicBullets: true }}
            loop={plans.length > 1}
            autoplay={{ delay: 2000, disableOnInteraction: false, pauseOnMouseEnter: true }}
            breakpoints={{
              0:    { slidesPerView: 1, spaceBetween: 12 },
              576:  { slidesPerView: 2, spaceBetween: 14 },
              992:  { slidesPerView: 3, spaceBetween: 18 },
              1400: { slidesPerView: 4, spaceBetween: 20 },
            }}
            className="plans-swiper pb-5"
          >
          {plans.map((p, idx) => {
            const PLAN_ACCENTS = ['#405189', '#0ab39c', '#299cdb', '#7c5cfc', '#e83e8c', '#f06548'];
            const accent = p.is_featured ? '#f7b84b' : PLAN_ACCENTS[idx % PLAN_ACCENTS.length];
            const isDark = p.is_featured;
            const textMain = isDark ? '#fff' : 'var(--vz-heading-color, var(--vz-body-color))';
            const textMuted = isDark ? 'rgba(255,255,255,0.65)' : 'var(--vz-secondary-color)';
            const dividerColor = isDark ? 'rgba(255,255,255,0.12)' : 'var(--vz-border-color)';
            const bgBase = isDark
              ? 'linear-gradient(160deg, #0b1324 0%, #1a2545 60%, #2d4373 100%)'
              : `linear-gradient(160deg, ${accent}0a 0%, var(--vz-card-bg) 45%)`;

            return (
              <SwiperSlide key={p.id} style={{ height: 'auto' }}>
                <Card
                  className="w-100 mb-0"
                  style={{
                    height: 520,
                    borderRadius: 16,
                    border: isDark ? `1px solid ${accent}88` : '1px solid var(--vz-border-color)',
                    background: bgBase,
                    boxShadow: isDark
                      ? `0 12px 32px ${accent}35, 0 3px 10px rgba(0,0,0,0.10)`
                      : '0 3px 12px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.03)',
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
                      ? `0 14px 36px ${accent}38, 0 4px 12px rgba(0,0,0,0.12)`
                      : '0 4px 14px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)';
                    if (!isDark) el.style.borderColor = 'var(--vz-border-color)';
                  }}
                >
                  {/* ── Diagonal shine sweep overlay ── */}
                  <div
                    className="plan-shine-overlay"
                    style={{
                      position: 'absolute',
                      top: 0, left: 0,
                      width: '55%', height: '100%',
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

                  {/* ── Top-center "Popular" ribbon ── */}
                  {p.is_featured && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 4,
                        padding: '3px 16px 4px',
                        borderRadius: '0 0 10px 10px',
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '0.1em',
                        background: `linear-gradient(180deg, ${accent}, ${accent}dd)`,
                        color: '#0b1324',
                        boxShadow: `0 4px 12px ${accent}66`,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <i className="ri-vip-crown-fill me-1" style={{ fontSize: 10 }} />
                      {p.badge || 'Popular'}
                    </div>
                  )}

                  {/* ── Featured corner glows ── */}
                  {isDark && (
                    <>
                      <div style={{ position: 'absolute', top: -80, right: -80, width: 220, height: 220, borderRadius: '50%', background: `radial-gradient(circle, ${accent}26 0%, transparent 70%)`, pointerEvents: 'none', zIndex: 0 }} />
                      <div style={{ position: 'absolute', bottom: -80, left: -80, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, #6691e722 0%, transparent 70%)`, pointerEvents: 'none', zIndex: 0 }} />
                    </>
                  )}

                  <CardBody
                    className="px-3 d-flex flex-column position-relative text-center"
                    style={{
                      minHeight: 0,
                      zIndex: 2,
                      paddingTop: p.is_featured ? 24 : 14,
                      paddingBottom: 14,
                    }}
                  >
                    {/* ── Plan name + status ── */}
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                      <h5 className="mb-0 fw-bold" style={{ color: textMain, fontSize: 16, letterSpacing: '-0.01em' }}>
                        {p.name}
                      </h5>
                      <span
                        className="badge rounded-pill text-uppercase fw-semibold d-inline-flex align-items-center gap-1"
                        style={{
                          background: p.status === 'active' ? '#0ab39c20' : '#f0654820',
                          color: p.status === 'active' ? '#0ab39c' : '#f06548',
                          border: `1px solid ${p.status === 'active' ? '#0ab39c40' : '#f0654840'}`,
                          fontSize: 8.5,
                          letterSpacing: '0.05em',
                          padding: '2px 6px',
                        }}
                      >
                        <span
                          className="rounded-circle"
                          style={{ width: 4.5, height: 4.5, background: p.status === 'active' ? '#0ab39c' : '#f06548' }}
                        />
                        {p.status}
                      </span>
                    </div>

                    {/* ── Price ── */}
                    <div className="mb-2">
                      {p.price <= 0 ? (
                        <div
                          className="fw-bold lh-1"
                          style={{
                            fontSize: 30,
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
                        <div className="d-inline-flex align-items-baseline justify-content-center gap-1">
                          <small style={{ fontSize: 14, color: textMuted, fontWeight: 500 }}>₹</small>
                          <span
                            className="fw-bold lh-1"
                            style={{ fontSize: 30, color: isDark ? accent : textMain, letterSpacing: '-0.02em' }}
                          >
                            {p.price.toLocaleString()}
                          </span>
                          <small style={{ fontSize: 11, color: textMuted, fontWeight: 500 }}>
                            {periodLabel[p.period] || '/' + p.period}
                          </small>
                        </div>
                      )}
                    </div>

                    {/* ── Description ── */}
                    {p.best_for && (
                      <p className="mb-2" style={{ color: textMuted, fontSize: 11, lineHeight: 1.4, minHeight: 26 }}>
                        {p.best_for}
                      </p>
                    )}

                    {/* ── Stat boxes 2×2 — compact ── */}
                    <Row className="gx-2 gy-2 mb-3">
                      {[
                        { icon: 'ri-git-branch-line',         label: 'Branches', val: p.max_branches  ?? '∞' },
                        { icon: 'ri-user-3-line',             label: 'Users',    val: p.max_users     ?? '∞' },
                        { icon: 'ri-hard-drive-2-line',       label: 'Storage',  val: p.storage_limit || '—' },
                        { icon: 'ri-customer-service-2-line', label: 'Support',  val: p.support_level || '—' },
                      ].map(l => (
                        <Col xs={6} key={l.label}>
                          <div
                            className="rounded-2 d-flex align-items-center gap-2 px-2 py-1"
                            style={{
                              background: isDark ? 'rgba(255,255,255,0.06)' : 'var(--vz-secondary-bg)',
                              border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid var(--vz-border-color)',
                            }}
                          >
                            <div
                              className="d-inline-flex align-items-center justify-content-center rounded-1 flex-shrink-0"
                              style={{
                                width: 24, height: 24,
                                background: accent + (isDark ? '28' : '15'),
                                border: `1px solid ${accent}${isDark ? '45' : '30'}`,
                              }}
                            >
                              <i className={l.icon} style={{ color: accent, fontSize: 11 }} />
                            </div>
                            <div className="text-start min-w-0 flex-grow-1">
                              <div
                                className="text-uppercase fw-semibold"
                                style={{ fontSize: 8.5, color: textMuted, letterSpacing: '0.04em', lineHeight: 1.1 }}
                              >
                                {l.label}
                              </div>
                              <div
                                className="fw-bold text-truncate"
                                style={{ fontSize: 11.5, color: textMain, lineHeight: 1.2 }}
                              >
                                {l.val}
                              </div>
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>

                    {/* ── Divider ── */}
                    <div style={{ height: 1, background: dividerColor, margin: '4px -4px 14px' }} />

                    {/* ── Modules + perks ── */}
                    {p.modules && p.modules.length > 0 && (
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="text-uppercase fw-bold" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: textMuted }}>
                          Modules
                        </span>
                        <button
                          type="button"
                          onClick={() => setModalPlan(p)}
                          className="btn btn-link p-0 d-inline-flex align-items-center gap-1"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: accent,
                            textDecoration: 'none',
                          }}
                        >
                          <span
                            className="rounded-pill px-2 fw-bold"
                            style={{
                              fontSize: 10,
                              background: accent + '22',
                              color: accent,
                              border: `1px solid ${accent}50`,
                            }}
                          >
                            {p.modules.length}
                          </span>
                          {p.modules.length > 4 && <><i className="ri-external-link-line" /></>}
                        </button>
                      </div>
                    )}
                    <ul
                      className="list-unstyled vstack gap-1 mb-0 pe-1 text-start plan-modules-scroll"
                      style={{
                        overflowY: 'auto',
                        maxHeight: 180,
                        minHeight: 0,
                        scrollbarWidth: 'thin',
                      }}
                    >
                      {(p.modules || []).map(m => (
                        <li key={m.id} className="d-flex align-items-center gap-2" title={m.name}>
                          <span
                            className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{
                              width: 16, height: 16,
                              background: m.pivot?.access_level === 'limited' ? '#f7b84b' : '#0ab39c',
                            }}
                          >
                            <i className="ri-check-line" style={{ color: '#fff', fontSize: 10, fontWeight: 700 }} />
                          </span>
                          <span className="text-truncate flex-grow-1" style={{ color: textMain, fontSize: 12 }}>
                            {m.name}
                          </span>
                          {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                            <Badge
                              color={accessColors[m.pivot.access_level] || 'secondary'}
                              className="flex-shrink-0"
                              style={{ fontSize: '8.5px' }}
                            >
                              {m.pivot.access_level}
                            </Badge>
                          )}
                        </li>
                      ))}
                      {/* Perks */}
                      {p.trial_days && p.trial_days > 0 && (
                        <li className="d-flex align-items-center gap-2">
                          <span className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 16, height: 16, background: '#0ab39c' }}>
                            <i className="ri-check-line" style={{ color: '#fff', fontSize: 10, fontWeight: 700 }} />
                          </span>
                          <span style={{ color: textMain, fontSize: 12 }}>{p.trial_days}-day free trial</span>
                        </li>
                      )}
                      {p.yearly_discount && p.yearly_discount > 0 && (
                        <li className="d-flex align-items-center gap-2">
                          <span className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 16, height: 16, background: '#0ab39c' }}>
                            <i className="ri-check-line" style={{ color: '#fff', fontSize: 10, fontWeight: 700 }} />
                          </span>
                          <span style={{ color: textMain, fontSize: 12 }}>{p.yearly_discount}% yearly discount</span>
                        </li>
                      )}
                      {p.clients_count !== undefined && p.clients_count > 0 && (
                        <li className="d-flex align-items-center gap-2">
                          <span className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 16, height: 16, background: accent }}>
                            <i className="ri-user-3-line" style={{ color: '#fff', fontSize: 10 }} />
                          </span>
                          <span style={{ color: textMain, fontSize: 12 }}>
                            {p.clients_count} active client{p.clients_count !== 1 ? 's' : ''}
                          </span>
                        </li>
                      )}
                    </ul>

                    {/* ── Actions — pinned to bottom ── */}
                    <div className="d-flex gap-2 mt-auto pt-2">
                      <button
                        type="button"
                        onClick={() => onNavigate?.('add-plan', { editId: p.id })}
                        className="btn flex-grow-1 rounded-pill fw-semibold d-inline-flex align-items-center justify-content-center gap-1"
                        style={{
                          padding: '6px 14px',
                          fontSize: 12,
                          background: isDark ? accent : 'transparent',
                          color: isDark ? '#0b1324' : accent,
                          border: isDark ? 'none' : `1.5px solid ${accent}`,
                          boxShadow: isDark ? `0 4px 14px ${accent}55` : 'none',
                          transition: 'all .18s ease',
                        }}
                        onMouseEnter={e => {
                          const el = e.currentTarget;
                          if (!isDark) { el.style.background = accent; el.style.color = '#fff'; }
                          else { el.style.boxShadow = `0 8px 20px ${accent}88`; }
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget;
                          if (!isDark) { el.style.background = 'transparent'; el.style.color = accent; }
                          else { el.style.boxShadow = `0 4px 14px ${accent}55`; }
                        }}
                      >
                        <i className="ri-pencil-line" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        disabled={deleting === p.id}
                        className="btn rounded-pill d-inline-flex align-items-center justify-content-center"
                        style={{
                          width: 34, height: 34, padding: 0, flexShrink: 0,
                          background: isDark ? 'rgba(240,101,72,0.18)' : '#f0654815',
                          color: '#f06548',
                          border: `1px solid ${isDark ? 'rgba(240,101,72,0.40)' : '#f0654840'}`,
                          transition: 'all .18s ease',
                        }}
                        onMouseEnter={e => {
                          const el = e.currentTarget;
                          el.style.background = '#f06548';
                          el.style.color = '#fff';
                          el.style.borderColor = '#f06548';
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget;
                          el.style.background = isDark ? 'rgba(240,101,72,0.18)' : '#f0654815';
                          el.style.color = '#f06548';
                          el.style.borderColor = isDark ? 'rgba(240,101,72,0.40)' : '#f0654840';
                        }}
                      >
                        {deleting === p.id ? <Spinner size="sm" /> : <i className="ri-delete-bin-5-line" />}
                      </button>
                    </div>
                  </CardBody>
                </Card>
              </SwiperSlide>
            );
          })}
          </Swiper>

          <button ref={nextRef} className="plans-nav-btn plans-nav-next" aria-label="Next">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
        )}
      </div>

      {/* ── Premium Modules Detail Modal ── */}
      <Modal
        isOpen={!!modalPlan}
        toggle={() => setModalPlan(null)}
        size="lg"
        centered
        scrollable
        contentClassName="border-0 overflow-hidden"
        style={{ borderRadius: 16 }}
      >
        <div
          className="position-relative text-white px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, #0b1324 0%, #1e2a4a 50%, #2d4373 100%)',
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage: 'radial-gradient(circle at 15% 20%, rgba(102,145,231,0.22) 0%, transparent 42%), radial-gradient(circle at 85% 85%, rgba(10,179,156,0.14) 0%, transparent 48%)',
              pointerEvents: 'none',
            }}
          />
          <div className="position-relative d-flex align-items-center justify-content-between gap-2">
            <div className="d-flex align-items-center gap-2">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                style={{
                  width: 40, height: 40,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))',
                  border: '1px solid rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <i className="ri-apps-2-line" style={{ color: '#fff', fontSize: 18 }} />
              </div>
              <div>
                <h5 className="text-white mb-0 fw-bold" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
                  {modalPlan?.name}
                </h5>
                <div className="d-inline-flex align-items-center gap-1 mt-1" style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11.5 }}>
                  <i className="ri-checkbox-multiple-line" />
                  <span className="fw-semibold" style={{ color: '#fff' }}>{modalPlan?.modules?.length}</span>
                  modules included
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalPlan(null)}
              className="btn p-0 d-inline-flex align-items-center justify-content-center rounded-circle"
              style={{
                width: 32, height: 32,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                color: '#fff',
              }}
              aria-label="Close"
            >
              <i className="ri-close-line" style={{ fontSize: 16 }} />
            </button>
          </div>
        </div>

        <ModalBody className="p-3" style={{ background: 'var(--vz-card-bg)' }}>
          {modalPlan?.modules && modalPlan.modules.length > 0 ? (
            <>
              <p className="mb-3" style={{ color: 'var(--vz-secondary-color)', fontSize: 12.5 }}>
                All modules available in the <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{modalPlan.name}</strong> plan.
              </p>
              <div className="row gx-2 gy-2">
                {modalPlan.modules.map(m => (
                  <div key={m.id} className="col-md-4 col-sm-6" title={m.name}>
                    <div
                      className="d-flex align-items-center gap-2 px-2 py-2 rounded-2"
                      style={{
                        background: 'var(--vz-secondary-bg)',
                        border: '1px solid var(--vz-border-color)',
                        transition: 'background .15s ease, border-color .15s ease',
                        minHeight: 40,
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.background = '#0ab39c10';
                        (e.currentTarget as HTMLDivElement).style.borderColor = '#0ab39c50';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.background = 'var(--vz-secondary-bg)';
                        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--vz-border-color)';
                      }}
                    >
                      <span
                        className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{
                          width: 20, height: 20,
                          background: m.pivot?.access_level === 'limited' ? '#f7b84b' : '#0ab39c',
                          boxShadow: `0 2px 4px ${m.pivot?.access_level === 'limited' ? 'rgba(247,184,75,0.25)' : 'rgba(10,179,156,0.25)'}`,
                        }}
                      >
                        <i className="ri-check-line" style={{ color: '#fff', fontSize: 12, fontWeight: 700 }} />
                      </span>
                      <span
                        className="fw-medium text-truncate flex-grow-1"
                        style={{
                          fontSize: 12.5,
                          color: 'var(--vz-heading-color, var(--vz-body-color))',
                          minWidth: 0,
                        }}
                      >
                        {m.name}
                      </span>
                      {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                        <Badge
                          color={accessColors[m.pivot.access_level] || 'secondary'}
                          className="flex-shrink-0 text-capitalize"
                          style={{ fontSize: '9.5px' }}
                        >
                          {m.pivot.access_level}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="mt-3 px-3 py-2 rounded-2 d-flex align-items-center gap-2"
                style={{
                  background: '#40518910',
                  border: '1px solid #40518930',
                  borderLeft: '3px solid #405189',
                }}
              >
                <i className="ri-information-line" style={{ color: '#405189', fontSize: 16 }} />
                <span style={{ fontSize: 11.5, color: 'var(--vz-body-color)' }}>
                  Access levels: <strong>full</strong> complete access · <strong>limited</strong> restricted · <strong>read</strong> view only · <strong>write</strong> edit only
                </span>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle mb-2"
                style={{ width: 52, height: 52, background: '#f7b84b18', border: '1px solid #f7b84b30' }}
              >
                <i className="ri-apps-2-line" style={{ color: '#f7b84b', fontSize: 24 }} />
              </div>
              <p className="mb-0 fs-13" style={{ color: 'var(--vz-secondary-color)' }}>No modules assigned to this plan.</p>
            </div>
          )}
        </ModalBody>
      </Modal>
    </>
  );
}
