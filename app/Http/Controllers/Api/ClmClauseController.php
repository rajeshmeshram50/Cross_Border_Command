<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmClauseLibrary;
use App\Models\ClmClauseType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class ClmClauseController extends Controller
{
    /* ── TYPES ── */

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmClauseType::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function typesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        /* Description is no longer required — the redesigned Clause Type
         * modal collects only the name. Old payloads with description
         * still work; new ones can send empty string or omit. */
        $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'name'        => ['required', 'string', 'max:255', Rule::unique('clm_clause_types', 'name')->where(fn ($q) => $q->where('client_id', $user->client_id))],
            'description' => 'nullable|string|max:500',
        ], [
            'name.unique' => 'A clause type with this name already exists.',
        ]);
        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('CLT-%03d', ClmClauseType::where('client_id', $user->client_id)->count() + 1);
            return ClmClauseType::create([
                'client_id'   => $user->client_id,
                'code'        => $code,
                'name'        => trim($data['name']),
                'description' => trim($data['description'] ?? ''),
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function typesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmClauseType::where('client_id', $user->client_id)->findOrFail($id);
        if ($request->has('name')) $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'name'        => ['sometimes', 'required', 'string', 'max:255', Rule::unique('clm_clause_types', 'name')->ignore($row->id)->where(fn ($q) => $q->where('client_id', $user->client_id))],
            'description' => 'sometimes|nullable|string|max:500',
        ], [
            'name.unique' => 'A clause type with this name already exists.',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (array_key_exists('description', $data)) $data['description'] = trim((string) $data['description']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function typesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmClauseType::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmClauseLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        /* Party is no longer required — the redesigned Add Clause modal
         * collects only clause_type + name + content. Backward compatible:
         * old payloads with party still work. */
        $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'clause_type'   => 'required|string|max:255',
            'name'          => ['required', 'string', 'max:255', Rule::unique('clm_clause_library', 'name')->where(fn ($q) => $q->where('client_id', $user->client_id))],
            'party'         => 'nullable|string|max:255',
            'clause_status' => 'nullable|string|max:32',
            'content'       => 'nullable|string',
        ], [
            'name.unique' => 'A clause with this name already exists.',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('CL-%03d', ClmClauseLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmClauseLibrary::create([
                'client_id'     => $user->client_id,
                'code'          => $code,
                'clause_type'   => trim($data['clause_type']),
                'name'          => trim($data['name']),
                'party'         => trim($data['party'] ?? ''),
                'clause_status' => $data['clause_status'] ?? 'Active',
                'content'       => $data['content']       ?? null,
                'created_by'    => $user->id,
                'updated_by'    => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmClauseLibrary::where('client_id', $user->client_id)->findOrFail($id);
        if ($request->has('name')) $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'clause_type'   => 'sometimes|required|string|max:255',
            'name'          => ['sometimes', 'required', 'string', 'max:255', Rule::unique('clm_clause_library', 'name')->ignore($row->id)->where(fn ($q) => $q->where('client_id', $user->client_id))],
            'party'         => 'sometimes|nullable|string|max:255',
            'clause_status' => 'nullable|string|max:32',
            'content'       => 'nullable|string',
        ], [
            'name.unique' => 'A clause with this name already exists.',
        ]);
        if (array_key_exists('party', $data)) $data['party'] = trim((string) $data['party']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmClauseLibrary::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }
}
