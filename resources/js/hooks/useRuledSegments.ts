import { useEffect, useState } from 'react';
import api from '../api';

/**
 * Segments that have a rule defined in the Document Control Panel.
 *
 * A segment with no DCP rule maps to no KYC / DD / Trade-License documents, so
 * tagging a customer / consignee / supplier with it produces an empty Stage 2
 * and nothing to comply with. The onboarding forms therefore still SHOW such a
 * segment in the dropdown (so the user can see it exists) but disable it —
 * see MasterMultiSelect's `disabledValues`.
 *
 * Both keys are returned because the forms differ: the Customer segment field
 * stores segment NAMES and labels by code, while the Supplier field stores
 * segment IDs.
 *
 * `loaded` guards the disable: until the rules land, nothing is disabled —
 * otherwise every option would flash as unusable on open.
 *
 * @param enabled fetch only while the modal is open.
 */
export function useRuledSegments(enabled: boolean) {
  const [ruledIds, setRuledIds] = useState<Set<string>>(new Set());
  const [ruledCodes, setRuledCodes] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.get('/clm/segment-rules')
      .then(r => {
        if (cancelled) return;
        const rows: Array<{ segment_id?: number | string | null; segment_code?: string | null }> =
          Array.isArray(r.data?.data) ? r.data.data : [];
        setRuledIds(new Set(rows.map(x => String(x.segment_id ?? '')).filter(Boolean)));
        setRuledCodes(new Set(rows.map(x => String(x.segment_code ?? '')).filter(Boolean)));
        setLoaded(true);
      })
      // On failure leave `loaded` false so the fields stay fully selectable —
      // a dead lookup must not block onboarding.
      .catch(() => { if (!cancelled) setLoaded(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return { ruledIds, ruledCodes, loaded };
}
