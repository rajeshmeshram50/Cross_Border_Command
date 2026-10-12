import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  Card, CardBody, Button, Badge, Modal, ModalHeader, ModalBody, ModalFooter,
  Form, FormGroup, Label, Input, FormFeedback, Alert,
} from 'reactstrap';
import Swal from 'sweetalert2';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../contexts/ToastContext';
import InventoryTabs from './InventoryTabs';
import {
  listDevices, enrollDevice, setDeviceStatus, rotateToken,
  verifyDevice, makeEnrollUrl,
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

/** Enrollment QR — scanned BY the handheld so its own browser gets the credential. */
function EnrollQr({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, url, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).catch(() => {});
  }, [url]);
  return <canvas ref={ref} width={220} height={220} />;
}

const apiError = (e: unknown, fallback: string) => {
  const r = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
  return r?.errors ? Object.values(r.errors)[0]?.[0] ?? fallback : r?.message ?? fallback;
};

export default function InventoryScanDevices() {
  const toast = useToast();
  const [rows, setRows] = useState<ScanDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* The enrollment secret is displayed exactly once, then never again —
     the same rule the technical document sets out. */
  const [issued, setIssued] = useState<{ label: string; token: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([listDevices(), verifyDevice()]);
      setRows(list);
      setActiveId(me?.id ?? null);
    } catch (e) {
      toast.error('Could not load devices', apiError(e, 'Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const openNew = () => { setForm(emptyForm); setErrors({}); setModalOpen(true); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.serial.trim()) e.serial = 'Serial number is required.';
    else if (rows.some(r => r.serial === form.serial.trim())) e.serial = 'This serial is already enrolled.';
    if (!form.label.trim()) e.label = 'Give the device a name operators will recognise.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const { device, token } = await enrollDevice(form);
      setModalOpen(false);
      setIssued({ label: device.label, token });
      refresh();
      toast.success('Device enrolled', 'Scan the QR with the handheld to install its credential.');
    } catch (e) {
      setErrors({ serial: apiError(e, 'Could not enroll the device.') });
    } finally {
      setSaving(false);
    }
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
    try {
      await setDeviceStatus(d.id, status);
      refresh();
      toast.success(`Device ${status}`, d.label);
    } catch (e) {
      toast.error('Update failed', apiError(e, 'Please try again.'));
    }
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
    try {
      const token = await rotateToken(d.id);
      setIssued({ label: d.label, token });
      refresh();
    } catch (e) {
      toast.error('Rotate failed', apiError(e, 'Please try again.'));
    }
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
                {loading && (
                  <tr><td colSpan={7} className="text-center text-muted py-4">Loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
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
                          disabled={d.status === 'retired'}
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
            <Button color="primary" type="submit" disabled={saving}>Enroll &amp; issue credential</Button>
          </ModalFooter>
        </Form>
      </Modal>

      {/* ------------------------------------------- credential shown once */}
      <Modal isOpen={!!issued} toggle={() => setIssued(null)} centered backdrop="static">
        <ModalHeader>Credential for {issued?.label}</ModalHeader>
        <ModalBody>
          <Alert color="warning" className="mb-3">
            <strong>Install it now.</strong> It is shown once and cannot be retrieved
            afterwards. If it is lost, rotate the credential and install the new one.
          </Alert>
          <ol className="fs-13 ps-3">
            <li>Pick up <strong>{issued?.label}</strong> and scan this QR with its scanner
              (the same way you scan stickers).</li>
            <li>It opens the enrollment page and shows <em>Handheld enrolled</em>.</li>
          </ol>
          {issued && (
            <div className="text-center my-3"><EnrollQr url={makeEnrollUrl(issued.token)} /></div>
          )}
          <p className="text-muted fs-12 mb-1">Or open this link on the handheld:</p>
          <div className="inv-token" style={{ wordBreak: 'break-all' }}>{issued ? makeEnrollUrl(issued.token) : ''}</div>
          <p className="text-muted fs-12 mt-3 mb-0">
            Only a browser holding this credential can read company stickers; every other
            phone or PC is shown <span className="inv-mono">rejected_unauthorized_device</span>.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="light"
            onClick={() => {
              if (issued) navigator.clipboard?.writeText(makeEnrollUrl(issued.token))
                .then(() => toast.success('Copied', 'Credential copied to clipboard.'))
                .catch(() => toast.error('Copy failed', 'Select and copy it manually.'));
            }}
          >
            <i className="ri-file-copy-line me-1" />Copy link
          </Button>
          <Button color="primary" onClick={() => setIssued(null)}>I&apos;ve saved it</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
