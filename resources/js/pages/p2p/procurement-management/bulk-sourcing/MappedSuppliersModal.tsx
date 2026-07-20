import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { SegmentTags } from './SegmentTags';
import { useModalGuard } from './useModalGuard';
import Tooltip from '../../../../components/ui/Tooltip';
import './bulk-sourcing.css';

/* Mapped Suppliers — suppliers mapped to a product.
 * Data: GET /p2p/sourcing-targets/{targetId}/products/{productId}/suppliers (API.md). */

export type MappedProduct = { name: string; code?: string; segment?: string; price?: string; supplierCount: number; mappedName?: string };
type Sup = { id: string; name: string; segment: string; contact: string; mobile: string; email: string; source: string };

const tInit = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
/* Distinct icon per contact row (was all using the person icon). */
const CONTACT_ICONS: Record<string, ReactNode> = {
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
};
const genDate = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
/* Show Target Price in INR — master rows already carry ₹; manual ones are plain. */
const fmtPrice = (p: string) => {
  if (!p && p !== '0') return '—';
  if (String(p).trim().startsWith('₹')) return p;
  const n = Number(String(p).replace(/,/g, ''));
  return isNaN(n) ? p : `₹${n.toLocaleString('en-IN')}`;
};

export default function MappedSuppliersModal({ product, recordId, recordSource, targetId, productId, onClose, onAddSupplier }: {
  product: MappedProduct; recordId: string; recordSource: string; targetId?: string; productId?: string | number; onClose: () => void; onAddSupplier: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Sup[]>([]);
  const [loading, setLoading] = useState(true);
  const { pulse, guardOverlay } = useModalGuard();
  // Lock background page scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    if (!targetId || productId == null) { setLoading(false); return; }
    setLoading(true);
    api.get<{ data: Sup[] }>(`/p2p/sourcing-targets/${targetId}/products/${productId}/suppliers`)
      .then(r => setSuppliers(r.data?.data ?? []))
      .catch(() => setSuppliers([]))
      .finally(() => setLoading(false));
  }, [targetId, productId]);
  const count = suppliers.length || product.supplierCount || 0;

  return createPortal(
    <div className="sv-overlay" onMouseDown={guardOverlay}>
      <div className={`sv-box${pulse ? ' bsm-pulse' : ''}`}>
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
            <div className="sv-ref"><div className="sv-ref-lbl">Product Name</div><Tooltip label={product.name}><div className="sv-ref-val" style={{ maxWidth: 240 }}>{product.name}</div></Tooltip></div>
            {product.segment && <div className="sv-ref"><div className="sv-ref-lbl">Segment</div><div className="sv-ref-val">{product.segment}</div></div>}
            {product.price && <div className="sv-ref"><div className="sv-ref-lbl">Target Price</div><div className="sv-ref-val amber">{fmtPrice(product.price)}</div></div>}
            <div className="sv-ref"><div className="sv-ref-lbl">Suppliers Mapped</div><div className="sv-ref-val green">{count} Supplier{count !== 1 ? 's' : ''}</div></div>
          </div>
        </div>

        <div className="sv-body">
          <div className="sv-sec-hdr">
            <div className="sv-sec-title"><div className="sv-sec-title-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div><span className="sv-sec-label">Supplier List</span></div>
            <span className="sv-count-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{count} Mapped</span>
          </div>
          <div className="sv-cards">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div className="sv-card" key={i}>
                  <div className="sv-card-top">
                    <span className="bsm-sk" style={{ width: 26, height: 26, borderRadius: 8 }} />
                    <span className="bsm-sk bsm-sk-circle" style={{ width: 44, height: 44 }} />
                    <div className="sv-card-info" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="bsm-sk" style={{ width: 180, height: 15 }} />
                      <div style={{ display: 'flex', gap: 6 }}><span className="bsm-sk" style={{ width: 50, height: 18, borderRadius: 6 }} /><span className="bsm-sk" style={{ width: 72, height: 18, borderRadius: 6 }} /><span className="bsm-sk" style={{ width: 84, height: 18, borderRadius: 6 }} /></div>
                    </div>
                  </div>
                  <div className="sv-card-contacts">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <div className="sv-contact-item" key={j} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="bsm-sk bsm-sk-circle" style={{ width: 28, height: 28 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span className="bsm-sk" style={{ width: 64, height: 9 }} /><span className="bsm-sk" style={{ width: 110, height: 12 }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : suppliers.length === 0 ? (
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
                    <div className="sv-card-tags"><span className="sv-card-tag id">{sup.id}</span><SegmentTags segment={sup.segment} tagClassName="sv-card-tag seg" /><span className="sv-card-tag src">{sup.source === 'New Supplier' ? 'New Supplier' : 'Master'}</span></div>
                  </div>
                </div>
                <div className="sv-card-contacts">
                  {[['Contact Person', sup.contact, 'user'], ['Mobile', sup.mobile, 'phone'], ['Email', sup.email, 'mail']].map(([lbl, val, ico]) => (
                    <div className="sv-contact-item" key={lbl}>
                      <div className="sv-contact-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{CONTACT_ICONS[ico]}</svg></div>
                      <div className="sv-contact-text"><div className="sv-contact-lbl">{lbl}</div><Tooltip label={val}><div className="sv-contact-val">{val}</div></Tooltip></div>
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
