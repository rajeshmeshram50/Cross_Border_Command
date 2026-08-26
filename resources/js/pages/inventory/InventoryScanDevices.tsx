import { useState, useMemo, useCallback } from 'react';
import {
  Card, CardBody, Button, Badge, Modal, ModalHeader, ModalBody, ModalFooter,
  Form, FormGroup, Label, Input, FormFeedback, Alert,
} from 'reactstrap';
import Swal from 'sweetalert2';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../contexts/ToastContext';
import InventoryTabs from './InventoryTabs';
import {
  listDevices, enrollDevice, serialExists, setDeviceStatus, rotateToken,
  getActiveDeviceId, setActiveDeviceId,
  type ScanDevice, type DeviceStatus,
} from './putAwayStore';
import '../../../css/inventory-scan.css';

const emptyForm = { serial: '', label: '', model: 'TC27', branch: '' };

const fmt = (v: string | null) => {
  if (!v) return 'Never';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const statusBadge = (s: DeviceStatus) =>
  s === 'active'    ? <Badge color="success">Active</Badge> :
  s === 'suspended' ? <Badge color="warning">Suspended</Badge> :
                      <Badge color="dark">Retired</Badge>;

export default function InventoryScanDevices() {
  const toast = useToast();
  const [rows, setRows] = useState<ScanDevice[]>(() => listDevices());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveDeviceId());
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* The enrollment secret is displayed exactly once, then never again —
     the same rule the technical document sets out. */
  const [issued, setIssued] = useState<{ label: string; token: string } | null>(null);

  const refresh = useCallback(() => {
    setRows(listDevices());
    setActiveId(getActiveDeviceId());
  }, []);

  const openNew = () => { setForm(emptyForm); setErrors({}); setModalOpen(true); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.serial.trim()) e.serial = 'Serial number is required.';
    else if (serialExists(form.serial)) e.serial = 'This serial is already enrolled.';
    if (!form.label.trim()) e.label = 'Give the device a name operators will recognise.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const { device, token } = enrollDevice(form);
    setModalOpen(false);
    setIssued({ label: device.label, token });
    refresh();
    toast.success('Device enrolled', `${device.label} can now scan company stickers.`);
  };

  const changeStatus = async (d: ScanDevice, status: DeviceStatus) => {
    const verb = status === 'active' ? 'Reactivate' : status === 'suspended' ? 'Suspend' : 'Retire';
    const res = await Swal.fire({
      title: `${verb} this device?`,
      html: `<b>${d.label}</b><br><span style="font-family:monospace">${d.serial}</span>` +
        (status !== 'active'
          ? '<br><br>Any put-away run in progress on it will be discarded.'
          : ''),
      icon: status === 'retired' ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: verb,
    });
    if (!res.isConfirmed) return;
    setDeviceStatus(d.id, status);
    refresh();
    toast.success(`Device ${status}`, d.label);
  };

  const onRotate = async (d: ScanDevice) => {
    const res = await Swal.fire({
      title: 'Rotate credential?',
      html: 'The old credential stops working immediately. The device cannot scan again ' +
            'until the new one is installed on it.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Rotate',
    });
    if (!res.isConfirmed) return;
    const token = rotateToken(d.id);
    setIssued({ label: d.label, token });
    refresh();
  };

  const useAsThisDevice = (id: string) => {
    setActiveDeviceId(id);
    refresh();
    toast.info('Handheld switched', 'The Put-Away screen now scans as this device.');
  };

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r => r.status === 'active').length,
    blocked: rows.filter(r => r.status !== 'active').length,
  }), [rows]);

  return (
    <div className="inv-scan">
      <PageHeader
        title="Scan Devices"
        subtitle="Allow-list of handhelds permitted to scan company stickers."
        icon={<i className="ri-tablet-line" />}
        actions={
          <Button color="primary" size="sm" onClick={openNew}>
            <i className="ri-add-line me-1" />Enroll device
          </Button>
        }
      />
      <InventoryTabs />

      <p className="text-muted fs-12">
        {counts.total} enrolled · {counts.active} active · {counts.blocked} blocked.
        A device with no credential on this list is refused before any product lookup runs.
      </p>

      <Card>
        <CardBody className="p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: '22%' }}>Device</th>
                  <th style={{ width: '16%' }}>Serial</th>
                  <th style={{ width: '10%' }}>Model</th>
                  <th style={{ width: '12%' }}>Branch</th>
                  <th style={{ width: '11%' }}>Status</th>
                  <th style={{ width: '15%' }}>Last seen</th>
                  <th style={{ width: '14%' }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted py-4">
                    No devices enrolled yet.
                  </td></tr>
                )}
                {rows.map(d => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.label}</strong>
                      {d.id === activeId && (
                        <Badge color="primary" className="ms-2">This handheld</Badge>
                      )}
                    </td>
                    <td className="inv-mono">{d.serial}</td>
                    <td>{d.model}</td>
                    <td>{d.branch || <span className="text-muted">—</span>}</td>
                    <td>{statusBadge(d.status)}</td>
                    <td className="inv-mono text-muted">{fmt(d.last_seen_at)}</td>
                    <td className="text-end">
                      <div className="d-inline-flex gap-1">
                        {d.id !== activeId && d.status === 'active' && (
                          <Button size="sm" color="light" title="Scan as this device"
                            onClick={() => useAsThisDevice(d.id)}>
                            <i className="ri-smartphone-line" />
                          </Button>
                        )}
                        <Button size="sm" color="light" title="Rotate credential"
                          onClick={() => onRotate(d)}>
                          <i className="ri-key-2-line" />
                        </Button>
                        {d.status === 'active' ? (
                          <Button size="sm" color="light" title="Suspend"
                            onClick={() => changeStatus(d, 'suspended')}>
                            <i className="ri-pause-circle-line" />
                          </Button>
                        ) : (
                          <Button size="sm" color="light" title="Reactivate"
                            onClick={() => changeStatus(d, 'active')}>
                            <i className="ri-play-circle-line" />
                          </Button>
                        )}
                        <Button size="sm" color="light" title="Retire"
                          onClick={() => changeStatus(d, 'retired')}>
                          <i className="ri-delete-bin-line text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ enroll modal */}
      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} centered>
        <ModalHeader toggle={() => setModalOpen(false)}>Enroll device</ModalHeader>
        <Form onSubmit={onSubmit}>
          <ModalBody>
            <FormGroup>
              <Label>Serial number <span className="text-danger">*</span></Label>
              <Input
                value={form.serial}
                invalid={!!errors.serial}
                placeholder="26013524701106"
                onChange={e => setForm({ ...form, serial: e.target.value })}
              />
              <FormFeedback>{errors.serial}</FormFeedback>
              <small className="text-muted">Printed on the device label and its box.</small>
            </FormGroup>
            <FormGroup>
              <Label>Device name <span className="text-danger">*</span></Label>
              <Input
                value={form.label}
                invalid={!!errors.label}
                placeholder="Warehouse A / Handheld 03"
                onChange={e => setForm({ ...form, label: e.target.value })}
              />
              <FormFeedback>{errors.label}</FormFeedback>
            </FormGroup>
            <FormGroup>
              <Label>Model</Label>
              <Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
            </FormGroup>
            <FormGroup className="mb-0">
              <Label>Branch / location</Label>
              <Input
                value={form.branch}
                placeholder="Nagpur"
                onChange={e => setForm({ ...form, branch: e.target.value })}
              />
            </FormGroup>
          </ModalBody>
          <ModalFooter>
            <Button color="light" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color="primary" type="submit">Enroll &amp; issue credential</Button>
          </ModalFooter>
        </Form>
      </Modal>

      {/* ------------------------------------------- credential shown once */}
      <Modal isOpen={!!issued} toggle={() => setIssued(null)} centered backdrop="static">
        <ModalHeader>Credential for {issued?.label}</ModalHeader>
        <ModalBody>
          <Alert color="warning" className="mb-3">
            <strong>Copy this now.</strong> It is shown once and cannot be retrieved
            afterwards. If it is lost, rotate the credential and install the new one.
          </Alert>
          <div className="inv-token">{issued?.token}</div>
          <p className="text-muted fs-12 mt-3 mb-0">
            Install it on the handheld during setup. The device sends it with every
            scan; the server refuses anything without it.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="light"
            onClick={() => {
              if (issued) navigator.clipboard?.writeText(issued.token)
                .then(() => toast.success('Copied', 'Credential copied to clipboard.'))
                .catch(() => toast.error('Copy failed', 'Select and copy it manually.'));
            }}
          >
            <i className="ri-file-copy-line me-1" />Copy
          </Button>
          <Button color="primary" onClick={() => setIssued(null)}>I&apos;ve saved it</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
