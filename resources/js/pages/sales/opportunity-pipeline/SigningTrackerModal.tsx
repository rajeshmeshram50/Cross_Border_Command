import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { formatDmy } from '../../../utils/formatDmy';

const TRACKER_CSS = `
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
.qpi-trk-orb { position: absolute; border-radius: 50%; pointer-events: none; opacity: .5; }
.qpi-trk-orb-1 { width: 220px; height: 220px; right: -40px; top: 30%; background: radial-gradient(circle at 35% 35%, #2a3a8a, #11163a 70%); }
.qpi-trk-orb-2 { width: 120px; height: 120px; right: 30%; top: 22%; background: radial-gradient(circle at 35% 35%, #3550b0, #141a44 70%); opacity: .35; }
.qpi-trk-head {
  position: relative; z-index: 2; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 30px 26px;
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
.qpi-trk-body {
  position: relative; z-index: 2; padding: 18px 24px 18px; overflow-y: auto;
  flex: 1 1 auto; min-height: 0; overscroll-behavior: contain;
  transform: translateZ(0); -webkit-overflow-scrolling: touch;
}
.qpi-trk-head { flex: 0 0 auto; }
.qpi-trk-error { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 40px; color: #aeb8e8; font-size: 13px; }
.qpi-trk-error { color: #fca5a5; }
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
.qpi-trk-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.qpi-trk-stat { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 14px; border-radius: 14px; background: rgba(120,140,255,0.06); border: 1px solid rgba(120,140,255,0.14); border-top-width: 3px; min-height: 76px; }
.qpi-trk-stat-text { min-width: 0; }
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
.qpi-trk-panel { background: rgba(120,140,255,0.04); border: 1px solid rgba(120,140,255,0.12); border-radius: 16px; padding: 16px 18px; margin-bottom: 14px; }
.qpi-trk-panel-acc { border-top-width: 3px; }
.qpi-trk-panel-violet { border-top-color: #8b5cf6; }
.qpi-trk-panel-blue   { border-top-color: #3b82f6; }
.qpi-trk-panel-amber  { border-top-color: #f59e0b; }
.qpi-trk-panel-h { font-size: 13.5px; font-weight: 800; color: #dbe2ff; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.qpi-trk-panel-cnt { font-size: 11px; font-weight: 700; color: #97a2d8; background: rgba(120,140,255,.10); border: 1px solid rgba(120,140,255,.20); padding: 2px 9px; border-radius: 20px; }
.qpi-trk-rem-scroll { max-height: 226px; overflow-y: auto; scrollbar-width: thin; }
.qpi-trk-rem-scroll::-webkit-scrollbar { width: 7px; }
.qpi-trk-rem-scroll::-webkit-scrollbar-thumb { background: rgba(120,140,255,.25); border-radius: 10px; }
[data-bs-theme="light"] .qpi-trk-panel-cnt { background: #ede9fe; color: #6d28d9; border-color: #ddd6fe; }
[data-bs-theme="light"] .qpi-trk-rem-scroll::-webkit-scrollbar-thumb { background: #d1c7f5; }
.qpi-trk-table-scroll { width: 100%; overflow-x: auto; }
.qpi-trk-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; }
.qpi-trk-email { display: inline-block; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.qpi-trk-table th { text-align: left; font-size: 11px; font-weight: 700; color: #b9c2f0; padding: 9px 10px; border-bottom: 1px solid rgba(120,140,255,.14); white-space: nowrap; background: linear-gradient(180deg, rgba(124,58,237,.22), rgba(99,102,241,.10)); }
.qpi-trk-table thead tr th:first-child { border-top-left-radius: 8px; }
.qpi-trk-table thead tr th:last-child { border-top-right-radius: 8px; }
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
.qpi-trk-reason { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 200px; max-width: 200px; text-align: left; padding: 0; margin: 0; background: none; border: none; cursor: pointer; font: inherit; font-style: italic; color: #fca5a5; text-decoration: underline dotted; text-underline-offset: 2px; }
.qpi-trk-reason:hover { color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-reason { color: #b91c1c; }
[data-bs-theme="light"] .qpi-trk-reason:hover { color: #dc2626; }
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
.qpi-trk-signer-cell { display: inline-flex; align-items: center; gap: 9px; }
.qpi-trk-signer-name { font-weight: 700; color: #f3f4ff; }
.qpi-trk-role { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 700; text-transform: capitalize; background: rgba(120,140,255,.14); color: #b9c2f0; }
.qpi-trk-spill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 20px; }
.qpi-trk-spill-ok   { background: rgba(34,197,94,.18);  color: #6ee7a8; }
.qpi-trk-spill-warn { background: rgba(245,158,11,.18); color: #fcd34d; }
.qpi-trk-spill-bad  { background: rgba(239,68,68,.18);  color: #fca5a5; }
.qpi-trk-spill-info { background: rgba(96,165,250,.18); color: #93c5fd; }
.qpi-trk-foot {
  position: relative; z-index: 3; flex: 0 0 auto; padding: 14px 24px 20px; display: flex; gap: 12px;
  background: #0b1030; border-top: 1px solid rgba(120,140,255,0.14);
}
[data-bs-theme="light"] .qpi-trk-foot { background: #fbf9ff; border-top-color: #e7defb; }
.qpi-trk-btn { flex: 1 1 auto; padding: 11px 12px; border-radius: 12px; font-weight: 700; font-size: 12.5px; white-space: nowrap; cursor: pointer; border: 1px solid transparent; transition: all .15s; display: inline-flex; align-items: center; justify-content: center; }
.qpi-trk-btn:disabled { opacity: .45; cursor: not-allowed; }
.qpi-trk-btn-light { background: rgba(120,140,255,0.08); border-color: rgba(120,140,255,0.20); color: #dbe2ff; }
.qpi-trk-btn-light:not(:disabled):hover { background: rgba(120,140,255,0.16); }
.qpi-trk-btn-primary { background: linear-gradient(135deg, #6366f1, #7c3aed); color: #fff; box-shadow: 0 6px 18px rgba(99,102,241,.40); }
.qpi-trk-btn-primary:hover { filter: brightness(1.08); }
.qpi-trk-card-info { width: min(480px, 95vw); }
.qpi-trk-ihead { position: relative; z-index: 2; overflow: hidden; display: flex; align-items: flex-start; gap: 14px; padding: 20px 22px; background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 55%, #8b5cf6 100%); color: #fff; }
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
.qpi-trk-itl-desc { font-size: 12.5px; color: #97a2d8; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.qpi-trk-itl-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; margin-top: 7px; }
.qpi-trk-itl-desc-btn { background: none; border: none; padding: 0; margin-top: 4px; text-align: left; width: 100%; cursor: pointer; font: inherit; }
.qpi-trk-itl-more { display: block; margin-top: 3px; font-size: 11px; font-weight: 700; color: #93b4ff; }
.qpi-trk-itl-desc-btn:hover .qpi-trk-itl-more { text-decoration: underline; }
[data-bs-theme="light"] .qpi-trk-itl-more { color: #6d28d9; }
.qpi-trk-reason-overlay { position: fixed; inset: 0; z-index: 13000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(6,9,28,0.62); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); font-family: var(--font-sans); }
.qpi-trk-reason-box { width: min(680px, 94vw); max-height: 82vh; display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: #0f1442; border: 1px solid rgba(120,140,255,.30); box-shadow: 0 40px 100px rgba(0,0,0,.55); }
.qpi-trk-reason-head { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; font-size: 13px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #ef4444, #b91c1c); }
.qpi-trk-reason-x { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.16); color: #fff; cursor: pointer; font-size: 12px; }
.qpi-trk-reason-x:hover { background: rgba(255,255,255,.28); }
.qpi-trk-reason-body { padding: 16px; overflow-y: auto; font-size: 13px; line-height: 1.55; color: #e7ecff; white-space: pre-wrap; word-break: break-word; }
[data-bs-theme="light"] .qpi-trk-reason-overlay { background: rgba(40,18,80,0.35); }
[data-bs-theme="light"] .qpi-trk-reason-box { background: #ffffff; border-color: #e3d9fb; }
[data-bs-theme="light"] .qpi-trk-reason-body { color: #1f2937; }
.qpi-trk-itl-dl { margin-top: 9px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: rgba(239,68,68,.14); border: 1px solid rgba(239,68,68,.35); color: #fca5a5; transition: background .15s; }
.qpi-trk-itl-dl:hover:not(:disabled) { background: rgba(239,68,68,.24); }
.qpi-trk-itl-dl:disabled { opacity: .6; cursor: wait; }
[data-bs-theme="light"] .qpi-trk-itl-dl { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-itl-dl:hover:not(:disabled) { background: #fecaca; }
.qpi-trk-itl-metait { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #8e9ad6; }
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

[data-bs-theme="light"] .qpi-trk-overlay { background: rgba(40,18,80,0.30); }
[data-bs-theme="light"] .qpi-trk-card {
  color: #1f2937;
  background:
    radial-gradient(120% 90% at 85% 8%, rgba(167,139,250,0.22) 0%, transparent 55%),
    radial-gradient(90% 80% at 0% 100%, rgba(196,181,253,0.20) 0%, transparent 55%),
    linear-gradient(160deg, #ffffff 0%, #f6f2ff 55%, #efe9fe 100%);
  border: 1px solid #e3d9fb;
  box-shadow: 0 32px 90px rgba(76,29,149,.20), 0 0 0 1px rgba(167,139,250,0.10) inset;
}
[data-bs-theme="light"] .qpi-trk-orb { opacity: .55; }
[data-bs-theme="light"] .qpi-trk-orb-1 { background: radial-gradient(circle at 35% 35%, #ddd6fe, #f3effe 72%); }
[data-bs-theme="light"] .qpi-trk-orb-2 { background: radial-gradient(circle at 35% 35%, #e9d5ff, #faf5ff 72%); opacity: .4; }
[data-bs-theme="light"] .qpi-trk-title { color: #fff; }
[data-bs-theme="light"] .qpi-trk-sub { color: rgba(255,255,255,.82); }
[data-bs-theme="light"] .qpi-trk-close { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.32); color: #fff; }
[data-bs-theme="light"] .qpi-trk-close:hover { background: rgba(255,255,255,.30); }
[data-bs-theme="light"] .qpi-trk-status-ok   { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
[data-bs-theme="light"] .qpi-trk-status-bad  { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
[data-bs-theme="light"] .qpi-trk-status-warn { background: #fef3c7; color: #92400e; border-color: #fde68a; }
[data-bs-theme="light"] .qpi-trk-status-info { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
[data-bs-theme="light"] .qpi-trk-close { background: #f3effd; border-color: #e0d9f7; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-close:hover { background: #ece5fb; }
[data-bs-theme="light"] .qpi-trk-stat { background: rgba(255,255,255,0.72); border-color: #e7defb; }
[data-bs-theme="light"] .qpi-trk-stat-icon { background: #ede9fe; border-color: #ddd6fe; color: #6d28d9; }
[data-bs-theme="light"] .qpi-trk-stat-label { color: #6b7280; }
[data-bs-theme="light"] .qpi-trk-stat-value { color: #1f2937; }
[data-bs-theme="light"] .qpi-trk-panel { background: rgba(255,255,255,0.68); border-color: #e7defb; }
[data-bs-theme="light"] .qpi-trk-panel-violet { border-top-color: #8b5cf6; }
[data-bs-theme="light"] .qpi-trk-panel-blue   { border-top-color: #3b82f6; }
[data-bs-theme="light"] .qpi-trk-panel-amber  { border-top-color: #f59e0b; }
[data-bs-theme="light"] .qpi-trk-panel-h { color: #3b0764; }
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
[data-bs-theme="light"] .qpi-trk-btn-light, [data-bs-theme="light"] .qpi-trk-viewbtn {
  background: #f5f3ff; border-color: #e0d9f7; color: #5b21b6;
}
[data-bs-theme="light"] .qpi-trk-btn-light:not(:disabled):hover,
[data-bs-theme="light"] .qpi-trk-viewbtn:hover { background: #ece5fb; border-color: #c4b5fd; }

`;

