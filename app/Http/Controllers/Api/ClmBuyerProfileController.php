<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\Product;
use App\Models\ProformaInvoice;
use App\Models\ProformaInvoiceItem;
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;



class ClmBuyerProfileController extends Controller
{
    private const CATS = ['kyc', 'dd', 'tl', 'td'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid  = (int) ($user->client_id ?? 0);

        $empty = ['buyers' => [], 'consignees' => [], 'ws_eq' => [], 'ws_neq' => [], 'wos_eq' => [], 'wos_neq' => []];
        if (!$cid) return response()->json(['status' => true, 'data' => $empty]);

        /* ── 1. Segment masters (name→id, id→regulatory). ── */
        $segments = ClmSegment::where('client_id', $cid)->get(['id', 'name', 'code', 'regulatory_status']);
        $segIdByName = [];
        $segRegById  = [];
        foreach ($segments as $s) {
            $segIdByName[mb_strtolower(trim((string) $s->name))] = (int) $s->id;
            $segRegById[(int) $s->id] = (string) $s->regulatory_status;   // 'highly' | 'less'
        }

        /* ── 2. Segment rules → required-doc union per segment. ── */
        $rulesBySeg = [];
        foreach (ClmSegmentRule::where('client_id', $cid)->get(['segment_id', 'doc_selections']) as $r) {
            $rulesBySeg[(int) $r->segment_id] = is_array($r->doc_selections) ? $r->doc_selections : [];
        }

        /* ── 3. Uploaded docs grouped by owner ("Type#id" → set of cat::code). ── */
        $uploadsByOwner = [];
        foreach (SegmentDocUpload::where('client_id', $cid)->get(['uploadable_type', 'uploadable_id', 'category', 'doc_code']) as $u) {
            $uploadsByOwner[$u->uploadable_type . '#' . $u->uploadable_id][$u->category . '::' . $u->doc_code] = true;
        }

        /* ── 4. Active agreements + applicability per segment id. ── */
        $agreements = ClmAgreementLibrary::where('client_id', $cid)
            ->where('agr_status', 'Active')
            ->get(['id', 'segment', 'regulatory']);
        $agrIdsBySeg = [];   // segment_id → [agreement_id, …]
        foreach ($segments as $s) {
            $sid = (int) $s->id;
            $list = [];
            foreach ($agreements as $a) {
                if ((string) $a->regulatory !== (string) $s->regulatory_status) continue;
                if ($this->csvHasToken((string) $a->segment, (string) $s->name)
                    || $this->csvHasToken((string) $a->segment, (string) $s->code)) {
                    $list[] = (int) $a->id;
                }
            }
            $agrIdsBySeg[$sid] = $list;
        }

        /* ── 5. Completed agreement signature requests, keyed by party + lead. ── */
        $sigByParty = [];   // "Model#id" → set of completed agreement ids
        $sigByLead  = [];   // lead_id    → set of completed agreement ids
        foreach (ClmSignatureRequest::where('client_id', $cid)
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            ->get(['model_name', 'party_id', 'lead_id', 'trade_doc_ids']) as $sr) {
            $ids = is_array($sr->trade_doc_ids) ? $sr->trade_doc_ids : [];
            foreach ($ids as $aid) {
                $aid = (int) $aid;
                if ($sr->party_id) $sigByParty[$sr->model_name . '#' . $sr->party_id][$aid] = true;
                if ($sr->lead_id)  $sigByLead[(int) $sr->lead_id][$aid] = true;
            }
        }

        /* ── Closures shared by every section. ── */
        $segIdsFromNames = function (?string $csv) use ($segIdByName): array {
            $ids = [];
            foreach (explode(',', (string) $csv) as $n) {
                $k = mb_strtolower(trim($n));
                if ($k !== '' && isset($segIdByName[$k])) $ids[] = $segIdByName[$k];
            }
            return array_values(array_unique($ids));
        };
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
        // Applicable agreement ids for a set of segment ids.
        $agrIdsForSegments = function (array $segIds) use ($agrIdsBySeg): array {
            $set = [];
            foreach ($segIds as $sid) foreach ($agrIdsBySeg[$sid] ?? [] as $aid) $set[$aid] = true;
            return array_keys($set);
        };
        // agr progress = applicable agreements vs completed (from a "signed set").
        $agrProgress = function (array $applicableIds, array $signedSet): array {
            $t = count($applicableIds);
            $d = 0;
            foreach ($applicableIds as $aid) if (isset($signedSet[$aid])) $d++;
            return ['d' => $d, 't' => $t];
        };
        // Regulatory tier label from a set of segment ids.
        $regFor = function (array $segIds) use ($segRegById): string {
            $hasHigh = false; $hasLow = false;
            foreach ($segIds as $sid) {
                $r = $segRegById[$sid] ?? null;
                if ($r === 'highly') $hasHigh = true;
                elseif ($r === 'less') $hasLow = true;
            }
            if ($hasHigh && $hasLow) return 'Both';
            if ($hasHigh) return 'High';
            return 'Low';
        };

        /* ── 6. Leads, PIs, shipments (batched) for ship counts + txn tables. ── */
        $leads = Lead::where('client_id', $cid)
            ->whereNotNull('customer_id')
            ->get(['id', 'opp_code', 'customer_id', 'consignee_id', 'lead_stage_id']);
        $leadIds = $leads->pluck('id')->all();

        // Latest non-cancelled PI per lead.
        $piByLead = [];
        if (!empty($leadIds)) {
            foreach (ProformaInvoice::where('client_id', $cid)
                ->whereIn('opp_id', $leadIds)
                ->where('status', '!=', 'cancelled')
                ->orderBy('id')
                ->get(['id', 'opp_id', 'code']) as $pi) {
                $piByLead[(int) $pi->opp_id] = $pi;   // later id wins = latest
            }
        }

        // Lead → product segment ids (via the lead's latest PI line items).
        $leadSegIds = [];
        $piIds = collect($piByLead)->pluck('id')->all();
        if (!empty($piIds)) {
            $itemsByPi = [];
            foreach (ProformaInvoiceItem::whereIn('proforma_invoice_id', $piIds)
                ->whereNotNull('product_id')
                ->get(['proforma_invoice_id', 'product_id']) as $it) {
                $itemsByPi[(int) $it->proforma_invoice_id][] = (int) $it->product_id;
            }
            $allProductIds = collect($itemsByPi)->flatten()->unique()->values()->all();
            $segByProduct = [];
            if (!empty($allProductIds)) {
                foreach (Product::where('client_id', $cid)
                    ->whereIn('id', $allProductIds)
                    ->whereNotNull('segment_id')
                    ->get(['id', 'segment_id']) as $p) {
                    $segByProduct[(int) $p->id] = (int) $p->segment_id;
                }
            }
            foreach ($piByLead as $leadId => $pi) {
                $segs = [];
                foreach ($itemsByPi[(int) $pi->id] ?? [] as $pid) {
                    if (isset($segByProduct[$pid])) $segs[$segByProduct[$pid]] = true;
                }
                $leadSegIds[(int) $leadId] = array_keys($segs);
            }
        }

        // Shipments: which leads have one + per-customer count.
        $shipLeadIds = [];
        $shipByCustomer = [];
        $leadCustomerById = [];
        foreach ($leads as $l) $leadCustomerById[(int) $l->id] = (int) $l->customer_id;
        foreach (ShipmentOrder::where('client_id', $cid)->get(['id', 'lead_id']) as $so) {
            $lid = (int) $so->lead_id;
            $shipLeadIds[$lid] = true;
            $cust = $leadCustomerById[$lid] ?? null;
            if ($cust) $shipByCustomer[$cust] = ($shipByCustomer[$cust] ?? 0) + 1;
        }

        /* ── 7. Buyers (customers). ── */
        $customers = Customer::query()->forUser($user)
            ->withCount('consignees')
            ->with('primaryAddress:id,customer_id,country')
            ->orderBy('id')
            ->get();

        $buyers = [];
        $sr = 0;
        foreach ($customers as $c) {
            $sr++;
            $segIds   = $segIdsFromNames($c->segment);
            $prog     = $progressFor($unionFor($segIds), Customer::class . '#' . $c->id);
            $applic   = $agrIdsForSegments($segIds);
            $agr      = $agrProgress($applic, $sigByParty['Customer#' . $c->id] ?? []);
            $segNames = collect(explode(',', (string) $c->segment))->map(fn ($n) => trim($n))->filter()->values()->all();
            $buyers[] = [
                'sr'      => $sr,
                'id'      => $c->customer_code ?: ('C-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                'db_id'   => (int) $c->id,
                'name'    => $c->company_name,
                'seg'     => $segNames,
                'sc'      => '#0e7490',
                'sb'      => '#f0fdff',
                'country' => optional($c->primaryAddress)->country ?: '—',
                'cn'      => (int) ($c->consignees_count ?? 0),
                'kyc'     => $prog['kyc'],
                'dd'      => $prog['dd'],
                'tl'      => $prog['tl'],
                'td'      => $prog['td'],
                'agr'     => $agr,
                'ship'    => (int) ($shipByCustomer[(int) $c->id] ?? 0),
            ];
        }

        /* ── 8. Consignees. ── */
        $consignees = Consignee::query()->forUser($user)
            ->with(['primaryAddress:id,consignee_id,country', 'customer:id,customer_code'])
            ->orderBy('id')
            ->get();

        // shipment count per consignee (via leads referencing the consignee).
        $shipByConsignee = [];
        foreach ($leads as $l) {
            if ($l->consignee_id && isset($shipLeadIds[(int) $l->id])) {
                $shipByConsignee[(int) $l->consignee_id] = ($shipByConsignee[(int) $l->consignee_id] ?? 0) + 1;
            }
        }

        $consOut = [];
        $sr = 0;
        foreach ($consignees as $c) {
            $sr++;
            $segIds = $segIdsFromNames($c->segment);
            $prog   = $progressFor($unionFor($segIds), Consignee::class . '#' . $c->id);
            $applic = $agrIdsForSegments($segIds);
            $agr    = $agrProgress($applic, $sigByParty['Consignee#' . $c->id] ?? []);
            $consOut[] = [
                'sr'      => $sr,
                'id'      => $c->consignee_code ?: ('CS-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                'cid'     => optional($c->customer)->customer_code ?: ('C-' . str_pad((string) $c->customer_id, 3, '0', STR_PAD_LEFT)),
                'db_id'   => (int) $c->id,
                'name'    => $c->company_name,
                'seg'     => trim((string) $c->segment),
                'sc'      => '#0e7490',
                'sb'      => '#f0fdff',
                'country' => optional($c->primaryAddress)->country ?: '—',
                'kyc'     => $prog['kyc'],
                'dd'      => $prog['dd'],
                'tl'      => $prog['tl'],
                'td'      => $prog['td'],
                'agr'     => $agr,
                'ship'    => (int) ($shipByConsignee[(int) $c->id] ?? 0),
            ];
        }

        /* ── 9. Transaction matrix (opportunities). ── */
        $custById = $customers->keyBy('id');
        $consById = $consignees->keyBy('id');
        // Customer compliance progress reused per opportunity (keyed by id).
        $custProgById = [];
        foreach ($buyers as $b) $custProgById[$b['db_id']] = $b;

        $wsEq = []; $wsNeq = []; $wosEq = []; $wosNeq = [];
        $n = ['wsEq' => 0, 'wsNeq' => 0, 'wosEq' => 0, 'wosNeq' => 0];

        foreach ($leads as $l) {
            $cust = $custById->get($l->customer_id);
            if (!$cust) continue;
            $lid = (int) $l->id;
            $cons = $l->consignee_id ? $consById->get($l->consignee_id) : null;
            // "buyer = consignee": no separate consignee, or it's flagged same_as_customer.
            $separateConsignee = $cons && !$cons->same_as_customer;

            $segIds = $leadSegIds[$lid] ?? $segIdsFromNames($cust->segment);
            $cp     = $custProgById[(int) $cust->id] ?? null;
            $applic = $agrIdsForSegments($segIds);
            $agr    = $agrProgress($applic, $sigByLead[$lid] ?? []);
            $pi     = $piByLead[$lid] ?? null;
            $hasShip = isset($shipLeadIds[$lid]);

            $base = [
                'opp'      => $l->opp_code ?: ('OPP-' . $lid),
                'customer' => $cust->company_name,
                'custId'   => (int) $cust->id,
                'pi'       => $pi ? (string) ($pi->code ?? '') : '',
                'reg'      => $regFor($segIds),
                'kyc'      => $cp ? $cp['kyc'] : ['d' => 0, 't' => 0],
                'dd'       => $cp ? $cp['dd']  : ['d' => 0, 't' => 0],
                'tl'       => $cp ? $cp['tl']  : ['d' => 0, 't' => 0],
                'td'       => $cp ? $cp['td']  : ['d' => 0, 't' => 0],
                'agr'      => $agr,
            ];
            if ($hasShip) $base['shp'] = 'SHP-' . str_pad((string) $lid, 3, '0', STR_PAD_LEFT);
            if ($separateConsignee) { $base['consignee'] = $cons->company_name; $base['consId'] = (int) $cons->id; }

            if ($hasShip && $separateConsignee)        { $base['sr'] = ++$n['wsNeq'];  $wsNeq[]  = $base; }
            elseif ($hasShip && !$separateConsignee)   { $base['sr'] = ++$n['wsEq'];   $wsEq[]   = $base; }
            elseif (!$hasShip && $separateConsignee)   { $base['sr'] = ++$n['wosNeq']; $wosNeq[] = $base; }
            else                                       { $base['sr'] = ++$n['wosEq'];  $wosEq[]  = $base; }
        }

        return response()->json([
            'status' => true,
            'data'   => [
                'buyers'     => $buyers,
                'consignees' => $consOut,
                'ws_eq'      => $wsEq,
                'ws_neq'     => $wsNeq,
                'wos_eq'     => $wosEq,
                'wos_neq'    => $wosNeq,
            ],
        ]);
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
