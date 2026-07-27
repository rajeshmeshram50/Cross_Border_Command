<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmSegment;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class ClmSegmentController extends Controller
{
   
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-430).
        // Newest segments first so a freshly-added entry appears at the top.
        $q = ClmSegment::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
        $rows = $q->get();

        // Per-segment "in use" flags so the UI can disable + explain the delete
        // action for referenced segments. Computed with ONE query per
        // referencing table (not per row) so the list stays fast. Mirrors the
        // same reference checks performed in destroy().
        $usage = $this->usageLabels($rows);
        $rows->each(function ($r) use ($usage) {
            $labels = $usage[$r->id] ?? [];
            $r->in_use  = !empty($labels);
            $r->used_in = array_values($labels);
        });
 
        return response()->json([
            'status' => true,
            'data'   => $rows,
            'counts' => [
                'all'    => $rows->count(),
                'highly' => $rows->where('regulatory_status', ClmSegment::REG_HIGHLY)->count(),
                'less'   => $rows->where('regulatory_status', ClmSegment::REG_LESS)->count(),
            ],
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
        $idByName = [];
        foreach ($rows as $r) { $idByName[$r->name] = $r->id; }

        $map = [];
        $addById = function ($segId, $label) use (&$map, $ids) {
            $segId = (int) $segId;
            if (!in_array($segId, $ids, true)) return;
            if (!isset($map[$segId])) $map[$segId] = [];
            if (!in_array($label, $map[$segId], true)) $map[$segId][] = $label;
        };
        $addByName = function ($name, $label) use (&$map, $idByName) {
            if (!isset($idByName[$name])) return;
            $segId = $idByName[$name];
            if (!isset($map[$segId])) $map[$segId] = [];
            if (!in_array($label, $map[$segId], true)) $map[$segId][] = $label;
        };

        // ── id-based reference tables ──
        if (Schema::hasTable('clm_segment_rules')) {
            foreach (DB::table('clm_segment_rules')->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                $addById($sid, 'Segment Rules');
            }
        }
        foreach ([['vendors', 'Vendors'], ['products', 'Products'], ['customers', 'Customers']] as [$table, $label]) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'segment_id')) {
                foreach (DB::table($table)->whereIn('segment_id', $ids)->distinct()->pluck('segment_id') as $sid) {
                    $addById($sid, $label);
                }
            }
        }
        // master_vendor_directory stores segment as a string id OR the name.
        if (Schema::hasTable('master_vendor_directory') && Schema::hasColumn('master_vendor_directory', 'segment_id')) {
            $strIds = array_map('strval', $ids);
            $vals = DB::table('master_vendor_directory')
                ->where(function ($q) use ($strIds, $names) {
                    $q->whereIn('segment_id', $strIds)->orWhereIn('segment_id', $names);
                })->distinct()->pluck('segment_id');
            foreach ($vals as $v) {
                if (in_array((string) $v, $strIds, true)) $addById((int) $v, 'Vendor Directory');
                else $addByName($v, 'Vendor Directory');
            }
        }

        // ── name-based reference tables (store the segment NAME) ──
        foreach ([
            ['customers', 'segment', 'Customers'],
            ['consignees', 'segment', 'Consignees'],
            ['clm_tnc_library', 'segment', 'T&C Library'],
            ['clm_agreement_library', 'segment', 'Agreement Library'],
        ] as [$table, $col, $label]) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, $col)) {
                foreach (DB::table($table)->whereIn($col, $names)->distinct()->pluck($col) as $nm) {
                    $addByName($nm, $label);
                }
            }
        }

        return $map;
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
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
        if (isset($data['regulatory_status'])
            && $data['regulatory_status'] !== $row->regulatory_status
            && !empty($usedIn)) {
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
            if (!\Illuminate\Support\Facades\Schema::hasColumn($table, 'segment')) continue;
            $q = DB::table($table)
                ->where('client_id', $clientId)
                ->whereNull('deleted_at')
                ->whereNotNull('segment')
                ->where('segment', 'ilike', '%' . $old . '%');

            foreach ($q->get(['id', 'segment']) as $r) {
                $parts = array_map('trim', explode(',', (string) $r->segment));
                $changed = false;
                foreach ($parts as $i => $p) {
                    if ($p !== '' && strcasecmp($p, $old) === 0) { $parts[$i] = $new; $changed = true; }
                }
                if ($changed) {
                    DB::table($table)->where('id', $r->id)
                        ->update(['segment' => implode(', ', array_filter($parts, fn ($p) => $p !== ''))]);
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        // Block delete if this segment is referenced anywhere else in the
        // project. Each check is guarded by Schema::hasTable so the endpoint
        // doesn't crash in environments that haven't run a particular
        // migration yet (e.g. staging without consolidate-segments).
        $usedIn = [];
        if (Schema::hasTable('clm_segment_rules')
            && DB::table('clm_segment_rules')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if (Schema::hasTable('vendors')
            && Schema::hasColumn('vendors', 'segment_id')
            && DB::table('vendors')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Vendors';
        }
        if (Schema::hasTable('products')
            && Schema::hasColumn('products', 'segment_id')
            && DB::table('products')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Products';
        }
        if (Schema::hasTable('customers')
            && Schema::hasColumn('customers', 'segment_id')
            && DB::table('customers')->where('segment_id', $row->id)->exists()) {
            $usedIn[] = 'Customers';
        }
        // Some legacy tables store segment as a string (name or id-as-string).
        if (Schema::hasTable('master_vendor_directory')
            && Schema::hasColumn('master_vendor_directory', 'segment_id')
            && DB::table('master_vendor_directory')
                ->where(function ($q) use ($row) {
                    $q->where('segment_id', (string) $row->id)
                      ->orWhere('segment_id', $row->name);
                })
                ->exists()) {
            $usedIn[] = 'Vendor Directory';
        }

        // String-typed `segment` columns — these store the segment NAME
        // (case-sensitive match — the segment name itself is the canonical
        // string key these tables capture).
        $nameStringTables = [
            ['table' => 'customers',              'col' => 'segment', 'label' => 'Customers'],
            ['table' => 'consignees',             'col' => 'segment', 'label' => 'Consignees'],
            ['table' => 'clm_tnc_library',        'col' => 'segment', 'label' => 'T&C Library'],
            ['table' => 'clm_agreement_library',  'col' => 'segment', 'label' => 'Agreement Library'],
        ];
        foreach ($nameStringTables as $t) {
            if (Schema::hasTable($t['table'])
                && Schema::hasColumn($t['table'], $t['col'])
                && DB::table($t['table'])->where($t['col'], $row->name)->exists()) {
                $usedIn[] = $t['label'];
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
