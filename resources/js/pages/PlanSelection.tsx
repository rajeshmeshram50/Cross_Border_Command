import { useState, useEffect } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Label, Spinner, Alert,
  Modal, ModalHeader, ModalBody, ModalFooter, ButtonGroup,
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
      <Row>
        <Col xs={12}>
          <div className="page-title-box text-center">
            <div className="avatar-lg mx-auto mb-3">
              <div className="avatar-title rounded-circle bg-primary-subtle text-primary fs-2">
                <i className="ri-bank-card-line"></i>
              </div>
            </div>
            <h2 className="mb-1">Choose Your Plan</h2>
            <p className="text-muted">Select the perfect plan to power your organization</p>
            {user?.client_name && (
              <Badge color="primary" className="text-uppercase">
                <i className="ri-building-line me-1"></i>{user.client_name}
              </Badge>
            )}
          </div>
        </Col>
      </Row>

      {hasPlan && (
        <Alert color="success" className="d-flex align-items-center">
          <i className="ri-checkbox-circle-line me-2 fs-4"></i>
          <div><strong>Current: {user?.plan?.plan_name}</strong> · Valid until {user?.plan?.expires_at}</div>
        </Alert>
      )}
      {user?.plan?.expired && (
        <Alert color="danger" className="d-flex align-items-center">
          <i className="ri-time-line me-2 fs-4"></i>
          <div><strong>Plan expired!</strong> Renew to continue using all features.</div>
        </Alert>
      )}

      {/* Billing cycle switch */}
      <div className="d-flex justify-content-center mb-4">
        <ButtonGroup>
          {(['month', 'quarter', 'year'] as const).map(c => (
            <Button key={c} color={billingCycle === c ? 'primary' : 'light'} onClick={() => setBillingCycle(c)}>
              {c === 'month' ? 'Monthly' : c === 'quarter' ? 'Quarterly' : 'Yearly'}
              {c === 'year' && <Badge color="success" className="ms-2">Save</Badge>}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {plans.length === 0 ? (
        <Card><CardBody className="text-center py-5">
          <i className="ri-bank-card-line display-4 text-muted"></i>
          <p className="text-muted mt-3">No plans available. Contact administrator.</p>
        </CardBody></Card>
      ) : (
        <Row>
          {plans.map(p => {
            const price = getPrice(p, billingCycle);
            return (
              <Col xl={3} lg={4} md={6} key={p.id}>
                <Card className={`pricing-box h-100 ${p.is_featured ? 'ribbon-box right' : ''}`}
                  style={p.is_featured ? { border: '2px solid var(--vz-primary)' } : {}}>
                  {p.is_featured && (
                    <div className="ribbon-two ribbon-two-primary">
                      <span>{p.badge || 'Popular'}</span>
                    </div>
                  )}
                  <CardBody className="p-4">
                    <div className="d-flex align-items-center mb-3">
                      <div className="flex-grow-1">
                        <h5 className="mb-1">{p.name}</h5>
                        {p.best_for && <p className="text-muted mb-0 fs-13">{p.best_for}</p>}
                      </div>
                      <div className="avatar-sm"><span className="avatar-title rounded bg-primary-subtle text-primary fs-3">
                        <i className="ri-sparkling-line"></i>
                      </span></div>
                    </div>

                    <div className="py-3">
                      {p.price <= 0 ? (
                        <h1 className="text-primary mb-0">Free</h1>
                      ) : (
                        <h1 className="mb-0">
                          <small className="fs-5 text-muted">₹</small>
                          {Math.round(price).toLocaleString()}
                          <small className="fs-13 text-muted fw-normal">{periodLabel[billingCycle]}</small>
                        </h1>
                      )}
                      {billingCycle === 'year' && p.yearly_discount && p.yearly_discount > 0 && (
                        <Badge color="success-subtle" className="text-success mt-2">{p.yearly_discount}% off yearly</Badge>
                      )}
                    </div>

                    <Row className="gx-2 gy-2 mb-3">
                      {[
                        { icon: 'ri-git-branch-line', label: 'Branches', val: p.max_branches ?? '∞' },
                        { icon: 'ri-user-3-line',    label: 'Users',    val: p.max_users    ?? '∞' },
                        { icon: 'ri-hard-drive-2-line', label: 'Storage', val: p.storage_limit || '—' },
                        { icon: 'ri-customer-service-2-line', label: 'Support', val: p.support_level || '—' },
                      ].map(l => (
                        <Col xs={6} key={l.label}>
                          <div className="bg-light rounded p-2 text-center">
                            <i className={`${l.icon} text-muted`}></i>
                            <div className="fs-11 text-muted text-uppercase">{l.label}</div>
                            <div className="fw-bold">{l.val}</div>
                          </div>
                        </Col>
                      ))}
                    </Row>

                    {p.modules && p.modules.length > 0 && (
                      <div className="mb-3">
                        <p className="text-muted text-uppercase fs-11 fw-bold mb-2">Modules</p>
                        <ul className="list-unstyled vstack gap-1 mb-0">
                          {p.modules.map(m => (
                            <li key={m.id} className="fs-13">
                              <i className="ri-checkbox-circle-fill text-success me-1"></i>
                              {m.name}
                              {m.pivot?.access_level === 'limited' && (
                                <Badge color="warning-subtle" className="text-warning ms-1 fs-10">Limited</Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {p.trial_days && p.trial_days > 0 && (
                      <p className="text-success fs-13 mb-3">
                        <i className="ri-time-line me-1"></i>{p.trial_days}-day free trial
                      </p>
                    )}

                    <Button color={p.is_featured ? 'primary' : 'light'} className="w-100" onClick={() => openPayment(p)}>
                      {p.price <= 0 ? (
                        <><i className="ri-flashlight-line me-1"></i> Get Started</>
                      ) : (
                        <><i className="ri-arrow-right-line me-1"></i> Choose Plan</>
                      )}
                    </Button>
                  </CardBody>
                </Card>
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
                <Alert color="light" className="text-center mb-0">
                  <i className="ri-bank-line fs-2"></i>
                  <p className="mb-0 fs-13">You will be redirected to your bank's secure page</p>
                </Alert>
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
