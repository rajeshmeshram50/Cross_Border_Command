<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Repairs data that predates GST applicability becoming country-derived.
     *
     * Until now `gst_applicable` was a free Yes/No the user picked, independent
     * of country, and defaulted to 'No'. The result, measured on this database
     * before the fix: of 19 India customers, 15 had NULL and 1 had 'No' — only
     * 3 were correct. SalesPdfController gates the buyer's GST number on that
     * flag, so quotations and PIs for those 16 were printing with no GSTIN.
     *
     * The controller now derives the flag on save, but that only repairs a row
     * when someone happens to re-open it. A customer nobody edits stays broken
     * forever, which is not good enough for a column sales and P2P read on
     * every document. Hence the backfill.
     *
     * Both values are recomputed from the primary address, so this is derivation
     * applied retroactively, not a guess — running it twice changes nothing.
     *
     * NOTE: this fixes the FLAG, not missing GSTINs. An India customer with no
     * gst_number recorded becomes 'Yes' + NULL number, and its PDF still shows
     * no GSTIN — correctly, because the number genuinely was never captured.
     * Those need data entry; the migration can't invent them. It does make them
     * visible: the form now requires a GST number for any India customer, so
     * the gap surfaces the next time each is edited.
     */
    public function up(): void
    {
        if (!Schema::hasTable('customers') || !Schema::hasTable('customer_addresses')) return;

        // ── 1. gst_applicable ⟵ primary address country ──────────────────────
        // India → Yes, anything else (including a customer with no primary
        // address at all) → No.
        $india = DB::table('customer_addresses')
            ->where('is_primary', true)
            ->where('country', 'India')
            ->pluck('customer_id');

        DB::table('customers')->whereIn('id', $india)->update(['gst_applicable' => 'Yes']);
        DB::table('customers')->whereNotIn('id', $india)->update(['gst_applicable' => 'No']);

        // A non-India customer can't hold a GST number — mirrors what the
        // controller stores on save.
        DB::table('customers')->whereNotIn('id', $india)->update(['gst_number' => null]);

        // ── 2. state_code ⟵ state name, via the code master ──────────────────
        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        // Runs after the seed migration, so all 36 India codes exist by now.
        // state_id is varchar → ::text cast on the join, as everywhere else.
        $codes = DB::table('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->whereNull('sc.client_id')
            ->whereRaw('LOWER(sc.status) = ?', ['active'])
            ->pluck('sc.state_code', 's.name');

        foreach ($codes as $stateName => $code) {
            // India only: the master carries Indian states, and the match is by
            // name, so scoping by country stops a same-named foreign state
            // (Punjab, for one) from picking up an Indian code.
            DB::table('customer_addresses')
                ->where('country', 'India')
                ->whereRaw('LOWER(state) = ?', [mb_strtolower((string) $stateName)])
                ->update(['state_code' => $code]);
        }

        // Anything not domestic has no GST state code, whatever it held before.
        DB::table('customer_addresses')->where('country', '!=', 'India')->update(['state_code' => null]);
        DB::table('customer_addresses')->whereNull('country')->update(['state_code' => null]);
    }

    /**
     * Not reversible: the previous values were the defect (NULL/'No' on India
     * customers). Restoring them would only re-break the PDFs.
     */
    public function down(): void
    {
        // no-op
    }
};
