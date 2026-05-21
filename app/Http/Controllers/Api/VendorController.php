<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Vendor;
use App\Models\VendorAddress;
use App\Models\VendorBankAccount;
use App\Models\VendorDocument;
use App\Models\VendorGstScrutiny;
use App\Models\VendorOwner;
use App\Models\VendorProductMapping;
use App\Support\MasterVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Vendor onboarding wizard — backend.
 *
 *   POST  /api/vendors/step/identity             create or update Stage 1
 *   PUT   /api/vendors/{vendor}/step/contacts    replace primary + extras
 *   PUT   /api/vendors/{vendor}/step/kyc         replace KYC sub-rows
 *   PUT   /api/vendors/{vendor}/step/products    replace product map, activate
 *
 *   GET    /api/vendors                          list (creator-hierarchy)
 *   GET    /api/vendors/{vendor}                 show with all relations
 *   DELETE /api/vendors/{vendor}                 soft delete
 *
 * Stage 3 (Trade Document Management) is intentionally not persisted —
 * those documents are stored elsewhere and the wizard just advances
 * past that tab on Save & Next.
 *
 * All write endpoints share the same conventions:
 *   - Tenant scope via Vendor::forUser($user) before findOrFail
 *   - Hierarchical edit denial via MasterVisibility::hierarchicalDenial
 *   - Per-file 2 MB cap (matches Products) so multipart uploads stay
 *     under PHP's default post_max_size
 *   - "Replace all" semantics on each step save: existing sub-rows are
 *     deleted (with their on-disk files) and the payload is re-inserted
 *     as the new source of truth. The wizard's modal-driven UX
 *     reloads the full collection on open, so partial updates aren't
 *     needed and the implementation stays simple.
 */
class VendorController extends Controller
{
    /** Per-file image / document cap in KB — mirrors ProductController. */
    private const MAX_UPLOAD_KB = 2048;

    /** Relations eager-loaded on GET /vendors/{id}. */
    private const SHOW_WITH = [
        'addresses',
        'documents.licenseType:id,name',
        'owners',
        'bankAccounts',
        'gstScrutiny',
        'productMappings.product:id,product_code,name',
        'vendorType:id,name',
        'riskLevel:id,name',
        'vendorBehaviour:id,name',
        'segment:id,title',
        'complianceBehaviour:id,name',
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
    ];

