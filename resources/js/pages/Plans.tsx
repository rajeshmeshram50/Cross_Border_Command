import { useState, useEffect, useRef } from 'react';
import { Card, CardBody, Col, Row, Badge, Button, Spinner, Modal, ModalHeader, ModalBody } from 'reactstrap';
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
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Subscription Plans</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">IGC</a></li>
                <li className="breadcrumb-item active">Plans</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row className="mb-3">
        <Col xs={12} className="d-flex justify-content-between align-items-center">
          <p className="text-muted mb-0">Manage pricing, limits and features · {plans.length} plans</p>
          <Button
            color="primary"
            className="btn-label waves-effect waves-light rounded-pill"
            onClick={() => onNavigate?.('add-plan')}
          >
            <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
            Add Plan
          </Button>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5"><Spinner color="primary" /></div>
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
              0:    { slidesPerView: 1, spaceBetween: 16 },
              576:  { slidesPerView: 2, spaceBetween: 16 },
              992:  { slidesPerView: 3, spaceBetween: 20 },
              1200: { slidesPerView: 4, spaceBetween: 24 },
            }}
            className="plans-swiper pb-5"
          >
          {plans.map(p => (
            <SwiperSlide key={p.id} style={{ height: 'auto' }}>
              <Card
                className={`pricing-box h-100 ${p.is_featured ? 'ribbon-box right' : ''}`}
                style={p.is_featured ? { border: '2px solid var(--vz-primary)' } : {}}
              >
                {p.is_featured && (
                  <div className="ribbon-two ribbon-two-primary">
                    <span>{p.badge || 'Popular'}</span>
                  </div>
                )}
                <CardBody className="p-4 d-flex flex-column">

                  {/* Header */}
                  <div className="d-flex align-items-center mb-3">
                    <div className="flex-grow-1">
                      <h5 className="mb-1 fw-semibold">{p.name}</h5>
                      <Badge color={p.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{p.status}</Badge>
                    </div>
                    <div className="avatar-sm">
                      <div className="avatar-title rounded bg-primary-subtle text-primary fs-3">
                        <i className="ri-bank-card-line"></i>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="py-2">
                    {p.price <= 0 ? (
                      <h1 className="month fw-bold text-primary mb-0">Free</h1>
                    ) : (
                      <h1 className="month fw-bold mb-0">
                        <small className="fs-5 text-muted">₹</small>
                        {p.price.toLocaleString()}
                        <small className="fs-13 text-muted fw-normal">{periodLabel[p.period] || '/' + p.period}</small>
                      </h1>
                    )}
                    {p.best_for && <p className="text-muted fs-13 mt-1 mb-0">{p.best_for}</p>}
                  </div>

                  {/* Stats grid */}
                  <Row className="gx-2 gy-2 my-3">
                    <Col xs={6}>
                      <div className="bg-light rounded p-2 text-center">
                        <i className="ri-git-branch-line text-muted"></i>
                        <div className="fs-11 text-muted text-uppercase">Branches</div>
                        <div className="fw-bold">{p.max_branches ?? '∞'}</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="bg-light rounded p-2 text-center">
                        <i className="ri-user-3-line text-muted"></i>
                        <div className="fs-11 text-muted text-uppercase">Users</div>
                        <div className="fw-bold">{p.max_users ?? '∞'}</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="bg-light rounded p-2 text-center">
                        <i className="ri-hard-drive-2-line text-muted"></i>
                        <div className="fs-11 text-muted text-uppercase">Storage</div>
                        <div className="fw-bold">{p.storage_limit || '—'}</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="bg-light rounded p-2 text-center">
                        <i className="ri-customer-service-2-line text-muted"></i>
                        <div className="fs-11 text-muted text-uppercase">Support</div>
                        <div className="fw-bold">{p.support_level || '—'}</div>
                      </div>
                    </Col>
                  </Row>

                  {/* Modules — fixed 2×2 grid, no card growth */}
                  {p.modules && p.modules.length > 0 && (
                    <div className="mb-3">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="text-muted text-uppercase fs-11 fw-bold">
                          Modules ({p.modules.length})
                        </span>
                        {p.modules.length > 4 && (
                          <button
                            className="btn btn-link p-0 fs-11 fw-semibold text-primary text-decoration-none"
                            onClick={() => setModalPlan(p)}
                          >
                            View all <i className="ri-external-link-line align-middle"></i>
                          </button>
                        )}
                      </div>

                      {/* 2×2 grid — always exactly 2 columns, max 4 items shown */}
                      <div className="row gx-2 gy-1">
                        {p.modules.slice(0, 4).map(m => (
                          <div key={m.id} className="col-6" title={m.name}>
                            <div className="d-flex align-items-center gap-1 overflow-hidden">
                              <i className="ri-checkbox-circle-fill text-success flex-shrink-0 fs-12"></i>
                              <span
                                className="fs-12 text-truncate"
                                style={{ minWidth: 0, maxWidth: '100%' }}
                              >
                                {m.name}
                              </span>
                              {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                                <Badge
                                  color={accessColors[m.pivot.access_level] || 'secondary'}
                                  className="flex-shrink-0 fs-10 ms-auto"
                                  style={{ fontSize: '9px' }}
                                >
                                  {m.pivot.access_level}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {p.modules.length > 4 && (
                        <button
                          className="btn btn-link p-0 fs-12 mt-2 text-muted text-decoration-none"
                          onClick={() => setModalPlan(p)}
                        >
                          +{p.modules.length - 4} more modules
                        </button>
                      )}
                    </div>
                  )}

                  {/* Extra perks */}
                  <div className="vstack gap-1 mb-3 fs-13 text-muted">
                    {p.trial_days && p.trial_days > 0 && (
                      <div><i className="ri-checkbox-circle-fill text-success me-1"></i>{p.trial_days}-day free trial</div>
                    )}
                    {p.yearly_discount && p.yearly_discount > 0 && (
                      <div><i className="ri-checkbox-circle-fill text-success me-1"></i>{p.yearly_discount}% yearly discount</div>
                    )}
                    {p.clients_count !== undefined && p.clients_count > 0 && (
                      <div><i className="ri-user-3-line text-primary me-1"></i>{p.clients_count} active client{p.clients_count !== 1 ? 's' : ''}</div>
                    )}
                  </div>

                  {/* Actions — pushed to bottom */}
                  <div className="d-flex gap-2 mt-auto">
                    <Button color="primary" className="flex-grow-1" onClick={() => onNavigate?.('add-plan', { editId: p.id })}>
                      <i className="ri-pencil-line align-bottom me-1"></i> Edit
                    </Button>
                    <Button color="soft-danger" onClick={() => handleDelete(p)} disabled={deleting === p.id}>
                      {deleting === p.id ? <Spinner size="sm" /> : <i className="ri-delete-bin-5-line"></i>}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </SwiperSlide>
          ))}
          </Swiper>

          <button ref={nextRef} className="plans-nav-btn plans-nav-next" aria-label="Next">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
      )}

      {/* Modules detail modal */}
      <Modal isOpen={!!modalPlan} toggle={() => setModalPlan(null)} size="lg" centered scrollable>
        <ModalHeader
          toggle={() => setModalPlan(null)}
          className="border-0 pb-0"
          style={{ background: 'linear-gradient(135deg, var(--vz-primary) 0%, #6f42c1 100%)' }}
        >
          <div className="d-flex align-items-center gap-2 text-white">
            <div className="avatar-xs">
              <div className="avatar-title rounded bg-white bg-opacity-25 text-white fs-5">
                <i className="ri-apps-2-line"></i>
              </div>
            </div>
            <div>
              <div className="fw-bold fs-16">{modalPlan?.name}</div>
              <div className="fs-12 opacity-75">{modalPlan?.modules?.length} modules included</div>
            </div>
          </div>
        </ModalHeader>

        <ModalBody className="pt-4">
          {modalPlan?.modules && modalPlan.modules.length > 0 ? (
            <>
              <p className="text-muted fs-13 mb-4">
                All modules available in the <strong>{modalPlan.name}</strong> plan. Hover over any module for the full name.
              </p>
              <div className="row gx-3 gy-3">
                {modalPlan.modules.map((m, idx) => (
                  <div key={m.id} className="col-md-4 col-sm-6" title={m.name}>
                    <div
                      className="d-flex align-items-center gap-2 p-2 rounded border"
                      style={{ background: idx % 2 === 0 ? 'var(--vz-light)' : '#fff', minHeight: '44px' }}
                    >
                      <div
                        className="avatar-xxs rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: 28, height: 28, background: 'var(--vz-primary-bg-subtle)' }}
                      >
                        <i className="ri-checkbox-circle-fill text-success fs-14"></i>
                      </div>
                      <span className="fs-13 fw-medium text-truncate flex-grow-1" style={{ minWidth: 0 }}>
                        {m.name}
                      </span>
                      {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                        <Badge
                          color={accessColors[m.pivot.access_level] || 'secondary'}
                          className="flex-shrink-0 text-capitalize"
                          style={{ fontSize: '10px' }}
                        >
                          {m.pivot.access_level}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 rounded" style={{ background: 'var(--vz-primary-bg-subtle)' }}>
                <div className="d-flex align-items-center gap-2 text-primary">
                  <i className="ri-information-line fs-16"></i>
                  <span className="fs-13">
                    Access levels: <strong>full</strong> = complete access &nbsp;|&nbsp;
                    <strong>limited</strong> = restricted &nbsp;|&nbsp;
                    <strong>read</strong> = view only &nbsp;|&nbsp;
                    <strong>write</strong> = edit only
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center text-muted py-4">
              <i className="ri-apps-2-line display-5 d-block mb-2"></i>
              No modules assigned to this plan.
            </div>
          )}
        </ModalBody>
      </Modal>
    </>
  );
}
