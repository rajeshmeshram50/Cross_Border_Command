/**
 * Stage 04 · Step 01 — Review Box Details.
 *
 * The box exactly as Stage 03 closed it, read-only, so the person about to
 * give it a location can check they are holding the right carton before they
 * commit a slot to it. Four blocks, in the order the prototype has them:
 *
 *   1. the identity band — id, scenario, packing date, status, sticker
 *   2. Box Core Details — the measurements, plus the ONE remark, the ONE
 *      condition and whatever flags were set
 *   3. Box Product Details — what is inside, with its batch identity
 *   4. Box Remark — the note, or NA
 *
 * It replaces a "Box Identification" card grid that showed a large sticker
 * preview and a QR before anything else: useful once, at the printer, but not
 * what you check when the carton is already in your hands.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IcoBox, IcoLines, IcoCheck, IcoTag } from '../../../icons';
import { putId } from '../spi-api';

export interface ReviewProduct {
  code: string;
  name: string;
  hsn: string;
  gst: string | null;
  qtyNum: string;
  uom: string | null;
  /** [label, value] pairs — serial, lot, batch, cat, mfg, expiry, remarks. */
  advanced: Array<[string, string | null]>;
}

const IcoPrinter = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);
const IcoNote = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IcoArrowR = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IcoWarnSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IcoColdSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" /><line x1="3" y1="7" x2="21" y2="17" />
    <line x1="21" y1="7" x2="3" y2="17" />
  </svg>
);
const IcoFragileSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h10l-1 7a4 4 0 0 1-8 0z" /><line x1="12" y1="14" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </svg>
);

/* Flags are a handling instruction, not a word list. Hazardous, cold chain and
 * fragile are the three a warehouse acts on BEFORE it commits a slot, so each
 * carries its own colour and mark; everything else stays the neutral pill.
 * The tests mirror flagNames()'s own in the stage, which lower-cases every
 * name before it reaches this component — hence the title-casing on the way
 * back out, so "cold chain" is not shouted at the operator in lower case. */
function flagTone(name: string): { cls: string; ico: ReactNode } {
  const n = name.trim().toLowerCase();
  if (n === 'hazardous') return { cls: ' is-haz', ico: <IcoWarnSm /> };
  if (n === 'cold chain') return { cls: ' is-cold', ico: <IcoColdSm /> };
  if (n === 'fragile') return { cls: ' is-fragile', ico: <IcoFragileSm /> };
  /* Everything else is a flag off the master. It keeps the neutral pill, but
     it still carries the tag mark the packing step gives it — without one a
     custom flag read as a stray word rather than a flag. */
  return { cls: '', ico: <IcoTag size={11} stroke={2.4} /> };
}

/* How many chips stay on the row. A box can carry a dozen flags and the row
   is one line in a read-only panel, so the rest go behind a counter — the
   same bargain the packing step makes with "+N more". */
const FLAGS_SHOWN = 4;

function FlagChip({ name }: { name: string }) {
  const tone = flagTone(name);
  return <span className={`s4rv-flag${tone.cls}`}>{tone.ico}{titleCase(name)}</span>;
}

