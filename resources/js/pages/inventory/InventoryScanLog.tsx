import { useState, useMemo } from 'react';
import { Card, CardBody, CardHeader, Badge, Button, Input, Row, Col } from 'reactstrap';
import Swal from 'sweetalert2';
import { PageHeader } from '../../components/ui/PageHeader';
import InventoryTabs from './InventoryTabs';
import { listLogs, listAllocations, resetSimulation, type ScanLogRow } from './putAwayStore';
import '../../../css/inventory-scan.css';

const time = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/* Reason codes carry the outcome, so the filter works on them directly. */
const FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'accept', label: 'Accepted' },
  { key: 'reject', label: 'Refused' },
] as const;

export default function InventoryScanLog() {
  const [logs, setLogs] = useState<ScanLogRow[]>(() => listLogs());
  const [allocs, setAllocs] = useState(() => listAllocations());
  const [filter, setFilter] = useState<'all' | 'accept' | 'reject'>('all');
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.filter(l => {
      if (filter !== 'all' && l.result !== filter) return false;
      if (!needle) return true;
      return (
        l.code.toLowerCase().includes(needle) ||
        l.payload.toLowerCase().includes(needle) ||
        l.device_serial.toLowerCase().includes(needle)
      );
    });
  }, [logs, filter, q]);

  const stats = useMemo(() => ({
    total: logs.length,
    accepted: logs.filter(l => l.result === 'accept').length,
    refused: logs.filter(l => l.result === 'reject').length,
  }), [logs]);

  const onReset = async () => {
    const res = await Swal.fire({
      title: 'Reset the simulation?',
      text: 'Clears enrolled devices, the scan log and every allocation on this browser.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Reset everything',
    });
    if (!res.isConfirmed) return;
    resetSimulation();
    setLogs(listLogs());
    setAllocs(listAllocations());
  };

  return (
    <div className="inv-scan">
      <PageHeader
        title="Scan Log"
        subtitle="Every scan attempt — accepted and refused — with its reason code."
        icon={<i className="ri-file-list-3-line" />}
        actions={
          <Button color="light" size="sm" onClick={onReset}>
            <i className="ri-refresh-line me-1" />Reset simulation
          </Button>
        }
      />
      <InventoryTabs />

      <Row className="g-3 mb-3">
        <Col md={4}><StatCard label="Scan attempts" value={stats.total} tone="text-body" /></Col>
        <Col md={4}><StatCard label="Accepted" value={stats.accepted} tone="text-success" /></Col>
        <Col md={4}><StatCard label="Refused" value={stats.refused} tone="text-danger" /></Col>
      </Row>

      <Card className="mb-3">
        <CardHeader className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <h5 className="card-title mb-0 fs-14">Scan attempts</h5>
          <div className="d-flex align-items-center gap-2">
            <div className="btn-group btn-group-sm">
              {FILTERS.map(f => (
                <Button
                  key={f.key}
                  color={filter === f.key ? 'primary' : 'light'}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Input
              bsSize="sm"
              style={{ width: 200 }}
              placeholder="Search code or payload…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: '17%' }}>Time</th>
                  <th style={{ width: '10%' }}>Result</th>
                  <th style={{ width: '20%' }}>Reason code</th>
                  <th style={{ width: '15%' }}>Device</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted py-4">
                    {logs.length === 0
                      ? 'No scans yet — run a put-away to populate this log.'
                      : 'No entries match this filter.'}
                  </td></tr>
                )}
                {shown.map(l => (
                  <tr key={l.id}>
                    <td className="inv-mono text-muted">{time(l.at)}</td>
                    <td>
                      <Badge color={l.result === 'accept' ? 'success' : 'danger'}>
                        {l.result === 'accept' ? 'Accepted' : 'Refused'}
                      </Badge>
                    </td>
                    <td className="inv-mono">{l.code}</td>
                    <td className="inv-mono text-muted">{l.device_serial}</td>
                    <td className="inv-mono text-muted text-break">{l.payload}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h5 className="card-title mb-0 fs-14">Committed allocations</h5>
        </CardHeader>
        <CardBody className="p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: '30%' }}>Box</th>
                  <th style={{ width: '15%' }}>Rack</th>
                  <th style={{ width: '17%' }}>Shelf</th>
                  <th style={{ width: '20%' }}>Time</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {allocs.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted py-4">
                    Nothing allocated yet — finish a run and press Confirm.
                  </td></tr>
                )}
                {allocs.map(a => (
                  <tr key={a.id}>
                    <td><strong>{a.box_label}</strong></td>
                    <td className="inv-mono">{a.rack}</td>
                    <td className="inv-mono">{a.shelf}</td>
                    <td className="inv-mono text-muted">{time(a.at)}</td>
                    <td className="inv-mono text-muted">{a.device_serial}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="mb-0">
      <CardBody className="py-3">
        <p className="text-muted mb-1 fs-12 text-uppercase">{label}</p>
        <h4 className={`mb-0 ${tone}`}>{value}</h4>
      </CardBody>
    </Card>
  );
}
