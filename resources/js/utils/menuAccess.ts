/* ─────────────────────────────────────────────────────────────────────────
 * Single source of truth for "should this nav module be visible?".
 *
 * Both the horizontal header (IdimsHeader) and the vertical sidebar
 * (LayoutMenuData) MUST use this so they never drift apart again.
 *
 * Rule: a module shows if the user holds the PARENT slug grant
 * (e.g. perms['p2p']) OR any child-leaf grant (e.g. perms['p2p.bulk_sourcing']).
 * This covers both grant styles — admins usually grant the parent module, while
 * per-leaf grants are also honoured. (super_admin always sees it; a blocked /
 * expired plan hides everything.)
 * ───────────────────────────────────────────────────────────────────────── */

type PermRow = { can_view?: boolean } | undefined;
type Perms = Record<string, PermRow>;

export function moduleVisible(perms: Perms, slug: string, isSuperAdmin: boolean, planBlocked: boolean): boolean {
  if (isSuperAdmin) return true;
  if (planBlocked) return false;
  if (perms[slug]?.can_view) return true;          // parent grant
  const prefix = slug + '.';
  return Object.keys(perms).some(s => s.startsWith(prefix) && perms[s]?.can_view); // any leaf grant
}
