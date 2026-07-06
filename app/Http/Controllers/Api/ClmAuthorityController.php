<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
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
        $q = ClmAuthority::query()->orderBy('id');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
        $rows = $q->get();

        // Flag each authority that's referenced elsewhere. The frontend uses
        // `in_use` to lock the DELETE action (deleting would orphan those
        // references). Editing stays allowed — CLM masters reference by id and
        // the legacy name-based tables are kept in sync by cascadeRename().
        if ($rows->isNotEmpty()) {
            $usedIds   = $this->usedIdSet($user->client_id);
            $usedNames = $this->usedNameSet($user->client_id);
            $usedCodes = $this->usedCodeSet($user->client_id);
            $rows->each(function ($r) use ($usedIds, $usedNames, $usedCodes) {
                $r->in_use = isset($usedIds[(string) $r->id])
                    || isset($usedNames[mb_strtolower(trim((string) $r->name))])
                    || isset($usedCodes[(string) $r->code]);
            });
        }

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
        ]);
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
                'code'        => $this->nextCode($user->client_id),
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
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
        if (Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'auths_json')
            && $code
            && DB::table('clm_segment_rules')->where('auths_json', 'like', '%"' . $code . '"%')->exists()) {
            $usedIn[] = 'Segment Rules';
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
            $arr = is_array($j) ? $j : (json_decode((string) $j, true) ?: []);
            if (is_array($arr)) {
                foreach ($arr as $c) $used[(string) $c] = true;
            }
        }
        return $used;
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Walk past max + any taken codes — count(+1) breaks when the
        // sequence has gaps (e.g. after deletes).
        $codes = ClmAuthority::where('client_id', $clientId)->pluck('code')->all();
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