const UNDELIVERED_STATUSES = [
  'UNDELIVERED', 'NOTDELIVERED', 'NOT_DELIVERED', 'DELIVERYFAILED', 'DELIVERY_FAILED',
  'BOUNCED', 'MAILBOUNCED', 'MAIL_BOUNCED', 'EMAILBOUNCED', 'EMAIL_BOUNCED',
];

export function SigningTrackerModal({ sigId, code, onClose, onSettled }: {
  sigId: number;
  code: string;
  onClose: () => void;
  onSettled?: (status: string) => void;
}) {
  const [data, setData]       = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [view, setView] = useState<'compact' | 'expanded'>('compact');

  useScrollLock();

  const settledSent = useRef(false);
  useEffect(() => { settledSent.current = false; }, [sigId]);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    return api.get(`/clm/signature-requests/${sigId}`)
      .then(r => {
        const row = r.data?.data ?? null;
        setData(row);
        const st = String(row?.status ?? '').toLowerCase();
        if (st && st !== 'inprogress' && !settledSent.current) {
          settledSent.current = true;
          onSettledRef.current?.(st);
        }
      })
      .catch(e => setErr(e?.response?.data?.message ?? 'Could not load signing status.'))
      .finally(() => setLoading(false));
  }, [sigId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fmt = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return `${formatDmy(dt)}, ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };
  const fmtD = (d?: string | null) => formatDmy(d);
  const status   = String(data?.status ?? '').toLowerCase();
  const signers  = Array.isArray(data?.signers) ? data.signers : [];
  const remCount = Number(data?.reminder_count ?? 0);
  const isDeclined = status === 'declined';
  const isRecalled = status === 'recalled';
  const isDone     = status === 'completed';
  const completedAt = data?.completed_at;
  const lastRem     = data?.last_reminder_sent_at;

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
      .catch(() => {  })
      .finally(() => setDlSigned(false));
  };

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
      .catch(() => {  })
      .finally(() => setDlCert(false));
  };

  const [dlDeclined, setDlDeclined] = useState<number | null>(null);
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
      .catch(() => {  })
      .finally(() => setDlDeclined(null));
  };

  const reviewed = isDone || isDeclined || isRecalled;
  const viewedDates: string[] = signers
    .map((s: any) => s?.viewed_at)
    .filter((v: any): v is string => !!v)
    .sort();
  const anyViewed  = viewedDates.length > 0;
  const firstViewed = anyViewed ? viewedDates[0] : null;

  const undeliveredSigners = signers.filter((s: any) => !!s?.delivery_failed);
  const deliveryFailed: boolean = data?.delivery_failed === true || undeliveredSigners.length > 0;
  const undeliveredTo: string[] = Array.isArray(data?.undelivered_recipients) && data.undelivered_recipients.length > 0
    ? data.undelivered_recipients
    : undeliveredSigners.map((s: any) => String(s?.name || s?.email || 'signer'));
  const firstDeliveryFail: string | null = undeliveredSigners
    .map((s: any) => s?.delivery_failed_at)
    .filter((v: any): v is string => !!v)
    .sort()[0] ?? null;
  const signerNamesArr: string[] = signers
    .map((s: any) => s?.name ?? s?.email)
    .filter((v: any): v is string => !!v);
  const signerName: string | null =
    signerNamesArr.length === 0 ? null
    : signerNamesArr.length <= 2 ? signerNamesArr.join(', ')
    : `${signerNamesArr[0]} +${signerNamesArr.length - 1} more`;

  type TStep = { key: string; icon: string; label: string; short: string; desc: string; person: string | null; persons?: string[] | null; date: string | null; state: 'done' | 'current' | 'idle'; tone: 'ok' | 'warn' | 'bad'; badge: string; download?: boolean; dlId?: number };

  const attempts: any[] = Array.isArray(data?.attempts) ? data.attempts : [];
  const curCreatedMs = data?.created_at ? new Date(data.created_at).getTime() : 0;
  const priorAttempts = attempts
    .filter((a) => a && a.id !== sigId && a.created_at && new Date(a.created_at).getTime() < curCreatedMs)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const historySteps: TStep[] = priorAttempts.flatMap((a, k) => {
    const st = String(a.status ?? '').toLowerCase();
    const first = k === 0;
    const out: TStep[] = [
      { key: `att-${a.id}-sent`, icon: 'send', label: first ? 'Sent for signature' : 'Resent for signature', short: first ? 'Sent' : 'Resent', desc: first ? 'Document sent via secure e-sign link' : 'Document re-sent after the previous round', person: null, date: fmt(a.created_at), state: 'done', tone: 'ok', badge: 'Done' },
    ];
    if (a.viewed_at && !a.delivery_failed) {
      out.push({ key: `att-${a.id}-view`, icon: 'eye', label: 'Reviewed by signer(s)', short: 'Reviewed', desc: 'Opened & reviewed by the signer(s)', person: null, date: fmt(a.viewed_at), state: 'done', tone: 'ok', badge: 'Done' });
    }
    if (a.delivery_failed) {
      out.push({
        key: `att-${a.id}-final`, icon: 'x',
        label: 'Delivery Failed / Bounced', short: 'Bounced',
        desc: 'The e-sign email could not be delivered to the signer. Correct the email address, then re-send.',
        person: null, date: fmt(a.created_at), state: 'done', tone: 'bad',
        badge: 'Delivery Failed',
      });
    } else if (st === 'recalled') {
      out.push({ key: `att-${a.id}-final`, icon: 'x', label: 'Recalled', short: 'Recalled', desc: a.recall_reason || 'The request was recalled', person: null, date: fmt(a.recalled_at || a.created_at), state: 'done', tone: 'warn', badge: 'Recalled', download: true, dlId: a.id });
    } else if (st === 'completed') {
      out.push({ key: `att-${a.id}-final`, icon: 'check', label: 'Signed & completed', short: 'Signed', desc: 'A previous round was completed', person: null, date: fmt(a.completed_at || a.created_at), state: 'done', tone: 'ok', badge: 'Done' });
    } else if (st === 'declined' || st === 'rejected' || a.declined_at) {
      out.push({ key: `att-${a.id}-final`, icon: 'x', label: 'Declined', short: 'Declined', desc: a.decline_reason || 'A signer declined the document', person: null, date: fmt(a.declined_at || a.created_at), state: 'done', tone: 'bad', badge: 'Declined', download: true, dlId: a.id });
    } else {
      out.push({
        key: `att-${a.id}-final`,
        icon: 'x',
        label: 'Closed without signature',
        short: 'Closed',
        desc: 'This round ended without a signature and was replaced by a new request.',
        person: null,
        date: fmt(a.created_at),
        state: 'done',
        tone: 'warn',
        badge: 'Closed',
      });
    }
    return out;
  });
  const isResend = priorAttempts.length > 0;

  const currentSteps: TStep[] = [
    { key: 'sent', icon: 'send', label: isResend ? 'Resent for signature' : 'Sent for signature', short: isResend ? 'Resent' : 'Sent', desc: isResend ? 'Document re-sent after the previous round' : 'Document sent via secure e-sign link', person: null, date: fmt(data?.created_at), state: 'done', tone: 'ok', badge: 'Done' },
    deliveryFailed ? {
      key: 'progress', icon: 'x',
      label: 'Delivery Failed / Bounced', short: 'Bounced',
      desc: undeliveredTo.length > 0
        ? `The e-sign email could not be delivered to ${undeliveredTo.join(', ')}. Correct the address, then re-send.`
        : 'The e-sign email could not be delivered to the signer. Correct the address, then re-send.',
      person: signerName, persons: signerNamesArr,
      date: fmt(firstDeliveryFail ?? data?.updated_at ?? data?.created_at),
      state: 'done', tone: 'bad',
      badge: 'Delivery Failed',
    } : {
      key: 'progress', icon: 'eye',
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
    ...(isDeclined ? [{ key: 'declined', icon: 'x', label: 'Declined', short: 'Declined', desc: data?.decline_reason || 'A signer declined the document', person: signerName, persons: signerNamesArr, date: fmt(data?.declined_at), state: 'done' as const, tone: 'bad' as const, badge: 'Declined', download: true, dlId: sigId }] : []),
    ...(isRecalled ? [{ key: 'recalled', icon: 'x', label: 'Recalled', short: 'Recalled', desc: data?.recall_reason || 'The request was recalled', person: signerName, persons: signerNamesArr, date: fmt(data?.recalled_at), state: 'done' as const, tone: 'warn' as const, badge: 'Recalled', download: true, dlId: sigId }] : []),
    { key: 'final', icon: 'check', label: 'Signed & completed', short: 'Completed', desc: isDone ? 'All parties have executed the document' : 'Awaiting completion — the document is not yet fully signed', person: isDone ? signerName : null, persons: isDone ? signerNamesArr : null, date: isDone ? fmt(completedAt) : null, state: isDone ? 'done' as const : 'idle' as const, tone: 'ok' as const, badge: isDone ? 'Done' : 'Pending' },
  ];
  const steps: TStep[] = [...historySteps, ...currentSteps];
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
            {s.download ? (
              <button type="button" className="qpi-trk-itl-desc qpi-trk-itl-desc-btn" onClick={() => setReasonView(s.desc)}>
                {s.desc}<span className="qpi-trk-itl-more">View full reason</span>
              </button>
            ) : (
              <div className="qpi-trk-itl-desc">{s.desc}</div>
            )}
            {(s.person || (s.persons && s.persons.length) || s.date) && (
              <div className="qpi-trk-itl-meta">
                {s.persons && s.persons.length > 0
                  ? s.persons.map((p, idx) => (
                      <span key={idx} className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{p}</span>
                    ))
                  : s.person && <span className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{s.person}</span>}
                {s.date && <span className="qpi-trk-itl-metait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>{s.date}</span>}
              </div>
            )}
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
    : deliveryFailed ? { cls: 'bad', txt: 'Delivery Failed' }
    : status === 'inprogress' ? { cls: 'info', txt: 'In Progress' }
    : { cls: 'info', txt: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Sent' };

  const signerStatus = isDone ? { cls: 'ok', txt: 'Signed' } : isDeclined ? { cls: 'bad', txt: 'Declined' } : { cls: 'warn', txt: 'Pending' };

  const signerPill = (sg: any): { cls: string; txt: string } => {
    const a = String(sg?.action_status ?? '').toUpperCase();
    const s = String(sg?.status ?? '').toLowerCase();
    if (a === 'SIGNED'   || s === 'signed'   || sg?.signed_at) return { cls: 'ok',   txt: 'Signed' };
    if (sg?.delivery_failed || s === 'undelivered' || UNDELIVERED_STATUSES.includes(a)) {
      return { cls: 'bad', txt: 'Delivery Failed' };
    }
    if (a === 'DECLINED' || s === 'declined')                  return { cls: 'bad',  txt: 'Declined' };
    const opened = (a !== '' && !['UNOPENED', 'NOTVIEWED', 'UNRECEIVED'].includes(a)) || s === 'viewed' || !!sg?.viewed_at;
    if (opened)          return { cls: 'info', txt: 'Viewed' };
    if (s === 'pending') return { cls: 'warn', txt: 'Pending' };
    return signerStatus;
  };

  type Activity = { label: string; date: string; type: 'sent' | 'view' | 'reminder' | 'signed' | 'declined'; status: 'ok' | 'bad' | 'warn'; pill?: string };
  const activity: Activity[] = [];
  activity.push({ label: 'Document sent', date: fmt(data?.created_at), type: 'sent', status: 'ok' });
  const sigLabel = (sg: any) => `${sg?.name || sg?.email || 'signer'}${sg?.role ? ` (${/^buyer$/i.test(sg.role) ? 'customer' : sg.role})` : ''}`;
  undeliveredSigners.forEach((sg: any) => activity.push({
    label: `Delivery failed — ${sigLabel(sg)}`,
    date: fmt(sg.delivery_failed_at ?? data?.updated_at),
    type: 'declined', status: 'bad', pill: '✕ Bounced',
  }));
  const viewedSigners = signers.filter((sg: any) => sg?.viewed_at && !sg?.delivery_failed);
  if (viewedSigners.length > 0) {
    viewedSigners.forEach((sg: any) => activity.push({ label: `Viewed by ${sigLabel(sg)}`, date: fmt(sg.viewed_at), type: 'view', status: 'ok' }));
  } else if (!deliveryFailed && (isDone || isDeclined || isRecalled)) {
    activity.push({ label: 'Viewed by signer', date: fmt(data?.updated_at ?? data?.created_at), type: 'view', status: 'ok' });
  }
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

  if (view === 'compact') {
    return createPortal(
      <div className="qpi-trk-overlay" role="dialog" aria-modal="true"><style>{TRACKER_CSS}</style>
        <div className="qpi-trk-card qpi-trk-card-info" onMouseDown={(e) => e.stopPropagation()}>
          {reasonPopupEl}
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
              <div className="qpi-trk-prog">
                <div className="qpi-trk-prog-row">
                  <span className="qpi-trk-prog-lbl">OVERALL PROGRESS</span>
                  <span className="qpi-trk-prog-cnt">{doneCount} / {currentSteps.length} steps complete</span>
                </div>
                <div className="qpi-trk-prog-bar"><span style={{ width: `${pctDone}%` }} /></div>
              </div>

              <div className="qpi-trk-ibody">
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

              <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-violet">
                <div className="qpi-trk-panel-h">Signing Timeline</div>
                <InfoTimelineH />
              </div>

              {signers.length > 0 && (
                <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-blue">
                  <div className="qpi-trk-panel-h">Signer Details</div>
                  <div className="qpi-trk-table-scroll">
                  <table className="qpi-trk-table">
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

              {activity.length > 0 && (
                <div className="qpi-trk-panel qpi-trk-panel-acc qpi-trk-panel-amber">
                  <div className="qpi-trk-panel-h">Activity History {activity.length > 5 && <span className="qpi-trk-panel-cnt">{activity.length} events</span>}</div>
                  <div className="qpi-trk-rem-scroll">
                    <table className="qpi-trk-table">
                      <thead><tr><th>Activity</th><th>Date / Time</th><th>Status</th></tr></thead>
                      <tbody>
                        {activity.map((a, i) => (
                          <tr key={i}>
                            <td><span className="qpi-trk-act-cell">{activityIcon(a.type)}{a.label}</span></td>
                            <td className="qpi-trk-muted">{a.date}</td>
                            <td><span className={`qpi-trk-spill qpi-trk-spill-${a.status}`}>{a.pill ?? (a.status === 'ok' ? '✓ Done' : a.status === 'bad' ? '✕ Declined' : 'Recalled')}</span></td>
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

        <div className="qpi-trk-foot">
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

