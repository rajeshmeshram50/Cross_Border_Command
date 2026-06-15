import { useMemo, useState } from 'react';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import {
  WS_ROWS, WOS_ROWS, BUYERS, CONSIGNEES, SUPPLIERS, CTC, ATA_CLARIFICATIONS,
  WOS_SUPPLIERS, WOS_OFFSET, DOC_KEYS, docDone,
  BUYER_OVERVIEW, CONSIGNEE_OVERVIEW, SUPPLIER_OVERVIEW,
  type WsRow, type DocProg, type DocKey, type WosScope, type PartyOverview,
} from './clmAnalyticsData';

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Analytics — faithful port of the `rAnalytics()` view from the CLM_(28)
 * prototype. Cyan-themed dashboard with:
 *   · header strip + 4 live stat chips (compliance / active / pending / expiring)
 *   · Key Performance Indicators — 6 ring KPI heroes
 *   · 3 sub-tabs (With Shipment ID / Without Shipment ID / Case to Case)
 *   · With-Shipment view: Buyer/Consignee/Supplier scope toggle, 7 click-to-
 *     filter metric cards, and the paginated shipment-transactions table.
 *
 * Surfaces/text route through useOpsTheme('cyan') for dark-mode parity; the
 * vibrant cyan gradients, badges and icons are kept verbatim (they read on
 * either background, matching the sibling Operations pages).
 * ───────────────────────────────────────────────────────────────────────── */

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const pad3 = (n: number) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;

type OvSub = 'ws' | 'wos' | 'c2c';
type WsScope = 'buyer' | 'consignee' | 'supplier';
type WsFilter = 'total' | 'compliant' | DocKey;
type ChipKey = 'compliance' | 'active' | 'pending' | 'expiring';

// ── small svg helper ────────────────────────────────────────────────────────
const Svg = ({ d, size = 15, stroke = '#fff', w = 2.3 }: { d: string; size?: number; stroke?: string; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={w}
    strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);

// Lucide-style icon path-sets reused from the prototype.
const ICON = {
  chart: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/>',
  compliance: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  active: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  pending: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  expiring: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  bars: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="0" y1="20" x2="24" y2="20"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  rows: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  // metric-card icons
  ship: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  ok: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  kyc: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  dd: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  tl: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>',
  td: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>',
  agr: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 18 15 15"/>',
  // KPI hero icons
  kpiWs: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  kpiWos: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
  kpiC2c: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/>',
  kpiBuyers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  kpiCons: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  kpiSup: '<path d="M20 7h-3V4a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v12h2"/><circle cx="7" cy="18" r="2"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><path d="M15 8h4l3 4v4h-3"/>',
};

// ── header stat chip ─────────────────────────────────────────────────────────
function StatChip({ icon, label, value, c1, c2, onClick, dark }:
  { icon: string; label: string; value: string; c1: string; c2: string; onClick: () => void; dark: boolean }) {
  return (
    <div onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, background: dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.62)', border: `1px solid ${dark ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.85)'}`, borderRadius: 12, padding: '7px 13px 7px 9px', boxShadow: '0 2px 8px rgba(8,145,178,.1)', backdropFilter: 'blur(4px)', cursor: 'pointer', transition: 'transform .15s,box-shadow .15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(8,145,178,.2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(8,145,178,.1)'; }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 7px ${c1}55` }}>
        <Svg d={icon} size={15} />
      </div>
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: dark ? '#f1f5f9' : '#0c4a6e', letterSpacing: '-.6px' }}>{value}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, color: dark ? '#7fd4e6' : '#0e7490', letterSpacing: '.04em', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

