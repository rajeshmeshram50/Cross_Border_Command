import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 2: Lead Acknowledgement
 *
 *   - Three status pills: Qualified Lead · Clarity Pending · Disqualified
 *   - Clicking a pill opens a modal listing the matching master reasons
 *     (from /sales/lead-ack-reasons). Disqualified is split into
 *     Positive / Negative columns by dq_status.
 *   - Multi-select reasons → Submit → POST /sales/leads/{id}/acknowledgements
 *     creates one activity row per picked reason. The backend also flips
 *     the lead's qualified / disqualified flags to match the submitted
 *     bucket so the worksheet tabs and counts stay in sync.
 *   - Activity Report table renders the append-only history (latest first).
 *   - Save & Next is gated on "latest activity row is Qualified" and on
 *     submit advances lead_stage_id → 3 via PUT /sales/leads/{id}.
 * ───────────────────────────────────────────────────────────────────────── */

type Bucket = 'qualified' | 'clarity_pending' | 'disqualified';

const BUCKET_META: Record<Bucket, { label: string; pill: string }> = {
  qualified:       { label: 'Qualified Lead',  pill: 'smd-st2-pill-q' },
  clarity_pending: { label: 'Clarity Pending', pill: 'smd-st2-pill-c' },
  disqualified:    { label: 'Disqualified',    pill: 'smd-st2-pill-d' },
};

type MasterReason = {
  id:                number;
  opportunity_type:  Bucket;
  reason:            string;
  status:            'active' | 'inactive';
  dq_status:         'positive' | 'negative' | null;
};

type MasterPayload = {
  qualified:       MasterReason[];
  disqualified:    MasterReason[];
  clarity_pending: MasterReason[];
};

