import { useCallback, useState } from 'react';
import { IcoBox, IcoCheck, IcoChevron, IcoLock, IcoShip } from '../../../icons';
import StageSummary from './StageSummary';
import Tooltip from '../../../../../components/ui/Tooltip';
import BoxDrawer from './BoxDrawer';
import PackedProducts, { type PackedRow } from './PackedProducts';
import type { CustomFlag } from './ProductFlagsModal';
import MultiBoxPanel, { splitQuantity, type SplitBox } from './MultiBoxPanel';
import { lineTotals, truncateDesc, DESC_MAX, type ProductLine } from '../invoice-products';
import type { InvoiceDraft } from '../invoice-draft';

/* The box table's column count. The drawer rows span the whole table, and a
   literal in two places is how a new column silently breaks their width. */
const BOX_TABLE_COLUMNS = 10;

/** What a product row has been committed to. One scenario at a time. */
type Packing =
  | { scenario: 's1' }
  | { scenario: 's2'; boxes: SplitBox[] }
  /** Packed into a shared master carton with the other 's3' rows. */
  | { scenario: 's3' };

/** Which packaging shape the goods arrived in. */
export type Scenario = 's1' | 's2' | 's3';

/**
 * The three ways a delivery can be packed.
 *
 * At module scope: the copy never changes, and rebuilding three objects on
 * every keystroke in a sub-box field would be waste.
 */
const SCENARIOS: Array<{ id: Scenario; no: string; title: string; arrow: string; tail: string; desc: string; tag: string }> = [
  {
    id: 's1', no: 'Scenario 01',
    title: '1 Product', arrow: '→', tail: '1 Box',
    desc: 'All units of a single product go into one box. Simplest flow — one SKU, one carton, one label.',
    tag: 'Standard',
  },
  {
    id: 's2', no: 'Scenario 02',
    title: '1 Product', arrow: '→', tail: 'Multiple Boxes',
    desc: 'Same product split across multiple boxes. Each box gets its own label and dimension entry.',
    tag: 'Split Carton',
  },
  {
    id: 's3', no: 'Scenario 03',
    title: 'Multiple Products', arrow: '→', tail: '1 Box',
    desc: 'Different products packed in one master carton. Each product listed separately, one shared label.',
    tag: 'Mixed Carton',
  },
];

/**
 * Step 03 — Temporary Box Packaging.
 *
 * The scenario cards explain the three packing shapes; the table below turns
 * the invoice's products into labelled boxes.
 *
 * `pkg-*` and `vti-*` are this stage's own namespaces, ported from the
 * prototype — nothing in the repo had a box-generation screen to borrow from,
 * unlike every step before it.
 */
