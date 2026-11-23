<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('customers') || !Schema::hasTable('customer_addresses')) return;

        $india = DB::table('customer_addresses')
            ->where('is_primary', true)
            ->where('country', 'India')
            ->pluck('customer_id');

        DB::table('customers')->whereIn('id', $india)->update(['gst_applicable' => 'Yes']);
        DB::table('customers')->whereNotIn('id', $india)->update(['gst_applicable' => 'No']);

        DB::table('customers')->whereNotIn('id', $india)->update(['gst_number' => null]);

        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        $codes = DB::table('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->whereNull('sc.client_id')
            ->whereRaw('LOWER(sc.status) = ?', ['active'])
            ->pluck('sc.state_code', 's.name');

        foreach ($codes as $stateName => $code) {
            DB::table('customer_addresses')
                ->where('country', 'India')
                ->whereRaw('LOWER(state) = ?', [mb_strtolower((string) $stateName)])
                ->update(['state_code' => $code]);
        }

        DB::table('customer_addresses')->where('country', '!=', 'India')->update(['state_code' => null]);
        DB::table('customer_addresses')->whereNull('country')->update(['state_code' => null]);
    }

    public function down(): void
    {
    }
};
