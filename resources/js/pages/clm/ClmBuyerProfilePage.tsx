import { useState, CSSProperties } from 'react';

/*
 * CLM → Buyer Profile page.
 * Faithful port of the prototype rBp() markup (CLM_Main_File lines 6674-7226) plus
 * its buyer/consignee/transaction data + render helpers (lines 8227-8758).
 * This is a dashboard/view page with NO backend API — all data is inlined mock data.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */
type Prog = { d: number; t: number };

type BuyerRow = {
  sr: number; id: string; name: string; seg: string[]; sc: string; sb: string;
  country: string; cn: number; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
};

type ConsRow = {
  sr: number; id: string; cid: string; name: string; seg: string; sc: string; sb: string;
  country: string; kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog; ship: number;
};

type Reg = 'High' | 'Low' | 'Both';

type WsEqRow = {
  sr: number; shp: string; opp: string; customer: string; pi: string; reg: Reg;
  kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog;
};
type WsNeqRow = WsEqRow & { consignee: string };
type WosEqRow = {
  sr: number; opp: string; customer: string; pi: string; reg: Reg;
  kyc: Prog; dd: Prog; tl: Prog; td: Prog; agr: Prog;
};
type WosNeqRow = WosEqRow & { consignee: string };

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
 * Scoped CSS (extracted from the prototype)
 * ────────────────────────────────────────────────────────────────────────── */
