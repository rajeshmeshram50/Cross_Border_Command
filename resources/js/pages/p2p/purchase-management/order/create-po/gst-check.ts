// The supplier's GST position, worked out from the draft. Step 01 shows it as
// a banner; Step 03's footer offers the matching action next to "Submit PO",
// because that is the moment the check actually gates the order.
// The rules themselves (window, ages, verdict) live in supplier-checks.tsx,
// which the Payment Request page shares — this file only applies them to a PO.
// The server re-runs the same check on submit, so this is guidance, not the gate.
import type { PoDraft } from './po-draft';
import type { GstNotice } from './GstNoticeModal';
import { GST_STALE_MONTHS, cutoffDate, gstState, monthsAgo } from './supplier-checks';

/** Everything the banner and the Step 03 action need, from the draft alone. */
export function gstCheck(draft: PoDraft) {
  const sup = draft.supplier;
  const scrutiny = sup?.scrutiny ?? '';
  const filing = sup?.filing ?? '';
  const scrutinyAge = monthsAgo(scrutiny);
  const filingAge = monthsAgo(filing);
  const state = gstState(sup ? sup.code : '', scrutiny, filing);

  // The popup behind the action — null when the PO needs no GST action.
  const notice: GstNotice | null = sup && (state.tone === 'stop' || state.tone === 'warn')
    ? {
      tone: state.tone,
      supplier: sup.name,
      code: sup.code,
      scrutiny,
      filing,
      scrutinyAge,
      filingAge,
      cutoff: cutoffDate(),
      months: GST_STALE_MONTHS,
    }
    : null;

  return { state, scrutinyAge, filingAge, notice };
}
