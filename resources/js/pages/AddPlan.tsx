import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Spinner, Alert, Form, InputGroup, InputGroupText } from 'reactstrap';
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
        <Row className="g-3 mb-3 align-items-stretch">

          {/* ── LEFT: Unified form card (A + B inline sections) ── */}
          <Col xl={8} className="d-flex">
            <Card className="shadow-sm mb-0 w-100">
              <CardBody className="p-3">
                <style>{`
                  .stylish-label {
                    font-size: 11.5px;
                    font-weight: 600;
                    letter-spacing: 0.01em;
                    color: var(--vz-body-color);
                    margin-bottom: 5px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                  }
                  .stylish-label i { font-size: 13px; }
                  .stylish-input.form-control,
                  .stylish-input.form-select {
                    border: 1px solid var(--vz-border-color);
                    transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
                    background: var(--vz-card-bg);
                  }
                  .stylish-input.form-control:hover,
                  .stylish-input.form-select:hover {
                    border-color: var(--vz-border-color-translucent, rgba(64,81,137,0.45));
                  }
                  .stylish-input.form-control:focus,
                  .stylish-input.form-select:focus {
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
                  }
                  .stylish-switch .form-check-input {
                    width: 2.3em;
                    height: 1.25em;
                    cursor: pointer;
                    transition: all .18s ease;
                  }
                  .stylish-switch .form-check-input:checked {
                    background-color: #6366f1;
                    border-color: #6366f1;
                    box-shadow: 0 2px 8px rgba(99,102,241,0.40);
                  }
                  .section-head-premium {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 10px;
                    margin-bottom: 14px;
                  }
                  .section-head-premium .head-icon {
                    width: 30px; height: 30px;
                    border-radius: 8px;
                    display: flex; align-items: center; justify-content: center;
                    color: #fff;
                    flex-shrink: 0;
                  }
                  .stylish-toggle-card {
                    padding: 10px 12px;
                    border-radius: 10px;
                    border: 1px solid var(--vz-border-color);
                    background: var(--vz-card-bg);
                    display: flex; align-items: center; gap: 10px;
                    transition: all .18s ease;
                    cursor: pointer;
                    flex: 1;
                    min-width: 0;
                  }
                  .stylish-toggle-card:hover { border-color: rgba(99,102,241,0.45); background: rgba(99,102,241,0.04); }
                  .stylish-toggle-card.active { border-color: #6366f1; background: rgba(99,102,241,0.08); box-shadow: 0 2px 8px rgba(99,102,241,0.15); }
                `}</style>

                {/* ── Section A — Plan Details ── */}
                <div className="mb-4">
                  <div
                    className="section-head-premium"
                    style={{
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.02))',
                      border: '1px solid rgba(99,102,241,0.20)',
                    }}
                  >
                    <span
                      className="head-icon"
                      style={{
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        boxShadow: '0 4px 12px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.22)',
                      }}
                    >
                      <i className="ri-file-list-3-line" style={{ fontSize: 15 }} />
                    </span>
                    <div className="min-w-0 flex-grow-1">
                      <div className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.07em', lineHeight: 1.2, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                        Plan Details
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                        Pricing and basic info
                      </div>
                    </div>
                    <span
                      className="rounded-pill fw-bold text-uppercase"
                      style={{
                        background: 'rgba(99,102,241,0.15)',
                        color: '#6366f1',
                        border: '1px solid rgba(99,102,241,0.30)',
                        fontSize: 9,
                        padding: '2px 8px',
                        letterSpacing: '0.06em',
                      }}
                    >
                      A
                    </span>
                  </div>

                  <Row className="g-3">
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-bookmark-line" style={{ color: '#6366f1' }} />
                        Plan Name <span className="text-danger">*</span>
                      </label>
                      <Input bsSize="sm" className="stylish-input" value={form.name} onChange={e => set('name', e.target.value)} invalid={!!fieldError('name')} placeholder="e.g. Pro, Business" />
                      {fieldError('name') && <div className="invalid-feedback d-block">{fieldError('name')}</div>}
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-money-rupee-circle-line" style={{ color: '#10b981' }} />
                        Price <span className="text-danger">*</span>
                      </label>
                      <InputGroup size="sm">
                        <InputGroupText style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid var(--vz-border-color)', color: '#10b981', fontWeight: 700 }}>₹</InputGroupText>
                        <Input type="number" className="stylish-input" value={form.price} onChange={e => set('price', e.target.value)} invalid={!!fieldError('price')} placeholder="0" />
                      </InputGroup>
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-calendar-schedule-line" style={{ color: '#0ea5e9' }} />
                        Billing Period <span className="text-danger">*</span>
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="select" value={form.period} onChange={e => set('period', e.target.value)}>
                        <option value="month">Monthly</option>
                        <option value="quarter">Quarterly</option>
                        <option value="year">Yearly</option>
                      </Input>
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-team-line" style={{ color: '#f59e0b' }} />
                        Best For
                      </label>
                      <Input bsSize="sm" className="stylish-input" value={form.best_for} onChange={e => set('best_for', e.target.value)} placeholder="e.g. Small teams" />
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-toggle-line" style={{ color: '#10b981' }} />
                        Status
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="select" value={form.status} onChange={e => set('status', e.target.value)}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Input>
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-vip-crown-line" style={{ color: '#f59e0b' }} />
                        Badge Label
                      </label>
                      <Input bsSize="sm" className="stylish-input" value={form.badge} onChange={e => set('badge', e.target.value)} placeholder="e.g. Most Popular" />
                    </Col>
                    <Col xs={12}>
                      <label className="stylish-label">
                        <i className="ri-file-text-line" style={{ color: '#8b5cf6' }} />
                        Description
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of what this plan offers..." style={{ resize: 'none' }} />
                    </Col>
                    <Col xs={12}>
                      <div className="d-flex gap-2 flex-wrap">
                        <label
                          className={`stylish-toggle-card ${form.is_featured ? 'active' : ''}`}
                          htmlFor="is_featured"
                        >
                          <div
                            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                            style={{
                              width: 30, height: 30,
                              background: form.is_featured ? 'linear-gradient(135deg, #f59e0b, #f7b84b)' : 'rgba(245,158,11,0.15)',
                              color: form.is_featured ? '#fff' : '#f59e0b',
                              transition: 'all .18s ease',
                              boxShadow: form.is_featured ? '0 3px 8px rgba(245,158,11,0.40)' : 'none',
                            }}
                          >
                            <i className="ri-vip-crown-fill" style={{ fontSize: 14 }} />
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold" style={{ fontSize: 12.5, lineHeight: 1.2 }}>Featured / Popular</div>
                            <div className="text-muted" style={{ fontSize: 10.5, marginTop: 1 }}>Highlight this plan</div>
                          </div>
                          <div className="form-check form-switch stylish-switch m-0 flex-shrink-0">
                            <Input type="switch" id="is_featured" checked={form.is_featured} onChange={e => set('is_featured', e.target.checked)} />
                          </div>
                        </label>
                        <label
                          className={`stylish-toggle-card ${form.is_custom ? 'active' : ''}`}
                          htmlFor="is_custom"
                        >
                          <div
                            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                            style={{
                              width: 30, height: 30,
                              background: form.is_custom ? 'linear-gradient(135deg, #8b5cf6, #a78bfa)' : 'rgba(139,92,246,0.15)',
                              color: form.is_custom ? '#fff' : '#8b5cf6',
                              transition: 'all .18s ease',
                              boxShadow: form.is_custom ? '0 3px 8px rgba(139,92,246,0.40)' : 'none',
                            }}
                          >
                            <i className="ri-shape-line" style={{ fontSize: 14 }} />
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold" style={{ fontSize: 12.5, lineHeight: 1.2 }}>Custom Plan</div>
                            <div className="text-muted" style={{ fontSize: 10.5, marginTop: 1 }}>Tailored for client</div>
                          </div>
                          <div className="form-check form-switch stylish-switch m-0 flex-shrink-0">
                            <Input type="switch" id="is_custom" checked={form.is_custom} onChange={e => set('is_custom', e.target.checked)} />
                          </div>
                        </label>
                      </div>
                    </Col>
                  </Row>
                </div>

                {/* ── Section B — Usage Limits ── */}
                <div>
                  <div
                    className="section-head-premium"
                    style={{
                      background: 'linear-gradient(135deg, rgba(14,165,233,0.10), rgba(14,165,233,0.02))',
                      border: '1px solid rgba(14,165,233,0.20)',
                    }}
                  >
                    <span
                      className="head-icon"
                      style={{
                        background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
                        boxShadow: '0 4px 12px rgba(14,165,233,0.40), inset 0 1px 0 rgba(255,255,255,0.22)',
                      }}
                    >
                      <i className="ri-shield-check-line" style={{ fontSize: 15 }} />
                    </span>
                    <div className="min-w-0 flex-grow-1">
                      <div className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.07em', lineHeight: 1.2, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                        Usage Limits
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                        Quotas, trial, and accent color
                      </div>
                    </div>
                    <span
                      className="rounded-pill fw-bold text-uppercase"
                      style={{
                        background: 'rgba(14,165,233,0.15)',
                        color: '#0ea5e9',
                        border: '1px solid rgba(14,165,233,0.30)',
                        fontSize: 9,
                        padding: '2px 8px',
                        letterSpacing: '0.06em',
                      }}
                    >
                      B
                    </span>
                  </div>
                  <Row className="g-3">
                    <Col md={3}>
                      <label className="stylish-label">
                        <i className="ri-git-branch-line" style={{ color: '#6366f1' }} />
                        Max Branches
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="number" value={form.max_branches} onChange={e => set('max_branches', e.target.value)} placeholder="∞ unlimited" />
                    </Col>
                    <Col md={3}>
                      <label className="stylish-label">
                        <i className="ri-user-3-line" style={{ color: '#0ea5e9' }} />
                        Max Users
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="number" value={form.max_users} onChange={e => set('max_users', e.target.value)} placeholder="∞ unlimited" />
                    </Col>
                    <Col md={3}>
                      <label className="stylish-label">
                        <i className="ri-hard-drive-2-line" style={{ color: '#10b981' }} />
                        Storage Limit
                      </label>
                      <Input bsSize="sm" className="stylish-input" value={form.storage_limit} onChange={e => set('storage_limit', e.target.value)} placeholder="e.g. 25GB" />
                    </Col>
                    <Col md={3}>
                      <label className="stylish-label">
                        <i className="ri-customer-service-2-line" style={{ color: '#f59e0b' }} />
                        Support Level
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="select" value={form.support_level} onChange={e => set('support_level', e.target.value)}>
                        <option value="Email">Email</option>
                        <option value="Chat">Email + Chat</option>
                        <option value="Priority">Priority</option>
                        <option value="Dedicated">Dedicated</option>
                        <option value="Enterprise SLA">Enterprise SLA</option>
                      </Input>
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-time-line" style={{ color: '#10b981' }} />
                        Trial Days
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="number" value={form.trial_days} onChange={e => set('trial_days', e.target.value)} placeholder="e.g. 14" />
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-price-tag-3-line" style={{ color: '#ef4444' }} />
                        Yearly Discount (%)
                      </label>
                      <Input bsSize="sm" className="stylish-input" type="number" value={form.yearly_discount} onChange={e => set('yearly_discount', e.target.value)} placeholder="e.g. 20" />
                    </Col>
                    <Col md={4}>
                      <label className="stylish-label">
                        <i className="ri-palette-line" style={{ color: form.color }} />
                        Accent Color
                      </label>
                      <div className="d-flex gap-2 align-items-stretch">
                        <div
                          className="position-relative flex-shrink-0"
                          style={{
                            width: 42, height: 31,
                            borderRadius: 6,
                            border: `2px solid ${form.color}`,
                            background: form.color,
                            boxShadow: `0 3px 10px ${form.color}55, inset 0 1px 0 rgba(255,255,255,0.20)`,
                            cursor: 'pointer',
                            overflow: 'hidden',
                          }}
                        >
                          <Input
                            type="color"
                            value={form.color}
                            onChange={e => set('color', e.target.value)}
                            style={{
                              position: 'absolute', inset: 0,
                              width: '100%', height: '100%',
                              opacity: 0, cursor: 'pointer',
                              padding: 0, border: 'none',
                            }}
                          />
                        </div>
                        <Input bsSize="sm" className="stylish-input font-monospace" value={form.color} onChange={e => set('color', e.target.value)} />
                      </div>
                    </Col>
                  </Row>
                </div>

              </CardBody>
            </Card>
          </Col>

          {/* ── RIGHT: Premium Live Preview — matches left height, content scrolls internally ── */}
          <Col xl={4} className="d-flex">
            <style>{`
              @keyframes addplan-mesh {
                0%   { background-position: 0% 50%; }
                50%  { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
              @keyframes addplan-float-blob {
                0%, 100% { transform: translate(0, 0) scale(1); }
                33%      { transform: translate(8%, -6%) scale(1.08); }
                66%      { transform: translate(-6%, 6%) scale(0.96); }
              }
              @property --preview-angle {
                syntax: "<angle>";
                inherits: false;
                initial-value: 0turn;
              }
              @keyframes addplan-border-spin {
                to { --preview-angle: 1turn; }
              }
              /* Rotating gradient-border using conic-gradient + mask composite */
              .preview-card {
                isolation: isolate;
              }
              .preview-card::before {
                content: "";
                position: absolute;
                inset: -1px;
                z-index: 3;
                border-radius: inherit;
                padding: 1.5px;
                background: conic-gradient(
                  from var(--preview-angle),
                  var(--trail-base, #7c5cfc33) 0%,
                  var(--trail-base, #7c5cfc33) 72%,
                  var(--trail-glow, #7c5cfc) 82%,
                  var(--trail-glow, #fff) 88%,
                  var(--trail-glow, #7c5cfc) 94%,
                  var(--trail-base, #7c5cfc33) 100%
                );
                -webkit-mask:
                  linear-gradient(#000 0 0) content-box,
                  linear-gradient(#000 0 0);
                mask:
                  linear-gradient(#000 0 0) content-box,
                  linear-gradient(#000 0 0);
                -webkit-mask-composite: xor;
                mask-composite: exclude;
                pointer-events: none;
                animation: addplan-border-spin 4.5s linear infinite;
              }
              .preview-card:hover::before {
                animation-duration: 2.2s;
              }
              @supports not (background: paint(something)) {
                .preview-card::before {
                  animation: none;
                  background: conic-gradient(
                    var(--trail-base, #7c5cfc33) 0%,
                    var(--trail-base, #7c5cfc33) 72%,
                    var(--trail-glow, #7c5cfc) 88%,
                    var(--trail-base, #7c5cfc33) 100%
                  );
                }
              }
              @keyframes addplan-pulse-dot {
                0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.55); }
                70%      { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(255,255,255,0); }
              }
              @keyframes addplan-gradient-border {
                0%   { background-position: 0% 50%; }
                100% { background-position: 200% 50%; }
              }
              @keyframes addplan-tick-in {
                0%   { transform: scale(0) rotate(-90deg); opacity: 0; }
                100% { transform: scale(1) rotate(0deg); opacity: 1; }
              }
              .plan-preview-scroll {
                scrollbar-width: thin;
                scrollbar-color: rgba(124,92,252,0.30) transparent;
                mask-image: linear-gradient(180deg, #000 0%, #000 85%, transparent 100%);
                -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 85%, transparent 100%);
              }
              .plan-preview-scroll::-webkit-scrollbar { width: 3px; }
              .plan-preview-scroll::-webkit-scrollbar-track { background: transparent; }
              .plan-preview-scroll::-webkit-scrollbar-thumb { background: rgba(124,92,252,0.30); border-radius: 3px; }
              .plan-preview-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,92,252,0.55); }
              .plan-preview-tick { animation: addplan-tick-in .35s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
              .plan-preview-stat {
                position: relative;
                transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
              }
              .plan-preview-stat::before {
                content: ''; position: absolute; inset: 0; border-radius: inherit;
                padding: 1px;
                background: linear-gradient(135deg, var(--acc, #7c5cfc), transparent 50%, var(--acc, #7c5cfc));
                -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                -webkit-mask-composite: xor; mask-composite: exclude;
                opacity: 0.4; pointer-events: none;
              }
              .plan-preview-stat:hover { transform: translateY(-2px); }
              .plan-preview-stat:hover::before { opacity: 1; }
            `}</style>
            <div
              style={{
                position: 'sticky',
                top: 80,
                width: '100%',
                display: 'flex',
                alignSelf: 'stretch',
                maxHeight: 'calc(100vh - 100px)',
              }}
            >
              <Card
                className="preview-card position-relative mb-0 d-flex flex-column w-100"
                style={{
                  ['--trail-base' as any]: form.color + '26',
                  ['--trail-glow' as any]: form.color,
                  height: '100%',
                  minHeight: 0,
                  maxHeight: 'calc(100vh - 100px)',
                  borderRadius: 18,
                  border: `1px solid ${form.color}30`,
                  background: 'var(--vz-card-bg)',
                  boxShadow: `
                    0 20px 50px ${form.color}30,
                    0 12px 28px rgba(15,23,42,0.10),
                    0 4px 12px rgba(15,23,42,0.06),
                    inset 0 1px 0 rgba(255,255,255,0.70)
                  `,
                  transition: 'transform .25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow .25s ease, border-color .25s ease',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = 'translateY(-6px)';
                  el.style.boxShadow = `
                    0 32px 70px ${form.color}55,
                    0 16px 38px rgba(15,23,42,0.16),
                    0 6px 16px rgba(15,23,42,0.10),
                    inset 0 1px 0 rgba(255,255,255,0.85)
                  `;
                  el.style.borderColor = form.color + '70';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = 'translateY(0)';
                  el.style.boxShadow = `
                    0 20px 50px ${form.color}30,
                    0 12px 28px rgba(15,23,42,0.10),
                    0 4px 12px rgba(15,23,42,0.06),
                    inset 0 1px 0 rgba(255,255,255,0.70)
                  `;
                  el.style.borderColor = form.color + '30';
                }}
              >
                {/* ── Premium gradient hero with animated mesh + glass orbs ── */}
                <div
                  className="position-relative overflow-hidden flex-shrink-0"
                  style={{
                    padding: '24px 22px 28px',
                    background: `
                      radial-gradient(ellipse at top left, ${form.color}ee 0%, transparent 55%),
                      radial-gradient(ellipse at bottom right, ${form.color}dd 0%, transparent 60%),
                      linear-gradient(135deg, ${form.color} 0%, ${form.color}e5 50%, ${form.color}c8 100%)
                    `,
                    backgroundSize: '200% 200%',
                    animation: 'addplan-mesh 12s ease-in-out infinite',
                    borderRadius: '17px 17px 0 0',
                  }}
                >
                  {/* Decorative gold arc curves (certificate-style) */}
                  <svg
                    style={{
                      position: 'absolute',
                      top: -20, left: -30,
                      width: 180, height: 180,
                      pointerEvents: 'none',
                      opacity: 0.55,
                    }}
                    viewBox="0 0 200 200"
                    fill="none"
                  >
                    <path d="M -20 100 Q 60 30 140 60" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" fill="none" />
                    <path d="M -30 130 Q 70 50 160 80" stroke="rgba(255,255,255,0.22)" strokeWidth="1" fill="none" />
                    <path d="M -40 155 Q 80 70 180 100" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" fill="none" />
                  </svg>
                  <svg
                    style={{
                      position: 'absolute',
                      bottom: -30, right: -30,
                      width: 180, height: 180,
                      pointerEvents: 'none',
                      opacity: 0.45,
                      transform: 'rotate(180deg)',
                    }}
                    viewBox="0 0 200 200"
                    fill="none"
                  >
                    <path d="M -20 100 Q 60 30 140 60" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" fill="none" />
                    <path d="M -30 130 Q 70 50 160 80" stroke="rgba(255,255,255,0.22)" strokeWidth="1" fill="none" />
                    <path d="M -40 155 Q 80 70 180 100" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" fill="none" />
                  </svg>
                  {/* Floating glass orb - top right */}
                  <div
                    style={{
                      position: 'absolute',
                      top: -30, right: -40,
                      width: 140, height: 140,
                      borderRadius: '50%',
                      background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 40%, transparent 70%)',
                      filter: 'blur(2px)',
                      animation: 'addplan-float-blob 9s ease-in-out infinite',
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Floating glass orb - bottom left */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -50, left: -30,
                      width: 110, height: 110,
                      borderRadius: '50%',
                      background: 'radial-gradient(circle at 70% 30%, rgba(255,255,255,0.40) 0%, transparent 65%)',
                      filter: 'blur(3px)',
                      animation: 'addplan-float-blob 11s ease-in-out infinite',
                      animationDelay: '-3s',
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Subtle noise/dot pattern overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: 'radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)',
                      backgroundSize: '14px 14px',
                      pointerEvents: 'none',
                      opacity: 0.6,
                    }}
                  />
                  {/* Glossy top highlight */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, height: '45%',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)',
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Corner sparkles */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 14, right: 16,
                      color: 'rgba(255,255,255,0.75)',
                      fontSize: 11,
                      animation: 'addplan-pulse-dot 2.5s ease-in-out infinite',
                      animationDelay: '0.3s',
                      pointerEvents: 'none',
                    }}
                  >
                    <i className="ri-sparkling-2-fill" />
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 18, left: 18,
                      color: 'rgba(255,255,255,0.55)',
                      fontSize: 9,
                      animation: 'addplan-pulse-dot 3s ease-in-out infinite',
                      animationDelay: '1.2s',
                      pointerEvents: 'none',
                    }}
                  >
                    <i className="ri-sparkling-fill" />
                  </div>

                  <div className="position-relative text-center">
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
                      <span
                        className="d-inline-flex align-items-center gap-1 rounded-pill fw-bold"
                        style={{
                          background: 'rgba(255,255,255,0.18)',
                          color: '#fff',
                          fontSize: 9,
                          letterSpacing: '0.12em',
                          padding: '4px 11px',
                          textTransform: 'uppercase',
                          border: '1px solid rgba(255,255,255,0.35)',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
                        }}
                      >
                        <span
                          className="rounded-circle"
                          style={{
                            width: 5, height: 5,
                            background: '#fff',
                            animation: 'addplan-pulse-dot 1.6s ease-in-out infinite',
                          }}
                        />
                        Live Preview
                      </span>
                      {form.is_featured && form.badge && (
                        <span
                          className="rounded-pill fw-bold d-inline-flex align-items-center gap-1"
                          style={{
                            background: 'linear-gradient(135deg, #fef3c7, #fff)',
                            color: form.color,
                            fontSize: 9,
                            letterSpacing: '0.06em',
                            padding: '4px 11px',
                            textTransform: 'uppercase',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.9)',
                          }}
                        >
                          <i className="ri-vip-crown-fill" style={{ fontSize: 10, color: '#f59e0b' }} />{form.badge}
                        </span>
                      )}
                    </div>

                    <h4
                      className="fw-bold mb-0 lh-1 text-white"
                      style={{
                        fontSize: 22,
                        letterSpacing: '-0.02em',
                        textShadow: '0 2px 12px rgba(0,0,0,0.22)',
                      }}
                    >
                      {form.name || 'Plan Name'}
                    </h4>
                    {form.best_for && (
                      <p className="mb-0 mt-1" style={{ color: 'rgba(255,255,255,0.88)', fontSize: 11.5, fontWeight: 500 }}>
                        {form.best_for}
                      </p>
                    )}

                    {/* Decorative divider with sparkle */}
                    <div className="d-flex align-items-center justify-content-center gap-2 my-3">
                      <div
                        style={{
                          height: 1, width: 24,
                          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55))',
                        }}
                      />
                      <i className="ri-star-fill" style={{ color: 'rgba(255,255,255,0.80)', fontSize: 8 }} />
                      <div
                        style={{
                          height: 1, width: 24,
                          background: 'linear-gradient(90deg, rgba(255,255,255,0.55), transparent)',
                        }}
                      />
                    </div>

                    {parseFloat(form.price) <= 0 ? (
                      <div
                        className="fw-bold lh-1"
                        style={{
                          fontSize: '2.8rem',
                          letterSpacing: '-0.04em',
                          color: '#fff',
                          textShadow: '0 4px 18px rgba(0,0,0,0.30)',
                          fontWeight: 800,
                        }}
                      >
                        Free
                      </div>
                    ) : (
                      <div>
                        <div className="d-flex align-items-start justify-content-center gap-1 lh-1">
                          <span
                            style={{
                              fontSize: '1.1rem',
                              color: 'rgba(255,255,255,0.85)',
                              fontWeight: 700,
                              marginTop: 8,
                            }}
                          >
                            ₹
                          </span>
                          <span
                            className="fw-bold text-white"
                            style={{
                              fontSize: '2.8rem',
                              letterSpacing: '-0.04em',
                              textShadow: '0 3px 12px rgba(0,0,0,0.24)',
                              fontWeight: 800,
                            }}
                          >
                            {parseFloat(form.price || '0').toLocaleString()}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'rgba(255,255,255,0.80)',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            fontWeight: 600,
                            marginTop: 4,
                          }}
                        >
                          per {form.period === 'month' ? 'month' : form.period === 'quarter' ? 'quarter' : 'year'}
                        </div>
                        {form.yearly_discount && parseFloat(form.yearly_discount) > 0 && (
                          <div className="mt-2">
                            <span
                              className="rounded-pill fw-bold d-inline-flex align-items-center gap-1"
                              style={{
                                background: 'linear-gradient(135deg, #fff, #fef3c7)',
                                color: form.color,
                                fontSize: 9.5,
                                letterSpacing: '0.05em',
                                padding: '4px 11px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
                              }}
                            >
                              <i className="ri-price-tag-3-fill" style={{ fontSize: 10, color: '#f59e0b' }} />
                              Save {form.yearly_discount}% yearly
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Curved wave at the bottom - creates smooth transition */}
                  <svg
                    style={{
                      position: 'absolute',
                      bottom: -1, left: 0, right: 0,
                      width: '100%', height: 18,
                      pointerEvents: 'none',
                    }}
                    viewBox="0 0 100 18"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M0,18 Q25,0 50,9 T100,18 Z"
                      fill="var(--vz-card-bg)"
                      opacity="0.3"
                    />
                    <path
                      d="M0,18 Q25,8 50,14 T100,18 Z"
                      fill="var(--vz-card-bg)"
                    />
                  </svg>
                </div>

                <CardBody className="p-3 position-relative d-flex flex-column" style={{ zIndex: 1, flex: '1 1 0', minHeight: 0 }}>
                  {/* Stats 2×2 — each with unique accent color + gradient border */}
                  <Row className="gx-2 gy-2 mb-3">
                    {[
                      { l: 'Branches', v: form.max_branches  || '∞', ic: 'ri-git-branch-line',   color: '#6366f1' },
                      { l: 'Users',    v: form.max_users     || '∞', ic: 'ri-user-3-line',       color: '#0ea5e9' },
                      { l: 'Storage',  v: form.storage_limit || '∞', ic: 'ri-hard-drive-2-line', color: '#10b981' },
                      { l: 'Support',  v: form.support_level || '—', ic: 'ri-headphone-line',    color: '#f59e0b' },
                    ].map(({ l, v, ic, color: statColor }) => (
                      <Col xs={6} key={l}>
                        <div
                          className="plan-preview-stat rounded-2 d-flex align-items-center gap-2 px-2 py-2 position-relative"
                          style={{
                            ['--acc' as any]: statColor,
                            background: `linear-gradient(135deg, ${statColor}18 0%, ${statColor}08 50%, transparent 100%), var(--vz-card-bg)`,
                            border: `1px solid ${statColor}30`,
                            boxShadow: `0 2px 6px ${statColor}15, inset 0 1px 0 rgba(255,255,255,0.6)`,
                            overflow: 'hidden',
                          }}
                        >
                          {/* Corner dot glow */}
                          <div
                            style={{
                              position: 'absolute',
                              top: -20, right: -20,
                              width: 46, height: 46,
                              borderRadius: '50%',
                              background: `radial-gradient(circle, ${statColor}38 0%, transparent 70%)`,
                              pointerEvents: 'none',
                            }}
                          />
                          <div
                            className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0 position-relative"
                            style={{
                              width: 30, height: 30,
                              background: `linear-gradient(135deg, ${statColor}, ${statColor}cc)`,
                              boxShadow: `0 3px 8px ${statColor}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
                            }}
                          >
                            <i className={ic} style={{ color: '#fff', fontSize: 14 }} />
                          </div>
                          <div className="text-start min-w-0 flex-grow-1 position-relative">
                            <div
                              className="text-uppercase fw-semibold"
                              style={{ fontSize: 8.5, color: 'var(--vz-secondary-color)', letterSpacing: '0.07em', lineHeight: 1.2 }}
                            >
                              {l}
                            </div>
                            <div
                              className="fw-bold text-truncate"
                              style={{ fontSize: 12.5, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.25, marginTop: 1 }}
                            >
                              {v}
                            </div>
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>

                  {/* Module list — scrollable, fills remaining space */}
                  <div className="pt-2 d-flex flex-column" style={{ borderTop: `1px dashed ${form.color}35`, flex: '1 1 0', minHeight: 0 }}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span
                        className="d-inline-flex align-items-center gap-1 fw-bold text-uppercase"
                        style={{ fontSize: 9.5, letterSpacing: '0.07em', color: 'var(--vz-secondary-color)' }}
                      >
                        <i className="ri-stack-line" style={{ color: form.color, fontSize: 12 }} />
                        Included Modules
                      </span>
                      <span
                        className="rounded-pill fw-bold d-inline-flex align-items-center gap-1"
                        style={{
                          background: `linear-gradient(135deg, ${form.color}, ${form.color}dd)`,
                          color: '#fff',
                          fontSize: 9.5,
                          padding: '2px 9px',
                          boxShadow: `0 2px 6px ${form.color}55`,
                        }}
                      >
                        {includedCount}
                      </span>
                    </div>
                    {includedCount > 0 ? (
                      <div
                        className="pe-1 plan-preview-scroll"
                        style={{ overflowY: 'auto', flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
                      >
                        {modules.filter(m => moduleAccess[m.id] !== 'not_included').map((m, i) => {
                          const lvl = moduleAccess[m.id];
                          const iconClr = { full: '#10b981', limited: '#0ea5e9', addon: '#f59e0b' }[lvl as 'full' | 'limited' | 'addon'] ?? '#94a3b8';
                          return (
                            <div key={m.id} className="d-flex align-items-center gap-2" style={{ minWidth: 0, lineHeight: 1.35 }} title={m.name}>
                              <span
                                className="plan-preview-tick d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                                style={{
                                  width: 13, height: 13,
                                  background: `linear-gradient(135deg, ${iconClr}, ${iconClr}cc)`,
                                  boxShadow: `0 1px 4px ${iconClr}55`,
                                  animationDelay: `${Math.min(i * 0.03, 0.4)}s`,
                                }}
                              >
                                <i className="ri-check-line" style={{ color: '#fff', fontSize: 9, fontWeight: 700 }} />
                              </span>
                              <span className="text-body text-truncate flex-grow-1" style={{ fontSize: 10 }}>
                                {m.name}
                                {lvl && lvl !== 'full' && lvl !== 'not_included' && (
                                  <span className="text-muted ms-1" style={{ fontSize: 9 }}>({lvl})</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <div
                          className="d-inline-flex align-items-center justify-content-center rounded-3 mb-2"
                          style={{
                            width: 48, height: 48,
                            background: `linear-gradient(135deg, ${form.color}15, transparent)`,
                            border: `1px dashed ${form.color}50`,
                          }}
                        >
                          <i className="ri-layout-grid-line" style={{ fontSize: 22, color: form.color, opacity: 0.7 }}></i>
                        </div>
                        <p className="text-muted fs-11 mb-0">No modules selected yet</p>
                        <p className="text-muted fs-10 mb-0 mt-1" style={{ opacity: 0.75 }}>Click tiles below to include</p>
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
            <Card className="shadow-sm">
              <CardBody className="p-3">
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <i className="ri-stack-line" style={{ color: '#f7b84b', fontSize: 15, flexShrink: 0 }} />
                  <span className="fw-bold text-uppercase" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                    Module Access
                  </span>
                  <span style={{ color: 'var(--vz-secondary-color)', fontSize: 10, fontWeight: 400 }}>·</span>
                  <span style={{ color: 'var(--vz-secondary-color)', fontSize: 10.5 }}>
                    <span className="fw-semibold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{includedCount}</span> / {modules.length} included
                  </span>
                  <div className="d-flex align-items-center gap-1 ms-auto">
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
                </div>
                <div
                  style={{
                    height: 1,
                    background: 'linear-gradient(90deg, #f7b84b55 0%, var(--vz-border-color) 35%, transparent 100%)',
                    marginBottom: 12,
                  }}
                />

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
