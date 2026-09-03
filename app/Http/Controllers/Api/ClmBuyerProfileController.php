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

        /* ── 2. Segment rules → required-doc union per segment.
         * A segment can carry a Domestic AND an International rule, so key the
         * doc_selections by document_type and let each buyer draw the set that
         * matches its own trade type (India → domestic, else international).
         * `$selForSeg` falls back to the segment's other-type rule when the
         * matching one is absent, so legacy single-type setups never lose docs. */
        $rulesBySegType = [];
        foreach (ClmSegmentRule::where('client_id', $cid)->get(['segment_id', 'document_type', 'doc_selections']) as $r) {
            $rulesBySegType[(int) $r->segment_id][(string) $r->document_type] = is_array($r->doc_selections) ? $r->doc_selections : [];
        }
        $selForSeg = function (int $sid, string $docType) use ($rulesBySegType): array {
            $byType = $rulesBySegType[$sid] ?? [];
            if (isset($byType[$docType])) return $byType[$docType];
            return $byType ? (array) reset($byType) : [];
        };

        /* ── 3. Uploaded docs grouped by owner ("Type#id" → set of cat::code). ── */
        $uploadsByOwner = [];
        foreach (SegmentDocUpload::where('client_id', $cid)->get(['uploadable_type', 'uploadable_id', 'category', 'doc_code']) as $u) {
            $uploadsByOwner[$u->uploadable_type . '#' . $u->uploadable_id][$u->category . '::' . $u->doc_code] = true;
        }

        /* ── 4. Active agreements + applicability per segment id. ── */
        $agreements = ClmAgreementLibrary::where('client_id', $cid)
            ->where('agr_status', 'Active')
            ->get(['id', 'segment', 'regulatory', 'party']);
        $agrPartyById = [];   // agreement_id → party CSV ("buyer"/"consignee")
        $agrIdsBySeg = [];    // segment_id → [agreement_id, …]
        foreach ($agreements as $a) $agrPartyById[(int) $a->id] = (string) $a->party;
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

        // Active trade-document library matched to each segment the same way, so
        // a shipment's Trade Docs count (its Proforma Invoice + applicable trade
        // docs) mirrors the Evidence Vault instead of the empty customer bucket.
        $tradeDocs = ClmTradeDocLibrary::where('client_id', $cid)
            ->where('status', 'active')
            ->get(['id', 'segment', 'regulatory', 'party']);
        $tdPartyById = [];    // trade_doc_id → party CSV
        $tdIdsBySeg = [];     // segment_id → [trade_doc_id, …]
        foreach ($tradeDocs as $m) $tdPartyById[(int) $m->id] = (string) $m->party;
        foreach ($segments as $s) {
            $sid = (int) $s->id;
            $list = [];
            foreach ($tradeDocs as $m) {
                if ((string) $m->regulatory !== (string) $s->regulatory_status) continue;
                if ($this->csvHasToken((string) $m->segment, (string) $s->name)
                    || $this->csvHasToken((string) $m->segment, (string) $s->code)) {
                    $list[] = (int) $m->id;
                }
            }
            $tdIdsBySeg[$sid] = $list;
        }

        /* ── 5. Completed agreement signature requests, keyed by party + lead. ── */
        $sigByParty   = [];   // "Model#id" → set of completed agreement ids (party-wise list)
        $agrSigByLead = [];   // lead_id    → ['Customer'|'Consignee' → set of agreement ids]
        foreach (ClmSignatureRequest::where('client_id', $cid)
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            ->get(['model_name', 'party_id', 'lead_id', 'trade_doc_ids']) as $sr) {
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

        // Completed trade-document signatures, per lead + party, keyed by the
        // trade-doc-library id (legacy scalar or the multi-doc JSON array).
        $tdSigByLead = [];   // lead_id → ['Customer'|'Consignee' → set of trade_doc ids]
        foreach (ClmSignatureRequest::where('client_id', $cid)
            ->where('document_type', ClmSignatureRequest::DOC_TRADE)
            ->where('status', 'completed')
            ->get(['model_name', 'lead_id', 'trade_doc_ids', 'trade_doc_id']) as $sr) {
            if (!$sr->lead_id) continue;
            $party = $sr->model_name === 'Consignee' ? 'Consignee' : 'Customer';
            $ids = is_array($sr->trade_doc_ids) && $sr->trade_doc_ids ? $sr->trade_doc_ids : [$sr->trade_doc_id];
            foreach ((array) $ids as $mid) {
                $mid = (int) $mid;
                if ($mid) $tdSigByLead[(int) $sr->lead_id][$party][$mid] = true;
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
        // Buyer trade type from its primary-address country (India → domestic).
        $docTypeForCountry = fn (?string $country): string => trim((string) $country) === 'India' ? 'domestic' : 'international';
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
        // Applicable agreement / trade-doc ids for a set of segment ids.
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
        // agr progress = applicable agreements vs completed (from a "signed set").
        $agrProgress = function (array $applicableIds, array $signedSet): array {
            $t = count($applicableIds);
            $d = 0;
            foreach ($applicableIds as $aid) if (isset($signedSet[$aid])) $d++;
            return ['d' => $d, 't' => $t];
        };
        // Party membership from a doc's party CSV (buyer / consignee), matching
        // the Evidence Vault's partyFlags. Empty ⇒ applies to both parties.
        $partyFlags = function (?string $party): array {
            $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $party)));
            $fb = in_array('buyer', $tokens, true);
            $fc = in_array('consignee', $tokens, true);
            if (!$fb && !$fc) { $fb = true; $fc = true; }
            return [$fb, $fc];
        };
        // Per-party applicable-doc progress: count the applicable library ids
        // whose party covers $side ('buyer'|'consignee'); a doc is "done" when a
        // completed signature for that side exists. Mirrors the vault ratios.
        $docProgress = function (array $applicableIds, array $partyById, array $signedForSide, string $side) use ($partyFlags): array {
            $t = 0; $d = 0;
            foreach ($applicableIds as $id) {
                [$fb, $fc] = $partyFlags($partyById[$id] ?? null);
                if (!($side === 'buyer' ? $fb : $fc)) continue;
                $t++;
                if (isset($signedForSide[$id])) $d++;
            }
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

        // Which PIs have a COMPLETED e-signature — the PI is a shipment's first
        // (buyer-side) Trade Document, so a signed PI counts as a signed trade
        // doc (same source of truth the Q/PI list + Evidence Vault use).
        $piSignedIds = [];
        $piIdsForSig = collect($piByLead)->pluck('id')->all();
        if (!empty($piIdsForSig)) {
            foreach (ClmSignatureRequest::where('client_id', $cid)
                ->where('document_type', ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                ->whereIn('trade_doc_id', $piIdsForSig)
                ->where('status', 'completed')
                ->get(['trade_doc_id']) as $sr) {
                $piSignedIds[(int) $sr->trade_doc_id] = true;
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
        $shipCodeByLead = [];
        $shipByCustomer = [];
        $leadCustomerById = [];
        foreach ($leads as $l) $leadCustomerById[(int) $l->id] = (int) $l->customer_id;
        foreach (ShipmentOrder::where('client_id', $cid)->orderBy('id')->get(['id', 'lead_id', 'shipment_code']) as $so) {
            $lid = (int) $so->lead_id;
            $shipLeadIds[$lid] = true;
            // Real shipment_orders.shipment_code (e.g. "SHP-001"), so the txn
            // tables show the same id as the Evidence Vault. Latest row wins;
            // legacy rows with a NULL code fall back to the synthetic id below.
            if ($so->shipment_code) $shipCodeByLead[$lid] = $so->shipment_code;
            $cust = $leadCustomerById[$lid] ?? null;
            if ($cust) $shipByCustomer[$cust] = ($shipByCustomer[$cust] ?? 0) + 1;
        }

        /* ── 7. Buyers (customers). ── */
        // Count only DISTINCT consignees (exclude "same as customer" entries) so
        // the list's CONSIGNEES column matches the consignee popup.
        $customers = Customer::query()->forUser($user)
            ->withCount(['consignees as consignees_count' => function ($q) {
                $q->where(fn ($w) => $w->where('same_as_customer', false)->orWhereNull('same_as_customer'));
            }])
            ->with('primaryAddress:id,customer_id,country')
            ->orderBy('id')
            ->get();

        $buyers = [];
        $sr = 0;
        foreach ($customers as $c) {
            $sr++;
            $segIds   = $segIdsFromNames($c->segment);
            $prog     = $progressFor($unionFor($segIds, $docTypeForCountry(optional($c->primaryAddress)->country)), Customer::class . '#' . $c->id);
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
                /* Placeholder — overwritten below from $tdByCustomer /
                   $tdByConsignee. NOT $prog['td']: that resolves out of the
                   segment rule's doc_selections['td'], which the DCP no longer
                   stores, so it is permanently an empty set. */
                'td'      => ['d' => 0, 't' => 0],
                'agr'     => $agr,
                'ship'    => (int) ($shipByCustomer[(int) $c->id] ?? 0),
            ];
        }

        /* ── 8. Consignees. ── */
        $consignees = Consignee::query()->forUser($user)
            // `customers` is the many-to-many pivot (all customers this consignee
            // is mapped to); `customer` is just the legacy single primary. The
            // profile must reflect ALL mapped customers, not only the primary.
            ->with([
                'primaryAddress:id,consignee_id,country',
                'customer:id,customer_code',
                'customers:id,customer_code',
            ])
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
            $prog   = $progressFor($unionFor($segIds, $docTypeForCountry(optional($c->primaryAddress)->country)), Consignee::class . '#' . $c->id);
            $applic = $agrIdsForSegments($segIds);
            // Party-filter the agreement total to the CONSIGNEE side (same as the
            // transaction matrix's c_agr) — $agrProgress counted ALL segment
            // agreements incl. buyer-only ones a consignee can never sign, so the
            // "Agreements Pending" KPI was inflated for every consignee.
            $agr    = $docProgress($applic, $agrPartyById, $sigByParty['Consignee#' . $c->id] ?? [], 'consignee');
            $consOut[] = [
                'sr'      => $sr,
                'id'      => $c->consignee_code ?: ('CS-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                'cid'     => optional($c->customer)->customer_code ?: ('C-' . str_pad((string) $c->customer_id, 3, '0', STR_PAD_LEFT)),
                // All mapped customers (codes) via the M2M pivot — falls back to
                // the single primary when the pivot has no rows.
                'cids'    => (function () use ($c) {
                    $codes = $c->customers
                        ->map(fn ($cu) => $cu->customer_code ?: ('C-' . str_pad((string) $cu->id, 3, '0', STR_PAD_LEFT)))
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
                'sc'      => '#0e7490',
                'sb'      => '#f0fdff',
                'country' => optional($c->primaryAddress)->country ?: '—',
                'same_as_customer' => (bool) $c->same_as_customer,
                'kyc'     => $prog['kyc'],
                'dd'      => $prog['dd'],
                'tl'      => $prog['tl'],
                /* Placeholder — overwritten below from $tdByCustomer /
                   $tdByConsignee. NOT $prog['td']: that resolves out of the
                   segment rule's doc_selections['td'], which the DCP no longer
                   stores, so it is permanently an empty set. */
                'td'      => ['d' => 0, 't' => 0],
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
        // Consignee compliance — drives the "Consignee Transactions" view in
        // the Buyer ≠ Consignee tab.
        $consProgById = [];
        foreach ($consOut as $co) $consProgById[$co['db_id']] = $co;

        $wsEq = []; $wsNeq = []; $wosEq = []; $wosNeq = [];

        /* Party-level Trade Docs, summed across the party's own deals.
         *
         * Trade Documents are a PER-DEAL document for a customer/consignee —
         * they hang off the shipment, not off the party (see the Evidence
         * Vault's own note: its trade_documents_count is the sum of each
         * shipment's trade_docs ratio). There is no party-level source to read,
         * so the list column has to be aggregated from the same per-lead figure
         * the transaction rows below already compute.
         *
         * This is why the column read 0/0 for EVERY customer: it was taking
         * $prog['td'], which resolves $union['td'] out of the segment rule's
         * doc_selections — and Trade Documents were removed from the DCP, so
         * ClmSegmentRuleController::validated() strips 'td' on every save and
         * that key is now permanently empty. */
        $tdByCustomer  = [];
        $tdByConsignee = [];
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
            // "buyer = consignee": no separate consignee, or it's flagged same_as_customer.
            $separateConsignee = $cons && !$cons->same_as_customer;

            $segIds = $leadSegIds[$lid] ?? $segIdsFromNames($cust->segment);
            $cp     = $custProgById[(int) $cust->id] ?? null;
            $pi     = $piByLead[$lid] ?? null;
            $hasShip = isset($shipLeadIds[$lid]);

            // Per-shipment Trade Docs + Agreements, party-aware, mirroring the
            // Evidence Vault: the buyer columns (td/agr) count the customer-side
            // docs, the c_* columns the consignee side. The PI is the buyer's
            // first Trade Document, so it adds 1 to the buyer Trade-Docs total
            // (and 1 signed once the PI is e-signed).
            $applicAgr = $agrIdsForSegments($segIds);
            $applicTd  = $tdIdsForSegments($segIds);
            $agrBuyer  = $docProgress($applicAgr, $agrPartyById, $agrSigByLead[$lid]['Customer'] ?? [], 'buyer');
            $tdBuyer   = $docProgress($applicTd,  $tdPartyById,  $tdSigByLead[$lid]['Customer']  ?? [], 'buyer');
            if ($pi) { $tdBuyer['t'] += 1; if (isset($piSignedIds[(int) $pi->id])) $tdBuyer['d'] += 1; }

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
                // Consignee-side compliance for the "Consignee Transactions" view.
                $cp2 = $consProgById[(int) $cons->id] ?? null;
                $base['c_kyc'] = $cp2 ? $cp2['kyc'] : ['d' => 0, 't' => 0];
                $base['c_dd']  = $cp2 ? $cp2['dd']  : ['d' => 0, 't' => 0];
                $base['c_tl']  = $cp2 ? $cp2['tl']  : ['d' => 0, 't' => 0];
                $base['c_td']  = $docProgress($applicTd,  $tdPartyById,  $tdSigByLead[$lid]['Consignee']  ?? [], 'consignee');
                $base['c_agr'] = $docProgress($applicAgr, $agrPartyById, $agrSigByLead[$lid]['Consignee'] ?? [], 'consignee');
            }

            /* Roll this deal into the party totals the two list tables show.
               The customer always gets the buyer-side figure (which already
               carries the PI as its first trade document). A SEPARATE consignee
               gets the consignee-side figure; when Customer = Consignee the
               vault displays the buyer-side set, so the consignee row mirrors
               it rather than showing 0/0. */
            $addTd($tdByCustomer, (int) $cust->id, $tdBuyer);
            if ($cons) {
                $addTd($tdByConsignee, (int) $cons->id, $separateConsignee ? $base['c_td'] : $tdBuyer);
            }

            if ($hasShip && $separateConsignee)        { $base['sr'] = ++$n['wsNeq'];  $wsNeq[]  = $base; }
            elseif ($hasShip && !$separateConsignee)   { $base['sr'] = ++$n['wsEq'];   $wsEq[]   = $base; }
            elseif (!$hasShip && $separateConsignee)   { $base['sr'] = ++$n['wosNeq']; $wosNeq[] = $base; }
            else                                       { $base['sr'] = ++$n['wosEq'];  $wosEq[]  = $base; }
        }

        /* Both lists are built before the lead loop runs, so the aggregated
           Trade-Docs figure is applied here. A party with no deals keeps 0/0 —
           correct, not a failure: per-deal documents cannot exist without a
           deal. */
        foreach ($buyers as &$b) {
            $b['td'] = $tdByCustomer[(int) $b['db_id']] ?? ['d' => 0, 't' => 0];
        }
        unset($b);
        /* Consignee → its customer, for the same_as_customer fallback below. */
        $custIdOfCons = [];
        foreach ($consignees as $cRow) {
            $first = $cRow->customers->first();
            $custIdOfCons[(int) $cRow->id] = (int) ($first->id ?? $cRow->customer_id ?? 0);
        }

        foreach ($consOut as &$co) {
            $own = $tdByConsignee[(int) $co['db_id']] ?? null;
            if ($own) { $co['td'] = $own; continue; }

            /* SAME AS CUSTOMER, with no deal of its own.
             *
             * When the consignee IS the customer there is no separate
             * consignee-side document set — the buyer's documents are the
             * consignee's, which is why the Evidence Vault shows them on this
             * party and why they "auto update" when the customer's do. The
             * lead loop already mirrors the buyer figure onto such a consignee,
             * but only for consignees that appear on a lead; one with no deal
             * yet fell through to 0/0 while its vault showed documents.
             *
             * A SEPARATE consignee keeps 0/0 here: its documents are genuinely
             * per-deal, so with no deal there is nothing to count. */
            if (!empty($co['same_as_customer'])) {
                $ownerId = $custIdOfCons[(int) $co['db_id']] ?? 0;
                $co['td'] = $tdByCustomer[$ownerId] ?? ['d' => 0, 't' => 0];
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
