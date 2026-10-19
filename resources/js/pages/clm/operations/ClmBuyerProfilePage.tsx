import { useState, useEffect, useMemo, useRef, CSSProperties } from 'react';
import { SegmentNameBadge } from '../../../components/ui/SegmentBadge';
import { createPortal } from 'react-dom';
import api from '../../../api';
import CustomerEvidenceVaultModal, { type CustomerVaultTarget, type TabKey as VaultTab } from '../../sales/core-masters/customer/CustomerEvidenceVaultModal';
import ConsigneeEvidenceVaultModal, { type ConsigneeVaultTarget } from '../../sales/core-masters/consignee/ConsigneeEvidenceVaultModal';
import ClmDocsPopup, { type DocCategory } from '../shared/ClmDocsPopup';
import Tooltip from '../../../components/ui/Tooltip';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { ShimmerTableRows } from '../../../components/ui/Shimmer';
import WorklistPager from '../../../components/ui/WorklistPager';
import { PER_PAGE } from '../shared/clmShared';
import useDismissPopover from '../shared/useDismissPopover';
import SearchClear from '../../../components/ui/SearchClear';

type Prog = { d: number; t: number };

type BuyerRow = {
  sr: number; id: string; db_id?: number; name: string; seg: string[]; sc: string; sb: string;
  country: string; contact?: string | null; city?: string | null; type?: string | null; risk?: string | null;
  cn: number; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
};

type ConsRow = {
  sr: number; id: string; cid: string; cids?: string[]; db_id?: number; name: string; seg: string; sc: string; sb: string;
  country: string; contact?: string | null; city?: string | null; risk?: string | null;
  same_as_customer?: boolean; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
};

type Reg = 'High' | 'Low' | 'Both';

type WsEqRow = {
  sr: number; shp: string; opp: string; customer: string; custId?: number; consId?: number; country?: string; pi: string; reg: Reg;
  kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog;
};
type ConsProg = { c_kyc?: Prog; c_dd?: Prog; c_tl?: Prog; c_td?: Prog; c_agr?: Prog };
type WsNeqRow = WsEqRow & { consignee: string } & ConsProg;
type WosEqRow = {
  sr: number; opp: string; customer: string; custId?: number; consId?: number; country?: string; pi: string; reg: Reg;
  kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog;
};
type WosNeqRow = WosEqRow & { consignee: string } & ConsProg;

type BpData = {
  buyers: BuyerRow[]; consignees: ConsRow[];
  ws_eq: WsEqRow[]; ws_neq: WsNeqRow[]; wos_eq: WosEqRow[]; wos_neq: WosNeqRow[];
};
const EMPTY_BP: BpData = { buyers: [], consignees: [], ws_eq: [], ws_neq: [], wos_eq: [], wos_neq: [] };

const BP_PER_PAGE = 10;
const SEG_CHIP_COL = 150;

const HOME_COUNTRY = 'india';
const isDomesticCountry = (c: string) => (c || '').trim().toLowerCase() === HOME_COUNTRY;
const isDomesticBuyer = isDomesticCountry;

function useDynamicPerPage(
  ref: React.RefObject<HTMLElement | null>,
  { rowHeight = 46, min = 5, footer = 56, gap = 18, deps = [] as unknown[] } = {},
): number {
  const [perPage, setPerPage] = useState(BP_PER_PAGE);
  useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;

      const footerEl = document.querySelector('footer.footer') as HTMLElement | null;
      const footerH  = footerEl ? footerEl.offsetHeight : footer;
      const sampleRow = el.querySelector('tbody tr') as HTMLElement | null;
      const rowH = Math.max(rowHeight, sampleRow?.getBoundingClientRect().height || 0);

      const avail = window.innerHeight - top - footerH - gap;
      const rows = Math.floor(avail / rowH);
      const next = Number.isFinite(rows) ? Math.max(min, rows) : BP_PER_PAGE;
      setPerPage((prev) => (prev === next ? prev : next));
    };
    return settle(calc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return perPage;
}

function settle(calc: () => void): () => void {
  calc();
  const raf = requestAnimationFrame(calc);
  const timers = [120, 350, 800, 1600].map((ms) => window.setTimeout(calc, ms));
  let debounce: number | undefined;
  const onResize = () => { window.clearTimeout(debounce); debounce = window.setTimeout(calc, 150); };
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(raf);
    timers.forEach(window.clearTimeout);
    window.clearTimeout(debounce);
    window.removeEventListener('resize', onResize);
  };
}

