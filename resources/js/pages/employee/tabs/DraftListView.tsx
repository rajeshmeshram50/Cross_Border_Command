// Saved expense / advance drafts list — the "Drafts" sub-view inside the
// Expense tab. Drafts live in localStorage on the device only; each card
// offers Resume / Discard. Extracted from EmployeeProfile.tsx.
import type { ReactNode } from 'react';

// Expense titles are free text — a long, unbroken one overflows the draft
// card (QA #121). Clip it for display; the full title stays in the tooltip.
const clipTitle = (t: string): string => (t.length > 40 ? t.slice(0, 40) + '…' : t);

const fmtSavedAt = (iso: string | null): string => {
  if (!iso) return 'Saved earlier';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Saved earlier';
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1)   return 'Saved just now';
  if (min < 60)  return `Saved ${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24)  return `Saved ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `Saved ${days}d ago`;
  return `Saved ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
};

export default function DraftListView({
  module,
  expenseEntries,
  advanceEntries,
  claimCategories,
  onResume,
  onDiscard,
}: {
  module: 'expense' | 'advance';
  expenseEntries: any[];
  advanceEntries: any[];
  claimCategories: any[];
  onResume: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}) {
  const isAdvance = module === 'advance';
  const entries = isAdvance ? advanceEntries : expenseEntries;
  if (entries.length === 0) {
    return (
      <div className="border rounded p-4 text-center dlv-card-bg">
        <i className="ri-draft-line dlv-empty-icon" />
        <div className="fw-semibold ep-fs-13">No saved drafts</div>
        <small className="text-muted ep-fs-115">
          Saved drafts appear here so you can finish them later — they're stored locally on this device only.
        </small>
      </div>
    );
  }
  const cards: ReactNode[] = [];
  if (isAdvance) {
    // One card per saved advance draft. Each card carries its own
    // Resume / Discard, keyed by the entry's id so multiple parked
    // drafts can be edited/dropped independently.
    advanceEntries.forEach(entry => {
      const d = entry.data || {};
      cards.push(
        <div key={entry.id} className="border rounded p-3 mb-2 dlv-card-bg">
          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-start gap-2 min-w-0 dlv-flex-280">
              <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0 dlv-icon-advance">
                <i className="ri-money-dollar-circle-line" />
              </span>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <strong className="ep-fs-13">
                    {d.advType || 'Advance Request'}{d.advTypeOther ? ` · ${d.advTypeOther}` : ''}
                  </strong>
                  <span className="badge rounded-pill dlv-badge-draft">
                    DRAFT
                  </span>
                </div>
                <div className="text-muted mt-1 ep-fs-115">
                  {d.advAmount ? <>₹{Number(String(d.advAmount).replace(/[^\d.]/g, '') || 0).toLocaleString('en-IN')}</> : '—'}
                  {d.advRequestedDate && <> · Requested {d.advRequestedDate}</>}
                  {d.advRecoveryStart && <> · Recovery {d.advRecoveryStart}</>}
                  {d.advRecoveryMode && <> · {d.advRecoveryMode.toUpperCase()}</>}
                </div>
                {d.advReason && (
                  <div className="text-muted mt-1 dlv-reason" title={d.advReason}>
                    <i className="ri-double-quotes-l me-1" />
                    {String(d.advReason).length > 100 ? String(d.advReason).slice(0, 100) + '…' : d.advReason}
                  </div>
                )}
                <small className="text-muted d-inline-flex align-items-center gap-1 mt-1 ep-fs-105">
                  <i className="ri-time-line" /> {fmtSavedAt(entry.savedAt)}
                </small>
              </div>
            </div>
            <div className="d-flex gap-2 flex-shrink-0">
              <button type="button" className="btn btn-sm dlv-btn-resume" onClick={() => onResume(entry.id)}>
                <i className="ri-arrow-go-forward-line me-1" /> Resume
              </button>
              <button type="button" className="btn btn-sm btn-outline-danger dlv-btn-discard" onClick={() => onDiscard(entry.id)}>
                <i className="ri-delete-bin-line me-1" /> Discard
              </button>
            </div>
          </div>
        </div>
      );
    });
  } else {
    // One card per saved expense draft entry. Each entry can hold one or
    // more line items (the "Save & Add Another" stack inside the modal).
    // Every line item is rendered as its own row so a multi-claim draft
    // shows ALL its claims separately — previously only the first claim
    // was shown, so a 2-claim draft looked like it had lost one.
    expenseEntries.forEach(entry => {
      const lines: any[] = Array.isArray(entry.drafts) ? entry.drafts : [];
      if (lines.length === 0) return;
      const lineCount = lines.length;
      cards.push(
        <div key={entry.id} className="border rounded p-3 mb-2 dlv-card-bg">
          <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
            <div className="d-flex align-items-start gap-2 min-w-0 dlv-flex-280 flex-grow-1">
              <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0 dlv-icon-expense">
                <i className="ri-file-list-3-line" />
              </span>
              <div className="min-w-0 flex-grow-1">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <strong className="ep-fs-13 text-truncate dlv-flex-280" title={lineCount > 1 ? undefined : (lines[0].title || 'Untitled claim')}>
                    {lineCount > 1 ? `Expense Draft · ${lineCount} claims` : clipTitle(lines[0].title || 'Untitled claim')}
                  </strong>
                  <span className="badge rounded-pill dlv-badge-draft">DRAFT</span>
                </div>
                {/* One row per claim so both/all claims are visible separately. */}
                <div className="d-flex flex-column gap-2 mt-2">
                  {lines.map((ln, i) => {
                    const catName = (() => {
                      const found = claimCategories.find(c => String(c.id) === String(ln.category));
                      return found?.name || (ln.category ? `Cat #${ln.category}` : '');
                    })();
                    return (
                      <div key={i} className="border rounded p-2" style={{ background: 'rgba(0,0,0,0.02)' }}>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          {lineCount > 1 && (
                            <span className="badge rounded-pill text-bg-light border">Claim {i + 1}</span>
                          )}
                          <strong className="ep-fs-115 text-truncate dlv-flex-280" title={ln.title || 'Untitled claim'}>{clipTitle(ln.title || 'Untitled claim')}</strong>
                        </div>
                        <div className="text-muted mt-1 ep-fs-115">
                          {ln.amount ? <>₹{Number(String(ln.amount).replace(/[^\d.]/g, '') || 0).toLocaleString('en-IN')}</> : '—'}
                          {catName && <> · {catName}</>}
                          {ln.date && <> · {ln.date}</>}
                          {ln.vendor && <> · {ln.vendor}</>}
                        </div>
                        {ln.purpose && (
                          <div className="text-muted mt-1 dlv-reason" title={ln.purpose}>
                            <i className="ri-double-quotes-l me-1" />
                            {String(ln.purpose).length > 100 ? String(ln.purpose).slice(0, 100) + '…' : ln.purpose}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <small className="text-muted d-inline-flex align-items-center gap-1 mt-2 ep-fs-105">
                  <i className="ri-time-line" /> {fmtSavedAt(entry.savedAt)}
                </small>
              </div>
            </div>
            <div className="d-flex gap-2 flex-shrink-0">
              <button type="button" className="btn btn-sm dlv-btn-resume" onClick={() => onResume(entry.id)}>
                <i className="ri-arrow-go-forward-line me-1" /> Resume
              </button>
              <button type="button" className="btn btn-sm btn-outline-danger dlv-btn-discard" onClick={() => onDiscard(entry.id)}>
                <i className="ri-delete-bin-line me-1" /> Discard
              </button>
            </div>
          </div>
        </div>
      );
    });
  }
  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-2 px-1">
        <i className="ri-information-line dlv-info-icon" />
        <small className="text-muted ep-fs-115">
          Drafts are stored on this device only and aren't visible to managers/HR until you submit.
        </small>
      </div>
      {cards}
    </div>
  );
}
