import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Badge, Input, Label, Form,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
  Collapse,
} from 'reactstrap';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteModal from '../../velzon/Components/Common/DeleteModal';
import MasterPlaceholder from '../MasterPlaceholder';
import {
  getMasterConfig,
  resolveRef,
  type FieldDef,
  type MasterConfig,
} from './masterConfigs';

export default function MasterPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const cfg = slug ? getMasterConfig(slug) : null;

  if (!cfg) return <MasterPlaceholder />;

  return <MasterPageInner key={cfg.slug} cfg={cfg} navigate={navigate} />;
}

function MasterPageInner({
  cfg,
  navigate,
}: {
  cfg: MasterConfig;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [records, setRecords] = useState<any[]>(cfg.data);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showGuide, setShowGuide] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Reset when cfg changes (navigating between masters)
  useEffect(() => {
    setRecords(cfg.data);
    setFilter('all');
    setEditingId(null);
    setViewOnly(false);
    setModalOpen(false);
    setDeleteId(null);
  }, [cfg.slug]);

  const hasStatus = cfg.fields.some(f => f.n === 'status');
  const activeCount = hasStatus
    ? records.filter(r => String(r.status).toLowerCase() === 'active').length
    : records.length;
  const inactiveCount = hasStatus ? records.length - activeCount : 0;

  const filtered = useMemo(() => {
    if (!hasStatus || filter === 'all') return records;
    return records.filter(r => String(r.status).toLowerCase() === filter);
  }, [records, filter, hasStatus]);

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;

  const openAdd = () => { setEditingId(null); setViewOnly(false); setModalOpen(true); };
  const openEdit = (row: any, readonly = false) => { setEditingId(row.id); setViewOnly(readonly); setModalOpen(true); };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next: Record<string, any> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      const raw = fd.get(f.n);
      if (f.t === 'number') {
        const v = raw == null || raw === '' ? '' : Number(raw);
        next[f.n] = v;
      } else {
        next[f.n] = String(raw ?? '').trim();
      }
    }
    setSaving(true);
    setTimeout(() => {
      if (editingId != null) {
        setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...next } : r));
      } else {
        const nextId = (records.length ? records[records.length - 1].id : 0) + 1;
        setRecords(prev => [...prev, { id: nextId, ...next }]);
      }
      setSaving(false);
      setModalOpen(false);
    }, 200);
  };

  const confirmDelete = () => {
    if (deleteId == null) return;
    setRecords(prev => prev.filter(r => r.id !== deleteId));
    setDeleteId(null);
  };

  const formatCell = (fieldName: string, row: any): React.ReactNode => {
    const f = cfg.fields.find(ff => ff.n === fieldName);
    const raw = row[fieldName];

    if (fieldName === 'status') {
      const active = String(raw).toLowerCase() === 'active';
      return (
        <Badge
          color={active ? 'success-subtle' : 'danger-subtle'}
          className={`${active ? 'text-success' : 'text-danger'} rounded-pill px-2`}
        >
          <span
            className={`d-inline-block rounded-circle ${active ? 'bg-success' : 'bg-danger'} me-1`}
            style={{ width: 6, height: 6, verticalAlign: 'middle' }}
          />
          {active ? 'Active' : 'Inactive'}
        </Badge>
      );
    }

    if (f?.ref) {
      return <span className="text-dark">{resolveRef(f.ref, f.refL, raw) || '—'}</span>;
    }

    if (raw === undefined || raw === null || raw === '') return <span className="text-muted">—</span>;

    // Heuristic monospace-style values
    if (typeof raw === 'string' && /^[A-Z0-9]{6,}$/.test(raw.replace(/\s|-/g, ''))) {
      return <code className="text-primary bg-primary-subtle px-2 py-1 rounded">{raw}</code>;
    }

    return <span className="text-dark">{String(raw)}</span>;
  };

  const exportCsv = () => {
    const header = ['#', ...cfg.colL];
    const rows = filtered.map((r, i) => [
      i + 1,
      ...cfg.cols.map(c => {
        const f = cfg.fields.find(ff => ff.n === c);
        if (f?.ref) return resolveRef(f.ref, f.refL, r[c]);
        return r[c] ?? '';
      }),
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cfg.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(() => {
    const base: any[] = [
      {
        header: '#',
        accessorKey: '_idx',
        enableSorting: false,
        cell: (info: any) => <span className="fw-semibold text-muted">{info.row.index + 1}</span>,
      },
    ];

    cfg.cols.forEach((colName, idx) => {
      const label = cfg.colL[idx] || colName;
      base.push({
        header: label,
        accessorKey: colName,
        cell: (info: any) => {
          const row = info.row.original;
          // First data column gets an icon chip
          if (idx === 0 && colName !== 'status') {
            return (
              <div className="d-flex align-items-center gap-2">
                <span
                  className={`d-inline-flex align-items-center justify-content-center rounded bg-${cfg.iconBg}-subtle text-${cfg.iconColor} flex-shrink-0`}
                  style={{ width: 32, height: 32 }}
                >
                  <i className={`${cfg.icon} fs-15`}></i>
                </span>
                <span className="fw-semibold text-dark">{row[colName] ?? '—'}</span>
              </div>
            );
          }
          return formatCell(colName, row);
        },
      });
    });

    base.push({
      header: 'Actions',
      id: 'actions',
      enableSorting: false,
      cell: (info: any) => {
        const row = info.row.original;
        return (
          <div className="d-inline-flex gap-1">
            <button className="btn btn-sm border" title="View" onClick={() => openEdit(row, true)}>
              <i className="ri-eye-line text-muted"></i>
            </button>
            <button className="btn btn-sm border" title="Edit" onClick={() => openEdit(row)}>
              <i className="ri-pencil-line text-primary"></i>
            </button>
            <button className="btn btn-sm border" title="Delete" onClick={() => setDeleteId(row.id)}>
              <i className="ri-delete-bin-line text-danger"></i>
            </button>
          </div>
        );
      },
    });

    return base;
  }, [cfg]);

  const singular = cfg.titleSingular || cfg.title;

  return (
    <>
      {/* Page header */}
      <Row className="align-items-center mb-3">
        <Col>
          <div className="d-flex align-items-center gap-2">
            <button
              className={`btn btn-soft-${cfg.iconColor} btn-icon rounded-circle`}
              style={{ width: 36, height: 36 }}
              onClick={() => navigate('/master')}
              title="Back to master"
            >
              <i className="ri-arrow-left-line fs-16"></i>
            </button>
            <div>
              <h4 className="mb-0 fw-bold d-flex align-items-center gap-2">
                <span
                  className={`d-inline-flex align-items-center justify-content-center rounded-3 bg-${cfg.iconBg}-subtle text-${cfg.iconColor}`}
                  style={{ width: 36, height: 36 }}
                >
                  <i className={`${cfg.icon} fs-18`}></i>
                </span>
                {cfg.title}
              </h4>
              <p className="text-muted mb-0 fs-13 ms-5 ps-2">{cfg.desc}</p>
            </div>
          </div>
        </Col>
        <Col xs="auto">
          <Button
            color={cfg.iconColor}
            className="btn-label waves-effect waves-light rounded-pill"
            onClick={openAdd}
          >
            <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
            Add {singular}
          </Button>
        </Col>
      </Row>

      {/* What you do here — collapsible stepper */}
      <Card className="shadow-sm border-0 mb-3 overflow-hidden">
        <CardHeader
          className="bg-light-subtle d-flex align-items-center justify-content-between border-0"
          onClick={() => setShowGuide(!showGuide)}
          style={{ cursor: 'pointer' }}
        >
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded bg-warning-subtle text-warning"
              style={{ width: 30, height: 30 }}
            >
              <i className="ri-lightbulb-flash-line fs-15"></i>
            </span>
            <div>
              <div className="fw-bold text-primary fs-12 text-uppercase" style={{ letterSpacing: '0.6px' }}>
                What You Do Here
              </div>
              <small className="text-muted">
                Follow these {cfg.wtd.length} steps to set up a {singular} record
              </small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost-secondary"
            onClick={(e) => { e.stopPropagation(); setShowGuide(!showGuide); }}
          >
            <i className={`ri-arrow-${showGuide ? 'up' : 'down'}-s-line fs-18`}></i>
          </button>
        </CardHeader>
        <Collapse isOpen={showGuide}>
          <CardBody className="pt-4 pb-4">
            <div className="position-relative">
              <div
                className="d-none d-md-block position-absolute"
                style={{
                  top: 22,
                  left: '6%',
                  right: '6%',
                  borderTop: '2px dashed var(--vz-border-color)',
                  zIndex: 0,
                }}
              />
              <Row className="g-3 position-relative" style={{ zIndex: 1 }}>
                {cfg.wtd.map((s, i) => (
                  <Col md={6} lg={Math.max(3, Math.floor(12 / Math.max(cfg.wtd.length, 1)))} key={i}>
                    <div className="text-center px-2">
                      <span
                        className={`d-inline-flex align-items-center justify-content-center rounded-circle bg-white border border-${cfg.iconColor} text-${cfg.iconColor} fw-bold shadow-sm mb-2`}
                        style={{ width: 44, height: 44, fontSize: 16 }}
                      >
                        {i + 1}
                      </span>
                      <div
                        className="fw-bold text-dark mb-1 d-flex align-items-center justify-content-center gap-1"
                        style={{ fontSize: 13 }}
                      >
                        <i className={`${s.icon} text-${cfg.iconColor}`}></i>
                        {s.title}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                        {s.desc}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>
          </CardBody>
        </Collapse>
      </Card>

      {/* Analytics */}
      <Row className="g-3 mb-3">
        <Col md={4}>
          <RadialStatCard
            label="TOTAL RECORDS"
            value={records.length}
            percentage={100}
            color="#09b39b"
          />
        </Col>
        <Col md={4}>
          <RadialStatCard
            label={hasStatus ? 'ACTIVE' : 'AVAILABLE'}
            value={activeCount}
            percentage={records.length ? Math.round((activeCount / records.length) * 100) : 0}
            color="#09b39b"
          />
        </Col>
        <Col md={4}>
          <RadialStatCard
            label={hasStatus ? 'INACTIVE' : 'ARCHIVED'}
            value={inactiveCount}
            percentage={records.length ? Math.round((inactiveCount / records.length) * 100) : 0}
            color="#f06548"
          />
        </Col>
      </Row>

      {/* Table card */}
      <Card className="shadow-sm border-0">
        <CardHeader className="bg-white border-0 pt-3 pb-0">
          <div className="d-flex align-items-center flex-wrap gap-2">
            <h5 className="mb-0 fw-bold me-2">
              All {cfg.title}{' '}
              <Badge color={`${cfg.iconColor}-subtle`} className={`text-${cfg.iconColor} ms-1`}>
                {filtered.length}
              </Badge>
            </h5>
            {hasStatus && (
              <div className="d-inline-flex align-items-center gap-1 ms-3">
                {(['all', 'active', 'inactive'] as const).map(f => (
                  <button
                    key={f}
                    className={`btn btn-sm rounded-pill px-3 ${filter === f ? 'border-primary text-primary bg-primary-subtle' : 'border text-muted'}`}
                    onClick={() => setFilter(f)}
                  >
                    <span className="text-capitalize">{f}</span>
                    <span className={`badge ms-2 rounded-pill ${filter === f ? 'bg-primary' : 'bg-light text-muted'}`}>
                      {f === 'all' ? records.length : f === 'active' ? activeCount : inactiveCount}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="ms-auto">
              <Button color="light" className="rounded-pill px-3" onClick={exportCsv}>
                <i className="ri-download-2-line me-1"></i> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          <TableContainer
            columns={columns}
            data={filtered}
            isGlobalFilter={true}
            customPageSize={10}
            tableClass="align-middle table-nowrap mb-0"
            theadClass="table-light"
            divClass="table-responsive table-card border rounded"
            SearchPlaceholder="Search records..."
          />
          {filtered.length === 0 && (
            <div className="text-center text-muted py-4">No records found</div>
          )}
        </CardBody>
      </Card>

      {/* Add / Edit modal */}
      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} size="xl" centered>
        <ModalHeader toggle={() => setModalOpen(false)}>
          {viewOnly ? `View ${singular}` : editingId != null ? `Edit ${singular}` : `Add ${singular}`}
        </ModalHeader>
        <Form onSubmit={handleSave}>
          <ModalBody>
            <div className={`alert alert-${cfg.iconColor === 'primary' ? 'info' : cfg.iconColor} py-2 mb-3 fs-12`}>
              <i className="ri-information-line me-1"></i>
              {cfg.desc}
            </div>
            <Row className="g-3">
              {cfg.fields.map((f, i) => renderField(f, i, editing, viewOnly))}
            </Row>
          </ModalBody>
          <ModalFooter>
            <Button color="light" type="button" onClick={() => setModalOpen(false)}>
              {viewOnly ? 'Close' : 'Cancel'}
            </Button>
            {!viewOnly && (
              <Button color="success" type="submit" disabled={saving}>
                {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
                {saving ? 'Saving...' : 'Save Record'}
              </Button>
            )}
          </ModalFooter>
        </Form>
      </Modal>

      <DeleteModal
        show={deleteId != null}
        onDeleteClick={confirmDelete}
        onCloseClick={() => setDeleteId(null)}
      />
    </>
  );
}

function renderField(
  f: FieldDef,
  i: number,
  editing: any,
  viewOnly: boolean,
): React.ReactNode {
  if (f.sec) {
    return (
      <Col md={12} key={`sec-${i}`}>
        <div className="d-flex align-items-center gap-2 mt-2 mb-1">
          <span className="fw-bold text-uppercase text-primary" style={{ fontSize: 11, letterSpacing: '0.8px' }}>
            {f.sec}
          </span>
          <div className="flex-grow-1" style={{ height: 1, background: 'var(--vz-border-color)' }} />
        </div>
      </Col>
    );
  }

  const span = f.full ? 12 : f.t === 'textarea' ? 12 : 4;
  const defaultVal = editing?.[f.n] ?? '';

  let input: React.ReactNode;
  if (f.ref) {
    const refMaster = getMasterConfig(f.ref);
    const labelField = f.refL || 'name';
    input = (
      <Input
        type="select"
        name={f.n}
        required={f.r}
        defaultValue={defaultVal}
        disabled={viewOnly}
      >
        <option value="">Select {f.l}…</option>
        {refMaster?.data.map((r: any) => (
          <option key={r.id} value={r.id}>
            {r[labelField] ?? r.id}
          </option>
        ))}
      </Input>
    );
  } else if (f.t === 'select') {
    input = (
      <Input
        type="select"
        name={f.n}
        required={f.r}
        defaultValue={defaultVal || (f.opts?.[0] ?? '')}
        disabled={viewOnly}
      >
        {!f.r && <option value="">Select…</option>}
        {(f.opts || []).map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Input>
    );
  } else if (f.t === 'textarea') {
    input = (
      <Input
        type="textarea"
        name={f.n}
        rows={2}
        placeholder={f.p}
        defaultValue={defaultVal}
        disabled={viewOnly}
        required={f.r}
      />
    );
  } else {
    input = (
      <Input
        type={f.t === 'email' ? 'email' : f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text'}
        name={f.n}
        placeholder={f.p}
        defaultValue={defaultVal}
        disabled={viewOnly}
        required={f.r}
      />
    );
  }

  return (
    <Col md={span} key={f.n || `f-${i}`}>
      <Label>
        {f.l} {f.r && <span className="text-danger">*</span>}
      </Label>
      {input}
    </Col>
  );
}

function RadialStatCard({
  label, value, percentage, color,
}: {
  label: string;
  value: number;
  percentage: number;
  color: string;
}) {
  const size = 82;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, percentage));
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <Card
      className="border-0 shadow-sm h-100 overflow-hidden position-relative"
      style={{ transition: 'transform .25s ease, box-shadow .25s ease' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 14px 30px rgba(64,81,137,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      <svg
        className="position-absolute"
        style={{ top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.35 }}
        viewBox="0 0 400 180"
        preserveAspectRatio="none"
      >
        <path
          d="M0,130 C80,90 180,170 280,110 C340,75 380,120 400,100 L400,180 L0,180 Z"
          fill="var(--vz-light)"
        />
      </svg>

      <CardBody className="d-flex align-items-center justify-content-between position-relative" style={{ zIndex: 1 }}>
        <div>
          <p className="text-muted fw-bold mb-2" style={{ fontSize: 12, letterSpacing: '0.6px' }}>{label}</p>
          <h2 className="fw-bold mb-0 text-dark" style={{ fontSize: 30, letterSpacing: '-0.5px' }}>
            {value.toLocaleString()}
          </h2>
        </div>

        <div className="position-relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--vz-border-color)"
              strokeWidth={strokeWidth}
              opacity={0.5}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 600ms ease' }}
            />
          </svg>
          <div
            className="position-absolute top-50 start-50 translate-middle fw-bold"
            style={{ color, fontSize: 15, letterSpacing: '-0.3px' }}
          >
            {pct}%
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
