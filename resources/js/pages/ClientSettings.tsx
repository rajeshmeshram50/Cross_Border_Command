import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Spinner } from 'reactstrap';
import api from '../api';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const groupIcons: Record<string, string> = {
  general:       'ri-global-line',
  security:      'ri-shield-keyhole-line',
  notifications: 'ri-notification-3-line',
  appearance:    'ri-palette-line',
  privacy:       'ri-lock-2-line',
  billing:       'ri-database-2-line',
};

export default function ClientSettings({ clientId, clientName, onBack }: Props) {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/client-settings', { params: { client_id: clientId } })
      .then(res => {
        const data = res.data;
        if (Array.isArray(data)) setSettings(data);
        else if (data && Array.isArray(data.data)) setSettings(data.data);
        else if (data && typeof data === 'object') setSettings(Object.values(data));
        else setSettings([]);
      })
      .catch(() => setSettings([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  const groups: Record<string, any[]> = {};
  settings.forEach((s: any) => {
    const group = s.group || 'general';
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  });

  return (
    <>
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">
              <button className="btn btn-sm btn-soft-primary me-2" onClick={onBack}>
                <i className="ri-arrow-left-line"></i>
              </button>
              Client Settings
            </h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Clients</a></li>
                <li className="breadcrumb-item"><a href="#">{clientName}</a></li>
                <li className="breadcrumb-item active">Settings</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5"><Spinner color="primary" /></div>
      ) : settings.length === 0 ? (
        <Card><CardBody className="text-center py-5">
          <i className="ri-settings-3-line display-4 text-muted"></i>
          <h5 className="mt-3">No Custom Settings</h5>
          <p className="text-muted mb-0">This client is using all default platform settings.</p>
        </CardBody></Card>
      ) : (
        Object.entries(groups).map(([group, items]) => (
          <Card key={group}>
            <CardHeader className="d-flex align-items-center gap-2">
              <div className="avatar-xs"><span className="avatar-title rounded bg-primary-subtle text-primary fs-4"><i className={groupIcons[group] || 'ri-settings-3-line'}></i></span></div>
              <h5 className="card-title mb-0 text-capitalize flex-grow-1">{group}</h5>
              <span className="badge bg-primary-subtle text-primary">{items.length} settings</span>
            </CardHeader>
            <CardBody className="p-0">
              {items.map((s: any) => (
                <div key={s.id} className="d-flex justify-content-between align-items-center p-3 border-bottom">
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fs-14 text-capitalize">{s.key?.replace(/_/g, ' ')}</h6>
                    {s.description && <p className="text-muted mb-0 fs-12">{s.description}</p>}
                  </div>
                  <div className="flex-shrink-0">
                    {s.type === 'boolean' ? (
                      (s.value === 'true' || s.value === '1' || s.value === true) ? (
                        <span className="badge bg-success-subtle text-success">
                          <i className="ri-checkbox-circle-line me-1"></i>Enabled
                        </span>
                      ) : (
                        <span className="badge bg-danger-subtle text-danger">
                          <i className="ri-close-circle-line me-1"></i>Disabled
                        </span>
                      )
                    ) : (
                      <span className="badge bg-light text-dark font-monospace">
                        {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}
