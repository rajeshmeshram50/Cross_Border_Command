import type { ImportType, TypedImportError, TypedImportPreview } from '../cvApi';

/* Import by category: the server's preview of one category's sheet, split for the review popup. */

export interface AcceptedRow { index: number; row: number; name: string; strength: string | null; weak: boolean; notes: string[] }
export interface DiscardedRow { row: number; name: string; reasons: TypedImportError[] }
export interface ImportReview {
  category: ImportType; fileName: string; token: string; sheet: string | null;
  accepted: AcceptedRow[]; discarded: DiscardedRow[]; ignoredColumns: string[];
}

/**
 * Accepted = the rows POST /imports will save: valid and not a duplicate (the preview's `selected`).
 * Discarded = the rows that failed a check (with the server's reasons), and the valid rows that are
 * duplicates — POST /imports skips those with duplicates: 'skip'.
 */
export function buildReview(category: ImportType, p: TypedImportPreview): ImportReview {
  const accepted: AcceptedRow[] = [];
  const discarded: DiscardedRow[] = [];
  for (const r of p.rows) {
    if (r.status === 'failed') { discarded.push({ row: r.row, name: r.name, reasons: r.errors }); continue; }
    if (r.flags.includes('dup')) {
      discarded.push({ row: r.row, name: r.name, reasons: [{ field: 'name', label: 'Duplicate',
        message: r.dup_of ? `Already in your vault — ${r.dup_of.code} · ${r.dup_of.name}.` : 'Already in your vault.' }] });
      continue;
    }
    if (r.flags.includes('dupfile')) {
      discarded.push({ row: r.row, name: r.name, reasons: [{ field: 'name', label: 'Duplicate', message: 'Repeated in this file — the first row with this name is imported.' }] });
      continue;
    }
    accepted.push({ index: r.index, row: r.row, name: r.name, strength: r.strength, weak: r.flags.includes('weak'), notes: r.notes });
  }
  discarded.sort((a, b) => a.row - b.row);
  return { category, fileName: p.file_name, token: p.token, sheet: p.sheet, accepted, discarded, ignoredColumns: p.columns.ignored };
}
