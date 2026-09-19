import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import type { OrderRow } from './Order';
import { initials, money, supplierCode } from './payment-shared';
import {
  INSPECTION_PRODUCTS, INSPECTOR, ProofChip, VERDICTS,
  downloadFile, openFile, seedDraft, seedRecord, toProofFiles,
  type InspectionDraft, type InspectionLine, type InspectionProduct, type InspectionRecord, type ProofFile, type Verdict,
} from './inspection-shared';
import InspectionAttachmentsModal from './InspectionAttachmentsModal';
import InspectionProductView from './InspectionProductView';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './physical-inspection.css';

export type PhysicalInspectionProps = {
  row: OrderRow;
  record: InspectionRecord | null | undefined;
  draft: InspectionDraft | undefined;
  onDraftChange: (d: InspectionDraft) => void;
  onSignOff: (r: InspectionRecord) => void;
  onWithdraw: () => void;
  onContinue: () => void;
  onClose: () => void;
};

const NOTE = '__note';

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

function dmy(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

function shiftDays(iso: string, days: number): string {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const blankLine = (): InspectionLine => ({ verdict: '', files: [] });

function ProofList({ files, onView, onDownload, onRemove, onMore, emptyText }: {
  files: ProofFile[];
  onView: (i: number) => void;
  onDownload: (i: number) => void;
  onRemove: (i: number) => void;
  onMore: () => void;
  emptyText?: string;
}) {
  if (!files.length) return emptyText ? <div className="pins-empty">{emptyText}</div> : null;
  const rest = files.length - 1;
  return (
    <div className="pins-prooflist">
      <ProofChip file={files[0]} onView={() => onView(0)} onDownload={() => onDownload(0)} onRemove={() => onRemove(0)} />
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

export default function PhysicalInspectionModal({
  row, record, draft, onDraftChange, onSignOff, onWithdraw, onContinue, onClose,
}: PhysicalInspectionProps) {
  useScrollLock(true, '.pins-card');
  const toast = useToast();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  const [attFor, setAttFor] = useState<string | null>(null);
  const [viewFor, setViewFor] = useState<InspectionProduct | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || attFor || viewFor) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, attFor, viewFor]);

  const rec = useMemo(
    () => (record === undefined ? (row.inspectionDone ? seedRecord(row) : null) : record),
    [record, row],
  );
  const [d, setD] = useState<InspectionDraft>(() => draft ?? seedDraft());

  const persist = useRef(true);
  const latest = useRef({ d, onDraftChange });
  latest.current = { d, onDraftChange };
  useEffect(() => () => {
    if (persist.current) latest.current.onDraftChange(latest.current.d);
  }, []);

  const update = (next: InspectionDraft) => setD(next);
  const lineOf = (code: string) => d.lines[code] ?? blankLine();
  const filesOf = (code: string) => (code === NOTE ? d.noteFiles : lineOf(code).files);

  const setFiles = (code: string, files: ProofFile[]) => {
    if (code === NOTE) update({ ...d, noteFiles: files });
    else update({ ...d, lines: { ...d.lines, [code]: { ...lineOf(code), files } } });
  };

  const setVerdict = (code: string, verdict: Verdict) => {
    update({ ...d, lines: { ...d.lines, [code]: { ...lineOf(code), verdict } } });
  };

  const addFiles = async (code: string, e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    const added = await toProofFiles(list);
    e.target.value = '';
    if (added.length) {
      setD((cur) => {
        const prev = code === NOTE ? cur.noteFiles : (cur.lines[code] ?? blankLine()).files;
        const files = [...prev, ...added];
        return code === NOTE
          ? { ...cur, noteFiles: files }
          : { ...cur, lines: { ...cur.lines, [code]: { ...(cur.lines[code] ?? blankLine()), files } } };
      });
    }
  };

  const removeFile = (code: string, i: number) => {
    const f = filesOf(code)[i];
    if (f?.url) URL.revokeObjectURL(f.url);
    if (f?.thumb) URL.revokeObjectURL(f.thumb);
    setFiles(code, filesOf(code).filter((_, ix) => ix !== i));
  };

  const viewFile = (f: ProofFile) => { if (!openFile(f)) toast.info('Preview', `${f.name} — logic coming soon`); };
  const dlFile = (f: ProofFile) => { if (!downloadFile(f)) toast.info('Download', `${f.name} — logic coming soon`); };

  const products = INSPECTION_PRODUCTS;
  const marked = products.filter((p) => lineOf(p.code).verdict).length;
  const withProof = products.filter((p) => lineOf(p.code).files.length).length;
  const allMarked = marked === products.length;

  const submit = () => {
    if (!allMarked) { toast.warning('Mark every line', 'Mark every line before signing off'); return; }
    const lines: Record<string, InspectionLine> = {};
    products.forEach((p) => { lines[p.code] = { verdict: lineOf(p.code).verdict, files: [...lineOf(p.code).files] }; });
    onSignOff({
      by: INSPECTOR.name,
      role: INSPECTOR.role,
      at: new Date().toISOString(),
      lines,
      note: d.note.trim(),
      noteFiles: [...d.noteFiles],
    });
    toast.success('Physical inspection signed off', row.po);
  };

  const withdraw = () => {
    persist.current = false;
    onWithdraw();
    toast.warning('Inspection sign-off withdrawn', row.po);
  };

  const seq = row.po.match(/(\d+)$/)?.[1] ?? '001';
  const pctPaid = row.net > 0 ? Math.round((row.paid / row.net) * 100) : 0;
  const cards: { lbl: string; val: string; sub?: string; cls?: string }[] = [
    { lbl: 'Supplier', val: row.supplier, sub: `Code: ${supplierCode(row.supplier)}` },
    { lbl: 'PO Number', val: row.po, sub: dmy(row.poDate), cls: 'cyan' },
    { lbl: 'PI Number', val: `PI/2025-26/${seq}`, sub: dmy(shiftDays(row.poDate, -3)), cls: 'cyan' },
    { lbl: 'Shipment ID', val: row.shipment || '—', sub: row.shipment ? dmy(row.shipmentDate) : '', cls: row.shipment ? 'cyan' : '' },
    { lbl: 'Opportunity ID', val: row.opportunity, sub: dmy(row.opportunityDate), cls: 'cyan' },
    { lbl: 'Procurement ID', val: row.procurement, sub: dmy(row.procurementDate), cls: 'cyan' },
    { lbl: 'Total PO Amount', val: money(row.total) },
    { lbl: 'Paid Amount', val: money(row.paid), sub: `${pctPaid}% paid`, cls: 'green' },
    { lbl: 'Balance Amount', val: money(row.balance), cls: 'amber' },
  ];
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const verdictOf = (code: string) => (rec ? rec.lines[code] : lineOf(code)) ?? blankLine();

  const attProduct = attFor && attFor !== NOTE ? products.find((p) => p.code === attFor) : null;

  return createPortal(
    <div className="spi-mdl-backdrop">
      {attFor && (
        <InspectionAttachmentsModal
          productName={attFor === NOTE ? 'Inspection Note' : attProduct?.name ?? ''}
          productCode={attFor === NOTE ? 'Sign-off' : attFor}
          files={filesOf(attFor)}
          onView={(i) => viewFile(filesOf(attFor)[i])}
          onDownload={(i) => dlFile(filesOf(attFor)[i])}
          onRemove={(i) => removeFile(attFor, i)}
          onClose={() => setAttFor(null)}
        />
      )}
      {viewFor && <InspectionProductView product={viewFor} onClose={() => setViewFor(null)} />}

      <div className="spi-mdl pins-card" role="dialog" aria-modal="true" aria-labelledby="pins-title" tabIndex={-1} ref={cardRef}>

        <div className="pins-hero">
          <div className="pins-hero__row">
            <div className="pins-hero__id">
              <div className="pins-hero__icon">{rec ? ICON_OK : ICON_EYE}</div>
              <div className="pins-hero__txt">
                <div className="pins-hero__titlerow">
                  <span className="pins-hero__title" id="pins-title">Physical Inspection</span>
                  <span className="pins-hero__idpill">{row.po}</span>
                  <span className={`pins-hero__badge ${rec ? 'is-done' : 'is-pend'}`}>
                    <span className="pins-hero__bdot" />{rec ? 'Inspected' : 'Pending Inspection'}
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
          {rec && (
            <p className="pins-lead">
              All {products.length} line{products.length === 1 ? ' was' : 's were'} inspected and signed off, clearing the
              inspection hold on <b>{row.po}</b>. Signed off by <b>{rec.by}</b> on {whenText(rec.at)}.
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
                {products.map((p, i) => {
                  const line = verdictOf(p.code);
                  const tag = VERDICTS.find((v) => v.k === line.verdict);
                  const n = line.files.length;
                  return (
                    <tr key={p.code} className={`pins-tr${line.verdict ? ' is-' + line.verdict : ''}`}>
                      <td className="pins-td-sr">{i + 1}</td>
                      <td>
                        <div className="pins-prod__nm">{p.name}</div>
                        <div className="pins-prod__meta">
                          <span className="pins-code">{p.code}</span>
                          <span className="pins-kv">HSN <b>{p.hsn}</b></span>
                          <span className="pins-prod__dot" />
                          <span className="pins-kv">GST <b>{p.gst}%</b></span>
                        </div>
                      </td>
                      <td className="pins-desc">
                        <span className="pins-desc__txt">{p.desc}</span>
                        <button type="button" className="pins-desc__more" onClick={() => setViewFor(p)}>… Read more</button>
                      </td>
                      <td className="pins-td-c"><span className="pins-qty">{p.qty}</span></td>
                      <td className="pins-td-c">
                        {rec ? (
                          <span className={`pins-tagv pins-tagv--${line.verdict || 'none'}`}>
                            {tag?.ico}{tag ? tag.t : '—'}
                          </span>
                        ) : (
                          <span className="pins-seg">
                            {VERDICTS.map((v) => (
                              <button
                                type="button"
                                key={v.k}
                                className={`pins-seg__b pins-seg__b--${v.k}${line.verdict === v.k ? ' is-on' : ''}`}
                                onClick={() => setVerdict(p.code, v.k)}
                              >
                                {v.ico}<span>{v.t}</span>
                              </button>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="pins-td-proof">
                        {rec ? (
                          <span className={`pins-cnt${n ? ' is-on' : ''}`}>{n ? ICON_CHECK_SM : null}{n} file{n === 1 ? '' : 's'}</span>
                        ) : (
                          <div className="pins-attach">
                            <div className="pins-attach__row">
                              <label className="pins-btn" htmlFor={`pins-up-${p.code}`} title="Upload photos or videos">{ICON_UP}<span>Upload</span></label>
                              <label className="pins-btn pins-btn--cam" htmlFor={`pins-cam-${p.code}`} title="Capture with camera">{ICON_CAM}<span>Camera</span></label>
                              <span className={`pins-files${n ? ' is-on' : ''}`}>{n} file{n === 1 ? '' : 's'}</span>
                            </div>
                            <input id={`pins-up-${p.code}`} className="pins-file-in" type="file" multiple
                              accept="image/*,video/*,application/pdf" onChange={(e) => addFiles(p.code, e)} />
                            <input id={`pins-cam-${p.code}`} className="pins-file-in" type="file"
                              accept="image/*,video/*" capture="environment" onChange={(e) => addFiles(p.code, e)} />
                            <ProofList
                              files={line.files}
                              onView={(ix) => viewFile(line.files[ix])}
                              onDownload={(ix) => dlFile(line.files[ix])}
                              onRemove={(ix) => removeFile(p.code, ix)}
                              onMore={() => setAttFor(p.code)}
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

          {rec ? (
            rec.note && <div className="pins-note"><b>Inspection Note:</b> {rec.note}</div>
          ) : (
            <div className="pins-send">
              <div className="pins-send__hd">
                {ICON_SIGN}<b>Sign-off</b>
                <span>{marked} of {products.length} line{products.length === 1 ? '' : 's'} marked · {withProof} with proof</span>
              </div>
              <div className="pins-send__body">
                <div className="pins-send__col">
                  <label className="pins-send__lbl">Inspected by</label>
                  <div className="pins-person">
                    <span className="pins-person__av">{initials(INSPECTOR.name)}</span>
                    <span className="pins-person__txt">
                      <span className="pins-person__n">{INSPECTOR.name}</span>
                      <span className="pins-person__r">{INSPECTOR.role}</span>
                    </span>
                  </div>
                </div>
                <div className="pins-send__col">
                  <label className="pins-send__lbl" htmlFor="pins-note">Inspection Note <span className="pins-opt">optional</span></label>
                  <div className="pins-notebox">
                    <textarea
                      id="pins-note"
                      className="pins-notebox__ta"
                      maxLength={300}
                      placeholder="Condition of the goods, anything the approver should know…"
                      value={d.note}
                      onChange={(e) => update({ ...d, note: e.target.value })}
                    />
                    {d.noteFiles.length > 0 && (
                      <div className="pins-notebox__files">
                        <ProofList
                          files={d.noteFiles}
                          onView={(ix) => viewFile(d.noteFiles[ix])}
                          onDownload={(ix) => dlFile(d.noteFiles[ix])}
                          onRemove={(ix) => removeFile(NOTE, ix)}
                          onMore={() => setAttFor(NOTE)}
                        />
                      </div>
                    )}
                    <div className="pins-notebox__bar">
                      <label className="pins-btn pins-btn--solid" htmlFor="pins-up-note" title="Attach photos, videos or documents">{ICON_UP}<span>Upload</span></label>
                      <label className="pins-btn pins-btn--solid" htmlFor="pins-cam-note" title="Capture with camera">{ICON_CAM}<span>Camera</span></label>
                      <span className={`pins-files${d.noteFiles.length ? ' is-on' : ''}`}>
                        {d.noteFiles.length} file{d.noteFiles.length === 1 ? '' : 's'}
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
            {rec ? (
              <>
                <button type="button" className="spi-mdl-cancel" onClick={withdraw}>Withdraw sign-off</button>
                <button type="button" className="spi-mdl-confirm" onClick={onContinue}>Continue to payment request</button>
              </>
            ) : (
              <>
                <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  className="spi-mdl-confirm"
                  disabled={!allMarked}
                  title={allMarked ? 'Record the inspection sign-off' : 'Mark every line Correct, Damaged or Mismatched before signing off'}
                  onClick={submit}
                >
                  Submit Inspection
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
