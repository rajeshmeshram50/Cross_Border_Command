// PO Evidence Vault (prototype P2P Version 1): everything filed against one
// order, grouped the way it is looked for — the order, its invoices, the signed
// paperwork, money paid out and money recovered. Only real files are listed;
// a section with nothing on file says so instead of showing placeholders.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useToast } from '../../../../../contexts/ToastContext';
import { formatDmy } from '../../../../../utils/formatDmy';
import Tooltip from '../../../../../components/ui/Tooltip';
import { PoApiError, poDocumentApi, poSignatureApi, type PoDocument } from '../api/po-api';
import '../cancel-po/cancel-po.css';
import './evidence-vault.css';

export type VaultPo = { id: number; po: string; supplier: string; poDate: string };

/** Characters of the supplier name the header keeps; the rest is a tooltip. */
const SUPPLIER_MAX = 30;

type VaultFile = {
  key: string;
  name: string;
  kind: 'pdf' | 'jpg';
  meta: string;
  tag?: 'signed' | 'out' | 'in';
  /** Resolves the file for View / Download; absent = not generated yet. */
  fetch?: () => Promise<Blob>;
};

const ic = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IcX = () => <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const IcVault = () => <svg {...ic} strokeWidth={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
const IcEye = () => <svg {...ic} strokeWidth={2.2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
const IcDown = () => <svg {...ic} strokeWidth={2.3}><path d="M12 3v12" /><polyline points="7 11 12 16 17 11" /><path d="M4 20h16" /></svg>;
const IcOrder = () => <svg {...ic} strokeWidth={2.2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const IcInv = () => <svg {...ic} strokeWidth={2.2}><path d="M4 2h12l4 4v16l-3-2-3 2-3-2-3 2-3-2-1 1V4a2 2 0 0 1 2-2z" /><line x1="8" y1="9" x2="15" y2="9" /><line x1="8" y1="13" x2="15" y2="13" /></svg>;
const IcTrade = () => <svg {...ic} strokeWidth={2.2}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>;
const IcPay = () => <svg {...ic} strokeWidth={2.2}><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>;
const IcBack = () => <svg {...ic} strokeWidth={2.2}><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>;

const TAG_TEXT = { signed: 'Signed', out: 'Release', in: 'Recovered' } as const;
const kindOf = (name: string): 'pdf' | 'jpg' => (/\.(jpe?g|png|webp|heic)$/i.test(name) ? 'jpg' : 'pdf');

/** A PO document as vault entries: the file on record, plus its signed copy once signed. */
function filesOf(poId: number, d: PoDocument): VaultFile[] {
  const date = d.generated_on ? formatDmy(d.generated_on) : '';
  const out: VaultFile[] = [];
  const name = d.original_name || `${d.code.replace(/\//g, '_')}.pdf`;
  if (d.status === 'signed' && d.signature_request_id != null) {
    const sigId = d.signature_request_id;
    out.push({
      key: `s${d.id}`, name: `Signed_${name}`, kind: 'pdf', tag: 'signed',
      meta: ['Signed', d.signed_at ? formatDmy(d.signed_at.slice(0, 10)) : '', 'Zoho Sign'].filter(Boolean).join('  ·  '),
      fetch: () => poSignatureApi.signedFile(sigId, d.signature_index ?? 0),
    });
  }
  out.push({
    key: `d${d.id}`, name, kind: kindOf(name),
    meta: [d.name, date, d.status === 'sent' ? 'Sent for signature' : d.status === 'signed' ? 'Original' : (d.file_path ? 'Draft' : 'Not generated yet')].filter(Boolean).join('  ·  '),
    fetch: d.file_path ? () => poDocumentApi.download(poId, d.id) : undefined,
  });
  return out;
}

export default function PoEvidenceVaultModal({ po, onClose }: { po: VaultPo; onClose: () => void }) {
  useScrollLock(true, '.scnv-bd');
  const toast = useToast();
  const [docs, setDocs] = useState<PoDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    poDocumentApi.list(po.id)
      .then((rows) => { if (alive) setDocs(rows); })
      .catch((e) => { if (alive) { setDocs([]); toast.error('Could not load the vault', e instanceof PoApiError ? e.firstError : 'Please try again.'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const list = docs ?? [];
    return {
      order: list.filter((d) => d.doc_kind === 'purchase_order').flatMap((d) => filesOf(po.id, d)),
      trade: list.filter((d) => d.doc_kind !== 'purchase_order').flatMap((d) => filesOf(po.id, d)),
      // Invoices, payments and recoveries are not built on the new PO yet.
      inv: [] as VaultFile[], paid: [] as VaultFile[], rec: [] as VaultFile[],
    };
  }, [docs, po.id]);

  const open = async (f: VaultFile, mode: 'view' | 'get') => {
    if (!f.fetch || busy) return;
    setBusy(`${mode}:${f.key}`);
    try {
      const url = URL.createObjectURL(await f.fetch());
      if (mode === 'view') window.open(url, '_blank', 'noopener');
      else { const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(mode === 'view' ? 'Could not open the file' : 'Could not download the file', e instanceof PoApiError ? e.firstError : f.name);
    } finally {
      setBusy(null);
    }
  };

  const doc = (f: VaultFile) => (
    <div className="scnv-doc" key={f.key}>
      <span className={`scnv-doc__ico is-${f.kind}`}>{f.kind === 'jpg' ? 'JPG' : 'PDF'}</span>
      <span className="scnv-doc__txt">
        <span className="scnv-doc__n" title={f.name}>{f.name}</span>
        {f.meta && <span className="scnv-doc__m" title={f.meta}>{f.meta}</span>}
      </span>
      {f.tag && <span className={`scnv-tag is-${f.tag === 'signed' ? 'sig' : f.tag}`}>{TAG_TEXT[f.tag]}</span>}
      <span className="scnv-doc__acts">
        <button type="button" className="scnv-act" title="View" disabled={!f.fetch || !!busy} onClick={() => open(f, 'view')}>
          <IcEye /><span>{busy === `view:${f.key}` ? 'Opening…' : 'View'}</span>
        </button>
        <button type="button" className="scnv-act scnv-act--get" title="Download" disabled={!f.fetch || !!busy} onClick={() => open(f, 'get')}>
          <IcDown /><span>{busy === `get:${f.key}` ? 'Saving…' : 'Download'}</span>
        </button>
      </span>
    </div>
  );

  const group = (ico: ReactNode, title: string, sub: string, files: VaultFile[], empty: string) => (
    <div className="scnv-grp">
      <div className="scnv-grp__hd">
        <span className="scnv-grp__ico">{ico}</span>
        <span className="scnv-grp__txt"><span className="scnv-grp__t">{title}</span><span className="scnv-grp__s">{sub}</span></span>
        <span className="scnv-grp__n">{files.length}</span>
      </div>
      {docs === null
        ? <div className="scnv-none">Loading…</div>
        : files.length ? files.map(doc) : <div className="scnv-none">{empty}</div>}
    </div>
  );

  /* A long supplier name wrapped over three lines and pushed the header out of
     shape, so it is cut here and the whole name shows on hover. */
  const supplier = (po.supplier ?? '').trim();
  const supplierShort = supplier.length > SUPPLIER_MAX ? `${supplier.slice(0, SUPPLIER_MAX).trimEnd()}…` : supplier;

  return createPortal(
    <div className="porec-modal scnv-modal is-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="porec-box scnv-box" role="dialog" aria-modal="true" aria-label="Evidence Vault">
        <div className="porec-hd scnpick-hd">
          <span className="scnpick-hd__sheen" />
          <div className="porec-hd__ico"><IcVault /></div>
          <div>
            <div className="porec-hd__t">Evidence Vault</div>
            <div className="porec-hd__s">
              {po.po}
              {supplier && (
                <>
                  {'  ·  '}
                  <Tooltip label={supplier} disabled={supplier.length <= SUPPLIER_MAX} themed>
                    <span>{supplierShort}</span>
                  </Tooltip>
                </>
              )}
              {po.poDate && `  ·  ${formatDmy(po.poDate)}`}
            </div>
          </div>
          <button type="button" className="porec-hd__x" onClick={onClose} aria-label="Close"><IcX /></button>
        </div>
        <div className="porec-bd scnv-bd">
          {group(<IcOrder />, 'Purchase Order', 'The order everything here is filed against', groups.order,
            'The PO document is created when the order is submitted.')}
          {group(<IcInv />, 'Supplier Purchase Invoices', 'Invoices raised by the supplier under this order', groups.inv,
            'No supplier invoice has been raised against this order yet.')}
          {group(<IcTrade />, 'Trade Documents & Agreements', 'Signed paperwork and shipping documents for this order', groups.trade,
            'No trade document has been generated yet.')}
          {group(<IcPay />, 'All Payment Paid Proofs', 'Money released to the supplier against this order', groups.paid,
            'No payment has been released on this order yet.')}
          {group(<IcBack />, 'All Recovery Payment Proofs', 'Money recovered back through refunds and debit notes', groups.rec,
            'Nothing has been recovered against this order.')}
        </div>
        <div className="porec-ft">
          <button type="button" className="pocn-btn pocn-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
