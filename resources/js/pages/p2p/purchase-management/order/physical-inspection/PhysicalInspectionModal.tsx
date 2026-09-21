// Physical Inspection of a submitted PO: a verdict and proof per line, then a
// sign-off. Every verdict, upload and removal is saved as it is made
// (po-api → /p2p/orders/{po}/inspection), so an inspection can be paused and
// picked up again; the sign-off note and its files go with the sign-off.
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useToast } from '../../../../../contexts/ToastContext';
import { useAuth } from '../../../../../contexts/AuthContext';
import type { OrderRow } from '../po-list/Order';
import { initials, money } from '../manage-payment/payment-shared';
import { PoApiError, poInspectionApi, type InspectionFile, type InspectionSummary } from '../api/po-api';
import {
  ProofChip, VERDICTS, downloadFile, openFile, toProofFiles,
  type ProofFile, type Verdict,
} from './inspection-shared';
import InspectionAttachmentsModal from './InspectionAttachmentsModal';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './physical-inspection.css';

// The product master's detail view, opened by "Read more".
const InspectionProductView = lazy(() => import('./InspectionProductView'));

export type PhysicalInspectionProps = {
  row: OrderRow;
  onClose: () => void;
  /** The inspection status changed (signed off / withdrawn) — refresh the list. */
  onChanged?: () => void;
};

