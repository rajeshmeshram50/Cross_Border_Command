// Shared, stateless presentational helpers for the Employee Profile screen.
// Extracted from EmployeeProfile.tsx so the per-tab files can reuse them
// without dragging the 6k-line parent along. Nothing here touches the
// profile's state — they're pure UI given props.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, Col, Row } from 'reactstrap';

// Custom portal-based modal — renders directly to document.body so it always
// escapes the .ep-fullscreen-overlay stacking context. Reactstrap's Modal had
// timing issues with our z-index overrides on first open; this is bulletproof.
export function EpModal({ open, onClose, size = 'md', children, dismissOnBackdrop = false, panelClassName }: {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  dismissOnBackdrop?: boolean;
  panelClassName?: string;
}) {
  if (!open) return null;
  const widths = { sm: 420, md: 600, lg: 900, xl: 1180 };
  return createPortal(
    <div
      className="ep-modal-overlay"
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        className={`ep-modal-card ${panelClassName || ''}`}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%',
          maxWidth: widths[size],
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--vz-border-color)',
  boxShadow: '0 4px 24px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  background: 'var(--vz-card-bg)',
  overflow: 'hidden',
  position: 'relative',
  transition: 'transform .25s ease, box-shadow .25s ease',
};

// Section card wrapper — adds a top gradient strip and a hover lift to any
// content card. The gradient is the same colour family as the section header
// icon, so each section has a distinct visual identity (Personal=indigo,
// Contact=blue, Address=green, etc.).
export function SectionCard({ gradient, children, className }: { gradient: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`ep-section-card mb-0 ${className || ''}`} style={cardStyle}>
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: gradient, zIndex: 1,
        }}
      />
      {children}
    </Card>
  );
}

export function SectionHeader({ title, gradient, icon, action, subtitle }: { title: string; gradient: string; icon: string; action?: React.ReactNode; subtitle?: string }) {
  return (
    <div className="d-flex align-items-center gap-3 mb-3 pb-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
        style={{ width: 40, height: 40, background: gradient, boxShadow: '0 6px 14px rgba(64,81,137,0.22)' }}
      >
        <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
      </span>
      <div className="flex-grow-1 min-w-0">
        <h5 className="card-title mb-0">{title}</h5>
        {subtitle && <small className="text-muted">{subtitle}</small>}
      </div>
      {action}
    </div>
  );
}

// Single label / value field — rendered as a clean key/value row with a small
// colored accent dot. The accent dot's color comes from the parent section so
// every field nests visually under its section header.
export function Field({ label, value, span = 6, accent = '#6366f1' }: { label: string; value?: React.ReactNode; span?: number; accent?: string }) {
  return (
    <Col md={span as any} className="mb-3">
      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 0 3px ${accent}22`, flexShrink: 0 }} />
        <p className="mb-0 fs-11 text-uppercase fw-bold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.08em' }}>
          {label}
        </p>
      </div>
      <div className="fs-14 fw-bold ps-3" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.4 }}>
        {value || <span className="text-muted fw-normal">—</span>}
      </div>
    </Col>
  );
}

export function MiniInfo({ icon, label, value, gradient }: { icon: string; label: string; value: React.ReactNode; gradient: string }) {
  return (
    <div
      className="d-flex align-items-center p-3 h-100"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))',
        border: '1px solid var(--vz-border-color)',
      }}
    >
      <div className="flex-shrink-0 me-3">
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle"
          style={{ width: 40, height: 40, background: gradient, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}
        >
          <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
        </span>
      </div>
      <div className="flex-grow-1 overflow-hidden">
        <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>
          {label}
        </p>
        <h6 className="text-truncate mb-0">{value || '—'}</h6>
      </div>
    </div>
  );
}

// Count-up number animation — mirrors the AnimatedNumber recipe used on the
// admin/client/branch dashboards so KPI tiles feel consistent across the app.
export function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1200;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step || 1);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

// Generic KPI tile — same recipe as the admin/client/branch dashboard
// `KpiCard` so every tile across the app reads consistently. The `tint` prop
// is accepted for backwards compatibility but ignored; the card always uses
// var(--vz-card-bg) and the gradient lives on the top strip + icon tile.
export function KpiTile({ label, value, sub, icon, gradient }: { label: string; value: React.ReactNode; sub?: string; icon: string; gradient: string; tint?: string }) {
  return (
    <div
      className="ep-kpi-tile dashboard-surface"
      style={{
        borderRadius: 12,
        padding: '12px 14px 10px',
        boxShadow: '0 2px 14px rgba(0,0,0,0.05)',
        border: '1px solid var(--vz-border-color)',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        background: '#ffffff',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        cursor: 'default',
      }}
    >
      {/* Gradient top strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            {label}
          </p>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
            {value}
          </h3>
          {sub && <small className="text-muted d-block" style={{ fontSize: 10.5, marginTop: 4 }}>{sub}</small>}
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          boxShadow: '0 3px 8px rgba(0,0,0,0.10)',
        }}>
          <i className={icon} style={{ fontSize: 16, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}
