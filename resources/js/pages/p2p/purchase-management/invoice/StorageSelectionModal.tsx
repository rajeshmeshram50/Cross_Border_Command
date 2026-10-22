import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import {
  IcoCase, IcoCheck, IcoChevronL, IcoChevronR, IcoPin, IcoTag, IcoWarehouse, IcoX,
} from '../../icons';
import { formatDmy } from '../../../../utils/formatDmy';
import type { StorageWarehouse } from './types';
import '../../storage-modal.css';

/** Where the invoice's goods will be staged. */
export type StorageType = 'own' | 'third-party';

/** What the wizard hands back once it is done. */
export interface StorageChoice {
  type: StorageType;
  /** The chosen site — only ever set when `type` is 'own'. */
  warehouse?: StorageWarehouse;
}

/** The wizard's three screens, in order. */
const STEPS = ['Storage Type', 'Select Warehouse', 'Confirm'] as const;

const STORAGE_LABEL: Record<StorageType, string> = {
  'own': 'Our Warehouse',
  'third-party': 'Third Party Warehouse',
};

/**
 * Temporary Storage Selection — the wizard that opens once an invoice has been
 * mapped, asking where its goods will sit before putaway.
 *
 * Steps 1 (storage type) and 2 (warehouse) are built. Step 3 (confirm) is not,
 * but the stepper renders all three from the first screen: a wizard that
 * reveals its steps one at a time hides how long the flow is.
 *
 * Portalled to document.body for the same reason as MapInvoiceModal — inside
 * the page it would sit within `.ord-table-scroll`, whose `overflow-x: auto`
 * clips any descendant, so the dialog would be cut off at the table's edge and
 * scroll sideways with the columns.
 */
