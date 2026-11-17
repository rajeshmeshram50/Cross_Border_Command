import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../components/ui/Tooltip';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import { todayIso, type SourcingTarget } from './data';
import { dmy, initials, inr } from './format';
import { usePopup } from './popupHooks';
import type { ReportProduct } from './targetProducts';
import './mapped-suppliers.css';
import { IcoCheck, IcoUserPlus, IcoUsers, IcoX, Svg } from './icons';

/* Mapped Suppliers popup (Figma) — opens from the Supplier Count badge in the Sourcing Target
   Report. Same design as Bulk Sourcing's MappedSuppliersModal, under this module's own .stsv-*
   class names (mapped-suppliers.css), with static dummy suppliers: design-only, API later. */

type Sup = { id: string; name: string; segment: string; contact: string; mobile: string; email: string; source: 'Master' | 'New Supplier' };

/* Dummy directory. A product's suppliers are picked from it by its count, so the same
   product always shows the same suppliers. */
const DIRECTORY: Omit<Sup, 'segment'>[] = [
  { id: 'S-NEW', name: 'Bluewave Components', contact: '—', mobile: '—', email: '—', source: 'New Supplier' },
  { id: 'S-004', name: 'Instrumentation Hub', contact: 'Neha Patel', mobile: '9823456789', email: 'neha@insthub.in', source: 'Master' },
  { id: 'S-001', name: 'TechParts India Pvt Ltd', contact: 'Rahul Shah', mobile: '9876543210', email: 'rahul@techparts.in', source: 'Master' },
  { id: 'S-007', name: 'Valve World India', contact: 'Ravi Joshi', mobile: '9856789012', email: 'ravi@valveworld.in', source: 'Master' },
  { id: 'S-002', name: 'Electro Components Co', contact: 'Priya Mehta', mobile: '9876501234', email: 'priya@electrocomp.in', source: 'Master' },
];


const IcoType = () => <Svg size={9} sw={2.5}><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></Svg>;
const CONTACT_ICONS: Record<'user' | 'phone' | 'mail', ReactNode> = {
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
};

/** A mapped supplier's key, so a conversion is remembered per target · product · supplier. */
export const supKey = (row: SourcingTarget, product: ReportProduct, supId: string) => `${row.code}|${product.key}|${supId}`;

type Props = {
  row: SourcingTarget;
  product: ReportProduct;
  onClose: () => void;
  /** Add Supplier opens the Map Supplier Directory popup for this product. */
  onAddSupplier: () => void;
  /** Convert to Supplier on a New Supplier card (CS-2222): opens Supplier Management's Add Supplier form. */
  onConvert?: (key: string, name: string) => void;
  /** Suppliers already converted (supKey): their card reads Master and the button is gone. */
  converted?: ReadonlySet<string>;
};

