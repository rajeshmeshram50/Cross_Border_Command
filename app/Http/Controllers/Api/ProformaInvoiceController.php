<?php

namespace App\Http\Controllers\Api;

use App\Support\FxRate;
use App\Http\Controllers\Concerns\EnforcesSegmentBuyerConsignee;
use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\ProformaInvoiceItem;
use App\Models\Quotation;
use App\Services\ZohoBooksService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use RuntimeException;

class ProformaInvoiceController extends Controller
{
    use EnforcesSegmentBuyerConsignee;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ProformaInvoice::query()
            ->with([
                'customer:id,customer_code,company_name',
                'consignee:id,consignee_code,company_name',
                'lead:id,opp_code,lead_stage_id,won_at',
                'sourceQuotation:id,code',
                'salesManager:id,name',
                'branch:id,name,code',
                'creator:id,name,user_type,branch_id',
                'creator.branch:id,name',
                'shipmentOrder:id,lead_id,shipment_code,created_at',
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);
        $this->applyFilters($q, $request);

        $perPage = min(max((int) $request->query('per_page', 25), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);
        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        $items    = collect($paginator->items());
        $ownerIds = $items->map(fn ($r) => (int) ($r->sales_manager_id ?: $r->created_by))
            ->filter()->unique()->values()->all();
        $mgrByOwner = empty($ownerIds) ? collect() : \App\Models\Employee::query()
            ->whereIn('user_id', $ownerIds)
            ->with(['reportingManager.user:id,name', 'reportingManagerUser:id,name'])
            ->get(['id', 'user_id', 'reporting_manager_id', 'reporting_manager_user_id'])
            ->keyBy('user_id');

        $rows = $items->map(function ($r) use ($user, $mgrByOwner) {
            $r->can_modify = $this->userCanModify($r, $user);
            $r->creator_name      = $r->creator?->name;
            $r->creator_user_type = $r->creator?->user_type;
            $emp     = $mgrByOwner->get((int) ($r->sales_manager_id ?: $r->created_by));
            $mgrName = $emp?->reportingManager?->user?->name ?? $emp?->reportingManagerUser?->name;
            if (!$mgrName && ($r->creator?->user_type === 'branch_user')) {
                $mgrName = $r->creator?->name;
            }
            $r->sales_manager_name = $mgrName ?: null;
            $stageId = (int) ($r->lead?->lead_stage_id ?? 0);
            $r->victory_reached = $stageId >= 6 || $r->lead?->won_at !== null;
            $r->shipment_code = $r->shipmentOrder?->shipment_code;
            $r->shipment_date = $r->shipmentOrder?->created_at?->toDateString();
            return $r;
        })->all();

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = ProformaInvoice::with([
            'items',
            'customer:id,customer_code,company_name',
            'consignee:id,consignee_code,company_name',
            'lead:id,opp_code',
            'sourceQuotation:id,code',
            'salesManager:id,name',
        ])->findOrFail($id);
        $this->assertScope($row, $user);
        return response()->json(['status' => true, 'data' => $row]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $data = $this->validatePayload($request);

        if (!empty($data['opp_id'])) {
            $leadRow = \App\Models\Lead::where('client_id', $user->client_id)
                ->whereKey($data['opp_id'])
                ->first(['id', 'opp_code', 'disqualified']);
            if ($leadRow && $leadRow->disqualified) {
                return response()->json([
                    'status'  => false,
                    'message' => 'This opportunity (' . ($leadRow->opp_code ?: $leadRow->id) . ') is disqualified. Re-qualify it before raising documents against it.',
                ], 422);
            }
        }

        if ($block = $this->partyDocsBlockResponse($user, $data['customer_id'] ?? null, $data['consignee_id'] ?? null)) {
            return $block;
        }

        if ($block = $this->segmentPartyBlockResponse(
            (int) $user->client_id,
            array_map(fn($it) => $it['product_id'] ?? null, $data['items']),
            $data['consignee_id'] ?? null,
        )) {
            return $block;
        }

        if (!empty($data['opp_id'])) {
            $existingPi = ProformaInvoice::where('client_id', $user->client_id)
                ->where('opp_id', $data['opp_id'])
                ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
                ->select('id', 'code', 'opp_code')
                ->first();
            if ($existingPi) {
                return response()->json([
                    'status'  => false,
                    'message' => "Opportunity {$existingPi->opp_code} already has a PI: {$existingPi->code}. Only one PI is allowed per opportunity.",
                    'existing_pi' => [
                        'id'   => $existingPi->id,
                        'code' => $existingPi->code,
                    ],
                ], 409);
            }
        }

        $items = $this->prepareItems($data['items']);
        $totals = $this->aggregateTotals($items, (float) ($data['shipping'] ?? 0));

        $row = DB::transaction(function () use ($user, $data, $items, $totals) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();

            if (!empty($data['opp_id'])) {
                $dupePi = ProformaInvoice::where('client_id', $user->client_id)
                    ->where('opp_id', $data['opp_id'])
                    ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
                    ->select('id', 'code', 'opp_code')
                    ->first();
                if ($dupePi) {
                    throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                        'status'      => false,
                        'message'     => "Opportunity {$dupePi->opp_code} already has a PI: {$dupePi->code}. Only one PI is allowed per opportunity.",
                        'existing_pi' => ['id' => $dupePi->id, 'code' => $dupePi->code],
                    ], 409));
                }
            }

            $code = $this->nextCode($user->client_id, $user->branch_id);
            $btId = !empty($data['pi_type']) && $data['pi_type'] === ProformaInvoice::TYPE_WITH_SHIPMENT
                ? ($data['bt_id'] ?? $this->nextBtCode($user->client_id))
                : null;

            [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName, $convertFromCode] =
                $this->resolveCachedLabels($data);

            $pi = ProformaInvoice::create([
                'client_id'           => $user->client_id,
                'branch_id'           => $user->branch_id,
                'code'                => $code,
                'version'             => 1,
                'pi_type'             => $data['pi_type']             ?? ProformaInvoice::TYPE_WITH_SHIPMENT,
                'bt_id'               => $btId,
                'bt_date'             => $data['bt_date']             ?? null,
                'signing_mode'        => $data['signing_mode']        ?? null,
                'source_quotation_id' => $data['source_quotation_id'] ?? null,
                'convert_from_code'   => $convertFromCode,
                'doc_type'            => $data['doc_type'],
                'opp_id'              => $data['opp_id']              ?? null,
                'opp_code'            => $oppCode,
                'opportunity_date'    => $oppDate,
                'customer_id'         => $data['customer_id'],
                'customer_name'       => $customerName,
                'consignee_id'        => $data['consignee_id']        ?? null,
                'consignee_name'      => $consigneeName,
                'bank_account_id'     => $data['bank_account_id']     ?? null,
                'bank_label'          => $bankLabel,
                'currency'            => $data['currency']            ?? null,
                'exchange_rate'       => $data['exchange_rate']       ?? null,
                'inco_term'           => $data['inco_term']           ?? null,
                'port_of_loading'     => $data['port_of_loading']     ?? null,
                'port_of_discharge'   => $data['port_of_discharge']   ?? null,
                'final_destination'   => $data['final_destination']   ?? null,
                'origin_country'      => $data['origin_country']      ?? null,
                'state_code'          => $data['state_code']          ?? null,
                'dispatch_from'       => $data['dispatch_from']       ?? null,
                'deliver_to'          => $data['deliver_to']          ?? null,
                'customer_gst_no'     => $data['customer_gst_no']     ?? null,
                'sales_manager_id'    => $data['sales_manager_id']    ?? $user->id,
                'sales_manager_name'  => $smName,
                'sub_total'           => $totals['sub_total'],
                'shipping'            => $totals['shipping'],
                'grand_total'         => $totals['grand_total'],
                'status'              => $data['status']              ?? ProformaInvoice::STATUS_DRAFT,
                'terms'               => $data['terms']               ?? null,
                'created_by'          => $user->id,
                'updated_by'          => $user->id,
            ]);

            foreach ($items as $i => $it) {
                $it['proforma_invoice_id'] = $pi->id;
                $it['line_no']             = $i + 1;
                ProformaInvoiceItem::create($it);
            }

            if (!empty($data['source_quotation_id'])) {
                Quotation::where('id', $data['source_quotation_id'])
                    ->where('client_id', $user->client_id)
                    ->update([
                        'status'     => Quotation::STATUS_CONVERTED_TO_PI,
                        'updated_by' => $user->id,
                    ]);
            }

            $this->freezeLeadConsignee($user, $data['opp_id'] ?? null, $data['consignee_id'] ?? null);

            return $pi->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    private function freezeLeadConsignee($user, $leadId, $consigneeId): void
    {
        if (empty($leadId) || empty($consigneeId)) return;
        Lead::where('id', $leadId)
            ->where('client_id', $user->client_id)
            ->update(['consignee_id' => $consigneeId]);
    }

    public function partyDocsCheck(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $customerId  = (int) $request->query('customer_id')  ?: null;
        $consigneeId = (int) $request->query('consignee_id') ?: null;

        $blocks = $this->missingPartyDocs($user, $customerId, $consigneeId);

        return response()->json([
            'status' => true,
            'data'   => [
                'ok'      => empty($blocks),
                'message' => empty($blocks) ? null : $this->partyDocsMessage($blocks),
                'pending' => array_map(
                    fn($party, $miss) => [
                        'party'     => $party,
                        'documents' => array_values(array_map(fn($d) => $d['name'], $miss)),
                    ],
                    array_keys($blocks),
                    array_values($blocks),
                ),
            ],
        ]);
    }

    private function partyDocsBlockResponse($user, ?int $customerId, ?int $consigneeId): ?JsonResponse
    {
        $blocks = $this->missingPartyDocs($user, $customerId, $consigneeId);
        if (empty($blocks)) return null;

        return response()->json([
            'status'  => false,
            'message' => $this->partyDocsMessage($blocks),
        ], 422);
    }

    private function missingPartyDocs($user, ?int $customerId, ?int $consigneeId): array
    {
        $checker = app(SegmentDocUploadController::class);
        $blocks  = [];

        $gatedCategories = ['kyc', 'dd', 'tl'];
        $onlyGated = fn(array $miss) => array_values(array_filter(
            $miss,
            fn($d) => in_array($d['category'] ?? null, $gatedCategories, true)
        ));

        $customer = $customerId
            ? Customer::where('client_id', $user->client_id)->find($customerId)
            : null;

        if ($customer) {
            $miss = $onlyGated($checker->missingMandatoryDocs($customer, 'customer'));
            if (!empty($miss)) $blocks['Customer'] = $miss;
        }
        if ($consigneeId) {
            $consignee = Consignee::where('client_id', $user->client_id)->find($consigneeId);
            if ($consignee && !$consignee->same_as_customer) {
                $miss = $onlyGated($checker->missingMandatoryDocs($consignee, 'consignee', $customer));
                if (!empty($miss)) $blocks['Consignee'] = $miss;
            }
        }

        return $blocks;
    }

    private function partyDocsMessage(array $blocks): string
    {
        $parts = [];
        foreach ($blocks as $party => $miss) {
            $names = array_slice(array_map(fn($d) => $d['name'], $miss), 0, 4);
            $extra = count($miss) > 4 ? ' +' . (count($miss) - 4) . ' more' : '';
            $parts[] = "{$party} → " . implode(', ', $names) . $extra;
        }

        return 'This Proforma Invoice can’t be created yet — some required documents are still pending. '
            . 'Please upload them from the Customer / Consignee documents panel first. Pending: '
            . implode('  |  ', $parts);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ProformaInvoice::findOrFail($id);
        $this->assertScope($row, $user, 'write');
        if (!empty($row->zoho_invoice_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This proforma invoice is synced to Zoho Books (invoice ' . ($row->zoho_invoice_number ?: $row->zoho_invoice_id) . ') and can no longer be edited — edit it in Zoho Books instead.',
            ], 422);
        }
        if ($row->status === ProformaInvoice::STATUS_CONVERTED_TO_CONTRACT) {
            return response()->json([
                'status'  => false,
                'message' => 'This PI has already been converted to a contract. Duplicate it to make changes.',
            ], 409);
        }

        if (\App\Models\ClmSignatureRequest::hasSignedForDoc(
            $user->client_id,
            \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE,
            $row->id,
        )) {
            return response()->json([
                'status'  => false,
                'message' => 'This PI has already been signed and can no longer be edited. Duplicate it to make changes.',
            ], 409);
        }

        $awaiting = \App\Models\ClmSignatureRequest::awaitingSignatureForDoc(
            $user->client_id,
            \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE,
            $row->id,
        );
        if ($awaiting) {
            return response()->json([
                'status'  => false,
                'message' => 'This PI has been sent for signature and is awaiting a response, so it can no longer be edited. '
                    . 'Recall the signature request first if the document needs to change.',
                'data'    => ['signature_request_id' => $awaiting->id],
            ], 409);
        }

        $data  = $this->validatePayload($request);

        if (
            $row->source_quotation_id
            && array_key_exists('currency', $data)
            && $data['currency'] !== null
            && $data['currency'] !== $row->currency
        ) {
            return response()->json([
                'status'  => false,
                'message' => "This PI was created from a quotation and is locked to {$row->currency}. Use a fresh PI to invoice in a different currency.",
            ], 422);
        }
        $items = $this->prepareItems($data['items']);
        $totals = $this->aggregateTotals($items, (float) ($data['shipping'] ?? 0));

        DB::transaction(function () use ($user, $row, $data, $items, $totals) {
            [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName, $convertFromCode] =
                $this->resolveCachedLabels($data);

            $effectiveType = $data['pi_type'] ?? $row->pi_type;
            $isWithShipment = $effectiveType === ProformaInvoice::TYPE_WITH_SHIPMENT;

            $row->update([
                'pi_type'             => $effectiveType,
                'bt_id'               => $isWithShipment ? ($data['bt_id']   ?? $row->bt_id)   : null,
                'bt_date'             => $isWithShipment ? ($data['bt_date'] ?? $row->bt_date) : null,
                'signing_mode'        => $data['signing_mode']      ?? $row->signing_mode,
                'doc_type'            => $data['doc_type'],
                'opp_id'              => $data['opp_id']            ?? null,
                'opp_code'            => $oppCode,
                'opportunity_date'    => $oppDate,
                'customer_id'         => $data['customer_id'],
                'customer_name'       => $customerName,
                'consignee_id'        => $data['consignee_id']      ?? null,
                'consignee_name'      => $consigneeName,
                'bank_account_id'     => $data['bank_account_id']   ?? null,
                'bank_label'          => $bankLabel,
                'currency'            => $data['currency']          ?? null,
                'exchange_rate'       => $data['exchange_rate']     ?? null,
                'inco_term'           => $data['inco_term']         ?? null,
                'port_of_loading'     => $data['port_of_loading']   ?? null,
                'port_of_discharge'   => $data['port_of_discharge'] ?? null,
                'final_destination'   => $data['final_destination'] ?? null,
                'origin_country'      => $data['origin_country']    ?? null,
                'state_code'          => $data['state_code']        ?? null,
                'dispatch_from'       => $data['dispatch_from']     ?? null,
                'deliver_to'          => $data['deliver_to']        ?? null,
                'customer_gst_no'     => $data['customer_gst_no']   ?? null,
                'sales_manager_id'    => $data['sales_manager_id']  ?? $row->sales_manager_id,
                'sales_manager_name'  => $smName ?: $row->sales_manager_name,
                'sub_total'           => $totals['sub_total'],
                'shipping'            => $totals['shipping'],
                'grand_total'         => $totals['grand_total'],
                'status'              => $data['status']            ?? $row->status,
                'terms'               => $data['terms']             ?? $row->terms,
                'convert_from_code'   => $convertFromCode ?? $row->convert_from_code,
                'version'             => $row->version + 1,
                'updated_by'          => $user->id,
            ]);

            $row->items()->delete();
            foreach ($items as $i => $it) {
                $it['proforma_invoice_id'] = $row->id;
                $it['line_no']             = $i + 1;
                ProformaInvoiceItem::create($it);
            }
        });

        \App\Models\ClmSignatureRequest::supersedeForDoc(
            $user->client_id,
            \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE,
            $row->id,
        );

        return response()->json(['status' => true, 'data' => $row->fresh(['items'])]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = ProformaInvoice::findOrFail($id);
        $this->assertScope($row, $user, 'write');
        if (!empty($row->zoho_invoice_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This proforma invoice is synced to Zoho Books and cannot be cancelled here — void the invoice in Zoho Books first.',
            ], 422);
        }
        if ($row->status === ProformaInvoice::STATUS_CONVERTED_TO_CONTRACT) {
            return response()->json([
                'status'  => false,
                'message' => 'This PI has been converted to a contract and cannot be cancelled.',
            ], 409);
        }
        $row->update(['status' => ProformaInvoice::STATUS_CANCELLED, 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'message' => 'Cancelled']);
    }

