import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Badge, Input, Label, Form, Table,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
} from 'reactstrap';
import Swal from 'sweetalert2';
import api from '../../api';
import MasterPlaceholder from '../MasterPlaceholder';
import {
  getMasterConfig,
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
  const [records, setRecords] = useState<any[]>([]);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  // ref masters referenced by this master's fields
  const refSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const f of cfg.fields) if (f.ref) set.add(f.ref);
    return [...set];
  }, [cfg]);

  const labelFieldForRef = (refSlug: string, fallback?: string): string => {
    const f = cfg.fields.find(ff => ff.ref === refSlug);
    if (f?.refL) return f.refL;
    if (fallback) return fallback;
    return 'name';
  };

  const resolveRefLabel = (refSlug: string, refLabel: string | undefined, value: any): string => {
    const rows = refData[refSlug] || [];
    const row = rows.find(r => String(r.id) === String(value));
    if (!row) return String(value ?? '');
    const lf = refLabel || labelFieldForRef(refSlug);
    return String(row[lf] ?? value);
  };

  // Load records whenever cfg changes
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setSearch('');
    setEditingId(null);
    setViewOnly(false);
    setModalOpen(false);
    setRecords([]);

    const loadRecords = api.get(`/master/${cfg.slug}`).then(r => {
      if (!aborted) setRecords(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (!aborted) setRecords([]); });

    const loadRefs = Promise.all(refSlugs.map(s =>
      api.get(`/master/${s}`).then(r => [s, Array.isArray(r.data) ? r.data : []] as const).catch(() => [s, [] as any[]] as const)
    )).then(pairs => {
      if (aborted) return;
      const next: Record<string, any[]> = {};
      for (const [k, v] of pairs) next[k] = v;
      setRefData(next);
    });

    Promise.all([loadRecords, loadRefs]).finally(() => { if (!aborted) setLoading(false); });

    return () => { aborted = true; };
  }, [cfg.slug, refSlugs.join('|')]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return records;
    return records.filter(r =>
      cfg.cols.some(c => {
        const f = cfg.fields.find(ff => ff.n === c);
        const val = f?.ref ? resolveRefLabel(f.ref, f.refL, r[c]) : r[c];
        return String(val ?? '').toLowerCase().includes(s);
      }),
    );
  }, [records, search, cfg, refData]);

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;

  const openAdd = () => { setEditingId(null); setViewOnly(false); setModalOpen(true); };
  const openEdit = (row: any, readonly = false) => { setEditingId(row.id); setViewOnly(readonly); setModalOpen(true); };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, any> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      const raw = fd.get(f.n);
      if (f.t === 'number') {
        payload[f.n] = raw == null || raw === '' ? null : Number(raw);
      } else {
        const s = String(raw ?? '').trim();
        payload[f.n] = s === '' ? null : s;
      }
    }

    setSaving(true);
    try {
      if (editingId != null) {
        const { data } = await api.put(`/master/${cfg.slug}/${editingId}`, payload);
        setRecords(prev => prev.map(r => r.id === editingId ? data : r));
      } else {
        const { data } = await api.post(`/master/${cfg.slug}`, payload);
        setRecords(prev => [data, ...prev]);
      }
      setModalOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to save record.';
      const errors = err?.response?.data?.errors;
      const detail = errors ? Object.values(errors).flat().join('\n') : '';
      Swal.fire({ title: 'Error', text: detail || msg, icon: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: any) => {
    const firstCol = cfg.cols[0];
    const label = row[firstCol] || `Record #${row.id}`;
    const result = await Swal.fire({
      title: `Delete ${cfg.titleSingular || cfg.title}?`,
      html: `Remove <strong>"${label}"</strong>?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#f06548',
      cancelButtonColor: '#878a99',
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/master/${cfg.slug}/${row.id}`);
      setRecords(prev => prev.filter(r => r.id !== row.id));
      Swal.fire({ title: 'Deleted!', text: `"${label}" removed.`, icon: 'success', timer: 1500, showConfirmButton: false });
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to delete.';
      Swal.fire({ title: 'Error', text: msg, icon: 'error' });
    }
  };

  const formatCell = (fieldName: string, row: any): React.ReactNode => {
    const f = cfg.fields.find(ff => ff.n === fieldName);
    const raw = row[fieldName];

    if (fieldName === 'status') {
      const active = String(raw).toLowerCase() === 'active';
      return (
        <Badge color={active ? 'success' : 'secondary'} pill className="text-uppercase">
          {active ? 'Active' : (raw || 'Inactive')}
        </Badge>
      );
    }

    if (f?.ref) {
      return <span className="text-dark">{resolveRefLabel(f.ref, f.refL, raw) || '—'}</span>;
    }

    if (raw === undefined || raw === null || raw === '') {
      return <span className="text-muted">—</span>;
    }

    if (typeof raw === 'string' && /^[A-Z0-9]{6,}$/.test(raw.replace(/\s|-/g, ''))) {
      return <code className="text-muted">{raw}</code>;
    }

    return <span className="text-dark">{String(raw)}</span>;
  };

  const singular = cfg.titleSingular || cfg.title;

  return (
    <>
      {/* Page title box — back button + title + breadcrumb */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <button
                className={`btn btn-soft-${cfg.iconColor} btn-icon rounded-circle`}
                style={{ width: 36, height: 36 }}
                onClick={() => navigate('/master')}
                title="Back to master"
              >
                <i className="ri-arrow-left-line fs-16"></i>
              </button>
              <h4 className="mb-sm-0">{cfg.title}</h4>
            </div>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item">
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate('/master'); }}>Master</a>
                </li>
                <li className="breadcrumb-item active">{cfg.title}</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* "What you are doing here" — gradient card with colored step chips */}
      <WhatYouDoHere cfg={cfg} />

      {/* Main card */}
      <Row>
        <Col xs={12}>
          <Card className="shadow-sm">
            <CardHeader className="bg-light-subtle border-bottom">
              <Row className="g-2 align-items-center">
                <Col md={5}>
                  <div className="d-flex align-items-center gap-2">
                    <i className={`${cfg.icon} fs-4 text-${cfg.iconColor}`}></i>
                    <div>
                      <h5 className="mb-0">Manage {cfg.title}</h5>
                      <small className="text-muted">{cfg.desc}</small>
                    </div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="search-box">
                    <Input
                      type="text"
                      placeholder={`Search ${cfg.title.toLowerCase()}…`}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </Col>
                <Col md={3} className="text-md-end">
                  <Button color={cfg.iconColor} className="btn-label waves-effect waves-light rounded-pill" onClick={openAdd}>
                    <i className="ri-add-line label-icon align-middle fs-16 me-2"></i>
                    Add New
                  </Button>
                </Col>
              </Row>
            </CardHeader>

            <CardBody>
              {loading ? (
                <div className="text-center py-5">
                  <Spinner /> <span className="ms-2 text-muted">Loading…</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-5">
                  <i className="ri-inbox-line display-5 text-muted"></i>
                  <p className="text-muted mt-2">No records found</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table className="align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 60 }}>#</th>
                        <th style={{ width: 70 }}>Icon</th>
                        {cfg.cols.map((colName, idx) => (
                          <th key={colName} style={colName === 'status' ? { width: 100 } : undefined}>
                            {cfg.colL[idx] || colName}
                          </th>
                        ))}
                        <th style={{ width: 150 }} className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, i) => (
                        <tr key={row.id}>
                          <td className="text-muted">{i + 1}</td>
                          <td>
                            <div className="avatar-xs">
                              <span className={`avatar-title rounded bg-${cfg.iconBg}-subtle text-${cfg.iconColor} fs-4`}>
                                <i className={cfg.icon}></i>
                              </span>
                            </div>
                          </td>
                          {cfg.cols.map((colName, idx) => (
                            <td key={colName} className={idx === 0 ? '' : 'text-muted'}>
                              {idx === 0 && colName !== 'status' ? (
                                <strong>{(() => {
                                  const f = cfg.fields.find(ff => ff.n === colName);
                                  if (f?.ref) return resolveRefLabel(f.ref, f.refL, row[colName]) || '—';
                                  return row[colName] ?? '—';
                                })()}</strong>
                              ) : (
                                formatCell(colName, row)
                              )}
                            </td>
                          ))}
                          <td className="text-end">
                            <Button size="sm" color="soft-secondary" className="me-1" onClick={() => openEdit(row, true)} title="View">
                              <i className="ri-eye-line"></i>
                            </Button>
                            <Button size="sm" color="soft-primary" className="me-1" onClick={() => openEdit(row)} title="Edit">
                              <i className="ri-pencil-line"></i>
                            </Button>
                            <Button size="sm" color="soft-danger" onClick={() => handleDelete(row)} title="Delete">
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
              {cfg.fields.map((f, i) => renderField(f, i, editing, viewOnly, refData, labelFieldForRef))}
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
    </>
  );
}

/* ── "What you are doing here" gradient card with colored step chips ── */
const STEP_PALETTES = [
  { top: '#7248f0', num: '#7248f0', numBg: '#ede7ff', title: '#6232e8' }, // purple
  { top: '#3577f1', num: '#3577f1', numBg: '#e0ecff', title: '#1f60dd' }, // blue
  { top: '#8168e4', num: '#8168e4', numBg: '#ece5fb', title: '#6b4fdb' }, // violet
  { top: '#10b981', num: '#10b981', numBg: '#d1fae5', title: '#059669' }, // green
  { top: '#f59f0a', num: '#f59f0a', numBg: '#fff0cc', title: '#d97a08' }, // amber
  { top: '#f06548', num: '#f06548', numBg: '#ffe3dc', title: '#d9421f' }, // red/orange
];

function WhatYouDoHere({ cfg }: { cfg: MasterConfig }) {
  const steps = cfg.wtd || [];
  const singular = cfg.titleSingular || cfg.title;

  return (
    <Card
      className="border-0 shadow-sm mb-3 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #f2f5ff 0%, #f7fff5 100%)',
      }}
    >
      <CardBody>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3"
              style={{ width: 34, height: 34, background: '#e0ecff', color: '#3577f1' }}
            >
              <i className="ri-checkbox-circle-line fs-18"></i>
            </span>
            <div className="fw-bold" style={{ color: '#2d3a56', fontSize: 15 }}>
              {cfg.title} — What you are doing here:
            </div>
          </div>
          <span
            className="d-inline-flex align-items-center gap-1 px-3 py-1 rounded-pill fw-semibold"
            style={{
              background: '#e8edf7',
              color: '#3577f1',
              fontSize: 12,
              border: '1px solid #d0dcf2',
            }}
          >
            <i className="ri-information-line"></i>
            {cfg.title} Screen Intelligence Note
          </span>
        </div>

        <Row className="g-3 align-items-stretch">
          {steps.map((s, i) => {
            const p = STEP_PALETTES[i % STEP_PALETTES.length];
            const isLast = i === steps.length - 1;
            const colSize = steps.length <= 3 ? 4 : steps.length === 4 ? 3 : steps.length === 5 ? { md: 6, lg: 'auto' as const } : { md: 6, lg: 4 };
            return (
              <Col
                key={i}
                md={typeof colSize === 'object' ? colSize.md : 6}
                lg={typeof colSize === 'object' ? colSize.lg : (colSize as number)}
                className="position-relative"
              >
                <div
                  className="bg-white rounded-3 h-100 p-3 position-relative"
                  style={{
                    borderTop: `3px solid ${p.top}`,
                    boxShadow: '0 1px 2px rgba(18,38,63,0.04)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-circle fw-bold flex-shrink-0"
                      style={{
                        width: 26,
                        height: 26,
                        background: p.numBg,
                        color: p.num,
                        fontSize: 13,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="fw-bold d-flex align-items-center gap-1" style={{ color: p.title, fontSize: 14 }}>
                      <i className={s.icon}></i>
                      {s.title}
                    </div>
                  </div>
                  <div className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {s.desc}
                  </div>
                </div>
                {!isLast && (
                  <div
                    className="d-none d-lg-flex align-items-center justify-content-center position-absolute"
                    style={{
                      right: -10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 20,
                      height: 20,
                      zIndex: 2,
                      color: '#a3adc2',
                      pointerEvents: 'none',
                    }}
                  >
                    <i className="ri-arrow-right-s-line fs-20"></i>
                  </div>
                )}
              </Col>
            );
          })}
        </Row>

        {steps.length === 0 && (
          <div className="text-muted text-center py-3">
            Define the workflow for {singular} records in the master config.
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function renderField(
  f: FieldDef,
  i: number,
  editing: any,
  viewOnly: boolean,
  refData: Record<string, any[]>,
  labelFieldForRef: (refSlug: string, fallback?: string) => string,
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
    const rows = refData[f.ref] || [];
    const labelField = f.refL || labelFieldForRef(f.ref);
    input = (
      <Input type="select" name={f.n} required={f.r} defaultValue={defaultVal} disabled={viewOnly}>
        <option value="">Select {f.l}…</option>
        {rows.map((r: any) => (
          <option key={r.id} value={r.id}>{r[labelField] ?? r.id}</option>
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
        {(f.opts || []).map(o => <option key={o} value={o}>{o}</option>)}
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
