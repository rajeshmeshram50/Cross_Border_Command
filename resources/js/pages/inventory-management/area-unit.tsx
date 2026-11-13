import { MasterSelect } from '../../components/ui/MasterSelect';
import './area-unit.css';

/* Area unit picker shared by the Warehouse, Zone, Rack and Shelf forms
   (Sq. Ft · Sq. M · Sq. Cm). The API and every stored area stay in square
   feet (area_sqft); the picker only changes the unit a figure is typed and
   read in, and SQFT_PER converts both ways. */
export type AreaUnit = 'sqft' | 'sqm' | 'sqcm';

const SQFT_PER_SQM = 10.7639;
export const SQFT_PER: Record<AreaUnit, number> = { sqft: 1, sqm: SQFT_PER_SQM, sqcm: SQFT_PER_SQM / 10000 };
export const AREA_LABEL: Record<AreaUnit, string> = { sqft: 'Sq. Ft', sqm: 'Sq. M', sqcm: 'Sq. Cm' };
export const AREA_DP: Record<AreaUnit, number> = { sqft: 0, sqm: 2, sqcm: 0 };

/* A length unit's square. Picking Cm / Metres / Feet for a form's dimensions
   sets its area boxes to Sq. Cm / Sq. M / Sq. Ft, so both read alike. */
export const AREA_FOR: Record<'cm' | 'm' | 'ft', AreaUnit> = { cm: 'sqcm', m: 'sqm', ft: 'sqft' };

const roundTo = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Sq ft → the unit's figure, rounded to that unit's decimals. */
export const fromSqft = (sqft: number, u: AreaUnit) => roundTo(sqft / SQFT_PER[u], AREA_DP[u]);
/** The unit's figure → sq ft. */
export const toSqft = (v: number, u: AreaUnit) => v * SQFT_PER[u];
/** A sq-ft figure written in the unit: 401 → "37.25" (Sq. M). */
export const areaNum = (sqft: number, u: AreaUnit) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: AREA_DP[u] }).format(sqft / SQFT_PER[u]);
/** The same with its unit: "37.25 Sq. M". */
export const areaText = (sqft: number, u: AreaUnit) => `${areaNum(sqft, u)} ${AREA_LABEL[u]}`;
/** A typed figure carried over to another unit, so switching keeps the size. */
export const convertTyped = (typed: string, from: AreaUnit, to: AreaUnit) => {
  const n = Number(typed);
  if (typed.trim() === '' || !Number.isFinite(n)) return typed;
  return String(roundTo(n * SQFT_PER[from] / SQFT_PER[to], AREA_DP[to]));
};

const OPTIONS = (Object.keys(AREA_LABEL) as AreaUnit[]).map(u => ({ value: u, label: AREA_LABEL[u] }));

/** The suffix box beside an area input, as the app's own dropdown. */
export function AreaUnitPicker({ value, onChange }: { value: AreaUnit; onChange: (u: AreaUnit) => void }) {
  return (
    /* A div, not a span: `.whm-suf > span` is the old static suffix chip
       (padding, fill, border) and would wrap the toggle in a second box. */
    <div className="iam-areaunit">
      <MasterSelect
        value={value}
        options={OPTIONS}
        searchable={false}
        menuClassName="iam-areaunit-menu"
        onChange={v => { if (v && v !== value) onChange(v as AreaUnit); }}
      />
    </div>
  );
}
