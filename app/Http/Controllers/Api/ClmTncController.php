<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmTncCategory;
use App\Models\ClmTncLibrary;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Terms & Conditions master — covers both tabs:
 *
 *   - /clm/tnc/categories  (DC-NNN: International - Proforma Invoice, …)
 *   - /clm/tnc/library     (TNC-NNN: a reusable T&C block tagged to a category)
 */
class ClmTncController extends Controller
{
    /* ── CATEGORIES ── */

    public function categoriesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmTncCategory::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function categoriesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'short_code' => 'required|string|max:12',
            'name'       => 'required|string|max:255',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('DC-%03d', ClmTncCategory::where('client_id', $user->client_id)->count() + 1);
            return ClmTncCategory::create([
                'client_id'  => $user->client_id,
                'code'       => $code,
                'short_code' => strtoupper(trim($data['short_code'])),
                'name'       => trim($data['name']),
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function categoriesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTncCategory::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'short_code' => 'sometimes|required|string|max:12',
            'name'       => 'sometimes|required|string|max:255',
        ]);
        if (isset($data['short_code'])) $data['short_code'] = strtoupper(trim($data['short_code']));
        if (isset($data['name']))       $data['name']       = trim($data['name']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function categoriesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTncCategory::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmTncLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            // segment now holds a CSV (one for "highly", many for "less").
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|in:highly,less',
            'category'   => 'required|string|max:255',
            'party'      => 'required|string|max:255',
            'content'    => 'nullable|string',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('TNC-%03d', ClmTncLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmTncLibrary::create([
                'client_id'  => $user->client_id,
                'code'       => $code,
                'segment'    => $data['segment'] ?? 'General',
                'regulatory' => $data['regulatory'] ?? 'highly',
                'category'   => trim($data['category']),
                'party'      => trim($data['party']),
                'content'    => $data['content'] ?? null,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTncLibrary::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|in:highly,less',
            'category'   => 'sometimes|required|string|max:255',
            'party'      => 'sometimes|required|string|max:255',
            'content'    => 'nullable|string',
        ]);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTncLibrary::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }
}
