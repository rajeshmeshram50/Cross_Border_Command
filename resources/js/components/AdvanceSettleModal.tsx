import { useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import type { AdvanceRequestRow } from './AdvanceRequestsTable';

/**
 * Settle Payment (Company advance) — the employee itemises how the advance was
 * used, one row per bill: amount + reason + required proof, "+ Add" for more.
 * The rows' total is compared to the advance (sanctioned/paid) amount:
 *   • Equal      total == advance → nothing owed
 *   • Minimum    total <  advance → employee RETURNS ₹(advance − total)
 *   • Maximum    total >  advance → company REIMBURSES ₹(total − advance)
 */

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { amount: string; reason: string; proof: File | null };

export default function AdvanceSettleModal({
  advance, onClose, onDone,
}: {
  advance: AdvanceRequestRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([{ amount: '', reason: '', proof: null }]);
  const [note, setNote] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!advance) return null;

  const advanceAmt = advance.sanctioned_amount ?? advance.amount ?? 0;
  const total = +rows.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2);
  const diff = +(total - advanceAmt).toFixed(2);
  const type: 'equal' | 'minimum' | 'maximum' = diff === 0 ? 'equal' : (diff < 0 ? 'minimum' : 'maximum');
  const balance = Math.abs(diff);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { amount: '', reason: '', proof: null }]);
  const removeRow = (i: number) => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs);

  const outcome = total <= 0
    ? { text: 'Add your usage rows to see the outcome.', tone: '#64748b', bg: '#f1f5f9', icon: 'ri-information-line' }
    : type === 'equal'
      ? { text: 'Usage equals the advance — nothing to return or reimburse.', tone: '#108548', bg: '#d6f4e3', icon: 'ri-checkbox-circle-line' }
      : type === 'minimum'
        ? { text: `Used less than the advance — ${inr(balance)} to be RETURNED to the company.`, tone: '#a4661c', bg: '#fde8c4', icon: 'ri-arrow-go-back-line' }
        : { text: `Used more than the advance — ${inr(balance)} to be REIMBURSED to the employee.`, tone: '#0e7490', bg: '#cffafe', icon: 'ri-add-circle-line' };

  const rowInvalid = (r: Row) => !(Number(r.amount) > 0) || !r.reason.trim() || !r.proof;

  const submit = async () => {
    if (rows.some(rowInvalid)) { setShowErr(true); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      rows.forEach((r, i) => {
        fd.append(`items[${i}][amount]`, String(Number(r.amount)));
        fd.append(`items[${i}][reason]`, r.reason.trim());
        if (r.proof) fd.append('proofs[]', r.proof);
      });
      if (note.trim()) fd.append('note', note.trim());
      const { data: res } = await api.post(`/advance-requests/${advance.id}/employee-settle`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Advance settled', res?.message ?? 'The advance has been settled.');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error('Could not settle', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="asm-backdrop" onMouseDown={onClose}>
      <style>{ASM_CSS}</style>
      <div className="asm-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="asm-hero">
          <div className="asm-hero-l">
            <span className="asm-hero-ico"><i className="ri-check-double-line" /></span>
            <div>
              <div className="asm-hero-eyebrow">HRMS · EXPENSE MANAGEMENT</div>
              <div className="asm-hero-title">Settle Payment · {advance.advance_type_other || advance.advance_type}</div>
              <div className="asm-hero-sub">Record where the company advance was used — one row per bill.</div>
            </div>
          </div>
          <button className="asm-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Read-only advance context (2 lines) */}
        <div className="asm-info">
          <div><label>ADVANCE ID</label><div>{advance.advance_no || `#${advance.id}`}</div></div>
          <div><label>EMPLOYEE</label><div>{advance.employee_name || '—'}</div></div>
          <div><label>TOTAL ADVANCE AMOUNT</label><div>{inr(advanceAmt)}</div></div>
          <div><label>REASON</label><div title={advance.reason || ''} className="asm-info-clip">{advance.reason || '—'}</div></div>
        </div>

        <div className="asm-body">
          {/* KPI strip */}
          <div className="asm-kpis">
            <div className="asm-kpi"><label>ADVANCE AMOUNT</label><b>{inr(advanceAmt)}</b></div>
            <div className="asm-kpi"><label>TOTAL USED</label><b>{inr(total)}</b></div>
            <div className="asm-kpi">
              <label>{type === 'maximum' ? 'TO REIMBURSE' : 'TO RETURN'}</label>
              <b style={{ color: type === 'maximum' ? '#0e7490' : type === 'minimum' ? '#a4661c' : '#108548' }}>{inr(balance)}</b>
            </div>
          </div>

          <div className="asm-sec-lbl">Usage &mdash; add a row per bill (amount, reason & proof)</div>
          <div className="asm-rows">
            {rows.map((r, i) => (
              <div className="asm-row" key={i}>
                <div className={`asm-cell asm-cell-amt ${showErr && !(Number(r.amount) > 0) ? 'asm-cell--err' : ''}`}>
                  <span>₹</span>
                  <input type="number" min={0} value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} placeholder="0.00" />
                </div>
                <input className={`asm-cell asm-cell-reason ${showErr && !r.reason.trim() ? 'asm-cell--err' : ''}`}
                  value={r.reason} onChange={e => setRow(i, { reason: e.target.value })} placeholder="Reason / where used…" maxLength={500} />
                {!r.proof ? (
                  <label className={`asm-cell asm-file ${showErr && !r.proof ? 'asm-cell--err' : ''}`}>
                    <i className="ri-attachment-2" /> <span>Proof</span>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" hidden onChange={e => setRow(i, { proof: e.target.files?.[0] ?? null })} />
                  </label>
                ) : (
                  <div className="asm-cell asm-file-chip" title={r.proof.name}>
                    <i className="ri-file-text-line" />
                    <span className="asm-file-name">{r.proof.name}</span>
                    <label className="asm-file-x" title="Replace"><i className="ri-refresh-line" />
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" hidden onChange={e => setRow(i, { proof: e.target.files?.[0] ?? null })} />
                    </label>
                  </div>
                )}
                <button type="button" className="asm-row-x" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label="Remove row">✕</button>
              </div>
            ))}
            <button type="button" className="asm-add" onClick={addRow}><i className="ri-add-line" /> Add row</button>
          </div>

          <div className="asm-outcome" style={{ background: outcome.bg, color: outcome.tone }}>
            <i className={outcome.icon} /> {outcome.text}
          </div>

          <div className="asm-fld">
            <label>NOTE</label>
            <textarea maxLength={500} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note about this settlement…" />
          </div>
        </div>

        <div className="asm-foot">
          <div className="asm-foot-hint"><i className="ri-information-line" /> {rows.length} row{rows.length === 1 ? '' : 's'} · Total used {inr(total)}</div>
          <div className="asm-foot-r">
            <button className="asm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="asm-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Settling…' : 'Settle Advance'}</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

const ASM_CSS = `
.asm-backdrop{position:fixed;inset:0;z-index:2900050;background:rgba(8,30,42,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px 16px;font-family:'DM Sans',system-ui,sans-serif;overflow-y:auto;}
.asm-modal{width:100%;max-width:760px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(8,40,60,.35);animation:asmIn .18s ease;}
@keyframes asmIn{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}
.asm-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 16px;background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);color:#fff;}
.asm-hero-l{display:flex;align-items:center;gap:13px;}
.asm-hero-ico{width:44px;height:44px;border-radius:11px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.asm-hero-eyebrow{font-size:10px;font-weight:800;letter-spacing:.09em;opacity:.85;}
.asm-hero-title{font-size:18px;font-weight:800;line-height:1.15;margin-top:1px;}
.asm-hero-sub{font-size:12px;opacity:.85;margin-top:2px;}
.asm-x{background:rgba(255,255,255,.16);border:none;color:#fff;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:14px;flex-shrink:0;}
.asm-x:hover{background:rgba(255,255,255,.3);}
.asm-info{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:14px 22px;background:linear-gradient(120deg,#0b6a86,#0891b2);color:#fff;}
.asm-info label{display:block;font-size:9.5px;font-weight:800;letter-spacing:.05em;opacity:.85;}
.asm-info>div>div{font-size:13.5px;font-weight:700;margin-top:2px;}
.asm-info-clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.asm-body{padding:18px 22px;display:flex;flex-direction:column;gap:14px;}
.asm-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.asm-kpi{border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;background:#f8fafc;}
.asm-kpi label{display:block;font-size:9.5px;font-weight:800;letter-spacing:.05em;color:#64748b;}
.asm-kpi b{font-size:16px;font-weight:800;color:#0f172a;}
.asm-sec-lbl{font-size:11px;font-weight:800;letter-spacing:.03em;color:#0e7490;text-transform:uppercase;}
.asm-rows{display:flex;flex-direction:column;gap:8px;}
.asm-row{display:grid;grid-template-columns:150px 1fr 170px 30px;gap:8px;align-items:center;}
.asm-cell{height:38px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;font-size:13px;color:#0f172a;}
.asm-cell--err{border-color:#ef4444;}
.asm-cell-amt{display:flex;align-items:center;padding:0 10px;}
.asm-cell-amt span{color:#64748b;font-weight:700;margin-right:6px;}
.asm-cell-amt input{border:none;outline:none;width:100%;font-size:13px;font-weight:600;color:#0f172a;background:transparent;}
.asm-cell-reason{padding:0 12px;outline:none;}
.asm-file{display:flex;align-items:center;gap:6px;padding:0 12px;font-size:12px;font-weight:600;color:#0891b2;cursor:pointer;border-style:dashed;background:#f8fafc;}
.asm-file-chip{display:flex;align-items:center;gap:6px;padding:0 10px;background:#f0fdff;border-color:#cffafe;color:#0e7490;font-size:12px;font-weight:600;}
.asm-file-name{max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.asm-file-x{display:inline-flex;align-items:center;cursor:pointer;color:#0e7490;}
.asm-row-x{width:30px;height:30px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:8px;cursor:pointer;font-size:12px;}
.asm-row-x:disabled{opacity:.4;cursor:not-allowed;}
.asm-add{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;border:1.5px dashed #cbd5e1;background:#f8fafc;color:#0e7490;border-radius:9px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer;}
.asm-add:hover{border-color:#22d3ee;background:#ecfeff;}
.asm-outcome{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:12.5px;font-weight:700;}
.asm-outcome i{font-size:16px;flex-shrink:0;}
.asm-fld{display:flex;flex-direction:column;gap:5px;}
.asm-fld label{font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#475569;}
.asm-fld textarea{border:1.5px solid #e2e8f0;border-radius:9px;padding:8px 12px;font-size:13px;font-family:inherit;color:#0f172a;outline:none;resize:vertical;}
.asm-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px 20px;border-top:1px solid #eef2f4;background:#f8fafc;}
.asm-foot-hint{display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;font-weight:600;}
.asm-foot-hint i{color:#0891b2;}
.asm-foot-r{display:flex;gap:10px;}
.asm-btn-ghost{border:1.5px solid #e2e8f0;background:#fff;color:#475569;border-radius:9px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;}
.asm-btn-primary{border:none;background:linear-gradient(135deg,#0e7490,#0891b2);color:#fff;border-radius:9px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(8,145,178,.35);}
.asm-btn-primary:disabled{opacity:.6;cursor:not-allowed;}
[data-bs-theme="dark"] .asm-modal{background:#0c232c;}
[data-bs-theme="dark"] .asm-kpi{background:#0b1e27;border-color:#173947;}
[data-bs-theme="dark"] .asm-kpi b{color:#e2e8f0;}
[data-bs-theme="dark"] .asm-cell{background:#0b1e27;border-color:#173947;color:#e2e8f0;}
[data-bs-theme="dark"] .asm-cell-amt input,[data-bs-theme="dark"] .asm-cell-reason{color:#e2e8f0;}
[data-bs-theme="dark"] .asm-fld textarea{background:#0b1e27;border-color:#173947;color:#e2e8f0;}
[data-bs-theme="dark"] .asm-foot{background:#0b1a22;border-color:#173947;}
[data-bs-theme="dark"] .asm-btn-ghost{background:#0b2029;border-color:#173947;color:#cbd5e1;}
@media (max-width:680px){.asm-info{grid-template-columns:1fr 1fr;}.asm-kpis{grid-template-columns:1fr;}.asm-row{grid-template-columns:1fr;}}
`;
