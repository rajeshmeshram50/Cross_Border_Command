import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../../components/ui/Tooltip';
import { IcoBox, IcoPencil, IcoPrinter } from '../../../icons';
import { truncateName, NAME_MAX, type ProductLine } from '../invoice-products';
import BoxStickerModal from './BoxStickerModal';
import { putId } from '../spi-api';

/* Tone per label. Keyed by the resolved text rather than the stored code, so
   the table needs nothing from the save payload beyond what it already
   prints — and an unknown label falls back to neutral-good instead of
   throwing a colour at something it cannot read. */
const REMARK_TONE: Record<string, string> = {
  'Correct Product': 'is-ok',
  'Damaged / Rejected': 'is-bad',
  'Mismatched': 'is-bad',
  'Extra Quantity': 'is-warn',
};
const COND_TONE: Record<string, string> = {
  'Perfect': 'is-ok',
  'Minor Damage': 'is-warn',
  'Critical Damage': 'is-bad',
};

/** "10 × 10 × 10 cm", or a dash when the box was saved without measurements. */
const dimText = (d?: { l: number | null; w: number | null; h: number | null }) => {
  if (!d || d.l == null || d.w == null || d.h == null) return <span className="invf-pb-none">&mdash;</span>;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return <span className="invf-pb-num">{n(d.l)} &times; {n(d.w)} &times; {n(d.h)} <em>cm</em></span>;
};

/** Weight with its unit set apart, so the number reads first. */
const wtText = (v?: number | null) =>
  v == null ? <span className="invf-pb-none">&mdash;</span>
    : <span className="invf-pb-num">{String(Math.round(v * 100) / 100)} <em>kg</em></span>;

/**
 * A carton's flags: the first one, then a counter.
 *
 * Listing every flag made the column as wide as the longest set — four names
 * side by side pushed the measurements off to the right. One chip and a "+N"
 * is the pattern the rest of the app already uses for this (the Issuing
 * Authorities column in CLM, the "+N more" pills in MasterSelect), so the cell
 * stays a fixed size whatever a box carries.
 */
