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
  // The idle clock. The server owns the threshold; this page only counts down.
  last_activity_at: string | null;
  idle_after_minutes: number;
  // Seconds left, or null when no clock is running. A duration, so the
  // handheld's own clock never enters into it.
  idle_seconds_left: number | null;
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
  // Set when an already-put-away box is re-scanned: show the FULL details
  // screen (box, products, its location), not the minimal Done card. (CS-956 #64)
  already_placed?: boolean;
  // Set when a box with no open put-away task is scanned: show its details
  // read-only (no scan field, no Complete) instead of a bare refusal.
  no_task?: boolean;
  staged_name?: string | null;
  step?: Step;
  step_label?: string;
}

interface SpiBoxRow { box_code: string | null; status: string; box_qr: boolean; shelf_qr: boolean; destination: string | null; }
interface SpiBoxesBody { spi_code: string | null; count: number; placed: number; boxes: SpiBoxRow[]; }

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
/** The queue. Where a device that lost its session is sent back to. */
const INDEX_PATH = '/putaway-scan';

/**
 * Why the last run ended, left for the queue to read once on arrival.
 *
 * sessionStorage, not state: the hand-over IS a page load, so there is no
 * component left to carry it across. Cleared as it is read, or the operator
 * would be told about a timeout from an hour ago every time they came back.
 */
const IDLE_KEY = 'pwscan_idle_notice';

const SHORT: Record<string, string> = {
  wrong_location:   'Wrong location',
  wrong_label_type: 'Wrong label',
  location_unusable:'Location unavailable',
  wrong_box:        'Wrong box',
  unknown_box:      'Box not found',
  unknown_location: 'Location not found',
  no_task:          'No put-away for this box',
  /* The device is enrolled and the label is genuine — it is the pairing that
     is wrong. "Box not found" used to be shown here, which reads as a bad
     label and sends the operator to reprint a perfectly good one. */
  device_wrong_client: 'Not this organisation',
  device_wrong_branch: 'Wrong branch for this device',
  box_not_packed:      'Box not packed to an invoice',
  already_scanned:  'Already scanned',
  unreadable:       'Not a Cross Border label',
  bad_signature:    'Label failed its check',
  /* Both reach the operator as a scan problem otherwise, when neither is:
     one is a missing certificate, the other a server that never answered. */
  rejected_unauthorized_device: 'Device not authorised',
  no_answer:        'No answer from the server',
};

/** The three rungs, named as the label prints them. */
const LEVEL: Record<string, string> = { zone: 'Zone', rack: 'Rack', shelf: 'Shelf' };

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

/* ───────────────── Demo mode (?demo=<screen>) ─────────────────
 * Renders the REAL screen frozen on static data so the UI can be checked on the
 * device via the QR codes in the Handheld Screens guide. No server calls and no
 * navigation: every live effect short-circuits when `demoKey` is set. */
