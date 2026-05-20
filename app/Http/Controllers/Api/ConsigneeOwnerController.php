<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\ConsigneeOwner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Consignee Stage 2 — Owner KYC API.
 *
 * Mirrors CustomerOwnerController. Nested under the consignee:
 *   GET    /api/consignees/{consignee}/owners
 *   POST   /api/consignees/{consignee}/owners
 *   GET    /api/consignees/{consignee}/owners/{owner}
 *   POST   /api/consignees/{consignee}/owners/{owner}   (file replace)
 *   PUT    /api/consignees/{consignee}/owners/{owner}   (json-only)
 *   DELETE /api/consignees/{consignee}/owners/{owner}
 *
 * Each owner row carries three identity-proof file paths (ID,
 * address, photograph). Uploads land on the public disk under
 *   consignee_documents/{consignee_id}/owner-{slug}-{rand}.{ext}
 */
class ConsigneeOwnerController extends Controller
{
    private const FILE_FIELDS = [
        'id_proof'      => 'id_proof_path',
        'address_proof' => 'address_proof_path',
        'photograph'    => 'photograph_path',
    ];

    public function index(Request $request, $consigneeId): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $rows = $consignee->owners()->get()->map(fn ($o) => $this->shape($o))->all();
        return response()->json(['data' => $rows, 'count' => count($rows)]);
    }

    public function show(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $owner = $consignee->owners()->findOrFail($id);
        return response()->json(['data' => $this->shape($owner)]);
    }

    public function store(Request $request, $consigneeId): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $data = $this->validatePayload($request);

        $data['consignee_id'] = $consignee->id;
        $data['created_by']   = optional($request->user())->id;
        foreach (self::FILE_FIELDS as $input => $column) {
            if ($request->hasFile($input)) {
                $data[$column] = $this->storeUpload($request->file($input), $consignee->id, $input);
            }
        }

        $owner = ConsigneeOwner::create($data);
        return response()->json(['data' => $this->shape($owner)], 201);
    }

    public function update(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $owner = $consignee->owners()->findOrFail($id);
        $data = $this->validatePayload($request, $owner->id);

        foreach (self::FILE_FIELDS as $input => $column) {
            if ($request->hasFile($input)) {
                if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
                $data[$column] = $this->storeUpload($request->file($input), $consignee->id, $input);
            } elseif ($request->boolean("remove_{$input}")) {
                if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
                $data[$column] = null;
            }
        }

        $owner->update($data);
        return response()->json(['data' => $this->shape($owner->fresh())]);
    }

    public function destroy(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $owner = $consignee->owners()->findOrFail($id);
        foreach (self::FILE_FIELDS as $column) {
            if ($owner->{$column}) Storage::disk('public')->delete($owner->{$column});
        }
        $owner->delete();
        return response()->json(['id' => $owner->id, 'deleted' => true]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    private function shape(ConsigneeOwner $o): array
    {
        return [
            'id'                  => $o->id,
            'owner_name'          => $o->owner_name,
            'designation'         => $o->designation,
            'official_email'      => $o->official_email,
            'phone_number'        => $o->phone_number,
            'id_proof_path'       => $o->id_proof_path,
            'id_proof_url'        => $o->id_proof_path      ? Storage::disk('public')->url($o->id_proof_path)      : null,
            'id_proof_name'       => $o->id_proof_path      ? basename($o->id_proof_path)      : null,
            'address_proof_path'  => $o->address_proof_path,
            'address_proof_url'   => $o->address_proof_path ? Storage::disk('public')->url($o->address_proof_path) : null,
            'address_proof_name'  => $o->address_proof_path ? basename($o->address_proof_path) : null,
            'photograph_path'     => $o->photograph_path,
            'photograph_url'      => $o->photograph_path    ? Storage::disk('public')->url($o->photograph_path)    : null,
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
            'id_proof'        => 'sometimes|file|max:10240',
            'address_proof'   => 'sometimes|file|max:10240',
            'photograph'      => 'sometimes|file|max:10240',
        ]);
    }

    private function storeUpload($file, int $consigneeId, string $slug): string
    {
        $ext  = $file->getClientOriginalExtension() ?: 'bin';
        $name = "owner-{$slug}-" . bin2hex(random_bytes(6)) . '.' . $ext;
        return $file->storeAs("consignee_documents/{$consigneeId}", $name, 'public');
    }

    private function resolveConsignee(Request $request, $consigneeId): Consignee
    {
        return Consignee::query()
            ->forUser($request->user())
            ->findOrFail($consigneeId);
    }
}
