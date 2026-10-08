import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoCheck, IcoThermometer, IcoWarn, IcoX } from '../../../icons';

/** A cold-chain band, as a pair of °C limits. */
export interface TempRange {
  min: string;
  max: string;
}

/**
 * The standard cold-chain bands, coldest last.
 *
 * Presets rather than free entry alone: these four cover almost every
 * shipment, and typing −40 to −25 by hand is how a digit goes missing. The
 * fields stay editable for the cases they do not cover.
 */
export const TEMP_PRESETS = [
  { id: 'chilled', label: 'Chilled', min: 2, max: 8 },
  { id: 'cool', label: 'Cool', min: 8, max: 15 },
  { id: 'frozen', label: 'Frozen', min: -25, max: -18 },
  { id: 'deep', label: 'Deep Frozen', min: -40, max: -25 },
] as const;

/** How a set range reads on the Cold Chain chip. */
export const formatRange = (r: TempRange) =>
  r.min !== '' && r.max !== '' ? `${r.min}…${r.max}°C` : '';

/**
 * Temperature Range — opened by the Cold Chain flag.
 *
 * A box that has to stay cold has to say how cold, so this is asked for the
 * moment the flag goes on rather than left as an empty row on every other
 * box. Portalled to document.body: the drawer sits in a table cell, and
 * `.vti-table-wrap`'s `overflow-x: auto` clips any descendant.
 */
export default function TemperatureModal({
  range, onApply, onCancel,
}: {
  range: TempRange;
  onApply: (r: TempRange) => void;
  /** Closing without a range turns the Cold Chain flag back off. */
  onCancel: () => void;
}) {
  const [min, setMin] = useState(range.min);
  const [max, setMax] = useState(range.max);

  useScrollLock(true);

  /* Which preset the current pair matches. Derived rather than stored: two
     sources for one fact is how a chip stays lit on a range it no longer
     describes. */
  const activePreset = TEMP_PRESETS.find(
    p => String(p.min) === min && String(p.max) === max,
  )?.id;

  const numeric = min !== '' && max !== '' && !Number.isNaN(Number(min)) && !Number.isNaN(Number(max));
  /* A minimum above its maximum is not a range. Equal is allowed — a box held
     at exactly one temperature is a real requirement. */
  const inverted = numeric && Number(min) > Number(max);
  const canApply = numeric && !inverted;

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="spi-mdl invf-temp" role="dialog" aria-modal="true" aria-labelledby="invf-temp-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoThermometer size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-temp-title">Temperature Range</div>
              <div className="spi-mdl-sub">This box is marked Cold Chain</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onCancel} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          <div className="invf-temp__lbl">Pick a preset</div>
          <div className="invf-temp__presets">
            {TEMP_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className={`invf-temp__preset invf-temp__preset--${p.id}${activePreset === p.id ? ' is-on' : ''}`}
                aria-pressed={activePreset === p.id}
                onClick={() => { setMin(String(p.min)); setMax(String(p.max)); }}
              >
                <span className="invf-temp__preset-name">{p.label}</span>
                <span className="invf-temp__preset-val">{p.min}…{p.max}°C</span>
              </button>
            ))}
          </div>

          <div className="invf-temp__lbl">Or set it yourself</div>
          <div className="invf-temp__row">
            <TempField value={min} onChange={setMin} placeholder="Min" label="Minimum temperature" />
            <span className="invf-temp__to">to</span>
            <TempField value={max} onChange={setMax} placeholder="Max" label="Maximum temperature" />
          </div>

          {inverted && (
            <div className="invf-temp__err" role="alert">
              <IcoWarn size={13} /> The minimum is above the maximum.
            </div>
          )}

          <div className="invf-temp__hint">
            Set the minimum and maximum temperature this box must hold, or pick a preset.
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">
            <IcoThermometer size={13} />{' '}
            {canApply ? `Holding ${min}…${max}°C` : 'No range set yet'}
          </span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className={`spi-mdl-confirm${canApply ? '' : ' is-off'}`}
              aria-disabled={!canApply}
              onClick={() => canApply && onApply({ min, max })}
            >
              <IcoCheck size={14} /> Apply Range
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A temperature in °C: thermometer, number, unit. */
function TempField({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <label className="invf-temp__field" aria-label={label}>
      <span className="invf-temp__ico"><IcoThermometer size={13} stroke={2.2} /></span>
      {/* `step="any"` because a cold-chain limit is often fractional, and the
          browser's default step of 1 rejects 2.5 on submit. */}
      <input
        type="number" step="any" className="invf-temp__inp"
        placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
      />
      <span className="invf-temp__unit">°C</span>
    </label>
  );
}
