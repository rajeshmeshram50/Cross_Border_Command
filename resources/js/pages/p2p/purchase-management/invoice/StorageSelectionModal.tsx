import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import Tooltip from '../../../../components/ui/Tooltip';
import {
  IcoCase, IcoCheck, IcoChevronL, IcoChevronR, IcoPin, IcoTag, IcoWarehouse, IcoX,
} from '../../icons';
import { formatDmy } from '../../../../utils/formatDmy';
import type { StorageWarehouse } from './types';
import '../../storage-modal.css';

export type StorageType = 'own' | 'third-party';

export interface StorageChoice {
  type: StorageType;
  warehouse?: StorageWarehouse;
}

const STEPS = ['Storage Type', 'Select Warehouse', 'Confirm'] as const;

const STORAGE_LABEL: Record<StorageType, string> = {
  'own': 'Our Warehouse',
  'third-party': 'Third Party Warehouse',
};

export default function StorageSelectionModal({
  reference, referenceKind, warehouses, warehousesState = 'ready', onClose, onNext,
}: {
  reference: string;
  referenceKind: 'po' | 'supplier';
  warehouses: StorageWarehouse[];
  warehousesState?: 'idle' | 'loading' | 'ready' | 'failed';
  onClose: () => void;
  onNext: (choice: StorageChoice) => void | boolean | Promise<boolean | void>;
}) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<StorageType | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  useScrollLock(true);

  const warehouse = warehouses.find(w => w.id === warehouseId);

  const skipsWarehouse = type === 'third-party';

  const canAdvance = step === 1 ? !!type : step === 2 ? !!warehouseId : true;

  const [leaving, setLeaving] = useState(false);

  const advance = () => {
    if (leaving || !canAdvance || !type) return;
    if (step === 3) {
      setLeaving(true);
      void Promise.resolve(onNext({ type, warehouse })).then(ok => { if (ok === false) setLeaving(false); });
      return;
    }
    setStep(step === 1 && skipsWarehouse ? 3 : step + 1);
  };

  const back = () => {
    if (leaving) return;
    const to = step === 3 && skipsWarehouse ? 1 : step - 1;
    if (to === 1) setWarehouseId(null);
    setStep(to);
  };

  return createPortal(
    <div
      className="smod-backdrop is-open"
      onClick={e => { if (!leaving && e.target === e.currentTarget) onClose(); }}
    >
      <div className="smod-box" role="dialog" aria-modal="true" aria-labelledby="smod-title">
        <div className="smod-head">
          <div className="smod-head-ico"><IcoWarehouse size={19} stroke={2.2} /></div>
          <div className="smod-head-text">
            <div className="smod-head-title" id="smod-title">Temporary Storage Selection</div>
            <div className="smod-head-sub">Choose where this invoice&rsquo;s goods will be stored</div>
          </div>
          <div className="smod-head-right">
            <Tooltip
              label={`${referenceKind === 'po' ? 'PO' : 'Supplier'}: ${reference}`}
              zIndex={10000050}>
              <div className="smod-head-badge">{reference}</div>
            </Tooltip>
            <button type="button" className="smod-close" onClick={onClose} aria-label="Close"
              disabled={leaving} title={leaving ? 'Opening the invoice — please wait' : undefined}>
              <IcoX size={13} stroke={2.6} />
            </button>
          </div>
        </div>

        <div className="smod-steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n === step ? ' is-active' : n < step ? ' is-done' : '';
            return (
              <Fragment key={label}>
                <div className={`smod-step${state}`}>
                  <div className="smod-step-num">
                    <span className="smod-step-digit">{n}</span>
                    <IcoCheck size={17} stroke={3} className="smod-step-check" />
                  </div>
                  <div className="smod-step-txt">
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
            <StorageCard
              disabled
              selected={type === 'third-party'}
              onSelect={() => setType('third-party')}
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
            {step > 1 && (
              <button type="button" className="smod-back" onClick={back} disabled={leaving}>
                <IcoChevronL size={11} stroke={2.6} /> Back
              </button>
            )}
            <button type="button" className="smod-cancel" onClick={onClose} disabled={leaving}>Cancel</button>
            <button
              type="button"
              className={`smod-next${canAdvance && !leaving ? '' : ' disabled'}`}
              aria-disabled={!canAdvance || leaving}
              aria-busy={leaving}
              onClick={advance}
            >
              {leaving
                ? <><span className="smod-spin" aria-hidden />Opening invoice…</>
                : <>{step === 3 ? 'Continue to Invoice' : 'Next'}<IcoChevronR size={11} stroke={2.6} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CONFIRM_VAL_MAX = 30;

function ConfirmRow({
  icon, label, value, sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  const long = value.length > CONFIRM_VAL_MAX;
  const val = (
    <div className="smod-confirm-val">
      {long ? `${value.slice(0, CONFIRM_VAL_MAX).trimEnd()}…` : value}
    </div>
  );
  return (
    <div className="smod-confirm-row">
      <div className="smod-confirm-ico">{icon}</div>
      <div className="smod-confirm-main">
        <div className="smod-confirm-label">{label}</div>
        {long ? <Tooltip label={value} zIndex={10000050}>{val}</Tooltip> : val}
        {sub && <div className="smod-confirm-sub">{sub}</div>}
      </div>
    </div>
  );
}

const whWhere = (w: StorageWarehouse) =>
  [w.location, w.pincode].filter(Boolean).join(', ');

const sqft = (n?: number) =>
  n == null ? null : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

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
      <div className="smod-wh-ico"><IcoWarehouse stroke={2.2} /></div>
      <div className="smod-wh-text">
        <div className="smod-wh-name">{w.name}</div>
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

function WarehousePicker({
  warehouses, state, value, onChange,
}: {
  warehouses: StorageWarehouse[];
  state: 'idle' | 'loading' | 'ready' | 'failed';
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = warehouses.find(w => w.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [open]);
  const area = sqft(picked?.areaSqft);

  const message = state === 'loading' || state === 'idle' ? 'Loading warehouses…'
    : state === 'failed' ? 'Could not load warehouses. Close this window and try again.'
    : warehouses.length === 0 ? 'No active own warehouses yet. Add one in Inventory Management → Warehouse Master.'
    : null;

  return (
    <div className={`smod-wh-pick${open ? ' is-open' : ''}`}>
      <button
        type="button" className="smod-wh-trig"
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

      {open && !message && (
        <div className="smod-wh-panel" role="listbox">
          {warehouses.map(w => (
            <WarehouseRow
              key={w.id}
              warehouse={w}
              selected={w.id === value}
              onSelect={() => { onChange(w.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StorageCard({
  selected, onSelect, icon, iconStyle, title, sub, features, disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  iconStyle?: React.CSSProperties;
  title: string;
  sub: string;
  features: Array<[boolean, string]>;
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
