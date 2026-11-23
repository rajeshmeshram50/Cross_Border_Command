<?php

namespace App\Http\Controllers\Api;

use App\Support\FxRate;
use App\Http\Controllers\Concerns\EnforcesSegmentBuyerConsignee;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Quotation;
use App\Models\QuotationItem;
use App\Services\ZohoBooksService;
use App\Support\Gst;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use RuntimeException;

class QuotationController extends Controller
{
    use EnforcesSegmentBuyerConsignee;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Quotation::query()
            ->with([
                'customer:id,customer_code,company_name',
                'consignee:id,consignee_code,company_name',
                'lead:id,opp_code',
                'salesManager:id,name',
                'branch:id,name,code',
                'creator:id,name,user_type,branch_id',
                'creator.branch:id,name',
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);
        $this->applyFilters($q, $request);

        $perPage = min(max((int) $request->query('per_page', 25), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);
        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        $items    = collect($paginator->items());
        $ownerIds = $items->map(fn($r) => (int) ($r->sales_manager_id ?: $r->created_by))
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

        $row = Quotation::query()
            ->with([
                'items',
                'customer:id,customer_code,company_name',
                'consignee:id,consignee_code,company_name',
                'lead:id,opp_code',
                'salesManager:id,name'
            ])
            ->findOrFail($id);
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

        if ($block = $this->segmentPartyBlockResponse(
            (int) $user->client_id,
            array_map(fn($it) => $it['product_id'] ?? null, $data['items']),
            $data['consignee_id'] ?? null,
        )) {
            return $block;
        }

        $items = $this->prepareItems($data['items']);
        $totals = $this->aggregateTotals($items, (float) ($data['shipping'] ?? 0));

        $row = DB::transaction(function () use ($user, $data, $items, $totals) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id, $user->branch_id);

            [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName] =
                $this->resolveCachedLabels($data);

            $quot = Quotation::create([
                'client_id'         => $user->client_id,
                'branch_id'         => $user->branch_id,
                'code'              => $code,
                'version'           => 1,
                'doc_type'          => $data['doc_type'],
                'opp_id'            => $data['opp_id']     ?? null,
                'opp_code'          => $oppCode,
                'opportunity_date'  => $oppDate,
                'customer_id'       => $data['customer_id'],
                'customer_name'     => $customerName,
                'consignee_id'      => $data['consignee_id'] ?? null,
                'consignee_name'    => $consigneeName,
                'bank_account_id'   => $data['bank_account_id'] ?? null,
                'bank_label'        => $bankLabel,
                'currency'          => $data['currency']         ?? null,
                'exchange_rate'     => $data['exchange_rate']    ?? null,
                'inco_term'         => $data['inco_term']        ?? null,
                'port_of_loading'   => $data['port_of_loading']  ?? null,
                'port_of_discharge' => $data['port_of_discharge'] ?? null,
                'final_destination' => $data['final_destination'] ?? null,
                'origin_country'    => $data['origin_country']   ?? null,
                'state_code'        => $data['state_code']       ?? null,
                'dispatch_from'     => $data['dispatch_from']    ?? null,
                'deliver_to'        => $data['deliver_to']       ?? null,
                'customer_gst_no'   => $data['customer_gst_no']  ?? null,
                'sales_manager_id'  => $data['sales_manager_id'] ?? $user->id,
                'sales_manager_name' => $smName,
                'sub_total'         => $totals['sub_total'],
                'shipping'          => $totals['shipping'],
                'grand_total'       => $totals['grand_total'],
                'status'            => $data['status'] ?? Quotation::STATUS_DRAFT,
                'terms'             => $data['terms'] ?? null,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);

            foreach ($items as $i => $it) {
                $it['quotation_id'] = $quot->id;
                $it['line_no']      = $i + 1;
                QuotationItem::create($it);
            }

            return $quot->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user, 'write');
        if (!empty($row->zoho_estimate_id)) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation is synced to Zoho Books (estimate ' . ($row->zoho_estimate_number ?: $row->zoho_estimate_id) . ') and can no longer be edited — edit it in Zoho Books instead.',
            ], 422);
        }
        if ($row->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation has already been converted to a PI. Duplicate it to make changes.',
            ], 409);
        }

        if (\App\Models\ClmSignatureRequest::hasSignedForDoc(
            $user->client_id,
            \App\Models\ClmSignatureRequest::DOC_QUOTATION,
            $row->id,
        )) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation has already been signed and can no longer be edited. Duplicate it to make changes.',
            ], 409);
        }

        $data = $this->validatePayload($request);

        if ($block = $this->segmentPartyBlockResponse(
            (int) $user->client_id,
            array_map(fn($it) => $it['product_id'] ?? null, $data['items']),
            $data['consignee_id'] ?? null,
        )) {
            return $block;
        }

        if (array_key_exists('status', $data) && $data['status'] !== null && $data['status'] !== $row->status) {
            static $allowed = [
                Quotation::STATUS_DRAFT            => [Quotation::STATUS_SENT, Quotation::STATUS_CANCELLED],
                Quotation::STATUS_SENT             => [Quotation::STATUS_APPROVED, Quotation::STATUS_CANCELLED],
                Quotation::STATUS_APPROVED         => [Quotation::STATUS_CONVERTED_TO_PI, Quotation::STATUS_CANCELLED],
                Quotation::STATUS_CONVERTED_TO_PI  => [],
                Quotation::STATUS_CANCELLED        => [],
            ];
            $next = $allowed[$row->status] ?? [];
            if (!in_array($data['status'], $next, true)) {
                return response()->json([
                    'status'  => false,
                    'message' => "Cannot move quotation from '{$row->status}' to '{$data['status']}'.",
                ], 422);
            }
        }
        $items = $this->prepareItems($data['items']);
        $totals = $this->aggregateTotals($items, (float) ($data['shipping'] ?? 0));

        DB::transaction(function () use ($user, $row, $data, $items, $totals) {
            [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName] =
                $this->resolveCachedLabels($data);

            $row->update([
                'doc_type'          => $data['doc_type'],
                'opp_id'            => $data['opp_id']     ?? null,
                'opp_code'          => $oppCode,
                'opportunity_date'  => $oppDate,
                'customer_id'       => $data['customer_id'],
                'customer_name'     => $customerName,
                'consignee_id'      => $data['consignee_id'] ?? null,
                'consignee_name'    => $consigneeName,
                'bank_account_id'   => $data['bank_account_id'] ?? null,
                'bank_label'        => $bankLabel,
                'currency'          => $data['currency']         ?? null,
                'exchange_rate'     => $data['exchange_rate']    ?? null,
                'inco_term'         => $data['inco_term']        ?? null,
                'port_of_loading'   => $data['port_of_loading']  ?? null,
                'port_of_discharge' => $data['port_of_discharge'] ?? null,
                'final_destination' => $data['final_destination'] ?? null,
                'origin_country'    => $data['origin_country']   ?? null,
                'state_code'        => $data['state_code']       ?? null,
                'dispatch_from'     => $data['dispatch_from']    ?? null,
                'deliver_to'        => $data['deliver_to']       ?? null,
                'customer_gst_no'   => $data['customer_gst_no']  ?? null,
                'sales_manager_id'  => $data['sales_manager_id'] ?? $row->sales_manager_id,
                'sales_manager_name' => $smName ?: $row->sales_manager_name,
                'sub_total'         => $totals['sub_total'],
                'shipping'          => $totals['shipping'],
                'grand_total'       => $totals['grand_total'],
                'status'            => $data['status'] ?? $row->status,
                'terms'             => $data['terms'] ?? $row->terms,
                'version'           => $row->version + 1,
                'updated_by'        => $user->id,
            ]);

            $row->items()->delete();
            foreach ($items as $i => $it) {
                $it['quotation_id'] = $row->id;
                $it['line_no']      = $i + 1;
                QuotationItem::create($it);
            }
        });

        \App\Models\ClmSignatureRequest::supersedeForDoc(
            $user->client_id,
            \App\Models\ClmSignatureRequest::DOC_QUOTATION,
            $row->id,
        );

        return response()->json(['status' => true, 'data' => $row->fresh(['items'])]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user, 'write');
        if (!empty($row->zoho_estimate_id)) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation is synced to Zoho Books and cannot be cancelled here — void the estimate in Zoho Books first.',
            ], 422);
        }
        if ($row->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation has been converted to a PI and cannot be cancelled.',
            ], 409);
        }
        $row->update(['status' => Quotation::STATUS_CANCELLED, 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'message' => 'Cancelled']);
    }

    public function duplicate(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $src = Quotation::with('items')->findOrFail($id);
        $this->assertScope($src, $user);

        $clone = DB::transaction(function () use ($user, $src) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $newCode = $this->nextCode($user->client_id, $src->branch_id);

            $copy = $src->replicate(['code', 'status', 'version', 'created_by', 'updated_by']);
            $copy->code        = $newCode;
            $copy->status      = Quotation::STATUS_DRAFT;
            $copy->version     = 1;
            $copy->created_by  = $user->id;
            $copy->updated_by  = $user->id;
            $copy->save();

            foreach ($src->items as $it) {
                $clone = $it->replicate(['quotation_id']);
                $clone->quotation_id = $copy->id;
                $clone->save();
            }
            return $copy->fresh(['items']);
        });

        return response()->json(['status' => true, 'data' => $clone], 201);
    }

    public function convertToPi(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user, 'write');

        if ($row->opp_id) {
            $leadRow = \App\Models\Lead::where('client_id', $user->client_id)
                ->whereKey($row->opp_id)
                ->first(['id', 'opp_code', 'disqualified']);
            if ($leadRow && $leadRow->disqualified) {
                return response()->json([
                    'status'  => false,
                    'message' => 'This opportunity (' . ($leadRow->opp_code ?: $leadRow->id) . ') is disqualified. Re-qualify it before converting to a PI.',
                ], 422);
            }
        }

        if ($row->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status' => false,
                'message' => 'Already converted to PI.',
            ], 409);
        }
        if ($row->status === Quotation::STATUS_CANCELLED) {
            return response()->json([
                'status' => false,
                'message' => 'Cancelled quotations cannot be converted.',
            ], 409);
        }

        $row->update([
            'status'     => Quotation::STATUS_CONVERTED_TO_PI,
            'updated_by' => $user->id,
        ]);

        return response()->json([
            'status' => true,
            'data'   => $row->fresh(['items']),
            'message' => 'Quotation marked as converted. Wire the actual PI creation when the PI module ships.',
        ]);
    }

    private function validatePayload(Request $request): array
    {
        $docType = $request->input('doc_type', Quotation::DOC_INTERNATIONAL);

        if ($docType === Quotation::DOC_DOMESTIC) {
            $request->merge(['currency' => 'INR']);
        }

        $rules = [
            'doc_type'          => ['required', Rule::in(Quotation::DOC_TYPES)],
            'opp_id'            => 'nullable|integer|exists:leads,id',
            'customer_id'       => 'required|integer|exists:customers,id',
            'consignee_id'      => 'nullable|integer|exists:consignees,id',
            'bank_account_id'   => 'nullable|integer',
            'currency'          => 'nullable|string',
            'exchange_rate'     => FxRate::rules(),
            'sales_manager_id'  => 'nullable|integer|exists:users,id',
            'shipping'          => 'nullable|numeric|min:0',
            'terms'             => 'nullable|string|max:8000',
            'status'            => ['nullable', Rule::in(Quotation::STATUSES)],
            'items'             => 'required|array|min:1',
            'items.*.product_id'   => 'nullable|integer',
            'items.*.product_name' => 'required|string|max:255',
            'items.*.hsn_code'     => 'nullable|string|max:16',
            'items.*.quantity'     => 'required|numeric|min:0.01',
            'items.*.unit'         => 'nullable|string|max:16',
            'items.*.rate'         => 'required|numeric|gt:0',

            'items.*.tax_pct'      => 'nullable|numeric|min:0',

            'customer_gst_no'      => 'nullable|string|max:20',
        ];

        if ($docType === Quotation::DOC_INTERNATIONAL) {
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
                'amount'       => QuotationItem::computeAmount($qty, $rate, $tax),
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
        $customerName = null;
        $consigneeName = null;
        $oppCode = null;
        $oppDate = null;
        $bankLabel = null;
        $smName = null;

        if (!empty($data['customer_id'])) {
            $c = DB::table('customers')->where('id', $data['customer_id'])
                ->value('company_name');
            $customerName = $c;
        }
        if (!empty($data['consignee_id'])) {
            $c = DB::table('consignees')->where('id', $data['consignee_id'])
                ->value('company_name');
            $consigneeName = $c;
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
            $b = DB::table('master_bank_accounts')
                ->where('id', $data['bank_account_id'])
                ->select('bank_name', 'account_holder')->first();
            if ($b) {
                $bankLabel = $b->account_holder
                    ? $b->bank_name . ' (' . $b->account_holder . ')'
                    : $b->bank_name;
            }
        }
        if (!empty($data['sales_manager_id'])) {
            $smName = DB::table('users')->where('id', $data['sales_manager_id'])
                ->value('name');
        }

        return [$customerName, $consigneeName, $oppCode, $oppDate, $bankLabel, $smName];
    }

    public function previewCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $code = null;
        if ($user && $user->client_id) {
            $fy = $this->currentFinancialYear();
            $branchId = $user->branch_id;
            $codes = Quotation::where('client_id', $user->client_id)
                ->when($branchId !== null, fn($q) => $q->where('branch_id', $branchId))
                ->when($branchId === null, fn($q) => $q->whereNull('branch_id'))
                ->where('code', 'like', "QT/{$fy}/%")
                ->pluck('code')->all();
            $max = 0;
            foreach ($codes as $c) {
                if (preg_match('#^QT/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                    $n = (int) $m[1];
                    if ($n > $max) $max = $n;
                }
            }
            $code = "QT/{$fy}/" . ($max + 1);
        }
        return response()->json(['status' => true, 'data' => ['code' => $code]]);
    }

    public function gstHomeState(Request $request): JsonResponse
    {
        return response()->json([
            'status' => true,
            'data'   => ['state_code' => Gst::homeStateCode($request->user()?->branch_id)],
        ]);
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        $fy = $this->currentFinancialYear();

        $lockKey = crc32("qt-code:{$clientId}:" . ($branchId ?? 0) . ":{$fy}");
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [$lockKey]);
        }

        $codes = Quotation::where('client_id', $clientId)
            ->when($branchId !== null, fn($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn($q) => $q->whereNull('branch_id'))
            ->where('code', 'like', "QT/{$fy}/%")
            ->pluck('code')
            ->all();

        $max = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('#^QT/' . preg_quote($fy, '#') . '/(\d+)$#', $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
            $taken[$c] = true;
        }
        $n = $max;
        do {
            $n++;
            $code = "QT/{$fy}/{$n}";
        } while (isset($taken[$code]));

        return $code;
    }

    private function currentFinancialYear(): string
    {
        $now = now();
        $startYear = (int) $now->format('Y');
        if ((int) $now->format('n') < 4) {
            $startYear -= 1;
        }
        $endShort = str_pad((string) (($startYear + 1) % 100), 2, '0', STR_PAD_LEFT);
        return "{$startYear}-{$endShort}";
    }

    public function sync(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $q = Quotation::with('items')->findOrFail($id);
        $this->assertScope($q, $user, 'write');

        $books = app(ZohoBooksService::class);
        if (!$books->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again.'], 503);
        }

        $lock = Cache::lock('zoho:sync:quotation:' . $q->id, 120);
        if (!$lock->get()) {
            return response()->json(['status' => false, 'message' => 'A Zoho sync for this quotation is already in progress — try again in a moment.'], 409);
        }
        try {
            $q->refresh();
            if (!empty($q->zoho_estimate_id)) {
                return response()->json(['status' => true, 'message' => 'This quotation is already synced to Zoho Books (estimate ' . ($q->zoho_estimate_number ?: $q->zoho_estimate_id) . ').', 'data' => $this->shapeZoho($q)]);
            }
            if (!$q->customer_id) {
                return response()->json(['status' => false, 'message' => 'Attach a customer to this quotation before syncing to Zoho Books.'], 422);
            }
            if ($q->items->isEmpty()) {
                return response()->json(['status' => false, 'message' => 'Add at least one product line before syncing to Zoho Books.'], 422);
            }

            try {
                $customer = Customer::where('id', $q->customer_id)->where('client_id', $q->client_id)->first();
                if (!$customer) {
                    return response()->json(['status' => false, 'message' => 'The linked customer could not be found for this quotation.'], 422);
                }
                $gstin      = $q->customer_gst_no ?: ($customer->gst_number ?: null);
                $stateCode  = $q->state_code ?: null;
                $registered = (bool) $gstin;

                $orgState   = $books->orgStateCode() ?: $this->homeStateCode($q->branch_id);
                $partyState = \App\Services\ZohoBooksService::normStateCode($stateCode);
                $interState = $registered && $partyState !== null && $partyState !== \App\Services\ZohoBooksService::normStateCode($orgState);

                $zohoCustomerId = $books->findOrCreateCustomerId($customer, $gstin, $stateCode);
                $est   = $books->createEstimate($this->buildZohoEstimatePayload($q, $books, $zohoCustomerId, $interState, $registered ? $books->placeOfSupply($stateCode) : null));
                $estId = (string) $est['estimate_id'];

                $pdfPath = null;
                try {
                    $rel = 'zoho/estimate/' . $q->client_id . '/' . ($q->branch_id ?: 0) . '/EST-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($q->code ?: $q->id)) . '.pdf';
                    Storage::disk('public')->put($rel, $books->getEstimatePdf($estId));
                    $pdfPath = '/storage/' . $rel;
                } catch (\Throwable $e) {
                    Log::warning('Zoho estimate PDF cache failed', ['quotation' => $q->id, 'err' => $e->getMessage()]);
                }

                $q->update([
                    'zoho_status'          => 'Sync',
                    'zoho_estimate_id'     => $estId,
                    'zoho_estimate_number' => $est['estimate_number'] ?? null,
                    'zoho_synced_at'       => now(),
                    'zoho_error'           => null,
                    'zoho_pdf_path'        => $pdfPath,
                    'updated_by'           => $user->id,
                ]);

                return response()->json(['status' => true, 'message' => 'Synced to Zoho Books as estimate ' . ($est['estimate_number'] ?? $estId) . '.', 'data' => $this->shapeZoho($q->fresh())]);
            } catch (RuntimeException $e) {
                $q->update(['zoho_status' => 'Not Sync', 'zoho_error' => $e->getMessage(), 'updated_by' => $user->id]);
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
        $q = Quotation::findOrFail($id);
        $this->assertScope($q, $user);
        if (!$q->zoho_pdf_path) abort(404, 'No Zoho estimate PDF cached for this quotation.');
        $rel = ltrim(str_replace('/storage/', '', $q->zoho_pdf_path), '/');
        if (!Storage::disk('public')->exists($rel)) abort(404, 'Zoho estimate PDF file missing.');
        return response(Storage::disk('public')->get($rel), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ZOHO-EST-' . ($q->code ?: $q->id) . '.pdf"',
        ]);
    }

    private function buildZohoEstimatePayload(Quotation $q, ZohoBooksService $books, string $zohoCustomerId, bool $interState, ?string $placeOfSupply = null): array
    {
        $lineItems = $q->items->map(function ($it) use ($books, $interState) {
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
            'reference_number' => (string) $q->code,
            'line_items'       => $lineItems,
        ];
        if ($placeOfSupply) $payload['place_of_supply'] = $placeOfSupply;
        if ((float) $q->shipping != 0.0) $payload['shipping_charge'] = (float) $q->shipping;
        if ($ccyId = $books->resolveCurrencyId($q->currency)) {
            $payload['currency_id'] = $ccyId;
            if ((float) $q->exchange_rate > 0) $payload['exchange_rate'] = (float) $q->exchange_rate;
        }
        return $payload;
    }

    private function shapeZoho(Quotation $q): array
    {
        return [
            'id' => $q->id,
            'code' => $q->code,
            'zoho' => $q->zoho_status === 'Sync' ? 'sync' : 'not',
            'zohoEstimate' => $q->zoho_estimate_number,
            'zohoPdf' => $q->zoho_pdf_path ? true : false,
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

    private function assertScope(Quotation $row, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;

        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) {
            abort(404);
        }

        if (!\App\Support\SalesVisibility::pinnedToOwnBranch($user)) return;

        if ((int) $row->branch_id === (int) $user->branch_id) return;

        abort(404);
    }

    private function userCanModify(Quotation $row, $user): bool
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
            $q->where('status', '!=', Quotation::STATUS_CANCELLED);
        }
        if ($v = $request->query('doc_type'))    $q->where('doc_type', $v);
        if ($v = $request->query('doc_type'))    $q->where('doc_type', $v);
        if ($v = $request->query('customer_id')) $q->where('customer_id', (int) $v);
        if ($v = $request->query('opp_id'))      $q->where('opp_id', (int) $v);

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $q->whereBetween('created_at', [
                $request->query('start_date') . ' 00:00:00',
                $request->query('end_date')   . ' 23:59:59',
            ]);
        }

        if ($search = trim((string) $request->query('search', ''))) {
            $like = "%{$search}%";
            $q->where(function ($w) use ($like) {
                $w->where('code',          'ilike', $like)
                    ->orWhere('opp_code',     'ilike', $like)
                    ->orWhere('customer_name', 'ilike', $like)
                    ->orWhere('consignee_name', 'ilike', $like);
            });
        }
    }

    private function bundleCall(Request $request, callable $endpoint, array $query = [])
    {
        $user     = $request->user();
        $branchId = $request->query('branch_id');
        if ($branchId !== null && !array_key_exists('branch_id', $query)) {
            $query['branch_id'] = $branchId;
        }

        $sub = Request::create($request->getPathInfo(), 'GET', $query);
        $sub->setUserResolver(fn() => $user);
        $sub->headers->set('Accept', 'application/json');

        try {
            $res = $endpoint($sub);
        } catch (\Throwable $e) {
            Log::warning('Bundle endpoint: a list failed', [
                'bundle' => $request->getPathInfo(),
                'error'  => $e->getMessage(),
            ]);
            return null;
        }

        if ($res instanceof JsonResponse) return $res->getData(true);
        return json_decode($res->getContent(), true);
    }

    public function qpiGeoBundle(Request $request): JsonResponse
    {
        if (!$request->user()) abort(401);

        return response()->json([
            'countries'      => $this->bundleCall(
                $request,
                fn($r) => app(MasterController::class)->list($r, 'countries'),
                ['fields' => 'id,name'],
            ),
            'gst_home_state' => $this->bundleCall($request, fn($r) => $this->gstHomeState($r)),
        ]);
    }

    public function qpiMasterBundle(Request $request): JsonResponse
    {
        if (!$request->user()) abort(401);

        $master = app(MasterController::class);

        return response()->json([
            'currencies'        => $this->bundleCall($request, fn($r) => $master->list($r, 'currencies')),
            'incoterms'         => $this->bundleCall($request, fn($r) => $master->list($r, 'incoterms')),
            'port_of_loading'   => $this->bundleCall($request, fn($r) => $master->list($r, 'port_of_loading')),
            'port_of_discharge' => $this->bundleCall($request, fn($r) => $master->list($r, 'port_of_discharge')),
            'bank_accounts'     => $this->bundleCall($request, fn($r) => $master->list($r, 'bank_accounts')),
            'customers'         => $this->bundleCall($request, fn($r) => app(CustomerController::class)->index($r), ['tab' => 'all']),
            'consignees'        => $this->bundleCall($request, fn($r) => app(ConsigneeController::class)->index($r)),
            'leads'             => $this->bundleCall($request, fn($r) => app(SalesLeadController::class)->index($r), ['per_page' => 50]),
            'products'          => $this->bundleCall($request, fn($r) => app(ProductController::class)->index($r), ['per_page' => 200, 'status' => 'active']),
        ]);
    }
}
