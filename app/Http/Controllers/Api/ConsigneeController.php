<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\ConsigneeAddress;
use App\Models\ConsigneeDocument;
use App\Models\ConsigneeOwner;
use App\Models\Customer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Sales Matrix → Consignees.
 *
 * Mirrors CustomerController. The one structural addition is
 * customer_id — every consignee belongs to a customer account
 * (phase A of the Add Consignee modal picks the customer first).
 *
 * Payload contract (POST / PUT):
 *  {
 *    customer_id,
 *    company_name, legal_name, segment, classification, risk_level,
 *    website, status,
 *    primary_address: {
 *       type, address_line, country, state, city, pin,
 *       cp_name, cp_designation, cp_contact, cp_email, cp_whatsapp
 *    },
 *    locations: [ same shape ... ]
 *  }
 *
 *  primary_email mirrors primary_address.cp_email and is unique
 *  within tenant scope (per client_id).
 */
class ConsigneeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Consignee::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'customer'])
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('company_name',   'ilike', "%{$search}%")
                  ->orWhere('legal_name',   'ilike', "%{$search}%")
                  ->orWhere('consignee_code','ilike', "%{$search}%")
                  ->orWhere('primary_email','ilike', "%{$search}%")
                  ->orWhere('segment',      'ilike', "%{$search}%");
            });
        }

        if ($customerId = $request->query('customer_id')) {
            $q->where('customer_id', (int) $customerId);
        }

        $rows = $q->get()->map(fn ($c) => $this->shape($c))->all();

        return response()->json([
            'count' => count($rows),
            'data'  => $rows,
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $row = Consignee::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'customer'])
            ->findOrFail($id);
        return response()->json(['data' => $this->shape($row)]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data = $this->validatePayload($request);
        $this->assertCustomerInScope($user, (int) $data['customer_id']);
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], !empty($data['same_as_customer']), null);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            $consignee = Consignee::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'       => optional($user)->id,
                'customer_id'      => (int) $data['customer_id'],
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => $data['segment']        ?? null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? 'Active',
                'same_as_customer' => (bool) ($data['same_as_customer'] ?? false),
            ]);

            // Display id — CN-### grows from 001 → 1234 naturally with
            // the row count, no separate sequence table.
            $consignee->consignee_code = 'CN-' . str_pad((string) $consignee->id, 3, '0', STR_PAD_LEFT);
            $consignee->save();

            ConsigneeAddress::create(array_merge($primary, [
                'consignee_id' => $consignee->id,
                'is_primary'   => true,
            ]));

            foreach ($data['locations'] ?? [] as $loc) {
                ConsigneeAddress::create(array_merge($loc, [
                    'consignee_id' => $consignee->id,
                    'is_primary'   => false,
                ]));
            }

            return $consignee->load(['primaryAddress', 'addresses', 'customer']);
        });

        return response()->json(['data' => $this->shape($row)], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()->forUser($user)->findOrFail($id);

        $data = $this->validatePayload($request);
        $this->assertCustomerInScope($user, (int) $data['customer_id']);
        // Carry the previous value forward if the payload omits the
        // key so the guard reads the user's *current* intent.
        $intendsMirror = array_key_exists('same_as_customer', $data)
            ? (bool) $data['same_as_customer']
            : (bool) $consignee->same_as_customer;
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], $intendsMirror, $consignee->id);

        $row = DB::transaction(function () use ($consignee, $data) {
            $primary = $data['primary_address'];

            $consignee->update([
                'customer_id'      => (int) $data['customer_id'],
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => $data['segment']        ?? null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? $consignee->status,
                'same_as_customer' => array_key_exists('same_as_customer', $data)
                    ? (bool) $data['same_as_customer']
                    : $consignee->same_as_customer,
            ]);

            // Replace-all on addresses (same simple strategy as
            // CustomerController). Cascade keeps it safe — no hard FK
            // dependents yet.
            ConsigneeAddress::where('consignee_id', $consignee->id)->delete();
            ConsigneeAddress::create(array_merge($primary, [
                'consignee_id' => $consignee->id,
                'is_primary'   => true,
            ]));
            foreach ($data['locations'] ?? [] as $loc) {
                ConsigneeAddress::create(array_merge($loc, [
                    'consignee_id' => $consignee->id,
                    'is_primary'   => false,
                ]));
            }

            return $consignee->load(['primaryAddress', 'addresses', 'customer']);
        });

        return response()->json(['data' => $this->shape($row)]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()->forUser($user)->findOrFail($id);
        $consignee->delete();
        return response()->json(['id' => $consignee->id, 'deleted' => true]);
    }

    /**
     * "Same as Customer" deep-clone. Copies the linked customer's Stage 2
     * KYC documents (Company DD + Trade Licence) and Owner KYC rows onto
     * this consignee — including their file attachments via
     * Storage::copy(). The consignee's *additional addresses* are already
     * carried in the consignee POST/PUT payload, so this endpoint only
     * handles the children that live in separate tables.
     *
     * Replace semantics: each call wipes the consignee's existing KYC
     * (rows + on-disk files) and re-clones fresh from the customer. This
     * keeps "Same as Customer" semantically truthful — re-ticking and
     * re-saving always produces an exact mirror, even if the customer's
     * KYC was edited after the consignee was first created. Manual edits
     * on the consignee side are intentionally overwritten; the user
     * opted into that by re-ticking the box.
     *
     * Tenant scope: both ends are checked. Customer must be visible to
     * the caller via Customer::forUser($user), same as the
     * cross-tenant guard used by store/update.
     *
     * Route: POST /api/consignees/{id}/clone-from-customer
     * Body:  { "customer_id": <int> }
     */
    public function cloneFromCustomer(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()
            ->with(['documents', 'owners'])
            ->forUser($user)
            ->findOrFail($id);

        $data = $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
        ]);

        $customer = Customer::query()
            ->forUser($user)
            ->with(['documents', 'owners'])
            ->findOrFail($data['customer_id']);

        $copied = ['documents' => 0, 'owners' => 0];

        DB::transaction(function () use ($consignee, $customer, $user, &$copied) {
            $disk = Storage::disk('public');

            // ── Wipe existing KYC (replace semantics) ───────────────
            // Delete on-disk files first (best-effort), then the rows.
            // cascadeOnDelete from consignee → docs/owners protects us
            // if anything's left dangling, but explicit deletion is
            // safer here so we don't accidentally orphan a file.
            foreach ($consignee->documents as $d) {
                if ($d->attachment_path) $disk->delete($d->attachment_path);
            }
            foreach ($consignee->owners as $o) {
                foreach (['id_proof_path', 'address_proof_path', 'photograph_path'] as $f) {
                    if ($o->{$f}) $disk->delete($o->{$f});
                }
            }
            $consignee->documents()->delete();
            $consignee->owners()->delete();

            // ── Documents ─────────────────────────────────────────────
            foreach ($customer->documents as $doc) {
                $newPath = null;
                if ($doc->attachment_path && $disk->exists($doc->attachment_path)) {
                    $ext = pathinfo($doc->attachment_path, PATHINFO_EXTENSION) ?: 'bin';
                    $newPath = "consignee_documents/{$consignee->id}/cloned-" . bin2hex(random_bytes(6)) . ".{$ext}";
                    $disk->copy($doc->attachment_path, $newPath);
                }
                ConsigneeDocument::create([
                    'consignee_id'      => $consignee->id,
                    'kind'              => $doc->kind,
                    'name'              => $doc->name,
                    'license_number'    => $doc->license_number,
                    'issuing_authority' => $doc->issuing_authority,
                    'issue_date'        => $doc->issue_date,
                    'expiry_date'       => $doc->expiry_date,
                    'attachment_path'   => $newPath,
                    'description'       => $doc->description,
                    'status'            => $doc->status ?? 'Active',
                    'created_by'        => optional($user)->id,
                ]);
                $copied['documents']++;
            }

            // ── Owners (three file slots each) ────────────────────────
            $fileSlots = ['id_proof_path', 'address_proof_path', 'photograph_path'];
            foreach ($customer->owners as $owner) {
                $copies = [];
                foreach ($fileSlots as $slot) {
                    $copies[$slot] = null;
                    if ($owner->{$slot} && $disk->exists($owner->{$slot})) {
                        $ext = pathinfo($owner->{$slot}, PATHINFO_EXTENSION) ?: 'bin';
                        // Reuse the slot name (id_proof/address_proof/photograph)
                        // in the cloned filename so debugging on-disk stays readable.
                        $slotLabel = str_replace('_path', '', $slot);
                        $newPath = "consignee_documents/{$consignee->id}/owner-clone-{$slotLabel}-" . bin2hex(random_bytes(6)) . ".{$ext}";
                        $disk->copy($owner->{$slot}, $newPath);
                        $copies[$slot] = $newPath;
                    }
                }
                ConsigneeOwner::create([
                    'consignee_id'       => $consignee->id,
                    'owner_name'         => $owner->owner_name,
                    'designation'        => $owner->designation,
                    'official_email'     => $owner->official_email,
                    'phone_number'       => $owner->phone_number,
                    'id_proof_path'      => $copies['id_proof_path'],
                    'address_proof_path' => $copies['address_proof_path'],
                    'photograph_path'    => $copies['photograph_path'],
                    'status'             => $owner->status ?? 'Active',
                    'created_by'         => optional($user)->id,
                ]);
                $copied['owners']++;
            }
        });

        return response()->json([
            'ok'      => true,
            'cloned'  => $copied,
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Reshape a Consignee + addresses + linked customer into the
     * frontend contract. The Add Consignee modal's edit hydration and
     * the SalesConsignee list both read these keys.
     */
    private function shape(Consignee $c): array
    {
        $primary = $c->primaryAddress;
        return [
            'id'              => $c->consignee_code ?: ('CN-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
            'db_id'           => $c->id,
            'customer_id'     => $c->customer_id,
            'customer_code'   => $c->customer?->customer_code,
            'customer_name'   => $c->customer?->company_name,
            'company'         => $c->company_name,
            'legalName'       => $c->legal_name,
            'segment'         => $c->segment,
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'website'         => $c->website,
            'status'          => $c->status,
            'country'         => $primary?->country,
            'countryDetail'   => trim(implode(', ', array_filter([$primary?->city, $primary?->state, $primary?->country]))),
            'state'           => $primary?->state,
            'city'            => $primary?->city,
            'pin'             => $primary?->pin,
            'addr'            => $primary?->address_line,
            'addrType'        => $primary?->type,
            'contact'         => $primary?->cp_name,
            'cpDesig'         => $primary?->cp_designation,
            'phone'           => $primary?->cp_contact,
            'email'           => $primary?->cp_email,
            'whatsapp'        => $primary?->cp_whatsapp === 'yes' ? 'Yes' : ($primary?->cp_whatsapp === 'no' ? 'No' : null),
            'same_as_customer' => (bool) $c->same_as_customer,
            'risk'            => $c->risk_level,
            'locations'       => $c->addresses
                ->where('is_primary', false)
                ->values()
                ->map(fn ($a) => $this->shapeAddress($a))
                ->all(),
            'primary_address' => $primary ? $this->shapeAddress($primary) : null,
        ];
    }

    private function shapeAddress(ConsigneeAddress $a): array
    {
        return [
            'id'             => $a->id,
            'type'           => $a->type,
            'address_line'   => $a->address_line,
            'country'        => $a->country,
            'state'          => $a->state,
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
     * Validate the POST / PUT body. Returns the validated array
     * (nested primary_address + locations preserved).
     *
     * primary_email uniqueness is per-tenant within the consignees
     * table, ignoring the row being edited.
     */
    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'customer_id'      => 'required|integer|exists:customers,id',
            'company_name'     => 'required|string|max:255',
            'legal_name'       => 'nullable|string|max:255',
            'segment'          => 'nullable|string|max:64',
            'classification'   => 'nullable|string|max:64',
            'risk_level'       => 'nullable|string|max:32',
            'website'          => 'nullable|string|max:500',
            'status'           => 'nullable|in:Active,Inactive',
            // Marks consignees created via the "Same as Customer"
            // toggle. Powers the warning popup on Edit Customer.
            'same_as_customer' => 'sometimes|boolean',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|max:1000',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            'primary_address.city'           => 'nullable|string|max:64',
            'primary_address.pin'            => 'nullable|string|max:16',
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            'primary_address.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            // No uniqueness check — a consignee is a child of a
            // customer, and it's perfectly valid for multiple
            // consignees (potentially under the same customer or
            // across different customers in the same tenant) to share
            // a primary contact email. The "Same as Customer" toggle
            // on Stage 1 deliberately copies the customer's email
            // onto the consignee, so any unique rule here would block
            // that intended flow.
            'primary_address.cp_email'       => 'required|email|max:255',
            'primary_address.cp_whatsapp'    => 'nullable|in:yes,no',

            'locations'                  => 'sometimes|array',
            'locations.*.type'           => 'required_with:locations|string|max:64',
            'locations.*.address_line'   => 'required_with:locations|string|max:1000',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            'locations.*.pin'            => 'nullable|string|max:16',
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => 'nullable|email|max:255',
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ]);
    }

    /**
     * Ensure the customer the consignee is being attached to is
     * visible under the caller's tenant scope. Without this a tenant
     * could create a consignee under another tenant's customer just
     * by passing its id.
     */
    /**
     * Block cross-tenant linkage — without this check a caller could
     * create a consignee under a customer they're not entitled to
     * see, just by knowing/guessing the customer_id. Reuses the
     * shared Customer::forUser() scope so this stays in lockstep
     * with the customer index visibility.
     */
    private function assertCustomerInScope($user, int $customerId): void
    {
        $exists = Customer::query()
            ->forUser($user)
            ->whereKey($customerId)
            ->exists();
        if (!$exists) abort(404, 'Customer not found');
    }

    /**
     * Business rule: a customer can have *at most one* same-as-customer
     * consignee, but unlimited regular consignees. This guard runs on
     * store() and update() whenever the caller intends to set
     * `same_as_customer = true`. Excludes $ignoreConsigneeId from the
     * count so editing the existing mirror doesn't fail on itself.
     */
    private function assertSingleMirrorPerCustomer(int $customerId, bool $intendsMirror, ?int $ignoreConsigneeId): void
    {
        if (!$intendsMirror) return;
        $q = Consignee::query()
            ->where('customer_id', $customerId)
            ->where('same_as_customer', true);
        if ($ignoreConsigneeId !== null) $q->where('id', '!=', $ignoreConsigneeId);
        if ($q->exists()) {
            // 422 keeps it on the field-validation path so the frontend's
            // existing 422 → inline-error mapper picks it up uniformly.
            abort(response()->json([
                'message' => 'Only one same-as-customer consignee is allowed per customer.',
                'errors'  => [
                    'same_as_customer' => ['This customer already has a same-as-customer consignee. Untick the toggle or pick a different customer.'],
                ],
            ], 422));
        }
    }

    /**
     * Resolve `[client_id, branch_id]` for the row being inserted.
     * Only used by store() — tenant *visibility* is handled by the
     * Consignee::scopeForUser() Eloquent scope.
     */
    private function resolveOwnership($user): array
    {
        if (!$user) return [null, null];
        if ($user->user_type === 'super_admin') return [null, null];
        $clientId = $user->client_id ?? ($user->branch?->client_id);
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }
}
