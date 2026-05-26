<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Widen `currency` columns from varchar(8) → varchar(64).
 *
 * The frontend currency picker can ship the full "USD – Usd" label
 * (master code + display name joined by an en-dash). The old 8-char
 * limit truncated that to 7 chars and the insert failed with a
 * Postgres 22001. Widening to 64 accommodates the longest label
 * combination the masters page produces while still bounded enough
 * to keep the index narrow.
 *
 * No data loss: every existing row already fits inside 8 chars.
 */
return new class extends Migration {
    public function up(): void
    {
        foreach (['lead_products', 'quotations', 'proforma_invoices'] as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'currency')) continue;
            Schema::table($table, function (Blueprint $t) {
                $t->string('currency', 64)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        // No-op down: shrinking back to 8 would truncate any rows that
        // benefited from the wider column. Leave them be.
    }
};
