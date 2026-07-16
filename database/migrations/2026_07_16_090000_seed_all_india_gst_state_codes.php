<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * master_state_codes only ever defined 10 of India's 36 GST state codes, so
     * the State Code field auto-filled blank for the other 26 — live customers
     * in Ladakh, Lakshadweep, Puducherry and Manipur all had a NULL code. The
     * earlier dedupe migration flagged this as a data-completeness gap and left
     * it open; this closes it.
     *
     * It matters beyond the form: GST place-of-supply (IGST vs CGST+SGST) is
     * decided by comparing the buyer's state code to the seller's, so a blank
     * code means sales/P2P cannot compute tax at all for those states.
     *
     * Codes are statutory (CBIC state code list) and identical for every
     * tenant, so rows are seeded globally (client_id NULL) — matching how the
     * existing 10 were stored.
     *
     * Idempotent: inserts only states that have no code yet, so re-running is a
     * no-op and the 10 existing rows are left untouched. That's deliberate —
     * re-seeding blindly is exactly what created the 60-rows-for-10-codes mess
     * the dedupe migration had to clean up.
     */
    private const CODES = [
        'Jammu and Kashmir'                        => '01',
        'Himachal Pradesh'                         => '02',
        'Punjab'                                   => '03',
        'Chandigarh'                               => '04',
        'Uttarakhand'                              => '05',
        'Haryana'                                  => '06',
        'Delhi'                                    => '07',
        'Rajasthan'                                => '08',
        'Uttar Pradesh'                            => '09',
        'Bihar'                                    => '10',
        'Sikkim'                                   => '11',
        'Arunachal Pradesh'                        => '12',
        'Nagaland'                                 => '13',
        'Manipur'                                  => '14',
        'Mizoram'                                  => '15',
        'Tripura'                                  => '16',
        'Meghalaya'                                => '17',
        'Assam'                                    => '18',
        'West Bengal'                              => '19',
        'Jharkhand'                                => '20',
        'Odisha'                                   => '21',
        'Chhattisgarh'                             => '22',
        'Madhya Pradesh'                           => '23',
        'Gujarat'                                  => '24',
        'Dadra and Nagar Haveli and Daman and Diu' => '26',
        'Maharashtra'                              => '27',
        'Karnataka'                                => '29',
        'Goa'                                      => '30',
        'Lakshadweep'                              => '31',
        'Kerala'                                   => '32',
        'Tamil Nadu'                               => '33',
        'Puducherry'                               => '34',
        'Andaman and Nicobar Islands'              => '35',
        'Telangana'                                => '36',
        // 37, not the legacy 28 — 28 was pre-bifurcation Andhra Pradesh and is
        // no longer issued. 25 (Daman and Diu) and 28 are likewise retired, so
        // neither appears here.
        'Andhra Pradesh'                           => '37',
        'Ladakh'                                   => '38',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        $indiaId = DB::table('master_countries')->where('name', 'India')->value('id');
        if (!$indiaId) return;

        // state_id is varchar here (not a real FK), which is why every join
        // against master_states.id needs a ::text cast.
        $states = DB::table('master_states')
            ->whereRaw('country_id::text = ?', [(string) $indiaId])
            ->pluck('id', 'name');

        $existing = DB::table('master_state_codes')->whereNull('client_id')->pluck('state_id')
            ->map(fn ($v) => (string) $v)->all();

        $now  = now();
        $rows = [];
        foreach (self::CODES as $stateName => $code) {
            $stateId = $states[$stateName] ?? null;
            // A state we don't carry in the master — skip rather than insert a
            // dangling state_id (the exact defect the dedupe migration removed).
            if ($stateId === null) continue;
            if (in_array((string) $stateId, $existing, true)) continue;

            $rows[] = [
                'client_id'  => null,
                'branch_id'  => null,
                'state_id'   => (string) $stateId,
                'state_code' => $code,
                'status'     => 'Active',
                'created_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows) DB::table('master_state_codes')->insert($rows);

        /* The form bundles cache their master lists for 5 minutes, and these
         * rows went in via the query builder — no model event fired, so nothing
         * invalidated them. Without this bump the Customer/Supplier forms keep
         * serving the old 10-code list until each user's TTL lapses, and the
         * State Code field still auto-fills blank for the 26 new states. */
        \App\Support\MasterBundleCache::bump();
    }

    /**
     * Not reversible: we can't tell a row this migration added from one that
     * was already there, and dropping statutory codes would only re-break the
     * State Code auto-fill.
     */
    public function down(): void
    {
        // no-op
    }
};
