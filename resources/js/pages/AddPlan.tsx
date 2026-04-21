import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner, Alert, Form, Badge, InputGroup, InputGroupText } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props { onBack: () => void; editId?: number; }
interface ModuleOption { id: number; name: string; slug: string; icon: string; }
type AccessLevel = 'full' | 'limited' | 'addon' | 'not_included';

const ACCESS_CFG: Record<AccessLevel, { label: string; color: string }> = {
  full:         { label: 'Full',         color: 'success' },
  limited:      { label: 'Limited',      color: 'info' },
  addon:        { label: 'Add-on',       color: 'warning' },
  not_included: { label: 'Not Included', color: 'light' },
};

const empty = {
  name: '', price: '0', period: 'month',
  max_branches: '', max_users: '', storage_limit: '', support_level: 'Email',
  is_featured: false, badge: '', color: '#5A51E8',
  description: '', best_for: '', status: 'active',
  trial_days: '', yearly_discount: '', is_custom: false,
};

const periodLabel: Record<string, string> = { month: '/mo', quarter: '/qtr', year: '/yr' };

export default function AddPlan({ onBack, editId }: Props) {
  const isEdit = !!editId;
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [moduleAccess, setModuleAccess] = useState<Record<number, AccessLevel>>({});
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  useEffect(() => {
    api.get('/modules').then(res => {
      const mods = (res.data || []).filter((m: ModuleOption) => !['dashboard', 'profile'].includes(m.slug));
      setModules(mods);
      const acc: Record<number, AccessLevel> = {};
      mods.forEach((m: ModuleOption) => { acc[m.id] = 'not_included'; });
      setModuleAccess(acc);
    });
  }, []);

  useEffect(() => {
    if (!editId) return;
    setLoadingData(true);
    api.get(`/plans/${editId}`).then(res => {
      const p = res.data;
      setForm({
        name: p.name || '', price: String(p.price ?? 0), period: p.period || 'month',
        max_branches: p.max_branches != null ? String(p.max_branches) : '',
        max_users: p.max_users != null ? String(p.max_users) : '',
        storage_limit: p.storage_limit || '', support_level: p.support_level || 'Email',
        is_featured: p.is_featured || false, badge: p.badge || '', color: p.color || '#5A51E8',
        description: p.description || '', best_for: p.best_for || '', status: p.status || 'active',
        trial_days: p.trial_days != null ? String(p.trial_days) : '',
        yearly_discount: p.yearly_discount != null ? String(p.yearly_discount) : '',
        is_custom: p.is_custom || false,
      });
      if (p.plan_modules) {
        setModuleAccess(prev => {
          const acc = { ...prev };
          p.plan_modules.forEach((pm: any) => { acc[pm.module_id] = pm.access_level; });
          return acc;
        });
      }
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [editId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      const modulesPayload = Object.entries(moduleAccess).map(([modId, level]) => ({
        module_id: Number(modId), access_level: level,
      }));
      const payload: Record<string, any> = {
        name: form.name, price: parseFloat(form.price) || 0, period: form.period,
        max_branches: form.max_branches ? parseInt(form.max_branches) : null,
        max_users: form.max_users ? parseInt(form.max_users) : null,
        storage_limit: form.storage_limit || null, support_level: form.support_level || null,
        is_featured: form.is_featured, badge: form.badge || null, color: form.color || null,
        description: form.description || null, best_for: form.best_for || null, status: form.status,
        trial_days: form.trial_days ? parseInt(form.trial_days) : null,
        yearly_discount: form.yearly_discount ? parseFloat(form.yearly_discount) : null,
        is_custom: form.is_custom, modules: modulesPayload,
      };
      if (isEdit) {
        await api.put(`/plans/${editId}`, payload);
        toast.success('Plan Updated', `"${form.name}" updated successfully`);
      } else {
        await api.post('/plans', payload);
        toast.success('Plan Created', `"${form.name}" created successfully`);
        setTimeout(() => onBack(), 1000);
      }
    } catch (err: any) {
      if (err.response?.status === 422) {
        setErrors(err.response.data.errors || {});
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        toast.error('Error', err.response?.data?.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => errors[key]?.[0];
  const includedCount = Object.values(moduleAccess).filter(a => a !== 'not_included').length;

  if (loadingData) {
    return <div className="text-center py-5"><Spinner color="primary" /> <span className="ms-2 text-muted">Loading plan...</span></div>;
  }

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              {isEdit ? 'Edit Plan' : 'Add New Plan'}
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Plans</a></li>
                <li className="breadcrumb-item active">{isEdit ? 'Edit' : 'New'}</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {errors.general && (
        <Alert color="danger"><i className="ri-error-warning-line me-1"></i>{errors.general[0]}</Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Row>
          {/* ── LEFT: Form ── */}
          <Col xl={8}>
            {/* Section A */}
            <Card>
              <CardHeader className="d-flex align-items-center gap-2">
                <div className="avatar-xs"><span className="avatar-title rounded bg-primary-subtle text-primary fs-4"><i className="ri-sparkling-line"></i></span></div>
                <h5 className="card-title mb-0 flex-grow-1">Plan Details</h5>
                <span className="badge bg-primary-subtle text-primary">Section A</span>
              </CardHeader>
              <CardBody>
                <Row className="g-3">
                  <Col md={4}>
                    <Label>Plan Name <span className="text-danger">*</span></Label>
                    <Input value={form.name} onChange={e => set('name', e.target.value)} invalid={!!fieldError('name')} placeholder="e.g. Pro, Business" />
                    {fieldError('name') && <div className="invalid-feedback d-block">{fieldError('name')}</div>}
                  </Col>
                  <Col md={4}>
                    <Label>Price <span className="text-danger">*</span></Label>
                    <InputGroup>
                      <InputGroupText>₹</InputGroupText>
                      <Input type="number" value={form.price} onChange={e => set('price', e.target.value)} invalid={!!fieldError('price')} placeholder="0" />
                    </InputGroup>
                  </Col>
                  <Col md={4}>
                    <Label>Billing Period <span className="text-danger">*</span></Label>
                    <Input type="select" value={form.period} onChange={e => set('period', e.target.value)}>
                      <option value="month">Monthly</option>
                      <option value="quarter">Quarterly</option>
                      <option value="year">Yearly</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label>Best For</Label>
                    <Input value={form.best_for} onChange={e => set('best_for', e.target.value)} placeholder="e.g. Small teams" />
                  </Col>
                  <Col md={4}>
                    <Label>Status</Label>
                    <Input type="select" value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label>Badge</Label>
                    <Input value={form.badge} onChange={e => set('badge', e.target.value)} placeholder="e.g. Most Popular" />
                  </Col>
                  <Col xs={12}>
                    <Label>Description</Label>
                    <Input type="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What this plan offers..." />
                  </Col>
                  <Col xs={12}>
                    <div className="d-flex gap-4 flex-wrap">
                      <div className="form-check form-switch">
                        <Input type="switch" id="is_featured" checked={form.is_featured} onChange={e => set('is_featured', e.target.checked)} />
                        <Label for="is_featured">Featured / Popular</Label>
                      </div>
                      <div className="form-check form-switch">
                        <Input type="switch" id="is_custom" checked={form.is_custom} onChange={e => set('is_custom', e.target.checked)} />
                        <Label for="is_custom">Custom Plan</Label>
                      </div>
                    </div>
                  </Col>
                </Row>
              </CardBody>
            </Card>

            {/* Section B: Limits */}
            <Card>
              <CardHeader className="d-flex align-items-center gap-2">
                <div className="avatar-xs"><span className="avatar-title rounded bg-success-subtle text-success fs-4"><i className="ri-shield-line"></i></span></div>
                <h5 className="card-title mb-0 flex-grow-1">Usage Limits</h5>
                <span className="badge bg-success-subtle text-success">Section B</span>
              </CardHeader>
              <CardBody>
                <Row className="g-3">
                  <Col md={3}>
                    <Label>Max Branches</Label>
                    <Input type="number" value={form.max_branches} onChange={e => set('max_branches', e.target.value)} placeholder="Leave blank = ∞" />
                  </Col>
                  <Col md={3}>
                    <Label>Max Users</Label>
                    <Input type="number" value={form.max_users} onChange={e => set('max_users', e.target.value)} placeholder="Leave blank = ∞" />
                  </Col>
                  <Col md={3}>
                    <Label>Storage Limit</Label>
                    <Input value={form.storage_limit} onChange={e => set('storage_limit', e.target.value)} placeholder="e.g. 25GB" />
                  </Col>
                  <Col md={3}>
                    <Label>Support Level</Label>
                    <Input type="select" value={form.support_level} onChange={e => set('support_level', e.target.value)}>
                      <option value="Email">Email</option>
                      <option value="Chat">Email + Chat</option>
                      <option value="Priority">Priority</option>
                      <option value="Dedicated">Dedicated</option>
                      <option value="Enterprise SLA">Enterprise SLA</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label>Trial Days</Label>
                    <Input type="number" value={form.trial_days} onChange={e => set('trial_days', e.target.value)} placeholder="e.g. 14" />
                  </Col>
                  <Col md={4}>
                    <Label>Yearly Discount (%)</Label>
                    <Input type="number" value={form.yearly_discount} onChange={e => set('yearly_discount', e.target.value)} placeholder="e.g. 20" />
                  </Col>
                  <Col md={4}>
                    <Label>Accent Color</Label>
                    <div className="d-flex gap-2">
                      <Input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ width: 48, height: 38 }} />
                      <Input value={form.color} onChange={e => set('color', e.target.value)} className="font-monospace" />
                    </div>
                  </Col>
                </Row>
              </CardBody>
            </Card>

            {/* Section C: Modules */}
            <Card>
              <CardHeader className="d-flex align-items-center gap-2">
                <div className="avatar-xs"><span className="avatar-title rounded bg-info-subtle text-info fs-4"><i className="ri-stack-line"></i></span></div>
                <h5 className="card-title mb-0 flex-grow-1">Module Access</h5>
                <span className="badge bg-info-subtle text-info">Section C · {includedCount}/{modules.length}</span>
              </CardHeader>
              <CardBody>
                <Alert color="info" className="d-flex align-items-center py-2">
                  <i className="ri-stack-line me-2"></i>
                  Select which modules are included in this plan.
                </Alert>

                <div className="d-flex gap-2 flex-wrap mb-3">
                  {(Object.entries(ACCESS_CFG) as [AccessLevel, typeof ACCESS_CFG.full][]).map(([key, s]) => (
                    <Badge key={key} color={s.color === 'light' ? 'light' : `${s.color}-subtle`} className={`text-${s.color === 'light' ? 'dark' : s.color}`}>
                      <i className={`${key === 'not_included' ? 'ri-close-line' : 'ri-check-line'} me-1`}></i>{s.label}
                    </Badge>
                  ))}
                </div>

                <div className="d-flex gap-2 mb-3">
                  <Button type="button" color="light" size="sm"
                    onClick={() => {
                      const acc: Record<number, AccessLevel> = {};
                      modules.forEach(m => { acc[m.id] = 'full'; });
                      setModuleAccess(acc);
                    }}>All Full</Button>
                  <Button type="button" color="light" size="sm"
                    onClick={() => {
                      const acc: Record<number, AccessLevel> = {};
                      modules.forEach(m => { acc[m.id] = 'not_included'; });
                      setModuleAccess(acc);
                    }}>Clear All</Button>
                </div>

                <Row className="g-3">
                  {modules.map(mod => {
                    const level = moduleAccess[mod.id] || 'not_included';
                    const included = level !== 'not_included';
                    return (
                      <Col md={6} key={mod.id}>
                        <div className={`p-3 rounded border ${included ? 'border-primary bg-primary bg-opacity-10' : 'border-light'}`}>
                          <div className="d-flex align-items-center gap-2 mb-2">
                            <div className={`avatar-xs rounded d-flex align-items-center justify-content-center fw-bold ${included ? 'bg-primary text-white' : 'bg-light text-muted'}`}>
                              {mod.name.charAt(0)}
                            </div>
                            <h6 className="mb-0 flex-grow-1">{mod.name}</h6>
                            {included && <i className="ri-checkbox-circle-fill text-success"></i>}
                          </div>
                          <div className="d-flex flex-wrap gap-1">
                            {(Object.keys(ACCESS_CFG) as AccessLevel[]).map(key => (
                              <Button key={key} type="button" size="sm"
                                color={level === key ? ACCESS_CFG[key].color : 'light'}
                                onClick={() => setModuleAccess(prev => ({ ...prev, [mod.id]: key }))}>
                                {ACCESS_CFG[key].label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              </CardBody>
            </Card>

            {/* Footer */}
            <Card>
              <CardBody className="d-flex justify-content-between align-items-center">
                <span className="text-muted fs-13">
                  {includedCount} modules included · Click <strong>{isEdit ? 'Update' : 'Create'} Plan</strong> to save
                </span>
                <div className="d-flex gap-2">
                  <Button type="button" color="light" onClick={onBack}>Cancel</Button>
                  <Button type="button" color="light"
                    onClick={() => {
                      setForm(empty);
                      const a: Record<number, AccessLevel> = {};
                      Object.keys(moduleAccess).forEach(k => a[Number(k)] = 'not_included');
                      setModuleAccess(a);
                    }}>
                    <i className="ri-restart-line me-1"></i> Reset
                  </Button>
                  <Button type="submit" color="success" disabled={saving}>
                    {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
                    {saving ? 'Saving...' : isEdit ? 'Update Plan' : 'Create Plan'}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </Col>

          {/* ── RIGHT: Live Preview ── */}
          <Col xl={4}>
            <div style={{ position: 'sticky', top: 80 }}>
              <Card className={`pricing-box ${form.is_featured ? 'ribbon-box right' : ''}`} style={form.is_featured ? { border: '2px solid var(--vz-primary)' } : {}}>
                {form.is_featured && form.badge && (
                  <div className="ribbon-two ribbon-two-primary"><span>{form.badge}</span></div>
                )}
                <CardBody>
                  <div className="text-center mb-4">
                    <h4 className="fw-semibold">{form.name || 'Plan Name'}</h4>
                    <div className="mt-3">
                      {parseFloat(form.price) <= 0 ? (
                        <h2 className="text-primary mb-0">Free</h2>
                      ) : (
                        <h2 className="mb-0">
                          <small className="fs-5 text-muted">₹</small>
                          {parseFloat(form.price || '0').toLocaleString()}
                          <small className="fs-13 text-muted fw-normal">{periodLabel[form.period]}</small>
                        </h2>
                      )}
                    </div>
                    {form.best_for && <p className="text-muted fs-13 mt-2">{form.best_for}</p>}
                  </div>

                  <Row className="gx-2 gy-2 mb-3">
                    {[['Branches', form.max_branches || '∞', 'ri-git-branch-line'], ['Users', form.max_users || '∞', 'ri-user-3-line'], ['Storage', form.storage_limit || '—', 'ri-hard-drive-2-line'], ['Support', form.support_level || '—', 'ri-customer-service-2-line']].map(([l, v, i]) => (
                      <Col xs={6} key={l}>
                        <div className="bg-light rounded p-2 text-center">
                          <i className={`${i} text-muted`}></i>
                          <div className="fs-11 text-muted text-uppercase">{l}</div>
                          <div className="fw-bold">{v}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>

                  <div className="border-top pt-3">
                    <p className="text-muted text-uppercase fs-11 fw-bold mb-2">Modules ({includedCount})</p>
                    {includedCount > 0 ? (
                      <div className="vstack gap-1">
                        {modules.filter(m => moduleAccess[m.id] !== 'not_included').map(m => (
                          <div key={m.id} className="d-flex justify-content-between fs-13">
                            <span>{m.name}</span>
                            <Badge color={`${ACCESS_CFG[moduleAccess[m.id]].color}-subtle`} className={`text-${ACCESS_CFG[moduleAccess[m.id]].color}`}>
                              {ACCESS_CFG[moduleAccess[m.id]].label}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted fst-italic fs-13 mb-0">No modules selected</p>
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>
          </Col>
        </Row>
      </Form>
    </>
  );
}
