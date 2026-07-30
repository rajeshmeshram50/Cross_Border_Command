import { useState, useEffect, useRef, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import CustomerEvidenceVaultModal, { type CustomerVaultTarget, type TabKey as VaultTab } from '../../sales/core-masters/customer/CustomerEvidenceVaultModal';
import ConsigneeEvidenceVaultModal, { type ConsigneeVaultTarget } from '../../sales/core-masters/consignee/ConsigneeEvidenceVaultModal';
import ClmDocsPopup, { type DocCategory } from '../shared/ClmDocsPopup';
import Tooltip from '../../../components/ui/Tooltip';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { ShimmerTableRows } from '../../../components/ui/Shimmer';
import WorklistPager from '../../../components/ui/WorklistPager';

/*
 * CLM → Buyer Profile page.
 * Live data comes from GET /clm/buyer-profile (ClmBuyerProfileController):
 *   - buyers      : every customer + KYC/DD/TL/TD + agreement progress
 *   - consignees  : every consignee, grouped by parent customer
 *   - ws_eq/ws_neq/wos_eq/wos_neq : the opportunity transaction matrix
 * Compliance progress mirrors the Evidence Vault (segment-rule required
 * docs vs uploaded). The types below are the response row shapes.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */
type Prog = { d: number; t: number };

type BuyerRow = {
  sr: number; id: string; db_id?: number; name: string; seg: string[]; sc: string; sb: string;
  country: string; cn: number; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
};

type ConsRow = {
  sr: number; id: string; cid: string; cids?: string[]; db_id?: number; name: string; seg: string; sc: string; sb: string;
  country: string; same_as_customer?: boolean; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
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

/* Shape of GET /clm/buyer-profile → data. */
type BpData = {
  buyers: BuyerRow[]; consignees: ConsRow[];
  ws_eq: WsEqRow[]; ws_neq: WsNeqRow[]; wos_eq: WosEqRow[]; wos_neq: WosNeqRow[];
};
const EMPTY_BP: BpData = { buyers: [], consignees: [], ws_eq: [], ws_neq: [], wos_eq: [], wos_neq: [] };

/* ──────────────────────────────────────────────────────────────────────────
 * Mock data (verbatim from the prototype)
 * ────────────────────────────────────────────────────────────────────────── */
const bpBuyerData: BuyerRow[] = [
  { sr: 1, id: 'C-001', name: 'Shree Exports Pvt Ltd', seg: ['Dry Fruits', 'Agro'], sc: '#0e7490', sb: '#f0fdff', country: 'India', cn: 3, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 2, id: 'C-002', name: 'GreenHarvest Global', seg: ['Agro', 'Rice & Grains'], sc: '#065f46', sb: '#f0fdf4', country: 'India', cn: 5, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 3 },
  { sr: 3, id: 'C-003', name: 'GreenHarvest Agri-Exports', seg: ['Rice & Grains'], sc: '#065f46', sb: '#f0fdf4', country: 'India', cn: 2, kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 4, id: 'C-004', name: 'International Buyer LLC', seg: ['Spices', 'Dry Fruits'], sc: '#92400e', sb: '#fffbeb', country: 'UAE', cn: 4, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 5, id: 'C-005', name: 'QuickTrade Resellers', seg: ['Pulses', 'Millets'], sc: '#7f1d1d', sb: '#fef2f2', country: 'India', cn: 1, kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 6, id: 'C-006', name: 'Fit Nation Pvt Ltd', seg: ['Dry Fruits', 'Organic Foods'], sc: '#92400e', sb: '#fffbeb', country: 'India', cn: 2, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 7, id: 'C-007', name: 'Manoj Jacob Foods', seg: ['Coconut Oil', 'Agro'], sc: '#065f46', sb: '#f0fdf4', country: 'India', cn: 3, kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 8, id: 'C-008', name: 'FreshMart Retailers', seg: ['Basmati Rice', 'Spices'], sc: '#0e7490', sb: '#f0fdff', country: 'India', cn: 1, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 9, id: 'C-009', name: 'Bharat Agro Traders', seg: ['Millets', 'Pulses'], sc: '#92400e', sb: '#fffbeb', country: 'India', cn: 4, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 10, id: 'C-010', name: 'NatureFresh Exports', seg: ['Organic Foods', 'Dry Fruits'], sc: '#0e7490', sb: '#f0fdff', country: 'Germany', cn: 2, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 11, id: 'C-011', name: 'AgriWorld Trading Co.', seg: ['Agro', 'Spices'], sc: '#065f46', sb: '#f0fdf4', country: 'UAE', cn: 3, kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 12, id: 'C-012', name: 'PrimeTrade International', seg: ['Spices', 'Rice & Grains'], sc: '#92400e', sb: '#fffbeb', country: 'UK', cn: 2, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 3 },
  { sr: 13, id: 'C-013', name: 'Sunrise Food Products', seg: ['Dry Fruits'], sc: '#0e7490', sb: '#f0fdff', country: 'India', cn: 1, kyc: { d: 2, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 14, id: 'C-014', name: 'GlobalGrain Suppliers', seg: ['Rice & Grains', 'Agro'], sc: '#065f46', sb: '#f0fdf4', country: 'Bangladesh', cn: 3, kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 15, id: 'C-015', name: 'EastCoast Commodities', seg: ['Pulses', 'Basmati Rice'], sc: '#7f1d1d', sb: '#fef2f2', country: 'India', cn: 2, kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
];

const bpConsData: ConsRow[] = [
  { sr: 1, id: 'CS-001', cid: 'C-001', name: 'Dubai Trade Hub LLC', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', country: 'UAE', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 2, id: 'CS-002', cid: 'C-001', name: 'Al Reem Distributors', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', country: 'UAE', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 3, id: 'CS-003', cid: 'C-001', name: 'Khalid & Sons Trading', seg: 'Dry Fruits', sc: '#0e7490', sb: '#f0fdff', country: 'Kuwait', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 4, id: 'CS-004', cid: 'C-002', name: 'Amsterdam Fresh BV', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', country: 'Netherlands', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 5, id: 'CS-005', cid: 'C-002', name: 'GreenCargo Rotterdam', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', country: 'Netherlands', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 3, t: 3 }, ship: 3 },
  { sr: 6, id: 'CS-006', cid: 'C-002', name: 'EuroAgri Imports GmbH', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', country: 'Germany', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 7, id: 'CS-007', cid: 'C-002', name: 'Antwerp Commodities SA', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', country: 'Belgium', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 8, id: 'CS-008', cid: 'C-002', name: 'Nordic Trade Partners', seg: 'Agro', sc: '#065f46', sb: '#f0fdf4', country: 'Sweden', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 9, id: 'CS-009', cid: 'C-003', name: 'Dhaka Grain Corp.', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', country: 'Bangladesh', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 10, id: 'CS-010', cid: 'C-003', name: 'Bengal Export House', seg: 'Rice & Grains', sc: '#065f46', sb: '#f0fdf4', country: 'Bangladesh', kyc: { d: 0, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 11, id: 'CS-011', cid: 'C-004', name: 'Gulf Spice Trading LLC', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', country: 'UAE', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 12, id: 'CS-012', cid: 'C-004', name: 'Muscat Commodity House', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', country: 'Oman', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
  { sr: 13, id: 'CS-013', cid: 'C-004', name: 'Sharjah Food Traders', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', country: 'UAE', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 14, id: 'CS-014', cid: 'C-004', name: 'Bahrain Imports Co.', seg: 'Spices', sc: '#92400e', sb: '#fffbeb', country: 'Bahrain', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 15, id: 'CS-015', cid: 'C-005', name: 'Mumbai Resale Hub', seg: 'Pulses', sc: '#7f1d1d', sb: '#fef2f2', country: 'India', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 16, id: 'CS-016', cid: 'C-006', name: 'London Health Foods Ltd', seg: 'Dry Fruits', sc: '#92400e', sb: '#fffbeb', country: 'UK', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 17, id: 'CS-017', cid: 'C-006', name: 'Paris Organic Imports', seg: 'Dry Fruits', sc: '#92400e', sb: '#fffbeb', country: 'France', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 18, id: 'CS-018', cid: 'C-007', name: 'Singapore Coconut Trading', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', country: 'Singapore', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 19, id: 'CS-019', cid: 'C-007', name: 'KL Food Industries Sdn Bhd', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', country: 'Malaysia', kyc: { d: 4, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 1, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 20, id: 'CS-020', cid: 'C-007', name: 'Jakarta Agro Processors', seg: 'Coconut Oil', sc: '#065f46', sb: '#f0fdf4', country: 'Indonesia', kyc: { d: 3, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 21, id: 'CS-021', cid: 'C-008', name: 'Tokyo Rice Importers KK', seg: 'Basmati Rice', sc: '#0e7490', sb: '#f0fdff', country: 'Japan', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 }, ship: 2 },
  { sr: 22, id: 'CS-022', cid: 'C-009', name: 'Riyadh Grain Traders', seg: 'Millets', sc: '#92400e', sb: '#fffbeb', country: 'Saudi Arabia', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 23, id: 'CS-023', cid: 'C-009', name: 'Jeddah Food Distribution', seg: 'Millets', sc: '#92400e', sb: '#fffbeb', country: 'Saudi Arabia', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 24, id: 'CS-024', cid: 'C-009', name: 'Dammam Wholesale Co.', seg: 'Millets', sc: '#92400e', sb: '#fffbeb', country: 'Saudi Arabia', kyc: { d: 3, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 0, t: 2 }, ship: 0 },
  { sr: 25, id: 'CS-025', cid: 'C-009', name: 'Abu Dhabi Commodities LLC', seg: 'Millets', sc: '#92400e', sb: '#fffbeb', country: 'UAE', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 }, ship: 1 },
  { sr: 26, id: 'CS-026', cid: 'C-010', name: 'Berlin Organic Hub GmbH', seg: 'Organic Foods', sc: '#0e7490', sb: '#f0fdff', country: 'Germany', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 3 }, ship: 2 },
];

const wsEqData: WsEqRow[] = [
  { sr: 1, shp: 'SHP-001', opp: 'OPP-101', customer: 'Shree Exports Pvt Ltd', pi: 'PI-2024-001', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 2, shp: 'SHP-002', opp: 'OPP-102', customer: 'GreenHarvest Global', pi: 'PI-2024-002', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 3, shp: 'SHP-003', opp: 'OPP-103', customer: 'International Buyer LLC', pi: 'PI-2024-003', reg: 'Both', kyc: { d: 2, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 0, t: 2 } },
  { sr: 4, shp: 'SHP-004', opp: 'OPP-104', customer: 'Fit Nation Pvt Ltd', pi: 'PI-2024-004', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 5, shp: 'SHP-005', opp: 'OPP-105', customer: 'FreshMart Retailers', pi: 'PI-2024-005', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 } },
  { sr: 6, shp: 'SHP-006', opp: 'OPP-106', customer: 'NatureFresh Exports', pi: 'PI-2024-006', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 7, shp: 'SHP-007', opp: 'OPP-107', customer: 'QuickTrade Resellers', pi: 'PI-2024-007', reg: 'High', kyc: { d: 1, t: 4 }, dd: { d: 0, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 0, t: 4 }, agr: { d: 0, t: 2 } },
];

const wsNeqData: WsNeqRow[] = [
  { sr: 1, shp: 'SHP-008', opp: 'OPP-108', customer: 'Bharat Agro Traders', consignee: 'AgroLink FZE', pi: 'PI-2024-008', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 2, shp: 'SHP-009', opp: 'OPP-109', customer: 'PrimeTrade International', consignee: 'Gulf Foods LLC', pi: 'PI-2024-009', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 1, t: 2 } },
  { sr: 3, shp: 'SHP-010', opp: 'OPP-110', customer: 'GlobalGrain Suppliers', consignee: 'Dhaka Imports Co.', pi: 'PI-2024-010', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 4, shp: 'SHP-011', opp: 'OPP-111', customer: 'Sunrise Food Products', consignee: 'EuroMart GmbH', pi: 'PI-2024-011', reg: 'High', kyc: { d: 2, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 0, t: 2 } },
  { sr: 5, shp: 'SHP-012', opp: 'OPP-112', customer: 'AgriWorld Trading Co.', consignee: 'Emirates Spice House', pi: 'PI-2024-012', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 6, shp: 'SHP-013', opp: 'OPP-113', customer: 'EastCoast Commodities', consignee: 'London Grain Ltd', pi: 'PI-2024-013', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 1, t: 2 } },
];