const BP_CSS = `
.seg-page { background: #F4F6FB; min-height: calc(100vh - 56px); padding: 12px 14px; display:flex; flex-direction:column; gap:8px; }
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
.bpa-tab{position:relative;height:40px;padding:0 18px;border-radius:9px;border:none;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;transition:all .2s cubic-bezier(.22,1,.36,1);letter-spacing:.01em;overflow:hidden;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;}
.bpa-tab::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.2),transparent);border-radius:inherit;pointer-events:none;}
.bpa-tab svg{flex-shrink:0;}
.bpa-tab-active{background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);color:#fff;box-shadow:0 3px 12px rgba(6,182,212,.4),0 1px 4px rgba(8,145,178,.3);}
.bpa-tab-inactive{background:transparent;color:#0e7490;box-shadow:none;}
.bpa-tab-inactive:hover{background:rgba(6,182,212,.1);color:#0891b2;}
.bpa-cards-wrap{overflow:hidden;transition:max-height .32s cubic-bezier(.22,1,.36,1),opacity .22s,padding .22s;}
.bp-buyer-row:hover{background:rgba(6,182,212,.05)!important;box-shadow:inset 3px 0 0 #0891b2;}
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

/* Progress cell used in the buyer / consignee list tables. */
function ProgCell({ obj, big = true }: { obj: Prog; big?: boolean }) {
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
    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: big ? '5px' : '4px', minWidth: minW }}>
        <span style={{ fontSize: '11px', fontWeight: 900, color: numC, background: numBg, border: `1px solid ${numBd}`, padding: pad, borderRadius: '20px', letterSpacing: '-.2px', lineHeight: 1.4 }}>
          {d}<span style={{ fontSize: '9px', fontWeight: 500, color: '#94a3b8' }}>/{t}</span>
        </span>
        <div style={{ width: barW, height: barH, borderRadius: '5px', background: 'rgba(6,182,212,.1)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barGrad, borderRadius: '5px', transition: 'width .5s cubic-bezier(.22,1,.36,1)' }} />
        </div>
      </div>
    </td>
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

function EvidenceVaultBtn({ icon }: { icon: 'shield' | 'box' }) {
  return (
    <td style={{ padding: '8px 10px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
      <button
        title={icon === 'shield' ? 'Shipment Evidence Vault' : 'Opportunity Evidence Vault'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.3)', background: 'linear-gradient(135deg,#f0fdff,#e8fbfd)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '10px', fontWeight: 700, color: '#0891b2', transition: 'all .15s', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg,#06b6d4,#0891b2)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#0891b2'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg,#f0fdff,#e8fbfd)'; e.currentTarget.style.color = '#0891b2'; e.currentTarget.style.borderColor = 'rgba(6,182,212,.3)'; }}
      >
        {icon === 'shield'
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" strokeWidth="2.5" /></svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="1" /></svg>}
        Evidence Vault
      </button>
    </td>
  );
}

/* Reusable list-table pager (buyer / consignee). */
function ListPager({ page, total, perPage, noun, onPage }: { page: number; total: number; perPage: number; noun: string; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const fromR = start + 1;
  const toR = Math.min(start + perPage, total);
  const prevDis: CSSProperties = page === 1 ? { opacity: .4, cursor: 'default' } : { cursor: 'pointer' };
  const nextDis: CSSProperties = page === totalPages ? { opacity: .4, cursor: 'default' } : { cursor: 'pointer' };
  const navBtn: CSSProperties = { width: '28px', height: '28px', borderRadius: '7px', border: '1.5px solid rgba(6,182,212,.22)', background: '#fff', color: '#0891b2', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'linear-gradient(110deg,#f0fdff,#e8fafb)', borderTop: '1.5px solid #A5F3FC' }}>
      <span style={{ fontSize: '10px', fontWeight: 600, color: '#0891b2' }}>
        Showing <strong>{fromR}–{toR}</strong> of <strong>{total}</strong> {noun}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <button style={{ ...navBtn, ...prevDis }} onClick={() => page > 1 && onPage(page - 1)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
          const isActive = p === page;
          return (
            <button key={p} onClick={() => onPage(p)} style={{
              width: '28px', height: '28px', borderRadius: '7px',
              border: isActive ? '1.5px solid #0891b2' : '1.5px solid rgba(6,182,212,.2)',
              background: isActive ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#fff',
              color: isActive ? '#fff' : '#0891b2', fontWeight: isActive ? 800 : 600,
              fontSize: '10.5px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}>{p}</button>
          );
        })}
        <button style={{ ...navBtn, ...nextDis }} onClick={() => page < totalPages && onPage(page + 1)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </div>
  );
}

/* Compact pager used by the transaction tables (ws/wos). */
function TxnPager({ page, total, perPage, noun, onPage }: { page: number; total: number; perPage: number; noun: string; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
      <span style={{ fontSize: '11.5px', color: '#0e7490', fontWeight: 500 }}>
        Showing <b style={{ color: '#0c4a6e' }}>{start + 1}–{Math.min(start + perPage, total)}</b> of <b style={{ color: '#0c4a6e' }}>{total}</b> {noun}{total !== 1 ? 's' : ''}
      </span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
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
  const [brefCollapsed, setBrefCollapsed] = useState(false);
  const [clmTab, setClmTab] = useState<'party' | 'txn'>('party');
  const [bpaTab, setBpaTab] = useState<'buyer' | 'consignee'>('buyer');
  const [shipTab, setShipTab] = useState<'with' | 'without'>('with');
  const [wsSub, setWsSub] = useState<'eq' | 'neq'>('eq');
  const [wosSub, setWosSub] = useState<'eq' | 'neq'>('eq');

  // collapsible analytics strips
  const [partyAnalyticsOpen, setPartyAnalyticsOpen] = useState(true);
  const [txnAnalyticsOpen, setTxnAnalyticsOpen] = useState(true);

  // pagination state
  const [buyerPage, setBuyerPage] = useState(1);
  const [consPage, setConsPage] = useState(1);
  const [wsEqPage, setWsEqPage] = useState(1);
  const [wsNeqPage, setWsNeqPage] = useState(1);
  const [wosEqPage, setWosEqPage] = useState(1);
  const [wosNeqPage, setWosNeqPage] = useState(1);

  // ── derived buyer analytics (syncBpaCards) ──
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  const buyerTotal = bpBuyerData.length;
  const buyerCompliant = bpBuyerData.filter((r) => r.kyc.d === r.kyc.t && r.dd.d === r.dd.t && r.tl.d === r.tl.t && r.td.d === r.td.t).length;
  const buyerKyc = bpBuyerData.filter((r) => r.kyc.d < r.kyc.t).length;
  const buyerDd = bpBuyerData.filter((r) => r.dd.d < r.dd.t).length;
  const buyerTl = bpBuyerData.filter((r) => r.tl.d < r.tl.t).length;
  const buyerTd = bpBuyerData.filter((r) => r.td.d < r.td.t).length;
  const buyerAgr = bpBuyerData.filter((r) => r.agr.d < r.agr.t).length;

  const buyerSlice = bpBuyerData.slice((buyerPage - 1) * BP_PER_PAGE, (buyerPage - 1) * BP_PER_PAGE + BP_PER_PAGE);
  const consSlice = bpConsData.slice((consPage - 1) * BP_PER_PAGE, (consPage - 1) * BP_PER_PAGE + BP_PER_PAGE);
  const wsEqSlice = wsEqData.slice((wsEqPage - 1) * WS_PER_PAGE, (wsEqPage - 1) * WS_PER_PAGE + WS_PER_PAGE);
  const wsNeqSlice = wsNeqData.slice((wsNeqPage - 1) * WS_PER_PAGE, (wsNeqPage - 1) * WS_PER_PAGE + WS_PER_PAGE);
  const wosEqSlice = wosEqData.slice((wosEqPage - 1) * WOS_PER_PAGE, (wosEqPage - 1) * WOS_PER_PAGE + WOS_PER_PAGE);
  const wosNeqSlice = wosNeqData.slice((wosNeqPage - 1) * WOS_PER_PAGE, (wosNeqPage - 1) * WOS_PER_PAGE + WOS_PER_PAGE);

  const rowBg = (i: number) => (i % 2 === 0 ? '#fff' : 'rgba(240,253,255,.45)');

  return (
    <div className="seg-page">
      <style>{BP_CSS}</style>

      {/* ── Header Strip ── */}
      <div className="seg-page-card" style={{ background: 'linear-gradient(110deg,#e0f9fd 0%,#cef8ff 18%,#d0f4f9 45%,#baeef7 75%,#a0e8f2 100%)' }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: '64px' }}>
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
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.15 }}>Buyer Profile</div>
              <div style={{ fontSize: '11px', fontWeight: 500, color: '#0e7490', opacity: .9, marginTop: '3px' }}>Track buyer onboarding, compliance verification, agreements, and overall CLM readiness.</div>
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
                <div className="bref-box__header-label">Buyer Profile</div>
                <div className="bref-box__header-sep" />
                <div className="bref-box__header-title">What We Are Doing Here</div>
              </div>
              <div className="bref-box__header-sub">Manage buyer lifecycle, KYC verification, trade documents, agreements, compliance approvals, and trade readiness across all customers.</div>
            </div>
            <div className="bref-box__header-right">
              <div className="bref-box__toggle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
          </div>
          <div className="bref-box__body">
            {[
              { num: 'Step 01', title: 'Buyer Onboarding', desc: 'Create and manage buyer profiles.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
              { num: 'Step 02', title: 'KYC & Due Diligence', desc: 'Verify legal and compliance documents.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> },
              { num: 'Step 03', title: 'Trade Documentation', desc: 'Track trade licenses and operational documents.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
              { num: 'Step 04', title: 'Agreement & Compliance', desc: 'Monitor signed agreements and compliance approvals.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
              { num: 'Step 05', title: 'Trade Readiness', desc: 'Approve buyers for shipment and sales operations.', ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> },
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 8px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '48px' }}>
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
              <div onClick={() => setTxnAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s', flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: txnAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
            <div style={{ maxHeight: txnAnalyticsOpen ? '200px' : '0px', opacity: txnAnalyticsOpen ? 1 : 0, padding: txnAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)', overflow: 'hidden', transition: 'max-height .32s cubic-bezier(.22,1,.36,1),opacity .22s,padding .22s' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '6px' }}>
                {[
                  { num: '42', label: 'Total Transactions', tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg> },
                  { num: '18', label: 'Fully Compliant', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                  { num: '09', label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                  { num: '07', label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                  { num: '11', label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                  { num: '06', label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                  { num: '08', label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
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
          <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden', marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 10px 20px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '52px' }}>
              <div className="bpa-seg">
                <button className={`bpa-tab ${shipTab === 'with' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setShipTab('with')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                  With Shipment ID
                </button>
                <button className={`bpa-tab ${shipTab === 'without' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setShipTab('without')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                  Without Shipment ID
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)', transition: 'border-color .15s,box-shadow .15s', flex: 1, maxWidth: '680px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round" style={{ flexShrink: 0, opacity: .7 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" placeholder="Search by Shipment ID, Buyer, Segment or Status..." style={{ border: 'none', outline: 'none', fontSize: '11.5px', fontFamily: 'inherit', color: '#0c4a6e', flex: 1, background: 'transparent', minWidth: 0 }} />
                <span style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '5px', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>⌘ K</span>
              </div>
            </div>

            {/* With Shipment ID panel */}
            {shipTab === 'with' && (
              <div style={{ display: 'block', background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)' }}>
                  <SubTab active={wsSub === 'eq'} kind="eq" onClick={() => setWsSub('eq')} />
                  <SubTab active={wsSub === 'neq'} kind="neq" onClick={() => setWsSub('neq')} />
                </div>

                {wsSub === 'eq' && (
                  <div style={{ overflowX: 'auto' }}>
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
                              <EvidenceVaultBtn icon="shield" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)' }}>
                      <TxnPager page={wsEqPage} total={wsEqData.length} perPage={WS_PER_PAGE} noun="shipment" onPage={setWsEqPage} />
                    </div>
                  </div>
                )}

                {wsSub === 'neq' && (
                  <div style={{ overflowX: 'auto' }}>
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
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} /><WsProgCell obj={r.agr} />
                              <EvidenceVaultBtn icon="shield" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)' }}>
                      <TxnPager page={wsNeqPage} total={wsNeqData.length} perPage={WS_PER_PAGE} noun="shipment" onPage={setWsNeqPage} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Without Shipment ID panel */}
            {shipTab === 'without' && (
              <div style={{ display: 'block', background: 'linear-gradient(180deg,#f0fdff,#f8feff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 0 16px', gap: 0, borderBottom: '1.5px solid rgba(6,182,212,.15)', background: 'linear-gradient(110deg,#f0fdff,#e8fbfd)' }}>
                  <SubTab active={wosSub === 'eq'} kind="eq" onClick={() => setWosSub('eq')} />
                  <SubTab active={wosSub === 'neq'} kind="neq" onClick={() => setWosSub('neq')} />
                </div>

                {wosSub === 'eq' && (
                  <div style={{ overflowX: 'auto' }}>
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
                              <EvidenceVaultBtn icon="box" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)' }}>
                      <TxnPager page={wosEqPage} total={wosEqData.length} perPage={WOS_PER_PAGE} noun="transaction" onPage={setWosEqPage} />
                    </div>
                  </div>
                )}

                {wosSub === 'neq' && (
                  <div style={{ overflowX: 'auto' }}>
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
                              <WsProgCell obj={r.kyc} /><WsProgCell obj={r.dd} /><WsProgCell obj={r.tl} /><WsProgCell obj={r.td} />
                              <WosAgrCell row={r} />
                              <EvidenceVaultBtn icon="box" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ padding: '10px 16px', background: '#f8feff', borderTop: '1px solid rgba(6,182,212,.08)' }}>
                      <TxnPager page={wosNeqPage} total={wosNeqData.length} perPage={WOS_PER_PAGE} noun="transaction" onPage={setWosNeqPage} />
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 8px 16px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 30%,#d8f8fc 60%,#caf5fa 80%,#baf2f9 100%)', borderBottom: '1px solid #A5F3FC', minHeight: '48px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.32)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="0" y1="20" x2="24" y2="20" /></svg>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 800, color: '#0891b2' }}>Buyer & Consignee</span>
                      <span style={{ width: '1px', height: '12px', background: '#A5E8F5', display: 'inline-block' }} />
                      <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Analytics Overview</span>
                      <span style={{ fontSize: '7.5px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.25)', padding: '1px 6px', borderRadius: '20px' }}>7 metrics</span>
                    </div>
                    <div style={{ fontSize: '9px', fontWeight: 500, color: '#0e7490', marginTop: '2px' }}>Live snapshot of compliance status, pending actions and document health.</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="bpa-seg">
                    <button className={`bpa-tab ${bpaTab === 'buyer' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setBpaTab('buyer')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Buyer</button>
                    <button className={`bpa-tab ${bpaTab === 'consignee' ? 'bpa-tab-active' : 'bpa-tab-inactive'}`} onClick={() => setBpaTab('consignee')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>Consignee</button>
                  </div>
                  <div onClick={() => setPartyAnalyticsOpen((o) => !o)} style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'rgba(255,255,255,.75)', border: '1.5px solid rgba(8,145,178,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .15s' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" style={{ transition: 'transform .24s cubic-bezier(.22,1,.36,1)', transform: partyAnalyticsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>
              </div>
              <div className="bpa-cards-wrap" style={{ maxHeight: partyAnalyticsOpen ? '200px' : '0px', opacity: partyAnalyticsOpen ? 1 : 0, padding: partyAnalyticsOpen ? '6px 8px 8px' : '0 8px', background: 'linear-gradient(180deg,#f0fdff,#f4feff)' }}>
                {bpaTab === 'buyer' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '6px' }}>
                    {[
                      { num: pad(buyerTotal), label: 'Total Buyers', tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                      { num: pad(buyerCompliant), label: 'Compliant Buyers', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                      { num: pad(buyerKyc), label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                      { num: pad(buyerDd), label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                      { num: pad(buyerTl), label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                      { num: pad(buyerTd), label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                      { num: pad(buyerAgr), label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
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
                )}
                {bpaTab === 'consignee' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '6px' }}>
                    {[
                      { num: '34', label: 'Total Consignees', tag: 'TOTAL', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                      { num: '17', label: 'Compliant Consignees', tag: 'OK', tagC: '#0891b2', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg> },
                      { num: '04', label: 'KYC Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
                      { num: '03', label: 'Due Diligence Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> },
                      { num: '06', label: 'Trade Licenses Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></svg> },
                      { num: '05', label: 'Trade Documents Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg> },
                      { num: '07', label: 'Agreements Pending', tag: 'PENDING', tagC: '#0e7490', ico: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 12 18 15 15" /></svg> },
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
                )}
              </div>
            </div>
          </div>

          {/* ── BUYER LIST TABLE ── */}
          {bpaTab === 'buyer' && (
            <div style={{ marginTop: '10px' }}>
              <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Buyer List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{buyerTotal} customers registered across all segments</div>
                    </div>
                    <span style={{ fontSize: '8px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.02em' }}>{buyerTotal} records</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '36px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input type="text" placeholder="Search buyers..." style={{ border: 'none', outline: 'none', fontSize: '11px', fontFamily: 'inherit', color: '#0c4a6e', width: '280px', background: 'transparent' }} />
                    </div>
                    <button style={{ position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', gap: '7px', height: '36px', padding: '0 18px', border: 'none', borderRadius: '10px', fontFamily: 'inherit', fontSize: '12px', fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 4px 14px rgba(8,145,178,.4),inset 0 1px 0 rgba(255,255,255,.18)', transition: 'all .18s' }}>
                      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '10px 10px 0 0', pointerEvents: 'none' }} />
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      <span style={{ position: 'relative', zIndex: 1 }}>Add Customer</span>
                    </button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                    <thead>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Customer ID', 'Company Name', 'Segment', 'Country', 'Consignees', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {buyerSlice.map((r, i) => {
                        const bg = rowBg(i);
                        return (
                          <tr key={r.id} className="bp-buyer-row" style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(224,249,253,.7)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}>
                            <td style={{ padding: '9px 12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px' }}>{r.id}</span></td>
                            <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'center', verticalAlign: 'middle', minWidth: '140px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                                {r.seg.map((s) => <span key={s} style={{ fontSize: '8.5px', fontWeight: 600, color: r.sc, background: r.sb, border: '1px solid rgba(6,182,212,.15)', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{s.trim()}</span>)}
                              </div>
                            </td>
                            <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform .15s,box-shadow .15s' }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.boxShadow = '0 3px 10px rgba(6,182,212,.45)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                                <span style={{ fontSize: '9px', fontWeight: 800, color: '#fff' }}>{r.cn}</span>
                              </div>
                            </td>
                            <ProgCell obj={r.kyc} /><ProgCell obj={r.dd} /><ProgCell obj={r.tl} /><ProgCell obj={r.td} />
                            <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} />
                            <td style={{ padding: '9px 12px' }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                <button title="Evidence Vault" style={vaultBtnStyle}><VaultIcon /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ListPager page={buyerPage} total={buyerTotal} perPage={BP_PER_PAGE} noun="customers" onPage={setBuyerPage} />
              </div>
            </div>
          )}

          {/* ── CONSIGNEE LIST TABLE ── */}
          {bpaTab === 'consignee' && (
            <div style={{ marginTop: '10px' }}>
              <div className="seg-page-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'linear-gradient(110deg,#f0fdff 0%,#e8fbfd 40%,#caf5fa 100%)', borderBottom: '1.5px solid #A5F3FC', minHeight: '60px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 0 3px rgba(6,182,212,.18),0 3px 10px rgba(8,145,178,.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0c4a6e', letterSpacing: '-.2px' }}>Consignee List</div>
                      <div style={{ fontSize: '9.5px', color: '#0891b2', fontWeight: 500, marginTop: '1px' }}>{bpConsData.length} consignees registered across all buyers</div>
                    </div>
                    <span style={{ fontSize: '8px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.22)', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.02em' }}>{bpConsData.length} records</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '36px', padding: '0 12px', borderRadius: '9px', background: '#fff', border: '1.5px solid #A5F3FC', boxShadow: '0 1px 4px rgba(6,182,212,.08)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.3" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input type="text" placeholder="Search consignees..." style={{ border: 'none', outline: 'none', fontSize: '11px', fontFamily: 'inherit', color: '#0c4a6e', width: '280px', background: 'transparent' }} />
                    </div>
                    <button style={{ position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', gap: '7px', height: '36px', padding: '0 18px', border: 'none', borderRadius: '10px', fontFamily: 'inherit', fontSize: '12px', fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg,#06b6d4,#0891b2,#0e7490)', boxShadow: '0 4px 14px rgba(8,145,178,.4),inset 0 1px 0 rgba(255,255,255,.18)', transition: 'all .18s' }}>
                      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '10px 10px 0 0', pointerEvents: 'none' }} />
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      <span style={{ position: 'relative', zIndex: 1 }}>Add Consignee</span>
                    </button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                    <thead>
                      <tr style={txnTableHeaderRow}>
                        {['SR No', 'Consignee ID', 'Customer ID', 'Company Name', 'Segment', 'Country', 'KYC', 'Due Diligence', 'Trade Licenses', 'Trade Docs', 'Total Shipments', 'Agreements', 'Action'].map((h, i) => (
                          <th key={i} style={{ padding: '9px 11px', textAlign: h === 'Company Name' ? 'left' : 'center' }}><span style={thTxt}>{h}</span></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {consSlice.map((r, i) => {
                        const bg = rowBg(i);
                        return (
                          <tr key={r.id} className="bp-buyer-row" style={{ background: bg, borderBottom: '1px solid rgba(6,182,212,.07)', cursor: 'pointer', transition: 'background .12s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(224,249,253,.7)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}>
                            <td style={{ padding: '9px 12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '11px', fontWeight: 700, color: '#0891b2' }}>{r.sr}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0e7490', background: 'rgba(6,182,212,.08)', border: '1px solid rgba(6,182,212,.18)', padding: '2px 7px', borderRadius: '5px' }}>{r.id}</span></td>
                            <td style={{ padding: '9px 11px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><span style={{ fontSize: '10px', fontWeight: 700, color: '#0891b2', background: 'rgba(6,182,212,.06)', border: '1px solid rgba(6,182,212,.14)', padding: '2px 7px', borderRadius: '5px' }}>{r.cid}</span></td>
                            <td style={{ padding: '9px 11px', fontSize: '12px', fontWeight: 700, color: '#0c4a6e', whiteSpace: 'nowrap' }}>{r.name}</td>
                            <td style={{ padding: '9px 11px', textAlign: 'center', verticalAlign: 'middle', minWidth: '140px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                                {r.seg.split(',').map((s) => <span key={s} style={{ fontSize: '8.5px', fontWeight: 600, color: r.sc, background: r.sb, border: '1px solid rgba(6,182,212,.15)', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{s.trim()}</span>)}
                              </div>
                            </td>
                            <td style={{ padding: '9px 11px', fontSize: '11px', color: '#475569', textAlign: 'center' }}>{r.country}</td>
                            <ProgCell obj={r.kyc} /><ProgCell obj={r.dd} /><ProgCell obj={r.tl} /><ProgCell obj={r.td} />
                            <td style={{ padding: '9px 11px', textAlign: 'center' }}><NumBadge n={r.ship} /></td>
                            <ProgCell obj={r.agr} />
                            <td style={{ padding: '9px 12px' }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                <button title="Evidence Vault" style={vaultBtnStyle}><VaultIcon /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ListPager page={consPage} total={bpConsData.length} perPage={BP_PER_PAGE} noun="consignees" onPage={setConsPage} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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
      {isEq ? 'Buyer = Consignee' : 'Buyer ≠ Consignee'}
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
