<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmAgreementType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Agreements master — covers both tabs:
 *
 *   - /clm/agreements/types     (AT-NNN: Sales Contract, MSA, NDA, …)
 *   - /clm/agreements/library   (A-NNN: concrete templates tagged to a type)
 */
class ClmAgreementController extends Controller
{
    /* ── TYPES ── */

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmAgreementType::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function typesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'description' => 'required|string|max:500',
        ]);
        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('AT-%03d', ClmAgreementType::where('client_id', $user->client_id)->count() + 1);
            return ClmAgreementType::create([
                'client_id'   => $user->client_id,
                'code'        => $code,
                'name'        => trim($data['name']),
                'description' => trim($data['description']),
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function typesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementType::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function typesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementType::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmAgreementLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'agreement_type' => 'required|string|max:255',
            'title'          => 'required|string|max:255',
            'party'          => 'required|string|max:255',
            'regulatory'     => ['nullable', Rule::in(ClmAgreementLibrary::REG_VALUES)],
            'signing'        => 'nullable|boolean',
            'segment'        => 'nullable|string|max:64',
            'agr_status'     => 'nullable|string|max:32',
            'content'        => 'nullable|string',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('A-%03d', ClmAgreementLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmAgreementLibrary::create([
                'client_id'      => $user->client_id,
                'code'           => $code,
                'agreement_type' => trim($data['agreement_type']),
                'title'          => trim($data['title']),
                'party'          => trim($data['party']),
                'regulatory'     => $data['regulatory'] ?? ClmAgreementLibrary::REG_LESS,
                'signing'        => $data['signing']     ?? true,
                'segment'        => $data['segment']     ?? null,
                'agr_status'     => $data['agr_status']  ?? 'Active',
                'content'        => $data['content']     ?? null,
                'created_by'     => $user->id,
                'updated_by'     => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate([
            'agreement_type' => 'sometimes|required|string|max:255',
            'title'          => 'sometimes|required|string|max:255',
            'party'          => 'sometimes|required|string|max:255',
            'regulatory'     => ['nullable', Rule::in(ClmAgreementLibrary::REG_VALUES)],
            'signing'        => 'nullable|boolean',
            'segment'        => 'nullable|string|max:64',
            'agr_status'     => 'nullable|string|max:32',
            'content'        => 'nullable|string',
        ]);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }
}