    /* ──────────────────────────────────────────────────────────────────
     * Read endpoints
     * ────────────────────────────────────────────────────────────── */

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Vendor::query()
            ->forUser($user)
            ->with([
                'primaryAddress:id,vendor_id,city,state_id,contact_name,email,contact_no',
                'vendorType:id,name',
                'segment:id,title',
                'riskLevel:id,name',
            ])
            ->withCount('productMappings')
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('company_name', 'ilike', "%{$search}%")
                  ->orWhere('legal_name',   'ilike', "%{$search}%")
                  ->orWhere('vendor_code',  'ilike', "%{$search}%")
                  ->orWhere('primary_email','ilike', "%{$search}%");
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }

        return response()->json($q->paginate((int) $request->query('per_page', 24)));
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->with(self::SHOW_WITH)->findOrFail($id);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }

        // Drop on-disk files before nuking the rows. The Vendor row is
        // soft-deleted (its child rows cascade), so files would
        // otherwise linger forever.
        $this->deleteAllVendorFiles($vendor);

        $vendor->delete();
        return response()->json(['id' => $vendor->id, 'deleted' => true]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Step 1 — Identity (Stage 1 sub-tab "Vendor Identification")
     *
     * Creates a new vendor on first call, updates on subsequent.
     * Returns the vendor id so the wizard can stamp it on its other
     * step calls.
     * ────────────────────────────────────────────────────────────── */
    public function storeIdentity(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'id'                       => 'nullable|integer|exists:vendors,id',
            'company_name'             => 'required|string|max:255',
            'legal_name'               => 'nullable|string|max:255',
            'website'                  => 'nullable|string|max:500',
            'vendor_type_id'           => 'nullable|integer|exists:master_vendor_types,id',
            'risk_level_id'            => 'nullable|integer|exists:master_risk_levels,id',
            'vendor_behaviour_id'      => 'nullable|integer|exists:master_vendor_behaviour,id',
            'segment_id'               => 'nullable|integer|exists:master_segments,id',
            'compliance_behaviour_id'  => 'nullable|integer|exists:master_compliance_behaviours,id',
        ]);

        if (isset($data['id'])) {
            $vendor = Vendor::query()->forUser($user)->findOrFail($data['id']);
            if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
                return response()->json(['message' => $denial], 403);
            }
            $vendor->fill($data);
            $vendor->step_completed = max((int) $vendor->step_completed, 1);
            $vendor->save();
        } else {
            $vendor = new Vendor($data);
            $vendor->client_id  = $user->client_id;
            $vendor->branch_id  = $user->branch_id;
            $vendor->created_by = $user->id;
            $vendor->status     = 'draft';
            $vendor->step_completed = 1;
            $vendor->save();
            // V-01, V-02 … computed after insert so a soft-deleted vendor
            // doesn't release its code back into the pool.
            $vendor->vendor_code = $this->nextVendorCode($user->client_id);
            $vendor->save();
        }

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Step 1 — Contacts (Stage 1 sub-tab "Address & Contact Persons")
     *
     * Replaces vendor_addresses: deletes the existing primary + extras
     * and re-inserts from the payload. The primary contact email is
     * mirrored back onto vendors.primary_email so the uniqueness check
     * stays a one-column lookup.
     * ────────────────────────────────────────────────────────────── */
    public function storeContacts(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'primary_address'                          => 'required|array',
            'primary_address.address_line'             => 'nullable|string|max:1000',
            'primary_address.country_id'               => 'nullable|integer|exists:master_countries,id',
            'primary_address.state_id'                 => 'nullable|integer|exists:master_states,id',
            'primary_address.state_code'               => 'nullable|string|max:32',
            'primary_address.city'                     => 'nullable|string|max:128',
            'primary_address.pincode'                  => 'nullable|string|max:16',
            'primary_address.contact_name'             => 'required|string|max:255',
            'primary_address.designation'              => 'nullable|string|max:128',
            'primary_address.contact_no'               => 'nullable|string|max:32',
            'primary_address.email'                    => 'nullable|email|max:255',
            'primary_address.whatsapp_enabled'         => 'nullable|boolean',

            'extra_contacts'                           => 'nullable|array',
            'extra_contacts.*.contact_name'            => 'required|string|max:255',
            'extra_contacts.*.designation'             => 'nullable|string|max:128',
            'extra_contacts.*.contact_no'              => 'nullable|string|max:32',
            'extra_contacts.*.email'                   => 'nullable|email|max:255',
            'extra_contacts.*.whatsapp_enabled'        => 'nullable|boolean',
            'extra_contacts.*.attachment_path'         => 'nullable|string|max:500',
        ]);

        DB::transaction(function () use ($vendor, $data) {
            // Wipe + re-insert. Vendor addresses don't have hard FK
            // dependents (uploads live alongside the row), so plain
            // delete is safe.
            $vendor->addresses()->delete();

            $primary = new VendorAddress(array_merge($data['primary_address'], [
                'vendor_id'  => $vendor->id,
                'is_primary' => true,
            ]));
            $primary->save();

            foreach ($data['extra_contacts'] ?? [] as $row) {
                VendorAddress::create(array_merge($row, [
                    'vendor_id'  => $vendor->id,
                    'is_primary' => false,
                ]));
            }

            // Mirror the primary contact's email onto the vendor row.
            $vendor->primary_email  = $data['primary_address']['email'] ?? null;
            $vendor->step_completed = max((int) $vendor->step_completed, 1);
            $vendor->save();
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Step 2 — KYC / Due Diligence (multipart)
     *
     * Five sub-collections in one request. Replace-all on every save:
     *   - on-disk files for rows that disappear are deleted
     *   - new rows pick up their file from the `*_files[<index>]` slot
     *
     * After a successful save the vendor's status is bumped from
     * 'draft' → 'inactive' (same flow as Product.storeQuality), so the
     * list page surfaces in-progress vendors under the Inactive tab
     * until Step 4 activates them.
     * ────────────────────────────────────────────────────────────── */
    public function storeKyc(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            // Company Due Diligence
            'due_diligence'                     => 'nullable|array',
            'due_diligence.*.code'              => 'nullable|string|max:32',
            'due_diligence.*.document_name'     => 'required|string|max:255',
            'due_diligence.*.issuing_authority' => 'nullable|string|max:255',
            'due_diligence.*.expiry'            => 'nullable|string|max:32',
            'due_diligence.*.mandatory'         => 'nullable|boolean',
            'due_diligence.*.existing_path'     => 'nullable|string|max:500',
            'dd_files'                          => 'nullable|array',
            'dd_files.*'                        => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            // Owner KYC
            'owner_kyc'                         => 'nullable|array',
            'owner_kyc.*.code'                  => 'nullable|string|max:32',
            'owner_kyc.*.document_name'         => 'required|string|max:255',
            'owner_kyc.*.issuing_authority'     => 'nullable|string|max:255',
            'owner_kyc.*.document_number'       => 'nullable|string|max:128',
            'owner_kyc.*.issue_date'            => 'nullable|date',
            'owner_kyc.*.expiry'                => 'nullable|string|max:32',
            'owner_kyc.*.status'                => ['nullable', Rule::in(['Active', 'Inactive'])],
            'owner_kyc.*.existing_path'         => 'nullable|string|max:500',
            'owner_files'                       => 'nullable|array',
            'owner_files.*'                     => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            // Trade License
            'trade_licenses'                          => 'nullable|array',
            'trade_licenses.*.code'                   => 'nullable|string|max:32',
            'trade_licenses.*.license_type_id'        => 'nullable|integer|exists:master_license_name,id',
            'trade_licenses.*.license_number'         => 'nullable|string|max:128',
            'trade_licenses.*.issuing_authority'      => 'nullable|string|max:255',
            'trade_licenses.*.issue_date'             => 'nullable|date',
            'trade_licenses.*.expiry_date'            => 'nullable|date',
            'trade_licenses.*.existing_path'          => 'nullable|string|max:500',
            'tl_files'                                => 'nullable|array',
            'tl_files.*'                              => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            // Bank Accounts
            'bank_accounts'                        => 'nullable|array',
            'bank_accounts.*.bank_name'            => 'required|string|max:255',
            'bank_accounts.*.branch_name'          => 'required|string|max:255',
            'bank_accounts.*.account_number'       => 'required|string|max:64',
            'bank_accounts.*.ifsc'                 => 'required|string|max:16',
            'bank_accounts.*.branch_address'       => 'nullable|string|max:500',
            'bank_accounts.*.existing_path'        => 'nullable|string|max:500',
            'cheque_files'                         => 'nullable|array',
            'cheque_files.*'                       => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            // GST Scrutiny
            'gst_scrutiny'                                 => 'nullable|array',
            'gst_scrutiny.*.gst_number'                    => 'required|string|max:16',
            'gst_scrutiny.*.status'                        => ['nullable', Rule::in(['Active', 'Suspended', 'Cancelled'])],
            'gst_scrutiny.*.last_filing_date'              => 'nullable|date',
            'gst_scrutiny.*.prev_non_gst_2a_invoice'       => 'nullable|string|max:255',
            'gst_scrutiny.*.red_flags'                     => 'nullable|string|max:2000',
        ]);

        DB::transaction(function () use ($vendor, $data, $request, $user) {
            $userId = $user?->id;

            // Snapshot existing file paths so the ones not preserved as
            // `existing_path` on the new payload get cleaned up.
            $keptPaths = collect();
            foreach (($data['due_diligence'] ?? [])  as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['owner_kyc'] ?? [])      as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['trade_licenses'] ?? []) as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['bank_accounts'] ?? [])  as $r) $keptPaths->push($r['existing_path'] ?? null);

            $oldPaths = collect()
                ->merge($vendor->documents()->pluck('attachment_path'))
                ->merge($vendor->owners()->pluck('attachment_path'))
                ->merge($vendor->bankAccounts()->pluck('cheque_path'));
            foreach ($oldPaths as $p) {
                if ($p && !$keptPaths->contains($p)) {
                    Storage::disk('public')->delete($p);
                }
            }

            // Hard delete so soft-deleted rows don't accumulate per save.
            $vendor->documents()->forceDelete();
            $vendor->owners()->forceDelete();
            $vendor->bankAccounts()->forceDelete();
            $vendor->gstScrutiny()->forceDelete();

            // ── Company Due Diligence ──
            foreach (($data['due_diligence'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "dd_files.$i", $vendor->id, 'dd', $row['existing_path'] ?? null);
                VendorDocument::create([
                    'vendor_id'         => $vendor->id,
                    'kind'              => 'dd',
                    'code'              => $row['code'] ?? null,
                    'document_name'     => $row['document_name'] ?? null,
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'expiry'            => $row['expiry'] ?? null,
                    'mandatory'         => (bool) ($row['mandatory'] ?? false),
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            // ── Owner KYC ──
            foreach (($data['owner_kyc'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "owner_files.$i", $vendor->id, 'owner', $row['existing_path'] ?? null);
                VendorOwner::create([
                    'vendor_id'         => $vendor->id,
                    'code'              => $row['code'] ?? null,
                    'document_name'     => $row['document_name'] ?? '',
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'document_number'   => $row['document_number'] ?? null,
                    'issue_date'        => $row['issue_date'] ?? null,
                    'expiry'            => $row['expiry'] ?? null,
                    'status'            => $row['status'] ?? 'Active',
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            // ── Trade Licenses ──
            foreach (($data['trade_licenses'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "tl_files.$i", $vendor->id, 'tl', $row['existing_path'] ?? null);
                VendorDocument::create([
                    'vendor_id'         => $vendor->id,
                    'kind'              => 'tl',
                    'code'              => $row['code'] ?? null,
                    'license_type_id'   => $row['license_type_id'] ?? null,
                    'license_number'    => $row['license_number'] ?? null,
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'issue_date'        => $row['issue_date'] ?? null,
                    'expiry_date'       => $row['expiry_date'] ?? null,
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            // ── Bank Accounts ──
            foreach (($data['bank_accounts'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "cheque_files.$i", $vendor->id, 'cheque', $row['existing_path'] ?? null);
                VendorBankAccount::create([
                    'vendor_id'      => $vendor->id,
                    'bank_name'      => $row['bank_name'],
                    'branch_name'    => $row['branch_name'],
                    'account_number' => $row['account_number'],
                    'ifsc'           => strtoupper($row['ifsc']),
                    'branch_address' => $row['branch_address'] ?? null,
                    'cheque_path'    => $path,
                    'created_by'     => $userId,
                ]);
            }

            // ── GST Scrutiny ──
            foreach (($data['gst_scrutiny'] ?? []) as $row) {
                VendorGstScrutiny::create([
                    'vendor_id'               => $vendor->id,
                    'gst_number'              => strtoupper($row['gst_number']),
                    'status'                  => $row['status'] ?? 'Active',
                    'last_filing_date'        => $row['last_filing_date'] ?? null,
                    'prev_non_gst_2a_invoice' => $row['prev_non_gst_2a_invoice'] ?? null,
                    'red_flags'               => $row['red_flags'] ?? null,
                    'created_by'              => $userId,
                ]);
            }

            $vendor->step_completed = max((int) $vendor->step_completed, 2);
            if ($vendor->status === 'draft') $vendor->status = 'inactive';
            $vendor->save();
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Step 4 — Product Mappings (final step)
     *
     * Replace-all. After saving the vendor is activated.
     * ────────────────────────────────────────────────────────────── */
    public function storeProducts(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'mappings'                    => 'required|array|min:1',
            'mappings.*.product_id'       => 'required|integer|exists:products,id',
            'mappings.*.batch_serial_lot' => 'nullable|string|max:128',
            'mappings.*.purchase_price'   => 'required|numeric|min:0',
            'mappings.*.gst_percentage'   => 'nullable|numeric|min:0',
            'mappings.*.gst_amount'       => 'nullable|numeric|min:0',
            'mappings.*.total_amount'     => 'nullable|numeric|min:0',
        ]);

        // Same-product-twice guard — mirrors the modal's duplicate check.
        $productIds = array_column($data['mappings'], 'product_id');
        if (count($productIds) !== count(array_unique($productIds))) {
            return response()->json([
                'message' => 'A product can only be mapped once per vendor.',
            ], 422);
        }

        DB::transaction(function () use ($vendor, $data, $user) {
            $userId = $user?->id;

            // Reset the vendor side. Any rows referencing this vendor
            // that aren't part of the resubmit get force-deleted so
            // the mirror on the product side can drop too.
            $vendor->productMappings()->forceDelete();

            // Snapshot of the vendor's identity to denormalise onto
            // product_vendor_maps. Cheap to do once outside the loop.
            $primary = $vendor->primaryAddress;
            $vendorSnapshot = [
                'vendor_id'      => $vendor->id,
                'vendor_code'    => $vendor->vendor_code,
                'vendor_name'    => $vendor->company_name,
                'vendor_website' => $vendor->website,
                'contact_person' => $primary?->contact_name,
                'contact_no'     => $primary?->contact_no,
                'email'          => $primary?->email ?? $vendor->primary_email,
                'designation'    => $primary?->designation,
            ];

            $nowMappedProductIds = [];

            foreach ($data['mappings'] as $row) {
                $productId = (int) $row['product_id'];
                $nowMappedProductIds[] = $productId;

                VendorProductMapping::create([
                    'vendor_id'        => $vendor->id,
                    'product_id'       => $productId,
                    'batch_serial_lot' => $row['batch_serial_lot'] ?? null,
                    'purchase_price'   => $row['purchase_price'],
                    'gst_percentage'   => $row['gst_percentage'] ?? 0,
                    'gst_amount'       => $row['gst_amount'] ?? 0,
                    'total_amount'     => $row['total_amount'] ?? $row['purchase_price'],
                    'created_by'       => $userId,
                ]);

                // Mirror onto product side. updateOrCreate so a
                // re-save doesn't duplicate the row for the same
                // (product, vendor) pair.
                \App\Models\ProductVendorMap::updateOrCreate(
                    ['product_id' => $productId, 'vendor_id' => $vendor->id],
                    array_merge($vendorSnapshot, [
                        'purchase_price' => $row['purchase_price'],
                        'gst_percentage' => $row['gst_percentage'] ?? 0,
                        'gst_amount'     => $row['gst_amount'] ?? 0,
                        'total_amount'   => $row['total_amount'] ?? $row['purchase_price'],
                        'map_date'       => now()->toDateString(),
                    ])
                );

                // Flip the product to Active once it has a vendor
                // mapped. Mirrors the end-state the product wizard
                // reaches after Step 4.
                $product = \App\Models\Product::find($productId);
                if ($product) {
                    $product->step_completed = max((int) $product->step_completed, 4);
                    if ($product->status !== 'active') {
                        $product->status = 'active';
                    }
                    $product->save();
                }
            }

            // Drop any product_vendor_maps that USED to mirror this
            // vendor but aren't in the current submit, so the two
            // tables stay symmetric.
            \App\Models\ProductVendorMap::where('vendor_id', $vendor->id)
                ->when(!empty($nowMappedProductIds), fn ($q) => $q->whereNotIn('product_id', $nowMappedProductIds))
                ->delete();

            $vendor->step_completed = 4;
            $vendor->status         = 'active';
            $vendor->save();
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Helpers
     * ────────────────────────────────────────────────────────────── */

    /** Compute the next vendor_code (V-01, V-02 …) scoped to one client.
     *
     *  Earlier this used `orderByDesc('id')->value('vendor_code')` which
     *  returns the most-recently-inserted code, not the numerically
     *  highest one — so a draft V-01 created after V-02 already
     *  existed would make this hand out V-02 again and trip the
     *  vendor_code unique index. We now scan every code (including
     *  soft-deleted) and pick the true max so the sequence is
     *  monotonic regardless of insert order. */
    private function nextVendorCode(?int $clientId): string
    {
        $codes = Vendor::withTrashed()
            ->where('client_id', $clientId)
            ->pluck('vendor_code');

        $max = 0;
        foreach ($codes as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'V-' . str_pad((string) ($max + 1), 2, '0', STR_PAD_LEFT);
    }

    /**
     * Resolve a file slot to a stored path: prefer a newly-uploaded
     * file at $inputKey, fall back to $existingPath when the caller
     * sent only a kept-path reference, else null.
     */
    private function absorbFile(Request $request, string $inputKey, int $vendorId, string $slug, ?string $existingPath): ?string
    {
        if ($request->hasFile($inputKey)) {
            $file = $request->file($inputKey);
            $ext  = $file->getClientOriginalExtension() ?: 'bin';
            // Encode the original filename into the stored name so the
            // frontend can show "PAN Card.pdf" instead of the random
            // collision-safe prefix. Format:
            //   {slug}-{rand}__{sanitized-original}.{ext}
            // The frontend `basename` strips everything up to and
            // including the "__" separator. We avoid a DB migration by
            // round-tripping the name through the filesystem path.
            $original = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);
            $safe = preg_replace('/[^A-Za-z0-9 ._-]/', '_', (string) $original);
            $safe = trim((string) $safe);
            if ($safe === '') {
                $safe = 'file';
            }
            $name = $slug . '-' . bin2hex(random_bytes(4)) . '__' . $safe . '.' . $ext;
            return $file->storeAs("vendor_documents/{$vendorId}", $name, 'public');
        }
        return $existingPath ?: null;
    }

    /** Best-effort cleanup of every file a vendor owns. Called on destroy. */
    private function deleteAllVendorFiles(Vendor $vendor): void
    {
        $paths = collect()
            ->merge($vendor->documents()->pluck('attachment_path'))
            ->merge($vendor->owners()->pluck('attachment_path'))
            ->merge($vendor->bankAccounts()->pluck('cheque_path'))
            ->merge($vendor->addresses()->pluck('attachment_path'))
            ->filter()
            ->unique();
        foreach ($paths as $p) {
            try { Storage::disk('public')->delete($p); } catch (\Throwable $e) { /* swallow */ }
        }
    }

    /** Shape a fully-loaded vendor for the SPA. Mirrors what
     *  AddVendorModal expects on edit. */
    private function shape(Vendor $v): array
    {
        $primary = $v->primaryAddress;
        return [
            'id'             => $v->id,
            'vendor_code'    => $v->vendor_code,
            'company_name'   => $v->company_name,
            'legal_name'     => $v->legal_name,
            'website'        => $v->website,
            'status'         => $v->status,
            'step_completed' => (int) $v->step_completed,
            'client_id'      => $v->client_id,
            'branch_id'      => $v->branch_id,
            'created_by'     => $v->created_by,
            'primary_email'  => $v->primary_email,

            // Master FK ids + labels (frontend may show either).
            'vendor_type_id'           => $v->vendor_type_id,
            'vendor_type_name'         => optional($v->vendorType)->name,
            'risk_level_id'            => $v->risk_level_id,
            'risk_level_name'          => optional($v->riskLevel)->name,
            'vendor_behaviour_id'      => $v->vendor_behaviour_id,
            'vendor_behaviour_name'    => optional($v->vendorBehaviour)->name,
            'segment_id'               => $v->segment_id,
            'segment_name'             => optional($v->segment)->title,
            'compliance_behaviour_id'  => $v->compliance_behaviour_id,
            'compliance_behaviour_name'=> optional($v->complianceBehaviour)->name,

            'primary_address' => $primary ? [
                'id'                => $primary->id,
                'address_line'      => $primary->address_line,
                'country_id'        => $primary->country_id,
                'state_id'          => $primary->state_id,
                'state_code'        => $primary->state_code,
                'city'              => $primary->city,
                'pincode'           => $primary->pincode,
                'contact_name'      => $primary->contact_name,
                'designation'       => $primary->designation,
                'contact_no'        => $primary->contact_no,
                'email'             => $primary->email,
                'whatsapp_enabled'  => (bool) $primary->whatsapp_enabled,
            ] : null,

            'extra_contacts' => $v->addresses->reject(fn ($a) => $a->is_primary)->values()->map(fn ($a) => [
                'id'                => $a->id,
                'contact_name'      => $a->contact_name,
                'designation'       => $a->designation,
                'contact_no'        => $a->contact_no,
                'email'             => $a->email,
                'whatsapp_enabled'  => (bool) $a->whatsapp_enabled,
                'attachment_path'   => $a->attachment_path,
                'attachment_url'    => file_url($a->attachment_path),
            ])->all(),

            'due_diligence' => $v->documents->where('kind', 'dd')->values()->map(fn ($d) => [
                'id'                => $d->id,
                'code'              => $d->code,
                'document_name'     => $d->document_name,
                'issuing_authority' => $d->issuing_authority,
                'expiry'            => $d->expiry,
                'mandatory'         => (bool) $d->mandatory,
                'attachment_path'   => $d->attachment_path,
                'attachment_url'    => file_url($d->attachment_path),
            ])->all(),

            'trade_licenses' => $v->documents->where('kind', 'tl')->values()->map(fn ($d) => [
                'id'                  => $d->id,
                'code'                => $d->code,
                'license_type_id'     => $d->license_type_id,
                'license_type_name'   => optional($d->licenseType)->name,
                'license_number'      => $d->license_number,
                'issuing_authority'   => $d->issuing_authority,
                'issue_date'          => optional($d->issue_date)->toDateString(),
                'expiry_date'         => optional($d->expiry_date)->toDateString(),
                'attachment_path'     => $d->attachment_path,
                'attachment_url'      => file_url($d->attachment_path),
            ])->all(),

            'owner_kyc' => $v->owners->map(fn ($o) => [
                'id'                => $o->id,
                'code'              => $o->code,
                'document_name'     => $o->document_name,
                'issuing_authority' => $o->issuing_authority,
                'document_number'   => $o->document_number,
                'issue_date'        => optional($o->issue_date)->toDateString(),
                'expiry'            => $o->expiry,
                'status'            => $o->status,
                'attachment_path'   => $o->attachment_path,
                'attachment_url'    => file_url($o->attachment_path),
            ])->all(),

            'bank_accounts' => $v->bankAccounts->map(fn ($b) => [
                'id'             => $b->id,
                'bank_name'      => $b->bank_name,
                'branch_name'    => $b->branch_name,
                'account_number' => $b->account_number,
                'ifsc'           => $b->ifsc,
                'branch_address' => $b->branch_address,
                'cheque_path'    => $b->cheque_path,
                'cheque_url'     => file_url($b->cheque_path),
            ])->all(),

            'gst_scrutiny' => $v->gstScrutiny->map(fn ($g) => [
                'id'                       => $g->id,
                'gst_number'               => $g->gst_number,
                'status'                   => $g->status,
                'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
                'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
                'red_flags'                => $g->red_flags,
            ])->all(),

            'product_mappings' => $v->productMappings->map(fn ($m) => [
                'id'                => $m->id,
                'product_id'        => $m->product_id,
                'product_code'      => optional($m->product)->product_code,
                'product_name'      => optional($m->product)->name,
                'batch_serial_lot'  => $m->batch_serial_lot,
                'purchase_price'    => (float) $m->purchase_price,
                'gst_percentage'    => (float) $m->gst_percentage,
                'gst_amount'        => (float) $m->gst_amount,
                'total_amount'      => (float) $m->total_amount,
            ])->all(),

            'created_at' => optional($v->created_at)->toDateTimeString(),
            'updated_at' => optional($v->updated_at)->toDateTimeString(),
        ];
    }
}
