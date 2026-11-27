/* Case- and accent-insensitive column sort for @tanstack/react-table columns.
   "alice" and "Alice" compare equal and sort together, instead of all upper-case
   values coming first (code-point order). Pass as a column's `sortingFn`. */
export const ciSort = (a: any, b: any, id: string) =>
  String(a.getValue(id) ?? '').localeCompare(String(b.getValue(id) ?? ''), undefined, { sensitivity: 'base' });
