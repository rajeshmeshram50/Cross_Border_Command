import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ingestScan, isDeviceAuthorized, getActiveDevice, normalizeScan,
  type ScanResult,
} from './putAwayStore';
import '../../../css/inventory-scan.css';

/**
 * Where every printed sticker points.
 *
 * A personal phone that photographs a company label lands HERE, because the
 * label encodes a URL rather than bare text. It arrives with no device
 * credential, so it is refused — and, crucially, it is refused with our own
 * message rather than a decoded string it could make sense of. No product name,
 * no price, nothing but the block.
 *
 * An enrolled handheld hitting the same URL is handed straight into the
 * put-away run at whatever step it is on.
 */
export default function ScanLanding() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [checked, setChecked] = useState(false);

  const device = getActiveDevice();
  const authorized = isDeviceAuthorized();

  useEffect(() => {
    if (!authorized) { setChecked(true); return; }
    // Authorised handheld: run the scan and drop the operator back into the flow.
    const res = ingestScan(normalizeScan(key));
    setResult(res);
    setChecked(true);
    const t = setTimeout(() => navigate('/inventory', { replace: true }), res.ok ? 700 : 2200);
    return () => clearTimeout(t);
  }, [key, authorized, navigate]);

  if (!checked) return null;

  if (!authorized) {
    return (
      <div className="inv-scan inv-block">
        <div className="inv-block-card">
          <div className="inv-block-icon"><i className="ri-forbid-2-line" /></div>
          <h1 className="inv-block-title">Device blocked</h1>
          <p className="inv-block-lead">This device is not authorized.</p>
          <p className="inv-block-body">
            Company labels can only be read on a registered handheld. Please use an
            authorised device, or contact your administrator if you believe this
            device should be registered.
          </p>
          {device && device.status !== 'active' && (
            <p className="inv-block-body">
              This handheld is currently <strong>{device.status}</strong>.
            </p>
          )}
          <div className="inv-block-code">
            {device ? 'rejected_suspended_device' : 'rejected_unauthorized_device'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inv-scan inv-block">
      <div className="inv-block-card">
        <div className={`inv-block-icon ${result?.ok ? 'is-ok' : 'is-bad'}`}>
          <i className={result?.ok ? 'ri-check-line' : 'ri-close-line'} />
        </div>
        <h1 className="inv-block-title">{result?.ok ? 'Scan accepted' : 'Scan refused'}</h1>
        <p className="inv-block-lead">{result?.message}</p>
        <div className="inv-block-code">{result?.code}</div>
        <p className="inv-block-body">Returning to the put-away screen…</p>
      </div>
    </div>
  );
}
