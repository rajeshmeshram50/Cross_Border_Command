import { useState, type CSSProperties } from 'react';

/*
 * CLM → Supplier Profile (faithful port of rSp() from the SalesMatrix/CLM HTML prototype).
 * Dashboard/view page — no backend API. All data is inlined mock data.
 * Green-accented (#16A34A / #059669) progress bars where the prototype uses them; cyan chrome elsewhere.
 */

/* ───────────────────────── Types ───────────────────────── */
type Prog = { d: number; t: number };

type PartyRow = {
  sr: number;
  id: string;
  name: string;
  seg: string;
  sc: string;
  sb: string;
  state: string;
  sc2: string;
  kyc: Prog;
  dd: Prog;
  tl: Prog;
  td: Prog;
  agr: Prog;
  ship: number;
};

type TxnRow = {
  sr: number;
  shpId: string;
  procId: string;
  supplier: string;
  po: string;
  inv: string;
  reg: 'Low' | 'High';
  kyc: Prog;
  dd: Prog;
  tl: Prog;
  td: Prog;
  agr: Prog;
  supId: string;
};

type TxnSvcRow = {
  sr: number;
  procId: string;
  supplier: string;
  inv: string;
  reg: 'Low' | 'High';
  kyc: Prog;
  dd: Prog;
  tl: Prog;
  td: Prog;
  agr: Prog;
  supId: string;
};

type TxnProcRow = {
  sr: number;
  procId: string;
  supplier: string;
  po: string;
  inv: string;
  reg: 'Low' | 'High';
  kyc: Prog;
  dd: Prog;
  tl: Prog;
  td: Prog;
  agr: Prog;
  supId: string;
};

const PER_PAGE = 10;

/* ───────────────────────── Extracted CSS ───────────────────────── */
const CSS = `
.seg-page { background: #F4F6FB; min-height: calc(100vh - 56px); padding: 0; display:flex; flex-direction:column; gap:8px; }
.seg-page-card {
  background: #fff;
  border: 1px solid rgba(6,182,212,.2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(6,182,212,.08), 0 1px 3px rgba(15,23,42,.04);
}
/* bref-box */
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
/* Buyer/Consignee Switcher (bpa-seg) */
.bpa-seg{display:flex;align-items:center;background:rgba(255,255,255,.6);border:1.5px solid rgba(6,182,212,.25);border-radius:11px;padding:4px;gap:3px;box-shadow:0 2px 8px rgba(6,182,212,.12),inset 0 1px 0 rgba(255,255,255,.9);}
.bpa-tab{position:relative;height:40px;padding:0 18px;border-radius:9px;border:none;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;transition:all .2s cubic-bezier(.22,1,.36,1);letter-spacing:.01em;overflow:hidden;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}
.bpa-tab::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.2),transparent);border-radius:inherit;pointer-events:none;}
.bpa-tab svg{flex-shrink:0;}
.bpa-tab-active{background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);color:#fff;box-shadow:0 3px 12px rgba(6,182,212,.4),0 1px 4px rgba(8,145,178,.3);}
.bpa-tab-inactive{background:transparent;color:#0e7490;box-shadow:none;}
.bpa-tab-inactive:hover{background:rgba(6,182,212,.1);color:#0891b2;}

/* ── Dark mode ──
 * The page is built with light inline styles, so dark mode is done with a
 * targeted override sweep: darken every card surface, swap the distinctive
 * light cyan gradient strips/headers for dark equivalents, and lighten the
 * dark inline text colours. Bright-cyan accents (#0891b2/#06b6d4/#22d3ee)
 * and the colour-coded status badges (which set their own bg + text) are
 * left as-is — they already read fine on dark. */
[data-bs-theme="dark"] .seg-page { background: transparent; }
[data-bs-theme="dark"] .seg-page-card { background: #1e293b !important; border-color: rgba(6,182,212,.18) !important; box-shadow: 0 2px 12px rgba(0,0,0,.45) !important; }
[data-bs-theme="dark"] .bref-box { background: #1e293b !important; }
[data-bs-theme="dark"] .bref-box__header { background: linear-gradient(110deg,#103a48,#0c2e3a) !important; border-bottom-color: rgba(6,182,212,.25) !important; }
[data-bs-theme="dark"] .bref-box__body { background: linear-gradient(180deg,#172033,#0f172a) !important; }
[data-bs-theme="dark"] .bref-item { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bref-item__title { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .bref-item__desc { color: #94a3b8 !important; }
[data-bs-theme="dark"] .bpa-seg { background: rgba(255,255,255,.05) !important; }
[data-bs-theme="dark"] .bpa-tab-inactive { color: #67e8f9 !important; }
/* light cyan gradient strips / surfaces (matched by their distinctive stop
 * colours) → dark */
[data-bs-theme="dark"] .seg-page [style*="#e0f9fd"],
[data-bs-theme="dark"] .seg-page [style*="#cef8ff"],
[data-bs-theme="dark"] .seg-page [style*="#f4feff"],
[data-bs-theme="dark"] .seg-page [style*="#f0fdff"],
[data-bs-theme="dark"] .seg-page [style*="#e8fafb"],
[data-bs-theme="dark"] .seg-page [style*="#e8fbfd"] { background: #16263a !important; }
/* white inline cards (KPI tiles) → dark */
[data-bs-theme="dark"] .seg-page [style*="background:#fff;"],
[data-bs-theme="dark"] .seg-page [style*="background: #fff;"] { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
/* dark inline text → light */
[data-bs-theme="dark"] .seg-page [style*="#0c4a6e"],
[data-bs-theme="dark"] .seg-page [style*="#0f172a"],
[data-bs-theme="dark"] .seg-page [style*="#1f2937"],
[data-bs-theme="dark"] .seg-page [style*="#475569"],
[data-bs-theme="dark"] .seg-page [style*="#0e7490"] { color: #cfe8f3 !important; }
/* table data */
[data-bs-theme="dark"] .seg-page-card tbody tr { background: transparent !important; }
[data-bs-theme="dark"] .seg-page-card tbody td { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .bp-buyer-row:hover { background: rgba(8,145,178,.14)!important; box-shadow: inset 3px 0 0 #22d3ee; }
`;

