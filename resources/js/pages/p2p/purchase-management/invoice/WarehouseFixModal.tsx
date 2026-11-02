import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StorageWarehouse } from './types';
import type { WarehouseEligibility } from './spi-api';
import '../../storage-modal.css';

/** "No cold-chain / hazardous-goods zone" for an incompatible warehouse. */
const reasonFor = (elig: WarehouseEligibility, apiId: number | undefined): string | null => {
  const e = apiId == null ? undefined : elig.warehouses[String(apiId)];
  if (!e || e.compatible) return null;
  return 'No ' + e.missing.map(m => m.replace(/^a /, '')).join(' / ');
};

/**
 * Stage 03 -> 04 move blocker: the current warehouse can't hold the boxes.
 * The compatible warehouse is picked RIGHT HERE and applied inline — no
 * redirect to the storage-selection modal.
 */
export default function WarehouseFixModal({
  missing, currentName, warehouses, eligibility, busy, onCancel, onConfirm,
}: {
  missing: string[];
  currentName: string | null;
  warehouses: StorageWarehouse[];
  eligibility: WarehouseEligibility;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (warehouseApiId: number) => void;
}) {
  const [pick, setPick] = useState<StorageWarehouse | null>(null);
  const [open, setOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  const need = missing.map(m => m.replace(/^a /, '')).join(' and ');
  const compatibleCount = warehouses.filter(w => !reasonFor(eligibility, w.apiId)).length;

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ddRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return createPortal(
    <div className="whfix-backdrop" onClick={e => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <div className="whfix-box" role="dialog" aria-modal="true" aria-label="Change warehouse">
        <div className="whfix-head">
          <span className="whfix-ico"><i className="ri-alert-line" /></span>
          <div>
            <div className="whfix-title">Warehouse can’t hold these boxes</div>
            <div className="whfix-sub">Pick a warehouse with the right zone to continue to putaway.</div>
          </div>
          <button type="button" className="whfix-x" onClick={onCancel} disabled={busy} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="whfix-body">
          <p className="whfix-msg">
            This invoice has boxes that need <b>{need}</b>, but{' '}
            {currentName ? <b>{currentName}</b> : 'the selected warehouse'} has none.
          </p>

          <label className="whfix-label">Change warehouse</label>
          <div className={`whfix-dd${open ? ' is-open' : ''}`} ref={ddRef}>
            <button
              type="button" className="whfix-dd-trig" disabled={busy}
              aria-haspopup="listbox" aria-expanded={open}
              onClick={() => setOpen(o => !o)}
            >
              {pick
                ? <span className="whfix-dd-val"><i className="ri-building-2-line" /><b>{pick.name}</b>{pick.code ? <span className="whfix-dd-code">{pick.code}</span> : null}</span>
                : <span className="whfix-dd-ph">Select a compatible warehouse…</span>}
              <i className="ri-arrow-down-s-line whfix-dd-chev" />
            </button>

            {open && (
              <div className="whfix-dd-panel" role="listbox">
                {warehouses.map(w => {
                  const reason = reasonFor(eligibility, w.apiId);
                  const selected = pick?.id === w.id;
                  return (
                    <button
                      key={w.id} type="button" role="option" aria-selected={selected} aria-disabled={!!reason}
                      className={`whfix-dd-opt${reason ? ' is-blocked' : ''}${selected ? ' is-sel' : ''}`}
                      onClick={() => { if (reason) return; setPick(w); setOpen(false); }}
                    >
                      <span className="whfix-dd-opt-main">
                        <span className="whfix-dd-opt-name">{w.name}</span>
                        {w.code && <span className="whfix-dd-opt-code">{w.code}</span>}
                      </span>
                      {reason
                        ? <span className="whfix-dd-opt-reason"><i className="ri-close-circle-line" /> {reason}</span>
                        : <i className="ri-check-line whfix-dd-opt-ok" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {compatibleCount === 0 && (
            <div className="whfix-none">
              No warehouse has the required zone. Add one in Inventory Management → Warehouse Master, then try again.
            </div>
          )}
        </div>

        <div className="whfix-foot">
          <button type="button" className="whfix-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button" className="whfix-btn-primary"
            disabled={!pick || busy}
            onClick={() => { if (pick?.apiId != null) onConfirm(pick.apiId); }}
          >
            {busy ? <><span className="whfix-spin" aria-hidden />Changing…</> : 'Change warehouse & continue'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