export default function MappedSuppliers({ row, product, onClose, onAddSupplier, onConvert, converted }: Props) {
  const segment = product.segment && product.segment !== '—' ? product.segment : '';
  const suppliers: Sup[] = DIRECTORY.slice(0, Math.min(product.suppliers, DIRECTORY.length))
    .map(s => ({ ...s, segment: segment || 'General' }))
    .map(s => (s.source === 'New Supplier' && converted?.has(supKey(row, product, s.id)) ? { ...s, source: 'Master' as const } : s));
  const count = suppliers.length;
  const source = product.source === 'Product Master' ? 'Product Master' : 'Manual Entry';

  // Scroll lock, Esc (this is the top popup, so the report behind stays open) and focus.
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose });

  return createPortal(
    // A click on the backdrop does nothing: only ×, Close or Esc closes the popup.
    <div className="stsv-overlay">
      <div ref={dialogRef} className="stsv-box" role="dialog" aria-modal="true" aria-label="Mapped Suppliers">
        <div className="stsv-header">
          <div className="stsv-hbar" />
          <div className="stsv-htop">
            <div className="stsv-hicon-wrap"><IcoUsers size={20} sw={2.1} /></div>
            <div className="stsv-htitle-block">
              <div className="stsv-htitle-row"><span className="stsv-htitle">Mapped Suppliers</span><span className="stsv-hpill"><IcoType />{row.code}</span></div>
              <div className="stsv-hsub">Sourcing Reference &nbsp;·&nbsp; {source} &nbsp;·&nbsp; Generated {dmy(todayIso())}</div>
            </div>
            <button type="button" className="stsv-close" aria-label="Close" onClick={onClose}><IcoX size={13} sw={2.8} /></button>
          </div>
          {/* Six tiles in a row: a long label or value ends in "…", and the full text shows in the
              app tooltip — only when it is really cut (FitTip). */}
          <div className="stsv-refs">
            {([
              ['Sourcing ID', row.code, 'cyan'],
              ['Product Code', product.code || '—', 'cyan'],
              ['Product Name', product.name, ''],
              ...(segment ? [['Segment', segment, '']] as const : []),
              ['Target Price', inr(product.targetPrice), 'amber'],
              ['Suppliers Mapped', `${count} Supplier${count !== 1 ? 's' : ''}`, 'green'],
            ] as const).map(([lbl, val, tone]) => (
              <div className="stsv-ref" key={lbl}>
                <FitTip label={lbl}><div className="stsv-ref-lbl">{lbl}</div></FitTip>
                <FitTip label={val}><div className={`stsv-ref-val${tone ? ` ${tone}` : ''}`}>{val}</div></FitTip>
              </div>
            ))}
          </div>
        </div>

        <div className="stsv-body sct-scroller">
          <div className="stsv-sec-hdr">
            <div className="stsv-sec-title"><div className="stsv-sec-title-icon"><IcoUsers size={13} sw={2.1} /></div><span className="stsv-sec-label">Supplier List</span></div>
            <span className="stsv-count-badge"><IcoCheck size={10} sw={2.5} />{count} Mapped</span>
          </div>
          <div className="stsv-cards">
            {count === 0 ? (
              <div className="stsv-empty">
                <div className="stsv-empty-icon"><IcoUserPlus size={24} sw={2.3} /></div>
                <div className="stsv-empty-title">No Suppliers Mapped</div>
                <div className="stsv-empty-sub">Click "Add Supplier" to map suppliers for this product.</div>
              </div>
            ) : suppliers.map((s, i) => (
              <div className="stsv-card" key={s.id}>
                <div className="stsv-card-top">
                  <div className="stsv-card-idx">{i + 1}</div>
                  <div className="stsv-card-av">{initials(s.name)}</div>
                  <div className="stsv-card-info">
                    <FitTip label={s.name}><div className="stsv-card-name">{s.name}</div></FitTip>
                    <div className="stsv-card-tags">
                      <span className="stsv-card-tag id">{s.id}</span>
                      <span className="stsv-card-tag seg">{s.segment}</span>
                      <span className="stsv-card-tag src">{s.source}</span>
                    </div>
                  </div>
                  {/* Only on New Supplier cards — never on Master ones (V-T23); gone once converted (V-T46). */}
                  {s.source === 'New Supplier' && onConvert && (
                    <button type="button" className="stsv-card-convert-btn" onClick={() => onConvert(supKey(row, product, s.id), s.name)}>
                      <Svg sw={2.3} size={12}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></Svg>
                      Convert to Supplier
                    </button>
                  )}
                </div>
                <div className="stsv-card-contacts">
                  {([['Contact Person', s.contact, 'user'], ['Mobile', s.mobile, 'phone'], ['Email', s.email, 'mail']] as const).map(([lbl, val, ico]) => (
                    <div className="stsv-contact-item" key={lbl}>
                      <div className="stsv-contact-ico"><Svg size={12} sw={2.2}>{CONTACT_ICONS[ico]}</Svg></div>
                      <div className="stsv-contact-text"><div className="stsv-contact-lbl">{lbl}</div><Tooltip label={val}><div className="stsv-contact-val">{val}</div></Tooltip></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stsv-footer">
          {(() => {
            const note = count ? `${count} supplier${count !== 1 ? 's' : ''} mapped to ${product.name}` : 'No suppliers mapped yet';
            return <FitTip label={note}><span className="stsv-footer-note">{note}</span></FitTip>;
          })()}
          <div className="stsv-footer-actions">
            <button type="button" className="stsv-close-btn" onClick={onClose}>Close</button>
            <button type="button" className="stsv-footer-btn" onClick={onAddSupplier}><IcoUserPlus size={13} sw={2.3} />Add Supplier</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
