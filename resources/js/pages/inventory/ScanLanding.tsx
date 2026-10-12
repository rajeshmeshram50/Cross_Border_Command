import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ingestScan, verifyDevice, normalizeScan, setDeviceToken,
  type ScanResult, type ScanDevice,
} from './putAwayStore';
import '../../../css/inventory-scan.css';

/**
 * Where every printed sticker points.
 *
 * A personal phone that photographs a company label lands HERE, because the
 * label encodes a URL rather than bare text. It arrives with no device
 * credential, so the server refuses it — and it is refused with our own
 * message rather than a decoded string it could make sense of. No product name,
 * no price, nothing but the block.
 *
 * An enrolled handheld hitting the same URL is handed straight into the
 * put-away run at whatever step it is on.
 *
 * `/s/enroll#<credential>` is the enrollment link encoded in the QR shown on
 * Inventory → Scan Devices. Scanning it ON the Zebra installs the credential
 * in the very browser that later opens stickers, so the two can never drift.
 */
type Phase =
  | { kind: 'checking' }
  | { kind: 'blocked'; device: ScanDevice | null }
  | { kind: 'enrolled'; device: ScanDevice }
  | { kind: 'scanned'; result: ScanResult };

export default function ScanLanding() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      if (key === 'enroll') {
        const token = decodeURIComponent(window.location.hash.replace(/^#/, ''));
        // Drop the secret from the address bar / history straight away.
        window.history.replaceState(null, '', window.location.pathname);
        if (token) setDeviceToken(token);
      }

      const device = await verifyDevice();
      if (cancelled) return;

      if (!device || device.status !== 'active') {
        // A credential the server no longer recognises is useless; forget it.
        if (key === 'enroll' && !device) setDeviceToken(null);
        setPhase({ kind: 'blocked', device });
        return;
      }

      if (key === 'enroll') {
        setPhase({ kind: 'enrolled', device });
        return;
      }

      // Authorised handheld: run the scan and drop the operator back into the flow.
      const result = ingestScan(normalizeScan(key));
      setPhase({ kind: 'scanned', result });
      timer = setTimeout(() => navigate('/inventory', { replace: true }), result.ok ? 700 : 2200);
    })();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [key, navigate]);

  if (phase.kind === 'checking') return null;

  if (phase.kind === 'blocked') {
    const { device } = phase;
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
          {device && (
            <p className="inv-block-body">
              This handheld is currently <strong>{device.status}</strong>.
            </p>
          )}
          <div className="inv-block-code">
            {device?.status === 'suspended' ? 'rejected_suspended_device' : 'rejected_unauthorized_device'}
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === 'enrolled') {
    return (
      <div className="inv-scan inv-block">
        <div className="inv-block-card">
          <div className="inv-block-icon is-ok"><i className="ri-check-line" /></div>
          <h1 className="inv-block-title">Handheld enrolled</h1>
          <p className="inv-block-lead">{phase.device.label}</p>
          <p className="inv-block-body">
            This browser now scans as <span className="inv-mono">{phase.device.serial}</span>.
            Company stickers opened here will be accepted.
          </p>
          <div className="inv-block-code">device_ok</div>
        </div>
      </div>
    );
  }

  const { result } = phase;
  return (
    <div className="inv-scan inv-block">
      <div className="inv-block-card">
        <div className={`inv-block-icon ${result.ok ? 'is-ok' : 'is-bad'}`}>
          <i className={result.ok ? 'ri-check-line' : 'ri-close-line'} />
        </div>
        <h1 className="inv-block-title">{result.ok ? 'Scan accepted' : 'Scan refused'}</h1>
        <p className="inv-block-lead">{result.message}</p>
        <div className="inv-block-code">{result.code}</div>
        <p className="inv-block-body">Returning to the put-away screen…</p>
      </div>
    </div>
  );
}
