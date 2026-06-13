import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';

/* ───────────────────────────────────────────────────────────────────────
 * Central CLM → Trade Documents Master → Draft Editor → Insert Placeholder
 *
 * Picker popup shown when the user clicks "{} Placeholder" in the draft
 * editor toolbar. Three party tabs (Customer, Consignee, Supplier); each
 * card inserts a {{token}} at the editor caret via the onInsert callback.
 *
 * The signature placeholder lives in every tab — it's used to drop the
 * party's saved e-signature image at generation time.
 * ─────────────────────────────────────────────────────────────────────── */

type Tab = 'customer' | 'consignee' | 'supplier' | 'product';
type Field = { label: string; token: string; isSignature?: boolean };

const FIELDS: Record<Tab, Field[]> = {
  customer: [
    { label: 'Customer Name',   token: '{{customer.name}}' },
    { label: 'Customer Code',   token: '{{customer.code}}' },
    { label: 'Company',         token: '{{customer.company}}' },
    { label: 'Contact Person',  token: '{{customer.contact_person}}' },
    { label: 'Phone',           token: '{{customer.phone}}' },
    { label: 'Email',           token: '{{customer.email}}' },
    { label: 'GST',             token: '{{customer.gst}}' },
    { label: 'Country',         token: '{{customer.country}}' },
    { label: 'Address',         token: '{{customer.address}}' },
    { label: 'PAN',             token: '{{customer.pan}}' },
    { label: 'IEC',             token: '{{customer.iec}}' },
  ],
  consignee: [
    { label: 'Consignee Name',  token: '{{consignee.name}}' },
    { label: 'Consignee Code',  token: '{{consignee.code}}' },
    { label: 'Contact Person',  token: '{{consignee.contact_person}}' },
    { label: 'Phone',           token: '{{consignee.phone}}' },
    { label: 'Email',           token: '{{consignee.email}}' },
    { label: 'Country',         token: '{{consignee.country}}' },
    { label: 'Address',         token: '{{consignee.address}}' },
  ],
  supplier: [
    { label: 'Supplier Name',   token: '{{supplier.name}}' },
    { label: 'Supplier Code',   token: '{{supplier.code}}' },
    { label: 'Company',         token: '{{supplier.company}}' },
    { label: 'Contact Person',  token: '{{supplier.contact_person}}' },
    { label: 'Phone',           token: '{{supplier.phone}}' },
    { label: 'Email',           token: '{{supplier.email}}' },
    { label: 'GST',             token: '{{supplier.gst}}' },
    { label: 'Country',         token: '{{supplier.country}}' },
    { label: 'Address',         token: '{{supplier.address}}' },
    { label: 'PAN',             token: '{{supplier.pan}}' },
    { label: 'Bank Account',    token: '{{supplier.bank_account}}' },
  ],
  // Product placeholders mirror the Proforma Invoice product table columns
  // (code · name · segment · quantity). The renderer expands {{product.*}}
  // tokens into a row per mapped product at generation time.
  product: [
    { label: 'Product Code',        token: '{{product.code}}' },
    { label: 'Product Name',        token: '{{product.name}}' },
    { label: 'Product Segment',     token: '{{product.segment}}' },
    { label: 'Quantity',            token: '{{product.quantity}}' },
    { label: 'HSN/SAC Code',        token: '{{product.hsn_sac}}' },
    { label: 'Product Description', token: '{{product.description}}' },
    { label: 'Haz / Non-Haz',       token: '{{product.haz}}' },
  ],
};

const TABS: { key: Tab; label: string; icon: string; color: string }[] = [
  { key: 'customer',  label: 'Customer',  icon: '👤', color: '#6366f1' },
  { key: 'consignee', label: 'Consignee', icon: '🚚', color: '#f59e0b' },
  { key: 'supplier',  label: 'Supplier',  icon: '📦', color: '#10b981' },
  { key: 'product',   label: 'Product',   icon: '🛒', color: '#8b5cf6' },
];

/* The Product Table is column-configurable: the user ticks which columns to
 * include and we build the table HTML from that selection. The single tbody
 * row carries the {{product.*}} tokens and acts as the template the renderer
 * repeats once per mapped product at generation time. Inline styles keep it
 * intact through the contenteditable editor and the DOCX/PDF export. */
