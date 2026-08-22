/**
 * Unsupported-browser detection + notice (QA #108).
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is built on Tailwind CSS 4, which compiles to `@property`,
 * `color-mix()` and `oklch()`. Those have a hard floor of Safari 16.4 /
 * Chrome 111 / Firefox 128 — below it the declarations are dropped, every
 * custom property resolves to nothing, and elements render with no colour, no
 * spacing and no shadow.
 *
 * The scripts still load and run, so the app is fully interactive the whole
 * time. Nothing throws, nothing 404s, the console is clean. A user just sees
 * "some elements are not displayed correctly" — which is precisely how this got
 * reported, against Payroll, as though it were a payroll defect. It is not:
 * every screen in the product is affected identically.
 *
 * So the failure mode is silent by construction, and no amount of testing
 * individual screens will ever localise it. The fix is to make the boundary
 * say its own name.
 *
 * DETECTION
 * ---------
 * Feature detection, never UA sniffing. The user agent lies (every embedded
 * webview, every "Chrome-compatible" shell), and what actually matters is
 * whether THIS engine can resolve the CSS we ship — which `CSS.supports` can
 * answer directly and truthfully.
 *
 * THE NOTICE
 * ----------
 * Built with plain DOM and inline styles using only properties that predate the
 * floor by a decade: hex colours, `position: fixed`, `px` units. It deliberately
 * shares NOTHING with the stylesheet it is reporting on — no Tailwind class, no
 * CSS variable, no `color-mix`. A warning rendered in the broken styling system
 * would be broken too, which is the one thing it cannot afford to be.
 *
 * It informs rather than blocks. The app remains usable — degraded styling is
 * not a security boundary, and locking someone out of their payroll because
 * their IT department pins an old browser would be a worse failure than the one
 * being reported.
 */

/** Keep in step with vite.config.js `build.target` and package.json browserslist. */
export const MIN_BROWSERS = 'Chrome 111+, Edge 111+, Firefox 128+, or Safari 16.4+';

const DISMISS_KEY = 'cbc-browser-notice-dismissed';
const NOTICE_ID = 'cbc-browser-notice';

/**
 * Does this engine support the CSS the built stylesheet actually relies on?
 *
 * Each probe maps to something Tailwind 4 emits in bulk — see the counts in the
 * vite.config.js comment. `CSS.supports` itself is checked first: a browser old
 * enough to lack it is far below the floor anyway, and treating "cannot ask" as
 * "supported" would be exactly backwards.
 */
export function isBrowserSupported(): boolean {
    try {
        if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
            return false;
        }
        // color-mix() — 206 occurrences in the built app stylesheet.
        if (!CSS.supports('color', 'color-mix(in srgb, red 50%, blue)')) return false;
        // oklch() — 63 occurrences.
        if (!CSS.supports('color', 'oklch(0.5 0.1 200)')) return false;
        // @property, which has no CSS.supports() form. registerProperty is the
        // same feature behind the JS API, so its presence is a faithful proxy.
        if (typeof (CSS as unknown as { registerProperty?: unknown }).registerProperty !== 'function') return false;
        // :has() — used by the theme and several component stylesheets.
        if (!CSS.supports('selector(:has(*))')) return false;
        return true;
    } catch {
        /* A browser that throws on a feature probe cannot be relied on to render
           the stylesheet either. Fail to "unsupported" — a false warning costs a
           dismissed banner, a false all-clear costs the silent breakage this
           whole module exists to end. */
        return false;
    }
}

/** Has the user already dismissed the notice this session/browser? */
function isDismissed(): boolean {
    try {
        return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
        // Private mode / storage blocked — treat as not dismissed. Showing the
        // notice again is a far smaller cost than suppressing it wrongly.
        return false;
    }
}

function rememberDismissal(): void {
    try {
        window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
        /* Storage unavailable — the notice simply returns on the next load. */
    }
}

/**
 * Show the notice if this browser is below the floor. Safe to call
 * unconditionally: it is a no-op on a supported browser, when already
 * dismissed, when already mounted, or when there is no DOM at all.
 */
export function mountBrowserSupportNotice(): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById(NOTICE_ID)) return;   // never mount twice
    if (isBrowserSupported()) return;
    if (isDismissed()) return;

    const bar = document.createElement('div');
    bar.id = NOTICE_ID;
    bar.setAttribute('role', 'alert');
    // Inline, pre-floor CSS only — see the file header for why.
    bar.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
        'background:#7a3d00', 'color:#ffffff',
        'padding:12px 16px',
        'font-size:13px', 'line-height:1.5',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif',
        'box-shadow:0 -2px 8px rgba(0,0,0,0.25)',
        'text-align:center',
    ].join(';');

    const msg = document.createElement('span');
    msg.textContent =
        'This browser is out of date, so parts of this page may appear unstyled or misaligned. '
        + 'For the correct display, use ' + MIN_BROWSERS + '.';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Dismiss';
    close.setAttribute('aria-label', 'Dismiss browser compatibility notice');
    close.style.cssText = [
        'margin-left:14px',
        'background:transparent', 'color:#ffffff',
        'border:1px solid #ffffff', 'border-radius:4px',
        'padding:3px 12px', 'font-size:12px', 'cursor:pointer',
    ].join(';');
    close.onclick = () => {
        rememberDismissal();
        bar.parentNode?.removeChild(bar);
    };

    bar.appendChild(msg);
    bar.appendChild(close);
    document.body.appendChild(bar);
}
