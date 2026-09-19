// One definition per icon, shared by every P2P module (Order, Create PO, Payment Requests).
// Add a new glyph here and import it; never redeclare one in a page.
// They draw in currentColor so the surrounding element decides the colour.
import type { SVGProps } from 'react';

type IconProps = { size?: number; stroke?: number } & Omit<SVGProps<SVGSVGElement>, 'stroke'>;

/** Shared frame: square viewBox, no fill, round joins. */
function Svg({ size = 14, stroke = 2.2, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IcoDoc = (p: IconProps) => (
  <Svg size={18} stroke={2} {...p}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M9 12l1.6 1.6L14 10" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </Svg>
);

export const IcoDocSm = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </Svg>
);

export const IcoFile = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </Svg>
);

export const IcoLines = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const IcoBox = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </Svg>
);

export const IcoShip = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </Svg>
);

export const IcoTarget = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
);

export const IcoUser = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);

export const IcoPin = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </Svg>
);

export const IcoShield = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

/** Shield with an exclamation — the blocked-scrutiny popup. */
export const IcoShieldAlert = (p: IconProps) => (
  <Svg size={20} stroke={2.2} {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="13" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);

export const IcoCard = (p: IconProps) => (
  <Svg size={14} stroke={2} {...p}>
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </Svg>
);

export const IcoLink = (p: IconProps) => (
  <Svg size={18} stroke={2.2} {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);

export const IcoLock = (p: IconProps) => (
  <Svg size={11} stroke={2.2} {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);

export const IcoHistory = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <polyline points="3 3 3 8 8 8" />
    <polyline points="12 7 12 12 15 14" />
  </Svg>
);

export const IcoPencil = (p: IconProps) => (
  <Svg size={13} stroke={2.2} {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Svg>
);

export const IcoPlus = (p: IconProps) => (
  <Svg size={12} stroke={2.6} {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const IcoCheck = (p: IconProps) => (
  <Svg size={12} stroke={3} {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

/** Tick inside a circle — "all clear" states. */
export const IcoOk = (p: IconProps) => (
  <Svg size={15} stroke={2.4} {...p}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </Svg>
);

/** Circle with an exclamation. */
export const IcoWarn = (p: IconProps) => (
  <Svg size={13} stroke={2.2} {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);

/** Triangle with an exclamation. */
export const IcoAlert = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

export const IcoStop = (p: IconProps) => (
  <Svg size={15} stroke={2.4} {...p}>
    <circle cx="12" cy="12" r="9" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </Svg>
);

export const IcoClock = (p: IconProps) => (
  <Svg size={12} stroke={2} {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Svg>
);

export const IcoX = (p: IconProps) => (
  <Svg size={14} stroke={2.4} {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

/** Award ribbon — the signature completion certificate. */
export const IcoCertificate = (p: IconProps) => (
  <Svg size={14} stroke={2.3} {...p}>
    <circle cx="12" cy="8" r="6" />
    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
  </Svg>
);

export const IcoFolder = (p: IconProps) => (
  <Svg size={15} stroke={2.3} {...p}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </Svg>
);

export const IcoPaperclip = (p: IconProps) => (
  <Svg size={12} stroke={2.3} {...p}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const IcoDownload = (p: IconProps) => (
  <Svg size={13} stroke={2.4} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);

export const IcoMail = (p: IconProps) => (
  <Svg size={13} stroke={2.3} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <polyline points="22 6 12 13 2 6" />
  </Svg>
);

export const IcoSend = (p: IconProps) => (
  <Svg size={13} stroke={2.3} {...p}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Svg>
);

export const IcoChevron = (p: IconProps) => (
  <Svg size={14} stroke={2.6} {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>
);

export const IcoChevronL = (p: IconProps) => (
  <Svg size={13} stroke={2.6} {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>
);

export const IcoChevronR = (p: IconProps) => (
  <Svg size={13} stroke={2.6} {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IcoScales = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18" /><path d="M3 7h18" /><path d="M6 7l-3 7h6z" /><path d="M18 7l-3 7h6z" />
  </Svg>
);

export const IcoEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IcoSearch = (p: IconProps) => (
  <Svg size={16} {...p}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);

export const IcoList = (p: IconProps) => (
  <Svg {...p}>
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const IcoCircleX = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </Svg>
);

export const IcoChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Svg>
);

export const IcoArrowR = (p: IconProps) => (
  <Svg size={13} stroke={2.6} {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </Svg>
);

export const IcoStar = (p: IconProps) => (
  <Svg {...p}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </Svg>
);

/** Circle with a slash — a blocked / declined decision. */
export const IcoBan = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
  </Svg>
);

/** Money coming back: a return arrow around a rupee stroke. */
export const IcoRefund = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M10 9h5M10 12h5M10 9c3 0 3 3 0 3l4 4" />
  </Svg>
);