const wosEqData: WosEqRow[] = [
  { sr: 1, opp: 'OPP-201', customer: 'Shree Exports Pvt Ltd', pi: 'PI-2024-101', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 2, opp: 'OPP-202', customer: 'GreenHarvest Global', pi: '', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 0, t: 0 } },
  { sr: 3, opp: 'OPP-203', customer: 'International Buyer LLC', pi: 'PI-2024-103', reg: 'Both', kyc: { d: 2, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 } },
  { sr: 4, opp: 'OPP-204', customer: 'Fit Nation Pvt Ltd', pi: 'PI-2024-104', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 5, opp: 'OPP-205', customer: 'FreshMart Retailers', pi: '', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 2, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 2, t: 4 }, agr: { d: 0, t: 0 } },
  { sr: 6, opp: 'OPP-206', customer: 'NatureFresh Exports', pi: 'PI-2024-106', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
];

const wosNeqData: WosNeqRow[] = [
  { sr: 1, opp: 'OPP-301', customer: 'Bharat Agro Traders', consignee: 'AgroLink FZE', pi: 'PI-2024-201', reg: 'High', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 2, opp: 'OPP-302', customer: 'PrimeTrade International', consignee: 'Gulf Foods LLC', pi: '', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 2, t: 3 }, td: { d: 3, t: 4 }, agr: { d: 0, t: 0 } },
  { sr: 3, opp: 'OPP-303', customer: 'GlobalGrain Suppliers', consignee: 'Dhaka Imports Co.', pi: 'PI-2024-203', reg: 'Low', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 2, t: 2 } },
  { sr: 4, opp: 'OPP-304', customer: 'Sunrise Food Products', consignee: 'EuroMart GmbH', pi: 'PI-2024-204', reg: 'High', kyc: { d: 2, t: 4 }, dd: { d: 1, t: 3 }, tl: { d: 0, t: 3 }, td: { d: 1, t: 4 }, agr: { d: 1, t: 2 } },
  { sr: 5, opp: 'OPP-305', customer: 'AgriWorld Trading Co.', consignee: 'Emirates Spice House', pi: '', reg: 'Both', kyc: { d: 4, t: 4 }, dd: { d: 3, t: 3 }, tl: { d: 3, t: 3 }, td: { d: 4, t: 4 }, agr: { d: 0, t: 0 } },
];

const BP_PER_PAGE = 10;
const WS_PER_PAGE = 10;
const WOS_PER_PAGE = 10;

