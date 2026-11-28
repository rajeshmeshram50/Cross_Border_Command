<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmSegment;
use App\Support\MasterBundleCache;
use App\Support\ClmMasterAccess;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class ClmSegmentController extends Controller
{
    private const USAGE_TABLES = [
        'clm_segment_rules', 'customers', 'consignees', 'clm_tnc_library',
        'vendors', 'products', 'master_vendor_directory', 'clm_agreement_library',
    ];

    private array $columnCache = [];

    private function schemaHas(string $table, ?string $column = null): bool
    {
        static $map = null;

        if ($map === null) {
            $map = [];
            try {
                $rows = DB::table('information_schema.columns')
                    ->whereRaw('table_schema = current_schema()')
                    ->whereIn('table_name', self::USAGE_TABLES)
                    ->get(['table_name', 'column_name']);
                foreach ($rows as $r) {
                    $map[$r->table_name][$r->column_name] = 1;
                }
            } catch (\Throwable $e) {
                $map = [];
            }
        }

        $cols = $map[$table]
            ?? ($this->columnCache[$table] ??= array_flip(Schema::getColumnListing($table)));

        return $column === null ? $cols !== [] : isset($cols[$column]);
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = ClmSegment::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        $bc = $request->input('buyer_consignee');
        if ($bc === 'allowed') {
            $q->where('buyer_consignee', ClmSegment::BC_ALLOWED);
        } elseif ($bc === 'not') {
            $q->where(fn ($w) => $w->whereNull('buyer_consignee')->orWhere('buyer_consignee', '<>', ClmSegment::BC_ALLOWED));
        }
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->where(fn ($w) => $w->where('name', 'ilike', $like)->orWhere('code', 'ilike', $like));
        }

        $c = (clone $q)->reorder()->toBase()->selectRaw(
            'COUNT(*) AS total_all,
             COUNT(*) FILTER (WHERE regulatory_status = ?) AS total_highly,
             COUNT(*) FILTER (WHERE regulatory_status = ?) AS total_less',
            [ClmSegment::REG_HIGHLY, ClmSegment::REG_LESS]
        )->first();
        $counts = ['all' => (int) $c->total_all, 'highly' => (int) $c->total_highly, 'less' => (int) $c->total_less];

        if (in_array($reg = $request->input('regulatory_status'), ClmSegment::REG_VALUES, true)) {
            $q->where('regulatory_status', $reg);
        }

        $perPage = $request->filled('per_page') ? min(200, max(1, (int) $request->input('per_page'))) : null;
        $total   = $perPage ? (clone $q)->count() : null;
        $rows    = $perPage ? $q->forPage(max(1, (int) $request->input('page', 1)), $perPage)->get() : $q->get();

        if (!$request->boolean('lite')) {
            $usage = $this->usageLabels($rows);
            $rows->each(function ($r) use ($usage) {
                $labels = $usage[$r->id] ?? [];
                $r->in_use  = !empty($labels);
                $r->used_in = array_values($labels);
            });
        }

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
            'counts' => $counts,
        ]);
    }

    private function usageLabels($rows): array
    {
        if ($rows->isEmpty()) return [];
        $ids    = $rows->pluck('id')->all();
        $names  = $rows->pluck('name')->all();
        $segsByName = [];
        foreach ($rows as $r) {
            $segsByName[$r->name][] = $r;
        }

        $map = [];
        $addById = function ($segId, $label) use (&$map, $ids) {
            $segId = (int) $segId;
            if (!in_array($segId, $ids, true)) return;
            if (!isset($map[$segId])) $map[$segId] = [];
            if (!in_array($label, $map[$segId], true)) $map[$segId][] = $label;
        };

        $addByName = function ($name, $refClientId, $refBranchId, $label, $scoped = true, ?string $tier = null) use (&$map, $segsByName) {
            foreach ($segsByName[$name] ?? [] as $seg) {
                if ($scoped && !self::referenceMayPointAt($seg, $refClientId, $refBranchId)) continue;
                if ($tier !== null && $tier !== '' && $seg->regulatory_status !== $tier) continue;
                $segId = (int) $seg->id;
                if (!isset($map[$segId])) $map[$segId] = [];
                if (!in_array($label, $map[$segId], true)) $map[$segId][] = $label;
            }
        };

        if ($this->schemaHas('clm_segment_rules')) {
            foreach (DB::table('clm_segment_rules')->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                $addById($sid, 'Segment Rules');
            }
        }
        $referencedIds = function (string $table, bool $softDeletes) use ($ids): array {
            $q = DB::table($table)->whereNotNull('segment_ids');
            if ($softDeletes) $q->whereNull('deleted_at');
            $seen = [];
            foreach ($q->pluck('segment_ids') as $raw) {
                $arr = is_array($raw) ? $raw : json_decode((string) $raw, true);
                if (!is_array($arr)) continue;
                foreach ($arr as $v) {
                    if (!is_int($v)) continue;
                    if (in_array($v, $ids, true)) $seen[$v] = true;
                }
            }
            return array_keys($seen);
        };

        foreach ([
            ['customers', 'Customers', true],
            ['consignees', 'Consignees', true],
            ['clm_tnc_library', 'T&C Library', false],
        ] as [$table, $label, $softDeletes]) {
            if (!$this->schemaHas($table) || !$this->schemaHas($table, 'segment_ids')) continue;
            foreach ($referencedIds($table, $softDeletes) as $sid) $addById($sid, $label);
        }
        foreach ([['vendors', 'Vendors'], ['products', 'Products']] as [$table, $label]) {
            if ($this->schemaHas($table) && $this->schemaHas($table, 'segment_id')) {
                foreach (DB::table($table)->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                    $addById($sid, $label);
                }
            }
        }
        if ($this->schemaHas('master_vendor_directory') && $this->schemaHas('master_vendor_directory', 'segment_id')) {
            $strIds = array_map('strval', $ids);
            [$refCols, $refScoped] = $this->referenceStampColumns('master_vendor_directory');
            $vals = DB::table('master_vendor_directory')
                ->where(function ($q) use ($strIds, $names) {
                    $q->whereIn('segment_id', $strIds)->orWhereIn('segment_id', $names);
                })
                ->select(array_merge(['segment_id'], $refCols))->distinct()->get();
            foreach ($vals as $v) {
                if (in_array((string) $v->segment_id, $strIds, true)) $addById((int) $v->segment_id, 'Vendor Directory');
                else $addByName($v->segment_id, $v->client_id ?? null, $v->branch_id ?? null, 'Vendor Directory', $refScoped);
            }
        }

        foreach (
            [
                ['clm_agreement_library', 'segment', 'Agreement Library'],
            ] as [$table, $col, $label]
        ) {
            if ($this->schemaHas($table) && $this->schemaHas($table, $col)) {
                [$refCols, $refScoped] = $this->referenceStampColumns($table);
                $tierCol = $this->schemaHas($table, 'regulatory') ? ['regulatory'] : [];
                $refs = DB::table($table)->whereIn($col, $names)
                    ->select(array_merge([$col], $refCols, $tierCol))->distinct()->get();
                foreach ($refs as $ref) {
                    $addByName($ref->$col, $ref->client_id ?? null, $ref->branch_id ?? null, $label, $refScoped, isset($ref->regulatory) ? strtolower(trim((string) $ref->regulatory)) : null);
                }
            }
        }

        return $map;
    }

    private function duplicateExists($user, string $name, string $regulatoryStatus, ?int $exceptId = null): bool
    {
        $q = ClmSegment::query()
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim($name))])
            ->where('regulatory_status', $regulatoryStatus)
            ->when($exceptId, fn ($w) => $w->where('id', '!=', $exceptId));
        MasterVisibility::applyReadScope($q, $user, $user->branch_id ?: null);
        return $q->exists();
    }

    private function duplicateMessage(string $name, string $regulatoryStatus): string
    {
        $label = $regulatoryStatus === ClmSegment::REG_HIGHLY ? 'Highly Regulated' : 'Less Regulated';
        return "\"{$name}\" already exists as {$label}. Pick a different name or regulatory status.";
    }

    private function referenceStampColumns(string $table): array
    {
        $cols = [];
        $hasClient = $this->schemaHas($table, 'client_id');
        if ($hasClient) $cols[] = 'client_id';
        if ($this->schemaHas($table, 'branch_id')) $cols[] = 'branch_id';
        return [$cols, $hasClient];
    }

    private static function referenceMayPointAt($seg, $refClientId, $refBranchId): bool
    {
        $segClient = $seg->client_id === null ? null : (int) $seg->client_id;
        if ($segClient === null) return true;

        $refClient = $refClientId === null ? null : (int) $refClientId;
        if ($refClient !== $segClient) return false;

        $segBranch = $seg->branch_id === null ? null : (int) $seg->branch_id;
        if ($segBranch === null) return true;

        $refBranch = $refBranchId === null ? null : (int) $refBranchId;
        return $refBranch === null || $refBranch === $segBranch;
    }

    private function scopeToSegment($q, string $table, $seg): void
    {
        if (!$this->schemaHas($table, 'client_id') || $seg->client_id === null) return;
        $q->where('client_id', $seg->client_id);

        if (!$this->schemaHas($table, 'branch_id') || $seg->branch_id === null) return;
        $q->where(function ($w) use ($seg) {
            $w->where('branch_id', $seg->branch_id)->orWhereNull('branch_id');
        });
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);
        }

        $data = $request->validate([
            'name'              => 'required|string|max:255',
            'regulatory_status' => ['required', Rule::in(ClmSegment::REG_VALUES)],
            'buyer_consignee'   => ['required', Rule::in(ClmSegment::BC_VALUES)],
            'status'            => ['nullable', Rule::in(ClmSegment::STATUSES)],
        ]);

        $name = trim($data['name']);
        if ($this->duplicateExists($user, $name, $data['regulatory_status'])) {
            $msg = $this->duplicateMessage($name, $data['regulatory_status']);
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 422);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmSegment::create([
                'client_id'         => $user->client_id,
                'branch_id'         => $user->branch_id,
                'code'              => $this->nextCode($user->client_id, $user->branch_id),
                'name'              => trim($data['name']),
                'regulatory_status' => $data['regulatory_status'],
                'buyer_consignee'   => $data['buyer_consignee'],
                'status'            => $data['status'] ?? ClmSegment::STATUS_ACTIVE,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        });

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmSegment::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'edit', 'clm.segment')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            'name'              => 'sometimes|required|string|max:255',
            'regulatory_status' => ['sometimes', 'required', Rule::in(ClmSegment::REG_VALUES)],
            'buyer_consignee'   => ['sometimes', 'required', Rule::in(ClmSegment::BC_VALUES)],
            'status'            => ['nullable', Rule::in(ClmSegment::STATUSES)],
        ]);

        if (isset($data['name'])) $data['name'] = trim($data['name']);

        $usedIn = $this->usageLabels(collect([$row]))[$row->id] ?? [];

        if (isset($data['name']) && $data['name'] !== (string) $row->name && !empty($usedIn)) {
            $msg = 'This segment is in use by ' . implode(', ', $usedIn) . " — its name can't be changed.";
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 409);
        }

        if (
            isset($data['regulatory_status'])
            && $data['regulatory_status'] !== $row->regulatory_status
            && !empty($usedIn)
        ) {
            $msg = 'This segment is in use by ' . implode(', ', $usedIn) . " — its regulatory status can't be changed.";
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['regulatory_status' => [$msg]],
            ], 422);
        }

        if (isset($data['name']) || isset($data['regulatory_status'])) {
            $finalName = $data['name'] ?? (string) $row->name;
            $finalReg  = $data['regulatory_status'] ?? (string) $row->regulatory_status;
            if ($this->duplicateExists($user, $finalName, $finalReg, (int) $row->id)) {
                $msg = $this->duplicateMessage($finalName, $finalReg);
                return response()->json([
                    'status'  => false,
                    'message' => $msg,
                    'errors'  => ['name' => [$msg]],
                ], 422);
            }
        }

        $oldName = (string) $row->name;

        $data['updated_by'] = $user->id;
        $row->update($data);

        if (isset($data['name']) && $oldName !== '' && strcasecmp($oldName, (string) $row->name) !== 0) {
            $this->cascadeSegmentRename((int) $row->id, $row->client_id, $oldName, (string) $row->name);
        }

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    private function cascadeSegmentRename(int $segmentId, $clientId, string $old, string $new): void
    {
        // Agreement / Trade Document libraries match by segment id, so a rename
        // no longer detaches them. Only the display text is brought up to date:
        // the old name becomes the new one on rows linked to this segment id,
        // and stays as well if another linked segment still carries it. The ids
        // are not touched (DB::table, so the model save hook does not run).
        foreach (['clm_agreement_library', 'clm_trade_doc_library'] as $lib) {
            if (!$this->schemaHas($lib, 'segment_ids')) continue;
            $rows = DB::table($lib)->where('client_id', $clientId)
                ->whereRaw('segment_ids::jsonb @> ?::jsonb', [json_encode([$segmentId])])
                ->get(['id', 'segment', 'segment_ids']);
            foreach ($rows as $r) {
                $ids = array_values(array_filter(array_map('intval', (array) json_decode((string) $r->segment_ids, true))));
                $otherOld = DB::table('clm_segments')
                    ->whereIn('id', array_diff($ids, [$segmentId]) ?: [0])
                    ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim($old))])
                    ->exists();
                $parts = [];
                foreach (array_map('trim', explode(',', (string) $r->segment)) as $p) {
                    if ($p === '') continue;
                    if (strcasecmp($p, trim($old)) === 0) {
                        $parts[] = $new;
                        if ($otherOld) $parts[] = $p;
                    } else {
                        $parts[] = $p;
                    }
                }
                $text = implode(', ', array_values(array_unique($parts)));
                if ($text !== (string) $r->segment) {
                    DB::table($lib)->where('id', $r->id)->update(['segment' => $text]);
                }
            }
        }

        if ($this->schemaHas('clm_tnc_library', 'segment_ids')) {
            foreach (DB::table('clm_tnc_library')->whereJsonContains('segment_ids', $segmentId)->get(['id', 'segment_ids']) as $r) {
                $names = \App\Support\SegmentGuard::namesFor(json_decode((string) $r->segment_ids, true) ?: []);
                if ($names !== '') DB::table('clm_tnc_library')->where('id', $r->id)->update(['segment' => $names]);
            }
        }
        foreach (['customers', 'consignees'] as $table) {
            if (!$this->schemaHas($table, 'segment')) continue;
            if ($this->schemaHas($table, 'segment_ids')) {
                foreach (DB::table($table)->whereNull('deleted_at')->whereJsonContains('segment_ids', $segmentId)->get(['id', 'segment_ids']) as $r) {
                    $names = \App\Support\SegmentGuard::namesFor(json_decode((string) $r->segment_ids, true) ?: []);
                    DB::table($table)->where('id', $r->id)->update(['segment' => $names !== '' ? $names : null]);
                }
                continue;
            }
            $q = DB::table($table)
                ->where('client_id', $clientId)
                ->whereNull('deleted_at')
                ->whereNotNull('segment')
                ->where('segment', 'ilike', '%' . $old . '%');

            foreach ($q->get(['id', 'segment']) as $r) {
                $parts = array_map('trim', explode(',', (string) $r->segment));
                $changed = false;
                foreach ($parts as $i => $p) {
                    if ($p !== '' && strcasecmp($p, $old) === 0) {
                        $parts[$i] = $new;
                        $changed = true;
                    }
                }
                if ($changed) {
                    DB::table($table)->where('id', $r->id)
                        ->update(['segment' => implode(', ', array_filter($parts, fn($p) => $p !== ''))]);
                }
            }
        }
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmSegment::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'delete', 'clm.segment')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedIn = [];
        if (
            $this->schemaHas('clm_segment_rules')
            && DB::table('clm_segment_rules')->where('segment_id', $row->id)->exists()
        ) {
            $usedIn[] = 'Segment Rules';
        }
        if (
            $this->schemaHas('vendors')
            && $this->schemaHas('vendors', 'segment_id')
            && DB::table('vendors')->where('segment_id', $row->id)->exists()
        ) {
            $usedIn[] = 'Vendors';
        }
        if (
            $this->schemaHas('products')
            && $this->schemaHas('products', 'segment_id')
            && DB::table('products')->where('segment_id', $row->id)->exists()
        ) {
            $usedIn[] = 'Products';
        }
        foreach ([['customers', 'Customers'], ['consignees', 'Consignees']] as [$table, $label]) {
            if (
                $this->schemaHas($table, 'segment_ids')
                && DB::table($table)->whereNull('deleted_at')->whereJsonContains('segment_ids', (int) $row->id)->exists()
            ) {
                $usedIn[] = $label;
            }
        }
        if (
            $this->schemaHas('master_vendor_directory')
            && $this->schemaHas('master_vendor_directory', 'segment_id')
            && DB::table('master_vendor_directory')
            ->where(function ($q) use ($row) {
                $q->where('segment_id', (string) $row->id)
                    ->orWhere(function ($w) use ($row) {
                        $w->where('segment_id', $row->name);
                        $this->scopeToSegment($w, 'master_vendor_directory', $row);
                    });
            })
            ->exists()
        ) {
            $usedIn[] = 'Vendor Directory';
        }
        if ($this->schemaHas('clm_tnc_library', 'segment_ids')
            && DB::table('clm_tnc_library')->whereJsonContains('segment_ids', (int) $row->id)->exists()) {
            $usedIn[] = 'T&C Library';
        }

        $nameStringTables = [
            ['table' => 'clm_agreement_library',  'col' => 'segment', 'label' => 'Agreement Library'],
        ];
        $sharesNameWithSibling = ClmSegment::query()
            ->where('client_id', $row->client_id)
            ->whereKeyNot($row->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim((string) $row->name))])
            ->exists();

        if (!$sharesNameWithSibling) {
            foreach ($nameStringTables as $t) {
                if (!$this->schemaHas($t['table']) || !$this->schemaHas($t['table'], $t['col'])) continue;
                $q = DB::table($t['table'])->where($t['col'], $row->name);
                $this->scopeToSegment($q, $t['table'], $row);
                if ($q->exists()) $usedIn[] = $t['label'];
            }
        }

        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This segment is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $segQuery = ClmSegment::where('client_id', $clientId);
        $branchId === null ? $segQuery->whereNull('branch_id') : $segQuery->where('branch_id', $branchId);
        $codes = $segQuery->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^SG?-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('SG-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
