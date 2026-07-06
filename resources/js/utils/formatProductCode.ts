/**
 * Normalize a product code so its trailing number is always 3 digits, matching
 * the Product Management master's display (P-1 → P-001, P-03 → P-003, P-10 →
 * P-010; P-119 stays P-119). Codes without a trailing number are returned as-is.
 *
 * Shared so the Sales Matrix lead views (Product Directory, Sourcing, Price
 * Shared) show the SAME code the Product master shows — the raw DB code is
 * only 2-digit (P-01…P-10), which read inconsistently across screens.
 */
export function formatProductCode(raw?: string | null): string {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/^(.*?)(\d+)\s*$/);
  if (!m) return s;
  return `${m[1] || 'P-'}${m[2].padStart(3, '0')}`;
}