const DEMO_DEVICE: Device = { id: 1, serial: '2601352470', label: 'WH-PUNE-01', model: 'Zebra TC27', status: 'active', claimed: true };
const DEMO_TIME = '2026-11-12T10:58:00+05:30';
const DEMO_PRODUCTS: BoxProduct[] = [
  { sr: 1, product_id: 1, code: 'SKU-1001', name: 'Amoxicillin 500mg', segment: 'Pharma', brand: 'Acme', generic: 'Amoxicillin', image: null, description: null, hsn: '3004', quantity: 20, uom: 'Box', batch_no: 'BT-2201', lot_no: 'LT-11', serial_no: null, cat_no: 'CT-9', expiry_date: '2027-06-30', remark: 'correct' },
  { sr: 2, product_id: 2, code: 'SKU-1002', name: 'Saline 0.9% 500ml', segment: 'Fluids', brand: 'Acme', generic: 'NaCl', image: null, description: null, hsn: '3004', quantity: 12, uom: 'Bottle', batch_no: 'BT-2202', lot_no: 'LT-12', serial_no: null, cat_no: 'CT-10', expiry_date: '2028-01-31', remark: 'correct' },
  { sr: 3, product_id: 3, code: 'SKU-1003', name: 'Surgical Gloves M', segment: 'Consumable', brand: 'Acme', generic: null, image: null, description: null, hsn: '4015', quantity: 50, uom: 'Pair', batch_no: 'BT-2203', lot_no: null, serial_no: null, cat_no: 'CT-11', expiry_date: null, remark: 'correct' },
  { sr: 4, product_id: 4, code: 'SKU-1004', name: 'Insulin Pen', segment: 'Cold Chain', brand: 'Acme', generic: 'Insulin', image: null, description: null, hsn: '3004', quantity: 6, uom: 'Pen', batch_no: 'BT-2204', lot_no: 'LT-14', serial_no: 'SN-77', cat_no: 'CT-12', expiry_date: '2027-03-15', remark: 'correct' },
];
const DEMO_BOX: BoxState = {
  id: 1, box_code: 'B-001', putaway_code: 'PUT-B-001', spi_code: 'SPI/2026-27/005',
  scenario: 's3', scenario_label: 'Multiple products → 1 box', condition: 'perfect', is_stackable: true,
  length_cm: 10, width_cm: 10, height_cm: 10, weight_kg: 1, net_weight_kg: 1, gross_weight_kg: 1, vol_weight_kg: 0.17,
  temp_min_c: 2, temp_max_c: 8,
  flags: [{ id: 1, name: 'Hazardous', behaviour: 'warn' }, { id: 2, name: 'Cold Chain', behaviour: 'warn' }],
  dimensions_cm: '10 x 10 x 10', products: DEMO_PRODUCTS,
};
const DEMO_DEST: Destination = { full: 'Zone ZN-A · Rack RK-A1 · Shelf SH-102', warehouse: 'WH-PUNE-01', zone: 'ZN-A', rack: 'RK-A1', shelf: 'SH-102', shelf_id: 102, zone_id: 1 };
const DEMO_OPEN: QueueRow[] = [
  { id: 1, task_code: 'ZT-20261024-001', box_code: 'B-001', spi_code: 'SPI/2026-27/005', step: 'scan_box', step_label: 'Scan the box', destination: 'SH-102' },
  { id: 2, task_code: 'ZT-20261024-002', box_code: 'B-010', spi_code: 'SPI/2026-27/005', step: 'scan_box', step_label: 'Scan the box', destination: 'SH-102' },
];
const DEMO_SPI_BOXES: SpiBoxesBody = {
  spi_code: 'SPI/2026-27/005', count: 4, placed: 1,
  boxes: [
    { box_code: 'B-001', status: 'placed', box_qr: true, shelf_qr: true, destination: 'SH-101' },
    { box_code: 'B-002', status: 'box_scanned', box_qr: true, shelf_qr: false, destination: 'SH-102' },
    { box_code: 'B-007', status: 'pending', box_qr: false, shelf_qr: false, destination: 'RK-A1' },
    { box_code: 'B-010', status: 'pending', box_qr: false, shelf_qr: false, destination: 'SH-102' },
  ],
};
const demoChain = (scanned: boolean) => [
  { kind: 'zone', id: 1, scanned, name: 'ZN-A' },
  { kind: 'rack', id: 2, scanned, name: 'RK-A1' },
  { kind: 'shelf', id: 102, scanned, name: 'SH-102' },
];
function demoTask(over: Partial<TaskState>): TaskState {
  return {
    id: 1, task_code: 'ZT-20261024-001', status: 'in_progress',
    step: 'scan_shelf', step_label: 'Scan the shelf SH-102', expected: ['box', 'shelf'], location_slot: 'shelf',
    chain: demoChain(false), next_level: 'shelf', required_scans: 2, completed_scans: 1, fail_count: 0, attempts_left: 3,
    box_scan_at: null, box_confirmed_at: null, shelf_scan_at: null, shelf_confirmed_at: null,
    ready_to_complete: false, last_activity_at: DEMO_TIME, idle_after_minutes: 5, idle_seconds_left: null,
    ...over,
  };
}
interface DemoScreen { state: State; placed?: { box_code: string; spi_code: string; destination: string; at: string | null; method: string | null; by: string | null }; showProducts?: boolean; }
const DEMO: Record<string, DemoScreen> = {
  s2:  { state: { device: DEMO_DEVICE, task: null, box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 6, step: 'scan_box' } },
  s3:  { state: { device: DEMO_DEVICE, task: demoTask({ box_scan_at: DEMO_TIME, box_confirmed_at: DEMO_TIME }), box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 6 } },
  s4:  { state: { device: DEMO_DEVICE, task: demoTask({ box_scan_at: DEMO_TIME, box_confirmed_at: DEMO_TIME }), box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 6 }, showProducts: true },
  s6:  { state: { device: DEMO_DEVICE, task: demoTask({ box_scan_at: DEMO_TIME, box_confirmed_at: DEMO_TIME, shelf_scan_at: DEMO_TIME, shelf_confirmed_at: DEMO_TIME, ready_to_complete: true, completed_scans: 2, step: 'complete', step_label: 'Both matched — press Complete', chain: demoChain(true) }), box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 6 } },
  s10: { state: { device: DEMO_DEVICE, task: demoTask({ status: 'scanned', box_scan_at: DEMO_TIME, shelf_scan_at: DEMO_TIME, ready_to_complete: true, completed_scans: 2, chain: demoChain(true) }), box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 5 } },
  s9:  { state: { device: DEMO_DEVICE, task: null, box: DEMO_BOX, destination: DEMO_DEST, open: DEMO_OPEN, count: 5 }, placed: { box_code: 'B-001', spi_code: 'SPI/2026-27/005', destination: 'Zone ZN-A · Rack RK-A1 · Shelf SH-102', at: DEMO_TIME, method: 'manual', by: 'Rajesh Agrotech' } },
  s11: { state: { device: DEMO_DEVICE, task: null, box: DEMO_BOX, no_task: true, open: DEMO_OPEN, count: 6 } },
};

