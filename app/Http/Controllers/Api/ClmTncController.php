<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmTncCategory;
use App\Models\ClmTncLibrary;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class ClmTncController extends Controller
{
 

    public function categoriesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        // The four standard categories are GLOBAL (client_id NULL) and show
        // for every tenant; a client's own custom categories are merged on top.
        $rows = ClmTncCategory::where(function ($w) use ($user) {
                $w->whereNull('client_id');
                if ($user->client_id) {
                    $w->orWhere('client_id', $user->client_id);
                }
            })
            ->orderBy('id')
            ->get();
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
            $code = $this->nextCode(ClmTncCategory::class, $user->client_id, 'DC-');
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
            $code = $this->nextCode(ClmTncLibrary::class, $user->client_id, 'TNC-');
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

    /**
     * Allocate the next per-tenant code (DC-NNN / TNC-NNN). Uses MAX(numeric
     * suffix) + 1 rather than count()+1 so a deleted row in the middle of the
     * sequence doesn't make the next allocation reuse a code that still
     * exists — which throws a unique-constraint violation on save. Caller
     * must already hold the client row lock; the composite UNIQUE
     * (client_id, code) is the final guard.
     *
     * @param class-string<\Illuminate\Database\Eloquent\Model> $modelClass
     */
    private function nextCode(string $modelClass, int $clientId, string $prefix): string
    {
        $codes = $modelClass::where('client_id', $clientId)->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        $re    = '/^' . preg_quote($prefix, '/') . '(\d+)$/';
        foreach ($codes as $c) {
            if (preg_match($re, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('%s%03d', $prefix, $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
