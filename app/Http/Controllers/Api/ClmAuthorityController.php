<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Support\ClmMasterAccess;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClmAuthorityController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ClmAuthority::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)
                    ->orWhere('code', 'ilike', $like)
                    ->orWhere('description', 'ilike', $like);
            });
        }

        if ($request->input('view') === 'options') {
            return response()->json([
                'status' => true,
                'data'   => $q->get(['id', 'code', 'name', 'status']),
            ]);
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $q)->count() : null;

        $rows = $perPage ? $q->forPage($page, $perPage)->get() : $q->get();

        if ($rows->isNotEmpty()) {
            $usage = $this->cachedUsageSets((int) $user->client_id);
            $usedIds   = $usage['ids'];
            $usedNames = $usage['names'];
            $usedCodes = $usage['codes'];

            $rows->each(function ($r) use ($usedIds, $usedNames, $usedCodes) {
                $r->in_use = isset($usedIds[(string) $r->id])
                    || self::usageHas($usedNames, $r->branch_id, mb_strtolower(trim((string) $r->name)))
                    || self::usageHas($usedCodes, $r->branch_id, (string) $r->code);
            });
        }

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
            'next_code' => $this->nextCodePreview((int) $user->client_id, $user->branch_id ?: null),
        ]);
    }

    private function nextCodePreview(int $clientId, ?int $branchId): string
    {
        $query = ClmAuthority::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);

        $maxN  = 0;
        $taken = [];
        foreach ($query->pluck('code') as $c) {
            if (preg_match('/^AUTH-(\d+)$/', (string) $c, $m) && (int) $m[1] > $maxN) $maxN = (int) $m[1];
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('AUTH-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'description' => 'required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        $name = trim($data['name']);
        $dupe = ClmAuthority::query()->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            throw ValidationException::withMessages([
                'name' => "An authority named \"{$name}\" already exists.",
            ]);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            return ClmAuthority::create([
                'client_id'   => $user->client_id,
                'branch_id'   => $user->branch_id,
                'code'        => $this->nextCode($user->client_id, $user->branch_id),
                'name'        => $name,
                'description' => trim($data['description']),
                'status'      => $data['status'] ?? ClmAuthority::STATUS_ACTIVE,
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function import(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $request->validate(['rows' => 'required|array|min:1|max:20000']);
        @set_time_limit(300);

        $existing = ClmAuthority::query();
        MasterVisibility::applyReadScope($existing, $user, $user->branch_id ?: null);
        $seen = [];
        $key = fn($n) => mb_strtolower(trim((string) $n));
        foreach ($existing->get(['name']) as $e) $seen[$key($e->name)] = true;

        $imported = [];
        $failed   = [];
        $valid    = [];

        foreach (array_values($request->input('rows')) as $i => $r) {
            $rowNo = (int) (is_array($r) && isset($r['row']) ? $r['row'] : $i + 2);
            $name  = trim((string) (is_array($r) ? ($r['name'] ?? '') : ''));
            $desc  = trim((string) (is_array($r) ? ($r['description'] ?? '') : ''));

            $reason = null;
            if ($name === '')                        $reason = 'Authority name is required';
            elseif ($desc === '')                    $reason = 'Description is required';
            elseif (mb_strlen($name) > 255)          $reason = 'Authority name exceeds 255 characters';
            elseif (mb_strlen($desc) > 500)          $reason = 'Description exceeds 500 characters';
            elseif (isset($seen[$key($name)]))       $reason = 'An authority with this name already exists';

            if ($reason) {
                $failed[] = ['row' => $rowNo, 'name' => $name, 'description' => $desc, 'reason' => $reason];
                continue;
            }

            $seen[$key($name)] = true;
            $valid[] = ['row' => $rowNo, 'name' => $name, 'description' => $desc];
        }

        if ($valid) {
            try {
                DB::transaction(function () use ($user, $valid, &$imported) {
                    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
                    $q = ClmAuthority::where('client_id', $user->client_id);
                    $user->branch_id ? $q->where('branch_id', $user->branch_id) : $q->whereNull('branch_id');
                    $maxN = 0;
                    $taken = [];
                    foreach ($q->pluck('code') as $c) {
                        if (preg_match('/^AUTH-(\d+)$/', (string) $c, $m) && (int) $m[1] > $maxN) $maxN = (int) $m[1];
                        $taken[(string) $c] = true;
                    }

                    $now = now();
                    $n = $maxN;
                    foreach (array_chunk($valid, 500) as $chunk) {
                        $insert = [];
                        foreach ($chunk as $v) {
                            do {
                                $n++;
                                $code = sprintf('AUTH-%03d', $n);
                            } while (isset($taken[$code]));
                            $insert[] = [
                                'client_id'   => $user->client_id,
                                'branch_id'   => $user->branch_id,
                                'code'        => $code,
                                'name'        => $v['name'],
                                'description' => $v['description'],
                                'status'      => ClmAuthority::STATUS_ACTIVE,
                                'created_by'  => $user->id,
                                'updated_by'  => $user->id,
                                'created_at'  => $now,
                                'updated_at'  => $now,
                            ];
                            $imported[] = ['row' => $v['row'], 'code' => $code, 'name' => $v['name'], 'description' => $v['description']];
                        }
                        ClmAuthority::insert($insert);
                    }
                });
            } catch (\Throwable $e) {
                report($e);
                $imported = [];
                foreach ($valid as $v) {
                    $failed[] = $v + ['reason' => 'Could not save — import rolled back'];
                }
            }
        }

        return response()->json([
            'status'   => true,
            'imported' => $imported,
            'failed'   => $failed,
        ]);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmAuthority::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'edit', 'clm.authority')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);

        if (isset($data['name'])) {
            $newName = trim((string) $data['name']);
            $clash = ClmAuthority::query()->where('id', '!=', $row->id)
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($newName)]);
            MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
            $clash = $clash->exists();
            if ($clash) {
                throw ValidationException::withMessages([
                    'name' => "Another authority named \"{$newName}\" already exists.",
                ]);
            }
        }

        $oldName = $row->name;
        $data['updated_by'] = $user->id;

        DB::transaction(function () use ($row, $data, $oldName) {
            $row->update($data);
            if (array_key_exists('name', $data) && $data['name'] !== $oldName) {
                $this->cascadeRename((int) $row->client_id, $row->branch_id, $oldName, $data['name']);
            }
        });

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmAuthority::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'delete', 'clm.authority')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedIn = $this->authorityUsage((int) $user->client_id, (int) $row->id, $row->name, $row->code, $row->branch_id);

        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This authority is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function idUsageTables(): array
    {
        return [
            ['table' => 'clm_kyc_documents',  'col' => 'authority', 'label' => 'KYC Documents'],
            ['table' => 'clm_dd_documents',   'col' => 'authority', 'label' => 'Due Diligence Documents'],
            ['table' => 'clm_trade_licenses', 'col' => 'authority', 'label' => 'Trade Licenses'],
            ['table' => 'clm_qc_documents',   'col' => 'issued_by', 'label' => 'Quality & Compliance Docs'],
        ];
    }

    private function nameUsageTables(): array
    {
        return [
            ['table' => 'vendor_documents',   'col' => 'issuing_authority', 'label' => 'Vendor Documents',   'owner' => 'vendors',   'fk' => 'vendor_id'],
            ['table' => 'customer_documents', 'col' => 'issuing_authority', 'label' => 'Customer Documents', 'owner' => 'customers', 'fk' => 'customer_id'],
            ['table' => 'vendor_owners',      'col' => 'issuing_authority', 'label' => 'Vendor Owners',      'owner' => 'vendors',   'fk' => 'vendor_id'],
        ];
    }

    private static function branchKey($branchId): string
    {
        return $branchId === null ? 'shared' : (string) (int) $branchId;
    }

    private static function usageHas(array $byBranch, $branchId, string $key): bool
    {
        if ($key === '') return false;
        if ($branchId === null) {
            foreach ($byBranch as $set) {
                if (isset($set[$key])) return true;
            }
            return false;
        }
        return isset($byBranch[self::branchKey($branchId)][$key])
            || isset($byBranch['shared'][$key]);
    }

    private function authorityUsage(int $clientId, int $id, string $name, ?string $code, ?int $branchId): array
    {
        $usedIn = [];

        foreach ($this->idUsageTables() as $t) {
            if (!$this->schemaHas($t["table"], $t["col"])) continue;
            $q = DB::table($t['table'])->where($t['col'], 'like', '%' . $id . '%');
            if ($this->schemaHas($t["table"], "client_id")) $q->where('client_id', $clientId);
            $hit = $q->pluck($t['col'])->contains(fn($v) => ClmAuthority::storedContainsId($v, $id));
            if ($hit) $usedIn[] = $t['label'];
        }

        foreach ($this->nameUsageTables() as $t) {
            if (!$this->legacyScopable($t)) continue;
            $q = DB::table($t['table'] . ' as d')
                ->join($t['owner'] . ' as o', 'o.id', '=', 'd.' . $t['fk'])
                ->where('o.client_id', $clientId)
                ->where('d.' . $t['col'], $name);
            if ($branchId !== null) {
                $q->where(fn ($w) => $w->where('o.branch_id', $branchId)->orWhereNull('o.branch_id'));
            }
            if ($q->exists()) $usedIn[] = $t['label'];
        }

        if ($code && $this->schemaHas('clm_segment_rules', 'auths_json')) {
            $rules = DB::table('clm_segment_rules');
            if ($this->schemaHas('clm_segment_rules', 'client_id')) {
                $rules->where('client_id', $clientId);
            }
            if ($branchId !== null && $this->schemaHas('clm_segment_rules', 'branch_id')) {
                $rules->where(fn($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id'));
            }
            foreach ($rules->pluck('auths_json') as $j) {
                if (in_array($code, self::codesInAuthsJson($j), true)) {
                    $usedIn[] = 'Segment Rules';
                    break;
                }
            }
        }

        return $usedIn;
    }

    private function cascadeRename(int $clientId, ?int $branchId, string $oldName, string $newName): void
    {
        if ($oldName === $newName) return;

        $ownNameBranches = $branchId === null
            ? ClmAuthority::query()
                ->where('client_id', $clientId)
                ->whereNotNull('branch_id')
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim($oldName))])
                ->distinct()->pluck('branch_id')->all()
            : [];

        foreach ($this->nameUsageTables() as $t) {
            if (!$this->legacyScopable($t)) continue;

            $owners = function ($s) use ($t, $clientId, $branchId, $ownNameBranches) {
                $s->select('id')->from($t['owner'])->where('client_id', $clientId);
                if ($branchId !== null) {
                    $s->where('branch_id', $branchId);
                } elseif ($ownNameBranches) {
                    $s->where(fn ($w) => $w->whereNull('branch_id')->orWhereNotIn('branch_id', $ownNameBranches));
                }
            };

            DB::table($t['table'])
                ->where($t['col'], $oldName)
                ->whereIn($t['fk'], $owners)
                ->update([$t['col'] => $newName]);
        }
    }

    private function legacyScopable(array $t): bool
    {
        return $this->schemaHas($t['table'], $t['col'])
            && $this->schemaHas($t['table'], $t['fk'])
            && $this->schemaHas($t['owner'], 'client_id')
            && $this->schemaHas($t['owner'], 'branch_id');
    }

    private function cachedUsageSets(int $clientId): array
    {
        $build = fn() => [
            'ids'   => $this->usedIdSet($clientId),
            'names' => $this->usedNameSet($clientId),
            'codes' => $this->usedCodeSet($clientId),
        ];

        try {
            return \Illuminate\Support\Facades\Cache::remember(
                'clm:auth:usage:v2:' . $clientId,
                now()->addSeconds(60),
                $build
            );
        } catch (\Throwable $e) {
            return $build();
        }
    }

    private function schemaHas(string $table, string $column): bool
    {
        static $map = null;

        if ($map === null) {
            $tables = array_values(array_unique(array_merge(
                array_column($this->idUsageTables(), 'table'),
                array_column($this->nameUsageTables(), 'table'),
                array_column($this->nameUsageTables(), 'owner'),
                ['clm_segment_rules']
            )));

            $map = [];
            try {
                $rows = DB::table('information_schema.columns')
                    ->whereRaw('table_schema = current_schema()')
                    ->whereIn('table_name', $tables)
                    ->get(['table_name', 'column_name']);
                foreach ($rows as $r) {
                    $map[$r->table_name . '.' . $r->column_name] = true;
                }
            } catch (\Throwable $e) {
                $map = false;
            }
        }

        if ($map === false) {
            return Schema::hasTable($table) && Schema::hasColumn($table, $column);
        }
        return isset($map[$table . '.' . $column]);
    }

    private function usedIdSet(?int $clientId): array
    {
        $used = [];
        foreach ($this->idUsageTables() as $t) {
            if (!$this->schemaHas($t["table"], $t["col"])) continue;
            $q = DB::table($t['table'])->whereNotNull($t['col']);
            if ($clientId && $this->schemaHas($t["table"], "client_id")) $q->where('client_id', $clientId);
            foreach ($q->pluck($t['col']) as $v) {
                foreach (explode(',', (string) $v) as $tok) {
                    $tok = trim($tok);
                    if ($tok !== '') $used[$tok] = true;
                }
            }
        }
        return $used;
    }

    private function usedNameSet(?int $clientId): array
    {
        $used = [];
        foreach ($this->nameUsageTables() as $t) {
            if (!$clientId || !$this->legacyScopable($t)) continue;
            $q = DB::table($t['table'] . ' as d')
                ->join($t['owner'] . ' as o', 'o.id', '=', 'd.' . $t['fk'])
                ->where('o.client_id', $clientId)
                ->whereNotNull('d.' . $t['col'])
                ->distinct();
            foreach ($q->get(['o.branch_id', 'd.' . $t['col'] . ' as v']) as $r) {
                $p = mb_strtolower(trim((string) $r->v));
                if ($p !== '') $used[self::branchKey($r->branch_id)][$p] = true;
            }
        }
        return $used;
    }

    private function usedCodeSet(?int $clientId): array
    {
        $used = [];
        if (!$this->schemaHas('clm_segment_rules', 'auths_json')) {
            return $used;
        }
        $q = DB::table('clm_segment_rules');
        if ($clientId && $this->schemaHas('clm_segment_rules', 'client_id')) {
            $q->where('client_id', $clientId);
        }
        $cols = $this->schemaHas('clm_segment_rules', 'branch_id') ? ['branch_id', 'auths_json'] : ['auths_json'];
        foreach ($q->get($cols) as $r) {
            $bk = self::branchKey($r->branch_id ?? null);
            foreach (self::codesInAuthsJson($r->auths_json) as $c) $used[$bk][$c] = true;
        }
        return $used;
    }

    private static function codesInAuthsJson($json): array
    {
        $arr = is_array($json) ? $json : (json_decode((string) $json, true) ?: []);
        if (!is_array($arr)) return [];

        $out = [];
        array_walk_recursive($arr, function ($v, $k) use (&$out) {
            foreach ([$v, $k] as $candidate) {
                if (is_string($candidate) && preg_match('/^AUTH-\d+$/', $candidate)) {
                    $out[$candidate] = true;
                }
            }
        });
        return array_keys($out);
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $query = ClmAuthority::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^AUTH-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('AUTH-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
