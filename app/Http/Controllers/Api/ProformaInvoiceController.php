<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProformaInvoice;
use App\Models\ProformaInvoiceItem;
use App\Models\Quotation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class ProformaInvoiceController extends Controller
{
    /* ── LIST ───────────────────────────────────────────────── */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ProformaInvoice::query()
            ->with([
                'customer:id,customer_code,company_name',
                'consignee:id,consignee_code,company_name',
                // lead_stage_id + won_at drive the "With Shipment" vs
                // "Without Shipment" split — a PI only belongs in the
                // With-Shipment tab once its opportunity reached the
                // Victory Stage (lead_stage_id === 6 or won_at set).
                'lead:id,opp_code,lead_stage_id,won_at',
                'sourceQuotation:id,code',
                'salesManager:id,name',
                // Branch name + is_main flag for the BRANCH column in
                // the QPI list (lets multi-branch users identify the
                // record's owning branch at a glance).
                'branch:id,name,code,is_main',
                // Creator (+ creator's branch) drives the "Created By"
                // column. Mirrors the Master Details pattern.
                'creator:id,name,user_type,branch_id',
                'creator.branch:id,is_main',
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user);
        $this->applyFilters($q, $request);

        $perPage = min(max((int) $request->query('per_page', 25), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);
        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        // Stamp per-row `can_modify` — mirrors the Quotation API. Drives
        // the frontend's edit/delete/email/reminder enable-state on rows
        // visible-but-read-only (main-branch rows seen by normal users).
        $rows = collect($paginator->items())->map(function ($r) use ($user) {
            $r->can_modify = $this->userCanModify($r, $user);
            // Flatten creator info for the "Created By" column — same
            // shape as the Quotation list.
            $r->creator_name           = $r->creator?->name;
            $r->creator_user_type      = $r->creator?->user_type;
            $r->creator_branch_is_main = (bool) ($r->creator?->branch?->is_main);
            // Victory-stage gate — the opportunity behind this PI has
            // crossed Stage 6 (Victory Stage) when EITHER lead_stage_id
            // is at-or-past 6, OR won_at is stamped. Either signal flips
            // the PI into the With-Shipment bucket; anything earlier
            // stays Without-Shipment until the deal closes.
            $stageId = (int) ($r->lead?->lead_stage_id ?? 0);
            $r->victory_reached = $stageId >= 6 || $r->lead?->won_at !== null;
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

    /* ── SHOW ───────────────────────────────────────────────── */
    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = ProformaInvoice::with([
            'items', 'customer:id,customer_code,company_name',
            'consignee:id,consignee_code,company_name',
            'lead:id,opp_code', 'sourceQuotation:id,code',
            'salesManager:id,name',
        ])->findOrFail($id);
        $this->assertScope($row, $user);
        return response()->json(['status' => true, 'data' => $row]);
    }

    /* ── CREATE ─────────────────────────────────────────────── */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $data = $this->validatePayload($request);

        // One-PI-per-opportunity rule. Skip when no opp_id is supplied
        // (general PIs without an upstream opportunity stay unlimited).
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
            $code = $this->nextCode($user->client_id);
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

            // If this PI came from a Quotation, flip the quotation's
            // status so the list/UI reflects the conversion.
            if (!empty($data['source_quotation_id'])) {
                Quotation::where('id', $data['source_quotation_id'])
                    ->where('client_id', $user->client_id)
                    ->update([
                        'status'     => Quotation::STATUS_CONVERTED_TO_PI,
                        'updated_by' => $user->id,
                    ]);
            }

            return $pi->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    /* ── UPDATE ─────────────────────────────────────────────── */
    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = ProformaInvoice::findOrFail($id);
        $this->assertScope($row, $user, 'write');
        if ($row->status === ProformaInvoice::STATUS_CONVERTED_TO_CONTRACT) {
            return response()->json([
                'status'  => false,
                'message' => 'This PI has already been converted to a contract. Duplicate it to make changes.',
            ], 409);
        }

        $data  = $this->validatePayload($request);

        /* B32: a PI created from a quotation must keep the source quote's
         * currency. The items still hold quote-era prices in that currency;
         * letting the user flip to USD here would render totals in the new
         * currency while the line items keep INR (or vice-versa), creating
         * a customer-visible discrepancy. The check is INSIDE update() so
         * the validator's other rules still pass — we just early-out before
         * the write if the currency changed AND a source quote is locked. */
        if ($row->source_quotation_id
            && array_key_exists('currency', $data)
            && $data['currency'] !== null
            && $data['currency'] !== $row->currency) {
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

            // Resolve the effective pi_type for THIS update so the BT
            // fields can be cleared in lock-step when the user flips
            // from with_shipment → without_shipment. Without this,
            // the old BT-NNN code stays on the row and corrupts both
            // the table display and the printed PDF.
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

        return response()->json(['status' => true, 'data' => $row->fresh(['items'])]);
    }

   
    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = ProformaInvoice::findOrFail($id);
        $this->assertScope($row, $user, 'write');
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
            $newCode = $this->nextCode($user->client_id);
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

        // Business rule: an opportunity (lead) can have many quotations
        // but exactly ONE Proforma Invoice. If this quotation has an
        // opp_id and some other (non-cancelled) PI already exists for
        // that same opp, block the conversion and tell the user which
        // PI is blocking it so they can resolve manually.
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

        $pi = DB::transaction(function () use ($user, $qt) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id);
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

            // Mark the quotation as converted so it disappears from the
            // "ready to convert" bucket but stays visible in history.
            $qt->update([
                'status'     => Quotation::STATUS_CONVERTED_TO_PI,
                'updated_by' => $user->id,
            ]);

            return $pi->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $pi], 201);
    }

   
    private function validatePayload(Request $request): array
    {
        $docType = $request->input('doc_type', ProformaInvoice::DOC_INTERNATIONAL);

        $rules = [
            'pi_type'            => ['nullable', Rule::in(ProformaInvoice::TYPES)],
            'bt_id'              => 'nullable|string|max:24',
            'bt_date'            => 'nullable|date',
            'signing_mode'       => ['nullable', Rule::in(ProformaInvoice::SIGN_MODES)],
            'source_quotation_id'=> 'nullable|integer|exists:quotations,id',
            'doc_type'           => ['required', Rule::in(ProformaInvoice::DOC_TYPES)],
            'opp_id'             => 'nullable|integer|exists:leads,id',
            'customer_id'        => 'required|integer|exists:customers,id',
            'consignee_id'       => 'nullable|integer|exists:consignees,id',
            'bank_account_id'    => 'nullable|integer',
            // No length cap on currency — free-form code (USD, INR, EUR…).
            'currency'           => 'nullable|string',
            'exchange_rate'      => 'nullable|numeric|min:0',
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
            // No upper cap on tax_pct — handles cess-stacked rates (>100%
            // possible for compound taxes or special-jurisdiction surcharges).
            'items.*.tax_pct'      => 'nullable|numeric|min:0',
        ];

        if ($docType === ProformaInvoice::DOC_INTERNATIONAL) {
            // INCO Term stores the full master label (e.g. "CIP – Carriage
            // and Insurance Paid"), so it isn't a short 16-char code.
            $rules['inco_term']         = 'required|string|max:100';
            $rules['port_of_loading']   = 'required|string|max:128';
            $rules['port_of_discharge'] = 'required|string|max:128';
            $rules['final_destination'] = 'required|string|max:128';
            $rules['origin_country']    = 'required|string|max:64';
            $rules['state_code']        = 'nullable|string|max:64';
        } else {
            $rules['state_code']        = 'required|string|max:64';
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

    /**
     * Same shape as QuotationController::resolveCachedLabels — and like
     * that one, takes $data by reference so the lead's salesperson can
     * be injected as the default sales_manager_id when none was sent.
     *
     * @return array{0:?string,1:?string,2:?string,3:?string,4:?string,5:?string,6:?string}
     */
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

  
    /**
     * Read-only preview of the next PI code for the Create form's "PI ID"
     * pill — INV/{FY}/{SEQ}, no advisory lock, never consumes a number.
     */
    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = null;
        if ($user && $user->client_id) {
            $fy = $this->currentFinancialYear();
            $codes = ProformaInvoice::where('client_id', $user->client_id)
                ->where('code', 'like', "INV/{$fy}/%")
                ->pluck('code')->all();
            $max = 0;
            foreach ($codes as $c) {
                if (preg_match('#^INV/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                    $n = (int) $m[1];
                    if ($n > $max) $max = $n;
                }
            }
            $code = "INV/{$fy}/" . ($max + 1);
        }
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    private function nextCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();
        // B20: defense-in-depth advisory lock — see QuotationController::nextCode.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("pi-code:{$clientId}:{$fy}")]);
        }
        $codes = ProformaInvoice::where('client_id', $clientId)
            ->where('code', 'like', "INV/{$fy}/%")
            ->pluck('code')->all();
        $max = 0; $taken = [];
        foreach ($codes as $c) {
            if (preg_match('#^INV/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do { $n++; $code = "INV/{$fy}/{$n}"; } while (isset($taken[$code]));
        return $code;
    }

   
    private function nextBtCode(int $clientId): string
    {
        // B20: defense-in-depth advisory lock for BT sequence.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [crc32("pi-bt:{$clientId}")]);
        }
        $codes = ProformaInvoice::where('client_id', $clientId)
            ->whereNotNull('bt_id')
            ->pluck('bt_id')->all();
        $max = 0; $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^BT-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do { $n++; $code = sprintf('BT-%04d', $n); } while (isset($taken[$code]));
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

  
    private function applyScope($q, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id) {
            $q->whereRaw('1 = 0');
            return;
        }
        $q->where('client_id', $user->client_id);

        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ($user->branch && (bool) $user->branch->is_main) return;

        $mainBranchId = \DB::table('branches')
            ->where('client_id', $user->client_id)
            ->where('is_main', true)
            ->whereNull('deleted_at')
            ->value('id');

        $q->where(function ($w) use ($user, $mainBranchId) {
            $w->where('branch_id', $user->branch_id);
            if ($mainBranchId) {
                $w->orWhere('branch_id', $mainBranchId);
            }
        });
    }

   
    private function assertScope(ProformaInvoice $row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);

        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ($user->branch && (bool) $user->branch->is_main) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;

        $isFromMainBranch = \DB::table('branches')
            ->where('id', $row->branch_id)
            ->where('client_id', $user->client_id)
            ->value('is_main');

        if ($isFromMainBranch) {
            if ($action === 'read') return;
            abort(403, 'Main-branch records are view-only for branch users.');
        }
        abort(404);
    }

   
    private function assertQuotationScope(Quotation $row, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);

        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ($user->branch && (bool) $user->branch->is_main) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;

        $isFromMainBranch = \DB::table('branches')
            ->where('id', $row->branch_id)
            ->where('client_id', $user->client_id)
            ->value('is_main');
        if ($isFromMainBranch) return;
        abort(404);
    }

   
    private function userCanModify(ProformaInvoice $row, $user): bool
    {
        if ($user->user_type === 'super_admin') return true;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) return false;
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return true;
        if ($user->branch && (bool) $user->branch->is_main) return true;
        return (int) $row->branch_id === (int) $user->branch_id;
    }

   
    private function applyFilters($q, Request $request): void
    {
        if ($v = $request->query('status'))       $q->where('status', $v);
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
                  ->orWhere('consignee_name','ilike', $like)
                  ->orWhere('convert_from_code', 'ilike', $like);
            });
        }
    }
}
