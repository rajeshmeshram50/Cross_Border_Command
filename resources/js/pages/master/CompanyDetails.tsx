import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Badge, Input, Label, Form,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
  Collapse,
} from 'reactstrap';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteModal from '../../velzon/Components/Common/DeleteModal';

interface Company {
  id: number;
  company_name: string;
  short_code: string;
  gstin: string;
  pan_number: string;
  cin?: string;
  iec_code?: string;
  email?: string;
  mobile?: string;
  city?: string;
  state?: string;
  registered_address?: string;
  status: 'active' | 'inactive';
}

const SEED: Company[] = [
  {
    id: 1,
    company_name: 'Inorbvict Healthcare India Pvt Ltd',
    short_code: 'IGC',
    gstin: '27AADCI6120M1ZH',
    pan_number: 'AADCI6120M',
    cin: 'U85100PN2014PTC152252',
    iec_code: '3114017398',
    email: 'info@company.com',
    mobile: '+91 98500 00000',
    city: 'Pune',
    state: 'Maharashtra',
    registered_address: '',
    status: 'active',
  },
];

const STEPS = [
  { n: 1, icon: 'ri-building-4-line',      title: 'Set Company Identity', sub: 'Legal name, short code' },
  { n: 2, icon: 'ri-file-list-3-line',     title: 'Add Tax Info',         sub: 'GSTIN, PAN, CIN, IEC for exports' },
  { n: 3, icon: 'ri-global-line',          title: 'Add Contact Details',  sub: 'Email, mobile, website, address' },
  { n: 4, icon: 'ri-checkbox-circle-line', title: 'Set Status Active',    sub: 'Enables use across all modules' },
];

