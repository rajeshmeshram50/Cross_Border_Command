// Evidence Vault for one refund adjustment: the purchase order, the supplier's
// refund receipt, and every proof of money released and refunded. Reuses the
// shared popup shell (spi-mdl-*) and Order buttons (ord-btn); advance-refund.css
// adds only the group cards and file rows (arf-vg-* / arf-vf-*).
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { IcoDocSm, IcoDownload, IcoEye, IcoRefund, IcoShield, IcoX } from '../../icons';
import { STAT_ICONS, fmtDate, money, statIco } from '../../purchase-management/order/manage-payment/payment-shared';
import { findPo, type RefundAdjustment } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type VaultFile = { name: string; meta: string; tag?: 'release' | 'refund' };

const fileSafe = (code: string) => code.replace(/\//g, '_');

export default function EvidenceVaultModal({ refund, onClose }: { refund: RefundAdjustment; onClose: () => void }) {
  useScrollLock();
  useEscapeClose(onClose);
  const toast = useToast();
  const po = findPo(refund.po);

  const poFiles: VaultFile[] = po ? [{ name: `${fileSafe(po.po)}.pdf`, meta: `${fmtDate(po.poDate)} · ${money(po.total)}` }] : [];
  const receiptFiles: VaultFile[] = [{
    name: refund.attachment || `${fileSafe(refund.no)}_supplier.pdf`,
    meta: `${fmtDate(refund.date)} · ${money(refund.amount)}`,
  }];
  const proofs: VaultFile[] = [
    ...(po && po.paid > 0 ? [{ name: `Payment_Advice_${fileSafe(po.po)}.pdf`, meta: `Paid · ${money(po.paid)}`, tag: 'release' as const }] : []),
    ...refund.recoveries.map((r, i) => ({
      name: `Refund_Advice_${fileSafe(refund.no)}_${i + 1}.pdf`, meta: `Refunded · ${money(r.amount)} · ${fmtDate(r.date)}`, tag: 'refund' as const,
    })),
  ];

  // Refunds run on sample data until the API is connected, so there is no file to open yet.
  const notYet = () => toast.info('File not available yet', 'Documents open here once refunds are connected to the server.');

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl arf-vault" role="dialog" aria-modal="true" aria-labelledby="arf-vault-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoShield /></div>
            <div>
              <div className="spi-mdl-title" id="arf-vault-title">Evidence Vault</div>
              <div className="spi-mdl-sub">{refund.no} · {refund.po} · {po?.supplier ?? '—'}</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body arf-vault-body">
          <Group icon={<IcoDocSm />} title="Purchase Order" sub="The order this refund is raised against"
            files={poFiles} empty="No purchase order on file." onOpen={notYet} />
          <Group icon={<IcoRefund />} title="Advance Refund Receipt" sub="The refund document as the supplier issued it"
            files={receiptFiles} empty="No refund receipt attached." onOpen={notYet} />
          <Group icon={statIco(STAT_ICONS.rupee)} title="All Payment Proofs" sub="Money released against the order, and refunds against the note"
            files={proofs} empty="No payment has been released on this order yet." onOpen={notYet} />
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Group({ icon, title, sub, files, empty, onOpen }: {
  icon: ReactNode; title: string; sub: string; files: VaultFile[]; empty: string; onOpen: () => void;
}) {
  return (
    <section className="arf-vg">
      <div className="arf-vg-head">
        <span className="arf-vg-ico">{icon}</span>
        <div className="arf-vg-txt">
          <div className="arf-vg-title">{title}</div>
          <div className="arf-vg-sub">{sub}</div>
        </div>
        <span className="arf-vg-count">{files.length}</span>
      </div>
      {files.length === 0
        ? <div className="arf-hist__empty">{empty}</div>
        : files.map((f) => (
          <div className="arf-vf" key={f.name}>
            <span className="arf-vf-badge">PDF</span>
            <div className="arf-vf-txt">
              <div className="arf-vf-name" title={f.name}>{f.name}</div>
              <div className="arf-vf-meta">{f.meta}</div>
            </div>
            {f.tag && <span className={`arf-vtag arf-vtag--${f.tag}`}>{f.tag === 'release' ? 'Release' : 'Refund'}</span>}
            <button type="button" className="ord-btn ord-btn--edit arf-vf-btn" onClick={onOpen}><IcoEye /><span>View</span></button>
            <button type="button" className="ord-btn ord-btn--hist arf-vf-btn" onClick={onOpen}><IcoDownload /><span>Download</span></button>
          </div>
        ))}
    </section>
  );
}

