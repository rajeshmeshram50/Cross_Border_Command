// Evidence Vault for one refund adjustment: the purchase order, the supplier's
// refund receipt, and every proof of money released and refunded. The popup
// shell is the PO picker's (arf-pick, itself the shared spi-mdl-* popup); the
// group cards and file rows are the prototype's own (arf-vg-* / arf-vf-*).
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { IcoX } from '../../icons';
import { fmtDate, money } from '../../purchase-management/order/manage-payment/payment-shared';
import { findPo, type RefundAdjustment } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type VaultFile = { name: string; meta: string; tag?: 'release' | 'refund' };

const fileSafe = (code: string) => code.replace(/[/ ]/g, '_');

/* The prototype's own marks, drawn at their own stroke weights. */
function Svg({ sw, children }: { sw: number; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const IcoVault = () => <Svg sw={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></Svg>;
const IcoOrder = () => <Svg sw={2.2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Svg>;
const IcoNote = () => (
  <Svg sw={2.2}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <polyline points="12 18 9 15 12 12" /><path d="M9 15h5a2 2 0 0 0 2-2v-1" />
  </Svg>
);
const IcoPay = () => <Svg sw={2.2}><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></Svg>;
const IcoView = () => <Svg sw={2.2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>;
const IcoGet = () => <Svg sw={2.3}><path d="M12 3v12" /><polyline points="7 11 12 16 17 11" /><path d="M4 20h16" /></Svg>;

export default function EvidenceVaultModal({ refund, onClose }: { refund: RefundAdjustment; onClose: () => void }) {
  useScrollLock();
  useEscapeClose(onClose);
  const toast = useToast();
  const po = findPo(refund.po);

  const poFiles: VaultFile[] = po ? [{ name: `${fileSafe(po.po)}.pdf`, meta: `${fmtDate(po.poDate)} · ${money(po.total)}` }] : [];
  const receiptFiles: VaultFile[] = [{
    name: refund.attachment || `${fileSafe(refund.no)}_supplier.pdf`,
    meta: `${refund.supplierRef ? `Supplier ref ${refund.supplierRef} · ` : ''}${fmtDate(refund.date)} · ${money(refund.amount)}`,
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
      <div className="spi-mdl arf-pick arf-vault" role="dialog" aria-modal="true" aria-labelledby="arf-vault-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoVault /></div>
            <div>
              <div className="spi-mdl-title" id="arf-vault-title">Evidence Vault</div>
              <div className="spi-mdl-sub">{refund.no} · {refund.po} · {po?.supplier ?? '—'}</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body arf-vault-body">
          <Group icon={<IcoOrder />} title="Purchase Order" sub="The order this credit is raised against"
            files={poFiles} empty="No purchase order document on file." onOpen={notYet} />
          <Group icon={<IcoNote />} title="Advance Refund Receipt" sub="The refund document as the supplier issued it"
            files={receiptFiles} empty="The supplier has not sent their copy yet." onOpen={notYet} />
          <Group icon={<IcoPay />} title="All Payment Proofs" sub="Money released against the order, and refunds against the note"
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
        ? <div className="arf-vg-none">{empty}</div>
        : files.map((f) => (
          <div className="arf-vf" key={f.name}>
            <span className="arf-vf-badge">PDF</span>
            <div className="arf-vf-txt">
              <div className="arf-vf-name" title={f.name}>{f.name}</div>
              <div className="arf-vf-meta">{f.meta}</div>
            </div>
            {f.tag && <span className={`arf-vtag arf-vtag--${f.tag}`}>{f.tag === 'release' ? 'Release' : 'Refund'}</span>}
            <span className="arf-vf-acts">
              <button type="button" className="arf-vact" title="View" onClick={onOpen}><IcoView /><span>View</span></button>
              <button type="button" className="arf-vact arf-vact--get" title="Download" onClick={onOpen}><IcoGet /><span>Download</span></button>
            </span>
          </div>
        ))}
    </section>
  );
}
