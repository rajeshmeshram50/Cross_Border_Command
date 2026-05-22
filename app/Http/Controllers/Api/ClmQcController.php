<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmQcDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ClmQcController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmQcDocument::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'counts' => [
                'all'  => $rows->count(),
                'cert' => $rows->where('doc_type', ClmQcDocument::TYPE_CERT)->count(),
                'comp' => $rows->where('doc_type', ClmQcDocument::TYPE_COMP)->count(),
            ],
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'         => 'required|string|max:255',
            'purpose'      => 'required|string|max:500',
            'issued_by'    => 'required|string|max:255',
            'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],
            'qa_params'    => 'nullable|string',
            'min_criteria' => 'nullable|string',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            return ClmQcDocument::create([
                'client_id'    => $user->client_id,
                'code'         => $this->nextCode($user->client_id),
                'name'         => trim($data['name']),
                'purpose'      => trim($data['purpose']),
                'issued_by'    => trim($data['issued_by']),
                'doc_type'     => $data['doc_type'] ?? ClmQcDocument::TYPE_CERT,
                'qa_params'    => $data['qa_params']    ?? null,
                'min_criteria' => $data['min_criteria'] ?? null,
                'status'       => $data['status'] ?? ClmQcDocument::STATUS_ACTIVE,
                'created_by'   => $user->id,
                'updated_by'   => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmQcDocument::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'         => 'sometimes|required|string|max:255',
            'purpose'      => 'sometimes|required|string|max:500',
            'issued_by'    => 'sometimes|required|string|max:255',
            'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],
            'qa_params'    => 'nullable|string',
            'min_criteria' => 'nullable|string',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        foreach (['name','purpose','issued_by'] as $k) if (isset($data[$k])) $data[$k] = trim($data[$k]);
        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmQcDocument::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $count = ClmQcDocument::where('client_id', $clientId)->count();
        return sprintf('QC-%03d', $count + 1);
    }
}
