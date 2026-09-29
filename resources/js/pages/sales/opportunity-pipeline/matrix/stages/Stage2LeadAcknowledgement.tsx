import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { useAuth } from '../../../../../contexts/AuthContext';
import LeadAckReasonModal, { type LeadAckReason } from '../../../core-masters/lead-ack/LeadAckReasonModal';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import type { StageAcknowledgement } from '../SalesMatrixDetail';
import Tooltip from '../../../../../components/ui/Tooltip';

/* Sales Matrix → Stage 2: Lead Acknowledgement.
 * A status pill opens its master reasons; each submitted reason becomes an
 * Activity Report row, and the latest row must be Qualified to reach Stage 3. */

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

export default function Stage2LeadAcknowledgement({ header, onPrev, onNext, reloadLead, canEnterNextStage }: StageProps) {
  const toast = useToast();

  // Optimistic rows (negative ids) shown until reloadLead brings the real ones.
  const [pendingAcks, setPendingAcks] = useState<StageAcknowledgement[]>([]);
  const headerAcks = header.acknowledgements ?? [];
  // Server-row count when placeholders were added, so arriving rows retire them.
  const baseAckCountRef = useRef(0);
  const acks = useMemo(() => {
    if (pendingAcks.length === 0) return headerAcks;
    const landed = Math.max(0, headerAcks.length - baseAckCountRef.current);
    const visiblePending = landed >= pendingAcks.length ? [] : pendingAcks.slice(landed);
    return [...visiblePending, ...headerAcks];
  }, [pendingAcks, headerAcks]);
  const latest = acks[0] ?? null;
  const latestBucket: Bucket | null = (latest?.opportunity_type as Bucket) ?? null;

  const [pickerBucket, setPickerBucket] = useState<Bucket | null>(null);
  const [masters, setMasters] = useState<MasterPayload>({ qualified: [], disqualified: [], clarity_pending: [] });
  const [mastersLoading, setMastersLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [advancing, setAdvancing] = useState(false);

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

  // Add New Reason — the Lead Acknowledgement master's own popup and permission.
  const { user } = useAuth();
  const ackPerm = user?.permissions?.['sales.lead_ack_master'];
  const canAddReason = user?.user_type === 'super_admin' || !!ackPerm?.can_add;
  const [addOpen, setAddOpen]     = useState(false);
  const [addPreset, setAddPreset] = useState<Bucket | null>(null);
  const openAddReason = (b?: Bucket | null) => { setAddPreset(b ?? null); setAddOpen(true); };

  const onReasonAdded = (row: LeadAckReason) => {
    if (row.status !== 'active') return;
    const t = row.opportunity_type;
    setMasters(prev => ({ ...prev, [t]: [...prev[t], row] }));
    if (pickerBucket === t) setSelected(prev => new Set(prev).add(row.id));
  };

  // ESC closes the picker, unless the Add New Reason popup is on top of it.
  useEffect(() => {
    if (!pickerBucket || addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerBucket, addOpen]);

  useEffect(() => {
    if (!pickerBucket) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [pickerBucket]);

  const submitPicker = async () => {
    if (!pickerBucket || !header.leadId) return;
    if (selected.size === 0) {
      toast.warning('Pick at least one', 'Select one or more reasons before submitting');
      return;
    }

    // A lead with Stage 3+ work (products, quotation, PI) can't be un-qualified;
    // the API enforces the same rule.
    const work = header.downstreamWork ?? [];
    if (pickerBucket !== 'qualified' && work.length > 0) {
      toast.error(
        pickerBucket === 'disqualified' ? 'Cannot disqualify this lead' : 'Cannot move this lead back',
        'This opportunity already carries ' + work.join(' and ')
          + '. Remove that work from Stage 3 onwards first — the verdict is open '
          + 'again once the lead is clean.',
      );
      return;
    }

    const reasonIds = Array.from(selected);
    const pickedReasons = pickerOptions.filter(r => selected.has(r.id));
    const nowIso = new Date().toISOString();
    const optimistic: StageAcknowledgement[] = pickedReasons.map((r, i) => ({
      id:                 -(Date.now() + i),
      lead_ack_reason_id: r.id,
      opportunity_type:   r.opportunity_type,
      dq_status:          r.dq_status,
      reason_snapshot:    r.reason,
      created_at:         nowIso,
    }));
    const optimisticIds = new Set(optimistic.map(o => o.id));

    baseAckCountRef.current = headerAcks.length;
    setPendingAcks(prev => [...optimistic, ...prev]);
    closePicker();
    toast.success('Saved', `${optimistic.length} acknowledgement(s) recorded`);

    try {
      await api.post(`/sales/leads/${header.leadId}/acknowledgements`, { reason_ids: reasonIds });
      await reloadLead?.();
      setPendingAcks(prev => prev.filter(p => !optimisticIds.has(p.id)));
    } catch (e: any) {
      setPendingAcks(prev => prev.filter(p => !optimisticIds.has(p.id)));
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save acknowledgements');
    }
  };

  const onSaveAndNext = async () => {
    if (!header.leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to save your progress.');
      return;
    }
    if (latestBucket == null) {
      toast.warning(
        'Acknowledge the lead first',
        'Pick a status pill above (Qualified / Clarity Pending / Disqualified) and submit a reason before advancing to Stage 3.',
      );
      return;
    }
    if (latestBucket !== 'qualified') {
      toast.warning(
        'Qualify the lead first',
        'You cannot proceed further without qualifying the lead.',
      );
      return;
    }
    // Check Stage 3's entry rules (e.g. a salesperson) before writing the advance.
    if (canEnterNextStage && !canEnterNextStage()) return;

    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${header.leadId}`, { lead_stage_id: 3 });
      toast.success('Stage advanced', 'Moving to Product Sourcing (Stage 3)…');
      await reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Could not advance', e?.response?.data?.message ?? 'Network or server error — please try again.');
    } finally {
      setAdvancing(false);
    }
  };

  // Disqualified splits its reasons into Negative / Positive columns.
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
            {canAddReason && (
              <button type="button" className="smd-st2-add-reason" onClick={() => openAddReason(null)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add New Reason
              </button>
            )}
            {latestBucket && (
              <span className={`smd-st2-status-current ${BUCKET_META[latestBucket].pill}`}>
                {BUCKET_META[latestBucket].label}
              </span>
            )}
          </div>

          <div className="smd-st2-pills">
            <button
              className={`smd-st2-pill smd-st2-pill-q ${latestBucket === 'qualified' ? 'active' : ''}`}
              onClick={() => openPicker('qualified')}
            >
              Qualified Lead
            </button>
            <button
              className={`smd-st2-pill smd-st2-pill-c ${latestBucket === 'clarity_pending' ? 'active' : ''}`}
              onClick={() => openPicker('clarity_pending')}
            >
              Clarity Pending
            </button>
            <button
              className={`smd-st2-pill smd-st2-pill-d ${latestBucket === 'disqualified' ? 'active' : ''}`}
              onClick={() => openPicker('disqualified')}
            >
              Disqualified
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                  <path d="M3 3h18v4H3zM3 11h18v4H3zM3 19h18v2H3z"/>
                </svg>
              </div>
              <div>
                <div className="smd-st2-activity-title">
                  Activity Report <span className="smd-st2-activity-count">{acks.length}</span>
                </div>
                <div className="smd-st2-activity-sub">Latest entry decides whether this lead can advance to Stage 3</div>
              </div>
            </div>
          </div>

          <div className="smd-st2-table-wrap">
            <table className="smd-st2-table">
              <colgroup>
                <col />
                <col />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Sr No</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Reason</th>
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
                      <td>{formatDmy(row.created_at)}</td>
                      <td>
                        <span className={`smd-st2-row-pill ${BUCKET_META[bucket].pill}`}>
                          {BUCKET_META[bucket].label}
                        </span>
                      </td>
                      <td className="smd-st2-row-reason-td">
                        <Tooltip label={row.reason_snapshot ?? ''} themed maxWidth={480}>
                          <div className="smd-st2-row-reason">
                            {(() => { const rs = row.reason_snapshot ?? ''; return rs.length > 30 ? `${rs.slice(0, 30)}…` : (rs || '—'); })()}
                          </div>
                        </Tooltip>
                      </td>
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
            disabled={advancing}
            title={latestBucket !== 'qualified' ? 'Latest acknowledgement must be Qualified Lead to advance — click for details' : undefined}
          >
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>

      {/* ── Reason picker modal ── */}
      {pickerBucket && createPortal((
        <div className="st2-pick-backdrop">
          <div className="st2-pick-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`st2-pick-head ${BUCKET_META[pickerBucket].pill}`}>
              <div className="st2-pick-head-left">
                <div className="st2-pick-head-icon"><BucketIcon bucket={pickerBucket} /></div>
                <div className="st2-pick-title">
                  {pickerBucket === 'disqualified' ? 'Disqualified Status' : BUCKET_META[pickerBucket].label}
                  <span className="st2-pick-sub">Select reason(s) to log in the activity report</span>
                </div>
              </div>
              <button className="st2-pick-close" onClick={closePicker} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="st2-pick-body">
              {mastersLoading && (
                <div className="smd-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <span key={`pk-sk-${i}`} className="smd-skel" style={{ height: 36, borderRadius: 9 }} />
                  ))}
                </div>
              )}
              {!mastersLoading && pickerOptions.length === 0 && (
                <div className="st2-pick-empty">
                  {canAddReason
                    ? <>No active reasons configured for this status yet. Use <strong>+ Add New Reason</strong> below to create one.</>
                    : <>No active reasons configured for this bucket. Add some in <strong>Master → Lead Acknowledgement</strong>.</>}
                </div>
              )}

              {pickerBucket === 'disqualified' && pickerOptions.length > 0 ? (
                <div className="st2-pick-cols">
                  <div className="st2-pick-col">
                    <div className="st2-pick-col-head st2-pick-col-head-neg">
                      ● Negative Status
                    </div>
                    {dqNegative.length === 0
                      ? <div className="st2-pick-col-empty">No options</div>
                      : dqNegative.map(r => (
                        <ReasonRow key={r.id} reason={r} checked={selected.has(r.id)} onToggle={() => toggleSelect(r.id)} />
                      ))}
                  </div>
                  <div className="st2-pick-col">
                    <div className="st2-pick-col-head st2-pick-col-head-pos">
                      ● Positive Status
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

            <div className={`st2-pick-foot ${BUCKET_META[pickerBucket].pill}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="st2-pick-count">{selected.size} selected</span>
                {canAddReason && (
                  <button type="button" className="st2-pick-addlink" onClick={() => openAddReason(pickerBucket)}>+ Add New Reason</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="st2-pick-btn st2-pick-btn-ghost" onClick={closePicker}>Cancel</button>
                <button
                  className="st2-pick-btn st2-pick-btn-primary"
                  onClick={() => void submitPicker()}
                  disabled={selected.size === 0}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ── Add New Reason ── */}
      <LeadAckReasonModal
        open={addOpen}
        presetType={addPreset}
        onClose={() => setAddOpen(false)}
        onSaved={(row) => onReasonAdded(row)}
      />
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

function BucketIcon({ bucket }: { bucket: Bucket }) {
  if (bucket === 'qualified')
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
      </svg>
    );
  if (bucket === 'clarity_pending')
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="12" cy="12" r="10" /><polyline points="12 7 12 12 15.5 14" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

const STAGE2_CSS = `
/* ── Status card ── */
.smd-st2-status-block {
  background: #fff;
  border: 1.5px solid #ddd6fe;
  border-top: 3px solid #7c3aed;
  border-radius: 14px;
  padding: 13px 18px;
  margin-bottom: 12px;
}
.smd-st2-status-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-bottom: 9px; flex-wrap: wrap;
}
.smd-st2-check {
  width: 17px; height: 17px; border-radius: 5px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(124,58,237,.30);
}
.smd-st2-check svg { width: 8px; height: 8px; }
.smd-st2-status-title {
  font-size: 9px; font-weight: 800; letter-spacing: .12em;
  color: #5b21b6; text-transform: uppercase;
  flex: 1;
}
.smd-st2-status-current {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px;
  font-size: 9px; font-weight: 700;
  border: 1px solid;
}
.smd-st2-status-hint {
  margin-top: 8px; font-size: 10px; color: #94a3b8;
  line-height: 1.5;
}

.smd-st2-pills { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.smd-st2-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 14px; border-radius: 20px;
  border: 1.5px solid;
  background: #fff;
  font-family: inherit;
  font-size: 10.5px; font-weight: 600;
  cursor: pointer;
  transition: all .18s;
  white-space: nowrap;
}
.smd-st2-pill:hover { transform: translateY(-1px); }

.smd-st2-pill-q { color: #9b8ec4; border-color: #ede9fe; background: #faf5ff; }
.smd-st2-pill-c { color: #92400e; border-color: #fde68a; background: #fffdf5; }
.smd-st2-pill-d { color: #be123c; border-color: #fecdd3; background: #fff5f6; }

.smd-st2-pill.active {
  border-color: transparent;
  color: #fff;
  font-weight: 700;
}
.smd-st2-pill-q.active {
  background: linear-gradient(115deg, #7c3aed, #8b5cf6, #a78bfa, #c4b5fd);
  box-shadow: 0 4px 12px rgba(124,58,237,.32), 0 0 0 3px #c4b5fd;
}
.smd-st2-pill-c.active {
  background: linear-gradient(115deg, #f59e0b, #d97706, #fbbf24, #fde68a);
  box-shadow: 0 4px 12px rgba(245,158,11,.28), 0 0 0 3px #fde68a;
}
.smd-st2-pill-d.active {
  background: linear-gradient(115deg, #f43f5e, #e11d48, #fb7185, #fda4af);
  box-shadow: 0 4px 12px rgba(244,63,94,.28), 0 0 0 3px #fca5a5;
}
.smd-st2-pill.active::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%;
  background: currentColor; flex-shrink: 0;
}

.smd-st2-status-current.smd-st2-pill-q { background: linear-gradient(115deg, #6d28d9, #7c3aed, #8b5cf6); border-color: transparent; color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.35); }
.smd-st2-status-current.smd-st2-pill-c { background: linear-gradient(115deg, #b45309, #d97706, #f59e0b); border-color: transparent; color: #fff; box-shadow: 0 2px 8px rgba(245,158,11,.32); }
.smd-st2-status-current.smd-st2-pill-d { background: linear-gradient(115deg, #be123c, #e11d48, #f43f5e); border-color: transparent; color: #fff; box-shadow: 0 2px 8px rgba(244,63,94,.32); }
.smd-st2-status-current::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: currentColor; flex-shrink: 0;
  box-shadow: 0 0 5px currentColor;
}

.smd-stg-head-badge.st2-badge-qualified       { background: linear-gradient(135deg, #10b981, #047857); color: #fff; border: none; box-shadow: 0 2px 8px rgba(16,185,129,.35); }
.smd-stg-head-badge.st2-badge-disqualified    { background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff; border: none; box-shadow: 0 2px 8px rgba(244,63,94,.35); }
.smd-stg-head-badge.st2-badge-clarity_pending { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border: none; box-shadow: 0 2px 8px rgba(245,158,11,.35); }
/* The label carries its own ●, so hide the shared ::before dot. */
.smd-stg-head-badge::before { display: none; }

/* ── Activity Report ── */
.smd-st2-activity {
  background: #fff;
  border: 1.5px solid #ddd6fe;
  border-top: 3px solid #7c3aed;
  border-radius: 14px;
  overflow: hidden;
}
.smd-st2-activity-head {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 18px;
  background: linear-gradient(180deg, #faf5ff, #f5f3ff);
  border-bottom: 1.5px solid #ede9fe;
  gap: 12px; flex-wrap: wrap;
}
.smd-st2-activity-head::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 4px; background: linear-gradient(180deg, #7c3aed, #6d28d9);
}
.smd-st2-activity-head-left { display: flex; align-items: center; gap: 10px; }
.smd-st2-activity-icon {
  width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.smd-st2-activity-title {
  font-size: 13.5px; font-weight: 800; color: #3b0764;
  display: flex; align-items: center; gap: 8px;
}
.smd-st2-activity-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.smd-st2-activity-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
}

.smd-st2-table-wrap {
  max-height: 220px; overflow-y: auto; overflow-x: auto;
  background: #fff;
  border-top: 1px solid #ede9fe;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.smd-st2-table-wrap::-webkit-scrollbar { width: 9px; height: 9px; }
.smd-st2-table-wrap::-webkit-scrollbar-track { background: transparent; }
.smd-st2-table-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.smd-st2-table-wrap::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.smd-st2-table {
  width: 100%; border-collapse: collapse;
  table-layout: fixed;
}
.smd-st2-table colgroup col:nth-child(1) { width: 62px; }
.smd-st2-table colgroup col:nth-child(2) { width: 118px; }
.smd-st2-table colgroup col:nth-child(3) { width: 150px; }
.smd-st2-table thead th {
  position: sticky; top: 0; z-index: 1;
  padding: 11px 14px; text-align: left;
  font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #fff;
  text-transform: uppercase; white-space: nowrap;
  background: linear-gradient(180deg, #7c3aed, #6d28d9);
  border-bottom: 1.5px solid #6d28d9;
}
.smd-st2-table tbody td {
  padding: 8px 10px;
  font-size: 11px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
  white-space: nowrap;
}
.smd-st2-table tbody td:first-child { padding-left: 14px; }
.smd-st2-table tbody tr { background: #fff; transition: background .12s; }
.smd-st2-table tbody tr:hover { background: #faf5ff; }

.smd-st2-row-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 7px;
  background: #ede9fe; color: #6d28d9;
  font-size: 10px; font-weight: 800;
}
.smd-st2-row-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800;
  border: none;
  white-space: nowrap;
}
.smd-st2-row-pill::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: currentColor; flex-shrink: 0;
}
.smd-st2-row-pill.smd-st2-pill-q { color: #047857; background: #d1fae5; }
.smd-st2-row-pill.smd-st2-pill-c { color: #b45309; background: #fef3c7; }
.smd-st2-row-pill.smd-st2-pill-d { color: #dc2626; background: #fee2e2; }

.smd-st2-row-reason {
  font-size: 11px; font-weight: 500; color: #1e293b;
  white-space: nowrap;
}
.smd-st2-empty {
  text-align: center; padding: 26px 14px;
  color: #94a3b8; font-style: italic;
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
  background: #fff; border-radius: 18px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  animation: st2-pop .18s ease-out;
}
@keyframes st2-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.st2-pick-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; color: #fff;
  position: relative;
}
.st2-pick-head.smd-st2-pill-q { background: linear-gradient(115deg, #7c3aed, #8b5cf6, #a78bfa, #c4b5fd); }
.st2-pick-head.smd-st2-pill-c { background: linear-gradient(115deg, #f59e0b, #d97706, #fbbf24, #fde68a); }
.st2-pick-head.smd-st2-pill-d { background: linear-gradient(115deg, #f43f5e, #e11d48, #fb7185, #fda4af); }
.st2-pick-head-left { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.st2-pick-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,.20);
  border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
  color: #fff; flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0,0,0,.12);
}
.st2-pick-title { font-size: 15px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.st2-pick-sub   { display: block; font-size: 11px; color: rgba(255,255,255,.85); margin-top: 3px; font-weight: 500; }
.st2-pick-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.20); color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.st2-pick-close:hover { background: rgba(255,255,255,.32); }

.st2-pick-body {
  padding: 14px 18px; overflow-y: auto; background: #f8fafc;
  height: min(280px, 44vh);
  scrollbar-width: thin; scrollbar-color: #ddd6fe transparent;
}
.st2-pick-body::-webkit-scrollbar { width: 8px; }
.st2-pick-body::-webkit-scrollbar-track { background: transparent; }
.st2-pick-body::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.st2-pick-body::-webkit-scrollbar-thumb:hover { background: #c4b5fd; background-clip: content-box; }
.st2-pick-empty { text-align: center; color: #94a3b8; font-style: italic; padding: 28px 12px; font-size: 12.5px; }

.st2-pick-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 8px; cursor: pointer;
  font-size: 12.5px; color: #1e293b;
  background: #fff; border: 1.5px solid #cbd5e1;
  margin-bottom: 6px; transition: all .12s;
}
.st2-pick-row:hover { border-color: #c4b5fd; background: #faf5ff; }
.st2-pick-row.on { border-color: #7c3aed; background: #ede9fe; }
.st2-pick-row input { accent-color: #7c3aed; cursor: pointer; }

.st2-pick-cols { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 0; }
.st2-pick-cols .st2-pick-col { min-width: 0; }
.st2-pick-cols .st2-pick-col:first-child { padding-right: 18px; border-right: 1.5px solid #cabffb; }
.st2-pick-cols .st2-pick-col:last-child  { padding-left: 18px; }
.st2-pick-row > span { min-width: 0; overflow-wrap: anywhere; }
.st2-pick-col-head {
  font-size: 11px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase;
  padding: 0 2px 8px; margin-bottom: 10px;
  border-bottom: 1.5px solid transparent;
}
.st2-pick-col-head-neg { color: #e11d48; border-bottom-color: #fecdd3; }
.st2-pick-col-head-pos { color: #16a34a; border-bottom-color: #bbf7d0; }
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
  padding: 10px 28px; border-radius: 11px; border: 1.5px solid transparent;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: all .18s ease;
}
.st2-pick-btn:disabled { opacity: .55; cursor: not-allowed; }
.st2-pick-btn-ghost { background: #fff; border-color: #e2e8f0; color: #475569; }
.st2-pick-btn-ghost:hover:not(:disabled) {
  background: #f1f5f9; border-color: #c4b5fd; color: #5b21b6;
  transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.12);
}
.st2-pick-btn-primary { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; box-shadow: 0 3px 10px rgba(124,58,237,.35); }
.st2-pick-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  transform: translateY(-1px); box-shadow: 0 8px 20px rgba(124,58,237,.50);
}
.st2-pick-btn-primary:active:not(:disabled),
.st2-pick-btn-ghost:active:not(:disabled) { transform: translateY(0); }
.st2-pick-foot.smd-st2-pill-c .st2-pick-btn-primary { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 3px 10px rgba(245,158,11,.35); }
.st2-pick-foot.smd-st2-pill-d .st2-pick-btn-primary { background: linear-gradient(135deg, #f43f5e, #e11d48); box-shadow: 0 3px 10px rgba(244,63,94,.35); }

/* ── Add New Reason ── */
.smd-st2-add-reason {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px; border-radius: 20px; cursor: pointer;
  font-family: inherit; font-size: 9.5px; font-weight: 700;
  color: #6d28d9; background: #f5f3ff; border: 1.5px dashed #a78bfa;
  transition: all .18s; white-space: nowrap;
}
.smd-st2-add-reason:hover {
  background: #ede9fe; border-style: solid; color: #5b21b6;
  transform: translateY(-1px); box-shadow: 0 3px 10px rgba(124,58,237,.18);
}
.st2-pick-addlink {
  border: none; background: none; padding: 0; cursor: pointer;
  font-family: inherit; font-size: 11.5px; font-weight: 700; color: #7c3aed;
}
.st2-pick-addlink:hover { text-decoration: underline; color: #5b21b6; }
/* ── Dark mode ─────────────────────────────────────────────── */
[data-bs-theme="dark"] .smd-st2-add-reason { background: rgba(124,58,237,.16); border-color: rgba(167,139,250,.55); color: #c4b5fd; }
[data-bs-theme="dark"] .smd-st2-add-reason:hover { background: rgba(124,58,237,.30); color: #ede9fe; }
[data-bs-theme="dark"] .st2-pick-addlink { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-st2-status-block {
  background: #14102a;
  border-color: rgba(167,139,250,.30);
  border-top-color: #7c3aed;
}
[data-bs-theme="dark"] .smd-st2-activity {
  background: #14102a;
  border-color: rgba(167,139,250,.30);
  border-top-color: #7c3aed;
}
[data-bs-theme="dark"] .smd-st2-status-title  { color: #c4b5fd; }
[data-bs-theme="dark"] .smd-st2-status-hint   { color: #a78bfa; opacity: .80; }

[data-bs-theme="dark"] .smd-st2-pill-q { background: rgba(124,58,237,.14); border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .smd-st2-pill-c { background: rgba(245,158,11,.12); border-color: rgba(252,211,77,.35); color: #fbbf24; }
[data-bs-theme="dark"] .smd-st2-pill-d { background: rgba(244,63,94,.12); border-color: rgba(252,165,165,.35); color: #fda4af; }

[data-bs-theme="dark"] .smd-st2-status-current.smd-st2-pill-q { background: linear-gradient(115deg, #6d28d9, #7c3aed, #8b5cf6); border-color: transparent; color: #fff; }
[data-bs-theme="dark"] .smd-st2-status-current.smd-st2-pill-c { background: linear-gradient(115deg, #b45309, #d97706, #f59e0b); border-color: transparent; color: #fff; }
[data-bs-theme="dark"] .smd-st2-status-current.smd-st2-pill-d { background: linear-gradient(115deg, #be123c, #e11d48, #f43f5e); border-color: transparent; color: #fff; }

[data-bs-theme="dark"] .smd-st2-activity-head {
  background: rgba(124,58,237,.10);
  border-bottom-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .smd-st2-activity-title { color: #ede9fe; }
[data-bs-theme="dark"] .smd-st2-activity-sub   { color: rgba(196,181,253,.55); }

[data-bs-theme="dark"] .smd-st2-table-wrap {
  background: #14102a;
  border-top-color: rgba(167,139,250,.20);
  scrollbar-color: rgba(148,163,184,.45) transparent;
}
[data-bs-theme="dark"] .smd-st2-table-wrap::-webkit-scrollbar-thumb { background: rgba(148,163,184,.45); }
[data-bs-theme="dark"] .smd-st2-table-wrap::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.65); }
[data-bs-theme="dark"] .smd-st2-table thead th {
  background: linear-gradient(180deg, #7c3aed, #6d28d9);
  color: #fff;
  border-bottom-color: #6d28d9;
}
[data-bs-theme="dark"] .smd-st2-table tbody tr   { background: #14102a; }
[data-bs-theme="dark"] .smd-st2-table tbody tr:hover { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .smd-st2-table tbody td   { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .smd-st2-row-reason       { color: #ede9fe; }
[data-bs-theme="dark"] .smd-st2-row-num {
  background: rgba(124,58,237,.22);
  color: #c4b5fd;
}

[data-bs-theme="dark"] .smd-st2-row-pill.smd-st2-pill-q { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .smd-st2-row-pill.smd-st2-pill-c { background: rgba(245,158,11,.18); color: #fde68a; }
[data-bs-theme="dark"] .smd-st2-row-pill.smd-st2-pill-d { background: rgba(239,68,68,.18);  color: #fca5a5; }

[data-bs-theme="dark"] .smd-st2-empty { color: rgba(196,181,253,.55); }

/* ── Reason picker modal dark mode ── */
[data-bs-theme="dark"] .st2-pick-modal {
  background: #14102a;
  box-shadow:
    0 18px 48px rgba(0,0,0,.60),
    0 4px 18px rgba(124,58,237,.20);
}
[data-bs-theme="dark"] .st2-pick-body         { background: #15102e; scrollbar-color: rgba(167,139,250,.45) transparent; }
[data-bs-theme="dark"] .st2-pick-body::-webkit-scrollbar-thumb       { background: rgba(167,139,250,.45); }
[data-bs-theme="dark"] .st2-pick-body::-webkit-scrollbar-thumb:hover { background: rgba(167,139,250,.65); }
[data-bs-theme="dark"] .st2-pick-empty        { color: rgba(167,139,250,.55); }
[data-bs-theme="dark"] .st2-pick-row {
  background: #271f54; border-color: rgba(167,139,250,.38);
  color: #f1ecff;
}
[data-bs-theme="dark"] .st2-pick-row:hover   { background: #322665; border-color: rgba(167,139,250,.60); }
[data-bs-theme="dark"] .st2-pick-row.on      { background: rgba(124,58,237,.45); border-color: #c4b5fd; color: #fff; }
[data-bs-theme="dark"] .st2-pick-row input   { accent-color: #a78bfa; }
[data-bs-theme="dark"] .st2-pick-foot {
  background: #14102a;
  border-top: 1px solid rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .st2-pick-count       { color: #a78bfa; }
[data-bs-theme="dark"] .st2-pick-btn-ghost   {
  background: #1f1845; border-color: rgba(167,139,250,.30); color: #d8b4fe;
}
[data-bs-theme="dark"] .st2-pick-btn-ghost:hover:not(:disabled) {
  background: #2a2150; border-color: rgba(167,139,250,.55);
}
[data-bs-theme="dark"] .st2-pick-col-head-neg { color: #fca5a5; border-bottom-color: rgba(239,68,68,.35); }
[data-bs-theme="dark"] .st2-pick-col-head-pos { color: #86efac; border-bottom-color: rgba(34,197,94,.35); }
[data-bs-theme="dark"] .st2-pick-col-empty    { color: rgba(167,139,250,.40); }
[data-bs-theme="dark"] .st2-pick-cols .st2-pick-col:first-child { border-right-color: rgba(167,139,250,.28); }

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 640px) {
  .st2-pick-cols { grid-template-columns: 1fr; }
  .smd-st2-status-head { flex-direction: column; align-items: flex-start; }
  .smd-st2-pills { flex-direction: column; align-items: stretch; }
  .smd-st2-pill { text-align: center; }
}
`;
