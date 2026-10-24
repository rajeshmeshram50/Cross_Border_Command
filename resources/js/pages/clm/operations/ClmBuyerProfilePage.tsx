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
:where(.bpx-1) { font-size: 9px !important; font-weight: 500 !important; color: #94a3b8 !important; }
:where(.bpx-2) { width: 24px !important; height: 24px !important; border-radius: 6px !important; background: linear-gradient(135deg,#0e7490,#0891b2) !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
:where(.bpx-3) { font-size: 9px !important; font-weight: 800 !important; color: #fff !important; }
:where(.bpx-4) { padding: 8px 10px !important; text-align: center !important; }
:where(.bpx-5) { font-size: 10px !important; color: #94a3b8 !important; }
:where(.bpx-6) { display: inline-flex !important; align-items: center !important; gap: 6px !important; vertical-align: middle !important; max-width: 100% !important; }
:where(.bpx-7) { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; min-width: 0 !important; }
:where(.bpx-8) { display: inline-flex !important; align-items: center !important; justify-content: center !important; min-width: 20px !important; height: 20px !important; padding: 0 6px !important; border-radius: 20px !important; background: linear-gradient(135deg, #06b6d4, #0891b2, #0e7490) !important; color: #fff !important; font-size: 10px !important; font-weight: 800 !important; cursor: pointer !important; flex-shrink: 0 !important; box-shadow: 0 2px 8px rgba(8,145,178,.4) !important; border: none !important; font-family: inherit !important; }
:where(.bpx-9) { background: linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%) !important; }
:where(.bpx-10) { position: relative !important; overflow: hidden !important; display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 0 18px !important; min-height: 58px !important; }
:where(.bpx-11) { position: absolute !important; left: 0 !important; top: 0 !important; bottom: 0 !important; width: 5px !important; background: linear-gradient(180deg,#22d3ee,#0891b2,#0e7490) !important; }
:where(.bpx-12) { position: absolute !important; top: 0 !important; left: 0 !important; right: 0 !important; height: 50% !important; background: linear-gradient(180deg,rgba(255,255,255,.5),transparent) !important; pointer-events: none !important; }
:where(.bpx-13) { position: absolute !important; inset: 0 !important; background-image: radial-gradient(circle,rgba(6,182,212,.07) 1px,transparent 1px) !important; background-size: 18px 18px !important; pointer-events: none !important; }
:where(.bpx-14) { display: flex !important; align-items: center !important; gap: 14px !important; z-index: 1 !important; padding-left: 10px !important; }
:where(.bpx-15) { position: relative !important; flex-shrink: 0 !important; }
:where(.bpx-16) { width: 42px !important; height: 42px !important; border-radius: 12px !important; display: flex !important; align-items: center !important; justify-content: center !important; background: linear-gradient(135deg,#06b6d4,#0891b2,#0e7490) !important; box-shadow: 0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4) !important; }
:where(.bpx-17) { position: absolute !important; bottom: -1px !important; right: -1px !important; width: 10px !important; height: 10px !important; border-radius: 50% !important; background: linear-gradient(135deg,#4ade80,#22c55e) !important; border: 2px solid #cef8ff !important; box-shadow: 0 0 5px rgba(34,197,94,.45) !important; }
:where(.bpx-18) { font-size: 16px !important; font-weight: 500 !important; color: #0c4a6e !important; letter-spacing: -.4px !important; line-height: 1.15 !important; }
:where(.bpx-19) { font-size: 11px !important; font-weight: 500 !important; color: #0e7490 !important; opacity: 0.9 !important; margin-top: 3px !important; }
:where(.bpx-20) { z-index: 1 !important; flex-shrink: 0 !important; }
:where(.bpx-21) { border: none !important; border-radius: 0 !important; box-shadow: none !important; margin: 0 !important; }
:where(.bpx-22) { display: flex !important; flex-direction: column !important; gap: 8px !important; }
:where(.bpx-23) { padding: 0 !important; overflow: hidden !important; position: relative !important; }
:where(.bpx-24) { position: absolute !important; left: 0 !important; top: 0 !important; bottom: 0 !important; width: 4px !important; background: linear-gradient(180deg,#67e8f9,#0891b2,#0e7490) !important; z-index: 10 !important; border-radius: 14px 0 0 14px !important; }
:where(.bpx-25) { display: flex !important; align-items: center !important; justify-content: space-between !important; flex-wrap: wrap !important; gap: 8px !important; padding: 8px 12px 8px 20px !important; background: linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%) !important; border-bottom: 1px solid #A5F3FC !important; min-height: 48px !important; }
:where(.bpx-26) { display: flex !important; align-items: center !important; gap: 10px !important; }
:where(.bpx-27) { width: 34px !important; height: 34px !important; border-radius: 10px !important; background: linear-gradient(135deg,#06b6d4,#0891b2) !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; box-shadow: 0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32) !important; }
:where(.bpx-28) { display: flex !important; align-items: center !important; gap: 7px !important; }
:where(.bpx-29) { font-size: 9px !important; font-weight: 800 !important; color: #0891b2 !important; }
:where(.bpx-30) { width: 1px !important; height: 12px !important; background: #A5E8F5 !important; display: inline-block !important; }
:where(.bpx-31) { font-size: 10.5px !important; font-weight: 800 !important; color: #0c4a6e !important; letter-spacing: -.2px !important; }
:where(.bpx-32) { font-size: 7.5px !important; font-weight: 700 !important; color: #0891b2 !important; background: rgba(6,182,212,.1) !important; border: 1px solid rgba(6,182,212,.25) !important; padding: 1px 6px !important; border-radius: 20px !important; }
:where(.bpx-33) { font-size: 9px !important; font-weight: 500 !important; color: #0e7490 !important; margin-top: 2px !important; }
:where(.bpx-34) { display: flex !important; align-items: center !important; gap: 8px !important; }
/* The tab rail leads its group and the search closes it, as on every other
   CLM toolbar. The search is written first here, and .bpx-34 is shared by
   several groups, so this orders the rail rather than moving markup. */
:where(.bpx-34) .bpx-64 { order: -1 !important; }
/* The same rail as .bpx-64 — the transaction-wise scope switch is the same
   control as the party-wise one and was 4px shorter on a different track. */
:where(.bpx-35) { display: flex !important; align-items: center !important; gap: 8px !important; height: 48px !important; box-sizing: border-box !important; padding: 3px !important; border-radius: 11px !important; background: linear-gradient(180deg, #f6feff, #f0fdff) !important; border: 1px solid #c9f8fd !important; }
:where(.bpx-36) { width: 26px !important; height: 26px !important; border-radius: 7px !important; background: rgba(255,255,255,.75) !important; border: 1.5px solid rgba(8,145,178,.22) !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; color: #0891b2 !important; transition: all .15s !important; flex-shrink: 0 !important; }
:where(.bpx-37) { display: grid !important; grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)) !important; gap: 8px !important; }
:where(.bpx-38) { display: flex !important; align-items: flex-start !important; justify-content: space-between !important; gap: 10px !important; margin-bottom: 0 !important; }
:where(.bpx-38) svg { width: 18px !important; height: 18px !important; }
:where(.bpx-39) { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 10px 16px 10px 20px !important; background: linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%) !important; border-bottom: 1px solid #A5F3FC !important; min-height: 52px !important; flex-shrink: 0 !important; }
:where(.bpx-40) { font-size: 13px !important; font-weight: 800 !important; color: #0c4a6e !important; letter-spacing: -.2px !important; }
:where(.bpx-41) { font-size: 8px !important; font-weight: 700 !important; color: #0891b2 !important; background: rgba(6,182,212,.1) !important; border: 1px solid rgba(6,182,212,.25) !important; padding: 2px 7px !important; border-radius: 20px !important; white-space: nowrap !important; }
:where(.bpx-42) { font-size: 10px !important; font-weight: 500 !important; color: #0891b2 !important; margin-top: 2px !important; }
:where(.bpx-43) { display: flex !important; align-items: center !important; gap: 8px !important; height: 36px !important; padding: 0 14px !important; border-radius: 9px !important; background: #fff !important; border: 1.5px solid #A5F3FC !important; box-shadow: 0 1px 4px rgba(6,182,212,.08) !important; transition: border-color .15s,box-shadow .15s !important; flex: 1 !important; max-width: 680px !important; }
:where(.bpx-44) { flex-shrink: 0 !important; opacity: 0.7 !important; }
:where(.bpx-45) { border: none !important; outline: none !important; font-size: 11.5px !important; font-family: inherit !important; color: #0c4a6e !important; flex: 1 !important; background: transparent !important; min-width: 0 !important; }
:where(.bpx-46) { display: flex !important; flex-direction: column !important; flex: 1 !important; min-height: 0 !important; background: linear-gradient(180deg,#f0fdff,#f8feff) !important; }
:where(.bpx-47) { display: flex !important; align-items: center !important; padding: 8px 16px 0 16px !important; gap: 0 !important; border-bottom: 1.5px solid rgba(6,182,212,.15) !important; background: linear-gradient(110deg,#f0fdff,#e8fbfd) !important; flex-shrink: 0 !important; }
:where(.bpx-48) { overflow: auto !important; flex: 1 !important; min-height: 0 !important; display: flex !important; flex-direction: column !important; }
:where(.bpx-49) { width: 100% !important; border-collapse: collapse !important; font-family: inherit !important; }
:where(.bpx-50) { padding: 9px 11px !important; text-align: center !important; font-size: 11px !important; color: #b0c4d4 !important; font-weight: 600 !important; }
:where(.bpx-51) { padding: 9px 11px !important; text-align: center !important; }
:where(.bpx-52) { margin-top: auto !important; flex-shrink: 0 !important; }
:where(.bpx-53) { display: flex !important; gap: 6px !important; padding: 10px 16px 2px !important; }
:where(.bpx-54) { font-size: 11px !important; font-weight: 600 !important; color: #b0c4d4 !important; }
:where(.bpx-55) { font-size: 10px !important; font-weight: 500 !important; color: #b0c4d4 !important; font-style: italic !important; }
:where(.bpx-56) { padding: 0 !important; overflow: hidden !important; }
:where(.bpx-57) { position: relative !important; }
:where(.bpx-58) { width: 26px !important; height: 26px !important; border-radius: 7px !important; background: rgba(255,255,255,.75) !important; border: 1.5px solid rgba(8,145,178,.22) !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; color: #0891b2 !important; transition: all .15s !important; }
:where(.bpx-59) { display: flex !important; align-items: center !important; justify-content: space-between !important; flex-wrap: wrap !important; gap: 10px !important; padding: 12px 18px !important; background: linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%) !important; border-bottom: 1.5px solid #A5F3FC !important; min-height: 60px !important; flex-shrink: 0 !important; }
:where(.bpx-60) { width: 36px !important; height: 36px !important; border-radius: 10px !important; background: linear-gradient(135deg,#06b6d4,#0891b2) !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; box-shadow: 0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3) !important; }
:where(.bpx-61) { font-size: 9.5px !important; color: #0891b2 !important; font-weight: 500 !important; margin-top: 1px !important; }
/* The CLM search box (.clm-search): 42px on radius 11, a tinted accent wash
   rather than flat white, a soft accent hairline, and the 16px accent
   magnifier. This ran 38px on radius 9 with an 11.5px input. */
/* 43.5px, the module-wide search height — .ops-search in useOpsTheme.ts and
   .clm-search in clmShared.ts carry the same number. This box is a local copy
   rather than .ops-search, so it has to be set here too. */
:where(.bpx-62) { display: flex !important; align-items: center !important; gap: 8px !important; height: 43.5px !important; padding: 0 14px !important; border-radius: 11px !important; background: linear-gradient(180deg,#f6feff,#f0fdff) !important; border: 1.5px solid #cef8fd !important; box-shadow: none !important; width: 380px !important; max-width: 100% !important; flex-shrink: 0 !important; box-sizing: border-box !important; }
:where(.bpx-62) > svg { width: 16px !important; height: 16px !important; stroke: #22d3ee !important; flex-shrink: 0 !important; }
:where(.bpx-62):focus-within { border-color: #22d3ee !important; box-shadow: 0 0 0 3px rgba(6,182,212,.14) !important; }
:where(.bpx-63) { border: none !important; outline: none !important; font-size: 13px !important; font-weight: 500 !important; font-family: inherit !important; color: #0c4a6e !important; flex: 1 !important; min-width: 0 !important; background: transparent !important; }
:where(.bpx-63)::placeholder { color: #50c0d8 !important; font-weight: 500 !important; }
/* The CLM tab rail: gap 8 on 3px of padding, radius 11, a 1px accent
   hairline over a white wash, and no fixed height - the 40px tabs give it its
   48px. It was a 38px trough at gap 3 on a 1.5px border. */
:where(.bpx-64) { display: flex !important; align-items: center !important; gap: 8px !important; height: 48px !important; box-sizing: border-box !important; padding: 3px !important; border-radius: 11px !important; background: linear-gradient(180deg, #f6feff, #f0fdff) !important; border: 1px solid #c9f8fd !important; }
:where(.bpx-65) { overflow: auto !important; flex: 1 !important; min-height: 0 !important; }
:where(.bpx-66) { padding: 9px 12px !important; text-align: center !important; }
:where(.bpx-67) { font-size: 11px !important; font-weight: 700 !important; color: #0891b2 !important; }
:where(.bpx-68) { font-size: 10px !important; font-weight: 700 !important; color: #0891b2 !important; background: rgba(6,182,212,.08) !important; border: 1px solid rgba(6,182,212,.18) !important; padding: 2px 7px !important; border-radius: 5px !important; white-space: nowrap !important; display: inline-block !important; }
:where(.bpx-69) { padding: 9px 11px !important; font-size: 12px !important; font-weight: 700 !important; color: #0c4a6e !important; white-space: nowrap !important; }
:where(.bpx-70) { padding: 9px 11px !important; text-align: left !important; vertical-align: middle !important; min-width: 196px !important; }
:where(.bpx-71) { display: flex !important; flex-wrap: nowrap !important; gap: 4px !important; justify-content: flex-start !important; align-items: center !important; }
:where(.bpx-72) { padding: 9px 11px !important; font-size: 11px !important; color: #475569 !important; text-align: center !important; }
:where(.bpx-73) { width: 24px !important; height: 24px !important; border-radius: 6px !important; background: linear-gradient(135deg,#06b6d4,#0891b2) !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; transition: transform .15s,box-shadow .15s !important; }
:where(.bpx-74) { padding: 9px 12px !important; }
:where(.bpx-75) { display: flex !important; align-items: center !important; justify-content: center !important; gap: 5px !important; }
:where(.bpx-76) { font-size: 10px !important; font-weight: 700 !important; color: #0e7490 !important; background: rgba(6,182,212,.08) !important; border: 1px solid rgba(6,182,212,.18) !important; padding: 2px 7px !important; border-radius: 5px !important; white-space: nowrap !important; display: inline-block !important; }
:where(.bpx-77) { font-size: 10px !important; font-weight: 700 !important; color: #0891b2 !important; background: rgba(6,182,212,.06) !important; border: 1px solid rgba(6,182,212,.14) !important; padding: 2px 7px !important; border-radius: 5px !important; }
:where(.bpx-78) { position: fixed !important; inset: 0 !important; z-index: 200000 !important; }
:where(.bpx-79) { font-size: 8px !important; font-weight: 800 !important; letter-spacing: .1em !important; text-transform: uppercase !important; color: #0891b2 !important; padding: 4px 8px 7px !important; }
:where(.bpx-80) { font-size: 10px !important; font-weight: 600 !important; color: #0c4a6e !important; word-break: break-word !important; }
:where(.bpx-81) { font-size: 8.5px !important; font-weight: 800 !important; color: #fff !important; background: linear-gradient(135deg, #06b6d4, #0891b2) !important; padding: 2px 8px !important; border-radius: 20px !important; white-space: nowrap !important; border: none !important; cursor: pointer !important; font-family: inherit !important; }
:where(.bpx-82) { min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
:where(.bpx-83) { position: fixed !important; inset: 0 !important; z-index: 200000 !important; background: rgba(7,30,50,.55) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important; display: flex !important; align-items: center !important; justify-content: center !important; padding: 24px !important; font-family: var(--font-sans) !important; }
:where(.bpx-84) { width: 100% !important; max-width: 1180px !important; max-height: calc(100vh - 48px) !important; background: #fff !important; border-radius: 16px !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; box-shadow: 0 28px 70px rgba(15,23,42,.45) !important; }
:where(.bpx-85) { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 16px !important; padding: 16px 22px !important; background: linear-gradient(110deg,#0c6680 0%,#0e7490 35%,#0891b2 75%,#06b6d4 100%) !important; color: #fff !important; flex-shrink: 0 !important; }
:where(.bpx-86) { display: inline-flex !important; align-items: center !important; gap: 14px !important; min-width: 0 !important; }
:where(.bpx-87) { width: 44px !important; height: 44px !important; border-radius: 12px !important; background: rgba(255,255,255,.18) !important; border: 1.5px solid rgba(255,255,255,.28) !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; }
:where(.bpx-88) { min-width: 0 !important; }
:where(.bpx-89) { font-size: 19px !important; font-weight: 800 !important; letter-spacing: -.01em !important; }
:where(.bpx-90) { font-size: 12px !important; color: rgba(255,255,255,.86) !important; margin-top: 2px !important; }
:where(.bpx-91) { display: inline-flex !important; align-items: center !important; gap: 8px !important; flex-shrink: 0 !important; }
:where(.bpx-92) { font-size: 9.5px !important; font-weight: 800 !important; letter-spacing: .12em !important; color: rgba(255,255,255,.78) !important; }
:where(.bpx-93) { width: 34px !important; height: 34px !important; border-radius: 9px !important; background: rgba(255,255,255,.14) !important; border: 1px solid rgba(255,255,255,.22) !important; color: #fff !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
:where(.bpx-94) { flex: 1 !important; min-height: 0 !important; overflow-y: auto !important; background: #fff !important; }
:where(.bpx-95) { padding: 30px !important; text-align: center !important; font-size: 12.5px !important; color: #64748b !important; }
:where(.bpx-96) { padding: 9px 11px !important; text-align: left !important; min-width: 140px !important; }
:where(.bpx-97) { display: flex !important; flex-wrap: wrap !important; gap: 3px !important; justify-content: flex-start !important; align-items: center !important; }
:where(.bpx-98) { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 10px 18px !important; background: linear-gradient(110deg,#f0fdff,#e8fafb) !important; border-top: 1.5px solid #A5F3FC !important; flex-shrink: 0 !important; }
:where(.bpx-99) { font-size: 11px !important; font-weight: 600 !important; color: #0891b2 !important; }
:where(.bpx-100) { width: 100% !important; max-width: 1120px !important; max-height: calc(100vh - 48px) !important; background: #fff !important; border-radius: 16px !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; box-shadow: 0 28px 70px rgba(15,23,42,.45) !important; }
:where(.bpx-101) { background: #fff !important; border-bottom: 1px solid rgba(6,182,212,.07) !important; }
:where(.bpx-102) { font-size: 7.5px !important; font-weight: 800 !important; padding: 1px 6px !important; border-radius: 20px !important; background: rgba(6,182,212,.12) !important; border: 1px solid rgba(6,182,212,.25) !important; color: #0891b2 !important; letter-spacing: .04em !important; }
:where(.bpx-103) { font-size: 7.5px !important; font-weight: 800 !important; padding: 1px 6px !important; border-radius: 20px !important; background: rgba(148,163,184,.1) !important; border: 1px solid rgba(148,163,184,.2) !important; color: #64748b !important; letter-spacing: .04em !important; }

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
/* The CLM tab, same as .clm-tab in clmShared.ts and the rails on Case to Case,
   Agreements We Sent and Agreements To Approve: 34px on 0 14px, radius 8,
   12.5px/700, a tinted inactive carrying the accent label, and a four-stop
   active with a lit top edge, a sunk bottom one and a cast shadow. These tabs
   ran 11.5px/700 on 0 18px at radius 9 and stood 38px tall on the Buyer page
   and 40px on the Supplier one - the same control at three sizes inside one
   module. */
.bpa-seg{display:flex;align-items:center;height:48px;box-sizing:border-box;background:linear-gradient(180deg, #f6feff, #f0fdff);border:1px solid #c9f8fd;border-radius:11px;padding:3px;gap:8px;}
.bpa-tab{position:relative;height:40px;padding:0 14px;border-radius:8px;font-family:inherit;font-size:12.5px;font-weight:650;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s,border-color .16s;letter-spacing:0;overflow:hidden;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;}
.bpa-tab svg{flex-shrink:0;}
.bpa-tab-active{border:1px solid transparent;background:linear-gradient(135deg,#22d3ee,#0891b2 55%,#0e7490);color:#fff;box-shadow:0 6px 16px -5px rgba(6,182,212,.55),inset 0 1px 0 rgba(255,255,255,.25);}
.bpa-tab-inactive{background:transparent;border:1px solid transparent;color:#0e7490;box-shadow:0 1px 2px rgba(16,24,40,.05);}
.bpa-tab-inactive:hover{background:rgba(6,182,212,.06);color:#0891b2;}
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
[data-bs-theme="dark"] .bpa-seg { background: rgba(6,182,212,.10) !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bpa-tab-inactive { color: #67e8f9 !important; background: linear-gradient(135deg,rgba(6,182,212,.16),rgba(6,182,212,.10)) !important; border-color: rgba(6,182,212,.3) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(224, 249, 253)"],
[data-bs-theme="dark"] .seg-page .bpx-9,
[data-bs-theme="dark"] .seg-page [style*="rgb(206, 248, 255)"],
[data-bs-theme="dark"] .seg-page .bpx-9,
[data-bs-theme="dark"] .seg-page .bpx-17,
[data-bs-theme="dark"] .seg-page [style*="rgb(244, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 254, 255)"],
[data-bs-theme="dark"] .seg-page .bpx-46,
[data-bs-theme="dark"] .seg-page [style*="rgb(240, 253, 255)"],
[data-bs-theme="dark"] .seg-page .bpx-25,
[data-bs-theme="dark"] .seg-page .bpx-39,
[data-bs-theme="dark"] .seg-page .bpx-46,
[data-bs-theme="dark"] .seg-page .bpx-47,
[data-bs-theme="dark"] .seg-page .bpx-59,
[data-bs-theme="dark"] .seg-page .bpx-98,
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 250, 251)"],
[data-bs-theme="dark"] .seg-page .bpx-98,
[data-bs-theme="dark"] .seg-page [style*="rgb(236, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 251, 253)"] ,
[data-bs-theme="dark"] .seg-page .bpx-25 ,
[data-bs-theme="dark"] .seg-page .bpx-39 ,
[data-bs-theme="dark"] .seg-page .bpx-47 ,
[data-bs-theme="dark"] .seg-page .bpx-59 { background: #16263a !important; }
[data-bs-theme="dark"] .seg-page [style*="linear-gradient(110deg"] ,
[data-bs-theme="dark"] .seg-page .bpx-9 ,
[data-bs-theme="dark"] .seg-page .bpx-25 ,
[data-bs-theme="dark"] .seg-page .bpx-39 ,
[data-bs-theme="dark"] .seg-page .bpx-47 ,
[data-bs-theme="dark"] .seg-page .bpx-59 ,
[data-bs-theme="dark"] .seg-page .bpx-85 ,
[data-bs-theme="dark"] .seg-page .bpx-98 { background: linear-gradient(110deg,#103a48,#0c2e3a) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgba(255, 255, 255, 0.5)"] ,
[data-bs-theme="dark"] .seg-page .bpx-12 { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .bref-box__header::after { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 240, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 246, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 242, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 243, 255)"] { background: rgba(99, 102, 241, .18) !important; border-color: rgba(129, 140, 248, .35) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(79, 70, 229)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(67, 57, 202)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(124, 58, 237)"] { color: #c7d2fe !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 250, 252)"] { background: rgba(148, 163, 184, .18) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgba(6, 182, 212, 0.1)"] ,
[data-bs-theme="dark"] .seg-page .bpx-32 ,
[data-bs-theme="dark"] .seg-page .bpx-41 { background: rgba(148, 163, 184, .30) !important; }
[data-bs-theme="dark"] .seg-page [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .seg-page .bpx-43,
[data-bs-theme="dark"] .seg-page .bpx-62,
[data-bs-theme="dark"] .seg-page .bpx-84,
[data-bs-theme="dark"] .seg-page .bpx-94,
[data-bs-theme="dark"] .seg-page .bpx-100,
[data-bs-theme="dark"] .seg-page .bpx-101,
[data-bs-theme="dark"] .seg-page [style*="background:rgb(255, 255, 255)"] ,
[data-bs-theme="dark"] .seg-page .bpx-43 ,
[data-bs-theme="dark"] .seg-page .bpx-62 ,
[data-bs-theme="dark"] .seg-page .bpx-84 ,
[data-bs-theme="dark"] .seg-page .bpx-94 ,
[data-bs-theme="dark"] .seg-page .bpx-100 ,
[data-bs-theme="dark"] .seg-page .bpx-101 { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(12, 74, 110)"],
[data-bs-theme="dark"] .seg-page .bpx-18,
[data-bs-theme="dark"] .seg-page .bpx-31,
[data-bs-theme="dark"] .seg-page .bpx-40,
[data-bs-theme="dark"] .seg-page .bpx-45,
[data-bs-theme="dark"] .seg-page .bpx-63,
[data-bs-theme="dark"] .seg-page .bpx-69,
[data-bs-theme="dark"] .seg-page .bpx-80,
[data-bs-theme="dark"] .seg-page [style*="rgb(15, 23, 42)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(31, 41, 55)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(71, 85, 105)"],
[data-bs-theme="dark"] .seg-page .bpx-72,
[data-bs-theme="dark"] .seg-page [style*="rgb(14, 116, 144)"] ,
[data-bs-theme="dark"] .seg-page .bpx-2 ,
[data-bs-theme="dark"] .seg-page .bpx-8 ,
[data-bs-theme="dark"] .seg-page .bpx-11 ,
[data-bs-theme="dark"] .seg-page .bpx-16 ,
[data-bs-theme="dark"] .seg-page .bpx-19 ,
[data-bs-theme="dark"] .seg-page .bpx-24 ,
[data-bs-theme="dark"] .seg-page .bpx-33 ,
[data-bs-theme="dark"] .seg-page .bpx-76 ,
[data-bs-theme="dark"] .seg-page .bpx-85 { color: #cfe8f3 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(148, 163, 184)"] ,
[data-bs-theme="dark"] .seg-page .bpx-1 ,
[data-bs-theme="dark"] .seg-page .bpx-5 { color: #94c9dd !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(100, 116, 139)"] ,
[data-bs-theme="dark"] .seg-page .bpx-95 ,
[data-bs-theme="dark"] .seg-page .bpx-103 { color: #94c9dd !important; }
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
[data-bs-theme="dark"] .seg-page [style*="rgb(165, 243, 252)"] ,
[data-bs-theme="dark"] .seg-page .bpx-25 ,
[data-bs-theme="dark"] .seg-page .bpx-35 ,
[data-bs-theme="dark"] .seg-page .bpx-39 ,
[data-bs-theme="dark"] .seg-page .bpx-43 ,
[data-bs-theme="dark"] .seg-page .bpx-59 ,
[data-bs-theme="dark"] .seg-page .bpx-62 ,
[data-bs-theme="dark"] .seg-page .bpx-64 ,
[data-bs-theme="dark"] .seg-page .bpx-98 { border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bp-buyer-row:hover { background: rgba(8,145,178,.14)!important; box-shadow: inset 3px 0 0 #22d3ee; }
[data-bs-theme="dark"] .bp-prog.is-complete { background: rgba(16,185,129,.18) !important; border-color: rgba(16,185,129,.38) !important; color: #6ee7b7 !important; }
[data-bs-theme="dark"] .bp-prog.is-partial  { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.38) !important; color: #fcd34d !important; }
[data-bs-theme="dark"] .bp-prog.is-none     { background: rgba(148,163,184,.16) !important; border-color: rgba(148,163,184,.30) !important; color: #cbd5e1 !important; }
[data-bs-theme="dark"] .bcm-overlay > div { background: #1e293b !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .bcm-overlay .bpx-43,
[data-bs-theme="dark"] .bcm-overlay .bpx-62,
[data-bs-theme="dark"] .bcm-overlay .bpx-84,
[data-bs-theme="dark"] .bcm-overlay .bpx-94,
[data-bs-theme="dark"] .bcm-overlay .bpx-100,
[data-bs-theme="dark"] .bcm-overlay .bpx-101,
[data-bs-theme="dark"] .bcm-overlay [style*="background:rgb(255, 255, 255)"] ,
[data-bs-theme="dark"] .bcm-overlay .bpx-43 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-62 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-84 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-94 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-100 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-101 { background: #0f172a !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(240, 253, 255)"] ,
[data-bs-theme="dark"] .bcm-overlay .bpx-25 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-39 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-46 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-47 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-59 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-98 { background: #16263a !important; }
[data-bs-theme="dark"] .bcm-overlay table thead tr { background: #16263a !important; }
[data-bs-theme="dark"] .bcm-overlay tbody tr { background: transparent !important; border-bottom-color: rgba(6,182,212,.10) !important; }
[data-bs-theme="dark"] .bcm-overlay tbody td { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(12, 74, 110)"],
[data-bs-theme="dark"] .bcm-overlay .bpx-18,
[data-bs-theme="dark"] .bcm-overlay .bpx-31,
[data-bs-theme="dark"] .bcm-overlay .bpx-40,
[data-bs-theme="dark"] .bcm-overlay .bpx-45,
[data-bs-theme="dark"] .bcm-overlay .bpx-63,
[data-bs-theme="dark"] .bcm-overlay .bpx-69,
[data-bs-theme="dark"] .bcm-overlay .bpx-80,
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(71, 85, 105)"],
[data-bs-theme="dark"] .bcm-overlay .bpx-72,
[data-bs-theme="dark"] .bcm-overlay [style*="rgb(100, 116, 139)"] ,
[data-bs-theme="dark"] .bcm-overlay .bpx-95 ,
[data-bs-theme="dark"] .bcm-overlay .bpx-103 { color: #cfe8f3 !important; }
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

/* The KPI tile, as the employee list builds it (HrEmployees.tsx, KPI_CARDS) and
   as Agreements We Sent and Agreements To Approve now do: a 3px accent rule
   flush across the top, the label in small muted caps, the figure under it at
   24px/700 in the body colour, and the icon in a 38px tile at the top RIGHT.
   This tile ran an 8px label under a 19px/900 figure at -1px tracking, with a
   22px icon and a 6px tag chip sharing the top row - roughly half the type
   scale of the same tile elsewhere in CLM. */
const cardStyle: CSSProperties = {
  position: 'relative', overflow: 'hidden', borderRadius: '14px', padding: '11px 15px',
  background: '#fff', border: '1px solid var(--vz-border-color)', borderTopWidth: 0,
  boxShadow: '0 1px 3px rgba(6,182,212,.07)',
  transition: 'all .15s',
};
/* Flush to the top edge - the card drops its own top border so the rule IS the
   edge, which keeps it a clean 3px band. */
const cardTopBar: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg,#06b6d4,#0891b2)' };
const cardIco: CSSProperties = { width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,.10)' };
const cardNum: CSSProperties = { fontSize: '24px', fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 };
const cardLabel: CSSProperties = { fontSize: '10.5px', fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '.05em', textTransform: 'uppercase', margin: '0 0 8px', lineHeight: 1.25 };

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
            {d}<span className="bpx-1">/{t}</span>
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
    <div className="bpx-2">
      <span className="bpx-3">{n}</span>
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
    <td className="bpx-4">
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
    <td className="bpx-4" onClick={(e) => e.stopPropagation()}>
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
    if (segs.length === 0) return <span className="bpx-5">—</span>;
    const extra = segs.length - 1;
    return <span className="bpx-6">
      <span style={{ maxWidth: SEG_CHIP_COL, flexShrink: 1, display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
        <Tooltip label={segs[0]}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: SEG_CHIP_COL, fontSize: '9.5px', fontWeight: 600, color: '#0e7490', background: '#ecfeff', border: '1px solid #a5f3fc', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap', lineHeight: 1.6, boxSizing: 'border-box', minWidth: 0 }}><span className="bpx-7">{segs[0]}</span><SegmentNameBadge name={segs[0]} style={{ marginLeft: 0, flexShrink: 0 }} /></span></Tooltip>
      </span>
      {extra > 0 && (
        <Tooltip label="View all segments"><button type="button" onClick={(e) => toggleSegPop(e, key, segs)} className="bpx-8">+{extra}</button></Tooltip>
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

      <div className="seg-page-card bpx-9">
        <div className="bpx-10">
          <span className="bpx-11" />
          <span className="bpx-12" />
          <span className="bpx-13" />
          <div className="bpx-14">
            <div className="bpx-15">
              <div className="bpx-16">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <span className="bpx-17" />
            </div>
            <div>
              <div className="bpx-18">Customer Profile</div>
              <div className="bpx-19">Track customer onboarding, compliance verification, agreements, and overall CLM readiness.</div>
            </div>
          </div>
          <div className="bpx-20">
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
        <div className={`bref-box${brefCollapsed ? ' is-collapsed' : ''} bpx-21`}>
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
        <div className="bpx-22">
          <div className="seg-page-card bpx-23">
            <div className="bpx-24" />
            <div className="bpx-25">
              <div className="bpx-26">
                <div className="bpx-27">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
                </div>
                <div>
                  <div className="bpx-28">
                    <span className="bpx-29">Transaction wise</span>
                    <span className="bpx-30" />
                    <span className="bpx-31">Analytics Overview</span>
                    <span className="bpx-32">7 metrics</span>
                  </div>
                  <div className="bpx-33">Live snapshot of transaction compliance status, pending actions and document health.</div>
                </div>
              </div>
              <div className="bpx-34">
                <div className="bpx-35">
                  {([['international', 'International Transactions'], ['domestic', 'Domestic Transactions']] as const).map(([key, label]) => {
                    const on = txnScope === key;
                    return (
                      <button key={key} onClick={() => { setTxnScope(key); setWsEqPage(1); setWsNeqPage(1); setWosEqPage(1); setWosNeqPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', height: 40, borderRadius: 8, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 650, letterSpacing: 0, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .16s, color .16s, box-shadow .16s, border-color .16s', position: 'relative', overflow: 'hidden', ...(on ? { border: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent 50%),linear-gradient(135deg,#22d3ee 0%,#06b6d4 35%,#0891b2 68%,#0e7490 100%)', color: '#fff', boxShadow: '0 5px 14px rgba(6,182,212,.5), inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(14,116,144,.3)', textShadow: '0 1px 2px rgba(12,74,110,.4)' } : { background: 'linear-gradient(135deg,#ecfeff,#cffafe)', border: '1px solid rgba(6,182,212,.25)', color: '#0e7490' }) }}>
                        {key === 'international'
                          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="bp-chev-toggle bpx-36" onClick={() => setTxnAnalyticsOpen((o) => !o)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: txnAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                </div>
              </div>
            </div>
            <div style={{ maxHeight: txnAnalyticsOpen ? '200px' : '0px', opacity: txnAnalyticsOpen ? 1 : 0, padding: txnAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)', overflow: 'hidden', transition: 'max-height .32s cubic-bezier(.22,1,.36,1),opacity .22s,padding .22s' }}>
              <div className="bpx-37">
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
                    <div className="bpx-38">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={cardLabel}>{c.label}</p>
                        <div style={cardNum}>{c.num}</div>
                      </div>
                      <div style={cardIco}>{c.ico}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div ref={txnCardRef} className="seg-page-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: txnCardFill }}>
            <div className="bpx-39">
              <div className="bpx-26">
                <div className="bpx-27">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                </div>
                <div>
                  <div className="bpx-28">
                    <span className="bpx-40">International Transactions</span>
                    <span className="bpx-41">With Shipment ID</span>
                  </div>
                  <div className="bpx-42">Cross-border shipment-linked transactions mapped to customers, opportunities &amp; compliance progress.</div>
                </div>
              </div>
              <div className="bpx-43">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round" className="bpx-44"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input autoComplete="off" type="text" placeholder="Search by Shipment ID, Opportunity ID, Customer, Consignee, PI or Status..." value={txnSearch} onChange={(e) => { setTxnSearch(e.target.value); setWsEqPage(1); setWsNeqPage(1); setWosEqPage(1); setWosNeqPage(1); }} className="bpx-45" />
                <SearchClear show={txnSearch} onClear={() => { setTxnSearch(''); }} />
              </div>
            </div>

            {shipTab === 'with' && (
              <div className="bpx-46">
                <div className="bpx-47">
                  <SubTab active={wsSub === 'eq'} kind="eq" onClick={() => setWsSub('eq')} />
                  <SubTab active={wsSub === 'neq'} kind="neq" onClick={() => setWsSub('neq')} />
                </div>

                {wsSub === 'eq' && (
                  <div ref={txnTableRef} className="bpx-48">
                    <table className="bpx-49">
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
                              <td className="bpx-50">{r.sr}</td>
                              <td className="bpx-51"><span style={idChip}>{r.shp}</span></td>
                              <td className="bpx-51"><span style={oppChip}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td className="bpx-51"><span style={piChip}>{r.pi}</span></td>
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} /><WsProgCell obj={r.agr} />
                              <EvidenceVaultBtn icon="shield" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!bpLoading && wsEqSlice.length === 0 && (
                      <div className="bpx-95" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0c4a6e', marginBottom: 4 }}>{txnSearch.trim() ? 'No results found' : 'No records found'}</div>
                        <div>{txnSearch.trim() ? `No transactions match “${txnSearch.trim()}”.` : 'No transactions to show.'}</div>
                      </div>
                    )}
                    <div className="bpx-52">
                      <WorklistPager page={wsEqPageSafe} total={wsEqRows.length} pageSize={txnPerPage} onPage={setWsEqPage} onPageSize={(n) => { setTxnManualSize(n); setWsEqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}

                {wsSub === 'neq' && (
                  <div ref={txnTableRef} className="bpx-48">
                    <div className="bpx-53">
                      <button onClick={() => setNeqParty('buyer')} style={neqTabStyle(neqParty === 'buyer')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer Transactions</button>
                      <button onClick={() => setNeqParty('consignee')} style={neqTabStyle(neqParty === 'consignee')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee Transactions</button>
                    </div>
                    <table className="bpx-49">
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
                              <td className="bpx-50">{r.sr}</td>
                              <td className="bpx-51"><span style={idChip}>{r.shp}</span></td>
                              <td className="bpx-51"><span style={oppChip}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td style={customerTd}>{r.consignee}</td>
                              <td className="bpx-51"><span style={piChip}>{r.pi}</span></td>
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
                    {!bpLoading && wsNeqSlice.length === 0 && (
                      <div className="bpx-95" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0c4a6e', marginBottom: 4 }}>{txnSearch.trim() ? 'No results found' : 'No records found'}</div>
                        <div>{txnSearch.trim() ? `No transactions match “${txnSearch.trim()}”.` : 'No transactions to show.'}</div>
                      </div>
                    )}
                    <div className="bpx-52">
                      <WorklistPager page={wsNeqPageSafe} total={wsNeqRows.length} pageSize={txnPerPage} onPage={setWsNeqPage} onPageSize={(n) => { setTxnManualSize(n); setWsNeqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {shipTab === 'without' && (
              <div className="bpx-46">
                <div className="bpx-47">
                  <SubTab active={wosSub === 'eq'} kind="eq" onClick={() => setWosSub('eq')} />
                  <SubTab active={wosSub === 'neq'} kind="neq" onClick={() => setWosSub('neq')} />
                </div>

                {wosSub === 'eq' && (
                  <div ref={txnTableRef} className="bpx-48">
                    <table className="bpx-49">
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
                              <td className="bpx-50">{r.sr}</td>
                              <td className="bpx-51"><span className="bpx-54">—</span></td>
                              <td className="bpx-51"><span style={oppChipMono}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              {r.pi
                                ? <td className="bpx-51"><span style={piChip}>{r.pi}</span></td>
                                : <td className="bpx-51"><span className="bpx-55">—</span></td>}
                              <RegBadge reg={r.reg} />
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} />
                              <WosAgrCell row={r} />
                              <EvidenceVaultBtn icon="box" disabled={!r.custId} onClick={() => openTxnBuyerVault(r.custId, r.customer, r.country)} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="bpx-52">
                      <WorklistPager page={wosEqPageSafe} total={wosEqRows.length} pageSize={txnPerPage} onPage={setWosEqPage} onPageSize={(n) => { setTxnManualSize(n); setWosEqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}

                {wosSub === 'neq' && (
                  <div ref={txnTableRef} className="bpx-48">
                    <div className="bpx-53">
                      <button onClick={() => setNeqParty('buyer')} style={neqTabStyle(neqParty === 'buyer')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer Transactions</button>
                      <button onClick={() => setNeqParty('consignee')} style={neqTabStyle(neqParty === 'consignee')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee Transactions</button>
                    </div>
                    <table className="bpx-49">
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
                              <td className="bpx-50">{r.sr}</td>
                              <td className="bpx-51"><span className="bpx-54">—</span></td>
                              <td className="bpx-51"><span style={oppChipMono}>{r.opp}</span></td>
                              <td style={customerTd}>{r.customer}</td>
                              <td style={customerTd}>{r.consignee}</td>
                              {r.pi
                                ? <td className="bpx-51"><span style={piChip}>{r.pi}</span></td>
                                : <td className="bpx-51"><span className="bpx-55">—</span></td>}
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
                    <div className="bpx-52">
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
          <div className="seg-page-card bpx-56">
            <div className="bpx-57">
              <div className="bpx-24" />
              <div className="bpx-25">
                <div className="bpx-26">
                  <div className="bpx-27">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
                  </div>
                  <div>
                    <div className="bpx-28">
                      <span className="bpx-29">Customer & Consignee</span>
                      <span className="bpx-30" />
                      <span className="bpx-31">Analytics Overview</span>
                      <span className="bpx-32">7 metrics</span>
                    </div>
                    <div className="bpx-33">Live snapshot of compliance status, pending actions and document health.</div>
                  </div>
                </div>
                <div className="bpx-34">
                  <div className="bpa-seg">
                    <button className={`bpa-tab ${bpaTab === 'buyer' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => { setBpaTab('buyer'); setCardFilter('all'); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Customer</button>
                    <button className={`bpa-tab ${bpaTab === 'consignee' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => { setBpaTab('consignee'); setCardFilter('all'); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee</button>
                  </div>
                  <div className="bp-chev-toggle bpx-58" onClick={() => setPartyAnalyticsOpen((o) => !o)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: partyAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
              </div>
              <div className="bpa-cards-wrap" style={{ maxHeight: partyAnalyticsOpen ? '200px' : '0px', opacity: partyAnalyticsOpen ? 1 : 0, padding: partyAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)' }}>
                {bpaTab === 'buyer' && (
                  <div className="bpx-37">
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
                        <div className="bpx-38">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={cardLabel}>{c.label}</p>
                            <div style={cardNum}>{c.num}</div>
                          </div>
                          <div style={cardIco}>{c.ico}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {bpaTab === 'consignee' && (
                  <div className="bpx-37">
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
                        <div className="bpx-38">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={cardLabel}>{c.label}</p>
                            <div style={cardNum}>{c.num}</div>
                          </div>
                          <div style={cardIco}>{c.ico}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {bpaTab === 'buyer' && (
            <div>
              <div ref={buyerCardRef} className="seg-page-card" style={{ marginTop: 8, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: buyerCardFill, maxHeight: buyerCardFill }}>
                <div className="bpx-59">
                  <div className="bpx-26">
                    <div className="bpx-60">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <div>
                      <div className="bpx-40">Customer List</div>
                      <div className="bpx-61">{buyerSearch.trim() ? `${buyerListTotal} of ${buyerTotal} customers match` : `${buyerListTotal} registered across all segments`}</div>
                    </div>
                  </div>
                  <div className="bpx-34">
                    <div className="bpx-62">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input autoComplete="off" type="text" placeholder="Search by name, segment, country, ID..." value={buyerSearch} onChange={(e) => { setBuyerSearch(e.target.value); setBuyerPage(1); }} className="bpx-63" />
                      <SearchClear show={buyerSearch} onClear={() => { setBuyerSearch(''); }} />
                    </div>
                    <div className="bpx-64">
                      {([['international', 'International Customers'], ['domestic', 'Domestic Customers']] as const).map(([key, label]) => {
                        const on = buyerScope === key;
                        return (
                          <button key={key} onClick={() => { setBuyerScope(key); setBuyerPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', height: 40, borderRadius: 8, boxSizing: 'border-box',
                            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 650, letterSpacing: 0, cursor: 'pointer', whiteSpace: 'nowrap',
                            transition: 'background .16s, color .16s, box-shadow .16s, border-color .16s', position: 'relative', overflow: 'hidden',
                            ...(on
                              ? { border: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent 50%),linear-gradient(135deg,#22d3ee 0%,#06b6d4 35%,#0891b2 68%,#0e7490 100%)', color: '#fff', boxShadow: '0 5px 14px rgba(6,182,212,.5), inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(14,116,144,.3)', textShadow: '0 1px 2px rgba(12,74,110,.4)' }
                              : { background: 'linear-gradient(135deg,#ecfeff,#cffafe)', border: '1px solid rgba(6,182,212,.25)', color: '#0e7490' }) }}>
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
                <div className="bpx-65" ref={buyerTableRef} style={!bpLoading && buyerSlice.length === 0 ? { display: 'flex', flexDirection: 'column' } : undefined}>
                  <table className="bpx-49">
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
                            <td className="bpx-66" onClick={(e) => e.stopPropagation()}><span className="bpx-67">{(buyerPageSafe - 1) * bpPerPage + i + 1}</span></td>
                            <td className="bpx-51" onClick={(e) => e.stopPropagation()}><span className="bpx-68">{r.id}</span></td>
                            <td className="bpx-69">{r.name}</td>
                            <td className="bpx-70">
                              <div className="bpx-71">
                                {renderSegCell(`buyer-${r.id}`, r.seg)}
                              </div>
                            </td>
                            <td className="bpx-72">{r.country}</td>
                            <td className="bpx-51" onClick={(e) => e.stopPropagation()}>
                              <Tooltip label="View consignees for this customer"><div className="bpx-73"
                                onClick={() => setConsListBuyer(r)}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(6,182,212,.45)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                                <span className="bpx-3">{r.cn}</span>
                              </div></Tooltip>
                            </td>
                            <ProgCell obj={r.kyc} onClick={() => openBuyerDocs(r, 'kyc')} />
                            <ProgCell obj={r.dd} onClick={() => openBuyerDocs(r, 'dd')} />
                            <ProgCell obj={r.tl} onClick={() => openBuyerDocs(r, 'tl')} />
                            <ProgCell obj={r.td} onClick={() => openBuyerDocs(r, 'td')} />
                            <td className="bpx-51"><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} onClick={() => openBuyerDocs(r, 'agr')} />
                            <td className="bpx-74" onClick={(e) => e.stopPropagation()}>
                              <div className="bpx-75">
                                <Tooltip label="Evidence Vault"><button style={vaultBtnStyle} disabled={!r.db_id} onClick={() => openBuyerVault(r, 'company-dd')}><VaultIcon /></button></Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!bpLoading && buyerSlice.length === 0 && (
                    <div className="bpx-95" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0c4a6e', marginBottom: 4 }}>{buyerSearch.trim() ? 'No results found' : 'No records found'}</div>
                      <div>{buyerSearch.trim() ? `No ${buyerScope} customers match “${buyerSearch.trim()}”.` : `No ${buyerScope} customers to show.`}</div>
                    </div>
                  )}
                </div>
                <WorklistPager total={buyerListTotal} page={buyerPageSafe} pageSize={bpPerPage} onPage={setBuyerPage} onPageSize={(n) => { buyerAutoFitRef.current = false; setBpManualSize(n); setBuyerPage(1); }} pageSizeOptions={[5, 10, 15, 25, 50]} className="bp-wl" />
              </div>
            </div>
          )}

          {bpaTab === 'consignee' && (
            <div>
              <div ref={consCardRef} className="seg-page-card" style={{ marginTop: 8, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: consCardFill, maxHeight: consCardFill }}>
                <div className="bpx-59">
                  <div className="bpx-26">
                    <div className="bpx-60">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                    </div>
                    <div>
                      <div className="bpx-40">Consignee List</div>
                      <div className="bpx-61">{consSearch.trim() ? `${consListTotal} of ${consTotal} consignees match` : `${consListTotal} registered across all customers`}</div>
                    </div>
                  </div>
                  <div className="bpx-34">
                    <div className="bpx-62">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input autoComplete="off" type="text" placeholder="Search by name, segment, country, ID..." value={consSearch} onChange={(e) => { setConsSearch(e.target.value); setConsPage(1); }} className="bpx-63" />
                      <SearchClear show={consSearch} onClear={() => { setConsSearch(''); }} />
                    </div>
                    <div className="bpx-64">
                      {([['international', 'International Consignees'], ['domestic', 'Domestic Consignees']] as const).map(([key, label]) => {
                        const on = consScope === key;
                        return (
                          <button key={key} onClick={() => { setConsScope(key); setConsPage(1); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', height: 40, borderRadius: 8, boxSizing: 'border-box',
                            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 650, letterSpacing: 0, cursor: 'pointer', whiteSpace: 'nowrap',
                            transition: 'background .16s, color .16s, box-shadow .16s, border-color .16s', position: 'relative', overflow: 'hidden',
                            ...(on
                              ? { border: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent 50%),linear-gradient(135deg,#22d3ee 0%,#06b6d4 35%,#0891b2 68%,#0e7490 100%)', color: '#fff', boxShadow: '0 5px 14px rgba(6,182,212,.5), inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(14,116,144,.3)', textShadow: '0 1px 2px rgba(12,74,110,.4)' }
                              : { background: 'linear-gradient(135deg,#ecfeff,#cffafe)', border: '1px solid rgba(6,182,212,.25)', color: '#0e7490' }) }}>
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
                <div className="bpx-65" ref={consTableRef} style={!bpLoading && consSlice.length === 0 ? { display: 'flex', flexDirection: 'column' } : undefined}>
                  <table className="bpx-49">
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
                            <td className="bpx-66" onClick={(e) => e.stopPropagation()}><span className="bpx-67">{(consPageSafe - 1) * consPerPage + i + 1}</span></td>
                            <td className="bpx-51" onClick={(e) => e.stopPropagation()}><span className="bpx-76">{r.id}</span></td>
                            <td className="bpx-51" onClick={(e) => e.stopPropagation()}><span className="bpx-77">{r.cid}</span></td>
                            <td className="bpx-69">{r.name}</td>
                            <td className="bpx-70">
                              <div className="bpx-71">
                                {renderSegCell(`cons-${r.id}`, r.seg.split(','))}
                              </div>
                            </td>
                            <td className="bpx-72">{r.country}</td>
                            <td className="bpx-51" onClick={(e) => e.stopPropagation()}>
                              <Tooltip label="View customer for this consignee"><div className="bpx-73"
                                onClick={() => setCustForCons(r)}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(6,182,212,.45)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                                <span className="bpx-3">{custCount}</span>
                              </div></Tooltip>
                            </td>
                            <ProgCell obj={r.kyc} onClick={() => openConsDocs(r, 'kyc')} />
                            <ProgCell obj={r.dd} onClick={() => openConsDocs(r, 'dd')} />
                            <ProgCell obj={r.tl} onClick={() => openConsDocs(r, 'tl')} />
                            <ProgCell obj={r.td} onClick={() => openConsDocs(r, 'td')} />
                            <td className="bpx-51"><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} onClick={() => openConsDocs(r, 'agr')} />
                            <td className="bpx-74" onClick={(e) => e.stopPropagation()}>
                              <div className="bpx-75">
                                <Tooltip label="Evidence Vault"><button style={vaultBtnStyle} disabled={!r.db_id} onClick={() => openConsVault(r, 'company-dd')}><VaultIcon /></button></Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!bpLoading && consSlice.length === 0 && (
                    <div className="bpx-95" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0c4a6e', marginBottom: 4 }}>{consSearch.trim() ? 'No results found' : 'No records found'}</div>
                      <div>{consSearch.trim() ? `No ${consScope} consignees match “${consSearch.trim()}”.` : `No ${consScope} consignees to show.`}</div>
                    </div>
                  )}
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
          <div onClick={() => setSegOpen(null)} className="bpx-78" />
          <div className="seg-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 240), top: segOpen.flipUp ? undefined : segOpen.y, bottom: segOpen.flipUp ? (window.innerHeight - segOpen.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
            <div className="bpx-79">Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 8, background: i % 2 ? 'rgba(6,182,212,.05)' : 'transparent' }}>
                <span className="bpx-80">{name}</span><SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} />
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
  if (segs.length === 0) return <span className="bpx-5">—</span>;
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
      <Tooltip label="View all segments"><button type="button" onClick={toggle} className="bpx-81">+{segs.length - 1}</button></Tooltip>
    )}
    {open && createPortal(
      <>
        <div onMouseDown={() => setOpen(null)} className="bpx-78" />
        <div className="seg-pop" style={{ position: 'fixed', left: Math.min(open.x, window.innerWidth - 240), top: open.flipUp ? undefined : open.y, bottom: open.flipUp ? (window.innerHeight - open.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
          <div className="bpx-79">Segments ({segs.length})</div>
          {segs.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 600, color: '#0c4a6e', padding: '5px 8px', borderRadius: 7, background: i % 2 === 0 ? 'rgba(6,182,212,.05)' : 'transparent' }}><span className="bpx-82">{name}</span><SegmentNameBadge name={name} style={{ marginLeft: 'auto', flexShrink: 0 }} /></div>
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
    <div className="bcm-overlay bpx-83" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div onMouseDown={(e) => e.stopPropagation()} className="bpx-84">
        <div className="bpx-85">
          <div className="bpx-86">
            <div className="bpx-87">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <div className="bpx-88">
              <div className="bpx-89">Consignees</div>
              <div className="bpx-90">Consignee identity, shipment delivery ownership & compliance readiness for this customer.</div>
            </div>
          </div>
          <div className="bpx-91">
            <span className="bpx-92">CONSIGNEES FOR</span>
            <span style={headChip}>{buyer.id}</span>
            <span style={headChip}>{buyer.name}</span>
            {buyer.country && buyer.country !== '—' && <span style={headChip}>{buyer.country}</span>}
            <button type="button" onClick={onClose} aria-label="Close" className="bpx-93">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div className="bpx-94">
          <table className="bpx-49">
            <thead>
              <tr style={txnTableHeaderRow}>
                {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs & Agreements', 'Total Shipments'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={11} className="bpx-95">No consignees mapped to this customer yet.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)', borderBottom: '1px solid rgba(6,182,212,.07)' }}>
                  <td className="bpx-66"><span className="bpx-67">{i + 1}</span></td>
                  <td className="bpx-51"><span className="bpx-76">{r.id}</span></td>
                  <td className="bpx-51"><span className="bpx-77">{r.cid}</span></td>
                  <td className="bpx-69">{r.name}</td>
                  <td className="bpx-96">
                    <div className="bpx-97">
                      <SegCell names={r.seg.split(',')} sc={r.sc} sb={r.sb} />
                    </div>
                  </td>
                  <td className="bpx-72">{r.country}</td>
                  <ProgCell obj={r.kyc} /><ProgCell obj={r.dd} /><ProgCell obj={r.tl} />
                  <ProgCell obj={{ d: r.td.d + r.agr.d, t: r.td.t + r.agr.t }} />
                  <td className="bpx-51"><NumBadge n={r.ship} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bpx-98">
          <span className="bpx-99">Showing <strong>{rows.length}</strong> consignee{rows.length === 1 ? '' : 's'}</span>
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
    <div className="bcm-overlay bpx-83" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div onMouseDown={(e) => e.stopPropagation()} className="bpx-100">
        <div className="bpx-85">
          <div className="bpx-86">
            <div className="bpx-87">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <div className="bpx-88">
              <div className="bpx-89">{customers.length > 1 ? 'Customers' : 'Customer'}</div>
              <div className="bpx-90">{customers.length > 1 ? 'The customers this consignee is mapped to, with their compliance readiness.' : 'The customer this consignee is mapped to, with its compliance readiness.'}</div>
            </div>
          </div>
          <div className="bpx-91">
            <span className="bpx-92">CUSTOMER FOR</span>
            <span style={headChip}>{consignee.id}</span>
            <span style={headChip}>{consignee.name}</span>
            <button type="button" onClick={onClose} aria-label="Close" className="bpx-93">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div className="bpx-94">
          <table className="bpx-49">
            <thead>
              <tr style={txnTableHeaderRow}>
                {['Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs & Agreements', 'Total Shipments'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' || h === 'Segment' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan={10} className="bpx-95">None of this consignee's mapped customers are in the current list scope.</td></tr>
              ) : customers.map((customer) => (
                <tr key={customer.id} className="bpx-101">
                  <td className="bpx-51"><span className="bpx-68">{customer.id}</span></td>
                  <td className="bpx-69">{customer.name}</td>
                  <td className="bpx-96">
                    <div className="bpx-97">
                      <SegCell names={customer.seg} sc={customer.sc} sb={customer.sb} />
                    </div>
                  </td>
                  <td className="bpx-72">{customer.country}</td>
                  <td className="bpx-51"><NumBadge n={customer.cn} /></td>
                  <ProgCell obj={customer.kyc} /><ProgCell obj={customer.dd} /><ProgCell obj={customer.tl} />
                  <ProgCell obj={{ d: customer.td.d + customer.agr.d, t: customer.td.t + customer.agr.t }} />
                  <td className="bpx-51"><NumBadge n={customer.ship} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bpx-98">
          <span className="bpx-99">Consignee <strong>{consignee.id}</strong> → <strong>{customers.length}</strong> mapped customer{customers.length === 1 ? '' : 's'}</span>
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
        ? <span className="bpx-102">SAME</span>
        : <span className="bpx-103">DIFF</span>}
    </button>
  );
}

function WosAgrCell({ row }: { row: WosEqRow }) {
  if (!row.pi) {
    return (
      <td className="bpx-51">
        <span className="bpx-55">No PI</span>
      </td>
    );
  }
  return <WsProgCell obj={row.agr} />;
}