export default function StorageSelectionModal({
  reference, referenceKind, warehouses, warehousesState = 'ready', onClose, onNext,
}: {
  /** The PO or supplier the invoice was mapped to — the head chip. */
  reference: string;
  /** Which of the two it is. The short form labels the chip and the long form
   *  labels step 3's first row, so this is one prop rather than two strings
   *  the caller could let disagree. */
  referenceKind: 'po' | 'supplier';
  /** Our own sites, for step 2. Passed in rather than imported, so the wizard
   *  holds no data of its own and swapping the fixture for an API response
   *  touches the page, not this file. */
  warehouses: StorageWarehouse[];
  warehousesState?: 'idle' | 'loading' | 'ready' | 'failed';
  onClose: () => void;
  onNext: (choice: StorageChoice) => void;
}) {
  const [step, setStep] = useState(1);
  /* Nothing is pre-selected on either screen: the two types lead to different
     putaway flows, so a default would quietly answer the question for anyone
     clicking straight through. */
  const [type, setType] = useState<StorageType | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  /* Locks the page behind the dialog. The shared hook locks <html> as well as
     <body> — a body-only lock does not stop the background scrolling. */
  useScrollLock(true);

  const warehouse = warehouses.find(w => w.id === warehouseId);

  /* A 3PL is someone else's building, so there is no site of OURS to pick:
     that path runs 1 → 3 and step 2 never appears. Both directions have to
     agree about it, which is why it is named once here. */
  const skipsWarehouse = type === 'third-party';

  /* What the current step still needs before Next means anything. Step 3 only
     reviews, so it is always ready. */
  const canAdvance = step === 1 ? !!type : step === 2 ? !!warehouseId : true;

  const advance = () => {
    if (!canAdvance || !type) return;
    if (step === 3) { onNext({ type, warehouse }); return; }
    setStep(step === 1 && skipsWarehouse ? 3 : step + 1);
  };

  /* Going back clears what step 2 collected. Keeping a stale warehouse while
     the user reconsiders the storage type is how you end up submitting a site
     that was chosen under a different answer. */
  const back = () => {
    const to = step === 3 && skipsWarehouse ? 1 : step - 1;
    if (to === 1) setWarehouseId(null);
    setStep(to);
  };

  return createPortal(
    /* The backdrop closes on click, the dialog does not. Guarding on the target
       rather than calling stopPropagation inside means the dialog's own content
       needs no knowledge that it is in a modal. */
    <div
      className="smod-backdrop is-open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="smod-box" role="dialog" aria-modal="true" aria-labelledby="smod-title">
        <div className="smod-head">
          <div className="smod-head-ico"><IcoWarehouse size={19} stroke={2.2} /></div>
          <div className="smod-head-text">
            <div className="smod-head-title" id="smod-title">Temporary Storage Selection</div>
            <div className="smod-head-sub">Choose where this invoice&rsquo;s goods will be stored</div>
          </div>
          <div className="smod-head-right">
            <div className="smod-head-badge" title={referenceKind === 'po' ? 'PO' : 'Supplier'}>
              {reference}
            </div>
            <button type="button" className="smod-close" onClick={onClose} aria-label="Close">
              <IcoX size={13} stroke={2.6} />
            </button>
          </div>
        </div>

        <div className="smod-steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n === step ? ' is-active' : n < step ? ' is-done' : '';
            return (
              /* step / line / step alternate as siblings of one flex row — the
                 line's fill is driven by `.is-done + .smod-step-line`, so it
                 must be the step's actual next sibling and cannot be nested
                 inside a wrapper. Hence a keyed Fragment. */
              <Fragment key={label}>
                <div className={`smod-step${state}`}>
                  <div className="smod-step-num">
                    <span className="smod-step-digit">{n}</span>
                    {/* Revealed by the is-done rules, which cross-fade it with
                        the digit — so it is always in the DOM. */}
                    <IcoCheck size={17} stroke={3} className="smod-step-check" />
                  </div>
                  <div className="smod-step-txt">
                    {/* Deliberately EMPTY. The caption word comes from
                        `.smod-step-cap::after`, which switches between Pending,
                        In progress and Completed off the step's state class.
                        Text here would render twice. */}
                    <span className="smod-step-cap" />
                    <span className="smod-step-label">{label}</span>
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className="smod-step-line" />}
              </Fragment>
            );
          })}
        </div>

        {step === 1 && (
        <div className="smod-body">
          <div className="smod-question">Where will this invoice&rsquo;s goods be temporarily stored?</div>
          <div className="smod-desc">
            Select the temporary storage type for the goods linked to this supplier invoice.
            This determines putaway flow and Digital Warehouse availability.
          </div>

          <div className="smod-cards" role="radiogroup" aria-label="Storage type">
            <StorageCard
              selected={type === 'own'}
              onSelect={() => setType('own')}
              icon={<IcoWarehouse size={19} stroke={2.2} />}
              title={STORAGE_LABEL['own']}
              sub="Full putaway flow with Digital Warehouse &amp; live rack tracking."
              features={[
                [true, 'Full temporary putaway flow'],
                [true, 'Rack → Shelf → Box allocation'],
                [true, 'Digital Warehouse available'],
                [true, 'Live putaway status tracking'],
              ]}
            />
            {/* Not built yet: the 3PL flow has no warehouse step and no
                summary behind it, so choosing it would lead nowhere. Shown
                greyed rather than removed, so the option is known to be
                coming. */}
            <StorageCard
              disabled
              selected={type === 'third-party'}
              onSelect={() => setType('third-party')}
              /* Slate, not teal. A 3PL is someone else's building, and the
                 colour says so before the title does. The exact gradient the
                 prototype sets inline on this one tile; everything else about
                 the tile comes from `.smod-card-ico`. */
              iconStyle={{ background: 'linear-gradient(135deg,#64748B,#475569)' }}
              icon={<IcoCase size={19} stroke={2.2} />}
              title={STORAGE_LABEL['third-party']}
              sub="External logistics partner (3PL). Summary-only view."
              features={[
                [true, 'External storage confirmed'],
                [true, 'Summary-only Digital Warehouse'],
                [false, 'No rack/shelf allocation'],
                [false, 'Limited live tracking'],
              ]}
            />
          </div>
        </div>
        )}

        {step === 2 && (
        <div className="smod-body">
          <div className="smod-question">Select Warehouse</div>
          <div className="smod-desc">
            Choose the warehouse where this invoice&rsquo;s goods will be temporarily staged.
          </div>

          {/* A chooser, not a list. Every site was laid out in full whether or
              not it was the one wanted, so the step grew with the number of
              warehouses and the choice already made scrolled off the screen.
              Closed it shows the one that was picked; open, all of them. */}
          <WarehousePicker
            warehouses={warehouses}
            state={warehousesState}
            value={warehouseId}
            onChange={setWarehouseId}
          />
        </div>
        )}

        {step === 3 && type && (
        <div className="smod-body">
          <div className="smod-question">Confirm Storage Assignment</div>
          <div className="smod-desc">
            Review your selections before continuing to the invoice details.
          </div>

          <div className="smod-confirm-list">
            <ConfirmRow
              icon={<IcoTag />}
              label={referenceKind === 'po' ? 'Purchase Order' : 'Supplier'}
              value={reference}
            />
            <ConfirmRow
              icon={<IcoWarehouse />}
              label="Storage Type"
              value={STORAGE_LABEL[type]}
              sub={type === 'own'
                ? 'Full temporary putaway flow with Digital Warehouse enabled'
                : 'External logistics partner (3PL)'}
            />
            {/* A 3PL has no site of ours, so this row states that rather than
                showing a blank where a warehouse would be. */}
            <ConfirmRow
              icon={<IcoPin />}
              label="Warehouse"
              value={type === 'own' ? (warehouse?.name ?? '—') : 'External — Third Party'}
              sub={type === 'own' ? warehouse?.location : 'Managed by logistics partner'}
            />
          </div>
        </div>
        )}

        <div className="smod-footer">
          <div className="smod-hint">
            {step === 1
              ? (type ? `Selected: ${STORAGE_LABEL[type]}` : 'Select a storage type to continue')
              : step === 2
                ? (warehouseId ? 'Warehouse selected' : 'Choose a warehouse')
                : 'Review and confirm your selection'}
          </div>
          <div className="smod-footer-btns">
            {/* Back appears only from step 2 on — on step 1 there is nowhere to
                go back to, and a dead button is worse than no button. */}
            {step > 1 && (
              <button type="button" className="smod-back" onClick={back}>
                <IcoChevronL size={11} stroke={2.6} /> Back
              </button>
            )}
            <button type="button" className="smod-cancel" onClick={onClose}>Cancel</button>
            {/* `.disabled` is a class, not the attribute — the stylesheet dims
                it and sets pointer-events: none. aria-disabled carries the same
                fact to a screen reader, which a class cannot. */}
            <button
              type="button"
              className={`smod-next${canAdvance ? '' : ' disabled'}`}
              aria-disabled={!canAdvance}
              onClick={advance}
            >
              {/* The last step's button names where it goes, because it leaves
                  the wizard rather than moving inside it. */}
              {step === 3 ? 'Continue to Invoice' : 'Next'}
              <IcoChevronR size={11} stroke={2.6} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One line of step 3's summary.
 *
 * No size prop on the icon: `.smod-confirm-ico svg` fixes it at 16px, the same
 * way step 2's tile sizes its own glyph.
 */
