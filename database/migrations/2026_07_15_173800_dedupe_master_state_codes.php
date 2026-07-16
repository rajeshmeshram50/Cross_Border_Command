<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * master_state_codes had been re-seeded six times. Each run re-inserted the
     * same 10 GST codes with the state_ids of ITS era, so 60 rows existed for 10
     * codes — and only the newest 10 still pointed at a row in master_states.
     * The other 50 dangled, which is why `with('state')` returned null for them
     * and the Supplier form's State Code auto-fill silently did nothing for most
     * states (VendorController's bundle, and now the Customer bundle, both
     * eager-load that relation).
     *
     * This drops ONLY rows that both dangle AND have a surviving twin carrying
     * the same state_code — so a code can never be removed entirely. Verified
     * before writing: all 50 dangling rows have such a twin, nothing is lost.
     *
     * Safe to delete: no FK references master_state_codes.id (checked), and
     * addresses store the resolved code as a plain string (vendor_addresses
     * .state_code = '27'), not a reference to this table.
     *
     * NOTE for whoever picks this up: even after the cleanup the master only
     * defines 10 of India's 36 GST state codes. States outside those 10 still
     * have no code to auto-fill. That's a data-completeness gap, not a bug in
     * this migration.
     */
    public function up(): void
    {
        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        // Codes that still have at least one row resolving to a real state.
        $safeCodes = DB::table('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->distinct()
            ->pluck('sc.state_code');

        if ($safeCodes->isEmpty()) return;   // nothing resolves — don't touch anything

        DB::table('master_state_codes')
            ->whereIn('state_code', $safeCodes)
            ->whereNotIn('id', function ($q) {
                // Keep every row that DOES resolve to a state.
                $q->select('sc2.id')
                    ->from('master_state_codes as sc2')
                    ->join('master_states as s2', DB::raw('s2.id::text'), '=', DB::raw('sc2.state_id::text'));
            })
            ->delete();
    }

    /**
     * Not reversible: the deleted rows were duplicates pointing at state_ids
     * that no longer exist, so re-creating them would only restore broken data.
     */
    public function down(): void
    {
        // no-op
    }
};
