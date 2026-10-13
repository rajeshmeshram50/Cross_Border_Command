<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · A rack code reads RC-001, not RK-001.
 *
 * 2026_10_12_000008 wrote the stored codes with an 'RK-' prefix and has
 * already run, so the column holds RK-### on every environment that migrated.
 * The prefix is RC- by decision, and the allocator, the model and the label's
 * QR payload now say so — this brings the rows already written into line, or
 * a rack created tomorrow would be RC-002 beside yesterday's RK-001.
 *
 * Only the prefix changes: RK-007 becomes RC-007, keeping the number the rack
 * has been known by. Rewriting the digits as well would renumber racks whose
 * labels are already printed and stuck to the steel.
 *
 * Shelves need nothing. A shelf code is its rack's code plus the level, built
 * on read (Shelf::getShelfCodeAttribute), so RK-001-SH-01 becomes RC-001-SH-01
 * the moment the rack row changes — there is no stored copy to chase.
 *
 * Anything that already carries the old form keeps working: the put-away
 * scanner resolves a label by the id in its QR, and typed codes are matched
 * with `ilike` against this column, so the only strings that stop matching are
 * the ones that no longer exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('inventory_racks')
            ->where('code', 'like', 'RK-%')
            ->update(['code' => DB::raw("'RC-' || substring(code from 4)")]);
    }

    public function down(): void
    {
        DB::table('inventory_racks')
            ->where('code', 'like', 'RC-%')
            ->update(['code' => DB::raw("'RK-' || substring(code from 4)")]);
    }
};
