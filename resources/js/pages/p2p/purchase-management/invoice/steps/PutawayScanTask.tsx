import { useEffect, useState, type ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * STAGE 04 · STEP 03 — the Zebra scan task.
 *
 * A box submitted for Zebra verification is NOT placed. It is placed when the
 * floor has scanned two labels: the box's own QR, then the QR on the shelf it
 * was assigned. This dialog is the task those scans belong to - what is
 * expected, what has been read back, and what is still outstanding.
 *
 * The second scan is locked until the first passes, deliberately. Scanning a
 * shelf first would tell you a shelf exists; scanning the box first and the
 * shelf second is what proves THIS box reached THAT shelf.
 *
 * Prototype mode exists because there is no handheld attached to a browser:
 * it turns on two buttons that stand in for a correct and an incorrect read,
 * and everything they produce is labelled SIMULATED so it can never be
 * mistaken for a real scan.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ScanTaskSpot {
  warehouse: string | null;
  zone: string;
  /** Null for a direct placement: a floor zone has no rack. */
  rack: string | null;
  /** Which kind of destination this is, so the dialog can name it. */
  kind: 'zone' | 'shelf';
  shelf: string;
  shelfName: string;
}

/** idle: nothing read yet · ok: read and matched · fail: read and did not. */
type Leg = { state: 'idle' | 'ok' | 'fail'; at?: string };

const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const IcoScan = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const IcoDoc = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IcoLock = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const IcoQr = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><line x1="14" y1="14" x2="21" y2="14" /><line x1="14" y1="21" x2="21" y2="21" />
  </svg>
);
const IcoShelf = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="1.5" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="3" y1="15.5" x2="21" y2="15.5" />
  </svg>
);
const IcoTick = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IcoX = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
const IcoPin = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const IcoArrow = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
  </svg>
);

/** One field in the task's grid. */
const F = ({ k, v, na }: { k: string; v: ReactNode; na?: boolean }) => (
  <div className="s4zt-f">
    <span className="s4zt-f__k">{k}</span>
    <b className={`s4zt-f__v${na ? ' is-na' : ''}`}>{v}</b>
  </div>
);

