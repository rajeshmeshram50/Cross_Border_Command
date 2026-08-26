/**
 * Put-Away scan engine — SIMULATION LAYER.
 *
 * Everything in this file stands in for the server described in the Zebra TC27
 * integration document. It is deliberately the ONLY file that knows the flow is
 * fake: the pages import `ingestScan`, `listDevices`, `enrollDevice` etc. and
 * never touch localStorage or the dummy tables directly.
 *
 * When the backend lands, replace the bodies here with `api.post('/scan/ingest')`
 * and friends — the page components keep working unchanged.
 *
 * Sticker payload format (extends the format in the technical doc with an
 * ENTITY TYPE segment — without it the server cannot tell a box sticker from a
 * rack sticker, and the step-order check is impossible):
 *
 *     CBC1 | tenant | type | id | nonce | signature
 *
 * The signature here is a small FNV-1a fold, not a real HMAC. Real signing is
 * HMAC-SHA256 with a per-tenant secret that never leaves the server; only the
 * tamper-detection *behaviour* is reproduced locally.
 */

/* ------------------------------------------------------------------ types */

export type EntityType = 'BOX' | 'RACK' | 'SHELF';
export type DeviceStatus = 'active' | 'suspended' | 'retired';

export interface ScanDevice {
  id: string;
  serial: string;
  label: string;
  model: string;
  branch: string;
  status: DeviceStatus;
  enrolled_at: string;
  last_seen_at: string | null;
  /** Never displayed after enrollment — mirrors "shown once" in the doc. */
  token: string;
}

export interface BoxRow  { id: string; name: string; sub: string; }
export interface RackRow { id: string; name: string; sub: string; }
export interface ShelfRow { id: string; rack: string; name: string; sub: string; }

export interface PutAwaySession {
  step: 1 | 2 | 3 | 4;
  box: string | null;
  rack: string | null;
  shelf: string | null;
  device_id: string;
  started_at: string;
}

export interface ScanLogRow {
  id: string;
  at: string;
  result: 'accept' | 'reject';
  code: string;
  message: string;
  payload: string;
  device_serial: string;
}

export interface AllocationRow {
  id: string;
  at: string;
  box: string;
  box_label: string;
  rack: string;
  shelf: string;
  device_serial: string;
}

export interface ScanResult {
  ok: boolean;
  code: string;
  message: string;
}

/* ------------------------------------------------------- dummy master data */

export const TENANT = '12';
const SECRET = 'demo-signing-secret';

export const BOXES: BoxRow[] = [
  { id: '1041', name: 'Rice 25kg — IR-64',        sub: 'PO-4412 · 40 bags' },
  { id: '1042', name: 'Basmati 10kg — Pusa 1121', sub: 'PO-4415 · 25 bags' },
  { id: '1043', name: 'Food Grade Ethanol 200L',  sub: 'PO-4418 · 1 drum' },
  { id: '1044', name: 'Tobacco Leaf — Grade A',   sub: 'PO-4420 · 1 bale' },
];

export const RACKS: RackRow[] = [
  { id: 'A1', name: 'RACK A1', sub: 'Aisle A · Zone Dry' },
  { id: 'B3', name: 'RACK B3', sub: 'Aisle B · Zone Dry' },
  { id: 'C2', name: 'RACK C2', sub: 'Aisle C · Zone Bonded' },
];

export const SHELVES: ShelfRow[] = [
  { id: 'A1-01', rack: 'A1', name: 'SHELF A1-01', sub: 'Level 1 · 400kg cap' },
  { id: 'A1-02', rack: 'A1', name: 'SHELF A1-02', sub: 'Level 2 · 400kg cap' },
  { id: 'B3-01', rack: 'B3', name: 'SHELF B3-01', sub: 'Level 1 · 250kg cap' },
  { id: 'C2-04', rack: 'C2', name: 'SHELF C2-04', sub: 'Level 4 · 150kg cap' },
];

export function findEntity(type: EntityType, id: string) {
  if (type === 'BOX')  return BOXES.find(b => b.id === id) ?? null;
  if (type === 'RACK') return RACKS.find(r => r.id === id) ?? null;
  return SHELVES.find(s => s.id === id) ?? null;
}

