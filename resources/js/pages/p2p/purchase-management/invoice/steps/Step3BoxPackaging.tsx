import { useCallback, useMemo, useState } from 'react';
import { IcoBox, IcoCheck, IcoChevron, IcoLock, IcoShip } from '../../../icons';
import StageSummary from './StageSummary';
import Tooltip from '../../../../../components/ui/Tooltip';
import BoxDrawer, { type BoxSaveData } from './BoxDrawer';
import PackedProducts, { type PackedRow } from './PackedProducts';
import type { CustomFlag } from './ProductFlagsModal';
import MultiBoxPanel, { splitQuantity, type SplitBox } from './MultiBoxPanel';
import { lineTotals, truncateDesc, DESC_MAX, type ProductLine } from '../invoice-products';
import type { InvoiceDraft } from '../invoice-draft';
import { useToast } from '../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../contexts/ConfirmContext';
import { EMPTY_IDENTITY } from './SelectedProducts';
import type { ProductFlagOption, SpiBox, SpiBoxBody } from '../spi-api';

const BOX_TABLE_COLUMNS = 10;

type Packing =
  | { scenario: 's1' }
  | { scenario: 's2'; boxes: SplitBox[] }
  | { scenario: 's3' };

export type Scenario = 's1' | 's2' | 's3';

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

