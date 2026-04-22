import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner,
  Table, Badge, Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, FormFeedback,
} from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import Swal from 'sweetalert2';

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

      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} centered backdrop="static">
        <ModalHeader toggle={() => setModalOpen(false)}>
          {editId ? 'Edit Organization Type' : 'Add Organization Type'}
        </ModalHeader>
        <Form onSubmit={handleSave}>
          <ModalBody>
            <FormGroup>
              <Label>Name <span className="text-danger">*</span></Label>
              <Input
                value={form.name}
                invalid={!!errors.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Manufacturing, Logistics"
                autoFocus
              />
              <FormFeedback>{errors.name}</FormFeedback>
            </FormGroup>
            <FormGroup>
              <Label>Icon (Remix Icon class)</Label>
              <div className="d-flex align-items-center gap-2">
                <div className="avatar-xs">
                  <span className="avatar-title rounded bg-primary-subtle text-primary fs-4">
                    <i className={form.icon || 'ri-building-line'}></i>
                  </span>
                </div>
                <Input
                  value={form.icon}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                  placeholder="ri-building-line"
                />
              </div>
              <small className="text-muted">
                Browse icons at <a href="https://remixicon.com" target="_blank" rel="noreferrer">remixicon.com</a>
              </small>
            </FormGroup>
            <FormGroup>
              <Label>Description</Label>
              <Input
                type="textarea"
                rows={2}
                value={form.description}
                invalid={!!errors.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Short description shown in admin lists"
              />
              <FormFeedback>{errors.description}</FormFeedback>
            </FormGroup>
            <Row>
              <Col md={6}>
                <FormGroup>
                  <Label>Status <span className="text-danger">*</span></Label>
                  <Input
                    type="select"
                    value={form.status}
                    invalid={!!errors.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as 'active' | 'inactive' }))}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Input>
                  <FormFeedback>{errors.status}</FormFeedback>
                </FormGroup>
              </Col>
              <Col md={6}>
                <FormGroup>
                  <Label>Sort Order</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="auto"
                  />
                </FormGroup>
              </Col>
            </Row>
          </ModalBody>
          <ModalFooter>
            <Button color="light" type="button" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button color="success" type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
              {editId ? 'Update' : 'Create'}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}
