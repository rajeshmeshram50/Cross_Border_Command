import { useState } from 'react';
import InventoryTabs from './InventoryTabs';
import '../../../css/inventory-scan.css';
import './handheld-guide.css';

/**
 * What the Zebra shows, screen by screen.
 *
 * A reference for anyone who will never hold the device — ops, QA, a client
 * walkthrough. The phone on the right is rendered at the handheld's real
 * 360px width using the same type sizes putaway-scan.css sets, so what is on
 * this page is what is on the device rather than an impression of it.
 *
 * Static on purpose: it takes no data and calls nothing, so it cannot drift
 * into being a second, half-working put-away screen.
 */

type Key = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8';

const SCREENS: Array<{ key: Key; n: number; title: string; sub: string }> = [
  { key: 's1', n: 1, title: 'Pending tasks',      sub: 'Nothing in hand' },
  { key: 's2', n: 2, title: 'Scan the box',       sub: 'Contents hidden' },
  { key: 's3', n: 3, title: 'Box verified',       sub: 'The card opens up' },
  { key: 's4', n: 4, title: "What's inside",      sub: 'Products expanded' },
  { key: 's5', n: 5, title: 'Walking the levels', sub: 'Zone, rack, shelf' },
  { key: 's6', n: 6, title: 'Ready to complete',  sub: 'Both halves matched' },
  { key: 's7', n: 7, title: 'Queue mid-task',     sub: 'From the badge' },
  { key: 's8', n: 8, title: 'Box cleared',        sub: 'Scans given back' },
];

/** The note beside the phone: what this moment is, and why it behaves so. */
const NOTES: Record<Key, {
  title: string; url?: string; lead: string; points: string[];
  /** What is written down at this moment — the half a screenshot cannot show. */
  records?: { heading: string; items: string[] };
}> = {
  s1: {
    title: 'Pending tasks', url: '/putaway-scan',
    lead: "The handheld's home. Every box waiting, with where it goes and whether anyone has started it.",
    points: ['The badge in the title bar is the same count.', 'Scanning a sticker skips this screen entirely.'],
  },
  s2: {
    title: 'Scan the box first', url: '/putaway-scan/{taskId}',
    lead: 'Only what sends the operator to the right aisle — no products, no batches, no expiry.',
    points: [
      "The scan proves the carton in hand is this task's carton.",
      'Someone who can read the answer off the screen has nothing to prove.',
      'Wrong box: “This task wants B-001”, and nothing changes.',
    ],
    records: {
      heading: 'If the wrong box is scanned',
      items: [
        'The refusal is logged against the task with its reason code.',
        'Three wrong scans end the run and return the task to the queue.',
      ],
    },
  },
  s3: {
    title: 'Box verified',
    lead: 'The label matched, so the card fills in and the walk appears as three rungs.',
    points: ['Chip turns BOX_SCAN_VERIFIED, count moves to 1/2.', 'The task binds to this handheld so nobody takes it mid-walk.'],
    records: {
      heading: 'What the system records',
      items: ['box_scan_at is stamped and completed_scans moves to 1.', 'The device serial is written to the task.'],
    },
  },
  s4: {
    title: "What's inside",
    lead: 'More opens the contents in place rather than on a new screen — the operator is checking the list against what is in their hands.',
    points: ['SKU, HSN, batch, expiry, segment and lot per line.', 'Anything dated is marked EXPIRY TRACKED.', 'Past five lines it scrolls inside the card.'],
  },
  s5: {
    title: 'Walking the levels',
    lead: 'Zone, then rack, then shelf. Each scan ticks its rung and moves the prompt on.',
    points: ['Scanning the shelf directly ticks all three at once.', 'The field stays focused — the scanner types, nobody taps.'],
  },
  s6: {
    title: 'Ready to complete',
    lead: 'Both halves proved, so the server marks the task ready and the button appears.',
    points: ['It only ever shows when the server says so.', 'The scans are the proof; the press adds no verification.'],
    records: {
      heading: 'On Complete',
      items: [
        'The box is recorded as placed, with the time, the device and the person it acts as.',
        "The shelf's used weight and free space move by this box.",
        'The task leaves the queue and the badge drops to 5.',
      ],
    },
  },
  s7: {
    title: 'The queue, mid-task',
    lead: 'The badge opens the queue over the current task. The box in hand is marked VIEWING.',
    points: ['Tapping another row switches to it.', 'Tapping the current one just closes the sheet.'],
  },
  s8: {
    title: 'Box cleared',
    lead: 'Clear box gives back every scan — the box, all three rungs, the count, the device binding.',
    points: [
      'The task stays open and pending; it still needs doing.',
      'Whoever opens it next must scan the box again.',
      'The log keeps the scans, with putaway.released beside them.',
    ],
    records: {
      heading: 'What the log keeps',
      items: [
        'putaway.box_scanned — B-001',
        'putaway.zone_scanned — ZN-A',
        'putaway.released — had_scans: [box, zone]',
      ],
    },
  },
};

