import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { formatDmy } from '../../../utils/formatDmy';

/* Shared Signing Tracker modal — reusable across the QPI list, Sales Matrix
   Stage 5, and Customer / Consignee signing flows. Self-contained: it injects
   its own CSS so it renders correctly wherever it is mounted (the host page
   does not need to carry the .qpi-trk-* styles). */
const TRACKER_CSS = `
/* ─── Signing Tracker modal — premium dark "cosmic" panel (always dark,
   matching the Figma) regardless of the app theme. ─── */
.qpi-trk-overlay {
  position: fixed; inset: 0; z-index: 12000;
  background: rgba(6,9,28,0.66); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  font-family: var(--font-sans);
  animation: qpiTrkFade .16s ease both;
}
@keyframes qpiTrkFade { from { opacity: 0; } to { opacity: 1; } }
.qpi-trk-card {
  position: relative;
  width: min(780px, 96vw); max-height: 90vh; display: flex; flex-direction: column;
  border-radius: 22px; overflow: hidden; color: #e7ecff;
  background:
    radial-gradient(120% 90% at 85% 10%, rgba(56,80,180,0.45) 0%, transparent 55%),
    radial-gradient(90% 80% at 0% 100%, rgba(76,40,150,0.40) 0%, transparent 55%),
    linear-gradient(160deg, #0c1238 0%, #0a0f2e 50%, #0b1030 100%);
  border: 1px solid rgba(120,140,255,0.18);
  box-shadow: 0 40px 100px rgba(0,0,0,.55), 0 0 0 1px rgba(120,140,255,0.06) inset;
  animation: qpiTrkUp .22s cubic-bezier(.22,1,.36,1) both;
}
@keyframes qpiTrkUp { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.qpi-trk-orb { position: absolute; border-radius: 50%; pointer-events: none; filter: blur(2px); opacity: .5; }
.qpi-trk-orb-1 { width: 220px; height: 220px; right: -40px; top: 30%; background: radial-gradient(circle at 35% 35%, #2a3a8a, #11163a 70%); box-shadow: 0 0 80px rgba(60,90,220,.35); }
.qpi-trk-orb-2 { width: 120px; height: 120px; right: 30%; top: 22%; background: radial-gradient(circle at 35% 35%, #3550b0, #141a44 70%); opacity: .35; }
.qpi-trk-head {
  position: relative; z-index: 2; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 30px 26px;
  /* Premium coloured header band + white dot texture (same as the first view). */
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #7c3aed 100%);
}
.qpi-trk-head::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.20) 1.1px, transparent 1.6px);
  background-size: 18px 18px;
}
.qpi-trk-head > * { position: relative; z-index: 1; }
.qpi-trk-title { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -.2px; }
.qpi-trk-sub { display: flex; align-items: center; gap: 10px; margin-top: 5px; font-size: 14px; font-weight: 600; color: rgba(255,255,255,.82); }
.qpi-trk-status { font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 20px; white-space: nowrap; }
.qpi-trk-status-ok   { background: rgba(34,197,94,.18);  color: #6ee7a8; border: 1px solid rgba(34,197,94,.35); }
.qpi-trk-status-bad  { background: rgba(239,68,68,.18);  color: #fca5a5; border: 1px solid rgba(239,68,68,.35); }
.qpi-trk-status-warn { background: rgba(245,158,11,.18); color: #fcd34d; border: 1px solid rgba(245,158,11,.35); }
.qpi-trk-status-info { background: rgba(99,102,241,.20); color: #c7d2fe; border: 1px solid rgba(129,140,248,.40); }
.qpi-trk-close { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(150,165,255,.30); background: rgba(120,140,255,.12); color: #cdd6ff; cursor: pointer; font-size: 14px; flex-shrink: 0; transition: background .15s; }
.qpi-trk-close:hover { background: rgba(120,140,255,.25); }
.qpi-trk-body { position: relative; z-index: 2; padding: 4px 24px 18px; overflow-y: auto; }
.qpi-trk-loading, .qpi-trk-error { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 40px; color: #aeb8e8; font-size: 13px; }
.qpi-trk-error { color: #fca5a5; }
/* Shimmer skeleton (shown while loading instead of a spinner). */
.qpi-trk-skel { padding: 22px 24px; }
.qpi-trk-sk { position: relative; overflow: hidden; border-radius: 8px; background: rgba(120,140,255,.12); }
.qpi-trk-sk::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent); animation: qpiSkShimmer 1.2s ease-in-out infinite; }
@keyframes qpiSkShimmer { 100% { transform: translateX(100%); } }
.qpi-trk-skel-bar { height: 14px; width: 45%; margin-bottom: 22px; }
.qpi-trk-skel-line { display: flex; gap: 14px; margin-bottom: 18px; }
.qpi-trk-skel-dot { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; }
.qpi-trk-skel-lines { flex: 1; padding-top: 4px; }
.qpi-trk-skel-l1 { display: block; height: 12px; width: 55%; margin-bottom: 9px; }
.qpi-trk-skel-l2 { display: block; height: 10px; width: 80%; }
[data-bs-theme="light"] .qpi-trk-sk { background: rgba(124,58,237,.09); }
[data-bs-theme="light"] .qpi-trk-sk::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent); }
/* Stat cards */
.qpi-trk-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.qpi-trk-stat { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 14px; border-radius: 14px; background: rgba(120,140,255,0.06); border: 1px solid rgba(120,140,255,0.14); border-top-width: 3px; min-height: 76px; }
.qpi-trk-stat-text { min-width: 0; }
/* Colourful top border + matching icon box per stat (Figma image 4). */
.qpi-trk-stat-violet { border-top-color: #8b5cf6; }
.qpi-trk-stat-violet .qpi-trk-stat-icon { background: linear-gradient(135deg, #8b5cf6, #6d28d9) !important; color: #fff !important; border-color: transparent !important; }
.qpi-trk-stat-amber  { border-top-color: #f59e0b; }
.qpi-trk-stat-amber .qpi-trk-stat-icon { background: linear-gradient(135deg, #fbbf24, #d97706) !important; color: #fff !important; border-color: transparent !important; }
.qpi-trk-stat-teal   { border-top-color: #14b8a6; }
.qpi-trk-stat-teal .qpi-trk-stat-icon { background: linear-gradient(135deg, #2dd4bf, #0d9488) !important; color: #fff !important; border-color: transparent !important; }
.qpi-trk-stat-green  { border-top-color: #22c55e; }
.qpi-trk-stat-green .qpi-trk-stat-icon { background: linear-gradient(135deg, #34d399, #16a34a) !important; color: #fff !important; border-color: transparent !important; }
.qpi-trk-stat-red    { border-top-color: #ef4444; }
.qpi-trk-stat-red .qpi-trk-stat-icon { background: linear-gradient(135deg, #f87171, #dc2626) !important; color: #fff !important; border-color: transparent !important; }
.qpi-trk-stat > div { min-width: 0; }
.qpi-trk-stat-icon { width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #aab4ee; background: rgba(99,102,241,0.16); border: 1px solid rgba(129,140,248,0.22); }
.qpi-trk-stat-label { font-size: 11px; font-weight: 600; color: #94a0d8; }
.qpi-trk-stat-value { font-size: 15.5px; font-weight: 800; color: #fff; margin-top: 3px; line-height: 1.3; }
/* Glassy panels */
.qpi-trk-panel { background: rgba(120,140,255,0.04); border: 1px solid rgba(120,140,255,0.12); border-radius: 16px; padding: 16px 18px; margin-bottom: 14px; }
/* Colourful top-border accent per panel (like the consignee form sections). */
.qpi-trk-panel-acc { border-top-width: 3px; }
.qpi-trk-panel-violet { border-top-color: #8b5cf6; }
.qpi-trk-panel-blue   { border-top-color: #3b82f6; }
.qpi-trk-panel-amber  { border-top-color: #f59e0b; }
.qpi-trk-panel-red    { border-top-color: #ef4444; }
.qpi-trk-panel-h { font-size: 13.5px; font-weight: 800; color: #dbe2ff; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.qpi-trk-panel-cnt { font-size: 11px; font-weight: 700; color: #97a2d8; background: rgba(120,140,255,.10); border: 1px solid rgba(120,140,255,.20); padding: 2px 9px; border-radius: 20px; }
/* Reminder history — ~5 rows visible, scroll for the rest. */
.qpi-trk-rem-scroll { max-height: 226px; overflow-y: auto; scrollbar-width: thin; }
.qpi-trk-rem-scroll::-webkit-scrollbar { width: 7px; }
.qpi-trk-rem-scroll::-webkit-scrollbar-thumb { background: rgba(120,140,255,.25); border-radius: 10px; }
[data-bs-theme="light"] .qpi-trk-panel-cnt { background: #ede9fe; color: #6d28d9; border-color: #ddd6fe; }
[data-bs-theme="light"] .qpi-trk-rem-scroll::-webkit-scrollbar-thumb { background: #d1c7f5; }
/* Timeline */
.qpi-trk-timeline { display: flex; flex-direction: column; }
.qpi-trk-step { display: flex; gap: 14px; }
.qpi-trk-dotcol { display: flex; flex-direction: column; align-items: center; }
.qpi-trk-dot { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; color: #fff; background: #2a3566; box-shadow: 0 0 0 4px rgba(120,140,255,.06); }
.qpi-trk-line { flex: 1; width: 2px; background: rgba(120,140,255,.18); margin: 3px 0; min-height: 14px; }
.qpi-trk-step-done.qpi-trk-tone-ok   .qpi-trk-dot { background: #16a34a; box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
.qpi-trk-step-done.qpi-trk-tone-warn .qpi-trk-dot { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-step-done.qpi-trk-tone-bad  .qpi-trk-dot { background: #ef4444; box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.qpi-trk-step-current .qpi-trk-dot { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-stepbody { padding-bottom: 16px; }
.qpi-trk-step-label { font-size: 14px; font-weight: 700; color: #f2f5ff; }
.qpi-trk-step-idle .qpi-trk-step-label { color: #8390cc; font-weight: 600; }
.qpi-trk-step-meta { font-size: 12px; color: #97a2d8; margin-top: 3px; }
/* Tables */
/* Horizontal scroll safety net so the right-most columns (Viewed/Signed On)
   are never clipped when the modal is narrow. */
.qpi-trk-table-scroll { width: 100%; overflow-x: auto; }
.qpi-trk-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; }
/* Long emails truncate with an ellipsis instead of stretching the table. */
.qpi-trk-email { display: inline-block; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.qpi-trk-table th { text-align: left; font-size: 11px; font-weight: 700; color: #b9c2f0; padding: 9px 10px; border-bottom: 1px solid rgba(120,140,255,.14); white-space: nowrap; background: linear-gradient(180deg, rgba(124,58,237,.22), rgba(99,102,241,.10)); }
.qpi-trk-table thead tr th:first-child { border-top-left-radius: 8px; }
.qpi-trk-table thead tr th:last-child { border-top-right-radius: 8px; }
/* Horizontal timeline (View Details tab). */
/* Horizontal stepper — fixed-width steps so a long trail shows ~5 at a time
   and the rest scroll (instead of squashing every step to unreadable). */
.qpi-trk-htl { display: flex; align-items: flex-start; overflow-x: auto; padding-bottom: 8px; scrollbar-width: thin; }
.qpi-trk-htl::-webkit-scrollbar { height: 7px; }
.qpi-trk-htl::-webkit-scrollbar-thumb { background: rgba(120,140,255,.25); border-radius: 10px; }
[data-bs-theme="light"] .qpi-trk-htl::-webkit-scrollbar-thumb { background: #d1c7f5; }
.qpi-trk-htl-step { flex: 0 0 128px; min-width: 128px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.qpi-trk-htl-iconrow { display: flex; align-items: center; width: 100%; }
.qpi-trk-htl-line { flex: 1; height: 2px; background: rgba(120,140,255,.20); }
.qpi-trk-htl-step:first-child .qpi-trk-htl-line-l { visibility: hidden; }
.qpi-trk-htl-step:last-child .qpi-trk-htl-line-r { visibility: hidden; }
.qpi-trk-htl-icon { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: #2a3566; box-shadow: 0 0 0 4px rgba(120,140,255,.06); }
.qpi-trk-htl-done.qpi-trk-tone-ok   .qpi-trk-htl-icon { background: linear-gradient(135deg, #16a34a, #15803d); box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
.qpi-trk-htl-done.qpi-trk-tone-warn .qpi-trk-htl-icon { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-htl-done.qpi-trk-tone-bad  .qpi-trk-htl-icon { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.qpi-trk-htl-current .qpi-trk-htl-icon { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-htl-title { font-size: 12.5px; font-weight: 700; color: #f2f5ff; line-height: 1.25; }
.qpi-trk-htl-idle .qpi-trk-htl-title { color: #8390cc; }
.qpi-trk-htl-date { font-size: 10.5px; color: #97a2d8; }
.qpi-trk-table td { padding: 11px 10px; color: #e7ecff; border-bottom: 1px solid rgba(120,140,255,.07); white-space: nowrap; vertical-align: middle; }
.qpi-trk-table tr:last-child td { border-bottom: 0; }
.qpi-trk-muted { color: #97a2d8; }
/* Reason cell in the Signer Details table — clamped to 2 lines & clickable so
   a long reason opens the popup instead of stretching / breaking the table. */
.qpi-trk-reason { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 200px; max-width: 200px; text-align: left; padding: 0; margin: 0; background: none; border: none; cursor: pointer; font: inherit; font-style: italic; color: #fca5a5; text-decoration: underline dotted; text-underline-offset: 2px; }
.qpi-trk-reason:hover { color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-reason { color: #b91c1c; }
[data-bs-theme="light"] .qpi-trk-reason:hover { color: #dc2626; }
/* Activity cell — icon badge + label on one line. */
.qpi-trk-act-cell { display: inline-flex; align-items: center; gap: 9px; white-space: nowrap; }
.qpi-trk-act-ic { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; }
.qpi-trk-act-ic-sent     { background: rgba(59,130,246,.18);  color: #93c5fd; }
.qpi-trk-act-ic-view     { background: rgba(139,92,246,.18);  color: #c4b5fd; }
.qpi-trk-act-ic-reminder { background: rgba(245,158,11,.18);  color: #fcd34d; }
.qpi-trk-act-ic-signed   { background: rgba(34,197,94,.18);   color: #6ee7a8; }
.qpi-trk-act-ic-declined { background: rgba(239,68,68,.18);   color: #fca5a5; }
[data-bs-theme="light"] .qpi-trk-act-ic-sent     { background: #dbeafe; color: #2563eb; }
[data-bs-theme="light"] .qpi-trk-act-ic-view     { background: #ede9fe; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-act-ic-reminder { background: #fef3c7; color: #b45309; }
[data-bs-theme="light"] .qpi-trk-act-ic-signed   { background: #dcfce7; color: #15803d; }
[data-bs-theme="light"] .qpi-trk-act-ic-declined { background: #fee2e2; color: #b91c1c; }
.qpi-trk-sav { display: inline-flex; width: 28px; height: 28px; border-radius: 50%; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #c084fc, #7c3aed); flex-shrink: 0; box-shadow: 0 2px 6px rgba(124,58,237,.35); }
/* Signer name cell — avatar + name on one vertically-centred line. */
.qpi-trk-signer-cell { display: inline-flex; align-items: center; gap: 9px; }
.qpi-trk-signer-name { font-weight: 700; color: #f3f4ff; }
/* Role chip — subtle pill so the role reads as a tag, not plain text. */
.qpi-trk-role { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 700; text-transform: capitalize; background: rgba(120,140,255,.14); color: #b9c2f0; }
.qpi-trk-spill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
.qpi-trk-spill-ok   { background: rgba(34,197,94,.18);  color: #6ee7a8; }
.qpi-trk-spill-warn { background: rgba(245,158,11,.18); color: #fcd34d; }
.qpi-trk-spill-bad  { background: rgba(239,68,68,.18);  color: #fca5a5; }
.qpi-trk-spill-info { background: rgba(96,165,250,.18); color: #93c5fd; }
/* Footer */
.qpi-trk-foot { position: relative; z-index: 2; padding: 14px 24px 20px; display: flex; gap: 12px; }
.qpi-trk-btn { flex: 1 1 auto; padding: 11px 12px; border-radius: 12px; font-weight: 700; font-size: 12.5px; white-space: nowrap; cursor: pointer; border: 1px solid transparent; transition: all .15s; display: inline-flex; align-items: center; justify-content: center; }
.qpi-trk-btn:disabled { opacity: .45; cursor: not-allowed; }
.qpi-trk-btn-light { background: rgba(120,140,255,0.08); border-color: rgba(120,140,255,0.20); color: #dbe2ff; }
.qpi-trk-btn-light:not(:disabled):hover { background: rgba(120,140,255,0.16); }
.qpi-trk-btn-primary { background: linear-gradient(135deg, #6366f1, #7c3aed); color: #fff; box-shadow: 0 6px 18px rgba(99,102,241,.40); }
.qpi-trk-btn-primary:hover { filter: brightness(1.08); }
/* ── Informative first view (workflow header + progress + rich timeline) ── */
.qpi-trk-card-info { width: min(480px, 95vw); }
.qpi-trk-ihead { position: relative; z-index: 2; overflow: hidden; display: flex; align-items: flex-start; gap: 14px; padding: 20px 22px; background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 55%, #8b5cf6 100%); color: #fff; }
/* White polka-dot texture (same effect as the Add Customer/Consignee headers). */
.qpi-trk-ihead::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.20) 1.1px, transparent 1.6px);
  background-size: 18px 18px;
}
.qpi-trk-ihead > * { position: relative; z-index: 1; }
.qpi-trk-ihead-icon { width: 46px; height: 46px; border-radius: 13px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.25); }
.qpi-trk-ihead-text { flex: 1; min-width: 0; }
.qpi-trk-ihead-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: .1em; opacity: .85; }
.qpi-trk-ihead-title { font-size: 18px; font-weight: 800; margin-top: 2px; }
.qpi-trk-ihead-sub { font-size: 12px; opacity: .92; margin-top: 4px; display: flex; align-items: center; gap: 8px; }
.qpi-trk-iclose { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.30); background: rgba(255,255,255,0.16); color: #fff; cursor: pointer; font-size: 13px; flex-shrink: 0; }
.qpi-trk-iclose:hover { background: rgba(255,255,255,0.28); }
.qpi-trk-prog { position: relative; z-index: 2; padding: 16px 22px 6px; }
.qpi-trk-prog-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.qpi-trk-prog-lbl { font-size: 11px; font-weight: 800; letter-spacing: .08em; color: #9aa6e6; }
.qpi-trk-prog-cnt { font-size: 13px; font-weight: 800; color: #e7ecff; }
.qpi-trk-prog-bar { height: 8px; border-radius: 20px; background: rgba(120,140,255,0.14); overflow: hidden; }
.qpi-trk-prog-bar > span { display: block; height: 100%; border-radius: 20px; background: linear-gradient(90deg, #7c3aed, #22c55e); transition: width .45s ease; }
.qpi-trk-ibody { position: relative; z-index: 2; padding: 16px 22px 22px; display: flex; flex-direction: column; min-height: 0; }
/* The timeline scrolls inside this; the "View details" button below stays put. */
.qpi-trk-itl-scroll { max-height: 46vh; overflow-y: auto; margin: 0 -6px; padding: 0 6px; scrollbar-width: thin; }
.qpi-trk-itl-scroll::-webkit-scrollbar { width: 7px; }
.qpi-trk-itl-scroll::-webkit-scrollbar-thumb { background: rgba(120,140,255,.25); border-radius: 10px; }
[data-bs-theme="light"] .qpi-trk-itl-scroll::-webkit-scrollbar-thumb { background: #d1c7f5; }
.qpi-trk-itl { display: flex; flex-direction: column; }
.qpi-trk-itl-step { display: flex; gap: 14px; }
.qpi-trk-itl-dotcol { display: flex; flex-direction: column; align-items: center; }
.qpi-trk-itl-icon { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: #2a3566; box-shadow: 0 0 0 4px rgba(120,140,255,.06); }
.qpi-trk-itl-line { flex: 1; width: 2px; background: rgba(120,140,255,.18); margin: 4px 0; min-height: 18px; }
.qpi-trk-itl-done.qpi-trk-tone-ok   .qpi-trk-itl-icon { background: linear-gradient(135deg, #16a34a, #15803d); box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
.qpi-trk-itl-done.qpi-trk-tone-warn .qpi-trk-itl-icon { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-itl-done.qpi-trk-tone-bad  .qpi-trk-itl-icon { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.qpi-trk-itl-current .qpi-trk-itl-icon { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.qpi-trk-itl-body { flex: 1; padding-bottom: 18px; min-width: 0; }
.qpi-trk-itl-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.qpi-trk-itl-title { font-size: 14.5px; font-weight: 700; color: #f2f5ff; }
.qpi-trk-itl-idle .qpi-trk-itl-title { color: #8390cc; }
.qpi-trk-itl-badge { font-size: 11px; font-weight: 800; padding: 3px 11px; border-radius: 20px; white-space: nowrap; border: 1px solid; }
.qpi-trk-itl-badge-ok   { background: rgba(34,197,94,.16);  color: #6ee7a8; border-color: rgba(34,197,94,.35); }
.qpi-trk-itl-badge-warn { background: rgba(245,158,11,.16); color: #fcd34d; border-color: rgba(245,158,11,.35); }
.qpi-trk-itl-badge-bad  { background: rgba(239,68,68,.16);  color: #fca5a5; border-color: rgba(239,68,68,.35); }
.qpi-trk-itl-badge-idle { background: rgba(120,140,255,.10); color: #97a2d8; border-color: rgba(120,140,255,.22); }
/* Clamp a long decline reason to 2 lines — the full text is in the title
   tooltip so the timeline card never grows unbounded. */
.qpi-trk-itl-desc { font-size: 12.5px; color: #97a2d8; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qpi-trk-itl-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; margin-top: 7px; }
/* Clickable decline reason → opens the full text in an in-card popup. */
.qpi-trk-itl-desc-btn { background: none; border: none; padding: 0; margin-top: 4px; text-align: left; width: 100%; cursor: pointer; font: inherit; }
.qpi-trk-itl-more { display: block; margin-top: 3px; font-size: 11px; font-weight: 700; color: #93b4ff; }
.qpi-trk-itl-desc-btn:hover .qpi-trk-itl-more { text-decoration: underline; }
[data-bs-theme="light"] .qpi-trk-itl-more { color: #6d28d9; }
/* Full-reason popup — sits over the card (not a native title tooltip). */
/* Full-screen popup (portalled above the tracker) so it can be WIDER than the
   tracker card and never clipped by it. */
.qpi-trk-reason-overlay { position: fixed; inset: 0; z-index: 13000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(6,9,28,0.62); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); font-family: var(--font-sans); }
.qpi-trk-reason-box { width: min(680px, 94vw); max-height: 82vh; display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: #0f1442; border: 1px solid rgba(120,140,255,.30); box-shadow: 0 40px 100px rgba(0,0,0,.55); }
.qpi-trk-reason-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; font-size: 13px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #ef4444, #b91c1c); }
.qpi-trk-reason-x { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.16); color: #fff; cursor: pointer; font-size: 12px; }
.qpi-trk-reason-x:hover { background: rgba(255,255,255,.28); }
.qpi-trk-reason-body { padding: 16px; overflow-y: auto; font-size: 13px; line-height: 1.55; color: #e7ecff; white-space: pre-wrap; word-break: break-word; }
[data-bs-theme="light"] .qpi-trk-reason-overlay { background: rgba(40,18,80,0.35); }
[data-bs-theme="light"] .qpi-trk-reason-box { background: #ffffff; border-color: #e3d9fb; }
[data-bs-theme="light"] .qpi-trk-reason-body { color: #1f2937; }
/* Download-declined-document button on the declined timeline step. */
.qpi-trk-itl-dl { margin-top: 9px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: rgba(239,68,68,.14); border: 1px solid rgba(239,68,68,.35); color: #fca5a5; transition: background .15s; }
.qpi-trk-itl-dl:hover:not(:disabled) { background: rgba(239,68,68,.24); }
.qpi-trk-itl-dl:disabled { opacity: .6; cursor: wait; }
[data-bs-theme="light"] .qpi-trk-itl-dl { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-itl-dl:hover:not(:disabled) { background: #fecaca; }
.qpi-trk-itl-metait { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #8e9ad6; }
/* Light mode for the informative view */
[data-bs-theme="light"] .qpi-trk-prog-lbl { color: #8b80b8; }
[data-bs-theme="light"] .qpi-trk-prog-cnt { color: #3b0764; }
[data-bs-theme="light"] .qpi-trk-prog-bar { background: #ece5fb; }
[data-bs-theme="light"] .qpi-trk-itl-icon { background: #cbd5e1; }
[data-bs-theme="light"] .qpi-trk-itl-line { background: #e5dffb; }
[data-bs-theme="light"] .qpi-trk-itl-title { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-itl-idle .qpi-trk-itl-title { color: #9ca3af; }
[data-bs-theme="light"] .qpi-trk-itl-desc, [data-bs-theme="light"] .qpi-trk-itl-metait { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-itl-badge-ok   { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
[data-bs-theme="light"] .qpi-trk-itl-badge-warn { background: #fef3c7; color: #92400e; border-color: #fde68a; }
[data-bs-theme="light"] .qpi-trk-itl-badge-bad  { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-itl-badge-idle { background: #f1f5f9; color: #64748b; border-color: #e2e8f0; }

/* ── Compact card (legacy) ── */
.qpi-trk-card-compact { width: min(380px, 94vw); }
.qpi-trk-chead { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 20px 22px 8px; }
.qpi-trk-ctitle { font-size: 18px; font-weight: 800; color: #fff; flex: 1; }
.qpi-trk-cclose { margin-left: auto; }
.qpi-trk-cbody { position: relative; z-index: 2; padding: 14px 22px 20px; }
.qpi-trk-cbody .qpi-trk-timeline { margin-bottom: 6px; }
.qpi-trk-csigner { background: rgba(120,140,255,0.06); border: 1px solid rgba(120,140,255,0.14); border-radius: 14px; padding: 14px; margin-top: 8px; }
.qpi-trk-csigner-h { font-size: 12.5px; font-weight: 600; color: #aeb8e8; margin-bottom: 10px; }
.qpi-trk-csigner-row { display: flex; align-items: center; gap: 11px; }
.qpi-trk-csigner-row .qpi-trk-sav { width: 38px; height: 38px; border-radius: 50%; font-size: 14px; margin: 0; vertical-align: 0; }
.qpi-trk-csigner-info { flex: 1; min-width: 0; }
.qpi-trk-csigner-name { font-size: 14px; font-weight: 700; color: #fff; }
.qpi-trk-csigner-mail { font-size: 12px; color: #97a2d8; margin-top: 1px; }
.qpi-trk-csigner-more { font-size: 11.5px; color: #8e9ad6; margin-top: 8px; }
.qpi-trk-viewbtn {
  width: 100%; margin-top: 16px; padding: 13px; border-radius: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: #e7ecff;
  background: rgba(120,140,255,0.10); border: 1px solid rgba(120,140,255,0.28);
  transition: all .15s;
}
.qpi-trk-viewbtn:hover { background: rgba(120,140,255,0.20); border-color: rgba(120,140,255,0.45); }
@media (max-width: 640px) {
  .qpi-trk-stats { grid-template-columns: repeat(2, 1fr); }
  .qpi-trk-foot { flex-wrap: wrap; }
}

/* ── Light mode — clean white panel (the cosmic dark above is the default). ── */
[data-bs-theme="light"] .qpi-trk-overlay { background: rgba(40,18,80,0.30); }
[data-bs-theme="light"] .qpi-trk-card {
  color: #1f2937;
  /* Same depth as the dark "cosmic" panel, in light lavender tones — soft
     violet radial glows + a white→lavender gradient (not a flat white box). */
  background:
    radial-gradient(120% 90% at 85% 8%, rgba(167,139,250,0.22) 0%, transparent 55%),
    radial-gradient(90% 80% at 0% 100%, rgba(196,181,253,0.20) 0%, transparent 55%),
    linear-gradient(160deg, #ffffff 0%, #f6f2ff 55%, #efe9fe 100%);
  border: 1px solid #e3d9fb;
  box-shadow: 0 32px 90px rgba(76,29,149,.20), 0 0 0 1px rgba(167,139,250,0.10) inset;
}
[data-bs-theme="light"] .qpi-trk-orb { opacity: .55; filter: blur(1px); }
[data-bs-theme="light"] .qpi-trk-orb-1 { background: radial-gradient(circle at 35% 35%, #ddd6fe, #f3effe 72%); box-shadow: 0 0 90px rgba(167,139,250,.45); }
[data-bs-theme="light"] .qpi-trk-orb-2 { background: radial-gradient(circle at 35% 35%, #e9d5ff, #faf5ff 72%); opacity: .4; }
/* Header is a coloured band in both themes — keep its text white. */
[data-bs-theme="light"] .qpi-trk-title { color: #fff; }
[data-bs-theme="light"] .qpi-trk-ctitle { color: #2e1065; }
[data-bs-theme="light"] .qpi-trk-sub { color: rgba(255,255,255,.82); }
[data-bs-theme="light"] .qpi-trk-close { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.32); color: #fff; }
[data-bs-theme="light"] .qpi-trk-close:hover { background: rgba(255,255,255,.30); }
[data-bs-theme="light"] .qpi-trk-status-ok   { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
[data-bs-theme="light"] .qpi-trk-status-bad  { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-status-warn { background: #fef3c7; color: #92400e; border-color: #fde68a; }
[data-bs-theme="light"] .qpi-trk-status-info { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
[data-bs-theme="light"] .qpi-trk-close, [data-bs-theme="light"] .qpi-trk-cclose { background: #f3effd; border-color: #e0d9f7; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-close:hover { background: #ece5fb; }
[data-bs-theme="light"] .qpi-trk-loading { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-stat { background: rgba(255,255,255,0.62); border-color: #e7defb; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
[data-bs-theme="light"] .qpi-trk-stat-icon { background: #ede9fe; border-color: #ddd6fe; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-stat-label { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-stat-value { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-panel, [data-bs-theme="light"] .qpi-trk-csigner { background: rgba(255,255,255,0.55); border-color: #e7defb; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
/* The light border-color above resets the top accent — re-apply it so the
   colourful top border shows in light mode too (it already does in dark). */
[data-bs-theme="light"] .qpi-trk-panel-violet { border-top-color: #8b5cf6; }
[data-bs-theme="light"] .qpi-trk-panel-blue   { border-top-color: #3b82f6; }
[data-bs-theme="light"] .qpi-trk-panel-amber  { border-top-color: #f59e0b; }
[data-bs-theme="light"] .qpi-trk-panel-h { color: #3b0764; }
[data-bs-theme="light"] .qpi-trk-line { background: #e5e7eb; }
[data-bs-theme="light"] .qpi-trk-dot { background: #cbd5e1; box-shadow: 0 0 0 4px rgba(124,58,237,.06); }
[data-bs-theme="light"] .qpi-trk-step-label { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-step-idle .qpi-trk-step-label { color: #9ca3af; }
[data-bs-theme="light"] .qpi-trk-step-meta { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-table th { color: #6d28d9; border-bottom-color: #e7defb; background: linear-gradient(180deg, #efe9fd, #f7f3ff); }
[data-bs-theme="light"] .qpi-trk-htl-line { background: #e5dffb; }
[data-bs-theme="light"] .qpi-trk-htl-icon { background: #cbd5e1; }
[data-bs-theme="light"] .qpi-trk-htl-title { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-htl-idle .qpi-trk-htl-title { color: #9ca3af; }
[data-bs-theme="light"] .qpi-trk-htl-date { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-table td { color: #1f2937; border-bottom-color: #f3eefc; }
[data-bs-theme="light"] .qpi-trk-muted { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-signer-name { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-role { background: #f1ecfe; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-table tbody tr:hover td { background: #faf7ff; }
[data-bs-theme="light"] .qpi-trk-spill-ok   { background: #dcfce7; color: #15803d; }
[data-bs-theme="light"] .qpi-trk-spill-warn { background: #fef3c7; color: #92400e; }
[data-bs-theme="light"] .qpi-trk-spill-bad  { background: #fee2e2; color: #b91c1c; }
[data-bs-theme="light"] .qpi-trk-spill-info { background: #dbeafe; color: #1d4ed8; }
[data-bs-theme="light"] .qpi-trk-csigner-h { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-csigner-name { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-csigner-mail, [data-bs-theme="light"] .qpi-trk-csigner-more { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-btn-light, [data-bs-theme="light"] .qpi-trk-viewbtn {
  background: #f5f3ff; border-color: #e0d9f7; color: #5b21b6;
}
[data-bs-theme="light"] .qpi-trk-btn-light:not(:disabled):hover,
[data-bs-theme="light"] .qpi-trk-viewbtn:hover { background: #ece5fb; border-color: #c4b5fd; }

`;

