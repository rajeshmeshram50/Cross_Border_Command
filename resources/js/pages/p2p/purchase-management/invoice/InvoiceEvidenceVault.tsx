import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { IcoDoc, IcoDownload, IcoEye, IcoReceipt, IcoShield, IcoX } from '../../icons';
import { money } from '../order/manage-payment/payment-shared';
import { proformaNo } from './putaway-data';
import type { InvoiceRow } from './types';

import './invoice-vault.css';

/** One document in the vault. */
interface VaultDoc {
  file: string;
  /** The line under the name — date, value, whatever identifies it. */
  meta: string;
}

/** A titled set of documents. */
interface VaultGroup {
  key: string;
  icon: ReactNode;
  title: string;
  sub: string;
  docs: VaultDoc[];
}

const d = (iso?: string) => (iso || '').slice(0, 10) || '—';
const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** `SPI/2025-26/001` → `SPI_2025-26_001`, the shape a filename takes. */
const fileStem = (code: string) => code.replace(/\//g, '_');

/**
 * The documents filed against one invoice.
 *
 * Derived from the row, because no document endpoint exists yet: every name
 * here is built from the invoice's own references, so the list reads as this
 * invoice's paperwork rather than as placeholder text. The groups and their
 * order are the design's.
 */
function groupsFor(row: InvoiceRow): VaultGroup[] {
  const spi = fileStem(row.invoiceNo);
  const out: VaultGroup[] = [];

  /* Only when the invoice was raised against one — a standalone invoice has
     no order to file under, and an empty group would imply a missing file. */
  if (row.poNo) {
    out.push({
      key: 'po',
      icon: <IcoDoc />,
      title: 'Purchase Order',
      sub: 'The order everything here is filed against',
      docs: [{
        file: `${fileStem(row.poNo)}.pdf`,
        meta: `${d(row.poDate)} · ${money(row.totalPoAmount)} · Signed copy`,
      }],
    });
  }

  out.push({
    key: 'spi',
    icon: <IcoReceipt />,
    title: 'Supplier Purchase Invoice',
    sub: 'This invoice with its receipt and inspection records',
    docs: [
      /* The stored document type is lower case; it reads as a label here. */
      { file: `${spi}_invoice.pdf`, meta: `${d(row.invoiceDate)} · ${money(row.netPayable)} · ${titleCase(row.documentType)}` },
      ...(row.grnId ? [{ file: `${fileStem(row.grnId)}_receipt.pdf`, meta: `Goods receipt · ${d(row.grnDate)}` }] : []),
      ...(row.qaId ? [{ file: `${fileStem(row.qaId)}_inspection.pdf`, meta: `Quality inspection report · ${d(row.qaDate)}` }] : []),
    ],
  });

  out.push({
    key: 'trade',
    icon: <IcoShield />,
    title: 'Trade Documents & Agreements',
    sub: 'Signed paperwork and shipping documents for this order',
    docs: [
      ...(row.poNo ? [{ file: `Purchase_Agreement_${fileStem(row.poNo)}.pdf`, meta: `Agreement · ${d(row.poDate)}` }] : []),
      { file: `Proforma_${fileStem(proformaNo(row))}.pdf`, meta: `Proforma invoice · ${d(row.invoiceDate)}` },
      { file: `Packing_List_${spi}.pdf`, meta: `Packing list · ${d(row.invoiceDate)}` },
      ...(row.shipmentId
        ? [{ file: `Bill_of_Lading_${fileStem(row.shipmentId)}.pdf`, meta: `Shipping document · ${d(row.shipmentDate)}` }]
        : []),
      { file: `E_Way_Bill_${spi}.pdf`, meta: `E-way bill · ${d(row.invoiceDate)}` },
    ],
  });

  return out;
}

/**
 * Evidence Vault — every document filed against one supplier invoice.
 *
 * Opened by the row's Evidence Vault button. Read-only: it gathers paperwork
 * that was produced elsewhere, so nothing here uploads or deletes.
 */
export default function InvoiceEvidenceVault({ row, onClose }: {
  row: InvoiceRow;
  onClose: () => void;
}) {
  useScrollLock(true, '.iev-card');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => groupsFor(row), [row]);

  return createPortal(
    <div className="iev-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="iev-card"
        role="dialog" aria-modal="true" aria-labelledby="iev-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="iev-head">
          <span className="iev-head__ico"><IcoShield /></span>
          <div className="iev-head__txt">
            <div className="iev-head__t" id="iev-title">Evidence Vault</div>
            {/* The three references that say whose paperwork this is. */}
            <div className="iev-head__s">
              {[row.invoiceNo, row.supplierName, row.poNo].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="iev-head__x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="iev-body">
          {groups.map(g => (
            <section className="iev-grp" key={g.key}>
              <header className="iev-grp__hd">
                <span className="iev-grp__ico">{g.icon}</span>
                <div className="iev-grp__txt">
                  <div className="iev-grp__t">{g.title}</div>
                  <div className="iev-grp__s">{g.sub}</div>
                </div>
                <span className="iev-grp__n">{g.docs.length}</span>
              </header>

              {g.docs.map(doc => (
                <div className="iev-doc" key={doc.file}>
                  <span className="iev-doc__ico">PDF</span>
                  <div className="iev-doc__txt">
                    <div className="iev-doc__name" title={doc.file}>{doc.file}</div>
                    <div className="iev-doc__meta">{doc.meta}</div>
                  </div>
                  {/* Disabled until there is a document store behind them: a
                      button that silently does nothing is worse than one that
                      says why. */}
                  <button type="button" className="iev-btn iev-btn--view" disabled
                    title="Viewing arrives with the document store">
                    <IcoEye /> View
                  </button>
                  <button type="button" className="iev-btn iev-btn--dl" disabled
                    title="Downloading arrives with the document store">
                    <IcoDownload /> Download
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="iev-foot">
          <button type="button" className="iev-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