export default function PutawayScanTask({
  taskId, allocRef = null, spiCode = null, createdAt, box, spot, reservedPct,
  onClose, onComplete, onCancelTask, onScan,
}: {
  taskId: string;
  /** What the allocation is locked under once both scans pass. */
  allocRef?: string | null;
  /** The invoice this task belongs to, for the header's first chip. */
  spiCode?: string | null;
  createdAt: string;
  box: { code: string; name: string };
  spot: ScanTaskSpot;
  /** How much of the shelf this box takes, which is what the task holds. */
  reservedPct: number;
  onClose: () => void;
  onComplete: () => void;
  /** Drop the task. Absent, or once both scans are in, the button is not shown. */
  onCancelTask?: () => void;
  /** Each leg as it resolves, so the stage can write it into the scan logs. */
  onScan?: (leg: 'box' | 'loc', ok: boolean) => void;
}) {
  const [proto, setProto] = useState(false);
  const [qr, setQr] = useState<Leg>({ state: 'idle' });
  const [sh, setSh] = useState<Leg>({ state: 'idle' });

  const done = qr.state === 'ok' && sh.state === 'ok';
  const failed = qr.state === 'fail' || sh.state === 'fail';
  /* "Putaway Completed", not "Device Verified · 2/2". Once both legs pass the
     task is closed and the box is locked to its slot — the scan count is how
     it got there, not what it now IS, and the two scan cards already carry it. */
  const status = done ? ['Putaway Completed', 'ok']
    : failed ? ['Verification Failed', 'bad']
    : qr.state === 'ok' ? ['Box Scan Verified · 1/2', 'half']
    : ['Pending Device Scan', 'wait'];

  /* The failure says which label was read and what was expected - "invalid"
     would send someone back to the aisle with nothing to look for. */
  const why = qr.state === 'fail'
    ? `This label belongs to a different box. Expected ${box.code}.`
    : sh.state === 'fail'
      ? `Wrong shelf: it resolves to ${[spot.warehouse, spot.zone, spot.rack, 'SH-101'].filter(Boolean).join(' › ')}. `
        + `Assigned: ${[spot.warehouse, spot.zone, spot.rack, spot.shelf].filter(Boolean).join(' › ')}. `
        + 'Go to the assigned shelf and scan again.'
      : null;

  /* The task closes itself once both legs pass: the floor has answered, and
     there is nothing left for anyone to press here. */
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onComplete, 1100);
    return () => clearTimeout(t);
  }, [done]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const chain = [spot.warehouse, spot.zone, spot.rack, spot.shelf].filter(Boolean) as string[];

  /** One scan leg. `locked` is scan 02 before scan 01 has passed. */
  const leg = (n: '01' | '02', title: string, leg: Leg, locked: boolean, set: (l: Leg) => void) => {
    const isBox = n === '01';
    const expectedId = isBox ? box.code : spot.shelf;
    const dest = spot.kind === 'zone' ? 'zone' : 'shelf';
    const Dest = spot.kind === 'zone' ? 'Zone' : 'Shelf';
    return (
      <div className={`s4zt-leg is-${leg.state}${locked ? ' is-locked' : ''}`}>
        <div className="s4zt-leg__hd">
          <span className="s4zt-leg__ic">
            {locked ? <IcoLock size={15} /> : leg.state === 'ok' ? <IcoTick />
              : leg.state === 'fail' ? <IcoX /> : isBox ? <IcoQr /> : <IcoShelf />}
          </span>
          <div>
            <span className="s4zt-leg__n">Scan {n}</span>
            <b className="s4zt-leg__t">{title}</b>
          </div>
          <span className="s4zt-leg__badge">
            {locked ? 'Locked' : leg.state === 'ok' ? 'Verified' : leg.state === 'fail' ? 'Failed' : 'Ready to scan'}
          </span>
        </div>

        <div className="s4zt-leg__id">
          <span>{leg.state === 'ok' ? 'Scanned' : 'Expected'} {isBox ? 'box' : 'shelf'} ID</span>
          <b>{expectedId}</b>
        </div>
        {!isBox && (
          <div className="s4zt-leg__sub">
            {spot.kind === 'zone'
              ? `${spot.shelfName} · Direct zone`
              : `${spot.shelfName} · ${leg.state === 'ok' ? 'resolved ' : ''}` +
                [spot.rack, spot.zone, ...(leg.state === 'ok' && spot.warehouse ? [spot.warehouse] : [])].filter(Boolean).join(' › ')}
          </div>
        )}

        {locked ? (
          <div className="s4zt-leg__lock"><IcoLock />Unlocks after the Box QR is verified</div>
        ) : leg.state === 'ok' ? (
          <div className="s4zt-leg__ok">
            <IcoTick size={12} />Verified at {leg.at}<em>Simulated</em>
          </div>
        ) : leg.state === 'fail' ? (
          <div className="s4zt-leg__bad"><IcoX size={11} /><b>Wrong {isBox ? 'box' : dest} scanned.</b> Try again.</div>
        ) : (
          <div className="s4zt-leg__wait">
            <i />
            <div><b>Awaiting scan</b><span>Scan the {isBox ? 'Box' : Dest} QR with the Zebra handheld</span></div>
          </div>
        )}

        {/* Only in prototype mode, and only where a scan is actually due.
            ONE button, as the design has it: it stands in for the handheld,
            and a handheld has one trigger. The pair that was here — simulate
            correct, simulate wrong — turned the stand-in into a control
            panel, and offered "scan the wrong box" as an equal choice beside
            scanning the right one. */}
        {proto && !locked && leg.state !== 'ok' && (
          <button
            type="button"
            className="s4zt-sim"
            onClick={() => { set({ state: 'ok', at: clock() }); onScan?.(isBox ? 'box' : 'loc', true); }}
          >
            <IcoScan size={13} />Simulate {isBox ? 'Box' : Dest} QR scan
          </button>
        )}
      </div>
    );
  };

  return (
    /* s4wz-modal too: the design builds every one of these dialogs from one
       shell, so the header band, its context chips and the footer buttons all
       come from there rather than being restated here. */
    <div className="s4qm s4wz-modal s4zt-modal is-open" role="dialog" aria-modal="true" aria-label="Zebra scan task">
      <div className="s4qm__dlg s4zt__dlg">
        <div className="s4qm__hd">
          <div className="s4qm__hico"><IcoScan size={17} /></div>
          <div className="s4qm__htx">
            <div className="s4qm__t">Zebra Scan Task</div>
            {/* What this task is and what order it is done in — the chips
                carry the identifiers, so the sub-line can say the method. */}
            <div className="s4qm__s">
              {taskId} · Scan the Box QR, then the {spot.kind === 'zone' ? 'Zone' : 'Shelf'} QR
            </div>
          </div>
          <div className="s4wz-ctx">
            {spiCode && (
              <span className="s4wz-ctx__i"><IcoDoc /><span><em>SPI No.</em><b>{spiCode}</b></span></span>
            )}
            <span className="s4wz-ctx__i"><IcoQr size={13} /><span><em>Box ID</em><b>{box.code}</b></span></span>
            <span className="s4wz-ctx__i">
              <IcoShelf size={13} />
              <span><em>{spot.kind === 'zone' ? 'Zone ID' : 'Shelf ID'}</em><b>{spot.shelf}</b></span>
            </span>
          </div>
          <button type="button" className="s4qm__x" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="s4qm__bd">
          <div className="s4zt-card">
            {/* The task and its address are ONE card, as the design has them —
                the id, its state, and the five fields that say where the box
                is going, divided by a rule rather than a gap. The scanning
                strip, the two scan legs and the destination each stand on
                their own below it. */}
            <div className="s4zt-sec">
            <div className="s4zt-top">
              <span className="s4zt-top__ic"><IcoScan size={17} /></span>
              <div className="s4zt-top__tx">
                <span className="s4zt-top__k">Zebra verification task</span>
                <b className="s4zt-top__id">{taskId}</b>
              </div>
              <span className={`s4zt-st s4zt-st--${status[1]}`}>{status[0]}</span>
              <span className="s4zt-lockpill"><IcoLock />Method locked after submission</span>
            </div>

            {why && <div className="s4zt-err"><IcoX size={12} /><p><b>Verification failed:</b> {why}</p></div>}

            {/* Five fields, one row — the address and nothing else. Dev
                listed nine, padding it out with the box name, the scan recipe,
                a reserved percentage and a "Created by" that had nothing
                behind it, none of which the design shows. Rack and Shelf stay
                for a direct placement, struck as Not applicable. */}
            <div className="s4zt-grid">
              <F k="Box" v={box.code} />
              <F k="Warehouse" v={spot.warehouse || '—'} />
              <F k="Zone" v={<span className="s4zt-zone">{spot.zone}</span>} />
              {spot.kind === 'zone' ? <>
                <F k="Rack" v="Not applicable" na />
                <F k="Shelf" v="Not applicable" na />
              </> : <>
                <F k="Rack" v={spot.rack || '—'} />
                <F k="Shelf" v={spot.shelf} />
              </>}
            </div>
            </div>

            <div className="s4zt-bar">
              <span className="s4zt-bar__ic"><IcoScan size={15} /></span>
              <span className="s4zt-bar__k">
                <b>Warehouse Scanning · Zebra Handheld</b>
                {/* The strip says what it is doing NOW — waiting for scans, or
                    finished with them. */}
                <em>{done
                  ? 'Both QR codes verified — task closed.'
                  : 'Scans from the Zebra handheld are received here automatically'}</em>
              </span>
              {/* A browser has no handheld attached. This stands in for one,
                  and says so - every result it produces is marked SIMULATED. */}
              <button
                type="button"
                className={`s4zt-proto${proto ? ' is-on' : ''}`}
                role="switch"
                aria-checked={proto}
                onClick={() => setProto(p => !p)}
              >
                <i /><span>Prototype mode</span><b>{proto ? 'On' : 'Off'}</b>
              </button>
            </div>

            <div className="s4zt-legs">
              {leg('01', 'Scan Box QR', qr, false, setQr)}
              <span className="s4zt-legs__go" aria-hidden><IcoArrow /></span>
              {leg('02', `Scan ${spot.kind === 'zone' ? 'Zone' : 'Shelf'} QR`, sh, qr.state !== 'ok', setSh)}
            </div>

            <div className={`s4zt-dest${done ? ' is-done' : ''}`}>
              <span className="s4zt-dest__k"><IcoPin />Verified destination</span>
              <span className="s4zt-dest__chain">
                {chain.map((c, i) => (
                  <span key={c + String(i)}>
                    {/* A chevron, as the design draws it and as Step 02's own
                        chain already does — this was the one place using a
                        full arrow. */}
                    {i > 0 && <i>›</i>}
                    <span className={`s4sl-code s4sl-code--${['w', 'z', 'r', 's'][i] ?? 'w'}`}>{c}</span>
                  </span>
                ))}
              </span>
              <span className="s4zt-dest__st">
                {done ? <><IcoTick size={12} />Destination Verified</> : <><IcoScan size={12} />Destination verification pending</>}
              </span>
            </div>

            {/* What the two scans actually bought. The rows above report the
                scanning; this reports the OUTCOME — the box is no longer in
                transit between steps, it is at an address, under a reference
                somebody can quote. */}
            {done && (
              <div className="s4zt-locked">
                <span className="s4zt-locked__i"><IcoTick size={13} /></span>
                <div>
                  <b>Putaway allocation confirmed</b>
                  <span>
                    {box.code} is locked at {chain.join(' › ')}
                    {allocRef && <> &middot; {allocRef}</>}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="s4qm__ft s4zt-ft">
          <button type="button" className="s4-btn-back" onClick={onClose}>Close</button>
          <span className={`s4zt-foot${done ? ' is-done' : ''}`}>
            <i />{done
              ? 'Task completed — putaway allocation is locked'
              : 'Task completes automatically once both QR scans are verified'}
          </span>
          {/* Dropping the task belongs here, beside the dialog that holds it —
              the card behind this one offers the same thing, but by the time
              you are reading the scan legs this is the screen in front of you.
              Gone once both scans are in: there is nothing left to cancel. */}
          {onCancelTask && !done && (
            <button type="button" className="s4zt-cancel" onClick={onCancelTask}>
              Cancel Task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
