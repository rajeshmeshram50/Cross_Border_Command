import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner,
  Table, Badge, Modal, ModalBody, ModalFooter, Form, FormFeedback,
} from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import Swal from 'sweetalert2';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';

interface OrgType {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  status: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

interface FormState {
  name: string;
  icon: string;
  description: string;
  status: 'active' | 'inactive';
  sort_order: string;
}

const emptyForm: FormState = {
  name: '', icon: 'ri-building-line', description: '', status: 'active', sort_order: '',
};

export default function OrganizationTypes() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<OrgType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    api.get('/organization-types', { params: search ? { search } : {} })
      .then(res => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => toast.error('Load Failed', 'Could not load organization types'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search]);

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (t: OrgType) => {
    setEditId(t.id);
    setForm({
      name: t.name,
      icon: t.icon || 'ri-building-line',
      description: t.description || '',
      status: (t.status as 'active' | 'inactive') || 'active',
      sort_order: String(t.sort_order ?? ''),
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    else if (form.name.length < 2) e.name = 'Minimum 2 characters';
    if (!form.status) e.status = 'Status is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        icon: form.icon.trim() || null,
        description: form.description.trim() || null,
        status: form.status,
      };
      if (form.sort_order !== '') payload.sort_order = Number(form.sort_order);

      if (editId) {
        await api.put(`/organization-types/${editId}`, payload);
        toast.success('Updated', 'Organization type updated');
      } else {
        await api.post('/organization-types', payload);
        toast.success('Created', 'Organization type added');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      if (err.response?.status === 422) {
        const apiErrs: Record<string, string> = {};
        Object.entries(err.response.data.errors || {}).forEach(([k, v]) => {
          apiErrs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        });
        setErrors(apiErrs);
      } else if (err.response?.status === 403) {
        toast.error('Forbidden', 'Only super admin can manage organization types');
      } else {
        toast.error('Save Failed', err.response?.data?.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: OrgType) => {
    const result = await Swal.fire({
      title: 'Delete Organization Type?',
      html: `Remove <strong>"${t.name}"</strong>?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#f06548',
      cancelButtonColor: '#878a99',
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/organization-types/${t.id}`);
      Swal.fire({ title: 'Deleted!', text: `"${t.name}" removed.`, icon: 'success', timer: 1500, showConfirmButton: false });
      load();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot delete this type');
    }
  };

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <button
                className="btn btn-soft-primary btn-icon rounded-circle"
                style={{ width: 36, height: 36 }}
                onClick={() => navigate('/master')}
                title="Back to master"
              >
                <i className="ri-arrow-left-line fs-16"></i>
              </button>
              <h4 className="mb-sm-0">Organization Types</h4>
            </div>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item">
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate('/master'); }}>Master</a>
                </li>
                <li className="breadcrumb-item active">Organization Types</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card className="shadow-sm">
            <CardHeader className="bg-light-subtle border-bottom">
              <Row className="g-2 align-items-center">
                <Col md={5}>
                  <div className="d-flex align-items-center gap-2">
                    <i className="ri-building-line fs-4 text-primary"></i>
                    <div>
                      <h5 className="mb-0">Manage Organization Types</h5>
                      <small className="text-muted">Used in client registration dropdown</small>
                    </div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="search-box">
                    <Input
                      type="text"
                      placeholder="Search by name…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </Col>
                <Col md={3} className="text-md-end">
                  <Button color="primary" className="btn-label waves-effect waves-light rounded-pill" onClick={openNew}>
                    <i className="ri-add-line label-icon align-middle fs-16 me-2"></i>
                    Add New
                  </Button>
                </Col>
              </Row>
            </CardHeader>

            <CardBody>
              {loading ? (
                <div className="text-center py-5"><Spinner color="primary" /></div>
              ) : items.length === 0 ? (
                <div className="text-center py-5">
                  <i className="ri-inbox-line display-5 text-muted"></i>
                  <p className="text-muted mt-2">No organization types found</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table className="align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 60 }}>#</th>
                        <th style={{ width: 70 }}>Icon</th>
                        <th>Name</th>
                        <th>Slug</th>
                        <th>Description</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th style={{ width: 80 }}>Order</th>
                        <th style={{ width: 150 }} className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((t, i) => (
                        <tr key={t.id}>
                          <td className="text-muted">{i + 1}</td>
                          <td>
                            <div className="avatar-xs">
                              <span className="avatar-title rounded bg-primary-subtle text-primary fs-4">
                                <i className={t.icon || 'ri-building-line'}></i>
                              </span>
                            </div>
                          </td>
                          <td><strong>{t.name}</strong></td>
                          <td><code className="text-muted">{t.slug}</code></td>
                          <td className="text-muted">{t.description || '—'}</td>
                          <td>
                            <Badge color={t.status === 'active' ? 'success' : 'secondary'} pill className="text-uppercase">
                              {t.status}
                            </Badge>
                          </td>
                          <td className="text-muted">{t.sort_order}</td>
                          <td className="text-end">
                            <Button size="sm" color="soft-primary" className="me-1" onClick={() => openEdit(t)} title="Edit">
                              <i className="ri-pencil-line"></i>
                            </Button>
                            <Button size="sm" color="soft-danger" onClick={() => handleDelete(t)} title="Delete">
                              <i className="ri-delete-bin-line"></i>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <MasterFormStyles />
      <Modal
        isOpen={modalOpen}
        toggle={() => { /* explicit Cancel only — outside click & Esc disabled */ }}
        centered
        modalClassName="master-modal"
        backdrop="static"
        keyboard={false}
      >
        <div
          className="position-relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(124,92,252,0.10) 0%, rgba(169,147,253,0.05) 60%, var(--vz-card-bg) 100%)',
            padding: '22px 26px',
            borderBottom: '1px solid var(--vz-border-color)',
          }}
        >
          <div className="d-flex align-items-center gap-3 position-relative">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3"
              style={{
                width: 48, height: 48,
                background: 'linear-gradient(135deg, rgb(64, 81, 137) 0%, rgb(102, 145, 231) 100%)',
                boxShadow: '0 6px 16px rgba(124,92,252,0.32)',
              }}
            >
              <i className="ri-building-line" style={{ color: '#fff', fontSize: 22 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: 'rgb(64, 81, 137)', fontWeight: 900 }}>
                {editId ? 'Edit Organization Type' : 'Add Organization Type'}
              </h4>
              <small className="text-muted" style={{ fontSize: 12 }}>Used in client registration dropdown</small>
            </div>
          </div>
        </div>
        <Form onSubmit={handleSave}>
          <ModalBody className="p-4">
            <Row className="g-3">
              <Col md={12}>
                <Label>Name<span className="req-star">*</span></Label>
                <div className="master-field">
                  <i className="ri-price-tag-3-line master-field-icon" />
                  <Input
                    value={form.name}
                    invalid={!!errors.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., Manufacturing, Logistics"
                    autoFocus
                  />
                </div>
                <FormFeedback style={{ display: errors.name ? 'block' : 'none', fontSize: 11.5, marginTop: 4 }}>{errors.name}</FormFeedback>
              </Col>

              <Col md={12}>
                <Label>Icon (Remix Icon class)</Label>
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                    style={{
                      width: 38, height: 38,
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.06))',
                      border: '1px solid rgba(99,102,241,0.25)',
                      color: '#6366f1',
                      fontSize: 18,
                    }}
                  >
                    <i className={form.icon || 'ri-building-line'}></i>
                  </span>
                  <div className="master-field flex-grow-1">
                    <i className="ri-code-s-slash-line master-field-icon" />
                    <Input
                      value={form.icon}
                      onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                      placeholder="ri-building-line"
                    />
                  </div>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>
                  Browse icons at <a href="https://remixicon.com" target="_blank" rel="noreferrer">remixicon.com</a>
                </small>
              </Col>

              <Col md={12}>
                <Label>Description</Label>
                <div className="master-field ta">
                  <i className="ri-file-text-line master-field-icon ta" />
                  <Input
                    type="textarea"
                    rows={3}
                    value={form.description}
                    invalid={!!errors.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Short description shown in admin lists"
                  />
                </div>
                <FormFeedback style={{ display: errors.description ? 'block' : 'none', fontSize: 11.5, marginTop: 4 }}>{errors.description}</FormFeedback>
              </Col>

              <Col md={6}>
                <Label>Status<span className="req-star">*</span></Label>
                <div className="master-field sel">
                  <i className="ri-pulse-line master-field-icon" />
                  <MasterSelect
                    value={form.status}
                    options={[
                      { value: 'active',   label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                    ]}
                    placeholder="Select status…"
                    invalid={!!errors.status}
                    onChange={val => setForm(f => ({ ...f, status: val as 'active' | 'inactive' }))}
                  />
                </div>
                {errors.status && (
                  <div style={{ color: '#f06548', fontSize: 11.5, marginTop: 4 }}>{errors.status}</div>
                )}
              </Col>

              <Col md={6}>
                <Label>Sort Order</Label>
                <div className="master-field">
                  <i className="ri-hashtag master-field-icon" />
                  <Input
                    type="number"
                    min={0}
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="auto"
                  />
                </div>
              </Col>
            </Row>
          </ModalBody>
          <ModalFooter className="px-4 pb-3 justify-content-center gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            <button
              type="button"
              className="master-modal-cancel"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              <i className="ri-close-line align-middle me-1"></i>
              Cancel
            </button>
            <Button
              color="secondary"
              type="submit"
              disabled={saving}
              className="btn-label waves-effect waves-light rounded-pill"
            >
              {saving
                ? <Spinner size="sm" className="label-icon align-middle me-2" />
                : <i className="ri-save-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
              {saving
                ? (editId ? 'Updating...' : 'Saving...')
                : (editId ? 'Update Record' : 'Save Record')}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}
