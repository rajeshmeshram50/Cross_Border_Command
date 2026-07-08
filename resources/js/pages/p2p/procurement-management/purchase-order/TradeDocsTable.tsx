import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Trade Documents table — shared by the Trade Documents & Agreements modal
 * (row action) and the Create-PO wizard's stage 4.
 *
 * Two tabs: "Trade Documents" (Purchase Order) and "Agreements" (Purchase
 * Agreement). Zoho-Sign-style list: per-row Send for Sign, bulk send, and —
 * once a document is sent — Track + Reminder actions. A kebab (⋮) menu exposes
 * Download / View (with & without signature) and Certificate of Origin.
 * Frontend-only; downstream actions are toast placeholders.
 * ───────────────────────────────────────────────────────────────────────── */

type Cat = 'trade' | 'agreement';
type TradeDoc = { id: string; name: string; sub: string; cat: Cat; required: boolean; generated: string; status: 'pending' | 'sent' | 'signed' };
const TODAY = (() => { const d = new Date(); const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return `${dd}/${mm}/${d.getFullYear()}`; })();
// Constants always present (Purchase Order + Purchase Agreement); the rest are
// fetched from the CLM Trade Document / Agreement masters for the supplier.
const makeConstants = (po: string): TradeDoc[] => [
  { id: 'po', name: 'Purchase Order', sub: po, cat: 'trade', required: true, generated: TODAY, status: 'pending' },
  { id: 'pa', name: 'Purchase Agreement', sub: 'Agreement', cat: 'agreement', required: true, generated: TODAY, status: 'pending' },
];

type MenuState = { id: string; name: string; left: number; top: number; maxH: number; open: boolean };

const I = {
  send: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>),
  mail: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22 6 12 13 2 6" /></svg>),
  track: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>),
  reminder: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>),
  kebab: (<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>),
  eye: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>),
  down: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>),
  cert: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></svg>),
  fileSm: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
  tabDoc: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  tabAgr: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>),
};

