// The supplier's GST position, worked out from the draft. Step 01 shows it as
// a banner; Step 03's footer offers the matching action next to "Submit PO",
// because that is the moment the check actually gates the order.
import type { PoDraft } from './po-draft';
import type { GstNotice } from './GstNoticeModal';
import { supplierByOption } from './sample-suppliers';

// A scrutiny or filing date older than this is treated as out of date.
export const GST_STALE_MONTHS = 3;

export type GstState = { tone: 'idle' | 'ok' | 'stop' | 'warn'; title: string; note: string; action?: string };

/** Months between a date and today, to one decimal (7.2), as the banner shows
 *  it. An average month of 30.44 days keeps it in step with the prototype. */
export function monthsAgo(iso: string): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round(((Date.now() - then.getTime()) / (86400000 * 30.44)) * 10) / 10);
}

/** Stale scrutiny blocks the PO; a stale return only needs senior approval. */
export function gstState(supplier: string, scrutinyAge: number | null, filingAge: number | null): GstState {
  if (!supplier) {
    return { tone: 'idle', title: 'Select a supplier to run the GST compliance check', note: `Scrutiny and filing dates are checked against a ${GST_STALE_MONTHS}-month window.` };
  }
  if (scrutinyAge === null || scrutinyAge >= GST_STALE_MONTHS) {
    return { tone: 'stop', title: 'GST scrutiny required', note: `Scrutiny is older than ${GST_STALE_MONTHS} months. Refresh it on the supplier record before this PO can move forward.`, action: 'Review requirement' };
  }
  if (filingAge === null || filingAge >= GST_STALE_MONTHS) {
    return { tone: 'warn', title: 'Senior approval required', note: `Scrutiny is current, but the last GST return is older than ${GST_STALE_MONTHS} months. A senior must approve this PO.`, action: 'Send for senior approval' };
  }
  return { tone: 'ok', title: 'GST compliance cleared', note: `Scrutiny and filing are both inside the ${GST_STALE_MONTHS}-month window. This PO can proceed.` };
}

/** The oldest date a scrutiny or return may carry and still be accepted. */
function cutoffDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - GST_STALE_MONTHS);
  return d.toISOString().slice(0, 10);
}

/** Everything the banner and the Step 03 action need, from the draft alone. */
export function gstCheck(draft: PoDraft) {
  const scrutinyAge = monthsAgo(draft.scrutinyDate);
  const filingAge = monthsAgo(draft.filingDate);
  const state = gstState(draft.supplier, scrutinyAge, filingAge);

  // The popup behind the action — null when the PO needs no GST action.
  const notice: GstNotice | null = state.tone === 'stop' || state.tone === 'warn'
    ? (() => {
      const s = supplierByOption(draft.supplier);
      return {
        tone: state.tone,
        supplier: s?.key ?? '—',
        code: s?.code ?? '—',
        scrutiny: draft.scrutinyDate,
        filing: draft.filingDate,
        scrutinyAge,
        filingAge,
        cutoff: cutoffDate(),
        months: GST_STALE_MONTHS,
      };
    })()
    : null;

  return { state, scrutinyAge, filingAge, notice };
}
