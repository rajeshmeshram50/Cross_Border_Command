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
    /** @var array<string, array<string, int>> table => flipped column list, per request */
    private array $columnCache = [];

    // Memoized hasTable/hasColumn — one schema query per table instead of one per check.
    private function schemaHas(string $table, ?string $column = null): bool
    {
        $cols = $this->columnCache[$table] ??= array_flip(Schema::getColumnListing($table));
        return $column === null ? $cols !== [] : isset($cols[$column]);
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-430).
        // Newest segments first so a freshly-added entry appears at the top.
        $q = ClmSegment::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        // Tab counts cover the whole scoped set, independent of tab/filter/search.
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

        // Paged only when per_page is sent; dropdown consumers still get every row.
        $perPage = $request->filled('per_page') ? min(200, max(1, (int) $request->input('per_page'))) : null;
        $total   = $perPage ? (clone $q)->count() : null;
        $rows    = $perPage ? $q->forPage(max(1, (int) $request->input('page', 1)), $perPage)->get() : $q->get();

        // Usage scan runs on the current page only — it is the expensive part.
        $usage = $this->usageLabels($rows);
        $rows->each(function ($r) use ($usage) {
            $labels = $usage[$r->id] ?? [];
            $r->in_use  = !empty($labels);
            $r->used_in = array_values($labels);
        });

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
            'counts' => $counts,
        ]);
    }

    /**
     * Build a [segment_id => [labels...]] map of where each segment is
     * referenced across the project. Batched (one query per referencing
     * table) so the index endpoint doesn't run N×tables queries. The label
     * set mirrors the checks in destroy() so the UI's disabled state and the
     * server's 409 stay in sync.
     */
    private function usageLabels($rows): array
    {
        if ($rows->isEmpty()) return [];
        $ids    = $rows->pluck('id')->all();
        $names  = $rows->pluck('name')->all();
        // name => [segment rows]. A LIST, not one id: two branches under the
        // same client may each own a segment called "Rice", and a
        // name => single-id map silently dropped whichever came second, so
        // that segment could never be flagged at all.
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

        $addByName = function ($name, $refClientId, $refBranchId, $label, $scoped = true) use (&$map, $segsByName) {
            foreach ($segsByName[$name] ?? [] as $seg) {
                if ($scoped && !self::referenceMayPointAt($seg, $refClientId, $refBranchId)) continue;
                $segId = (int) $seg->id;
                if (!isset($map[$segId])) $map[$segId] = [];
                if (!in_array($label, $map[$segId], true)) $map[$segId][] = $label;
            }
        };

        // ── id-based reference tables ──
        if ($this->schemaHas('clm_segment_rules')) {
            foreach (DB::table('clm_segment_rules')->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                $addById($sid, 'Segment Rules');
            }
        }
        foreach ([['vendors', 'Vendors'], ['products', 'Products'], ['customers', 'Customers']] as [$table, $label]) {
            if ($this->schemaHas($table) && $this->schemaHas($table, 'segment_id')) {
                foreach (DB::table($table)->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                    $addById($sid, $label);
                }
            }
        }
        // master_vendor_directory stores segment as a string id OR the name.
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

        // ── name-based reference tables (store the segment NAME) ──
        // Each row is read with its own client_id / branch_id stamp so the
        // match can be confined to segments that row could actually have been
        // pointing at (see referenceMayPointAt).
        foreach (
            [
                ['customers', 'segment', 'Customers'],
                ['consignees', 'segment', 'Consignees'],
                ['clm_tnc_library', 'segment', 'T&C Library'],
                ['clm_agreement_library', 'segment', 'Agreement Library'],
            ] as [$table, $col, $label]
        ) {
            if ($this->schemaHas($table) && $this->schemaHas($table, $col)) {
                [$refCols, $refScoped] = $this->referenceStampColumns($table);
                $refs = DB::table($table)->whereIn($col, $names)
                    ->select(array_merge([$col], $refCols))->distinct()->get();
                foreach ($refs as $ref) {
                    $addByName($ref->$col, $ref->client_id ?? null, $ref->branch_id ?? null, $label, $refScoped);
                }
            }
        }

        return $map;
    }

    /**
     * Which tenant-stamp columns a reference table actually carries, plus
     * whether it carries enough of them to be scoped at all. A table with no
     * client_id cannot be placed in a tenant, so it stays unscoped (old
     * behaviour) rather than having every match silently discarded.
     *
     * @return array{0: string[], 1: bool}
     */
    private function referenceStampColumns(string $table): array
    {
        $cols = [];
        $hasClient = $this->schemaHas($table, 'client_id');
        if ($hasClient) $cols[] = 'client_id';
        if ($this->schemaHas($table, 'branch_id')) $cols[] = 'branch_id';
        return [$cols, $hasClient];
    }

    /**
     * Could a record stamped ($refClientId, $refBranchId) be referring to this
     * segment by name? Answers "who can see this segment", because a record can
     * only name a segment its author could pick:
     *
     *   - global segment (client_id NULL)      → anyone
     *   - client-level segment (branch_id NULL) → any branch of that client
     *   - branch segment                        → that branch, plus the
     *       client-level users (branch_id NULL) who see every branch
     *
     * A sibling branch is NOT in that set — branches are isolated peers
     * (MasterVisibility) — which is the whole point: its records must not make
     * this branch's identically-named segment look "in use".
     */
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

    /**
     * Query-builder form of referenceMayPointAt(), for the one-row-at-a-time
     * checks in destroy(). Applies nothing when the table has no client_id —
     * same fallback as referenceStampColumns().
     */
    private function scopeToSegment($q, string $table, $seg): void
    {
        if (!$this->schemaHas($table, 'client_id') || $seg->client_id === null) return;
        $q->where('client_id', $seg->client_id);

        if (!$this->schemaHas($table, 'branch_id') || $seg->branch_id === null) return;
        $q->where(function ($w) use ($seg) {
            $w->where('branch_id', $seg->branch_id)->orWhereNull('branch_id');
        });
    }

    /**
     * POST /clm/segments
     */
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

        // Reject duplicate segment name within the caller's branch scope
        // (case-insensitive). Sibling branches may reuse the name.
        $name = trim($data['name']);
        $dupe = ClmSegment::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            $msg = "A segment named \"{$name}\" already exists. Pick a different name.";
            // 422 + errors.name so the modal shows it inline under the name field
            // (not a global toast) — same shape Laravel's `unique` rule returns.
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 422);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmSegment::create([
                'client_id'         => $user->client_id,
                'branch_id'         => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'              => $this->nextCode($user->client_id, $user->branch_id),
                'name'              => trim($data['name']),
                'regulatory_status' => $data['regulatory_status'],
                'buyer_consignee'   => $data['buyer_consignee'],
                'status'            => $data['status'] ?? ClmSegment::STATUS_ACTIVE,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        });

        // Segments feed the cached Vendor / Customer / Product form bundles —
        // without this they keep serving the old list until the 5-min TTL lapses.
        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    /**
     * PUT /clm/segments/{id}
     *
     * The `code` is immutable — once allocated, downstream references
     * (rules in the Document Control Panel etc.) should keep resolving
     * stably. Name + regulatory_status + buyer_consignee + status can
     * all be edited.
     */
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

        // Both the NAME and REGULATORY-STATUS locks apply ONLY when the segment
        // is actually referenced somewhere. A brand-new / unused segment stays
        // fully editable. Compute usage once (same map the index uses) so the
        // locked fields and these guards stay in sync; enforced server-side
        // because the read-only inputs can be bypassed.
        $usedIn = $this->usageLabels(collect([$row]))[$row->id] ?? [];

        // Segment NAME is frozen once referenced (Customers / Consignees /
        // Suppliers / Products / rules / libraries) — renaming would break every
        // record that stores the segment by name. Only a genuine rename is
        // blocked (same value re-submitted is fine), so Customer ≠ Consignee
        // edits still go through.
        if (isset($data['name']) && $data['name'] !== (string) $row->name && !empty($usedIn)) {
            $msg = 'This segment is in use by ' . implode(', ', $usedIn) . " — its name can't be changed.";
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 409);
        }

        // Regulatory classification is frozen once the segment is referenced,
        // since compliance structures (DCP rules, required docs) get built
        // against it. An unused segment can still be re-classified.
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

        // Reject rename to a duplicate within the caller's branch scope
        // (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clashQ = ClmSegment::query()->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
            MasterVisibility::applyReadScope($clashQ, $user, $user->branch_id ?: null);
            $clash = $clashQ->exists();
            if ($clash) {
                $msg = "Another segment named \"{$data['name']}\" already exists. Pick a different name.";
                return response()->json([
                    'status'  => false,
                    'message' => $msg,
                    'errors'  => ['name' => [$msg]],
                ], 422);
            }
        }

        // Capture the old name BEFORE the update so we can cascade a rename.
        $oldName = (string) $row->name;

        $data['updated_by'] = $user->id;
        $row->update($data);

        /* Cascade a rename onto the denormalised segment NAME stored on customer
         * / consignee rows (customers.segment / consignees.segment are
         * comma-joined names, not ids). Without this the master shows the new
         * name but the party grids keep the old one until each row is re-saved
         * (QA #38). Scoped to the segment's own client + branch so a rename in
         * one branch never rewrites another branch's identically-named segment. */
        if (isset($data['name']) && $oldName !== '' && strcasecmp($oldName, (string) $row->name) !== 0) {
            $this->cascadeSegmentRename($row->client_id, $oldName, (string) $row->name);
        }

        // A renamed / deactivated segment must reach the form dropdowns now.
        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * Rewrite a renamed segment's NAME inside the comma-joined `segment`
     * strings on customers + consignees. Replaces only WHOLE entries (an exact,
     * case-insensitive match of a comma-separated part) so "Rice" never
     * partially matches "Rice Bran". Scoped to the CLIENT (not branch): parties
     * reference segments by name and a customer in one branch may reference a
     * segment owned by another, so branch-scoping would miss them; names are
     * effectively client-unique.
     */
    private function cascadeSegmentRename($clientId, string $old, string $new): void
    {
        foreach (['customers', 'consignees'] as $table) {
            if (!$this->schemaHas($table, 'segment')) continue;
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

    /**
     * DELETE /clm/segments/{id} — hard delete.
     */
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

        // Block delete if this segment is referenced anywhere else in the
        // project. Each check is guarded by Schema::hasTable so the endpoint
        // doesn't crash in environments that haven't run a particular
        // migration yet (e.g. staging without consolidate-segments).
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
        if (
            $this->schemaHas('customers')
            && $this->schemaHas('customers', 'segment_id')
            && DB::table('customers')->where('segment_id', $row->id)->exists()
        ) {
            $usedIn[] = 'Customers';
        }
        // Some legacy tables store segment as a string (name or id-as-string).
        // The id arm is exact, so it stays unscoped; the name arm is ambiguous
        // across tenants and gets the same scoping as the tables below.
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

        // String-typed `segment` columns — these store the segment NAME
        // (case-sensitive match — the segment name itself is the canonical
        // string key these tables capture).
        //
        // Confined to this segment's own tenant scope. A name is unique only
        // within a scope, so an unscoped match let a sibling branch's records
        // — or another client's entirely — hold this segment hostage: the
        // delete was refused, and update() reuses the same map, so the name and
        // regulatory status were locked on a segment nobody had used yet.
        $nameStringTables = [
            ['table' => 'customers',              'col' => 'segment', 'label' => 'Customers'],
            ['table' => 'consignees',             'col' => 'segment', 'label' => 'Consignees'],
            ['table' => 'clm_tnc_library',        'col' => 'segment', 'label' => 'T&C Library'],
            ['table' => 'clm_agreement_library',  'col' => 'segment', 'label' => 'Agreement Library'],
        ];
        /* A name shared with a sibling segment makes these checks meaningless.
         *
         * These tables record the segment NAME, so when two segments in one
         * tenant carry the same name a match cannot say WHICH of them a record
         * meant — and the check blamed both. Branch 2 creating a segment that
         * branch 1 already has by name could therefore never delete it, even
         * brand new with no rule attached and nothing pointing at it.
         * scopeToSegment() handles this when the segment belongs to a branch,
         * but a client-level segment has no branch_id to scope by, so it fell
         * through to a tenant-wide name match.
         *
         * Skipping the name checks is safe precisely BECAUSE the reference is
         * by name: the sibling keeps that name, so every record still resolves
         * to a live segment afterwards and nothing is orphaned. The id-based
         * checks above (rules, vendors, products, customers.segment_id) are
         * exact and still apply — they are what actually protects a segment
         * that is genuinely in use. */
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

        // Drop the deleted segment from the cached form bundles immediately —
        // otherwise it keeps appearing (and stays selectable) in the Supplier /
        // Customer / Product dropdowns until the TTL lapses.
        MasterBundleCache::bump();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * Allocate the next per-tenant code. Row-locks the parent client row
     * so two concurrent inserts can't pick the same number (Postgres
     * rejects FOR UPDATE on aggregates so we can't lock count(*) itself).
     * The composite UNIQUE on (client_id, code) is the second guard.
     *
     * Uses MAX(numeric suffix) + 1 rather than count() so deleted rows in
     * the middle of the sequence don't cause the next allocation to clash
     * with an existing code.
     */
    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Don't rely on count(+1) — the sequence can have gaps (e.g. after
        // the consolidate-segments migration merged rows from the legacy
        // master_segments table, or when a user has deleted+re-added).
        // Pull the actual max S-NNN and increment past it; skip any
        // collisions just to be doubly safe.
        // Branch-scoped so each branch restarts from SG-001 rather than
        // continuing another branch's tally — the segment master is branch-
        // isolated via MasterVisibility. A client-level creator ($branchId
        // null) sequences the shared rows.
        $segQuery = ClmSegment::where('client_id', $clientId);
        $branchId === null ? $segQuery->whereNull('branch_id') : $segQuery->where('branch_id', $branchId);
        $codes = $segQuery->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        foreach ($codes as $c) {
            // Match both the new SG-NNN and any legacy S-NNN still around
            // (during/after the prefix migration) so the sequence never reuses
            // a number.
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
