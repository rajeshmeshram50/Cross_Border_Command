<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Quotation;
use App\Models\QuotationItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Sales Matrix → Quotations API.
 *
 * Endpoints
 * ─────────
 *  GET    /sales/quotations              paginated list + filters
 *  GET    /sales/quotations/{id}         single + items + relations
 *  POST   /sales/quotations              create (header + items in one request)
 *  PUT    /sales/quotations/{id}         update (replaces items wholesale)
 *  DELETE /sales/quotations/{id}         soft-delete (status = cancelled)
 *  POST   /sales/quotations/{id}/duplicate          clone as a new draft
 *  POST   /sales/quotations/{id}/convert-to-pi      mark as converted_to_pi
 *
 * Code sequence: `QT/YYYY-NN/SEQ` where YYYY-NN is the Indian financial
 * year (Apr → Mar). SEQ is per-(client, financial-year) and allocated
 * inside a row-lock on the parent client row to defeat the race where
 * two concurrent POSTs could pick the same SEQ.
 *
 * Server is the single source of truth for line `amount` and the
 * `sub_total` / `grand_total` aggregates — the client's submitted
 * values for those are ignored entirely (we recompute).
 */
class QuotationController extends Controller
{
    /* ── LIST ───────────────────────────────────────────────── */

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
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user);
        $this->applyFilters($q, $request);

        $perPage = min(max((int) $request->query('per_page', 25), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);
        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        return response()->json([
            'status' => true,
            'data'   => $paginator->items(),
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

        $row = Quotation::query()
            ->with(['items', 'customer:id,customer_code,company_name',
                    'consignee:id,consignee_code,company_name',
                    'lead:id,opp_code',
                    'salesManager:id,name'])
            ->findOrFail($id);
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

        // Server-compute every line `amount` + the header totals.
        // Anything the client sent for `amount` / `sub_total` etc. is
        // discarded — we never trust client-side math.
        $items = $this->prepareItems($data['items']);
        $totals = $this->aggregateTotals($items, (float) ($data['shipping'] ?? 0));

        $row = DB::transaction(function () use ($user, $data, $items, $totals) {
            // Lock the client row to serialize concurrent code allocations.
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode($user->client_id);

            // Resolve cached display labels so listings don't N+1 later.
            // resolveCachedLabels mutates $data to inject sales_manager_id
            // from the linked lead's salesperson when none was sent.
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
                'port_of_discharge' => $data['port_of_discharge']?? null,
                'final_destination' => $data['final_destination']?? null,
                'origin_country'    => $data['origin_country']   ?? null,
                'state_code'        => $data['state_code']       ?? null,
                'sales_manager_id'  => $data['sales_manager_id'] ?? $user->id,
                'sales_manager_name'=> $smName,
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

    /* ── UPDATE ─────────────────────────────────────────────── */

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user);
        if ($row->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation has already been converted to a PI. Duplicate it to make changes.',
            ], 409);
        }

        $data = $this->validatePayload($request);

        /* B31: enforce status transition order. Without this any payload
         * could regress an `approved` quote back to `draft`, or skip
         * straight from `draft` to `converted_to_pi` without going
         * through `sent` + `approved`. Allowed forward-edges only — a
         * `cancelled` quote is terminal. */
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
                'port_of_discharge' => $data['port_of_discharge']?? null,
                'final_destination' => $data['final_destination']?? null,
                'origin_country'    => $data['origin_country']   ?? null,
                'state_code'        => $data['state_code']       ?? null,
                'sales_manager_id'  => $data['sales_manager_id'] ?? $row->sales_manager_id,
                'sales_manager_name'=> $smName ?: $row->sales_manager_name,
                'sub_total'         => $totals['sub_total'],
                'shipping'          => $totals['shipping'],
                'grand_total'       => $totals['grand_total'],
                'status'            => $data['status'] ?? $row->status,
                'terms'             => $data['terms'] ?? $row->terms,
                'version'           => $row->version + 1,
                'updated_by'        => $user->id,
            ]);

            // Wholesale-replace items. Simpler than diff/patch and the
            // quote line set is small (typically < 20 rows). Cascade
            // delete on the FK keeps it clean.
            $row->items()->delete();
            foreach ($items as $i => $it) {
                $it['quotation_id'] = $row->id;
                $it['line_no']      = $i + 1;
                QuotationItem::create($it);
            }
        });

        return response()->json(['status' => true, 'data' => $row->fresh(['items'])]);
    }

    /* ── DELETE (soft) ──────────────────────────────────────── */

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user);
        if ($row->status === Quotation::STATUS_CONVERTED_TO_PI) {
            return response()->json([
                'status' => false,
                'message' => 'This quotation has been converted to a PI and cannot be cancelled.',
            ], 409);
        }
        $row->update(['status' => Quotation::STATUS_CANCELLED, 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'message' => 'Cancelled']);
    }

    /* ── DUPLICATE ──────────────────────────────────────────── */

    public function duplicate(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $src = Quotation::with('items')->findOrFail($id);
        $this->assertScope($src, $user);

        $clone = DB::transaction(function () use ($user, $src) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $newCode = $this->nextCode($user->client_id);

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

    /* ── CONVERT TO PI ──────────────────────────────────────── */

    public function convertToPi(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = Quotation::findOrFail($id);
        $this->assertScope($row, $user);

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

    /* ─────────────────────────────────────────────────────────
     * Internals
     * ───────────────────────────────────────────────────────── */

    private function validatePayload(Request $request): array
    {
        // Conditional rules: International requires the shipping block,
        // Domestic requires state_code instead. Both modes share the
        // identity + party + currency + items block.
        $docType = $request->input('doc_type', Quotation::DOC_INTERNATIONAL);

        $rules = [
            'doc_type'          => ['required', Rule::in(Quotation::DOC_TYPES)],
            'opp_id'            => 'nullable|integer|exists:leads,id',
            'customer_id'       => 'required|integer|exists:customers,id',
            'consignee_id'      => 'nullable|integer|exists:consignees,id',
            'bank_account_id'   => 'nullable|integer',
            'currency'          => 'nullable|string|max:8',
            'exchange_rate'     => 'nullable|numeric|min:0',
            'sales_manager_id'  => 'nullable|integer|exists:users,id',
            'shipping'          => 'nullable|numeric|min:0',
            'terms'             => 'nullable|string|max:8000',
            'status'            => ['nullable', Rule::in(Quotation::STATUSES)],
            'items'             => 'required|array|min:1',
            'items.*.product_id'   => 'nullable|integer',
            'items.*.product_name' => 'required|string|max:255',
            'items.*.hsn_code'     => 'nullable|string|max:16',
            // B13: 0.0001 lower bound rounds away to 0 at decimal:4 cast,
            // creating an "empty" line that still inflates the line count.
            // 0.01 is the smallest sensible business quantity (1 paisa /
            // 1 cent of a unit) and survives the cast.
            'items.*.quantity'     => 'required|numeric|min:0.01',
            'items.*.unit'         => 'nullable|string|max:16',
            // B12 sibling: quote rate of zero would render "₹ 0.00 / unit"
            // to the customer. gt:0 mirrors the shared-price fix.
            'items.*.rate'         => 'required|numeric|gt:0',
            'items.*.tax_pct'      => 'nullable|numeric|min:0|max:100',
        ];

        if ($docType === Quotation::DOC_INTERNATIONAL) {
            $rules['inco_term']         = 'required|string|max:16';
            $rules['port_of_loading']   = 'required|string|max:128';
            $rules['port_of_discharge'] = 'required|string|max:128';
            $rules['final_destination'] = 'required|string|max:128';
            $rules['origin_country']    = 'required|string|max:64';
            $rules['state_code']        = 'nullable|string|max:64';
        } else {
            $rules['state_code']        = 'required|string|max:64';
            $rules['inco_term']         = 'nullable|string|max:16';
            $rules['port_of_loading']   = 'nullable|string|max:128';
            $rules['port_of_discharge'] = 'nullable|string|max:128';
            $rules['final_destination'] = 'nullable|string|max:128';
            $rules['origin_country']    = 'nullable|string|max:64';
        }

        return $request->validate($rules);
    }

    /** Compute each item's `amount` server-side from (qty * rate) + tax. */
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

    /** Sum prepared item amounts + add shipping.
     *
     *  B35: each item's stored `amount` is already rounded to 2dp in
     *  computeAmount() — those rounded numbers go into the line table
     *  so the customer sees them. But for the grand_total we re-derive
     *  the EXACT (unrounded) sum from qty*rate*(1+tax/100) here so a
     *  spread of `*.005` line subtotals doesn't accumulate banker's-
     *  rounding error in the header. Round once at the very end. */
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
     * Look up the display labels for the FK references so the listing
     * page can render without an extra round-trip per row. Returns
     * [customerName, consigneeName, oppCode, oppDate, bankLabel, smName].
     *
     * Side-effect: when the payload links to an opportunity but did not
     * specify a sales_manager_id, this method injects the lead's
     * salesperson_id into $data so the "SALES PERSON NAME" from the
     * opportunity becomes the quotation's sales manager.
     */
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
                // Default sales manager to the lead's salesperson when the
                // client didn't override it — surfaces "Ankita" (etc.) in the
                // SALES MANAGER column instead of the creating user.
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

    /**
     * Allocate the next code for a client. Format: QT/YYYY-NN/SEQ
     * where YYYY-NN is the financial year and SEQ resets each year.
     *
     * B20: takes its OWN Postgres advisory lock keyed by (client_id, FY)
     * so the read-then-write sequence is serialized at the connection
     * level regardless of whether the caller wrapped this in a row lock.
     * The outer `lockForUpdate('clients')` in store/duplicate continues
     * to work for transaction-scoped serialization; this advisory lock
     * adds a second safety net that follows the code allocation itself
     * so a future caller (console command, queued job, etc.) that
     * forgets the outer lock can't allocate a duplicate code.
     */
    private function nextCode(int $clientId): string
    {
        $fy = $this->currentFinancialYear();

        // Advisory-lock key: hashed (clientId, FY) → 32-bit int. Released
        // automatically at session end or when explicitly unlocked.
        $lockKey = crc32("qt-code:{$clientId}:{$fy}");
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('SELECT pg_advisory_xact_lock(?)', [$lockKey]);
        }

        // Walk through existing codes for this client + FY and find the
        // highest SEQ. Increment past any gap so we never collide with
        // an existing row even if rows were deleted in the middle.
        $codes = Quotation::where('client_id', $clientId)
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

    /** Indian financial year string for the current date (e.g. "2026-27"). */
    private function currentFinancialYear(): string
    {
        $now = now();
        $startYear = (int) $now->format('Y');
        if ((int) $now->format('n') < 4) {
            $startYear -= 1;   // Jan-Mar belongs to the prior FY
        }
        $endShort = str_pad((string) (($startYear + 1) % 100), 2, '0', STR_PAD_LEFT);
        return "{$startYear}-{$endShort}";
    }

    /* ── Authorisation ──────────────────────────────────────── */

    private function applyScope($q, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if ($user->client_id) {
            $q->where('client_id', $user->client_id);
        } else {
            $q->whereRaw('1 = 0');   // No tenant → no rows
        }
    }

    private function assertScope(Quotation $row, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) {
            abort(404);
        }
    }

    /* ── List filters ───────────────────────────────────────── */

    private function applyFilters($q, Request $request): void
    {
        if ($v = $request->query('status'))      $q->where('status', $v);
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
                  ->orWhere('customer_name','ilike', $like)
                  ->orWhere('consignee_name','ilike', $like);
            });
        }
    }
}
