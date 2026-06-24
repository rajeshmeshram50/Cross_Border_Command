/**
 * Module-level state for sidebar dropdown expand/collapse.
 *
 * Why outside React state:
 *   `Navdata` (LayoutMenuData) is called as a plain function from VerticalLayout
 *   via `navdata().props.children`, NOT rendered as a JSX component. Hooks
 *   inside Navdata therefore can't keep state reliably across parent re-renders
 *   — every `useState(...)` call resets to its initial value.
 *
 *   The fix: keep the open-set in a module-level singleton and ask the
 *   consuming Layout component to re-render via `useMenuStateVersion()`
 *   whenever a menu item toggles.
 */

let openIds: Set<string> = new Set();
const listeners = new Set<() => void>();

export const isMenuOpen = (id: string): boolean => openIds.has(id);

export const toggleMenu = (id: string): void => {
  openIds = new Set(openIds);
  if (openIds.has(id)) openIds.delete(id);
  else openIds.add(id);
  listeners.forEach((l) => l());
};

// Top-level modules are mutually exclusive — opening one collapses every other
// module (and any nested groups they had open). Clicking the open module closes
// it. Used by the top-level module triggers; nested groups keep using toggleMenu.
export const toggleTopMenu = (id: string): void => {
  openIds = new Set(openIds.has(id) ? [] : [id]);
  listeners.forEach((l) => l());
};

// Sibling groups within a module are mutually exclusive too — opening one closes
// the other groups in the SAME module (same `<module>.` prefix and same depth)
// while leaving the parent module + every other module untouched. Group ids look
// like "clm.command" / "sales.insights"; the module id ("clm") has no dot so it
// is never matched and stays open.
export const toggleGroupMenu = (id: string): void => {
  openIds = new Set(openIds);
  const wasOpen = openIds.has(id);
  const prefix = id.split(".")[0] + ".";
  const depth = id.split(".").length;
  for (const k of [...openIds]) {
    if (k !== id && k.startsWith(prefix) && k.split(".").length === depth) {
      openIds.delete(k);
    }
  }
  if (!wasOpen) openIds.add(id);
  listeners.forEach((l) => l());
};

export const closeAllMenus = (): void => {
  if (openIds.size === 0) return;
  openIds = new Set();
  listeners.forEach((l) => l());
};

export const subscribeMenu = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
