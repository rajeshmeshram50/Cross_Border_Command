<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeDocName;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Trade Documents master — covers both tabs:
 *
 *   - /clm/trade-docs/names    (lightweight catalog: TDN-NNN + name)
 *   - /clm/trade-docs/library  (rich library: TD-NNN + title, type, purpose, party, file)
 *
 * Combined into a single controller because the two tabs render on the
 * same page and share validation patterns.
 */
class ClmTradeDocumentController extends Controller
{
    /* ── NAMES TAB ── */

    public function namesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmTradeDocName::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function namesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        $data = $request->validate(['name' => 'required|string|max:255']);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('TDN-%03d', ClmTradeDocName::where('client_id', $user->client_id)->count() + 1);
            return ClmTradeDocName::create([
                'client_id'  => $user->client_id,
                'code'       => $code,
                'name'       => trim($data['name']),
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function namesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocName::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['name' => 'required|string|max:255']);
        $row->update(['name' => trim($data['name']), 'updated_by' => $user->id]);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function namesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocName::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY TAB ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmTradeDocLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'title'     => 'required|string|max:255',
            'doc_type'  => 'required|string|max:64',
            'purpose'   => 'required|string|max:500',
            'party'     => 'required|string|max:255',
            'file_path' => 'nullable|string|max:500',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('TD-%03d', ClmTradeDocLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmTradeDocLibrary::create($data + [
                'client_id'  => $user->client_id,
                'code'       => $code,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'title'     => 'sometimes|required|string|max:255',
            'doc_type'  => 'sometimes|required|string|max:64',
            'purpose'   => 'sometimes|required|string|max:500',
            'party'     => 'sometimes|required|string|max:255',
            'file_path' => 'nullable|string|max:500',
        ]);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }
}
