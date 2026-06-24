import { useEffect, useState } from 'react';
import api from '../../../api';
import type { CtcContract } from '../operations/clmOpsData';

/* ─────────────────────────────────────────────────────────────────────────
 * Data-fetching layer for the CLM Analytics page.
 *
 * The real compliance data is already computed server-side by two existing
 * endpoints (no new backend needed) — this hook just fetches both in parallel,
 * tenant-scoped automatically (the Axios client injects the Bearer token and
 * the active branch_id on every GET):
 *
 *   GET /clm/buyer-profile     → { buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }
 *   GET /clm/supplier-profile  → { ws_mat, ws_logi, wos_svc, wos_mat, wos_logi,
 *                                  txn_ws_mat, txn_ws_logi, txn_wos_svc, txn_wos_mat, txn_wos_logi }
 *
 * `ws_*` rows carry a `shp` code ("SHP-<leadId>") only when the opportunity
 * completed the Victory stage and a shipment order exists; otherwise the row
 * lands in `wos_*`. That's the real With- vs Without-Shipment split.
 * ───────────────────────────────────────────────────────────────────────── */

export type ApiProg = { d: number; t: number };

/** A transaction (opportunity) row from the buyer-profile endpoint. */
export type ApiTxnRow = {
  sr: number;
  opp: string;
  customer: string;
  pi?: string;
  reg?: string;
  shp?: string;          // present only when a shipment exists
  consignee?: string;    // present only when consignee ≠ customer
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
};

/** A party (buyer / consignee) roster row. */
export type ApiParty = {
  sr: number;
  id: string;            // customer_code / consignee_code (e.g. "C-001")
  cid?: string;          // parent customer_code (consignees only)
  db_id: number;
  name: string;
  seg: unknown;
  country: string;
  cn?: number;           // consignees count (buyers only)
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
  ship: number;
};

/** A supplier transaction row from the supplier-profile endpoint.
 *  Note: supplier txns are procurement-level — they carry no opportunity id. */
export type ApiSupTxn = {
  sr: number;
  shpId?: string;        // "SHP-xxx" — present for with-shipment txns
  procId?: string;       // "PROC-xxx"
  supplier: string;      // supplier company name
  supId: string;         // vendor_code ("V-xx")
  reg?: string; po?: string; inv?: string;
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
};

export type BuyerProfile = {
  buyers: ApiParty[];
  consignees: ApiParty[];
  ws_eq: ApiTxnRow[];
  ws_neq: ApiTxnRow[];
  wos_eq: ApiTxnRow[];
  wos_neq: ApiTxnRow[];
};

export type SupplierProfile = {
  ws_mat: ApiParty[]; ws_logi: ApiParty[];
  wos_svc: ApiParty[]; wos_mat: ApiParty[]; wos_logi: ApiParty[];
  txn_ws_mat: ApiSupTxn[]; txn_ws_logi: ApiSupTxn[];
  txn_wos_svc: ApiSupTxn[]; txn_wos_mat: ApiSupTxn[]; txn_wos_logi: ApiSupTxn[];
};

// Case-to-Case contracts come from /clm/ctc-contracts — same shape the
// Case-to-Case Management page already uses (CtcContract from clmOpsData).

export type ClmAnalyticsState = {
  loading: boolean;
  error: string | null;
  buyer: BuyerProfile | null;
  supplier: SupplierProfile | null;
  ctc: CtcContract[] | null;
};

export function useClmAnalyticsData(): ClmAnalyticsState {
  const [state, setState] = useState<ClmAnalyticsState>({
    loading: true, error: null, buyer: null, supplier: null, ctc: null,
  });

  useEffect(() => {
    let alive = true;   // guard against setting state after unmount
    Promise.all([
      api.get('/clm/buyer-profile'),
      api.get('/clm/supplier-profile'),
      api.get('/clm/ctc-contracts'),
    ])
      .then(([b, s, c]) => {
        if (!alive) return;
        setState({
          loading: false,
          error: null,
          buyer: (b.data?.data ?? null) as BuyerProfile | null,
          supplier: (s.data?.data ?? null) as SupplierProfile | null,
          ctc: (c.data?.data ?? null) as CtcContract[] | null,
        });
      })
      .catch(() => {
        if (!alive) return;
        setState({ loading: false, error: 'Could not load live analytics data.', buyer: null, supplier: null, ctc: null });
      });
    return () => { alive = false; };
  }, []);

  return state;
}
