import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IcoUpload, Svg } from './icons';
import './attach-picker.css';

/* "Add attachment" menu for an upload area: Upload file / Take photo (the app's attachment pattern
   and its shared live camera). Used by the Clarity dialog and the New Supplier business card.
   The host renders its own upload area and opens this under it; the chosen file comes back
   through onFile. */

/* The app's live camera (Take photo). A hidden <input capture> only opens a camera on a phone;
   this works on a desktop too. Lazy: it only loads when someone takes a photo. */
const CameraCaptureModal = lazy(() => import('../../purchase-management/order/physical-inspection/CameraCaptureModal'));

/** Menu height, to decide whether it opens below or above the upload area. */
const MENU_H = 158;

const IcoCamera = () => <Svg size={16}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Svg>;

type Props = {
  /** The upload area the menu opens under; focus returns to it when the menu or camera closes. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** File types for Upload file (the input's accept list). */
  accept: string;
  onFile: (file: File) => void;
  /** Camera dialog texts and the name prefix of a captured photo. */
  camera: { title: string; subject: string; namePrefix: string };
};

export default function AttachPicker({ anchorRef, open, onClose, accept, onFile, camera }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number; side: 'below' | 'above' } | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  // Position on the upload area: from its left edge (where its upload icon is), right under it, or
  // right above it when there is no room below. Its arrow points at the area, so the menu reads as
  // the area's own, not as a box floating over the fields around it.
  useLayoutEffect(() => {
    const r = open ? anchorRef.current?.getBoundingClientRect() : undefined;
    if (!r) { setAt(null); return; }
    const below = r.bottom + 8 + MENU_H <= window.innerHeight - 12;
    const width = Math.min(300, Math.max(260, r.width - 24));
    const left = Math.min(r.left + 12, window.innerWidth - width - 12);
    setAt({ top: below ? r.bottom + 8 : Math.max(12, r.top - MENU_H - 8), left, width, side: below ? 'below' : 'above' });
  }, [open, anchorRef]);

  // The menu is portalled to <body> (outside the dialog's Tab trap), so it manages keyboard focus
  // itself: focus moves to the first option on open, ↑ / ↓ / Home / End move between options, and
  // Esc / Tab close it and give focus back to the upload area.
  useEffect(() => {
    if (!at) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const toAnchor = () => { onClose(); anchorRef.current?.focus(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (menuRef.current?.contains(t) || anchorRef.current?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); toAnchor(); return; }
      if (e.key === 'Tab') { e.preventDefault(); toAnchor(); return; }
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
      if (next === undefined || !list.length) return;
      e.preventDefault();
      list[(next + list.length) % list.length].focus();
    };
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [at, anchorRef, onClose]);

  return (
    <>
      <input ref={fileRef} type="file" accept={accept} hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      {at && createPortal(
        <div ref={menuRef} className={`sta-att sta-att--${at.side}`} role="menu" aria-label="Add attachment" style={{ top: at.top, left: at.left, width: at.width }}>
          <div className="sta-att__hd">Add attachment</div>
          <button type="button" className="sta-att__opt" role="menuitem" onClick={() => { onClose(); anchorRef.current?.focus(); fileRef.current?.click(); }}>
            <span className="sta-att__ico"><IcoUpload size={16} /></span>
            <span><b>Upload file</b><i>Choose from this device</i></span>
          </button>
          <button type="button" className="sta-att__opt" role="menuitem" onClick={() => { onClose(); setCamOpen(true); }}>
            <span className="sta-att__ico sta-att__ico--cam"><IcoCamera /></span>
            <span><b>Take photo</b><i>Capture with the camera</i></span>
          </button>
        </div>,
        document.body,
      )}
      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal title={camera.title} subject={camera.subject} namePrefix={camera.namePrefix} max={1}
            onAttach={shots => { if (shots[0]) onFile(shots[0]); }}
            onClose={() => { setCamOpen(false); anchorRef.current?.focus(); }} />
        </Suspense>
      )}
    </>
  );
}
