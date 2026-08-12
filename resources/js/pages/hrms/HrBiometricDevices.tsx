import { useState, useEffect, useMemo } from 'react';
import {
  Col, Row, Button, Input, Label, Spinner,
  Badge, Modal, ModalBody, ModalFooter, Form, FormFeedback,
} from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import Swal from 'sweetalert2';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import DataTable, { ActionCell, IdCell, TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import '../../../css/recruitment.css';

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

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     5+15+14+14+12+11+9+12+8. */
  const columns = useMemo<DataTableColumn<Terminal>[]>(() => [
    {
      header: 'Name',
      accessorKey: 'name',
      meta: { width: '15%' },
      cell: info => {
        const v = info.getValue() as string | null;
        return v ? <strong>{v}</strong> : <span className="text-muted">—</span>;
      },
    },
    {
      header: 'Serial No.',
      accessorKey: 'serial',
      meta: { width: '14%' },
      cell: info => <IdCell value={info.getValue() as string} />,
    },
    {
      header: 'Branch',
      id: 'branch',
      accessorFn: (t: Terminal) => t.branch?.name ?? '',
      meta: { width: '14%' },
      cell: info => <TruncCell value={info.row.original.branch?.name} caseSensitive />,
    },
    { header: 'Timezone', accessorKey: 'timezone', meta: { width: '12%' }, cell: info => <TruncCell value={info.getValue() as string} caseSensitive /> },
    {
      header: 'Allowed IPs',
      accessorKey: 'allowed_ips',
      meta: { width: '11%' },
      cell: info => {
        const v = info.getValue() as string | null;
        // "Any" is a real state, not missing data — an empty list accepts every IP.
        return v ? <TruncCell value={v} caseSensitive /> : <span title="Any IP accepted">Any</span>;
      },
    },
    {
      header: 'Status',
      id: 'status',
      accessorFn: (t: Terminal) => (t.is_active ? 'Active' : 'Inactive'),
      meta: { width: '9%', align: 'center' },
      cell: info => (
        <Badge color={info.row.original.is_active ? 'success' : 'secondary'} pill className="text-uppercase">
          {info.row.original.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      /* Sorts on the raw timestamp, not the formatted string — "Never" and
         locale-formatted dates would sort alphabetically otherwise. Nulls sort
         last so live devices lead. */
      header: 'Last Seen',
      id: 'last_seen',
      accessorFn: (t: Terminal) => (t.last_seen_at ? new Date(t.last_seen_at).getTime() : 0),
      meta: { width: '12%' },
      cell: info => <span className="text-muted">{fmtSeen(info.row.original.last_seen_at)}</span>,
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      meta: { align: 'center', width: '8%' },
      /* Shared <ActionCell> (.dt-act) — the Customer list's action button, so
         the column matches every other module instead of using reactstrap's
         soft-primary / soft-danger squares. */
      cell: info => (
        <div className="d-flex gap-1 justify-content-center">
          <ActionCell title="Edit"   icon="ri-pencil-line"     tone="info"   onClick={() => openEdit(info.row.original)} />
          <ActionCell title="Remove" icon="ri-delete-bin-line" tone="danger" onClick={() => handleDelete(info.row.original)} />
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

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
      {/* Header strip — the same frm-cstrip hero as Holiday / Broadcast Centre /
          Document Templates, instead of the bare Velzon page-title + breadcrumb
          row this page used to have. The eSSL enrollment rule (device User ID
          must equal the employee's Attendance Number) is the thing users get
          wrong most often, so it moves up here as the subtitle rather than
          sitting in a banner between the toolbar and the header row. */}
      <div className="rec-page biodev-page">
        <div className="frm-cstrip mb-3">
          <span className="frm-cstrip-accent" />
          <div className="frm-cstrip-left">
            <div className="frm-cstrip-icon"><i className="ri-fingerprint-line" /></div>
            <div className="min-w-0">
              <div className="frm-cstrip-title">eSSL / Biometric Terminals</div>
              <div className="frm-cstrip-sub">
                Register a device Serial No. and bind it to a branch. Enroll each employee on the device with User ID = their Attendance Number.
              </div>
            </div>
          </div>
        </div>

        {/* Shared list table (components/ui/DataTable) — search, sortable
            headers and the rows-per-page pager come from the component; the
            Import / Add buttons ride in its toolbar and use the module-standard
            .rec-btn-ghost / .rec-btn-primary pair (same as Holiday's Import
            Excel + Add Holiday) rather than reactstrap's blue soft-primary
            pills, which were the odd one out across HRMS. Search stays
            controlled because /device-terminals filters server-side. */}
        <DataTable<Terminal>
          data={items}
          columns={columns}
          serial
          accent="violet"
          autoFitRows
          fitToViewport
          minWidth={1250}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search serial or name…"
          emptyMessage={
            <>
              <i className="ri-fingerprint-line display-6 d-block mb-2" style={{ opacity: .4 }} />
              No biometric devices registered yet
            </>
          }
          toolbarActions={
            <>
              <button type="button" className="rec-btn-ghost" onClick={openImport}>
                <i className="ri-upload-2-line" />Import Punches
              </button>
              <button type="button" className="rec-btn-primary" onClick={openNew}>
                <i className="ri-add-line" />Add Device
              </button>
            </>
          }
        />
      </div>

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
