<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mark permission rows that were granted BY the dependency matrix rather than
 * ticked by the operator.
 *
 * Without the flag the two are indistinguishable (both are can_view-only), so
 * the resolver had to guess which rows were the seeds — and the guess broke on
 * mutually-dependent modules (Payroll needs Exit, Exit needs Payroll): each
 * explained the other, the seed set emptied, and the fallback resolved every
 * active row, dragging whole extra branches into the grant.
 *
 * Existing rows default to false = "explicitly granted", which is the safe
 * reading: it never revokes anything, it only means the pre-existing cascaded
 * grants stay put until that user's permissions are saved again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('permissions', function (Blueprint $table) {
            $table->boolean('is_auto')->default(false)->after('can_approve');
        });

        Schema::table('department_permissions', function (Blueprint $table) {
            $table->boolean('is_auto')->default(false)->after('can_approve');
        });
    }

    public function down(): void
    {
        Schema::table('permissions', function (Blueprint $table) {
            $table->dropColumn('is_auto');
        });

        Schema::table('department_permissions', function (Blueprint $table) {
            $table->dropColumn('is_auto');
        });
    }
};
