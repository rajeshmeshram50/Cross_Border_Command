<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One-off cleanup for duplicate employee rows produced by the
 * persistCurrentStep stale-state bug. Each Next click in the 4-step
 * Add Employee wizard was POSTing a fresh row because `editingDbId`
 * hadn't propagated from the prior step — so a single hire ended up
 * as 2-5 rows that confused the Active / Disabled tabs (some rows
 * status=Active, others status=Inactive).
 *
 * The runtime fix (editingDbIdRef in the frontend) prevents new
 * duplicates from being created. This migration deletes the rows
 * already in the table.
 *
 * Strategy:
 *  Group by (client_id, user_id) — the user row was reused across
 *  all wizard steps for the same hire (email is globally unique on
 *  users.email), so user_id is the canonical "this is one human"
 *  signature. Keep the row with the highest wizard_step_completed
 *  (most data filled in), break ties on most-recent updated_at,
 *  soft-delete the rest so nothing is permanently lost.
 */
return new class extends Migration {
    public function up(): void
    {
        // Find groups of duplicate rows sharing the same user_id.
        // Rows with no user_id (orphans, very rare) are skipped — there's
        // no reliable signature to dedupe them by without risking false
        // positives.
        $groups = DB::table('employees')
            ->select('client_id', 'user_id', DB::raw('COUNT(*) as dup_count'))
            ->whereNotNull('user_id')
            ->whereNull('deleted_at')
            ->groupBy('client_id', 'user_id')
            ->having(DB::raw('COUNT(*)'), '>', 1)
            ->get();

        $now = now();
        $softDeleted = 0;

        foreach ($groups as $g) {
            $rows = DB::table('employees')
                ->where('client_id', $g->client_id)
                ->where('user_id', $g->user_id)
                ->whereNull('deleted_at')
                ->orderByDesc('wizard_step_completed')
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->get(['id']);

            // First row is the winner — every subsequent row is a
            // duplicate and gets soft-deleted.
            $rows->slice(1)->each(function ($row) use ($now, &$softDeleted) {
                DB::table('employees')->where('id', $row->id)->update([
                    'deleted_at' => $now,
                    'updated_at' => $now,
                ]);
                $softDeleted++;
            });
        }

        if ($softDeleted > 0) {
            // Use the framework's logger so the cleanup leaves an audit
            // trail in storage/logs/laravel.log for ops to verify.
            \Illuminate\Support\Facades\Log::info(
                "[cleanup_duplicate_employees] soft-deleted {$softDeleted} duplicate employee row(s)"
            );
        }
    }

    public function down(): void
    {
        // Intentionally no-op — restoring the soft-deletes would just
        // bring the duplicate-bug rows back. If a specific row was
        // wrongly removed, ops can manually flip its deleted_at to
        // null after auditing the log line above.
    }
};
