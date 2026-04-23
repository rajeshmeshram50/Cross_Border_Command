import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Input, Label, Form,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
} from 'reactstrap';
import Swal from 'sweetalert2';
import api from '../../api';
import MasterPlaceholder from '../MasterPlaceholder';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import { useAuth } from '../../contexts/AuthContext';
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
  const { user } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  // Ownership columns injected by role:
  //  - super_admin      -> Client | Branch | Created By
  //  - client_admin/user -> Branch | Created By
  //  - branch_user      -> Created By
  // These columns render directly from the API (rows include client_name, branch_name, creator_name).
  const ownershipCols = useMemo<{ key: string; label: string }[]>(() => {
    const ut = user?.user_type;
    if (ut === 'super_admin') {
      return [
        { key: '__client',  label: 'Client' },
        { key: '__branch',  label: 'Branch' },
        { key: '__creator', label: 'Created By' },
      ];
    }
    if (ut === 'client_admin') {
      return [
        { key: '__branch',  label: 'Branch' },
        { key: '__creator', label: 'Created By' },
      ];
    }
    if (ut === 'branch_user') {
      return [{ key: '__creator', label: 'Created By' }];
    }
    return [];
  }, [user?.user_type]);

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

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;

  // Filter rows by search input across all column accessors + ownership fields
  const filteredRecords = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return records;
    const searchableKeys = [
      ...cfg.cols,
      'client_name', 'branch_name', 'creator_name',
    ];
    return records.filter(row => {
      for (const key of searchableKeys) {
        const f = cfg.fields.find(ff => ff.n === key);
        const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[key]) : row[key];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, searchInput, cfg, refData]);

  const openAdd = () => { setEditingId(null); setViewOnly(false); setModalOpen(true); };
  const openEdit = (row: any, readonly = false) => { setEditingId(row.id); setViewOnly(readonly); setModalOpen(true); };

  // Clients-page style compact action button
  const ActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        transition: 'all .15s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        const tint =
          color === 'primary' ? '#40518918' :
          color === 'danger'  ? '#f0654818' :
          color === 'success' ? '#0ab39c18' :
          color === 'info'    ? '#299cdb18' :
          color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)';
        el.style.background = tint;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--vz-secondary-bg)';
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );

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
      const color = active ? 'success' : 'danger';
      return (
        <span className={`badge rounded-pill border border-${color} text-${color} text-uppercase fw-semibold fs-10 px-2 py-1 d-inline-flex align-items-center gap-1`}>
          <span className={`bg-${color} rounded-circle`} style={{ width: 6, height: 6 }} />
          {active ? 'Active' : (raw || 'Inactive')}
        </span>
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

  // Columns for TableContainer (TanStack Table). Built dynamically from cfg.cols + ownershipCols
  // so every master automatically gets the same look as the Clients table (Clients.tsx).
  const columns = useMemo(() => {
    const cols: any[] = [
      {
        header: '#',
        accessorKey: '__index',
        cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
      },
      {
        header: 'Icon',
        accessorKey: '__icon',
        enableGlobalFilter: false,
        cell: () => (
          <div className="avatar-xs">
            <span className={`avatar-title rounded bg-${cfg.iconBg}-subtle text-${cfg.iconColor} fs-4`}>
              <i className={cfg.icon}></i>
            </span>
          </div>
        ),
      },
    ];
    cfg.cols.forEach((colName, idx) => {
      cols.push({
        header: cfg.colL[idx] || colName,
        // Accessor: resolve ref labels upfront so TableContainer's global filter can search them.
        accessorFn: (row: any) => {
          const f = cfg.fields.find(ff => ff.n === colName);
          if (f?.ref) return resolveRefLabel(f.ref, f.refL, row[colName]);
          return row[colName];
        },
        id: `col_${colName}`,
        cell: (info: any) => {
          const row = info.row.original;
          if (idx === 0 && colName !== 'status') {
            const f = cfg.fields.find(ff => ff.n === colName);
            const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[colName]) || '—' : row[colName] ?? '—';
            return <strong>{val}</strong>;
          }
          return formatCell(colName, row);
        },
      });
    });
    ownershipCols.forEach(o => {
      cols.push({
        header: o.label,
        id: o.key,
        accessorFn: (row: any) =>
          o.key === '__client' ? row.client_name :
          o.key === '__branch' ? row.branch_name :
          o.key === '__creator' ? row.creator_name : '',
        cell: (info: any) => renderOwnership(o.key, info.row.original),
      });
    });
    cols.push({
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableGlobalFilter: false,
      cell: (info: any) => (
        <div className="d-flex gap-1 justify-content-center">
          <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => openEdit(info.row.original, true)} />
          <ActionBtn title="Edit"   icon="ri-pencil-line"     color="info"    onClick={() => openEdit(info.row.original)} />
          <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger"  onClick={() => handleDelete(info.row.original)} />
        </div>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, ownershipCols, refData]);

  const renderOwnership = (key: string, row: any): React.ReactNode => {
    if (key === '__client') {
      const name = row.client_name;
      return name
        ? <span className="text-dark">{name}</span>
        : <span className="text-muted">—</span>;
    }
    if (key === '__branch') {
      const name = row.branch_name;
      return name
        ? <span className="badge bg-info-subtle text-info border border-info-subtle">{name}</span>
        : <span className="text-muted">—</span>;
    }
    if (key === '__creator') {
      const name = row.creator_name;
      if (!name) return <span className="text-muted">—</span>;
      // Show a small hint line indicating which scope the row belongs to.
      const scope = row.branch_name
        ? `Branch: ${row.branch_name}`
        : row.client_name
        ? `Client: ${row.client_name}`
        : null;
      return (
        <div>
          <div className="text-dark fw-medium">{name}</div>
          {scope && <div className="text-muted fs-11">{scope}</div>}
        </div>
      );
    }
    return null;
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

      {/* Main card — search + Add New row, then table */}
      <Row>
        <Col xs={12}>
          <Card className="shadow-sm" style={{ borderRadius: 16 }}>
            <CardBody>
              {/* Search bar + Add New in one row (Add Client style) */}
              <Row className="g-2 align-items-center mb-3">
                <Col md={6} sm={12}>
                  <div className="search-box">
                    <Input
                      type="text"
                      className="form-control"
                      placeholder={`Search ${cfg.title.toLowerCase()}...`}
                      value={searchInput}
                      onChange={e => setSearchInput(e.target.value)}
                    />
                    <i className="ri-search-line search-icon"></i>
                  </div>
                </Col>
                <Col md={6} sm={12} className="d-flex justify-content-md-end">
                  <Button
                    color="secondary"
                    className="btn-label waves-effect waves-light rounded-pill"
                    onClick={openAdd}
                  >
                    <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                    Add New
                  </Button>
                </Col>
              </Row>

              <style>{`
                .master-scroll-wrap {
                  max-height: 445px;
                  overflow-y: auto;
                }
                .master-scroll-wrap thead {
                  position: sticky;
                  top: 0;
                  z-index: 2;
                }
                .master-scroll-wrap::-webkit-scrollbar { width: 8px; }
                .master-scroll-wrap::-webkit-scrollbar-track { background: transparent; }
                .master-scroll-wrap::-webkit-scrollbar-thumb { background: var(--vz-border-color); border-radius: 8px; }
                .master-scroll-wrap::-webkit-scrollbar-thumb:hover { background: var(--vz-secondary-color); }
              `}</style>
              <TableContainer
                columns={columns}
                data={filteredRecords}
                isGlobalFilter={false}
                customPageSize={7}
                tableClass="align-middle table-nowrap mb-0"
                theadClass="table-light"
                divClass="table-responsive border rounded master-scroll-wrap"
                SearchPlaceholder={`Search ${cfg.title.toLowerCase()}...`}
              />
              {loading && <div className="text-center py-5"><Spinner /></div>}
              {!loading && records.length === 0 && (
                <div className="text-center py-5">
                  <i className="ri-inbox-line display-5 text-muted"></i>
                  <p className="text-muted mt-2">No records found</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Add / Edit modal */}
      <Modal isOpen={modalOpen} toggle={() => setModalOpen(false)} size="xl" centered contentClassName="border-0" style={{ borderRadius: 18 }}>
        <div
          className="position-relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #405189 0%, #4a63a8 45%, #6691e7 100%)',
            padding: '20px 24px',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15) 0%, transparent 40%), radial-gradient(circle at 85% 80%, rgba(10,179,156,0.22) 0%, transparent 45%)',
              pointerEvents: 'none',
            }}
          />
          <div className="d-flex align-items-center gap-3 position-relative">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3"
              style={{
                width: 46, height: 46,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <i className={`${cfg.icon}`} style={{ color: '#fff', fontSize: 22 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h5 className="mb-0 text-white fw-semibold">
                {viewOnly ? `View ${singular}` : editingId != null ? `Edit ${singular}` : `Add ${singular}`}
              </h5>
              <small style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{cfg.desc}</small>
            </div>
            <button
              type="button"
              className="btn-close btn-close-white flex-shrink-0"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            />
          </div>
        </div>
        <Form onSubmit={handleSave}>
          <ModalBody className="p-4">
            <Row className="g-3">
              {cfg.fields.map((f, i) => renderField(f, i, editing, viewOnly, refData, labelFieldForRef))}
            </Row>
          </ModalBody>
          <ModalFooter className="px-4 pb-3">
            <Button color="light" type="button" className="rounded-pill px-3" onClick={() => setModalOpen(false)}>
              {viewOnly ? 'Close' : 'Cancel'}
            </Button>
            {!viewOnly && (
              <Button color="secondary" type="submit" disabled={saving} className="btn-label waves-effect waves-light rounded-pill">
                {saving
                  ? <Spinner size="sm" className="label-icon align-middle me-2" />
                  : <i className="ri-save-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                {saving ? 'Saving...' : 'Save Record'}
              </Button>
            )}
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}

/* ── "What you are doing here" — gradient step tiles ── */
const STEP_PALETTES: { grad: string; tint: string; border: string; accent: string }[] = [
  { grad: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)', tint: 'linear-gradient(135deg, rgba(64,81,137,0.08), rgba(102,145,231,0.04))', border: 'rgba(64,81,137,0.20)', accent: '#405189' },
  { grad: 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)', tint: 'linear-gradient(135deg, rgba(10,179,156,0.08), rgba(48,213,181,0.04))', border: 'rgba(10,179,156,0.22)', accent: '#0ab39c' },
  { grad: 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)', tint: 'linear-gradient(135deg, rgba(247,184,75,0.10), rgba(255,212,122,0.05))', border: 'rgba(247,184,75,0.25)', accent: '#d97a08' },
  { grad: 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)', tint: 'linear-gradient(135deg, rgba(106,90,205,0.08), rgba(167,139,250,0.04))', border: 'rgba(106,90,205,0.20)', accent: '#6a5acd' },
  { grad: 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)', tint: 'linear-gradient(135deg, rgba(41,156,219,0.08), rgba(95,200,255,0.04))', border: 'rgba(41,156,219,0.20)', accent: '#299cdb' },
  { grad: 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)', tint: 'linear-gradient(135deg, rgba(240,101,72,0.08), rgba(255,158,124,0.04))', border: 'rgba(240,101,72,0.22)', accent: '#f06548' },
];

function WhatYouDoHere({ cfg }: { cfg: MasterConfig }) {
  const steps = cfg.wtd || [];
  const singular = cfg.titleSingular || cfg.title;
  const [open, setOpen] = useState(true);

  return (
    <Card
      className="border shadow-sm mb-3 overflow-hidden"
      style={{
        background: 'var(--vz-card-bg)',
        borderColor: 'var(--vz-border-color)',
        borderRadius: 16,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="d-flex align-items-center justify-content-between flex-wrap gap-2 px-3 py-3 border-0 w-100 text-start"
        style={{
          cursor: 'pointer',
          background: open ? 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.03))' : 'transparent',
          borderBottom: open ? '1px solid var(--vz-border-color)' : 'none',
          transition: 'background .2s ease',
          userSelect: 'none',
        }}
      >
        <div className="d-flex align-items-center gap-2">
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3"
            style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
              boxShadow: '0 4px 10px rgba(64,81,137,0.25)',
            }}
          >
            <i className="ri-lightbulb-flash-line" style={{ color: '#fff', fontSize: 16 }}></i>
          </span>
          <div>
            <div className="fw-bold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 15 }}>
              {cfg.title} — What you are doing here
            </div>
            <small className="text-muted">Quick 4-step guide to set up a {singular} record</small>
          </div>
        </div>
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary flex-shrink-0"
          style={{
            width: 32, height: 32,
            transition: 'transform .25s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <i className="ri-arrow-down-s-line fs-18"></i>
        </span>
      </button>

      <div
        style={{
          maxHeight: open ? 1200 : 0,
          overflow: 'hidden',
          transition: 'max-height .35s ease',
        }}
      >
        <CardBody className="pt-3">
          <Row className="g-3 align-items-stretch">
            {steps.map((s, i) => {
              const p = STEP_PALETTES[i % STEP_PALETTES.length];
              const colSpan = steps.length <= 3 ? 4 : steps.length === 4 ? 3 : steps.length === 5 ? 'auto' as const : 4;
              return (
                <Col key={i} xs={12} sm={6} md={steps.length === 5 ? 6 : 6} lg={colSpan}>
                  <div
                    className="h-100 p-3 position-relative"
                    style={{
                      borderRadius: 14,
                      background: p.tint,
                      border: `1px solid ${p.border}`,
                      boxShadow: '0 2px 8px rgba(18,38,63,0.04)',
                    }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                        style={{
                          width: 40, height: 40,
                          background: p.grad,
                          boxShadow: `0 4px 10px ${p.border}`,
                        }}
                      >
                        <i className={s.icon} style={{ color: '#fff', fontSize: 18 }}></i>
                      </span>
                      <div className="flex-grow-1 min-w-0">
                        <div className="fs-11 fw-bold text-uppercase" style={{ color: p.accent, letterSpacing: '0.05em' }}>
                          Step {i + 1}
                        </div>
                        <div className="fw-bold text-truncate" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 14 }}>
                          {s.title}
                        </div>
                      </div>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      {s.desc}
                    </div>
                  </div>
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
      </div>
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
