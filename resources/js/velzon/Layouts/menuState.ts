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

export const subscribeMenu = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
