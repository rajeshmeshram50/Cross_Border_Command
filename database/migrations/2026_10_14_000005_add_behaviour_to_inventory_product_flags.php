<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · A flag says what it MEANS, not just what it is called.
 *
 * The master has a name and a sequence code — PF-001, PF-002 — and nothing
 * else. The only thing identifying flag 1 as the hazardous one is the English
 * word in flag_name. Meanwhile inventory_zones, _racks and _shelves each carry
 * real cold_chain and hazardous booleans. So the box side speaks free text and
 * the location side speaks booleans, and every rule that has to join them —
 * the HAZ / COLD CHAIN counts on the pick list, the groups the boxes fall into,
 * "a cold box only onto a cold shelf" — has to match on a string.
 *
 * Which holds exactly until a tenant renames the flag, or adds "Hazmat Class 3"
 * as a second one. Then the counts quietly read zero and a hazardous box is
 * offered an ordinary shelf. Nothing errors; the rule just stops applying.
 *
 * behaviour is the meaning, chosen from a fixed set. The NAME stays the
 * tenant's to write.
 */
return new class extends Migration
{
    /** Lower-cased name fragment => behaviour. Longest, most specific first. */
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

        /* Backfill by name, which is all there is to go on. Deliberately
           conservative: a flag whose name we do not recognise stays 'none' and
           behaves exactly as it does today — invisible to the placement rules —
           rather than being guessed into a rule that refuses shelves. Someone
           who knows the goods sets it in the master. */
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
