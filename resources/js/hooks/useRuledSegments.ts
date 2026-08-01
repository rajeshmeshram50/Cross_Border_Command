import { useEffect, useState } from 'react';
import api from '../api';

export type SegDocType = 'domestic' | 'international';

export function useRuledSegments(enabled: boolean) {
  const [ruledIds, setRuledIds] = useState<Set<string>>(new Set());
  const [ruledCodes, setRuledCodes] = useState<Set<string>>(new Set());
  const [typesByCode, setTypesByCode] = useState<Map<string, Set<SegDocType>>>(new Map());
  const [typesById, setTypesById] = useState<Map<string, Set<SegDocType>>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.get('/clm/segment-rules')
      .then(r => {
        if (cancelled) return;
        const rows: Array<{ segment_id?: number | string | null; segment_code?: string | null; document_type?: string | null }> =
          Array.isArray(r.data?.data) ? r.data.data : [];
        const byCode = new Map<string, Set<SegDocType>>();
        const byId = new Map<string, Set<SegDocType>>();
        const add = (map: Map<string, Set<SegDocType>>, key: string, dt?: string | null) => {
          if (!key || (dt !== 'domestic' && dt !== 'international')) return;
          (map.get(key) ?? map.set(key, new Set<SegDocType>()).get(key)!).add(dt);
        };
        for (const x of rows) {
          add(byCode, String(x.segment_code ?? ''), x.document_type);
          add(byId, String(x.segment_id ?? ''), x.document_type);
        }
        setRuledIds(new Set(rows.map(x => String(x.segment_id ?? '')).filter(Boolean)));
        setRuledCodes(new Set(rows.map(x => String(x.segment_code ?? '')).filter(Boolean)));
        setTypesByCode(byCode);
        setTypesById(byId);
        setLoaded(true);
      })
      // On failure leave `loaded` false so the fields stay fully selectable —
      // a dead lookup must not block onboarding.
      .catch(() => { if (!cancelled) setLoaded(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return { ruledIds, ruledCodes, typesByCode, typesById, loaded };
}