/* ──────────────────────────────────────────────────────────────────────────
 * useDynamicPerPage — rows-per-page that fits the viewport.
 * Measures the table wrapper's distance from the top of the screen and divides
 * the remaining height by a row's height, so the table fills the screen and the
 * pager footer ends up pinned to the bottom (instead of floating up with a
 * fixed 10-row page). Recomputes on resize and whenever `deps` change (tab
 * switch, analytics strip collapse, etc.).
 * ────────────────────────────────────────────────────────────────────────── */
function useDynamicPerPage(
  ref: React.RefObject<HTMLElement>,
  { rowHeight = 46, min = 5, footer = 56, gap = 18, deps = [] as unknown[] } = {},
): number {
  const [perPage, setPerPage] = useState(BP_PER_PAGE);
  useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - footer - gap;
      const rows = Math.floor(avail / rowHeight);
      setPerPage(Number.isFinite(rows) ? Math.max(min, rows) : BP_PER_PAGE);
    };
    calc();
    const t = window.setTimeout(calc, 80); // re-measure after layout settles
    window.addEventListener('resize', calc);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', calc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return perPage;
}

/* ──────────────────────────────────────────────────────────────────────────
 * useFillHeight — min-height that stretches a card to the bottom of the
 * viewport so its pager footer pins there. Recomputes on resize / deps.
 * ────────────────────────────────────────────────────────────────────────── */