const FLAG_PALETTE = ['#0891b2', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#2563eb', '#ca8a04'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Step3BoxPackaging({
  draft, lines, boxes = [], flagMaster = [], readOnly = false, onCreateBox, onDeleteBoxes,
}: {
  draft: InvoiceDraft;
  lines: ProductLine[];
  boxes?: SpiBox[];
  flagMaster?: ProductFlagOption[];
  readOnly?: boolean;
  onCreateBox?: (body: SpiBoxBody) => Promise<SpiBox | null>;
  onDeleteBoxes?: (ids: number[]) => Promise<boolean>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pkgOpen, setPkgOpen] = useState(true);
  const [subBox, setSubBox] = useState<Record<string, string>>({});

  const codeOfItem = useMemo(
    () => new Map(lines.filter(l => l.spiItemId != null).map(l => [l.spiItemId!, l.code])),
    [lines],
  );
  const boxesOf = (code: string) =>
    boxes.filter(b => b.items.some(i => codeOfItem.get(i.supplier_invoice_item_id) === code));
  const qtyIn = (b: SpiBox, code: string) => b.items
    .filter(i => codeOfItem.get(i.supplier_invoice_item_id) === code)
    .reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  const packedQty: Record<string, number> = {};
  for (const b of boxes) {
    for (const i of b.items) {
      const c = codeOfItem.get(i.supplier_invoice_item_id);
      if (c) packedQty[c] = (packedQty[c] ?? 0) + (Number(i.quantity) || 0);
    }
  }
  const saved: Record<string, boolean> = Object.fromEntries(
    lines.map(l => [l.code, l.spiQty > 0 && (packedQty[l.code] ?? 0) >= l.spiQty - 0.0005]),
  );

  const [packing, setPacking] = useState<Record<string, Packing>>(() => {
    const out: Record<string, Packing> = {};
    for (const l of lines) {
      const bs = boxesOf(l.code);
      if (!bs.length) continue;
      const sc = bs[0].scenario;
      if (sc === 's2') {
        const split = bs.map((b, i) => ({ no: i + 1, qty: qtyIn(b, l.code) }));
        const left = Math.round((l.spiQty - split.reduce((n, b) => n + b.qty, 0)) * 1000) / 1000;
        if (left > 0) split.push({ no: split.length + 1, qty: left });
        out[l.code] = { scenario: 's2', boxes: split };
      } else {
        out[l.code] = { scenario: sc };
      }
    }
    return out;
  });
  const [splitCodes, setSplitCodes] = useState<Record<string, Record<number, string>>>(() => {
    const out: Record<string, Record<number, string>> = {};
    for (const l of lines) {
      const bs = boxesOf(l.code).filter(b => b.scenario === 's2');
      if (bs.length) out[l.code] = Object.fromEntries(bs.map((b, i) => [i + 1, b.box_code]));
    }
    return out;
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [invalid, setInvalid] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mixedBox, setMixedBox] = useState<string[] | null>(null);
  const takeOutOfBox = useCallback((code: string) => {
    setMixedBox(b => {
      const next = (b ?? []).filter(c => c !== code);
      return next.length > 0 ? next : null;
    });
  }, []);

  const customFlags = useMemo<CustomFlag[]>(
    () => flagMaster.map((f, i) => ({
      id: `m${f.id}`, name: f.flag_name || `Flag ${f.id}`, color: FLAG_PALETTE[i % FLAG_PALETTE.length],
    })),
    [flagMaster],
  );

  const s3Rows = Object.values(packing).filter(p => p.scenario === 's3').length;
  const totalBoxes = boxes.length;
  const boxedCount = lines.filter(l => saved[l.code]).length;
  const pending = lines.length - boxedCount;

  const selectable = lines.filter(l => !packing[l.code] && !saved[l.code]).map(l => l.code);
  const allSelected = selectable.length > 0 && selectable.every(c => selected.includes(c));

  const toggleSelect = (code: string) => {
    if (readOnly) return;
    setSelected(s => (s.includes(code) ? s.filter(c => c !== code) : [...s, code]));
  };

  const toggleSelectAll = () => {
    if (readOnly) return;
    setSelected(allSelected ? [] : selectable);
  };

  const pendingLines = lines.filter(l => !saved[l.code]);

  const SCN_LABEL: Record<Scenario, [string, string]> = {
    s1: ['Scenario 01', '1 Product → 1 Box'],
    s2: ['Scenario 02', '1 Product → Multiple Boxes'],
    s3: ['Scenario 03', 'Multiple Products → 1 Box'],
  };
  const packedRows: PackedRow[] = lines.filter(l => saved[l.code]).map(line => {
    const bs = boxesOf(line.code);
    const sc = bs[0]?.scenario ?? 's1';
    return {
      line, scenarioNo: SCN_LABEL[sc][0], scenario: SCN_LABEL[sc][1],
      boxes: bs.map(b => ({
        id: b.box_code,
        qty: qtyIn(b, line.code),
        ...(b.scenario === 's3'
          ? { sharedWith: b.items.map(i => codeOfItem.get(i.supplier_invoice_item_id)).filter((c): c is string => !!c && c !== line.code) }
          : {}),
      })),
    };
  });

  const scenarioUse: Record<Scenario, number> = {
    s1: Object.values(packing).filter(p => p.scenario === 's1').length,
    s2: Object.values(packing).filter(p => p.scenario === 's2').length,
    s3: s3Rows + selected.length,
  };

  const packSelected = () => {
    if (selected.length < 2) {
      toast.warning('Pick at least 2 products', 'A mixed carton holds two or more products — use a single box for one.');
      return;
    }
    setMixedBox(selected);
    setSelected([]);
  };

  const mixedLines = (mixedBox ?? [])
    .map(c => lines.find(l => l.code === c))
    .filter((l): l is ProductLine => !!l);
  const mixedCartonQty = mixedLines.reduce((n, l) => n + l.spiQty, 0);
  const mixedCartonLine: ProductLine = {
    code: 'MIXED-CARTON',
    hsn: `${mixedLines.length} SKUs`,
    piName: 'Mixed Master Carton',
    poName: 'Mixed Master Carton',
    spiName: 'Mixed Master Carton',
    description: mixedLines.map(l => l.spiName).join(', '),
    piQty: mixedCartonQty, poQty: mixedCartonQty, spiQty: mixedCartonQty,
    spiRate: 0, poRate: 0, gst: 0,
  };

  const flagIdsFor = (data: BoxSaveData) => {
    const ids: number[] = [];
    const missing: string[] = [];
    data.flagIds.forEach((id, i) => {
      if (id.startsWith('m') && Number(id.slice(1))) { ids.push(Number(id.slice(1))); return; }
      const name = (data.flagNames[i] ?? id).toLowerCase();
      const hit = flagMaster.find(f => (f.flag_name ?? '').trim().toLowerCase() === name);
      if (hit) ids.push(hit.id); else missing.push(data.flagNames[i] ?? id);
    });
    return { ids: [...new Set(ids)], missing };
  };

  const validate = (scenario: Scenario, data: BoxSaveData, contents: Array<{ line: ProductLine; qty: number }>) => {
    const d = data.dims;
    const need = [
      d.length_cm == null && 'Length', d.width_cm == null && 'Width', d.height_cm == null && 'Height',
      d.gross_weight_kg == null && 'Gross Weight',
    ].filter(Boolean);
    if (need.length) return `Enter ${need.join(', ')} before saving the box.`;
    const nonPositive = Object.entries(d).filter(([, v]) => v != null && v <= 0);
    if (nonPositive.length) return 'Dimensions and weights must be greater than 0.';
    if (d.net_weight_kg != null && d.gross_weight_kg != null && d.net_weight_kg > d.gross_weight_kg) {
      return 'Net weight cannot be more than the gross weight.';
    }
    if (contents.some(c => !(c.qty > 0))) return 'Every box must hold at least one unit.';
    const units = (n: number) => `${Math.round(n * 1000) / 1000} unit${n === 1 ? '' : 's'}`;
    if (scenario === 's1' || scenario === 's3') {
      for (const c of contents) {
        const left = Math.round((c.line.spiQty - (packedQty[c.line.code] ?? 0)) * 1000) / 1000;
        if (Math.abs(c.qty - left) > 0.0005) {
          return scenario === 's1'
            ? `A single box must hold all ${units(left)} of ${c.line.spiName} — it holds ${units(c.qty)}.`
            : `The mixed carton must hold all ${units(left)} of ${c.line.spiName} — it holds ${units(c.qty)}.`;
        }
      }
    }
    if (scenario === 's2') {
      const line = contents[0]?.line;
      const pack = line ? packing[line.code] : undefined;
      if (line && pack?.scenario === 's2') {
        const allocated = Math.round(pack.boxes.reduce((n, b) => n + b.qty, 0) * 1000) / 1000;
        if (Math.abs(allocated - line.spiQty) > 0.0005) {
          const gap = Math.round((line.spiQty - allocated) * 1000) / 1000;
          return `The boxes hold ${units(allocated)} of ${line.spiName}'s ${units(line.spiQty)} — `
            + (gap > 0 ? `assign the other ${units(gap)} to a box` : `take ${units(-gap)} out`) + ' before saving.';
        }
      }
    }
    const today = todayIso();
    for (const c of contents) {
      const id = scenario === 's3' ? (data.identities[c.line.code] ?? EMPTY_IDENTITY) : data.boxIdentity;
      if (id.expiry && id.mfg && id.expiry < id.mfg) return `${c.line.spiName}: the expiry date is before the MFG date.`;
      if (id.expiry && id.expiry < today) return `${c.line.spiName}: the expiry date is already in the past.`;
      if (id.mfg && id.mfg > today) return `${c.line.spiName}: the MFG date is in the future.`;
    }
    if (data.remark === 'damaged') {
      const reasons = scenario === 's3'
        ? contents.every(c => (data.identities[c.line.code]?.remarks ?? '').trim())
        : !!data.boxIdentity.remarks.trim();
      if (!reasons) return 'Damaged / Rejected needs a reason — add it in Remarks.';
    }
    if (data.remark === 'extra' && !contents.some(c => lineTotals(c.line).extra > 0)) {
      return 'Extra Quantity applies only to a product billed above its PO quantity.';
    }
    return null;
  };

  const bodyFor = (scenario: Scenario, data: BoxSaveData, contents: Array<{ line: ProductLine; qty: number }>): SpiBoxBody => {
    const { ids } = flagIdsFor(data);
    return {
      scenario,
      ...data.dims,
      condition: data.condition,
      items: contents.map(c => {
        const id = scenario === 's3' ? (data.identities[c.line.code] ?? EMPTY_IDENTITY) : data.boxIdentity;
        const note = scenario === 's3'
          ? [id.remarks.trim(), data.note && data.note.startsWith('Cold chain') ? data.note : ''].filter(Boolean).join(' · ')
          : data.note ?? '';
        return {
          supplier_invoice_item_id: c.line.spiItemId!,
          quantity: c.qty,
          is_stackable: data.stackable,
          remark: data.remark,
          remark_note: note || null,
          flags: ids,
          serial_no: id.serial || null,
          lot_no: id.lot || null,
          batch_no: id.batch || null,
          cat_no: id.cat || null,
          expiry_date: id.expiry || null,
          mfg_date: id.mfg || null,
        };
      }),
    };
  };

  const persist = async (key: string, scenario: Scenario, data: BoxSaveData, contents: Array<{ line: ProductLine; qty: number }>) => {
    if (readOnly || !onCreateBox) return null;
    if (contents.some(c => c.line.spiItemId == null)) {
      toast.warning('Save Stage 02 first', 'This product is not on the saved invoice yet.');
      return null;
    }
    const err = validate(scenario, data, contents);
    if (err) { toast.warning('Box not saved', err); return null; }
    const { missing } = flagIdsFor(data);
    if (missing.length) {
      toast.info('Some flags were not saved', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the Product Flag master yet.`);
    }
    setSavingKey(key);
    try {
      return await onCreateBox(bodyFor(scenario, data, contents));
    } finally {
      setSavingKey(null);
    }
  };

  const saveSingle = (line: ProductLine, data: BoxSaveData) =>
    void persist(line.code, 's1', data, [{ line, qty: line.spiQty }]);

  const saveSplitBox = async (line: ProductLine, no: number, qty: number, data: BoxSaveData) => {
    const box = await persist(`${line.code}#${no}`, 's2', data, [{ line, qty }]);
    if (box) setSplitCodes(m => ({ ...m, [line.code]: { ...(m[line.code] ?? {}), [no]: box.box_code } }));
  };

  const saveMixedBox = async (data: BoxSaveData) => {
    if (mixedLines.length < 2) {
      toast.warning('Pick at least 2 products', 'A mixed carton holds two or more products — use a single box for one.');
      return;
    }
    const box = await persist('mixed', 's3', data, mixedLines.map(l => ({ line: l, qty: l.spiQty })));
    if (!box) return;
    setPacking(p => {
      const next = { ...p };
      for (const l of mixedLines) next[l.code] = { scenario: 's3' };
      return next;
    });
    setMixedBox(null);
  };

  const singleBox = (line: ProductLine) => {
    if (readOnly) return;
    if (packing[line.code]) {
      toast.info('Already in a box', `${line.spiName} is already set up — use ✕ on its scenario chip to change it.`);
      return;
    }
    setPacking(p => ({ ...p, [line.code]: { scenario: 's1' } }));
  };

  const applySplit = (line: ProductLine) => {
    if (readOnly || packing[line.code]) return;
    const raw = (subBox[line.code] ?? '').trim();
    const maxBoxes = Math.max(1, Math.floor(line.spiQty));
    const fail = (msg: string) => {
      setInvalid(line.code);
      window.setTimeout(() => setInvalid(null), 2000);
      toast.warning('Sub-box count not valid', msg);
    };
    if (!/^\d+$/.test(raw)) { fail('Enter a whole number of boxes, like 3.'); return; }
    const count = parseInt(raw, 10);
    if (count < 1) { fail('A split needs at least 1 box.'); return; }
    if (count > maxBoxes) { fail(`${line.spiName} has ${line.spiQty} units — it cannot fill more than ${maxBoxes} boxes.`); return; }
    setInvalid(null);
    setPacking(p => ({ ...p, [line.code]: { scenario: 's2', boxes: splitQuantity(line.spiQty, count) } }));
  };

  const setBoxQty = (code: string, boxNo: number, qty: number) => {
    const pack = packing[code];
    if (!pack || pack.scenario !== 's2') return;
    const line = lines.find(l => l.code === code);
    const total = line?.spiQty ?? 0;
    const others = pack.boxes.reduce((n, b) => (b.no === boxNo ? n : n + b.qty), 0);
    const max = Math.max(0, total - others);
    const wanted = Math.max(0, qty);
    if (wanted > max) {
      toast.warning(
        `Box ${boxNo} can hold at most ${max} unit${max === 1 ? '' : 's'}`,
        `${line?.spiName ?? 'This product'} has ${total} units on the SPI, and the other boxes already hold ${others}.`,
      );
    }
    const next = Math.min(wanted, max);
    setPacking(p => {
      const cur = p[code];
      if (!cur || cur.scenario !== 's2') return p;
      return { ...p, [code]: { ...cur, boxes: cur.boxes.map(b => (b.no === boxNo ? { ...b, qty: next } : b)) } };
    });
  };

  const clearLocal = (codes: string[]) => {
    setPacking(p => { const next = { ...p }; for (const c of codes) delete next[c]; return next; });
    setSplitCodes(m => { const next = { ...m }; for (const c of codes) delete next[c]; return next; });
  };

  const reset = async (code: string) => {
    if (readOnly) return;
    const bs = boxesOf(code);
    if (!bs.length) { clearLocal([code]); return; }
    const affected = [...new Set(bs.flatMap(b => b.items.map(i => codeOfItem.get(i.supplier_invoice_item_id)).filter((c): c is string => !!c)))];
    const line = lines.find(l => l.code === code);
    const ok = await confirm({
      title: 'Remove these boxes?',
      message: `${bs.map(b => b.box_code).join(', ')} will be deleted and ${affected.length > 1
        ? `${affected.length} products (${affected.join(', ')})`
        : line?.spiName ?? code} will go back to Pending.`,
      tone: 'danger',
      confirmLabel: `Remove ${bs.length === 1 ? 'box' : `${bs.length} boxes`}`,
    });
    if (!ok || !onDeleteBoxes) return;
    const ordered = [...bs].sort((a, b) => b.box_code.localeCompare(a.box_code, undefined, { numeric: true }));
    if (await onDeleteBoxes(ordered.map(b => b.id))) clearLocal(affected);
  };

  return (
    <>
      <StageSummary draft={draft} upto={2} />

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
                {scenarioUse[s.id] > 0 && (
                  <span className="pkg-card__use is-on">
                    {scenarioUse[s.id]} Product{scenarioUse[s.id] === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="pkg-card__title">{s.title} <span>{s.arrow}</span> {s.tail}</div>
              <div className="pkg-card__desc">{s.desc}</div>
              <span className="pkg-card__tag">{s.tag}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="vti-box">
        <div className="vti-header">
          <div className="vti-header-ico"><IcoShip size={18} stroke={2.2} /></div>
          <div className="vti-header-text">
            <div className="vti-header-title">SPI Box Generation System</div>
            <div className="vti-header-sub">
              Products — {draft.invoiceNumber || 'this invoice'} &nbsp;·&nbsp; Create boxes with dimensions &amp; stickers
            </div>
          </div>
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
              <tr>
                <th>
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
                      {mixed ? (
                        <div className="vti-cb is-checked" role="checkbox" aria-checked
                          aria-label={`${line.spiName} is in the master carton`} />
                      ) : pack ? (
                        <Tooltip label={`Locked by ${scenarioNo}`}>
                          <div className="vti-scn-lock is-cb">
                            <IcoLock size={10} stroke={2.6} />
                          </div>
                        </Tooltip>
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
                            <Tooltip label="Reset the packaging scenario for this product">
                              <span className="vti-scn-chip is-on"
                                onClick={() => void reset(line.code)}>
                                <span className="vti-scn-chip-dot" />
                                {scenarioLabel}
                                <span className="vti-scn-chip-x">✕</span>
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </td>
                    <td><span className="vti-code">{line.code}</span></td>
                    <td className="vti-desc">
                      <Tooltip label={line.description} disabled={line.description.length <= DESC_MAX}>
                        <span className="vti-desc__wrap">{truncateDesc(line.description)}</span>
                      </Tooltip>
                    </td>
                    <td><span className="vti-qty-badge">{line.spiQty}</span></td>
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
                            className="vti-subbox-inp" type="number" min={1}
                            placeholder="e.g. 3"
                            style={invalid === line.code ? { borderColor: '#ef4444' } : undefined}
                            value={split ? String(pack.boxes.length) : (subBox[line.code] ?? '')}
                            readOnly={split}
                            onChange={e => setSubBox(s => ({ ...s, [line.code]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySplit(line); } }}
                          />
                          <button type="button"
                            className={`vti-btn-apply${split ? ' is-done' : ''}`}
                            onClick={() => (split ? void reset(line.code) : applySplit(line))}>
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

                  {single && (
                    <tr className="vti-drawer-row is-open">
                      <td colSpan={BOX_TABLE_COLUMNS} className="vti-drawer-td">
                        <BoxDrawer
                          boxId="New box"
                          line={line}
                          quantity={line.spiQty}
                          onSave={readOnly ? undefined : (d: BoxSaveData) => saveSingle(line, d)}
                          saving={savingKey === line.code}
                          customFlags={customFlags}
                        />
                      </td>
                    </tr>
                  )}

                  {split && (
                    <tr className="vti-multibox-container-row">
                      <td colSpan={BOX_TABLE_COLUMNS} style={{ padding: 0, border: 'none', background: 'transparent' }}>
                        <MultiBoxPanel line={line} boxes={pack.boxes}
                          onClose={() => void reset(line.code)}
                          onSaveBox={(no, qty, d) => void saveSplitBox(line, no, qty, d)}
                          savedCodes={splitCodes[line.code]}
                          savingNo={savingKey?.startsWith(`${line.code}#`) ? Number(savingKey.split('#')[1]) : null}
                          readOnly={readOnly}
                          customFlags={customFlags}
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

      {mixedBox && mixedBox.length > 0 && (
          <BoxDrawer
            boxId="New mixed carton"
            line={mixedCartonLine}
            quantity={mixedCartonQty}
            scenario="Multiple Products → 1 Box"
            modeKey="Products"
            modeLabel={`${mixedBox.length} SKU${mixedBox.length === 1 ? '' : 's'}`}
            variant="panel"
            contents={mixedLines.map(l => ({ line: l, qty: l.spiQty }))}
            onRemoveContent={takeOutOfBox}
            onClearContents={() => setMixedBox(null)}
            onSave={readOnly ? undefined : (d: BoxSaveData) => void saveMixedBox(d)}
            saving={savingKey === 'mixed'}
            customFlags={customFlags}
          />
      )}

      <PackedProducts
        rows={packedRows}
        onEdit={readOnly ? undefined : code => void reset(code)}
      />
    </>
  );
}

function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