function ConfirmRow({
  icon, label, value, sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="smod-confirm-row">
      <div className="smod-confirm-ico">{icon}</div>
      <div className="smod-confirm-main">
        <div className="smod-confirm-label">{label}</div>
        <div className="smod-confirm-val">{value}</div>
        {sub && <div className="smod-confirm-sub">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * One of our sites, as a row in step 2.
 *
 * The AVAILABLE badge is static for now: capacity is not modelled yet, and a
 * row that cannot be chosen would need a disabled state the design does not
 * show. When occupancy arrives this is the one place that changes.
 */
/** City, state and postcode as one line. */
const whWhere = (w: StorageWarehouse) =>
  [w.location, w.pincode].filter(Boolean).join(', ');

const sqft = (n?: number) =>
  n == null ? null : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** One site, laid out in full — what the open list shows. */
function WarehouseRow({
  warehouse: w, selected, onSelect,
}: {
  warehouse: StorageWarehouse;
  selected: boolean;
  onSelect: () => void;
}) {
  const area = sqft(w.areaSqft);
  return (
    <div
      className={`smod-wh-row${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
    >
      <span className="smod-wh-id">
        <span className="smod-wh-code">{w.code ?? '—'}</span>
        {w.addedOn && <span className="smod-wh-since">{formatDmy(w.addedOn)}</span>}
      </span>
      {/* No size prop: `.smod-wh-ico svg` sizes the glyph at 18px. */}
      <div className="smod-wh-ico"><IcoWarehouse stroke={2.2} /></div>
      <div className="smod-wh-text">
        <div className="smod-wh-name">{w.name}</div>
        {/* Street first, then the place. Two sites in one city are told apart
            by the street and nothing else. */}
        {w.address && <div className="smod-wh-addr">{w.address}</div>}
        <div className="smod-wh-loc"><IcoPin size={12} /> {whWhere(w)}</div>
      </div>
      <span className="smod-wh-badge">
        <IcoWarehouse size={12} stroke={2.2} />
        {w.kind === 'tpl' ? 'Third Party' : 'Own Warehouse'}
      </span>
      <span className="smod-wh-area">
        {area ? <><b>{area}</b> Sq. Ft</> : <span className="smod-wh-dash">—</span>}
      </span>
    </div>
  );
}

/**
 * Step 2's warehouse chooser: closed it names the chosen site, open it lists
 * them all. The panel is inline rather than portalled — this modal does not
 * clip its own body, and a panel in the flow pushes the footer down instead
 * of floating over it.
 */
function WarehousePicker({
  warehouses, state, value, onChange,
}: {
  warehouses: StorageWarehouse[];
  state: 'idle' | 'loading' | 'ready' | 'failed';
  /** Null until a site is picked; Back clears it. */
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const picked = warehouses.find(w => w.id === value) ?? null;

  /* Below the trigger, or above it when the dialog sits low on a short
     screen and there is more room up there. */
  const place = useCallback(() => {
    const t = trigRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const cap = Math.min(340, window.innerHeight - 24);
    setPos(below >= 240 || below >= above
      ? { left: r.left, width: r.width, top: r.bottom + 8, maxHeight: Math.max(180, Math.min(cap, below)) }
      : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 8, maxHeight: Math.max(180, Math.min(cap, above)) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);
  const area = sqft(picked?.areaSqft);

  const message = state === 'loading' || state === 'idle' ? 'Loading warehouses…'
    : state === 'failed' ? 'Could not load warehouses. Close this window and try again.'
    : warehouses.length === 0 ? 'No active own warehouses yet. Add one in Inventory Management → Warehouse Master.'
    : null;

  return (
    <div className={`smod-wh-pick${open ? ' is-open' : ''}`}>
      <button
        type="button" ref={trigRef} className="smod-wh-trig"
        aria-haspopup="listbox" aria-expanded={open}
        disabled={!!message}
        onClick={() => setOpen(o => !o)}
      >
        {picked ? (
          <>
            <span className="smod-wh-code">{picked.code ?? '—'}</span>
            <span className="smod-wh-ico"><IcoWarehouse stroke={2.2} /></span>
            <span className="smod-wh-text">
              <span className="smod-wh-name">{picked.name}</span>
              <span className="smod-wh-loc"><IcoPin size={12} /> {whWhere(picked)}</span>
            </span>
            {area && <span className="smod-wh-area"><b>{area}</b> Sq. Ft</span>}
          </>
        ) : (
          <span className="smod-wh-ph">{message ?? 'Select a warehouse…'}</span>
        )}
        <span className="smod-wh-chev"><IcoChevronR size={13} /></span>
      </button>

      {/* Portalled and measured against the trigger. The dialog clips its own
          overflow for its rounded corners, and an inline panel grew the dialog
          and pushed the footer down as it opened — the design keeps the dialog
          exactly the size it was and lays the list over it. */}
      {open && !message && pos && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 4000 }} />
          <div
            className="smod-wh-panel" role="listbox"
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          >
            {warehouses.map(w => (
              <WarehouseRow
                key={w.id}
                warehouse={w}
                selected={w.id === value}
                onSelect={() => { onChange(w.id); setOpen(false); }}
              />
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

/** One storage option. */
function StorageCard({
  selected, onSelect, icon, iconStyle, title, sub, features, disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  iconStyle?: React.CSSProperties;
  title: string;
  sub: string;
  /** [provided, label] — a tick when this type offers it, a cross when it does not. */
  features: Array<[boolean, string]>;
  /** Not built yet. The card still shows what it will offer, greyed, with a
   *  "Coming soon" tag — hiding it would leave no sign the option exists. */
  disabled?: boolean;
}) {
  return (
    <div
      className={`smod-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={() => { if (!disabled) onSelect(); }}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      title={disabled ? `${title} is not available yet` : undefined}
      tabIndex={disabled ? -1 : 0}
      /* A div with a click handler is invisible to the keyboard. These two keys
         make it behave like the radio it is standing in for; the card cannot be
         a real <input> because the whole tile is the hit area. */
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
    >
      <div className="smod-card-top">
        <div className="smod-card-ico" style={iconStyle}>{icon}</div>
        {disabled ? <span className="smod-soon">Coming soon</span> : <div className="smod-card-radio" />}
      </div>
      <div className="smod-card-title">{title}</div>
      <div className="smod-card-sub">{sub}</div>
      <div className="smod-card-divider" />
      {features.map(([provided, label]) => (
        <div className="smod-feature" key={label}>
          <div className={`smod-feature-dot smod-feature-dot--${provided ? 'yes' : 'no'}`}>
            {provided ? <IcoCheck size={9} stroke={3.4} /> : <IcoX size={9} stroke={3.4} />}
          </div>
          {label}
        </div>
      ))}
    </div>
  );
}