function FlagCell({ flags }: { flags: string[] }) {
  const [pop, setPop] = useState<{ x: number; y: number; flipUp: boolean } | null>(null);
  if (!flags.length) return <span className="invf-pb-none">&mdash;</span>;
  const [first, ...rest] = flags;
  return (
    <span className="invf-pb-flags">
      <Tooltip label={first} disabled={first.length <= 16}>
        <span className="invf-pb-flag">{first}</span>
      </Tooltip>
      {rest.length > 0 && (
        <Tooltip label={`View ${rest.length} more`}>
          <button
            type="button" className="invf-pb-flag-more"
            aria-haspopup="dialog" aria-expanded={!!pop}
            onClick={e => {
              if (pop) { setPop(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              /* Flip above when the list would not fit below — this table sits
                 at the bottom of the step, so below is usually the short side. */
              const estH = 34 + rest.length * 30;
              const below = window.innerHeight - r.bottom;
              const flipUp = below < estH + 12 && r.top > below;
              setPop({ x: r.left, y: flipUp ? r.top - 4 : r.bottom + 4, flipUp });
            }}
          >+{rest.length}</button>
        </Tooltip>
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
            {rest.map((f, i) => (
              <div key={f} className={`invf-fpop__row${i % 2 ? ' is-alt' : ''}`}>
                <span className="invf-pb-flag">{f}</span>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

/** One product inside a carton, and how much of it is in THIS carton. */
export interface PackedItem {
  line: ProductLine;
  qty: number;
}

/** A carton that has been saved, with its contents. */
export interface PackedBox {
  /** B-001 … */
  code: string;
  /** "1 Product → 1 Box", and so on. */
  scenario: string;
  /** Scenario 01 / 02 / 03. */
  scenarioNo: string;
  items: PackedItem[];
  /* The rest is what the box MEASURED, which is the point of this table:
     it is the record of a carton that has been closed, so the figures a
     warehouse argues about — size, weight, condition — belong on the row
     rather than behind a modal. All optional: a box saved before these were
     captured still lists, it just shows a dash. */
  /** Under the box id: "Box 1 of 5" in a split set, else the date packed. */
  subLabel?: string;
  packedOn?: string;
  dims?: { l: number | null; w: number | null; h: number | null };
  netWt?: number | null;
  grossWt?: number | null;
  /** Already resolved to its label — "Correct Product", "Perfect". */
  remark?: string;
  condition?: string;
  flags?: string[];
}

/* The four views this table offers, in the order the step introduces the
   scenarios. Keyed by the resolved scenario LABEL, which is what a saved box
   already carries — nothing new has to come back from the server for the
   split to work. */
const CUBE = (
  <>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </>
);

const SCN_TABS: Array<{ key: string; label: string; ico: ReactNode }> = [
  { key: 'all', label: 'All Boxes', ico: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>) },
  { key: '1 Product → 1 Box', label: '1 Product → 1 Box', ico: CUBE },
  /* One thing becoming several: a node splitting into two. The cube is kept
     for the two scenarios that end in a single carton, so the shape itself
     says how many boxes come out. */
  { key: '1 Product → Multiple Boxes', label: '1 Product → Multiple Boxes', ico: (
    <>
      <rect x="9" y="2.5" width="6" height="6" rx="1.6" />
      <rect x="2.5" y="15.5" width="6" height="6" rx="1.6" /><rect x="15.5" y="15.5" width="6" height="6" rx="1.6" />
      <path d="M12 8.5v2" /><path d="M5.5 15.5v-2a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v2" />
    </>) },
  { key: 'Multiple Products → 1 Box', label: 'Multiple Products → 1 Box', ico: CUBE },
];

/**
 * Packed Products — every carton that has been boxed, one row each.
 *
 * A packed product LEAVES the table above and appears here, so the top table
 * is always the work still to do and this one is the work already done.
 *
 * The row is the CARTON, not the product. A product-first list has to say
 * "P-104, and its five boxes", which puts the same five cartons down one cell
 * and leaves nothing on the row to act on — while a mixed carton appears twice
 * with no way to tell it is one box. One row per box answers the question the
 * floor actually asks: what is in B-001?
 */
export default function PackedProducts({
  boxes, onEditBox, editingBoxId = null,
}: {
  boxes: PackedBox[];
  /** Open a saved carton. Unambiguous now: the row IS the carton. */
  onEditBox?: (boxId: string) => void;
  /** Which carton is open in the drawer above, so its row can say so. */
  editingBoxId?: string | null;
}) {
  /* Which carton's label is being printed. Null is closed — one piece of
     state rather than an open flag that could disagree with the row. */
  const [sticker, setSticker] = useState<PackedBox | null>(null);
  /* Which scenario the table is showing. The counts are of ALL boxes, not of
     the current view, so an empty tab still says it is empty rather than
     disappearing — "0 Boxes" is the answer to "did anything get split?". */
  const [scnTab, setScnTab] = useState('all');

  if (boxes.length === 0) return null;

  const countOf = (key: string) =>
    key === 'all' ? boxes.length : boxes.filter(b => b.scenario === key).length;
  const shown = scnTab === 'all' ? boxes : boxes.filter(b => b.scenario === scnTab);

  /* Products, not rows: one product split across five cartons is one product
     packed, and the header would otherwise claim five. */
  const productCount = new Set(boxes.flatMap(b => b.items.map(i => i.line.code))).size;
  /* Units actually in cartons — the sum of each box's share, not of the SPI
     line, or a product split across five boxes would be counted five times. */
  const unitsPacked = boxes.reduce((n, b) => n + b.items.reduce((m, i) => m + i.qty, 0), 0);

  return (
    <div className="vti-box invf-packed">
      <div className="vti-header">
        {/* A box, like every other head on this step — the design does not
            put a tick here, and the card is a list of what was packed
            rather than a confirmation. */}
        <div className="vti-header-ico"><IcoBox size={18} stroke={2.2} /></div>
        {/* "Packed Boxes", not "Packed Products": a row here is a carton with
            its contents listed inside it, so the table is a list of boxes.
            The old name survived from when the row was a product. */}
        <div className="vti-header-text">
          <div className="vti-header-title">Packed Boxes &amp; Products Details</div>
          <div className="vti-header-sub">
            Saved boxes &nbsp;·&nbsp; products packed, dimensions, weight &amp; condition
          </div>
        </div>
        {/* Boxes, then products, then units — each one counts a different
            thing, which is why all three are here: five boxes can hold one
            product, and one product can be 150 units. */}
        {/* Cyan counts the containers, green the things inside them, amber the
            units still being added up — the same three tones this step uses
            everywhere else. Boxes and Products had them the other way round. */}
        <div className="vti-header-stats">
          <div className="vti-stat-pill total">
            <div className="vti-stat-dot" />{boxes.length} Box{boxes.length === 1 ? '' : 'es'}
          </div>
          <div className="vti-stat-pill boxed">
            <div className="vti-stat-dot" />{productCount} Product{productCount === 1 ? '' : 's'}
          </div>
          <div className="vti-stat-pill pending">
            <div className="vti-stat-dot" />{unitsPacked} Units Packed
          </div>
        </div>
      </div>

      {/* Scenario rail. A step that offers three ways to pack should let you
          read back what came out of each one, and the counts answer that
          without filtering first. */}
      <div className="invf-pb-rail" role="tablist" aria-label="Filter boxes by packaging scenario">
        {SCN_TABS.map(t => {
          const n = countOf(t.key);
          const on = scnTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              className={`invf-pb-rtab${on ? ' is-on' : ''}`}
              onClick={() => setScnTab(t.key)}
            >
              <span className="invf-pb-rtab__i" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.ico}</svg>
              </span>
              <span className="invf-pb-rtab__t">{t.label}</span>
              <span className="invf-pb-rtab__n">{n} Box{n === 1 ? '' : 'es'}</span>
            </button>
          );
        })}
      </div>

      <div className="vti-table-wrap">
        <table className="vti-table invf-packed-table">
          <thead>
            <tr>
              <th className="invf-c-sr">Sr. No</th>
              <th>Box ID</th>
              <th>Box Packaging Scenario</th>
              <th className="invf-c-prod">Box Product(s)</th>
              <th className="invf-c-qty">Box Qty</th>
              <th>Dimensions (L &times; W &times; H)</th>
              <th className="invf-c-qty">Net Wt.</th>
              <th className="invf-c-qty">Gross Wt.</th>
              <th>Product Remark</th>
              <th>Box Condition</th>
              <th>Product Flags</th>
              <th className="invf-c-acts">Actions</th>
            </tr>
          </thead>
          {/* One row per BOX. A carton holding several products stacks them in
              the Box Product(s) cell rather than spawning a row each: the row
              is the thing you act on — print its label, reopen it — and a
              mixed carton that appeared three times would offer to be printed
              three times. */}
          <tbody>
            {/* An empty scenario keeps the card's shape. Collapsing to a bare
                header row reads as a table that broke rather than one with
                nothing in it, and the rail above has already promised a
                count of zero. */}
            {shown.length === 0 && (
              <tr className="invf-pb-none-row">
                <td colSpan={12}>
                  <div className="invf-pb-none">
                    <span className="invf-pb-none__i" aria-hidden><IcoBox size={20} stroke={2.1} /></span>
                    <div className="invf-pb-none__t">No boxes packed this way</div>
                    <div className="invf-pb-none__s">
                      Nothing on this invoice used{' '}
                      <b>{SCN_TABS.find(t => t.key === scnTab)?.label ?? 'this scenario'}</b>.
                      {' '}The other tabs hold the {boxes.length} box{boxes.length === 1 ? '' : 'es'} that were saved.
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {shown.map((b, i) => {
              const open = b.code === editingBoxId;
              const qty = b.items.reduce((n, it) => n + it.qty, 0);
              return (
                <tr key={b.code} className={`invf-pb-row${open ? ' is-open' : ''}${b.items.length > 1 ? ' has-stack' : ''}`}>
                  <td className="invf-c-sr"><span className="invf-sr">{i + 1}</span></td>

                  {/* The id is the way back in: pressing it reopens the box. */}
                  <td className="invf-c-box">
                    <Tooltip label={onEditBox
                      ? `Open ${putId(b.code)} — its size, weight, flags and what is inside it`
                      : `Carton ${putId(b.code)}`}>
                      {onEditBox ? (
                        <button
                          type="button" className="vti-code invf-boxid-btn"
                          onClick={() => onEditBox(b.code)}
                          aria-label={`Open box ${putId(b.code)}`}
                        >{putId(b.code)}</button>
                      ) : <span className="vti-code">{putId(b.code)}</span>}
                    </Tooltip>
                    {(b.packedOn || b.subLabel) && <div className="invf-pb-sub">{b.packedOn || b.subLabel}</div>}
                  </td>

                  <td>
                    <span className="invf-scn-no">{b.scenarioNo}</span>
                    <div className="invf-pb-scn">{b.scenario}</div>
                    {b.subLabel && b.subLabel !== b.packedOn && <div className="invf-pb-sub">{b.subLabel}</div>}
                  </td>

                  <td className="invf-c-prod">
                    {b.items.map(it => (
                      <div className="invf-pb-prod" key={it.line.code}>
                        <div className="invf-pb-nameline">
                          <Tooltip label={it.line.spiName} disabled={it.line.spiName.length <= NAME_MAX}>
                            <span className="vti-prod-name">{truncateName(it.line.spiName)}</span>
                          </Tooltip>
                          {/* This product's share of the carton — only where
                              the carton holds more than one. Box Qty already
                              states the figure for a single-product box, and
                              a mixed one is where the split is otherwise
                              invisible: 44 units says nothing about 43 + 1. */}
                          {b.items.length > 1 && (
                            <span className="invf-pb-share">&times; {it.qty}</span>
                          )}
                        </div>
                        {/* Label quiet, value loud — HSN and GST are looked up
                            by their numbers, so the number is what has to
                            carry. The separator is a drawn dot rather than a
                            middot glyph, which sat low and off-centre. */}
                        <div className="invf-pb-meta">
                          <span className="vti-code">{it.line.code}</span>
                          <span className="invf-pb-hsn">HSN <b>{it.line.hsn}</b></span>
                          <span className="invf-pb-dot" aria-hidden />
                          <span className="invf-pb-gst">GST <b>{it.line.gst}%</b></span>
                        </div>
                      </div>
                    ))}
                  </td>

                  <td className="invf-c-qty"><span className="invf-pb-qty">{qty}</span></td>

                  <td className="invf-pb-dims">{dimText(b.dims)}</td>
                  <td className="invf-c-qty">{wtText(b.netWt)}</td>
                  <td className="invf-c-qty">{wtText(b.grossWt)}</td>

                  <td>{b.remark
                    ? <span className={`invf-pb-pill ${REMARK_TONE[b.remark] ?? 'is-ok'}`}><i className="invf-pb-dotm" />{b.remark}</span>
                    : <span className="invf-pb-none">&mdash;</span>}</td>
                  <td>{b.condition
                    ? <span className={`invf-pb-pill ${COND_TONE[b.condition] ?? 'is-ok'}`}><i className="invf-pb-dotm" />{b.condition}</span>
                    : <span className="invf-pb-none">&mdash;</span>}</td>
                  <td><FlagCell flags={b.flags ?? []} /></td>

                  <td className="invf-c-acts">
                    <span className="vti-packed-acts">
                      {onEditBox && (
                        <Tooltip label={`Edit ${putId(b.code)} — its size, weight and flags`}>
                          <button
                            type="button"
                            className={`vti-btn-single vti-btn-single--ico vti-btn-single--edit${open ? ' is-on' : ''}`}
                            onClick={() => onEditBox(b.code)}
                            aria-label={`Edit ${putId(b.code)}`}
                          ><IcoPencil size={14} /></button>
                        </Tooltip>
                      )}
                      {/* The label names the box it prints, so what is on
                          screen and what comes out of the printer are
                          visibly the same carton. */}
                      <Tooltip label={`Print the sticker for ${putId(b.code)}`}>
                        <button
                          type="button" className="invf-pb-sticker"
                          onClick={() => setSticker(b)}
                          aria-label={`Print the sticker for ${putId(b.code)}`}
                        ><IcoPrinter size={14} /><span className="invf-pb-stkid">{putId(b.code)}</span> Sticker</button>
                      </Tooltip>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The row's own sticker button opens this. Everything the label needs
          is already on the row, so it needs no extra plumbing from Step 3. */}
      {sticker && (
        <BoxStickerModal
          boxId={sticker.code}
          rows={sticker.items}
          quantity={sticker.items.reduce((n, i) => n + i.qty, 0)}
          scenario={sticker.scenario}
          modeLabel={sticker.subLabel ?? sticker.scenarioNo}
          condition={sticker.condition ?? 'Perfect'}
          onClose={() => setSticker(null)}
        />
      )}
    </div>
  );
}