const NOTE = -1;

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_EYE = <svg {...ic} strokeWidth={2.2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
const ICON_OK = <svg {...ic} strokeWidth={2.6}><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_X = <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const ICON_UP = <svg {...ic} strokeWidth={2.4}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
const ICON_CAM = <svg {...ic} strokeWidth={2.3}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
const ICON_CHEV = <svg {...ic} strokeWidth={2.6}><polyline points="9 18 15 12 9 6" /></svg>;
const ICON_SIGN = <svg {...ic} strokeWidth={2.3}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
const ICON_CHECK_SM = <svg {...ic} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;

function dmy(iso: string | null | undefined): string {
  const [y, m, d] = (iso || '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

function whenText(iso: string | null): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A stored proof file as the chips show it. */
const toProof = (f: InspectionFile): ProofFile => {
  const kind = f.mime?.startsWith('image/') ? 'image' : f.mime?.startsWith('video/') ? 'video' : 'file';
  return { index: f.index, name: f.name, size: f.size, kind, url: f.url, thumb: kind === 'image' ? f.url : undefined };
};

const roleLabel = (t?: string) => (t ? t.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '');

function ProofList({ files, onView, onDownload, onRemove, onMore, emptyText }: {
  files: ProofFile[];
  onView: (i: number) => void;
  onDownload: (i: number) => void;
  onRemove?: (i: number) => void;
  onMore: () => void;
  emptyText?: string;
}) {
  if (!files.length) return emptyText ? <div className="pins-empty">{emptyText}</div> : null;
  const rest = files.length - 1;
  return (
    <div className="pins-prooflist">
      <ProofChip file={files[0]} onView={() => onView(0)} onDownload={() => onDownload(0)} onRemove={onRemove && (() => onRemove(0))} />
      {rest > 0 && (
        <button type="button" className="pins-more" onClick={onMore}>
          <span className="pins-more__n">+{rest}</span>
          <span className="pins-more__t">View more proof{rest === 1 ? '' : 's'}</span>
          {ICON_CHEV}
        </button>
      )}
    </div>
  );
}

export default function PhysicalInspectionModal({ row, onClose, onChanged }: PhysicalInspectionProps) {
  useScrollLock(true, '.pins-card');
  const toast = useToast();
  const { user } = useAuth();
  const poId = row.id as number;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  const [sum, setSum] = useState<InspectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Key of the save in flight ("v:12", "f:12", "sign", …) — its control shows busy.
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Sign-off files stay in the browser until the sign-off sends them.
  const [noteFiles, setNoteFiles] = useState<{ file: File; proof: ProofFile }[]>([]);
  const [attFor, setAttFor] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);

  const fail = (e: unknown) => {
    if (e instanceof PoApiError) toast.error(`${e.action} failed`, e.firstError);
    else toast.error('Something went wrong', 'Please try again.');
  };

  useEffect(() => {
    let alive = true;
    poInspectionApi.show(poId)
      .then((s) => { if (alive) { setSum(s); setNote(s.inspection_note ?? ''); } })
      .catch((e) => { if (alive) { fail(e); onClose(); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || attFor !== null || viewId !== null) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, attFor, viewId]);

  const run = async (key: string, task: () => Promise<InspectionSummary>) => {
    if (busy) return;
    setBusy(key);
    try { setSum(await task()); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const signed = sum?.inspection_status === 'completed';
  const lines = sum?.lines ?? [];
  const lineById = (id: number) => lines.find((l) => l.purchase_order_item_id === id);
  const filesOf = (id: number): ProofFile[] => (id === NOTE
    ? (signed ? (sum?.inspection_note_files ?? []).map(toProof) : noteFiles.map((n) => n.proof))
    : (lineById(id)?.proof_files ?? []).map(toProof));

  const setVerdict = (id: number, verdict: Verdict) =>
    run(`v:${id}`, () => poInspectionApi.markLine(poId, id, { verdict }));

  const addFiles = async (id: number, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!picked.length) return;
    if (id === NOTE) {
      const proofs = await toProofFiles(picked);
      setNoteFiles((cur) => [...cur, ...picked.map((file, i) => ({ file, proof: proofs[i] }))]);
      return;
    }
    await run(`f:${id}`, () => poInspectionApi.markLine(poId, id, { files: picked }));
  };

  const removeFile = (id: number, i: number) => {
    if (id === NOTE) {
      const gone = noteFiles[i];
      if (gone?.proof.url) URL.revokeObjectURL(gone.proof.url);
      setNoteFiles((cur) => cur.filter((_, ix) => ix !== i));
      return;
    }
    const f = filesOf(id)[i];
    if (f?.index === undefined) return;
    void run(`f:${id}`, () => poInspectionApi.removeFile(poId, id, f.index as number));
  };

  const viewFile = (f: ProofFile) => { if (!openFile(f)) toast.info('Preview unavailable', f.name); };
  const dlFile = (f: ProofFile) => { if (!downloadFile(f)) toast.info('Download unavailable', f.name); };

  const marked = lines.filter((l) => l.verdict).length;
  const withProof = lines.filter((l) => l.proof_files.length).length;
  const allMarked = lines.length > 0 && marked === lines.length;

  const submit = () => run('sign', async () => {
    const s = await poInspectionApi.signOff(poId, note.trim() || undefined, noteFiles.map((n) => n.file));
    noteFiles.forEach((n) => n.proof.url && URL.revokeObjectURL(n.proof.url));
    setNoteFiles([]);
    toast.success('Physical inspection signed off', row.po);
    onChanged?.();
    return s;
  });

  const withdraw = () => run('withdraw', async () => {
    const s = await poInspectionApi.withdraw(poId);
    toast.warning('Inspection sign-off withdrawn', row.po);
    onChanged?.();
    return s;
  });

  const continueToPayment = () => toast.info('Feature coming soon', 'Payment requests will be available shortly.');

  const total = sum?.grand_total ?? row.total;
  const cards: { lbl: string; val: string; sub?: string; cls?: string }[] = [
    { lbl: 'Supplier', val: sum?.supplier_name ?? row.supplier, sub: sum?.supplier_code ? `Code: ${sum.supplier_code}` : undefined },
    { lbl: 'PO Number', val: sum?.code ?? row.po, sub: dmy(sum?.po_date ?? row.poDate), cls: 'cyan' },
    { lbl: 'PI Number', val: sum?.pi_code ?? '—', sub: sum?.pi_code ? dmy(sum.pi_date) : '', cls: sum?.pi_code ? 'cyan' : '' },
    { lbl: 'Shipment ID', val: sum?.shipment_code ?? '—', sub: sum?.shipment_code ? dmy(sum.shipment_date) : '', cls: sum?.shipment_code ? 'cyan' : '' },
    { lbl: 'Opportunity ID', val: sum?.opportunity_code ?? '—', cls: sum?.opportunity_code ? 'cyan' : '' },
    { lbl: 'Procurement ID', val: sum?.procurement_request_code ?? '—', cls: sum?.procurement_request_code ? 'cyan' : '' },
    // Payments are not built on the new PO yet, so nothing is paid.
    { lbl: 'Total PO Amount', val: money(total) },
    { lbl: 'Paid Amount', val: money(0), sub: '0% paid', cls: 'green' },
    { lbl: 'Balance Amount', val: money(total), cls: 'amber' },
  ];
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const attLine = attFor !== null && attFor !== NOTE ? lineById(attFor) : null;
  const inspectorName = signed ? (sum?.inspected_by_name ?? '—') : (user?.name ?? '—');
  const inspectorRole = signed ? 'Signed off' : roleLabel(user?.user_type);

  return createPortal(
    <div className="spi-mdl-backdrop">
      {attFor !== null && (
        <InspectionAttachmentsModal
          productName={attFor === NOTE ? 'Inspection Note' : attLine?.product_name ?? ''}
          productCode={attFor === NOTE ? 'Sign-off' : attLine?.product_code ?? ''}
          files={filesOf(attFor)}
          onView={(i) => viewFile(filesOf(attFor)[i])}
          onDownload={(i) => dlFile(filesOf(attFor)[i])}
          onRemove={(i) => { if (!signed) removeFile(attFor, i); }}
          onClose={() => setAttFor(null)}
        />
      )}
      {viewId !== null && (
        <Suspense fallback={null}>
          <InspectionProductView productId={viewId} onClose={() => setViewId(null)} />
        </Suspense>
      )}

      <div className="spi-mdl pins-card" role="dialog" aria-modal="true" aria-labelledby="pins-title" tabIndex={-1} ref={cardRef}>

        <div className="pins-hero">
          <div className="pins-hero__row">
            <div className="pins-hero__id">
              <div className="pins-hero__icon">{signed ? ICON_OK : ICON_EYE}</div>
              <div className="pins-hero__txt">
                <div className="pins-hero__titlerow">
                  <span className="pins-hero__title" id="pins-title">Physical Inspection</span>
                  <span className="pins-hero__idpill">{row.po}</span>
                  <span className={`pins-hero__badge ${signed ? 'is-done' : 'is-pend'}`}>
                    <span className="pins-hero__bdot" />{signed ? 'Inspected' : 'Pending Inspection'}
                  </span>
                </div>
                <div className="pins-hero__sub">Business Reference · Generated {today}</div>
              </div>
            </div>
            <button type="button" className="pins-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
          </div>
          <div className="pins-hero__cards">
            {cards.map((c) => (
              <div className="pins-hero__card" key={c.lbl}>
                <span className="pins-hero__card-lbl">{c.lbl}</span>
                <span className={`pins-hero__card-val${c.cls ? ' ' + c.cls : ''}`}>{c.val}</span>
                {c.sub && <span className="pins-hero__card-sub">{c.sub}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="pins-bd">
          {signed && (
            <p className="pins-lead">
              All {lines.length} line{lines.length === 1 ? ' was' : 's were'} inspected and signed off, clearing the
              inspection hold on <b>{row.po}</b>. Signed off by <b>{inspectorName}</b> on {whenText(sum?.inspected_at ?? null)}.
            </p>
          )}

          <div className="pins-scroll">
            <table className="pins-tbl">
              <colgroup>
                <col className="pins-col-sr" /><col className="pins-col-prod" /><col className="pins-col-desc" />
                <col className="pins-col-qty" /><col className="pins-col-rmk" /><col className="pins-col-proof" />
              </colgroup>
              <thead>
                <tr>
                  <th>Sr. No</th>
                  <th className="pins-th-left">Product (PO)</th>
                  <th className="pins-th-left">Description</th>
                  <th>Quantity (PO)</th>
                  <th>Inspection Remark</th>
                  <th>Proof of Inspection</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="pins-empty">Loading inspection…</td></tr>
                )}
                {lines.map((l, i) => {
                  const id = l.purchase_order_item_id;
                  const tag = VERDICTS.find((v) => v.k === l.verdict);
                  const files = filesOf(id);
                  const n = files.length;
                  return (
                    <tr key={id} className={`pins-tr${l.verdict ? ' is-' + l.verdict : ''}`}>
                      <td className="pins-td-sr">{i + 1}</td>
                      <td>
                        <div className="pins-prod__nm">{l.product_name ?? '—'}</div>
                        <div className="pins-prod__meta">
                          {l.product_code && <span className="pins-code">{l.product_code}</span>}
                          <span className="pins-kv">HSN <b>{l.hsn_code || '—'}</b></span>
                          <span className="pins-prod__dot" />
                          <span className="pins-kv">GST <b>{l.gst_pct}%</b></span>
                        </div>
                      </td>
                      <td className="pins-desc">
                        <span className="pins-desc__txt">{l.description || '—'}</span>
                        {l.product_id && (
                          <button type="button" className="pins-desc__more" onClick={() => setViewId(l.product_id)}>… Read more</button>
                        )}
                      </td>
                      <td className="pins-td-c"><span className="pins-qty">{l.quantity}{l.uom ? ` ${l.uom}` : ''}</span></td>
                      <td className="pins-td-c">
                        {signed ? (
                          <span className={`pins-tagv pins-tagv--${l.verdict || 'none'}`}>
                            {tag?.ico}{tag ? tag.t : '—'}
                          </span>
                        ) : (
                          <span className="pins-seg">
                            {VERDICTS.map((v) => (
                              <button
                                type="button"
                                key={v.k}
                                disabled={busy === `v:${id}`}
                                className={`pins-seg__b pins-seg__b--${v.k}${l.verdict === v.k ? ' is-on' : ''}`}
                                onClick={() => { if (l.verdict !== v.k) void setVerdict(id, v.k); }}
                              >
                                {v.ico}<span>{v.t}</span>
                              </button>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="pins-td-proof">
                        {signed ? (
                          <button type="button" className={`pins-cnt${n ? ' is-on' : ''}`} disabled={!n} onClick={() => setAttFor(id)}>
                            {n ? ICON_CHECK_SM : null}{n} file{n === 1 ? '' : 's'}
                          </button>
                        ) : (
                          <div className="pins-attach">
                            <div className="pins-attach__row">
                              <label className="pins-btn" htmlFor={`pins-up-${id}`} title="Upload photos or videos">{ICON_UP}<span>Upload</span></label>
                              <label className="pins-btn pins-btn--cam" htmlFor={`pins-cam-${id}`} title="Capture with camera">{ICON_CAM}<span>Camera</span></label>
                              <span className={`pins-files${n ? ' is-on' : ''}`}>
                                {busy === `f:${id}` ? 'Saving…' : `${n} file${n === 1 ? '' : 's'}`}
                              </span>
                            </div>
                            <input id={`pins-up-${id}`} className="pins-file-in" type="file" multiple disabled={busy === `f:${id}`}
                              accept="image/*,video/*,application/pdf" onChange={(e) => addFiles(id, e)} />
                            <input id={`pins-cam-${id}`} className="pins-file-in" type="file" disabled={busy === `f:${id}`}
                              accept="image/*,video/*" capture="environment" onChange={(e) => addFiles(id, e)} />
                            <ProofList
                              files={files}
                              onView={(ix) => viewFile(files[ix])}
                              onDownload={(ix) => dlFile(files[ix])}
                              onRemove={(ix) => removeFile(id, ix)}
                              onMore={() => setAttFor(id)}
                              emptyText="No evidence attached for this product yet."
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {signed ? (
            (sum?.inspection_note || filesOf(NOTE).length > 0) && (
              <div className="pins-note">
                {sum?.inspection_note && <><b>Inspection Note:</b> {sum.inspection_note}</>}
                {filesOf(NOTE).length > 0 && (
                  <ProofList files={filesOf(NOTE)} onView={(ix) => viewFile(filesOf(NOTE)[ix])} onDownload={(ix) => dlFile(filesOf(NOTE)[ix])} onMore={() => setAttFor(NOTE)} />
                )}
              </div>
            )
          ) : (
            <div className="pins-send">
              <div className="pins-send__hd">
                {ICON_SIGN}<b>Sign-off</b>
                <span>{marked} of {lines.length} line{lines.length === 1 ? '' : 's'} marked · {withProof} with proof</span>
              </div>
              <div className="pins-send__body">
                <div className="pins-send__col">
                  <label className="pins-send__lbl">Inspected by</label>
                  <div className="pins-person">
                    <span className="pins-person__av">{initials(inspectorName)}</span>
                    <span className="pins-person__txt">
                      <span className="pins-person__n">{inspectorName}</span>
                      <span className="pins-person__r">{inspectorRole}</span>
                    </span>
                  </div>
                </div>
                <div className="pins-send__col">
                  <label className="pins-send__lbl" htmlFor="pins-note">Inspection Note <span className="pins-opt">optional</span></label>
                  <div className="pins-notebox">
                    <textarea
                      id="pins-note"
                      className="pins-notebox__ta"
                      maxLength={1000}
                      placeholder="Condition of the goods, anything the approver should know…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    {noteFiles.length > 0 && (
                      <div className="pins-notebox__files">
                        <ProofList
                          files={filesOf(NOTE)}
                          onView={(ix) => viewFile(filesOf(NOTE)[ix])}
                          onDownload={(ix) => dlFile(filesOf(NOTE)[ix])}
                          onRemove={(ix) => removeFile(NOTE, ix)}
                          onMore={() => setAttFor(NOTE)}
                        />
                      </div>
                    )}
                    <div className="pins-notebox__bar">
                      <label className="pins-btn pins-btn--solid" htmlFor="pins-up-note" title="Attach photos, videos or documents">{ICON_UP}<span>Upload</span></label>
                      <label className="pins-btn pins-btn--solid" htmlFor="pins-cam-note" title="Capture with camera">{ICON_CAM}<span>Camera</span></label>
                      <span className={`pins-files${noteFiles.length ? ' is-on' : ''}`}>
                        {noteFiles.length} file{noteFiles.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <input id="pins-up-note" className="pins-file-in" type="file" multiple
                      accept="image/*,video/*,application/pdf" onChange={(e) => addFiles(NOTE, e)} />
                    <input id="pins-cam-note" className="pins-file-in" type="file"
                      accept="image/*,video/*" capture="environment" onChange={(e) => addFiles(NOTE, e)} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            {signed ? (
              <>
                <button type="button" className="spi-mdl-cancel" disabled={busy === 'withdraw'} onClick={withdraw}>
                  {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw sign-off'}
                </button>
                <button type="button" className="spi-mdl-confirm" onClick={continueToPayment}>Continue to payment request</button>
              </>
            ) : (
              <>
                <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
                <button
                  type="button"
                  className="spi-mdl-confirm"
                  disabled={!allMarked || busy === 'sign'}
                  title={allMarked ? 'Record the inspection sign-off' : 'Mark every line Correct, Damaged or Mismatched before signing off'}
                  onClick={submit}
                >
                  {busy === 'sign' ? 'Submitting…' : 'Submit Inspection'}
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
