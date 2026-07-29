import { useState, useEffect } from 'react';
import {
  Card, CardBody, CardHeader, Col, Row, Button, Input, Label, Spinner,
  Table, Badge, Modal, ModalBody, ModalFooter, Form, FormFeedback,
} from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import Swal from 'sweetalert2';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';

interface Terminal {
  id: number;
  client_id: number;
  branch_id: number | null;
  serial: string;
  name: string | null;
  timezone: string;
  allowed_ips: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  branch?: { id: number; name: string } | null;
}

interface BranchOpt { id: number; name: string; }

interface FormState {
  name: string;
  serial: string;
  branch_id: string;
  timezone: string;
  allowed_ips: string;
  is_active: 'active' | 'inactive';
}

const emptyForm: FormState = {
  name: '', serial: '', branch_id: '', timezone: 'Asia/Kolkata', allowed_ips: '', is_active: 'active',
};

const fmtSeen = (v: string | null): string => {
  if (!v) return 'Never';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

export default function HrBiometricDevices() {
  const toast = useToast();
  const [items, setItems] = useState<Terminal[]>([]);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Import-from-file modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDeviceId, setImportDeviceId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api.get('/device-terminals', { params: search ? { search } : {} })
      .then(res => setItems(Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])))
      .catch(() => toast.error('Load Failed', 'Could not load biometric devices'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search]);

  // Branch options for the optional device→branch binding.
  useEffect(() => {
    api.get('/branches')
      .then(res => {
        const rows = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
        setBranches(rows.map((b: any) => ({ id: b.id, name: b.name })));
      })
      .catch(() => { /* branch binding stays optional if this fails */ });
  }, []);

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (t: Terminal) => {
    setEditId(t.id);
    setForm({
      name: t.name || '',
      serial: t.serial,
      branch_id: t.branch_id != null ? String(t.branch_id) : '',
      timezone: t.timezone || 'Asia/Kolkata',
      allowed_ips: t.allowed_ips || '',
      is_active: t.is_active ? 'active' : 'inactive',
    });
    setErrors({});
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.serial.trim()) e.serial = 'Serial number is required';
    else if (form.serial.trim().length < 3) e.serial = 'Minimum 3 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: any = {
        serial: form.serial.trim(),
        name: form.name.trim() || null,
        timezone: form.timezone.trim() || 'Asia/Kolkata',
        allowed_ips: form.allowed_ips.trim() || null,
        is_active: form.is_active === 'active',
      };
      if (form.branch_id !== '') payload.branch_id = Number(form.branch_id);

      if (editId) {
        await api.put(`/device-terminals/${editId}`, payload);
        toast.success('Updated', 'Device updated');
      } else {
        await api.post('/device-terminals', payload);
        toast.success('Registered', 'Device added');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      if (err.response?.status === 422) {
        const apiErrs: Record<string, string> = {};
        Object.entries(err.response.data.errors || {}).forEach(([k, v]) => {
          apiErrs[k] = Array.isArray(v) ? (v as string[])[0] : String(v);
        });
        // A bare message (e.g. branch-not-in-client) surfaces as a toast too.
        if (Object.keys(apiErrs).length === 0 && err.response.data.message) {
          toast.error('Save Failed', err.response.data.message);
        }
        setErrors(apiErrs);
      } else {
        toast.error('Save Failed', err.response?.data?.message || 'Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: Terminal) => {
    const result = await Swal.fire({
      title: 'Remove Device?',
      html: `Remove <strong>"${t.name || t.serial}"</strong>? Punches already recorded are kept.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Remove',
      confirmButtonColor: '#f06548',
      cancelButtonColor: '#878a99',
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/device-terminals/${t.id}`);
      Swal.fire({ title: 'Removed!', text: `"${t.name || t.serial}" removed.`, icon: 'success', timer: 1500, showConfirmButton: false });
      load();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot remove this device');
    }
  };

  const openImport = () => {
    setImportFile(null);
    setImportDeviceId('');
    setImportResult(null);
    setImportOpen(true);
  };

  const doImport = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!importFile) { toast.error('No File', 'Choose an export file first'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importDeviceId) fd.append('device_terminal_id', importDeviceId);
      const res = await api.post('/attendance/import', fd);
      const summary = res.data?.data || res.data;
      setImportResult(summary);
      toast.success('Imported', `${summary.imported} punch(es) imported`);
      load();
    } catch (err: any) {
      toast.error('Import Failed', err.response?.data?.message || 'Could not import the file');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Biometric Devices</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item">HR</li>
                <li className="breadcrumb-item active">Biometric Devices</li>
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
                    <i className="ri-fingerprint-line fs-4 text-primary"></i>
                    <div>
                      <h5 className="mb-0">eSSL / Biometric Terminals</h5>
                      <small className="text-muted">Register a device Serial No. and bind it to a branch. Enroll each employee on the device with User ID = their Attendance Number.</small>
                    </div>
                  </div>
                </Col>
                <Col md={3}>
                  <div className="search-box">
                    <Input
                      type="text"
                      placeholder="Search serial or name…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </Col>
                <Col md={4} className="text-md-end d-flex gap-2 justify-content-md-end">
                  <Button color="soft-primary" className="btn-label waves-effect rounded-pill" onClick={openImport}>
                    <i className="ri-upload-2-line label-icon align-middle fs-16 me-2"></i>
                    Import Punches
                  </Button>
                  <Button color="primary" className="btn-label waves-effect waves-light rounded-pill" onClick={openNew}>
                    <i className="ri-add-line label-icon align-middle fs-16 me-2"></i>
                    Add Device
                  </Button>
                </Col>
              </Row>
            </CardHeader>

            <CardBody>
              {loading ? (
                <div className="text-center py-5"><Spinner color="primary" /></div>
              ) : items.length === 0 ? (
                <div className="text-center py-5">
                  <i className="ri-fingerprint-line display-5 text-muted"></i>
                  <p className="text-muted mt-2">No biometric devices registered yet</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table className="align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 60 }}>Sr No</th>
                        <th>Name</th>
                        <th>Serial No.</th>
                        <th>Branch</th>
                        <th>Timezone</th>
                        <th>Allowed IPs</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th>Last Seen</th>
                        <th style={{ width: 130 }} className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((t, i) => (
                        <tr key={t.id}>
                          <td className="text-muted">{i + 1}</td>
                          <td><strong>{t.name || '—'}</strong></td>
                          <td><code className="text-muted">{t.serial}</code></td>
                          <td className="text-muted">{t.branch?.name || '—'}</td>
                          <td className="text-muted">{t.timezone}</td>
                          <td className="text-muted">{t.allowed_ips || <span title="Any IP accepted">Any</span>}</td>
                          <td>
                            <Badge color={t.is_active ? 'success' : 'secondary'} pill className="text-uppercase">
                              {t.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="text-muted">{fmtSeen(t.last_seen_at)}</td>
                          <td className="text-end">
                            <Button size="sm" color="soft-primary" className="me-1" onClick={() => openEdit(t)} title="Edit">
                              <i className="ri-pencil-line"></i>
                            </Button>
                            <Button size="sm" color="soft-danger" onClick={() => handleDelete(t)} title="Remove">
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
        toggle={() => { /* explicit Cancel only */ }}
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
              <i className="ri-fingerprint-line" style={{ color: '#fff', fontSize: 22 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: 'rgb(64, 81, 137)', fontWeight: 900 }}>
                {editId ? 'Edit Device' : 'Register Device'}
              </h4>
              <small className="text-muted" style={{ fontSize: 12 }}>Serial No. is on the device: Menu → System → Device Info</small>
            </div>
          </div>
        </div>
        <Form onSubmit={handleSave}>
          <ModalBody className="p-4">
            <Row className="g-3">
              <Col md={6}>
                <Label>Serial No.<span className="req-star">*</span></Label>
                <div className="master-field">
                  <i className="ri-barcode-line master-field-icon" />
                  <Input
                    value={form.serial}
                    invalid={!!errors.serial}
                    onChange={e => setForm(f => ({ ...f, serial: e.target.value }))}
                    placeholder="e.g., NFZ8252004771"
                    autoFocus
                  />
                </div>
                <FormFeedback style={{ display: errors.serial ? 'block' : 'none', fontSize: 11.5, marginTop: 4 }}>{errors.serial}</FormFeedback>
              </Col>

              <Col md={6}>
                <Label>Device Name</Label>
                <div className="master-field">
                  <i className="ri-price-tag-3-line master-field-icon" />
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., Front door x2008"
                  />
                </div>
              </Col>

              <Col md={6}>
                <Label>Branch</Label>
                <div className="master-field sel">
                  <i className="ri-building-line master-field-icon" />
                  <MasterSelect
                    value={form.branch_id}
                    options={[
                      { value: '', label: '— No branch —' },
                      ...branches.map(b => ({ value: String(b.id), label: b.name })),
                    ]}
                    placeholder="Select branch…"
                    onChange={val => setForm(f => ({ ...f, branch_id: String(val) }))}
                  />
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>Punches from this device land under this branch.</small>
              </Col>

              <Col md={6}>
                <Label>Timezone</Label>
                <div className="master-field">
                  <i className="ri-time-line master-field-icon" />
                  <Input
                    value={form.timezone}
                    onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    placeholder="Asia/Kolkata"
                  />
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>The device clock's timezone (used to convert punch times).</small>
              </Col>

              <Col md={6}>
                <Label>Allowed IPs</Label>
                <div className="master-field">
                  <i className="ri-shield-check-line master-field-icon" />
                  <Input
                    value={form.allowed_ips}
                    onChange={e => setForm(f => ({ ...f, allowed_ips: e.target.value }))}
                    placeholder="e.g., 192.168.1.201 (blank = any)"
                  />
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>Comma-separated. Blank accepts any source IP.</small>
              </Col>

              <Col md={6}>
                <Label>Status</Label>
                <div className="master-field sel">
                  <i className="ri-pulse-line master-field-icon" />
                  <MasterSelect
                    value={form.is_active}
                    options={[
                      { value: 'active',   label: 'Active (accept punches)' },
                      { value: 'inactive', label: 'Inactive (ignore punches)' },
                    ]}
                    placeholder="Select status…"
                    onChange={val => setForm(f => ({ ...f, is_active: val as 'active' | 'inactive' }))}
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
                : (editId ? 'Update Device' : 'Register Device')}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>

      {/* Import punches from an eSSL export file (AttLog / CSV) */}
      <Modal
        isOpen={importOpen}
        toggle={() => setImportOpen(false)}
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
          <div className="d-flex align-items-center gap-3">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3"
              style={{ width: 48, height: 48, background: 'linear-gradient(135deg, rgb(64, 81, 137) 0%, rgb(102, 145, 231) 100%)', boxShadow: '0 6px 16px rgba(124,92,252,0.32)' }}
            >
              <i className="ri-upload-2-line" style={{ color: '#fff', fontSize: 22 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: 'rgb(64, 81, 137)', fontWeight: 900 }}>Import Punches</h4>
              <small className="text-muted" style={{ fontSize: 12 }}>Upload an eSSL export (AttLog .dat/.txt or CSV: UserID, DateTime, Status)</small>
            </div>
          </div>
        </div>
        <Form onSubmit={doImport}>
          <ModalBody className="p-4">
            <Row className="g-3">
              <Col md={12}>
                <Label>Attach to device <span className="text-muted">(optional)</span></Label>
                <div className="master-field sel">
                  <i className="ri-fingerprint-line master-field-icon" />
                  <MasterSelect
                    value={importDeviceId}
                    options={[
                      { value: '', label: '— None (use my client / IST) —' },
                      ...items.map(t => ({ value: String(t.id), label: `${t.name || t.serial}${t.branch?.name ? ' · ' + t.branch.name : ''}` })),
                    ]}
                    placeholder="Select device…"
                    onChange={val => setImportDeviceId(String(val))}
                  />
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>Inherits the device's branch &amp; timezone. Leave blank to use your client with IST.</small>
              </Col>

              <Col md={12}>
                <Label>Export file<span className="req-star">*</span></Label>
                <Input
                  type="file"
                  accept=".csv,.txt,.dat"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                />
                <small className="text-muted" style={{ fontSize: 11 }}>User IDs must match employees' Attendance Numbers. Times are read in the device timezone and stored in UTC.</small>
              </Col>

              {importResult && (
                <Col md={12}>
                  <div className="border rounded p-3 bg-light-subtle">
                    <div className="d-flex flex-wrap gap-3">
                      <span><Badge color="success" pill>{importResult.imported}</Badge> imported</span>
                      <span><Badge color="secondary" pill>{importResult.skipped_duplicates}</Badge> duplicates skipped</span>
                      <span><Badge color="info" pill>{importResult.employees_affected}</Badge> employees</span>
                      {importResult.date_range?.[0] && (
                        <span className="text-muted">{importResult.date_range[0]} → {importResult.date_range[1]}</span>
                      )}
                    </div>
                    {Array.isArray(importResult.unmatched_user_ids) && importResult.unmatched_user_ids.length > 0 && (
                      <div className="mt-2 text-danger" style={{ fontSize: 12 }}>
                        <i className="ri-error-warning-line me-1"></i>
                        Unmatched User IDs (no employee with that Attendance Number): {importResult.unmatched_user_ids.join(', ')}
                      </div>
                    )}
                    {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                      <div className="mt-1 text-warning" style={{ fontSize: 12 }}>
                        <i className="ri-alert-line me-1"></i>
                        {importResult.errors.length} row(s) skipped (e.g. before joining date / bad timestamp).
                      </div>
                    )}
                  </div>
                </Col>
              )}
            </Row>
          </ModalBody>
          <ModalFooter className="px-4 pb-3 justify-content-center gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            <button type="button" className="master-modal-cancel" onClick={() => setImportOpen(false)} disabled={importing}>
              <i className="ri-close-line align-middle me-1"></i>
              {importResult ? 'Close' : 'Cancel'}
            </button>
            <Button color="secondary" type="submit" disabled={importing || !importFile} className="btn-label waves-effect waves-light rounded-pill">
              {importing
                ? <Spinner size="sm" className="label-icon align-middle me-2" />
                : <i className="ri-upload-2-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}
