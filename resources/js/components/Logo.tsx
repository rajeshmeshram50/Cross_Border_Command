/**
 * IGC Logo — single source of truth.
 *
 * Variants (each looks different):
 *   "auth"     → Login page: large logo (48×48) + big bold text + subtitle
 *   "authHero" → Login right panel: centered large logo (72×72) with glow
 *   "sidebar"  → Sidebar header: compact icon (28×28) + text
 *   "sidebarCollapsed" → Sidebar collapsed: icon only (24×24)
 *   "topnav"   → Horizontal top nav: icon (28×28) + text inline
 *   "favicon"  → Tiny icon only (20×20)
 */

type Variant = 'auth' | 'authHero' | 'sidebar' | 'sidebarCollapsed' | 'topnav' | 'favicon';

interface Props {
  variant: Variant;
  className?: string;
}

export default function Logo({ variant, className = '' }: Props) {
  switch (variant) {

    /* ═══════════════════════════════════════════
       LOGIN PAGE — Left form: big logo + title + subtitle
       ═══════════════════════════════════════════ */
    case 'auth':
      return (
        <div className={`flex items-center gap-4 ${className}`}>
          <div className="w-[52px] h-[52px] rounded-2xl bg-gradient-to-br from-primary/10 to-violet-500/10 border border-primary/20 p-1.5 flex items-center justify-center shadow-lg shadow-primary/10">
            <img src="/images/igc-logo.png" alt="IGC Group" className="w-full h-full rounded-xl object-contain" />
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold text-text tracking-tight leading-none">IGC Group</h1>
            <p className="text-[12px] text-muted font-medium mt-1 tracking-wide">Cross Border Command Platform</p>
          </div>
        </div>
      );

    /* ═══════════════════════════════════════════
       LOGIN PAGE — Right hero panel: large centered logo with glow
       ═══════════════════════════════════════════ */
    case 'authHero':
      return (
        <div className={`flex flex-col items-center ${className}`}>
          <div className="relative">
            {/* Glow ring */}
            <div className="absolute -inset-3 rounded-[28px] bg-white/10 blur-xl" />
            <div className="relative w-20 h-20 rounded-[22px] bg-white/15 backdrop-blur-sm border border-white/20 p-2.5 shadow-2xl">
              <img src="/images/igc-logo.png" alt="IGC Group" className="w-full h-full rounded-xl object-contain" />
            </div>
          </div>
          <h2 className="text-[15px] font-bold text-white/90 mt-4 tracking-wide">IGC Group</h2>
        </div>
      );

    /* ═══════════════════════════════════════════
       SIDEBAR — Expanded: small icon + brand name
       ═══════════════════════════════════════════ */
    case 'sidebar':
      return (
        <div className={`flex items-left gap-2.5 ${className}`}>
          <div className="w-36 h-8  overflow-hidden flex-shrink-0  ">
            <img src="/images/igc-logo.png" alt="IGC" className="w-full h-full object-contain" />
          </div>
        </div>
      );

    /* ═══════════════════════════════════════════
       SIDEBAR — Collapsed: icon only, centered
       ═══════════════════════════════════════════ */
    case 'sidebarCollapsed':
      return (
        <div className={`flex items-center justify-center ${className}`}>
          <div className="w-8 h-8 rounded-lg overflow-hidden shadow-md shadow-black/30 ring-1 ring-white/10">
            <img src="/images/igc-logo.png" alt="IGC" className="w-full h-full object-contain" />
          </div>
        </div>
      );

    /* ═══════════════════════════════════════════
       TOPNAV — Horizontal dark bar: icon + name inline
       ═══════════════════════════════════════════ */
    case 'topnav':
      return (
        <div className={`flex items-center gap-2 ${className}`}>
          <div className="w-30 h-8  overflow-hidden flex-shrink-0  ">
            <img src="/images/igc-logo.png" alt="IGC" className="w-full h-full object-contain" />
          </div>
        </div>
      );

    /* ═══════════════════════════════════════════
       FAVICON — Tiny, icon only
       ═══════════════════════════════════════════ */
    case 'favicon':
      return (
        <div className={className}>
          <img src="/images/igc-logo.png" alt="IGC" className="w-5 h-5 rounded object-contain" />
        </div>
      );

    default:
      return null;
  }
}
