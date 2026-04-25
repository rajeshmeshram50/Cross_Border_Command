import { useState, useEffect, useRef } from 'react';
import { Card, CardBody, Badge, Button, Spinner, Modal, ModalBody } from 'reactstrap';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Autoplay } from 'swiper/modules';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import Swal from 'sweetalert2';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import '../../css/plans-card.css';

interface Plan {
  id: number; name: string; slug: string; price: number; period: string;
  max_branches: number | null; max_users: number | null; storage_limit: string | null;
  support_level: string | null; is_featured: boolean; badge: string | null;
  color: string | null; description: string | null; best_for: string | null;
  status: string; trial_days: number | null; yearly_discount: number | null;
  is_custom: boolean; clients_count?: number;
  modules?: { id: number; name: string; slug: string; pivot?: { access_level: string } }[];
}

const accessColors: Record<string, string> = {
  limited: 'warning',
  read: 'info',
  write: 'primary',
  full: 'success',
};


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
      html: `Delete <strong>"${plan.name}"</strong> plan?<br/><span style="font-size:12px;opacity:0.75;">This action cannot be undone.</span>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '<i class="ri-delete-bin-line" style="margin-right:4px;"></i> Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#f06548',
      cancelButtonColor: '#878a99',
      width: 360,
      padding: '1.2em 1.2em 1.4em',
      backdrop: 'rgba(15, 23, 42, 0.45)',
      customClass: {
        popup: 'plans-swal-popup',
        title: 'plans-swal-title',
        htmlContainer: 'plans-swal-html',
        confirmButton: 'plans-swal-confirm',
        cancelButton: 'plans-swal-cancel',
        actions: 'plans-swal-actions',
        icon: 'plans-swal-icon',
      },
      buttonsStyling: false,
    });
    if (!result.isConfirmed) return;
    setDeleting(plan.id);
    try {
      await api.delete(`/plans/${plan.id}`);
      Swal.fire({
        title: 'Deleted!',
        text: `"${plan.name}" has been removed.`,
        icon: 'success',
        timer: 1800,
        showConfirmButton: false,
        width: 340,
        padding: '1.2em',
        backdrop: 'rgba(15, 23, 42, 0.45)',
        customClass: { popup: 'plans-swal-popup', title: 'plans-swal-title' },
      });
      fetchPlans();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot delete plan');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>

      <div className="plans-surface">
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
            onSwiper={swiper => {
              // Re-bind nav AFTER both prev/next refs are attached (next button
              // renders AFTER the Swiper, so its ref isn't set during onBeforeInit).
              // A microtask delay guarantees both refs exist before re-init.
              setTimeout(() => {
                if (typeof swiper.params.navigation === 'object' && swiper.params.navigation) {
                  (swiper.params.navigation as any).prevEl = prevRef.current;
                  (swiper.params.navigation as any).nextEl = nextRef.current;
                }
                if (swiper.navigation) {
                  swiper.navigation.destroy();
                  swiper.navigation.init();
                  swiper.navigation.update();
                }
              }, 0);
            }}
            navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
            pagination={{ clickable: true, dynamicBullets: true }}
            loop={plans.length > 1}
            autoplay={{ delay: 3500, disableOnInteraction: true, pauseOnMouseEnter: true }}
            speed={450}
            /* Centered-slides focus mode — active card scales up to crisp 1.0
               (no transform = pixel-perfect HD text) and side cards shrink. */
            grabCursor={true}
            centeredSlides={true}
            slidesPerView="auto"
            spaceBetween={24}
            watchSlidesProgress={true}
            className="plans-swiper plans-swiper-center pb-5"
          >
          {plans.map((p) => {
            const modules = p.modules || [];
            const moduleCount = modules.length;
            const periodShort = p.period === 'month' ? 'mo' : p.period === 'quarter' ? 'qtr' : p.period === 'year' ? 'yr' : p.period;
            const stats = [
              { l: 'Branches', v: (p.max_branches  ?? '∞') as string | number, ic: 'ri-git-branch-line'   },
              { l: 'Users',    v: (p.max_users     ?? '∞') as string | number, ic: 'ri-user-3-line'       },
              { l: 'Storage',  v: p.storage_limit || '∞',                      ic: 'ri-hard-drive-2-line' },
              { l: 'Support',  v: p.support_level || '—',                      ic: 'ri-headphone-line'    },
            ];
            // Tick list only has modules + perks now (stats moved to boxes above)
            const ticks: { label: string; sub?: string }[] = [
              ...modules.map(m => ({
                label: m.name,
                sub: m.pivot?.access_level && m.pivot.access_level !== 'full' ? m.pivot.access_level : undefined,
              })),
              ...(p.trial_days && p.trial_days > 0 ? [{ label: `${p.trial_days}-day free trial` }] : []),
              ...(p.yearly_discount && p.yearly_discount > 0 ? [{ label: `${p.yearly_discount}% yearly discount` }] : []),
            ];
            return (
              <SwiperSlide key={p.id}>
                <Card
                  className={`w-100 mb-0 position-relative d-flex flex-column plan-card-animated plan-card-v2 ${p.is_featured ? 'is-featured' : ''}`}
                  style={{
                    height: 560,
                    borderRadius: 20,
                    padding: '22px 22px 18px',
                    overflow: 'hidden',
                    textAlign: 'center',
                  }}
                >
                  {/* ── Header: Title + Price + Subtitle ── */}
                  <div className="text-center position-relative" style={{ zIndex: 2 }}>
                    <h4 className="plan-title mb-2">{p.name}</h4>
                    <div className="d-inline-flex align-items-baseline justify-content-center gap-1">
                      {p.price <= 0 ? (
                        <div className="plan-price">Free</div>
                      ) : (
                        <>
                          <div className="plan-price">
                            <span className="cur">₹</span>
                            {p.price.toLocaleString()}
                          </div>
                          <span className="plan-price-period">/ {periodShort}</span>
                        </>
                      )}
                    </div>
                    {p.best_for && (
                      <p className="plan-subtitle mt-2 mb-0">{p.best_for}</p>
                    )}
                  </div>

                  {/* ── 2×2 Stat grid ── */}
                  <div className="row g-2 mt-3 position-relative" style={{ zIndex: 2 }}>
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
                  <div className="mt-3 d-flex flex-column position-relative" style={{ zIndex: 2, flex: '1 1 0', minHeight: 0 }}>
                    <div className="plan-modules-header">
                      <span className="plan-modules-title">
                        <i className="ri-stack-line" />
                        Included Modules
                      </span>
                      <button
                        type="button"
                        className="plan-modules-count-pill"
                        onClick={() => setModalPlan(p)}
                        title="View all"
                      >
                        {moduleCount}
                      </button>
                    </div>

                    {ticks.length > 0 ? (
                      <ul className="plan-ticks text-start">
                        {ticks.map((t, i) => (
                          <li key={i} className="planlist-tick" style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }} title={t.label}>
                            <i className="ri-check-line" />
                            <span className="text-truncate flex-grow-1">
                              {t.label}
                              {t.sub && <span className="opacity-75 ms-1" style={{ fontSize: 10 }}>({t.sub})</span>}
                            </span>
                          </li>
                        ))}
                        {p.clients_count !== undefined && p.clients_count > 0 && (
                          <li style={{ opacity: 0.72 }}>
                            <i className="ri-user-3-line" style={{ fontSize: 13, color: 'inherit' }} />
                            <span className="text-truncate flex-grow-1">
                              {p.clients_count} active client{p.clients_count !== 1 ? 's' : ''}
                            </span>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <div className="text-center py-3 flex-grow-1 d-flex flex-column align-items-center justify-content-center">
                        <p className="text-muted mb-0" style={{ fontSize: 11 }}>No modules included</p>
                      </div>
                    )}
                  </div>

                  {/* ── Actions row ── */}
                  <div className="d-flex gap-2 pt-3 mt-auto position-relative" style={{ zIndex: 2 }}>
                    <button
                      type="button"
                      onClick={() => onNavigate?.('add-plan', { editId: p.id })}
                      className="plan-cta"
                    >
                      <span className="plan-cta-icon">
                        <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                      </span>
                      <span className="plan-cta-label">Edit Plan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      disabled={deleting === p.id}
                      className="plan-delete-btn"
                    >
                      {deleting === p.id ? <Spinner size="sm" /> : <i className="ri-delete-bin-5-line" />}
                    </button>
                  </div>

                  {/* Limited-time / Popular tag for featured */}
                  {p.is_featured && (
                    <div className="plan-limited-tag position-relative" style={{ zIndex: 2 }}>
                      — {p.badge || 'Most popular plan'} —
                    </div>
                  )}
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
