<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerOwner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Customer Stage 2 — Owner KYC API.
 *
 * Endpoints (nested under customer):
 *   GET    /api/customers/{customer}/owners
 *   POST   /api/customers/{customer}/owners
 *   GET    /api/customers/{customer}/owners/{owner}
 *   PUT    /api/customers/{customer}/owners/{owner}
 *   DELETE /api/customers/{customer}/owners/{owner}
 *
 * Each owner row carries three identity-proof file paths (ID, address,
 * photograph). Uploads land on the public disk under
 *   customer_documents/{customer_id}/owner-{owner_slug}-{rand}.{ext}
 *
 * Tenant scope mirrors CustomerDocumentController — the parent
 * customer is resolved through the user's client scope before
 * touching child rows.
 */
class CustomerOwnerController extends Controller
{
    private const FILE_FIELDS = [
        'id_proof'      => 'id_proof_path',
        'address_proof' => 'address_proof_path',
        'photograph'    => 'photograph_path',
    ];

    public function index(Request $request, $customerId): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId);
        $rows = $customer->owners()->get()->map(fn ($o) => $this->shape($o))->all();
        return response()->json(['data' => $rows, 'count' => count($rows)]);
    }

    public function show(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId);
        $owner = $customer->owners()->findOrFail($id);
        return response()->json(['data' => $this->shape($owner)]);
    }

    public function store(Request $request, $customerId): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'edit');
        $data = $this->validatePayload($request);

        $data['customer_id'] = $customer->id;
        $data['created_by']  = optional($request->user())->id;
        foreach (self::FILE_FIELDS as $input => $column) {
            if ($request->hasFile($input)) {
                $data[$column] = $this->storeUpload($request->file($input), $customer->id, $input);
            }
        }

        $owner = CustomerOwner::create($data);
        return response()->json(['data' => $this->shape($owner)], 201);
    }

    public function update(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'edit');
        $owner = $customer->owners()->findOrFail($id);
        $data = $this->validatePayload($request, $owner->id);

        foreach (self::FILE_FIELDS as $input => $column) {
            if ($request->hasFile($input)) {
                if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
                $data[$column] = $this->storeUpload($request->file($input), $customer->id, $input);
            } elseif ($request->boolean("remove_{$input}")) {
                if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
                $data[$column] = null;
            }
        }

        $owner->update($data);
        return response()->json(['data' => $this->shape($owner->fresh())]);
    }

    public function destroy(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'delete');
        $owner = $customer->owners()->findOrFail($id);
        foreach (self::FILE_FIELDS as $column) {
            if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
        }
        $owner->delete();
        return response()->json(['id' => $owner->id, 'deleted' => true]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    private function shape(CustomerOwner $o): array
    {
        return [
            'id'                  => $o->id,
            'owner_name'          => $o->owner_name,
            'designation'         => $o->designation,
            'official_email'      => $o->official_email,
            'phone_number'        => $o->phone_number,
            // URL fields are best-effort. Some server configs have a
            // `public` disk without a `url` key, which makes
            // Storage::url() throw. We swallow that and let the
            // frontend's resolveFileUrl() build the URL from the path.
            'id_proof_path'       => $o->id_proof_path,
            'id_proof_url'        => self::safeStorageUrl($o->id_proof_path),
            'id_proof_name'       => $o->id_proof_path      ? basename($o->id_proof_path)      : null,
            'address_proof_path'  => $o->address_proof_path,
            'address_proof_url'   => self::safeStorageUrl($o->address_proof_path),
            'address_proof_name'  => $o->address_proof_path ? basename($o->address_proof_path) : null,
            'photograph_path'     => $o->photograph_path,
            'photograph_url'      => self::safeStorageUrl($o->photograph_path),
            'photograph_name'     => $o->photograph_path    ? basename($o->photograph_path)    : null,
            'status'              => $o->status,
            'created_at'          => $o->created_at?->toDateTimeString(),
        ];
    }

    private static function safeStorageUrl(?string $path): ?string
    {
        if (!$path) return null;
        try {
            return Storage::disk('public')->url($path);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function validatePayload(Request $request, ?int $ownerId = null): array
    {
        return $request->validate([
            'owner_name'      => 'required|string|max:255',
            'designation'     => 'nullable|string|max:128',
            'official_email'  => 'nullable|email|max:255',
            'phone_number'    => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'status'          => 'nullable|in:Active,Inactive',
            // 10MB cap per file. Images + PDF allowed at the UI level;
            // server-side we just bound size + presence.
            'id_proof'        => 'sometimes|file|max:10240',
            'address_proof'   => 'sometimes|file|max:10240',
            'photograph'      => 'sometimes|file|max:10240',
        ]);
    }

    private function storeUpload($file, int $customerId, string $slug): string
    {
        $ext  = $file->getClientOriginalExtension() ?: 'bin';
        $name = "owner-{$slug}-" . bin2hex(random_bytes(6)) . '.' . $ext;
        return $file->storeAs("customer_documents/{$customerId}", $name, 'public');
    }

    private function resolveCustomer(Request $request, $customerId, ?string $action = null): Customer
    {
        $customer = Customer::query()
            ->forUser($request->user())
            ->findOrFail($customerId);
        if ($action) {
            $denial = \App\Support\MasterVisibility::hierarchicalDenial($request->user(), $customer, $action);
            if ($denial) abort(403, $denial);
        }
        return $customer;
    }
}