const TD_CELL = 'border:1px solid #cbd5e1;padding:6px 10px;';
const TH_CELL = `${TD_CELL}background:#f1f5f9;font-weight:700;text-align:left;`;
type ProductCol = { key: string; label: string; token: string; align?: 'right' };
const PRODUCT_COLUMNS: ProductCol[] = [
  { key: 'code',        label: 'Code',        token: '{{product.code}}' },
  { key: 'name',        label: 'Name',        token: '{{product.name}}' },
  { key: 'segment',     label: 'Segment',     token: '{{product.segment}}' },
  { key: 'quantity',    label: 'Quantity',    token: '{{product.quantity}}', align: 'right' },
  { key: 'hsn_sac',     label: 'HSN/SAC',     token: '{{product.hsn_sac}}' },
  { key: 'description', label: 'Description', token: '{{product.description}}' },
  { key: 'haz',         label: 'Haz/Non-Haz', token: '{{product.haz}}' },
];
const DEFAULT_TABLE_COLS = ['code', 'name', 'segment', 'quantity'];

function buildProductTableHtml(keys: string[]): string {
  const cols = PRODUCT_COLUMNS.filter(c => keys.includes(c.key));   // preserves column order
  const th = (txt: string, right?: boolean) => `<th style="${TH_CELL}${right ? 'text-align:right;' : ''}">${txt}</th>`;
  const td = (content: string, right?: boolean) => `<td style="${TD_CELL}${right ? 'text-align:right;' : ''}">${content}</td>`;
  const head = th('#') + cols.map(c => th(c.label, c.align === 'right')).join('');
  const body = td('{{product.sr}}') + cols.map(c => td(c.token, c.align === 'right')).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;">`
    + `<thead><tr>${head}</tr></thead><tbody><tr>${body}</tr></tbody></table>`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (token: string) => void;
  /* Case-to-case agreements have no Proforma-Invoice product mapping, so the
     Product placeholder tab is hidden there. Defaults to shown elsewhere
     (Trade Documents Master, customer signature flows). */
  hideProductTab?: boolean;
}