export default function PutawayScan() {
  // scanKey = arrived by scanning a label with a phone camera, which opens the
  // URL. taskId = opened from a list. Neither = the handheld's standing page.
  const { taskId, scanKey } = useParams();
  // Demo: ?demo=<screen> freezes the real UI on static data (no server, no nav).
  const demoKey = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('demo') : null;

  const [state, setState]   = useState<State | null>(null);
  const [error, setError]   = useState<string | null>(null);
  /* One floating message for both outcomes. A success is news for a moment;
     a refusal has to carry what to do next, so it stays longer. */
  const [toast, setToast]   = useState<{ kind: 'ok' | 'bad'; text: string; sub?: string } | null>(null);
  /* A carton that is already away is not a failure — it gets its own card
     with the proof, rather than a red line that reads like a mistake. */
  const [placed, setPlaced] = useState<{ box_code: string; spi_code?: string | null; destination: string; at: string | null; method: string | null; by: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [value, setValue]   = useState('');
  /* Seconds before a half-walked run is given up, and the reason the LAST one
     was — the first counts down on this screen, the second greets the queue. */
  const [idleLeft, setIdleLeft]     = useState<number | null>(null);
  const [idleNotice, setIdleNotice] = useState<string | null>(null);

  // Held only while a location was scanned BEFORE any box. The server re-proves
  // it on the box scan; this is a convenience, never a credential.
  const [staged, setStaged] = useState<{ id: number; kind: string; name: string } | null>(null);

  // Which pile of the scanned location's boxes is on screen.
  const [locTab, setLocTab] = useState<'pending' | 'in_progress' | 'placed'>('pending');

  // The product line opened from the box's list.
  const [product, setProduct] = useState<BoxProduct | null>(null);
  /* The box card opens its product list in place — one tap, no screen
     change, because the operator is checking it against what is in their
     hands and a new screen loses the box header they are checking against. */
  const [showProducts, setShowProducts] = useState(false);
  const [showPending, setShowPending] = useState(false);
  // Tapping Scan highlights the "press the scan key" hint for a moment.
  const [scanArmed, setScanArmed] = useState(false);
  // Live SPI box progress (placed / total) shown on the card's pill.
  const [spiProgress, setSpiProgress] = useState<{ placed: number; count: number } | null>(null);
  // The per-SPI box sheet the card's SPI pill opens (vs the device-wide queue).
  const [spiBoxes, setSpiBoxes] = useState<SpiBoxesBody | null>(null);
  const [spiBoxesBusy, setSpiBoxesBusy] = useState(false);

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
    /* A request that never answers is the worst failure this screen has: the
       handheld sits on "Checking this device…" with nothing to act on.
       It happens for a reason nothing here can see — after an idle spell the
       TLS connection is gone, the next request needs the client certificate
       again, and Chrome cannot raise its certificate picker for a background
       fetch. The request simply hangs.
       Fifteen seconds, then say so. */
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);

    let res: Response;
    try {
      res = await fetch(`/api${url}`, {
        method: method.toUpperCase(),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Scan-Device': token,
        },
        body: method === 'post' ? JSON.stringify(body ?? {}) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      throw {
        response: {
          status: 0,
          data: {
            code: 'no_answer',
            message: (e as Error)?.name === 'AbortError'
              ? 'The server did not answer. If this keeps happening, close the tab and scan again so the device certificate can be chosen.'
              : 'Could not reach the server.',
          },
        },
      };
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));

    /* Answered — so the one-shot reconnect is spent and may be used again the
       next time this device goes idle. Without this a tab recovers once and
       then shows the error for the rest of the shift. */
    try { sessionStorage.removeItem('pwscan_reconnect'); } catch { /* private mode */ }

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
          notice?: string; no_task?: boolean;
          placed?: { box_code: string; spi_code?: string | null; destination: string; at: string | null; method: string | null; by: string | null };
        };
      };
    }).response;

    if (res?.status === 401 || res?.status === 403) {
      setBlocked(res.data?.message || 'This device is not allowed to scan.');
      return;
    }

    /* The request never answered — the idle case. Sitting here with an error
       helps nobody: the thing that fixes it is a NAVIGATION, because that is
       the only moment Chrome will offer the certificate picker again.
       So go back to the queue. The operator lands on the list, taps the task
       and carries on from "Scan the box" — no reinstalling, no settings.
       Once only. A second failure means the server is genuinely unreachable,
       and a reload loop would hide that behind a flashing screen. */
    if (res?.data?.code === 'no_answer') {
      const KEY = 'pwscan_reconnect';
      let tried = null;
      try { tried = sessionStorage.getItem(KEY); } catch { /* private mode */ }
      if (!tried) {
        try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
        /* Already on the queue? Reload it rather than doing nothing. The point
           is the navigation, not the destination — that is the only moment
           Chrome will offer the certificate picker again. */
        if (window.location.pathname === INDEX_PATH) window.location.reload();
        else window.location.assign(INDEX_PATH);
        return;
      }
    }

    // Already away: a statement of fact, not a refusal to act on.
    if (res?.data?.code === 'already_placed' && res.data.placed) {
      setPlaced(res.data.placed);
      setError(null);
      setNotice(null);
      if (res.data.data) setState(res.data.data);

      return;
    }

    // No open task: show the box's details read-only, not a refusal. Nothing is placed.
    if (res?.data?.code === 'no_task' && res.data.data?.box) {
      setPlaced(null);
      setError(null);
      setNotice(res.data.notice ?? null);
      setState(res.data.data);

      return;
    }

    const code = res?.data?.code ?? '';
    const live = res?.data?.data;

    /* The label they should be holding instead, named by the server's own
       answer rather than by anything this page remembers. */
    const owed = live?.task?.next_level === 'zone' ? live?.destination?.zone
      : live?.task?.next_level === 'rack' ? live?.destination?.rack
      : live?.destination?.shelf;

    /* The server usually says something better than "Scan not accepted" — it
       named the box, the shelf or the certificate. Use its words when the code
       is one this page does not know. */
    const short = SHORT[code] ?? res?.data?.message ?? 'Scan not accepted';
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
    // Demo: freeze the real screen on static data; no session, no navigation.
    if (demoKey) {
      const d = DEMO[demoKey];
      if (d) {
        setState(d.state);
        if (d.placed) setPlaced(d.placed);
        if (d.showProducts) setShowProducts(true);
      }
      return;
    }
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
          apply(
            data.data,
            data.data?.box && !data.data?.location
              ? 'Box scanned successfully'
              : data.data?.location
                ? `${(data.data.location.kind ?? 'Location').replace(/^./, (c: string) => c.toUpperCase())} scanned successfully`
                : 'Scan accepted.',
          );
          return;
        }

        const { data } = taskId
          ? await call('get', `/scan/putaway/${taskId}`)
          : await call('post', '/scan/putaway/session');
        setState(data.data);
        /* Opened a task the server had already given up on. Say so here, or
           the page shows "Scan the box" for a box that was scanned ten
           minutes ago and the operator reads it as the app losing their work. */
        const body = data as { notice?: string };
        if (body.notice) setToast({ kind: 'bad', text: 'Put-away restarted', sub: body.notice });
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

  /**
   * A half-walked put-away nobody has touched for five minutes is over.
   *
   * The screen can sit on "Scan the shelf" indefinitely — the box and the zone
   * are already in, nothing is in flight, and no timer anywhere was watching.
   * So the handheld is left holding a run that the server will throw away the
   * moment anything is scanned, and the operator finds that out by being
   * refused. Worse, it is often not the same operator: a handheld put down on
   * a trolley is picked up by whoever walks past next.
   *
   * So count down to the server's own threshold and hand the device back to
   * the queue. The scans themselves are cleared server-side, by dropStaleScans
   * on the next scan or refresh — this page only stops pretending to own them.
   *
   * Measured from the last SCAN. Reading the box's product list is not
   * activity, which is the rule the floor asked for.
   *
   * The server sends what is LEFT, not when it ends, and null when no clock is
   * running — nothing scanned yet, or the pair already in. Both of those have
   * done nothing wrong and expiring either throws away something correct.
   */
  useEffect(() => {
    const t = state?.task;
    const secs = t?.idle_seconds_left;
    if (!t || secs === null || secs === undefined) { setIdleLeft(null); return; }

    /* Counted down locally from the server's figure, against elapsed wall time
       rather than a tick count — an interval in a backgrounded tab is throttled
       to once a minute, so counting ticks would stretch five minutes into an
       hour on a handheld in someone's pocket. */
    const from = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const left = secs - Math.floor((Date.now() - from) / 1000);
      if (left > 0) { setIdleLeft(left); return; }

      if (timer) clearInterval(timer);
      try {
        sessionStorage.setItem(IDLE_KEY, String(t.idle_after_minutes || 5));
      } catch { /* private mode */ }
      // Drop the run first: the queue must not reopen the task we just left.
      writeRun(null);
      if (window.location.pathname === INDEX_PATH) window.location.reload();
      else window.location.assign(INDEX_PATH);
    };

    tick();
    timer = setInterval(tick, 1000);

    /* Woken from the handheld's screen lock. A throttled interval can be up to
       a minute behind, and a screen that sits on a dead run for that minute is
       the thing this was built to stop. */
    const onWake = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onWake);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [state?.task]);

  /* Why the last run ended, read once on the way in. */
  useEffect(() => {
    try {
      const mins = sessionStorage.getItem(IDLE_KEY);
      if (!mins) return;
      sessionStorage.removeItem(IDLE_KEY);
      setIdleNotice(`No scanning for ${mins} minutes, so that put-away was left. Tap it below to start it again.`);
    } catch { /* private mode */ }
  }, []);

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

  /* Live SPI progress for the card pill — re-read whenever a scan lands or the
     box is placed, so "placed / total" moves in real time. */
  useEffect(() => {
    const id = state?.task?.id;
    if (demoKey) { setSpiProgress({ placed: 1, count: 4 }); return; }
    if (!id) { setSpiProgress(null); return; }
    let live = true;
    call('get', `/scan/putaway/${id}/boxes`)
      .then(({ data }) => { if (live) setSpiProgress({ placed: data.data.placed, count: data.data.count }); })
      .catch(() => { /* leave the task-count fallback */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.task?.id, state?.task?.completed_scans, state?.task?.status]);

  const submitScan = async (raw: string) => {
    if (demoKey) return;   // demo: the screen is frozen on static data
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
    if (demoKey) return;   // demo: no server actions
    if (busy || !state?.task) return;

    setBusy(true);
    try {
      const { data } = await call('post', url, body);
      apply(data.data, message);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  /* Clear box (now the header ✕): hand any open task back and return to the
     queue. Leaving is not refusable — the carton is already down. */
  const clearBox = async () => {
    if (demoKey) return;
    const t = state?.task;
    if (t) { try { await call('post', `/scan/putaway/${t.id}/release`, {}); } catch { /* already down */ } }
    writeRun(null);
    window.location.href = INDEX_PATH;
  };

  /* Tapping Scan focuses the hidden field (no keypad — inputMode=none) and
     flashes the "press the scan key" hint so the operator uses the trigger. */
  const armScan = () => {
    inputRef.current?.focus();
    setScanArmed(true);
    window.setTimeout(() => setScanArmed(false), 1800);
  };

  /* Every box in the current task's SPI — for the sheet the SPI pill opens. */
  const openSpiBoxes = async () => {
    const taskId = state?.task?.id;
    if (!taskId || spiBoxesBusy) return;
    if (demoKey) { setSpiBoxes(DEMO_SPI_BOXES); return; }
    setSpiBoxesBusy(true);
    try {
      const { data } = await call('get', `/scan/putaway/${taskId}/boxes`);
      setSpiBoxes(data.data as SpiBoxesBody);
    } catch (e) { fail(e); }
    finally { setSpiBoxesBusy(false); }
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

  /* Already away — and this MUST come before the no-state guard below.
     A device whose first action is scanning a placed box is answered with
     `data: null`, because there is no open task to describe. So there is no
     state to fall through to, and the guard below would render
     "Checking this device…" for ever on a page that had its answer all along.
     Reads only from `placed`, for the same reason. */
  if (placed) {
    return (
      <div className="pwscan pwscan--blocked">
        <div className="pwscan-card">
          <div className="pwscan-blockmark">&#10003;</div>
          <h1>Put-away already completed</h1>
          <p>
            <b>{placed.box_code}</b>
            {placed.spi_code ? <> of <b>{placed.spi_code}</b></> : null} is already put away
            {placed.destination ? <> at <b>{placed.destination}</b>.</> : '.'}
          </p>
          <span className="pwscan-badge pwscan-badge--done">Put-away completed</span>
          <button className="pwscan-btn pwscan-btn--wide" onClick={() => { writeRun(null); window.location.assign(INDEX_PATH); }}>
            Next box
          </button>
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
        <AppBar device={state.device} count={state.count ?? state.open.length} />

        <div className="pws2-sheet-head" style={{ border: 0 }}>
          <span>
            <b>Pending tasks</b>
            <small>{state.open.length} box{state.open.length === 1 ? '' : 'es'} awaiting verification</small>
          </span>
        </div>

        {/* Why they are looking at the queue instead of the box they were
            holding. Without it the screen reads as having lost their work. */}
        {idleNotice && <div className="pwscan-alert pwscan-alert--warn">{idleNotice}</div>}

        {error && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}

        <ul className="pws2-rows" style={{ padding: '0 12px 16px' }}>
          {state.open.map((t) => (
            <TaskRow
              key={t.id}
              row={t}
              onPick={() => { writeRun({ task_id: t.id }); window.location.href = `/putaway-scan/${t.id}`; }}
            />
          ))}
        </ul>

        <div className="pwscan-attempts">or scan any box to start</div>

        {/* Hidden, focused field catches the device trigger; the visible action
            is the fixed Scan Box button, like the rest of the flow. */}
        <form className="pwscan-sform" onSubmit={(e) => { e.preventDefault(); void submitScan(value); }}>
          <input
            ref={inputRef}
            className="pwscan-input pwscan-input--hidden"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="none"
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            disabled={busy}
            aria-hidden tabIndex={-1}
          />
        </form>

        <div className={'pws2-scanhint' + (scanArmed ? ' is-armed' : '')} style={{ margin: '0 12px' }}>
          <i className="ri-qr-scan-2-line" aria-hidden />
          <span>Scan the QR by pressing the <b>scan key on the right side</b> of the device.</span>
        </div>

        <div className="pws2-foot">
          <button type="button" className="pws2-primary" disabled={busy} onClick={armScan}>
            <i className="ri-qr-scan-2-line" />Scan Box
          </button>
        </div>
      </div>
    );
  }

  const task = state.task;
  const step = (task?.step ?? state.step ?? 'scan_box') as Step;
  const done = task?.status === 'scanned';
  const dest = state.destination;
  // The prompt points at the box's destination — the deepest level it has.
  const destLevel = dest?.shelf ? 'shelf' : dest?.rack ? 'rack' : dest?.zone ? 'zone' : null;

  /* A finished box gets the whole screen, not a banner above the slots, the
     box details and a scan field. The operator is holding a carton and needs
     one fact: it is done, and where.

     That screen is <Done>, rendered below — it carries the control that moves
     on to the next box. A second `if (done)` used to sit here and return a
     card that said "Put-away already completed" with no such control, which
     made every FIRST put-away read as a repeat and left the operator
     reloading the page to scan again. A box somebody else had already stored
     is a different case and still has its own screen: `placed` returns
     further up. */
  /* One input, rendered in one of two places — the ref must stay on a single
     instance or focus-capture lands on whichever React mounted last. The
     label sits with it: that is where the operator is looking. */
  const scanForm = (
    <>
    {error && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}
    {/* The field is hidden but focused, so the device trigger types into it.
        The visible action is the fixed Scan button in the foot. */}
    <form className="pwscan-sform" onSubmit={(e) => { e.preventDefault(); void submitScan(value); }}>
      <input
        ref={inputRef}
        className="pwscan-input pwscan-input--hidden"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // Keeps the field focused for the hardware scanner but shows NO soft
        // keyboard — the operator uses the physical trigger, not the keypad.
        inputMode="none"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
        aria-hidden
        tabIndex={-1}
      />
    </form>
    </>
  );

  /* A fresh completion gets the minimal Done card (it moves on to the next box).
     Re-scanning a box that was ALREADY put away instead shows the full details
     screen below — box, products and where it now sits — marked complete. (#64) */
  if (done && !state.already_placed) {
    return (
      <Done
        box={state.box?.box_code}
        where={state.destination?.full}
        onNext={() => { writeRun(null); window.location.href = '/putaway-scan'; }}
      />
    );
  }

  /* A box scanned with no open task: read-only details — no scan field, no
     Complete. Raising a task or confirming by hand is a desktop step. */
  if (state.no_task && state.box) {
    return (
      <div className="pwscan">
        <AppBar device={state.device} count={state.count ?? state.open?.length} onPending={() => setShowPending(true)} onClear={clearBox} />
        <div className="pws2-body">
          <div className="pwscan-notice">{notice ?? 'No put-away task for this box. Raise a task, or confirm it by hand.'}</div>
          <section className="pws2-card">
            {state.box.spi_code && (
              <div className="pws2-spi"><span>SPI</span><b>{state.box.spi_code}</b></div>
            )}
            <div className="pws2-card-top">
              <span className="pws2-kicker">BOX</span>
              <span className="pws2-code">{putId(state.box.box_code)}</span>
              <span className="pws2-chip">{state.box.products.length > 1 ? 'MIXED' : 'SINGLE'}</span>
              <span className="pws2-sp" />
              {state.box.products.length > 0 && (
                <button type="button" className="pws2-more" onClick={() => setShowProducts(v => !v)}>
                  {showProducts ? 'Show Less' : 'More'}{!showProducts && <b>{state.box.products.length}</b>}
                </button>
              )}
            </div>
            {state.box.scenario_label && <div className="pws2-name">{state.box.scenario_label}</div>}
            <div className="pws2-meta3">
              <div><span>Products</span><b>{state.box.products.length} product{state.box.products.length === 1 ? '' : 's'}</b></div>
              <div><span>Condition</span><b>{state.box.condition ? (CONDITION[state.box.condition] ?? state.box.condition) : '—'}</b></div>
              <div><span>Invoice</span><b>{state.box.spi_code ?? '—'}</b></div>
            </div>
            <div className="pws2-meta3">
              <div><span>Dimensions</span><b>{state.box.dimensions_cm ?? '—'}</b></div>
              <div><span>Net Wt</span><b>{state.box.net_weight_kg != null ? `${state.box.net_weight_kg} kg` : '—'}</b></div>
              <div><span>Gross Wt</span><b>{state.box.gross_weight_kg != null ? `${state.box.gross_weight_kg} kg` : '—'}</b></div>
            </div>
            {showProducts && state.box.products.length > 0 && (
              <ul className={'pws2-prods' + (state.box.products.length > 5 ? ' is-scroll' : '')}>
                {state.box.products.map((pr) => (
                  <li key={pr.sr} className="pws2-prod">
                    <div className="pws2-prod-top">
                      <span className="pws2-prod-sr">{pr.sr}</span>
                      <span className="pws2-prod-n">{pr.name ?? '—'}</span>
                      <span className="pws2-prod-q">{pr.quantity}{pr.uom ? ` ${pr.uom}` : ''}</span>
                    </div>
                    <div className="pws2-prod-grid">
                      <div><span>SKU</span><b>{pr.code ?? '—'}</b></div>
                      <div><span>HSN</span><b>{pr.hsn ?? '—'}</b></div>
                      <div><span>BATCH</span><b>{pr.batch_no ?? '—'}</b></div>
                      <div><span>EXPIRY</span><b>{pr.expiry_date ?? '—'}</b></div>
                      <div><span>SEGMENT</span><b>{pr.segment ?? '—'}</b></div>
                      <div><span>LOT / SERIAL</span><b>{pr.lot_no ?? pr.serial_no ?? '—'}</b></div>
                    </div>
                    {pr.expiry_date && (
                      <div className="pws2-tags"><span className="pws2-chip pws2-chip--warn">EXPIRY TRACKED</span></div>
                    )}
                    <div className="pws2-tags">
                      <button type="button" className="pws2-ghost" style={{ height: 30, justifyContent: 'flex-start' }}
                        onClick={() => setProduct(pr)}>
                        View full detail ›
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="pws2-tags"><span className="pws2-chip pws2-chip--notask">NO_TASK</span></div>
          </section>
          <div className="pws2-next">
            <span>WHAT TO DO</span><b>Raise a put-away task, or confirm it by hand</b>
            <small>Details only — this box has no task, so there is no scanning and no Complete here.</small>
          </div>
        </div>
        {/* Clear box is the header ✕ now (no foot). */}
        {product && (
          <ProductSheet product={product} boxCode={state.box?.box_code} spiCode={state.box?.spi_code} onClose={() => setProduct(null)} />
        )}
        {showPending && (
          <div className="pws2-scrim" onClick={() => setShowPending(false)}>
            <div className="pws2-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="pws2-sheet-head">
                <span><b>Pending tasks</b><small>{(state.open?.length ?? 0)} box{(state.open?.length ?? 0) === 1 ? '' : 'es'} awaiting verification</small></span>
                <button type="button" className="pws2-x" onClick={() => setShowPending(false)} aria-label="Close">×</button>
              </div>
              <div className="pws2-sheet-body">
                <ul className="pws2-rows">
                  {(state.open ?? []).map((t) => (
                    <TaskRow key={t.id} row={t} current={false}
                      onPick={() => { writeRun({ task_id: t.id }); window.location.href = `/putaway-scan/${t.id}`; }} />
                  ))}
                </ul>
                {(state.open?.length ?? 0) === 0 && (
                  <div className="pwscan-attempts" style={{ marginBottom: 0 }}>Nothing else pending</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
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

      <AppBar
        device={state.device}
        count={state.count ?? state.open?.length}
        onPending={() => setShowPending(true)}
        onClear={!done && task ? clearBox : undefined}
      />

      {/* The last minute of the idle window, and only that. A counter running
          for five minutes becomes part of the furniture; one that appears with
          sixty seconds left is a prompt to scan now. */}
      {idleLeft !== null && idleLeft <= 60 && (
        <div className="pwscan-idle" role="status" aria-live="polite">
          No scanning for a while — returning to the queue in <b>{idleLeft}s</b>
        </div>
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


      {/* Both of these now travel with the scan field — see scanForm. Kept
          here only for the states that render no field at all. */}
      {error && !step.startsWith('scan') && <div className="pwscan-alert pwscan-alert--bad">{error}</div>}

      {/* Only while a scan is actually owed. Once both labels are in, the next
          action is a button press, and a scan box sitting there reads as "do
          something else first".
          On the location read-out it goes last instead — the lists above are
          what the operator came to read. */}

      {/* One card for the box: what it is, what is in it, and where it is
          going. The dimensions and the weights are gone — a packer typed them
          and nobody on the floor acts on them; what the operator checks is the
          code, the contents and the shelf. */}
      {/* Before the box scan: what to fetch, and nothing else. */}
      {state.box && !task?.box_scan_at && (
        <div className="pws2-body">
          <section className="pws2-card">
            <div className="pws2-card-top">
              <span className="pws2-kicker">BOX</span>
              <span className="pws2-code">{putId(state.box.box_code)}</span>
              <span className="pws2-sp" />
              <span className="pws2-chip pws2-chip--warn">PENDING_DEVICE_SCAN</span>
            </div>
            <div className="pws2-meta3" style={{ marginTop: 9 }}>
              <div><span>Invoice</span><b>{state.box.spi_code ?? '—'}</b></div>
              <div><span>Destination</span><b>{dest?.shelf ?? dest?.rack ?? dest?.zone ?? '—'}</b></div>
              <div><span>Scans</span><b>{task?.completed_scans ?? 0}/{task?.required_scans ?? 0}</b></div>
            </div>
          </section>

          <div className="pws2-next">
            <span>NEXT SCAN</span>
            <b>Box QR {putId(state.box.box_code)}</b>
            <small>
              Scan the label on the carton to confirm it is this one. Its
              contents open once the box is verified.
            </small>
          </div>
          <div className={"pws2-scanhint" + (scanArmed ? " is-armed" : "")}>
            <i className="ri-qr-scan-2-line" aria-hidden />
            <span>Scan the QR by pressing the <b>scan key on the right side</b> of the device.</span>
          </div>
        </div>
      )}

      {state.box && !!task?.box_scan_at && (
        <div className="pws2-body">
          <section className="pws2-card">
            {/* Two columns: SPI id over the box id on the left, More centred right. */}
            <div className="pws2-boxhead">
              <div className="pws2-boxhead-l">
                {state.box.spi_code && (
                  <div className="pws2-spi"><span>SPI ID</span><b>{state.box.spi_code}</b></div>
                )}
                <div className="pws2-card-top">
                  <span className="pws2-kicker">BOX</span>
                  <span className="pws2-code">{putId(state.box.box_code)}</span>
                  <span className="pws2-chip">
                    {state.box.products.length > 1 ? 'MIXED' : 'SINGLE'}
                  </span>
                </div>
              </div>
              {state.box.products.length > 0 && (
                <button type="button" className="pws2-more" onClick={() => setShowProducts(v => !v)}>
                  {showProducts ? 'Show Less' : 'More'}
                  {!showProducts && <b>{state.box.products.length}</b>}
                </button>
              )}
            </div>

            {state.box.scenario_label && <div className="pws2-name">{state.box.scenario_label}</div>}

            <div className="pws2-meta3">
              <div>
                <span>Products</span>
                <b>{state.box.products.length} product{state.box.products.length === 1 ? '' : 's'}</b>
              </div>
              <div>
                <span>Condition</span>
                <b>{state.box.condition ? (CONDITION[state.box.condition] ?? state.box.condition) : '—'}</b>
              </div>
              <div>
                <span>Destination</span>
                <b>{dest?.shelf ?? dest?.rack ?? dest?.zone ?? '—'}</b>
              </div>
            </div>

            {showProducts && state.box.products.length > 0 && (
              /* Five rows, then it scrolls — a mixed carton can carry ten. */
              <ul className={'pws2-prods' + (state.box.products.length > 5 ? ' is-scroll' : '')}>
                {state.box.products.map((pr) => (
                  <li key={pr.sr} className="pws2-prod">
                    <div className="pws2-prod-top">
                      <span className="pws2-prod-sr">{pr.sr}</span>
                      <span className="pws2-prod-n">{pr.name ?? '—'}</span>
                      <span className="pws2-prod-q">{pr.quantity}{pr.uom ? ` ${pr.uom}` : ''}</span>
                    </div>
                    <div className="pws2-prod-grid">
                      <div><span>SKU</span><b>{pr.code ?? '—'}</b></div>
                      <div><span>HSN</span><b>{pr.hsn ?? '—'}</b></div>
                      <div><span>BATCH</span><b>{pr.batch_no ?? '—'}</b></div>
                      <div><span>EXPIRY</span><b>{pr.expiry_date ?? '—'}</b></div>
                      <div><span>SEGMENT</span><b>{pr.segment ?? '—'}</b></div>
                      <div><span>LOT / SERIAL</span><b>{pr.lot_no ?? pr.serial_no ?? '—'}</b></div>
                    </div>
                    {pr.expiry_date && (
                      <div className="pws2-tags">
                        <span className="pws2-chip pws2-chip--warn">EXPIRY TRACKED</span>
                      </div>
                    )}
                    {/* The full line, with its image and remark, is still one
                        tap away — this grid carries what is read at the shelf. */}
                    <div className="pws2-tags">
                      <button type="button" className="pws2-ghost" style={{ height: 30, justifyContent: 'flex-start' }}
                        onClick={() => setProduct(pr)}>
                        View full detail ›
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="pws2-tags">
              <span className={'pws2-chip ' + (task?.box_confirmed_at ? 'pws2-chip--ok' : 'pws2-chip--warn')}>
                {task?.box_confirmed_at ? 'BOX_SCAN_VERIFIED'
                  : task?.box_scan_at ? 'BOX_SCANNED' : 'PENDING_DEVICE_SCAN'}
              </span>
              {state.box.flags.map((f) => (
                <span key={f.id} className={'pws2-chip pws2-chip--' + (f.behaviour === 'block' ? 'bad' : 'warn')}>
                  {f.name}
                </span>
              ))}
              {task && (
                <button type="button" className="pws2-taskpill pws2-taskpill--btn"
                  onClick={openSpiBoxes} disabled={spiBoxesBusy}>
                  {state.box.spi_code ?? task.task_code} · {spiProgress
                    ? `${spiProgress.placed}/${spiProgress.count}`
                    : `${task.completed_scans}/${task.required_scans}`}
                  <i className="ri-arrow-right-s-line" aria-hidden />
                </button>
              )}
            </div>
          </section>

          {/* The walk, and how much of it is done. Scanning a level ticks it. */}
          {dest?.full && (
            <div className="pws2-slots">
              {([['ZONE', 'zone', dest.zone, 'General Storage'],
                 ['RACK', 'rack', dest.rack, dest.rack ? `Rack ${dest.rack}` : null],
                 ['SHELF', 'shelf', dest.shelf, dest.shelf ? 'Shelf level' : null]] as const).map(
                ([label, kind, code, sub]) => {
                  const rung = (task?.chain ?? []).find((c) => c.kind === kind);
                  const cls = rung?.scanned ? ' is-done' : (kind === destLevel ? ' is-next' : '');
                  return (
                    <div key={kind} className={'pws2-slot' + cls}>
                      <span>{label}</span>
                      <b>{code ?? '—'}</b>
                      <small>{rung?.name ?? sub ?? '—'}</small>
                      <i>{rung?.scanned ? 'Scanned' : (kind === destLevel ? 'Next' : 'Pending')}</i>
                    </div>
                  );
                })}
            </div>
          )}

          {/* The destination level the operator should head for — the box's
              last location (shelf), not the first rung of the walk. */}
          {destLevel && !done && (
            <div className="pws2-next">
              <span>NEXT SCAN</span>
              <b>
                {LEVEL[destLevel] ?? destLevel} QR{' '}
                {destLevel === 'zone' ? dest?.zone
                  : destLevel === 'rack' ? dest?.rack
                  : dest?.shelf}
              </b>
              <small>{task?.step_label}</small>
            </div>
          )}
          {destLevel && !done && (
            <div className={"pws2-scanhint" + (scanArmed ? " is-armed" : "")}>
              <i className="ri-qr-scan-2-line" aria-hidden />
              <span>Scan the QR by pressing the <b>scan key on the right side</b> of the device.</span>
            </div>
          )}

          {/* Already placed: say plainly where the box sits now. */}
          {done && dest?.full && (
            <div className="pws2-next">
              <span>CURRENT LOCATION</span>
              <b>
                {[dest.zone && `Zone ${dest.zone}`, dest.rack && `Rack ${dest.rack}`, dest.shelf && `Shelf ${dest.shelf}`]
                  .filter(Boolean).join(' · ')}
              </b>
              <small>Where {state.box.box_code} is stored now.</small>
            </div>
          )}
        </div>
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

      {/* The foot is fixed: on a handheld the thumb sits here, and the panel
          above scrolls under it. Complete only appears when the server says
          the task may be completed; Clear box is always available, because
          picking up the wrong carton is the common mistake. */}
      {/* Clear box is the header ✕ now. The fixed foot carries the primary
          action: Scan while a scan is pending, Complete once both halves match.
          The Scan button just focuses the hidden field — the device trigger
          fires the beam. */}
      {!done && (task?.ready_to_complete || step.startsWith('scan')) && (
        <div className="pws2-foot">
          {task?.ready_to_complete ? (
            <button type="button" className="pws2-primary" disabled={busy}
              onClick={() => act(`/scan/putaway/${task.id}/complete`, {}, 'Put-away complete.')}>
              <i className="ri-checkbox-circle-line" />Complete put-away
            </button>
          ) : (
            <button type="button" className="pws2-primary" disabled={busy} onClick={armScan}>
              <i className="ri-qr-scan-2-line" />{step === 'scan_box' ? 'Scan Box' : 'Scan Location'}
            </button>
          )}
        </div>
      )}

      {/* The queue, without leaving the box in hand. The header badge is the
          only way back to it mid-task; the index screen is for arriving with
          nothing scanned. */}
      {showPending && (
        <div className="pws2-scrim" onClick={() => setShowPending(false)}>
          <div className="pws2-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pws2-sheet-head">
              <span>
                <b>Pending tasks</b>
                <small>
                  {(state.open?.length ?? 0)} box{(state.open?.length ?? 0) === 1 ? '' : 'es'} awaiting verification
                </small>
              </span>
              <button type="button" className="pws2-x" onClick={() => setShowPending(false)} aria-label="Close">×</button>
            </div>
            <div className="pws2-sheet-body">
              <ul className="pws2-rows">
                {(state.open ?? []).map((t) => (
                  <TaskRow
                    key={t.id}
                    row={t}
                    current={t.id === task?.id}
                    onPick={() => {
                      if (t.id === task?.id) { setShowPending(false); return; }
                      writeRun({ task_id: t.id });
                      window.location.href = `/putaway-scan/${t.id}`;
                    }}
                  />
                ))}
              </ul>
              {(state.open?.length ?? 0) === 0 && (
                <div className="pwscan-attempts" style={{ marginBottom: 0 }}>Nothing else pending</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The current box's SPI — every box in it and where each one is, from the
          server. Opening a box here is read-only; it changes nothing. */}
      {spiBoxes && (
        <div className="pws2-scrim" onClick={() => setSpiBoxes(null)}>
          <div className="pws2-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pws2-sheet-head">
              <span>
                <b>Boxes in {spiBoxes.spi_code ?? '—'}</b>
                <small>{spiBoxes.placed} of {spiBoxes.count} placed</small>
              </span>
              <button type="button" className="pws2-x" onClick={() => setSpiBoxes(null)} aria-label="Close">×</button>
            </div>
            <div className="pws2-sheet-body">
              <ul className="pws2-rows">
                {spiBoxes.boxes.map((b, i) => {
                  const done = (b.box_qr ? 1 : 0) + (b.shelf_qr ? 1 : 0);
                  const chip = b.status === 'placed' ? 'PLACED' : b.status === 'box_scanned' ? 'BOX_SCAN_VERIFIED' : 'PENDING_DEVICE_SCAN';
                  const cls = b.status === 'placed' ? 'pws2-chip--placed' : b.status === 'box_scanned' ? 'pws2-chip--ok' : 'pws2-chip--warn';
                  return (
                    <li key={b.box_code ?? i}>
                      <div className="pws2-row pws2-row--read">
                        <span className="pws2-row-top">
                          <span className="pws2-row-code">{b.box_code ? putId(b.box_code) : '—'}</span>
                          <span className="pws2-sp" />
                          <span className={'pws2-chip ' + cls}>{chip}</span>
                        </span>
                        {b.destination && <small className="pws2-row-sub">{b.destination}</small>}
                        <span className="pws2-row-scan">
                          <span className={'pws2-qr' + (b.box_qr ? ' is-on' : '')}>{b.box_qr ? '✓' : '○'} Box QR</span>
                          <span className={'pws2-qr' + (b.shelf_qr ? ' is-on' : '')}>{b.shelf_qr ? '✓' : '○'} Shelf QR</span>
                          <span className="pws2-sp" />
                          <span className={'pws2-row-count' + (done === 2 ? ' is-full' : '')}>{done}/2</span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="pws2-sheet-note">Every box in this invoice. Opening one shows its details only — it is not marked scanned or placed here.</p>
            </div>
          </div>
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
/**
 * The title bar. No settings button: nothing on this screen is configurable
 * from the floor — enrolment installs the credential and the server owns
 * every threshold — so a gear would open nothing.
 */
function AppBar({ device, count, onPending, onClear }: {
  device: { label: string; serial: string };
  count?: number;
  onPending?: () => void;
  onClear?: () => void;
}) {
  return (
    <header className="pws2-appbar">
      <span className="pws2-logo"><img src="/images/kryptone/k-mark.png" alt="Kryptone" /></span>
      <span className="pws2-appbar-t">
        <b>Scan &amp; Verify</b>
        <small>{device.label} · {device.serial}</small>
      </span>
      {onPending && (
        <button type="button" className="pws2-iconbtn" onClick={onPending} aria-label="Pending tasks">
          <i className="ri-list-check-2" />
          {!!count && count > 0 && <span className="pws2-badge">{count}</span>}
        </button>
      )}
      {onClear && (
        <button type="button" className="pws2-iconbtn pws2-iconbtn--clear" onClick={onClear} aria-label="Clear box" title="Clear box">
          <i className="ri-close-line" />
        </button>
      )}
    </header>
  );
}

/** One task, as the sheet and the index page both draw it. */
/** Box id in the system's PUT-B-00x form, used everywhere a box is named. */
const putId = (code: string) => (/^PUT-/i.test(code) ? code : `PUT-${code}`);

function TaskRow({ row, current, onPick }: { row: QueueRow; current?: boolean; onPick: () => void }) {
  // Scan progress from the real step: box QR first, then shelf QR.
  const boxQr = current || row.step === 'scan_shelf' || row.step === 'complete';
  const shelfQr = row.step === 'complete';
  const done = (boxQr ? 1 : 0) + (shelfQr ? 1 : 0);
  return (
    <li>
      <button type="button" className={'pws2-row' + (current ? ' is-current' : '')} onClick={onPick}>
        {row.spi_code && <small className="pws2-row-spi"><i className="ri-file-list-3-line" aria-hidden />{row.spi_code}</small>}
        <span className="pws2-row-top">
          <span className="pws2-row-code">{row.box_code ? putId(row.box_code) : `Task ${row.id}`}</span>
          {current && <span className="pws2-chip pws2-chip--ok">VIEWING</span>}
          <span className="pws2-sp" />
          <span className={'pws2-chip ' + (current ? 'pws2-chip--ok' : 'pws2-chip--warn')}>
            {current ? 'BOX_SCAN_VERIFIED' : 'PENDING_DEVICE_SCAN'}
          </span>
        </span>
        <small className="pws2-row-sub">{row.destination} · {row.task_code}</small>
        <span className="pws2-row-scan">
          <span className={'pws2-qr' + (boxQr ? ' is-on' : '')}>{boxQr ? '✓' : '○'} Box QR</span>
          <span className={'pws2-qr' + (shelfQr ? ' is-on' : '')}>{shelfQr ? '✓' : '○'} Shelf QR</span>
          <span className="pws2-sp" />
          <span className={'pws2-row-count' + (done === 2 ? ' is-full' : '')}>{done}/2</span>
        </span>
      </button>
    </li>
  );
}

function Done({ box, where, onNext }: { box?: string; where?: string; onNext: () => void }) {
  return (
    <div className="pwscan-done" role="status" aria-live="polite">
      <div className="pwscan-done-card">
        <div className="pwscan-done-mark">✓</div>
        <h2>Put-away complete</h2>
        <p className="pwscan-done-box">{box ? putId(box) : ''}</p>
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
