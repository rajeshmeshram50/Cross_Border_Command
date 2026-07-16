import { useEffect, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import SalesCustomerSendForSignatureModal from '../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal';
import { SigningTrackerModal } from '../../../sales/opportunity-pipeline/SigningTrackerModal';

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
  // Signed-PDF action. A document (not an eye) — the row already has an eye for
  // the draft view, so two eyes side by side would read as the same action.
  doc: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  fileSm: (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
  tabDoc: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  tabAgr: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>),
};

export default function TradeDocsTable({ po = 'PO/2025-26/001', poId, supplierId, productIds, buildPreview, onSignActive }: { po?: string; poId?: number | null; supplierId?: number | null; productIds?: number[]; buildPreview?: () => Record<string, unknown>; onSignActive?: (active: boolean) => void }) {
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
    // Fetch trade docs / agreements by the PO's PRODUCT segments. Prefer the
    // selected product ids (known from the wizard's Stage-2 rows even before the
    // PO is saved — which is exactly when this screen is used); fall back to the
    // saved PO id, then to the supplier's own segments (backend-side).
    const params: Record<string, string | number> =
      productIds && productIds.length ? { product_ids: productIds.join(',') }
      : poId ? { po_id: poId }
      : {};
    api.get(`/p2p/purchase-orders/suppliers/${supplierId}/trade-documents`, { params }).then(r => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, poId, po, (productIds ?? []).join(',')]);

  // ── Zoho Sign (reuse the CLM Send-for-Signature flow for the supplier) ──
  type Party = { id: string; db_id?: number; company: string; contact?: string; email?: string };
  const [party, setParty] = useState<Party | null>(null);
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);
  const [sendKind, setSendKind] = useState<'trade' | 'agreement'>('trade');
  const [sentBatch, setSentBatch] = useState<string[]>([]);
  // Purchase Order send-for-signature — routes the PO PDF through the SAME
  // shared modal in its raw-PDF mode (supplier is the single signer).
  const [poSign, setPoSign] = useState(false);
  // True when a BULK send bundles the PO PDF alongside CLM trade docs in one
  // Zoho request (the PO row was checked with ≥1 real trade document).
  const [bundlePoActive, setBundlePoActive] = useState(false);
  useEffect(() => {
    if (!supplierId) { setParty(null); return; }
    let cancelled = false;
    api.get(`/p2p/purchase-orders/suppliers/${supplierId}`).then(r => {
      const d = r.data?.data; if (cancelled || !d) return;
      setParty({ id: d.code || 'S-001', db_id: supplierId, company: d.name || 'Supplier', contact: d.contact || undefined, email: d.email || undefined });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [supplierId]);
  /* ── Live signature status ────────────────────────────────────────────────
   * The same party-scoped poll the Evidence Vault / Stage-5 tabs use: one list
   * call with sync=1, which round-trips Zoho so an in-progress request flips to
   * Signed on its own, every 20s.
   *
   * This is also what makes Track / Reminder possible at all: the send response
   * carries a signature_request_id but the table never kept it, so there was
   * nothing to track or remind against. Row status used to be in-memory only —
   * reopening the modal reset every row to "Pending" even when the PO was
   * already out for signature.
   *
   * Keyed to the row ids this table already uses ('po' | 'trade-<libId>' |
   * 'agreement-<libId>'). Splitting on document_type matters: a trade doc and an
   * agreement can share a numeric library id, so a flat map would overlay one
   * onto the other (the same trap ClmSignatureController::index documents). */
  type SigInfo = { id: number; status: string; reminderCount: number; lastReminderAt: string | null };
  const [sigByRow, setSigByRow] = useState<Record<string, SigInfo>>({});
  // Bumped after a send / reminder so the next poll runs at once, not up to 20s later.
  const [sigTick, setSigTick] = useState(0);
  const [trackSig, setTrackSig] = useState<{ id: number; code: string } | null>(null);
  const [remindBusy, setRemindBusy] = useState<string | null>(null);

  /* The shared sign modal (z ~265k) AND the signing tracker (z 12k) both sit
   * below the PO wizard/modal (z 2.5M+), so signal the parent to hide itself
   * while either is open — otherwise the tracker renders behind this modal. */
  useEffect(() => {
    onSignActive?.(Array.isArray(sendDocIds) || poSign || !!trackSig);
  }, [sendDocIds, poSign, trackSig, onSignActive]);

  useEffect(() => {
    if (!supplierId) { setSigByRow({}); return; }
    let alive = true;
    const load = async () => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: supplierId, model_name: 'Vendor', sync: 1 },
        });
        if (!alive) return;
        const rows: Array<Record<string, any>> = Array.isArray(r.data?.data) ? r.data.data : [];
        const map: Record<string, SigInfo> = {};
        // A document can be sent more than once (e.g. after a recall) — the
        // newest request wins, matching the list's own latest-first ordering.
        const consider = (key: string, row: Record<string, any>) => {
          const info: SigInfo = {
            id: Number(row.id),
            status: String(row.status ?? '').toLowerCase(),
            // Drives the "× N" badge on the Remind button, same as the
            // Agreements popup — kept live on the poll tick.
            reminderCount: Number(row.reminder_count ?? 0) || 0,
            lastReminderAt: (row.last_reminder_sent_at ?? null) as string | null,
          };
          if (!map[key] || info.id > map[key].id) map[key] = info;
        };
        rows.forEach(row => {
          const dt = String(row.document_type ?? 'trade_doc');
          if (dt === 'purchase_order') {
            // Sent on its own — the PO isn't a CLM library doc, so
            // trade_doc_id holds the PO id.
            if (poId && Number(row.trade_doc_id) === Number(poId)) consider('po', row);
            return;
          }
          const prefix = dt === 'agreement' ? 'agreement' : 'trade';
          const ids: unknown[] = Array.isArray(row.trade_doc_ids) && row.trade_doc_ids.length
            ? row.trade_doc_ids
            : (row.trade_doc_id != null ? [row.trade_doc_id] : []);
          // A bulk send bundles many library ids behind one request, so every
          // id in the bundle maps back to the same signature request.
          ids.forEach(id => consider(`${prefix}-${Number(id)}`, row));
          /* Bundled send: checking the PO alongside real trade docs rides the
           * PO PDF inside THIS request instead of raising a 'purchase_order'
           * one, so the PO appears nowhere in trade_doc_ids. The backend
           * records it on metadata precisely "so the request can be resolved
           * PO-side" (ClmSignatureController). Without this the PO row sat on
           * Pending forever after a bundled send, even though it had gone out. */
          if (poId && Number(row.metadata?.purchase_order_id) === Number(poId)) consider('po', row);
        });
        setSigByRow(map);
      } catch { /* best-effort — signature status never blocks the table */ }
    };
    void load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [supplierId, poId, sigTick]);

  /* Effective row status. The poll is authoritative once it has seen the row;
   * `d.status` only covers the optimistic window right after a send, before the
   * first poll lands. A declined / recalled request falls back to Pending so the
   * document can be sent again. */
  const stateOf = (d: TradeDoc): TradeDoc['status'] => {
    const sig = sigByRow[d.id];
    if (!sig) return d.status;
    if (sig.status === 'completed')  return 'signed';
    if (sig.status === 'inprogress') return 'sent';
    return 'pending';
  };

  const remindDoc = async (d: TradeDoc) => {
    const sig = sigByRow[d.id];
    if (!sig) return;
    setRemindBusy(d.id);
    try {
      const { data: r } = await api.post(`/clm/signature-requests/${sig.id}/remind`);
      toast.success('Reminder sent', r?.message ?? `The signer has been reminded to sign "${d.name}".`);
      /* Bump the badge immediately rather than waiting up to 20s for the next
       * poll. The server returns the authoritative counter, so prefer it and
       * only fall back to a local +1. A bulk send shares ONE request across
       * several rows, so every row backed by this signature id updates. */
      const serverCount  = Number(r?.data?.reminder_count ?? NaN);
      const serverLastAt = (r?.data?.last_reminder_sent_at ?? null) as string | null;
      setSigByRow(prev => {
        const next: Record<string, SigInfo> = {};
        for (const [key, info] of Object.entries(prev)) {
          next[key] = info.id !== sig.id ? info : {
            ...info,
            reminderCount: Number.isFinite(serverCount) ? serverCount : info.reminderCount + 1,
            lastReminderAt: serverLastAt ?? new Date().toISOString(),
          };
        }
        return next;
      });
    } catch (e: any) {
      toast.error('Reminder failed', e?.response?.data?.message ?? 'Could not send the reminder.');
    } finally {
      setRemindBusy(null);
    }
  };

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
  const pendingCount = visible.filter(d => stateOf(d) === 'pending').length;
  const selCount = visible.filter(d => stateOf(d) === 'pending' && sel[d.id]).length;

  const toggleDoc = (id: string, on: boolean) => setSel(s => { const n = { ...s }; if (on) n[id] = true; else delete n[id]; return n; });
  const toggleAll = (on: boolean) => setSel(s => { const n = { ...s }; visible.forEach(d => { if (stateOf(d) === 'pending') { if (on) n[d.id] = true; else delete n[d.id]; } }); return n; });
  const launchSign = (rowIds: string[]) => {
    if (!party?.db_id) { toast.error('Supplier required', 'Select a supplier first to send documents for signature.'); return; }
    const parsed = rowIds.map(parseRow).filter(Boolean) as Array<{ libId: number; kind: 'trade' | 'agreement' }>;
    const wantsPo = rowIds.includes('po') && !!poId;   // bundle the PO PDF into this request
    if (!parsed.length) {
      // Only the PO (no CLM docs) is selected → send it on its own.
      if (wantsPo) { setPoSign(true); return; }
      if (rowIds.some(id => id === 'po' || id === 'pa')) { toast.info('Purchase Order / Agreement', 'Generate the PO document first — it is not a CLM library document.'); return; }
      return;
    }
    setSentBatch(rowIds.filter(id => id === 'po' || parseRow(id)));
    setSendKind(parsed[0].kind);
    // The PO only bundles with the Trade Documents tab (it's not an agreement).
    setBundlePoActive(wantsPo && parsed[0].kind === 'trade');
    setSendDocIds(parsed.map(p => p.libId));
  };
  // The "Purchase Order" row isn't a CLM library doc — route it through the
  // shared sign modal in raw-PDF mode (needs a SAVED po id + a supplier). Falls
  // back to the plain PDF preview when the PO hasn't been saved yet.
  const sendDoc = (id: string) => {
    if (id === 'po') {
      // The wizard persists the PO only on the final "Generate Purchase Order",
      // so during creation there's no saved id to raise a Zoho request against —
      // show the draft PO preview instead of blocking. Once the PO is saved
      // (edit mode / after generate), open the full sign modal.
      if (!poId) { openPoPdf(false); return; }
      if (!party?.db_id) { toast.error('Supplier required', 'Select a supplier first to send the PO for signature.'); return; }
      setPoSign(true);
      return;
    }
    launchSign([id]);
  };
  const sendSelected = () => { const ids = visible.filter(d => stateOf(d) === 'pending' && sel[d.id]).map(d => d.id); if (ids.length) launchSign(ids); };
  const onSigSent = () => {
    setDocs(ds => ds.map(x => sentBatch.includes(x.id) ? { ...x, status: 'sent' } : x));
    setSel(s => { const n = { ...s }; sentBatch.forEach(id => delete n[id]); return n; });
    setSendDocIds(null); setSentBatch([]);
    setSigTick(t => t + 1);   // pick up the new request (and its id) right away
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
          const st = stateOf(d);
          const sent = st !== 'pending';
          const sig = sigByRow[d.id];
          const checked = !!sel[d.id];
          return (
            <tr key={d.id} className={checked ? 'cptd-rowsel' : ''}>
              <td className="cptd-cbcol"><input type="checkbox" className="cptd-check" checked={checked} disabled={sent} onChange={e => toggleDoc(d.id, e.target.checked)} aria-label={`Select ${d.name}`} /></td>
              <td>{i + 1}</td>
              <td className="cptd-l"><div className="cptd-docname">{d.name}</div><div className="cptd-docsub">{d.sub}</div></td>
              <td>{d.required ? <span className="cptd-req">Mandatory</span> : <span className="cptd-opt">Optional</span>}</td>
              <td className="cptd-date">{d.generated}</td>
              <td><span className={`cptd-status cptd-status--${st}`}><span className="cptd-dot" />{st === 'pending' ? 'Pending' : st === 'sent' ? 'Sent' : 'Signed'}</span></td>
              <td><div className="cptd-actions">
                {st === 'signed' ? (
                  <>
                    {/* Icon-only — keeps the signed row's action strip the same
                        width as every other row's. Colour still separates them:
                        green = signed PDF, amber = certificate. */}
                    <button className="cptd-lbtn cptd-lbtn--icon cptd-lbtn--signed" type="button" title="View signed PDF" aria-label="View signed PDF" onClick={() => viewDoc(d, true)}>{I.doc}</button>
                    <button className="cptd-lbtn cptd-lbtn--icon cptd-lbtn--coo" type="button" title="Certificate of Origin" aria-label="Certificate of Origin" onClick={() => viewCoo(d)}>{I.cert}</button>
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
                {/* Track — the shared signing tracker (timeline + signer details
                    + activity history), the same modal the PI rows open. Stays
                    available on signed rows so the completed timeline is still
                    readable. */}
                {sig && (
                  <button className="cptd-act" type="button" title="Track signature status"
                    onClick={() => setTrackSig({ id: sig.id, code: d.sub || d.name })}>{I.track}</button>
                )}
                {/* Reminder — only while the request is actually in progress;
                    Zoho rejects a reminder on a completed/recalled request. The
                    count badge mirrors the Agreements popup so the sender can
                    see how many nudges have already gone out. */}
                {sig && st === 'sent' && (
                  <button
                    className={`cptd-act${sig.reminderCount > 0 ? ' cptd-act--count' : ''}`}
                    type="button"
                    title={sig.reminderCount > 0
                      ? `Reminder sent ${sig.reminderCount} time${sig.reminderCount === 1 ? '' : 's'}${sig.lastReminderAt ? ` (last: ${new Date(sig.lastReminderAt).toLocaleString()})` : ''}`
                      : 'Send reminder to the signer'}
                    disabled={remindBusy === d.id}
                    onClick={() => void remindDoc(d)}
                  >
                    {I.reminder}
                    {sig.reminderCount > 0 && (
                      <span className="cptd-act__cnt" aria-label={`Reminder sent ${sig.reminderCount} time${sig.reminderCount === 1 ? '' : 's'}`}>{sig.reminderCount}</span>
                    )}
                  </button>
                )}
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
        /* Bundle the PO PDF into this request when it was checked alongside the
           trade docs — it rides as one extra document in the same Zoho request. */
        bundlePo={bundlePoActive && poId ? {
          id: poId,
          code: po,
          name: `Purchase Order · ${po}`,
          previewUrl: `/p2p/purchase-orders/${poId}/pdf?signature=1`,
        } : null}
        onClose={() => { setSendDocIds(null); setSentBatch([]); setBundlePoActive(false); }}
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
          previewUrl: `/p2p/purchase-orders/${poId}/pdf?signature=1`,
          sendUrl: `/p2p/purchase-orders/${poId}/send-for-signature`,
        } : null}
        onClose={() => setPoSign(false)}
        onSent={() => {
          setDocs(ds => ds.map(x => (x.id === 'po' ? { ...x, status: 'sent' } : x)));
          setPoSign(false);
          setSigTick(t => t + 1);   // pick up the new request (and its id) right away
          toast.success('Sent for signature via Zoho Sign');
        }}
      />

      {/* Signing tracker — shared with the PI / Quotation rows; everything it
          renders derives from GET /clm/signature-requests/{id}, so it needs
          nothing from this page beyond the request id. */}
      {trackSig && (
        <SigningTrackerModal sigId={trackSig.id} code={trackSig.code} onClose={() => setTrackSig(null)} />
      )}
    </>
  );
}
