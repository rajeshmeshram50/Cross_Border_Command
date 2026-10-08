import { memo } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';

export type ChainKind = 'grn' | 'qa';

/** The stage each link reports when it has completed. */
const STAGE: Record<ChainKind, { label: string; stage: string; verb: string; pill: string }> = {
  /* `pill` is the Order module's own variant for each stage — it already ships
     a green "received" and a violet "qa" pill, which is exactly what these two
     columns need. */
  grn: { label: 'GRN', stage: 'Goods Received', verb: 'Received',  pill: 'received' },
  qa:  { label: 'QA',  stage: 'QA Passed',      verb: 'Inspected', pill: 'qa' },
};

/**
 * The trailing digits of a reference — "SPI/2025-26/007" -> "007".
 *
 * The chain foot reads "Against 007", not "Against SPI/2025-26/007": the column
 * is 158px wide and the prefix is the same on every row, so it carries no
 * information while costing all the space.
 */
function sequenceOf(id: string): string {
  const match = /(\d+)\s*$/.exec(id);
  return match ? match[1] : id;
}

/**
 * One link in the receiving chain: GRN or QA.
 *
 * Both are the same card — a sequence chip and id, a date line, a stage pill
 * and what it was raised against — so they are one component with a `kind`
 * rather than two near-identical files.
 *
 * "1/1" is hard-coded because one invoice produces exactly one GRN and one QA
 * in this model; the prototype states that invariant and the data honours it.
 * It is written as a prop-less literal rather than computed from a list that
 * does not exist yet — when an invoice can carry several, this becomes
 * `${index}/${total}` and nothing else changes.
 */
function ChainCellBase({
  kind, id, date, against,
}: {
  kind: ChainKind;
  id?: string;
  date?: string;
  /** The document this link was raised against — the invoice for a GRN, the GRN for a QA. */
  against?: string;
}) {
  if (!id) return <span className="ord-dash">—</span>;

  const s = STAGE[kind];

  return (
    <div className="ord-doc__card">
      <div className="ord-doc__top">
        <span className="ord-doc__seq">{s.label} 1/1</span>
        <span className="ord-idpill">{id}</span>
      </div>

      <div className="ord-doc__meta">
        <span>{s.verb}</span>
        <span className="ord-doc__dot">·</span>
        <span>{formatDmy(date)}</span>
      </div>

      <div className="ord-doc__foot">
        <span className={`ord-pill ord-pill--${s.pill}`}>
          <span className="ord-pill__dot" />{s.stage}
        </span>
        {against && <span className="ord-doc__sub">Against {sequenceOf(against)}</span>}
      </div>
    </div>
  );
}

export const ChainCell = memo(ChainCellBase);
