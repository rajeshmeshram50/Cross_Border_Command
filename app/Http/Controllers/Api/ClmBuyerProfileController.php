<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\Product;
use App\Models\ProformaInvoice;
use App\Models\ProformaInvoiceItem;
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use App\Support\LibrarySegments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ClmBuyerProfileController extends Controller
{
    private const CATS = ['kyc', 'dd', 'tl', 'td'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $cid  = (int) ($user->client_id ?? 0);

        $empty = ['buyers' => [], 'consignees' => [], 'ws_eq' => [], 'ws_neq' => [], 'wos_eq' => [], 'wos_neq' => []];
        if (!$cid) return response()->json(['status' => true, 'data' => $empty]);

        $segments = ClmSegment::where('client_id', $cid)->get(['id', 'name', 'code', 'regulatory_status']);
        $segRegById  = [];
        foreach ($segments as $s) {
            $segRegById[(int) $s->id] = (string) $s->regulatory_status;
        }

        $rulesBySegType = [];
        foreach (ClmSegmentRule::where('client_id', $cid)->get(['segment_id', 'document_type', 'doc_selections']) as $r) {
            $rulesBySegType[(int) $r->segment_id][(string) $r->document_type] = is_array($r->doc_selections) ? $r->doc_selections : [];
        }
        $selForSeg = function (int $sid, string $docType) use ($rulesBySegType): array {
            $byType = $rulesBySegType[$sid] ?? [];
            if (isset($byType[$docType])) return $byType[$docType];
            return $byType ? (array) reset($byType) : [];
        };

        $uploadsByOwner = [];
        foreach (SegmentDocUpload::where('client_id', $cid)->get(['uploadable_type', 'uploadable_id', 'category', 'doc_code']) as $u) {
            $uploadsByOwner[$u->uploadable_type . '#' . $u->uploadable_id][$u->category . '::' . $u->doc_code] = true;
        }

        // Segment -> library rows: by segment id when the row has ids, else by
        // name/code as before (App\Support\LibrarySegments).
        $agreements = ClmAgreementLibrary::where('client_id', $cid)
            ->where('agr_status', 'Active')
            ->get(LibrarySegments::columns('clm_agreement_library', ['id', 'segment', 'regulatory', 'party']));
        $agrPartyById = [];
        $agrIdsBySeg = [];
        foreach ($agreements as $a) $agrPartyById[(int) $a->id] = (string) $a->party;
        foreach ($segments as $s) {
            $sid = (int) $s->id;
            $list = [];
            foreach ($agreements as $a) {
                if (LibrarySegments::matches($a, $s)) $list[] = (int) $a->id;
            }
            $agrIdsBySeg[$sid] = $list;
        }

        $tradeDocs = ClmTradeDocLibrary::where('client_id', $cid)
            ->where('status', 'active')
            ->get(LibrarySegments::columns('clm_trade_doc_library', ['id', 'segment', 'regulatory', 'party']));
        $tdPartyById = [];
        $tdIdsBySeg = [];
        foreach ($tradeDocs as $m) $tdPartyById[(int) $m->id] = (string) $m->party;
        foreach ($segments as $s) {
            $sid = (int) $s->id;
            $list = [];
            foreach ($tradeDocs as $m) {
                if (LibrarySegments::matches($m, $s)) $list[] = (int) $m->id;
            }
            $tdIdsBySeg[$sid] = $list;
        }

        $sigByParty   = [];
        $agrSigByLead = [];
        $sigRowsAll = ClmSignatureRequest::where('client_id', $cid)
            ->whereIn('document_type', [ClmSignatureRequest::DOC_AGREEMENT, ClmSignatureRequest::DOC_TRADE])
            ->where('status', 'completed')
            ->get(['model_name', 'party_id', 'lead_id', 'trade_doc_ids', 'trade_doc_id', 'document_type']);

        foreach ($sigRowsAll->where('document_type', ClmSignatureRequest::DOC_AGREEMENT) as $sr) {
            $ids = is_array($sr->trade_doc_ids) ? $sr->trade_doc_ids : [];
            $party = $sr->model_name === 'Consignee' ? 'Consignee' : 'Customer';
            foreach ($ids as $aid) {
                $aid = (int) $aid;
                if ($sr->party_id) $sigByParty[$sr->model_name . '#' . $sr->party_id][$aid] = true;
                if ($sr->lead_id) {
                    $agrSigByLead[(int) $sr->lead_id][$party][$aid] = true;
                }
            }
        }

        $tdSigByLead = [];
        $tdSigByParty = [];
        foreach ($sigRowsAll->where('document_type', ClmSignatureRequest::DOC_TRADE) as $sr) {
            $party = $sr->model_name === 'Consignee' ? 'Consignee' : 'Customer';
            $ids = is_array($sr->trade_doc_ids) && $sr->trade_doc_ids ? $sr->trade_doc_ids : [$sr->trade_doc_id];
            foreach ((array) $ids as $mid) {
                $mid = (int) $mid;
                if (!$mid) continue;
                if ($sr->lead_id) $tdSigByLead[(int) $sr->lead_id][$party][$mid] = true;
                if ($sr->party_id) $tdSigByParty[$party][(int) $sr->party_id][$mid] = true;
            }
        }

        $docTypeForCountry = fn(?string $country): string => trim((string) $country) === 'India' ? 'domestic' : 'international';
        $unionFor = function (array $segIds, string $docType) use ($selForSeg): array {
            $u = ['kyc' => [], 'dd' => [], 'tl' => [], 'td' => []];
            foreach ($segIds as $sid) {
                $sel = $selForSeg($sid, $docType);
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
        $agrIdsForSegments = function (array $segIds) use ($agrIdsBySeg): array {
            $set = [];
            foreach ($segIds as $sid) foreach ($agrIdsBySeg[$sid] ?? [] as $aid) $set[$aid] = true;
            return array_keys($set);
        };
        $tdIdsForSegments = function (array $segIds) use ($tdIdsBySeg): array {
            $set = [];
            foreach ($segIds as $sid) foreach ($tdIdsBySeg[$sid] ?? [] as $mid) $set[$mid] = true;
            return array_keys($set);
        };
        $agrProgress = function (array $applicableIds, array $signedSet): array {
            $t = count($applicableIds);
            $d = 0;
            foreach ($applicableIds as $aid) if (isset($signedSet[$aid])) $d++;
            return ['d' => $d, 't' => $t];
        };
        $partyFlags = function (?string $party): array {
            $tokens = array_filter(array_map(fn($t) => strtolower(trim($t)), explode(',', (string) $party)));
            if (empty($tokens)) return [true, true];
            return [
                in_array('buyer', $tokens, true),
                in_array('consignee', $tokens, true),
            ];
        };
        $docProgress = function (array $applicableIds, array $partyById, array $signedForSide, string $side) use ($partyFlags): array {
            $t = 0;
            $d = 0;
            foreach ($applicableIds as $id) {
                [$fb, $fc] = $partyFlags($partyById[$id] ?? null);
                $applies = $side === 'any' ? ($fb || $fc) : ($side === 'buyer' ? $fb : $fc);
                if (!$applies) continue;
                $t++;
                if (isset($signedForSide[$id])) $d++;
            }
            return ['d' => $d, 't' => $t];
        };
        $regFor = function (array $segIds) use ($segRegById): string {
            $hasHigh = false;
            $hasLow = false;
            foreach ($segIds as $sid) {
                $r = $segRegById[$sid] ?? null;
                if ($r === 'highly') $hasHigh = true;
                elseif ($r === 'less') $hasLow = true;
            }
            if ($hasHigh && $hasLow) return 'Both';
            if ($hasHigh) return 'High';
            return 'Low';
        };

        $leads = Lead::where('client_id', $cid)
            ->whereNotNull('customer_id')
            ->get(['id', 'opp_code', 'customer_id', 'consignee_id', 'lead_stage_id']);
        $leadIds = $leads->pluck('id')->all();

        $piByLead = [];
        if (!empty($leadIds)) {
            foreach (
                ProformaInvoice::where('client_id', $cid)
                    ->whereIn('opp_id', $leadIds)
                    ->where('status', '!=', 'cancelled')
                    ->orderBy('id')
                    ->get(['id', 'opp_id', 'code']) as $pi
            ) {
                $piByLead[(int) $pi->opp_id] = $pi;
            }
        }

        $piSignedIds = [];
        $piIdsForSig = collect($piByLead)->pluck('id')->all();
        if (!empty($piIdsForSig)) {
            foreach (
                ClmSignatureRequest::where('client_id', $cid)
                    ->where('document_type', ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                    ->whereIn('trade_doc_id', $piIdsForSig)
                    ->where('status', 'completed')
                    ->get(['trade_doc_id']) as $sr
            ) {
                $piSignedIds[(int) $sr->trade_doc_id] = true;
            }
        }

        $leadSegIds = [];
        $piIds = collect($piByLead)->pluck('id')->all();
        if (!empty($piIds)) {
            $itemsByPi = [];
            foreach (
                ProformaInvoiceItem::whereIn('proforma_invoice_id', $piIds)
                    ->whereNotNull('product_id')
                    ->get(['proforma_invoice_id', 'product_id']) as $it
            ) {
                $itemsByPi[(int) $it->proforma_invoice_id][] = (int) $it->product_id;
            }
            $allProductIds = collect($itemsByPi)->flatten()->unique()->values()->all();
            $segByProduct = [];
            if (!empty($allProductIds)) {
                foreach (
                    Product::where('client_id', $cid)
                        ->whereIn('id', $allProductIds)
                        ->whereNotNull('segment_id')
                        ->get(['id', 'segment_id']) as $p
                ) {
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

        $shipLeadIds = [];
        $shipCodeByLead = [];
        $shipByCustomer = [];
        $leadCustomerById = [];
        foreach ($leads as $l) $leadCustomerById[(int) $l->id] = (int) $l->customer_id;
        foreach (ShipmentOrder::where('client_id', $cid)->orderBy('id')->get(['id', 'lead_id', 'shipment_code']) as $so) {
            $lid = (int) $so->lead_id;
            $shipLeadIds[$lid] = true;
            if ($so->shipment_code) $shipCodeByLead[$lid] = $so->shipment_code;
            $cust = $leadCustomerById[$lid] ?? null;
            if ($cust) $shipByCustomer[$cust] = ($shipByCustomer[$cust] ?? 0) + 1;
        }

        $customers = Customer::query()->forUser($user)
            ->withCount(['consignees as consignees_count' => function ($q) {
                $q->where(fn($w) => $w->where('same_as_customer', false)->orWhereNull('same_as_customer'));
            }])
            ->with('primaryAddress:id,customer_id,country,city,cp_name')
            ->orderBy('id')
            ->get();

        $buyers = [];
        $applicTdByCustomer = [];
        $applicAgrByCustomer = [];
        $dealAgrByCustomer   = [];
        $dealAgrByConsignee  = [];
        $applicAgrByConsignee = [];
        $dealAgrSignedByConsignee = [];
        $sr = 0;
        foreach ($customers as $c) {
            $sr++;
            $segIds   = \App\Support\SegmentGuard::idsOf($c);
            $prog     = $progressFor($unionFor($segIds, $docTypeForCountry(optional($c->primaryAddress)->country)), Customer::class . '#' . $c->id);
            $applic   = $agrIdsForSegments($segIds);
            $applicTdByCustomer[(int) $c->id] = $tdIdsForSegments($segIds);
            $applicAgrByCustomer[(int) $c->id] = $applic;
            $agr      = $docProgress($applic, $agrPartyById, $sigByParty['Customer#' . $c->id] ?? [], 'buyer');
            $segNames = collect(explode(',', (string) $c->segment))->map(fn($n) => trim($n))->filter()->values()->all();
            $buyers[] = [
                'sr'      => $sr,
                'id'      => $c->customer_code ?: ('C-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                'db_id'   => (int) $c->id,
                'name'    => $c->company_name,
                'seg'     => $segNames,
                'segs'    => \App\Support\SegmentGuard::rowsFor($segIds),
                'sc'      => '#0e7490',
                'sb'      => '#f0fdff',
                'country' => optional($c->primaryAddress)->country ?: '—',
                'contact' => optional($c->primaryAddress)->cp_name,
                'city'    => optional($c->primaryAddress)->city,
                'type'    => $c->type,
                'risk'    => $c->risk_level,
                'cn'      => (int) ($c->consignees_count ?? 0),
                'kyc'     => $prog['kyc'],
                'dd'      => $prog['dd'],
                'tl'      => $prog['tl'],
                'td'      => ['d' => 0, 't' => 0],
                'agr'     => $agr,
                'ship'    => (int) ($shipByCustomer[(int) $c->id] ?? 0),
            ];
        }

        $consignees = Consignee::query()->forUser($user)
            ->with([
                'primaryAddress:id,consignee_id,country,city,cp_name',
                'customer:id,customer_code',
                'customers:id,customer_code,segment,segment_ids,client_id,branch_id',
            ])
            ->orderBy('id')
            ->get();

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
            $sameAsCust = !empty($c->same_as_customer) ? $c->customers->first() : null;
            $progOwner  = $sameAsCust
                ? Customer::class . '#' . $sameAsCust->id
                : Consignee::class . '#' . $c->id;
            $segSource  = $sameAsCust ? $sameAsCust->segment : $c->segment;
            $segIds = \App\Support\SegmentGuard::idsOf($sameAsCust ?: $c);
            $prog   = $progressFor($unionFor($segIds, $docTypeForCountry(optional($c->primaryAddress)->country)), $progOwner);
            $applic = $agrIdsForSegments($segIds);
            $agr    = $docProgress($applic, $agrPartyById, $sigByParty['Consignee#' . $c->id] ?? [], 'consignee');
            $applicAgrByConsignee[(int) $c->id] = $applic;
            $consOut[] = [
                'sr'      => $sr,
                'id'      => $c->consignee_code ?: ('CS-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                'cid'     => optional($c->customer)->customer_code ?: ('C-' . str_pad((string) $c->customer_id, 3, '0', STR_PAD_LEFT)),
                'cids'    => (function () use ($c) {
                    $codes = $c->customers
                        ->map(fn($cu) => $cu->customer_code ?: ('C-' . str_pad((string) $cu->id, 3, '0', STR_PAD_LEFT)))
                        ->filter()
                        ->values()
                        ->all();
                    if (empty($codes) && $c->customer_id) {
                        $codes = [optional($c->customer)->customer_code ?: ('C-' . str_pad((string) $c->customer_id, 3, '0', STR_PAD_LEFT))];
                    }
                    return $codes;
                })(),
                'db_id'   => (int) $c->id,
                'name'    => $c->company_name,
                'seg'     => trim((string) $c->segment),
                'segs'    => \App\Support\SegmentGuard::rowsFor(\App\Support\SegmentGuard::idsOf($c)),
                'sc'      => '#0e7490',
                'sb'      => '#f0fdff',
                'country' => optional($c->primaryAddress)->country ?: '—',
                'contact' => optional($c->primaryAddress)->cp_name,
                'city'    => optional($c->primaryAddress)->city,
                'risk'    => $c->risk_level,
                'same_as_customer' => (bool) $c->same_as_customer,
                'kyc'     => $prog['kyc'],
                'dd'      => $prog['dd'],
                'tl'      => $prog['tl'],
                'td'      => ['d' => 0, 't' => 0],
                'agr'     => $agr,
                'ship'    => (int) ($shipByConsignee[(int) $c->id] ?? 0),
            ];
        }

        $custById = $customers->keyBy('id');
        $consById = $consignees->keyBy('id');
        $custProgById = [];
        foreach ($buyers as $b) $custProgById[$b['db_id']] = $b;
        $consProgById = [];
        foreach ($consOut as $co) $consProgById[$co['db_id']] = $co;

        $wsEq = [];
        $wsNeq = [];
        $wosEq = [];
        $wosNeq = [];

        $tdByCustomer  = [];
        $tdByConsignee = [];
        $agrByCustomer  = [];
        $agrByConsignee = [];
        $addTd = function (array &$acc, int $key, array $p): void {
            $acc[$key]['d'] = ($acc[$key]['d'] ?? 0) + (int) $p['d'];
            $acc[$key]['t'] = ($acc[$key]['t'] ?? 0) + (int) $p['t'];
        };
        $n = ['wsEq' => 0, 'wsNeq' => 0, 'wosEq' => 0, 'wosNeq' => 0];

        foreach ($leads as $l) {
            $cust = $custById->get($l->customer_id);
            if (!$cust) continue;
            $lid = (int) $l->id;
            $cons = $l->consignee_id ? $consById->get($l->consignee_id) : null;
            $separateConsignee = $cons && !$cons->same_as_customer;

            $segIds = $leadSegIds[$lid] ?? [];
            $cp     = $custProgById[(int) $cust->id] ?? null;
            $pi     = $piByLead[$lid] ?? null;
            $hasShip = isset($shipLeadIds[$lid]);

            $applicAgr = $agrIdsForSegments($segIds);
            foreach ($applicAgr as $aid) $dealAgrByCustomer[(int) $cust->id][(int) $aid] = true;
            $applicTd  = $tdIdsForSegments($segIds);
            $agrBuyer  = $docProgress($applicAgr, $agrPartyById, $agrSigByLead[$lid]['Customer'] ?? [], 'buyer');
            $agrConsDeal = $docProgress(
                $applicAgr,
                $agrPartyById,
                ($agrSigByLead[$lid]['Customer'] ?? []) + ($agrSigByLead[$lid]['Consignee'] ?? []),
                'consignee',
            );
            $tdConsDeal = $docProgress(
                $applicTd,
                $tdPartyById,
                ($tdSigByLead[$lid]['Customer'] ?? []) + ($tdSigByLead[$lid]['Consignee'] ?? []),
                $separateConsignee ? 'consignee' : 'any',
            );
            $tdSigSet  = $separateConsignee
                ? ($tdSigByLead[$lid]['Customer'] ?? [])
                : (($tdSigByLead[$lid]['Customer'] ?? []) + ($tdSigByLead[$lid]['Consignee'] ?? []));
            $tdBuyer   = $docProgress($applicTd, $tdPartyById, $tdSigSet, 'buyer');
            if ($pi) {
                $tdBuyer['t'] += 1;
                if (isset($piSignedIds[(int) $pi->id])) $tdBuyer['d'] += 1;
            }

            $base = [
                'opp'      => $l->opp_code ?: ('OPP-' . $lid),
                'leadId'   => $lid,
                'customer' => $cust->company_name,
                'custId'   => (int) $cust->id,
                'country'  => optional($cust->primaryAddress)->country ?: '',
                'pi'       => $pi ? (string) ($pi->code ?? '') : '',
                'reg'      => $regFor($segIds),
                'kyc'      => $cp ? $cp['kyc'] : ['d' => 0, 't' => 0],
                'dd'       => $cp ? $cp['dd']  : ['d' => 0, 't' => 0],
                'tl'       => $cp ? $cp['tl']  : ['d' => 0, 't' => 0],
                'td'       => $tdBuyer,
                'agr'      => $agrBuyer,
            ];
            if ($hasShip) $base['shp'] = $shipCodeByLead[$lid] ?? ('SHP-' . str_pad((string) $lid, 3, '0', STR_PAD_LEFT));
            if ($separateConsignee) {
                $base['consignee'] = $cons->company_name;
                $base['consId'] = (int) $cons->id;
                $cp2 = $consProgById[(int) $cons->id] ?? null;
                $base['c_kyc'] = $cp2 ? $cp2['kyc'] : ['d' => 0, 't' => 0];
                $base['c_dd']  = $cp2 ? $cp2['dd']  : ['d' => 0, 't' => 0];
                $base['c_tl']  = $cp2 ? $cp2['tl']  : ['d' => 0, 't' => 0];
                $base['c_td']  = $docProgress($applicTd,  $tdPartyById,  $tdSigByLead[$lid]['Consignee']  ?? [], 'consignee');
                $base['c_agr'] = $docProgress($applicAgr, $agrPartyById, $agrSigByLead[$lid]['Consignee'] ?? [], 'consignee');
            }

            if ($cons) {
                foreach ($applicAgr as $aid) $dealAgrByConsignee[(int) $cons->id][(int) $aid] = true;
                foreach (array_keys(($agrSigByLead[$lid]['Customer'] ?? []) + ($agrSigByLead[$lid]['Consignee'] ?? [])) as $sid) {
                    $dealAgrSignedByConsignee[(int) $cons->id][(int) $sid] = true;
                }
            }
            if ($hasShip) {
                $addTd($tdByCustomer, (int) $cust->id, $tdBuyer);
                $addTd($agrByCustomer, (int) $cust->id, $agrBuyer);
                if ($cons) {
                    $addTd($tdByConsignee, (int) $cons->id, $tdConsDeal);
                    $addTd($agrByConsignee, (int) $cons->id, $agrConsDeal);
                }
            }

            if ($hasShip && $separateConsignee) {
                $base['sr'] = ++$n['wsNeq'];
                $wsNeq[]  = $base;
            } elseif ($hasShip && !$separateConsignee) {
                $base['sr'] = ++$n['wsEq'];
                $wsEq[]   = $base;
            } elseif (!$hasShip && $separateConsignee) {
                $base['sr'] = ++$n['wosNeq'];
                $wosNeq[] = $base;
            } else {
                $base['sr'] = ++$n['wosEq'];
                $wosEq[]  = $base;
            }
        }

        foreach ($buyers as &$b) {
            $b['td'] = $tdByCustomer[(int) $b['db_id']] ?? ['d' => 0, 't' => 0];
            $partyIds  = array_keys($tdSigByParty['Customer'][(int) $b['db_id']] ?? []);
            $applicIds = $applicTdByCustomer[(int) $b['db_id']] ?? [];
            $partyDone = count(array_intersect($applicIds, $partyIds));
            $b['agr'] = $agrByCustomer[(int) $b['db_id']] ?? ['d' => 0, 't' => 0];

            if ($partyDone > 0) {
                $b['td']['d'] = min($b['td']['t'], max($b['td']['d'], $partyDone));
            }
        }
        unset($b);
        $custIdOfCons = [];
        foreach ($consignees as $cRow) {
            $first = $cRow->customers->first();
            $custIdOfCons[(int) $cRow->id] = (int) ($first->id ?? $cRow->customer_id ?? 0);
        }

        foreach ($consOut as &$co) {
            $co['agr'] = $agrByConsignee[(int) $co['db_id']] ?? ['d' => 0, 't' => 0];

            $own = $tdByConsignee[(int) $co['db_id']] ?? null;
            if ($own) {
                $co['td'] = $own;
                continue;
            }

            $co['td'] = ['d' => 0, 't' => 0];
        }
        unset($co);

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
}