export function SigningTrackerModal({ sigId, code, onClose }: { sigId: number; code: string; onClose: () => void }) {
  const [data, setData]       = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  // Two-stage: compact summary card first → "View details" opens the full panel.
  const [view, setView] = useState<'compact' | 'expanded'>('compact');

  // Freeze background page scroll while this modal is open (locks html + body).
  useScrollLock();

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    return api.get(`/clm/signature-requests/${sigId}`)
      .then(r => setData(r.data?.data ?? null))
      .catch(e => setErr(e?.response?.data?.message ?? 'Could not load signing status.'))
      .finally(() => setLoading(false));
  }, [sigId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Date + time in the app-wide format: "17-Jul-2026, 10:09 AM" — formatDmy
  // gives the DD-Mon-YYYY date; the time keeps the 12-hour AM/PM clock.
  const fmt = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return `${formatDmy(dt)}, ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };
  const fmtD = (d?: string | null) => formatDmy(d);  // date only
  const status   = String(data?.status ?? '').toLowerCase();
  const signers  = Array.isArray(data?.signers) ? data.signers : [];
  const remCount = Number(data?.reminder_count ?? 0);
  const isDeclined = status === 'declined';
  const isRecalled = status === 'recalled';
  const isDone     = status === 'completed';
  const completedAt = data?.completed_at;
  const lastRem     = data?.last_reminder_sent_at;

  /* Download the customer-signed (Zoho-executed) PDF. */
  const [dlSigned, setDlSigned] = useState(false);
  const downloadSignedPdf = () => {
    setDlSigned(true);
    api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = `${(code || `sig-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_signed.pdf`;
        a.click(); URL.revokeObjectURL(url);
      })
      .catch(() => { /* available once signed */ })
      .finally(() => setDlSigned(false));
  };

  /* Download the Zoho "Certificate of Completion" (audit trail) — a separate
   * artifact from the signed PDF, pulled from Zoho into local storage on
   * completion and served by ClmSignatureController::viewCertificate. Only
   * available once the request is completed. */
  const [dlCert, setDlCert] = useState(false);
  const downloadCertificate = () => {
    setDlCert(true);
    api.get(`/clm/signature-requests/${sigId}/certificate`, { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = `${(code || `sig-${sigId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_certificate.pdf`;
        a.click(); URL.revokeObjectURL(url);
      })
      .catch(() => { /* certificate lands once completed */ })
      .finally(() => setDlCert(false));
  };

  /* Download the DECLINED document — the version the signer reviewed & declined
   * (pulled from Zoho; a declined request has no signed PDF). `dlId` targets a
   * specific attempt so a prior declined round in the trail can be downloaded too. */
  const [dlDeclined, setDlDeclined] = useState<number | null>(null);
  /* Full decline reason shown in an in-card popup (not a native title tooltip). */
  const [reasonView, setReasonView] = useState<string | null>(null);
  const downloadDeclined = (dlId: number) => {
    setDlDeclined(dlId);
    api.get(`/clm/signature-requests/${dlId}/declined-file`, { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = `${(code || `sig-${dlId}`).replace(/[^a-z0-9\-_.]/gi, '_')}_declined.pdf`;
        a.click(); URL.revokeObjectURL(url);
      })
      .catch(() => { /* Zoho fetch may be unavailable */ })
      .finally(() => setDlDeclined(null));
  };

  const reviewed = isDone || isDeclined || isRecalled;
  /* Real "Viewed" signal — backend stamps signers[].viewed_at from Zoho's
   * action_status (UNOPENED → VIEWED → SIGNED). Earliest view across signers
   * drives the timeline so an opened-but-unsigned doc reads "Viewed on …". */
  const viewedDates: string[] = signers
    .map((s: any) => s?.viewed_at)
    .filter((v: any): v is string => !!v)
    .sort();
  const anyViewed  = viewedDates.length > 0;
  const firstViewed = anyViewed ? viewedDates[0] : null;
  /* Label covering ALL recipients (not just the first) so a multi-signer
   * document reads e.g. "Oceanic Spices Co, OceanicSpicesCo" on the timeline,
   * matching the Signer Details table. Collapses to "Name +N" past 2 to keep
   * the compact card from overflowing. */
  const signerNamesArr: string[] = signers
    .map((s: any) => s?.name ?? s?.email)
    .filter((v: any): v is string => !!v);
  const signerName: string | null =
    signerNamesArr.length === 0 ? null
    : signerNamesArr.length <= 2 ? signerNamesArr.join(', ')
    : `${signerNamesArr[0]} +${signerNamesArr.length - 1} more`;

  /* Informative timeline steps — each carries an icon, description, person,
   * date and a status badge (Done / In Progress / Pending). `download`/`dlId`
   * mark a declined step whose document can be downloaded. */
  type TStep = { key: string; icon: string; label: string; short: string; desc: string; person: string | null; persons?: string[] | null; date: string | null; state: 'done' | 'current' | 'idle'; tone: 'ok' | 'warn' | 'bad'; badge: string; download?: boolean; dlId?: number };

  /* Attempt trail — a re-send after a decline is a fresh request, so the
   * backend returns every attempt for this document (oldest→newest). The ones
   * OLDER than the request being viewed are the prior decline rounds; render
   * each as a "Declined" step so the full decline→resend history reads inline. */
  const attempts: any[] = Array.isArray(data?.attempts) ? data.attempts : [];
  const curCreatedMs = data?.created_at ? new Date(data.created_at).getTime() : 0;
  const priorAttempts = attempts
    .filter((a) => a && a.id !== sigId && a.created_at && new Date(a.created_at).getTime() < curCreatedMs)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  /* Each prior round renders its full lifecycle — Sent → (Viewed) → Declined —
   * so the trail reads: Sent→Viewed→Declined → Resent→Viewed→Declined → … */
  const historySteps: TStep[] = priorAttempts.flatMap((a, k) => {
    const st = String(a.status ?? '').toLowerCase();
    const first = k === 0;
    const out: TStep[] = [
      { key: `att-${a.id}-sent`, icon: 'send', label: first ? 'Sent for signature' : 'Resent for signature', short: first ? 'Sent' : 'Resent', desc: first ? 'Document sent via secure e-sign link' : 'Document re-sent after the previous round', person: null, date: fmt(a.created_at), state: 'done', tone: 'ok', badge: 'Done' },
    ];
    if (a.viewed_at) {
      out.push({ key: `att-${a.id}-view`, icon: 'eye', label: 'Reviewed by signer(s)', short: 'Reviewed', desc: 'Opened & reviewed by the signer(s)', person: null, date: fmt(a.viewed_at), state: 'done', tone: 'ok', badge: 'Done' });
    }
    if (st === 'recalled') {
      out.push({ key: `att-${a.id}-final`, icon: 'x', label: 'Recalled', short: 'Recalled', desc: a.recall_reason || 'The request was recalled', person: null, date: fmt(a.recalled_at || a.created_at), state: 'done', tone: 'warn', badge: 'Recalled', download: true, dlId: a.id });
    } else if (st === 'completed') {
      out.push({ key: `att-${a.id}-final`, icon: 'check', label: 'Signed & completed', short: 'Signed', desc: 'A previous round was completed', person: null, date: fmt(a.completed_at || a.created_at), state: 'done', tone: 'ok', badge: 'Done' });
    } else {
      out.push({ key: `att-${a.id}-final`, icon: 'x', label: 'Declined', short: 'Declined', desc: a.decline_reason || 'A signer declined the document', person: null, date: fmt(a.declined_at || a.created_at), state: 'done', tone: 'bad', badge: 'Declined', download: true, dlId: a.id });
    }
    return out;
  });
  const isResend = priorAttempts.length > 0;

  const currentSteps: TStep[] = [
    { key: 'sent', icon: 'send', label: isResend ? 'Resent for signature' : 'Sent for signature', short: isResend ? 'Resent' : 'Sent', desc: isResend ? 'Document re-sent after the previous round' : 'Document sent via secure e-sign link', person: null, date: fmt(data?.created_at), state: 'done', tone: 'ok', badge: 'Done' },
    {
      key: 'progress', icon: 'eye',
      // Three states: reviewed (signed/declined/recalled) → "Reviewed",
      // opened-but-unsigned → "Viewed document" with the real view time,
      // not-yet-opened → "Awaiting signature".
      label: reviewed ? 'Reviewed by signer(s)' : anyViewed ? 'Viewed document' : 'Awaiting signature',
      short: reviewed ? 'Reviewed' : anyViewed ? 'Viewed' : 'Awaiting',
      desc: reviewed ? 'Opened & reviewed by the signer(s)'
        : anyViewed ? 'Opened by the signer(s) — awaiting signature'
        : 'In progress — with the signer(s)',
      person: signerName, persons: signerNamesArr,
      date: reviewed ? fmt(firstViewed ?? data?.updated_at ?? data?.created_at) : (anyViewed ? fmt(firstViewed) : null),
      state: reviewed ? 'done' : 'current', tone: 'ok',
      badge: reviewed ? 'Done' : anyViewed ? 'Viewed' : 'In Progress',
    },
    ...(remCount > 0 ? [{
      key: 'reminders', icon: 'bell', label: `${remCount} reminder${remCount === 1 ? '' : 's'} sent`, short: 'Reminders',
      desc: 'Automatic signing reminders', person: null, date: lastRem ? fmt(lastRem) : null, state: 'done' as const, tone: 'warn' as const, badge: 'Done',
    }] : []),
    // A declined / recalled event is its OWN step…
    ...(isDeclined ? [{ key: 'declined', icon: 'x', label: 'Declined', short: 'Declined', desc: data?.decline_reason || 'A signer declined the document', person: signerName, persons: signerNamesArr, date: fmt(data?.declined_at), state: 'done' as const, tone: 'bad' as const, badge: 'Declined', download: true, dlId: sigId }] : []),
    ...(isRecalled ? [{ key: 'recalled', icon: 'x', label: 'Recalled', short: 'Recalled', desc: data?.recall_reason || 'The request was recalled', person: signerName, persons: signerNamesArr, date: fmt(data?.recalled_at), state: 'done' as const, tone: 'warn' as const, badge: 'Recalled', download: true, dlId: sigId }] : []),
    // …and "Signed & completed" ALWAYS stays as the final source of truth
    // (Pending until it actually completes) — even after a decline, since a
    // re-send can still carry the document through to completion.
    { key: 'final', icon: 'check', label: 'Signed & completed', short: 'Completed', desc: isDone ? 'All parties have executed the document' : 'Awaiting completion — the document is not yet fully signed', person: isDone ? signerName : null, persons: isDone ? signerNamesArr : null, date: isDone ? fmt(completedAt) : null, state: isDone ? 'done' as const : 'idle' as const, tone: 'ok' as const, badge: isDone ? 'Done' : 'Pending' },
  ];
  /* Full timeline = prior declined rounds (oldest→newest) then the current
   * request's steps, so a resend reads directly below the decline it followed. */
  const steps: TStep[] = [...historySteps, ...currentSteps];
  /* Progress + "Total Stages" reflect only the CURRENT round's lifecycle
   * (Sent → Reviewed → Reminder → Signed/Declined), not the accumulated trail —
   * so a re-sent document reads "3 / 4", never "9 / 9". */
  const doneCount = currentSteps.filter(s => s.state === 'done').length;
  const pctDone = Math.round((doneCount / currentSteps.length) * 100);

  const stepIcon = (k: string) => {
    const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    if (k === 'send')  return <svg {...p}><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>;
    if (k === 'eye')   return <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    if (k === 'bell')  return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    if (k === 'check') return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    if (k === 'x')     return <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    return null;
  };
  const badgeCls = (s: TStep) => s.state === 'done' ? s.tone : s.state === 'current' ? 'warn' : 'idle';

  /* Rich informative timeline (icon + title + desc + person·date + badge). */
  const InfoTimeline = () => (
    <div className="qpi-trk-itl">
      {steps.map((s, i) => (
        <div key={s.key} className={`qpi-trk-itl-step qpi-trk-itl-${s.state} qpi-trk-tone-${s.tone}`}>
          <div className="qpi-trk-itl-dotcol">
            <span className="qpi-trk-itl-icon">{stepIcon(s.icon)}</span>
            {i < steps.length - 1 && <span className="qpi-trk-itl-line" />}
          </div>
          <div className="qpi-trk-itl-body">
            <div className="qpi-trk-itl-top">
              <div className="qpi-trk-itl-title">{s.label}</div>
              <span className={`qpi-trk-itl-badge qpi-trk-itl-badge-${badgeCls(s)}`}>{s.state === 'done' ? '✓ ' : ''}{s.badge}</span>
            </div>
            {/* A long decline reason clamps to 2 lines; on a reason-bearing
                (declined / recalled) step it's clickable to open the full text
                in an in-card popup instead of a native tooltip. */}
            {s.download ? (
              <button type="button" className="qpi-trk-itl-desc qpi-trk-itl-desc-btn" onClick={() => setReasonView(s.desc)}>
                {s.desc}<span className="qpi-trk-itl-more">View full reason</span>
              </button>
            ) : (
              <div className="qpi-trk-itl-desc">{s.desc}</div>
            )}
            {(s.person || (s.persons && s.persons.length) || s.date) && (
              <div className="qpi-trk-itl-meta">
                {/* Signers stacked one-per-line (not inline) so a multi-signer
                    document lists each recipient on its own row. */}
                {s.persons && s.persons.length > 0
                  ? s.persons.map((p, idx) => (
                      <span key={idx} className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{p}</span>
                    ))
                  : s.person && <span className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{s.person}</span>}
                {s.date && <span className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>{s.date}</span>}
              </div>
            )}
            {/* Declined step → download the document the signer reviewed. */}
            {s.download && s.dlId != null && (
              <button type="button" className="qpi-trk-itl-dl" disabled={dlDeclined === s.dlId} onClick={() => downloadDeclined(s.dlId!)}>
                {dlDeclined === s.dlId
                  ? <span className="qpi-moremenu-spinner" />
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
                Download declined document
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  /* Horizontal stepper variant — used in the expanded "View details" tab. */
  const InfoTimelineH = () => (
    <div className="qpi-trk-htl">
      {steps.map((s) => (
        <div key={s.key} className={`qpi-trk-htl-step qpi-trk-htl-${s.state} qpi-trk-tone-${s.tone}`}>
          <div className="qpi-trk-htl-iconrow">
            <span className="qpi-trk-htl-line qpi-trk-htl-line-l" />
            <span className="qpi-trk-htl-icon">{s.state === 'done' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : stepIcon(s.icon)}</span>
            <span className="qpi-trk-htl-line qpi-trk-htl-line-r" />
          </div>
          <div className="qpi-trk-htl-title">{s.short}</div>
          {s.date && s.date !== '—' && <div className="qpi-trk-htl-date">{s.date}</div>}
          <span className={`qpi-trk-itl-badge qpi-trk-itl-badge-${badgeCls(s)}`}>{s.state === 'done' ? '✓ ' : ''}{s.badge}</span>
        </div>
      ))}
    </div>
  );

  const statusPill =
    isDone ? { cls: 'ok', txt: 'Completed' }
    : isDeclined ? { cls: 'bad', txt: 'Declined' }
    : isRecalled ? { cls: 'warn', txt: 'Recalled' }
    : status === 'inprogress' ? { cls: 'info', txt: 'In Progress' }
    : { cls: 'info', txt: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Sent' };

  const signerStatus = isDone ? { cls: 'ok', txt: 'Signed' } : isDeclined ? { cls: 'bad', txt: 'Declined' } : { cls: 'warn', txt: 'Pending' };

  /* Per-signer status pill — backend enriches each signer with its own Zoho
   * action_status, so a multi-signer document shows each recipient's real
   * state (Signed / Viewed / Declined / Pending) rather than the overall one.
   * Falls back to the request-level status for older payloads without it. */
  const signerPill = (sg: any): { cls: string; txt: string } => {
    // Backend stores Zoho's per-recipient `action_status` (UNOPENED →
    // VIEWED → SIGNED). Read that first; fall back to a legacy `status`
    // field and the captured viewed_at/signed_at timestamps as hints.
    const a = String(sg?.action_status ?? '').toUpperCase();
    const s = String(sg?.status ?? '').toLowerCase();
    if (a === 'SIGNED'   || s === 'signed'   || sg?.signed_at) return { cls: 'ok',   txt: 'Signed' };
    if (a === 'DECLINED' || s === 'declined')                  return { cls: 'bad',  txt: 'Declined' };
    const opened = (a !== '' && !['UNOPENED', 'NOTVIEWED', 'UNRECEIVED'].includes(a)) || s === 'viewed' || !!sg?.viewed_at;
    if (opened)          return { cls: 'info', txt: 'Viewed' };
    if (s === 'pending') return { cls: 'warn', txt: 'Pending' };
    return signerStatus; // legacy payload — no per-signer field
  };

  /* Full activity history — every lifecycle event (Sent, Viewed, each
   * Reminder, Signed/Declined/Recalled), not just reminders. The table area
   * shows ~5 rows and scrolls for the rest. Per-event timestamps that the
   * backend doesn't persist (earlier reminders, view time) show "—". */
  type Activity = { label: string; date: string; type: 'sent' | 'view' | 'reminder' | 'signed' | 'declined'; status: 'ok' | 'bad' | 'warn' };
  const activity: Activity[] = [];
  activity.push({ label: 'Document sent', date: fmt(data?.created_at), type: 'sent', status: 'ok' });
  // Per-signer label, e.g. "Radhika (buyer)" — lets a multi-signer document
  // track each recipient individually in the activity log.
  const sigLabel = (sg: any) => `${sg?.name || sg?.email || 'signer'}${sg?.role ? ` (${sg.role})` : ''}`;
  // Per-signer "Viewed by …" events — each recipient who has opened the
  // document shows here, so a 2-signer doc reads exactly who reviewed it.
  const viewedSigners = signers.filter((sg: any) => sg?.viewed_at);
  if (viewedSigners.length > 0) {
    viewedSigners.forEach((sg: any) => activity.push({ label: `Viewed by ${sigLabel(sg)}`, date: fmt(sg.viewed_at), type: 'view', status: 'ok' }));
  } else if (isDone || isDeclined || isRecalled) {
    activity.push({ label: 'Viewed by signer', date: fmt(data?.updated_at ?? data?.created_at), type: 'view', status: 'ok' });
  }
  /* Per-reminder timestamps aren't stored — only count + last. The most recent
     reminder uses the real last_reminder date; the earlier ones are spread
     (estimated) evenly between the send date and the last reminder. */
  const remStartMs = data?.created_at ? new Date(data.created_at).getTime() : NaN;
  const remEndMs   = lastRem ? new Date(lastRem).getTime() : NaN;
  const remDate = (i: number) => {
    if (i === remCount && lastRem) return fmt(lastRem);
    if (!isNaN(remStartMs) && !isNaN(remEndMs) && remCount > 1 && remEndMs > remStartMs) {
      return fmt(new Date(remStartMs + ((remEndMs - remStartMs) * i) / remCount).toISOString());
    }
    return '—';
  };
  for (let i = 1; i <= remCount; i++) {
    activity.push({ label: `Reminder #${i}`, date: remDate(i), type: 'reminder', status: 'ok' });
  }
  // Per-signer "Signed by …" events — tracks PARTIAL signing: each recipient
  // who has already signed shows here even while the document as a whole is
  // still awaiting the other signer(s).
  signers.filter((sg: any) => sg?.signed_at).forEach((sg: any) =>
    activity.push({ label: `Signed by ${sigLabel(sg)}`, date: fmt(sg.signed_at), type: 'signed', status: 'ok' }));
  if (isDone) activity.push({ label: 'Signed & completed', date: fmt(completedAt), type: 'signed', status: 'ok' });
  else if (isDeclined) activity.push({ label: 'Declined', date: fmt(data?.declined_at), type: 'declined', status: 'bad' });
  else if (isRecalled) activity.push({ label: 'Recalled', date: fmt(data?.recalled_at), type: 'declined', status: 'warn' });

  const activityIcon = (t: Activity['type']) => {
    const p = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    const svg = t === 'sent'     ? <svg {...p}><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
      : t === 'view'     ? <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      : t === 'reminder' ? <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      : t === 'declined' ? <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      : <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    return <span className={`qpi-trk-act-ic qpi-trk-act-ic-${t}`}>{svg}</span>;
  };

  const StatCard = ({ icon, label, value, accent }: { icon: ReactNode; label: string; value: ReactNode; accent: string }) => (
    <div className={`qpi-trk-stat qpi-trk-stat-${accent}`}>
      <div className="qpi-trk-stat-text"><div className="qpi-trk-stat-label">{label}</div><div className="qpi-trk-stat-value">{value}</div></div>
      <span className="qpi-trk-stat-icon">{icon}</span>
    </div>
  );

  /* Shimmer skeleton — shown while the request loads (instead of a spinner). */
  const TrackerSkeleton = () => (
    <div className="qpi-trk-skel">
      <div className="qpi-trk-sk qpi-trk-skel-bar" />
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="qpi-trk-skel-line">
          <span className="qpi-trk-sk qpi-trk-skel-dot" />
          <div className="qpi-trk-skel-lines">
            <span className="qpi-trk-sk qpi-trk-skel-l1" />
            <span className="qpi-trk-sk qpi-trk-skel-l2" />
          </div>
        </div>
      ))}
    </div>
  );

  /* In-card popup showing the FULL decline reason (replaces the native title
     tooltip so long reasons are readable). Included in both card views. */
  const reasonPopupEl = reasonView != null ? createPortal(
    <div className="qpi-trk-reason-overlay" role="dialog" aria-modal="true" onMouseDown={() => setReasonView(null)}>
      <style>{TRACKER_CSS}</style>
      <div className="qpi-trk-reason-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qpi-trk-reason-head">
          <span>Decline reason</span>
          <button type="button" className="qpi-trk-reason-x" onClick={() => setReasonView(null)} aria-label="Close">✕</button>
        </div>
        <div className="qpi-trk-reason-body">{reasonView || '—'}</div>
      </div>
    </div>,
    document.body
  ) : null;

  /* ── COMPACT card (default) — code + status, mini timeline, one signer,
        and a "View details" button that opens the full panel. ── */
  if (view === 'compact') {
    return createPortal(
      <div className="qpi-trk-overlay" role="dialog" aria-modal="true"><style>{TRACKER_CSS}</style>
        <div className="qpi-trk-card qpi-trk-card-info" onMouseDown={(e) => e.stopPropagation()}>
          {reasonPopupEl}
          {/* Coloured workflow header (Figma "Agreement Timeline" look). */}
          <div className="qpi-trk-ihead">
            <div className="qpi-trk-ihead-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <div className="qpi-trk-ihead-text">
              <div className="qpi-trk-ihead-eyebrow">{code} · SIGNING WORKFLOW</div>
              <div className="qpi-trk-ihead-title">Signing Timeline</div>
              <div className="qpi-trk-ihead-sub">e-Signature lifecycle {!loading && !err && <span className={`qpi-trk-status qpi-trk-status-${statusPill.cls}`}>{statusPill.txt}</span>}</div>
            </div>
            <button type="button" className="qpi-trk-iclose" onClick={onClose} aria-label="Close">✕</button>
          </div>

          {loading ? (
            <TrackerSkeleton />
          ) : err ? (
            <div className="qpi-trk-error">{err}</div>
          ) : (
            <>
              {/* Overall progress */}
              <div className="qpi-trk-prog">
                <div className="qpi-trk-prog-row">
                  <span className="qpi-trk-prog-lbl">OVERALL PROGRESS</span>
                  <span className="qpi-trk-prog-cnt">{doneCount} / {currentSteps.length} steps complete</span>
                </div>
                <div className="qpi-trk-prog-bar"><span style={{ width: `${pctDone}%` }} /></div>
              </div>

              <div className="qpi-trk-ibody">
                {/* Only the timeline scrolls; "View details" stays pinned below
                    so it's always reachable no matter how long the trail grows. */}
                <div className="qpi-trk-itl-scroll">
                  <InfoTimeline />
                </div>
                <button type="button" className="qpi-trk-viewbtn" onClick={() => setView('expanded')}>
                  View details
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="qpi-trk-overlay" role="dialog" aria-modal="true"><style>{TRACKER_CSS}</style>
      <div className="qpi-trk-card" onMouseDown={(e) => e.stopPropagation()}>
        {reasonPopupEl}
        <span className="qpi-trk-orb qpi-trk-orb-1" aria-hidden />
        <span className="qpi-trk-orb qpi-trk-orb-2" aria-hidden />
        <div className="qpi-trk-head">
          <div>
            <div className="qpi-trk-title">Signing Tracker Details</div>
            <div className="qpi-trk-sub">{code} {!loading && !err && <span className={`qpi-trk-status qpi-trk-status-${statusPill.cls}`}>{statusPill.txt}</span>}</div>
          </div>
          <button type="button" className="qpi-trk-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="qpi-trk-body">
          {loading ? (
            <TrackerSkeleton />
          ) : err ? (
            <div className="qpi-trk-error">{err}</div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="qpi-trk-stats">
                <StatCard accent="violet" label="Total Stages" value={currentSteps.length}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>} />
                <StatCard accent="amber" label="Reminders" value={remCount}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} />
                <StatCard accent="teal" label="Signers" value={signers.length}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>} />
                <StatCard accent={isDeclined ? 'red' : isRecalled ? 'amber' : 'green'}
                  label={isDeclined ? 'Declined On' : isRecalled ? 'Recalled On' : 'Completed On'}
                  value={isDeclined ? fmtD(data?.declined_at) : isRecalled ? fmtD(data?.recalled_at) : (isDone ? fmtD(completedAt) : '—')}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />
              </div>

              {/* Timeline — horizontal stepper for the View Details tab. */}
              <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-violet">
                <div className="qpi-trk-panel-h">Signing Timeline</div>
                <InfoTimelineH />
              </div>

              {/* Signer details table */}
              {signers.length > 0 && (
                <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-blue">
                  <div className="qpi-trk-panel-h">Signer Details</div>
                  <div className="qpi-trk-table-scroll">
                  <table className="qpi-trk-table">
                    {/* The Reason column only appears once a signer has
                        declined — otherwise the table keeps its normal shape. */}
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Viewed On</th><th>Signed On</th>{isDeclined && <th>Reason</th>}</tr></thead>
                    <tbody>
                      {signers.map((sg: any, i: number) => {
                        const pill = signerPill(sg);
                        return (
                        <tr key={i}>
                          <td>
                            <div className="qpi-trk-signer-cell">
                              <span className="qpi-trk-sav">{String(sg?.name ?? sg?.email ?? '?').charAt(0).toUpperCase()}</span>
                              <span className="qpi-trk-signer-name">{sg?.name || '—'}</span>
                            </div>
                          </td>
                          <td className="qpi-trk-muted"><span className="qpi-trk-email" title={sg?.email || ''}>{sg?.email || '—'}</span></td>
                          <td className="qpi-trk-muted"><span className="qpi-trk-role">{sg?.role || 'Signer'}</span></td>
                          <td><span className={`qpi-trk-spill qpi-trk-spill-${pill.cls}`}>{pill.txt}</span></td>
                          <td className="qpi-trk-muted">{sg?.viewed_at ? fmt(sg.viewed_at) : '—'}</td>
                          <td className="qpi-trk-muted">{sg?.signed_at ? fmt(sg.signed_at) : (isDone ? fmt(completedAt) : '—')}</td>
                          {isDeclined && <td>{pill.txt === 'Declined' && (sg?.decline_reason || data?.decline_reason)
                            ? <button type="button" className="qpi-trk-reason" onClick={() => setReasonView(sg?.decline_reason || data?.decline_reason)}>{sg?.decline_reason || data?.decline_reason}</button>
                            : <span className="qpi-trk-muted">—</span>}</td>}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* Activity history — every lifecycle event. */}
              {activity.length > 0 && (
                <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-amber">
                  <div className="qpi-trk-panel-h">Activity History {activity.length > 5 && <span className="qpi-trk-panel-cnt">{activity.length} events</span>}</div>
                  {/* ~5 rows visible; the rest scroll. */}
                  <div className="qpi-trk-rem-scroll">
                    <table className="qpi-trk-table">
                      <thead><tr><th>Activity</th><th>Date / Time</th><th>Status</th></tr></thead>
                      <tbody>
                        {activity.map((a, i) => (
                          <tr key={i}>
                            <td><span className="qpi-trk-act-cell">{activityIcon(a.type)}{a.label}</span></td>
                            <td className="qpi-trk-muted">{a.date}</td>
                            <td><span className={`qpi-trk-spill qpi-trk-spill-${a.status}`}>{a.status === 'ok' ? '✓ Done' : a.status === 'bad' ? '✕ Declined' : 'Recalled'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* While ANY action is in flight (download OR refresh) every action
            button is disabled so a second action can't fire mid-request, and
            the active one shows a spinner. Close stays enabled as an escape so
            a slow/stuck request can never trap the user. */}
        <div className="qpi-trk-foot">
          {/* Declined / recalled → offer the declined document; otherwise the
              customer-signed PDF (enabled only once completed). */}
          {isDeclined || isRecalled ? (
            <button type="button" className="qpi-trk-btn qpi-trk-btn-light" onClick={() => downloadDeclined(sigId)} disabled={dlDeclined != null || loading}>
              {dlDeclined != null ? <span className="qpi-moremenu-spinner" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
              Download declined document
            </button>
          ) : (
            <>
            <button type="button" className="qpi-trk-btn qpi-trk-btn-light" onClick={downloadSignedPdf} disabled={dlSigned || dlCert || loading || !isDone}>
              {dlSigned ? <span className="qpi-moremenu-spinner" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
              Download signed PDF
            </button>
            {/* Completion certificate — the Zoho audit-trail PDF, only once done. */}
            <button type="button" className="qpi-trk-btn qpi-trk-btn-light" onClick={downloadCertificate} disabled={dlCert || dlSigned || loading || !isDone} title={isDone ? 'Download the Zoho completion certificate' : 'Available once the document is completed'}>
              {dlCert ? <span className="qpi-moremenu-spinner" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 6 }}><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>}
              Download Certificate
            </button>
            </>
          )}
          <button type="button" className="qpi-trk-btn qpi-trk-btn-light" onClick={() => void load()} disabled={dlSigned || loading}>
            {loading && !dlSigned ? <span className="qpi-moremenu-spinner" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 6 }}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>}
            Refresh
          </button>
          <button type="button" className="qpi-trk-btn qpi-trk-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

