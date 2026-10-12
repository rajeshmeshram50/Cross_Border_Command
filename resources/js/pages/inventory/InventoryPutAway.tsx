import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Row, Col, Card, CardBody, CardHeader, Badge, Alert, Button } from 'reactstrap';
import { PageHeader } from '../../components/ui/PageHeader';
import InventoryTabs from './InventoryTabs';
import {
  BOXES, RACKS, SHELVES, EXPECTED, WORD,
  findEntity, makeSticker, makeTamperedSticker,
  ingestScan, confirmAllocation, cancelSession,
  getSession, getActiveDevice, verifyDevice, setDeviceToken, getDeviceToken,
  type ScanResult, type PutAwaySession, type ScanDevice,
} from './putAwayStore';
import '../../../css/inventory-scan.css';

/* ------------------------------------------------------------------ pieces */

function StepRail({ step }: { step: number }) {
  const labels = ['Box', 'Rack', 'Shelf', 'Confirm'];
  return (
    <div className="inv-rail">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < step ? ' is-done' : n === step ? ' is-now' : '';
        return (
          <div key={label} className={`inv-rail-step${state}`}>
            <span className="n">{n}</span>
            {label}
          </div>
        );
      })}
    </div>
  );
}

function Slot({ label, item }: { label: string; item: { name: string; sub: string } | null }) {
  return (
    <div className={`inv-slot${item ? '' : ' is-empty'}`}>
      <span className="inv-slot-key">{label}</span>
      <span>
        <span className="inv-slot-val">{item ? item.name : '— not scanned —'}</span>
        {item && <span className="inv-slot-sub">{item.sub}</span>}
      </span>
    </div>
  );
}

function StickerButton({ title, desc, payload, bad, disabled, onScan }: {
  title: string; desc: string; payload: string; bad?: boolean;
  disabled: boolean; onScan: (payload: string) => void;
}) {
  return (
    <button
      type="button"
      className={`inv-sticker${bad ? ' is-bad' : ''}`}
      disabled={disabled}
      onClick={() => onScan(payload)}
    >
      <span className="t">{title}</span>
      <span className="d">{desc}</span>
    </button>
  );
}

/* -------------------------------------------------------------------- page */