/** Human word used in operator-facing prompts and errors. */
export const WORD: Record<EntityType, string> = { BOX: 'box', RACK: 'rack', SHELF: 'shelf' };
/** Which sticker each step expects. */
export const EXPECTED: Record<1 | 2 | 3, EntityType> = { 1: 'BOX', 2: 'RACK', 3: 'SHELF' };

/* ------------------------------------------------------------- signing */

function sign(body: string): string {
  let h = 0x811c9dc5;
  const s = `${body}|${SECRET}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

/**
 * Nonce is derived from the item itself, not from a counter, so a sticker
 * printed today still carries the same payload when the page is reopened
 * tomorrow. On the server this is a stored random value written at print time;
 * deriving it keeps the simulation stateless without changing the format.
 */
function nonceFor(type: EntityType, id: string, tenant: string): string {
  let h = 0x2166136f;
  const s = `${tenant}:${type}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
}

/**
 * The logical key: `CBC1|tenant|type|id|nonce|signature`.
 * This is what the validator works on.
 */
export function makeKey(type: EntityType, id: string, tenant: string = TENANT): string {
  const body = `CBC1|${tenant}|${type}|${id}|${nonceFor(type, id, tenant)}`;
  return `${body}|${sign(body)}`;
}

/** Path the sticker points at. Kept short so the printed code stays small. */
export const SCAN_PATH = '/s/';

/**
 * What actually gets printed on the label — a URL, not bare text.
 *
 * This is the whole reason an unauthorised scan can be answered at all. A
 * stranger's camera app decodes a bare string and just shows them the string;
 * it decodes a URL and OPENS it, which puts the request on our server, where a
 * missing device credential produces the "Device blocked" page. The barcode is
 * still readable by anything — it just leads somewhere that refuses them.
 */
export function makeSticker(type: EntityType, id: string, tenant: string = TENANT): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Dots instead of pipes so the key rides in a URL path without escaping,
  // which would otherwise bloat the printed code.
  return `${origin}${SCAN_PATH}${makeKey(type, id, tenant).replace(/\|/g, '.')}`;
}

/**
 * Accepts anything the scanner might deliver — the printed URL, just the path,
 * the dot form, or the raw pipe form typed by hand — and returns the logical
 * key. Everything downstream deals in one shape.
 */
export function normalizeScan(raw: string): string {
  let s = String(raw).trim();
  const at = s.indexOf(SCAN_PATH);
  if (at !== -1) s = s.slice(at + SCAN_PATH.length);
  s = s.split('?')[0].split('#')[0].replace(/\/+$/, '');
  if (!s.includes('|') && s.includes('.')) s = s.replace(/\./g, '|');
  return s;
}

/** A sticker whose signature has been swapped out — for the tamper demo. */
export function makeTamperedSticker(): string {
  return makeSticker('BOX', '1041').slice(0, -7) + 'ZZZZZZZ';
}

/** True when this browser is an enrolled handheld that may scan right now. */
export function isDeviceAuthorized(): boolean {
  return getActiveDevice()?.status === 'active';
}

/* -------------------------------------------------------- local persistence */

