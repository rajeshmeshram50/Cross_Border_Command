import type { ReactNode } from 'react';
import { FaLinkedin, FaInstagram, FaFacebook } from 'react-icons/fa';
import { useSettings } from '../contexts/SettingsContext';
interface AuthCardLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
}

const socialLinks = [
  { icon: FaLinkedin, href: 'https://www.linkedin.com/company/inorbvict-agrotech-pvt-ltd', label: 'LinkedIn' },
  { icon: FaInstagram, href: 'https://www.instagram.com/inorbvict_agrotech/', label: 'Instagram' },
  { icon: FaFacebook, href: 'https://www.facebook.com/people/Inorbvict-Agrotech', label: 'Facebook' },
];

export default function AuthCardLayout({ children, title, subtitle, icon }: AuthCardLayoutProps) {
  // Pull platform name from settings so super_admin's General-tab change
  // appears here (e.g. branding the login screen for white-label customers).
  // Falls back to the default if settings haven't loaded (first visit).
  const { settings } = useSettings();
  const platformName = settings.general.platform_name || 'Cross Border Command';
  return (
    <div className="flex w-full bg-slate-950 font-sans relative overflow-x-hidden cbc-shell">
      {/* Background image — sharper now (no auto-scale that was softening
          edges) and revealed through a lighter overlay so the building
          shot reads as the hero asset, not muddy backdrop. */}
      <div
        className="fixed inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: 'url(/images/loginbg.png)' }}
      />
      {/* Lighter scrim — preserves contrast on the right card while
          letting the photo's color and detail come through on the left. */}
      <div className="fixed inset-0 bg-gradient-to-r from-slate-950/55 via-slate-950/25 to-slate-950/65 pointer-events-none" />
      {/* Brand color accents — punchy radial glows that lift the dull
          midtones of the photo without darkening it further. */}
      <div className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(900px 600px at 12% 20%, rgba(139,92,246,0.22), transparent 60%),' +
            'radial-gradient(700px 500px at 90% 85%, rgba(245,176,111,0.18), transparent 60%)',
        }} />
      <div className="fixed inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Page-level CSS — uses dvh (dynamic viewport height) so the page
          doesn't jump when mobile browser chrome (URL bar) hides/shows.
          Falls back to vh on browsers that don't support dvh. */}
      <style>{`
        .cbc-shell { min-height: 100vh; min-height: 100dvh; }
        .cbc-pane  { min-height: 100vh; min-height: 100dvh; }
        /* On phones the keyboard pushes layout up — keep card area
           scrollable rather than clipping the form below the fold. */
        @media (max-width: 1023px) {
          .cbc-pane-card { padding-top: max(1.25rem, env(safe-area-inset-top)); padding-bottom: max(1.25rem, env(safe-area-inset-bottom)); }
        }
        @media (max-width: 380px) {
          /* Very narrow phones (e.g. iPhone SE) — pull card padding in
             a notch so inputs aren't squashed against the rounded edge. */
          .cbc-login-card { padding: 14px !important; }
        }
      `}</style>

      {/* Main Content Container */}
      <div className="relative z-10 flex w-full">
        {/* Left Side: Branding & Info — visible only on lg+ (≥1024px).
            Phone & tablet portrait collapse to just the centered card. */}
        <div className="flex-1 hidden lg:flex flex-col justify-between p-6 lg:p-8 xl:p-12 text-white cbc-pane">
          <div className="max-w-xl animate-in fade-in slide-in-from-left duration-700">
            <div className="mb-2 animate-float">
              <div className="w-36 lg:w-44 xl:w-48 h-24 lg:h-28 xl:h-32 hover-lift transition-transform duration-500">
                <img src="/images/igc-logo.png" alt="IGC Group" className="w-full h-full object-contain object-left filter drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]" />
              </div>
            </div>

            {/* Software product name — sits directly under the IGC mark.
                Stylish typographic treatment: weight contrast across the
                words (thin → medium → heavy gradient italic) so the wordmark
                reads like a real product brand. Words come from Settings →
                General → Platform Name, split on whitespace. Default
                "Cross Border Command" renders as 3 distinct weights; a
                custom 2-word name renders as thin + bold-italic; a single
                word renders as the bold-italic treatment alone. */}
            <div className="mb-6 ml-1 cbc-wordmark">
              {(() => {
                const words = platformName.trim().split(/\s+/).filter(Boolean);
                const classFor = (i: number, last: number) => {
                  if (i === last) return 'cbc-w3';           // last word — heavy gradient italic
                  if (i === last - 1) return 'cbc-w2';        // penultimate — medium white
                  return 'cbc-w1';                             // earlier words — thin
                };
                return words.map((w, i) => (
                  <span key={`${w}-${i}`} className={classFor(i, words.length - 1)}>{w}</span>
                ));
              })()}
              <span className="cbc-underline" aria-hidden />
            </div>
            <style>{`
              .cbc-wordmark {
                display: flex;
                align-items: baseline;
                gap: 10px;
                position: relative;
                font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
                font-size: 30px;
                line-height: 1;
                letter-spacing: -0.025em;
                padding-bottom: 12px;
                white-space: nowrap;
                width: max-content;
                max-width: 100%;
              }
              @media (min-width: 1280px) {
                .cbc-wordmark { font-size: 40px; gap: 12px; padding-bottom: 14px; }
              }
              @media (min-width: 1536px) {
                .cbc-wordmark { font-size: 48px; gap: 14px; padding-bottom: 16px; }
              }
              .cbc-w1 {
                font-weight: 300;
                color: rgba(255,255,255,0.78);
              }
              .cbc-w2 {
                font-weight: 600;
                color: #ffffff;
              }
              .cbc-w3 {
                font-weight: 900;
                font-style: italic;
                background: linear-gradient(120deg,
                  #ffffff 0%,
                  #d8dcff 35%,
                  #b9b3ff 60%,
                  #f5b06f 100%);
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                background-size: 200% 100%;
                animation: cbc-w3-shimmer 6s linear infinite;
                text-shadow: 0 0 30px rgba(185,179,255,0.20);
              }
              .cbc-underline {
                position: absolute;
                left: 0; bottom: 0;
                width: 90px;
                height: 3px;
                background: linear-gradient(90deg, #f5b06f, transparent);
                border-radius: 999px;
                animation: cbc-underline-grow 1.2s cubic-bezier(0.22,1,0.36,1) 0.4s both;
                transform-origin: left center;
              }
              @keyframes cbc-w3-shimmer {
                from { background-position: 0% 0; }
                to   { background-position: 200% 0; }
              }
              @keyframes cbc-underline-grow {
                from { transform: scaleX(0); opacity: 0; }
                to   { transform: scaleX(1); opacity: 1; }
              }
            `}</style>


            <p className="text-base text-white/70 font-medium leading-relaxed max-w-md">
              An intelligent platform connecting Operations, Procurement, Logistics, Finance, and Compliance in one unified ecosystem.
            </p>

            <div className="mt-8 flex items-center gap-6">
              {[
                { label: 'Latency', value: '<14ms' },
                { label: 'Availability', value: '99.9%' },
                { label: 'Security', value: 'SOC-2' },
              ].map((item) => (
                <div key={item.label} className="flex flex-col hover-lift p-2 rounded-lg hover:bg-white/5 transition-all">
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">{item.label}</span>
                  <span className="text-sm font-bold text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-full flex items-center justify-center border border-white/20 bg-white/5 text-white/50 hover:bg-white hover:text-primary hover:border-white hover-scale hover-lift transition-all duration-300"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
            <div className="text-[10px] font-medium text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors cursor-default">© 2026 IGC Group. All rights reserved.</div>
          </div>
        </div>

        {/* Right Side: Login Form Card — centered on every viewport.
            Vertical padding on small screens accounts for the iOS notch /
            Android chrome via env(safe-area-inset-*). The card width
            scales from 92vw on tiny phones up to 460px on tablet+. */}
        <div
          className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:p-8 cbc-pane cbc-pane-card"
        >
          <div className="w-full max-w-[92vw] sm:max-w-[440px] md:max-w-[480px] animate-in zoom-in-95 duration-500">
            <div className="cbc-login-card relative overflow-hidden p-4 sm:p-5 transition-all duration-700 ease-out group/card">
              {/* Animated gradient border ring — premium signature glow
                  that breathes around the card. Sits in ::before so it
                  doesn't interfere with content stacking. */}

              {/* Logo in Card */}
              <div className="flex justify-center mb-3 sm:mb-4 relative z-10">
                <img src="/images/igc-logo.png" alt="Logo" className="w-[64px] sm:w-[72px] object-contain drop-shadow-[0_2px_8px_rgba(99,102,241,0.20)]" />
              </div>

              {(title || subtitle) && (
                <div className="mb-3 sm:mb-3.5 text-center relative z-10">
                  {title && (
                    <div className="flex items-center justify-center gap-2 mb-1">
                      {icon && <span className="text-primary">{icon}</span>}
                      <h2 className="text-[24px] sm:text-[26px] font-extrabold gradient-text tracking-tight leading-tight">{title}</h2>
                    </div>
                  )}
                  {subtitle && <p className="text-[12px] text-[#5e6b85] font-medium leading-snug">{subtitle}</p>}
                </div>
              )}

              <div className="relative z-10">{children}</div>
            </div>
            <style>{`
              /* Frosted light-glass card — opaque enough that the bg
                 image doesn't bleed through, but soft and white so the
                 page reads bright and friendly. Heavy blur preserves
                 the layered glass feel. */
              .cbc-login-card {
                background:
                  radial-gradient(circle at 0% 0%, rgba(139,92,246,0.10) 0%, transparent 50%),
                  radial-gradient(circle at 100% 100%, rgba(245,176,111,0.08) 0%, transparent 55%),
                  linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(248,250,255,0.82) 100%);
                backdrop-filter: blur(28px) saturate(160%);
                -webkit-backdrop-filter: blur(28px) saturate(160%);
                border-radius: 22px;
                border: 1px solid rgba(255,255,255,0.70);
                box-shadow:
                  0 1px 0 rgba(255,255,255,0.95) inset,
                  0 -1px 0 rgba(99,102,241,0.06) inset,
                  0 20px 48px rgba(15,23,42,0.30),
                  0 40px 90px rgba(99,102,241,0.20);
              }
              @media (min-width: 640px) {
                .cbc-login-card { border-radius: 26px; }
              }
              /* Top accent bar — thin gradient stripe across the top
                 edge that catches the eye against the dark background. */
              .cbc-login-card::after {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg,
                  transparent 0%,
                  rgba(139,92,246,0.85) 25%,
                  rgba(245,176,111,0.85) 75%,
                  transparent 100%);
                z-index: 2;
              }
              /* Animated gradient border ring. */
              .cbc-login-card::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: inherit;
                padding: 1px;
                background: linear-gradient(135deg,
                  rgba(139,92,246,0.55) 0%,
                  rgba(255,255,255,0.18) 30%,
                  rgba(245,176,111,0.55) 60%,
                  rgba(255,255,255,0.18) 80%,
                  rgba(139,92,246,0.55) 100%);
                background-size: 220% 220%;
                -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                -webkit-mask-composite: xor;
                        mask-composite: exclude;
                pointer-events: none;
                opacity: 0.6;
                animation: cbc-card-glow 7s linear infinite;
              }
              .cbc-login-card:hover {
                box-shadow:
                  0 1px 0 rgba(255,255,255,0.35) inset,
                  0 -1px 0 rgba(0,0,0,0.20) inset,
                  0 24px 60px rgba(0,0,0,0.55),
                  0 48px 100px rgba(139,92,246,0.30);
                transform: translateY(-2px);
              }
              .cbc-login-card:hover::before { opacity: 0.95; }
              @keyframes cbc-card-glow {
                from { background-position: 0% 50%; }
                to   { background-position: 220% 50%; }
              }

              /* Card is light/white — text reverts to dark indigo brand
                 colors for proper contrast on the bright surface. */
              .cbc-login-card .gradient-text {
                background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 60%, #f5b06f 100%) !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-fill-color: transparent !important;
              }
              .cbc-login-card label {
                color: #4338ca !important;
              }
              .cbc-login-card p { color: #5b6378 !important; }
              .cbc-login-card input.form-control,
              .cbc-login-card input[type="email"],
              .cbc-login-card input[type="password"],
              .cbc-login-card input[type="text"] {
                background: rgba(255,255,255,0.85) !important;
                border-color: rgba(99,102,241,0.18) !important;
                color: #1e293b !important;
              }
              .cbc-login-card input::placeholder {
                color: rgba(100,116,139,0.55) !important;
              }
              .cbc-login-card input:focus {
                background: #ffffff !important;
                border-color: rgba(99,102,241,0.55) !important;
                box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
              }
              .cbc-login-card .cbc-remember-text { color: #475569 !important; }
              .cbc-login-card .cbc-remember-box {
                background: rgba(255,255,255,0.90) !important;
                border-color: rgba(99,102,241,0.30) !important;
              }
            `}</style>

            <div className="mt-3 sm:mt-4 text-center text-white/40 text-[10px] sm:text-[11px] font-medium lg:hidden">
              © 2026 IGC Group. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
