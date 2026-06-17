<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
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

        $rows = $user->client_id
            ? ClmAuthority::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        // Flag each authority that's referenced elsewhere (documents, trade
        // licences, segment rules, …). The frontend uses `in_use` to lock the
        // edit / delete actions so a referenced authority can't be renamed or
        // removed — which would orphan those references (they store the NAME).
        if ($rows->isNotEmpty()) {
            $usedNames = $this->usedNameSet();
            $usedCodes = $this->usedCodeSet($user->client_id);
            $rows->each(function ($r) use ($usedNames, $usedCodes) {
                $r->in_use = isset($usedNames[mb_strtolower(trim((string) $r->name))])
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

        // Reject duplicate authority names per client (case-insensitive).
        $name = trim($data['name']);
        $exists = ClmAuthority::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($exists) {
            throw ValidationException::withMessages([
                'name' => "An authority named \"{$name}\" already exists. Pick a different name.",
            ]);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            return ClmAuthority::create([
                'client_id'   => $user->client_id,
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
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);

        // Reject rename to a duplicate (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clash = ClmAuthority::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists();
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
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);

        // Authority is referenced by NAME across downstream document tables
        // (kyc, dd, trade-license, qc, vendor/customer docs), and by CODE inside
        // the JSON `auths_json` column on segment rules. Shared with update()'s
        // edit guard and index()'s in_use flag.
        $usedIn = $this->authorityUsage($row->name, $row->code);

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
     * Downstream tables that reference an authority by NAME. `split => true`
     * marks columns that may store a comma-joined list (e.g. a trade licence's
     * multiple issuing authorities) so each token is checked individually.
     */
    private function nameUsageTables(): array
    {
        return [
            ['table' => 'clm_kyc_documents',  'col' => 'authority',         'label' => 'KYC Documents'],
            ['table' => 'clm_dd_documents',   'col' => 'authority',         'label' => 'Due Diligence Documents'],
            ['table' => 'clm_trade_licenses', 'col' => 'authority',         'label' => 'Trade Licenses', 'split' => true],
            ['table' => 'clm_qc_documents',   'col' => 'issued_by',         'label' => 'Quality & Compliance Docs'],
            ['table' => 'vendor_documents',   'col' => 'issuing_authority', 'label' => 'Vendor Documents'],
            ['table' => 'customer_documents', 'col' => 'issuing_authority', 'label' => 'Customer Documents'],
            ['table' => 'vendor_owners',      'col' => 'issuing_authority', 'label' => 'Vendor Owners'],
        ];
    }

    /**
     * Returns the list of human-readable places a single authority is used.
     * Empty array => safe to edit / delete. Used by update(), destroy().
     */
    private function authorityUsage(string $name, ?string $code): array
    {
        $usedIn = [];
        $needle = mb_strtolower(trim($name));

        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;

            if (!empty($t['split'])) {
                // Column may hold a comma-joined list. A loose LIKE narrows the
                // candidates, then we confirm an exact token match so "FSSAI"
                // doesn't falsely match "FSSAIs".
                $hit = DB::table($t['table'])
                    ->where($t['col'], 'like', '%' . $name . '%')
                    ->pluck($t['col'])
                    ->contains(function ($v) use ($needle) {
                        foreach (explode(',', (string) $v) as $piece) {
                            if (mb_strtolower(trim($piece)) === $needle) return true;
                        }
                        return false;
                    });
                if ($hit) $usedIn[] = $t['label'];
            } elseif (DB::table($t['table'])->where($t['col'], $name)->exists()) {
                $usedIn[] = $t['label'];
            }
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
     * Propagate an authority rename to every downstream table that stores the
     * name, scoped to the same client. Exact-name columns get a single bulk
     * UPDATE; comma-joined columns (trade-licence authorities) are token-
     * replaced per row so only the matching token changes ("FSSAI, DGFT" →
     * "FSSAI India, DGFT", without touching "FSSAIs").
     */
    private function cascadeRename(int $clientId, string $oldName, string $newName): void
    {
        if ($oldName === $newName) return;
        $needle = mb_strtolower($oldName);

        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $hasClient = Schema::hasColumn($t['table'], 'client_id');

            if (!empty($t['split'])) {
                $q = DB::table($t['table'])->where($t['col'], 'like', '%' . $oldName . '%');
                if ($hasClient) $q->where('client_id', $clientId);
                foreach ($q->get() as $r) {
                    $tokens  = array_map('trim', explode(',', (string) $r->{$t['col']}));
                    $changed = false;
                    foreach ($tokens as &$tok) {
                        if (mb_strtolower($tok) === $needle) { $tok = $newName; $changed = true; }
                    }
                    unset($tok);
                    if ($changed) {
                        DB::table($t['table'])->where('id', $r->id)->update([$t['col'] => implode(', ', $tokens)]);
                    }
                }
            } else {
                $q = DB::table($t['table'])->where($t['col'], $oldName);
                if ($hasClient) $q->where('client_id', $clientId);
                $q->update([$t['col'] => $newName]);
            }
        }
    }

    /** Set of lowercased authority NAMES used anywhere downstream (for index's in_use flag). */
    private function usedNameSet(): array
    {
        $used = [];
        foreach ($this->nameUsageTables() as $t) {
            if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'], $t['col'])) continue;
            $vals = DB::table($t['table'])->whereNotNull($t['col'])->distinct()->pluck($t['col']);
            foreach ($vals as $v) {
                $pieces = !empty($t['split']) ? explode(',', (string) $v) : [(string) $v];
                foreach ($pieces as $piece) {
                    $p = mb_strtolower(trim($piece));
                    if ($p !== '') $used[$p] = true;
                }
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
