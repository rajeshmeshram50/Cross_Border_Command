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

const PERMS: { key: PermKey; label: string; icon: string }[] = [
  { key: 'can_view',    label: 'View',    icon: 'ri-eye-line' },
  { key: 'can_add',     label: 'Add',     icon: 'ri-add-line' },
  { key: 'can_edit',    label: 'Edit',    icon: 'ri-pencil-line' },
  { key: 'can_delete',  label: 'Delete',  icon: 'ri-delete-bin-line' },
  { key: 'can_export',  label: 'Export',  icon: 'ri-download-2-line' },
  { key: 'can_import',  label: 'Import',  icon: 'ri-upload-2-line' },
  { key: 'can_approve', label: 'Approve', icon: 'ri-check-double-line' },
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
        <Card>
          <CardHeader>
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
                <Button color="success" onClick={handleSave} disabled={saving}>
                  {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-check-line me-1"></i>}
                  {saving ? 'Saving...' : 'Save Permissions'}
                </Button>
              </Col>
            </Row>
          </CardHeader>

          <CardBody className="border-top">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="text-muted fs-11 fw-bold text-uppercase">Quick:</span>
              <Button color="light" size="sm" onClick={() => selectAll(true)}>
                <i className="ri-checkbox-multiple-line me-1"></i>Select All
              </Button>
              <Button color="light" size="sm" onClick={() => selectAll(false)}>
                <i className="ri-checkbox-multiple-blank-line me-1"></i>Deselect All
              </Button>
              <span className="vr mx-1"></span>
              {PERMS.map(p => (
                <Button key={p.key} color="light" size="sm" onClick={() => toggleColumn(p.key)}>
                  <i className={`${p.icon} me-1`}></i>{p.label}
                </Button>
              ))}
              <span className="ms-auto text-muted fs-12">
                <strong className="text-primary">{totalChecks}</strong> / {maxChecks}
              </span>
            </div>
          </CardBody>

          <div className="table-responsive table-card">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: '28%' }}>Module</th>
                  {PERMS.map(p => (
                    <th key={p.key} className="text-center">
                      <div className="d-flex flex-column align-items-center gap-1">
                        <i className={`${p.icon} fs-14 text-muted`}></i>
                        <span className="fs-11">{p.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modules.map(mod => {
                  const rowPerms = matrix[mod.id] || emptyPerms();
                  return (
                    <tr key={mod.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span className="fw-semibold">{mod.name}</span>
                          {mod.is_default && <Badge color="success-subtle" className="text-success fs-10">DEFAULT</Badge>}
                        </div>
                      </td>
                      {PERMS.map(p => (
                        <td key={p.key} className="text-center">
                          <div className="form-check d-flex justify-content-center m-0">
                            <Input type="checkbox" className="form-check-input"
                              checked={!!rowPerms[p.key]}
                              onChange={() => toggle(mod.id, p.key)} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <CardBody className="border-top d-flex justify-content-between align-items-center">
            <span className="text-muted fs-13">
              <strong>{adminUser.name}</strong> · <span className="fw-bold text-primary">{totalChecks}</span> permissions enabled
            </span>
            <Button color="success" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="sm" className="me-1" /> : <i className="ri-check-line me-1"></i>}
              Save Permissions
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
