import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Badge, Button, Spinner } from 'reactstrap';
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
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Subscription Plans</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
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
        <Swiper
          modules={[Navigation, Pagination, Autoplay]}
          slidesPerView={4}
          spaceBetween={24}
          navigation
          pagination={{ clickable: true }}
          loop={plans.length > 1}   
          autoplay={{
            delay: 2000,
            disableOnInteraction: false,
            pauseOnMouseEnter: true,
          }}
          breakpoints={{
            0:    { slidesPerView: 1, spaceBetween: 16 },
            576:  { slidesPerView: 2, spaceBetween: 16 },
            992:  { slidesPerView: 3, spaceBetween: 20 },
            1200: { slidesPerView: 4, spaceBetween: 24 },
          }}
          className="plans-swiper pb-5"
        >
          {plans.map(p => (
            <SwiperSlide key={p.id}>
              <Card className={`pricing-box h-100 ${p.is_featured ? 'ribbon-box right' : ''}`} style={p.is_featured ? { border: '2px solid var(--vz-primary)' } : {}}>
                {p.is_featured && (
                  <div className="ribbon-two ribbon-two-primary">
                    <span>{p.badge || 'Popular'}</span>
                  </div>
                )}
                <CardBody className="p-4">
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

                  <div className="py-3">
                    {p.price <= 0 ? (
                      <h1 className="month fw-bold text-primary mb-0">Free</h1>
                    ) : (
                      <h1 className="month fw-bold mb-0">
                        <small className="fs-5 text-muted">₹</small>
                        {p.price.toLocaleString()}
                        <small className="fs-13 text-muted fw-normal">{periodLabel[p.period] || '/' + p.period}</small>
                      </h1>
                    )}
                    {p.best_for && <p className="text-muted fs-13 mt-2 mb-0">{p.best_for}</p>}
                  </div>

                  <Row className="gx-2 gy-2 mb-3">
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

                  {p.modules && p.modules.length > 0 && (
                    <div className="mb-3">
                      <div className="text-muted text-uppercase fs-11 fw-bold mb-2">Modules ({p.modules.length})</div>
                      <ul className="list-unstyled vstack gap-1 mb-0">
                        {p.modules.slice(0, 4).map(m => (
                          <li key={m.id} className="fs-13">
                            <i className="ri-checkbox-circle-fill text-success me-1"></i>
                            {m.name}
                            {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                              <Badge color="info-subtle" className="text-info ms-1 fs-10">{m.pivot.access_level}</Badge>
                            )}
                          </li>
                        ))}
                        {p.modules.length > 4 && <li className="fs-12 text-muted">+{p.modules.length - 4} more</li>}
                      </ul>
                    </div>
                  )}

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

                  <div className="d-flex gap-2">
                    <Button color="primary" className="flex-grow-1" onClick={() => onNavigate?.('add-plan', { editId: p.id })}>
                      <i className="ri-pencil-line align-bottom me-1"></i> Edit
                    </Button>
                    <Button color="soft-danger" onClick={() => handleDelete(p)} disabled={deleting === p.id}>
                      <i className="ri-delete-bin-5-line"></i>
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </SwiperSlide>
          ))}
        </Swiper>
      )}
    </>
  );
}
