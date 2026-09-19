<?php

namespace App\Http\Controllers\Concerns;

use App\Models\ClmAuthority;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Bulk Excel import shared by the three authority-backed CLM document masters
 * (KYC / DD / Trade Licence). They differ only in the model, the code prefix
 * and the name of their validity column, so the logic lives here once.
 *
 * Every row is validated on its own: a bad row lands in `failed` with a reason
 * and never blocks the good ones. The AUTHORITY column carries authority
 * NAMES (comma-separated for several) because a name is what the person
 * exporting reads in the grid; each one is resolved to the id the column
 * actually stores, and an unknown name fails the row rather than silently
 * dropping the reference.
 */
trait ImportsClmDocMaster
{
    /**
     * @param  string  $modelClass   Eloquent model for the master
     * @param  string  $prefix       Code prefix, e.g. 'KYC'
     * @param  string  $validityCol  'expiry' or 'validity'
     * @param  string  $label        Human name used in the duplicate message
     */
    protected function importClmDocRows(
        Request $request,
        string $modelClass,
        string $prefix,
        string $validityCol,
        string $label
    ) {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);
        }

        $request->validate(['rows' => 'required|array|min:1|max:20000']);
        @set_time_limit(300);

        /* Authority NAME → id, for the whole tenant, read once. Resolving per
           row would be a query per row. */
        $authByName = [];
        foreach (ClmAuthority::where('client_id', $user->client_id)->get(['id', 'name']) as $a) {
            $authByName[mb_strtolower(trim((string) $a->name))] = (string) $a->id;
        }

        // Existing names in the caller's scope — the duplicate check.
        $existing = $modelClass::query();
        MasterVisibility::applyReadScope($existing, $user, $user->branch_id ?: null);
        // Unique on name + issuing-authority SET (order-insensitive), same rule
        // as the Add/Edit forms.
        $key = fn ($n, $a) => mb_strtolower(trim((string) $n)) . "\0" . ClmAuthority::canonicalIds($a);
        $seen = [];
        foreach ($existing->get(['name', 'authority']) as $e) $seen[$key($e->name, $e->authority)] = true;

        $imported = [];
        $failed   = [];
        $valid    = [];

        foreach (array_values($request->input('rows')) as $i => $r) {
            $r     = is_array($r) ? $r : [];
            $rowNo = (int) ($r['row'] ?? $i + 2);
            $name  = trim((string) ($r['name'] ?? ''));
            $auth  = trim((string) ($r['authority'] ?? ''));
            $valid_= trim((string) ($r['validity'] ?? ''));

            $fail = function (string $reason) use (&$failed, $rowNo, $name, $auth, $valid_) {
                $failed[] = ['row' => $rowNo, 'name' => $name, 'authority' => $auth, 'validity' => $valid_, 'reason' => $reason];
            };

            if ($name === '')               { $fail('Name is required'); continue; }
            if (mb_strlen($name) > 255)     { $fail('Name exceeds 255 characters'); continue; }
            if ($auth === '')               { $fail('Authority is required'); continue; }
            if (mb_strlen($valid_) > 32)    { $fail('Validity/Expiry exceeds 32 characters'); continue; }

            /* Authority column: names, ids, or a mix, comma-separated. Every
               token must resolve — a half-mapped row would look imported
               while quietly losing an authority. */
            $ids = [];
            $unknown = [];
            // Comma, semicolon or a line break (Alt+Enter in Excel) all separate.
            foreach (preg_split('/[,;\r\n]+/', $auth) as $tok) {
                $tok = trim($tok);
                if ($tok === '') continue;
                $id = ctype_digit($tok)
                    ? (in_array($tok, $authByName, true) ? $tok : null)
                    : ($authByName[mb_strtolower($tok)] ?? null);
                if ($id === null) $unknown[] = $tok; else $ids[$id] = true;
            }
            if ($unknown) { $fail('Unknown authority: ' . implode(', ', $unknown) . ' — use a name from the Authority Master'); continue; }
            if (!$ids)    { $fail('Authority is required'); continue; }

            $authIds = implode(', ', array_keys($ids));
            if (isset($seen[$key($name, $authIds)])) {
                $fail("A {$label} named \"{$name}\" with the same issuing authority already exists");
                continue;
            }

            $seen[$key($name, $authIds)] = true;
            $valid[] = [
                'row'       => $rowNo,
                'name'      => $name,
                'authority' => implode(', ', array_keys($ids)),
                'auth_text' => $auth,
                'validity'  => $valid_ !== '' ? $valid_ : 'N/A',
            ];
        }

        if ($valid) {
            try {
                /* Codes allocated ONCE under the same client row lock the
                   single-row nextCode() takes, then rows go in 500 at a time.
                   Allocating per row re-reads every code each time — O(n²),
                   which times out on a 10,000-row sheet. */
                DB::transaction(function () use ($user, $valid, $modelClass, $prefix, $validityCol, &$imported) {
                    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();

                    $q = $modelClass::where('client_id', $user->client_id);
                    $user->branch_id ? $q->where('branch_id', $user->branch_id) : $q->whereNull('branch_id');
                    $maxN = 0; $taken = [];
                    foreach ($q->pluck('code') as $c) {
                        if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', (string) $c, $m) && (int) $m[1] > $maxN) {
                            $maxN = (int) $m[1];
                        }
                        $taken[(string) $c] = true;
                    }

                    $now = now();
                    $n   = $maxN;
                    foreach (array_chunk($valid, 500) as $chunk) {
                        $insert = [];
                        foreach ($chunk as $v) {
                            do { $n++; $code = sprintf('%s-%03d', $prefix, $n); } while (isset($taken[$code]));
                            $insert[] = [
                                'client_id'   => $user->client_id,
                                'branch_id'   => $user->branch_id,
                                'code'        => $code,
                                'name'        => $v['name'],
                                'authority'   => $v['authority'],
                                $validityCol  => $v['validity'],
                                'status'      => $modelClass::STATUS_ACTIVE,
                                'created_by'  => $user->id,
                                'updated_by'  => $user->id,
                                'created_at'  => $now,
                                'updated_at'  => $now,
                            ];
                            $imported[] = [
                                'row'       => $v['row'],
                                'code'      => $code,
                                'name'      => $v['name'],
                                'authority' => $v['auth_text'],
                                'validity'  => $v['validity'],
                            ];
                        }
                        $modelClass::insert($insert);
                    }
                });
            } catch (\Throwable $e) {
                report($e);
                $imported = [];
                foreach ($valid as $v) {
                    $failed[] = [
                        'row'       => $v['row'],
                        'name'      => $v['name'],
                        'authority' => $v['auth_text'],
                        'validity'  => $v['validity'],
                        'reason'    => 'Could not save — import rolled back',
                    ];
                }
            }
        }

        return response()->json(['status' => true, 'imported' => $imported, 'failed' => $failed]);
    }
}
