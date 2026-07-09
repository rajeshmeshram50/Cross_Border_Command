<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmClauseLibrary;
use App\Models\ClmClauseType;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class ClmClauseController extends Controller
{
    /* ── TYPES ── */

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read: branch users see globals + client-level rows +
        // their own branch's rows; sibling branches stay hidden.
        $branchFilter = $request->integer('branch_id') ?: null;
        $typeQuery = ClmClauseType::query()->orderBy('id');
        MasterVisibility::applyReadScope($typeQuery, $user, $branchFilter);
        $rows = $typeQuery->get();

        /* Usage map: how many Clause Library entries reference each type. The
         * library links to a type by NAME (no FK), so we match case-insensitively.
         * Drives the "can't edit an in-use type" guard on the client. Scope the
         * usage count the same way so a branch only counts library rows it can
         * actually see. */
        $usageQuery = ClmClauseLibrary::query();
        MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
        $usage = $usageQuery
            ->selectRaw('LOWER(clause_type) as t, COUNT(*) as c')
            ->groupBy(DB::raw('LOWER(clause_type)'))
            ->pluck('c', 't');
        $rows->each(function ($row) use ($usage) {
            $row->in_use = (int) ($usage[mb_strtolower((string) $row->name)] ?? 0);
        });

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
            'name'        => ['required', 'string', 'max:255'],
            'description' => 'nullable|string|max:500',
        ]);

        // Reject duplicate clause-type names within the creator's own scope
        // (case-insensitive). Scoped via MasterVisibility so the same name can
        // exist in different branches — matches the branch-scoped master rule.
        $name = trim($data['name']);
        $dupQuery = ClmClauseType::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
        if ($dupQuery->exists()) {
            return response()->json(['status' => false, 'message' => 'A clause type with this name already exists.'], 409);
        }

        $row = DB::transaction(function () use ($user, $data) {
            $code = $this->nextCode(ClmClauseType::class, $user->client_id, $user->branch_id, 'CLT');
            return ClmClauseType::create([
                'client_id'   => $user->client_id,
                'branch_id'   => $user->branch_id,   // branch-owned; null for client-level users → shared
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
        $lookup = ClmClauseType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        // A branch user can VIEW shared client-level types but not manage them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        /* Block editing while the Clause Library still references this type — the
         * library links to it by NAME, so renaming would orphan those clauses.
         * The user must reassign/remove those clauses first. */
        $inUse = ClmClauseLibrary::where('client_id', $user->client_id)
            ->whereRaw('LOWER(clause_type) = ?', [mb_strtolower((string) $row->name)])
            ->count();
        if ($inUse > 0) {
            return response()->json([
                'status'  => false,
                'message' => "This clause type is used by {$inUse} clause" . ($inUse === 1 ? '' : 's') . " in the Clause Library, so it can't be edited. Remove or reassign " . ($inUse === 1 ? 'that clause' : 'those clauses') . " first.",
            ], 409);
        }

        if ($request->has('name')) $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'name'        => ['sometimes', 'required', 'string', 'max:255'],
            'description' => 'sometimes|nullable|string|max:500',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (array_key_exists('description', $data)) $data['description'] = trim((string) $data['description']);

        // Reject rename to a duplicate name within the tenant (case-insensitive,
        // excluding self).
        if (isset($data['name'])) {
            $clash = ClmClauseType::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists();
            if ($clash) {
                return response()->json(['status' => false, 'message' => 'A clause type with this name already exists.'], 409);
            }
        }

        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function typesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmClauseType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read (globals + client-level + own branch; siblings hidden).
        $query = ClmClauseLibrary::query()->orderBy('id');
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $rows = $query->get();
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
            'name'          => ['required', 'string', 'max:255'],
            'party'         => 'nullable|string|max:255',
            'clause_status' => 'nullable|string|max:32',
            'content'       => 'nullable|string',
        ]);

        // Reject duplicate clause names within the creator's own scope
        // (case-insensitive). Scoped via MasterVisibility so the same name can
        // exist in different branches — matches the branch-scoped master rule.
        $name = trim($data['name']);
        $dupQuery = ClmClauseLibrary::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
        if ($dupQuery->exists()) {
            return response()->json(['status' => false, 'message' => 'A clause with this name already exists.'], 409);
        }

        $row = DB::transaction(function () use ($user, $data) {
            $code = $this->nextCode(ClmClauseLibrary::class, $user->client_id, $user->branch_id, 'CL');
            return ClmClauseLibrary::create([
                'client_id'     => $user->client_id,
                'branch_id'     => $user->branch_id,   // branch-owned; null for client-level users → shared
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
        $lookup = ClmClauseLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        // Branch users may view shared client-level clauses but not edit them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        if ($request->has('name')) $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'clause_type'   => 'sometimes|required|string|max:255',
            'name'          => ['sometimes', 'required', 'string', 'max:255'],
            'party'         => 'sometimes|nullable|string|max:255',
            'clause_status' => 'nullable|string|max:32',
            'content'       => 'nullable|string',
        ]);

        // Reject rename to a duplicate name within the tenant (case-insensitive,
        // excluding self).
        if (isset($data['name'])) {
            $clash = ClmClauseLibrary::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($data['name']))])
                ->exists();
            if ($clash) {
                return response()->json(['status' => false, 'message' => 'A clause with this name already exists.'], 409);
            }
        }

        if (array_key_exists('party', $data)) $data['party'] = trim((string) $data['party']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmClauseLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * Allocate the next sequential code (e.g. CL-005 / CLT-005) for a
     * client + branch. Branch-scoped so each branch restarts its own
     * sequence from 001 rather than continuing another branch's tally
     * (the clause master is branch-isolated via MasterVisibility). A
     * client-level creator ($branchId null) sequences the shared rows.
     * Uses max-existing + skip-taken rather than count()+1, so deleting a
     * middle row never makes the next code collide with an existing one.
     * Runs under a row lock on the client to serialise concurrent inserts.
     *
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $model
     */
    private function nextCode(string $model, int $clientId, ?int $branchId, string $prefix): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $query = $model::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('%s-%03d', $prefix, $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
