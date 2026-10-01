import { useEffect, type CSSProperties, type ReactNode } from 'react';
import './AuthCardLayout.css';

interface AuthCardLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
}

/* The sign-in screen's faces, matched to the design render by measuring its
   text against each candidate font's metrics: Plus Jakarta Sans for the copy
   (the headline lands within 3% of the render's width; Poppins is 14% off),
   Montserrat for the KRYPTONE.AI wordmark and the spaced tagline. Inter, used
   by the card's closing line, is already loaded by the page template. Loaded
   here so only the auth screens pay for them; the id stops a second auth
   page adding the same link again. */
const FONT_LINK_ID = 'kx-auth-fonts';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Montserrat:wght@300..800&display=swap';

/* The logo and the eight module icons are the design render's own artwork,
   cut out of it as transparent PNGs (public/images/kryptone/): the
   wordmark's letters are custom-drawn — the curled Y, the open P, the split
   K — so no font can reproduce them, and the icons are the render's own
   drawings rather than lookalikes. Each is placed at the size and position
   it has in the 1672 x 941 render; `top` is its offset from its row's top. */
const ART = '/images/kryptone';
const LOGO = { w: 521, h: 70 };

const MODULES: { key: string; ico: [number, number, number]; title: ReactNode; sub: [string, string]; bar: string; glow: string; subGap?: number }[] = [
  { key: 'hrms',  ico: [48, 41, 0],  title: 'HRMS',                                    sub: ['Empowered', 'People'],     bar: 'linear-gradient(90deg,#5b5deb,#9b30f2)', glow: '#5b5deb' },
  { key: 'sales', ico: [42, 41, 0],  title: 'Sales',                                   sub: ['Accelerated', 'Growth'],   bar: '#00e2f0',                                 glow: '#00e2f0' },
  { key: 'clm',   ico: [38, 42, -1], title: 'Contract',                                sub: ['Seamless', 'Execution'],   bar: '#ffc331',                                 glow: '#ffc331' },
  { key: 'p2p',   ico: [45, 41, 0],  title: <>P2P<small>(Procurement)</small></>,      sub: ['Efficient', 'Sourcing'],   bar: '#fa3888',                                 glow: '#fa3888' },
  { key: 'trade', ico: [45, 44, -2], title: <>Trade Finance<small>(E Docs)</small></>, sub: ['Global', 'Trade'],         bar: 'linear-gradient(90deg,#953bf3,#1becfd)', glow: '#953bf3' },
  { key: 'inv',   ico: [48, 42, -2], title: 'Inventory',                               sub: ['Real-time', 'Visibility'], bar: '#fdb734',                                 glow: '#fdb734', subGap: 14.5 },
  { key: 'pm',    ico: [46, 44, -1], title: <>Project<small>Management</small></>,     sub: ['Smarter', 'Delivery'],     bar: 'linear-gradient(90deg,#01c1ff,#2f6bff)', glow: '#01c1ff' },
  { key: 'vault', ico: [42, 42, 1],  title: <>Credential<small>Vault</small></>,       sub: ['Secure', 'Access'],        bar: '#00ebf1',                                 glow: '#00ebf1' },
];

const px = (n: number) => `calc(${n} * var(--u))`;

/* The wordmark at a given width in design pixels (hero 521, card 338). */
function KxLogo({ w, className }: { w: number; className: string }) {
  return (
    <img
      className={`kx-logo ${className}`}
      src={`${ART}/logo.png`}
      alt="KRYPTONE.AI"
      draggable={false}
      style={{ width: px(w), height: px(w * LOGO.h / LOGO.w) }}
    />
  );
}

export default function AuthCardLayout({ children, title, subtitle, icon }: AuthCardLayoutProps) {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  return (
    <div className="kx-shell">
      <div className="kx-bg" />

      <div className="kx-stage">
        <div className="kx-stage-bg" />
        <div className="kx-stage-scrim" />

        {/* Left: brand + pitch — desktop only (≥1024px). */}
        <section className="kx-left">
          <KxLogo w={LOGO.w} className="kx-logo--hero" />
          <div className="kx-tagline">UNIFIED ENTERPRISE OPERATIONS PLATFORM</div>
          <span className="kx-accent" />

          <h1 className="kx-headline">
            <span>One Intelligence.</span>
            <span className="kx-grad">Entire Enterprise.</span>
          </h1>
          <p className="kx-lead">
            Connect every function. Automate every process.<br />
            Power every decision — on a single, intelligent platform.
          </p>

          <div className="kx-modules">
            {/* subGap: Inventory is the one single-line title in its row, and the
                render still drops its subtitle to the row's shared subtitle line. */}
            {MODULES.map(({ key, ico: [iw, ih, top], title: t, sub, bar, glow, subGap }) => (
              <div key={key} className="kx-mod" style={{ '--glow': glow } as CSSProperties}>
                <span className="kx-mod-icowrap">
                  <img src={`${ART}/ico-${key}.png`} alt="" draggable={false} style={{ width: px(iw), height: px(ih), marginTop: px(top) }} />
                </span>
                <div className="kx-mod-title">{t}</div>
                <div className="kx-mod-sub" style={subGap ? { marginTop: px(subGap) } : undefined}>{sub[0]}<br />{sub[1]}</div>
                <span className="kx-mod-bar" style={{ background: bar }} />
              </div>
            ))}
          </div>
        </section>

        <div className="kx-footer">
          INTELLIGENCE <i>|</i> AUTOMATION <i>|</i> UNIFICATION <i>|</i> GROWTH
        </div>

        {/* Right: the glass card. */}
        <section className="kx-right">
          <div className="kx-card">
            <span className="kx-card-bevel" aria-hidden />
            <div className="kx-card-head">
              <KxLogo w={365} className="kx-logo--card" />
              {title && <h2 className="kx-title">{icon}{title}</h2>}
              {subtitle && <p className="kx-sub">{subtitle}</p>}
            </div>

            <div className="kx-card-body">{children}</div>

            <span className="kx-tri" />
            <div className="kx-card-foot">One Platform. Every Operation. A Stronger Tomorrow.</div>

            {/* The card render's own wave mesh, cut out of it (its closing line removed). */}
            <img className="kx-waves" src={`${ART}/card-mesh-2.png`} alt="" draggable={false} />
          </div>
        </section>
      </div>
    </div>
  );
}