export default function TradeDocsTable({ po = 'PO/2025-26/001', supplierId }: { po?: string; supplierId?: number | null }) {
  const toast = useToast();
  const [docs, setDocs] = useState<TradeDoc[]>(() => makeConstants(po));
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Cat>('trade');

  // Fetch applicable Trade Documents + Agreements for the supplier from the CLM
  // masters (segment + supplier-party matched). PO / Purchase Agreement are the
  // constants; anything else is master-driven.
  useEffect(() => {
    if (!supplierId) { setDocs(makeConstants(po)); return; }
    let cancelled = false;
    api.get(`/p2p/purchase-orders/suppliers/${supplierId}/trade-documents`).then(r => {
      if (cancelled) return;
      const d = r.data?.data;
      const list: TradeDoc[] = [];
      const push = (arr: Array<Record<string, unknown>> | undefined, cat: Cat) => (arr ?? []).forEach(x => {
        const id = String(x.id);
        list.push({
          id, cat,
          name: String(x.name ?? (cat === 'trade' ? 'Trade Document' : 'Agreement')),
          sub: id === 'po' ? po : id === 'pa' ? 'Agreement' : String(x.sub ?? ''),
          required: !!x.required, generated: TODAY, status: 'pending',
        });
      });
      push(d?.trade, 'trade');
      push(d?.agreements, 'agreement');
      setDocs(list.length ? list : makeConstants(po));
    }).catch(() => { if (!cancelled) setDocs(makeConstants(po)); });
    return () => { cancelled = true; };
  }, [supplierId, po]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuPopRef = useRef<HTMLDivElement | null>(null);

  const tradeCount = docs.filter(d => d.cat === 'trade').length;
  const agrCount = docs.filter(d => d.cat === 'agreement').length;
  const visible = docs.filter(d => d.cat === tab);
  const pendingCount = visible.filter(d => d.status === 'pending').length;
  const selCount = visible.filter(d => d.status === 'pending' && sel[d.id]).length;

  const toggleDoc = (id: string, on: boolean) => setSel(s => { const n = { ...s }; if (on) n[id] = true; else delete n[id]; return n; });
  const toggleAll = (on: boolean) => setSel(s => { const n = { ...s }; visible.forEach(d => { if (d.status === 'pending') { if (on) n[d.id] = true; else delete n[d.id]; } }); return n; });
  const sendDoc = (id: string) => { const d = docs.find(x => x.id === id); setDocs(ds => ds.map(x => x.id === id ? { ...x, status: 'sent' } : x)); setSel(s => { const n = { ...s }; delete n[id]; return n; }); toast.success(`"${d?.name}" sent for signature via Zoho Sign`); };
  const sendSelected = () => { const ids = visible.filter(d => d.status === 'pending' && sel[d.id]).map(d => d.id); if (!ids.length) return; setDocs(ds => ds.map(d => ids.includes(d.id) ? { ...d, status: 'sent' } : d)); setSel(s => { const n = { ...s }; ids.forEach(id => delete n[id]); return n; }); toast.success(`${ids.length} document${ids.length > 1 ? 's' : ''} sent for signature via Zoho Sign`); };

  // ── kebab menu positioning (fixed panel from the button rect) ──
  useLayoutEffect(() => {
    if (!menu || menu.open) return;
    const btn = menuBtnRef.current, pop = menuPopRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, gap = 6, pad = 8;
    let left = r.right - pw; if (left < pad) left = pad; if (left + pw > window.innerWidth - pad) left = window.innerWidth - pad - pw;
    // Always drop below the button; cap the height to the space below so it
    // never spills off-screen (scrolls internally when the list is taller).
    const top = r.bottom + gap;
    const maxH = Math.max(160, window.innerHeight - top - pad);
    setMenu(m => (m ? { ...m, left, top, maxH, open: true } : m));
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    // Close on scroll — but ignore scrolls that happen INSIDE the menu itself
    // (the list can scroll internally when it's taller than the space below).
    const onScroll = (e: Event) => { const el = e.target instanceof Element ? e.target : null; if (el && el.closest('.pomore-pop')) return; setMenu(null); };
    const onResize = () => setMenu(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [menu]);
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, d: TradeDoc) => {
    e.preventDefault(); e.stopPropagation();
    menuBtnRef.current = e.currentTarget;
    setMenu({ id: d.id, name: d.name, left: -9999, top: -9999, maxH: 400, open: false });
  };
  const menuAct = (label: string) => { const name = menu?.name; setMenu(null); toast.info(`${label}${name ? ` — ${name}` : ''}`); };

  return (
    <>
      <div className="polist-seg cptd-seg">
        <button type="button" className={`polist-seg__tab ${tab === 'trade' ? 'is-active' : ''}`} onClick={() => setTab('trade')}>{I.tabDoc} Trade Documents <span className="polist-seg__cnt">{tradeCount}</span></button>
        <button type="button" className={`polist-seg__tab ${tab === 'agreement' ? 'is-active' : ''}`} onClick={() => setTab('agreement')}>{I.tabAgr} Agreements <span className="polist-seg__cnt">{agrCount}</span></button>
      </div>

      <div className="cptd-scroll"><table className="cptd-tbl">
        <thead><tr>
          <th className="cptd-cbcol"><input type="checkbox" className="cptd-check" checked={pendingCount > 0 && selCount === pendingCount} disabled={!pendingCount} onChange={e => toggleAll(e.target.checked)} aria-label="Select all pending" /></th>
          <th>Sr. No</th><th className="cptd-l">Document Name</th><th>Required</th><th>Generated On</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>{visible.length === 0 ? (
          <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#9fb2c0', fontWeight: 600 }}>No {tab === 'trade' ? 'trade documents' : 'agreements'} for this purchase order.</td></tr>
        ) : visible.map((d, i) => {
          const sent = d.status !== 'pending';
          const checked = !!sel[d.id];
          return (
            <tr key={d.id} className={checked ? 'cptd-rowsel' : ''}>
              <td className="cptd-cbcol"><input type="checkbox" className="cptd-check" checked={checked} disabled={sent} onChange={e => toggleDoc(d.id, e.target.checked)} aria-label={`Select ${d.name}`} /></td>
              <td>{i + 1}</td>
              <td className="cptd-l"><div className="cptd-docname">{d.name}</div><div className="cptd-docsub">{d.sub}</div></td>
              <td>{d.required ? <span className="cptd-req">Req</span> : <span className="cptd-opt">Opt</span>}</td>
              <td className="cptd-date">{d.generated}</td>
              <td><span className={`cptd-status cptd-status--${d.status}`}><span className="cptd-dot" />{d.status === 'pending' ? 'Pending' : d.status === 'sent' ? 'Sent' : 'Signed'}</span></td>
              <td><div className="cptd-actions">
                <button className="cptd-send" type="button" disabled={sent} onClick={() => sendDoc(d.id)}>{I.send} {sent ? 'Sent' : 'Send for Sign'}</button>
                <button className="cptd-act" type="button" title="Email document" onClick={() => toast.info(`Email composer opened for "${d.name}"`)}>{I.mail}</button>
                {sent && <button className="cptd-act" type="button" title="Track signature status" onClick={() => toast.info(`Tracking signature status — ${d.name}`)}>{I.track}</button>}
                {sent && <button className="cptd-act" type="button" title="Send reminder" onClick={() => toast.info(`Reminder sent — ${d.name}`)}>{I.reminder}</button>}
                <button className="cptd-act" type="button" title="More actions" onClick={e => openMenu(e, d)}>{I.kebab}</button>
              </div></td>
            </tr>
          );
        })}</tbody>
      </table></div>

      <div className="cptd-bulk">
        <span className="cptd-bulk__cnt">{selCount ? <><strong>{selCount}</strong> document{selCount > 1 ? 's' : ''} selected</> : (pendingCount ? 'Select documents to send for signature together' : 'All documents have been sent')}</span>
        <button className="cptd-bulk__btn" type="button" disabled={!selCount} onClick={sendSelected}>{I.send}<span>Send Selected for Sign{selCount ? ` (${selCount})` : ''}</span></button>
      </div>

      {menu && (
        <>
          <div className="pomore-backdrop" onClick={() => setMenu(null)} />
          <div ref={menuPopRef} className={`pomore-pop ${menu.open ? 'is-open' : ''}`} style={{ left: menu.left, top: menu.top, maxHeight: menu.maxH, overflowY: 'auto' }}>
            <div className="pomore-hd">
              <span className="pomore-hd__ico">{I.kebab}</span>
              <span className="pomore-hd__txt">
                <span className="pomore-hd__t">Document Actions</span>
                <span className="pomore-hd__chip">{I.fileSm}<b>{menu.name}</b></span>
              </span>
              <button type="button" className="pomore-x" onClick={() => setMenu(null)} aria-label="Close">✕</button>
            </div>
            <div className="pomore-sec pomore-sec--dl">{I.down} Download</div>
            <button type="button" className="pomore-item" onClick={() => menuAct('Downloading (with signature)')}><span className="pomore-item__ico pomore-item__ico--dl">{I.down}</span>With Signature</button>
            <button type="button" className="pomore-item" onClick={() => menuAct('Downloading (without signature)')}><span className="pomore-item__ico pomore-item__ico--dl">{I.down}</span>Without Signature</button>
            <div className="pomore-sec pomore-sec--view">{I.eye} View</div>
            <button type="button" className="pomore-item" onClick={() => menuAct('Viewing document (with signature)')}><span className="pomore-item__ico pomore-item__ico--view">{I.eye}</span>With Signature</button>
            <button type="button" className="pomore-item" onClick={() => menuAct('Viewing document (without signature)')}><span className="pomore-item__ico pomore-item__ico--view">{I.eye}</span>Without Signature</button>
            <div className="pomore-divider" />
            <button type="button" className="pomore-item" onClick={() => menuAct('Certificate of Origin')}><span className="pomore-item__ico pomore-item__ico--sync">{I.cert}</span>Certificate of Origin</button>
          </div>
        </>
      )}
    </>
  );
}
