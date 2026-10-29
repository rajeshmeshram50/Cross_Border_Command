import type { ReactNode } from 'react';
import DirectSpiPicker, { type PickRow } from './DirectSpiPicker';
import DirectSpiSupplierPicker from './DirectSpiSupplierPicker';
import { PROCUREMENTS, NEXT_PROCUREMENT, SUPPLIERS, useShipmentRows } from './direct-spi-data';

export type ShipmentScope = 'with' | 'without';

export type ProcurementMode = 'link' | 'auto';

export interface DirectSpiState {
  shipment: ShipmentScope | null;
  shipmentId: string | null;
  shipmentLabel?: string | null;
  shipmentPi?: string | null;
  shipmentDate?: string | null;
  procMode: ProcurementMode | null;
  procurementId: string | null;
  supplier: string | null;
}

export const EMPTY_DIRECT: DirectSpiState = {
  shipment: null, shipmentId: null, procMode: null, procurementId: null, supplier: null,
};

export const PROCUREMENT_STEP_ENABLED = false;

export const directStepDone = (s: DirectSpiState) => ({
  shipment: s.shipment === 'without'
    || (s.shipment === 'with' && !!s.shipmentId),
  procurement: s.procMode === 'auto'
    || (s.procMode === 'link' && PROCUREMENTS.some(r => r.code === s.procurementId)),
  supplier: SUPPLIERS.some(r => r.code === s.supplier),
});

export const directReady = (s: DirectSpiState) => {
  const d = directStepDone(s);
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

function SumRow({ ico, label, value, code, badge, sub, done }: {
  ico: ReactNode; label: string; value: string;
  code?: string;
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
  const procurement = PROCUREMENTS.find(r => r.code === state.procurementId);
  const supplier = SUPPLIERS.find(r => r.code === state.supplier);
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
          sub={state.shipment === 'with' ? state.shipmentLabel ?? undefined : undefined}
          done={done.shipment} />
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
  const ships = useShipmentRows(state.shipment === 'with');
  const picked = PROCUREMENTS.find(r => r.code === state.procurementId);
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
              onPick={() => onChange({ ...state, shipment: 'without', shipmentId: null, shipmentLabel: null, shipmentPi: null, shipmentDate: null })}
            />
          </div>

          {state.shipment === 'with' && (
            <div className="sdx-field">
              <div className="sdx-lbl">{IcoTruck} Select Shipment ID <span className="sdx-req">*</span></div>
              <DirectSpiPicker
                rows={ships.rows}
                loading={ships.loading}
                error={ships.error}
                onRetry={ships.retry}
                value={state.shipmentId}
                pickedRow={state.shipmentId ? { code: state.shipmentId, title: state.shipmentLabel ?? '', sub: state.shipmentDate ?? '' } : null}
                onPick={code => {
                  const r = ships.rows.find(x => x.code === code);
                  onChange({ ...state, shipmentId: code, shipmentLabel: r?.title ?? null, shipmentPi: r?.piNumber ?? null, shipmentDate: r?.sub || null });
                }}
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
