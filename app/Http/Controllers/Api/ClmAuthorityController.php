<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Central CLM → Authority master CRUD.
 *
 * Mirrors ClmSegmentController: tenant-scoped via $user->client_id, per-tenant
 * AUTH-### sequence allocated under a parent-row lock at insert time.
 */
class ClmAuthorityController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmAuthority::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'description' => 'required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            return ClmAuthority::create([
                'client_id'   => $user->client_id,
                'code'        => $this->nextCode($user->client_id),
                'name'        => trim($data['name']),
                'description' => trim($data['description']),
                'status'      => $data['status'] ?? ClmAuthority::STATUS_ACTIVE,
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);
        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $count = ClmAuthority::where('client_id', $clientId)->count();
        return sprintf('AUTH-%03d', $count + 1);
    }
}
