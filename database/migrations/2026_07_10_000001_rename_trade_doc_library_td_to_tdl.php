<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rename Trade Document Library codes from the legacy "TD-NNN" prefix to
 * "TDL-NNN" so the saved code matches the create-popup preview and the
 * Library list (CBC-35 / CBC-36). The controller's allocator now emits TDL-;
 * renaming existing rows keeps that per-branch sequence continuous instead of
 * restarting at TDL-001 alongside stray TD- rows.
 *
 * The `code` is a display identifier only (used in filenames / document-name
 * labels) — nothing foreign-keys on the string — so renaming is safe.
 * Idempotent: only rows matching exactly /^TD-\d+$/ are touched, and each is
 * skipped if its TDL- target already exists in the same (client, branch).
 */
return new class extends Migration {
    public function up(): void
    {
        // Bypass Eloquent (and any soft-delete scope) so trashed rows are
        // renamed too — leaving a trashed TD- behind would collide if the
        // sequence later reaches the same number.
        $rows = DB::table('clm_trade_doc_library')->where('code', 'like', 'TD-%')->get(['id', 'code', 'client_id', 'branch_id']);
        foreach ($rows as $r) {
            if (!preg_match('/^TD-(\d+)$/', (string) $r->code, $m)) continue; // skip anything that isn't TD-<digits>
            $newCode = 'TDL-' . $m[1];

            $clash = DB::table('clm_trade_doc_library')
                ->where('client_id', $r->client_id)
                ->where('code', $newCode);
            $r->branch_id === null ? $clash->whereNull('branch_id') : $clash->where('branch_id', $r->branch_id);
            if ($clash->exists()) continue; // target already taken — leave as-is

            DB::table('clm_trade_doc_library')->where('id', $r->id)->update(['code' => $newCode]);
        }
    }

    public function down(): void
    {
        // Reverse: TDL-NNN → TD-NNN (same collision guard).
        $rows = DB::table('clm_trade_doc_library')->where('code', 'like', 'TDL-%')->get(['id', 'code', 'client_id', 'branch_id']);
        foreach ($rows as $r) {
            if (!preg_match('/^TDL-(\d+)$/', (string) $r->code, $m)) continue;
            $newCode = 'TD-' . $m[1];

            $clash = DB::table('clm_trade_doc_library')
                ->where('client_id', $r->client_id)
                ->where('code', $newCode);
            $r->branch_id === null ? $clash->whereNull('branch_id') : $clash->where('branch_id', $r->branch_id);
            if ($clash->exists()) continue;

            DB::table('clm_trade_doc_library')->where('id', $r->id)->update(['code' => $newCode]);
        }
    }
};