export default function InventoryPutAway() {
  const [session, setSession] = useState<PutAwaySession | null>(() => getSession());
  const [device, setDevice] = useState<ScanDevice | null>(() => getActiveDevice());
  const [checking, setChecking] = useState(true);
  const [credential, setCredential] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [resumed, setResumed] = useState(() => !!getSession());
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const step = session?.step ?? 1;
  const canScan = device?.status === 'active' && step <= 3;

  /* The scanner is a keyboard. Keep focus in the field whenever it's live so a
     trigger pull always lands somewhere, even after a button click. */
  useEffect(() => {
    if (canScan) inputRef.current?.focus();
  }, [canScan, step, result]);

  /* DataWedge types the payload wherever focus happens to be. If the operator
     tapped a button or a dropdown, the first characters would otherwise be
     lost — so pull any stray keystroke back into the scan field. Real typing
     in another control is left alone. */
  useEffect(() => {
    if (!canScan) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canScan]);

  const refresh = useCallback(() => {
    setSession(getSession());
    setDevice(getActiveDevice());
  }, []);

  /* Who is this browser? Asked of the server on every visit — a suspension
     or retirement takes effect on the next page load, not whenever the
     handheld happens to clear its storage. */
  const recheck = useCallback(async () => {
    setChecking(true);
    await verifyDevice();
    setChecking(false);
    refresh();
  }, [refresh]);

  useEffect(() => { recheck(); }, [recheck]);

  const submit = useCallback((payload: string) => {
    if (!payload.trim()) return;
    setResult(ingestScan(payload));
    setResumed(false);
    setTyped('');
    refresh();
  }, [refresh]);

  const onConfirm = () => { setResult(confirmAllocation()); refresh(); };
  const onCancel  = () => { setResult(cancelSession());   refresh(); };

  const onInstallCredential = async () => {
    const raw = credential.trim();
    if (!raw) return;
    // Accept either the bare credential or the whole enrollment link.
    setDeviceToken(raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw);
    setCredential('');
    setResult(null);
    setResumed(false);
    await recheck();
  };

  const onForgetCredential = async () => {
    setDeviceToken(null);
    setResult(null);
    setResumed(false);
    await recheck();
  };

  const box   = session?.box   ? (findEntity('BOX',   session.box)   as { name: string; sub: string }) : null;
  const rack  = session?.rack  ? (findEntity('RACK',  session.rack)  as { name: string; sub: string }) : null;
  const shelf = session?.shelf ? (findEntity('SHELF', session.shelf) as { name: string; sub: string }) : null;

  const statusBadge = !device
    ? <Badge color="danger">Unregistered device</Badge>
    : device.status === 'active'
      ? <Badge color="success">Enrolled</Badge>
      : device.status === 'suspended'
        ? <Badge color="warning">Suspended</Badge>
        : <Badge color="dark">Retired</Badge>;

  return (
    <div className="inv-scan">
      <PageHeader
        title="Put-Away Scan"
        subtitle="Box → Rack → Shelf. Nothing is allocated until you confirm."
        icon={<i className="ri-qr-scan-2-line" />}
        actions={
          <span className="inv-simulated text-muted">
            <i className="ri-flask-line me-1" />Simulated data
          </span>
        }
      />
      <InventoryTabs />

      <Row className="g-3">
        {/* ------------------------------------------------ handheld screen */}
        <Col xl={5} lg={6}>
          <Card className="h-100">
            <CardHeader className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <h5 className="card-title mb-0 fs-14">Handheld</h5>
              <span className="d-flex align-items-center gap-2">
                {statusBadge}
                <span className="inv-mono text-muted">{device?.serial ?? '—'}</span>
              </span>
            </CardHeader>
            <CardBody>
              <StepRail step={step} />

              {device && device.status !== 'active' && (
                <Alert color="danger" className="mb-3">
                  <strong>Scanning disabled.</strong><br />
                  {device.status === 'suspended'
                    ? 'This handheld has been suspended by an administrator.'
                    : 'This handheld has been retired.'}
                  <div className="inv-mono mt-1">
                    {device.status === 'suspended' ? 'rejected_suspended_device' : 'rejected_unauthorized_device'}
                  </div>
                </Alert>
              )}
              {!device && !checking && (
                <Alert color="danger" className="mb-3">
                  <strong>Unauthorised device.</strong><br />
                  This device isn&apos;t registered with Cross_Border_Command, so it
                  cannot scan.
                  <div className="mt-2 fs-12">
                    On a Zebra handheld, scan its enrollment QR from <em>Scan Devices</em>,
                    or paste the credential under <em>This handheld</em>.
                  </div>
                  <div className="inv-mono mt-1">rejected_unauthorized_device</div>
                </Alert>
              )}

              {resumed && step > 1 && step <= 4 && (
                <Alert color="warning" className="mb-3">
                  Session resumed at step {step} — this run was already in progress.
                  <div className="inv-mono mt-1">session_restored</div>
                </Alert>
              )}

              {result && (
                <Alert color={result.ok ? 'success' : 'danger'} className="mb-3">
                  {result.message}
                  <div className="inv-mono mt-1">{result.code}</div>
                </Alert>
              )}

              {step <= 3 && (
                <>
                  <div className="mb-2">
                    <span className="inv-prompt-eyebrow">Step {step} of 4</span>
                    <h3 className="inv-prompt-title">
                      Scan the {WORD[EXPECTED[step as 1 | 2 | 3]]} sticker
                    </h3>
                  </div>
                  <form
                    className={`inv-scanbox mb-3${canScan ? ' is-live' : ''}`}
                    autoComplete="off"
                    onClick={() => inputRef.current?.focus()}
                    onSubmit={e => { e.preventDefault(); submit(typed); }}
                  >
                    <div className="inv-scanbox-hint d-flex justify-content-between">
                      <span>Scanner input · DataWedge keystroke + ENTER</span>
                      {canScan && <span className="text-success">● Ready</span>}
                    </div>
                    <input
                      ref={inputRef}
                      value={typed}
                      disabled={!canScan}
                      onChange={e => setTyped(e.target.value)}
                      placeholder={canScan ? 'Waiting for scan…' : 'Scanning disabled'}
                      aria-label="Scanned barcode"
                    />
                  </form>
                </>
              )}

              <div className="mb-3">
                <Slot label="Box" item={box} />
                <Slot label="Rack" item={rack} />
                <Slot label="Shelf" item={shelf} />
              </div>

              {step === 4 && (
                <>
                  <Alert color="info">
                    <strong>Ready to allocate.</strong> Nothing has been saved yet — confirm to commit.
                    <div className="inv-mono mt-1">pending_confirmation</div>
                  </Alert>
                  <div className="d-flex gap-2">
                    <Button color="light" className="flex-grow-1" onClick={onCancel}>Cancel</Button>
                    <Button color="success" className="flex-grow-1" onClick={onConfirm}>
                      <i className="ri-check-line me-1" />Confirm allocation
                    </Button>
                  </div>
                </>
              )}
              {step > 1 && step < 4 && (
                <Button color="light" size="sm" onClick={onCancel}>Cancel run</Button>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* ------------------------------------------------- sticker simulator */}
        <Col xl={7} lg={6}>
          <Card className="mb-3">
            <CardHeader className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <h5 className="card-title mb-0 fs-14">This handheld</h5>
              <span className="text-muted fs-11">Verified by the server on every visit</span>
            </CardHeader>
            <CardBody>
              {checking ? (
                <p className="text-muted fs-12 mb-0">Checking device credential…</p>
              ) : device ? (
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div>
                    <strong>{device.label}</strong>
                    <div className="inv-mono text-muted fs-12">{device.serial} · {device.model}</div>
                  </div>
                  <Button size="sm" color="light" onClick={onForgetCredential}>
                    <i className="ri-logout-box-r-line me-1" />Forget on this browser
                  </Button>
                </div>
              ) : (
                <>
                  <div className="d-flex gap-2">
                    <input
                      className="form-control inv-mono"
                      placeholder="CBCD-… or the enrollment link"
                      value={credential}
                      onChange={e => setCredential(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') onInstallCredential(); }}
                    />
                    <Button color="primary" onClick={onInstallCredential} disabled={!credential.trim()}>
                      Install
                    </Button>
                  </div>
                  <p className="text-muted fs-12 mb-0 mt-2">
                    {getDeviceToken()
                      ? 'The credential stored on this browser was not accepted. '
                      : ''}
                    Only enrolled handhelds can scan. Enroll the device under <em>Scan Devices</em>,
                    then scan its QR with the handheld — or paste the credential here.
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <h5 className="card-title mb-0 fs-14">Tap-to-scan stickers</h5>
              <Link to="/inventory/stickers" className="fs-12">
                <i className="ri-price-tag-3-line me-1" />Real scannable codes
              </Link>
            </CardHeader>
            <CardBody className="d-flex flex-column gap-3">
              <StickerGroup title="Boxes" disabled={!canScan} onScan={submit}
                items={BOXES.map(b => ({ title: b.name, desc: b.sub, payload: makeSticker('BOX', b.id) }))} />
              <StickerGroup title="Racks" disabled={!canScan} onScan={submit}
                items={RACKS.map(r => ({ title: r.name, desc: r.sub, payload: makeSticker('RACK', r.id) }))} />
              <StickerGroup title="Shelves" disabled={!canScan} onScan={submit}
                items={SHELVES.map(s => ({ title: s.name, desc: `${s.sub} · on ${s.rack}`, payload: makeSticker('SHELF', s.id) }))} />
              <StickerGroup title="Bad stickers — rejection demos" disabled={!canScan} onScan={submit} bad
                items={[
                  { title: 'Tampered signature', desc: 'Valid format, forged signature', payload: makeTamperedSticker() },
                  { title: 'Other tenant',       desc: 'Same format, different client',  payload: makeSticker('BOX', '1041', '19') },
                  { title: 'Retail barcode',     desc: 'Ordinary EAN-13 off a shop item', payload: '8901234567890' },
                  { title: 'Unknown box',        desc: 'Well-signed but no such box',     payload: makeSticker('BOX', '9999') },
                ]} />
            </CardBody>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function StickerGroup({ title, items, disabled, onScan, bad }: {
  title: string;
  items: { title: string; desc: string; payload: string }[];
  disabled: boolean;
  onScan: (p: string) => void;
  bad?: boolean;
}) {
  return (
    <div>
      <div className="inv-prompt-eyebrow mb-2">{title}</div>
      <div className="inv-stickers">
        {items.map(it => (
          <StickerButton key={it.title} {...it} bad={bad} disabled={disabled} onScan={onScan} />
        ))}
      </div>
    </div>
  );
}
