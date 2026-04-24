import { useState, useEffect, useRef } from 'react';
import { Card, CardBody, Badge, Button, Spinner, Modal, ModalBody } from 'reactstrap';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Autoplay } from 'swiper/modules';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import Swal from 'sweetalert2';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface Plan {
  id: number; name: string; slug: string; price: number; period: string;
  max_branches: number | null; max_users: number | null; storage_limit: string | null;
  support_level: string | null; is_featured: boolean; badge: string | null;
  color: string | null; description: string | null; best_for: string | null;
  status: string; trial_days: number | null; yearly_discount: number | null;
  is_custom: boolean; clients_count?: number;
  modules?: { id: number; name: string; slug: string; pivot?: { access_level: string } }[];
}

const accessColors: Record<string, string> = {
  limited: 'warning',
  read: 'info',
  write: 'primary',
  full: 'success',
};

const SWIPER_STYLES = `
  .plans-surface {
    background:
      radial-gradient(ellipse at top, rgba(124, 92, 252, 0.05) 0%, transparent 55%),
      #ffffff;
  }
  [data-bs-theme="dark"] .plans-surface {
    background:
      radial-gradient(ellipse at top, rgba(124, 92, 252, 0.10) 0%, transparent 55%),
      radial-gradient(ellipse at bottom right, rgba(16, 185, 129, 0.04) 0%, transparent 55%),
      linear-gradient(180deg, #242d3d 0%, #1d2634 100%);
  }

  /* Give the swiper breathing space above/below the cards so hover-lift
     (translateY) and drop-shadow are NOT clipped by the swiper's own
     overflow:hidden. */
  .plans-swiper {
    padding-top: 16px !important;
    padding-bottom: 36px !important;
  }

  .plans-swiper-outer {
    position: relative;
    padding: 0 56px;
  }
  .plans-nav-btn {
    position: absolute;
    top: calc(50% - 24px);
    transform: translateY(-50%);
    z-index: 10;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid var(--vz-border-color);
    background: var(--vz-card-bg, #fff);
    color: var(--vz-primary);
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(0,0,0,0.10);
    transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s;
    outline: none;
  }
  .plans-nav-btn:hover:not(:disabled) {
    background: var(--vz-primary);
    color: #fff;
    border-color: var(--vz-primary);
    box-shadow: 0 6px 24px rgba(64,81,137,0.35);
    transform: translateY(-50%) scale(1.1);
  }
  .plans-nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .plans-nav-prev { left: 0; }
  .plans-nav-next { right: 0; }
  [data-layout-mode="dark"] .plans-nav-btn,
  [data-bs-theme="dark"] .plans-nav-btn {
    background: var(--vz-card-bg);
    border-color: var(--vz-border-color);
    box-shadow: 0 4px 18px rgba(0,0,0,0.35);
  }
`;

