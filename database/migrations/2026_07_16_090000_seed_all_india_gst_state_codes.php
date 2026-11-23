<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
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
        'Andhra Pradesh'                           => '37',
        'Ladakh'                                   => '38',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        $indiaId = DB::table('master_countries')->where('name', 'India')->value('id');
        if (!$indiaId) return;

        $states = DB::table('master_states')
            ->whereRaw('country_id::text = ?', [(string) $indiaId])
            ->pluck('id', 'name');

        $existing = DB::table('master_state_codes')->whereNull('client_id')->pluck('state_id')
            ->map(fn ($v) => (string) $v)->all();

        $now  = now();
        $rows = [];
        foreach (self::CODES as $stateName => $code) {
            $stateId = $states[$stateName] ?? null;
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

        \App\Support\MasterBundleCache::bump();
    }

    public function down(): void
    {
    }
};
