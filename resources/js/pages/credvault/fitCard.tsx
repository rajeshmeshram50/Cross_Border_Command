import { useRef, type ReactNode } from 'react';
import { useFillToFoot } from './shared';

/**
 * CvCard's `fit` layout for Access Requests, Audit Logs and Critical Vault, with a floor that
 * actually fits short screens.
 *
 * CvCard (shared.tsx, not ours to edit) never lets a fit card go below 400px. On a short window -
 * a laptop zoomed to 150-200% is about 470 CSS px tall - the header and strips leave far less than
 * that, so the card overflowed and the whole page scrolled again, which is what lagged. Here the card
 * is exactly the room down to the footer, never less than `min`, and the list scrolls inside it.
 * Same markup and class names as CvCard, so every existing CredVault style applies unchanged.
 */
export function FitCard({ children, pane = false, min = 200 }: { children: ReactNode; pane?: boolean; min?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFillToFoot(ref, (el, px) => { el.style.height = `${px}px`; el.style.minHeight = '0'; }, min,
    () => (pane ? ref.current : ref.current?.parentElement ?? null));
  return (
    <>
      {/* Short screens: the "What We Are Doing Here" strip is description only, and at this height
          it is the difference between the list fitting and the page scrolling. Tucked away below
          640px tall; everything else stays. */}
      {/* Very short screens (a laptop at 175-200% zoom is ~470 CSS px tall): the tabs + search alone
          take most of the card, leaving the rows no room. There the card's whole content scrolls as one
          inside the card - tabs move out of the way, rows get the space - with the pager pinned to the
          card's foot. The page itself still never scrolls. */}
      <style>{`
        @media (max-height: 640px) {
          .cvx:is(.ar-page, .al-page, .cv-page) > .sup-fig:has(> .bref-box) { display: none; }
          .cvx:is(.ar-page, .al-page, .cv-page) .cstrip__sub { display: none; }
        }
        @media (max-height: 560px) {
          .cvx:is(.ar-page, .cv-page) .tv-pane--fit > .tv-pane__bd { overflow-y: auto !important; }
          .cvx:is(.ar-page, .cv-page) .tv-pane--fit .tvc-list { flex: none !important; }
          .cvx:is(.ar-page, .cv-page) .tv-pane--fit .tvc-list > .whm-tblwrap { flex: none !important; overflow-y: hidden; overflow-x: auto; position: relative; z-index: 0; isolation: isolate; }
          .cvx.al-page .bst-card > :is(.alh, .alh-empty) { position: relative; z-index: 0; isolation: isolate; }
          .cvx:is(.ar-page, .cv-page) .tv-pane--fit .tvc-list > .wl-pager,
          .cvx.al-page .bst-card > .wl-pager { position: sticky; bottom: 0; z-index: 20; background: #fff !important; box-shadow: 0 -6px 14px -8px rgba(15, 23, 42, .25); }
          [data-bs-theme="dark"] .cvx:is(.ar-page, .cv-page) .tv-pane--fit .tvc-list > .wl-pager,
          [data-bs-theme="dark"] .cvx.al-page .bst-card > .wl-pager { background: #101c28 !important; box-shadow: 0 -6px 14px -8px rgba(0, 0, 0, .6); }
          .cvx.al-page .bst-card { overflow-y: auto !important; }
          .cvx.al-page .bst-card > :is(.alh, .alh-empty) { flex: none !important; overflow: visible !important; }
          .cvx.al-page .bst-card > .alh .alh-day__hd { top: 0 !important; }
        }
      `}</style>
      {pane ? (
        <section className="tv-pane tv-pane--r tv-pane--fit" ref={ref}>
          <div className="tv-pane__bd tvc-bd">{children}</div>
        </section>
      ) : (
        <div className="bst-wrap"><div className="bst-card" ref={ref}>{children}</div></div>
      )}
    </>
  );
}
