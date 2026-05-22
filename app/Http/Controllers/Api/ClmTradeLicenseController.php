<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmTradeLicense;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ClmTradeLicenseController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmTradeLicense::where('client_id', $user->client_id)->orderBy('id')->get()
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
            'validity'  => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmTradeLicense::STATUSES)],
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            return ClmTradeLicense::create([
                'client_id'  => $user->client_id,
                'code'       => $this->nextCode($user->client_id),
                'name'       => trim($data['name']),
                'authority'  => trim($data['authority']),
                'validity'   => $data['validity'] ?? 'N/A',
                'status'     => $data['status'] ?? ClmTradeLicense::STATUS_ACTIVE,
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
        $row  = ClmTradeLicense::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'authority' => 'sometimes|required|string|max:255',
            'validity'  => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmTradeLicense::STATUSES)],
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
        $row  = ClmTradeLicense::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $count = ClmTradeLicense::where('client_id', $clientId)->count();
        return sprintf('TL-%03d', $count + 1);
    }
}
