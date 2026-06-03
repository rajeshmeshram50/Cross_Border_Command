<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerOwner;
use App\Services\ConsigneeKycMirror;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;


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
        $this->resyncMirrors($customer, $request);
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
        $this->resyncMirrors($customer, $request);
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
        $this->resyncMirrors($customer, $request);
        return response()->json(['id' => $owner->id, 'deleted' => true]);
    }

    /**
     * Re-mirror the customer's KYC into every same-as-customer consignee
     * linked to this customer. Called after every owner create / update /
     * delete so the mirrored consignees stay in lock-step instead of
     * drifting until the user triggers another manual clone.
     */
    private function resyncMirrors(Customer $customer, Request $request): void
    {
        app(ConsigneeKycMirror::class)->resyncForCustomer(
            $customer,
            optional($request->user())->id
        );
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
            // URL fields use the project-wide file_url() helper
            // (app/helpers.php) — the same one HR Employees and
            // Onboarding use for their attachments. It handles legacy
            // path prefixes (storage/, public/), falls back to a
            // constructed URL when the disk has no `url` config, and
            // collapses double slashes.
            'id_proof_path'       => $o->id_proof_path,
            'id_proof_url'        => file_url($o->id_proof_path),
            'id_proof_name'       => $o->id_proof_path      ? basename($o->id_proof_path)      : null,
            'address_proof_path'  => $o->address_proof_path,
            'address_proof_url'   => file_url($o->address_proof_path),
            'address_proof_name'  => $o->address_proof_path ? basename($o->address_proof_path) : null,
            'photograph_path'     => $o->photograph_path,
            'photograph_url'      => file_url($o->photograph_path),
            'photograph_name'     => $o->photograph_path    ? basename($o->photograph_path)    : null,
            'status'              => $o->status,
            'created_at'          => $o->created_at?->toDateTimeString(),
        ];
    }

    private function validatePayload(Request $request, ?int $ownerId = null): array
    {
        return $request->validate([
            'owner_name'      => 'required|string|max:255',
            'designation'     => 'nullable|string|max:128',
            'official_email'  => 'nullable|email|max:255',
            'phone_number'    => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'status'          => 'nullable|in:Active,Inactive',
            // File slots — 2 MB cap, restricted to safe document types.
            // ID / Address proof allow PDF + Office docs alongside images
            // (passports, utility bills are often scanned PDFs). Photograph
            // is image-only since it's literally a picture of a person.
            // Server-side enforcement so executables / scripts / archives
            // (.php, .exe, .zip, .txt) are rejected even if the UI is
            // bypassed.
            'id_proof'        => 'sometimes|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:2048',
            'address_proof'   => 'sometimes|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:2048',
            'photograph'      => 'sometimes|file|mimes:jpg,jpeg,png|max:2048',
        ], [
            'id_proof.mimes'      => 'ID Proof must be a JPG, JPEG, PNG, PDF, DOC or DOCX file.',
            'id_proof.max'        => 'ID Proof must not exceed 2 MB.',
            'address_proof.mimes' => 'Address Proof must be a JPG, JPEG, PNG, PDF, DOC or DOCX file.',
            'address_proof.max'   => 'Address Proof must not exceed 2 MB.',
            'photograph.mimes'    => 'Photograph must be a JPG, JPEG or PNG image.',
            'photograph.max'      => 'Photograph must not exceed 2 MB.',
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