const K = {
  devices: 'cbc_putaway_devices_v1',
  active:  'cbc_putaway_active_device_v1',
  session: 'cbc_putaway_session_v1',
  logs:    'cbc_putaway_logs_v1',
  allocs:  'cbc_putaway_allocs_v1',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

/** Token the admin sees exactly once at enrollment. */
function makeToken(): string {
  const part = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CBCD-${part()}-${part()}-${part()}`;
}

/* ------------------------------------------------------------ device registry */

const SEED_DEVICES: ScanDevice[] = [
  {
    id: 'dev-1', serial: '26013524701106', label: 'Warehouse A / Handheld 01',
    model: 'TC27', branch: 'Nagpur', status: 'active',
    enrolled_at: now(), last_seen_at: null, token: makeToken(),
  },
  {
    id: 'dev-2', serial: '26013524701207', label: 'Warehouse A / Handheld 02',
    model: 'TC27', branch: 'Nagpur', status: 'suspended',
    enrolled_at: now(), last_seen_at: null, token: makeToken(),
  },
];

export function listDevices(): ScanDevice[] {
  const rows = read<ScanDevice[]>(K.devices, []);
  if (rows.length) return rows;
  write(K.devices, SEED_DEVICES);
  return SEED_DEVICES;
}

function saveDevices(rows: ScanDevice[]): void { write(K.devices, rows); }

export function enrollDevice(input: { serial: string; label: string; model: string; branch: string }): { device: ScanDevice; token: string } {
  const rows = listDevices();
  const token = makeToken();
  const device: ScanDevice = {
    id: `dev-${uid()}`,
    serial: input.serial.trim(),
    label: input.label.trim(),
    model: input.model.trim() || 'TC27',
    branch: input.branch.trim(),
    status: 'active',
    enrolled_at: now(),
    last_seen_at: null,
    token,
  };
  saveDevices([device, ...rows]);
  return { device, token };
}

export function serialExists(serial: string, exceptId?: string): boolean {
  return listDevices().some(d => d.serial === serial.trim() && d.id !== exceptId);
}

export function setDeviceStatus(id: string, status: DeviceStatus): void {
  saveDevices(listDevices().map(d => (d.id === id ? { ...d, status } : d)));
  // A device that can no longer scan must not keep a half-finished run alive.
  if (status !== 'active' && getActiveDeviceId() === id) clearSession();
}

export function rotateToken(id: string): string {
  const token = makeToken();
  saveDevices(listDevices().map(d => (d.id === id ? { ...d, token } : d)));
  return token;
}

/**
 * A browser counts as a handheld ONLY if it has been explicitly claimed as one.
 *
 * There is deliberately no "fall back to the first enrolled device" here. That
 * fallback would make every fresh browser — including a stranger's phone that
 * just opened a sticker URL — look like an enrolled handheld, which is the
 * exact opposite of what the allow-list is for. Unclaimed means unauthorised.
 */
export function getActiveDeviceId(): string | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(K.active); } catch { raw = null; }
  if (raw === null) return null;
  try { return JSON.parse(raw) as string | null; } catch { return null; }
}
export function setActiveDeviceId(id: string | null): void {
  write(K.active, id);
  clearSession(); // switching the handheld ends the current run
}
export function getActiveDevice(): ScanDevice | null {
  const id = getActiveDeviceId();
  return listDevices().find(d => d.id === id) ?? null;
}

function touchDevice(id: string): void {
  saveDevices(listDevices().map(d => (d.id === id ? { ...d, last_seen_at: now() } : d)));
}

/* ------------------------------------------------------------------ session */

export function getSession(): PutAwaySession | null {
  const s = read<PutAwaySession | null>(K.session, null);
  if (!s) return null;
  // A session belongs to one handheld. If the active device changed, drop it.
  if (s.device_id !== getActiveDeviceId()) return null;
  return s;
}
function saveSession(s: PutAwaySession | null): void { write(K.session, s); }
export function clearSession(): void { saveSession(null); }

/* --------------------------------------------------------------- audit log */

export function listLogs(): ScanLogRow[] { return read<ScanLogRow[]>(K.logs, []); }
export function listAllocations(): AllocationRow[] { return read<AllocationRow[]>(K.allocs, []); }

function pushLog(row: Omit<ScanLogRow, 'id' | 'at'>): void {
  const rows = listLogs();
  rows.unshift({ ...row, id: uid(), at: now() });
  write(K.logs, rows.slice(0, 200));
}

/* ------------------------------------------------- the scan endpoint, locally */

/**
 * Mirrors the validation order in the technical document: device credential
 * first, business logic last. Every outcome — accepted or refused — is logged.
 */
export function ingestScan(raw: string): ScanResult {
  // The scanner may hand us the printed URL; the validator works on the key.
  const payload = normalizeScan(raw);
  const device = getActiveDevice();
  const serial = device?.serial ?? '(unregistered)';

  const reject = (code: string, message: string): ScanResult => {
    pushLog({ result: 'reject', code, message, payload, device_serial: serial });
    return { ok: false, code, message };
  };
  const accept = (code: string, message: string): ScanResult => {
    pushLog({ result: 'accept', code, message, payload, device_serial: serial });
    return { ok: true, code, message };
  };

  /* 1 — device credential. Runs before any lookup. */
  if (!device) {
    return reject('rejected_unauthorized_device',
      "This device isn't registered. Please use an authorised device.");
  }
  if (device.status === 'suspended') {
    return reject('rejected_suspended_device',
      'This device has been suspended. Contact your administrator.');
  }
  if (device.status === 'retired') {
    return reject('rejected_unauthorized_device',
      'This device has been retired and can no longer scan.');
  }
  touchDevice(device.id);

  /* 2 — structure. */
  const parts = payload.split('|');
  if (parts.length !== 6 || parts[0].toUpperCase() !== 'CBC1') {
    return reject('rejected_malformed_input', 'Not a company sticker.');
  }
  const [, tenant, rawType, id, , sig] = parts;
  const type = rawType.toUpperCase() as EntityType;

  /* 3 — tenant isolation. */
  if (tenant !== TENANT) {
    return reject('rejected_wrong_tenant', 'This sticker belongs to another company.');
  }

  /* 4 — signature. */
  if (sig !== sign(parts.slice(0, 5).join('|'))) {
    return reject('rejected_bad_signature', 'Invalid or tampered sticker.');
  }

  /* 5 — known entity. */
  if (!['BOX', 'RACK', 'SHELF'].includes(type) || !findEntity(type, id)) {
    return reject('rejected_invalid_entity', 'Unknown item on this sticker.');
  }

  let session = getSession() ?? {
    step: 1 as const, box: null, rack: null, shelf: null,
    device_id: device.id, started_at: now(),
  };

  /* 6 — right sticker for the current step. */
  if (session.step === 4) {
    return reject('rejected_wrong_step', 'Finish this put-away first — press Confirm or Cancel.');
  }
  const expected = EXPECTED[session.step as 1 | 2 | 3];
  if (type !== expected) {
    return reject('rejected_wrong_step',
      `That's a ${WORD[type]} sticker. Scan the ${WORD[expected]} sticker.`);
  }

  /* 7 — the shelf must physically belong to the rack just scanned. */
  if (type === 'SHELF') {
    const shelf = findEntity('SHELF', id) as ShelfRow;
    if (shelf.rack !== session.rack) {
      return reject('rejected_shelf_not_in_rack',
        `That shelf isn't on RACK ${session.rack}. Scan a shelf from the rack you selected.`);
    }
  }

  const item = findEntity(type, id)!;
  session = {
    ...session,
    box:   type === 'BOX'   ? id : session.box,
    rack:  type === 'RACK'  ? id : session.rack,
    shelf: type === 'SHELF' ? id : session.shelf,
    step: (session.step + 1) as PutAwaySession['step'],
  };
  saveSession(session);
  return accept(`accepted_${type.toLowerCase()}`, `${item.name} accepted.`);
}