export default function ClmInsertPlaceholderModal({ open, onClose, onInsert, hideProductTab = false }: Props) {
  const toast = useToast();
  // Tabs available in this context — Product is dropped for case-to-case.
  const visibleTabs = hideProductTab ? TABS.filter(t => t.key !== 'product') : TABS;
  const [tab, setTab] = useState<Tab>('customer');
  // Multi-select: tokens the user has ticked across ALL tabs. Persists
  // while the modal is open so a single "Copy selected" can grab a mix of
  // customer + consignee + supplier placeholders in one go.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which columns the Product Table should include (ticked in the builder).
  const [tableCols, setTableCols] = useState<Set<string>>(new Set(DEFAULT_TABLE_COLS));
  const toggleCol = (k: string) => setTableCols(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Clear the ticked set every time the picker re-opens so a fresh session
  // never inherits a stale selection.
  useEffect(() => { if (!open) setSelected(new Set()); }, [open]);

  /* Low-level clipboard write — uses navigator.clipboard when available and
   * falls back to a hidden textarea on browsers without it (older Safari,
   * non-secure contexts). Shared by single + multi copy. */
  const writeClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  /* Copy a single raw {{Token}} to clipboard. */
  const copyToken = async (token: string) => {
    try {
      await writeClipboard(token);
      toast.success('Copied', `${token} copied to clipboard.`);
    } catch {
      toast.error('Could not copy', 'Clipboard access was blocked — copy manually.');
    }
  };

  /* Copy every ticked placeholder at once, space-separated, in the same
   * group order they appear in the picker. */
  const copySelected = async () => {
    if (selected.size === 0) return;
    const ordered = Object.values(FIELDS).flat()
      .map(f => f.token)
      .filter(tok => selected.has(tok));
    try {
      await writeClipboard(ordered.join(' '));
      toast.success('Copied', `${ordered.length} placeholder${ordered.length === 1 ? '' : 's'} copied to clipboard.`);
    } catch {
      toast.error('Could not copy', 'Clipboard access was blocked — copy manually.');
    }
  };

  const toggleSelect = (token: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token); else next.add(token);
      return next;
    });
  };

  if (!open) return null;

  const fields    = FIELDS[tab];
  const tabHeader = TABS.find(t => t.key === tab)!;
  const allInTabSelected = fields.length > 0 && fields.every(f => selected.has(f.token));
  const toggleSelectAllInTab = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allInTabSelected) fields.forEach(f => next.delete(f.token));
      else fields.forEach(f => next.add(f.token));
      return next;
    });
  };

  return createPortal(
    <div className="ipm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <style>{IPM_CSS}</style>
      <div className="ipm-shell" onMouseDown={e => e.stopPropagation()}>
        <div className="ipm-head">
          <div className="ipm-head-left">
            <div className="ipm-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
            </div>
            <div className="ipm-head-text">
              <div className="ipm-head-label">DRAFT EDITOR</div>
              <div className="ipm-head-title">Insert Placeholder</div>
            </div>
          </div>
          <div className="ipm-head-right">
            <div className="ipm-token-chip">{'{{group.field}}'}</div>
            <button type="button" className="ipm-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div className="ipm-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          Click a field to insert it, or tick the checkboxes and use “Copy selected” to copy several placeholders at once.
        </div>

        <div className="ipm-body">
          <aside className="ipm-tabs">
            {visibleTabs.map(t => {
              const count = FIELDS[t.key].length;
              const active = t.key === tab;
              return (
                <button key={t.key} type="button" className={`ipm-tab ${active ? 'is-active' : ''}`} onClick={() => setTab(t.key)} style={active ? { ['--ipm-accent' as any]: t.color } : undefined}>
                  <span className="ipm-tab-ico" style={{ background: `${t.color}1f`, color: t.color }}>{t.icon}</span>
                  <span className="ipm-tab-text">
                    <span className="ipm-tab-label" style={{ color: t.color }}>{t.label}</span>
                    <span className="ipm-tab-sub">{count} fields</span>
                  </span>
                </button>
              );
            })}
          </aside>

          <section className="ipm-pane">
            <header className="ipm-pane-head">
              <span className="ipm-pane-ico" style={{ background: `${tabHeader.color}1f`, color: tabHeader.color }}>{tabHeader.icon}</span>
              <div>
                <div className="ipm-pane-title">{tabHeader.label} Fields</div>
                <div className="ipm-pane-sub">Select a field to insert its placeholder into the document</div>
              </div>
            </header>

            <div className="ipm-selbar">
              <label className="ipm-selall">
                <input type="checkbox" checked={allInTabSelected} onChange={toggleSelectAllInTab} />
                Select all in {tabHeader.label} ({fields.length})
              </label>
              <div className="ipm-selbar-actions">
                <span className="ipm-selcount">{selected.size} selected</span>
                <button type="button" className="ipm-selbtn ipm-selbtn-copy" disabled={selected.size === 0}
                        onClick={() => void copySelected()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy selected
                </button>
                <button type="button" className="ipm-selbtn" disabled={selected.size === 0}
                        onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            </div>

            <div className="ipm-grid">
              {tab === 'product' && (
                <div className="ipm-card ipm-card-table">
                  <span className="ipm-card-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 7 }}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                    Product Table
                  </span>
                  <span className="ipm-card-tabledesc">Tick the columns to include, then insert — one row per product at generation time.</span>
                  <div className="ipm-tablecols">
                    {PRODUCT_COLUMNS.map(c => (
                      <label key={c.key} className={`ipm-tablecol ${tableCols.has(c.key) ? 'on' : ''}`}>
                        <input type="checkbox" checked={tableCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <button type="button" className="ipm-table-insert" disabled={tableCols.size === 0}
                    onClick={() => onInsert(buildProductTableHtml([...tableCols]))}>
                    Insert Table ({tableCols.size} column{tableCols.size === 1 ? '' : 's'})
                  </button>
                </div>
              )}
              {fields.map(f => {
                const isChecked = selected.has(f.token);
                return (
                <div key={f.token} className={`ipm-card ${f.isSignature ? 'is-sig' : ''} ${isChecked ? 'is-checked' : ''}`} role="button" tabIndex={0}
                     onClick={() => onInsert(f.token)}
                     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInsert(f.token); } }}>
                  <span className="ipm-card-label">
                    <input type="checkbox" className="ipm-card-check" checked={isChecked}
                           title="Select for bulk copy" aria-label={`Select ${f.token} for bulk copy`}
                           onClick={e => e.stopPropagation()}
                           onChange={() => toggleSelect(f.token)} />
                    {f.isSignature && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M20 19c-2-1-3-2-5-2-3 0-5 2-7 2s-3-1-3-3 1-3 3-3 4 2 7 2 3-1 5-2"/></svg>
                    )}
                    {f.label}
                  </span>
                  <span className="ipm-card-row">
                    <span className="ipm-card-token">{f.token}</span>
                    <button type="button" className="ipm-card-copy" title={`Copy ${f.token}`} aria-label={`Copy ${f.token}`}
                            onClick={e => { e.stopPropagation(); void copyToken(f.token); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </span>
                </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const IPM_CSS = `
.ipm-overlay {
  position: fixed; inset: 0; z-index: 260000;
  background: rgba(7,30,50,.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: ipmFade .18s ease both;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
@keyframes ipmFade { from { opacity: 0 } to { opacity: 1 } }
.ipm-shell {
  width: 100%; max-width: 1080px; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff;
  box-shadow: 0 28px 70px rgba(15,23,42,.50), 0 0 0 1px rgba(6,182,212,.20);
  border: 1px solid rgba(6,182,212,.20);
  animation: ipmSlide .22s cubic-bezier(.22,1,.36,1) both;
}
@keyframes ipmSlide { from { opacity: 0; transform: translateY(16px) scale(.97) } to { opacity: 1; transform: none } }

.ipm-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px;
  padding: 18px 22px;
  background: linear-gradient(110deg, #0c6680 0%, #0e7490 35%, #0891b2 75%, #06b6d4 100%);
  color: #fff;
  flex-shrink: 0;
}
.ipm-head-left { display: inline-flex; align-items: center; gap: 12px; min-width: 0; }
.ipm-head-ico {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
}
.ipm-head-label { font-size: 10px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); text-transform: uppercase; }
.ipm-head-title { font-size: 18px; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; margin-top: 2px; }
.ipm-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.ipm-token-chip {
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.26);
  border-radius: 8px; padding: 6px 12px;
  color: #fff; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700;
}
.ipm-close {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.ipm-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }

.ipm-info {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 22px;
  background: #ecfeff; color: #0e7490;
  font-size: 12.5px; font-weight: 500;
  border-bottom: 1px solid rgba(6,182,212,.20);
}

.ipm-body {
  flex: 1; min-height: 0;
  display: grid; grid-template-columns: 200px 1fr;
  background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%);
}
.ipm-tabs {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 12px;
  border-right: 1px solid rgba(6,182,212,.18);
  background: rgba(255,255,255,.55);
  overflow-y: auto;
}
.ipm-tab {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 11px;
  border: 1.5px solid transparent;
  background: transparent;
  cursor: pointer; text-align: left;
  transition: background .15s ease, border-color .15s ease, box-shadow .22s ease, transform .15s ease;
}
.ipm-tab:hover { background: #fff; border-color: rgba(6,182,212,.18); }
.ipm-tab.is-active {
  background: #fff;
  border-color: var(--ipm-accent, #0891b2);
  box-shadow: 0 6px 18px rgba(8,145,178,.18);
}
.ipm-tab-ico {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.ipm-tab-text { display: flex; flex-direction: column; min-width: 0; }
.ipm-tab-label { font-size: 13px; font-weight: 800; letter-spacing: -.01em; }
.ipm-tab-sub { font-size: 11px; color: #94a3b8; margin-top: 1px; font-weight: 600; }

.ipm-pane {
  display: flex; flex-direction: column; gap: 14px;
  padding: 18px 22px;
  overflow-y: auto;
  min-height: 0;
}
.ipm-pane-head { display: inline-flex; align-items: center; gap: 12px; }
.ipm-pane-ico { width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; }
.ipm-pane-title { font-size: 16px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; }
.ipm-pane-sub { font-size: 12px; color: #64748b; margin-top: 2px; }

.ipm-selbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  flex-wrap: wrap;
  padding: 9px 12px; border-radius: 10px;
  background: #fff; border: 1.5px solid rgba(6,182,212,.20);
}
.ipm-selall {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 700; color: #0c4a6e; cursor: pointer; margin: 0;
}
.ipm-selall input { width: 15px; height: 15px; accent-color: #0891b2; cursor: pointer; }
.ipm-selbar-actions { display: inline-flex; align-items: center; gap: 8px; }
.ipm-selcount { font-size: 12px; font-weight: 700; color: #64748b; }
.ipm-selbtn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px;
  border: 1.5px solid rgba(6,182,212,.25); background: #fff;
  color: #0e7490; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s ease, border-color .15s ease, opacity .15s ease, transform .15s ease;
}
.ipm-selbtn:hover:not(:disabled) { background: #ecfeff; border-color: #0891b2; transform: translateY(-1px); }
.ipm-selbtn:disabled { opacity: .45; cursor: not-allowed; }
.ipm-selbtn-copy { background: #0891b2; border-color: #0891b2; color: #fff; }
.ipm-selbtn-copy:hover:not(:disabled) { background: #0e7490; border-color: #0e7490; color: #fff; }

.ipm-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ipm-card-table { grid-column: 1 / -1; border-color: rgba(139,92,246,.35); background: linear-gradient(180deg, #fff 0%, #f5f3ff 100%); }
.ipm-card-table:hover { border-color: #8b5cf6; background: #f5f3ff; box-shadow: 0 8px 20px rgba(139,92,246,.22); }
.ipm-card-table .ipm-card-label { color: #6d28d9; }
.ipm-card-tabledesc { font-size: 12px; color: #7c3aed; font-weight: 500; }
[data-bs-theme="dark"] .ipm-card-table { background: linear-gradient(180deg, #1e293b 0%, rgba(139,92,246,.16) 100%); border-color: rgba(139,92,246,.40); }
[data-bs-theme="dark"] .ipm-card-table .ipm-card-label { color: #c4b5fd; }
[data-bs-theme="dark"] .ipm-card-tabledesc { color: #c4b5fd; }
.ipm-tablecols { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.ipm-tablecol {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 7px; cursor: pointer; user-select: none;
  font-size: 11.5px; font-weight: 600; color: #6d28d9;
  border: 1.5px solid rgba(139,92,246,.3); background: #fff;
}
.ipm-tablecol.on { background: #f5f3ff; border-color: #8b5cf6; }
.ipm-tablecol input { accent-color: #8b5cf6; cursor: pointer; margin: 0; }
.ipm-table-insert {
  margin-top: 11px; align-self: flex-start;
  padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer;
  background: #8b5cf6; color: #fff; font-size: 12px; font-weight: 700;
  transition: background .15s;
}
.ipm-table-insert:hover:not(:disabled) { background: #7c3aed; }
.ipm-table-insert:disabled { opacity: .5; cursor: not-allowed; }
[data-bs-theme="dark"] .ipm-tablecol { background: #1e293b; color: #c4b5fd; border-color: rgba(139,92,246,.4); }
[data-bs-theme="dark"] .ipm-tablecol.on { background: rgba(139,92,246,.22); border-color: #a78bfa; }
.ipm-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 13px 14px; border-radius: 11px;
  border: 1.5px solid rgba(6,182,212,.18);
  background: #fff;
  cursor: pointer; text-align: left;
  transition: border-color .15s ease, box-shadow .22s ease, transform .15s ease, background .15s ease;
}
.ipm-card:hover { border-color: #0891b2; transform: translateY(-1px); box-shadow: 0 8px 20px rgba(8,145,178,.18); background: #f0fdff; }
.ipm-card.is-sig { border-color: rgba(99,102,241,.35); background: linear-gradient(180deg, #fff 0%, #eef2ff 100%); }
.ipm-card.is-sig:hover { border-color: #6366f1; box-shadow: 0 8px 20px rgba(99,102,241,.25); }
.ipm-card.is-checked { border-color: #0891b2; background: #ecfeff; box-shadow: 0 0 0 1px rgba(8,145,178,.30) inset; }
.ipm-card.is-sig.is-checked { border-color: #6366f1; background: #eef2ff; box-shadow: 0 0 0 1px rgba(99,102,241,.30) inset; }
.ipm-card-check { width: 15px; height: 15px; flex-shrink: 0; margin-right: 8px; accent-color: #0891b2; cursor: pointer; }
.ipm-card.is-sig .ipm-card-check { accent-color: #6366f1; }
.ipm-card-label {
  display: inline-flex; align-items: center;
  font-size: 13px; font-weight: 700; color: #0c4a6e;
}
.ipm-card.is-sig .ipm-card-label { color: #4338ca; }
.ipm-card-row { display: inline-flex; align-items: center; gap: 6px; }
.ipm-card-token {
  background: #ecfeff; border: 1px solid rgba(6,182,212,.25);
  padding: 4px 9px; border-radius: 6px;
  color: #0891b2; font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 700;
}
.ipm-card.is-sig .ipm-card-token { background: #eef2ff; border-color: rgba(99,102,241,.30); color: #4338ca; }
.ipm-card-copy {
  width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent;
  color: #64748b; cursor: pointer;
  opacity: 0;
  transition: opacity .15s ease, background .15s ease, color .15s ease, border-color .15s ease;
}
.ipm-card:hover .ipm-card-copy,
.ipm-card:focus-within .ipm-card-copy { opacity: 1; }
.ipm-card-copy:hover { background: #ecfeff; border-color: rgba(6,182,212,.30); color: #0891b2; }
.ipm-card.is-sig .ipm-card-copy:hover { background: #eef2ff; border-color: rgba(99,102,241,.30); color: #4338ca; }

@media (max-width: 820px) {
  .ipm-body { grid-template-columns: 1fr; }
  .ipm-tabs {
    flex-direction: row; flex-wrap: wrap; border-right: none;
    border-bottom: 1px solid rgba(6,182,212,.18);
  }
  .ipm-tab { flex: 1; min-width: 140px; }
  .ipm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 540px) {
  .ipm-grid { grid-template-columns: 1fr; }
  .ipm-head { flex-direction: column; align-items: stretch; }
  .ipm-head-right { justify-content: space-between; }
}

[data-bs-theme="dark"] .ipm-shell { background: #0f172a; }
[data-bs-theme="dark"] .ipm-info { background: rgba(8,145,178,.10); color: #67e8f9; border-bottom-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .ipm-body { background: linear-gradient(160deg, rgba(8,145,178,.06) 0%, rgba(8,145,178,.03) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .ipm-tabs { background: rgba(255,255,255,.03); border-right-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .ipm-tab:hover { background: rgba(8,145,178,.10); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .ipm-tab.is-active { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .ipm-tab-sub { color: #94a3b8; }
[data-bs-theme="dark"] .ipm-pane-title { color: #cffafe; }
[data-bs-theme="dark"] .ipm-pane-sub { color: #94a3b8; }
[data-bs-theme="dark"] .ipm-card { background: #1e293b; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .ipm-card-label { color: #e2e8f0; }
[data-bs-theme="dark"] .ipm-card-token { background: rgba(8,145,178,.18); border-color: rgba(6,182,212,.30); color: #67e8f9; }
[data-bs-theme="dark"] .ipm-card:hover { background: rgba(8,145,178,.20); border-color: #67e8f9; }
[data-bs-theme="dark"] .ipm-card.is-sig { background: linear-gradient(180deg, #1e293b 0%, rgba(99,102,241,.16) 100%); }
[data-bs-theme="dark"] .ipm-card.is-sig .ipm-card-label,
[data-bs-theme="dark"] .ipm-card.is-sig .ipm-card-token { color: #a5b4fc; border-color: rgba(165,180,252,.30); background: rgba(99,102,241,.20); }
[data-bs-theme="dark"] .ipm-selbar { background: #1e293b; border-color: rgba(6,182,212,.25); }
[data-bs-theme="dark"] .ipm-selall { color: #cffafe; }
[data-bs-theme="dark"] .ipm-selcount { color: #94a3b8; }
[data-bs-theme="dark"] .ipm-selbtn { background: #1e293b; border-color: rgba(6,182,212,.30); color: #67e8f9; }
[data-bs-theme="dark"] .ipm-selbtn:hover:not(:disabled) { background: rgba(8,145,178,.20); border-color: #67e8f9; }
[data-bs-theme="dark"] .ipm-selbtn-copy { background: #0891b2; border-color: #0891b2; color: #fff; }
[data-bs-theme="dark"] .ipm-selbtn-copy:hover:not(:disabled) { background: #0e7490; border-color: #0e7490; }
[data-bs-theme="dark"] .ipm-card.is-checked { background: rgba(8,145,178,.20); border-color: #67e8f9; }
[data-bs-theme="dark"] .ipm-card.is-sig.is-checked { background: rgba(99,102,241,.22); border-color: #a5b4fc; }
[data-bs-theme="dark"] .ipm-card-copy { color: #94a3b8; }
[data-bs-theme="dark"] .ipm-card-copy:hover { background: rgba(8,145,178,.20); border-color: rgba(103,232,249,.30); color: #67e8f9; }
[data-bs-theme="dark"] .ipm-card.is-sig .ipm-card-copy:hover { background: rgba(99,102,241,.25); border-color: rgba(165,180,252,.35); color: #a5b4fc; }
`;