function useFillHeight(
  ref: React.RefObject<HTMLElement>,
  { gap = 14, min = 240, deps = [] as unknown[] } = {},
): number | undefined {
  const [h, setH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setH(Math.max(min, Math.round(window.innerHeight - top - gap)));
    };
    calc();
    const t = window.setTimeout(calc, 80);
    window.addEventListener('resize', calc);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', calc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return h;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scoped CSS (extracted from the prototype)
 * ────────────────────────────────────────────────────────────────────────── */
const BP_CSS = `
/* margin-top:-8px — the IDIMS shell pads .page-content 16px at the top
 * (Layouts/index.tsx) while this stack sets its cards 8px apart, so the first
 * card sat twice as far from the top of the page as it did from the card below
 * it. Pulling 8px back makes the space above the header strip match the gap
 * beneath it. */
.seg-page { background: #F4F6FB; min-height: calc(100vh - 56px); padding: 0; margin-top: -8px; display:flex; flex-direction:column; gap:8px; font-family: var(--font-sans); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
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
/* "What We Are Doing Here" header bar text (class-styled). */
[data-bs-theme="dark"] .bref-box__header-label { color: #67e8f9 !important; }
[data-bs-theme="dark"] .bref-box__header-title { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .bref-box__header-sub   { color: #7dd3fc !important; }
[data-bs-theme="dark"] .bref-box__header-sep   { background: rgba(6,182,212,.35) !important; }
[data-bs-theme="dark"] .bpa-seg { background: rgba(255,255,255,.05) !important; }
[data-bs-theme="dark"] .bpa-tab-inactive { color: #67e8f9 !important; }
/* light cyan gradient strips / surfaces → dark.
 * NOTE: the browser serialises inline hex colours as rgb() in the style
 * attribute, so these matchers MUST use the rgb() form, not #hex. */
[data-bs-theme="dark"] .seg-page [style*="rgb(224, 249, 253)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(206, 248, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(244, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(240, 253, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 250, 251)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(236, 254, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(232, 251, 253)"] { background: #16263a !important; }
/* Light cyan banner gradients (110deg multi-stop) → dark teal gradient.
 * The per-stop rgb matchers above only flatten the banners to a solid; a
 * matching dark gradient reads better and mirrors the light-mode look. Placed
 * AFTER the flat sweep so its full-shorthand wins the specificity tie, and
 * scoped to .seg-page so the portaled consignees modal (its own dark header
 * gradient) is left untouched. Light mode is unaffected (dark-only selector). */
[data-bs-theme="dark"] .seg-page [style*="linear-gradient(110deg"] { background: linear-gradient(110deg,#103a48,#0c2e3a) !important; }
/* Neutralise the white sheen overlays that otherwise wash the top of these
 * cards into an ugly light-to-dark gradient on dark. */
[data-bs-theme="dark"] .seg-page [style*="rgba(255, 255, 255, 0.5)"] { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .bref-box__header::after { background: linear-gradient(180deg,rgba(255,255,255,.05),transparent) !important; }
[data-bs-theme="dark"] .bpa-tab::before { background: linear-gradient(180deg,rgba(255,255,255,.04),transparent) !important; }
/* light indigo/violet ID & PI chips (#eef0ff/#f5f6ff/#eef2ff/#f5f3ff) → dark */
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 240, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 246, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(238, 242, 255)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(245, 243, 255)"] { background: rgba(99, 102, 241, .18) !important; border-color: rgba(129, 140, 248, .35) !important; }
/* indigo/violet chip text (#4f46e5/#4338ca/#7c3aed) → light */
[data-bs-theme="dark"] .seg-page [style*="rgb(79, 70, 229)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(67, 57, 202)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(124, 58, 237)"] { color: #c7d2fe !important; }
/* status-pill light bg (#f8fafc "not started") + progress-bar track
 * (rgba(6,182,212,.1)) → visible on dark. */
[data-bs-theme="dark"] .seg-page [style*="rgb(248, 250, 252)"] { background: rgba(148, 163, 184, .18) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgba(6, 182, 212, 0.1)"] { background: rgba(148, 163, 184, .30) !important; }
/* white inline cards (KPI tiles) → dark */
[data-bs-theme="dark"] .seg-page [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .seg-page [style*="background:rgb(255, 255, 255)"] { background: #0f172a !important; border-color: rgba(6,182,212,.22) !important; }
/* dark inline text → light (rgb() forms of #0c4a6e/#0f172a/#1f2937/#475569/#0e7490) */
[data-bs-theme="dark"] .seg-page [style*="rgb(12, 74, 110)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(15, 23, 42)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(31, 41, 55)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(71, 85, 105)"],
[data-bs-theme="dark"] .seg-page [style*="rgb(14, 116, 144)"] { color: #cfe8f3 !important; }
/* muted grey (#94a3b8 — "0/x" badge numbers, "No PI", denominators) → lighter */
[data-bs-theme="dark"] .seg-page [style*="rgb(148, 163, 184)"] { color: #94c9dd !important; }
/* slate grey (#64748b — SubTab inactive, DIFF tag) → lighter */
[data-bs-theme="dark"] .seg-page [style*="rgb(100, 116, 139)"] { color: #94c9dd !important; }
/* light-cyan toggle fill (#e0f7fa — Customer/Consignee Transactions inactive pill) → dark */
[data-bs-theme="dark"] .seg-page [style*="rgb(224, 247, 250)"] { background: rgba(8,145,178,.16) !important; }
/* REG. STATUS badges — Low (green #ecfdf5) / High (amber #fef3c7) → translucent on dark.
   Both (indigo #eef2ff) is already handled by the indigo-chip sweep above. */
[data-bs-theme="dark"] .seg-page [style*="rgb(236, 253, 245)"] { background: rgba(16,185,129,.18) !important; border-color: rgba(16,185,129,.4) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(254, 243, 199)"] { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.4) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(5, 150, 105)"] { color: #6ee7b7 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(217, 119, 6)"] { color: #fcd34d !important; }
/* Segment chips — light tint backgrounds (green/amber/red) → translucent on dark
   (#f0fdff purple/#f5f3ff are already handled above). */
[data-bs-theme="dark"] .seg-page [style*="rgb(240, 253, 244)"] { background: rgba(16,185,129,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(255, 251, 235)"] { background: rgba(245,158,11,.16) !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(254, 242, 242)"] { background: rgba(239,68,68,.16) !important; }
/* …and their dark text → light */
[data-bs-theme="dark"] .seg-page [style*="rgb(6, 95, 70)"]  { color: #6ee7b7 !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(146, 64, 14)"] { color: #fcd34d !important; }
[data-bs-theme="dark"] .seg-page [style*="rgb(127, 29, 29)"] { color: #fca5a5 !important; }
/* ⌘K search-hint kbd (#f1f5f9) → dark */
[data-bs-theme="dark"] .seg-page [style*="rgb(241, 245, 249)"] { background: rgba(148,163,184,.18) !important; border-color: rgba(148,163,184,.3) !important; }
/* data tables — header strip + rows */
[data-bs-theme="dark"] .seg-page-card table { background: transparent !important; }
[data-bs-theme="dark"] .seg-page-card thead tr { background: #16263a !important; }
[data-bs-theme="dark"] .seg-page-card thead th { color: #67e8f9 !important; border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .seg-page-card tbody tr { background: transparent !important; border-bottom-color: rgba(6,182,212,.10) !important; }
[data-bs-theme="dark"] .seg-page-card tbody td { color: #cbd5e1 !important; }
/* Light-cyan (#A5F3FC = rgb(165,243,252)) borders — used inline on table header
 * rows, toolbar/panel dividers and search boxes — had no dark sweep, so they
 * rendered as bright near-WHITE lines cutting across the dark cards (bug #57).
 * Mute them to the same translucent cyan the rest of the dark theme uses. Only
 * the border colour changes, so layout + text are untouched. */
[data-bs-theme="dark"] .seg-page [style*="rgb(165, 243, 252)"] { border-color: rgba(6,182,212,.22) !important; }
[data-bs-theme="dark"] .bp-buyer-row:hover { background: rgba(8,145,178,.14)!important; box-shadow: inset 3px 0 0 #22d3ee; }
/* Count badges (KYC/DD/TL/TD/Agreements "d/t") — swap the light pill fills for
 * translucent-dark equivalents so all three states read consistently on dark.
 * !important overrides the inline colours; the inner "/t" denominator already
 * recolours via the rgb(148,163,184) sweep above. */
[data-bs-theme="dark"] .bp-prog.is-complete { background: rgba(16,185,129,.18) !important; border-color: rgba(16,185,129,.38) !important; color: #6ee7b7 !important; }
[data-bs-theme="dark"] .bp-prog.is-partial  { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.38) !important; color: #fcd34d !important; }
[data-bs-theme="dark"] .bp-prog.is-none     { background: rgba(148,163,184,.16) !important; border-color: rgba(148,163,184,.30) !important; color: #cbd5e1 !important; }
/* ── Portaled popups (rendered to document.body, OUTSIDE .seg-page) ──
 * The .seg-page dark matchers can't reach these, so they get their own sweep.
 * The injected <style> is global, so these apply wherever the portal lands. */
/* Consignees popup */
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
/* Segment tooltip */
[data-bs-theme="dark"] .seg-pop { background: #1e293b !important; border-color: rgba(6,182,212,.3) !important; box-shadow: 0 18px 50px rgba(0,0,0,.5) !important; }
[data-bs-theme="dark"] .seg-pop span { color: #cfe8f3 !important; }

/* WorklistPager recoloured to the page's cyan/teal theme (default is violet). */
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

/* ── Responsive (tablet / mobile) ──
 * Header strips, analytics headers and table toolbars already flex-wrap inline,
 * so the right-hand controls drop below on narrow screens. These rules make the
 * search box flexible (instead of a fixed 280px that overflows), let the top
 * Party/Transaction tab pills wrap, and hide the long sub-heading on phones. */
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

/* ──────────────────────────────────────────────────────────────────────────
 * Small style helpers
 * ────────────────────────────────────────────────────────────────────────── */
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
/* Buyer / Consignee Transactions sub-tab pill (Buyer ≠ Consignee view). */
const neqTabStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: on ? '#fff' : '#0e7490',
  background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#e0f7fa',
  boxShadow: on ? '0 2px 8px rgba(8,145,178,.35)' : 'none',
});

/* Progress cell used in the buyer / consignee list tables. When `onClick`
 * is supplied the cell becomes a button that deep-links into the Evidence
 * Vault on the matching document bucket. */
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

/* Reg status badge in the transaction tables. */
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

/* Smaller progress cell used in transaction tables (wsProgCell). */
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

/* Compact pager used by the transaction tables (ws/wos). */
function TxnPager({ page, total, perPage, noun, onPage, onPageSize }: { page: number; total: number; perPage: number; noun: string; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
      <span style={{ fontSize: '11.5px', color: '#0e7490', fontWeight: 500 }}>
        Showing <b style={{ color: '#0c4a6e' }}>{start + 1}–{Math.min(start + perPage, total)}</b> of <b style={{ color: '#0c4a6e' }}>{total}</b> {noun}{total !== 1 ? 's' : ''}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {onPageSize && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#0e7490', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Rows per page
            <select value={perPage} onChange={(e) => onPageSize(Number(e.target.value))}
              style={{ height: 28, borderRadius: 7, border: '1.5px solid rgba(6,182,212,.22)', background: '#fff', color: '#0891b2', fontFamily: 'inherit', fontSize: '11px', fontWeight: 700, padding: '0 6px', cursor: 'pointer' }}>
              {Array.from(new Set([perPage, 10, 25, 50])).sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {/* Compact: < current next > (not every page number). */}
        <button onClick={() => page > 1 && onPage(page - 1)} style={{
          width: '28px', height: '28px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.22)',
          background: '#fff', color: '#0891b2', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', opacity: page === 1 ? .4 : 1, cursor: page === 1 ? 'default' : 'pointer',
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {[page, page + 1].filter((p) => p >= 1 && p <= totalPages).map((p) => {
          const a = p === page;
          return (
            <button key={p} onClick={() => onPage(p)} style={{
              width: '28px', height: '28px', borderRadius: '7px',
              border: a ? '1.5px solid #0891b2' : '1.5px solid rgba(6,182,212,.2)',
              background: a ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#fff',
              color: a ? '#fff' : '#0891b2', fontSize: '10.5px', fontWeight: a ? 800 : 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{p}</button>
          );
        })}
        <button onClick={() => page < totalPages && onPage(page + 1)} style={{
          width: '28px', height: '28px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.22)',
          background: '#fff', color: '#0891b2', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', opacity: page === totalPages ? .4 : 1, cursor: page === totalPages ? 'default' : 'pointer',
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </div>
  );
}

const txnTableHeaderRow: CSSProperties = { background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderBottom: '1.5px solid #A5F3FC' };
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

/* ──────────────────────────────────────────────────────────────────────────
 * Main component
 * ────────────────────────────────────────────────────────────────────────── */
export default function ClmBuyerProfilePage() {
  // tab state
  const [brefCollapsed, setBrefCollapsed] = useState(true);
  const [clmTab, setClmTab] = useState<'party' | 'txn'>('party');
  const [bpaTab, setBpaTab] = useState<'buyer' | 'consignee'>('buyer');
  const [buyerScope, setBuyerScope] = useState<'international' | 'domestic'>('international');
  const [consScope, setConsScope] = useState<'international' | 'domestic'>('international');
  // Analytics KPI cards double as list filters. 'all' clears the filter; the
  // others narrow the list below to the matching compliance state.
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
  // Within "Buyer ≠ Consignee" — switch the table between the buyer's and the
  // consignee's compliance perspective.
  const [neqParty, setNeqParty] = useState<'buyer' | 'consignee'>('buyer');

  // collapsible analytics strips
  const [partyAnalyticsOpen, setPartyAnalyticsOpen] = useState(true);
  const [txnAnalyticsOpen, setTxnAnalyticsOpen] = useState(true);

  // pagination state
  const [buyerPage, setBuyerPage] = useState(1);
  const [consPage, setConsPage] = useState(1);
  // Dynamic rows-per-page: the Buyer / Consignee list tables size their page to
  // the viewport so the pager footer stays pinned to the bottom of the screen.
  const buyerTableRef = useRef<HTMLDivElement>(null);
  const consTableRef = useRef<HTMLDivElement>(null);
  const buyerCardRef = useRef<HTMLDivElement>(null);
  const consCardRef = useRef<HTMLDivElement>(null);
  // Rows-per-page: auto-fits the viewport by default, but a manual choice from
  // the pager's "Rows per page" selector (when set) overrides the auto-fit.
  const [bpManualSize, setBpManualSize] = useState<number | null>(null);
  const [consManualSize, setConsManualSize] = useState<number | null>(null);
  const bpDynamicSize = useDynamicPerPage(buyerTableRef, { deps: [bpaTab, partyAnalyticsOpen] });
  const consDynamicSize = useDynamicPerPage(consTableRef, { deps: [bpaTab, partyAnalyticsOpen] });
  const bpPerPage = bpManualSize ?? bpDynamicSize;
  const consPerPage = consManualSize ?? consDynamicSize;
  // Stretch each list card to the bottom of the viewport so its pager footer
  // pins to the bottom of the screen.
  const buyerCardFill = useFillHeight(buyerCardRef, { deps: [bpaTab, partyAnalyticsOpen] });
  const consCardFill = useFillHeight(consCardRef, { deps: [bpaTab, partyAnalyticsOpen] });
  // Transaction-wise tables (ws/wos · eq/neq): one card holds the active table,
  // so a single dynamic page size drives whichever is visible.
  const txnCardRef = useRef<HTMLDivElement>(null);
  const txnTableRef = useRef<HTMLDivElement>(null);
  // Auto-fit page size by default; a manual "Rows per page" choice overrides it
  // (mirrors the Buyer / Consignee list tables).
  const [txnManualSize, setTxnManualSize] = useState<number | null>(null);
  const txnDynamicSize = useDynamicPerPage(txnTableRef, { deps: [clmTab, txnAnalyticsOpen, shipTab, wsSub, wosSub, neqParty] });
  const txnPerPage = txnManualSize ?? txnDynamicSize;
  const txnCardFill = useFillHeight(txnCardRef, { deps: [clmTab, txnAnalyticsOpen, shipTab, wsSub, wosSub, neqParty] });
  // Buyer / Consignee list search boxes (name · id · segment · country).
  const [buyerSearch, setBuyerSearch] = useState('');
  const [consSearch, setConsSearch] = useState('');
  // Transaction-wise CLM search box (shipment · opportunity · customer ·
  // consignee · PI · reg. status). Shared by all four transaction tables.
  const [txnSearch, setTxnSearch] = useState('');
  const [wsEqPage, setWsEqPage] = useState(1);
  const [wsNeqPage, setWsNeqPage] = useState(1);
  const [wosEqPage, setWosEqPage] = useState(1);
  const [wosNeqPage, setWosNeqPage] = useState(1);

  // Evidence Vault popups — opened only from the explicit Evidence Vault
  // button at the end of each row.
  const [buyerVault, setBuyerVault] = useState<CustomerVaultTarget | null>(null);
  const [consVault, setConsVault]   = useState<ConsigneeVaultTarget | null>(null);
  const [buyerVaultTab, setBuyerVaultTab] = useState<VaultTab>('company-dd');
  const [consVaultTab, setConsVaultTab]   = useState<VaultTab>('company-dd');
  // Single-bucket documents popup — opened when a KYC / DD / TL / TD /
  // Agreements progress cell is clicked. Shows just that category as a card.
  const [docsPopup, setDocsPopup] = useState<{ ownerType: 'customer' | 'consignee'; ownerId: number; company: string; category: DocCategory } | null>(null);
  // Segment "+N" popover — lists all segments for a row when the count badge
  // is clicked (mirrors the DCP authorities badge popover).
  const [segOpen, setSegOpen] = useState<{ key: string; names: string[]; x: number; y: number; flipUp: boolean } | null>(null);
  // Close the fixed-positioned segment popover on scroll/resize so it can't
  // drift away from its badge (capture:true catches ancestor + table scrolls).
  useEffect(() => {
    if (!segOpen) return;
    // Close on ancestor/table/page scroll so the fixed popover can't drift from
    // its badge — BUT ignore scrolls that originate INSIDE the popover's own
    // list (its overflowY:auto). With capture:true a bare handler fired on the
    // popover's inner scroll too, closing it the instant the user tried to
    // scroll the segment list ("not scrolling").
    const close = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Element && e.target.closest('.seg-pop')) return;
      setSegOpen(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [segOpen]);
  // "Consignees for this buyer" popup — opened from the CONSIGNEES count cell.
  const [consListBuyer, setConsListBuyer] = useState<BuyerRow | null>(null);
  // "Customer for this consignee" popup — opened from the CUSTOMER ID cell in
  // the consignee list. A consignee maps to exactly one customer, so this shows
  // that single customer's identity + compliance (mirror of the consignees popup).
  const [custForCons, setCustForCons] = useState<ConsRow | null>(null);

  // Open the Evidence Vault for a buyer / consignee row, focused on a tab.
  // No-ops without a db_id (mirrors the disabled Evidence Vault button).
  const openBuyerVault = (r: BuyerRow, tab: VaultTab) => {
    if (!r.db_id) return;
    setBuyerVaultTab(tab);
    setBuyerVault({ id: r.id, db_id: r.db_id, company: r.name, segment: r.seg.join(', '), country: r.country });
  };
  const openConsVault = (r: ConsRow, tab: VaultTab) => {
    if (!r.db_id) return;
    setConsVaultTab(tab);
    setConsVault({ id: r.id, db_id: r.db_id, company: r.name, segment: r.seg, country: r.country, customerId: r.cid });
  };
  // Open the buyer (customer) Evidence Vault from a transaction row. Reuses the
  // full buyer record (segment, code) when the customer is in the buyer list,
  // else falls back to a minimal target keyed on the customer's db_id.
  const openTxnBuyerVault = (custId?: number, custName?: string, country?: string) => {
    if (!custId) return;
    const row = bp.buyers.find((b) => b.db_id === custId);
    if (row) { openBuyerVault(row, 'company-dd'); return; }
    setBuyerVaultTab('company-dd');
    setBuyerVault({ id: '—', db_id: custId, company: custName || '—', segment: '', country: country || '' });
  };
  // Same, for the consignee perspective (Consignee Transactions view).
  const openTxnConsVault = (consId?: number, consName?: string, country?: string) => {
    if (!consId) return;
    const row = bp.consignees.find((c) => c.db_id === consId);
    if (row) { openConsVault(row, 'company-dd'); return; }
    setConsVaultTab('company-dd');
    setConsVault({ id: '—', db_id: consId, company: consName || '—', segment: '', country: country || '', customerId: '' });
  };

  // Open the single-bucket documents popup for a row's progress cell.
  // No-ops without a db_id (the row has no backing record to fetch).
  const openBuyerDocs = (r: BuyerRow, category: DocCategory) => {
    if (!r.db_id) return;
    setDocsPopup({ ownerType: 'customer', ownerId: r.db_id, company: r.name, category });
  };
  const openConsDocs = (r: ConsRow, category: DocCategory) => {
    if (!r.db_id) return;
    setDocsPopup({ ownerType: 'consignee', ownerId: r.db_id, company: r.name, category });
  };

  // Toggle the segment "+N" popover for a row, positioned under (or above, when
  // there's no room) the count badge. Mirrors the DCP authorities popover.
  const toggleSegPop = (e: React.MouseEvent, key: string, names: string[]) => {
    e.stopPropagation();
    if (segOpen?.key === key) { setSegOpen(null); return; }
    const b = e.currentTarget.getBoundingClientRect();
    const estH = Math.min(280, 34 + names.length * 30);
    const spaceBelow = window.innerHeight - b.bottom;
    const flipUp = spaceBelow < estH + 12 && b.top > spaceBelow;
    setSegOpen({ key, names, x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp });
  };
  // Render a segment cell like the Authorities column: a teal chip for the first
  // segment + a circular teal-gradient "+N" badge that opens the full list.
  const renderSegCell = (key: string, names: string[]) => {
    const segs = names.map((s) => s.trim()).filter(Boolean);
    if (segs.length === 0) return <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>;
    const extra = segs.length - 1;
    return <>
      <Tooltip label={segs[0]}><span style={{ display: 'inline-block', verticalAlign: 'middle', fontSize: '9.5px', fontWeight: 600, color: '#0e7490', background: '#ecfeff', border: '1px solid #a5f3fc', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap', lineHeight: 1.6 }}>{segs[0].length > 30 ? `${segs[0].slice(0, 30)}…` : segs[0]}</span></Tooltip>
      {extra > 0 && (
        <Tooltip label="View all segments"><button type="button" onClick={(e) => toggleSegPop(e, key, segs)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: 'linear-gradient(135deg, #06b6d4, #0891b2, #0e7490)', color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'pointer', flexShrink: 0, boxShadow: '0 2px 8px rgba(8,145,178,.4)', border: 'none', fontFamily: 'inherit' }}>+{extra}</button></Tooltip>
      )}
    </>;
  };

  // ── Live data from GET /clm/buyer-profile ──
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
  // Fetched views — shadow the legacy demo arrays of the same name so the
  // existing render + pagination code below consumes live data unchanged.
  const bpBuyerData = bp.buyers;
  const bpConsData  = bp.consignees;
  // International vs Domestic buyer scope. Domestic = the exporter's home
  // country (India); International = every other country. Drives the Buyer
  // List + the buyer analytics cards so both reflect the chosen tab.
  const HOME_COUNTRY = 'india';
  const isDomesticCountry = (c: string) => (c || '').trim().toLowerCase() === HOME_COUNTRY;
  const isDomesticBuyer = isDomesticCountry;
  const scopedBuyers = bpBuyerData.filter((r) => buyerScope === 'domestic' ? isDomesticBuyer(r.country) : !isDomesticBuyer(r.country));
  const scopedCons = bpConsData.filter((r) => consScope === 'domestic' ? isDomesticCountry(r.country) : !isDomesticCountry(r.country));
  // International vs Domestic transactions — scoped by the buyer's country so
  // the transaction-wise analytics + all four tables follow the chosen tab.
  const txnInScope = <T extends { country?: string }>(rows: T[]): T[] =>
    rows.filter((r) => txnScope === 'domestic' ? isDomesticCountry(r.country || '') : !isDomesticCountry(r.country || ''));
  // These tabs are shipment-linked transactions — only surface rows that
  // actually carry a shipment id (drop any placeholder/blank ones).
  const hasShipmentId = <T extends { shp?: string }>(r: T): boolean => !!r.shp && r.shp.trim() !== '' && r.shp.trim() !== '—';
  const wsEqData    = txnInScope(bp.ws_eq).filter(hasShipmentId);
  const wsNeqData   = txnInScope(bp.ws_neq).filter(hasShipmentId);
  const wosEqData   = txnInScope(bp.wos_eq);
  const wosNeqData  = txnInScope(bp.wos_neq);

  /* Case-insensitive search across every text column the transaction tables
   * render: Shipment ID, Opportunity ID, Customer, Consignee, PI Number and
   * Reg. Status. Drives the visible table + its pager; the analytics cards
   * above stay on the unfiltered scope so the totals don't jump while typing. */
  const txnQ = txnSearch.trim().toLowerCase();
  const txnMatch = (r: { shp?: string; opp?: string; customer?: string; consignee?: string; pi?: string; reg?: Reg; country?: string }): boolean =>
    !txnQ || [r.shp, r.opp, r.customer, r.consignee, r.pi, r.reg, r.country]
      .some((v) => (v || '').toLowerCase().includes(txnQ));
  const wsEqRows   = wsEqData.filter(txnMatch);
  const wsNeqRows  = wsNeqData.filter(txnMatch);
  const wosEqRows  = wosEqData.filter(txnMatch);
  const wosNeqRows = wosNeqData.filter(txnMatch);

  // ── derived buyer analytics (syncBpaCards) ──
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  const buyerTotal = scopedBuyers.length;
  // Compliant buyer = KYC + DD + Trade License all fully completed.
  const buyerCompliant = scopedBuyers.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t).length;
  const buyerKyc = scopedBuyers.filter((r) => r.kyc.d < r.kyc.t).length;
  const buyerDd = scopedBuyers.filter((r) => r.dd.d < r.dd.t).length;
  const buyerTl = scopedBuyers.filter((r) => r.tl.d < r.tl.t).length;
  const buyerTd = scopedBuyers.filter((r) => r.td.d < r.td.t).length;
  const buyerAgr = scopedBuyers.filter((r) => r.agr.d < r.agr.t).length;

  // ── derived consignee analytics ──
  const consTotal = scopedCons.length;
  const consCompliant = scopedCons.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t).length;
  const consKyc = scopedCons.filter((r) => r.kyc.d < r.kyc.t).length;
  const consDd = scopedCons.filter((r) => r.dd.d < r.dd.t).length;
  const consTl = scopedCons.filter((r) => r.tl.d < r.tl.t).length;
  const consTd = scopedCons.filter((r) => r.td.d < r.td.t).length;
  const consAgr = scopedCons.filter((r) => r.agr.d < r.agr.t).length;

  // ── derived transaction (opportunity) analytics ──
  // Count only the transactions of the ACTIVE shipment tab so the metrics match
  // the table on screen: "With Shipment ID" → ws (eq + neq); "Without Shipment
  // ID" → wos (eq + neq). Summing all four made the totals include rows the
  // visible table never shows.
  const allTxn: (WsEqRow | WsNeqRow | WosEqRow | WosNeqRow)[] = shipTab === 'without'
    ? [...wosEqData, ...wosNeqData]
    : [...wsEqData, ...wsNeqData];
  const txnTotal = allTxn.length;
  const txnCompliant = allTxn.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t).length;
  const txnKyc = allTxn.filter((r) => r.kyc.d < r.kyc.t).length;
  const txnDd = allTxn.filter((r) => r.dd.d < r.dd.t).length;
  const txnTl = allTxn.filter((r) => r.tl.d < r.tl.t).length;
  const txnTd = allTxn.filter((r) => r.td.d < r.td.t).length;
  const txnAgr = allTxn.filter((r) => r.agr.d < r.agr.t).length;

  /* Case-insensitive search across Company Name, Customer/Consignee ID,
   * Segment and Country. Buyer segments are an array; consignee segment is a
   * single string. Falls back to the full list when the box is empty. */
  const buyerQ = buyerSearch.trim().toLowerCase();
  const buyerFiltered = scopedBuyers.filter((r) =>
    matchCard(r) && (!buyerQ ||
      r.name.toLowerCase().includes(buyerQ) ||
      r.id.toLowerCase().includes(buyerQ) ||
      r.country.toLowerCase().includes(buyerQ) ||
      r.seg.some((s) => s.toLowerCase().includes(buyerQ))));
  const consQ = consSearch.trim().toLowerCase();
  const consFiltered = scopedCons.filter((r) =>
    matchCard(r) && (!consQ ||
      r.name.toLowerCase().includes(consQ) ||
      r.id.toLowerCase().includes(consQ) ||
      r.country.toLowerCase().includes(consQ) ||
      r.seg.toLowerCase().includes(consQ)));
  const buyerListTotal = buyerFiltered.length;
  const consListTotal = consFiltered.length;

  // Clamp the active page so a smaller dynamic page size can't leave us stranded
  // past the last page (e.g. after a resize shrinks the row count).
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

      {/* ── Header Strip ── */}
      <div className="seg-page-card" style={{ background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%)' }}>
        {/* Padding matches the Supplier Profile header strip (0 18px) — this
            used to add 10px of vertical padding plus a wrapping flex row, which
            pushed the strip taller and widened the apparent gap to the card
            below. minHeight is 58px: the tallest thing in the row is the
            Party/Transaction segmented control at 49px (.bpa-tab 38 + .bpa-seg
            padding 4x2 + border 1.5x2), so this adds ~4px of breathing room
            above and below it (the row is centre-aligned, so the slack splits
            evenly) without touching the pills themselves. */}
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

      {/* ── What We Are Doing Here ── */}
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

      {/* ── TRANSACTION ANALYTICS (txn tab only) ── */}
      {clmTab === 'txn' && (
        <div>
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
                {/* International / Domestic transaction scope */}
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
                <div onClick={() => setTxnAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s', flexShrink: 0 }}>
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

          {/* ── SHIPMENT TABS ── */}
          {/* marginTop:8px — Transaction-wise CLM tab; same nested-wrapper gap
              as the party-wise list cards. */}
          <div ref={txnCardRef} className="seg-page-card" style={{ marginTop: '8px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: txnCardFill }}>
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
                <input type="text" placeholder="Search by Shipment ID, Opportunity ID, Customer, Consignee, PI or Status..." value={txnSearch} onChange={(e) => { setTxnSearch(e.target.value); setWsEqPage(1); setWsNeqPage(1); setWosEqPage(1); setWosNeqPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, background: 'transparent', minWidth: 0 }} />
              </div>
            </div>

            {/* With Shipment ID panel */}
            {shipTab === 'with' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)', flexShrink: 0 }}>
                  <SubTab active={wsSub === 'eq'} kind="eq" onClick={() => setWsSub('eq')} />
                  <SubTab active={wsSub === 'neq'} kind="neq" onClick={() => setWsSub('neq')} />
                </div>

                {wsSub === 'eq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead>
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
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)', marginTop: 'auto', flexShrink: 0 }}>
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
                      <thead>
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
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)', marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wsNeqPageSafe} total={wsNeqRows.length} pageSize={txnPerPage} onPage={setWsNeqPage} onPageSize={(n) => { setTxnManualSize(n); setWsNeqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Without Shipment ID panel */}
            {shipTab === 'without' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)', flexShrink: 0 }}>
                  <SubTab active={wosSub === 'eq'} kind="eq" onClick={() => setWosSub('eq')} />
                  <SubTab active={wosSub === 'neq'} kind="neq" onClick={() => setWosSub('neq')} />
                </div>

                {wosSub === 'eq' && (
                  <div ref={txnTableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                      <thead>
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
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)', marginTop: 'auto', flexShrink: 0 }}>
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
                      <thead>
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
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)', marginTop: 'auto', flexShrink: 0 }}>
                      <WorklistPager page={wosNeqPageSafe} total={wosNeqRows.length} pageSize={txnPerPage} onPage={setWosNeqPage} onPageSize={(n) => { setTxnManualSize(n); setWosNeqPage(1); }} className="bp-wl" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PARTY WISE CLM PANEL ── */}
      {clmTab === 'party' && (
        <div>
          {/* ANALYTICAL CARDS */}
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
                  <div onClick={() => setPartyAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s' }}>
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

          {/* ── BUYER LIST TABLE ── */}
          {bpaTab === 'buyer' && (
            <div>
              {/* marginTop:8px — this card is nested inside plain wrappers, so
                  .seg-page's 8px flex gap doesn't reach it and it butted right
                  up against the Analytics card above. Restores the same spacing
                  the top-level cards have. Same pattern the Supplier Profile
                  page uses for its nested cards. */}
              <div ref={buyerCardRef} className="seg-page-card" style={{ marginTop: '8px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: buyerCardFill }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Customer List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{buyerListTotal} customers registered across all segments</div>
                    </div>
                    <span style={{ fontSize: '8px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.02em' }}>{buyerListTotal} records</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '38px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input type="text" placeholder="Search by name, segment, country, ID..." value={buyerSearch} onChange={(e) => { setBuyerSearch(e.target.value); setBuyerPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', width: '280px', background: 'transparent' }} />
                    </div>
                    {/* International / Domestic buyer scope */}
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
                    <thead>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
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
                            <td style={{ padding: '9px 11px', textAlign: 'center', verticalAlign: 'middle', minWidth: '140px' }}>
                              <div style={{ display: 'inline-flex', flexWrap: 'nowrap', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
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
                <WorklistPager total={buyerListTotal} page={buyerPageSafe} pageSize={bpPerPage} onPage={setBuyerPage} onPageSize={(n) => { setBpManualSize(n); setBuyerPage(1); }} className="bp-wl" />
              </div>
            </div>
          )}

          {/* ── CONSIGNEE LIST TABLE ── */}
          {bpaTab === 'consignee' && (
            <div>
              {/* marginTop:8px — see the Customer List card above; same nested
                  wrapper, same missing gap under the Analytics card. */}
              <div ref={consCardRef} className="seg-page-card" style={{ marginTop: '8px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: consCardFill }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Consignee List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{consListTotal} consignees registered across all customers</div>
                    </div>
                    <span style={{ fontSize: '8px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.02em' }}>{consListTotal} records</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '38px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input type="text" placeholder="Search by name, segment, country, ID..." value={consSearch} onChange={(e) => { setConsSearch(e.target.value); setConsPage(1); }} style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', width: '280px', background: 'transparent' }} />
                    </div>
                    {/* International / Domestic consignee scope */}
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
                    <thead>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'Customer', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bpLoading && <ShimmerTableRows rows={8} cols={14} keyPrefix="cons" />}
                      {!bpLoading && consSlice.map((r, i) => {
                        const bg = rowBg(i);
                        // A consignee belongs to exactly one customer, so the count is
                        // 1 when it actually resolves to a real customer, else 0 (an
                        // orphaned consignee whose customer no longer exists). Derived
                        // the same way the popup resolves the customer, so badge == popup.
                        // All customers this consignee is mapped to (M2M), filtered
                        // to those present in the current buyer list scope.
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
                            <td style={{ padding: '9px 11px', textAlign: 'center', verticalAlign: 'middle', minWidth: '140px' }}>
                              <div style={{ display: 'inline-flex', flexWrap: 'nowrap', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
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
                <WorklistPager total={consListTotal} page={consPageSafe} pageSize={consPerPage} onPage={setConsPage} onPageSize={(n) => { setConsManualSize(n); setConsPage(1); }} className="bp-wl" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evidence Vault popups — same modals used by the Customer / Consignee
          Sales-Matrix tables. */}
      <CustomerEvidenceVaultModal open={!!buyerVault} customer={buyerVault} initialTab={buyerVaultTab} onClose={() => setBuyerVault(null)} />
      <ConsigneeEvidenceVaultModal open={!!consVault} consignee={consVault} initialTab={consVaultTab} onClose={() => setConsVault(null)} />

      {/* Single-bucket documents popup — opened from a KYC / DD / TL / TD /
          Agreements progress cell instead of the full Evidence Vault. */}
      <ClmDocsPopup
        open={!!docsPopup}
        onClose={() => setDocsPopup(null)}
        category={docsPopup?.category ?? 'kyc'}
        ownerType={docsPopup?.ownerType ?? 'customer'}
        ownerId={docsPopup?.ownerId ?? null}
        company={docsPopup?.company ?? ''}
      />

      {/* Consignees-for-buyer popup. */}
      {consListBuyer && (
        <BuyerConsigneesModal
          buyer={consListBuyer}
          rows={bpConsData.filter((c) => c.cid === consListBuyer.id && !c.same_as_customer)}
          onClose={() => setConsListBuyer(null)}
        />
      )}

      {/* Customer-for-consignee popup — ALL customers this consignee is mapped
          to (many-to-many), filtered to the current buyer list scope. */}
      {custForCons && (
        <ConsigneeCustomerModal
          consignee={custForCons}
          customers={((custForCons.cids && custForCons.cids.length ? custForCons.cids : (custForCons.cid ? [custForCons.cid] : []))
            .map((id) => bpBuyerData.find((b) => b.id === id))
            .filter((b): b is BuyerRow => !!b))}
          onClose={() => setCustForCons(null)}
        />
      )}

      {/* Segment "+N" popover — lists all segments for the clicked count badge. */}
      {segOpen && createPortal(
        <>
          <div onClick={() => setSegOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 200000 }} />
          <div className="seg-pop" style={{ position: 'fixed', left: Math.min(segOpen.x, window.innerWidth - 240), top: segOpen.flipUp ? undefined : segOpen.y, bottom: segOpen.flipUp ? (window.innerHeight - segOpen.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#0891b2', padding: '4px 8px 7px' }}>Segments ({segOpen.names.length})</div>
            {segOpen.names.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 8, background: i % 2 ? 'rgba(6,182,212,.05)' : 'transparent' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#0c4a6e', wordBreak: 'break-word' }}>{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/* Self-contained segment cell (first chip + clickable "+N" popover) for use
 * inside standalone modals that can't reach the page component's renderSegCell. */
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
    <Tooltip label={segs[0]}><span style={{ display: 'inline-block', verticalAlign: 'middle', fontSize: '8.5px', fontWeight: 600, color: sc, background: sb, border: '1px solid rgba(6,182,212,.15)', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{segs[0].length > 30 ? `${segs[0].slice(0, 30)}…` : segs[0]}</span></Tooltip>
    {segs.length > 1 && (
      <Tooltip label="View all segments"><button type="button" onClick={toggle} style={{ fontSize: '8.5px', fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg, #06b6d4, #0891b2)', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>+{segs.length - 1}</button></Tooltip>
    )}
    {open && createPortal(
      <>
        <div onMouseDown={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 200000 }} />
        <div className="seg-pop" style={{ position: 'fixed', left: Math.min(open.x, window.innerWidth - 240), top: open.flipUp ? undefined : open.y, bottom: open.flipUp ? (window.innerHeight - open.y) : undefined, zIndex: 200001, width: 220, maxHeight: 280, overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 8, boxShadow: '0 18px 50px rgba(15,23,42,.30)', border: '1px solid rgba(6,182,212,.18)', fontFamily: 'var(--font-sans)' }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#0891b2', padding: '4px 8px 7px' }}>Segments ({segs.length})</div>
          {segs.map((name, i) => (
            <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: '#0c4a6e', padding: '5px 8px', borderRadius: 7, background: i % 2 === 0 ? 'rgba(6,182,212,.05)' : 'transparent' }}>{name}</div>
          ))}
        </div>
      </>,
      document.body,
    )}
  </>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Consignees-for-buyer popup — opened by clicking the CONSIGNEES count in the
 * buyer list. Shows the consignees mapped to that buyer (filtered from the
 * already-loaded consignee dataset) in the same column layout.
 * ────────────────────────────────────────────────────────────────────────── */
function BuyerConsigneesModal({ buyer, rows, onClose }: { buyer: BuyerRow; rows: ConsRow[]; onClose: () => void }) {
  useScrollLock(true);   // freeze background page scroll while the modal is open
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
        {/* Header */}
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

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr style={txnTableHeaderRow}>
                {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: '30px', textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>No consignees mapped to this customer yet.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)', borderBottom: '1px solid rgba(6,182,212,.07)' }}>
                  <td style={{ padding: '9px 12px', textAlign: 'center' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{i + 1}</span></td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0e7490', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{r.id}</span></td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.06)', border: '1px solid rgba(6,182,212,.14)', padding: '2px 7px', borderRadius: '5px' }}>{r.cid}</span></td>
                  <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'center', minWidth: '140px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center', alignItems: 'center' }}>
                      <SegCell names={r.seg.split(',')} sc={r.sc} sb={r.sb} />
                    </div>
                  </td>
                  <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                  <ProgCell obj={r.kyc} /><ProgCell obj={r.dd} /><ProgCell obj={r.tl} /><ProgCell obj={r.td} />
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                  <ProgCell obj={r.agr} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#0891b2' }}>Showing <strong>{rows.length}</strong> consignee{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Customer-for-consignee popup — opened by clicking the CUSTOMER ID badge in
 * the consignee list. A consignee belongs to exactly one customer, so this
 * shows that single customer's identity + compliance in the customer column
 * layout (the mirror of the consignees-for-buyer popup).
 * ────────────────────────────────────────────────────────────────────────── */
function ConsigneeCustomerModal({ consignee, customers, onClose }: { consignee: ConsRow; customers: BuyerRow[]; onClose: () => void }) {
  useScrollLock(true);   // freeze background page scroll while the modal is open
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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 22px', background: 'linear-gradient(110deg,#0c6680 0%,#0e7490 35%,#0891b2 75%,#06b6d4 100%)', color: '#fff', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.28)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em' }}>{customers.length > 1 ? 'Customers' : 'Customer'}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.86)', marginTop: 2 }}>{customers.length > 1 ? 'The buyers this consignee is mapped to, with their compliance readiness.' : 'The buyer this consignee is mapped to, with its compliance readiness.'}</div>
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

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr style={txnTableHeaderRow}>
                {['Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: '30px', textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>None of this consignee's mapped customers are in the current list scope.</td></tr>
              ) : customers.map((customer) => (
                <tr key={customer.id} style={{ background: '#fff', borderBottom: '1px solid rgba(6,182,212,.07)' }}>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap', display: 'inline-block' }}>{customer.id}</span></td>
                  <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{customer.name}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'center', minWidth: '140px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center', alignItems: 'center' }}>
                      <SegCell names={customer.seg} sc={customer.sc} sb={customer.sb} />
                    </div>
                  </td>
                  <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{customer.country}</td>
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={customer.cn} /></td>
                  <ProgCell obj={customer.kyc} /><ProgCell obj={customer.dd} /><ProgCell obj={customer.tl} /><ProgCell obj={customer.td} />
                  <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={customer.ship} /></td>
                  <ProgCell obj={customer.agr} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#0891b2' }}>Consignee <strong>{consignee.id}</strong> → <strong>{customers.length}</strong> mapped customer{customers.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Sub-tab button used inside both With / Without Shipment ID panels. */
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

/* Agreements cell for the "without shipment" tables — shows "No PI" italics when pi is empty. */
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
