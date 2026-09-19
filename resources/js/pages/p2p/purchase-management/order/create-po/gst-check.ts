// The supplier's GST position, worked out from the draft. Step 01 shows it as
// a banner; Step 03's footer offers the matching action next to "Submit PO",
// because that is the moment the check actually gates the order.
// The rules themselves (window, ages, verdict) live in supplier-checks.tsx,
// which the Payment Request page shares — this file only applies them to a PO.
import type { PoDraft } from './po-draft';
import type { GstNotice } from './GstNoticeModal';
import { supplierByOption } from './sample-suppliers';
import { GST_STALE_MONTHS, cutoffDate, gstState, monthsAgo } from './supplier-checks';

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
