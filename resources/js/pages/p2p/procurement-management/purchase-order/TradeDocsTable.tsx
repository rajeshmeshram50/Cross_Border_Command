import { useEffect, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import SalesCustomerSendForSignatureModal from '../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal';

/* ─────────────────────────────────────────────────────────────────────────
 * Trade Documents table — shared by the Trade Documents & Agreements modal
 * (row action) and the Create-PO wizard's stage 4.
 *
 * Two tabs: "Trade Documents" (Purchase Order) and "Agreements". Zoho-Sign-style
 * list: per-row Send for Sign, bulk send, a draft "View" (opens the unsigned PO
 * PDF), and — once a document is sent — Track + Reminder actions. When signed &
 * returned, the row shows "Signed PDF" + "Certificate of Origin" buttons.
 * The PO row's View/Signed PDF open the real PO PDF; other rows are placeholders.
 * ───────────────────────────────────────────────────────────────────────── */

type Cat = 'trade' | 'agreement';
type TradeDoc = { id: string; name: string; sub: string; cat: Cat; required: boolean; generated: string; status: 'pending' | 'sent' | 'signed' };
const TODAY = (() => { const d = new Date(); const mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2); return `${dd}/${mm}/${d.getFullYear()}`; })();
// Only "Purchase Order" is a constant (rendered from the PI blade — view &
// download). Everything else, including "Purchase Agreement", is fetched from
// the CLM Trade Document / Agreement masters for the supplier.
const makeConstants = (po: string): TradeDoc[] => [
  { id: 'po', name: 'Purchase Order', sub: po, cat: 'trade', required: true, generated: TODAY, status: 'pending' },
];

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

