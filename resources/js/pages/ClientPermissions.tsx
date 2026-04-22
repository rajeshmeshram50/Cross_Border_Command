import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Button, Input, Spinner, Alert } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

type PermKey = 'can_view' | 'can_add' | 'can_edit' | 'can_delete' | 'can_export' | 'can_import' | 'can_approve';

const PERMS: { key: PermKey; label: string; icon: string; color: string }[] = [
  { key: 'can_view',    label: 'View',    icon: 'ri-eye-line',           color: 'info' },
  { key: 'can_add',     label: 'Add',     icon: 'ri-add-line',           color: 'success' },
  { key: 'can_edit',    label: 'Edit',    icon: 'ri-pencil-line',        color: 'warning' },
  { key: 'can_delete',  label: 'Delete',  icon: 'ri-delete-bin-line',    color: 'danger' },
  { key: 'can_export',  label: 'Export',  icon: 'ri-download-2-line',    color: 'primary' },
  { key: 'can_import',  label: 'Import',  icon: 'ri-upload-2-line',      color: 'secondary' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line',  color: 'primary' },
];

const emptyPerms = (): Record<PermKey, boolean> => ({
  can_view: false, can_add: false, can_edit: false, can_delete: false,
  can_export: false, can_import: false, can_approve: false,
});

export default function ClientPermissions({ clientId, clientName, onBack }: Props) {
  const toast = useToast();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<Record<number, Record<PermKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${clientId}`),
      api.get('/modules'),
    ]).then(async ([clientRes, modRes]) => {
      const admin = clientRes.data.admin_user;
      setAdminUser(admin);
      const mods = modRes.data;
      setModules(mods);

      const m: Record<number, Record<PermKey, boolean>> = {};
      mods.forEach((mod: any) => { m[mod.id] = emptyPerms(); });

      if (admin) {
        try {
          const permRes = await api.get(`/permissions/user/${admin.id}`);
          const perms = permRes.data.permissions || [];
          perms.forEach((p: any) => {
            if (m[p.module_id]) {
              m[p.module_id] = {
                can_view: !!p.can_view, can_add: !!p.can_add, can_edit: !!p.can_edit,
                can_delete: !!p.can_delete, can_export: !!p.can_export, can_import: !!p.can_import, can_approve: !!p.can_approve,
              };
            }
          });
        } catch {}
      }
      setMatrix(m);
    }).finally(() => setLoading(false));
  }, [clientId]);

  const toggle = (modId: number, key: PermKey) => {
    setMatrix(prev => ({ ...prev, [modId]: { ...(prev[modId] || emptyPerms()), [key]: !(prev[modId]?.[key]) } }));
  };

  const toggleColumn = (key: PermKey) => {
    const allOn = modules.every(m => matrix[m.id]?.[key]);
    const next = { ...matrix };
    modules.forEach(m => { next[m.id] = { ...(next[m.id] || emptyPerms()), [key]: !allOn }; });
    setMatrix(next);
  };

  const selectAll = (val: boolean) => {
    const next: Record<number, Record<PermKey, boolean>> = {};
    modules.forEach(m => {
      next[m.id] = {} as Record<PermKey, boolean>;
      PERMS.forEach(p => { next[m.id][p.key] = val; });
    });
    setMatrix(next);
  };

  const handleSave = async () => {
    if (!adminUser) return;
    setSaving(true);
    try {
      const permsPayload = modules.map(m => {
        const p = matrix[m.id] || emptyPerms();
        return { module_id: m.id, ...p };
      });
      await api.post(`/permissions/user/${adminUser.id}`, { permissions: permsPayload });
      toast.success('Saved', 'Permissions updated successfully');
    } catch {
      toast.error('Error', 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const totalChecks = Object.values(matrix).reduce((s, m) => s + PERMS.filter(p => m[p.key]).length, 0);
  const maxChecks = modules.length * PERMS.length;

  if (loading) return <div className="text-center py-5"><Spinner color="primary" /></div>;

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Permissions
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Clients</a></li>
                <li className="breadcrumb-item"><a href="#">{clientName}</a></li>
                <li className="breadcrumb-item active">Permissions</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {!adminUser && (
        <Alert color="warning">
          <i className="ri-alert-line me-1"></i>
          No client admin found for this organization.
        </Alert>
      )}

      {adminUser && (
        <Card className="shadow-sm">
          <CardHeader className="bg-light-subtle border-bottom">
            <Row className="align-items-center g-3">
              <Col sm="auto">
                <div className="d-flex align-items-center gap-3">
                  <div className="avatar-sm">
                    <div className="avatar-title rounded bg-primary text-white fw-bold">
                      {adminUser.name?.charAt(0)?.toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <h6 className="mb-0 fs-14">{adminUser.name}</h6>
                    <p className="text-muted mb-0 fs-12">{adminUser.email}</p>
                  </div>
                  <Badge color={adminUser.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">
                    {adminUser.status}
                  </Badge>
                </div>
              </Col>
              <Col className="text-end">
                <Button
                  color="success"
                  className="btn-label waves-effect waves-light rounded-pill"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <Spinner size="sm" className="label-icon align-middle me-2" />
                    : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
                  {saving ? 'Saving...' : 'Save Permissions'}
                </Button>
              </Col>
            </Row>
          </CardHeader>

          <CardBody className="border-top bg-light-subtle">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="badge bg-dark-subtle text-dark fs-11 fw-bold text-uppercase rounded-pill px-3 py-2">
                <i className="ri-flashlight-line me-1"></i> Quick
              </span>
              <Button color="soft-primary" size="sm" className="rounded-pill px-3" onClick={() => selectAll(true)}>
                <i className="ri-checkbox-multiple-line me-1 align-bottom"></i> Select All
              </Button>
              <Button color="soft-dark" size="sm" className="rounded-pill px-3" onClick={() => selectAll(false)}>
                <i className="ri-checkbox-multiple-blank-line me-1 align-bottom"></i> Deselect All
              </Button>
              <span className="vr mx-1"></span>
              {PERMS.map(p => (
                <Button
                  key={p.key}
                  color={`soft-${p.color}`}
                  size="sm"
                  className="rounded-pill px-3"
                  onClick={() => toggleColumn(p.key)}
                >
                  <i className={`${p.icon} me-1 align-bottom`}></i> {p.label}
                </Button>
              ))}
              <span className="ms-auto text-muted fs-12">
                <strong className="text-primary fs-14">{totalChecks}</strong>
                <span className="text-muted"> / {maxChecks} enabled</span>
              </span>
            </div>
          </CardBody>

          <div className="table-responsive table-card px-3 mt-1">
            <table className="table align-middle table-nowrap table-hover table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th className="ps-3 py-2" style={{ width: '28%' }}>Module</th>
                  {PERMS.map(p => (
                    <th key={p.key} className="text-center py-2">
                      <div className="d-flex flex-column align-items-center gap-1">
                        <span className={`d-inline-flex align-items-center justify-content-center rounded-circle bg-${p.color}-subtle text-${p.color}`} style={{ width: '22px', height: '22px' }}>
                          <i className={`${p.icon} fs-12`}></i>
                        </span>
                        <span className="fs-11 fw-semibold text-uppercase">{p.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modules.map(mod => {
                  const rowPerms = matrix[mod.id] || emptyPerms();
                  return (
                    <tr key={mod.id} style={{ lineHeight: 1.2 }}>
                      <td className="ps-3 py-2">
                        <div className="d-flex align-items-center gap-2 mt-2">
                         
                          <span className="fw-semibold text-dark">{mod.name}</span>
                          {mod.is_default && <Badge color="success-subtle" className="text-success fs-10 rounded-pill">DEFAULT</Badge>}
                        </div>
                      </td>
                      {PERMS.map(p => (
                        <td key={p.key} className="text-center py-2">
                          <div className="form-check d-flex justify-content-center m-0">
                            <Input
                              type="checkbox"
                              className="form-check-input"
                              style={{ width: '0.95rem', height: '0.95rem', cursor: 'pointer' }}
                              checked={!!rowPerms[p.key]}
                              onChange={() => toggle(mod.id, p.key)}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <CardBody className="border-top bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
            <span className="text-muted fs-13">
              <i className="ri-edit-box-line me-1 text-primary"></i>
              Editing: <strong className="text-dark">{adminUser.name}</strong>
              {totalChecks > 0 && <> · <span className="fw-bold text-primary">{totalChecks}</span> enabled</>}
            </span>
            <Button
              color="success"
              className="btn-label waves-effect waves-light rounded-pill"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? <Spinner size="sm" className="label-icon align-middle me-2" />
                : <i className="ri-shield-check-line label-icon align-middle rounded-pill fs-16 me-2"></i>}
              {saving ? 'Saving...' : 'Save Permissions'}
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