function useFillHeight(
  ref: React.RefObject<HTMLElement | null>,
  { gap = 14, min = 240, deps = [] as unknown[] } = {},
): number | undefined {
  const [h, setH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const next = Math.max(min, Math.round(window.innerHeight - top - gap));
      setH((prev) => (prev === next ? prev : next));
    };
    return settle(calc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return h;
}

function useExactFitRows(
  cardRef: React.RefObject<HTMLDivElement | null>,
  autoFitRef: React.MutableRefObject<boolean>,
  setRows: (n: number) => void,
  deps: unknown[],
): number | undefined {
  const [h, setH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const calc = () => {
      const el = cardRef.current;
      if (!el) return;
      const scroller = el.closest('.main-content') as HTMLElement | null;
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      const top = el.getBoundingClientRect().top;
      const next = Math.max(240, Math.round(bottom - top - 8));
      setH((prev) => (prev === next ? prev : next));

      if (!autoFitRef.current) return;
      const headerH = (el.firstElementChild as HTMLElement | null)?.offsetHeight || 0;
      const theadH  = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight || 40;
      const pagerH  = (el.querySelector('.wl-pager') as HTMLElement | null)?.offsetHeight || 56;
      const rowH    = (el.querySelector('tbody tr') as HTMLElement | null)?.offsetHeight || 46;
      const avail = next - headerH - theadH - pagerH - 4;
      setRows(Math.max(5, Math.floor(avail / rowH)));
    };
    return settle(calc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return h;
}

const BP_CSS = `
.seg-page { background: #F4F6FB; min-height: 100%; padding: 8px; margin-top: -8px; display:flex; flex-direction:column; gap:8px; font-family: var(--font-sans); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
.seg-page-card {
  background: #fff;
  border: 1px solid rgba(6,182,212,.2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(6,182,212,.08), 0 1px 3px rgba(15,23,42,.04);
}
.bref-box{background:#fff;border:none;border-radius:0;overflow:hidden;position:relative;box-shadow:none;}
.bref-box::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#67e8f9,#0891b2,#0e7490);z-index:10;}
.bref-box__header{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;padding:7px 12px;background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%);border-bottom:1px solid #A5F3FC;cursor:pointer;user-select:none;transition:background .18s;min-height:48px;}
.bref-box__header:hover{background:linear-gradient(110deg,#e8fbfd 0%,#cff9fc 30%,#c4f3f9 60%,#b3eef7 80%,#a2eaf6 100%);}
.bref-box.is-collapsed .bref-box__header{border-bottom-color:transparent;}
.bref-box__header::after{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.6),transparent);}
.bref-box__header-ico{width:36px;height:36px;border-radius:11px;flex-shrink:0;background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);display:flex;align-items:center;justify-content:center;color:#fff;position:relative;z-index:1;box-shadow:0 0 0 3px rgba(6,182,212,.20),0 4px 12px rgba(8,145,178,.36);}
.bref-box__header-mid{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;position:relative;z-index:1;}
.bref-box__header-row{display:flex;align-items:center;gap:9px;}
.bref-box__header-label{font-size:9.5px;font-weight:800;letter-spacing:-.2px;color:#0891b2;line-height:1;white-space:nowrap;flex-shrink:0;}
.bref-box__header-sep{width:1px;height:13px;background:#A5E8F5;flex-shrink:0;}
.bref-box__header-title{font-size:11px;font-weight:800;color:#0c4a6e;letter-spacing:-.2px;line-height:1;white-space:nowrap;}
.bref-box__header-sub{font-size:9.5px;font-weight:500;color:#0e7490;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bref-box__header-right{flex-shrink:0;display:flex;align-items:center;gap:6px;position:relative;z-index:1;}
.bref-box__toggle{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.75);border:1.5px solid rgba(8,145,178,.22);color:#0891b2;transition:transform .24s cubic-bezier(.22,1,.36,1),background .15s,box-shadow .15s;box-shadow:0 1px 4px rgba(8,145,178,.10),inset 0 1px 0 rgba(255,255,255,.9);}
.bref-box__header:hover .bref-box__toggle{background:rgba(255,255,255,.95);border-color:rgba(8,145,178,.40);box-shadow:0 2px 8px rgba(6,182,212,.18),inset 0 1px 0 rgba(255,255,255,.9);}
.bref-box.is-collapsed .bref-box__toggle{transform:rotate(-90deg);}
.bref-box__body{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));background:linear-gradient(180deg,#F0F9FF 0%,#F8FAFC 100%);gap:0;overflow:hidden;max-height:320px;transition:max-height .3s cubic-bezier(.22,1,.36,1),opacity .22s;opacity:1;}
.bref-box.is-collapsed .bref-box__body{max-height:0;opacity:0;}
.bref-item{position:relative;padding:10px 11px 11px;background:#fff;margin:7px 5px;border-radius:11px;border:1.5px solid #E4EFF5;transition:box-shadow .18s,border-color .18s,transform .18s;cursor:default;display:flex;flex-direction:column;gap:0;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.04);}
.bref-item:first-child{margin-left:7px;}
.bref-item:last-child{margin-right:7px;}
.bref-item:hover{border-color:#67E8F9;box-shadow:0 6px 18px rgba(6,182,212,.14),0 1px 4px rgba(15,23,42,.04);transform:translateY(-2px);}
.bref-item::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:11px 11px 0 0;background:linear-gradient(90deg,#06b6d4,#0891b2);}
.bref-item__top{display:flex;align-items:center;gap:6px;margin-bottom:0;}
.bref-item__ico{width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#0891b2;}
.bref-item__num{font-size:8.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#94A3B8;line-height:1;}
.bref-item__title{font-size:11px;font-weight:800;color:#0F172A;letter-spacing:-.2px;line-height:1.25;margin-bottom:3px;margin-top:5px;}
.bref-item__desc{font-size:9.5px;font-weight:500;color:#94A3B8;line-height:1.4;}
@media(max-width:1100px){.bref-box__body{grid-template-columns:repeat(4,1fr)}}
@media(max-width:700px){.bref-box__body{grid-template-columns:repeat(2,1fr)}}
.bpa-seg{display:flex;align-items:center;background:rgba(255,255,255,.6);border:1.5px solid rgba(6,182,212,.25);border-radius:11px;padding:4px;gap:3px;box-shadow:0 2px 8px rgba(6,182,212,.12),inset 0 1px 0 rgba(255,255,255,.9);}
.bpa-tab{position:relative;height:38px;padding:0 18px;border-radius:9px;border:none;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;transition:all .2s cubic-bezier(.22,1,.36,1);letter-spacing:.01em;overflow:hidden;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}
.bpa-tab::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.2),transparent);border-radius:inherit;pointer-events:none;}
.bpa-tab svg{flex-shrink:0;}
.bpa-tab-active{background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);color:#fff;box-shadow:0 3px 12px rgba(6,182,212,.4),0 1px 4px rgba(8,145,178,.3);}
.bpa-tab-inactive{background:transparent;color:#0e7490;box-shadow:none;}
.bpa-tab-inactive:hover{background:rgba(6,182,212,.1);color:#0891b2;}
.bpa-cards-wrap{overflow:hidden;transition:max-height .32s cubic-bezier(.22,1,.36,1),opacity .22s,padding .22s;}
.bp-buyer-row:hover{background:rgba(6,182,212,.05)!important;box-shadow:inset 3px 0 0 #0891b2;}

[data-bs-theme="dark"] .seg-page { background: transparent; }
[data-bs-theme="dark"] .seg-page-card { background: #1e293b !important; border-color: rgba(6,182,212,.18) !important; box-shadow: 0 2px 12px rgba(0,0,0,.45) !important; }
[data-bs-theme="dark"] .bref-box { background: #1e293b !important; }
[data-bs-theme="dark"] .bref-box__header { background: linear-gradient(110deg,#103a48,#0c2e3a) !important; border-bottom-color: rgba(6,182,212,.25) !important; }
[data-bs-theme="dark"] .bref-box__body { background: linear-gradient(180deg,#172033,#0f172a) !important; }
[data-bs-theme="dark"] .bref-box__toggle, [data-bs-theme="dark"] .bp-chev-toggle { background: rgba(6,182,212,.12) !important; border-color: rgba(34,211,238,.30) !important; color: #67e8f9 !important; box-shadow: none !important; }
[data-bs-theme="dark"] .bref-box__header:hover .bref-box__toggle, [data-bs-theme="dark"] .bp-chev-toggle:hover { background: rgba(6,182,212,.22) !important; border-color: rgba(34,211,238,.45) !important; }
[data-bs-theme="dark"] .bref-item { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bref-item__title { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .bref-item__desc { color: #94a3b8 !important; }
[data-bs-theme="dark"] .bref-box__header-label { color: #67e8f9 !important; }
[data-bs-theme="dark"] .bref-box__header-title { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .bref-box__header-sub   { color: #7dd3fc !important; }
[data-bs-theme="dark"] .bref-box__header-sep   { background: rgba(6,182,212,.35) !important; }
[data-bs-theme="dark"] .bpa-seg { background: rgba(255,255,255,.05) !important; }
[data-bs-theme="dark"] .bpa-tab-inactive { color: #67e8f9 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(224, 249, 253)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(206, 248, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(244, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(240, 253, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 250, 251)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(236, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 251, 253)"] { background: #16263a !important; }
[data-bs-theme="dark"] .seg-page [style*="linear-gradient(110deg"] { background: linear-gradient(110deg,#103a48,#0c2e3a) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgba(255, 255, 255, 0.5)"] { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .bref-box__header::after { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .bpa-tab::before { background: linear-gradient(180deg,rgba(255,255,255,.04),transparent) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 240, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 246, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 242, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 243, 255)"] { background: rgba(99, 102, 241, .18) !important; border-color: rgba(129, 140, 248, .35) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(79, 70, 229)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(67, 57, 202)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(124, 58, 237)"] { color: #c7d2fe !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 250, 252)"] { background: rgba(148, 163, 184, .18) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgba(6, 182, 212, 0.1)"] { background: rgba(148, 163, 184, .30) !important; }
[data-bs-theme="dark"] .seg-page [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .seg-page [style*="background:rgb(255, 255, 255)"] { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(12, 74, 110)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(15, 23, 42)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(31, 41, 55)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(71, 85, 105)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(14, 116, 144)"] { color: #cfe8f3 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(148, 163, 184)"] { color: #94c9dd !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(100, 116, 139)"] { color: #94c9dd !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(224, 247, 250)"] { background: rgba(8,145,178,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(236, 253, 245)"] { background: rgba(16,185,129,.18) !important; border-color: rgba(16,185,129,.4) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(254, 243, 199)"] { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.4) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(5, 150, 105)"] { color: #6ee7b7 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(217, 119, 6)"] { color: #fcd34d !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(240, 253, 244)"] { background: rgba(16,185,129,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(255, 251, 235)"] { background: rgba(245,158,11,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(254, 242, 242)"] { background: rgba(239,68,68,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(6, 95, 70)"]  { color: #6ee7b7 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(146, 64, 14)"] { color: #fcd34d !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(127, 29, 29)"] { color: #fca5a5 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(241, 245, 249)"] { background: rgba(148,163,184,.18) !important; border-color: rgba(148,163,184,.3) !important; }
[data-bs-theme="dark"] .seg-page-card table { background: transparent !important; }
[data-bs-theme="dark"] .seg-page-card thead tr { background: #16263a !important; }
[data-bs-theme="dark"] .seg-page-card thead th { color: #67e8f9 !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .seg-page-card tbody tr { background: transparent !important; border-bottom-color: rgba(6,182,212,.10) !important; }
[data-bs-theme="dark"] .seg-page-card tbody td { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(165, 243, 252)"] { border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bp-buyer-row:hover { background: rgba(8,145,178,.14)!important; box-shadow: inset 3px 0 0 #22d3ee; }
[data-bs-theme="dark"] .bp-prog.is-complete { background: rgba(16,185,129,.18) !important; border-color: rgba(16,185,129,.38) !important; color: #6ee7b7 !important; }
[data-bs-theme="dark"] .bp-prog.is-partial  { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.38) !important; color: #fcd34d !important; }
[data-bs-theme="dark"] .bp-prog.is-none     { background: rgba(148,163,184,.16) !important; border-color: rgba(148,163,184,.30) !important; color: #cbd5e1 !important; }
[data-bs-theme="dark"] .bcm-overlay > div { background: #1e293b !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .bcm-overlay [style*="background:rgb(255, 255, 255)"] { background: #0f172a !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(240, 253, 255)"] { background: #16263a !important; }
[data-bs-theme="dark"] .bcm-overlay table thead tr { background: #16263a !important; }
[data-bs-theme="dark"] .bcm-overlay tbody tr { background: transparent !important; border-bottom-color: rgba(6,182,212,.10) !important; }
[data-bs-theme="dark"] .bcm-overlay tbody td { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(12, 74, 110)"],
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(71, 85, 105)"],
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(100, 116, 139)"] { color: #cfe8f3 !important; }
[data-bs-theme="dark"] .seg-pop { background: #1e293b !important; border-color: rgba(6,182,212,.3) !important; box-shadow: 0 18px 50px rgba(0,0,0,.5) !important; }
[data-bs-theme="dark"] .seg-pop span { color: #cfe8f3 !important; }

.wl-pager.bp-wl { border-top-color: #a5e8f5; background: linear-gradient(90deg,#f0fdff 0%,#e6fafe 40%,#f0fdff 100%); }
.bp-wl .tc-wl-info, .bp-wl .tc-wl-rows { color: #0e7490; border-color: #a5e8f5; }
.bp-wl .tc-wl-info .tc-wl-hl, .bp-wl .tc-wl-rows select { color: #0891b2; }
.bp-wl .tc-wl-range { background: linear-gradient(135deg,#22d3ee 0%,#0891b2 55%,#0e7490 100%); box-shadow: 0 3px 12px rgba(8,145,178,.4),0 1px 0 rgba(255,255,255,.2) inset; }
.bp-wl .tc-wl-btn { border-color: #a5e8f5; color: #0891b2; }
.bp-wl .tc-wl-btn:hover:not(:disabled) { border-color: #0891b2; box-shadow: 0 4px 12px rgba(8,145,178,.25); }
[data-bs-theme="dark"] .wl-pager.bp-wl { border-top-color: rgba(6,182,212,.30); background: linear-gradient(90deg,#0b1220 0%,#0e1726 45%,#0b1220 100%); }
[data-bs-theme="dark"] .bp-wl .tc-wl-info, [data-bs-theme="dark"] .bp-wl .tc-wl-rows, [data-bs-theme="dark"] .bp-wl .tc-wl-btn { color: #67e8f9; border-color: rgba(6,182,212,.30); background: rgba(255,255,255,.05); }
[data-bs-theme="dark"] .bp-wl .tc-wl-info .tc-wl-hl, [data-bs-theme="dark"] .bp-wl .tc-wl-rows select { color: #a5f3fc; }
[data-bs-theme="dark"] .bp-wl .tc-wl-btn:hover:not(:disabled) { background: rgba(255,255,255,.10); border-color: #22d3ee; }

@media (max-width: 820px) {
  .seg-page .bpa-seg { flex-wrap: wrap; }
  .seg-page .bpa-tab { height: 34px; padding: 0 14px; font-size: 11px; }
  .seg-page input[type="text"] { width: auto !important; flex: 1 1 120px; min-width: 0; }
}
@media (max-width: 560px) {
  .seg-page .bref-box__header-sub { display: none; }
  .seg-page .bpa-tab { flex: 1 1 auto; justify-content: center; }
}
`;

const thStyle: CSSProperties = {
  padding: '9px 10px', fontSize: '7px', fontWeight: 800, letterSpacing: '.09em',
  textTransform: 'uppercase', color: '#0891b2', opacity: .85, whiteSpace: 'nowrap',
};
const thTxt: CSSProperties = { fontSize: '7px', fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#0891b2', opacity: .85 };

const cardStyle: CSSProperties = {
  position: 'relative', overflow: 'hidden', borderRadius: '8px', padding: '7px 9px',
  background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 3px rgba(6,182,212,.07)',
  transition: 'all .15s',
};
const cardTopBar: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: '2.5px', background: 'linear-gradient(90deg,#06b6d4,#0891b2)', borderRadius: '8px 8px 0 0' };
const cardIco: CSSProperties = { width: '22px', height: '22px', borderRadius: '6px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(6,182,212,.25)' };
const cardNum: CSSProperties = { fontSize: '19px', fontWeight: 900, color: '#0c4a6e', letterSpacing: '-1px', lineHeight: 1 };
const cardLabel: CSSProperties = { fontSize: '8px', fontWeight: 700, color: '#0891b2', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const pill = (color: string): CSSProperties => ({ fontSize: '6px', fontWeight: 800, padding: '1px 4px', borderRadius: '20px', letterSpacing: '.06em', color, background: '#ecfeff', border: '1px solid #A5F3FC' });

function cardHoverIn(e: React.MouseEvent<HTMLDivElement>) {
  e.currentTarget.style.transform = 'translateY(-2px)';
  e.currentTarget.style.borderColor = '#67E8F9';
  e.currentTarget.style.boxShadow = '0 5px 14px rgba(6,182,212,.14)';
}
function cardHoverOut(e: React.MouseEvent<HTMLDivElement>) {
  e.currentTarget.style.transform = '';
  e.currentTarget.style.borderColor = '#A5F3FC';
  e.currentTarget.style.boxShadow = '0 1px 3px rgba(6,182,212,.07)';
}
const neqTabStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: on ? '#fff' : '#0e7490',
  background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#e0f7fa',
  boxShadow: on ? '0 2px 8px rgba(8,145,178,.35)' : 'none',
});

function ProgCell({ obj, big = true, onClick }: { obj: Prog; big?: boolean; onClick?: () => void }) {
  const { d, t } = obj;
  const pct = t > 0 ? Math.round((d / t) * 100) : 0;
  const isComplete = pct === 100;
  const isPartial = pct > 0 && pct < 100;
  const barGrad = isComplete ? 'linear-gradient(90deg,#06b6d4,#059669)' : isPartial ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'none';
  const numC = isComplete ? '#065f46' : isPartial ? '#78350f' : '#94a3b8';
  const numBg = isComplete ? '#ecfdf5' : isPartial ? '#fffbeb' : '#f8fafc';
  const numBd = isComplete ? '#A7F3D0' : isPartial ? '#FDE68A' : '#e2e8f0';
  const barW = big ? '58px' : '48px';
  const barH = big ? '5px' : '4px';
  const minW = big ? '62px' : '52px';
  const pad = big ? '2px 8px' : '2px 7px';
  return (
    <Tooltip label={onClick ? 'View these documents in the Evidence Vault' : undefined}>
      <td
        style={{ padding: '8px 10px', textAlign: 'center', cursor: onClick ? 'pointer' : undefined }}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      >
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: big ? '5px' : '4px', minWidth: minW }}>
          <span className={`bp-prog ${isComplete ? 'is-complete' : isPartial ? 'is-partial' : 'is-none'}`} style={{ fontSize: '11px', fontWeight: 900, color: numC, background: numBg, border: `1px solid ${numBd}`, padding: pad, borderRadius: '20px', letterSpacing: '-.2px', lineHeight: 1.4 }}>
            {d}<span style={{ fontSize: '9px', fontWeight: 500, color: '#94a3b8' }}>/{t}</span>
          </span>
          <div style={{ width: barW, height: barH, borderRadius: '5px', background: 'rgba(6,182,212,.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: barGrad, borderRadius: '5px', transition: 'width .5s cubic-bezier(.22,1,.36,1)' }} />
          </div>
        </div>
      </td>
    </Tooltip>
  );
}

function NumBadge({ n }: { n: number }) {
  return (
    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg,#0e7490,#0891b2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '9px', fontWeight: 800, color: '#fff' }}>{n}</span>
    </div>
  );
}

const vaultBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px',
  borderRadius: '7px', border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg,#06b6d4,#0891b2)', boxShadow: '0 2px 6px rgba(8,145,178,.35)',
};
function VaultIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(255,255,255,.18)" />
      <polyline points="9 12 11 14 15 10" strokeWidth="2.5" />
    </svg>
  );
}

