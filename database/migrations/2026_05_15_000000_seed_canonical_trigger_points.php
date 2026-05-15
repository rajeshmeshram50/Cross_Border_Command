<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the two canonical lifecycle trigger points — "Onboarding" and
 * "Exit Management" — into the trigger_point master so the
 * HR Document Templates feature can match templates to the right
 * lifecycle stage by name.
 *
 * Why these two and not a free-text list:
 *   - Document Templates carry a trigger_point_id. The Onboarding /
 *     Exit Management pages each filter by a fixed trigger name to
 *     decide which templates appear in their flow. Without a fixed
 *     row to match against, that filter would be unreliable.
 *
 * Scope:
 *   - One row per (client_id, branch_id=null) tuple, so all branches
 *     of a client share the same canonical names. Branch users can
 *     still create extra trigger points under their own branch.
 *   - Plus a (client_id=null, branch_id=null) pair so super-admin
 *     created templates have something to point at on a fresh install.
 *
 * Re-run safety: each insert is guarded by an exists() check on the
 *   (client_id, branch_id, lower(module_name)) tuple so re-running
 *   doesn't create duplicates.
 *
 * New clients pick these rows up automatically — ClientController::store
 * calls the same seeding helper after creating the Client row.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $seed = function ($clientId) use ($now) {
            foreach (['Onboarding', 'Exit Management'] as $name) {
                $exists = DB::table('master_trigger_points')
                    ->where('client_id', $clientId)
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(module_name) = ?', [strtolower($name)])
                    ->exists();
                if ($exists) continue;

                DB::table('master_trigger_points')->insert([
                    'client_id'    => $clientId,
                    'branch_id'    => null,
                    'module_name'  => $name,
                    'description'  => $name === 'Onboarding'
                        ? 'Documents that auto-attach to the new-hire onboarding flow.'
                        : 'Documents that auto-attach to the employee exit flow.',
                    'status'       => 'Active',
                    'created_by'   => null,
                    'created_at'   => $now,
                    'updated_at'   => $now,
                ]);
            }
        };

        // Global pair (super-admin seeded templates point here).
        $seed(null);

        // Per-client pair.
        $clientIds = DB::table('clients')->pluck('id')->all();
        foreach ($clientIds as $cid) {
            $seed($cid);
        }
    }

    public function down(): void
    {
        // Only remove the canonical names we seeded; user-created rows with
        // the same name (different description) are left untouched.
        DB::table('master_trigger_points')
            ->whereIn(DB::raw('LOWER(module_name)'), ['onboarding', 'exit management'])
            ->whereNull('branch_id')
            ->whereIn('description', [
                'Documents that auto-attach to the new-hire onboarding flow.',
                'Documents that auto-attach to the employee exit flow.',
            ])
            ->delete();
    }
};
