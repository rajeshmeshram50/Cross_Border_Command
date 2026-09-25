// The transaction's own paper trail — not the supplier's KYC vault. The order
// the request sits on, the trade documents generated off it, and every
// supplier invoice mapped to it.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import { formatDmy } from '../../../../utils/formatDmy';
import { IcoDownload, IcoEye, IcoFile, IcoX } from '../../icons';
import { PoApiError, poDocumentApi, poSignatureApi } from '../../purchase-management/order/api/po-api';
import type { PaymentRequestDetail, TradeDoc } from './paymentRequestDetailData';

type VaultRow = {
  id: string; sub: string; name: string; nameSub: string;
  date: string; amount: number | null; pill: ReactNode;
  /** The file on record; empty when nothing has been generated or uploaded. */
  file: string;
  /** Fetches the bytes — absent when the row has no file to open. */
  fetch?: () => Promise<Blob>;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function Pill({ tone, children }: { tone: 'ok' | 'wait' | 'sent'; children: ReactNode }) {
  return <span className={`ptv-pill is-${tone}`}><span className="ptv-pdot" />{children}</span>;
}
const signPill = (st: TradeDoc['status']) =>
  st === 'signed' ? <Pill tone="ok">Signed</Pill> : st === 'sent' ? <Pill tone="sent">Sent for Sign</Pill> : <Pill tone="wait">Pending</Pill>;

const I = ({ d }: { d: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

export default function TxnVaultModal({ detail, onClose }: { detail: PaymentRequestDetail; onClose: () => void }) {
  const toast = useToast();
  const { row, po, tradeDocs, doc } = detail;
  const poId = row.poId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The PO is also a trade document; it is listed once, with its signature state.
  const poDoc = tradeDocs.find(d => d.name === 'Purchase Order');
  const poRows: VaultRow[] = po ? [{
    id: po.po, sub: poDoc?.code ?? 'Order', name: 'Purchase Order', nameSub: row.supplier,
    date: po.poDate, amount: po.total, pill: poDoc ? signPill(poDoc.status) : <Pill tone="wait">Draft</Pill>,
    file: poDoc?.hasFile ? (poDoc.attachment || `${po.po.replace(/[^0-9A-Za-z]+/g, '_')}.pdf`) : '',
    fetch: poDoc?.hasFile ? () => fileOf(poDoc) : undefined,
  }] : [];
  const tdRows: VaultRow[] = tradeDocs.filter(d => d !== poDoc).map(d => ({
    id: d.code, sub: 'Agreement', name: d.name, nameSub: `Valid to ${formatDmy(d.valid)}`,
    date: d.generated, amount: null, pill: signPill(d.status),
    file: d.hasFile ? (d.attachment || `${d.code.replace(/[^0-9A-Za-z]+/g, '_')}.pdf`) : '',
    fetch: d.hasFile ? () => fileOf(d) : undefined,
  }));
  // Invoices mapped to the order; a direct SPI is its own single invoice.
  const spiRows: VaultRow[] = po
    ? po.invoices.map(l => ({
      id: l.spi, sub: 'Invoice', name: 'Supplier Purchase Invoice', nameSub: row.supplier,
      date: l.spiDate, amount: l.amount,
      pill: l.status === 'full' ? <Pill tone="ok">Fully Paid</Pill> : l.status === 'partial' ? <Pill tone="sent">Partially Paid</Pill> : <Pill tone="wait">Mapped</Pill>,
      file: '',
    }))
    : [{
      id: doc.id, sub: 'Invoice', name: 'Supplier Purchase Invoice', nameSub: row.supplier,
      date: doc.date, amount: row.totalAmount, pill: <Pill tone="wait">Direct SPI</Pill>,
      file: '',
    }];

  const total = poRows.length + tdRows.length + spiRows.length;
  const [busy, setBusy] = useState<string | null>(null);

  /* A signed document comes back from Zoho Sign; anything else is the file we
     hold on the PO. Both stream through the API, so an off-origin store (Azure)
     is no obstacle. */
  function fileOf(d: TradeDoc): Promise<Blob> {
    return d.status === 'signed' && d.signatureRequestId != null
      ? poSignatureApi.signedFile(d.signatureRequestId, d.signatureIndex ?? 0)
      : poDocumentApi.download(poId, d.id);
  }

  const act = async (r: VaultRow, mode: 'view' | 'get') => {
    if (!r.fetch || busy) return;
    setBusy(`${mode}:${r.id}`);
    try {
      const url = URL.createObjectURL(await r.fetch());
      if (mode === 'view') window.open(url, '_blank', 'noopener');
      else { const a = document.createElement('a'); a.href = url; a.download = r.file; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(mode === 'view' ? 'Could not open the file' : 'Could not download the file',
        e instanceof PoApiError ? e.firstError : r.file);
    } finally {
      setBusy(null);
    }
  };

  // Download All takes every row that actually has a file, one after another.
  const withFiles = [...poRows, ...tdRows, ...spiRows].filter(r => r.fetch);
  const downloadAll = async () => {
    if (!withFiles.length || busy) return;
    setBusy('all');
    let done = 0;
    for (const r of withFiles) {
      try {
        const url = URL.createObjectURL(await r.fetch!());
        const a = document.createElement('a');
        a.href = url; a.download = r.file; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        done += 1;
        await new Promise((ok) => setTimeout(ok, 350));
      } catch { /* one failure must not stop the rest */ }
    }
    setBusy(null);
    if (done === withFiles.length) toast.success('Download started', `${done} document${done === 1 ? '' : 's'}.`);
    else toast.warning('Some files could not be downloaded', `${done} of ${withFiles.length} started.`);
  };

  const section = (ico: ReactNode, title: string, sub: string, rows: VaultRow[]) => (
    <div className="ptv-sec">
      <div className="ptv-sec__hd">
        <span className="ptv-sec__ico">{ico}</span>
        <span className="ptv-sec__t">{title}</span>
        <span className="ptv-sec__n">{rows.length}</span>
        <span className="ptv-sec__s">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <div className="ptv-empty">Nothing recorded against this transaction yet.</div>
      ) : (
        <div className="ptv-tbl">
          <div className="ptv-row ptv-row--head">
            <span className="ptv-c">Reference</span><span className="ptv-c">Document</span><span className="ptv-c">Dated</span>
            <span className="ptv-c">Value</span><span className="ptv-c">Status</span><span className="ptv-c">Attachment</span>
            <span className="ptv-c">Action</span>
          </div>
          {rows.map(r => (
            <div className="ptv-row" key={r.id}>
              <span className="ptv-c ptv-c--id"><span className="ptv-id">{r.id}</span><span className="ptv-sub">{r.sub}</span></span>
              <span className="ptv-c ptv-c--name">
                <span className="ptv-nm" title={r.name}>{r.name}</span>
                <span className="ptv-nmsub" title={r.nameSub}>{r.nameSub}</span>
              </span>
              <span className="ptv-c ptv-c--date">{formatDmy(r.date)}</span>
              <span className="ptv-c ptv-c--amt">{r.amount !== null ? money(r.amount) : <span className="ptv-dash">—</span>}</span>
              <span className="ptv-c ptv-c--st">{r.pill}</span>
              <span className="ptv-c ptv-c--file">
                {/* An icon on its own said nothing; no file reads as a dash. */}
                {r.file ? (
                  <span className="ptv-file"><span className="ptv-file__ico"><IcoFile size={13} /></span><span className="ptv-file__n" title={r.file}>{r.file}</span></span>
                ) : <span className="ptv-dash">—</span>}
              </span>
              <span className="ptv-c ptv-c--act">
                <button type="button" className="ptv-btn ptv-btn--view" disabled={!r.fetch || !!busy}
                  title={r.fetch ? `View ${r.file}` : 'No file on record yet'} onClick={() => void act(r, 'view')}><IcoEye size={14} /></button>
                <button type="button" className="ptv-btn ptv-btn--dl" disabled={!r.fetch || !!busy}
                  title={r.fetch ? `Download ${r.file}` : 'No file on record yet'} onClick={() => void act(r, 'get')}><IcoDownload size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(
    <div className="prd-vault" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ptv-box" role="dialog" aria-modal="true" aria-label="Evidence Vault">
        <div className="ptv-hd">
          <span className="ptv-hd__ico"><I d={<><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>} /></span>
          <div className="ptv-hd__txt">
            <div className="ptv-hd__t">Evidence Vault<span className="ptv-hd__count">{total} document{total === 1 ? '' : 's'}</span></div>
            <div className="ptv-hd__s">Everything on record for {row.requestId} · raised against {doc.id} · {row.supplier}</div>
          </div>
          <button type="button" className="ptv-hd__x" onClick={onClose} aria-label="Close"><IcoX size={15} /></button>
        </div>
        <div className="ptv-bd">
          {section(<I d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /></>} />,
            'Purchase Order', 'The order this request was raised against', poRows)}
          {section(<I d={<><path d="M20 11.08V8l-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6" /><path d="M14 3v5h5" /><path d="m17 18 2 2 4-4" /></>} />,
            'Trade Documents & Agreements', 'Agreements generated off this order and tracked through Zoho Sign', tdRows)}
          {section(<I d={<><path d="M4 2h13l3 3v17l-3-2-3 2-3-2-3 2-4-2V2z" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /></>} />,
            'Supplier Purchase Invoices', po ? 'Invoices mapped to this order' : 'The invoice this request was raised on', spiRows)}
        </div>
        <div className="ptv-ft">
          <span className="ptv-ft__n">{total} document{total === 1 ? '' : 's'} on this transaction</span>
          <button type="button" className="ptv-close" onClick={onClose}>Close</button>
          <button type="button" className="ptv-all" disabled={!withFiles.length || !!busy}
            title={withFiles.length ? `Download ${withFiles.length} file${withFiles.length === 1 ? '' : 's'}` : 'No files on record yet'}
            onClick={() => void downloadAll()}>
            <IcoDownload size={14} /><span>{busy === 'all' ? 'Downloading…' : 'Download All'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
