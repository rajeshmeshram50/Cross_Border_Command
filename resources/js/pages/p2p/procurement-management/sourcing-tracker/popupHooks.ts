import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/* ── usePopup: scroll lock, Esc stack and focus for every Sourcing Tracker popup ──────────────
   - Scroll lock: <body> AND <html> (a body-only lock still lets the page scroll), counted across
     open popups (see lockScroll).
   - Esc: one window listener and a stack of open popups. Only the TOP popup reacts, so stacked
     popups (Report → Mapped Suppliers, Assign → Clarity) never close together.
   - Focus: moves into the dialog on open, Tab stays inside it, and returns to where it was on close.
   A popup can pass `blocked` to keep Esc for something of its own that is open on top of it
   (the Clarity dialog's attachment menu or camera), and the app's shared date picker / dropdown
   menus always keep their Esc (they close themselves on the same key). */

type Entry = { id: number; esc: () => void; blocked: () => boolean; dialog: () => HTMLElement | null };
const stack: Entry[] = [];
let nextId = 1;

/* Scroll lock is counted, not saved per popup: the FIRST popup to open saves the page's own
   overflow and the LAST one to close puts it back. A per-popup save breaks when stacked popups
   close together (Report + Mapped Suppliers on Convert): React cleans the parent up first, then
   the child restores the 'hidden' it saw on open and the page stays locked. */
let lockCount = 0;
let savedOverflow: [string, string] = ['', ''];

function lockScroll() {
  const html = document.documentElement;
  if (lockCount++ === 0) savedOverflow = [document.body.style.overflow, html.style.overflow];
  document.body.style.overflow = 'hidden';
  html.style.overflow = 'hidden';
}

function unlockScroll() {
  if (--lockCount > 0) return;
  lockCount = 0;
  [document.body.style.overflow, document.documentElement.style.overflow] = savedOverflow;
}

/** The app's shared MasterDatePicker / MasterSelect menus, the "Add attachment" menu and camera,
    and the app's own modals opened on top of a popup (the Supplier Master Domestic / International
    gate, the Add Supplier wizard) own their
    Esc: while one is open, Esc goes only to it. They are portalled to <body> and expose no open
    state, so this is the one place their markup is checked. */
const sharedLayerOpen = () =>
  !!document.querySelector('.master-datepicker-popup, .master-select-menu.show, .supch-ov, .avm-backdrop, .sta-att, .spi-mdl-backdrop.cam-layer');

function onKeyDown(e: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    if (top.blocked() || sharedLayerOpen()) return;
    e.stopImmediatePropagation();
    top.esc();
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function usePopup(
  dialogRef: RefObject<HTMLElement | null>,
  { onClose, blocked }: { onClose: () => void; blocked?: () => boolean },
) {
  // Latest callbacks, so the stack entry never goes stale (updated after render, not during it).
  const latest = useRef({ onClose, blocked });
  useLayoutEffect(() => { latest.current = { onClose, blocked }; });
  // The element that opened the popup, read on the first render: by the time effects run, an
  // autoFocus field inside the popup has already taken focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    lockScroll();

    // Esc stack.
    const entry: Entry = { id: nextId++, esc: () => latest.current.onClose(), blocked: () => !!latest.current.blocked?.(), dialog: () => dialogRef.current };
    if (stack.length === 0) window.addEventListener('keydown', onKeyDown, true);
    stack.push(entry);

    // Focus: into the dialog now, back to the opener on close.
    const first = dialogRef.current;
    if (first && !first.contains(document.activeElement)) {
      if (!first.hasAttribute('tabindex')) first.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    }
    // Tab / Shift+Tab wrap inside the top dialog (not while focus is in a portalled menu). The
    // dialog is read on every key press: a popup may swap its box (Map Supplier → its form).
    const onTab = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (e.key !== 'Tab' || stack[stack.length - 1] !== entry || !dialog) return;
      const active = document.activeElement;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      // Focus fell to <body> (the element that had it was removed): bring it back into the dialog.
      if (!active || active === document.body) { e.preventDefault(); (items[0] ?? dialog).focus(); return; }
      if (active !== dialog && !dialog.contains(active)) return;   // in a portalled menu: leave it
      if (!items.length) return;
      const head = items[0], last = items[items.length - 1];
      if (e.shiftKey && (active === head || active === dialog)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onTab);

    return () => {
      document.removeEventListener('keydown', onTab);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown, true);
      unlockScroll();
      // Back to the opener; if it is gone (e.g. removed by a step change), to the popup underneath.
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      else stack[stack.length - 1]?.dialog()?.focus({ preventScroll: true });
    };
  }, [dialogRef, opener]);
}

/**
 * One fixed height for a popup's tabbed table: the sticky header + `rows` rows. Longer lists scroll
 * inside; a shorter or empty tab keeps the same box, so the popup never jumps on a tab switch.
 * Measured from the real header and first row (row height follows the content); the last good
 * measure is kept for a tab that has no rows to measure. Re-measures on resize and when `tab`
 * changes, and scrolls a new tab back to the top. Returns the height to set, or null (no rows).
 */
export function useFitRows(
  ref: RefObject<HTMLElement | null>,
  { headSelector, rowSelector, rows, tab }: { headSelector: string; rowSelector: string; rows: number; tab: string },
) {
  const dims = useRef<{ head: number; row: number } | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || rows === 0) { setHeight(null); return; }
    const measure = () => {
      const head = el.querySelector<HTMLElement>(headSelector);
      const row = el.querySelector<HTMLElement>(rowSelector);
      if (head && row) dims.current = { head: head.getBoundingClientRect().height, row: row.getBoundingClientRect().height };
      if (dims.current) setHeight(Math.ceil(dims.current.head + dims.current.row * rows));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, headSelector, rowSelector, rows, tab]);

  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [ref, tab]);

  return height;
}
