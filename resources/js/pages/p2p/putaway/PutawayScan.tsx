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

interface BoxProduct {
  sr: number;
  product_id: number | null; code: string | null; name: string | null;
  segment: string | null; brand: string | null; generic: string | null;
  image: string | null; description: string | null; hsn: string | null;
  quantity: number; uom: string | null;
  batch_no: string | null; lot_no: string | null; serial_no: string | null;
  cat_no: string | null; expiry_date: string | null; remark: string | null;
}

interface BoxState {
  id: number; box_code: string; putaway_code: string; spi_code: string | null;
  scenario: string | null; scenario_label: string | null;
  condition: string | null; is_stackable: boolean | null;
  length_cm: number | null; width_cm: number | null; height_cm: number | null;
  weight_kg: number | null; net_weight_kg: number | null; gross_weight_kg: number | null;
  vol_weight_kg: number | null;
  temp_min_c: number | null; temp_max_c: number | null;
  flags: { id: number; name: string; behaviour: string }[];
  dimensions_cm: string | null;
  products: BoxProduct[];
}

interface Destination {
  full: string; warehouse: string | null; zone: string | null;
  rack: string | null; shelf: string | null; shelf_id: number | null; zone_id: number | null;
}

interface LocationChild {
  id: number; kind: string; code: string | null; name: string | null; active: boolean;
  max_weight_kg: number | null; used_weight_kg: number;
  stored: number; shelves: number | null;
  pending: { box_code: string | null; spi_code: string | null; task_code: string; step_label: string }[];
}

interface LocationView {
  kind: string; id: number; name: string;
  address?: { zone: string | null; rack: string | null; shelf: string | null; code: string };
  // The master's own description, and what sits one level down.
  details?: { label: string; value: string }[];
  children?: LocationChild[];
  boxes: { box_id: number; box_code: string | null; weight_kg: number | null; status: string; state: string; since: string | null }[];
  count: number; used_weight_kg: number;
  max_weight_kg: number | null; free_weight_kg: number | null; used_pct: number | null;
}