export default function Step3BoxPackaging({ draft, lines }: { draft: InvoiceDraft; lines: ProductLine[] }) {
  const [pkgOpen, setPkgOpen] = useState(true);
  /* Per product rather than per screen: the design lets one delivery mix
     scenarios, so a row carries its own choice. Keyed by product code. */
  const [subBox, setSubBox] = useState<Record<string, string>>({});
  /* What a row is committed to. `s1` is one box; `s2` is a split, and carries
     the boxes it was split into. A row holds one scenario at a time, which is
     why this is a single value and not a set of flags. */
  const [packing, setPacking] = useState<Record<string, Packing>>({});
  /* A row whose count failed validation, so the input can say so. */
  const [invalid, setInvalid] = useState<string | null>(null);
  /* Products ticked for Scenario 03, before they are packed. Selection is not
     a commitment — the row is only committed when "Pack into 1 Box" is used. */
  const [selected, setSelected] = useState<string[]>([]);
  /* Products whose boxes have been saved. These leave the table above. */
  const [saved, setSaved] = useState<Record<string, true>>({});
  /* The mixed carton being filled, once "Pack into 1 Box" has been used: the
     product codes it holds. Null means no carton is open. Separate from
     `selected` because ticking is not packing — the carton can have products
     taken back out of it before it is saved. */
  const [mixedBox, setMixedBox] = useState<string[] | null>(null);
  /* Taking the last product out closes the carton: an empty master carton is
     not a thing to save. */
  const takeOutOfBox = useCallback((code: string) => {
    setMixedBox(b => {
      const next = (b ?? []).filter(c => c !== code);
      return next.length > 0 ? next : null;
    });
  }, []);

  const saveRow = (code: string) => setSaved(s => ({ ...s, [code]: true }));

  /* Custom product flags belong to the step, not to a box: one created on a
     carton should be offered on every other carton too. */
  const [customFlags, setCustomFlags] = useState<CustomFlag[]>([]);
  const addFlag = (f: CustomFlag) => setCustomFlags(fs => [...fs, f]);
  const removeFlag = (id: string) => setCustomFlags(fs => fs.filter(f => f.id !== id));

  /* A split contributes its own boxes; a single contributes one; and every
     Scenario 03 row shares ONE master carton between them, so the group is
     counted once rather than per product. */
  const s3Rows = Object.values(packing).filter(p => p.scenario === 's3').length;
  const totalBoxes = Object.entries(packing).reduce((n, [, p]) => {
    if (p.scenario === 's3') return n;
    return n + (p.scenario === 's2' ? p.boxes.length : 1);
  }, 0) + (s3Rows > 0 ? 1 : 0);
  const boxedCount = Object.keys(packing).length;
  const pending = lines.length - boxedCount;

  /* Only a row with no scenario can be ticked — one row cannot be in a master
     carton and a split at the same time. */
  const selectable = lines.filter(l => !packing[l.code]).map(l => l.code);
  const allSelected = selectable.length > 0 && selectable.every(c => selected.includes(c));

  const toggleSelect = (code: string) =>
    setSelected(s => (s.includes(code) ? s.filter(c => c !== code) : [...s, code]));

  const toggleSelectAll = () =>
    setSelected(allSelected ? [] : selectable);

  /* The top table shows only what is still to pack; a SAVED row moves to the
     Packed Products table below. One product is never in both.

     Saved, not merely committed: committing opens the drawer, and the drawer
     is where the dimensions are entered. A row that left the table the moment
     it was committed would take its own dimension form with it. */
  const pendingLines = lines.filter(l => !saved[l.code]);

  /* The packed rows, with the boxes each one produced.
     Scenario 03 is the interesting case: its products SHARE one carton, so
     every such row reports the same box id rather than one of its own, and
     names the others it is sharing with. */
  const s3Codes = lines.filter(l => packing[l.code]?.scenario === 's3').map(l => l.code);
  const packedRows: PackedRow[] = lines.flatMap((line, i) => {
    const p = packing[line.code];
    if (!p || !saved[line.code]) return [];
    if (p.scenario === 's1') {
      return [{
        line, scenarioNo: 'Scenario 01', scenario: '1 Product → 1 Box',
        boxes: [{ id: `PUT-B-${String(i + 1).padStart(3, '0')}`, qty: line.spiQty }],
      }];
    }
    if (p.scenario === 's2') {
      return [{
        line, scenarioNo: 'Scenario 02', scenario: '1 Product → Multiple Boxes',
        boxes: p.boxes.map(b => ({ id: `B-${String(b.no).padStart(3, '0')}`, qty: b.qty })),
      }];
    }
    return [{
      line, scenarioNo: 'Scenario 03', scenario: 'Multiple Products → 1 Box',
      boxes: [{
        id: 'MC-001',
        qty: line.spiQty,
        sharedWith: s3Codes.filter(c => c !== line.code),
      }],
    }];
  });

  /* How many rows each scenario is holding, for the badge on its card. The
     ticked-but-not-yet-packed rows count towards Scenario 03 as well, so the
     card reacts while the selection is still being made. */
  const scenarioUse: Record<Scenario, number> = {
    s1: Object.values(packing).filter(p => p.scenario === 's1').length,
    s2: Object.values(packing).filter(p => p.scenario === 's2').length,
    s3: s3Rows + selected.length,
  };

  /**
   * Open the shared carton on every ticked row.
   *
   * Packing is not the save: one carton holding several SKUs still needs its
   * dimensions, its condition and an identifier set for each product inside,
   * so this opens the carton and `saveMixedBox` is what commits it.
   */
  const packSelected = () => {
    setMixedBox(selected);
    setSelected([]);
  };

  /* The carton's contents, resolved once for the panel below. */
  const mixedLines = (mixedBox ?? [])
    .map(c => lines.find(l => l.code === c))
    .filter((l): l is ProductLine => !!l);
  const mixedCartonQty = mixedLines.reduce((n, l) => n + l.spiQty, 0);
  /* BoxDrawer's strip describes one product; a mixed carton has no single one,
     so it is given the carton itself — named for what it is, with the SKU count
     where a product's HSN would go. The contents are listed in the table above
     it, which is where a mixed carton's products actually belong. */
  const mixedCartonLine: ProductLine = {
    code: 'PUT-MB-001',
    hsn: `${mixedLines.length} SKUs`,
    piName: 'Mixed Master Carton',
    poName: 'Mixed Master Carton',
    spiName: 'Mixed Master Carton',
    description: mixedLines.map(l => l.spiName).join(', '),
    piQty: mixedCartonQty, poQty: mixedCartonQty, spiQty: mixedCartonQty,
    spiRate: 0, poRate: 0, gst: 0,
  };

  /** Commit the mixed carton. Its products then leave the table above. */
  const saveMixedBox = () => {
    const codes = mixedBox ?? [];
    setPacking(p => {
      const next = { ...p };
      for (const code of codes) next[code] = { scenario: 's3' };
      return next;
    });
    setSaved(s => {
      const next = { ...s };
      for (const code of codes) next[code] = true;
      return next;
    });
    setMixedBox(null);
  };

  /** Commit a row to one box. */
  const singleBox = (line: ProductLine) =>
    setPacking(p => {
      const next = { ...p };
      if (next[line.code]) delete next[line.code];
      else next[line.code] = { scenario: 's1' };
      return next;
    });

  /**
   * Commit a row to a split.
   *
   * Any whole number from 1 upwards. There is deliberately no upper bound:
   * asking for more boxes than there are units is allowed, and simply leaves
   * the surplus boxes empty — a packer may well want the cartons counted and
   * labelled before they are filled.
   */
  const applySplit = (line: ProductLine) => {
    const count = parseInt(subBox[line.code] ?? '', 10);
    if (!Number.isFinite(count) || count < 1) {
      setInvalid(line.code);
      window.setTimeout(() => setInvalid(null), 2000);
      return;
    }
    setInvalid(null);
    setPacking(p => ({ ...p, [line.code]: { scenario: 's2', boxes: splitQuantity(line.spiQty, count) } }));
  };

  /** Move units into or out of one carton of a split. */
  const setBoxQty = (code: string, boxNo: number, qty: number) =>
    setPacking(p => {
      const pack = p[code];
      if (!pack || pack.scenario !== 's2') return p;
      return { ...p, [code]: { ...pack, boxes: pack.boxes.map(b => (b.no === boxNo ? { ...b, qty } : b)) } };
    });

  const reset = (code: string) =>
    setPacking(p => { const next = { ...p }; delete next[code]; return next; });

  return (
    <>
      <StageSummary draft={draft} upto={2} />

      {/* ── Packaging Scenarios ────────────────────────────────────────── */}
      <div className={`pkg-box ${pkgOpen ? '' : 'is-collapsed'}`}>
        <div className="pkg-box__header" onClick={() => setPkgOpen(o => !o)}>
          <div className="pkg-box__header-ico"><IcoBox size={18} stroke={2.2} /></div>
          <div className="pkg-box__header-text">
            <div className="pkg-box__header-title">Packaging Scenarios</div>
            <div className="pkg-box__header-sub">Select the scenario that matches your inward product structure</div>
          </div>
          <div className="pkg-box__header-right">
            <div className="pkg-box__header-badge">{SCENARIOS.length} Scenarios</div>
            <div className="pkg-toggle"><IcoChevron size={11} stroke={2.8} /></div>
          </div>
        </div>
        <div className="pkg-box__body">
          {SCENARIOS.map(s => (
            <div className="pkg-card" key={s.id}>
              <div className="pkg-card__scenario">
                <div className="pkg-card__scenario-line" />
                {s.no}
                {/* How many rows this scenario is holding, on the card that
                    describes it. Scenario 03 counts products in the carton;
                    the other two count the rows committed to them. */}
                {scenarioUse[s.id] > 0 && (
                  <span className="pkg-card__use is-on">
                    {scenarioUse[s.id]} Product{scenarioUse[s.id] === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {/* The arrow is its own span: the stylesheet tints it, so it
                  cannot be part of the surrounding text. */}
              <div className="pkg-card__title">{s.title} <span>{s.arrow}</span> {s.tail}</div>
              <div className="pkg-card__desc">{s.desc}</div>
              <span className="pkg-card__tag">{s.tag}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── SPI Box Generation System ──────────────────────────────────── */}
      <div className="vti-box">
        <div className="vti-header">
          <div className="vti-header-ico"><IcoShip size={18} stroke={2.2} /></div>
          <div className="vti-header-text">
            <div className="vti-header-title">SPI Box Generation System</div>
            <div className="vti-header-sub">
              Products — {draft.invoiceNumber || 'this invoice'} &nbsp;·&nbsp; Create boxes with dimensions &amp; stickers
            </div>
          </div>
          {/* Counted from the rows, not stored: three numbers that must always
              agree with the table beneath them. */}
          <div className="vti-header-stats">
            <div className="vti-stat-pill boxed">
              <div className="vti-stat-dot" /><IcoCheck size={11} stroke={2.8} />{boxedCount} Boxed
            </div>
            <div className="vti-stat-pill pending">
              <div className="vti-stat-dot" />{pending} Pending
            </div>
            <div className="vti-stat-pill total">
              <div className="vti-stat-dot" /><IcoBox size={11} stroke={2.2} />{totalBoxes} Total Boxes
            </div>
          </div>
        </div>

        {/* Appears only once something is ticked. It is the only place the
            Scenario 03 action lives, because packing several products into one
            carton is an action on the selection, not on any single row. */}
        {selected.length > 0 && (
          <div className="vti-selection-bar is-visible">
            <div className="vti-sel-left">
              <div className="vti-sel-count">
                <span className="vti-sel-count-badge">{selected.length}</span> Products selected
              </div>
              <div className="vti-sel-products">
                {selected.map(code => <span className="vti-sel-chip" key={code}>{code}</span>)}
              </div>
            </div>
            <div className="vti-sel-right">
              <button type="button" className="vti-sel-clear" onClick={() => setSelected([])}>Clear</button>
              <button type="button" className="vti-sel-pack-btn" onClick={packSelected}>
                <IcoBox size={14} stroke={2.3} /> Pack into 1 Box
              </button>
            </div>
          </div>
        )}

        <div className="vti-table-wrap">
          <table className="vti-table">
            <thead>
              {/* Description, Missing Qty and Extra Qty are carried over from
                  step 02's 3-way match, so the row being packed reads the same
                  here as it did when it was matched. They are the invoice's
                  own figures, not new ones. */}
              <tr>
                <th>
                  {/* Ticks every row that is still free to be packed, not
                      every row — a committed one cannot join the carton. */}
                  <div
                    className={`vti-cb${allSelected ? ' is-checked' : ''}`}
                    role="checkbox"
                    aria-checked={allSelected}
                    aria-label="Select all products"
                    tabIndex={0}
                    onClick={toggleSelectAll}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelectAll(); } }}
                  />
                </th>
                <th>Product (SPI)</th>
                <th>Code</th>
                <th className="vti-desc-h">Description</th>
                <th>Qty (SPI)</th>
                <th>Missing Qty</th>
                <th>Extra Qty</th>
                <th>Mode</th>
                <th>Sub-Box Count</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingLines.map((line, i) => {
                const { missing, extra } = lineTotals(line);
                /* A committed row closes the routes it did not take: the
                   checkbox (Scenario 03 picks several products) and, on the
                   single-box path, the sub-box count. The design shows them
                   locked rather than hidden, so it stays clear what was given
                   up and how to undo it. */
                const pack = packing[line.code];
                const single = pack?.scenario === 's1';
                const split = pack?.scenario === 's2';
                const mixed = pack?.scenario === 's3';
                const isTicked = selected.includes(line.code);
                const scenarioLabel = split
                  ? 'Scenario 02 · 1 Product → Multiple Boxes'
                  : mixed
                    ? 'Scenario 03 · Multiple Products → 1 Box'
                    : 'Scenario 01 · 1 Product → 1 Box';
                const scenarioNo = split ? 'Scenario 02' : mixed ? 'Scenario 03' : 'Scenario 01';
                return (
                  <Fragmentish key={line.code}>
                  <tr className={`vti-prod-row${pack ? ' is-open' : ''}${isTicked ? ' is-selected' : ''}`}>
                    <td>
                      {/* A committed row shows a lock instead of a tick — except
                          a Scenario 03 one, which stays ticked because the tick
                          is what put it in the carton. */}
                      {mixed ? (
                        <div className="vti-cb is-checked" role="checkbox" aria-checked
                          aria-label={`${line.spiName} is in the master carton`} />
                      ) : pack ? (
                        <div className="vti-scn-lock is-cb" title={`Locked by ${scenarioNo}`}>
                          <IcoLock size={10} stroke={2.6} />
                        </div>
                      ) : (
                        <div
                          className={`vti-cb${isTicked ? ' is-checked' : ''}`}
                          role="checkbox"
                          aria-checked={isTicked}
                          aria-label={`Select ${line.spiName}`}
                          tabIndex={0}
                          onClick={() => toggleSelect(line.code)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(line.code); } }}
                        />
                      )}
                    </td>
                    <td>
                      <div className="vti-prod-cell">
                        <div>
                          <div className="vti-prod-name">{line.spiName}</div>
                          <div className="vti-prod-sku">HSN {line.hsn}</div>
                          {pack && (
                            <span className="vti-scn-chip is-on" title="Reset the packaging scenario for this product"
                              onClick={() => reset(line.code)}>
                              <span className="vti-scn-chip-dot" />
                              {scenarioLabel}
                              <span className="vti-scn-chip-x">✕</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td><span className="vti-code">{line.code}</span></td>
                    <td className="vti-desc">
                      {/* Cut at 30 characters, with the whole thing in the
                          tooltip so nothing is lost. The app's own Tooltip,
                          not the native `title`: that ignores the theme, waits
                          a second, and is clipped inside a scroller. */}
                      <Tooltip label={line.description} disabled={line.description.length <= DESC_MAX}>
                        <span className="vti-desc__wrap">{truncateDesc(line.description)}</span>
                      </Tooltip>
                    </td>
                    <td><span className="vti-qty-badge">{line.spiQty}</span></td>
                    {/* The same pills step 02 uses, so a shortfall looks the
                        same on both screens. Neutral at zero — a column of
                        zeroes should not read as a column of warnings. */}
                    <td>
                      <span className={`cpd-qtypill${missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{missing}</span>
                    </td>
                    <td>
                      <span className={`cpd-qtypill${extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{extra}</span>
                    </td>
                    <td>
                      <select className="vti-mode-sel" disabled defaultValue="auto">
                        <option value="auto">Auto</option>
                      </select>
                    </td>
                    <td>
                      {single || mixed ? (
                        <div className="vti-scn-lock">
                          <IcoLock size={10} stroke={2.6} />
                          <span className="vti-scn-lock-lbl">Locked · {scenarioNo}</span>
                        </div>
                      ) : (
                        <div className="vti-subbox-cell">
                          <input
                            /* No `max`: the count is unbounded, and a max
                               attribute marks the field invalid and fights the
                               spinner the moment it is exceeded. */
                            className="vti-subbox-inp" type="number" min={1}
                            placeholder="e.g. 3"
                            style={invalid === line.code ? { borderColor: '#ef4444' } : undefined}
                            value={split ? String(pack.boxes.length) : (subBox[line.code] ?? '')}
                            readOnly={split}
                            onChange={e => setSubBox(s => ({ ...s, [line.code]: e.target.value }))}
                            /* Enter applies, so a count can be typed and
                               committed without reaching for the mouse. */
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySplit(line); } }}
                          />
                          <button type="button"
                            className={`vti-btn-apply${split ? ' is-done' : ''}`}
                            onClick={() => (split ? reset(line.code) : applySplit(line))}>
                            {split ? `✓ ${pack.boxes.length} Boxes` : 'Apply'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      {split || mixed ? (
                        <div className="vti-scn-lock">
                          <IcoLock size={10} stroke={2.6} />
                          <span className="vti-scn-lock-lbl">Locked · {scenarioNo}</span>
                        </div>
                      ) : (
                        <button type="button" className={`vti-btn-single${single ? ' is-on' : ''}`}
                          onClick={() => singleBox(line)}>
                          + Single Box
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* The drawer is a row of its own spanning every column —
                      a table cannot nest a panel inside a cell without
                      breaking the column widths above it.

                      `is-open` is load-bearing and belongs HERE, not on the
                      product row: `.vti-drawer-inner` is max-height 0 and
                      opacity 0 until `.vti-drawer-row.is-open` expands it.
                      Without it the drawer renders, measures, and is entirely
                      invisible and unclickable. */}
                  {single && (
                    <tr className="vti-drawer-row is-open">
                      <td colSpan={BOX_TABLE_COLUMNS} className="vti-drawer-td">
                        <BoxDrawer
                          boxId={`PUT-B-${String(i + 1).padStart(3, '0')}`}
                          line={line}
                          quantity={line.spiQty}
                          onSave={() => saveRow(line.code)}
                          customFlags={customFlags} onAddFlag={addFlag} onRemoveFlag={removeFlag}
                        />
                      </td>
                    </tr>
                  )}

                  {split && (
                    <tr className="vti-multibox-container-row">
                      <td colSpan={BOX_TABLE_COLUMNS} style={{ padding: 0, border: 'none', background: 'transparent' }}>
                        <MultiBoxPanel line={line} boxes={pack.boxes}
                          onClose={() => reset(line.code)} onSave={() => saveRow(line.code)}
                          customFlags={customFlags} onAddFlag={addFlag} onRemoveFlag={removeFlag}
                          onBoxQty={(no, q) => setBoxQty(line.code, no, q)} />
                      </td>
                    </tr>
                  )}
                  </Fragmentish>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* The mixed carton, once products have been packed into it. It sits
          below the table rather than inside a row: it belongs to several rows
          at once, so there is no one row to open it from. */}
      {mixedBox && mixedBox.length > 0 && (
          <BoxDrawer
            /* MB for "mixed box", the prototype's own id for this carton —
               a single box reads PUT-B-001. */
            boxId="PUT-MB-001"
            /* The carton's own figures, not one product's: every SKU inside it
               shares these dimensions and this condition. */
            line={mixedCartonLine}
            quantity={mixedCartonQty}
            scenario="Multiple Products → 1 Box"
            modeKey="Products"
            modeLabel={`${mixedBox.length} SKU${mixedBox.length === 1 ? '' : 's'}`}
            variant="panel"
            /* The several products this carton holds. Every other box takes
               its contents from `line` alone, because it holds exactly that. */
            contents={mixedLines.map(l => ({ line: l, qty: l.spiQty }))}
            onRemoveContent={takeOutOfBox}
            onClearContents={() => setMixedBox(null)}
            onSave={saveMixedBox}
            customFlags={customFlags}
            onAddFlag={addFlag}
            onRemoveFlag={removeFlag}
          />
      )}

      <PackedProducts rows={packedRows} />
    </>
  );
}

/* A product row and its drawer are two sibling <tr>s, so the pair needs one
   parent that renders nothing — anything real between them would be invalid
   inside a <tbody>. A shorthand fragment cannot take a key, hence this. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
