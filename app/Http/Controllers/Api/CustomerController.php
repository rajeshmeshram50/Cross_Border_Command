<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Models\CustomerGstScrutiny;
use App\Models\Masters\AddressTypes;
use App\Models\Masters\Countries;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\CustomerTypes;
use App\Models\Masters\Designations;
use App\Models\Masters\DocumentType;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Support\Gst;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use App\Support\PostalCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Customer::query()
            // Honour the BranchSwitcher: when a client admin has picked a
            // specific branch, narrow the list to it. Ignored for branch users
            // (they can't switch) inside applyReadScope.
            ->forUser($user, $request->integer('branch_id') ?: null)
            /* Single eager-load — `addresses` returns ALL rows in
             * customer_addresses (primary + extras). The Customer
             * model's `primaryAddress` relationship reads from the
             * already-loaded collection via a HasOne with the
             * is_primary scope; loading `addresses` separately on
             * top was firing the same SELECT twice per index call. */
            ->with(['addresses'])
            ->withCount(['consignees', 'consignees as same_as_customer_consignees_count' => function ($q) {
                $q->where('same_as_customer', true);
            }])
            /* Per-row "has ≥1 non-deleted lead" flag — the Recurring test, same
             * predicate as the tab filter and pill counts. Exposed on every row
             * so the frontend can bucket Fresh vs Recurring (and count them)
             * client-side without a separate request per tab. */
            ->addSelect(['is_recurring' => \DB::table('leads')
                ->selectRaw('1')
                ->whereColumn('leads.customer_id', 'customers.id')
                ->whereNull('leads.deleted_at')
                ->limit(1)])
            /* Order on the indexed customer_id (PK) — same monotonic
             * sequence as created_at but uses the clustered PK index
             * directly, so no sort step at all. */
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            /* Customer code is unique + indexed → cheap exact lookup
             * first. Email is also indexed (client_id, primary_email)
             * → starts-with against the email column. Everything else
             * falls back to ilike contains-search. The early-out on
             * the indexed columns keeps small/medium tables fast and
             * the OR-chain only fires when none of the indexed
             * shortcuts match. */
            $exact = mb_strtoupper($search);
            $q->where(function ($w) use ($search, $exact) {
                $w->where('customer_code', $exact)
                  ->orWhere('primary_email', 'ilike', $search . '%')
                  ->orWhere('company_name',  'ilike', "%{$search}%")
                  ->orWhere('legal_name',    'ilike', "%{$search}%")
                  ->orWhere('segment',       'ilike', "%{$search}%")
                  // Customer Type (shown in the list) — e.g. "Retailer".
                  ->orWhere('type',          'ilike', "%{$search}%")
                  /* Country / Contact Person / Contact No live on the primary
                   * address row (mirrored into the list's Country / Contact /
                   * Phone columns), so search them via the addresses relation
                   * to match what the user actually sees in the table. */
                  ->orWhereHas('addresses', function ($a) use ($search) {
                      $a->where('is_primary', true)
                        ->where(function ($x) use ($search) {
                            $x->where('country',    'ilike', "%{$search}%")
                              ->orWhere('cp_name',  'ilike', "%{$search}%")
                              ->orWhere('cp_contact', 'ilike', "%{$search}%");
                        });
                  });
            });
        }

        /* Tab filter — buckets the list by whether the customer has at
         * least one lead pointing at them (leads.customer_id):
         *   - `recurring` → customer has been linked to ≥ 1 lead in the
         *     Sales Matrix (the "we've worked with them before" bucket).
         *   - `fresh`     → customer has NO leads yet (newly added but
         *     not yet engaged via the opp pipeline).
         * Defaults to `fresh` to match the frontend's initial tab state.
         *
         * Implemented via a sub-select EXISTS so we don't need to add a
         * `leads()` HasMany relation on Customer (keeps the model lean).
         * Soft-deleted leads are excluded — a deleted lead doesn't keep
         * the customer in the recurring bucket. */
        // "Has at least one non-deleted lead" — the recurring test. Shared by
        // the tab filter and the pill counts so they can't drift apart.
        $hasLead = function ($w) {
            $w->select(\DB::raw(1))
                ->from('leads')
                ->whereColumn('leads.customer_id', 'customers.id')
                ->whereNull('leads.deleted_at');
        };

        /* Tab pill counts — computed on the scope+search query BEFORE the tab
         * filter narrows it, so every pill shows how many rows IT would show
         * (not how many the active tab has). They honour the search box, so the
         * counts track what the user is looking at. `fresh = all - recurring`
         * because the two buckets partition the set — one COUNT query instead
         * of two. */
        $allCount       = (clone $q)->count();
        $recurringCount = (clone $q)->whereExists($hasLead)->count();
        $tabCounts = [
            'all'       => $allCount,
            'recurring' => $recurringCount,
            'fresh'     => $allCount - $recurringCount,
        ];

        $tab = $request->query('tab', 'fresh');
        if ($tab === 'recurring') {
            $q->whereExists($hasLead);
        } elseif ($tab === 'fresh') {
            $q->whereNotExists($hasLead);
        }
        // 'all' or anything else → no tab filter

        /* Optional server-side pagination — kicks in when the client
         * sends `?page` or `?per_page`. Defaults preserve the legacy
         * "return everything" shape so existing callers don't break.
         * Cap per_page at 200 so a misbehaving client can't fetch
         * tens of thousands of rows in one round-trip. */
        $page    = (int) $request->query('page', 0);
        $perPage = min((int) $request->query('per_page', 0), 200);

        if ($page > 0 || $perPage > 0) {
            $perPage = $perPage > 0 ? $perPage : 50;
            $page    = $page > 0 ? $page : 1;
            $total   = (clone $q)->count();
            $rows    = $q->forPage($page, $perPage)
                ->get()
                ->map(fn ($c) => $this->shape($c))
                ->all();
            return response()->json([
                'tab'        => $tab,
                'count'      => $total,
                'tab_counts' => $tabCounts,
                'page'       => $page,
                'per_page'   => $perPage,
                'data'       => $rows,
            ]);
        }

        $rows = $q->get()->map(fn ($c) => $this->shape($c))->all();

        return response()->json([
            'tab'        => $tab,
            'count'      => count($rows),
            'tab_counts' => $tabCounts,
            'data'       => $rows,
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $row = Customer::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'gstScrutiny'])
            ->findOrFail($id);

        /* Stage 2 + Stage 3 data embedded inline.
         *
         * The AddCustomerModal edit-mode previously fired 4 parallel HTTP
         * requests on open (/customers/{id} + /customers/{id}/documents +
         * /customers/{id}/owners + /segment-uploads/customer/{id}). On the
         * single-threaded `php artisan serve` and even on a multi-process
         * Apache, each request paid a ~500ms Laravel framework boot tax.
         * Result: edit-modal opens cost 2-5 sec of pure framework overhead
         * even though the SQL was sub-50ms.
         *
         * Bundling the three nested resources into this response collapses
         * 4 round-trips into 1 — same proven pattern we used for
         * ClientPermissions (embedded admin_permissions in clients/{id}).
         *
         * Each delegated controller's index() reuses its own resolveCustomer()
         * which applies the same `forUser` tenant scope, so security stays
         * exactly where it was. Wrapped in try/catch so a single nested
         * controller's failure (e.g. segment_uploads 404 on a customer with
         * no uploads yet) does not break the entire show() response — the
         * key just lands as an empty list and the frontend falls back to
         * its existing on-tab fetch.
         */
        $documents = $this->safeDelegate(
            fn () => (new CustomerDocumentController())->index($request, $id)
        );
        $owners = $this->safeDelegate(
            fn () => (new CustomerOwnerController())->index($request, $id)
        );
        $segmentUploads = $this->safeDelegate(
            fn () => (new SegmentDocUploadController())->index($request, 'customer', $id)
        );

        return response()->json([
            'data'            => $this->shape($row),
            'documents'       => $documents['data'] ?? [],
            'owners'          => $owners['data'] ?? [],
            // segment_uploads keeps its full shape (data + by_category + count)
            // because the frontend reads `data[].category` for the per-tab
            // bucketing in Stage 2 KYC. Fallback to a stable empty shape so
            // consumers don't have to null-check.
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
            // GST Scrutiny history for the popup (domestic customers).
            'gst_scrutiny'    => $row->gstScrutiny->map(fn ($g) => $this->shapeGst($g))->all(),
        ]);
    }

    /**
     * Run a delegated controller call and unwrap its JSON response, returning
     * `null` on any failure. Used by show() to embed nested resources without
     * letting a single inner failure (404, validation, etc.) take down the
     * whole response. Caller decides how to default the missing key.
     */
    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('CustomerController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data = $this->validatePayload($request, null, $clientId, $branchId);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            // Allocate the user-facing C-### code PER CLIENT (not from the
            // global autoincrement id). The old id-based code leaked the
            // cross-tenant sequence into every client's list — Client A
            // would see C-009 → C-060 with gaps because the numbers in
            // between belonged to other tenants. We serialise the
            // allocation with a row lock on the owning client (same pattern
            // QuotationController uses for QT/PI codes) so two concurrent
            // inserts can't grab the same number.
            if ($clientId !== null) {
                DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
            }
            $code = $this->nextCustomerCode($clientId, $branchId);

            $customer = Customer::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'     => optional($user)->id,
                'customer_code'  => $code,
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'gst_applicable' => $data['gst_applicable'] ?? null,
                // Only keep a GST number when GST is applicable.
                'gst_number'     => ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? 'Active',
                // A brand-new customer is never mapped to a lead yet. Set
                // explicitly rather than leaning on the column default so the
                // create response carries the real value back to the form.
                'is_map_lead'    => 'No',
            ]);

            // Primary address row — always exactly one.
            CustomerAddress::create(array_merge($primary, [
                'customer_id' => $customer->id,
                'is_primary'  => true,
            ]));

            // Additional locations
            foreach ($data['locations'] ?? [] as $loc) {
                CustomerAddress::create(array_merge($loc, [
                    'customer_id' => $customer->id,
                    'is_primary'  => false,
                ]));
            }

            return $customer->load(['primaryAddress', 'addresses']);
        });

        return response()->json(['data' => $this->shape($row)], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validatePayload($request, (int) $customer->id, $customer->client_id, $customer->branch_id);

        // Segment-document protection: a segment that already has uploaded
        // documents cannot be removed from the customer (its evidence would be
        // orphaned). Reject the edit naming the offending segment(s).
        $blockedSegments = \App\Support\SegmentGuard::blockedRemovals(
            \App\Models\Customer::class,
            (int) $customer->id,
            (int) $customer->client_id,
            $customer->segment,
            $data['segment'] ?? null,
        );
        if (!empty($blockedSegments)) {
            return response()->json([
                'message' => 'Cannot remove the segment(s): ' . implode(', ', $blockedSegments)
                    . ' — documents have already been uploaded for them. Remove those documents first.',
                'errors'  => ['segment' => ['Segment(s) with uploaded documents cannot be removed: ' . implode(', ', $blockedSegments) . '.']],
            ], 422);
        }

        /* Country/consignee compatibility — the mirror of the guard
         * ConsigneeController runs on its own pivot writes. Without this the
         * rule was enforced on only one side: the consignee door was locked
         * while the customer door stood open, so flipping an India customer to
         * a foreign country silently stranded every India consignee mapped to
         * it. (Live data already contained one such pair, created exactly this
         * way.) */
        if ($denial = $this->consigneeCountryDenial($customer, $data['primary_address']['country'] ?? null)) {
            return $denial;
        }

        /* Country freeze once the customer has been used to raise a lead. */
        if ($denial = $this->mappedLeadCountryDenial($customer, $data['primary_address']['country'] ?? null)) {
            return $denial;
        }

        $row = DB::transaction(function () use ($customer, $data) {
            $primary = $data['primary_address'];

            $customer->update([
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'gst_applicable' => $data['gst_applicable'] ?? null,
                // Only keep a GST number when GST is applicable.
                'gst_number'     => ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? $customer->status,
            ]);

            // Propagate the customer's (possibly new) segment set to every
            // consignee mapped to it. A consignee mirrors the union of its
            // customers' segments (see ConsigneeController / SegmentGuard), so a
            // segment added here must surface on those consignees at once —
            // otherwise it would only appear the next time each consignee is
            // saved. Runs inside the same transaction so the two never drift.
            $this->syncMappedConsigneeSegments($customer->fresh());

            // The customer's GST number is the single source of truth. When it
            // changes, keep the existing GST Scrutiny records in sync so they
            // don't drift to the old number (the scrutiny form shows it read-
            // only). Only propagate a real number (Applicable = Yes).
            $newGst = ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null;
            if ($newGst) {
                CustomerGstScrutiny::where('customer_id', $customer->id)
                    ->where('gst_number', '!=', $newGst)
                    ->update(['gst_number' => $newGst]);
            }

            // Replace-all strategy on addresses: nuke + recreate from the
            // payload. Customer addresses don't have hard FK dependents
            // (they live under cascadeOnDelete from customer), so this
            // is safe and keeps the update path simple. If/when the
            // addresses get referenced elsewhere (shipments etc.) this
            // becomes a diff-by-id sync.
            CustomerAddress::where('customer_id', $customer->id)->delete();
            CustomerAddress::create(array_merge($primary, [
                'customer_id' => $customer->id,
                'is_primary'  => true,
            ]));
            foreach ($data['locations'] ?? [] as $loc) {
                CustomerAddress::create(array_merge($loc, [
                    'customer_id' => $customer->id,
                    'is_primary'  => false,
                ]));
            }

            return $customer->load(['primaryAddress', 'addresses']);
        });

        // Keep any same-as-customer consignee's CORE details (company/legal
        // name, segment, classification, risk, website, email + primary
        // address) in lock-step with the customer. Best-effort — a mirror
        // hiccup must never fail the customer save.
        try {
            app(\App\Services\ConsigneeKycMirror::class)->syncCoreFromCustomer($row, $user?->id);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Consignee core mirror failed: ' . $e->getMessage());
        }

        return response()->json(['data' => $this->shape($row)]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }

        \Illuminate\Support\Facades\DB::transaction(function () use ($customer) {
            // Many-to-many unlink: a consignee mapped to this customer stays
            // alive if it's still mapped to others (primary reassigned when the
            // deleted customer was its primary); a consignee left with NO
            // customers is soft-deleted.
            foreach ($customer->consignees()->get() as $consignee) {
                $consignee->customers()->detach($customer->id);
                $remaining = $consignee->customers()->pluck('customers.id')->all();
                if (empty($remaining)) {
                    $consignee->delete();
                } elseif ((int) $consignee->customer_id === (int) $customer->id) {
                    $consignee->update(['customer_id' => $remaining[0]]);
                }
            }

            $customer->delete();
        });

        return response()->json(['id' => $customer->id, 'deleted' => true]);
    }

    /**
     * Re-derive the segment of every consignee mapped to this customer from the
     * union of its customers' segments, so a segment added to the customer shows
     * on its consignees immediately (they must never drift — see
     * ConsigneeController). Any segment that still has uploaded documents on a
     * consignee is preserved so re-derivation can never orphan its evidence.
     */
    private function syncMappedConsigneeSegments(Customer $customer): void
    {
        foreach ($customer->consignees()->get() as $consignee) {
            $custIds = $consignee->customers()->pluck('customers.id')->all();
            $derived = \App\Support\SegmentGuard::forCustomers($custIds);
            // Keep any removed segment that still has uploaded documents so we
            // never orphan a consignee's evidence.
            $keep = \App\Support\SegmentGuard::blockedRemovals(
                \App\Models\Consignee::class,
                (int) $consignee->id,
                (int) $consignee->client_id,
                $consignee->segment,
                $derived,
            );
            $names = array_values(array_unique(array_merge(
                \App\Support\SegmentGuard::names($derived),
                $keep,
            )));
            $consignee->update(['segment' => $names ? implode(', ', $names) : null]);
        }
    }

    /**
     * Live "is this GSTIN free?" check for the Add/Edit Customer form.
     *
     * Purely a UX affordance — it tells the user a number is taken BEFORE
     * they fill the rest of the form. It is NOT the guard: two users can
     * pass this check in the same second and both submit, so the closure
     * rule in validatePayload() is what actually enforces uniqueness.
     *
     * Scope: client + branch, resolved from the authenticated user via
     * resolveOwnership() so it matches store()/update() exactly (a GSTIN may
     * legitimately repeat across branches, but not within one). Never trust a
     * client_id/branch_id from the request.
     *
     * Returns the holder's name so the UI can say WHO has it — deliberately
     * limited to the caller's own branch, so nothing leaks across tenants.
     */
    public function gstAvailable(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $gst = strtoupper(trim((string) $request->query('gst_number', '')));
        if ($gst === '') {
            return response()->json(['data' => ['available' => true, 'taken_by' => null]]);
        }

        $ignoreId = (int) $request->query('ignore_id', 0);

        $row = Customer::query()
            ->whereNull('deleted_at')
            ->where('gst_number', $gst)
            ->where(function ($q) use ($clientId) {
                $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
            })
            ->where(function ($q) use ($branchId) {
                $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
            })
            ->when($ignoreId > 0, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->first(['id', 'company_name', 'legal_name']);

        return response()->json(['data' => [
            'available' => $row === null,
            'taken_by'  => $row ? ($row->legal_name ?: $row->company_name) : null,
        ]]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GST Scrutiny — one row per GST number a domestic customer is
     * registered under. Mirrors VendorController's gst-scrutiny CRUD.
     * Each row persists on its own (separate from the Stage 1 save), so
     * the popup can add/remove entries without resubmitting the whole
     * customer. Tenant scope rides on Customer::forUser + hierarchical
     * edit denial, identical to the vendor side.
     * ────────────────────────────────────────────────────────────────── */

    public function indexGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->with('gstScrutiny')->findOrFail($id);
        return response()->json(['data' => $customer->gstScrutiny->map(fn ($g) => $this->shapeGst($g))->all()]);
    }

    public function storeGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateGst($request, $customer->id);
        $row = CustomerGstScrutiny::create([
            'customer_id'             => $customer->id,
            'gst_number'              => strtoupper($data['gst_number']),
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
            'created_by'              => $user->id,
        ]);

        return response()->json(['data' => $this->shapeGst($row)], 201);
    }

    public function updateGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = CustomerGstScrutiny::where('customer_id', $customer->id)->findOrFail($gstId);
        $data = $this->validateGst($request, $customer->id, $row->id);
        $row->update([
            'gst_number'              => strtoupper($data['gst_number']),
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
        ]);

        return response()->json(['data' => $this->shapeGst($row->fresh())]);
    }

    public function destroyGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        CustomerGstScrutiny::where('customer_id', $customer->id)->findOrFail($gstId)->forceDelete();
        return response()->json(['message' => 'GST scrutiny deleted']);
    }

    private function validateGst(Request $request, int $customerId, ?int $ignoreId = null): array
    {
        // Normalise to uppercase before the unique check so a lowercase
        // duplicate (e.g. via API) still collides with the stored value.
        $request->merge(['gst_number' => strtoupper((string) $request->input('gst_number'))]);

        return $request->validate([
            // 15-char GSTIN: 2-digit state code, 10-char PAN, entity char,
            // 'Z', checksum char (e.g. 27AADCI6120M1ZH). A GSTIN belongs to
            // ONE customer only — unique ACROSS customers. The SAME customer
            // may repeat it across periodic scrutiny entries, so its own rows
            // are excluded from the check (one customer ↔ one GST).
            'gst_number'              => [
                'required', 'string',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/',
                Rule::unique('customer_gst_scrutiny', 'gst_number')
                    ->where(fn ($q) => $q->where('customer_id', '!=', $customerId)->whereNull('deleted_at')),
            ],
            'status'                  => ['nullable', Rule::in(['Active', 'Inactive'])],
            'last_filing_date'        => 'nullable|date',
            'prev_non_gst_2a_invoice' => 'nullable|string|max:255',
            'red_flags'               => 'nullable|string|max:2000',
        ], [
            'gst_number.regex'  => 'Invalid GST format. Expected 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, Z, 1 digit/letter (e.g. 27AADCI6120M1ZH).',
            'gst_number.unique' => 'This GST number is already registered to another customer.',
        ]);
    }

    private function shapeGst(CustomerGstScrutiny $g): array
    {
        return [
            'id'                       => $g->id,
            'gst_number'               => $g->gst_number,
            'status'                   => $g->status,
            'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
            'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
            'red_flags'                => $g->red_flags,
        ];
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Reshape a Customer + addresses to the frontend contract — the
     * list page and modal both read these keys.
     */
    /**
     * Blocks a customer country change that would strand its mapped consignees.
     *
     * The rule is the same one ConsigneeController enforces from the other
     * side: an India customer may only be mapped to India consignees, and a
     * non-India customer only to non-India ones. It compares domestic-NESS, not
     * country strings — a USA customer shipping to a UAE consignee is
     * legitimate; only the India boundary matters.
     *
     * Fires ONLY when the incoming country actually flips domestic-ness. Two
     * reasons, both deliberate:
     *   • An edit that doesn't touch the country can't create a violation, so
     *     re-validating it would be pointless work.
     *   • More importantly, a customer whose mappings ALREADY violate the rule
     *     (they predate the guard) must stay editable. Checking unconditionally
     *     would block every future save on that record over a mismatch its
     *     editor didn't cause and often can't see from this screen.
     * Pre-existing violations are therefore left alone here; repairing them is
     * a data decision, not something an unrelated edit should force.
     *
     * @return JsonResponse|null 422 when the change is refused, null to proceed.
     */
    private function consigneeCountryDenial(Customer $customer, ?string $newCountry): ?JsonResponse
    {
        $wasDomestic = Gst::isDomestic(optional($customer->primaryAddress)->country);
        $nowDomestic = Gst::isDomestic($newCountry);

        if ($wasDomestic === $nowDomestic) return null;   // country side unchanged

        $stranded = [];
        foreach ($customer->consignees()->with('primaryAddress:id,consignee_id,country')->get() as $cn) {
            $cnCountry = optional($cn->primaryAddress)->country;
            if (Gst::isDomestic($cnCountry) !== $nowDomestic) {
                $stranded[] = $cn->company_name . ' (' . (trim((string) $cnCountry) ?: 'no country') . ')';
            }
        }

        if (empty($stranded)) return null;

        $to = $nowDomestic ? 'India' : (trim((string) $newCountry) ?: 'no country');
        return response()->json([
            'message' => 'Cannot change this customer\'s country to ' . $to . ' — it is mapped to consignee(s) on the other side of the India border: '
                . implode(', ', $stranded) . '. Unmap them first, or change their country to match.',
            'errors'  => ['primary_address.country' => ['Customer and consignee must both be in India, or both outside it.']],
        ], 422);
    }

    /**
     * Blocks a country change on a customer that is already mapped to a lead.
     *
     * Creating an opportunity against a customer copies its country onto the
     * lead (sender_country_name / sender_country_iso) and from there the whole
     * downstream chain hangs off it — GST applicability, the India/non-India
     * consignee pairing rule, quotation and PI costing. Those snapshots are
     * never re-read from the customer, so moving the country afterwards leaves
     * every existing opportunity quoting a country the customer no longer has.
     *
     * The flag (`customers.is_map_lead`) is set by SalesLeadController the
     * moment a lead is created against or re-pointed at the customer.
     *
     * Compares the trimmed strings case-insensitively so a re-save that posts
     * the country back unchanged (the normal edit path — the field is locked
     * in the UI but still submitted) passes through untouched.
     *
     * @return JsonResponse|null 422 when the change is refused, null to proceed.
     */
    private function mappedLeadCountryDenial(Customer $customer, ?string $newCountry): ?JsonResponse
    {
        if (($customer->is_map_lead ?? 'No') !== 'Yes') {
            return null;
        }

        $current = trim((string) optional($customer->primaryAddress)->country);
        $next    = trim((string) $newCountry);

        if (strcasecmp($current, $next) === 0) {
            return null;   // unchanged — nothing to refuse
        }

        return response()->json([
            'message' => 'Country cannot be changed — this customer is already mapped to one or more leads'
                . ($current !== '' ? ' with the country "' . $current . '"' : '')
                . '. Existing opportunities, quotations and proforma invoices were raised against it.',
            'errors'  => ['primary_address.country' => ['Locked: the customer is mapped to a lead.']],
        ], 422);
    }

    private function shape(Customer $c): array
    {
        /* Derive `primary` from the already-loaded `addresses`
         * collection so we don't trigger a separate
         * `primaryAddress` SELECT for every customer in the list
         * (used to be the source of an N+1 — fixed by dropping the
         * `with(['primaryAddress'])` in index() and keeping just
         * `with(['addresses'])`). The `addresses` HasMany already
         * orders by `is_primary DESC` so the first row is the
         * primary one if any exists. Falls back to the standalone
         * `primaryAddress` lookup only when `addresses` isn't
         * eager-loaded (i.e. show() or freshly-loaded create
         * responses that opted into the explicit load). */
        $primary = $c->relationLoaded('addresses')
            ? $c->addresses->firstWhere('is_primary', true)
            : $c->primaryAddress;
        return [
            'id'              => $c->customer_code ?: ('C-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
            'db_id'           => $c->id,
            'company'         => $c->company_name,
            'legalName'       => $c->legal_name,
            'type'            => $c->type,
            'segment'         => $c->segment,
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'gstApplicable'   => $c->gst_applicable,
            'gstNumber'       => $c->gst_number,
            'website'         => $c->website,
            'status'          => $c->status,
            // 'Yes' once an opportunity has been raised against this customer.
            // The edit form reads it to lock the Country field (see
            // mappedLeadCountryDenial for the server-side half of the rule).
            'isMapLead'       => $c->is_map_lead ?: 'No',
            'country'         => $primary?->country,
            // Short ISO code (e.g. "United Arab Emirates" → "AE") resolved from
            // the countries master, so the list can show a compact, aligned
            // Country column instead of long full names (QA #20). Null when the
            // stored value doesn't match any master country — the UI then falls
            // back to the raw value.
            'country_iso'     => \App\Models\Masters\Countries::isoFor($primary?->country),
            'state'           => $primary?->state,
            'stateCode'       => $primary?->state_code,
            'city'            => $primary?->city,
            'pin'             => $primary?->pin,
            'addr'            => $primary?->address_line,
            'addrType'        => $primary?->type,
            'contact'         => $primary?->cp_name,
            'cpDesig'         => $primary?->cp_designation,
            'phone'           => $primary?->cp_contact,
            'email'           => $primary?->cp_email,
            'whatsapp'        => $primary?->cp_whatsapp === 'yes' ? 'Yes' : ($primary?->cp_whatsapp === 'no' ? 'No' : null),
            // Eager-counted via `withCount('consignees')` on the index
            // query so the list page doesn't N+1. Falls back to 0 for
            // show() / store() / update() responses that don't load the count.
            'consignees'      => (int) ($c->consignees_count ?? 0),
            // Fresh vs Recurring bucket — true when the customer has ≥1
            // non-deleted lead (see the is_recurring addSelect in index()).
            // Lets the frontend split + count the tabs without a per-tab fetch.
            // Guarded because show/store/update don't select the flag.
            'recurring'       => (bool) ($c->is_recurring ?? false),
            // True when at least one consignee linked to this customer was
            // created with the "Same as Customer" toggle on — editing the
            // customer's Stage 1 fields would semantically affect those
            // mirrored consignees, so the UI prompts before opening edit.
            'hasSameAsCustomerConsignees' => ((int) ($c->same_as_customer_consignees_count ?? 0)) > 0,
            'sameAsCustomerConsigneeCount' => (int) ($c->same_as_customer_consignees_count ?? 0),
            'locations'       => $c->addresses
                ->where('is_primary', false)
                ->values()
                ->map(fn ($a) => $this->shapeAddress($a))
                ->all(),
            'primary_address' => $primary ? $this->shapeAddress($primary) : null,
        ];
    }

    private function shapeAddress(CustomerAddress $a): array
    {
        return [
            'id'             => $a->id,
            'type'           => $a->type,
            'address_line'   => $a->address_line,
            'country'        => $a->country,
            'state'          => $a->state,
            'state_code'     => $a->state_code,
            'city'           => $a->city,
            'pin'            => $a->pin,
            'cp_name'        => $a->cp_name,
            'cp_designation' => $a->cp_designation,
            'cp_contact'     => $a->cp_contact,
            'cp_email'       => $a->cp_email,
            'cp_whatsapp'    => $a->cp_whatsapp,
        ];
    }

    /**
     * Validate the incoming POST / PUT body. Returns the validated
     * array (nested primary_address + locations preserved).
     *
     * `primary_email` uniqueness is checked against customers within
     * the same client scope; super_admin globals (client_id null) live
     * in their own bucket.
     */
    private function validatePayload(Request $request, ?int $customerId, $clientId, $branchId = null): array
    {
        // Normalise the GST number to uppercase before validation so a
        // lowercase entry still satisfies the [A-Z] GSTIN regex.
        if ($request->filled('gst_number')) {
            $request->merge(['gst_number' => strtoupper(trim((string) $request->input('gst_number')))]);
        }

        /* GST applicability is DERIVED from the primary address country, never
         * taken from the request: India → GST applies, anything else → it
         * doesn't. Overwriting the incoming value here (rather than validating
         * it) is what makes the invariant hold for EVERY caller — the modal
         * derives the same value for display, but a direct API call could
         * otherwise store India + 'No' and sales/P2P read this flag straight
         * from the column. Merging before validate() also means the existing
         * required_if:gst_applicable,Yes rule below now keys off the country
         * without needing to be rewritten. */
        $request->merge([
            'gst_applicable' => Gst::applicableFor($request->input('primary_address.country')),
        ]);

        $data = $request->validate([
            'company_name'   => 'required|string|max:255',
            /* Legal (registered entity) name must be unique per tenant — two
             * customers can't share the same legal name. Case-insensitive,
             * client-scoped, ignores the row being edited, and skips the check
             * when blank (legal_name stays optional). */
            'legal_name'     => [
                'nullable', 'string', 'max:255',
                function ($attribute, $value, $fail) use ($clientId, $customerId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\Customer::query()
                        ->whereNull('deleted_at')
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->whereRaw('LOWER(legal_name) = ?', [mb_strtolower(trim((string) $value))])
                        ->when($customerId, fn ($q) => $q->where('id', '!=', $customerId))
                        ->exists();
                    if ($exists) {
                        $fail('This legal name is already used by another customer.');
                    }
                },
            ],
            'type'           => 'nullable|string|max:64',
            'segment'        => 'nullable|string|max:1024',
            'classification' => 'nullable|string|max:64',
            'risk_level'     => 'nullable|string|max:32',
            /* Stage 1 — domestic GST flag. 'Yes' gates the GST Scrutiny popup.
             * Derived from primary_address.country in the merge() above, so by
             * the time this rule runs the value is ours, not the caller's. The
             * rule stays as a tripwire: if the merge is ever removed, a bad
             * value fails loudly here instead of reaching the column. */
            'gst_applicable' => ['nullable', Rule::in(['Yes', 'No'])],
            // GST number captured on the customer itself when GST Applicable =
            // Yes; auto-fills the GST Scrutiny form. Required + strict GSTIN
            // format only when applicable (same regex as the scrutiny check).
            'gst_number'     => [
                'nullable', 'required_if:gst_applicable,Yes', 'string',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/',
                /* A GSTIN identifies ONE legal entity, so it can't repeat within
                 * a branch. Branches of the same client are independent address
                 * books, so the SAME GSTIN may legitimately appear once under
                 * each — same branch-scoped reasoning as the primary phone /
                 * email rules below. Closure (not Rule::unique) so the check can
                 * skip itself when GST Applicable = No: the field is hidden then
                 * and the controller stores null anyway, so a stale number left
                 * in the payload must not trip a duplicate error. */
                function ($attribute, $value, $fail) use ($request, $clientId, $customerId, $branchId) {
                    if ($request->input('gst_applicable') !== 'Yes') return;
                    $v = strtoupper(trim((string) $value));
                    if ($v === '') return;
                    $exists = \App\Models\Customer::query()
                        ->whereNull('deleted_at')
                        ->where('gst_number', $v)
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->where(function ($q) use ($branchId) {
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                        })
                        ->when($customerId, fn ($q) => $q->where('id', '!=', $customerId))
                        ->exists();
                    if ($exists) {
                        $fail('This GST Number is already used by another customer in this branch.');
                    }
                },
                /* The GSTIN's first 2 digits ARE the state code, so they must
                 * match the primary address's state. Resolved from the state
                 * NAME via the master table (not the request's state_code) so a
                 * direct API call can't slip a mismatched pair through by
                 * sending a state_code that doesn't belong to its state. Skipped
                 * when the master has no code for that state — only 10 of
                 * India's 36 are defined today, and blocking the rest would
                 * make them unsaveable. */
                function ($attribute, $value, $fail) use ($request) {
                    if ($request->input('gst_applicable') !== 'Yes') return;
                    $v = strtoupper(trim((string) $value));
                    if ($v === '') return;
                    $stateCode = Gst::stateCodeFor($request->input('primary_address.state'));
                    if ($stateCode && substr($v, 0, 2) !== $stateCode) {
                        $fail("GST state code (" . substr($v, 0, 2) . ") does not match the selected state's code ({$stateCode}).");
                    }
                },
            ],
            'website'        => 'nullable|string|max:500',
            'status'         => 'nullable|in:Active,Inactive',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|min:4|max:75',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            // GST state code auto-derived from the state (domestic addresses only).
            'primary_address.state_code'     => 'nullable|string|max:32',
            'primary_address.city'           => 'nullable|string|max:64',
            /* Country decides the rule — India → exactly 6 digits, elsewhere →
             * letters/digits/spaces/hyphens up to 12. Same rule the shipment
             * module uses; see App\Support\PostalCode. */
            'primary_address.pin'            => [
                'nullable', 'string',
                PostalCode::rule(fn () => $request->input('primary_address.country')),
            ],
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            /* Primary phone must be unique within the SAME BRANCH (not the whole
             * client) — two branches of one client are independent, so the same
             * contact phone is allowed to appear once under each branch. Closure
             * rule because the column lives on `customer_addresses` (not the
             * customers table) and we only want to block duplicates among the
             * *primary* address row per customer. */
            'primary_address.cp_contact'     => [
                'required', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/',
                function ($attribute, $value, $fail) use ($clientId, $customerId, $branchId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\CustomerAddress::query()
                        ->where('cp_contact', $value)
                        ->where('is_primary', true)
                        ->whereHas('customer', function ($q) use ($clientId, $customerId, $branchId) {
                            $q->whereNull('deleted_at');
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                            if ($customerId) $q->where('id', '!=', $customerId);
                        })
                        ->exists();
                    if ($exists) {
                        $fail('This phone number is already used by another customer in this branch.');
                    }
                },
            ],
            // Standard email format — username@domain.extension. Allows
            // digit-containing domains (office365.com, 7eleven.com) but
            // still rejects malformed inputs like "x@.com", "x@gmail",
            // or "x@gmail.c". Frontend uses the same regex inline.
            'primary_address.cp_email'       => [
                'required', 'email', 'max:255',
                'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/',
                // Unique within the SAME BRANCH (not the whole client) — mirrors
                // the phone rule so the same contact can exist once per branch.
                Rule::unique('customers', 'primary_email')
                    ->where(function ($q) use ($clientId, $branchId) {
                        $q->whereNull('deleted_at');
                        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                    })
                    ->ignore($customerId),
            ],
            'primary_address.cp_whatsapp'    => 'nullable|in:yes,no',

            'locations'                  => 'sometimes|array',
            'locations.*.type'           => 'required_with:locations|string|max:64',
            'locations.*.address_line'   => 'required_with:locations|string|min:4|max:75',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            // Country lives on the same row, so the rule reads it per index.
            'locations.*.pin'            => ['nullable', 'string', PostalCode::locationRule($request->all())],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => ['nullable', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/'],
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ], [
            /* The rule keys off gst_applicable, but that's derived now — the
             * user never sees such a field, so the default "…when gst applicable
             * is Yes" would name a control that isn't on screen. Point at the
             * country, which is what they actually chose. */
            'gst_number.required_if' => 'GST Number is required for an India (domestic) customer.',
            'gst_number.regex'       => 'Invalid GST format. Expected 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, Z, 1 digit/letter (e.g. 27AADCI6120M1ZH).',
        ]);

        /* GST state code is DERIVED from the state, for the same reason
         * gst_applicable is: sales/P2P compare the buyer's code to the
         * seller's to pick IGST vs CGST+SGST, so it can't be a value the
         * caller supplies. The form auto-fills it read-only; this makes that
         * authoritative rather than advisory.
         *
         * Only for a domestic address — the code master holds India's states
         * only, and matching is by NAME, so a non-India state that happens to
         * share a name (Punjab exists in Pakistan too) would otherwise pick up
         * an Indian code. Null when the master has no code for the state. */
        $data['primary_address']['state_code'] = Gst::isDomestic($data['primary_address']['country'] ?? null)
            ? Gst::stateCodeFor($data['primary_address']['state'] ?? null)
            : null;

        /* Cross-row uniqueness within the payload. Catches the case
         * where the user reuses the primary contact's email/phone on
         * an additional location (or duplicates across two additional
         * locations) — the same address book can't list one person
         * under two different addresses. Errors are keyed by the
         * `locations.{i}.cp_email` / `cp_contact` paths so the
         * frontend's 422 mapper lands them on the right field. */
        $primary       = $data['primary_address'] ?? [];
        $seenEmails    = [];
        $seenPhones    = [];
        $primaryEmail  = strtolower(trim((string) ($primary['cp_email']   ?? '')));
        $primaryPhone  = trim((string) ($primary['cp_contact'] ?? ''));
        if ($primaryEmail) $seenEmails[$primaryEmail] = 'primary_address';
        if ($primaryPhone) $seenPhones[$primaryPhone] = 'primary_address';
        $errors = [];
        foreach ($data['locations'] ?? [] as $i => $loc) {
            $email = strtolower(trim((string) ($loc['cp_email']   ?? '')));
            $phone = trim((string) ($loc['cp_contact'] ?? ''));
            if ($email && isset($seenEmails[$email])) {
                $errors["locations.{$i}.cp_email"]   = ['This email is already used by another address on this customer.'];
            }
            if ($phone && isset($seenPhones[$phone])) {
                $errors["locations.{$i}.cp_contact"] = ['This phone number is already used by another address on this customer.'];
            }
            if ($email) $seenEmails[$email] = "locations.{$i}";
            if ($phone) $seenPhones[$phone] = "locations.{$i}";
        }
        if (!empty($errors)) {
            throw \Illuminate\Validation\ValidationException::withMessages($errors);
        }

        return $data;
    }

    /**
     * Resolve `[client_id, branch_id]` for the row being inserted.
     * Only used by store() — tenant *visibility* is handled by the
     * Customer::scopeForUser() Eloquent scope.
     */
    private function resolveOwnership($user): array
    {
        if (!$user) return [null, null];
        if ($user->user_type === 'super_admin') return [null, null];
        $clientId = $user->client_id ?? ($user->branch?->client_id);
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }

    /**
     * Next per-client customer code (C-001, C-002 …).
     *
     * Codes are sequential WITHIN a tenant, not global — so every client
     * gets a clean gap-free list. The caller holds a lockForUpdate on the
     * owning `clients` row (the super_admin null-client bucket excepted),
     * which serialises concurrent allocations. Scans `withTrashed` so a
     * soft-deleted customer's number is never reused — keeping codes a
     * stable per-tenant audit trail.
     */
    private function nextCustomerCode($clientId, $branchId = null): string
    {
        // Per-branch sequence: each branch owns its own C-001, C-002 … run.
        $codes = Customer::withTrashed()
            ->when(
                $clientId === null,
                fn ($q) => $q->whereNull('client_id'),
                fn ($q) => $q->where('client_id', $clientId)
            )
            ->when(
                $branchId === null,
                fn ($q) => $q->whereNull('branch_id'),
                fn ($q) => $q->where('branch_id', $branchId)
            )
            ->pluck('customer_code');

        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^C-0*(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }

        return 'C-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /customers/master-bundle
     *
     * Bundle every master dropdown the Add Customer / Add Consignee modal
     * needs into ONE response. Replaces 9 separate round-trips:
     *   /master/customer_types, /master/segments, /master/customer_classifications,
     *   /master/risk_levels, /master/address_types, /master/countries,
     *   /master/states, /master/designations, /master/document_type
     *
     * Shared between BOTH customer flows — opening Add Customer warms the
     * cache for Add Consignee (and vice versa) since their dropdown
     * needs overlap by 8 of 9 masters. `customer_types` is unused by the
     * consignee modal but is so small (~10 rows) that including it for
     * cache parity costs nothing.
     *
     * Cached server-side via Cache::remember (5-min TTL, per-user). Masters
     * change rarely, so the cache absorbs the bulk of repeat opens. The
     * frontend mirrors this with a sessionStorage cache in
     * customerBundleCache.ts.
     *
     * Status filtering is case-insensitive because clm_segments uses
     * 'active'/'inactive' while master_* tables use 'Active'/'Inactive'.
     * Segments projects `name` (the real column) — the model's `title`
     * accessor surfaces it as `title` in JSON for legacy consumers.
     * ────────────────────────────────────────────────────────────── */
    public function masterBundle(Request $request): JsonResponse
    {
        $user = $request->user();
        $cacheKey = MasterBundleCache::key('customer:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            // Tenant scope — apply MasterVisibility::applyReadScope to every
            // master query, matching the gate /master/{slug} uses. Without
            // this a client_admin of Client A would see Client B's
            // tenant-scoped master rows via the bundle endpoint. Per-user
            // cache key is a second line of defence.
            $scope = fn ($q) => MasterVisibility::applyReadScope($q, $user);

            $active = function (string $modelClass, array $cols) use ($scope) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('id')
                    ->get($cols);
            };

            // Only offer segments that have at least one document configured in
            // their DCP rule (mandatory or optional) — a segment with no docs
            // attached has nothing to drive the customer's KYC/DD/TL/QC stage,
            // so it must not appear in the Customer Segment picker.
            $segmentIdsWithDocs = DB::table('clm_segment_rules')
                ->when($user, fn ($q) => $q->where('client_id', $user->client_id))
                ->whereRaw('(COALESCE(mandatory_count, 0) + COALESCE(optional_count, 0)) > 0')
                ->distinct()
                ->pluck('segment_id')
                ->all();
            $segments = Segments::query()
                ->whereRaw('LOWER(status) = ?', ['active'])
                ->tap($scope)
                ->whereIn('id', $segmentIdsWithDocs ?: [0])
                ->orderBy('id')
                ->get(['id', 'name', 'code']);

            return [
                'customer_types'           => $active(CustomerTypes::class,           ['id', 'name']),
                'segments'                 => $segments,
                'customer_classifications' => $active(CustomerClassifications::class, ['id', 'name']),
                'risk_levels'              => $active(RiskLevels::class,              ['id', 'name']),
                'address_types'            => $active(AddressTypes::class,            ['id', 'name']),
                'countries'                => $active(Countries::class,               ['id', 'name']),
                'states'                   => $active(States::class,                  ['id', 'name', 'country_id']),
                // Drives the read-only State Code beside GST Number — the form
                // maps the chosen state to its GST code without a second call.
                // Same shape as the vendor bundle's state_codes.
                'state_codes'              => StateCodes::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->with('state:id,name,country_id')
                    ->orderBy('id')
                    ->get(['id', 'state_id', 'state_code', 'status']),
                'designations'             => $active(Designations::class,            ['id', 'name']),
                'document_type'            => $active(DocumentType::class,            ['id', 'title']),
            ];
        });

        return response()->json($bundle);
    }
}