interface QueueRow {
  id: number; task_code: string; box_code: string | null;
  spi_code: string | null; step: string; step_label: string; destination: string;
  // Only on due_boxes: the row is tappable, and scanning needs the box.
  box_id?: number;
  started?: boolean;
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
  // The open tasks pointing at a location that was scanned first.
  due_boxes?: QueueRow[];
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

/**
 * A refusal, in four words.
 *
 * The server's sentence explains itself to anyone reading it later; an
 * operator holding a carton mid-aisle needs the verdict, and the label to
 * scan instead comes on the line below it.
 */
const SHORT: Record<string, string> = {
  wrong_location:   'Wrong location',
  wrong_label_type: 'Wrong label',
  location_unusable:'Location unavailable',
  wrong_box:        'Wrong box',
  unknown_box:      'Box not found',
  unknown_location: 'Location not found',
  no_task:          'No put-away for this box',
  already_scanned:  'Already scanned',
  unreadable:       'Not a Cross Border label',
  bad_signature:    'Label failed its check',
};

/** The packer's verdict on the carton, in the words the packing screen used. */
const CONDITION: Record<string, string> = {
  perfect: 'Perfect — no damage',
  minor: 'Minor damage — light wear',
  major: 'Critical damage — not usable',
  severe: 'Rejected — critical damage',
  mismatch: 'Mismatched — wrong item',
};

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
  /* One floating message for both outcomes. A success is news for a moment;
     a refusal has to carry what to do next, so it stays longer. */
  const [toast, setToast]   = useState<{ kind: 'ok' | 'bad'; text: string; sub?: string } | null>(null);
  /* A carton that is already away is not a failure — it gets its own card
     with the proof, rather than a red line that reads like a mistake. */
  const [placed, setPlaced] = useState<{ box_code: string; destination: string; at: string | null; method: string | null; by: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [value, setValue]   = useState('');

  // Held only while a location was scanned BEFORE any box. The server re-proves
  // it on the box scan; this is a convenience, never a credential.
  const [staged, setStaged] = useState<{ id: number; kind: string; name: string } | null>(null);

  // Which pile of the scanned location's boxes is on screen.
  const [locTab, setLocTab] = useState<'pending' | 'in_progress' | 'placed'>('pending');

  // The product line opened from the box's list.
  const [product, setProduct] = useState<BoxProduct | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Which rungs were already proved before the last scan, to tell a scan that
  // moved the put-away from one that repeated a level.
  const chainRef = useRef<string>('');

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
    setPlaced(null);
    setNotice(message ?? null);

    /* What the scan actually moved, and what is still owed.
       A rack scanned twice is accepted by the server and proves nothing new —
       reporting "scan accepted" there reads as progress that did not happen. */
    const t = data.task;
    const proved = (t?.chain ?? []).filter((c) => c.scanned).map((c) => c.kind);
    const sameAsBefore = proved.join(',') === chainRef.current && !!t?.box_scan_at;
    chainRef.current = proved.join(',');

    const owedKind = t?.next_level;
    const owedCode = owedKind === 'zone' ? data.destination?.zone
      : owedKind === 'rack' ? data.destination?.rack
      : data.destination?.shelf;

    if (message) {
      setToast({
        kind: 'ok',
        text: sameAsBefore && owedKind
          ? `${proved[proved.length - 1] ?? 'That'} already scanned`.replace(/^./, (s) => s.toUpperCase())
          : message,
        sub: owedKind && owedCode ? `Now scan the ${owedKind} ${owedCode}` : undefined,
      });
    }

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
    const res = (e as {
      response?: {
        status?: number;
        data?: {
          message?: string; data?: State; reset?: boolean; code?: string; attempts_left?: number | null;
          placed?: { box_code: string; destination: string; at: string | null; method: string | null; by: string | null };
        };
      };
    }).response;

    if (res?.status === 401 || res?.status === 403) {
      setBlocked(res.data?.message || 'This device is not allowed to scan.');
      return;
    }

    // Already away: a statement of fact, not a refusal to act on.
    if (res?.data?.code === 'already_placed' && res.data.placed) {
      setPlaced(res.data.placed);
      setError(null);
      setNotice(null);
      if (res.data.data) setState(res.data.data);

      return;
    }

    const code = res?.data?.code ?? '';
    const live = res?.data?.data;

    /* The label they should be holding instead, named by the server's own
       answer rather than by anything this page remembers. */
    const owed = live?.task?.next_level === 'zone' ? live?.destination?.zone
      : live?.task?.next_level === 'rack' ? live?.destination?.rack
      : live?.destination?.shelf;

    const short = SHORT[code] ?? 'Scan not accepted';
    const sub = ['wrong_location', 'wrong_label_type'].includes(code) && owed
      // Name the level too: with the rack already proved, "scan RC-001-SH-112"
      // is only obvious to someone who reads codes for a living.
      ? `Scan the ${live?.task?.next_level ?? 'shelf'} ${owed}`
      : code === 'wrong_box' && live?.box?.box_code
        ? `This task wants ${live.box.box_code}`
        : undefined;

    setPlaced(null);
    setError(short);
    setNotice(null);
    // A refusal has to reach someone looking at a carton, not at the screen.
    setToast({ kind: 'bad', text: short, sub });

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

  /* Three seconds is a glance. Longer and it becomes a badge the operator
     stops reading; shorter and a scan that landed looks like nothing happened. */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);

    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'bad' ? 6000 : 3000);

    return () => clearTimeout(t);
  }, [toast]);

  /* Land on the pile that has something in it — opening on an empty Pending
     tab reads as "nothing here" when the work is one tab over. */
  useEffect(() => {
    const loc = state?.location;
    if (!loc) return;

    const due = state?.due_boxes ?? [];
    const owed = new Set(due.map((d) => d.box_id).filter(Boolean) as number[]);
    const pending = due.filter((d) => !d.started).length
      + loc.boxes.filter((b) => b.state !== 'stored' && !owed.has(b.box_id)).length;
    const progress = due.filter((d) => d.started).length;

    setLocTab(pending > 0 ? 'pending' : progress > 0 ? 'in_progress' : 'placed');
  }, [state?.location, state?.due_boxes]);

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
  const dest = state.destination;

  /* One input, rendered in one of two places — the ref must stay on a single
     instance or focus-capture lands on whichever React mounted last. The
     label sits with it: that is where the operator is looking. */
  const scanForm = (
    <>
    {/* The refusal belongs here, beside the field it is about — at the top of
        the page it sits off-screen behind the box details. */}
    {error && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}
    {task && task.fail_count > 0 && (
      <div className="pwscan-attempts">
        {task.attempts_left} attempt{task.attempts_left === 1 ? '' : 's'} left before this box starts again
      </div>
    )}

    <div className="pwscan-prompt pwscan-prompt--field">
      {step === 'scan_box' ? 'Scan the box' : 'Scan the zone / rack / shelf'}
    </div>
    <form className="pwscan-form" onSubmit={(e) => { e.preventDefault(); void submitScan(value); }}>
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
    </>
  );

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
      {/* Both outcomes float; neither becomes a label on the screen. */}
      {toast && (
        <div
          className={'pwscan-toast pwscan-toast--' + toast.kind}
          role="status"
          aria-live={toast.kind === 'bad' ? 'assertive' : 'polite'}
          onClick={() => setToast(null)}
        >
          <b>{toast.text}</b>
          {toast.sub && <small>{toast.sub}</small>}
        </div>
      )}

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
              // The invoice rides with the box id, so neither is repeated below.
              meta={state.box?.spi_code ?? null}
              scanned={!!task.box_scan_at}
              confirmed={!!task.box_confirmed_at}
              active={step === 'scan_box'}
            />
          </div>

        </>
      )}

      {/* Only what a scan cannot say for itself. The step prompt lives with
          the input at the foot of the screen; this covers the rest — "both
          matched, press Complete" and the like. */}
      {!state.location && !step.startsWith('scan') && (
        <div className={'pwscan-prompt' + (done ? ' is-done' : '')}>
          {done ? 'Put-away complete' : (task?.step_label ?? state.step_label ?? '')}
        </div>
      )}

      {staged && !task && !state.location && (
        <div className="pwscan-staged">
          Holding <b>{staged.name}</b> — now scan a box for it.
        </div>
      )}


      {/* Already away. Green, because nothing is wrong — the carton is where
          it should be and the operator needs the proof, not a telling-off. */}
      {placed && (
        <section className="pwscan-placed">
          <div className="pwscan-placed-h">
            <span className="pwscan-placed-m">✓</span>
            <b>{placed.box_code} is already put away</b>
          </div>
          <dl>
            <div><dt>Location</dt><dd>{placed.destination}</dd></div>
            {placed.at && (
              <div><dt>When</dt><dd>{new Date(placed.at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd></div>
            )}
            <div><dt>How</dt><dd>{placed.method === 'scan' ? 'Scanned' : 'Confirmed by hand'}</dd></div>
            {placed.by && <div><dt>By</dt><dd>{placed.by}</dd></div>}
          </dl>
          <div className="pwscan-placed-f">
            <span>Nothing to do — scan the next box.</span>
            <button className="pwscan-btn" onClick={() => setPlaced(null)}>Dismiss</button>
          </div>
        </section>
      )}

      {/* Both of these now travel with the scan field — see scanForm. Kept
          here only for the states that render no field at all. */}
      {error && !step.startsWith('scan') && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}

      {/* Only while a scan is actually owed. Once both labels are in, the next
          action is a button press, and a scan box sitting there reads as "do
          something else first".
          On the location read-out it goes last instead — the lists above are
          what the operator came to read. */}

      {/* What was scanned, so the operator can read it back before confirming. */}
      {state.box && (
        <>
          <section className="pwscan-panel">
            <h2>Box details</h2>

            {state.box.scenario_label && (
              <div className="pwscan-boxid-m">{state.box.scenario_label}</div>
            )}

            {/* The same numbers the packer typed, read back in the same words. */}
            <div className="pwscan-grid">
              {([['Length', state.box.length_cm, 'cm'],
                 ['Width', state.box.width_cm, 'cm'],
                 ['Height', state.box.height_cm, 'cm'],
                 ['Weight', state.box.weight_kg, 'kg'],
                 ['Net weight', state.box.net_weight_kg, 'kg'],
                 ['Gross weight', state.box.gross_weight_kg, 'kg'],
                 ['Vol. weight', state.box.vol_weight_kg, 'kg']] as const)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([label, v, unit]) => (
                  <div key={label}><span>{label}</span><b>{v} <i>{unit}</i></b></div>
                ))}
            </div>

            <dl className="pwscan-mt">
              <div><dt>Put-away</dt><dd>{state.box.putaway_code}</dd></div>
              {state.box.condition && (
                <div><dt>Box condition</dt><dd>{CONDITION[state.box.condition] ?? state.box.condition}</dd></div>
              )}
              {state.box.is_stackable !== null && (
                <div><dt>Stackable</dt><dd>{state.box.is_stackable ? 'Yes' : 'No — keep on top'}</dd></div>
              )}
              {(state.box.temp_min_c !== null || state.box.temp_max_c !== null) && (
                <div><dt>Temperature</dt><dd>{state.box.temp_min_c} … {state.box.temp_max_c} °C</dd></div>
              )}
            </dl>

            {state.box.flags.length > 0 && (
              <div className="pwscan-flags">
                {state.box.flags.map((f) => (
                  <span key={f.id} className={'pwscan-flag pwscan-flag--' + f.behaviour}>{f.name}</span>
                ))}
              </div>
            )}

            {/* The address lives here rather than in a panel of its own, and
                it doubles as the progress: scanning the zone or the rack ticks
                that level, so the operator sees how much of the walk is left. */}
            {dest?.full && (
              <div className="pwscan-loc3 pwscan-loc3--mid">
                {([['Zone', 'zone', dest.zone],
                   ['Rack', 'rack', dest.rack],
                   ['Shelf', 'shelf', dest.shelf]] as const).map(([label, kind, code]) => {
                  const rung = (task?.chain ?? []).find((c) => c.kind === kind);
                  const cls = rung?.scanned ? ' is-done' : (kind === task?.next_level ? ' is-next' : '');

                  return (
                    <div key={kind} className={cls.trim()}>
                      <span>{label}{rung?.scanned ? ' ✓' : ''}</span>
                      <b>{code ?? '—'}</b>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {state.box.products.length > 0 && (
            <section className="pwscan-panel">
              <h2>Products in this box · {state.box.products.length}</h2>
              {/* Five rows, then it scrolls — a mixed carton can carry ten. */}
              <ul className={'pwscan-prods' + (state.box.products.length > 5 ? ' is-scroll' : '')}>
                {state.box.products.map((p) => (
                  <li key={p.sr}>
                    <button onClick={() => setProduct(p)}>
                      <span className="pwscan-prods-sr">{p.sr}</span>
                      <span className="pwscan-prods-img">
                        {p.image
                          ? <img src={p.image} alt="" loading="lazy" />
                          : <span className="pwscan-prods-ph">▣</span>}
                      </span>
                      <span className="pwscan-prods-t">
                        <b>{p.name ?? '—'}{p.code ? ` (${p.code})` : ''}</b>
                        <small>{p.segment ?? 'No segment'}</small>
                        <small>Qty: {p.quantity}{p.uom ? ` | Unit: ${p.uom}` : ''}</small>
                      </span>
                      <span className="pwscan-prods-go">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* A location was scanned: where this is, what is already on it, and
          what the floor still owes it. Both halves of the same question. */}
      {state.location && (
        <>
          {/* Its own title bar: what this screen is, and which handheld is
              asking. The page header carries the run; this carries the place. */}
          <div className="pwscan-sechead">
            <span className="pwscan-sechead-t">
              {state.location.kind.charAt(0).toUpperCase() + state.location.kind.slice(1)} details
            </span>
            <span className="pwscan-sechead-d">
              <small>Zebra device</small>
              <b>{state.device.serial}</b>
            </span>
          </div>

          <section className="pwscan-loche">
            <span className="pwscan-loche-i" aria-hidden="true">▤</span>
            <span className="pwscan-loche-t">
              <b>{state.location.name}</b>
              <small>{state.location.kind}</small>
            </span>
            <span className="pwscan-tag pwscan-tag--ok">Valid location</span>
          </section>

          <section className="pwscan-panel">
            <h2>Location information</h2>
            <dl>
              {(state.location.details?.length ?? 0) > 0 ? (
                state.location.details!.map((r) => (
                  <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
                ))
              ) : (
                <>
                  <div><dt>Zone</dt><dd>{state.location.address?.zone ?? '—'}</dd></div>
                  <div><dt>Rack</dt><dd>{state.location.address?.rack ?? '—'}</dd></div>
                  <div><dt>Shelf</dt><dd>{state.location.address?.shelf ?? '—'}</dd></div>
                </>
              )}
              <div><dt>Barcode</dt><dd>{state.location.address?.code ?? state.location.name}</dd></div>
              {state.location.max_weight_kg !== null && (
                <div><dt>Free</dt><dd>{state.location.free_weight_kg} kg of {state.location.max_weight_kg} kg</dd></div>
              )}
            </dl>
          </section>

          {/* A rack was scanned in front of several shelves: say which shelf
              owes what, rather than one number for the whole rack. */}
          {(state.location.children?.length ?? 0) > 0 && (
            <section className="pwscan-panel">
              <h2>
                {state.location.children![0].kind === 'shelf' ? 'Shelf' : 'Rack'}
                {' · '}{state.location.children!.length}
              </h2>

              {/* One line each: what it is called, its code, what it carries,
                  and the two numbers. The boxes themselves live a scan away. */}
              <ul className="pwscan-kids">
                {state.location.children!.map((c) => (
                  <li key={c.id} className={'pwscan-kid' + (c.active ? '' : ' is-off')}>
                    <span className="pwscan-kid-t">
                      <b>{c.name ?? c.code ?? `#${c.id}`}</b>
                      <small>{c.code ?? `#${c.id}`}</small>
                    </span>
                    <span className="pwscan-kid-w">{c.used_weight_kg} kg</span>
                    <span className="pwscan-kid-tags">
                      {/* A rack is measured in shelves; a shelf in boxes. */}
                      {c.shelves !== null ? (
                        <span className={'pwscan-tag ' + (c.shelves > 0 ? 'pwscan-tag--ok' : 'pwscan-tag--mute')}>
                          {c.shelves} {c.shelves === 1 ? 'shelf' : 'shelves'}
                        </span>
                      ) : (
                        <>
                          <span className={'pwscan-tag ' + (c.pending.length > 0 ? 'pwscan-tag--due' : 'pwscan-tag--mute')}>
                            {c.pending.length}
                          </span>
                          <span className="pwscan-tag pwscan-tag--ok">{c.stored}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {state.location.children![0].kind === 'shelf' && (
                <div className="pwscan-kid-key">pending · placed</div>
              )}
            </section>
          )}

          {(() => {
            /* Three piles, from the two sources the server sends: the open
               tasks owed here, and what the shelf is actually carrying.
               A reserved box with no open task is still Pending — somebody
               allocated it and nobody has started. */
            // A rack or zone already broke this down shelf by shelf above;
            // the same boxes again, flattened, would only disagree with it.
            if ((state.location!.children?.length ?? 0) > 0) return null;

            const due = state.due_boxes ?? [];
            const owed = new Set(due.map((d) => d.box_id).filter(Boolean) as number[]);

            const pending = due.filter((d) => !d.started);
            const progress = due.filter((d) => d.started);
            const placed = state.location!.boxes.filter((b) => b.state === 'stored');
            const waiting = state.location!.boxes.filter((b) => b.state !== 'stored' && !owed.has(b.box_id));

            const tabs = [
              ['pending', 'Pending', pending.length + waiting.length],
              ['in_progress', 'In Progress', progress.length],
              ['placed', 'Placed', placed.length],
            ] as const;

            return (
              <section className="pwscan-panel">
                <h2>Assigned boxes</h2>

                <div className="pwscan-tabs" role="tablist">
                  {tabs.map(([key, label, n]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={locTab === key}
                      className={'pwscan-tab' + (locTab === key ? ' is-on' : '')}
                      onClick={() => setLocTab(key)}
                    >
                      {label}
                      <span className={'pwscan-tab-n' + (n === 0 ? ' is-zero' : '')}>{n}</span>
                    </button>
                  ))}
                </div>

                {/* Five rows, then it scrolls — a shelf can hold far more than
                    fits on a handheld, and the panels below must stay reachable. */}
                <ul className="pwscan-boxes pwscan-boxes--scroll">
                  {locTab === 'pending' && pending.map((t) => (
                    <li key={`p-${t.id}`}>
                      <button onClick={() => void submitScan(String(t.box_id ?? ''))} disabled={busy || !t.box_id}>
                        <span className="pwscan-boxes-i" aria-hidden="true">▣</span>
                        <span className="pwscan-boxes-t">
                          <b>{t.box_code ?? `Task ${t.id}`}</b>
                          <small>{t.spi_code ?? t.task_code} · {t.step_label}</small>
                        </span>
                        <span className="pwscan-tag pwscan-tag--due">Pending</span>
                      </button>
                    </li>
                  ))}

                  {locTab === 'pending' && waiting.map((b) => (
                    <li key={`w-${b.box_id}`}>
                      <button onClick={() => void submitScan(String(b.box_id))} disabled={busy}>
                        <span className="pwscan-boxes-i" aria-hidden="true">▣</span>
                        <span className="pwscan-boxes-t">
                          <b>{b.box_code ?? `Box ${b.box_id}`}</b>
                          <small>allocated · {b.weight_kg !== null ? `${b.weight_kg} kg` : '—'}</small>
                        </span>
                        <span className="pwscan-tag pwscan-tag--due">Pending</span>
                      </button>
                    </li>
                  ))}

                  {locTab === 'in_progress' && progress.map((t) => (
                    <li key={`i-${t.id}`}>
                      <button onClick={() => void submitScan(String(t.box_id ?? ''))} disabled={busy || !t.box_id}>
                        <span className="pwscan-boxes-i" aria-hidden="true">▣</span>
                        <span className="pwscan-boxes-t">
                          <b>{t.box_code ?? `Task ${t.id}`}</b>
                          <small>{t.spi_code ?? t.task_code} · {t.step_label}</small>
                        </span>
                        <span className="pwscan-tag pwscan-tag--due">In progress</span>
                      </button>
                    </li>
                  ))}

                  {locTab === 'placed' && placed.map((b) => (
                    <li key={`d-${b.box_id}`}>
                      <span className="pwscan-boxes-row">
                        <span className="pwscan-boxes-i" aria-hidden="true">▣</span>
                        <span className="pwscan-boxes-t">
                          <b>{b.box_code ?? `Box ${b.box_id}`}</b>
                          <small>{b.weight_kg !== null ? `${b.weight_kg} kg` : '—'}</small>
                        </span>
                        <span className="pwscan-tag pwscan-tag--ok">Placed</span>
                      </span>
                    </li>
                  ))}
                </ul>

                {((locTab === 'pending' && pending.length + waiting.length === 0)
                  || (locTab === 'in_progress' && progress.length === 0)
                  || (locTab === 'placed' && placed.length === 0)) && (
                  <div className="pwscan-attempts" style={{ marginBottom: 0 }}>
                    {locTab === 'placed' ? 'Nothing stored here yet' : 'Nothing in this list'}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Last thing on the screen, under the lists it acts on. */}
          {!done && step.startsWith('scan') && scanForm}
        </>
      )}

      {/* Only when there is no box panel to carry it — with a box in hand the
          address sits inside those details, next to the ids it belongs to. */}
      {state.destination?.full && !state.box && (
        <section className="pwscan-panel">
          <h2>Suggested location</h2>
          <div className="pwscan-loc3">
            <div><span>Zone</span><b>{state.destination.zone ?? '—'}</b></div>
            <div><span>Rack</span><b>{state.destination.rack ?? '—'}</b></div>
            <div><span>Shelf</span><b>{state.destination.shelf ?? '—'}</b></div>
          </div>
        </section>
      )}

      {/* The field goes last: the panels above are what the operator reads,
          and the next action is a scan into this box. */}
      {!done && step.startsWith('scan') && !state.location && scanForm}

      {product && (
        <ProductSheet
          product={product}
          boxCode={state.box?.box_code ?? null}
          spiCode={state.box?.spi_code ?? null}
          onClose={() => setProduct(null)}
        />
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

/**
 * One product line, opened from the box's list.
 *
 * Carries its parentage — invoice and box — because the operator arrived here
 * from a carton, and a product detached from the carton it came in is not
 * something they can act on.
 */
function ProductSheet({ product, boxCode, spiCode, onClose }: {
  product: BoxProduct; boxCode: string | null; spiCode: string | null; onClose: () => void;
}) {
  const rows: [string, string | null][] = [
    ['Invoice', spiCode],
    ['Box', boxCode],
    ['Product code', product.code],
    ['Segment', product.segment],
    ['Brand', product.brand],
    ['Generic name', product.generic],
    ['HSN', product.hsn],
    ['Batch', product.batch_no],
    ['Lot', product.lot_no],
    ['Serial', product.serial_no],
    ['Catalogue', product.cat_no],
    ['Expiry', product.expiry_date],
    ['Remark', product.remark],
  ];

  return (
    <div className="pwscan-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="pwscan-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="pwscan-sheet-h">
          <b>Product details</b>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="pwscan-sheet-top">
          <span className="pwscan-prods-img pwscan-prods-img--lg">
            {product.image ? <img src={product.image} alt="" /> : <span className="pwscan-prods-ph">▣</span>}
          </span>
          <span className="pwscan-sheet-id">
            <b>{product.name ?? '—'}</b>
            <small>Qty: {product.quantity}{product.uom ? ` | Unit: ${product.uom}` : ''}</small>
          </span>
        </div>

        <dl className="pwscan-sheet-dl">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        {product.description && product.description !== product.name && (
          <p className="pwscan-sheet-desc">{product.description}</p>
        )}

        <div className="pwscan-sheet-total">
          <span>Total in box</span>
          <b>{product.quantity} {product.uom ?? ''}</b>
        </div>

        <button className="pwscan-btn pwscan-btn--wide" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Slot({ title, value, meta, scanned, confirmed, active }: {
  title: string; value: string; meta?: string | null; scanned: boolean; confirmed: boolean; active: boolean;
}) {
  const mark = confirmed ? '✓' : scanned ? '•' : '';

  return (
    <div className={'pwscan-slot' + (active ? ' is-active' : '') + (confirmed ? ' is-done' : '')}>
      <span className="pwscan-slot-t">{title}</span>
      <span className="pwscan-slot-v">{value}</span>
      {meta && <span className="pwscan-slot-s">{meta}</span>}
      <span className="pwscan-slot-m">{mark}</span>
    </div>
  );
}