/** The device this page is drawing, stated once. */
const FACTS: Array<[string, string]> = [
  ['Device', 'Zebra TC27'],
  ['Screen', '360 × 720'],
  ['Input', 'DataWedge keyboard wedge'],
  ['Auth', 'Client certificate'],
  ['Idle', 'Back to queue after 5 min'],
  ['Attempts', '3 wrong scans end the run'],
];

/* ── The phone's own pieces, so each screen reads as markup not plumbing ── */

const Chip = ({ tone, children }: { tone?: 'ok' | 'warn'; children: React.ReactNode }) => (
  <span className={'hhg-chip' + (tone ? ' is-' + tone : '')}>{children}</span>
);

const Rung = ({ label, code, sub, state }: {
  label: string; code: string; sub: string; state: 'done' | 'next' | 'pending';
}) => (
  <div className={'hhg-slot' + (state === 'done' ? ' is-done' : state === 'next' ? ' is-next' : '')}>
    <span>{label}</span><b>{code}</b><small>{sub}</small>
    <i>{state === 'done' ? '✓ Scanned' : state === 'next' ? 'Next' : 'Pending'}</i>
  </div>
);

const Task = ({ code, dest, task, state, current }: {
  code: string; dest: string; task: string; state: string; current?: boolean;
}) => (
  <div className={'hhg-row' + (current ? ' is-current' : '')}>
    <div className="hhg-row-top">
      <span className="hhg-row-code">{code}</span>
      {current && <Chip tone="ok">VIEWING</Chip>}
      <span className="hhg-sp" />
      <Chip tone={current ? 'ok' : 'warn'}>{current ? 'BOX_SCAN_VERIFIED' : 'PENDING_DEVICE_SCAN'}</Chip>
    </div>
    <small className="hhg-row-sub">{dest} · {task}</small>
    <small className="hhg-row-state">{state}</small>
  </div>
);

const Product = ({ sr, name, qty, sku, hsn, batch, expiry }: {
  sr: number; name: string; qty: string; sku: string; hsn: string; batch: string; expiry: string;
}) => (
  <div className="hhg-prod">
    <div className="hhg-prod-top">
      <span className="hhg-sr">{sr}</span>
      <span className="hhg-prod-n">{name}</span>
      <span className="hhg-qty">{qty}</span>
    </div>
    <div className="hhg-prod-grid">
      <div><span>SKU</span><b>{sku}</b></div>
      <div><span>HSN</span><b>{hsn}</b></div>
      <div><span>BATCH</span><b>{batch}</b></div>
      <div><span>EXPIRY</span><b>{expiry}</b></div>
    </div>
    {expiry !== '—' && <div className="hhg-tags"><Chip tone="warn">EXPIRY TRACKED</Chip></div>}
  </div>
);

const BoxHead = ({ chip, tone }: { chip: string; tone: 'ok' | 'warn' }) => (
  <div className="hhg-card-top">
    <span className="hhg-kick">BOX</span>
    <span className="hhg-code">B-001</span>
    <span className="hhg-sp" />
    <Chip tone={tone}>{chip}</Chip>
  </div>
);

const Waiting = ({ label }: { label: string }) => (
  <div>
    <div className="hhg-flabel">{label}</div>
    <div className="hhg-input">Waiting for the trigger…</div>
  </div>
);