function RegBadge({ reg }: { reg: Reg }) {
  const cfg = reg === 'High'
    ? { bg: '#FEF3C7', bd: '#FDE68A', c: '#D97706', dot: '#F59E0B' }
    : reg === 'Low'
      ? { bg: '#ECFDF5', bd: '#A7F3D0', c: '#059669', dot: '#10B981' }
      : { bg: '#EEF2FF', bd: '#C7D2FE', c: '#4338CA', dot: '#6366F1' };
  return (
    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '20px', background: cfg.bg, border: `1px solid ${cfg.bd}`, fontSize: '9px', fontWeight: 700, color: cfg.c, whiteSpace: 'nowrap' }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
        {reg}
      </span>
    </td>
  );
}

function WsProgCell({ obj }: { obj: Prog }) {
  return <ProgCell obj={obj} big={false} />;
}

function EvidenceVaultBtn({ icon, onClick, disabled }: { icon: 'shield' | 'box'; onClick?: () => void; disabled?: boolean }) {
  return (
    <td style={{ padding: '8px 10px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
      <Tooltip label={icon === 'shield' ? 'Shipment Evidence Vault' : 'Opportunity Evidence Vault'}>
        <button
          onClick={onClick}
          disabled={disabled}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.3)', background: 'linear-gradient(135deg,#f0fdff,#e8fbfd)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', fontSize: '10px', fontWeight: 700, color: '#0891b2', transition: 'all .15s', whiteSpace: 'nowrap' }}
          onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.background = 'linear-gradient(135deg,#06b6d4,#0891b2)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#0891b2'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg,#f0fdff,#e8fbfd)'; e.currentTarget.style.color = '#0891b2'; e.currentTarget.style.borderColor = 'rgba(6,182,212,.3)'; }}
        >
          {icon === 'shield'
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" strokeWidth="2.5" /></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="1" /></svg>}
          Evidence Vault
        </button>
      </Tooltip>
    </td>
  );
}

const txnTableHeaderRow: CSSProperties = { background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderBottom: '1.5px solid #A5F3FC' };
const stickyThead: CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: '#f0fdff', boxShadow: '0 1.5px 0 #A5F3FC' };
const idChip: CSSProperties = { fontFamily: "'Geist Mono',monospace", fontSize: '11px', fontWeight: 800, color: '#0891b2', background: 'linear-gradient(135deg,rgba(8,145,178,.1),rgba(6,182,212,.06))', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(6,182,212,.25)' };
const oppChip: CSSProperties = { fontSize: '10.5px', fontWeight: 600, color: '#4338CA', background: '#EEF2FF', padding: '2px 7px', borderRadius: '6px', border: '1px solid #C7D2FE' };
const oppChipMono: CSSProperties = { fontFamily: "'Geist Mono',monospace", fontSize: '11px', fontWeight: 800, color: '#4338CA', background: '#EEF2FF', padding: '3px 8px', borderRadius: '6px', border: '1px solid #C7D2FE' };
const piChip: CSSProperties = { fontSize: '10.5px', fontWeight: 600, color: '#7c3aed', background: '#f5f3ff', padding: '2px 7px', borderRadius: '6px', border: '1px solid #ddd6fe' };
const customerTd: CSSProperties = { padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', textAlign: 'left', whiteSpace: 'nowrap' };

function txnRowHover(bg: string) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLTableRowElement>) => { e.currentTarget.style.background = 'rgba(224,249,253,.7)'; },
    onMouseLeave: (e: React.MouseEvent<HTMLTableRowElement>) => { e.currentTarget.style.background = bg; },
  };
}

export default function ClmBuyerProfilePage() {
  const [brefCollapsed, setBrefCollapsed] = useState(true);
  const [clmTab, setClmTab] = useState<'party' | 'txn'>('party');
  const [bpaTab, setBpaTab] = useState<'buyer' | 'consignee'>('buyer');
  const [buyerScope, setBuyerScope] = useState<'international' | 'domestic'>('international');
  const [consScope, setConsScope] = useState<'international' | 'domestic'>('international');
  type CardFilter = 'all' | 'compliant' | 'kyc' | 'dd' | 'tl' | 'td' | 'agr';
  const [cardFilter, setCardFilter] = useState<CardFilter>('all');
  const CARD_KEYS: CardFilter[] = ['all', 'compliant', 'kyc', 'dd', 'tl', 'td', 'agr'];
  const matchCard = (r: { kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog }): boolean => {
    switch (cardFilter) {
      case 'compliant': return r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t;
      case 'kyc': return r.kyc.d < r.kyc.t;
      case 'dd':  return r.dd.d < r.dd.t;
      case 'tl':  return r.tl.d < r.tl.t;
      case 'td':  return r.td.d < r.td.t;
      case 'agr': return r.agr.d < r.agr.t;
      default:    return true;
    }
  };
  const [txnScope, setTxnScope] = useState<'international' | 'domestic'>('international');
  const [shipTab, setShipTab] = useState<'with' | 'without'>('with');
  const [wsSub, setWsSub] = useState<'eq' | 'neq'>('eq');
  const [wosSub, setWosSub] = useState<'eq' | 'neq'>('eq');
  const [neqParty, setNeqParty] = useState<'buyer' | 'consignee'>('buyer');

  const [partyAnalyticsOpen, setPartyAnalyticsOpen] = useState(true);
  const [txnAnalyticsOpen, setTxnAnalyticsOpen] = useState(true);

  const [buyerPage, setBuyerPage] = useState(1);
  const [consPage, setConsPage] = useState(1);
  const buyerTableRef = useRef<HTMLDivElement>(null);
  const consTableRef = useRef<HTMLDivElement>(null);
  const buyerCardRef = useRef<HTMLDivElement>(null);
  const consCardRef = useRef<HTMLDivElement>(null);
  const [bpManualSize, setBpManualSize] = useState<number | null>(null);
  const [consManualSize, setConsManualSize] = useState<number | null>(null);
  const [bpDynamicSize, setBpDynamicSize] = useState(PER_PAGE);
  const [consDynamicSize, setConsDynamicSize] = useState(PER_PAGE);
  const buyerAutoFitRef = useRef(true);
  const consAutoFitRef = useRef(true);
  const buyerCardFill = useExactFitRows(buyerCardRef, buyerAutoFitRef, setBpDynamicSize, [bpaTab, partyAnalyticsOpen]);
  const consCardFill = useExactFitRows(consCardRef, consAutoFitRef, setConsDynamicSize, [bpaTab, partyAnalyticsOpen]);
  const bpPerPage = bpManualSize ?? bpDynamicSize;
  const consPerPage = consManualSize ?? consDynamicSize;
  const txnCardRef = useRef<HTMLDivElement>(null);
  const txnTableRef = useRef<HTMLDivElement>(null);
  const [txnManualSize, setTxnManualSize] = useState<number | null>(null);
  const txnDynamicSize = useDynamicPerPage(txnTableRef, { deps: [clmTab, txnAnalyticsOpen, shipTab, wsSub, wosSub, neqParty] });
  const txnPerPage = txnManualSize ?? txnDynamicSize;
  const txnCardFill = useFillHeight(txnCardRef, { deps: [clmTab, txnAnalyticsOpen, shipTab, wsSub, wosSub, neqParty] });
  const [buyerSearch, setBuyerSearch] = useState('');
  const [consSearch, setConsSearch] = useState('');
  const [txnSearch, setTxnSearch] = useState('');
  const [wsEqPage, setWsEqPage] = useState(1);
  const [wsNeqPage, setWsNeqPage] = useState(1);
  const [wosEqPage, setWosEqPage] = useState(1);
  const [wosNeqPage, setWosNeqPage] = useState(1);

  const [buyerVault, setBuyerVault] = useState<CustomerVaultTarget | null>(null);
  const [consVault, setConsVault]   = useState<ConsigneeVaultTarget | null>(null);
  const [buyerVaultTab, setBuyerVaultTab] = useState<VaultTab>('company-dd');
  const [consVaultTab, setConsVaultTab]   = useState<VaultTab>('company-dd');
  const [docsPopup, setDocsPopup] = useState<{ ownerType: 'customer' | 'consignee'; ownerId: number; company: string; category: DocCategory } | null>(null);
  const [segOpen, setSegOpen] = useState<{ key: string; names: string[]; x: number; y: number; flipUp: boolean } | null>(null);
  useDismissPopover(!!segOpen, () => setSegOpen(null), {
    inside: '.seg-pop',
    watch: `${clmTab}|${bpaTab}|${buyerScope}|${consScope}|${cardFilter}|${buyerPage}|${consPage}|${buyerSearch}|${consSearch}`,
  });
  const [consListBuyer, setConsListBuyer] = useState<BuyerRow | null>(null);
  const [custForCons, setCustForCons] = useState<ConsRow | null>(null);

  const openBuyerVault = (r: BuyerRow, tab: VaultTab) => {
    if (!r.db_id) return;
    setBuyerVaultTab(tab);
    setBuyerVault({
      id: r.id, db_id: r.db_id, company: r.name, segment: r.seg.join(', '), country: r.country,
      contact: r.contact ?? undefined,
      contactCity: r.city ?? undefined,
      type: r.type ?? undefined,
      risk: r.risk ?? undefined,
    });
  };
  const openConsVault = (r: ConsRow, tab: VaultTab) => {
    if (!r.db_id) return;
    const mirrorRow = r.same_as_customer ? bp.buyers.find((b) => b.id === r.cid) : undefined;
    setConsVaultTab(tab);
    setConsVault({
      id: r.id, db_id: r.db_id, company: r.name, segment: r.seg, country: r.country, customerId: r.cid,
      contact: r.contact ?? undefined,
      contactCity: r.city ?? undefined,
      risk: r.risk ?? undefined,
      sameAsCustomer: r.same_as_customer,
      mirrorCustomer: mirrorRow?.db_id
        ? {
            id: mirrorRow.db_id, code: mirrorRow.id, name: mirrorRow.name,
            segment: mirrorRow.seg.join(', '), type: mirrorRow.type ?? null,
            risk: mirrorRow.risk ?? null, country: mirrorRow.country,
            city: mirrorRow.city ?? null, contact: mirrorRow.contact ?? null,
          }
        : null,
    });
  };
  const openTxnBuyerVault = (custId?: number, custName?: string, country?: string) => {
    if (!custId) return;
    const row = bp.buyers.find((b) => b.db_id === custId);
    if (row) { openBuyerVault(row, 'company-dd'); return; }
    setBuyerVaultTab('company-dd');
    setBuyerVault({ id: '—', db_id: custId, company: custName || '—', segment: '', country: country || '' });
  };
  const openTxnConsVault = (consId?: number, consName?: string, country?: string) => {
    if (!consId) return;
    const row = bp.consignees.find((c) => c.db_id === consId);
    if (row) { openConsVault(row, 'company-dd'); return; }
    setConsVaultTab('company-dd');
    setConsVault({ id: '—', db_id: consId, company: consName || '—', segment: '', country: country || '', customerId: '' });
  };

  const openBuyerDocs = (r: BuyerRow, category: DocCategory) => {
    if (!r.db_id) return;
    setDocsPopup({ ownerType: 'customer', ownerId: r.db_id, company: r.name, category });
  };
  const openConsDocs = (r: ConsRow, category: DocCategory) => {
    if (!r.db_id) return;
    setDocsPopup({ ownerType: 'consignee', ownerId: r.db_id, company: r.name, category });
  };

  const toggleSegPop = (e: React.MouseEvent, key: string, names: string[]) => {
    e.stopPropagation();
    if (segOpen?.key === key) { setSegOpen(null); return; }
    const b = e.currentTarget.getBoundingClientRect();
    const estH = Math.min(280, 34 + names.length * 30);
    const spaceBelow = window.innerHeight - b.bottom;
    const flipUp = spaceBelow < estH + 12 && b.top > spaceBelow;
    setSegOpen({ key, names, x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp });
  };
  const renderSegCell = (key: string, names: string[]) => {
    const segs = names.map((s) => s.trim()).filter(Boolean);
    if (segs.length === 0) return <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>;
    const extra = segs.length - 1;
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle', maxWidth: '100%' }}>
      <span style={{ maxWidth: SEG_CHIP_COL, flexShrink: 1, display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
        <Tooltip label={segs[0]}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: SEG_CHIP_COL, fontSize: '9.5px', fontWeight: 600, color: '#0e7490', background: '#ecfeff', border: '1px solid #a5f3fc', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap', lineHeight: 1.6, boxSizing: 'border-box', minWidth: 0 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{segs[0]}</span><SegmentNameBadge name={segs[0]} style={{ marginLeft: 0, flexShrink: 0 }} /></span></Tooltip>
      </span>
      {extra > 0 && (
        <Tooltip label="View all segments"><button type="button" onClick={(e) => toggleSegPop(e, key, segs)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'pointer', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)', border: 'none', fontFamily: 'inherit' }}>+{extra}</button></Tooltip>
      )}
    </span>;
  };

  const [bp, setBp] = useState<BpData>(EMPTY_BP);
  const [bpLoading, setBpLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setBpLoading(true);
    api.get('/clm/buyer-profile')
      .then((r) => { if (!cancelled) setBp((r.data?.data ?? EMPTY_BP) as BpData); })
      .catch(() => { if (!cancelled) setBp(EMPTY_BP); })
      .finally(() => { if (!cancelled) setBpLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const bpBuyerData = bp.buyers;
  const bpConsData  = bp.consignees;
  const scopedBuyers = useMemo(
    () => bpBuyerData.filter((r) => buyerScope === 'domestic' ? isDomesticBuyer(r.country) : !isDomesticBuyer(r.country)),
    [bpBuyerData, buyerScope]);
  const scopedCons = useMemo(
    () => bpConsData.filter((r) => consScope === 'domestic' ? isDomesticCountry(r.country) : !isDomesticCountry(r.country)),
    [bpConsData, consScope]);
  const txnInScope = <T extends { country?: string }>(rows: T[]): T[] =>
    rows.filter((r) => txnScope === 'domestic' ? isDomesticCountry(r.country || '') : !isDomesticCountry(r.country || ''));
  const hasShipmentId = <T extends { shp?: string }>(r: T): boolean => !!r.shp && r.shp.trim() !== '' && r.shp.trim() !== '—';
  const wsEqData   = useMemo(() => txnInScope(bp.ws_eq).filter(hasShipmentId),   [bp.ws_eq, txnScope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const wsNeqData  = useMemo(() => txnInScope(bp.ws_neq).filter(hasShipmentId),  [bp.ws_neq, txnScope]);  // eslint-disable-line react-hooks/exhaustive-deps
  const wosEqData  = useMemo(() => txnInScope(bp.wos_eq),                        [bp.wos_eq, txnScope]);  // eslint-disable-line react-hooks/exhaustive-deps
  const wosNeqData = useMemo(() => txnInScope(bp.wos_neq),                       [bp.wos_neq, txnScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const txnQ = txnSearch.trim().toLowerCase();
  const txnMatch = (r: { shp?: string; opp?: string; customer?: string; consignee?: string; pi?: string; reg?: Reg; country?: string }): boolean =>
    !txnQ || [r.shp, r.opp, r.customer, r.consignee, r.pi, r.reg, r.country]
      .some((v) => (v || '').toLowerCase().includes(txnQ));
  const wsEqRows   = wsEqData.filter(txnMatch);
  const wsNeqRows  = wsNeqData.filter(txnMatch);
  const wosEqRows  = wosEqData.filter(txnMatch);
  const wosNeqRows = wosNeqData.filter(txnMatch);

  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  const buyerTotal = scopedBuyers.length;
  const buyerCompliant = scopedBuyers.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t).length;
  const partyPending = <T extends { kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog }>(
    rows: T[], pick: (r: T) => Prog,
  ) => rows.reduce((acc, r) => acc + Math.max(0, pick(r).t - pick(r).d), 0);

  const buyerKpi = useMemo(() => ({
    kyc: partyPending(scopedBuyers, (r) => r.kyc),
    dd:  partyPending(scopedBuyers, (r) => r.dd),
    tl:  partyPending(scopedBuyers, (r) => r.tl),
    td:  partyPending(scopedBuyers, (r) => r.td),
    agr: partyPending(scopedBuyers, (r) => r.agr),
  }), [scopedBuyers]);   // eslint-disable-line react-hooks/exhaustive-deps
  const { kyc: buyerKyc, dd: buyerDd, tl: buyerTl, td: buyerTd, agr: buyerAgr } = buyerKpi;

  const consTotal = scopedCons.length;
  const consCompliant = scopedCons.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t).length;
  const consKpi = useMemo(() => ({
    kyc: partyPending(scopedCons, (r) => r.kyc),
    dd:  partyPending(scopedCons, (r) => r.dd),
    tl:  partyPending(scopedCons, (r) => r.tl),
    td:  partyPending(scopedCons, (r) => r.td),
    agr: partyPending(scopedCons, (r) => r.agr),
  }), [scopedCons]);   // eslint-disable-line react-hooks/exhaustive-deps
  const { kyc: consKyc, dd: consDd, tl: consTl, td: consTd, agr: consAgr } = consKpi;

  const allTxn: (WsEqRow | WsNeqRow | WosEqRow | WosNeqRow)[] = useMemo(
    () => shipTab === 'without' ? [...wosEqData, ...wosNeqData] : [...wsEqData, ...wsNeqData],
    [shipTab, wsEqData, wsNeqData, wosEqData, wosNeqData]);
  const txnTotal = allTxn.length;
  const txnKpi = useMemo(() => {
    const sumPendingOf = (pick: (r: typeof allTxn[number]) => { d: number; t: number }) =>
      allTxn.reduce((acc, r) => acc + Math.max(0, pick(r).t - pick(r).d), 0);
    return {
      compliant: allTxn.filter((r) =>
        r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t
        && r.td.d === r.td.t && r.agr.d === r.agr.t).length,
      kyc: allTxn.filter((r) => r.kyc.d < r.kyc.t).length,
      dd:  allTxn.filter((r) => r.dd.d < r.dd.t).length,
      tl:  allTxn.filter((r) => r.tl.d < r.tl.t).length,
      td:  sumPendingOf((r) => r.td),
      agr: sumPendingOf((r) => r.agr),
    };
  }, [allTxn]);
  const txnCompliant = txnKpi.compliant;
  const txnKyc = txnKpi.kyc;
  const txnDd = txnKpi.dd;
  const txnTl = txnKpi.tl;
  const txnTd = txnKpi.td;
  const txnAgr = txnKpi.agr;

  const buyerQ = buyerSearch.trim().toLowerCase();
  const buyerFiltered = useMemo(() => scopedBuyers.filter((r) =>
    matchCard(r) && (!buyerQ ||
      r.name.toLowerCase().includes(buyerQ) ||
      r.id.toLowerCase().includes(buyerQ) ||
      r.country.toLowerCase().includes(buyerQ) ||
      r.seg.some((s) => s.toLowerCase().includes(buyerQ)))),
    [scopedBuyers, buyerQ, cardFilter]);   // eslint-disable-line react-hooks/exhaustive-deps
  const consQ = consSearch.trim().toLowerCase();
  const consFiltered = useMemo(() => scopedCons.filter((r) =>
    matchCard(r) && (!consQ ||
      r.name.toLowerCase().includes(consQ) ||
      r.id.toLowerCase().includes(consQ) ||
      r.country.toLowerCase().includes(consQ) ||
      r.seg.toLowerCase().includes(consQ))),
    [scopedCons, consQ, cardFilter]);   // eslint-disable-line react-hooks/exhaustive-deps
  const buyerListTotal = buyerFiltered.length;
  const consListTotal = consFiltered.length;

  const buyerPageSafe = Math.min(buyerPage, Math.max(1, Math.ceil(buyerListTotal / bpPerPage)));
  const consPageSafe = Math.min(consPage, Math.max(1, Math.ceil(consListTotal / consPerPage)));
  const buyerSlice = buyerFiltered.slice((buyerPageSafe - 1) * bpPerPage, (buyerPageSafe - 1) * bpPerPage + bpPerPage);
  const consSlice = consFiltered.slice((consPageSafe - 1) * consPerPage, (consPageSafe - 1) * consPerPage + consPerPage);
  const wsEqPageSafe = Math.min(wsEqPage, Math.max(1, Math.ceil(wsEqRows.length / txnPerPage)));
  const wsNeqPageSafe = Math.min(wsNeqPage, Math.max(1, Math.ceil(wsNeqRows.length / txnPerPage)));
  const wosEqPageSafe = Math.min(wosEqPage, Math.max(1, Math.ceil(wosEqRows.length / txnPerPage)));
  const wosNeqPageSafe = Math.min(wosNeqPage, Math.max(1, Math.ceil(wosNeqRows.length / txnPerPage)));
  const wsEqSlice = wsEqRows.slice((wsEqPageSafe - 1) * txnPerPage, (wsEqPageSafe - 1) * txnPerPage + txnPerPage);
  const wsNeqSlice = wsNeqRows.slice((wsNeqPageSafe - 1) * txnPerPage, (wsNeqPageSafe - 1) * txnPerPage + txnPerPage);
  const wosEqSlice = wosEqRows.slice((wosEqPageSafe - 1) * txnPerPage, (wosEqPageSafe - 1) * txnPerPage + txnPerPage);
  const wosNeqSlice = wosNeqRows.slice((wosNeqPageSafe - 1) * txnPerPage, (wosNeqPageSafe - 1) * txnPerPage + txnPerPage);

  const rowBg = (i: number) => (i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)');

  return (
    <div className="seg-page">
      <style>{BP_CSS}</style>

      <div className="seg-page-card" style={{ background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%)' }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: '58px' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px', background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)' }} />
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.5),transparent)', pointerEvents: 'none' }} />
          <span style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle,rgba(6,182,212,.07) 1px,transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', zIndex: 1, paddingLeft: '10px' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4)' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <span style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff', boxShadow: '0 0 5px rgba(34,197,94,.45)' }} />
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 500, color: '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.15 }}>Customer Profile</div>
              <div style={{ fontSize: '11px', fontWeight: 500, color: '#0e7490', opacity: .9, marginTop: '3px' }}>Track customer onboarding, compliance verification, agreements, and overall CLM readiness.</div>
            </div>
          </div>
          <div style={{ zIndex: 1, flexShrink: 0 }}>
            <div className="bpa-seg">
              <button className={`bpa-tab ${clmTab === 'party' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setClmTab('party')}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                Party wise CLM
              </button>
              <button className={`bpa-tab ${clmTab === 'txn' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setClmTab('txn')}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                Transaction wise CLM
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="seg-page-card">
        <div className={`bref-box${brefCollapsed ? ' is-collapsed' : ''}`} style={{ border: 'none', borderRadius: 0, boxShadow: 'none', margin: 0 }}>
          <div className="bref-box__header" onClick={() => setBrefCollapsed((c) => !c)}>
            <div className="bref-box__header-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <div className="bref-box__header-mid">
              <div className="bref-box__header-row">
                <div className="bref-box__header-label">Customer Profile</div>
                <div className="bref-box__header-sep" />
                <div className="bref-box__header-title">What We Are Doing Here</div>
              </div>
              <div className="bref-box__header-sub">Manage customer lifecycle, KYC verification, trade documents, agreements, compliance approvals, and trade readiness across all customers.</div>
            </div>
            <div className="bref-box__header-right">
              <div className="bref-box__toggle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
          </div>
          <div className="bref-box__body">
            {[
              { num: 'Step 01', title: 'Customer Onboarding', desc: 'Create and manage customer profiles.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
              { num: 'Step 02', title: 'KYC & Due Diligence', desc: 'Verify legal and compliance documents.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> },
              { num: 'Step 03', title: 'Trade Documentation', desc: 'Track trade licenses and operational documents.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
              { num: 'Step 04', title: 'Agreement & Compliance', desc: 'Monitor signed agreements and compliance approvals.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
              { num: 'Step 05', title: 'Trade Readiness', desc: 'Approve customers for shipment and sales operations.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> },
            ].map((s) => (
              <div className="bref-item" key={s.num}>
                <div className="bref-item__top">
                  <div className="bref-item__ico">{s.ico}</div>
                  <span className="bref-item__num">{s.num}</span>
                </div>
                <div className="bref-item__title">{s.title}</div>
                <div className="bref-item__desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {clmTab === 'txn' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: 'linear-gradient(180deg,#67e8f9,#0891b2,#0e7490)', zIndex: 10, borderRadius: '14px 0 0 14px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 12px 8px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 800, color: '#0891b2' }}>Transaction wise</span>
                    <span style={{ width: '1px', height: '12px', background: '#A5E8F5', display: 'inline-block' }} />
                    <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Analytics Overview</span>
                    <span style={{ fontSize: '7.5px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '1px 6px', borderRadius: '20px' }}>7 metrics</span>
                  </div>
                  <div style={{ fontSize: '9px', fontWeight: 500, color: '#0e7490', marginTop: '2px' }}>Live snapshot of transaction compliance status, pending actions and document health.</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '3px', padding: '3px', height: '34px', borderRadius: '9px', background: 'rgba(6,182,212,.08)', border: '1.5px solid #A5F3FC' }}>
                  {([['international', 'International Transactions'], ['domestic', 'Domestic Transactions']] as const).map(([key, label]) => {
                    const on = txnScope === key;
                    return (
                      <button key={key} onClick={() => { setTxnScope(key); setWsEqPage(1); setWsNeqPage(1); setWosEqPage(1); setWosNeqPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', border: 'none', borderRadius: '7px', fontFamily: 'inherit', fontSize: '10.5px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', color: on ? '#fff' : '#0e7490', background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 2px 8px rgba(8,145,178,.35)' : 'none' }}>
                        {key === 'international'
                          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="bp-chev-toggle" onClick={() => setTxnAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: txnAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                </div>
              </div>
            </div>
            <div style={{ maxHeight: txnAnalyticsOpen ? '200px' : '0px', opacity: txnAnalyticsOpen ? 1 : 0, padding: txnAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)', overflow: 'hidden', transition: 'max-height .32s cubic-bezier(.22,1,.36,1),opacity .22s,padding .22s' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: '6px' }}>
                {[
                  { num: pad(txnTotal), label: 'Total Transactions', tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg> },
                  { num: pad(txnCompliant), label: 'Fully Compliant', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                  { num: pad(txnKyc), label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                  { num: pad(txnDd), label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                  { num: pad(txnTl), label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                  { num: pad(txnTd), label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                  { num: pad(txnAgr), label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
                ].map((c, idx) => (
                  <div key={idx} style={cardStyle} onMouseEnter={cardHoverIn} onMouseLeave={cardHoverOut}>
                    <div style={cardTopBar} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <div style={cardIco}>{c.ico}</div>
                      <span style={pill(c.tagC)}>{c.tag}</span>
                    </div>
                    <div style={cardNum}>{c.num}</div>
                    <div style={cardLabel}>{c.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div ref={txnCardRef} className="seg-page-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: txnCardFill }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 10px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '52px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>International Transactions</span>
                    <span style={{ fontSize: '8px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>With Shipment ID</span>
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 500, color: '#0891b2', marginTop: '2px' }}>Cross-border shipment-linked transactions mapped to customers, opportunities &amp; compliance progress.</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)', transition: 'border-color .15s,box-shadow .15s', flex: 1, maxWidth: '680px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round" style={{ flexShrink: 0, opacity: .7 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input autoComplete="off" type="text" placeholder="Search by Shipment ID, Opportunity ID, Customer, Consignee, PI or Status..." value={txnSearch} onChange={(e) => { setTxnSearch(e.target.value); setWsEqPage(1); setWsNeqPage(1); setWosEqPage(1); setWosNeqPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, background: 'transparent', minWidth: 0 }} />
                <SearchClear show={txnSearch} onClear={() => { setTxnSearch(''); }} />
              </div>
            </div>

            {shipTab === 'with' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)', flexShrink: 0 }}>
                  <SubTab active={wsSub === 'eq'} kind="eq" onClick={() => setWsSub('eq')} />
                  <SubTab active={wsSub === 'neq'} kind="neq" onClick={() => setWsSub('neq')} />
                </div>

                {wsSub === 'eq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead style={stickyThead}>
                        <tr style={txnTableHeaderRow}>
                          {['SR No', 'Shipment ID', 'Opportunity ID', 'Customer', 'PI Number', 'Reg. Status', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Agreements', 'Action'].map((h, i) => (
                            <th key={i} style={{ ...thStyle, textAlign: h === 'Customer' ? 'left' : 'center' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wsEqSlice.map((r, i) => {
                          const bg = rowBg(i);
                          return (
                            <tr key={r.shp} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }} {...txnRowHover(bg)}>
                              <td style={{ padding: '9px 11px', textAlign: 'center', fontSize: '11px', color: '#b0c4d4', fontWeight: 600 }}>{r.sr}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={idChip}>{r.shp}</span></td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={oppChip}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={piChip}>{r.pi}</span></td>
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} /><WsProgCell obj={r.agr} />
                              <EvidenceVaultBtn icon="shield" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wsEqPageSafe} total={wsEqRows.length} pageSize={txnPerPage} onPage={setWsEqPage} onPageSize={(n) => { setTxnManualSize(n); setWsEqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}

                {wsSub === 'neq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: 6, padding: '10px 16px 2px' }}>
                      <button onClick={() => setNeqParty('buyer')} style={neqTabStyle(neqParty === 'buyer')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer Transactions</button>
                      <button onClick={() => setNeqParty('consignee')} style={neqTabStyle(neqParty === 'consignee')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee Transactions</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead style={stickyThead}>
                        <tr style={txnTableHeaderRow}>
                          {['SR No', 'Shipment ID', 'Opportunity ID', 'Customer', 'Consignee', 'PI Number', 'Reg. Status', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Agreements', 'Action'].map((h, i) => (
                            <th key={i} style={{ ...thStyle, textAlign: (h === 'Customer' || h === 'Consignee') ? 'left' : 'center' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wsNeqSlice.map((r, i) => {
                          const bg = rowBg(i);
                          return (
                            <tr key={r.shp} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }} {...txnRowHover(bg)}>
                              <td style={{ padding: '9px 11px', textAlign: 'center', fontSize: '11px', color: '#b0c4d4', fontWeight: 600 }}>{r.sr}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={idChip}>{r.shp}</span></td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={oppChip}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td style={customerTd}>{r.consignee}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={piChip}>{r.pi}</span></td>
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={neqParty === 'consignee' ? (r.c_kyc ?? r.kyc) : r.kyc} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_dd ?? r.dd) : r.dd} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_tl ?? r.tl) : r.tl} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_td ?? r.td) : r.td} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_agr ?? r.agr) : r.agr} />
                              {neqParty === 'consignee'
                                ? <EvidenceVaultBtn icon="shield" disabled={!r.consId} onClick={() => openTxnConsVault(r.consId, r.consignee, r.country)} />
                                : <EvidenceVaultBtn icon="shield" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wsNeqPageSafe} total={wsNeqRows.length} pageSize={txnPerPage} onPage={setWsNeqPage} onPageSize={(n) => { setTxnManualSize(n); setWsNeqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {shipTab === 'without' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)', flexShrink: 0 }}>
                  <SubTab active={wosSub === 'eq'} kind="eq" onClick={() => setWosSub('eq')} />
                  <SubTab active={wosSub === 'neq'} kind="neq" onClick={() => setWosSub('neq')} />
                </div>

                {wosSub === 'eq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead style={stickyThead}>
                        <tr style={txnTableHeaderRow}>
                          {['SR No', 'Shipment ID', 'Opportunity ID', 'Customer', 'PI Number', 'Reg. Status', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Agreements', 'Action'].map((h, i) => (
                            <th key={i} style={{ ...thStyle, textAlign: h === 'Customer' ? 'left' : 'center' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wosEqSlice.map((r, i) => {
                          const bg = rowBg(i);
                          return (
                            <tr key={r.opp} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }} {...txnRowHover(bg)}>
                              <td style={{ padding: '9px 11px', textAlign: 'center', fontSize: '11px', color: '#b0c4d4', fontWeight: 600 }}>{r.sr}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 600, color: '#b0c4d4' }}>—</span></td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={oppChipMono}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              {r.pi
                                ? <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={piChip}>{r.pi}</span></td>
                                : <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 500, color: '#b0c4d4', fontStyle: 'italic' }}>—</span></td>}
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} />
                              <WosAgrCell row={r} />
                              <EvidenceVaultBtn icon="box" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wosEqPageSafe} total={wosEqRows.length} pageSize={txnPerPage} onPage={setWosEqPage} onPageSize={(n) => { setTxnManualSize(n); setWosEqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}

                {wosSub === 'neq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: 6, padding: '10px 16px 2px' }}>
                      <button onClick={() => setNeqParty('buyer')} style={neqTabStyle(neqParty === 'buyer')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer Transactions</button>
                      <button onClick={() => setNeqParty('consignee')} style={neqTabStyle(neqParty === 'consignee')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee Transactions</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead style={stickyThead}>
                        <tr style={txnTableHeaderRow}>
                          {['SR No', 'Shipment ID', 'Opportunity ID', 'Customer', 'Consignee', 'PI Number', 'Reg. Status', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Agreements', 'Action'].map((h, i) => (
                            <th key={i} style={{ ...thStyle, textAlign: (h === 'Customer' || h === 'Consignee') ? 'left' : 'center' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wosNeqSlice.map((r, i) => {
                          const bg = rowBg(i);
                          return (
                            <tr key={r.opp} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }} {...txnRowHover(bg)}>
                              <td style={{ padding: '9px 11px', textAlign: 'center', fontSize: '11px', color: '#b0c4d4', fontWeight: 600 }}>{r.sr}</td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 600, color: '#b0c4d4' }}>—</span></td>
                              <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={oppChipMono}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td style={customerTd}>{r.consignee}</td>
                              {r.pi
                                ? <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={piChip}>{r.pi}</span></td>
                                : <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 500, color: '#b0c4d4', fontStyle: 'italic' }}>—</span></td>}
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={neqParty === 'consignee' ? (r.c_kyc ?? r.kyc) : r.kyc} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_dd ?? r.dd) : r.dd} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_tl ?? r.tl) : r.tl} /><WsProgCell obj={neqParty === 'consignee' ? (r.c_td ?? r.td) : r.td} />
                              <WosAgrCell row={neqParty === 'consignee' ? { ...r, agr: r.c_agr ?? r.agr } : r} />
                              {neqParty === 'consignee'
                                ? <EvidenceVaultBtn icon="box" disabled={!r.consId} onClick={() => openTxnConsVault(r.consId, r.consignee, r.country)} />
                                : <EvidenceVaultBtn icon="box" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wosNeqPageSafe} total={wosNeqRows.length} pageSize={txnPerPage} onPage={setWosNeqPage} onPageSize={(n) => { setTxnManualSize(n); setWosNeqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {clmTab === 'party' && (
        <div>
          <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: 'linear-gradient(180deg,#67e8f9,#0891b2,#0e7490)', zIndex: 10, borderRadius: '14px 0 0 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 12px 8px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '48px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 800, color: '#0891b2' }}>Customer & Consignee</span>
                      <span style={{ width: '1px', height: '12px', background: '#A5E8F5', display: 'inline-block' }} />
                      <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Analytics Overview</span>
                      <span style={{ fontSize: '7.5px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '1px 6px', borderRadius: '20px' }}>7 metrics</span>
                    </div>
                    <div style={{ fontSize: '9px', fontWeight: 500, color: '#0e7490', marginTop: '2px' }}>Live snapshot of compliance status, pending actions and document health.</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="bpa-seg">
                    <button className={`bpa-tab ${bpaTab === 'buyer' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => { setBpaTab('buyer'); setCardFilter('all'); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer</button>
                    <button className={`bpa-tab ${bpaTab === 'consignee' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => { setBpaTab('consignee'); setCardFilter('all'); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee</button>
                  </div>
                  <div className="bp-chev-toggle" onClick={() => setPartyAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: partyAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
              </div>
              <div className="bpa-cards-wrap" style={{ maxHeight: partyAnalyticsOpen ? '200px' : '0px', opacity: partyAnalyticsOpen ? 1 : 0, padding: partyAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)' }}>
                {bpaTab === 'buyer' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: '6px' }}>
                    {[
                      { num: pad(buyerTotal), label: `Total ${buyerScope === 'domestic' ? 'Domestic' : 'International'} Customers`, tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                      { num: pad(buyerCompliant), label: 'Compliant Customers', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                      { num: pad(buyerKyc), label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                      { num: pad(buyerDd), label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                      { num: pad(buyerTl), label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                      { num: pad(buyerTd), label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                      { num: pad(buyerAgr), label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
                    ].map((c, idx) => (
                      <div key={idx} onClick={() => { const k = CARD_KEYS[idx]; setCardFilter(cardFilter === k ? 'all' : k); setBuyerPage(1); setConsPage(1); }} style={{ ...cardStyle, cursor: 'pointer', ...(cardFilter === CARD_KEYS[idx] && CARD_KEYS[idx] !== 'all' ? { background: '#ecfeff', borderColor: '#0891b2' } : {}) }} onMouseEnter={cardHoverIn} onMouseLeave={cardHoverOut}>
                        <div style={cardTopBar} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <div style={cardIco}>{c.ico}</div>
                          <span style={pill(c.tagC)}>{c.tag}</span>
                        </div>
                        <div style={cardNum}>{c.num}</div>
                        <div style={cardLabel}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                )}
                {bpaTab === 'consignee' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: '6px' }}>
                    {[
                      { num: pad(consTotal), label: `Total ${consScope === 'domestic' ? 'Domestic' : 'International'} Consignees`, tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                      { num: pad(consCompliant), label: 'Compliant Consignees', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                      { num: pad(consKyc), label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                      { num: pad(consDd), label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                      { num: pad(consTl), label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                      { num: pad(consTd), label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                      { num: pad(consAgr), label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
                    ].map((c, idx) => (
                      <div key={idx} onClick={() => { const k = CARD_KEYS[idx]; setCardFilter(cardFilter === k ? 'all' : k); setBuyerPage(1); setConsPage(1); }} style={{ ...cardStyle, cursor: 'pointer', ...(cardFilter === CARD_KEYS[idx] && CARD_KEYS[idx] !== 'all' ? { background: '#ecfeff', borderColor: '#0891b2' } : {}) }} onMouseEnter={cardHoverIn} onMouseLeave={cardHoverOut}>
                        <div style={cardTopBar} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <div style={cardIco}>{c.ico}</div>
                          <span style={pill(c.tagC)}>{c.tag}</span>
                        </div>
                        <div style={cardNum}>{c.num}</div>
                        <div style={cardLabel}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {bpaTab === 'buyer' && (
            <div>
              <div ref={buyerCardRef} className="seg-page-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: buyerCardFill, maxHeight: buyerCardFill }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Customer List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{buyerSearch.trim() ? `${buyerListTotal} of ${buyerTotal} customers match` : `${buyerListTotal} registered across all segments`}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '38px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)', width: '380px', maxWidth: '100%', flexShrink: 0, boxSizing: 'border-box' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input autoComplete="off" type="text" placeholder="Search by name, segment, country, ID..." value={buyerSearch} onChange={(e) => { setBuyerSearch(e.target.value); setBuyerPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, minWidth: 0, background: 'transparent' }} />
                      <SearchClear show={buyerSearch} onClear={() => { setBuyerSearch(''); }} />
                    </div>
                    <div style={{ display: 'flex', gap: '3px', padding: '3px', height: '38px', borderRadius: '9px', background: 'rgba(6,182,212,.08)', border: '1.5px solid #A5F3FC' }}>
                      {([['international', 'International Customers'], ['domestic', 'Domestic Customers']] as const).map(([key, label]) => {
                        const on = buyerScope === key;
                        return (
                          <button key={key} onClick={() => { setBuyerScope(key); setBuyerPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 13px', border: 'none', borderRadius: '7px', fontFamily: 'inherit', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', color: on ? '#fff' : '#0e7490', background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 2px 8px rgba(8,145,178,.35)' : 'none' }}>
                            {key === 'international'
                              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }} ref={buyerTableRef}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                    <thead style={stickyThead}>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bpLoading && <ShimmerTableRows rows={8} cols={13} keyPrefix="buyer" />}
                      {!bpLoading && buyerSlice.map((r, i) => {
                        const bg = rowBg(i);
                        return (
                          <tr key={r.id} className="bp-buyer-row" style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(224,249,253,.7)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}>
                            <td style={{ padding: '9px 12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{(buyerPageSafe - 1) * bpPerPage + i + 1}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{r.id}</span></td>
                            <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'left', verticalAlign: 'middle', minWidth: '196px' }}>
                              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '4px', justifyContent: 'flex-start', alignItems: 'center' }}>
                                {renderSegCell(`buyer-${r.id}`, r.seg)}
                              </div>
                            </td>
                            <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <Tooltip label="View consignees for this customer"><div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform .15s,box-shadow .15s' }}
                                onClick={() => setConsListBuyer(r)}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(6,182,212,.45)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                                <span style={{ fontSize: '9px', fontWeight: 800, color: '#fff' }}>{r.cn}</span>
                              </div></Tooltip>
                            </td>
                            <ProgCell obj={r.kyc} onClick={() => openBuyerDocs(r, 'kyc')} />
                            <ProgCell obj={r.dd} onClick={() => openBuyerDocs(r, 'dd')} />
                            <ProgCell obj={r.tl} onClick={() => openBuyerDocs(r, 'tl')} />
                            <ProgCell obj={r.td} onClick={() => openBuyerDocs(r, 'td')} />
                            <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} onClick={() => openBuyerDocs(r, 'agr')} />
                            <td style={{ padding: '9px 12px' }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                <Tooltip label="Evidence Vault"><button style={vaultBtnStyle} disabled={!r.db_id} onClick={() => openBuyerVault(r, 'company-dd')}><VaultIcon /></button></Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <WorklistPager total={buyerListTotal} page={buyerPageSafe} pageSize={bpPerPage} onPage={setBuyerPage} onPageSize={(n) => { buyerAutoFitRef.current = false; setBpManualSize(n); setBuyerPage(1); }} pageSizeOptions={[5, 10, 15, 25, 50]} className="bp-wl" />
              </div>
            </div>
          )}

          {bpaTab === 'consignee' && (
            <div>
              <div ref={consCardRef} className="seg-page-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: consCardFill, maxHeight: consCardFill }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Consignee List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{consSearch.trim() ? `${consListTotal} of ${consTotal} consignees match` : `${consListTotal} registered across all customers`}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '38px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)', width: '380px', maxWidth: '100%', flexShrink: 0, boxSizing: 'border-box' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input autoComplete="off" type="text" placeholder="Search by name, segment, country, ID..." value={consSearch} onChange={(e) => { setConsSearch(e.target.value); setConsPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, minWidth: 0, background: 'transparent' }} />
                      <SearchClear show={consSearch} onClear={() => { setConsSearch(''); }} />
                    </div>
                    <div style={{ display: 'flex', gap: '3px', padding: '3px', height: '38px', borderRadius: '9px', background: 'rgba(6,182,212,.08)', border: '1.5px solid #A5F3FC' }}>
                      {([['international', 'International Consignees'], ['domestic', 'Domestic Consignees']] as const).map(([key, label]) => {
                        const on = consScope === key;
                        return (
                          <button key={key} onClick={() => { setConsScope(key); setConsPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 13px', border: 'none', borderRadius: '7px', fontFamily: 'inherit', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', color: on ? '#fff' : '#0e7490', background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : 'transparent', boxShadow: on ? '0 2px 8px rgba(8,145,178,.35)' : 'none' }}>
                            {key === 'international'
                              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }} ref={consTableRef}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                    <thead style={stickyThead}>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'Customer', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bpLoading && <ShimmerTableRows rows={8} cols={14} keyPrefix="cons" />}
                      {!bpLoading && consSlice.map((r, i) => {
                        const bg = rowBg(i);
                        const custIds = (r.cids && r.cids.length ? r.cids : (r.cid ? [r.cid] : []));
                        const custCount = custIds.filter((id) => bpBuyerData.some((b) => b.id === id)).length;
                        return (
                          <tr key={r.id} className="bp-buyer-row" style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(224,249,253,.7)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}>
                            <td style={{ padding: '9px 12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{(consPageSafe - 1) * consPerPage + i + 1}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0e7490', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{r.id}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.06)', border: '1px solid rgba(6,182,212,.14)', padding: '2px 7px', borderRadius: '5px' }}>{r.cid}</span></td>
                            <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'left', verticalAlign: 'middle', minWidth: '196px' }}>
                              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '4px', justifyContent: 'flex-start', alignItems: 'center' }}>
                                {renderSegCell(`cons-${r.id}`, r.seg.split(','))}
                              </div>
                            </td>
                            <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <Tooltip label="View customer for this consignee"><div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform .15s,box-shadow .15s' }}
                                onClick={() => setCustForCons(r)}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(6,182,212,.45)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                                <span style={{ fontSize: '9px', fontWeight: 800, color: '#fff' }}>{custCount}</span>
                              </div></Tooltip>
                            </td>
                            <ProgCell obj={r.kyc} onClick={() => openConsDocs(r, 'kyc')} />
                            <ProgCell obj={r.dd} onClick={() => openConsDocs(r, 'dd')} />
                            <ProgCell obj={r.tl} onClick={() => openConsDocs(r, 'tl')} />
                            <ProgCell obj={r.td} onClick={() => openConsDocs(r, 'td')} />
                            <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} onClick={() => openConsDocs(r, 'agr')} />
                            <td style={{ padding: '9px 12px' }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                <Tooltip label="Evidence Vault"><button style={vaultBtnStyle} disabled={!r.db_id} onClick={() => openConsVault(r, 'company-dd')}><VaultIcon /></button></Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <WorklistPager total={consListTotal} page={consPageSafe} pageSize={consPerPage} onPage={setConsPage} onPageSize={(n) => { consAutoFitRef.current = false; setConsManualSize(n); setConsPage(1); }} pageSizeOptions={[5, 10, 15, 25, 50]} className="bp-wl" />
              </div>
            </div>
          )}
        </div>
      )}

      <CustomerEvidenceVaultModal open={!!buyerVault} customer={buyerVault} initialTab={buyerVaultTab} onClose={() => setBuyerVault(null)} />
      <ConsigneeEvidenceVaultModal open={!!consVault} consignee={consVault} initialTab={consVaultTab} onClose={() => setConsVault(null)} />

      <ClmDocsPopup
        open={!!docsPopup}
        onClose={() => setDocsPopup(null)}
        category={docsPopup?.category ?? 'kyc'}
        ownerType={docsPopup?.ownerType ?? 'customer'}
        ownerId={docsPopup?.ownerId ?? null}
        company={docsPopup?.company ?? ''}
      />

      {consListBuyer && (
        <BuyerConsigneesModal
          buyer={consListBuyer}
          rows={bpConsData.filter((c) => c.cid === consListBuyer.id && !c.same_as_customer)}
          onClose={() => setConsListBuyer(null)}
        />
      )}

      {custForCons && (
        <ConsigneeCustomerModal
          consignee={custForCons}
          customers={((custForCons.cids && custForCons.cids.length ? custForCons.cids : (custForCons.cid ? [custForCons.cid] : []))
            .map((id) => bpBuyerData.find((b) => b.id === id))
            .filter((b): b is BuyerRow => !!b))}
          onClose={() => setCustForCons(null)}
        />
      )}

      {segOpen && createPortal(
        <>
          <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 200000 }} />
          <div className="seg-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 240), top: segOpen.flipUp ? undefined : segOpen.y, bottom: segOpen.flipUp ? (window.innerHeight - segOpen.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#0891b2', padding: '4px 8px 7px' }}>Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 8, background: i % 2 ? 'rgba(6,182,212,.05)' : 'transparent' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#0c4a6e', wordBreak: 'break-word' }}>{name}</span><SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function SegCell({ names, sc, sb }: { names: string[]; sc: string; sb: string }) {
  const [open, setOpen] = useState<{ x: number; y: number; flipUp: boolean } | null>(null);
  const segs = names.map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>;
  const toggle = (e: React.MouseEvent) => {
    if (open) { setOpen(null); return; }
    const b = e.currentTarget.getBoundingClientRect();
    const estH = Math.min(280, 34 + segs.length * 30);
    const spaceBelow = window.innerHeight - b.bottom;
    const flipUp = spaceBelow < estH + 12 && b.top > spaceBelow;
    setOpen({ x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp });
  };
  return <>
    <Tooltip label={segs[0]}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle', fontSize: '8.5px', fontWeight: 600, color: sc, background: sb, border: '1px solid rgba(6,182,212,.15)', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{segs[0].length > 30 ? `${segs[0].slice(0, 30)}…` : segs[0]}<SegmentNameBadge name={segs[0]} style={{ marginLeft: 0, flexShrink: 0 }} /></span></Tooltip>
    {segs.length > 1 && (
      <Tooltip label="View all segments"><button type="button" onClick={toggle} style={{ fontSize: '8.5px', fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg, #06b6d4, #0891b2)', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>+{segs.length - 1}</button></Tooltip>
    )}
    {open && createPortal(
      <>
        <div onMouseDown={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 200000 }} />
        <div className="seg-pop" style={{ position: 'fixed', left: Math.min(open.x, window.innerWidth - 240), top: open.flipUp ? undefined : open.y, bottom: open.flipUp ? (window.innerHeight - open.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#0891b2', padding: '4px 8px 7px' }}>Segments ({segs.length})</div>
          {segs.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 600, color: '#0c4a6e', padding: '5px 8px', borderRadius: 7, background: i % 2 === 0 ? 'rgba(6,182,212,.05)' : 'transparent' }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span><SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} /></div>
          ))}
        </div>
      </>,
      document.body,
    )}
  </>;
}

function BuyerConsigneesModal({ buyer, rows, onClose }: { buyer: BuyerRow; rows: ConsRow[]; onClose: () => void }) {
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const headChip: CSSProperties = { fontSize: '12px', fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.26)', borderRadius: '8px', padding: '5px 12px', whiteSpace: 'nowrap' };

  return createPortal(
    <div className="bcm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(7,30,50,.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1180, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 28px 70px rgba(15,23,42,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 22px', background: 'linear-gradient(110deg,#0c6680 0%,#0e7490 35%,#0891b2 75%,#06b6d4 100%)', color: '#fff', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.28)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em' }}>Consignees</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.86)', marginTop: 2 }}>Consignee identity, shipment delivery ownership & compliance readiness for this customer.</div>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.78)' }}>CONSIGNEES FOR</span>
            <span style={headChip}>{buyer.id}</span>
            <span style={headChip}>{buyer.name}</span>
            {buyer.country && buyer.country !== '—' && <span style={headChip}>{buyer.country}</span>}
            <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr style={txnTableHeaderRow}>
                {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs & Agreements', 'Total Shipments'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: '30px', textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>No consignees mapped to this customer yet.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)', borderBottom: '1px solid rgba(6,182,212,.07)' }}>
                  <td style={{ padding: '9px 12px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{i + 1}</span></td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0e7490', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{r.id}</span></td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.06)', border: '1px solid rgba(6,182,212,.14)', padding: '2px 7px', borderRadius: '5px' }}>{r.cid}</span></td>
                  <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'left', minWidth: '140px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'flex-start', alignItems: 'center' }}>
                      <SegCell names={r.seg.split(',')} sc={r.sc} sb={r.sb} />
                    </div>
                  </td>
                  <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                  <ProgCell obj={r.kyc} /><ProgCell obj={r.dd} /><ProgCell obj={r.tl} />
                  <ProgCell obj={{ d: r.td.d + r.agr.d, t: r.td.t + r.agr.t }} />
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#0891b2' }}>Showing <strong>{rows.length}</strong> consignee{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConsigneeCustomerModal({ consignee, customers, onClose }: { consignee: ConsRow; customers: BuyerRow[]; onClose: () => void }) {
  useScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const headChip: CSSProperties = { fontSize: '12px', fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.26)', borderRadius: '8px', padding: '5px 12px', whiteSpace: 'nowrap' };

  return createPortal(
    <div className="bcm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(7,30,50,.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1120, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 28px 70px rgba(15,23,42,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 22px', background: 'linear-gradient(110deg,#0c6680 0%,#0e7490 35%,#0891b2 75%,#06b6d4 100%)', color: '#fff', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.28)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em' }}>{customers.length > 1 ? 'Customers' : 'Customer'}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.86)', marginTop: 2 }}>{customers.length > 1 ? 'The customers this consignee is mapped to, with their compliance readiness.' : 'The customer this consignee is mapped to, with its compliance readiness.'}</div>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.78)' }}>CUSTOMER FOR</span>
            <span style={headChip}>{consignee.id}</span>
            <span style={headChip}>{consignee.name}</span>
            <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr style={txnTableHeaderRow}>
                {['Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs & Agreements', 'Total Shipments'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '30px', textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>None of this consignee's mapped customers are in the current list scope.</td></tr>
              ) : customers.map((customer) => (
                <tr key={customer.id} style={{ background: '#fff', borderBottom: '1px solid rgba(6,182,212,.07)' }}>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{customer.id}</span></td>
                  <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{customer.name}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'left', minWidth: '140px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'flex-start', alignItems: 'center' }}>
                      <SegCell names={customer.seg} sc={customer.sc} sb={customer.sb} />
                    </div>
                  </td>
                  <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{customer.country}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={customer.cn} /></td>
                  <ProgCell obj={customer.kyc} /><ProgCell obj={customer.dd} /><ProgCell obj={customer.tl} />
                  <ProgCell obj={{ d: customer.td.d + customer.agr.d, t: customer.td.t + customer.agr.t }} />
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={customer.ship} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#0891b2' }}>Consignee <strong>{consignee.id}</strong> → <strong>{customers.length}</strong> mapped customer{customers.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SubTab({ active, kind, onClick }: { active: boolean; kind: 'eq' | 'neq'; onClick: () => void }) {
  const isEq = kind === 'eq';
  return (
    <button onClick={onClick} style={{
      position: 'relative', padding: '9px 18px 10px', fontFamily: 'inherit', fontSize: '12px',
      fontWeight: active ? 700 : 600, border: 'none', background: 'transparent', cursor: 'pointer',
      color: active ? '#0891b2' : '#64748b', borderBottom: active ? '2.5px solid #0891b2' : '2.5px solid transparent',
      marginBottom: '-1.5px', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'color .15s', whiteSpace: 'nowrap',
    }}>
      {isEq
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="11" x2="23" y2="11" /><line x1="17" y1="15" x2="23" y2="15" /></svg>}
      {isEq ? 'Customer = Consignee' : 'Customer ≠ Consignee'}
      {isEq
        ? <span style={{ fontSize: '7.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '20px', background: 'rgba(6,182,212,.12)', border: '1px solid rgba(6,182,212,.25)', color: '#0891b2', letterSpacing: '.04em' }}>SAME</span>
        : <span style={{ fontSize: '7.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '20px', background: 'rgba(148,163,184,.1)', border: '1px solid rgba(148,163,184,.2)', color: '#64748b', letterSpacing: '.04em' }}>DIFF</span>}
    </button>
  );
}

function WosAgrCell({ row }: { row: WosEqRow }) {
  if (!row.pi) {
    return (
      <td style={{ padding: '9px 11px', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 500, color: '#b0c4d4', fontStyle: 'italic' }}>No PI</span>
      </td>
    );
  }
  return <WsProgCell obj={row.agr} />;
}
