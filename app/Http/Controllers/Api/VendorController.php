<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Masters\AddressTypes;
use App\Models\Masters\ComplianceBehaviours;
use App\Models\Masters\Countries;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\LicenseName;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Models\Masters\VendorBehaviour;
use App\Models\Masters\VendorTypes;
use App\Models\Vendor;
use App\Models\VendorAddress;
use App\Models\VendorBankAccount;
use App\Models\VendorDocument;
use App\Models\VendorGstScrutiny;
use App\Models\VendorOwner;
use App\Models\VendorProductMapping;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

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
        'segment:id,name',
        'segments:id,name',
        'complianceBehaviour:id,name',
        'classification:id,name',
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
            // Honour the BranchSwitcher (see CustomerController::index).
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with([
                'primaryAddress:id,vendor_id,city,state_id,state_code,contact_name,email,contact_no,designation',
                // Resolve the state FK to its name so the list shows "Maharashtra"
                // instead of the raw state_id (e.g. 8999) in the Supplier State column.
                'primaryAddress.state:id,name',
                // All address-contacts (primary + extras) so the list page can
                // render the "+N" contact badge + Contact Persons popup.
                'addresses:id,vendor_id,is_primary,contact_name,designation,contact_no,email',
                'vendorType:id,name',
                'segment:id,name',
                // All mapped segments (vendor_segments pivot) so the list can
                // render the Segment column + "+N" badge, not just the scalar one.
                'segments:id,name',
                'riskLevel:id,name',
            ])
            ->withCount('productMappings')
            // ── Fresh vs Recurring split ──────────────────────────────────────
            // TEMPORARY (2026-07-13, per user): the Recurring tab must stay EMPTY
            // for now. Real procurement IDs will be minted later through the P2P
            // case-to-case flow; until that exists we report 0 so every supplier
            // sits in Fresh and the Recurring tab shows no rows.
            //
            // WHEN case-to-case procurement lands: delete the line below and
            // uncomment the vendor_id subquery — Recurring = the supplier DIRECTLY
            // pinned (procurement_products.vendor_id) on an actual procurement
            // line (the true supplier⇄procurement link; not inferred via product).
            ->addSelect(DB::raw('0 as opportunity_count'))
            // ->addSelect(['opportunity_count' => DB::table('procurements as pr')
            //     ->selectRaw('count(distinct pr.id)')
            //     ->whereColumn('pr.client_id', 'vendors.client_id')
            //     ->whereExists(function ($q) {
            //         $q->selectRaw('1')
            //             ->from('procurement_products as pp')
            //             ->whereColumn('pp.procurement_id', 'pr.id')
            //             ->whereColumn('pp.vendor_id', 'vendors.id');
            //     }),
            // ])
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

        /* Segment-rule reference uploads embedded inline. AddVendorModal
         * previously fired GET /segment-uploads/supplier/{id} as a
         * second round-trip on edit-mode open; on `php artisan serve`
         * that single-threaded server made each call pay the full
         * Laravel boot tax. Bundling it into the show response collapses
         * 2 round-trips into 1 — same proven pattern we used for
         * Customer + Consignee.
         *
         * Vendor docs / owners / bank accounts / addresses already
         * arrive via the SHOW_WITH eager load, so they do NOT need
         * delegation (unlike Customer / Consignee where each was a
         * separate controller). Only segment_uploads remains as an
         * external resource — keep its full shape (data + by_category
         * + count) so the frontend's per-tab bucketing still works.
         *
         * Wrapped in try/catch so a single inner failure (e.g. fresh
         * vendor with zero uploads returning an empty list) cannot
         * break the whole show response.
         */
        $segmentUploads = $this->safeDelegate(
            fn () => (new \App\Http\Controllers\Api\SegmentDocUploadController())->index($request, 'supplier', $id)
        );

        // Per-segment lock: the segments whose product appears on an issued
        // Purchase Order. The vendor form keys segments by ID, so resolve the
        // locked NAMES to IDS here so the UI can disable only those chips' ×.
        $data = $this->shape($vendor);
        $lockedNames = \App\Support\SegmentGuard::lockedSegmentNames(
            \App\Models\Vendor::class,
            (int) $vendor->id,
            (int) $vendor->client_id,
        );
        $data['locked_segments'] = empty($lockedNames) ? [] : DB::table('clm_segments')
            ->whereIn('name', $lockedNames)
            ->where(fn ($q) => $q->where('client_id', $vendor->client_id)->orWhereNull('client_id'))
            ->pluck('id')->map(fn ($i) => (string) $i)->values()->all();

        // Data for the removal guard's unique-document check (condition 2). Keyed
        // by segment ID (the vendor form keys segments by id): each segment's
        // required doc keys (category|code) + the keys actually uploaded.
        $segReq = [];
        foreach (DB::table('vendor_segments as vsg')->join('clm_segments as cs', 'cs.id', '=', 'vsg.segment_id')->where('vsg.vendor_id', $vendor->id)->get(['cs.id', 'cs.name']) as $s) {
            $segReq[(string) $s->id] = \App\Support\SegmentGuard::docKeys((int) $vendor->client_id, $s->name);
        }
        $data['segment_required_doc_keys'] = $segReq;
        $data['uploaded_doc_keys'] = \App\Support\SegmentGuard::uploadedDocKeys(
            \App\Models\Vendor::class,
            (int) $vendor->id,
            (int) $vendor->client_id,
        );

        return response()->json([
            'data'            => $data,
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
        ]);
    }

    /**
     * Run a delegated controller call and unwrap its JSON response,
     * returning `null` on any failure. Used by show() to embed nested
     * resources without letting a single inner failure take down the
     * whole response. Caller decides how to default the missing key.
     */
    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('VendorController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
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
        // Invalidate the cached master bundles (Product "Map Supplier" dropdown
        // + Vendor list) so the soft-deleted supplier stops appearing — the
        // bundles are cached per-user for 5 min and would otherwise linger.
        MasterBundleCache::bump();
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
            'legal_name'               => 'required|string|max:255',
            'website'                  => 'nullable|string|max:500',
            // Captured once on Stage 1 and reused read-only by every GST
            // Scrutiny entry. gst_number is only meaningful when applicable
            // is "Yes"; storeIdentity() clears it otherwise so a stale number
            // can't leak into the scrutiny form after a Yes → No switch.
            'gst_applicable'           => 'nullable|string|in:Yes,No',
            'gst_number'               => 'nullable|string|max:20',
            'vendor_type_id'           => 'nullable|integer|exists:master_vendor_types,id',
            // Supplier Type is now a fixed frontend vocabulary (Logistic /
            // Material / Tech Services / Advisory Services / Risk Services).
            // The form sends the NAME; we resolve it to a master_vendor_types
            // row (find-or-create per tenant) so the vendor_type_id FK stays
            // valid without the user having to manage the master by hand.
            'vendor_type'              => 'nullable|string|max:255',
            'risk_level_id'            => 'nullable|integer|exists:master_risk_levels,id',
            'vendor_behaviour_id'      => 'nullable|integer|exists:master_vendor_behaviour,id',
            'segment_id'               => 'nullable|integer|exists:clm_segments,id',
            // Supplier Segment is multi-select. Accepts an array of ids or a
            // comma-joined string; normalised + synced into vendor_segments.
            'segment_ids'              => 'nullable',
            'classification_id'        => 'nullable|integer|exists:master_customer_classifications,id',
            'compliance_behaviour_id'  => 'nullable|integer|exists:master_compliance_behaviours,id',
            // Registered-office address lives on the SAME "Identification &
            // Address" tab, so persist it here too. Previously the address was
            // only written by storeContacts (primary_address), so saving Stage 1
            // without completing the contacts step lost the address on re-edit.
            'address'                  => 'nullable|array',
            'address.address_line'     => 'nullable|string|max:1000',
            'address.country_id'       => 'nullable|integer|exists:master_countries,id',
            'address.state_id'         => 'nullable|integer|exists:master_states,id',
            'address.state_code'       => 'nullable|string|max:32',
            'address.city'             => 'nullable|string|max:128',
            'address.pincode'          => 'nullable|string|max:16',
        ]);

        // Pull the address off $data (not a vendors column) — upserted onto the
        // vendor's primary address inside the transaction below.
        $address = $data['address'] ?? null;
        unset($data['address']);

        // Resolve the supplier-type NAME → master_vendor_types id.
        if (!empty($data['vendor_type'])) {
            $vt = VendorTypes::firstOrCreate(
                ['client_id' => $user->client_id, 'name' => trim($data['vendor_type'])],
                ['status' => 'Active', 'created_by' => $user->id],
            );
            $data['vendor_type_id'] = $vt->id;
        }
        unset($data['vendor_type']);   // not a column on vendors

        // Normalise the multi-segment selection to a clean, ordered list of
        // existing clm_segments ids; the scalar segment_id keeps the first.
        // Scoped to the caller's client so a foreign segment id can't be synced.
        $segIds = $this->normalizeSegmentIds($request->input('segment_ids'), $data['segment_id'] ?? null, (int) $user->client_id);
        $data['segment_id'] = $segIds[0] ?? null;
        unset($data['segment_ids']);   // synced separately, not a vendors column

        // A GST number only means anything when GST is applicable. Clear it on a
        // Yes → No switch so a stale number can't flow into the GST Scrutiny
        // form, which renders it read-only and therefore can't correct it.
        if (($data['gst_applicable'] ?? null) === 'No') {
            $data['gst_number'] = null;
        }

        // India → GST is mandatory: an Indian supplier cannot be GST-Applicable = No
        // (an unregistered Indian supplier would sync tax-free and mis-state the bill).
        $countryId = $data['address']['country_id'] ?? null;
        $isIndia = $countryId && DB::table('master_countries')
            ->where('id', $countryId)->whereRaw('LOWER(name) = ?', ['india'])->exists();
        if ($isIndia && ($data['gst_applicable'] ?? null) !== 'Yes') {
            return response()->json([
                'message' => 'GST is mandatory for an Indian supplier — set GST Applicable to Yes.',
                'errors'  => ['gst_applicable' => ['GST is mandatory for an Indian supplier.']],
            ], 422);
        }

        // GSTIN must begin with the state code (first 2 digits = GST state code).
        if (($data['gst_applicable'] ?? null) === 'Yes' && !empty($data['gst_number'])) {
            $stateCode = trim((string) ($data['address']['state_code'] ?? ''));
            if ($stateCode !== '') {
                $expected = str_pad($stateCode, 2, '0', STR_PAD_LEFT);
                if (substr(strtoupper(trim((string) $data['gst_number'])), 0, 2) !== $expected) {
                    return response()->json([
                        'message' => "GST Number must start with the state code {$expected}.",
                        'errors'  => ['gst_number' => ["GST Number must start with the state code {$expected}."]],
                    ], 422);
                }
            }
        }

        // Resolve + authorise the target row up-front so the 403 short-circuit
        // stays outside the write transaction.
        $isEdit = isset($data['id']);
        $vendor = null;
        if ($isEdit) {
            $vendor = Vendor::query()->forUser($user)->findOrFail($data['id']);
            if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
                return response()->json(['message' => $denial], 403);
            }
        }

        // GST number is unique per tenant. Check it HERE, on the step that owns
        // the field — the GST Scrutiny save also guards it, but by then the user
        // is two stages past where they typed it.
        if (($data['gst_applicable'] ?? null) === 'Yes' && !empty($data['gst_number'])) {
            $this->assertGstUniqueForClient(
                (int) $user->client_id,
                $data['gst_number'],
                $isEdit ? (int) $data['id'] : null,
            );
        }

        // Segment-usage protection (supplier). The pivot sync below would detach a
        // removed segment, so reject the edit up-front — outside the write
        // transaction — when a removed segment is either (1) used by a product on
        // an issued PO or a Supplier Invoice, or (2) has an uploaded document not
        // shared with a remaining segment.
        $oldSegIds = ($isEdit && $vendor)
            ? DB::table('vendor_segments')->where('vendor_id', $vendor->id)->pluck('segment_id')->all()
            : [];
        if ($isEdit && $vendor) {
            $removedIds = array_values(array_diff(
                array_map('intval', $oldSegIds),
                array_map('intval', $segIds),
            ));
            if (!empty($removedIds)) {
                $removedNames   = DB::table('clm_segments')->whereIn('id', $removedIds)->pluck('name')->all();
                $remainingNames = DB::table('clm_segments')->whereIn('id', array_map('intval', $segIds))->pluck('name')->all();
                // (1) Product lock — a product on a PO / SPI belongs to it.
                $blocked = \App\Support\SegmentGuard::blockedByCompletedDocs(\App\Models\Vendor::class, (int) $vendor->id, (int) $vendor->client_id, $removedNames);
                if (!empty($blocked)) {
                    return response()->json([
                        'message' => 'Cannot remove ' . implode(', ', $blocked) . ' — a product on a Purchase Order or Supplier Invoice belongs to it.',
                        'errors'  => ['segment_ids' => ['Segment(s) used by a PO / Supplier Invoice product cannot be removed: ' . implode(', ', $blocked) . '.']],
                    ], 422);
                }
                // (2) Unique-document lock — an uploaded doc no remaining segment needs.
                $docBlocked = \App\Support\SegmentGuard::blockedByOrphanDocs(\App\Models\Vendor::class, (int) $vendor->id, (int) $vendor->client_id, $removedNames, $remainingNames);
                if (!empty($docBlocked)) {
                    return response()->json([
                        'message' => 'Cannot remove ' . implode(', ', $docBlocked) . ' — it has an uploaded document not shared with any remaining segment. Delete that document first.',
                        'errors'  => ['segment_ids' => ['Segment(s) with an unshared uploaded document cannot be removed: ' . implode(', ', $docBlocked) . '.']],
                    ], 422);
                }
            }
        }

        DB::transaction(function () use (&$vendor, $isEdit, $user, $data, $segIds, $address, $oldSegIds) {
            if ($isEdit) {
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
                // S-001, S-002 … computed after insert so a soft-deleted vendor
                // doesn't release its code back into the pool. Scoped to the
                // creating user's branch, so every branch runs its own sequence.
                //
                // Serialise allocation on the client row, as CustomerController
                // does: nextVendorCode() reads the current max and the caller
                // writes max+1, so two concurrent creates would otherwise read
                // the same max and collide on the vendor_code unique index.
                if ($user->client_id !== null) {
                    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
                }
                $vendor->vendor_code = $this->nextVendorCode($user->client_id, $user->branch_id);
                $vendor->save();
            }

            // Replace the segment pivot rows with the new selection. Removals that
            // would strand a PO/SPI product or an unshared document are already
            // rejected above, so nothing needs cleaning up here.
            $vendor->segments()->sync($segIds);

            // Persist the registered-office address onto the primary VendorAddress
            // WITHOUT touching the contact fields — so the address survives saving
            // the Identification & Address tab, independent of the contacts step
            // (which later fills in the primary contact person on the same row).
            if (is_array($address) && array_filter($address, fn ($v) => $v !== null && $v !== '')) {
                $addrFields = [
                    'address_line' => $address['address_line'] ?? null,
                    'country_id'   => $address['country_id']   ?? null,
                    'state_id'     => $address['state_id']     ?? null,
                    'state_code'   => $address['state_code']   ?? null,
                    'city'         => $address['city']         ?? null,
                    'pincode'      => $address['pincode']      ?? null,
                ];
                $primary = $vendor->addresses()->where('is_primary', true)->first();
                if ($primary) {
                    $primary->fill($addrFields);
                    if (!$primary->address_type) $primary->address_type = 'Registered Office';
                    $primary->save();
                } else {
                    $vendor->addresses()->create(array_merge($addrFields, [
                        'address_type' => 'Registered Office',
                        'is_primary'   => true,
                        // contact_name is NOT NULL on vendor_addresses; the primary
                        // contact person is captured later via the contacts step.
                        // Seed an empty string so the address row can be created now
                        // (the contacts step fills in the real contact fields).
                        'contact_name' => '',
                    ]));
                }
            }
        });

        // New supplier / renamed identity → refresh the cached Map-Supplier
        // dropdown (company name, code, type, segment, status all live here).
        MasterBundleCache::bump();

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /**
     * Normalise a multi-segment payload (array of ids OR comma-joined string)
     * into a clean, de-duplicated list of clm_segments ids that actually
     * exist — input order preserved so the first stays the primary segment.
     * Falls back to the scalar segment_id when no list is supplied.
     *
     * @return int[]
     */
    private function normalizeSegmentIds($raw, $fallbackId = null, ?int $clientId = null): array
    {
        $ids = collect(is_array($raw) ? $raw : (is_string($raw) ? explode(',', $raw) : []))
            ->map(fn ($v) => (int) trim((string) $v))
            ->filter(fn ($v) => $v > 0);

        if ($ids->isEmpty() && $fallbackId) {
            $ids = collect([(int) $fallbackId]);
        }

        $ids = $ids->unique()->values();
        if ($ids->isEmpty()) return [];

        // Keep only ids that exist (and belong to this client — clm_segments is
        // per-tenant); preserve the caller's order.
        $existing = DB::table('clm_segments')
            ->whereIn('id', $ids->all())
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->pluck('id')->flip();
        return $ids->filter(fn ($id) => $existing->has($id))->values()->all();
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
            'primary_address.address_type'             => 'nullable|string|max:64',
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
            // Primary contact business card: a new upload, or the existing
            // path echoed back on edit when the file is unchanged.
            'primary_address.attachment_path'          => 'nullable|string|max:500',
            'primary_attachment'                       => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
        ]);
        // NB: additional contacts are NOT handled here — they have their own
        // CRUD endpoints (storeContact / updateContact / destroyContact) so
        // each persists independently and can be edited/deleted on its own.

        // Snapshot the current primary business-card file so we can drop it
        // from disk if this save replaces or removes it.
        $oldPrimaryAttachment = optional($vendor->addresses()->where('is_primary', true)->first())->attachment_path;

        DB::transaction(function () use ($request, $vendor, $data, $oldPrimaryAttachment) {
            // Replace ONLY the primary row. Additional contacts (is_primary
            // = false) are owned by the /contacts CRUD endpoints and must be
            // left untouched here.
            $vendor->addresses()->where('is_primary', true)->delete();

            // Primary contact business card: store the new upload, else keep
            // the existing path the frontend echoed back on edit.
            $primaryAttachment = $this->absorbFile(
                $request,
                'primary_attachment',
                $vendor->id,
                'contact',
                $data['primary_address']['attachment_path'] ?? null,
            );

            $primary = new VendorAddress(array_merge($data['primary_address'], [
                'vendor_id'       => $vendor->id,
                'is_primary'      => true,
                'attachment_path' => $primaryAttachment,
            ]));
            $primary->save();

            // Mirror the primary contact's email onto the vendor row.
            $vendor->primary_email  = $data['primary_address']['email'] ?? null;
            $vendor->step_completed = max((int) $vendor->step_completed, 1);
            $vendor->save();

            // Best-effort: drop the replaced business card from disk.
            if ($oldPrimaryAttachment && $oldPrimaryAttachment !== $primaryAttachment) {
                try { Storage::disk('public')->delete($oldPrimaryAttachment); } catch (\Throwable $e) { /* swallow */ }
            }
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Additional contact persons — independent CRUD (is_primary = false).
     *
     * Each row persists on its own the moment the user adds/edits/deletes
     * it, so nothing depends on "Save & Next". The primary contact row
     * (is_primary = true) is never reachable through these — it is managed
     * by storeContacts and stays non-deletable / non-editable here.
     * ────────────────────────────────────────────────────────────── */
    public function storeContact(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateContact($request);
        $path = $this->absorbFile($request, 'attachment', $vendor->id, 'contact', $data['attachment_path'] ?? null);

        $row = VendorAddress::create([
            'vendor_id'        => $vendor->id,
            'is_primary'       => false,
            'contact_name'     => $data['contact_name'],
            'designation'      => $data['designation'] ?? null,
            'contact_no'       => $data['contact_no'] ?? null,
            'email'            => $data['email'] ?? null,
            'whatsapp_enabled' => $data['whatsapp_enabled'] ?? false,
            'attachment_path'  => $path,
        ]);

        return response()->json(['data' => $this->shapeContact($row)], 201);
    }

    public function updateContact(Request $request, int $id, int $contactId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        // is_primary = false guard makes the primary row unreachable → 404.
        $row = VendorAddress::where('vendor_id', $vendor->id)
            ->where('is_primary', false)
            ->findOrFail($contactId);

        $data = $this->validateContact($request);
        $old = $row->attachment_path;
        // remove_attachment=1 means the user cleared the file in the popup. With
        // no new upload we must pass a NULL fallback so absorbFile drops it —
        // otherwise it re-keeps $old and the deleted attachment keeps showing.
        $removeAttachment = filter_var($request->input('remove_attachment', false), FILTER_VALIDATE_BOOLEAN);
        $fallback = $removeAttachment ? null : ($data['attachment_path'] ?? $old);
        $path = $this->absorbFile($request, 'attachment', $vendor->id, 'contact', $fallback);

        $row->update([
            'contact_name'     => $data['contact_name'],
            'designation'      => $data['designation'] ?? null,
            'contact_no'       => $data['contact_no'] ?? null,
            'email'            => $data['email'] ?? null,
            'whatsapp_enabled' => $data['whatsapp_enabled'] ?? false,
            'attachment_path'  => $path,
        ]);

        if ($old && $old !== $path) {
            try { Storage::disk('public')->delete($old); } catch (\Throwable $e) { /* swallow */ }
        }

        return response()->json(['data' => $this->shapeContact($row->fresh())]);
    }

    public function destroyContact(Request $request, int $id, int $contactId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorAddress::where('vendor_id', $vendor->id)
            ->where('is_primary', false)
            ->findOrFail($contactId);

        $old = $row->attachment_path;
        $row->delete();
        if ($old) {
            try { Storage::disk('public')->delete($old); } catch (\Throwable $e) { /* swallow */ }
        }

        return response()->json(['message' => 'Contact deleted']);
    }

    /** Shared validation for a single additional contact (add + edit). */
    private function validateContact(Request $request): array
    {
        return $request->validate([
            'contact_name'     => 'required|string|max:255',
            'designation'      => 'nullable|string|max:128',
            'contact_no'       => 'nullable|string|max:32',
            'email'            => 'nullable|email|max:255',
            'whatsapp_enabled' => 'nullable|boolean',
            'attachment'       => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
            // Existing stored path echoed back on edit when the file is unchanged.
            'attachment_path'  => 'nullable|string|max:500',
        ]);
    }

    /** Shape one additional contact for the SPA. */
    private function shapeContact(VendorAddress $a): array
    {
        return [
            'id'               => $a->id,
            'contact_name'     => $a->contact_name,
            'designation'      => $a->designation,
            'contact_no'       => $a->contact_no,
            'email'            => $a->email,
            'whatsapp_enabled' => (bool) $a->whatsapp_enabled,
            'attachment_path'  => $a->attachment_path,
            'attachment_url'   => file_url($a->attachment_path),
        ];
    }

    /* ──────────────────────────────────────────────────────────────────
     * Bank Accounts — independent CRUD (KYC sub-tab "Bank Details").
     * Each row persists on add/edit/delete; the cancelled-cheque upload is
     * stored via absorbFile, same as the rest of the module.
     * ────────────────────────────────────────────────────────────── */
    public function storeBankAccount(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateBank($request);

        // No duplicate account number for this supplier (account number uniquely
        // identifies a bank account; the same one can't be added twice).
        if (VendorBankAccount::where('vendor_id', $vendor->id)
                ->where('account_number', $data['account_number'])
                ->exists()) {
            return response()->json([
                'message' => 'This account number is already added for this supplier.',
                'errors'  => ['account_number' => ['This account number is already added for this supplier.']],
            ], 422);
        }

        $path = $this->absorbFile($request, 'cheque', $vendor->id, 'cheque', $data['cheque_path'] ?? null);

        $row = VendorBankAccount::create([
            'vendor_id'      => $vendor->id,
            'bank_name'      => $data['bank_name'],
            'branch_name'    => $data['branch_name'],
            'account_number' => $data['account_number'],
            'ifsc'           => strtoupper($data['ifsc']),
            'branch_address' => $data['branch_address'] ?? null,
            'cheque_path'    => $path,
            'created_by'     => $user->id,
        ]);

        return response()->json(['data' => $this->shapeBank($row)], 201);
    }

    public function updateBankAccount(Request $request, int $id, int $bankId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorBankAccount::where('vendor_id', $vendor->id)->findOrFail($bankId);
        $data = $this->validateBank($request);

        // No duplicate account number for this supplier (excluding this row).
        if (VendorBankAccount::where('vendor_id', $vendor->id)
                ->where('account_number', $data['account_number'])
                ->where('id', '!=', $row->id)
                ->exists()) {
            return response()->json([
                'message' => 'This account number is already added for this supplier.',
                'errors'  => ['account_number' => ['This account number is already added for this supplier.']],
            ], 422);
        }

        $old = $row->cheque_path;
        $path = $this->absorbFile($request, 'cheque', $vendor->id, 'cheque', $data['cheque_path'] ?? $old);

        $row->update([
            'bank_name'      => $data['bank_name'],
            'branch_name'    => $data['branch_name'],
            'account_number' => $data['account_number'],
            'ifsc'           => strtoupper($data['ifsc']),
            'branch_address' => $data['branch_address'] ?? null,
            'cheque_path'    => $path,
        ]);

        if ($old && $old !== $path) {
            try { Storage::disk('public')->delete($old); } catch (\Throwable $e) { /* swallow */ }
        }

        return response()->json(['data' => $this->shapeBank($row->fresh())]);
    }

    public function destroyBankAccount(Request $request, int $id, int $bankId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorBankAccount::where('vendor_id', $vendor->id)->findOrFail($bankId);
        $old = $row->cheque_path;
        $row->forceDelete();
        if ($old) {
            try { Storage::disk('public')->delete($old); } catch (\Throwable $e) { /* swallow */ }
        }

        return response()->json(['message' => 'Bank account deleted']);
    }

    private function validateBank(Request $request): array
    {
        return $request->validate([
            'bank_name'      => 'required|string|max:255',
            'branch_name'    => 'required|string|max:255',
            // Account number: 9–18 digits (matches the frontend validator).
            // IFSC: standard RBI format — 4 letters + 0 + 6 alphanumerics.
            'account_number' => ['required', 'string', 'regex:/^[0-9]{9,18}$/'],
            'ifsc'           => ['required', 'string', 'regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/'],
            'branch_address' => 'nullable|string|max:500',
            'cheque'         => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
            'cheque_path'    => 'nullable|string|max:500',
        ], [
            'account_number.regex' => 'Account Number must be 9–18 digits.',
            'ifsc.regex'           => 'IFSC Code is invalid (format: 4 letters + 0 + 6 characters, e.g. HDFC0001234).',
        ]);
    }

    private function shapeBank(VendorBankAccount $b): array
    {
        return [
            'id'             => $b->id,
            'bank_name'      => $b->bank_name,
            'branch_name'    => $b->branch_name,
            'account_number' => $b->account_number,
            'ifsc'           => $b->ifsc,
            'branch_address' => $b->branch_address,
            'cheque_path'    => $b->cheque_path,
            'cheque_url'     => file_url($b->cheque_path),
        ];
    }

    /* ──────────────────────────────────────────────────────────────────
     * GST Scrutiny — independent CRUD (KYC sub-tab "GST Scrutiny").
     * ────────────────────────────────────────────────────────────── */
    public function storeGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateGst($request);
        $gst = strtoupper($data['gst_number']);
        $this->assertGstNumberUnique($vendor, $gst);
        $row = VendorGstScrutiny::create([
            'vendor_id'               => $vendor->id,
            'gst_number'              => $gst,
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
            'created_by'              => $user->id,
        ]);

        // GST number is a supplier-wide value — every scrutiny record belongs to
        // the same GSTIN. Keep them ALL in sync with the latest entered number so
        // the supplier never shows mismatched GSTINs across scrutiny periods.
        VendorGstScrutiny::where('vendor_id', $vendor->id)->update(['gst_number' => $gst]);

        return response()->json(['data' => $this->shapeGst($row)], 201);
    }

    public function updateGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorGstScrutiny::where('vendor_id', $vendor->id)->findOrFail($gstId);
        $data = $this->validateGst($request);
        $gst = strtoupper($data['gst_number']);
        $this->assertGstNumberUnique($vendor, $gst);
        $row->update([
            'gst_number'              => $gst,
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
        ]);

        // GST number is supplier-wide — sync every scrutiny record to it.
        VendorGstScrutiny::where('vendor_id', $vendor->id)->update(['gst_number' => $gst]);

        return response()->json(['data' => $this->shapeGst($row->fresh())]);
    }

    public function destroyGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        VendorGstScrutiny::where('vendor_id', $vendor->id)->findOrFail($gstId)->forceDelete();
        return response()->json(['message' => 'GST scrutiny deleted']);
    }

    /**
     * Guard: a GST number may belong to only ONE supplier within the tenant.
     * The SAME vendor can keep / re-save its own GST (vendor_id excluded), but
     * a DIFFERENT supplier cannot register a GST another supplier already holds.
     * Aborts with a 422 (field-keyed) so the form highlights the GST field.
     */
    private function assertGstNumberUnique(Vendor $vendor, string $gstNumber): void
    {
        $this->assertGstUniqueForClient((int) $vendor->client_id, $gstNumber, (int) $vendor->id);
    }

    /**
     * Same guard, but callable before a Vendor row exists (the Stage-1 add flow),
     * so the clash surfaces on the GST Number field the user is actually typing
     * into rather than three tabs later on the GST Scrutiny save.
     *
     * Checks BOTH sources: vendors.gst_number (Stage 1 — the source of truth
     * since GST moved there) AND vendor_gst_scrutiny.gst_number (rows created
     * before that, and the per-entry records). Checking only the latter would let
     * two suppliers claim the same GSTIN on Stage 1 and only collide later.
     *
     * @param int|null $exceptVendorId Supplier being edited — it may keep its own GST.
     */
    private function assertGstUniqueForClient(int $clientId, string $gstNumber, ?int $exceptVendorId = null): void
    {
        $gst = strtoupper(trim($gstNumber));
        if ($gst === '') return;

        $onVendor = Vendor::query()
            ->where('client_id', $clientId)
            ->where('gst_number', $gst)
            ->when($exceptVendorId, fn ($q) => $q->where('id', '!=', $exceptVendorId))
            ->exists();

        $onScrutiny = VendorGstScrutiny::query()
            ->where('gst_number', $gst)
            ->when($exceptVendorId, fn ($q) => $q->where('vendor_id', '!=', $exceptVendorId))
            ->whereHas('vendor', fn ($q) => $q->where('client_id', $clientId))
            ->exists();

        if ($onVendor || $onScrutiny) {
            abort(response()->json([
                'message' => "GST number {$gst} is already registered to another supplier.",
                'errors'  => ['gst_number' => ['This GST number is already registered to another supplier.']],
            ], 422));
        }
    }

    private function validateGst(Request $request): array
    {
        return $request->validate([
            'gst_number'              => 'required|string|max:16',
            'status'                  => ['nullable', Rule::in(['Active', 'Inactive'])],
            'last_filing_date'        => 'nullable|date',
            'prev_non_gst_2a_invoice' => 'nullable|string|max:255',
            'red_flags'               => 'nullable|string|max:2000',
        ]);
    }

    private function shapeGst(VendorGstScrutiny $g): array
    {
        return [
            'id'                       => $g->id,
            'gst_number'               => $g->gst_number,
            'status'                   => $g->status,
            'scrutiny_date'            => optional($g->created_at)->toDateString(),
            'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
            'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
            'red_flags'                => $g->red_flags,
        ];
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
        ]);
        // NB: Bank Accounts + GST Scrutiny are NOT handled here — they have
        // their own CRUD endpoints so each row persists the moment it's added
        // (no dependency on "Save & Next").

        DB::transaction(function () use ($vendor, $data, $request, $user) {
            $userId = $user?->id;

            // Snapshot existing file paths so the ones not preserved as
            // `existing_path` on the new payload get cleaned up.
            $keptPaths = collect();
            foreach (($data['due_diligence'] ?? [])  as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['owner_kyc'] ?? [])      as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['trade_licenses'] ?? []) as $r) $keptPaths->push($r['existing_path'] ?? null);

            $oldPaths = collect()
                ->merge($vendor->documents()->pluck('attachment_path'))
                ->merge($vendor->owners()->pluck('attachment_path'));
            foreach ($oldPaths as $p) {
                if ($p && !$keptPaths->contains($p)) {
                    Storage::disk('public')->delete($p);
                }
            }

            // Hard delete so soft-deleted rows don't accumulate per save.
            // Bank Accounts + GST Scrutiny are owned by their CRUD endpoints
            // and are intentionally left untouched here.
            $vendor->documents()->forceDelete();
            $vendor->owners()->forceDelete();

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
            // Allow an empty array so the per-row "Map Product" popup can persist
            // a delete-to-empty immediately (replace-all → drops every mapping).
            'mappings'                    => 'present|array',
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

            }

            // Flip every mapped product to Active / step 4 in ONE query —
            // previously a per-row Product::find + save inside the loop (N+1).
            if (!empty($nowMappedProductIds)) {
                \App\Models\Product::whereIn('id', array_unique($nowMappedProductIds))
                    ->update([
                        'status'         => 'active',
                        'step_completed' => DB::raw('GREATEST(step_completed, 4)'),
                    ]);
            }

            // Drop any product_vendor_maps that USED to mirror this
            // vendor but aren't in the current submit, so the two
            // tables stay symmetric.
            \App\Models\ProductVendorMap::where('vendor_id', $vendor->id)
                ->when(!empty($nowMappedProductIds), fn ($q) => $q->whereNotIn('product_id', $nowMappedProductIds))
                ->delete();

            // Only mark the vendor fully onboarded when it actually has at least
            // one product mapped. A delete-to-empty (mappings: []) must NOT leave
            // a product-less vendor looking Active/step-4.
            if (!empty($nowMappedProductIds)) {
                $vendor->step_completed = 4;
                $vendor->status         = 'active';
                $vendor->save();
            }
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * Helpers
     * ────────────────────────────────────────────────────────────── */

    /** Compute the next vendor_code (S-001, S-002 …) scoped to one client AND
     *  branch — each branch owns its own S-001, S-002 … run, mirroring
     *  CustomerController::nextCustomerCode. Before this the sequence was
     *  client-wide, so a client's second branch inherited the first branch's
     *  running count instead of starting at S-001.
     *
     *  Earlier this used `orderByDesc('id')->value('vendor_code')` which
     *  returns the most-recently-inserted code, not the numerically
     *  highest one — so a draft V-01 created after V-02 already
     *  existed would make this hand out V-02 again and trip the
     *  vendor_code unique index. We now scan every code (including
     *  soft-deleted) and pick the true max so the sequence is
     *  monotonic regardless of insert order. */
    private function nextVendorCode(?int $clientId, ?int $branchId = null): string
    {
        $codes = Vendor::withTrashed()
            ->where('client_id', $clientId)
            // whereNull for the NULL-branch bucket: `where('branch_id', null)`
            // compiles to `= NULL`, which matches nothing.
            ->when(
                $branchId === null,
                fn ($q) => $q->whereNull('branch_id'),
                fn ($q) => $q->where('branch_id', $branchId)
            )
            ->pluck('vendor_code');

        $max = 0;
        foreach ($codes as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'S-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
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
            'gst_applicable' => $v->gst_applicable,
            'gst_number'     => $v->gst_number,
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
            // Full multi-select set (ids + labels) from the vendor_segments pivot.
            // Older suppliers (created before multi-segment) have an EMPTY pivot
            // but a scalar segment_id — fall back to it so the list + edit form
            // still show the segment without needing a re-save.
            'segment_ids'              => $v->segments->isNotEmpty()
                ? $v->segments->pluck('id')->all()
                : array_values(array_filter([$v->segment_id])),
            'segments'                 => $v->segments->isNotEmpty()
                ? $v->segments->map(fn ($s) => ['id' => $s->id, 'name' => $s->name])->all()
                : ($v->segment_id ? [['id' => $v->segment_id, 'name' => optional($v->segment)->title]] : []),
            'compliance_behaviour_id'  => $v->compliance_behaviour_id,
            'compliance_behaviour_name'=> optional($v->complianceBehaviour)->name,
            'classification_id'        => $v->classification_id,
            'classification_name'      => optional($v->classification)->name,

            'primary_address' => $primary ? [
                'id'                => $primary->id,
                'address_type'      => $primary->address_type,
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
                'attachment_path'   => $primary->attachment_path,
                'attachment_url'    => file_url($primary->attachment_path),
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
                'scrutiny_date'            => optional($g->created_at)->toDateString(),
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


    public function masterBundle(Request $request): JsonResponse
    {
        $user = $request->user();
        $cacheKey = MasterBundleCache::key('vendor:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            // Tenant scope — apply MasterVisibility::applyReadScope to every
            // master query, matching the gate /master/{slug} uses for the
            // canonical endpoint. Without this a client_admin of Client A
            // would see Client B's tenant-scoped master rows via the bundle.
            // Per-user cache key is a second line of defence.
            $scope = fn ($q) => MasterVisibility::applyReadScope($q, $user);

            $active = function (string $modelClass, array $cols) use ($scope) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('id')
                    ->get($cols);
            };

            // state_codes eager-loads its parent state so the dropdown can
            // cascade off the chosen country without a second round-trip.
            $stateCodes = StateCodes::query()
                ->whereRaw('LOWER(status) = ?', ['active'])
                ->tap($scope)
                ->with('state:id,name,country_id')
                ->orderBy('id')
                ->get(['id', 'state_id', 'state_code', 'status']);

            return [
                'vendor_types'          => $active(VendorTypes::class,          ['id', 'name']),
                'risk_levels'           => $active(RiskLevels::class,           ['id', 'name']),
                'vendor_behaviour'      => $active(VendorBehaviour::class,      ['id', 'name']),
                'segments'              => $active(Segments::class,             ['id', 'name']),
                'compliance_behaviours' => $active(ComplianceBehaviours::class, ['id', 'name']),
                'classifications'       => $active(CustomerClassifications::class, ['id', 'name']),
                'address_types'         => $active(AddressTypes::class,           ['id', 'name']),
                'countries'             => $active(Countries::class,            ['id', 'name']),
                'state_codes'           => $stateCodes,
                'states'                => $active(States::class,               ['id', 'name', 'country_id']),
                'license_name'          => $active(LicenseName::class,          ['id', 'name']),
                'gst_percentage'        => $active(GstPercentage::class,        ['id', 'percentage']),
            ];
        });
        return response()->json($bundle);
    }
}