// ── KPI hero card with progress ring ─────────────────────────────────────────
function KpiHero({ value, label, accent, tint, icon, ring, dark }:
  { value: string; label: string; accent: string; tint: string; icon: string; ring: number; dark: boolean }) {
  const r = 14, C = 2 * Math.PI * r, len = Math.max(0, Math.min(100, ring)) / 100 * C;
  const uid = 'kh' + label.replace(/[^a-z]/gi, '');
  const cardBg = dark
    ? `linear-gradient(145deg,${accent}3d 0%,rgba(255,255,255,.05) 58%,rgba(255,255,255,.02) 100%)`
    : `linear-gradient(145deg,${accent}2e 0%,${tint} 38%,${tint}f0 100%)`;
  const inset = dark ? 'inset 0 1px 0 rgba(255,255,255,.08)' : 'inset 0 1px 0 rgba(255,255,255,.6)';
  const iconBg = dark ? 'rgba(255,255,255,.12)' : 'linear-gradient(135deg,rgba(255,255,255,.95),rgba(255,255,255,.78))';
  const ringTrack = dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.6)';
  return (
    <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', borderRadius: 14, padding: '11px 13px', background: cardBg, border: `1px solid ${accent}${dark ? '66' : '3d'}`, boxShadow: `0 4px 14px ${accent}24,${inset}`, transition: 'transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 9px 24px ${accent}3a,${inset}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 4px 14px ${accent}24,${inset}`; }}>
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${accent},${accent}88)` }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 7px ${accent}33`, border: `1px solid ${accent}${dark ? '44' : '1f'}` }}>
          <Svg d={icon} size={18} stroke={dark ? '#fff' : accent} w={2.2} />
        </div>
        <svg width="34" height="34" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
          <defs><linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor={accent} /><stop offset="100%" stopColor={`${accent}99`} /></linearGradient></defs>
          <circle cx="18" cy="18" r={r} fill="none" stroke={ringTrack} strokeWidth="3.5" />
          <circle cx="18" cy="18" r={r} fill="none" stroke={`url(#${uid})`} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} transform="rotate(-90 18 18)" />
        </svg>
      </div>
      <div style={{ fontSize: 9, fontWeight: 800, color: dark ? '#cbeaf3' : accent, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 9, lineHeight: 1.25 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: dark ? '#f8fafc' : '#1e293b', letterSpacing: '-1px', lineHeight: 1, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ── doc-progress pill for the table ──────────────────────────────────────────
function DocPill({ o }: { o: DocProg }) {
  const done = docDone(o);
  const c = done ? '#16a34a' : (o.d > 0 ? '#d97706' : '#ef4444');
  const bg = done ? 'rgba(22,163,74,.1)' : (o.d > 0 ? 'rgba(217,119,6,.1)' : 'rgba(239,68,68,.1)');
  return (
    <span style={{ display: 'inline-block', fontSize: 9.5, fontWeight: 800, color: c, background: bg, border: `1px solid ${c}33`, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {o.d}/{o.t}
    </span>
  );
}

// ── one click-to-filter metric card ──────────────────────────────────────────
function MetricCard({ value, label, icon, badge, active, onClick, dark }:
  { value: string; label: string; icon: string; badge: string; active: boolean; onClick: () => void; dark: boolean }) {
  const idle = dark ? 'rgba(255,255,255,.04)' : '#fff';
  const on = dark ? 'rgba(6,182,212,.16)' : '#ecfeff';
  const idleBorder = dark ? 'rgba(6,182,212,.28)' : '#A5F3FC';
  const hoverBorder = dark ? '#22d3ee' : '#67E8F9';
  return (
    <div onClick={onClick}
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 9, padding: '10px 12px', background: active ? on : idle, border: `1.5px solid ${active ? '#0891b2' : idleBorder}`, boxShadow: active ? '0 4px 14px rgba(8,145,178,.22)' : '0 1px 3px rgba(6,182,212,.07)', transition: 'all .15s', cursor: 'pointer' }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = hoverBorder; e.currentTarget.style.boxShadow = '0 5px 14px rgba(6,182,212,.14)'; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = idleBorder; e.currentTarget.style.boxShadow = '0 1px 3px rgba(6,182,212,.07)'; } }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,#06b6d4,#0891b2)', borderRadius: '9px 9px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(6,182,212,.25)' }}>
          <Svg d={icon} size={13} />
        </div>
        <span style={{ fontSize: 7.5, fontWeight: 800, padding: '2px 7px', borderRadius: 20, letterSpacing: '.06em', color: dark ? '#7fd4e6' : (badge === 'PENDING' ? '#0e7490' : '#0891b2'), background: dark ? 'rgba(6,182,212,.16)' : '#ecfeff', border: `1px solid ${dark ? 'rgba(6,182,212,.32)' : '#A5F3FC'}` }}>{badge}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, color: dark ? '#f1f5f9' : '#0c4a6e', letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: dark ? '#7fd4e6' : '#0891b2', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

// ── Party Overview panel (Buyer / Consignee / Supplier) ──────────────────────
function PartyOverviewPanel({ title, accent, accent2, tint, icon, data, tk }:
  { title: string; accent: string; accent2: string; tint: string; icon: string; data: PartyOverview; tk: OpsTokens }) {
  const compPct = data.total ? Math.round(data.compliant / data.total * 100) : 0;
  const R = 46, C = 2 * Math.PI * R, dash = C * compPct / 100;
  const uid = 'pp' + title.replace(/[^a-z]/gi, '');
  const numColor = tk.dark ? '#f1f5f9' : '#0c4a6e';
  const legend = tk.dark ? '#cbd5e1' : '#475569';
  const bars: [string, keyof PartyOverview['pend']][] = [['KYC', 'kyc'], ['Due Diligence', 'dd'], ['Trade Licenses', 'tl'], ['Trade Documents', 'td'], ['Agreements', 'agr']];
  return (
    <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 16px rgba(8,145,178,.07)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: tk.dark ? `linear-gradient(110deg,${accent}26,${accent}05 140%)` : `linear-gradient(110deg,${tint},${tint}00 140%)`, borderBottom: `1.5px solid ${accent}22` }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${accent},${accent2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 9px ${accent}4d` }}>
          <Svg d={icon} size={16} w={2.2} />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: tk.dark ? accent2 : accent, letterSpacing: '-.2px' }}>{title}</span>
      </div>

      {/* donut + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px 6px' }}>
        <svg width="132" height="132" viewBox="0 0 120 120" style={{ display: 'block', flexShrink: 0 }}>
          <defs>
            <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={accent} /><stop offset="100%" stopColor={accent2} /></linearGradient>
          </defs>
          <circle cx="60" cy="60" r={R} fill="none" stroke={`${accent}${tk.dark ? '33' : '18'}`} strokeWidth="13" />
          <circle cx="60" cy="60" r={R} fill="none" stroke={`url(#${uid}g)`} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 60 60)" />
          <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="900" fill={accent} letterSpacing="-1">{compPct}%</text>
          <text x="60" y="74" textAnchor="middle" fontSize="9" fontWeight="700" fill={tk.textMuted} letterSpacing=".05em">COMPLIANT</text>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tk.textMuted, letterSpacing: '.06em', textTransform: 'uppercase' }}>Total {data.noun}</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: numColor, lineHeight: 1, letterSpacing: '-1.5px', margin: '2px 0 8px' }}>{pad2(data.total)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: `linear-gradient(135deg,${accent},${accent2})` }} />
            <span style={{ fontSize: 10.5, color: legend, fontWeight: 600 }}>Fully Compliant</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: accent }}>{pad2(data.compliant)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: `${accent}22` }} />
            <span style={{ fontSize: 10.5, color: legend, fontWeight: 600 }}>Action Needed</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: tk.textMuted }}>{pad2(data.total - data.compliant)}</span>
          </div>
        </div>
      </div>

      {/* geographic split */}
      {data.geo && (
        <div style={{ padding: '6px 16px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tk.textMuted, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>Geographic Split</div>
          <div style={{ display: 'flex', height: 9, borderRadius: 20, overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.08)' }}>
            <div style={{ width: `${data.total ? Math.round(data.geo.intl / data.total * 100) : 0}%`, background: `linear-gradient(90deg,${accent},${accent2})` }} />
            <div style={{ flex: 1, background: `${accent}2e` }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
            <span style={{ fontSize: 10, color: legend, fontWeight: 600 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: `linear-gradient(135deg,${accent},${accent2})`, marginRight: 5 }} />International <strong style={{ color: numColor }}>{pad2(data.geo.intl)}</strong></span>
            <span style={{ fontSize: 10, color: legend, fontWeight: 600 }}>Domestic <strong style={{ color: numColor }}>{pad2(data.geo.dom)}</strong><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: `${accent}2e`, marginLeft: 5 }} /></span>
          </div>
        </div>
      )}

      {/* document completion bars */}
      <div style={{ padding: '8px 16px 16px', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: tk.textMuted, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, borderTop: `1px solid ${accent}14`, paddingTop: 12 }}>Document Completion</div>
        {bars.map(([label, key]) => {
          const pend = data.pend[key];
          const done = data.total - pend;
          const pct = data.total ? Math.round(done / data.total * 100) : 0;
          return (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: legend }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: numColor }}>
                  <span style={{ color: accent }}>{pad2(done)}</span><span style={{ color: tk.textMuted }}>/{pad2(data.total)}</span> <span style={{ color: '#cbd5e1' }}>·</span> <span style={{ color: '#ef4444', fontWeight: 700 }}>{pad2(pend)} pending</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 20, background: `${accent}14`, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 20, background: `linear-gradient(90deg,${accent},${accent2})` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Summary panel (Shipments Overview / Case to Case Overview) ───────────────
type SummaryRow = { l: string; v: number; k: 'total' | 'ok' | 'prog' | 'bad' | 'pend' };
function SummaryPanel({ title, accent, accent2, tint, icon, rows, tk }:
  { title: string; accent: string; accent2: string; tint: string; icon: string; rows: SummaryRow[]; tk: OpsTokens }) {
  const totalRow = rows[0] ?? { l: '', v: 0, k: 'total' as const };
  const total = totalRow.v || 0;
  const maxV = total || 1;
  const uid = 'sum' + title.replace(/[^a-z]/gi, '');
  const colorFor = (k: SummaryRow['k']) => k === 'ok' ? '#16a34a' : k === 'bad' ? '#ef4444' : k === 'prog' ? '#d97706' : accent;
  const primary = rows.find(r => r.k === 'ok') ?? rows[1] ?? { v: 0, l: '' };
  const pct = total ? Math.round(primary.v / total * 100) : 0;
  const R = 52, SW = 14, C = 2 * Math.PI * R, dash = C * pct / 100;
  const donutLabel = (primary.l || '').toUpperCase().replace(/ (SHIPMENTS|CONTRACTS)$/, '');
  const legendRows = rows.filter(r => r.k === 'ok' || r.k === 'prog' || r.k === 'bad');
  const barRows = rows.filter(r => r.k === 'pend');
  const numColor = tk.dark ? '#f1f5f9' : '#0c4a6e';
  const legend = tk.dark ? '#cbd5e1' : '#475569';
  return (
    <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 16px rgba(8,145,178,.07)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: tk.dark ? `linear-gradient(110deg,${accent}26,${accent}05 140%)` : `linear-gradient(110deg,${tint},${tint}00 140%)`, borderBottom: `1.5px solid ${accent}22` }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${accent},${accent2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 9px ${accent}4d` }}>
          <Svg d={icon} size={16} w={2.2} />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: tk.dark ? accent2 : accent, letterSpacing: '-.2px' }}>{title}</span>
      </div>

      {/* donut + total + status legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 16px 10px' }}>
        <svg width="146" height="146" viewBox="0 0 130 130" style={{ display: 'block', flexShrink: 0 }}>
          <defs>
            <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={accent} /><stop offset="55%" stopColor={accent2} /><stop offset="100%" stopColor={accent} /></linearGradient>
          </defs>
          <circle cx="65" cy="65" r={R} fill="none" stroke={`${accent}${tk.dark ? '2e' : '15'}`} strokeWidth={SW} />
          <circle cx="65" cy="65" r={R} fill="none" stroke={`url(#${uid}g)`} strokeWidth={SW} strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 65 65)" />
          <text x="65" y="61" textAnchor="middle" fontSize="29" fontWeight="900" fill={accent} letterSpacing="-1.5">{pct}%</text>
          <text x="65" y="79" textAnchor="middle" fontSize="8" fontWeight="700" fill={tk.textMuted} letterSpacing=".1em">{donutLabel}</text>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tk.textMuted, letterSpacing: '.06em', textTransform: 'uppercase' }}>{totalRow.l}</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: numColor, lineHeight: 1, letterSpacing: '-1.5px', margin: '2px 0 11px' }}>{pad2(total)}</div>
          {legendRows.map(s => {
            const col = colorFor(s.k);
            return (
              <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: `linear-gradient(135deg,${col},${col}bb)`, flexShrink: 0, boxShadow: `0 1px 3px ${col}55` }} />
                <span style={{ fontSize: 11, color: legend, fontWeight: 600 }}>{s.l}</span>
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 900, color: numColor, letterSpacing: '-.5px' }}>{pad2(s.v)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* pending actions bars */}
      {barRows.length > 0 && (
        <div style={{ padding: '6px 16px 16px', flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tk.textMuted, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 11, borderTop: `1px solid ${accent}14`, paddingTop: 12 }}>Pending Actions</div>
          {barRows.map(it => {
            const p = Math.round(it.v / maxV * 100);
            return (
              <div key={it.l} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: legend, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />{it.l}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: numColor, letterSpacing: '-.5px' }}>{pad2(it.v)}</span>
                </div>
                <div style={{ height: 7, borderRadius: 20, background: `${accent}12`, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${p}%`, borderRadius: 20, background: `linear-gradient(90deg,${accent},${accent2})`, boxShadow: `0 1px 4px ${accent}40` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ClmAnalyticsPage() {
  const t = useOpsTheme('cyan');
  const dk = t.dark;
  // dark-aware surfaces for the otherwise light cyan strips/bars
  const headGrad = dk ? 'linear-gradient(110deg,#0a2a33 0%,#0b333d 45%,#0a3b46 100%)' : 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%)';
  const barGrad = dk ? 'linear-gradient(110deg,rgba(6,182,212,.12),rgba(8,145,178,.05))' : 'linear-gradient(110deg,#f0fdff,#e6fafe)';
  const subGrad = dk ? 'rgba(6,182,212,.06)' : 'linear-gradient(110deg,#f7feff 0%,#f1fcfe 35%,#ecfafd 65%,#e6f8fc 100%)';
  const headStrong = dk ? '#e6f6fb' : '#0c4a6e';
  const headSub = dk ? '#67e8f9' : '#0891b2';
  const headSub2 = dk ? '#7fd4e6' : '#0e7490';
  const capsule = dk ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.6)';
  const barBorder = dk ? 'rgba(6,182,212,.22)' : 'rgba(6,182,212,.12)';
  const [ovSub, setOvSub] = useState<OvSub>('ws');
  const [wsScope, setWsScope] = useState<WsScope>('buyer');
  const [wsFilter, setWsFilter] = useState<WsFilter | null>(null);
  const [wsPage, setWsPage] = useState(1);
  const [wosScope, setWosScope] = useState<WosScope>('svc');
  const [wosFilter, setWosFilter] = useState<WsFilter | null>(null);
  const [wosPage, setWosPage] = useState(1);
  const [chip, setChip] = useState<ChipKey | null>(null);

  // ── header stats (computed across every transaction + contract) ───────────
  const stats = useMemo(() => {
    const txns = [...WS_ROWS, ...WOS_ROWS];
    const allDone = (r: { kyc: DocProg; dd: DocProg; tl: DocProg; td: DocProg; agr: DocProg }) =>
      DOC_KEYS.every(k => docDone(r[k]));
    const compliant = txns.filter(allDone).length;
    const compPct = txns.length ? Math.round(compliant / txns.length * 100) : 0;
    const activeC = CTC.filter(c => c.status === 'inprogress').length;
    const docPending = txns.reduce((a, r) => a + DOC_KEYS.filter(k => !docDone(r[k])).length, 0);
    const apprPend = CTC.filter(c => c.approval === 'pending').length;
    const pendingActions = docPending + ATA_CLARIFICATIONS + apprPend;
    const expiring = CTC.filter(c => /2026$/.test(c.endDate)).length;
    return { compPct, activeC, pendingActions, expiring, compliant, total: txns.length, docPending, apprPend };
  }, []);

  // ── KPI hero values ───────────────────────────────────────────────────────
  const maxTxn = Math.max(WS_ROWS.length, WOS_ROWS.length, 1);
  const kpis = [
    { value: pad2(WS_ROWS.length),    label: 'With Shipment ID Transactions',    accent: '#0891b2', tint: '#e8f4fd', icon: ICON.kpiWs,     ring: Math.round(WS_ROWS.length / maxTxn * 100) },
    { value: pad2(WOS_ROWS.length),   label: 'Without Shipment ID Transactions', accent: '#0e7490', tint: '#e6f6f7', icon: ICON.kpiWos,    ring: Math.round(WOS_ROWS.length / maxTxn * 100) },
    { value: pad2(CTC.length),        label: 'Case to Case Contracts',           accent: '#16a34a', tint: '#e8f7ed', icon: ICON.kpiC2c,    ring: Math.min(100, CTC.length * 5) },
    { value: pad2(BUYERS.length),     label: 'Buyers',                           accent: '#0d9488', tint: '#e6f6f4', icon: ICON.kpiBuyers, ring: Math.min(100, BUYERS.length * 4) },
    { value: pad2(CONSIGNEES.length), label: 'Consignees',                       accent: '#be185d', tint: '#fdeef5', icon: ICON.kpiCons,   ring: Math.min(100, CONSIGNEES.length * 2) },
    { value: pad2(SUPPLIERS.length),  label: 'Suppliers',                        accent: '#d97706', tint: '#fdf4e7', icon: ICON.kpiSup,    ring: Math.min(100, SUPPLIERS.length * 2) },
  ];

  // ── With-Shipment metric counts ───────────────────────────────────────────
  const wsMetrics = useMemo(() => {
    const total = WS_ROWS.length;
    const compliant = WS_ROWS.filter(r => DOC_KEYS.every(k => docDone(r[k]))).length;
    const pend = (k: DocKey) => WS_ROWS.filter(r => !docDone(r[k])).length;
    return { total, compliant, kyc: pend('kyc'), dd: pend('dd'), tl: pend('tl'), td: pend('td'), agr: pend('agr') };
  }, []);

  // ── filtered + paged rows for the table ───────────────────────────────────
  const filteredRows = useMemo(() => {
    return WS_ROWS.map((row, abs) => ({ row, abs })).filter(({ row }) => {
      if (!wsFilter || wsFilter === 'total') return true;
      if (wsFilter === 'compliant') return DOC_KEYS.every(k => docDone(row[k]));
      return !docDone(row[wsFilter]);
    });
  }, [wsFilter]);

  const PER = 10;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PER));
  const page = Math.min(Math.max(1, wsPage), totalPages);
  const startIdx = (page - 1) * PER;
  const pageRows = filteredRows.slice(startIdx, startIdx + PER);

  const toggleFilter = (f: WsFilter) => { setWsFilter(prev => (prev === f ? null : f)); setWsPage(1); };
  const switchScope = (s: WsScope) => { setWsScope(s); setWsFilter(null); setWsPage(1); };

  // ── Without-Shipment metric counts (computed over all 40 WOS rows) ────────
  const wosMetrics = useMemo(() => {
    const total = WOS_ROWS.length;
    const compliant = WOS_ROWS.filter(r => DOC_KEYS.every(k => docDone(r[k]))).length;
    const pend = (k: DocKey) => WOS_ROWS.filter(r => !docDone(r[k])).length;
    return { total, compliant, kyc: pend('kyc'), dd: pend('dd'), tl: pend('tl'), td: pend('td'), agr: pend('agr') };
  }, []);

  const wosFilteredRows = useMemo(() => {
    return WOS_ROWS.map((row, abs) => ({ row, abs })).filter(({ row }) => {
      if (!wosFilter || wosFilter === 'total') return true;
      if (wosFilter === 'compliant') return DOC_KEYS.every(k => docDone(row[k]));
      return !docDone(row[wosFilter]);
    });
  }, [wosFilter]);

  const wosTotalPages = Math.max(1, Math.ceil(wosFilteredRows.length / PER));
  const wosPg = Math.min(Math.max(1, wosPage), wosTotalPages);
  const wosStart = (wosPg - 1) * PER;
  const wosPageRows = wosFilteredRows.slice(wosStart, wosStart + PER);
  const toggleWosFilter = (f: WsFilter) => { setWosFilter(prev => (prev === f ? null : f)); setWosPage(1); };
  const switchWosScope = (s: WosScope) => { setWosScope(s); setWosFilter(null); setWosPage(1); };

  // resolve the per-row supplier name + generated proc/code for the WOS scope
  const resolveWosParty = (abs: number): { proc: string; code: string; name: string } => {
    const roster = WOS_SUPPLIERS[wosScope];
    const off = WOS_OFFSET[wosScope];
    const n = off + (abs + 1);
    return { proc: 'PROC-' + pad3(n), code: 'S-' + pad3(n), name: roster.length ? roster[abs % roster.length] : '—' };
  };
  const wosTitle = wosScope === 'svc' ? 'Service Suppliers' : wosScope === 'mat' ? 'Material Suppliers' : 'Logistics Suppliers';

  // ── Bottom summary panels (Shipments + Case to Case) ──────────────────────
  const shipmentRows = useMemo<SummaryRow[]>(() => {
    const total = WS_ROWS.length;
    const compliant = WS_ROWS.filter(r => DOC_KEYS.every(k => docDone(r[k]))).length;
    const blocked = WS_ROWS.filter(r => DOC_KEYS.every(k => !docDone(r[k]))).length;   // nothing started
    const inprog = total - compliant - blocked;                                        // partially complete
    const buyerPend = WS_ROWS.filter(r => (['kyc', 'dd', 'tl'] as DocKey[]).some(k => !docDone(r[k]))).length;
    const supPend = WS_ROWS.filter(r => (['td', 'agr'] as DocKey[]).some(k => !docDone(r[k]))).length;
    return [
      { l: 'Total Shipments', v: total, k: 'total' },
      { l: 'Fully Compliant Shipments', v: compliant, k: 'ok' },
      { l: 'In Progress Shipments', v: inprog, k: 'prog' },
      { l: 'Blocked Shipments', v: blocked, k: 'bad' },
      { l: 'Buyer Side Pending', v: buyerPend, k: 'pend' },
      { l: 'Supplier Side Pending', v: supPend, k: 'pend' },
    ];
  }, []);
  const c2cRows = useMemo<SummaryRow[]>(() => [
    { l: 'Total Case to Case Contracts', v: CTC.length, k: 'total' },
    { l: 'Signed Contracts', v: CTC.filter(c => c.status === 'signed').length, k: 'ok' },
    { l: 'Rejected Contracts', v: CTC.filter(c => c.status === 'rejected').length, k: 'bad' },
    { l: 'In Progress Contracts', v: CTC.filter(c => c.status === 'inprogress').length, k: 'prog' },
    { l: 'Under Clarification Contracts', v: ATA_CLARIFICATIONS, k: 'pend' },
    { l: 'Internal Approval Pending', v: CTC.filter(c => c.approval === 'pending').length, k: 'pend' },
    { l: 'Counterparty Sign Pending', v: 3, k: 'pend' },
  ], []);

  // resolve the per-row code + name for the active scope
  const resolveParty = (row: WsRow, abs: number): { code: string; name: string; proc?: string } => {
    if (wsScope === 'supplier') {
      const sp = SUPPLIERS[abs % SUPPLIERS.length];
      return { code: 'S-' + pad3(abs + 1), name: sp ? sp.name : '—', proc: 'PROC-' + pad3(abs + 1) };
    }
    if (wsScope === 'consignee') {
      const c = CONSIGNEES[abs % CONSIGNEES.length];
      return { code: c ? c.id : '—', name: c ? c.name : '—' };
    }
    const b = BUYERS.find(x => x.name === row.customer);
    return { code: b ? b.id : '—', name: row.customer || '—' };
  };

  const codeLabel = wsScope === 'supplier' ? 'Supplier Code' : wsScope === 'consignee' ? 'Consignee Code' : 'Customer Code';
  const nameLabel = wsScope === 'supplier' ? 'Supplier Name' : wsScope === 'consignee' ? 'Consignee Name' : 'Customer Name';
  const titleLabel = wsScope === 'supplier' ? 'Suppliers' : wsScope === 'consignee' ? 'Consignees' : 'Buyers';

  // shared styles
  const cardStyle: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: '0 4px 16px rgba(8,145,178,.07)', overflow: 'hidden', marginBottom: 12 };
  const scopeTabs: { key: WsScope; label: string; icon: string }[] = [
    { key: 'buyer', label: 'Buyer', icon: ICON.kyc },
    { key: 'consignee', label: 'Consignee', icon: ICON.ship },
    { key: 'supplier', label: 'Supplier', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
  ];
  const filterCards: { value: number; label: string; icon: string; badge: string; key: WsFilter }[] = [
    { value: wsMetrics.total, label: 'Total Shipments', icon: ICON.ship, badge: 'TOTAL', key: 'total' },
    { value: wsMetrics.compliant, label: 'Compliant Shipments', icon: ICON.ok, badge: 'OK', key: 'compliant' },
    { value: wsMetrics.kyc, label: 'KYC Pending', icon: ICON.kyc, badge: 'PENDING', key: 'kyc' },
    { value: wsMetrics.dd, label: 'Due Diligence Pending', icon: ICON.dd, badge: 'PENDING', key: 'dd' },
    { value: wsMetrics.tl, label: 'Trade Licenses Pending', icon: ICON.tl, badge: 'PENDING', key: 'tl' },
    { value: wsMetrics.td, label: 'Trade Documents Pending', icon: ICON.td, badge: 'PENDING', key: 'td' },
    { value: wsMetrics.agr, label: 'Agreements Pending', icon: ICON.agr, badge: 'PENDING', key: 'agr' },
  ];
  const filterLabels: Record<WsFilter, string> = { total: 'All Shipments', compliant: 'Fully Compliant', kyc: 'KYC Pending', dd: 'Due Diligence Pending', tl: 'Trade Licenses Pending', td: 'Trade Documents Pending', agr: 'Agreements Pending' };

  const wosScopeTabs: { key: WosScope; label: string; icon: string }[] = [
    { key: 'svc', label: 'Service Suppliers', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
    { key: 'mat', label: 'Material Suppliers', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
    { key: 'logi', label: 'Logistics Suppliers', icon: ICON.ship },
  ];
  const wosFilterCards: { value: number; label: string; icon: string; badge: string; key: WsFilter }[] = [
    { value: wosMetrics.total, label: 'Total Transactions', icon: ICON.td, badge: 'TOTAL', key: 'total' },
    { value: wosMetrics.compliant, label: 'Fully Compliant Transactions', icon: ICON.ok, badge: 'OK', key: 'compliant' },
    { value: wosMetrics.kyc, label: 'KYC Pending', icon: ICON.kyc, badge: 'PENDING', key: 'kyc' },
    { value: wosMetrics.dd, label: 'Due Diligence Pending', icon: ICON.dd, badge: 'PENDING', key: 'dd' },
    { value: wosMetrics.tl, label: 'Trade Licenses Pending', icon: ICON.tl, badge: 'PENDING', key: 'tl' },
    { value: wosMetrics.td, label: 'Trade Documents Pending', icon: ICON.td, badge: 'PENDING', key: 'td' },
    { value: wosMetrics.agr, label: 'Agreements Pending', icon: ICON.agr, badge: 'PENDING', key: 'agr' },
  ];
  const wosFilterLabels: Record<WsFilter, string> = { total: 'All Transactions', compliant: 'Fully Compliant', kyc: 'KYC Pending', dd: 'Due Diligence Pending', tl: 'Trade Licenses Pending', td: 'Trade Documents Pending', agr: 'Agreements Pending' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Header strip + live stat chips ───────────────────────────────── */}
      <div style={{ ...cardStyle, background: headGrad, padding: 0 }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', padding: '9px 18px', minHeight: 60 }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)', zIndex: 2 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, zIndex: 1 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4)', flexShrink: 0 }}>
              <Svg d={ICON.chart} size={18} w={2.1} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: headStrong, letterSpacing: '-.4px' }}>CLM Analytics</div>
              <div style={{ fontSize: 11, color: headSub, fontWeight: 500, marginTop: 1 }}>Track contract KPIs, compliance health &amp; legal performance across the portfolio.</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', zIndex: 1 }}>
            <StatChip icon={ICON.compliance} label="Overall Compliance" value={`${stats.compPct}%`} c1="#0d9488" c2="#14b8a6" onClick={() => setChip('compliance')} dark={dk} />
            <StatChip icon={ICON.active} label="Active Contracts" value={pad2(stats.activeC)} c1="#0891b2" c2="#22d3ee" onClick={() => setChip('active')} dark={dk} />
            <StatChip icon={ICON.pending} label="Pending Actions" value={pad2(stats.pendingActions)} c1="#d97706" c2="#f59e0b" onClick={() => setChip('pending')} dark={dk} />
            <StatChip icon={ICON.expiring} label="Expiring 2026" value={pad2(stats.expiring)} c1="#be185d" c2="#ec4899" onClick={() => setChip('expiring')} dark={dk} />
          </div>
        </div>
      </div>

      {/* ── Key Performance Indicators ───────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', background: barGrad, borderBottom: `1.5px solid ${barBorder}` }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Svg d={ICON.pulse} size={14} />
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: headStrong, letterSpacing: '-.2px' }}>Key Performance Indicators</span>
          <span style={{ fontSize: 8.5, fontWeight: 700, color: headSub, background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '2px 9px', borderRadius: 20, marginLeft: 'auto' }}>CLM Portfolio</span>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 11 }}>
            {kpis.map(k => <KpiHero key={k.label} {...k} dark={dk} />)}
          </div>
        </div>
      </div>

      {/* ── Sub-tabs + content ───────────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ padding: '12px 16px 0', background: subGrad }}>
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, padding: 5, background: capsule, borderRadius: 12 }}>
            {([['ws', 'With Shipment ID Transactions'], ['wos', 'Without Shipment ID Transactions'], ['c2c', 'Case to Case Contracts']] as [OvSub, string][]).map(([key, label]) => {
              const on = ovSub === key;
              return (
                <button key={key} onClick={() => setOvSub(key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', transition: 'all .18s', color: on ? '#fff' : t.tabInactive, background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 3px 10px rgba(8,145,178,.32)' : 'none' }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {ovSub === 'ws' && (
          <div>
            {/* scope header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px 10px 16px', background: subGrad, borderBottom: `1px solid ${dk ? 'rgba(6,182,212,.18)' : '#cdeef5'}`, minHeight: 52 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                  <Svg d={ICON.bars} size={15} w={2.4} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: headSub }}>With Shipment ID Transactions</span>
                    <span style={{ width: 1, height: 13, background: '#A5E8F5', display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: headStrong, letterSpacing: '-.2px' }}>Analytics Overview</span>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: headSub, background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '2px 7px', borderRadius: 20 }}>7 metrics</span>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: headSub2, marginTop: 2 }}>Live snapshot of compliance status, pending actions and document health.</div>
                </div>
              </div>
              <div style={{ display: 'inline-flex', gap: 5, padding: 5, background: capsule, borderRadius: 11 }}>
                {scopeTabs.map(s => {
                  const on = wsScope === s.key;
                  return (
                    <button key={s.key} onClick={() => switchScope(s.key)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap', transition: 'all .18s', color: on ? '#fff' : t.tabInactive, background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 2px 8px rgba(8,145,178,.32)' : 'none' }}>
                      <Svg d={s.icon} size={11} stroke="currentColor" w={2.4} />{s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* metric cards */}
            <div style={{ padding: '10px 12px 4px', background: dk ? 'transparent' : 'linear-gradient(180deg,#f0fdff,#f4feff)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
                {filterCards.map(c => (
                  <MetricCard key={c.key} value={pad2(c.value)} label={c.label} icon={c.icon} badge={c.badge}
                    active={wsFilter === c.key} onClick={() => toggleFilter(c.key)} dark={dk} />
                ))}
              </div>
            </div>

            {/* table */}
            <div style={{ padding: '6px 16px 16px', background: t.dark ? t.surface : 'linear-gradient(180deg,#f4feff,#ffffff 30%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 0 12px' }}>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Svg d={ICON.rows} size={12} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: t.textStrong, letterSpacing: '-.2px' }}>{titleLabel} — Shipment Transactions</span>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '2px 9px', borderRadius: 20, marginLeft: 'auto' }}>{filteredRows.length} rows</span>
              </div>

              {wsFilter && wsFilter !== 'total' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'rgba(6,182,212,.07)', border: '1px solid rgba(6,182,212,.2)', borderRadius: 9, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#0891b2' }}>Filtered by:</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: t.textStrong }}>{filterLabels[wsFilter]}</span>
                  <span style={{ fontSize: 10, color: t.textMuted }}>({filteredRows.length} of {WS_ROWS.length})</span>
                  <button onClick={() => toggleFilter(wsFilter)} style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, color: '#0891b2', background: t.surface, border: '1px solid rgba(6,182,212,.3)', padding: '3px 10px', borderRadius: 7, cursor: 'pointer' }}>Clear filter ✕</button>
                </div>
              )}

              <div style={{ overflowX: 'auto', border: `1px solid rgba(6,182,212,.12)`, borderRadius: 10, background: t.tableBg }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr>
                      {['Sr. No', 'Shipment ID', 'Opportunity ID', ...(wsScope === 'supplier' ? ['Procurement ID'] : []), codeLabel, nameLabel, 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Documents', 'Agreements'].map((c, i) => {
                        const leftCount = wsScope === 'supplier' ? 6 : 5;
                        return <th key={c} style={{ padding: '9px 11px', textAlign: i < leftCount ? 'left' : 'center', fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2', borderBottom: '1.5px solid rgba(6,182,212,.18)', whiteSpace: 'nowrap' }}>{c}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map(({ row, abs }, i) => {
                      const globalIdx = startIdx + i;
                      const p = resolveParty(row, abs);
                      const bg = globalIdx % 2 === 0 ? t.tableBg : t.rowAlt;
                      const tdL: React.CSSProperties = { padding: '9px 11px', fontSize: 11, textAlign: 'left' };
                      return (
                        <tr key={row.shp} style={{ background: bg }}>
                          <td style={{ ...tdL, color: t.textSub }}>{pad2(globalIdx + 1)}</td>
                          <td style={{ ...tdL, fontWeight: 700, color: t.textStrong }}>{row.shp}</td>
                          <td style={{ ...tdL, fontWeight: 600, color: t.textStrong }}>{row.opp}</td>
                          {wsScope === 'supplier' && <td style={{ ...tdL, fontWeight: 700, color: '#0e7490' }}>{p.proc}</td>}
                          <td style={{ ...tdL, fontWeight: 700, color: '#0891b2' }}>{p.code}</td>
                          <td style={{ ...tdL, color: t.textSub }}>{p.name}</td>
                          {DOC_KEYS.map(k => <td key={k} style={{ padding: '9px 11px', textAlign: 'center' }}><DocPill o={row[k]} /></td>)}
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={wsScope === 'supplier' ? 11 : 10} style={{ padding: 22, textAlign: 'center', color: t.textMuted, fontSize: 11.5, fontStyle: 'italic' }}>No records match this filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {filteredRows.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0891b2' }}>Showing <strong>{startIdx + 1}–{Math.min(startIdx + PER, filteredRows.length)}</strong> of <strong>{filteredRows.length}</strong></span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <PagerBtn label="‹ Prev" disabled={page <= 1} onClick={() => setWsPage(page - 1)} />
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <PagerBtn key={p} label={String(p)} active={p === page} onClick={() => setWsPage(p)} />
                    ))}
                    <PagerBtn label="Next ›" disabled={page >= totalPages} onClick={() => setWsPage(page + 1)} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {ovSub === 'wos' && (
          <div>
            {/* scope header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px 10px 16px', background: subGrad, borderBottom: `1px solid ${dk ? 'rgba(6,182,212,.18)' : '#cdeef5'}`, minHeight: 52 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                  <Svg d={ICON.bars} size={15} w={2.4} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: headSub }}>Without Shipment ID Transactions</span>
                    <span style={{ width: 1, height: 13, background: '#A5E8F5', display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: headStrong, letterSpacing: '-.2px' }}>Analytics Overview</span>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: headSub, background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '2px 7px', borderRadius: 20 }}>7 metrics</span>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: headSub2, marginTop: 2 }}>Live snapshot of compliance status, pending actions and document health.</div>
                </div>
              </div>
              <div style={{ display: 'inline-flex', gap: 5, padding: 5, background: capsule, borderRadius: 11 }}>
                {wosScopeTabs.map(s => {
                  const on = wosScope === s.key;
                  return (
                    <button key={s.key} onClick={() => switchWosScope(s.key)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap', transition: 'all .18s', color: on ? '#fff' : t.tabInactive, background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 2px 8px rgba(8,145,178,.32)' : 'none' }}>
                      <Svg d={s.icon} size={11} stroke="currentColor" w={2.4} />{s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* metric cards */}
            <div style={{ padding: '10px 12px 4px', background: dk ? 'transparent' : 'linear-gradient(180deg,#f0fdff,#f4feff)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
                {wosFilterCards.map(c => (
                  <MetricCard key={c.key} value={pad2(c.value)} label={c.label} icon={c.icon} badge={c.badge}
                    active={wosFilter === c.key} onClick={() => toggleWosFilter(c.key)} dark={dk} />
                ))}
              </div>
            </div>

            {/* table */}
            <div style={{ padding: '6px 16px 16px', background: dk ? t.surface : 'linear-gradient(180deg,#f4feff,#ffffff 30%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 0 12px' }}>
                <div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Svg d={ICON.rows} size={12} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: t.textStrong, letterSpacing: '-.2px' }}>{wosTitle} — Transactions</span>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '2px 9px', borderRadius: 20, marginLeft: 'auto' }}>{wosFilteredRows.length} rows</span>
              </div>

              {wosFilter && wosFilter !== 'total' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'rgba(6,182,212,.07)', border: '1px solid rgba(6,182,212,.2)', borderRadius: 9, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#0891b2' }}>Filtered by:</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: t.textStrong }}>{wosFilterLabels[wosFilter]}</span>
                  <span style={{ fontSize: 10, color: t.textMuted }}>({wosFilteredRows.length} of {WOS_ROWS.length})</span>
                  <button onClick={() => toggleWosFilter(wosFilter)} style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, color: '#0891b2', background: t.surface, border: '1px solid rgba(6,182,212,.3)', padding: '3px 10px', borderRadius: 7, cursor: 'pointer' }}>Clear filter ✕</button>
                </div>
              )}

              <div style={{ overflowX: 'auto', border: `1px solid rgba(6,182,212,.12)`, borderRadius: 10, background: t.tableBg }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr>
                      {['Sr. No', 'Procurement ID', 'Supplier Code', 'Supplier Name', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Documents', 'Agreements'].map((c, i) => (
                        <th key={c} style={{ padding: '9px 11px', textAlign: i < 4 ? 'left' : 'center', fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2', borderBottom: '1.5px solid rgba(6,182,212,.18)', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wosPageRows.length ? wosPageRows.map(({ row, abs }, i) => {
                      const globalIdx = wosStart + i;
                      const p = resolveWosParty(abs);
                      const bg = globalIdx % 2 === 0 ? t.tableBg : t.rowAlt;
                      const tdL: React.CSSProperties = { padding: '9px 11px', fontSize: 11, textAlign: 'left' };
                      return (
                        <tr key={`${wosScope}-${abs}`} style={{ background: bg }}>
                          <td style={{ ...tdL, color: t.textSub }}>{pad2(globalIdx + 1)}</td>
                          <td style={{ ...tdL, fontWeight: 700, color: '#0e7490' }}>{p.proc}</td>
                          <td style={{ ...tdL, fontWeight: 700, color: '#0891b2' }}>{p.code}</td>
                          <td style={{ ...tdL, color: t.textSub }}>{p.name}</td>
                          {DOC_KEYS.map(k => <td key={k} style={{ padding: '9px 11px', textAlign: 'center' }}><DocPill o={row[k]} /></td>)}
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={9} style={{ padding: 22, textAlign: 'center', color: t.textMuted, fontSize: 11.5, fontStyle: 'italic' }}>No records match this filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {wosFilteredRows.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0891b2' }}>Showing <strong>{wosStart + 1}–{Math.min(wosStart + PER, wosFilteredRows.length)}</strong> of <strong>{wosFilteredRows.length}</strong></span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <PagerBtn label="‹ Prev" disabled={wosPg <= 1} onClick={() => setWosPage(wosPg - 1)} />
                    {Array.from({ length: wosTotalPages }, (_, i) => i + 1).map(p => (
                      <PagerBtn key={p} label={String(p)} active={p === wosPg} onClick={() => setWosPage(p)} />
                    ))}
                    <PagerBtn label="Next ›" disabled={wosPg >= wosTotalPages} onClick={() => setWosPage(wosPg + 1)} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {ovSub === 'c2c' && (
          <div style={{ padding: '46px 24px', textAlign: 'center', background: t.surface }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: t.textStrong }}>Case to Case Contracts</div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 6 }}>This analytics view is coming next. The With Shipment &amp; Without Shipment views are fully available.</div>
          </div>
        )}
      </div>

      {/* ── Party Overview panels (Buyer / Consignee / Supplier) ─────────── */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <PartyOverviewPanel title="Buyer Overview"     accent="#0d9488" accent2="#14b8a6" tint="#e6f6f4" icon={ICON.kyc}     data={BUYER_OVERVIEW}     tk={t} />
        <PartyOverviewPanel title="Consignee Overview" accent="#be185d" accent2="#ec4899" tint="#fdeef5" icon={ICON.ship}    data={CONSIGNEE_OVERVIEW} tk={t} />
        <PartyOverviewPanel title="Supplier Overview"  accent="#d97706" accent2="#f59e0b" tint="#fdf4e7" icon={ICON.kpiCons} data={SUPPLIER_OVERVIEW}  tk={t} />
      </div>

      {/* ── Summary panels (Shipments + Case to Case Contracts) ──────────── */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <SummaryPanel title="Shipments Overview"             accent="#2563eb" accent2="#38bdf8" tint="#eaf2ff" icon={ICON.kpiWs}  rows={shipmentRows} tk={t} />
        <SummaryPanel title="Case to Case Contracts Overview" accent="#7c3aed" accent2="#c084fc" tint="#f3edff" icon={ICON.kpiWos} rows={c2cRows}      tk={t} />
      </div>

      {chip && <StatModal chipKey={chip} stats={stats} onClose={() => setChip(null)} />}
    </div>
  );
}

// ── pager button ─────────────────────────────────────────────────────────────
function PagerBtn({ label, onClick, disabled, active }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  if (disabled) return <span style={{ fontSize: 10.5, fontWeight: 700, color: '#cbd5e1', padding: '5px 10px' }}>{label}</span>;
  return (
    <button onClick={onClick}
      style={{ fontSize: 10.5, fontWeight: 700, minWidth: 28, height: 28, padding: '0 9px', borderRadius: 7, cursor: 'pointer', border: `1.5px solid ${active ? 'transparent' : 'rgba(6,182,212,.25)'}`, color: active ? '#fff' : '#0891b2', background: active ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#fff', fontFamily: 'inherit' }}>
      {label}
    </button>
  );
}

// ── header stat detail modal ─────────────────────────────────────────────────
type Stats = { compPct: number; activeC: number; pendingActions: number; expiring: number; compliant: number; total: number; docPending: number; apprPend: number };
function StatModal({ chipKey, stats, onClose }: { chipKey: ChipKey; stats: Stats; onClose: () => void }) {
  const cfg = {
    compliance: { title: 'Overall Compliance', a: '#0d9488', a2: '#14b8a6', icon: ICON.compliance, big: `${stats.compPct}%`, sub: `${stats.compliant} of ${stats.total} transactions fully compliant` },
    active: { title: 'Active Contracts', a: '#0891b2', a2: '#22d3ee', icon: ICON.active, big: pad2(stats.activeC), sub: 'contracts currently in progress' },
    pending: { title: 'Pending Actions', a: '#d97706', a2: '#f59e0b', icon: ICON.pending, big: pad2(stats.pendingActions), sub: 'total actions awaiting attention' },
    expiring: { title: 'Expiring in 2026', a: '#be185d', a2: '#ec4899', icon: ICON.expiring, big: pad2(stats.expiring), sub: 'contracts expiring in 2026' },
  }[chipKey];
  const rows: [string, string][] =
    chipKey === 'pending'
      ? [['Document Obligations Pending', pad2(stats.docPending)], ['Contracts Under Clarification', pad2(ATA_CLARIFICATIONS)], ['Internal Approval Pending', pad2(stats.apprPend)]]
      : chipKey === 'compliance'
        ? [['Fully Compliant', `${stats.compliant} / ${stats.total}`], ['Compliance Rate', `${stats.compPct}%`]]
        : [];
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999990, background: 'rgba(15,23,42,.42)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 18, maxWidth: 460, width: '100%', overflow: 'hidden', boxShadow: '0 30px 70px rgba(8,145,178,.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: `linear-gradient(110deg,${cfg.a}14,${cfg.a}04)`, borderBottom: `1.5px solid ${cfg.a}22` }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: `linear-gradient(135deg,${cfg.a},${cfg.a2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${cfg.a}4d` }}>
            <Svg d={cfg.icon} size={19} w={2.2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: cfg.a, letterSpacing: '-.2px' }}>{cfg.title}</div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500, marginTop: 1 }}>Portfolio summary</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${cfg.a}22`, background: '#fff', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: cfg.a, letterSpacing: '-1.5px', lineHeight: 1 }}>{cfg.big}</div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginTop: 5 }}>{cfg.sub}</div>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: `1px solid ${cfg.a}12` }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: cfg.a, letterSpacing: '-.3px', whiteSpace: 'nowrap' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
