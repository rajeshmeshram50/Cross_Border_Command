<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\Procurement;
use App\Models\ProcurementProduct;
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use App\Models\VendorProductMapping;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class ClmSupplierProfileController extends Controller
{
    private const CATS = ['kyc', 'dd', 'tl', 'td'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid  = (int) ($user->client_id ?? 0);

        $empty = [
            'ws_mat' => [], 'ws_logi' => [], 'wos_svc' => [], 'wos_mat' => [], 'wos_logi' => [],
            'txn_ws_mat' => [], 'txn_ws_logi' => [], 'txn_wos_svc' => [], 'txn_wos_mat' => [], 'txn_wos_logi' => [],
        ];
        if (!$cid) return response()->json(['status' => true, 'data' => $empty]);

        /* ── Segment masters. ── */
        $segments = ClmSegment::where('client_id', $cid)->get(['id', 'name', 'code', 'regulatory_status']);
        $segNameById = [];
        $segRegById  = [];
        foreach ($segments as $s) {
            $segNameById[(int) $s->id] = (string) $s->name;
            $segRegById[(int) $s->id]  = (string) $s->regulatory_status;
        }

        /* ── Segment rules → required-doc union per segment. ── */
        $rulesBySeg = [];
        foreach (ClmSegmentRule::where('client_id', $cid)->get(['segment_id', 'doc_selections']) as $r) {
            $rulesBySeg[(int) $r->segment_id] = is_array($r->doc_selections) ? $r->doc_selections : [];
        }

        /* ── Uploaded docs grouped by owner. ── */
        $uploadsByOwner = [];
        foreach (SegmentDocUpload::where('client_id', $cid)->get(['uploadable_type', 'uploadable_id', 'category', 'doc_code']) as $u) {
            $uploadsByOwner[$u->uploadable_type . '#' . $u->uploadable_id][$u->category . '::' . $u->doc_code] = true;
        }

        /* ── Active agreements + applicability per segment id. ── */
        $agreements = ClmAgreementLibrary::where('client_id', $cid)
            ->where('agr_status', 'Active')
            ->get(['id', 'segment', 'regulatory']);
        $agrIdsBySeg = [];
        foreach ($segments as $s) {
            $list = [];
            foreach ($agreements as $a) {
                if ((string) $a->regulatory !== (string) $s->regulatory_status) continue;
                if ($this->csvHasToken((string) $a->segment, (string) $s->name)
                    || $this->csvHasToken((string) $a->segment, (string) $s->code)) {
                    $list[] = (int) $a->id;
                }
            }
            $agrIdsBySeg[(int) $s->id] = $list;
        }

        /* ── Completed agreement signature requests, keyed by party. ── */
        $sigByParty = [];
        foreach (ClmSignatureRequest::where('client_id', $cid)
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            ->get(['model_name', 'party_id', 'trade_doc_ids']) as $sr) {
            $ids = is_array($sr->trade_doc_ids) ? $sr->trade_doc_ids : [];
            foreach ($ids as $aid) {
                if ($sr->party_id) $sigByParty[$sr->model_name . '#' . $sr->party_id][(int) $aid] = true;
            }
        }

        /* ── State id → name (for the supplier's State column). ── */
        $stateNameById = DB::table('master_states')->pluck('name', 'id')->all();

        /* ── Vendor → product ids (VendorProductMapping). ── */
        $productsByVendor = [];
        foreach (VendorProductMapping::query()
            ->whereIn('vendor_id', Vendor::query()->forUser($user)->select('id'))
            ->get(['vendor_id', 'product_id']) as $m) {
            $productsByVendor[(int) $m->vendor_id][] = (int) $m->product_id;
        }

        /* ── Shipment classification chain.
         *   leads with a shipment → product ids procured on those leads →
         *   "shipped products"; plus a per-product shipment-count so we can
         *   roll a count up to each vendor. ── */
        $shipCountByLead = [];   // lead_id → number of shipment orders
        $shipIdsByLead   = [];   // lead_id → [shipment_order_id, …] (transaction-wise)
        foreach (ShipmentOrder::where('client_id', $cid)->get(['id', 'lead_id']) as $so) {
            $lid = (int) $so->lead_id;
            $shipCountByLead[$lid] = ($shipCountByLead[$lid] ?? 0) + 1;
            $shipIdsByLead[$lid][] = (int) $so->id;
        }
        $procLeadById = Procurement::where('client_id', $cid)->pluck('lead_id', 'id')->all();
        $leadsByProduct        = [];   // product_id → set(lead_id) that procured it
        $procurementsByProduct = [];   // product_id → set(procurement_id) (transaction-wise)
        foreach (ProcurementProduct::query()
            ->whereIn('procurement_id', array_map('intval', array_keys($procLeadById)))
            ->whereNotNull('product_id')
            ->get(['procurement_id', 'product_id']) as $pp) {
            $lead = (int) ($procLeadById[(int) $pp->procurement_id] ?? 0);
            if ($lead) $leadsByProduct[(int) $pp->product_id][$lead] = true;
            $procurementsByProduct[(int) $pp->product_id][(int) $pp->procurement_id] = true;
        }

        /* ── Closures. ── */
        $unionFor = function (array $segIds) use ($rulesBySeg): array {
            $u = ['kyc' => [], 'dd' => [], 'tl' => [], 'td' => []];
            foreach ($segIds as $sid) {
                $sel = $rulesBySeg[$sid] ?? [];
                foreach (self::CATS as $c) {
                    $entries = $sel[$c] ?? [];
                    if (!is_array($entries)) continue;
                    foreach ($entries as $code => $req) $u[$c][$code] = true;
                }
            }
            return $u;
        };
        $progressFor = function (array $union, string $ownerKey) use ($uploadsByOwner): array {
            $up = $uploadsByOwner[$ownerKey] ?? [];
            $out = [];
            foreach (self::CATS as $c) {
                $codes = array_keys($union[$c]);
                $d = 0;
                foreach ($codes as $code) if (isset($up[$c . '::' . $code])) $d++;
                $out[$c] = ['d' => $d, 't' => count($codes)];
            }
            return $out;
        };
        $agrProgress = function (array $segIds, array $signedSet) use ($agrIdsBySeg): array {
            $applic = [];
            foreach ($segIds as $sid) foreach ($agrIdsBySeg[$sid] ?? [] as $aid) $applic[$aid] = true;
            $ids = array_keys($applic);
            $d = 0;
            foreach ($ids as $aid) if (isset($signedSet[$aid])) $d++;
            return ['d' => $d, 't' => count($ids)];
        };
        // Map a supplier-type name → one of the three buckets.
        $bucketForType = function (?string $name): string {
            $n = mb_strtolower(trim((string) $name));
            if ($n === 'material')  return 'material';
            if ($n === 'logistic' || $n === 'logistics') return 'logistic';
            return 'services';   // Tech / Advisory / Risk Services + anything else
        };
        // Segment regulatory tier → the Reg. Status pill value used by the
        // transaction-wise tables ('highly' → High, everything else → Low).
        $regFor = function (int $segId) use ($segRegById): string {
            return mb_strtolower((string) ($segRegById[$segId] ?? '')) === 'highly' ? 'High' : 'Low';
        };

        /* ── Vendors. ── */
        $vendors = Vendor::query()->forUser($user)
            ->with(['vendorType:id,name', 'primaryAddress:id,vendor_id,state_id'])
            ->orderBy('id')
            ->get();

        $out = [
            'ws_mat' => [], 'ws_logi' => [], 'wos_svc' => [], 'wos_mat' => [], 'wos_logi' => [],
            'txn_ws_mat' => [], 'txn_ws_logi' => [], 'txn_wos_svc' => [], 'txn_wos_mat' => [], 'txn_wos_logi' => [],
        ];
        $counters = ['ws_mat' => 0, 'ws_logi' => 0, 'wos_svc' => 0, 'wos_mat' => 0, 'wos_logi' => 0];
        $tc = ['txn_ws_mat' => 0, 'txn_ws_logi' => 0, 'txn_wos_svc' => 0, 'txn_wos_mat' => 0, 'txn_wos_logi' => 0];

        foreach ($vendors as $v) {
            $segId   = (int) ($v->segment_id ?? 0);
            $segIds  = $segId ? [$segId] : [];
            $prog    = $progressFor($unionFor($segIds), Vendor::class . '#' . $v->id);
            $agr     = $agrProgress($segIds, $sigByParty['Vendor#' . $v->id] ?? []);

            // Shipment roll-up across this vendor's mapped products.
            $vendorLeads = [];
            foreach ($productsByVendor[(int) $v->id] ?? [] as $pid) {
                foreach (array_keys($leadsByProduct[$pid] ?? []) as $lid) $vendorLeads[$lid] = true;
            }
            $ship = 0; $withShipment = false;
            foreach (array_keys($vendorLeads) as $lid) {
                if (isset($shipCountByLead[$lid])) { $withShipment = true; $ship += $shipCountByLead[$lid]; }
            }

            $row = [
                'id'    => $v->vendor_code ?: ('V-' . str_pad((string) $v->id, 2, '0', STR_PAD_LEFT)),
                'db_id' => (int) $v->id,
                'name'  => $v->company_name,
                'seg'   => $segId ? ($segNameById[$segId] ?? '—') : '—',
                'sc'    => '#0e7490',
                'sb'    => '#f0fdff',
                'state' => $stateNameById[(int) optional($v->primaryAddress)->state_id] ?? '—',
                'sc2'   => '#0891b2',
                'kyc'   => $prog['kyc'],
                'dd'    => $prog['dd'],
                'tl'    => $prog['tl'],
                'td'    => $prog['td'],
                'agr'   => $agr,
                'ship'  => $ship,
            ];

            $bucket = $bucketForType(optional($v->vendorType)->name);
            if ($bucket === 'services') {
                $row['sr'] = ++$counters['wos_svc']; $out['wos_svc'][] = $row;
            } elseif ($bucket === 'material') {
                if ($withShipment) { $row['sr'] = ++$counters['ws_mat'];  $out['ws_mat'][]  = $row; }
                else               { $row['sr'] = ++$counters['wos_mat']; $out['wos_mat'][] = $row; }
            } else { // logistic
                if ($withShipment) { $row['sr'] = ++$counters['ws_logi'];  $out['ws_logi'][]  = $row; }
                else               { $row['sr'] = ++$counters['wos_logi']; $out['wos_logi'][] = $row; }
            }

            /* ── Transaction-wise rows: one per (procurement, supplier) where
             *    this supplier's product was procured. With/without shipment is
             *    decided per-procurement by its lead's shipment orders.
             *    Services suppliers never carry a shipment (mirrors party-wise).
             *    PO / Supplier Tax Invoice have no source field → '—'. ── */
            $vendorProcs = [];
            foreach ($productsByVendor[(int) $v->id] ?? [] as $pid) {
                foreach (array_keys($procurementsByProduct[$pid] ?? []) as $procId) $vendorProcs[$procId] = true;
            }
            $txnBase = [
                'supplier' => $v->company_name,
                'supId'    => $row['id'],
                'reg'      => $regFor($segId),
                'po'       => '—',
                'inv'      => '—',
                'kyc'      => $prog['kyc'],
                'dd'       => $prog['dd'],
                'tl'       => $prog['tl'],
                'td'       => $prog['td'],
                'agr'      => $agr,
            ];
            foreach (array_keys($vendorProcs) as $procId) {
                $lead    = (int) ($procLeadById[$procId] ?? 0);
                $shipIds = $shipIdsByLead[$lead] ?? [];
                $hasShip = !empty($shipIds);
                $procCode = 'PROC-' . str_pad((string) $procId, 3, '0', STR_PAD_LEFT);

                if ($bucket === 'services') {
                    $out['txn_wos_svc'][] = array_merge(['sr' => ++$tc['txn_wos_svc'], 'procId' => $procCode], $txnBase);
                } elseif ($bucket === 'material') {
                    if ($hasShip) {
                        $shpCode = 'SHP-' . str_pad((string) $shipIds[0], 3, '0', STR_PAD_LEFT);
                        $out['txn_ws_mat'][] = array_merge(['sr' => ++$tc['txn_ws_mat'], 'shpId' => $shpCode, 'procId' => $procCode], $txnBase);
                    } else {
                        $out['txn_wos_mat'][] = array_merge(['sr' => ++$tc['txn_wos_mat'], 'procId' => $procCode], $txnBase);
                    }
                } else { // logistic
                    if ($hasShip) {
                        $shpCode = 'SHP-' . str_pad((string) $shipIds[0], 3, '0', STR_PAD_LEFT);
                        $out['txn_ws_logi'][] = array_merge(['sr' => ++$tc['txn_ws_logi'], 'shpId' => $shpCode, 'procId' => $procCode], $txnBase);
                    } else {
                        $out['txn_wos_logi'][] = array_merge(['sr' => ++$tc['txn_wos_logi'], 'procId' => $procCode], $txnBase);
                    }
                }
            }
        }

        return response()->json(['status' => true, 'data' => $out]);
    }

    /** Case-insensitive token membership in a comma-separated string. */
    private function csvHasToken(?string $csv, string $token): bool
    {
        $token = mb_strtolower(trim($token));
        if ($token === '' || $csv === null || $csv === '') return false;
        foreach (explode(',', $csv) as $part) {
            if (mb_strtolower(trim($part)) === $token) return true;
        }
        return false;
    }
}