    public function duplicate(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $src = ProformaInvoice::with('items')->findOrFail($id);
        $this->assertScope($src, $user);

        $clone = DB::transaction(function () use ($user, $src) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $newCode = $this->nextCode($user->client_id, $src->branch_id);
            $copy = $src->replicate(['code', 'status', 'version', 'created_by', 'updated_by']);
            $copy->code        = $newCode;
            $copy->status      = ProformaInvoice::STATUS_DRAFT;
            $copy->version     = 1;
            $copy->created_by  = $user->id;
            $copy->updated_by  = $user->id;
            $copy->save();
            foreach ($src->items as $it) {
                $li = $it->replicate(['proforma_invoice_id']);
                $li->proforma_invoice_id = $copy->id;
                $li->save();
            }
            return $copy->fresh(['items']);
        });
        return response()->json(['status' => true, 'data' => $clone], 201);
    }

    public function fromQuotation(Request $request, $quotationId): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $qt = Quotation::with('items')->findOrFail($quotationId);
        $this->assertQuotationScope($qt, $user);

        if ($qt->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status'  => false,
                'message' => 'This quotation is already converted to a PI.',
            ], 409);
        }
        if ($qt->status === Quotation::STATUS_CANCELLED) {
            return response()->json([
                'status'  => false,
                'message' => 'Cancelled quotations cannot be converted.',
            ], 409);
        }

        if ($qt->opp_id) {
            $existingPi = ProformaInvoice::where('client_id', $user->client_id)
                ->where('opp_id', $qt->opp_id)
                ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
                ->select('id', 'code', 'source_quotation_id')
                ->first();
            if ($existingPi) {
                $sourceLabel = $existingPi->source_quotation_id
                    ? " (converted from quotation #{$existingPi->source_quotation_id})"
                    : '';
                return response()->json([
                    'status'  => false,
                    'message' => "Opportunity {$qt->opp_code} already has a PI: {$existingPi->code}{$sourceLabel}. Only one PI is allowed per opportunity.",
                    'existing_pi' => [
                        'id'   => $existingPi->id,
                        'code' => $existingPi->code,
                    ],
                ], 409);
            }
        }

        if ($block = $this->partyDocsBlockResponse($user, $qt->customer_id, $qt->consignee_id)) {
            return $block;
        }

        if ($block = $this->segmentPartyBlockResponse(
            (int) $user->client_id,
            $qt->items()->pluck('product_id')->all(),
            $qt->consignee_id,
        )) {
            return $block;
        }

        $pi = DB::transaction(function () use ($user, $qt) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();

            $freshQt = Quotation::where('id', $qt->id)->first();
            if ($freshQt && in_array($freshQt->status, [Quotation::STATUS_CONVERTED_TO_PI, Quotation::STATUS_CANCELLED], true)) {
                throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                    'status'  => false,
                    'message' => 'This quotation has already been converted (or cancelled) — refresh to see the current state.',
                ], 409));
            }
            if ($qt->opp_id) {
                $dupePi = ProformaInvoice::where('client_id', $user->client_id)
                    ->where('opp_id', $qt->opp_id)
                    ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
                    ->select('id', 'code')
                    ->first();
                if ($dupePi) {
                    throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                        'status'      => false,
                        'message'     => "Opportunity {$qt->opp_code} already has a PI: {$dupePi->code}. Only one PI is allowed per opportunity.",
                        'existing_pi' => ['id' => $dupePi->id, 'code' => $dupePi->code],
                    ], 409));
                }
            }

            $code = $this->nextCode($user->client_id, $user->branch_id);
            $btId = $this->nextBtCode($user->client_id);

            $pi = ProformaInvoice::create([
                'client_id'           => $user->client_id,
                'branch_id'           => $user->branch_id,
                'code'                => $code,
                'version'             => 1,
                'pi_type'             => ProformaInvoice::TYPE_WITH_SHIPMENT,
                'bt_id'               => $btId,
                'bt_date'             => now()->toDateString(),
                'signing_mode'        => null,
                'source_quotation_id' => $qt->id,
                'convert_from_code'   => $qt->code,
                'doc_type'            => $qt->doc_type,
                'opp_id'              => $qt->opp_id,
                'opp_code'            => $qt->opp_code,
                'opportunity_date'    => $qt->opportunity_date,
                'customer_id'         => $qt->customer_id,
                'customer_name'       => $qt->customer_name,
                'consignee_id'        => $qt->consignee_id,
                'consignee_name'      => $qt->consignee_name,
                'bank_account_id'     => $qt->bank_account_id,
                'bank_label'          => $qt->bank_label,
                'currency'            => $qt->currency,
                'exchange_rate'       => $qt->exchange_rate,
                'inco_term'           => $qt->inco_term,
                'port_of_loading'     => $qt->port_of_loading,
                'port_of_discharge'   => $qt->port_of_discharge,
                'final_destination'   => $qt->final_destination,
                'origin_country'      => $qt->origin_country,
                'state_code'          => $qt->state_code,
                'dispatch_from'       => $qt->dispatch_from,
                'deliver_to'          => $qt->deliver_to,
                'customer_gst_no'     => $qt->customer_gst_no,
                'sales_manager_id'    => $qt->sales_manager_id,
                'sales_manager_name'  => $qt->sales_manager_name,
                'sub_total'           => $qt->sub_total,
                'shipping'            => $qt->shipping,
                'grand_total'         => $qt->grand_total,
                'status'              => ProformaInvoice::STATUS_DRAFT,
                'terms'               => $qt->terms,
                'created_by'          => $user->id,
                'updated_by'          => $user->id,
            ]);

            foreach ($qt->items as $i => $it) {
                ProformaInvoiceItem::create([
                    'proforma_invoice_id' => $pi->id,
                    'product_id'          => $it->product_id,
                    'product_name'        => $it->product_name,
                    'hsn_code'            => $it->hsn_code,
                    'quantity'            => $it->quantity,
                    'unit'                => $it->unit,
                    'rate'                => $it->rate,
                    'tax_pct'             => $it->tax_pct,
                    'amount'              => $it->amount,
                    'line_no'             => $i + 1,
                ]);
            }

            $qt->update([
                'status'     => Quotation::STATUS_CONVERTED_TO_PI,
                'updated_by' => $user->id,
            ]);

            $this->freezeLeadConsignee($user, $qt->opp_id, $qt->consignee_id);

            return $pi->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $pi], 201);
    }

    private function validatePayload(Request $request): array
    {
        $docType = $request->input('doc_type', ProformaInvoice::DOC_INTERNATIONAL);

        if ($docType === ProformaInvoice::DOC_DOMESTIC) {
            $request->merge(['currency' => 'INR']);
        }

        $rules = [
            'pi_type'            => ['nullable', Rule::in(ProformaInvoice::TYPES)],
            'bt_id'              => 'nullable|string|max:24',
            'bt_date'            => 'nullable|date',
            'signing_mode'       => ['nullable', Rule::in(ProformaInvoice::SIGN_MODES)],
            'source_quotation_id' => 'nullable|integer|exists:quotations,id',
            'doc_type'           => ['required', Rule::in(ProformaInvoice::DOC_TYPES)],
            'opp_id'             => 'nullable|integer|exists:leads,id',
            'customer_id'        => 'required|integer|exists:customers,id',
            'consignee_id'       => 'nullable|integer|exists:consignees,id',
            'bank_account_id'    => 'nullable|integer',
            'currency'           => 'nullable|string',
            'exchange_rate'      => FxRate::rules(),
            'sales_manager_id'   => 'nullable|integer|exists:users,id',
            'shipping'           => 'nullable|numeric|min:0',
            'terms'              => 'nullable|string|max:8000',
            'status'             => ['nullable', Rule::in(ProformaInvoice::STATUSES)],
            'items'              => 'required|array|min:1',
            'items.*.product_id'   => 'nullable|integer',
            'items.*.product_name' => 'required|string|max:255',
            'items.*.hsn_code'     => 'nullable|string|max:16',
            'items.*.quantity'     => 'required|numeric|min:0.0001',
            'items.*.unit'         => 'nullable|string|max:16',
            'items.*.rate'         => 'required|numeric|min:0',
            'items.*.tax_pct'      => 'nullable|numeric|min:0',

            'customer_gst_no'      => 'nullable|string|max:20',
        ];

        if ($docType === ProformaInvoice::DOC_INTERNATIONAL) {
            $rules['inco_term']         = 'required|string|max:100';
            $rules['port_of_loading']   = 'required|string|max:128';
            $rules['port_of_discharge'] = 'required|string|max:128';
            $rules['final_destination'] = 'required|string|max:128';
            $rules['origin_country']    = 'required|string|max:64';
            $rules['state_code']        = 'nullable|string|max:64';
            $rules['dispatch_from']     = 'nullable|string|max:255';
            $rules['deliver_to']        = 'nullable|string|max:255';
        } else {
            $rules['state_code']        = 'required|string|max:64';
            $rules['dispatch_from']     = 'required|string|max:255';
            $rules['deliver_to']        = 'required|string|max:255';
            $rules['inco_term']         = 'nullable|string|max:100';
            $rules['port_of_loading']   = 'nullable|string|max:128';
            $rules['port_of_discharge'] = 'nullable|string|max:128';
            $rules['final_destination'] = 'nullable|string|max:128';
            $rules['origin_country']    = 'nullable|string|max:64';
        }

        return $request->validate($rules);
    }

    private function prepareItems(array $items): array
    {
        return array_map(function ($it) {
            $qty  = (float) ($it['quantity']  ?? 0);
            $rate = (float) ($it['rate']      ?? 0);
            $tax  = (float) ($it['tax_pct']   ?? 0);
            return [
                'product_id'   => $it['product_id']   ?? null,
                'product_name' => trim((string) ($it['product_name'] ?? '')),
                'hsn_code'     => $it['hsn_code']     ?? null,
                'quantity'     => $qty,
                'unit'         => $it['unit']         ?? null,
                'rate'         => $rate,
                'tax_pct'      => $tax,
                'amount'       => ProformaInvoiceItem::computeAmount($qty, $rate, $tax),
            ];
        }, $items);
    }

    private function aggregateTotals(array $items, float $shipping): array
    {
        $rawSub = 0.0;
        foreach ($items as $it) {
            $qty  = (float) ($it['quantity'] ?? 0);
            $rate = (float) ($it['rate']     ?? 0);
            $tax  = (float) ($it['tax_pct']  ?? 0);
            $rawSub += $qty * $rate * (1 + ($tax / 100));
        }
        $rawGrand = $rawSub + $shipping;
        return [
            'sub_total'   => round($rawSub, 2),
            'shipping'    => round($shipping, 2),
            'grand_total' => round($rawGrand, 2),
        ];
    }

    private function resolveCachedLabels(array &$data): array
    {
        $customerName = $consigneeName = $oppCode = $oppDate = $bankLabel = $smName = $convertFrom = null;

        if (!empty($data['customer_id'])) {
            $customerName = DB::table('customers')->where('id', $data['customer_id'])->value('company_name');
        }
        if (!empty($data['consignee_id'])) {
            $consigneeName = DB::table('consignees')->where('id', $data['consignee_id'])->value('company_name');
        }
        if (!empty($data['opp_id'])) {
            $l = DB::table('leads')->where('id', $data['opp_id'])
                ->select('opp_code', 'query_time', 'salesperson_id')->first();
            if ($l) {
                $oppCode = $l->opp_code;
                $oppDate = $l->query_time ? date('Y-m-d', strtotime($l->query_time)) : null;
                if (empty($data['sales_manager_id']) && $l->salesperson_id) {
                    $data['sales_manager_id'] = (int) $l->salesperson_id;
                }
            }
        }
        if (!empty($data['bank_account_id'])) {
            $b = DB::table('master_bank_accounts')->where('id', $data['bank_account_id'])
                ->select('bank_name', 'account_holder')->first();
            if ($b) {
                $bankLabel = $b->account_holder
                    ? $b->bank_name . ' (' . $b->account_holder . ')'
                    : $b->bank_name;
            }
        }
        if (!empty($data['sales_manager_id'])) {
            $smName = DB::table('users')->where('id', $data['sales_manager_id'])->value('name');
        }
        if (!empty($data['source_quotation_id'])) {
            $convertFrom = DB::table('quotations')->where('id', $data['source_quotation_id'])->value('code');
        }

        return [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName, $convertFrom];
    }

    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = null;
        if ($user && $user->client_id) {
            $fy = $this->currentFinancialYear();
            $branchId = $user->branch_id;
            $codes = ProformaInvoice::where('client_id', $user->client_id)
                ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
                ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
                ->where(function ($qq) use ($fy) {
                    $qq->where('code', 'like', "PI/{$fy}/%")
                       ->orWhere('code', 'like', "INV/{$fy}/%");
                })
                ->pluck('code')->all();
            $max = 0;
            foreach ($codes as $c) {
                if (preg_match('#^(?:PI|INV)/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                    $n = (int) $m[1];
                    if ($n > $max) $max = $n;
                }
            }
            $code = "PI/{$fy}/" . ($max + 1);
        }
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        $fy = $this->currentFinancialYear();
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("pi-code:{$clientId}:" . ($branchId ?? 0) . ":{$fy}")]);
        }
        $codes = ProformaInvoice::where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->where(function ($qq) use ($fy) {
                $qq->where('code', 'like', "PI/{$fy}/%")
                   ->orWhere('code', 'like', "INV/{$fy}/%");
            })
            ->pluck('code')->all();
        $max = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('#^(?:PI|INV)/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do {
            $n++;
            $code = "PI/{$fy}/{$n}";
        } while (isset($taken[$code]));
        return $code;
    }

    private function nextBtCode(int $clientId): string
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("pi-bt:{$clientId}")]);
        }
        $codes = ProformaInvoice::where('client_id', $clientId)
            ->whereNotNull('bt_id')
            ->pluck('bt_id')->all();
        $max = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^BT-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do {
            $n++;
            $code = sprintf('BT-%04d', $n);
        } while (isset($taken[$code]));
        return $code;
    }

    private function currentFinancialYear(): string
    {
        $now = now();
        $startYear = (int) $now->format('Y');
        if ((int) $now->format('n') < 4) $startYear -= 1;
        $endShort = str_pad((string) (($startYear + 1) % 100), 2, '0', STR_PAD_LEFT);
        return "{$startYear}-{$endShort}";
    }

    public function sync(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $pi = ProformaInvoice::with('items')->findOrFail($id);
        $this->assertScope($pi, $user, 'write');

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again.'], 503);
        }

        $lock = Cache::lock('zoho:sync:pi:' . $pi->id, 120);
        if (!$lock->get()) {
            return response()->json(['status' => false, 'message' => 'A Zoho sync for this proforma invoice is already in progress — try again in a moment.'], 409);
        }
        try {
            $pi->refresh();
            if (!empty($pi->zoho_invoice_id)) {
                return response()->json(['status' => true, 'message' => 'This proforma invoice is already synced to Zoho Books (invoice ' . ($pi->zoho_invoice_number ?: $pi->zoho_invoice_id) . ').', 'data' => $this->shapeZoho($pi)]);
            }
            if (!$pi->customer_id) {
                return response()->json(['status' => false, 'message' => 'Attach a customer to this proforma invoice before syncing to Zoho Books.'], 422);
            }
            if ($pi->items->isEmpty()) {
                return response()->json(['status' => false, 'message' => 'Add at least one product line before syncing to Zoho Books.'], 422);
            }

            try {
                $customer = Customer::where('id', $pi->customer_id)->where('client_id', $pi->client_id)->first();
                if (!$customer) {
                    return response()->json(['status' => false, 'message' => 'The linked customer could not be found for this proforma invoice.'], 422);
                }
                $gstin      = $pi->customer_gst_no ?: ($customer->gst_number ?: null);
                $stateCode  = $pi->state_code ?: null;
                $registered = (bool) $gstin;

                $orgState   = $books->orgStateCode() ?: $this->homeStateCode($pi->branch_id);
                $partyState = \App\Services\ZohoBooksService::normStateCode($stateCode);
                $interState = $registered && $partyState !== null && $partyState !== \App\Services\ZohoBooksService::normStateCode($orgState);

                $zohoCustomerId = $books->findOrCreateCustomerId($customer, $gstin, $stateCode);
                $inv   = $books->createInvoice($this->buildZohoInvoicePayload($pi, $books, $zohoCustomerId, $interState, $registered ? $books->placeOfSupply($stateCode) : null));
                $invId = (string) $inv['invoice_id'];

                $pdfPath = null;
                try {
                    $rel = 'zoho/invoice/' . $pi->client_id . '/' . ($pi->branch_id ?: 0) . '/INV-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($pi->code ?: $pi->id)) . '.pdf';
                    Storage::disk('public')->put($rel, $books->getInvoicePdf($invId));
                    $pdfPath = '/storage/' . $rel;
                } catch (\Throwable $e) {
                    Log::warning('Zoho invoice PDF cache failed', ['pi' => $pi->id, 'err' => $e->getMessage()]);
                }

                $pi->update([
                    'zoho_status'         => 'Sync',
                    'zoho_invoice_id'     => $invId,
                    'zoho_invoice_number' => $inv['invoice_number'] ?? null,
                    'zoho_synced_at'      => now(),
                    'zoho_error'          => null,
                    'zoho_pdf_path'       => $pdfPath,
                    'updated_by'          => $user->id,
                ]);

                return response()->json(['status' => true, 'message' => 'Synced to Zoho Books as invoice ' . ($inv['invoice_number'] ?? $invId) . '.', 'data' => $this->shapeZoho($pi->fresh())]);
            } catch (RuntimeException $e) {
                $pi->update(['zoho_status' => 'Not Sync', 'zoho_error' => $e->getMessage(), 'updated_by' => $user->id]);
                return response()->json(['status' => false, 'message' => $e->getMessage()], 422);
            }
        } finally {
            $lock->release();
        }
    }

    public function zohoPdf(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $pi = ProformaInvoice::findOrFail($id);
        $this->assertScope($pi, $user);
        if (!$pi->zoho_pdf_path) abort(404, 'No Zoho invoice PDF cached for this proforma invoice.');
        $rel = ltrim(str_replace('/storage/', '', $pi->zoho_pdf_path), '/');
        if (!Storage::disk('public')->exists($rel)) abort(404, 'Zoho invoice PDF file missing.');
        return response(Storage::disk('public')->get($rel), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ZOHO-INV-' . ($pi->code ?: $pi->id) . '.pdf"',
        ]);
    }

    private function buildZohoInvoicePayload(ProformaInvoice $pi, ZohoBooksService $books, string $zohoCustomerId, bool $interState, ?string $placeOfSupply = null): array
    {
        $lineItems = $pi->items->map(function ($it) use ($books, $interState) {
            $name = (string) ($it->product_name ?: 'Item');
            $rate = (float) $it->rate;
            $taxId = $books->resolveTaxId((float) $it->tax_pct, $interState);
            $line = [
                'item_id'  => $books->findOrCreateItemId($name, $rate, $taxId, $it->product_id),
                'name'     => $name,
                'rate'     => $rate,
                'quantity' => (float) $it->quantity,
            ];
            if (!empty($it->hsn_code)) $line['hsn_or_sac'] = (string) $it->hsn_code;
            if ($taxId) $line['tax_id'] = $taxId;
            return $line;
        })->values()->all();

        $payload = [
            'customer_id'      => $zohoCustomerId,
            'date'             => now()->toDateString(),
            'reference_number' => (string) $pi->code,
            'line_items'       => $lineItems,
        ];
        if ($placeOfSupply) $payload['place_of_supply'] = $placeOfSupply;
        if ((float) $pi->shipping != 0.0) $payload['shipping_charge'] = (float) $pi->shipping;
        if ($ccyId = $books->resolveCurrencyId($pi->currency)) {
            $payload['currency_id'] = $ccyId;
            if ((float) $pi->exchange_rate > 0) $payload['exchange_rate'] = (float) $pi->exchange_rate;
        }
        return $payload;
    }

    private function shapeZoho(ProformaInvoice $pi): array
    {
        return [
            'id' => $pi->id,
            'code' => $pi->code,
            'zoho' => $pi->zoho_status === 'Sync' ? 'sync' : 'not',
            'zohoInvoice' => $pi->zoho_invoice_number,
            'zohoPdf' => $pi->zoho_pdf_path ? true : false,
        ];
    }

    private function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? \App\Models\Branch::find($branchId) : null;
        $code = optional($branch)->gst_state_code ?: substr((string) optional($branch)->gst_number, 0, 2);
        return $code !== '' && $code !== null ? (string) $code : '27';
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }
        if (!$user->client_id) {
            $q->whereRaw('1 = 0');
            return;
        }
        $q->where('client_id', $user->client_id);

        if (!\App\Support\SalesVisibility::pinnedToOwnBranch($user)) {
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            \App\Support\SalesVisibility::applyToSalesDocs($q, $user);
            return;
        }

        $q->where('branch_id', $user->branch_id);
        \App\Support\SalesVisibility::applyToSalesDocs($q, $user);
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = \App\Models\Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function assertScope(ProformaInvoice $row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);

        if (!\App\Support\SalesVisibility::pinnedToOwnBranch($user)) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;

        abort(404);
    }

    private function assertQuotationScope(Quotation $row, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);

        if (!\App\Support\SalesVisibility::pinnedToOwnBranch($user)) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;

        abort(404);
    }

    private function userCanModify(ProformaInvoice $row, $user): bool
    {
        if ($user->user_type === 'super_admin') return true;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) return false;
        if (!\App\Support\SalesVisibility::pinnedToOwnBranch($user)) return true;
        return (int) $row->branch_id === (int) $user->branch_id;
    }

    private function applyFilters($q, Request $request): void
    {
        if ($v = $request->query('status')) {
            $q->where('status', $v);
        } else {
            $q->where('status', '!=', ProformaInvoice::STATUS_CANCELLED);
        }
        if ($v = $request->query('pi_type'))      $q->where('pi_type', $v);
        if ($v = $request->query('doc_type'))     $q->where('doc_type', $v);
        if ($v = $request->query('customer_id'))  $q->where('customer_id', (int) $v);
        if ($v = $request->query('opp_id'))       $q->where('opp_id', (int) $v);

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $q->whereBetween('created_at', [
                $request->query('start_date') . ' 00:00:00',
                $request->query('end_date')   . ' 23:59:59',
            ]);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = "%{$search}%";
            $q->where(function ($w) use ($like) {
                $w->where('code',            'ilike', $like)
                    ->orWhere('bt_id',         'ilike', $like)
                    ->orWhere('opp_code',      'ilike', $like)
                    ->orWhere('customer_name', 'ilike', $like)
                    ->orWhere('consignee_name', 'ilike', $like)
                    ->orWhere('convert_from_code', 'ilike', $like);
            });
        }
    }
}