/* ───────────────────────── Mock data ───────────────────────── */
const spMatData: PartyRow[] = [
  { sr: 1, id: 'S-001', name: 'Raipur Agro Supplies Pvt Ltd', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Chhattisgarh', sc2: '22', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 3 },
  { sr: 2, id: 'S-002', name: 'Nashik Fresh Produce Ltd', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 4 },
  { sr: 3, id: 'S-003', name: 'Punjab Grain Traders Co.', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', state: 'Punjab', sc2: '03', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 4, id: 'S-004', name: 'Rajasthan Spice Exports', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', state: 'Rajasthan', sc2: '08', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 5, id: 'S-005', name: 'MP Pulses & Grains Pvt Ltd', seg: 'Pulses', sc: '#7f1d1d', sb: '#fef2f2', state: 'Madhya Pradesh', sc2: '23', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 6, id: 'S-006', name: 'Kerala Coconut Industries', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', state: 'Kerala', sc2: '32', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 7, id: 'S-007', name: 'Haryana Basmati Millers', seg: 'Basmati Rice', sc: '#0e7490', sb: '#f0fdff', state: 'Haryana', sc2: '06', kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 8, id: 'S-008', name: 'Gujarat Organic Farms Pvt Ltd', seg: 'Organic Foods', sc: '#0e7490', sb: '#f0fdff', state: 'Gujarat', sc2: '24', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 3 },
  { sr: 9, id: 'S-009', name: 'Andhra Chilli & Spices Co.', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', state: 'Andhra Pradesh', sc2: '37', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 10, id: 'S-010', name: 'Tamil Nadu Oil Mills Ltd', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', state: 'Tamil Nadu', sc2: '33', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 11, id: 'S-011', name: 'UP Agri Processing Pvt Ltd', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', state: 'Uttar Pradesh', sc2: '09', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 12, id: 'S-012', name: 'Karnataka Horticulture Pvt Ltd', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Karnataka', sc2: '29', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 3 },
];

const spLogiData: PartyRow[] = [
  { sr: 1, id: 'L-001', name: 'Maersk India Logistics Pvt Ltd', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 5 },
  { sr: 2, id: 'L-002', name: 'Allcargo Logistics Ltd', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 4 },
  { sr: 3, id: 'L-003', name: 'TCI Freight Solutions', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', state: 'Telangana', sc2: '36', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 4, id: 'L-004', name: 'Blue Dart Express Ltd', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', state: 'Karnataka', sc2: '29', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 3 },
  { sr: 5, id: 'L-005', name: 'Container Corp of India', seg: 'Pulses', sc: '#7f1d1d', sb: '#fef2f2', state: 'Delhi', sc2: '07', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 2 },
  { sr: 6, id: 'L-006', name: 'Jeena & Company Pvt Ltd', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', state: 'Gujarat', sc2: '24', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 3 },
  { sr: 7, id: 'L-007', name: 'Radhakrishna Foodland Pvt Ltd', seg: 'Basmati Rice', sc: '#0e7490', sb: '#f0fdff', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 8, id: 'L-008', name: 'Navata Road Transport', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Andhra Pradesh', sc2: '37', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 4 },
];

const spWosSvcData: PartyRow[] = [
  { sr: 1, id: 'SV-001', name: 'SGS India Pvt Ltd', seg: 'Tech', sc: '#1e40af', sb: '#eff6ff', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 0 },
  { sr: 2, id: 'SV-002', name: 'Bureau Veritas India Pvt Ltd', seg: 'Advisory', sc: '#6b21a8', sb: '#faf5ff', state: 'Karnataka', sc2: '29', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 0 },
  { sr: 3, id: 'SV-003', name: 'Intertek India Pvt Ltd', seg: 'Tech', sc: '#1e40af', sb: '#eff6ff', state: 'Tamil Nadu', sc2: '33', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 4, id: 'SV-004', name: 'FSSAI Consultant Group', seg: 'Risk', sc: '#b91c1c', sb: '#fef2f2', state: 'Delhi', sc2: '07', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 5, id: 'SV-005', name: 'AgriCert India Pvt Ltd', seg: 'Advisory', sc: '#6b21a8', sb: '#faf5ff', state: 'Gujarat', sc2: '24', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 0 },
  { sr: 6, id: 'SV-006', name: 'National Test House', seg: 'Tech', sc: '#1e40af', sb: '#eff6ff', state: 'West Bengal', sc2: '19', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 7, id: 'SV-007', name: 'APEDA Approved Surveyor Ltd', seg: 'Advisory', sc: '#6b21a8', sb: '#faf5ff', state: 'Andhra Pradesh', sc2: '37', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 8, id: 'SV-008', name: 'TÜV Rheinland India Pvt Ltd', seg: 'Risk', sc: '#b91c1c', sb: '#fef2f2', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 0 },
  { sr: 9, id: 'SV-009', name: 'Spices Board Certified Labs', seg: 'Advisory', sc: '#6b21a8', sb: '#faf5ff', state: 'Kerala', sc2: '32', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 0 },
  { sr: 10, id: 'SV-010', name: 'IndiaFirst Legal & Compliance LLP', seg: 'Risk', sc: '#b91c1c', sb: '#fef2f2', state: 'Rajasthan', sc2: '08', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 0 },
];

const spWosMatData: PartyRow[] = [
  { sr: 1, id: 'W-001', name: 'Coimbatore Textile Mills Ltd', seg: 'Coffee', sc: '#92400e', sb: '#fffbeb', state: 'Tamil Nadu', sc2: '33', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 2, id: 'W-002', name: 'Ludhiana Steel Fabricators', seg: 'Tobacco', sc: '#78350f', sb: '#fef3c7', state: 'Punjab', sc2: '03', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 2 }, ship: 0 },
  { sr: 3, id: 'W-003', name: 'Pune Chemical Supplies Pvt Ltd', seg: 'Ethanol', sc: '#0e7490', sb: '#f0fdff', state: 'Maharashtra', sc2: '27', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 4, id: 'W-004', name: 'Jaipur Craft & Packaging Co.', seg: 'Tea', sc: '#065f46', sb: '#f0fdf4', state: 'Rajasthan', sc2: '08', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 5, id: 'W-005', name: 'Hyderabad Lab Instruments Ltd', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', state: 'Telangana', sc2: '36', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 6, id: 'W-006', name: 'Surat Fabric Exports Pvt Ltd', seg: 'Cotton', sc: '#065f46', sb: '#f0fdf4', state: 'Gujarat', sc2: '24', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 0 },
  { sr: 7, id: 'W-007', name: 'Bhopal Agri Input Suppliers', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', state: 'Madhya Pradesh', sc2: '23', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 0 },
  { sr: 8, id: 'W-008', name: 'Kochi Bio-Tech Solutions Ltd', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', state: 'Kerala', sc2: '32', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 9, id: 'W-009', name: 'Nagpur Orange Processing Co.', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Maharashtra', sc2: '27', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 0 },
  { sr: 10, id: 'W-010', name: 'Indore Grain Storage & Supply', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', state: 'Madhya Pradesh', sc2: '23', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
];

const spWosLogiData: PartyRow[] = [
  { sr: 1, id: 'WL-001', name: 'DHL Supply Chain India Pvt Ltd', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', state: 'Maharashtra', sc2: '27', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 0 },
  { sr: 2, id: 'WL-002', name: 'FedEx Express India Pvt Ltd', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', state: 'Karnataka', sc2: '29', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 0 },
  { sr: 3, id: 'WL-003', name: 'Safexpress Pvt Ltd', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', state: 'Delhi', sc2: '07', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 4, id: 'WL-004', name: 'GATI-KWE Pvt Ltd', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', state: 'Telangana', sc2: '36', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 0 },
  { sr: 5, id: 'WL-005', name: 'Snowman Logistics Ltd', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', state: 'Karnataka', sc2: '29', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 0 },
  { sr: 6, id: 'WL-006', name: 'V-Trans (India) Ltd', seg: 'Pulses', sc: '#7f1d1d', sb: '#fef2f2', state: 'Gujarat', sc2: '24', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 0 },
];

const spTxnMatData: TxnRow[] = [
  { sr: 1, shpId: 'SHP-001', procId: 'PROC-001', supplier: 'Raipur Agro Supplies Pvt Ltd', po: 'PO-2025-001', inv: 'INV-2025-001', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'S-001' },
  { sr: 2, shpId: 'SHP-002', procId: 'PROC-002', supplier: 'Nashik Fresh Produce Ltd', po: 'PO-2025-002', inv: 'INV-2025-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'S-002' },
  { sr: 3, shpId: 'SHP-003', procId: 'PROC-003', supplier: 'Punjab Grain Traders Co.', po: 'PO-2025-003', inv: '—', reg: 'High', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'S-003' },
  { sr: 4, shpId: 'SHP-004', procId: 'PROC-004', supplier: 'Rajasthan Spice Exports', po: 'PO-2025-004', inv: 'INV-2025-004', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 2, t: 3 }, supId: 'S-004' },
  { sr: 5, shpId: 'SHP-005', procId: 'PROC-005', supplier: 'MP Pulses & Grains Pvt Ltd', po: 'PO-2025-005', inv: '—', reg: 'High', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'S-005' },
  { sr: 6, shpId: 'SHP-006', procId: 'PROC-006', supplier: 'Kerala Coconut Industries', po: 'PO-2025-006', inv: 'INV-2025-006', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'S-006' },
  { sr: 7, shpId: 'SHP-007', procId: 'PROC-007', supplier: 'Haryana Basmati Millers', po: 'PO-2025-007', inv: 'INV-2025-007', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, supId: 'S-007' },
  { sr: 8, shpId: 'SHP-008', procId: 'PROC-008', supplier: 'Gujarat Organic Farms Pvt Ltd', po: 'PO-2025-008', inv: 'INV-2025-008', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'S-008' },
  { sr: 9, shpId: 'SHP-009', procId: 'PROC-009', supplier: 'Andhra Chilli & Spices Co.', po: 'PO-2025-009', inv: 'INV-2025-009', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'S-009' },
  { sr: 10, shpId: 'SHP-010', procId: 'PROC-010', supplier: 'Tamil Nadu Oil Mills Ltd', po: 'PO-2025-010', inv: 'INV-2025-010', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'S-010' },
  { sr: 11, shpId: 'SHP-011', procId: 'PROC-011', supplier: 'UP Agri Processing Pvt Ltd', po: 'PO-2025-011', inv: 'INV-2025-011', reg: 'High', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'S-011' },
  { sr: 12, shpId: 'SHP-012', procId: 'PROC-012', supplier: 'Karnataka Horticulture Pvt Ltd', po: 'PO-2025-012', inv: 'INV-2025-012', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'S-012' },
];

const spTxnLogiData: TxnRow[] = [
  { sr: 1, shpId: 'SHP-001', procId: 'PROC-L01', supplier: 'Maersk India Logistics Pvt Ltd', po: 'PO-L-2025-001', inv: 'INV-L-2025-001', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'L-001' },
  { sr: 2, shpId: 'SHP-002', procId: 'PROC-L02', supplier: 'Allcargo Logistics Ltd', po: 'PO-L-2025-002', inv: 'INV-L-2025-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'L-002' },
  { sr: 3, shpId: 'SHP-003', procId: 'PROC-L03', supplier: 'TCI Freight Solutions', po: 'PO-L-2025-003', inv: '—', reg: 'High', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'L-003' },
  { sr: 4, shpId: 'SHP-004', procId: 'PROC-L04', supplier: 'Blue Dart Express Ltd', po: 'PO-L-2025-004', inv: 'INV-L-2025-004', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'L-004' },
  { sr: 5, shpId: 'SHP-005', procId: 'PROC-L05', supplier: 'Container Corp of India', po: 'PO-L-2025-005', inv: 'INV-L-2025-005', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'L-005' },
  { sr: 6, shpId: 'SHP-006', procId: 'PROC-L06', supplier: 'Jeena & Company Pvt Ltd', po: 'PO-L-2025-006', inv: 'INV-L-2025-006', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'L-006' },
  { sr: 7, shpId: 'SHP-007', procId: 'PROC-L07', supplier: 'Radhakrishna Foodland Pvt Ltd', po: 'PO-L-2025-007', inv: 'INV-L-2025-007', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, supId: 'L-007' },
  { sr: 8, shpId: 'SHP-008', procId: 'PROC-L08', supplier: 'Navata Road Transport', po: 'PO-L-2025-008', inv: 'INV-L-2025-008', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'L-008' },
];

const spTxnWosSvcData: TxnSvcRow[] = [
  { sr: 1, procId: 'PROC-SV01', supplier: 'SGS India Pvt Ltd', inv: 'INV-SV-2025-001', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'SV-001' },
  { sr: 2, procId: 'PROC-SV02', supplier: 'Bureau Veritas India Pvt Ltd', inv: 'INV-SV-2025-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'SV-002' },
  { sr: 3, procId: 'PROC-SV03', supplier: 'Intertek India Pvt Ltd', inv: 'INV-SV-2025-003', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'SV-003' },
  { sr: 4, procId: 'PROC-SV04', supplier: 'FSSAI Consultant Group', inv: '—', reg: 'High', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'SV-004' },
  { sr: 5, procId: 'PROC-SV05', supplier: 'AgriCert India Pvt Ltd', inv: 'INV-SV-2025-005', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'SV-005' },
  { sr: 6, procId: 'PROC-SV06', supplier: 'National Test House', inv: '—', reg: 'High', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'SV-006' },
  { sr: 7, procId: 'PROC-SV07', supplier: 'APEDA Approved Surveyor Ltd', inv: 'INV-SV-2025-007', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'SV-007' },
  { sr: 8, procId: 'PROC-SV08', supplier: 'TÜV Rheinland India Pvt Ltd', inv: 'INV-SV-2025-008', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'SV-008' },
  { sr: 9, procId: 'PROC-SV09', supplier: 'Spices Board Certified Labs', inv: 'INV-SV-2025-009', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'SV-009' },
  { sr: 10, procId: 'PROC-SV10', supplier: 'IndiaFirst Legal & Compliance LLP', inv: 'INV-SV-2025-010', reg: 'High', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'SV-010' },
];

const spTxnWosMatData: TxnProcRow[] = [
  { sr: 1, procId: 'PROC-W01', supplier: 'Coimbatore Textile Mills Ltd', po: 'PO-W-2025-001', inv: 'INV-W-2025-001', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 3 }, supId: 'W-001' },
  { sr: 2, procId: 'PROC-W02', supplier: 'Ludhiana Steel Fabricators', po: 'PO-W-2025-002', inv: 'INV-W-2025-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 2 }, supId: 'W-002' },
  { sr: 3, procId: 'PROC-W03', supplier: 'Pune Chemical Supplies Pvt Ltd', po: 'PO-W-2025-003', inv: '—', reg: 'High', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'W-003' },
  { sr: 4, procId: 'PROC-W04', supplier: 'Jaipur Craft & Packaging Co.', po: 'PO-W-2025-004', inv: 'INV-W-2025-004', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'W-004' },
  { sr: 5, procId: 'PROC-W05', supplier: 'Hyderabad Lab Instruments Ltd', po: 'PO-W-2025-005', inv: '—', reg: 'High', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'W-005' },
  { sr: 6, procId: 'PROC-W06', supplier: 'Surat Fabric Exports Pvt Ltd', po: 'PO-W-2025-006', inv: 'INV-W-2025-006', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'W-006' },
  { sr: 7, procId: 'PROC-W07', supplier: 'Bhopal Agri Input Suppliers', po: 'PO-W-2025-007', inv: 'INV-W-2025-007', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'W-007' },
  { sr: 8, procId: 'PROC-W08', supplier: 'Kochi Bio-Tech Solutions Ltd', po: 'PO-W-2025-008', inv: 'INV-W-2025-008', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 3 }, supId: 'W-008' },
  { sr: 9, procId: 'PROC-W09', supplier: 'Nagpur Orange Processing Co.', po: 'PO-W-2025-009', inv: 'INV-W-2025-009', reg: 'High', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'W-009' },
  { sr: 10, procId: 'PROC-W10', supplier: 'Indore Grain Storage & Supply', po: 'PO-W-2025-010', inv: 'INV-W-2025-010', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'W-010' },
];

const spTxnWosLogiData: TxnProcRow[] = [
  { sr: 1, procId: 'PROC-WL01', supplier: 'DHL Supply Chain India Pvt Ltd', po: 'PO-WL-2025-001', inv: 'INV-WL-2025-001', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'WL-001' },
  { sr: 2, procId: 'PROC-WL02', supplier: 'FedEx Express India Pvt Ltd', po: 'PO-WL-2025-002', inv: 'INV-WL-2025-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, supId: 'WL-002' },
  { sr: 3, procId: 'PROC-WL03', supplier: 'Safexpress Pvt Ltd', po: 'PO-WL-2025-003', inv: '—', reg: 'High', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, supId: 'WL-003' },
  { sr: 4, procId: 'PROC-WL04', supplier: 'GATI-KWE Pvt Ltd', po: 'PO-WL-2025-004', inv: 'INV-WL-2025-004', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, supId: 'WL-004' },
  { sr: 5, procId: 'PROC-WL05', supplier: 'Snowman Logistics Ltd', po: 'PO-WL-2025-005', inv: 'INV-WL-2025-005', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, supId: 'WL-005' },
  { sr: 6, procId: 'PROC-WL06', supplier: 'V-Trans (India) Ltd', po: 'PO-WL-2025-006', inv: 'INV-WL-2025-006', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, supId: 'WL-006' },
];

/* ───────────────────────── Shared styles ───────────────────────── */
const TH: CSSProperties = {
  padding: '9px 10px',
  fontSize: '7px',
  fontWeight: 800,
  letterSpacing: '.09em',
  textTransform: 'uppercase',
  color: '#0891b2',
  opacity: 0.85,
  whiteSpace: 'nowrap',
};
const th = (extra: CSSProperties): CSSProperties => ({ ...TH, ...extra });
const thC = (minWidth?: number): CSSProperties => th({ textAlign: 'center', ...(minWidth ? { minWidth } : {}) });
const thL = (minWidth?: number): CSSProperties => th({ textAlign: 'left', ...(minWidth ? { minWidth } : {}) });

const HEADTR: CSSProperties = { background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderBottom: '1.5px solid #A5F3FC' };
const PG_WRAP: CSSProperties = { padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)' };

/* ───────────────────────── Helper components ───────────────────────── */

// Party-wise progress cell — larger size variant (58px bar)
function PartyProgCell({ obj }: { obj: Prog }) {
  const { d, t } = obj;
  const pct = t > 0 ? Math.round((d / t) * 100) : 0;
  const isComplete = pct === 100;
  const isPartial = pct > 0 && pct < 100;
  const barGrad = isComplete ? 'linear-gradient(90deg,#06b6d4,#059669)' : isPartial ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'none';
  const numC = isComplete ? '#065f46' : isPartial ? '#78350f' : '#94a3b8';
  const numBg = isComplete ? '#ecfdf5' : isPartial ? '#fffbeb' : '#f8fafc';
  const numBd = isComplete ? '#A7F3D0' : isPartial ? '#FDE68A' : '#e2e8f0';
  return (
    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '5px', minWidth: '62px', padding: '3px 4px', borderRadius: '7px' }}>
        <span style={{ fontSize: '11px', fontWeight: 900, color: numC, background: numBg, border: `1px solid ${numBd}`, padding: '2px 8px', borderRadius: '20px', letterSpacing: '-.2px', lineHeight: 1.4 }}>
          {d}<span style={{ fontSize: '9px', fontWeight: 500, color: '#94a3b8' }}>/{t}</span>
        </span>
        <div style={{ width: '58px', height: '5px', borderRadius: '5px', background: 'rgba(6,182,212,.1)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barGrad, borderRadius: '5px' }} />
        </div>
      </div>
    </td>
  );
}

// Transaction-wise progress cell — compact variant (46px bar)
function TxnProgCell({ obj }: { obj: Prog }) {
  const { d, t } = obj;
  const pct = t > 0 ? Math.round((d / t) * 100) : 0;
  const isC = pct === 100;
  const isP = pct > 0 && pct < 100;
  const barG = isC ? 'linear-gradient(90deg,#06b6d4,#059669)' : isP ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'none';
  const nC = isC ? '#065f46' : isP ? '#78350f' : '#94a3b8';
  const nBg = isC ? '#ecfdf5' : isP ? '#fffbeb' : '#f8fafc';
  const nBd = isC ? '#A7F3D0' : isP ? '#FDE68A' : '#e2e8f0';
  return (
    <td style={{ padding: '7px 8px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '50px' }}>
        <span style={{ fontSize: '10.5px', fontWeight: 900, color: nC, background: nBg, border: `1px solid ${nBd}`, padding: '2px 7px', borderRadius: '20px', lineHeight: 1.4 }}>
          {d}<span style={{ fontSize: '8px', fontWeight: 500, color: '#94a3b8' }}>/{t}</span>
        </span>
        <div style={{ width: '46px', height: '4px', borderRadius: '4px', background: 'rgba(6,182,212,.1)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barG, borderRadius: '4px' }} />
        </div>
      </div>
    </td>
  );
}

function ShipBadge({ n }: { n: number }) {
  return (
    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg,#0e7490,#0891b2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '9px', fontWeight: 800, color: '#fff' }}>{n}</span>
    </div>
  );
}

function EvidenceVaultBtn() {
  return (
    <button
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 13px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg,#22d3ee 0%,#06b6d4 50%,#0891b2 100%)', color: '#fff', fontSize: '10.5px', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 3px 10px rgba(6,182,212,.42),inset 0 1px 0 rgba(255,255,255,.22)' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(255,255,255,.18)" /><polyline points="9 12 11 14 15 10" strokeWidth="2.5" /></svg>
      Evidence Vault
    </button>
  );
}

function TxnEvidenceVaultBtn() {
  return (
    <button
      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 11px', borderRadius: '7px', border: 'none', background: 'linear-gradient(135deg,#22d3ee,#06b6d4,#0891b2)', color: '#fff', fontSize: '9.5px', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(6,182,212,.38)' }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(255,255,255,.18)" /><polyline points="9 12 11 14 15 10" strokeWidth="2.5" /></svg>
      Evidence Vault
    </button>
  );
}

function RegPill({ reg }: { reg: 'Low' | 'High' }) {
  const low = reg === 'Low';
  const pillStyle: CSSProperties = low
    ? { background: 'rgba(16,185,129,.12)', color: '#059669', border: '1px solid rgba(16,185,129,.3)' }
    : { background: 'rgba(239,68,68,.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,.25)' };
  const dot = low ? '#10b981' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '8.5px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', whiteSpace: 'nowrap', ...pillStyle }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
      {reg}
    </span>
  );
}

function ProcBadge({ id }: { id: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '16px', border: '1.5px solid #dde1fd', background: '#f5f6ff', color: '#818cf8', whiteSpace: 'nowrap' }}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
      {id}
    </span>
  );
}

function ShpBadge({ id }: { id: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '16px', border: '1.5px solid #c7d2fe', background: '#eef0ff', color: '#4f46e5', whiteSpace: 'nowrap' }}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      {id}
    </span>
  );
}

function PoBadge({ po }: { po: string }) {
  if (!po || po === '—') return <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>;
  return <span style={{ fontSize: '9px', fontWeight: 600, color: '#0891b2', background: 'rgba(6,182,212,.07)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap' }}>{po}</span>;
}

function InvBadge({ inv }: { inv: string }) {
  if (!inv || inv === '—') return <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>;
  return <span style={{ fontSize: '9px', fontWeight: 600, color: '#059669', background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.2)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap' }}>{inv}</span>;
}

function SupBlock({ name, grad = 'linear-gradient(135deg,#0891b2,#06b6d4)', maxWidth = 170 }: { name: string; grad?: string; maxWidth?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#fff', flexShrink: 0 }}>{name[0]}</div>
      <span style={{ fontSize: '11px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: `${maxWidth}px` }}>{name}</span>
    </div>
  );
}

/* ───────────────────────── Pagination ───────────────────────── */
function Pagination({ total, page, onPage, label }: { total: number; page: number; onPage: (p: number) => void; label: string }) {
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const fromR = total === 0 ? 0 : start + 1;
  const toR = Math.min(start + PER_PAGE, total);
  const arrowBtn: CSSProperties = { width: '28px', height: '28px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.22)', background: '#fff', color: '#0891b2', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC' }}>
      <span style={{ fontSize: '10px', fontWeight: 600, color: '#0891b2' }}>
        Showing <strong>{fromR}–{toR}</strong> of <strong>{total}</strong> {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <button onClick={() => { if (page > 1) onPage(page - 1); }} style={{ ...arrowBtn, ...(page === 1 ? { opacity: 0.4, cursor: 'default' } : { cursor: 'pointer' }) }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
          const isA = p === page;
          return (
            <button
              key={p}
              onClick={() => onPage(p)}
              style={{
                width: '28px', height: '28px', borderRadius: '7px', fontSize: '10.5px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                border: isA ? '1.5px solid #0891b2' : '1.5px solid rgba(6,182,212,.2)',
                background: isA ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#fff',
                color: isA ? '#fff' : '#0891b2',
                fontWeight: isA ? 800 : 600,
              }}
            >
              {p}
            </button>
          );
        })}
        <button onClick={() => { if (page < totalPages) onPage(page + 1); }} style={{ ...arrowBtn, ...(page === totalPages ? { opacity: 0.4, cursor: 'default' } : { cursor: 'pointer' }) }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </div>
  );
}

function usePage() {
  return useState(1);
}

function slicePage<T>(data: T[], page: number): T[] {
  const start = (page - 1) * PER_PAGE;
  return data.slice(start, start + PER_PAGE);
}

/* ───────────────────────── Party-wise table ───────────────────────── */
function PartyTable({ data, label }: { data: PartyRow[]; label: string }) {
  const [page, setPage] = usePage();
  const rows = slicePage(data, page);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
        <thead>
          <tr style={HEADTR}>
            <th style={thC(40)}>SR No</th>
            <th style={thC(90)}>Supplier ID</th>
            <th style={thL(180)}>Company Name</th>
            <th style={thC(110)}>Segment</th>
            <th style={thC(70)}>Country</th>
            <th style={thC(130)}>State / Code</th>
            <th style={thC()}>KYC</th>
            <th style={thC()}>Due Diligence</th>
            <th style={thC()}>Trade Licenses</th>
            <th style={thC()}>Trade Docs</th>
            <th style={thC(80)}>Total Shipments</th>
            <th style={thC()}>Agreements</th>
            <th style={thC(110)}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)';
            return (
              <tr key={r.id} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}>
                <td style={{ padding: '9px 12px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px' }}>{r.id}</span></td>
                <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '9.5px', fontWeight: 600, color: r.sc, background: r.sb, border: '1px solid rgba(6,182,212,.15)', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{r.seg}</span></td>
                <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>India</span></td>
                <td style={{ padding: '9px 11px', textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.state}</span>
                    <span style={{ fontSize: '8.5px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '1px 6px', borderRadius: '4px', letterSpacing: '.05em' }}>{r.sc2}</span>
                  </div>
                </td>
                <PartyProgCell obj={r.kyc} />
                <PartyProgCell obj={r.dd} />
                <PartyProgCell obj={r.tl} />
                <PartyProgCell obj={r.td} />
                <td style={{ padding: '9px 11px', textAlign: 'center' }}><ShipBadge n={r.ship} /></td>
                <PartyProgCell obj={r.agr} />
                <td style={{ padding: '9px 12px', textAlign: 'center' }}><EvidenceVaultBtn /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={PG_WRAP}>
        <Pagination total={data.length} page={page} onPage={setPage} label={label} />
      </div>
    </div>
  );
}

/* ───────────────────────── Transaction-wise: With Shipment (mat/logi) ───────────────────────── */
function TxnWithTable({ data }: { data: TxnRow[] }) {
  const [page, setPage] = usePage();
  const rows = slicePage(data, page);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
        <thead>
          <tr style={HEADTR}>
            <th style={thC(40)}>SR No</th>
            <th style={thC(100)}>Shipment ID</th>
            <th style={thC(100)}>Procurement ID</th>
            <th style={thL(160)}>Supplier</th>
            <th style={thC(100)}>Purchase Order</th>
            <th style={thC(110)}>Supplier Tax Invoice</th>
            <th style={thC(90)}>Reg. Status</th>
            <th style={thC()}>KYC</th>
            <th style={thC()}>Due Diligence</th>
            <th style={thC()}>Trade Licenses</th>
            <th style={thC()}>Trade Docs</th>
            <th style={thC()}>Agreements</th>
            <th style={thC(120)}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)';
            return (
              <tr key={r.shpId + r.procId} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><ShpBadge id={r.shpId} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><ProcBadge id={r.procId} /></td>
                <td style={{ padding: '8px 10px' }}><SupBlock name={r.supplier} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><PoBadge po={r.po} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><InvBadge inv={r.inv} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><RegPill reg={r.reg} /></td>
                <TxnProgCell obj={r.kyc} />
                <TxnProgCell obj={r.dd} />
                <TxnProgCell obj={r.tl} />
                <TxnProgCell obj={r.td} />
                <TxnProgCell obj={r.agr} />
                <td style={{ padding: '8px 9px', textAlign: 'center' }}><TxnEvidenceVaultBtn /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={PG_WRAP}>
        <Pagination total={data.length} page={page} onPage={setPage} label="records" />
      </div>
    </div>
  );
}

/* ───────────────────────── Transaction-wise: Without Shipment — Services ───────────────────────── */
function TxnWosSvcTable({ data }: { data: TxnSvcRow[] }) {
  const [page, setPage] = usePage();
  const rows = slicePage(data, page);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
        <thead>
          <tr style={HEADTR}>
            <th style={thC(40)}>SR No</th>
            <th style={thC(105)}>Procurement ID</th>
            <th style={thL(170)}>Supplier</th>
            <th style={thC(120)}>Supplier Tax Invoice</th>
            <th style={thC(95)}>Reg. Status</th>
            <th style={thC()}>KYC</th>
            <th style={thC()}>Due Diligence</th>
            <th style={thC()}>Trade Licenses</th>
            <th style={thC()}>Trade Docs</th>
            <th style={thC()}>Agreements</th>
            <th style={thC(120)}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)';
            return (
              <tr key={r.procId} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><ProcBadge id={r.procId} /></td>
                <td style={{ padding: '8px 10px' }}><SupBlock name={r.supplier} grad="linear-gradient(135deg,#6366f1,#818cf8)" maxWidth={200} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><InvBadge inv={r.inv} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><RegPill reg={r.reg} /></td>
                <TxnProgCell obj={r.kyc} />
                <TxnProgCell obj={r.dd} />
                <TxnProgCell obj={r.tl} />
                <TxnProgCell obj={r.td} />
                <TxnProgCell obj={r.agr} />
                <td style={{ padding: '8px 9px', textAlign: 'center' }}><TxnEvidenceVaultBtn /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={PG_WRAP}>
        <Pagination total={data.length} page={page} onPage={setPage} label="records" />
      </div>
    </div>
  );
}

/* ───────────────────────── Transaction-wise: Without Shipment — Mat/Logi (proc rows) ───────────────────────── */
function TxnWosProcTable({ data }: { data: TxnProcRow[] }) {
  const [page, setPage] = usePage();
  const rows = slicePage(data, page);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
        <thead>
          <tr style={HEADTR}>
            <th style={thC(40)}>SR No</th>
            <th style={thC(105)}>Procurement ID</th>
            <th style={thL(170)}>Supplier</th>
            <th style={thC(105)}>Purchase Order</th>
            <th style={thC(120)}>Supplier Tax Invoice</th>
            <th style={thC(90)}>Reg. Status</th>
            <th style={thC()}>KYC</th>
            <th style={thC()}>Due Diligence</th>
            <th style={thC()}>Trade Licenses</th>
            <th style={thC()}>Trade Docs</th>
            <th style={thC()}>Agreements</th>
            <th style={thC(120)}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bg = i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)';
            return (
              <tr key={r.procId} style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><ProcBadge id={r.procId} /></td>
                <td style={{ padding: '8px 10px' }}><SupBlock name={r.supplier} maxWidth={180} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><PoBadge po={r.po} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><InvBadge inv={r.inv} /></td>
                <td style={{ padding: '8px 8px', textAlign: 'center' }}><RegPill reg={r.reg} /></td>
                <TxnProgCell obj={r.kyc} />
                <TxnProgCell obj={r.dd} />
                <TxnProgCell obj={r.tl} />
                <TxnProgCell obj={r.td} />
                <TxnProgCell obj={r.agr} />
                <td style={{ padding: '8px 9px', textAlign: 'center' }}><TxnEvidenceVaultBtn /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={PG_WRAP}>
        <Pagination total={data.length} page={page} onPage={setPage} label="records" />
      </div>
    </div>
  );
}

/* ───────────────────────── Sub-tab button ───────────────────────── */
function SubTab({ active, label, badge, badgeActive, icon, onClick }: { active: boolean; label: string; badge: string; badgeActive: boolean; icon: 'mat' | 'logi' | 'svc'; onClick: () => void }) {
  const iconEl =
    icon === 'mat'
      ? (<><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>)
      : icon === 'logi'
        ? (<><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>)
        : (<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
  return (
    <button
      onClick={onClick}
      style={{ position: 'relative', padding: '9px 18px 10px', fontFamily: 'inherit', fontSize: '12px', fontWeight: active ? 700 : 600, border: 'none', background: 'transparent', cursor: 'pointer', color: active ? '#0891b2' : '#64748b', borderBottom: active ? '2.5px solid #0891b2' : '2.5px solid transparent', marginBottom: '-1.5px', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'color .15s', whiteSpace: 'nowrap' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">{iconEl}</svg>
      {label}
      <span style={{ fontSize: '7.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '20px', letterSpacing: '.04em', ...(badgeActive ? { background: 'rgba(6,182,212,.12)', border: '1px solid rgba(6,182,212,.25)', color: '#0891b2' } : { background: 'rgba(148,163,184,.1)', border: '1px solid rgba(148,163,184,.2)', color: '#64748b' }) }}>{badge}</span>
    </button>
  );
}

const SUB_BAR: CSSProperties = { display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)' };

/* Top-bar search box (visual only, faithful to prototype) */
function SearchBox() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)', flex: 1, maxWidth: '680px' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.7 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input type="text" placeholder="Search by Supplier ID, Name, Segment or Status..." style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, background: 'transparent', minWidth: 0 }} />
      <span style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>⌘ K</span>
    </div>
  );
}

const TOP_BAR: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 10px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '52px' };

/* ───────────────────────── Main component ───────────────────────── */
export default function ClmSupplierProfilePage() {
  const [clmTab, setClmTab] = useState<'party' | 'txn'>('party');
  const [brefCollapsed, setBrefCollapsed] = useState(false);

  // Party-wise
  const [partyShip, setPartyShip] = useState<'with' | 'without'>('with');
  const [wsSub, setWsSub] = useState<'mat' | 'logi'>('mat');
  const [wosSub, setWosSub] = useState<'svc' | 'mat' | 'logi'>('svc');

  // Transaction-wise
  const [txnShip, setTxnShip] = useState<'with' | 'without'>('with');
  const [txnWsSub, setTxnWsSub] = useState<'mat' | 'logi'>('mat');
  const [txnWosSub, setTxnWosSub] = useState<'svc' | 'mat' | 'logi'>('svc');

  return (
    <div className="seg-page">
      <style>{CSS}</style>

      {/* ── Header Strip ── */}
      <div className="seg-page-card" style={{ background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%)' }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: '64px' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px', background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)' }} />
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.5),transparent)', pointerEvents: 'none' }} />
          <span style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle,rgba(6,182,212,.07) 1px,transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', zIndex: 1, paddingLeft: '10px' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.22),0 4px 12px rgba(8,145,178,.4)' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-4 0v2" /><path d="M8 7V5a2 2 0 0 0-4 0v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg>
              </div>
              <span style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '10px', height: '10px', borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff', boxShadow: '0 0 5px rgba(34,197,94,.45)' }} />
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.15 }}>Supplier Profile</div>
              <div style={{ fontSize: '11px', fontWeight: 500, color: '#0e7490', opacity: 0.9, marginTop: '3px' }}>Track supplier compliance, QC, agreements, and procurement readiness.</div>
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

      {/* ── What We Are Doing Here ── */}
      <div className="seg-page-card">
        <div className={`bref-box${brefCollapsed ? ' is-collapsed' : ''}`} style={{ border: 'none', borderRadius: 0, boxShadow: 'none', margin: 0 }}>
          <div className="bref-box__header" onClick={() => setBrefCollapsed((c) => !c)}>
            <div className="bref-box__header-ico">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-4 0v2" /></svg>
            </div>
            <div className="bref-box__header-mid">
              <div className="bref-box__header-row">
                <div className="bref-box__header-label">Supplier Profile</div>
                <div className="bref-box__header-sep" />
                <div className="bref-box__header-title">What We Are Doing Here</div>
              </div>
              <div className="bref-box__header-sub">Manage supplier onboarding, KYC, QC documents, agreements, and procurement compliance.</div>
            </div>
            <div className="bref-box__header-right">
              <div className="bref-box__toggle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
          </div>
          <div className="bref-box__body">
            <div className="bref-item">
              <div className="bref-item__top">
                <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-4 0v2" /><path d="M8 7V5a2 2 0 0 0-4 0v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg></div>
                <span className="bref-item__num">Step 01</span>
              </div>
              <div className="bref-item__title">Supplier Registration</div>
              <div className="bref-item__desc">Create supplier profiles.</div>
            </div>
            <div className="bref-item">
              <div className="bref-item__top">
                <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></div>
                <span className="bref-item__num">Step 02</span>
              </div>
              <div className="bref-item__title">KYC &amp; Due Diligence</div>
              <div className="bref-item__desc">Verify supplier documents.</div>
            </div>
            <div className="bref-item">
              <div className="bref-item__top">
                <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg></div>
                <span className="bref-item__num">Step 03</span>
              </div>
              <div className="bref-item__title">Trade &amp; QC Docs</div>
              <div className="bref-item__desc">Track licenses, QC, and trade documents.</div>
            </div>
            <div className="bref-item">
              <div className="bref-item__top">
                <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg></div>
                <span className="bref-item__num">Step 04</span>
              </div>
              <div className="bref-item__title">Agreement &amp; Compliance</div>
              <div className="bref-item__desc">Manage supplier agreements and approvals.</div>
            </div>
            <div className="bref-item">
              <div className="bref-item__top">
                <div className="bref-item__ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></div>
                <span className="bref-item__num">Step 05</span>
              </div>
              <div className="bref-item__title">Procurement Readiness</div>
              <div className="bref-item__desc">Approve suppliers for procurement and shipment workflows.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PARTY WISE PANEL ── */}
      {clmTab === 'party' && (
        <div>
          <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden', marginTop: '8px' }}>
            <div style={TOP_BAR}>
              <div className="bpa-seg">
                <button className={`bpa-tab ${partyShip === 'with' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setPartyShip('with')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                  With Shipment ID
                </button>
                <button className={`bpa-tab ${partyShip === 'without' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setPartyShip('without')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                  Without Shipment ID
                </button>
              </div>
              <SearchBox />
            </div>

            {/* With Shipment ID */}
            {partyShip === 'with' && (
              <div style={{ background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={SUB_BAR}>
                  <SubTab active={wsSub === 'mat'} onClick={() => setWsSub('mat')} label="Material Suppliers" badge="MAT" badgeActive={wsSub === 'mat'} icon="mat" />
                  <SubTab active={wsSub === 'logi'} onClick={() => setWsSub('logi')} label="Logistics Suppliers (FFD)" badge="FFD" badgeActive={wsSub === 'logi'} icon="logi" />
                </div>
                {wsSub === 'mat' && <PartyTable data={spMatData} label="suppliers" />}
                {wsSub === 'logi' && <PartyTable data={spLogiData} label="suppliers" />}
              </div>
            )}

            {/* Without Shipment ID */}
            {partyShip === 'without' && (
              <div style={{ background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={SUB_BAR}>
                  <SubTab active={wosSub === 'svc'} onClick={() => setWosSub('svc')} label="Services Suppliers" badge="SVC" badgeActive={wosSub === 'svc'} icon="svc" />
                  <SubTab active={wosSub === 'mat'} onClick={() => setWosSub('mat')} label="Material Suppliers" badge="MAT" badgeActive={wosSub === 'mat'} icon="mat" />
                  <SubTab active={wosSub === 'logi'} onClick={() => setWosSub('logi')} label="Logistics Suppliers (FFD)" badge="FFD" badgeActive={wosSub === 'logi'} icon="logi" />
                </div>
                {wosSub === 'svc' && <PartyTable data={spWosSvcData} label="suppliers" />}
                {wosSub === 'mat' && <PartyTable data={spWosMatData} label="suppliers" />}
                {wosSub === 'logi' && <PartyTable data={spWosLogiData} label="suppliers" />}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TRANSACTION WISE PANEL ── */}
      {clmTab === 'txn' && (
        <div>
          <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden', marginTop: '8px' }}>
            <div style={TOP_BAR}>
              <div className="bpa-seg">
                <button className={`bpa-tab ${txnShip === 'with' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setTxnShip('with')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                  With Shipment ID
                </button>
                <button className={`bpa-tab ${txnShip === 'without' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setTxnShip('without')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                  Without Shipment ID
                </button>
              </div>
              <SearchBox />
            </div>

            {/* With Shipment ID */}
            {txnShip === 'with' && (
              <div style={{ background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={SUB_BAR}>
                  <SubTab active={txnWsSub === 'mat'} onClick={() => setTxnWsSub('mat')} label="Material Suppliers" badge="MAT" badgeActive={txnWsSub === 'mat'} icon="mat" />
                  <SubTab active={txnWsSub === 'logi'} onClick={() => setTxnWsSub('logi')} label="Logistics Suppliers (FFD)" badge="FFD" badgeActive={txnWsSub === 'logi'} icon="logi" />
                </div>
                {txnWsSub === 'mat' && <TxnWithTable data={spTxnMatData} />}
                {txnWsSub === 'logi' && <TxnWithTable data={spTxnLogiData} />}
              </div>
            )}

            {/* Without Shipment ID */}
            {txnShip === 'without' && (
              <div style={{ background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={SUB_BAR}>
                  <SubTab active={txnWosSub === 'svc'} onClick={() => setTxnWosSub('svc')} label="Services Suppliers" badge="SVC" badgeActive={txnWosSub === 'svc'} icon="svc" />
                  <SubTab active={txnWosSub === 'mat'} onClick={() => setTxnWosSub('mat')} label="Material Suppliers" badge="MAT" badgeActive={txnWosSub === 'mat'} icon="mat" />
                  <SubTab active={txnWosSub === 'logi'} onClick={() => setTxnWosSub('logi')} label="Logistics Suppliers (FFD)" badge="FFD" badgeActive={txnWosSub === 'logi'} icon="logi" />
                </div>
                {txnWosSub === 'svc' && <TxnWosSvcTable data={spTxnWosSvcData} />}
                {txnWosSub === 'mat' && <TxnWosProcTable data={spTxnWosMatData} />}
                {txnWosSub === 'logi' && <TxnWosProcTable data={spTxnWosLogiData} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
