<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DebitNoteType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Debit Note Type master (P2P → Purchase Management → Debit Note).
 *
 * Powers the "DEBIT NOTE TYPE" dropdown on the Debit Note form and its inline
 * "+" manage-types popup (list + add + toggle status). Branch-scoped exactly
 * like the rest of the P2P module.
 */
class DebitNoteTypeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = DebitNoteType::query()->orderBy('name');
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        // status=active → dropdown feed; omitted → the manage popup (all rows).
        if ($status = $request->query('status')) $q->where('status', $status);

        $rows = $q->get(['id', 'name', 'status'])->map(fn ($t) => [
            'id' => $t->id,
            'name' => $t->name,
            'status' => $t->status,
        ]);
        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'name' => 'required|string|max:128',
            'status' => 'nullable|in:active,inactive',
        ]);

        $exists = DebitNoteType::where('client_id', $user->client_id)
            ->where('branch_id', $user->branch_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($data['name']))])
            ->exists();
        if ($exists) {
            return response()->json(['status' => false, 'message' => 'This debit note type already exists.'], 422);
        }

        $type = DebitNoteType::create([
            'client_id' => $user->client_id,
            'branch_id' => $user->branch_id,
            'name' => trim($data['name']),
            'status' => $data['status'] ?? 'active',
            'created_by' => $user->id,
            'updated_by' => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => [
            'id' => $type->id, 'name' => $type->name, 'status' => $type->status,
        ]], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $type = DebitNoteType::findOrFail($id);
        $this->assertScope($type, $user);

        $data = $request->validate([
            'name' => 'sometimes|required|string|max:128',
            'status' => 'nullable|in:active,inactive',
        ]);

        if (isset($data['name'])) {
            $dupe = DebitNoteType::where('client_id', $user->client_id)
                ->where('branch_id', $type->branch_id)
                ->where('id', '!=', $type->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($data['name']))])
                ->exists();
            if ($dupe) return response()->json(['status' => false, 'message' => 'This debit note type already exists.'], 422);
            $type->name = trim($data['name']);
        }
        if (array_key_exists('status', $data) && $data['status']) $type->status = $data['status'];
        $type->updated_by = $user->id;
        $type->save();

        return response()->json(['status' => true, 'data' => [
            'id' => $type->id, 'name' => $type->name, 'status' => $type->status,
        ]]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $type = DebitNoteType::findOrFail($id);
        $this->assertScope($type, $user);
        $type->delete();
        return response()->json(['status' => true]);
    }

    /* ── Tenant / branch scope (mirrors SupplierPurchaseInvoiceController) ── */

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }
        if (!$user->client_id) { $q->whereRaw('1 = 0'); return; }
        $q->where('client_id', $user->client_id);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) {
            if ($branchFilter !== null) {
                $ok = \App\Models\Branch::where('id', $branchFilter)->where('client_id', $user->client_id)->exists();
                if ($ok) $q->where('branch_id', $branchFilter);
            }
            return;
        }
        $q->where('branch_id', $user->branch_id);
    }

    private function assertScope($row, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $row->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $row->branch_id === (int) $user->branch_id) return;
        abort(404);
    }
}
