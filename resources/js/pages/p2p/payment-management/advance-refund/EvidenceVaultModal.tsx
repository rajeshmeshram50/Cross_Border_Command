// Evidence Vault for one refund adjustment: the refund itself, the purchase order
// it is raised against, and every proof of money released and recovered.
// Reuses the Add New Payment popup shell (apay-*) and the shared spi-table.
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useEscapeClose } from './useEscapeClose';
import { Ref } from '../../purchase-management/order/AddPaymentModal';
import { ICON_X, money, fmtDate } from '../../purchase-management/order/payment-shared';
import { IcoShield } from '../../purchase-management/order/icons';
import { findPo, type RefundAdjustment } from './refund-data';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/add-payment.css';
import './advance-refund.css';

type Doc = { name: string; ref: string; date: string; amount: number; tag: 'Refund' | 'Release' | 'Document' };

export default function EvidenceVaultModal({ refund, onClose }: { refund: RefundAdjustment; onClose: () => void }) {
  useScrollLock();
  useEscapeClose(onClose);

  const po = findPo(refund.po);
  const docs: Doc[] = [
    { name: 'Advance Receipt Refund Adjustment', ref: refund.no, date: refund.date, amount: refund.amount, tag: 'Document' },
    ...(po ? [{ name: 'Purchase Order', ref: po.po, date: po.poDate, amount: po.total, tag: 'Document' as const }] : []),
    ...(po && po.paid > 0 ? [{ name: 'Payment Released', ref: po.po, date: po.poDate, amount: po.paid, tag: 'Release' as const }] : []),
    ...refund.recoveries.map((r, i) => ({ name: `Refund Advice ${i + 1}`, ref: refund.no, date: r.date, amount: r.amount, tag: 'Refund' as const })),
  ];

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="apay-card" role="dialog" aria-modal="true" aria-labelledby="arf-vault-title" tabIndex={-1}>
        <div className="apay-hd">
          <span className="apay-hd__ico"><IcoShield size={18} /></span>
          <div className="apay-hd__txt">
            <div className="apay-hd__t" id="arf-vault-title">Evidence Vault</div>
            <div className="apay-hd__refs">
              <Ref label="Refund No." value={refund.no} mono />
              <Ref label="Supplier" value={po?.supplier ?? '—'} />
              <Ref label="PO Number" value={refund.po} mono />
            </div>
          </div>
          <button type="button" className="apay-hd__x" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="apay-bd">
          <div className="arf-hist">
            <table className="spi-table">
              <thead><tr><th>Document</th><th>Reference</th><th>Date</th><th>Amount</th><th>Type</th></tr></thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={`${d.name}-${i}`}>
                    <td>{d.name}</td>
                    <td><span className="ord-idpill">{d.ref}</span></td>
                    <td>{fmtDate(d.date)}</td>
                    <td><span className="ord-amt">{money(d.amount)}</span></td>
                    <td><span className={`arf-vtag arf-vtag--${d.tag.toLowerCase()}`}>{d.tag}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="apay-ft">
          <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
