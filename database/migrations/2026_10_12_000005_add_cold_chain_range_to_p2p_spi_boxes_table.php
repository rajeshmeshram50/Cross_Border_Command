<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · The cold-chain range a box must be held at, as numbers.
 *
 * The Temperature Range dialog already collects a proper min and max — and
 * then it was written into remark_note as the SENTENCE "Cold chain 2…8 °C"
 * and read back by splitting that string on an ellipsis. So the one fact that
 * exists to be compared could not be compared: no query can ask which boxes
 * need 2–8 °C, and put-away cannot check a box against a zone, because one
 * side is numeric and the other is prose. Rename the label and the parse
 * silently returns nothing.
 *
 * Same names and same type as inventory_zones.temp_min_c / temp_max_c, which
 * is the whole point: a put-away check becomes a direct comparison rather than
 * a conversion, and the two halves of cold chain finally speak the same units.
 *
 * On the BOX, not the flag: the dialog says "this box is marked Cold Chain",
 * and the range is a property of the carton exactly as its weight is. Cold
 * chain is also the only flag that carries data — Hazardous and Fragile are
 * labels — so a per-flag table would buy generality nobody needs and make the
 * numbers harder to reach.
 *
 * Nullable: a box with no cold-chain flag has no range, and "no range set yet"
 * is a real answer the dialog already shows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->decimal('temp_min_c', 6, 2)->nullable()->after('is_stackable');
            $t->decimal('temp_max_c', 6, 2)->nullable()->after('temp_min_c');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->dropColumn(['temp_min_c', 'temp_max_c']);
        });
    }
};