export default function Plans({ onNavigate }: { onNavigate?: (page: string, data?: any) => void }) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const fetchPlans = () => {
    setLoading(true);
    api.get('/plans').then(res => setPlans(res.data || []))
      .catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, []);

  const handleDelete = async (plan: Plan) => {
    const result = await Swal.fire({
      title: 'Delete Plan?',
      html: `Delete <strong>"${plan.name}"</strong> plan?<br/><span style="font-size:12px;opacity:0.75;">This action cannot be undone.</span>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '<i class="ri-delete-bin-line" style="margin-right:4px;"></i> Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#f06548',
      cancelButtonColor: '#878a99',
      width: 360,
      padding: '1.2em 1.2em 1.4em',
      backdrop: 'rgba(15, 23, 42, 0.45)',
      customClass: {
        popup: 'plans-swal-popup',
        title: 'plans-swal-title',
        htmlContainer: 'plans-swal-html',
        confirmButton: 'plans-swal-confirm',
        cancelButton: 'plans-swal-cancel',
        actions: 'plans-swal-actions',
        icon: 'plans-swal-icon',
      },
      buttonsStyling: false,
    });
    if (!result.isConfirmed) return;
    setDeleting(plan.id);
    try {
      await api.delete(`/plans/${plan.id}`);
      Swal.fire({
        title: 'Deleted!',
        text: `"${plan.name}" has been removed.`,
        icon: 'success',
        timer: 1800,
        showConfirmButton: false,
        width: 340,
        padding: '1.2em',
        backdrop: 'rgba(15, 23, 42, 0.45)',
        customClass: { popup: 'plans-swal-popup', title: 'plans-swal-title' },
      });
      fetchPlans();
    } catch (err: any) {
      toast.error('Delete Failed', err.response?.data?.message || 'Cannot delete plan');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <style>{SWIPER_STYLES}</style>
      {/* Shine animation + custom thin scrollbar for module list */}
      <style>{`
        @keyframes plan-shine-sweep {
          0%   { transform: translateX(-120%) skewX(-20deg); opacity: 0; }
          8%   { opacity: 1; }
          35%  { transform: translateX(320%) skewX(-20deg); opacity: 0; }
          100% { transform: translateX(320%) skewX(-20deg); opacity: 0; }
        }

        /* Premium hero animations (mirrors AddPlan preview) */
        @keyframes planlist-mesh {
          0%, 100% { background-position: 0% 0%; }
          50%      { background-position: 100% 100%; }
        }
        @keyframes planlist-pulse-dot {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.25); }
        }
        @keyframes planlist-float-blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(10px, -6px) scale(1.05); }
          66%      { transform: translate(-8px, 4px) scale(0.96); }
        }
        @keyframes planlist-tick-in {
          0%   { opacity: 0; transform: scale(0.4); }
          60%  { transform: scale(1.12); }
          100% { opacity: 1; transform: scale(1); }
        }
        .planlist-tick { animation: planlist-tick-in .35s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

        /* Animated border — a bright gradient sweep travels around the card.
           Uses @property so a CSS custom angle can be animated smoothly. */
        @property --plan-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes plan-border-spin {
          to { --plan-angle: 360deg; }
        }
        .plan-card-animated { position: relative; }
        .plan-card-animated::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 2px;
          background:
            conic-gradient(
              from var(--plan-angle),
              transparent 0deg,
              var(--card-accent, #7c5cfc) 40deg,
              rgba(255, 255, 255, 0.95) 80deg,
              var(--card-accent, #7c5cfc) 120deg,
              transparent 200deg,
              transparent 360deg
            );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: plan-border-spin 3.5s linear infinite;
          pointer-events: none;
          z-index: 5;
          opacity: 0.9;
        }
        /* Dark-mode — the sweep reads a bit brighter and wider */
        [data-bs-theme="dark"] .plan-card-animated::before,
        [data-layout-mode="dark"] .plan-card-animated::before {
          opacity: 1;
          background:
            conic-gradient(
              from var(--plan-angle),
              transparent 0deg,
              var(--card-accent, #7c5cfc) 30deg,
              #ffffff 80deg,
              var(--card-accent, #7c5cfc) 130deg,
              transparent 210deg,
              transparent 360deg
            );
        }
        /* Pause rotation on hover so the user can read the card calmly */
        .plan-card-animated:hover::before { animation-play-state: paused; }

        /* ═══════════════════════════════════════════════════════════════
           Minimal pricing-card design (infographic style)
           Light mode: white card / violet text accents
           Dark mode:  charcoal card / violet accents
           Featured:   ALWAYS solid violet gradient with white content
           ═══════════════════════════════════════════════════════════════ */
        /* Card surface — all cards share one look (deep navy in dark mode,
           clean white in light mode). Featured card is NOT a different
           background — it's signaled by a GREEN accent on icon + price,
           matching the reference infographic. */
        .plan-card-v2 {
          --card-accent: #7c5cfc;
          --accent-price: #0f172a;
          background:
            linear-gradient(180deg, rgba(124, 92, 252, 0.04) 0%, transparent 45%),
            var(--vz-card-bg);
          color: var(--vz-body-color);
          border: 1px solid var(--vz-border-color);
          box-shadow:
            0 16px 36px rgba(15, 23, 42, 0.10),
            0 4px 12px rgba(15, 23, 42, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.80);
          transition: transform .28s cubic-bezier(0.4, 0, 0.2, 1), box-shadow .28s ease;
          padding-top: 20px !important;
          /* Crisp text rendering (HD look) */
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        .plan-card-v2:hover {
          transform: translateY(-6px);
          box-shadow:
            0 24px 54px color-mix(in srgb, var(--card-accent) 28%, transparent),
            0 8px 18px rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.90);
        }
        /* Glossy top highlight removed — text stays perfectly crisp with no overlay */
        /* Dark navy — flat surface for ultra-crisp text */
        [data-bs-theme="dark"] .plan-card-v2,
        [data-layout-mode="dark"] .plan-card-v2 {
          background: #232d3f;
          border-color: rgba(255, 255, 255, 0.10);
          color: rgba(255, 255, 255, 0.92);
          box-shadow:
            0 18px 44px rgba(0, 0, 0, 0.50),
            0 6px 14px rgba(0, 0, 0, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.07);
          --accent-price: #fff;
        }
        [data-bs-theme="dark"] .plan-card-v2:hover,
        [data-layout-mode="dark"] .plan-card-v2:hover {
          box-shadow:
            0 28px 62px rgba(0, 0, 0, 0.60),
            0 10px 22px color-mix(in srgb, var(--card-accent) 28%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
        }
        /* Featured — green accent overlay */
        .plan-card-v2.is-featured {
          --card-accent: #10b981;
          --accent-price: #10b981;
          background:
            linear-gradient(180deg, rgba(16, 185, 129, 0.06) 0%, transparent 45%),
            var(--vz-card-bg);
          box-shadow:
            0 16px 40px rgba(16, 185, 129, 0.22),
            0 6px 14px rgba(15, 23, 42, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.85);
          border-color: color-mix(in srgb, #10b981 30%, transparent);
        }
        .plan-card-v2.is-featured:hover {
          box-shadow:
            0 24px 56px rgba(16, 185, 129, 0.36),
            0 8px 22px rgba(15, 23, 42, 0.10),
            inset 0 1px 0 rgba(255, 255, 255, 0.90);
        }
        [data-bs-theme="dark"] .plan-card-v2.is-featured,
        [data-layout-mode="dark"] .plan-card-v2.is-featured {
          background: #232d3f;
          border-color: rgba(16, 185, 129, 0.40);
          --accent-price: #34d399;
          box-shadow:
            0 22px 52px rgba(16, 185, 129, 0.30),
            0 8px 22px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.09);
        }

        /* ── Floating icon chip at top-center ── */
        .plan-icon-chip {
          position: absolute;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--card-accent) 14%, transparent);
          border: 2px solid color-mix(in srgb, var(--card-accent) 40%, transparent);
          z-index: 3;
          transition: transform .3s ease, box-shadow .3s ease;
        }
        .plan-icon-chip i {
          font-size: 22px;
          color: var(--card-accent);
        }
        [data-bs-theme="dark"] .plan-icon-chip,
        [data-layout-mode="dark"] .plan-icon-chip {
          background: color-mix(in srgb, var(--card-accent) 18%, transparent);
          border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
          box-shadow: 0 0 24px color-mix(in srgb, var(--card-accent) 35%, transparent);
        }
        .plan-card-v2:hover .plan-icon-chip { transform: translateX(-50%) scale(1.08); }

        /* ── Plan-name pill (uppercase, small) ── */
        .plan-name-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 14px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--card-accent) 14%, transparent);
          color: var(--card-accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border: 1px solid color-mix(in srgb, var(--card-accent) 28%, transparent);
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-name-pill,
        [data-layout-mode="dark"] .plan-card-v2 .plan-name-pill {
          background: color-mix(in srgb, var(--card-accent) 22%, transparent);
          border-color: color-mix(in srgb, var(--card-accent) 45%, transparent);
          color: color-mix(in srgb, var(--card-accent) 70%, #fff);
        }

        /* Status / Popular badge pill */
        .plan-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--card-accent) 15%, transparent);
          color: var(--card-accent);
          font-size: 8.5px;
          font-weight: 800;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          border: 1px solid color-mix(in srgb, var(--card-accent) 28%, transparent);
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-badge-pill,
        [data-layout-mode="dark"] .plan-card-v2 .plan-badge-pill {
          background: color-mix(in srgb, var(--card-accent) 22%, transparent);
          border-color: color-mix(in srgb, var(--card-accent) 42%, transparent);
          color: color-mix(in srgb, var(--card-accent) 60%, #fff);
        }

        /* Subtitle */
        .plan-subtitle {
          font-size: 12px;
          line-height: 1.45;
          color: var(--vz-secondary-color);
          margin: 2px 0 14px;
          font-weight: 500;
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-subtitle,
        [data-layout-mode="dark"] .plan-card-v2 .plan-subtitle {
          color: rgba(255, 255, 255, 0.75);
        }

        /* ── Price ── */
        .plan-price {
          font-size: 2.4rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          line-height: 1;
          color: var(--accent-price);
          display: inline-flex;
          align-items: baseline;
          gap: 2px;
          font-variant-numeric: tabular-nums;
        }
        .plan-price .cur { font-size: 1rem; font-weight: 500; opacity: 0.65; }
        .plan-card-v2.is-featured .plan-price { /* green accent handled by --accent-price */ }

        .plan-price-meta {
          font-size: 9.5px;
          line-height: 1.3;
          color: var(--vz-secondary-color);
          text-transform: capitalize;
          font-weight: 600;
          padding-bottom: 4px;
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-price-meta,
        [data-layout-mode="dark"] .plan-card-v2 .plan-price-meta { color: rgba(255, 255, 255, 0.55); }

        /* Divider */
        .plan-divider {
          border: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--vz-border-color), transparent);
          margin: 14px 0 12px;
        }
        [data-bs-theme="dark"] .plan-divider,
        [data-layout-mode="dark"] .plan-divider {
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.10), transparent);
        }

        /* ── Tick list with circular check ── */
        .plan-ticks {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          flex: 1 1 0;
          min-height: 0;
        }
        .plan-ticks li {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          line-height: 1.35;
          color: var(--vz-body-color);
          font-weight: 500;
        }
        .plan-ticks li strong {
          font-weight: 700;
          color: var(--vz-heading-color, var(--vz-body-color));
          margin-right: 2px;
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-ticks li,
        [data-layout-mode="dark"] .plan-card-v2 .plan-ticks li { color: rgba(255, 255, 255, 0.94); }
        [data-bs-theme="dark"] .plan-card-v2 .plan-ticks li strong,
        [data-layout-mode="dark"] .plan-card-v2 .plan-ticks li strong { color: #fff; }

        /* Circular / line check icon — crisp, no blur */
        .plan-ticks li > i.ri-check-line,
        .plan-ticks li > i.ri-checkbox-circle-fill {
          font-size: 15px;
          font-weight: 700;
          color: #0ab39c;
          flex-shrink: 0;
        }

        /* Scrollbar */
        .plan-ticks::-webkit-scrollbar { width: 4px; }
        .plan-ticks::-webkit-scrollbar-track { background: transparent; }
        .plan-ticks::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--card-accent) 25%, transparent);
          border-radius: 4px;
        }

        /* ── CTA button: violet pill with icon chip on the left ── */
        .plan-cta {
          flex: 1;
          border: none;
          border-radius: 999px;
          padding: 8px 20px 8px 8px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease;
          background: linear-gradient(135deg, #7c5cfc 0%, #6366f1 100%);
          color: #fff;
          box-shadow: 0 6px 18px rgba(124, 92, 252, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }
        .plan-cta:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 24px rgba(124, 92, 252, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.30);
        }
        /* Icon chip on the left of the button */
        .plan-cta-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px; height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
          flex-shrink: 0;
          transition: transform .18s ease, background .18s ease;
        }
        .plan-cta:hover .plan-cta-icon { background: rgba(255, 255, 255, 0.32); transform: rotate(12deg); }
        .plan-cta .plan-cta-label { flex: 1; text-align: center; padding-right: 4px; }

        /* Limited-time offer tag below CTA for featured cards */
        .plan-limited-tag {
          text-align: center;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #10b981;
          margin-top: 8px;
          opacity: 0.85;
        }

        /* ── Plan title + price row (centered top block) ── */
        .plan-title {
          font-size: 19px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--vz-heading-color, var(--vz-body-color));
          margin: 0;
          line-height: 1.1;
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-title,
        [data-layout-mode="dark"] .plan-card-v2 .plan-title { color: #fff; }

        /* Period suffix right after the price */
        .plan-price-period {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--vz-secondary-color);
          letter-spacing: 0;
          text-transform: lowercase;
          margin-left: 2px;
        }
        [data-bs-theme="dark"] .plan-card-v2 .plan-price-period,
        [data-layout-mode="dark"] .plan-card-v2 .plan-price-period { color: rgba(255, 255, 255, 0.55); }

        /* ── 2×2 stat boxes ── */
        .plan-stat-box {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 11px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--card-accent) 6%, transparent);
          border: 1px solid color-mix(in srgb, var(--card-accent) 14%, transparent);
          transition: transform .18s ease, border-color .18s ease;
        }
        .plan-stat-box:hover {
          transform: translateY(-1px);
          border-color: color-mix(in srgb, var(--card-accent) 32%, transparent);
        }
        [data-bs-theme="dark"] .plan-stat-box,
        [data-layout-mode="dark"] .plan-stat-box {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.08);
        }
        [data-bs-theme="dark"] .plan-stat-box:hover,
        [data-layout-mode="dark"] .plan-stat-box:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: color-mix(in srgb, var(--card-accent) 45%, transparent);
        }
        .plan-stat-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--card-accent) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--card-accent) 22%, transparent);
          color: var(--card-accent);
          flex-shrink: 0;
        }
        [data-bs-theme="dark"] .plan-stat-icon,
        [data-layout-mode="dark"] .plan-stat-icon {
          background: color-mix(in srgb, var(--card-accent) 22%, transparent);
          border-color: color-mix(in srgb, var(--card-accent) 40%, transparent);
          color: color-mix(in srgb, var(--card-accent) 65%, #fff);
        }
        .plan-stat-icon i { font-size: 15px; }
        .plan-stat-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vz-secondary-color);
          line-height: 1;
        }
        [data-bs-theme="dark"] .plan-stat-label,
        [data-layout-mode="dark"] .plan-stat-label { color: rgba(255, 255, 255, 0.72); }
        .plan-stat-value {
          font-size: 14.5px;
          font-weight: 800;
          color: var(--vz-heading-color, var(--vz-body-color));
          margin-top: 4px;
          line-height: 1;
          letter-spacing: -0.01em;
        }
        [data-bs-theme="dark"] .plan-stat-value,
        [data-layout-mode="dark"] .plan-stat-value { color: #fff; }

        /* ── Included Modules section header ── */
        .plan-modules-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .plan-modules-title {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vz-secondary-color);
        }
        [data-bs-theme="dark"] .plan-modules-title,
        [data-layout-mode="dark"] .plan-modules-title { color: rgba(255, 255, 255, 0.72); }
        .plan-modules-title i { font-size: 13px; color: var(--card-accent); }
        .plan-modules-count-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 11px;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--card-accent), color-mix(in srgb, var(--card-accent) 70%, #fff));
          color: #fff;
          font-size: 10.5px;
          font-weight: 800;
          border: none;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--card-accent) 45%, transparent);
          cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .plan-modules-count-pill:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px color-mix(in srgb, var(--card-accent) 60%, transparent);
        }

        /* Delete button */
        .plan-delete-btn {
          width: 40px; height: 40px;
          padding: 0;
          border-radius: 50%;
          flex-shrink: 0;
          background: transparent;
          color: #f06548;
          border: 1.5px solid rgba(240, 101, 72, 0.45);
          cursor: pointer;
          transition: all .18s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .plan-delete-btn:hover:not(:disabled) {
          background: #f06548;
          color: #fff;
          border-color: #f06548;
        }
        .plan-card-v2.is-featured .plan-delete-btn {
          color: rgba(255, 255, 255, 0.92);
          border-color: rgba(255, 255, 255, 0.45);
        }
        .plan-card-v2.is-featured .plan-delete-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
          border-color: rgba(255, 255, 255, 0.65);
        }

        /* Modules-count chip — shown when there are modules beyond limits */
        .plan-view-all {
          background: transparent;
          border: none;
          color: inherit;
          opacity: 0.72;
          font-size: 10.5px;
          font-weight: 600;
          text-decoration: none;
          padding: 4px 0;
          cursor: pointer;
        }
        .plan-view-all:hover { opacity: 1; text-decoration: underline; }

        /* Stat box — uses --stat-c CSS var set inline per box.
           color-mix() gives us tint / border / shadow that respect dark vs light. */
        .planlist-stat {
          --stat-c: #7c5cfc;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--stat-c) 12%, transparent) 0%, color-mix(in srgb, var(--stat-c) 4%, transparent) 55%, transparent 100%),
            var(--vz-card-bg);
          border: 1px solid color-mix(in srgb, var(--stat-c) 28%, transparent);
          box-shadow:
            0 2px 6px color-mix(in srgb, var(--stat-c) 14%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        }
        .planlist-stat:hover {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--stat-c) 50%, transparent);
          box-shadow:
            0 6px 14px color-mix(in srgb, var(--stat-c) 24%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.60);
        }
        /* Dark mode — stronger tint so the box reads clearly on dark card-bg,
           and a subtle inner highlight instead of the bright white one. */
        [data-bs-theme="dark"] .planlist-stat,
        [data-layout-mode="dark"] .planlist-stat {
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--stat-c) 26%, transparent) 0%, color-mix(in srgb, var(--stat-c) 10%, transparent) 55%, transparent 100%),
            #1f2935;
          border: 1px solid color-mix(in srgb, var(--stat-c) 40%, transparent);
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        [data-bs-theme="dark"] .planlist-stat:hover,
        [data-layout-mode="dark"] .planlist-stat:hover {
          border-color: color-mix(in srgb, var(--stat-c) 60%, transparent);
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.45),
            0 0 0 1px color-mix(in srgb, var(--stat-c) 35%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        /* Slim custom scrollbar for modules list */
        .plan-modules-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(124, 92, 252, 0.25) transparent;
        }
        .plan-modules-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .plan-modules-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .plan-modules-scroll::-webkit-scrollbar-thumb {
          background: rgba(124, 92, 252, 0.22);
          border-radius: 4px;
          transition: background 0.2s ease;
        }
        .plan-modules-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(124, 92, 252, 0.45);
        }
        /* Dark card scrollbar — slightly brighter for contrast */
        .plan-modules-scroll.plan-scroll-dark {
          scrollbar-color: rgba(247, 184, 75, 0.30) transparent;
        }
        .plan-modules-scroll.plan-scroll-dark::-webkit-scrollbar-thumb {
          background: rgba(247, 184, 75, 0.28);
        }
        .plan-modules-scroll.plan-scroll-dark::-webkit-scrollbar-thumb:hover {
          background: rgba(247, 184, 75, 0.50);
        }

        /* ── Compact Delete Confirmation Popup ── */
        .swal2-container.swal2-backdrop-show {
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }
        .plans-swal-popup {
          border-radius: 16px !important;
          box-shadow: 0 24px 60px rgba(15,23,42,0.25), 0 8px 20px rgba(15,23,42,0.12) !important;
          border: 1px solid rgba(15,23,42,0.08) !important;
        }
        .plans-swal-icon {
          width: 56px !important;
          height: 56px !important;
          margin: 0 auto 0.6em !important;
          border-width: 2px !important;
        }
        .plans-swal-icon .swal2-icon-content {
          font-size: 2rem !important;
        }
        .plans-swal-title {
          font-size: 16px !important;
          font-weight: 700 !important;
          letter-spacing: -0.01em !important;
          margin: 0 0 0.4em !important;
          padding: 0 !important;
        }
        .plans-swal-html {
          font-size: 13px !important;
          line-height: 1.5 !important;
          margin: 0 0 0.6em !important;
        }
        .plans-swal-actions {
          gap: 8px !important;
          margin-top: 0.8em !important;
          width: 100%;
          padding: 0 4px;
        }
        .plans-swal-confirm,
        .plans-swal-cancel {
          border: none !important;
          border-radius: 999px !important;
          padding: 8px 18px !important;
          font-size: 12.5px !important;
          font-weight: 600 !important;
          letter-spacing: 0.01em !important;
          cursor: pointer !important;
          transition: all 0.18s ease !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 4px !important;
        }
        .plans-swal-confirm {
          background: linear-gradient(135deg, #f06548, #ef4444) !important;
          color: #fff !important;
          box-shadow: 0 4px 14px rgba(240,101,72,0.40), inset 0 1px 0 rgba(255,255,255,0.22) !important;
        }
        .plans-swal-confirm:hover {
          box-shadow: 0 8px 20px rgba(240,101,72,0.55), inset 0 1px 0 rgba(255,255,255,0.30) !important;
          transform: translateY(-1px) !important;
        }
        .plans-swal-cancel {
          background: var(--vz-secondary-bg, #f3f4f6) !important;
          color: var(--vz-body-color, #374151) !important;
          border: 1px solid var(--vz-border-color, #e5e7eb) !important;
        }
        .plans-swal-cancel:hover {
          background: var(--vz-border-color, #e5e7eb) !important;
        }
      `}</style>

      <div
        className="plans-surface"
        style={{
          borderRadius: 16,
          border: '1px solid var(--vz-border-color)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          padding: '20px',
        }}
      >
        {/* ── Compact Page Header ── */}
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3 pb-2">
          <div className="d-flex align-items-center gap-2">
            <div
              className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
              style={{
                width: 36, height: 36,
                background: '#40518918',
                border: '1px solid #40518928',
              }}
            >
              <i className="ri-bank-card-line" style={{ color: '#405189', fontSize: 17 }} />
            </div>
            <div>
              <h5 className="mb-0 fw-bold" style={{ fontSize: 15, letterSpacing: '-0.01em' }}>Subscription Plans</h5>
              <p className="mb-0 text-muted" style={{ fontSize: 11.5 }}>
                Manage pricing, limits and features ·{' '}
                <span style={{ color: '#405189', fontWeight: 700 }}>{plans.length}</span> plans
              </p>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            
            <Button
              color="secondary"
              className="btn-label waves-effect waves-light rounded-pill"
              onClick={() => onNavigate?.('add-plan')}
            >
              <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
              Add Plan
            </Button>
          </div>
        </div>

      {loading ? (
        <div className="text-center py-3"><Spinner color="primary" /></div>
      ) : plans.length === 0 ? (
        <Card>
          <CardBody className="text-center py-5">
            <i className="ri-bank-card-line display-4 text-muted"></i>
            <p className="mt-3 text-muted">No plans yet. Click "Add Plan" to create your first plan.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="plans-swiper-outer">
          <button ref={prevRef} className="plans-nav-btn plans-nav-prev" aria-label="Previous">
            <i className="ri-arrow-left-s-line"></i>
          </button>

          <Swiper
            modules={[Navigation, Pagination, Autoplay]}
            onBeforeInit={(swiper) => {
              if (typeof swiper.params.navigation === 'object' && swiper.params.navigation) {
                (swiper.params.navigation as any).prevEl = prevRef.current;
                (swiper.params.navigation as any).nextEl = nextRef.current;
              }
            }}
            navigation={{ prevEl: prevRef.current, nextEl: nextRef.current }}
            pagination={{ clickable: true, dynamicBullets: true }}
            loop={plans.length > 1}
            autoplay={{ delay: 2000, disableOnInteraction: false, pauseOnMouseEnter: true }}
            breakpoints={{
              0:    { slidesPerView: 1, spaceBetween: 12 },
              576:  { slidesPerView: 2, spaceBetween: 14 },
              992:  { slidesPerView: 3, spaceBetween: 18 },
              1400: { slidesPerView: 4, spaceBetween: 20 },
            }}
            className="plans-swiper pb-5"
          >
          {plans.map((p) => {
            const modules = p.modules || [];
            const moduleCount = modules.length;
            const periodShort = p.period === 'month' ? 'mo' : p.period === 'quarter' ? 'qtr' : p.period === 'year' ? 'yr' : p.period;
            const stats = [
              { l: 'Branches', v: (p.max_branches  ?? '∞') as string | number, ic: 'ri-git-branch-line'   },
              { l: 'Users',    v: (p.max_users     ?? '∞') as string | number, ic: 'ri-user-3-line'       },
              { l: 'Storage',  v: p.storage_limit || '∞',                      ic: 'ri-hard-drive-2-line' },
              { l: 'Support',  v: p.support_level || '—',                      ic: 'ri-headphone-line'    },
            ];
            // Tick list only has modules + perks now (stats moved to boxes above)
            const ticks: { label: string; sub?: string }[] = [
              ...modules.map(m => ({
                label: m.name,
                sub: m.pivot?.access_level && m.pivot.access_level !== 'full' ? m.pivot.access_level : undefined,
              })),
              ...(p.trial_days && p.trial_days > 0 ? [{ label: `${p.trial_days}-day free trial` }] : []),
              ...(p.yearly_discount && p.yearly_discount > 0 ? [{ label: `${p.yearly_discount}% yearly discount` }] : []),
            ];
            return (
              <SwiperSlide key={p.id} style={{ height: 'auto' }}>
                <Card
                  className={`w-100 mb-0 position-relative d-flex flex-column plan-card-animated plan-card-v2 ${p.is_featured ? 'is-featured' : ''}`}
                  style={{
                    height: 560,
                    borderRadius: 20,
                    padding: '22px 22px 18px',
                    overflow: 'hidden',
                    textAlign: 'center',
                  }}
                >
                  {/* ── Header: Title + Price + Subtitle ── */}
                  <div className="text-center position-relative" style={{ zIndex: 2 }}>
                    <h4 className="plan-title mb-2">{p.name}</h4>
                    <div className="d-inline-flex align-items-baseline justify-content-center gap-1">
                      {p.price <= 0 ? (
                        <div className="plan-price">Free</div>
                      ) : (
                        <>
                          <div className="plan-price">
                            <span className="cur">₹</span>
                            {p.price.toLocaleString()}
                          </div>
                          <span className="plan-price-period">/ {periodShort}</span>
                        </>
                      )}
                    </div>
                    {p.best_for && (
                      <p className="plan-subtitle mt-2 mb-0">{p.best_for}</p>
                    )}
                  </div>

                  {/* ── 2×2 Stat grid ── */}
                  <div className="row g-2 mt-3 position-relative" style={{ zIndex: 2 }}>
                    {stats.map(s => (
                      <div className="col-6" key={s.l}>
                        <div className="plan-stat-box">
                          <div className="plan-stat-icon">
                            <i className={s.ic} />
                          </div>
                          <div className="text-start min-w-0">
                            <div className="plan-stat-label">{s.l}</div>
                            <div className="plan-stat-value text-truncate" title={String(s.v)}>{s.v}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Included Modules section ── */}
                  <div className="mt-3 d-flex flex-column position-relative" style={{ zIndex: 2, flex: '1 1 0', minHeight: 0 }}>
                    <div className="plan-modules-header">
                      <span className="plan-modules-title">
                        <i className="ri-stack-line" />
                        Included Modules
                      </span>
                      <button
                        type="button"
                        className="plan-modules-count-pill"
                        onClick={() => setModalPlan(p)}
                        title="View all"
                      >
                        {moduleCount}
                      </button>
                    </div>

                    {ticks.length > 0 ? (
                      <ul className="plan-ticks text-start">
                        {ticks.map((t, i) => (
                          <li key={i} className="planlist-tick" style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }} title={t.label}>
                            <i className="ri-check-line" />
                            <span className="text-truncate flex-grow-1">
                              {t.label}
                              {t.sub && <span className="opacity-75 ms-1" style={{ fontSize: 10 }}>({t.sub})</span>}
                            </span>
                          </li>
                        ))}
                        {p.clients_count !== undefined && p.clients_count > 0 && (
                          <li style={{ opacity: 0.72 }}>
                            <i className="ri-user-3-line" style={{ fontSize: 13, color: 'inherit' }} />
                            <span className="text-truncate flex-grow-1">
                              {p.clients_count} active client{p.clients_count !== 1 ? 's' : ''}
                            </span>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <div className="text-center py-3 flex-grow-1 d-flex flex-column align-items-center justify-content-center">
                        <p className="text-muted mb-0" style={{ fontSize: 11 }}>No modules included</p>
                      </div>
                    )}
                  </div>

                  {/* ── Actions row ── */}
                  <div className="d-flex gap-2 pt-3 mt-auto position-relative" style={{ zIndex: 2 }}>
                    <button
                      type="button"
                      onClick={() => onNavigate?.('add-plan', { editId: p.id })}
                      className="plan-cta"
                    >
                      <span className="plan-cta-icon">
                        <i className="ri-pencil-line" style={{ fontSize: 14 }} />
                      </span>
                      <span className="plan-cta-label">Edit Plan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      disabled={deleting === p.id}
                      className="plan-delete-btn"
                    >
                      {deleting === p.id ? <Spinner size="sm" /> : <i className="ri-delete-bin-5-line" />}
                    </button>
                  </div>

                  {/* Limited-time / Popular tag for featured */}
                  {p.is_featured && (
                    <div className="plan-limited-tag position-relative" style={{ zIndex: 2 }}>
                      — {p.badge || 'Most popular plan'} —
                    </div>
                  )}
                </Card>
              </SwiperSlide>
            );
          })}
          </Swiper>

          <button ref={nextRef} className="plans-nav-btn plans-nav-next" aria-label="Next">
            <i className="ri-arrow-right-s-line"></i>
          </button>
        </div>
        )}
      </div>

      {/* ── Premium Modules Detail Modal ── */}
      <Modal
        isOpen={!!modalPlan}
        toggle={() => setModalPlan(null)}
        size="lg"
        centered
        scrollable
        contentClassName="border-0 overflow-hidden"
        style={{ borderRadius: 16 }}
      >
        <div
          className="position-relative text-white px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, #0b1324 0%, #1e2a4a 50%, #2d4373 100%)',
          }}
        >
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{
              backgroundImage: 'radial-gradient(circle at 15% 20%, rgba(102,145,231,0.22) 0%, transparent 42%), radial-gradient(circle at 85% 85%, rgba(10,179,156,0.14) 0%, transparent 48%)',
              pointerEvents: 'none',
            }}
          />
          <div className="position-relative d-flex align-items-center justify-content-between gap-2">
            <div className="d-flex align-items-center gap-2">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                style={{
                  width: 40, height: 40,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))',
                  border: '1px solid rgba(255,255,255,0.22)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <i className="ri-apps-2-line" style={{ color: '#fff', fontSize: 18 }} />
              </div>
              <div>
                <h5 className="text-white mb-0 fw-bold" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
                  {modalPlan?.name}
                </h5>
                <div className="d-inline-flex align-items-center gap-1 mt-1" style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11.5 }}>
                  <i className="ri-checkbox-multiple-line" />
                  <span className="fw-semibold" style={{ color: '#fff' }}>{modalPlan?.modules?.length}</span>
                  modules included
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModalPlan(null)}
              className="btn p-0 d-inline-flex align-items-center justify-content-center rounded-circle"
              style={{
                width: 32, height: 32,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                color: '#fff',
              }}
              aria-label="Close"
            >
              <i className="ri-close-line" style={{ fontSize: 16 }} />
            </button>
          </div>
        </div>

        <ModalBody className="p-3" style={{ background: 'var(--vz-card-bg)' }}>
          {modalPlan?.modules && modalPlan.modules.length > 0 ? (
            <>
              <p className="mb-3" style={{ color: 'var(--vz-secondary-color)', fontSize: 12.5 }}>
                All modules available in the <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{modalPlan.name}</strong> plan.
              </p>
              <div className="row gx-2 gy-2">
                {modalPlan.modules.map(m => (
                  <div key={m.id} className="col-md-4 col-sm-6" title={m.name}>
                    <div
                      className="d-flex align-items-center gap-2 px-2 py-2 rounded-2"
                      style={{
                        background: 'var(--vz-secondary-bg)',
                        border: '1px solid var(--vz-border-color)',
                        transition: 'background .15s ease, border-color .15s ease',
                        minHeight: 40,
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.background = '#0ab39c10';
                        (e.currentTarget as HTMLDivElement).style.borderColor = '#0ab39c50';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.background = 'var(--vz-secondary-bg)';
                        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--vz-border-color)';
                      }}
                    >
                      <span
                        className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{
                          width: 20, height: 20,
                          background: m.pivot?.access_level === 'limited' ? '#f7b84b' : '#0ab39c',
                          boxShadow: `0 2px 4px ${m.pivot?.access_level === 'limited' ? 'rgba(247,184,75,0.25)' : 'rgba(10,179,156,0.25)'}`,
                        }}
                      >
                        <i className="ri-check-line" style={{ color: '#fff', fontSize: 12, fontWeight: 700 }} />
                      </span>
                      <span
                        className="fw-medium text-truncate flex-grow-1"
                        style={{
                          fontSize: 12.5,
                          color: 'var(--vz-heading-color, var(--vz-body-color))',
                          minWidth: 0,
                        }}
                      >
                        {m.name}
                      </span>
                      {m.pivot?.access_level && m.pivot.access_level !== 'full' && (
                        <Badge
                          color={accessColors[m.pivot.access_level] || 'secondary'}
                          className="flex-shrink-0 text-capitalize"
                          style={{ fontSize: '9.5px' }}
                        >
                          {m.pivot.access_level}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="mt-3 px-3 py-2 rounded-2 d-flex align-items-center gap-2"
                style={{
                  background: '#40518910',
                  border: '1px solid #40518930',
                  borderLeft: '3px solid #405189',
                }}
              >
                <i className="ri-information-line" style={{ color: '#405189', fontSize: 16 }} />
                <span style={{ fontSize: 11.5, color: 'var(--vz-body-color)' }}>
                  Access levels: <strong>full</strong> complete access · <strong>limited</strong> restricted · <strong>read</strong> view only · <strong>write</strong> edit only
                </span>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <div
                className="d-inline-flex align-items-center justify-content-center rounded-circle mb-2"
                style={{ width: 52, height: 52, background: '#f7b84b18', border: '1px solid #f7b84b30' }}
              >
                <i className="ri-apps-2-line" style={{ color: '#f7b84b', fontSize: 24 }} />
              </div>
              <p className="mb-0 fs-13" style={{ color: 'var(--vz-secondary-color)' }}>No modules assigned to this plan.</p>
            </div>
          )}
        </ModalBody>
      </Modal>
    </>
  );
}