function FlagRow({ flags }: { flags: string[] }) {
  const [pop, setPop] = useState<{ x: number; y: number; flipUp: boolean } | null>(null);
  const shown = flags.slice(0, FLAGS_SHOWN);
  const hidden = flags.slice(FLAGS_SHOWN);

  return (
    <>
      {shown.map(f => <FlagChip key={f} name={f} />)}
      {hidden.length > 0 && (
        <button
          type="button"
          className="s4rv-flagmore"
          aria-haspopup="dialog"
          aria-expanded={!!pop}
          onClick={e => {
            if (pop) { setPop(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            /* This row sits low in the panel, so below is usually the short
               side — flip above when the list would not fit under the chip. */
            const estH = 34 + hidden.length * 32;
            const below = window.innerHeight - r.bottom;
            const flipUp = below < estH + 12 && r.top > below;
            setPop({ x: r.left, y: flipUp ? r.top - 4 : r.bottom + 4, flipUp });
          }}
          title={`View all ${flags.length} product flags`}
        >
          +{hidden.length}
        </button>
      )}
      {pop && createPortal(
        <>
          <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 100000 }} />
          <div
            className="invf-fpop" role="dialog" aria-label="More product flags"
            style={{
              position: 'fixed',
              left: Math.max(12, Math.min(pop.x, window.innerWidth - 260 - 12)),
              top: pop.flipUp ? undefined : pop.y,
              bottom: pop.flipUp ? Math.max(12, window.innerHeight - pop.y) : undefined,
              maxHeight: pop.flipUp
                ? Math.max(140, pop.y - 16)
                : Math.max(140, window.innerHeight - pop.y - 16),
              zIndex: 100001,
            }}
          >
            <div className="invf-fpop__title">Product Flags ({flags.length})</div>
            {/* Every flag, not just the hidden ones: opened from a counter,
                the question is what this box carries, and answering with the
                tail alone makes you hold the first four in your head. */}
            {flags.map((f, i) => (
              <div key={f} className={`invf-fpop__row${i % 2 ? ' is-alt' : ''}`}>
                <FlagChip name={f} />
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());

/* Box Product names are free text and some run to 70+ characters with no
   spaces to break on, which stretched the Box Product column until the ten
   identity columns beside it were squeezed to nothing. 35 characters, with the
   whole name on hover so nothing is lost. */
const NAME_MAX = 35;
const clipName = (s: string): string =>
  s.length > NAME_MAX ? `${s.slice(0, NAME_MAX).trimEnd()}…` : s;

/** A value, or the muted dash the whole pane uses for "nothing recorded". */
const val = (v: string | null | undefined): ReactNode =>
  v && String(v).trim() && String(v).trim() !== '—'
    ? <span className="s4rv-val">{v}</span>
    : <span className="s4rv-na">&mdash;</span>;

/** yyyy-mm-dd → dd/mm/yyyy, which is how the rest of the step writes dates. */
const fmtDate = (v: string | null | undefined): string | null => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v ?? null);
};

/* The second line each chip carries in the packing step, so the two screens
   describe the same choice in the same words. */
const SUB_OF: Record<string, string> = {
  'Correct Product': 'As expected',
  'Damaged / Rejected': 'Not accepted',
  'Mismatched': 'Wrong item',
  'Extra Quantity': 'Over-supplied',
  Perfect: 'No damage',
  'Minor Damage': 'Light wear',
  'Critical Damage': 'Not usable',
};

const advOf = (p: ReviewProduct, label: string): string | null =>
  p.advanced.find(([k]) => k.toLowerCase() === label.toLowerCase())?.[1] ?? null;

function Field({ label, unit, value, auto }: {
  label: string; unit?: string; value: string | null; auto?: boolean;
}) {
  return (
    <div className={`s4rv-fld${auto ? ' is-auto' : ''}`}>
      <label className="s4rv-fld__lbl">
        {/* In its own element so it can be truncated: a bare text node in a
            flex row is anonymous and cannot take text-overflow, so "Vol.
            Weight" wrapped to a second line and dragged all seven tiles up
            with it. */}
        <span className="s4rv-fld__name">{label}</span>
        {unit && <span className="s4rv-fld__unit">{unit}</span>}
        {auto && <span className="s4rv-fld__auto">AUTO</span>}
      </label>
      <div className="s4rv-fld__v">{value && value.trim() ? value : <span className="s4rv-na">&mdash;</span>}</div>
    </div>
  );
}

export default function PutawayReviewBox({
  boxId, sectionKey, sectionLabel, scenarioNo, scenarioText, modeLabel,
  packedOn, done, core, remark, condition, flags, stackable,
  products, totalQty, note, onSticker, onNext, nextDisabled = false,
}: {
  boxId: string;
  sectionKey: 'ship' | 'inv' | 'dmg' | 'mis';
  sectionLabel: string;
  scenarioNo: string;
  scenarioText: string;
  /** "Single Box", "Box 1 of 3", "Mixed Carton". */
  modeLabel: string | null;
  packedOn: string | null;
  done: boolean;
  core: {
    length: string | null; width: string | null; height: string | null;
    weight: string | null; net: string | null; gross: string | null; vol: string | null;
    unit: string;
  };
  /** Already resolved to labels — "Correct Product", "Perfect". */
  remark: string | null;
  condition: string | null;
  flags: string[];
  stackable: boolean | null;
  products: ReviewProduct[];
  totalQty: number;
  note: string | null;
  onSticker: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="s4rv">
      {/* 1 · Box Details */}
      <div className="s4rv-hero">
        <div className="s4rv-hero__ico"><IcoBox size={22} stroke={2.1} /></div>
        <div className="s4rv-hero__tx">
          <div className="s4rv-hero__ttl">
            Box Details
            <span className={`s4rv-sec-pill s4rv-sec-pill--${sectionKey}`}>{sectionLabel}</span>
          </div>
          <div className="s4rv-hks">
            <div className="s4rv-hk">
              <span>Box ID</span>
              <b className="s4rv-mono">{putId(boxId)}</b>
            </div>
            <div className="s4rv-hk">
              <span>Box Packaging Scenario</span>
              <b>
                {scenarioNo} &middot; {scenarioText}
                {modeLabel && <em>{modeLabel}</em>}
              </b>
            </div>
            <div className="s4rv-hk">
              <span>Box Packaging Date</span>
              <b>{packedOn || '—'}</b>
            </div>
          </div>
        </div>
        <div className="s4rv-hero__r">
          {/* The one place the pane states where this box has got to. */}
          <span className={`s4rv-status${done ? ' is-done' : ''}`}>
            <i />{done ? 'Putaway Completed' : 'Putaway Pending'}
          </span>
          <div className="s4rv-stkwrap">
            <span className="s4rv-stklbl">Box Sticker</span>
            <button type="button" className="s4rv-stk" onClick={onSticker}>
              <IcoPrinter /> {putId(boxId)} Sticker
            </button>
          </div>
        </div>
      </div>

      {/* 2 · Box Core Details */}
      <div className="s4rv-sec">
        <div className="s4rv-sec__hd">
          <span className="s4rv-sec__ico"><IcoBox size={13} stroke={2.2} /></span>
          Box Core Details
        </div>
        <div className="s4rv-flds">
          <Field label="Length" unit={core.unit} value={core.length} />
          <Field label="Width" unit={core.unit} value={core.width} />
          <Field label="Height" unit={core.unit} value={core.height} />
          <Field label="Weight" unit="kg" value={core.weight} />
          <Field label="Net Weight" unit="kg" value={core.net} />
          <Field label="Gross Weight" unit="kg" value={core.gross} />
          <Field label="Vol. Weight" unit="kg" value={core.vol} auto />
        </div>
        {/* Only what was chosen. The packing form shows all four remarks and
            all three conditions because you are picking one; here the choice
            has been made, so the rest would be noise. */}
        <div className="s4rv-marks">
          <div className="s4rv-mark">
            <span className="s4rv-mark__lbl">Product Remark</span>
            {remark
              ? (
                <span className="s4rv-mark__v is-ok">
                  <b>{remark}</b>
                  {SUB_OF[remark] && <em>{SUB_OF[remark]}</em>}
                </span>
              )
              : <span className="s4rv-napill">NA</span>}
          </div>
          <div className="s4rv-mark">
            <span className="s4rv-mark__lbl">Box Condition</span>
            {condition
              ? (
                <span className={`s4rv-mark__v${condition === 'Perfect' ? ' is-ok' : ' is-warn'}`}>
                  <b>{condition}</b>
                  {SUB_OF[condition] && <em>{SUB_OF[condition]}</em>}
                </span>
              )
              : <span className="s4rv-napill">NA</span>}
          </div>
          <div className="s4rv-mark s4rv-mark--flags">
            <span className="s4rv-mark__lbl">Product Flags</span>
            <span className="s4rv-flagwrap">
              {flags.length
                ? <FlagRow flags={flags} />
                : <span className="s4rv-napill">NA</span>}
              {/* The switch reads as one control with its label inside, the
                  way the packing step shows it — not a loose toggle next to
                  a word. It is read-only here. */}
              {stackable != null && (
                <span className={`s4rv-stack${stackable ? ' is-on' : ''}`}>
                  <i />{stackable ? 'Stackable' : 'Non-Stackable'}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 3 · Box Product Details */}
      <div className="s4rv-sec">
        <div className="s4rv-sec__hd">
          <span className="s4rv-sec__ico"><IcoLines size={13} stroke={2.2} /></span>
          Box Product Details
          <span className="s4rv-sec__cnt">
            {products.length} SKU{products.length === 1 ? '' : 's'} &middot; {totalQty} units
          </span>
        </div>
        <div className="s4rv-tblwrap">
          <table className="s4rv-ptbl">
            <thead>
              <tr>
                <th>Sr. No</th><th>Box Product</th><th>Box Qty</th><th>UOM</th>
                <th>Serial No.</th><th>LOT No.</th><th>Batch No.</th><th>CAT No.</th>
                <th>MFG Date</th><th>Expiry Date</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.code + i}>
                  <td><span className="s4rv-sr">{i + 1}</span></td>
                  <td className="s4rv-prodcell">
                    <div className="s4rv-pn" title={p.name.length > NAME_MAX ? p.name : undefined}>{clipName(p.name)}</div>
                    <div className="s4rv-pm">
                      <span className="s4rv-pcode">{p.code}</span>
                      <span>HSN {p.hsn}</span>
                      {p.gst != null && <>
                        <span className="s4rv-pdot">&middot;</span>
                        <span>GST {p.gst}%</span>
                      </>}
                    </div>
                  </td>
                  <td><span className="s4rv-qty">{p.qtyNum}</span></td>
                  <td><span className="s4rv-uom">{p.uom || 'Units'}</span></td>
                  <td>{val(advOf(p, 'Serial no.'))}</td>
                  <td>{val(advOf(p, 'Lot no.'))}</td>
                  <td>{val(advOf(p, 'Batch no.'))}</td>
                  <td>{val(advOf(p, 'Cat no.'))}</td>
                  <td>{val(fmtDate(advOf(p, 'Mfg date')))}</td>
                  <td>{val(fmtDate(advOf(p, 'Expiry date')))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4 · Box Remark */}
      <div className="s4rv-sec">
        <div className="s4rv-sec__hd">
          <span className="s4rv-sec__ico"><IcoNote /></span>
          Box Remark
        </div>
        <div className={`s4rv-remark${note ? '' : ' is-empty'}`}>{note || 'NA'}</div>
      </div>

      <div className="s4rv-foot">
        <span />
        <button type="button" className="s4rv-next" onClick={onNext} disabled={nextDisabled}>
          {done ? <><IcoCheck size={13} stroke={2.6} /> Location allocated</> : <>Select Putaway Location <IcoArrowR /></>}
        </button>
      </div>
    </div>
  );
}
