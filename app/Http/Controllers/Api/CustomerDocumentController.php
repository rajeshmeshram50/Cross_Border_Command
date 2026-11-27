<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerDocument;
use App\Services\ConsigneeKycMirror;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class CustomerDocumentController extends Controller
{
    public function index(Request $request, $customerId): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId);

        $q = $customer->documents();
        if ($kind = $request->query('kind')) {
            $q->where('kind', $kind);
        }
        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('name',             'ilike', "%{$search}%")
                  ->orWhere('license_number', 'ilike', "%{$search}%")
                  ->orWhere('issuing_authority','ilike', "%{$search}%");
            });
        }

        $rows = $q->get()->map(fn ($d) => $this->shape($d))->all();
        return response()->json(['data' => $rows, 'count' => count($rows)]);
    }

    public function show(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId);
        $doc = $customer->documents()->findOrFail($id);
        return response()->json(['data' => $this->shape($doc)]);
    }

    public function store(Request $request, $customerId): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'edit');
        $data = $this->validatePayload($request);

        $data['customer_id'] = $customer->id;
        $data['created_by']  = optional($request->user())->id;
        if ($request->hasFile('attachment')) {
            $data['attachment_path'] = $this->storeUpload($request->file('attachment'), $customer->id, 'doc');
        }

        $doc = CustomerDocument::create($data);
        $this->resyncMirrors($customer, $request);
        return response()->json(['data' => $this->shape($doc)], 201);
    }

    public function update(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'edit');
        $doc = $customer->documents()->findOrFail($id);
        $data = $this->validatePayload($request, $doc->id);

        if ($request->hasFile('attachment')) {
            if ($doc->attachment_path) {
                Storage::disk('public')->delete($doc->attachment_path);
            }
            $data['attachment_path'] = $this->storeUpload($request->file('attachment'), $customer->id, 'doc');
        } elseif ($request->boolean('remove_attachment')) {
            if ($doc->attachment_path) {
                Storage::disk('public')->delete($doc->attachment_path);
            }
            $data['attachment_path'] = null;
        }

        $doc->update($data);
        $this->resyncMirrors($customer, $request);
        return response()->json(['data' => $this->shape($doc->fresh())]);
    }

    public function destroy(Request $request, $customerId, $id): JsonResponse
    {
        $customer = $this->resolveCustomer($request, $customerId, 'delete');
        $doc = $customer->documents()->findOrFail($id);
        if ($doc->attachment_path) {
            Storage::disk('public')->delete($doc->attachment_path);
        }
        $doc->delete();
        $this->resyncMirrors($customer, $request);
        return response()->json(['id' => $doc->id, 'deleted' => true]);
    }

    private function resyncMirrors(Customer $customer, Request $request): void
    {
        app(ConsigneeKycMirror::class)->resyncForCustomer(
            $customer,
            optional($request->user())->id
        );
    }

    private function shape(CustomerDocument $d): array
    {
        return [
            'id'                => $d->id,
            'kind'              => $d->kind,
            'name'              => $d->name,
            'license_number'    => $d->license_number,
            'issuing_authority' => $d->issuing_authority,
            'issue_date'        => optional($d->issue_date)->toDateString(),
            'expiry_date'       => optional($d->expiry_date)->toDateString(),
            'attachment_path'   => $d->attachment_path,
            'attachment_url'    => file_url($d->attachment_path),
            'attachment_name'   => $d->attachment_path ? basename($d->attachment_path) : null,
            'description'       => $d->description,
            'status'            => $d->status,
            'created_at'        => $d->created_at?->toDateTimeString(),
        ];
    }

    private function validatePayload(Request $request, ?int $docId = null): array
    {
        return $request->validate([
            'kind'              => 'required|in:dd,tl',
            'name'              => 'required|string|max:255',
            'license_number'    => 'nullable|string|max:128',
            'issuing_authority' => 'nullable|string|max:255',
            'issue_date'        => 'nullable|date',
            'expiry_date'       => 'nullable|date|after_or_equal:issue_date',
            'description'       => 'nullable|string|max:1000',
            'status'            => 'nullable|in:Active,Inactive',
            'attachment'        => 'sometimes|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:2048',
        ], [
            'attachment.mimes' => 'Attachment must be a JPG, JPEG, PNG, PDF, DOC or DOCX file.',
            'attachment.max'   => 'Attachment must not exceed 2 MB.',
        ]);
    }

    private function storeUpload($file, int $customerId, string $slug): string
    {
        $ext  = $file->getClientOriginalExtension() ?: 'bin';
        $name = $slug . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
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
