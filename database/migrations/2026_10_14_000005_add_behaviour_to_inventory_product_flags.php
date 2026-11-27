<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const GUESSES = [
        'cold chain' => 'cold_chain',
        'coldchain'  => 'cold_chain',
        'frozen'     => 'cold_chain',
        'chilled'    => 'cold_chain',
        'hazardous'  => 'hazardous',
        'hazmat'     => 'hazardous',
        'fragile'    => 'fragile',
    ];

    public function up(): void
    {
        Schema::table('inventory_product_flags', function (Blueprint $t) {
            $t->string('behaviour', 20)->default('none')->after('flag_name');
        });

        DB::statement(
            "alter table inventory_product_flags add constraint product_flag_behaviour_check
             check (behaviour in ('hazardous','cold_chain','fragile','none'))"
        );

        foreach (DB::table('inventory_product_flags')->get(['id', 'flag_name']) as $flag) {
            $name = mb_strtolower(trim((string) $flag->flag_name));
            foreach (self::GUESSES as $needle => $behaviour) {
                if ($name !== '' && str_contains($name, $needle)) {
                    DB::table('inventory_product_flags')
                        ->where('id', $flag->id)
                        ->update(['behaviour' => $behaviour]);
                    break;
                }
            }
        }
    }

    public function down(): void
    {
        DB::statement('alter table inventory_product_flags drop constraint if exists product_flag_behaviour_check');

        Schema::table('inventory_product_flags', function (Blueprint $t) {
            $t->dropColumn('behaviour');
        });
    }
};
