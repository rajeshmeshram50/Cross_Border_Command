import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../../api';
import '../../../../css/putaway-scan.css';

/**
 * Stage 04 · the handheld put-away screen.
 *
 * NEW PAGE. The Inventory Management scan screens are a simulation and are
 * left exactly as they are — this one talks to the database.
 *
 * It decides nothing. Every rule — which slot is owed, whether the pair
 * matches, how many attempts are left, when Complete may be pressed — is
 * answered by the server and rendered here. A handheld that could decide for
 * itself would be a second copy of the rules, free to disagree with the first.
 *
 * Input is a plain focused text box, because DataWedge on a Zebra types the
 * barcode as keystrokes and presses ENTER. No camera API, nothing to grant.
 */

type Step = 'scan_box' | 'confirm_box' | 'scan_shelf' | 'confirm_shelf' | 'scan_zone' | 'confirm_zone' | 'complete';

interface Device { id: number; serial: string; label: string; model: string; status: string; claimed?: boolean; }

interface TaskState {
  id: number; task_code: string; status: string;
  step: Step; step_label: string; expected: string[]; location_slot: 'shelf' | 'zone';
  chain: { kind: string; id: number; scanned: boolean; name: string | null }[];
  next_level: string | null;
  required_scans: number; completed_scans: number;
  fail_count: number; attempts_left: number;
  box_scan_at: string | null; box_confirmed_at: string | null;
  shelf_scan_at: string | null; shelf_confirmed_at: string | null;
  ready_to_complete: boolean;
}

interface BoxState {
  id: number; box_code: string; putaway_code: string; spi_code: string | null;
  gross_weight_kg: number | null; dimensions_cm: string | null;
  products: { description: string | null; quantity: number; uom: string | null }[];
}

interface Destination {
  full: string; warehouse: string | null; zone: string | null;
  rack: string | null; shelf: string | null; shelf_id: number | null; zone_id: number | null;
}

interface LocationView {
  kind: string; id: number; name: string;
  boxes: { box_id: number; box_code: string | null; weight_kg: number | null; status: string; state: string; since: string | null }[];
  count: number; used_weight_kg: number;
  max_weight_kg: number | null; free_weight_kg: number | null; used_pct: number | null;
}

interface QueueRow {
  id: number; task_code: string; box_code: string | null;
  spi_code: string | null; step: string; step_label: string; destination: string;
}

interface State {
  device: Device;
  task: TaskState | null;
  box?: BoxState | null;
  destination?: Destination | null;
  staged_location?: number | null;
  staged_kind?: string | null;
  location?: LocationView | null;
  due_here?: number;
  open?: QueueRow[];
  count?: number;
  staged_name?: string | null;
  step?: Step;
  step_label?: string;
}

/**
 * The key enrollment writes (putAwayStore.setDeviceToken). It must be read,
 * not chosen: /s/enroll installs the credential under this name, and a page
 * that invented its own would show "Device blocked" on a handheld that is
 * perfectly well enrolled.
 */
const TOKEN_KEY = 'cbc_scan_device_token_v1';

/**
 * The put-away in progress, carried across page loads.
 *
 * A handheld keeps this screen open and never needs it. A PHONE does: its
 * camera opens a URL per scan, so the box and the shelf arrive as two separate
 * page loads with nothing in common. Without this the second label has no task
 * to be judged against, and the pair can never complete.
 *
 * Only ids — the server re-proves every one of them on arrival.
 */
const RUN_KEY = 'cbc_putaway_run_v1';

type Run = { task_id?: number; staged_id?: number; staged_kind?: string };

function readRun(): Run {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) || '{}') as Run; } catch { return {}; }
}

function writeRun(run: Run | null): void {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* private mode / quota */ }
}

