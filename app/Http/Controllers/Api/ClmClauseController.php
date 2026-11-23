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

    public function typesIndex(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $branchFilter = $request->integer('branch_id') ?: null;
        $typeQuery = ClmClauseType::query()
            ->orderBy('id', $request->filled('per_page') ? 'desc' : 'asc');
        MasterVisibility::applyReadScope($typeQuery, $user, $branchFilter);

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $typeQuery->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)->orWhere('code', 'ilike', $like);
            });
        }

        if ($request->boolean('with_clauses')) {
            $usedQuery = ClmClauseLibrary::query();
            MasterVisibility::applyReadScope($usedQuery, $user, $branchFilter);
            $used = $usedQuery->selectRaw('DISTINCT LOWER(TRIM(clause_type)) AS t')->pluck('t')->all();
            $typeQuery->whereIn(DB::raw('LOWER(TRIM(name))'), $used ?: ['']);
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $typeQuery)->count() : null;

        $rows = $perPage ? $typeQuery->forPage($page, $perPage)->get() : $typeQuery->get();

        $usageQuery = ClmClauseLibrary::query();
        MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
        $usage = $usageQuery
            ->selectRaw('LOWER(clause_type) as t, COUNT(*) as c')
            ->groupBy(DB::raw('LOWER(clause_type)'))
            ->pluck('c', 't');
        $rows->each(function ($row) use ($usage) {
            $row->in_use = (int) ($usage[mb_strtolower((string) $row->name)] ?? 0);
        });

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
        ]);
    }

    public function typesStore(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'name'        => ['required', 'string', 'max:100'],
            'description' => 'nullable|string|max:500',
        ]);

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
                'branch_id'   => $user->branch_id,
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
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmClauseType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

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
            'name'        => ['sometimes', 'required', 'string', 'max:100'],
            'description' => 'sometimes|nullable|string|max:500',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (array_key_exists('description', $data)) $data['description'] = trim((string) $data['description']);

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
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmClauseType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    public function libraryIndex(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        @ini_set('memory_limit', '512M');

        $query = ClmClauseLibrary::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);

        if ($type = trim((string) $request->input('clause_type', ''))) {
            $query->where('clause_type', $type);
        }

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $query->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)
                    ->orWhere('code', 'ilike', $like)
                    ->orWhere('clause_type', 'ilike', $like);
            });
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $query)->count() : null;

        $rows = $perPage ? $query->forPage($page, $perPage)->get() : $query->get();

        $used = $this->usedClauseNames((int) $user->client_id);
        foreach ($rows as $row) {
            $row->in_use = isset($used[mb_strtolower(trim((string) $row->name))]) ? 1 : 0;
        }

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
        ]);
    }

    private function usedClauseNames(int $clientId): array
    {
        $build = function () use ($clientId): array {
            $names = ClmClauseLibrary::where('client_id', $clientId)
                ->whereNotNull('name')->pluck('name');

            $items = [];
            foreach ($names as $name) {
                $needle = $this->clauseNeedle((string) $name);
                if ($needle === '') continue;
                $items[] = ['row' => (object) ['in_use' => 0, 'name' => (string) $name], 'needle' => $needle];
            }
            $this->scanCtcForClauses($clientId, $items);

            $used = [];
            foreach ($items as $it) {
                if ($it['row']->in_use) $used[mb_strtolower(trim($it['row']->name))] = true;
            }
            return $used;
        };

        try {
            return \Illuminate\Support\Facades\Cache::remember(
                'clm:clause:used:v1:' . $clientId,
                now()->addSeconds(60),
                $build
            );
        } catch (\Throwable $e) {
            return $build();
        }
    }

    private function scanCtcForClauses(int $clientId, array $items): void
    {
        $items = array_values(array_filter($items, fn($it) => ($it['needle'] ?? '') !== ''));
        if (!$items) return;
        \App\Models\CtcContract::where('client_id', $clientId)
            ->select('id', 'content', 'versions')
            ->chunkById(25, function ($chunk) use ($items) {
                foreach ($chunk as $c) {
                    $hay = mb_strtolower((string) $c->content);
                    foreach ((array) ($c->versions ?? []) as $v) {
                        $hay .= "\n" . mb_strtolower((string) ($v['content'] ?? ''));
                    }
                    $allDone = true;
                    foreach ($items as $it) {
                        if ($it['row']->in_use) continue;
                        if (mb_strpos($hay, $it['needle']) !== false) $it['row']->in_use = 1;
                        else $allDone = false;
                    }
                    if ($allDone) return false;
                }
            });
    }

    private function clauseNeedle(string $name): string
    {
        $name = trim($name);
        return $name === '' ? '' : mb_strtolower('<h3>' . e($name) . '</h3>');
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $request->merge(['name' => trim((string) $request->input('name'))]);
        $data = $request->validate([
            'clause_type'   => 'required|string|max:255',
            'name'          => ['required', 'string', 'max:255'],
            'party'         => 'nullable|string|max:255',
            'clause_status' => 'nullable|string|max:32',
            'content'       => 'nullable|string',
        ]);

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
                'branch_id'     => $user->branch_id,
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
        return response()->json(['status' => true, 'data' => $row->makeHidden('content')], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmClauseLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
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
        return response()->json(['status' => true, 'data' => $row->fresh()->makeHidden('content')]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmClauseLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $needle = $this->clauseNeedle((string) $row->name);
        if ($needle !== '') {
            $probe = (object) ['in_use' => 0];
            $this->scanCtcForClauses((int) $user->client_id, [['row' => $probe, 'needle' => $needle]]);
            if ($probe->in_use) {
                return response()->json(['status' => false, 'message' => 'This clause is used in one or more CTC agreements and cannot be deleted.'], 409);
            }
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(string $model, int $clientId, ?int $branchId, string $prefix): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        return $this->previewCode($model, $clientId, $branchId, $prefix);
    }
    private function previewCode(string $model, int $clientId, ?int $branchId, string $prefix): string
    {
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
