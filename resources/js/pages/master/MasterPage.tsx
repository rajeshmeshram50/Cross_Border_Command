import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Input, Label, Form, FormFeedback,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
} from 'reactstrap';
import api from '../../api';
import MasterPlaceholder from '../MasterPlaceholder';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  getMasterConfig,
  masterEndpoint,
  normalizeOpts,
  type FieldDef,
  type MasterConfig,
} from './masterConfigs';
import { MasterSelect, MasterFormStyles } from './masterFormKit';

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
  const toast = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (name: string) => {
    setFieldErrors(prev => {
      if (!prev[name]) return prev;
      const n = { ...prev };
      delete n[name];
      return n;
    });
  };

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

  // Group fields by section header (so each section becomes a tinted card in the modal).
  // A field with `sec` starts a new group; subsequent non-sec fields belong to it.
  const sectionedFields = useMemo(() => {
    const groups: { sec: string | null; fields: FieldDef[] }[] = [];
    let current: { sec: string | null; fields: FieldDef[] } = { sec: null, fields: [] };
    groups.push(current);
    for (const f of cfg.fields) {
      if (f.sec) {
        current = { sec: f.sec, fields: [] };
        groups.push(current);
      } else {
        current.fields.push(f);
      }
    }
    if (groups[0].sec == null && groups[0].fields.length === 0) groups.shift();
    return groups;
  }, [cfg]);

  // Shrink the modal + widen each field when the form only has a handful of inputs.
  // ≤ 4 fields → default (500px) with fields stacked, 5–9 → lg (800px), 10+ → xl (1140px).
  const nonSecFieldCount = useMemo(
    () => cfg.fields.filter(f => !f.sec).length,
    [cfg]
  );
  const modalSize: 'lg' | 'xl' | undefined =
    nonSecFieldCount <= 4 ? undefined : nonSecFieldCount <= 9 ? 'lg' : 'xl';
  const defaultFieldSpan: number =
    modalSize === undefined ? 12 : modalSize === 'lg' ? 6 : 4;

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

    const loadRecords = api.get(masterEndpoint(cfg)).then(r => {
      if (!aborted) setRecords(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (!aborted) setRecords([]); });

    const loadRefs = Promise.all(refSlugs.map(s => {
      const refCfg = getMasterConfig(s);
      const url = refCfg ? masterEndpoint(refCfg) : `/master/${s}`;
      return api.get(url).then(r => [s, Array.isArray(r.data) ? r.data : []] as const).catch(() => [s, [] as any[]] as const);
    })).then(pairs => {
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

  const openAdd = () => { setFieldErrors({}); setEditingId(null); setViewOnly(false); setModalOpen(true); };
  const openEdit = (row: any, readonly = false) => { setFieldErrors({}); setEditingId(row.id); setViewOnly(readonly); setModalOpen(true); };

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

  const validateForm = (fd: FormData): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      const raw = String(fd.get(f.n) ?? '').trim();
      if (f.r && !raw) {
        errs[f.n] = `${f.l} is required`;
        continue;
      }
      if (!raw) continue;
      if (f.t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        errs[f.n] = 'Please enter a valid email address';
      } else if (f.t === 'number' && isNaN(Number(raw))) {
        errs[f.n] = 'Must be a valid number';
      }
    }
    return errs;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const errs = validateForm(fd);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const count = Object.keys(errs).length;
      toast.error('Validation Error', `${count} field${count === 1 ? '' : 's'} need attention`);
      return;
    }
    setFieldErrors({});

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
      const base = masterEndpoint(cfg);
      if (editingId != null) {
        const { data } = await api.put(`${base}/${editingId}`, payload);
        setRecords(prev => prev.map(r => r.id === editingId ? data : r));
        toast.success('Updated', `${cfg.titleSingular || cfg.title} updated successfully`);
      } else {
        const { data } = await api.post(base, payload);
        setRecords(prev => [data, ...prev]);
        toast.success('Created', `${cfg.titleSingular || cfg.title} created successfully`);
      }
      setModalOpen(false);
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrors = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        for (const k of Object.keys(serverErrors)) {
          const v = serverErrors[k];
          mapped[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setFieldErrors(mapped);
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        const msg = err?.response?.data?.message || 'Failed to save record.';
        toast.error('Error', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteLabel = (row: any): string => {
    const firstCol = cfg.cols[0];
    return row?.[firstCol] || `Record #${row?.id}`;
  };

  const handleDeleteClick = (row: any) => {
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const label = deleteLabel(deleteTarget);
    setDeleting(true);
    try {
      await api.delete(`${masterEndpoint(cfg)}/${deleteTarget.id}`);
      setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
      toast.success('Deleted', `"${label}" removed successfully`);
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to delete.';
      toast.error('Error', msg);
    } finally {
      setDeleting(false);
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
      return <span className="text-body">{resolveRefLabel(f.ref, f.refL, raw) || '—'}</span>;
    }

    if (raw === undefined || raw === null || raw === '') {
      return <span className="text-muted">—</span>;
    }

    if (typeof raw === 'string' && /^[A-Z0-9]{6,}$/.test(raw.replace(/\s|-/g, ''))) {
      return <code className="text-body">{raw}</code>;
    }

    return <span className="text-body">{String(raw)}</span>;
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
            return <b>{val}</b>;
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
          <ActionBtn title="Delete" icon="ri-delete-bin-line" color="danger"  onClick={() => handleDeleteClick(info.row.original)} />
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
        ? <span className="text-body">{name}</span>
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
      const scope = row.branch_name
        ? `Branch: ${row.branch_name}`
        : row.client_name
        ? `Client: ${row.client_name}`
        : null;
      return (
        <div>
          <div className="text-body fw-medium">{name}</div>
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
      <MasterFormStyles />
      <Modal
        isOpen={modalOpen}
        toggle={() => { /* explicit Cancel only — outside click & Esc disabled */ }}
        size={modalSize}
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
              <i className={`${cfg.icon}`} style={{ color: '#fff', fontSize: 22 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: 'rgb(64, 81, 137)', fontWeight: 900 }}>
                {viewOnly ? `View ${singular}` : editingId != null ? `Edit ${singular}` : `Add ${singular}`}
              </h4>
              <small className="text-muted" style={{ fontSize: 12 }}>{cfg.desc}</small>
            </div>
          </div>
        </div>
        <Form onSubmit={handleSave}>
          <ModalBody className="p-4">
            {sectionedFields.map((group, gIdx) => {
              const p = SECTION_PALETTES[gIdx % SECTION_PALETTES.length];
              return (
                <div key={gIdx} className={gIdx > 0 ? 'mt-4 pt-1' : ''}>
                  {group.sec && (
                    <div className="d-flex align-items-center gap-2 mb-3">
                      <span
                        className="flex-shrink-0"
                        style={{ width: 4, height: 20, background: p.grad, borderRadius: 2 }}
                      />
                      <h6
                        className="mb-0 fw-bold"
                        style={{
                          color: p.color,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}
                      >
                        {group.sec}
                      </h6>
                      <div
                        className="flex-grow-1"
                        style={{ height: 1, background: 'var(--vz-border-color)' }}
                      />
                    </div>
                  )}
                  <Row className="g-3">
                    {group.fields.map((f, i) => renderField(f, i, editing, viewOnly, refData, labelFieldForRef, fieldErrors, clearFieldError, defaultFieldSpan))}
                  </Row>
                </div>
              );
            })}
          </ModalBody>
          <ModalFooter className="px-4 pb-3 justify-content-center gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            <button type="button" className="master-modal-cancel" onClick={() => setModalOpen(false)}>
              <i className="ri-close-line align-middle me-1"></i>
              {viewOnly ? 'Close' : 'Cancel'}
            </button>
            {!viewOnly && (
              <Button color="secondary" type="submit" disabled={saving} className="btn-label waves-effect waves-light rounded-pill">
                {saving
                  ? <Spinner size="sm" className="label-icon align-middle me-2" />
                  : <i className="ri-save-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                {saving
                  ? (editingId != null ? 'Updating...' : 'Saving...')
                  : (editingId != null ? 'Update Record' : 'Save Record')}
              </Button>
            )}
          </ModalFooter>
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleteOpen}
        title={`Delete ${cfg.titleSingular || cfg.title}`}
        itemName={deleteTarget ? deleteLabel(deleteTarget) : undefined}
        subMessage="This action cannot be undone. The record will be permanently removed."
        onClose={() => { if (!deleting) { setDeleteOpen(false); setDeleteTarget(null); } }}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}

/* ── Section palette — colors a section card in the Add/Edit modal ── */
const SECTION_PALETTES: { color: string; grad: string; tint: string; border: string; shadow: string }[] = [
  { color: '#6366f1', grad: 'linear-gradient(135deg, #6366f1, #8b5cf6)', tint: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.03))', border: 'rgba(99,102,241,0.22)', shadow: 'rgba(99,102,241,0.35)' },
  { color: '#0ea5e9', grad: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', tint: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(56,189,248,0.03))', border: 'rgba(14,165,233,0.22)', shadow: 'rgba(14,165,233,0.35)' },
  { color: '#d97a08', grad: 'linear-gradient(135deg, #f59e0b, #f7b84b)', tint: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(247,184,75,0.03))', border: 'rgba(245,158,11,0.24)', shadow: 'rgba(245,158,11,0.35)' },
  { color: '#10b981', grad: 'linear-gradient(135deg, #10b981, #14c9b1)', tint: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(20,201,177,0.03))', border: 'rgba(16,185,129,0.22)', shadow: 'rgba(16,185,129,0.35)' },
  { color: '#8b5cf6', grad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', tint: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(167,139,250,0.03))', border: 'rgba(139,92,246,0.22)', shadow: 'rgba(139,92,246,0.35)' },
  { color: '#db2777', grad: 'linear-gradient(135deg, #ec4899, #f9a8d4)', tint: 'linear-gradient(135deg, rgba(236,72,153,0.08), rgba(249,168,212,0.03))', border: 'rgba(236,72,153,0.22)', shadow: 'rgba(236,72,153,0.35)' },
];

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
  const [open, setOpen] = useState(false);

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
          <div className="d-flex flex-wrap align-items-stretch" style={{ gap: 8 }}>
            {steps.map((s, i) => {
              const p = STEP_PALETTES[i % STEP_PALETTES.length];
              const isLast = i === steps.length - 1;
              return (
                <Fragment key={i}>
                  <div
                    className="position-relative"
                    style={{
                      flex: '1 1 0',
                      minWidth: 200,
                      padding: '14px 16px 14px 16px',
                      borderRadius: 14,
                      background: p.tint,
                      border: `1px solid ${p.border}`,
                      borderTop: `3px solid ${p.accent}`,
                      boxShadow: '0 2px 8px rgba(18,38,63,0.04)',
                    }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0 fw-bold"
                        style={{
                          width: 24, height: 24,
                          background: p.grad,
                          color: '#fff',
                          fontSize: 12,
                          boxShadow: `0 3px 8px ${p.border}`,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div
                        className="fw-bold text-truncate"
                        style={{ color: p.accent, fontSize: 14 }}
                        title={s.title}
                      >
                        {s.title}
                      </div>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                      {s.desc}
                    </div>
                  </div>
                  {!isLast && (
                    <div
                      className="d-none d-md-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 26 }}
                      aria-hidden="true"
                    >
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle"
                        style={{
                          width: 22, height: 22,
                          background: 'var(--vz-card-bg)',
                          border: '1px solid var(--vz-border-color)',
                          boxShadow: '0 1px 3px rgba(18,38,63,0.06)',
                        }}
                      >
                        <i
                          className="ri-arrow-right-s-line"
                          style={{
                            fontSize: 16,
                            color: 'var(--vz-secondary-color)',
                            lineHeight: 1,
                          }}
                        />
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

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

function iconForField(f: FieldDef): string {
  const n = (f.n || '').toLowerCase();
  if (f.ref) return 'ri-links-line';
  if (f.t === 'email' || n.includes('email')) return 'ri-mail-line';
  if (n.includes('phone') || n.includes('mobile') || n.includes('whatsapp')) return 'ri-phone-line';
  if (n === 'name' || n.endsWith('_name') || n.includes('title') || n.includes('holder')) return 'ri-user-3-line';
  if (n.includes('address')) return 'ri-map-pin-line';
  if (n === 'city' || n === 'taluka' || n === 'district') return 'ri-map-2-line';
  if (n.includes('state') || n.includes('country') || n.includes('region')) return 'ri-earth-line';
  if (n.includes('pincode') || n.includes('postal') || n.includes('zip')) return 'ri-mail-send-line';
  if (n.includes('website') || n.includes('url') || n === 'domain') return 'ri-global-line';
  if (n.includes('gst') || n.includes('pan') || n === 'iec' || n === 'cin' || n.includes('tax')) return 'ri-file-list-3-line';
  if (n.includes('bank') || n.includes('account_number')) return 'ri-bank-line';
  if (n.includes('ifsc') || n.includes('swift') || n.includes('short_code') || (n.includes('code') && !n.includes('country'))) return 'ri-qr-code-line';
  if (n.includes('price') || n.includes('amount') || n.includes('fee') || n.includes('cost') || n.includes('rate') || n.includes('salary')) return 'ri-money-rupee-circle-line';
  if (n === 'status') return 'ri-pulse-line';
  if (n.includes('description') || n.includes('note') || n.includes('detail') || n.includes('remark')) return 'ri-file-text-line';
  if (n.includes('logo') || n.includes('image') || n.includes('icon') || n.includes('photo')) return 'ri-image-line';
  if (n.includes('quantity') || n === 'qty' || n.includes('count')) return 'ri-hashtag';
  if (n.includes('currency')) return 'ri-coins-line';
  if (n.includes('weight')) return 'ri-scales-line';
  if (n.includes('color') || n.includes('colour')) return 'ri-palette-line';
  if (n.includes('category') || n.includes('type')) return 'ri-price-tag-3-line';
  if (n === 'slug') return 'ri-link';
  if (f.t === 'textarea') return 'ri-align-left';
  if (f.t === 'number') return 'ri-hashtag';
  if (f.t === 'date' || n.includes('date') || n.endsWith('_at')) return 'ri-calendar-line';
  if (f.t === 'select') return 'ri-list-check-2';
  return 'ri-edit-box-line';
}

function renderField(
  f: FieldDef,
  i: number,
  editing: any,
  viewOnly: boolean,
  refData: Record<string, any[]>,
  labelFieldForRef: (refSlug: string, fallback?: string) => string,
  fieldErrors: Record<string, string> = {},
  clearFieldError: (name: string) => void = () => {},
  defaultSpan: number = 4,
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

  const span = f.full ? 12 : f.t === 'textarea' ? 12 : defaultSpan;
  const defaultVal = editing?.[f.n] ?? '';
  const err = fieldErrors[f.n];
  const onFieldChange = () => clearFieldError(f.n);
  const icon = iconForField(f);
  const isTextarea = f.t === 'textarea';
  const isSelect = !!(f.ref || f.t === 'select');

  let input: React.ReactNode;
  if (f.ref) {
    const rows = refData[f.ref] || [];
    const labelField = f.refL || labelFieldForRef(f.ref);
    const options = rows.map((r: any) => ({
      value: String(r.id),
      label: String(r[labelField] ?? r.id),
    }));
    input = (
      <MasterSelect
        name={f.n}
        defaultValue={defaultVal == null ? '' : String(defaultVal)}
        options={options}
        placeholder={`Select ${f.l}…`}
        disabled={viewOnly}
        invalid={!!err}
        onChange={onFieldChange}
      />
    );
  } else if (f.t === 'select') {
    const options = normalizeOpts(f.opts);
    input = (
      <MasterSelect
        name={f.n}
        defaultValue={defaultVal || (f.r ? (options[0]?.value ?? '') : '')}
        options={options}
        placeholder="Select…"
        disabled={viewOnly}
        invalid={!!err}
        onChange={onFieldChange}
      />
    );
  } else if (f.t === 'textarea') {
    input = (
      <Input
        type="textarea"
        name={f.n}
        rows={3}
        placeholder={f.p}
        defaultValue={defaultVal}
        disabled={viewOnly}
        invalid={!!err}
        onInput={onFieldChange}
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
        invalid={!!err}
        onInput={onFieldChange}
      />
    );
  }

  return (
    <Col md={span} key={f.n || `f-${i}`}>
      <Label>
        {f.l}{f.r && <span className="req-star">*</span>}
      </Label>
      <div className={`master-field${isTextarea ? ' ta' : ''}${isSelect ? ' sel' : ''}`}>
        <i className={`${icon} master-field-icon${isTextarea ? ' ta' : ''}`} />
        {input}
      </div>
      {err && <FormFeedback style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{err}</FormFeedback>}
    </Col>
  );
}