export default function InventoryHandheldGuide() {
  const [key, setKey] = useState<Key>('s1');
  const note = NOTES[key];

  return (
    /* inv-scan is what InventoryTabs styles itself under — without it the
       rail renders as unspaced text with the icons jammed against it. */
    <div className="page-content hhg-page inv-scan">
      <div className="frm-cstrip hr-cstrip hr-cstrip--teal mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-smartphone-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">Handheld Screens</div>
            <div className="frm-cstrip-sub">
              What the Zebra shows, screen by screen — at the size it appears on the device
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
          <span className="hhg-step-of">Screen {SCREENS.find(s => s.key === key)!.n} of {SCREENS.length}</span>
        </div>
      </div>
      <InventoryTabs />

      <div className="hhg-split">

        <nav className="hhg-menu" aria-label="Handheld screens">
          <h2>Screens</h2>
          {SCREENS.map(s => (
            <button
              key={s.key}
              type="button"
              className="hhg-pick"
              aria-pressed={key === s.key}
              onClick={() => setKey(s.key)}
            >
              <span className="hhg-n">{s.n}</span>
              <span className="hhg-pick-t"><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}

          <div className="hhg-facts">
            {FACTS.map(([label, value]) => (
              <div key={label}><span>{label}</span><b>{value}</b></div>
            ))}
          </div>
        </nav>

        <div className="hhg-stage">
          <div className="hhg-phone">
            <div className="hhg-phone-in">
              <div className="hhg-sysbar"><span>10:58</span><span>WH-PUNE-01 · 82%</span></div>
              <div className="hhg-appbar">
                <span className="hhg-logo">K</span>
                <span className="hhg-abt"><b>Scan &amp; Verify</b><small>TC27 · 2601352470</small></span>
                <span className="hhg-bell"><i className="ri-list-check-2" /><em>6</em></span>
              </div>

              <div className="hhg-body">
                {key === 's1' && (
                  <>
                    <div className="hhg-sheet-head"><span><b>Pending tasks</b><small>6 boxes awaiting verification</small></span></div>
                    <div className="hhg-rows">
                      <Task code="B-001" dest="SH-102" task="ZT-20261024-001" state="Not scanned" />
                      <Task code="B-010" dest="SH-102" task="ZT-20261024-002" state="Not scanned" />
                      <Task code="B-003" dest="RK-A1"  task="ZT-20261024-003" state="Not scanned" />
                      <Task code="B-007" dest="RK-A1"  task="ZT-20261024-004" state="Not scanned" />
                    </div>
                  </>
                )}

                {key === 's2' && (
                  <>
                    <section className="hhg-card">
                      <BoxHead chip="PENDING_DEVICE_SCAN" tone="warn" />
                      <div className="hhg-meta3">
                        <div><span>INVOICE</span><b>SPI/2026-27/005</b></div>
                        <div><span>DESTINATION</span><b>SH-102</b></div>
                        <div><span>SCANS</span><b>0/2</b></div>
                      </div>
                    </section>
                    <div className="hhg-next">
                      <span>NEXT SCAN</span><b>Box QR B-001</b>
                      <small>Scan the label on the carton to confirm it is this one. Its contents open once the box is verified.</small>
                    </div>
                    <Waiting label="SCAN THE BOX" />
                  </>
                )}

                {key === 's3' && (
                  <>
                    <div className="hhg-toast"><b>Box scanned successfully</b><small>Now scan the zone ZN-A</small></div>
                    <section className="hhg-card">
                      <div className="hhg-card-top">
                        <span className="hhg-kick">BOX</span><span className="hhg-code">B-001</span>
                        <Chip>MIXED</Chip><span className="hhg-sp" />
                        <span className="hhg-more">More <b>4</b></span>
                      </div>
                      <div className="hhg-name">Mixed Product Box</div>
                      <div className="hhg-meta3">
                        <div><span>PRODUCTS</span><b>4 products</b></div>
                        <div><span>CONDITION</span><b>Good</b></div>
                        <div><span>DESTINATION</span><b>SH-102</b></div>
                      </div>
                      <div className="hhg-tags">
                        <Chip tone="ok">BOX_SCAN_VERIFIED</Chip>
                        <span className="hhg-pill">ZT-…001 · 1/2</span>
                      </div>
                    </section>
                    <div className="hhg-slots">
                      <Rung label="ZONE"  code="ZN-A"   sub="General Storage" state="next" />
                      <Rung label="RACK"  code="RK-A1"  sub="Rack A1"         state="pending" />
                      <Rung label="SHELF" code="SH-102" sub="Level 2"         state="pending" />
                    </div>
                    <div className="hhg-next">
                      <span>NEXT SCAN</span><b>Zone QR ZN-A</b>
                      <small>A rack or zone QR verifies its own level and parents only.</small>
                    </div>
                  </>
                )}

                {key === 's4' && (
                  <section className="hhg-card">
                    <div className="hhg-card-top">
                      <span className="hhg-kick">BOX</span><span className="hhg-code">B-001</span>
                      <Chip>MIXED</Chip><span className="hhg-sp" />
                      <span className="hhg-more">Show Less</span>
                    </div>
                    <div style={{ marginTop: 9 }}>
                      <Product sr={1} name="Cetirizine 10 mg Tablets" qty="40 Strip"
                        sku="PRD-10418" hsn="3004" batch="CTZ2408B" expiry="05/2027" />
                      <Product sr={2} name="Povidone-Iodine 5% Solution 100 ml" qty="24 Bottle"
                        sku="PRD-20077" hsn="3004" batch="PVI2407C" expiry="—" />
                    </div>
                  </section>
                )}

                {key === 's5' && (
                  <>
                    <div className="hhg-toast"><b>Zone scanned successfully</b><small>Now scan the rack RK-A1</small></div>
                    <div className="hhg-slots">
                      <Rung label="ZONE"  code="ZN-A"   sub="General Storage" state="done" />
                      <Rung label="RACK"  code="RK-A1"  sub="Rack A1"         state="next" />
                      <Rung label="SHELF" code="SH-102" sub="Level 2"         state="pending" />
                    </div>
                    <div className="hhg-next">
                      <span>NEXT SCAN</span><b>Rack QR RK-A1</b>
                      <small>Scanning the shelf directly ticks all three at once.</small>
                    </div>
                    <Waiting label="SCAN THE ZONE / RACK / SHELF" />
                  </>
                )}

                {key === 's6' && (
                  <>
                    <div className="hhg-toast"><b>Shelf scanned successfully</b><small>Both matched — press Complete</small></div>
                    <div className="hhg-slots">
                      <Rung label="ZONE"  code="ZN-A"   sub="General Storage" state="done" />
                      <Rung label="RACK"  code="RK-A1"  sub="Rack A1"         state="done" />
                      <Rung label="SHELF" code="SH-102" sub="Level 2"         state="done" />
                    </div>
                    <section className="hhg-card">
                      <BoxHead chip="BOX_SCAN_VERIFIED" tone="ok" />
                      <div className="hhg-tags"><span className="hhg-pill">ZT-…001 · 2/2</span></div>
                    </section>
                  </>
                )}

                {key === 's7' && (
                  <>
                    <div className="hhg-sheet-head">
                      <span><b>Pending tasks</b><small>6 boxes awaiting verification</small></span>
                      <span className="hhg-x">✕</span>
                    </div>
                    <div className="hhg-rows">
                      <Task code="B-001" dest="SH-102" task="ZT-20261024-001" state="Box scanned" current />
                      <Task code="B-010" dest="SH-102" task="ZT-20261024-002" state="Not scanned" />
                      <Task code="B-003" dest="RK-A1"  task="ZT-20261024-003" state="Not scanned" />
                    </div>
                  </>
                )}

                {key === 's8' && (
                  <>
                    <div className="hhg-banner">Box cleared. Scan it again to start this put-away.</div>
                    <section className="hhg-card">
                      <BoxHead chip="PENDING_DEVICE_SCAN" tone="warn" />
                      <div className="hhg-meta3">
                        <div><span>INVOICE</span><b>SPI/2026-27/005</b></div>
                        <div><span>DESTINATION</span><b>SH-102</b></div>
                        <div><span>SCANS</span><b>0/2</b></div>
                      </div>
                    </section>
                    <div className="hhg-next">
                      <span>NEXT SCAN</span><b>Box QR B-001</b>
                      <small>Scan the label on the carton to confirm it is this one.</small>
                    </div>
                  </>
                )}
              </div>

              <div className="hhg-foot">
                {key === 's6' && <div className="hhg-btn"><i className="ri-checkbox-circle-line" />Complete put-away</div>}
                <div className="hhg-ghost"><i className="ri-close-line" />Clear box</div>
              </div>
            </div>
          </div>

          <div className="hhg-cap">
            <h3>{note.title}</h3>
            {note.url && <span className="hhg-url">{note.url}</span>}
            <p>{note.lead}</p>
            <ul>{note.points.map(p => <li key={p}>{p}</li>)}</ul>
            {note.records && (
              <div className="hhg-records">
                <h4>{note.records.heading}</h4>
                <ul>{note.records.items.map(r => <li key={r}><code>{r}</code></li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
