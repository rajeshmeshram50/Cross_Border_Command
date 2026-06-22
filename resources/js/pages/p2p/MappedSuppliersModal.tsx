import { createPortal } from 'react-dom';
import { SUPPLIER_MASTER } from './MapSupplierModal';

/* Mapped Suppliers — list of suppliers mapped to a product (static port).
 * Suppliers are synthesised: a user-mapped name (if any) plus master suppliers
 * matching the product's segment, up to the supplier count. */

export type MappedProduct = { name: string; code?: string; segment?: string; price?: string; supplierCount: number; mappedName?: string };

const tInit = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
const genDate = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function MappedSuppliersModal({ product, recordId, recordSource, onClose, onAddSupplier }: {
  product: MappedProduct; recordId: string; recordSource: string; onClose: () => void; onAddSupplier: () => void;
}) {
  const count = product.supplierCount || 0;
  type Sup = { id: string; name: string; segment: string; contact: string; mobile: string; email: string; source: string };
  const suppliers: Sup[] = [];
  if (product.mappedName) {
    const m = SUPPLIER_MASTER.find(s => s.name === product.mappedName || s.segment === (product.segment || ''));
    if (m && m.name === product.mappedName) suppliers.push({ ...m, source: 'Master' });
    else suppliers.push({ id: 'S-NEW', name: product.mappedName, segment: product.segment || 'General', contact: '—', mobile: '—', email: '—', source: 'New Supplier' });
  }
  const bySeg = SUPPLIER_MASTER.filter(s => s.segment === (product.segment || ''));
  const pool = bySeg.length ? bySeg : SUPPLIER_MASTER;
  for (let i = 0; suppliers.length < count && i < pool.length; i++) {
    if (!suppliers.some(s => s.id === pool[i].id)) suppliers.push({ ...pool[i], source: 'Master' });
  }

  return createPortal(
    <div className="sv-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="sv-box">
        <div className="sv-header">
          <div className="sv-hbar" />
          <div className="sv-htop">
            <div className="sv-hicon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
            <div className="sv-htitle-block">
              <div className="sv-htitle-row"><span className="sv-htitle">Mapped Suppliers</span><span className="sv-hpill"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>{recordId}</span></div>
              <div className="sv-hsub">Sourcing Reference &nbsp;·&nbsp; {recordSource} &nbsp;·&nbsp; Generated {genDate()}</div>
            </div>
            <button className="sv-close" onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>
          <div className="sv-refs">
            <div className="sv-ref"><div className="sv-ref-lbl">Sourcing ID</div><div className="sv-ref-val cyan">{recordId}</div></div>
            <div className="sv-ref"><div className="sv-ref-lbl">Product Code</div><div className="sv-ref-val cyan">{product.code || '—'}</div></div>
            <div className="sv-ref"><div className="sv-ref-lbl">Product Name</div><div className="sv-ref-val">{product.name}</div></div>
            {product.segment && <div className="sv-ref"><div className="sv-ref-lbl">Segment</div><div className="sv-ref-val">{product.segment}</div></div>}
            {product.price && <div className="sv-ref"><div className="sv-ref-lbl">Target Price</div><div className="sv-ref-val amber">{product.price}</div></div>}
            <div className="sv-ref"><div className="sv-ref-lbl">Suppliers Mapped</div><div className="sv-ref-val green">{count} Supplier{count !== 1 ? 's' : ''}</div></div>
          </div>
        </div>

        <div className="sv-body">
          <div className="sv-sec-hdr">
            <div className="sv-sec-title"><div className="sv-sec-title-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div><span className="sv-sec-label">Supplier List</span></div>
            <span className="sv-count-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{count} Mapped</span>
          </div>
          <div className="sv-cards">
            {suppliers.length === 0 ? (
              <div className="sv-empty">
                <div className="sv-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg></div>
                <div className="sv-empty-title">No Suppliers Mapped</div>
                <div className="sv-empty-sub">Click "Add Supplier" to map suppliers for this product.</div>
              </div>
            ) : suppliers.map((sup, i) => (
              <div className="sv-card" key={sup.id + i}>
                <div className="sv-card-top">
                  <div className="sv-card-idx">{i + 1}</div>
                  <div className="sv-card-av">{tInit(sup.name)}</div>
                  <div className="sv-card-info">
                    <div className="sv-card-name">{sup.name}</div>
                    <div className="sv-card-tags"><span className="sv-card-tag id">{sup.id}</span><span className="sv-card-tag seg">{sup.segment}</span><span className="sv-card-tag src">{sup.source === 'New Supplier' ? 'New Supplier' : 'Master'}</span></div>
                  </div>
                </div>
                <div className="sv-card-contacts">
                  {[['Contact Person', sup.contact, 'user'], ['Mobile', sup.mobile, 'phone'], ['Email', sup.email, 'mail']].map(([lbl, val]) => (
                    <div className="sv-contact-item" key={lbl}>
                      <div className="sv-contact-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></div>
                      <div className="sv-contact-text"><div className="sv-contact-lbl">{lbl}</div><div className="sv-contact-val" title={val}>{val}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sv-footer">
          <span className="sv-footer-note">{suppliers.length ? `${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} mapped to ${product.name}` : 'No suppliers mapped yet'}</span>
          <div className="sv-footer-actions">
            <button className="sv-close-btn" onClick={onClose}>Close</button>
            <button className="sv-footer-btn" onClick={onAddSupplier}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>Add Supplier</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CSS = `
.sv-overlay{position:fixed;inset:0;z-index:10000001;display:flex;align-items:center;justify-content:center;background:rgba(4,14,32,.78);backdrop-filter:blur(14px);padding:24px;box-sizing:border-box;font-family:'DM Sans','Inter',system-ui,sans-serif;}
.sv-box{width:100%;max-width:820px;max-height:90vh;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;background:#fff;box-shadow:0 40px 100px rgba(8,145,178,.28),0 12px 32px rgba(15,23,42,.22),0 0 0 1px rgba(8,145,178,.12);}
.sv-header{background:linear-gradient(135deg,#082f49 0%,#0c4a6e 40%,#0369a1 75%,#0891b2 100%);flex-shrink:0;position:relative;overflow:hidden;}
.sv-header::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 60% at 95% -5%, rgba(34,211,238,.22) 0%, transparent 55%),radial-gradient(ellipse 50% 80% at 0% 110%, rgba(14,116,144,.3) 0%, transparent 50%);}
.sv-hbar{height:3.5px;background:linear-gradient(90deg,#22d3ee 0%,#0891b2 50%,#22d3ee 100%);}
.sv-htop{display:flex;align-items:flex-start;gap:16px;padding:22px 24px 14px;position:relative;z-index:1;}
.sv-hicon-wrap{width:48px;height:48px;border-radius:14px;flex-shrink:0;background:rgba(255,255,255,.12);border:1.5px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.15);}
.sv-htitle-block{flex:1;min-width:0;}
.sv-htitle-row{display:flex;align-items:center;gap:10px;margin-bottom:5px;flex-wrap:wrap;}
.sv-htitle{font-size:18px;font-weight:600;color:#fff;letter-spacing:-.3px;line-height:1.15;}
.sv-hpill{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);color:rgba(255,255,255,.92);border-radius:7px;padding:4px 11px;white-space:nowrap;}
.sv-hsub{font-size:12px;color:rgba(255,255,255,.6);font-weight:500;}
.sv-close{width:34px;height:34px;border-radius:10px;flex-shrink:0;margin-top:2px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.18);color:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;}
.sv-close:hover{background:rgba(255,255,255,.2);color:#fff;border-color:rgba(255,255,255,.35);}
.sv-refs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:0 24px 20px;position:relative;z-index:1;}
.sv-ref{display:flex;flex-direction:column;gap:3px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px 14px;min-width:0;}
.sv-ref-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sv-ref-val{font-size:12.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sv-ref-val.cyan{color:#67e8f9;}
.sv-ref-val.amber{color:#fcd34d;}
.sv-ref-val.green{color:#6ee7b7;}
.sv-body{flex:1;overflow-y:auto;padding:24px;background:#f0f9ff;scrollbar-width:thin;scrollbar-color:rgba(8,145,178,.2) transparent;}
.sv-body::-webkit-scrollbar{width:5px;}
.sv-body::-webkit-scrollbar-thumb{background:rgba(8,145,178,.25);border-radius:4px;}
.sv-sec-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.sv-sec-title{display:flex;align-items:center;gap:10px;}
.sv-sec-title-icon{width:32px;height:32px;border-radius:9px;flex-shrink:0;background:linear-gradient(135deg,#cffafe,#a5f3fc);color:#0891b2;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(8,145,178,.2);}
.sv-sec-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#0369a1;}
.sv-count-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;background:linear-gradient(135deg,#22d3ee,#0891b2);color:#fff;border-radius:20px;padding:5px 14px;box-shadow:0 4px 12px rgba(8,145,178,.35);}
.sv-cards{display:flex;flex-direction:column;gap:14px;}
.sv-card{background:#fff;border:1.5px solid #e0f2fe;border-radius:18px;padding:20px 22px 20px 26px;position:relative;overflow:hidden;transition:border-color .2s,box-shadow .2s,transform .2s;box-shadow:0 2px 12px rgba(8,145,178,.07);}
.sv-card:hover{border-color:#7dd3fc;box-shadow:0 8px 28px rgba(8,145,178,.16);transform:translateY(-1px);}
.sv-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#22d3ee 0%,#0891b2 100%);border-radius:4px 0 0 4px;}
.sv-card-top{display:flex;align-items:center;gap:14px;margin-bottom:16px;}
.sv-card-idx{width:26px;height:26px;border-radius:8px;flex-shrink:0;background:#f0f9ff;border:1.5px solid #bae6fd;color:#0891b2;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;}
.sv-card-av{width:50px;height:50px;border-radius:14px;flex-shrink:0;background:linear-gradient(135deg,#22d3ee,#0369a1);color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(8,145,178,.4);letter-spacing:-.5px;}
.sv-card-info{flex:1;min-width:0;}
.sv-card-name{font-size:15px;font-weight:600;color:#0c4a6e;letter-spacing:-.25px;margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sv-card-tags{display:flex;gap:6px;flex-wrap:wrap;}
.sv-card-tag{font-size:10px;font-weight:600;padding:3px 10px;border-radius:6px;border:1px solid;}
.sv-card-tag.id{background:#e0f7fa;color:#0891b2;border-color:#a5f3fc;font-family:ui-monospace,monospace;}
.sv-card-tag.seg{background:#f0fdf4;color:#15803d;border-color:#bbf7d0;}
.sv-card-tag.src{background:#fffbeb;color:#b45309;border-color:#fde68a;}
.sv-card-contacts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.sv-contact-item{display:flex;align-items:center;gap:10px;background:#f8fafc;border:1.5px solid #e0f2fe;border-radius:12px;padding:11px 14px;transition:border-color .15s,background .15s;}
.sv-contact-item:hover{background:#f0f9ff;border-color:#7dd3fc;}
.sv-contact-ico{width:30px;height:30px;border-radius:9px;flex-shrink:0;background:linear-gradient(135deg,#e0f7fa,#b2ebf2);color:#0891b2;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(8,145,178,.15);}
.sv-contact-text{min-width:0;}
.sv-contact-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:3px;}
.sv-contact-val{font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:48px 24px;text-align:center;}
.sv-empty-icon{width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#e0f7fa,#b2ebf2);color:#0891b2;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(8,145,178,.2);}
.sv-empty-title{font-size:15px;font-weight:600;color:#334155;}
.sv-empty-sub{font-size:12.5px;color:#94a3b8;font-weight:500;max-width:280px;line-height:1.5;}
.sv-footer{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#fff;border-top:1.5px solid #e0f2fe;flex-shrink:0;gap:12px;flex-wrap:wrap;}
.sv-footer-note{font-size:11.5px;color:#64748b;font-weight:600;}
.sv-footer-actions{display:flex;gap:10px;align-items:center;}
.sv-close-btn{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:12.5px;font-weight:600;color:#475569;background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:11px;padding:10px 20px;cursor:pointer;transition:all .15s;}
.sv-close-btn:hover{background:#e2e8f0;color:#1e293b;border-color:#cbd5e1;}
.sv-footer-btn{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:600;color:#fff;background:linear-gradient(135deg,#22d3ee 0%,#0891b2 100%);border:none;border-radius:11px;padding:10px 22px;cursor:pointer;box-shadow:0 6px 18px rgba(8,145,178,.4);transition:all .18s;}
.sv-footer-btn:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 8px 24px rgba(8,145,178,.5);}
@media(max-width:680px){.sv-refs{grid-template-columns:repeat(2,1fr);}.sv-card-contacts{grid-template-columns:1fr;}}
`;