export default function PutawayScan() {
  // scanKey = arrived by scanning a label with a phone camera, which opens the
  // URL. taskId = opened from a list. Neither = the handheld's standing page.
  const { taskId, scanKey } = useParams();

  const [state, setState]   = useState<State | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [value, setValue]   = useState('');

  // Held only while a location was scanned BEFORE any box. The server re-proves
  // it on the box scan; this is a convenience, never a credential.
  const [staged, setStaged] = useState<{ id: number; kind: string; name: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  /* Arriving at /putaway-scan/enroll#<credential> installs it, then drops it
     from the address bar so the secret is not left in history. */
  const token = (() => {
    try {
      if (window.location.pathname.endsWith('/enroll')) {
        const fromHash = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
        if (fromHash) {
          localStorage.setItem(TOKEN_KEY, fromHash);
          window.history.replaceState(null, '', '/putaway-scan');
        }
      }

      return localStorage.getItem(TOKEN_KEY) || '';
    } catch { return ''; }
  })();

  /**
   * Every call carries the device credential; there is no user session here.
   *
   * Deliberately NOT the shared api client. That one treats any 401 as the
   * USER's session expiring — it wipes cbc_token and redirects to /login, so
   * a stale device credential would sign the operator out of the handheld. It
   * also parks certain failures instead of rejecting them, which leaves this
   * page waiting on a promise that never settles.
   *
   * A device 401 is a different fact from a user 401 and must not share that
   * machinery.
   */
  const call = useCallback(async (method: 'get' | 'post', url: string, body?: unknown) => {
    const res = await fetch(`/api${url}`, {
      method: method.toUpperCase(),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Scan-Device': token,
      },
      body: method === 'post' ? JSON.stringify(body ?? {}) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    // Shaped like an axios error, so the handlers below read the same either way.
    if (!res.ok) throw { response: { status: res.status, data } };

    return { data };
  }, [token]);

  const apply = useCallback((data: State, message?: string) => {
    setState(data);
    // Clearing the error is not cosmetic: a success rendered under a stale
    // refusal reads as "it failed", and the attempts counter beside it is a lie.
    setError(null);
    setNotice(message ?? null);

    // A location handed back without a task means it is waiting for the box.
    const stagedNow = data.staged_location
      ? { id: data.staged_location, kind: data.staged_kind || 'shelf', name: data.staged_name || '' }
      : null;
    setStaged(stagedNow);

    // A finished put-away must not be carried into the next one.
    writeRun(data.task?.status === 'scanned' ? null : {
      task_id:     data.task?.id,
      staged_id:   stagedNow?.id,
      staged_kind: stagedNow?.kind,
    });
  }, []);

  const fail = useCallback((e: unknown) => {
    const res = (e as { response?: { status?: number; data?: { message?: string; data?: State; reset?: boolean } } }).response;

    if (res?.status === 401 || res?.status === 403) {
      setBlocked(res.data?.message || 'This device is not allowed to scan.');
      return;
    }

    setError(res?.data?.message || 'That scan could not be accepted.');
    setNotice(null);

    /* Three strikes wiped the task's scans, so drop what we were carrying.
       Any OTHER refusal leaves the staged location alone: the operator has
       not moved, and making them re-scan the rack because they picked up the
       wrong carton is punishing the wrong mistake.
       A stale task id is no longer a reason to clear — the server now ignores
       a closed one rather than failing the scan. */
    if (res?.data?.reset) {
      setStaged(null);
      writeRun({ task_id: res.data.data?.task?.id });
    }
    // A refusal still carries the live task, so the screen stays truthful.
    if (res?.data?.data) setState(res.data.data);

    // Three strikes wiped the task's scans — drop what we were carrying too.
    if (res?.data?.reset) {
      setStaged(null);
      writeRun({ task_id: res.data.data?.task?.id });
    }
  }, []);

  /* Open the session, and the task when the URL names one. The handheld is
     identified by its client certificate (the browser sends it, the front door
     verifies it and passes the device in), so no token is required here — the
     server refuses with a clear message if the cert does not resolve a device. */
  useEffect(() => {
    (async () => {
      try {
        /* Landed here BY scanning: feed that label straight in, so the carton
           in their hand is already on screen rather than asking them to scan
           the thing they just scanned. */
        if (scanKey) {
          /* A camera scan is a fresh page load, so whatever this run already
             knew is gone. Hand back the task and any staged location from
             storage, or the second label would arrive with no idea which
             put-away it belongs to and the pair could never be judged. */
          const prior = readRun();

          const { data } = await call('post', '/scan/putaway/scan', {
            scanned_value: scanKey,
            task_id: prior.task_id ?? null,
            staged_location: prior.staged_id ?? null,
            staged_kind: prior.staged_kind ?? null,
          });
          apply(data.data, 'Scan accepted.');
          return;
        }

        const { data } = taskId
          ? await call('get', `/scan/putaway/${taskId}`)
          : await call('post', '/scan/putaway/session');
        setState(data.data);
      } catch (e) { fail(e); }
    })();
  }, [taskId, scanKey, token, call, fail]);

  /**
   * Claim the handheld for whoever is signed in on it.
   *
   * Runs once, quietly, and only when this browser has BOTH the device
   * credential and a logged-in session. Until a person claims it, every
   * put-away this device confirms is authored by the admin who added the
   * device row — a real user, but not the one who moved the box.
   *
   * Silent on failure: a handheld with nobody signed in still scans, it just
   * keeps the fallback author. Nagging every shift would be worse.
   */
  useEffect(() => {
    if (!state?.device || state.device.claimed) return;

    let userToken = '';
    try { userToken = localStorage.getItem('cbc_token') || ''; } catch { /* blocked */ }
    if (!userToken || !token) return;

    (async () => {
      try {
        await api.post('/scan-devices/enroll', { token }, {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        setState((s) => (s ? { ...s, device: { ...s.device, claimed: true } } : s));
        setNotice('This handheld is now signed to you.');
      } catch { /* not this client's device, or the session expired */ }
    })();
  }, [state?.device, token]);

  /* Keep the cursor in the box: DataWedge types into whatever has focus. */
  useEffect(() => {
    if (!busy && !blocked) inputRef.current?.focus();
  }, [busy, blocked, state]);

  /**
   * Catch a scan that starts while focus is somewhere else.
   *
   * A laser scanner is a keyboard. If the operator has tapped a button, the
   * barcode is typed into nothing and is simply lost — no error, no beep from
   * our side, just a scan that did nothing. Pulling focus back on the first
   * keystroke means the rest of the burst lands in the box.
   *
   * Printable keys only, so Tab and the arrows still move around the page.
   */
  useEffect(() => {
    if (blocked) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const el = inputRef.current;
      if (el && document.activeElement !== el) el.focus();
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [blocked]);

  /**
   * Submit a complete payload even when the scanner sends no ENTER.
   *
   * DataWedge only appends a key if its profile is set to; plenty are not, and
   * the barcode then sits in the box while the operator waits for a screen
   * that never changes. Once the text is a whole signed key, there is nothing
   * further to wait for — a human typing one by hand wanted to submit it too.
   */
  useEffect(() => {
    const v = value.trim();
    if (busy || !/^(?:https?:\/\/\S+\/p?s\/)?CBC1[.|](?:[^.|\s]+[.|]){4}[^.|\s]+$/i.test(v)) return;

    const t = setTimeout(() => { void submitScan(v); }, 120);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, busy]);

  const submitScan = async (raw: string) => {
    const scanned = raw.trim();
    if (!scanned || busy) return;

    setBusy(true);
    try {
      const res = await call('post', '/scan/putaway/scan', {
        scanned_value: scanned,
        task_id: state?.task?.id ?? null,
        staged_location: staged?.id ?? null,
        staged_kind: staged?.kind ?? null,
      });
      // The server speaks up when it dropped a stale run — say so, rather
      // than reporting a plain success for a scan that quietly restarted.
      const body = res.data as { data: State; notice?: string };
      apply(body.data, body.notice ?? 'Scan accepted.');
    } catch (e) { fail(e); }
    finally { setValue(''); setBusy(false); }
  };

  const act = async (url: string, body: unknown, message: string) => {
    if (busy || !state?.task) return;

    setBusy(true);
    try {
      const { data } = await call('post', url, body);
      apply(data.data, message);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  if (blocked) {
    return (
      <div className="pwscan pwscan--blocked">
        <div className="pwscan-card">
          <div className="pwscan-blockmark">✕</div>
          <h1>Device blocked</h1>
          <p>{blocked}</p>
          <p className="pwscan-muted">Ask an administrator to enrol this handheld from Inventory → Scan Devices.</p>
        </div>
      </div>
    );
  }

  if (!state) {
    /* A failure before the first state must still say something. This used to
       render "Checking this device…" unconditionally, so any error that was
       not a 401 left the page waiting forever on a check that had already
       failed — the one screen that can never explain itself. */
    return (
      <div className="pwscan pwscan--blocked">
        <div className="pwscan-card">
          {error ? (
            <>
              <div className="pwscan-blockmark">!</div>
              <h1>Could not start</h1>
              <p>{error}</p>
              <button className="pwscan-btn pwscan-btn--wide" onClick={() => window.location.reload()}>
                Try again
              </button>
            </>
          ) : <p>Checking this device…</p>}
        </div>
      </div>
    );
  }

  /* No task in hand but work outstanding: the queue. With ten tasks open,
     "scan something" is not a starting point — the operator picks one, sees
     where it goes, and walks there. */
  if (!state.task && state.open && state.open.length > 0 && !staged) {
    return (
      <div className="pwscan">
        <header className="pwscan-head">
          <div>
            <span className="pwscan-dot" /> {state.device.label}
            <span className="pwscan-muted"> · {state.device.serial}</span>
          </div>
          <div className="pwscan-code">{state.count} open</div>
        </header>

        <div className="pwscan-prompt">Pending put-aways</div>

        {error && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}

        <ul className="pwscan-queue">
          {state.open.map((t) => (
            <li key={t.id}>
              <button onClick={() => { writeRun({ task_id: t.id }); window.location.href = `/putaway-scan/${t.id}`; }}>
                <span className="pwscan-q-box">{t.box_code ?? `Task ${t.id}`}</span>
                <span className="pwscan-q-dest">{t.destination}</span>
                <span className="pwscan-q-meta">{t.task_code} · {t.spi_code}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="pwscan-attempts">or scan any box to start</div>

        <form className="pwscan-form" onSubmit={(e) => { e.preventDefault(); void submitScan(value); }}>
          <input
            ref={inputRef}
            className="pwscan-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Scan a label…"
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            disabled={busy}
          />
          <button type="submit" className="pwscan-btn" disabled={busy || !value.trim()}>Enter</button>
        </form>
      </div>
    );
  }

  const task = state.task;
  const step = (task?.step ?? state.step ?? 'scan_box') as Step;
  const slot = task?.location_slot ?? 'shelf';
  const done = task?.status === 'scanned';

  if (done) {
    return (
      <Done
        box={state.box?.box_code}
        where={state.destination?.full}
        onNext={() => { writeRun(null); window.location.href = '/putaway-scan'; }}
      />
    );
  }

  return (
    <div className="pwscan">
      <header className="pwscan-head">
        <div>
          <span className="pwscan-dot" /> {state.device.label}
          <span className="pwscan-muted"> · {state.device.serial}</span>
        </div>
        {task && <div className="pwscan-code">{task.task_code}</div>}
      </header>

      {/* The two slots, and which one is still owed. */}
      {task && (
        <>
          <div className="pwscan-slots pwscan-slots--one">
            <Slot
              title="Box"
              value={state.box?.box_code ?? '—'}
              scanned={!!task.box_scan_at}
              confirmed={!!task.box_confirmed_at}
              active={step === 'scan_box'}
            />
          </div>

          {/* The address as a ladder. A zone scan has to land somewhere
              visible, or the operator sees "scanned" and no idea how much of
              the walk is left. Scanning the shelf ticks all three at once —
              that is the point, and it should be watchable. */}
          <div className="pwscan-chain">
            <div className="pwscan-chain-t">Location</div>
            {(task.chain ?? []).map((c) => (
              <div
                key={c.kind}
                className={
                  'pwscan-rung'
                  + (c.scanned ? ' is-done' : '')
                  + (!c.scanned && c.kind === task.next_level ? ' is-next' : '')
                }
              >
                <span className="pwscan-rung-m">{c.scanned ? '✓' : '○'}</span>
                <span className="pwscan-rung-k">{c.kind}</span>
                <span className="pwscan-rung-v">{c.name ?? `#${c.id}`}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={'pwscan-prompt' + (done ? ' is-done' : '')}>
        {done ? 'Put-away complete' : (task?.step_label ?? state.step_label ?? 'Scan the box')}
      </div>

      {staged && !task && (
        <div className="pwscan-staged">
          Holding <b>{staged.name}</b> — now scan a box for it.
        </div>
      )}

      {error  && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}
      {notice && !error && <div className="pwscan-alert pwscan-alert--ok">{notice}</div>}

      {task && task.fail_count > 0 && (
        <div className="pwscan-attempts">{task.attempts_left} attempt{task.attempts_left === 1 ? '' : 's'} left before this starts again</div>
      )}

      {/* Only while a scan is actually owed. Once both labels are in, the next
          action is a button press, and a scan box sitting there reads as "do
          something else first". */}
      {!done && step.startsWith('scan') && (
        <form
          className="pwscan-form"
          onSubmit={(e) => { e.preventDefault(); void submitScan(value); }}
        >
          <input
            ref={inputRef}
            className="pwscan-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={step === 'scan_box' ? 'Scan the box label…' : `Scan the ${slot} label…`}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
          <button type="submit" className="pwscan-btn" disabled={busy || !value.trim()}>Enter</button>
        </form>
      )}

      {/* What was scanned, so the operator can read it back before confirming. */}
      {state.box && (
        <section className="pwscan-panel">
          <h2>{state.box.putaway_code}</h2>
          <dl>
            <div><dt>Box</dt><dd>{state.box.box_code}</dd></div>
            <div><dt>Invoice</dt><dd>{state.box.spi_code ?? '—'}</dd></div>
            {state.box.gross_weight_kg !== null && <div><dt>Weight</dt><dd>{state.box.gross_weight_kg} kg</dd></div>}
            {state.box.dimensions_cm && <div><dt>Size</dt><dd>{state.box.dimensions_cm} cm</dd></div>}
          </dl>
          {state.box.products.length > 0 && (
            <ul className="pwscan-items">
              {state.box.products.map((p, i) => (
                <li key={i}><span>{p.description ?? '—'}</span><b>{p.quantity} {p.uom ?? ''}</b></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* A location scanned with nothing due: answer "what is in here?". */}
      {state.location && (
        <section className="pwscan-panel">
          <h2>{state.location.name} · what is here</h2>
          {state.location.count === 0 ? (
            <div className="pwscan-dest">Empty</div>
          ) : (
            <ul className="pwscan-items">
              {state.location.boxes.map((b) => (
                <li key={b.box_id}>
                  <span>{b.box_code ?? `Box ${b.box_id}`}{b.state === 'on its way' ? ' · on its way' : ''}</span>
                  <b>{b.weight_kg !== null ? `${b.weight_kg} kg` : '—'}</b>
                </li>
              ))}
            </ul>
          )}
          <dl style={{ marginTop: 10 }}>
            <div><dt>Boxes</dt><dd>{state.location.count}</dd></div>
            <div><dt>Used</dt><dd>{state.location.used_weight_kg} kg</dd></div>
            {state.location.max_weight_kg !== null && (
              <div><dt>Free</dt><dd>{state.location.free_weight_kg} kg of {state.location.max_weight_kg} kg</dd></div>
            )}
          </dl>
          <div className="pwscan-attempts" style={{ marginTop: 10, marginBottom: 0 }}>
            Nothing is due here — scan a box to start a put-away
          </div>
        </section>
      )}

      {state.destination?.full && (
        <section className="pwscan-panel">
          <h2>Goes to</h2>
          <div className="pwscan-dest">{state.destination.full}</div>
        </section>
      )}

      {/* One action, and only the server says it may appear. */}
      {!done && task?.ready_to_complete && (
        <div className="pwscan-actions">
          <button className="pwscan-btn pwscan-btn--go" disabled={busy}
            onClick={() => act(`/scan/putaway/${task.id}/complete`, {}, 'Put-away complete.')}>
            Complete put-away
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The one moment worth celebrating: the box is physically away and the system
 * agrees. Loud on purpose — an operator glancing down mid-aisle needs to know
 * it landed without reading anything.
 */
function Done({ box, where, onNext }: { box?: string; where?: string; onNext: () => void }) {
  return (
    <div className="pwscan-done" role="status" aria-live="polite">
      <div className="pwscan-done-card">
        <div className="pwscan-done-mark">✓</div>
        <h2>Put-away complete</h2>
        <p className="pwscan-done-box">{box}</p>
        <p className="pwscan-done-where">{where}</p>
        <button className="pwscan-btn pwscan-btn--go" onClick={onNext}>Next box</button>
      </div>
    </div>
  );
}

function Slot({ title, value, scanned, confirmed, active }: {
  title: string; value: string; scanned: boolean; confirmed: boolean; active: boolean;
}) {
  const mark = confirmed ? '✓' : scanned ? '•' : '';

  return (
    <div className={'pwscan-slot' + (active ? ' is-active' : '') + (confirmed ? ' is-done' : '')}>
      <span className="pwscan-slot-t">{title}</span>
      <span className="pwscan-slot-v">{value}</span>
      <span className="pwscan-slot-m">{mark}</span>
    </div>
  );
}
