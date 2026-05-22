<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmDdDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ClmDdController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmDdDocument::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'authority' => 'required|string|max:255',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmDdDocument::STATUSES)],
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            return ClmDdDocument::create([
                'client_id'  => $user->client_id,
                'code'       => $this->nextCode($user->client_id),
                'name'       => trim($data['name']),
                'authority'  => trim($data['authority']),
                'expiry'     => $data['expiry'] ?? 'N/A',
                'status'     => $data['status'] ?? ClmDdDocument::STATUS_ACTIVE,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmDdDocument::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'authority' => 'sometimes|required|string|max:255',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmDdDocument::STATUSES)],
        ]);

        if (isset($data['name']))      $data['name']      = trim($data['name']);
        if (isset($data['authority'])) $data['authority'] = trim($data['authority']);
        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmDdDocument::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $count = ClmDdDocument::where('client_id', $clientId)->count();
        return sprintf('DD-%03d', $count + 1);
    }
}
