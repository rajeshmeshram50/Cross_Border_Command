import type { ReactNode } from 'react';
import DirectSpiPicker, { type PickRow } from './DirectSpiPicker';
import DirectSpiSupplierPicker from './DirectSpiSupplierPicker';
import { SHIPMENTS, PROCUREMENTS, NEXT_PROCUREMENT, SUPPLIERS } from './direct-spi-data';

/**
 * Direct SPI setup — the three things a standalone invoice needs before it can
 * be opened, ported from the Kryptone prototype's `.sdx-*` block.
 *
 * A Direct SPI has no purchase order to inherit from, so nothing about it is
 * implied: which shipment it belongs to (if any), which procurement case it is
 * billed against, and who the supplier is all have to be stated. The design
 * asks for them one at a time and keeps the later steps visibly locked, so the
 * order is obvious before you start rather than discovered by a validation
 * message at the end.
 *
 * This file is the PANEL. The modal around it (type cards, header, footer)
 * stays in MapInvoiceModal.
 */

export type ShipmentScope = 'with' | 'without';

export type ProcurementMode = 'link' | 'auto';

export interface DirectSpiState {
  shipment: ShipmentScope | null;
  shipmentId: string | null;
  /** Link an existing case, or take the next id in sequence. */
  procMode: ProcurementMode | null;
  procurementId: string | null;
  supplier: string | null;
}

export const EMPTY_DIRECT: DirectSpiState = {
  shipment: null, shipmentId: null, procMode: null, procurementId: null, supplier: null,
};

/* Step 02 (Procurement) is deferred — that side of a Direct SPI is not built
   yet, so the step stays on screen as a permanently locked placeholder and the
   flow runs 01 → 03.
   It is ONE flag rather than three edits because the step is load-bearing in
   three unrelated places: the card's own lock state, step 03's unlock gate,
   and the ready check that drives Confirm. Freezing it by hand in the panel
   alone would leave Confirm waiting on a step nobody can answer. Setting this
   back to true restores the original 01 → 02 → 03 flow with nothing else to
   put back. */
export const PROCUREMENT_STEP_ENABLED = false;

/* A step counts as answered only when its id RESOLVES to a row, not merely
   when the field is non-empty. A value that no longer matches the list — a
   supplier that has gone, a stale id left behind by an earlier shape of this
   state — would otherwise tick the step and fill the ring while the summary
   beside it read "Not selected" and the picker showed its placeholder. */
export const directStepDone = (s: DirectSpiState) => ({
  /* Step 1 is answered by picking either option — "All Other's" is an answer,
     not an absence, so it counts as done the same as a shipment id would. */
  shipment: s.shipment === 'without'
    || (s.shipment === 'with' && SHIPMENTS.some(r => r.code === s.shipmentId)),
  /* Auto-create needs nothing more than the choice: the next id in sequence
     is already known, so the step is answered as soon as it is picked. */
  procurement: s.procMode === 'auto'
    || (s.procMode === 'link' && PROCUREMENTS.some(r => r.code === s.procurementId)),
  supplier: SUPPLIERS.some(r => r.code === s.supplier),
});

export const directReady = (s: DirectSpiState) => {
  const d = directStepDone(s);
  /* While the procurement step is frozen there is no way to answer it, so
     requiring it would leave Confirm permanently dead. */
  return d.shipment && (!PROCUREMENT_STEP_ENABLED || d.procurement) && d.supplier;
};

const IcoTruck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="1" y="6" width="14" height="11" rx="1.5" /><path d="M15 9h4l3 3v5h-7z" />
    <circle cx="6" cy="19" r="1.6" /><circle cx="17.5" cy="19" r="1.6" />
  </svg>
);
const IcoDoc = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const IcoCase = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="2" y1="13" x2="22" y2="13" />
  </svg>
);
const IcoPerson = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const IcoLock = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const IcoTick = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IcoLink = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const IcoPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IcoBox = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IcoWrench = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);
const IcoBolt = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