export default function CompanyDetailsMaster() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<Company[]>(SEED);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showGuide, setShowGuide] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const activeCount = records.filter(r => r.status === 'active').length;
  const inactiveCount = records.length - activeCount;

  const filtered = useMemo(() => {
    if (filter === 'all') return records;
    return records.filter(r => r.status === filter);
  }, [records, filter]);

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;

  const openAdd = () => { setEditingId(null); setViewOnly(false); setModalOpen(true); };
  const openEdit = (row: Company, readonly = false) => { setEditingId(row.id); setViewOnly(readonly); setModalOpen(true); };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next: Omit<Company, 'id'> = {
      company_name: String(fd.get('company_name') || '').trim(),
      short_code:   String(fd.get('short_code') || '').trim(),
      gstin:        String(fd.get('gstin') || '').trim(),
      pan_number:   String(fd.get('pan_number') || '').trim(),
      cin:          String(fd.get('cin') || '').trim(),
      iec_code:     String(fd.get('iec_code') || '').trim(),
      email:        String(fd.get('email') || '').trim(),
      mobile:       String(fd.get('mobile') || '').trim(),
      city:         String(fd.get('city') || '').trim(),
      state:        String(fd.get('state') || '').trim(),
      registered_address: String(fd.get('registered_address') || '').trim(),
      status:       (fd.get('status') as 'active' | 'inactive') || 'active',
    };
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
    }, 250);
  };

  const confirmDelete = () => {
    if (deleteId == null) return;
    setRecords(prev => prev.filter(r => r.id !== deleteId));
    setDeleteId(null);
  };

  const exportCsv = () => {
    const header = ['#','Company Name','Short Code','GSTIN','PAN','City','Status'];
    const rows = filtered.map((r, i) => [i + 1, r.company_name, r.short_code, r.gstin, r.pan_number, r.city || '', r.status]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'company_details.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(() => [
    {
      header: '#',
      accessorKey: 'index',
      enableSorting: false,
      cell: (info: any) => <span className="fw-semibold text-muted">{info.row.index + 1}</span>,
    },
    {
      header: 'Company Name',
      accessorKey: 'company_name',
      cell: (info: any) => (
        <div className="d-flex align-items-center gap-2">
          <span className="d-inline-flex align-items-center justify-content-center rounded bg-primary-subtle text-primary flex-shrink-0" style={{ width: 32, height: 32 }}>
            <i className="ri-building-4-line fs-15"></i>
          </span>
          <span className="fw-semibold text-dark">{info.row.original.company_name}</span>
        </div>
      ),
    },
    {
      header: 'Short Code',
      accessorKey: 'short_code',
      cell: (info: any) => <Badge color="light" className="text-dark font-monospace fw-semibold px-2 py-1">{info.row.original.short_code}</Badge>,
    },
    {
      header: 'GSTIN',
      accessorKey: 'gstin',
      cell: (info: any) => <code className="text-primary bg-primary-subtle px-2 py-1 rounded">{info.row.original.gstin}</code>,
    },
    {
      header: 'City',
      accessorKey: 'city',
      cell: (info: any) => <span className="text-muted">{info.row.original.city || '—'}</span>,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info: any) => {
        const active = info.row.original.status === 'active';
        return (
          <Badge color={active ? 'success-subtle' : 'danger-subtle'} className={`${active ? 'text-success' : 'text-danger'} rounded-pill px-2`}>
            <span className={`d-inline-block rounded-circle ${active ? 'bg-success' : 'bg-danger'} me-1`} style={{ width: 6, height: 6, verticalAlign: 'middle' }} />
            {active ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
    },
    {
      header: 'Actions',
      id: 'actions',
      enableSorting: false,
      cell: (info: any) => {
        const row = info.row.original as Company;
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
    },
  ], []);

  return (
    <>
      {/* Page header bar: back + title on left, Add on right */}
      <Row className="align-items-center mb-3">
        <Col>
          <div className="d-flex align-items-center gap-2">
            <button
              className="btn btn-soft-primary btn-icon rounded-circle"
              style={{ width: 36, height: 36 }}
              onClick={() => navigate('/master')}
              title="Back to master"
            >
              <i className="ri-arrow-left-line fs-16"></i>
            </button>
            <div>
              <h4 className="mb-0 fw-bold d-flex align-items-center gap-2">
                <span className="d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary" style={{ width: 36, height: 36 }}>
                  <i className="ri-building-4-line fs-18"></i>
                </span>
                Company Details
              </h4>
              <p className="text-muted mb-0 fs-13 ms-5 ps-2">Legal identity, GSTIN, PAN, IEC — used on every export document</p>
            </div>
          </div>
        </Col>
        <Col xs="auto">
          <Button
            color="primary"
            className="btn-label waves-effect waves-light rounded-pill"
            onClick={openAdd}
          >
            <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
            Add Company
          </Button>
        </Col>
      </Row>

      {/* Info Guide — collapsible stepper */}
      <Card className="shadow-sm border-0 mb-3 overflow-hidden">
        <CardHeader className="bg-light-subtle d-flex align-items-center justify-content-between border-0" onClick={() => setShowGuide(!showGuide)} style={{ cursor: 'pointer' }}>
          <div className="d-flex align-items-center gap-2">
            <span className="d-inline-flex align-items-center justify-content-center rounded bg-warning-subtle text-warning" style={{ width: 30, height: 30 }}>
              <i className="ri-lightbulb-flash-line fs-15"></i>
            </span>
            <div>
              <div className="fw-bold text-primary fs-12 text-uppercase" style={{ letterSpacing: '0.6px' }}>What You Do Here</div>
              <small className="text-muted">Follow these 4 steps to set up a Company Detail record</small>
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
              {/* horizontal dashed connector line behind the steps */}
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
                {STEPS.map(s => (
                  <Col md={6} lg={3} key={s.n}>
                    <div className="text-center px-2">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-body-tertiary border border-primary text-primary fw-bold shadow-sm mb-2"
                        style={{ width: 44, height: 44, fontSize: 16 }}
                      >
                        {s.n}
                      </span>
                      <div className="fw-bold text-dark mb-1 d-flex align-items-center justify-content-center gap-1" style={{ fontSize: 13 }}>
                        <i className={`${s.icon} text-primary`}></i>
                        {s.title}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{s.sub}</div>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>
          </CardBody>
        </Collapse>
      </Card>

      {/* Job-dashboard style radial analytics cards */}
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
            label="ACTIVE"
            value={activeCount}
            percentage={records.length ? Math.round((activeCount / records.length) * 100) : 0}
            color="#09b39b"
          />
        </Col>
        <Col md={4}>
          <RadialStatCard
            label="INACTIVE"
            value={inactiveCount}
            percentage={records.length ? Math.round((inactiveCount / records.length) * 100) : 0}
            color="#f06548"
          />
        </Col>
      </Row>

      {/* Table card */}
      <Card className="shadow-sm border-0">
        <CardHeader className="bg-body-tertiary border-0 pt-3 pb-0">
          <div className="d-flex align-items-center flex-wrap gap-2">
            <h5 className="mb-0 fw-bold me-2">
              All Companies <Badge color="primary-subtle" className="text-primary ms-1">{filtered.length}</Badge>
            </h5>
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
          {filtered.length === 0 && <div className="text-center text-muted py-4">No records found</div>}
        </CardBody>
      </Card>

      {/* Add/Edit Modal — mirrors payment form pattern */}
      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} size="xl" centered>
        <ModalHeader toggle={() => setModalOpen(false)}>
          {viewOnly ? 'View Company Detail' : editingId != null ? 'Edit Company Detail' : 'Add Company Detail'}
        </ModalHeader>
        <Form onSubmit={handleSave}>
          <ModalBody>
            <div className="alert alert-info py-2 mb-3 fs-12">
              <i className="ri-information-line me-1"></i>
              Legal identity is referenced on every export document — ensure GSTIN and PAN are accurate.
            </div>
            <Row className="g-3">
              {/* Row 1 — 2 wide fields */}
              <Col md={8}>
                <Label>Company Name <span className="text-danger">*</span></Label>
                <Input name="company_name" required placeholder="e.g. Inorbvict Healthcare India Pvt Ltd"
                  defaultValue={editing?.company_name || ''} disabled={viewOnly} />
              </Col>
              <Col md={4}>
                <Label>Short Code <span className="text-danger">*</span></Label>
                <Input name="short_code" required placeholder="e.g. IGC"
                  defaultValue={editing?.short_code || ''} disabled={viewOnly} />
              </Col>

              {/* Row 2 — 4 fields */}
              <Col md={3}>
                <Label>GSTIN <span className="text-danger">*</span></Label>
                <Input name="gstin" required placeholder="27AADCI6120M1ZH"
                  defaultValue={editing?.gstin || ''} disabled={viewOnly} />
              </Col>
              <Col md={3}>
                <Label>PAN Number <span className="text-danger">*</span></Label>
                <Input name="pan_number" required placeholder="AADCI6120M"
                  defaultValue={editing?.pan_number || ''} disabled={viewOnly} />
              </Col>
              <Col md={3}>
                <Label>CIN</Label>
                <Input name="cin" placeholder="U85100PN2014PTC152252"
                  defaultValue={editing?.cin || ''} disabled={viewOnly} />
              </Col>
              <Col md={3}>
                <Label>IEC Code</Label>
                <Input name="iec_code" placeholder="3114017398"
                  defaultValue={editing?.iec_code || ''} disabled={viewOnly} />
              </Col>

              {/* Row 3 — 3 fields */}
              <Col md={4}>
                <Label>Email</Label>
                <Input type="email" name="email" placeholder="info@company.com"
                  defaultValue={editing?.email || ''} disabled={viewOnly} />
              </Col>
              <Col md={4}>
                <Label>Mobile</Label>
                <Input name="mobile" placeholder="+91 98500 00000"
                  defaultValue={editing?.mobile || ''} disabled={viewOnly} />
              </Col>
              <Col md={4}>
                <Label>Status <span className="text-danger">*</span></Label>
                <Input type="select" name="status" required
                  defaultValue={editing?.status || 'active'} disabled={viewOnly}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Input>
              </Col>

              {/* Row 4 — 3 fields (city, state, address) */}
              <Col md={3}>
                <Label>City</Label>
                <Input name="city" placeholder="Pune"
                  defaultValue={editing?.city || ''} disabled={viewOnly} />
              </Col>
              <Col md={3}>
                <Label>State</Label>
                <Input name="state" placeholder="Maharashtra"
                  defaultValue={editing?.state || ''} disabled={viewOnly} />
              </Col>
              <Col md={6}>
                <Label>Registered Address</Label>
                <Input type="textarea" name="registered_address" rows={2} placeholder="Full address"
                  defaultValue={editing?.registered_address || ''} disabled={viewOnly} />
              </Col>
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

      {/* Velzon delete confirmation modal */}
      <DeleteModal
        show={deleteId != null}
        onDeleteClick={confirmDelete}
        onCloseClick={() => setDeleteId(null)}
      />
    </>
  );
}

/* ── Job-dashboard style radial stat card (SVG circular progress) ── */
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
      {/* Soft decorative wave in the background */}
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
