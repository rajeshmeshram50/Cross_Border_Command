import './ComingSoon.css';

export interface ComingSoonProps {
  /** The white headline. One line reads best. */
  title?: string;
  /** The gradient line under the headline — the second half of the lockup. */
  status?: string;
  /** The letterspaced line under the mark. */
  tagline?: string;
  /** Optional paragraph at the foot. */
  subtitle?: string;
  /** Brand mark for dark surfaces — the white wordmark. `null` drops both. */
  logo?: string | null;
  /** Brand mark for light surfaces — the same mark with the type re-inked. */
  logoInk?: string;
  className?: string;
}

const ART = '/images/kryptone';

/**
 * A module placeholder, built in the KRYPTONE.AI sign-in screen's language —
 * see `layouts/AuthCardLayout.css`, which this borrows its palette, its
 * cyan-to-violet accent bar, its wave mesh and its glass rim from.
 *
 * The composition is that screen's hero, centred: mark, letterspaced tagline,
 * accent bar, white headline, gradient line.
 *
 * Two things earlier passes got wrong and are worth not repeating:
 *
 *  · The MARK. This panel carries KRYPTONE.AI, the platform's own mark, not
 *    a tenant's logo — a placeholder for an unbuilt module is the product
 *    speaking, not the customer.
 *  · The MOTIF. There is no icon tile and no pill badge. A gradient squircle
 *    with a glowing ring is the stock "coming soon" graphic every admin
 *    template ships; it read as decoration bolted onto the page.
 *
 * The panel is dark in both themes, by design: the KRYPTONE mark is a white
 * wordmark on transparent and has no dark-ink variant, and the brand's whole
 * visual language is the dark aurora. It is a self-contained brand surface,
 * the same way the sign-in screen is.
 *
 * NOTE: `AuthCardLayout.css` asks for Montserrat, but Montserrat is not loaded
 * anywhere in the app — not in welcome.blade.php and not in app.css — so that
 * screen already renders in Plus Jakarta Sans. This file asks for the font the
 * app actually serves rather than one that silently falls back.
 */
export default function ComingSoon({
  title = 'This module is being built',
  status = 'Coming soon',
  tagline = 'Unified Enterprise Operations Platform',
  subtitle,
  logo = `${ART}/logo.png`,
  logoInk = `${ART}/logo-ink.png`,
  className = '',
}: ComingSoonProps) {
  return (
    <div className={`kcs ${className}`}>
      <img className="kcs-waves" src={`${ART}/card-mesh-2.png`} alt="" draggable={false} />

      <div className="kcs-inner">
        {/* Two files, one per surface, swapped by CSS. The mark ships as white
            type on transparent, so on a light panel it needs the re-inked
            variant — built by re-colouring only its near-greyscale pixels, so
            the K and the .AI keep their gradients. A CSS filter cannot do this:
            invert() blackens the type but flips the K to yellow-green. */}
        {logo && (
          <>
            <img className="kcs-logo kcs-logo--ink" src={logoInk} alt="KRYPTONE.AI" draggable={false} />
            <img className="kcs-logo kcs-logo--white" src={logo} alt="" aria-hidden="true" draggable={false} />
          </>
        )}

        {tagline && <p className="kcs-tagline">{tagline}</p>}

        <span className="kcs-accent" aria-hidden="true" />

        {/* Each line is a block, and the gradient span inside stays
            inline-block — a block-width span would stretch the gradient
            across the column so the text only ever reached its blue end.
            Same split AuthCardLayout's .kx-headline uses. */}
        <h1 className="kcs-title">
          <span className="kcs-line">{title}</span>
          {status && (
            <span className="kcs-line"><span className="kcs-grad">{status}</span></span>
          )}
        </h1>

        {subtitle && <p className="kcs-sub">{subtitle}</p>}
      </div>
    </div>
  );
}
