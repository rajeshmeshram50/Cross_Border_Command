import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Badge, Input, Modal, ModalBody, ModalHeader, ModalFooter, Row, Col, Spinner } from 'reactstrap';

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

const emptyForm: Omit<Company, 'id'> = {
  company_name: '', short_code: '', gstin: '', pan_number: '', cin: '',
  iec_code: '', email: '', mobile: '', city: '', state: '',
  registered_address: '', status: 'active',
};

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
  { n: 1, icon: 'ri-building-4-line',    title: 'Set Company Identity', sub: 'Legal name, short code' },
  { n: 2, icon: 'ri-file-list-3-line',   title: 'Add Tax Info',          sub: 'GSTIN, PAN, CIN, IEC for exports' },
  { n: 3, icon: 'ri-global-line',        title: 'Add Contact Details',   sub: 'Email, mobile, website, address' },
  { n: 4, icon: 'ri-checkbox-circle-line', title: 'Set Status Active',   sub: 'Enables use across all modules' },
];

export default function CompanyDetailsMaster() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<Company[]>(SEED);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const perPage = 10;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Omit<Company, 'id'>>(emptyForm);
  const [saving, setSaving] = useState(false);

  const activeCount = records.filter(r => r.status === 'active').length;
  const inactiveCount = records.length - activeCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!q) return true;
      return [r.company_name, r.short_code, r.gstin, r.city, r.state, r.email]
        .filter(Boolean).some(v => v!.toLowerCase().includes(q));
    });
  }, [records, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (row: Company) => {
    setEditingId(row.id);
    const { id, ...rest } = row;
    setForm(rest);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.company_name || !form.short_code || !form.gstin || !form.pan_number || !form.status) return;
    setSaving(true);
    setTimeout(() => {
      if (editingId != null) {
        setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...form } : r));
      } else {
        const nextId = (records.at(-1)?.id ?? 0) + 1;
        setRecords(prev => [...prev, { id: nextId, ...form }]);
      }
      setSaving(false);
      setModalOpen(false);
    }, 250);
  };

  const handleDelete = (id: number) => {
    if (!confirm('Delete this record?')) return;
    setRecords(prev => prev.filter(r => r.id !== id));
  };

  const toggleStatus = (id: number) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status: r.status === 'active' ? 'inactive' : 'active' } : r));
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

  return (
    <div className="card shadow-sm border-0">
      {/* Header */}
      <div className="d-flex align-items-start justify-content-between gap-3 p-4">
        <div className="d-flex align-items-center gap-3">
          <span className="d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary" style={{ width: 46, height: 46 }}>
            <i className="ri-building-4-line fs-22"></i>
          </span>
          <div>
            <h4 className="fw-bold mb-1" style={{ letterSpacing: '-0.3px' }}>Company Details</h4>
            <p className="text-muted mb-0 fs-13">Legal identity, GSTIN, PAN, IEC — used on every export document</p>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button color="primary" className="rounded-pill px-3 fw-semibold" onClick={openAdd}>
            <i className="ri-add-line align-bottom me-1"></i> Add
          </Button>
          <button
            className="btn border d-inline-flex align-items-center justify-content-center rounded"
            style={{ width: 36, height: 36 }}
            onClick={() => navigate('/master')}
            title="Back to master"
          >
            <i className="ri-close-line fs-16"></i>
          </button>
        </div>
      </div>

      <hr className="m-0" />

      {/* What You Do Here */}
      <div className="bg-light-subtle px-4 py-3 border-bottom">
        <div className="d-flex align-items-center gap-2 mb-3">
          <span className="d-inline-flex align-items-center justify-content-center rounded bg-warning-subtle text-warning" style={{ width: 24, height: 24 }}>
            <i className="ri-lightbulb-flash-line fs-13"></i>
          </span>
          <span className="fw-bold text-primary fs-11 text-uppercase" style={{ letterSpacing: '0.6px' }}>What You Do Here</span>
        </div>
        <Row className="g-3">
          {STEPS.map(s => (
            <Col md={6} lg={3} key={s.n}>
              <div className="d-flex align-items-center gap-2 p-2 bg-white rounded-3 border h-100">
                <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary text-white fw-bold flex-shrink-0" style={{ width: 28, height: 28, fontSize: 12 }}>
                  {s.n}
                </span>
                <span className="d-inline-flex align-items-center justify-content-center rounded bg-primary-subtle text-primary flex-shrink-0" style={{ width: 30, height: 30 }}>
                  <i className={`${s.icon} fs-15`}></i>
                </span>
                <div className="flex-grow-1 min-w-0">
                  <div className="fw-bold text-dark" style={{ fontSize: 12.5, lineHeight: 1.2 }}>{s.title}</div>
                  <div className="text-muted text-truncate" style={{ fontSize: 11 }}>{s.sub}</div>
                </div>
                <i className="ri-arrow-right-line text-muted"></i>
              </div>
            </Col>
          ))}
        </Row>
      </div>

      {/* Filter toolbar */}
      <div className="d-flex align-items-center gap-2 flex-wrap px-4 py-3 border-bottom">
        <div className="search-box" style={{ width: 280 }}>
          <Input
            type="text"
            className="form-control"
            placeholder="Search records..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <i className="ri-search-line search-icon"></i>
        </div>

        <div className="d-inline-flex align-items-center gap-1 ms-2">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              className={`btn btn-sm rounded-pill px-3 ${filter === f ? 'border-primary text-primary bg-primary-subtle' : 'border text-muted'}`}
              onClick={() => { setFilter(f); setPage(1); }}
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

      {/* Stat pills */}
      <div className="px-4 pt-3 pb-2">
        <Row className="g-3">
          <Col md={4}>
            <div className="d-flex align-items-center gap-3 p-3 rounded-3 border bg-white">
              <span className="d-inline-flex align-items-center justify-content-center rounded bg-primary-subtle text-primary" style={{ width: 42, height: 42 }}>
                <i className="ri-building-4-line fs-18"></i>
              </span>
              <div>
                <div className="fw-bold text-primary" style={{ fontSize: 20 }}>{records.length}</div>
                <div className="text-muted fw-bold" style={{ fontSize: 11, letterSpacing: '0.5px' }}>TOTAL RECORDS</div>
              </div>
            </div>
          </Col>
          <Col md={4}>
            <div className="d-flex align-items-center gap-3 p-3 rounded-3 border bg-white">
              <span className="d-inline-flex align-items-center justify-content-center rounded bg-success-subtle text-success" style={{ width: 42, height: 42 }}>
                <i className="ri-checkbox-circle-line fs-18"></i>
              </span>
              <div>
                <div className="fw-bold text-success" style={{ fontSize: 20 }}>{activeCount}</div>
                <div className="text-muted fw-bold" style={{ fontSize: 11, letterSpacing: '0.5px' }}>ACTIVE</div>
              </div>
            </div>
          </Col>
          <Col md={4}>
            <div className="d-flex align-items-center gap-3 p-3 rounded-3 border bg-white">
              <span className="d-inline-flex align-items-center justify-content-center rounded bg-danger-subtle text-danger" style={{ width: 42, height: 42 }}>
                <i className="ri-pause-circle-line fs-18"></i>
              </span>
              <div>
                <div className="fw-bold text-danger" style={{ fontSize: 20 }}>{inactiveCount}</div>
                <div className="text-muted fw-bold" style={{ fontSize: 11, letterSpacing: '0.5px' }}>INACTIVE</div>
              </div>
            </div>
          </Col>
        </Row>
      </div>

      {/* Table */}
      <div className="table-responsive px-3">
        <table className="table align-middle table-hover mb-0">
          <thead>
            <tr className="text-muted fs-11 fw-bold text-uppercase" style={{ letterSpacing: '0.4px' }}>
              <th className="ps-3" style={{ width: 60 }}>#</th>
              <th>Company Name <i className="ri-arrow-up-down-line ms-1"></i></th>
              <th>Short Code <i className="ri-arrow-up-down-line ms-1"></i></th>
              <th>GSTIN <i className="ri-arrow-up-down-line ms-1"></i></th>
              <th>City <i className="ri-arrow-up-down-line ms-1"></i></th>
              <th>Status <i className="ri-arrow-up-down-line ms-1"></i></th>
              <th className="text-end pe-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-5 text-muted">No records found</td></tr>
            ) : pageRows.map((r, idx) => (
              <tr key={r.id} style={{ lineHeight: 1.4 }}>
                <td className="ps-3 fw-semibold text-muted">{(page - 1) * perPage + idx + 1}</td>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <span className="d-inline-flex align-items-center justify-content-center rounded bg-primary-subtle text-primary flex-shrink-0" style={{ width: 32, height: 32 }}>
                      <i className="ri-building-4-line fs-15"></i>
                    </span>
                    <span className="fw-semibold text-dark">{r.company_name}</span>
                  </div>
                </td>
                <td><Badge color="light" className="text-dark font-monospace fw-semibold px-2 py-1">{r.short_code}</Badge></td>
                <td><code className="text-primary bg-primary-subtle px-2 py-1 rounded">{r.gstin}</code></td>
                <td className="text-muted">{r.city || '—'}</td>
                <td>
                  {r.status === 'active' ? (
                    <Badge color="success-subtle" className="text-success rounded-pill px-2">
                      <span className="d-inline-block rounded-circle bg-success me-1" style={{ width: 6, height: 6, verticalAlign: 'middle' }} />
                      Active
                    </Badge>
                  ) : (
                    <Badge color="danger-subtle" className="text-danger rounded-pill px-2">
                      <span className="d-inline-block rounded-circle bg-danger me-1" style={{ width: 6, height: 6, verticalAlign: 'middle' }} />
                      Inactive
                    </Badge>
                  )}
                </td>
                <td className="text-end pe-3">
                  <div className="d-inline-flex gap-1">
                    <button className="btn btn-sm border" title="Edit" onClick={() => openEdit(r)}>
                      <i className="ri-pencil-line text-primary"></i>
                    </button>
                    <button className="btn btn-sm border" title="Delete" onClick={() => handleDelete(r.id)}>
                      <i className="ri-delete-bin-line text-danger"></i>
                    </button>
                    <button className="btn btn-sm border" title="View" onClick={() => openEdit(r)}>
                      <i className="ri-eye-line text-muted"></i>
                    </button>
                    <button className="btn btn-sm border bg-primary-subtle" title="Toggle status" onClick={() => toggleStatus(r.id)}>
                      <i className="ri-time-line text-primary"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="d-flex align-items-center justify-content-between px-4 py-3">
        <div className="text-muted fs-13">
          Showing <strong>{pageRows.length === 0 ? 0 : (page - 1) * perPage + 1}</strong>–<strong>{(page - 1) * perPage + pageRows.length}</strong> of <strong>{filtered.length}</strong> records
        </div>
        <div className="d-inline-flex gap-1">
          <button className="btn btn-sm border" disabled={page === 1} onClick={() => setPage(1)}><i className="ri-skip-back-mini-line"></i></button>
          <button className="btn btn-sm border" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><i className="ri-arrow-left-s-line"></i></button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              className={`btn btn-sm rounded-circle ${n === page ? 'btn-primary' : 'border'}`}
              style={{ width: 32, height: 32, padding: 0 }}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
          <button className="btn btn-sm border" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><i className="ri-arrow-right-s-line"></i></button>
          <button className="btn btn-sm border" disabled={page === totalPages} onClick={() => setPage(totalPages)}><i className="ri-skip-forward-mini-line"></i></button>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} centered size="lg">
        <ModalHeader toggle={() => setModalOpen(false)} tag="div" className="border-bottom">
          <div>
            <h5 className="mb-0 fw-bold">
              <i className="ri-add-line me-1"></i>
              {editingId != null ? 'Edit' : 'Add'} Company Detail
            </h5>
            <small className="text-muted">Fill all fields to create a new record</small>
          </div>
        </ModalHeader>
        <ModalBody>
          <Row className="g-3">
            <Col xs={12}>
              <Label required>Company Name</Label>
              <Input placeholder="e.g. Inorbvict Healthcare India Pvt Ltd" value={form.company_name}
                onChange={e => setForm({ ...form, company_name: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label required>Short Code</Label>
              <Input placeholder="e.g. IGC" value={form.short_code}
                onChange={e => setForm({ ...form, short_code: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label required>GSTIN</Label>
              <Input placeholder="27AADCI6120M1ZH" value={form.gstin}
                onChange={e => setForm({ ...form, gstin: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label required>PAN Number</Label>
              <Input placeholder="AADCI6120M" value={form.pan_number}
                onChange={e => setForm({ ...form, pan_number: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>CIN</Label>
              <Input placeholder="U85100PN2014PTC152252" value={form.cin || ''}
                onChange={e => setForm({ ...form, cin: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>IEC Code</Label>
              <Input placeholder="3114017398" value={form.iec_code || ''}
                onChange={e => setForm({ ...form, iec_code: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>Email</Label>
              <Input type="email" placeholder="info@company.com" value={form.email || ''}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>Mobile</Label>
              <Input placeholder="+91 98500 00000" value={form.mobile || ''}
                onChange={e => setForm({ ...form, mobile: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>City</Label>
              <Input placeholder="Pune" value={form.city || ''}
                onChange={e => setForm({ ...form, city: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label>State</Label>
              <Input placeholder="Maharashtra" value={form.state || ''}
                onChange={e => setForm({ ...form, state: e.target.value })} />
            </Col>
            <Col xs={12}>
              <Label>Registered Address</Label>
              <Input type="textarea" rows={3} placeholder="Full address" value={form.registered_address || ''}
                onChange={e => setForm({ ...form, registered_address: e.target.value })} />
            </Col>
            <Col md={6}>
              <Label required>Status</Label>
              <Input type="select" value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
                <option value="">— Select —</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Input>
            </Col>
          </Row>
        </ModalBody>
        <ModalFooter className="border-top d-flex justify-content-between">
          <span className="text-danger fs-12"><i className="ri-asterisk"></i> Required fields</span>
          <div className="d-flex gap-2">
            <Button color="light" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-save-line me-1"></i>}
              Save Record
            </Button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="form-label fw-bold text-muted fs-11 text-uppercase mb-1" style={{ letterSpacing: '0.4px' }}>
      {children}
      {required && <span className="text-danger ms-1">*</span>}
    </label>
  );
}
