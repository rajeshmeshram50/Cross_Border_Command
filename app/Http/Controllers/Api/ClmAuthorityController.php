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

        // Branch-scoped read: a branch admin sees its own rows + client-level
        // (shared) rows; sibling branches stay hidden (CBC-431). Client
        // admins/users see the whole client and may narrow via BranchSwitcher.
        $q = ClmAuthority::query()->orderBy('id', 'desc');   // newest entry first
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        /* SEARCH moves to SQL alongside the paging. Once the client holds one
           page, filtering there searches 10 rows out of 10,000 and reports
           "2 results" for a term that matches 300. */
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)
                  ->orWhere('code', 'ilike', $like)
                  ->orWhere('description', 'ilike', $like);
            });
        }

        /* PICKER MODE (?view=options) — id/code/name/status only.
           The KYC, DD, QC and Trade-License pages all pull this endpoint to
           fill an authority dropdown. They need every option, so they cannot
           page; but they do not need `description` (the bulk of the payload)
           and they never read `in_use`. Skipping both turns a 3.8 MB picker
           load into a few hundred KB and avoids the usage scans entirely. */
        if ($request->input('view') === 'options') {
            return response()->json([
                'status' => true,
                'data'   => $q->get(['id', 'code', 'name', 'status']),
            ]);
        }

        /* PAGINATION — opt-in via per_page, so every existing caller that wants
           the whole list is unchanged. */
        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = $perPage ? (clone $q)->count() : null;

        $rows = $perPage ? $q->forPage($page, $perPage)->get() : $q->get();

        // Flag each authority that's referenced elsewhere. The frontend uses
        // `in_use` to lock the DELETE action (deleting would orphan those
        // references). Editing stays allowed — CLM masters reference by id and
        // the legacy name-based tables are kept in sync by cascadeRename().
        if ($rows->isNotEmpty()) {
            /* Cached for a minute, because building these three sets costs 33
               queries — eight tables read in full, plus two Schema::hasTable /
               hasColumn lookups each, and every one of those interrogates
               information_schema across a 199-table schema. That is the bulk
               of this endpoint, it is identical for three rows and for ten
               thousand, and on a server where the database is a network hop
               away each query is a round trip.
               A minute of staleness is safe here: `in_use` only greys out the
               delete button, and destroy() runs its own live check before it
               deletes anything — so the worst case is a button enabled for up
               to 60s longer than it should be, and a 409 if it is pressed.
               Best-effort like the rest of the caching in this app: if the
               cache store is unavailable the closure simply runs. */
            $usage = $this->cachedUsageSets((int) $user->client_id);
            $usedIds   = $usage['ids'];
            $usedNames = $usage['names'];
            $usedCodes = $usage['codes'];
            $rows->each(function ($r) use ($usedIds, $usedNames, $usedCodes) {
                $r->in_use = isset($usedIds[(string) $r->id])
                    || isset($usedNames[mb_strtolower(trim((string) $r->name))])
                    || isset($usedCodes[(string) $r->code]);
            });
        }

        return response()->json([
            'status' => true,
            'data'   => $rows,
            // `count` stays the rows in hand (unchanged for existing callers);
            // `total` is the whole filtered set, which is what a pager needs.
            'count'  => $rows->count(),
            'total'  => $total ?? $rows->count(),
            /* The Add modal's code preview. It used to be derived in the
               browser from the full row set; with paging the browser only
               holds ONE page, so on page 5 it would preview a code that was
               taken long ago. Allocated here from the same branch-scoped walk
               store() uses, so the preview and the eventual insert agree. */
            'next_code' => $this->nextCodePreview((int) $user->client_id, $user->branch_id ?: null),
        ]);
    }

    /**
     * Same sequence walk as nextCode(), minus the row lock.
     *
     * nextCode() takes a lockForUpdate on the client row because it is
     * allocating a code that is about to be INSERTED under a unique index.
     * This one only feeds a preview, so taking that lock on every list request
     * would serialise reads behind unrelated writes for no benefit. The real
     * allocation still happens in store(), under the lock.
     */
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
        do { $n++; $code = sprintf('AUTH-%03d', $n); } while (isset($taken[$code]));
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

        // Reject duplicate authority names within the caller's branch scope
        // (case-insensitive). A sibling branch that can't see this row may
        // reuse the name — consistent with branch-isolated masters.
        $name = trim($data['name']);
        $dupe = ClmAuthority::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            throw ValidationException::withMessages([
                'name' => "An authority named \"{$name}\" already exists. Pick a different name.",
            ]);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            return ClmAuthority::create([
                'client_id'   => $user->client_id,
                'branch_id'   => $user->branch_id,   // branch-owned; null for client-level users → shared
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

        // Reject rename to a duplicate within the caller's branch scope
        // (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clash = ClmAuthority::query()->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
            MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
            $clash = $clash->exists();
            if ($clash) {
                throw ValidationException::withMessages([
                    'name' => "Another authority named \"{$data['name']}\" already exists. Pick a different name.",
                ]);
            }
        }

        $oldName = $row->name;
        $data['updated_by'] = $user->id;

        DB::transaction(function () use ($row, $data, $oldName) {
            $row->update($data);
            // Authority is referenced by NAME downstream, so a rename must be
            // mirrored everywhere it's used (KYC/DD/QC/Trade-Licence/vendor &
            // customer docs) — otherwise those rows keep the stale old name.
            if (array_key_exists('name', $data) && $data['name'] !== $oldName) {
                $this->cascadeRename((int) $row->client_id, $oldName, $data['name']);
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

        // Referenced by ID in the CLM document masters (kyc, dd, trade-license,
        // qc), by NAME in the legacy vendor/customer tables, and by CODE inside
        // the segment-rule `auths_json`. Shared with index()'s in_use flag.
        $usedIn = $this->authorityUsage((int) $user->client_id, (int) $row->id, $row->name, $row->code);

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

    /**
     * CLM document masters that reference an authority by ID (stored as a
     * comma-joined list — a document can map to several authorities). Renames
     * need no cascade here: the display name is resolved live from the id.
     */
    private function idUsageTables(): array
    {
        return [
            ['table' => 'clm_kyc_documents',  'col' => 'authority', 'label' => 'KYC Documents'],
            ['table' => 'clm_dd_documents',   'col' => 'authority', 'label' => 'Due Diligence Documents'],
            ['table' => 'clm_trade_licenses', 'col' => 'authority', 'label' => 'Trade Licenses'],
            ['table' => 'clm_qc_documents',   'col' => 'issued_by', 'label' => 'Quality & Compliance Docs'],
        ];
    }

    /**
     * Legacy tables that still reference an authority by NAME. These are kept in
     * sync on rename via cascadeRename().
     */
    private function nameUsageTables(): array
    {
        return [
            ['table' => 'vendor_documents',   'col' => 'issuing_authority', 'label' => 'Vendor Documents'],
            ['table' => 'customer_documents', 'col' => 'issuing_authority', 'label' => 'Customer Documents'],
            ['table' => 'vendor_owners',      'col' => 'issuing_authority', 'label' => 'Vendor Owners'],
        ];
    }

    /**
     * Human-readable list of places a single authority is referenced. Empty
     * array => safe to delete. Checks id-based CLM masters, name-based legacy
     * tables, and the code-based segment-rule JSON. Used by destroy().
     */
    private function authorityUsage(int $clientId, int $id, string $name, ?string $code): array
    {
        $usedIn = [];

        // id-based CLM masters — token-match the id within the comma-joined col.
        foreach ($this->idUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $q = DB::table($t['table'])->where($t['col'], 'like', '%' . $id . '%');
            if (Schema::hasColumn($t['table'], 'client_id')) $q->where('client_id', $clientId);
            $hit = $q->pluck($t['col'])->contains(fn ($v) => ClmAuthority::storedContainsId($v, $id));
            if ($hit) $usedIn[] = $t['label'];
        }

        // name-based legacy tables — exact name match (scoped where possible).
        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $q = DB::table($t['table'])->where($t['col'], $name);
            if (Schema::hasColumn($t['table'], 'client_id')) $q->where('client_id', $clientId);
            if ($q->exists()) $usedIn[] = $t['label'];
        }

        // Segment Rules stores the CODE inside a JSON array — substring match
        // keeps the check portable across MySQL / Postgres / SQLite.
        /* Same check the list uses for its `in_use` flag — deliberately the
           same method, because these two answered the same question in two
           ways and disagreed: the list said an authority was free while this
           refused to delete it.
           Also now scoped to the TENANT. The old `LIKE` ran across every
           client's rules, and an authority CODE is only unique per
           (client, branch) — so another branch's AUTH-003 could block this
           one's deletion. */
        if ($code && Schema::hasTable('clm_segment_rules') && Schema::hasColumn('clm_segment_rules', 'auths_json')) {
            $rules = DB::table('clm_segment_rules');
            if (Schema::hasColumn('clm_segment_rules', 'client_id')) {
                $rules->where('client_id', $clientId);
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

    /**
     * Propagate an authority rename to the legacy NAME-based tables, scoped to
     * the tenant. The CLM document masters store the id, so they need no update.
     */
    private function cascadeRename(int $clientId, string $oldName, string $newName): void
    {
        if ($oldName === $newName) return;

        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $q = DB::table($t['table'])->where($t['col'], $oldName);
            if (Schema::hasColumn($t['table'], 'client_id')) $q->where('client_id', $clientId);
            $q->update([$t['col'] => $newName]);
        }
    }

    /** Set of authority IDS referenced by the CLM document masters (for in_use). */
    /**
     * The three usage sets, cached together for 60 seconds.
     *
     * Cached as one entry rather than three so a partial hit is impossible —
     * the `in_use` flag is derived from all three, and mixing a fresh set with
     * two stale ones would be harder to reason about than a whole minute of
     * consistent staleness.
     *
     * Keyed by tenant. Not invalidated on write: the flag is advisory, the
     * delete path re-checks, and an explicit invalidation would have to fire
     * from four other controllers (KYC / DD / TL / QC) plus the segment-rule
     * screen — more coupling than a 60s window is worth.
     */
    private function cachedUsageSets(int $clientId): array
    {
        $build = fn () => [
            'ids'   => $this->usedIdSet($clientId),
            'names' => $this->usedNameSet($clientId),
            'codes' => $this->usedCodeSet($clientId),
        ];

        try {
            return \Illuminate\Support\Facades\Cache::remember(
                'clm:auth:usage:' . $clientId,
                now()->addSeconds(60),
                $build
            );
        } catch (\Throwable $e) {
            // A preview must never fail because the CACHE failed — same rule
            // the CTC preview cache follows.
            return $build();
        }
    }

    private function usedIdSet(?int $clientId): array
    {
        $used = [];
        foreach ($this->idUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $q = DB::table($t['table'])->whereNotNull($t['col']);
            if ($clientId && Schema::hasColumn($t['table'], 'client_id')) $q->where('client_id', $clientId);
            foreach ($q->pluck($t['col']) as $v) {
                foreach (explode(',', (string) $v) as $tok) {
                    $tok = trim($tok);
                    if ($tok !== '') $used[$tok] = true;
                }
            }
        }
        return $used;
    }

    /** Set of lowercased authority NAMES used by the legacy tables (for in_use). */
    private function usedNameSet(?int $clientId): array
    {
        $used = [];
        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $q = DB::table($t['table'])->whereNotNull($t['col'])->distinct();
            if ($clientId && Schema::hasColumn($t['table'], 'client_id')) $q->where('client_id', $clientId);
            foreach ($q->pluck($t['col']) as $v) {
                $p = mb_strtolower(trim((string) $v));
                if ($p !== '') $used[$p] = true;
            }
        }
        return $used;
    }

    /** Set of authority CODES referenced by segment rules (for index's in_use flag). */
    private function usedCodeSet(?int $clientId): array
    {
        $used = [];
        if (!Schema::hasTable('clm_segment_rules') || !Schema::hasColumn('clm_segment_rules', 'auths_json')) {
            return $used;
        }
        $q = DB::table('clm_segment_rules');
        if ($clientId && Schema::hasColumn('clm_segment_rules', 'client_id')) {
            $q->where('client_id', $clientId);
        }
        foreach ($q->pluck('auths_json') as $j) {
            foreach (self::codesInAuthsJson($j) as $c) $used[$c] = true;
        }
        return $used;
    }

    /**
     * Every authority CODE referenced inside a segment rule's `auths_json`.
     *
     * Walks the structure instead of assuming a flat list. The previous version
     * did `foreach ($arr as $c) $used[(string) $c] = true;`, which is only
     * correct while the column holds `["AUTH-002","AUTH-012"]`. Give it a
     * nested shape and every `$c` is an array, `(string) $c` becomes the
     * literal "Array", and NOT ONE real code is collected — so the list
     * reported `in_use: false` for authorities that were genuinely referenced,
     * and the delete then refused with "in use by Segment Rules".
     *
     * That is the bug this fixes, and it is also why both the list flag and
     * the delete guard now call THIS method: two checks answering the same
     * question in two different ways is how they came to disagree.
     */
    private static function codesInAuthsJson($json): array
    {
        $arr = is_array($json) ? $json : (json_decode((string) $json, true) ?: []);
        if (!is_array($arr)) return [];

        $out = [];
        array_walk_recursive($arr, function ($v, $k) use (&$out) {
            // Codes appear as values in a flat list (["AUTH-002", ...]) and as
            // KEYS in a map shape ({"AUTH-002": "M", ...}), so collect both and
            // keep only what looks like a code.
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
        // Walk past max + any taken codes — count(+1) breaks when the
        // sequence has gaps (e.g. after deletes). Branch-scoped so each
        // branch restarts from AUTH-001 rather than continuing another
        // branch's tally (the authority master is branch-isolated via
        // MasterVisibility); a client-level creator ($branchId null)
        // sequences the shared rows.
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
