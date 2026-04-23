import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner, Alert, Form, InputGroup, InputGroupText } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props { onBack: () => void; editId?: number; }
interface ModuleOption { id: number; name: string; slug: string; icon: string; }
type AccessLevel = 'full' | 'limited' | 'addon' | 'not_included';

const ACCESS_CFG: Record<AccessLevel, { label: string; color: string; icon: string }> = {
  full:         { label: 'Full',         color: 'success',   icon: 'ri-checkbox-circle-fill' },
  limited:      { label: 'Limited',      color: 'info',      icon: 'ri-indeterminate-circle-fill' },
  addon:        { label: 'Add-on',       color: 'warning',   icon: 'ri-add-circle-fill' },
  not_included: { label: 'Not Included', color: 'secondary', icon: 'ri-close-circle-fill' },
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
  const [modSearch, setModSearch] = useState('');

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const CYCLE_ORDER: AccessLevel[] = ['not_included', 'full', 'limited', 'addon'];
  const cycleAccess = (id: number) =>
    setModuleAccess(prev => {
      const cur = prev[id] || 'not_included';
      const next = CYCLE_ORDER[(CYCLE_ORDER.indexOf(cur) + 1) % CYCLE_ORDER.length];
      return { ...prev, [id]: next };
    });

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
  const filteredModules = modules.filter(m =>
    m.name.toLowerCase().includes(modSearch.toLowerCase())
  );

  if (loadingData) {
    return <div className="text-center py-5"><Spinner color="primary" /> <span className="ms-2 text-muted">Loading plan...</span></div>;
  }

  return (
    <>
      {/* ── Page Header ── */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-soft-secondary rounded" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              <div>
                <h5 className="mb-0">{isEdit ? 'Edit Plan' : 'Add New Plan'}</h5>
                <p className="text-muted fs-12 mb-0">{isEdit ? 'Update subscription plan details' : 'Create a new subscription plan'}</p>
              </div>
            </div>
            <ol className="breadcrumb m-0">
              <li className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Plans</a></li>
              <li className="breadcrumb-item active">{isEdit ? 'Edit' : 'New'}</li>
            </ol>
          </div>
        </Col>
      </Row>

      {errors.general && (
        <Alert color="danger"><i className="ri-error-warning-line me-1"></i>{errors.general[0]}</Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Row className="g-3">

          {/* ── LEFT: Sections A & B ── */}
          <Col xl={8}>

            {/* Section A — Plan Details */}
            <Card className="mb-3 shadow-sm" style={{ borderLeft: '3px solid #405189' }}>
              <CardHeader className="d-flex align-items-center gap-2 py-2 border-bottom" style={{ background: 'linear-gradient(90deg, #40518912 0%, var(--vz-card-bg) 65%)' }}>
                <span className="d-inline-flex align-items-center justify-content-center rounded-1 bg-primary-subtle flex-shrink-0" style={{ width: 28, height: 28 }}>
                  <i className="ri-file-list-3-line text-primary fs-14"></i>
                </span>
                <h6 className="card-title mb-0 flex-grow-1 fw-semibold fs-14">Plan Details</h6>
                <span className="badge rounded-pill border fs-10 fw-normal px-2" style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-secondary-color)' }}>A</span>
              </CardHeader>
              <CardBody className="py-3">
                <Row className="g-2">
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Plan Name <span className="text-danger">*</span></Label>
                    <Input bsSize="sm" value={form.name} onChange={e => set('name', e.target.value)} invalid={!!fieldError('name')} placeholder="e.g. Pro, Business" />
                    {fieldError('name') && <div className="invalid-feedback d-block">{fieldError('name')}</div>}
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Price <span className="text-danger">*</span></Label>
                    <InputGroup size="sm">
                      <InputGroupText className="bg-light">₹</InputGroupText>
                      <Input type="number" value={form.price} onChange={e => set('price', e.target.value)} invalid={!!fieldError('price')} placeholder="0" />
                    </InputGroup>
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Billing Period <span className="text-danger">*</span></Label>
                    <Input bsSize="sm" type="select" value={form.period} onChange={e => set('period', e.target.value)}>
                      <option value="month">Monthly</option>
                      <option value="quarter">Quarterly</option>
                      <option value="year">Yearly</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Best For</Label>
                    <Input bsSize="sm" value={form.best_for} onChange={e => set('best_for', e.target.value)} placeholder="e.g. Small teams" />
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Status</Label>
                    <Input bsSize="sm" type="select" value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Badge Label</Label>
                    <Input bsSize="sm" value={form.badge} onChange={e => set('badge', e.target.value)} placeholder="e.g. Most Popular" />
                  </Col>
                  <Col xs={12}>
                    <Label className="form-label mb-1 fs-12">Description</Label>
                    <Input bsSize="sm" type="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of what this plan offers..." style={{ resize: 'none' }} />
                  </Col>
                  <Col xs={12}>
                    <div className="d-flex gap-4 flex-wrap">
                      <div className="form-check form-switch">
                        <Input type="switch" id="is_featured" checked={form.is_featured} onChange={e => set('is_featured', e.target.checked)} />
                        <Label for="is_featured" className="form-check-label fs-13">Featured / Popular</Label>
                      </div>
                      <div className="form-check form-switch">
                        <Input type="switch" id="is_custom" checked={form.is_custom} onChange={e => set('is_custom', e.target.checked)} />
                        <Label for="is_custom" className="form-check-label fs-13">Custom Plan</Label>
                      </div>
                    </div>
                  </Col>
                </Row>
              </CardBody>
            </Card>

            {/* Section B — Usage Limits */}
            <Card className="shadow-sm" style={{ borderLeft: '3px solid #299cdb' }}>
              <CardHeader className="d-flex align-items-center gap-2 py-2 border-bottom" style={{ background: 'linear-gradient(90deg, #299cdb12 0%, var(--vz-card-bg) 65%)' }}>
                <span className="d-inline-flex align-items-center justify-content-center rounded-1 bg-info-subtle flex-shrink-0" style={{ width: 28, height: 28 }}>
                  <i className="ri-shield-line text-info fs-14"></i>
                </span>
                <h6 className="card-title mb-0 flex-grow-1 fw-semibold fs-14">Usage Limits</h6>
                <span className="badge rounded-pill border fs-10 fw-normal px-2" style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-secondary-color)' }}>B</span>
              </CardHeader>
              <CardBody className="py-3">
                <Row className="g-2">
                  <Col md={3}>
                    <Label className="form-label mb-1 fs-12">Max Branches</Label>
                    <Input bsSize="sm" type="number" value={form.max_branches} onChange={e => set('max_branches', e.target.value)} placeholder="∞ unlimited" />
                  </Col>
                  <Col md={3}>
                    <Label className="form-label mb-1 fs-12">Max Users</Label>
                    <Input bsSize="sm" type="number" value={form.max_users} onChange={e => set('max_users', e.target.value)} placeholder="∞ unlimited" />
                  </Col>
                  <Col md={3}>
                    <Label className="form-label mb-1 fs-12">Storage Limit</Label>
                    <Input bsSize="sm" value={form.storage_limit} onChange={e => set('storage_limit', e.target.value)} placeholder="e.g. 25GB" />
                  </Col>
                  <Col md={3}>
                    <Label className="form-label mb-1 fs-12">Support Level</Label>
                    <Input bsSize="sm" type="select" value={form.support_level} onChange={e => set('support_level', e.target.value)}>
                      <option value="Email">Email</option>
                      <option value="Chat">Email + Chat</option>
                      <option value="Priority">Priority</option>
                      <option value="Dedicated">Dedicated</option>
                      <option value="Enterprise SLA">Enterprise SLA</option>
                    </Input>
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Trial Days</Label>
                    <Input bsSize="sm" type="number" value={form.trial_days} onChange={e => set('trial_days', e.target.value)} placeholder="e.g. 14" />
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Yearly Discount (%)</Label>
                    <Input bsSize="sm" type="number" value={form.yearly_discount} onChange={e => set('yearly_discount', e.target.value)} placeholder="e.g. 20" />
                  </Col>
                  <Col md={4}>
                    <Label className="form-label mb-1 fs-12">Accent Color</Label>
                    <div className="d-flex gap-2">
                      <Input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ width: 38, height: 31, padding: 2, cursor: 'pointer' }} />
                      <Input bsSize="sm" value={form.color} onChange={e => set('color', e.target.value)} className="font-monospace" />
                    </div>
                  </Col>
                </Row>
              </CardBody>
            </Card>

          </Col>

          {/* ── RIGHT: Live Preview ── */}
          <Col xl={4}>
            <div style={{ position: 'sticky', top: 80 }}>
              <Card style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${form.color}30`, boxShadow: `0 4px 24px ${form.color}18` }}>

                {/* Header */}
                <div className="text-center px-3 pt-3 pb-3"
                  style={{ background: `linear-gradient(160deg, ${form.color}12 0%, ${form.color}05 100%)`, borderBottom: `1px solid ${form.color}20` }}>

                  <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                    <span className="badge rounded-pill px-2 py-1 fs-10 fw-semibold"
                      style={{ background: form.color + '18', color: form.color, border: `1px solid ${form.color}35`, letterSpacing: '0.07em' }}>
                      LIVE PREVIEW
                    </span>
                    {form.is_featured && form.badge && (
                      <span className="badge rounded-pill px-2 py-1 fs-10"
                        style={{ background: '#f7b84b20', color: '#b07c1a', border: '1px solid #f7b84b50' }}>
                        ★ {form.badge}
                      </span>
                    )}
                  </div>

                  <h5 className="fw-bold mb-0 lh-1" style={{ color: form.color }}>
                    {form.name || 'Plan Name'}
                  </h5>
                  {form.best_for && <p className="text-muted fs-11 mb-0 mt-1">{form.best_for}</p>}

                  <div className="mx-auto my-2" style={{ height: 2, width: 36, background: form.color, borderRadius: 2, opacity: 0.35 }} />

                  {parseFloat(form.price) <= 0 ? (
                    <span className="fw-bold text-body" style={{ fontSize: '1.9rem' }}>Free</span>
                  ) : (
                    <div>
                      <div className="d-flex align-items-end justify-content-center gap-1 lh-1">
                        <span className="text-muted fw-normal mb-1" style={{ fontSize: '0.9rem' }}>₹</span>
                        <span className="fw-bold text-body" style={{ fontSize: '2rem', letterSpacing: '-1px' }}>
                          {parseFloat(form.price || '0').toLocaleString()}
                        </span>
                        <span className="text-muted fs-12 fw-normal mb-1">{periodLabel[form.period]}</span>
                      </div>
                      {form.yearly_discount && parseFloat(form.yearly_discount) > 0 && (
                        <div className="mt-1">
                          <span className="badge bg-success-subtle text-success fs-10">{form.yearly_discount}% off yearly</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <CardBody className="p-3">
                  {/* Stats 2×2 */}
                  <Row className="gx-2 gy-2 mb-3">
                    {[
                      { l: 'Branches', v: form.max_branches || '∞', ic: 'ri-git-branch-line' },
                      { l: 'Users',    v: form.max_users    || '∞', ic: 'ri-user-3-line' },
                      { l: 'Storage',  v: form.storage_limit || '∞', ic: 'ri-hard-drive-2-line' },
                      { l: 'Support',  v: form.support_level || '—', ic: 'ri-headphone-line' },
                    ].map(({ l, v, ic }) => (
                      <Col xs={6} key={l}>
                        <div
                          className="text-center py-2 px-1 rounded-2"
                          style={{ background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', transition: 'border-color 0.15s ease, box-shadow 0.15s ease', cursor: 'default' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = form.color; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 2px 10px ${form.color}25`; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--vz-border-color)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                        >
                          <i className={`${ic} d-block mb-1`} style={{ fontSize: 17, color: form.color, opacity: 0.8 }}></i>
                          <div className="fw-bold fs-13 text-body lh-sm">{v}</div>
                          <div className="text-muted fs-10">{l}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>

                  {/* Module list — scrollable */}
                  <div className="pt-2" style={{ borderTop: `1px solid ${form.color}20` }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fs-11 fw-semibold text-uppercase text-muted" style={{ letterSpacing: '0.06em' }}>Modules</span>
                      <span className="badge rounded-pill fs-10 px-2"
                        style={{ background: form.color + '18', color: form.color, border: `1px solid ${form.color}30` }}>
                        {includedCount} included
                      </span>
                    </div>
                    {includedCount > 0 ? (
                      <div className="vstack gap-1" style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {modules.filter(m => moduleAccess[m.id] !== 'not_included').map(m => {
                          const lvl = moduleAccess[m.id];
                          const iconClr = { full: '#0ab39c', limited: '#299cdb', addon: '#f7b84b' }[lvl as 'full' | 'limited' | 'addon'] ?? '#adb5bd';
                          return (
                            <div key={m.id} className="d-flex align-items-center gap-2" style={{ fontSize: 12, minWidth: 0 }}>
                              <i className="ri-checkbox-circle-fill flex-shrink-0" style={{ color: iconClr, fontSize: 13 }} />
                              <span className="text-body text-truncate flex-grow-1">{m.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <i className="ri-layout-grid-line fs-3 d-block mb-1" style={{ color: form.color, opacity: 0.3 }}></i>
                        <p className="text-muted fs-11 mb-0">No modules selected yet</p>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            </div>
          </Col>
        </Row>

        {/* Section C — Module Access */}
        <Row className="mt-0">
          <Col xs={12}>
            <Card className="shadow-sm" style={{ borderLeft: '3px solid #f7b84b' }}>
              <CardHeader className="d-flex align-items-center gap-2 py-2 border-bottom" style={{ background: 'linear-gradient(90deg, #f7b84b10 0%, var(--vz-card-bg) 65%)' }}>
                <span className="d-inline-flex align-items-center justify-content-center rounded-1 bg-warning-subtle flex-shrink-0" style={{ width: 28, height: 28 }}>
                  <i className="ri-stack-line text-warning fs-14"></i>
                </span>
                <h6 className="card-title mb-0 fw-semibold fs-14">Module Access</h6>
                <span className="text-muted fs-12 ms-1 me-auto">
                  <span className="fw-semibold text-body">{includedCount}</span> / {modules.length} included
                </span>
                <div className="d-flex align-items-center gap-1">
                  <button type="button" className="btn btn-sm btn-light border px-2 py-1"
                    onClick={() => { const a: Record<number, AccessLevel> = {}; modules.forEach(m => { a[m.id] = 'full'; }); setModuleAccess(a); }}>
                    <i className="ri-checkbox-circle-line me-1 text-success fs-12"></i>
                    <span className="fs-12">All Full</span>
                  </button>
                  <button type="button" className="btn btn-sm btn-light border px-2 py-1"
                    onClick={() => { const a: Record<number, AccessLevel> = {}; modules.forEach(m => { a[m.id] = 'not_included'; }); setModuleAccess(a); }}>
                    <i className="ri-close-circle-line me-1 text-danger fs-12"></i>
                    <span className="fs-12">Clear</span>
                  </button>
                </div>
              </CardHeader>

              <CardBody className="pt-3 pb-3">
                {/* Search + hint row */}
                <div className="d-flex align-items-center gap-3 mb-3">
                  <div className="position-relative flex-grow-1">
                    <i className="ri-search-line position-absolute text-muted" style={{ left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 13 }}></i>
                    <Input value={modSearch} onChange={e => setModSearch(e.target.value)} placeholder="Search modules..." style={{ paddingLeft: 28 }} bsSize="sm" />
                  </div>
                  <span className="text-muted fs-11 flex-shrink-0">
                    <i className="ri-click-line me-1"></i>Click tile to cycle access
                  </span>
                </div>

                {/* Module grid */}
                <div style={{ maxHeight: 460, overflowY: 'auto' }} className="pe-1">
                  {filteredModules.length === 0 ? (
                    <div className="text-center text-muted py-4 fs-13">
                      <i className="ri-search-line d-block fs-3 mb-1 opacity-40"></i>
                      No modules match "{modSearch}"
                    </div>
                  ) : (
                    <div className="row g-2">
                      {filteredModules.map(mod => {
                        const level = moduleAccess[mod.id] || 'not_included';
                        const cfg = ACCESS_CFG[level];
                        const isActive = level !== 'not_included';
                        return (
                          <div key={mod.id} className="col-4">
                            <div
                              className="d-flex align-items-center gap-2 px-2 py-2 rounded-2"
                              style={{
                                cursor: 'pointer',
                                userSelect: 'none',
                                transition: 'all 0.13s ease',
                                background: 'var(--vz-card-bg)',
                                border: isActive
                                  ? `1.5px solid ${{ full: '#0ab39c', limited: '#299cdb', addon: '#f7b84b' }[level as 'full' | 'limited' | 'addon']}`
                                  : '1px solid var(--vz-border-color)',
                                boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.07)' : 'none',
                              }}
                              onClick={() => cycleAccess(mod.id)}
                              title="Click to cycle: Not Included → Full → Limited → Add-on"
                            >
                              <span
                                className={`d-inline-flex align-items-center justify-content-center rounded-1 flex-shrink-0 fw-bold fs-11 ${isActive ? `bg-${cfg.color}-subtle text-${cfg.color}` : 'bg-light text-muted'}`}
                                style={{ width: 26, height: 26 }}
                              >
                                {mod.name.charAt(0).toUpperCase()}
                              </span>
                              <span className="fw-medium fs-13 text-body flex-grow-1 text-truncate">{mod.name}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>

        {/* Footer */}
        <Row>
          <Col xs={12}>
            <div className="d-flex justify-content-between align-items-center py-3 px-1">
              <span className="text-muted fs-13">
                <i className="ri-information-line me-1"></i>
                <strong className="text-body">{includedCount}</strong> modules selected
                {form.name && <> · <span className="text-body">{form.name}</span></>}
              </span>
              <div className="d-flex gap-2">
                <Button type="button" color="light" className="px-3" onClick={onBack}>Cancel</Button>
                <Button type="button" color="light" className="px-3"
                  onClick={() => {
                    setForm(empty);
                    const a: Record<number, AccessLevel> = {};
                    Object.keys(moduleAccess).forEach(k => { a[Number(k)] = 'not_included'; });
                    setModuleAccess(a);
                  }}>
                  <i className="ri-restart-line me-1"></i>Reset
                </Button>
                <Button type="submit" color="primary" className="px-4" disabled={saving}>
                  {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
                  {saving ? 'Saving...' : isEdit ? 'Update Plan' : 'Create Plan'}
                </Button>
              </div>
            </div>
          </Col>
        </Row>

      </Form>
    </>
  );
}