/**
 * Commits the run. Nothing before this point writes an allocation — this is the
 * whole point of the confirm step.
 */
export function confirmAllocation(): ScanResult {
  const session = getSession();
  const device = getActiveDevice();
  if (!session || session.step !== 4 || !session.box || !session.rack || !session.shelf) {
    return { ok: false, code: 'nothing_to_confirm', message: 'Nothing to confirm.' };
  }
  const box = findEntity('BOX', session.box) as BoxRow;
  const rows = listAllocations();
  rows.unshift({
    id: uid(),
    at: now(),
    box: session.box,
    box_label: box.name,
    rack: `RACK ${session.rack}`,
    shelf: `SHELF ${session.shelf}`,
    device_serial: device?.serial ?? '—',
  });
  write(K.allocs, rows);
  pushLog({
    result: 'accept', code: 'allocation_committed',
    message: `${box.name} → RACK ${session.rack} / SHELF ${session.shelf}`,
    payload: '(confirmation)', device_serial: device?.serial ?? '—',
  });
  clearSession();
  return { ok: true, code: 'allocation_committed', message: 'Allocated. Box put away and logged.' };
}

export function cancelSession(): ScanResult {
  const device = getActiveDevice();
  if (getSession()) {
    pushLog({
      result: 'reject', code: 'session_cancelled', message: 'Run cancelled by operator.',
      payload: '(cancellation)', device_serial: device?.serial ?? '—',
    });
  }
  clearSession();
  return { ok: false, code: 'session_cancelled', message: 'Run cancelled. Nothing was saved.' };
}

/** Wipes every simulated table — the "start the demo over" button. */
export function resetSimulation(): void {
  [K.devices, K.active, K.session, K.logs, K.allocs].forEach(k => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
}