/** One row of the left-hand summary: what is decided, and what is still open. */
function SumRow({ ico, label, value, code, badge, sub, done }: {
  ico: ReactNode; label: string; value: string;
  /** The id, shown as its own chip rather than inside the sentence. */
  code?: string;
  /** Whether a procurement case was picked or will be created. */
  badge?: 'existing' | 'new';
  sub?: string; done: boolean;
}) {
  return (
    <div className={`sdx-sum__row${done ? ' is-ok' : ''}`}>
      <span className="sdx-sum__ico">{ico}</span>
      <span className="sdx-sum__txt">
        <span className="sdx-sum__l">{label}</span>
        <span className="sdx-sum__v">
          {code && <code>{code}</code>}
          {value}
          {badge && <em className={badge === 'new' ? 'sdx-sum__new' : 'sdx-sum__ex'}>{badge}</em>}
        </span>
        {sub && <span className="sdx-sum__s">{sub}</span>}
      </span>
      <span className="sdx-sum__st">{done ? IcoTick : null}</span>
    </div>
  );
}

/** The progress ring in the summary head. 0–100, drawn from a 22r circle. */
function Ring({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 22;
  return (
    <div className="sdx-ring">
      <svg viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r="22" className="sdx-ring__bg" />
        <circle cx="26" cy="26" r="22" className="sdx-ring__fg"
          style={{ strokeDasharray: C, strokeDashoffset: C - (C * pct) / 100 }} />
      </svg>
      <span>{pct}%</span>
    </div>
  );
}

export function DirectSpiSummary({ state }: { state: DirectSpiState }) {
  const done = directStepDone(state);
  const shipment = SHIPMENTS.find(r => r.code === state.shipmentId);
  const procurement = PROCUREMENTS.find(r => r.code === state.procurementId);
  const supplier = SUPPLIERS.find(r => r.code === state.supplier);
  /* Out of the steps that can actually be answered, not the four summary rows:
     SPI Type is listed as context, not as progress — it is already decided by
     the time this panel exists. With procurement frozen the denominator drops
     to 2, so the ring still reaches 100% and "steps left" still counts down to
     zero; against a fixed 3 it would have stalled at 67% on a complete form. */
  const steps = PROCUREMENT_STEP_ENABLED
    ? [done.shipment, done.procurement, done.supplier]
    : [done.shipment, done.supplier];
  const n = steps.filter(Boolean).length;
  const pct = Math.round((n / steps.length) * 100);
  const left = steps.length - n;

  return (
    <div className="sdx-sum">
      <div className="sdx-sum__hd">
        <Ring pct={pct} />
        <div>
          <div className="sdx-sum__t">Direct SPI summary</div>
          <div className="sdx-sum__sub">
            {left === 0 ? 'All set — ready to continue' : `${left} step${left === 1 ? '' : 's'} left to complete`}
          </div>
        </div>
      </div>
      <div className="sdx-sum__rows">
        <SumRow ico={IcoDoc} label="SPI Type" value="Direct SPI" sub="Without Purchase Order" done />
        <SumRow ico={IcoTruck} label="Shipment"
          code={state.shipment === 'with' ? state.shipmentId ?? undefined : undefined}
          value={done.shipment
            ? (state.shipment === 'without' ? 'All Other’s' : '')
            : 'Not selected'}
          sub={shipment?.title}
          done={done.shipment} />
        {/* Frozen, it still has a row — the summary mirrors the steps, and a
            missing row would read as a step that does not exist rather than
            one that is not ready. "Not selected" would be wrong though: it
            implies something the user could go and select. */}
        {PROCUREMENT_STEP_ENABLED ? (
          <SumRow ico={IcoCase} label="Procurement Case ID"
            code={done.procurement ? (state.procMode === 'auto' ? NEXT_PROCUREMENT : state.procurementId ?? undefined) : undefined}
            value={done.procurement ? '' : 'Not selected'}
            badge={done.procurement ? (state.procMode === 'auto' ? 'new' : 'existing') : undefined}
            sub={state.procMode === 'link' ? procurement?.title : state.procMode === 'auto' ? 'Auto-created' : undefined}
            done={done.procurement} />
        ) : (
          <SumRow ico={IcoCase} label="Procurement Case ID"
            value="Coming soon" sub="Not part of this release" done={false} />
        )}
        <SumRow ico={IcoPerson} label="Supplier"
          value={supplier?.name ?? 'Not selected'}
          sub={supplier ? `${supplier.code} · ${supplier.location.split(', ').pop()}` : undefined}
          done={done.supplier} />
      </div>
    </div>
  );
}

/* ── Loading state ──────────────────────────────────────────────────────────
   The dialog widens to 1240 before the panel is mounted, which left an empty
   half-screen for the length of that animation. These two stand in its place,
   shaped like what replaces them — the ring, the four summary rows, the three
   step cards — so the growth reads as the panel arriving rather than as a gap
   that something later drops into.

   Static markup and one CSS keyframe: no state, no timers, nothing to tear
   down, and the arrays are module constants so a re-render reuses them.
   ────────────────────────────────────────────────────────────────────────── */

const SUM_ROWS = [0, 1, 2, 3];
const STEP_CARDS = [0, 1, 2];

export function DirectSpiSummarySkeleton() {
  return (
    <div className="sdx-sum sdxsk" aria-hidden>
      <div className="sdx-sum__hd">
        <span className="sdxsk-ring" />
        <span className="sdxsk-lines">
          <span className="sdxsk-bar sdxsk-bar--onhd" style={{ width: '58%' }} />
          <span className="sdxsk-bar sdxsk-bar--onhd" style={{ width: '42%', height: 8 }} />
        </span>
      </div>
      <div className="sdx-sum__rows">
        {SUM_ROWS.map(i => (
          <div className="sdxsk-row" key={i}>
            <span className="sdxsk-bar sdxsk-ico" />
            <span className="sdxsk-lines">
              <span className="sdxsk-bar" style={{ width: '34%', height: 7 }} />
              <span className="sdxsk-bar" style={{ width: `${62 - i * 6}%` }} />
            </span>
            <span className="sdxsk-bar sdxsk-tick" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DirectSpiStepsSkeleton() {
  return (
    <div className="sdx-main sdxsk" aria-hidden aria-busy="true">
      <div className="sdx-main__hd">
        <span className="sdxsk-bar sdxsk-head-ico" />
        <span className="sdxsk-lines">
          <span className="sdxsk-bar" style={{ width: 160 }} />
          <span className="sdxsk-bar" style={{ width: 280, height: 8 }} />
        </span>
      </div>
      <div className="sdx-steps">
        {STEP_CARDS.map(i => (
          <div className="sdx-step" key={i}>
            <div className="sdx-rail">
              <span className="sdxsk-bar sdxsk-node" />
              {i < 2 && <span className="sdx-line" />}
            </div>
            <div className="sdx-card sdxsk-card">
              <span className="sdxsk-bar" style={{ width: '22%', height: 7 }} />
              <span className="sdxsk-bar" style={{ width: '64%', height: 12, marginTop: 8 }} />
              {/* Only the open step shows its options; the two beneath it are
                  locked, and a short card is what the user will see there. */}
              {i === 0 && (
                <div className="sdxsk-opts">
                  <span className="sdxsk-bar sdxsk-opt" />
                  <span className="sdxsk-bar sdxsk-opt" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A step card. `state` drives the node, the rule beneath it and the card. */
function Step({ no, eyebrow, title, sub, state, tag, locked, children }: {
  no: string; eyebrow: string; title: ReactNode; sub?: string;
  state: 'active' | 'done' | 'locked'; tag?: ReactNode; locked?: string; children?: ReactNode;
}) {
  return (
    <section className={`sdx-step is-${state}`}>
      <div className="sdx-rail">
        <span className="sdx-node">{state === 'done' ? IcoTick : no}</span>
        <span className="sdx-line" />
      </div>
      <div className="sdx-card">
        <div className="sdx-hd">
          <div className="sdx-hd__txt">
            <div className="sdx-eyebrow">{eyebrow}</div>
            <div className="sdx-t">{title}</div>
            {sub && state !== 'locked' && <div className="sdx-s">{sub}</div>}
            {locked && <div className="sdx-locked-msg">{IcoLock}{locked}</div>}
          </div>
          {tag}
        </div>
        {children && state !== 'locked' && <div className="sdx-body">{children}</div>}
      </div>
    </section>
  );
}

function Opt({ on, ico, title, sub, onPick }: {
  on: boolean; ico: ReactNode; title: string; sub: string; onPick: () => void;
}) {
  return (
    <button type="button" className={`sdx-opt${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onPick}>
      <span className="sdx-opt__ico">{ico}</span>
      <span className="sdx-opt__b">
        <span className="sdx-opt__t">{title}</span>
        <span className="sdx-opt__s">{sub}</span>
      </span>
      <span className="sdx-opt__rad">{IcoTick}</span>
    </button>
  );
}

export default function DirectSpiSetup({ state, onChange }: {
  state: DirectSpiState;
  onChange: (next: DirectSpiState) => void;
}) {
  const done = directStepDone(state);
  const picked = PROCUREMENTS.find(r => r.code === state.procurementId);
  /* With procurement frozen, step 03 opens off step 01 — otherwise it waits
     on a step that can never be answered and the wizard dead-ends at 02. */
  const supplierOpen = PROCUREMENT_STEP_ENABLED ? done.procurement : done.shipment;

  return (
    <div className="sdx-main">
      <div className="sdx-main__hd">
        <span className="sdx-main__ico">{IcoBolt}</span>
        <div>
          <div className="sdx-main__t">Direct SPI setup</div>
          <div className="sdx-main__s">
            {PROCUREMENT_STEP_ENABLED
              ? 'Link this invoice to a shipment and a procurement, then choose the supplier.'
              : 'Link this invoice to a shipment, then choose the supplier.'}
          </div>
        </div>
      </div>

      <div className="sdx-steps">
        <Step
          no="01"
          eyebrow="Step 01 · Shipment"
          title={<>Is this Direct SPI raised against a customer shipment? <span className="sdx-req">*</span></>}
          sub="Choose With Shipment ID or All Other’s."
          state={done.shipment ? 'done' : 'active'}
          tag={done.shipment
            ? <span className="sdx-tag sdx-tag--done">Done</span>
            : <span className="sdx-tag sdx-tag--req">Required</span>}
        >
          <div className="sdx-opts">
            <Opt
              on={state.shipment === 'with'}
              ico={IcoTruck}
              title="With Shipment ID"
              sub="Invoice belongs to a customer shipment"
              onPick={() => onChange({ ...state, shipment: 'with' })}
            />
            <Opt
              on={state.shipment === 'without'}
              ico={IcoDoc}
              title="All Other’s (Without Shipment ID)"
              sub="Not linked to any shipment"
              /* Switching to "All Other's" drops a shipment id picked under the
                 other branch — leaving it would submit a link the user has
                 just said does not exist. */
              onPick={() => onChange({ ...state, shipment: 'without', shipmentId: null })}
            />
          </div>

          {/* Only the shipment branch asks a second question — "All Other's"
              is complete the moment it is chosen. */}
          {state.shipment === 'with' && (
            <div className="sdx-field">
              <div className="sdx-lbl">{IcoTruck} Select Shipment ID <span className="sdx-req">*</span></div>
              <DirectSpiPicker
                rows={SHIPMENTS}
                value={state.shipmentId}
                onPick={code => onChange({ ...state, shipmentId: code })}
                placeholder="Select Shipment ID…"
                noun="shipments"
                ico={IcoTruck}
                popIco={() => IcoTruck}
                searchPlaceholder="Search Shipment ID, customer, product…"
              />
            </div>
          )}
        </Step>

        <Step
          no="02"
          eyebrow="Step 02 · Procurement"
          title="Link a Procurement Case ID to this Direct SPI"
          /* Frozen: locked regardless of step 01, and the card's body is not
             rendered at all in the locked state (see Step), so the two options
             below are unreachable rather than merely dimmed. */
          state={!PROCUREMENT_STEP_ENABLED ? 'locked' : done.shipment ? (done.procurement ? 'done' : 'active') : 'locked'}
          locked={!PROCUREMENT_STEP_ENABLED
            ? 'Coming soon — this step is not part of the current release'
            : done.shipment ? undefined : 'Complete step 01 to unlock'}
          tag={!PROCUREMENT_STEP_ENABLED
            ? <span className="sdx-tag sdx-tag--lock">{IcoLock}Coming soon</span>
            : done.shipment
              ? (done.procurement
                ? <span className="sdx-tag sdx-tag--done">Done</span>
                : <span className="sdx-tag sdx-tag--req">Required</span>)
              : <span className="sdx-tag sdx-tag--lock">{IcoLock}Locked</span>}
        >
          <div className="sdx-opts">
            <Opt
              on={state.procMode === 'link'}
              ico={IcoLink}
              title="Link existing Procurement Case ID"
              sub="Choose from existing procurement requests"
              onPick={() => onChange({ ...state, procMode: 'link' })}
            />
            <Opt
              on={state.procMode === 'auto'}
              ico={IcoPlus}
              title="Auto-create Procurement Case ID"
              sub="Use the next Procurement Case ID in sequence"
              onPick={() => onChange({ ...state, procMode: 'auto', procurementId: null })}
            />
          </div>

          {state.procMode === 'link' && (
            <div className="sdx-field">
              <div className="sdx-lbl">{IcoCase} Select Procurement Case ID <span className="sdx-req">*</span></div>
              <DirectSpiPicker
                rows={PROCUREMENTS}
                value={state.procurementId}
                onPick={code => onChange({ ...state, procurementId: code })}
                placeholder="Select Procurement Case ID…"
                noun="procurements"
                ico={IcoCase}
                popIco={r => (r.tag?.tone === 'ffd' ? IcoTruck : r.tag?.tone === 'service' ? IcoWrench : IcoBox)}
                searchPlaceholder="Search Procurement Case ID, type, assignee, raised by…"
              />
              {picked && (
                <div className="sdx-linked">
                  <span className="sdx-linked__ck">{IcoTick}</span>
                  <span><b>{picked.code}</b> will be linked · {picked.title}</span>
                  {picked.tag && <span className={`sdx-ptype sdx-ptype--${picked.tag.tone}`}>{picked.tag.text}</span>}
                </div>
              )}
            </div>
          )}

          {state.procMode === 'auto' && (
            <div className="sdx-auto">
              <div className="sdx-auto__l">
                <div className="sdx-auto__lbl">Next in sequence</div>
                <div className="sdx-auto__id">{NEXT_PROCUREMENT}</div>
              </div>
              <div className="sdx-auto__r">
                <span className="sdx-auto__chip">{IcoTick} Will be created on confirm</span>
                <div className="sdx-auto__s">
                  A new procurement case is opened with this invoice and carries its audit trail.
                  Nothing is created until you confirm.
                </div>
              </div>
            </div>
          )}
        </Step>

        <Step
          no="03"
          eyebrow="Step 03 · Supplier"
          title="Select the supplier"
          state={supplierOpen ? (done.supplier ? 'done' : 'active') : 'locked'}
          locked={supplierOpen
            ? undefined
            : `Complete step ${PROCUREMENT_STEP_ENABLED ? '02' : '01'} to unlock`}
          tag={supplierOpen
            ? (done.supplier
              ? <span className="sdx-tag sdx-tag--done">Done</span>
              : <span className="sdx-tag sdx-tag--req">Required</span>)
            : <span className="sdx-tag sdx-tag--lock">{IcoLock}Locked</span>}
          sub="The supplier who issued this invoice."
        >
          <div className="sdx-field">
            <div className="sdx-lbl">{IcoPerson} Supplier <span className="sdx-req">*</span></div>
            <DirectSpiSupplierPicker
              rows={SUPPLIERS}
              value={state.supplier}
              onPick={code => onChange({ ...state, supplier: code })}
            />
          </div>
        </Step>
      </div>
    </div>
  );
}
