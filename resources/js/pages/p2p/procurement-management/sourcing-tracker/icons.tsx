import type { ReactNode } from 'react';

/* Icon base for the Sourcing Tracker. Each popup's icons keep their own size and stroke (they
   follow that popup's Figma), so size is passed every time; only the SVG wrapper is shared. */

export function Svg({ size, sw = 2.2, stroke = 'currentColor', children }: {
  size: number; sw?: number; stroke?: string; children: ReactNode;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** The close (×) icon; every popup's own size / stroke is passed where it is used. */
export const IcoX = ({ size = 15, sw = 2.6 }: { size?: number; sw?: number }) => (
  <Svg size={size} sw={sw}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>
);

/* Icons used by more than one Sourcing Tracker screen. Same drawing everywhere; every use passes its
   own size / stroke (from that screen's Figma). */
type IconProps = { size: number; sw?: number; stroke?: string };
export const IcoBars = (p: IconProps) => <Svg {...p}><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></Svg>;
export const IcoCal = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>;
export const IcoCheck = (p: IconProps) => <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>;
export const IcoClock = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></Svg>;
export const IcoDb = (p: IconProps) => <Svg {...p}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></Svg>;
export const IcoEdit = (p: IconProps) => <Svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></Svg>;
export const IcoPen = (p: IconProps) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
export const IcoPin = (p: IconProps) => <Svg {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></Svg>;
export const IcoPlus = (p: IconProps) => <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
export const IcoSearch = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>;
export const IcoUpload = (p: IconProps) => <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Svg>;
export const IcoUser = (p: IconProps) => <Svg {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>;
export const IcoUserPlus = (p: IconProps) => <Svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></Svg>;
export const IcoUsers = (p: IconProps) => <Svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
export const IcoBack = (p: IconProps) => <Svg {...p}><polyline points="15 18 9 12 15 6" /></Svg>;
export const IcoFlag = (p: IconProps) => <Svg {...p}><path d="M3 21V4" /><path d="M3 4h13l-2 4 2 4H3" /></Svg>;
export const IcoGlobe = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>;
export const IcoNext = (p: IconProps) => <Svg {...p}><polyline points="9 18 15 12 9 6" /></Svg>;