export default function Stage2LeadAcknowledgement({ header, onPrev, onNext, reloadLead }: StageProps) {
  const toast = useToast();

  const acks = header.acknowledgements ?? [];
  const latest = acks[0] ?? null;
  const latestBucket: Bucket | null = (latest?.opportunity_type as Bucket) ?? null;

  const [pickerBucket, setPickerBucket] = useState<Bucket | null>(null);
  const [masters, setMasters] = useState<MasterPayload>({ qualified: [], disqualified: [], clarity_pending: [] });
  const [mastersLoading, setMastersLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  // Pull the master once on mount; the same payload feeds all three buckets.
  useEffect(() => {
    setMastersLoading(true);
    api.get<MasterPayload>('/sales/lead-ack-reasons')
      .then(({ data }) => setMasters({
        qualified:       (data.qualified ?? []).filter(r => r.status === 'active'),
        disqualified:    (data.disqualified ?? []).filter(r => r.status === 'active'),
        clarity_pending: (data.clarity_pending ?? []).filter(r => r.status === 'active'),
      }))
      .catch(() => toast.error('Load failed', 'Could not load acknowledgement reasons'))
      .finally(() => setMastersLoading(false));
  }, [toast]);

  const openPicker = (b: Bucket) => {
    if (!header.leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet to enable saving');
      return;
    }
    setPickerBucket(b);
    setSelected(new Set());
  };
  const closePicker = () => { setPickerBucket(null); setSelected(new Set()); };

  const submitPicker = async () => {
    if (!pickerBucket || !header.leadId) return;
    if (selected.size === 0) {
      toast.warning('Pick at least one', 'Select one or more reasons before submitting');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/sales/leads/${header.leadId}/acknowledgements`, {
        reason_ids: Array.from(selected),
      });
      toast.success('Saved', `${selected.size} acknowledgement(s) recorded`);
      closePicker();
      reloadLead?.();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save acknowledgements');
    } finally {
      setSaving(false);
    }
  };

  // Save & Next — server-side validation already ensures latestBucket
  // accurately reflects the lead's pipeline state; we still gate the
  // button up front so the user gets a fast no-op + actionable toast.
  const onSaveAndNext = async () => {
    if (!header.leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet to enable advancing');
      return;
    }
    if (latestBucket !== 'qualified') {
      toast.warning(
        'Cannot advance',
        'The latest acknowledgement must be "Qualified Lead" to move to Stage 3',
      );
      return;
    }
    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${header.leadId}`, { lead_stage_id: 3 });
      reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Advance failed', e?.response?.data?.message ?? 'Could not move to Stage 3');
    } finally {
      setAdvancing(false);
    }
  };

  /* ─── Reason picker modal — Qualified / Clarity show a single list;
   *     Disqualified shows two columns split by dq_status. */
  const pickerOptions = useMemo<MasterReason[]>(
    () => pickerBucket ? masters[pickerBucket] : [],
    [pickerBucket, masters],
  );
  const dqPositive = pickerOptions.filter(r => r.dq_status === 'positive');
  const dqNegative = pickerOptions.filter(r => r.dq_status !== 'positive');

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE2_CSS}</style>

      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 2: Lead Acknowledgement</div>
            <div className="smd-stg-head-sub">● Qualification confirmed and logged</div>
          </div>
        </div>
        <span className={`smd-stg-head-badge ${latestBucket ? `st2-badge-${latestBucket}` : ''}`}>
          {latestBucket ? `● ${BUCKET_META[latestBucket].label.toUpperCase()}` : '● PENDING'}
        </span>
      </div>

      <div className="smd-stg-body">
        {/* Status selector */}
        <div className="smd-st2-status-block">
          <div className="smd-st2-status-head">
            <span className="smd-st2-check">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <span className="smd-st2-status-title">LEAD ACKNOWLEDGEMENT STATUS</span>
            {latestBucket && (
              <span className={`smd-st2-status-current ${BUCKET_META[latestBucket].pill}`}>
                ● {BUCKET_META[latestBucket].label}
              </span>
            )}
          </div>

          <div className="smd-st2-pills">
            <button
              className={`smd-st2-pill smd-st2-pill-q ${latestBucket === 'qualified' ? 'active' : ''}`}
              onClick={() => openPicker('qualified')}
            >
              ● Qualified Lead
            </button>
            <button
              className={`smd-st2-pill smd-st2-pill-c ${latestBucket === 'clarity_pending' ? 'active' : ''}`}
              onClick={() => openPicker('clarity_pending')}
            >
              ● Clarity Pending
            </button>
            <button
              className={`smd-st2-pill smd-st2-pill-d ${latestBucket === 'disqualified' ? 'active' : ''}`}
              onClick={() => openPicker('disqualified')}
            >
              ● Disqualified
            </button>
          </div>

          <div className="smd-st2-status-hint">
            Click any pill to log a new acknowledgement. The latest entry decides whether this lead can advance to Stage 3.
          </div>
        </div>

        {/* Activity Report */}
        <div className="smd-st2-activity">
          <div className="smd-st2-activity-head">
            <div className="smd-st2-activity-head-left">
              <div className="smd-st2-activity-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3">
                  <path d="M3 3h18v4H3zM3 11h18v4H3zM3 19h18v2H3z"/>
                </svg>
              </div>
              <div className="smd-st2-activity-title">Activity Report</div>
              <span className="smd-st2-activity-count">{acks.length}</span>
            </div>
          </div>

          <div className="smd-st2-table-wrap">
            <table className="smd-st2-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 120 }}>DATE</th>
                  <th style={{ width: 160 }}>STATUS</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {acks.length === 0 && (
                  <tr>
                    <td colSpan={4} className="smd-st2-empty">
                      No activity yet — pick a status above to log the first acknowledgement.
                    </td>
                  </tr>
                )}
                {acks.map((row, idx) => {
                  const bucket = row.opportunity_type as Bucket;
                  return (
                    <tr key={row.id}>
                      <td><span className="smd-st2-row-num">{idx + 1}</span></td>
                      <td>{new Date(row.created_at).toLocaleDateString('en-GB')}</td>
                      <td>
                        <span className={`smd-st2-row-pill ${BUCKET_META[bucket].pill}`}>
                          ● {BUCKET_META[bucket].label}
                        </span>
                      </td>
                      <td className="smd-st2-row-reason">{row.reason_snapshot}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ Latest acknowledgement must be "Qualified Lead" to advance.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev}>← Previous</button>
          <button
            className="smd-stg-btn smd-stg-btn-primary"
            onClick={() => void onSaveAndNext()}
            disabled={advancing || latestBucket !== 'qualified'}
            title={latestBucket !== 'qualified' ? 'Latest entry must be Qualified Lead' : undefined}
          >
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>

      {/* ── Reason picker modal ── */}
      {pickerBucket && createPortal((
        <div className="st2-pick-backdrop" onClick={closePicker}>
          <div className="st2-pick-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`st2-pick-head ${BUCKET_META[pickerBucket].pill}`}>
              <div className="st2-pick-title">
                {BUCKET_META[pickerBucket].label}
                <span className="st2-pick-sub">Pick one or more reasons to log</span>
              </div>
              <button className="st2-pick-close" onClick={closePicker} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="st2-pick-body">
              {mastersLoading && <div className="st2-pick-empty">Loading reasons…</div>}
              {!mastersLoading && pickerOptions.length === 0 && (
                <div className="st2-pick-empty">
                  No active reasons configured for this bucket. Add some in <strong>Master → Lead Acknowledgement</strong>.
                </div>
              )}

              {pickerBucket === 'disqualified' && pickerOptions.length > 0 ? (
                <div className="st2-pick-cols">
                  <div className="st2-pick-col">
                    <div className="st2-pick-col-head st2-pick-col-head-neg">
                      ● Negative Disqualification
                    </div>
                    {dqNegative.length === 0
                      ? <div className="st2-pick-col-empty">No options</div>
                      : dqNegative.map(r => (
                        <ReasonRow key={r.id} reason={r} checked={selected.has(r.id)} onToggle={() => toggleSelect(r.id)} />
                      ))}
                  </div>
                  <div className="st2-pick-col">
                    <div className="st2-pick-col-head st2-pick-col-head-pos">
                      ● Positive Disqualification
                    </div>
                    {dqPositive.length === 0
                      ? <div className="st2-pick-col-empty">No options</div>
                      : dqPositive.map(r => (
                        <ReasonRow key={r.id} reason={r} checked={selected.has(r.id)} onToggle={() => toggleSelect(r.id)} />
                      ))}
                  </div>
                </div>
              ) : (
                pickerOptions.map(r => (
                  <ReasonRow key={r.id} reason={r} checked={selected.has(r.id)} onToggle={() => toggleSelect(r.id)} />
                ))
              )}
            </div>

            <div className="st2-pick-foot">
              <span className="st2-pick-count">{selected.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="st2-pick-btn st2-pick-btn-ghost" onClick={closePicker} disabled={saving}>Cancel</button>
                <button
                  className="st2-pick-btn st2-pick-btn-primary"
                  onClick={() => void submitPicker()}
                  disabled={saving || selected.size === 0}
                >
                  {saving ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

function ReasonRow({ reason, checked, onToggle }: { reason: MasterReason; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`st2-pick-row ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span>{reason.reason}</span>
    </label>
  );
}

const STAGE2_CSS = `
.smd-st2-status-block {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 12px;
}
.smd-st2-status-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.smd-st2-check {
  width: 22px; height: 22px; border-radius: 6px;
  background: linear-gradient(135deg,#10b981,#047857);
  display: flex; align-items: center; justify-content: center;
}
.smd-st2-status-title { font-size: 11.5px; font-weight: 800; letter-spacing: .04em; color: #1e293b; flex: 1; }
.smd-st2-status-current {
  font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px;
  border: 1px solid;
}
.smd-st2-status-hint {
  margin-top: 8px; font-size: 10.5px; color: #64748b; line-height: 1.5;
}
.smd-st2-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.smd-st2-pill {
  padding: 7px 14px; border-radius: 20px; border: 1px solid;
  background: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer;
  transition: all .15s;
}
.smd-st2-pill:hover { transform: translateY(-1px); }
.smd-st2-pill-q { color: #047857; border-color: #a7f3d0; }
.smd-st2-pill-q.active, .smd-st2-pill-q.smd-st2-status-current { background: #d1fae5; }
.smd-st2-pill-c { color: #d97706; border-color: #fde68a; }
.smd-st2-pill-c.active, .smd-st2-pill-c.smd-st2-status-current { background: #fffbeb; }
.smd-st2-pill-d { color: #dc2626; border-color: #fecaca; }
.smd-st2-pill-d.active, .smd-st2-pill-d.smd-st2-status-current { background: #fee2e2; }

.smd-stg-head-badge.st2-badge-qualified       { background: rgba(34,197,94,.22);  color: #bbf7d0; border: 1px solid rgba(74,222,128,.35); }
.smd-stg-head-badge.st2-badge-disqualified    { background: rgba(239,68,68,.22);  color: #fecaca; border: 1px solid rgba(248,113,113,.35); }
.smd-stg-head-badge.st2-badge-clarity_pending { background: rgba(245,158,11,.22); color: #fde68a; border: 1px solid rgba(252,211,77,.35); }

.smd-st2-activity {
  background: #fff; border: 1px solid #e9d5ff; border-radius: 12px;
  overflow: hidden;
}
.smd-st2-activity-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; background: #faf5ff; border-bottom: 1px solid #e9d5ff;
}
.smd-st2-activity-head-left { display: flex; align-items: center; gap: 9px; }
.smd-st2-activity-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg,#7c3aed,#6d28d9);
  display: flex; align-items: center; justify-content: center;
}
.smd-st2-activity-title { font-size: 13px; font-weight: 700; color: #4c1d95; }
.smd-st2-activity-count {
  background: #fef3c7; color: #92400e; font-size: 10.5px; font-weight: 800;
  padding: 1px 8px; border-radius: 20px;
}

.smd-st2-table-wrap { max-height: 260px; overflow-y: auto; }
.smd-st2-table { width: 100%; border-collapse: collapse; }
.smd-st2-table thead th {
  position: sticky; top: 0; background: #faf5ff;
  padding: 9px 12px; text-align: left;
  font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280;
  border-bottom: 1px solid #e9d5ff;
}
.smd-st2-table tbody td {
  padding: 9px 12px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9;
}
.smd-st2-row-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #f5f3ff; color: #6d28d9; font-size: 11px; font-weight: 800;
}
.smd-st2-row-pill { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; border: 1px solid; }
.smd-st2-row-reason { color: #475569; }
.smd-st2-empty {
  text-align: center; padding: 30px 12px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* ── Reason picker modal ── */
.st2-pick-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: st2-fade .15s ease-out;
}
@keyframes st2-fade { from { opacity: 0; } to { opacity: 1; } }
.st2-pick-modal {
  width: min(640px, 100%); max-height: 88vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  animation: st2-pop .18s ease-out;
}
@keyframes st2-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.st2-pick-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; color: #fff;
}
.st2-pick-head.smd-st2-pill-q { background: linear-gradient(135deg, #10b981, #047857); }
.st2-pick-head.smd-st2-pill-c { background: linear-gradient(135deg, #f59e0b, #d97706); }
.st2-pick-head.smd-st2-pill-d { background: linear-gradient(135deg, #ef4444, #b91c1c); }
.st2-pick-title { font-size: 15px; font-weight: 700; line-height: 1.2; }
.st2-pick-sub   { display: block; font-size: 11px; opacity: .85; margin-top: 3px; font-weight: 500; }
.st2-pick-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.20); color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.st2-pick-close:hover { background: rgba(255,255,255,.32); }

.st2-pick-body { padding: 14px 18px; flex: 1; overflow-y: auto; background: #f8fafc; }
.st2-pick-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 28px 12px; font-size: 12.5px; }

.st2-pick-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 8px; cursor: pointer;
  font-size: 12.5px; color: #1e293b;
  background: #fff; border: 1px solid #e2e8f0;
  margin-bottom: 6px; transition: all .12s;
}
.st2-pick-row:hover { border-color: #c4b5fd; background: #faf5ff; }
.st2-pick-row.on { border-color: #7c3aed; background: #ede9fe; }
.st2-pick-row input { accent-color: #7c3aed; cursor: pointer; }

.st2-pick-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.st2-pick-col-head {
  font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  padding: 6px 10px; border-radius: 8px; margin-bottom: 8px;
}
.st2-pick-col-head-neg { background: #fee2e2; color: #b91c1c; }
.st2-pick-col-head-pos { background: #dcfce7; color: #15803d; }
.st2-pick-col-empty {
  font-size: 11px; color: #cbd5e1; font-style: italic;
  text-align: center; padding: 12px 4px;
}

.st2-pick-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; background: #fff; border-top: 1px solid #e2e8f0;
}
.st2-pick-count { font-size: 11.5px; font-weight: 600; color: #64748b; }
.st2-pick-btn {
  padding: 8px 18px; border-radius: 9px; border: 1.5px solid transparent;
  font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all .15s;
}
.st2-pick-btn:disabled { opacity: .55; cursor: not-allowed; }
.st2-pick-btn-ghost { background: #fff; border-color: #e2e8f0; color: #475569; }
.st2-pick-btn-ghost:hover:not(:disabled) { background: #f1f5f9; border-color: #cbd5e1; }
.st2-pick-btn-primary { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; }
.st2-pick-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }

/* ── Dark mode ─────────────────────────────────────────────── */
[data-bs-theme="dark"] .smd-st2-status-block,
[data-bs-theme="dark"] .smd-st2-activity { background: #1a1538; border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .smd-st2-activity-head { background: rgba(124,58,237,.10); border-bottom-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .smd-st2-status-title  { color: #ede9fe; }
[data-bs-theme="dark"] .smd-st2-status-hint   { color: #94a3b8; }
[data-bs-theme="dark"] .smd-st2-pill          { background: #1f1845; }
[data-bs-theme="dark"] .smd-st2-table thead th { background: rgba(124,58,237,.12); color: #c4b5fd; border-bottom-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .smd-st2-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.16); }
[data-bs-theme="dark"] .smd-st2-row-reason     { color: #cbd5e1; }
[data-bs-theme="dark"] .smd-st2-row-num        { background: rgba(167,139,250,.22); color: #c4b5fd; }

[data-bs-theme="dark"] .st2-pick-modal       { background: #0f172a; }
[data-bs-theme="dark"] .st2-pick-body        { background: #0b1226; }
[data-bs-theme="dark"] .st2-pick-row         { background: #1f1845; border-color: rgba(167,139,250,.22); color: #ede9fe; }
[data-bs-theme="dark"] .st2-pick-row:hover   { background: rgba(124,58,237,.20); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .st2-pick-row.on      { background: rgba(124,58,237,.32); border-color: #a78bfa; }
[data-bs-theme="dark"] .st2-pick-foot        { background: #0f172a; border-top-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .st2-pick-btn-ghost   { background: #1f1845; border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .st2-pick-col-head-neg { background: rgba(239,68,68,.22); color: #fecaca; }
[data-bs-theme="dark"] .st2-pick-col-head-pos { background: rgba(34,197,94,.22); color: #bbf7d0; }

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 640px) {
  .st2-pick-cols { grid-template-columns: 1fr; }
  .smd-st2-status-head { flex-direction: column; align-items: flex-start; }
  .smd-st2-pills { flex-direction: column; align-items: stretch; }
  .smd-st2-pill { text-align: center; }
}
`;
