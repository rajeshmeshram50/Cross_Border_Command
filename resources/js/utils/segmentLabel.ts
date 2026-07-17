/* Segment labels can be arbitrarily long (free-text segment names). When shown
 * as a chip / dropdown row they must not blow out the layout, so cap the
 * VISIBLE text at 30 characters with an ellipsis and surface the full value on
 * hover. Always pair the returned string with `title={fullName}` (or a Tooltip)
 * so nothing is lost — the truncation is presentational only. */
export const SEGMENT_LABEL_MAX = 30;

export function truncSegment(name: string | null | undefined): string {
  const s = String(name ?? '');
  return s.length > SEGMENT_LABEL_MAX ? s.slice(0, SEGMENT_LABEL_MAX).trimEnd() + '…' : s;
}