export default function TradeDocsTable({ po = 'PO/2025-26/001', poId, supplierId, buildPreview, onSignActive }: { po?: string; poId?: number | null; supplierId?: number | null; buildPreview?: () => Record<string, unknown>; onSignActive?: (active: boolean) => void }) {
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
          sub: id === 'po' ? po : String(x.sub ?? ''),
          required: !!x.required, generated: TODAY, status: 'pending',
        });
      });
      push(d?.trade, 'trade');
      push(d?.agreements, 'agreement');
      setDocs(list.length ? list : makeConstants(po));
    }).catch(() => { if (!cancelled) setDocs(makeConstants(po)); });
    return () => { cancelled = true; };
  }, [supplierId, po]);

  // ── Zoho Sign (reuse the CLM Send-for-Signature flow for the supplier) ──
  type Party = { id: string; db_id?: number; company: string; contact?: string; email?: string };
  const [party, setParty] = useState<Party | null>(null);
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);
  const [sendKind, setSendKind] = useState<'trade' | 'agreement'>('trade');
  const [sentBatch, setSentBatch] = useState<string[]>([]);
  // Purchase Order send-for-signature — routes the PO PDF through the SAME
  // shared modal in its raw-PDF mode (supplier is the single signer).
  const [poSign, setPoSign] = useState(false);
  // The shared sign modal (z ~265k) sits below the PO wizard/modal (z 2.5M+), so
  // signal the parent to hide itself while the sign modal is open.
  useEffect(() => { onSignActive?.(Array.isArray(sendDocIds) || poSign); }, [sendDocIds, poSign, onSignActive]);
  useEffect(() => {
    if (!supplierId) { setParty(null); return; }
    let cancelled = false;
    api.get(`/p2p/purchase-orders/suppliers/${supplierId}`).then(r => {
      const d = r.data?.data; if (cancelled || !d) return;
      setParty({ id: d.code || 'S-001', db_id: supplierId, company: d.name || 'Supplier', contact: d.contact || undefined, email: d.email || undefined });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [supplierId]);
  // Parse a row id ("trade-5" / "agreement-3") → library id + kind; constants skip.
  const parseRow = (id: string): { libId: number; kind: 'trade' | 'agreement' } | null => {
    if (id === 'po' || id === 'pa') return null;
    const [prefix, num] = id.split('-');
    const libId = Number(num);
    if (Number.isNaN(libId)) return null;
    return { libId, kind: prefix === 'agreement' ? 'agreement' : 'trade' };
  };

  const tradeCount = docs.filter(d => d.cat === 'trade').length;
  const agrCount = docs.filter(d => d.cat === 'agreement').length;
  const visible = docs.filter(d => d.cat === tab);
  const pendingCount = visible.filter(d => d.status === 'pending').length;
  const selCount = visible.filter(d => d.status === 'pending' && sel[d.id]).length;

  const toggleDoc = (id: string, on: boolean) => setSel(s => { const n = { ...s }; if (on) n[id] = true; else delete n[id]; return n; });
  const toggleAll = (on: boolean) => setSel(s => { const n = { ...s }; visible.forEach(d => { if (d.status === 'pending') { if (on) n[d.id] = true; else delete n[d.id]; } }); return n; });
  const launchSign = (rowIds: string[]) => {
    if (!party?.db_id) { toast.error('Supplier required', 'Select a supplier first to send documents for signature.'); return; }
    const parsed = rowIds.map(parseRow).filter(Boolean) as Array<{ libId: number; kind: 'trade' | 'agreement' }>;
    if (rowIds.some(id => id === 'po' || id === 'pa') && !parsed.length) { toast.info('Purchase Order / Agreement', 'Generate the PO document first — it is not a CLM library document.'); return; }
    if (!parsed.length) return;
    setSentBatch(rowIds.filter(id => parseRow(id)));
    setSendKind(parsed[0].kind);
    setSendDocIds(parsed.map(p => p.libId));
  };
  // The "Purchase Order" row isn't a CLM library doc — route it through the
  // shared sign modal in raw-PDF mode (needs a SAVED po id + a supplier). Falls
  // back to the plain PDF preview when the PO hasn't been saved yet.
  const sendDoc = (id: string) => {
    if (id === 'po') {
      if (!poId) { toast.info('Save the PO first', 'Save the purchase order before sending it for signature.'); return; }
      if (!party?.db_id) { toast.error('Supplier required', 'Select a supplier first to send the PO for signature.'); return; }
      setPoSign(true);
      return;
    }
    launchSign([id]);
  };
  const sendSelected = () => { const ids = visible.filter(d => d.status === 'pending' && sel[d.id]).map(d => d.id); if (ids.length) launchSign(ids); };
  const onSigSent = () => {
    setDocs(ds => ds.map(x => sentBatch.includes(x.id) ? { ...x, status: 'sent' } : x));
    setSel(s => { const n = { ...s }; sentBatch.forEach(id => delete n[id]); return n; });
    setSendDocIds(null); setSentBatch([]);
    toast.success('Sent for signature via Zoho Sign');
  };

  // Open the PO PDF. In Edit (saved) mode → GET the stored PO's PDF; in Add
  // (unsaved) mode → POST the current form data to render a live preview.
  // Only the "Purchase Order" constant row maps to the PO document.
  const openPoPdf = (withSignature: boolean) => {
    const w = window.open('', '_blank');
    toast.info(`Preparing PO PDF${withSignature ? ' (signed)' : ' (draft)'}…`);
    const done = (blob: Blob) => { const url = URL.createObjectURL(blob); if (w) w.location.href = url; else window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); };
    const fail = () => { if (w) w.close(); toast.error('Could not open PO PDF', 'Please try again.'); };
    if (poId) {
      api.get(`/p2p/purchase-orders/${poId}/pdf`, { params: { signature: withSignature ? 1 : 0 }, responseType: 'blob' })
        .then(res => done(res.data as Blob)).catch(fail);
    } else if (buildPreview) {
      api.post('/p2p/purchase-orders/preview-pdf', { ...buildPreview(), signature: withSignature ? 1 : 0 }, { responseType: 'blob' })
        .then(res => done(res.data as Blob)).catch(fail);
    } else {
      if (w) w.close();
      toast.info('Select a supplier first', 'The Purchase Order preview needs a supplier and products.');
    }
  };
  // Draft (no signature) / signed view. Only the "Purchase Order" row maps to
  // the PO document; other rows are CLM library docs (placeholder for now).
  const viewDoc = (d: TradeDoc, withSignature: boolean) => {
    if (d.id === 'po') { openPoPdf(withSignature); return; }
    toast.info(`Viewing ${d.name} (${withSignature ? 'signed' : 'draft'})`);
  };
  const viewCoo = (d: TradeDoc) => toast.info(`Certificate of Origin — ${d.name}`, 'Coming in a later phase');

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
              <td>{d.required ? <span className="cptd-req">Mandatory</span> : <span className="cptd-opt">Optional</span>}</td>
              <td className="cptd-date">{d.generated}</td>
              <td><span className={`cptd-status cptd-status--${d.status}`}><span className="cptd-dot" />{d.status === 'pending' ? 'Pending' : d.status === 'sent' ? 'Sent' : 'Signed'}</span></td>
              <td><div className="cptd-actions">
                {d.status === 'signed' ? (
                  <>
                    <button className="cptd-lbtn cptd-lbtn--signed" type="button" title="View signed PO" onClick={() => viewDoc(d, true)}>{I.eye} Signed PDF</button>
                    <button className="cptd-lbtn cptd-lbtn--coo" type="button" title="Certificate of Origin" onClick={() => viewCoo(d)}>{I.cert} Certificate of Origin</button>
                  </>
                ) : (
                  <button className="cptd-send" type="button" disabled={sent} onClick={() => sendDoc(d.id)}>{I.send} {sent ? 'Sent' : 'Send for Sign'}</button>
                )}
                {/* Draft view — always available (unsigned PO PDF). Icon-only,
                    styled like the compact action buttons (e.g. Email). */}
                <button className="cptd-act" type="button" title="View draft" onClick={() => viewDoc(d, false)}>{I.eye}</button>
                {/* Email is only meaningful for the Purchase Order document —
                    the other trade documents / agreements are e-signed via Zoho,
                    not emailed from here. */}
                {d.id === 'po' && (
                  <button className="cptd-act" type="button" title="Email document" onClick={() => toast.info(`Email composer opened for "${d.name}"`)}>{I.mail}</button>
                )}
                {d.status === 'sent' && <button className="cptd-act" type="button" title="Track signature status" onClick={() => toast.info(`Tracking signature status — ${d.name}`)}>{I.track}</button>}
                {d.status === 'sent' && <button className="cptd-act" type="button" title="Send reminder" onClick={() => toast.info(`Reminder sent — ${d.name}`)}>{I.reminder}</button>}
              </div></td>
            </tr>
          );
        })}</tbody>
      </table></div>

      <div className="cptd-bulk">
        <span className="cptd-bulk__cnt">{selCount ? <><strong>{selCount}</strong> document{selCount > 1 ? 's' : ''} selected</> : (pendingCount ? 'Select documents to send for signature together' : 'All documents have been sent')}</span>
        <button className="cptd-bulk__btn" type="button" disabled={!selCount} onClick={sendSelected}>{I.send}<span>Send Selected for Sign{selCount ? ` (${selCount})` : ''}</span></button>
      </div>

      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={party}
        modelName="Vendor"
        sendAsAgreement={sendKind === 'agreement'}
        preselectedDocIds={sendDocIds ?? undefined}
        /* Pass the selected rows' metadata so a bulk agreement send shows EVERY
           selected agreement in the preview rail (the modal's own library fetch
           can't resolve agreement ids). */
        preselectedDocs={docs
          .filter(d => sentBatch.includes(d.id))
          .map(d => { const p = parseRow(d.id); return p ? { id: p.libId, name: d.name, sub: d.sub } : null; })
          .filter(Boolean) as { id: number; name: string; sub?: string }[]}
        onClose={() => { setSendDocIds(null); setSentBatch([]); }}
        onSent={onSigSent}
      />

      {/* Purchase Order → same modal in raw-PDF mode (supplier signs the PO PDF).
          Separate instance so PO and CLM-library sends never share state. */}
      <SalesCustomerSendForSignatureModal
        open={poSign}
        customer={party}
        modelName="Vendor"
        rawPdfContext={poId ? {
          docId: poId,
          code: po,
          title: `Purchase Order · ${po}`,
          previewUrl: `/p2p/purchase-orders/${poId}/pdf?signature=0`,
          sendUrl: `/p2p/purchase-orders/${poId}/send-for-signature`,
        } : null}
        onClose={() => setPoSign(false)}
        onSent={() => {
          setDocs(ds => ds.map(x => (x.id === 'po' ? { ...x, status: 'sent' } : x)));
          setPoSign(false);
          toast.success('Sent for signature via Zoho Sign');
        }}
      />
    </>
  );
}
