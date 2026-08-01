<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmDdDocument;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClmDdController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-434).
        $q = ClmDdDocument::query()->orderByDesc('id');   // newest entry first
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
        $rows = $q->get();

        // `authority` stores authority ids; expose the resolved current names.
        $map = ClmAuthority::idNameMap($user->client_id);
        $rows->each(fn ($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));

        // Per-row "in use" flags so the UI can disable + explain the delete
        // action for referenced documents (mirrors the checks in destroy()).
        $rows->each(function ($r) {
            $labels = $this->usageCheck($r->code, $r->client_id);
            $r->in_use  = !empty($labels);
            $r->used_in = array_values($labels);
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'authority' => 'required|string|max:2000',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmDdDocument::STATUSES)],
        ]);

        $name = trim($data['name']);
        $dupe = ClmDdDocument::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            throw ValidationException::withMessages([
                'name' => "A due-diligence document named \"{$name}\" already exists. Pick a different name.",
            ]);
        }

        // Store authority by id (resolve names → ids); reject if nothing valid.
        $data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
        if ($data['authority'] === '') {
            throw ValidationException::withMessages(['authority' => 'Select at least one valid authority.']);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmDdDocument::create([
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'       => $this->nextCode($user->client_id, $user->branch_id),
                'name'       => trim($data['name']),
                'authority'  => $data['authority'],
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
        $lookup = ClmDdDocument::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'authority' => 'sometimes|required|string|max:2000',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmDdDocument::STATUSES)],
        ]);

        if (isset($data['name'])) $data['name'] = trim($data['name']);
        if (isset($data['authority'])) {
            $data['authority'] = ClmAuthority::normalizeIds($data['authority'], $user->client_id);
            if ($data['authority'] === '') {
                throw ValidationException::withMessages(['authority' => 'Select at least one valid authority.']);
            }
        }

        if (isset($data['name'])) {
            $clash = ClmDdDocument::query()->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
            MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
            if ($clash->exists()) {
                throw ValidationException::withMessages([
                    'name' => "Another due-diligence document named \"{$data['name']}\" already exists. Pick a different name.",
                ]);
            }
        }

        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmDdDocument::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedIn = $this->usageCheck($row->code, $row->client_id);
        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This due-diligence document is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /** Usage check — MUST be scoped to the licence's own client. Codes restart
     *  per client (DD-001, DD-002, …), so an unscoped check falsely marked THIS
     *  client's doc "in use" whenever ANY other client used the same code,
     *  blocking deletion of a doc not referenced anywhere in this tenant. */
    private function usageCheck(?string $code, ?int $clientId = null): array
    {
        if (!$code) return [];
        $usedIn = [];
        if (Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'doc_selections')
            && DB::table('clm_segment_rules')
                ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
                ->where('doc_selections', 'like', '%"' . $code . '"%')
                ->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if (Schema::hasTable('segment_doc_uploads')
            && Schema::hasColumn('segment_doc_uploads', 'doc_code')
            && DB::table('segment_doc_uploads')
                ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
                ->where('doc_code', $code)
                ->exists()) {
            $usedIn[] = 'Segment Doc Uploads';
        }
        return $usedIn;
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Branch-scoped so each branch restarts from DD-001 rather than
        // continuing another branch's tally — the DD master is branch-
        // isolated via MasterVisibility. A client-level creator ($branchId
        // null) sequences the shared rows.
        $query = ClmDdDocument::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^DD-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('DD-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
