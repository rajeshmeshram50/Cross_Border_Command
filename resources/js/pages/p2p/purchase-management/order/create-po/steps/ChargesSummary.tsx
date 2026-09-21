// Step 02 · Additional charges and the running totals for the PO.
// The three charge fields are the only inputs; everything else adds up.
import { FitText } from '../form-fields';

export type Charges = { ship: string; pack: string; other: string };

export const EMPTY_CHARGES: Charges = { ship: '', pack: '', other: '' };

export const chargesTotal = (c: Charges) =>
  (Number(c.ship) || 0) + (Number(c.pack) || 0) + (Number(c.other) || 0);

const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  base: number;
  gst: number;
  charges: Charges;
  onChange: (patch: Partial<Charges>) => void;
};

export default function ChargesSummary({ base, gst, charges, onChange }: Props) {
  const total = chargesTotal(charges);

  return (
    <div className="cpd-sum">
      <div className="cpd-sum__charges">
        <div className="cpd-sum__hd">Additional Charges</div>
        <div className="cpd-chg-grid">
          <Charge label="Shipping Charges" value={charges.ship} onChange={(v) => onChange({ ship: v })} />
          <Charge label="Packaging Charges" value={charges.pack} onChange={(v) => onChange({ pack: v })} />
          <Charge label="Other Charges" value={charges.other} onChange={(v) => onChange({ other: v })} />
        </div>
      </div>

      <div className="cpd-totbox">
        <TotRow label="Product Cost (Without GST)" value={money(base)} />
        <TotRow label="Total GST Amount" value={money(gst)} />
        <TotRow label="Total Charges" value={money(total)} />
        <TotRow label="Grand Total" value={money(base + gst + total)} grand />
      </div>
    </div>
  );
}

/* No visible limit — the summary shows long totals as "…" with the full value
   on hover. 12 digits is only a safety net: past ~15 a JavaScript number
   can't hold the value exactly. type="number" ignores maxLength, so the
   ceiling is applied to the value. */
const CHARGE_DIGITS = 12;
const capCharge = (raw: string) => {
  const [whole = '', frac] = raw.split('.');
  return frac === undefined ? whole.slice(0, CHARGE_DIGITS) : `${whole.slice(0, CHARGE_DIGITS)}.${frac.slice(0, 2)}`;
};

function Charge({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cpd-chg-f">
      <label>{label}</label>
      <div className="cpd-chg-inwrap">
        <span className="cpd-chg-cur">₹</span>
        <input
          className="cpd-chg-in"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(capCharge(e.target.value))}
        />
      </div>
    </div>
  );
}

function TotRow({ label, value, grand }: { label: string; value: string; grand?: boolean }) {
  return (
    <div className={`cpd-totrow ${grand ? 'cpd-totrow--grand' : ''}`}>
      <div className="cpd-totrow__k">{label}</div>
      <div className="cpd-totrow__v"><FitText text={value} /></div>
    </div>
  );
}
